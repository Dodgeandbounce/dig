import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../server/world.js';
import { EARTH_CENTER_KM } from '../shared/constants.js';

const mk = (opts = {}, rng = () => 0.99) =>
  World.create({ name: 'T', hostId: 'h', hostName: 'Host', maxPlayers: 3, ...opts }, { rng, speed: 1 });

test('does not tick without the host unless allowed', () => {
  const w = mk();
  w.board('g', 'Guest');
  w.tick(1000);
  assert.equal(w.run.depthKm, 0);
  assert.equal(w.pausedReason, 'Waiting for the host');
  w.board('h', 'Host');
  w.tick(1000);
  assert.ok(w.run.depthKm > 0);

  const w2 = mk({ allowPlayWithoutHost: true });
  w2.board('g', 'Guest');
  w2.tick(1000);
  assert.ok(w2.run.depthKm > 0);
});

test('freezes when everyone leaves', () => {
  const w = mk();
  w.board('h', 'Host'); w.tick(1000);
  const d = w.run.depthKm;
  w.disembark('h'); w.tick(5000);
  assert.equal(w.run.depthKm, d);
});

test('win at the center, lose at zero hull', () => {
  const win = mk();
  win.board('h', 'Host');
  for (let i = 0; i < 6000; i++) win.tick(1000);
  assert.equal(win.run.depthKm, EARTH_CENTER_KM);
  assert.equal(win.run.status, 'won');

  const lose = mk({}, () => 0); // every roll is a hit
  lose.board('h', 'Host');
  for (let i = 0; i < 100 && lose.run.status === 'active'; i++) lose.tick(1000);
  assert.equal(lose.run.status, 'lost');
  assert.equal(lose.repair('h').error, 'Run is over');
});

test('restart keeps crew and records history', () => {
  const w = mk();
  w.board('h', 'Host'); w.board('g', 'Guest'); w.tick(2000);
  w.restartRun();
  assert.equal(w.run.number, 2);
  assert.equal(w.run.depthKm, 0);
  assert.equal(w.history[0].status, 'abandoned');
  assert.deepEqual(Object.keys(w.members).sort(), ['g', 'h']);
});

test('round-trips through JSON without runtime state', () => {
  const w = mk();
  w.board('h', 'Host'); w.tick(3000);
  const copy = new World(JSON.parse(JSON.stringify(w.toJSON())));
  assert.equal(copy.run.depthKm, w.run.depthKm);
  assert.equal(copy.online.size, 0);
  assert.equal(copy.status, 'suspended');
});
