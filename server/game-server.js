// Wires together: HTTP static files, the WebSocket protocol, the lobby, and saved worlds.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocket } from './ws.js';
import { Store } from './store.js';
import { World } from './world.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIRS = { '/shared/': join(ROOT, 'shared'), '/': join(ROOT, 'client') };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const TICK_MS = 33;          // simulation (fixed 1/30 s steps inside World.tick)
const FRAME_MS = 100;        // game snapshots to players aboard
const IDLE_FRAME_MS = 1000;  // ...while the ship is paused (waiting for the host)
const META_MS = 500;         // ship info (crew list, host, run) when it changes
const LOBBY_MS = 1000;
const SAVE_MS = 2000;        // ship info
const GAME_SAVE_MS = 10000;  // the running game (bigger)
const BACKLOG_LIMIT = 512 * 1024; // skip frames for a connection that can't keep up

const hashToken = (t) => createHash('sha256').update(t).digest('hex');

/**
 * @param basePath URL prefix the game lives under, e.g. "/dig". Requests are
 *   accepted both with the prefix (proxy passes it through) and without it
 *   (proxy strips it), so either reverse-proxy style works.
 */
export function createGameServer({ dataDir = join(ROOT, 'data'), speed = 1, rng, basePath = '' } = {}) {
  basePath = basePath.replace(/\/+$/, '');
  if (basePath && !basePath.startsWith('/')) basePath = '/' + basePath;
  const store = new Store(dataDir);
  // the leaderboard: every finished run, best scores first
  const board = store.loadBoard();
  let boardDirty = false;
  const BOARD_MAX = 300;
  function record(entry) {
    const e = cleanEntry(entry);
    if (!e) return;
    board.push(e);
    board.sort((a, b) => b.score - a.score);
    board.length = Math.min(board.length, BOARD_MAX);
    boardDirty = true;
  }
  const worldOpts = { speed, rng, onRunEnd: (world, summary) => record({ ...summary, online: true, shipId: world.id, run: world.run.number,
    host: world.members[world.hostId]?.name, players: Object.values(world.members).map((m) => m.name) }) };
  const players = store.loadPlayers();           // id -> { name, tokenHash, createdAt }
  const worlds = new Map();                      // id -> World
  for (const data of store.loadWorlds()) {
    try { worlds.set(data.id, new World(data, { ...worldOpts, gameData: store.loadGame(data.id) })); }
    catch (err) { console.error(`[server] skipping ship ${data.id}:`, err); }
  }
  const conns = new Set();                       // live connections
  let playersDirty = false;
  let lastLobbyJson = '';

  // ---------- helpers ----------
  const lobbyList = () => [...worlds.values()]
    .map((w) => w.summary())
    .sort((a, b) => (b.online - a.online) || (b.lastPlayedAt - a.lastPlayedAt));

  const connsIn = (worldId) => [...conns].filter((c) => c.worldId === worldId);

  function sendLobby(conn) { conn.socket.send({ t: 'lobby', worlds: lobbyList() }); }

  function broadcastLobby(force = false) {
    const list = lobbyList();
    const json = JSON.stringify(list);
    if (!force && json === lastLobbyJson) return;
    lastLobbyJson = json;
    for (const c of conns) if (c.playerId && !c.worldId) c.socket.send({ t: 'lobby', worlds: list });
  }

  function broadcastWorld(world) {
    const json = JSON.stringify({ t: 'world', world: world.snapshot() });
    world.lastMeta = metaKey(world);
    for (const c of connsIn(world.id)) c.socket.send(json);
  }
  // The meta snapshot minus the parts that change every tick, to decide when to resend it.
  const metaKey = (w) => JSON.stringify([w.summary(), w.log.length, w.log.at(-1)?.at, w.seats, w.history.length]);

  function broadcastFrame(world) {
    const targets = connsIn(world.id);
    if (!targets.length) return;
    const frame = world.frame();
    for (const c of targets) if (c.synced && c.socket.buffered < BACKLOG_LIMIT) c.socket.send(frame);
  }

  function save(world) { store.saveWorld(world.toJSON()); world.dirty = false; }
  function saveGame(world) {
    try { store.saveGame(world.id, world.saveGame()); }
    catch (err) { console.error(`[server] could not save the game for ${world.id}:`, err.message); }
  }

  /** Send everyone aboard back to the lobby. */
  function evacuate(world, reason) {
    for (const c of connsIn(world.id)) {
      world.disembark(c.playerId);
      c.worldId = null;
      c.synced = false;
      c.socket.send({ t: 'left', reason });
      sendLobby(c);
    }
  }

  function leaveWorld(conn, reason) {
    const world = worlds.get(conn.worldId);
    conn.worldId = null;
    conn.synced = false;
    if (!world) return;
    world.disembark(conn.playerId);
    save(world);
    saveGame(world);
    broadcastWorld(world);
    if (reason) conn.socket.send({ t: 'left', reason });
    broadcastLobby(true);
  }

  function requireHost(conn) {
    const world = worlds.get(conn.worldId);
    if (!world) return conn.socket.send({ t: 'error', message: 'Not on a ship' });
    if (!world.isHost(conn.playerId)) return conn.socket.send({ t: 'error', message: 'Only the host can do that' });
    return world;
  }

  // ---------- protocol ----------
  const handlers = {
    hello(conn, msg) {
      const name = String(msg.name || '').trim().slice(0, 24) || 'Digger';
      let id = msg.playerId;
      let token = msg.token;
      const known = id && players[id] && token && players[id].tokenHash === hashToken(token);
      if (!known) {
        id = randomUUID();
        token = randomBytes(24).toString('base64url');
        players[id] = { name, tokenHash: hashToken(token), createdAt: Date.now() };
      }
      players[id].name = name;
      playersDirty = true;
      conn.playerId = id;
      conn.name = name;
      conn.socket.send({ t: 'welcome', playerId: id, token, name });
      sendLobby(conn);
    },

    create(conn, msg) {
      if (conn.worldId) leaveWorld(conn);
      const world = World.create({
        name: msg.name, hostId: conn.playerId, hostName: conn.name,
        maxPlayers: msg.maxPlayers, allowPlayWithoutHost: msg.allowPlayWithoutHost,
        playerClass: msg.playerClass,
      }, worldOpts);
      worlds.set(world.id, world);
      handlers.join(conn, { worldId: world.id });
    },

    join(conn, msg) {
      const world = worlds.get(msg.worldId);
      if (!world) return conn.socket.send({ t: 'error', message: 'That ship no longer exists' });
      if (conn.worldId === world.id) { broadcastWorld(world); sync(conn, world); return; }
      // Same player in another tab? The newest connection wins.
      for (const other of connsIn(world.id)) {
        if (other.playerId === conn.playerId) { leaveWorld(other, 'You joined from another window'); sendLobby(other); }
      }
      if (world.isFull) return conn.socket.send({ t: 'error', message: `Ship is full (${world.maxPlayers} max)` });
      if (conn.worldId) leaveWorld(conn);
      conn.worldId = world.id;
      world.board(conn.playerId, conn.name);
      save(world);
      broadcastWorld(world);
      sync(conn, world);
      broadcastLobby(true);
    },

    leave(conn) {
      if (!conn.worldId) return;
      leaveWorld(conn);
      sendLobby(conn);
    },

    // Controls for your crew member, ~20×/s.
    in(conn, msg) { worlds.get(conn.worldId)?.input(conn.playerId, msg.i); },

    // A UI action: route pick, shop, station panel, story button...
    cmd(conn, msg) {
      const world = worlds.get(conn.worldId);
      if (!world) return;
      const r = world.command(conn.playerId, msg.c);
      if (r.error && r.error !== 'Run is over') conn.socket.send({ t: 'error', message: r.error });
    },

    chat(conn, msg) { worlds.get(conn.worldId)?.chat(conn.playerId, msg.text); },

    // A solo run finished in someone's browser: it goes on the shared leaderboard.
    score(conn, msg) {
      const now = Date.now();
      if (now - (conn.lastScoreAt || 0) < 20000) return;   // one per run is plenty
      conn.lastScoreAt = now;
      record({ ...(msg.entry || {}), solo: true, online: false, players: [conn.name], host: conn.name });
    },

    // Host: "End run & restart" — new run, same ship and crew.
    restart(conn) {
      const world = requireHost(conn); if (!world) return;
      world.restartRun();
      save(world);
      saveGame(world);
      broadcastWorld(world);
      for (const c of connsIn(world.id)) sync(c, world);
      broadcastLobby(true);
    },

    // Host: "Leave as is" — save, freeze, send everyone back to the lobby.
    shelve(conn) {
      const world = requireHost(conn); if (!world) return;
      world.event('system', `${conn.name} shelved the ship. It will wait right here.`);
      evacuate(world, 'The host shelved the ship. It is saved in the lobby.');
      save(world);
      saveGame(world);
      broadcastLobby(true);
    },

    // Host: "Exit & destroy ship" — delete the save entirely.
    destroy(conn) {
      const world = requireHost(conn); if (!world) return;
      evacuate(world, 'The host scuttled the ship. It is gone for good.');
      worlds.delete(world.id);
      store.deleteWorld(world.id);
      broadcastLobby(true);
    },
  };

  /** Send a full game frame to one connection; after this it gets the shared diff frames. */
  function sync(conn, world) {
    conn.socket.send(world.joinFrame());
    conn.synced = true;
  }

  function onConnect(socket) {
    const conn = { socket, playerId: null, name: null, worldId: null, synced: false };
    conns.add(conn);
    socket.on('message', (msg) => {
      // heartbeat: the browser pings every 2s, measures the round trip, and reconnects if we go quiet
      if (msg?.t === 'ping') return socket.send({ t: 'pong', c: msg.c });
      const handler = handlers[msg?.t];
      if (!handler) return;
      if (msg.t !== 'hello' && !conn.playerId) return socket.send({ t: 'error', message: 'Say hello first' });
      try { handler(conn, msg); }
      catch (err) { console.error('[handler]', msg.t, err); socket.send({ t: 'error', message: 'Server error' }); }
    });
    // Drop-out: a closed tab is the same as walking off the ship.
    socket.on('close', () => { conns.delete(conn); if (conn.worldId) leaveWorld(conn); });
  }

  /** A ship that won its run is done: once everyone has left the island, it leaves the lobby for good (its score is on the leaderboard). */
  function pruneWon() {
    for (const w of [...worlds.values()]) {
      if (w.run.status !== 'won' || w.online.size) continue;
      worlds.delete(w.id);
      store.deleteWorld(w.id);
      lastLobbyJson = '';
    }
  }
  pruneWon();

  // ---------- loops ----------
  let last = Date.now();
  let idleT = 0;
  const guard = (name, fn) => () => { try { fn(); } catch (err) { console.error(`[${name}]`, err); } };
  const timers = [
    setInterval(guard('tick', () => {
      const now = Date.now(); const dt = now - last; last = now;
      for (const w of worlds.values()) {
        try { w.tick(dt); }
        catch (err) { console.error(`[tick ${w.id}]`, err); }
      }
    }), TICK_MS),
    setInterval(guard('frames', () => {
      idleT += FRAME_MS;
      const idle = idleT >= IDLE_FRAME_MS;
      if (idle) idleT = 0;
      for (const w of worlds.values()) if (w.online.size && (w.canTick || idle)) broadcastFrame(w);
    }), FRAME_MS),
    setInterval(guard('meta', () => {
      for (const w of worlds.values()) if (w.online.size && metaKey(w) !== w.lastMeta) broadcastWorld(w);
    }), META_MS),
    setInterval(guard('lobby', () => { pruneWon(); broadcastLobby(); }), LOBBY_MS),
    // a connection that has said nothing (not even a heartbeat) for 30s is dead: free its seat
    setInterval(guard('heartbeat', () => { const now = Date.now(); for (const c of conns) if (now - (c.socket.lastSeen || now) > 30000) c.socket.close(1001, 'timeout'); }), 5000),
    setInterval(guard('save', () => saveAll()), SAVE_MS),
    setInterval(guard('save-games', () => { for (const w of worlds.values()) if (w.gameDirty) saveGame(w); }), GAME_SAVE_MS),
  ];

  function saveAll(games = false) {
    for (const w of worlds.values()) {
      if (w.dirty) save(w);
      if (games && w.gameDirty) saveGame(w);
    }
    if (playersDirty) { store.savePlayers(players); playersDirty = false; }
    if (boardDirty) { store.saveBoard(board); boardDirty = false; }
  }

  // ---------- http ----------
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (basePath && url.pathname === basePath) {
      // "/dig" -> "/dig/" so the page's relative URLs resolve under the prefix.
      res.writeHead(301, { location: basePath + '/' + url.search }); return res.end();
    }
    if (basePath && url.pathname.startsWith(basePath + '/')) url.pathname = url.pathname.slice(basePath.length);
    if (url.pathname === '/api/health') return json(res, { ok: true, worlds: worlds.size, connections: conns.size });
    if (url.pathname === '/api/worlds') return json(res, lobbyList());
    if (url.pathname === '/api/leaderboard') return json(res, board.slice(0, 50));
    const prefix = url.pathname.startsWith('/shared/') ? '/shared/' : '/';
    const base = STATIC_DIRS[prefix];
    let rel = url.pathname.slice(prefix.length) || 'index.html';
    const file = normalize(join(base, rel));
    if (!file.startsWith(base)) { res.writeHead(403); return res.end(); }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  attachWebSocket(server, ['/ws', basePath + '/ws'], onConnect);

  return {
    server,
    worlds,
    listen(port, host) { return new Promise((r) => server.listen(port, host, () => r(server.address().port))); },
    async close() {
      timers.forEach(clearInterval);
      for (const w of worlds.values()) for (const p of [...w.online]) w.disembark(p);
      saveAll(true);
      for (const c of conns) c.socket.close(1001, 'server shutting down');
      await new Promise((r) => server.close(r));
    },
    saveAll,
  };
}

/** Only what the leaderboard shows, sized and typed (solo entries come from browsers). */
function cleanEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const str = (v, n = 40) => String(v ?? '').slice(0, n);
  const num = (v, max = 1e9) => (Number.isFinite(+v) ? Math.max(0, Math.min(max, Math.round(+v))) : 0);
  const out = {
    ship: str(e.ship) || 'Unnamed ship', score: num(e.score), depthKm: num(e.depthKm, 7000), level: num(e.level, 99),
    result: str(e.result, 60), won: !!e.won, joe: str(e.joe, 16), path: e.path ? str(e.path, 12) : null, time: num(e.time, 1e7),
    solo: !!e.solo, online: !!e.online, host: str(e.host, 24), run: num(e.run, 1e6), at: Date.now(),
    players: Array.isArray(e.players) ? e.players.slice(0, 17).map((p) => str(p, 24)) : [],
    stats: {}, upgrades: {}, guns: Array.isArray(e.guns) ? e.guns.slice(0, 8).map((x) => str(x, 12)) : [], rooms: num(e.rooms, 99),
    crew: Array.isArray(e.crew) ? e.crew.slice(0, 20).map((c) => ({ name: str(c?.name, 16), cls: str(c?.cls, 14), player: c?.player ? str(c.player, 24) : null, stars: num(c?.stars, 30), kills: num(c?.kills, 1e6) })) : [],
  };
  for (const k of ['kills', 'gems', 'repairs', 'captures', 'insults', 'cleaned', 'meals']) out.stats[k] = num(e.stats?.[k]);
  for (const k of ['plating', 'bubble', 'dgun', 'dmissile', 'drill', 'feeders', 'tank']) out.upgrades[k] = num(e.upgrades?.[k], 20);
  return out;
}

function json(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
