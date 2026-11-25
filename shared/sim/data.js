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
export const MAX_DOCKED = 6;      // up to 6 enemy ships at once, deep down (if our ship is big enough to hold them)
export const SHIP_UP_MAX = 10;    // ship upgrade levels
export const CLASS_UP_MAX = 8;    // personal upgrade levels

export const LEVELS = 30;         // descents from the surface to the core
export const EARTH_KM = 6371;
export const KM_PER_LEVEL = EARTH_KM / LEVELS;

export const SPLASH = 'another insane game by commanderstitch, right, yeah that guy again... what an urchid';

// ---------------------------------------------------------------------------
// Tiles
// DEBRIS: wreckage that blocks the way until somebody clears (repairs) it.
// SAND: the beach of the island at the center of the world (walkable, only at the very end).
export const T = { VOID: 0, FLOOR: 1, WALL: 2, DOOR: 3, TUNNEL: 4, BREACH: 5, RUBBLE: 6, HULL: 7, ICE: 8, DEBRIS: 9, SAND: 10 };
export const TILE_HP = { [T.WALL]: 90, [T.HULL]: 140, [T.DOOR]: 60, [T.ICE]: 40, [T.DEBRIS]: 50 };
export const BLAST_DOOR_HP = 220;

// ---------------------------------------------------------------------------
// Rooms. `cls` = the class whose job lives here. `sys` = the system the room powers.
// `size` = how many slots it covers ([wide, tall]); most rooms are one slot. The bridge only needs the
// helm, so it's a bit smaller (a short hallway takes the rest of its slot).
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
  farm:     { name: 'Dirt Farm',         cls: 'farmer',     sys: 'farm',     hp: 110, color: '#3b3a1c', icon: 'crop', size: [2, 2] },
  lab:      { name: 'Laboratory',        cls: 'scientist',  sys: 'lab',      hp: 90,  color: '#24304a', icon: 'flask' },
  kennel:   { name: 'Kennel',            cls: 'dog',        sys: 'kennel',   hp: 60,  color: '#45362a', icon: 'bone' },
  pen:      { name: 'Monster Pen',       cls: 'trainer',    sys: 'pen',      hp: 110, color: '#2d4030', icon: 'cube' },
  den:      { name: 'Vent Den',          cls: 'chameleon',  sys: 'den',      hp: 60,  color: '#25332c', icon: 'vent' },
  bubbler:  { name: 'Bubble Grotto',     cls: 'jorbal',     sys: 'bubbler',  hp: 60,  color: '#1f4040', icon: 'bubble' },
  office:   { name: 'Field Office',      cls: 'agent',      sys: 'office',   hp: 80,  color: '#262626', icon: 'watch' },
  casino:   { name: 'Casino Nook',       cls: 'slots',      sys: 'casino',   hp: 80,  color: '#4a2430', icon: 'slot' },
  guardpost:{ name: 'Guard Post',        cls: 'vaelift',    sys: 'guardpost',hp: 100, color: '#30304a', icon: 'staff' },
  storage:  { name: 'Storage',           cls: null,         sys: 'storage',  hp: 90,  color: '#33302a', icon: 'crate' },
  quarters: { name: 'Crew Quarters',     cls: null,         sys: 'quarters', hp: 100, color: '#33283a', icon: 'bed', size: [2, 1] },
  power:    { name: 'Power Core',        cls: 'scientist',  sys: 'power',    hp: 120, color: '#2a3a24', icon: 'power' },
  corridor: { name: 'Corridor',          cls: null,         sys: null,       hp: 60,  color: '#2b2521', icon: null },
};
export const roomSize = (type) => ROOMS[type]?.size || [1, 1];
// Furniture from the Deep Cities, put in a room of your choice.
export const FURNITURE = {
  bed:     { name: 'Bed',     icon: '🛏', cost: 45,  max: 10, desc: 'A real bed for one of your rooms. Lie down in it (E) to heal fast.' },
  jukebox: { name: 'Jukebox', icon: '🎵', cost: 140, max: 1,  desc: 'Live music aboard! Press E at it to change the song (or turn it off).' },
};
// where furniture goes in a room (tile offsets from its top-left wall corner), clear of the doors and the console
export const FURNITURE_SPOTS = [[3.2, 4.6], [6.8, 4.6], [7.8, 2.0], [1.9, 4.6], [8.3, 4.6], [6.6, 2.0]];
export const JUKEBOX_SONGS = ['Off', 'Deep City Swing', 'Mole Disco', 'Lava Lounge'];
export const BRIDGE_W = 6;          // the bridge is 6 tiles wide; a 4-wide hallway fills the rest of its slot

// Rooms the crew can buy at ports to expand the ship.
export const BUYABLE_ROOMS = [
  { type: 'engine',   cost: 160, desc: 'Another engine: faster descent, more fuel burn, more for the engineers to fix.' },
  { type: 'storage',  cost: 90,  desc: '+40 vault capacity. Gems overflow without it.' },
  { type: 'quarters', cost: 80,  desc: 'Big bunk room (2 slots). Crew respawn faster, and you can pick it as a respawn point.' },
  { type: 'power',    cost: 150, desc: '+3 power cells for the scientist to route to engines, bubbles, guns, systems and the galley.' },
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
    abilities: { q: 'turret', f: 'trap', r: 'wrenchhit' },
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
    abilities: { q: 'scarecrow', f: 'feast', rmb: 'pitchfork' },
    blurb: 'Hauls the dirt that leaks in, farms it, and sells boosted crops to the chef. Zone defense: a shotgun, a pitchfork that shoves everything back, and scarecrows that launch crows.',
  },
  scientist: {
    name: 'Scientist', def: 'York', room: 'lab', color: '#50c8e8', hp: 90, speed: 140, clearance: true, unlock: 4,
    weapon: 'jar',
    abilities: { q: 'jarswap', f: 'overclock' },
    blurb: 'Researches upgrades and routes the ship\'s power cells (engines, bubbles, guns, systems, galley). Throws jars of poison, acid, explosives and buffs. Says big words.',
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
    abilities: { q: 'proxmine', r: 'timedmine', f: 'remotemine', g: 'c4', rmb: 'detonate', space: 'tank' },
    blurb: 'Secret missions come in as paper reports when ships dock: put on a disguise, follow the arrow, take out the mark with a Walther PPK. Four kinds of mines, C4 that blows armoured doors, a laser and a tank.',
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
  coins:      { kind: 'bullet', dmg: 18, rate: 0.12, speed: 560, spread: 0.12, range: 420, cost: 1, pierce: true }, // your hard-earned money goes straight through them
  rocket:     { kind: 'rocket', dmg: 42, rate: 1.05, speed: 380, spread: 0,    range: 600, radius: 70 },
  jar:        { kind: 'jar',    dmg: 0,  rate: 0.7,  speed: 330, spread: 0,    range: 340 },
  bubble:     { kind: 'bubble', dmg: 0,  rate: 0.38, speed: 170, spread: 0.05, range: 600 },
  wrench:     { kind: 'melee',  dmg: 17, rate: 0.42, range: 40, arc: 1.7, repair: 9 },
  cleaver:    { kind: 'melee',  dmg: 19, rate: 0.36, range: 38, arc: 1.5 },
  axe:        { kind: 'melee',  dmg: 31, rate: 0.62, range: 46, arc: 2.5, knock: 140 },
  whip:       { kind: 'melee',  dmg: 13, rate: 0.40, range: 62, arc: 0.7 },
  dagger:     { kind: 'melee',  dmg: 18, rate: 0.34, range: 34, arc: 1.2, backstab: true },   // from behind: instant kill
  bite:       { kind: 'melee',  dmg: 21, rate: 0.30, range: 32, arc: 1.4, lifesteal: 0.35 },
  staff:      { kind: 'melee',  dmg: 15, rate: 0.40, range: 50, arc: 2.0, knock: 180 },
  heckle:     { kind: 'heckle', dmg: 0,  rate: 0.9 },
};

// Ability cooldowns (seconds) and costs.
export const ABILITIES = {
  evasive:   { name: 'Evasive Maneuvers', cd: 18, desc: 'At the helm during a docking: enemy D-fire misses for 4s.' },
  rally:     { name: 'Rally the Crew',    cd: 30, desc: 'Everyone in your room moves and shoots twice as fast (+100%) for 6s.' },
  wrenchhit: { name: 'Wrench Repair',     cd: 0.42, desc: 'Hold R: whack whatever is broken in front of you back into shape (systems, walls, doors, breaches).' },
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
  pitchfork: { name: 'Pitchfork',         cd: 0.55, desc: 'Hold right mouse: jab over and over, shoving everything in front of you back.' },
  scarecrow: { name: 'Scarecrow',         cd: 10, cost: { scrap: 6 }, desc: 'Plant a scarecrow (6 scrap). It launches crows at anything that comes near.' },
  feast:     { name: 'Harvest Snack',     cd: 20, cost: { crops: 1 }, desc: 'Eat a crop: heal 50.' },
  jarswap:   { name: 'Swap Jar',          cd: 0.3, desc: 'Cycle poison / acid / explosive / buff jars.' },
  overclock: { name: 'Power Routing',     cd: 1,  desc: 'Open the power panel (at the lab): move power cells between systems.' },
  pounce:    { name: 'Pounce',            cd: 4,  desc: 'Leap and bite.' },
  howl:      { name: 'Howl',              cd: 20, desc: 'Enemies nearby flee in terror for 3s.' },
  cloak:     { name: 'Cloak',             cd: 1,  desc: 'Blend in. Move slowly to stay hidden. Attacking reveals you.' },
  smoke:     { name: 'Smoke Bomb',        cd: 12, desc: 'Blind everyone nearby and re-cloak instantly.' },
  capture:   { name: 'Capture Cube',      cd: 3,  desc: 'Throw a cube. Captures enemies under 35% HP (one per type).' },
  summon:    { name: 'Summon',            cd: 1.5, desc: 'Summon the next monster from your roster (or recall).' },
  bigbubble: { name: 'Big Bubble',        cd: 7,  desc: 'A huge bubble that can trap big enemies.' },
  burst:     { name: 'Bubble Burst',      cd: 6,  desc: 'Pop every bubble near you. Chains!' },
  hop:       { name: 'Hop',               cd: 0.6, desc: 'Jump onto a bubble and ride the air currents.' },
  phase:     { name: 'Phase Shift',       cd: 6,  desc: 'Slip into the empty dimension. Untouchable, unseen, and you walk through walls. Be OUT of the wall when it runs out (watch the countdown) or you die stuck in it.' },
  staffform: { name: 'Vurfenstaff',       cd: 0.4, desc: 'Change the staff: staff / blade / rifle / shotgun. In staff form it bats bullets back at whoever shot them.' },
  icecube:   { name: 'Ice Cube',          cd: 4,  desc: 'Summon a block of ice that stops bullets. Hit it and it slides off, scooping up enemies and smashing them into the next wall.' },
  proxmine:  { name: 'Proximity Mine',    cd: 3,  desc: 'Goes off when an enemy walks over it.' },
  timedmine: { name: 'Timed Mine',        cd: 4,  desc: 'Blows 3 seconds after you drop it.' },
  remotemine:{ name: 'Remote Mine',       cd: 4,  desc: 'Sits there until you press RMB. Then everything you planted goes up.' },
  c4:        { name: 'C4',                cd: 12, desc: 'Lit fuse (4s). Stick it on a door (aim at it): the only thing that blows open armoured doors.' },
  detonate:  { name: 'Detonate',          cd: 0.3, desc: 'Set off every remote mine you have planted.' },
  tank:      { name: 'Summon Tank',       cd: 60, desc: 'A little remote tank rolls in and shoots everything that isn\'t us for 25s (mission rank 2+).' },
  roll:      { name: 'Roll',              cd: 3,  desc: 'Roll forward, crushing enemies into coins.' },
  spin:      { name: 'Spin the Reels',    cd: 1.2, desc: 'Play yourself (5 money). Wins double your pickups.' },
};

// ---------------------------------------------------------------------------
// Personal upgrades: 3 tracks per class, 5 levels each. cost = base * level.
export const CLASS_UPGRADES = {
  pilot:       [['Steady Hands', 'Steering is smoother, obstacle hits hurt less'], ['Afterburner', 'Boost burns less fuel'], ['Blaster', '+20% pistol damage']],
  engineer:    [['Heavy Wrench', '+25% wrench repair and damage'], ['Turret Mk', 'Turrets: +1 max, +damage'], ['Tesla Traps', 'Traps stun longer, shock more']],
  urchid:      [['Lounge Chair', 'Unlocks the lounge chair in your lounge, then makes it ever more ridiculous (cushions, footrest, umbrella, massage). Nothing else.'], ['Sharper Tongue', 'Unlocks meaner insults'], ['Fancier Drink', 'The coconut juice gets bigger and fancier: a straw, an umbrella, a sparkler. Sipping it heals you, not that you can die.']],
  guard:       [['Vault Mastery', '+50% vault capacity per level'], ['Long Barrels', '+20% pistol damage, +25% range, tighter aim'], ['Sprint', '+8% move speed']],
  chef:        [['Recipe Book', 'Meals last longer'], ['Sharper Knives', '+1 knife per volley, +damage'], ['Bigger Fridge', 'Cook two portions at once']],
  mrclean:     [['Biceps', '+20% axe damage'], ['Super Broom', 'Sweep 2x faster'], ['Squeaky Clean', 'Clean-ship buff is stronger']],
  missiletech: [['Warheads', '+25% D-missile damage'], ['Fast Assembly', 'Build missiles faster'], ['Bigger Rockets', '+blast radius']],
  commando:    [['Extended Mag', '+25% rifle fire rate'], ['Bigger Boom', '+explosive damage'], ['Scrap Smith', 'Makeshift guns hit harder']],
  farmer:      [['Better Seeds', 'Crops grow faster, +1 plot'], ['Sawed-Off', '+2 pellets'], ['Murder of Crows', 'Scarecrows: +1 crow, harder pecks, tougher straw']],
  scientist:   [['Grant Money', 'Research 30% faster'], ['Potent Jars', '+30% jar effects'], ['Big Words', 'Even more jargon (morale +)']],
  dog:         [['Sharper Teeth', '+20% bite'], ['Fluffier Bed', 'Heal faster at the kennel'], ['Zoomies', '+10% speed']],
  chameleon:   [['Silent Steps', 'Move faster while cloaked'], ['Sturdy Step', '+12% max health'], ['Vent Rat', 'Vent travel is instant']],
  trainer:     [['Bigger Team', '+1 monster summoned at once'], ['Revive Tech', 'Revive time -25%'], ['Better Cubes', 'Capture at 50% HP']],
  jorbal:      [['Bigger Lungs', 'Bubbles hold enemies longer'], ['Chain Master', '+50% chain bonus'], ['Speed Blower', 'Blow bubbles faster']],
  vaelift:     [['Deep Phase', 'Phase lasts longer'], ['Staff Mastery', '+25% staff damage'], ['Glacier', 'Ice cubes last longer']],
  agent:       [['Silencer', 'PPK shots draw less attention'], ['Extended Mag', '+30% PPK fire rate'], ['Contacts', '+1 marked target per fight']],
  slots:       [['More Reels', '+1 reel (bigger payouts)'], ['Heavier Frame', 'Roll crushes harder'], ['Lucky', 'Better odds']],
};
export const UPGRADE_BASE_COST = 40;
// Personal upgrades are earned, not bought: doing your job (repairs, fires, cooking, kills, research...)
// earns XP, and each star costs a bit more XP than the last. A busy crew member gets all but a couple
// of stars by the time we reach the core. Late joiners come aboard with some XP to catch up.
export const xpCost = (lvl) => 40 + 15 * lvl;
export const XP_JOIN_PER_LEVEL = 75;

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
// Power. The ship has a bank of power cells (more with each Power Core room). The scientist routes them;
// without one aboard they're spread out automatically. Allocated power is constant: it never runs out,
// but a system with no cells can't run its extras.
export const POWER_BASE = 5;
export const POWER_PER_CORE = 3;
export const POWER_SYS = {
  engine:  { name: 'Engines',          max: 3, desc: 'Each cell: faster descent and +8% chance to dodge enemy fire. 0 cells: crawling.' },
  shield:  { name: 'Bubble',           max: 3, desc: 'Bubbles recharge faster with more cells. 0 cells: no recharge.' },
  weapons: { name: 'Weapons',          max: 14, desc: 'Each installed gun needs its power to fire. Unpowered guns shut down.' },
  systems: { name: 'Internal systems', max: 3, desc: 'Feeders, doors and the lab. More cells, more pickups and faster research.' },
  kitchen: { name: 'Galley',           max: 3, desc: 'Better cooking gear: meals heal more, cook faster, and the fancy recipes need it.' },
};
export const POWER_DEFAULT = { engine: 1, shield: 1, weapons: 1, systems: 1, kitchen: 1 };

// Ship guns. The D-gun comes with the ship. The rest are found in enemy wrecks or bought at ports,
// sit in storage, and the missile technician installs them in the weapons bay. Each one needs power.
export const SHIP_GUNS = {
  dgun:  { name: 'D-Gun',          power: 1, period: 5,   dmg: 18, shots: 1, cost: 0,   desc: 'The old reliable. Bubbles stop it.' },
  flak:  { name: 'Flak Battery',   power: 1, period: 4.5, dmg: 6,  shots: 4, cost: 160, desc: 'Four quick shells. Strips bubbles fast.' },
  burst: { name: 'Burst Cannon',   power: 2, period: 7,   dmg: 14, shots: 3, cost: 220, desc: 'Three heavy rounds in a row.' },
  ion:   { name: 'Ion Lance',      power: 2, period: 8,   dmg: 10, shots: 1, bubbleDmg: 3, sysMul: 2.5, cost: 240, desc: 'Drains 3 bubbles per hit and fries systems.' },
  rail:  { name: 'Rail Driver',    power: 3, period: 11,  dmg: 70, shots: 1, pierce: true, cost: 320, desc: 'Goes straight through bubbles. Huge hit, slow reload.' },
  fire:  { name: 'Fire Gun',       power: 2, period: 9,   dmg: 8,  shots: 1, fire: true, cost: 260, trader: true, desc: 'Only from traders. Sets fires all over the room it hits: they have to put them out.' },
};
export const GUN_SLOTS = 3;           // guns the weapons bay starts with (+1 per extra weapons bay, +1 per rack extension: up to 10)

// ---------------------------------------------------------------------------
// Gems: all kinds, worth different amounts. Deeper down the rich ones turn up more often.
export const GEMS = {
  bronze:   { name: 'bronze',   value: 1,  color: '#c07a3a', hi: '#f0b070', shape: 'nugget', depth: 0 },
  silver:   { name: 'silver',   value: 2,  color: '#b8c0c8', hi: '#ffffff', shape: 'nugget', depth: 0 },
  quartz:   { name: 'quartz',   value: 3,  color: '#5ec8e8', hi: '#e0f8ff', shape: 'diamond', depth: 0 },
  gold:     { name: 'gold',     value: 5,  color: '#f4c542', hi: '#fff4a0', shape: 'nugget', depth: 1 },
  amethyst: { name: 'amethyst', value: 7,  color: '#a060e0', hi: '#e0c0ff', shape: 'shard', depth: 1 },
  sapphire: { name: 'sapphire', value: 10, color: '#3060e0', hi: '#a0c0ff', shape: 'oval', depth: 2 },
  ruby:     { name: 'ruby',     value: 14, color: '#e02040', hi: '#ffa0b0', shape: 'heart', depth: 3 },
};
export const GEM_ORDER = Object.keys(GEMS);

// ---------------------------------------------------------------------------
// Food & recipes (Chef)
export const FOODS = ['grub', 'shroom', 'fish', 'spice'];
// heal: HP the meal gives back when it lands (the better the food, the more). power: galley cells it needs.
export const RECIPES = [
  { id: 'skewers', name: 'Fried Grub Skewers', needs: { grub: 2 }, heal: 25, power: 0, buff: { dmg: 0.25 }, side: { speed: -0.1 }, dur: 60, text: '+25% damage, a bit greasy (-10% speed)' },
  { id: 'salad',   name: 'Rock Shroom Salad',  needs: { shroom: 2 }, heal: 35, power: 0, buff: { regen: 2 }, side: { rate: -0.08 }, dur: 60, text: 'Regenerate 2 HP/s, slower trigger finger' },
  { id: 'sticks',  name: 'Frozen Fish Sticks', needs: { fish: 2 }, heal: 30, power: 0, buff: { speed: 0.3 }, side: { maxhp: -0.1 }, dur: 45, text: '+30% speed, brain freeze (-10% max HP)' },
  { id: 'chili',   name: 'Magma Chili',        needs: { grub: 1, shroom: 1, spice: 1 }, heal: 50, power: 1, buff: { cd: 0.3 }, side: { armor: -0.1 }, dur: 60, text: 'Abilities recharge 30% faster, take 10% more damage' },
  { id: 'stew',    name: 'Class-Special Stew', needs: { crops: 1, fish: 1, grub: 1 }, heal: 65, power: 1, buff: { special: 1 }, side: { speed: -0.05 }, dur: 75, text: "Boosts each class's speciality (+40%)" },
  { id: 'feast',   name: "Farmer's Feast",     needs: { crops: 2, spice: 1 }, heal: 90, power: 2, buff: { dmg: 0.2, speed: 0.15, regen: 1 }, side: {}, dur: 90, text: 'A bit of everything. Farm-fresh, no downside.' },
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
// tier: the shallowest depth tier they turn up at (the weird ones are saved for later)
export const RACES = [
  { id: 'mole',   body: 'round',  color: '#6b5444', eye: '#ffd0d0', tier: 0 },
  { id: 'rat',    body: 'long',   color: '#7a7066', eye: '#ff4040', tier: 0 },
  { id: 'beetle', body: 'shell',  color: '#3a5a4a', eye: '#a0ff80', tier: 0 },
  { id: 'worm',   body: 'worm',   color: '#b0707a', eye: '#202020', tier: 0 },
  { id: 'raider', body: 'human',  color: '#8a6a50', eye: '#ffffff', tier: 0 },   // other digging folk: they want your ship too
  { id: 'golem',  body: 'square', color: '#707a80', eye: '#60e0ff', tier: 1 },
  { id: 'ghoul',  body: 'round',  color: '#5a6a50', eye: '#f0f040', tier: 1 },
  { id: 'crab',   body: 'shell',  color: '#a04a30', eye: '#202020', tier: 1 },
  { id: 'bat',    body: 'wing',   color: '#4a3a5a', eye: '#ff80ff', tier: 1 },
  { id: 'spider', body: 'spider', color: '#3a2a2a', eye: '#ff3030', tier: 2 },
  { id: 'slime',  body: 'blob',   color: '#5aa040', eye: '#ffffff', tier: 2 },
  { id: 'magmite',body: 'square', color: '#a03a10', eye: '#ffe060', tier: 2 },
  { id: 'squid',  body: 'squid',  color: '#7a4a8a', eye: '#ffe0a0', tier: 3 },
  { id: 'crystal',body: 'crystal',color: '#60a0c0', eye: '#ffffff', tier: 3 },
  { id: 'eyeball',body: 'eye',    color: '#d8c8c0', eye: '#c02020', tier: 3 },
  { id: 'mantle', body: 'human',  color: '#5a3030', eye: '#ff8020', tier: 4 },   // deep folk, half rock
  { id: 'horror', body: 'squid',  color: '#3a1020', eye: '#40ff80', tier: 4 },
];
export const BUILDS = [
  { id: 'scrawny', size: 0.8, hp: 0.7, speed: 1.2,  dmg: 0.8, tier: 0 },
  { id: 'lanky',   size: 1.0, hp: 0.9, speed: 1.15, dmg: 1.0, tier: 0 },
  { id: 'squat',   size: 0.95,hp: 1.2, speed: 0.9,  dmg: 1.0, tier: 0 },
  { id: 'burly',   size: 1.3, hp: 1.8, speed: 0.8,  dmg: 1.4, tier: 1 },
  { id: 'hulking', size: 1.65,hp: 3.0, speed: 0.68, dmg: 1.8, tier: 2 },
  { id: 'titan',   size: 2.1, hp: 5.0, speed: 0.55, dmg: 2.4, tier: 3 },
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
  { id: 'maul',   kind: 'melee',  dmg: 26, rate: 1.4, range: 42, role: 'carver',   wallDmg: 4 },
  { id: 'harpoon',kind: 'bullet', dmg: 16, rate: 1.8, range: 420, speed: 380, role: 'brute' },
  { id: 'spit',   kind: 'bullet', dmg: 6,  rate: 0.9, range: 300, speed: 340, pellets: 3, spread: 0.25, role: 'saboteur', acid: true },
  { id: 'laser',  kind: 'bullet', dmg: 9,  rate: 0.5, range: 520, speed: 900, role: 'saboteur' },
];
// The Ship-Eater: once a run the enemy mix is a single thing, "100%", and it is the main event. Heavily
// armoured, a mountain of health, hits hard, and it EATS SHIPS: it chews through walls, swallows whole
// rooms (theirs too, if their ship is docked), grabs our scrap and gets bigger and nastier as it feeds.
export const HOARDER = { name: 'The Ship-Eater', race: 'golem', body: 'hoarder', color: '#5a5048', eye: '#ffb020', size: 3.2, hp: 1500, speed: 50, dmgMul: 2.4, weapon: 'maul' };

// Every ship we fight has a crew like ours: the same jobs, each one a class of its own (drawn as foxes
// in their colours, a red band on the arm). Lose one and their ship loses what that job does, so a
// clean assassination or a strike on the right room matters. The random boarders still come too
// (out of their crew quarters). `stays`: they keep to their post instead of boarding us.
export const ENEMY_CREW = {
  pilot:       { weapon: 'pistol',  hp: 1.0, stays: true,  post: 'bridge',  loss: 'Their PILOT is down: that ship can\'t fly away now, and its guns aim worse.' },
  engineer:    { weapon: 'club',    hp: 1.1, stays: true,  post: 'engine',  loss: 'Their ENGINEER is down: their wrecked rooms stay wrecked now.' },
  missiletech: { weapon: 'bomb',    hp: 1.0, stays: true,  post: 'weapons', loss: 'Their MISSILE TECH is down: their missiles slow to a crawl.' },
  scientist:   { weapon: 'spit',    hp: 0.9, stays: true,  post: 'shield',  loss: 'Their SCIENTIST is down: no more bubbles, and nobody to reroute their power.' },
  chef:        { weapon: 'club',    hp: 1.0, stays: true,  post: 'quarters', loss: 'Their CHEF is down: their boarders stop healing up between waves.' },
  farmer:      { weapon: 'shotgun', hp: 1.1, stays: true,  post: 'quarters', loss: 'Their FARMER is down: no more food, fewer reinforcements.' },
  guard:       { weapon: 'pistol',  hp: 1.2, stays: true,  post: 'vault',   loss: 'Their GUARD is down: their vault and doors are wide open.' },
  commando:    { weapon: 'rifle',   hp: 1.3, stays: false, loss: 'Their COMMANDO is down.' },
  mrclean:     { weapon: 'maul',    hp: 1.5, stays: false, loss: 'Their JANITOR is down.' },
  dog:         { weapon: 'claws',   hp: 1.1, stays: false, loss: 'Their DOG is down. Good boy. Bad side.' },
  chameleon:   { weapon: 'claws',   hp: 0.9, stays: false, loss: 'Their CHAMELEON is down (you can see it now).' },
  agent:       { weapon: 'pistol',  hp: 1.0, stays: false, loss: 'Their AGENT is down.' },
  vaelift:     { weapon: 'club',    hp: 1.2, stays: false, loss: 'Their VAELIFT is down.' },
};
// the jobs every ship has (if it has the room for them), then extras the bigger ships bring along
export const ENEMY_CORE_CREW = ['pilot', 'engineer', 'missiletech', 'scientist'];
export const ENEMY_EXTRA_CREW = ['commando', 'guard', 'chef', 'farmer', 'mrclean', 'dog', 'chameleon', 'agent', 'vaelift'];

// Thieves: crews that came for the vault, not the fight. Pirates, thieves, robbers, bandits and hackers
// go straight for our gems ("har har har"); kill one and it drops what it grabbed. Hackers pop our doors.
export const THIEVES = [
  { id: 'pirate', name: 'Pirates', color: '#7a3a2a', weapon: 'club',   hat: 'pirate', tier: 0, says: ['Har har har!', 'Arr, the vault! Har har!', 'Yo ho, yo ho, your gems are mine!', 'HAR HAR HAR!'] },
  { id: 'thief',  name: 'Thieves', color: '#3a3a4a', weapon: 'sack',   hat: 'hood',   tier: 0, says: ['Shh. Gems.', 'Just borrowing these. Forever.', "Nobody saw nothing."] },
  { id: 'robber', name: 'Robbers', color: '#2a2a2a', weapon: 'pistol', hat: 'mask',   tier: 1, says: ['Stick \'em up, fox!', 'Hand over the shinies!', 'This is a robbery! Obviously!'] },
  { id: 'bandit', name: 'Bandits', color: '#8a6a3a', weapon: 'shotgun',hat: 'bandana',tier: 2, says: ['Yeehaw! Vault\'s this way!', 'Grab the gems and ride!', 'Bandits! BANDITS!'] },
  { id: 'hacker', name: 'Hackers', color: '#2a5a3a', weapon: 'laser',  hat: 'visor',  tier: 2, says: ['Bypassing your doors. Lol.', 'Your firewall is a literal wall.', 'Downloading gems... 40%...'], hacker: true },
];

// Monsters that only turn up through random events (and the trainer's starter pets).
export const EVENT_CREATURES = [
  { id: 'stork',      name: 'Stork Army',     body: 'stork',   color: '#e8e8e0', eye: '#202020', size: 1.0, hp: 30,  speed: 260, dmg: 1.0, weapon: 'claws' },
  { id: 'rockmon',    name: 'Rock Monster',   body: 'rock',    color: '#6a6460', eye: '#ffa040', size: 1.8, hp: 260, speed: 48,  dmg: 1.8, weapon: 'club', armor: 0.35 },
  { id: 'tentacle',   name: 'Tentacle Thing', body: 'squid',   color: '#6a2a6a', eye: '#f0ff60', size: 1.5, hp: 120, speed: 90,  dmg: 1.4, weapon: 'harpoon' },
  { id: 'burrower',   name: 'Burrowing Worm', body: 'worm',    color: '#c08070', eye: '#101010', size: 1.7, hp: 220, speed: 110, dmg: 1.6, weapon: 'drill' },
  { id: 'strawberry', name: 'Giant Strawberry', body: 'berry', color: '#e02840', eye: '#fff0a0', size: 1.6, hp: 90,  speed: 210, dmg: 1.3, weapon: 'claws' },
  { id: 'virus',      name: 'Screaming Virus', body: 'virus',  color: '#90e040', eye: '#ff2020', size: 0.7, hp: 14,  speed: 120, dmg: 0.6, weapon: 'claws' },
];
// The monster trainer never starts empty-handed: pick one of these when you sign on.
export const STARTER_MONSTERS = [
  { id: 'grass',    name: 'Sproutle', elem: 'grass',    color: '#58c048', eye: '#203010', body: 'round', icon: '🌿', desc: 'Grass. Tough, roots enemies in place and heals you a little when it bites.' },
  { id: 'fire',     name: 'Emberpup', elem: 'fire',     color: '#f07028', eye: '#fff060', body: 'long',  icon: '🔥', desc: 'Fire. Sets what it bites burning (on their ship it starts real fires).' },
  { id: 'water',    name: 'Drizzlet', elem: 'water',    color: '#3890e0', eye: '#e0f8ff', body: 'blob',  icon: '💧', desc: 'Water. Sprays from range and washes enemies back.' },
  { id: 'electric', name: 'Zapkit',   elem: 'electric', color: '#f0d030', eye: '#202020', body: 'wing',  icon: '⚡', desc: 'Electric. Fast; its zaps chain to the next enemy over and stun.' },
];

// Candy: pops up now and then around the ship. Grab it for a short boost.
export const CANDY = {
  green:   { name: 'Green candy',   color: '#50e060', dur: 15, buff: { speed: 0.45 },        text: 'zoom! faster for 15s' },
  red:     { name: 'Red candy',     color: '#ff4040', dur: 15, buff: { rate: 0.6 },          text: 'faster trigger for 15s' },
  blue:    { name: 'Blue candy',    color: '#4080ff', dur: 15, buff: { range: 0.6 },         text: 'shots fly further for 15s' },
  white:   { name: 'White candy',   color: '#ffffff', dur: 0,  lightning: 60,                text: 'LIGHTNING CHAIN GUN!' },
  yellow:  { name: 'Yellow candy',  color: '#f4d030', dur: 20, buff: { gold: 1 },            text: 'double gold per kill for 20s' },
  rainbow: { name: 'Rainbow candy', color: 'rainbow', dur: 15, buff: { speed: 0.45, rate: 0.6, range: 0.6, gold: 1 }, lightning: 40, text: 'EVERYTHING AT ONCE!' },
};
export const LIGHTNING = { kind: 'chain', dmg: 16, rate: 0.12, range: 300, chain: 4 };

// Random events: every layer down, something might happen. The deeper you go, the likelier it's bad.
export const EVENTS = {
  // good-ish
  trader:     { good: true,  name: 'A trader pulls alongside', text: 'A trader\'s dig-cart latches on for a minute. Missiles, scrap, money, and one weird gun.' },
  cache:      { good: true,  name: 'Lucky seam',          text: 'The drill bites into a seam of gems. They rain down through the feeders!' },
  candyrain:  { good: true,  name: 'Candy cave',          text: 'We drill through a cave full of... candy? Grab it!' },
  strawberry: { good: true,  name: 'Giant strawberries',  text: 'GIANT STRAWBERRIES are rolling in through the hull! They squash, but they\'re delicious.' },
  distress:   { good: true,  name: 'Signal: Do I Go?',    text: 'A distress beacon. It just says "DO I GO?" over and over.' },
  magnet:     { good: true,  name: 'Magnetic seam',       text: 'We drill past a magnetic seam. Everything loose on the ship goes flying... into our pockets.' },
  hotspring:  { good: true,  name: 'Hot spring',          text: 'A hot spring bursts through the floor vents. Everyone soaks. Everyone heals. The grime washes away.' },
  scrapfield: { good: true,  name: 'Scrap field',         text: 'An old wreck field. Scrap rains in through the feeders!' },
  moles:      { good: true,  name: 'Friendly moles',      text: 'A family of moles digs in. They hate boarders as much as we do. They\'ll fight with us for a while.' },
  // bad
  fire:       { good: false, name: 'Fire!',               text: 'A fuel line bursts. FIRE breaks out!' },
  engine:     { good: false, name: 'Engine failure',      text: 'An engine shakes itself to pieces! (This is why you buy more engines.)' },
  storks:     { good: false, name: 'The Stork Armada',    text: 'Ships. Full of STORKS. Up to four of them, docking at once. They run really fast and they peck HARD.' },
  pirates:    { good: false, name: 'Pirate raid',         text: 'HAR HAR HAR! A pirate ship (or three) full of pirates. They want the vault.' },
  quake:      { good: false, name: 'Cave-in',             text: 'The tunnel shakes. Rocks come down on the ship: doorways blocked, systems dented.' },
  surge:      { good: false, name: 'Power surge',         text: 'A lightning seam! It arcs through the hull and fries the power, the bubbles and the lab.' },
  virus:      { good: false, name: 'Virus outbreak',      text: 'Something in the storage hold is screaming. And multiplying. Kill it before it fills the room!' },
  rocks:      { good: false, name: 'Rock monsters',       text: 'Rock monsters shoulder in through the hull. Slow, all health, all punch.' },
  tentacles:  { good: false, name: 'Tentacles',           text: 'Tentacles. Through the walls. Why is it always tentacles.' },
  worms:      { good: false, name: 'Burrowing worms',     text: 'Burrowing worms are tunnelling in and out of the ship, eating holes everywhere. Kill them before the dirt (and worse) pours in!' },
};
export const DISTRESS_LINES = ['Help them (could be a trap)', 'Leave them (keep digging)'];

// Somebody's down: everybody dies in character, and nobody believes it.
export const DEATH_LINES = {
  pilot: ['No! I had the wheel! I HAD THE WHEEL!', 'This is NOT how the story goes!', 'Tell Joe... I drove better.'],
  engineer: ['Who\'s gonna fix ME?!', 'I can patch this... I can... nope.', 'Not... the wrench...'],
  guard: ['Impossible! I am the FASTEST!', 'The vault... guard... the...', 'I was on PATROL!'],
  chef: ['My SOUFFLÉ!', 'Who\'s gonna feed you idiots now?!', 'Tell them... more salt...'],
  mrclean: ['I... am... spotless... *thud*', 'Now look at this MESS I made.', 'NOT THE BICEPS!'],
  missiletech: ['I didn\'t even get to fire the big one!', 'Boom is... my... love language...', 'Mis... fire...'],
  commando: ['MEDIC! Wait, we don\'t have a medic!', 'I\'ve had worse! ...No I haven\'t!', 'Tell Sarge... I am Sarge.'],
  farmer: ['My crops! Who\'ll water my crops?!', 'Shoulda stayed on the farm...', 'Plant me... somewhere nice...'],
  scientist: ['This is statistically IMPOSSIBLE!', 'My hypothesis... was wrong...', 'Peer review... was... brutal...'],
  dog: ['AWOOOooo...', '*sad whimper*', 'Bark? ...bark.'],
  chameleon: ['You... SAW me?!', 'Nobody sees me! NOBODY!', 'Shhh... I\'m... hiding... forever...'],
  trainer: ['I choose... the floor...', 'My monsters will avenge me! Probably!', 'Return... to... cube...'],
  jorbal: ['Blooooop...', '*pop*', 'Bubble... burst...'],
  vaelift: ['The other dimension... was right there!', 'The Vurfenstaff... disappointed...', 'Premium service... cancelled...'],
  agent: ['The name\'s... 013... was...', 'This wasn\'t in the briefing!', 'Shaken... AND stirred...'],
  slots: ['TILT! TILT! GAME OVER!', '*sad descending slot noises*', 'House... lost...'],
};
// Agent 013's secret missions, typed up on paper and slid under the door.
export const MISSION_PAPERS = [
  'EYES ONLY. The mark is smuggling our gems in their boots. Put on their crew\'s overalls and get close.',
  'TOP SECRET. This one knows where Joe went. They don\'t get to tell anyone else.',
  'CLASSIFIED. The mark cheated at cards in Rusty Gulch. We take cards very seriously.',
  'URGENT. The mark keeps the keys to their vault. Blend in, walk up, end it quietly.',
  'BURN AFTER READING. The mark has been insulting the urchid. Only WE get to insult the urchid.',
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
  { id: 'gloomspider',name: 'Gloom Spider',race: 'spider', build: 'burly',  weapon: 'spit',  tierMin: 2 },
  { id: 'rocklobster',name: 'Rock Lobster',race: 'crab',   build: 'hulking',weapon: 'maul',  tierMin: 3 },
  { id: 'molemother', name: 'Mole Mother', race: 'slime',  build: 'titan',  weapon: 'claws', tierMin: 4 },
];
// The thing at the core: one of these, picked at random each run.
//   coreking:  sits in its lair, throws fire, spawns its brood.
//   leviathan: climbs OUT of its ship and walks straight through our walls, crushing everything into dust.
export const BOSS = { id: 'coreking', name: 'The Core King', race: 'magmite', build: 'burly', hp: 2000, size: 3.2 };
export const BOSSES = [
  BOSS,
  { id: 'leviathan', name: 'The Leviathan', race: 'horror', build: 'titan', hp: 2600, size: 3.6, walker: true, color: '#3a5a6a', eye: '#a0ffe0' },
];

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
export const TRANSPONDER_PILOT = "⚠ PILOT: this one's on you. Write the number down and keep it. Only the pilot can type it into the targeting computer when the signal turns up, so nobody else needs to remember it.";
// Warnings scratched into the tunnel walls, early on: it gets worse, so build the ship up while it's easy.
export const EARLY_WARNINGS = [
  { level: 2, title: 'Scratched into the tunnel wall', lines: ['"It was easy at first, but we are barely able to hold together. BE YE WARNED!"', '(Upgrade the hull plating and bubble defense at the next port. Fix every door. It only gets worse from here.)'] },
  { level: 4, log: '📜 Another scratching, older: "THEY COME IN BIGGER SHIPS. THEN TWO SHIPS. THEN FOUR. PATCH YOUR HULL OR BE PATCHED INTO THE DIRT."' },
  { level: 6, log: '📜 A bent hull plate wired to a rock: "We skipped the plating to save money. Don\'t be us. —The crew of the Mudlark (deceased)"' },
  { level: 9, log: '📜 Painted in something red: "BREACHES LET THE BUGS IN. THE BUGS EAT EVERYONE. EVEN THEM."' },
];
// Boarders shout at the foxes. The Urchid gets special treatment.
export const ENEMY_TAUNTS = [
  'Nice ship, fox. Mine now.', "Look at its little ears! I'm gonna make a hat.", 'Foxes! I LOVE foxes! Crunchy!',
  'Your hull is made of tinfoil and dreams!', 'Run, foxy, run!', "Who taught you to fight, a mole? I'm a mole and I'm offended.",
  "You smell like a wet carpet that's been dug up twice.", "Is that a wrench or are you just happy to see me? Either way, I'm taking it.",
  "I've seen scarier things in my soup.", "Your tail's on fire. No wait, that's just how ugly it is.",
  'Surrender the gems and I only bite you a little!', 'Bushy tail, empty head!', 'Fox stew tonight, boys!',
  'Your pilot drives like a drunk worm.', "Hey! Hey fox! Your door's broken! Hahaha!", 'Grab the shiny ones, leave the furry ones!',
];
export const URCHID_TAUNTS = [
  "What is THAT? A fox in a lounge chair? What a waste of space.", "Don't bother with the chair one. It's furniture.",
  "Even the bugs won't eat that one. Too lazy to digest.", "Is it... asleep? In the middle of a boarding? Respect.",
  "That one's not crew, that's cargo.", "Somebody throw the urchid out the airlock. Oh wait, it can't even be bothered to die.",
  "I've boarded a hundred ships and never seen anything contribute LESS.",
];

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
// More of them, and two new moods: repair (just fixed something) and win (a fight is over).
const MORE_LINES = {
  pilot: {
    idle: ['If you can read this, the ship is still flying. You are welcome.', 'I parallel-parked this thing between two magma pockets once.', 'Joe always took the corners too wide.', "Every rock out there has my name on it. I've been dodging autographs all day.", 'Next stop: somewhere with fewer teeth.', 'The light is getting brighter. That is either good or very, very bad.'],
    fight: ['Hold the line, I have to drive this thing!', 'Watch the console, watch the console!', 'Evasive is on cooldown, so YOU dodge!'],
    kill: ['Ground control to dead guy.', 'Flight cancelled.', 'Turbulence. Permanent turbulence.'],
    repair: ['Bridge back online. Nobody touch anything.', 'Helm is good. My nerves are not.'],
    win: ['Good flying, everyone. Mostly me.', 'Sweep the bodies off the deck, we have a schedule.', "Undocking when you're all back. I mean it this time."],
  },
  engineer: {
    idle: ['Duct tape is load-bearing. Do not remove the duct tape.', 'I can hear the engine humming in B-flat. That is a warning.', 'Pass me the big wrench. No, the BIGGER wrench.', "Somebody keeps putting ketchup in the coolant. I know it's the chef.", 'Every bolt on this ship has a name. That one is Gerald.'],
    fight: ['Turret two, wake up! Earn your rivets!', 'You break it, I break YOU.', 'Get away from my engine!'],
    kill: ['Torqued to spec.', 'Unscrewed.', 'Scrap metal. Like you.'],
    repair: ['Good as new. Better, actually.', "There. Hit it if it rattles.", 'Fixed. Stop breaking things.', 'Tightened, greased, insulted. Done.'],
    win: ['Now everyone hold still while I fix everything you broke.', 'Who wants to watch me weld? Nobody? Fine.'],
  },
  urchid: {
    idle: ['Could someone fluff my cushion? I would, but effort.', 'I am supervising. From a distance. With my eyes closed.', 'This journey has really taken a toll on my nap schedule.', 'Is it lunch? It feels like lunch. It always feels like lunch.'],
    fight: ['You missed. Again. I counted.', 'Oh no. Anyway.', "Please fight quieter, I'm resting my eyes."],
    win: ['We won? I knew my moral support would pay off.', 'Great team effort. Especially from the chair.'],
  },
  guard: {
    idle: ['I counted the gems. Then I counted them again. Then once more for luck.', 'Nobody gets past me. Except the dog. The dog is allowed.', 'Eyes open. Always open. I blink in shifts.', "My pistols are named Left and Right. I'm very creative."],
    fight: ['Halt! Hands where I can see them! All of them!', 'Unauthorized personnel detected! Authorizing bullets!', 'That vault is OFF LIMITS!'],
    kill: ['Badge revoked.', 'Escorted off the premises.', 'Trespassing has consequences.'],
    win: ['Vault intact. Gems counted. All is well.', 'Perimeter clear. For now.'],
  },
  chef: {
    idle: ["Who's hungry? Don't answer, everyone's hungry.", 'The soup is alive. It is supposed to be.', "I learned this recipe from a mushroom. It wasn't a nice mushroom.", 'Do NOT touch the pot. The pot is my child.', 'Today we are making deep-crust dirt pie. Very crunchy.', 'A good meal fixes everything. Except the hull. Somebody fix the hull.'],
    fight: ['Get out of my kitchen!', "You're about to be today's special!", 'Taste my cleaver!', 'Hot pan coming through!'],
    kill: ['Overcooked.', 'Diced!', 'Back to the walk-in freezer with you.', 'Garnished and served.'],
    hurt: ['I burned myself! On purpose! For flavor!'],
    win: ['Victory feast! Somebody bring me the leftovers. Of the enemies.', "Line up, line up, plates out, it's still hot!"],
  },
  mrclean: {
    idle: ['I can smell a crumb from three rooms away.', 'There is no stain I cannot defeat.', 'The axe is for enemies. The broom is for everything else. Mostly.', 'Somebody sneezed in the hall. I will find them.'],
    fight: ['MESS DETECTED. ELIMINATING.', "You're dirty and you're DONE!", 'Whirlwind of cleanliness!'],
    kill: ['Disinfected.', 'Bagged and tagged.', 'Gone. Like a dust bunny.'],
    repair: ['Fire out. Floors mopped. You may proceed.'],
    win: ['Look at this mess. LOOK at it. Fine. I got it.', 'Enemy guts on my clean floor. Again.'],
  },
  missiletech: {
    idle: ['I painted a face on this one. His name is Kevin. Kevin explodes.', 'Calibrating the warheads. And by calibrating I mean hugging.', 'Somebody owes me a bigger launcher.', 'You hear that whistling? That is the sound of me being right.'],
    fight: ['Danger close! I love danger close!', 'Kevin, go!', 'Locking on! Locked! Fire!'],
    kill: ['Detonation successful.', 'Boom. Signed, sealed, delivered.', 'Payload received.'],
    win: ['Reloading for the next one. There is always a next one.', 'That was a good boom. Ten out of ten boom.'],
  },
  commando: {
    idle: ['I sleep with one eye open and both guns loaded.', 'I once fought a cave bear with a spoon. The spoon won.', 'Pain is just weakness leaving the body. Loudly.', 'I can make a gun out of three forks and a bad attitude.'],
    fight: ['Contact front! Contact everywhere!', 'Covering fire! Cover me covering you!', 'Eat dirt! Literally, we have plenty!'],
    kill: ['Target down.', 'Confirmed.', 'Rest in pieces.', "That's how we do it in the dirt."],
    win: ['Area secure. Check your corners, soldiers.', 'Good work, maggots. Now clean your weapons.'],
  },
  farmer: {
    idle: ['These crops grow better down here. Must be the screaming.', 'Raised a turnip the size of a dog once. The dog was jealous.', 'The scarecrow works. Mostly scares me.', "Dirt's dirt. Good dirt's gold.", 'Rain? Down here? Pfft.'],
    fight: ['Shoo! Shoo, varmint!', 'Git! Git on outta here!', 'Crows! Get em!', 'Pitchfork says GO AWAY!'],
    kill: ['Plowed under.', 'Compost.', 'Back to the earth, critter.'],
    win: ['Harvest time. Of the enemy gear.', 'Now that was a good day of farmin.'],
  },
  scientist: {
    fight: ['My jar of hypotheses says you lose!', 'This is for SCIENCE!', 'Observe! The scientific method! Applied to your face!'],
    kill: ['Experiment concluded.', 'Results are in. You are dead.', 'Statistically insignificant. Now.'],
    repair: ['Rewired. Recalibrated. Re-awesome.'],
    win: ['A fascinating outcome. I will write a paper. Nobody will read it.', 'Reallocate the power cells! No, the OTHER way!'],
  },
  dog: { idle: ['*chases own tail*', '*sniffs the engine*', '*lies down in the middle of the hall*', '*stares at the wall, growling*'], kill: ['*proud zoomies*', '*brings you a piece of the enemy*'], win: ['*rolls over for belly rubs*', '*victory howl*'] },
  chameleon: {
    idle: ['Have you checked behind you lately?', 'I live in the walls now.', 'Blink twice if you can see me. Ha. You blinked.', "Every vent on this ship knows my name. They don't say it out loud."],
    fight: ['Here. No, here. No, behind you.', 'You never see the knife.', 'Look at me. Too late.'],
    kill: ['Shhhh.', 'Never there.', 'Erased.'],
    win: ['I was there the whole time. You just did not notice.'],
  },
  trainer: {
    idle: ['Every monster is a friend you have not caught yet.', 'I name all my monsters Steve. It saves time.', 'My whip is for encouragement. Mostly.'],
    fight: ['Weaken it! WEAKEN IT! Not too much!', 'Into the cube, you!', 'Sic em, Steve!'],
    kill: ['Too feisty. Shame.', "That one wouldn't have fit in the pen anyway."],
    win: ['New friends in the pen! Everybody say hi!', 'Good monsters. Good, good monsters.'],
  },
  jorbal: { idle: ['Blub blub blub.', '*pops a bubble on its own nose*', 'Wheee, currents!', '*rides a tiny breeze*'], fight: ['Bubble trap!', 'Bloop! Gotcha!'], kill: ['Bloop bloop!', '*happy dino noises*'], win: ['BUBBLES FOR EVERYONE!'] },
  vaelift: {
    idle: ['The empty dimension is very quiet. I go there to think.', 'The Vurfenstaff has opinions. It is usually right.', 'Premium guard service. No refunds.'],
    fight: ['You cannot strike what has already left!', 'Staff! Blade! Rifle! Pick one!', 'The ice holds!'],
    kill: ['Dismissed.', 'Unmade.'],
    win: ['The dimension is stable. You are welcome.'],
  },
  agent: {
    idle: ['The watch says three new marks. The watch is never wrong.', 'Martini, please. Shaken. Not dirt.', 'I have a license. To dig. And other things.'],
    fight: ['Take the shot.', 'Clean and quiet.', 'Your file says you lose here.'],
    kill: ['Case closed.', 'Paid in full.', 'Retired.'],
    win: ['Mission debrief: I was excellent.', 'Another job well done. Expenses: one bullet.'],
  },
  slots: { idle: ['*ding*', 'INSERT COIN', '*jingle jingle*', 'LUCKY DAY!', '*plays a little tune*'], fight: ['BONUS ROUND!', 'COINS COINS COINS!', 'ALL IN!'], kill: ['WINNER!', 'PAYOUT!', 'DOUBLE OR NOTHING!'], win: ['BIG WIN! BIG WIN!', '*fireworks noises*'] },
};
for (const [cls, kinds] of Object.entries(MORE_LINES)) for (const [k, list] of Object.entries(kinds)) (LINES[cls][k] ||= []).push(...list);

export const JARGON = ['Quantum-tunnelling the eigen-dirt!', 'Classic Mohorovičić discontinuity behaviour.', 'The lithostatic pressure is non-Newtonian, obviously.',
  'Recalibrating the isostatic flux capacitor.', 'Those are basalt-phase metamorphic resonances.', 'A textbook paleomagnetic reversal cascade!',
  'Hypothesis: the enemy is made of hostile peptides.', 'Peer review would DESTROY that boarding party.', 'Entropy is just dirt with ambition.',
  'Trust me, the seismic tomography is screaming.', 'Fascinating. A chalcophile ferro-goblin.'];
export const AGENT_BRIEFS = ['Target is a known gem smuggler. Make it quiet.', 'Intel says this one carries the codes. Retrieve with prejudice.',
  'Mark has a bounty from the Deep City council. Collect.', 'He sold the surface a bad drill. Personal, this time.', 'Shaken, not stirred. The target, I mean.'];
export const DOG_BARKS = ['Woof!', 'BORK', 'grrrr', 'Arf arf!', '*sniffs suspiciously*', '*eats a boot*'];
export const CHEF_LINES = ["Order up!", "Who wants seconds?", "It's not burnt, it's caramelized.", 'Eat it, it builds character.'];
