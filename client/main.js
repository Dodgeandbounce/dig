import { Net, loadIdentity, saveIdentity } from './net.js';
import { launchSolo, launchOnline } from './game/app.js';

const $ = (id) => document.getElementById(id);
const net = new Net();
let identity = loadIdentity();
let currentWorldId = sessionStorage.getItem('doigo.world'); // survives reloads / reconnects
let me = null;
let playingSolo = false;
let online = null; // { worldId, ctl } while aboard an online ship

// ---------- screens ----------
function show(name) {
  if (playingSolo && name !== 'game') return; // lobby updates don't yank you out of a solo run
  for (const s of ['name', 'lobby', 'game']) $(`screen-${s}`).classList.toggle('hidden', s !== name);
  document.body.classList.toggle('playing', name === 'game');
}
function toast(text) {
  const el = $('toast'); el.textContent = text; el.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 3200);
}
function setWorld(id) {
  currentWorldId = id;
  if (id) sessionStorage.setItem('doigo.world', id); else sessionStorage.removeItem('doigo.world');
}

// ---------- solo ----------
function startSolo(quick) {
  if (currentWorldId) { net.send({ t: 'leave' }); setWorld(null); }
  stopOnline();
  playingSolo = true;
  show('game');
  launchSolo($('screen-game'), {
    quick: typeof quick === 'string' ? quick : null,
    name: identity.name || $('name-input').value.trim(),
    onExit: () => {
      playingSolo = false;
      $('screen-game').innerHTML = '';
      show(me ? 'lobby' : 'name');
      if (me) net.send({ t: 'hello', ...identity });
    },
  });
}
$('btn-solo').onclick = () => startSolo();
$('btn-solo2').onclick = () => startSolo();
// ?solo=<class> jumps straight into a run (handy for testing and for sharing a link)
const quick = new URLSearchParams(location.search).get('solo');
if (quick !== null) startSolo(quick || 'pilot');

// ---------- online ship ----------
function startOnline(worldId) {
  stopOnline();
  show('game');
  const ctl = launchOnline($('screen-game'), {
    net, playerId: me,
    actions: {
      leave: () => { net.send({ t: 'leave' }); setWorld(null); stopOnline(); show('lobby'); },
      restart: () => { if (confirm('End this run and start over from the surface? Everyone aboard starts again.')) net.send({ t: 'restart' }); },
      shelve: () => net.send({ t: 'shelve' }),
      destroy: () => { if (confirm('Destroy this ship forever? Everyone aboard is sent back to the lobby and the save is deleted.')) net.send({ t: 'destroy' }); },
    },
  });
  online = { worldId, ctl };
}
function stopOnline() {
  if (!online) return;
  online.ctl.stop();
  online = null;
  $('screen-game').innerHTML = '';
}

// ---------- connection ----------
net.on('open', () => {
  $('conn').textContent = 'online'; $('conn').classList.add('ok');
  if (identity.name) net.send({ t: 'hello', ...identity });
});
net.on('close', () => {
  $('conn').textContent = 'offline (solo still works)'; $('conn').classList.remove('ok');
  if (online) toast('Connection lost. Reconnecting…');
});
net.on('welcome', (m) => {
  identity = { playerId: m.playerId, token: m.token, name: m.name };
  saveIdentity(identity);
  me = m.playerId;
  $('who').textContent = m.name;
  if (currentWorldId) net.send({ t: 'join', worldId: currentWorldId }); // drop back in
  else show('lobby');
});
net.on('error', (m) => {
  toast(m.message);
  if (m.message.includes('no longer exists') || m.message.includes('full')) { setWorld(null); stopOnline(); show('lobby'); }
});
net.on('left', (m) => { setWorld(null); stopOnline(); show('lobby'); if (m.reason) toast(m.reason); });

// ---------- name ----------
$('name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  identity.name = $('name-input').value.trim();
  net.send({ t: 'hello', ...identity });
});
if (identity.name) $('name-input').value = identity.name; else show('name');

// ---------- lobby ----------
const PHASE = { briefing: 'briefing', descent: 'drilling', route: 'at a fork', encounter: 'fighting', aftermath: 'after a fight', port: 'at port', discovery: 'exploring', gameover: 'lost', ending: 'at the core' };
net.on('lobby', ({ worlds }) => {
  if (currentWorldId) return;
  show('lobby');
  const list = $('world-list');
  list.innerHTML = '';
  $('world-empty').classList.toggle('hidden', worlds.length > 0);
  $('lobby-count').textContent = `${worlds.length} saved`;
  for (const w of worlds) {
    const li = document.createElement('li');
    const mine = w.hostId === me;
    const pill = w.run.status === 'won' ? '<span class="pill won">won</span>'
      : w.run.status === 'lost' ? '<span class="pill lost">lost</span>'
      : w.status === 'running' ? '<span class="pill live">live</span>'
      : `<span class="pill">${w.online ? 'waiting for host' : 'saved'}</span>`;
    li.innerHTML = `
      <div class="name"></div>
      <button>${mine ? 'Resume' : 'Board'}</button>
      <div class="meta"></div>`;
    li.querySelector('.name').textContent = w.name;
    li.querySelector('.name').insertAdjacentHTML('beforeend', pill + (mine ? '<span class="pill">your ship</span>' : ''));
    li.querySelector('.meta').textContent =
      `Host ${w.hostName}${w.hostOnline ? ' (aboard)' : ''} · ${w.online}/${w.maxPlayers} aboard · ` +
      `Run #${w.run.number} · level ${w.run.level || 1}, ${w.run.depthKm.toLocaleString()} km${PHASE[w.run.phase] ? `, ${PHASE[w.run.phase]}` : ''} · hull ${w.run.hull}% · ${ago(w.lastPlayedAt)}`;
    const btn = li.querySelector('button');
    btn.disabled = w.online >= w.maxPlayers;
    btn.onclick = () => { setWorld(w.id); net.send({ t: 'join', worldId: w.id }); };
    list.append(li);
  }
});

const form = $('create-form');
form.maxPlayers.addEventListener('input', () => { $('max-label').textContent = form.maxPlayers.value; });
form.addEventListener('submit', (e) => {
  e.preventDefault();
  net.send({
    t: 'create', name: form.name.value, maxPlayers: Number(form.maxPlayers.value),
    allowPlayWithoutHost: form.allowPlayWithoutHost.checked, playerClass: form.playerClass.value,
  });
  form.reset(); $('max-label').textContent = '4';
});

// ---------- aboard ----------
net.on('world', ({ world: w }) => {
  if (playingSolo) return;
  setWorld(w.id);
  if (!online || online.worldId !== w.id) startOnline(w.id);
  online.ctl.meta(w);
});
net.on('g', (m) => { if (online && !playingSolo) online.ctl.frame(m); });

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

net.connect();
