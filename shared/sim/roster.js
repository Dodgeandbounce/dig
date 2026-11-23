// The enemy roster: generated once per run. Random names, stats, builds, heights,
// weapons, bodies and races. Each type belongs to a depth tier (0 = shallow, 4 = core).
import { RACES, BUILDS, ENEMY_WEAPONS, NAME_A, NAME_B, CREATURES, BOSS } from './data.js';

export function makeRoster(rng) {
  const roster = [];
  const used = new Set();
  const name = () => {
    for (let n = 0; n < 50; n++) {
      const s = rng.pick(NAME_A) + rng.pick(NAME_B);
      if (!used.has(s)) { used.add(s); return s; }
    }
    return 'Diggers';
  };
  // 4 types per tier, 5 tiers. Shallow tiers favour melee, deeper add guns, flamers, bombers.
  const weaponsByTier = [
    ['claws', 'club', 'sack', 'pistol'],
    ['claws', 'club', 'pistol', 'shotgun', 'sack', 'drill'],
    ['club', 'pistol', 'shotgun', 'rifle', 'bomb', 'drill', 'sack'],
    ['shotgun', 'rifle', 'flamer', 'bomb', 'drill', 'club'],
    ['rifle', 'flamer', 'bomb', 'shotgun', 'club', 'drill'],
  ];
  for (let tier = 0; tier < 5; tier++) {
    const weapons = rng.shuffle([...weaponsByTier[tier]]);
    for (let k = 0; k < 4; k++) {
      const race = rng.pick(RACES);
      const build = rng.pick(BUILDS);
      const weapon = ENEMY_WEAPONS.find((w) => w.id === weapons[k % weapons.length]);
      const scale = 1 + tier * 0.55;
      roster.push({
        idx: roster.length,
        name: name(),
        tier,
        race: race.id, body: race.body, color: jitterColor(race.color, rng), eye: race.eye,
        build: build.id,
        size: build.size * rng.range(0.9, 1.12), // random heights
        hp: Math.round((26 + rng.int(0, 14)) * build.hp * scale),
        speed: Math.round(95 * build.speed * rng.range(0.9, 1.15)),
        dmgMul: build.dmg * (1 + tier * 0.35) * rng.range(0.9, 1.1),
        weapon: weapon.id,
        role: weapon.role,
        armor: tier >= 3 ? rng.range(0, 0.25) : 0,
        bounty: 4 + tier * 4,
      });
    }
  }
  // Creatures are fixed species but scale with depth
  for (const c of CREATURES) {
    const race = RACES.find((r) => r.id === c.race);
    const build = BUILDS.find((b) => b.id === c.build);
    const weapon = ENEMY_WEAPONS.find((w) => w.id === c.weapon);
    roster.push({
      idx: roster.length, name: c.name, tier: c.tierMin, creature: true,
      race: race.id, body: race.body, color: race.color, eye: race.eye, build: build.id,
      size: build.size * 1.1, hp: Math.round(40 * build.hp * (1 + c.tierMin * 0.6)), speed: Math.round(120 * build.speed),
      dmgMul: build.dmg * (1 + c.tierMin * 0.4), weapon: weapon.id, role: c.id === 'gemmite' ? 'thief' : 'brute',
      armor: 0, bounty: 6 + c.tierMin * 5,
    });
  }
  const b = BOSS; const race = RACES.find((r) => r.id === b.race);
  roster.push({ idx: roster.length, name: b.name, tier: 5, boss: true, race: race.id, body: 'boss', color: '#c0401a', eye: '#fff07a',
    build: 'burly', size: b.size, hp: b.hp, speed: 60, dmgMul: 3, weapon: 'club', role: 'boss', armor: 0.2, bounty: 400 });
  return roster;
}

function jitterColor(hex, rng) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * rng.range(0.8, 1.25)))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Tier for a level (1..12) and path. */
export function tierFor(level, path) {
  return Math.min(4, Math.floor((level - 1) / 2.6 + (path === 'brother' ? 0.5 : 0)));
}

/** Pick the 3 enemy types (with percentages) that will show up this level. */
export function levelMix(roster, level, path, rng) {
  const tier = tierFor(level, path);
  const pool = roster.filter((r) => !r.creature && !r.boss && r.tier <= tier && r.tier >= tier - 1);
  const picks = rng.shuffle([...pool]).slice(0, 3);
  let w = picks.map(() => rng.int(1, 6));
  const sum = w.reduce((a, b) => a + b, 0);
  w = w.map((v) => Math.round((v / sum) * 10) * 10);
  let diff = 100 - w.reduce((a, b) => a + b, 0);
  w[0] += diff;
  if (w[0] <= 0) { w[0] = 10; w[1] = Math.max(10, w[1] + diff - 10); }
  return picks.map((p, i) => ({ type: p.idx, pct: w[i] })).filter((m) => m.pct > 0);
}
