// Draws the game: dirt, both ships, doors, breaches, gadgets, foxes, enemies, effects,
// fog of war, and the pilot's tunnel view.
import { T, TILE, MAP_W, MAP_H, ROOMS, SLOT_W, SLOT_H, CLASSES, GEMS, TILE_HP } from '../shared/sim/data.js';
import { idx, rw, rh } from '../shared/sim/grid.js';
import { isBehind } from '../shared/sim/combat.js';
import { drawCrew, drawMob, drawStation, shade, roundRect } from './sprites.js';
// (T.SAND is the island's beach)

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, zoom: 1.25, shake: 0, overview: false };
  const parts = [];   // particles
  const texts = [];   // floating numbers / words
  const ripples = []; // dog sense
  const tracers = []; // ship-to-ship fire
  let flash = 0, flashColor = '255,60,40';
  // Lighting: everything is dark except what you can see (line of sight from your fox, like the
  // old top-down shooters), lit up further by muzzle flashes, explosions, fires and consoles.
  const lights = [];                 // short-lived: { x, y, r, a, col, life, max }
  const lightCv = document.createElement('canvas');
  const lctx = lightCv.getContext('2d');
  const recoil = new Map();          // crew id -> seconds of gun kick left (drawn pushed back)
  const kick = { x: 0, y: 0 };       // camera kick when you fire
  let drillSpin = 0;
  let meId = null;
  let t = 0;
  let W = 0, H = 0, dpr = 1;
  const seen = new Map(); // room index -> last time visible (fades fog)
  const dirts = [0, 1, 2, 3, 4].map((tier) => makeDirtPattern(ctx, tier));
  const scroll = { x: 0, y: 0 };
  let heading = Math.PI / 4;   // the dirt streams past diagonally: we're digging down and to the right

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    W = canvas.width = Math.round(r.width * dpr);
    H = canvas.height = Math.round(r.height * dpr);
    lightCv.width = W; lightCv.height = H;
  }
  const light = (x, y, r, a, col, life) => lights.push({ x, y, r, a, col, life, max: life });
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------------------------------------------------------------------
  function onFx(e, g) {
    const R = Math.random;
    switch (e.t) {
      case 'hit': for (let k = 0; k < 4; k++) parts.push(p(e.x, e.y, (R() - .5) * 160, (R() - .5) * 160, 0.3, e.team === 'crew' ? '#ff5040' : '#ffd080', 2)); if (e.amt >= 3) texts.push(txt(e.x, e.y - 14, String(e.amt), e.team === 'crew' ? '#ff6050' : '#fff', 0.7, 11)); break;
      case 'boom': { cam.shake = Math.min(14, cam.shake + e.r / 9); light(e.x, e.y, e.r * 2.8 + 40, 1, '255,170,80', 0.4); parts.push({ ring: true, x: e.x, y: e.y, r: 4, R: e.r, life: 0.35, max: 0.35, color: '255,180,80' });
        for (let k = 0; k < 18; k++) { const a = R() * 7, s = R() * e.r * 4; parts.push(p(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 0.5 + R() * 0.4, R() < .5 ? '#ffb040' : '#ff6020', 3 + R() * 3)); }
        for (let k = 0; k < 8; k++) { const a = R() * 7, s = R() * 120; parts.push(p(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 1.2, '#3a3028', 2, true)); } break; }
      case 'spark': light(e.x, e.y, 40, 0.5, '255,220,140', 0.06); for (let k = 0; k < 3; k++) parts.push(p(e.x, e.y, (R() - .5) * 200, (R() - .5) * 200, 0.25, e.color || '#ffe080', 1.6)); break;
      case 'die': for (let k = 0; k < 14; k++) { const a = R() * 7, s = 40 + R() * 160; parts.push(p(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 0.6, e.color, 3)); } break;
      case 'text': texts.push(txt(e.x, e.y, e.text, e.color || '#fff', 1.4, 12)); break;
      case 'swing': parts.push({ arc: true, x: e.x, y: e.y, a: e.a, r: e.r, life: 0.15, max: 0.15, color: e.cls === 'mrclean' ? '#a0ffb0' : e.cls === 'fish' ? '#a0e0ff' : '#ffffff' }); break;
      case 'shot': {
        const mx = e.x + Math.cos(e.a) * 16, my = e.y + Math.sin(e.a) * 16;
        const big = e.w === 'rocket' || e.w === 'scrap' || e.w === 'ppk';
        // muzzle flash: a bright star and a burst of light
        parts.push({ muzzle: true, x: mx, y: my, a: e.a, life: 0.06, max: 0.06, size: big ? 13 : 9, color: e.w === 'coin' ? '#f4c542' : '#fff6c0' });
        if (e.w !== 'silenced') light(mx, my, big ? 150 : 110, 0.95, e.w === 'coin' ? '255,220,90' : '255,225,160', 0.07);
        // spent brass flies out the side
        if (e.w === 'bullet' || e.w === 'ppk' || e.w === 'silenced' || e.w === 'scrap') {
          const s = Math.random() < 0.5 ? 1 : -1, ca = e.a + s * Math.PI / 2 + (R() - .5) * 0.6, sp = 70 + R() * 60;
          parts.push(p(e.x, e.y, Math.cos(ca) * sp - Math.cos(e.a) * 20, Math.sin(ca) * sp - Math.sin(e.a) * 20, 0.9, e.w === 'scrap' ? '#9a9080' : '#d8a840', 2.5, true));
        }
        // your gun kicks: the view jolts back a touch and your fox flinches
        if (e.crew != null) recoil.set(e.crew, 0.09);
        if (e.crew != null && e.crew === meId) { const k = big ? 5 : 2.2; kick.x -= Math.cos(e.a) * k; kick.y -= Math.sin(e.a) * k; }
        break;
      }
      case 'eshot': light(e.x, e.y, 80, 0.7, '255,130,90', 0.07); parts.push({ muzzle: true, x: e.x, y: e.y, a: R() * 6, life: 0.05, max: 0.05, size: 7, color: '#ffb080' }); break;
      case 'pop': parts.push({ ring: true, x: e.x, y: e.y, r: e.r, R: e.r * 1.8, life: 0.25, max: 0.25, color: '160,230,255' }); break;
      case 'fling': parts.push({ fling: true, x: e.x, y: e.y, x2: e.x2, y2: e.y2, life: 0.5, max: 0.5, color: e.color }); break;
      case 'zap': light(e.x, e.y, 100, 0.9, '120,200,255', 0.15); for (let k = 0; k < 8; k++) parts.push(p(e.x, e.y, (R() - .5) * 220, (R() - .5) * 220, 0.3, '#80e0ff', 2)); break;
      case 'splash': parts.push({ ring: true, x: e.x, y: e.y, r: 8, R: 60, life: 0.4, max: 0.4, color: hexToRgb(e.color) }); break;
      case 'flame': light(e.x + Math.cos(e.a) * e.r * 0.6, e.y + Math.sin(e.a) * e.r * 0.6, 150, 0.8, '255,140,40', 0.12); for (let k = 0; k < 3; k++) { const a = e.a + (R() - .5) * 0.5, s = 200 + R() * 120; parts.push(p(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, e.r / s, R() < .5 ? '#ff8020' : '#ffd040', 5)); } break;
      case 'saw': if (e.hit) for (let k = 0; k < 2; k++) parts.push(p(e.x + Math.cos(e.a) * 30, e.y + Math.sin(e.a) * 30, (R() - .5) * 200, (R() - .5) * 200, 0.3, '#c02020', 2.5)); break;
      case 'claw': parts.push({ arc: true, x: e.x, y: e.y, a: R() * 6, r: 14, life: 0.12, max: 0.12, color: '#ff5050' }); break;
      case 'bang': parts.push(p(e.x, e.y, 0, 0, 0.1, '#ffffff', 6)); cam.shake = Math.min(6, cam.shake + 1); break;
      case 'capture': parts.push({ ring: true, x: e.x, y: e.y, r: 30, R: 2, life: 0.4, max: 0.4, color: '255,255,255' }); texts.push(txt(e.x, e.y - 20, 'CAUGHT!', '#7cc46a', 1.4, 14)); break;
      case 'poof': for (let k = 0; k < 10; k++) parts.push(p(e.x, e.y, (R() - .5) * 120, (R() - .5) * 120, 0.5, '#dddddd', 4)); break;
      case 'vent': parts.push(p(e.x, e.y, 0, 0, 0.3, '#40a070', 10)); parts.push(p(e.x2, e.y2, 0, 0, 0.3, '#40a070', 10)); break;
      case 'meal': texts.push(txt(e.x, e.y - 22, '🍲', '#fff', 1.2, 16)); parts.push({ ring: true, x: e.x, y: e.y, r: 4, R: 30, life: 0.5, max: 0.5, color: '255,200,120' }); break;
      case 'coins': for (let k = 0; k < 12; k++) { const a = R() * 7; parts.push(p(e.x, e.y, Math.cos(a) * 160, Math.sin(a) * 160, 0.7, '#f4c542', 3)); } break;
      case 'fixed': texts.push(txt(e.x, e.y - 10, 'fixed!', '#7cc46a', 1, 11)); break;
      case 'sweep': parts.push(p(e.x, e.y, (R() - .5) * 60, -40, 0.4, '#b0a080', 3)); break;
      case 'impact': flash = 0.5; flashColor = '255,80,40'; cam.shake = Math.min(16, cam.shake + 8); break;
      case 'dfire': tracers.push({ who: e.who, w: e.w, gun: e.gun, from: e.from, blocked: e.blocked, miss: e.miss, room: e.room, delay: e.delay || 0, life: e.w === 'missile' ? 1.2 : 0.8, max: e.w === 'missile' ? 1.2 : 0.8 }); if (e.who === 'them' && !e.blocked && !e.miss) { flash = 0.25; cam.shake += 4; } break;
      case 'shipdie': cam.shake = 20; flash = 0.6; flashColor = '255,200,120'; break;
      case 'bossdie': cam.shake = 30; flash = 1; flashColor = '255,240,180'; break;
      case 'gameover': flash = 1; flashColor = '0,0,0'; break;
      case 'respawn': parts.push({ ring: true, x: e.x, y: e.y, r: 30, R: 4, life: 0.5, max: 0.5, color: '124,196,106' }); break;
      case 'phase': parts.push({ ring: true, x: e.x, y: e.y, r: 4, R: 30, life: 0.3, max: 0.3, color: '160,160,255' }); break;
      case 'down': texts.push(txt(e.x, e.y - 20, 'DOWN', '#ff6050', 1.5, 14)); break;
      case 'spray': for (let k = 0; k < 4; k++) { const f = R(); parts.push(p(e.x + (e.x2 - e.x) * f, e.y + (e.y2 - e.y) * f, (R() - .5) * 60, (R() - .5) * 60, 0.45, R() < .5 ? '#e8f4ff' : '#b0d8f0', 4 + R() * 4)); } break;
      case 'fire': cam.shake = Math.min(10, cam.shake + 3); break;
      case 'docked': cam.shake = Math.min(18, cam.shake + 10); flash = 0.35; flashColor = '255,120,60'; texts.push(txt(e.x, e.y - 30, 'DOCKED!', '#ff6a3a', 1.8, 16)); break;
      case 'xp': if (e.crew === meId) texts.push(txt(e.x, e.y, `+${e.n} xp`, '#58b4ff', 1.3, 11)); break;
      case 'dash': // a puff of smoke where you kicked off, and a trail
        for (let k = 0; k < (e.big ? 12 : 8); k++) { const a = e.a + Math.PI + (R() - .5) * 1.6, s = 30 + R() * 90; parts.push({ ...p(e.x + (R() - .5) * 10, e.y + 6 + (R() - .5) * 8, Math.cos(a) * s, Math.sin(a) * s - 10, 0.5 + R() * 0.3, R() < .5 ? 'rgba(200,190,180,.7)' : 'rgba(150,140,130,.6)', 7 + R() * 6), smoke: true }); }
        break;
      case 'backstab': texts.push(txt(e.x, e.y - 26, 'BACKSTAB!', '#ffffff', 1.2, 14)); for (let k = 0; k < 10; k++) parts.push(p(e.x, e.y, (R() - .5) * 220, (R() - .5) * 220, 0.4, '#c01818', 3)); break;
      case 'caw': for (let k = 0; k < 3; k++) parts.push(p(e.x + (R() - .5) * 10, e.y - 16, (R() - .5) * 60, -30 - R() * 40, 0.5, '#222', 2)); break;
      case 'slots': slotsShow(e); break;
      case 'meal': if (e.heal) texts.push(txt(e.x, e.y - 34, `+${e.heal} HP`, '#7cc46a', 1.3, 12)); break;
      case 'dust': for (let k = 0; k < 8; k++) { const a = R() * 7, s = 30 + R() * 90; parts.push({ ...p(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 0.9 + R() * 0.6, R() < .5 ? 'rgba(150,140,125,.7)' : 'rgba(110,100,90,.6)', 8 + R() * 8), smoke: true }); } for (let k = 0; k < 5; k++) parts.push(p(e.x, e.y, (R() - .5) * 200, (R() - .5) * 200, 0.8, '#6a625a', 4, true)); break;
      case 'crunch': cam.shake = Math.min(12, cam.shake + 3); break;
      case 'stomp': cam.shake = Math.min(14, cam.shake + 5); parts.push({ ring: true, x: e.x, y: e.y, r: 20, R: 90, life: 0.4, max: 0.4, color: '200,180,150' }); break;
      case 'chomp': cam.shake = Math.min(10, cam.shake + 3); for (let k = 0; k < 6; k++) parts.push(p(e.x + (R() - .5) * 40, e.y + (R() - .5) * 30, (R() - .5) * 160, -R() * 140, 0.6, R() < .5 ? '#8a8a90' : '#5a4a3a', 4, true)); texts.push(txt(e.x + (R() - .5) * 30, e.y - 20, R() < .5 ? 'CHOMP' : 'CRUNCH', '#ff9070', 0.7, 13)); break;
      case 'gulp': texts.push(txt(e.x, e.y - 40, '*GULP*', '#ffb080', 1.4, 18)); cam.shake = Math.min(18, cam.shake + 8); break;
      case 'burrow': for (let k = 0; k < 14; k++) { const a = R() * 7, s = 60 + R() * 160; parts.push(p(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 0.7, R() < .5 ? '#5a4030' : '#7a5a40', 4 + R() * 3, true)); } cam.shake = Math.min(10, cam.shake + 4); break;
      case 'splat': for (let k = 0; k < (e.small ? 6 : 16); k++) { const a = R() * 7, s = 40 + R() * 160; parts.push(p(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 0.6, R() < .7 ? '#e02840' : '#f0e8a0', 4)); } break;
      case 'virus': parts.push({ ring: true, x: e.x, y: e.y, r: 6, R: 40, life: 0.3, max: 0.3, color: '150,240,60' }); break;
      case 'candy': for (let k = 0; k < 16; k++) { const a = R() * 7; parts.push({ confetti: true, x: e.x, y: e.y - 6, vx: Math.cos(a) * 120, vy: Math.sin(a) * 120 - 80, life: 0.9, max: 0.9, color: `hsl(${(R() * 360) | 0},90%,65%)`, size: 3, rot: R() * 6, spin: (R() - .5) * 18 }); } break;
      case 'chain': { // a jagged bolt of lightning
        const n = 7, pts = [];
        for (let k = 0; k <= n; k++) { const f = k / n; pts.push([e.x + (e.x2 - e.x) * f + (k && k < n ? (R() - .5) * 18 : 0), e.y + (e.y2 - e.y) * f + (k && k < n ? (R() - .5) * 18 : 0)]); }
        parts.push({ bolt: true, pts, life: 0.12, max: 0.12 });
        light(e.x2, e.y2, 110, 0.9, '160,200,255', 0.1);
        break;
      }
      case 'elem': { const col = { grass: '#60d050', fire: '#ff7020', water: '#40a0ff', electric: '#ffe040' }[e.elem] || '#fff'; for (let k = 0; k < 7; k++) parts.push(p(e.x, e.y, (R() - .5) * 140, (R() - .5) * 140, 0.45, col, 3)); break; }
      case 'fuse': parts.push(p(e.x + 9, e.y - 12, (R() - .5) * 60, -R() * 60, 0.3, R() < .5 ? '#ffe060' : '#ff8020', 2)); break;
      case 'mainevent': flash = 0.8; flashColor = '255,60,40'; cam.shake = 20; break;
      case 'event': flash = 0.3; flashColor = e.good ? '120,255,160' : '255,120,60'; break;
    }
  }
  /** The slot machine wins: flashing lights and confetti. The bigger the win, the crazier it gets. */
  function slotsShow(e) {
    const R = Math.random;
    if (!e.win || e.win <= 6) return;
    const big = Math.min(4, e.win / 25);
    const cols = ['#f4c542', '#ff4060', '#40d0ff', '#80ff60', '#ff80ff', '#ffffff', '#ff9020'];
    const n = Math.round(24 + big * 60);
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (R() - .5) * 2.6, s = 120 + R() * (220 + big * 120);
      parts.push({ confetti: true, x: e.x, y: e.y - 10, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.4 + R() * (1 + big * 0.4), max: 2.4 + big * 0.4, color: cols[(R() * cols.length) | 0], size: 3 + R() * 3, rot: R() * 6, spin: (R() - .5) * 18 });
    }
    // rings of light going off around the machine
    for (let k = 0; k < 2 + Math.round(big * 2); k++) setTimeout(() => {
      const col = ['255,220,90', '255,80,120', '80,220,255', '140,255,120'][k % 4];
      light(e.x, e.y, 140 + big * 60, 1, col, 0.35);
      parts.push({ ring: true, x: e.x, y: e.y, r: 10, R: 60 + big * 40, life: 0.4, max: 0.4, color: col });
    }, k * 140);
    texts.push(txt(e.x, e.y - 40, e.win >= 150 ? 'JACKPOT!!!' : e.win >= 60 ? 'BIG WIN!' : 'WINNER!', '#f4c542', 1.8 + big * 0.3, 14 + big * 4));
    if (e.win >= 60) { flash = 0.5 + big * 0.1; flashColor = '255,220,120'; cam.shake = Math.min(20, cam.shake + 4 + big * 3); }
  }
  const p = (x, y, vx, vy, life, color, size, debris) => ({ x, y, vx, vy, life, max: life, color, size, debris });
  const txt = (x, y, s, color, life, size) => ({ x, y, s, color, life, max: life, size });

  // ---------------------------------------------------------------------
  function frame(g, me, dt, view) {
    t += dt;
    const ctxs = ctx;
    ctxs.setTransform(1, 0, 0, 1, 0, 0);
    if (view.pilot) { drawPilotView(g, dt); return; }

    // camera
    const target = view.focus || me;
    let zoom = cam.zoom;
    if (cam.overview) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      if (g.box) { // the ship, plus room for the drill out front
        x0 = g.box.x0; y0 = g.box.y0; x1 = g.box.x1; y1 = g.box.y1;
        const dx = Math.cos(heading), dy = Math.sin(heading);
        if (dx > 0.3) x1 += 7; else if (dx < -0.3) x0 -= 7;
        if (dy > 0.3) y1 += 7; else if (dy < -0.3) y0 -= 7;
      }
      for (const r of g.rooms) { if (r.gone) continue; x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x0 + rw(r)); y1 = Math.max(y1, r.y0 + rh(r)); }
      for (const es of g.enemyShips || []) if (!es.gone && es.rect) { const R = es.rect; x0 = Math.min(x0, R.x0); y0 = Math.min(y0, R.y0); x1 = Math.max(x1, R.x0 + R.w); y1 = Math.max(y1, R.y0 + R.h); }
      zoom = Math.min(W / dpr / ((x1 - x0 + 2) * TILE), H / dpr / ((y1 - y0 + 2) * TILE));
      cam.x += (((x0 + x1) / 2) * TILE - cam.x) * Math.min(1, dt * 6);
      cam.y += (((y0 + y1) / 2) * TILE - cam.y) * Math.min(1, dt * 6);
    } else if (target) {
      const lead = view.aim ? { x: (view.aim.x - target.x) * 0.18, y: (view.aim.y - target.y) * 0.18 } : { x: 0, y: 0 };
      cam.x += (target.x + lead.x - cam.x) * Math.min(1, dt * 8);
      cam.y += (target.y + lead.y - cam.y) * Math.min(1, dt * 8);
    }
    cam.shake *= Math.pow(0.02, dt);
    meId = me?.id ?? null;
    const kf = Math.pow(0.0005, dt); kick.x *= kf; kick.y *= kf;
    const sx = (Math.random() - .5) * cam.shake + kick.x, sy = (Math.random() - .5) * cam.shake + kick.y;
    const z = zoom * dpr;
    cam.effZoom = zoom;
    ctxs.setTransform(z, 0, 0, z, W / 2 - (cam.x + sx) * z, H / 2 - (cam.y + sy) * z);

    // visible world rect
    const vx0 = cam.x - W / 2 / z - TILE, vy0 = cam.y - H / 2 / z - TILE;
    const vx1 = cam.x + W / 2 / z + TILE, vy1 = cam.y + H / 2 / z + TILE;

    // dirt: streams past diagonally (we're heading down and to the right), banking when the tunnel turns
    const moving = g.phase === 'descent' && !g.descent?.stranded;
    const want = Math.PI / 4 + (g.descent?.bank || 0) + (g.descent?.steer?.x || 0) * 0.25;
    heading += (want - heading) * Math.min(1, dt * 1.5);
    const spd = moving ? 300 * (g.descent?.boost ? 1.8 : 1) : 0;
    const dirX = Math.cos(heading), dirY = Math.sin(heading);
    scroll.x += dirX * spd * dt; scroll.y += dirY * spd * dt;
    if (g.island) drawSea(ctxs, vx0, vy0, vx1, vy1);
    else {
      const dirt = dirts[Math.min(4, g.tier || 0)];
      ctxs.save();
      ctxs.fillStyle = dirt.pattern;
      ctxs.translate(-scroll.x, -scroll.y);
      ctxs.fillRect(vx0 + scroll.x, vy0 + scroll.y, vx1 - vx0, vy1 - vy0);
      ctxs.restore();
      const layerTint = ['rgba(0,0,0,0)', 'rgba(120,40,10,.12)', 'rgba(160,30,10,.2)', 'rgba(220,90,10,.22)', 'rgba(255,200,60,.2)'][Math.min(4, g.tier)];
      ctxs.fillStyle = layerTint; ctxs.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    }
    if (moving) { // speed streaks along the direction of travel (the world rushes up and back past us)
      ctxs.strokeStyle = `rgba(255,220,180,${g.descent?.boost ? 0.1 : 0.06})`; ctxs.lineWidth = 2;
      const w = vx1 - vx0 + 600, h = vy1 - vy0 + 600, L = 70 + spd * 0.15;
      for (let k = 0; k < 40; k++) {
        const along = ((t * spd * 3 + k * 397) % (w + h));
        const across = (k * 137.5) % (w + h);
        // spread the streaks over the view, moving against the heading
        const px = vx0 - 300 + ((across * -dirY + (w + h) - along * dirX) % w + w) % w;
        const py = vy0 - 300 + ((across * dirX + (w + h) - along * dirY) % h + h) % h;
        ctxs.beginPath(); ctxs.moveTo(px, py); ctxs.lineTo(px + dirX * L, py + dirY * L); ctxs.stroke();
      }
    }
    drawApproaching(ctxs, g);
    // drills: ours on the front of the ship (pointing the way we're digging), theirs pointing at us
    drillSpin += dt * (moving ? (g.descent?.boost ? 14 : 9) : 0.6);
    if (g.box) drawShipDrill(ctxs, g, moving);
    for (const es of g.enemyShips || []) if (es.docked && !es.gone && es.rect) {
      const R = es.rect, dir = es.side === 'top' ? 1 : -1;
      const bx = (R.x0 + R.w * 0.22) * TILE, by = (es.side === 'top' ? R.y0 + R.h : R.y0) * TILE;
      drawDrill(ctxs, bx, by, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 4.2 * TILE, 4.4 * TILE, es.done ? 0 : t * 1.5, true);
    }

    // visibility
    const vis = visibleRooms(g, me);
    for (const r of vis) seen.set(r, t);

    // tiles
    const tx0 = Math.max(0, Math.floor(vx0 / TILE)), ty0 = Math.max(0, Math.floor(vy0 / TILE));
    const tx1 = Math.min(MAP_W - 1, Math.floor(vx1 / TILE)), ty1 = Math.min(MAP_H - 1, Math.floor(vy1 / TILE));
    const G = g.grid;
    // a little depth: walls get a darker face where they drop down to the floor, and floors are
    // shadowed under the wall above and to the left
    const tall = (tt) => tt === T.WALL || tt === T.HULL || tt === T.DEBRIS;
    const wallFace = (x, y, px, py, col) => {
      const below = G.get(x, y + 1);
      if (below === T.FLOOR || below === T.RUBBLE || below === T.TUNNEL) {
        ctxs.fillStyle = col; ctxs.fillRect(px, py + TILE - 11, TILE, 11);
        ctxs.fillStyle = 'rgba(255,255,255,.08)'; ctxs.fillRect(px, py + TILE - 11, TILE, 1.5);
      }
    };
    const floorShade = (x, y, px, py) => {
      if (tall(G.get(x, y - 1))) { ctxs.fillStyle = 'rgba(0,0,0,.32)'; ctxs.fillRect(px, py, TILE, 6); ctxs.fillStyle = 'rgba(0,0,0,.14)'; ctxs.fillRect(px, py + 6, TILE, 7); }
      if (tall(G.get(x - 1, y))) { ctxs.fillStyle = 'rgba(0,0,0,.22)'; ctxs.fillRect(px, py, 6, TILE); }
    };
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const i = idx(x, y);
      const tt = G.tiles[i];
      if (tt === T.VOID) continue;
      const px = x * TILE, py = y * TILE;
      const ri = G.room[i];
      switch (tt) {
        case T.FLOOR: {
          const room = ri >= 0 ? g.rooms[ri] : null;
          if (!room) { // the walkway around the ship: steel grating
            ctxs.fillStyle = '#2c2a27'; ctxs.fillRect(px, py, TILE, TILE);
            ctxs.fillStyle = '#3a3733';
            for (let k = 2; k < TILE; k += 6) ctxs.fillRect(px + k, py + 2, 3, TILE - 4);
            ctxs.fillStyle = 'rgba(0,0,0,.35)'; ctxs.fillRect(px, py + TILE - 2, TILE, 2);
            floorShade(x, y, px, py);
            break;
          }
          const base = room ? (ROOMS[room.type]?.color || (room.owner === 'them' ? '#3a2a2a' : '#333')) : '#333';
          ctxs.fillStyle = (x + y) & 1 ? base : shade(base, 8);
          ctxs.fillRect(px, py, TILE, TILE);
          if (room?.owner === 'them') { ctxs.fillStyle = 'rgba(120,0,0,.12)'; ctxs.fillRect(px, py, TILE, TILE); }
          floorShade(x, y, px, py);
          break;
        }
        case T.WALL: ctxs.fillStyle = '#5c5650'; ctxs.fillRect(px, py, TILE, TILE); ctxs.fillStyle = '#6e6862'; ctxs.fillRect(px, py, TILE, 5); wallFace(x, y, px, py, '#3d3934'); dmgCracks(ctxs, px, py, G.hp[i] / 90); break;
        case T.HULL: ctxs.fillStyle = '#48443f'; ctxs.fillRect(px, py, TILE, TILE); ctxs.fillStyle = '#5a5650'; ctxs.fillRect(px + 2, py + 2, TILE - 4, TILE - 4); ctxs.fillStyle = '#2e2a26'; ctxs.fillRect(px + 5, py + 5, 3, 3); ctxs.fillRect(px + TILE - 8, py + TILE - 8, 3, 3); wallFace(x, y, px, py, '#33302c'); if (G.hp[i] < 140) dmgCracks(ctxs, px, py, G.hp[i] / 140); break;
        case T.DOOR: drawDoor(ctxs, g, G.doorAt[i], px, py); break;
        case T.TUNNEL: ctxs.fillStyle = '#2f2a26'; ctxs.fillRect(px, py, TILE, TILE); ctxs.fillStyle = '#3a342e'; ctxs.fillRect(px, py + ((y * 7) % 3) * 8, TILE, 3); break;
        case T.BREACH: { ctxs.fillStyle = '#0a0705'; ctxs.fillRect(px, py, TILE, TILE); ctxs.fillStyle = '#6a4a2a';
          for (let k = 0; k < 4; k++) { const ph = (t * 1.5 + k * 0.25 + x * 0.13) % 1; ctxs.fillRect(px + 6 + k * 6, py + ph * TILE, 3, 3); }
          ctxs.strokeStyle = '#ff5030'; ctxs.lineWidth = 1.5; ctxs.setLineDash([4, 3]); ctxs.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2); ctxs.setLineDash([]);
          const prog = g.rebuild?.get(i); if (prog) { ctxs.fillStyle = '#7cc46a'; ctxs.fillRect(px + 2, py + TILE - 5, (TILE - 4) * Math.min(1, prog / 98), 3); } break; }
        case T.RUBBLE: { const room = g.rooms[ri]; ctxs.fillStyle = room ? shade(ROOMS[room.type]?.color || '#333', -10) : '#2a2622'; ctxs.fillRect(px, py, TILE, TILE);
          ctxs.fillStyle = '#6a625a'; for (let k = 0; k < 5; k++) ctxs.fillRect(px + ((k * 13 + x * 7) % 26), py + ((k * 17 + y * 5) % 26), 5, 4);
          const prog = g.rebuild?.get(i); if (prog) { ctxs.fillStyle = '#7cc46a'; ctxs.fillRect(px + 2, py + TILE - 5, (TILE - 4) * Math.min(1, prog / 60), 3); } break; }
        case T.SAND: { // the beach: warm sand, a few shells, foam where it meets the sea
          ctxs.fillStyle = (x * 7 + y * 3) % 5 ? '#e8d09a' : '#e2c88e'; ctxs.fillRect(px, py, TILE, TILE);
          ctxs.fillStyle = 'rgba(190,150,90,.35)'; ctxs.fillRect(px + ((x * 13 + y * 7) % 24) + 2, py + ((x * 5 + y * 11) % 24) + 2, 3, 2);
          if ((x * 31 + y * 17) % 23 === 0) { ctxs.fillStyle = '#fff4e8'; ctxs.beginPath(); ctxs.arc(px + 16, py + 16, 3, 0, Math.PI); ctxs.fill(); }
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (G.get(x + dx, y + dy) === T.VOID) {
            const w = 3 + Math.sin(t * 2 + x * 0.7 + y * 0.5) * 2;
            ctxs.fillStyle = 'rgba(255,255,255,.55)';
            if (dx) ctxs.fillRect(dx > 0 ? px + TILE - w : px, py, w, TILE); else ctxs.fillRect(px, dy > 0 ? py + TILE - w : py, TILE, w);
          }
          break;
        }
        case T.ICE: ctxs.fillStyle = '#bfefff'; ctxs.fillRect(px + 1, py + 1, TILE - 2, TILE - 2); ctxs.fillStyle = 'rgba(255,255,255,.7)'; ctxs.fillRect(px + 4, py + 4, 8, 4); break;
        case T.DEBRIS: { // wreckage: twisted plating and beams, blocks the way until cleared
          const room = g.rooms[ri]; ctxs.fillStyle = room ? shade(ROOMS[room.type]?.color || '#333', -14) : '#2a2622'; ctxs.fillRect(px, py, TILE, TILE);
          ctxs.fillStyle = '#5a5248'; ctxs.save(); ctxs.translate(px + 16, py + 16);
          for (let k = 0; k < 4; k++) { ctxs.rotate(0.9 + ((x * 7 + y * 3 + k) % 5) * 0.4); ctxs.fillRect(-13, -3, 26, 6); }
          ctxs.restore();
          ctxs.fillStyle = '#7a7064'; for (let k = 0; k < 4; k++) ctxs.fillRect(px + ((k * 11 + x * 5) % 24) + 2, py + ((k * 13 + y * 7) % 24) + 2, 6, 5);
          ctxs.strokeStyle = 'rgba(255,190,60,.7)'; ctxs.lineWidth = 1.5; ctxs.setLineDash([3, 3]); ctxs.strokeRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3); ctxs.setLineDash([]);
          const prog = g.rebuild?.get(i); if (prog) { ctxs.fillStyle = '#7cc46a'; ctxs.fillRect(px + 2, py + TILE - 5, (TILE - 4) * Math.min(1, prog / 42), 3); }
          break; }
      }
    }
    // fires
    for (const o of g.objs) {
      if (o.kind !== 'fire' || o.x < vx0 || o.x > vx1 || o.y < vy0 || o.y > vy1) continue;
      const f = Math.max(0.15, o.f);
      ctxs.fillStyle = `rgba(255,90,20,${0.25 * f})`; ctxs.fillRect(o.x - 16, o.y - 16, 32, 32);
      for (let k = 0; k < 4; k++) {
        const ph = (t * (2.2 + k * 0.4) + o.id * 0.37 + k * 0.25) % 1;
        const fx = o.x - 10 + k * 7 + Math.sin(t * 9 + k + o.id) * 2, fy = o.y + 10 - ph * 22 * f;
        const r = (1 - ph) * 7 * f + 2;
        ctxs.fillStyle = ph < 0.4 ? '#ffe070' : ph < 0.75 ? '#ff8a20' : 'rgba(120,60,40,.6)';
        ctxs.beginPath(); ctxs.arc(fx, fy, r, 0, 7); ctxs.fill();
      }
      if (Math.random() < 0.08 * f) parts.push(p(o.x + (Math.random() - .5) * 20, o.y - 8, (Math.random() - .5) * 20, -40 - Math.random() * 40, 0.9, 'rgba(60,50,45,.8)', 4));
    }

    // rooms: labels, stations
    ctxs.textAlign = 'left'; ctxs.textBaseline = 'top';
    g.rooms.forEach((room, ri) => {
      const x = room.x0 * TILE, y = room.y0 * TILE;
      if (room.gone || x > vx1 || y > vy1 || x + rw(room) * TILE < vx0 || y + rh(room) * TILE < vy0) return;
      ctxs.font = 'bold 9px system-ui';
      ctxs.fillStyle = room.owner === 'them' ? 'rgba(255,160,150,.7)' : 'rgba(255,240,220,.55)';
      if (rw(room) >= 7) ctxs.fillText(room.name.toUpperCase(), x + TILE * 4 + 3, y + TILE + 3);
      else if (rh(room) >= 5 && !room.sys) { ctxs.save(); ctxs.translate(x + TILE * 1.3, y + TILE * 1.2); ctxs.rotate(Math.PI / 2); ctxs.fillText(room.name.toUpperCase(), 0, 0); ctxs.restore(); }
      if (room.sys || room.type === 'core' || room.type === 'pod') {
        const active = me && Math.hypot(me.x - room.station.x, me.y - room.station.y) < 46;
        drawStation(ctxs, room, t, active, room.type === 'lounge' ? g.crew.find((c) => c.cls === 'urchid')?.upgrades : null);
        if (room.sys && room.sys.hp < room.sys.max) bar(ctxs, room.station.x - 22, room.station.y + 15, 44, 4, room.sys.hp / room.sys.max, room.sys.hp <= 0 ? '#802020' : '#e0533a');
        if (room.sys && room.sys.hp <= 0 && Math.sin(t * 8) > 0) { ctxs.fillStyle = '#ff5040'; ctxs.font = 'bold 9px system-ui'; ctxs.textAlign = 'center'; ctxs.fillText('OFFLINE', room.station.x, room.station.y + 20); ctxs.textAlign = 'left'; }
        if (room.sys && room.sys.hp > 0 && room.sys.hp < room.sys.max * 0.5 && Math.random() < 0.15) onFx({ t: 'spark', x: room.station.x + (Math.random() - .5) * 30, y: room.station.y }, g);
      }
      if (g.ship.missileTarget === ri && g.phase === 'encounter') { ctxs.strokeStyle = '#ff6a3a'; ctxs.lineWidth = 2; ctxs.setLineDash([6, 4]); ctxs.lineDashOffset = -t * 30; ctxs.strokeRect(x + TILE, y + TILE, (rw(room) - 1) * TILE, (rh(room) - 1) * TILE); ctxs.setLineDash([]);
        ctxs.fillStyle = '#ff6a3a'; ctxs.font = 'bold 10px system-ui'; ctxs.fillText('⌖ TARGET', x + TILE + 3, y + TILE + 14); }
    });

    // farm plots: rows of tilled dirt across the big farm (darker when watered)
    const farm = g.rooms.find((r) => r.owner === 'us' && r.type === 'farm');
    if (farm) {
      const cols = Math.max(3, Math.floor((rw(farm) - 3) / 2.6));
      g.ship.farm.plots.forEach((pl, k) => {
        const px = (farm.x0 + 1.4 + (k % cols) * 2.6) * TILE, py = (farm.y0 + 3 + Math.floor(k / cols) * 1.7) * TILE;
        ctxs.fillStyle = pl.wet ? '#2e2010' : '#4a3418'; ctxs.fillRect(px, py, TILE * 2.1, TILE * 1.1);
        ctxs.fillStyle = 'rgba(0,0,0,.25)'; for (let s = 0; s < 3; s++) ctxs.fillRect(px + 2, py + 6 + s * 10, TILE * 2.1 - 4, 2);
        if (pl.wet) { ctxs.fillStyle = 'rgba(120,180,255,.25)'; ctxs.fillRect(px, py, TILE * 2.1, TILE * 1.1); }
        if (pl.stage > 0) { ctxs.fillStyle = pl.stage >= 3 ? '#e0c040' : '#60b040'; for (let s = 0; s < 4; s++) { ctxs.beginPath(); ctxs.arc(px + 9 + s * 15, py + 17 + Math.sin(t * 2 + s + k) * 1.2, 2 + pl.stage * 2, 0, 7); ctxs.fill(); } if (pl.stage >= 3 && Math.sin(t * 4 + k) > 0.6) { ctxs.fillStyle = '#fff6a0'; ctxs.fillRect(px + 30, py + 4, 3, 3); } }
      });
    }

    // the air currents (only the jorbal sees them)
    drawAir(ctxs, g, me, tx0, ty0, tx1, ty1);

    // objects
    for (const o of g.objs) {
      if (o.x < vx0 || o.x > vx1 || o.y < vy0 || o.y > vy1) continue;
      drawObj(ctxs, o, g);
    }
    // pickups
    for (const pk of g.pickups) {
      if (pk.x < vx0 || pk.x > vx1 || pk.y < vy0 || pk.y > vy1) continue;
      drawPickup(ctxs, pk);
    }

    // actors (fog applies to enemies)
    const seeAll = me && (me.cls === 'guard' || g.ship.research.has('sensors'));
    const actors = [];
    for (const m of g.mobs) if (m.alive) actors.push(m);
    for (const c of g.crew) actors.push(c);
    actors.sort((a, b) => a.y - b.y);
    for (const a of actors) {
      if (a.x < vx0 - 60 || a.x > vx1 + 60 || a.y < vy0 - 60 || a.y > vy1 + 60) continue;
      if (a.team === 'crew' && a.cls && a.disguise != null && a.alive && g.roster[a.disguise]) {
        // 013 in their uniform: looks just like one of them (you see a faint outline round yourself)
        drawMob(ctxs, { ...a, trapped: null, marked: false, team: 'enemy', angryT: 0 }, g.roster[a.disguise], t);
        if (a === me) { ctxs.strokeStyle = 'rgba(220,220,220,.5)'; ctxs.setLineDash([3, 3]); ctxs.beginPath(); ctxs.arc(a.x, a.y, a.r + 7, 0, 7); ctxs.stroke(); ctxs.setLineDash([]); }
        continue;
      }
      if (a.team === 'crew' && a.cls) {
        const rk = recoil.get(a.id) || 0;
        if (rk > 0) { // gun kick: pushed back a couple of pixels for a moment
          const ox = Math.cos(a.facing || 0) * rk * 30, oy = Math.sin(a.facing || 0) * rk * 30;
          ctxs.save(); ctxs.translate(-ox, -oy); drawCrew(ctxs, a, t, { own: a === me }); ctxs.restore();
        } else drawCrew(ctxs, a, t, { own: a === me });
        continue;
      }
      const ri = G.room[idx(Math.floor(a.x / TILE), Math.floor(a.y / TILE))];
      const visible = ri < 0 || vis.has(ri) || a.team === 'crew';
      if (!visible && !seeAll) continue;
      if (!visible && seeAll) { ctxs.globalAlpha = 0.55; }
      drawMob(ctxs, a, g.roster[a.type], t);
      ctxs.globalAlpha = 1;
      if (a.hp < a.maxHp && !a.trapped) bar(ctxs, a.x - a.r, a.y - a.r - 7, a.r * 2, 3, a.hp / a.maxHp, a.team === 'crew' ? '#7cc46a' : a.boss ? '#ff8020' : '#e0533a');
    }

    // projectiles
    for (const q of g.projs) drawProj(ctxs, q, t);

    // particles
    updateParticles(ctxs, dt);

    // fog
    g.rooms.forEach((room, ri) => {
      const x = room.x0 * TILE + TILE, y = room.y0 * TILE + TILE;
      if (room.gone || x > vx1 || y > vy1 || x + rw(room) * TILE < vx0 || y + rh(room) * TILE < vy0) return;
      if (vis.has(ri)) return;
      const last = seen.get(ri);
      const a = room.owner === 'them' ? 0.82 : 0.6;
      const fade = last ? Math.min(1, (t - last) / 0.6) : 1;
      ctxs.fillStyle = `rgba(6,4,3,${a * fade})`;
      ctxs.fillRect(x, y, (rw(room) - 1) * TILE, (rh(room) - 1) * TILE);
    });

    for (const [id, v] of recoil) { if (v - dt <= 0) recoil.delete(id); else recoil.set(id, v - dt); }

    // lighting: dark beyond what you can see
    // (phased, you see everything from the empty dimension, walls or no walls)
    if (!cam.overview && me && !g.island && !me.phased) applyLighting(g, view.focus || me, z, W / 2 - (cam.x + sx) * z, H / 2 - (cam.y + sy) * z, dt);
    else lights.length = 0;   // (the island is in broad daylight)

    // things that need fixing glow softly (even in the dark), and the janitor sees the grime
    drawHighlights(ctxs, g, me, tx0, ty0, tx1, ty1);
    // the chameleon sees where a knife in the back would land
    if (me?.cls === 'chameleon' && me.alive) for (const m of g.mobs) {
      if (!m.alive || m.team !== 'enemy' || dist2(m, me) > 170 * 170 || !isBehind(me, m)) continue;
      drawKnife(ctxs, m.x - Math.cos(m.facing || 0) * (m.r + 6), m.y - m.r - 16 + Math.sin(t * 5) * 2, 1 + (dist2(m, me) < 50 * 50 ? 0.4 : 0));
    }
    // your stamina, under your feet
    if (me && me.alive && me.cls !== 'urchid' && (me.stam ?? 100) < 99.5) {
      const f = (me.stam ?? 100) / 100;
      ctxs.fillStyle = 'rgba(0,0,0,.55)'; ctxs.fillRect(me.x - 15, me.y + me.r + 5, 30, 4);
      ctxs.fillStyle = f < 0.34 ? '#e08040' : '#80d0ff'; ctxs.fillRect(me.x - 14, me.y + me.r + 6, 28 * f, 2);
    }

    // dog sense ripples
    if (me && me.cls === 'dog' && me.alive) {
      if (Math.random() < dt * 4) for (const m of g.mobs) if (m.alive && m.team === 'enemy' && !vis.has(G.room[idx(Math.floor(m.x / TILE), Math.floor(m.y / TILE))])) ripples.push({ x: m.x, y: m.y, life: 0.9 });
    }
    for (const r of ripples) { r.life -= dt; ctxs.strokeStyle = `rgba(240,180,80,${Math.max(0, r.life)})`; ctxs.lineWidth = 1.5; ctxs.beginPath(); ctxs.arc(r.x, r.y, (1 - r.life) * 26 + 4, 0, 7); ctxs.stroke(); }
    for (let k = ripples.length - 1; k >= 0; k--) if (ripples[k].life <= 0) ripples.splice(k, 1);

    // names, bubbles, hp
    for (const c of g.crew) {
      if (c.x < vx0 || c.x > vx1 || c.y < vy0 || c.y > vy1) continue;
      if ((c.cloaked || c.phased) && c !== me) continue;
      ctxs.textAlign = 'center'; ctxs.textBaseline = 'bottom';
      ctxs.font = `${c === me ? 'bold ' : ''}9px system-ui`;
      ctxs.fillStyle = c === me ? '#f4a340' : c.human ? '#9fd0ff' : 'rgba(255,240,220,.75)';
      ctxs.fillText(c.alive ? c.name : `${c.name} (${Math.ceil(c.downT)})`, c.x, c.y - c.r - 6);
      if (c.alive && c.hp < c.maxHp && c.cls !== 'urchid') bar(ctxs, c.x - 12, c.y - c.r - 5, 24, 3, c.hp / c.maxHp, '#7cc46a');
      if (c.repairing > 0) { ctxs.fillStyle = '#7cc46a'; ctxs.fillText('🔧', c.x + c.r + 6, c.y - 4); }
      if (c.carrying) { ctxs.fillStyle = '#c8b040'; ctxs.fillText(`dirt×${c.carrying}`, c.x, c.y + c.r + 14); }
      if (c.sayT > 0 && c.say) speech(ctxs, c.x, c.y - c.r - 18, c.say, c.sayT);
    }
    for (const m of g.mobs) if (m.alive && m.sayT > 0 && m.say) speech(ctxs, m.x, m.y - m.r - 16, m.say, m.sayT, !m.isJoe);
    // the Ship-Eater, and the scrap in its belly
    for (const m of g.mobs) if (m.alive && m.hoarder) {
      ctxs.font = 'bold 12px system-ui'; ctxs.textAlign = 'center'; ctxs.fillStyle = '#ff8060';
      ctxs.fillText(`☠ ${m.name}${m.loot ? ` · ⚙ ${m.loot} of our scrap inside` : ''}`, m.x, m.y - m.r - 18);
      bar(ctxs, m.x - 40, m.y - m.r - 12, 80, 5, m.hp / m.maxHp, '#ff5030');
    }
    // the phase clock over a vaelift's head: be out of the wall before it hits zero
    for (const c of g.crew) if (c === me && c.alive && c.phased) {
      const ctx_ = Math.floor(c.x / TILE), cty = Math.floor(c.y / TILE);
      const left = Math.max(0, c.phaseT), inWall = g.grid.get(ctx_, cty) !== T.DOOR && g.grid.solidAt(ctx_, cty, g.doors);
      ctxs.font = `bold ${left < 1.5 ? 16 : 13}px system-ui`; ctxs.textAlign = 'center';
      ctxs.fillStyle = '#000'; ctxs.fillText(left.toFixed(1), c.x + c.r + 13, c.y - c.r - 3);
      ctxs.fillStyle = inWall && left < 1.5 ? (Math.sin(t * 20) > 0 ? '#ff3030' : '#ffffff') : '#c0c0ff';
      ctxs.fillText(left.toFixed(1), c.x + c.r + 12, c.y - c.r - 4);
      if (inWall) { ctxs.font = 'bold 9px system-ui'; ctxs.fillStyle = '#ffb0b0'; ctxs.fillText('IN A WALL', c.x, c.y + c.r + 16); }
    }
    // 013: an arrow pointing the way to the mark
    if (me?.cls === 'agent' && me.alive) {
      const mark = g.mobs.find((m) => m.alive && m.marked);
      if (mark) {
        const a = Math.atan2(mark.y - me.y, mark.x - me.x), d = Math.hypot(mark.x - me.x, mark.y - me.y);
        const rr = Math.min(70, d - mark.r - 10);
        if (rr > 26) {
          ctxs.save(); ctxs.translate(me.x + Math.cos(a) * rr, me.y + Math.sin(a) * rr); ctxs.rotate(a);
          ctxs.fillStyle = `rgba(244,197,66,${0.6 + 0.3 * Math.sin(t * 6)})`; ctxs.beginPath(); ctxs.moveTo(12, 0); ctxs.lineTo(-6, -8); ctxs.lineTo(-2, 0); ctxs.lineTo(-6, 8); ctxs.closePath(); ctxs.fill();
          ctxs.restore();
          ctxs.font = '9px system-ui'; ctxs.textAlign = 'center'; ctxs.fillStyle = '#f4c542'; ctxs.fillText(`MARK ${Math.round(d / TILE)}m`, me.x + Math.cos(a) * (rr + 18), me.y + Math.sin(a) * (rr + 18));
        }
      }
    }

    // floating texts
    ctxs.textAlign = 'center'; ctxs.textBaseline = 'middle';
    for (const tx of texts) { tx.life -= dt; tx.y -= dt * 24; ctxs.globalAlpha = Math.max(0, Math.min(1, tx.life / tx.max * 2)); ctxs.font = `bold ${tx.size}px system-ui`; ctxs.fillStyle = '#000'; ctxs.fillText(tx.s, tx.x + 1, tx.y + 1); ctxs.fillStyle = tx.color; ctxs.fillText(tx.s, tx.x, tx.y); }
    ctxs.globalAlpha = 1;
    for (let k = texts.length - 1; k >= 0; k--) if (texts[k].life <= 0) texts.splice(k, 1);

    // ship-to-ship fire
    drawTracers(ctxs, g, dt);

    // aim reticle
    if (me && view.aim && me.alive) {
      ctxs.strokeStyle = 'rgba(255,240,220,.6)'; ctxs.lineWidth = 1.2;
      ctxs.beginPath(); ctxs.arc(view.aim.x, view.aim.y, 7, 0, 7); ctxs.moveTo(view.aim.x - 11, view.aim.y); ctxs.lineTo(view.aim.x - 4, view.aim.y); ctxs.moveTo(view.aim.x + 4, view.aim.y); ctxs.lineTo(view.aim.x + 11, view.aim.y); ctxs.stroke();
    }

    // screen-space
    ctxs.setTransform(1, 0, 0, 1, 0, 0);
    if (flash > 0) { ctxs.fillStyle = `rgba(${flashColor},${flash * 0.35})`; ctxs.fillRect(0, 0, W, H); flash -= dt * 1.6; }
    if (me && me.alive && me.hp < me.maxHp * 0.3 && me.cls !== 'urchid') {
      const gr = ctxs.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
      gr.addColorStop(0, 'rgba(160,0,0,0)'); gr.addColorStop(1, `rgba(160,0,0,${0.35 + Math.sin(t * 6) * 0.1})`);
      ctxs.fillStyle = gr; ctxs.fillRect(0, 0, W, H);
    }
    if (me && !me.alive) { ctxs.fillStyle = 'rgba(0,0,0,.35)'; ctxs.fillRect(0, 0, W, H); }
  }

  // ---------------------------------------------------------------------
  // Line-of-sight lighting. Rays from your eyes stop at walls and closed doors; inside that shape
  // it's lit (brightest near you), outside it's dark. Muzzle flashes, explosions, fires and
  // consoles light up whatever you can see around them. Crewmates carry a dim lamp.
  const lgrad = (c, x, y, r, a, inner = 0, col = '0,0,0') => {
    const gr = c.createRadialGradient(x, y, r * inner, x, y, r);
    gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
    c.fillStyle = gr; c.fillRect(x - r, y - r, r * 2, r * 2);
  };
  function sightPolygon(g, eye, R) {
    const G = g.grid, N = 360, poly = [];
    for (let k = 0; k < N; k++) {
      const a = k / N * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let d = 4;
      for (; d < R; d += 4) {
        if (G.blocksShot(Math.floor((eye.x + ca * d) / TILE), Math.floor((eye.y + sa * d) / TILE), g.doors)) { d += 14; break; } // light the wall's face too
      }
      poly.push(eye.x + ca * d, eye.y + sa * d);
    }
    return poly;
  }
  const tracePoly = (c, poly) => { c.beginPath(); c.moveTo(poly[0], poly[1]); for (let k = 2; k < poly.length; k += 2) c.lineTo(poly[k], poly[k + 1]); c.closePath(); };
  function applyLighting(g, eye, z, ox, oy, dt) {
    for (const l of lights) l.life -= dt;
    for (let k = lights.length - 1; k >= 0; k--) if (lights[k].life <= 0) lights.splice(k, 1);
    if (lights.length > 160) lights.splice(0, lights.length - 160);
    const R = 15 * TILE;
    const poly = sightPolygon(g, eye, R);
    const fires = g.objs.filter((o) => o.kind === 'fire');
    const flick = (o) => 0.75 + 0.25 * Math.sin(t * 13 + o.id * 1.7) * Math.sin(t * 7.3 + o.id);
    const L = lctx;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.globalCompositeOperation = 'source-over';
    L.clearRect(0, 0, W, H);
    L.fillStyle = 'rgba(3,2,1,0.8)'; L.fillRect(0, 0, W, H);
    L.setTransform(z, 0, 0, z, ox, oy);
    L.globalCompositeOperation = 'destination-out';
    for (const c of g.crew) if (c.alive && c !== eye) lgrad(L, c.x, c.y, 140, 0.4);
    L.save(); tracePoly(L, poly); L.clip();
    lgrad(L, eye.x, eye.y, R, 1, 0.45);
    for (const r of g.rooms) if (!r.gone && r.sys && r.sys.hp > 0 && Math.abs(r.station.x - eye.x) < R && Math.abs(r.station.y - eye.y) < R) lgrad(L, r.station.x, r.station.y + 6, 90, 0.35);
    for (const o of fires) lgrad(L, o.x, o.y, 110 * Math.max(0.3, o.f), 0.7 * flick(o));
    for (const l of lights) lgrad(L, l.x, l.y, l.r, l.a * Math.max(0, l.life / l.max));
    for (const q of g.projs) if (q.kind === 'rocket' || q.kind === 'fireball') lgrad(L, q.x, q.y, 90, 0.6);
    L.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(lightCv, 0, 0);
    // coloured glow on top (only where you can see)
    ctx.setTransform(z, 0, 0, z, ox, oy);
    ctx.save(); tracePoly(ctx, poly); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (const o of fires) lgrad(ctx, o.x, o.y, 90 * Math.max(0.3, o.f), 0.22 * flick(o), 0, '255,110,30');
    for (const l of lights) lgrad(ctx, l.x, l.y, l.r * 0.8, 0.3 * l.a * Math.max(0, l.life / l.max), 0, l.col);
    for (const q of g.projs) if (q.kind === 'rocket' || q.kind === 'fireball') lgrad(ctx, q.x, q.y, 60, 0.25, 0, '255,140,60');
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  // air currents: their own layer, and only the jorbal can see it. Every open tile gets a little arrow
  // (drifting the way the air pushes), and the spots it all flows to swirl.
  const AIR_V = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function drawAir(c, g, me, tx0, ty0, tx1, ty1) {
    const dir = g.air?.dir;
    if (!dir || me?.cls !== 'jorbal') return;
    c.save();
    c.lineCap = 'round'; c.lineWidth = 1.6;
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const ch = dir.charCodeAt(y * MAP_W + x);
      if (ch === 115) { // a sink: everything ends up here
        const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
        c.strokeStyle = 'rgba(160,235,255,.55)';
        for (let k = 0; k < 3; k++) { const a0 = t * 3 + k * 2.1; c.beginPath(); c.arc(cx, cy, 6 + k * 4, a0, a0 + 1.6); c.stroke(); }
        continue;
      }
      const k = ch - 97;
      if (k < 0 || k > 7) continue;
      const [dx, dy] = AIR_V[k], L = Math.hypot(dx, dy);
      const ux = dx / L, uy = dy / L;
      // the arrow slides along with the wind and fades in and out
      const ph = (t * 0.9 + (x * 0.37 + y * 0.61)) % 1;
      const cx = (x + 0.5) * TILE + ux * (ph - 0.5) * 14, cy = (y + 0.5) * TILE + uy * (ph - 0.5) * 14;
      c.strokeStyle = `rgba(200,245,255,${0.42 * Math.sin(ph * Math.PI)})`;
      const P = (lx, ly) => [cx + ux * lx - uy * ly, cy + uy * lx + ux * ly];
      c.beginPath(); c.moveTo(...P(-6, 0)); c.lineTo(...P(5, 0)); c.moveTo(...P(1, -3.5)); c.lineTo(...P(5, 0)); c.lineTo(...P(1, 3.5)); c.stroke();
    }
    c.restore();
  }

  // the sea around the island at the center of the world: deep blue, glittering, rolling
  function drawSea(c, x0, y0, x1, y1) {
    const gr = c.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, '#1a6aa0'); gr.addColorStop(1, '#0e4a7a');
    c.fillStyle = gr; c.fillRect(x0, y0, x1 - x0, y1 - y0);
    c.strokeStyle = 'rgba(255,255,255,.18)'; c.lineWidth = 2;
    const step = 46;
    for (let y = Math.floor(y0 / step) * step; y < y1; y += step) for (let x = Math.floor(x0 / step) * step; x < x1; x += step) {
      const ph = Math.sin(t * 1.4 + x * 0.05 + y * 0.03);
      c.beginPath(); c.moveTo(x + ph * 6, y + 10); c.quadraticCurveTo(x + 10 + ph * 6, y + 4, x + 20 + ph * 6, y + 10); c.stroke();
      if ((x * 7 + y * 3) % 5 === 0 && Math.sin(t * 3 + x + y) > 0.85) { c.fillStyle = 'rgba(255,255,230,.8)'; c.fillRect(x + 30, y + 26, 2, 2); }
    }
  }

  // repairs needed: a soft pulsing glow on damaged walls, doors, breaches, wreckage and consoles.
  // the janitor also sees every bit of dirt and grime faintly outlined.
  function drawHighlights(c, g, me, tx0, ty0, tx1, ty1) {
    const G = g.grid, pulse = 0.55 + 0.45 * Math.sin(t * 3);
    c.save();
    for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
      const i = idx(x, y), tt = G.tiles[i];
      let need = 0;
      if (tt === T.BREACH || tt === T.DEBRIS || (tt === T.RUBBLE && g.orig?.has?.(i))) need = 1;
      else if ((tt === T.WALL || tt === T.HULL) && G.hp[i] < TILE_HP[tt] * 0.98) need = 0.6 * (1 - G.hp[i] / TILE_HP[tt]) + 0.25;
      else if (tt === T.DOOR) { const d = g.doors[G.doorAt[i]]; if (d && d.hp < d.maxHp * 0.98) need = 0.4 + 0.5 * (1 - d.hp / d.maxHp); }
      if (!need) continue;
      const own = G.room[i] >= 0 ? g.rooms[G.room[i]]?.owner === 'us' : (g.box && x >= g.box.x0 && x <= g.box.x1 && y >= g.box.y0 && y <= g.box.y1);
      if (!own) continue;
      c.fillStyle = `rgba(255,200,90,${0.13 * need * pulse})`; c.fillRect(x * TILE, y * TILE, TILE, TILE);
      c.strokeStyle = `rgba(255,210,110,${0.22 * need * pulse})`; c.lineWidth = 1; c.strokeRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
    }
    for (const r of g.rooms) if (r.owner === 'us' && r.sys && r.sys.hp < r.sys.max * 0.97) {
      const f = 1 - r.sys.hp / r.sys.max;
      c.strokeStyle = `rgba(255,200,90,${(0.2 + 0.35 * f) * pulse})`; c.lineWidth = 2;
      c.beginPath(); c.arc(r.station.x, r.station.y, 30 + Math.sin(t * 3) * 2, 0, 7); c.stroke();
    }
    if (me?.cls === 'mrclean') for (const o of g.objs) {
      if (o.kind !== 'mess') continue;
      c.strokeStyle = `rgba(140,255,170,${0.18 + 0.1 * pulse})`; c.lineWidth = 1.5; c.setLineDash([3, 4]);
      c.beginPath(); c.arc(o.x, o.y, 12 + o.amt * 1.5, 0, 7); c.stroke(); c.setLineDash([]);
    }
    c.restore();
  }

  function drawKnife(c, x, y, s = 1) {
    c.save(); c.translate(x, y); c.rotate(-0.6 + Math.sin(t * 6) * 0.1); c.scale(s, s);
    c.shadowColor = 'rgba(255,255,255,.8)'; c.shadowBlur = 8;
    const gr = c.createLinearGradient(0, -14, 4, 4); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#c8d0dc'); gr.addColorStop(1, '#8890a0');
    c.fillStyle = gr; c.beginPath(); c.moveTo(0, -16); c.lineTo(4, 2); c.lineTo(-4, 2); c.closePath(); c.fill();
    c.shadowBlur = 0; c.fillStyle = '#5a3a1a'; c.fillRect(-2.5, 2, 5, 8); c.fillStyle = '#c0a040'; c.fillRect(-6, 1, 12, 2.5);
    c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(-0.8, -12, 1.4, 9);
    c.restore();
  }

  // ---------------------------------------------------------------------
  // drills
  function drawDrill(c, x, y, ang, len, w, spin, enemy = false) {
    c.save(); c.translate(x, y); c.rotate(ang);
    // mount collar with bolts
    c.fillStyle = enemy ? '#4a302a' : '#4a4540'; c.fillRect(-14, -w * 0.62, 26, w * 1.24);
    c.fillStyle = enemy ? '#70443a' : '#77706a'; c.fillRect(-14, -w * 0.62, 26, 5);
    c.fillStyle = '#221e1a'; for (let k = 0; k < 4; k++) { c.beginPath(); c.arc(-1, -w * 0.45 + k * w * 0.3, 3.2, 0, 7); c.fill(); }
    // the cone, shaded like turned metal
    const gr = c.createLinearGradient(0, -w / 2, 0, w / 2);
    if (enemy) { gr.addColorStop(0, '#3a1c16'); gr.addColorStop(0.35, '#a0503a'); gr.addColorStop(0.5, '#d08060'); gr.addColorStop(0.7, '#80402c'); gr.addColorStop(1, '#2a1410'); }
    else { gr.addColorStop(0, '#2a2a30'); gr.addColorStop(0.35, '#8a8c96'); gr.addColorStop(0.5, '#e4e6ee'); gr.addColorStop(0.7, '#70727c'); gr.addColorStop(1, '#202028'); }
    c.fillStyle = gr;
    c.beginPath(); c.moveTo(12, -w / 2); c.lineTo(12 + len, 0); c.lineTo(12, w / 2); c.closePath(); c.fill();
    // spiral flutes that run toward the tip as it turns
    c.save(); c.clip();
    const step = 24, off = ((spin * 26) % step + step) % step;
    c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,.38)';
    for (let s = -w; s < len + w; s += step) { const u = 12 + s + off; c.beginPath(); c.moveTo(u, -w / 2); c.lineTo(u - w * 0.55, w / 2); c.stroke(); }
    c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,.22)';
    for (let s = -w; s < len + w; s += step) { const u = 12 + s + off + 7; c.beginPath(); c.moveTo(u, -w / 2); c.lineTo(u - w * 0.55, w / 2); c.stroke(); }
    c.restore();
    c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 2; c.beginPath(); c.moveTo(12, -w / 2); c.lineTo(12 + len, 0); c.lineTo(12, w / 2); c.stroke();
    c.fillStyle = enemy ? '#ffd0b0' : '#ffffff'; c.beginPath(); c.arc(12 + len - 3, 0, 3, 0, 7); c.fill();
    c.restore();
  }
  function drawShipDrill(c, g, moving) {
    const B = g.box, G = g.grid;
    const cx = (B.x0 + B.x1 + 1) / 2 * TILE, cy = (B.y0 + B.y1 + 1) / 2 * TILE;
    const dx = Math.cos(heading), dy = Math.sin(heading);
    // walk out from the middle until we leave the hull: that's the front
    let bx = cx, by = cy;
    for (let d = 0; d < 4000; d += 8) {
      const x = cx + dx * d, y = cy + dy * d, tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (tx < B.x0 || tx > B.x1 || ty < B.y0 || ty > B.y1) break;
      if (G.get(tx, ty) !== T.VOID) { bx = x; by = y; }
    }
    const w = 6 * TILE, len = 7 * TILE;
    drawDrill(c, bx - dx * 10, by - dy * 10, heading, len, w, drillSpin);
    if (moving && Math.random() < 0.8) { // chewed-up dirt sprays off the cutting edge
      const tip = { x: bx + dx * (len * 0.7), y: by + dy * (len * 0.7) };
      for (let k = 0; k < 2; k++) { const s = Math.random() < 0.5 ? 1 : -1; const a = heading + s * (Math.PI / 2 + 0.6) + (Math.random() - .5) * 0.5, sp = 120 + Math.random() * 160; parts.push(p(tip.x + (Math.random() - .5) * 60, tip.y + (Math.random() - .5) * 60, Math.cos(a) * sp, Math.sin(a) * sp, 0.6, Math.random() < 0.5 ? '#5a4030' : '#7a5a40', 3 + Math.random() * 3, true)); }
    }
  }

  function visibleRooms(g, me) {
    const vis = new Set();
    for (const c of g.crew) if (c.alive) { const ri = g.grid.room[idx(Math.floor(c.x / TILE), Math.floor(c.y / TILE))]; if (ri >= 0) vis.add(ri); }
    for (const m of g.mobs) if (m.alive && m.team === 'crew') { const ri = g.grid.room[idx(Math.floor(m.x / TILE), Math.floor(m.y / TILE))]; if (ri >= 0) vis.add(ri); }
    if (me?.cls === 'urchid' && me.ghost) { /* ghost mode sees what they see: already covered */ }
    return vis;
  }

  function drawDoor(c, g, di, px, py) {
    const d = g.doors[di];
    c.fillStyle = '#3a3632'; c.fillRect(px, py, TILE, TILE);
    if (!d) return;
    const open = d.open;
    const col = d.sealed ? '#b03a2a' : d.reinforced > 0 ? '#5a6ad0' : d.hold === 'closed' ? '#a08030' : d.hold === 'open' && !d.blast ? '#5a8a5a' : d.blast ? '#6a6458' : '#7a8088';
    c.fillStyle = col;
    if (d.armored) { // a vault door: thick steel, rivets, a wheel. C4 only.
      c.fillStyle = '#4a4e56'; c.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
      c.fillStyle = '#7a808a'; for (const [x, y] of [[5, 5], [TILE - 7, 5], [5, TILE - 7], [TILE - 7, TILE - 7]]) c.fillRect(px + x, py + y, 3, 3);
      c.strokeStyle = '#c0c4cc'; c.lineWidth = 2; c.beginPath(); c.arc(px + TILE / 2, py + TILE / 2, 7, 0, 7); c.stroke();
      for (let k = 0; k < 3; k++) { const a = k * 2.1; c.beginPath(); c.moveTo(px + TILE / 2, py + TILE / 2); c.lineTo(px + TILE / 2 + Math.cos(a) * 7, py + TILE / 2 + Math.sin(a) * 7); c.stroke(); }
      return;
    }
    if (d.blast) {
      // heavy blast door: slides into the wall, hazard stripes on the leading edge
      const len = (1 - open) * TILE;
      if (d.orient === 'v') { c.fillRect(px + 6, py, 20, len); if (len > 3) { c.fillStyle = '#e0b020'; for (let k = 0; k < 3; k++) c.fillRect(px + 6 + k * 7, py + Math.max(0, len - 5), 4, 5); } }
      else { c.fillRect(px, py + 6, len, 20); if (len > 3) { c.fillStyle = '#e0b020'; for (let k = 0; k < 3; k++) c.fillRect(px + Math.max(0, len - 5), py + 6 + k * 7, 5, 4); } }
      c.strokeStyle = '#2a2622'; c.lineWidth = 2; c.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
    } else {
      const gap = open * (TILE / 2 - 2);
      if (d.orient === 'v') { c.fillRect(px + 8, py, 16, TILE / 2 - gap); c.fillRect(px + 8, py + TILE / 2 + gap, 16, TILE / 2 - gap); }
      else { c.fillRect(px, py + 8, TILE / 2 - gap, 16); c.fillRect(px + TILE / 2 + gap, py + 8, TILE / 2 - gap, 16); }
    }
    if (d.sealed) { c.fillStyle = '#ffd040'; c.font = 'bold 10px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('⛔', px + TILE / 2, py + TILE / 2); }
    if (d.hp < d.maxHp) { dmgCracks(c, px, py, d.hp / d.maxHp); bar(c, px + 2, py - 5, TILE - 4, 3, d.hp / d.maxHp, '#e0533a'); }
  }

  function dmgCracks(c, px, py, f) {
    if (f >= 0.95) return;
    c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1.2;
    const n = Math.ceil((1 - f) * 5);
    c.beginPath();
    for (let k = 0; k < n; k++) { const sx = px + ((k * 11 + px) % 28) + 2, sy = py + ((k * 7 + py) % 28) + 2; c.moveTo(sx, sy); c.lineTo(sx + 6, sy + 4); c.lineTo(sx + 4, sy + 9); }
    c.stroke();
  }

  function drawObj(c, o, g) {
    switch (o.kind) {
      case 'mess': { c.fillStyle = o.sub === 'gore' ? 'rgba(110,20,20,.55)' : o.sub === 'ash' ? 'rgba(40,36,34,.7)' : 'rgba(110,80,45,.75)'; for (let k = 0; k < o.amt; k++) { c.beginPath(); c.arc(o.x + Math.sin(k * 2.3 + o.id) * 9, o.y + Math.cos(k * 1.7 + o.id) * 7, 6 + (k % 3), 0, 7); c.fill(); } break; }
      case 'vent': c.fillStyle = o.broken ? '#3a2020' : '#2a3a32'; c.fillRect(o.x - 9, o.y - 7, 18, 14); c.strokeStyle = '#5a7a6a'; c.lineWidth = 1; for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(o.x + k * 3.5, o.y - 6); c.lineTo(o.x + k * 3.5, o.y + 6); c.stroke(); } break;
      case 'turret': { // a proper sentry gun: tripod legs, armoured head, twin barrels, ammo box
        c.save(); c.translate(o.x, o.y);
        c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(2, 4, 15, 10, 0, 0, 7); c.fill();
        c.strokeStyle = '#3a342c'; c.lineWidth = 3.5; c.lineCap = 'round';
        for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + 0.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * 14, Math.sin(a) * 14); c.stroke(); c.fillStyle = '#2a2620'; c.beginPath(); c.arc(Math.cos(a) * 14, Math.sin(a) * 14, 2.5, 0, 7); c.fill(); }
        c.rotate(o.a || 0);
        const kick = o.atkT > 0.3 ? 0 : -2;   // the barrels jump back as it fires
        c.fillStyle = '#2a2a2e'; c.fillRect(4 + kick, -5, 15, 3.2); c.fillRect(4 + kick, 1.8, 15, 3.2);
        c.fillStyle = '#ffd070'; if (o.atkT > 0.35) { c.beginPath(); c.arc(20 + kick, 0, 3, 0, 7); c.fill(); }
        c.fillStyle = '#8a6a30'; roundRect(c, -9, -8, 15, 16, 3); c.fill();
        c.fillStyle = '#f0a030'; c.fillRect(-9, -8, 15, 3);
        c.fillStyle = '#5a6a3a'; c.fillRect(-8, 6, 7, 5);   // ammo box
        c.fillStyle = '#ff3020'; c.beginPath(); c.arc(-3, 0, 2, 0, 7); c.fill();   // the eye
        c.restore();
        if (o.hp < o.maxHp) bar(c, o.x - 12, o.y - 18, 24, 3, o.hp / o.maxHp, '#f0a030');
        break;
      }
      case 'scarecrow': { // a straw man on a pole, crows circling over its head
        c.save(); c.translate(o.x, o.y);
        c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(2, 10, 12, 5, 0, 0, 7); c.fill();
        c.strokeStyle = '#6a4a28'; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 12); c.lineTo(0, -16); c.moveTo(-14, -6); c.lineTo(14, -6); c.stroke();
        c.fillStyle = '#4a6aa0'; c.fillRect(-7, -9, 14, 14);                         // shirt
        c.fillStyle = '#e0c060'; for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 14, -8); c.lineTo(s * 19, -4); c.lineTo(s * 14, -3); c.fill(); }   // straw hands
        c.fillStyle = '#e8d8a0'; c.beginPath(); c.arc(0, -15, 6, 0, 7); c.fill();  // sack head
        c.fillStyle = '#c8a040'; c.beginPath(); c.ellipse(0, -19, 10, 3, 0, 0, 7); c.fill(); c.fillRect(-4, -25, 8, 6); // hat
        c.fillStyle = '#222'; c.fillRect(-3, -16, 2, 2); c.fillRect(1, -16, 2, 2);
        for (let k = 0; k < 2 + Math.floor((o.lvl || 0) / 3); k++) { const a = t * 2.2 + k * 2.1; drawCrowShape(c, Math.cos(a) * 16, -30 + Math.sin(a) * 5, a + Math.PI / 2, 0.7); }
        c.restore();
        break;
      }
      case 'trap': c.strokeStyle = o.armT > 0 ? '#666' : '#60d0ff'; c.lineWidth = 2; c.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * 7; c.lineTo(o.x + Math.cos(a) * 9, o.y + Math.sin(a) * 9); } c.closePath(); c.stroke(); if (o.armT <= 0 && Math.sin(t * 10 + o.id) > .6) { c.fillStyle = '#80e0ff'; c.fillRect(o.x - 1, o.y - 1, 3, 3); } break;
      case 'mine': {
        if (o.sub === 'c4') { // a brick of C4 with a burning fuse and a countdown
          c.fillStyle = '#d8c898'; c.fillRect(o.x - 9, o.y - 6, 18, 12); c.strokeStyle = '#6a5a3a'; c.lineWidth = 1; c.strokeRect(o.x - 9, o.y - 6, 18, 12);
          c.fillStyle = '#202020'; c.fillRect(o.x - 9, o.y - 1, 18, 2);
          const fl = Math.max(0, o.t / 4) * 12;
          c.strokeStyle = '#3a3020'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(o.x + 9, o.y - 4); c.quadraticCurveTo(o.x + 12 + fl * 0.4, o.y - 10, o.x + 9 + fl, o.y - 12); c.stroke();
          c.fillStyle = Math.sin(t * 40) > 0 ? '#ffe060' : '#ff6020'; c.beginPath(); c.arc(o.x + 9 + fl, o.y - 12, 2.5 + Math.random() * 1.5, 0, 7); c.fill();
          c.fillStyle = '#fff'; c.font = 'bold 10px system-ui'; c.textAlign = 'center'; c.fillText(Math.ceil(Math.max(0, o.t)), o.x, o.y - 16);
          break;
        }
        c.fillStyle = o.sub === 'remote' ? '#3a4a3a' : o.sub === 'timed' ? '#4a3a2a' : '#333'; c.beginPath(); c.arc(o.x, o.y, 6.5, 0, 7); c.fill();
        c.strokeStyle = '#111'; c.lineWidth = 1; c.stroke();
        c.fillStyle = Math.sin(t * (o.sub === 'timed' ? 20 : o.sub === 'remote' ? 3 : 8)) > 0 ? (o.sub === 'remote' ? '#40ff60' : '#ff3030') : '#401010'; c.beginPath(); c.arc(o.x, o.y, 2, 0, 7); c.fill();
        if (o.sub === 'timed') { c.fillStyle = '#ffb0a0'; c.font = '9px system-ui'; c.textAlign = 'center'; c.fillText(Math.ceil(Math.max(0, o.t)), o.x, o.y - 10); }
        break;
      }
      case 'tank': { // 013's tiny remote tank: treads, turret, a little antenna
        c.save(); c.translate(o.x, o.y);
        c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(-12, -8, 26, 20);
        c.fillStyle = '#3a4030'; c.fillRect(-13, -11, 26, 6); c.fillRect(-13, 5, 26, 6);
        c.fillStyle = '#5a6a40'; c.fillRect(-11, -6, 22, 12);
        c.rotate(o.a || 0); c.fillStyle = '#4a5a34'; c.beginPath(); c.arc(0, 0, 6, 0, 7); c.fill(); c.fillStyle = '#2a2a24'; c.fillRect(4, -1.5, 13, 3);
        c.restore();
        c.strokeStyle = '#999'; c.lineWidth = 1; c.beginPath(); c.moveTo(o.x - 6, o.y - 6); c.lineTo(o.x - 10, o.y - 18); c.stroke();
        c.fillStyle = Math.sin(t * 8) > 0 ? '#ff4040' : '#601010'; c.beginPath(); c.arc(o.x - 10, o.y - 18, 2, 0, 7); c.fill();
        bar(c, o.x - 12, o.y - 24, 24, 3, o.hp / (120 + 20 * 6), '#90c060');
        break;
      }
      case 'wallbones': { // what's left of a vaelift who came back inside a wall: the bits that stuck out
        c.save(); c.translate(o.x, o.y); c.rotate(o.a || 0);
        c.fillStyle = '#e8e0cc'; c.strokeStyle = '#8a8070'; c.lineWidth = 1;
        const parts = o.parts || [];
        if (parts.includes('head')) { c.beginPath(); c.arc(11, 0, 6, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#222'; c.fillRect(12, -3, 2, 2); c.fillRect(12, 1, 2, 2); c.fillStyle = '#e8e0cc'; }
        if (parts.includes('hands')) for (const s of [-1, 1]) { c.fillRect(-2, s * 10 - 1.5, 9, 3); c.beginPath(); c.arc(8, s * 10, 3, 0, 7); c.fill(); }
        if (parts.includes('feet')) for (const s of [-1, 1]) { c.fillRect(-14, s * 4 - 1.5, 8, 3); c.fillRect(-16, s * 4 - 2, 3, 5); }
        if (parts.includes('body') || !parts.length) { c.fillRect(-6, -1.5, 14, 3); for (let k = 0; k < 3; k++) c.fillRect(-4 + k * 4, -6, 1.5, 12); }
        c.restore();
        // and the vest's tails, flapping out of the wall
        if (parts.includes('feet') || parts.includes('body')) { c.strokeStyle = '#141018'; c.lineWidth = 3; c.beginPath(); c.moveTo(o.x - 10 * Math.cos(o.a), o.y - 10 * Math.sin(o.a)); c.lineTo(o.x - 22 * Math.cos(o.a) + Math.sin(t * 3) * 3, o.y - 22 * Math.sin(o.a)); c.stroke(); }
        break;
      }
      case 'palm': { // a palm tree: trunk, coconuts, fronds swaying
        c.save(); c.translate(o.x, o.y); c.scale(o.s || 1, o.s || 1);
        c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(10, 6, 24, 9, 0.3, 0, 7); c.fill();
        c.fillStyle = '#8a6a40'; for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(-k * 2, -k * 6, 4, 3.5, 0, 0, 7); c.fill(); }
        c.fillStyle = '#5a3a1a'; for (const [x, y] of [[-3, -24], [2, -23], [-1, -27]]) { c.beginPath(); c.arc(x, y, 2.5, 0, 7); c.fill(); }
        c.fillStyle = '#3a9a40';
        for (let k = 0; k < 6; k++) { const a = (o.a || 0) + k * 1.05 + Math.sin(t * 1.3 + k) * 0.06; c.save(); c.translate(-2, -25); c.rotate(a); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(12, -6, 24, 2); c.quadraticCurveTo(12, 2, 0, 0); c.fill(); c.restore(); }
        c.restore();
        break;
      }
      case 'hut': { // a beach hut with a straw roof (the island makes everything for you)
        c.save(); c.translate(o.x, o.y);
        c.fillStyle = '#a07a4a'; c.fillRect(-18, -10, 36, 22);
        c.fillStyle = '#d8b860'; c.beginPath(); c.moveTo(-24, -8); c.lineTo(0, -26); c.lineTo(24, -8); c.closePath(); c.fill();
        c.fillStyle = '#5a3a1a'; c.fillRect(-5, 0, 10, 12);
        c.restore();
        break;
      }
      case 'tnt': c.fillStyle = '#c02020'; for (let k = -1; k <= 1; k++) c.fillRect(o.x + k * 5 - 2, o.y - 8, 4, 16); c.fillStyle = '#fff'; c.font = 'bold 10px system-ui'; c.textAlign = 'center'; c.fillText(Math.ceil(o.t), o.x, o.y - 14); break;
      case 'cloud': { const col = o.sub === 'poison' ? '160,80,230' : o.sub === 'acid' ? '190,240,60' : o.sub === 'buff' ? '255,210,80' : '180,180,180'; for (let k = 0; k < 5; k++) { c.fillStyle = `rgba(${col},${0.12 * Math.min(1, o.t)})`; c.beginPath(); c.arc(o.x + Math.sin(t + k * 1.3) * 20, o.y + Math.cos(t * 0.8 + k) * 16, o.r * 0.6, 0, 7); c.fill(); } break; }
      case 'crate':
        if (o.island || o.heavy) { // a treasure chest (island) or a heavy strongbox (their vault)
          c.fillStyle = o.island ? '#8a5a2a' : '#5a5a60'; c.fillRect(o.x - 12, o.y - 8, 24, 16);
          c.fillStyle = o.island ? '#a06a30' : '#6a6a72'; c.fillRect(o.x - 12, o.y - 10, 24, 6);
          c.fillStyle = '#e0b030'; c.fillRect(o.x - 12, o.y - 4, 24, 2); c.fillRect(o.x - 2, o.y - 6, 4, 6);
          if (Math.sin(t * 3 + o.x) > 0.6) { c.fillStyle = '#fff6a0'; c.fillRect(o.x + 6, o.y - 12, 2, 2); }
        } else { c.fillStyle = '#9a7a3a'; c.fillRect(o.x - 10, o.y - 8, 20, 16); c.strokeStyle = '#5a4020'; c.lineWidth = 1.5; c.strokeRect(o.x - 10, o.y - 8, 20, 16); c.beginPath(); c.moveTo(o.x - 10, o.y - 8); c.lineTo(o.x + 10, o.y + 8); c.stroke(); }
        if (Math.sin(t * 4) > 0) { c.fillStyle = '#f4c542'; c.font = '9px system-ui'; c.textAlign = 'center'; c.fillText('E', o.x, o.y - 14); }
        break;
      case 'skeleton': c.save(); c.translate(o.x, o.y); c.rotate(o.a); c.fillStyle = '#ddd5c0'; c.beginPath(); c.arc(0, -8, 6, 0, 7); c.fill(); c.fillRect(-1.5, -2, 3, 14); for (let k = 0; k < 3; k++) c.fillRect(-6, 1 + k * 4, 12, 1.5); c.fillStyle = '#222'; c.fillRect(-3, -10, 2, 2); c.fillRect(1, -10, 2, 2); c.restore(); break;
      case 'journal': c.fillStyle = '#7a3a2a'; c.fillRect(o.x - 7, o.y - 9, 14, 18); c.fillStyle = '#f0e0c0'; c.fillRect(o.x - 5, o.y - 7, 10, 2); if (!o.read && Math.sin(t * 4) > 0) { c.strokeStyle = '#f4c542'; c.lineWidth = 2; c.beginPath(); c.arc(o.x, o.y, 16, 0, 7); c.stroke(); } break;
    }
  }

  function drawPickup(c, pk) {
    const bob = Math.sin(t * 4 + pk.id) * 1.5;
    const y = pk.y - pk.z + bob;
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(pk.x, pk.y + 4, 6, 3, 0, 0, 7); c.fill();
    switch (pk.kind) {
      case 'gem': drawGem(c, pk.x, y, GEMS[pk.sub] || GEMS.quartz, pk.id); break;
      case 'ore': c.fillStyle = '#8a8a90'; c.beginPath(); c.arc(pk.x, y, 6, 0, 7); c.fill(); c.fillStyle = '#c0a060'; c.fillRect(pk.x - 2, y - 2, 3, 3); break;
      case 'food': c.fillStyle = { grub: '#e0c080', shroom: '#c06080', fish: '#80b0e0', spice: '#e04020' }[pk.sub] || '#f07070'; c.beginPath(); c.arc(pk.x, y, 5, 0, 7); c.fill(); break;
      case 'coin': c.fillStyle = '#f4c542'; c.beginPath(); c.arc(pk.x, y, 4.5, 0, 7); c.fill(); c.strokeStyle = '#a07a10'; c.lineWidth = 1; c.stroke(); break;
      case 'crop': c.fillStyle = '#e0c040'; c.beginPath(); c.arc(pk.x, y, 5, 0, 7); c.fill(); break;
      case 'gun': c.strokeStyle = '#90a050'; c.lineWidth = 4; c.beginPath(); c.moveTo(pk.x - 8, y); c.lineTo(pk.x + 8, y); c.stroke(); break;
      case 'candy': { // a wrapped sweet, twisted at both ends (the rainbow one cycles through every colour)
        const col = pk.sub === 'rainbow' ? `hsl(${(t * 240 + pk.id * 40) % 360},90%,60%)` : (CANDY_COL[pk.sub] || '#fff');
        c.save(); c.translate(pk.x, y); c.rotate(Math.sin(t * 2 + pk.id) * 0.3);
        c.fillStyle = col;
        for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 5, 0); c.lineTo(s * 11, -5); c.lineTo(s * 11, 5); c.closePath(); c.fill(); }
        c.beginPath(); c.ellipse(0, 0, 6.5, 5, 0, 0, 7); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 1; c.stroke();
        c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(-3, -3, 3, 2);
        c.restore();
        if (Math.sin(t * 5 + pk.id) > 0.7) { c.fillStyle = '#ffffff'; c.fillRect(pk.x + 7, y - 9, 2, 2); }
        break;
      }
    }
  }
  const CANDY_COL = { green: '#50e060', red: '#ff4040', blue: '#4080ff', white: '#f4f4ff', yellow: '#f4d030' };

  function drawProj(c, q, t) {
    switch (q.kind) {
      case 'ppk': if (q.laser) { // 013's laser: a long red beam
        c.strokeStyle = 'rgba(255,40,40,.35)'; c.lineWidth = 7; c.lineCap = 'round'; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - q.vx * 0.06, q.y - q.vy * 0.06); c.stroke();
        c.strokeStyle = '#ffd0d0'; c.lineWidth = 2; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - q.vx * 0.06, q.y - q.vy * 0.06); c.stroke(); c.lineCap = 'butt';
        break;
      } // falls through
      case 'bullet': case 'knife': {
        // glowing tracer: a soft wide streak with a hot core
        const crew = q.team === 'crew', tail = q.kind === 'knife' ? 0.02 : 0.035;
        if (q.kind !== 'knife') {
          c.strokeStyle = crew ? 'rgba(255,220,120,.28)' : 'rgba(255,90,60,.3)'; c.lineWidth = 6; c.lineCap = 'round';
          c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - q.vx * tail, q.y - q.vy * tail); c.stroke();
        }
        c.strokeStyle = crew ? (q.kind === 'knife' ? '#ddd' : '#fffbe0') : '#ffb090'; c.lineWidth = q.kind === 'ppk' ? 2.5 : 2;
        c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - q.vx * tail * 0.6, q.y - q.vy * tail * 0.6); c.stroke(); c.lineCap = 'butt';
        break;
      }
      case 'coin': c.fillStyle = '#f4c542'; c.beginPath(); c.ellipse(q.x, q.y, 4, 4 * Math.abs(Math.cos(t * 20 + q.id)) + 1, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,230,120,.35)'; c.lineWidth = 3; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - q.vx * 0.025, q.y - q.vy * 0.025); c.stroke(); break;
      case 'crow': drawCrowShape(c, q.x, q.y, q.a ?? Math.atan2(q.vy, q.vx), 1); break;
      case 'scrap': c.save(); c.translate(q.x, q.y); c.rotate(t * 20 + q.id); c.fillStyle = '#b0a890'; c.fillRect(-4, -3, 8, 6); c.fillStyle = '#e0c060'; c.fillRect(-2, -1, 4, 2); c.restore(); break;
      case 'rocket': c.fillStyle = '#ddd'; c.beginPath(); c.arc(q.x, q.y, 4, 0, 7); c.fill(); parts.push(p(q.x, q.y, (Math.random() - .5) * 30, (Math.random() - .5) * 30, 0.3, '#aaa', 3)); break;
      case 'fireball': c.fillStyle = '#ff8020'; c.beginPath(); c.arc(q.x, q.y, 7, 0, 7); c.fill(); c.fillStyle = '#ffe060'; c.beginPath(); c.arc(q.x, q.y, 3.5, 0, 7); c.fill(); break;
      case 'grenade': c.fillStyle = '#4a5a2a'; c.beginPath(); c.arc(q.x, q.y, 4.5, 0, 7); c.fill(); break;
      case 'cube': c.fillStyle = '#fff'; c.fillRect(q.x - 4, q.y - 4, 8, 8); break;
      case 'jar': case 'bomb': case 'lob': {
        c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(q.x, q.y + 3, 4, 2, 0, 0, 7); c.fill();
        c.fillStyle = q.kind === 'bomb' ? '#222' : q.jar === 'acid' ? '#c0f040' : q.jar === 'explosive' ? '#ff6020' : q.jar === 'buff' ? '#f4c542' : '#a050e0';
        c.beginPath(); c.arc(q.x, q.y - (q.z || 0), 5, 0, 7); c.fill(); break;
      }
      case 'bubble':
        c.strokeStyle = q.trapped ? (q.hold < 1.2 && Math.sin(t * 20) > 0 ? '#ff4040' : 'rgba(160,230,255,.95)') : 'rgba(160,230,255,.85)';
        c.fillStyle = q.trapped && q.hold < 1.2 ? 'rgba(255,80,80,.2)' : 'rgba(160,230,255,.15)';
        c.lineWidth = 2; c.beginPath(); c.arc(q.x, q.y, q.r, 0, 7); c.fill(); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.arc(q.x - q.r * 0.35, q.y - q.r * 0.35, q.r * 0.2, 0, 7); c.fill(); break;
    }
  }

  function updateParticles(c, dt) {
    for (const q of parts) {
      q.life -= dt;
      if (q.life <= 0) continue;
      if (q.ring) { const k = 1 - q.life / q.max; c.strokeStyle = `rgba(${q.color},${Math.max(0, q.life / q.max)})`; c.lineWidth = 3; c.beginPath(); c.arc(q.x, q.y, Math.max(0, q.r + (q.R - q.r) * k), 0, 7); c.stroke(); if (q.R > 40) { c.fillStyle = `rgba(${q.color},${0.25 * q.life / q.max})`; c.fill(); } continue; }
      if (q.arc) { c.strokeStyle = q.color; c.globalAlpha = Math.max(0, q.life / q.max); c.lineWidth = 3; c.beginPath(); c.arc(q.x, q.y, q.r, q.a - 0.9, q.a + 0.9); c.stroke(); c.globalAlpha = 1; continue; }
      if (q.muzzle) { // muzzle flash: a four-point star along the barrel
        const k = q.life / q.max, s = q.size * (0.6 + 0.4 * k);
        c.save(); c.translate(q.x, q.y); c.rotate(q.a); c.globalAlpha = Math.min(1, k * 1.5); c.fillStyle = q.color;
        c.beginPath(); c.moveTo(s * 1.6, 0); c.lineTo(s * 0.25, s * 0.3); c.lineTo(0, s * 0.8); c.lineTo(-s * 0.25, s * 0.25); c.lineTo(-s * 0.4, 0); c.lineTo(-s * 0.25, -s * 0.25); c.lineTo(0, -s * 0.8); c.lineTo(s * 0.25, -s * 0.3); c.closePath(); c.fill();
        c.fillStyle = '#ffffff'; c.beginPath(); c.arc(0, 0, s * 0.3, 0, 7); c.fill();
        c.restore(); continue;
      }
      if (q.bolt) { c.strokeStyle = `rgba(200,230,255,${q.life / q.max})`; c.lineWidth = 3; c.beginPath(); c.moveTo(...q.pts[0]); for (const pt of q.pts) c.lineTo(...pt); c.stroke(); c.strokeStyle = '#ffffff'; c.lineWidth = 1; c.stroke(); continue; }
      if (q.fling) { const k = 1 - q.life / q.max; c.fillStyle = q.color; c.beginPath(); c.arc(q.x + (q.x2 - q.x) * k, q.y + (q.y2 - q.y) * k - Math.sin(k * Math.PI) * 40, 7, 0, 7); c.fill(); continue; }
      if (q.confetti) { // flutters down, spinning
        q.vy += 260 * dt; q.vx *= 0.97; q.vy *= 0.96; q.x += q.vx * dt + Math.sin(q.rot * 2) * 0.6; q.y += q.vy * dt; q.rot += q.spin * dt;
        c.save(); c.globalAlpha = Math.min(1, q.life * 1.5); c.translate(q.x, q.y); c.rotate(q.rot); c.fillStyle = q.color; c.fillRect(-q.size / 2, -q.size / 4, q.size, q.size / 2 * (0.4 + 0.6 * Math.abs(Math.cos(q.rot * 1.7)))); c.restore(); continue;
      }
      if (q.smoke) { q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.9; q.vy *= 0.9; const k = 1 - q.life / q.max; c.globalAlpha = Math.max(0, q.life / q.max) * 0.8; c.fillStyle = q.color; c.beginPath(); c.arc(q.x, q.y, q.size * (0.6 + k), 0, 7); c.fill(); c.globalAlpha = 1; continue; }
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.debris) { q.vx *= 0.9; q.vy *= 0.9; } else { q.vx *= 0.92; q.vy *= 0.92; }
      c.globalAlpha = Math.max(0, Math.min(1, q.life / q.max * 1.5));
      c.fillStyle = q.color; c.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
    }
    c.globalAlpha = 1;
    for (let k = parts.length - 1; k >= 0; k--) if (parts[k].life <= 0) parts.splice(k, 1);
    if (parts.length > 1500) parts.splice(0, parts.length - 1500);
  }

  // ships coming in to dock: you see them dig toward you before they latch on
  function drawApproaching(c, g) {
    for (const es of g.enemyShips || []) {
      if (es.docked || es.gone || !es.rect) continue;
      const k = 1 - Math.max(0, es.approachT) / Math.max(0.1, es.approachMax);
      const R = es.rect, dir = es.side === 'top' ? -1 : 1;
      const off = (1 - k) * (1 - k) * 900 * dir;
      const x0 = R.x0 * TILE, y0 = R.y0 * TILE + off, w = R.w * TILE, h = R.h * TILE;
      c.save();
      c.globalAlpha = 0.35 + 0.55 * k;
      // the drill nose pointing at us, chewing dirt
      const nx = x0 + w * 0.22, ny = es.side === 'top' ? y0 + h : y0;
      drawDrill(c, x0 + w * 0.22, ny, es.side === 'top' ? Math.PI / 2 : -Math.PI / 2, 4.2 * TILE, 4.4 * TILE, t * 8, true);
      // the actual shape of it: crooked hulls, big holds, thin crawlways
      const shape = es.shape || es.layout?.rooms || [];
      const rect = (lr, pad) => {
        const thin = lr.thin, rx = x0 + (lr.c * SLOT_W + (thin === 'v' ? 3 : 0)) * TILE, ry = y0 + (lr.r * SLOT_H + (thin === 'h' ? 2 : 0)) * TILE;
        const ww = thin === 'v' ? 3 : SLOT_W * (lr.cw || 1), hh = thin === 'h' ? 3 : SLOT_H * (lr.rh || 1);
        return [rx + pad * TILE, ry + pad * TILE, (ww + 1 - 2 * pad) * TILE, (hh + 1 - 2 * pad) * TILE];
      };
      c.fillStyle = '#3a2a26'; for (const lr of shape) c.fillRect(...rect(lr, 0));
      c.strokeStyle = '#6a4a40'; c.lineWidth = 3; for (const lr of shape) c.strokeRect(...rect(lr, 0.06));
      c.fillStyle = 'rgba(160,40,30,.35)'; for (const lr of shape) c.fillRect(...rect(lr, 1));
      // dirt spraying off it
      if (Math.random() < 0.5) parts.push(p(nx + (Math.random() - .5) * 100, ny - dir * 4 * TILE, (Math.random() - .5) * 200, -dir * 120 * Math.random(), 0.6, '#4a3626', 4, true));
      c.globalAlpha = 1;
      c.fillStyle = '#ff6a3a'; c.font = 'bold 16px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(`☠ ${es.name} — docking in ${Math.max(0, Math.ceil(es.approachT))}s`, x0 + w / 2, y0 + h / 2);
      c.restore();
    }
  }

  // Ship-to-ship fire through the dirt. D-missiles look like missiles (fins, a flame, a smoke trail); the
  // D-gun fires a big brass shell with a glowing laser tip. Each ship sits inside its bubble (a faint dome
  // while it has layers): a shell that's stopped by it dissolves in a flash and sends a ripple across the
  // bubble, like a drop hitting water. Missiles go straight through.
  const ripples2 = [];   // { x, y, cx, cy, rx, ry, life, max }
  function domeOf(g, who, es) {
    if (who === 'us') { const B = g.box; if (!B) return null; return { cx: (B.x0 + B.x1 + 1) / 2 * TILE, cy: (B.y0 + B.y1 + 1) / 2 * TILE, rx: (B.x1 - B.x0) / 2 * TILE + 70, ry: (B.y1 - B.y0) / 2 * TILE + 70 }; }
    const R = es?.rect; if (!R) return null;
    return { cx: (R.x0 + R.w / 2) * TILE, cy: (R.y0 + R.h / 2) * TILE, rx: R.w / 2 * TILE + 60, ry: R.h / 2 * TILE + 60 };
  }
  /** Where a straight line from a to b first enters an ellipse. */
  function enterDome(a, b, d) {
    const inside = (x, y) => ((x - d.cx) / d.rx) ** 2 + ((y - d.cy) / d.ry) ** 2 <= 1;
    if (inside(a.x, a.y)) return b;
    for (let s = 0; s <= 1; s += 0.02) { const x = a.x + (b.x - a.x) * s, y = a.y + (b.y - a.y) * s; if (inside(x, y)) return { x, y, s }; }
    return b;
  }
  function drawDomes(c, g) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 2);
    const dome = (d, layers) => {
      if (!d || layers <= 0) return;
      c.save();
      for (let k = 0; k < Math.min(layers, 5); k++) {
        c.strokeStyle = `rgba(140,220,255,${0.06 + 0.03 * pulse})`; c.lineWidth = 2;
        c.beginPath(); c.ellipse(d.cx, d.cy, d.rx + k * 8, d.ry + k * 8, 0, 0, 7); c.stroke();
      }
      c.restore();
    };
    if (g.phase === 'encounter') {
      dome(domeOf(g, 'us'), g.ship.bubble);
      for (const es of g.enemyShips || []) if (es.docked && !es.gone) dome(domeOf(g, 'them', es), es.bubble);
    }
    // ripples where something hit a bubble
    for (const r of ripples2) {
      r.life -= 1 / 60;
      const k = 1 - r.life / r.max;
      c.save();
      c.beginPath(); c.ellipse(r.cx, r.cy, r.rx + 30, r.ry + 30, 0, 0, 7); c.ellipse(r.cx, r.cy, Math.max(1, r.rx - 30), Math.max(1, r.ry - 30), 0, 0, 7); c.clip('evenodd');
      for (let n = 0; n < 3; n++) {
        const rr = 8 + (k * 110) - n * 24; if (rr <= 0) continue;
        c.strokeStyle = `rgba(170,235,255,${Math.max(0, 0.75 - k) * (1 - n * 0.25)})`; c.lineWidth = 3 - n * 0.6;
        c.beginPath(); c.arc(r.x, r.y, rr, 0, 7); c.stroke();
      }
      // the patch of bubble that took the hit lights up, then that layer fades away
      c.strokeStyle = `rgba(200,245,255,${Math.max(0, 0.6 - k)})`; c.lineWidth = 5;
      const a0 = Math.atan2((r.y - r.cy) / r.ry, (r.x - r.cx) / r.rx);
      c.beginPath(); c.ellipse(r.cx, r.cy, r.rx, r.ry, 0, a0 - 0.35, a0 + 0.35); c.stroke();
      c.restore();
    }
    for (let k = ripples2.length - 1; k >= 0; k--) if (ripples2[k].life <= 0) ripples2.splice(k, 1);
  }
  function drawMissileBody(c, x, y, a, s = 1, enemy = false) {
    c.save(); c.translate(x, y); c.rotate(a); c.scale(s, s);
    c.fillStyle = enemy ? '#8a3a2a' : '#c8ccd4'; c.fillRect(-16, -4.5, 26, 9);           // body
    c.fillStyle = enemy ? '#5a1a10' : '#e04020'; c.beginPath(); c.moveTo(10, -4.5); c.lineTo(20, 0); c.lineTo(10, 4.5); c.closePath(); c.fill();   // nose
    c.fillStyle = enemy ? '#3a1a10' : '#606870';
    for (const sgn of [-1, 1]) { c.beginPath(); c.moveTo(-16, sgn * 4.5); c.lineTo(-22, sgn * 10); c.lineTo(-10, sgn * 4.5); c.fill(); }   // fins
    c.fillStyle = '#202020'; c.fillRect(-4, -4.5, 2, 9);
    const fl = 8 + Math.random() * 8;   // exhaust flame
    c.fillStyle = '#ffb030'; c.beginPath(); c.moveTo(-16, -3); c.lineTo(-16 - fl, 0); c.lineTo(-16, 3); c.fill();
    c.fillStyle = '#fff4c0'; c.beginPath(); c.moveTo(-16, -1.5); c.lineTo(-16 - fl * 0.5, 0); c.lineTo(-16, 1.5); c.fill();
    c.restore();
  }
  function drawShell(c, x, y, a, s = 1) {
    c.save(); c.translate(x, y); c.rotate(a); c.scale(s, s);
    const gr = c.createLinearGradient(0, -5, 0, 5); gr.addColorStop(0, '#f0d080'); gr.addColorStop(0.5, '#c8952a'); gr.addColorStop(1, '#7a5418');
    c.fillStyle = gr; c.fillRect(-12, -5, 16, 10);                                         // brass casing
    c.fillStyle = '#a07a2a'; c.fillRect(-12, -5, 2, 10);
    c.beginPath(); c.moveTo(4, -5); c.quadraticCurveTo(14, -4, 16, 0); c.quadraticCurveTo(14, 4, 4, 5); c.closePath(); c.fill();
    // the laser tip, lit up
    c.fillStyle = `rgba(255,60,60,${0.35 + 0.3 * Math.sin(t * 40)})`; c.beginPath(); c.arc(16, 0, 7, 0, 7); c.fill();
    c.fillStyle = '#ffe0e0'; c.beginPath(); c.arc(16, 0, 2.5, 0, 7); c.fill();
    c.restore();
  }
  function drawTracers(c, g, dt) {
    drawDomes(c, g);
    const ourW = g.rooms.find((r) => r.owner === 'us' && r.type === 'weapons');
    for (const tr of tracers) {
      if (tr.delay > 0) { tr.delay -= dt; continue; }
      tr.life -= dt;
      const es = tr.who === 'them' ? (g.enemyShips || []).find((s) => s.id === tr.from) : (tr.room != null && g.rooms[tr.room] ? (g.enemyShips || []).find((s) => s.id === g.rooms[tr.room].esId) : g.enemyShip);
      if (!es || es.gone || !es.docked) continue;
      const theirW = es.rooms.map((i) => g.rooms[i]).find((r) => r && r.type === 'weapons') || g.rooms[es.rooms?.[0]];
      if (!ourW || !theirW) continue;
      const k = 1 - tr.life / tr.max;
      const a = tr.who === 'us' ? ourW.station : theirW.station;
      let b = tr.who === 'us' ? (tr.room != null && g.rooms[tr.room] ? g.rooms[tr.room].station : theirW.station) : (tr.room != null && g.rooms[tr.room] ? g.rooms[tr.room].station : ourW.station);
      // a shell the bubble stops never gets inside it
      const dome = domeOf(g, tr.who === 'us' ? 'them' : 'us', es);
      if (tr.blocked && dome) b = enterDome(a, b, dome);
      if (tr.miss) b = { x: b.x + (tr.who === 'us' ? 0 : 160), y: b.y + 220 * (tr.who === 'us' ? -1 : 1) };
      const f = Math.min(1, k / 0.72), ang = Math.atan2(b.y - a.y, b.x - a.x);
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      if (k < 0.72) {
        if (tr.w === 'missile') {
          drawMissileBody(c, x, y, ang, 1.2, tr.who === 'them');
          if (Math.random() < 0.9) parts.push({ ...p(x - Math.cos(ang) * 22, y - Math.sin(ang) * 22, (Math.random() - .5) * 30, (Math.random() - .5) * 30, 0.7, 'rgba(170,160,150,.55)', 8), smoke: true });
          light(x, y, 90, 0.7, '255,160,60', 0.05);
        } else {
          c.strokeStyle = 'rgba(255,90,80,.25)'; c.lineWidth = 3; c.beginPath(); c.moveTo(x - Math.cos(ang) * 50, y - Math.sin(ang) * 50); c.lineTo(x, y); c.stroke();
          drawShell(c, x, y, ang, tr.gun === 'rail' ? 1.4 : tr.gun === 'flak' ? 0.7 : 1);
          light(x, y, 60, 0.6, '255,80,80', 0.05);
        }
      } else if (!tr.done) {
        tr.done = true;
        if (tr.blocked && dome) {
          // the shell dissolves in a flash, and the bubble ripples out from where it struck
          ripples2.push({ x: b.x, y: b.y, cx: dome.cx, cy: dome.cy, rx: dome.rx, ry: dome.ry, life: 0.9, max: 0.9 });
          light(b.x, b.y, 120, 1, '160,230,255', 0.25);
          for (let n = 0; n < 16; n++) { const aa = Math.random() * 7, sp = 40 + Math.random() * 140; parts.push(p(b.x, b.y, Math.cos(aa) * sp, Math.sin(aa) * sp, 0.5, n % 2 ? '#e8c060' : '#bff0ff', 2.5)); }
          texts.push(txt(b.x, b.y - 14, 'BLOCKED', '#80e0ff', 1.1, 12));
        } else if (tr.miss) texts.push(txt(b.x, b.y, 'MISS', '#fff', 1.2, 13));
        else onFx({ t: 'boom', x: b.x, y: b.y + 40, r: tr.w === 'missile' ? 60 : 30 }, g);
      }
    }
    for (let k = tracers.length - 1; k >= 0; k--) if (tracers[k].life <= 0) tracers.splice(k, 1);
  }

  // ---------------------------------------------------------------------
  // the pilot's view: brown tunnel, the light at the core, stuff coming at you
  function drawPilotView(g, dt) {
    const c = ctx, d = g.descent;
    const cx = W / 2, cy = H * 0.45;
    const sx = d.steer.x, sy = d.steer.y;
    const tierCol = [['#3a2414', '#7a5030'], ['#3a180c', '#8a3a1a'], ['#401008', '#a8301a'], ['#401a04', '#c06010'], ['#402a04', '#e0a020']][Math.min(4, g.tier)];
    const gr = c.createRadialGradient(cx - sx * 40 * dpr, cy - sy * 40 * dpr, 2, cx, cy, Math.max(W, H) * 0.7);
    gr.addColorStop(0, '#fff8e0'); gr.addColorStop(0.02, '#ffe0a0'); gr.addColorStop(0.08, tierCol[1]); gr.addColorStop(1, tierCol[0]);
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    // the tunnel bends: everything banks with it
    c.save();
    c.translate(cx, cy); c.rotate((d.bank || 0) * 0.35); c.translate(-cx, -cy);
    // rushing rings (rougher, rockier walls deeper down)
    const spd = d.stranded ? 0 : (d.boost ? 2.2 : 1.2);
    d.ringT = ((d.ringT || 0) + dt * spd) % 1;
    const tier = Math.min(4, g.tier);
    for (let k = 0; k < 12; k++) {
      const z = ((k / 12) - d.ringT + 1) % 1 + 0.02;
      const rr = Math.min(W, H) * 0.08 / z;
      const ox = cx - sx * 300 * dpr * (1 - z) + (d.bank || 0) * 260 * dpr * (1 - z) * (1 - z), oy = cy - sy * 220 * dpr * (1 - z);
      c.strokeStyle = `rgba(30,15,5,${Math.min(0.5, (1 - z) * 0.6)})`; c.lineWidth = 3 * dpr / Math.max(0.3, z);
      if (tier === 0) { c.beginPath(); c.ellipse(ox, oy, rr * 1.3, rr, 0, 0, 7); c.stroke(); }
      else {
        // jagged rock ring
        const n = 14 + tier * 4, seed = k * 7.3 + Math.floor(d.ringT + k);
        c.beginPath();
        for (let s = 0; s <= n; s++) { const a = s / n * Math.PI * 2; const j = 1 + Math.sin(seed * 3.1 + s * 2.7) * 0.05 * tier + Math.sin(seed + s * 5.3) * 0.03 * tier; c.lineTo(ox + Math.cos(a) * rr * 1.3 * j, oy + Math.sin(a) * rr * j); }
        c.stroke();
        if (tier >= 3 && k % 3 === 0) { c.strokeStyle = `rgba(255,110,30,${0.25 * (1 - z)})`; c.lineWidth = 1.5 * dpr / Math.max(0.3, z); c.stroke(); }
      }
    }
    // the light at the center never goes away
    c.fillStyle = `rgba(255,250,220,${0.8 + 0.2 * Math.sin(t * 3)})`; c.beginPath(); c.arc(cx - sx * 300 * dpr, cy - sy * 220 * dpr, 3 * dpr + g.level * 0.6 * dpr, 0, 7); c.fill();
    // obstacles far -> near
    const obs = [...d.obstacles].sort((a, b) => b.z - a.z);
    for (const o of obs) {
      if (o.z <= 0) continue;
      const scale = 1 / (o.z * 2.2 + 0.08);
      const ox = cx + (o.x - sx) * W * 0.32 * scale * 0.5, oy = cy + (o.y - sy) * H * 0.42 * scale * 0.5;
      const rr = o.r * Math.min(W, H) * 0.22 * scale * 0.5;
      c.globalAlpha = Math.min(1, (1 - o.z) * 2.5);
      if (o.kind === 'rock' || o.kind === 'boulder') {
        c.fillStyle = o.kind === 'boulder' ? '#4a3626' : '#6a4a30';
        c.beginPath(); for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2 + o.spin; const v = 0.75 + 0.25 * Math.sin(k * 3.1 + o.spin * 5); c.lineTo(ox + Math.cos(a) * rr * v, oy + Math.sin(a) * rr * v); } c.fill();
        c.fillStyle = 'rgba(255,220,180,.15)'; c.beginPath(); c.arc(ox - rr * 0.3, oy - rr * 0.3, rr * 0.3, 0, 7); c.fill();
      } else if (o.kind === 'creature') {
        c.fillStyle = '#a04a5a'; for (let k = 3; k >= 0; k--) { c.beginPath(); c.arc(ox - k * rr * 0.4 * Math.cos(t * 3), oy + k * rr * 0.3 * Math.sin(t * 3 + k), rr * (1 - k * 0.15), 0, 7); c.fill(); }
        c.fillStyle = '#ffe040'; c.beginPath(); c.arc(ox - rr * 0.3, oy - rr * 0.2, rr * 0.15, 0, 7); c.arc(ox + rr * 0.3, oy - rr * 0.2, rr * 0.15, 0, 7); c.fill();
      } else if (o.kind === 'gems') {
        c.fillStyle = '#5ec8e8'; for (let k = 0; k < 5; k++) { const a = k * 1.3 + o.spin; c.beginPath(); c.moveTo(ox + Math.cos(a) * rr * 0.6, oy + Math.sin(a) * rr * 0.6 - rr * 0.3); c.lineTo(ox + Math.cos(a) * rr * 0.6 + rr * 0.2, oy + Math.sin(a) * rr * 0.6); c.lineTo(ox + Math.cos(a) * rr * 0.6, oy + Math.sin(a) * rr * 0.6 + rr * 0.3); c.lineTo(ox + Math.cos(a) * rr * 0.6 - rr * 0.2, oy + Math.sin(a) * rr * 0.6); c.fill(); }
      } else if (o.kind === 'fuel') {
        c.fillStyle = `rgba(255,210,60,${0.6 + 0.4 * Math.sin(t * 8)})`; c.beginPath(); c.arc(ox, oy, rr * 0.7, 0, 7); c.fill(); c.fillStyle = '#402a04'; c.font = `bold ${Math.max(8, rr * 0.6)}px system-ui`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('F', ox, oy);
      }
      c.globalAlpha = 1;
    }
    c.restore();
    // reticle
    c.strokeStyle = 'rgba(120,230,255,.8)'; c.lineWidth = 2 * dpr;
    c.beginPath(); c.arc(cx, cy, 26 * dpr, 0, 7); c.moveTo(cx - 40 * dpr, cy); c.lineTo(cx - 14 * dpr, cy); c.moveTo(cx + 14 * dpr, cy); c.lineTo(cx + 40 * dpr, cy); c.moveTo(cx, cy - 40 * dpr); c.lineTo(cx, cy - 14 * dpr); c.moveTo(cx, cy + 14 * dpr); c.lineTo(cx, cy + 40 * dpr); c.stroke();
    // cockpit frame
    c.fillStyle = '#1a1512';
    c.beginPath(); c.moveTo(0, H); c.lineTo(0, H * 0.78); c.quadraticCurveTo(W / 2, H * 0.68, W, H * 0.78); c.lineTo(W, H); c.fill();
    c.fillStyle = '#2a221c'; c.fillRect(0, 0, W, 10 * dpr); c.fillRect(0, 0, 14 * dpr, H); c.fillRect(W - 14 * dpr, 0, 14 * dpr, H);
    // gauges
    c.font = `bold ${12 * dpr}px system-ui`; c.textAlign = 'left'; c.textBaseline = 'middle';
    const gy = H * 0.86;
    const gauge = (x, label, f, col) => { c.fillStyle = '#9a8a7a'; c.fillText(label, x, gy - 14 * dpr); c.fillStyle = '#0c0907'; c.fillRect(x, gy, 170 * dpr, 12 * dpr); c.fillStyle = col; c.fillRect(x, gy, 170 * dpr * Math.max(0, Math.min(1, f)), 12 * dpr); };
    gauge(W * 0.08, 'TO NEXT STOP', d.progress, '#f4a340');
    gauge(W * 0.08 + 200 * dpr, 'FUEL', g.ship.fuel / g.ship.fuelMax, g.ship.fuel < 25 ? '#e0533a' : '#f4c542');
    gauge(W * 0.08 + 400 * dpr, 'HULL', g.ship.hull / g.ship.hullMax, '#7cc46a');
    c.fillStyle = d.boost ? '#ff8040' : '#9a8a7a';
    c.fillText(d.stranded ? 'STRANDED — OUT OF FUEL' : d.boost ? 'BOOST ▲▲▲' : 'SHIFT: boost   WASD: steer   E: leave helm', W * 0.08, gy + 34 * dpr);
    if (flash > 0) { c.fillStyle = `rgba(${flashColor},${flash * 0.4})`; c.fillRect(0, 0, W, H); flash -= dt * 1.6; }
    cam.shake *= 0.9;
  }

  return { frame, onFx, cam, screenToWorld: (sx, sy) => { const z = (cam.effZoom || cam.zoom); return { x: cam.x + (sx - W / 2 / dpr) / z, y: cam.y + (sy - H / 2 / dpr) / z }; } };
}

function bar(c, x, y, w, h, f, col) {
  c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(x - 1, y - 1, w + 2, h + 2);
  c.fillStyle = col; c.fillRect(x, y, w * Math.max(0, Math.min(1, f)), h);
}
function speech(c, x, y, text, life, enemy = false) {
  c.save();
  c.globalAlpha = Math.min(1, life * 2);
  c.font = enemy ? 'bold 10px system-ui' : '10px system-ui';
  // wrap long lines (the good insults are long)
  const words = String(text).split(' '), lines = [];
  let cur = '';
  for (const w of words) { const n = cur ? cur + ' ' + w : w; if (c.measureText(n).width > 210 && cur) { lines.push(cur); cur = w; } else cur = n; }
  if (cur) lines.push(cur);
  if (lines.length > 4) { lines.length = 4; lines[3] += '…'; }
  const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 12, h = lines.length * 12 + 4;
  c.fillStyle = enemy ? 'rgba(60,14,10,.92)' : 'rgba(255,250,240,.95)'; roundRect(c, x - w / 2, y - h - 2, w, h, 6); c.fill();
  c.beginPath(); c.moveTo(x - 4, y - 2); c.lineTo(x, y + 4); c.lineTo(x + 4, y - 2); c.fill();
  if (enemy) { c.strokeStyle = '#ff6a50'; c.lineWidth = 1; roundRect(c, x - w / 2, y - h - 2, w, h, 6); c.stroke(); }
  c.fillStyle = enemy ? '#ffd0c0' : '#2a1a10'; c.textAlign = 'center'; c.textBaseline = 'middle';
  lines.forEach((l, k) => c.fillText(l, x, y - h + 6 + k * 12));
  c.restore();
}
function dist2(a, b) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2; }
/** A crow, wings flapping, pointing where it flies. */
function drawCrowShape(c, x, y, a, s = 1) {
  const flap = Math.sin(performance.now() / 60 + x) * 0.7;
  c.save(); c.translate(x, y); c.rotate(a); c.scale(s, s);
  c.fillStyle = '#141418';
  for (const side of [-1, 1]) { c.beginPath(); c.moveTo(-2, 0); c.lineTo(-6, side * (8 + flap * 4)); c.lineTo(3, side * 2); c.fill(); }
  c.beginPath(); c.ellipse(0, 0, 6, 3, 0, 0, 7); c.fill();
  c.fillStyle = '#e0a020'; c.beginPath(); c.moveTo(6, -1); c.lineTo(10, 0); c.lineTo(6, 1); c.fill();
  c.restore();
}
/** Gems come in all sorts: nuggets of bronze, silver and gold; cut quartz, amethyst shards, oval sapphires, ruby hearts. */
function drawGem(c, x, y, G, id) {
  const glint = Math.sin(performance.now() / 300 + id) > 0.8;
  c.fillStyle = G.color;
  switch (G.shape) {
    case 'nugget': c.beginPath(); for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2, r = 5 + ((k * 7 + id) % 3); c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.8); } c.closePath(); c.fill(); break;
    case 'shard': c.beginPath(); c.moveTo(x - 2, y - 9); c.lineTo(x + 4, y - 2); c.lineTo(x + 1, y + 6); c.lineTo(x - 5, y + 2); c.closePath(); c.fill(); c.fillStyle = 'rgba(0,0,0,.2)'; c.beginPath(); c.moveTo(x - 2, y - 9); c.lineTo(x + 1, y + 6); c.lineTo(x - 5, y + 2); c.fill(); break;
    case 'oval': c.beginPath(); c.ellipse(x, y, 5, 7, 0, 0, 7); c.fill(); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1; c.beginPath(); c.ellipse(x, y, 2.5, 4, 0, 0, 7); c.stroke(); break;
    case 'heart': c.beginPath(); c.moveTo(x, y + 6); c.bezierCurveTo(x - 9, y - 1, x - 4, y - 8, x, y - 3); c.bezierCurveTo(x + 4, y - 8, x + 9, y - 1, x, y + 6); c.fill(); break;
    default: c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x + 6, y); c.lineTo(x, y + 6); c.lineTo(x - 6, y); c.fill();
  }
  c.fillStyle = G.hi; c.fillRect(x - 2, y - 3, 2, 2);
  if (glint) { c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(x + 1, y - 6, 1.5, 5); c.fillRect(x - 1, y - 4, 5, 1.5); }
}
function hexToRgb(hex) { const n = parseInt((hex || '#ffffff').slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }

/**
 * The dirt outside, one look per depth tier. Shallow: soft brown soil with pebbles. Deeper: darker
 * rock, bigger boulders, cracks and strata. The core: black basalt with glowing magma veins.
 */
function makeDirtPattern(ctx, tier = 0) {
  const S = 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const base = ['#3b2a1c', '#35241a', '#2e1f18', '#281a16', '#1e1412'][tier];
  const speck = [['20,12,6', '90,66,44'], ['18,10,6', '96,62,40'], ['14,8,6', '104,70,50'], ['10,6,6', '110,64,46'], ['8,4,4', '120,50,30']][tier];
  c.fillStyle = base; c.fillRect(0, 0, S, S);
  // wrap-around helper so the pattern tiles seamlessly
  const wrap = (fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { c.save(); c.translate(ox, oy); fn(); c.restore(); } };
  // strata: diagonal bands (deeper = more pronounced)
  for (let k = 0; k < 3 + tier * 2; k++) {
    const y = Math.random() * S, th = 6 + Math.random() * (8 + tier * 4);
    c.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '120,90,60'},${0.05 + tier * 0.025})`;
    wrap(() => { c.beginPath(); c.moveTo(0, y); c.lineTo(S, y + S * 0.35); c.lineTo(S, y + S * 0.35 + th); c.lineTo(0, y + th); c.fill(); });
  }
  for (let k = 0; k < 900; k++) { c.fillStyle = `rgba(${Math.random() < .5 ? speck[0] : speck[1]},${Math.random() * 0.5})`; const s = 1 + Math.random() * 4; c.fillRect(Math.random() * S, Math.random() * S, s, s); }
  // rocks: more and bigger, more jagged, the deeper we go
  for (let k = 0; k < 20 + tier * 8; k++) {
    const x = Math.random() * S, y = Math.random() * S, r = 2 + Math.random() * (5 + tier * 4);
    const n = 5 + Math.floor(Math.random() * 4), rough = 0.2 + tier * 0.1;
    const pts = Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; const v = r * (1 - rough + Math.random() * rough * 2); return [Math.cos(a) * v, Math.sin(a) * v]; });
    const shade = 80 + Math.random() * 50 - tier * 10;
    wrap(() => {
      c.fillStyle = `rgba(${shade + 30},${shade + 10},${shade - 10},${0.3 + Math.random() * 0.35})`;
      c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(x + px, y + py) : c.moveTo(x + px, y + py))); c.closePath(); c.fill();
      c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.arc(x + r * 0.25, y + r * 0.3, r * 0.5, 0, 7); c.fill();
    });
  }
  // cracks (from the middle layers down)
  c.lineCap = 'round';
  for (let k = 0; k < tier * 6; k++) {
    let x = Math.random() * S, y = Math.random() * S;
    c.strokeStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.3})`; c.lineWidth = 1 + Math.random() * 1.5;
    const seg = [[x, y]];
    for (let s = 0; s < 6; s++) { x += (Math.random() - 0.3) * 22; y += (Math.random() - 0.3) * 22; seg.push([x, y]); }
    wrap(() => { c.beginPath(); seg.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.stroke(); });
  }
  // magma veins near the core
  if (tier >= 3) for (let k = 0; k < (tier - 2) * 4; k++) {
    let x = Math.random() * S, y = Math.random() * S;
    const seg = [[x, y]];
    for (let s = 0; s < 8; s++) { x += (Math.random() - 0.4) * 26; y += (Math.random() - 0.4) * 26; seg.push([x, y]); }
    wrap(() => {
      c.strokeStyle = 'rgba(255,90,20,.28)'; c.lineWidth = 6; c.beginPath(); seg.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.stroke();
      c.strokeStyle = 'rgba(255,200,80,.55)'; c.lineWidth = 1.6; c.beginPath(); seg.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.stroke();
    });
  }
  // gem glints
  for (let k = 0; k < 6; k++) { c.fillStyle = tier >= 3 ? 'rgba(255,120,200,.5)' : 'rgba(94,200,232,.5)'; c.fillRect(Math.random() * S, Math.random() * S, 2, 2); }
  return { pattern: ctx.createPattern(cv, 'repeat') };
}
