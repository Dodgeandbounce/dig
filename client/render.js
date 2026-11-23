// Canvas view: a zoomed cross-section around the ship, plus a full-depth minimap.
// Placeholder art — swap for sprites when the real game view is built.
import { LAYERS, EARTH_CENTER_KM, layerAt } from './shared/constants.js';

const KM_PER_SCREEN = 60; // how many km the main view spans vertically

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let world = null;
  let shownDepth = 0;
  let lastHull = null;
  let flash = 0;
  const rocks = [];
  let t = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    canvas.width = r.width * devicePixelRatio;
    canvas.height = r.height * devicePixelRatio;
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  function set(w) {
    if (lastHull !== null && w.run.hull < lastHull - 0.5) flash = 1;
    lastHull = w.run.hull;
    if (!world || w.run.number !== world.run.number) shownDepth = w.run.depthKm;
    world = w;
  }

  function frame() {
    requestAnimationFrame(frame);
    t += 1 / 60;
    const W = canvas.width, H = canvas.height, s = devicePixelRatio;
    ctx.clearRect(0, 0, W, H);
    if (!world) return;
    const run = world.run;
    const moving = world.status === 'running';
    shownDepth += (run.depthKm - shownDepth) * 0.15;

    // --- strata around the ship ---
    const kmToY = (km) => H * 0.4 + ((km - shownDepth) / KM_PER_SCREEN) * H;
    for (let i = 0; i < LAYERS.length; i++) {
      const top = kmToY(LAYERS[i].fromKm);
      const bot = kmToY(LAYERS[i + 1]?.fromKm ?? EARTH_CENTER_KM);
      if (bot < 0 || top > H) continue;
      ctx.fillStyle = LAYERS[i].color;
      ctx.fillRect(0, top, W, bot - top);
      ctx.fillStyle = 'rgba(0,0,0,.18)';
      const kFrom = Math.max(LAYERS[i].fromKm, Math.floor((shownDepth - KM_PER_SCREEN) / 2) * 2);
      const kTo = Math.min(LAYERS[i + 1]?.fromKm ?? EARTH_CENTER_KM, shownDepth + KM_PER_SCREEN);
      for (let k = kFrom; k < kTo; k += 2) {
        const y = kmToY(k); if (y < -10 || y > H + 10) continue;
        ctx.fillRect(0, y, W, 2 * s);
      }
    }
    if (kmToY(0) > 0) { ctx.fillStyle = '#5c8fbf'; ctx.fillRect(0, 0, W, kmToY(0)); }

    // tunnel above the ship
    const cx = W / 2 + 30 * s, shipY = H * 0.4;
    ctx.fillStyle = 'rgba(10,6,4,.75)';
    ctx.fillRect(cx - 22 * s, Math.max(0, kmToY(0)), 44 * s, shipY - Math.max(0, kmToY(0)));

    // debris
    if (moving && Math.random() < 0.5) rocks.push({ x: cx + (Math.random() - .5) * 50 * s, y: shipY + 40 * s, vx: (Math.random() - .5) * 4 * s, vy: -Math.random() * 4 * s, life: 1 });
    for (let i = rocks.length - 1; i >= 0; i--) {
      const r = rocks[i]; r.x += r.vx; r.y += r.vy; r.vy += .25 * s; r.life -= .03;
      if (r.life <= 0) { rocks.splice(i, 1); continue; }
      ctx.fillStyle = `rgba(30,20,14,${r.life})`; ctx.fillRect(r.x, r.y, 4 * s, 4 * s);
    }

    // --- ship ---
    ctx.save();
    ctx.translate(cx, shipY);
    ctx.fillStyle = '#c9c2b8'; ctx.strokeStyle = '#2a201a'; ctx.lineWidth = 2 * s;
    roundRect(ctx, -20 * s, -36 * s, 40 * s, 44 * s, 6 * s); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5ec8e8'; ctx.fillRect(-10 * s, -26 * s, 20 * s, 10 * s);
    const spin = moving ? t * 12 : 0;
    ctx.fillStyle = '#8f8a84';
    ctx.beginPath(); ctx.moveTo(-20 * s, 8 * s); ctx.lineTo(20 * s, 8 * s); ctx.lineTo(0, 44 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#4b4641';
    for (let i = 0; i < 4; i++) {
      const y = 14 * s + ((i * 8 * s + spin * s) % (28 * s));
      const half = 20 * s * (1 - (y - 8 * s) / (36 * s));
      ctx.beginPath(); ctx.moveTo(-half, y); ctx.lineTo(half, y + 4 * s); ctx.stroke();
    }
    ctx.restore();

    // crew dots on the ship
    const aboard = world.members.filter((m) => m.online);
    aboard.forEach((m, i) => {
      ctx.fillStyle = m.host ? '#f4a340' : '#f1e6da';
      ctx.beginPath(); ctx.arc(cx - 16 * s + (i % 9) * 4 * s, shipY - 40 * s - Math.floor(i / 9) * 5 * s, 1.6 * s, 0, 7); ctx.fill();
    });

    // hit flash
    if (flash > 0) { ctx.fillStyle = `rgba(224,83,58,${flash * .35})`; ctx.fillRect(0, 0, W, H); flash -= .04; }
    if (!moving) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, W, H); }

    // --- minimap ---
    const mx = 16 * s, my = 16 * s, mw = 14 * s, mh = H - 32 * s;
    for (let i = 0; i < LAYERS.length; i++) {
      const a = LAYERS[i].fromKm / EARTH_CENTER_KM, b = (LAYERS[i + 1]?.fromKm ?? EARTH_CENTER_KM) / EARTH_CENTER_KM;
      ctx.fillStyle = LAYERS[i].color; ctx.fillRect(mx, my + a * mh, mw, (b - a) * mh);
    }
    const py = my + (run.depthKm / EARTH_CENTER_KM) * mh;
    ctx.fillStyle = '#fff'; ctx.fillRect(mx - 4 * s, py - 1 * s, mw + 8 * s, 2 * s);
    ctx.font = `${11 * s}px system-ui`; ctx.fillStyle = '#f1e6da';
    ctx.fillText(`${Math.round(run.depthKm).toLocaleString()} km`, mx + mw + 8 * s, py + 4 * s);
    ctx.fillStyle = '#f4c542'; ctx.fillText('★ treasure', mx + mw + 8 * s, my + mh);
    ctx.fillStyle = 'rgba(241,230,218,.6)';
    ctx.fillText(layerAt(run.depthKm).name, W - 130 * s, 24 * s);
  }
  requestAnimationFrame(frame);
  return { set };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
