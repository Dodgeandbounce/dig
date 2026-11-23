import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { decodeState, decodeGrid, applyGridDiff, unpackState } from '../shared/sim/netcode.js';
import { interactTarget, repairTarget } from '../shared/sim/classes.js';
import { T, TILE, MAP_W } from '../shared/sim/data.js';

const mk = (opts = {}, rng = () => 0.42) =>
  World.create({ name: 'T', hostId: 'h', hostName: 'Host', maxPlayers: 3, ...opts }, { rng, speed: 1 });
const run = (w, seconds) => { for (let i = 0; i < seconds * 10; i++) w.tick(100); };

test('does not tick without the host unless allowed', () => {
  const w = mk();
  w.board('g', 'Guest');
  run(w, 1);
  assert.equal(w.game.time, 0);
  assert.equal(w.pausedReason, 'Waiting for the host');
  w.board('h', 'Host');
  run(w, 1);
  assert.ok(w.game.time > 0.9);

  const w2 = mk({ allowPlayWithoutHost: true });
  w2.board('g', 'Guest');
  run(w2, 1);
  assert.ok(w2.game.time > 0.9);
});

test('freezes when everyone leaves', () => {
  const w = mk();
  w.board('h', 'Host'); run(w, 1);
  const t = w.game.time;
  w.disembark('h'); run(w, 5);
  assert.equal(w.game.time, t);
});

test('each player controls one crew member; bots take over when they leave', () => {
  const w = mk({ playerClass: 'engineer' });
  w.board('h', 'Host');
  w.board('g', 'Guest');
  w.board('x', 'Third');
  const host = w.crewOf('h'), guest = w.crewOf('g'), third = w.crewOf('x');
  assert.equal(host.cls, 'engineer');              // the host's chosen starting class
  assert.equal(guest.cls, 'pilot');
  assert.equal(third.cls, 'engineer');             // nobody left to take over: a new engineer signs on
  assert.ok(host.human && guest.human && third.human);
  assert.equal(new Set([host.id, guest.id, third.id]).size, 3);
  assert.equal(guest.player, 'Guest');

  w.disembark('g');
  assert.equal(guest.human, false);
  w.board('g', 'Guest');
  assert.equal(w.crewOf('g'), guest);              // back in the same seat
});

test('inputs move your crew member; commands are checked', () => {
  const w = mk();
  w.board('h', 'Host');
  const c = w.crewOf('h');
  // skip the briefing so the ship is "live"
  run(w, 6);
  const x0 = c.x;
  for (let i = 0; i < 20; i++) { w.input('h', { mx: 1, my: 0, ax: c.x + 100, ay: c.y, pressed: { nope: true, q: true } }); w.tick(50); }
  assert.notEqual(Math.round(c.x), Math.round(x0));
  assert.equal(w.command('h', { t: 'pause', on: true }).error, 'Unknown command');
  assert.equal(w.command('h', { t: 'constructor' }).error, 'Unknown command');
  assert.equal(w.command('nobody', { t: 'storyOk' }).error, 'Bad command');
  assert.ok(w.command('h', { t: 'helm', on: true }).ok);
  assert.equal(w.game.paused || false, false);
});

test('frames rebuild a drawable game on the client, grid diffs included', () => {
  const w = mk();
  w.board('h', 'Host');
  const kept = new Map();
  const join = JSON.parse(w.joinFrame());
  const grid = decodeGrid(join.grid);
  let g = decodeState(unpackState(join.s, join.keep, kept), grid);
  assert.equal(g.crew.length, w.game.crew.length);
  assert.ok(g.roster.length > 0);
  run(w, 3);
  // knock a hole in the hull and make sure the client sees it
  const i = w.game.grid.tiles.findIndex((t, k) => k > 3000 && t === T.HULL);
  w.game.grid.hp[i] = 1;
  let kepts = 0;
  for (let k = 0; k < 4; k++) {
    w.tick(100);
    const f = JSON.parse(w.frame());
    kepts += (f.keep || []).length;
    applyGridDiff(grid, f);
    g = decodeState(unpackState(f.s, f.keep, kept), grid);
  }
  assert.ok(kepts > 0, 'unchanged parts are not resent');
  assert.ok(g.roster.length > 0 && g.rooms.length === w.game.rooms.length && g.ship.name === w.game.ship.name);
  assert.equal(g.crew[0].x, Math.round(w.game.crew[0].x * 10) / 10);
  assert.equal(grid.hp[i], 1);
  assert.deepEqual([...grid.tiles], [...w.game.grid.tiles]);
  assert.equal(g.depthKm, w.game.depthKm);   // prototype getters work on decoded state
  assert.equal(g.tier, w.game.tier);
  assert.ok(Array.isArray(g.freeSlots()));
  assert.equal(typeof g.finalScore(), 'number');
  const me = g.crew.find((c) => c.id === join.seats.h);
  assert.ok(me?.human);
});

test('the UI helpers work on a decoded game, with wrecked tiles in view', () => {
  const w = mk();
  w.board('h', 'Host');
  run(w, 3);
  const c = w.crewOf('h');
  // smash the nearest wall next to the player so there is something to repair
  const gr = w.game.grid;
  const tx = Math.floor(c.x / TILE), ty = Math.floor(c.y / TILE);
  let hit = null;
  for (let r = 1; r <= 6 && hit == null; r++) for (let dy = -r; dy <= r && hit == null; dy++) for (let dx = -r; dx <= r && hit == null; dx++) {
    const i = (ty + dy) * MAP_W + tx + dx;
    if (gr.tiles[i] === T.WALL || gr.tiles[i] === T.HULL) hit = i;
  }
  assert.ok(hit != null, 'a wall near the player');
  w.game.orig.set(hit, gr.tiles[hit]); gr.tiles[hit] = T.RUBBLE;
  c.x = ((hit % MAP_W) + 0.5) * TILE; c.y = (Math.floor(hit / MAP_W) + 0.5) * TILE + TILE; // stand next to it
  const f = JSON.parse(w.joinFrame());
  const g = decodeState(f.s, decodeGrid(f.grid));
  const me = g.crew.find((x) => x.id === f.seats.h);
  assert.doesNotThrow(() => interactTarget(g, me));
  assert.doesNotThrow(() => repairTarget(g, me));
  assert.ok(g.orig instanceof Map && g.orig.get(hit) != null);
});

test('the running game survives a save and reload', () => {
  const w = mk();
  w.board('h', 'Host'); w.board('g', 'Guest');
  run(w, 20);
  const saved = { json: JSON.parse(JSON.stringify(w.toJSON())), game: w.saveGame() };
  const copy = new World(saved.json, { gameData: saved.game });
  assert.equal(copy.game.level, w.game.level);
  assert.equal(copy.game.phase, w.game.phase);
  assert.equal(Math.round(copy.game.time * 10), Math.round(w.game.time * 10));
  assert.equal(copy.game.crew.length, w.game.crew.length);
  assert.equal(copy.online.size, 0);
  assert.equal(copy.status, 'suspended');
  assert.ok(copy.game.crew.every((c) => !c.human));
  copy.board('h', 'Host');
  assert.equal(copy.crewOf('h').id, w.crewOf('h').id);
  run(copy, 5);                                   // and keeps running
  assert.ok(copy.game.time > w.game.time);
});

test('restart starts a new game, keeps the crew, records history', () => {
  const w = mk();
  w.board('h', 'Host'); w.board('g', 'Guest'); run(w, 2);
  const old = w.game;
  w.restartRun();
  assert.notEqual(w.game, old);
  assert.equal(w.run.number, 2);
  assert.equal(w.game.level, 1);
  assert.equal(w.history[0].status, 'abandoned');
  assert.deepEqual(Object.keys(w.members).sort(), ['g', 'h']);
  assert.ok(w.crewOf('h').human && w.crewOf('g').human);
});

test('the run ends when the game does', () => {
  const w = mk();
  w.board('h', 'Host');
  w.game.ship.hull = 0;
  run(w, 1);
  assert.equal(w.run.status, 'lost');
  assert.equal(w.canTick, false);
  assert.equal(w.command('h', { t: 'storyOk' }).error, 'Run is over');
});
