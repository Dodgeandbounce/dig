// End-to-end: real server, real WebSockets (Node 22's built-in client).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameServer } from '../server/game-server.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const open = new Set(); // sockets to close even if a test fails
async function client(port, hello) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  open.add(ws);
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

test('lobby, drop-in/out, host controls and persistence', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'doigo-'));
  let game = createGameServer({ dataDir, speed: 20, rng: () => 0.99 });
  t.after(async () => { for (const ws of open) ws.close(); open.clear(); await game.close().catch(() => {}); });
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
  // Boarding sends the full game (state + map); the guest takes over a crew member of their own.
  const first = await guest.waitFor((m) => m.t === 'g' && m.grid);
  assert.ok(first.s.crew.length >= 2 && first.s.roster.length > 0);
  const guestCrew = first.seats[guest.me.playerId];
  assert.ok(guestCrew != null && guestCrew !== first.seats[host.me.playerId]);

  // Ship is full at 2.
  const third = await client(port, { name: 'Cy' });
  third.send({ t: 'join', worldId });
  const full = await third.waitFor((m) => m.t === 'error');
  assert.match(full.message, /full/);
  third.close();

  // Non-host can't use host controls.
  guest.send({ t: 'restart' });
  assert.match((await guest.waitFor((m) => m.t === 'error')).message, /Only the host/);

  // The game runs on the server and streams to everyone aboard.
  await sleep(400);
  const later = await host.waitFor((m) => m.t === 'g' && m.s.time > 0.3);
  assert.equal(later.s.roster, undefined);                                    // static parts aren't resent
  assert.equal(game.worlds.get(worldId).status, 'running');
  assert.ok(game.worlds.get(worldId).run.elapsedMs > 0);

  // Controls and UI commands reach the game.
  guest.send({ t: 'in', i: { mx: 1, my: 0, ax: 0, ay: 0, pressed: {} } });
  guest.send({ t: 'cmd', c: { t: 'pause', on: true } });
  assert.match((await guest.waitFor((m) => m.t === 'error')).message, /Unknown command/);
  guest.send({ t: 'chat', text: 'hi crew' });
  await guest.waitFor((m) => m.t === 'g' && m.fx.some((e) => e.t === 'log' && e.kind === 'chat' && e.text.includes('hi crew')));

  // Host drops out (closes tab) -> ship pauses for the guest, and a bot takes over the host's crew member.
  host.close();
  await guest.waitFor((m) => m.t === 'world' && m.world.pausedReason === 'Waiting for the host');
  const w = game.worlds.get(worldId);
  const frozenAt = w.game.time;
  assert.equal(w.crewOf(host.me.playerId).human, false);
  await sleep(500);
  assert.equal(w.game.time, frozenAt);
  guest.close();
  await sleep(100);

  // Server restarts — the ship is still there, mid-run, at the same moment.
  await game.close();
  game = createGameServer({ dataDir, speed: 20, rng: () => 0.99 });
  port = await game.listen(0);
  assert.ok(existsSync(join(dataDir, 'worlds', `${worldId}.game`)));
  assert.equal(game.worlds.get(worldId).game.time, frozenAt);

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
  assert.ok(!existsSync(join(dataDir, 'worlds', `${worldId}.game`)));

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

test('the leaderboard: solo runs are posted, online runs are recorded when they end, and it survives a restart', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'doigo-lb-'));
  let game = createGameServer({ dataDir, speed: 20, rng: () => 0.5 });
  t.after(async () => { for (const ws of open) ws.close(); open.clear(); await game.close().catch(() => {}); rmSync(dataDir, { recursive: true, force: true }); });
  const port = await game.listen(0);
  const solo = await client(port, { name: 'Cy' });
  solo.send({ t: 'score', entry: { ship: 'The Mole Hole', score: 4321, depthKm: 1548, level: 8, result: 'lost at -1548km', crew: [{ name: 'Zap', cls: 'pilot', player: 'Cy', stars: 9 }], stats: { kills: 40 }, evil: '<script>' } });
  await sleep(100);
  let board = await (await fetch(`http://localhost:${port}/api/leaderboard`)).json();
  assert.equal(board.length, 1);
  assert.equal(board[0].ship, 'The Mole Hole');
  assert.equal(board[0].score, 4321);
  assert.deepEqual(board[0].players, ['Cy']);
  assert.equal(board[0].evil, undefined, 'only known fields are kept');
  // an online run ends: it goes on the board too
  solo.send({ t: 'create', name: 'Deep Ones', maxPlayers: 2 });
  await solo.waitFor((m) => m.t === 'world');
  const w = [...game.worlds.values()][0];
  w.game.ship.hull = 0; w.tick(50);
  await sleep(50);
  board = await (await fetch(`http://localhost:${port}/api/leaderboard`)).json();
  assert.ok(board.some((e) => e.ship === 'Deep Ones' && e.online), JSON.stringify(board.map((e) => e.ship)));
  // saved to disk
  game.saveAll(true);
  await game.close();
  game = createGameServer({ dataDir, speed: 20, rng: () => 0.5 });
  const port2 = await game.listen(0);
  board = await (await fetch(`http://localhost:${port2}/api/leaderboard`)).json();
  assert.equal(board.length, 2);
});

test('a ship that won leaves the lobby once everyone has left the island', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'doigo-'));
  const game = createGameServer({ dataDir, speed: 20, rng: () => 0.5 });
  t.after(async () => { for (const ws of open) ws.close(); open.clear(); await game.close().catch(() => {}); rmSync(dataDir, { recursive: true, force: true }); });
  const port = await game.listen(0);
  const a = await client(port, { name: 'Winner' });
  a.send({ t: 'create', name: 'Done Ship', maxPlayers: 2 });
  await a.waitFor((m) => m.t === 'world');
  const w = [...game.worlds.values()][0];
  w.run.status = 'won';
  assert.equal(game.worlds.size, 1, 'still there while someone is aboard');
  a.send({ t: 'leave' });
  const lobby = await a.waitFor((m) => m.t === 'lobby' && !m.worlds.some((x) => x.id === w.id), 4000);
  assert.ok(lobby);
  assert.equal(game.worlds.size, 0);
});
