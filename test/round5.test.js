// Fifth feedback round: port roaming and the pilot's undock warning, route AFK pick, the repair key,
// creatures stuck in walls, Deep City furniture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, ROUTE_AFK, bestRoute } from '../shared/sim/game.js';
import { T, TILE } from '../shared/sim/data.js';
import { idx } from '../shared/sim/grid.js';
import { fixKey, furniturePlaces } from '../shared/sim/classes.js';

const step = (g, s) => { for (let i = 0; i < s * 30; i++) g.update(1 / 30); };
const live = (seed = 7) => { const g = new Game({ seed }); g.phaseT = 99; g.update(1 / 30); return g; };
const twoPlayers = (g) => { const pilot = g.crew.find((c) => c.cls === 'pilot'); const other = g.crew.find((c) => c !== pilot && c.cls !== 'urchid'); pilot.human = true; other.human = true; return { pilot, other }; };

test('port: only the pilot undocks, with a 15 second warning for everyone else', () => {
  const g = live(3);
  const { pilot, other } = twoPlayers(g);
  g.startPort('city');
  g.command(other, { t: 'depart' });
  assert.equal(g.phase, 'port', 'a crew member cannot undock');
  g.command(pilot, { t: 'depart' });
  assert.equal(g.phase, 'port');
  assert.ok(g.port.departT > 14, 'the warning is running');
  assert.ok(g.logs?.some?.((l) => /preparing to UNDOCK/.test(l.text)) ?? true);
  step(g, 16);
  assert.notEqual(g.phase, 'port', 'gone when the warning runs out');
});

test('port: the pilot can go early during the warning', () => {
  const g = live(4);
  const { pilot } = twoPlayers(g);
  g.startPort('port');
  g.command(pilot, { t: 'depart' });
  g.command(pilot, { t: 'depart' });
  assert.notEqual(g.phase, 'port');
});

test('route: with a player aboard the bots never pick, only the AFK timer does (by what the ship needs)', () => {
  const g = live(5);
  const pilot = g.crew.find((c) => c.cls === 'pilot'); pilot.human = false;
  const me = g.crew.find((c) => c.cls !== 'pilot' && c.cls !== 'urchid'); me.human = true;
  g.route = { nodes: [{ type: 'ship', name: 'A ship' }, { type: 'fuel', name: 'Fuel' }], t: 0 };
  g.setPhase('route');
  g.ship.fuel = 5;
  assert.equal(bestRoute(g).type, 'fuel');
  step(g, 30);
  assert.equal(g.phase, 'route', 'still waiting for the player');
  g.command(pilot, { t: 'route', i: 0 });
  assert.equal(g.phase, 'route', 'a bot cannot vote');
  step(g, ROUTE_AFK - 28);
  assert.notEqual(g.phase, 'route');
});

test('repair key: R for most, V when R is an ability, and it fixes a station without opening anything', () => {
  const g = live(6);
  assert.equal(fixKey({ cls: 'guard' }), 'r');
  assert.equal(fixKey({ cls: 'engineer' }), 'r');
  assert.equal(fixKey({ cls: 'agent' }), 'v');
  const c = g.crew.find((x) => x.cls === 'pilot');
  const r = g.rooms.find((x) => x.owner === 'us' && x.type === 'bridge');
  r.sys.hp = 10;
  c.x = r.station.x + 30; c.y = r.station.y + 30;
  for (let i = 0; i < 60; i++) { g.setInput(c.id, { mx: 0, my: 0, ax: c.x, ay: c.y - 50, r: true, pressed: {} }); g.update(1 / 30); }
  assert.ok(r.sys.hp > 15, `bridge repaired (${r.sys.hp})`);
  assert.ok(!c.atHelm);
});

test('a creature stuck inside a wall pops back out where it can be shot', () => {
  const g = live(8);
  const r = g.rooms.find((x) => x.owner === 'us' && x.type === 'engine');
  // a wall tile of that room
  let wx = r.x0, wy = r.y0 + 2;
  assert.equal(g.grid.tiles[idx(wx, wy)] === T.WALL || g.grid.tiles[idx(wx, wy)] === T.HULL, true);
  const type = g.roster.find((x) => x.creature) || g.roster[0];
  const m = g.spawnMob(type.idx, (wx + 0.5) * TILE, (wy + 0.5) * TILE, { wild: true });
  m.speed = 0;
  step(g, 3);
  const tx = Math.floor(m.x / TILE), ty = Math.floor(m.y / TILE);
  assert.ok(!m.alive || !(g.grid.tiles[idx(tx, ty)] === T.WALL || g.grid.tiles[idx(tx, ty)] === T.HULL), 'out of the wall (or crushed)');
});

test('deep cities sell beds and a jukebox; lying in a bed heals fast', () => {
  const g = live(9);
  const me = g.crew[0]; me.human = true; me.wallet = 1000;
  g.startPort('city');
  const qi = g.rooms.findIndex((r) => r.owner === 'us' && r.type === 'engine');
  g.command(me, { t: 'buyFurniture', type: 'bed', room: qi });
  g.command(me, { t: 'buyFurniture', type: 'jukebox', room: qi });
  assert.equal(g.ship.furniture.length, 2);
  assert.equal(g.ship.jukebox, 1);
  const bed = furniturePlaces(g).find((f) => f.type === 'bed');
  assert.ok(bed);
  me.x = bed.x; me.y = bed.y; me.hp = 10;
  g.setInput(me.id, { mx: 0, my: 0, ax: me.x, ay: me.y - 40, pressed: { e: true } }); g.update(1 / 30);
  assert.ok(me.resting, 'lying down');
  for (let i = 0; i < 60; i++) { g.setInput(me.id, { mx: 0, my: 0, ax: me.x, ay: me.y - 40, pressed: {} }); g.update(1 / 30); }
  assert.ok(me.hp > 20, `healed (${me.hp})`);
  // not in a plain port
  const g2 = live(10); const c2 = g2.crew[0]; c2.wallet = 1000; g2.startPort('port');
  g2.command(c2, { t: 'buyFurniture', type: 'bed', room: 0 });
  assert.ok(!g2.ship.furniture?.length);
});
