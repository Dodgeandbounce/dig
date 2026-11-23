// End-to-end: real server, real WebSockets (Node 22's built-in client).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server/game-server.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function client(port, hello) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const inbox = [];
  let cursor = 0; // messages before this index have been consumed
  let waiter = null;
  const check = () => {
    if (!waiter) return;
    for (let i = cursor; i < inbox.length; i++) {
      if (waiter.pred(inbox[i])) { cursor = i + 1; const w = waiter; waiter = null; clearTimeout(w.timer); w.resolve(inbox[i]); return; }
    }
  };
  ws.onmessage = (e) => { inbox.push(JSON.parse(e.data)); check(); };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const c = {
    ws, inbox,
    send: (m) => ws.send(JSON.stringify(m)),
    waitFor(pred, ms = 3000) {
      return new Promise((resolve, reject) => {
        waiter = { pred, resolve, timer: setTimeout(() => reject(new Error('timeout waiting for message')), ms) };
        check();
      });
    },
    close: () => ws.close(),
  };
  c.send({ t: 'hello', ...hello });
  c.me = await c.waitFor((m) => m.t === 'welcome');
  return c;
}

test('lobby, drop-in/out, host controls and persistence', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'doigo-'));
  let game = createGameServer({ dataDir, speed: 20, rng: () => 0.99 });
  let port = await game.listen(0);

  // Host commissions a ship.
  const host = await client(port, { name: 'Ada' });
  host.send({ t: 'create', name: 'Molehill', maxPlayers: 2 });
  const s1 = await host.waitFor((m) => m.t === 'world');
  const worldId = s1.world.id;
  assert.equal(s1.world.hostId, host.me.playerId);

  // Guest sees it in the lobby and drops in.
  const guest = await client(port, { name: 'Bo' });
  const lobby = await guest.waitFor((m) => m.t === 'lobby' && m.worlds.length === 1);
  assert.equal(lobby.worlds[0].name, 'Molehill');
  guest.send({ t: 'join', worldId });
  await guest.waitFor((m) => m.t === 'world' && m.world.online === 2);

  // Ship is full at 2.
  const third = await client(port, { name: 'Cy' });
  third.send({ t: 'join', worldId });
  const full = await third.waitFor((m) => m.t === 'error');
  assert.match(full.message, /full/);
  third.close();

  // Non-host can't use host controls.
  guest.send({ t: 'restart' });
  assert.match((await guest.waitFor((m) => m.t === 'error')).message, /Only the host/);

  // Drilling happens.
  await sleep(400);
  const moving = await host.waitFor((m) => m.t === 'world' && m.world.run.depthKm > 0);
  assert.equal(moving.world.status, 'running');

  // Host drops out (closes tab) -> ship pauses for the guest.
  host.close();
  const paused = await guest.waitFor((m) => m.t === 'world' && m.world.pausedReason === 'Waiting for the host');
  const frozenAt = paused.world.run.depthKm;
  await sleep(500);
  assert.equal(game.worlds.get(worldId).run.depthKm, frozenAt);
  guest.close();
  await sleep(100);

  // Server restarts — the ship is still there, at the same depth.
  await game.close();
  game = createGameServer({ dataDir, speed: 20, rng: () => 0.99 });
  port = await game.listen(0);
  assert.equal(game.worlds.get(worldId).run.depthKm, frozenAt);

  // Host comes back with the same identity and is still the host.
  const host2 = await client(port, { name: 'Ada', playerId: host.me.playerId, token: host.me.token });
  assert.equal(host2.me.playerId, host.me.playerId);
  host2.send({ t: 'join', worldId });
  const back = await host2.waitFor((m) => m.t === 'world');
  assert.equal(back.world.hostId, host2.me.playerId);
  assert.equal(back.world.status, 'running');

  // A forged token gets a fresh identity, not the host's.
  const imposter = await client(port, { name: 'Eve', playerId: host.me.playerId, token: 'nope' });
  assert.notEqual(imposter.me.playerId, host.me.playerId);
  imposter.close();

  // End run early & restart.
  host2.send({ t: 'restart' });
  const r2 = await host2.waitFor((m) => m.t === 'world' && m.world.run.number === 2);
  assert.equal(r2.world.history[0].status, 'abandoned');

  // Leave as is: everyone is sent to the lobby, ship stays saved.
  const guest2 = await client(port, { name: 'Bo', playerId: guest.me.playerId, token: guest.me.token });
  guest2.send({ t: 'join', worldId });
  await guest2.waitFor((m) => m.t === 'world');
  host2.send({ t: 'shelve' });
  assert.match((await guest2.waitFor((m) => m.t === 'left')).reason, /shelved/);
  await host2.waitFor((m) => m.t === 'left');
  assert.ok(game.worlds.has(worldId));
  assert.ok(existsSync(join(dataDir, 'worlds', `${worldId}.json`)));

  // Exit & destroy: save is gone.
  host2.send({ t: 'join', worldId });
  await host2.waitFor((m) => m.t === 'world');
  host2.send({ t: 'destroy' });
  await host2.waitFor((m) => m.t === 'left');
  assert.ok(!game.worlds.has(worldId));
  assert.ok(!existsSync(join(dataDir, 'worlds', `${worldId}.json`)));

  host2.close(); guest2.close();
  await game.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test('serves under a /dig prefix (proxy passes or strips it)', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'doigo-'));
  const game = createGameServer({ dataDir, basePath: '/dig' });
  const port = await game.listen(0);
  const base = `http://localhost:${port}`;

  const redirect = await fetch(`${base}/dig`, { redirect: 'manual' });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/dig/');
  for (const path of ['/dig/', '/dig/main.js', '/dig/shared/constants.js', '/dig/api/health', '/', '/main.js']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }

  for (const wsPath of ['/dig/ws', '/ws']) {
    const ws = new WebSocket(`ws://localhost:${port}${wsPath}`);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    ws.send(JSON.stringify({ t: 'hello', name: 'P' }));
    const m = await new Promise((r) => { ws.onmessage = (e) => r(JSON.parse(e.data)); });
    assert.equal(m.t, 'welcome');
    ws.close();
  }
  await game.close();
  rmSync(dataDir, { recursive: true, force: true });
});
