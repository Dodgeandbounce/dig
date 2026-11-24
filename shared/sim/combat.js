// Movement, weapons, projectiles, explosions, destructible tiles and systems, pickups.
import { T, TILE, TILE_HP, WEAPONS, ENEMY_WEAPONS, CLASSES, SLOT_W, SLOT_H, BULLET_SLOW, GEMS, GEM_ORDER, MAP_W, MAP_H, CLASS_UP_MAX, xpCost, CANDY, DEATH_LINES } from './data.js';
import { idx, inMap, rw, rh, roomCenter } from './grid.js';
import { clamp, norm, dist, dist2, angTo, angDiff, uid } from './util.js';

// ---------------------------------------------------------------------------
// experience: doing your job earns XP (blue "+xp" pops up now and then so you know it counted)
export function gainXp(g, c, n) {
  if (!c || !c.cls || !(n > 0)) return;
  c.xp = (c.xp || 0) + n;
  c.xpEarned = (c.xpEarned || 0) + n;
  c.xpPop = (c.xpPop || 0) + n;
  if (c.xpPop >= 1 && g.time - (c.xpPopAt || -9) > 0.7) {
    g.fx({ t: 'xp', x: c.x + g.rng.range(-8, 8), y: c.y - 22, n: Math.round(c.xpPop), crew: c.id });
    c.xpPop = 0; c.xpPopAt = g.time;
  }
}

// ---------------------------------------------------------------------------
// gems: all sorts, worth different amounts (deeper = richer)
export function gemType(g) {
  const tier = g.tier || 0;
  const w = {};
  for (const k of GEM_ORDER) { const G = GEMS[k]; if (G.depth > tier + 1) continue; w[k] = G.depth > tier ? 0.4 : (1 + tier - G.depth * 0.5) / Math.sqrt(G.value); }
  return g.rng.weighted(w);
}
/** Put n gems of random kinds in the vault (as many as fit). Returns how many went in. */
export function addGems(g, n, sub) {
  const s = g.ship;
  const fit = Math.max(0, Math.min(n, s.gemCap - s.gems));
  for (let k = 0; k < fit; k++) { const t = sub || gemType(g); s.gems++; s.gemValue = (s.gemValue || 0) + GEMS[t].value; g.stats.gems += GEMS[t].value; }
  return fit;
}

// ---------------------------------------------------------------------------
// stats & buffs
export function stat(a, key) {
  let v = 0;
  if (a.buffs) for (const b of a.buffs) if (b[key]) v += b[key];
  return v;
}
export function addBuff(a, buff, dur, tag) {
  if (!a.buffs) a.buffs = [];
  if (tag) a.buffs = a.buffs.filter((b) => b.tag !== tag);
  a.buffs.push({ ...buff, t: dur, tag });
}
export function tickBuffs(a, dt) {
  if (!a.buffs) return;
  for (const b of a.buffs) b.t -= dt;
  a.buffs = a.buffs.filter((b) => b.t > 0);
}

// ---------------------------------------------------------------------------
// movement with tile collision (circle vs solid tiles)
export function moveActor(g, a, dx, dy) {
  // phased (the vaelift in the empty dimension): walls don't exist. Coming back inside one does, though.
  // (bots stay out of the walls: they'd never get the timing right)
  if (a.phased && a.cls && a.human) { a.x = clamp(a.x + dx, TILE * 1.5, (MAP_W - 1.5) * TILE); a.y = clamp(a.y + dy, TILE * 1.5, (MAP_H - 1.5) * TILE); return; }
  if (dx) { a.x += dx; if (collides(g, a)) { a.x -= dx; slide(g, a, dx, 0); } }
  if (dy) { a.y += dy; if (collides(g, a)) { a.y -= dy; slide(g, a, 0, dy); } }
}
function slide(g, a, dx, dy) {
  // try a smaller step so we hug walls
  const s = 0.35;
  a.x += dx * s; a.y += dy * s;
  if (collides(g, a)) { a.x -= dx * s; a.y -= dy * s; }
}
export function collides(g, a) {
  const r = a.r;
  const x0 = Math.floor((a.x - r) / TILE), x1 = Math.floor((a.x + r) / TILE);
  const y0 = Math.floor((a.y - r) / TILE), y1 = Math.floor((a.y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!g.grid.solidAt(tx, ty, g.doors)) continue;
    if (a.ghostDoors && g.grid.get(tx, ty) === T.DOOR) continue;
    // circle-rect
    const cx = clamp(a.x, tx * TILE, tx * TILE + TILE), cy = clamp(a.y, ty * TILE, ty * TILE + TILE);
    if ((a.x - cx) ** 2 + (a.y - cy) ** 2 < r * r) return true;
  }
  return false;
}
/** Stuck inside something solid (a wall got rebuilt on top of you)? Get pushed out to the nearest free spot. */
export function unstick(g, a) {
  // (standing in a doorway doesn't count: the door opens for you)
  const ghost = a.ghostDoors; a.ghostDoors = true;
  const done = () => { a.ghostDoors = ghost; };
  if (!collides(g, a)) { done(); return false; }
  const x0 = a.x, y0 = a.y;
  for (let r = 4; r <= 72; r += 4) for (let k = 0; k < 16; k++) {
    const ang = k / 16 * Math.PI * 2;
    a.x = x0 + Math.cos(ang) * r; a.y = y0 + Math.sin(ang) * r;
    if (!collides(g, a)) { done(); return true; }
  }
  a.x = x0; a.y = y0;
  done();
  return false;
}
export const tileOf = (p) => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
export const roomAt = (g, p) => { const t = tileOf(p); return inMap(t.x, t.y) ? g.grid.room[idx(t.x, t.y)] : -1; };

// ---------------------------------------------------------------------------
// who can be hit. Three sides: our crew (and the trainer's monsters), the boarders, and the wild things
// that crawl in through holes in the hull. The wild ones go for everybody, and the boarders fight back.
export function hostiles(g, team) {
  if (team === 'crew') return g.mobs.filter((m) => m.alive && m.team === 'enemy');
  const out = [];
  for (const c of g.crew) if (c.alive && !c.phased && !c.invuln) out.push(c);
  for (const m of g.mobs) if (m.alive && (m.team === 'crew' || (m.team === 'enemy' && (team === 'wild' ? !m.wild : m.wild)))) out.push(m);
  return out;
}
export function nearestHostile(g, from, team, maxD = Infinity, needLos = false) {
  let best = null, bd = maxD * maxD;
  for (const h of hostiles(g, team)) {
    if (team !== 'crew' && h.cloaked && dist2(from, h) > 40 * 40) continue;
    if (team === 'enemy' && h.disguise != null) continue;   // 013 in their uniform: one of them, obviously
    const d = dist2(from, h);
    if (d < bd && (!needLos || g.grid.los(from.x, from.y, h.x, h.y, g.doors))) { bd = d; best = h; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// damage
export function damage(g, t, amt, src = {}) {
  if (!t.alive || amt <= 0) return 0;
  if (t.invuln || t.phased) return 0;
  // hitting someone stuck in a bubble pops it: out they tumble, dazed, and the hit lands
  if (t.trapped) {
    if (src.team !== 'crew' && !(src.owner?.team === 'crew')) return 0;
    const b = t.trapped;
    popBubble(g, b, null);
    t.stunT = Math.max(t.stunT || 0, 0.8);
  }
  if (t.team === 'crew' && g.storyMode && !t.isMonster) return 0;
  let mul = 1;
  mul += stat(t, 'armor') < 0 ? -stat(t, 'armor') : 0;
  if (t.acidT > 0) mul += 0.3;
  if (t.armor) mul -= t.armor;
  if (t.reinforced) mul -= 0.5;
  amt *= Math.max(0.1, mul);
  if (t.cls && t.hp > t.maxHp * 0.3 && t.hp - amt <= t.maxHp * 0.3 && t.hp - amt > 0) g.quip?.(t, 'hurt');
  t.hp -= amt;
  t.hurtT = 0.15;
  g.fx({ t: 'hit', x: t.x, y: t.y, team: t.team, amt: Math.round(amt) });
  if (t.cloaked && t.team === 'crew') t.cloakBreak = 1;
  if (src.owner && t.team === 'enemy') t.lastHitBy = src.owner;
  if (t.hp <= 0) {
    if (t.team === 'crew' && !t.isMonster && !t.isJoe) downCrew(g, t);
    else killMob(g, t, src);
  }
  return amt;
}

export function downCrew(g, c, how) {
  if (c.cls === 'urchid') { c.hp = 1; return; }
  c.alive = false; c.hp = 0;
  c.downT = (g.ship.research.has('autodoc') ? 6 : 10) * (g.ship.rooms?.quarters ? 0.8 : 1);
  c.riding = null; c.cloaked = false; c.phased = false; c.disguise = null;
  // everybody goes out in character, flipping over with their tongue out, and nobody believes it
  c.deadT = 0; c.dieSeed = g.rng.int(0, 999);
  const line = how || g.rng.pick(DEATH_LINES[c.cls] || ['No way. NO WAY.']);
  c.say = line; c.sayT = 3.2;
  g.fx({ t: 'down', x: c.x, y: c.y, cls: c.cls, id: c.id });
  g.fx({ t: 'say', id: c.id, text: line });
  g.log('combat', `${c.name} is down! "${line}"`);
  // drop a little money
  const lost = Math.min(c.wallet, 5);
  c.wallet -= lost;
}

export function killMob(g, m, src = {}) {
  m.alive = false;
  m.hp = 0;
  if (m.isJoe) { g.joeDied(); return; }
  if (m.team === 'crew' && m.isMonster) { // summoned monster KO -> back to the pen
    const owner = g.crew.find((c) => c.id === m.ownerId);
    const mon = owner?.monsters?.find((x) => x.type === m.type);
    if (mon) { mon.out = false; mon.reviveT = 40 * (1 - 0.15 * (owner.upgrades[1] || 0)); }
    g.fx({ t: 'poof', x: m.x, y: m.y });
    return;
  }
  const type = g.roster[m.type];
  const killer = src.owner && src.owner.team === 'crew' ? (src.owner.isMonster ? g.crew.find((c) => c.id === src.owner.ownerId) : src.owner) : null;
  let money = type.bounty;
  if (killer && !killer.isMonster) {
    if (src.kind === 'coin') money *= 2;
    if (killer.coinWinT > 0) money *= killer.coinWinMul || 2;
    if (stat(killer, 'gold') > 0) money *= 2;   // yellow candy
    if (m.marked && src.kind === 'ppk') { // Agent mission complete
      const bonus = 30 + type.tier * 25 + (killer.missionRank || 0) * 10;
      money += bonus;
      killer.missionRank = (killer.missionRank || 0) + 1;
      g.log('loot', `🎯 Mission complete. ${killer.name} earns ${bonus} for the mark.`);
      g.fx({ t: 'text', x: m.x, y: m.y - 20, text: `MARK +${bonus}`, color: '#f4c542' });
    }
    killer.wallet += Math.round(money);
    killer.kills = (killer.kills || 0) + 1;
    if (killer.cls && g.rng.chance(0.3)) g.quip?.(killer, 'kill');
    g.stats.kills++;
    gainXp(g, killer, 2 + type.tier * 1.2 + (m.marked ? 20 : 0) + (m.hoarder ? 60 : 0));
    if (killer.cls === 'dog' && src.kind === 'bite') { killer.hp = Math.min(killer.maxHp, killer.hp + 12); g.fx({ t: 'text', x: killer.x, y: killer.y - 20, text: 'nom', color: '#f0a030' }); }
  }
  g.stats.score += type.bounty * 10;
  // the mark is down (by the agent or not): a new secret report comes in with the next target
  if (m.marked) { m.marked = false; g.nextMark?.(); }
  // carrying our gems? they spill out
  if (m.event === 'strawberry') { for (let k = 0; k < 3; k++) dropPickup(g, m.x + g.rng.range(-20, 20), m.y + g.rng.range(-20, 20), 'crop', 1); g.fx({ t: 'splat', x: m.x, y: m.y }); }
  // drops
  if (m.carryGems) { const p = dropPickup(g, m.x, m.y, 'gem', m.carryGems); p.val = m.carryVal; }
  if (m.loot) { g.ship.scrap += m.loot; g.log('loot', `The Hoarder drops our ${m.loot} scrap!`); g.fx({ t: 'text', x: m.x, y: m.y - 30, text: `+${m.loot} scrap back`, color: '#c0c0c0' }); }
  if (m.hoarder) for (let k = 0; k < 8; k++) dropPickup(g, m.x + g.rng.range(-40, 40), m.y + g.rng.range(-40, 40), 'gem', 1, gemType(g));
  if (src.kind === 'fire') { addMess(g, m.x, m.y, 'ash', 1); g.fx({ t: 'die', x: m.x, y: m.y, color: type.color, size: m.r }); return; }
  if (src.kind === 'crush') { for (let i = 0; i < 6; i++) dropPickup(g, m.x + g.rng.range(-20, 20), m.y + g.rng.range(-20, 20), 'coin', 2); g.fx({ t: 'coins', x: m.x, y: m.y }); }
  else if (g.rng.chance(0.35)) { if (g.rng.chance(0.6)) dropPickup(g, m.x, m.y, 'gem', 1, gemType(g)); else dropPickup(g, m.x, m.y, 'ore', 1 + type.tier); }
  if (src.kind === 'jorbal') { dropPickup(g, m.x2 ?? m.x, m.y2 ?? m.y, 'food', 1, g.rng.pick(['grub', 'shroom', 'fish', 'spice'])); }
  addMess(g, m.x, m.y, 'gore', 1);
  // every species has its own strange death yell (voice: a number the sound engine turns into a cry)
  g.fx({ t: 'die', x: m.x, y: m.y, color: type.color, size: m.r, voice: voiceOf(type), big: m.r > 22 });
  if (m.boss) g.bossDied();
}
/** A stable "voice" per species: same kind, same scream. */
export function voiceOf(type) { let h = 7; for (const ch of String(type.name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 100000; }

export function healActor(a, amt) { if (a.alive) a.hp = Math.min(a.maxHp * (1 + stat(a, 'maxhp')), a.hp + amt); }

// ---------------------------------------------------------------------------
// tiles & systems
export function hitTile(g, tx, ty, dmg, src = {}) {
  if (!inMap(tx, ty)) return false;
  const i = idx(tx, ty);
  const t = g.grid.tiles[i];
  if (t === T.DOOR) {
    const d = g.doors[g.grid.doorAt[i]];
    if (!d || d.broken) return false;
    // armoured vault doors shrug off everything but C4
    if (d.armored && !src.c4) { if (g.rng.chance(0.2)) g.fx({ t: 'text', x: (tx + .5) * TILE, y: (ty + .5) * TILE - 14, text: 'ARMOURED: C4 only', color: '#c0c0c0' }); return true; }
    d.hp -= dmg * (d.reinforced > 0 ? 0.5 : 1);
    if (d.hp <= 0) {
      d.broken = true; d.hp = 0; d.open = 1; g.orig.set(i, T.DOOR);
      // sometimes the doorway caves in and blocks the way, sometimes it's just a gaping hole
      const blocked = d.owner === 'us' && g.rng.chance(0.35);
      g.grid.tiles[i] = blocked ? T.DEBRIS : T.RUBBLE; g.grid.hp[i] = blocked ? TILE_HP[T.DEBRIS] : 0;
      g.grid.version++; g.fx({ t: 'boom', x: (tx + .5) * TILE, y: (ty + .5) * TILE, r: 30 });
      g.log('alert', blocked ? 'A door was smashed and the doorway caved in! Clear the wreckage (hold E).' : 'A door was smashed open!');
    }
    return true;
  }
  if (t === T.DEBRIS) {
    // wreckage can be blasted through
    g.grid.hp[i] -= dmg;
    if (g.grid.hp[i] <= 0) { g.grid.tiles[i] = T.RUBBLE; g.grid.hp[i] = 0; g.grid.version++; g.fx({ t: 'boom', x: (tx + .5) * TILE, y: (ty + .5) * TILE, r: 20 }); }
    return true;
  }
  if (t === T.WALL || t === T.ICE || (t === T.HULL && src.hull)) {
    g.grid.hp[i] -= dmg;
    if (g.grid.hp[i] <= 0) {
      if (t === T.ICE) { g.grid.tiles[i] = g.iceUnder.get(i) ?? T.FLOOR; g.iceUnder.delete(i); }
      else if (t === T.HULL) { g.orig.set(i, T.HULL); g.grid.tiles[i] = T.BREACH; g.grid.hp[i] = 0; g.log('alert', 'Hull breach! Dirt is pouring in.'); g.tip?.('breach', 'Breaches leak dirt and slowly drain the hull. Stand next to one and hold E to patch it (costs a little scrap).'); }
      else { g.orig.set(i, T.WALL); g.grid.tiles[i] = T.RUBBLE; g.grid.hp[i] = 0; }
      g.grid.version++;
      g.fx({ t: 'boom', x: (tx + .5) * TILE, y: (ty + .5) * TILE, r: 26 });
    }
    return true;
  }
  return false;
}

export function damageSystem(g, room, amt, src) {
  if (!room?.sys) return;
  const before = room.sys.hp;
  room.sys.hp = Math.max(0, room.sys.hp - amt);
  if (before > 0 && room.sys.hp === 0) {
    g.log('alert', `${room.owner === 'us' ? '' : 'Enemy '}${room.name} system destroyed!`);
    g.fx({ t: 'boom', x: room.station.x, y: room.station.y, r: 50 });
    g.onSystemDestroyed?.(room);
  }
}

// ---------------------------------------------------------------------------
// projectiles
const SLOWED = new Set(['bullet', 'ppk', 'coin', 'knife', 'rocket', 'fireball', 'scrap']);
export function spawnProj(g, p) {
  p.id = uid(); p.life ??= 2; p.r ??= 4; p.t = 0;
  // slower bullets, same range: you can see them coming and dodge
  if (SLOWED.has(p.kind) && p.vx !== undefined) { p.vx *= BULLET_SLOW; p.vy *= BULLET_SLOW; p.life /= BULLET_SLOW; }
  g.projs.push(p);
  return p;
}

export function fireBullet(g, a, ang, w, team, extra = {}) {
  const pellets = w.pellets || 1;
  for (let k = 0; k < pellets; k++) {
    const s = ang + (g.rng() - 0.5) * (w.spread || 0) * (pellets > 1 ? 1 : 2);
    spawnProj(g, { kind: extra.kind || 'bullet', x: a.x + Math.cos(s) * (a.r + 4), y: a.y + Math.sin(s) * (a.r + 4), vx: Math.cos(s) * w.speed, vy: Math.sin(s) * w.speed,
      dmg: w.dmg * (extra.mul || 1), team, owner: a, life: (w.range || 500) * (1 + stat(a, 'range')) / w.speed, ...extra });
  }
}

export function explode(g, x, y, radius, dmg, team, owner, opts = {}) {
  g.fx({ t: 'boom', x, y, r: radius });
  const targets = team === 'crew' ? g.mobs.filter((m) => m.alive && m.team === 'enemy') : hostiles(g, team);
  for (const t of targets) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < radius + t.r) damage(g, t, dmg * (1 - 0.5 * d / (radius + t.r)), { owner, kind: opts.kind || 'boom', team });
  }
  if (opts.selfHarm && owner?.alive) { /* never hurt own crew */ }
  // structures: enemy bombs breach our ship; our explosives damage enemy ship structure only
  const tr = Math.ceil(radius / TILE);
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
  for (let ty = cy - tr; ty <= cy + tr; ty++) for (let tx = cx - tr; tx <= cx + tr; tx++) {
    if (!inMap(tx, ty)) continue;
    if (Math.hypot((tx + .5) * TILE - x, (ty + .5) * TILE - y) > radius) continue;
    const ri = g.grid.room[idx(tx, ty)];
    const theirs = tileOwner(g, tx, ty) === 'them';
    if (team !== 'crew' && !theirs) hitTile(g, tx, ty, (opts.wallDmg ?? dmg) * 0.6, { hull: opts.hull });
    if (team === 'crew' && theirs) hitTile(g, tx, ty, dmg * 0.5, { hull: false });
  }
  // enemy bombs and fireballs can start fires on our ship
  if (team !== 'crew' && g.rng.chance(opts.kind === 'fireball' ? 0.25 : 0.1)) ignite(g, cx, cy, 0.3);
  // systems in radius
  for (const room of g.rooms) {
    if (!room.sys || !room.alive) continue;
    if (team === 'crew' && room.owner !== 'them') continue;
    if (team !== 'crew' && room.owner !== 'us') continue;
    if (Math.hypot(room.station.x - x, room.station.y - y) < radius + 20) damageSystem(g, room, dmg * 0.5);
  }
}

export function tileOwner(g, tx, ty) {
  const ri = inMap(tx, ty) ? g.grid.room[idx(tx, ty)] : -1;
  if (ri >= 0) return g.rooms[ri]?.owner || 'them';
  const B = g.box;
  return B && tx >= B.x0 && tx <= B.x1 && ty >= B.y0 && ty <= B.y1 ? 'us' : 'them';
}
/** Is this world point inside our ship (rooms, walkway, hull)? */
export function inOurBox(g, x, y) { return tileOwner(g, Math.floor(x / TILE), Math.floor(y / TILE)) === 'us'; }

// ---------------------------------------------------------------------------
// fire: spreads tile to tile, burns people and systems, dies down only when put out
const FIRE_MAX = 90;
export function fireAt(g, i) { return g.objs.find((o) => o.kind === 'fire' && o.i === i); }
export function ignite(g, tx, ty, f = 0.2, theirsToo = false) {
  if (!inMap(tx, ty)) return null;
  const i = idx(tx, ty);
  const t = g.grid.tiles[i];
  if (t !== T.FLOOR && t !== T.RUBBLE) return null;
  const own = tileOwner(g, tx, ty);
  if (own !== 'us' && !(theirsToo && own === 'them')) return null;
  if (g.storyMode && own === 'us') return null;
  const have = fireAt(g, i);
  if (have) { have.f = Math.min(1, have.f + f * 0.5); return have; }
  if (g.objs.filter((o) => o.kind === 'fire').length >= FIRE_MAX) return null;
  const o = { id: uid(), kind: 'fire', i, x: (tx + .5) * TILE, y: (ty + .5) * TILE, f, t: 0 };
  g.objs.push(o);
  return o;
}
/** Set a room on fire in a few places. */
export function igniteRoom(g, room, n = 1) {
  const theirs = room?.owner === 'them';
  if (!room || (g.storyMode && !theirs)) return;
  const first = !theirs && !g.objs.some((o) => o.kind === 'fire');
  for (let k = 0; k < n; k++) {
    const tx = room.x0 + 1 + Math.floor(g.rng() * (rw(room) - 1)), ty = room.y0 + 1 + Math.floor(g.rng() * (rh(room) - 1));
    ignite(g, tx, ty, 0.35, theirs);
  }
  const at = roomCenter(room);
  g.fx({ t: 'fire', x: at.x, y: at.y });
  if (first) {
    g.log('alert', `🔥 Fire in the ${room.name}! Hold E next to it to use your extinguisher (MrClean puts fires out fastest).`);
    const near = g.crew.filter((c) => c.alive).sort((a, b) => dist2(a, at) - dist2(b, at))[0];
    if (near) g.quip?.(near, 'fire', true);
  }
}
export function updateFires(g, dt) {
  const fires = g.objs.filter((o) => o.kind === 'fire');
  if (!fires.length) return;
  const dead = new Set();
  for (const o of fires) {
    o.t += dt;
    o.f = Math.min(1, o.f + dt * 0.05);
    // burns whoever stands in it
    for (const c of g.crew) if (c.alive && !c.invuln && Math.abs(c.x - o.x) < 20 && Math.abs(c.y - o.y) < 20) damage(g, c, 7 * o.f * dt, { team: 'enemy', kind: 'fire' });
    for (const m of g.mobs) if (m.alive && Math.abs(m.x - o.x) < 20 && Math.abs(m.y - o.y) < 20) { m.hp -= 7 * o.f * dt; if (m.hp <= 0) killMob(g, m, { kind: 'fire' }); }
    // and the system in the room
    const ri = g.grid.room[o.i];
    if (ri >= 0 && g.rooms[ri]?.sys && g.rng.chance(dt * 2)) damageSystem(g, g.rooms[ri], 1.2 * o.f);
    // on their ship (our fire gun), their crew has to stop and put it out
    const theirs = ri >= 0 && g.rooms[ri]?.owner === 'them';
    if (theirs) for (const m of g.mobs) if (m.alive && m.team === 'enemy' && !m.wild && Math.abs(m.x - o.x) < 50 && Math.abs(m.y - o.y) < 50) { o.f -= 0.35 * dt; if (o.f <= 0) dead.add(o); }
    // spreads to the next tile (closed doors stop it)
    if (g.rng.chance(dt * 0.09 * o.f)) {
      const x = o.i % g.W, y = (o.i / g.W) | 0;
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][g.rng.int(0, 3)];
      let nx = x + dx, ny = y + dy;
      if (g.grid.get(nx, ny) === T.DOOR) { const d = g.doors[g.grid.doorAt[idx(nx, ny)]]; if (d && d.open > 0.75) { nx += dx; ny += dy; } }
      ignite(g, nx, ny, 0.15, theirs);
    }
    // on a broken tile or after a long time it smoulders out
    if (g.grid.tiles[o.i] !== T.FLOOR && g.grid.tiles[o.i] !== T.RUBBLE) dead.add(o);
    if (o.t > 70 && g.rng.chance(dt * 0.05)) { dead.add(o); addMess(g, o.x, o.y, 'ash', 1); }
  }
  if (dead.size) g.objs = g.objs.filter((o) => !dead.has(o));
}
/** Spray the extinguisher at the nearest fire. MrClean is much better at it. */
export function extinguish(g, c, dt) {
  let best = null, bd = 48 * 48;
  for (const o of g.objs) if (o.kind === 'fire') { const d = dist2(o, c); if (d < bd) { bd = d; best = o; } }
  if (!best) return false;
  const rate = c.cls === 'mrclean' ? 2.4 + 0.4 * (c.upgrades?.[1] || 0) : 0.6;
  best.f -= rate * dt;
  c.spraying = 0.2; c.sprayAt = { x: best.x, y: best.y };
  if (g.rng.chance(dt * 8)) g.fx({ t: 'spray', x: c.x, y: c.y, x2: best.x, y2: best.y });
  if (best.f <= 0) {
    g.objs.splice(g.objs.indexOf(best), 1); g.fx({ t: 'text', x: best.x, y: best.y - 10, text: 'out!', color: '#a0e0ff' });
    if (c.cls === 'mrclean') c.wallet += 1;
    if (c.id != null) gainXp(g, c, c.cls === 'mrclean' ? 4 : 3);
  }
  return true;
}

export function updateProjectiles(g, dt) {
  const keep = [];
  for (const p of g.projs) {
    p.t += dt; p.life -= dt;
    if (p.kind === 'bubble') { updateBubble(g, p, dt); if (p.dead) continue; keep.push(p); continue; }
    if (p.kind === 'jar' || p.kind === 'bomb' || p.kind === 'lob') {
      // lobbed: travel to target point
      const k = Math.min(1, p.t / p.dur);
      p.x = p.sx + (p.tx - p.sx) * k; p.y = p.sy + (p.ty - p.sy) * k; p.z = Math.sin(k * Math.PI) * 40;
      if (k >= 1) { landLob(g, p); continue; }
      keep.push(p); continue;
    }
    if (p.kind === 'crow') { // the scarecrow's crows home in on the nearest thing that isn't us
      let best = null, bd = 420 * 420;
      for (const m of g.mobs) if (m.alive && m.team === 'enemy') { const d = dist2(m, p); if (d < bd) { bd = d; best = m; } }
      const sp = 300;
      if (best) { const n = norm(best.x - p.x, best.y - p.y); p.vx += (n.x * sp - p.vx) * Math.min(1, dt * 4); p.vy += (n.y * sp - p.vy) * Math.min(1, dt * 4); }
      p.a = Math.atan2(p.vy, p.vx);
    }
    const steps = Math.ceil(Math.hypot(p.vx, p.vy) * dt / 10);
    let dead = false;
    for (let s = 0; s < steps && !dead; s++) {
      const nx = p.x + p.vx * dt / steps, ny = p.y + p.vy * dt / steps;
      const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
      if (g.grid.blocksShot(tx, ty, g.doors)) {
        if (p.kind === 'grenade') {
          // bounce
          const ox = Math.floor(p.x / TILE), oy = Math.floor(p.y / TILE);
          if (tx !== ox) p.vx *= -0.6; if (ty !== oy) p.vy *= -0.6; p.vx *= 0.9; p.vy *= 0.9;
          break;
        }
        if (p.kind === 'rocket' || p.kind === 'fireball') { explode(g, p.x, p.y, p.radius || 60, p.dmg, p.team, p.owner, { kind: p.kind, wallDmg: p.wallDmg }); dead = true; break; }
        if (p.kind === 'crow') { p.vx *= -0.7; p.vy *= -0.7; break; }   // crows flap off walls
        if (p.team !== 'crew') hitTile(g, tx, ty, p.dmg * 0.25);
        else if (g.grid.get(tx, ty) === T.DOOR && g.doors[g.grid.doorAt[idx(tx, ty)]]?.owner === 'them') hitTile(g, tx, ty, p.dmg * 0.6);
        g.fx({ t: 'spark', x: p.x, y: p.y });
        dead = true; break;
      }
      p.x = nx; p.y = ny;
      if (p.kind === 'grenade') continue;
      // actor hits
      const targets = p.team === 'crew' ? g.mobs : hostiles(g, p.team);
      for (const t of targets) {
        if (!t.alive || t === p.owner || (p.team === 'crew' && t.team !== 'enemy')) continue;
        if (p.hit && p.hit.has(t.id)) continue;
        if ((t.x - p.x) ** 2 + (t.y - p.y) ** 2 > (t.r + p.r) ** 2) continue;
        if (p.kind === 'cube') { tryCapture(g, p, t); dead = true; break; }
        if (p.kind === 'rocket' || p.kind === 'fireball') { explode(g, p.x, p.y, p.radius || 60, p.dmg, p.team, p.owner, { kind: p.kind }); dead = true; break; }
        damage(g, t, p.dmg, { owner: p.owner, kind: p.kind, team: p.team });
        if (p.stun) t.stunT = Math.max(t.stunT || 0, p.stun);
        if (p.acid) t.acidT = Math.max(t.acidT || 0, 2);
        if (p.pierce) { (p.hit ||= new Set()).add(t.id); continue; }
        dead = true; break;
      }
    }
    if (p.kind === 'grenade' && p.life <= 0) { explode(g, p.x, p.y, p.radius, p.dmg, p.team, p.owner, { kind: 'grenade' }); continue; }
    if (dead || p.life <= 0) continue;
    keep.push(p);
  }
  // (a chain of pops can burst bubbles that were already kept this frame)
  g.projs = keep.filter((p) => !p.dead);
}

function landLob(g, p) {
  if (p.kind === 'bomb') { explode(g, p.x, p.y, p.radius || 60, p.dmg, p.team || 'enemy', p.owner, { wallDmg: p.dmg * 1.6, hull: false }); return; }
  if (p.kind === 'jar') {
    const pot = 1 + 0.3 * (p.owner?.upgrades?.[1] || 0);
    if (p.jar === 'explosive') { explode(g, p.x, p.y, 70, 38 * pot, 'crew', p.owner, { kind: 'jar' }); return; }
    g.objs.push({ id: uid(), kind: 'cloud', sub: p.jar, x: p.x, y: p.y, r: 62, t: 4.5, pot, owner: p.owner });
    g.fx({ t: 'splash', x: p.x, y: p.y, color: p.jar === 'acid' ? '#c0f040' : '#a050e0' });
  }
}

// ---------------------------------------------------------------------------
// melee
export function melee(g, a, w, ang, team, opts = {}) {
  const targets = team === 'crew' ? g.mobs.filter((m) => m.alive && m.team === 'enemy') : hostiles(g, team).filter((t) => t !== a);
  let hits = 0;
  const range = (w.range || 36) * (opts.rangeMul || 1);
  for (const t of targets) {
    const d = Math.hypot(t.x - a.x, t.y - a.y);
    if (d > range + t.r) continue;
    if (Math.abs(angDiff(ang, angTo(a, t))) > (w.arc || 1.2) / 2 && d > t.r + 6) continue;
    let dmg = w.dmg * (opts.mul || 1);
    // a knife in the back: instant kill (bosses and the Hoarder just take a lot). From the front: a normal stab.
    if (w.backstab && isBehind(a, t)) {
      dmg = t.boss || t.hoarder ? dmg * 6 : t.hp + 1;
      g.fx({ t: 'backstab', x: t.x, y: t.y });
      if (a.cls) gainXp(g, a, 4);
    }
    const type = t.type !== undefined ? g.roster[t.type] : null;
    if (opts.vsMeleeWeak && type && ENEMY_WEAPONS.find((x) => x.id === type.weapon)?.meleeWeak) dmg *= opts.vsMeleeWeak;
    damage(g, t, dmg, { owner: a, kind: opts.kind || 'melee', team });
    if (w.knock || opts.knock) { const n = norm(t.x - a.x, t.y - a.y); t.kx = (t.kx || 0) + n.x * (w.knock || opts.knock); t.ky = (t.ky || 0) + n.y * (w.knock || opts.knock); }
    if (opts.stun) t.stunT = Math.max(t.stunT || 0, opts.stun);
    if (w.lifesteal) healActor(a, dmg * w.lifesteal);
    hits++;
  }
  return hits;
}

/** Is the attacker standing behind the target (in the back half, away from where it's looking)? */
export function isBehind(a, t) {
  const f = t.facing || 0;
  const toA = Math.atan2(a.y - t.y, a.x - t.x);
  return Math.abs(angDiff(f, toA)) > Math.PI * 0.62;
}

// ---------------------------------------------------------------------------
// capture cube (Monster Trainer)
function tryCapture(g, p, t) {
  const owner = p.owner;
  const thr = (owner.upgrades[2] || 0) > 0 ? 0.5 : 0.35;
  const type = g.roster[t.type];
  if (t.boss || t.hoarder) { g.fx({ t: 'text', x: t.x, y: t.y - 20, text: 'too big!', color: '#fff' }); return; }
  if (owner.monsters.find((m) => m.type === t.type)) { g.fx({ t: 'text', x: t.x, y: t.y - 20, text: 'already have one', color: '#ccc' }); return; }
  if (t.hp / t.maxHp > thr) { g.fx({ t: 'text', x: t.x, y: t.y - 20, text: 'too healthy', color: '#ccc' }); return; }
  t.alive = false;
  // frenemies come out of the cube twice as tough and twice as mean as they went in
  owner.monsters.push({ type: t.type, name: type.name, out: false, reviveT: 0, hpMul: 2 * (1 + g.rng.range(-0.15, 0.3)), dmgMul: 2 * (1 + g.rng.range(-0.15, 0.3)) });
  g.fx({ t: 'capture', x: t.x, y: t.y });
  g.log('loot', `${owner.name} captured a ${type.name}!`);
  g.stats.captures++;
  gainXp(g, owner, 20);
}

// ---------------------------------------------------------------------------
// Jorbal bubbles: ride the air currents, trap enemies, pop in chains.
//
// The air currents are their own layer, and only the jorbal can see it. They fill the whole ship:
// every open tile has a little arrow saying which way the air pushes, and ALL of it flows, along random
// winding paths, to one or two spots on the ship (picked fresh when the next dig starts). The paths
// shuffle with every docking. Bubbles (and a jorbal riding one) drift along with it.
//
// g.air = { dir: string, one char per tile: 'a'..'h' = one of 8 directions, 's' = a sink, '.' = no air;
//           sinks: [tile index] }
export const AIR_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const AIR_SPEED = 120;
const airOpen = (t) => t === T.FLOOR || t === T.DOOR || t === T.RUBBLE || t === T.TUNNEL;
export function buildAir(g, rng, newSinks = true) {
  const N = MAP_W * MAP_H, G = g.grid, B = g.box;
  // our open tiles (rooms, walkway, doorways)
  const ours = [];
  if (B) for (let y = B.y0; y <= B.y1; y++) for (let x = B.x0; x <= B.x1; x++) { const i = idx(x, y); if (airOpen(G.tiles[i]) && tileOwner(g, x, y) === 'us') ours.push(i); }
  if (!ours.length) return { dir: '', sinks: [] };
  // where it all goes: one or two spots, inside rooms (not the walkway), picked when the dig starts
  let sinks = (g.air?.sinks || []).filter((i) => airOpen(G.tiles[i]));
  if (newSinks || !sinks.length) {
    const inRooms = ours.filter((i) => G.room[i] >= 0 && G.tiles[i] === T.FLOOR);
    const pool = inRooms.length ? inRooms : ours;
    sinks = [rng.pick(pool)];
    if (rng.chance(0.5)) { const far = pool.filter((i) => Math.abs((i % MAP_W) - (sinks[0] % MAP_W)) + Math.abs(((i / MAP_W) | 0) - ((sinks[0] / MAP_W) | 0)) > 20); if (far.length) sinks.push(rng.pick(far)); }
  }
  // flood out from the sinks through every open tile (theirs too, through the tunnel, when docked), with
  // random weights so the paths wind about instead of running in straight lines
  const dist = new Float64Array(N).fill(Infinity);   // (64-bit: it's compared against the heap's own numbers)
  const heap = [];   // simple binary heap of [d, i]
  const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= d) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { let c = 2 * k + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[k][0]) break; [heap[c], heap[k]] = [heap[k], heap[c]]; k = c; } } return top; };
  const wgt = new Float32Array(N); for (let i = 0; i < N; i++) wgt[i] = 1 + rng() * 2.2;
  for (const s of sinks) { dist[s] = 0; push(0, s); }
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + AIR_DIRS[k][0], ny = y + AIR_DIRS[k][1];
      if (!inMap(nx, ny)) continue;
      const j = ny * MAP_W + nx;
      if (!airOpen(G.tiles[j])) continue;
      const nd = d + wgt[j];
      if (nd < dist[j]) { dist[j] = nd; push(nd, j); }
    }
  }
  // every tile points downhill (to one of its lower neighbours, picked at random)
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    if (dist[i] === Infinity) { out[i] = '.'; continue; }
    if (dist[i] === 0) { out[i] = 's'; continue; }
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    const down = [];
    for (let k = 0; k < 8; k++) {
      const nx = x + AIR_DIRS[k][0], ny = y + AIR_DIRS[k][1];
      if (!inMap(nx, ny)) continue;
      const j = ny * MAP_W + nx;
      if (dist[j] >= dist[i]) continue;
      if (k >= 4 && (dist[y * MAP_W + nx] === Infinity || dist[ny * MAP_W + x] === Infinity)) continue;   // no corner cutting
      down.push(k);
    }
    out[i] = down.length ? String.fromCharCode(97 + down[(rng() * down.length) | 0]) : 's';
  }
  return { dir: out.join(''), sinks };
}

/** The wind at a point: the tile's arrow, plus a nudge toward the middle of the tile so you don't scrape walls. */
export function airAt(g, x, y) {
  const a = g.air; if (!a?.dir) return { x: 0, y: 0, on: false };
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (!inMap(tx, ty)) return { x: 0, y: 0, on: false };
  const ch = a.dir.charCodeAt(idx(tx, ty));
  const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
  if (ch === 115) return { x: (cx - x) * 2 + Math.sin(g.time * 3) * 20, y: (cy - y) * 2 + Math.cos(g.time * 3) * 20, on: true, sink: true };   // 's': it all ends up here, swirling
  const k = ch - 97;
  if (k < 0 || k > 7) return { x: 0, y: 0, on: false };
  const [dx, dy] = AIR_DIRS[k], L = k >= 4 ? Math.SQRT1_2 : 1;
  // pull toward the line through the tile centre along the flow
  return { x: dx * L * AIR_SPEED + (dx ? 0 : (cx - x) * 3), y: dy * L * AIR_SPEED + (dy ? 0 : (cy - y) * 3), on: true };
}

function updateBubble(g, p, dt) {
  const air = airAt(g, p.x, p.y);
  // fresh out of the jorbal's mouth it flies where it was blown; then the air takes it
  const grip = p.t < 0.5 ? 0.6 : 2.4;
  p.vx += (air.x - p.vx) * dt * grip; p.vy += (air.y - p.vy) * dt * grip;
  const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
  const tx = Math.floor(nx / TILE), ty = Math.floor(ny / TILE);
  if (g.grid.blocksShot(tx, ty, g.doors)) {
    if (!p.trapped) { popBubble(g, p, null); return; }
    p.vx *= -0.5; p.vy *= -0.5;
  } else { p.x = nx; p.y = ny; }
  if (p.trapped) {
    const e = p.trapped;
    if (!e.alive) { p.trapped = null; popBubble(g, p, null); return; }
    e.x = p.x; e.y = p.y;
    p.hold -= dt;
    if (p.hold <= 0) { // angry! breaks out
      e.trapped = null; e.angryT = 8; p.trapped = null;
      g.fx({ t: 'text', x: e.x, y: e.y - 22, text: 'ANGRY!', color: '#ff4040' });
      popBubble(g, p, null); return;
    }
  } else {
    if (p.life <= 0) { popBubble(g, p, null); return; }
    for (const m of g.mobs) {
      if (!m.alive || m.team !== 'enemy' || m.trapped || m.boss) continue;
      if ((m.x - p.x) ** 2 + (m.y - p.y) ** 2 < (m.r + p.r) ** 2) {
        if (m.r > p.r * 1.25 && !p.big) { popBubble(g, p, null); return; }
        p.trapped = m; m.trapped = p; m.angryT = 0;
        p.hold = 3 + 0.8 * (p.owner?.upgrades?.[0] || 0);   // not for long: then they burst out, angry
        p.r = Math.max(p.r, m.r + 6);
        g.fx({ t: 'text', x: m.x, y: m.y - 20, text: 'blorp', color: '#a0f0ff' });
        break;
      }
    }
  }
  // anybody bumping a bubble pops it. The jorbal turns what's inside into food (and money); anyone
  // else just lets it out, dazed.
  for (const c of g.crew) {
    if (!c.alive || c.riding === p || c.phased) continue;
    if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 >= (c.r + p.r) ** 2) continue;
    if (c.cls === 'jorbal') { if (p.trapped) { popBubble(g, p, c); return; } continue; }   // (empty ones: hop on and ride)
    if (p.trapped) { const e = p.trapped; popBubble(g, p, null); if (e.alive) e.stunT = Math.max(e.stunT || 0, 1); return; }
    if (p.t > 0.4) { popBubble(g, p, null); return; }
  }
}

export function popBubble(g, p, byJorbal, chain = { n: 0, start: null }) {
  if (p.dead) return;
  p.dead = true;
  if (chain.n === 0) chain.start = byJorbal;
  chain.n++;
  g.fx({ t: 'pop', x: p.x, y: p.y, r: p.r });
  for (const c of g.crew) if (c.riding === p) c.riding = null;
  const e = p.trapped;
  if (e && e.alive) {
    e.trapped = null;
    if (chain.start) {
      // launched across the room, becomes food
      const ang = g.rng() * Math.PI * 2;
      e.x2 = e.x + Math.cos(ang) * 90; e.y2 = e.y + Math.sin(ang) * 90;
      g.fx({ t: 'fling', x: e.x, y: e.y, x2: e.x2, y2: e.y2, color: g.roster[e.type].color });
      const bonus = chain.n * (1 + 0.5 * (chain.start.upgrades?.[1] || 0));
      chain.start.wallet += Math.round(4 * bonus);
      gainXp(g, chain.start, 2 + chain.n);
      if (chain.n > 1) g.fx({ t: 'text', x: p.x, y: p.y - 24, text: `CHAIN x${chain.n}!`, color: '#80ff80' });
      e.hp = 0; killMob(g, e, { owner: chain.start, kind: 'jorbal' });
    }
  }
  // chain to neighbours
  for (const q of g.projs) {
    if (q.kind !== 'bubble' || q.dead) continue;
    if ((q.x - p.x) ** 2 + (q.y - p.y) ** 2 < (q.r + p.r + 26) ** 2) popBubble(g, q, byJorbal, chain);
  }
}

// ---------------------------------------------------------------------------
// pickups and messes
export function dropPickup(g, x, y, kind, amt = 1, sub) {
  if (kind === 'gem' && !sub) sub = gemType(g);
  const p = { id: uid(), kind, sub, amt, x: x + g.rng.range(-6, 6), y: y + g.rng.range(-6, 6), z: 0, vz: 0, t: 0 };
  g.pickups.push(p);
  return p;
}
export function rainPickup(g, x, y, kind, amt, sub) {
  if (kind === 'gem' && !sub) sub = gemType(g);
  const p = { id: uid(), kind, sub, amt, x, y, z: 120, vz: 0, t: 0 };
  g.pickups.push(p);
  return p;
}
export function addMess(g, x, y, sub, amt = 1) {
  // merge with a nearby mess
  for (const o of g.objs) if (o.kind === 'mess' && o.sub === sub && Math.abs(o.x - x) < 30 && Math.abs(o.y - y) < 30) { o.amt = Math.min(8, o.amt + amt); return; }
  g.objs.push({ id: uid(), kind: 'mess', sub, x, y, amt });
}

export function updatePickups(g, dt) {
  const keep = [];
  for (const p of g.pickups) {
    p.t += dt;
    if (p.z > 0) { p.vz -= 600 * dt; p.z = Math.max(0, p.z + p.vz * dt); if (p.z === 0) g.fx({ t: 'clink', x: p.x, y: p.y }); keep.push(p); continue; }
    if (p.t > 90) continue;
    let taken = false;
    for (const c of g.crew) {
      if (!c.alive || c.phased) continue;
      const reach = c.cls === 'dog' && p.kind === 'food' ? 24 : 18;
      if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 > (c.r + reach) ** 2) continue;
      if (collect(g, c, p)) { taken = true; break; }
    }
    if (!taken) keep.push(p);
  }
  g.pickups = keep;
}

function collect(g, c, p) {
  const s = g.ship;
  const mul = c.coinWinT > 0 ? (c.coinWinMul || 2) : 1;
  switch (p.kind) {
    case 'gem': {
      const room = s.gemCap - s.gems;
      if (room <= 0) { g.fx({ t: 'text', x: p.x, y: p.y - 10, text: 'vault full!', color: '#e0533a' }); return false; }
      const G = GEMS[p.sub] || GEMS.quartz;
      const n = Math.min(room, Math.round(p.amt * mul));
      const val = p.val ? Math.round(p.val * n / p.amt) : G.value * n;
      s.gems += n; s.gemValue = (s.gemValue || 0) + val; g.stats.gems += val;
      g.fx({ t: 'text', x: p.x, y: p.y - 10, text: p.val ? `+${n} gems back` : `+${n} ${G.name} (${val})`, color: G.color }); break;
    }
    case 'ore': s.scrap += Math.round(p.amt * 3 * mul); g.fx({ t: 'text', x: p.x, y: p.y - 10, text: `+${Math.round(p.amt * 3 * mul)} scrap`, color: '#c0c0c0' }); break;
    case 'food':
      if (c.cls === 'dog') { healActor(c, 15); g.fx({ t: 'text', x: p.x, y: p.y - 10, text: 'chomp', color: '#f0a030' }); break; }
      s.food[p.sub] = (s.food[p.sub] || 0) + p.amt; g.fx({ t: 'text', x: p.x, y: p.y - 10, text: `+${p.sub}`, color: '#f07070' }); break;
    case 'crop': s.food.crops = (s.food.crops || 0) + p.amt; g.fx({ t: 'text', x: p.x, y: p.y - 10, text: '+crop', color: '#c8b040' }); break;
    case 'coin': c.wallet += Math.round(p.amt * mul); g.fx({ t: 'text', x: p.x, y: p.y - 10, text: `+${Math.round(p.amt * mul)}$`, color: '#f4c542' }); break;
    case 'gun':
      if (c.makeshift?.ammo > 0 || c.cls === 'urchid') return false;
      c.makeshift = { ammo: 8 + 2 * (p.sub || 0), lvl: p.sub || 0 };
      g.fx({ t: 'text', x: p.x, y: p.y - 10, text: 'makeshift gun! (LMB)', color: '#90a050' }); break;
    case 'candy': {
      if (c.cls === 'urchid') return false;
      const C = CANDY[p.sub] || CANDY.green;
      if (C.buff) addBuff(c, C.buff, C.dur, `${p.sub} candy`);
      if (C.lightning) c.lightning = Math.max(c.lightning || 0, C.lightning);
      g.fx({ t: 'text', x: p.x, y: p.y - 14, text: C.text, color: C.color === 'rainbow' ? '#ff80ff' : C.color });
      g.fx({ t: 'candy', x: p.x, y: p.y, sub: p.sub, crew: c.id });
      break;
    }
    default: return false;
  }
  g.fx({ t: 'pickup', x: p.x, y: p.y, kind: p.kind });
  return true;
}

export { WEAPONS, CLASSES, dist, dist2, angTo, norm };
