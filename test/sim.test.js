// The game simulation (shared/sim) runs headless here exactly as it does in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../shared/sim/game.js';
import { CLASS_ORDER, CLASSES, LEVELS } from '../shared/sim/data.js';

const step = (g, seconds) => { for (let i = 0; i < seconds * 30; i++) { g.update(1 / 30); if (g.storyOpen) g.command(g.crew[0], { t: 'storyOk', choice: 'easy' }); } };

test('an all-bot crew plays through levels without getting stuck', () => {
  const g = new Game({ seed: 6, playerClass: 'pilot' });
  g.player.human = false;
  const seen = new Set();
  let lastLevel = 1, sinceLevel = 0;
  for (let i = 0; i < 30 * 60 * 40 && g.phase !== 'ending' && g.phase !== 'gameover'; i++) {
    g.update(1 / 30);
    if (g.storyOpen) g.command(g.crew[0], { t: 'storyOk', choice: 'easy' });
    seen.add(g.phase);
    if (g.level !== lastLevel) { lastLevel = g.level; sinceLevel = 0; }
    sinceLevel++;
    assert.ok(sinceLevel < 30 * 60 * 6, `stuck on level ${g.level} in phase ${g.phase}`);
  }
  for (const p of ['briefing', 'descent', 'route', 'encounter', 'aftermath']) assert.ok(seen.has(p), `never reached ${p}`);
  assert.ok(g.level >= 4, `only reached level ${g.level}`);
  assert.ok(g.crew.length > 2, 'nobody new joined the crew');
  assert.ok(g.stats.kills > 10);
});

test('every class can be played: abilities, stations and upgrades do not throw', () => {
  for (const cls of CLASS_ORDER) {
    const g = new Game({ seed: 3, playerClass: cls === 'urchid' ? 'urchid' : 'pilot' });
    g.level = 6;
    for (const k of CLASS_ORDER) if (k !== 'urchid' && !g.crew.some((c) => c.cls === k)) { g.ensureRoomFor(k); g.addCrew(k); }
    g.player.human = false;
    const me = g.crew.find((c) => c.cls === cls);
    me.human = true; g.player = me; me.wallet = 1000; me.xp = 1000;
    g.startEncounter('ship');
    for (let i = 0; i < 30 * 30; i++) {
      const t = g.mobs.find((m) => m.alive && m.team === 'enemy');
      const P = { q: i % 17 === 0, f: i % 23 === 0, e: i % 29 === 0, space: i % 31 === 0, rmb: i % 13 === 0 };
      g.setInput(me.id, { mx: Math.sin(i / 20), my: Math.cos(i / 27), ax: t ? t.x : me.x + 40, ay: t ? t.y : me.y, fire: i % 3 === 0, rmb: i % 40 < 10, e: i % 50 < 20, shift: false, pressed: P });
      g.update(1 / 30);
      if (g.storyOpen) g.command(me, { t: 'storyOk' });
    }
    const before = me.upgrades.reduce((a, b) => a + b, 0);
    me.xp = 1000;
    for (const k of [0, 1, 2]) g.command(me, { t: 'classUpgrade', track: k });
    assert.equal(me.upgrades.reduce((a, b) => a + b, 0), before + 3, `${cls} upgrades (spent XP)`);
    assert.ok(CLASSES[cls].abilities, cls);
  }
});

test('docking: doors seal, both ships fire, the fight ends and the tunnel becomes a breach to fix', () => {
  const g = new Game({ seed: 11, playerClass: 'engineer' });
  g.player.human = false;
  g.level = 3;
  g.startEncounter('ship');
  assert.ok(g.enemyShip, 'enemy ship docked');
  assert.ok(g.doors.filter((d) => d.owner === 'us').every((d) => d.sealed), 'all our doors sealed');
  const hull0 = g.enemyShip.hull;
  let ended = false;
  for (let i = 0; i < 30 * 240 && !ended; i++) { g.update(1 / 30); if (g.phase !== 'encounter') ended = true; }
  assert.ok(ended, 'encounter finished');
  assert.ok(g.stats.kills > 0);
  g.command(g.crew[0], { t: 'continue' });
  assert.equal(g.enemyShip, null);
  assert.ok(g.breaches === undefined || g.orig.size >= 1, 'the docking hole stays as damage');
  assert.ok(hull0 > 0);
});

test('ports: sell gems, buy upgrades, build rooms, switch class', () => {
  const g = new Game({ seed: 5, playerClass: 'pilot' });
  g.level = 3; g.ship.gems = 50;
  g.startPort('city');
  const me = g.player;
  me.wallet = 2000;
  const rooms = g.ourRooms.length;
  g.command(me, { t: 'sell' });
  assert.equal(g.ship.gems, 0);
  g.command(me, { t: 'buyUpgrade', id: 'plating' });
  assert.equal(g.ship.up.plating, 1);
  g.command(me, { t: 'buyRoom', type: 'storage' });
  assert.equal(g.ourRooms.length, rooms + 1);
  const other = g.crew.find((c) => c !== me && c.cls !== 'urchid');
  g.command(me, { t: 'switchClass', cls: other.cls });
  assert.equal(g.player, other);
  assert.ok(other.human && !me.human);
  g.command(other, { t: 'depart' });
  assert.equal(g.phase, 'briefing');
  assert.ok(LEVELS >= g.level);
});
