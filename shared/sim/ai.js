// AI: bot crew (each plays its class's job), boarders, defenders, creatures, allied monsters,
// plus the gadgets lying around (turrets, traps, mines, TNT, gas clouds, ice).
import { T, TILE, CLASSES, ENEMY_WEAPONS, RECIPES, RESEARCH, WEAPONS, ENEMY_TAUNTS, URCHID_TAUNTS } from './data.js';
import { idx, inMap, roomCenter } from './grid.js';
import {
  moveActor, damage, explode, spawnProj, fireBullet, melee, hitTile, damageSystem, roomAt, tileOf,
  hostiles, nearestHostile, stat, tileOwner, addBuff, healActor, unstick,
} from './combat.js';
import { interactTarget, repairTarget, weaponOf, DASH_COST } from './classes.js';
import { clamp, norm, dist, dist2, angTo, uid } from './util.js';

const EW = Object.fromEntries(ENEMY_WEAPONS.map((w) => [w.id, w]));

// ---------------------------------------------------------------------------
// flow fields
const PASS = new Set([T.FLOOR, T.TUNNEL, T.RUBBLE]);

export function rebuildFields(g) {
  const tilesOf = (list) => list.map((a) => idx(Math.floor(a.x / TILE), Math.floor(a.y / TILE)));
  const doorCost = (i) => { const d = g.doors[g.grid.doorAt[i]]; return !d || d.broken || d.open > 0.75 ? 1 : 7; };
  const enemyCost = (t, i) => (PASS.has(t) ? 1 : t === T.DOOR ? doorCost(i) : t === T.ICE || t === T.DEBRIS ? 6 : Infinity);
  const carveCost = (t, i) => (PASS.has(t) ? 1 : t === T.DOOR ? doorCost(i) : t === T.ICE || t === T.DEBRIS ? 6 : t === T.WALL ? 9 : Infinity);

  const crewTargets = [...g.crew.filter((c) => c.alive && !c.phased && c.cls !== 'urchid'), ...g.mobs.filter((m) => m.alive && m.team === 'crew')];
  const sysTiles = g.rooms.filter((r) => r.owner === 'us' && r.sys && r.sys.hp > 0).map((r) => idx(Math.floor(r.station.x / TILE), Math.floor(r.station.y / TILE) + 1));
  const vault = g.rooms.find((r) => r.owner === 'us' && r.type === 'vault');
  const exits = g.rooms.filter((r) => r.owner === 'them' && !r.gone).map((r) => { const p = roomCenter(r); return idx(Math.floor(p.x / TILE), Math.floor(p.y / TILE)); });

  g.fields.toCrew = g.grid.flow(tilesOf(crewTargets), enemyCost);
  g.fields.carve = g.grid.flow(tilesOf(crewTargets), carveCost);
  g.fields.toSys = g.grid.flow(sysTiles.length ? sysTiles : tilesOf(crewTargets), enemyCost);
  // wall-breakers take the straight line to our systems, through the walls
  g.fields.carveSys = g.grid.flow(sysTiles.length ? sysTiles : tilesOf(crewTargets), carveCost);
  g.fields.toVault = vault && g.ship.gems > 0 ? g.grid.flow([idx(Math.floor(vault.station.x / TILE), Math.floor(vault.station.y / TILE) + 1)], enemyCost) : g.fields.toCrew;
  g.fields.toExit = exits.length ? g.grid.flow(exits, enemyCost) : null;

  // crew-side
  const enemies = g.mobs.filter((m) => m.alive && m.team === 'enemy');
  const ours = enemies.filter((m) => tileOwner(g, Math.floor(m.x / TILE), Math.floor(m.y / TILE)) === 'us');
  for (const clear of [false, true]) {
    const cost = crewCost(g, clear);
    g.fields[`enemies${+clear}`] = g.grid.flow(tilesOf(ours), cost);
    g.fields[`anyEnemy${+clear}`] = g.grid.flow(tilesOf(enemies), cost);
    const theirSys = g.rooms.filter((r) => r.owner === 'them' && !r.gone && r.sys && r.sys.hp > 0).map((r) => idx(Math.floor(r.station.x / TILE), Math.floor(r.station.y / TILE) + 1));
    g.fields[`theirSys${+clear}`] = theirSys.length ? g.grid.flow(theirSys, cost) : null;
    const rep = [];
    for (const r of g.rooms) if (r.owner === 'us' && r.sys && r.sys.hp < r.sys.max * 0.97) rep.push(idx(Math.floor(r.station.x / TILE), Math.floor(r.station.y / TILE) + 1));
    for (const i of g.orig.keys()) if (g.grid.room[i] === -1 || g.rooms[g.grid.room[i]]?.owner !== 'them') {
      // standable tile next to the broken one
      const x = i % g.W, y = (i / g.W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = idx(x + dx, y + dy); if (PASS.has(g.grid.tiles[j]) && tileOwner(g, x + dx, y + dy) === 'us') { rep.push(j); break; } }
    }
    g.repairCount = rep.length;
    g.fields[`repair${+clear}`] = rep.length ? g.grid.flow(rep, cost) : null;
  }
  g.fieldsAt = g.time;
}

export function crewCost(g, clear) {
  return (t, i) => {
    if (PASS.has(t)) return 1;
    if (t === T.DOOR) { const d = g.doors[g.grid.doorAt[i]]; if (!d) return Infinity; if (d.sealed && !clear) return Infinity; return 1.5; }
    if (t === T.DEBRIS) return 8;   // slow: they stop and clear it
    return Infinity;
  };
}

export function fieldTo(g, tileI, clear) {
  const key = `${tileI}:${+clear}`;
  const c = g.fieldCache.get(key);
  if (c && c.v === g.grid.version) return c.f;
  const f = g.grid.flow([tileI], crewCost(g, clear));
  g.fieldCache.set(key, { v: g.grid.version, f });
  if (g.fieldCache.size > 80) g.fieldCache.delete(g.fieldCache.keys().next().value);
  return f;
}

// steer an actor toward a world point using a field; returns movement vector
function steer(g, a, field, goal) {
  if (goal && g.grid.los(a.x, a.y, goal.x, goal.y, g.doors) && dist2(a, goal) < 220 * 220) {
    return norm(goal.x - a.x, goal.y - a.y);
  }
  if (!field) return goal ? norm(goal.x - a.x, goal.y - a.y) : { x: 0, y: 0, l: 0 };
  const s = g.grid.stepToward(field, a.x, a.y);
  if (!s) return goal ? norm(goal.x - a.x, goal.y - a.y) : { x: 0, y: 0, l: 0 };
  return norm(s.x - a.x, s.y - a.y);
}

// ---------------------------------------------------------------------------
// bot crew
export function botInput(g, c, dt) {
  const inp = { mx: 0, my: 0, ax: c.x + Math.cos(c.facing || 0) * 50, ay: c.y + Math.sin(c.facing || 0) * 50, fire: false, rmb: false, e: false, shift: false, pressed: {} };
  if (!c.alive) return inp;
  const b = c.bot;
  b.t = (b.t || 0) - dt;
  const clear = CLASSES[c.cls].clearance;
  const myRoom = g.rooms[roomAt(g, c)];
  const home = g.rooms.find((r) => r.owner === 'us' && r.type === CLASSES[c.cls].room);
  const enc = g.phase === 'encounter';

  // --- choose a goal every so often
  if (b.t <= 0) {
    b.t = 0.3 + g.rng() * 0.2;
    b.goal = chooseGoal(g, c, home, enc, clear);
  }
  const goal = b.goal || { kind: 'idle' };

  // --- act on it
  let field = null, point = null;
  switch (goal.kind) {
    case 'fight': {
      const t = goal.target;
      if (!t || !t.alive) { b.t = 0; break; }
      point = t;
      field = g.fields[`enemies${+clear}`] && onOurShip(g, t) ? g.fields[`enemies${+clear}`] : g.fields[`anyEnemy${+clear}`];
      const w = weaponOf(c);
      const d = dist(c, t);
      const los = g.grid.los(c.x, c.y, t.x, t.y, g.doors);
      inp.ax = t.x; inp.ay = t.y;
      const range = w.kind === 'melee' ? (w.range + t.r) : w.kind === 'heckle' ? 0 : Math.min(w.range || 300, 300);
      if (los && d < range) {
        inp.fire = true;
        if (w.kind !== 'melee' && d < range * 0.6) { point = null; strafe(g, c, t, inp); }
        else if (w.kind === 'melee') point = t;
        // class tricks
        useCombatAbilities(g, c, t, d, inp);
      }
      break;
    }
    case 'station': point = goal.room.station; field = fieldTo(g, stationTile(goal.room), clear);
      if (dist(c, { x: goal.room.station.x, y: goal.room.station.y + 20 }) < 26) {
        point = null; inp.e = goal.hold || false; stationWork(g, c, goal.room, inp);
        // a damaged console gets fixed by whoever is standing at it (hold E; the engineer whacks it too)
        const r = goal.room;
        if (r.owner === 'us' && r.sys && r.sys.hp < r.sys.max) { inp.e = true; inp.ax = r.station.x; inp.ay = r.station.y; if (c.cls === 'engineer') inp.fire = true; }
      }
      else point = { x: goal.room.station.x, y: goal.room.station.y + 22 };
      break;
    case 'repairSys': {
      const r = goal.room; point = { x: r.station.x, y: r.station.y + 22 }; field = fieldTo(g, stationTile(r), clear);
      if (dist(c, point) < 24) { point = null; inp.ax = r.station.x; inp.ay = r.station.y; if (c.cls === 'engineer') inp.fire = true; inp.e = true; }
      break;
    }
    case 'repair': {
      field = g.fields[`repair${+clear}`];
      const t = repairTarget(g, c);
      if (t) { point = null; inp.ax = (t.tx + .5) * TILE; inp.ay = (t.ty + .5) * TILE; inp.e = true; if (c.cls === 'engineer') inp.fire = true; }
      break;
    }
    case 'pickup': point = goal.p; field = fieldTo(g, idx(Math.floor(goal.p.x / TILE), Math.floor(goal.p.y / TILE)), clear); break;
    case 'fire': {
      const o = goal.o;
      if (!g.objs.includes(o)) { b.t = 0; break; }
      inp.ax = o.x; inp.ay = o.y;
      if (dist(c, o) < 40) { point = null; inp.e = true; }
      else { point = o; field = fieldTo(g, o.i, clear); }
      break;
    }
    case 'crate': {
      const o = goal.o;
      if (!g.objs.includes(o)) { b.t = 0; break; }
      if (dist(c, o) < 34) { point = null; inp.pressed.e = true; b.t = 0; }
      else { point = o; field = fieldTo(g, idx(Math.floor(o.x / TILE), Math.floor(o.y / TILE)), true); }
      break;
    }
    case 'rescue': {
      const joe = g.joe.mob;
      if (!joe?.alive || joe.following) { b.t = 0; break; }
      point = joe; field = fieldTo(g, idx(Math.floor(joe.x / TILE), Math.floor(joe.y / TILE)), true);
      break;
    }
    case 'mess': point = goal.o; field = fieldTo(g, idx(Math.floor(goal.o.x / TILE), Math.floor(goal.o.y / TILE)), clear);
      if (dist(c, goal.o) < 30) { point = null; if (c.cls === 'farmer') { inp.pressed.e = !b.scooped; b.scooped = !b.scooped; } else inp.e = true; }
      break;
    case 'board': field = g.fields[`theirSys${+clear}`]; {
      const r = g.rooms[roomAt(g, c)];
      if (r && r.owner === 'them' && r.sys && r.sys.hp > 0 && dist(c, r.station) < 56) { point = null; inp.ax = r.station.x; inp.ay = r.station.y; inp.fire = true; inp.e = true; }
    } break;
    case 'idle': default:
      if (home) { point = { x: home.station.x + Math.cos(c.id) * 40, y: home.station.y + 50 }; field = fieldTo(g, stationTile(home), clear); if (dist(c, point) < 20) point = null; }
  }
  if (point || field) {
    const v = steer(g, c, field, point);
    // arrival
    if (point && dist(c, point) < 6) { v.x = 0; v.y = 0; }
    inp.mx = v.x; inp.my = v.y;
    if (!inp.fire && (v.x || v.y)) { inp.ax = c.x + v.x * 60; inp.ay = c.y + v.y * 60; }
    // open sealed doors on the way (clearance) — unless a player sealed them on purpose
    if (clear && !g.crew.some((x) => x.human)) { for (const d of g.doors) if (d.sealed && Math.abs((d.x + .5) * TILE - c.x) < 36 && Math.abs((d.y + .5) * TILE - c.y) < 36) { d.sealed = false; g.grid.version++; } }
    // wreckage in the way: hack through it
    {
      const wx = Math.floor((c.x + v.x * 22) / TILE), wy = Math.floor((c.y + v.y * 22) / TILE);
      if (g.grid.get(wx, wy) === T.DEBRIS && !inp.fire) { inp.ax = (wx + .5) * TILE; inp.ay = (wy + .5) * TILE; inp.e = true; }
    }
    // their doors don't open for us: smash them
    const ntx = Math.floor((c.x + v.x * 22) / TILE), nty = Math.floor((c.y + v.y * 22) / TILE);
    if (g.grid.get(ntx, nty) === T.DOOR) {
      const d = g.doors[g.grid.doorAt[idx(ntx, nty)]];
      if (d && d.owner === 'them' && d.open < 0.75) { inp.ax = (ntx + .5) * TILE; inp.ay = (nty + .5) * TILE; inp.fire = true; }
    }
  }
  // unstick
  if (inp.mx || inp.my) {
    if (b.lastX !== undefined && Math.abs(b.lastX - c.x) + Math.abs(b.lastY - c.y) < 0.3) { b.stuck = (b.stuck || 0) + dt; if (b.stuck > 0.6) { inp.mx = Math.cos(g.time * 7 + c.id); inp.my = Math.sin(g.time * 7 + c.id); if (b.stuck > 1.2) b.stuck = 0; } }
    else b.stuck = 0;
    b.lastX = c.x; b.lastY = c.y;
  }
  return inp;
}

function onOurShip(g, a) { return tileOwner(g, Math.floor(a.x / TILE), Math.floor(a.y / TILE)) === 'us'; }
function stationTile(r) { return idx(Math.floor(r.station.x / TILE), Math.floor(r.station.y / TILE) + 1); }

function strafe(g, c, t, inp) {
  const a = angTo(t, c) + Math.sin(g.time * 1.3 + c.id) * 1.2;
  inp.mx = Math.cos(a) * 0.6; inp.my = Math.sin(a) * 0.6;
}

const BRAWLERS = new Set(['mrclean', 'commando', 'dog', 'chameleon', 'vaelift', 'agent', 'slots', 'trainer', 'jorbal', 'guard', 'farmer', 'chef']);
const BOARDERS = new Set(['mrclean', 'commando', 'chameleon', 'vaelift', 'dog', 'agent']);

function chooseGoal(g, c, home, enc, clear) {
  const cls = c.cls;
  if (cls === 'urchid') return home ? { kind: 'station', room: home } : { kind: 'idle' };
  const enemiesAboard = g.mobs.filter((m) => m.alive && m.team === 'enemy' && onOurShip(g, m));
  const near = nearestHostile(g, c, 'crew', 6 * TILE, true);
  const sys = (type) => g.rooms.find((r) => r.owner === 'us' && r.type === type);

  // Joe's pod: somebody has to go and get him (the nearest few who aren't flying the ship)
  const joe = g.joe.mob;
  if (joe?.alive && !joe.following && cls !== 'pilot') {
    const rescuers = g.crew.filter((x) => x.alive && x.cls !== 'pilot' && x.cls !== 'urchid').sort((a, b) => dist2(a, joe) - dist2(b, joe)).slice(0, 3);
    if (rescuers.includes(c)) return near && dist(c, near) < 90 ? { kind: 'fight', target: near } : { kind: 'rescue' };
  }
  // fires: MrClean drops everything; anyone else nearby grabs an extinguisher
  const fire = nearestObj(g, c, (o) => o.kind === 'fire', g.objs, cls === 'mrclean' ? 60 * TILE : 9 * TILE);
  if (fire && (!near || dist(c, near) > 140) && (cls === 'mrclean' || (!enemiesAboard.length && cls !== 'pilot') || dist(c, fire) < 4 * TILE)) return { kind: 'fire', o: fire };
  // after a win: strip their ship
  if (g.phase === 'aftermath' && cls !== 'pilot') {
    const crate = nearestObj(g, c, (o) => o.kind === 'crate', g.objs, 80 * TILE);
    if (crate && (BOARDERS.has(cls) || BRAWLERS.has(cls))) return { kind: 'crate', o: crate };
  }
  // a makeshift gun lying around? anyone with a melee weapon (or nothing better) takes it
  if (!c.makeshift && cls !== 'urchid' && (!near || dist(c, near) > 160)) {
    const gun = nearestObj(g, c, (o) => o.kind === 'gun' && o.z === 0, g.pickups, 14 * TILE);
    if (gun && (WEAPONS[CLASSES[cls].weapon]?.kind === 'melee' || g.rng.chance(0.3))) return { kind: 'pickup', p: gun };
  }

  // Pilot lives at the helm
  if (cls === 'pilot') {
    if (near && dist(c, near) < 140) return { kind: 'fight', target: near };
    const helm = sys('bridge'); if (helm) return helm.sys.hp < helm.sys.max * 0.6 && !enc ? { kind: 'repairSys', room: helm } : { kind: 'station', room: helm };
  }
  if (cls === 'missiletech' && enc) {
    if (near && dist(c, near) < 120) return { kind: 'fight', target: near };
    const bay = sys('weapons'); if (bay) return { kind: 'station', room: bay };
  }
  // engineers: engines first, then everything else
  if (cls === 'engineer') {
    const first = enc ? ['weapons', 'shield', 'bridge'] : ['engine'];
    const engines = g.rooms.filter((r) => r.owner === 'us' && r.sys && r.sys.hp < r.sys.max * 0.85).sort((a, b) => (first.includes(a.type) ? 0 : 1) - (first.includes(b.type) ? 0 : 1) || a.sys.hp / a.sys.max - b.sys.hp / b.sys.max);
    if (near && dist(c, near) < 150) return { kind: 'fight', target: near };
    if (engines.length && (!enemiesAboard.length || engines[0].sys.hp < engines[0].sys.max * 0.5)) return { kind: 'repairSys', room: engines[0] };
    if (g.repairCount && !enemiesAboard.length) return { kind: 'repair' };
  }
  // guard sticks to the vault while there are boarders
  if (cls === 'guard' && enemiesAboard.length) {
    const thief = enemiesAboard.find((m) => m.role === 'thief') || near || enemiesAboard[0];
    if (thief) return { kind: 'fight', target: thief };
  }
  if (near && (BRAWLERS.has(cls) || dist(c, near) < 110)) return { kind: 'fight', target: near };
  if (enemiesAboard.length && BRAWLERS.has(cls)) {
    let best = null, bd = Infinity;
    for (const m of enemiesAboard) { const d = dist2(m, c); if (d < bd) { bd = d; best = m; } }
    if (best) return { kind: 'fight', target: best };
  }
  // take the fight to them
  if (enc && g.enemyShip && !enemiesAboard.length && BOARDERS.has(cls) && g.fields[`theirSys${+clear}`]) {
    const tnear = nearestHostile(g, c, 'crew', 9 * TILE, true);
    if (tnear) return { kind: 'fight', target: tnear };
    return { kind: 'board' };
  }
  // repairs in our own room, or anywhere when quiet
  const myRoom = g.rooms[roomAt(g, c)];
  if (myRoom && myRoom.owner === 'us' && myRoom.sys && myRoom.sys.hp < myRoom.sys.max * 0.7) return { kind: 'repairSys', room: myRoom };
  if (!enemiesAboard.length && g.repairCount && (cls === 'guard' || cls === 'mrclean' || g.rng.chance(0.15))) return { kind: 'repair' };

  // class jobs
  if (cls === 'chef' && home && canCookSomething(g)) return { kind: 'station', room: home };
  if (cls === 'scientist' && home && (g.ship.researching || nextResearch(g))) return { kind: 'station', room: home };
  if (cls === 'mrclean' && !enemiesAboard.length) { const m = nearestObj(g, c, (o) => o.kind === 'mess' && onOurShip(g, o)); if (m) return { kind: 'mess', o: m }; }
  if (cls === 'farmer') {
    if ((c.carrying || 0) >= 3 || ((c.carrying || 0) > 0 && !nearestObj(g, c, (o) => o.kind === 'mess' && o.sub === 'dirt'))) { const farm = sys('farm'); if (farm) return { kind: 'station', room: farm }; }
    const m = nearestObj(g, c, (o) => o.kind === 'mess' && o.sub === 'dirt' && onOurShip(g, o)); if (m) return { kind: 'mess', o: m };
    if (home && (g.ship.farm.dirt > 0 || g.ship.farm.plots.some((p) => p.stage > 0))) return { kind: 'station', room: home };
  }
  if (cls === 'trainer' && home && c.monsters.some((m) => m.reviveT > 0)) return { kind: 'station', room: home };
  // grab pickups
  if (!enc && g.pickups.length) {
    const p = nearestObj(g, c, (o) => o.z === 0 && (o.kind !== 'gun' || (!c.makeshift && cls !== 'urchid')), g.pickups, 9 * TILE);
    if (p) return { kind: 'pickup', p };
  }
  if (cls === 'missiletech') { const bay = sys('weapons'); if (bay) return { kind: 'station', room: bay }; }
  return home ? { kind: 'station', room: home } : { kind: 'idle' };
}

function nearestObj(g, c, pred, list = g.objs, maxD = 20 * TILE) {
  let best = null, bd = maxD * maxD;
  for (const o of list) if (pred(o)) { const d = dist2(o, c); if (d < bd) { bd = d; best = o; } }
  return best;
}

export function canCookSomething(g) {
  return RECIPES.some((r) => Object.entries(r.needs).every(([k, v]) => (g.ship.food[k] || 0) >= v));
}
function nextResearch(g) { return RESEARCH.find((r) => !g.ship.research.has(r.id) && g.ship.scrap >= r.scrap + 20); }

function useCombatAbilities(g, c, t, d, inp) {
  const r = g.rng;
  const P = inp.pressed;
  switch (c.cls) {
    case 'engineer': if (c.cd.q <= 0 && g.ship.scrap > 40 && r.chance(0.04)) P.q = true; if (c.cd.f <= 0 && g.ship.scrap > 20 && r.chance(0.03)) P.f = true; break;
    case 'guard': if (c.cd.q <= 0 && d < 150 && r.chance(0.1)) P.q = true; break;
    case 'chef': if (c.cd.q <= 0 && r.chance(0.05)) P.q = true; if (c.cd.f <= 0 && d < 60) P.f = true; break;
    case 'mrclean': if (c.cd.q <= 0 && d < 60 && r.chance(0.2)) P.q = true; break;
    case 'missiletech': if (c.cd.q <= 0 && d > 80 && r.chance(0.05)) P.q = true; break;
    case 'commando': if (c.cd.q <= 0 && d > 90 && r.chance(0.05)) P.q = true; break;
    case 'farmer':
      if (c.cd.q <= 0 && g.ship.scrap > 18 && !g.objs.some((o) => o.kind === 'scarecrow' && o.owner === c.id && dist(o, c) < 300)) P.q = true;
      if (d < 75) inp.rmb = true;   // pitchfork: keep them off
      break;
    case 'scientist': if (r.chance(0.01)) P.q = true; break;
    case 'dog': if (c.cd.q <= 0 && d < 130 && d > 40) P.q = true; if (c.cd.f <= 0 && c.hp < c.maxHp * 0.3) P.f = true; break;
    case 'chameleon': if (!c.cloaked && c.cd.q <= 0 && d > 120) P.q = true; if (c.cd.f <= 0 && c.hp < c.maxHp * 0.4) P.f = true; break;
    case 'trainer': if (c.cd.q <= 0 && t.hp / t.maxHp < 0.35 && !c.monsters.find((m) => m.type === t.type)) P.q = true;
      else if (c.cd.f <= 0 && c.monsters.some((m) => !m.out && m.reviveT <= 0) && !g.mobs.some((m) => m.alive && m.ownerId === c.id)) P.f = true; break;
    case 'jorbal': if (c.cd.q <= 0 && t.r > 14 && r.chance(0.05)) P.q = true; if (c.cd.f <= 0 && g.projs.some((p) => p.kind === 'bubble' && p.trapped && dist(p, c) < 160)) P.f = true; break;
    case 'vaelift': if (c.cd.rmb <= 0 && r.chance(0.02)) P.rmb = true; if (!c.phased && c.hp < c.maxHp * 0.3 && c.cd.q <= 0) P.q = true; if (r.chance(0.005)) P.f = true; break;
    case 'agent': if (c.cd.q <= 0 && r.chance(0.03)) P.q = true; break;
    case 'slots': if (c.cd.q <= 0 && d < 160 && r.chance(0.08)) P.q = true; break;
    case 'missiletech_saw': break;
  }
  if (c.cls === 'missiletech' && d < 50) inp.rmb = true;
  // close the gap with a dash (the melee crowd loves it)
  const w = weaponOf(c);
  if (w.kind === 'melee' && d > 90 && d < 220 && (c.stam ?? 100) > DASH_COST + 20 && r.chance(0.04)) inp.shift = true;
}

// What a bot does once it's standing at its own station
function stationWork(g, c, room, inp) {
  switch (room.type) {
    case 'kitchen': if (!c.cooking) { const r = RECIPES.find((x) => Object.entries(x.needs).every(([k, v]) => (g.ship.food[k] || 0) >= v)); if (r) g.command(c, { t: 'cook', recipe: r.id }); } break;
    case 'lab': if (!g.ship.researching) { const r = nextResearch(g); if (r) g.command(c, { t: 'research', id: r.id }); } break;   // (bot power routing: g.autoPower)
    case 'farm': {
      const f = g.ship.farm;
      if (c.carrying) inp.pressed.e = true;
      const ripe = f.plots.findIndex((p) => p.stage >= 3); if (ripe >= 0) g.command(c, { t: 'harvest', plot: ripe });
      const empty = f.plots.findIndex((p) => p.stage === 0); if (empty >= 0 && f.dirt > 0) g.command(c, { t: 'plant', plot: empty });
      break;
    }
    case 'weapons':
      // guns in storage go into the rack
      if (c.cls === 'missiletech' && g.ship.items.length && g.ship.guns.length < g.ship.gunSlots) g.command(c, { t: 'install', item: 0 });
      if (g.phase === 'encounter' && g.enemyShip) { if (g.ship.missileTarget == null || !g.rooms[g.ship.missileTarget]?.sys?.hp) g.command(c, { t: 'target', room: pickMissileTarget(g) }); if (g.ship.missileReady) g.command(c, { t: 'fireMissile' }); }
      else if (g.ship.missiles < g.ship.missilesMax && g.ship.scrap >= 12) g.command(c, { t: 'buildMissile' }); break;
    case 'bridge': if (g.phase === 'encounter' && c.cd.q <= 0 && g.enemyShip && g.enemyShip.missileT < 1.2 && g.rng.chance(0.3)) inp.pressed.q = true; break;
    case 'armory': if (g.ship.scrap > 60 && g.rng.chance(0.01)) g.command(c, { t: 'craftGun' }); break;
    case 'vault': if (g.ship.rooms.vaultLevel !== undefined) {} break;
  }
}

export function pickMissileTarget(g) {
  const fighting = new Set((g.enemyShips || []).filter((s) => s.docked && !s.done).map((s) => s.id));
  const theirs = g.rooms.filter((r) => r.owner === 'them' && !r.gone && r.sys && r.sys.hp > 0 && fighting.has(r.esId));
  const order = ['weapons', 'shield', 'bridge', 'engine', 'quarters', 'core'];
  theirs.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return theirs[0] ? g.rooms.indexOf(theirs[0]) : null;
}

// ---------------------------------------------------------------------------
// enemies, creatures and allied monsters
export function mobTick(g, m, dt) {
  if (!m.alive) return;
  if (m.hurtT > 0) m.hurtT -= dt;
  if (m.trapped) return;
  if (m.kx || m.ky) { moveActor(g, m, m.kx * dt, m.ky * dt); m.kx *= 0.85; m.ky *= 0.85; if (Math.abs(m.kx) + Math.abs(m.ky) < 5) m.kx = m.ky = 0; }
  if (m.poisonT > 0) { m.poisonT -= dt; damage(g, m, m.poisonDps * dt, { owner: m.poisonBy, kind: 'poison' }); }
  if (m.acidT > 0) m.acidT -= dt;
  if (m.stunT > 0) { m.stunT -= dt; return; }
  if (m.angryT > 0) m.angryT -= dt;
  m.atkT -= dt * (m.angryT > 0 ? 2 : 1);
  const spd = m.speed * (m.angryT > 0 ? 2 : 1) * (m.slowT > 0 ? 0.5 : 1);
  if (m.slowT > 0) m.slowT -= dt;

  // (Joe first: he's on our team, but he isn't one of the trainer's monsters)
  if (m.isJoe) return joeTick(g, m, dt, spd);
  if (m.team === 'crew') return allyTick(g, m, dt, spd);

  if (m.fearT > 0) { // run!
    m.fearT -= dt;
    const c = nearestHostile(g, m, 'enemy', 400);
    if (c) { const n = norm(m.x - c.x, m.y - c.y); moveActor(g, m, n.x * spd * dt, n.y * spd * dt); }
    return;
  }
  if (m.blindT > 0) { m.blindT -= dt; moveActor(g, m, Math.cos(g.time * 3 + m.id) * spd * 0.4 * dt, Math.sin(g.time * 2 + m.id) * spd * 0.4 * dt); return; }

  const w = EW[m.weapon] || EW.claws;
  const team = m.wild ? 'wild' : 'enemy';
  // target: something we can see
  m.retarget = (m.retarget || 0) - dt;
  if (m.retarget <= 0 || (m.target && !m.target.alive)) {
    m.retarget = 0.5;
    const range = m.defender ? 320 : m.hoarder ? 150 : 520;
    m.target = nearestHostile(g, m, team, range, true);
    if (m.target && m.target.cloaked && dist(m, m.target) > 40) m.target = null;
    // boarders shout at the foxes (and have opinions about the urchid)
    if (m.target?.cls && !m.wild && g.time - (g.tauntAt || -9) > 3.5 && g.rng.chance(0.25)) {
      const urchid = g.crew.find((c) => c.cls === 'urchid' && c.alive && dist(c, m) < 260);
      const text = urchid && g.rng.chance(0.6) ? g.rng.pick(URCHID_TAUNTS) : g.rng.pick(ENEMY_TAUNTS);
      g.tauntAt = g.time;
      g.fx({ t: 'say', id: m.id, text });
    }
  }
  const t = m.target;
  const room = g.rooms[roomAt(g, m)];

  // the Hoarder only fights what gets in its way: it wants our scrap
  if (m.hoarder) return hoarderTick(g, m, dt, spd, w, t, room);

  // attacks of opportunity
  if (t && t.alive) {
    const d = dist(m, t);
    m.facing = angTo(m, t);
    if (d < (w.range + t.r) * (w.kind === 'melee' ? 1 : 1) && m.atkT <= 0) attack(g, m, t, w);
    if (m.defender || m.boss) { // hold position, close in a little
      if (d > (w.kind === 'melee' ? w.range : 160)) chase(g, m, t, spd * 0.7, dt);
      return;
    }
    // nobody's close? (a target far away) — boarders would rather go wreck a room
    if (!m.wild && d > 7 * TILE && m.role !== 'thief' && (m.id % 3) !== 0) { /* fall through to the job below */ }
    else {
      const want = w.kind === 'melee' ? 0 : Math.min(w.range * 0.6, 150);
      if (w.kind === 'melee' || d > want) chase(g, m, t, spd, dt);
      else strafeMob(g, m, t, spd, dt);
      return;
    }
  }
  if (m.defender || m.boss) return;

  // no one close: go do our job. Boarders head for the nearest room and wreck its system; a third of
  // them smash straight through the walls to get there. Wild things just hunt.
  let field = g.fields.toCrew;
  if (!m.wild) field = m.breaker ? g.fields.carveSys : g.fields.toSys;
  if (m.role === 'thief') field = m.carryGems ? g.fields.toExit : g.fields.toVault;
  if (m.role === 'carver' && !m.wild) field = g.fields.carveSys || g.fields.carve;
  if (!field) field = g.fields.toCrew;
  // working at a station: wreck it (everyone), or rob the vault (thieves)
  if (room && room.owner === 'us' && room.sys && dist(m, room.station) < 50 && !m.wild) {
    if (m.role === 'thief' && room.type === 'vault' && !m.carryGems && g.ship.gems > 0) {
      if (room.reinforced > 0) return;
      const take = Math.min(g.ship.gems, 8 + 4 * g.tier);
      const val = Math.round(take * (g.ship.gemValue || take) / g.ship.gems);
      g.ship.gems -= take; g.ship.gemValue = Math.max(0, (g.ship.gemValue || 0) - val); m.carryGems = take; m.carryVal = val;
      g.log('alert', `A ${g.roster[m.type].name} stole ${take} gems from the vault!`);
      g.fx({ t: 'text', x: m.x, y: m.y - 20, text: `-${take} gems`, color: '#e0533a' });
      return;
    }
    if (room.sys.hp > 0 && m.atkT <= 0 && m.role !== 'thief') { m.atkT = 0.6; damageSystem(g, room, (m.role === 'saboteur' ? 6 : 4) * m.dmgMul); g.fx({ t: 'spark', x: room.station.x, y: room.station.y }); m.facing = angTo(m, room.station); return; }
  }
  if (m.role === 'thief' && m.carryGems && room && room.owner === 'them') { // got away
    g.log('alert', `${m.carryGems} gems escaped to the enemy ship. Get them back!`);
    m.alive = false;
    const es = g.enemyShips.find((s) => s.id === room.esId) || g.enemyShip;
    if (es) { es.stolen += m.carryGems; es.stolenVal = (es.stolenVal || 0) + (m.carryVal || m.carryGems); }
    return;
  }
  const s = g.grid.stepToward(field, m.x, m.y);
  if (!s) { // wander
    moveActor(g, m, Math.cos(g.time + m.id) * spd * 0.3 * dt, Math.sin(g.time * 0.7 + m.id) * spd * 0.3 * dt);
    return;
  }
  // blocked by a door / wall / ice? attack it
  const tt = g.grid.get(s.tx, s.ty);
  const blocked = g.grid.solidAt(s.tx, s.ty, g.doors);
  if (blocked && (tt === T.DOOR || tt === T.ICE || tt === T.DEBRIS || (tt === T.WALL && (m.role === 'carver' || m.breaker)))) {
    m.facing = angTo(m, s);
    if (dist(m, s) > TILE * 0.95) { const n = norm(s.x - m.x, s.y - m.y); moveActor(g, m, n.x * spd * dt, n.y * spd * dt); }
    if (m.atkT <= 0) {
      m.atkT = Math.max(0.4, w.rate);
      const dmg = (w.kind === 'melee' ? w.dmg : 10) * m.dmgMul * (w.wallDmg || 1);
      hitTile(g, s.tx, s.ty, dmg);
      g.fx({ t: 'bang', x: s.x, y: s.y });
    }
    return;
  }
  const n = norm(s.x - m.x, s.y - m.y);
  moveActor(g, m, n.x * spd * dt, n.y * spd * dt);
  m.facing = Math.atan2(n.y, n.x);
}

/**
 * The Hoarder: smashes a straight line through the walls to our nearest system, grabs a big chunk of
 * scrap there and heads home. If it makes it back to its ship, the ship cuts loose with our scrap.
 */
function hoarderTick(g, m, dt, spd, w, t, room) {
  if (t && t.alive && dist(m, t) < w.range + t.r + 6 && m.atkT <= 0) { m.facing = angTo(m, t); attack(g, m, t, w); }
  let field;
  if (m.loot) {
    if (room && room.owner === 'them') {
      const es = g.enemyShips.find((s) => s.id === m.esId) || g.enemyShip;
      m.alive = false;
      g.log('alert', `💨 The Hoarder made it home with ${m.loot} of our scrap. Its ship tears loose and digs away!`);
      if (es && !es.done) { es.done = true; es.fled = true; es.detachT = 1; es.scrapStolen = m.loot; }
      return;
    }
    field = g.fields.toExit;
  } else {
    if (room && room.owner === 'us' && room.sys && dist(m, room.station) < 64) {
      const take = Math.min(Math.floor(g.ship.scrap), 40 + 25 * g.tier);
      g.ship.scrap -= take; m.loot = Math.max(1, take);
      damageSystem(g, room, 40 * m.dmgMul);
      g.log('alert', `The Hoarder rips ${take} scrap out of the ${room.name} and turns for home! Stop it!`);
      g.fx({ t: 'text', x: m.x, y: m.y - 40, text: `-${take} scrap`, color: '#e0533a' });
      g.fx({ t: 'say', id: m.id, text: g.rng.pick(['MINE. ALL MINE.', 'SHINY METAL. MINE NOW.', 'HRRRNNGH. TAKING THIS.']) });
      return;
    }
    field = g.fields.carveSys || g.fields.toSys;
  }
  const s = field && g.grid.stepToward(field, m.x, m.y);
  if (!s) return;
  const tt = g.grid.get(s.tx, s.ty);
  if (g.grid.solidAt(s.tx, s.ty, g.doors) && tt !== T.VOID) {
    m.facing = angTo(m, s);
    if (m.atkT <= 0) { m.atkT = 0.9; hitTile(g, s.tx, s.ty, 60 * m.dmgMul, { hull: tt === T.HULL && tileOwner(g, s.tx, s.ty) === 'us' }); g.fx({ t: 'bang', x: s.x, y: s.y }); }
    return;
  }
  const n = norm(s.x - m.x, s.y - m.y);
  moveActor(g, m, n.x * spd * dt, n.y * spd * dt);
  m.facing = Math.atan2(n.y, n.x);
}

function chase(g, m, t, spd, dt) {
  const los = g.grid.los(m.x, m.y, t.x, t.y, g.doors);
  let n;
  if (los) n = norm(t.x - m.x, t.y - m.y);
  else { const s = g.grid.stepToward(m.role === 'carver' ? g.fields.carve : g.fields.toCrew, m.x, m.y); if (!s) return; n = norm(s.x - m.x, s.y - m.y); }
  if (dist(m, t) < m.r + t.r + 2) return;
  moveActor(g, m, n.x * spd * dt, n.y * spd * dt);
}
function strafeMob(g, m, t, spd, dt) {
  const a = angTo(t, m) + Math.sin(g.time * 0.9 + m.id) * 1.3;
  moveActor(g, m, Math.cos(a) * spd * 0.5 * dt, Math.sin(a) * spd * 0.5 * dt);
}

function attack(g, m, t, w) {
  m.atkT = w.rate;
  const mul = m.dmgMul * (m.angryT > 0 ? 1.5 : 1);
  if (m.boss) { bossAttack(g, m, t); return; }
  if (!g.grid.los(m.x, m.y, t.x, t.y, g.doors)) return;
  const team = m.wild ? 'wild' : 'enemy';
  switch (w.kind) {
    case 'melee': damage(g, t, w.dmg * mul, { owner: m, team }); m.swingT = 0.2; g.fx({ t: 'claw', x: t.x, y: t.y, big: m.r > 18 }); if (m.hoarder || m.r > 22) { const n = norm(t.x - m.x, t.y - m.y); t.kx = (t.kx || 0) + n.x * 220; t.ky = (t.ky || 0) + n.y * 220; } break;
    case 'bullet': fireBullet(g, m, angTo(m, t), { ...w, spread: w.spread ?? 0.08 }, team, { mul, acid: !!w.acid }); g.fx({ t: 'eshot', x: m.x, y: m.y, w: m.weapon }); break;
    case 'flame':
      melee(g, m, { dmg: w.dmg * w.rate * mul, range: w.range, arc: 0.6 }, angTo(m, t), team);
      g.fx({ t: 'flame', x: m.x, y: m.y, a: angTo(m, t), r: w.range });
      break;
    case 'bomb':
      spawnProj(g, { kind: 'bomb', sx: m.x, sy: m.y, tx: t.x + g.rng.range(-20, 20), ty: t.y + g.rng.range(-20, 20), x: m.x, y: m.y, dur: 0.8, dmg: w.dmg * mul, radius: 60, team, owner: m, life: 3 });
      break;
  }
}

function bossAttack(g, m, t) {
  m.atkT = 1.4;
  const pattern = (m.pattern = ((m.pattern || 0) + 1) % 3);
  if (pattern === 0) {
    for (let k = -3; k <= 3; k++) { const a = angTo(m, t) + k * 0.22; spawnProj(g, { kind: 'fireball', x: m.x, y: m.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, dmg: 22, radius: 40, team: 'enemy', owner: m, life: 2.5, r: 9 }); }
  } else if (pattern === 1) {
    // (not while its brood already fills the place)
    if (g.mobs.filter((x) => x.alive && x.team === 'enemy').length > 30) { m.pattern = 2; return bossAttack(g, m, t); }
    for (let k = 0; k < 3; k++) g.spawnMob(g.rng.pick(g.roster.filter((r) => r.creature)).idx, m.x + g.rng.range(-60, 60), m.y + g.rng.range(-40, 40), { wild: false });
    g.log('alert', 'The Leviathan spawns its brood!');
  } else {
    if (dist(m, t) < 140) explode(g, m.x, m.y, 150, 40, 'enemy', m, {});
    else for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; spawnProj(g, { kind: 'fireball', x: m.x, y: m.y, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, dmg: 18, radius: 36, team: 'enemy', owner: m, life: 2.5, r: 8 }); }
  }
}

function allyTick(g, m, dt, spd) {
  // captured monsters fight for the trainer
  const t = nearestHostile(g, m, 'crew', 500, true);
  const w = EW[m.weapon] || EW.claws;
  if (t) {
    m.facing = angTo(m, t);
    if (dist(m, t) < w.range + t.r && m.atkT <= 0) {
      m.atkT = w.rate;
      if (w.kind === 'bullet') fireBullet(g, m, m.facing, { ...w, spread: 0.08 }, 'crew', { mul: m.dmgMul });
      else melee(g, m, { dmg: w.kind === 'flame' ? w.dmg * 0.4 : w.dmg, range: w.range, arc: 1.4 }, m.facing, 'crew', { mul: m.dmgMul });
    }
    if (w.kind === 'melee' || dist(m, t) > 160) { const n = norm(t.x - m.x, t.y - m.y); moveActor(g, m, n.x * spd * dt, n.y * spd * dt); }
    return;
  }
  const owner = g.crew.find((c) => c.id === m.ownerId);
  if (owner && dist(owner, m) > 70) { const n = norm(owner.x - m.x, owner.y - m.y); moveActor(g, m, n.x * spd * dt, n.y * spd * dt); }
}

function joeTick(g, m, dt, spd) {
  // Joe: follows the nearest crew member home, throws bombs, fixes doors like a legend
  const t = nearestHostile(g, m, 'crew', 260, true);
  m.atkT -= 0;
  if (t && m.atkT <= 0) {
    m.atkT = 1.6;
    spawnProj(g, { kind: 'grenade', x: m.x, y: m.y, vx: Math.cos(angTo(m, t)) * 360, vy: Math.sin(angTo(m, t)) * 360, dmg: 45, radius: 70, team: 'crew', owner: m, life: 1.2, r: 5 });
    g.fx({ t: 'say', id: m.id, text: g.rng.pick(['Eat this!', 'Bomb out!', 'Not my door!']) });
  }
  if (!m.following) return;
  // fix any damaged door in reach
  for (const d of g.doors) if ((d.broken || d.hp < d.maxHp) && Math.abs((d.x + .5) * TILE - m.x) < 50 && Math.abs((d.y + .5) * TILE - m.y) < 50 && d.owner === 'us') {
    if (d.broken) { const i = d.i; g.rebuild.set(i, (g.rebuild.get(i) || 0) + 120 * dt); if (g.rebuild.get(i) > 40) { g.grid.tiles[i] = T.DOOR; d.broken = false; d.hp = d.maxHp; g.orig.delete(i); g.rebuild.delete(i); g.grid.version++; } }
    else d.hp = Math.min(d.maxHp, d.hp + 80 * dt);
  }
  // still on the pod: head straight for our ship (through the tunnel), whoever came to get him
  const es = g.enemyShips?.find((s) => s.kind === 'pod' && s.docked && !s.gone);
  if (es && !onOurShip(g, m)) {
    const f = fieldTo(g, idx(es.dock.x, es.dock.y + (es.side === 'top' ? 2 : -2)), true);
    const s = g.grid.stepToward(f, m.x, m.y);
    if (s) { const n = norm(s.x - m.x, s.y - m.y); moveActor(g, m, n.x * spd * dt, n.y * spd * dt); m.facing = Math.atan2(n.y, n.x); return; }
  }
  let leader = null, bd = Infinity;
  for (const c of g.crew) if (c.alive) { const d = dist2(c, m); if (d < bd) { bd = d; leader = c; } }
  if (leader && Math.sqrt(bd) > 60) {
    const f = fieldTo(g, idx(Math.floor(leader.x / TILE), Math.floor(leader.y / TILE)), true);
    const s = g.grid.stepToward(f, m.x, m.y);
    const n = s ? norm(s.x - m.x, s.y - m.y) : norm(leader.x - m.x, leader.y - m.y);
    moveActor(g, m, n.x * spd * dt, n.y * spd * dt);
  }
}

// ---------------------------------------------------------------------------
// gadgets
export function updateObjects(g, dt) {
  const remove = new Set();
  for (const o of g.objs) {
    switch (o.kind) {
      case 'turret': {
        o.atkT -= dt;
        if (o.atkT > 0) break;
        const t = nearestHostile(g, o, 'crew', 320, true);
        if (!t) break;
        o.a = angTo(o, t); o.atkT = 0.45 - 0.04 * o.lvl;
        fireBullet(g, { x: o.x, y: o.y, r: 10 }, o.a, { dmg: 7 + 3 * o.lvl, speed: 640, spread: 0.05, range: 340 }, 'crew', { owner: g.crew.find((c) => c.id === o.owner) });
        g.fx({ t: 'shot', x: o.x, y: o.y, a: o.a, w: 'turret' });
        break;
      }
      case 'scarecrow': {
        // launches crows at anything hostile that comes near (more, harder-pecking crows with upgrades)
        o.atkT -= dt;
        if (o.atkT > 0) break;
        const t = nearestHostile(g, o, 'crew', 300, true);
        if (!t) { o.atkT = 0.4; break; }
        o.atkT = Math.max(0.5, 1.5 - 0.1 * o.lvl);
        const owner = g.crew.find((c) => c.id === o.owner);
        const n = 1 + Math.floor((o.lvl + 1) / 3);
        for (let k = 0; k < n; k++) {
          const a = angTo(o, t) + (k - (n - 1) / 2) * 0.5 + g.rng.range(-0.2, 0.2);
          spawnProj(g, { kind: 'crow', x: o.x, y: o.y - 14, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, dmg: (11 + 4 * o.lvl) * (owner?.special ? 1.4 : 1), team: 'crew', owner, life: 2.8, r: 6 });
        }
        g.fx({ t: 'caw', x: o.x, y: o.y });
        break;
      }
      case 'trap': {
        if (o.armT > 0) { o.armT -= dt; break; }
        for (const m of g.mobs) if (m.alive && m.team === 'enemy' && (m.x - o.x) ** 2 + (m.y - o.y) ** 2 < (m.r + 16) ** 2) {
          m.stunT = 2 + 0.5 * o.lvl; damage(g, m, 12 + 4 * o.lvl, { owner: g.crew.find((c) => c.id === o.owner), kind: 'trap' });
          g.fx({ t: 'zap', x: o.x, y: o.y });
          o.charges = (o.charges ?? 3) - 1; o.armT = 1.2;
          if (o.charges <= 0) remove.add(o);
          break;
        }
        break;
      }
      case 'mine': {
        if (o.armT > 0) { o.armT -= dt; break; }
        let go = o.boom;
        if (o.sub === 'timed') { o.t -= dt; if (o.t <= 0) go = true; }
        if (o.sub === 'proximity') for (const m of g.mobs) if (m.alive && m.team === 'enemy' && (m.x - o.x) ** 2 + (m.y - o.y) ** 2 < 34 * 34) go = true;
        if (go) { explode(g, o.x, o.y, o.r, o.dmg, 'crew', g.crew.find((c) => c.id === o.owner), { kind: 'mine' }); remove.add(o); }
        break;
      }
      case 'tnt': o.t -= dt; if (o.t <= 0) { explode(g, o.x, o.y, 120, o.dmg, 'crew', g.crew.find((c) => c.id === o.owner), { kind: 'tnt' }); remove.add(o); } break;
      case 'cloud': {
        o.t -= dt; if (o.t <= 0) { remove.add(o); break; }
        if (o.sub === 'buff') { // the scientist's buff jar: everybody standing in it hits harder and moves faster
          for (const c of g.crew) if (c.alive && (c.x - o.x) ** 2 + (c.y - o.y) ** 2 < o.r * o.r) { addBuff(c, { dmg: 0.25 * o.pot, speed: 0.2, regen: 3 * o.pot }, 6, 'jar'); }
          break;
        }
        for (const m of g.mobs) {
          if (!m.alive || m.team !== 'enemy' || (m.x - o.x) ** 2 + (m.y - o.y) ** 2 > o.r * o.r) continue;
          if (o.sub === 'poison') { m.poisonT = 1; m.poisonDps = 13 * o.pot; m.poisonBy = o.owner; }
          if (o.sub === 'acid') { m.acidT = 2; damage(g, m, 6 * o.pot * dt, { owner: o.owner, kind: 'acid' }); }
          if (o.sub === 'smoke') { m.blindT = Math.max(m.blindT || 0, 0.5); }
        }
        break;
      }
      case 'ice': o.t -= dt; if (o.t <= 0) { if (g.grid.tiles[o.i] === T.ICE) { g.grid.tiles[o.i] = g.iceUnder.get(o.i) ?? T.FLOOR; g.grid.version++; } g.iceUnder.delete(o.i); remove.add(o); } break;
    }
  }
  if (remove.size) g.objs = g.objs.filter((o) => !remove.has(o));
}
