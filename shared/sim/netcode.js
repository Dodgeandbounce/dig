// Online play: the server runs the Game and sends snapshots; the browser turns each one back into
// a Game-shaped object (same prototype, same fields) so the renderer and UI draw it unchanged.
//
// Wire format (JSON):
//   state  — every own field of the Game except the ones in SKIP_TOP, with
//            Sets as {$set:[...]}, Maps as {$map:[[k,v],...]}, floats rounded,
//            and nested references to crew/mobs/projectiles/pickups/objects as {$ref:id}.
//   grid   — tiles / hp / room / doorAt as base64, only when it changed.
import { Game } from './game.js';
import { Grid } from './grid.js';

// Server-only or recomputable state that never goes over the wire.
const SKIP_TOP = new Set(['rng', 'grid', 'fields', 'fieldCache', 'fieldsAt', 'inputs', 'fxq', 'logs', 'storyQ',
  'iceUnder', 'panels', 'tips', 'player', 'paused', 'hullTiles']);
// Per-entity internals (bot brains, hit lists, caches) the client never reads.
const SKIP_KEY = new Set(['bot', 'dashHit', 'hit', '_tun', 'recentInsults', 'layout']);
const ENTITY_LISTS = ['crew', 'mobs', 'projs', 'pickups', 'objs'];
const MAX_DEPTH = 10;

// Big numbers (positions, HP, money) don't need more than a tenth; small ones (progress, timers, steering) keep three places.
const round = (v) => (Number.isInteger(v) ? v : !Number.isFinite(v) ? null
  : Math.abs(v) >= 50 ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000);

/**
 * Frame-to-frame compression by top-level key: parts that didn't change since the last frame are
 * listed in `keep` instead of being sent. `last` is the sender's memory (key -> JSON).
 */
export function packState(state, last) {
  const keep = [];
  for (const k of Object.keys(state)) {
    const json = JSON.stringify(state[k]);
    if (last.get(k) === json) { keep.push(k); delete state[k]; }
    else last.set(k, json);
  }
  for (const k of [...last.keys()]) if (!keep.includes(k) && !(k in state)) last.delete(k);
  return keep;
}

/** Client side of packState: put the kept parts back (fresh copies, since decoding mutates). */
export function unpackState(s, keep, cache) {
  for (const k of keep || []) if (cache.has(k)) s[k] = JSON.parse(cache.get(k));
  for (const k of Object.keys(s)) if (!keep?.includes(k)) cache.set(k, JSON.stringify(s[k]));
  for (const k of [...cache.keys()]) if (!(k in s)) cache.delete(k);
  return s;
}

// ---------------------------------------------------------------------------
// encode (server)
export function encodeState(g) {
  const entities = new Set();
  for (const k of ENTITY_LISTS) for (const e of g[k] || []) entities.add(e);
  const stack = [];

  function enc(v, depth, top) {
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === 'number') return round(v);
    if (t === 'string' || t === 'boolean') return v;
    if (t !== 'object') return undefined;                 // functions, symbols, bigints
    if (ArrayBuffer.isView(v)) return undefined;
    if (!top && entities.has(v)) return { $ref: v.id };
    if (depth > MAX_DEPTH || stack.includes(v)) return null;
    stack.push(v);
    let out;
    if (Array.isArray(v)) out = v.map((x) => { const e = enc(x, depth + 1); return e === undefined ? null : e; });
    else if (v instanceof Set) out = { $set: [...v].map((x) => enc(x, depth + 1)) };
    else if (v instanceof Map) out = { $map: [...v].map(([k, x]) => [k, enc(x, depth + 1)]) };
    else {
      out = {};
      for (const k in v) {
        if (SKIP_KEY.has(k)) continue;
        const e = enc(v[k], depth + 1);
        if (e !== undefined) out[k] = e;
      }
    }
    stack.pop();
    return out;
  }

  const out = {};
  for (const k of Object.keys(g)) {
    if (SKIP_TOP.has(k)) continue;
    if (ENTITY_LISTS.includes(k)) { out[k] = (g[k] || []).map((e) => enc(e, 1, true)); continue; }
    const e = enc(g[k], 0);
    if (e !== undefined) out[k] = e;
  }
  // Getter-backed values the UI reads as plain fields are recomputed from these on the client.
  return out;
}

/** Tile HP goes over the wire as whole numbers (Uint16). */
export function encodeGrid(grid) {
  let hp = grid.hp;
  if (!(hp instanceof Uint16Array)) { hp = new Uint16Array(hp.length); for (let i = 0; i < hp.length; i++) hp[i] = Math.max(0, Math.min(65535, Math.round(grid.hp[i]))); }
  return {
    version: grid.version,
    tiles: b64(grid.tiles), hp: b64(hp), room: b64(grid.room), doorAt: b64(grid.doorAt),
  };
}

/** Apply the grid changes in a frame from the server (see diffGrid in server/world.js). */
export function applyGridDiff(grid, msg) {
  const d = msg.d, dr = msg.dr, dd = msg.dd;
  if (d) for (let k = 0; k < d.length; k += 3) { grid.tiles[d[k]] = d[k + 1]; grid.hp[d[k]] = d[k + 2]; }
  if (dr) for (let k = 0; k < dr.length; k += 2) grid.room[dr[k]] = dr[k + 1];
  if (dd) for (let k = 0; k < dd.length; k += 2) grid.doorAt[dd[k]] = dd[k + 1];
  if (msg.v != null) grid.version = msg.v;
}

// ---------------------------------------------------------------------------
// decode (client)
export function decodeGrid(data, into = new Grid()) {
  into.tiles = new Uint8Array(unb64(data.tiles).buffer);
  into.hp = Float32Array.from(new Uint16Array(unb64(data.hp).buffer));
  into.room = new Int16Array(unb64(data.room).buffer);
  into.doorAt = new Int16Array(unb64(data.doorAt).buffer);
  into.version = data.version;
  return into;
}

export function decodeState(raw, grid) {
  const byId = new Map();
  const fixups = [];

  function dec(v, parent, key) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = dec(v[i], v, i); return v; }
    if ('$ref' in v) { fixups.push([parent, key, v.$ref]); return null; }
    if ('$set' in v) return new Set(v.$set.map((x, i) => dec(x, null, i)));
    if ('$map' in v) return new Map(v.$map.map(([k, x]) => [k, dec(x, null, k)]));
    for (const k in v) v[k] = dec(v[k], v, k);
    return v;
  }

  for (const k of ENTITY_LISTS) for (const e of raw[k] || []) if (e && e.id != null) byId.set(e.id, e);
  for (const k in raw) raw[k] = dec(raw[k], raw, k);
  for (const [parent, key, id] of fixups) if (parent) parent[key] = byId.get(id) ?? null;

  const g = Object.setPrototypeOf(raw, Game.prototype);
  g.grid = grid;
  g.fxq = [];
  g.logs = [];
  g.inputs = new Map();
  g.online = true;
  return g;
}

// ---------------------------------------------------------------------------
// base64 that works in Node and in the browser
function b64(view) {
  const u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  if (typeof Buffer !== 'undefined') { const b = Buffer.from(s, 'base64'); const u = new Uint8Array(b.length); u.set(b); return u; }
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
