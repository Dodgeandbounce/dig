// Draws the game: dirt, both ships, doors, breaches, gadgets, foxes, enemies, effects,
// fog of war, and the pilot's tunnel view.
import { T, TILE, MAP_W, MAP_H, ROOMS, SLOT_W, SLOT_H, CLASSES } from '../shared/sim/data.js';
import { idx } from '../shared/sim/grid.js';
import { drawCrew, drawMob, drawStation, shade, roundRect } from './sprites.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, zoom: 1.25, shake: 0, overview: false };
  const parts = [];   // particles
  const texts = [];   // floating numbers / words
  const ripples = []; // dog sense
  const tracers = []; // ship-to-ship fire
  let flash = 0, flashColor = '255,60,40';
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
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---------------------------------------------------------------------
  function onFx(e, g) {
    const R = Math.random;
    switch (e.t) {
      case 'hit': for (let k = 0; k < 4; k++) parts.push(p(e.x, e.y, (R() - .5) * 160, (R() - .5) * 160, 0.3, e.team === 'crew' ? '#ff5040' : '#ffd080', 2)); if (e.amt >= 3) texts.push(txt(e.x, e.y - 14, String(e.amt), e.team === 'crew' ? '#ff6050' : '#fff', 0.7, 11)); break;
      case 'boom': { cam.shake = Math.min(14, cam.shake + e.r / 9); parts.push({ ring: true, x: e.x, y: e.y, r: 4, R: e.r, life: 0.35, max: 0.35, color: '255,180,80' });
        for (let k = 0; k < 18; k++) { const a = R() * 7, s = R() * e.r * 4; parts.push(p(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 0.5 + R() * 0.4, R() < .5 ? '#ffb040' : '#ff6020', 3 + R() * 3)); }
        for (let k = 0; k < 8; k++) { const a = R() * 7, s = R() * 120; parts.push(p(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 1.2, '#3a3028', 2, true)); } break; }
      case 'spark': for (let k = 0; k < 3; k++) parts.push(p(e.x, e.y, (R() - .5) * 200, (R() - .5) * 200, 0.25, e.color || '#ffe080', 1.6)); break;
      case 'die': for (let k = 0; k < 14; k++) { const a = R() * 7, s = 40 + R() * 160; parts.push(p(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, 0.6, e.color, 3)); } break;
      case 'text': texts.push(txt(e.x, e.y, e.text, e.color || '#fff', 1.4, 12)); break;
      case 'swing': parts.push({ arc: true, x: e.x, y: e.y, a: e.a, r: e.r, life: 0.15, max: 0.15, color: e.cls === 'mrclean' ? '#a0ffb0' : e.cls === 'fish' ? '#a0e0ff' : '#ffffff' }); break;
      case 'shot': parts.push(p(e.x + Math.cos(e.a) * 16, e.y + Math.sin(e.a) * 16, 0, 0, 0.06, e.w === 'coin' ? '#f4c542' : '#fff2a0', 5)); break;
      case 'eshot': break;
      case 'pop': parts.push({ ring: true, x: e.x, y: e.y, r: e.r, R: e.r * 1.8, life: 0.25, max: 0.25, color: '160,230,255' }); break;
      case 'fling': parts.push({ fling: true, x: e.x, y: e.y, x2: e.x2, y2: e.y2, life: 0.5, max: 0.5, color: e.color }); break;
      case 'zap': for (let k = 0; k < 8; k++) parts.push(p(e.x, e.y, (R() - .5) * 220, (R() - .5) * 220, 0.3, '#80e0ff', 2)); break;
      case 'splash': parts.push({ ring: true, x: e.x, y: e.y, r: 8, R: 60, life: 0.4, max: 0.4, color: hexToRgb(e.color) }); break;
      case 'flame': for (let k = 0; k < 3; k++) { const a = e.a + (R() - .5) * 0.5, s = 200 + R() * 120; parts.push(p(e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, e.r / s, R() < .5 ? '#ff8020' : '#ffd040', 5)); } break;
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
      case 'dfire': tracers.push({ who: e.who, w: e.w, blocked: e.blocked, miss: e.miss, room: e.room, life: 0.8, max: 0.8 }); if (e.who === 'them' && !e.blocked && !e.miss) { flash = 0.25; cam.shake += 4; } break;
      case 'shipdie': cam.shake = 20; flash = 0.6; flashColor = '255,200,120'; break;
      case 'bossdie': cam.shake = 30; flash = 1; flashColor = '255,240,180'; break;
      case 'gameover': flash = 1; flashColor = '0,0,0'; break;
      case 'respawn': parts.push({ ring: true, x: e.x, y: e.y, r: 30, R: 4, life: 0.5, max: 0.5, color: '124,196,106' }); break;
      case 'phase': parts.push({ ring: true, x: e.x, y: e.y, r: 4, R: 30, life: 0.3, max: 0.3, color: '160,160,255' }); break;
      case 'down': texts.push(txt(e.x, e.y - 20, 'DOWN', '#ff6050', 1.5, 14)); break;
      case 'spray': for (let k = 0; k < 4; k++) { const f = R(); parts.push(p(e.x + (e.x2 - e.x) * f, e.y + (e.y2 - e.y) * f, (R() - .5) * 60, (R() - .5) * 60, 0.45, R() < .5 ? '#e8f4ff' : '#b0d8f0', 4 + R() * 4)); } break;
      case 'fire': cam.shake = Math.min(10, cam.shake + 3); break;
      case 'docked': cam.shake = Math.min(18, cam.shake + 10); flash = 0.35; flashColor = '255,120,60'; texts.push(txt(e.x, e.y - 30, 'DOCKED!', '#ff6a3a', 1.8, 16)); break;
    }
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
      if (g.box) { x0 = g.box.x0; y0 = g.box.y0; x1 = g.box.x1; y1 = g.box.y1; }
      for (const r of g.rooms) { if (r.gone) continue; x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x0 + SLOT_W); y1 = Math.max(y1, r.y0 + SLOT_H); }
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
    const sx = (Math.random() - .5) * cam.shake, sy = (Math.random() - .5) * cam.shake;
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
    const dirt = dirts[Math.min(4, g.tier || 0)];
    ctxs.save();
    ctxs.fillStyle = dirt.pattern;
    ctxs.translate(-scroll.x, -scroll.y);
    ctxs.fillRect(vx0 + scroll.x, vy0 + scroll.y, vx1 - vx0, vy1 - vy0);
    ctxs.restore();
    const layerTint = ['rgba(0,0,0,0)', 'rgba(120,40,10,.12)', 'rgba(160,30,10,.2)', 'rgba(220,90,10,.22)', 'rgba(255,200,60,.2)'][Math.min(4, g.tier)];
    ctxs.fillStyle = layerTint; ctxs.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
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

    // visibility
    const vis = visibleRooms(g, me);
    for (const r of vis) seen.set(r, t);

    // tiles
    const tx0 = Math.max(0, Math.floor(vx0 / TILE)), ty0 = Math.max(0, Math.floor(vy0 / TILE));
    const tx1 = Math.min(MAP_W - 1, Math.floor(vx1 / TILE)), ty1 = Math.min(MAP_H - 1, Math.floor(vy1 / TILE));
    const G = g.grid;
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
            break;
          }
          const base = room ? (ROOMS[room.type]?.color || (room.owner === 'them' ? '#3a2a2a' : '#333')) : '#333';
          ctxs.fillStyle = (x + y) & 1 ? base : shade(base, 8);
          ctxs.fillRect(px, py, TILE, TILE);
          if (room?.owner === 'them') { ctxs.fillStyle = 'rgba(120,0,0,.12)'; ctxs.fillRect(px, py, TILE, TILE); }
          break;
        }
        case T.WALL: ctxs.fillStyle = '#5c5650'; ctxs.fillRect(px, py, TILE, TILE); ctxs.fillStyle = '#6e6862'; ctxs.fillRect(px, py, TILE, 5); dmgCracks(ctxs, px, py, G.hp[i] / 90); break;
        case T.HULL: ctxs.fillStyle = '#48443f'; ctxs.fillRect(px, py, TILE, TILE); ctxs.fillStyle = '#5a5650'; ctxs.fillRect(px + 2, py + 2, TILE - 4, TILE - 4); ctxs.fillStyle = '#2e2a26'; ctxs.fillRect(px + 5, py + 5, 3, 3); ctxs.fillRect(px + TILE - 8, py + TILE - 8, 3, 3); if (G.hp[i] < 140) dmgCracks(ctxs, px, py, G.hp[i] / 140); break;
        case T.DOOR: drawDoor(ctxs, g, G.doorAt[i], px, py); break;
        case T.TUNNEL: ctxs.fillStyle = '#2f2a26'; ctxs.fillRect(px, py, TILE, TILE); ctxs.fillStyle = '#3a342e'; ctxs.fillRect(px, py + ((y * 7) % 3) * 8, TILE, 3); break;
        case T.BREACH: { ctxs.fillStyle = '#0a0705'; ctxs.fillRect(px, py, TILE, TILE); ctxs.fillStyle = '#6a4a2a';
          for (let k = 0; k < 4; k++) { const ph = (t * 1.5 + k * 0.25 + x * 0.13) % 1; ctxs.fillRect(px + 6 + k * 6, py + ph * TILE, 3, 3); }
          ctxs.strokeStyle = '#ff5030'; ctxs.lineWidth = 1.5; ctxs.setLineDash([4, 3]); ctxs.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2); ctxs.setLineDash([]);
          const prog = g.rebuild?.get(i); if (prog) { ctxs.fillStyle = '#7cc46a'; ctxs.fillRect(px + 2, py + TILE - 5, (TILE - 4) * Math.min(1, prog / 98), 3); } break; }
        case T.RUBBLE: { const room = g.rooms[ri]; ctxs.fillStyle = room ? shade(ROOMS[room.type]?.color || '#333', -10) : '#2a2622'; ctxs.fillRect(px, py, TILE, TILE);
          ctxs.fillStyle = '#6a625a'; for (let k = 0; k < 5; k++) ctxs.fillRect(px + ((k * 13 + x * 7) % 26), py + ((k * 17 + y * 5) % 26), 5, 4);
          const prog = g.rebuild?.get(i); if (prog) { ctxs.fillStyle = '#7cc46a'; ctxs.fillRect(px + 2, py + TILE - 5, (TILE - 4) * Math.min(1, prog / 60), 3); } break; }
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
      if (room.gone || x > vx1 || y > vy1 || x + SLOT_W * TILE < vx0 || y + SLOT_H * TILE < vy0) return;
      ctxs.font = 'bold 9px system-ui';
      ctxs.fillStyle = room.owner === 'them' ? 'rgba(255,160,150,.7)' : 'rgba(255,240,220,.55)';
      ctxs.fillText(room.name.toUpperCase(), x + TILE * 4 + 3, y + TILE + 3);
      if (room.sys || room.type === 'core' || room.type === 'pod') {
        const active = me && Math.hypot(me.x - room.station.x, me.y - room.station.y) < 46;
        drawStation(ctxs, room, t, active);
        if (room.sys && room.sys.hp < room.sys.max) bar(ctxs, room.station.x - 22, room.station.y + 15, 44, 4, room.sys.hp / room.sys.max, room.sys.hp <= 0 ? '#802020' : '#e0533a');
        if (room.sys && room.sys.hp <= 0 && Math.sin(t * 8) > 0) { ctxs.fillStyle = '#ff5040'; ctxs.font = 'bold 9px system-ui'; ctxs.textAlign = 'center'; ctxs.fillText('OFFLINE', room.station.x, room.station.y + 20); ctxs.textAlign = 'left'; }
        if (room.sys && room.sys.hp > 0 && room.sys.hp < room.sys.max * 0.5 && Math.random() < 0.15) onFx({ t: 'spark', x: room.station.x + (Math.random() - .5) * 30, y: room.station.y }, g);
      }
      if (g.ship.missileTarget === ri && g.phase === 'encounter') { ctxs.strokeStyle = '#ff6a3a'; ctxs.lineWidth = 2; ctxs.setLineDash([6, 4]); ctxs.lineDashOffset = -t * 30; ctxs.strokeRect(x + TILE, y + TILE, (SLOT_W - 1) * TILE, (SLOT_H - 1) * TILE); ctxs.setLineDash([]);
        ctxs.fillStyle = '#ff6a3a'; ctxs.font = 'bold 10px system-ui'; ctxs.fillText('⌖ TARGET', x + TILE + 3, y + TILE + 14); }
    });

    // farm plots
    const farm = g.rooms.find((r) => r.owner === 'us' && r.type === 'farm');
    if (farm) g.ship.farm.plots.forEach((pl, k) => {
      const px = (farm.x0 + 1.4 + (k % 3) * 2.1) * TILE, py = (farm.y0 + 3 + Math.floor(k / 3) * 1.3) * TILE;
      ctxs.fillStyle = '#4a3418'; ctxs.fillRect(px, py, TILE * 1.6, TILE * 0.9);
      if (pl.stage > 0) { ctxs.fillStyle = pl.stage >= 3 ? '#e0c040' : '#60b040'; for (let s = 0; s < 3; s++) { ctxs.beginPath(); ctxs.arc(px + 8 + s * 16, py + 14, 2 + pl.stage * 2, 0, 7); ctxs.fill(); } }
    });

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
      if (a.team === 'crew' && a.cls) { drawCrew(ctxs, a, t, { own: a === me }); continue; }
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
      if (room.gone || x > vx1 || y > vy1 || x + SLOT_W * TILE < vx0 || y + SLOT_H * TILE < vy0) return;
      if (vis.has(ri)) return;
      const last = seen.get(ri);
      const a = room.owner === 'them' ? 0.82 : 0.6;
      const fade = last ? Math.min(1, (t - last) / 0.6) : 1;
      ctxs.fillStyle = `rgba(6,4,3,${a * fade})`;
      ctxs.fillRect(x, y, (SLOT_W - 1) * TILE, (SLOT_H - 1) * TILE);
    });

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
    for (const m of g.mobs) if (m.isJoe && m.alive && m.sayT > 0) speech(ctxs, m.x, m.y - 30, m.say, m.sayT);

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
      case 'turret': c.fillStyle = '#5a5040'; c.beginPath(); c.arc(o.x, o.y, 10, 0, 7); c.fill(); c.strokeStyle = '#f0a030'; c.lineWidth = 4; c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(o.x + Math.cos(o.a) * 15, o.y + Math.sin(o.a) * 15); c.stroke(); c.fillStyle = '#f0a030'; c.beginPath(); c.arc(o.x, o.y, 4, 0, 7); c.fill(); break;
      case 'trap': c.strokeStyle = o.armT > 0 ? '#666' : '#60d0ff'; c.lineWidth = 2; c.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * 7; c.lineTo(o.x + Math.cos(a) * 9, o.y + Math.sin(a) * 9); } c.closePath(); c.stroke(); if (o.armT <= 0 && Math.sin(t * 10 + o.id) > .6) { c.fillStyle = '#80e0ff'; c.fillRect(o.x - 1, o.y - 1, 3, 3); } break;
      case 'mine': c.fillStyle = o.sub === 'c4' ? '#c8b080' : '#333'; c.beginPath(); c.arc(o.x, o.y, o.sub === 'c4' ? 8 : 6, 0, 7); c.fill(); c.fillStyle = Math.sin(t * (o.sub === 'timed' ? 20 : 6)) > 0 ? '#ff3030' : '#601010'; c.beginPath(); c.arc(o.x, o.y, 2, 0, 7); c.fill(); break;
      case 'tnt': c.fillStyle = '#c02020'; for (let k = -1; k <= 1; k++) c.fillRect(o.x + k * 5 - 2, o.y - 8, 4, 16); c.fillStyle = '#fff'; c.font = 'bold 10px system-ui'; c.textAlign = 'center'; c.fillText(Math.ceil(o.t), o.x, o.y - 14); break;
      case 'cloud': { const col = o.sub === 'poison' ? '160,80,230' : o.sub === 'acid' ? '190,240,60' : '180,180,180'; for (let k = 0; k < 5; k++) { c.fillStyle = `rgba(${col},${0.12 * Math.min(1, o.t)})`; c.beginPath(); c.arc(o.x + Math.sin(t + k * 1.3) * 20, o.y + Math.cos(t * 0.8 + k) * 16, o.r * 0.6, 0, 7); c.fill(); } break; }
      case 'crate': c.fillStyle = '#9a7a3a'; c.fillRect(o.x - 10, o.y - 8, 20, 16); c.strokeStyle = '#5a4020'; c.lineWidth = 1.5; c.strokeRect(o.x - 10, o.y - 8, 20, 16); c.beginPath(); c.moveTo(o.x - 10, o.y - 8); c.lineTo(o.x + 10, o.y + 8); c.stroke(); if (Math.sin(t * 4) > 0) { c.fillStyle = '#f4c542'; c.font = '9px system-ui'; c.textAlign = 'center'; c.fillText('E', o.x, o.y - 12); } break;
      case 'skeleton': c.save(); c.translate(o.x, o.y); c.rotate(o.a); c.fillStyle = '#ddd5c0'; c.beginPath(); c.arc(0, -8, 6, 0, 7); c.fill(); c.fillRect(-1.5, -2, 3, 14); for (let k = 0; k < 3; k++) c.fillRect(-6, 1 + k * 4, 12, 1.5); c.fillStyle = '#222'; c.fillRect(-3, -10, 2, 2); c.fillRect(1, -10, 2, 2); c.restore(); break;
      case 'journal': c.fillStyle = '#7a3a2a'; c.fillRect(o.x - 7, o.y - 9, 14, 18); c.fillStyle = '#f0e0c0'; c.fillRect(o.x - 5, o.y - 7, 10, 2); if (!o.read && Math.sin(t * 4) > 0) { c.strokeStyle = '#f4c542'; c.lineWidth = 2; c.beginPath(); c.arc(o.x, o.y, 16, 0, 7); c.stroke(); } break;
    }
  }

  function drawPickup(c, pk) {
    const bob = Math.sin(t * 4 + pk.id) * 1.5;
    const y = pk.y - pk.z + bob;
    c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(pk.x, pk.y + 4, 6, 3, 0, 0, 7); c.fill();
    switch (pk.kind) {
      case 'gem': c.fillStyle = '#5ec8e8'; c.beginPath(); c.moveTo(pk.x, y - 7); c.lineTo(pk.x + 6, y); c.lineTo(pk.x, y + 6); c.lineTo(pk.x - 6, y); c.fill(); c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(pk.x - 2, y - 3, 2, 2); break;
      case 'ore': c.fillStyle = '#8a8a90'; c.beginPath(); c.arc(pk.x, y, 6, 0, 7); c.fill(); c.fillStyle = '#c0a060'; c.fillRect(pk.x - 2, y - 2, 3, 3); break;
      case 'food': c.fillStyle = { grub: '#e0c080', shroom: '#c06080', fish: '#80b0e0', spice: '#e04020' }[pk.sub] || '#f07070'; c.beginPath(); c.arc(pk.x, y, 5, 0, 7); c.fill(); break;
      case 'coin': c.fillStyle = '#f4c542'; c.beginPath(); c.arc(pk.x, y, 4.5, 0, 7); c.fill(); c.strokeStyle = '#a07a10'; c.lineWidth = 1; c.stroke(); break;
      case 'crop': c.fillStyle = '#e0c040'; c.beginPath(); c.arc(pk.x, y, 5, 0, 7); c.fill(); break;
      case 'gun': c.strokeStyle = '#90a050'; c.lineWidth = 4; c.beginPath(); c.moveTo(pk.x - 8, y); c.lineTo(pk.x + 8, y); c.stroke(); break;
    }
  }

  function drawProj(c, q, t) {
    switch (q.kind) {
      case 'bullet': case 'ppk': case 'knife':
        c.strokeStyle = q.team === 'crew' ? (q.kind === 'knife' ? '#ddd' : '#fff2a0') : '#ff7050'; c.lineWidth = q.kind === 'ppk' ? 2.5 : 2;
        c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x - q.vx * 0.02, q.y - q.vy * 0.02); c.stroke(); break;
      case 'coin': c.fillStyle = '#f4c542'; c.beginPath(); c.arc(q.x, q.y, 3.5, 0, 7); c.fill(); break;
      case 'scrap': c.save(); c.translate(q.x, q.y); c.rotate(t * 20 + q.id); c.fillStyle = '#b0a890'; c.fillRect(-4, -3, 8, 6); c.fillStyle = '#e0c060'; c.fillRect(-2, -1, 4, 2); c.restore(); break;
      case 'rocket': c.fillStyle = '#ddd'; c.beginPath(); c.arc(q.x, q.y, 4, 0, 7); c.fill(); parts.push(p(q.x, q.y, (Math.random() - .5) * 30, (Math.random() - .5) * 30, 0.3, '#aaa', 3)); break;
      case 'fireball': c.fillStyle = '#ff8020'; c.beginPath(); c.arc(q.x, q.y, 7, 0, 7); c.fill(); c.fillStyle = '#ffe060'; c.beginPath(); c.arc(q.x, q.y, 3.5, 0, 7); c.fill(); break;
      case 'grenade': c.fillStyle = '#4a5a2a'; c.beginPath(); c.arc(q.x, q.y, 4.5, 0, 7); c.fill(); break;
      case 'cube': c.fillStyle = '#fff'; c.fillRect(q.x - 4, q.y - 4, 8, 8); break;
      case 'jar': case 'bomb': case 'lob': {
        c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(q.x, q.y + 3, 4, 2, 0, 0, 7); c.fill();
        c.fillStyle = q.kind === 'bomb' ? '#222' : q.jar === 'acid' ? '#c0f040' : q.jar === 'explosive' ? '#ff6020' : '#a050e0';
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
      if (q.fling) { const k = 1 - q.life / q.max; c.fillStyle = q.color; c.beginPath(); c.arc(q.x + (q.x2 - q.x) * k, q.y + (q.y2 - q.y) * k - Math.sin(k * Math.PI) * 40, 7, 0, 7); c.fill(); continue; }
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
      const nx = x0 + w / 2, ny = es.side === 'top' ? y0 + h : y0;
      c.fillStyle = '#5a4a3a';
      c.beginPath(); c.moveTo(nx - 60, ny); c.lineTo(nx, ny - dir * 90); c.lineTo(nx + 60, ny); c.fill();
      c.strokeStyle = '#8a7a60'; c.lineWidth = 3;
      for (let s = 0; s < 4; s++) { const ph = (t * 3 + s / 4) % 1; c.beginPath(); c.moveTo(nx - 60 * (1 - ph), ny - dir * 90 * ph); c.lineTo(nx + 60 * (1 - ph), ny - dir * 90 * ph); c.stroke(); }
      // hull and rooms
      c.fillStyle = '#3a2a26'; c.fillRect(x0, y0, w, h);
      c.strokeStyle = '#6a4a40'; c.lineWidth = 4; c.strokeRect(x0 + 2, y0 + 2, w - 4, h - 4);
      c.fillStyle = 'rgba(160,40,30,.35)';
      for (let rr = 0; rr < es.rows; rr++) for (let cc = 0; cc < es.cols; cc++) c.fillRect(x0 + (cc * SLOT_W + 1) * TILE, y0 + (rr * SLOT_H + 1) * TILE, (SLOT_W - 1) * TILE, (SLOT_H - 1) * TILE);
      // dirt spraying off it
      if (Math.random() < 0.5) parts.push(p(nx + (Math.random() - .5) * 100, ny, (Math.random() - .5) * 200, -dir * 120 * Math.random(), 0.6, '#4a3626', 4, true));
      c.globalAlpha = 1;
      c.fillStyle = '#ff6a3a'; c.font = 'bold 16px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(`☠ ${es.name} — docking in ${Math.max(0, Math.ceil(es.approachT))}s`, x0 + w / 2, y0 + h / 2);
      c.restore();
    }
  }

  function drawTracers(c, g, dt) {
    const ourW = g.rooms.find((r) => r.owner === 'us' && r.type === 'weapons');
    for (const tr of tracers) {
      tr.life -= dt;
      const es = tr.who === 'them' ? (g.enemyShips || []).find((s) => s.id === tr.from) : (tr.room != null && g.rooms[tr.room] ? (g.enemyShips || []).find((s) => s.id === g.rooms[tr.room].esId) : g.enemyShip);
      if (!es || es.gone || !es.docked) continue;
      const theirW = es.rooms.map((i) => g.rooms[i]).find((r) => r && r.type === 'weapons') || g.rooms[es.rooms?.[0]];
      if (!ourW || !theirW) continue;
      const k = 1 - tr.life / tr.max;
      let a = tr.who === 'us' ? ourW.station : theirW.station;
      let b = tr.who === 'us' ? (tr.room != null && g.rooms[tr.room] ? g.rooms[tr.room].station : theirW.station) : (tr.room != null && g.rooms[tr.room] ? g.rooms[tr.room].station : ourW.station);
      // D-weapons fire straight through the dirt
      const x = a.x + (b.x - a.x) * Math.min(1, k * 1.4), y = a.y + (b.y - a.y) * Math.min(1, k * 1.4);
      if (k < 0.72) {
        c.strokeStyle = tr.w === 'missile' ? 'rgba(255,120,60,.9)' : 'rgba(255,240,160,.9)';
        c.lineWidth = tr.w === 'missile' ? 5 : 3;
        c.beginPath(); c.moveTo(x - (b.x - a.x) * 0.05, y - (b.y - a.y) * 0.05); c.lineTo(x, y); c.stroke();
      } else if (tr.blocked && !tr.done) { tr.done = true; parts.push({ ring: true, x: b.x, y: b.y + 30, r: 20, R: 80, life: 0.5, max: 0.5, color: '120,220,255' }); texts.push(txt(b.x, b.y, 'BLOCKED', '#80e0ff', 1.2, 13)); }
      else if (tr.miss && !tr.done) { tr.done = true; texts.push(txt(b.x, b.y, 'MISS', '#fff', 1.2, 13)); }
      else if (!tr.done) { tr.done = true; onFx({ t: 'boom', x: b.x, y: b.y + 40, r: tr.w === 'missile' ? 60 : 30 }, g); }
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
function speech(c, x, y, text, life) {
  c.save();
  c.globalAlpha = Math.min(1, life * 2);
  c.font = '10px system-ui';
  // wrap long lines (the good insults are long)
  const words = String(text).split(' '), lines = [];
  let cur = '';
  for (const w of words) { const n = cur ? cur + ' ' + w : w; if (c.measureText(n).width > 210 && cur) { lines.push(cur); cur = w; } else cur = n; }
  if (cur) lines.push(cur);
  if (lines.length > 4) { lines.length = 4; lines[3] += '…'; }
  const w = Math.max(...lines.map((l) => c.measureText(l).width)) + 12, h = lines.length * 12 + 4;
  c.fillStyle = 'rgba(255,250,240,.95)'; roundRect(c, x - w / 2, y - h - 2, w, h, 6); c.fill();
  c.beginPath(); c.moveTo(x - 4, y - 2); c.lineTo(x, y + 4); c.lineTo(x + 4, y - 2); c.fill();
  c.fillStyle = '#2a1a10'; c.textAlign = 'center'; c.textBaseline = 'middle';
  lines.forEach((l, k) => c.fillText(l, x, y - h + 6 + k * 12));
  c.restore();
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
