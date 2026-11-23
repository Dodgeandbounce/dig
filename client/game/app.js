// The game screen. Solo: splash → pick your class → dig, with the simulation running right here.
// Online: the server runs the simulation; this draws its snapshots and sends your controls.
// Either way bots play every crew member nobody is controlling.
import { Game } from '../shared/sim/game.js';
import { CLASSES, CLASS_ORDER, STARTER_CLASSES, SPLASH } from '../shared/sim/data.js';
import { decodeState, decodeGrid, applyGridDiff, unpackState } from '../shared/sim/netcode.js';
import { speedFactor } from '../shared/sim/pilot.js';
import { createRenderer } from './render.js';
import { createUI } from './ui.js';
import { initAudio, sfx, setIntensity, toggleMute } from './audio.js';
import { drawCrew } from './sprites.js';

const STEP = 1 / 30;
const INPUT_MS = 50;

export function launchSolo(host, { name = '', onExit, quick } = {}) {
  const wrap = mount(host);
  if (quick && CLASSES[quick]) { initAudio(); startSolo(wrap, { playerClass: quick, playerName: name }, onExit, name); return; }
  showSplash(wrap, () => showClassSelect(wrap, name, (opts) => startSolo(wrap, opts, onExit, name), onExit));
}

/**
 * Join the game running on the server for an online ship.
 * @returns {{ frame(msg): void, meta(world): void, stop(): void }}
 */
export function launchOnline(host, { net, playerId, actions }) {
  const wrap = mount(host);
  initAudio();
  const session = onlineSession(net, playerId);
  const ctl = runSession(wrap, session, {
    online: true,
    isHost: () => session.world?.hostId === playerId,
    actions,
  });
  return {
    frame: (msg) => session.receive(msg),
    meta: (world) => { session.world = world; ctl.meta(world); },
    stop: () => ctl.stop(),
  };
}

function mount(host) {
  host.innerHTML = '';
  host.classList.add('dig-host');
  const wrap = document.createElement('div');
  wrap.className = 'dig';
  host.append(wrap);
  return wrap;
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

function startSolo(wrap, opts, onExit, lobbyName) {
  const ctl = runSession(wrap, soloSession(new Game(opts)), {
    online: false,
    actions: {
      quit: () => { ctl.stop(); onExit?.(); },
      again: () => { ctl.stop(); launchSolo(wrap.parentElement, { name: lobbyName, onExit }); },
    },
  });
}

// ---------------------------------------------------------------------------
// Sessions: where the game comes from. Same shape for solo and online.

function soloSession(g) {
  let acc = 0;
  return {
    online: false,
    game: () => g,
    me: () => g.player,
    cmd: (c) => g.command(g.player, c),
    setPaused: (on) => { g.paused = on; },
    step(dt, inp) {
      g.setInput(g.player.id, inp);
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5) { g.update(STEP); acc -= STEP; steps++; }
      if (steps >= 5) acc = 0;
    },
    drainFx: () => g.drainFx(),
  };
}

function onlineSession(net, playerId) {
  let g = null, grid = null, seats = {};
  const kept = new Map();             // last copy of each part of the state (server only resends what changed)
  let fxq = [];
  let recvAt = 0, gap = 100;          // ms between the last two frames (for smoothing)
  let shown = new Map();              // entity id -> position currently on screen
  let sendT = 0, pendingPress = {}, lastSent = '';
  const S = {
    online: true,
    world: null,
    game: () => g,
    me: () => (g ? g.crew.find((c) => c.id === seats[playerId]) || null : null),
    cmd: (c) => net.send({ t: 'cmd', c }),
    chat: (text) => net.send({ t: 'chat', text }),
    setPaused() {},
    release() {
      const me = S.me();
      const out = { mx: 0, my: 0, ax: me ? me.x + 1 : 0, ay: me ? me.y : 0, fire: false, rmb: false, e: false, shift: false, pressed: {} };
      net.sendVolatile({ t: 'in', i: out });
      lastSent = JSON.stringify(out);
      pendingPress = {};
    },
    receive(msg) {
      if (msg.grid) grid = decodeGrid(msg.grid);
      else if (grid) applyGridDiff(grid, msg);
      if (!grid) return;
      const next = decodeState(unpackState(msg.s, msg.keep, kept), grid);
      seats = msg.seats || seats;
      // Smoothing: each moving thing slides from where it is on screen to where the server says.
      const now = performance.now();
      if (g && !msg.join) gap = Math.max(40, Math.min(250, gap * 0.8 + (now - recvAt) * 0.2));
      recvAt = now;
      for (const list of [next.crew, next.mobs, next.projs, next.pickups]) for (const e of list) {
        const was = shown.get(e.id);
        e._tx = e.x; e._ty = e.y;
        if (was && Math.hypot(was.x - e.x, was.y - e.y) < 160) { e._fx = was.x; e._fy = was.y; e.x = was.x; e.y = was.y; }
        else { e._fx = e.x; e._fy = e.y; }
      }
      // The pilot's tunnel: rocks fly toward you between frames; the steering slides like everything else.
      const d = next.descent;
      if (d) {
        d._at = now;
        for (const o of d.obstacles || []) { o._z = o.z; o._x = o.x; o._y = o.y; }
        const was = g?.descent?.steer;
        d._sf = was ? { x: was.x, y: was.y } : { ...d.steer };
        d._st = { ...d.steer };
        d.steer = { ...d._sf };
      }
      // Speech bubbles for monsters (Joe) are client-side only.
      if (g) for (const m of next.mobs) { const old = g.mobs.find((x) => x.id === m.id); if (old?.sayT > 0) { m.say = old.say; m.sayT = old.sayT; } }
      g = next;
      fxq.push(...(msg.fx || []));
    },
    step(dt, inp) {
      if (!g) return;
      const k = Math.min(1, (performance.now() - recvAt) / gap);
      shown = new Map();
      for (const list of [g.crew, g.mobs, g.projs, g.pickups]) for (const e of list) {
        if (e._tx == null) continue;
        e.x = e._fx + (e._tx - e._fx) * k; e.y = e._fy + (e._ty - e._fy) * k;
        shown.set(e.id, { x: e.x, y: e.y });
      }
      for (const m of g.mobs) if (m.sayT > 0) m.sayT -= dt;
      const d = g.descent;
      if (d?._at && g.phase === 'descent' && !d.stranded && !g.storyOpen) {
        const el = Math.min(0.3, (performance.now() - d._at) / 1000);
        const spd = speedFactor(g) * (d.boost ? 1.6 : 1) * (g.speed || 1);
        for (const o of d.obstacles) { o.z = o._z - el * 0.55 * spd; o.x = o._x + (o.vx || 0) * el; o.y = o._y + (o.vy || 0) * el; }
        d.steer.x = d._sf.x + (d._st.x - d._sf.x) * k; d.steer.y = d._sf.y + (d._st.y - d._sf.y) * k;
      }
      // controls: ~20×/s, and right away when an ability key was pressed
      Object.assign(pendingPress, inp.pressed);
      sendT -= dt * 1000;
      const hasPress = Object.keys(pendingPress).length > 0;
      if (sendT <= 0 || hasPress) {
        const out = { ...inp, pressed: pendingPress };
        const json = JSON.stringify(out);
        if (json !== lastSent || sendT <= -1000) { net.sendVolatile({ t: 'in', i: out }); lastSent = json; sendT = INPUT_MS; }
        else sendT = INPUT_MS;
        pendingPress = {};
      }
    },
    drainFx: () => { const q = fxq; fxq = []; return q; },
  };
  return S;
}

// ---------------------------------------------------------------------------
function runSession(wrap, session, { online, isHost = () => false, actions = {} }) {
  wrap.innerHTML = '';
  const uiRoot = document.createElement('div');
  uiRoot.className = 'g-root' + (online ? ' online' : '');
  wrap.append(uiRoot);
  const wait = document.createElement('div');
  wait.className = 'g-wait';
  wait.textContent = 'Boarding…';
  if (online) wrap.append(wait);
  let me = null;
  let running = true;
  const view = { pilot: false, aim: null, focus: null };

  const ui = createUI(uiRoot, {
    game: () => session.game(), me: () => me,
    cmd: (c) => session.cmd(c),
    chat: (text) => session.chat?.(text),
    sfx,
    online, isHost,
    ui: (what, act) => {
      if (what === 'upgrades') ui.openModal('upgrades');
      if (what === 'help') ui.openModal('help');
      if (what === 'mute') ui.toast(toggleMute() ? 'Sound off' : 'Sound on');
      if (what === 'target') ui.panelTarget(act.target);
      if (what === 'release') { session.cmd({ t: 'release', type: act.type }); setTimeout(() => ui.render(true), 150); }
      if (what === 'quit' || what === 'save') actions.quit?.();
      if (what === 'again') actions.again?.();
      if (['leave', 'restart', 'shelve', 'destroy'].includes(what)) { ui.closeModal(); actions[what]?.(); }
    },
    onClose: () => session.setPaused(false),
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
    if (!me) return;
    const k = e.code;
    if (down && !e.repeat) {
      if (k === 'Escape') {
        if (view.pilot) { session.cmd({ t: 'helm', on: false }); return; }
        if (ui.isOpen()) { if (['panel', 'upgrades', 'help', 'pause'].includes(ui.kind())) { ui.closeModal(); session.setPaused(false); } }
        else { ui.openModal('pause'); session.setPaused(true); }
        e.preventDefault(); return;
      }
      if (k === 'Enter' && online && !ui.isOpen()) { e.preventDefault(); ui.openChat(); return; }
      if (k === 'Tab') { e.preventDefault(); if (ui.kind() === 'upgrades') ui.closeModal(); else if (!ui.isOpen() || ui.kind() === 'panel') ui.openModal('upgrades'); return; }
      if (k === 'KeyH' && !ui.isOpen()) { ui.openModal('help'); return; }
      if (k === 'KeyM') { renderer.cam.overview = !renderer.cam.overview; return; }
      if (k === 'KeyE' && view.pilot) { session.cmd({ t: 'helm', on: false }); return; }
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
  // Switching away stops the frame loop, so tell the server to let go of every key right now.
  const blur = () => { keys.clear(); mouse.l = mouse.r = false; session.release?.(); };
  const hidden = () => { if (document.hidden) blur(); };
  addEventListener('blur', blur);
  document.addEventListener('visibilitychange', hidden);

  function buildInput() {
    const aim = renderer.screenToWorld(mouse.x, mouse.y);
    view.aim = aim;
    if (blocking()) return { mx: 0, my: 0, ax: aim.x, ay: aim.y, pressed: {} };
    const k = (a, b) => keys.has(a) || keys.has(b);
    const inp = {
      mx: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
      my: (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0),
      ax: Math.round(aim.x), ay: Math.round(aim.y),
      fire: mouse.l && !ui.isOpen(), rmb: mouse.r && !ui.isOpen(),
      e: keys.has('KeyE') && !view.pilot, shift: keys.has('ShiftLeft') || keys.has('ShiftRight'),
      pressed: ui.isOpen() ? {} : { ...pressed },
    };
    for (const key in pressed) delete pressed[key];
    return inp;
  }

  // ---- loop
  let lastT = performance.now(), uiT = 0, lastHp = null, lastMeId = null;
  function loop(now) {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    const g = session.game();
    me = session.me();
    if (!g || !me) { if (online) wait.classList.remove('hidden'); return; }
    wait.classList.add('hidden');
    if (me.id !== lastMeId) { lastMeId = me.id; lastHp = me.hp; }
    if (!online) g.paused = ['help', 'pause', 'upgrades'].includes(ui.kind());
    view.pilot = me.cls === 'pilot' && me.atHelm && g.phase === 'descent' && me.alive;
    session.step(dt, buildInput());
    const cur = session.game();
    me = session.me() || me;
    for (const e of session.drainFx()) handleFx(e, cur);
    if (me.hp < lastHp - 0.5 && me.alive) sfx.hurt();
    lastHp = me.hp;
    // camera focus: urchid ghost mode
    view.focus = me.cls === 'urchid' && me.ghost ? cur.crew.find((c) => c.id === me.ghost) : null;
    renderer.frame(cur, me, dt, view);
    uiT -= dt;
    if (uiT <= 0) { uiT = 0.1; ui.update(cur, me, view); }
    setIntensity(cur.phase === 'encounter' ? 1 : 0);
  }
  requestAnimationFrame(loop);

  function handleFx(e, g) {
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
      case 'switch': me = session.me() || me; break;
      case 'ending': sfx.victory(); break;
    }
  }

  function stop() {
    running = false;
    removeEventListener('keydown', kd); removeEventListener('keyup', ku); removeEventListener('mouseup', mu); removeEventListener('blur', blur);
    document.removeEventListener('visibilitychange', hidden);
  }

  // first run: show controls
  try { if (!localStorage.getItem('doigo.seenHelp')) { localStorage.setItem('doigo.seenHelp', '1'); setTimeout(() => { if (running && !ui.isOpen()) ui.openModal('help'); }, 5600); } } catch {}
  // debug handle
  window.__dig = session;

  return { stop, meta: (w) => ui.setWorld?.(w) };
}

// ---------------------------------------------------------------------------
function saveScore(g, score) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem('doigo.scores') || '[]'); } catch {}
  const key = `${g.ship.name}|${g.seed}`;
  if (!saveScore.saved?.has(key)) {
    (saveScore.saved ||= new Map()).set(key, { ship: g.ship.name, score, result: g.phase === 'ending' ? (g.joe.state === 'saved' ? 'reached the core with Joe' : 'reached the core') : `lost at ${g.depthKm.toLocaleString()} km`, arms: g.phase === 'ending' && g.joe.state === 'saved', at: Date.now() });
    list.push(saveScore.saved.get(key));
    list.sort((a, b) => b.score - a.score);
    list = list.slice(0, 10);
    try { localStorage.setItem('doigo.scores', JSON.stringify(list)); } catch {}
  }
  const mine = saveScore.saved.get(key);
  return list.map((s) => ({ ...s, mine: s.at === mine.at }));
}
