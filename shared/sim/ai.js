// AI: bot crew (each plays its class's job), boarders, defenders, creatures, allied monsters,
// plus the gadgets lying around (turrets, traps, mines, TNT, gas clouds, ice).
import { T, TILE, CLASSES, ENEMY_WEAPONS, RECIPES, RESEARCH, WEAPONS, ENEMY_TAUNTS, URCHID_TAUNTS, THIEVES } from './data.js';
import { idx, inMap, roomCenter, roomPoint } from './grid.js';
import {
  moveActor, damage, explode, spawnProj, fireBullet, melee, hitTile, damageSystem, roomAt, tileOf,
  hostiles, nearestHostile, stat, tileOwner, addBuff, healActor, unstick, ignite,
} from './combat.js';
import { interactTarget, repairTarget, weaponOf, DASH_COST } from './classes.js';
import { clamp, norm, dist, dist2, angTo, uid } from './util.js';

const EW = Object.fromEntries(ENEMY_WEAPONS.map((w) => [w.id, w]));

// ---------------------------------------------------------------------------
// flow fields
const PASS = new Set([T.FLOOR, T.TUNNEL, T.RUBBLE, T.SAND]);

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
    if (t === T.DOOR) {
      const d = g.doors[g.grid.doorAt[i]]; if (!d) return Infinity;
      if (d.sealed && !clear) return Infinity;
      if (d.armored && !d.broken) return Infinity;           // their vault: C4 only
      // somebody shut it on purpose (a blast door across the walkway, say): go round if there's a way round
      if (d.hold === 'closed' && !d.broken) return 60;
      return 1.5;
    }
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
        if (r.owner === 'us' && r.sys && r.sys.hp < r.sys.max) { inp.e = true; inp.ax = r.station.x; inp.ay = r.station.y; if (c.cls === 'engineer') inp.r = true; }
      }
      else point = { x: goal.room.station.x, y: goal.room.station.y + 22 };
      break;
    case 'repairSys': {
      const r = goal.room; point = { x: r.station.x, y: r.station.y + 22 }; field = fieldTo(g, stationTile(r), clear);
      if (dist(c, point) < 24) { point = null; inp.ax = r.station.x; inp.ay = r.station.y; if (c.cls === 'engineer') inp.r = true; inp.e = true; }
      break;
    }
    case 'repair': {
      field = g.fields[`repair${+clear}`];
      const t = repairTarget(g, c);
      if (t) { point = null; inp.ax = (t.tx + .5) * TILE; inp.ay = (t.ty + .5) * TILE; inp.e = true; if (c.cls === 'engineer') inp.r = true; }
      break;
    }
    case 'pickup': point = goal.p; field = fieldTo(g, idx(Math.floor(goal.p.x / TILE), Math.floor(goal.p.y / TILE)), clear); break;
    case 'hunt': { // walk all the way to it, then let rip
      const t = goal.target;
      if (!t?.alive) { b.t = 0; break; }
      inp.ax = t.x; inp.ay = t.y;
      const w = weaponOf(c);
      const d = dist(c, t), range = w.kind === 'melee' ? w.range + t.r : Math.min(w.range || 300, 300);
      if (d < range && g.grid.los(c.x, c.y, t.x, t.y, g.doors)) { inp.fire = true; if (w.kind !== 'melee') { point = null; strafe(g, c, t, inp); } else point = t; useCombatAbilities(g, c, t, d, inp); }
      else { point = t; field = fieldTo(g, idx(Math.floor(t.x / TILE), Math.floor(t.y / TILE)), clear); }
      break;
    }
    case 'walk': point = goal.p; field = fieldTo(g, idx(Math.floor(goal.p.x / TILE), Math.floor(goal.p.y / TILE)), true); if (!goal.pop && dist(c, goal.p) < 20) point = null; break;
    case 'c4': {
      const d = goal.d, p = doorPt(d);
      if (d.broken) { b.t = 0; break; }
      // stand on our side of it, aim at it, plant
      if (dist(c, p) < 58) { point = null; inp.ax = p.x; inp.ay = p.y; if (c.cd.g <= 0) { inp.pressed.g = true; b.t = 0; } }
      else { point = p; field = fieldTo(g, idx(d.x, d.y), clear); }
      break;
    }
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
    // their doors don't open for us: smash them. Ours that someone shut: open it (there was no way round)
    const ntx = Math.floor((c.x + v.x * 22) / TILE), nty = Math.floor((c.y + v.y * 22) / TILE);
    if (g.grid.get(ntx, nty) === T.DOOR) {
      const d = g.doors[g.grid.doorAt[idx(ntx, nty)]];
      if (d && d.owner === 'them' && d.open < 0.75 && !d.armored) { inp.ax = (ntx + .5) * TILE; inp.ay = (nty + .5) * TILE; inp.fire = true; }
      if (d && d.owner === 'us' && d.hold === 'closed' && !d.sealed && d.open < 0.5 && !(b.opened > 0)) { inp.pressed.e = true; b.opened = 1.5; }
    }
    if (b.opened > 0) b.opened -= dt;
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
const doorPt = (d) => ({ x: (d.x + 0.5) * TILE, y: (d.y + 0.5) * TILE });
function stationTile(r) { return idx(Math.floor(r.station.x / TILE), Math.floor(r.station.y / TILE) + 1); }

function strafe(g, c, t, inp) {
  const a = angTo(t, c) + Math.sin(g.time * 1.3 + c.id) * 1.2;
  inp.mx = Math.cos(a) * 0.6; inp.my = Math.sin(a) * 0.6;
}

const BRAWLERS = new Set(['mrclean', 'commando', 'dog', 'chameleon', 'vaelift', 'agent', 'slots', 'trainer', 'jorbal', 'guard', 'farmer', 'chef']);
const BOARDERS = new Set(['mrclean', 'commando', 'chameleon', 'vaelift', 'dog', 'agent']);

function chooseGoal(g, c, home, enc, clear) {
  const cls = c.cls;
  // the island at the end: everybody wanders off to look around
  if (g.phase === 'ending') {
    const b = c.bot;
    if (!b.isl || g.time > b.islT) {
      const sand = [];
      for (let k = 0; k < 40; k++) { const i = g.rng.int(0, g.grid.tiles.length - 1); if (g.grid.tiles[i] === T.SAND) sand.push(i); }
      if (sand.length) { const i = g.rng.pick(sand); b.isl = { x: ((i % g.W) + 0.5) * TILE, y: (((i / g.W) | 0) + 0.5) * TILE }; }
      b.islT = g.time + g.rng.range(6, 14);
    }
    return b.isl ? { kind: 'walk', p: b.isl } : { kind: 'idle' };
  }
  if (cls === 'urchid') return home ? { kind: 'station', room: home } : { kind: 'idle' };
  const enemiesAboard = g.mobs.filter((m) => m.alive && m.team === 'enemy' && onOurShip(g, m));
  const near = nearestHostile(g, c, 'crew', 6 * TILE, true);
  const sys = (type) => g.rooms.find((r) => r.owner === 'us' && r.type === type);
  // the jorbal goes and bumps every trapped enemy it can reach (that's how they turn into food)
  if (cls === 'jorbal') {
    const b = nearestObj(g, c, (p) => p.kind === 'bubble' && p.trapped && !p.dead, g.projs, 9 * TILE);
    if (b) return { kind: 'walk', p: b, pop: true };
  }
  // 013: a vault behind armoured doors? that's what the C4 is for
  if (cls === 'agent' && enc) {
    const d = g.doors.filter((x) => x.armored && !x.broken && !x.gone).sort((a, b2) => dist2(doorPt(a), c) - dist2(doorPt(b2), c))[0];
    if (d && !g.objs.some((o) => o.kind === 'mine' && o.sub === 'c4' && o.door === g.doors.indexOf(d)) && (!near || dist(c, near) > 120)) return { kind: 'c4', d };
  }

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
  // the thing at the core: the fighters go over and finish it (it won't come to us)
  if (enc && g.boss?.alive && !g.boss.walker && (BOARDERS.has(cls) || BRAWLERS.has(cls)) && enemiesAboard.length < 4) {
    const tnear = nearestHostile(g, c, 'crew', 7 * TILE, true);
    if (tnear && tnear !== g.boss) return { kind: 'fight', target: tnear };
    return { kind: 'hunt', target: g.boss };
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
    case 'agent':
      if (c.cd.q <= 0 && d < 160 && r.chance(0.04)) P.q = true;
      if (c.cd.r <= 0 && d < 90 && r.chance(0.04)) P.r = true;
      if (c.cd.f <= 0 && d > 140 && r.chance(0.02)) P.f = true;
      if (g.objs.some((o) => o.kind === 'mine' && o.sub === 'remote' && o.owner === c.id && dist2(o, t) < 60 * 60)) P.rmb = true;
      if (c.cd.space <= 0 && (c.missionRank || 0) >= 2 && r.chance(0.01)) P.space = true;
      break;
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
      else if (c.cls === 'missiletech' && g.ship.items.length && g.ship.scrap > 120 + 25 * (g.ship.rackUp || 0)) g.command(c, { t: 'expandRack' });
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

  // thieving crews never shut up ("har har har")
  if (m.thief && g.rng.chance(dt * 0.12) && g.time - (g.tauntAt || -9) > 2) {
    const T_ = THIEVES.find((x) => x.id === m.thief);
    if (T_) { g.tauntAt = g.time; g.fx({ t: 'say', id: m.id, text: g.rng.pick(T_.says) }); }
  }
  // the special ones
  if (m.hoarder) return shipEaterTick(g, m, dt, spd, w, t, room);
  if (m.walker && m.boss) return walkerTick(g, m, dt, spd, w, t);
  if (m.event === 'burrower') burrowerTick(g, m, dt);
  if (m.event === 'strawberry') return strawberryTick(g, m, dt, spd);

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

// ---------------------------------------------------------------------------
// big things that walk through walls

/** Crush one tile flat (walls, hull, doors, ice, wreckage all become rubble you can repair). */
function crush(g, tx, ty) {
  if (!inMap(tx, ty)) return false;
  const i = idx(tx, ty), t = g.grid.tiles[i];
  if (t === T.DOOR) {
    const d = g.doors[g.grid.doorAt[i]];
    if (d && !d.broken) { d.broken = true; d.hp = 0; d.open = 1; }
    g.orig.set(i, T.DOOR);
  } else if (t === T.ICE) { g.grid.tiles[i] = g.iceUnder.get(i) ?? T.FLOOR; g.iceUnder.delete(i); g.grid.version++; return true; }
  else if (t === T.WALL || t === T.HULL) g.orig.set(i, t);
  else if (t === T.BREACH) g.orig.set(i, T.HULL);
  else if (t === T.DEBRIS) { if (!g.orig.has(i)) g.orig.set(i, T.FLOOR); }
  else return false;
  g.grid.tiles[i] = T.RUBBLE; g.grid.hp[i] = 0; g.grid.version++;
  return true;
}
const SOLIDISH = new Set([T.WALL, T.HULL, T.DOOR, T.ICE, T.DEBRIS, T.BREACH]);
/** Move a huge thing toward a point, through anything. `chew`: seconds per bite of wall (0 = it just bulldozes). */
function plough(g, m, goal, spd, dt, chew) {
  const n = norm(goal.x - m.x, goal.y - m.y);
  m.facing = Math.atan2(n.y, n.x);
  const nx = m.x + n.x * spd * dt, ny = m.y + n.y * spd * dt;
  const R = m.r * 0.7;
  const solid = [];
  for (let ty = Math.floor((ny - R) / TILE); ty <= Math.floor((ny + R) / TILE); ty++) for (let tx = Math.floor((nx - R) / TILE); tx <= Math.floor((nx + R) / TILE); tx++) {
    if (!inMap(tx, ty)) continue;
    const tt = g.grid.tiles[idx(tx, ty)];
    if (!SOLIDISH.has(tt)) continue;
    if (Math.hypot((tx + 0.5) * TILE - nx, (ty + 0.5) * TILE - ny) < R + TILE * 0.5) solid.push([tx, ty]);
  }
  if (solid.length) {
    m.chewT = (m.chewT || 0) - dt;
    if (m.chewT > 0) return false;
    m.chewT = chew;
    for (const [tx, ty] of solid) if (crush(g, tx, ty)) {
      g.fx({ t: 'dust', x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
      if (m.walker) (m.wake ||= []).push({ i: idx(tx, ty), t: g.time + 1.5 });
    }
    g.fx({ t: 'crunch', x: nx, y: ny, big: true });
    return false;
  }
  // walking: dirt outside the ship is no obstacle either
  m.x = clamp(nx, TILE * 2, (g.W - 2) * TILE); m.y = clamp(ny, TILE * 2, (g.grid.tiles.length / g.W - 2) * TILE);
  // anything small in the way gets bowled over
  for (const o of g.objs) if ((o.kind === 'turret' || o.kind === 'scarecrow' || o.kind === 'trap' || o.kind === 'tank') && dist(o, m) < m.r + 10) { o.dead = true; g.fx({ t: 'boom', x: o.x, y: o.y, r: 30 }); }
  return true;
}

/**
 * The Ship-Eater: the main event. It picks the nearest room (ours, or any docked ship's), chews a
 * tunnel straight to it through every wall in the way, and swallows it: the system is gone, the room is
 * wrecked, the hull takes a bite, and it gets bigger and meaner. It eats their ships too.
 */
function shipEaterTick(g, m, dt, spd, w, t) {
  if (t && t.alive && dist(m, t) < w.range + t.r + m.r * 0.4 && m.atkT <= 0) { m.facing = angTo(m, t); attack(g, m, t, w); }
  if (m.eating) {
    const r = g.rooms[m.eating.room];
    m.eating.t -= dt;
    m.chompT = (m.chompT || 0) - dt;
    if (m.chompT <= 0) { m.chompT = 0.45; if (r) g.fx({ t: 'chomp', x: r.station.x, y: r.station.y }); }
    if (!r || r.gone) { m.eating = null; return; }
    if (m.eating.t <= 0) { m.eating = null; eatRoom(g, m, r); }
    return;
  }
  // what it wants is OUR ship. Any other ship docked alongside is a snack on the way; its own ride is
  // only on the menu when there's nothing else left.
  const ate = (m.ate ||= []);
  const key = (r) => (r.owner === 'us' ? `us:${r.sx},${r.sy},${r.type}` : `them:${r.esId}:${r.x0},${r.y0}`);
  const valid = (r) => r && !r.gone && !r.eaten && !ate.includes(key(r)) && r.sys && r.type !== 'core' && (r.owner === 'us' || g.enemyShips.some((s) => s.id === r.esId && s.docked && !s.gone));
  if (!valid(g.rooms[m.goal]) || g.time > (m.goalT || 0)) {
    let best = -1, bd = Infinity;
    g.rooms.forEach((r, i) => { if (!valid(r)) return; const d = dist2(r.station, m) * (r.owner === 'us' ? 1 : r.esId === m.esId ? 60 : 2.5); if (d < bd) { bd = d; best = i; } });
    m.goal = best; m.goalT = g.time + 20;
    if (best >= 0 && g.rng.chance(0.5)) g.fx({ t: 'say', id: m.id, text: g.rng.pick(['HUNGRY.', 'THAT ROOM LOOKS CRUNCHY.', 'NOM. NOM. NOM.', 'MORE SHIP.', 'I EAT SHIPS. YOU ARE A SHIP.']) });
  }
  const r = g.rooms[m.goal];
  if (!r) return;
  const at = { x: r.station.x, y: r.station.y + 24 };
  if (dist(m, at) < m.r + 10) { m.eating = { room: m.goal, t: 5 }; ate.push(key(r)); g.log('alert', `😱 The Ship-Eater is EATING the ${r.owner === 'us' ? '' : 'enemy '}${r.name}! Hit it!`); return; }
  plough(g, m, at, spd, dt, 0.5);
}
function eatRoom(g, m, r) {
  r.eaten = true;
  if (r.sys) damageSystem(g, r, r.sys.hp + 1);
  const p = roomCenter(r);
  g.fx({ t: 'boom', x: p.x, y: p.y, r: 110 });
  g.fx({ t: 'gulp', x: m.x, y: m.y });
  if (r.owner === 'us') {
    const take = Math.min(Math.floor(g.ship.scrap), 30 + 20 * g.tier);
    g.ship.scrap -= take; m.loot = (m.loot || 0) + take;
    // (a big bite out of the hull, but eating alone never sinks us: it's the fight that does)
    if (!g.storyMode) g.ship.hull = Math.max(Math.min(g.ship.hull, g.ship.hullMax * 0.2), g.ship.hull - (15 + 4 * g.tier));
    // it leaves the room a ruin: wreckage everywhere and a hole in the hull
    for (let k = 0; k < 5; k++) { const q = roomPoint(r, g.rng); const tx = Math.floor(q.x / TILE), ty = Math.floor(q.y / TILE); const i = idx(tx, ty); if (g.grid.tiles[i] === T.FLOOR && !g.crew.some((c) => Math.floor(c.x / TILE) === tx && Math.floor(c.y / TILE) === ty)) { g.orig.set(i, T.FLOOR); g.grid.tiles[i] = T.DEBRIS; g.grid.hp[i] = 50; } }
    const walls = g.hullNear(r, 2); if (walls.length) { const wl = g.rng.pick(walls); hitTile(g, wl.x, wl.y, 9999, { hull: true }); }
    g.grid.version++;
    g.log('alert', `💀 The Ship-Eater swallowed our ${r.name} (and ${take} scrap)! Repair it after... if there IS an after.`);
  } else {
    const es = g.enemyShips.find((s) => s.id === r.esId);
    if (es) { es.hull -= es.hullMax * 0.3; if (es.hull <= 0 && !es.done) g.destroyEnemyShip(es); }
    g.log('alert', `The Ship-Eater swallows their ${r.name}! It eats ANY ship. Even its own ride.`);
  }
  // it grows with every meal
  m.fed = (m.fed || 0) + 1;
  m.r = Math.min(m.r * 1.05, 60);
  m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.04);
  m.dmgMul *= 1.04;
  g.fx({ t: 'say', id: m.id, text: g.rng.pick(['*GULP*', 'DELICIOUS SHIP.', 'MORE.', 'BURRRP.']) });
}

/** The Leviathan: out of its hive and straight at us, through everything, crushing the walls to dust. */
function walkerTick(g, m, dt, spd, w, t) {
  // what it walked through settles into wreckage behind it
  if (m.wake?.length) {
    m.wake = m.wake.filter((x) => {
      if (g.time < x.t) return true;
      const tx = x.i % g.W, ty = (x.i / g.W) | 0;
      if (g.grid.tiles[x.i] === T.RUBBLE && g.rng.chance(0.4) && dist2({ x: (tx + .5) * TILE, y: (ty + .5) * TILE }, m) > (m.r + 20) ** 2 && ![...g.crew, ...g.mobs].some((a) => a.alive && Math.floor(a.x / TILE) === tx && Math.floor(a.y / TILE) === ty)) {
        g.grid.tiles[x.i] = T.DEBRIS; g.grid.hp[x.i] = 50; g.grid.version++;
      }
      return false;
    });
  }
  // fireballs and its brood at range, a stomp up close
  if (t && t.alive && m.atkT <= 0 && dist(m, t) < 420) attack(g, m, t, w);
  // and it squashes whoever's underfoot
  for (const c of g.crew) if (c.alive && !c.phased && dist(c, m) < m.r + c.r) {
    damage(g, c, 30 * dt * m.dmgMul, { owner: m, team: 'enemy', kind: 'crush' });
    const n = norm(c.x - m.x, c.y - m.y); c.kx = (c.kx || 0) + n.x * 300 * dt * 10; c.ky = (c.ky || 0) + n.y * 300 * dt * 10;
  }
  // heading: the nearest of us (it can smell us through the walls), else our nearest system
  const prey = nearestHostile(g, m, 'enemy', 3000, false);
  let goal = prey && prey.alive ? prey : null;
  if (!goal) { const r = g.rooms.filter((x) => x.owner === 'us' && x.sys && x.sys.hp > 0).sort((a, b) => dist2(a.station, m) - dist2(b.station, m))[0]; if (r) goal = r.station; }
  if (goal && dist(m, goal) > m.r * 0.6) plough(g, m, goal, spd, dt, 0.15);
  if (g.rng.chance(dt * 0.5)) g.fx({ t: 'stomp', x: m.x, y: m.y });
}

/** Burrowing worms pop out of the hull here and there, eating a hole every time, until somebody kills them. */
function burrowerTick(g, m, dt) {
  m.burrowT = (m.burrowT ?? 5) - dt;
  if (m.burrowT > 0) return;
  m.burrowT = g.rng.range(6, 10);
  const hull = (g.hullTiles || []).filter((i) => g.grid.tiles[i] === T.HULL);
  if (!hull.length) return;
  const i = g.rng.pick(hull), x = i % g.W, y = (i / g.W) | 0;
  const inside = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => g.grid.get(x + dx, y + dy) === T.FLOOR);
  if (!inside) return;
  g.fx({ t: 'burrow', x: m.x, y: m.y });
  hitTile(g, x, y, 9999, { hull: true });
  m.x = (x + inside[0] + 0.5) * TILE; m.y = (y + inside[1] + 0.5) * TILE;
  g.fx({ t: 'burrow', x: m.x, y: m.y });
  // and something might follow it in
  const creatures = g.roster.filter((r) => r.creature && r.tier <= g.tier);
  if (creatures.length && g.rng.chance(0.35)) g.spawnMob(g.rng.pick(creatures).idx, m.x, m.y, { wild: true, markable: false });
}

/** Giant strawberries: they roll. Fast. Straight at you, bouncing off the walls. */
function strawberryTick(g, m, dt, spd) {
  if (!m.roll) { const c = nearestHostile(g, m, 'wild', 800); const n = c ? norm(c.x - m.x, c.y - m.y) : norm(g.rng() - 0.5, g.rng() - 0.5); m.roll = { x: n.x, y: n.y }; }
  const x0 = m.x, y0 = m.y;
  moveActor(g, m, m.roll.x * spd * dt, m.roll.y * spd * dt);
  m.spin = (m.spin || 0) + dt * 10;
  if (Math.abs(m.x - x0) + Math.abs(m.y - y0) < spd * dt * 0.3) { // bonk: bounce off, maybe at someone
    const c = nearestHostile(g, m, 'wild', 600);
    const a = c && g.rng.chance(0.6) ? Math.atan2(c.y - m.y, c.x - m.x) : g.rng() * Math.PI * 2;
    m.roll = { x: Math.cos(a), y: Math.sin(a) };
  }
  for (const c of hostiles(g, 'wild')) if (c.alive && dist(c, m) < m.r + c.r && m.atkT <= 0) {
    m.atkT = 0.6;
    damage(g, c, 12 * m.dmgMul, { owner: m, team: 'wild', kind: 'crush' });
    const n = norm(c.x - m.x, c.y - m.y); c.kx = (c.kx || 0) + n.x * 320; c.ky = (c.ky || 0) + n.y * 320;
    g.fx({ t: 'splat', x: c.x, y: c.y, small: true });
  }
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
    g.log('alert', `${m.name} spawns its brood!`);
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
      // the trainer's starter pets have an element
      const elem = g.roster[m.type]?.elem;
      if (elem && t.alive) elementHit(g, m, t, elem);
    }
    if (w.kind === 'melee' || dist(m, t) > 160) { const n = norm(t.x - m.x, t.y - m.y); moveActor(g, m, n.x * spd * dt, n.y * spd * dt); }
    return;
  }
  const owner = g.crew.find((c) => c.id === m.ownerId);
  if (owner && dist(owner, m) > 70) { const n = norm(owner.x - m.x, owner.y - m.y); moveActor(g, m, n.x * spd * dt, n.y * spd * dt); }
}

function elementHit(g, m, t, elem) {
  const owner = g.crew.find((c) => c.id === m.ownerId);
  switch (elem) {
    case 'grass': t.slowT = Math.max(t.slowT || 0, 2); if (owner) healActor(owner, 3); g.fx({ t: 'elem', x: t.x, y: t.y, elem }); break;
    case 'fire': t.poisonT = 2.5; t.poisonDps = 7 * m.dmgMul; t.poisonBy = owner;
      if (tileOwner(g, Math.floor(t.x / TILE), Math.floor(t.y / TILE)) === 'them' && g.rng.chance(0.3)) ignite(g, Math.floor(t.x / TILE), Math.floor(t.y / TILE), 0.3, true);
      g.fx({ t: 'elem', x: t.x, y: t.y, elem }); break;
    case 'water': { const n = norm(t.x - m.x, t.y - m.y); t.kx = (t.kx || 0) + n.x * 300; t.ky = (t.ky || 0) + n.y * 300; g.fx({ t: 'elem', x: t.x, y: t.y, elem }); break; }
    case 'electric': {
      t.stunT = Math.max(t.stunT || 0, 0.5);
      // the zap jumps to the next one over
      let prev = t;
      for (let k = 0; k < 2; k++) {
        const nx = g.mobs.find((x) => x.alive && x.team === 'enemy' && x !== prev && x !== t && dist(x, prev) < 130);
        if (!nx) break;
        damage(g, nx, 8 * m.dmgMul, { owner: owner || m, team: 'crew', kind: 'zap' }); nx.stunT = Math.max(nx.stunT || 0, 0.4);
        g.fx({ t: 'chain', x: prev.x, y: prev.y, x2: nx.x, y2: nx.y });
        prev = nx;
      }
      g.fx({ t: 'elem', x: t.x, y: t.y, elem });
      break;
    }
  }
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
        // C4 burns down its fuse no matter what (even while "arming")
        if (o.sub === 'c4' || o.sub === 'timed') { o.t -= dt; if (o.sub === 'c4' && g.rng.chance(dt * 12)) g.fx({ t: 'fuse', x: o.x, y: o.y }); }
        if (o.armT > 0) { o.armT -= dt; break; }
        let go = o.boom;
        if ((o.sub === 'timed' || o.sub === 'c4') && o.t <= 0) go = true;
        if (o.sub === 'proximity') for (const m of g.mobs) if (m.alive && m.team === 'enemy' && (m.x - o.x) ** 2 + (m.y - o.y) ** 2 < 34 * 34) go = true;
        if (go) {
          const owner = g.crew.find((c) => c.id === o.owner);
          explode(g, o.x, o.y, o.r, o.dmg, 'crew', owner, { kind: 'mine' });
          // C4 blows doors off their hinges: armoured ones too (the only thing that does)
          if (o.sub === 'c4') for (const d of g.doors) if (!d.broken && !d.gone && Math.hypot((d.x + 0.5) * TILE - o.x, (d.y + 0.5) * TILE - o.y) < 2.4 * TILE) {
            hitTile(g, d.x, d.y, 99999, { c4: true });
            if (d.armored && d.broken) g.log('loot', '💥 The vault door is blown wide open! Get the heavy loot (the chameleon can\'t carry it).');
          }
          remove.add(o);
        }
        break;
      }
      case 'tank': { // 013's little remote tank: rolls toward trouble and shells it
        o.t -= dt; o.atkT -= dt;
        if (o.t <= 0 || o.hp <= 0) { g.fx({ t: 'boom', x: o.x, y: o.y, r: 30 }); remove.add(o); break; }
        const t = nearestHostile(g, o, 'crew', 600, false);
        if (t) {
          const n = norm(t.x - o.x, t.y - o.y);
          o.a = Math.atan2(n.y, n.x);
          if (dist(o, t) > 140) moveActor(g, o, n.x * 90 * dt, n.y * 90 * dt);
          if (o.atkT <= 0 && g.grid.los(o.x, o.y, t.x, t.y, g.doors)) {
            o.atkT = 0.9;
            const owner = g.crew.find((c) => c.id === o.owner);
            spawnProj(g, { kind: 'rocket', x: o.x + n.x * 16, y: o.y + n.y * 16, vx: n.x * 420, vy: n.y * 420, dmg: 26 + 4 * (owner?.missionRank || 0), radius: 50, team: 'crew', owner, life: 1.4, r: 5 });
            g.fx({ t: 'shot', x: o.x, y: o.y, a: o.a, w: 'rocket' });
          }
        }
        // boarders shoot back at it
        for (const p of g.projs) if (p.team === 'enemy' && !p.dead && (p.x - o.x) ** 2 + (p.y - o.y) ** 2 < 16 * 16) { o.hp -= p.dmg || 5; p.life = 0; }
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
      case 'wallbones': o.t -= dt; if (o.t <= 0) remove.add(o); break;
      case 'iceslide': {
        // a kicked ice block: scoops up whatever it hits and carries it; at a wall, everything aboard gets smashed
        o.t -= dt;
        const owner = g.crew.find((c) => c.id === o.owner);
        const nx = o.x + o.vx * dt, ny = o.y + o.vy * dt;
        const ahead = { x: nx + Math.sign(o.vx) * 15, y: ny + Math.sign(o.vy) * 15 };
        const wall = g.grid.blocksShot(Math.floor(ahead.x / TILE), Math.floor(ahead.y / TILE), g.doors);
        for (const m of g.mobs) if (m.alive && m.team === 'enemy' && !o.carry.includes(m.id) && Math.hypot(m.x - nx, m.y - ny) < m.r + 15 && !m.boss && !m.hoarder) { o.carry.push(m.id); damage(g, m, o.dmg * 0.25, { owner, kind: 'ice' }); }
        const carried = o.carry.map((id) => g.mobs.find((m) => m.id === id && m.alive)).filter(Boolean);
        if (wall || o.t <= 0) {
          g.fx({ t: 'boom', x: nx, y: ny, r: 26 }); g.fx({ t: 'text', x: nx, y: ny - 20, text: carried.length ? `SMASH ×${carried.length}` : 'crack', color: '#bfefff' });
          for (const m of carried) { damage(g, m, wall ? o.dmg * (1.6 + 0.4 * carried.length) : o.dmg * 0.4, { owner, kind: 'ice' }); m.stunT = Math.max(m.stunT || 0, 1.2); unstick(g, m); }
          if (owner && carried.length) owner.xp = (owner.xp || 0) + 2 * carried.length;
          remove.add(o);
          break;
        }
        o.x = nx; o.y = ny;
        // they ride on the front of the block, piled up side by side
        carried.forEach((m, k) => { const off = (k - (carried.length - 1) / 2) * 9; m.x = nx + Math.sign(o.vx) * 6 + (o.vy ? off : 0); m.y = ny + Math.sign(o.vy) * 6 + (o.vx ? off : 0); m.stunT = Math.max(m.stunT || 0, 0.3); });
        break;
      }
      case 'ice': o.t -= dt; if (o.t <= 0) { if (g.grid.tiles[o.i] === T.ICE) { g.grid.tiles[o.i] = g.iceUnder.get(o.i) ?? T.FLOOR; g.grid.version++; } g.iceUnder.delete(o.i); remove.add(o); } break;
    }
    if (o.dead) remove.add(o);   // (trampled by something huge)
  }
  if (remove.size) g.objs = g.objs.filter((o) => !remove.has(o));
}
