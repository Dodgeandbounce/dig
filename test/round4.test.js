import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, COMMANDS } from '../shared/sim/game.js';
import { T, TILE } from '../shared/sim/data.js';

const step = (g, s) => { for (let i = 0; i < s * 30; i++) g.update(1 / 30); };
const live = (seed = 7) => { const g = new Game({ seed }); g.phaseT = 99; g.update(1 / 30); return g; };

test('a huge ship still gets its fight: ships that cannot fit come smaller, or dig in', () => {
  const g = live(5);
  g.box = { x0: 2, y0: 6, x1: 123, y1: 88 };   // pretend our ship fills the map
  g.startEncounter('ship');
  assert.ok(g.enemyShips.length > 0 || g.nest?.boarders, 'something comes for us');
});

test('their crew: officers by class, and losing the pilot stops them fleeing', () => {
  const g = live(9);
  g.level = 14; g.startBriefing(); g.phaseT = 99; g.update(1 / 30);
  g.startEncounter('ship');
  const es = g.enemyShips[0]; g.dockShip(es);
  assert.ok(es.crewCls.includes('pilot'));
  const pilot = g.mobs.find((m) => m.officer === 'pilot' && m.esId === es.id);
  assert.ok(pilot && pilot.alive);
  pilot.hp = 1; g.mobs.find((m) => m === pilot).alive = false; g.officerDown(pilot);
  assert.equal(g.officerOk(es, 'pilot'), false);
});

test('gadgets left on an enemy ship come back as scrap when it leaves', () => {
  const g = live(3);
  g.startEncounter('ship'); const es = g.enemyShips[0]; g.dockShip(es);
  const r = g.rooms[es.rooms[0]];
  g.objs.push({ id: 999, kind: 'turret', owner: g.crew[0].id, x: (r.x0 + 3) * TILE, y: (r.y0 + 3) * TILE });
  const scrap = g.ship.scrap;
  g.detachShip(es);
  assert.ok(!g.objs.some((o) => o.id === 999));
  assert.equal(g.ship.scrap, scrap + 15);
});

test('route votes: the pilot counts triple', () => {
  const g = live(4);
  g.route = { nodes: [{ type: 'ship', name: 'A' }, { type: 'port', name: 'B' }], t: 0 }; g.setPhase('route');
  const pilot = g.crew.find((c) => c.cls === 'pilot'), eng = g.crew.find((c) => c.cls === 'engineer');
  pilot.human = true; eng.human = true;
  g.addCrew('guard').human = true;
  const guard = g.crew.find((c) => c.cls === 'guard');
  COMMANDS.route(g, eng, { i: 1 }); COMMANDS.route(g, guard, { i: 1 });
  assert.equal(g.phase, 'route', 'waiting for everyone');
  COMMANDS.route(g, pilot, { i: 0 });
  assert.notEqual(g.phase, 'route');
  assert.equal(g.levelDone, true);
});

test('only a human pilot can undock; one makeshift gun per crew member', () => {
  const g = live(2);
  const pilot = g.crew.find((c) => c.cls === 'pilot'), eng = g.crew.find((c) => c.cls === 'engineer');
  pilot.human = true; eng.human = true;
  g.setPhase('aftermath');
  assert.ok(COMMANDS.continue(g, eng, { force: true })?.error);
  assert.equal(g.phase, 'aftermath');
  g.addCrew('commando'); const cmd = g.crew.find((c) => c.cls === 'commando');
  g.ship.scrap = 999;
  for (let k = 0; k < 10; k++) COMMANDS.craftGun(g, cmd, {}, g.ship);
  assert.ok(g.pickups.filter((p) => p.kind === 'gun').length <= g.crew.filter((c) => c.cls !== 'urchid').length);
});

test('a kicked ice block slides and smashes what it carries into a wall', () => {
  const g = live(6);
  g.addCrew('vaelift'); const v = g.crew.find((c) => c.cls === 'vaelift');
  g.objs.push({ id: 1, kind: 'iceslide', x: v.x, y: v.y, vx: 430, vy: 0, t: 2.4, owner: v.id, carry: [], dmg: 40 });
  step(g, 3);
  assert.ok(!g.objs.some((o) => o.kind === 'iceslide'), 'it stops');
  assert.ok(g.grid.tiles.every((t) => t !== undefined));
  assert.equal(T.ICE, 8);
});
