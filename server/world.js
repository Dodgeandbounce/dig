// A World is one saved game ("room"): a ship, its crew roster, and the current run.
// Everything here except `online` / cooldowns is persisted to disk.
import { randomUUID } from 'node:crypto';
import {
  EARTH_CENTER_KM, HULL_MAX, REPAIR_AMOUNT, REPAIR_COOLDOWN_MS,
  MIN_PLAYERS, MAX_PLAYERS, RUN_STATUS, WORLD_STATUS, layerAt,
} from '../shared/constants.js';

const LOG_LIMIT = 40;
const HISTORY_LIMIT = 50;
const AVG_HIT = 6; // average damage of a single hazard hit

function newRun(number) {
  return {
    number,
    status: RUN_STATUS.ACTIVE,
    depthKm: 0,
    hull: HULL_MAX,
    elapsedMs: 0,
    startedAt: Date.now(),
    endedAt: null,
  };
}

export class World {
  /** @param {object} data persisted shape (see toJSON) */
  constructor(data, { speed = 1, drillKmPerSec = 1.5, rng = Math.random } = {}) {
    Object.assign(this, data);
    this.speed = speed;
    this.drillKmPerSec = drillKmPerSec;
    this.rng = rng;
    this.online = new Set();      // playerIds currently aboard (runtime only)
    this.lastRepair = new Map();  // playerId -> ms timestamp (runtime only)
    this.dirty = false;
  }

  static create({ name, hostId, hostName, maxPlayers, allowPlayWithoutHost }, opts) {
    const now = Date.now();
    const world = new World({
      id: randomUUID().slice(0, 8),
      name: String(name || 'Unnamed Drill').slice(0, 40),
      hostId,
      maxPlayers: clamp(Number(maxPlayers) || 4, MIN_PLAYERS, MAX_PLAYERS),
      allowPlayWithoutHost: Boolean(allowPlayWithoutHost),
      createdAt: now,
      lastPlayedAt: now,
      members: {},
      run: newRun(1),
      history: [],
      log: [],
    }, opts);
    world.addMember(hostId, hostName);
    world.event('system', `${hostName} commissioned the ship.`);
    return world;
  }

  toJSON() {
    const { id, name, hostId, maxPlayers, allowPlayWithoutHost, createdAt,
      lastPlayedAt, members, run, history, log } = this;
    return { id, name, hostId, maxPlayers, allowPlayWithoutHost, createdAt,
      lastPlayedAt, members, run, history, log };
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
    this.event('system', `${name} came aboard.`);
  }

  disembark(playerId) {
    if (!this.online.delete(playerId)) return;
    const m = this.members[playerId];
    if (m) m.lastSeenAt = Date.now();
    this.event('system', `${m?.name ?? 'Someone'} left the ship.`);
  }

  // ---------- simulation ----------

  tick(dtMs) {
    if (!this.canTick) return;
    const dt = dtMs / 1000;
    const run = this.run;
    run.elapsedMs += dtMs;
    this.lastPlayedAt = Date.now();

    // `speed` (DIG_SPEED) only fast-forwards travel, so dev runs keep real combat pacing.
    const before = layerAt(run.depthKm);
    run.depthKm = Math.min(EARTH_CENTER_KM, run.depthKm + this.drillKmPerSec * this.speed * dt);
    const layer = layerAt(run.depthKm);
    if (layer.id !== before.id) this.event('story', `Breaking through into ${layer.name}…`);

    // Hazards: Poisson-ish hits whose expected damage/sec equals layer.hazard.
    if (this.rng() < (layer.hazard * dt) / AVG_HIT) {
      const dmg = Math.round(AVG_HIT * (0.5 + this.rng()));
      run.hull = Math.max(0, run.hull - dmg);
      this.event('hazard', `${hazardName(layer.id, this.rng)} hits the hull! −${dmg}`);
    }

    if (run.hull <= 0) this.#endRun(RUN_STATUS.LOST, 'The hull gave way. The ship is lost.');
    else if (run.depthKm >= EARTH_CENTER_KM) this.#endRun(RUN_STATUS.WON, 'You reached the center of the earth. The treasure is yours!');
    this.dirty = true;
  }

  #endRun(status, message) {
    this.run.status = status;
    this.run.endedAt = Date.now();
    this.event('story', message);
  }

  // ---------- crew actions ----------

  repair(playerId) {
    if (!this.online.has(playerId)) return { error: 'Not aboard' };
    if (!this.canTick) return { error: this.pausedReason || 'Run is over' };
    const now = Date.now();
    if (now - (this.lastRepair.get(playerId) || 0) < REPAIR_COOLDOWN_MS) return { error: 'Cooldown' };
    this.lastRepair.set(playerId, now);
    this.run.hull = Math.min(HULL_MAX, this.run.hull + REPAIR_AMOUNT);
    this.members[playerId].repairs++;
    this.dirty = true;
    return { ok: true };
  }

  chat(playerId, text) {
    const clean = String(text || '').trim().slice(0, 200);
    if (!clean || !this.online.has(playerId)) return;
    this.event('chat', clean, this.members[playerId]?.name);
  }

  // ---------- host-only ----------

  /** End the current run (early or after win/loss) and start a fresh one. Crew stays. */
  restartRun() {
    const old = this.run;
    if (old.status === RUN_STATUS.ACTIVE) { old.status = 'abandoned'; old.endedAt = Date.now(); }
    this.history.unshift({ number: old.number, status: old.status, depthKm: Math.round(old.depthKm), endedAt: old.endedAt });
    this.history.length = Math.min(this.history.length, HISTORY_LIMIT);
    this.run = newRun(old.number + 1);
    this.event('story', `Run #${this.run.number} begins. The drill spins up…`);
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
      run: { number: this.run.number, status: this.run.status, depthKm: Math.round(this.run.depthKm), hull: Math.round(this.run.hull) },
      lastPlayedAt: this.lastPlayedAt,
    };
  }

  snapshot() {
    return {
      ...this.summary(),
      run: { ...this.run, layer: layerAt(this.run.depthKm).id },
      members: Object.entries(this.members).map(([id, m]) => ({
        id, name: m.name, repairs: m.repairs, online: this.online.has(id), host: id === this.hostId,
      })),
      history: this.history.slice(0, 10),
      log: this.log,
    };
  }
}

const HAZARDS = {
  'crust': ['A cave-in', 'A burrowing worm', 'A gas pocket'],
  'upper': ['A magma pocket', 'A rock golem', 'Pressure shear'],
  'lower': ['A diamond storm', 'A mantle wyrm', 'A pressure wave'],
  'outer-core': ['A liquid-iron surge', 'A magnetic eddy', 'A core leviathan'],
  'inner-core': ['A crystal lance', 'The Guardian', 'A heat spike'],
};
function hazardName(layerId, rng) {
  const list = HAZARDS[layerId];
  return list[Math.floor(rng() * list.length)];
}
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(n))); }
