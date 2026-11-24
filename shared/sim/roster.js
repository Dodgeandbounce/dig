// The enemy roster: generated once per run. Random names, stats, builds, heights,
// weapons, bodies and races. Each type belongs to a depth tier (0 = shallow, 4 = core).
import { RACES, BUILDS, ENEMY_WEAPONS, NAME_A, NAME_B, CREATURES, BOSS, HOARDER } from './data.js';

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
    ['claws', 'club', 'sack', 'pistol', 'drill'],
    ['claws', 'club', 'pistol', 'shotgun', 'sack', 'drill', 'harpoon'],
    ['club', 'pistol', 'shotgun', 'rifle', 'bomb', 'drill', 'sack', 'spit', 'maul'],
    ['shotgun', 'rifle', 'flamer', 'bomb', 'drill', 'club', 'laser', 'maul', 'harpoon', 'spit'],
    ['rifle', 'flamer', 'bomb', 'shotgun', 'club', 'drill', 'laser', 'maul', 'harpoon', 'spit'],
  ];
  // Steep scaling: shallow ones are pushovers, core ones are brutal. There are lots of them, so each
  // one is a bit squishier than it would be alone. Every type rolls its own stats. Deeper tiers have
  // more kinds, and the weird races and the huge builds only turn up once you're deep enough.
  const TIER_HP = [0.55, 1.0, 1.75, 2.8, 4.2];
  const TIER_DMG = [0.55, 0.9, 1.35, 1.9, 2.6];
  const PER_TIER = [5, 6, 7, 8, 9];
  for (let tier = 0; tier < 5; tier++) {
    const weapons = rng.shuffle([...weaponsByTier[tier]]);
    // favour the races that are new at this depth
    const races = RACES.filter((r) => r.tier <= tier);
    const fresh = races.filter((r) => r.tier === tier);
    const builds = BUILDS.filter((b) => b.tier <= tier);
    for (let k = 0; k < PER_TIER[tier]; k++) {
      const race = fresh.length && k < Math.ceil(PER_TIER[tier] / 2) ? fresh[k % fresh.length] : rng.pick(races);
      const build = k === 0 && tier >= 2 ? builds[builds.length - 1] : rng.pick(builds);
      const weapon = ENEMY_WEAPONS.find((w) => w.id === weapons[k % weapons.length]);
      roster.push({
        idx: roster.length,
        name: name(),
        tier,
        race: race.id, body: race.body, color: jitterColor(race.color, rng), eye: race.eye,
        build: build.id,
        size: build.size * rng.range(0.9, 1.12), // random heights
        hp: Math.round((22 + rng.int(0, 14)) * build.hp * TIER_HP[tier] * rng.range(0.8, 1.25)),
        speed: Math.round(95 * build.speed * rng.range(0.88, 1.18) * (1 + tier * 0.04)),
        dmgMul: build.dmg * TIER_DMG[tier] * rng.range(0.8, 1.25),
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
  // the Hoarder (one per run, comes alone)
  const H = HOARDER;
  roster.push({ idx: roster.length, name: H.name, tier: 1, hoarder: true, race: H.race, body: H.body, color: H.color, eye: H.eye,
    build: 'titan', size: H.size, hp: H.hp, speed: H.speed, dmgMul: H.dmgMul, weapon: H.weapon, role: 'hoarder', armor: 0.25, bounty: 150 });
  return roster;
}

function jitterColor(hex, rng) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * rng.range(0.8, 1.25)))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Tier for a level (1..12) and path. */
export function tierFor(level, path) {
  return Math.min(4, Math.floor((level - 1) / 6.2 + (path === 'brother' ? 0.5 : 0)));
}

/**
 * The enemy types that will show up this level, with percentages. More kinds the deeper you go, and
 * now and then a rare one from further down (1-3%), just for the shock value.
 */
export function levelMix(roster, level, path, rng) {
  const tier = tierFor(level, path);
  const pool = roster.filter((r) => !r.creature && !r.boss && !r.hoarder && r.tier <= tier && r.tier >= tier - 1);
  const n = Math.min(pool.length, 3 + Math.floor(level / 6) + rng.int(0, 1));
  const picks = rng.shuffle([...pool]).slice(0, n);
  // the main ones get whole tens; the rest of the hundred is split up
  let w = picks.map(() => rng.int(1, 6));
  const sum = w.reduce((a, b) => a + b, 0);
  const mix = picks.map((p, i) => ({ type: p.idx, pct: Math.max(4, Math.round((w[i] / sum) * 100)) }));
  const deeper = roster.filter((r) => !r.creature && !r.boss && !r.hoarder && r.tier === tier + 1);
  const rare = [];
  if (deeper.length && rng.chance(0.35 + 0.05 * tier)) rare.push({ type: rng.pick(deeper).idx, pct: rng.int(1, 3), rare: true });
  const oddball = roster.filter((r) => !r.creature && !r.boss && !r.hoarder && r.tier <= tier && !picks.includes(r));
  if (oddball.length && level > 3 && rng.chance(0.4)) rare.push({ type: rng.pick(oddball).idx, pct: rng.int(1, 2), rare: true });
  const rareTotal = rare.reduce((a, m) => a + m.pct, 0);
  // squeeze the main ones down so it all adds up to 100
  let total = mix.reduce((a, m) => a + m.pct, 0);
  const scale = (100 - rareTotal) / total;
  for (const m of mix) m.pct = Math.max(1, Math.round(m.pct * scale));
  total = mix.reduce((a, m) => a + m.pct, 0) + rareTotal;
  mix.sort((a, b) => b.pct - a.pct);
  mix[0].pct += 100 - total;
  return [...mix, ...rare].filter((m) => m.pct > 0);
}
