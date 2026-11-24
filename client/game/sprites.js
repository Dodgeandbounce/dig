// Procedural art. It's a world of foxes: every crew member is a fox (or a dog, a dinosaur,
// or a literal slot machine), dressed for the job. Top-down, facing where they aim.

const FUR = '#e8843a', FUR_DARK = '#b85e22', CREAM = '#fff1de';

export function drawCrew(ctx, a, t, opts = {}) {
  const { x, y, r } = a;
  ctx.save();
  ctx.translate(x, y);
  let alpha = 1;
  if (a.cloaked) alpha = opts.own ? 0.35 : 0.08 + (a.jitter || 0) * 0.35 * (0.5 + 0.5 * Math.sin(t * 40));
  if (a.phased) alpha = opts.own ? 0.4 : 0;
  if (!a.alive) alpha = 0.5;
  ctx.globalAlpha = alpha;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(2, 4, r * 1.1, r * 0.8, 0, 0, 7); ctx.fill();
  if (!a.alive) { ctx.rotate(1.3); }
  const face = a.facing || 0;
  const bob = a.moving ? Math.sin(t * 16 + a.id) * 1.2 : 0;
  ctx.rotate(face);
  if (a.cls === 'slots') drawSlotMachine(ctx, a, t);
  else if (a.cls === 'jorbal') drawDino(ctx, a, t, bob);
  else if (a.cls === 'dog') drawDog(ctx, a, t, bob);
  else drawFox(ctx, a, t, bob);
  ctx.restore();
  // hurt flash
  if (a.hurtT > 0) { ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#ff4030'; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, 7); ctx.fill(); ctx.restore(); }
  if (a.phased && opts.own) { ctx.save(); ctx.strokeStyle = '#a0a0ff'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(x, y, r + 5 + Math.sin(t * 6) * 2, 0, 7); ctx.stroke(); ctx.restore(); }
}

function drawFox(ctx, a, t, bob) {
  const r = a.r;
  const cls = a.cls;
  // tail (behind)
  const wag = Math.sin(t * 6 + a.id) * 0.4;
  ctx.save(); ctx.rotate(Math.PI + wag * 0.5);
  ctx.fillStyle = FUR; ctx.beginPath(); ctx.ellipse(r * 1.0, 0, r * 0.9, r * 0.38, 0, 0, 7); ctx.fill();
  ctx.fillStyle = CREAM; ctx.beginPath(); ctx.ellipse(r * 1.65, 0, r * 0.32, r * 0.24, 0, 0, 7); ctx.fill();
  ctx.restore();
  // body (outfit colour)
  const outfit = OUTFIT[cls] || '#888';
  ctx.fillStyle = outfit;
  ctx.beginPath(); ctx.ellipse(-r * 0.15, 0, r * 0.85, r * 0.95, 0, 0, 7); ctx.fill();
  if (cls === 'mrclean') { // MUSCLES
    ctx.fillStyle = FUR; ctx.beginPath(); ctx.arc(0, -r * 0.95, r * 0.42, 0, 7); ctx.arc(0, r * 0.95, r * 0.42, 0, 7); ctx.fill();
  }
  if (cls === 'scientist') { ctx.fillStyle = '#f4f4f4'; ctx.fillRect(-r * 0.9, -r * 0.75, r * 0.9, r * 1.5); }
  if (cls === 'agent') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-r * 0.5, -r * 0.2); ctx.lineTo(-r * 0.5, r * 0.2); ctx.fill(); ctx.fillStyle = '#c02020'; ctx.fillRect(-r * 0.4, -1.5, r * 0.35, 3); }
  if (cls === 'vaelift') { ctx.fillStyle = 'rgba(120,110,230,.8)'; ctx.beginPath(); ctx.ellipse(-r * 0.4, 0, r * 0.8, r * 1.15, 0, 0, 7); ctx.fill(); }
  // weapon / tool in hand
  drawTool(ctx, a, t);
  // head
  const hx = r * 0.55 + bob * 0.3;
  ctx.fillStyle = cls === 'chameleon' ? '#4fa06a' : FUR;
  ctx.beginPath(); ctx.arc(hx, 0, r * 0.62, 0, 7); ctx.fill();
  // ears
  ctx.fillStyle = cls === 'chameleon' ? '#3a8050' : FUR_DARK;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(hx - r * 0.25, s * r * 0.2); ctx.lineTo(hx - r * 0.55, s * r * 0.75); ctx.lineTo(hx + r * 0.05, s * r * 0.5); ctx.fill(); }
  // snout
  ctx.fillStyle = CREAM; ctx.beginPath(); ctx.ellipse(hx + r * 0.45, 0, r * 0.32, r * 0.24, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(hx + r * 0.75, 0, r * 0.1, 0, 7); ctx.fill();
  // eyes
  ctx.fillStyle = '#1a1010';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(hx + r * 0.18, s * r * 0.24, r * 0.09, 0, 7); ctx.fill(); }
  drawHat(ctx, a, hx, r, t);
}

const OUTFIT = {
  pilot: '#3d6f96', engineer: '#c97a1e', urchid: '#c070d0', guard: '#4a58c0', chef: '#f0f0f0', mrclean: '#3a9060',
  missiletech: '#c0502a', commando: '#5a6a3a', farmer: '#4a6aa0', scientist: '#d8e8f0', chameleon: '#3a7050', trainer: '#a04040',
  vaelift: '#6a5ad0', agent: '#1c1c22',
};

function drawHat(ctx, a, hx, r, t) {
  switch (a.cls) {
    case 'pilot': // goggles + scarf
      ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hx, 0, r * 0.6, -1.2, 1.2); ctx.stroke();
      ctx.fillStyle = '#9ee6ff'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(hx + r * 0.15, s * r * 0.26, r * 0.15, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#e04040'; ctx.fillRect(-r * 0.2, -r * 0.6, r * 0.25, r * 1.2); break;
    case 'engineer': ctx.fillStyle = '#f4c542'; ctx.beginPath(); ctx.arc(hx - r * 0.1, 0, r * 0.55, Math.PI / 2, -Math.PI / 2); ctx.fill(); ctx.fillRect(hx - r * 0.15, -r * 0.6, r * 0.12, r * 1.2); break;
    case 'urchid': ctx.fillStyle = '#111'; for (const s of [-1, 1]) ctx.fillRect(hx + r * 0.08, s * r * 0.24 - r * 0.12, r * 0.22, r * 0.24); break;
    case 'guard': ctx.fillStyle = '#2a3480'; ctx.beginPath(); ctx.arc(hx - r * 0.05, 0, r * 0.55, Math.PI / 2, -Math.PI / 2); ctx.fill(); ctx.fillStyle = '#f4c542'; ctx.fillRect(-r * 0.3, -r * 0.5, r * 0.18, r * 0.18); break;
    case 'chef': ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(hx - r * 0.25, 0, r * 0.55, 0, 7); ctx.fill(); ctx.strokeStyle = '#ccc'; ctx.lineWidth = 1; ctx.stroke(); break;
    case 'mrclean': ctx.fillStyle = '#e04040'; ctx.fillRect(hx - r * 0.2, -r * 0.62, r * 0.14, r * 1.24); break;
    case 'missiletech': ctx.fillStyle = '#ff8a3a'; ctx.beginPath(); ctx.arc(hx - r * 0.1, 0, r * 0.56, Math.PI / 2, -Math.PI / 2); ctx.fill(); ctx.fillStyle = '#333'; ctx.fillRect(hx + r * 0.05, -r * 0.4, r * 0.1, r * 0.8); break;
    case 'commando': ctx.fillStyle = '#d02828'; ctx.fillRect(hx - r * 0.2, -r * 0.62, r * 0.16, r * 1.24); ctx.beginPath(); ctx.moveTo(hx - r * 0.3, r * 0.5); ctx.lineTo(hx - r * 0.9, r * 0.8); ctx.lineTo(hx - r * 0.25, r * 0.65); ctx.fill(); break;
    case 'farmer': ctx.fillStyle = '#e8c860'; ctx.beginPath(); ctx.arc(hx - r * 0.1, 0, r * 0.85, 0, 7); ctx.fill(); ctx.fillStyle = '#c8a040'; ctx.beginPath(); ctx.arc(hx - r * 0.1, 0, r * 0.45, 0, 7); ctx.fill(); break;
    case 'scientist': ctx.fillStyle = 'rgba(140,220,255,.85)'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(hx + r * 0.2, s * r * 0.25, r * 0.16, 0, 7); ctx.fill(); } ctx.fillStyle = '#aaa'; ctx.beginPath(); ctx.arc(hx - r * 0.35, 0, r * 0.3, 0, 7); ctx.fill(); break;
    case 'chameleon': ctx.fillStyle = '#2a5a3a'; ctx.beginPath(); ctx.arc(hx - r * 0.2, 0, r * 0.58, Math.PI / 2, -Math.PI / 2); ctx.fill(); break;
    case 'trainer': ctx.fillStyle = '#d03030'; ctx.beginPath(); ctx.arc(hx - r * 0.05, 0, r * 0.55, Math.PI / 2, -Math.PI / 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(hx - r * 0.15, -r * 0.1, r * 0.2, r * 0.2); break;
    case 'vaelift': ctx.fillStyle = '#4a3ab0'; ctx.beginPath(); ctx.arc(hx - r * 0.15, 0, r * 0.62, Math.PI / 2, -Math.PI / 2); ctx.fill(); break;
    case 'agent': ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(hx - r * 0.15, 0, r * 0.52, Math.PI / 2, -Math.PI / 2); ctx.fill(); break;
  }
}

function drawTool(ctx, a, t) {
  const r = a.r;
  const swing = a.swingT > 0 ? (a.swingT / 0.2) * 1.6 - 0.8 : 0;
  ctx.save();
  ctx.translate(r * 0.2, r * 0.75);
  ctx.rotate(swing);
  const cls = a.cls;
  ctx.lineCap = 'round';
  const gun = (len, col = '#333', w = 3) => { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke(); };
  switch (cls) {
    case 'pilot': gun(r * 0.9); break;
    case 'engineer': ctx.strokeStyle = '#9aa0a8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 1.1, 0); ctx.stroke(); ctx.beginPath(); ctx.arc(r * 1.2, 0, 3, 0, 7); ctx.stroke(); break;
    case 'urchid': ctx.fillStyle = '#7a5a30'; ctx.beginPath(); ctx.arc(r * 0.4, 0, r * 0.35, 0, 7); ctx.fill(); ctx.strokeStyle = '#f0f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(r * 0.4, 0); ctx.lineTo(r * 0.8, -r * 0.4); ctx.stroke(); break;
    case 'guard': gun(r * 0.8); ctx.translate(0, -r * 1.5); gun(r * 0.8); break;
    case 'chef': ctx.fillStyle = '#ccc'; ctx.fillRect(0, -3, r * 1.0, 7); ctx.fillStyle = '#5a3a1a'; ctx.fillRect(-4, -2, 5, 5); break;
    case 'mrclean': ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 1.4, 0); ctx.stroke(); ctx.fillStyle = '#ccd'; ctx.beginPath(); ctx.moveTo(r * 1.1, -2); ctx.lineTo(r * 1.5, -8); ctx.lineTo(r * 1.6, 6); ctx.fill(); break;
    case 'missiletech': gun(r * 1.3, '#556', 6); if (a.chainsawOn) { ctx.translate(0, -r * 1.5); ctx.fillStyle = '#e0a020'; ctx.fillRect(0, -3, r * 1.4, 6); ctx.strokeStyle = '#333'; ctx.setLineDash([2, 2]); ctx.lineDashOffset = t * 60; ctx.strokeRect(r * 0.4, -4, r * 1.0, 8); } break;
    case 'commando': gun(r * 1.3, '#2a2a2a', 4); break;
    case 'farmer': gun(r * 1.2, '#5a4030', 4); break;
    case 'scientist': ctx.fillStyle = a.jar === 'acid' ? '#c0f040' : a.jar === 'explosive' ? '#ff6020' : a.jar === 'buff' ? '#f4c542' : '#a050e0'; ctx.fillRect(0, -4, 7, 9); break;
    case 'chameleon': ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.8, 0); ctx.stroke(); break;
    case 'trainer': ctx.fillStyle = '#e0e0e0'; ctx.fillRect(0, -4, 8, 8); ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(r, r * 0.6, r * 1.6, 0); ctx.stroke(); break;
    case 'vaelift': { const f = a.form || 'staff'; ctx.strokeStyle = '#d0d0ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-r * 0.4, 0); ctx.lineTo(r * (f === 'blade' ? 1.5 : 1.3), 0); ctx.stroke(); ctx.fillStyle = '#80f0ff'; ctx.beginPath(); ctx.arc(r * 1.3, 0, f === 'staff' ? 4 : 2, 0, 7); ctx.fill(); break; }
    case 'agent': gun(r * 0.7, '#111', 3); break;
  }
  ctx.restore();
}

function drawDog(ctx, a, t, bob) {
  const r = a.r;
  const wag = Math.sin(t * 14) * 0.5;
  ctx.save(); ctx.rotate(Math.PI + wag); ctx.strokeStyle = '#8a6040'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(r * 0.8, 0); ctx.lineTo(r * 1.5, 0); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#a87850'; ctx.beginPath(); ctx.ellipse(-r * 0.2, 0, r * 1.05, r * 0.7, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#7a5030'; ctx.beginPath(); ctx.arc(-r * 0.4, r * 0.2, r * 0.3, 0, 7); ctx.fill();
  const hx = r * 0.85;
  ctx.fillStyle = '#b08458'; ctx.beginPath(); ctx.arc(hx, 0, r * 0.55, 0, 7); ctx.fill();
  ctx.fillStyle = '#6a4428'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(hx - r * 0.2, s * r * 0.55, r * 0.35, r * 0.18, s * 0.4, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(hx + r * 0.55, 0, r * 0.13, 0, 7); ctx.fill();
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(hx + r * 0.15, s * r * 0.22, r * 0.08, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#e04040'; ctx.fillRect(hx - r * 0.55, -r * 0.45, r * 0.15, r * 0.9); // collar
}

function drawDino(ctx, a, t, bob) {
  const r = a.r;
  ctx.fillStyle = '#3aa040'; ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.3); ctx.lineTo(-r * 1.6, 0); ctx.lineTo(-r * 0.6, r * 0.3); ctx.fill();
  ctx.fillStyle = '#4cc050'; ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 0.9, r * 0.85, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#e8f0a0'; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.5, r * 0.55, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#e05050'; for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.arc(-r * 0.4 + k * r * 0.35, 0, r * 0.14, 0, 7); ctx.fill(); }
  const hx = r * 0.7;
  ctx.fillStyle = '#4cc050'; ctx.beginPath(); ctx.arc(hx, 0, r * 0.6, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(hx + r * 0.15, s * r * 0.3, r * 0.2, 0, 7); ctx.fill(); }
  ctx.fillStyle = '#111'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(hx + r * 0.22, s * r * 0.3, r * 0.1, 0, 7); ctx.fill(); }
  if (a.cd && a.cd.fire > 0.2) { ctx.fillStyle = 'rgba(160,230,255,.7)'; ctx.beginPath(); ctx.arc(hx + r * 0.85, 0, r * 0.25, 0, 7); ctx.fill(); }
}

function drawSlotMachine(ctx, a, t) {
  const r = a.r;
  ctx.rotate(-(a.facing || 0)); // the slot machine doesn't turn, it rolls
  if (a.dashT > 0) ctx.rotate(t * 25);
  ctx.fillStyle = '#c0a020'; roundRect(ctx, -r, -r * 1.1, r * 2, r * 2.2, 4); ctx.fill();
  ctx.fillStyle = '#d02040'; ctx.fillRect(-r * 0.9, -r * 1.05, r * 1.8, r * 0.45);
  ctx.fillStyle = '#fff'; ctx.fillRect(-r * 0.8, -r * 0.45, r * 1.6, r * 0.8);
  const syms = a.lastSpin?.reels?.slice(0, 3) || ['7', '7', '7'];
  ctx.fillStyle = '#c00'; ctx.font = `bold ${r * 0.6}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  syms.forEach((s, k) => ctx.fillText(s === '7' ? '7' : s === '💎' ? '◆' : s === '🍒' ? '●' : s === '🦊' ? 'F' : '⚒', -r * 0.53 + k * r * 0.53, -r * 0.05));
  ctx.fillStyle = '#333'; ctx.fillRect(r * 0.9, -r * 0.5, r * 0.25, r * 0.15);
  ctx.fillStyle = '#e02020'; ctx.beginPath(); ctx.arc(r * 1.15, -r * 0.8, r * 0.18, 0, 7); ctx.fill();
}

// ---------------------------------------------------------------------------
// enemies (random races and builds), creatures and the boss
export function drawMob(ctx, m, type, t, opts = {}) {
  const r = m.r;
  ctx.save();
  ctx.translate(m.x, m.y);
  if (m.trapped) ctx.globalAlpha = 0.8;
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(2, 4, r * 1.1, r * 0.8, 0, 0, 7); ctx.fill();
  if (m.marked) { ctx.strokeStyle = '#f4c542'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.lineDashOffset = -t * 20; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  if (m.team === 'crew' && !m.isJoe) { ctx.strokeStyle = '#7cc46a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, 7); ctx.stroke(); }
  // stuck in a bubble: they go red with panic and their eyes go wide (and they wobble)
  const trapped = !!m.trapped;
  if (trapped) ctx.rotate(Math.sin(t * 9 + m.id) * 0.25);
  ctx.rotate(m.facing || 0);
  const col = m.angryT > 0 ? '#e03030' : trapped ? mix(type.color, '#ff2a2a', 0.55) : type.color;
  const walk = Math.sin(t * 12 + m.id) * 0.25;
  ctx.fillStyle = col;
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1.5;
  if (m.isJoe) { ctx.restore(); drawCrew(ctx, { ...m, cls: 'engineer', id: m.id, facing: m.facing }, t); ctx.save(); ctx.translate(m.x, m.y); ctx.fillStyle = '#fff'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('JOE', 0, -r - 12); ctx.restore(); return; }
  switch (type.body) {
    case 'human': { // other diggers: helmet, shoulders, a lamp
      ctx.fillStyle = shade(col, -20); ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 0.75, r * 1.05, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e0b090'; ctx.beginPath(); ctx.arc(r * 0.3, 0, r * 0.5, 0, 7); ctx.fill();
      ctx.fillStyle = type.race === 'mantle' ? '#3a2020' : '#c8a040'; ctx.beginPath(); ctx.arc(r * 0.2, 0, r * 0.52, Math.PI / 2, -Math.PI / 2); ctx.fill();
      ctx.fillStyle = '#fff6a0'; ctx.beginPath(); ctx.arc(r * 0.05, 0, r * 0.14, 0, 7); ctx.fill();
      for (const s of [-1, 1]) { ctx.fillStyle = shade(col, -40); ctx.beginPath(); ctx.arc(r * 0.1, s * r * 0.95, r * 0.28, 0, 7); ctx.fill(); }
      break;
    }
    case 'spider': {
      ctx.strokeStyle = shade(col, 20); ctx.lineWidth = Math.max(1.5, r * 0.12);
      for (const s of [-1, 1]) for (let k = 0; k < 4; k++) { const a = (k - 1.5) * 0.45 + walk * (k % 2 ? 1 : -1); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(Math.cos(a) * r * 1.1, s * r * 1.3, Math.cos(a) * r * 1.5 - r * 0.2, s * r * 1.7); ctx.stroke(); }
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(-r * 0.45, 0, r * 0.85, r * 0.7, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(r * 0.45, 0, r * 0.45, 0, 7); ctx.fill();
      ctx.fillStyle = '#a02020'; ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(-r * 0.45, -r * 0.25); ctx.lineTo(-r * 0.1, 0); ctx.lineTo(-r * 0.45, r * 0.25); ctx.fill();
      break;
    }
    case 'blob': {
      const wob = 1 + Math.sin(t * 5 + m.id) * 0.08;
      ctx.globalAlpha *= 0.9; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15 * wob, r / wob, 0, 0, 7); ctx.fill(); ctx.globalAlpha = trapped ? 0.8 : 1;
      ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.35, r * 0.25, 0, 7); ctx.fill();
      ctx.fillStyle = shade(col, -35); for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(-r * 0.4 + k * r * 0.35, r * 0.2, r * 0.1, 0, 7); ctx.fill(); }
      break;
    }
    case 'squid': {
      ctx.strokeStyle = shade(col, -25); ctx.lineWidth = Math.max(2, r * 0.18); ctx.lineCap = 'round';
      for (let k = 0; k < 6; k++) { const s = (k - 2.5) * 0.28, w2 = Math.sin(t * 6 + k + m.id) * r * 0.4; ctx.beginPath(); ctx.moveTo(-r * 0.4, s * r * 1.4); ctx.quadraticCurveTo(-r * 1.2, s * r * 1.8 + w2, -r * 1.9, s * r * 2 - w2); ctx.stroke(); }
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(r * 0.1, 0, r * 0.95, r * 0.8, 0, 0, 7); ctx.fill(); ctx.stroke();
      break;
    }
    case 'crystal': {
      ctx.fillStyle = col;
      for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + 0.3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3); ctx.lineTo(Math.cos(a + 0.25) * r * 1.3, Math.sin(a + 0.25) * r * 1.3); ctx.lineTo(Math.cos(a + 0.5) * r * 0.5, Math.sin(a + 0.5) * r * 0.5); ctx.fill(); }
      ctx.fillStyle = shade(col, 40); ctx.beginPath(); ctx.arc(0, 0, r * 0.6, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(-r * 0.3, -r * 0.4, r * 0.18, r * 0.5);
      break;
    }
    case 'eye': { // a floating eyeball with a nerve tail
      ctx.strokeStyle = '#a04040'; ctx.lineWidth = Math.max(2, r * 0.15); ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.quadraticCurveTo(-r * 1.6, walk * 20, -r * 2.2, -walk * 10); ctx.stroke();
      ctx.fillStyle = '#f0e8e0'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.strokeStyle = 'rgba(160,40,40,.6)'; ctx.lineWidth = 1; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(-r * 0.9, (k - 1.5) * r * 0.4); ctx.lineTo(-r * 0.2, (k - 1.5) * r * 0.15); ctx.stroke(); }
      ctx.fillStyle = type.eye; ctx.beginPath(); ctx.arc(r * 0.45, 0, r * (trapped ? 0.55 : 0.4), 0, 7); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(r * 0.55, 0, r * (trapped ? 0.12 : 0.2), 0, 7); ctx.fill();
      ctx.restore(); drawMobAfter(ctx, m, r, t); return;
    }
    case 'hoarder': { // a hulking scrap-golem with a sack of stolen metal on its back
      ctx.fillStyle = '#6a5a40'; ctx.beginPath(); ctx.arc(-r * 0.75, 0, r * 0.7, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9a9aa0'; for (let k = 0; k < 5; k++) ctx.fillRect(-r * 1.1 + k * r * 0.15, -r * 0.4 + (k % 3) * r * 0.2, r * 0.2, r * 0.12);
      ctx.fillStyle = col; roundRect(ctx, -r * 0.6, -r * 0.85, r * 1.5, r * 1.7, r * 0.3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade(col, -30); for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.3, s * r * 1.0, r * 0.45, 0, 7); ctx.fill(); }
      ctx.fillStyle = shade(col, 25); ctx.fillRect(r * 0.2, -r * 0.35, r * 0.55, r * 0.7);
      break;
    }
    case 'round': ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade(col, -30); for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.5, s * r * 0.8, r * 0.35, 0, 7); ctx.fill(); } break;
    case 'long': ctx.beginPath(); ctx.ellipse(0, 0, r * 1.3, r * 0.7, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = shade(col, -40); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-r * 1.2, 0); ctx.quadraticCurveTo(-r * 2, walk * 20, -r * 2.4, 0); ctx.stroke();
      ctx.fillStyle = shade(col, 30); for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.7, s * r * 0.55, r * 0.25, 0, 7); ctx.fill(); } break;
    case 'shell': ctx.beginPath(); ctx.ellipse(0, 0, r * 1.1, r, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = shade(col, -40); ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r * 0.6, 0); ctx.stroke();
      ctx.strokeStyle = shade(col, -20); ctx.lineWidth = 2; for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(-r * 0.4 + k * r * 0.4, s * r * 0.8); ctx.lineTo(-r * 0.5 + k * r * 0.4 + walk * 6, s * r * 1.35); ctx.stroke(); } break;
    case 'worm': for (let k = 3; k >= 0; k--) { ctx.fillStyle = shade(col, -k * 8); ctx.beginPath(); ctx.arc(-k * r * 0.55, Math.sin(t * 6 + k + m.id) * r * 0.25, r * (1 - k * 0.12), 0, 7); ctx.fill(); } break;
    case 'square': ctx.fillRect(-r, -r, r * 2, r * 2); ctx.strokeRect(-r, -r, r * 2, r * 2); ctx.fillStyle = shade(col, -25); ctx.fillRect(-r * 0.6, -r * 0.6, r * 1.2, r * 1.2); break;
    case 'wing': ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, 7); ctx.fill(); ctx.fillStyle = shade(col, -20);
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0, s * r * 0.3); ctx.lineTo(-r * 0.6, s * r * (1.6 + walk)); ctx.lineTo(r * 0.4, s * r * 0.9); ctx.fill(); } break;
    case 'boss': {
      const pulse = 1 + Math.sin(t * 3) * 0.04;
      ctx.scale(pulse, pulse);
      ctx.fillStyle = '#5a1a08'; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + t * 0.4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8); ctx.lineTo(Math.cos(a + 0.2) * r * 1.5, Math.sin(a + 0.2) * r * 1.5); ctx.lineTo(Math.cos(a + 0.4) * r * 0.8, Math.sin(a + 0.4) * r * 0.8); ctx.fill(); }
      const gr = ctx.createRadialGradient(0, 0, 4, 0, 0, r);
      gr.addColorStop(0, '#ffe060'); gr.addColorStop(0.4, '#e05010'); gr.addColorStop(1, '#601808');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff07a'; for (const s of [-1, 0, 1]) { ctx.beginPath(); ctx.arc(r * 0.5, s * r * 0.35, r * 0.12, 0, 7); ctx.fill(); }
      break;
    }
    default: ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  }
  // eyes (wide and white with tiny pupils when they're stuck in a bubble)
  if (type.body !== 'boss') {
    const ex = type.body === 'human' ? r * 0.55 : r * 0.6;
    if (trapped) {
      for (const s of [-1, 1]) {
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ex, s * r * 0.33, Math.max(3, r * 0.3), 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(ex + Math.sin(t * 13 + s) * r * 0.06, s * r * 0.33 + Math.cos(t * 11) * r * 0.05, Math.max(1, r * 0.08), 0, 7); ctx.fill();
      }
    } else {
      ctx.fillStyle = type.eye;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(ex, s * r * 0.3, Math.max(1.5, r * 0.14), 0, 7); ctx.fill(); }
    }
    drawEnemyWeapon(ctx, type.weapon, r, m);
  }
  ctx.restore();
  drawMobAfter(ctx, m, r, t);
}
function drawMobAfter(ctx, m, r, t) {
  if (m.trapped) { ctx.save(); ctx.strokeStyle = 'rgba(160,230,255,.9)'; ctx.fillStyle = 'rgba(255,90,90,.14)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(m.x, m.y, m.trapped.r || r + 6, 0, 7); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#ffdddd'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'center'; if (Math.sin(t * 7 + m.id) > 0) ctx.fillText('!?', m.x, m.y - r - 8); ctx.restore(); }
  if (m.stunT > 0) { ctx.save(); ctx.fillStyle = '#fff'; ctx.font = '10px system-ui'; ctx.textAlign = 'center'; ctx.fillText('✦ ✦', m.x + Math.sin(t * 8) * 4, m.y - r - 6); ctx.restore(); }
  if (m.fearT > 0) { ctx.save(); ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('!!', m.x, m.y - r - 6); ctx.restore(); }
  if (m.wild && m.team === 'enemy') { ctx.save(); ctx.strokeStyle = 'rgba(200,255,80,.35)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(m.x, m.y, r + 3, 0, 7); ctx.stroke(); ctx.restore(); }
}
function mix(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = [16, 8, 0].map((s) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function drawEnemyWeapon(ctx, w, r, m) {
  ctx.save(); ctx.translate(r * 0.6, r * 0.75);
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  switch (w) {
    case 'pistol': case 'rifle': ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w === 'rifle' ? r * 1.3 : r * 0.8, 0); ctx.stroke(); break;
    case 'shotgun': ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 1.1, 0); ctx.stroke(); break;
    case 'club': ctx.strokeStyle = '#6a4a2a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 1.2, -r * 0.2); ctx.stroke(); break;
    case 'flamer': ctx.strokeStyle = '#a04020'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r, 0); ctx.stroke(); break;
    case 'bomb': ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(r * 0.4, 0, r * 0.35, 0, 7); ctx.fill(); ctx.fillStyle = '#f80'; ctx.fillRect(r * 0.6, -r * 0.4, 2, 4); break;
    case 'drill': ctx.fillStyle = '#999'; ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(r * 1.3, 0); ctx.lineTo(0, 4); ctx.fill(); break;
    case 'maul': ctx.strokeStyle = '#5a4a3a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 1.1, 0); ctx.stroke(); ctx.fillStyle = '#6a6a70'; ctx.fillRect(r * 0.9, -r * 0.35, r * 0.5, r * 0.7); break;
    case 'harpoon': ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 1.4, 0); ctx.stroke(); ctx.fillStyle = '#bbb'; ctx.beginPath(); ctx.moveTo(r * 1.4, -3); ctx.lineTo(r * 1.8, 0); ctx.lineTo(r * 1.4, 3); ctx.fill(); break;
    case 'spit': ctx.fillStyle = 'rgba(160,240,60,.7)'; ctx.beginPath(); ctx.arc(r * 0.2, -r * 0.75, r * 0.25, 0, 7); ctx.fill(); break;
    case 'laser': ctx.strokeStyle = '#4a4a5a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 1.1, 0); ctx.stroke(); ctx.fillStyle = '#ff4040'; ctx.beginPath(); ctx.arc(r * 1.1, 0, 2, 0, 7); ctx.fill(); break;
    case 'sack': ctx.fillStyle = '#a08050'; ctx.beginPath(); ctx.arc(-r * 0.9, -r * 0.4, r * 0.5, 0, 7); ctx.fill(); break;
  }
  ctx.restore();
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, v + amt)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------------------------------------------------------------------------
// station icons (top-down furniture)
export function drawStation(ctx, room, t, active) {
  const { x, y } = room.station;
  const icon = room.type === 'core' ? 'core' : room.type === 'pod' ? 'pod' : ICONS[room.type] || room.type;
  const broken = room.sys && room.sys.hp <= 0;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = broken ? '#2a2020' : '#2e3438';
  roundRect(ctx, -24, -10, 48, 22, 4); ctx.fill();
  ctx.strokeStyle = broken ? '#802020' : active ? '#f4a340' : '#55606a'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.translate(0, 1);
  const glow = broken ? 0 : 0.6 + 0.4 * Math.sin(t * 3 + x);
  switch (icon) {
    case 'helm': ctx.strokeStyle = '#c8a060'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.stroke(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + t * 0.3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 11, Math.sin(a) * 11); ctx.stroke(); } ctx.fillStyle = `rgba(90,200,255,${glow})`; ctx.fillRect(-20, -7, 6, 12); ctx.fillRect(14, -7, 6, 12); break;
    case 'engine': ctx.fillStyle = '#7a6040'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill(); ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2; for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + t * (broken ? 0 : 8); ctx.beginPath(); ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3); ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); ctx.stroke(); } ctx.fillStyle = `rgba(255,140,40,${glow})`; ctx.fillRect(-21, -5, 7, 10); ctx.fillRect(14, -5, 7, 10); break;
    case 'missile': ctx.fillStyle = '#c04020'; for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(-14, k * 6 - 2); ctx.lineTo(10, k * 6 - 2); ctx.lineTo(16, k * 6); ctx.lineTo(10, k * 6 + 2); ctx.lineTo(-14, k * 6 + 2); ctx.fill(); } break;
    case 'bubble': ctx.strokeStyle = `rgba(120,220,255,${glow})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 9 + Math.sin(t * 4) * 1.5, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 4, 0, 7); ctx.stroke(); break;
    case 'feeder': ctx.fillStyle = '#6a6050'; ctx.beginPath(); ctx.moveTo(-14, -8); ctx.lineTo(14, -8); ctx.lineTo(5, 8); ctx.lineTo(-5, 8); ctx.fill(); ctx.fillStyle = '#5ec8e8'; ctx.beginPath(); ctx.arc(0, -2 + ((t * 20) % 8), 2, 0, 7); ctx.fill(); break;
    case 'chair': ctx.fillStyle = '#e080c0'; roundRect(ctx, -12, -8, 24, 16, 6); ctx.fill(); ctx.fillStyle = '#7a5030'; ctx.beginPath(); ctx.arc(16, -4, 4, 0, 7); ctx.fill(); ctx.strokeStyle = '#f0f'; ctx.beginPath(); ctx.moveTo(16, -4); ctx.lineTo(19, -10); ctx.stroke(); break;
    case 'vault': ctx.fillStyle = '#8a8a50'; ctx.beginPath(); ctx.arc(0, 0, 10, 0, 7); ctx.fill(); ctx.strokeStyle = '#3a3a20'; ctx.lineWidth = 2; for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + t * 0.5; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9); ctx.stroke(); } if (room.reinforced > 0) { ctx.strokeStyle = '#7c8cff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 13, 0, 7); ctx.stroke(); } break;
    case 'pot': ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(-8, 0, 7, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(9, 0, 7, 0, 7); ctx.fill(); ctx.fillStyle = `rgba(255,120,40,${glow})`; ctx.beginPath(); ctx.arc(-8, 0, 4, 0, 7); ctx.fill(); break;
    case 'broom': ctx.strokeStyle = '#a07a40'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-14, 6); ctx.lineTo(10, -6); ctx.stroke(); ctx.fillStyle = '#d0b060'; ctx.fillRect(8, -9, 8, 8); ctx.fillStyle = '#40a0d0'; ctx.fillRect(-18, -4, 8, 10); break;
    case 'crate': ctx.fillStyle = '#8a6a3a'; ctx.fillRect(-12, -8, 24, 16); ctx.strokeStyle = '#5a4020'; ctx.strokeRect(-12, -8, 24, 16); ctx.beginPath(); ctx.moveTo(-12, -8); ctx.lineTo(12, 8); ctx.stroke(); break;
    case 'crop': ctx.fillStyle = '#5a4020'; ctx.fillRect(-18, -7, 36, 14); ctx.fillStyle = '#6ac040'; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.arc(k * 7, 0, 3, 0, 7); ctx.fill(); } break;
    case 'flask': for (let k = -1; k <= 1; k++) { ctx.fillStyle = ['#a050e0', '#c0f040', '#ff6020'][k + 1]; ctx.beginPath(); ctx.arc(k * 10, 2, 5, 0, 7); ctx.fill(); ctx.fillRect(k * 10 - 2, -8, 4, 8); } break;
    case 'bone': ctx.fillStyle = '#a06040'; roundRect(ctx, -16, -8, 32, 16, 7); ctx.fill(); ctx.fillStyle = '#eee'; ctx.fillRect(-6, -2, 12, 4); break;
    case 'cube': ctx.fillStyle = '#e0e0e0'; for (let k = -1; k <= 1; k++) ctx.fillRect(k * 10 - 4, -4, 8, 8); ctx.strokeStyle = '#7cc46a'; ctx.strokeRect(-18, -8, 36, 16); break;
    case 'vent': ctx.strokeStyle = '#7a8a80'; ctx.lineWidth = 2; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(k * 5, -7); ctx.lineTo(k * 5, 7); ctx.stroke(); } break;
    case 'watch': ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(t) * 6, Math.sin(t) * 6); ctx.stroke(); break;
    case 'slot': ctx.fillStyle = '#c0a020'; ctx.fillRect(-10, -9, 20, 18); ctx.fillStyle = '#fff'; ctx.fillRect(-8, -4, 16, 8); ctx.fillStyle = '#c00'; ctx.font = 'bold 8px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('777', 0, 0); break;
    case 'staff': ctx.strokeStyle = '#a0a0ff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(-14, 6); ctx.lineTo(14, -6); ctx.stroke(); ctx.fillStyle = '#80f0ff'; ctx.beginPath(); ctx.arc(14, -6, 4, 0, 7); ctx.fill(); break;
    case 'bed': ctx.fillStyle = '#5a4a6a'; ctx.fillRect(-18, -7, 15, 14); ctx.fillRect(3, -7, 15, 14); ctx.fillStyle = '#eee'; ctx.fillRect(-17, -6, 5, 5); ctx.fillRect(4, -6, 5, 5); break;
    case 'core': { const gr = ctx.createRadialGradient(0, 0, 1, 0, 0, 14); gr.addColorStop(0, '#fff07a'); gr.addColorStop(1, 'rgba(200,60,10,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.fill(); break; }
    case 'pod': ctx.fillStyle = '#5a6a7a'; ctx.beginPath(); ctx.ellipse(0, 0, 16, 8, 0, 0, 7); ctx.fill(); break;
    case 'quarters': ctx.fillStyle = '#5a4a6a'; ctx.fillRect(-18, -7, 15, 14); ctx.fillRect(3, -7, 15, 14); break;
    case 'power': { // a humming power core
      ctx.fillStyle = '#2a3a24'; ctx.fillRect(-16, -8, 32, 16);
      for (let k = 0; k < 3; k++) { ctx.fillStyle = `rgba(140,255,90,${broken ? 0.1 : 0.4 + 0.5 * Math.abs(Math.sin(t * 4 + k))})`; ctx.fillRect(-13 + k * 9, -6, 7, 12); }
      ctx.strokeStyle = `rgba(200,255,140,${glow})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-14, 0); for (let k = 0; k < 8; k++) ctx.lineTo(-14 + k * 4, (k % 2 ? -4 : 4) * Math.sin(t * 20 + k)); ctx.stroke();
      break;
    }
    default: break;
  }
  ctx.restore();
}
const ICONS = { bridge: 'helm', engine: 'engine', weapons: 'missile', shield: 'bubble', hall: 'feeder', lounge: 'chair', vault: 'vault', kitchen: 'pot',
  closet: 'broom', armory: 'crate', farm: 'crop', lab: 'flask', kennel: 'bone', pen: 'cube', den: 'vent', bubbler: 'bubble', office: 'watch',
  casino: 'slot', guardpost: 'staff', storage: 'crate', quarters: 'bed', corridor: null, power: 'power' };
