// Draws the game: dirt, both ships, doors, breaches, gadgets, foxes, enemies, effects,
// fog of war, and the pilot's tunnel view.
import { T, TILE, MAP_W, MAP_H, ROOMS, SLOT_W, SLOT_H, CLASSES } from '../shared/sim/data.js';
import { idx } from '../shared/sim/grid.js';
import { drawCrew, drawMob, drawStation, shade, roundRect } from './sprites.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, zoom: 1.55, shake: 0, overview: false };
  const parts = [];   // particles
  const texts = [];   // floating numbers / words
  const ripples = []; // dog sense
  const tracers = []; // ship-to-ship fire
  let flash = 0, flashColor = '255,60,40';
  let t = 0;
  let W = 0, H = 0, dpr = 1;
  const seen = new Map(); // room index -> last time visible (fades fog)
  const dirt = makeDirtPattern(ctx);
  let scroll = 0;

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
      const ours = g.rooms.filter((r) => r.owner === 'us' || g.enemyShip);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of g.rooms) { x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x0 + SLOT_W); y1 = Math.max(y1, r.y0 + SLOT_H); }
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

    // dirt
    const moving = g.phase === 'descent' && !g.descent?.stranded;
    scroll += dt * (moving ? 260 * (g.descent?.boost ? 1.8 : 1) : 0);
    ctxs.save();
    ctxs.fillStyle = dirt.pattern;
    ctxs.translate(-scroll, 0);
    ctxs.fillRect(vx0 + scroll, vy0, vx1 - vx0, vy1 - vy0);
    ctxs.restore();
    const layerTint = ['rgba(0,0,0,0)', 'rgba(120,40,10,.12)', 'rgba(160,30,10,.2)', 'rgba(220,90,10,.22)', 'rgba(255,200,60,.2)'][Math.min(4, g.tier)];
    ctxs.fillStyle = layerTint; ctxs.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    if (moving) { // speed streaks
      ctxs.strokeStyle = 'rgba(255,220,180,.06)'; ctxs.lineWidth = 2;
      for (let k = 0; k < 30; k++) { const yy = vy0 + ((k * 137.5) % (vy1 - vy0)); const xx = vx1 - ((t * 900 + k * 211) % (vx1 - vx0 + 400)); ctxs.beginPath(); ctxs.moveTo(xx, yy); ctxs.lineTo(xx + 80, yy); ctxs.stroke(); }
    }

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
          const room = g.rooms[ri];
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
      }
    }

    // rooms: labels, stations
    ctxs.textAlign = 'left'; ctxs.textBaseline = 'top';
    g.rooms.forEach((room, ri) => {
      const x = room.x0 * TILE, y = room.y0 * TILE;
      if (x > vx1 || y > vy1 || x + SLOT_W * TILE < vx0 || y + SLOT_H * TILE < vy0) return;
      ctxs.font = 'bold 9px system-ui';
      ctxs.fillStyle = room.owner === 'them' ? 'rgba(255,160,150,.7)' : 'rgba(255,240,220,.55)';
      ctxs.fillText(room.name.toUpperCase(), x + TILE + 3, y + TILE + 3);
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
      if (x > vx1 || y > vy1 || x + SLOT_W * TILE < vx0 || y + SLOT_H * TILE < vy0) return;
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
    const col = d.sealed ? '#b03a2a' : d.reinforced > 0 ? '#5a6ad0' : d.hold === 'closed' ? '#a08030' : '#7a8088';
    c.fillStyle = col;
    const gap = open * (TILE / 2 - 2);
    if (d.orient === 'v') { c.fillRect(px + 8, py, 16, TILE / 2 - gap); c.fillRect(px + 8, py + TILE / 2 + gap, 16, TILE / 2 - gap); }
    else { c.fillRect(px, py + 8, TILE / 2 - gap, 16); c.fillRect(px + TILE / 2 + gap, py + 8, TILE / 2 - gap, 16); }
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
      case 'mess': { c.fillStyle = o.sub === 'gore' ? 'rgba(110,20,20,.55)' : 'rgba(110,80,45,.75)'; for (let k = 0; k < o.amt; k++) { c.beginPath(); c.arc(o.x + Math.sin(k * 2.3 + o.id) * 9, o.y + Math.cos(k * 1.7 + o.id) * 7, 6 + (k % 3), 0, 7); c.fill(); } break; }
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
      if (q.ring) { const k = 1 - q.life / q.max; c.strokeStyle = `rgba(${q.color},${Math.max(0, q.life / q.max)})`; c.lineWidth = 3; c.beginPath(); c.arc(q.x, q.y, q.r + (q.R - q.r) * k, 0, 7); c.stroke(); if (q.R > 40) { c.fillStyle = `rgba(${q.color},${0.25 * q.life / q.max})`; c.fill(); } continue; }
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

  function drawTracers(c, g, dt) {
    const es = g.enemyShip;
    const ourW = g.rooms.find((r) => r.owner === 'us' && r.type === 'weapons');
    for (const tr of tracers) {
      tr.life -= dt;
      if (!es || es.gone) continue;
      const theirW = g.rooms.find((r) => r.owner === 'them' && r.type === 'weapons') || g.rooms[es.rooms?.[0]];
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
    // rushing rings
    const spd = d.stranded ? 0 : (d.boost ? 2.2 : 1.2);
    d.ringT = ((d.ringT || 0) + dt * spd) % 1;
    for (let k = 0; k < 12; k++) {
      const z = ((k / 12) - d.ringT + 1) % 1 + 0.02;
      const rr = Math.min(W, H) * 0.08 / z;
      c.strokeStyle = `rgba(30,15,5,${Math.min(0.5, (1 - z) * 0.6)})`; c.lineWidth = 3 * dpr / Math.max(0.3, z);
      c.beginPath(); c.ellipse(cx - sx * 300 * dpr * (1 - z), cy - sy * 220 * dpr * (1 - z), rr * 1.3, rr, 0, 0, 7); c.stroke();
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
  const s = text.length > 60 ? text.slice(0, 58) + '…' : text;
  const w = c.measureText(s).width + 12;
  c.fillStyle = 'rgba(255,250,240,.95)'; roundRect(c, x - w / 2, y - 18, w, 16, 6); c.fill();
  c.beginPath(); c.moveTo(x - 4, y - 2); c.lineTo(x, y + 4); c.lineTo(x + 4, y - 2); c.fill();
  c.fillStyle = '#2a1a10'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s, x, y - 10);
  c.restore();
}
function hexToRgb(hex) { const n = parseInt((hex || '#ffffff').slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; }

function makeDirtPattern(ctx) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 160;
  const c = cv.getContext('2d');
  c.fillStyle = '#3b2a1c'; c.fillRect(0, 0, 160, 160);
  for (let k = 0; k < 500; k++) { c.fillStyle = `rgba(${Math.random() < .5 ? '20,12,6' : '90,66,44'},${Math.random() * 0.5})`; const s = 1 + Math.random() * 4; c.fillRect(Math.random() * 160, Math.random() * 160, s, s); }
  for (let k = 0; k < 14; k++) { c.fillStyle = `rgba(110,90,70,${0.3 + Math.random() * 0.3})`; c.beginPath(); c.arc(Math.random() * 160, Math.random() * 160, 2 + Math.random() * 5, 0, 7); c.fill(); }
  for (let k = 0; k < 4; k++) { c.fillStyle = 'rgba(94,200,232,.5)'; c.fillRect(Math.random() * 160, Math.random() * 160, 2, 2); }
  return { pattern: ctx.createPattern(cv, 'repeat') };
}
