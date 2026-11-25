import { test } from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { Game, COMMANDS } from '../shared/sim/game.js';
import { T, TILE, MAP_W, LEVELS, JOE_NOTES, LINES, CLASSES } from '../shared/sim/data.js';
import { tileOwner, ignite, updateFires, extinguish } from '../shared/sim/combat.js';
import { idx, stationPos } from '../shared/sim/grid.js';
import { quip, MAKESHIFT, weaponOf, repairTarget } from '../shared/sim/classes.js';
import { deserializeGame } from '../server/persist.js';

const step = (g, s) => { for (let i = 0; i < s * 30; i++) g.update(1 / 30); };
const live = (seed = 7) => { const g = new Game({ seed }); g.phaseT = 99; g.update(1 / 30); return g; };

test('a walkway runs around the ship, with a door out of every outer room and 4 blast doors that start open', () => {
  const g = live();
  const B = g.box;
  // the outer ring is hull, the next two rings are walkway
  let ring = 0;
  for (let x = B.x0; x <= B.x1; x++) for (let y = B.y0; y <= B.y1; y++) { const i = idx(x, y); if (g.grid.tiles[i] === T.FLOOR && g.grid.room[i] < 0) ring++; }
  assert.ok(ring > 100, `walkway tiles: ${ring}`);
  const blast = g.doors.filter((d) => d.blast);
  assert.ok(blast.length >= 4, `blast door tiles: ${blast.length}`);
  assert.ok(blast.every((d) => d.hold === 'open' && d.open === 1));
  assert.ok(g.doors.some((d) => d.b === -1 && !d.blast), 'rooms open onto the walkway');
  // consoles sit clear of the doors (hallways have no console)
  for (const r of g.rooms.filter((x) => x.sys)) {
    const s = { x: Math.floor(r.station.x / TILE), y: Math.floor(r.station.y / TILE) };
    for (const d of g.doors) assert.ok(Math.abs(d.x - s.x) + Math.abs(d.y - s.y) > 2, `${r.name} console next to a door`);
  }
  // E toggles a door between shut and propped open
  const c = g.crew[0], d = g.doors.find((x) => !x.blast);
  c.x = (d.x + 0.5) * TILE; c.y = (d.y + 1.5) * TILE;
  g.setInput(c.id, { mx: 0, my: 0, ax: c.x, ay: c.y, pressed: { e: true } }); c.human = true; g.update(1 / 30);
  assert.equal(d.hold, 'closed');
  g.setInput(c.id, { mx: 0, my: 0, ax: c.x, ay: c.y, pressed: { e: true } }); g.update(1 / 30);
  assert.equal(d.hold, 'open');
});

test('deep down several ships dock, you see them coming, and each one leaves its own breach', () => {
  const g = live(3);
  g.level = 26; g.startBriefing(); g.phaseT = 99; g.update(1 / 30);
  g.startEncounter('ship');
  const ships = g.enemyShips;
  assert.ok(ships.length >= 2, `ships: ${ships.length}`);
  assert.ok(ships.every((s) => !s.docked && s.approachT > 0), 'they approach first');
  assert.equal(g.rooms.filter((r) => r.owner === 'them').length, 0, 'nothing built until they dock');
  step(g, 10);
  assert.ok(ships[0].docked, 'the first one docks');
  assert.equal(tileOwner(g, ships[0].dock.x, ships[0].dock.y), 'us');
  assert.ok(g.rooms.some((r) => r.owner === 'them' && r.esId === ships[0].id));
  // finish it off: every ship gives up
  for (const s of ships) if (!s.docked) g.dockShip(s);
  for (const s of ships) g.surrender(s, 'test');
  for (const m of g.mobs) if (m.team === 'enemy') m.alive = false;
  step(g, 1);
  assert.equal(g.phase, 'aftermath');
  g.pendingRecruit = false;   // (a recruit's new room rebuilds the hull, which can swallow a hole)
  COMMANDS.continue(g, g.crew[0], { force: true });
  assert.equal(g.rooms.filter((r) => r.owner === 'them').length, 0);
  for (const s of ships) assert.equal(g.grid.tiles[idx(s.dock.x, s.dock.y)], T.BREACH, 'the hole they blew stays');
});

test('fires spread, burn, and get put out (MrClean is fastest)', () => {
  const g = live();
  const r = g.rooms.find((x) => x.owner === 'us' && x.type === 'engine');
  const tx = r.x0 + 5, ty = r.y0 + 4;
  const f = ignite(g, tx, ty, 1);
  assert.ok(f);
  for (let i = 0; i < 30 * 30; i++) updateFires(g, 1 / 30);
  const n = g.objs.filter((o) => o.kind === 'fire').length;
  assert.ok(n > 1, `spread to ${n} tiles`);
  const fire = g.objs.find((o) => o.kind === 'fire');
  const slow = { x: fire.x, y: fire.y, cls: 'pilot', upgrades: [0, 0, 0] }, fast = { x: fire.x, y: fire.y, cls: 'mrclean', upgrades: [0, 0, 0], wallet: 0 };
  fire.f = 1; for (let i = 0; i < 30; i++) extinguish(g, slow, 1 / 30);
  const afterSlow = fire.f;
  fire.f = 1; for (let i = 0; i < 30; i++) extinguish(g, fast, 1 / 30);
  assert.ok(!g.objs.includes(fire) || fire.f < afterSlow, 'MrClean is faster');
  // losing an engine sets the room on fire
  g.objs = g.objs.filter((o) => o.kind !== 'fire');
  r.sys.hp = 1; g.onSystemDestroyed(r);
  assert.ok(g.objs.some((o) => o.kind === 'fire'));
});

test('only the pilot undocks; crew left on their ship get a warning, then a laugh and a yank home', () => {
  const g = live();
  g.startEncounter('ship');
  const es = g.enemyShips[0]; g.dockShip(es); g.surrender(es, 'test');
  for (const m of g.mobs) if (m.team === 'enemy') m.alive = false;
  step(g, 0.5);
  assert.equal(g.phase, 'aftermath');
  const pilot = g.crew.find((c) => c.cls === 'pilot'), engie = g.crew.find((c) => c.cls === 'engineer');
  pilot.human = true; engie.human = true;
  assert.ok(COMMANDS.continue(g, engie, {})?.error, 'the engineer cannot undock');
  // the engineer wanders onto their ship
  const theirs = g.rooms[es.rooms[0]];
  engie.x = theirs.station.x + 40; engie.y = theirs.station.y + 40;
  assert.equal(tileOwner(g, Math.floor(engie.x / TILE), Math.floor(engie.y / TILE)), 'them');
  assert.ok(COMMANDS.continue(g, pilot, {})?.warn, 'first signal: warning');
  assert.equal(g.phase, 'aftermath');
  COMMANDS.continue(g, pilot, {});
  assert.notEqual(g.phase, 'aftermath');
  assert.equal(tileOwner(g, Math.floor(engie.x / TILE), Math.floor(engie.y / TILE)), 'us', 'yanked back aboard');
  // a wrecked bridge means nobody goes anywhere
  const g2 = live(); g2.startEncounter('ship'); const e2 = g2.enemyShips[0]; g2.dockShip(e2); g2.surrender(e2, 't');
  for (const m of g2.mobs) if (m.team === 'enemy') m.alive = false;
  step(g2, 0.5);
  g2.rooms.find((r) => r.type === 'bridge' && r.owner === 'us').sys.hp = 0;
  assert.ok(COMMANDS.continue(g2, g2.crew[0], { force: true })?.error);
});

test('no "read a note" stop on the route: notes come with whatever you pick', () => {
  const g = live();
  let notes = 0;
  for (let L = 2; L < 20; L++) {
    g.level = L;
    const nodes = g.makeRoute();
    assert.ok(!nodes.some((n) => n.type === 'discovery' && !n.derelict && !n.rescue), 'no plain discovery nodes');
    const before = g.noteIdx;
    g.storyQ = []; g.storyOpen = null;
    g.maybeNote(nodes[0]);
    if (g.noteIdx > before) notes++;
  }
  assert.ok(notes >= 3 && notes <= JOE_NOTES.length, `notes found: ${notes}`);
});

test('the trip is long, the crew joins two at a time, and everyone has lines', () => {
  assert.ok(LEVELS >= 25);
  const g = live();
  g.level = 6; const n0 = g.crew.length;
  g.startPort('port');
  assert.equal(g.crew.length - n0, 2, 'two recruits at a port');
  for (const cls of Object.keys(CLASSES)) assert.ok(LINES[cls], `${cls} has lines`);
  const c = g.crew[0]; c.sayT = 0; c.quipT = 0;
  quip(g, c, 'fight', true);
  assert.ok(c.say);
});

test('makeshift guns: anyone can carry one, a few shots, then it is 1 scrap', () => {
  const g = live();
  const c = g.crew.find((x) => x.cls === 'engineer');
  g.pickups.push({ id: 999, kind: 'gun', amt: 1, sub: 0, x: c.x, y: c.y, z: 0, vz: 0, t: 0 });
  g.update(1 / 30);
  assert.ok(c.makeshift?.ammo > 0, 'picked up');
  assert.equal(weaponOf(c), MAKESHIFT);
  const scrap = g.ship.scrap;
  c.human = true;
  for (let i = 0; i < 30 * 8 && c.makeshift; i++) { g.setInput(c.id, { mx: 0, my: 0, ax: c.x + 100, ay: c.y, fire: true, pressed: {} }); g.update(1 / 30); }
  assert.equal(c.makeshift, null);
  assert.ok(g.ship.scrap >= scrap + 1 - 0.5);
});

test('wreckage blocks a doorway until someone clears it', () => {
  const g = live();
  const r = g.rooms.find((x) => x.owner === 'us' && x.type === 'weapons');
  for (let k = 0; k < 10 && ![...g.orig.values()].length; k++) g.blockDoorway(r);
  const i = [...g.orig.keys()].find((k) => g.grid.tiles[k] === T.DEBRIS);
  assert.ok(i != null, 'debris placed');
  assert.ok(g.grid.solidAt(i % MAP_W, (i / MAP_W) | 0, g.doors), 'it blocks');
  const c = g.crew.find((x) => x.cls === 'engineer');
  c.x = ((i % MAP_W) + 0.5) * TILE; c.y = (((i / MAP_W) | 0) + 1.5) * TILE;
  if (repairTarget(g, c)?.i !== i) { c.y -= 2 * TILE; }
  c.human = true;
  for (let k = 0; k < 30 * 10 && g.grid.tiles[i] === T.DEBRIS; k++) { g.setInput(c.id, { mx: 0, my: 0, ax: c.x, ay: c.y, e: true, pressed: {} }); g.update(1 / 30); }
  assert.equal(g.grid.tiles[i], T.FLOOR);
});

test("playing the urchid, the bots still go and get Joe out of his pod", () => {
  for (const seed of [1, 2, 3]) {
    const g = new Game({ seed, playerClass: 'urchid' });
    g.phaseT = 99; g.update(1 / 30);
    for (const k of ['guard', 'mrclean', 'commando', 'dog']) { g.ensureRoomFor(k); g.addCrew(k); }
    g.level = LEVELS - 1; g.path = 'brother'; g.joe.state = 'alive';
    g.startEncounter('pod');
    let t = 0;
    while (g.joe.state === 'alive' && t < 240) { g.update(1 / 30); t += 1 / 30; }
    assert.equal(g.joe.state, 'saved', `seed ${seed}: Joe is ${g.joe.state} after ${t.toFixed(0)}s`);
  }
});

test('old saves (before the rework) are refused so the server starts a fresh run', () => {
  const buf = v8.serialize({ seed: 1, crew: [], grid: {} });
  assert.throws(() => deserializeGame(buf), /version/);
});

test('an all-bot crew survives a deep multi-ship docking with a decent ship (no hangs, no crashes)', () => {
  const g = live(11);
  g.level = 20; g.startBriefing(); g.phaseT = 99; g.update(1 / 30);
  for (const k of ['guard', 'chef', 'mrclean', 'missiletech', 'commando', 'farmer', 'scientist', 'dog']) { g.ensureRoomFor(k); g.addCrew(k); }
  Object.assign(g.ship.up, { plating: 5, bubble: 3, dgun: 5, dmissile: 4 }); g.recalcShip(); g.ship.hull = g.ship.hullMax;
  for (const c of g.crew) c.upgrades = [4, 4, 4];
  g.startEncounter('ship');
  let t = 0;
  while (g.phase === 'encounter' && t < 500) { g.update(1 / 30); t += 1 / 30; }
  assert.notEqual(g.phase, 'encounter', 'the fight ends');
  assert.ok(g.mobs.filter((m) => m.alive && m.team === 'enemy').length <= 70, 'enemy count is capped');
});
