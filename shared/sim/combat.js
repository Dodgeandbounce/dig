// Movement, weapons, projectiles, explosions, destructible tiles and systems, pickups.
import { T, TILE, TILE_HP, WEAPONS, ENEMY_WEAPONS, CLASSES } from './data.js';
import { idx, inMap } from './grid.js';
import { clamp, norm, dist, dist2, angTo, angDiff, uid } from './util.js';

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
export const tileOf = (p) => ({ x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) });
export const roomAt = (g, p) => { const t = tileOf(p); return inMap(t.x, t.y) ? g.grid.room[idx(t.x, t.y)] : -1; };

// ---------------------------------------------------------------------------
// who can be hit
export function hostiles(g, team) {
  if (team === 'crew') return g.mobs.filter((m) => m.alive && m.team === 'enemy');
  const out = [];
  for (const c of g.crew) if (c.alive && !c.phased && !c.invuln) out.push(c);
  for (const m of g.mobs) if (m.alive && m.team === 'crew') out.push(m);
  return out;
}
export function nearestHostile(g, from, team, maxD = Infinity, needLos = false) {
  let best = null, bd = maxD * maxD;
  for (const h of hostiles(g, team)) {
    if (team === 'enemy' && h.cloaked && dist2(from, h) > 40 * 40) continue;
    const d = dist2(from, h);
    if (d < bd && (!needLos || g.grid.los(from.x, from.y, h.x, h.y, g.doors))) { bd = d; best = h; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// damage
export function damage(g, t, amt, src = {}) {
  if (!t.alive || amt <= 0) return 0;
  if (t.invuln || t.phased || t.trapped) return 0;
  if (t.team === 'crew' && g.storyMode && !t.isMonster) return 0;
  let mul = 1;
  mul += stat(t, 'armor') < 0 ? -stat(t, 'armor') : 0;
  if (t.acidT > 0) mul += 0.3;
  if (t.armor) mul -= t.armor;
  if (t.reinforced) mul -= 0.5;
  amt *= Math.max(0.1, mul);
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

function downCrew(g, c) {
  if (c.cls === 'urchid') { c.hp = 1; return; }
  c.alive = false; c.hp = 0;
  c.downT = (g.ship.research.has('autodoc') ? 6 : 10) * (g.ship.rooms?.quarters ? 0.8 : 1);
  c.riding = null; c.cloaked = false; c.phased = false;
  g.fx({ t: 'down', x: c.x, y: c.y });
  g.log('combat', `${c.name} is down!`);
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
    if (m.marked && src.kind === 'ppk') { // Agent mission complete
      const bonus = 30 + type.tier * 25 + (killer.missionRank || 0) * 10;
      money += bonus;
      killer.missionRank = (killer.missionRank || 0) + 1;
      g.log('loot', `🎯 Mission complete. ${killer.name} earns ${bonus} for the mark.`);
      g.fx({ t: 'text', x: m.x, y: m.y - 20, text: `MARK +${bonus}`, color: '#f4c542' });
    }
    killer.wallet += Math.round(money);
    killer.kills = (killer.kills || 0) + 1;
    g.stats.kills++;
    if (killer.cls === 'dog' && src.kind === 'bite') { killer.hp = Math.min(killer.maxHp, killer.hp + 12); g.fx({ t: 'text', x: killer.x, y: killer.y - 20, text: 'nom', color: '#f0a030' }); }
  }
  g.stats.score += type.bounty * 10;
  // drops
  if (m.carryGems) dropPickup(g, m.x, m.y, 'gem', m.carryGems);
  if (src.kind === 'crush') { for (let i = 0; i < 6; i++) dropPickup(g, m.x + g.rng.range(-20, 20), m.y + g.rng.range(-20, 20), 'coin', 2); g.fx({ t: 'coins', x: m.x, y: m.y }); }
  else if (g.rng.chance(0.35)) dropPickup(g, m.x, m.y, g.rng.chance(0.6) ? 'gem' : 'ore', 1 + type.tier);
  if (src.kind === 'jorbal') { dropPickup(g, m.x2 ?? m.x, m.y2 ?? m.y, 'food', 1, g.rng.pick(['grub', 'shroom', 'fish', 'spice'])); }
  addMess(g, m.x, m.y, 'gore', 1);
  g.fx({ t: 'die', x: m.x, y: m.y, color: type.color, size: m.r });
  if (m.boss) g.bossDied();
}

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
    d.hp -= dmg * (d.reinforced > 0 ? 0.5 : 1);
    if (d.hp <= 0) { d.broken = true; d.hp = 0; d.open = 1; g.orig.set(i, T.DOOR); g.grid.tiles[i] = T.RUBBLE; g.grid.version++; g.fx({ t: 'boom', x: (tx + .5) * TILE, y: (ty + .5) * TILE, r: 30 }); g.log('alert', 'A door was smashed open!'); }
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
export function spawnProj(g, p) {
  p.id = uid(); p.life ??= 2; p.r ??= 4; p.t = 0;
  g.projs.push(p);
  return p;
}

export function fireBullet(g, a, ang, w, team, extra = {}) {
  const pellets = w.pellets || 1;
  for (let k = 0; k < pellets; k++) {
    const s = ang + (g.rng() - 0.5) * (w.spread || 0) * (pellets > 1 ? 1 : 2);
    spawnProj(g, { kind: extra.kind || 'bullet', x: a.x + Math.cos(s) * (a.r + 4), y: a.y + Math.sin(s) * (a.r + 4), vx: Math.cos(s) * w.speed, vy: Math.sin(s) * w.speed,
      dmg: w.dmg * (extra.mul || 1), team, owner: a, life: (w.range || 500) / w.speed, ...extra });
  }
}

export function explode(g, x, y, radius, dmg, team, owner, opts = {}) {
  g.fx({ t: 'boom', x, y, r: radius });
  const targets = team === 'crew' ? g.mobs.filter((m) => m.alive && m.team === 'enemy') : hostiles(g, 'enemy');
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
    if (team === 'enemy' && !theirs) hitTile(g, tx, ty, (opts.wallDmg ?? dmg) * 0.6, { hull: opts.hull });
    if (team === 'crew' && theirs) hitTile(g, tx, ty, dmg * 0.5, { hull: false });
  }
  // systems in radius
  for (const room of g.rooms) {
    if (!room.sys || !room.alive) continue;
    if (team === 'crew' && room.owner !== 'them') continue;
    if (team === 'enemy' && room.owner !== 'us') continue;
    if (Math.hypot(room.station.x - x, room.station.y - y) < radius + 20) damageSystem(g, room, dmg * 0.5);
  }
}

export function tileOwner(g, tx, ty) {
  const ri = g.grid.room[idx(tx, ty)];
  if (ri >= 0) return g.rooms[ri].owner;
  return ty < g.ourTopY ? 'them' : 'us';
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
        if (p.team === 'enemy') hitTile(g, tx, ty, p.dmg * 0.25);
        else if (g.grid.get(tx, ty) === T.DOOR && g.doors[g.grid.doorAt[idx(tx, ty)]]?.owner === 'them') hitTile(g, tx, ty, p.dmg * 0.6);
        g.fx({ t: 'spark', x: p.x, y: p.y });
        dead = true; break;
      }
      p.x = nx; p.y = ny;
      if (p.kind === 'grenade') continue;
      // actor hits
      const targets = p.team === 'crew' ? g.mobs : hostiles(g, 'enemy');
      for (const t of targets) {
        if (!t.alive || (p.team === 'crew' && t.team !== 'enemy')) continue;
        if (p.hit && p.hit.has(t.id)) continue;
        if ((t.x - p.x) ** 2 + (t.y - p.y) ** 2 > (t.r + p.r) ** 2) continue;
        if (p.kind === 'cube') { tryCapture(g, p, t); dead = true; break; }
        if (p.kind === 'rocket' || p.kind === 'fireball') { explode(g, p.x, p.y, p.radius || 60, p.dmg, p.team, p.owner, { kind: p.kind }); dead = true; break; }
        damage(g, t, p.dmg, { owner: p.owner, kind: p.kind, team: p.team });
        if (p.stun) t.stunT = Math.max(t.stunT || 0, p.stun);
        if (p.pierce) { (p.hit ||= new Set()).add(t.id); continue; }
        dead = true; break;
      }
    }
    if (p.kind === 'grenade' && p.life <= 0) { explode(g, p.x, p.y, p.radius, p.dmg, p.team, p.owner, { kind: 'grenade' }); continue; }
    if (dead || p.life <= 0) continue;
    keep.push(p);
  }
  g.projs = keep;
}

function landLob(g, p) {
  if (p.kind === 'bomb') { explode(g, p.x, p.y, p.radius || 60, p.dmg, 'enemy', p.owner, { wallDmg: p.dmg * 1.6, hull: false }); return; }
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
  const targets = team === 'crew' ? g.mobs.filter((m) => m.alive && m.team === 'enemy') : hostiles(g, 'enemy');
  let hits = 0;
  const range = (w.range || 36) * (opts.rangeMul || 1);
  for (const t of targets) {
    const d = Math.hypot(t.x - a.x, t.y - a.y);
    if (d > range + t.r) continue;
    if (Math.abs(angDiff(ang, angTo(a, t))) > (w.arc || 1.2) / 2 && d > t.r + 6) continue;
    let dmg = w.dmg * (opts.mul || 1);
    if (w.backstab && (a.cloaked || !t.target || t.target !== a)) dmg *= w.backstab * (opts.backstabMul || 1);
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

// ---------------------------------------------------------------------------
// capture cube (Monster Trainer)
function tryCapture(g, p, t) {
  const owner = p.owner;
  const thr = (owner.upgrades[2] || 0) > 0 ? 0.5 : 0.35;
  const type = g.roster[t.type];
  if (t.boss) { g.fx({ t: 'text', x: t.x, y: t.y - 20, text: 'too big!', color: '#fff' }); return; }
  if (owner.monsters.find((m) => m.type === t.type)) { g.fx({ t: 'text', x: t.x, y: t.y - 20, text: 'already have one', color: '#ccc' }); return; }
  if (t.hp / t.maxHp > thr) { g.fx({ t: 'text', x: t.x, y: t.y - 20, text: 'too healthy', color: '#ccc' }); return; }
  t.alive = false;
  owner.monsters.push({ type: t.type, name: type.name, out: false, reviveT: 0, hpMul: 1 + g.rng.range(-0.2, 0.3), dmgMul: 1 + g.rng.range(-0.2, 0.3) });
  g.fx({ t: 'capture', x: t.x, y: t.y });
  g.log('loot', `${owner.name} captured a ${type.name}!`);
  g.stats.captures++;
}

// ---------------------------------------------------------------------------
// Jorbal bubbles: drift on air currents, trap enemies, pop in chains.
export function airAt(g, x, y) {
  const a = g.air; if (!a) return { x: 0, y: 0 };
  let vx = 0, vy = 0;
  for (const v of a) { // vortex/flow sources
    const dx = x - v.x, dy = y - v.y; const d2 = dx * dx + dy * dy + 900;
    const f = v.s * 4000 / d2;
    vx += -dy * f * v.spin + dx * f * v.out; vy += dx * f * v.spin + dy * f * v.out;
  }
  const n = norm(vx, vy);
  return { x: n.x * 55 + a.drift.x, y: n.y * 55 + a.drift.y };
}

function updateBubble(g, p, dt) {
  const air = airAt(g, p.x, p.y);
  p.vx += (air.x - p.vx) * dt * 1.5; p.vy += (air.y - p.vy) * dt * 1.5;
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
        p.hold = 4 + 1.2 * (p.owner?.upgrades?.[0] || 0);
        p.r = Math.max(p.r, m.r + 6);
        g.fx({ t: 'text', x: m.x, y: m.y - 20, text: 'blorp', color: '#a0f0ff' });
        break;
      }
    }
  }
  // jorbal touch = pop with reward
  for (const c of g.crew) {
    if (c.cls !== 'jorbal' || !c.alive) continue;
    if (c.riding === p) continue;
    if ((c.x - p.x) ** 2 + (c.y - p.y) ** 2 < (c.r + p.r) ** 2 && p.trapped) { popBubble(g, p, c); return; }
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
  g.pickups.push({ id: uid(), kind, sub, amt, x: x + g.rng.range(-6, 6), y: y + g.rng.range(-6, 6), z: 0, vz: 0, t: 0 });
}
export function rainPickup(g, x, y, kind, amt, sub) {
  g.pickups.push({ id: uid(), kind, sub, amt, x, y, z: 120, vz: 0, t: 0 });
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
      const n = Math.min(room, Math.round(p.amt * mul)); s.gems += n; g.stats.gems += n;
      g.fx({ t: 'text', x: p.x, y: p.y - 10, text: `+${n} gem`, color: '#5ec8e8' }); break;
    }
    case 'ore': s.scrap += Math.round(p.amt * 3 * mul); g.fx({ t: 'text', x: p.x, y: p.y - 10, text: `+${Math.round(p.amt * 3 * mul)} scrap`, color: '#c0c0c0' }); break;
    case 'food':
      if (c.cls === 'dog') { healActor(c, 15); g.fx({ t: 'text', x: p.x, y: p.y - 10, text: 'chomp', color: '#f0a030' }); break; }
      s.food[p.sub] = (s.food[p.sub] || 0) + p.amt; g.fx({ t: 'text', x: p.x, y: p.y - 10, text: `+${p.sub}`, color: '#f07070' }); break;
    case 'crop': s.food.crops = (s.food.crops || 0) + p.amt; g.fx({ t: 'text', x: p.x, y: p.y - 10, text: '+crop', color: '#c8b040' }); break;
    case 'coin': c.wallet += Math.round(p.amt * mul); g.fx({ t: 'text', x: p.x, y: p.y - 10, text: `+${Math.round(p.amt * mul)}$`, color: '#f4c542' }); break;
    case 'gun': if (c.makeshift) return false; c.makeshift = 30; g.fx({ t: 'text', x: p.x, y: p.y - 10, text: 'makeshift gun!', color: '#90a050' }); break;
    default: return false;
  }
  g.fx({ t: 'pickup', x: p.x, y: p.y, kind: p.kind });
  return true;
}

export { WEAPONS, CLASSES, dist, dist2, angTo, norm };
