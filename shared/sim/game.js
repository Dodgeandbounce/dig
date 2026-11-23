// Do I Go? — the whole game simulation. Runs in the browser for solo play and
// can run on the server for multiplayer (inputs in, snapshots out).
import {
  T, TILE, TILE_HP, MAP_W, MAP_H, SLOT_W, SLOT_H, SHIP_COLS, SHIP_ROWS, SHIP_OX, SHIP_OY, ENEMY_OY,
  LEVELS, KM_PER_LEVEL, ROOMS, CLASSES, CLASS_ORDER, STARTER_CLASSES, BUYABLE_ROOMS, SHIP_UPGRADES,
  CLASS_UPGRADES, UPGRADE_BASE_COST, RECIPES, RESEARCH, NODE_TYPES, PORT_NAMES, PORT_FLAVOR, JOE_NOTES,
  TRANSPONDER_NOTE, JOURNAL_TEXT, BROTHER_NOTES, ENDINGS, AGENT_BRIEFS,
} from './data.js';
import { makeRng } from './rng.js';
import { Grid, idx, inMap, buildRooms, slotRect, stationPos, roomTiles, wallTilesOf } from './grid.js';
import { makeRoster, tierFor, levelMix } from './roster.js';
import {
  updateProjectiles, updatePickups, damage, hitTile, damageSystem, addMess, dropPickup, rainPickup, tickBuffs,
  addBuff, roomAt, tileOwner, healActor, explode,
} from './combat.js';
import { crewTick, interactTarget, say, spinSlots } from './classes.js';
import { botInput, mobTick, rebuildFields, updateObjects, pickMissileTarget } from './ai.js';
import { newDescent, descentTick, feeders, speedFactor } from './pilot.js';
import { clamp, dist, uid } from './util.js';

const START_LAYOUT = [
  { type: 'engine', sx: 3, sy: 2 },
  { type: 'weapons', sx: 4, sy: 2 },
  { type: 'hall', sx: 5, sy: 2 },
  { type: 'bridge', sx: 6, sy: 2 },
  { type: 'shield', sx: 5, sy: 3 },
];

export class Game {
  constructor({ seed, playerClass = 'pilot', playerName, shipName, speed = 1 } = {}) {
    this.seed = seed ?? ((Math.random() * 2 ** 31) | 0);
    this.rng = makeRng(this.seed);
    this.W = MAP_W;
    this.speed = speed;
    this.time = 0;
    this.grid = new Grid();
    this.orig = new Map();     // tile index -> what it was before it was destroyed
    this.rebuild = new Map();  // tile index -> repair progress
    this.iceUnder = new Map();
    this.fields = {};
    this.fieldCache = new Map();
    this.fxq = [];
    this.logs = [];
    this.crew = []; this.mobs = []; this.projs = []; this.pickups = []; this.objs = [];
    this.inputs = new Map();
    this.panels = [];
    this.stats = { kills: 0, gems: 0, repairs: 0, captures: 0, insults: 0, cleaned: 0, score: 0, meals: 0 };
    this.roster = makeRoster(this.rng);
    this.level = 1;
    this.path = null;
    this.transponderLevel = this.rng.int(4, 7);
    this.transponderCode = String(this.rng.int(1000, 9999));
    this.noteIdx = 0;
    this.brotherIdx = 0;
    this.joe = { state: 'missing' };
    this.storyMode = playerClass === 'urchid';
    this.ourTopY = SHIP_OY;

    this.ship = {
      name: (shipName || '').trim().slice(0, 32) || `The D-${this.rng.int(100, 999)}`,
      hull: 200, hullMax: 200, fuel: 100, fuelMax: 100, gems: 0, gemCap: 60, scrap: 40,
      food: { grub: 1, shroom: 1, fish: 0, spice: 0, crops: 0 },
      missiles: 3, missilesMax: 4,
      up: { plating: 0, bubble: 0, dgun: 0, dmissile: 0, drill: 0, feeders: 0, tank: 0 },
      bubble: 1, bubbleMax: 1, bubbleT: 0, dgunT: 0, missileT: 0, missileReady: false, missileTarget: null, evasiveT: 0,
      research: new Set(), researching: null, overclock: null,
      farm: { dirt: 0, plots: [0, 1, 2, 3].map(() => ({ stage: 0, t: 0 })) },
      rooms: {}, buildT: 0,
    };
    this.ourRooms = START_LAYOUT.map((r) => ({ ...r }));
    this.layoutShip();
    this.ship.hull = this.ship.hullMax;

    // crew: Zap the pilot and Angie the engie. (Urchid if the player wants story mode.)
    this.addCrew('pilot', playerClass === 'pilot' ? playerName : null);
    this.addCrew('engineer', playerClass === 'engineer' ? playerName : null);
    if (playerClass === 'urchid') this.addCrew('urchid', playerName);
    this.player = this.crew.find((c) => c.cls === playerClass) || this.crew[0];
    this.player.human = true;

    this.startBriefing();
  }

  // -------------------------------------------------------------------------
  // events for the client
  fx(e) { this.fxq.push(e); }
  log(kind, text) { this.logs.push({ at: this.time, kind, text }); if (this.logs.length > 60) this.logs.shift(); this.fx({ t: 'log', kind, text }); }
  drainFx() { const q = this.fxq; this.fxq = []; return q; }
  tip(key, text) {
    this.tips ||= new Set();
    if (this.tips.has(key) || !this.crew.some((c) => c.human)) return;
    this.tips.add(key);
    this.log('tip', `💡 ${text}`);
  }
  panel(c, type, room) { if (c.human) this.fx({ t: 'panel', crew: c.id, panel: type, room: room ? this.rooms.indexOf(room) : null }); }
  get tier() { return tierFor(this.level, this.path); }
  get depthKm() { return Math.round(((this.level - 1) + (this.phase === 'descent' ? Math.min(1, this.descent.progress) : (this.levelDone || this.phase === 'route') ? 1 : 0)) * KM_PER_LEVEL); }

  // -------------------------------------------------------------------------
  // crew
  addCrew(cls, name) {
    const def = CLASSES[cls];
    const home = this.rooms.find((r) => r.owner === 'us' && r.type === def.room) || this.rooms[0];
    const c = {
      id: uid(), cls, name: (name || '').trim().slice(0, 16) || def.def, team: 'crew', human: false,
      x: home.station.x + this.rng.range(-30, 30), y: home.station.y + 60, r: cls === 'slots' ? 13 : cls === 'dog' ? 10 : 11,
      hp: def.hp, maxHp: def.hp, alive: true, downT: 0, wallet: 25, upgrades: [0, 0, 0],
      cd: { fire: 0, q: 0, f: 0, rmb: 0, space: 0 }, buffs: [], facing: 0, aim: { x: 0, y: 0 },
      stunT: 0, slowT: 0, kills: 0, repairs: 0, monsters: [], summonIdx: 0, wiggle: [], bot: {},
      form: 'staff', jar: 'poison', mineType: 'proximity', missionRank: 0, carrying: 0,
      invuln: cls === 'urchid',
    };
    this.crew.push(c);
    return c;
  }

  ensureRoomFor(cls) {
    const type = CLASSES[cls].room;
    if (this.ourRooms.some((r) => r.type === type)) return true;
    const slot = this.freeSlotNear();
    if (!slot) return false;
    this.ourRooms.push({ type, sx: slot.sx, sy: slot.sy });
    this.layoutShip();
    return true;
  }

  freeSlots() {
    const taken = new Set(this.ourRooms.map((r) => `${r.sx},${r.sy}`));
    const out = [];
    for (const r of this.ourRooms) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const sx = r.sx + dx, sy = r.sy + dy;
      if (sx < 0 || sy < 0 || sx >= SHIP_COLS || sy >= SHIP_ROWS || taken.has(`${sx},${sy}`)) continue;
      taken.add(`${sx},${sy}`); out.push({ sx, sy });
    }
    return out;
  }
  freeSlotNear() {
    const free = this.freeSlots();
    if (!free.length) return null;
    // keep the ship compact: prefer slots with more neighbours, near the middle
    const taken = new Set(this.ourRooms.map((r) => `${r.sx},${r.sy}`));
    const score = (s) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => taken.has(`${s.sx + dx},${s.sy + dy}`)).length * 10 - Math.abs(s.sx - 5) - Math.abs(s.sy - 2.5) * 1.5 + this.rng() * 2;
    free.sort((a, b) => score(b) - score(a));
    return free[0];
  }

  // -------------------------------------------------------------------------
  // ship layout (rebuilt when rooms are added). Damage to existing tiles is kept.
  layoutShip() {
    const keepTiles = new Map();
    if (this.rooms) {
      for (let y = SHIP_OY; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
        const i = idx(x, y), t = this.grid.tiles[i];
        if (t === T.BREACH || t === T.RUBBLE || ((t === T.WALL || t === T.HULL) && this.grid.hp[i] < TILE_HP[t])) keepTiles.set(i, { t, hp: this.grid.hp[i] });
      }
    }
    const oldDoors = new Map((this.doors || []).filter((d) => d.owner === 'us').map((d) => [d.i, d]));
    const oldSys = new Map((this.rooms || []).filter((r) => r.owner === 'us').map((r) => [`${r.sx},${r.sy}`, r]));
    this.grid.clearRegion(0, SHIP_OY - 1, MAP_W - 1, MAP_H - 1);
    // keep only enemy-side doors (none at ports)
    this.doors = (this.doors || []).filter((d) => d.owner === 'them');
    const rooms = this.ourRooms.map((r) => {
      const rect = slotRect(r.sx, r.sy);
      const def = ROOMS[r.type];
      const old = oldSys.get(`${r.sx},${r.sy}`);
      const room = { type: r.type, name: def.name, owner: 'us', sx: r.sx, sy: r.sy, x0: rect.x0, y0: rect.y0, alive: true,
        sys: def.sys ? { type: def.sys, max: def.hp, hp: old && old.type === r.type ? old.sys.hp : def.hp } : null, reinforced: 0 };
      room.station = stationPos(room);
      return room;
    });
    // enemy rooms (if any) keep their indices after ours
    const theirs = (this.rooms || []).filter((r) => r.owner === 'them');
    buildRooms(this.grid, rooms, 0, this.doors, 'us');
    this.rooms = [...rooms, ...theirs];
    // re-index enemy rooms in the grid
    theirs.forEach((r, k) => { for (const i of roomTiles(r)) this.grid.room[i] = rooms.length + k; });
    for (const d of this.doors) { if (d.owner === 'them') { d.a += 0; } }
    this.doors.forEach((d, k) => { this.grid.doorAt[d.i] = k; const o = oldDoors.get(d.i); if (o && d.owner === 'us') { d.hp = o.hp; d.hold = o.hold; } });
    for (const [i, s] of keepTiles) {
      const now = this.grid.tiles[i];
      if (now === T.WALL || now === T.HULL) { this.grid.tiles[i] = s.t; this.grid.hp[i] = s.hp; if (s.t === T.RUBBLE && !this.orig.has(i)) this.orig.set(i, now); }
    }
    this.grid.version++;
    this.ourTopY = Math.min(...rooms.map((r) => r.y0));
    // vents for the chameleon
    this.objs = (this.objs || []).filter((o) => o.kind !== 'vent' || o.owner !== 'us');
    if (this.crew?.some((c) => c.cls === 'chameleon')) this.addVents(rooms, 'us');
    this.recalcShip();
  }

  addVents(rooms, owner) {
    for (const r of rooms) this.objs.push({ id: uid(), kind: 'vent', owner, x: (r.x0 + 1.5) * TILE, y: (r.y0 + 1.5) * TILE, broken: false });
  }

  recalcShip() {
    const s = this.ship;
    const counts = {};
    for (const r of this.ourRooms) counts[r.type] = (counts[r.type] || 0) + 1;
    s.rooms = counts;
    s.hullMax = 200 + 60 * s.up.plating + 12 * this.ourRooms.length;
    s.hull = Math.min(s.hull, s.hullMax);
    s.fuelMax = 100 + 40 * s.up.tank;
    s.bubbleMax = 1 + s.up.bubble;
    s.missilesMax = 4 + s.up.dmissile;
    const guard = this.crew?.find((c) => c.cls === 'guard');
    s.gemCap = Math.round((60 + 40 * (counts.storage || 0)) * (1 + 0.5 * (guard ? guard.upgrades[0] : 0)));
    const vault = this.rooms.find((r) => r.owner === 'us' && r.type === 'vault');
    if (vault && vault.sys.hp <= 0) s.gemCap = Math.round(s.gemCap * 0.5);
    s.farm.plots.length = Math.max(s.farm.plots.length, 4 + 2 * (this.crew?.find((c) => c.cls === 'farmer')?.upgrades[2] || 0));
    for (let k = 0; k < s.farm.plots.length; k++) s.farm.plots[k] ||= { stage: 0, t: 0 };
  }

  // -------------------------------------------------------------------------
  // spawning
  spawnMob(typeIdx, x, y, opts = {}) {
    const ty = this.roster[typeIdx];
    const tierScale = 1 + Math.max(0, this.tier - ty.tier) * 0.25;
    const hp = ty.hp * tierScale * (opts.hpMul || 1) * (this.storyMode && opts.team !== 'crew' ? 0.25 : 1) * (1 + 0.08 * Math.max(0, this.humanCount() - 1));
    const m = {
      id: uid(), type: typeIdx, team: opts.team || 'enemy', name: ty.name, x, y, r: 11 * ty.size, hp, maxHp: hp, alive: true,
      speed: ty.speed, dmgMul: ty.dmgMul * tierScale * (opts.dmgMul || 1), weapon: ty.weapon, role: ty.role, armor: ty.armor,
      atkT: this.rng.range(0.3, 1.2), facing: 0, defender: !!opts.defender, boss: !!ty.boss, isMonster: !!opts.isMonster, ownerId: opts.ownerId,
      marked: false,
    };
    if (m.team === 'enemy' && !m.boss && opts.markable !== false) {
      const agent = this.crew.find((c) => c.cls === 'agent');
      if (agent && this.markedLeft > 0 && this.rng.chance(0.35)) { m.marked = true; this.markedLeft--; m.hp *= 1 + 0.1 * (agent.missionRank || 0); m.maxHp = m.hp;
        this.fx({ t: 'watch', crew: agent.id, text: this.rng.pick(AGENT_BRIEFS), target: m.name }); }
    }
    this.mobs.push(m);
    return m;
  }
  humanCount() { return this.crew.filter((c) => c.human).length; }

  // -------------------------------------------------------------------------
  // inputs & commands
  setInput(crewId, inp) {
    const prev = this.inputs.get(crewId);
    // accumulate presses between ticks so nothing is lost
    if (prev && prev.pressed) for (const k in prev.pressed) if (prev.pressed[k]) (inp.pressed ||= {})[k] = true;
    this.inputs.set(crewId, inp);
  }

  command(c, cmd) {
    if (typeof c === 'number') c = this.crew.find((x) => x.id === c);
    if (!c) return;
    const s = this.ship;
    const fn = COMMANDS[cmd.t];
    if (fn) return fn(this, c, cmd, s);
  }

  // -------------------------------------------------------------------------
  // the main tick
  update(dt) {
    if (this.phase === 'gameover' || this.phase === 'ending') { this.time += dt; this.phaseT += dt; return; }
    if (this.paused || this.storyOpen) return;
    this.time += dt;
    this.phaseT += dt;

    if (this.time - (this.fieldsAt || -9) > (this.mobs.length ? 0.35 : 1)) rebuildFields(this);
    this.updateDoors(dt);

    // crew
    for (const c of this.crew) {
      tickBuffs(c, dt);
      if (!c.alive) {
        c.downT -= dt;
        if (c.downT <= 0) this.respawn(c);
        continue;
      }
      let inp = c.human ? (this.inputs.get(c.id) || {}) : botInput(this, c, dt);
      if (c.human && c.atHelm && this.phase === 'descent') {
        inp = { ...inp, mx: 0, my: 0, fire: false };
      }
      crewTick(this, c, inp, dt);
      if (c.human && inp.pressed) inp.pressed = {};
    }
    for (const m of this.mobs) mobTick(this, m, dt);
    this.mobs = this.mobs.filter((m) => m.alive || m.isJoe);
    updateProjectiles(this, dt);
    updateObjects(this, dt);
    updatePickups(this, dt);
    this.shipTick(dt);

    const P = PHASES[this.phase];
    if (P?.update) P.update(this, dt);

    if (this.ship.hull <= 0 && this.phase !== 'gameover') this.gameOver('The hull gave way. The dirt took the ship.');
  }

  respawn(c) {
    const q = this.rooms.filter((r) => r.owner === 'us' && (r.type === 'quarters' || r.type === CLASSES[c.cls].room));
    const r = q[0] || this.rooms[0];
    c.alive = true; c.hp = c.maxHp; c.x = (r.x0 + 4.5) * TILE + this.rng.range(-20, 20); c.y = (r.y0 + 4) * TILE;
    this.fx({ t: 'respawn', x: c.x, y: c.y });
  }

  updateDoors(dt) {
    for (const d of this.doors) {
      if (d.broken) continue;
      if (d.reinforced > 0) d.reinforced -= dt;
      let want = 0;
      const cx = (d.x + .5) * TILE, cy = (d.y + .5) * TILE;
      if (d.owner === 'them') {
        // their doors open for them; we have to smash through
        for (const m of this.mobs) if (m.alive && m.team === 'enemy' && Math.abs(m.x - cx) < 46 && Math.abs(m.y - cy) < 46) { want = 1; break; }
      } else if (!d.sealed && d.hold !== 'closed') {
        for (const c of this.crew) if (c.alive && Math.abs(c.x - cx) < 50 && Math.abs(c.y - cy) < 50) { want = 1; break; }
        if (!want) for (const m of this.mobs) if (m.alive && m.team === 'crew' && Math.abs(m.x - cx) < 46 && Math.abs(m.y - cy) < 46) { want = 1; break; }
      }
      const before = d.open;
      d.open = clamp(d.open + (want ? 1 : -1) * dt / 1.1, 0, 1); // they open and close slowly
      if ((before < 0.75) !== (d.open < 0.75)) this.grid.version += 0; // passability read live
    }
  }

  shipTick(dt) {
    const s = this.ship;
    if (s.evasiveT > 0) s.evasiveT -= dt;
    for (const r of this.rooms) if (r.reinforced > 0) r.reinforced -= dt;
    // breaches leak dirt and drain the hull
    this.leakT = (this.leakT || 0) - dt;
    if (this.leakT <= 0) {
      this.leakT = 1;
      let breaches = 0;
      for (let y = this.ourTopY; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
        if (this.grid.tiles[idx(x, y)] !== T.BREACH) continue;
        breaches++;
        if (this.rng.chance(0.18)) {
          // dirt pours in next to the hole
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.grid.get(x + dx, y + dy) === T.FLOOR) { addMess(this, (x + dx + .5) * TILE, (y + dy + .5) * TILE, 'dirt', 1); break; }
        }
      }
      const drain = breaches * 0.35 * (s.research.has('plating') ? 0.5 : 1) * (this.phase === 'port' ? 0 : 1);
      if (!this.storyMode) s.hull = Math.max(0, s.hull - drain);
      this.breaches = breaches;
      // clean ship buff
      const messes = this.objs.filter((o) => o.kind === 'mess' && o.y > this.ourTopY * TILE).reduce((a, o) => a + o.amt, 0);
      this.messCount = messes;
      this.cleanBuff = messes <= 2;
      this.recalcShip();
    }
    // bubble defense recharges while the generator is up
    const gen = this.rooms.find((r) => r.owner === 'us' && r.type === 'shield');
    if (gen && gen.sys.hp > 0 && s.bubble < s.bubbleMax) {
      s.bubbleT += dt * (s.research.has('harmonics') ? 2 : 1) * (s.overclock?.sys === 'shield' ? 1.5 : 1) * (gen.sys.hp / gen.sys.max);
      if (s.bubbleT >= 9) { s.bubbleT = 0; s.bubble++; }
    }
    // missiles being built
    if (s.buildT > 0) { s.buildT -= dt; if (s.buildT <= 0) { s.missiles = Math.min(s.missilesMax, s.missiles + 1); this.log('ship', 'A D-missile is ready in the rack.'); } }
    // farm grows
    const farm = this.rooms.find((r) => r.owner === 'us' && r.type === 'farm');
    if (farm && farm.sys.hp > 0) {
      const farmer = this.crew.find((c) => c.cls === 'farmer');
      for (const p of s.farm.plots) if (p.stage > 0 && p.stage < 3) { p.t += dt * (1 + 0.3 * (farmer?.upgrades[0] || 0)); if (p.t >= 20) { p.t = 0; p.stage++; } }
    }
  }

  researchTick(c, dt) {
    const s = this.ship, r = s.researching;
    if (!r) return;
    const lab = this.rooms.find((x) => x.owner === 'us' && x.type === 'lab');
    if (!lab || lab.sys.hp <= 0) return;
    r.progress += dt * (1 + 0.3 * c.upgrades[0]) * (c.special ? 1.4 : 1);
    if (r.progress >= r.time) {
      s.research.add(r.id); s.researching = null;
      const def = RESEARCH.find((x) => x.id === r.id);
      this.log('loot', `🔬 Research complete: ${def.name}. ${def.desc}`);
      say(this, c, 'EUREKA! Peer review can bite me.');
    }
  }

  serveMeal(chef, cooking) {
    const rec = RECIPES.find((r) => r.id === cooking.recipe);
    const lvl = chef.upgrades[0];
    const dur = rec.dur * (1 + 0.2 * lvl);
    const targets = this.crew.filter((c) => c.alive && c.cls !== 'urchid' && (cooking.target === 'all' || c.cls === cooking.target));
    for (const c of targets) {
      const b = { ...rec.buff, ...Object.fromEntries(Object.entries(rec.side).map(([k, v]) => [k, v])) };
      // side effects stack separately so they show up as their own line
      addBuff(c, rec.buff, dur * (cooking.target === 'all' ? 1 : 1.5), 'meal');
      if (Object.keys(rec.side).length) addBuff(c, rec.side, dur, 'mealside');
      if (rec.buff.special) c.special = true; else c.special = false;
      this.fx({ t: 'meal', x: c.x, y: c.y, crew: c.id, name: rec.name });
    }
    this.stats.meals++;
    this.log('ship', `🍲 ${chef.name} teleported ${rec.name} to ${cooking.target === 'all' ? 'the whole crew' : CLASSES[cooking.target]?.name}.`);
  }

  // -------------------------------------------------------------------------
  // phases
  setPhase(p) { this.phase = p; this.phaseT = 0; this.fx({ t: 'phase', phase: p }); }

  startBriefing() {
    this.levelDone = false;
    this.mix = levelMix(this.roster, this.level, this.path, this.rng);
    this.descent = newDescent();
    this.setPhase('briefing');
    this.log('story', `— Level ${this.level}: ${this.depthKm.toLocaleString()} km down —`);
    for (const c of this.crew) if (c.atHelm) c.atHelm = false;
    if (this.level === this.transponderLevel && !this.joe.transponder) {
      this.joe.transponder = true;
      this.story({ title: 'A message pod hits the hull', lines: [TRANSPONDER_NOTE + this.transponderCode], kind: 'note', after: null });
    }
  }

  story(s) {
    // modal story beat. Solo pauses the world while it's open.
    this.storyQ = this.storyQ || [];
    this.storyQ.push(s);
    if (!this.storyOpen) this.nextStory();
  }
  nextStory() {
    const s = this.storyQ.shift();
    this.storyOpen = s || null;
    if (s) this.fx({ t: 'story', story: s });
  }

  makeRoute() {
    const L = this.level;
    const nodes = [];
    const add = (type, extra = {}) => nodes.push({ type, ...NODE_TYPES[type], ...extra });
    if (L >= LEVELS) { add('ship', { boss: true, name: 'The Core', icon: '☀', desc: 'The light. And something guarding it.' }); return nodes; }
    if (this.path === 'brother' && L === LEVELS - 1 && this.joe.state === 'alive') { add('discovery', { rescue: true, name: "Joe's Pod", icon: '♥', desc: 'A weak signal. Joe\'s pod. Things are scratching at it.' }); return nodes; }
    const lastPort = this.lastPortLevel || 0;
    const needPort = L - lastPort >= 2;
    const pool = { ship: 4 + this.tier, port: needPort ? 6 : 2, fuel: this.ship.fuel < 45 ? 4 : 1.5, discovery: 2.5, nest: this.tier >= 1 ? 1.5 : 0.3, city: L >= 3 ? 1.2 : 0, repair: this.ship.hull < this.ship.hullMax * 0.5 ? 3 : 0.8 };
    const n = this.rng.chance(0.4) ? 3 : 2;
    const used = new Set();
    if (needPort) { add(this.rng.chance(0.3) && L >= 3 ? 'city' : 'port'); used.add('port'); used.add('city'); }
    while (nodes.length < n) {
      const t = this.rng.weighted(pool);
      if (used.has(t)) { pool[t] = 0; if (Object.values(pool).every((v) => !v)) break; continue; }
      used.add(t); add(t);
    }
    if (!nodes.some((x) => x.type === 'ship' || x.type === 'nest')) nodes[nodes.length - 1] = { type: 'ship', ...NODE_TYPES.ship };
    if (L === this.transponderLevel && this.joe.state === 'missing') nodes.push({ type: 'discovery', derelict: true, locked: true, ...NODE_TYPES.discovery, name: 'Transponder Signal', icon: '?', desc: 'Type the transponder ID into the targeting computer.' });
    return nodes;
  }

  arrive(node) {
    this.levelDone = true;
    this.fx({ t: 'arrive', node: node.type });
    if (node.boss) return this.startEncounter('boss');
    if (node.rescue) return this.startEncounter('pod');
    if (node.derelict) return this.startEncounter('derelict');
    switch (node.type) {
      case 'ship': return this.startEncounter('ship');
      case 'nest': return this.startEncounter('nest');
      case 'discovery': return this.startDiscovery();
      default: return this.startPort(node.type);
    }
  }

  afterFightRecruit() {
    if (!this.pendingRecruit) return;
    this.pendingRecruit = false;
    this.recruit(1, 'was a prisoner on their ship and joins up');
  }

  nextLevel() {
    this.cleanupEnemy();
    this.afterFightRecruit();
    this.level++;
    this.ship.overclock = this.ship.overclock?.auto ? null : this.ship.overclock;
    this.startBriefing();
  }

  // -------------------------------------------------------------------------
  // discoveries (Joe's notes)
  startDiscovery() {
    this.setPhase('discovery');
    const lines = [];
    let reward = null;
    if (this.path === 'brother' && this.brotherIdx < BROTHER_NOTES.length) {
      lines.push(BROTHER_NOTES[this.brotherIdx++]);
    } else if (this.noteIdx < JOE_NOTES.length) {
      const n = JOE_NOTES[this.noteIdx++];
      lines.push(n.text); reward = n;
    } else lines.push('An old drill site. Somebody carved "Z + J" into the rock. Gems everywhere.');
    for (let k = 0; k < 8 + this.tier * 3; k++) { const r = this.rng.pick(this.rooms.filter((x) => x.owner === 'us')); rainPickup(this, (r.x0 + 1.5 + this.rng() * 6) * TILE, (r.y0 + 1.5 + this.rng() * 4) * TILE, this.rng.chance(0.7) ? 'gem' : 'ore', 1); }
    if (reward) { this.applyReward(reward.reward); lines.push(`(${reward.rewardText})`); }
    this.story({ title: this.path === 'brother' ? "A page from Joe's journal" : 'A note from Joe', lines, kind: 'note',
      after: this.rng.chance(0.35 + this.tier * 0.1) ? 'ambush' : 'aftermath' });
  }

  applyReward(r) {
    const s = this.ship;
    if (r.scrap) s.scrap += r.scrap;
    if (r.money) for (const c of this.crew) c.wallet += r.money;
    if (r.upgrade) { s.up[r.upgrade] = Math.min(5, s.up[r.upgrade] + 1); this.recalcShip(); }
    if (r.room) { const slot = this.freeSlotNear(); if (slot) { this.ourRooms.push({ type: r.room, sx: slot.sx, sy: slot.sy }); this.layoutShip(); } }
  }

  // -------------------------------------------------------------------------
  // ports
  startPort(kind) {
    this.cleanupEnemy();
    this.lastPortLevel = this.level;
    this.setPhase('port');
    const name = this.rng.pick(PORT_NAMES);
    const full = kind === 'port' || kind === 'city';
    this.port = {
      kind, name: kind === 'fuel' ? `${name} Fuel Depot` : kind === 'repair' ? `${name} Repair Dock` : kind === 'city' ? `Deep City of ${name}` : name,
      flavor: this.rng.pick(PORT_FLAVOR),
      gemPrice: 3 + this.tier + (kind === 'city' ? 2 : 0),
      fuelPrice: kind === 'fuel' ? 0.5 : 1,
      shop: full, rooms: full, upgrades: full || kind === 'repair',
      recruits: [],
    };
    // story: Joe's note sometimes waits at ports too
    if (full && this.rng.chance(0.45) && this.noteIdx < JOE_NOTES.length && this.path !== 'brother') {
      const n = JOE_NOTES[this.noteIdx++]; this.applyReward(n.reward);
      this.story({ title: `A note pinned up at ${this.port.name}`, lines: [n.text, `(${n.rewardText})`], kind: 'note' });
    }
    if (kind === 'repair') { for (const r of this.rooms) if (r.owner === 'us' && r.sys) r.sys.hp = r.sys.max; this.repairAllTiles(); this.log('ship', 'The repair dock fixed every system and hole. Free of charge (they love foxes).'); }
    if (kind === 'fuel') { this.ship.hull = Math.min(this.ship.hullMax, this.ship.hull + 30); }
    if (kind === 'city') { for (const c of this.crew) addBuff(c, { regen: 1, speed: 0.1 }, 120, 'city'); this.log('ship', 'Real beds, real food, live music. The crew is well rested (+regen, +speed).'); }
    // new crew sign on
    if (full) this.recruit();
    this.botsShop();
    // a missile restock for free and some loot from the trip
    this.ship.missiles = Math.min(this.ship.missilesMax, this.ship.missiles + 1);
    this.log('story', `⚓ Docked at ${this.port.name}. ${this.port.flavor}`);
    this.tip('port', 'Ports: sell gems (everyone gets a share), buy ship upgrades and new rooms, or switch to another crew member under Crew & class. Tab = your class upgrades.');
  }

  recruit(max = 2, how = 'signs on') {
    const have = new Set(this.crew.map((c) => c.cls));
    const next = CLASS_ORDER.filter((k) => !have.has(k) && k !== 'urchid' && CLASSES[k].unlock <= Math.ceil(this.level / 1.2) && CLASSES[k].unlock > 0);
    const n = Math.min(max, next.length, 17 - this.crew.length);
    for (let k = 0; k < n; k++) {
      const cls = next[k];
      if (!this.ensureRoomFor(cls)) break;
      const c = this.addCrew(cls);
      this.port?.recruits.push(cls);
      this.log('loot', `🦊 ${c.name} the ${CLASSES[cls].name} ${how}! (${ROOMS[CLASSES[cls].room].name} installed)`);
      this.fx({ t: 'recruit', cls, name: c.name });
      if (cls === 'chameleon') this.layoutShip();
    }
  }

  /** Bot crew spend their own pocket books: fuel and hull if nobody else will, then their class upgrades. */
  botsShop() {
    const s = this.ship;
    const bots = this.crew.filter((c) => !c.human);
    const noHumans = !this.crew.some((c) => c.human);
    if (noHumans && s.gems > 0) COMMANDS.sell(this, bots[0], {});
    for (const c of bots) {
      if (noHumans || s.fuel < s.fuelMax * 0.35) { const need = s.fuelMax - s.fuel; const n = Math.min(need, Math.floor(c.wallet * 0.4 / this.port.fuelPrice)); c.wallet -= Math.ceil(n * this.port.fuelPrice); s.fuel += n; }
      if (noHumans && s.hull < s.hullMax * 0.8) { const n = Math.min(s.hullMax - s.hull, c.wallet * 0.5 * 2); c.wallet -= Math.ceil(n / 2); s.hull += n; }
      for (let guard = 0; guard < 6; guard++) {
        const k = [0, 1, 2].sort((a, b) => c.upgrades[a] - c.upgrades[b])[0];
        const cost = UPGRADE_BASE_COST * (c.upgrades[k] + 1);
        if (c.upgrades[k] >= 5 || c.wallet - cost < 20) break;
        c.wallet -= cost; c.upgrades[k]++;
      }
    }
    if (noHumans) for (const id of ['plating', 'dgun', 'bubble', 'dmissile']) {
      const lvl = s.up[id]; const cost = SHIP_UPGRADES[id].cost * (lvl + 1);
      const payer = bots.find((c) => c.wallet >= cost + 20);
      if (payer && lvl < 5) { payer.wallet -= cost; s.up[id]++; this.recalcShip(); }
    }
  }

  repairAllTiles() {
    for (const [i, t] of [...this.orig]) {
      if (this.grid.room[i] >= 0 && this.rooms[this.grid.room[i]]?.owner === 'them') continue;
      const y = (i / MAP_W) | 0; if (y < this.ourTopY) continue;
      if (t === T.DOOR) { const d = this.doors[this.grid.doorAt[i]]; if (d) { d.broken = false; d.hp = d.maxHp; } }
      this.grid.tiles[i] = t; this.grid.hp[i] = TILE_HP[t]; this.orig.delete(i);
    }
    for (let y = this.ourTopY; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) { const i = idx(x, y); const t = this.grid.tiles[i]; if (TILE_HP[t]) this.grid.hp[i] = TILE_HP[t]; }
    for (const d of this.doors) if (d.owner === 'us') d.hp = d.maxHp;
    this.grid.version++;
  }

  // -------------------------------------------------------------------------
  // encounters: enemy dig-ships dock, creatures burrow in, the core boss, Joe
  startEncounter(kind) {
    this.cleanupEnemy();
    this.setPhase('encounter');
    const tier = this.tier;
    const rng = this.rng;
    this.markedLeft = 1 + (this.crew.find((c) => c.cls === 'agent')?.upgrades[2] || 0) + (this.markedBonus || 0);
    // air currents for the jorbal: random per docking, all connected
    this.air = [0, 1, 2].map(() => ({ x: (SHIP_OX + rng.range(10, 70)) * TILE, y: (SHIP_OY + rng.range(4, 30)) * TILE, s: rng.range(0.6, 1.2), spin: rng.chance(0.5) ? 1 : -1, out: rng.range(-0.3, 0.3) }));
    this.air.drift = { x: rng.range(-20, 20), y: rng.range(-15, 15) };

    if (kind === 'nest') {
      this.enemyShip = null;
      this.nest = { waves: 3 + tier, waveT: 2, left: 3 + tier };
      this.log('alert', '♨ Creatures! They\'re burrowing into the hull!');
      this.sealDoors(true);
      return;
    }
    const layout = enemyLayout(kind, tier, rng, this.ship.name);
    if (this.path === 'brother' && kind === 'ship') layout.boarders = Math.round(layout.boarders * 1.3);
    // bigger crew, bigger fights: lots of enemies
    const crewN = this.crew.length;
    layout.boarders = Math.round(layout.boarders * (0.75 + 0.06 * crewN));
    layout.wave += Math.floor(crewN / 5);
    this.buildEnemyShip(layout, kind);
    this.sealDoors(kind !== 'derelict' && kind !== 'pod');
    if (kind === 'ship') {
      this.log('alert', `☠ ${this.enemyShip.name} is docking! All doors sealed. Defend the ship!`);
      this.tip('docking', 'Doors are sealed. Boarders will smash through. Pilot, Engineer, Guard, Scientist, Vaelift and Agent have clearance: press E at a sealed door to open it.');
      this.tip('duel', 'Both ships trade D-gun and D-missile fire (top of the screen). Bubbles stop guns, not missiles. Wreck their bridge and engine and they give up.');
    }
    if (kind === 'boss') { this.log('alert', '☀ THE CORE. Something enormous is docking with us.'); this.fx({ t: 'boss' }); }
    if (kind === 'derelict') this.log('story', 'Joe\'s ship. Dark. Cold. Docking...');
    if (kind === 'pod') this.log('story', 'Joe\'s pod! Get to him before they do!');
  }

  sealDoors(on) {
    for (const d of this.doors) if (d.owner === 'us' && !d.broken) { d.sealed = on; if (on) d.hold = null; }
    this.grid.version++;
    if (on) this.fx({ t: 'seal' });
  }

  buildEnemyShip(layout, kind) {
    const tier = this.tier;
    // dock at a room that's the top of its column
    const ours = this.rooms.filter((r) => r.owner === 'us');
    const exposed = ours.filter((r) => !ours.some((o) => o.sx === r.sx && o.sy < r.sy));
    const prefer = exposed.filter((r) => r.type !== 'bridge');
    const dock = this.rng.pick(prefer.length ? prefer : exposed);
    const dockX = dock.x0 + 4, dockY = dock.y0;
    const cols = Math.max(...layout.rooms.map((r) => r.c)) + 1;
    const rows = Math.max(...layout.rooms.map((r) => r.r)) + 1;
    const airCol = layout.airlock ?? Math.floor(cols / 2);
    let ex0 = dockX - 4 - airCol * SLOT_W;
    ex0 = clamp(ex0, 2, MAP_W - cols * SLOT_W - 3);
    const ey0 = Math.max(ENEMY_OY, this.ourTopY - 4 - rows * SLOT_H);
    const base = this.rooms.length;
    const rooms = layout.rooms.map((lr) => {
      const def = ROOMS[lr.type] || {};
      const room = { type: lr.type, name: lr.name || def.name || lr.type, owner: 'them', x0: ex0 + lr.c * SLOT_W, y0: ey0 + lr.r * SLOT_H, alive: true, reinforced: 0,
        sys: { type: lr.type, max: Math.round((lr.hp || def.hp || 80) * (1 + 0.35 * tier)), hp: 0 }, c: lr.c, r: lr.r };
      room.sys.hp = room.sys.max;
      room.station = stationPos(room);
      return room;
    });
    buildRooms(this.grid, rooms, base, this.doors, 'them');
    this.rooms.push(...rooms);
    // airlock + tunnel
    const bottom = rooms.filter((r) => r.r === rows - 1);
    const airRoom = bottom.find((r) => r.c === airCol) || bottom[0];
    const ax = airRoom.x0 + 4, ay = airRoom.y0 + SLOT_H;
    const tunnel = [];
    const carve = (x, y) => { if (!inMap(x, y)) return; const i = idx(x, y); if (this.grid.tiles[i] === T.VOID || this.grid.tiles[i] === T.HULL) { this.grid.tiles[i] = T.TUNNEL; this.grid.hp[i] = 0; tunnel.push(i); } };
    const midY = Math.round((ay + dockY) / 2);
    for (let y = ay + 1; y <= midY; y++) for (let k = -1; k <= 1; k++) carve(ax + k, y);
    for (let x = Math.min(ax, dockX) - 1; x <= Math.max(ax, dockX) + 1; x++) for (let k = -1; k <= 1; k++) carve(x, midY + k);
    for (let y = midY; y < dockY; y++) for (let k = -1; k <= 1; k++) carve(dockX + k, y);
    // tunnel walls
    for (const i of [...tunnel]) {
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = idx(x + dx, y + dy); if (this.grid.tiles[j] === T.VOID) { this.grid.tiles[j] = T.HULL; this.grid.hp[j] = 999; tunnel.push(-j - 1); } }
    }
    // blow the holes: their airlock and our hull
    const ai = idx(ax, ay); this.grid.tiles[ai] = T.TUNNEL; this.grid.hp[ai] = 0;
    const di = idx(dockX, dockY); this.grid.tiles[di] = T.TUNNEL; this.grid.hp[di] = 0;
    this.grid.version++;
    this.fx({ t: 'boom', x: (dockX + .5) * TILE, y: (dockY + .5) * TILE, r: 50 });

    const es = this.enemyShip = {
      kind, name: layout.name, rooms: rooms.map((r) => this.rooms.indexOf(r)), tunnel, dock: { x: dockX, y: dockY, room: this.rooms.indexOf(dock) },
      airlock: { x: ax, y: ay },
      hull: layout.hull, hullMax: layout.hull, bubble: layout.bubble, bubbleMax: layout.bubble, bubbleT: 0,
      gunT: this.rng.range(0, 2), gunPeriod: layout.gunPeriod, gunDmg: layout.gunDmg, missileT: 0, missilePeriod: layout.missilePeriod, missileDmg: layout.missileDmg,
      crewLeft: layout.boarders, spawnT: 3, wave: layout.wave, done: false, stolen: 0, surrendered: false, inbound: [],
    };
    // defenders, decorations, crates
    for (const r of rooms) {
      if (kind === 'ship' || kind === 'boss') {
        const n = r.type === 'bridge' ? 1 : r.type === 'weapons' ? (tier >= 2 ? 2 : 1) : r.type === 'shield' && tier >= 3 ? 1 : 0;
        for (let k = 0; k < n; k++) this.spawnMob(this.pickType(), (r.x0 + 3 + k * 2) * TILE, (r.y0 + 3.5) * TILE, { defender: true });
      }
      if (kind === 'derelict') {
        for (let k = 0; k < 2; k++) this.objs.push({ id: uid(), kind: 'skeleton', x: (r.x0 + 2 + this.rng() * 5) * TILE, y: (r.y0 + 2 + this.rng() * 3) * TILE, a: this.rng() * 6 });
        this.objs.push({ id: uid(), kind: 'crate', x: (r.x0 + 6.5) * TILE, y: (r.y0 + 4.5) * TILE, owner: 'them' });
        if (r.type === 'bridge') this.objs.push({ id: uid(), kind: 'journal', x: (r.x0 + 4.5) * TILE, y: (r.y0 + 3) * TILE, owner: 'them' });
      }
      if (kind === 'pod') {
        const joe = this.spawnMob(this.roster.findIndex((x) => x.creature), (r.x0 + 4.5) * TILE, (r.y0 + 3.5) * TILE, { team: 'crew', markable: false });
        Object.assign(joe, { isJoe: true, name: 'Joe', hp: 320, maxHp: 320, speed: 150, r: 11, following: false, atkT: 0, armor: 0.3 });
        this.joe.mob = joe;
        this.nest = { waves: 4 + tier, waveT: 4, left: 4 + tier, pod: r };
      }
      if (kind === 'boss' && r.type === 'core') {
        const bi = this.roster.findIndex((x) => x.boss);
        const boss = this.spawnMob(bi, (r.x0 + 4.5) * TILE, (r.y0 + 3.5) * TILE, { defender: true });
        boss.r = 34; boss.hp = boss.maxHp = this.roster[bi].hp * (this.path === 'brother' ? 1.3 : 1) * (1 + 0.15 * Math.max(0, this.humanCount() - 1));
        this.boss = boss;
      }
    }
    if (this.crew.some((c) => c.cls === 'chameleon')) this.addVents(rooms, 'them');
  }

  pickType() {
    const r = this.rng() * 100; let acc = 0;
    for (const m of this.mix) { acc += m.pct; if (r <= acc) return m.type; }
    return this.mix[0].type;
  }

  cleanupEnemy() {
    if (this.enemyShip) {
      const es = this.enemyShip;
      // everyone still on their ship comes home
      const dock = this.rooms[es.dock.room];
      for (const c of this.crew) if (tileOwner(this, Math.floor(c.x / TILE), Math.floor(c.y / TILE)) === 'them') { c.x = (dock.x0 + 4.5) * TILE; c.y = (dock.y0 + 3.5) * TILE; c.riding = null; }
      for (const m of this.mobs) if (m.team === 'crew' && tileOwner(this, Math.floor(m.x / TILE), Math.floor(m.y / TILE)) === 'them') { m.x = (dock.x0 + 4.5) * TILE; m.y = (dock.y0 + 3.5) * TILE; }
      this.mobs = this.mobs.filter((m) => m.team === 'crew' || (m.alive && tileOwner(this, Math.floor(m.x / TILE), Math.floor(m.y / TILE)) === 'us'));
      this.grid.clearRegion(0, 0, MAP_W - 1, this.ourTopY - 1);
      for (const i of es.tunnel) { const j = i >= 0 ? i : -i - 1; const y = (j / MAP_W) | 0; if (y >= this.ourTopY && (this.grid.tiles[j] === T.TUNNEL || this.grid.tiles[j] === T.HULL) && this.grid.room[j] < 0) { this.grid.tiles[j] = T.VOID; this.grid.hp[j] = 0; } }
      // the hole they blew stays a breach until someone patches it
      const di = idx(es.dock.x, es.dock.y);
      this.grid.tiles[di] = T.BREACH; this.grid.hp[di] = 0; this.orig.set(di, T.HULL);
      const n = this.rooms.filter((r) => r.owner === 'us').length;
      this.rooms.length = n;
      this.doors = this.doors.filter((d) => d.owner === 'us');
      this.doors.forEach((d, k) => { this.grid.doorAt[d.i] = k; });
      this.objs = this.objs.filter((o) => o.owner !== 'them' && !(o.y < this.ourTopY * TILE));
      this.pickups = this.pickups.filter((p) => p.y >= this.ourTopY * TILE);
      for (const [i] of [...this.orig]) if (((i / MAP_W) | 0) < this.ourTopY) this.orig.delete(i);
      this.grid.version++;
      this.enemyShip = null;
    }
    this.boss = null;
    this.nest = null;
    this.air = null;
    this.ship.missileTarget = null;
    this.sealDoors(false);
  }

  onSystemDestroyed(room) {
    const es = this.enemyShip;
    if (room.owner === 'them' && es && !es.done) {
      const alive = (t) => this.rooms.some((r) => r.owner === 'them' && r.type === t && r.sys.hp > 0);
      const hasEngine = this.rooms.some((r) => r.owner === 'them' && r.type === 'engine');
      if (!alive('bridge') && (!hasEngine || !alive('engine')) && !alive('weapons') && es.kind === 'ship') this.surrender('Their bridge, guns and engine are wrecked. They surrender!');
      else if (!alive('bridge') && hasEngine && !alive('engine') && es.kind === 'ship') this.surrender('Their bridge and engine are wrecked. They surrender!');
    }
    if (room.owner === 'us' && room.type === 'vault') this.recalcShip();
  }

  surrender(msg) {
    const es = this.enemyShip; if (!es || es.done) return;
    es.done = true; es.surrendered = true;
    this.log('loot', `🏳 ${msg}`);
    for (const m of this.mobs) if (m.team === 'enemy' && tileOwner(this, Math.floor(m.x / TILE), Math.floor(m.y / TILE)) === 'them') m.alive = false;
    for (const r of this.rooms) if (r.owner === 'them') for (let k = 0; k < 1 + (this.rng.chance(0.5) ? 1 : 0); k++) this.objs.push({ id: uid(), kind: 'crate', x: (r.x0 + 2 + this.rng() * 5) * TILE, y: (r.y0 + 2 + this.rng() * 3) * TILE, owner: 'them' });
    if (es.stolen) this.objs.push({ id: uid(), kind: 'crate', x: this.rooms[es.rooms[0]].station.x, y: this.rooms[es.rooms[0]].station.y + 40, owner: 'them', gems: es.stolen });
  }

  destroyEnemyShip() {
    const es = this.enemyShip; if (!es || es.done) return;
    es.done = true; es.destroyed = true;
    this.log('loot', `💥 ${es.name} is breaking apart! Everybody back aboard!`);
    this.fx({ t: 'shipdie' });
    for (const id of es.rooms) { const r = this.rooms[id]; this.fx({ t: 'boom', x: r.station.x, y: r.station.y + 40, r: 90 }); }
    // keep the wreck long enough for the explosion, then detach
    es.detachT = 1.2;
  }

  readJournal(c, obj) {
    if (obj.read) return;
    obj.read = true;
    this.story({ title: "Joe's journal", lines: JOURNAL_TEXT, kind: 'journal', after: 'changed' });
  }
  lootCrate(c, obj) {
    const i = this.objs.indexOf(obj); if (i < 0) return;
    this.objs.splice(i, 1);
    const scrap = 10 + this.tier * 8, money = 10 + this.tier * 10;
    this.ship.scrap += scrap; c.wallet += money;
    if (obj.gems) { this.ship.gems = Math.min(this.ship.gemCap, this.ship.gems + obj.gems); this.log('loot', `Got the stolen ${obj.gems} gems back!`); }
    this.fx({ t: 'text', x: obj.x, y: obj.y - 20, text: `+${scrap} scrap +${money}$`, color: '#f4c542' });
  }
  joeDied() {
    if (this.joe.state === 'dead') return;
    this.joe.state = 'dead';
    this.log('story', 'Joe is gone.');
    this.story({ title: 'Too late', lines: ['The pod door gives. By the time you get there, it\'s quiet.', 'You take his wrench. It\'s a good wrench.'], kind: 'note' });
  }
  bossDied() {
    this.log('loot', '☀ THE CORE LEVIATHAN FALLS!');
    this.fx({ t: 'bossdie' });
    this.stats.score += 5000;
    if (this.enemyShip) this.destroyEnemyShip();
    this.won = true;
    this.wonAt = this.time;
  }

  gameOver(msg) {
    this.setPhase('gameover');
    this.endMsg = msg;
    this.log('alert', msg);
    this.fx({ t: 'gameover' });
  }

  finalScore() {
    const s = this.stats;
    return Math.round(s.score + this.depthKm * 5 + s.gems * 10 + this.ship.gems * 5 + this.crew.reduce((a, c) => a + c.wallet, 0) + (this.joe.state === 'saved' ? 10000 : 0));
  }
}

// ---------------------------------------------------------------------------
// enemy ship layouts
function enemyLayout(kind, tier, rng, ourName) {
  const prefix = ['The', 'Old', 'Big', 'Mean', 'Rusty', 'Black'][rng.int(0, 5)];
  const noun = ['Gnasher', 'Burrower', 'Mole King', 'Grinder', 'Tunnel Rat', 'Dirt Shark', 'Rockjaw', 'Gravedigger', 'Wormhole', 'Excavator'][rng.int(0, 9)];
  if (kind === 'pod') return { name: "Joe's Pod", rooms: [{ type: 'pod', name: "Joe's Pod", c: 0, r: 0, hp: 200 }], hull: 9999, bubble: 0, gunPeriod: 999, gunDmg: 0, missilePeriod: 999, missileDmg: 0, boarders: 0, wave: 0 };
  if (kind === 'derelict') return { name: "Joe's Ship (derelict)", rooms: [{ type: 'quarters', c: 0, r: 0 }, { type: 'bridge', c: 1, r: 0 }, { type: 'engine', c: 2, r: 0 }], airlock: 1, hull: 9999, bubble: 0, gunPeriod: 999, gunDmg: 0, missilePeriod: 999, missileDmg: 0, boarders: 0, wave: 0 };
  if (kind === 'boss') {
    return { name: 'The Leviathan\'s Hive', airlock: 1,
      rooms: [{ type: 'weapons', c: 0, r: 0 }, { type: 'quarters', c: 1, r: 0 }, { type: 'quarters', c: 2, r: 0 }, { type: 'shield', c: 3, r: 0 },
        { type: 'engine', c: 0, r: 1 }, { type: 'core', name: "Leviathan's Lair", c: 1, r: 1, hp: 500 }, { type: 'bridge', c: 2, r: 1 }, { type: 'quarters', c: 3, r: 1 }],
      hull: 1600, bubble: 3, gunPeriod: 4.5, gunDmg: 26, missilePeriod: 9, missileDmg: 40, boarders: 40, wave: 4 };
  }
  const cols = Math.min(5, 3 + Math.floor(tier / 1.5) + (rng.chance(0.4) ? 1 : 0));
  const rows = tier >= 2 ? 2 : 1;
  const must = ['bridge', 'weapons', 'quarters', 'engine', 'shield'];
  const total = cols * rows;
  const types = [...must.slice(0, Math.min(total, tier >= 1 ? 5 : 4))];
  while (types.length < total) types.push(rng.chance(0.5) ? 'quarters' : 'corridor');
  rng.shuffle(types);
  const rooms = types.map((t, k) => ({ type: t, c: k % cols, r: Math.floor(k / cols) }));
  return {
    name: `${prefix} ${noun}`, rooms,
    hull: 70 + tier * 50 + total * 10,
    bubble: tier >= 1 ? 1 + Math.floor(tier / 2) : 0,
    gunPeriod: 8 - 0.5 * tier, gunDmg: 4 + 3 * tier,
    missilePeriod: 16 - tier, missileDmg: 10 + 5 * tier,
    boarders: 5 + tier * 3 + total * 2, wave: 2 + Math.floor(tier / 2),
  };
}

// ---------------------------------------------------------------------------
// phase logic
const PHASES = {
  briefing: {
    update(g) {
      if (g.storyOpen) return;
      if (g.phaseT > 5) {
        g.setPhase('descent'); g.fx({ t: 'dig' });
        const me = g.crew.find((c) => c.human);
        if (me?.cls === 'pilot') g.tip('helm', 'You fly this thing: walk up to the helm on the Bridge and press E to steer the descent.');
        else if (me?.cls === 'engineer') g.tip('wrench', 'Damaged engines and systems? Hit them with your wrench (left click). Hold E to patch holes and doors.');
        else if (me?.cls === 'urchid') g.tip('urchid', "Sit back. Q insults whoever is closest. F peeks through a crewmate's eyes.");
        g.tip('feeders', 'Gems, ore and food rain into the Feeder Hall while we drill. Walk over them to grab them.');
      }
    },
  },
  descent: {
    update(g, dt) {
      if (g.storyOpen) return;
      const pilot = g.crew.find((c) => c.cls === 'pilot');
      const human = pilot && pilot.human && pilot.atHelm && pilot.alive ? g.inputs.get(pilot.id) || {} : null;
      descentTick(g, dt, human);
      // ambushes: ships find you mid-descent
      const d = g.descent;
      if (d.stranded) {
        d.strandT = (d.strandT || 0) + dt;
        if (!g.crew.some((c) => c.human && c.alive) || (d.strandT > 20 && !pilot?.human)) COMMANDS.callFuel(g, pilot || g.crew[0], {});
        return;
      }
      if (d.progress > 0.25 && d.progress < 0.85 && !d.ambushed && g.level > 1 && g.rng.chance(dt * (0.006 + 0.003 * g.tier))) {
        d.ambushed = true;
        g.resume = d;
        g.log('alert', '☠ Ambush! A ship cut across our tunnel!');
        g.startEncounter('ship');
        return;
      }
      if (d.progress >= 1) {
        g.route = { nodes: g.makeRoute(), t: 0 };
        g.setPhase('route');
      }
    },
  },
  route: {
    update(g, dt) {
      if (g.storyOpen) return;
      g.route.t += dt;
      const pilot = g.crew.find((c) => c.cls === 'pilot');
      const humanPilot = pilot?.human;
      const locked = g.route.nodes.find((n) => n.locked);
      if (locked && !humanPilot && g.route.t > 1.5) { locked.locked = false; g.log('story', `${pilot?.name || 'The pilot'} types ${g.transponderCode} into the targeting computer. A blip appears ahead.`); }
      const anyHuman = g.crew.some((c) => c.human);
      if ((!humanPilot && g.route.t > 8) || g.route.t > 45 || (!anyHuman && g.route.t > 2.5)) {
        // bots: prefer the transponder signal, then a port if hurt, else whatever's first
        const open = g.route.nodes.filter((n) => !n.locked);
        let pick = open.find((n) => n.derelict) || (g.ship.hull < g.ship.hullMax * 0.4 && open.find((n) => n.type === 'repair' || n.type === 'port')) || (g.ship.fuel < 30 && open.find((n) => n.type === 'fuel')) || open[g.rng.int(0, open.length - 1)];
        g.arrive(pick);
      }
    },
  },
  discovery: {
    update(g) {
      if (g.storyOpen) return;
      // story closed -> after
      if (g.discoveryAfter === 'ambush') { g.discoveryAfter = null; g.startEncounter('nest'); g.nest.waves = 1 + Math.floor(g.tier / 2); g.nest.left = g.nest.waves; }
      else if (g.phaseT > 0.5) g.startAftermath(true);
    },
  },
  encounter: { update: encounterTick },
  aftermath: {
    update(g) {
      if (g.storyOpen) return;
      if (!g.crew.some((c) => c.human) && g.phaseT > 3) COMMANDS.continue(g, g.crew[0], {});
    },
  },
  port: {
    update(g) { if (!g.crew.some((c) => c.human) && g.phaseT > 3) COMMANDS.depart(g, g.crew[0], {}); },
  },
};

function encounterTick(g, dt) {
  if (g.storyOpen) return;
  if (g.won) { if (g.time - g.wonAt > 3) g.endGame(); return; }
  const s = g.ship, es = g.enemyShip;
  // backstop: nothing should drag on forever (the core boss excepted)
  if (g.phaseT > 240 && es?.kind !== 'boss' && es?.kind !== 'derelict') {
    for (const m of g.mobs) if (m.team === 'enemy' && m.alive) { m.alive = false; g.fx({ t: 'poof', x: m.x, y: m.y }); }
    if (g.joe.mob?.alive && g.joe.state !== 'saved') { g.joe.state = 'saved'; g.log('loot', '♥ Joe makes a run for it and dives through our airlock!'); }
    if (es && !es.done) { es.done = true; es.fled = true; g.log('ship', `${es.name} breaks off and digs away.`); }
    if (g.nest) g.nest.left = 0;
    return g.endEncounter(true);
  }
  // creature waves (nests, Joe's pod)
  if (g.nest) {
    const n = g.nest;
    n.waveT -= dt;
    if (n.waveT <= 0 && n.left > 0) {
      n.left--; n.waveT = 9 - g.tier;
      const creatures = g.roster.filter((x) => x.creature && x.tier <= g.tier + 1);
      const count = 2 + g.tier + (g.path === 'brother' ? 1 : 0) + Math.floor(g.crew.length / 5);
      if (n.pod) {
        for (let k = 0; k < count; k++) g.spawnMob(g.rng.pick(creatures).idx, (n.pod.x0 + 1.5 + g.rng() * 6) * TILE, (n.pod.y0 + 1.5) * TILE, { markable: false });
      } else {
        const rooms = g.rooms.filter((r) => r.owner === 'us');
        const r = g.rng.pick(rooms);
        const walls = wallTilesOf(r).filter((w) => g.grid.tiles[w.i] === T.HULL);
        if (walls.length) { const w = g.rng.pick(walls); hitTile(g, w.x, w.y, 9999, { hull: true }); }
        for (let k = 0; k < count; k++) g.spawnMob(g.rng.pick(creatures).idx, (r.x0 + 2 + g.rng() * 5) * TILE, (r.y0 + 2 + g.rng() * 3) * TILE, {});
        g.log('alert', `Creatures burst into the ${r.name}!`);
      }
    }
    // Joe
    if (g.joe.mob) {
      const joe = g.joe.mob;
      if (joe.alive && !joe.following && g.crew.some((c) => c.alive && dist(c, joe) < 50)) { joe.following = true; g.fx({ t: 'say', id: joe.id, text: 'ZAP?! You CAME! Get me out of here!' }); g.log('story', 'Joe: "ZAP?! You came!"'); }
      if (joe.alive && joe.following && tileOwner(g, Math.floor(joe.x / TILE), Math.floor(joe.y / TILE)) === 'us' && g.joe.state !== 'saved') {
        g.joe.state = 'saved';
        g.log('loot', '♥ Joe is aboard! He hugs you. He immediately starts fixing the doors.');
        g.fx({ t: 'joe' });
      }
    }
    const left = g.mobs.some((m) => m.alive && m.team === 'enemy');
    const joeDone = !g.joe.mob || g.joe.state === 'saved' || g.joe.state === 'dead';
    if (n.left <= 0 && joeDone) {
      n.doneT = (n.doneT || 0) + dt;
      if (left && n.doneT > 45) { for (const m of g.mobs) if (m.team === 'enemy') m.alive = false; g.log('ship', 'The last creatures burrow back into the dirt.'); }
    }
    if (n.left <= 0 && !left && joeDone) return g.endEncounter(true);
    if (!es) return;
  }
  if (!es) return;
  if (es.detachT !== undefined) {
    es.detachT -= dt;
    if (es.detachT <= 0) {
      // ship gone: anything on it dies, our people come home
      for (const m of g.mobs) if (m.team === 'enemy' && tileOwner(g, Math.floor(m.x / TILE), Math.floor(m.y / TILE)) === 'them') m.alive = false;
      g.cleanupEnemy();
      g.enemyShip = { ...es, gone: true, done: true };
    }
  }
  if (es.gone) {
    es.goneT = (es.goneT || 0) + dt;
    if (es.goneT > 60) for (const m of g.mobs) if (m.team === 'enemy' && m.alive) { m.alive = false; g.fx({ t: 'poof', x: m.x, y: m.y }); }
    if (!g.mobs.some((m) => m.alive && m.team === 'enemy') && (!g.boss || !g.boss.alive)) return g.endEncounter(true);
    return;
  }
  if (es.kind === 'derelict') {
    const journal = g.objs.find((o) => o.kind === 'journal');
    if (journal && !journal.read) {
      if (g.phaseT > 4 && !g.journalHint) { g.journalHint = true; g.log('story', "Joe's journal is on their bridge. Go read it (E)."); }
      if (!g.crew.some((c) => c.human) && g.phaseT > 8) g.readJournal(g.crew[0], journal);
    }
    if (g.derelictStage === 'changed' && !g.mobs.some((m) => m.alive && m.team === 'enemy')) { g.derelictStage = 'choice'; g.choosePath(); }
    return;
  }
  if (es.kind === 'pod') return;

  const ours = (t) => g.rooms.find((r) => r.owner === 'us' && r.type === t);
  const theirs = (t) => g.rooms.find((r) => r.owner === 'them' && r.type === t && r.sys.hp > 0);
  const eff = (r) => (r ? Math.max(0.3, r.sys.hp / r.sys.max) : 0);

  if (!es.done) {
    // ---- our D-weapons
    const wr = ours('weapons');
    if (wr && wr.sys.hp > 0) {
      const oc = s.overclock?.sys === 'weapons' ? 1.3 : 1;
      s.dgunT += dt * eff(wr) * oc;
      const gp = 5 / (1 + 0.15 * s.up.dgun);
      if (s.dgunT >= gp) {
        s.dgunT = 0;
        const dmg = 18 + 5 * s.up.dgun;
        if (es.bubble > 0) { es.bubble--; es.bubbleT = 0; g.fx({ t: 'dfire', who: 'us', w: 'gun', blocked: true }); }
        else { es.hull -= dmg; g.fx({ t: 'dfire', who: 'us', w: 'gun', dmg }); const r = g.rng.pick(g.rooms.filter((x) => x.owner === 'them')); damageSystem(g, r, dmg * 0.4); }
      }
      const tech = g.crew.find((c) => c.cls === 'missiletech' && c.alive);
      const techHere = tech && g.rooms[roomAt(g, tech)] === wr;
      if (s.missiles > 0 && !s.missileReady) {
        s.missileT += dt * eff(wr) * oc * (techHere ? 1.6 : 1);
        if (s.missileT >= 9 / (1 + 0.1 * s.up.dmissile)) { s.missileReady = true; s.missileT = 0; if (tech?.human) g.fx({ t: 'text', x: wr.station.x, y: wr.station.y - 20, text: 'D-MISSILE READY', color: '#ff6a3a' }); }
      }
      if (s.missileReady && (!tech || !tech.human || g.phaseT - (s.readyAt || 0) > 12)) {
        if (s.missileTarget == null || !g.rooms[s.missileTarget]?.sys?.hp) s.missileTarget = pickMissileTarget(g);
        fireMissile(g);
      }
      if (s.missileReady && !s.readyAt) s.readyAt = g.phaseT;
    }
    // missiles in flight
    for (const m of es.inbound) m.t -= dt;
    for (const m of es.inbound.filter((x) => x.t <= 0)) missileImpact(g, m);
    es.inbound = es.inbound.filter((x) => x.t > 0);

    // ---- their bubble
    if (theirs('shield') && es.bubble < es.bubbleMax) { es.bubbleT += dt; if (es.bubbleT > 11) { es.bubbleT = 0; es.bubble++; } }
    // ---- their D-weapons
    if (theirs('weapons')) {
      es.gunT += dt;
      if (es.gunT >= es.gunPeriod) {
        es.gunT = 0;
        if (s.evasiveT > 0) g.fx({ t: 'dfire', who: 'them', w: 'gun', miss: true });
        else if (s.bubble > 0) { s.bubble--; s.bubbleT = 0; g.fx({ t: 'dfire', who: 'them', w: 'gun', blocked: true }); }
        else { if (!g.storyMode) s.hull -= es.gunDmg; g.fx({ t: 'dfire', who: 'them', w: 'gun', dmg: es.gunDmg }); }
      }
      es.missileT += dt;
      if (es.missileT >= es.missilePeriod) {
        es.missileT = 0;
        if (s.evasiveT > 0) { g.fx({ t: 'dfire', who: 'them', w: 'missile', miss: true }); g.log('ship', 'Evasive! Their D-missile sails past.'); }
        else enemyMissile(g, es);
      }
    }
    // ---- boarders
    if (es.crewLeft > 0) {
      es.spawnT -= dt;
      if (es.spawnT <= 0) {
        es.spawnT = Math.max(4, 8.5 - g.tier * 0.7);
        const q = g.rooms.filter((r) => r.owner === 'them' && (r.type === 'quarters' || r.type === 'core') && r.sys.hp > 0);
        const from = q.length ? g.rng.pick(q) : g.rooms[es.rooms[0]];
        const n = Math.min(es.crewLeft, es.wave);
        for (let k = 0; k < n; k++) g.spawnMob(g.pickType(), (from.x0 + 2 + g.rng() * 5) * TILE, (from.y0 + 2 + g.rng() * 3) * TILE, {});
        es.crewLeft -= n;
        if (q.length === 0) es.crewLeft = Math.max(0, es.crewLeft - 2); // no quarters = fewer reinforcements
      }
    }
    if (es.hull <= 0) { if (es.kind === 'boss') { es.hull = 0; } else g.destroyEnemyShip(); }
    // everybody on their side dead and no more coming? they give up
    if (!es.done && es.kind === 'ship' && es.crewLeft <= 0 && !g.mobs.some((m) => m.alive && m.team === 'enemy')) g.surrender('Their crew is finished. The ship is ours to strip.');
    // out of boarders and nobody's coming over to finish them? they cut the tunnel and run
    const onOurs = g.mobs.some((m) => m.alive && m.team === 'enemy' && tileOwner(g, Math.floor(m.x / TILE), Math.floor(m.y / TILE)) === 'us');
    if (!es.done && es.kind === 'ship' && g.phaseT > 150) { es.fleeT = Math.max(es.fleeT || 0, 7); if (!es.fleeWarned) { es.fleeWarned = true; g.log('alert', `${es.name} has had enough. It's spinning up to flee!`); } }
    if (!es.done && es.kind === 'ship' && ((es.crewLeft <= 0 && !onOurs) || g.phaseT > 150)) {
      es.fleeT = (es.fleeT || 0) + dt;
      if (es.fleeT > 6 && !es.fleeWarned) { es.fleeWarned = true; g.log('alert', `${es.name} is spinning up its drill to flee! Finish it in 20s or board it!`); }
      if (es.fleeT > 26) {
        es.done = true; es.fled = true; es.detachT = 0.6;
        g.log('ship', `${es.name} cut the tunnel and fled into the dirt.`);
      }
    } else if (es.fleeT) es.fleeT = Math.max(0, es.fleeT - dt);
  }
  if (es.done && !es.unsealed) { es.unsealed = true; g.sealDoors(false); }
  if (es.done && es.kind !== 'boss' && !g.mobs.some((m) => m.alive && m.team === 'enemy' && tileOwner(g, Math.floor(m.x / TILE), Math.floor(m.y / TILE)) === 'us')) {
    if (!es.victoryAt) { es.victoryAt = g.time; g.endEncounter(true); }
  }
}

function fireMissile(g) {
  const s = g.ship, es = g.enemyShip;
  if (!s.missileReady || s.missiles <= 0 || !es || es.done) return;
  const target = s.missileTarget ?? pickMissileTarget(g);
  if (target == null) return;
  s.missiles--; s.missileReady = false; s.missileT = 0; s.readyAt = 0;
  es.inbound.push({ t: 0.9, room: target });
  g.fx({ t: 'dfire', who: 'us', w: 'missile', room: target });
}

function missileImpact(g, m) {
  const s = g.ship, es = g.enemyShip; if (!es || es.done) return;
  const r = g.rooms[m.room]; if (!r) return;
  const tech = g.crew.find((c) => c.cls === 'missiletech');
  let dmg = (30 + 8 * s.up.dmissile) * (s.research.has('schematic') ? 1.5 : 1) * (s.research.has('guidance') ? 1.25 : 1) * (1 + 0.25 * (tech?.upgrades[0] || 0)) * (tech?.special ? 1.4 : 1);
  damageSystem(g, r, dmg);
  es.hull -= 22 + 6 * s.up.dmissile;
  g.fx({ t: 'boom', x: r.station.x, y: r.station.y + 40, r: 70 });
  explode(g, r.station.x, r.station.y + 50, 70, 25, 'crew', tech, { kind: 'missile' });
  if (g.boss && g.boss.alive && r.type === 'core') damage(g, g.boss, dmg * 0.6, { owner: tech, kind: 'missile' });
  g.log('ship', `D-missile hits their ${r.name}!`);
}

function enemyMissile(g, es) {
  const s = g.ship;
  const ours = g.rooms.filter((r) => r.owner === 'us');
  const r = g.rng.pick(ours);
  if (!g.storyMode) { damageSystem(g, r, es.missileDmg); s.hull -= es.missileDmg * 0.5; }
  g.fx({ t: 'dfire', who: 'them', w: 'missile', room: g.rooms.indexOf(r) });
  g.fx({ t: 'boom', x: r.station.x, y: r.station.y + 50, r: 70 });
  for (const c of g.crew) if (c.alive && g.rooms[roomAt(g, c)] === r) damage(g, c, 12 + g.tier * 3, { team: 'enemy', kind: 'missile' });
  if (g.rng.chance(0.35) && !g.storyMode) {
    const walls = wallTilesOf(r).filter((w) => g.grid.tiles[w.i] === T.HULL);
    if (walls.length) { const w = g.rng.pick(walls); hitTile(g, w.x, w.y, 9999, { hull: true }); }
  }
  g.log('alert', `Their D-missile slams into our ${r.name}!`);
}

Game.prototype.endEncounter = function (win) {
  const es = this.enemyShip;
  const tier = this.tier;
  const loot = { scrap: 20 + tier * 15, gems: 6 + tier * 6, money: 15 + tier * 12 };
  if (es?.surrendered) { loot.scrap *= 1.5; loot.money *= 1.5; }
  if (es?.fled) { loot.scrap *= 0.5; loot.gems = Math.round(loot.gems * 0.5); loot.money *= 0.5; }
  if (es?.kind === 'derelict' || es?.kind === 'pod') { loot.gems = 0; }
  this.ship.scrap += Math.round(loot.scrap);
  this.ship.gems = Math.min(this.ship.gemCap, this.ship.gems + loot.gems);
  for (const c of this.crew) c.wallet += Math.round(loot.money);
  this.ship.missiles = Math.min(this.ship.missilesMax, this.ship.missiles + 1);
  this.lastLoot = loot;
  this.log('loot', `Victory! +${Math.round(loot.scrap)} scrap, +${loot.gems} gems, +${Math.round(loot.money)} each.`);
  if (es?.kind === 'ship' && this.rng.chance(0.6)) this.pendingRecruit = true;
  this.fx({ t: 'victory' });
  this.startAftermath(!!this.resume);
};

Game.prototype.startAftermath = function (resumeAfter) {
  this.setPhase('aftermath');
  this.sealDoors(false);
  this.afterResume = !!this.resume;
};

Game.prototype.choosePath = function () {
  this.story({ title: 'Do I go?', kind: 'choice', lines: [
    'Joe might be alive. A single-drill pod went deeper, down the bright tunnel where the creatures are worst.',
    'Or you take the main shaft: easier, richer, safer. You\'ll never know what happened to him.'],
  choices: [{ id: 'brother', label: 'Follow Joe (much harder)' }, { id: 'easy', label: 'Take the easier route' }] });
};

// ---------------------------------------------------------------------------
// commands from players (UI) and bots
const COMMANDS = {
  storyOk(g, c, cmd) {
    const s = g.storyOpen; if (!s) return;
    if (s.kind === 'choice') {
      const choice = cmd.choice || 'easy';
      g.path = choice;
      g.joe.state = choice === 'brother' ? 'alive' : 'abandoned';
      g.log('story', choice === 'brother' ? 'Zap: "We follow Joe." Nobody argues. Nobody sleeps, either.' : 'Zap looks at the bright tunnel for a long time. "Main shaft." The crew exhales.');
      g.nextStory();
      g.cleanupEnemy();
      g.startAftermath(false);
      return;
    }
    const after = s.after;
    g.nextStory();
    if (after === 'ambush') g.discoveryAfter = 'ambush';
    if (after === 'changed') {
      g.derelictStage = 'changed';
      const es = g.enemyShip;
      const changed = g.roster.find((x) => x.id === undefined && x.name === 'The Changed') || g.roster.find((x) => x.creature);
      if (es) for (const id of es.rooms) { const r = g.rooms[id]; for (let k = 0; k < 2 + g.tier; k++) g.spawnMob(changed.idx, (r.x0 + 2 + g.rng() * 5) * TILE, (r.y0 + 2 + g.rng() * 3) * TILE, { markable: false }); }
      g.log('alert', 'The skeletons... aren\'t all skeletons. THE CHANGED!');
    }
  },
  route(g, c, cmd) {
    if (g.phase !== 'route') return;
    const n = g.route.nodes[cmd.i];
    if (!n || n.locked) return;
    g.arrive(n);
  },
  transponder(g, c, cmd) {
    if (g.phase !== 'route') return;
    const n = g.route.nodes.find((x) => x.locked);
    if (!n) return;
    if (String(cmd.code).trim() === g.transponderCode) { n.locked = false; g.log('story', 'The targeting computer locks on. A blip appears ahead: Joe\'s ship.'); g.fx({ t: 'unlock' }); }
    else g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'NO SIGNAL', color: '#e0533a' });
  },
  helm(g, c, cmd) { if (c.cls === 'pilot') c.atHelm = !!cmd.on; },
  boost(g, c, cmd) { /* via shift */ },
  callFuel(g, c) {
    const d = g.descent;
    if (!d?.stranded) return;
    const cost = 60;
    const payer = c.wallet >= cost ? c : g.crew.find((x) => x.wallet >= cost);
    if (!payer) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'nobody has 60', color: '#e0533a' }); g.ship.fuel = 25; }
    else payer.wallet -= cost;
    g.ship.fuel = Math.max(g.ship.fuel, g.ship.fuelMax * 0.5);
    d.stranded = false;
    g.log('alert', 'Fuel drop incoming... and every ship in the area heard the call.');
    g.resume = d;
    g.startEncounter('ship');
    if (g.enemyShip) { g.enemyShip.crewLeft += 6; g.enemyShip.hull *= 1.3; g.enemyShip.hullMax = g.enemyShip.hull; }
  },
  continue(g) {
    if (g.phase !== 'aftermath') return;
    // auto-strip crates
    for (const o of [...g.objs]) if (o.kind === 'crate') g.lootCrate(g.player, o);
    if (g.resume) { const d = g.resume; g.resume = null; g.cleanupEnemy(); g.afterFightRecruit(); g.descent = d; g.setPhase('descent'); g.fx({ t: 'dig' }); return; }
    g.nextLevel();
  },
  depart(g) { if (g.phase === 'port') { g.port = null; g.nextLevel(); } },
  sell(g, c) {
    if (g.phase !== 'port' || g.ship.gems <= 0) return;
    const guard = g.crew.find((x) => x.cls === 'guard');
    const total = Math.round(g.ship.gems * g.port.gemPrice * (1 + 0.1 * (guard?.upgrades[0] || 0)));
    const each = Math.floor(total / g.crew.length);
    for (const x of g.crew) x.wallet += each;
    g.log('loot', `💎 Sold ${g.ship.gems} gems for ${total}. Everyone gets ${each}.`);
    g.stats.score += total;
    g.ship.gems = 0;
  },
  buyFuel(g, c) {
    if (g.phase !== 'port') return;
    const need = Math.ceil(g.ship.fuelMax - g.ship.fuel);
    const cost = Math.ceil(need * g.port.fuelPrice);
    if (need <= 0) return;
    const n = c.wallet >= cost ? need : Math.floor(c.wallet / g.port.fuelPrice);
    c.wallet -= Math.ceil(n * g.port.fuelPrice); g.ship.fuel += n;
  },
  repairHull(g, c) {
    if (g.phase !== 'port') return;
    const need = Math.ceil(g.ship.hullMax - g.ship.hull);
    const n = Math.min(need, c.wallet * 2);
    c.wallet -= Math.ceil(n / 2); g.ship.hull += n;
  },
  fixAll(g, c) {
    if (g.phase !== 'port') return;
    const cost = 40;
    if (c.wallet < cost) return;
    c.wallet -= cost;
    for (const r of g.rooms) if (r.owner === 'us' && r.sys) r.sys.hp = r.sys.max;
    g.repairAllTiles();
    g.log('ship', 'Dock crew patched every hole and system.');
  },
  buyUpgrade(g, c, cmd, s) {
    if (g.phase !== 'port' || !g.port.upgrades) return;
    const def = SHIP_UPGRADES[cmd.id]; if (!def) return;
    const lvl = s.up[cmd.id]; if (lvl >= 5) return;
    const cost = def.cost * (lvl + 1);
    if (c.wallet < cost) return;
    c.wallet -= cost; s.up[cmd.id]++;
    g.recalcShip();
    if (cmd.id === 'bubble') s.bubble = s.bubbleMax;
    if (cmd.id === 'plating') s.hull += 60;
    g.log('ship', `🔧 ${def.name} → level ${s.up[cmd.id]}.`);
  },
  buyMissile(g, c, cmd, s) { if (g.phase === 'port' && c.wallet >= 25 && s.missiles < s.missilesMax) { c.wallet -= 25; s.missiles++; } },
  buyScrap(g, c, cmd, s) { if (g.phase === 'port' && c.wallet >= 20) { c.wallet -= 20; s.scrap += 25; } },
  buyFood(g, c, cmd, s) { if (g.phase === 'port' && c.wallet >= 15) { c.wallet -= 15; for (const k of ['grub', 'shroom', 'fish', 'spice']) s.food[k] = (s.food[k] || 0) + 1; } },
  buyRoom(g, c, cmd) {
    if (g.phase !== 'port' || !g.port.rooms) return;
    const def = BUYABLE_ROOMS.find((r) => r.type === cmd.type); if (!def) return;
    const n = g.ourRooms.filter((r) => r.type === cmd.type).length;
    const cost = Math.round(def.cost * (1 + 0.5 * n));
    if (c.wallet < cost) return;
    const free = g.freeSlots();
    const slot = free.find((f) => f.sx === cmd.sx && f.sy === cmd.sy) || g.freeSlotNear();
    if (!slot) return;
    c.wallet -= cost;
    g.ourRooms.push({ type: cmd.type, sx: slot.sx, sy: slot.sy });
    g.layoutShip();
    g.log('ship', `🏗 New ${ROOMS[cmd.type].name} installed. The ship grows.`);
  },
  classUpgrade(g, c, cmd) {
    const k = cmd.track; if (k < 0 || k > 2) return;
    const lvl = c.upgrades[k]; if (lvl >= 5) return;
    const cost = UPGRADE_BASE_COST * (lvl + 1);
    if (c.wallet < cost) return;
    c.wallet -= cost; c.upgrades[k]++;
    g.recalcShip();
    g.fx({ t: 'text', x: c.x, y: c.y - 24, text: `${CLASS_UPGRADES[c.cls][k][0]} ${c.upgrades[k]}`, color: '#7cc46a' });
  },
  switchClass(g, c, cmd) {
    // take control of another crew member (ports only)
    if (g.phase !== 'port') return;
    const t = g.crew.find((x) => x.cls === cmd.cls && !x.human);
    if (!t) return;
    if (t.cls === 'urchid' || c.cls === 'urchid') return;
    c.human = false; c.bot = {}; c.atHelm = false;
    t.human = true; t.bot = {};
    if (g.player === c) g.player = t;
    g.fx({ t: 'switch', from: c.id, to: t.id });
  },
  // ---- stations
  cook(g, c, cmd, s) {
    if (c.cls !== 'chef' || c.cooking) return;
    const kitchen = g.rooms.find((r) => r.owner === 'us' && r.type === 'kitchen');
    if (!kitchen || kitchen.sys.hp <= 0) return;
    const rec = RECIPES.find((r) => r.id === cmd.recipe); if (!rec) return;
    if (!Object.entries(rec.needs).every(([k, v]) => (s.food[k] || 0) >= v)) return;
    for (const [k, v] of Object.entries(rec.needs)) s.food[k] -= v;
    c.cooking = { recipe: rec.id, t: 6, target: cmd.target || 'all' };
  },
  research(g, c, cmd, s) {
    if (s.researching) return;
    const r = RESEARCH.find((x) => x.id === cmd.id);
    if (!r || s.research.has(r.id) || s.scrap < r.scrap) return;
    s.scrap -= r.scrap;
    s.researching = { id: r.id, time: r.time, progress: 0 };
  },
  overclock(g, c, cmd, s) {
    if (c.cls !== 'scientist') return;
    s.overclock = cmd.sys ? { sys: cmd.sys, auto: !!cmd.auto } : null;
  },
  target(g, c, cmd, s) { if (g.rooms[cmd.room]?.owner === 'them') s.missileTarget = cmd.room; },
  fireMissile(g, c) { fireMissile(g); },
  buildMissile(g, c, cmd, s) {
    if (s.buildT > 0 || s.missiles >= s.missilesMax || s.scrap < 12) return;
    s.scrap -= 12; s.buildT = 6 / (1 + 0.3 * (c.cls === 'missiletech' ? c.upgrades[1] : 0));
  },
  plant(g, c, cmd, s) {
    const p = s.farm.plots[cmd.plot]; if (!p || p.stage !== 0 || s.farm.dirt <= 0) return;
    s.farm.dirt--; p.stage = 1; p.t = 0;
  },
  harvest(g, c, cmd, s) {
    const p = s.farm.plots[cmd.plot]; if (!p || p.stage < 3) return;
    p.stage = 0; p.t = 0;
    const n = 1 + (g.rng.chance(0.3) ? 1 : 0);
    s.food.crops = (s.food.crops || 0) + n;
    c.wallet += 4 * n;
    g.fx({ t: 'text', x: c.x, y: c.y - 20, text: `+${n} crop`, color: '#c8b040' });
  },
  sellCrops(g, c, cmd, s) {
    // to the chef (ship pantry) for money, or at a port
    const n = s.food.crops || 0; if (!n || g.phase !== 'port') return;
    s.food.crops = 0; c.wallet += n * (8 + g.tier * 2);
  },
  craftGun(g, c, cmd, s) {
    if (c.cls !== 'commando' || s.scrap < 15) return;
    s.scrap -= 15;
    const armory = g.rooms.find((r) => r.owner === 'us' && r.type === 'armory');
    dropPickup(g, armory.station.x, armory.station.y + 40, 'gun', 1);
    // bots grab them via buff
    const bots = g.crew.filter((x) => x.alive && !x.makeshift && x.cls !== 'urchid');
    const t = bots[g.rng.int(0, Math.max(0, bots.length - 1))];
    if (t && !t.human) t.makeshift = 45 * (1 + 0.2 * c.upgrades[2]);
    g.log('ship', `${c.name} mashed broken parts into a makeshift gun.`);
  },
  spin(g, c) { if (c.cls === 'slots' && c.cd.f <= 0) { if (spinSlots(g, c) !== false) c.cd.f = 1.2; } },
  buyIntel(g, c) { if (c.cls === 'agent' && g.phase === 'port' && c.wallet >= 40) { c.wallet -= 40; c.missionRank = (c.missionRank || 0) + 1; g.log('loot', `${c.name} swapped "knowledge" with a contact at the bar. More targets next fight.`); g.markedBonus = (g.markedBonus || 0) + 1; } },
  pause(g, c, cmd) { g.paused = !!cmd.on; },
};
export { COMMANDS };

Game.prototype.endGame = function () {
  this.setPhase('ending');
  const lines = this.joe.state === 'saved' ? ENDINGS.brother : ENDINGS.easy;
  this.endLines = lines;
  this.fx({ t: 'ending', brother: this.joe.state === 'saved' });
};
