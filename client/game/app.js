// The game screen. Solo: splash → pick your class → dig, with the simulation running right here.
// Online: the server runs the simulation; this draws its snapshots and sends your controls.
// Either way bots play every crew member nobody is controlling.
import { Game } from '../shared/sim/game.js';
import { CLASSES, CLASS_ORDER, STARTER_CLASSES, SPLASH } from '../shared/sim/data.js';
import { decodeState, decodeGrid, applyGridDiff, unpackState } from '../shared/sim/netcode.js';
import { speedFactor } from '../shared/sim/pilot.js';
import { crewSpeed, walksFreely } from '../shared/sim/classes.js';
import { moveActor } from '../shared/sim/combat.js';
import { norm } from '../shared/sim/util.js';
import { createRenderer } from './render.js';
import { createUI } from './ui.js';
import { initAudio, sfx, setIntensity, toggleMute, setListener, at } from './audio.js';
import { roomCenter } from '../shared/sim/grid.js';
import { drawCrew } from './sprites.js';

const STEP = 1 / 30;
const INPUT_MS = 50;

export function launchSolo(host, { name = '', onExit, quick, submit } = {}) {
  const wrap = mount(host);
  if (quick && CLASSES[quick]) { initAudio(); startSolo(wrap, { playerClass: quick, playerName: name }, onExit, name, submit); return; }
  showSplash(wrap, () => showClassSelect(wrap, name, (opts) => startSolo(wrap, opts, onExit, name, submit), onExit));
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

function startSolo(wrap, opts, onExit, lobbyName, submit) {
  const ctl = runSession(wrap, soloSession(new Game(opts)), {
    online: false,
    submit,
    actions: {
      quit: () => { ctl.stop(); onExit?.(); },
      again: () => { ctl.stop(); launchSolo(wrap.parentElement, { name: lobbyName, onExit, submit }); },
    },
  });
}

const runSummary = (g, extra) => g.runSummary(extra);

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
  // Interpolation buffer: the last few snapshots, stamped with the server's game clock. Everything
  // (except you) is drawn a little in the past, sliding between two real snapshots, so uneven
  // network timing never shows up as stutter.
  const snaps = [];                   // { st, pos: Map(id -> [x, y]) }
  let clockOff = null;                // server game time minus local time (seconds), smoothed
  const DELAY = 0.13;                 // how far in the past we draw (a bit more than one frame)
  let sendT = 0, pendingPress = {};
  // Prediction: your own crew member moves the moment you press a key. Each input message has a
  // sequence number; the server says which one it last got (ack) and how long it has applied it
  // (ackT). On every snapshot we start from the server's position and replay what it hasn't seen.
  let seq = 0;
  let hist = [];                      // { seq, t, mx, my, shift } per frame, oldest first
  let pred = null;                    // predicted position, or null when not predicting
  let predId = null;
  const err = { x: 0, y: 0 };         // leftover correction, faded out so fixes don't jump
  const walk = (gg, c, p, h, t) => {
    const n = norm(h.mx || 0, h.my || 0);
    if (!n.l || t <= 0) return;
    const sp = crewSpeed(gg, c, h);
    const a = { x: p.x, y: p.y, r: c.r, ghostDoors: c.ghostDoors };
    moveActor(gg, a, n.x * sp * t, n.y * sp * t);
    p.x = a.x; p.y = a.y;
  };
  const canPredict = (gg, c) => c && walksFreely(gg, c) && !gg.storyOpen && gg.phase !== 'gameover' && gg.phase !== 'ending';
  const stopPredicting = () => { pred = null; predId = null; hist = []; err.x = err.y = 0; };
  const sendInput = (out) => { out.seq = ++seq; net.sendVolatile({ t: 'in', i: out }); };
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
      sendInput(out);
      pendingPress = {};
    },
    receive(msg) {
      if (msg.grid) grid = decodeGrid(msg.grid);
      else if (grid) applyGridDiff(grid, msg);
      if (!grid) return;
      const next = decodeState(unpackState(msg.s, msg.keep, kept), grid);
      seats = msg.seats || seats;
      const now = performance.now();
      if (g && !msg.join) gap = Math.max(40, Math.min(250, gap * 0.8 + (now - recvAt) * 0.2));
      recvAt = now;
      // stamp this snapshot with the server's clock and remember where everything was
      const st = next.time || 0;
      const sample = st - now / 1000;
      if (clockOff == null || msg.join || Math.abs(sample - clockOff) > 1) clockOff = sample;
      else clockOff += (sample - clockOff) * (sample > clockOff ? 0.25 : 0.05); // late frames pull slowly, early ones quickly
      if (msg.join || (snaps.length && st < snaps[snaps.length - 1].st)) snaps.length = 0;
      const pos = new Map();
      for (const list of [next.crew, next.mobs, next.projs, next.pickups]) for (const e of list) { pos.set(e.id, [e.x, e.y]); e._tx = e.x; e._ty = e.y; }
      if (!snaps.length || st > snaps[snaps.length - 1].st) snaps.push({ st, pos });
      else snaps[snaps.length - 1].pos = pos;
      while (snaps.length > 6) snaps.shift();
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
      // Your own crew member: server position + the inputs it hasn't applied yet.
      const mine = next.crew.find((c) => c.id === seats[playerId]);
      if (pred && mine && mine.id === predId && canPredict(next, mine)) {
        const sx = mine._tx, sy = mine._ty;           // the server's position (before smoothing)
        hist = hist.filter((h) => h.seq > (mine.ack || 0));
        const p = { x: sx, y: sy };
        let skip = mine.ackT || 0;                     // already applied by the server
        for (const h of hist) {
          let t = h.t;
          if (skip > 0) { const s = Math.min(skip, t); skip -= s; t -= s; }
          walk(next, mine, p, h, t);
        }
        const shownX = pred.x + err.x, shownY = pred.y + err.y;
        if (Math.hypot(shownX - p.x, shownY - p.y) > 128) { err.x = err.y = 0; }  // teleported (vent, respawn): jump
        else { err.x = shownX - p.x; err.y = shownY - p.y; }
        pred = p;
        mine.x = pred.x + err.x; mine.y = pred.y + err.y;
        mine._tx = null;                               // not smoothed like the others
        mine._sx = sx; mine._sy = sy;                  // (for debugging: where the server has us)
      } else if (pred) stopPredicting();
      g = next;
      fxq.push(...(msg.fx || []));
    },
    step(dt, inp) {
      if (!g) return;
      const k = Math.min(1, (performance.now() - recvAt) / gap);
      // draw everything at "server time minus a little", between the two snapshots around that moment
      const rt = performance.now() / 1000 + (clockOff || 0) - DELAY;
      let a = null, b = null;
      for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].st <= rt) { a = snaps[i]; b = snaps[i + 1] || null; break; }
      if (!a) { a = snaps[0]; b = null; }
      const f = a && b ? Math.max(0, Math.min(1, (rt - a.st) / Math.max(0.001, b.st - a.st))) : 1;
      for (const list of [g.crew, g.mobs, g.projs, g.pickups]) for (const e of list) {
        if (e._tx == null) continue;
        const pa = a?.pos.get(e.id), pb = b?.pos.get(e.id);
        if (pa && pb && Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) < 200) { e.x = pa[0] + (pb[0] - pa[0]) * f; e.y = pa[1] + (pb[1] - pa[1]) * f; }
        else if (pb && f >= 0.5) { e.x = pb[0]; e.y = pb[1]; }
        else if (pa) { e.x = pa[0]; e.y = pa[1]; }
        else { e.x = e._tx; e.y = e._ty; }  // brand new: show where the server has it
      }
      for (const m of g.mobs) if (m.sayT > 0) m.sayT -= dt;
      const d = g.descent;
      if (d?._at && g.phase === 'descent' && !d.stranded && !g.storyOpen) {
        const el = Math.min(0.3, (performance.now() - d._at) / 1000);
        const spd = speedFactor(g) * (d.boost ? 1.6 : 1) * (g.speed || 1);
        for (const o of d.obstacles) { o.z = o._z - el * 0.55 * spd; o.x = o._x + (o.vx || 0) * el; o.y = o._y + (o.vy || 0) * el; }
        d.steer.x = d._sf.x + (d._st.x - d._sf.x) * k; d.steer.y = d._sf.y + (d._st.y - d._sf.y) * k;
      }
      // your own crew member moves right away
      const me = S.me();
      if (canPredict(g, me)) {
        if (!pred || predId !== me.id) { pred = { x: me.x, y: me.y }; predId = me.id; hist = []; err.x = err.y = 0; }
        const h = { seq: seq + 1, t: dt, mx: inp.mx, my: inp.my, shift: inp.shift };  // goes out with the next message
        hist.push(h);
        if (hist.length > 240) hist.shift();
        walk(g, me, pred, h, dt);
        const fade = Math.exp(-dt * 10);
        err.x *= fade; err.y *= fade;
        me.x = pred.x + err.x; me.y = pred.y + err.y;
        me.facing = Math.atan2(inp.ay - me.y, inp.ax - me.x);
        me.moving = !!(inp.mx || inp.my);
        me._tx = null;
      } else if (pred) stopPredicting();
      // controls: ~20×/s (always, so the server's ack keeps up), and right away when an ability key was pressed
      Object.assign(pendingPress, inp.pressed);
      sendT -= dt * 1000;
      if (sendT <= 0 || Object.keys(pendingPress).length > 0) {
        sendInput({ ...inp, pressed: pendingPress });
        sendT = INPUT_MS;
        pendingPress = {};
      }
    },
    drainFx: () => { const q = fxq; fxq = []; return q; },
  };
  return S;
}

// ---------------------------------------------------------------------------
function runSession(wrap, session, { online, isHost = () => false, actions = {}, submit }) {
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
      if (what === 'crew') ui.openModal('crew');
      if (what === 'help') ui.openModal('help');
      if (what === 'mute') ui.toast(toggleMute() ? 'Sound off' : 'Sound on');
      if (what === 'target') ui.panelTarget(act.target);
      if (what === 'release') { session.cmd({ t: 'release', type: act.type }); setTimeout(() => ui.render(true), 150); }
      if (what === 'quit' || what === 'save') actions.quit?.();
      if (what === 'again') actions.again?.();
      if (['leave', 'restart', 'shelve', 'destroy'].includes(what)) { ui.closeModal(); actions[what]?.(); }
    },
    onClose: () => session.setPaused(false),
    highScores: (game, score) => {
      // solo runs go on the shared leaderboard too (online runs are recorded by the server)
      const key = `${game.seed}|${game.ship.name}`;
      if (!online && submit && submitted !== key) { submitted = key; try { submit(runSummary(game, { solo: true, playerName: game.player?.name })); } catch {} }
      return saveScore(game, score);
    },
  });
  let submitted = null;
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
    if (down && !e.repeat && ui.isOpen() && ui.keyNav(k)) { e.preventDefault(); return; }
    // downed: choose where to get back up
    if (down && !e.repeat && !me.alive && !ui.isOpen() && ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'].includes(k)) {
      session.cmd({ t: 'spawnPick', d: k === 'KeyA' || k === 'ArrowLeft' ? -1 : 1 }); sfx.uiHover(); e.preventDefault(); return;
    }
    if (down && !e.repeat) {
      if (k === 'Escape') {
        if (view.pilot) { session.cmd({ t: 'helm', on: false }); return; }
        if (ui.isOpen()) { if (['panel', 'upgrades', 'help', 'pause', 'crew'].includes(ui.kind())) { ui.closeModal(); session.setPaused(false); } }
        else { ui.openModal('pause'); session.setPaused(true); }
        e.preventDefault(); return;
      }
      if (k === 'Enter' && online && !ui.isOpen()) { e.preventDefault(); ui.openChat(); return; }
      if (k === 'Tab') { e.preventDefault(); if (ui.kind() === 'upgrades') ui.closeModal(); else if (!ui.isOpen() || ui.kind() === 'panel') ui.openModal('upgrades'); return; }
      if (k === 'KeyH' && !ui.isOpen()) { ui.openModal('help'); return; }
      if (k === 'KeyC') { if (ui.kind() === 'crew') ui.closeModal(); else if (!ui.isOpen() || ui.kind() === 'panel') ui.openModal('crew'); return; }
      if (k === 'KeyM') { renderer.cam.overview = !renderer.cam.overview; return; }
      if (k === 'KeyL' && !ui.isOpen()) { session.cmd({ t: 'seal' }); return; }
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
    if (!online) g.paused = ['help', 'pause', 'upgrades', 'crew'].includes(ui.kind());
    view.pilot = me.cls === 'pilot' && me.atHelm && g.phase === 'descent' && me.alive;
    session.step(dt, buildInput());
    const cur = session.game();
    me = session.me() || me;
    // sounds come from where things happen: left/right and quieter further away
    setListener(me.x, me.y);
    for (const e of session.drainFx()) { at(e.x, e.y); handleFx(e, cur); at(null); }
    if (me.hp < lastHp - 0.5 && me.alive) sfx.hurt();
    lastHp = me.hp;
    ambience(cur, dt);
    if (!online) for (const m of cur.mobs) if (m.sayT > 0) m.sayT -= dt;
    // camera focus: urchid ghost mode, or (while you're down) the room you'll get back up in
    view.focus = me.cls === 'urchid' && me.ghost ? cur.crew.find((c) => c.id === me.ghost) : null;
    if (!me.alive && view.spawnRoom != null && cur.rooms[view.spawnRoom]) view.focus = roomCenter(cur.rooms[view.spawnRoom]);
    renderer.frame(cur, me, dt, view);
    uiT -= dt;
    if (uiT <= 0) { uiT = 0.1; ui.update(cur, me, view); }
    setIntensity(cur.phase === 'encounter' || cur.mobs.some((m) => m.alive && m.team === 'enemy') ? 1 : 0, cur.tier);
  }
  requestAnimationFrame(loop);

  // Loops that come from the world itself: fires crackle (from wherever they are), repairs whirr like gears.
  let fireT = 0, gearT = 0;
  function ambience(g, dt) {
    fireT -= dt; gearT -= dt;
    if (fireT <= 0) {
      fireT = 0.09 + Math.random() * 0.12;
      let best = null, bd = 700 * 700;
      const fires = g.objs.filter((o) => o.kind === 'fire');
      for (const o of fires) { const d = (o.x - me.x) ** 2 + (o.y - me.y) ** 2; if (d < bd) { bd = d; best = o; } }
      if (best) { const pickOne = fires.length > 1 && Math.random() < 0.4 ? fires[(Math.random() * fires.length) | 0] : best; at(pickOne.x, pickOne.y); sfx.burn(Math.min(1, fires.length / 6)); at(null); }
    }
    if (gearT <= 0) {
      gearT = 0.11;
      for (const c of g.crew) if (c.repairing > 0 && c.alive && Math.hypot(c.x - me.x, c.y - me.y) < 520) { at(c.x, c.y); sfx.gear(); at(null); break; }
    }
  }

  function handleFx(e, g) {
    renderer.onFx(e, g);
    ui.onFx(e, g, me);
    switch (e.t) {
      case 'shot': sfx.shot(e.w); break;
      case 'eshot': sfx.eshot(e.w); break;
      case 'swing': if (e.cls === 'trainer') sfx.whip(); else sfx.swing(e.cls); break;
      case 'dash': sfx.dash(); break;
      case 'caw': sfx.caw(); break;
      case 'backstab': sfx.stab(); break;
      case 'xp': if (e.crew === me.id) sfx.xp(); break;
      case 'meal': if (e.crew === me.id) sfx.eat(); break;
      case 'gunfound': sfx.gunfound(); break;
      case 'hit': if (e.team !== 'crew') sfx.hit(); break;
      case 'boom': sfx.boom(e.r); break;
      case 'pickup': sfx.pickup(e.kind); break;
      case 'clink': sfx.clink(); break;
      case 'door': sfx.door(e.blast); break;
      case 'laugh': sfx.laugh(); break;
      case 'docked': sfx.docked(); break;
      case 'fire': sfx.fire(); break;
      case 'spray': sfx.spray(); break;
      case 'seal': sfx.seal(); sfx.alarm(); break;
      case 'alarm': sfx.alarm(); break;
      case 'dig': sfx.dig(); break;
      case 'pop': sfx.pop(); break;
      case 'blow': sfx.blow(); break;
      case 'saw': sfx.saw(); break;
      case 'zap': sfx.zap(); break;
      case 'clang': sfx.clang(); break;
      case 'fixed': sfx.fixed(); break;
      case 'bang': sfx.bang(); break;
      case 'claw': sfx.claw(e.big); break;
      case 'flame': sfx.flame(); break;
      case 'vent': sfx.vent(); break;
      case 'capture': sfx.capture(); break;
      case 'respawn': sfx.respawn(); break;
      case 'spark': sfx.spark(); break;
      case 'slots': if (e.crew === me.id) sfx.slots(e.win); break;
      case 'victory': sfx.victory(); break;
      case 'gameover': sfx.defeat(); break;
      case 'dfire': sfx.dfire(e.who, e.w); break;
      case 'impact': sfx.impact(); break;
      case 'down': sfx.down(); break;
      case 'ability': if (e.id === 'pounce' || e.id === 'howl') sfx.bark(); if (e.id === 'insult') sfx.insult(); break;
      case 'say': {
        const a = g.crew.find((c) => c.id === e.id) || g.mobs.find((m) => m.id === e.id);
        if (a && !a.cls) { a.say = e.text; a.sayT = 3.2; }
        if (a && Math.hypot(a.x - me.x, a.y - me.y) < 500) { at(a.x, a.y); if (a.cls) sfx.chirp(a.cls); else if (!a.isJoe) sfx.grunt(); at(null); }
        break;
      }
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
    (saveScore.saved ||= new Map()).set(key, { ship: g.ship.name, score, result: g.phase === 'ending' ? (g.joe.state === 'saved' ? 'reached the core with Joe' : 'reached the core') : `lost at -${g.depthKm}km`, arms: g.phase === 'ending' && g.joe.state === 'saved', at: Date.now() });
    list.push(saveScore.saved.get(key));
    list.sort((a, b) => b.score - a.score);
    list = list.slice(0, 10);
    try { localStorage.setItem('doigo.scores', JSON.stringify(list)); } catch {}
  }
  const mine = saveScore.saved.get(key);
  return list.map((s) => ({ ...s, mine: s.at === mine.at }));
}
