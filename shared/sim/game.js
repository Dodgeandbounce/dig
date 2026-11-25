// Do I Go? — the whole game simulation. Runs in the browser for solo play and
// can run on the server for multiplayer (inputs in, snapshots out).
import {
  T, TILE, TILE_HP, MAP_W, MAP_H, SLOT_W, SLOT_H, SHIP_COLS, SHIP_ROWS, SHIP_OX, SHIP_OY, ENEMY_OY, ENEMY_GAP, MAX_DOCKED,
  LEVELS, KM_PER_LEVEL, ROOMS, CLASSES, CLASS_ORDER, STARTER_CLASSES, BUYABLE_ROOMS, SHIP_UPGRADES, SHIP_UP_MAX, CLASS_UP_MAX,
  CLASS_UPGRADES, UPGRADE_BASE_COST, RECIPES, RESEARCH, NODE_TYPES, PORT_NAMES, PORT_FLAVOR, JOE_NOTES,
  TRANSPONDER_NOTE, JOURNAL_TEXT, BROTHER_NOTES, ENDINGS, AGENT_BRIEFS, CREW_HP_MUL, BLAST_DOOR_HP, RING,
  roomSize, BRIDGE_W, POWER_BASE, POWER_PER_CORE, POWER_SYS, POWER_DEFAULT, SHIP_GUNS, GUN_SLOTS, GEMS, xpCost, XP_JOIN_PER_LEVEL,
  EARLY_WARNINGS, TRANSPONDER_PILOT, HOARDER, BOSSES, EVENTS, CANDY, STARTER_MONSTERS, MISSION_PAPERS, THIEVES, DEATH_LINES, DISTRESS_LINES,
  ENEMY_CREW, ENEMY_CORE_CREW, ENEMY_EXTRA_CREW,
} from './data.js';
import { makeRng } from './rng.js';
import { Grid, idx, inMap, buildRooms, buildRing, addDoor, slotRect, stationPos, roomTiles, wallTilesOf, roomCenter, roomPoint, rw, rh } from './grid.js';
import { makeRoster, tierFor, levelMix, isGrunt } from './roster.js';
import {
  updateProjectiles, updatePickups, damage, hitTile, damageSystem, addMess, dropPickup, rainPickup, tickBuffs,
  addBuff, roomAt, tileOwner, healActor, explode, igniteRoom, updateFires, inOurBox, gainXp, addGems, gemType, buildAir, unstick,
} from './combat.js';
import { crewTick, interactTarget, say, spinSlots, quip, recalcCrewHp, autoSpendXp, ventTo } from './classes.js';
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

export const GAME_VERSION = 5;   // bump when saved games can't be loaded any more (map size, layout)

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
    this.soloLevel = this.rng.int(7, 21);   // the level where the Ship-Eater comes aboard alone
    this.bossKind = this.rng.pick(BOSSES).id; // what's waiting at the core this run
    this.candyT = 25;                        // next candy drop
    this.trader = null;                      // a trader alongside (random event)
    this.storyMode = playerClass === 'urchid';
    this.box = { x0: 0, y0: SHIP_OY, x1: MAP_W - 1, y1: MAP_H - 1 };   // our ship's bounds (tiles, outer hull included)
    this.enemyShips = [];

    this.ship = {
      name: (shipName || '').trim().slice(0, 32) || `The D-${this.rng.int(100, 999)}`,
      hull: 200, hullMax: 200, fuel: 100, fuelMax: 100, gems: 0, gemValue: 0, gemCap: 60, scrap: 40,
      food: { grub: 1, shroom: 1, fish: 0, spice: 0, crops: 0 },
      missiles: 3, missilesMax: 4,
      up: { plating: 0, bubble: 0, dgun: 0, dmissile: 0, drill: 0, feeders: 0, tank: 0 },
      bubble: 1, bubbleMax: 1, bubbleT: 0, dgunT: 0, missileT: 0, missileReady: false, missileTarget: null, evasiveT: 0,
      research: new Set(), researching: null,
      power: { cells: POWER_BASE, alloc: { ...POWER_DEFAULT } },
      guns: [{ id: 'dgun', t: 0 }], items: [], gunSlots: GUN_SLOTS,
      farm: { dirt: 0, plots: Array.from({ length: 8 }, () => ({ stage: 0, t: 0 })) },
      rooms: {}, buildT: 0,
    };
    this.ourRooms = START_LAYOUT.map((r) => ({ ...r }));
    // the Urchid gets an observatory lounge right behind the bridge (raised: it sees over everything)
    if (playerClass === 'urchid') this.ourRooms.push({ type: 'lounge', sx: 6, sy: 1 });
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
      cd: { fire: 0, q: 0, f: 0, r: 0, g: 0, rmb: 0, space: 0 }, buffs: [], facing: 0, aim: { x: 0, y: 0 },
      stunT: 0, slowT: 0, kills: 0, repairs: 0, monsters: [], summonIdx: 0, wiggle: [], bot: {},
      form: 'staff', jar: 'poison', mineType: 'proximity', missionRank: 0, carrying: 0,
      invuln: cls === 'urchid',
      xp: Math.round(Math.max(0, this.level - 1) * XP_JOIN_PER_LEVEL), xpEarned: 0, stam: 100, spawnPick: null,
    };
    c.baseHp = hp;
    this.crew.push(c);
    // the monster trainer never starts empty-handed (a player gets to pick: grass, fire, water or electric)
    if (cls === 'trainer') this.giveStarter(c, this.rng.pick(STARTER_MONSTERS).id, true);
    if (!c.human) autoSpendXp(this, c);
    return c;
  }
  /** Swap the trainer's starter pet. `auto`: a bot chose, so a player who takes over can still pick. */
  giveStarter(c, id, auto = false) {
    const ti = this.roster.findIndex((x) => x.starter === id);
    if (ti < 0) return;
    const old = c.monsters.find((m) => m.starter);
    if (old?.out) for (const m of this.mobs) if (m.alive && m.isMonster && m.ownerId === c.id && m.type === old.type) m.alive = false;
    c.monsters = c.monsters.filter((m) => !m.starter);
    const def = STARTER_MONSTERS.find((s) => s.id === id);
    c.monsters.unshift({ type: ti, name: def.name, out: false, reviveT: 0, hpMul: 1.3 + 0.14 * this.level, dmgMul: 1.15 + 0.09 * this.level, starter: id, elem: def.elem });
    c.starterAuto = auto;
  }

  ensureRoomFor(cls) {
    const type = CLASSES[cls].room;
    if (this.ourRooms.some((r) => r.type === type)) return true;
    // the observatory goes right behind the bridge, so the bridge is always in front of it (line of sight)
    const br = this.ourRooms.find((r) => r.type === 'bridge');
    const behind = type === 'lounge' && br && this.freeSlots(type).find((s) => s.sx === br.sx && s.sy === br.sy - 1);
    const slot = behind || this.freeSlotNear(type);
    if (!slot) return false;
    this.ourRooms.push({ type, sx: slot.sx, sy: slot.sy });
    this.layoutShip();
    return true;
  }

  /** Every slot a room covers (big rooms cover several). */
  slotsOf(r) { const [w, h] = roomSize(r.type); const out = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(`${r.sx + x},${r.sy + y}`); return out; }
  takenSlots() { return new Set(this.ourRooms.flatMap((r) => this.slotsOf(r))); }
  /** Top-left slots where a room of this type fits, touching the ship. */
  freeSlots(type = 'corridor') {
    const [w, h] = roomSize(type);
    const taken = this.takenSlots();
    const out = [], seen = new Set();
    const fits = (sx, sy) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const X = sx + x, Y = sy + y; if (X < 0 || Y < 0 || X >= SHIP_COLS || Y >= SHIP_ROWS || taken.has(`${X},${Y}`)) return false; } return true; };
    for (const k of taken) {
      const [tx, ty] = k.split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        // any placement of the footprint that covers the free neighbouring cell
        for (let oy = 0; oy < h; oy++) for (let ox = 0; ox < w; ox++) {
          const sx = tx + dx - ox, sy = ty + dy - oy, key = `${sx},${sy}`;
          if (seen.has(key)) continue;
          seen.add(key);
          if (fits(sx, sy)) out.push({ sx, sy });
        }
      }
    }
    return out;
  }
  freeSlotNear(type = 'corridor') {
    const free = this.freeSlots(type);
    if (!free.length) return null;
    // keep the ship compact: prefer spots with more neighbours, near the middle
    const taken = this.takenSlots();
    const [w, h] = roomSize(type);
    const score = (s) => {
      let n = 0;
      for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) { const edge = (x === -1 || x === w) !== (y === -1 || y === h); if (edge && taken.has(`${s.sx + x},${s.sy + y}`)) n++; }
      return n * 10 - Math.abs(s.sx + w / 2 - 5.5) - Math.abs(s.sy + h / 2 - 3) * 1.5 + this.rng() * 2;
    };
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
    const oldSys = new Map((this.rooms || []).filter((r) => r.owner === 'us').map((r) => [`${r.sx},${r.sy},${r.type}`, r]));
    this.grid.clearRegion(AX0, AY0, AX1, AY1);
    // keep only enemy-side doors (none at ports)
    this.doors = (this.doors || []).filter((d) => d.owner === 'them');
    const rooms = [];
    const make = (type, sx, sy, x0, y0, w, h, name) => {
      const def = ROOMS[type];
      const old = oldSys.get(`${sx},${sy},${type}`);
      const room = { type, name: name || def.name, owner: 'us', sx, sy, x0, y0, w, h, alive: true,
        sys: def.sys ? { type: def.sys, max: def.hp, hp: old?.sys ? old.sys.hp : def.hp } : null, reinforced: 0 };
      room.station = stationPos(room);
      rooms.push(room);
      return room;
    };
    for (const r of this.ourRooms) {
      const rect = slotRect(r.sx, r.sy);
      const [sw, sh] = roomSize(r.type);
      if (r.type === 'bridge') {
        // the pilot only needs the helm: a smaller bridge, and a short hallway beside it
        make('bridge', r.sx, r.sy, rect.x0, rect.y0, BRIDGE_W, SLOT_H);
        make('corridor', r.sx, r.sy, rect.x0 + BRIDGE_W, rect.y0, SLOT_W - BRIDGE_W, SLOT_H, 'Bridge Hall');
      } else make(r.type, r.sx, r.sy, rect.x0, rect.y0, SLOT_W * sw, SLOT_H * sh);
    }
    // enemy rooms (if any) keep their indices after ours
    const theirs = (this.rooms || []).filter((r) => r.owner === 'them');
    buildRooms(this.grid, rooms, 0, this.doors, 'us');
    // the walkway around the whole ship, with a door out of every room that touches it
    const ring = buildRing(this.grid, rooms, this.doors);
    this.addBlastDoors(ring);
    this.ringOuter = ring.outer;
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
    // air currents (the jorbal rides them): the whole ship flows to one or two spots (kept until the next dig)
    this.air = buildAir(this, this.rng, !this.air?.sinks?.length);
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
    sides.forEach(([find, orient], k) => {
      let run = null;
      for (const o of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) { run = find(o); if (run) break; }
      if (!run) return;
      // the tiles across the corridor work as one door (you shut or open the whole thing at once)
      for (const [x, y] of run) { const d = addDoor(G, this.doors, x, y, -1, -1, 'us', orient, BLAST_DOOR_HP); d.blast = true; d.hold = 'open'; d.open = 1; d.group = k; }
    });
  }

  /** Hull tiles of our ship near a room (for things that punch holes in it). */
  hullNear(room, reach = 7) {
    const c = roomCenter(room);
    const tx = c.x / TILE, ty = c.y / TILE;
    const near = (this.hullTiles || []).filter((i) => this.grid.tiles[i] === T.HULL && Math.abs((i % MAP_W) - tx) < rw(room) / 2 + reach && Math.abs(((i / MAP_W) | 0) - ty) < rh(room) / 2 + reach);
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
    s.farm.plots.length = Math.max(s.farm.plots.length, 8 + (this.crew?.find((c) => c.cls === 'farmer')?.upgrades[0] || 0));
    for (let k = 0; k < s.farm.plots.length; k++) s.farm.plots[k] ||= { stage: 0, t: 0 };
    // power cells: the base bank plus every Power Core that's still running
    const cores = this.rooms.filter((r) => r.owner === 'us' && r.type === 'power');
    s.power.cells = POWER_BASE + POWER_PER_CORE * cores.filter((r) => r.sys.hp > 0).length;
    trimPower(s);
    s.gunSlots = Math.min(RACK_MAX, GUN_SLOTS + Math.max(0, (counts.weapons || 0) - 1) + (s.rackUp || 0));
    while (s.guns.length > s.gunSlots) s.items.push({ id: s.guns.pop().id });
  }
  /** Cells handed out right now. */
  powerUsed() { return Object.values(this.ship.power.alloc).reduce((a, b) => a + b, 0); }
  pw(sys) { return this.ship.power.alloc[sys] || 0; }
  /** Chance an enemy D-shot misses: powered engines throw the ship around. */
  dodgeChance() {
    const eng = this.rooms.filter((r) => r.owner === 'us' && r.type === 'engine');
    const ok = eng.filter((r) => r.sys.hp > 0).length;
    if (!ok) return 0;
    return Math.min(0.4, 0.08 * this.pw('engine') * (ok / eng.length) * (1 + 0.15 * (ok - 1)));
  }
  workingEngines() { return this.rooms.filter((r) => r.owner === 'us' && r.type === 'engine' && r.sys.hp > 0).length; }

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
      // wild things (bugs crawling in through holes) attack everyone: us AND the boarders
      wild: !!(opts.wild ?? (ty.creature && opts.team !== 'crew')),
      // a third of the boarders smash walls on their way to our systems
      breaker: ty.role === 'carver' || ty.role === 'hoarder' || (!ty.creature && this.rng.chance(0.3)),
    };
    if (ty.hoarder) { m.hoarder = true; m.hp = m.maxHp = m.hp * (1 + 0.05 * this.level); m.fed = 0; }
    if (ty.thief) { m.thief = ty.thiefId; m.hacker = !!ty.hacker; }
    if (ty.event) m.event = ty.event;
    if (ty.officer) { m.officer = ty.officer; m.r = 11; }
    if (ty.walker) m.walker = true;
    if (m.team === 'enemy' && !m.boss && !m.wild && opts.markable !== false) {
      const agent = this.crew.find((c) => c.cls === 'agent');
      if (agent && this.markedLeft > 0 && !this.mobs.some((x) => x.alive && x.marked) && this.rng.chance(0.35)) { this.markedLeft--; this.markTarget(m, agent); }
    }
    this.mobs.push(m);
    return m;
  }
  /**
   * Agent 013's secret mission: a paper report slides in naming the mark. The agent can put on that
   * crew's uniform (a disguise) and an arrow points the way.
   */
  markTarget(m, agent) {
    agent ||= this.crew.find((c) => c.cls === 'agent');
    if (!agent || !m) return;
    m.marked = true; m.hp *= 1 + 0.1 * (agent.missionRank || 0); m.maxHp = m.hp;
    this.missionN = (this.missionN || 0) + 1;
    const ty = this.roster[m.type];
    this.mission = { id: this.missionN, target: m.id, name: ty.name, type: m.type, text: this.rng.pick(MISSION_PAPERS), brief: this.rng.pick(AGENT_BRIEFS), rank: agent.missionRank || 0 };
    this.fx({ t: 'mission', crew: agent.id, mission: this.mission });
    this.fx({ t: 'watch', crew: agent.id, text: this.mission.brief, target: ty.name });
    // a bot agent just suits up
    if (!agent.human) agent.disguise = m.type;
  }
  /** The mark is down (whoever got it): if there's anyone left worth marking, a new report comes in. */
  nextMark() {
    if ((this.missionChain = (this.missionChain || 0) + 1) > 6) return;
    const agent = this.crew.find((c) => c.cls === 'agent' && c.alive);
    if (!agent) return;
    const pool = this.mobs.filter((x) => x.alive && x.team === 'enemy' && !x.boss && !x.wild && !x.marked && !x.hoarder);
    if (!pool.length) return;
    this.markTarget(this.rng.pick(pool), agent);
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
    if (this.phase === 'ending') { this.time += dt; this.phaseT += dt; this.islandTick(dt); return; }
    if (this.phase === 'gameover') { this.time += dt; this.phaseT += dt; return; }
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

  /** Where someone can get back up: any crew quarters, or their own room. */
  spawnRooms(c) { return this.rooms.map((r, i) => i).filter((i) => { const r = this.rooms[i]; return r.owner === 'us' && (r.type === 'quarters' || r.type === CLASSES[c.cls].room); }); }
  respawn(c) {
    const opts = this.spawnRooms(c);
    const pick = opts.includes(c.spawnPick) ? c.spawnPick : opts[0];
    const r = this.rooms[pick] || this.rooms[0];
    const p = roomCenter(r);
    c.alive = true; c.hp = c.maxHp; c.x = p.x + this.rng.range(-20, 20); c.y = p.y + 16; c.stam = c.stamMax || 100; c.deadT = 0; c.dieLine = null;
    this.fx({ t: 'respawn', x: c.x, y: c.y });
  }

  updateDoors(dt) {
    for (const d of this.doors) {
      if (d.broken) continue;
      if (d.reinforced > 0) d.reinforced -= dt;
      let want = 0;
      const cx = (d.x + .5) * TILE, cy = (d.y + .5) * TILE;
      // hackers pop our doors open, sealed or not (blast doors are too old-school to hack)
      if (d.owner === 'us' && !d.blast && this.mobs.some((m) => m.alive && m.hacker && Math.abs(m.x - cx) < 46 && Math.abs(m.y - cy) < 46)) {
        if (d.sealed || d.hold === 'closed') { d.sealed = false; d.hold = null; this.grid.version++; this.fx({ t: 'text', x: cx, y: cy - 16, text: 'HACKED', color: '#60ff90' }); }
        want = 1;
      } else if (d.owner === 'them') {
        // their doors open for them; we have to smash through. Armoured vault doors never open: C4 only.
        if (!d.armored) for (const m of this.mobs) if (m.alive && m.team === 'enemy' && Math.abs(m.x - cx) < 46 && Math.abs(m.y - cy) < 46) { want = 1; break; }
      } else if (d.sealed) want = 0;
      else if (d.hold === 'open') want = 1;            // propped open: anyone can walk through, them too
      else if (d.hold !== 'closed') {
        for (const c of this.crew) if (c.alive && Math.abs(c.x - cx) < 62 && Math.abs(c.y - cy) < 62) { want = 1; break; }
        if (!want) for (const m of this.mobs) if (m.alive && m.team === 'crew' && Math.abs(m.x - cx) < 56 && Math.abs(m.y - cy) < 56) { want = 1; break; }
      }
      d.want = want;
    }
    // both leaves of a double door move as one: they part in the middle and slide off to the sides
    const pairWant = new Map();
    for (const d of this.doors) if (d.pair != null && !d.broken && d.want) pairWant.set(d.pair, 1);
    for (const d of this.doors) {
      if (d.broken) continue;
      const want = d.want || (d.pair != null && pairWant.get(d.pair)) ? 1 : 0;
      // snappy: open in about a third of a second, close a bit slower (blast doors are heavier)
      d.open = clamp(d.open + (want ? dt / (d.blast ? 0.7 : 0.32) : -dt / (d.blast ? 1.1 : 0.6)), 0, 1);
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
        if (!calm && creatures.length && this.mobs.length < 80 && this.rng.chance(0.008 * (1 + this.tier * 1.3) * (this.phase === 'encounter' ? 1.6 : 1))) {
          const type = this.rng.pick(creatures);
          this.spawnMob(type.idx, (inside[0] + .5) * TILE, (inside[1] + .5) * TILE, { markable: false, wild: true });
          if (this.time - (this.crawlLogAt || -99) > 12) { this.crawlLogAt = this.time; this.log('alert', `A ${type.name} crawled in through a hull breach! Bugs attack everyone, boarders too. Patch those holes.`); }
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
      this.autoPower();
      // bots spend their XP as they earn it; players get told when a star is ready
      for (const c of this.crew) { if (!c.human) autoSpendXp(this, c); else if (c.cls !== 'urchid' && !c.starHint && [0, 1, 2].some((k) => c.upgrades[k] < CLASS_UP_MAX && c.xp >= xpCost(c.upgrades[k]))) { c.starHint = true; this.fx({ t: 'text', x: c.x, y: c.y - 34, text: '★ upgrade ready (Tab)', color: '#7cc8ff' }); } }
    }
    // bubble defense recharges while the generator is up
    const gen = this.rooms.find((r) => r.owner === 'us' && r.type === 'shield');
    if (gen && gen.sys.hp > 0 && s.bubble < s.bubbleMax) {
      s.bubbleT += dt * (s.research.has('harmonics') ? 2 : 1) * [0, 1, 1.6, 2.2][this.pw('shield')] * (gen.sys.hp / gen.sys.max);
      if (s.bubbleT >= 9) { s.bubbleT = 0; s.bubble++; }
    }
    // missiles being built
    if (s.buildT > 0) { s.buildT -= dt; if (s.buildT <= 0) { s.missiles = Math.min(s.missilesMax, s.missiles + 1); this.log('ship', 'A D-missile is ready in the rack.'); } }
    // farm grows
    const farm = this.rooms.find((r) => r.owner === 'us' && r.type === 'farm');
    if (farm && farm.sys.hp > 0) {
      const farmer = this.crew.find((c) => c.cls === 'farmer');
      for (const p of s.farm.plots) if (p.stage > 0 && p.stage < 3) {
        // watered plots grow twice as fast (the water soaks in by the next stage)
        p.t += dt * (1 + 0.3 * (farmer?.upgrades[0] || 0)) * (p.wet ? 2 : 1);
        if (p.t >= 20) { p.t = 0; p.stage++; p.wet = false; }
      }
    }
    extrasTick(this, dt);   // candy, random events, the trader, the virus
  }

  researchTick(c, dt) {
    const s = this.ship, r = s.researching;
    if (!r) return;
    const lab = this.rooms.find((x) => x.owner === 'us' && x.type === 'lab');
    if (!lab || lab.sys.hp <= 0) return;
    r.progress += dt * (1 + 0.3 * c.upgrades[0]) * (c.special ? 1.4 : 1) * (0.6 + 0.4 * this.pw('systems'));
    gainXp(this, c, dt * 0.9);
    if (r.progress >= r.time) {
      s.research.add(r.id); s.researching = null;
      const def = RESEARCH.find((x) => x.id === r.id);
      this.log('loot', `🔬 Research complete: ${def.name}. ${def.desc}`);
      say(this, c, 'EUREKA! Peer review can bite me.');
      gainXp(this, c, 50);
    }
  }

  serveMeal(chef, cooking) {
    const rec = RECIPES.find((r) => r.id === cooking.recipe);
    const lvl = chef.upgrades[0];
    const dur = rec.dur * (1 + 0.2 * lvl);
    // better food heals more; better (powered) galley gear heals more again
    const heal = rec.heal * (1 + 0.35 * this.pw('kitchen')) * (1 + 0.1 * lvl) * (chef.special ? 1.4 : 1);
    const targets = this.crew.filter((c) => c.alive && c.cls !== 'urchid' && (cooking.target === 'all' || c.cls === cooking.target));
    for (const c of targets) {
      // side effects stack separately so they show up as their own line
      addBuff(c, rec.buff, dur * (cooking.target === 'all' ? 1 : 1.5), 'meal');
      if (Object.keys(rec.side).length) addBuff(c, rec.side, dur, 'mealside');
      if (rec.buff.special) c.special = true; else c.special = false;
      const h = heal * (cooking.target === 'all' ? 1 : 1.5);
      healActor(c, h);
      this.fx({ t: 'meal', x: c.x, y: c.y, crew: c.id, name: rec.name, heal: Math.round(h) });
    }
    this.stats.meals++;
    gainXp(this, chef, 8 + 2 * targets.length);
    this.log('ship', `🍲 ${chef.name} teleported ${rec.name} to ${cooking.target === 'all' ? 'the whole crew' : CLASSES[cooking.target]?.name} (+${Math.round(heal)} HP each).`);
  }

  // -------------------------------------------------------------------------
  // phases
  setPhase(p) { this.phase = p; this.phaseT = 0; this.fx({ t: 'phase', phase: p }); }

  startBriefing() {
    this.levelDone = false;
    // once a run, the whole "enemy mix" is a single thing: 100%
    const hoarder = this.roster.find((x) => x.hoarder);
    this.mix = this.level === this.soloLevel && hoarder && this.level < LEVELS ? Object.assign([{ type: hoarder.idx, pct: 100 }], { solo: true })
      : levelMix(this.roster, this.level, this.path, this.rng);
    this.descent = newDescent();
    this.drops = 0;                           // feeder drops so far this level (there's a limit)
    // something might happen on the way down this layer (likelier, and nastier, the deeper we go)
    this.eventAt = this.level > 1 && this.rng.chance(0.65 + 0.012 * this.level) ? this.rng.range(0.15, 0.6) : null;
    this.eventsThisLayer = 0;
    // the air currents settle into new paths for the dig
    this.air = buildAir(this, this.rng);
    this.setPhase('briefing');
    this.log('story', `-${this.depthKm}km below Sea Level`);
    for (const c of this.crew) if (c.atHelm) c.atHelm = false;
    if (this.level === this.transponderLevel && !this.joe.transponder) {
      this.joe.transponder = true;
      this.story({ title: 'A message pod hits the hull', lines: [TRANSPONDER_NOTE + this.transponderCode, TRANSPONDER_PILOT], kind: 'note', after: null });
    }
    // early warnings: it was easy at first...
    for (const w of EARLY_WARNINGS) if (w.level === this.level) {
      if (w.lines) this.story({ title: w.title, lines: w.lines, kind: 'note' });
      else this.log('story', w.log);
    }
    if (this.mix.solo) this.log('alert', '⚠ Enemy mix: 100%. Just one. Something very big is digging toward us.');
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
    this.clearEventMobs();
    this.afterFightRecruit();
    this.level++;
    for (const c of this.crew) gainXp(this, c, 24);   // made it another layer down
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
    for (let k = 0; k < 8 + this.tier * 3; k++) { const r = this.rng.pick(this.rooms.filter((x) => x.owner === 'us')); const p = roomPoint(r, this.rng); const gem = this.rng.chance(0.7); rainPickup(this, p.x, p.y, gem ? 'gem' : 'ore', 1, gem ? gemType(this) : undefined); }
    if (reward) { this.applyReward(reward.reward); lines.push(`(${reward.rewardText})`); }
    this.story({ title: this.path === 'brother' ? "A page from Joe's journal" : 'A note from Joe', lines, kind: 'note',
      after: this.rng.chance(0.35 + this.tier * 0.1) ? 'ambush' : 'aftermath' });
  }

  applyReward(r) {
    const s = this.ship;
    if (r.scrap) s.scrap += r.scrap;
    if (r.money) for (const c of this.crew) c.wallet += r.money;
    if (r.upgrade) { s.up[r.upgrade] = Math.min(SHIP_UP_MAX, s.up[r.upgrade] + 1); this.recalcShip(); }
    if (r.room) { const slot = this.freeSlotNear(r.room); if (slot) { this.ourRooms.push({ type: r.room, sx: slot.sx, sy: slot.sy }); this.layoutShip(); } }
  }

  // -------------------------------------------------------------------------
  // ports
  /** Whatever the random events let in scurries back into the dirt when we dock somewhere safe. */
  clearEventMobs() {
    let n = 0;
    for (const m of this.mobs) if (m.alive && m.team === 'enemy' && (m.event || m.wild)) { m.alive = false; n++; }
    if (n) this.log('ship', `The last ${n} pests scurry back out into the dirt.`);
    this.trader = null;
  }
  startPort(kind) {
    this.cleanupEnemy();
    this.clearEventMobs();
    this.lastPortLevel = this.level;
    this.setPhase('port');
    const name = this.rng.pick(PORT_NAMES);
    const full = kind === 'port' || kind === 'city';
    this.port = {
      kind, name: kind === 'fuel' ? `${name} Fuel Depot` : kind === 'repair' ? `${name} Repair Dock` : kind === 'city' ? `Deep City of ${name}` : name,
      flavor: this.rng.pick(PORT_FLAVOR),
      gemPrice: Math.round((1.4 + 0.5 * this.tier + (kind === 'city' ? 0.6 : 0)) * 10) / 10,   // per point of gem value
      guns: this.rng.shuffle(Object.keys(SHIP_GUNS).filter((k) => k !== 'dgun' && !SHIP_GUNS[k].trader)).slice(0, 2),
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
    }
    // with nobody else to do it, the bots chip in for the ship (personal upgrades come from XP now)
    if (noHumans) for (let round = 0; round < 3; round++) for (const id of ['plating', 'bubble', 'dgun', 'dmissile', 'drill']) {
      const lvl = s.up[id]; const cost = SHIP_UPGRADES[id].cost * (lvl + 1);
      const payer = [...bots].sort((a, b) => b.wallet - a.wallet).find((c) => c.wallet >= cost + 20);
      if (payer && lvl < SHIP_UP_MAX) { payer.wallet -= cost; s.up[id]++; this.recalcShip(); }
    }
    if (noHumans && this.port?.rooms && this.level >= 8 && !this.ourRooms.some((r) => r.type === 'power')) {
      const payer = [...bots].sort((a, b) => b.wallet - a.wallet)[0];
      if (payer?.wallet >= 170) COMMANDS.buyRoom(this, payer, { type: 'power' });
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
  startEncounter(kind, opts = {}) {
    this.cleanupEnemy();
    this.setPhase('encounter');
    const tier = Math.min(4, this.tier + (opts.harder ? 1 : 0));
    const rng = this.rng;
    this.markedLeft = 1 + (this.crew.find((c) => c.cls === 'agent')?.upgrades[2] || 0) + (this.markedBonus || 0);
    this.mission = null; this.missionChain = 0;
    for (const c of this.crew) c.disguise = null;
    // the air currents shift with every docking (same spots they flow to, new paths)
    this.air = buildAir(this, rng, false);
    this.weFled = false; this.fleeT = 0;
    const noHumans = !this.crew.some((c) => c.human);
    // (there's only ever one Ship-Eater: anything else that turns up on its layer is the normal crowd)
    if (this.mix?.solo && this.hoarderSeen) this.mix = levelMix(this.roster, this.level, this.path, this.rng);
    // the Ship-Eater: one ship, one passenger
    if (kind === 'ship' && this.mix?.solo && !this.hoarderSeen) {
      this.hoarderSeen = true;
      const layout = enemyLayout('ship', tier, rng, this.ship.name, 0);
      layout.name = 'The Ship-Eater\'s Shell'; layout.boarders = 1; layout.wave = 1; layout.solo = true;
      if (!this.planEnemyShip(layout, 'ship', rng.range(6, 8))) {
        // nowhere for its shell to dock: it doesn't need one. It digs straight through our hull.
        const at = this.burrowPoint();
        const m = this.spawnMob(this.roster.findIndex((x) => x.hoarder), at.x, at.y, {});
        this.fx({ t: 'boom', x: at.x, y: at.y, r: 60 });
        this.nest = { waves: 0, waveT: 99, left: 0, eater: m.id };
      }
      if (noHumans) this.sealDoors(true);
      this.log('alert', '☠ One ship. One passenger. 100%. THE SHIP-EATER. It chews through walls and swallows whole rooms, ours or anybody\'s. Everybody on it!');
      this.fx({ t: 'mainevent', name: HOARDER.name });
      return;
    }

    if (kind === 'nest') {
      this.nest = { waves: 4 + tier * 2, waveT: 2, left: 4 + tier * 2 };
      this.log('alert', '♨ Creatures! They\'re burrowing into the hull!');
      if (noHumans) this.sealDoors(true);
      return;
    }
    // a swarm: ships packed to the rafters with one kind of thing (the stork armada, a pirate raid)
    if (kind === 'ship' && opts.swarm) {
      const sw = opts.swarm;
      let delay = rng.range(5, 7);
      for (let k = 0; k < sw.ships; k++) {
        const layout = enemyLayout('ship', Math.min(tier, 2), rng, this.ship.name, k, this.level);
        layout.name = sw.names[k % sw.names.length];
        layout.boardType = sw.type; layout.swarm = true;
        layout.rooms.forEach((r) => { if (!['bridge', 'weapons'].includes(r.type) && !r.thin) r.type = 'quarters'; });
        layout.boarders = Math.round(sw.each * (0.8 + 0.07 * this.crew.length)); layout.wave = sw.wave;
        layout.hull = Math.round(layout.hull * 0.6); layout.guns = []; layout.bubble = 0;
        layout.gunPeriod *= 1.6; layout.missilePeriod *= 2;
        if (!this.planEnemyShip(layout, 'ship', delay)) break;
        delay += rng.range(5, 9);
      }
      if (!this.enemyShips.length) { eventSpawn(this, 'stork', sw.each); return; }
      if (noHumans) this.sealDoors(true);
      this.log('alert', sw.msg(this.enemyShips.length));
      return;
    }
    // how many ships come for us: one up top, up to four deep down
    let n = 1;
    if (kind === 'ship') {
      n = [1 + (this.level >= 4 && rng.chance(0.25) ? 1 : 0), 1 + (rng.chance(0.5) ? 1 : 0), 2 + (rng.chance(0.35) ? 1 : 0), 2 + (rng.chance(0.65) ? 1 : 0), 3 + (rng.chance(0.55) ? 1 : 0)][tier];
      if (this.path === 'brother' && rng.chance(0.4)) n++;
      if (opts.harder) n++;
      // the closer to the core, the more of them; a big ship has room for more to latch on
      if (this.level >= 18 && rng.chance(0.5)) n++;
      if (this.level >= 25 && rng.chance(0.5)) n++;
      const room = this.ourRooms.length >= 22 ? 6 : this.ourRooms.length >= 16 ? 5 : 4;
      n = Math.min(MAX_DOCKED, room, n);
    }
    let delay = kind === 'ship' ? rng.range(6, 8) : 4;
    for (let k = 0; k < n; k++) {
      const layout = enemyLayout(kind, tier, rng, this.ship.name, k, this.level);
      if (this.path === 'brother' && kind === 'ship') layout.boarders = Math.round(layout.boarders * 1.3);
      if (opts.harder) { layout.boarders = Math.round(layout.boarders * 1.3); layout.hull = Math.round(layout.hull * 1.3); layout.name = 'The Huge ' + layout.name.replace(/^(The|Big) /, ''); }
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
    // no room for anyone to dock (the ship is huge): they send their crews down the tunnels instead
    if (!this.enemyShips.length && kind === 'ship') {
      this.log('alert', '☠ No room to dock, so they dig in! Boarders are burrowing through the hull!');
      const waves = 3 + tier;
      this.nest = { waves, waveT: 3, left: waves, boarders: true };
      if (noHumans) this.sealDoors(true);
      return;
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
    const B = this.box;
    const taken = this.enemyShips.filter((s) => !s.gone).map((s) => s.rect);
    const overlaps = (r) => taken.some((t) => r.x0 < t.x0 + t.w + 2 && t.x0 < r.x0 + r.w + 2 && r.y0 < t.y0 + t.h + 2 && t.y0 < r.y0 + r.h + 2);
    const mid = Math.round((B.x0 + B.x1) / 2);
    let cols, rows, w, h, spots;
    // our ship grows until there's no room above or below it for a tall ship: then the ship that
    // comes is a lower one (its bottom deck stays home), and the tunnel gets shorter
    for (let attempt = 0; ; attempt++) {
      cols = Math.max(...layout.rooms.map((r) => r.c + (r.cw || 1)));
      rows = Math.max(...layout.rooms.map((r) => r.r + (r.rh || 1)));
      w = cols * SLOT_W + 1; h = rows * SLOT_H + 1;
      spots = [];
      for (const gap of [ENEMY_GAP, 3]) {
        const topY = B.y0 - gap - h, botY = B.y1 + gap + 1;
        for (const side of ['top', 'bottom']) {
          const y0 = side === 'top' ? topY : botY;
          if (y0 < ENEMY_OY || y0 + h > MAP_H - 2) continue;
          const xs = [mid - (w >> 1), B.x0 - 4, B.x1 - w + 4, mid - w - 2, mid + 2, B.x0 + 6, B.x1 - w - 6];
          for (let x = 2; x + w < MAP_W - 2; x += 5) xs.push(x);   // (deep down, six can crowd in)
          for (const x0 of xs) {
            const r = { x0: clamp(x0, 2, MAP_W - w - 2), y0, w, h };
            if (!overlaps(r)) spots.push({ side, rect: r });
          }
        }
        if (spots.length) break;
      }
      if (spots.length || rows <= 1 || attempt > 3) break;
      trimLayout(layout, rows - 1);
    }
    if (!spots.length) return null;
    // from above or below (toward the core), wherever there's room. The first one lines up with the middle.
    const pick = this.enemyShips.length === 0 ? (this.rng.chance(0.5) ? spots[0] : spots.find((s) => s.side === 'bottom') || spots[0]) : this.rng.pick(spots);
    const es = {
      id: uid(), kind, name: layout.name, layout, side: pick.side, rect: pick.rect, cols, rows,
      shape: layout.rooms.map((r) => ({ c: r.c, r: r.r, cw: r.cw || 1, rh: r.rh || 1, thin: r.thin || null })),   // (for drawing it on the way in)
      approachT: approach, approachMax: approach, docked: false,
      rooms: [], tunnel: [], dock: null, airlock: null,
      hull: layout.hull, hullMax: layout.hull, bubble: layout.bubble, bubbleMax: layout.bubble, bubbleT: 0,
      gunT: this.rng.range(0, 2), gunPeriod: layout.gunPeriod, gunDmg: layout.gunDmg, missileT: 0, missilePeriod: layout.missilePeriod, missileDmg: layout.missileDmg,
      crewLeft: layout.boarders, spawnT: 2, wave: layout.wave, done: false, stolen: 0, surrendered: false, inbound: [],
      guns: (layout.guns || []).map((id) => ({ id, t: this.rng.range(0, 3), on: true })), rerouteT: 0,
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
      // thin hallways sit in the middle of their slot, two tiles across
      const thin = lr.thin;
      const x0 = R.x0 + lr.c * SLOT_W + (thin === 'v' ? 3 : 0), y0 = R.y0 + lr.r * SLOT_H + (thin === 'h' ? 2 : 0);
      const w = thin === 'v' ? 3 : SLOT_W * (lr.cw || 1), h = thin === 'h' ? 3 : SLOT_H * (lr.rh || 1);
      const room = { type: lr.type, name: lr.name || (thin ? 'Crawlway' : def.name) || lr.type, owner: 'them', esId: es.id, x0, y0, w, h, alive: true, reinforced: 0,
        sys: lr.type === 'corridor' ? null : { type: lr.type, max: Math.round((lr.hp || def.hp || 80) * 1.3 * (1 + 0.6 * tier)), hp: 0 }, c: lr.c, r: lr.r, cw: lr.cw || 1, rh: lr.rh || 1, thin };
      if (room.sys) room.sys.hp = room.sys.max;
      room.station = stationPos(room);
      return room;
    });
    buildRooms(this.grid, rooms, base, this.doors, 'them');
    this.rooms.push(...rooms);
    // airlock on the side facing us (a proper room, not a crawlway)
    const dir = es.side === 'top' ? 1 : -1;
    const facing = rooms.filter((r) => !r.thin && (es.side === 'top' ? r.r + r.rh === es.rows : r.r === 0));
    const airCol = layout.airlock ?? Math.floor(es.cols / 2);
    const airRoom = facing.find((r) => r.c <= airCol && airCol < r.c + r.cw) || facing[0] || rooms[0];
    const ax = airRoom.x0 + Math.min(rw(airRoom) - 2, 5), ay = es.side === 'top' ? airRoom.y0 + rh(airRoom) : airRoom.y0;
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

    // once there's an agent with C4 aboard, their ships start keeping a vault behind armoured doors that
    // only C4 can open. The loot inside is heavy: the chameleon can vent in and out, but can't carry it.
    if (kind === 'ship' && !layout.solo && !layout.swarm && this.crew.some((c) => c.cls === 'agent') && this.rng.chance(0.4 + 0.12 * tier)) {
      const cand = rooms.filter((r) => !r.thin && r !== airRoom && !['bridge', 'weapons', 'engine', 'shield'].includes(r.type));
      const v = cand.length ? this.rng.pick(cand) : null;
      if (v) {
        const vi = this.rooms.indexOf(v);
        Object.assign(v, { type: 'vault', name: 'Their Vault', vault: true });
        v.sys = { type: 'vault', max: Math.round(160 * (1 + 0.6 * tier)), hp: Math.round(160 * (1 + 0.6 * tier)) };
        for (const d of this.doors) if (d.owner === 'them' && (d.a === vi || d.b === vi)) { d.armored = true; d.hp = d.maxHp = 700; }
        for (let k = 0; k < 2 + (tier >= 2 ? 1 : 0); k++) { const q = roomPoint(v, this.rng); this.objs.push({ id: uid(), kind: 'crate', heavy: true, x: q.x, y: q.y, owner: 'them', gems: 10 + tier * 8, gemVal: Math.round((10 + tier * 8) * (2 + tier)), scrap: 15 + tier * 10 }); }
        this.log('alert', `🔒 ${es.name} has a VAULT behind armoured doors. Only C4 gets through.`);
      }
    }
    // defenders, decorations, crates
    for (const r of rooms) {
      const p = roomCenter(r);
      if ((kind === 'ship' || kind === 'boss') && !layout.solo && !layout.swarm) {
        // (their officers man the stations now; a few hired guns stand with them deeper down)
        const n = r.type === 'bridge' ? (tier >= 3 ? 1 : 0) : r.type === 'weapons' ? Math.floor(tier / 2) : r.type === 'shield' && tier >= 3 ? 1 : 0;
        for (let k = 0; k < n; k++) this.spawnMob(this.pickType(true), p.x - 40 + k * 40, p.y, { defender: true, esId: es.id });
      }
      if (kind === 'derelict') {
        for (let k = 0; k < 2; k++) { const q = roomPoint(r, this.rng); this.objs.push({ id: uid(), kind: 'skeleton', x: q.x, y: q.y, a: this.rng() * 6 }); }
        this.objs.push({ id: uid(), kind: 'crate', x: (r.x0 + rw(r) - 2.5) * TILE, y: (r.y0 + rh(r) - 2.5) * TILE, owner: 'them' });
        if (r.type === 'bridge') this.objs.push({ id: uid(), kind: 'journal', x: p.x, y: p.y, owner: 'them' });
      }
      if (kind === 'pod') {
        const joe = this.spawnMob(this.roster.findIndex((x) => x.creature), p.x, p.y, { team: 'crew', markable: false });
        Object.assign(joe, { isJoe: true, name: 'Joe', hp: 450, maxHp: 450, speed: 150, r: 11, following: false, atkT: 0, armor: 0.3 });
        this.joe.mob = joe;
        this.nest = { waves: 5 + tier, waveT: 4, left: 5 + tier, pod: r };
      }
      if (kind === 'boss' && r.type === 'core') {
        const bi = this.roster.findIndex((x) => x.boss && x.bossId === this.bossKind);
        const walker = this.roster[bi].walker;
        // the Leviathan doesn't wait in its lair: it climbs out and walks straight through everything
        const boss = this.spawnMob(bi, p.x, p.y, { defender: !walker, esId: es.id });
        boss.r = walker ? 40 : 34; boss.hp = boss.maxHp = this.roster[bi].hp * (this.path === 'brother' ? 1.3 : 1) * (1 + 0.15 * Math.max(0, this.humanCount() - 1));
        this.boss = boss;
        if (walker) this.log('alert', '☠ THE LEVIATHAN is climbing out of its hive. It is walking straight at us. Through the walls.');
      }
    }
    if (kind === 'ship' && !layout.solo && !layout.swarm) this.crewEnemyShip(es, rooms);
    if (this.crew.some((c) => c.cls === 'chameleon')) this.addVents(rooms, 'them');
    this.air = buildAir(this, this.rng, false);   // the docking stirs up the air (and it reaches into their ship now)
    if (kind === 'ship') {
      this.log('alert', `☠ ${es.name} has docked and blown a hole in our hull!`);
      const talkers = this.rng.shuffle(this.crew.filter((c) => c.alive)).slice(0, 2);
      for (const c of talkers) quip(this, c, 'dock', true);
    }
  }

  /**
   * Their crew: a pilot on the bridge, an engineer in the engine room, a missile tech on the guns, a
   * scientist on the bubbles (if they have those rooms), and the bigger the ship, the more extras.
   */
  crewEnemyShip(es, rooms) {
    const rng = this.rng, tier = this.tier;
    const real = rooms.filter((r) => !r.thin);
    const has = (t) => real.find((r) => r.type === t);
    const jobs = ENEMY_CORE_CREW.filter((cls) => cls === 'pilot' || has(ENEMY_CREW[cls].post));
    const extras = clamp(Math.floor((real.length - 4) / 2) + Math.floor(tier / 2) + rng.int(0, 1), 0, 4);
    const pool = ENEMY_EXTRA_CREW.filter((cls) => cls !== 'guard' || has('vault'));
    // (at most two of the extras come over to fight; the rest keep to their posts)
    let roamers = 0;
    jobs.push(...rng.shuffle([...pool]).filter((cls) => ENEMY_CREW[cls].stays || roamers++ < 2).slice(0, extras));
    es.crewCls = [];
    for (const cls of jobs) {
      if (this.mobs.reduce((a, m) => a + (m.alive && m.team === 'enemy' ? 1 : 0), 0) >= 70) break;   // (the crowd cap)
      const E = ENEMY_CREW[cls];
      const room = has(E.post) || has('quarters') || has('bridge') || real[0];
      const p = roomPoint(room, rng);
      const ti = this.roster.findIndex((x) => x.officer === cls);
      if (ti < 0) continue;
      const m = this.spawnMob(ti, p.x, p.y, { defender: E.stays, esId: es.id, hpMul: 1 + 0.12 * tier, markable: false });
      m.name = `${es.name.replace(/^The /, '')}'s ${CLASSES[cls].name}`;
      m.post = this.rooms.indexOf(room);
      es.crewCls.push(cls);
    }
    // 013's mark is one of their officers when there are any (their pilot first)
    const agent = this.crew.find((c) => c.cls === 'agent');
    if (agent && this.markedLeft > 0 && !this.mobs.some((x) => x.alive && x.marked)) {
      const mark = this.mobs.find((m) => m.alive && m.esId === es.id && m.officer === 'pilot') || this.mobs.find((m) => m.alive && m.esId === es.id && m.officer);
      if (mark) { this.markedLeft--; this.markTarget(mark, agent); this.mission.name = mark.name; }
    }
    if (es.crewCls.length) this.log('ship', `${es.name} is crewed: ${es.crewCls.map((c) => CLASSES[c].name).join(', ')}. Take out the right one and their ship suffers for it.`);
  }

  /** One of their officers is down: their ship loses what that job does. */
  officerDown(m) {
    const es = this.enemyShips.find((s) => s.id === m.esId);
    const E = ENEMY_CREW[m.officer];
    if (!es || es.done || !E) return;
    this.log('alert', `🎯 ${es.name}: ${E.loss}`);
    this.fx({ t: 'text', x: m.x, y: m.y - 26, text: `${CLASSES[m.officer].name.toUpperCase()} DOWN`, color: '#f4c542' });
    if (m.officer === 'guard') for (const d of this.doors) if (d.owner === 'them' && d.armored && es.rooms.some((k) => d.a === k || d.b === k)) { d.armored = false; d.hp = Math.min(d.hp, 120); d.maxHp = 120; }
    if (m.officer === 'pilot') { es.fleeT = 0; }
  }
  /** Is that ship's officer for this job still alive? (ships that never had one count as "yes") */
  officerOk(es, cls) {
    if (!es.crewCls?.includes(cls)) return true;
    return this.mobs.some((m) => m.alive && m.officer === cls && m.esId === es.id);
  }

  pickType(defender = false) {
    // (the Hoarder never stands guard)
    const mix = this.mix.filter((m) => !(defender && (this.roster[m.type]?.hoarder || this.roster[m.type]?.thief)));
    if (!mix.length) return this.roster.findIndex((x) => isGrunt(x) && x.tier <= this.tier);
    const total = mix.reduce((a, m) => a + m.pct, 0);
    const r = this.rng() * total; let acc = 0;
    for (const m of mix) { acc += m.pct; if (r <= acc) return m.type; }
    return mix[0].type;
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
      if (m.team === 'crew' || m.hoarder) { m.x = home.x; m.y = home.y; } else m.alive = false;   // (the Ship-Eater just climbs aboard ours)
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
    // everything left over there goes with it (our turrets, traps, mines, scarecrows too: refunded as scrap)
    let refund = 0;
    for (const o of this.objs) if (on(o) && o.owner !== 'them' && ['turret', 'trap', 'scarecrow'].includes(o.kind)) refund += o.kind === 'turret' ? 15 : o.kind === 'scarecrow' ? 6 : 5;
    this.objs = this.objs.filter((o) => !on(o));
    if (refund) { this.ship.scrap += refund; this.log('ship', `Our gadgets on ${es.name} came back as ${refund} scrap.`); }
    this.projs = this.projs.filter((p) => !on(p));
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
    if (room.type === 'vault' || room.type === 'power') this.recalcShip();
    if (room.type === 'power') this.log('alert', 'A Power Core is down! We lost its cells until it\'s repaired.');
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
    for (const m of this.mobs) if (m.team === 'enemy' && !m.hoarder && this.onEnemyShip(es, m)) m.alive = false;   // (the Ship-Eater doesn't surrender)
    for (const id of es.rooms) { const r = this.rooms[id]; for (let k = 0; k < 1 + (this.rng.chance(0.5) ? 1 : 0); k++) { const p = roomPoint(r, this.rng); this.objs.push({ id: uid(), kind: 'crate', x: p.x, y: p.y, owner: 'them' }); } }
    if (es.stolen) { const r = this.rooms[es.rooms[0]]; this.objs.push({ id: uid(), kind: 'crate', x: r.station.x + 40, y: r.station.y + 40, owner: 'them', gems: es.stolen, gemVal: es.stolenVal || es.stolen }); }
    if (es.scrapStolen) { const r = this.rooms[es.rooms[0]]; this.objs.push({ id: uid(), kind: 'crate', x: r.station.x + 70, y: r.station.y + 40, owner: 'them', scrap: es.scrapStolen }); }
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
    const scrap = 10 + this.tier * 8 + (obj.scrap || 0), money = 10 + this.tier * 10;
    this.ship.scrap += scrap; c.wallet += money;
    gainXp(this, c, 4);
    if (obj.gems) { const s = this.ship; const n = Math.min(s.gemCap - s.gems, obj.gems); s.gems += n; s.gemValue += Math.round((obj.gemVal || obj.gems) * n / obj.gems); this.log('loot', `Got the stolen ${obj.gems} gems back!`); }
    if (obj.scrap) this.log('loot', `Got our scrap back! (+${obj.scrap})`);
    // now and then there's a gun in there for the weapons bay
    if (this.rng.chance(0.07 + 0.02 * this.tier)) this.findGun(c);
    this.fx({ t: 'text', x: obj.x, y: obj.y - 20, text: `+${scrap} scrap +${money}$`, color: '#f4c542' });
  }
  /** A ship gun turns up (loot): it goes into storage for the missile technician to install. */
  findGun(c, id) {
    id ||= this.rng.pick(Object.keys(SHIP_GUNS).filter((k) => k !== 'dgun' && !SHIP_GUNS[k].trader));
    this.ship.items.push({ id });
    this.log('loot', `🔫 ${c ? c.name + ' found' : 'Found'} a ${SHIP_GUNS[id].name}! It's in storage: the missile technician can install it at the weapons bay (needs ${SHIP_GUNS[id].power} power).`);
    this.fx({ t: 'gunfound', id });
  }
  joeDied() {
    if (this.joe.state === 'dead') return;
    this.joe.state = 'dead';
    this.log('story', 'Joe is gone.');
    this.story({ title: 'Too late', lines: ['The pod door gives. By the time you get there, it\'s quiet.', 'You take his wrench. It\'s a good wrench.'], kind: 'note' });
  }
  bossDied() {
    this.log('loot', `☀ ${(this.boss?.name || 'THE THING AT THE CORE').toUpperCase()} FALLS!`);
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
    return Math.round(s.score + this.depthKm * 5 + s.gems * 4 + (this.ship.gemValue || 0) * 2 + this.crew.reduce((a, c) => a + c.wallet, 0) + (this.joe.state === 'saved' ? 10000 : 0));
  }

  /** Power without a scientist at the controls: cells go where they're needed (encounter: guns and bubbles). */
  autoPower() {
    const s = this.ship, sci = this.crew.find((c) => c.cls === 'scientist');
    if (sci?.human) return;
    const fight = this.phase === 'encounter';
    const a = s.power.alloc;
    const want = { engine: 1, shield: 1, weapons: 0, systems: 1, kitchen: 1 };
    want.weapons = s.guns.reduce((n, g) => n + SHIP_GUNS[g.id].power, 0);
    for (const k in a) a[k] = 0;
    let left = s.power.cells;
    const order = fight ? ['weapons', 'shield', 'engine', 'kitchen', 'systems'] : ['engine', 'systems', 'shield', 'kitchen', 'weapons'];
    for (const k of order) { const n = Math.min(left, want[k] || 0, POWER_SYS[k].max); a[k] = n; left -= n; }
    // anything spare: bubbles and engines when fighting, engines and systems when not
    for (const k of fight ? ['shield', 'engine', 'kitchen'] : ['engine', 'systems', 'kitchen', 'shield']) while (left > 0 && a[k] < POWER_SYS[k].max) { a[k]++; left--; }
  }
}

/** Never more cells handed out than we have (the galley and systems give theirs up first). */
function trimPower(s) {
  const a = s.power.alloc;
  for (const k in POWER_SYS) a[k] = Math.max(0, Math.min(POWER_SYS[k].max, a[k] || 0));
  let used = Object.values(a).reduce((x, y) => x + y, 0);
  const order = ['kitchen', 'systems', 'engine', 'shield', 'weapons'];
  while (used > s.power.cells) { const k = order.find((x) => a[x] > 0); if (!k) break; a[k]--; used--; }
}

// ---------------------------------------------------------------------------
// enemy ship layouts
/** Cut a ship layout down to its top `rows` decks, keeping a bridge (it has to be flown). */
function trimLayout(layout, rows) {
  const had = new Set(layout.rooms.map((r) => r.type));
  layout.rooms = layout.rooms.filter((r) => r.r + (r.rh || 1) <= rows);
  if (!layout.rooms.length) layout.rooms = [{ type: 'bridge', c: 0, r: 0 }];
  for (const t of ['bridge', 'weapons', 'quarters']) {
    if (!had.has(t) || layout.rooms.some((r) => r.type === t)) continue;
    const spare = layout.rooms.find((r) => !r.thin && (r.type === 'corridor' || (r.type === 'quarters' && t !== 'quarters' && layout.rooms.filter((x) => x.type === 'quarters').length > 1)));
    if (spare) spare.type = t;
    else if (t === 'bridge') { const r = layout.rooms.find((x) => !x.thin) || layout.rooms[0]; r.type = 'bridge'; r.thin = null; }
  }
  // a crawlway left dangling at the end of the ship is just a room now
  for (const r of layout.rooms) if (r.thin) r.thin = null;
  if (layout.airlock != null) layout.airlock = Math.min(layout.airlock, Math.max(...layout.rooms.map((r) => r.c)));
  return layout;
}

function enemyLayout(kind, tier, rng, ourName, k = 0, level = 1) {
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
  // all shapes and sizes: little raiders to sprawling crooked carriers, random every time. The hull is
  // grown cell by cell (L shapes, T shapes, snakes, blobs), some cells become long thin crawlways and
  // some neighbours merge into big double rooms.
  const TS = [1, 1.7, 2.7, 4, 5.6][tier];
  const maxCols = clamp(3 + tier, 3, 6), maxRows = clamp(1 + Math.ceil(tier / 1.5), 1, 3);
  const want = clamp(3 + rng.int(0, 2) + tier * 1.4 | 0, 3, maxCols * maxRows);
  const cells = new Map([['0,0', true]]);
  const key = (c, r) => `${c},${r}`;
  for (let guard = 0; cells.size < want && guard < 400; guard++) {
    const [c, r] = rng.pick([...cells.keys()]).split(',').map(Number);
    const [dc, dr] = rng.pick([[1, 0], [-1, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]);   // they tend to grow wide
    const nc = c + dc, nr = r + dr;
    const cs = [...cells.keys()].map((s) => s.split(',').map(Number));
    const minC = Math.min(nc, ...cs.map((x) => x[0])), maxC = Math.max(nc, ...cs.map((x) => x[0]));
    const minR = Math.min(nr, ...cs.map((x) => x[1])), maxR = Math.max(nr, ...cs.map((x) => x[1]));
    if (maxC - minC >= maxCols || maxR - minR >= maxRows) continue;
    cells.set(key(nc, nr), true);
  }
  // normalise to 0,0
  let list = [...cells.keys()].map((s) => s.split(',').map(Number));
  const mc = Math.min(...list.map((x) => x[0])), mr = Math.min(...list.map((x) => x[1]));
  list = list.map(([c, r]) => [c - mc, r - mr]);
  const has = new Set(list.map(([c, r]) => key(c, r)));
  const nb = (c, r) => ({ l: has.has(key(c - 1, r)), r: has.has(key(c + 1, r)), u: has.has(key(c, r - 1)), d: has.has(key(c, r + 1)) });
  // jobs: the essentials, then bunks and hallways. Deeper down they carry a gun rack like ours, and
  // racks need power: a Power Core (two, for a big rack) and sometimes a second weapons bay.
  const guns = [];
  if (tier >= 2) {
    const pool = ['flak', 'burst', 'ion', 'rail'].filter((id, k) => k <= tier - 1);
    const n = clamp(rng.int(0, tier - 1), 0, 3);
    for (let k = 0; k < n; k++) guns.push(rng.pick(pool));
  }
  const power = guns.reduce((a, id) => a + SHIP_GUNS[id].power, 0);
  const extraJobs = [];
  if (guns.length) extraJobs.push('power');
  if (power > 4) extraJobs.push('power');
  if (guns.length > 2) extraJobs.push('weapons');
  const must = [...['bridge', 'weapons', 'quarters', 'engine', 'shield'].slice(0, Math.min(list.length, tier >= 1 ? 5 : 4)), ...extraJobs].slice(0, list.length);
  const rooms = [];
  const used = new Set();
  const order = rng.shuffle([...list]);
  // a few crawlways: cells that only link left-right (or up-down) and aren't needed for a job
  const spare = order.length - must.length;
  let thinLeft = Math.min(spare, rng.int(0, 1 + (tier >= 2 ? 1 : 0)));
  let bigLeft = tier >= 1 ? rng.int(0, 2) : 0;
  const jobs = [...must];
  for (const [c, r] of order) {
    if (used.has(key(c, r))) continue;
    const n = nb(c, r);
    const horiz = n.l && n.r && !n.u && !n.d, vert = n.u && n.d && !n.l && !n.r;
    if (thinLeft > 0 && (horiz || vert) && order.length - used.size > jobs.length) {
      thinLeft--; used.add(key(c, r)); rooms.push({ type: 'corridor', c, r, thin: horiz ? 'h' : 'v' }); continue;
    }
    const type = jobs.shift() || rng.pick(['quarters', 'quarters', 'corridor', 'corridor', 'kitchen', 'storage', 'lab', 'armory', 'kennel', 'closet']);
    // a big double room with its right-hand neighbour (bunks and corridors like being big)
    if (bigLeft > 0 && (type === 'quarters' || type === 'corridor' || type === 'engine') && has.has(key(c + 1, r)) && !used.has(key(c + 1, r)) && order.length - used.size - 2 >= jobs.length) {
      bigLeft--; used.add(key(c, r)); used.add(key(c + 1, r)); rooms.push({ type, c, r, cw: 2 }); continue;
    }
    used.add(key(c, r)); rooms.push({ type, c, r });
  }
  // a thin crawlway's only job is to connect; make sure it still does (its neighbours are real rooms)
  const total = list.length;
  const v = () => rng.range(0.85, 1.2);
  return {
    name: `${prefix} ${noun}`, rooms, guns,
    hull: Math.round((130 + total * 36) * TS * v()),
    bubble: tier >= 1 ? Math.floor(tier / 1.5) + (rng.chance(0.3) ? 1 : 0) : 0,
    gunPeriod: (8.5 - 0.6 * tier) * v(), gunDmg: Math.round((3 + 3.4 * tier) * v()),
    missilePeriod: (16 - 1.4 * tier) * v(), missileDmg: Math.round((8 + 6 * tier) * v()),
    // lots of them, from the very start, and more every level down
    boarders: Math.round((26 + level * 2.2 + tier * 10 + total * 4) * rng.range(0.85, 1.25)), wave: 4 + Math.round(tier * 1.4) + (total >= 6 ? 1 : 0),
  };
}

// ---------------------------------------------------------------------------
// candy, random events, the trader, the virus

const CANDY_W = { green: 5, red: 5, blue: 4, yellow: 4, white: 2, rainbow: 0.6 };
function dropCandy(g, sub) {
  const rooms = g.rooms.filter((r) => r.owner === 'us' && !r.gone);
  if (!rooms.length) return;
  const p = roomPoint(g.rng.pick(rooms), g.rng);
  const pk = rainPickup(g, p.x, p.y, 'candy', 1, sub || g.rng.weighted(CANDY_W));
  return pk;
}

function extrasTick(g, dt) {
  // candy pops up around the ship every so often
  if (['descent', 'encounter', 'aftermath'].includes(g.phase)) {
    g.candyT -= dt;
    if (g.candyT <= 0) {
      g.candyT = g.rng.range(28, 50);
      if (g.pickups.filter((p) => p.kind === 'candy').length < 5) dropCandy(g);
    }
  }
  // the random event for this layer
  if (g.phase === 'descent' && g.eventAt != null && !g.descent.stranded && g.descent.progress >= g.eventAt && !g.storyOpen) {
    const at = g.descent.progress;
    g.eventAt = null; randomEvent(g);
    // more shuffled in: deeper down, a second (even a third) thing can happen on the same layer
    g.eventsThisLayer = (g.eventsThisLayer || 0) + 1;
    if (g.eventsThisLayer < 3 && at < 0.7 && g.rng.chance(0.3 + 0.015 * g.level)) g.eventAt = at + g.rng.range(0.15, 0.3);
  }
  // temporary allies (the friendly moles) go home after a while
  for (const m of g.mobs) if (m.alive && m.lifeT != null) { m.lifeT -= dt; if (m.lifeT <= 0) { m.alive = false; g.fx({ t: 'poof', x: m.x, y: m.y }); } }
  // the trader hangs around for a minute
  if (g.trader) { g.trader.t -= dt; if (g.trader.t <= 0 || g.phase !== 'descent') { g.log('ship', 'The trader unhooks and digs off. "Pleasure doing business, foxes!"'); g.trader = null; } }
  // the virus: every few seconds each one screams and splits in two. If they fill a room, the room is gone.
  const viruses = g.mobs.filter((m) => m.alive && m.event === 'virus');
  if (viruses.length) {
    g.virusT = (g.virusT || 0) - dt;
    if (g.virusT <= 0) {
      g.virusT = 3.2;
      const vi = g.roster.findIndex((x) => x.event === 'virus');
      for (const v of viruses) {
        if (g.mobs.length > 150) break;
        const c = g.spawnMob(vi, v.x + g.rng.range(-12, 12), v.y + g.rng.range(-12, 12), { markable: false, wild: true });
        unstick(g, c);
        if (g.rng.chance(0.25)) g.fx({ t: 'say', id: v.id, text: g.rng.pick(['AAAAAAH!', 'EEEEEEE!', 'MORE OF US!', 'AAAH AAAH AAAH!']) });
      }
      g.fx({ t: 'virus', x: viruses[0].x, y: viruses[0].y });
      // a room full of them: it's gone
      const per = new Map();
      for (const v of g.mobs) if (v.alive && v.event === 'virus') { const ri = roomAt(g, v); if (ri >= 0) per.set(ri, (per.get(ri) || 0) + 1); }
      for (const [ri, n] of per) {
        const r = g.rooms[ri];
        if (!r || r.owner !== 'us' || n < 16) continue;
        for (const v of g.mobs) if (v.alive && v.event === 'virus' && roomAt(g, v) === ri) v.alive = false;
        if (r.sys) damageSystem(g, r, r.sys.hp + 1);
        if (!g.storyMode) g.ship.hull = Math.max(1, g.ship.hull - 40);
        igniteRoom(g, r, 4);
        const p = roomCenter(r);
        g.fx({ t: 'boom', x: p.x, y: p.y, r: 120 });
        g.log('alert', `☣ The virus filled the ${r.name} and it BURST. The room is wrecked!`);
      }
    }
  }
}

/** One thing happens on the way down (deeper: more likely bad, and worse). */
function randomEvent(g) {
  const L = g.level;
  const good = Math.max(0.15, 0.62 - 0.016 * L);
  const pool = {};
  const nGood = Object.values(EVENTS).filter((e) => e.good).length, nBad = Object.values(EVENTS).length - nGood;
  for (const [id, e] of Object.entries(EVENTS)) pool[id] = e.good ? good / nGood : (1 - good) / nBad;
  if (L < 5) { pool.worms = 0; pool.tentacles = 0; pool.virus *= 0.5; pool.storks *= 0.4; }
  if (L < 3) pool.pirates = 0;
  if (g.workingEngines() < 1) pool.engine = 0;
  const id = g.rng.weighted(pool);
  const E = EVENTS[id];
  g.lastEvent = { id, at: g.time };
  g.fx({ t: 'event', id, good: E.good, name: E.name });
  g.log(E.good ? 'loot' : 'alert', `${E.good ? '✨' : '⚠'} ${E.name}! ${E.text}`);
  const n = (base, per) => Math.round(base + per * g.tier + g.crew.length / 6);
  switch (id) {
    case 'trader': {
      const guns = ['fire', g.rng.pick(Object.keys(SHIP_GUNS).filter((k) => k !== 'dgun' && k !== 'fire'))];
      g.trader = { t: 60, guns, missilePrice: 35, missileBuy: 22, scrapPrice: 18, scrapBuy: 12 };
      break;
    }
    case 'cache': for (let k = 0; k < 10 + g.tier * 4; k++) { const r = g.rng.pick(g.rooms.filter((x) => x.owner === 'us')); const p = roomPoint(r, g.rng); rainPickup(g, p.x, p.y, 'gem', 1, gemType(g)); } break;
    case 'candyrain': for (let k = 0; k < 7; k++) dropCandy(g, k === 0 && g.rng.chance(0.4) ? 'rainbow' : undefined); break;
    case 'strawberry': eventSpawn(g, 'strawberry', n(3, 1)); break;
    case 'distress':
      g.story({ title: 'A signal in the dirt: "DO I GO?"', kind: 'distress', lines: ['A weak distress beacon, close by. It just repeats three words: "Do I go? Do I go? Do I go?"', 'Could be someone like Joe. Could be bait.'],
        choices: [{ id: 'help', label: DISTRESS_LINES[0] }, { id: 'leave', label: DISTRESS_LINES[1] }] });
      break;
    case 'fire': { const rooms = g.rooms.filter((r) => r.owner === 'us' && r.sys); igniteRoom(g, g.rng.pick(rooms), 3 + g.tier); break; }
    case 'engine': {
      const eng = g.rooms.filter((r) => r.owner === 'us' && r.type === 'engine' && r.sys.hp > 0);
      const r = g.rng.pick(eng);
      damageSystem(g, r, r.sys.hp + 1);
      g.log('alert', eng.length > 1 ? `The other engine${eng.length > 2 ? 's keep' : ' keeps'} us moving. Engineers: fix the ${r.name}!` : 'That was our only engine. We\'re crawling. ENGINEERS!');
      break;
    }
    case 'storks': {
      // the stork armada: up to four ships of nothing but storks dock and pour them in
      const ships = clamp(2 + Math.floor(g.tier / 1.5) + (g.rng.chance(0.4) ? 1 : 0), 2, 4);
      g.resume = g.descent;
      g.startEncounter('ship', { swarm: { type: g.roster.findIndex((x) => x.event === 'stork'), ships, each: 34 + g.tier * 8, wave: 7 + g.tier,
        names: ['The Stork Carrier', 'The Nest Ship', 'The Beak Barge', 'The Feathered Fury'],
        msg: (k) => `🪶 THE STORK ARMADA! ${k} ships packed with storks are docking. They're going to fill the ship!` } });
      return;
    }
    case 'pirates': {
      const pi = g.roster.findIndex((x) => x.thiefId === 'pirate');
      g.resume = g.descent;
      g.startEncounter('ship', { swarm: { type: pi, ships: clamp(1 + Math.floor(g.tier / 2), 1, 3), each: 22 + g.tier * 6, wave: 5 + g.tier,
        names: ['The Jolly Digger', 'The Black Shovel', 'The Salty Mole'], msg: (k) => `🏴‍☠️ HAR HAR HAR! ${k > 1 ? `${k} pirate ships` : 'A pirate ship'} latches on. They want the vault!` } });
      return;
    }
    case 'magnet': {
      // every loose pickup on the ship flies straight to the nearest crew member
      let k = 0;
      for (const p of [...g.pickups]) { const c = g.crew.filter((x) => x.alive).sort((a, b) => dist(a, p) - dist(b, p))[0]; if (c) { p.x = c.x; p.y = c.y; p.z = 0; k++; } }
      g.log('loot', `🧲 ${k} loose things zip across the ship into our pockets.`);
      break;
    }
    case 'hotspring': {
      for (const c of g.crew) if (c.alive) { c.hp = c.maxHp; c.stam = c.stamMax || 100; }
      const messes = g.objs.filter((o) => o.kind === 'mess').length;
      g.objs = g.objs.filter((o) => o.kind !== 'mess' && o.kind !== 'fire');
      g.log('loot', `♨ Everyone is healed${messes ? ` and ${messes} messes wash away` : ''}.`);
      break;
    }
    case 'scrapfield': for (let k = 0; k < 10 + g.tier * 3; k++) { const r = g.rng.pick(g.rooms.filter((x) => x.owner === 'us')); const p = roomPoint(r, g.rng); rainPickup(g, p.x, p.y, 'ore', 1); } break;
    case 'moles': {
      // a friendly mole family digs in and fights on our side for a while
      const types = g.roster.filter((x) => x.creature && x.tier <= g.tier + 1);
      const at = g.burrowPoint();
      for (let k = 0; k < 3 + Math.floor(g.tier / 2); k++) { const m = g.spawnMob(g.rng.pick(types).idx, at.x + g.rng.range(-20, 20), at.y + g.rng.range(-20, 20), { team: 'crew', markable: false, wild: false }); m.name = 'Friendly Mole'; m.lifeT = 90; m.hp = m.maxHp = m.hp * 1.5; }
      break;
    }
    case 'quake': {
      g.fx({ t: 'shake', amt: 18 });
      const rooms = g.rng.shuffle(g.rooms.filter((r) => r.owner === 'us' && r.sys));
      for (const r of rooms.slice(0, 2 + Math.floor(g.tier / 2))) g.blockDoorway(r);
      for (const r of rooms.slice(0, 2)) damageSystem(g, r, r.sys.max * 0.3);
      break;
    }
    case 'surge': {
      const cores = g.rooms.filter((r) => r.owner === 'us' && (r.type === 'power' || r.type === 'shield' || r.type === 'lab'));
      for (const r of cores) { damageSystem(g, r, r.sys.max * 0.45); if (g.rng.chance(0.4)) igniteRoom(g, r, 1); }
      g.ship.bubble = 0;
      break;
    }
    case 'virus': {
      const hold = g.rooms.find((r) => r.owner === 'us' && r.type === 'storage') || g.rng.pick(g.rooms.filter((r) => r.owner === 'us' && r.sys));
      const p = roomCenter(hold);
      g.spawnMob(g.roster.findIndex((x) => x.event === 'virus'), p.x, p.y, { markable: false, wild: true });
      g.virusT = 4;
      g.log('alert', `☣ It started in the ${hold.name}. Kill every last one before they fill the room!`);
      break;
    }
    case 'rocks': eventSpawn(g, 'rockmon', n(2, 0.7)); break;
    case 'tentacles': eventSpawn(g, 'tentacle', n(3, 1)); break;
    case 'worms': eventSpawn(g, 'burrower', n(1, 0.5)); break;
  }
}

/** Event monsters burst in through the hull somewhere. */
function eventSpawn(g, id, count) {
  const ti = g.roster.findIndex((x) => x.event === id);
  if (ti < 0) return;
  const rooms = g.rooms.filter((r) => r.owner === 'us');
  const r = g.rng.pick(rooms);
  const walls = g.hullNear(r);
  let at = roomCenter(r);
  if (walls.length && !g.storyMode) {
    const w = g.rng.pick(walls); hitTile(g, w.x, w.y, 9999, { hull: true });
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (g.grid.get(w.x + dx, w.y + dy) === T.FLOOR) { at = { x: (w.x + dx + .5) * TILE, y: (w.y + dy + .5) * TILE }; break; }
  }
  for (let k = 0; k < count; k++) g.spawnMob(ti, at.x + g.rng.range(-20, 20), at.y + g.rng.range(-20, 20), { markable: false, wild: true });
  g.fx({ t: 'alarm' });
}

/** Creatures dig straight through the hull somewhere. */
/** Knock a hole in our hull next to a random room; returns the floor point just inside it. */
Game.prototype.burrowPoint = function () {
  const rooms = this.rooms.filter((r) => r.owner === 'us' && !r.gone);
  const r = this.rng.pick(rooms);
  const walls = this.hullNear(r);
  let at = roomCenter(r);
  if (walls.length && !this.storyMode) {
    const w = this.rng.pick(walls); hitTile(this, w.x, w.y, 9999, { hull: true });
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.grid.get(w.x + dx, w.y + dy) === T.FLOOR) { at = { x: (w.x + dx + .5) * TILE, y: (w.y + dy + .5) * TILE }; break; }
  }
  at.room = r;
  return at;
};

/** Things dig in through the hull: creatures, or (types given) whatever the level's ships carry. */
function burrowIn(g, n, boarders = false) {
  const creatures = g.roster.filter((x) => x.creature && x.tier <= g.tier + 1);
  if (!creatures.length && !boarders) return;
  const at = g.burrowPoint();
  for (let k = 0; k < n; k++) g.spawnMob(boarders ? g.pickType() : g.rng.pick(creatures).idx, at.x + g.rng.range(-20, 20), at.y + g.rng.range(-20, 20), { markable: false });
  g.log('alert', boarders ? `☠ Boarders burst through the hull near the ${at.room.name}!` : `♨ Creatures burst through the hull near the ${at.room.name}!`);
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
      // the Hoarder always finds you on its level
      if (g.mix?.solo && !g.hoarderSeen && d.progress > 0.45 && !d.ambushed) {
        d.ambushed = true; g.resume = d;
        g.startEncounter('ship');
        return;
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
      // a vote is running: it closes 15 seconds after the first vote (or when everyone has voted)
      if (g.route.voteT != null) { if (g.route.t - g.route.voteT > 15) tallyRoute(g); return; }
      const humans = g.crew.filter((c) => c.human).length;
      if ((!humanPilot && g.route.t > (humans > 1 ? 20 : 8)) || g.route.t > 45 || (!anyHuman && g.route.t > 2.5)) {
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
    update(g, dt) {
      if (g.storyOpen) return;
      const pilot = g.crew.find((c) => c.cls === 'pilot');
      if (!g.crew.some((c) => c.human) && g.phaseT > 3) { COMMANDS.continue(g, pilot || g.crew[0], { force: true }); return; }
      // a bot pilot gives everyone a minute to loot, then calls everyone back
      if (pilot && !pilot.human) {
        if (g.phaseT > 40 && !g.departSoon) { g.departSoon = true; say(g, pilot, 'Undocking in 12 seconds! Everybody back aboard!'); g.log('ship', `${pilot.name}: "Undocking in 12 seconds!"`); }
        if (g.phaseT > 52) COMMANDS.continue(g, pilot, { force: true });
      }
      // staying to loot is a gamble: hang around and something bigger hears the noise
      if (g.phaseT > 38 && !g.lingerWarned) { g.lingerWarned = true; g.log('alert', '📡 Something big is circling out there. The longer we sit here, the more likely it finds us.'); g.fx({ t: 'alarm' }); }
      if (g.phaseT > 45 && !g.storyMode && g.rng.chance(dt * Math.min(0.05, 0.004 * (g.phaseT - 45)))) {
        g.log('alert', '☠ We waited too long. A bigger ship heard the commotion and it is coming in hot!');
        g.lingerWarned = false;
        g.startEncounter('ship', { harder: true });
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
      } else burrowIn(g, n.boarders ? count + 2 : count, !!n.boarders);
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
      if (left && n.doneT > 45 && !g.mobs.some((m) => m.alive && m.hoarder && m.team === 'enemy')) { for (const m of g.mobs) if (m.team === 'enemy') m.alive = false; g.log('ship', 'The last creatures burrow back into the dirt.'); }
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
  if (pilot && !pilot.human && !g.fleeT && !g.weFled && s.hull < s.hullMax * 0.18 && g.fightingShips.some((x) => x.kind === 'ship')
    && g.rooms.some((r) => r.owner === 'us' && r.type === 'bridge' && r.sys.hp > 0)) COMMANDS.flee(g, pilot, {});   // (no point trying with the bridge wrecked)

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
  if (g.mobs.some((m) => m.alive && m.hoarder && m.team === 'enemy')) return;   // nobody goes home while the Ship-Eater is alive
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
  // every installed gun that has power fires on its own clock (power goes to the first ones in the rack)
  let power = g.pw('weapons');
  for (const gun of s.guns) {
    const G = SHIP_GUNS[gun.id];
    gun.on = power >= G.power;
    if (!gun.on) continue;
    power -= G.power;
    gun.t = (gun.t || 0) + dt * eff(wr);
    const period = gunPeriod(s, gun.id);
    if (gun.t < period) continue;
    gun.t = 0;
    const dmg = gunDmg(s, gun.id);
    for (let k = 0; k < G.shots; k++) {
      const delay = k * 0.12;
      if (es.bubble > 0 && !G.pierce) {
        es.bubble = Math.max(0, es.bubble - (G.bubbleDmg || 1)); es.bubbleT = 0;
        g.fx({ t: 'dfire', who: 'us', w: 'gun', gun: gun.id, blocked: true, room: s.missileTarget, delay });
      } else {
        es.hull -= dmg; g.fx({ t: 'dfire', who: 'us', w: 'gun', gun: gun.id, dmg, room: s.missileTarget, delay });
        if (target) damageSystem(g, target, dmg * 0.6 * (G.sysMul || 1));
        if (G.bubbleDmg && es.bubble > 0) es.bubble = Math.max(0, es.bubble - G.bubbleDmg);
        // the trader's fire gun: their room goes up in flames and they have to put it out
        if (G.fire && target) igniteRoom(g, target, 3);
      }
    }
  }
  s.dgunT = s.guns[0]?.t || 0;
  const tech = g.crew.find((c) => c.cls === 'missiletech' && c.alive);
  const techHere = tech && g.rooms[roomAt(g, tech)] === wr;
  if (s.missiles > 0 && !s.missileReady) {
    s.missileT += dt * eff(wr) * (techHere ? 1.6 : 1);
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
  // their crew: each job keeps something on their ship running
  const ok = (cls) => g.officerOk(es, cls);
  // their bubble (their scientist keeps it charging)
  if (theirs('shield') && ok('scientist') && es.bubble < es.bubbleMax) { es.bubbleT += dt; if (es.bubbleT > 11) { es.bubbleT = 0; es.bubble++; } }
  // their engineer patches their damaged rooms (not the wrecked ones)
  if (es.crewCls?.includes('engineer') && ok('engineer')) for (const r of mine) if (r.sys && r.sys.hp > 0 && r.sys.hp < r.sys.max) r.sys.hp = Math.min(r.sys.max, r.sys.hp + dt * (2 + g.tier));
  // their farmer and chef keep the bunks full: reinforcements trickle in
  if (es.fightT < 150 && (es.crewCls?.includes('farmer') || es.crewCls?.includes('chef')) && (ok('farmer') && ok('chef')) && theirs('quarters')) {
    es.feedT = (es.feedT || 0) + dt; if (es.feedT > 25) { es.feedT = 0; es.crewLeft += 1; }
  }
  // their D-weapons (powered engines let us slip some of it; a ship with no pilot aims worse)
  const dodge = Math.min(0.85, g.dodgeChance() + (ok('pilot') ? 0 : 0.25));
  enemyRack(g, es, mine, dt, dodge);
  if (theirs('weapons')) {
    es.gunT += dt;
    if (es.gunT >= es.gunPeriod) {
      es.gunT = 0;
      if (s.evasiveT > 0 || g.rng.chance(dodge)) g.fx({ t: 'dfire', who: 'them', w: 'gun', miss: true, from: es.id });
      else if (s.bubble > 0) { s.bubble--; s.bubbleT = 0; g.fx({ t: 'dfire', who: 'them', w: 'gun', blocked: true, from: es.id }); }
      else {
        const r = enemyTarget(g);
        if (!g.storyMode) { s.hull -= es.gunDmg; if (r) damageSystem(g, r, es.gunDmg * 0.4); }
        g.fx({ t: 'dfire', who: 'them', w: 'gun', dmg: es.gunDmg, from: es.id, room: r ? g.rooms.indexOf(r) : null });
      }
    }
    es.missileT += dt * (ok('missiletech') ? 1 : 0.35);
    if (es.missileT >= es.missilePeriod) {
      es.missileT = 0;
      if (s.evasiveT > 0 || g.rng.chance(dodge)) { g.fx({ t: 'dfire', who: 'them', w: 'missile', miss: true, from: es.id }); g.log('ship', s.evasiveT > 0 ? 'Evasive! Their D-missile sails past.' : 'The engines jink us sideways: their D-missile misses!'); }
      else enemyMissile(g, es);
    }
  }
  // boarders
  if (es.crewLeft > 0) {
    es.spawnT -= dt;
    const crowd = g.mobs.reduce((a, m) => a + (m.alive && m.team === 'enemy' ? 1 : 0), 0);
    if (es.spawnT <= 0 && crowd >= 70) es.spawnT = 1.5;   // the tunnels are jammed: wait a moment
    else if (es.spawnT <= 0) {
      es.spawnT = Math.max(2, 5 - g.tier * 0.55) * g.rng.range(0.8, 1.2);
      const q = mine.filter((r) => (r.type === 'quarters' || r.type === 'core') && r.sys.hp > 0);
      const from = q.length ? g.rng.pick(q) : mine[0];
      const n = Math.max(0, Math.min(es.crewLeft, es.wave, 70 - crowd));   // (never past the cap)
      for (let k = 0; k < n; k++) { const p = roomPoint(from, g.rng); g.spawnMob(es.layout?.boardType ?? g.pickType(), p.x, p.y, { esId: es.id, wild: false, markable: !es.layout?.swarm }); }
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
  if (!theirs('bridge') || !ok('pilot')) { es.fleeT = 0; return; }   // (nobody to fly it: they're stuck here with us)
  const boarding = theirCrew.some((m) => onOurs(g, m));
  if (es.layout?.solo) return;   // the Ship-Eater's shell doesn't run: it waits for its passenger
  if ((es.crewLeft <= 0 && !boarding) || es.fightT > 160) {
    es.fleeT = (es.fleeT || 0) + dt;
    if (es.fleeT > 6 && !es.fleeWarned) { es.fleeWarned = true; g.log('alert', `${es.name} is spinning up its drill to flee! Wreck its bridge or board it in the next 20s!`); }
    if (es.fleeT > 26) { es.done = true; es.fled = true; es.detachT = 0.6; g.log('ship', `${es.name} cut the tunnel and fled into the dirt.`); }
  } else if (es.fleeT) es.fleeT = Math.max(0, es.fleeT - dt);
}

/**
 * Their gun rack (deeper ships carry one like ours): every gun needs a working weapons bay slot (3 per
 * bay) and power cells (2 + 3 per running Power Core). Knock out a Power Core and the guns past their
 * power go dark, until their scientist reroutes power off the bubbles (if they still have one).
 */
function enemyRack(g, es, mine, dt, dodge) {
  if (!es.guns?.length) return;
  const s = g.ship, tier = g.tier;
  const bays = mine.filter((r) => r.type === 'weapons' && r.sys.hp > 0).length;
  const cores = mine.filter((r) => r.type === 'power');
  const live = cores.filter((r) => r.sys.hp > 0).length;
  let cells = 2 + 3 * live;
  if (cores.length && live < cores.length) {
    if (g.officerOk(es, 'scientist') && es.crewCls?.includes('scientist')) {
      es.rerouteT += dt;
      if (es.rerouteT > 8) {
        cells += 3;
        if (!es.rerouted) { es.rerouted = true; es.bubble = 0; g.log('alert', `${es.name} rerouted power from its bubbles to its guns!`); }
      }
    } else if (!es.noReroute) { es.noReroute = true; g.log('ship', `${es.name} lost a Power Core and has nobody to reroute it. Some of its guns go dark.`); }
  } else es.rerouteT = 0;
  let slots = bays * 3;
  for (const gun of es.guns) {
    const G = SHIP_GUNS[gun.id];
    gun.on = slots > 0 && cells >= G.power;
    if (!gun.on) continue;
    slots--; cells -= G.power;
    gun.t += dt;
    if (gun.t < G.period * 2) continue;
    gun.t = 0;
    for (let k = 0; k < G.shots; k++) {
      const delay = k * 0.12;
      if (s.evasiveT > 0 || g.rng.chance(dodge)) { g.fx({ t: 'dfire', who: 'them', w: 'gun', gun: gun.id, miss: true, from: es.id, delay }); continue; }
      if (s.bubble > 0 && !G.pierce) { s.bubble = Math.max(0, s.bubble - (G.bubbleDmg || 1)); s.bubbleT = 0; g.fx({ t: 'dfire', who: 'them', w: 'gun', gun: gun.id, blocked: true, from: es.id, delay }); continue; }
      const dmg = Math.round(G.dmg * (0.2 + 0.07 * tier));
      const r = enemyTarget(g);
      if (!g.storyMode) { s.hull -= dmg; if (r) damageSystem(g, r, dmg * 0.5 * (G.sysMul || 1)); }
      g.fx({ t: 'dfire', who: 'them', w: 'gun', gun: gun.id, dmg, from: es.id, room: r ? g.rooms.indexOf(r) : null, delay });
    }
  }
}

/** Ship guns: the D-gun gets better with its port upgrade; the others with D-gun levels too, a bit. */
export function gunPeriod(s, id) { return SHIP_GUNS[id].period / (1 + 0.12 * s.up.dgun); }
export function gunDmg(s, id) { const G = SHIP_GUNS[id]; return id === 'dgun' ? G.dmg + 6 * s.up.dgun : Math.round(G.dmg * (1 + 0.1 * s.up.dgun)); }

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
  if (tech) gainXp(g, tech, 16);
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
  // wrecks and surrendered ships sometimes have a gun worth keeping
  if (!this.weFled) for (const es of ships) if (es.kind === 'ship' && (es.surrendered || es.destroyed) && this.rng.chance(0.3 + 0.05 * tier)) this.findGun(null);
  for (const c of this.crew) if (c.alive && !this.weFled) gainXp(this, c, 10 + tier * 3);
  // every ship beaten pays; surrendered ones pay more, ones that got away less
  let mul = ships.length ? 0 : 1;
  for (const es of ships) mul += es.kind === 'derelict' || es.kind === 'pod' ? 0.6 : es.surrendered ? 1.5 : es.fled ? 0.5 : 1;
  if (this.weFled) mul = 0.2;
  loot.scrap *= mul; loot.money *= mul; loot.gems = Math.round(loot.gems * mul);
  if (ships.some((es) => es.kind === 'derelict' || es.kind === 'pod')) loot.gems = 0;
  this.ship.scrap += Math.round(loot.scrap);
  loot.gems = addGems(this, loot.gems);
  for (const c of this.crew) c.wallet += Math.round(loot.money);
  const talker = this.rng.pick(this.crew.filter((c) => c.alive && c.cls !== 'urchid'));
  if (talker && !this.weFled) quip(this, talker, 'win', true);
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
  this.lingerWarned = false;
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
export const RACK_MAX = 10;
export const rackCost = (s) => 40 + 25 * (s.rackUp || 0);
export const gunPrice = (id) => Math.max(40, Math.round((SHIP_GUNS[id]?.cost || 80) * 0.5));
export const PILOT_VOTE = 3;
/** Votes for the next stop, weighted: the pilot's counts PILOT_VOTE times. Ties go to the pilot, then the first vote. */
export function voteWeights(g) {
  const tally = {};
  for (const [id, i] of Object.entries(g.route?.votes || {})) {
    const c = g.crew.find((x) => x.id === id); if (!c || !c.human) continue;
    tally[i] = (tally[i] || 0) + (c.cls === 'pilot' ? PILOT_VOTE : 1);
  }
  return tally;
}
function tallyRoute(g) {
  const tally = voteWeights(g);
  const pilot = g.crew.find((x) => x.cls === 'pilot');
  const pv = pilot && g.route.votes?.[pilot.id];
  let best = null;
  for (const [i, w] of Object.entries(tally)) if (best == null || w > tally[best] || (w === tally[best] && +i === pv)) best = i;
  const n = g.route.nodes[best ?? 0];
  if (!n || n.locked) return;
  g.log('ship', `🗳 The crew voted: ${n.name || n.type} (${tally[best] || 0} of ${Object.values(tally).reduce((a, b) => a + b, 0)}).`);
  g.arrive(n);
}

const COMMANDS = {
  storyOk(g, c, cmd) {
    const s = g.storyOpen; if (!s) return;
    if (s.kind === 'distress') {
      g.nextStory();
      if (cmd.choice !== 'help') { g.log('ship', 'We leave the beacon behind. "Do I go?" fades into the dirt.'); return; }
      if (g.rng.chance(0.45 + 0.02 * g.tier)) {   // a trap!
        g.log('alert', '☠ IT WAS BAIT. Ships pour out of the dirt around the beacon!');
        g.resume = g.descent;
        g.startEncounter('ship');
        return;
      }
      // real survivors: grateful, and they pay
      const gems = addGems(g, 8 + g.tier * 6);
      g.ship.scrap += 25 + g.tier * 10;
      for (const c of g.crew) { c.wallet += 20 + g.tier * 10; gainXp(g, c, 15); }
      g.log('loot', `♥ Real survivors! A family of moles in a broken dig-pod. They hand over ${gems} gems and some scrap, and they cry a bit.`);
      if (g.crew.length < 17 && g.rng.chance(0.4)) g.recruit(1, 'was on the pod and joins up');
      return;
    }
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
  /** Pick where we go next. Alone, it's your call; with others aboard it's a vote (the pilot's counts triple). */
  route(g, c, cmd) {
    if (g.phase !== 'route') return;
    const n = g.route.nodes[cmd.i];
    if (!n || n.locked) return;
    const humans = g.crew.filter((x) => x.human);
    if (humans.length <= 1 || !c.human) { g.arrive(n); return; }
    g.route.votes ||= {};
    g.route.votes[c.id] = cmd.i;
    if (!g.route.voteT) { g.route.voteT = g.route.t; g.log('ship', `🗳 ${c.name} votes for ${n.name || n.type}. Everyone vote! (the pilot's vote counts ${PILOT_VOTE}x, 15 seconds)`); }
    else g.log('ship', `🗳 ${c.name} votes for ${n.name || n.type}.`);
    if (humans.every((x) => g.route.votes[x.id] != null)) tallyRoute(g);
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
    // a human pilot alone decides when we undock (other players can only ask)
    if (pilot && pilot.human && c !== pilot && (c.human || !cmd.force)) {
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
    // more working engines: we tear loose faster
    const eng = g.workingEngines();
    g.fleeT = Math.round(14 / (1 + 0.4 * Math.max(0, eng - 1)) * (eng ? 1 : 1.6));
    g.log('alert', `${c.name}: "Cutting the tunnels! ${g.fleeT} seconds, hold them off!"`);
    say(g, c, 'Cutting the tunnels! Hold them off!');
  },
  /** Pilot, last resort: redline an engine until it blows. We're gone, guaranteed, right now. */
  burnEngine(g, c) {
    if (g.phase !== 'encounter' || c.cls !== 'pilot' || g.weFled) return;
    if (!g.fightingShips.some((s) => s.kind === 'ship')) return;
    const eng = g.rooms.filter((r) => r.owner === 'us' && r.type === 'engine' && r.sys.hp > 0);
    if (!eng.length) { g.log('alert', 'No working engine left to burn.'); return { error: 'No working engine' }; }
    const r = eng[eng.length - 1];
    damageSystem(g, r, r.sys.hp + 1);
    g.fleeT = 0.4;
    g.log('alert', `🔥 ${c.name} redlines the ${r.name} until it bursts. We rip free of every clamp!`);
    say(g, c, 'SORRY, ENGINE! PUNCH IT!');
    g.fx({ t: 'boom', x: r.station.x, y: r.station.y, r: 90 });
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
    const value = g.ship.gemValue || g.ship.gems;
    const total = Math.round(value * g.port.gemPrice * (1 + 0.1 * (guard?.upgrades[0] || 0)));
    const each = Math.floor(total / g.crew.length);
    for (const x of g.crew) x.wallet += each;
    g.log('loot', `💎 Sold ${g.ship.gems} gems (worth ${value}) for ${total}. Everyone gets ${each}.`);
    g.stats.score += total;
    g.ship.gems = 0; g.ship.gemValue = 0;
  },
  buyGun(g, c, cmd, s) {
    if (g.phase !== 'port' || !g.port.upgrades) return;
    const G = SHIP_GUNS[cmd.id]; if (!G || cmd.id === 'dgun' || !(g.port.guns || []).includes(cmd.id)) return;
    if (c.wallet < G.cost) return;
    c.wallet -= G.cost; s.items.push({ id: cmd.id });
    g.log('ship', `🔫 ${c.name} bought a ${G.name}. It's in storage for the missile technician to install.`);
  },
  /** Missile technician at the weapons bay: put a gun from storage into the rack (or take one out). */
  install(g, c, cmd, s) {
    if (c.cls !== 'missiletech') return { error: 'Only the missile technician installs guns' };
    const item = s.items[cmd.item]; if (!item) return;
    if (s.guns.length >= s.gunSlots) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'the rack is full', color: '#ccc' }); return; }
    s.items.splice(cmd.item, 1); s.guns.push({ id: item.id, t: 0 });
    gainXp(g, c, 10);
    g.log('ship', `🔧 ${c.name} bolted a ${SHIP_GUNS[item.id].name} into the weapons bay. It needs ${SHIP_GUNS[item.id].power} power to fire.`);
  },
  /** Missile technician: bolt another slot onto the weapons rack (scrap), up to RACK_MAX guns. */
  expandRack(g, c, cmd, s) {
    if (c.cls !== 'missiletech') return { error: 'Only the missile technician can extend the rack' };
    const cost = rackCost(s);
    if (s.gunSlots >= RACK_MAX) return { error: 'The rack is as big as it gets' };
    if (s.scrap < cost) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: `needs ${cost} scrap`, color: '#ccc' }); return; }
    s.scrap -= cost; s.rackUp = (s.rackUp || 0) + 1;
    g.recalcShip();
    gainXp(g, c, 12);
    g.log('ship', `🔧 ${c.name} welded another slot onto the weapons rack (${s.gunSlots} guns).`);
  },
  /** At a port: sell a gun out of storage (half what it cost new). */
  sellGun(g, c, cmd, s) {
    if (g.phase !== 'port') return;
    const item = s.items[cmd.item]; if (!item) return;
    const price = gunPrice(item.id);
    s.items.splice(cmd.item, 1);
    c.wallet += price;
    g.log('loot', `💰 ${c.name} sold the ${SHIP_GUNS[item.id].name} for ${price}.`);
  },
  uninstall(g, c, cmd, s) {
    if (c.cls !== 'missiletech') return;
    const gun = s.guns[cmd.gun]; if (!gun) return;
    s.guns.splice(cmd.gun, 1); s.items.push({ id: gun.id });
  },
  /** Move a gun up the rack (the first ones get power first). */
  gunUp(g, c, cmd, s) { const i = cmd.gun; if (c.cls !== 'missiletech' || i <= 0 || !s.guns[i]) return; [s.guns[i - 1], s.guns[i]] = [s.guns[i], s.guns[i - 1]]; },
  /** Scientist: move a power cell into (+1) or out of (-1) a system. */
  power(g, c, cmd, s) {
    if (c.cls !== 'scientist') return { error: 'Only the scientist routes power' };
    const k = cmd.sys; if (!POWER_SYS[k]) return;
    const a = s.power.alloc;
    if (cmd.d > 0 && g.powerUsed() < s.power.cells && a[k] < POWER_SYS[k].max) a[k]++;
    if (cmd.d < 0 && a[k] > 0) a[k]--;
  },
  /** Downed: pick where you get back up (any crew quarters, or your own room). */
  spawnPick(g, c, cmd) {
    const opts = g.spawnRooms(c);
    if (!opts.length) return;
    if (cmd.room != null && opts.includes(cmd.room)) c.spawnPick = cmd.room;
    else { const i = opts.indexOf(c.spawnPick); c.spawnPick = opts[((i < 0 ? 0 : i) + (cmd.d || 1) + opts.length) % opts.length]; }
  },
  /** Chameleon: crawl from this vent to any other one (ours or theirs). */
  vent(g, c, cmd) {
    if (c.cls !== 'chameleon' || !c.alive) return;
    const from = g.objs.find((o) => o.kind === 'vent' && o.id === cmd.from);
    const to = g.objs.find((o) => o.kind === 'vent' && o.id === cmd.to);
    if (!from || !to || to.broken || from === to || dist(from, c) > 6 * TILE) return;
    ventTo(g, c, from, to);
  },
  water(g, c, cmd, s) {
    const p = s.farm.plots[cmd.plot]; if (!p || p.stage === 0 || p.stage >= 3 || p.wet) return;
    p.wet = true; gainXp(g, c, 1);
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
    const free = g.freeSlots(cmd.type);
    const slot = free.find((f) => f.sx === cmd.sx && f.sy === cmd.sy) || g.freeSlotNear(cmd.type);
    if (!slot) return;
    c.wallet -= cost;
    g.ourRooms.push({ type: cmd.type, sx: slot.sx, sy: slot.sy });
    g.layoutShip();
    g.log('ship', `🏗 New ${ROOMS[cmd.type].name} installed. The ship grows.`);
  },
  /** Spend XP on a star (personal upgrades are earned by doing your job). */
  classUpgrade(g, c, cmd) {
    const k = cmd.track; if (k < 0 || k > 2) return;
    const lvl = c.upgrades[k]; if (lvl >= CLASS_UP_MAX) return;
    const cost = xpCost(lvl);
    if ((c.xp || 0) < cost) return;
    c.xp -= cost; c.upgrades[k]++; c.starHint = false;
    recalcCrewHp(c);
    g.recalcShip();
    g.fx({ t: 'text', x: c.x, y: c.y - 24, text: `★ ${CLASS_UPGRADES[c.cls][k][0]} ${c.upgrades[k]}`, color: '#7cc8ff' });
  },
  /** Take over any crew member nobody else is playing, any time. A bot keeps your old job going. */
  switchClass(g, c, cmd) {
    if (g.phase === 'gameover' || g.phase === 'ending') return;
    let t = g.crew.find((x) => x.cls === cmd.cls && !x.human);
    // anyone can choose to become the Urchid (troll class): one signs on if there isn't a free one
    if (!t && cmd.cls === 'urchid') { g.ensureRoomFor('urchid'); t = g.addCrew('urchid'); }
    if (!t) return;
    c.human = false; c.bot = {}; c.atHelm = false;
    t.human = true; t.bot = {};
    if (g.player === c) g.player = t;
    g.log('crew', `🔁 ${c.player || c.name} takes over ${t.name} the ${CLASSES[t.cls].name}. A bot keeps ${c.name}'s job going.`);
    g.fx({ t: 'switch', from: c.id, to: t.id });
  },
  // ---- stations
  cook(g, c, cmd, s) {
    if (c.cls !== 'chef' || c.cooking) return;
    const kitchen = g.rooms.find((r) => r.owner === 'us' && r.type === 'kitchen');
    if (!kitchen || kitchen.sys.hp <= 0) return;
    const rec = RECIPES.find((r) => r.id === cmd.recipe); if (!rec) return;
    if (g.pw('kitchen') < rec.power) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: `needs ${rec.power} galley power`, color: '#ccc' }); return; }
    if (!Object.entries(rec.needs).every(([k, v]) => (s.food[k] || 0) >= v)) return;
    for (const [k, v] of Object.entries(rec.needs)) s.food[k] -= v;
    c.cooking = { recipe: rec.id, t: 6 / (1 + 0.25 * g.pw('kitchen')), target: cmd.target || 'all' };
  },
  research(g, c, cmd, s) {
    if (s.researching) return;
    const r = RESEARCH.find((x) => x.id === cmd.id);
    if (!r || s.research.has(r.id) || s.scrap < r.scrap) return;
    s.scrap -= r.scrap;
    s.researching = { id: r.id, time: r.time, progress: 0 };
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
    gainXp(g, c, 2);
  },
  harvest(g, c, cmd, s) {
    const p = s.farm.plots[cmd.plot]; if (!p || p.stage < 3) return;
    p.stage = 0; p.t = 0;
    const n = 1 + (g.rng.chance(0.3) ? 1 : 0);
    s.food.crops = (s.food.crops || 0) + n;
    c.wallet += 4 * n;
    gainXp(g, c, 6);
    g.fx({ t: 'text', x: c.x, y: c.y - 20, text: `+${n} crop`, color: '#c8b040' });
  },
  sellCrops(g, c, cmd, s) {
    // to the chef (ship pantry) for money, or at a port
    const n = s.food.crops || 0; if (!n || g.phase !== 'port') return;
    s.food.crops = 0; c.wallet += n * (8 + g.tier * 2);
  },
  craftGun(g, c, cmd, s) {
    if (c.cls !== 'commando' || s.scrap < 15) return;
    // one per crew member: guns already made (held, or lying around) count
    const made = g.crew.filter((x) => x.makeshift?.ammo > 0).length + g.pickups.filter((p) => p.kind === 'gun').length;
    if (made >= g.crew.filter((x) => x.cls !== 'urchid').length) { g.fx({ t: 'text', x: c.x, y: c.y - 20, text: 'everyone has one already', color: '#ffb0a0' }); return { error: 'One makeshift gun per crew member' }; }
    s.scrap -= 15;
    const armory = g.rooms.find((r) => r.owner === 'us' && r.type === 'armory') || g.rooms.find((r) => r.owner === 'us');
    // anyone can pick it up and fire it; when it's empty it falls apart into 1 scrap
    dropPickup(g, armory.station.x + 30, armory.station.y + 40, 'gun', 1, c.upgrades[2]);
    gainXp(g, c, 8);
    g.log('ship', `${c.name} mashed broken parts into a makeshift gun. Anyone can grab it from the ${armory.name}.`);
  },
  spin(g, c) { if (c.cls === 'slots' && c.cd.f <= 0) { if (spinSlots(g, c) !== false) c.cd.f = 1.2; } },
  buyIntel(g, c) { if (c.cls === 'agent' && g.phase === 'port' && c.wallet >= 40) { c.wallet -= 40; c.missionRank = (c.missionRank || 0) + 1; g.log('loot', `${c.name} swapped "knowledge" with a contact at the bar. More targets next fight.`); g.markedBonus = (g.markedBonus || 0) + 1; } },
  /** Monster trainer: pick the starter pet (grass, fire, water or electric). */
  pickStarter(g, c, cmd) { if (c.cls === 'trainer' && STARTER_MONSTERS.some((s) => s.id === cmd.id)) { g.giveStarter(c, cmd.id, false); g.log('crew', `${c.name} picks ${STARTER_MONSTERS.find((s) => s.id === cmd.id).name} as a starter!`); } },
  /** Agent 013: put on the mark's crew uniform (or take it off). Enemies don't shoot at a disguise until it shoots first. */
  disguise(g, c, cmd) {
    if (c.cls !== 'agent') return;
    if (cmd.off) { c.disguise = null; return; }
    // (the mark on the latest report; any live mark if that one's gone)
    const m = g.mobs.find((x) => x.alive && x.id === g.mission?.target) || g.mobs.find((x) => x.alive && x.marked);
    const type = m ? m.type : g.mission?.type;
    if (type == null) return;
    c.disguise = type;
    g.fx({ t: 'poof', x: c.x, y: c.y });
    say(g, c, 'Nobody look at me. I\'m one of you.');
  },
  /** The trader (random event): missiles and scrap both ways, and their weird guns. */
  trade(g, c, cmd, s) {
    const T_ = g.trader; if (!T_) return;
    switch (cmd.what) {
      case 'sellMissile': if (s.missiles > 0) { s.missiles--; c.wallet += T_.missileBuy; } break;
      case 'buyMissile': if (c.wallet >= T_.missilePrice && s.missiles < s.missilesMax) { c.wallet -= T_.missilePrice; s.missiles++; } break;
      case 'sellScrap': if (s.scrap >= 20) { s.scrap -= 20; c.wallet += T_.scrapBuy; } break;
      case 'buyScrap': if (c.wallet >= T_.scrapPrice) { c.wallet -= T_.scrapPrice; s.scrap += 20; } break;
      case 'buyGun': {
        const id = T_.guns[cmd.i]; const G = SHIP_GUNS[id];
        if (!G || c.wallet < G.cost) return;
        c.wallet -= G.cost; T_.guns.splice(cmd.i, 1);
        s.items.push({ id });
        g.log('loot', `🔫 ${c.name} bought a ${G.name} from the trader. The missile tech can install it.`);
        break;
      }
    }
  },
  pause(g, c, cmd) { g.paused = !!cmd.on; },
  release(g, c, cmd) { const i = c.monsters.findIndex((m) => m.type === cmd.type && !m.out); if (i >= 0) c.monsters.splice(i, 1); },
};
export { COMMANDS };

/** A finished run, for the leaderboard: who played, how far they got, what happened. */
Game.prototype.runSummary = function (extra = {}) {
  const g = this;
  return {
    ship: g.ship.name, score: g.finalScore(), depthKm: g.depthKm, level: g.level,
    result: g.phase === 'ending' ? (g.joe.state === 'saved' ? 'reached the core with Joe' : 'reached the core') : g.phase === 'gameover' ? `lost at -${g.depthKm}km` : `stopped at -${g.depthKm}km`,
    won: g.phase === 'ending', joe: g.joe.state, path: g.path || null, time: Math.round(g.time),
    stats: { kills: g.stats.kills, gems: g.stats.gems, repairs: g.stats.repairs, captures: g.stats.captures, insults: g.stats.insults, cleaned: g.stats.cleaned, meals: g.stats.meals },
    crew: g.crew.map((c) => ({ name: c.name, cls: c.cls, player: c.player || (c.human ? extra.playerName || 'player' : null), stars: c.upgrades.reduce((a, b) => a + b, 0), kills: c.kills || 0 })),
    upgrades: { ...g.ship.up }, guns: (g.ship.guns || []).map((x) => x.id), rooms: g.ourRooms.length,
    ...extra,
  };
};

Game.prototype.endGame = function () {
  this.setPhase('ending');
  const lines = this.joe.state === 'saved' ? ENDINGS.brother : ENDINGS.easy;
  this.endLines = lines;
  this.makeIsland();
  this.fx({ t: 'ending', brother: this.joe.state === 'saved' });
};

/**
 * The center of the world: an island. The dirt opens onto a sea, the ship beaches itself, the gangplanks
 * drop, and everybody walks out onto the sand while the credits roll.
 */
Game.prototype.makeIsland = function () {
  this.cleanupEnemy();
  for (const m of this.mobs) if (m.team === 'enemy') m.alive = false;
  this.mobs = this.mobs.filter((m) => m.alive);
  this.projs = []; this.objs = this.objs.filter((o) => o.kind !== 'fire' && o.kind !== 'mess');
  const B = this.box, G = this.grid;
  const cx = (B.x0 + B.x1) / 2, cy = (B.y0 + B.y1) / 2;
  const rx = (B.x1 - B.x0) / 2 + 13, ry = (B.y1 - B.y0) / 2 + 11;
  // sand all round the ship, with a wobbly shoreline
  for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
    const i = idx(x, y);
    if (G.tiles[i] !== T.VOID) continue;
    const a = Math.atan2(y - cy, x - cx);
    const wob = 1 + 0.08 * Math.sin(a * 5 + 1.3) + 0.05 * Math.sin(a * 11);
    if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < wob * wob) { G.tiles[i] = T.SAND; G.hp[i] = 0; G.room[i] = -1; }
  }
  // gangplanks: open the outer hull in a few places (middle of each side, and a couple more)
  const exits = [];
  for (const i of this.hullTiles || []) {
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    const out = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => G.get(x + dx, y + dy) === T.SAND);
    const inn = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => G.get(x + dx, y + dy) === T.FLOOR);
    if (out && inn) exits.push({ i, x, y });
  }
  const picks = [];
  for (const target of [[cx, B.y0], [cx, B.y1], [B.x0, cy], [B.x1, cy], [cx - rx / 2, B.y1], [cx + rx / 2, B.y0]]) {
    let best = null, bd = Infinity;
    for (const e of exits) { const d = Math.hypot(e.x - target[0], e.y - target[1]); if (d < bd) { bd = d; best = e; } }
    if (best && !picks.includes(best)) picks.push(best);
  }
  for (const e of picks) for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = idx(e.x + dx, e.y + dy); if (G.tiles[j] === T.HULL || G.tiles[j] === T.BREACH) { G.tiles[j] = T.FLOOR; G.hp[j] = 0; } }
  G.version++;
  // palm trees, a hut, treasure, fruit (the island makes everything for you)
  const sand = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) if (G.tiles[i] === T.SAND) sand.push(i);
  const at = (i) => ({ x: ((i % MAP_W) + 0.5) * TILE, y: (((i / MAP_W) | 0) + 0.5) * TILE });
  for (let k = 0; k < 26 && sand.length; k++) { const p = at(this.rng.pick(sand)); this.objs.push({ id: uid(), kind: 'palm', x: p.x, y: p.y, s: this.rng.range(0.8, 1.3), a: this.rng.range(0, 6) }); }
  for (let k = 0; k < 6 && sand.length; k++) { const p = at(this.rng.pick(sand)); this.objs.push({ id: uid(), kind: 'crate', island: true, x: p.x, y: p.y, owner: 'island', gems: 20, gemVal: 120 }); }
  for (let k = 0; k < 30 && sand.length; k++) { const p = at(this.rng.pick(sand)); dropPickup(this, p.x, p.y, this.rng.chance(0.5) ? 'crop' : 'gem', 1); }
  for (let k = 0; k < 3 && sand.length; k++) { const p = at(this.rng.pick(sand)); this.objs.push({ id: uid(), kind: 'hut', x: p.x, y: p.y }); }
  this.island = { rx, ry, cx, cy };
  for (const c of this.crew) { c.alive = true; c.hp = c.maxHp; c.atHelm = false; c.phased = false; c.riding = null; }
  this.log('story', '🏝 The dirt opens up onto a warm sea, and in the middle of it: an island. The gangplanks drop. Go on, have a look around.');
};

/** On the island: everyone just walks around, picks up treasure, and enjoys it. Nothing attacks. */
Game.prototype.islandTick = function (dt) {
  if (this.time - (this.fieldsAt || -9) > 1) rebuildFields(this);
  this.updateDoors(dt);
  for (const c of this.crew) {
    if (!c.alive) { c.alive = true; c.hp = c.maxHp; }
    const inp = c.human ? (this.inputs.get(c.id) || {}) : botInput(this, c, dt);
    crewTick(this, c, inp, dt);
    if (c.human && inp.pressed) inp.pressed = {};
  }
  for (const m of this.mobs) mobTick(this, m, dt);
  updateProjectiles(this, dt);
  updatePickups(this, dt);
};
