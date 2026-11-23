// Tiny synth: every sound is generated, no files.
let ac = null, master = null, musicGain = null;
let muted = false;
try { muted = localStorage.getItem('doigo.muted') === '1'; } catch {}
const last = new Map();

export function initAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ac.destination);
    musicGain = ac.createGain(); musicGain.gain.value = 0.12; musicGain.connect(master);
    startMusic();
  } catch { ac = null; }
}
export function toggleMute() { muted = !muted; try { localStorage.setItem('doigo.muted', muted ? '1' : '0'); } catch {} if (master) master.gain.value = muted ? 0 : 0.5; return muted; }
export const isMuted = () => muted;

function tone({ f = 440, f2, type = 'square', dur = 0.1, vol = 0.2, attack = 0.005, noise = false, q, filter }) {
  if (!ac || muted) return;
  const t = ac.currentTime;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let src;
  if (noise) {
    const len = Math.ceil(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    src = ac.createBufferSource(); src.buffer = buf;
  } else {
    src = ac.createOscillator(); src.type = type; src.frequency.setValueAtTime(f, t);
    if (f2) src.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  }
  let node = src;
  if (filter) { const bq = ac.createBiquadFilter(); bq.type = filter; bq.frequency.value = f; if (q) bq.Q.value = q; node.connect(bq); node = bq; }
  node.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur + 0.02);
}

function throttle(key, ms) { const now = performance.now(); if (now - (last.get(key) || 0) < ms) return false; last.set(key, now); return true; }

export const sfx = {
  shot(kind) {
    if (!throttle('shot' + kind, 45)) return;
    if (kind === 'rocket') tone({ f: 300, f2: 80, type: 'sawtooth', dur: 0.25, vol: 0.12 });
    else if (kind === 'coin') tone({ f: 1800, f2: 2400, type: 'square', dur: 0.05, vol: 0.06 });
    else if (kind === 'silenced') tone({ f: 600, dur: 0.05, vol: 0.05, noise: true, filter: 'bandpass' });
    else if (kind === 'turret') tone({ f: 900, f2: 300, type: 'square', dur: 0.05, vol: 0.05 });
    else tone({ f: 1400, dur: 0.07, vol: 0.12, noise: true, filter: 'bandpass', q: 1 });
  },
  eshot() { if (throttle('eshot', 60)) tone({ f: 500, f2: 200, type: 'square', dur: 0.06, vol: 0.05 }); },
  swing() { if (throttle('swing', 60)) tone({ f: 1200, f2: 300, dur: 0.09, vol: 0.06, noise: true, filter: 'highpass' }); },
  hit() { if (throttle('hit', 40)) tone({ f: 180, f2: 60, type: 'square', dur: 0.08, vol: 0.1 }); },
  hurt() { if (throttle('hurt', 120)) tone({ f: 220, f2: 90, type: 'sawtooth', dur: 0.15, vol: 0.14 }); },
  boom(r = 50) { if (!throttle('boom', 70)) return; tone({ f: 400, dur: 0.4 + r / 300, vol: 0.3, noise: true, filter: 'lowpass' }); tone({ f: 90, f2: 30, type: 'sine', dur: 0.4, vol: 0.35 }); },
  pickup(kind) { if (!throttle('pick', 50)) return; if (kind === 'gem') { tone({ f: 1300, dur: 0.06, vol: 0.08, type: 'triangle' }); setTimeout(() => tone({ f: 1950, dur: 0.08, vol: 0.07, type: 'triangle' }), 50); } else if (kind === 'coin') tone({ f: 2200, f2: 2600, dur: 0.06, vol: 0.06, type: 'square' }); else tone({ f: 600, f2: 900, dur: 0.06, vol: 0.06, type: 'triangle' }); },
  clink() { if (throttle('clink', 80)) tone({ f: 2400, dur: 0.03, vol: 0.03, type: 'triangle' }); },
  door() { if (throttle('door', 100)) tone({ f: 300, dur: 0.25, vol: 0.06, noise: true, filter: 'bandpass', q: 3 }); },
  seal() { tone({ f: 200, f2: 120, type: 'square', dur: 0.4, vol: 0.12 }); },
  alarm() { for (let k = 0; k < 3; k++) setTimeout(() => tone({ f: 880, f2: 660, type: 'square', dur: 0.25, vol: 0.08 }), k * 300); },
  dig() { for (let k = 0; k < 4; k++) setTimeout(() => tone({ f: 120 - k * 10, f2: 50, type: 'sine', dur: 0.25, vol: 0.35 }), k * 110); setTimeout(() => tone({ f: 600, dur: 0.6, vol: 0.12, noise: true, filter: 'lowpass' }), 440); },
  pop() { if (throttle('pop', 30)) tone({ f: 900, f2: 1600, type: 'sine', dur: 0.07, vol: 0.1 }); },
  blow() { if (throttle('blow', 80)) tone({ f: 500, f2: 800, type: 'sine', dur: 0.1, vol: 0.05 }); },
  saw() { if (throttle('saw', 90)) tone({ f: 110, f2: 140, type: 'sawtooth', dur: 0.12, vol: 0.1 }); },
  bark() { tone({ f: 500, f2: 300, type: 'sawtooth', dur: 0.08, vol: 0.12 }); setTimeout(() => tone({ f: 520, f2: 280, type: 'sawtooth', dur: 0.08, vol: 0.12 }), 120); },
  zap() { tone({ f: 1800, f2: 200, type: 'sawtooth', dur: 0.15, vol: 0.08 }); },
  clang() { if (throttle('clang', 60)) { tone({ f: 1800, dur: 0.12, vol: 0.08, type: 'triangle' }); tone({ f: 2700, dur: 0.08, vol: 0.05, type: 'triangle' }); } },
  fixed() { tone({ f: 660, dur: 0.08, vol: 0.08, type: 'triangle' }); setTimeout(() => tone({ f: 990, dur: 0.1, vol: 0.08, type: 'triangle' }), 70); },
  slots(win) { for (let k = 0; k < 6; k++) setTimeout(() => tone({ f: 800 + k * 120, dur: 0.04, vol: 0.05, type: 'square' }), k * 50); if (win > 6) setTimeout(() => { for (let k = 0; k < 5; k++) setTimeout(() => tone({ f: 1046 * (1 + k * 0.25), dur: 0.1, vol: 0.08, type: 'triangle' }), k * 70); }, 350); },
  victory() { [523, 659, 784, 1046].forEach((f, k) => setTimeout(() => tone({ f, dur: 0.25, vol: 0.12, type: 'triangle' }), k * 120)); },
  defeat() { [392, 330, 262, 196].forEach((f, k) => setTimeout(() => tone({ f, dur: 0.4, vol: 0.12, type: 'triangle' }), k * 220)); },
  ui() { tone({ f: 900, dur: 0.04, vol: 0.04, type: 'triangle' }); },
  dfire(who, w) { if (w === 'missile') tone({ f: who === 'us' ? 200 : 150, f2: 40, type: 'sawtooth', dur: 0.6, vol: 0.18 }); else tone({ f: who === 'us' ? 700 : 500, f2: 100, type: 'square', dur: 0.2, vol: 0.12 }); },
  impact() { tone({ f: 200, dur: 0.3, vol: 0.25, noise: true, filter: 'lowpass' }); tone({ f: 70, f2: 30, type: 'sine', dur: 0.3, vol: 0.3 }); },
  down() { tone({ f: 400, f2: 100, type: 'triangle', dur: 0.5, vol: 0.12 }); },
  insult() { if (throttle('insult', 300)) tone({ f: 300, f2: 450, type: 'sine', dur: 0.12, vol: 0.05 }); },
};

// ---------------------------------------------------------------------------
// music: a low drone and a beat that speeds up in fights
let intensity = 0, beatTimer = null, step = 0;
export function setIntensity(v) { intensity = v; }
function startMusic() {
  const drone = ac.createOscillator(); drone.type = 'sawtooth'; drone.frequency.value = 55;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
  const dg = ac.createGain(); dg.gain.value = 0.25;
  drone.connect(lp); lp.connect(dg); dg.connect(musicGain); drone.start();
  const lfo = ac.createOscillator(); lfo.frequency.value = 0.07; const lg = ac.createGain(); lg.gain.value = 60; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
  const scale = [55, 65.4, 73.4, 82.4, 98, 110];
  const tick = () => {
    step++;
    if (!muted && ac) {
      const fight = intensity > 0.5;
      if (step % (fight ? 2 : 4) === 0) mtone(fight ? 60 : 50, 0.12, 'sine', 0.5);
      if (fight && step % 4 === 2) mtone(200, 0.05, 'square', 0.12, true);
      if (step % 8 === 0) mtone(scale[(step / 8) % scale.length | 0] * 2, 0.6, 'triangle', 0.2);
    }
    beatTimer = setTimeout(tick, intensity > 0.5 ? 140 : 260);
  };
  tick();
}
function mtone(f, dur, type, vol, noise) {
  const t = ac.currentTime; const g = ac.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let src;
  if (noise) { const len = Math.ceil(ac.sampleRate * dur); const buf = ac.createBuffer(1, len, ac.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; src = ac.createBufferSource(); src.buffer = buf; }
  else { src = ac.createOscillator(); src.type = type; src.frequency.value = f; }
  src.connect(g); g.connect(musicGain); src.start(t); src.stop(t + dur + 0.02);
}
