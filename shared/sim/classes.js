// Every class's kit: primary fire, abilities, passives, and E-interactions.
import { T, TILE, TILE_HP, CLASSES, WEAPONS, ABILITIES, INSULTS, JARGON, DOG_BARKS, CHEF_LINES } from './data.js';
import { idx, inMap } from './grid.js';
import {
  moveActor, melee, fireBullet, spawnProj, explode, damage, stat, addBuff, healActor, roomAt,
  hostiles, popBubble, airAt, addMess, dropPickup, damageSystem, hitTile,
} from './combat.js';
import { clamp, norm, dist, dist2, angTo, uid } from './util.js';

const STAFF_FORMS = ['staff', 'blade', 'rifle', 'shotgun'];
const STAFF_W = {
  staff: WEAPONS.staff,
  blade: { kind: 'melee', dmg: 27, rate: 0.34, range: 46, arc: 1.7 },
  rifle: { ...WEAPONS.rifle, dmg: 10 },
  shotgun: { ...WEAPONS.shotgun, pellets: 6 },
};
export const MINE_TYPES = ['proximity', 'timed', 'remote', 'c4'];
const JARS = ['poison', 'acid', 'explosive'];

export function weaponOf(c) {
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
  if (inp.shift && !c.cloaked) sp *= 1.25;
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
  if (c.makeshift > 0) c.makeshift -= dt;
  if (c.swingT > 0) c.swingT -= dt;
  if (c.hurtT > 0) c.hurtT -= dt;
  if (c.sayT > 0) c.sayT -= dt;

  // regen buffs, poison
  const regen = stat(c, 'regen');
  if (regen) healActor(c, regen * dt);
  if (c.stunT > 0) { c.stunT -= dt; return; }

  // ---- movement
  const sp = crewSpeed(g, c, inp);
  if (c.slowT > 0) c.slowT -= dt;

  if (c.dashT > 0) { // lunges, pounces, rolls
    c.dashT -= dt;
    moveActor(g, c, c.dashV.x * dt, c.dashV.y * dt);
    dashHits(g, c);
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
  if (c.phased) { c.phaseT -= dt; if (c.phaseT <= 0) unphase(g, c); }

  // ---- primary fire
  const w = weaponOf(c);
  if (c.cd.fire <= 0 && inp.fire && !c.phased && !c.riding) {
    primary(g, c, w, inp);
  }

  // ---- abilities
  const P = inp.pressed || {};
  if (P.q && def.abilities.q) useAbility(g, c, def.abilities.q, inp, 'q');
  if (P.f && def.abilities.f) useAbility(g, c, def.abilities.f, inp, 'f');
  if (def.abilities.rmb === 'chainsaw') chainsaw(g, c, inp.rmb, dt);
  else if (P.rmb && def.abilities.rmb) useAbility(g, c, def.abilities.rmb, inp, 'rmb');
  else if (P.rmb && c.cls === 'agent') detonateRemotes(g, c);
  else if (P.rmb && c.cls === 'farmer') useAbility(g, c, 'pitchfork', inp, 'q');
  else if (P.rmb && c.cls === 'chef') useAbility(g, c, 'fish', inp, 'f');
  if (P.space && def.abilities.space) useAbility(g, c, def.abilities.space, inp, 'space');

  // ---- interact
  if (P.e) interactPress(g, c);
  if (inp.e) interactHold(g, c, dt);

  // ---- passives
  passive(g, c, dt);
}

function primary(g, c, w, inp) {
  const ang = c.facing;
  let mul = 1 + stat(c, 'dmg') + (c.makeshift > 0 ? 0.3 : 0) + (g.ship.research.has('skilltree') ? 0.1 : 0);
  if (c.special) mul += 0.4;
  const rateMul = 1 + stat(c, 'rate');
  const up = c.upgrades;
  c.cd.fire = w.rate / Math.max(0.3, rateMul);
  if (c.cloaked && w.kind !== 'heckle') c.cloakBreak = 1;
  switch (w.kind) {
    case 'heckle': {
      const target = nearestCrew(g, c);
      const tier = Math.min(INSULTS.length - 1, Math.max(g.tier, up[1]));
      say(g, c, g.rng.pick(INSULTS[g.rng.int(0, tier)]), target);
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
      const hits = melee(g, c, w, ang, 'crew', opts);
      // the wrench also repairs whatever it hits
      if (c.cls === 'engineer' || c.isJoe) wrenchRepair(g, c, w.repair * (1 + 0.25 * up[0]));
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
      if (c.cls === 'slots') { if (c.wallet < 1) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'no coins!', color: '#ccc' }); c.cd.fire = 0.5; return; } c.wallet -= 1; }
      const kind = c.cls === 'slots' ? 'coin' : c.cls === 'agent' ? 'ppk' : 'bullet';
      fireBullet(g, c, ang, ww, 'crew', { mul, kind });
      g.fx({ t: 'shot', x: c.x, y: c.y, a: ang, w: c.cls === 'agent' && up[0] ? 'silenced' : kind });
      break;
    }
    case 'rocket':
      spawnProj(g, { kind: 'rocket', x: c.x + Math.cos(ang) * 14, y: c.y + Math.sin(ang) * 14, vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
        dmg: w.dmg * mul, radius: w.radius * (1 + 0.15 * up[2]), team: 'crew', owner: c, life: 1.6, r: 5 });
      g.fx({ t: 'shot', x: c.x, y: c.y, a: ang, w: 'rocket' });
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

function lob(g, c, tx, ty, kind, extra) {
  const d = Math.min(WEAPONS.jar.range, Math.hypot(tx - c.x, ty - c.y));
  const a = Math.atan2(ty - c.y, tx - c.x);
  const ex = c.x + Math.cos(a) * d, ey = c.y + Math.sin(a) * d;
  spawnProj(g, { kind, sx: c.x, sy: c.y, tx: ex, ty: ey, x: c.x, y: c.y, dur: 0.35 + d / 700, team: 'crew', owner: c, life: 5, ...extra });
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
    for (const o of g.crew) if (o.alive && roomAt(g, o) === r) addBuff(o, { speed: 0.25, rate: 0.25 }, 6, 'rally');
    say(g, c, 'Hold together, crew!');
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
    const tier = Math.min(INSULTS.length - 1, g.tier + c.upgrades[1]);
    say(g, c, g.rng.pick(INSULTS[tier]), target);
    g.stats.insults++;
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
  pitchfork(g, c) { melee(g, c, { dmg: 20, range: 56, arc: 1.7 }, c.facing, 'crew', { knock: 280 }); c.swingT = 0.22; g.fx({ t: 'swing', x: c.x, y: c.y, a: c.facing, r: 56, cls: 'pitchfork' }); },
  feast(g, c) { healActor(c, 50); say(g, c, 'Mmm. Dirt-fresh.'); },
  jarswap(g, c) { c.jar = JARS[(JARS.indexOf(c.jar || 'poison') + 1) % JARS.length]; g.fx({ t: 'text', x: c.x, y: c.y - 20, text: `${c.jar} jar`, color: '#50c8e8' }); },
  overclock(g, c) {
    const r = g.rooms[roomAt(g, c)];
    if (!r || r.type !== 'lab') { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'route power from the lab', color: '#ccc' }); return false; }
    g.panel(c, 'lab');
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
  mine(g, c) {
    const type = c.mineType || 'proximity';
    if (type === 'c4' && (c.missionRank || 0) < 3) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'C4 needs mission rank 3', color: '#ccc' }); return false; }
    const p = inFront(c, 14);
    g.objs.push({ id: uid(), kind: 'mine', sub: type, owner: c.id, x: p.x, y: p.y, t: type === 'timed' ? 3 : 0, armT: 0.8,
      dmg: type === 'c4' ? 140 : 60, r: type === 'c4' ? 120 : 75 });
  },
  minetype(g, c) { c.mineType = MINE_TYPES[(MINE_TYPES.indexOf(c.mineType || 'proximity') + 1) % MINE_TYPES.length]; g.fx({ t: 'text', x: c.x, y: c.y - 20, text: `${c.mineType} mine`, color: '#d0d0d0' }); },
  roll(g, c) { startDash(g, c, 190, 0.38, 38 * (1 + 0.25 * c.upgrades[1]), 'crush'); },
  spin(g, c) { return spinSlots(g, c); },
};

function unphase(g, c) { c.phased = false; c.phaseT = 0; c.cd.q = Math.max(c.cd.q, ABILITIES.phase.cd); g.fx({ t: 'phase', x: c.x, y: c.y }); }
function inFront(c, d) { return { x: c.x + Math.cos(c.facing) * d, y: c.y + Math.sin(c.facing) * d }; }

function detonateRemotes(g, c) {
  let n = 0;
  for (const o of g.objs) if (o.kind === 'mine' && o.owner === c.id && (o.sub === 'remote' || o.sub === 'c4')) { o.boom = true; n++; }
  if (n) say(g, c, 'Boom.');
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
  if (win > 6) { c.coinWinT = 30; c.coinWinMul = best === n ? 3 : 2; }
  if (best === n && sym === '7') { // JACKPOT: coin explosion
    explode(g, c.x, c.y, 140, 60, 'crew', c, { kind: 'coin' });
    for (let k = 0; k < 12; k++) dropPickup(g, c.x + g.rng.range(-60, 60), c.y + g.rng.range(-60, 60), 'coin', 3);
  }
  g.fx({ t: 'slots', crew: c.id, reels, win, x: c.x, y: c.y });
}

// ---------------------------------------------------------------------------
// E: interactions
export function interactTarget(g, c) {
  const r = g.rooms[roomAt(g, c)];
  // journal / Joe / crates
  for (const o of g.objs) {
    if ((o.kind === 'journal' || o.kind === 'crate') && dist(o, c) < 40) return { kind: o.kind, obj: o, label: o.kind === 'journal' ? 'Read the journal' : 'Loot crate' };
  }
  if (c.cls === 'chameleon') for (const o of g.objs) if (o.kind === 'vent' && !o.broken && dist(o, c) < 30) return { kind: 'vent', obj: o, label: 'Crawl into the vent' };
  if (c.cls === 'farmer' && (c.carrying || 0) < 5) for (const o of g.objs) if (o.kind === 'mess' && o.sub === 'dirt' && dist(o, c) < 34) return { kind: 'dirt', obj: o, label: 'Scoop dirt' };
  if (r && r.sys && r.alive && dist(r.station, c) < 46) {
    const dmg = r.sys.hp < r.sys.max;
    return { kind: 'station', obj: r, label: r.owner === 'them' ? `Smash their ${r.name}` : (dmg ? `${stationLabel(r)} · hold E to repair` : stationLabel(r)), damaged: dmg };
  }
  const rt = repairTarget(g, c);
  if (rt) return { kind: 'repair', obj: rt, label: `Hold E: repair ${rt.label}` };
  if (c.cls === 'mrclean') for (const o of g.objs) if (o.kind === 'mess' && dist(o, c) < 34) return { kind: 'mess', obj: o, label: 'Hold E: sweep' };
  const d = nearDoor(g, c);
  if (d) return { kind: 'door', obj: d, label: d.sealed ? (CLASSES[c.cls].clearance ? 'Unseal door (clearance)' : 'Sealed: needs clearance') : d.hold === 'closed' ? 'Open door' : 'Hold door shut' };
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
    else if (t === T.RUBBLE && orig !== undefined) label = orig === T.DOOR ? 'smashed door' : 'smashed wall';
    else if ((t === T.WALL || t === T.HULL) && g.grid.hp[i] < TILE_HP[t]) label = 'damaged wall';
    else if (t === T.DOOR) { const d = g.doors[g.grid.doorAt[i]]; if (d && d.hp < d.maxHp) label = 'damaged door'; }
    if (!label) continue;
    if (tileOwnerSimple(g, ty) === 'them') continue;
    // don't rebuild a wall on top of someone
    if ((t === T.RUBBLE || t === T.BREACH) && occupied(g, tx, ty)) continue;
    const dx = (tx + .5) * TILE - c.x, dy = (ty + .5) * TILE - c.y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = { i, tx, ty, label }; }
  }
  return best;
}
const tileOwnerSimple = (g, ty) => (ty < g.ourTopY ? 'them' : 'us');
function occupied(g, tx, ty) {
  for (const a of [...g.crew, ...g.mobs]) if (a.alive && Math.floor(a.x / TILE) === tx && Math.floor(a.y / TILE) === ty) return true;
  return false;
}

function interactPress(g, c) {
  const it = interactTarget(g, c);
  if (!it) return;
  switch (it.kind) {
    case 'journal': g.readJournal(c, it.obj); break;
    case 'crate': g.lootCrate(c, it.obj); break;
    case 'vent': ventTravel(g, c, it.obj); break;
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
      else { d.hold = d.hold === 'closed' ? null : 'closed'; g.fx({ t: 'door', x: d.x, y: d.y }); }
      break;
    }
  }
}

function interactHold(g, c, dt) {
  // sweeping
  if (c.cls === 'mrclean') {
    for (const o of g.objs) if (o.kind === 'mess' && dist(o, c) < 34) {
      o.sweep = (o.sweep || 0) + dt * (1.6 + 1.6 * c.upgrades[1]);
      if (o.sweep >= 1) { o.sweep = 0; o.amt--; c.wallet += 2; g.stats.cleaned++; if (o.amt <= 0) g.objs.splice(g.objs.indexOf(o), 1); g.fx({ t: 'sweep', x: o.x, y: o.y }); }
      return;
    }
  }
  // station repair (own ship) or smashing their systems
  const r = g.rooms[roomAt(g, c)];
  if (r && r.sys && dist(r.station, c) < 46) {
    if (r.owner === 'them') { c.smashT = (c.smashT || 0) - dt; if (c.smashT <= 0) { c.smashT = 0.4; damageSystem(g, r, 8); g.fx({ t: 'spark', x: r.station.x, y: r.station.y }); } return; }
    if (r.sys.hp < r.sys.max) { repairSystem(g, c, r, dt); return; }
  }
  const t = repairTarget(g, c);
  if (t) repairTile(g, c, t, repairRate(c) * dt);
}

export function repairRate(c) {
  let rate = 14;
  if (c.cls === 'engineer') rate *= 2.2 * (1 + 0.25 * c.upgrades[0]);
  if (c.isJoe) rate *= 4;
  if (c.cls === 'guard') rate *= 1.3;
  return rate * (1 + stat(c, 'special') * (c.cls === 'engineer' ? 0.4 : 0));
}

export function repairSystem(g, c, r, dt, amount) {
  let amt = amount ?? repairRate(c) * dt;
  if (r.type === 'engine' && c.cls !== 'engineer' && !c.isJoe) amt *= 0.25; // only engineers really fix engines
  if (r.type === 'vault' && c.cls === 'guard') amt *= 2;
  const cost = amt * 0.06;
  if (g.ship.scrap >= cost) g.ship.scrap -= cost; else amt *= 0.35;
  r.sys.hp = Math.min(r.sys.max, r.sys.hp + amt);
  c.repairs = (c.repairs || 0) + amt;
  c.repairing = 0.2;
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
  if (g.rng.chance(0.15)) g.fx({ t: 'spark', x: (t.tx + .5) * TILE, y: (t.ty + .5) * TILE, color: '#7cc46a' });
  if (tt === T.DOOR) {
    const d = g.doors[g.grid.doorAt[i]];
    if (c.isJoe) amt *= 2;
    d.hp = Math.min(d.maxHp, d.hp + amt);
    return;
  }
  if (tt === T.WALL || tt === T.HULL) { g.grid.hp[i] = Math.min(TILE_HP[tt], g.grid.hp[i] + amt); return; }
  // rebuilding a breach / rubble
  g.rebuild.set(i, (g.rebuild.get(i) || 0) + amt);
  const target = tt === T.BREACH ? T.HULL : g.orig.get(i);
  if (g.rebuild.get(i) >= (TILE_HP[target] || 60) * 0.7) {
    g.rebuild.delete(i);
    g.orig.delete(i);
    if (target === T.DOOR) {
      g.grid.tiles[i] = T.DOOR;
      const d = g.doors[g.grid.doorAt[i]];
      if (d) { d.broken = false; d.hp = d.maxHp * 0.6; d.open = 0; }
    } else { g.grid.tiles[i] = target; g.grid.hp[i] = TILE_HP[target] * 0.7; }
    g.grid.version++;
    g.fx({ t: 'fixed', x: (t.tx + .5) * TILE, y: (t.ty + .5) * TILE });
    g.stats.repairs++;
  }
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
}

function ventTravel(g, c, from) {
  const vents = g.objs.filter((o) => o.kind === 'vent' && !o.broken && o.owner === from.owner);
  if (vents.length < 2) return;
  const i = vents.indexOf(from);
  const to = vents[(i + 1) % vents.length];
  c.x = to.x; c.y = to.y + 18;
  c.ventT = c.upgrades[2] ? 0 : 0.6;
  g.fx({ t: 'vent', x: from.x, y: from.y, x2: to.x, y2: to.y });
  if (!c.cloaked) { c.cloaked = true; c.cloakBreak = 0; }
}

// ---------------------------------------------------------------------------
function passive(g, c, dt) {
  if (c.repairing > 0) c.repairing -= dt;
  if (c.spinT > 0) { // whirlwind
    c.spinT -= dt; c.spinTick -= dt;
    if (c.spinTick <= 0) { c.spinTick = 0.2; melee(g, c, { dmg: 18 * (1 + 0.2 * c.upgrades[0]), range: 58, arc: 7 }, 0, 'crew', { knock: 90 }); g.fx({ t: 'swing', x: c.x, y: c.y, a: g.time * 20, r: 58, cls: 'mrclean' }); }
  }
  if (c.cls === 'scientist' && g.rng.chance(dt / 35)) say(g, c, g.rng.pick(JARGON));
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
  if (c.cls === 'scientist' && g.ship.researching) {
    const r = g.rooms[roomAt(g, c)];
    if (r?.type === 'lab') g.researchTick(c, dt);
  }
}
