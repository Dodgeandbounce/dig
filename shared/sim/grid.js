// The tile world: both ships, the docking tunnel, doors, line of sight and pathfinding.
import { T, TILE, TILE_HP, MAP_W, MAP_H, SLOT_W, SLOT_H, SHIP_OX, SHIP_OY, ROOMS } from './data.js';

export const idx = (x, y) => y * MAP_W + x;
export const inMap = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

const SOLID = new Set([T.VOID, T.WALL, T.HULL, T.BREACH, T.ICE]);
const STRUCT = new Set([T.WALL, T.HULL, T.DOOR, T.ICE]);

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
    return t === T.WALL || t === T.HULL || t === T.ICE || t === T.VOID;
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

/**
 * Lay out a set of rooms (with x0,y0 tile corners, all SLOT_W x SLOT_H) into the grid.
 * Rooms that share an edge get a door in the middle of it. Outer edges become hull.
 * Returns the doors created.
 */
export function buildRooms(grid, rooms, roomIndexBase, doorList, owner) {
  // floors + walls
  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    const ri = roomIndexBase + r;
    for (let y = room.y0; y <= room.y0 + SLOT_H; y++) {
      for (let x = room.x0; x <= room.x0 + SLOT_W; x++) {
        const edge = x === room.x0 || y === room.y0 || x === room.x0 + SLOT_W || y === room.y0 + SLOT_H;
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
  // corners of shared walls that are surrounded by rooms stay walls; outer stay hull. Now doors.
  const byPos = new Map(rooms.map((r, k) => [`${r.x0},${r.y0}`, k]));
  for (let r = 0; r < rooms.length; r++) {
    const room = rooms[r];
    const right = byPos.get(`${room.x0 + SLOT_W},${room.y0}`);
    const below = byPos.get(`${room.x0},${room.y0 + SLOT_H}`);
    if (right !== undefined) addDoor(grid, doorList, room.x0 + SLOT_W, room.y0 + (SLOT_H >> 1), roomIndexBase + r, roomIndexBase + right, owner, 'v');
    if (below !== undefined) addDoor(grid, doorList, room.x0 + (SLOT_W >> 1), room.y0 + SLOT_H, roomIndexBase + r, roomIndexBase + below, owner, 'h');
  }
  // interior walls between rooms are WALL, edge corners where two hulls meet but rooms touch only at a corner: keep hull
  grid.version++;
}

function addDoor(grid, doorList, x, y, a, b, owner, orient) {
  const i = idx(x, y);
  grid.tiles[i] = T.DOOR;
  grid.hp[i] = TILE_HP[T.DOOR];
  grid.doorAt[i] = doorList.length;
  doorList.push({ i, x, y, a, b, owner, orient, open: 0, want: 0, sealed: false, hold: null, hp: TILE_HP[T.DOOR], maxHp: TILE_HP[T.DOOR], broken: false, reinforced: 0 });
}

/** Room pixel helpers */
export function roomCenter(room) { return { x: (room.x0 + 4.5) * TILE, y: (room.y0 + 3.5) * TILE }; }
export function roomInterior(room) {
  return { x0: (room.x0 + 1) * TILE, y0: (room.y0 + 1) * TILE, x1: (room.x0 + SLOT_W) * TILE, y1: (room.y0 + SLOT_H) * TILE };
}
export function stationPos(room) {
  // station sits on the back wall of the room (top interior row), centred
  return { x: (room.x0 + 4.5) * TILE, y: (room.y0 + 1) * TILE + 14 };
}
export function roomTiles(room) {
  const out = [];
  for (let y = room.y0 + 1; y < room.y0 + SLOT_H; y++) for (let x = room.x0 + 1; x < room.x0 + SLOT_W; x++) out.push(idx(x, y));
  return out;
}
export function wallTilesOf(room) {
  const out = [];
  for (let y = room.y0; y <= room.y0 + SLOT_H; y++) for (let x = room.x0; x <= room.x0 + SLOT_W; x++) {
    const edge = x === room.x0 || y === room.y0 || x === room.x0 + SLOT_W || y === room.y0 + SLOT_H;
    const corner = (x === room.x0 || x === room.x0 + SLOT_W) && (y === room.y0 || y === room.y0 + SLOT_H);
    if (edge && !corner) out.push({ x, y, i: idx(x, y) });
  }
  return out;
}

export { ROOMS };
