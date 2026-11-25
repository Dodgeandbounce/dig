// Every class's kit: primary fire, abilities, passives, and E-interactions.
import { T, TILE, TILE_HP, CLASSES, WEAPONS, ABILITIES, INSULTS, JARGON, DOG_BARKS, CHEF_LINES, LINES, CLASS_UP_MAX, xpCost, CREW_HP_MUL, LIGHTNING, FURNITURE_SPOTS, JUKEBOX_SONGS } from './data.js';
import { idx, inMap } from './grid.js';
import {
  moveActor, melee, fireBullet, spawnProj, explode, damage, stat, addBuff, healActor, roomAt,
  hostiles, popBubble, airAt, addMess, dropPickup, damageSystem, hitTile, tileOwner, extinguish, gainXp, unstick, collides, downCrew,
} from './combat.js';
import { clamp, norm, dist, dist2, angTo, uid } from './util.js';

const MELEE_CLASSES = new Set(['engineer', 'chef', 'mrclean', 'dog', 'chameleon', 'trainer', 'vaelift']);
export const DASH_COST = 34;

/**
 * Max HP and stamina from the class and the stars spent. Every star makes you a bit tougher (+4% health)
 * and gives you more puff (+6 stamina), whatever track it went into. (Sturdy Step adds more health on top.)
 */
export function recalcCrewHp(c) {
  const base = c.baseHp || c.maxHp;
  const was = c.maxHp;
  const stars = c.upgrades.reduce((a, b) => a + b, 0);
  c.maxHp = Math.round(base * (1 + 0.04 * stars + (c.cls === 'chameleon' ? 0.12 * c.upgrades[1] : 0)));
  if (c.maxHp > was) c.hp += c.maxHp - was;
  c.stamMax = 100 + 6 * stars;
}
export const stamMax = (c) => c.stamMax || 100;
/** Bots put their XP into their weakest track as soon as they can afford a star. */
export function autoSpendXp(g, c) {
  if (c.cls === 'urchid' && !c.human) { /* the urchid upgrades its chair, obviously */ }
  for (let guard = 0; guard < 24; guard++) {
    const k = [0, 1, 2].filter((t) => c.upgrades[t] < CLASS_UP_MAX).sort((a, b) => c.upgrades[a] - c.upgrades[b])[0];
    if (k === undefined || (c.xp || 0) < xpCost(c.upgrades[k])) break;
    c.xp -= xpCost(c.upgrades[k]); c.upgrades[k]++;
    recalcCrewHp(c);
  }
}

/** The scrap gun anyone can carry: a few heavy shots, then it falls apart into 1 scrap. */
export const MAKESHIFT = { kind: 'bullet', dmg: 24, rate: 0.42, speed: 600, spread: 0.06, range: 480 };

/**
 * Say something in character. kind: idle | fight | kill | hurt | dock | fire. Each crew member has a
 * cooldown so the ship doesn't turn into a chat room; `force` skips it.
 */
export function quip(g, c, kind, force = false) {
  if (!c || !c.alive || (!force && (c.quipT > g.time || c.sayT > 0))) return;
  let pool = LINES[c.cls]?.[kind] || [];
  if (kind === 'idle') {
    if (c.cls === 'scientist') pool = JARGON;
    else if (c.cls === 'dog') pool = DOG_BARKS;
    else if (c.cls === 'chef') pool = [...pool, ...CHEF_LINES];
  }
  if (!pool.length) return;
  c.quipT = g.time + (force ? 4 : 9 + g.rng() * 10);
  say(g, c, g.rng.pick(pool));
}

const STAFF_FORMS = ['staff', 'blade', 'rifle', 'shotgun'];
const STAFF_W = {
  staff: WEAPONS.staff,
  blade: { kind: 'melee', dmg: 27, rate: 0.34, range: 46, arc: 1.7 },
  rifle: { ...WEAPONS.rifle, dmg: 10 },
  shotgun: { ...WEAPONS.shotgun, pellets: 6 },
};
export const MINE_TYPES = ['proximity', 'timed', 'remote', 'c4'];
const JARS = ['poison', 'acid', 'explosive', 'buff'];

export function weaponOf(c) {
  if (c.lightning > 0) return LIGHTNING;   // white candy: a lightning chain gun until it runs dry
  if (c.makeshift?.ammo > 0 && !c.makeshift.away) return MAKESHIFT;   // (X puts it away and back)
  if (c.cls === 'vaelift') return STAFF_W[c.form || 'staff'];
  return WEAPONS[CLASSES[c.cls].weapon];
}

// ---------------------------------------------------------------------------
/** Walking speed (px/s) right now. Also used by online play to predict your own movement in the browser. */
export function crewSpeed(g, c, inp) {
  let sp = CLASSES[c.cls].speed * (1 + stat(c, 'speed')) * (g.cleanBuff ? 1.1 : 1);
  if (c.cls === 'guard') sp *= 1 + 0.08 * c.upgrades[2];
  if (c.cls === 'dog') sp *= 1 + 0.1 * c.upgrades[2];
  if (c.cloaked) sp *= 0.55 + 0.08 * c.upgrades[0];
  if (c.chainsawOn) sp *= 0.6;
  if (c.slowT > 0) sp *= 0.5;
  if (c.cls === 'farmer' && c.carrying) sp *= 1 - 0.06 * c.carrying;
  if (c.phased) sp *= 1.6;   // the empty dimension has no friction
  return sp;
}

/** Can this crew member walk freely right now (not dashing, stunned, riding a bubble, down or at the helm)? */
export function walksFreely(g, c) {
  return c.alive && !(c.stunT > 0) && !(c.dashT > 0) && !c.riding && !(c.atHelm && g.phase === 'descent');
}

export function crewTick(g, c, inp, dt) {
  const def = CLASSES[c.cls];
  for (const k in c.cd) if (c.cd[k] > 0) c.cd[k] -= dt * (1 + stat(c, 'cd'));
  if (c.coinWinT > 0) c.coinWinT -= dt;
  if (c.swingT > 0) c.swingT -= dt;
  if (c.spraying > 0) c.spraying -= dt;
  if (c.hurtT > 0) c.hurtT -= dt;
  if (c.sayT > 0) c.sayT -= dt;

  // regen buffs, poison
  const regen = stat(c, 'regen');
  if (regen) healActor(c, regen * dt);
  // phase: the clock is ticking (a number counts down over your head)
  if (c.phased) { c.phaseT -= dt; if (c.phaseT <= 0) unphase(g, c); if (!c.alive) return; }
  // stamina comes back after a short breather
  if (c.stamT > 0) c.stamT -= dt; else c.stam = Math.min(stamMax(c), (c.stam ?? 100) + dt * 26);
  // never stuck inside a wall (somebody rebuilt it on top of you). Phased, you're meant to be in it.
  if (!c.phased) unstick(g, c);
  // knocked back by something big
  if (c.kx || c.ky) { moveActor(g, c, c.kx * dt, c.ky * dt); c.kx *= 0.85; c.ky *= 0.85; if (Math.abs(c.kx) + Math.abs(c.ky) < 5) c.kx = c.ky = 0; }
  if (c.stunT > 0) { c.stunT -= dt; return; }

  // ---- movement
  const sp = crewSpeed(g, c, inp);
  if (c.slowT > 0) c.slowT -= dt;

  // Shift: a quick dash with a puff of smoke (melee classes go further, faster)
  const shiftDown = !!inp.shift && !c.shiftHeld;
  c.shiftHeld = !!inp.shift;
  if (shiftDown && !(c.dashT > 0) && !c.riding && !c.atHelm && (c.stam ?? 100) >= DASH_COST && c.cls !== 'urchid') {
    const n = norm(inp.mx || 0, inp.my || 0);
    const a = n.l ? Math.atan2(n.y, n.x) : c.facing;
    const melee = MELEE_CLASSES.has(c.cls);
    const d = melee ? 165 : 120, time = melee ? 0.15 : 0.17;
    c.dashT = time; c.dashV = { x: Math.cos(a) * d / time, y: Math.sin(a) * d / time }; c.dashDmg = 0; c.dashKind = 'none'; c.dashHit = new Set();
    c.stam -= DASH_COST; c.stamT = 0.7;
    g.fx({ t: 'dash', x: c.x, y: c.y, a, crew: c.id, big: melee });
  }

  if (c.dashT > 0) { // lunges, pounces, rolls, dashes
    c.dashT -= dt;
    moveActor(g, c, c.dashV.x * dt, c.dashV.y * dt);
    if (c.dashKind !== 'none') dashHits(g, c);
  } else if (c.riding) {
    const b = c.riding;
    if (b.dead) c.riding = null; else { c.x = b.x; c.y = b.y; }
    // wiggling too fast pops the bubble (and the chain)
    const dir = Math.sign(inp.mx || 0) * 2 + Math.sign(inp.my || 0);
    if (dir !== c.lastDir && dir !== 0) { c.wiggle.push(g.time); c.lastDir = dir; }
    c.wiggle = c.wiggle.filter((t) => g.time - t < 0.7);
    if (c.wiggle.length >= 5) { c.wiggle = []; const b2 = c.riding; c.riding = null; popBubble(g, b2, c); }
  } else {
    const n = norm(inp.mx || 0, inp.my || 0);
    if (n.l > 0) moveActor(g, c, n.x * sp * dt, n.y * sp * dt);
    c.moving = n.l > 0;
  }
  c.facing = Math.atan2(inp.ay - c.y, inp.ax - c.x);
  c.aim = { x: inp.ax, y: inp.ay };

  // cloak visibility: moving fast makes the cloak jitter
  if (c.cloaked) {
    c.jitter = c.moving ? (inp.shift ? 1 : 0.35) : 0;
    if (c.cloakBreak) { c.cloaked = false; c.cloakBreak = 0; g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'spotted!', color: '#ff8080' }); }
  }

  // ---- primary fire
  const w = weaponOf(c);
  if (c.cd.fire <= 0 && inp.fire && !c.phased && !c.riding) {
    primary(g, c, w, inp);
  }

  // ---- abilities
  const P = inp.pressed || {};
  if (P.q && def.abilities.q) useAbility(g, c, def.abilities.q, inp, 'q');
  if (P.f && def.abilities.f) useAbility(g, c, def.abilities.f, inp, 'f');
  if (def.abilities.r === 'wrenchhit') { if ((P.r || inp.r) && c.cd.r <= 0 && !c.phased) useAbility(g, c, 'wrenchhit', inp, 'r'); }
  else if (P.r && def.abilities.r) useAbility(g, c, def.abilities.r, inp, 'r');
  if (P.g && def.abilities.g) useAbility(g, c, def.abilities.g, inp, 'g');
  if (def.abilities.rmb === 'chainsaw') chainsaw(g, c, inp.rmb, dt);
  else if (def.abilities.rmb === 'pitchfork') { if ((inp.rmb || P.rmb) && c.cd.rmb <= 0 && !c.phased) useAbility(g, c, 'pitchfork', inp, 'rmb'); }
  else if (P.rmb && def.abilities.rmb) useAbility(g, c, def.abilities.rmb, inp, 'rmb');
  else if (P.rmb && c.cls === 'chef') useAbility(g, c, 'fish', inp, 'f');
  if (P.space && def.abilities.space) useAbility(g, c, def.abilities.space, inp, 'space');
  // X: swap between your own weapon and a makeshift gun
  if (P.x && c.makeshift?.ammo > 0) { c.makeshift.away = !c.makeshift.away; g.fx({ t: 'text', x: c.x, y: c.y - 22, text: c.makeshift.away ? 'own weapon' : 'makeshift gun', color: '#90a050' }); }

  // ---- interact
  if (P.e) interactPress(g, c);
  if (inp.e) interactHold(g, c, dt);
  // ---- repair: hold R (V when R is one of your abilities): fixes the nearest broken thing, no panels in the way
  if (inp[fixKey(c)] && !inp.e && c.cls !== 'urchid' && !c.phased) repairHold(g, c, dt);

  // ---- passives
  passive(g, c, dt);
}

function primary(g, c, w, inp) {
  const ang = c.facing;
  let mul = 1 + stat(c, 'dmg') + (g.ship.research.has('skilltree') ? 0.1 : 0);
  if (c.special) mul += 0.4;
  const rateMul = 1 + stat(c, 'rate');
  const up = c.upgrades;
  c.cd.fire = w.rate / Math.max(0.3, rateMul);
  if (c.cloaked && w.kind !== 'heckle') c.cloakBreak = 1;
  // shooting from inside a disguise gives the game away
  if (c.disguise != null && w.kind !== 'heckle') { c.disguise = null; g.fx({ t: 'text', x: c.x, y: c.y - 22, text: 'cover blown!', color: '#ff8080' }); }
  if (w === LIGHTNING) { chainLightning(g, c, ang, mul); return; }
  if (w === MAKESHIFT) {
    const lvl = c.makeshift.lvl || 0;
    fireBullet(g, c, ang, w, 'crew', { mul: mul * (1 + 0.2 * lvl), kind: 'scrap', pierce: true });
    g.fx({ t: 'shot', crew: c.id, x: c.x, y: c.y, a: ang, w: 'scrap' });
    if (--c.makeshift.ammo <= 0) {
      c.makeshift = null; g.ship.scrap += 1;
      g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'gun fell apart: +1 scrap', color: '#c0c0c0' });
    }
    return;
  }
  if (g.phase === 'encounter' && g.rng.chance(0.03)) quip(g, c, 'fight');
  switch (w.kind) {
    case 'heckle': {
      const target = nearestCrew(g, c);
      say(g, c, pickInsult(g, c), target);
      break;
    }
    case 'melee': {
      c.swingT = 0.18;
      let opts = { mul };
      if (c.cls === 'mrclean') { opts.mul *= 1 + 0.2 * up[0]; opts.vsMeleeWeak = 1.6; }
      if (c.cls === 'engineer') opts.mul *= 1 + 0.25 * up[0];
      if (c.cls === 'dog') { opts.mul *= 1 + 0.2 * up[0]; opts.kind = 'bite'; }
      if (c.cls === 'chameleon') opts.backstabMul = 1 + 0.3 * up[1];
      if (c.cls === 'vaelift') opts.mul *= 1 + 0.25 * up[1];
      // Vaelift: hit one of your ice blocks and it goes sliding off, scooping up whatever is in the way
      if (c.cls === 'vaelift' && kickIce(g, c, ang)) { g.fx({ t: 'swing', x: c.x, y: c.y, a: ang, r: w.range, cls: c.cls }); break; }
      const hits = melee(g, c, w, ang, 'crew', opts);
      // the wrench also patches a little as it fights (R is the proper repair hit)
      if (c.cls === 'engineer' || c.isJoe) wrenchRepair(g, c, w.repair * 0.4 * (1 + 0.25 * up[0]));
      // melee on enemy systems / their walls
      if (!hits) hitThingsInFront(g, c, w.dmg * opts.mul);
      g.fx({ t: 'swing', x: c.x, y: c.y, a: ang, r: w.range, cls: c.cls });
      break;
    }
    case 'bullet': {
      if (c.cls === 'pilot') mul *= 1 + 0.2 * up[2];
      if (c.cls === 'guard') mul *= 1 + 0.2 * up[1];
      if (c.cls === 'commando') c.cd.fire /= 1 + 0.25 * up[0];
      if (c.cls === 'agent') c.cd.fire /= 1 + 0.3 * up[1];
      let ww = w;
      if (c.cls === 'farmer') ww = { ...w, pellets: w.pellets + 2 * up[1] };
      // the guard's Long Barrels: every star shoots further (and tighter)
      if (c.cls === 'guard' && up[1]) ww = { ...w, range: w.range * (1 + 0.25 * up[1]), spread: w.spread * Math.max(0.4, 1 - 0.18 * up[1]) };
      if (c.cls === 'slots') { if (c.wallet < 1) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'no coins!', color: '#ccc' }); c.cd.fire = 0.5; return; } c.wallet -= 1; }
      const kind = c.cls === 'slots' ? 'coin' : c.cls === 'agent' ? 'ppk' : 'bullet';
      // 013 with enough missions under his belt gets the laser: straight through everything in a line
      const laser = c.cls === 'agent' && (c.missionRank || 0) >= 4;
      if (laser) ww = { ...ww, speed: 1400, range: 760 };
      fireBullet(g, c, ang, ww, 'crew', { mul: mul * (laser ? 1.25 : 1), kind, pierce: !!w.pierce || laser, laser });
      g.fx({ t: 'shot', crew: c.id, x: c.x, y: c.y, a: ang, w: laser ? 'laser' : c.cls === 'agent' && up[0] ? 'silenced' : kind });
      break;
    }
    case 'rocket':
      spawnProj(g, { kind: 'rocket', x: c.x + Math.cos(ang) * 14, y: c.y + Math.sin(ang) * 14, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
        dmg: w.dmg * mul, radius: w.radius * (1 + 0.15 * up[2]), team: 'crew', owner: c, life: 1.6, r: 5 });
      g.fx({ t: 'shot', crew: c.id, x: c.x, y: c.y, a: ang, w: 'rocket' });
      break;
    case 'jar': lob(g, c, inp.ax, inp.ay, 'jar', { jar: c.jar || 'poison' }); break;
    case 'bubble': {
      c.cd.fire /= 1 + 0.2 * up[2];
      spawnProj(g, { kind: 'bubble', x: c.x + Math.cos(ang) * 18, y: c.y + Math.sin(ang) * 18, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
        team: 'crew', owner: c, life: 7, r: 13 });
      g.fx({ t: 'blow', x: c.x, y: c.y });
      break;
    }
  }
}

/** The white candy's lightning chain gun: an instant bolt that jumps between enemies. */
function chainLightning(g, c, ang, mul) {
  c.lightning = Math.max(0, (c.lightning || 0) - 1);
  let from = { x: c.x, y: c.y }, hit = new Set();
  // first target: the nearest enemy roughly where you're aiming
  let t = null, bd = LIGHTNING.range ** 2;
  for (const m of g.mobs) {
    if (!m.alive || m.team !== 'enemy') continue;
    const d = dist2(m, c); if (d > bd) continue;
    const da = Math.abs(((Math.atan2(m.y - c.y, m.x - c.x) - ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da > 0.5 || !g.grid.los(c.x, c.y, m.x, m.y, g.doors)) continue;
    bd = d; t = m;
  }
  if (!t) { g.fx({ t: 'chain', x: c.x, y: c.y, x2: c.x + Math.cos(ang) * 120, y2: c.y + Math.sin(ang) * 120, miss: true }); return; }
  for (let k = 0; k < LIGHTNING.chain && t; k++) {
    hit.add(t);
    damage(g, t, LIGHTNING.dmg * mul * (1 - k * 0.15), { owner: c, team: 'crew', kind: 'zap' });
    g.fx({ t: 'chain', x: from.x, y: from.y, x2: t.x, y2: t.y });
    from = t;
    let nx = null, nd = 150 ** 2;
    for (const m of g.mobs) if (m.alive && m.team === 'enemy' && !hit.has(m)) { const d = dist2(m, from); if (d < nd) { nd = d; nx = m; } }
    t = nx;
  }
}

function lob(g, c, tx, ty, kind, extra) {
  const d = Math.min(WEAPONS.jar.range, Math.hypot(tx - c.x, ty - c.y));
  const a = Math.atan2(ty - c.y, tx - c.x);
  const ex = c.x + Math.cos(a) * d, ey = c.y + Math.sin(a) * d;
  spawnProj(g, { kind, sx: c.x, sy: c.y, tx: ex, ty: ey, x: c.x, y: c.y, dur: 0.35 + d / 700, team: 'crew', owner: c, life: 5, ...extra });
}

/** Meaner ones unlock deeper down (or with Sharper Tongue). Never the same one twice in a row. */
function pickInsult(g, c, best = false) {
  const tier = Math.min(INSULTS.length - 1, Math.max(g.tier, c.upgrades[1]) + (best ? c.upgrades[1] >> 1 : 0));
  const pool = best ? [...INSULTS[tier], ...INSULTS[Math.max(0, tier - 1)]] : INSULTS.slice(0, tier + 1).flat();
  const recent = (c.recentInsults ||= []);
  let s = g.rng.pick(pool);
  for (let k = 0; k < 6 && recent.includes(s); k++) s = g.rng.pick(pool);
  recent.push(s); if (recent.length > 8) recent.shift();
  return s;
}

function nearestCrew(g, c) {
  let best = null, bd = Infinity;
  for (const o of g.crew) if (o !== c && o.alive) { const d = dist2(o, c); if (d < bd) { bd = d; best = o; } }
  return best;
}
export function say(g, c, text, to) {
  c.say = text; c.sayT = 3.2;
  g.fx({ t: 'say', id: c.id, text, to: to?.name });
}

function dashHits(g, c) {
  for (const m of g.mobs) {
    if (!m.alive || m.team !== 'enemy' || (c.dashHit && c.dashHit.has(m.id))) continue;
    if ((m.x - c.x) ** 2 + (m.y - c.y) ** 2 > (m.r + c.r + 6) ** 2) continue;
    (c.dashHit ||= new Set()).add(m.id);
    const kind = c.dashKind || 'melee';
    damage(g, m, c.dashDmg, { owner: c, kind });
    if (kind === 'crush') m.stunT = 1;
  }
}

function startDash(g, c, dist, time, dmg, kind) {
  const a = c.facing;
  c.dashT = time; c.dashV = { x: Math.cos(a) * dist / time, y: Math.sin(a) * dist / time };
  c.dashDmg = dmg; c.dashKind = kind; c.dashHit = new Set();
}

// ---------------------------------------------------------------------------
function useAbility(g, c, id, inp, slot) {
  if (c.cd[slot] > 0) return;
  const A = ABILITIES[id];
  if (A.cost?.scrap && g.ship.scrap < A.cost.scrap) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: `need ${A.cost.scrap} scrap`, color: '#ccc' }); return; }
  if (A.cost?.crops && (g.ship.food.crops || 0) < A.cost.crops) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'no crops', color: '#ccc' }); return; }
  const ok = ABILITY_FNS[id]?.(g, c, inp);
  if (ok === false) return;
  if (A.cost?.scrap) g.ship.scrap -= A.cost.scrap;
  if (A.cost?.crops) g.ship.food.crops -= A.cost.crops;
  c.cd[slot] = A.cd;
  if (c.cloaked && !['cloak', 'smoke'].includes(id)) c.cloakBreak = 1;
  g.fx({ t: 'ability', id, x: c.x, y: c.y, cls: c.cls, crew: c.id });
}

const ABILITY_FNS = {
  evasive(g, c) {
    if (g.phase !== 'encounter') { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'only during a docking', color: '#ccc' }); return false; }
    const r = g.rooms[roomAt(g, c)];
    if (!r || r.type !== 'bridge') { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'get to the helm!', color: '#ccc' }); return false; }
    g.ship.evasiveT = 4; g.log('ship', `${c.name}: Evasive maneuvers!`);
  },
  rally(g, c) {
    const r = roomAt(g, c);
    let n = 0;
    for (const o of g.crew) if (o.alive && roomAt(g, o) === r) { addBuff(o, { speed: 1, rate: 1 }, 6, 'rally'); n++; }
    say(g, c, 'Hold together, crew! DOUBLE TIME!');
    gainXp(g, c, 1 + n);
  },
  /** Engineer, R (hold it): a proper repair swing at whatever's broken in front of you. */
  wrenchhit(g, c) {
    const w = WEAPONS.wrench;
    c.swingT = 0.18;
    const amt = w.repair * 1.5 * (1 + 0.25 * c.upgrades[0]);
    const before = c.repairs || 0;
    wrenchRepair(g, c, amt);
    g.fx({ t: 'swing', x: c.x, y: c.y, a: c.facing, r: w.range, cls: c.cls });
    if ((c.repairs || 0) === before) {
      // nothing to fix here: it's still a wrench
      if (!melee(g, c, w, c.facing, 'crew', { mul: 0.6 })) hitThingsInFront(g, c, w.dmg * 0.6);
    }
  },
  turret(g, c) {
    const mine = g.objs.filter((o) => o.kind === 'turret' && o.owner === c.id);
    if (mine.length >= 2 + c.upgrades[1]) { const old = mine[0]; g.objs.splice(g.objs.indexOf(old), 1); }
    const p = inFront(c, 24);
    g.objs.push({ id: uid(), kind: 'turret', owner: c.id, x: p.x, y: p.y, hp: 60, maxHp: 60, atkT: 0, lvl: c.upgrades[1], a: c.facing });
  },
  trap(g, c) { const p = inFront(c, 22); g.objs.push({ id: uid(), kind: 'trap', owner: c.id, x: p.x, y: p.y, lvl: c.upgrades[2], armT: 0.6 }); },
  insult(g, c) {
    const target = nearestCrew(g, c);
    say(g, c, pickInsult(g, c, true), target);
    g.stats.insults++;
    gainXp(g, c, 2);   // (insulting people is the urchid's whole career)
  },
  ghost(g, c) {
    const living = g.crew.filter((o) => o.alive && o !== c);
    if (!living.length) return;
    const i = living.findIndex((o) => o.id === c.ghost);
    c.ghost = i + 1 >= living.length ? null : living[i + 1].id;
  },
  lunge(g, c) { startDash(g, c, 150, 0.16, 32, 'melee'); c.swingT = 0.2; },
  lockdown(g, c) {
    const r = roomAt(g, c);
    for (const d of g.doors) if (d.a === r || d.b === r) { d.reinforced = 12; d.hp = Math.min(d.maxHp * 2, d.hp * 2); }
    const v = g.rooms.find((x) => x.type === 'vault' && x.owner === 'us');
    if (v) v.reinforced = 12;
    say(g, c, 'Locking it down!');
  },
  knives(g, c) {
    const n = 3 + c.upgrades[1];
    for (let k = 0; k < n; k++) {
      const a = c.facing + (k - (n - 1) / 2) * 0.16;
      spawnProj(g, { kind: 'knife', x: c.x, y: c.y, vx: Math.cos(a) * 640, vy: Math.sin(a) * 640, dmg: 14 + 3 * c.upgrades[1], team: 'crew', owner: c, life: 0.5, r: 4 });
    }
  },
  fish(g, c) { melee(g, c, { dmg: 22, range: 60, arc: 1.8 }, c.facing, 'crew', { stun: 1.6, kind: 'fish' }); c.swingT = 0.25; g.fx({ t: 'swing', x: c.x, y: c.y, a: c.facing, r: 60, cls: 'fish' }); },
  whirlwind(g, c) { c.spinT = 1.2; c.spinTick = 0; },
  deepclean(g, c) {
    const r = roomAt(g, c); let n = 0;
    g.objs = g.objs.filter((o) => { if (o.kind === 'mess' && roomAt(g, o) === r) { n += o.amt; return false; } return true; });
    c.wallet += n * 2;
    for (const o of g.crew) if (o.alive && roomAt(g, o) === r) addBuff(o, { speed: 0.2 + 0.05 * c.upgrades[2] }, 20, 'clean');
    say(g, c, n ? `Spotless! (${n} messes)` : 'Already spotless.');
  },
  barrage(g, c) {
    for (let k = -1; k <= 1; k++) {
      const a = c.facing + k * 0.18;
      spawnProj(g, { kind: 'rocket', x: c.x, y: c.y, vx: Math.cos(a) * 400, vy: Math.sin(a) * 400, dmg: 34, radius: 60 * (1 + 0.15 * c.upgrades[2]), team: 'crew', owner: c, life: 1.5, r: 5 });
    }
  },
  grenade(g, c) {
    const a = c.facing;
    spawnProj(g, { kind: 'grenade', x: c.x, y: c.y, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, dmg: 48 * (1 + 0.25 * c.upgrades[1]), radius: 80, team: 'crew', owner: c, life: 1.6, r: 5 });
  },
  tnt(g, c) { const p = inFront(c, 16); g.objs.push({ id: uid(), kind: 'tnt', owner: c.id, x: p.x, y: p.y, t: 3, dmg: 110 * (1 + 0.25 * c.upgrades[1]) }); say(g, c, 'FIRE IN THE HOLE!'); },
  // the pitchfork: short jabs that always shove things back. Hold RMB and nothing gets close.
  pitchfork(g, c) {
    melee(g, c, { dmg: 9 * (1 + (c.special ? 0.4 : 0)), range: 62, arc: 1.6 }, c.facing, 'crew', { knock: 380 });
    c.swingT = 0.18; g.fx({ t: 'swing', x: c.x, y: c.y, a: c.facing, r: 62, cls: 'pitchfork' });
  },
  scarecrow(g, c) {
    const lvl = c.upgrades[2];
    const mine = g.objs.filter((o) => o.kind === 'scarecrow' && o.owner === c.id);
    if (mine.length >= 1 + Math.floor(lvl / 3)) g.objs.splice(g.objs.indexOf(mine[0]), 1);
    const p = inFront(c, 26);
    const hp = 80 + 25 * lvl;
    g.objs.push({ id: uid(), kind: 'scarecrow', owner: c.id, x: p.x, y: p.y, hp, maxHp: hp, atkT: 0.5, lvl, a: c.facing });
    say(g, c, g.rng.pick(['Git em, crows!', 'Scarecrow up!', 'Ol\' Straw-Pete will watch this door.']));
  },
  feast(g, c) { healActor(c, 50); say(g, c, 'Mmm. Dirt-fresh.'); },
  jarswap(g, c) { c.jar = JARS[(JARS.indexOf(c.jar || 'poison') + 1) % JARS.length]; g.fx({ t: 'text', x: c.x, y: c.y - 20, text: `${c.jar} jar`, color: c.jar === 'buff' ? '#f4c542' : '#50c8e8' }); },
  overclock(g, c) {
    const r = g.rooms[roomAt(g, c)];
    if (!r || r.type !== 'lab') { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'route power from the lab', color: '#ccc' }); return false; }
    g.panel(c, 'lab', r);
  },
  pounce(g, c) { startDash(g, c, 130, 0.18, 26 * (1 + 0.2 * c.upgrades[0]), 'bite'); say(g, c, g.rng.pick(DOG_BARKS)); },
  howl(g, c) {
    for (const m of g.mobs) if (m.alive && m.team === 'enemy' && dist(m, c) < 240 && !m.boss) m.fearT = 3;
    say(g, c, 'AWOOOOOO');
  },
  cloak(g, c) {
    if (c.cloaked) { c.cloaked = false; return; }
    c.cloaked = true; c.cloakBreak = 0;
  },
  smoke(g, c) {
    g.objs.push({ id: uid(), kind: 'cloud', sub: 'smoke', x: c.x, y: c.y, r: 100, t: 4, owner: c });
    for (const m of g.mobs) if (m.alive && m.team === 'enemy' && dist(m, c) < 110) { m.blindT = 3; m.target = null; }
    c.cloaked = true; c.cloakBreak = 0;
  },
  capture(g, c) {
    const a = c.facing;
    spawnProj(g, { kind: 'cube', x: c.x, y: c.y, vx: Math.cos(a) * 460, vy: Math.sin(a) * 460, dmg: 0, team: 'crew', owner: c, life: 0.9, r: 6 });
  },
  summon(g, c) {
    const out = g.mobs.filter((m) => m.alive && m.isMonster && m.ownerId === c.id);
    const limit = 1 + c.upgrades[0];
    const ready = c.monsters.filter((m) => !m.out && m.reviveT <= 0);
    if (out.length >= limit || !ready.length) {
      if (!out.length) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: c.monsters.length ? 'all resting' : 'no monsters yet', color: '#ccc' }); return false; }
      for (const m of out) { m.alive = false; const mon = c.monsters.find((x) => x.type === m.type); if (mon) mon.out = false; g.fx({ t: 'poof', x: m.x, y: m.y }); }
      say(g, c, 'Come back!');
      return;
    }
    const mon = ready[c.summonIdx++ % ready.length];
    mon.out = true;
    const p = inFront(c, 30);
    g.spawnMob(mon.type, p.x, p.y, { team: 'crew', isMonster: true, ownerId: c.id, hpMul: mon.hpMul, dmgMul: mon.dmgMul });
    say(g, c, `Go, ${mon.name}!`);
  },
  bigbubble(g, c) {
    const a = c.facing;
    spawnProj(g, { kind: 'bubble', big: true, x: c.x + Math.cos(a) * 24, y: c.y + Math.sin(a) * 24, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120, team: 'crew', owner: c, life: 9, r: 28 });
  },
  burst(g, c) {
    let n = 0;
    for (const p of [...g.projs]) if (p.kind === 'bubble' && !p.dead && dist(p, c) < 170) { popBubble(g, p, c); n++; }
    if (!n) return false;
  },
  hop(g, c) {
    if (c.riding) { c.riding = null; return; }
    let best = null, bd = 70 * 70;
    for (const p of g.projs) if (p.kind === 'bubble' && !p.trapped && !p.dead) { const d = dist2(p, c); if (d < bd) { bd = d; best = p; } }
    if (!best) return false;
    c.riding = best; best.life = Math.max(best.life, 5);
  },
  phase(g, c) {
    if (c.phased) { unphase(g, c); return; }
    c.phased = true; c.phaseT = 3 + 0.6 * c.upgrades[0];
    for (const m of g.mobs) if (m.target === c) m.target = null;
  },
  staffform(g, c) { c.form = STAFF_FORMS[(STAFF_FORMS.indexOf(c.form || 'staff') + 1) % STAFF_FORMS.length]; g.fx({ t: 'text', x: c.x, y: c.y - 20, text: `Vurfenstaff: ${c.form}`, color: '#a0a0ff' }); },
  icecube(g, c) {
    const tx = Math.floor(c.aim.x / TILE), ty = Math.floor(c.aim.y / TILE);
    if (Math.hypot(c.aim.x - c.x, c.aim.y - c.y) > 260) return false;
    const t = g.grid.get(tx, ty);
    if (t !== T.FLOOR && t !== T.TUNNEL && t !== T.RUBBLE) return false;
    for (const a of [...g.crew, ...g.mobs]) if (a.alive && Math.floor(a.x / TILE) === tx && Math.floor(a.y / TILE) === ty) return false;
    const i = idx(tx, ty);
    g.iceUnder.set(i, t);
    g.grid.set(tx, ty, T.ICE);
    g.objs.push({ id: uid(), kind: 'ice', i, tx, ty, t: 6 + 1.5 * c.upgrades[2] });
  },
  // 013's four kinds of mine: Q proximity, R timed, F remote (RMB sets them off), G C4 on a lit fuse
  proxmine(g, c) { placeMine(g, c, 'proximity'); },
  timedmine(g, c) { placeMine(g, c, 'timed'); },
  remotemine(g, c) { placeMine(g, c, 'remote'); },
  c4(g, c) {
    // aimed at a door close by? it goes right on the door
    let door = null, bd = 80 * 80;
    for (let k = 0; k < g.doors.length; k++) { const d = g.doors[k]; if (d.broken || d.gone) continue; const dx = (d.x + .5) * TILE - (c.aim?.x ?? c.x), dy = (d.y + .5) * TILE - (c.aim?.y ?? c.y); const dd = dx * dx + dy * dy; if (dd < bd && Math.hypot((d.x + .5) * TILE - c.x, (d.y + .5) * TILE - c.y) < 90) { bd = dd; door = k; } }
    const p = door != null ? { x: (g.doors[door].x + .5) * TILE, y: (g.doors[door].y + .5) * TILE } : inFront(c, 14);
    g.objs.push({ id: uid(), kind: 'mine', sub: 'c4', owner: c.id, x: p.x, y: p.y, t: 4, armT: 0, dmg: 140, r: 110, door });
    say(g, c, door != null ? 'Fuse is lit. Stand back from the door.' : 'Fuse is lit.');
  },
  detonate(g, c) { if (!detonateRemotes(g, c)) return false; },
  tank(g, c) {
    if ((c.missionRank || 0) < 2) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'tank: mission rank 2', color: '#ccc' }); return false; }
    const p = inFront(c, 26);
    g.objs.push({ id: uid(), kind: 'tank', owner: c.id, x: p.x, y: p.y, r: 11, hp: 120 + 20 * c.missionRank, t: 25, atkT: 0.5, a: c.facing });
    say(g, c, 'Q branch, you\'ve outdone yourselves.');
  },
  roll(g, c) { startDash(g, c, 190, 0.38, 38 * (1 + 0.25 * c.upgrades[1]), 'crush'); },
  spin(g, c) { return spinSlots(g, c); },
};

/**
 * Back from the empty dimension. Come back inside a wall and that's it: you die there, with whatever
 * bit of you was still in the wall sticking out of it (head, hands, feet...).
 */
function unphase(g, c) {
  c.phased = false; c.phaseT = 0; c.cd.q = Math.max(c.cd.q, ABILITIES.phase.cd);
  g.fx({ t: 'phase', x: c.x, y: c.y });
  const solid = (x, y) => g.grid.solidAt(Math.floor(x / TILE), Math.floor(y / TILE), g.doors) && g.grid.get(Math.floor(x / TILE), Math.floor(y / TILE)) !== T.DOOR;
  if (!solid(c.x, c.y) && !collides(g, { x: c.x, y: c.y, r: c.r * 0.6 })) { unstick(g, c); return; }
  // which bits are stuck: sample around the body (facing = where the head is)
  const f = c.facing || 0, r = c.r;
  const at = (a, d) => ({ x: c.x + Math.cos(f + a) * d, y: c.y + Math.sin(f + a) * d });
  const parts = [];
  if (solid(at(0, r * 0.9).x, at(0, r * 0.9).y)) parts.push('head');
  if (solid(at(Math.PI / 2, r * 0.9).x, at(Math.PI / 2, r * 0.9).y) || solid(at(-Math.PI / 2, r * 0.9).x, at(-Math.PI / 2, r * 0.9).y)) parts.push('hands');
  if (solid(at(Math.PI, r * 0.9).x, at(Math.PI, r * 0.9).y)) parts.push('feet');
  if (solid(c.x, c.y)) parts.push('body');
  const what = parts.length >= 3 || parts.includes('body') && parts.length >= 2 ? 'everything' : parts.join(' and ') || 'a toe';
  g.objs.push({ id: uid(), kind: 'wallbones', x: c.x, y: c.y, a: f, parts, owner: 'us', t: 60 });
  c.hp = 0;
  downCrew(g, c, g.rng.pick(['The wall! I\'m IN the wall!', 'Wrong dimension! WRONG DIMENSION!', 'Oh no. Oh no no no. Wall.']));
  g.log('alert', `💀 ${c.name} came back out of phase INSIDE a wall. ${what === 'everything' ? `All of ${c.name} is in there.` : `${c.name}'s ${what} ${parts.length === 1 && parts[0] !== 'hands' && parts[0] !== 'feet' ? 'is' : 'are'} still sticking out.`}`);
}
function inFront(c, d) { return { x: c.x + Math.cos(c.facing) * d, y: c.y + Math.sin(c.facing) * d }; }

function placeMine(g, c, type) {
  const p = inFront(c, 14);
  g.objs.push({ id: uid(), kind: 'mine', sub: type, owner: c.id, x: p.x, y: p.y, t: type === 'timed' ? 3 : 0, armT: 0.8, dmg: 60 * (1 + 0.1 * (c.missionRank || 0)), r: 75 });
}
function detonateRemotes(g, c) {
  let n = 0;
  for (const o of g.objs) if (o.kind === 'mine' && o.owner === c.id && o.sub === 'remote') { o.boom = true; o.armT = 0; n++; }
  if (n) say(g, c, 'Boom.');
  return n;
}

function chainsaw(g, c, held, dt) {
  c.chainsawOn = held && !c.phased;
  if (!c.chainsawOn) return;
  c.sawTick = (c.sawTick || 0) - dt;
  if (c.sawTick > 0) return;
  c.sawTick = 0.1;
  const hits = melee(g, c, { dmg: 7.5, range: 44, arc: 0.9 }, c.facing, 'crew', { kind: 'chainsaw' });
  if (!hits) hitThingsInFront(g, c, 6);
  g.fx({ t: 'saw', x: c.x, y: c.y, a: c.facing, hit: hits > 0 });
}

// ---------------------------------------------------------------------------
// Slot machine
const SYMBOLS = ['🍒', '💎', '🦊', '⛏', '7'];
export function spinSlots(g, c) {
  if (c.wallet < 5) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'need 5 to spin', color: '#ccc' }); return false; }
  c.wallet -= 5;
  const n = 3 + c.upgrades[0];
  const luck = c.upgrades[2];
  const reels = [];
  for (let k = 0; k < n; k++) {
    if (k > 0 && g.rng.chance(0.12 + 0.05 * luck)) reels.push(reels[k - 1]);
    else reels.push(g.rng.pick(SYMBOLS));
  }
  const counts = {}; for (const s of reels) counts[s] = (counts[s] || 0) + 1;
  const best = Math.max(...Object.values(counts));
  const sym = Object.keys(counts).find((s) => counts[s] === best);
  let win = 0;
  if (best === n) win = sym === '7' ? 150 : 60;
  else if (best >= 3) win = 15 * (best - 1);
  else if (best === 2) win = 6;
  c.wallet += win;
  c.lastSpin = { reels, win };
  gainXp(g, c, 1 + win / 12);
  if (win > 6) { c.coinWinT = 30; c.coinWinMul = best === n ? 3 : 2; }
  if (best === n && sym === '7') { // JACKPOT: coin explosion
    explode(g, c.x, c.y, 140, 60, 'crew', c, { kind: 'coin' });
    for (let k = 0; k < 12; k++) dropPickup(g, c.x + g.rng.range(-60, 60), c.y + g.rng.range(-60, 60), 'coin', 3);
  }
  g.fx({ t: 'slots', crew: c.id, reels, win, x: c.x, y: c.y });
}

/** Where each bought bed and jukebox stands (they live with the room's slot, so they survive rebuilds). */
export function furniturePlaces(g) {
  const out = [];
  for (const f of g.ship?.furniture || []) {
    const room = g.rooms.find((r) => r.owner === 'us' && !r.gone && r.sx === f.sx && r.sy === f.sy && r.type !== 'corridor');
    if (!room) continue;
    const [ox, oy] = FURNITURE_SPOTS[f.k] || FURNITURE_SPOTS[0];
    const w = room.w ?? 10, h = room.h ?? 7;
    out.push({ ...f, room, x: (room.x0 + Math.min(ox, w - 1.2)) * TILE, y: (room.y0 + Math.min(oy, h - 1.2)) * TILE });
  }
  return out;
}

// ---------------------------------------------------------------------------
// E: interactions
export function interactTarget(g, c) {
  const r = g.rooms[roomAt(g, c)];
  // furniture from the Deep Cities
  if (g.ship?.furniture?.length) for (const f of furniturePlaces(g)) {
    if (dist(f, c) > 34) continue;
    if (f.type === 'bed') return { kind: 'bed', obj: f, label: c.resting ? 'Get up' : 'Lie down in the bed (heals fast)' };
    if (f.type === 'jukebox') return { kind: 'jukebox', obj: f, label: `Jukebox: ${JUKEBOX_SONGS[g.ship.jukebox || 0]} → ${JUKEBOX_SONGS[((g.ship.jukebox || 0) + 1) % JUKEBOX_SONGS.length]}` };
  }
  // journal / Joe / crates
  for (const o of g.objs) {
    if ((o.kind === 'journal' || o.kind === 'crate') && dist(o, c) < 40) {
      if (o.heavy && c.cls === 'chameleon') return { kind: 'none', obj: o, label: 'Way too heavy for you. Get someone through the vault door (C4).' };
      return { kind: o.kind, obj: o, label: o.kind === 'journal' ? 'Read the journal' : o.island ? 'Open the treasure chest' : o.heavy ? 'Haul out the vault loot' : 'Loot crate' };
    }
  }
  if (c.cls === 'chameleon') {
    for (const o of g.objs) if (o.kind === 'vent' && !o.broken && dist(o, c) < 30) return { kind: 'vent', obj: o, label: 'Crawl into the vent (pick where to come out)' };
    // or point at one (with the mouse) that's not too far
    if (c.aim) for (const o of g.objs) if (o.kind === 'vent' && !o.broken && dist(o, c.aim) < 22 && dist(o, c) < 5 * TILE && g.grid.los(c.x, c.y, o.x, o.y, g.doors)) return { kind: 'vent', obj: o, label: 'Crawl into that vent (pick where to come out)' };
  }
  if (c.cls === 'farmer' && (c.carrying || 0) < 5) for (const o of g.objs) if (o.kind === 'mess' && o.sub === 'dirt' && dist(o, c) < 34) return { kind: 'dirt', obj: o, label: 'Scoop dirt' };
  const FK = fixKey(c).toUpperCase();
  if (r && r.sys && r.alive && dist(r.station, c) < 56) {
    const dmg = r.sys.hp < r.sys.max;
    return { kind: 'station', obj: r, label: r.owner === 'them' ? `Smash their ${r.name}` : (dmg ? `${stationLabel(r)} · hold ${FK} to repair it` : stationLabel(r)), damaged: dmg };
  }
  const rt = repairTarget(g, c);
  if (rt) return { kind: 'repair', obj: rt, label: `Hold ${FK} (or E): repair ${rt.label}` };
  for (const o of g.objs) if (o.kind === 'fire' && dist(o, c) < 48) return { kind: 'fire', obj: o, label: c.cls === 'mrclean' ? 'Hold E: put out the fire (fast)' : 'Hold E: fire extinguisher' };
  if (c.cls === 'mrclean' || !nearDoor(g, c)) for (const o of g.objs) if (o.kind === 'mess' && dist(o, c) < 34) return { kind: 'mess', obj: o, label: c.cls === 'mrclean' ? 'Hold E: sweep' : 'Hold E: sweep (slowly: the janitor is quicker)' };
  const d = nearDoor(g, c);
  if (d) {
    const what = d.blast ? 'blast door' : 'door';
    return { kind: 'door', obj: d, label: d.sealed ? (CLASSES[c.cls].clearance ? `Unseal ${what} (clearance)` : 'Sealed: needs clearance')
      : d.hold === 'closed' ? `Prop the ${what} open` : d.hold === 'open' ? `Shut the ${what}` : `Shut the ${what}` };
  }
  return null;
}
function stationLabel(r) {
  return { helm: 'Take the helm', engine: 'Engine status', weapons: 'D-weapons targeting', shield: 'Bubble generator', vault: 'Open the vault',
    kitchen: 'Cook', closet: 'Janitor closet', armory: 'Armory workbench', farm: 'Tend the farm', lab: 'Research & power', kennel: 'Lie in the dog bed',
    pen: 'Monster pen', den: 'Vent map', bubbler: 'Air currents', office: 'Mission watch', casino: 'Play the slots', guardpost: 'Guard post',
    lounge: 'Sit in the lounge chair', feeder: 'Feeder controls', storage: 'Storage', quarters: 'Bunks' }[r.sys.type] || r.name;
}

function nearDoor(g, c) {
  let best = null, bd = 44 * 44;
  for (const d of g.doors) {
    const dx = (d.x + .5) * TILE - c.x, dy = (d.y + .5) * TILE - c.y;
    const dd = dx * dx + dy * dy;
    if (dd < bd && !d.broken) { bd = dd; best = d; }
  }
  return best;
}

/** Nearest broken/damaged thing within reach: doors, walls, breaches (not systems; those are at stations). */
export function repairTarget(g, c, reach = 46) {
  const cx = Math.floor(c.x / TILE), cy = Math.floor(c.y / TILE);
  let best = null, bd = reach * reach;
  for (let ty = cy - 2; ty <= cy + 2; ty++) for (let tx = cx - 2; tx <= cx + 2; tx++) {
    if (!inMap(tx, ty)) continue;
    const i = idx(tx, ty);
    const t = g.grid.tiles[i];
    const orig = g.orig.get(i);
    let label = null;
    if (t === T.BREACH) label = 'hull breach';
    else if (t === T.DEBRIS) label = 'wreckage (blocking the way)';
    else if (t === T.RUBBLE && orig !== undefined) label = orig === T.DOOR ? 'smashed door' : orig === T.FLOOR ? 'wreckage' : 'smashed wall';
    else if ((t === T.WALL || t === T.HULL) && g.grid.hp[i] < TILE_HP[t]) label = 'damaged wall';
    else if (t === T.DOOR) { const d = g.doors[g.grid.doorAt[i]]; if (d && d.hp < d.maxHp) label = 'damaged door'; }
    if (!label) continue;
    if (tileOwner(g, tx, ty) === 'them') continue;
    // don't rebuild a wall on top of someone
    if ((t === T.RUBBLE || t === T.BREACH) && orig !== T.FLOOR && occupied(g, tx, ty)) continue;
    const dx = (tx + .5) * TILE - c.x, dy = (ty + .5) * TILE - c.y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = { i, tx, ty, label }; }
  }
  return best;
}
function occupied(g, tx, ty) {
  for (const a of [...g.crew, ...g.mobs]) if (a.alive && Math.floor(a.x / TILE) === tx && Math.floor(a.y / TILE) === ty) return true;
  return false;
}

function interactPress(g, c) {
  const it = interactTarget(g, c);
  if (!it) return;
  switch (it.kind) {
    case 'bed':
      if (c.resting) { c.resting = null; break; }
      c.resting = { x: it.obj.x, y: it.obj.y }; c.x = it.obj.x; c.y = it.obj.y;
      g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'zzz', color: '#c0d0ff' });
      break;
    case 'jukebox':
      g.ship.jukebox = ((g.ship.jukebox || 0) + 1) % JUKEBOX_SONGS.length;
      g.fx({ t: 'text', x: c.x, y: c.y - 20, text: g.ship.jukebox ? `♪ ${JUKEBOX_SONGS[g.ship.jukebox]}` : 'music off', color: '#f4c542' });
      break;
    case 'journal': g.readJournal(c, it.obj); break;
    case 'crate': g.lootCrate(c, it.obj); break;
    case 'vent':
      // players get the vent map and choose; bots just pop out somewhere
      if (c.human) g.fx({ t: 'panel', crew: c.id, panel: 'vents', room: null, vent: it.obj.id });
      else ventTravel(g, c, it.obj);
      break;
    case 'dirt': { const take = Math.min(it.obj.amt, 5 - (c.carrying || 0)); c.carrying = (c.carrying || 0) + take; it.obj.amt -= take; if (it.obj.amt <= 0) g.objs.splice(g.objs.indexOf(it.obj), 1); g.fx({ t: 'text', x: c.x, y: c.y - 20, text: `dirt ${c.carrying}/5`, color: '#c8b040' }); break; }
    case 'station':
      if (it.obj.owner === 'them') break;
      if (it.damaged && it.obj.sys.hp < it.obj.sys.max * 0.999 && c.human) { /* holding handles repair; tap still opens panel */ }
      if (it.obj.type === 'farm' && c.cls === 'farmer' && c.carrying) { g.ship.farm.dirt += c.carrying; g.fx({ t: 'text', x: c.x, y: c.y - 20, text: `+${c.carrying} dirt to the farm`, color: '#c8b040' }); c.carrying = 0; }
      if (it.obj.type === 'kennel' && c.cls === 'dog') { c.napT = 1; }
      g.panel(c, it.obj.sys.type, it.obj);
      break;
    case 'door': {
      const d = it.obj;
      if (d.sealed) { if (CLASSES[c.cls].clearance || c.isJoe) { d.sealed = false; d.hold = null; g.fx({ t: 'door', x: d.x, y: d.y, unseal: true }); } else g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'no clearance', color: '#ff8080' }); }
      else {
        // toggle: shut it (boarders have to smash through) or prop it open (anyone can pass, them too).
        // A blast door is several tiles across the walkway; they all go together.
        const hold = d.hold === 'closed' ? 'open' : 'closed';
        // (a blast door's tiles, and both halves of a double door, go together)
        const set = d.group != null ? g.doors.filter((x) => x.blast && x.group === d.group && !x.broken)
          : d.pair != null ? g.doors.filter((x) => x.pair === d.pair && !x.broken) : [d];
        for (const o of set) o.hold = hold;
        g.grid.version++;   // (paths change)
        g.fx({ t: 'door', x: d.x, y: d.y, blast: !!d.blast, open: hold === 'open' });
      }
      break;
    }
  }
}

/** The repair key for this class: R, unless R is already one of its abilities (then V). The engineer's R wrench does both. */
export function fixKey(c) { const r = CLASSES[c.cls]?.abilities?.r; return r && r !== 'wrenchhit' ? 'v' : 'r'; }

/** Hold the repair key: put out a fire, fix the nearest damaged system in sight (at any station nearby), else a wall, door or breach. */
export function repairHold(g, c, dt) {
  if (extinguish(g, c, dt)) return true;
  let best = null, bd = 72 * 72;
  for (const r of g.rooms) {
    if (r.owner !== 'us' || !r.sys || r.gone || r.alive === false || r.sys.hp >= r.sys.max || !r.station) continue;
    const d = (r.station.x - c.x) ** 2 + (r.station.y - c.y) ** 2;
    if (d < bd && g.grid.los(c.x, c.y, r.station.x, r.station.y, g.doors)) { bd = d; best = r; }
  }
  if (best) { repairSystem(g, c, best, dt); return true; }
  const t = repairTarget(g, c, 58);
  if (t) { repairTile(g, c, t, repairRate(c) * dt); return true; }
  return false;
}

function interactHold(g, c, dt) {
  // fires come first: everyone carries an extinguisher
  if (extinguish(g, c, dt)) return;
  // sweeping
  // sweeping: anyone can (slowly). The janitor is fast at it, and gets paid.
  if (c.cls === 'mrclean' && sweep(g, c, dt)) return;
  // station repair (own ship) or smashing their systems
  const r = g.rooms[roomAt(g, c)];
  if (r && r.sys && dist(r.station, c) < 56) {
    if (r.owner === 'them') { c.smashT = (c.smashT || 0) - dt; if (c.smashT <= 0) { c.smashT = 0.4; damageSystem(g, r, 8); g.fx({ t: 'spark', x: r.station.x, y: r.station.y }); } return; }
    if (r.sys.hp < r.sys.max) { repairSystem(g, c, r, dt); return; }
  }
  const t = repairTarget(g, c);
  if (t) repairTile(g, c, t, repairRate(c) * dt);
  else if (!(c.cls === 'farmer' && (c.carrying || 0) < 5)) sweep(g, c, dt);   // nothing to fix: tidy up (slowly)
}

/** Hold E on a mess: anyone can sweep it up, slowly. The janitor is fast at it, and gets paid. */
function sweep(g, c, dt) {
  const janitor = c.cls === 'mrclean';
  for (const o of g.objs) if (o.kind === 'mess' && dist(o, c) < 34) {
    o.sweep = (o.sweep || 0) + dt * (janitor ? 1.6 + 1.6 * c.upgrades[1] : 0.35);
    if (o.sweep >= 1) { o.sweep = 0; o.amt--; if (janitor) c.wallet += 2; g.stats.cleaned++; gainXp(g, c, janitor ? 1.5 : 0.6); if (o.amt <= 0) g.objs.splice(g.objs.indexOf(o), 1); g.fx({ t: 'sweep', x: o.x, y: o.y }); }
    return true;
  }
  return false;
}

export function repairRate(c) {
  let rate = 15.4;   // (everyone's base repair: +10%)
  if (c.cls === 'engineer') rate *= 2.2 * (1 + 0.25 * c.upgrades[0]);
  if (c.isJoe) rate *= 4;
  if (c.cls === 'guard') rate *= 1.3;
  return rate * (1 + stat(c, 'special') * (c.cls === 'engineer' ? 0.4 : 0));
}

export function repairSystem(g, c, r, dt, amount) {
  let amt = amount ?? repairRate(c) * dt;
  if (r.type === 'engine' && c.cls !== 'engineer' && !c.isJoe) amt *= 0.45; // engineers fix engines best
  if (r.type === 'vault' && c.cls === 'guard') amt *= 2;
  const cost = amt * 0.06;
  if (g.ship.scrap >= cost) g.ship.scrap -= cost; else amt *= 0.6;
  const before = r.sys.hp;
  r.sys.hp = Math.min(r.sys.max, r.sys.hp + amt);
  c.repairs = (c.repairs || 0) + amt;
  c.repairing = 0.2;
  gainXp(g, c, (r.sys.hp - before) * 0.11);
  if (before < r.sys.max && r.sys.hp >= r.sys.max && g.rng.chance(0.5)) quip(g, c, 'repair');
  if (g.rng.chance(dt * 6)) g.fx({ t: 'spark', x: r.station.x + g.rng.range(-10, 10), y: r.station.y + g.rng.range(-6, 6), color: '#7cc46a' });
}

export function repairTile(g, c, t, amt) {
  const cost = amt * 0.05;
  if (g.ship.scrap >= cost) g.ship.scrap -= cost; else amt *= 0.35;
  // patching the structure shores up the hull too
  g.ship.hull = Math.min(g.ship.hullMax, g.ship.hull + amt * 0.12);
  const i = t.i;
  const tt = g.grid.tiles[i];
  c.repairing = 0.2;
  c.repairs = (c.repairs || 0) + amt;
  gainXp(g, c, amt * 0.1);
  if (g.rng.chance(0.15)) g.fx({ t: 'spark', x: (t.tx + .5) * TILE, y: (t.ty + .5) * TILE, color: '#7cc46a' });
  if (tt === T.DOOR) {
    const d = g.doors[g.grid.doorAt[i]];
    if (c.isJoe) amt *= 2;
    d.hp = Math.min(d.maxHp, d.hp + amt);
    return;
  }
  if (tt === T.WALL || tt === T.HULL) { g.grid.hp[i] = Math.min(TILE_HP[tt], g.grid.hp[i] + amt); return; }
  // rebuilding a breach / rubble, clearing wreckage
  g.rebuild.set(i, (g.rebuild.get(i) || 0) + amt);
  const target = tt === T.BREACH ? T.HULL : g.orig.get(i) ?? T.FLOOR;
  if (g.rebuild.get(i) >= (TILE_HP[target] || 60) * 0.7) {
    g.rebuild.delete(i);
    g.orig.delete(i);
    if (target === T.DOOR) {
      g.grid.tiles[i] = T.DOOR;
      const d = g.doors[g.grid.doorAt[i]];
      if (d) { d.broken = false; d.hp = d.maxHp * 0.6; d.open = 0; }
    } else { g.grid.tiles[i] = target; g.grid.hp[i] = (TILE_HP[target] || 0) * 0.7; }
    g.grid.version++;
    g.fx({ t: 'fixed', x: (t.tx + .5) * TILE, y: (t.ty + .5) * TILE });
    g.stats.repairs++;
    gainXp(g, c, 3);
    // anyone standing half inside the new wall gets nudged out of it
    for (const a of [...g.crew, ...g.mobs]) if (a.alive && Math.abs(a.x - (t.tx + .5) * TILE) < TILE + a.r && Math.abs(a.y - (t.ty + .5) * TILE) < TILE + a.r) unstick(g, a);
  }
}

/** Kick the ice block in front of you: it slides off (a nice speed), carrying enemies; walls smash them. */
function kickIce(g, c, ang) {
  for (const reach of [22, 38]) {
    const tx = Math.floor((c.x + Math.cos(ang) * reach) / TILE), ty = Math.floor((c.y + Math.sin(ang) * reach) / TILE);
    if (g.grid.get(tx, ty) !== T.ICE) continue;
    const i = idx(tx, ty);
    const o = g.objs.find((x) => x.kind === 'ice' && x.i === i);
    g.grid.tiles[i] = g.iceUnder.get(i) ?? T.FLOOR; g.iceUnder.delete(i); g.grid.version++;
    if (o) g.objs.splice(g.objs.indexOf(o), 1);
    // slide along the main axis you kicked it (it's a block: it goes straight)
    const ax = Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang));
    const dir = ax ? { x: Math.sign(Math.cos(ang)), y: 0 } : { x: 0, y: Math.sign(Math.sin(ang)) };
    g.objs.push({ id: uid(), kind: 'iceslide', x: (tx + .5) * TILE, y: (ty + .5) * TILE, vx: dir.x * 430, vy: dir.y * 430, t: 2.4, owner: c.id, carry: [], dmg: 40 * (1 + 0.25 * c.upgrades[1]) });
    g.fx({ t: 'text', x: c.x, y: c.y - 22, text: 'KICK!', color: '#bfefff' });
    gainXp(g, c, 1);
    return true;
  }
  return false;
}

function wrenchRepair(g, c, amount) {
  // station in front?
  const r = g.rooms[roomAt(g, c)];
  if (r && r.owner === 'us' && r.sys && r.sys.hp < r.sys.max && dist(r.station, c) < 54) {
    repairSystem(g, c, r, 0, amount * 1.6);
    g.fx({ t: 'clang', x: r.station.x, y: r.station.y });
    return;
  }
  const t = repairTarget(g, c, 54);
  if (t) { repairTile(g, c, t, amount * 1.4); g.fx({ t: 'clang', x: (t.tx + .5) * TILE, y: (t.ty + .5) * TILE }); }
}

function hitThingsInFront(g, c, dmg) {
  // smashing enemy systems by attacking them
  const r = g.rooms[roomAt(g, c)];
  if (r && r.owner === 'them' && r.sys && dist(r.station, c) < 56) { damageSystem(g, r, dmg * 0.6); g.fx({ t: 'spark', x: r.station.x, y: r.station.y }); return; }
  // ...and their doors
  const fx = c.x + Math.cos(c.facing) * 30, fy = c.y + Math.sin(c.facing) * 30;
  const tx = Math.floor(fx / TILE), ty = Math.floor(fy / TILE);
  if (g.grid.get(tx, ty) === T.DOOR) {
    const d = g.doors[g.grid.doorAt[idx(tx, ty)]];
    if (d && d.owner === 'them' && d.open < 0.75) { hitTile(g, tx, ty, dmg); g.fx({ t: 'bang', x: (tx + .5) * TILE, y: (ty + .5) * TILE }); }
  }
  // hack through wreckage
  if (g.grid.get(tx, ty) === T.DEBRIS) { hitTile(g, tx, ty, dmg * 0.8); g.fx({ t: 'bang', x: (tx + .5) * TILE, y: (ty + .5) * TILE }); }
}

function ventTravel(g, c, from) {
  const vents = g.objs.filter((o) => o.kind === 'vent' && !o.broken && o !== from);
  if (!vents.length) return;
  ventTo(g, c, from, g.rng.pick(vents));
}
/** Crawl from one vent to another (any vent: ours, or theirs on a docked ship). */
export function ventTo(g, c, from, to) {
  c.x = to.x; c.y = to.y + 18;
  unstick(g, c);
  c.ventT = c.upgrades[2] ? 0 : 0.6;
  g.fx({ t: 'vent', x: from.x, y: from.y, x2: to.x, y2: to.y });
  if (!c.cloaked) { c.cloaked = true; c.cloakBreak = 0; }
  gainXp(g, c, 1);
}

// ---------------------------------------------------------------------------
function passive(g, c, dt) {
  if (c.repairing > 0) c.repairing -= dt;
  // everyone heals very slowly on their own: 1 health every 10 seconds
  if (c.alive && c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + dt * 0.1);
  // lying in a bed: heal fast (walking off gets you up)
  if (c.resting) {
    if (!c.alive || c.moving || Math.hypot(c.x - c.resting.x, c.y - c.resting.y) > 10) c.resting = null;
    else { c.hp = Math.min(c.maxHp, c.hp + dt * 9); if (c.stam != null) c.stam = Math.min(c.stamMax || 100, c.stam + dt * 20); }
  }
  if (c.spinT > 0) { // whirlwind
    c.spinT -= dt; c.spinTick -= dt;
    if (c.spinTick <= 0) { c.spinTick = 0.2; melee(g, c, { dmg: 18 * (1 + 0.2 * c.upgrades[0]), range: 58, arc: 7 }, 0, 'crew', { knock: 90 }); g.fx({ t: 'swing', x: c.x, y: c.y, a: g.time * 20, r: 58, cls: 'mrclean' }); }
  }
  // everyone talks now and then, in their own voice
  if (c.cls !== 'urchid' && g.rng.chance(dt / 50)) {
    const busy = g.mobs.some((m) => m.alive && m.team === 'enemy' && Math.abs(m.x - c.x) < 300 && Math.abs(m.y - c.y) < 300);
    quip(g, c, busy ? 'fight' : 'idle');
  }
  if (c.cls === 'urchid' && !c.human && g.rng.chance(dt / 40)) quip(g, c, 'idle');
  if (c.cls === 'chef' && c.cooking) {
    c.cooking.t -= dt;
    if (c.cooking.t <= 0) { g.serveMeal(c, c.cooking); c.cooking = null; say(g, c, g.rng.pick(CHEF_LINES)); }
  }
  if (c.cls === 'dog' && c.napT !== undefined) {
    const r = g.rooms[roomAt(g, c)];
    if (r?.type === 'kennel' && !c.moving) healActor(c, (4 + 3 * c.upgrades[1]) * dt);
  }
  if (c.cls === 'trainer') for (const m of c.monsters) if (m.reviveT > 0) {
    const inPen = g.rooms[roomAt(g, c)]?.type === 'pen';
    m.reviveT -= dt * (inPen ? 2 : 1);
  }
  if (c.cls === 'urchid' && !c.human && g.rng.chance(dt / 12)) ABILITY_FNS.insult(g, c);
  if (c.cls === 'scientist') {
    const r = g.rooms[roomAt(g, c)];
    if (r?.type === 'lab') {
      if (g.ship.researching) g.researchTick(c, dt);
      else gainXp(g, c, dt * 0.3);   // minding the power grid
    }
  }
}
