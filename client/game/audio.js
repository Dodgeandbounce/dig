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

/**
 * A cartoon voice yelling: a buzzy throat (sawtooth) with a wobble, shaped by two vowel formants, and a
 * puff of breath. f0: pitch, slide: where the pitch ends up, vowel: 'a' 'e' 'i' 'o' 'u', vib: wobble.
 */
const VOWELS = { a: [800, 1200], e: [500, 1900], i: [320, 2400], o: [500, 900], u: [350, 700] };
function yell({ f0 = 300, slide = 0.6, dur = 0.6, vowel = 'a', vib = 6, vibDepth = 0.04, vol = 0.16, delay = 0, wave = 'sawtooth', breath = 0.3 }) {
  if (!ac || muted) return;
  const t = ac.currentTime + delay, v = vol * (place ? place.vol : 1);
  const osc = ac.createOscillator(); osc.type = wave;
  osc.frequency.setValueAtTime(f0, t); osc.frequency.linearRampToValueAtTime(f0 * 1.15, t + dur * 0.15); osc.frequency.exponentialRampToValueAtTime(Math.max(40, f0 * slide), t + dur);
  const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = vib; lg.gain.value = f0 * vibDepth; lfo.connect(lg); lg.connect(osc.frequency);
  const g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.03); g.gain.setValueAtTime(v, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const [f1, f2] = VOWELS[vowel] || VOWELS.a;
  const mix = ac.createGain(); mix.gain.value = 1;
  for (const [f, q, k] of [[f1, 5, 1], [f2, 7, 0.6]]) { const bq = ac.createBiquadFilter(); bq.type = 'bandpass'; bq.frequency.value = f; bq.Q.value = q; const gg = ac.createGain(); gg.gain.value = k * 3; osc.connect(bq); bq.connect(gg); gg.connect(mix); }
  mix.connect(g);
  const p = place?.pan ?? 0;
  if (p && ac.createStereoPanner) { const sp = ac.createStereoPanner(); sp.pan.value = p; g.connect(sp); sp.connect(sfxGain); } else g.connect(sfxGain);
  osc.start(t); lfo.start(t); osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  if (breath) nz({ f: f2, dur: dur * 0.8, vol: vol * breath, filter: 'bandpass', q: 1.5, delay });
}
// each class dies in its own voice
const DEATH_VOICE = {
  pilot: { f0: 330, vowel: 'o', slide: 0.45 }, engineer: { f0: 380, vowel: 'a', slide: 0.5 }, guard: { f0: 260, vowel: 'a', slide: 0.4 },
  chef: { f0: 420, vowel: 'e', slide: 0.5, vib: 9 }, mrclean: { f0: 150, vowel: 'o', slide: 0.6, vol: 0.2 }, missiletech: { f0: 400, vowel: 'a', slide: 0.35 },
  commando: { f0: 170, vowel: 'a', slide: 0.5, vol: 0.2 }, farmer: { f0: 240, vowel: 'u', slide: 0.5, vib: 4 }, scientist: { f0: 520, vowel: 'i', slide: 0.4, vib: 11 },
  dog: { f0: 600, vowel: 'u', slide: 0.4, dur: 0.9, vib: 7 }, chameleon: { f0: 300, vowel: 'e', slide: 0.5, vol: 0.1 }, trainer: { f0: 360, vowel: 'o', slide: 0.4 },
  jorbal: { f0: 700, vowel: 'u', slide: 0.3, wave: 'sine', vib: 14, vibDepth: 0.1 }, vaelift: { f0: 280, vowel: 'o', slide: 0.55, vib: 5 },
  agent: { f0: 210, vowel: 'o', slide: 0.6 }, slots: { f0: 880, vowel: 'i', slide: 0.25, wave: 'square', vib: 20 }, urchid: { f0: 300, vowel: 'a' },
};

export const sfx = {
  /** Down! Every class yells in its own voice (with a thud as they flop over). */
  deathYell(cls) {
    if (!throttle('death', 150)) return;
    const v = DEATH_VOICE[cls] || DEATH_VOICE.pilot;
    yell({ dur: 0.75, vol: 0.17, ...v, f0: jit(v.f0, 0.06) });
    if (cls === 'slots') for (let k = 0; k < 6; k++) metal(1800 - k * 200, 0.12, 0.03);
    tone({ f: 120, f2: 50, type: 'sine', dur: 0.18, vol: 0.22, delay: 0.55 });   // flop
    nz({ f: 500, f2: 120, dur: 0.15, vol: 0.08, filter: 'lowpass', delay: 0.55 });
  },
  /** Every species has its own strange death cry (worked out from its name, so the same kind always sounds the same). */
  creatureDie(seed = 0, big = false) {
    if (!throttle('cdie', 110)) return;
    const s = (k) => ((seed * (k * 7919 + 13)) % 1000) / 1000;
    const vowels = ['a', 'e', 'i', 'o', 'u'];
    const f0 = (big ? 70 : 140) + s(1) * (big ? 160 : 700);
    yell({ f0: jit(f0, 0.05), slide: 0.2 + s(2) * 1.6, dur: (big ? 0.7 : 0.35) + s(3) * 0.4, vowel: vowels[(s(4) * 5) | 0], vib: 3 + s(5) * 25, vibDepth: 0.02 + s(6) * 0.15,
      wave: ['sawtooth', 'square', 'triangle'][(s(7) * 3) | 0], vol: big ? 0.15 : 0.08, breath: s(8) * 0.6 });
    if (s(9) > 0.6) yell({ f0: f0 * (1.3 + s(10)), slide: 0.5, dur: 0.18, vowel: 'i', vol: 0.05, delay: 0.12 + s(11) * 0.2, wave: 'square' });
  },
  chomp() { if (!throttle('chomp', 120)) return; tone({ f: 90, f2: 40, type: 'sine', dur: 0.15, vol: 0.3 }); for (let k = 0; k < 4; k++) nz({ f: 1500 + R() * 2500, dur: 0.03, vol: 0.08, filter: 'bandpass', q: 3, delay: 0.03 + k * 0.04 }); metal(200, 0.3, 0.06); },
  gulp() { yell({ f0: 90, slide: 0.4, dur: 0.6, vowel: 'u', vol: 0.25, wave: 'sine', vib: 3 }); tone({ f: 60, f2: 25, type: 'sine', dur: 0.8, vol: 0.4, delay: 0.3 }); },
  crunch() { if (!throttle('crunch', 90)) return; for (let k = 0; k < 5; k++) nz({ f: 300 + R() * 2200, dur: 0.05, vol: 0.09, filter: 'bandpass', q: 2, delay: k * 0.03 }); tone({ f: 70, f2: 35, type: 'sine', dur: 0.2, vol: 0.2 }); },
  stomp() { if (!throttle('stomp', 400)) return; tone({ f: 48, f2: 25, type: 'sine', dur: 0.5, vol: 0.45 }); nz({ f: 400, f2: 60, dur: 0.5, vol: 0.15, filter: 'lowpass' }); },
  burrow() { if (!throttle('burrow', 200)) return; nz({ f: 200, f2: 1400, dur: 0.5, vol: 0.18, filter: 'bandpass', q: 0.8 }); tone({ f: 60, f2: 40, type: 'sawtooth', dur: 0.5, vol: 0.07 }); },
  splat() { if (!throttle('splat', 80)) return; nz({ f: 900, f2: 200, dur: 0.18, vol: 0.18, filter: 'lowpass' }); tone({ f: 160, f2: 60, type: 'sine', dur: 0.12, vol: 0.15 }); },
  virus() { if (!throttle('virus', 700)) return; for (let k = 0; k < 3; k++) yell({ f0: 900 + R() * 600, slide: 1.3, dur: 0.3, vowel: 'i', vol: 0.05, wave: 'square', vib: 30, vibDepth: 0.1, delay: k * 0.07 }); },
  candy() { [880, 1108, 1318, 1760].forEach((f, k) => tone({ f, dur: 0.12, vol: 0.07, type: 'triangle', delay: k * 0.05, j: 0 })); },
  event(good) { if (good) [660, 880, 990].forEach((f, k) => tone({ f, dur: 0.2, vol: 0.08, type: 'triangle', delay: k * 0.1, j: 0, pan: 0 })); else this.alarm(); },
  mainevent() { for (let k = 0; k < 4; k++) tone({ f: 110, f2: 55, type: 'sawtooth', dur: 0.7, vol: 0.12, delay: k * 0.75, pan: 0 }); yell({ f0: 70, slide: 0.5, dur: 2.2, vowel: 'o', vol: 0.3, vib: 2, delay: 0.4 }); },
  mission() { const was = place; place = null; nz({ f: 3000, f2: 1500, dur: 0.25, vol: 0.05, filter: 'highpass' }); for (let k = 0; k < 3; k++) tone({ f: 1400, dur: 0.05, vol: 0.05, type: 'square', delay: 0.3 + k * 0.12, j: 0 }); place = was; },   // paper slides in, beep beep beep
  fuse() { if (throttle('fuse', 70)) nz({ f: 5000 + R() * 2000, dur: 0.03, vol: 0.03, filter: 'highpass' }); },
  elem(e) { if (!throttle('elem', 120)) return; if (e === 'fire') nz({ f: 400, f2: 1800, dur: 0.25, vol: 0.08, filter: 'bandpass', q: 1 }); else if (e === 'water') nz({ f: 1200, f2: 400, dur: 0.3, vol: 0.08, filter: 'lowpass' }); else if (e === 'electric') this.zap(); else nz({ f: 600, f2: 900, dur: 0.15, vol: 0.05, filter: 'bandpass', q: 2 }); },
  /** A D-shell hitting a bubble: a glassy shimmer and a wobbly bloop. */
  bubbleHit() { tone({ f: 900, f2: 300, type: 'sine', dur: 0.4, vol: 0.12 }); tone({ f: 1800, f2: 700, type: 'sine', dur: 0.3, vol: 0.05, delay: 0.03 }); nz({ f: 6000, dur: 0.15, vol: 0.04, filter: 'highpass' }); },
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
    if (w === 'missile') { // launch thump, then the rocket motor screaming away through the dirt
      tone({ f: who === 'us' ? 70 : 55, f2: 30, type: 'sine', dur: 0.4, vol: 0.25 });
      nz({ f: 300, f2: 2600, dur: 0.9, vol: 0.13, filter: 'bandpass', q: 1.2 });
      tone({ f: 420, f2: 1400, type: 'sawtooth', dur: 0.85, vol: 0.025 });
      nz({ f: 3000, f2: 800, dur: 1.0, vol: 0.05, filter: 'highpass', delay: 0.1 });
    }
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
