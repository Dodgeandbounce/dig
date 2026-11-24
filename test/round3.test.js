// The third feedback round: the urchid's lounge, Miney's bubbles and air, Bendin's walls, 013's missions
// and C4, the Ship-Eater, the Leviathan, events, candy, double doors and the island at the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, COMMANDS } from '../shared/sim/game.js';
import { T, TILE, DEATH_LINES, THIEVES } from '../shared/sim/data.js';
import { damage, hitTile, nearestHostile, dropPickup, AIR_DIRS, tileOwner } from '../shared/sim/combat.js';
import { repairRate, weaponOf } from '../shared/sim/classes.js';
import { crewCost } from '../shared/sim/ai.js';
import { idx } from '../shared/sim/grid.js';
import { levelMix, isGrunt } from '../shared/sim/roster.js';
import { makeRng } from '../shared/sim/rng.js';

const step = (g, s) => { for (let i = 0; i < s * 30; i++) { g.update(1 / 30); if (g.storyOpen) g.command(g.crew[0], { t: 'storyOk', choice: g.storyOpen.choices?.[0]?.id }); } };
const live = (seed = 7) => { const g = new Game({ seed }); g.phaseT = 99; g.update(1 / 30); return g; };
const press = (g, c, inp) => { c.human = true; g.setInput(c.id, { mx: 0, my: 0, ax: c.x + 30, ay: c.y, pressed: {}, ...inp }); g.update(1 / 30); };
const grunt = (g) => g.roster.findIndex((x) => isGrunt(x));

test('the urchid gets its own lounge, and anyone can choose to become the troll', () => {
  const g = new Game({ seed: 3, playerClass: 'urchid' });
  assert.ok(g.rooms.some((r) => r.type === 'lounge'), 'a lounge from the start');
  const h = live();
  const eng = h.crew.find((c) => c.cls === 'engineer'); eng.human = true;
  COMMANDS.switchClass(h, eng, { cls: 'urchid' });
  const u = h.crew.find((c) => c.cls === 'urchid');
  assert.ok(u && u.human, 'became the urchid');
  assert.ok(h.rooms.some((r) => r.type === 'lounge'), 'with its lounge');
});

test('every star adds health and stamina; base repairs are 10% faster', () => {
  const g = live();
  const c = g.crew[0];
  const hp = c.maxHp;
  c.xp = 9999;
  COMMANDS.classUpgrade(g, c, { track: 0 }); COMMANDS.classUpgrade(g, c, { track: 2 });
  assert.ok(c.maxHp > hp, `hp ${hp} -> ${c.maxHp}`);
  assert.ok(c.stamMax > 100, `stamina ${c.stamMax}`);
  assert.ok(Math.abs(repairRate({ cls: 'pilot', upgrades: [0, 0, 0], buffs: [] }) - 15.4) < 1e-9);
});

test('bubbles: trapped enemies burst out after a short while, and anyone can pop them', () => {
  const g = live();
  const c = g.crew.find((x) => x.cls === 'engineer');
  const trap = (m) => { const b = { id: 900 + m.id, kind: 'bubble', x: m.x, y: m.y, vx: 0, vy: 0, team: 'crew', life: 9, r: 20, t: 1, trapped: m, hold: 3 }; m.trapped = b; g.projs.push(b); return b; };
  const r = g.rooms.find((x) => x.type === 'shield');
  // a shot from the crew pops it and lands
  const m1 = g.spawnMob(grunt(g), r.station.x + 60, r.station.y + 60, {}); m1.hp = m1.maxHp = 500;
  const b1 = trap(m1);
  assert.ok(damage(g, m1, 20, { team: 'crew', owner: c }) > 0, 'the hit lands');
  assert.ok(!m1.trapped && b1.dead, 'popped');
  // bumping into it pops it too
  const m2 = g.spawnMob(grunt(g), r.station.x + 90, r.station.y + 60, {}); m2.hp = m2.maxHp = 500;
  trap(m2);
  c.x = m2.x; c.y = m2.y; g.update(1 / 30);
  assert.ok(!m2.trapped, 'bumped and popped');
  // left alone, it bursts out angry within a few seconds
  const m3 = g.spawnMob(grunt(g), r.station.x + 120, r.station.y + 70, {}); m3.hp = m3.maxHp = 500;
  trap(m3); c.x = r.station.x - 200;
  for (let k = 0; k < 30 * 4 && m3.trapped; k++) { m3.stunT = 9; g.update(1 / 30); }
  assert.ok(!m3.trapped, 'burst out');
});

test('the air layer: every open tile of the ship flows, and it all ends up at one or two spots', () => {
  const g = live();
  const A = g.air;
  assert.ok(A.sinks.length >= 1 && A.sinks.length <= 2);
  const B = g.box, rng = makeRng(5);
  // ALL of it: every open tile of the ship has an arrow (or is where it all goes)
  for (let y = B.y0; y <= B.y1; y++) for (let x = B.x0; x <= B.x1; x++) {
    const t = g.grid.tiles[idx(x, y)];
    if ((t === T.FLOOR || t === T.DOOR) && tileOwner(g, x, y) === 'us') assert.notEqual(A.dir[idx(x, y)], '.', `tile ${x},${y} has no air`);
  }
  let checked = 0;
  for (let n = 0; n < 400 && checked < 40; n++) {
    const x = rng.int(B.x0, B.x1), y = rng.int(B.y0, B.y1), i = idx(x, y);
    const ch = A.dir[i];
    if (!(ch >= 'a' && ch <= 'h') || tileOwner(g, x, y) !== 'us') continue;
    checked++;
    let j = i, steps = 0;
    while (A.dir[j] !== 's' && steps < 2000) { const [dx, dy] = AIR_DIRS[A.dir.charCodeAt(j) - 97]; j += dy * g.W + dx; steps++; }
    assert.equal(A.dir[j], 's', `tile ${x},${y} flows to a sink`);
  }
  assert.ok(checked >= 20);
  // a new dig picks new spots
  const before = A.sinks.join();
  let changed = false;
  for (let k = 0; k < 5 && !changed; k++) { g.level++; g.startBriefing(); changed = g.air.sinks.join() !== before; }
  assert.ok(changed, 'the spots move');
});

test('bots go round a blast door somebody shut', () => {
  const g = live();
  const d = g.doors.find((x) => x.blast);
  const cost = crewCost(g, false);
  assert.equal(cost(T.DOOR, d.i), 1.5);
  d.hold = 'closed';
  assert.ok(cost(T.DOOR, d.i) >= 50, 'a shut door is a long way round');
});

test('Bendin walks through walls while phased, and dies stuck in one if the clock runs out there', () => {
  const g = live();
  g.ensureRoomFor('vaelift'); const v = g.addCrew('vaelift'); g.layoutShip();
  const r = g.rooms.find((x) => x.type === 'shield');
  v.x = (r.x0 + 1.5) * TILE; v.y = (r.y0 + 3.5) * TILE;
  press(g, v, { pressed: { q: true } });
  assert.ok(v.phased, 'phased');
  const x0 = v.x;
  for (let k = 0; k < 30; k++) press(g, v, { mx: -1 });
  assert.ok(v.x < r.x0 * TILE - 4, `walked through the wall (${x0} -> ${v.x})`);
  // now stop right inside the wall and let the clock run out
  v.x = (r.x0 + 0.5) * TILE; v.phaseT = 0.02;
  press(g, v, {});
  assert.equal(v.alive, false, 'died in the wall');
  assert.ok(g.objs.some((o) => o.kind === 'wallbones'), 'bones sticking out');
});

test('the monster trainer starts with a pet, and can pick which', () => {
  const g = live();
  g.ensureRoomFor('trainer'); const tr = g.addCrew('trainer');
  assert.ok(tr.monsters.some((m) => m.starter), 'a starter');
  COMMANDS.pickStarter(g, tr, { id: 'water' });
  assert.equal(tr.monsters.filter((m) => m.starter).length, 1);
  assert.equal(tr.monsters.find((m) => m.starter).starter, 'water');
});

test('013: secret mission, disguise, four mines, and C4 is the only thing that opens a vault door', () => {
  const g = live();
  g.ensureRoomFor('agent'); const a = g.addCrew('agent'); g.layoutShip();
  g.startEncounter('ship'); const es = g.enemyShips[0]; g.dockShip(es);
  const m = g.spawnMob(grunt(g), a.x + 300, a.y, { markable: false });
  g.markTarget(m, a);
  assert.ok(g.mission && m.marked, 'a mission');
  COMMANDS.disguise(g, a, {});
  assert.equal(a.disguise, m.type);
  for (const c of g.crew) if (c !== a) c.x += 5000;   // (nobody else near)
  assert.notEqual(nearestHostile(g, { x: a.x + 20, y: a.y }, 'enemy', 400), a, 'they don\'t see 013 in the uniform');
  press(g, a, { fire: true, ax: a.x + 100, ay: a.y });
  assert.equal(a.disguise, null, 'shooting blows the cover');
  // R: a timed mine, G: C4
  a.cd.r = 0; press(g, a, { pressed: { r: true } });
  assert.ok(g.objs.some((o) => o.kind === 'mine' && o.sub === 'timed'));
  // an armoured door shrugs off everything but C4
  const d = g.doors.find((x) => x.owner === 'them');
  d.armored = true; d.hp = d.maxHp = 700;
  hitTile(g, d.x, d.y, 500);
  assert.equal(d.hp, 700, 'bullets and bombs do nothing');
  a.x = (d.x + 0.5) * TILE; a.y = (d.y + 2.5) * TILE; a.cd.g = 0;
  press(g, a, { pressed: { g: true }, ax: (d.x + 0.5) * TILE, ay: (d.y + 0.5) * TILE });
  const c4 = g.objs.find((o) => o.kind === 'mine' && o.sub === 'c4');
  assert.ok(c4 && c4.door != null, 'stuck on the door');
  a.x -= 400;
  c4.t = 0.05; step(g, 0.3);
  assert.ok(d.broken, 'blown open');
});

test('double doors: big rooms and the long side of small ones', () => {
  const g = live();
  const pairs = new Map();
  for (const d of g.doors) if (d.pair != null) pairs.set(d.pair, [...(pairs.get(d.pair) || []), d]);
  assert.ok(pairs.size >= 3, `pairs: ${pairs.size}`);
  for (const [, ds] of pairs) { assert.equal(ds.length, 2); assert.equal(Math.abs(ds[0].x - ds[1].x) + Math.abs(ds[0].y - ds[1].y), 1, 'side by side'); }
});

test('random events happen on the way down; candy gives boosts', () => {
  const g = live();
  g.eventAt = 0; step(g, 0.2);
  assert.ok(g.lastEvent, 'something happened');
  const c = g.crew[0];
  c.alive = true;
  dropPickup(g, c.x, c.y, 'candy', 1, 'white'); dropPickup(g, c.x, c.y, 'candy', 1, 'green');
  for (const p of g.pickups) { p.x = c.x; p.y = c.y; p.z = 0; }
  g.update(1 / 30); g.update(1 / 30);
  assert.ok(c.lightning > 0 && weaponOf(c).kind === 'chain', 'lightning gun');
  assert.ok(c.buffs.some((b) => b.speed > 0), 'faster');
});

test('the Ship-Eater swallows rooms; the Leviathan walks through walls', () => {
  const g = live();
  const r = g.rooms.find((x) => x.type === 'shield');
  const hi = g.roster.findIndex((x) => x.hoarder);
  const eater = g.spawnMob(hi, r.station.x + 30, r.station.y + 30, {});
  for (const c of g.crew) c.x += 4000;
  step(g, 6);
  assert.ok(r.eaten && r.sys.hp <= 0, 'ate the bubble generator');
  assert.ok(eater.fed >= 1 && eater.alive);
  eater.alive = false;
  // the Leviathan
  const li = g.roster.findIndex((x) => x.boss && x.walker);
  const eng = g.rooms.find((x) => x.type === 'engine');
  const boss = g.spawnMob(li, (g.box.x1 + 3) * TILE, eng.station.y, {}); boss.r = 40;
  for (const c of g.crew) { c.x = eng.station.x; c.y = eng.station.y + 30; }
  const walls = () => { let n = 0; for (let y = g.box.y0; y <= g.box.y1; y++) for (let x = g.box.x0; x <= g.box.x1; x++) { const t = g.grid.tiles[idx(x, y)]; if (t === T.WALL || t === T.HULL) n++; } return n; };
  const w0 = walls();
  for (let k = 0; k < 30 * 8; k++) { for (const c of g.crew) c.invuln = true; g.update(1 / 30); }
  assert.ok(walls() < w0 - 3, `crushed walls: ${w0} -> ${walls()}`);
});

test('deep down, up to six ships can latch on', () => {
  const g = live();
  const layout = { name: 'x', rooms: [{ type: 'bridge', c: 0, r: 0 }, { type: 'engine', c: 1, r: 0 }], hull: 100, bubble: 0, gunPeriod: 9, gunDmg: 1, missilePeriod: 9, missileDmg: 1, boarders: 1, wave: 1 };
  let n = 0;
  for (let k = 0; k < 6; k++) if (g.planEnemyShip(layout, 'ship', 5)) n++;
  assert.equal(n, 6);
});

test('thieving crews (pirates and friends) turn up in the mix', () => {
  const g = live();
  assert.equal(g.roster.filter((x) => x.thief).length, THIEVES.length);
  let found = false;
  const rng = makeRng(9);
  for (let k = 0; k < 60 && !found; k++) found = levelMix(g.roster, 12, null, rng).some((m) => g.roster[m.type].thief);
  assert.ok(found);
});

test('somebody goes down: a line of disbelief; at the end, an island to walk around', () => {
  const g = live();
  const c = g.crew[0];
  damage(g, c, 9999, { team: 'enemy' });
  assert.equal(c.alive, false);
  assert.ok(DEATH_LINES[c.cls].includes(c.say), c.say);
  g.endGame();
  assert.equal(g.phase, 'ending');
  assert.ok(g.island);
  let sand = 0; for (const t of g.grid.tiles) if (t === T.SAND) sand++;
  assert.ok(sand > 200, `sand ${sand}`);
  const p = g.crew[1]; const x0 = p.x;
  for (let k = 0; k < 20; k++) press(g, p, { mx: 1 });
  assert.ok(p.x !== x0, 'walking around');
});
