// The tile world: both ships, the docking tunnel, doors, line of sight and pathfinding.
import { T, TILE, TILE_HP, MAP_W, MAP_H, SLOT_W, SLOT_H, SHIP_OX, SHIP_OY, ROOMS, RING } from './data.js';

export const idx = (x, y) => y * MAP_W + x;
export const inMap = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

const SOLID = new Set([T.VOID, T.WALL, T.HULL, T.BREACH, T.ICE, T.DEBRIS]);
const STRUCT = new Set([T.WALL, T.HULL, T.DOOR, T.ICE, T.DEBRIS]);

export class Grid {
  constructor() {
    this.tiles = new Uint8Array(MAP_W * MAP_H);
    this.hp = new Float32Array(MAP_W * MAP_H);
    this.room = new Int16Array(MAP_W * MAP_H).fill(-1);  // index into game.rooms
    this.doorAt = new Int16Array(MAP_W * MAP_H).fill(-1); // index into game.doors
    this.version = 0; // bumps whenever passability changes (flow fields re-run)
  }

  get(x, y) { return inMap(x, y) ? this.tiles[idx(x, y)] : T.VOID; }
  set(x, y, t) {
    if (!inMap(x, y)) return;
    const i = idx(x, y);
    this.tiles[i] = t;
    this.hp[i] = TILE_HP[t] || 0;
    this.version++;
  }

  clearRegion(x0, y0, x1, y1) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inMap(x, y)) {
      const i = idx(x, y); this.tiles[i] = T.VOID; this.hp[i] = 0; this.room[i] = -1; this.doorAt[i] = -1;
    }
    this.version++;
  }

  /** Is this tile solid for walking? doors depend on their openness. */
  solidAt(x, y, doors) {
    const t = this.get(x, y);
    if (t === T.DOOR) { const d = doors[this.doorAt[idx(x, y)]]; return !d || d.open < 0.75; }
    return SOLID.has(t);
  }
  /** Solid for bullets/LOS. */
  blocksShot(x, y, doors) {
    const t = this.get(x, y);
    if (t === T.DOOR) { const d = doors[this.doorAt[idx(x, y)]]; return !d || d.open < 0.6; }
    return t === T.WALL || t === T.HULL || t === T.ICE || t === T.VOID || t === T.DEBRIS;
  }
  isStruct(t) { return STRUCT.has(t); }

  /** Line of sight between two world points (DDA over tiles). */
  los(ax, ay, bx, by, doors) {
    let x = Math.floor(ax / TILE), y = Math.floor(ay / TILE);
    const tx = Math.floor(bx / TILE), ty = Math.floor(by / TILE);
    const dx = bx - ax, dy = by - ay;
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDX = dx === 0 ? Infinity : Math.abs(TILE / dx);
    const tDY = dy === 0 ? Infinity : Math.abs(TILE / dy);
    let tMX = dx === 0 ? Infinity : ((dx > 0 ? (x + 1) * TILE - ax : ax - x * TILE) / Math.abs(dx));
    let tMY = dy === 0 ? Infinity : ((dy > 0 ? (y + 1) * TILE - ay : ay - y * TILE) / Math.abs(dy));
    for (let n = 0; n < 200; n++) {
      if (x === tx && y === ty) return true;
      if (tMX < tMY) { tMX += tDX; x += stepX; } else { tMY += tDY; y += stepY; }
      if (x === tx && y === ty) return true;
      if (this.blocksShot(x, y, doors)) return false;
    }
    return false;
  }

  /**
   * Dijkstra flow field from many source tiles. costFn(tileType, i) -> step cost or Infinity.
   * Returns Float32Array of distances (Infinity = unreachable).
   */
  flow(sources, costFn, maxDist = 400) {
    const N = MAP_W * MAP_H;
    const dist = new Float32Array(N).fill(Infinity);
    const heap = new MinHeap();
    for (const s of sources) { if (s < 0 || s >= N) continue; dist[s] = 0; heap.push(s, 0); }
    while (heap.size) {
      const [i, d] = heap.pop();
      if (d > dist[i] || d > maxDist) continue;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const ni = ny * MAP_W + nx;
        const c = costFn(this.tiles[ni], ni);
        if (c === Infinity) continue;
        const nd = d + c;
        if (nd < dist[ni]) { dist[ni] = nd; heap.push(ni, nd); }
      }
    }
    return dist;
  }

  /** Best next step (world px target) for an agent at (px,py) going downhill in `field`. */
  stepToward(field, px, py) {
    const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
    const here = field[idx(x, y)];
    let best = here, bx = x, by = y;
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k], ny = y + DY[k];
      if (!inMap(nx, ny)) continue;
      // diagonal only if both orthogonals are open (no corner cutting)
      if (k >= 4 && (field[idx(nx, y)] === Infinity || field[idx(x, ny)] === Infinity)) continue;
      const v = field[idx(nx, ny)] + (k >= 4 ? 0.41 : 0);
      if (v < best) { best = v; bx = nx; by = ny; }
    }
    if (bx === x && by === y) return null;
    return { x: (bx + 0.5) * TILE, y: (by + 0.5) * TILE, tx: bx, ty: by };
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (v[p] <= val) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v; const rk = k[0], rv = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0; const n = k.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && v[c + 1] < v[c]) c++;
        if (v[c] >= lv) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return [rk, rv];
  }
}

// ---------------------------------------------------------------------------
// Building ships into the grid

/** Tile-space rectangle for one of OUR room slots. */
export function slotRect(sx, sy) {
  return { x0: SHIP_OX + sx * SLOT_W, y0: SHIP_OY + sy * SLOT_H, w: SLOT_W, h: SLOT_H };
}

/** A room's size in tiles, walls included on one side (x0..x0+w is wall to wall). Most are one slot. */
export const rw = (room) => room.w ?? SLOT_W;
export const rh = (room) => room.h ?? SLOT_H;

/**
 * Lay out a set of rooms (each with x0,y0 tile corners and w,h) into the grid.
 * Rooms that share a stretch of wall get a door in the middle of it. Outer edges become hull.
 */
export function buildRooms(grid, rooms, roomIndexBase, doorList, owner) {
  // floors + walls
  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    const ri = roomIndexBase + r;
    const W = rw(room), H = rh(room);
    for (let y = room.y0; y <= room.y0 + H; y++) {
      for (let x = room.x0; x <= room.x0 + W; x++) {
        const edge = x === room.x0 || y === room.y0 || x === room.x0 + W || y === room.y0 + H;
        const i = idx(x, y);
        if (edge) {
          if (grid.tiles[i] === T.VOID) { grid.tiles[i] = T.HULL; grid.hp[i] = TILE_HP[T.HULL]; }
          else if (grid.tiles[i] === T.HULL) { grid.tiles[i] = T.WALL; grid.hp[i] = TILE_HP[T.WALL]; } // shared wall
        } else {
          grid.tiles[i] = T.FLOOR; grid.room[i] = ri;
        }
      }
    }
  }
  // a door in every shared stretch of wall (any sizes), as near the middle as it can be without
  // crowding either room's console
  const clear = (x, y, ...rs) => rs.every((r) => Math.abs(x - (r.x0 + 2)) + Math.abs(y - (r.y0 + 1)) > 2);
  const spot = (lo, hi, at, ...rs) => {
    const mid = (lo + hi) >> 1;
    for (let d = 0; d <= hi - lo; d++) for (const p of [mid + d, mid - d]) if (p >= lo && p <= hi && at(p, rs)) return p;
    return mid;
  };
  // Double doors (two tiles wide): on every door of a big room, and on the long side of the small ones
  // (a 10x7 room's top and bottom walls).
  const wide = (r) => !r.thin && (rw(r) > SLOT_W || rh(r) > SLOT_H);
  for (let a = 0; a < rooms.length; a++) for (let b = 0; b < rooms.length; b++) {
    if (a === b) continue;
    const A = rooms[a], B = rooms[b];
    if (A.x0 + rw(A) === B.x0) { // A left of B
      const y0 = Math.max(A.y0, B.y0) + 1, y1 = Math.min(A.y0 + rh(A), B.y0 + rh(B)) - 1;
      if (y1 >= y0) {
        const p = spot(y0, y1, (q) => clear(B.x0, q, A, B), A, B);
        const pair = (wide(A) || wide(B) || (rh(A) > rw(A) && rh(B) > rw(B))) && y1 > y0 ? (p + 1 <= y1 && clear(B.x0, p + 1, A, B) ? p + 1 : p - 1) : null;
        doubleDoor(grid, doorList, [[B.x0, p], pair != null && pair >= y0 ? [B.x0, pair] : null], roomIndexBase + a, roomIndexBase + b, owner, 'v');
      }
    }
    if (A.y0 + rh(A) === B.y0) { // A above B
      const x0 = Math.max(A.x0, B.x0) + 1, x1 = Math.min(A.x0 + rw(A), B.x0 + rw(B)) - 1;
      if (x1 >= x0) {
        const p = spot(x0, x1, (q) => clear(q, B.y0, A, B), A, B);
        const pair = !A.thin && !B.thin && x1 > x0 ? (p + 1 <= x1 && clear(p + 1, B.y0, A, B) ? p + 1 : p - 1) : null;
        doubleDoor(grid, doorList, [[p, B.y0], pair != null && pair >= x0 ? [pair, B.y0] : null], roomIndexBase + a, roomIndexBase + b, owner, 'h');
      }
    }
  }
  grid.version++;
}
let pairN = 0;
/** One door, or two side by side that open and shut together. */
export function doubleDoor(grid, doorList, tiles, a, b, owner, orient, hp) {
  const list = tiles.filter(Boolean);
  const pair = list.length > 1 ? ++pairN : null;
  return list.map(([x, y]) => { const d = addDoor(grid, doorList, x, y, a, b, owner, orient, hp); if (pair) d.pair = pair; return d; });
}

export function addDoor(grid, doorList, x, y, a, b, owner, orient, hp = TILE_HP[T.DOOR]) {
  const i = idx(x, y);
  grid.tiles[i] = T.DOOR;
  grid.hp[i] = hp;
  grid.doorAt[i] = doorList.length;
  const d = { i, x, y, a, b, owner, orient, open: 0, want: 0, sealed: false, hold: null, hp, maxHp: hp, broken: false, reinforced: 0 };
  doorList.push(d);
  return d;
}

/**
 * The walkway around our ship: every empty tile within 2 of the ship's outer hull becomes floor, the
 * next ring out becomes the new outer hull, and each room gets a door out to the walkway on each
 * side that faces it. Returns the walkway tiles.
 */
export function buildRing(grid, rooms, doorList) {
  const N = MAP_W * MAP_H;
  const d = new Uint8Array(N).fill(255);
  const q = [];
  for (const room of rooms) for (let y = room.y0; y <= room.y0 + rh(room); y++) for (let x = room.x0; x <= room.x0 + rw(room); x++) {
    const i = idx(x, y); if (d[i] === 0) continue; d[i] = 0; q.push(i);
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h]; if (d[i] >= RING) continue;
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy; if (!inMap(nx, ny)) continue;
      const j = ny * MAP_W + nx; if (d[j] !== 255) continue;
      d[j] = d[i] + 1; q.push(j);
    }
  }
  const ring = [], outer = [];
  for (let i = 0; i < N; i++) {
    if (d[i] === 255 || d[i] === 0) continue;
    if (d[i] < RING) { grid.tiles[i] = T.FLOOR; grid.hp[i] = 0; grid.room[i] = -1; ring.push(i); if (d[i] === RING - 1) outer.push(i); }
    else { grid.tiles[i] = T.HULL; grid.hp[i] = TILE_HP[T.HULL]; }
  }
  ring.outer = outer;   // the outside lane of the walkway (one tile wide): the air current runs along it
  // the rooms' old outer hull is now an inside wall
  for (const room of rooms) for (const w of wallTilesOf(room, true)) if (grid.tiles[w.i] === T.HULL) { grid.tiles[w.i] = T.WALL; grid.hp[w.i] = TILE_HP[T.WALL]; }
  // doors out to the walkway
  const floorAt = (x, y) => inMap(x, y) && grid.tiles[idx(x, y)] === T.FLOOR && grid.room[idx(x, y)] < 0;
  rooms.forEach((room, r) => {
    const W = rw(room), H = rh(room);
    // big rooms get a door out of every slot's worth of wall that faces the walkway
    const sides = [];
    for (let sx = 0; sx < W; sx += SLOT_W) { const seg = Math.min(SLOT_W, W - sx); const mx = room.x0 + sx + Math.min(seg - 1, Math.max(4, seg >> 1)); sides.push([mx, room.y0, 0, -1, 'h'], [mx, room.y0 + H, 0, 1, 'h']); }
    for (let sy = 0; sy < H; sy += SLOT_H) { const my = room.y0 + sy + (Math.min(SLOT_H, H - sy) >> 1); sides.push([room.x0, my, -1, 0, 'v'], [room.x0 + W, my, 1, 0, 'v']); }
    // (double doors: every door of a big room, and the long-side doors of a small one)
    const big = W > SLOT_W || H > SLOT_H;
    const ok = (x, y, dx, dy) => grid.tiles[idx(x, y)] === T.WALL && floorAt(x + dx, y + dy) && grid.room[idx(x - dx, y - dy)] === r;
    for (const [x, y, dx, dy, o] of sides) {
      if (!ok(x, y, dx, dy)) continue;
      const twin = big || o === 'h' ? (o === 'h' ? [[x + 1, y], [x - 1, y]] : [[x, y + 1], [x, y - 1]]).find(([tx, ty]) => ok(tx, ty, dx, dy) && grid.tiles[idx(tx, ty)] !== T.DOOR) : null;
      doubleDoor(grid, doorList, [[x, y], twin || null], r, -1, 'us', o);
    }
  });
  grid.version++;
  return ring;
}

/** Room pixel helpers */
export function roomCenter(room) { return { x: (room.x0 + rw(room) / 2 + 0.5) * TILE, y: (room.y0 + rh(room) / 2 + 0.5) * TILE }; }
/** A random point inside a room (away from the walls). */
export function roomPoint(room, rng) {
  const W = rw(room), H = rh(room);
  return { x: (room.x0 + (W > 3 ? 1.5 + rng() * (W - 3) : W / 2 + 0.5)) * TILE, y: (room.y0 + (H > 3 ? 1.5 + rng() * (H - 3) : H / 2 + 0.5)) * TILE };
}
export function roomInterior(room) {
  return { x0: (room.x0 + 1) * TILE, y0: (room.y0 + 1) * TILE, x1: (room.x0 + rw(room)) * TILE, y1: (room.y0 + rh(room)) * TILE };
}
export function stationPos(room) {
  // the Urchid's chair sits right in the middle of the lounge (best seat in the house)
  if (room.type === 'lounge') return { x: (room.x0 + rw(room) / 2) * TILE, y: (room.y0 + rh(room) / 2) * TILE + 6 };
  // the console sits against the back wall in the top-left corner, clear of every door
  return { x: (room.x0 + 2.5) * TILE, y: (room.y0 + 1) * TILE + 14 };
}
export function roomTiles(room) {
  const out = [];
  for (let y = room.y0 + 1; y < room.y0 + rh(room); y++) for (let x = room.x0 + 1; x < room.x0 + rw(room); x++) out.push(idx(x, y));
  return out;
}
export function wallTilesOf(room, corners = false) {
  const out = [];
  const W = rw(room), H = rh(room);
  for (let y = room.y0; y <= room.y0 + H; y++) for (let x = room.x0; x <= room.x0 + W; x++) {
    const edge = x === room.x0 || y === room.y0 || x === room.x0 + W || y === room.y0 + H;
    const corner = (x === room.x0 || x === room.x0 + W) && (y === room.y0 || y === room.y0 + H);
    if (edge && (corners || !corner)) out.push({ x, y, i: idx(x, y) });
  }
  return out;
}

export { ROOMS };
