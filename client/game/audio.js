// Tiny synth: every sound is generated, no files. Every effect is a little different each time
// (pitch, length, loudness), and many have a few variants, so a long fight doesn't sound like a loop.
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
    sfxGain = ac.createGain(); sfxGain.gain.value = 1; sfxGain.connect(master);
    musicGain = ac.createGain(); musicGain.gain.value = 0.12; musicGain.connect(master);
    startMusic();
  } catch { ac = null; }
}
export function toggleMute() { muted = !muted; try { localStorage.setItem('doigo.muted', muted ? '1' : '0'); } catch {} if (master) master.gain.value = muted ? 0 : 0.5; return muted; }
export const isMuted = () => muted;

let noiseBuf = null;
function noise() {
  if (!noiseBuf) { const len = ac.sampleRate * 2; noiseBuf = ac.createBuffer(1, len, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = R() * 2 - 1; }
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loopStart = R(); return s;
}

/** One synth voice. j = random detune (fraction), delay = seconds from now, out = which bus. */
function tone({ f = 440, f2, type = 'square', dur = 0.1, vol = 0.2, attack = 0.005, noise: isNoise = false, q, filter, j = 0.06, delay = 0, out }) {
  if (!ac || muted) return;
  const t = ac.currentTime + delay;
  dur = jit(dur, j * 0.8); vol = jit(vol, 0.15);
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
  node.connect(g); g.connect(out || sfxGain);
  src.start(t, isNoise ? R() : 0); src.stop(t + dur + 0.02);
}

function throttle(key, ms) { const now = performance.now(); if (now - (last.get(key) || 0) < ms) return false; last.set(key, now); return true; }

// a short "voice" per class: speech bubbles get a little chirp in that crew member's register
const VOICE = {
  pilot: [520, 'triangle'], engineer: [420, 'square'], urchid: [300, 'sine'], guard: [460, 'square'], chef: [600, 'triangle'],
  mrclean: [220, 'sawtooth'], missiletech: [560, 'square'], commando: [240, 'sawtooth'], farmer: [330, 'triangle'],
  scientist: [700, 'sine'], dog: [480, 'sawtooth'], chameleon: [380, 'sine'], trainer: [500, 'triangle'], jorbal: [800, 'sine'],
  vaelift: [360, 'triangle'], agent: [280, 'sine'], slots: [1000, 'square'],
};

export const sfx = {
  shot(kind) {
    if (!throttle('shot' + kind, 45)) return;
    switch (kind) {
      case 'rocket': tone({ f: 320, f2: 70, type: 'sawtooth', dur: 0.28, vol: 0.12 }); tone({ f: 900, f2: 200, dur: 0.3, vol: 0.06, noise: true, filter: 'bandpass' }); break;
      case 'coin': tone({ f: pick([1800, 2000, 2200]), f2: 2600, type: 'square', dur: 0.05, vol: 0.06 }); break;
      case 'silenced': tone({ f: 600, dur: 0.05, vol: 0.05, noise: true, filter: 'bandpass' }); break;
      case 'turret': tone({ f: 900, f2: 300, type: 'square', dur: 0.05, vol: 0.05, j: 0.12 }); break;
      case 'ppk': tone({ f: 2200, f2: 800, dur: 0.08, vol: 0.12, noise: true, filter: 'bandpass', q: 2 }); tone({ f: 180, f2: 90, type: 'sine', dur: 0.08, vol: 0.12 }); break;
      case 'scrap': tone({ f: 260, f2: 90, type: 'sawtooth', dur: 0.14, vol: 0.12, j: 0.15 }); tone({ f: 1600, dur: 0.06, vol: 0.06, type: 'triangle', delay: 0.02, j: 0.2 }); break;
      default: tone({ f: pick([1200, 1400, 1600]), f2: 500, dur: 0.07, vol: 0.12, noise: true, filter: 'bandpass', q: 1 }); tone({ f: 140, f2: 70, type: 'sine', dur: 0.05, vol: 0.06 });
    }
  },
  eshot() { if (throttle('eshot', 60)) tone({ f: pick([480, 520, 560]), f2: 200, type: 'square', dur: 0.06, vol: 0.05, j: 0.1 }); },
  swing() { if (throttle('swing', 60)) tone({ f: pick([1000, 1200, 1500]), f2: 300, dur: 0.09, vol: 0.06, noise: true, filter: 'highpass', j: 0.15 }); },
  hit() { if (!throttle('hit', 40)) return; const v = R(); if (v < 0.5) tone({ f: 180, f2: 60, type: 'square', dur: 0.08, vol: 0.1, j: 0.15 }); else tone({ f: 700, f2: 150, dur: 0.06, vol: 0.09, noise: true, filter: 'lowpass', j: 0.2 }); },
  hurt() { if (throttle('hurt', 120)) tone({ f: 220, f2: 90, type: 'sawtooth', dur: 0.15, vol: 0.14, j: 0.12 }); },
  boom(r = 50) {
    if (!throttle('boom', 70)) return;
    tone({ f: jit(500, 0.2), f2: 60, dur: 0.4 + r / 300, vol: 0.3, noise: true, filter: 'lowpass' });
    tone({ f: jit(90, 0.15), f2: 30, type: 'sine', dur: 0.4 + r / 500, vol: 0.35 });
    if (r > 60) tone({ f: 2000, f2: 300, dur: 0.5, vol: 0.06, noise: true, filter: 'bandpass', delay: 0.05 }); // debris rattle
  },
  pickup(kind) {
    if (!throttle('pick', 50)) return;
    if (kind === 'gem') { const b = pick([1300, 1400, 1560]); tone({ f: b, dur: 0.06, vol: 0.08, type: 'triangle', j: 0.02 }); tone({ f: b * 1.5, dur: 0.08, vol: 0.07, type: 'triangle', delay: 0.05, j: 0.02 }); }
    else if (kind === 'coin') tone({ f: 2200, f2: 2600, dur: 0.06, vol: 0.06, type: 'square' });
    else if (kind === 'gun') { tone({ f: 300, dur: 0.05, vol: 0.1, type: 'square' }); tone({ f: 200, dur: 0.06, vol: 0.1, type: 'square', delay: 0.07 }); }
    else tone({ f: 600, f2: 900, dur: 0.06, vol: 0.06, type: 'triangle' });
  },
  clink() { if (throttle('clink', 80)) tone({ f: pick([2200, 2400, 2700]), dur: 0.03, vol: 0.03, type: 'triangle' }); },
  door(blast) {
    if (!throttle('door', 100)) return;
    if (blast) { tone({ f: 120, f2: 60, type: 'sawtooth', dur: 0.7, vol: 0.1 }); tone({ f: 200, dur: 0.7, vol: 0.08, noise: true, filter: 'lowpass' }); tone({ f: 80, type: 'sine', dur: 0.2, vol: 0.2, delay: 0.65 }); }
    else tone({ f: 300, dur: 0.25, vol: 0.06, noise: true, filter: 'bandpass', q: 3 });
  },
  seal() { tone({ f: 200, f2: 120, type: 'square', dur: 0.4, vol: 0.12 }); tone({ f: 100, type: 'sine', dur: 0.3, vol: 0.15, delay: 0.35 }); },
  alarm() { for (let k = 0; k < 3; k++) tone({ f: 880, f2: 660, type: 'square', dur: 0.25, vol: 0.08, delay: k * 0.3, j: 0.01 }); },
  dig() { for (let k = 0; k < 4; k++) tone({ f: 120 - k * 10, f2: 50, type: 'sine', dur: 0.25, vol: 0.35, delay: k * 0.11 }); tone({ f: 600, f2: 100, dur: 0.6, vol: 0.12, noise: true, filter: 'lowpass', delay: 0.44 }); },
  pop() { if (throttle('pop', 30)) tone({ f: pick([800, 900, 1100]), f2: 1600, type: 'sine', dur: 0.07, vol: 0.1, j: 0.15 }); },
  blow() { if (throttle('blow', 80)) tone({ f: 500, f2: 800, type: 'sine', dur: 0.1, vol: 0.05, j: 0.2 }); },
  saw() { if (throttle('saw', 90)) { tone({ f: 110, f2: 140, type: 'sawtooth', dur: 0.12, vol: 0.1, j: 0.1 }); tone({ f: 3000, dur: 0.1, vol: 0.02, noise: true, filter: 'highpass' }); } },
  bark() { const f = pick([480, 520, 560]); tone({ f, f2: 300, type: 'sawtooth', dur: 0.08, vol: 0.12 }); tone({ f: f * 1.05, f2: 280, type: 'sawtooth', dur: 0.08, vol: 0.12, delay: 0.12 }); },
  zap() { tone({ f: 1800, f2: 200, type: 'sawtooth', dur: 0.15, vol: 0.08, j: 0.2 }); },
  clang() { if (throttle('clang', 60)) { const f = pick([1600, 1800, 2100]); tone({ f, dur: 0.14, vol: 0.08, type: 'triangle', j: 0.03 }); tone({ f: f * 1.48, dur: 0.09, vol: 0.05, type: 'triangle', j: 0.03 }); } },
  fixed() { tone({ f: 660, dur: 0.08, vol: 0.08, type: 'triangle', j: 0.01 }); tone({ f: 990, dur: 0.1, vol: 0.08, type: 'triangle', delay: 0.07, j: 0.01 }); },
  slots(win) { for (let k = 0; k < 6; k++) tone({ f: 800 + k * 120, dur: 0.04, vol: 0.05, type: 'square', delay: k * 0.05, j: 0.01 }); if (win > 6) for (let k = 0; k < 5; k++) tone({ f: 1046 * (1 + k * 0.25), dur: 0.1, vol: 0.08, type: 'triangle', delay: 0.35 + k * 0.07, j: 0 }); },
  victory() { [523, 659, 784, 1046].forEach((f, k) => tone({ f, dur: 0.25, vol: 0.12, type: 'triangle', delay: k * 0.12, j: 0 })); tone({ f: 1318, dur: 0.5, vol: 0.08, type: 'triangle', delay: 0.5, j: 0 }); },
  defeat() { [392, 330, 262, 196].forEach((f, k) => tone({ f, dur: 0.5, vol: 0.12, type: 'triangle', delay: k * 0.22, j: 0 })); tone({ f: 98, type: 'sine', dur: 1.6, vol: 0.2, delay: 0.9, j: 0 }); },
  ui() { tone({ f: 900, dur: 0.04, vol: 0.04, type: 'triangle', j: 0.02 }); },
  dfire(who, w) {
    if (w === 'missile') { tone({ f: who === 'us' ? 200 : 150, f2: 40, type: 'sawtooth', dur: 0.6, vol: 0.18 }); tone({ f: 1500, f2: 300, dur: 0.6, vol: 0.05, noise: true, filter: 'bandpass' }); }
    else tone({ f: who === 'us' ? 700 : 500, f2: 100, type: 'square', dur: 0.2, vol: 0.12, j: 0.1 });
  },
  impact() { tone({ f: 300, f2: 80, dur: 0.3, vol: 0.25, noise: true, filter: 'lowpass' }); tone({ f: 70, f2: 30, type: 'sine', dur: 0.3, vol: 0.3 }); },
  down() { tone({ f: 400, f2: 100, type: 'triangle', dur: 0.5, vol: 0.12 }); },
  insult() { if (throttle('insult', 300)) { tone({ f: 300, f2: 450, type: 'sine', dur: 0.12, vol: 0.05 }); tone({ f: 450, f2: 250, type: 'sine', dur: 0.15, vol: 0.04, delay: 0.12 }); } },
  // new
  laugh() { for (let k = 0; k < 5; k++) tone({ f: 420 - k * 12, f2: 300, type: 'sawtooth', dur: 0.09, vol: 0.09, delay: k * 0.13, j: 0.05 }); },
  docked() { tone({ f: 60, f2: 30, type: 'sine', dur: 0.8, vol: 0.4 }); tone({ f: 800, f2: 120, dur: 0.9, vol: 0.2, noise: true, filter: 'lowpass' }); for (let k = 0; k < 3; k++) tone({ f: 1400, dur: 0.05, vol: 0.06, type: 'square', delay: 0.5 + k * 0.12 }); },
  fire() { if (throttle('fire', 400)) { tone({ f: 400, f2: 1200, dur: 0.6, vol: 0.12, noise: true, filter: 'bandpass', q: 0.7 }); tone({ f: 90, type: 'sine', dur: 0.3, vol: 0.15 }); } },
  spray() { if (throttle('spray', 120)) tone({ f: 5000, f2: 3000, dur: 0.18, vol: 0.05, noise: true, filter: 'highpass', j: 0.2 }); },
  chirp(cls) {
    if (!cls || !throttle('chirp', 160)) return;
    const [f, type] = VOICE[cls] || [440, 'triangle'];
    const n = 2 + ((R() * 3) | 0);
    for (let k = 0; k < n; k++) tone({ f: f * (0.85 + R() * 0.4), dur: 0.05, vol: 0.035, type, delay: k * 0.06, j: 0.05 });
  },
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
