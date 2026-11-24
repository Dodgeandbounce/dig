// A World is one saved online ship: its name, host, crew roster (players), and the running Game.
// The Game (shared/sim) is the same simulation as solo play; here every player controls one crew
// member and bots play the rest. Only the host's presence (or the host's say-so) lets it tick.
import { randomUUID } from 'node:crypto';
import { MIN_PLAYERS, MAX_PLAYERS, RUN_STATUS, WORLD_STATUS } from '../shared/constants.js';
import { Game, COMMANDS } from '../shared/sim/game.js';
import { CLASSES } from '../shared/sim/data.js';
import { encodeState, encodeGrid, packState } from '../shared/sim/netcode.js';
import { serializeGame, deserializeGame } from './persist.js';

const LOG_LIMIT = 40;
const HISTORY_LIMIT = 50;
const STEP = 1 / 30;
const FX_LIMIT = 400;
const ONLINE_STARTERS = ['pilot', 'engineer'];
// Commands a player may send. 'pause' is solo-only: one player can't freeze everyone.
const BLOCKED = new Set(['pause']);
const PRESS_KEYS = ['q', 'f', 'e', 'space', 'rmb'];

function newRun(number) {
  return {
    number, status: RUN_STATUS.ACTIVE, level: 1, depthKm: 0, hull: 100, phase: 'briefing',
    elapsedMs: 0, startedAt: Date.now(), endedAt: null,
  };
}

export class World {
  /**
   * @param {object} data persisted shape (see toJSON)
   * @param {{speed?: number, rng?: () => number, gameData?: Buffer|null}} opts
   */
  constructor(data, { speed = 1, rng = Math.random, gameData = null, onRunEnd = null } = {}) {
    Object.assign(this, data);
    this.onRunEnd = onRunEnd;            // (world, summary) when a run is won, lost or abandoned (for the leaderboard)
    this.seats ||= {};                   // playerId -> crew id in the Game
    this.starter ||= 'pilot';
    this.run = { ...newRun(this.run?.number || 1), ...this.run };
    this.speed = speed;
    this.rng = rng;
    this.online = new Set();             // playerIds aboard right now (runtime only)
    this.dirty = false;
    this.gameDirty = false;
    this.acc = 0;
    this.fx = [];                        // effects since the last broadcast
    this.base = null;                    // what every client's grid looks like (for diffs)
    this.sent = new Map();               // top-level state parts as last broadcast (key -> JSON)
    this.game = null;
    if (gameData) {
      try { this.game = deserializeGame(gameData); }
      catch (err) { console.error(`[world ${this.id}] could not restore the game, starting a fresh run:`, err.message); }
    }
    if (!this.game) this.game = this.#newGame();
  }

  static create({ name, hostId, hostName, maxPlayers, allowPlayWithoutHost, playerClass }, opts) {
    const now = Date.now();
    const world = new World({
      id: randomUUID().slice(0, 8),
      name: String(name || 'Unnamed Drill').slice(0, 40),
      hostId,
      maxPlayers: clamp(Number(maxPlayers) || 4, MIN_PLAYERS, MAX_PLAYERS),
      allowPlayWithoutHost: Boolean(allowPlayWithoutHost),
      starter: ONLINE_STARTERS.includes(playerClass) ? playerClass : 'pilot',
      createdAt: now,
      lastPlayedAt: now,
      members: {},
      seats: {},
      run: newRun(1),
      history: [],
      log: [],
    }, opts);
    world.addMember(hostId, hostName);
    world.event('system', `${hostName} commissioned the ship.`);
    return world;
  }

  #reportRun() {
    try { this.onRunEnd?.(this, this.game.runSummary()); } catch (err) { console.error(`[world ${this.id}] leaderboard:`, err.message); }
  }

  toJSON() {
    const { id, name, hostId, maxPlayers, allowPlayWithoutHost, starter, createdAt,
      lastPlayedAt, members, seats, run, history, log } = this;
    return { id, name, hostId, maxPlayers, allowPlayWithoutHost, starter, createdAt,
      lastPlayedAt, members, seats, run, history, log };
  }

  saveGame() { this.gameDirty = false; return serializeGame(this.game); }

  #newGame() {
    const seed = Math.floor(this.rng() * 2 ** 31);
    const g = new Game({ seed, playerClass: this.starter, shipName: this.name, speed: this.speed });
    for (const c of g.crew) c.human = false;
    this.seats = {};
    this.base = null;
    this.fx = [];
    return g;
  }

  // ---------- crew ----------

  addMember(playerId, name) {
    const m = this.members[playerId];
    if (m) m.name = name;
    else this.members[playerId] = { name, joinedAt: Date.now(), lastSeenAt: Date.now(), repairs: 0 };
    this.dirty = true;
  }

  isHost(playerId) { return playerId === this.hostId; }
  get hostOnline() { return this.online.has(this.hostId); }
  get isFull() { return this.online.size >= this.maxPlayers; }

  /** Derived lifecycle — never stored, so a reload can't leave a ghost "running" world. */
  get status() { return this.canTick ? WORLD_STATUS.RUNNING : WORLD_STATUS.SUSPENDED; }

  get pausedReason() {
    if (this.run.status !== RUN_STATUS.ACTIVE) return null;
    if (this.online.size === 0) return 'Nobody aboard';
    if (!this.hostOnline && !this.allowPlayWithoutHost) return 'Waiting for the host';
    return null;
  }

  get canTick() {
    if (this.run.status !== RUN_STATUS.ACTIVE || this.online.size === 0) return false;
    return this.hostOnline || this.allowPlayWithoutHost;
  }

  board(playerId, name) {
    this.addMember(playerId, name);
    this.online.add(playerId);
    this.members[playerId].lastSeenAt = Date.now();
    const c = this.#seat(playerId);
    this.event('system', `${name} came aboard${c ? ` as ${c.name} the ${CLASSES[c.cls].name}` : ''}.`);
    if (c) this.game.log('crew', `👋 ${name} takes over ${c.name} the ${CLASSES[c.cls].name}.`);
  }

  disembark(playerId) {
    if (!this.online.delete(playerId)) return;
    const m = this.members[playerId];
    if (m) m.lastSeenAt = Date.now();
    const c = this.crewOf(playerId);
    if (c) { c.human = false; c.bot = {}; c.atHelm = false; c.player = null; this.game.inputs.delete(c.id); }
    this.event('system', `${m?.name ?? 'Someone'} left the ship.`);
    if (c) this.game.log('crew', `${m?.name ?? 'Someone'} stepped away. A bot takes over ${c.name}.`);
    this.gameDirty = true;
  }

  crewOf(playerId) {
    const id = this.seats[playerId];
    return id == null ? null : this.game.crew.find((c) => c.id === id) || null;
  }

  /** Put a player in control of a crew member: their old one, the host's starter class, any bot, or a new engineer. */
  #seat(playerId) {
    const g = this.game;
    const name = this.members[playerId]?.name;
    const reserved = new Set(Object.entries(this.seats).filter(([p]) => p !== playerId && !this.online.has(p)).map(([, id]) => id));
    const free = (c) => !c.human && c.cls !== 'urchid';
    let c = this.crewOf(playerId);
    if (!c || c.human) c = null;
    if (!c && this.isHost(playerId)) c = g.crew.find((x) => free(x) && x.cls === this.starter && !reserved.has(x.id));
    c ||= g.crew.find((x) => free(x) && !reserved.has(x.id)) || g.crew.find(free);
    if (!c) c = g.addCrew('engineer');
    c.human = true; c.bot = {}; c.player = name;
    for (const [p, id] of Object.entries(this.seats)) if (id === c.id && p !== playerId) delete this.seats[p];
    this.seats[playerId] = c.id;
    this.gameDirty = true;
    return c;
  }

  // ---------- simulation ----------

  tick(dtMs) {
    if (!this.canTick) { this.acc = 0; return; }
    const g = this.game;
    this.acc = Math.min(this.acc + dtMs / 1000, STEP * 8);
    while (this.acc >= STEP) {
      const t0 = g.time;
      g.update(STEP);
      this.acc -= STEP;
      // how long each player's latest input has been applied (for prediction in their browser)
      if (g.time > t0) for (const c of g.crew) if (c.human) c.ackT = (c.ackT || 0) + STEP;
      for (const e of g.drainFx()) this.#onFx(e);
    }
    this.run.elapsedMs += dtMs;
    this.lastPlayedAt = Date.now();
    this.#syncRun();
    this.dirty = true;
    this.gameDirty = true;
  }

  #onFx(e) {
    if (e.t === 'switch') {
      for (const [p, id] of Object.entries(this.seats)) if (id === e.from) {
        this.seats[p] = e.to;
        const t = this.game.crew.find((c) => c.id === e.to);
        const old = this.game.crew.find((c) => c.id === e.from);
        if (t) t.player = this.members[p]?.name;
        if (old) old.player = null;
      }
    }
    this.fx.push(e);
    if (this.fx.length > FX_LIMIT) this.fx.splice(0, this.fx.length - FX_LIMIT);
  }

  #syncRun() {
    const g = this.game, run = this.run;
    run.level = g.level;
    run.depthKm = g.depthKm;
    run.hull = Math.max(0, Math.round((100 * g.ship.hull) / g.ship.hullMax));
    run.phase = g.phase;
    if (run.status !== RUN_STATUS.ACTIVE) return;
    if (g.phase === 'gameover') this.#endRun(RUN_STATUS.LOST, `The ship was lost at ${g.depthKm.toLocaleString()} km.`);
    else if (g.phase === 'ending') this.#endRun(RUN_STATUS.WON, g.joe?.state === 'saved' ? 'The crew reached the center of the world, with Joe. 💪🤝💪' : 'The crew reached the center of the world.');
  }

  #endRun(status, message) {
    this.run.status = status;
    this.run.endedAt = Date.now();
    this.run.score = this.game.finalScore();
    this.event('story', message);
    this.#reportRun();
  }

  // ---------- crew actions ----------

  input(playerId, raw) {
    if (!this.online.has(playerId) || !raw || typeof raw !== 'object') return;
    const c = this.crewOf(playerId);
    if (!c?.human) return;
    const num = (v, lim) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);
    const pressed = {};
    if (raw.pressed && typeof raw.pressed === 'object') for (const k of PRESS_KEYS) if (raw.pressed[k]) pressed[k] = true;
    // The last input this crew member got; the player's browser replays anything newer on top of our position.
    if (Number.isSafeInteger(raw.seq)) { c.ack = raw.seq; c.ackT = 0; }
    this.game.setInput(c.id, {
      mx: Math.sign(num(raw.mx, 1)), my: Math.sign(num(raw.my, 1)),
      ax: num(raw.ax, 1e5), ay: num(raw.ay, 1e5),
      fire: !!raw.fire, rmb: !!raw.rmb, e: !!raw.e, shift: !!raw.shift, pressed,
    });
  }

  command(playerId, cmd) {
    if (!this.online.has(playerId) || !cmd || typeof cmd !== 'object' || typeof cmd.t !== 'string') return { error: 'Bad command' };
    if (!Object.hasOwn(COMMANDS, cmd.t) || BLOCKED.has(cmd.t)) return { error: 'Unknown command' };
    if (this.run.status !== RUN_STATUS.ACTIVE) return { error: 'Run is over' };
    const c = this.crewOf(playerId);
    if (!c) return { error: 'Not aboard' };
    this.game.command(c, cmd);
    for (const e of this.game.drainFx()) this.#onFx(e);
    this.gameDirty = true;
    return { ok: true };
  }

  chat(playerId, text) {
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean || !this.online.has(playerId)) return;
    const who = this.members[playerId]?.name;
    this.event('chat', clean, who);
    this.game.log('chat', `${who}: ${clean}`);
    for (const e of this.game.drainFx()) this.#onFx(e);
  }

  // ---------- host-only ----------

  /** End the current run (early or after win/loss) and start a fresh one. Crew stays. */
  restartRun() {
    const old = this.run;
    if (old.status === RUN_STATUS.ACTIVE) { old.status = 'abandoned'; old.endedAt = Date.now(); if (this.game.level >= 3) this.#reportRun(); }
    this.history.unshift({ number: old.number, status: old.status, depthKm: Math.round(old.depthKm), level: old.level, score: old.score, endedAt: old.endedAt });
    this.history.length = Math.min(this.history.length, HISTORY_LIMIT);
    this.run = newRun(old.number + 1);
    this.game = this.#newGame();
    const order = [...this.online].sort((a, b) => (this.isHost(b) ? 1 : 0) - (this.isHost(a) ? 1 : 0));
    for (const p of order) this.#seat(p);
    this.event('story', `Run #${this.run.number} begins. The drill spins up…`);
  }

  // ---------- network frames ----------

  /** One game frame for everyone aboard (the same string goes to every connection). */
  frame() {
    const g = this.game;
    const state = encodeState(g);
    const msg = { t: 'g', s: state, seats: this.seats, fx: this.fx.splice(0) };
    const base = this.base;
    let full = !base || base.game !== g;
    if (!full) {
      const d = diffGrid(base, g.grid);
      if (d.tiles.length + d.room.length + d.doorAt.length > 9000) full = true; // a whole new layout: cheaper to resend
      else {
        msg.keep = packState(state, this.sent);
        if (d.tiles.length) msg.d = d.tiles;
        if (d.room.length) msg.dr = d.room;
        if (d.doorAt.length) msg.dd = d.doorAt;
        msg.v = base.version = g.grid.version;
      }
    }
    if (full) {
      this.base = makeBase(g);
      msg.grid = encodeGrid(this.base);
      this.sent = new Map();
      packState({ ...state }, this.sent); // remember it all; this frame carries everything
    }
    return JSON.stringify(msg);
  }

  /**
   * Everything a player needs to start drawing: the full state and the grid every other client has.
   */
  joinFrame() {
    if (!this.base || this.base.game !== this.game) this.base = makeBase(this.game);
    this.sent = new Map(); // so the next broadcast is complete and everyone shares one baseline again
    const state = encodeState(this.game);
    return JSON.stringify({ t: 'g', s: state, seats: this.seats, fx: [], grid: encodeGrid(this.base), join: true });
  }

  // ---------- views ----------

  event(kind, text, who) {
    this.log.push({ at: Date.now(), kind, text, who });
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
    this.dirty = true;
  }

  summary() {
    return {
      id: this.id,
      name: this.name,
      hostId: this.hostId,
      hostName: this.members[this.hostId]?.name ?? '?',
      hostOnline: this.hostOnline,
      online: this.online.size,
      crew: Object.keys(this.members).length,
      maxPlayers: this.maxPlayers,
      allowPlayWithoutHost: this.allowPlayWithoutHost,
      status: this.status,
      pausedReason: this.pausedReason,
      run: {
        number: this.run.number, status: this.run.status, level: this.run.level, phase: this.run.phase,
        depthKm: Math.round(this.run.depthKm), hull: Math.round(this.run.hull),
      },
      lastPlayedAt: this.lastPlayedAt,
    };
  }

  snapshot() {
    return {
      ...this.summary(),
      run: { ...this.run },
      members: Object.entries(this.members).map(([id, m]) => ({
        id, name: m.name, repairs: m.repairs, online: this.online.has(id), host: id === this.hostId,
        crewId: this.seats[id] ?? null,
      })),
      history: this.history.slice(0, 10),
      log: this.log,
    };
  }
}

// The grid as every client currently has it. Diffs are taken against this, then it is updated.
function makeBase(g) {
  const gr = g.grid;
  const hp = new Uint16Array(gr.hp.length);
  for (let i = 0; i < hp.length; i++) hp[i] = Math.max(0, Math.min(65535, Math.round(gr.hp[i])));
  return { game: g, version: gr.version, tiles: gr.tiles.slice(), hp, room: gr.room.slice(), doorAt: gr.doorAt.slice() };
}

/**
 * What changed since the base (which is then updated to match):
 * tiles: [index, tile, hp, ...]   room / doorAt: [index, value, ...]
 */
function diffGrid(base, gr) {
  const out = { tiles: [], room: [], doorAt: [] };
  const { tiles, hp, room, doorAt } = base;
  for (let i = 0; i < tiles.length; i++) {
    const t = gr.tiles[i];
    const h = Math.max(0, Math.min(65535, Math.round(gr.hp[i])));
    if (t !== tiles[i] || h !== hp[i]) { out.tiles.push(i, t, h); tiles[i] = t; hp[i] = h; }
    if (gr.room[i] !== room[i]) { out.room.push(i, gr.room[i]); room[i] = gr.room[i]; }
    if (gr.doorAt[i] !== doorAt[i]) { out.doorAt.push(i, gr.doorAt[i]); doorAt[i] = gr.doorAt[i]; }
  }
  return out;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(n))); }
