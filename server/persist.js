// Saving and restoring a running Game (node:v8 keeps Maps, Sets, typed arrays and shared references).
import v8 from 'node:v8';
import { Game, GAME_VERSION } from '../shared/sim/game.js';
import { Grid } from '../shared/sim/grid.js';
import { makeRng } from '../shared/sim/rng.js';
import { setUidBase } from '../shared/sim/util.js';

// Rebuilt on load: the RNG closure, pathfinding caches, per-tick queues.
const TRANSIENT = new Set(['rng', 'fields', 'fieldCache', 'fieldsAt', 'fxq', 'inputs']);

export function serializeGame(g) {
  const plain = {};
  for (const k of Object.keys(g)) if (!TRANSIENT.has(k)) plain[k] = g[k];
  plain.rngState = g.rng.state();
  // Bot brains can hold flow fields and closures; bots re-plan on their own.
  const brains = g.crew.map((c) => c.bot);
  for (const c of g.crew) c.bot = {};
  try { return v8.serialize(plain); }
  finally { g.crew.forEach((c, i) => { c.bot = brains[i]; }); }
}

export function deserializeGame(buf) {
  const g = v8.deserialize(buf);
  // saves from before the big ship rework (different map size and layout) can't be continued
  if (g.v !== GAME_VERSION) throw new Error(`saved with game version ${g.v ?? 1}, this is version ${GAME_VERSION}`);
  Object.setPrototypeOf(g, Game.prototype);
  Object.setPrototypeOf(g.grid, Grid.prototype);
  g.rng = makeRng(g.rngState);
  delete g.rngState;
  g.fields = {}; g.fieldCache = new Map(); g.fieldsAt = -9; g.fxq = []; g.inputs = new Map();
  g.paused = false;
  for (const c of g.crew) { c.human = false; c.bot = {}; c.atHelm = false; c.player = null; }
  setUidBase(maxId(g) + 1);
  return g;
}

function maxId(root) {
  let max = 0;
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const o = stack.pop();
    if (!o || typeof o !== 'object' || seen.has(o) || ArrayBuffer.isView(o)) continue;
    seen.add(o);
    if (typeof o.id === 'number' && o.id > max) max = o.id;
    if (o instanceof Map) for (const v of o.values()) stack.push(v);
    else if (o instanceof Set) for (const v of o) stack.push(v);
    else for (const k in o) stack.push(o[k]);
  }
  return max;
}
