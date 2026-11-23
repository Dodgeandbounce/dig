import { Net, loadIdentity, saveIdentity } from './net.js';
import { createRenderer } from './render.js';
import { LAYERS, EARTH_CENTER_KM } from './shared/constants.js';
import { launchSolo } from './game/app.js';

const $ = (id) => document.getElementById(id);
const net = new Net();
const renderer = createRenderer($('canvas'));
let identity = loadIdentity();
let currentWorldId = sessionStorage.getItem('doigo.world'); // survives reloads / reconnects
let me = null;
let playingSolo = false;

// ---------- screens ----------
function show(name) {
  if (playingSolo && name !== 'game') return; // lobby updates don't yank you out of a solo run
  for (const s of ['name', 'lobby', 'ship', 'game']) $(`screen-${s}`).classList.toggle('hidden', s !== name);
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

// ---------- connection ----------
net.on('open', () => {
  $('conn').textContent = 'online'; $('conn').classList.add('ok');
  if (identity.name) net.send({ t: 'hello', ...identity });
});
net.on('close', () => { $('conn').textContent = 'offline (solo still works)'; $('conn').classList.remove('ok'); });
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
  if (m.message.includes('no longer exists') || m.message.includes('full')) { setWorld(null); show('lobby'); }
});
net.on('left', (m) => { setWorld(null); show('lobby'); if (m.reason) toast(m.reason); });

// ---------- name ----------
$('name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  identity.name = $('name-input').value.trim();
  net.send({ t: 'hello', ...identity });
});
if (identity.name) $('name-input').value = identity.name; else show('name');

// ---------- lobby ----------
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
      `Run #${w.run.number} · ${w.run.depthKm.toLocaleString()} km · hull ${w.run.hull}% · ${ago(w.lastPlayedAt)}`;
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
  net.send({ t: 'create', name: form.name.value, maxPlayers: Number(form.maxPlayers.value), allowPlayWithoutHost: form.allowPlayWithoutHost.checked });
  form.reset(); $('max-label').textContent = '4';
});

// ---------- ship ----------
net.on('world', ({ world: w }) => {
  if (playingSolo) return;
  setWorld(w.id);
  show('ship');
  renderer.set(w);
  const host = w.hostId === me;
  $('ship-name').textContent = w.name;
  $('s-run').textContent = `#${w.run.number}`;
  $('s-depth').textContent = `${Math.round(w.run.depthKm).toLocaleString()} / ${EARTH_CENTER_KM.toLocaleString()} km`;
  $('s-layer').textContent = LAYERS.find((l) => l.id === w.run.layer)?.name ?? '';
  const hull = Math.round(w.run.hull);
  $('s-hull').textContent = `Hull ${hull}%`;
  $('hull-fill').style.width = `${hull}%`;
  $('hull-fill').style.background = hull > 50 ? 'var(--good)' : hull > 25 ? 'var(--accent)' : 'var(--danger)';
  $('btn-repair').disabled = w.status !== 'running';
  $('host-panel').classList.toggle('hidden', !host);
  $('btn-restart').textContent = w.run.status === 'active' ? 'End run early & restart' : 'Start a new run';

  const banner = $('banner');
  const msg = w.run.status === 'won' ? `🏆 You reached the center of the earth! ${host ? 'Start a new run whenever you like.' : 'Waiting for the host.'}`
    : w.run.status === 'lost' ? `💀 The ship was crushed at ${Math.round(w.run.depthKm).toLocaleString()} km. ${host ? 'Restart or scuttle it.' : 'Waiting for the host to decide.'}`
    : w.pausedReason ? `⏸ ${w.pausedReason} — the drill is idle.` : '';
  banner.textContent = msg; banner.classList.toggle('hidden', !msg);

  $('crew-count').textContent = `${w.online}/${w.maxPlayers} aboard`;
  $('crew').innerHTML = '';
  for (const m of [...w.members].sort((a, b) => b.online - a.online)) {
    const li = document.createElement('li');
    li.className = m.online ? '' : 'off';
    li.innerHTML = '<span><span class="dot"></span><span class="n"></span></span><span class="muted small"></span>';
    li.querySelector('.n').textContent = m.name + (m.host ? ' ★' : '') + (m.id === me ? ' (you)' : '');
    li.querySelectorAll('span')[3].textContent = `${m.repairs} repairs`;
    $('crew').append(li);
  }

  const log = $('log');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  log.innerHTML = '';
  for (const e of w.log) {
    const li = document.createElement('li');
    li.className = e.kind;
    li.textContent = e.who ? `${e.who}: ${e.text}` : e.text;
    log.append(li);
  }
  if (atBottom) log.scrollTop = log.scrollHeight;
});

const repair = () => net.send({ t: 'repair' });
$('btn-repair').onclick = repair;
addEventListener('keydown', (e) => {
  if (playingSolo) return;
  if (e.code === 'Space' && currentWorldId && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); repair(); }
});
$('btn-leave').onclick = () => { net.send({ t: 'leave' }); setWorld(null); };
$('btn-restart').onclick = () => { if (confirm('End this run and start over? Depth resets to 0.')) net.send({ t: 'restart' }); };
$('btn-shelve').onclick = () => net.send({ t: 'shelve' });
$('btn-destroy').onclick = () => {
  if (confirm('Destroy this ship forever? Everyone aboard is sent back to the lobby and the save is deleted.')) net.send({ t: 'destroy' });
};
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  if (input.value.trim()) net.send({ t: 'chat', text: input.value });
  input.value = '';
});

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

net.connect();
