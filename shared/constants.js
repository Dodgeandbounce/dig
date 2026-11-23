// Shared between server and browser (served at /shared/constants.js).

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 17;

/** Radius of the earth in km — reaching this depth wins the run. */
export const EARTH_CENTER_KM = 6371;

/** Story layers, top to bottom. `hazard` = expected hull damage per second. */
export const LAYERS = [
  { id: 'crust',      name: 'The Crust',       fromKm: 0,    hazard: 0.6, color: '#7a5a3a' },
  { id: 'upper',      name: 'Upper Mantle',    fromKm: 35,   hazard: 1.2, color: '#9a4a2a' },
  { id: 'lower',      name: 'Lower Mantle',    fromKm: 660,  hazard: 1.8, color: '#b8361e' },
  { id: 'outer-core', name: 'Outer Core',      fromKm: 2890, hazard: 2.6, color: '#e0661a' },
  { id: 'inner-core', name: 'Inner Core',      fromKm: 5150, hazard: 3.4, color: '#f4c542' },
];

export function layerAt(depthKm) {
  let layer = LAYERS[0];
  for (const l of LAYERS) if (depthKm >= l.fromKm) layer = l;
  return layer;
}

export const HULL_MAX = 100;
export const REPAIR_AMOUNT = 2;
export const REPAIR_COOLDOWN_MS = 400;

/** World lifecycle (is the simulation allowed to tick?) */
export const WORLD_STATUS = {
  RUNNING: 'running',     // ticking, players aboard
  SUSPENDED: 'suspended', // saved and frozen, waiting for the host to come back
};

/** Run outcome */
export const RUN_STATUS = {
  ACTIVE: 'active',
  WON: 'won',
  LOST: 'lost',
};
