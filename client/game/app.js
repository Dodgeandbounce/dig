// Solo play: splash → pick your class → dig. The simulation runs right here in the browser,
// with bots playing every crew member you aren't.
import { Game } from '../shared/sim/game.js';
import { CLASSES, CLASS_ORDER, STARTER_CLASSES, SPLASH } from '../shared/sim/data.js';
import { createRenderer } from './render.js';
import { createUI } from './ui.js';
import { initAudio, sfx, setIntensity, toggleMute } from './audio.js';
import { drawCrew } from './sprites.js';

const STEP = 1 / 30;

export function launchSolo(host, { name = '', onExit, quick } = {}) {
  host.innerHTML = '';
  host.classList.add('dig-host');
  const wrap = document.createElement('div');
  wrap.className = 'dig';
  host.append(wrap);
  if (quick && CLASSES[quick]) { initAudio(); startGame(wrap, { playerClass: quick, playerName: name }, onExit, name); return; }
  showSplash(wrap, () => showClassSelect(wrap, name, (opts) => startGame(wrap, opts, onExit, name), onExit));
}

// ---------------------------------------------------------------------------
function showSplash(wrap, next) {
  wrap.innerHTML = `<div class="splash"><h1>Do I Go<span>?</span></h1><p class="tag">${SPLASH}</p><p class="press">click to start</p></div>`;
  const go = () => { initAudio(); removeEventListener('keydown', go); next(); };
  wrap.querySelector('.splash').addEventListener('click', go, { once: true });
  addEventListener('keydown', go, { once: true });
}

function showClassSelect(wrap, name, start, onExit) {
  let pick = 'pilot';
  wrap.innerHTML = `
    <div class="select">
      <h2>Zap is coming of age. Do I go?</h2>
      <p class="muted">Zap the pilot and Angie the engie buy a used two-person digging ship and head for the center of the earth.
        His brother Joe went first. Joe left notes. As the ship grows, more of the crew's 17 classes sign on, and you can switch to any of them at a port.</p>
      <div class="pick">${STARTER_CLASSES.map((k) => `<button class="pc ${k === pick ? 'on' : ''} ${CLASSES[k].troll ? 'troll' : ''}" data-k="${k}" style="--c:${CLASSES[k].color}">
        <canvas width="72" height="72"></canvas><b>${CLASSES[k].name}</b><span>${CLASSES[k].blurb}</span></button>`).join('')}</div>
      <div class="later">${CLASS_ORDER.filter((k) => !STARTER_CLASSES.includes(k)).map((k) => `<span style="--c:${CLASSES[k].color}" title="${CLASSES[k].blurb}">${CLASSES[k].name}</span>`).join('')}</div>
      <form class="go">
        <label>Your name <input name="name" maxlength="16" placeholder="(class default)" value="${(name || '').replace(/"/g, '')}"></label>
        <label>Name your ship <input name="ship" maxlength="32" placeholder="The D-???"></label>
        <button class="big">DIG!</button>
        <button type="button" class="ghost back">Back</button>
      </form>
      <p class="warn hidden">⚠ The Urchid contributes nothing to any cause whatsoever. Solo, that makes this story mode: you win every fight and see every story beat.</p>
    </div>`;
  const draw = () => wrap.querySelectorAll('.pc').forEach((b) => {
    const c = b.querySelector('canvas').getContext('2d'); c.clearRect(0, 0, 72, 72);
    drawCrew(c, { cls: b.dataset.k, x: 36, y: 38, r: 20, facing: -Math.PI / 2, alive: true, id: 3, upgrades: [0, 0, 0], cd: {} }, performance.now() / 1000);
  });
  draw();
  wrap.querySelectorAll('.pc').forEach((b) => b.addEventListener('click', () => {
    pick = b.dataset.k;
    wrap.querySelectorAll('.pc').forEach((x) => x.classList.toggle('on', x === b));
    wrap.querySelector('.warn').classList.toggle('hidden', pick !== 'urchid');
    sfx.ui();
  }));
  wrap.querySelector('.back').addEventListener('click', () => onExit?.());
  wrap.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    start({ playerClass: pick, playerName: f.name.value, shipName: f.ship.value });
  });
}

// ---------------------------------------------------------------------------
function startGame(wrap, opts, onExit, lobbyName) {
  wrap.innerHTML = '';
  const g = new Game(opts);
  const uiRoot = document.createElement('div');
  uiRoot.className = 'g-root';
  wrap.append(uiRoot);
  let me = g.player;
  let running = true;
  const view = { pilot: false, aim: null, focus: null };

  const ui = createUI(uiRoot, {
    game: () => g, me: () => me,
    cmd: (c) => { g.command(me, c); },
    sfx,
    ui: (what, act) => {
      if (what === 'upgrades') ui.openModal('upgrades');
      if (what === 'help') ui.openModal('help');
      if (what === 'mute') ui.toast(toggleMute() ? 'Sound off' : 'Sound on');
      if (what === 'target') ui.panelTarget(act.target);
      if (what === 'release') { const i = me.monsters.findIndex((m) => m.type === act.type && !m.out); if (i >= 0) me.monsters.splice(i, 1); ui.render(true); }
      if (what === 'quit' || what === 'save') { stop(); onExit?.(); }
      if (what === 'again') { stop(); launchSolo(wrap.parentElement, { name: lobbyName, onExit }); }
    },
    onClose: () => { g.paused = false; },
    highScores: (game, score) => saveScore(game, score),
  });
  const renderer = createRenderer(ui.canvas);

  // ---- input
  const keys = new Set();
  const pressed = {};
  const mouse = { x: 0, y: 0, l: false, r: false };
  const blocking = () => ui.isOpen() && !['panel'].includes(ui.kind());
  const onKey = (e, down) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.code;
    if (down && !e.repeat) {
      if (k === 'Escape') {
        if (view.pilot) { g.command(me, { t: 'helm', on: false }); return; }
        if (ui.isOpen()) { if (['panel', 'upgrades', 'help', 'pause'].includes(ui.kind())) { ui.closeModal(); g.paused = false; } }
        else { ui.openModal('pause'); g.paused = true; }
        e.preventDefault(); return;
      }
      if (k === 'Tab') { e.preventDefault(); if (ui.kind() === 'upgrades') ui.closeModal(); else if (!ui.isOpen() || ui.kind() === 'panel') ui.openModal('upgrades'); return; }
      if (k === 'KeyH' && !ui.isOpen()) { ui.openModal('help'); return; }
      if (k === 'KeyM') { renderer.cam.overview = !renderer.cam.overview; return; }
      if (k === 'KeyE' && view.pilot) { g.command(me, { t: 'helm', on: false }); return; }
      if (k === 'KeyE' && ui.kind() === 'panel') { ui.closeModal(); return; }
      if (['KeyQ', 'KeyF', 'KeyE', 'Space'].includes(k)) pressed[{ KeyQ: 'q', KeyF: 'f', KeyE: 'e', Space: 'space' }[k]] = true;
    }
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    if (down) keys.add(k); else keys.delete(k);
  };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  addEventListener('keydown', kd); addEventListener('keyup', ku);
  const cv = ui.canvas;
  const mm = (e) => { const r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
  const md = (e) => { initAudio(); if (e.button === 0) mouse.l = true; if (e.button === 2) { mouse.r = true; pressed.rmb = true; } };
  const mu = (e) => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; };
  cv.addEventListener('mousemove', mm); cv.addEventListener('mousedown', md); addEventListener('mouseup', mu);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => { e.preventDefault(); renderer.cam.zoom = Math.max(0.5, Math.min(2.6, renderer.cam.zoom * (e.deltaY > 0 ? 0.9 : 1.1))); }, { passive: false });
  const blur = () => { keys.clear(); mouse.l = mouse.r = false; };
  addEventListener('blur', blur);

  function buildInput() {
    const aim = renderer.screenToWorld(mouse.x, mouse.y);
    view.aim = aim;
    if (blocking()) return { mx: 0, my: 0, ax: aim.x, ay: aim.y, pressed: {} };
    const k = (a, b) => keys.has(a) || keys.has(b);
    const inp = {
      mx: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
      my: (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0),
      ax: aim.x, ay: aim.y,
      fire: mouse.l && !ui.isOpen(), rmb: mouse.r && !ui.isOpen(),
      e: keys.has('KeyE') && !view.pilot, shift: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      pressed: ui.isOpen() ? {} : { ...pressed },
    };
    for (const key in pressed) delete pressed[key];
    return inp;
  }

  // ---- loop
  let acc = 0, lastT = performance.now(), uiT = 0, lastHp = me.hp;
  function loop(now) {
    if (!running) return;
    requestAnimationFrame(loop);
    let dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    me = g.player;
    g.paused = ['help', 'pause', 'upgrades'].includes(ui.kind());
    view.pilot = me.cls === 'pilot' && me.atHelm && g.phase === 'descent' && me.alive;
    g.setInput(me.id, buildInput());
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) { g.update(STEP); acc -= STEP; steps++; }
    if (steps >= 5) acc = 0;
    // effects
    for (const e of g.drainFx()) handleFx(e);
    if (me.hp < lastHp - 0.5 && me.alive) sfx.hurt();
    lastHp = me.hp;
    // camera focus: urchid ghost mode
    view.focus = me.cls === 'urchid' && me.ghost ? g.crew.find((c) => c.id === me.ghost) : null;
    renderer.frame(g, me, dt, view);
    uiT -= dt;
    if (uiT <= 0) { uiT = 0.1; ui.update(g, me, view); }
    setIntensity(g.phase === 'encounter' ? 1 : 0);
  }
  requestAnimationFrame(loop);

  function handleFx(e) {
    renderer.onFx(e, g);
    ui.onFx(e, g, me);
    switch (e.t) {
      case 'shot': sfx.shot(e.w); break;
      case 'eshot': sfx.eshot(); break;
      case 'swing': sfx.swing(); break;
      case 'hit': if (e.team !== 'crew') sfx.hit(); break;
      case 'boom': sfx.boom(e.r); break;
      case 'pickup': sfx.pickup(e.kind); break;
      case 'clink': sfx.clink(); break;
      case 'door': sfx.door(); break;
      case 'seal': sfx.seal(); sfx.alarm(); break;
      case 'alarm': sfx.alarm(); break;
      case 'dig': sfx.dig(); break;
      case 'pop': sfx.pop(); break;
      case 'blow': sfx.blow(); break;
      case 'saw': sfx.saw(); break;
      case 'zap': sfx.zap(); break;
      case 'clang': sfx.clang(); break;
      case 'fixed': sfx.fixed(); break;
      case 'slots': if (e.crew === me.id) sfx.slots(e.win); break;
      case 'victory': sfx.victory(); break;
      case 'gameover': sfx.defeat(); break;
      case 'dfire': sfx.dfire(e.who, e.w); break;
      case 'impact': sfx.impact(); break;
      case 'down': sfx.down(); break;
      case 'ability': if (e.id === 'pounce' || e.id === 'howl') sfx.bark(); if (e.id === 'insult') sfx.insult(); break;
      case 'say': { const a = g.crew.find((c) => c.id === e.id) || g.mobs.find((m) => m.id === e.id); if (a && !a.cls) { a.say = e.text; a.sayT = 3; } break; }
      case 'switch': me = g.player; break;
      case 'ending': sfx.victory(); break;
    }
  }

  function stop() {
    running = false;
    removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('mouseup', mu); removeEventListener('blur', blur);
  }

  // first run: show controls
  try { if (!localStorage.getItem('doigo.seenHelp')) { localStorage.setItem('doigo.seenHelp', '1'); setTimeout(() => { if (!ui.isOpen()) ui.openModal('help'); }, 5600); } } catch {}
  // debug handle
  window.__dig = g;
}

// ---------------------------------------------------------------------------
function saveScore(g, score) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem('doigo.scores') || '[]'); } catch {}
  if (!g.scoreSaved) {
    g.scoreSaved = { ship: g.ship.name, score, result: g.phase === 'ending' ? (g.joe.state === 'saved' ? 'reached the core with Joe' : 'reached the core') : `lost at ${g.depthKm.toLocaleString()} km`, arms: g.phase === 'ending' && g.joe.state === 'saved', at: Date.now() };
    list.push(g.scoreSaved);
    list.sort((a, b) => b.score - a.score);
    list = list.slice(0, 10);
    try { localStorage.setItem('doigo.scores', JSON.stringify(list)); } catch {}
  }
  return list.map((s) => ({ ...s, mine: s.at === g.scoreSaved.at }));
}
