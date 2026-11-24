// The descent: the pilot steers through a brown tunnel toward the light at the core.
// Rocks and creatures come at you; gem veins and fuel pockets are worth flying through.
import { TILE, T, SLOT_W, SLOT_H } from './data.js';
import { idx, roomCenter, roomPoint } from './grid.js';
import { hitTile, rainPickup, addMess } from './combat.js';
import { clamp } from './util.js';

export function newDescent(resume) {
  return resume || { progress: 0, steer: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, obstacles: [], spawnT: 0, boost: false, stranded: false, hits: 0, collected: 0, ambushT: 0 };
}

export function speedFactor(g) {
  const s = g.ship;
  const engines = g.rooms.filter((r) => r.owner === 'us' && r.type === 'engine');
  let eng = 0;
  engines.forEach((r, k) => { eng += (k === 0 ? 1 : 0.35) * (0.25 + 0.75 * r.sys.hp / r.sys.max); });
  let f = eng * (1 + 0.12 * s.up.drill) * (s.research.has('drillbits') ? 1.2 : 1) * (s.overclock?.sys === 'engine' ? 1.3 : 1);
  const helm = g.rooms.find((r) => r.owner === 'us' && r.type === 'bridge');
  if (!helm || helm.sys.hp <= 0) f *= 0.4;
  return f;
}

export function descentTick(g, dt, pilotInput) {
  const d = g.descent, s = g.ship;
  const engines = g.rooms.filter((r) => r.owner === 'us' && r.type === 'engine').length;
  const pilot = g.crew.find((c) => c.cls === 'pilot');
  const afterburner = pilot ? pilot.upgrades[1] : 0;
  d.boost = !!pilotInput?.shift && s.fuel > 0;
  // fuel
  const burn = 0.42 * (1 + 0.3 * (engines - 1)) * (d.boost ? 2 - 0.15 * afterburner : 1);
  s.fuel = Math.max(0, s.fuel - burn * dt);
  if (s.fuel <= 0) {
    if (!d.stranded) { d.stranded = true; g.log('alert', 'Out of fuel! We\'re stranded. Call for a fuel drop (60 money) — every ship nearby will hear it.'); g.fx({ t: 'alarm' }); }
    return;
  }
  const spd = speedFactor(g) * (d.boost ? 1.6 : 1) * g.speed;
  d.progress += dt * spd / 86;   // ~1.5 minutes a level at normal speed (30 levels down)
  // the tunnel bends now and then: the pilot banks into it (the view outside follows)
  d.turnT = (d.turnT ?? g.rng.range(4, 10)) - dt;
  if (d.turnT <= 0) { d.turnT = g.rng.range(5, 14); d.heading = clamp(g.rng.range(-0.75, 0.75), -0.8, 0.8); }
  d.bank = (d.bank || 0) + ((d.heading || 0) - (d.bank || 0)) * Math.min(1, dt * 0.6);

  // steering (pilot input or bot)
  const helm = g.rooms.find((r) => r.owner === 'us' && r.type === 'bridge');
  const wobble = helm && helm.sys.hp > 0 ? 0 : 0.6;
  let ix = 0, iy = 0;
  if (pilotInput && (pilotInput.mx || pilotInput.my)) { ix = pilotInput.mx; iy = pilotInput.my; }
  else if (!pilotInput) { const a = botSteer(g, d); ix = a.x; iy = a.y; }
  const steady = pilot ? pilot.upgrades[0] : 0;
  const acc = 3.4 + 0.3 * steady;
  d.vel.x += (ix * 1.4 - d.vel.x) * Math.min(1, dt * acc) + (g.rng() - 0.5) * wobble * dt;
  d.vel.y += (iy * 1.4 - d.vel.y) * Math.min(1, dt * acc) + (g.rng() - 0.5) * wobble * dt;
  d.steer.x = clamp(d.steer.x + d.vel.x * dt, -1, 1);
  d.steer.y = clamp(d.steer.y + d.vel.y * dt, -1, 1);

  // obstacles
  d.spawnT -= dt * spd;
  if (d.spawnT <= 0) {
    d.spawnT = Math.max(0.28, 0.9 - g.tier * 0.12) * g.rng.range(0.6, 1.3);
    const r = g.rng();
    let kind = r < 0.55 ? 'rock' : r < 0.7 ? 'boulder' : r < 0.82 ? 'creature' : r < 0.95 ? 'gems' : 'fuel';
    if (g.tier === 0 && kind === 'creature') kind = 'rock';
    d.obstacles.push({ kind, x: g.rng.range(-1, 1), y: g.rng.range(-1, 1), z: 1, r: kind === 'boulder' ? 0.42 : kind === 'rock' ? 0.24 : kind === 'creature' ? 0.22 : 0.2,
      vx: kind === 'creature' ? g.rng.range(-0.4, 0.4) : 0, vy: kind === 'creature' ? g.rng.range(-0.3, 0.3) : 0, spin: g.rng() * 6 });
  }
  const dz = dt * 0.55 * spd;
  for (const o of d.obstacles) {
    o.z -= dz; o.x += o.vx * dt; o.y += o.vy * dt;
    if (o.kind === 'creature') { // creatures home in a little
      o.vx += (d.steer.x - o.x) * dt * 0.6; o.vy += (d.steer.y - o.y) * dt * 0.6;
    }
    if (o.z <= 0 && !o.done) {
      o.done = true;
      const near = Math.hypot(o.x - d.steer.x, o.y - d.steer.y) < o.r + 0.13;
      if (!near) continue;
      if (o.kind === 'gems') { collectVein(g, 'gem', 3 + g.tier * 2); d.collected++; g.fx({ t: 'vein', kind: 'gem' }); }
      else if (o.kind === 'fuel') { s.fuel = Math.min(s.fuelMax, s.fuel + 12); g.fx({ t: 'vein', kind: 'fuel' }); g.log('ship', '+12 fuel from a fuel pocket.'); }
      else impact(g, o.kind);
    }
  }
  d.obstacles = d.obstacles.filter((o) => o.z > -0.15);

  feeders(g, dt);
}

function botSteer(g, d) {
  // avoid the nearest threats, drift toward gem veins
  let ax = -d.steer.x * 0.3, ay = -d.steer.y * 0.3;
  const skill = 0.75 + 0.05 * g.tier;
  for (const o of d.obstacles) {
    if (o.z > 0.55 || o.z < 0) continue;
    const dx = d.steer.x - o.x, dy = d.steer.y - o.y; const dd = Math.hypot(dx, dy) + 0.01;
    if (o.kind === 'gems' || o.kind === 'fuel') { if (dd < 0.8) { ax -= dx / dd * 0.9; ay -= dy / dd * 0.9; } continue; }
    if (dd < o.r + 0.4) { ax += dx / dd * (1.6 - o.z) * skill * 1.6; ay += dy / dd * (1.6 - o.z) * skill * 1.6; }
  }
  const l = Math.hypot(ax, ay);
  return l > 1 ? { x: ax / l, y: ay / l } : { x: ax, y: ay };
}

function impact(g, kind) {
  const s = g.ship, d = g.descent;
  const pilot = g.crew.find((c) => c.cls === 'pilot');
  const dmg = (kind === 'boulder' ? 9 : kind === 'creature' ? 7 : 4) * (1 + g.tier * 0.35) * (1 - 0.1 * (pilot ? pilot.upgrades[0] : 0));
  s.hull = Math.max(0, s.hull - (g.storyMode ? 0 : dmg));
  d.hits++;
  g.fx({ t: 'impact', kind, dmg: Math.round(dmg) });
  if (kind !== 'rock' && g.rng.chance(0.35) && !g.storyMode) {
    // knock a hole in a random room's hull
    const rooms = g.rooms.filter((r) => r.owner === 'us');
    const r = g.rng.pick(rooms);
    const walls = g.hullNear(r);
    if (walls.length) { const w = g.rng.pick(walls); hitTile(g, w.x, w.y, 999, { hull: true }); }
  }
  if (kind === 'creature' && g.rng.chance(0.3 + g.tier * 0.1)) {
    // it got inside
    const rooms = g.rooms.filter((r) => r.owner === 'us');
    const r = g.rng.pick(rooms);
    const type = g.rng.pick(g.roster.filter((x) => x.creature && x.tier <= g.tier));
    if (type) { const p = roomCenter(r); for (let k = 0; k < 1 + (g.rng.chance(0.2 * g.tier) ? 1 : 0); k++) g.spawnMob(type.idx, p.x + k * 20, p.y, {}); g.log('alert', `A ${type.name} burrowed in through the ${r.name}!`); }
  }
}

/** Somewhere to drop a gem: anywhere on the ship, a bit more often in a feeder hall. */
function dropSpot(g) {
  const halls = g.rooms.filter((r) => r.owner === 'us' && r.type === 'hall' && r.sys.hp > 0);
  const all = g.rooms.filter((r) => r.owner === 'us');
  const r = halls.length && g.rng.chance(0.3) ? g.rng.pick(halls) : g.rng.pick(all);
  if (g.rng.chance(0.12) && g.hullTiles?.length) { // now and then it lands out in the walkway
    const i = g.rng.pick(g.hullTiles); const x = i % g.W, y = (i / g.W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.grid.get(x + dx, y + dy) === T.FLOOR) return { x: (x + dx + .5) * TILE, y: (y + dy + .5) * TILE };
  }
  return roomPoint(r, g.rng);
}

function collectVein(g, kind, n) {
  for (let k = 0; k < n; k++) { const p = dropSpot(g); rainPickup(g, p.x, p.y, kind, 1); }
}

/** Auto-feeders: gems, ore and food rain down into the ship as we drill. */
export function feeders(g, dt) {
  const s = g.ship;
  g.feedT = (g.feedT || 0) - dt * (1 + 0.25 * s.up.feeders) * (s.overclock?.sys === 'feeder' ? 1.5 : 1);
  if (g.feedT > 0) return;
  g.feedT = g.rng.range(0.9, 1.8);
  const roll = g.rng();
  const { x, y } = dropSpot(g);
  if (roll < 0.5) rainPickup(g, x, y, 'gem', 1 + (g.rng.chance(0.15) ? g.tier : 0));
  else if (roll < 0.75) rainPickup(g, x, y, 'ore', 1);
  else if (roll < 0.93) rainPickup(g, x, y, 'food', 1, g.rng.pick(['grub', 'shroom', 'fish', 'spice']));
  else addMess(g, x, y, 'dirt', 1); // dirt filters in through the roof
}
