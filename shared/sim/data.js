// Do I Go? — game data. Everything tunable lives here.
// Pure data: shared by the browser (solo) and the server (multiplayer).

export const TILE = 32;
export const SLOT_W = 10;         // a room slot is 10x7 tiles (walls shared with neighbours)
export const SLOT_H = 7;
export const RING = 3;            // the walkway around our whole ship: 2 tiles of floor + 1 of hull
export const MAP_W = 126;         // whole world, in tiles (our ship in the middle, enemy ships dock above and below)
export const MAP_H = 93;
export const SHIP_COLS = 11;      // our ship can grow to 11 x 6 rooms
export const SHIP_ROWS = 6;
export const SHIP_OX = 8;         // tile origin of our ship's slot (0,0)
export const SHIP_OY = 25;
export const ENEMY_OY = 2;        // highest row an enemy ship can sit at
export const ENEMY_GAP = 5;       // dirt between a docked enemy ship and our hull (the boarding tunnel)
export const MAX_DOCKED = 4;      // up to 4 enemy ships at once, deep down
export const SHIP_UP_MAX = 10;    // ship upgrade levels
export const CLASS_UP_MAX = 8;    // personal upgrade levels

export const LEVELS = 30;         // descents from the surface to the core
export const EARTH_KM = 6371;
export const KM_PER_LEVEL = EARTH_KM / LEVELS;

export const SPLASH = 'another insane game by commanderstitch, right, yeah that guy again... what an urchid';

// ---------------------------------------------------------------------------
// Tiles
// DEBRIS: wreckage that blocks the way until somebody clears (repairs) it.
export const T = { VOID: 0, FLOOR: 1, WALL: 2, DOOR: 3, TUNNEL: 4, BREACH: 5, RUBBLE: 6, HULL: 7, ICE: 8, DEBRIS: 9 };
export const TILE_HP = { [T.WALL]: 90, [T.HULL]: 140, [T.DOOR]: 60, [T.ICE]: 40, [T.DEBRIS]: 50 };
export const BLAST_DOOR_HP = 220;

// ---------------------------------------------------------------------------
// Rooms. `cls` = the class whose job lives here. `sys` = the system the room powers.
export const ROOMS = {
  bridge:   { name: 'Bridge',            cls: 'pilot',      sys: 'helm',     hp: 140, color: '#2f4a5c', icon: 'helm' },
  engine:   { name: 'Engine Room',       cls: 'engineer',   sys: 'engine',   hp: 120, color: '#4a3a2a', icon: 'engine' },
  weapons:  { name: 'D-Weapons Bay',     cls: 'missiletech',sys: 'weapons',  hp: 120, color: '#4c2a2a', icon: 'missile' },
  shield:   { name: 'Bubble Generator',  cls: 'scientist',  sys: 'shield',   hp: 100, color: '#25404a', icon: 'bubble' },
  hall:     { name: 'Feeder Hall',       cls: null,         sys: 'feeder',   hp: 80,  color: '#3a3128', icon: 'feeder' },
  lounge:   { name: "Urchid's Lounge",   cls: 'urchid',     sys: 'lounge',   hp: 60,  color: '#4a2f4a', icon: 'chair' },
  vault:    { name: 'Vault',             cls: 'guard',      sys: 'vault',    hp: 160, color: '#3d3d24', icon: 'vault' },
  kitchen:  { name: 'Galley',            cls: 'chef',       sys: 'kitchen',  hp: 80,  color: '#4a3524', icon: 'pot' },
  closet:   { name: 'Janitor Closet',    cls: 'mrclean',    sys: 'closet',   hp: 70,  color: '#2f3f36', icon: 'broom' },
  armory:   { name: 'Armory',            cls: 'commando',   sys: 'armory',   hp: 100, color: '#3a3a30', icon: 'crate' },
  farm:     { name: 'Dirt Farm',         cls: 'farmer',     sys: 'farm',     hp: 70,  color: '#3b3a1c', icon: 'crop' },
  lab:      { name: 'Laboratory',        cls: 'scientist',  sys: 'lab',      hp: 90,  color: '#24304a', icon: 'flask' },
  kennel:   { name: 'Kennel',            cls: 'dog',        sys: 'kennel',   hp: 60,  color: '#45362a', icon: 'bone' },
  pen:      { name: 'Monster Pen',       cls: 'trainer',    sys: 'pen',      hp: 110, color: '#2d4030', icon: 'cube' },
  den:      { name: 'Vent Den',          cls: 'chameleon',  sys: 'den',      hp: 60,  color: '#25332c', icon: 'vent' },
  bubbler:  { name: 'Bubble Grotto',     cls: 'jorbal',     sys: 'bubbler',  hp: 60,  color: '#1f4040', icon: 'bubble' },
  office:   { name: 'Field Office',      cls: 'agent',      sys: 'office',   hp: 80,  color: '#262626', icon: 'watch' },
  casino:   { name: 'Casino Nook',       cls: 'slots',      sys: 'casino',   hp: 80,  color: '#4a2430', icon: 'slot' },
  guardpost:{ name: 'Guard Post',        cls: 'vaelift',    sys: 'guardpost',hp: 100, color: '#30304a', icon: 'staff' },
  storage:  { name: 'Storage',           cls: null,         sys: 'storage',  hp: 90,  color: '#33302a', icon: 'crate' },
  quarters: { name: 'Crew Quarters',     cls: null,         sys: 'quarters', hp: 80,  color: '#33283a', icon: 'bed' },
  corridor: { name: 'Corridor',          cls: null,         sys: null,       hp: 60,  color: '#2b2521', icon: null },
};

// Rooms the crew can buy at ports to expand the ship.
export const BUYABLE_ROOMS = [
  { type: 'engine',   cost: 160, desc: 'Another engine: faster descent, more fuel burn, more for the engineers to fix.' },
  { type: 'storage',  cost: 90,  desc: '+40 vault capacity. Gems overflow without it.' },
  { type: 'quarters', cost: 80,  desc: 'Crew respawn faster (and closer).' },
  { type: 'hall',     cost: 110, desc: 'Another auto-feeder hall. More gems, ore and food rain down.' },
  { type: 'corridor', cost: 30,  desc: 'Just a hallway. Connects things. Chokepoints are strategy.' },
];

// ---------------------------------------------------------------------------
// Classes. Order = order they join the crew.
// clearance: can open sealed doors during a docking.
export const CLASSES = {
  pilot: {
    name: 'Pilot', def: 'Zap', room: 'bridge', color: '#4fa3e0', hp: 100, speed: 150, clearance: true, unlock: 0,
    weapon: 'pistol',
    abilities: { q: 'evasive', f: 'rally' },
    blurb: 'Drives the ship. At the helm: steer the descent, pick the route, dodge enemy fire with evasive maneuvers.',
  },
  engineer: {
    name: 'Engineer', def: 'Angie', room: 'engine', color: '#f0a030', hp: 110, speed: 140, clearance: true, unlock: 0,
    weapon: 'wrench',
    abilities: { q: 'turret', f: 'trap' },
    blurb: 'Keeps the engines alive by hitting them with a wrench. Builds gun turrets and shock traps. Territory safety.',
  },
  urchid: {
    name: 'Urchid', def: 'Reeser', room: 'lounge', color: '#c070d0', hp: 999, speed: 120, clearance: false, unlock: 0,
    weapon: 'heckle',
    abilities: { q: 'insult', f: 'ghost' },
    troll: true,
    blurb: 'WARNING: troll class. Contributes nothing. Cannot die. Insults the crew from a lounge chair. Solo = story mode.',
  },
  guard: {
    name: 'Guard', def: 'Keen', room: 'vault', color: '#7c8cff', hp: 120, speed: 185, clearance: true, unlock: 1,
    weapon: 'dualpistol',
    abilities: { q: 'lunge', f: 'lockdown' },
    blurb: 'Fastest patrol on the ship. Seeker sense shows every enemy through walls. Guards, repairs and grows the vault.',
  },
  chef: {
    name: 'Chef', def: 'Preeda', room: 'kitchen', color: '#f07070', hp: 100, speed: 145, clearance: false, unlock: 2,
    weapon: 'cleaver',
    abilities: { q: 'knives', f: 'fish' },
    blurb: 'Cooks recipes from feeder food and farm crops, then teleports meals to the crew. Buffs with tiny side-effects.',
  },
  mrclean: {
    name: 'MrClean', def: 'Buffy', room: 'closet', color: '#60d090', hp: 150, speed: 140, clearance: false, unlock: 2,
    weapon: 'axe',
    abilities: { q: 'whirlwind', f: 'deepclean' },
    blurb: 'Buff melee expert. Chops anything that walks, talks or sings. Sweeps up dirt and gore: a clean ship is a fast crew.',
  },
  missiletech: {
    name: 'Missile Technician', def: 'Bree', room: 'weapons', color: '#ff6a3a', hp: 110, speed: 140, clearance: false, unlock: 3,
    weapon: 'rocket',
    abilities: { q: 'barrage', rmb: 'chainsaw' },
    blurb: 'Builds and fires dirt missiles at docked enemy ships, choosing exactly which room to hit. Rockets and a chainsaw.',
  },
  commando: {
    name: 'Commando', def: 'Sargent Stin', room: 'armory', color: '#90a050', hp: 130, speed: 150, clearance: false, unlock: 3,
    weapon: 'rifle',
    abilities: { q: 'grenade', f: 'tnt' },
    blurb: 'Grenades, TNT, assault rifles, headband. Mashes broken ship parts into makeshift guns for the crew.',
  },
  farmer: {
    name: 'Farmer', def: 'Dood', room: 'farm', color: '#c8b040', hp: 120, speed: 140, clearance: false, unlock: 4,
    weapon: 'shotgun',
    abilities: { q: 'pitchfork', f: 'feast' },
    blurb: 'Hauls the dirt that leaks in, farms it, and sells boosted crops to the chef. Shotgun and pitchfork.',
  },
  scientist: {
    name: 'Scientist', def: 'York', room: 'lab', color: '#50c8e8', hp: 90, speed: 140, clearance: true, unlock: 4,
    weapon: 'jar',
    abilities: { q: 'jarswap', f: 'overclock' },
    blurb: 'Researches upgrades, scans enemy ships, routes power. Throws jars of poison, acid and explosives. Says big words.',
  },
  dog: {
    name: 'Dog', def: 'Ruff', room: 'kennel', color: '#b08050', hp: 110, speed: 230, clearance: false, unlock: 5,
    weapon: 'bite',
    abilities: { q: 'pounce', f: 'howl' },
    blurb: 'A dog. Eats people. Incredibly fast. Dog sense shows enemy footsteps as ripples in the dark.',
  },
  chameleon: {
    name: 'Chameleon', def: 'Needle', room: 'den', color: '#40a070', hp: 90, speed: 155, clearance: false, unlock: 5,
    weapon: 'dagger',
    abilities: { q: 'cloak', f: 'smoke' },
    blurb: 'Cloaks, sneaks, assassinates. Crawls through vents between rooms. Sneak onto the enemy ship and end their pilot.',
  },
  trainer: {
    name: 'Monster Trainer', def: 'Dyke', room: 'pen', color: '#70b070', hp: 110, speed: 140, clearance: false, unlock: 6,
    weapon: 'whip',
    abilities: { q: 'capture', f: 'summon' },
    blurb: 'Throws cubes at weakened enemies to capture them, then summons them to fight. Knocked-out monsters revive in the pen.',
  },
  jorbal: {
    name: 'Jorbal', def: 'Miney', room: 'bubbler', color: '#60d060', hp: 110, speed: 145, clearance: false, unlock: 6,
    weapon: 'bubble',
    abilities: { q: 'bigbubble', f: 'burst', space: 'hop' },
    blurb: 'A green dinosaur that blows bubbles. Trap enemies, pop them into food, chain the pops. Ride bubbles on the air currents.',
  },
  vaelift: {
    name: 'Vaelift', def: 'Bendin', room: 'guardpost', color: '#a0a0ff', hp: 120, speed: 165, clearance: true, unlock: 7,
    weapon: 'staff',
    abilities: { q: 'phase', f: 'staffform', rmb: 'icecube' },
    blurb: 'Premium guard. Phases into an empty dimension at will. The Vurfenstaff becomes any weapon. Ice cubes block bullets.',
  },
  agent: {
    name: 'Agent', def: '013', room: 'office', color: '#d0d0d0', hp: 105, speed: 155, clearance: true, unlock: 7,
    weapon: 'ppk',
    abilities: { q: 'mine', f: 'minetype' },
    blurb: 'Gets marked targets on his watch. Takes them out with a Walther PPK for big money. Mines, C4, a suit at all times.',
  },
  slots: {
    name: 'Slot Machine', def: 'Slots', room: 'casino', color: '#f0d040', hp: 140, speed: 130, clearance: false, unlock: 8,
    weapon: 'coins',
    abilities: { q: 'roll', f: 'spin' },
    blurb: 'Literally a slot machine. Rolls over enemies, fires coins, plays itself. Winning doubles the money you pick up.',
  },
};
export const CLASS_ORDER = Object.keys(CLASSES);
export const CREW_HP_MUL = 1.4;     // everyone is a bit tougher than the numbers above
export const BULLET_SLOW = 0.7;     // bullets fly at 70% of their listed speed (same range): dodgeable, readable fights
export const STARTER_CLASSES = ['pilot', 'engineer', 'urchid'];

// ---------------------------------------------------------------------------
// Weapons (primary fire). kind: bullet | melee | special
export const WEAPONS = {
  pistol:     { kind: 'bullet', dmg: 11, rate: 0.32, speed: 620, spread: 0.04, range: 520 },
  dualpistol: { kind: 'bullet', dmg: 9,  rate: 0.16, speed: 660, spread: 0.07, range: 520 },
  rifle:      { kind: 'bullet', dmg: 8,  rate: 0.09, speed: 720, spread: 0.09, range: 600 },
  shotgun:    { kind: 'bullet', dmg: 7,  rate: 0.75, speed: 560, spread: 0.32, range: 260, pellets: 7 },
  ppk:        { kind: 'bullet', dmg: 20, rate: 0.36, speed: 760, spread: 0.02, range: 640 },
  coins:      { kind: 'bullet', dmg: 9,  rate: 0.12, speed: 560, spread: 0.12, range: 420, cost: 1 },
  rocket:     { kind: 'rocket', dmg: 42, rate: 1.05, speed: 380, spread: 0,    range: 600, radius: 70 },
  jar:        { kind: 'jar',    dmg: 0,  rate: 0.7,  speed: 330, spread: 0,    range: 340 },
  bubble:     { kind: 'bubble', dmg: 0,  rate: 0.38, speed: 170, spread: 0.05, range: 600 },
  wrench:     { kind: 'melee',  dmg: 17, rate: 0.42, range: 40, arc: 1.7, repair: 9 },
  cleaver:    { kind: 'melee',  dmg: 19, rate: 0.36, range: 38, arc: 1.5 },
  axe:        { kind: 'melee',  dmg: 31, rate: 0.62, range: 46, arc: 2.5, knock: 140 },
  whip:       { kind: 'melee',  dmg: 13, rate: 0.40, range: 62, arc: 0.7 },
  dagger:     { kind: 'melee',  dmg: 18, rate: 0.34, range: 34, arc: 1.2, backstab: 4 },
  bite:       { kind: 'melee',  dmg: 21, rate: 0.30, range: 32, arc: 1.4, lifesteal: 0.35 },
  staff:      { kind: 'melee',  dmg: 15, rate: 0.40, range: 50, arc: 2.0, knock: 180 },
  heckle:     { kind: 'heckle', dmg: 0,  rate: 0.9 },
};

// Ability cooldowns (seconds) and costs.
export const ABILITIES = {
  evasive:   { name: 'Evasive Maneuvers', cd: 18, desc: 'At the helm during a docking: enemy D-fire misses for 4s.' },
  rally:     { name: 'Rally the Crew',    cd: 30, desc: 'Everyone in your room moves and shoots 25% faster for 6s.' },
  turret:    { name: 'Gun Turret',        cd: 6,  cost: { scrap: 15 }, desc: 'Build an auto-turret (15 scrap).' },
  trap:      { name: 'Shock Trap',        cd: 4,  cost: { scrap: 5 },  desc: 'Place a shock trap that stuns (5 scrap).' },
  insult:    { name: 'Insult',            cd: 2.5, desc: 'Mock a crewmate. Better insults unlock deeper down.' },
  ghost:     { name: 'Ghost Mode',        cd: 0.5, desc: "Look through another crewmate's eyes." },
  lunge:     { name: 'Sword Lunge',       cd: 6,  desc: 'Dash forward and slash everything in your path.' },
  lockdown:  { name: 'Lockdown',          cd: 25, desc: 'Reinforce the vault and every door in this room (+100% HP).' },
  knives:    { name: 'Knife Volley',      cd: 5,  desc: 'Throw a fan of kitchen knives.' },
  fish:      { name: 'Frozen Fish Slap',  cd: 9,  desc: 'Slap a cone with a frozen fish. Stuns.' },
  whirlwind: { name: 'Whirlwind',         cd: 8,  desc: 'Spin with the axe, hitting everything around you.' },
  deepclean: { name: 'Deep Clean',        cd: 30, desc: 'Scrub the whole room spotless. Crew here get a speed buff.' },
  barrage:   { name: 'Rocket Barrage',    cd: 14, desc: 'Fire three rockets at once.' },
  chainsaw:  { name: 'Chainsaw',          cd: 0,  desc: 'Hold right mouse: near-perfect melee in one direction. VRRRM.' },
  grenade:   { name: 'Grenade',           cd: 4,  desc: 'Bouncy grenade, 1.6s fuse.' },
  tnt:       { name: 'TNT',               cd: 14, desc: 'Plant TNT. 3 seconds. Run.' },
  pitchfork: { name: 'Pitchfork Sweep',   cd: 5,  desc: 'Knock back everything in front of you.' },
  feast:     { name: 'Harvest Snack',     cd: 20, cost: { crops: 1 }, desc: 'Eat a crop: heal 50.' },
  jarswap:   { name: 'Swap Jar',          cd: 0.3, desc: 'Cycle poison / acid / explosive jars.' },
  overclock: { name: 'Overclock',         cd: 1,  desc: 'Route spare power to a system (at the lab).' },
  pounce:    { name: 'Pounce',            cd: 4,  desc: 'Leap and bite.' },
  howl:      { name: 'Howl',              cd: 20, desc: 'Enemies nearby flee in terror for 3s.' },
  cloak:     { name: 'Cloak',             cd: 1,  desc: 'Blend in. Move slowly to stay hidden. Attacking reveals you.' },
  smoke:     { name: 'Smoke Bomb',        cd: 12, desc: 'Blind everyone nearby and re-cloak instantly.' },
  capture:   { name: 'Capture Cube',      cd: 3,  desc: 'Throw a cube. Captures enemies under 35% HP (one per type).' },
  summon:    { name: 'Summon',            cd: 1.5, desc: 'Summon the next monster from your roster (or recall).' },
  bigbubble: { name: 'Big Bubble',        cd: 7,  desc: 'A huge bubble that can trap big enemies.' },
  burst:     { name: 'Bubble Burst',      cd: 6,  desc: 'Pop every bubble near you. Chains!' },
  hop:       { name: 'Hop',               cd: 0.6, desc: 'Jump onto a bubble and ride the air currents.' },
  phase:     { name: 'Phase Shift',       cd: 6,  desc: 'Slip into the empty dimension. Untouchable, unseen.' },
  staffform: { name: 'Vurfenstaff',       cd: 0.4, desc: 'Change the staff: staff / blade / rifle / shotgun.' },
  icecube:   { name: 'Ice Cube',          cd: 4,  desc: 'Summon a block of ice that stops bullets.' },
  mine:      { name: 'Place Mine',        cd: 2.5, desc: 'Place the selected mine (remote mines: press again to detonate).' },
  minetype:  { name: 'Mine Type',         cd: 0.3, desc: 'Cycle proximity / timed / remote / C4.' },
  roll:      { name: 'Roll',              cd: 3,  desc: 'Roll forward, crushing enemies into coins.' },
  spin:      { name: 'Spin the Reels',    cd: 1.2, desc: 'Play yourself (5 money). Wins double your pickups.' },
};

// ---------------------------------------------------------------------------
// Personal upgrades: 3 tracks per class, 5 levels each. cost = base * level.
export const CLASS_UPGRADES = {
  pilot:       [['Steady Hands', 'Steering is smoother, obstacle hits hurt less'], ['Afterburner', 'Boost burns less fuel'], ['Blaster', '+20% pistol damage']],
  engineer:    [['Heavy Wrench', '+25% wrench repair and damage'], ['Turret Mk', 'Turrets: +1 max, +damage'], ['Tesla Traps', 'Traps stun longer, shock more']],
  urchid:      [['Comfier Chair', 'The chair reclines further. Nothing else.'], ['Sharper Tongue', 'Unlocks meaner insults'], ['Coconut Refills', 'More coconut juice']],
  guard:       [['Vault Mastery', '+50% vault capacity per level'], ['Hollow Points', '+20% pistol damage'], ['Sprint', '+8% move speed']],
  chef:        [['Recipe Book', 'Meals last longer'], ['Sharper Knives', '+1 knife per volley, +damage'], ['Bigger Fridge', 'Cook two portions at once']],
  mrclean:     [['Biceps', '+20% axe damage'], ['Super Broom', 'Sweep 2x faster'], ['Squeaky Clean', 'Clean-ship buff is stronger']],
  missiletech: [['Warheads', '+25% D-missile damage'], ['Fast Assembly', 'Build missiles faster'], ['Bigger Rockets', '+blast radius']],
  commando:    [['Extended Mag', '+25% rifle fire rate'], ['Bigger Boom', '+explosive damage'], ['Scrap Smith', 'Makeshift guns hit harder']],
  farmer:      [['Better Seeds', 'Crops grow faster'], ['Sawed-Off', '+2 pellets'], ['Big Plots', '+2 farm plots']],
  scientist:   [['Grant Money', 'Research 30% faster'], ['Potent Jars', '+30% jar effects'], ['Big Words', 'Even more jargon (morale +)']],
  dog:         [['Sharper Teeth', '+20% bite'], ['Fluffier Bed', 'Heal faster at the kennel'], ['Zoomies', '+10% speed']],
  chameleon:   [['Silent Steps', 'Move faster while cloaked'], ['Sharper Dagger', '+30% backstab'], ['Vent Rat', 'Vent travel is instant']],
  trainer:     [['Bigger Team', '+1 monster summoned at once'], ['Revive Tech', 'Revive time -25%'], ['Better Cubes', 'Capture at 50% HP']],
  jorbal:      [['Bigger Lungs', 'Bubbles hold enemies longer'], ['Chain Master', '+50% chain bonus'], ['Speed Blower', 'Blow bubbles faster']],
  vaelift:     [['Deep Phase', 'Phase lasts longer'], ['Staff Mastery', '+25% staff damage'], ['Glacier', 'Ice cubes last longer']],
  agent:       [['Silencer', 'PPK shots draw less attention'], ['Extended Mag', '+30% PPK fire rate'], ['Contacts', '+1 marked target per fight']],
  slots:       [['More Reels', '+1 reel (bigger payouts)'], ['Heavier Frame', 'Roll crushes harder'], ['Lucky', 'Better odds']],
};
export const UPGRADE_BASE_COST = 40;

// Ship upgrades (bought at ports). level 0..5
export const SHIP_UPGRADES = {
  plating: { name: 'Hull Plating',     cost: 70,  desc: '+60 max hull' },
  bubble:  { name: 'Bubble Defense',   cost: 80,  desc: '+1 bubble layer (blocks D-gun shots)' },
  dgun:    { name: 'D-Gun',            cost: 75,  desc: '+damage, faster D-gun' },
  dmissile:{ name: 'D-Missile',        cost: 90,  desc: '+damage, +missile stock' },
  drill:   { name: 'Drill Bits',       cost: 70,  desc: 'Faster descent' },
  feeders: { name: 'Auto-Feeders',     cost: 60,  desc: 'More pickups rain down' },
  tank:    { name: 'Fuel Tank',        cost: 50,  desc: '+40 max fuel' },
};

// ---------------------------------------------------------------------------
// Food & recipes (Chef)
export const FOODS = ['grub', 'shroom', 'fish', 'spice'];
export const RECIPES = [
  { id: 'skewers', name: 'Fried Grub Skewers', needs: { grub: 2 }, buff: { dmg: 0.25 }, side: { speed: -0.1 }, dur: 60, text: '+25% damage, a bit greasy (-10% speed)' },
  { id: 'salad',   name: 'Rock Shroom Salad',  needs: { shroom: 2 }, buff: { regen: 2 }, side: { rate: -0.08 }, dur: 60, text: 'Regenerate 2 HP/s, slower trigger finger' },
  { id: 'sticks',  name: 'Frozen Fish Sticks', needs: { fish: 2 }, buff: { speed: 0.3 }, side: { maxhp: -0.1 }, dur: 45, text: '+30% speed, brain freeze (-10% max HP)' },
  { id: 'chili',   name: 'Magma Chili',        needs: { grub: 1, shroom: 1, spice: 1 }, buff: { cd: 0.3 }, side: { armor: -0.1 }, dur: 60, text: 'Abilities recharge 30% faster, take 10% more damage' },
  { id: 'feast',   name: "Farmer's Feast",     needs: { crops: 2, spice: 1 }, buff: { dmg: 0.2, speed: 0.15, regen: 1 }, side: {}, dur: 90, text: 'A bit of everything. Farm-fresh, no downside.' },
  { id: 'stew',    name: 'Class-Special Stew', needs: { crops: 1, fish: 1, grub: 1 }, buff: { special: 1 }, side: { speed: -0.05 }, dur: 75, text: "Boosts each class's speciality (+40%)" },
];

// ---------------------------------------------------------------------------
// Research (Scientist)
export const RESEARCH = [
  { id: 'sensors',   name: 'Deep Sensors',       time: 25, scrap: 20, desc: 'See enemies in every room.' },
  { id: 'schematic', name: 'Enemy Schematics',   time: 30, scrap: 25, desc: 'D-missiles crit enemy systems (+50%).' },
  { id: 'drillbits', name: 'Diamond Drill Bits', time: 35, scrap: 30, desc: '+20% descent speed.' },
  { id: 'plating',   name: 'Adaptive Plating',   time: 35, scrap: 35, desc: 'Breaches leak 50% less.' },
  { id: 'harmonics', name: 'Bubble Harmonics',   time: 30, scrap: 30, desc: 'Bubble recharges twice as fast.' },
  { id: 'guidance',  name: 'Missile Guidance',   time: 30, scrap: 30, desc: '+25% D-missile damage.' },
  { id: 'skilltree', name: 'Skill Tree Boost',   time: 40, scrap: 40, desc: 'Every crew member +10% damage.' },
  { id: 'autodoc',   name: 'Auto-Doc',           time: 40, scrap: 40, desc: 'Downed crew get back up 40% faster.' },
];

// ---------------------------------------------------------------------------
// Enemies: a roster is generated each run from these parts.
export const RACES = [
  { id: 'mole',   body: 'round',  color: '#6b5444', eye: '#ffd0d0' },
  { id: 'rat',    body: 'long',   color: '#7a7066', eye: '#ff4040' },
  { id: 'beetle', body: 'shell',  color: '#3a5a4a', eye: '#a0ff80' },
  { id: 'worm',   body: 'worm',   color: '#b0707a', eye: '#202020' },
  { id: 'golem',  body: 'square', color: '#707a80', eye: '#60e0ff' },
  { id: 'ghoul',  body: 'round',  color: '#5a6a50', eye: '#f0f040' },
  { id: 'crab',   body: 'shell',  color: '#a04a30', eye: '#202020' },
  { id: 'bat',    body: 'wing',   color: '#4a3a5a', eye: '#ff80ff' },
  { id: 'magmite',body: 'square', color: '#a03a10', eye: '#ffe060' },
];
export const BUILDS = [
  { id: 'scrawny', size: 0.8, hp: 0.7, speed: 1.2,  dmg: 0.8 },
  { id: 'lanky',   size: 1.0, hp: 0.9, speed: 1.15, dmg: 1.0 },
  { id: 'squat',   size: 0.95,hp: 1.2, speed: 0.9,  dmg: 1.0 },
  { id: 'burly',   size: 1.3, hp: 1.8, speed: 0.8,  dmg: 1.4 },
];
// role: what they go for once aboard. brute=crew, thief=vault, saboteur=systems, carver=walls
export const ENEMY_WEAPONS = [
  { id: 'claws',  kind: 'melee',  dmg: 9,  rate: 0.7, range: 30, role: 'brute',    meleeWeak: true },
  { id: 'club',   kind: 'melee',  dmg: 16, rate: 1.1, range: 36, role: 'brute',    meleeWeak: true },
  { id: 'pistol', kind: 'bullet', dmg: 7,  rate: 1.0, range: 380, speed: 480, role: 'brute' },
  { id: 'shotgun',kind: 'bullet', dmg: 5,  rate: 1.6, range: 220, speed: 440, pellets: 5, spread: 0.35, role: 'brute' },
  { id: 'rifle',  kind: 'bullet', dmg: 5,  rate: 0.35,range: 460, speed: 560, role: 'saboteur' },
  { id: 'flamer', kind: 'flame',  dmg: 22, rate: 0.1, range: 110, role: 'saboteur' },
  { id: 'sack',   kind: 'melee',  dmg: 6,  rate: 0.8, range: 30, role: 'thief',    meleeWeak: true },
  { id: 'bomb',   kind: 'bomb',   dmg: 30, rate: 2.6, range: 260, role: 'carver' },
  { id: 'drill',  kind: 'melee',  dmg: 12, rate: 0.5, range: 34, role: 'carver',   wallDmg: 3 },
];
export const NAME_A = ['Rab', 'Bur', 'Qu', 'Grub', 'Skree', 'Mog', 'Snik', 'Dreg', 'Kob', 'Thrum', 'Glim', 'Vor', 'Nub', 'Krag', 'Slor', 'Pib', 'Zor', 'Wem', 'Fung', 'Druk'];
export const NAME_B = ['bers', 'lys', 'es', 'blins', 'chers', 'gles', 'lings', 'rots', 'kins', 'mites', 'loks', 'pers', 'sies', 'rats', 'wums'];

// Creatures roam the deep (wild monsters, no ship). Boss lives at the core.
export const CREATURES = [
  { id: 'tunnelwyrm', name: 'Tunnel Wyrm', race: 'worm',   build: 'burly',  weapon: 'claws', tierMin: 1 },
  { id: 'gemmite',    name: 'Gem Mite',    race: 'beetle', build: 'scrawny',weapon: 'claws', tierMin: 0 },
  { id: 'magmaw',     name: 'Magmaw',      race: 'magmite',build: 'squat',  weapon: 'flamer',tierMin: 2 },
  { id: 'shrieker',   name: 'Shrieker',    race: 'bat',    build: 'lanky',  weapon: 'claws', tierMin: 1 },
  { id: 'changed',    name: 'The Changed', race: 'ghoul',  build: 'lanky',  weapon: 'club',  tierMin: 3 },
];
export const BOSS = { id: 'coreking', name: 'The Core Leviathan', race: 'magmite', build: 'burly', hp: 2000, size: 3.2 };

// ---------------------------------------------------------------------------
// Route nodes the pilot picks between at the end of each descent.
export const NODE_TYPES = {
  ship:      { name: 'Enemy Dig-Ship', icon: '☠', color: '#e0533a', desc: 'They want your ship. Take theirs.' },
  port:      { name: 'Port',           icon: '⚓', color: '#7cc46a', desc: 'Shop, sell gems, refuel, recruit.' },
  fuel:      { name: 'Fuel Depot',     icon: '⛽', color: '#f4c542', desc: 'Cheap fuel and a quick patch-up.' },
  discovery: { name: 'Discovery',      icon: '✦', color: '#5ec8e8', desc: 'Something down there. Joe was here?' },
  nest:      { name: 'Creature Nest',  icon: '♨', color: '#c070d0', desc: 'Wild things. Rich gems. Bad idea?' },
  city:      { name: 'Deep City',      icon: '⌂', color: '#a0a0ff', desc: 'A whole city in the dirt. Food, music, beds.' },
  repair:    { name: 'Repair Dock',    icon: '⚒', color: '#d0d0d0', desc: 'Fix bent frames and broken engines.' },
};

export const PORT_NAMES = ['Rusty Gulch', 'Mole Harbor', 'Pebble Point', 'Old Tunnel 9', 'Gem Market', 'The Burrow', 'Ember Wharf',
  'Glowcave', 'Last Lantern', 'Basalt Bazaar', 'Driller\'s Rest', 'Fox Hollow', 'Mantle Mall', 'Hot Rock Inn'];
export const PORT_FLAVOR = [
  'A banjo fox plays something sad about the surface.',
  'The noodle stand smells like fuel. The fuel smells like noodles.',
  'Bunk beds! Real ones! With pillows!',
  'A sign says NO DRILLING IN THE LOBBY. Someone drilled the sign.',
  'The jukebox only plays one song. Everyone knows the words.',
  'A retired pilot swears she saw a fox with a journal heading deeper.',
];

// ---------------------------------------------------------------------------
// Story: Joe's notes. Found along the way. Each one gives something.
export const JOE_NOTES = [
  { text: "Day 3. Zap, if you're reading this, you came. Of course you came. The feeders jam if you don't keep the hall clear. Engines like being hit. Hard.",
    reward: { scrap: 30 }, rewardText: '+30 scrap from Joe\'s stash' },
  { text: "Day 9. Found a port with real beds. Learned something: the D-missiles go straight through bubble shields. Guns don't. Aim for their bubble room first.",
    reward: { upgrade: 'dmissile' }, rewardText: 'D-Missile upgraded (Joe\'s notes)' },
  { text: "Day 15. Bought a bigger engine. Then a third. The engineer quit. Don't buy more engines than you can keep alive. Also, I'm leaving you a blueprint.",
    reward: { room: 'engine' }, rewardText: 'Free engine room (Joe\'s blueprint)' },
  { text: "Day 22. The ships down here are bigger than ours. They dock and seal. Close your doors, guard your vault, and for the love of dirt, someone fix the doors.",
    reward: { upgrade: 'plating' }, rewardText: 'Hull plating upgraded' },
  { text: "Day 30. Something's wrong with Pell. He doesn't sleep. He hums. The crew says it's the depth. I say it's the thing we pulled out of the wall.",
    reward: { money: 60 }, rewardText: '+60 money for everyone (Joe\'s emergency fund)' },
  { text: "Day ?? the walls breathe. the walls BREATHE zap. Marna bit the cook. we locked the galley. Do I go? do i GO? the light at the center is so warm",
    reward: { upgrade: 'bubble' }, rewardText: 'Bubble defense upgraded' },
];
export const TRANSPONDER_NOTE = "IT HAPPENED. They're all changing. Something got into them through the dirt, through the vents, through the FOOD. I got out in the pod. I don't know how long I can make it. If anyone finds this — my ship is still out there. Transponder: ";
export const JOURNAL_TEXT = [
  "The journal is in Joe's ship, wedged in a skeleton's paw. Not Joe's. Too short.",
  "Last entries: 'The deeper you go, the worse they get. Every layer, the creatures are bigger and there are more of them.'",
  "'The crew didn't die. They CHANGED. They walk the tunnels now, toward the light.'",
  "'I'm taking the single drill pod. I'm going after the light. Somebody has to see what's down there.'",
  "Joe's body isn't here. A single-drill craft is missing from the bay.",
  "The crew is stripping the derelict for parts. Zap stares at the empty bay.",
];
export const BROTHER_NOTES = [
  "you followed me. you idiot. you beautiful idiot. the Changed travel in packs down here. don't let them in the vents.",
  "pod's leaking. ate a mushroom that ate me back. I can hear them in the walls. Zap if you're close: I'm at the bottom of the bright tunnel. hurry.",
  "still alive. barely. door's holding. I'm good at doors. if you see this, I'm close. VERY close. bring a wrench.",
  "they're scratching. the pod door won't last. I'm sorry I left. I just had to know. Do I go? I went. Your turn.",
];
export const ENDINGS = {
  easy: [
    'The core ship explodes in a shower of molten gems.',
    'Beyond it: the center of the world. An island paradise. Wealth, money, food, peace.',
    'The island makes everything for you. Nobody has to fix a door ever again.',
    'Zap looks back up the tunnel, once. Joe never made it here. Or did he go somewhere else?',
  ],
  brother: [
    'The core ship explodes in a shower of molten gems.',
    'Beyond it: the center of the world. An island paradise. Wealth, money, food, peace.',
    'Joe steps off the ship first. He fixes the island\'s front door out of habit. It wasn\'t broken.',
    'Two arms, clasped in the hands of friendship. You went. You both went.',
  ],
};

// ---------------------------------------------------------------------------
// Urchid insults, unlocked by depth tier (0..4)
export const INSULTS = [
  ["You drill like my grandma. She's a rock.", 'Nice hat. Did the feeder drop it on you?', 'Is that your face or did a mole sit on you?', "Wow. Wrenching. So brave.", "I've seen faster dirt.",
    "You walk like you're trying to sneak up on a sandwich and the sandwich is winning.",
    "I'd call you a fossil, but fossils are interesting and somebody wants to dig them up.",
    "Somewhere a worm is telling its kids a scary story, and the scary part is your haircut.",
    "Hey, don't strain yourself. Oh wait, you physically can't. You've never once tried.",
    "If brains were gems, you'd be the empty vault the thieves walk past out of pity."],
  ["You couldn't hit a cave wall from the inside.", 'Your aim is a war crime against bullets.', 'Even the feeders avoid you.', 'Bold of you to stand up while I sit down.',
    "You fight like a mop that got promoted above its station and is now afraid of floors.",
    "Every time you miss, a bullet files a formal complaint and requests a transfer to a better crew.",
    "You have the tactical brilliance of a pebble, and the pebble at least knows when to stay still.",
    "I've watched mushrooms make better decisions than you, and I watched them over a very long lunch.",
    "Your battle cry sounds like a kettle that has given up on being a kettle."],
  ['I would help, but then who would judge you?', "You're the reason the bubble shield has trust issues.", "Your cooking killed more of us than the enemies.", 'I bet you clap when the ship lands.',
    "They say a crew is only as strong as its weakest link. I'm sitting down, so congratulations, it's you.",
    "If the enemy boarded and found you, they'd assume we were already defeated and leave out of respect.",
    "You've got the survival instincts of a moth at a magma convention and the fashion sense to match.",
    "I'd make fun of your strategy, but making fun of something requires it to exist first.",
    "The engine room makes that grinding noise every time you walk past. That's the ship sighing."],
  ['The Changed took one look at you and went back to being normal.', 'You fix doors like doors owe you money.', "If incompetence were fuel we'd be at the core by now.",
    "Three thousand kilometers of solid rock and somehow you're still the densest thing down here.",
    "When they write the history of this voyage, you'll be a footnote, and the footnote will say 'why'.",
    "You're like a hull breach with legs: loud, leaky, and the whole crew wishes someone would patch you.",
    "I've seen the Leviathan's teeth in my nightmares, and honestly they had a better attitude than you.",
    "You make the lithostatic pressure down here feel light. That's the weight of disappointment, buddy."],
  ["I'm not saying you're useless. The lounge chair is saying it.", 'Legends will be told about you. Short ones. At funerals.', "I've lived in this chair for 6,000 km and I still did more than you.",
    "We're about to reach the center of the earth, and you're STILL the lowest point of the whole trip.",
    "When the core finally melts us all, at least I won't have to watch you aim anymore. Silver linings.",
    "Joe went down this tunnel alone with one wrench and a bad plan, and he was still better company than you.",
    "If the island paradise has a gate, they'll take one look at you and install a second gate. Out of spite.",
    "I've been insulting you for six thousand kilometers and I have never once run out of material. Think about that."],
];

// Things the crew say. Each class has its own voice. Spoken now and then (bots and players).
// idle: wandering the ship · fight: in combat · kill: after a kill · hurt: low on health · dock: a ship docks · fire: the ship is burning
export const LINES = {
  pilot: {
    idle: ['Steady as she drills.', "Joe flew this tunnel once. I can do it better.", 'Anyone else hear that rattle? No? Good.', 'Hands on the wheel, eyes on the light.', 'I am one with the dirt.'],
    fight: ['Not on MY ship!', 'Keep them off the bridge!', 'Somebody shoot the big one!', 'I fly AND I fight. Multitasking!'],
    kill: ['Navigated straight through you.', 'Course corrected.', "That's a no-fly zone, pal."],
    hurt: ['I need a medic and a better helmet!', 'Bridge is taking hits!'],
    dock: ['Contact! Ship off the bow!', 'They are latching on! Brace!', 'Here they come. Everybody look busy!'],
    fire: ['FIRE on my ship?! Get the janitor!', 'Who left the stove on in the engine?!'],
  },
  engineer: {
    idle: ['Percussive maintenance is a science.', 'If it rattles, hit it. If it stops rattling, hit it again.', 'I love the smell of grease in the morning.', "This engine and I have an understanding. It's abusive.", 'Who touched my wrench? Nobody touches my wrench.'],
    fight: ['Turret up! Eat lead, dirt-face!', "Watch the pipes, they're load-bearing!", "Traps are set. Walk into them. Please."],
    kill: ['Fixed it.', 'Repaired your attitude.', 'Decommissioned.'],
    hurt: ['I am the thing that needs repairing now!', 'Ow! Bad wrench! No!'],
    dock: ['They better not scratch the paint.', 'Docking clamps? On MY hull?'],
    fire: ['The engines are on fire! That is NOT a feature!', 'Extinguishers! Now!'],
  },
  urchid: {
    idle: ['*sips coconut juice loudly*', 'Wake me up when we get to the paradise part.', 'This chair is the only crew member pulling its weight.', "I'm not lazy. I'm on energy-saving mode. Permanently.", 'Somebody bring me a snack. Not you. Someone competent.'],
    fight: ['Wow, look at all that effort. Gross.', "I'd help, but my chair is very comfortable.", 'Fight harder, I can barely hear the screaming.'],
    kill: ['I had nothing to do with that and I want full credit.'],
    hurt: ['Ow. Did someone just hit my chair?'],
    dock: ['Visitors! Hide the good snacks.', 'Oh great, more people to disappoint me.'],
    fire: ["It's getting warm in here. Finally, decent ambience.", 'If my chair burns, I am suing everybody.'],
  },
  guard: {
    idle: ['Vault secure. Perimeter secure. Snack secure.', 'I see everything. Everything.', 'Nobody touches the gems on my watch.', 'Patrolling. Patrolling. Still patrolling.'],
    fight: ['Halt! You are not on the list!', 'Thieves! Get away from my vault!', 'Double pistols, double trouble!'],
    kill: ['Access denied.', 'Case closed.', 'Your visit has been terminated.'],
    hurt: ["I'm hit! Someone watch the vault!"],
    dock: ['Guard the vault! They always go for the vault!', 'Locking down. Nobody in, nobody out.'],
    fire: ['The vault is fireproof! I am NOT!'],
  },
  chef: {
    idle: ['A little more spice... perfect.', 'Who wants grub skewers? Everybody wants grub skewers.', 'The secret ingredient is dirt. Locally sourced.', "Taste this. No, don't ask what it is.", 'My kitchen, my rules: no fighting near the soup!', 'Today\'s special: whatever fell through the feeder.'],
    fight: ['You want a piece of me? I have a cleaver!', 'Order up: one beating, extra crispy!', 'Back of the line, intruder!'],
    kill: ['Tenderized.', 'Chef\'s kiss.', "Now THAT'S a stew ingredient.", 'Sliced, diced and served.'],
    hurt: ['Ow! Who seasons ME?!', 'Somebody save the soup!'],
    dock: ['Visitors? I only cooked for us!', 'Uninvited guests get the burnt ones.'],
    fire: ['A grease fire! Nobody panic, it\'s just... everywhere!', 'FLAMBÉ! Not on purpose!'],
  },
  mrclean: {
    idle: ['A clean ship is a fast ship.', 'Spotless. Just how I like it.', 'Every speck of dirt is a personal insult.', "My broom and my axe. That's all a man needs.", 'Who tracked mud in here?!'],
    fight: ['Time to take out the trash!', "I'll sweep you off your feet!", 'CHOP CHOP CHOP!'],
    kill: ['Swept.', 'Mopped up.', "Another mess I'll have to clean.", 'Spotless.'],
    hurt: ['You got blood on my floor! My OWN blood!'],
    dock: ['Wipe your feet before you board, animals!'],
    fire: ['Fire! Stand aside, this is MY job!', "I'll put it out. I'll put ALL of it out."],
  },
  missiletech: {
    idle: ['Every dirt missile is a little work of art.', 'Boom is a love language.', 'I could aim this at the core and end the trip early.', 'Missiles: loaded. Coffee: loaded. Me: loaded.'],
    fight: ['Rockets away!', 'VRRRRRM! Chainsaw time!', 'Get to the bay, I have targets to pick!'],
    kill: ['Direct hit.', 'Splash damage, baby!', 'Kaboom, delivered.'],
    hurt: ['Not the face! I need it to aim!'],
    dock: ['Target acquired. Calculating which room to ruin.', 'Bay, man your stations. That means me.'],
    fire: ['Fire near the missiles is extremely bad news! EXTREMELY!'],
  },
  commando: {
    idle: ['Headband: tight. Rifle: clean. Attitude: legendary.', 'I was born in a foxhole. Literally.', 'Drop and give me twenty. Not you, the turret.', 'I could build a gun out of that. I could build a gun out of anything.'],
    fight: ['FIRE IN THE HOLE!', 'Suppressing fire!', 'You picked the wrong ship, maggot!', 'Grenade out!'],
    kill: ['Neutralized.', 'Hooah!', 'Scratch one.', 'Tango down.'],
    hurt: ["It's just a flesh wound! A big one!"],
    dock: ['Boarders! Lock and load!', 'Finally, some action!'],
    fire: ['Fire on deck! Grab an extinguisher, soldier!'],
  },
  farmer: {
    idle: ['Good dirt, this. Real good dirt.', 'Crops are coming in nice this layer.', "Ain't nothing a little elbow grease can't grow.", 'Shovel in one hand, shotgun in the other.'],
    fight: ['Git off my farm!', 'Reap what ya sow!', 'Pitchfork says hello!'],
    kill: ['Harvested.', 'Fertilizer.', 'Back to the soil with ya.'],
    hurt: ["I've had worse from a mule."],
    dock: ['Varmints! Grab the shotgun!'],
    fire: ['Not the crops! Not the crops!'],
  },
  scientist: {
    idle: [],   // uses JARGON
    fight: ['Thermodynamically, you are about to lose.', 'Behold: applied chemistry!', 'Peer review THIS!'],
    kill: ['Hypothesis confirmed.', 'Fascinating. It stopped.', 'Data point acquired.'],
    hurt: ['I am experiencing a non-trivial amount of pain!'],
    dock: ['Scanning their hull. It is ugly. That is my scientific opinion.'],
    fire: ['Combustion! Exothermic! BAD!', 'The fire triangle needs oxygen, fuel, and heat. We have all three. HELP.'],
  },
  dog: { idle: [], fight: ['GRRRRR!', 'BARK BARK BARK!'], kill: ['*happy tail wag*', '*chews victoriously*'], hurt: ['*whimper*'], dock: ['*growls at the hull*', 'WOOF WOOF WOOF!'], fire: ['*barks at the fire*', 'AWOO?!'] },
  chameleon: {
    idle: ["You didn't see me. You never see me.", '...', "I've been standing next to you for an hour.", 'The vents are my highway.'],
    fight: ['Behind you.', 'Surprise.', 'Shhh. Shhh. Shhh.'],
    kill: ['Silent.', 'Gone.', "They never knew."],
    hurt: ["Hey, I was invisible! That's cheating!"],
    dock: ["I'll be on their ship before they're on ours."],
    fire: ['Fire makes shadows. Shadows are nice. Put it out anyway.'],
  },
  trainer: {
    idle: ['Gotta capture... most of them.', 'My monsters are good boys. Mostly.', "That one in the pen bit me. I love him."],
    fight: ['Go! Get them!', 'Weaken it! I want it!', "That one's coming home with me!"],
    kill: ['Not cube-worthy anyway.', 'Next!'],
    hurt: ['Ow! Even my own monsters are judging me!'],
    dock: ['New monsters to catch! I mean, enemies!'],
    fire: ['Get the monsters out of the pen, it is on fire!'],
  },
  jorbal: {
    idle: ['Bloop.', 'Bubbles make everything better.', 'Blorp blorp.', '*blows a tiny bubble*'],
    fight: ['BUBBLE TIME!', 'Into the bubble you go!', 'Pop pop pop!'],
    kill: ['Popped!', 'Snack!', 'Chain combo!'],
    hurt: ['Blorp?! Ow!'],
    dock: ['More things to bubble!'],
    fire: ['Bubbles put out fire, right? RIGHT?'],
  },
  vaelift: {
    idle: ['The Vurfenstaff hums. It knows.', 'I could step out of this dimension any time.', 'Vigilance is the only premium I pay.'],
    fight: ['Behold the Vurfenstaff!', 'You cannot hit what is not here.', 'Ice wall!'],
    kill: ['Phased out.', 'Back to the void.', 'The staff is satisfied.'],
    hurt: ['A dimensional inconvenience.'],
    dock: ['Assume guard positions. I am already in mine.'],
    fire: ['Even the empty dimension has fewer fires than this ship.'],
  },
  agent: {
    idle: ['Shaken, not stirred.', 'The name is 013. Just 013.', 'Always wear a suit. Even underground.', 'My watch is beeping. That means money.'],
    fight: ['Target in sight.', 'Nothing personal. Strictly business.', 'Quietly, now.'],
    kill: ['Mission accomplished.', 'Contract closed.', 'Expired.'],
    hurt: ["I'll need a new suit. And a doctor. In that order."],
    dock: ['Marks incoming. Payday.'],
    fire: ['Fire ruins a good suit. Somebody put that out.'],
  },
  slots: { idle: ['*ding ding ding*', '*whirr*', 'PLAY ME!', 'Feeling lucky?', '*coin noises*'], fight: ['JACKPOT!', 'House always wins!', 'Rolling!'], kill: ['CHA-CHING!', 'Payout!', 'You lose!'], hurt: ['TILT! TILT!'], dock: ['New players at the table!'], fire: ['*alarm bells* *also regular bells*'] },
};
export const JARGON = ['Quantum-tunnelling the eigen-dirt!', 'Classic Mohorovičić discontinuity behaviour.', 'The lithostatic pressure is non-Newtonian, obviously.',
  'Recalibrating the isostatic flux capacitor.', 'Those are basalt-phase metamorphic resonances.', 'A textbook paleomagnetic reversal cascade!',
  'Hypothesis: the enemy is made of hostile peptides.', 'Peer review would DESTROY that boarding party.', 'Entropy is just dirt with ambition.',
  'Trust me, the seismic tomography is screaming.', 'Fascinating. A chalcophile ferro-goblin.'];
export const AGENT_BRIEFS = ['Target is a known gem smuggler. Make it quiet.', 'Intel says this one carries the codes. Retrieve with prejudice.',
  'Mark has a bounty from the Deep City council. Collect.', 'He sold the surface a bad drill. Personal, this time.', 'Shaken, not stirred. The target, I mean.'];
export const DOG_BARKS = ['Woof!', 'BORK', 'grrrr', 'Arf arf!', '*sniffs suspiciously*', '*eats a boot*'];
export const CHEF_LINES = ["Order up!", "Who wants seconds?", "It's not burnt, it's caramelized.", 'Eat it, it builds character.'];
