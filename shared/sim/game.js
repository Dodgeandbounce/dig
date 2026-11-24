// Do I Go? — the whole game simulation. Runs in the browser for solo play and
// can run on the server for multiplayer (inputs in, snapshots out).
import {
  T, TILE, TILE_HP, MAP_W, MAP_H, SLOT_W, SLOT_H, SHIP_COLS, SHIP_ROWS, SHIP_OX, SHIP_OY, ENEMY_OY, ENEMY_GAP, MAX_DOCKED,
  LEVELS, KM_PER_LEVEL, ROOMS, CLASSES, CLASS_ORDER, STARTER_CLASSES, BUYABLE_ROOMS, SHIP_UPGRADES, SHIP_UP_MAX, CLASS_UP_MAX,
  CLASS_UPGRADES, UPGRADE_BASE_COST, RECIPES, RESEARCH, NODE_TYPES, PORT_NAMES, PORT_FLAVOR, JOE_NOTES,
  TRANSPONDER_NOTE, JOURNAL_TEXT, BROTHER_NOTES, ENDINGS, AGENT_BRIEFS, CREW_HP_MUL, BLAST_DOOR_HP, RING,
} from './data.js';
import { makeRng } from './rng.js';
import { Grid, idx, inMap, buildRooms, buildRing, addDoor, slotRect, stationPos, roomTiles, wallTilesOf, roomCenter, roomPoint } from './grid.js';
import { makeRoster, tierFor, levelMix } from './roster.js';
import {
  updateProjectiles, updatePickups, damage, hitTile, damageSystem, addMess, dropPickup, rainPickup, tickBuffs,
  addBuff, roomAt, tileOwner, healActor, explode, igniteRoom, updateFires, inOurBox,
} from './combat.js';
import { crewTick, interactTarget, say, spinSlots, quip } from './classes.js';
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

export const GAME_VERSION = 2;   // bump when saved games can't be loaded any more (map size, layout)

export class Game {
  constructor({ seed, playerClass = 'pilot', playerName, shipName, speed = 1 } = {}) {
    this.v = GAME_VERSION;
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
    this.transponderLevel = this.rng.int(10, 16);
    this.transponderCode = String(this.rng.int(1000, 9999));
    this.noteIdx = 0;
    this.brotherIdx = 0;
    this.lastNoteLevel = 0;
    this.joe = { state: 'missing' };
    this.storyMode = playerClass === 'urchid';
    this.box = { x0: 0, y0: SHIP_OY, x1: MAP_W - 1, y1: MAP_H - 1 };   // our ship's bounds (tiles, outer hull included)
    this.enemyShips = [];

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
  quip(c, kind, force) { quip(this, c, kind, force); }
  panel(c, type, room) { if (c.human) this.fx({ t: 'panel', crew: c.id, panel: type, room: room ? this.rooms.indexOf(room) : null }); }
  get tier() { return tierFor(this.level, this.path); }
  /** The enemy ship that matters most right now (docked and still fighting, else any). */
  get enemyShip() {
    const l = this.enemyShips; if (!l?.length) return null;
    return l.find((s) => s.docked && !s.done) || l.find((s) => !s.done && !s.gone) || l.find((s) => !s.gone) || null;
  }
  /** Enemy ships that are docked and still in the fight. */
  get fightingShips() { return (this.enemyShips || []).filter((s) => s.docked && !s.done); }
  get depthKm() { return Math.round(((this.level - 1) + (this.phase === 'descent' ? Math.min(1, this.descent.progress) : (this.levelDone || this.phase === 'route') ? 1 : 0)) * KM_PER_LEVEL); }

  // -------------------------------------------------------------------------
  // crew
  addCrew(cls, name) {
    const def = CLASSES[cls];
    const home = this.rooms.find((r) => r.owner === 'us' && r.type === def.room) || this.rooms[0];
    const hp = Math.round(def.hp * (cls === 'urchid' ? 1 : CREW_HP_MUL));
    const c = {
      id: uid(), cls, name: (name || '').trim().slice(0, 16) || def.def, team: 'crew', human: false,
      x: home.station.x + 40 + this.rng.range(-20, 40), y: home.station.y + 60, r: cls === 'slots' ? 13 : cls === 'dog' ? 10 : 11,
      hp, maxHp: hp, alive: true, downT: 0, wallet: 25, upgrades: [0, 0, 0],
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
    // the whole area our ship could ever cover
    const AX0 = SHIP_OX - RING, AY0 = SHIP_OY - RING, AX1 = SHIP_OX + SHIP_COLS * SLOT_W + RING, AY1 = SHIP_OY + SHIP_ROWS * SLOT_H + RING;
    const keepTiles = new Map();
    if (this.rooms) {
      for (let y = AY0; y <= AY1; y++) for (let x = AX0; x <= AX1; x++) {
        const i = idx(x, y), t = this.grid.tiles[i];
        if (t === T.BREACH || t === T.RUBBLE || t === T.DEBRIS || ((t === T.WALL || t === T.HULL) && this.grid.hp[i] < TILE_HP[t])) keepTiles.set(i, { t, hp: this.grid.hp[i] });
      }
    }
    const oldDoors = new Map((this.doors || []).filter((d) => d.owner === 'us').map((d) => [d.i, d]));
    const oldSys = new Map((this.rooms || []).filter((r) => r.owner === 'us').map((r) => [`${r.sx},${r.sy}`, r]));
    this.grid.clearRegion(AX0, AY0, AX1, AY1);
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
    // the walkway around the whole ship, with a door out of every room that touches it
    const ring = buildRing(this.grid, rooms, this.doors);
    this.addBlastDoors(ring);
    this.rooms = [...rooms, ...theirs];
    // re-index enemy rooms in the grid
    theirs.forEach((r, k) => { for (const i of roomTiles(r)) this.grid.room[i] = rooms.length + k; });
    this.doors.forEach((d, k) => { this.grid.doorAt[d.i] = k; const o = oldDoors.get(d.i); if (o && d.owner === 'us') { d.hp = Math.min(d.maxHp, o.hp); d.hold = o.hold; } });
    for (const [i, s] of keepTiles) {
      const now = this.grid.tiles[i], was = this.orig.get(i);
      const back = s.t === T.BREACH ? now === T.HULL
        : (s.t === T.RUBBLE || s.t === T.DEBRIS) ? (now === T.WALL || (now === T.FLOOR && was === T.FLOOR))
        : now === s.t;
      if (!back) continue;
      this.grid.tiles[i] = s.t; this.grid.hp[i] = s.hp;
      if (s.t === T.BREACH) this.orig.set(i, T.HULL);
      else if (s.t === T.RUBBLE || s.t === T.DEBRIS) this.orig.set(i, was ?? now);
    }
    for (const [i] of [...this.orig]) { const t = this.grid.tiles[i]; if (t !== T.RUBBLE && t !== T.BREACH && t !== T.DEBRIS) this.orig.delete(i); }
    this.grid.version++;
    // our bounds and outer hull
    let x0 = MAP_W, y0 = MAP_H, x1 = 0, y1 = 0;
    this.hullTiles = [];
    for (let y = AY0; y <= AY1; y++) for (let x = AX0; x <= AX1; x++) {
      const t = this.grid.tiles[idx(x, y)];
      if (t === T.VOID) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      if (t === T.HULL || t === T.BREACH) this.hullTiles.push(idx(x, y));
    }
    this.box = { x0, y0, x1, y1 };
    // vents for the chameleon
    this.objs = (this.objs || []).filter((o) => o.kind !== 'vent' || o.owner !== 'us');
    if (this.crew?.some((c) => c.cls === 'chameleon')) this.addVents(rooms, 'us');
    this.recalcShip();
  }

  /** Four heavy blast doors across the walkway (top, bottom, left, right). Open unless someone shuts them. */
  addBlastDoors(ring) {
    if (!ring.length) return;
    const set = new Set(ring);
    const G = this.grid;
    const floor = (x, y) => inMap(x, y) && set.has(idx(x, y));
    const nearDoor = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => G.get(x + dx, y + dy) === T.DOOR);
    let x0 = MAP_W, y0 = MAP_H, x1 = 0, y1 = 0;
    for (const i of ring) { const x = i % MAP_W, y = (i / MAP_W) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const cx = Math.round((x0 + x1) / 2), cy = Math.round((y0 + y1) / 2);
    // run of walkway tiles across the corridor, scanning from the outside in
    const tryLine = (fixed, vertical, from, to) => {
      const step = from < to ? 1 : -1;
      for (let p = from; p !== to; p += step) {
        const [x, y] = vertical ? [fixed, p] : [p, fixed];
        if (!floor(x, y)) continue;
        const run = [];
        let q = p;
        while (run.length < 4) { const [rx, ry] = vertical ? [fixed, q] : [q, fixed]; if (!floor(rx, ry)) break; run.push([rx, ry]); q += step; }
        if (run.length >= 1 && run.length <= 3 && !run.some(([rx, ry]) => nearDoor(rx, ry))) return run;
        return null;
      }
      return null;
    };
    const sides = [
      [(o) => tryLine(cx + o, true, y0 - 1, cy), 'v'],
      [(o) => tryLine(cx + o, true, y1 + 1, cy), 'v'],
      [(o) => tryLine(cy + o, false, x0 - 1, cx), 'h'],
      [(o) => tryLine(cy + o, false, x1 + 1, cx), 'h'],
    ];
    for (const [find, orient] of sides) {
      let run = null;
      for (const o of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) { run = find(o); if (run) break; }
      if (!run) continue;
      for (const [x, y] of run) { const d = addDoor(G, this.doors, x, y, -1, -1, 'us', orient, BLAST_DOOR_HP); d.blast = true; d.hold = 'open'; d.open = 1; }
    }
  }

  /** Hull tiles of our ship near a room (for things that punch holes in it). */
  hullNear(room, reach = 7) {
    const c = roomCenter(room);
    const tx = c.x / TILE, ty = c.y / TILE;
    const near = (this.hullTiles || []).filter((i) => this.grid.tiles[i] === T.HULL && Math.abs((i % MAP_W) - tx) < SLOT_W / 2 + reach && Math.abs(((i / MAP_W) | 0) - ty) < SLOT_H / 2 + reach);
    return near.map((i) => ({ i, x: i % MAP_W, y: (i / MAP_W) | 0 }));
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
    // older types keep up a little, every level adds a bit, and each one is a bit random
    const tierScale = (1 + Math.max(0, this.tier - ty.tier) * 0.3) * (1 + 0.02 * (this.level - 1)) * (opts.team === 'crew' ? 1 : this.rng.range(0.85, 1.2));
    const hp = ty.hp * tierScale * (opts.hpMul || 1) * (this.storyMode && opts.team !== 'crew' ? 0.25 : 1) * (1 + 0.08 * Math.max(0, this.humanCount() - 1));
    const m = {
      id: uid(), type: typeIdx, team: opts.team || 'enemy', name: ty.name, x, y, r: 11 * ty.size, hp, maxHp: hp, alive: true,
      speed: ty.speed, dmgMul: ty.dmgMul * tierScale * (opts.dmgMul || 1), weapon: ty.weapon, role: ty.role, armor: ty.armor,
      atkT: this.rng.range(0.3, 1.2), facing: 0, defender: !!opts.defender, boss: !!ty.boss, isMonster: !!opts.isMonster, ownerId: opts.ownerId,
      marked: false, esId: opts.esId,
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
    if (this.departWarnT > 0) this.departWarnT -= dt;

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
    const p = roomCenter(r);
    c.alive = true; c.hp = c.maxHp; c.x = p.x + this.rng.range(-20, 20); c.y = p.y + 16;
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
      } else if (d.sealed) want = 0;
      else if (d.hold === 'open') want = 1;            // propped open: anyone can walk through, them too
      else if (d.hold !== 'closed') {
        for (const c of this.crew) if (c.alive && Math.abs(c.x - cx) < 50 && Math.abs(c.y - cy) < 50) { want = 1; break; }
        if (!want) for (const m of this.mobs) if (m.alive && m.team === 'crew' && Math.abs(m.x - cx) < 46 && Math.abs(m.y - cy) < 46) { want = 1; break; }
      }
      d.open = clamp(d.open + (want ? 1 : -1) * dt / (d.blast ? 1.4 : 1.1), 0, 1); // they open and close slowly (blast doors a bit slower)
    }
  }

  shipTick(dt) {
    const s = this.ship;
    updateFires(this, dt);
    if (s.evasiveT > 0) s.evasiveT -= dt;
    for (const r of this.rooms) if (r.reinforced > 0) r.reinforced -= dt;
    // breaches leak dirt and drain the hull
    this.leakT = (this.leakT || 0) - dt;
    if (this.leakT <= 0) {
      this.leakT = 1;
      let breaches = 0;
      const B = this.box;
      const creatures = this.roster.filter((x) => x.creature && x.tier <= this.tier);
      const calm = this.phase === 'port' || this.phase === 'briefing';
      for (let y = B.y0; y <= B.y1; y++) for (let x = B.x0; x <= B.x1; x++) {
        if (this.grid.tiles[idx(x, y)] !== T.BREACH) continue;
        breaches++;
        let inside = null;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.grid.get(x + dx, y + dy) === T.FLOOR) { inside = [x + dx, y + dy]; break; }
        if (!inside) continue;
        // dirt pours in next to the hole...
        if (this.rng.chance(0.18)) addMess(this, (inside[0] + .5) * TILE, (inside[1] + .5) * TILE, 'dirt', 1);
        // ...and things crawl in through it. The deeper we are, the more often.
        if (!calm && creatures.length && this.mobs.length < 70 && this.rng.chance(0.006 * (1 + this.tier * 1.3))) {
          const type = this.rng.pick(creatures);
          this.spawnMob(type.idx, (inside[0] + .5) * TILE, (inside[1] + .5) * TILE, { markable: false });
          if (this.time - (this.crawlLogAt || -99) > 12) { this.crawlLogAt = this.time; this.log('alert', `A ${type.name} crawled in through a hull breach! Patch those holes.`); }
        }
      }
      const drain = breaches * 0.35 * (s.research.has('plating') ? 0.5 : 1) * (this.phase === 'port' ? 0 : 1);
      if (!this.storyMode) s.hull = Math.max(0, s.hull - drain);
      this.breaches = breaches;
      // lose an engine and the whole ship starts catching fire
      if (!calm && !this.storyMode) {
        const dead = this.rooms.filter((r) => r.owner === 'us' && r.type === 'engine' && r.sys.hp <= 0).length;
        if (dead && this.rng.chance(0.14 * dead)) {
          const r = this.rng.pick(this.rooms.filter((x) => x.owner === 'us'));
          igniteRoom(this, r, 1);
        }
      }
      // clean ship buff
      const messes = this.objs.filter((o) => o.kind === 'mess' && inOurBox(this, o.x, o.y)).reduce((a, o) => a + o.amt, 0);
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
    this.log('story', `— ${this.depthKm.toLocaleString()} km below sea level —`);
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
    // (no "read a note" stop: Joe's notes turn up wherever you go)
    const pool = { ship: 4 + this.tier, port: needPort ? 6 : 2, fuel: this.ship.fuel < 45 ? 4 : 1.5, nest: this.tier >= 1 ? 2 + this.tier * 0.5 : 0.4, city: L >= 5 ? 1.2 : 0, repair: this.ship.hull < this.ship.hullMax * 0.5 ? 3 : 0.8 };
    const n = this.rng.chance(0.4) ? 3 : 2;
    const used = new Set();
    if (needPort) { add(this.rng.chance(0.3) && L >= 5 ? 'city' : 'port'); used.add('port'); used.add('city'); }
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
    if (!node.boss && !node.rescue && !node.derelict) this.maybeNote(node);
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

  /** Joe's notes (or, on the brother path, his journal pages) turn up at whatever stop you picked. */
  maybeNote(node) {
    const brother = this.path === 'brother';
    const left = brother ? this.brotherIdx < BROTHER_NOTES.length : this.noteIdx < JOE_NOTES.length;
    if (!left) return;
    const gap = this.level - this.lastNoteLevel;
    if (gap < 2 || !(gap >= 5 || this.rng.chance(0.3))) return;
    this.lastNoteLevel = this.level;
    const where = { ship: "stuffed in a dead boarder's pocket", nest: 'scratched into the wall of the nest', port: 'pinned up at the dock', city: 'tucked under a bar stool in the city', fuel: 'taped to a fuel pump', repair: 'wedged in a toolbox at the repair dock' }[node.type] || 'in the dirt';
    if (brother) {
      this.story({ title: "A page from Joe's journal", lines: [BROTHER_NOTES[this.brotherIdx++], `(found ${where})`], kind: 'note' });
      return;
    }
    const n = JOE_NOTES[this.noteIdx++];
    this.applyReward(n.reward);
    this.story({ title: 'A note from Joe', lines: [n.text, `(found ${where}) ${n.rewardText}`], kind: 'note' });
  }

  afterFightRecruit() {
    if (!this.pendingRecruit) return;
    this.pendingRecruit = false;
    this.recruit(2, 'were prisoners on their ship and join up');
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
    for (let k = 0; k < 8 + this.tier * 3; k++) { const r = this.rng.pick(this.rooms.filter((x) => x.owner === 'us')); const p = roomPoint(r, this.rng); rainPickup(this, p.x, p.y, this.rng.chance(0.7) ? 'gem' : 'ore', 1); }
    if (reward) { this.applyReward(reward.reward); lines.push(`(${reward.rewardText})`); }
    this.story({ title: this.path === 'brother' ? "A page from Joe's journal" : 'A note from Joe', lines, kind: 'note',
      after: this.rng.chance(0.35 + this.tier * 0.1) ? 'ambush' : 'aftermath' });
  }

  applyReward(r) {
    const s = this.ship;
    if (r.scrap) s.scrap += r.scrap;
    if (r.money) for (const c of this.crew) c.wallet += r.money;
    if (r.upgrade) { s.up[r.upgrade] = Math.min(SHIP_UP_MAX, s.up[r.upgrade] + 1); this.recalcShip(); }
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
    if (kind === 'repair') { for (const r of this.rooms) if (r.owner === 'us' && r.sys) r.sys.hp = r.sys.max; this.repairAllTiles(); this.log('ship', 'The repair dock fixed every system and hole. Free of charge (they love foxes).'); }
    if (kind === 'fuel') { this.ship.hull = Math.min(this.ship.hullMax, this.ship.hull + 30); }
    if (kind === 'city') { for (const c of this.crew) addBuff(c, { regen: 1, speed: 0.1 }, 120, 'city'); this.log('ship', 'Real beds, real food, live music. The crew is well rested (+regen, +speed).'); }
    // new crew sign on, two at a time
    if (full) this.recruit(2);
    this.botsShop();
    // a missile restock for free and some loot from the trip
    this.ship.missiles = Math.min(this.ship.missilesMax, this.ship.missiles + 1);
    this.log('story', `⚓ Docked at ${this.port.name}. ${this.port.flavor}`);
    this.tip('port', 'Ports: sell gems (everyone gets a share), buy ship upgrades and new rooms, or switch to another crew member under Crew & class. Tab = your class upgrades.');
  }

  recruit(max = 2, how = 'signs on') {
    const have = new Set(this.crew.map((c) => c.cls));
    // the whole crew is aboard about 60% of the way down, so there's time to play with all of them
    const next = CLASS_ORDER.filter((k) => !have.has(k) && k !== 'urchid' && CLASSES[k].unlock <= Math.ceil(this.level / 2.3) && CLASSES[k].unlock > 0);
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
        if (c.upgrades[k] >= CLASS_UP_MAX || c.wallet - cost < 20) break;
        c.wallet -= cost; c.upgrades[k]++;
      }
    }
    if (noHumans) for (const id of ['plating', 'dgun', 'bubble', 'dmissile']) {
      const lvl = s.up[id]; const cost = SHIP_UPGRADES[id].cost * (lvl + 1);
      const payer = bots.find((c) => c.wallet >= cost + 20);
      if (payer && lvl < SHIP_UP_MAX) { payer.wallet -= cost; s.up[id]++; this.recalcShip(); }
    }
  }

  repairAllTiles() {
    for (const [i, t] of [...this.orig]) {
      if (tileOwner(this, i % MAP_W, (i / MAP_W) | 0) !== 'us') continue;
      if (t === T.DOOR) { const d = this.doors[this.grid.doorAt[i]]; if (d) { d.broken = false; d.hp = d.maxHp; } }
      this.grid.tiles[i] = t; this.grid.hp[i] = TILE_HP[t] || 0; this.orig.delete(i);
    }
    const B = this.box;
    for (let y = B.y0; y <= B.y1; y++) for (let x = B.x0; x <= B.x1; x++) { const i = idx(x, y); const t = this.grid.tiles[i]; if (TILE_HP[t] && t !== T.DEBRIS) this.grid.hp[i] = TILE_HP[t]; }
    for (const d of this.doors) if (d.owner === 'us') d.hp = d.maxHp;
    this.objs = this.objs.filter((o) => o.kind !== 'fire');
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
    const B = this.box;
    this.air = [0, 1, 2].map(() => ({ x: rng.range(B.x0 + 4, B.x1 - 4) * TILE, y: rng.range(B.y0 + 3, B.y1 - 3) * TILE, s: rng.range(0.6, 1.2), spin: rng.chance(0.5) ? 1 : -1, out: rng.range(-0.3, 0.3) }));
    this.air.drift = { x: rng.range(-20, 20), y: rng.range(-15, 15) };
    this.weFled = false; this.fleeT = 0;
    const noHumans = !this.crew.some((c) => c.human);

    if (kind === 'nest') {
      this.nest = { waves: 4 + tier * 2, waveT: 2, left: 4 + tier * 2 };
      this.log('alert', '♨ Creatures! They\'re burrowing into the hull!');
      if (noHumans) this.sealDoors(true);
      return;
    }
    // how many ships come for us: one up top, up to four deep down
    let n = 1;
    if (kind === 'ship') {
      n = [1, 1 + (rng.chance(0.4) ? 1 : 0), 2 + (rng.chance(0.25) ? 1 : 0), 2 + (rng.chance(0.6) ? 1 : 0), 3 + (rng.chance(0.5) ? 1 : 0)][tier];
      if (this.path === 'brother' && rng.chance(0.4)) n++;
      n = Math.min(MAX_DOCKED, n);
    }
    let delay = kind === 'ship' ? rng.range(6, 8) : 4;
    for (let k = 0; k < n; k++) {
      const layout = enemyLayout(kind, tier, rng, this.ship.name, k);
      if (this.path === 'brother' && kind === 'ship') layout.boarders = Math.round(layout.boarders * 1.3);
      // bigger crew, bigger fights: lots of enemies (split between the ships)
      const crewN = this.crew.length;
      layout.boarders = Math.round(layout.boarders * (0.8 + 0.07 * crewN) / Math.sqrt(n));
      layout.wave += Math.floor(crewN / 5);
      // several ships share the gunnery: each one fires less often
      layout.gunPeriod *= 0.7 + 0.3 * n; layout.missilePeriod *= 0.7 + 0.3 * n;
      const es = this.planEnemyShip(layout, kind, delay);
      if (!es) break;
      delay += rng.range(14, 26);
    }
    if (noHumans && kind !== 'derelict' && kind !== 'pod') this.sealDoors(true);
    if (kind === 'ship') {
      const first = this.enemyShips[0];
      const m = this.enemyShips.length;
      this.log('alert', m > 1 ? `☠ ${m} ships are closing in! ${first.name} docks first.` : `☠ ${first.name} is coming in to dock! Defend the ship!`);
      this.tip('docking', 'Ships are docking. Press L to seal every door (boarders have to smash through, but so do you without clearance), or prop doors open with E for the fighters. The 4 blast doors in the outer walkway are open until someone shuts them.');
      this.tip('duel', 'The weapons bay (or the pilot, if there is no missile tech) picks which enemy room the D-guns and missiles hit. Bubbles stop guns, not missiles. Wreck their bridge and engine and they give up.');
    }
    if (kind === 'boss') { this.log('alert', '☀ THE CORE. Something enormous is coming up to meet us.'); this.fx({ t: 'boss' }); }
    if (kind === 'derelict') this.log('story', 'Joe\'s ship. Dark. Cold. Docking...');
    if (kind === 'pod') this.log('story', 'Joe\'s pod! Get to him before they do!');
  }

  sealDoors(on) {
    for (const d of this.doors) if (d.owner === 'us' && !d.broken) { d.sealed = on; if (on && !d.blast) d.hold = null; }
    this.doorsSealed = on;
    this.grid.version++;
    if (on) this.fx({ t: 'seal' });
  }

  /**
   * Reserve a spot above or below our ship for an enemy ship and start its approach.
   * It's drawn coming in while `approachT` counts down, then docks (rooms built, tunnel blown).
   */
  planEnemyShip(layout, kind, approach) {
    const cols = Math.max(...layout.rooms.map((r) => r.c)) + 1;
    const rows = Math.max(...layout.rooms.map((r) => r.r)) + 1;
    const w = cols * SLOT_W + 1, h = rows * SLOT_H + 1;
    const B = this.box;
    const taken = this.enemyShips.filter((s) => !s.gone).map((s) => s.rect);
    const overlaps = (r) => taken.some((t) => r.x0 < t.x0 + t.w + 2 && t.x0 < r.x0 + r.w + 2 && r.y0 < t.y0 + t.h + 2 && t.y0 < r.y0 + r.h + 2);
    const spots = [];
    const topY = B.y0 - ENEMY_GAP - h, botY = B.y1 + ENEMY_GAP + 1;
    const mid = Math.round((B.x0 + B.x1) / 2);
    for (const side of ['top', 'bottom']) {
      const y0 = side === 'top' ? topY : botY;
      if (y0 < ENEMY_OY || y0 + h > MAP_H - 2) continue;
      for (const x0 of [mid - (w >> 1), B.x0 - 4, B.x1 - w + 4, mid - w - 2, mid + 2, B.x0 + 6, B.x1 - w - 6]) {
        const r = { x0: clamp(x0, 2, MAP_W - w - 2), y0, w, h };
        if (!overlaps(r)) spots.push({ side, rect: r });
      }
    }
    if (!spots.length) return null;
    // from above or below (toward the core), wherever there's room. The first one lines up with the middle.
    const pick = this.enemyShips.length === 0 ? (this.rng.chance(0.5) ? spots[0] : spots.find((s) => s.side === 'bottom') || spots[0]) : this.rng.pick(spots);
    const es = {
      id: uid(), kind, name: layout.name, layout, side: pick.side, rect: pick.rect, cols, rows,
      approachT: approach, approachMax: approach, docked: false,
      rooms: [], tunnel: [], dock: null, airlock: null,
      hull: layout.hull, hullMax: layout.hull, bubble: layout.bubble, bubbleMax: layout.bubble, bubbleT: 0,
      gunT: this.rng.range(0, 2), gunPeriod: layout.gunPeriod, gunDmg: layout.gunDmg, missileT: 0, missilePeriod: layout.missilePeriod, missileDmg: layout.missileDmg,
      crewLeft: layout.boarders, spawnT: 2, wave: layout.wave, done: false, stolen: 0, surrendered: false, inbound: [],
    };
    this.enemyShips.push(es);
    return es;
  }

  /** An approaching ship arrives: build it into the world, dig the boarding tunnel, blow the holes. */
  dockShip(es) {
    const tier = this.tier, kind = es.kind, layout = es.layout, R = es.rect;
    const base = this.rooms.length;
    const rooms = layout.rooms.map((lr) => {
      const def = ROOMS[lr.type] || {};
      const room = { type: lr.type, name: lr.name || def.name || lr.type, owner: 'them', esId: es.id, x0: R.x0 + lr.c * SLOT_W, y0: R.y0 + lr.r * SLOT_H, alive: true, reinforced: 0,
        sys: { type: lr.type, max: Math.round((lr.hp || def.hp || 80) * 1.3 * (1 + 0.6 * tier)), hp: 0 }, c: lr.c, r: lr.r };
      room.sys.hp = room.sys.max;
      room.station = stationPos(room);
      return room;
    });
    buildRooms(this.grid, rooms, base, this.doors, 'them');
    this.rooms.push(...rooms);
    // airlock on the side facing us
    const dir = es.side === 'top' ? 1 : -1;
    const facing = rooms.filter((r) => r.r === (es.side === 'top' ? es.rows - 1 : 0));
    const airCol = layout.airlock ?? Math.floor(es.cols / 2);
    const airRoom = facing.find((r) => r.c === airCol) || facing[0];
    const ax = airRoom.x0 + (SLOT_W >> 1), ay = es.side === 'top' ? airRoom.y0 + SLOT_H : airRoom.y0;
    // our nearest outer hull tile on that side (with the walkway right behind it)
    let best = null, bd = Infinity;
    for (const i of this.hullTiles || []) {
      if (this.grid.tiles[i] !== T.HULL) continue;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      if (this.grid.get(x, y - dir) !== T.VOID || this.grid.get(x, y + dir) !== T.FLOOR) continue;
      if (this.enemyShips.some((o) => o !== es && o.dock && Math.abs(o.dock.x - x) < 4 && Math.abs(o.dock.y - y) < 4)) continue;
      const d = Math.abs(x - ax) * 1.5 + Math.abs(y - ay);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (!best) best = { x: clamp(ax, this.box.x0 + 3, this.box.x1 - 3), y: es.side === 'top' ? this.box.y0 : this.box.y1 };
    const dockX = best.x, dockY = best.y;
    const tunnel = [];
    const carve = (x, y) => { if (!inMap(x, y)) return; const i = idx(x, y); if (this.grid.tiles[i] === T.VOID) { this.grid.tiles[i] = T.TUNNEL; this.grid.hp[i] = 0; tunnel.push(i); } };
    const midY = Math.round((ay + dockY) / 2);
    for (let y = Math.min(ay + dir, midY); y <= Math.max(ay + dir, midY); y++) for (let k = -1; k <= 1; k++) carve(ax + k, y);
    for (let x = Math.min(ax, dockX) - 1; x <= Math.max(ax, dockX) + 1; x++) for (let k = -1; k <= 1; k++) carve(x, midY + k);
    for (let y = Math.min(midY, dockY - dir); y <= Math.max(midY, dockY - dir); y++) for (let k = -1; k <= 1; k++) carve(dockX + k, y);
    // tunnel walls
    for (const i of [...tunnel]) {
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = idx(x + dx, y + dy); if (inMap(x + dx, y + dy) && this.grid.tiles[j] === T.VOID) { this.grid.tiles[j] = T.HULL; this.grid.hp[j] = 999; tunnel.push(-j - 1); } }
    }
    // blow the holes: their airlock and our hull
    const ai = idx(ax, ay); this.grid.tiles[ai] = T.TUNNEL; this.grid.hp[ai] = 0;
    const di = idx(dockX, dockY); this.grid.tiles[di] = T.TUNNEL; this.grid.hp[di] = 0;
    this.grid.version++;
    this.fx({ t: 'boom', x: (dockX + .5) * TILE, y: (dockY + .5) * TILE, r: 50 });
    this.fx({ t: 'docked', x: (dockX + .5) * TILE, y: (dockY + .5) * TILE });
    // which of our rooms is nearest the hole (crew on their ship get sent home there)
    let home = 0, hd = Infinity;
    this.rooms.forEach((r, k) => { if (r.owner !== 'us') return; const c = roomCenter(r); const d = Math.hypot(c.x / TILE - dockX, c.y / TILE - dockY); if (d < hd) { hd = d; home = k; } });
    Object.assign(es, { docked: true, rooms: rooms.map((r) => this.rooms.indexOf(r)), tunnel, dock: { x: dockX, y: dockY, room: home }, airlock: { x: ax, y: ay } });

    // defenders, decorations, crates
    for (const r of rooms) {
      const p = roomCenter(r);
      if (kind === 'ship' || kind === 'boss') {
        const n = r.type === 'bridge' ? 1 + (tier >= 3 ? 1 : 0) : r.type === 'weapons' ? 1 + Math.floor(tier / 2) : r.type === 'shield' && tier >= 2 ? 1 : r.type === 'engine' && tier >= 3 ? 1 : 0;
        for (let k = 0; k < n; k++) this.spawnMob(this.pickType(), p.x - 40 + k * 40, p.y, { defender: true, esId: es.id });
      }
      if (kind === 'derelict') {
        for (let k = 0; k < 2; k++) { const q = roomPoint(r, this.rng); this.objs.push({ id: uid(), kind: 'skeleton', x: q.x, y: q.y, a: this.rng() * 6 }); }
        this.objs.push({ id: uid(), kind: 'crate', x: (r.x0 + SLOT_W - 2.5) * TILE, y: (r.y0 + SLOT_H - 2.5) * TILE, owner: 'them' });
        if (r.type === 'bridge') this.objs.push({ id: uid(), kind: 'journal', x: p.x, y: p.y, owner: 'them' });
      }
      if (kind === 'pod') {
        const joe = this.spawnMob(this.roster.findIndex((x) => x.creature), p.x, p.y, { team: 'crew', markable: false });
        Object.assign(joe, { isJoe: true, name: 'Joe', hp: 450, maxHp: 450, speed: 150, r: 11, following: false, atkT: 0, armor: 0.3 });
        this.joe.mob = joe;
        this.nest = { waves: 5 + tier, waveT: 4, left: 5 + tier, pod: r };
      }
      if (kind === 'boss' && r.type === 'core') {
        const bi = this.roster.findIndex((x) => x.boss);
        const boss = this.spawnMob(bi, p.x, p.y, { defender: true, esId: es.id });
        boss.r = 34; boss.hp = boss.maxHp = this.roster[bi].hp * (this.path === 'brother' ? 1.3 : 1) * (1 + 0.15 * Math.max(0, this.humanCount() - 1));
        this.boss = boss;
      }
    }
    if (this.crew.some((c) => c.cls === 'chameleon')) this.addVents(rooms, 'them');
    if (kind === 'ship') {
      this.log('alert', `☠ ${es.name} has docked and blown a hole in our hull!`);
      const talkers = this.rng.shuffle(this.crew.filter((c) => c.alive)).slice(0, 2);
      for (const c of talkers) quip(this, c, 'dock', true);
    }
  }

  pickType() {
    const r = this.rng() * 100; let acc = 0;
    for (const m of this.mix) { acc += m.pct; if (r <= acc) return m.type; }
    return this.mix[0].type;
  }

  /** Is this point on that enemy ship (or in its tunnel)? */
  onEnemyShip(es, p) {
    const R = es.rect, tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    if (tx >= R.x0 - 1 && tx <= R.x0 + R.w && ty >= R.y0 - 1 && ty <= R.y0 + R.h) return true;
    return (es._tun ||= new Set(es.tunnel.map((i) => (i >= 0 ? i : -i - 1)))).has(idx(tx, ty));
  }

  /** One enemy ship leaves (fled, destroyed, or the encounter is over). Its tiles go back to dirt. */
  detachShip(es) {
    if (es.gone) return;
    es.gone = true; es.done = true;
    if (!es.docked) return;
    const on = (p) => this.onEnemyShip(es, p);
    const dock = this.rooms[es.dock.room] || this.rooms[0];
    const home = roomCenter(dock);
    for (const c of this.crew) if (on(c)) { c.x = home.x + this.rng.range(-20, 20); c.y = home.y; c.riding = null; }
    for (const m of this.mobs) {
      if (!on(m)) continue;
      if (m.team === 'crew') { m.x = home.x; m.y = home.y; } else m.alive = false;
    }
    this.mobs = this.mobs.filter((m) => m.team === 'crew' || m.alive);
    const R = es.rect;
    this.grid.clearRegion(R.x0, R.y0, R.x0 + R.w - 1, R.y0 + R.h - 1);
    for (const i of es.tunnel) { const j = i >= 0 ? i : -i - 1; if (this.grid.room[j] < 0 && (this.grid.tiles[j] === T.TUNNEL || this.grid.tiles[j] === T.HULL)) { this.grid.tiles[j] = T.VOID; this.grid.hp[j] = 0; } }
    const ai = idx(es.airlock.x, es.airlock.y); if (this.grid.room[ai] < 0) { this.grid.tiles[ai] = T.VOID; this.grid.hp[ai] = 0; }
    // the hole they blew stays a breach until someone patches it
    const di = idx(es.dock.x, es.dock.y);
    this.grid.tiles[di] = T.BREACH; this.grid.hp[di] = 0; this.orig.set(di, T.HULL);
    for (const id of es.rooms) { const r = this.rooms[id]; if (r) { r.alive = false; r.gone = true; } }
    for (const d of this.doors) if (d.owner === 'them' && on({ x: (d.x + .5) * TILE, y: (d.y + .5) * TILE })) { d.gone = true; d.broken = true; }
    this.objs = this.objs.filter((o) => !(o.owner === 'them' && on(o)) && !(o.kind === 'vent' && o.owner === 'them' && on(o)));
    this.pickups = this.pickups.filter((p) => !on(p));
    for (const [i] of [...this.orig]) if (i !== di && on({ x: ((i % MAP_W) + .5) * TILE, y: (((i / MAP_W) | 0) + .5) * TILE })) this.orig.delete(i);
    if (this.ship.missileTarget != null && es.rooms.includes(this.ship.missileTarget)) this.ship.missileTarget = null;
    this.grid.version++;
  }

  cleanupEnemy() {
    for (const es of this.enemyShips || []) this.detachShip(es);
    if (this.rooms.some((r) => r.owner === 'them') || this.doors.some((d) => d.owner === 'them')) {
      this.rooms.length = this.rooms.filter((r) => r.owner === 'us').length;
      this.doors = this.doors.filter((d) => d.owner === 'us');
      this.doors.forEach((d, k) => { this.grid.doorAt[d.i] = k; });
      this.grid.version++;
    }
    this.enemyShips = [];
    this.boss = null;
    this.nest = null;
    this.air = null;
    this.fleeT = 0;
    this.ship.missileTarget = null;
    this.sealDoors(false);
  }

  onSystemDestroyed(room) {
    if (room.owner === 'them') {
      const es = this.enemyShips.find((s) => s.id === room.esId);
      if (es && !es.done && es.kind === 'ship') {
        const mine = es.rooms.map((id) => this.rooms[id]);
        const alive = (t) => mine.some((r) => r.type === t && r.sys.hp > 0);
        const hasEngine = mine.some((r) => r.type === 'engine');
        if (!alive('bridge') && (!hasEngine || !alive('engine')) && !alive('weapons')) this.surrender(es, `${es.name}: bridge, guns and engine wrecked. They surrender!`);
        else if (!alive('bridge') && hasEngine && !alive('engine')) this.surrender(es, `${es.name}: bridge and engine wrecked. They surrender!`);
      }
      return;
    }
    if (room.type === 'vault') this.recalcShip();
    if (room.type === 'engine' && !this.storyMode) { igniteRoom(this, room, 4); this.log('alert', `The ${room.name} is on FIRE! With an engine down, fires will break out all over the ship.`); }
    if (room.type === 'bridge') this.log('alert', 'The bridge is wrecked! We can\'t escape or undock until it\'s repaired.');
    // wreckage piles up in front of a door: the room is cut off until somebody clears it
    if (this.rng.chance(0.5)) this.blockDoorway(room);
  }

  /** Wreckage falls in front of one of the room's doors (blocks the way until repaired). */
  blockDoorway(room) {
    const ri = this.rooms.indexOf(room);
    const doors = this.doors.filter((d) => d.owner === 'us' && !d.broken && (d.a === ri || d.b === ri));
    if (!doors.length) return;
    const d = this.rng.pick(doors);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = d.x + dx, y = d.y + dy, i = idx(x, y);
      if (this.grid.room[i] !== ri || this.grid.tiles[i] !== T.FLOOR) continue;
      if ([...this.crew, ...this.mobs].some((a) => a.alive && Math.floor(a.x / TILE) === x && Math.floor(a.y / TILE) === y)) continue;
      this.orig.set(i, T.FLOOR); this.grid.tiles[i] = T.DEBRIS; this.grid.hp[i] = TILE_HP[T.DEBRIS]; this.grid.version++;
      this.fx({ t: 'boom', x: (x + .5) * TILE, y: (y + .5) * TILE, r: 24 });
      this.log('alert', `Wreckage blocks a door of the ${room.name}. Hold E on it to clear it.`);
      return;
    }
  }

  surrender(es, msg) {
    if (!es || es.done) return;
    es.done = true; es.surrendered = true;
    this.log('loot', `🏳 ${msg}`);
    for (const m of this.mobs) if (m.team === 'enemy' && this.onEnemyShip(es, m)) m.alive = false;
    for (const id of es.rooms) { const r = this.rooms[id]; for (let k = 0; k < 1 + (this.rng.chance(0.5) ? 1 : 0); k++) { const p = roomPoint(r, this.rng); this.objs.push({ id: uid(), kind: 'crate', x: p.x, y: p.y, owner: 'them' }); } }
    if (es.stolen) { const r = this.rooms[es.rooms[0]]; this.objs.push({ id: uid(), kind: 'crate', x: r.station.x + 40, y: r.station.y + 40, owner: 'them', gems: es.stolen }); }
    this.tip('loot', 'They gave up! Their ship is yours to loot: walk over and press E on the crates. When everyone is back aboard, the pilot undocks.');
  }

  destroyEnemyShip(es) {
    if (!es || es.done) return;
    es.done = true; es.destroyed = true;
    this.log('loot', `💥 ${es.name} is breaking apart! Everybody off it!`);
    this.fx({ t: 'shipdie' });
    for (const id of es.rooms) { const r = this.rooms[id]; const p = roomCenter(r); this.fx({ t: 'boom', x: p.x, y: p.y, r: 90 }); }
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
    for (const es of this.enemyShips) this.destroyEnemyShip(es);
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
function enemyLayout(kind, tier, rng, ourName, k = 0) {
  const prefix = ['The', 'Old', 'Big', 'Mean', 'Rusty', 'Black', 'Grim', 'Mad'][rng.int(0, 7)];
  const noun = ['Gnasher', 'Burrower', 'Mole King', 'Grinder', 'Tunnel Rat', 'Dirt Shark', 'Rockjaw', 'Gravedigger', 'Wormhole', 'Excavator', 'Skullbore', 'Mudlark'][rng.int(0, 11)];
  if (kind === 'pod') return { name: "Joe's Pod", rooms: [{ type: 'pod', name: "Joe's Pod", c: 0, r: 0, hp: 200 }], hull: 9999, bubble: 0, gunPeriod: 999, gunDmg: 0, missilePeriod: 999, missileDmg: 0, boarders: 0, wave: 0 };
  if (kind === 'derelict') return { name: "Joe's Ship (derelict)", rooms: [{ type: 'quarters', c: 0, r: 0 }, { type: 'bridge', c: 1, r: 0 }, { type: 'engine', c: 2, r: 0 }], airlock: 1, hull: 9999, bubble: 0, gunPeriod: 999, gunDmg: 0, missilePeriod: 999, missileDmg: 0, boarders: 0, wave: 0 };
  if (kind === 'boss') {
    return { name: 'The Leviathan\'s Hive', airlock: 1,
      rooms: [{ type: 'weapons', c: 0, r: 0 }, { type: 'quarters', c: 1, r: 0 }, { type: 'quarters', c: 2, r: 0 }, { type: 'shield', c: 3, r: 0 },
        { type: 'engine', c: 0, r: 1 }, { type: 'core', name: "Leviathan's Lair", c: 1, r: 1, hp: 500 }, { type: 'bridge', c: 2, r: 1 }, { type: 'quarters', c: 3, r: 1 }],
      hull: 2600, bubble: 4, gunPeriod: 4, gunDmg: 34, missilePeriod: 8, missileDmg: 55, boarders: 70, wave: 7 };
  }
  // all shapes and sizes: little raiders to big two-deck carriers, a bit random every time
  const TS = [1, 1.7, 2.7, 4, 5.6][tier];
  const cols = clamp(2 + rng.int(0, 1 + tier), 2, 5);
  const rows = tier >= 2 && rng.chance(0.25 + 0.15 * tier) ? 2 : 1;
  const must = ['bridge', 'weapons', 'quarters', 'engine', 'shield'];
  const total = cols * rows;
  const types = [...must.slice(0, Math.min(total, tier >= 1 ? 5 : 4))];
  while (types.length < total) types.push(rng.chance(0.55) ? 'quarters' : 'corridor');
  rng.shuffle(types);
  const rooms = types.map((t, i) => ({ type: t, c: i % cols, r: Math.floor(i / cols) }));
  const v = () => rng.range(0.85, 1.2);
  return {
    name: `${prefix} ${noun}`, rooms,
    hull: Math.round((130 + total * 36) * TS * v()),
    bubble: tier >= 1 ? Math.floor(tier / 1.5) + (rng.chance(0.3) ? 1 : 0) : 0,
    gunPeriod: (8.5 - 0.6 * tier) * v(), gunDmg: Math.round((3 + 3.4 * tier) * v()),
    missilePeriod: (16 - 1.4 * tier) * v(), missileDmg: Math.round((8 + 6 * tier) * v()),
    boarders: Math.round((10 + tier * 8 + total * 3) * rng.range(0.8, 1.25)), wave: 3 + tier + (total >= 6 ? 1 : 0),
  };
}

/** Creatures dig straight through the hull somewhere. */
function burrowIn(g, n) {
  const rooms = g.rooms.filter((r) => r.owner === 'us');
  const r = g.rng.pick(rooms);
  const creatures = g.roster.filter((x) => x.creature && x.tier <= g.tier + 1);
  if (!creatures.length) return;
  const walls = g.hullNear(r);
  let at = roomCenter(r);
  if (walls.length && !g.storyMode) {
    const w = g.rng.pick(walls); hitTile(g, w.x, w.y, 9999, { hull: true });
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.grid.get(w.x + dx, w.y + dy) === T.FLOOR) { at = { x: (w.x + dx + .5) * TILE, y: (w.y + dy + .5) * TILE }; break; }
  }
  for (let k = 0; k < n; k++) g.spawnMob(g.rng.pick(creatures).idx, at.x + g.rng.range(-20, 20), at.y + g.rng.range(-20, 20), { markable: false });
  g.log('alert', `♨ Creatures burst through the hull near the ${r.name}!`);
  g.fx({ t: 'alarm' });
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
        g.tip('feeders', 'Gems, ore and food rain into the ship while we drill (more of them in the Feeder Hall). Walk over them to grab them.');
      }
    },
  },
  descent: {
    update(g, dt) {
      if (g.storyOpen) return;
      const pilot = g.crew.find((c) => c.cls === 'pilot');
      const human = pilot && pilot.human && pilot.atHelm && pilot.alive ? g.inputs.get(pilot.id) || {} : null;
      descentTick(g, dt, human);
      const d = g.descent;
      if (d.stranded) {
        d.strandT = (d.strandT || 0) + dt;
        if (!g.crew.some((c) => c.human && c.alive) || (d.strandT > 20 && !pilot?.human)) COMMANDS.callFuel(g, pilot || g.crew[0], {});
        return;
      }
      // creatures dig in while we drill (more and more often, deeper down)
      if (d.progress > 0.12 && d.progress < 0.92 && g.level > 2 && (d.invasions || 0) < 1 + Math.floor(g.tier / 2)
        && g.rng.chance(dt * (0.004 + 0.004 * g.tier))) {
        d.invasions = (d.invasions || 0) + 1;
        burrowIn(g, 2 + g.tier + g.rng.int(0, 2));
      }
      // ambushes: ships find you mid-descent
      if (d.progress > 0.25 && d.progress < 0.85 && !d.ambushed && g.level > 1 && g.rng.chance(dt * (0.004 + 0.003 * g.tier))) {
        d.ambushed = true;
        g.resume = d;
        g.log('alert', '☠ Ambush! Ships cut across our tunnel!');
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
      if (g.discoveryAfter === 'ambush') { g.discoveryAfter = null; g.startEncounter('nest'); g.nest.waves = 1 + Math.floor(g.tier / 2); g.nest.left = g.nest.waves; }
      else if (g.phaseT > 0.5) g.startAftermath(true);
    },
  },
  encounter: { update: encounterTick },
  aftermath: {
    update(g) {
      if (g.storyOpen) return;
      const pilot = g.crew.find((c) => c.cls === 'pilot');
      if (!g.crew.some((c) => c.human) && g.phaseT > 3) { COMMANDS.continue(g, pilot || g.crew[0], { force: true }); return; }
      // a bot pilot gives everyone a minute to loot, then calls everyone back
      if (pilot && !pilot.human) {
        if (g.phaseT > 60 && !g.departSoon) { g.departSoon = true; say(g, pilot, 'Undocking in 15 seconds! Everybody back aboard!'); g.log('ship', `${pilot.name}: "Undocking in 15 seconds!"`); }
        if (g.phaseT > 75) COMMANDS.continue(g, pilot, { force: true });
      }
    },
  },
  port: {
    update(g) { if (!g.crew.some((c) => c.human) && g.phaseT > 3) COMMANDS.depart(g, g.crew[0], {}); },
  },
};

const onOurs = (g, m) => tileOwner(g, Math.floor(m.x / TILE), Math.floor(m.y / TILE)) === 'us';

function encounterTick(g, dt) {
  if (g.storyOpen) return;
  if (g.won) { if (g.time - g.wonAt > 3) g.endGame(); return; }
  const s = g.ship, ships = g.enemyShips;
  // backstop: nothing should drag on forever (the core boss excepted)
  if (g.phaseT > 300 + 60 * ships.length && !ships.some((x) => x.kind === 'boss' || x.kind === 'derelict')) {
    for (const m of g.mobs) if (m.team === 'enemy' && m.alive) { m.alive = false; g.fx({ t: 'poof', x: m.x, y: m.y }); }
    if (g.joe.mob?.alive && g.joe.state !== 'saved') { g.joe.state = 'saved'; g.log('loot', '♥ Joe makes a run for it and dives through our airlock!'); }
    for (const es of ships) if (!es.done) { es.done = true; es.fled = true; g.log('ship', `${es.name} breaks off and digs away.`); g.detachShip(es); }
    if (g.nest) g.nest.left = 0;
    return g.endEncounter(true);
  }
  // creature waves (nests, Joe's pod)
  if (g.nest) {
    const n = g.nest;
    n.waveT -= dt;
    if (n.waveT <= 0 && n.left > 0 && (!n.pod || ships[0]?.docked)) {
      n.left--; n.waveT = Math.max(4, 9 - g.tier);
      const creatures = g.roster.filter((x) => x.creature && x.tier <= g.tier + 1);
      const count = 3 + g.tier * 2 + (g.path === 'brother' ? 1 : 0) + Math.floor(g.crew.length / 4);
      if (n.pod) {
        for (let k = 0; k < count; k++) { const p = roomPoint(n.pod, g.rng); g.spawnMob(g.rng.pick(creatures).idx, p.x, p.y, { markable: false }); }
      } else burrowIn(g, count);
    }
    // Joe
    if (g.joe.mob) {
      const joe = g.joe.mob;
      if (joe.alive && !joe.following && g.crew.some((c) => c.alive && dist(c, joe) < 60)) { joe.following = true; g.fx({ t: 'say', id: joe.id, text: 'ZAP?! You CAME! Get me out of here!' }); g.log('story', 'Joe: "ZAP?! You came! I\'m right behind you!"'); }
      if (joe.alive && joe.following && onOurs(g, joe) && g.joe.state !== 'saved') {
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
  }
  if (!ships.length) return;

  // our escape: the pilot cuts the tunnels and runs (needs the bridge)
  if (g.fleeT > 0) {
    const bridge = g.rooms.find((r) => r.owner === 'us' && r.type === 'bridge');
    if (!bridge || bridge.sys.hp <= 0) { g.fleeT = 0; g.log('alert', 'The bridge is wrecked! The escape is off.'); }
    else {
      g.fleeT -= dt;
      if (g.fleeT <= 0) {
        g.weFled = true;
        for (const es of ships) if (!es.done && !es.gone) { es.done = true; es.fled = true; es.detachT = 0.5; }
        g.log('alert', 'We tore free of their clamps and ran for it!');
        g.fx({ t: 'shipdie' });
      }
    }
  }
  const pilot = g.crew.find((c) => c.cls === 'pilot');
  if (pilot && !pilot.human && !g.fleeT && !g.weFled && s.hull < s.hullMax * 0.18 && g.fightingShips.some((x) => x.kind === 'ship')) COMMANDS.flee(g, pilot, {});

  for (const es of ships) {
    if (es.gone) continue;
    if (!es.docked) { es.approachT -= dt; if (es.approachT <= 0) g.dockShip(es); continue; }
    if (es.detachT !== undefined) { es.detachT -= dt; if (es.detachT <= 0) { g.detachShip(es); continue; } }
    if (es.kind === 'derelict') {
      const journal = g.objs.find((o) => o.kind === 'journal');
      if (journal && !journal.read) {
        if (g.phaseT > 6 && !g.journalHint) { g.journalHint = true; g.log('story', "Joe's journal is on their bridge. Go read it (E)."); }
        if (!g.crew.some((c) => c.human) && g.phaseT > 10) g.readJournal(g.crew[0], journal);
      }
      if (g.derelictStage === 'changed' && !g.mobs.some((m) => m.alive && m.team === 'enemy')) { g.derelictStage = 'choice'; g.choosePath(); }
      continue;
    }
    if (es.kind === 'pod' || es.done) continue;
    shipFight(g, es, dt);
  }
  const fighting = g.fightingShips.filter((x) => x.kind === 'ship' || x.kind === 'boss');
  if (fighting.length) ourWeapons(g, fighting, dt);
  else s.missileTarget = null;

  // all of them beaten (or gone) and nobody left aboard: victory
  if (ships.every((x) => x.kind === 'derelict' || x.kind === 'pod') || g.boss?.alive) return;
  const pending = ships.some((x) => !x.done && !x.gone);
  if (pending) return;
  const aboard = g.mobs.filter((m) => m.alive && m.team === 'enemy' && onOurs(g, m));
  g.mopT = (g.mopT || 0) + dt;
  if (aboard.length && g.mopT > 60) for (const m of aboard) { m.alive = false; g.fx({ t: 'poof', x: m.x, y: m.y }); }
  if (!aboard.length || g.mopT > 60) g.endEncounter(true);
}

/** Our D-gun and D-missiles: they hit whatever room the weapons officer (or the pilot) picked. */
function ourWeapons(g, fighting, dt) {
  const s = g.ship;
  const wr = g.rooms.find((r) => r.owner === 'us' && r.type === 'weapons');
  if (!wr || wr.sys.hp <= 0) return;
  const eff = (r) => (r ? Math.max(0.3, r.sys.hp / r.sys.max) : 0);
  const valid = (i) => { const r = g.rooms[i]; return r && r.owner === 'them' && !r.gone && r.sys?.hp > 0 && fighting.some((x) => x.id === r.esId); };
  if (!valid(s.missileTarget)) s.missileTarget = pickMissileTarget(g);
  const target = g.rooms[s.missileTarget];
  const es = target ? fighting.find((x) => x.id === target.esId) : fighting[0];
  if (!es) return;
  const oc = s.overclock?.sys === 'weapons' ? 1.3 : 1;
  s.dgunT += dt * eff(wr) * oc;
  const gp = 5 / (1 + 0.15 * s.up.dgun);
  if (s.dgunT >= gp) {
    s.dgunT = 0;
    const dmg = 18 + 6 * s.up.dgun;
    if (es.bubble > 0) { es.bubble--; es.bubbleT = 0; g.fx({ t: 'dfire', who: 'us', w: 'gun', blocked: true, room: s.missileTarget }); }
    else { es.hull -= dmg; g.fx({ t: 'dfire', who: 'us', w: 'gun', dmg, room: s.missileTarget }); if (target) damageSystem(g, target, dmg * 0.6); }
  }
  const tech = g.crew.find((c) => c.cls === 'missiletech' && c.alive);
  const techHere = tech && g.rooms[roomAt(g, tech)] === wr;
  if (s.missiles > 0 && !s.missileReady) {
    s.missileT += dt * eff(wr) * oc * (techHere ? 1.6 : 1);
    if (s.missileT >= 9 / (1 + 0.1 * s.up.dmissile)) { s.missileReady = true; s.missileT = 0; if (tech?.human) g.fx({ t: 'text', x: wr.station.x, y: wr.station.y - 20, text: 'D-MISSILE READY', color: '#ff6a3a' }); }
  }
  // the officer fires by hand; if nobody does for a while, it goes on its own
  const officer = tech || g.crew.find((c) => c.cls === 'pilot');
  if (s.missileReady && (!officer || !officer.human || g.phaseT - (s.readyAt || 0) > 12)) fireMissile(g);
  if (s.missileReady && !s.readyAt) s.readyAt = g.phaseT;
}

/** One docked enemy ship's turn: its shields, its guns, its boarders, giving up or running. */
function shipFight(g, es, dt) {
  const s = g.ship;
  es.fightT = (es.fightT || 0) + dt;
  const mine = es.rooms.map((id) => g.rooms[id]);
  const theirs = (t) => mine.find((r) => r.type === t && r.sys.hp > 0);
  // missiles in flight
  for (const m of es.inbound) m.t -= dt;
  for (const m of es.inbound.filter((x) => x.t <= 0)) missileImpact(g, es, m);
  es.inbound = es.inbound.filter((x) => x.t > 0);
  // their bubble
  if (theirs('shield') && es.bubble < es.bubbleMax) { es.bubbleT += dt; if (es.bubbleT > 11) { es.bubbleT = 0; es.bubble++; } }
  // their D-weapons
  if (theirs('weapons')) {
    es.gunT += dt;
    if (es.gunT >= es.gunPeriod) {
      es.gunT = 0;
      if (s.evasiveT > 0) g.fx({ t: 'dfire', who: 'them', w: 'gun', miss: true, from: es.id });
      else if (s.bubble > 0) { s.bubble--; s.bubbleT = 0; g.fx({ t: 'dfire', who: 'them', w: 'gun', blocked: true, from: es.id }); }
      else {
        const r = enemyTarget(g);
        if (!g.storyMode) { s.hull -= es.gunDmg; if (r) damageSystem(g, r, es.gunDmg * 0.4); }
        g.fx({ t: 'dfire', who: 'them', w: 'gun', dmg: es.gunDmg, from: es.id, room: r ? g.rooms.indexOf(r) : null });
      }
    }
    es.missileT += dt;
    if (es.missileT >= es.missilePeriod) {
      es.missileT = 0;
      if (s.evasiveT > 0) { g.fx({ t: 'dfire', who: 'them', w: 'missile', miss: true, from: es.id }); g.log('ship', 'Evasive! Their D-missile sails past.'); }
      else enemyMissile(g, es);
    }
  }
  // boarders
  if (es.crewLeft > 0) {
    es.spawnT -= dt;
    const crowd = g.mobs.reduce((a, m) => a + (m.alive && m.team === 'enemy' ? 1 : 0), 0);
    if (es.spawnT <= 0 && crowd >= 55) es.spawnT = 1.5;   // the tunnels are jammed: wait a moment
    else if (es.spawnT <= 0) {
      es.spawnT = Math.max(2.5, 6.5 - g.tier * 0.7) * g.rng.range(0.8, 1.2);
      const q = mine.filter((r) => (r.type === 'quarters' || r.type === 'core') && r.sys.hp > 0);
      const from = q.length ? g.rng.pick(q) : mine[0];
      const n = Math.min(es.crewLeft, es.wave);
      for (let k = 0; k < n; k++) { const p = roomPoint(from, g.rng); g.spawnMob(g.pickType(), p.x, p.y, { esId: es.id }); }
      es.crewLeft -= n;
      if (q.length === 0) es.crewLeft = Math.max(0, es.crewLeft - 2); // no quarters = fewer reinforcements
    }
  }
  if (es.hull <= 0) { if (es.kind === 'boss') es.hull = 0; else { g.destroyEnemyShip(es); return; } }
  if (es.kind !== 'ship') return;
  // their whole crew is finished? they give up
  const theirCrew = g.mobs.filter((m) => m.alive && m.team === 'enemy' && m.esId === es.id);
  if (es.crewLeft <= 0 && !theirCrew.length) { g.surrender(es, `${es.name}'s crew is finished. The ship is ours to strip.`); return; }
  // out of boarders (or fighting too long)? they cut the tunnel and run. Not without a bridge, though.
  if (!theirs('bridge')) { es.fleeT = 0; return; }
  const boarding = theirCrew.some((m) => onOurs(g, m));
  if ((es.crewLeft <= 0 && !boarding) || es.fightT > 160) {
    es.fleeT = (es.fleeT || 0) + dt;
    if (es.fleeT > 6 && !es.fleeWarned) { es.fleeWarned = true; g.log('alert', `${es.name} is spinning up its drill to flee! Wreck its bridge or board it in the next 20s!`); }
    if (es.fleeT > 26) { es.done = true; es.fled = true; es.detachT = 0.6; g.log('ship', `${es.name} cut the tunnel and fled into the dirt.`); }
  } else if (es.fleeT) es.fleeT = Math.max(0, es.fleeT - dt);
}

/** Which of our rooms their gunners aim for: weapons, shields and engines first. */
function enemyTarget(g) {
  const ours = g.rooms.filter((r) => r.owner === 'us' && r.sys);
  if (!ours.length) return null;
  const w = { weapons: 3, shield: 3, engine: 2.5, bridge: 2, vault: 1.5 };
  const k = g.rng.weighted(Object.fromEntries(ours.map((r, i) => [i, w[r.type] || 1])));
  return ours[+k] || g.rng.pick(ours);
}

function fireMissile(g) {
  const s = g.ship;
  if (!s.missileReady || s.missiles <= 0) return;
  const target = s.missileTarget ?? pickMissileTarget(g);
  const r = g.rooms[target];
  const es = r && g.enemyShips.find((x) => x.id === r.esId && x.docked && !x.done);
  if (!es) return;
  s.missiles--; s.missileReady = false; s.missileT = 0; s.readyAt = 0;
  es.inbound.push({ t: 0.9, room: target });
  g.fx({ t: 'dfire', who: 'us', w: 'missile', room: target });
}

function missileImpact(g, es, m) {
  const s = g.ship;
  const r = g.rooms[m.room]; if (!r || r.gone) return;
  const tech = g.crew.find((c) => c.cls === 'missiletech');
  let dmg = (30 + 9 * s.up.dmissile) * (s.research.has('schematic') ? 1.5 : 1) * (s.research.has('guidance') ? 1.25 : 1) * (1 + 0.25 * (tech?.upgrades[0] || 0)) * (tech?.special ? 1.4 : 1);
  damageSystem(g, r, dmg);
  es.hull -= 22 + 7 * s.up.dmissile;
  const p = roomCenter(r);
  g.fx({ t: 'boom', x: p.x, y: p.y, r: 70 });
  explode(g, p.x, p.y, 70, 25, 'crew', tech, { kind: 'missile' });
  if (g.boss && g.boss.alive && r.type === 'core') damage(g, g.boss, dmg * 0.6, { owner: tech, kind: 'missile' });
  g.log('ship', `D-missile hits ${es.name}'s ${r.name}!`);
}

function enemyMissile(g, es) {
  const s = g.ship;
  const r = enemyTarget(g) || g.rng.pick(g.rooms.filter((x) => x.owner === 'us'));
  const already = r.sys && r.sys.hp < r.sys.max * 0.5;   // hitting a broken room again: likely fire
  if (!g.storyMode) { damageSystem(g, r, es.missileDmg); s.hull -= es.missileDmg * 0.5; }
  const p = roomCenter(r);
  g.fx({ t: 'dfire', who: 'them', w: 'missile', room: g.rooms.indexOf(r), from: es.id });
  g.fx({ t: 'boom', x: p.x, y: p.y, r: 70 });
  for (const c of g.crew) if (c.alive && g.rooms[roomAt(g, c)] === r) damage(g, c, 12 + g.tier * 4, { team: 'enemy', kind: 'missile' });
  if (!g.storyMode) {
    if (g.rng.chance(already ? 0.6 : 0.15)) igniteRoom(g, r, already ? 3 : 1);
    if (g.rng.chance(0.35)) { const walls = g.hullNear(r, 2); if (walls.length) { const w = g.rng.pick(walls); hitTile(g, w.x, w.y, 9999, { hull: true }); } }
  }
  g.log('alert', `${es.name}'s D-missile slams into our ${r.name}!`);
}

Game.prototype.endEncounter = function (win) {
  const ships = this.enemyShips || [];
  const tier = this.tier;
  const loot = { scrap: 20 + tier * 15, gems: 6 + tier * 6, money: 15 + tier * 12 };
  // every ship beaten pays; surrendered ones pay more, ones that got away less
  let mul = ships.length ? 0 : 1;
  for (const es of ships) mul += es.kind === 'derelict' || es.kind === 'pod' ? 0.6 : es.surrendered ? 1.5 : es.fled ? 0.5 : 1;
  if (this.weFled) mul = 0.2;
  loot.scrap *= mul; loot.money *= mul; loot.gems = Math.round(loot.gems * mul);
  if (ships.some((es) => es.kind === 'derelict' || es.kind === 'pod')) loot.gems = 0;
  this.ship.scrap += Math.round(loot.scrap);
  this.ship.gems = Math.min(this.ship.gemCap, this.ship.gems + loot.gems);
  for (const c of this.crew) c.wallet += Math.round(loot.money);
  this.ship.missiles = Math.min(this.ship.missilesMax, this.ship.missiles + 1);
  this.lastLoot = loot;
  this.lastLoot.fled = !!this.weFled;
  this.log('loot', `${this.weFled ? 'We got away.' : 'Victory!'} +${Math.round(loot.scrap)} scrap, +${loot.gems} gems, +${Math.round(loot.money)} each.`);
  if (!this.weFled && ships.some((es) => es.kind === 'ship' && (es.surrendered || es.destroyed)) && this.rng.chance(0.5)) this.pendingRecruit = true;
  this.fx({ t: 'victory' });
  this.startAftermath(!!this.resume);
};

Game.prototype.startAftermath = function (resumeAfter) {
  this.setPhase('aftermath');
  this.sealDoors(false);
  this.departSoon = false;
  this.departWarnT = 0;
  this.mopT = 0;
  this.afterResume = !!this.resume;
  const looted = (this.enemyShips || []).some((es) => !es.gone && es.surrendered);
  if (looted) this.log('ship', 'Their ship is ours to loot. Grab the crates (E). When everyone is back, the pilot undocks.');
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
      if (es) for (const id of es.rooms) { const r = g.rooms[id]; for (let k = 0; k < 3 + g.tier; k++) { const p = roomPoint(r, g.rng); g.spawnMob(changed.idx, p.x, p.y, { markable: false }); } }
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
  /** Undock and keep digging. Only the pilot gives the signal (a bot pilot does it when asked). */
  continue(g, c, cmd = {}) {
    if (g.phase !== 'aftermath') return;
    const bridge = g.rooms.find((r) => r.owner === 'us' && r.type === 'bridge');
    if (bridge && bridge.sys.hp <= 0) {
      g.log('alert', 'The bridge is wrecked. Repair it (hold E at the helm) before we can undock.');
      return { error: 'The bridge is wrecked' };
    }
    const pilot = g.crew.find((x) => x.cls === 'pilot');
    if (pilot && pilot.human && c !== pilot && !cmd.force) {
      g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'only the pilot can undock', color: '#ffb0a0' });
      g.log('ship', `${c.name} asks ${pilot.name} to undock.`);
      return { error: 'Only the pilot can undock' };
    }
    const away = g.crew.filter((x) => tileOwner(g, Math.floor(x.x / TILE), Math.floor(x.y / TILE)) === 'them');
    if (away.length && !cmd.force && !(g.departWarnT > 0)) {
      g.departWarnT = 12;
      g.log('alert', `⚠ ${away.map((x) => x.name).join(', ')} ${away.length > 1 ? 'are' : 'is'} still on the other ship! Signal again to undock anyway.`);
      if (pilot) say(g, pilot, 'Hold on, not everyone is back aboard!');
      return { warn: true };
    }
    if (away.length && pilot) {
      say(g, pilot, 'HAHAHAHA! Hold on to something!');
      g.log('ship', `${pilot.name} laughs, hits the recall clamp, and yanks ${away.map((x) => x.name).join(', ')} back aboard.`);
      g.fx({ t: 'laugh', id: pilot.id });
    }
    // whatever's left in the crates gets stripped on the way out
    for (const o of [...g.objs]) if (o.kind === 'crate') g.lootCrate(pilot || c, o);
    if (g.resume) { const d = g.resume; g.resume = null; g.cleanupEnemy(); g.afterFightRecruit(); g.descent = d; g.setPhase('descent'); g.fx({ t: 'dig' }); return; }
    g.nextLevel();
  },
  /** Pilot: cut the boarding tunnels and run (10s, needs the bridge). */
  flee(g, c) {
    if (g.phase !== 'encounter' || c.cls !== 'pilot' || g.fleeT > 0) return;
    if (!g.fightingShips.some((s) => s.kind === 'ship')) return;
    const bridge = g.rooms.find((r) => r.owner === 'us' && r.type === 'bridge');
    if (!bridge || bridge.sys.hp <= 0) { g.log('alert', 'The bridge is wrecked. There is no escaping like this.'); return { error: 'The bridge is wrecked' }; }
    g.fleeT = 10;
    g.log('alert', `${c.name}: "Cutting the tunnels! Ten seconds, hold them off!"`);
    say(g, c, 'Cutting the tunnels! Hold them off!');
  },
  /** Seal (or unseal) every door on the ship. */
  seal(g, c, cmd) {
    const on = cmd.on ?? !g.doorsSealed;
    g.sealDoors(!!on);
    g.log('ship', on ? `🔒 ${c.name} sealed every door. Boarders have to smash through.` : `🔓 ${c.name} unsealed the doors.`);
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
    c.wallet -= Math.ceil(n * g.port.fuelPrice); g.ship.fuel = Math.min(g.ship.fuelMax, g.ship.fuel + n);
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
    const lvl = s.up[cmd.id]; if (lvl >= SHIP_UP_MAX) return;
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
    const lvl = c.upgrades[k]; if (lvl >= CLASS_UP_MAX) return;
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
    const armory = g.rooms.find((r) => r.owner === 'us' && r.type === 'armory') || g.rooms.find((r) => r.owner === 'us');
    // anyone can pick it up and fire it; when it's empty it falls apart into 1 scrap
    dropPickup(g, armory.station.x + 30, armory.station.y + 40, 'gun', 1, c.upgrades[2]);
    g.log('ship', `${c.name} mashed broken parts into a makeshift gun. Anyone can grab it from the ${armory.name}.`);
  },
  spin(g, c) { if (c.cls === 'slots' && c.cd.f <= 0) { if (spinSlots(g, c) !== false) c.cd.f = 1.2; } },
  buyIntel(g, c) { if (c.cls === 'agent' && g.phase === 'port' && c.wallet >= 40) { c.wallet -= 40; c.missionRank = (c.missionRank || 0) + 1; g.log('loot', `${c.name} swapped "knowledge" with a contact at the bar. More targets next fight.`); g.markedBonus = (g.markedBonus || 0) + 1; } },
  pause(g, c, cmd) { g.paused = !!cmd.on; },
  release(g, c, cmd) { const i = c.monsters.findIndex((m) => m.type === cmd.type && !m.out); if (i >= 0) c.monsters.splice(i, 1); },
};
export { COMMANDS };

Game.prototype.endGame = function () {
  this.setPhase('ending');
  const lines = this.joe.state === 'saved' ? ENDINGS.brother : ENDINGS.easy;
  this.endLines = lines;
  this.fx({ t: 'ending', brother: this.joe.state === 'saved' });
};
