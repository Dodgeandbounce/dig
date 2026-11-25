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
  ctx.globalAlpha = alpha;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(2, 4, r * 1.1, r * 0.8, 0, 0, 7); ctx.fill();
  if (!a.alive) { drawDead(ctx, a, t); ctx.restore(); return; }
  deadSince.delete(a.id);
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

/**
 * Down! They flip over (a little hop and a full somersault), land belly-up with their legs in the air,
 * X-ed out eyes and their tongue hanging out.
 */
const deadSince = new Map();
function drawDead(ctx, a, t) {
  if (!deadSince.has(a.id)) deadSince.set(a.id, t);
  const k = Math.min(1, (t - deadSince.get(a.id)) / 0.55);
  const r = a.r;
  const hop = Math.sin(k * Math.PI) * r * 1.6;
  ctx.translate(0, -hop);
  ctx.rotate((a.facing || 0) + k * Math.PI * 2 * (a.id % 2 ? 1 : -1) + (k >= 1 ? Math.sin(t * 2 + a.id) * 0.04 : 0));
  if (k < 1) { // still tumbling: draw them normally, spinning
    if (a.cls === 'slots') drawSlotMachine(ctx, a, t); else if (a.cls === 'jorbal') drawDino(ctx, a, t, 0); else if (a.cls === 'dog') drawDog(ctx, a, t, 0); else drawFox(ctx, a, t, 0);
    return;
  }
  // belly-up: a pale tummy, four legs sticking up (wiggling feebly), tail flopped out
  const body = a.cls === 'jorbal' ? '#4cc050' : a.cls === 'dog' ? '#a87850' : a.cls === 'slots' ? '#c0a020' : OUTFIT[a.cls] || FUR;
  ctx.fillStyle = a.cls === 'slots' ? '#c0a020' : FUR; ctx.beginPath(); ctx.ellipse(-r * 1.1, r * 0.2, r * 0.8, r * 0.3, 0.4, 0, 7); ctx.fill();   // tail
  ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 0.95, r * 0.85, 0, 0, 7); ctx.fill();
  ctx.fillStyle = a.cls === 'slots' ? '#fff' : CREAM; ctx.beginPath(); ctx.ellipse(-r * 0.1, 0, r * 0.55, r * 0.5, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = a.cls === 'jorbal' ? '#3aa040' : FUR_DARK; ctx.lineWidth = Math.max(2, r * 0.22); ctx.lineCap = 'round';
  for (const [x, s] of [[-r * 0.5, -1], [-r * 0.5, 1], [r * 0.3, -1], [r * 0.3, 1]]) { const w = Math.sin(t * 9 + x) * r * 0.12; ctx.beginPath(); ctx.moveTo(x, s * r * 0.6); ctx.lineTo(x + w, s * r * 1.25); ctx.stroke(); }
  // head, upside down: X eyes, tongue lolling out the side
  const hx = r * 0.85;
  ctx.fillStyle = a.cls === 'jorbal' ? '#4cc050' : a.cls === 'dog' ? '#b08458' : a.cls === 'slots' ? '#d02040' : FUR;
  ctx.beginPath(); ctx.arc(hx, 0, r * 0.6, 0, 7); ctx.fill();
  ctx.strokeStyle = '#1a1010'; ctx.lineWidth = 1.6;
  for (const s of [-1, 1]) { const ex = hx + r * 0.1, ey = s * r * 0.25, q = r * 0.12; ctx.beginPath(); ctx.moveTo(ex - q, ey - q); ctx.lineTo(ex + q, ey + q); ctx.moveTo(ex + q, ey - q); ctx.lineTo(ex - q, ey + q); ctx.stroke(); }
  const lick = Math.sin(t * 3 + a.id) * r * 0.08;
  ctx.fillStyle = '#ff7a9a'; ctx.beginPath(); ctx.ellipse(hx + r * 0.6, r * 0.3 + lick, r * 0.3, r * 0.16, 0.6, 0, 7); ctx.fill();
  ctx.strokeStyle = '#d04a6a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx + r * 0.45, r * 0.2); ctx.lineTo(hx + r * 0.75, r * 0.42 + lick); ctx.stroke();
  // little stars circling
  ctx.rotate(-((a.facing || 0)));
  ctx.fillStyle = '#ffe680'; ctx.font = `${Math.max(8, r * 0.7)}px system-ui`; ctx.textAlign = 'center';
  for (let k2 = 0; k2 < 3; k2++) { const an = t * 3 + k2 * 2.1; ctx.fillText('✦', Math.cos(an) * r * 1.2, -r * 1.1 + Math.sin(an) * r * 0.4); }
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
  // Bendin's black velvet vest has tails that sweep all the way down to his feet
  if (cls === 'vaelift') {
    const sway = Math.sin(t * 4 + a.id) * r * 0.12;
    ctx.fillStyle = '#141018';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-r * 0.3, s * r * 0.25); ctx.quadraticCurveTo(-r * 1.2, s * r * 0.55 + sway, -r * 2.0, s * r * 0.45 + sway * 1.6); ctx.lineTo(-r * 1.85, s * r * 0.1 + sway); ctx.quadraticCurveTo(-r * 1.0, s * r * 0.15, -r * 0.3, s * r * 0.02); ctx.fill(); }
    ctx.fillStyle = 'rgba(120,90,160,.25)'; ctx.beginPath(); ctx.ellipse(-r * 1.2, sway, r * 0.5, r * 0.1, 0, 0, 7); ctx.fill();   // velvet sheen
  }
  // body (outfit colour)
  const outfit = OUTFIT[cls] || '#888';
  ctx.fillStyle = outfit;
  ctx.beginPath(); ctx.ellipse(-r * 0.15, 0, r * 0.85, r * 0.95, 0, 0, 7); ctx.fill();
  if (cls === 'mrclean') { // MUSCLES
    ctx.fillStyle = FUR; ctx.beginPath(); ctx.arc(0, -r * 0.95, r * 0.42, 0, 7); ctx.arc(0, r * 0.95, r * 0.42, 0, 7); ctx.fill();
  }
  if (cls === 'scientist') { ctx.fillStyle = '#f4f4f4'; ctx.fillRect(-r * 0.9, -r * 0.75, r * 0.9, r * 1.5); }
  if (cls === 'agent') { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-r * 0.5, -r * 0.2); ctx.lineTo(-r * 0.5, r * 0.2); ctx.fill(); ctx.fillStyle = '#c02020'; ctx.fillRect(-r * 0.4, -1.5, r * 0.35, 3); }
  if (cls === 'vaelift') { // khaki undergarment, a black velvet vest laced up the front
    ctx.fillStyle = '#141018'; ctx.beginPath(); ctx.ellipse(-r * 0.2, 0, r * 0.72, r * 0.88, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(140,110,180,.22)'; ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.35, r * 0.35, r * 0.18, -0.4, 0, 7); ctx.fill();
    ctx.fillStyle = '#c8b48a'; ctx.beginPath(); ctx.moveTo(-r * 0.7, -r * 0.12); ctx.lineTo(r * 0.35, -r * 0.2); ctx.lineTo(r * 0.35, r * 0.2); ctx.lineTo(-r * 0.7, r * 0.12); ctx.fill();   // the khaki showing between the laces
    ctx.strokeStyle = '#e8e0d0'; ctx.lineWidth = 1;
    ctx.beginPath(); for (let k = 0; k < 4; k++) { const x = -r * 0.6 + k * r * 0.25; ctx.moveTo(x, -r * 0.18); ctx.lineTo(x + r * 0.22, r * 0.18); ctx.moveTo(x, r * 0.18); ctx.lineTo(x + r * 0.22, -r * 0.18); } ctx.stroke();
  }
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
  vaelift: '#c8b48a', agent: '#1c1c22',
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
      // thieving crews dress the part
      switch (type.hat) {
        case 'pirate': ctx.fillStyle = '#141414'; ctx.beginPath(); ctx.moveTo(r * 0.05, -r * 0.75); ctx.lineTo(r * 0.6, 0); ctx.lineTo(r * 0.05, r * 0.75); ctx.lineTo(-r * 0.15, 0); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillRect(r * 0.15, -r * 0.08, r * 0.12, r * 0.16); ctx.fillStyle = '#111'; ctx.fillRect(r * 0.55, -r * 0.4, r * 0.2, r * 0.18); break;   // tricorn + eyepatch
        case 'hood': ctx.fillStyle = '#2a2a34'; ctx.beginPath(); ctx.arc(r * 0.25, 0, r * 0.6, Math.PI * 0.35, -Math.PI * 0.35); ctx.fill(); break;
        case 'mask': ctx.fillStyle = '#111'; ctx.fillRect(r * 0.45, -r * 0.42, r * 0.2, r * 0.84); break;   // robber's eye mask
        case 'bandana': ctx.fillStyle = '#c02828'; ctx.beginPath(); ctx.moveTo(r * 0.55, -r * 0.45); ctx.lineTo(r * 0.85, 0); ctx.lineTo(r * 0.55, r * 0.45); ctx.fill(); ctx.fillStyle = '#8a6a3a'; ctx.beginPath(); ctx.ellipse(r * 0.1, 0, r * 0.5, r * 0.9, 0, 0, 7); ctx.fill(); break;   // bandana + wide hat
        case 'visor': ctx.fillStyle = 'rgba(80,255,140,.85)'; ctx.fillRect(r * 0.5, -r * 0.45, r * 0.15, r * 0.9); break;
      }
      break;
    }
    case 'stork': { // long legs running, long beak
      const run = Math.sin(t * 22 + m.id) * r * 0.5;
      ctx.strokeStyle = '#e08030'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-r * 0.2, -r * 0.3); ctx.lineTo(-r * 0.2 + run, -r * 1.1); ctx.moveTo(-r * 0.2, r * 0.3); ctx.lineTo(-r * 0.2 - run, r * 1.1); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(-r * 0.2, 0, r * 0.9, r * 0.6, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(-r * 0.7, 0, r * 0.4, r * 0.55, 0, 0, 7); ctx.fill();   // black wingtips
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(r * 0.7, 0, r * 0.35, 0, 7); ctx.fill();
      ctx.fillStyle = '#f08030'; ctx.beginPath(); ctx.moveTo(r * 0.95, -r * 0.1); ctx.lineTo(r * 2.0, 0); ctx.lineTo(r * 0.95, r * 0.1); ctx.fill();
      break;
    }
    case 'rock': { // a walking boulder
      ctx.fillStyle = col; ctx.beginPath(); for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; const v = 0.82 + 0.18 * Math.sin(k * 2.7 + m.id); ctx.lineTo(Math.cos(a) * r * v, Math.sin(a) * r * v); } ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade(col, -25); for (const [x, y, s] of [[-0.3, -0.3, 0.25], [0.2, 0.35, 0.2], [-0.4, 0.3, 0.15]]) { ctx.beginPath(); ctx.arc(x * r, y * r, s * r, 0, 7); ctx.fill(); }
      ctx.fillStyle = shade(col, -10); for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.35, s * r * 1.0, r * 0.38, 0, 7); ctx.fill(); }   // fists
      break;
    }
    case 'berry': { // a giant strawberry, rolling
      ctx.rotate(m.spin || t * 6);
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(r * 1.1, 0); ctx.quadraticCurveTo(r * 0.6, r * 1.1, -r * 0.7, r * 0.75); ctx.quadraticCurveTo(-r * 1.1, 0, -r * 0.7, -r * 0.75); ctx.quadraticCurveTo(r * 0.6, -r * 1.1, r * 1.1, 0); ctx.fill();
      ctx.fillStyle = '#fff4a0'; for (let k = 0; k < 10; k++) { const a = k * 2.4, d = (k % 3 + 1) * r * 0.22; ctx.fillRect(Math.cos(a) * d - 1, Math.sin(a) * d - 1.5, 2, 3); }
      ctx.fillStyle = '#3aa040'; for (let k = 0; k < 5; k++) { const a = Math.PI + (k - 2) * 0.45; ctx.beginPath(); ctx.moveTo(-r * 0.65, 0); ctx.lineTo(-r * 0.65 + Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6); ctx.lineTo(-r * 0.6, 0); ctx.fill(); }
      break;
    }
    case 'virus': { // a spiky green ball with a screaming mouth
      const pul = 1 + Math.sin(t * 14 + m.id) * 0.1;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, r * pul, 0, 7); ctx.fill();
      ctx.strokeStyle = shade(col, -30); ctx.lineWidth = 2; for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 + t; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5); ctx.stroke(); ctx.fillStyle = '#e0ff60'; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 1.5, Math.sin(a) * r * 1.5, 1.6, 0, 7); ctx.fill(); }
      ctx.fillStyle = '#300'; ctx.beginPath(); ctx.ellipse(r * 0.35, 0, r * 0.25, r * 0.35 * (0.6 + 0.4 * Math.abs(Math.sin(t * 9 + m.id))), 0, 0, 7); ctx.fill();
      break;
    }
    case 'leviathan': { // the Leviathan: a vast armoured thing with a ring of tusks, walking through walls
      const pulse = 1 + Math.sin(t * 2.5) * 0.03;
      ctx.scale(pulse, pulse);
      ctx.fillStyle = shade(col, -30);
      for (let k = 0; k < 6; k++) { const a = (k - 2.5) * 0.5 + Math.PI, w2 = Math.sin(t * 3 + k) * 0.15; ctx.save(); ctx.rotate(a + w2); ctx.beginPath(); ctx.ellipse(r * 1.0, 0, r * 0.7, r * 0.22, 0, 0, 7); ctx.fill(); ctx.restore(); }   // legs / tentacles behind
      const gr = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 4, 0, 0, r);
      gr.addColorStop(0, shade(col, 50)); gr.addColorStop(0.6, col); gr.addColorStop(1, shade(col, -40));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.85, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 3; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(-r * 0.2, 0, r * (0.35 + k * 0.15), -1, 1); ctx.stroke(); }   // armour plates
      ctx.fillStyle = '#f0e8d0'; for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(r * 0.75, k * r * 0.18 - 4); ctx.lineTo(r * 1.35, k * r * 0.24); ctx.lineTo(r * 0.75, k * r * 0.18 + 4); ctx.fill(); }   // tusks
      ctx.fillStyle = type.eye; for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(r * 0.45, s * r * 0.4, r * 0.11, 0, 7); ctx.fill(); }
      ctx.restore(); drawMobAfter(ctx, m, r, t); return;
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
export function drawStation(ctx, room, t, active, lux) {
  if (room.type === 'lounge') return drawLounge(ctx, room, t, active, lux || [0, 0, 0]);
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
    case 'engine': { // the engine console: two meshing gears turning against each other, and a rev gauge that bounces
      const sp = broken ? 0 : t * 6;
      for (const [gx, dir] of [[-12, 1], [3, -1]]) {
        ctx.save(); ctx.translate(gx, 0); ctx.rotate(sp * dir + (dir < 0 ? 0.3 : 0));
        ctx.fillStyle = dir > 0 ? '#8a7048' : '#a08a58';
        ctx.beginPath(); for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, rr = k % 2 ? 6 : 8.5; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2a2018'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 7); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(16, 0, 6.5, 0, 7); ctx.fill();
      ctx.strokeStyle = broken ? '#555' : '#ff9a3a'; ctx.lineWidth = 1.5; const nd = Math.PI * (0.8 + (broken ? 0 : 0.5 + 0.25 * Math.sin(t * 9) + 0.1 * Math.sin(t * 23)));
      ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(16 + Math.cos(nd) * 5.5, Math.sin(nd) * 5.5); ctx.stroke();
      ctx.fillStyle = `rgba(255,140,40,${glow})`; ctx.fillRect(-23, -8, 3, 16);
      break;
    }
    case 'locker': ctx.fillStyle = '#4a5a6a'; for (let k = -1; k <= 1; k++) { ctx.fillRect(k * 13 - 5.5, -8, 11, 16); ctx.fillStyle = '#2a3440'; ctx.fillRect(k * 13 - 1, -5, 2, 3); ctx.fillStyle = '#4a5a6a'; } break;
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
/**
 * The Urchid's lounge: a beanbag until the lounge chair is unlocked, then an ever more ridiculous chair
 * (cushions, footrest, a parasol, a massage function), and the coconut juice gets fancier too.
 */
function drawLounge(ctx, room, t, active, lux) {
  const { x, y } = room.station;
  const chair = lux[0] || 0, drink = lux[2] || 0;
  ctx.save(); ctx.translate(x, y + 4);
  if (chair >= 7) ctx.translate(Math.sin(t * 40) * 0.8, 0);   // massage mode: bzzzzz
  if (chair === 0) { // a sad beanbag
    ctx.fillStyle = '#7a5a8a'; ctx.beginPath(); ctx.ellipse(0, 2, 15, 11, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#8a6a9a'; ctx.beginPath(); ctx.ellipse(-3, -1, 8, 5, 0, 0, 7); ctx.fill();
  } else {
    if (chair >= 5) { ctx.fillStyle = `hsl(${(t * 20) % 360},70%,60%)`; ctx.beginPath(); ctx.arc(-6, -14, 22, Math.PI, 0); ctx.fill(); ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-6, -14); ctx.lineTo(-6, 6); ctx.stroke(); }   // parasol
    ctx.fillStyle = '#e080c0'; roundRect(ctx, -18, -9, 34, 18, 7); ctx.fill();          // the chair
    ctx.fillStyle = '#c060a0'; roundRect(ctx, -20, -11, 9, 22, 4); ctx.fill();           // backrest
    if (chair >= 2) { ctx.fillStyle = '#ffe0f0'; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(-12, s * 5, 5, 4, 0, 0, 7); ctx.fill(); } }   // cushions
    if (chair >= 3) { ctx.fillStyle = '#d070b0'; roundRect(ctx, 16, -6, 10, 12, 3); ctx.fill(); }   // footrest
    if (chair >= 4) { ctx.strokeStyle = '#f4c542'; ctx.lineWidth = 1.5; roundRect(ctx, -20, -11, 46, 22, 7); ctx.stroke(); }   // gold trim
  }
  // the drink, on a little table
  const s = 1 + drink * 0.12;
  ctx.translate(26, -10); ctx.scale(s, s);
  ctx.fillStyle = '#5a3a1a'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill();
  if (drink === 0) { ctx.fillStyle = '#ddd'; ctx.fillRect(-2.5, -3, 5, 6); }
  else {
    ctx.fillStyle = '#8a5a2a'; ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, 7); ctx.fill(); ctx.fillStyle = '#f8f0e0'; ctx.beginPath(); ctx.arc(0, 0, 3, 0, 7); ctx.fill();   // a coconut
    ctx.strokeStyle = '#f0f'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(4, -7); ctx.stroke();   // straw
    if (drink >= 3) { ctx.fillStyle = '#40c0f0'; ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-1, -9); ctx.lineTo(1, -4); ctx.fill(); }   // umbrella
    if (drink >= 5) for (let k = 0; k < 3; k++) { const a = t * 9 + k * 2; ctx.fillStyle = '#fff6a0'; ctx.fillRect(-1 + Math.cos(a) * 5, -10 + Math.sin(a) * 3, 1.5, 1.5); }   // sparkler
  }
  ctx.restore();
  if (active) { ctx.strokeStyle = '#f4a340'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y + 4, 30, 0, 7); ctx.stroke(); }
}
// ---------------------------------------------------------------------------
// room furniture: drawn on the floor before the station. Rooms are 10x7 tiles wall to wall: doors sit
// in the middle of each wall and the console in the top-left corner, so the furniture keeps to the
// other corners. (Purely looks: nothing here blocks anyone.)
const DT = 32;
export function drawRoomDecor(ctx, room, t, opts = {}) {
  const X = (room.x0 + 1) * DT, Y = (room.y0 + 1) * DT, W = ((room.w ?? 10) - 1) * DT, H = ((room.h ?? 7) - 1) * DT;
  if (W < 6 * DT || H < 4 * DT) return;   // (crawlways and odd shapes stay bare)
  const broken = room.sys && room.sys.hp <= 0;
  ctx.save();
  switch (room.type) {
    case 'engine': engineDecor(ctx, X, Y, W, H, t, broken); break;
    case 'closet': closetDecor(ctx, X, Y, W, H, t); break;
    case 'quarters': bunksDecor(ctx, X, Y, W, H, opts.colors || []); break;
    case 'lounge': loungeDecor(ctx, X, Y, W, H, t); break;
  }
  ctx.restore();
}

/** A bed or the jukebox from a Deep City (a bed is 1 tile wide, 2 long; the jukebox lights up with the music). */
export function drawFurniture(c, f, t, song) {
  c.save(); c.translate(f.x, f.y);
  if (f.type === 'bed') {
    c.fillStyle = 'rgba(0,0,0,.3)'; c.fillRect(-12, -26, 28, 56);
    c.fillStyle = '#6a4a2a'; c.fillRect(-15, -30, 30, 60);                 // frame
    c.fillStyle = '#e8e0d0'; c.fillRect(-12, -27, 24, 54);                 // sheet
    c.fillStyle = '#5a7ab0'; c.fillRect(-12, -6, 24, 33);                  // quilt
    c.fillStyle = 'rgba(255,255,255,.2)'; for (let k = 0; k < 3; k++) c.fillRect(-12, -2 + k * 10, 24, 2);
    c.fillStyle = '#fff'; c.beginPath(); c.ellipse(0, -19, 9, 5, 0, 0, 7); c.fill();   // pillow
  } else if (f.type === 'jukebox') {
    const on = song > 0;
    c.fillStyle = '#5a2a1a'; c.beginPath(); c.moveTo(-15, 14); c.lineTo(-15, -6); c.arc(0, -6, 15, Math.PI, 0); c.lineTo(15, 14); c.closePath(); c.fill();
    const hue = (t * 90) % 360;
    c.strokeStyle = on ? `hsl(${hue},90%,65%)` : '#7a5a40'; c.lineWidth = 3; c.beginPath(); c.arc(0, -6, 11, Math.PI, 0); c.stroke();
    c.fillStyle = on ? `hsl(${(hue + 120) % 360},80%,60%)` : '#3a2a20'; c.fillRect(-9, 0, 18, 8);
    c.fillStyle = '#d0a050'; for (let k = -1; k <= 1; k++) c.fillRect(k * 6 - 1.5, 10, 3, 3);
    if (on) { c.fillStyle = `hsla(${hue},90%,70%,.9)`; c.font = 'bold 11px system-ui'; c.textAlign = 'center'; c.fillText('♪', Math.sin(t * 3) * 10, -26 - ((t * 20) % 12)); c.fillText('♫', -Math.sin(t * 2.4) * 12, -30 - ((t * 16 + 6) % 12)); }
  }
  c.restore();
}

/** A turbine in the far corner, pipes along the wall, a flywheel and a bank of pumping pistons. */
function engineDecor(c, X, Y, W, H, t, broken) {
  const spin = broken ? 0 : t;
  // pipes along the top wall, from the console to the turbine
  // (from just past the top door to the corner, then down to the turbine below the side door's height)
  c.fillStyle = '#4a4036'; c.fillRect(X + 5.2 * DT, Y + 6, W - 5.2 * DT - 8, 9); c.fillRect(X + W - 18, Y + 6, 9, 1.6 * DT);
  c.fillStyle = '#6a5c4c'; c.fillRect(X + 5.2 * DT, Y + 6, W - 5.2 * DT - 8, 3);
  for (let k = 0; k < 3; k++) { c.fillStyle = '#2a241e'; c.fillRect(X + 5.6 * DT + k * 1.1 * DT, Y + 4, 4, 13); }
  // the turbine (bottom right): a housing, spinning blades, a hot core
  const tx = X + W - 2.0 * DT, ty = Y + H - 1.75 * DT, R = 1.35 * DT;
  c.fillStyle = '#2c2824'; c.beginPath(); c.arc(tx, ty, R + 7, 0, 7); c.fill();
  c.strokeStyle = '#5a5044'; c.lineWidth = 3; c.stroke();
  const hot = broken ? 0 : 0.55 + 0.25 * Math.sin(t * 7);
  const gr = c.createRadialGradient(tx, ty, 2, tx, ty, R);
  gr.addColorStop(0, `rgba(255,190,90,${hot})`); gr.addColorStop(1, 'rgba(120,40,10,0)');
  c.fillStyle = gr; c.beginPath(); c.arc(tx, ty, R, 0, 7); c.fill();
  c.save(); c.translate(tx, ty); c.rotate(spin * 9);
  for (let k = 0; k < 9; k++) {
    c.rotate(Math.PI * 2 / 9);
    c.fillStyle = k % 2 ? '#8a8072' : '#a49886';
    c.beginPath(); c.moveTo(5, -3); c.quadraticCurveTo(R * 0.6, -R * 0.35, R - 2, -2); c.lineTo(R - 2, 4); c.quadraticCurveTo(R * 0.5, 0, 5, 3); c.fill();
  }
  c.restore();
  c.fillStyle = '#3a342c'; c.beginPath(); c.arc(tx, ty, 7, 0, 7); c.fill();
  c.fillStyle = broken ? '#444' : '#f4c542'; c.beginPath(); c.arc(tx, ty, 3, 0, 7); c.fill();
  // flywheel + pistons (bottom left)
  const fx = X + 1.3 * DT, fy = Y + H - 1.3 * DT;
  c.fillStyle = '#3a342c'; c.beginPath(); c.arc(fx, fy, 22, 0, 7); c.fill();
  c.strokeStyle = '#7a6e60'; c.lineWidth = 4; c.beginPath(); c.arc(fx, fy, 18, 0, 7); c.stroke();
  c.save(); c.translate(fx, fy); c.rotate(spin * 5); c.lineWidth = 3; c.strokeStyle = '#9a8c7a';
  for (let k = 0; k < 4; k++) { c.rotate(Math.PI / 2); c.beginPath(); c.moveTo(0, 0); c.lineTo(17, 0); c.stroke(); }
  c.restore();
  for (let k = 0; k < 3; k++) {
    const px = fx + 32 + k * 15, stroke = broken ? 0 : Math.sin(spin * 10 + k * 2.1) * 7;
    c.fillStyle = '#2a2622'; c.fillRect(px - 5, fy - 24, 10, 40);
    c.fillStyle = '#b0a898'; c.fillRect(px - 3.5, fy - 16 + stroke, 7, 14);
    c.fillStyle = '#6a6052'; c.fillRect(px - 5, fy - 24, 10, 4);
  }
  // exhaust flicker
  if (!broken) { c.fillStyle = `rgba(255,140,40,${0.2 + 0.2 * Math.abs(Math.sin(t * 13))})`; c.fillRect(X + W - 14, Y + H - 0.6 * DT, 10, 13); }
}

/** An actual janitor's closet: shelves of cleaning bottles, a mop in a bucket, brooms on a rack, a sink. */
function closetDecor(c, X, Y, W, H, t) {
  // shelves along the top right wall
  const sx = X + W - 3.6 * DT, sy = Y + 4;
  for (let row = 0; row < 2; row++) {
    c.fillStyle = '#5a4430'; c.fillRect(sx, sy + row * 18 + 13, 3.3 * DT, 4);
    for (let k = 0; k < 9; k++) {
      const col = ['#40a0d0', '#e0d040', '#d04040', '#60c060', '#c070d0'][(k + row * 2) % 5];
      const bx = sx + 4 + k * 11.5, h = 9 + ((k * 7 + row * 3) % 4);
      c.fillStyle = col; c.fillRect(bx, sy + row * 18 + 13 - h, 7, h);
      c.fillStyle = '#eee'; c.fillRect(bx + 2, sy + row * 18 + 13 - h - 3, 3, 3);
    }
  }
  // mop bucket (bottom right), the water sloshing a little
  const bx = X + W - 1.6 * DT, by = Y + H - 1.3 * DT;
  c.fillStyle = '#e0c020'; c.beginPath(); c.ellipse(bx, by, 17, 14, 0, 0, 7); c.fill();
  c.fillStyle = '#6a8a90'; c.beginPath(); c.ellipse(bx, by, 12 + Math.sin(t * 2) * 0.8, 9, 0, 0, 7); c.fill();
  c.fillStyle = '#3a3a3a'; c.fillRect(bx - 20, by - 3, 6, 6);
  c.strokeStyle = '#a07a40'; c.lineWidth = 3; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx - 30, by - 36); c.stroke();   // mop handle
  c.fillStyle = '#ddd8c8'; for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(bx - 3 + (k % 3) * 3, by - 2 + (k >> 1) * 2, 3, 0, 7); c.fill(); }
  // broom rack (bottom left wall)
  const rx = X + 6, ry = Y + H - 2.4 * DT;
  c.fillStyle = '#4a3a2a'; c.fillRect(rx, ry, 6, 2 * DT);
  for (let k = 0; k < 3; k++) {
    const yy = ry + 8 + k * 20;
    c.strokeStyle = '#a07a40'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(rx + 4, yy); c.lineTo(rx + 40, yy + 4); c.stroke();
    c.fillStyle = '#d0b060'; c.fillRect(rx + 38, yy - 3, 10, 12);
  }
  // a little sink with a dripping tap
  const kx = X + W - 3.1 * DT, ky = Y + H - 0.9 * DT;
  c.fillStyle = '#c8ccd0'; c.fillRect(kx - 14, ky - 10, 28, 20); c.fillStyle = '#8a9aa0'; c.fillRect(kx - 10, ky - 6, 20, 13);
  c.fillStyle = '#9aa0a8'; c.fillRect(kx - 2, ky - 13, 4, 6);
  const drip = (t * 1.3) % 1; if (drip < 0.7) { c.fillStyle = '#80c8ff'; c.fillRect(kx - 1, ky - 7 + drip * 10, 2, 3); }
}

/** Bunk beds: two mattresses each (the top bunk offset with its shadow), a ladder, pillows, blankets in crew colours. */
function bunksDecor(c, X, Y, W, H, colors) {
  const spots = [   // [x, y, vertical] in tiles from the inside corner
    [0.1, 3.05, true], [1.05, 3.05, true], [W / DT - 1.95, 3.05, true], [W / DT - 0.95, 3.05, true],
    [W / DT - 3.85, 0.1, false], [W / DT - 1.9, 0.1, false],
  ];
  // the big (two-slot) bunk room: more bunks between its doors
  if (W > 12 * DT) spots.push([6.0, 3.05, true], [7.0, 3.05, true], [11.2, 3.05, true], [12.2, 3.05, true], [6.3, 0.1, false], [9.4, 0.1, false]);
  spots.forEach(([sx, sy, vert], k) => {
    const x = X + sx * DT, y = Y + sy * DT, w = vert ? 0.85 * DT : 1.8 * DT, h = vert ? 1.9 * DT : 0.8 * DT;
    const blanket = colors[k * 2] || '#5a4a6a', top = colors[k * 2 + 1] || '#6a5a7a';
    c.fillStyle = '#3a2c22'; c.fillRect(x - 2, y - 2, w + 4, h + 4);                      // frame
    c.fillStyle = blanket; c.fillRect(x, y, w, h);                                       // bottom bunk
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x + 4, y + 4, w, h);                     // the top bunk's shadow
    const ox = vert ? -3 : 0, oy = vert ? 0 : -3;
    c.fillStyle = top; c.fillRect(x + ox, y + oy, w, h);                                 // top bunk
    c.fillStyle = 'rgba(255,255,255,.12)'; c.fillRect(x + ox, y + oy, w, 3);
    c.fillStyle = '#f2ece0';                                                             // pillows
    if (vert) c.fillRect(x + ox + 3, y + 3, w - 6, 8); else c.fillRect(x + 3, y + oy + 3, 9, h - 6);
    c.strokeStyle = '#8a6a4a'; c.lineWidth = 2;                                          // ladder
    if (vert) { c.beginPath(); c.moveTo(x + w + 3, y + 8); c.lineTo(x + w + 3, y + h - 6); c.stroke(); for (let r = 0; r < 4; r++) { c.beginPath(); c.moveTo(x + w, y + 14 + r * 11); c.lineTo(x + w + 5, y + 14 + r * 11); c.stroke(); } }
    else { c.beginPath(); c.moveTo(x + w - 8, y + h + 3); c.lineTo(x + 10, y + h + 3); c.stroke(); for (let r = 0; r < 4; r++) { c.beginPath(); c.moveTo(x + 14 + r * 12, y + h); c.lineTo(x + 14 + r * 12, y + h + 5); c.stroke(); } }
  });
}

/** The Urchid's palm trees, swaying over a little reflecting pool. */
function loungeDecor(c, X, Y, W, H, t) {
  // the pool (bottom left), stone rim, rippling water, a palm's reflection in it
  const px = X + 2.2 * DT, py = Y + H - 1.35 * DT;
  c.fillStyle = '#b8a890'; c.beginPath(); c.ellipse(px, py, 58, 26, 0, 0, 7); c.fill();
  const gr = c.createLinearGradient(px, py - 22, px, py + 22); gr.addColorStop(0, '#3aa8d8'); gr.addColorStop(1, '#1a6aa0');
  c.fillStyle = gr; c.beginPath(); c.ellipse(px, py, 52, 21, 0, 0, 7); c.fill();
  c.save(); c.beginPath(); c.ellipse(px, py, 52, 21, 0, 0, 7); c.clip();
  c.globalAlpha = 0.35; palm(c, px - 30, py - 4 + Math.sin(t * 2) * 1.5, t, 0.8, true); c.globalAlpha = 1;   // its reflection
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 1;
  for (let k = 0; k < 3; k++) { const ph = (t * 0.4 + k / 3) % 1; c.globalAlpha = 1 - ph; c.beginPath(); c.ellipse(px + 14 - k * 18, py + 2, 4 + ph * 18, 2 + ph * 7, 0, 0, 7); c.stroke(); }
  c.globalAlpha = 1;
  c.fillStyle = 'rgba(255,255,255,.5)'; for (let k = 0; k < 4; k++) c.fillRect(px - 30 + k * 17 + Math.sin(t * 3 + k) * 3, py - 9 + (k % 2) * 6, 7, 1.5);
  c.restore();
  // palms in the corners (clear of the doors), and one by the pool
  palm(c, X + W - 1.2 * DT, Y + 1.0 * DT, t, 1.0);
  palm(c, X + W - 1.1 * DT, Y + H - 1.0 * DT, t + 1.7, 1.1);
  palm(c, X + 1.0 * DT, Y + 1.1 * DT, t + 3.1, 0.85);
  palm(c, px - 46, py - 18, t + 0.6, 0.75);
}
function palm(c, x, y, t, s = 1, flat = false) {
  c.save(); c.translate(x, y); c.scale(s, flat ? s * 0.5 : s);
  if (!flat) { c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(6, 8, 26, 12, 0.3, 0, 7); c.fill(); }   // shadow
  c.fillStyle = '#7a5a34'; c.beginPath(); c.arc(0, 0, 6, 0, 7); c.fill();                                       // trunk top
  const sway = Math.sin(t * 1.3) * 0.08;
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 + sway + k * 0.2;
    c.save(); c.rotate(a);
    c.fillStyle = k % 2 ? '#3a9a40' : '#4cb050';
    c.beginPath(); c.moveTo(2, 0); c.quadraticCurveTo(14, -9, 30, -2); c.quadraticCurveTo(16, 4, 2, 2); c.fill();
    c.strokeStyle = 'rgba(20,60,20,.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(3, 1); c.quadraticCurveTo(15, -3, 29, -2); c.stroke();
    c.restore();
  }
  c.fillStyle = '#6a4a20'; for (const [cx, cy] of [[-3, -2], [3, -3], [0, 3]]) { c.beginPath(); c.arc(cx, cy, 3, 0, 7); c.fill(); }   // coconuts
  c.restore();
}

const ICONS = { bridge: 'helm', engine: 'engine', weapons: 'missile', shield: 'bubble', hall: 'feeder', lounge: 'chair', vault: 'vault', kitchen: 'pot',
  closet: 'broom', armory: 'crate', farm: 'crop', lab: 'flask', kennel: 'bone', pen: 'cube', den: 'vent', bubbler: 'bubble', office: 'watch',
  casino: 'slot', guardpost: 'staff', storage: 'crate', quarters: 'locker', corridor: null, power: 'power' };
