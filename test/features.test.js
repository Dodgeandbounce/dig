// The second big feedback round: bigger rooms, power, guns, XP, gems, bugs, the Hoarder, and friends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, COMMANDS } from '../shared/sim/game.js';
import { T, TILE, GEMS, SHIP_GUNS, xpCost, LEVELS } from '../shared/sim/data.js';
import { hostiles, melee, collides, unstick, airAt, gemType } from '../shared/sim/combat.js';
import { idx } from '../shared/sim/grid.js';
import { levelMix } from '../shared/sim/roster.js';

const step = (g, s) => { for (let i = 0; i < s * 30; i++) { g.update(1 / 30); if (g.storyOpen) g.command(g.crew[0], { t: 'storyOk', choice: 'easy' }); } };
const live = (seed = 7) => { const g = new Game({ seed }); g.phaseT = 99; g.update(1 / 30); return g; };
const press = (g, c, inp) => { c.human = true; g.setInput(c.id, { mx: 0, my: 0, ax: c.x + 30, ay: c.y, pressed: {}, ...inp }); g.update(1 / 30); };

test('rooms come in sizes: a big farm, big quarters, a smaller bridge with a hallway', () => {
  const g = live();
  for (const k of ['farmer']) { g.ensureRoomFor(k); g.addCrew(k); }
  g.ourRooms.push({ type: 'quarters', ...g.freeSlotNear('quarters') }); g.layoutShip();
  const farm = g.rooms.find((r) => r.type === 'farm'), q = g.rooms.find((r) => r.type === 'quarters'), bridge = g.rooms.find((r) => r.type === 'bridge');
  assert.ok(farm.w === 20 && farm.h === 14, `farm ${farm.w}x${farm.h}`);
  assert.ok(q.w === 20 && q.h === 7, `quarters ${q.w}x${q.h}`);
  assert.ok(bridge.w < 10, 'the bridge is smaller');
  assert.ok(g.rooms.some((r) => r.name === 'Bridge Hall'), 'a hallway beside it');
  // every room can still be reached from every other one
  const start = idx(Math.floor(bridge.station.x / TILE), Math.floor(bridge.station.y / TILE) + 1);
  const f = g.grid.flow([start], (t) => (t === T.FLOOR || t === T.DOOR ? 1 : Infinity));
  for (const r of g.rooms.filter((x) => x.owner === 'us')) assert.ok(f[idx(r.x0 + 2, r.y0 + 2)] < Infinity, `${r.name} reachable`);
  assert.ok(g.ship.farm.plots.length >= 8, 'more plots on the big farm');
});

test('a blast door is one door: shutting one tile shuts the whole thing', () => {
  const g = live();
  const d = g.doors.find((x) => x.blast);
  const group = g.doors.filter((x) => x.blast && x.group === d.group);
  assert.ok(group.length >= 1);
  const c = g.crew[0];
  c.x = (d.x + 0.5) * TILE; c.y = (d.y + 0.5) * TILE + (d.orient === 'v' ? 0 : 0);
  press(g, c, { pressed: { e: true } });
  assert.ok(group.every((x) => x.hold === 'closed'), 'all closed');
  press(g, c, { pressed: { e: true } });
  assert.ok(group.every((x) => x.hold === 'open'), 'all open');
});

test('gems come in kinds worth different amounts, and selling pays by value', () => {
  const g = live();
  const seen = new Set();
  g.level = 25; for (let k = 0; k < 400; k++) seen.add(gemType(g));
  assert.ok(seen.size >= 5, `kinds: ${[...seen]}`);
  for (const k of ['gold', 'ruby', 'silver', 'bronze', 'amethyst', 'sapphire']) assert.ok(GEMS[k]);
  const c = g.crew[0];
  g.pickups.push({ id: 991, kind: 'gem', sub: 'ruby', amt: 1, x: c.x, y: c.y, z: 0, vz: 0, t: 0 });
  g.update(1 / 30);
  assert.equal(g.ship.gemValue, GEMS.ruby.value);
  g.startPort('port');
  const before = c.wallet;
  COMMANDS.sell(g, c, {});
  assert.ok(c.wallet > before);
  assert.equal(g.ship.gems, 0); assert.equal(g.ship.gemValue, 0);
});

test('personal upgrades are bought with XP that you earn doing your job', () => {
  const g = live();
  const e = g.crew.find((c) => c.cls === 'engineer');
  e.human = true;
  assert.equal(COMMANDS.classUpgrade(g, e, { track: 0 }), undefined);
  assert.equal(e.upgrades[0], 0, 'no XP, no star');
  // repair a wall: XP
  const wall = g.rooms[0].x0 + 3, i = idx(wall, g.rooms[0].y0);
  g.grid.hp[i] = 10;
  e.x = (wall + 0.5) * TILE; e.y = (g.rooms[0].y0 + 1.5) * TILE;
  for (let k = 0; k < 60; k++) press(g, e, { e: true });
  assert.ok(e.xp > 0, `xp ${e.xp}`);
  e.xp = xpCost(0);
  COMMANDS.classUpgrade(g, e, { track: 0 });
  assert.equal(e.upgrades[0], 1);
  assert.equal(e.xp, 0);
});

test('power: cells are routed, unpowered guns do not fire, power cores add cells', () => {
  const g = live();
  const s = g.ship;
  assert.equal(s.power.cells, 5);
  s.items.push({ id: 'rail' });
  g.addCrew('missiletech'); g.ensureRoomFor('missiletech');
  const tech = g.crew.find((c) => c.cls === 'missiletech');
  assert.ok(g.command(g.crew[0], { t: 'install', item: 0 })?.error, 'only the missile tech installs');
  g.command(tech, { t: 'install', item: 0 });
  assert.deepEqual(s.guns.map((x) => x.id), ['dgun', 'rail']);
  const sci = g.addCrew('scientist'); g.ensureRoomFor('scientist'); sci.human = true;
  for (const k of Object.keys(s.power.alloc)) while (s.power.alloc[k] > 0) g.command(sci, { t: 'power', sys: k, d: -1 });
  g.command(sci, { t: 'power', sys: 'weapons', d: 1 });
  assert.equal(g.pw('weapons'), 1);
  // a docked ship to shoot at
  g.startEncounter('ship'); const es = g.enemyShips[0]; g.dockShip(es); es.bubble = 0;
  for (let k = 0; k < 30 * 12; k++) g.update(1 / 30);
  assert.equal(s.guns[1].on, false, 'the rail driver has no power');
  assert.equal(s.guns[0].on, true, 'the D-gun does');
  // a power core adds cells
  const before = s.power.cells;
  g.ourRooms.push({ type: 'power', ...g.freeSlotNear('power') }); g.layoutShip();
  assert.equal(s.power.cells, before + 3);
});

test('bugs that crawl in through holes attack everyone, the boarders too', () => {
  const g = live();
  const bug = g.roster.findIndex((x) => x.creature);
  const boarder = g.roster.findIndex((x) => !x.creature && !x.boss && !x.hoarder);
  const room = g.rooms[0];
  const b = g.spawnMob(bug, room.station.x + 40, room.station.y + 40, { wild: true });
  const e = g.spawnMob(boarder, room.station.x + 60, room.station.y + 40, {});
  assert.ok(b.wild && !e.wild);
  assert.ok(hostiles(g, 'wild').includes(e), 'boarders are fair game for bugs');
  assert.ok(hostiles(g, 'enemy').includes(b), 'and the boarders fight back');
  assert.ok(hostiles(g, 'crew').includes(b) && hostiles(g, 'crew').includes(e), 'we shoot both');
});

test('a knife in the back is an instant kill; from the front it is a normal stab', () => {
  const g = live();
  const ch = g.addCrew('chameleon');
  const type = g.roster.findIndex((x) => !x.creature && !x.boss && !x.hoarder && x.tier === 0);
  const m = g.spawnMob(type, 500, 500, {}); m.hp = m.maxHp = 500; m.facing = 0;
  ch.x = 470; ch.y = 500;   // behind it (it faces +x)
  melee(g, ch, { dmg: 18, range: 40, arc: 1.2, backstab: true }, 0, 'crew', {});
  assert.equal(m.alive, false, 'backstab kills');
  const m2 = g.spawnMob(type, 500, 500, {}); m2.hp = m2.maxHp = 500; m2.facing = Math.PI;   // facing us
  melee(g, ch, { dmg: 18, range: 40, arc: 1.2, backstab: true }, 0, 'crew', {});
  assert.ok(m2.alive && m2.hp > 400, 'front stab is normal damage');
});

test('the slot machine: coins go through enemies and hit twice as hard', () => {
  const g = live();
  const sl = g.addCrew('slots'); sl.wallet = 100;
  const type = g.roster.findIndex((x) => !x.creature && !x.boss && !x.hoarder);
  const a = g.spawnMob(type, sl.x + 60, sl.y, {}), b = g.spawnMob(type, sl.x + 100, sl.y, {});
  a.hp = a.maxHp = b.hp = b.maxHp = 999;
  for (let k = 0; k < 20; k++) press(g, sl, { ax: sl.x + 300, ay: sl.y, fire: true });
  assert.ok(a.hp < 999 && b.hp < 999, 'both got hit');
});

test('captured monsters come back twice as strong', () => {
  const g = live();
  const tr = g.addCrew('trainer');
  const type = g.roster.findIndex((x) => !x.creature && !x.boss && !x.hoarder);
  const m = g.spawnMob(type, tr.x + 40, tr.y, {}); m.hp = 1;
  tr.stunT = 5; for (const c of g.crew) c.stunT = 5;   // (so nobody whacks it first)
  g.projs.push({ id: 5, kind: 'cube', x: m.x - 20, y: m.y, vx: 300, vy: 0, team: 'crew', owner: tr, life: 1, r: 6, t: 0 });
  g.update(1 / 30);
  const caught = tr.monsters.filter((x) => !x.starter);   // (the starter pet is already in there)
  assert.equal(caught.length, 1);
  assert.ok(caught[0].hpMul >= 1.6 && caught[0].dmgMul >= 1.6, JSON.stringify(caught[0]));
});

test('once a run the enemy mix is a single huge thing (100%), and it goes for our scrap', () => {
  const g = live(4);
  g.level = g.soloLevel; g.startBriefing();
  assert.equal(g.mix.length, 1); assert.equal(g.mix[0].pct, 100);
  g.phaseT = 99; step(g, 0.2);
  g.descent.progress = 0.5; step(g, 0.2);
  assert.equal(g.phase, 'encounter');
  for (const es of g.enemyShips) if (!es.docked) g.dockShip(es);
  let hoarder = null;
  for (let k = 0; k < 30 * 30 && !hoarder; k++) { g.update(1 / 30); hoarder = g.mobs.find((m) => m.hoarder && m.alive); }
  assert.ok(hoarder, 'the Hoarder comes aboard');
  assert.ok(g.mobs.filter((m) => m.alive && m.team === 'enemy' && !m.wild).length === 1, 'alone');
  // normal levels have lots of kinds, sometimes a rare one
  const mix = levelMix(g.roster, 20, null, g.rng);
  assert.ok(mix.length >= 5, `kinds: ${mix.length}`);
  assert.equal(mix.reduce((a, m) => a + m.pct, 0), 100);
});

test('the chameleon picks which vent to come out of (theirs too)', () => {
  const g = live();
  const ch = g.addCrew('chameleon'); g.ensureRoomFor('chameleon'); g.layoutShip();
  const vents = g.objs.filter((o) => o.kind === 'vent');
  const from = vents[0], to = vents[vents.length - 1];
  ch.x = from.x; ch.y = from.y + 10;
  COMMANDS.vent(g, ch, { from: from.id, to: to.id });
  assert.ok(Math.hypot(ch.x - to.x, ch.y - to.y) < 40, 'came out where it chose');
});

test('downed crew choose where to get back up', () => {
  const g = live();
  g.ourRooms.push({ type: 'quarters', ...g.freeSlotNear('quarters') }); g.layoutShip();
  const c = g.crew[0];
  const opts = g.spawnRooms(c);
  assert.ok(opts.length >= 2);
  c.alive = false; c.downT = 0.01;
  COMMANDS.spawnPick(g, c, { room: opts[1] });
  g.update(1 / 30);
  assert.equal(g.grid.room[idx(Math.floor(c.x / TILE), Math.floor(c.y / TILE))], opts[1]);
});

test('stuck inside a rebuilt wall? you get pushed out', () => {
  const g = live();
  const c = g.crew[0], r = g.rooms[0];
  const x = r.x0, y = r.y0 + 1;   // a wall tile (not the doorway)
  c.x = (x + 0.5) * TILE; c.y = (y + 0.5) * TILE;
  assert.ok(collides(g, c));
  unstick(g, c);
  assert.ok(!collides(g, c));
});

test('dash: shift spends stamina and moves you fast', () => {
  const g = live();
  const c = g.crew.find((x) => x.cls === 'engineer');
  const x0 = c.x;
  press(g, c, { mx: 1, shift: true });
  assert.ok(c.stam < 100 && c.dashT > 0, 'dashing');
  for (let k = 0; k < 8; k++) press(g, c, { mx: 1, shift: true });
  assert.ok(c.x - x0 > 60, `moved ${c.x - x0}`);
});

test('staying to loot is a gamble: wait too long and a bigger ship comes', () => {
  const g = live();
  g.startEncounter('ship'); const es = g.enemyShips[0]; g.dockShip(es); g.surrender(es, 't');
  for (const m of g.mobs) if (m.team === 'enemy') m.alive = false;
  step(g, 0.5);
  assert.equal(g.phase, 'aftermath');
  g.crew.find((c) => c.cls === 'pilot').human = true;   // a human pilot who never leaves
  let t = 0;
  while (g.phase === 'aftermath' && t < 200) { g.update(1 / 30); t += 1 / 30; }
  assert.equal(g.phase, 'encounter', `still waiting after ${t.toFixed(0)}s`);
  assert.ok(g.enemyShips.some((s) => /Huge/.test(s.name)), 'a bigger one');
});

test('the pilot can burn an engine to escape right now', () => {
  const g = live();
  g.startEncounter('ship'); const es = g.enemyShips[0]; g.dockShip(es);
  const pilot = g.crew.find((c) => c.cls === 'pilot');
  const eng = g.rooms.find((r) => r.owner === 'us' && r.type === 'engine');
  COMMANDS.burnEngine(g, pilot, {});
  assert.equal(eng.sys.hp, 0, 'the engine is gone');
  step(g, 1.5);
  assert.ok(g.weFled, 'we got away');
});

test('meals heal, and better food heals more', () => {
  const g = live();
  const chef = g.addCrew('chef'); g.ensureRoomFor('chef');
  const c = g.crew[0]; c.hp = 10;
  g.serveMeal(chef, { recipe: 'skewers', target: 'all' });
  const small = c.hp - 10;
  c.hp = 10;
  g.serveMeal(chef, { recipe: 'feast', target: 'all' });
  assert.ok(small > 0 && c.hp - 10 > small, `${small} vs ${c.hp - 10}`);
});

test('enemy ships come in odd shapes, some with thin crawlways', () => {
  const g = live();
  g.level = 22; g.startBriefing();
  let thin = 0, big = 0, odd = 0;
  for (let k = 0; k < 30; k++) {
    g.startEncounter('ship');
    for (const es of g.enemyShips) {
      const cells = es.layout.rooms.reduce((a, r) => a + (r.cw || 1), 0);
      if (cells < es.cols * es.rows) odd++;
      thin += es.layout.rooms.filter((r) => r.thin).length;
      big += es.layout.rooms.filter((r) => r.cw > 1).length;
    }
  }
  assert.ok(odd > 0 && thin > 0 && big > 0, `odd ${odd} thin ${thin} big ${big}`);
  // and they still dock and can be walked through
  const es = g.enemyShips[0]; g.dockShip(es);
  const air = g.rooms[es.rooms[0]];
  const f = g.grid.flow([idx(es.dock.x, es.dock.y)], (t) => (t === T.FLOOR || t === T.DOOR || t === T.TUNNEL ? 1 : Infinity));
  for (const id of es.rooms) { const r = g.rooms[id]; assert.ok(f[idx(r.x0 + 1, r.y0 + 1)] < Infinity, `${r.name} reachable`); }
});
