// Tiny synth: every sound is generated, no files. Sounds aim for the real thing (guns crack and
// thump, explosions roll, wrenches ring, fires crackle) rather than arcade bleeps, and every one is a
// little different each time. Sounds in the world come from where they happen: panned left/right and
// quieter the further away they are (call at(x, y) before playing one).
let ac = null, master = null, musicGain = null, sfxGain = null;
let muted = false;
try { muted = localStorage.getItem('doigo.muted') === '1'; } catch {}
const last = new Map();
const R = Math.random;
const jit = (v, j = 0.08) => v * (1 + (R() - 0.5) * 2 * j);
const pick = (a) => a[(R() * a.length) | 0];

export function initAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ac.destination);
    // a gentle compressor so explosions don't flatten everything else
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    sfxGain = ac.createGain(); sfxGain.gain.value = 1; sfxGain.connect(comp); comp.connect(master);
    musicGain = ac.createGain(); musicGain.gain.value = 0.12; musicGain.connect(master);
    startMusic();
  } catch { ac = null; }
}
export function toggleMute() { muted = !muted; try { localStorage.setItem('doigo.muted', muted ? '1' : '0'); } catch {} if (master) master.gain.value = muted ? 0 : 0.5; return muted; }
export const isMuted = () => muted;

// ---- where sounds come from
const ear = { x: 0, y: 0 };
let place = null;              // { pan, vol } for the sound being played right now
export function setListener(x, y) { ear.x = x; ear.y = y; }
export function at(x, y) {
  if (x == null || y == null || !Number.isFinite(x)) { place = null; return; }
  const dx = x - ear.x, dy = y - ear.y, d = Math.hypot(dx, dy);
  place = { pan: Math.max(-0.85, Math.min(0.85, dx / 520)), vol: Math.max(0.12, Math.min(1, 1.15 - d / 900)) };
}

let noiseBuf = null;
function noise() {
  if (!noiseBuf) { const len = ac.sampleRate * 2; noiseBuf = ac.createBuffer(1, len, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = R() * 2 - 1; }
  const s = ac.createBufferSource(); s.buffer = noiseBuf; return s;
}

/**
 * One synth voice. f/f2: start/end frequency (for noise, the filter's). j = random detune,
 * delay = seconds from now, out = which bus. decay: 'exp' (default) or 'lin'.
 */
function tone({ f = 440, f2, type = 'square', dur = 0.1, vol = 0.2, attack = 0.004, noise: isNoise = false, q, filter, j = 0.06, delay = 0, out, pan }) {
  if (!ac || muted) return;
  const t = ac.currentTime + delay;
  dur = jit(dur, j * 0.8); vol = jit(vol, 0.15) * (place ? place.vol : 1);
  const k = 1 + (R() - 0.5) * 2 * j;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let src;
  if (isNoise) src = noise();
  else {
    src = ac.createOscillator(); src.type = type; src.frequency.setValueAtTime(f * k, t);
    if (f2) src.frequency.exponentialRampToValueAtTime(Math.max(20, f2 * k), t + dur);
  }
  let node = src;
  if (filter) { const bq = ac.createBiquadFilter(); bq.type = filter; bq.frequency.setValueAtTime(f * k, t); if (f2 && isNoise) bq.frequency.exponentialRampToValueAtTime(Math.max(40, f2 * k), t + dur); if (q) bq.Q.value = q; node.connect(bq); node = bq; }
  node.connect(g);
  const p = pan ?? place?.pan ?? 0;
  if (p && ac.createStereoPanner) { const sp = ac.createStereoPanner(); sp.pan.value = p; g.connect(sp); sp.connect(out || sfxGain); }
  else g.connect(out || sfxGain);
  src.start(t, isNoise ? R() * 1.5 : 0); src.stop(t + dur + 0.02);
}
const nz = (o) => tone({ ...o, noise: true });

function throttle(key, ms) { const now = performance.now(); if (now - (last.get(key) || 0) < ms) return false; last.set(key, now); return true; }

// a short "voice" per class: speech bubbles get a little chirp in that crew member's register
const VOICE = {
  pilot: [520, 'triangle'], engineer: [420, 'square'], urchid: [300, 'sine'], guard: [460, 'square'], chef: [600, 'triangle'],
  mrclean: [220, 'sawtooth'], missiletech: [560, 'square'], commando: [240, 'sawtooth'], farmer: [330, 'triangle'],
  scientist: [700, 'sine'], dog: [480, 'sawtooth'], chameleon: [380, 'sine'], trainer: [500, 'triangle'], jorbal: [800, 'sine'],
  vaelift: [360, 'triangle'], agent: [280, 'sine'], slots: [1000, 'square'],
};

// ---- building blocks for real-ish sounds
/** A gunshot: the supersonic crack, the body of the blast, a low thump, and the echo off the walls. */
function gunshot({ crack = 2400, body = 1400, thump = 150, size = 1, tail = 0.3 } = {}) {
  nz({ f: crack, dur: 0.035 * size, vol: 0.22, filter: 'highpass', q: 0.7, j: 0.12 });
  nz({ f: body, f2: body * 0.25, dur: 0.14 * size, vol: 0.2 * Math.min(1.4, size), filter: 'lowpass', j: 0.1 });
  tone({ f: thump, f2: thump * 0.3, type: 'sine', dur: 0.12 * size, vol: 0.24, j: 0.08 });
  nz({ f: 700, f2: 180, dur: tail * size, vol: 0.045, filter: 'lowpass', delay: 0.04, j: 0.2 });
}
/** Metal ringing: inharmonic partials, like a struck pipe or a wrench on steel. */
function metal(f, dur = 0.35, vol = 0.07) {
  for (const [m, v] of [[1, 1], [2.76, 0.55], [5.4, 0.3], [8.93, 0.15]]) tone({ f: f * m, type: 'sine', dur: dur / Math.sqrt(m), vol: vol * v, j: 0.01 });
  nz({ f: f * 3, dur: 0.012, vol: vol * 0.8, filter: 'bandpass', q: 3 });
}
function explosion(r = 50) {
  const big = Math.min(2, 0.6 + r / 80);
  tone({ f: jit(85, 0.15), f2: 22, type: 'sine', dur: 0.7 * big, vol: 0.45, j: 0.1 });
  nz({ f: jit(1000, 0.2), f2: 70, dur: 1.0 * big, vol: 0.36, filter: 'lowpass', attack: 0.002 });
  nz({ f: 3000, f2: 600, dur: 0.18, vol: 0.12, filter: 'bandpass', q: 0.6 });
  // debris rattling down afterwards
  for (let k = 0; k < 3 + Math.round(big * 3); k++) nz({ f: 1500 + R() * 3000, dur: 0.03, vol: 0.035, filter: 'bandpass', q: 4, delay: 0.15 + R() * 0.7 * big });
}

export const sfx = {
  shot(kind) {
    if (!throttle('shot' + kind, 45)) return;
    switch (kind) {
      case 'rocket': nz({ f: 300, f2: 2200, dur: 0.45, vol: 0.14, filter: 'bandpass', q: 1.2 }); tone({ f: 90, f2: 40, type: 'sine', dur: 0.3, vol: 0.2 }); nz({ f: 4000, dur: 0.03, vol: 0.12, filter: 'highpass' }); break;
      case 'coin': metal(pick([2200, 2500, 2800]), 0.18, 0.05); nz({ f: 3000, dur: 0.02, vol: 0.06, filter: 'highpass' }); break;
      case 'silenced': nz({ f: 900, f2: 400, dur: 0.07, vol: 0.12, filter: 'bandpass', q: 1.5 }); nz({ f: 4000, dur: 0.01, vol: 0.05, filter: 'highpass' }); tone({ f: 1800, type: 'sine', dur: 0.03, vol: 0.02 }); break;
      case 'turret': nz({ f: 2500, dur: 0.015, vol: 0.08, filter: 'bandpass', q: 5 }); gunshot({ crack: 2800, body: 1600, thump: 180, size: 0.6, tail: 0.15 }); break;
      case 'ppk': gunshot({ crack: 3000, body: 1700, thump: 170, size: 0.8, tail: 0.25 }); break;
      case 'scrap': metal(pick([380, 420, 470]), 0.25, 0.06); gunshot({ crack: 1800, body: 900, thump: 110, size: 1.3, tail: 0.35 }); break;
      case 'bullet': default: gunshot({ crack: pick([2200, 2500, 2800]), body: pick([1200, 1400]), thump: pick([140, 160]), size: 0.9 });
    }
  },
  eshot(w) {
    if (!throttle('eshot' + (w || ''), 60)) return;
    if (w === 'laser') { tone({ f: 2400, f2: 300, type: 'sawtooth', dur: 0.12, vol: 0.05 }); tone({ f: 1200, f2: 200, type: 'sine', dur: 0.14, vol: 0.06 }); return; }
    if (w === 'harpoon') { nz({ f: 400, f2: 1600, dur: 0.18, vol: 0.08, filter: 'bandpass', q: 2 }); tone({ f: 120, f2: 60, type: 'sine', dur: 0.1, vol: 0.12 }); return; }
    if (w === 'spit') { nz({ f: 700, f2: 300, dur: 0.12, vol: 0.09, filter: 'lowpass' }); tone({ f: 300, f2: 140, type: 'sine', dur: 0.08, vol: 0.05 }); return; }
    gunshot({ crack: pick([1800, 2000]), body: 1000, thump: 120, size: w === 'shotgun' ? 1.4 : 0.7, tail: 0.2 });
  },
  swing(cls) {
    if (!throttle('swing', 60)) return;
    const heavy = cls === 'mrclean' || cls === 'pitchfork';
    nz({ f: heavy ? 400 : 700, f2: heavy ? 1400 : 2400, dur: heavy ? 0.16 : 0.1, vol: 0.07, filter: 'bandpass', q: 1.5, j: 0.15 });
  },
  whip() {
    if (!throttle('whip', 90)) return;
    // the swish, then the tip breaks the sound barrier: CRACK
    nz({ f: 300, f2: 1800, dur: 0.12, vol: 0.06, filter: 'bandpass', q: 2 });
    nz({ f: 5000, dur: 0.018, vol: 0.32, filter: 'highpass', delay: 0.1, attack: 0.001 });
    nz({ f: 2400, f2: 900, dur: 0.06, vol: 0.12, filter: 'bandpass', q: 1, delay: 0.105 });
  },
  hit() { if (!throttle('hit', 40)) return; nz({ f: pick([500, 700]), f2: 150, dur: 0.06, vol: 0.1, filter: 'lowpass', j: 0.2 }); tone({ f: 130, f2: 70, type: 'sine', dur: 0.05, vol: 0.1 }); },
  hurt() { if (throttle('hurt', 120)) { nz({ f: 900, f2: 200, dur: 0.1, vol: 0.12, filter: 'lowpass' }); tone({ f: 200, f2: 120, type: 'sine', dur: 0.12, vol: 0.14 }); } },
  boom(r = 50) { if (throttle('boom', 70)) explosion(r); },
  pickup(kind) {
    if (!throttle('pick', 50)) return;
    if (kind === 'gem') { const b = pick([1500, 1700, 1900]); metal(b, 0.25, 0.035); tone({ f: b * 1.5, dur: 0.1, vol: 0.04, type: 'sine', delay: 0.05, j: 0.02 }); }
    else if (kind === 'coin') metal(2600, 0.15, 0.04);
    else if (kind === 'gun') { metal(300, 0.2, 0.06); nz({ f: 2000, dur: 0.02, vol: 0.06, filter: 'bandpass', q: 5, delay: 0.08 }); }
    else nz({ f: 900, f2: 400, dur: 0.06, vol: 0.05, filter: 'lowpass' });
  },
  clink() { if (throttle('clink', 80)) metal(pick([2300, 2600, 3000]), 0.08, 0.02); },
  door(blast) {
    if (!throttle('door', 100)) return;
    if (blast) { // a big motor grinding the slab across, then the slam
      tone({ f: 58, f2: 52, type: 'sawtooth', dur: 0.7, vol: 0.07 }); nz({ f: 350, dur: 0.7, vol: 0.06, filter: 'lowpass' });
      tone({ f: 70, f2: 35, type: 'sine', dur: 0.25, vol: 0.3, delay: 0.62 }); nz({ f: 1200, f2: 200, dur: 0.2, vol: 0.12, filter: 'lowpass', delay: 0.62 });
    } else { nz({ f: 4500, f2: 2500, dur: 0.22, vol: 0.05, filter: 'highpass' }); tone({ f: 110, f2: 70, type: 'sine', dur: 0.08, vol: 0.12, delay: 0.18 }); }
  },
  seal() { nz({ f: 5000, f2: 2000, dur: 0.4, vol: 0.06, filter: 'highpass' }); tone({ f: 80, f2: 40, type: 'sine', dur: 0.3, vol: 0.25, delay: 0.3 }); metal(260, 0.4, 0.05); },
  alarm() { for (let k = 0; k < 3; k++) tone({ f: 620, f2: 880, type: 'sawtooth', dur: 0.32, vol: 0.05, delay: k * 0.38, j: 0.01, pan: 0 }); },
  dig() { for (let k = 0; k < 4; k++) tone({ f: 110 - k * 10, f2: 45, type: 'sine', dur: 0.25, vol: 0.32, delay: k * 0.11 }); nz({ f: 700, f2: 90, dur: 0.8, vol: 0.14, filter: 'lowpass', delay: 0.44 }); },
  pop() { if (throttle('pop', 30)) { tone({ f: pick([700, 850, 1000]), f2: 1800, type: 'sine', dur: 0.05, vol: 0.09, j: 0.15 }); nz({ f: 3000, dur: 0.015, vol: 0.05, filter: 'highpass' }); } },
  blow() { if (throttle('blow', 80)) nz({ f: 600, f2: 1100, dur: 0.12, vol: 0.04, filter: 'bandpass', q: 2, j: 0.2 }); },
  saw() { if (throttle('saw', 90)) { tone({ f: 95, f2: 120, type: 'sawtooth', dur: 0.12, vol: 0.09, j: 0.1 }); nz({ f: 2500, dur: 0.1, vol: 0.04, filter: 'bandpass', q: 1 }); } },
  bark() { const f = pick([420, 470, 520]); for (const d of [0, 0.14]) { tone({ f, f2: 260, type: 'sawtooth', dur: 0.08, vol: 0.09, delay: d }); nz({ f: 1200, f2: 500, dur: 0.07, vol: 0.06, filter: 'bandpass', q: 2, delay: d }); } },
  zap() { nz({ f: 6000, f2: 1500, dur: 0.12, vol: 0.06, filter: 'bandpass', q: 3 }); tone({ f: 120, type: 'square', dur: 0.12, vol: 0.04 }); },
  clang() { if (throttle('clang', 60)) metal(pick([700, 820, 950]), 0.45, 0.08); },
  /** Repairing: a cozy ratchet, tick-tick-tick, with a warm hum under it. */
  gear() {
    if (!throttle('gear', 85)) return;
    const f = pick([1800, 2100, 2400]);
    nz({ f, dur: 0.018, vol: 0.06, filter: 'bandpass', q: 9, j: 0.04 });
    nz({ f: f * 0.6, dur: 0.014, vol: 0.035, filter: 'bandpass', q: 9, delay: 0.04 });
    tone({ f: pick([160, 180]), type: 'triangle', dur: 0.09, vol: 0.018, j: 0.02 });
  },
  fixed() { tone({ f: 190, f2: 120, type: 'sine', dur: 0.12, vol: 0.16 }); nz({ f: 2200, dur: 0.02, vol: 0.07, filter: 'bandpass', q: 6, delay: 0.07 }); metal(520, 0.25, 0.03); },
  slots(win) {
    for (let k = 0; k < 8; k++) nz({ f: 2600, dur: 0.012, vol: 0.05, filter: 'bandpass', q: 8, delay: k * 0.06 });   // the reels clicking round
    for (let k = 0; k < 3; k++) tone({ f: 330, f2: 300, type: 'sine', dur: 0.06, vol: 0.08, delay: 0.5 + k * 0.08 }); // ka-chunk ka-chunk
    if (win > 6) { const n = Math.min(14, 4 + Math.round(win / 10)); for (let k = 0; k < n; k++) metal(1800 + R() * 1400, 0.3, 0.035 + (win > 60 ? 0.02 : 0)); for (let k = 0; k < 5; k++) tone({ f: 1046 * (1 + k * 0.25), dur: 0.12, vol: 0.06, type: 'triangle', delay: 0.75 + k * 0.08, j: 0 }); }
    if (win >= 60) for (let k = 0; k < 18; k++) metal(2000 + R() * 2000, 0.25, 0.03), nz({ f: 5000, dur: 0.01, vol: 0.03, filter: 'highpass', delay: 0.9 + k * 0.05 });
  },
  victory() { [523, 659, 784, 1046].forEach((f, k) => tone({ f, dur: 0.25, vol: 0.12, type: 'triangle', delay: k * 0.12, j: 0, pan: 0 })); tone({ f: 1318, dur: 0.5, vol: 0.08, type: 'triangle', delay: 0.5, j: 0, pan: 0 }); },
  defeat() { [392, 330, 262, 196].forEach((f, k) => tone({ f, dur: 0.5, vol: 0.12, type: 'triangle', delay: k * 0.22, j: 0, pan: 0 })); tone({ f: 98, type: 'sine', dur: 1.6, vol: 0.2, delay: 0.9, j: 0, pan: 0 }); },
  /** Menus: a shovel clanking on rock. */
  ui() { const was = place; place = null; metal(pick([1050, 1150, 1250]), 0.22, 0.05); nz({ f: 800, f2: 300, dur: 0.06, vol: 0.05, filter: 'lowpass' }); place = was; },
  /** Hovering a button: a little scoop of dirt. */
  uiHover() { if (!throttle('hover', 70)) return; const was = place; place = null; nz({ f: pick([500, 650, 800]), f2: 200, dur: 0.07, vol: 0.035, filter: 'lowpass', j: 0.2 }); nz({ f: 2500, dur: 0.01, vol: 0.012, filter: 'bandpass', q: 3, delay: 0.03 }); place = was; },
  dfire(who, w) {
    if (w === 'missile') { nz({ f: 300, f2: 1800, dur: 0.7, vol: 0.12, filter: 'bandpass', q: 1 }); tone({ f: who === 'us' ? 70 : 55, f2: 30, type: 'sine', dur: 0.6, vol: 0.25 }); }
    else { tone({ f: who === 'us' ? 90 : 70, f2: 30, type: 'sine', dur: 0.35, vol: 0.28 }); nz({ f: 1400, f2: 200, dur: 0.3, vol: 0.14, filter: 'lowpass' }); }
  },
  impact() { tone({ f: 70, f2: 28, type: 'sine', dur: 0.4, vol: 0.4, pan: 0 }); nz({ f: 600, f2: 80, dur: 0.45, vol: 0.25, filter: 'lowpass', pan: 0 }); metal(180, 0.6, 0.05); },
  down() { tone({ f: 300, f2: 90, type: 'sine', dur: 0.45, vol: 0.12 }); nz({ f: 600, f2: 150, dur: 0.3, vol: 0.06, filter: 'lowpass' }); },
  insult() { if (throttle('insult', 300)) { tone({ f: 300, f2: 450, type: 'sine', dur: 0.12, vol: 0.05 }); tone({ f: 450, f2: 250, type: 'sine', dur: 0.15, vol: 0.04, delay: 0.12 }); } },
  laugh() { for (let k = 0; k < 5; k++) { tone({ f: 420 - k * 12, f2: 300, type: 'sawtooth', dur: 0.09, vol: 0.06, delay: k * 0.13, j: 0.05 }); nz({ f: 1100, dur: 0.08, vol: 0.03, filter: 'bandpass', q: 3, delay: k * 0.13 }); } },
  docked() { tone({ f: 55, f2: 28, type: 'sine', dur: 0.9, vol: 0.45 }); nz({ f: 900, f2: 100, dur: 1.0, vol: 0.22, filter: 'lowpass' }); metal(140, 1.2, 0.1); for (let k = 0; k < 3; k++) nz({ f: 2500, dur: 0.02, vol: 0.06, filter: 'bandpass', q: 6, delay: 0.5 + k * 0.12 }); },
  fire() { if (throttle('fire', 400)) { nz({ f: 300, f2: 1600, dur: 0.5, vol: 0.12, filter: 'bandpass', q: 0.7 }); tone({ f: 80, type: 'sine', dur: 0.3, vol: 0.12 }); } },
  /** A burning fire: crackles and pops, with a low roar when there's a lot of it. */
  burn(big = 0) {
    nz({ f: 1500 + R() * 3500, dur: 0.012 + R() * 0.02, vol: 0.05 + R() * 0.05, filter: 'bandpass', q: 3 + R() * 4, attack: 0.001 });
    if (R() < 0.3) nz({ f: 800 + R() * 800, dur: 0.03, vol: 0.06, filter: 'bandpass', q: 2, delay: 0.03 });
    if (R() < 0.15 + big * 0.3) nz({ f: 260, f2: 160, dur: 0.35, vol: 0.03 + big * 0.04, filter: 'lowpass' });
  },
  spray() { if (throttle('spray', 120)) nz({ f: 5500, f2: 3500, dur: 0.2, vol: 0.06, filter: 'highpass', j: 0.2 }); },
  chirp(cls) {
    if (!cls || !throttle('chirp', 160)) return;
    const [f, type] = VOICE[cls] || [440, 'triangle'];
    const n = 2 + ((R() * 3) | 0);
    for (let k = 0; k < n; k++) tone({ f: f * (0.85 + R() * 0.4), dur: 0.05, vol: 0.035, type, delay: k * 0.06, j: 0.05 });
  },
  /** An enemy shouting: a rough low gabble. */
  grunt() { if (!throttle('grunt', 250)) return; for (let k = 0; k < 3; k++) { tone({ f: 140 + R() * 80, f2: 100, type: 'sawtooth', dur: 0.07, vol: 0.05, delay: k * 0.08 }); nz({ f: 700, dur: 0.06, vol: 0.03, filter: 'bandpass', q: 3, delay: k * 0.08 }); } },
  dash() { if (!throttle('dash', 60)) return; nz({ f: 900, f2: 200, dur: 0.2, vol: 0.08, filter: 'lowpass' }); nz({ f: 600, f2: 2000, dur: 0.12, vol: 0.04, filter: 'bandpass', q: 1.5 }); },
  caw() { if (!throttle('caw', 200)) return; for (const d of [0, 0.16]) { tone({ f: 950, f2: 620, type: 'sawtooth', dur: 0.12, vol: 0.04, delay: d }); nz({ f: 1300, f2: 900, dur: 0.11, vol: 0.04, filter: 'bandpass', q: 4, delay: d }); } },
  stab() { nz({ f: 6000, f2: 3000, dur: 0.09, vol: 0.12, filter: 'highpass' }); tone({ f: 140, f2: 60, type: 'sine', dur: 0.1, vol: 0.18, delay: 0.04 }); },
  xp() { if (throttle('xp', 400)) { const was = place; place = null; tone({ f: 1320, type: 'sine', dur: 0.12, vol: 0.025, j: 0 }); tone({ f: 1760, type: 'sine', dur: 0.16, vol: 0.02, delay: 0.06, j: 0 }); place = was; } },
  eat() { if (throttle('eat', 300)) for (let k = 0; k < 3; k++) nz({ f: 1200, f2: 500, dur: 0.05, vol: 0.06, filter: 'bandpass', q: 1.5, delay: k * 0.11 }); },
  gunfound() { metal(330, 0.5, 0.06); metal(440, 0.5, 0.05); },
  bang() { if (throttle('bang', 70)) { tone({ f: 110, f2: 60, type: 'sine', dur: 0.12, vol: 0.16 }); nz({ f: 1500, f2: 300, dur: 0.1, vol: 0.08, filter: 'lowpass' }); metal(240, 0.25, 0.03); } },
  claw(big) { if (throttle('claw', 60)) { nz({ f: big ? 1200 : 2200, f2: big ? 400 : 900, dur: big ? 0.12 : 0.07, vol: big ? 0.12 : 0.07, filter: 'bandpass', q: 1.5 }); if (big) tone({ f: 80, f2: 40, type: 'sine', dur: 0.15, vol: 0.2 }); } },
  flame() { if (throttle('flame', 110)) nz({ f: 1200, f2: 500, dur: 0.16, vol: 0.06, filter: 'lowpass' }); },
  vent() { nz({ f: 700, f2: 400, dur: 0.35, vol: 0.06, filter: 'bandpass', q: 2 }); metal(420, 0.3, 0.025); },
  capture() { tone({ f: 300, f2: 1500, type: 'sine', dur: 0.25, vol: 0.07 }); metal(1200, 0.3, 0.04); },
  respawn() { tone({ f: 440, f2: 880, type: 'sine', dur: 0.4, vol: 0.06 }); },
  spark() { if (throttle('spark', 140)) nz({ f: 4000 + R() * 3000, dur: 0.015, vol: 0.035, filter: 'bandpass', q: 5 }); },
};
// ---------------------------------------------------------------------------
// music: a drone that follows the depth, and a beat that speeds up in fights. The song moves
// between sections, and every layer of the earth has its own scale, so it keeps changing.
let intensity = 0, depth = 0, beatTimer = null, step = 0, section = 0;
export function setIntensity(v, tier) { intensity = v; if (tier != null) depth = Math.max(0, Math.min(4, tier)); }
// shallow: bright minor pentatonic; deeper: darker modes; the core: tense phrygian with a flat second
const SCALES = [
  [0, 3, 5, 7, 10, 12], [0, 2, 3, 7, 8, 12], [0, 3, 5, 6, 7, 10], [0, 1, 4, 5, 7, 8], [0, 1, 3, 6, 7, 10],
];
const ROOTS = [55, 52, 49, 46.25, 43.65];
const hz = (root, semis) => root * Math.pow(2, semis / 12);
function startMusic() {
  const drone = ac.createOscillator(); drone.type = 'sawtooth'; drone.frequency.value = 55;
  const drone2 = ac.createOscillator(); drone2.type = 'sine'; drone2.frequency.value = 82.4;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
  const dg = ac.createGain(); dg.gain.value = 0.25;
  drone.connect(lp); drone2.connect(lp); lp.connect(dg); dg.connect(musicGain); drone.start(); drone2.start();
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.07; const lg = ac.createGain(); lg.gain.value = 60; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
  let motif = [0, 2, 4, 2, 1, 3, 5, 3];
  const tick = () => {
    step++;
    const root = ROOTS[depth], scale = SCALES[depth];
    drone.frequency.setTargetAtTime(root, ac.currentTime, 2);
    drone2.frequency.setTargetAtTime(hz(root, 7), ac.currentTime, 2);
    if (step % 64 === 0) { section = (section + 1) % 4; if (R() < 0.6) motif = motif.map(() => (R() * scale.length) | 0); }
    if (!muted && ac) {
      const fight = intensity > 0.5;
      // kick / pulse
      if (step % (fight ? 2 : 4) === 0) mtone(fight ? 60 : 50, 0.12, 'sine', 0.5);
      if (fight) {
        if (step % 4 === 2) mtone(200, 0.05, 'square', 0.12, true);        // snare-ish
        if (step % 2 === 1 && R() < 0.7) mtone(6000, 0.02, 'square', 0.05, true); // hats
        if (step % 4 === 0) mtone(hz(root, scale[[0, 0, 3, 4][section] % scale.length]), 0.18, 'sawtooth', 0.12); // bass line
        if (section % 2 === 1 && step % 2 === 0) mtone(hz(root * 4, scale[motif[(step / 2) % motif.length | 0] % scale.length]), 0.1, 'square', 0.05);
      } else {
        // calm: a slow melody from the motif, sometimes a soft chord
        if (step % 8 === 0) mtone(hz(root * 2, scale[motif[(step / 8) % motif.length | 0] % scale.length]), 0.7, 'triangle', 0.2);
        if (section >= 2 && step % 16 === 4) for (const s of [0, 2, 4]) mtone(hz(root * 4, scale[s % scale.length]), 1.4, 'sine', 0.05);
        if (section === 3 && step % 4 === 2 && R() < 0.4) mtone(hz(root * 8, scale[(R() * scale.length) | 0]), 0.15, 'triangle', 0.04);
      }
    }
    beatTimer = setTimeout(tick, intensity > 0.5 ? 140 - depth * 6 : 260 - depth * 10);
  };
  tick();
}
function mtone(f, dur, type, vol, isNoise) {
  const t = ac.currentTime; const g = ac.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let src, node;
  if (isNoise) { src = noise(); const hp = ac.createBiquadFilter(); hp.type = f > 2000 ? 'highpass' : 'bandpass'; hp.frequency.value = f; src.connect(hp); node = hp; }
  else { src = ac.createOscillator(); src.type = type; src.frequency.value = f; node = src; }
  node.connect(g); g.connect(musicGain); src.start(t, isNoise ? R() : 0); src.stop(t + dur + 0.02);
}
