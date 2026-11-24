import { Net, loadIdentity, saveIdentity } from './net.js';
import { launchSolo, launchOnline } from './game/app.js';
import { sfx, initAudio } from './game/audio.js';
import { CLASSES } from '../shared/sim/data.js';

// menus sound like digging: hover a button for a scoop of dirt, click it for a shovel clank
let hovered = null;
document.addEventListener('mouseover', (e) => {
  const b = e.target.closest?.('button, .node, .cls, .lb-row');
  if (b && b !== hovered && !b.disabled) sfx.uiHover();
  hovered = b;
});
document.addEventListener('click', (e) => {
  initAudio();
  const b = e.target.closest?.('button, .lb-row');
  if (b && !b.disabled && !b.closest('.g-card, .g-actions, .g-spawn, .pick')) sfx.ui();   // (those play their own click)
}, true);

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
    // a finished solo run goes on the shared leaderboard (when we're connected and have said hello)
    submit: (entry) => { if (me) { net.send({ t: 'score', entry }); setTimeout(loadBoard, 1500); } },
    onExit: () => {
      playingSolo = false;
      $('screen-game').innerHTML = '';
      show(me ? 'lobby' : 'name');
      if (me) net.send({ t: 'hello', ...identity });
      loadBoard();
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

// ---------- leaderboard ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let board = [];
let openRow = null;
async function loadBoard() {
  try { const r = await fetch('api/leaderboard', { cache: 'no-store' }); if (r.ok) { board = await r.json(); drawBoard(); } } catch { /* offline: solo still works */ }
}
function drawBoard() {
  const html = board.length ? board.slice(0, 25).map((e, i) => {
    const who = e.players?.length ? e.players.join(', ') : e.host || '?';
    const mins = Math.round((e.time || 0) / 60);
    const open = openRow === i;
    return `<li class="lb-row ${e.won ? 'won' : ''} ${open ? 'open' : ''}" data-i="${i}">
      <div class="lb-head"><span class="rank">${i + 1}</span><b>${esc(e.ship)}</b><span class="lb-score">${(e.score || 0).toLocaleString()}</span></div>
      <div class="lb-sub">${e.won ? (e.joe === 'saved' ? '💪🤝💪 ' : '☀ ') : ''}${esc(e.result || '')} · ${esc(who)} · ${e.solo ? 'solo' : 'online'} · ${ago(e.at)}</div>
      ${open ? `<div class="lb-more">
        <p>Reached <b>-${e.depthKm}km</b> (stop ${e.level}) in ${mins} min${e.path ? ` · ${e.path === 'brother' ? 'went after Joe' : 'took the main shaft'}` : ''}${e.online && e.run ? ` · run #${e.run}` : ''}</p>
        <p>${e.stats?.kills || 0} kills · ${e.stats?.gems || 0} gem value · ${e.stats?.repairs || 0} repairs · ${e.stats?.meals || 0} meals · ${e.stats?.captures || 0} captures · ${e.stats?.insults || 0} insults</p>
        <p class="muted">Ship: ${e.rooms || '?'} rooms · plating ${e.upgrades?.plating || 0}, bubble ${e.upgrades?.bubble || 0}, D-gun ${e.upgrades?.dgun || 0} · guns: ${(e.guns || []).join(', ') || 'D-gun'}</p>
        <div class="lb-crew">${(e.crew || []).map((c) => `<span style="--c:${CLASSES[c.cls]?.color || '#888'}" title="${esc(CLASSES[c.cls]?.name || c.cls)}">${esc(c.name)}${c.player ? ` <i>(${esc(c.player)})</i>` : ''} <small>★${c.stars || 0}</small></span>`).join('')}</div>
      </div>` : ''}
    </li>`;
  }).join('') : '<li class="muted">No finished runs yet. Be the first!</li>';
  for (const el of document.querySelectorAll('[data-lb]')) el.innerHTML = html;
}
document.addEventListener('click', (e) => {
  const row = e.target.closest?.('.lb-row');
  if (!row) return;
  const i = +row.dataset.i;
  openRow = openRow === i ? null : i;
  drawBoard();
});
loadBoard();
setInterval(() => { if (!document.body.classList.contains('playing')) loadBoard(); }, 30000);

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

net.connect();
