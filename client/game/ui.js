// DOM overlays: HUD, ability bar, crew list, docking duel, route picker, stories,
// the port, station panels, upgrades, pause and the end screens.
import {
  CLASSES, ABILITIES, WEAPONS, CLASS_UPGRADES, UPGRADE_BASE_COST, SHIP_UPGRADES, BUYABLE_ROOMS, ROOMS, RECIPES, RESEARCH,
  NODE_TYPES, KM_PER_LEVEL, LEVELS, FOODS,
} from '../shared/sim/data.js';
import { interactTarget } from '../shared/sim/classes.js';
import { speedFactor } from '../shared/sim/pilot.js';
import { drawMob, drawCrew } from './sprites.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => `${Math.max(0, Math.min(100, (a / b) * 100)).toFixed(1)}%`;

export function createUI(root, api) {
  root.innerHTML = `
    <canvas class="g-canvas"></canvas>
    <div class="g-top">
      <div class="g-ship"><b class="g-shipname"></b><span class="g-level"></span></div>
      <div class="g-meters">
        <div class="g-meter hull"><span>HULL</span><div><i></i></div><em></em></div>
        <div class="g-meter fuel"><span>FUEL</span><div><i></i></div><em></em></div>
        <div class="g-pips" title="Bubble defense"></div>
      </div>
      <div class="g-res"></div>
    </div>
    <div class="g-phase"></div>
    <div class="g-duel hidden"></div>
    <div class="g-me"></div>
    <div class="g-crew"></div>
    <div class="g-log"></div>
    <div class="g-prompt hidden"></div>
    <div class="g-banner hidden"></div>
    <div class="g-modal hidden"><div class="g-card"></div></div>
    <div class="g-toast hidden"></div>
  `;
  const $ = (s) => root.querySelector(s);
  const canvas = $('.g-canvas');
  const modal = $('.g-modal'), card = $('.g-card');
  let modalKind = null, modalData = null, lastHtml = '';
  let logItems = [];
  let briefShownFor = -1;
  let portTab = 'market';
  let roomPick = null; // { type } while choosing where to build
  let typed = '';

  // ---- click handling (delegated)
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = JSON.parse(b.dataset.act);
    api.sfx?.ui();
    if (act.close) { closeModal(); return; }
    if (act.tab) { portTab = act.tab; roomPick = null; render(true); return; }
    if (act.pick) { roomPick = act.pick; render(true); return; }
    if (act.ui) { api.ui(act.ui, act); return; }
    api.cmd(act);
    if (act.t === 'route' || act.t === 'storyOk' || act.t === 'continue' || act.t === 'depart') closeModal();
    if (act.t === 'helm' && act.on) closeModal();
    if (act.t === 'buyRoom') roomPick = null;
    setTimeout(() => render(true), 30);
  });
  card.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.form === 'transponder') { api.cmd({ t: 'transponder', code: f.code.value }); f.code.value = ''; setTimeout(() => render(true), 60); }
  });

  function openModal(kind, data) { modalKind = kind; modalData = data; lastHtml = ''; modal.classList.remove('hidden'); modal.dataset.kind = kind; render(true); }
  function closeModal() { modalKind = null; modalData = null; modal.classList.add('hidden'); api.onClose?.(); }
  const isOpen = () => !!modalKind;

  function toast(text) { const el = $('.g-toast'); el.textContent = text; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2600); }

  // -------------------------------------------------------------------------
  function update(g, me, view) {
    root.classList.toggle('piloting', !!view.pilot);
    // top bar
    const s = g.ship;
    $('.g-shipname').textContent = s.name;
    $('.g-level').textContent = `Level ${g.level}/${LEVELS} · Sea Level: −${g.depthKm.toLocaleString()} km${g.path === 'brother' ? ' · following Joe' : ''}`;
    setMeter('.hull', s.hull, s.hullMax, s.hull < s.hullMax * 0.3 ? 'bad' : '');
    setMeter('.fuel', s.fuel, s.fuelMax, s.fuel < 25 ? 'bad' : '');
    $('.g-pips').innerHTML = Array.from({ length: s.bubbleMax }, (_, k) => `<i class="${k < s.bubble ? 'on' : ''}"></i>`).join('') + '<small>bubble</small>';
    $('.g-res').innerHTML = `<span title="Gems in the vault">💎 ${s.gems}/${s.gemCap}</span><span title="Scrap (repairs, gadgets, missiles)">⚙ ${Math.floor(s.scrap)}</span><span title="D-missiles">🚀 ${s.missiles}/${s.missilesMax}</span>` +
      (g.breaches ? `<span class="bad" title="Hull breaches leak dirt and drain the hull">🕳 ${g.breaches}</span>` : '') +
      (g.cleanBuff ? '<span class="good" title="Clean ship: +10% speed">✨ clean</span>' : g.messCount > 4 ? `<span title="Messy ship">🧹 ${g.messCount}</span>` : '');

    // phase line
    const ph = $('.g-phase');
    const P = {
      briefing: 'Briefing', descent: g.descent?.stranded ? '⚠ STRANDED — out of fuel' : `Descending · ${Math.round(g.descent.progress * 100)}% to the next stop`,
      route: 'Choose the route', encounter: g.enemyShip ? (g.enemyShip.done ? 'Enemy ship beaten — clear the boarders' : `DOCKED: ${g.enemyShip.name}`) : g.nest ? 'Creatures burrowing in!' : 'Encounter',
      aftermath: 'Aftermath', port: g.port ? `Docked at ${g.port.name}` : 'Port', discovery: 'Discovery', gameover: 'Lost', ending: 'The center of the world',
    }[g.phase] || g.phase;
    ph.textContent = P;
    ph.className = 'g-phase ' + g.phase;

    // duel
    const duel = $('.g-duel');
    const es = g.enemyShip;
    if (g.phase === 'encounter' && es && !es.gone && es.kind !== 'derelict' && es.kind !== 'pod') {
      duel.classList.remove('hidden');
      const gp = 5 / (1 + 0.15 * s.up.dgun), mp = 9 / (1 + 0.1 * s.up.dmissile);
      duel.innerHTML = `
        <div class="side us"><b>${esc(s.name)}</b>
          <div class="dbar"><label>D-Gun</label><div><i style="width:${pct(s.dgunT, gp)}"></i></div></div>
          <div class="dbar ${s.missileReady ? 'ready' : ''}"><label>D-Missile ${s.missiles ? '' : '(empty)'}</label><div><i style="width:${s.missileReady ? '100%' : pct(s.missileT, mp)}"></i></div></div>
          ${s.evasiveT > 0 ? '<em class="good">EVASIVE!</em>' : ''}
        </div>
        <div class="vs">VS</div>
        <div class="side them"><b>${esc(es.name)}</b>
          <div class="dbar hullb"><label>Hull</label><div><i style="width:${pct(es.hull, es.hullMax)}"></i></div></div>
          <div class="dbar"><label>Gun</label><div><i style="width:${pct(es.gunT, es.gunPeriod)}"></i></div></div>
          <div class="dbar"><label>Missile</label><div><i style="width:${pct(es.missileT, es.missilePeriod)}"></i></div></div>
          <small>bubble ${'●'.repeat(es.bubble)}${'○'.repeat(Math.max(0, es.bubbleMax - es.bubble))} · ${es.crewLeft} more boarders</small>
        </div>`;
    } else if (g.phase === 'encounter' && g.boss && g.boss.alive) {
      duel.classList.remove('hidden');
      duel.innerHTML = `<div class="side them wide"><b>☀ ${esc(g.boss.name)}</b><div class="dbar hullb"><label>HP</label><div><i style="width:${pct(g.boss.hp, g.boss.maxHp)}"></i></div></div></div>`;
    } else duel.classList.add('hidden');

    // me
    if (me) renderMe(g, me);
    // crew list
    renderCrew(g, me);
    // log
    const logEl = $('.g-log');
    if (logItems.length) {
      logEl.innerHTML = logItems.slice(-7).map((l) => `<div class="l-${l.kind}" style="opacity:${Math.max(0.25, 1 - (performance.now() - l.at) / 16000)}">${esc(l.text)}</div>`).join('');
    }
    // prompt
    const pr = $('.g-prompt');
    const it = me && me.alive && !view.pilot ? interactTarget(g, me) : null;
    if (it && !isOpen()) { pr.classList.remove('hidden'); pr.innerHTML = `<kbd>E</kbd> ${esc(it.label)}`; }
    else if (view.pilot) { pr.classList.remove('hidden'); pr.innerHTML = '<kbd>WASD</kbd> steer · <kbd>Shift</kbd> boost · <kbd>E</kbd> leave the helm'; }
    else pr.classList.add('hidden');

    // banner (level briefing)
    const banner = $('.g-banner');
    if (g.phase === 'briefing' && !g.storyOpen) {
      banner.classList.remove('hidden');
      if (briefShownFor !== g.level) { briefShownFor = g.level; renderBriefing(g, banner); }
      banner.querySelector('.dig').classList.toggle('show', g.phaseT > 3.6);
      banner.querySelector('.mix').classList.toggle('show', g.phaseT > 1.3);
    } else banner.classList.add('hidden');

    // stranded call
    if (g.phase === 'descent' && g.descent.stranded && modalKind !== 'stranded') openModal('stranded');

    // auto modals by phase
    if (g.storyOpen && modalKind !== 'story') openModal('story', g.storyOpen);
    else if (!g.storyOpen && modalKind === 'story') closeModal();
    if (!g.storyOpen) {
      if (g.phase === 'route' && modalKind !== 'route') openModal('route');
      if (g.phase === 'port' && modalKind !== 'port' && modalKind !== 'upgrades') openModal('port');
      if (g.phase === 'aftermath' && modalKind !== 'aftermath') openModal('aftermath');
      if ((g.phase === 'gameover' || g.phase === 'ending') && modalKind !== 'end' && g.phaseT > 1.5) openModal('end');
      if (modalKind === 'route' && g.phase !== 'route') closeModal();
      if (modalKind === 'port' && g.phase !== 'port') closeModal();
      if (modalKind === 'aftermath' && g.phase !== 'aftermath') closeModal();
      if (modalKind === 'stranded' && !(g.phase === 'descent' && g.descent.stranded)) closeModal();
    }
    render(false);
  }

  function setMeter(sel, v, max, cls) {
    const m = $('.g-meter' + sel);
    m.querySelector('i').style.width = pct(v, max);
    m.querySelector('em').textContent = `${Math.ceil(v)}/${max}`;
    m.classList.toggle('bad', cls === 'bad');
  }

  function renderMe(g, me) {
    const def = CLASSES[me.cls];
    const el = $('.g-me');
    const slots = [];
    const w = me.cls === 'vaelift' ? `Vurfenstaff (${me.form})` : CLASSES[me.cls].weapon;
    slots.push(slot('LMB', weaponName(me), me.cd.fire, WEAPONS[def.weapon]?.rate || 1));
    for (const [key, k] of [['rmb', 'RMB'], ['q', 'Q'], ['f', 'F'], ['space', 'SPACE']]) {
      const id = def.abilities[key];
      if (!id) continue;
      const A = ABILITIES[id];
      let label = A.name;
      if (id === 'jarswap') label = `Jar: ${me.jar}`;
      if (id === 'minetype') label = `Mine: ${me.mineType}`;
      if (id === 'staffform') label = `Staff: ${me.form}`;
      if (id === 'cloak' && me.cloaked) label = 'Uncloak';
      if (id === 'phase' && me.phased) label = `Phased ${me.phaseT.toFixed(1)}s`;
      slots.push(slot(k, label, me.cd[key] || 0, A.cd || 1, A.desc));
    }
    if (me.cls === 'agent') slots.push(slot('RMB', 'Detonate remotes', 0, 1));
    if (me.cls === 'farmer') slots.push(slot('RMB', 'Pitchfork', me.cd.q, 5));
    if (me.cls === 'chef') slots.push(slot('RMB', 'Fish slap', me.cd.f, 9));
    const buffs = (me.buffs || []).map((b) => `<span class="buff" title="${esc(JSON.stringify(b))}">${b.tag || 'buff'} ${Math.ceil(b.t)}s</span>`).join('');
    const extra = [];
    if (me.cls === 'trainer') extra.push(`Monsters: ${me.monsters.map((m) => `${esc(m.name)}${m.out ? ' (out)' : m.reviveT > 0 ? ` (${Math.ceil(m.reviveT)}s)` : ''}`).join(', ') || 'none yet — weaken an enemy, then Q'}`);
    if (me.cls === 'agent') extra.push(`Mission rank ${me.missionRank || 0}`);
    if (me.cls === 'slots' && me.coinWinT > 0) extra.push(`<b class="good">WINNING STREAK ×${me.coinWinMul} (${Math.ceil(me.coinWinT)}s)</b>`);
    if (me.makeshift > 0) extra.push(`Makeshift gun ${Math.ceil(me.makeshift)}s`);
    if (me.cls === 'urchid') extra.push('Contributes nothing. Cannot die. Living the dream.');
    el.innerHTML = `
      <div class="who"><canvas class="portrait" width="56" height="56"></canvas>
        <div><b>${esc(me.name)}</b> <span class="muted">${def.name}</span>
          <div class="hp"><i style="width:${pct(me.hp, me.maxHp)}"></i><em>${me.alive ? `${Math.ceil(me.hp)} HP` : `DOWN ${Math.ceil(me.downT)}s`}</em></div>
          <div class="wallet">💰 ${Math.floor(me.wallet)} <span class="muted">· <kbd>Tab</kbd> upgrades · <kbd>Esc</kbd> menu</span></div>
        </div></div>
      <div class="slots">${slots.join('')}</div>
      ${extra.length ? `<div class="extra">${extra.join(' · ')}</div>` : ''}
      ${buffs ? `<div class="buffs">${buffs}</div>` : ''}`;
    const pc = el.querySelector('.portrait').getContext('2d');
    pc.clearRect(0, 0, 56, 56);
    drawCrew(pc, { ...me, x: 28, y: 30, r: 16, facing: -Math.PI / 2, alive: true, hurtT: 0, cloaked: false, phased: false, moving: false, swingT: 0 }, performance.now() / 1000);
  }
  function weaponName(me) {
    return { pistol: 'Blaster', wrench: 'Wrench (repairs too)', heckle: 'Heckle', dualpistol: 'Dual pistols', cleaver: 'Cleaver', axe: 'Axe', rocket: 'Rockets', rifle: 'Assault rifle',
      shotgun: 'Shotgun', jar: `Throw ${me.jar} jar`, bite: 'Bite', dagger: 'Dagger (backstab)', whip: 'Whip', bubble: 'Blow bubbles', staff: 'Vurfenstaff', ppk: 'Walther PPK', coins: 'Fire coins ($1)' }[CLASSES[me.cls].weapon];
  }
  function slot(key, label, cd, max, desc = '') {
    const f = cd > 0 ? Math.min(1, cd / max) : 0;
    return `<div class="slot ${cd > 0 ? 'cd' : ''}" title="${esc(desc)}"><kbd>${key}</kbd><span>${esc(label)}</span>${cd > 0.05 ? `<i style="height:${(f * 100).toFixed(0)}%"></i><em>${cd.toFixed(1)}</em>` : ''}</div>`;
  }

  function renderCrew(g, me) {
    const el = $('.g-crew');
    el.innerHTML = `<h4>Crew ${g.crew.length}/17</h4>` + g.crew.map((c) => `
      <div class="cm ${c.alive ? '' : 'down'} ${c === me ? 'me' : ''}" style="--c:${CLASSES[c.cls].color}">
        <span class="dot"></span><span class="n">${esc(c.name)}</span><span class="cl">${CLASSES[c.cls].name}</span>
        <span class="mini"><i style="width:${c.cls === 'urchid' ? 100 : pct(c.hp, c.maxHp)}"></i></span>
      </div>`).join('') + (g.joe.state === 'saved' ? '<div class="cm" style="--c:#f0a030"><span class="dot"></span><span class="n">Joe</span><span class="cl">Brother · NPC</span></div>' : '');
  }

  function renderBriefing(g, banner) {
    banner.innerHTML = `
      <div class="lvl">Level ${g.level}</div>
      <div class="sea">Sea Level: −${g.depthKm.toLocaleString()} km</div>
      <div class="mix">${g.mix.map((m) => `<div class="foe"><canvas width="64" height="64" data-type="${m.type}"></canvas><b>${esc(g.roster[m.type].name)}</b><span>${m.pct}%</span></div>`).join('')}</div>
      <div class="dig">DIG!</div>`;
    banner.querySelectorAll('canvas').forEach((cv) => {
      const type = g.roster[+cv.dataset.type];
      const c = cv.getContext('2d');
      drawMob(c, { x: 32, y: 32, r: 14 * type.size, facing: Math.PI / 2, id: 1 }, type, 0);
    });
  }

  // -------------------------------------------------------------------------
  function render(force) {
    if (!modalKind) return;
    const g = api.game(), me = api.me();
    if (!g) return;
    let html = '';
    switch (modalKind) {
      case 'story': html = storyHtml(g.storyOpen); break;
      case 'route': html = routeHtml(g, me); break;
      case 'port': html = portHtml(g, me); break;
      case 'aftermath': html = aftermathHtml(g); break;
      case 'panel': html = panelHtml(g, me, modalData); break;
      case 'upgrades': html = upgradesHtml(g, me); break;
      case 'pause': html = pauseHtml(g); break;
      case 'help': html = helpHtml(); break;
      case 'end': html = endHtml(g); break;
      case 'stranded': html = `<h2>⚠ Stranded</h2><p>Out of fuel in the middle of the dirt. You can call for a fuel drop (60 money). Every ship in the area will hear it — expect company.</p><div class="row"><button data-act='{"t":"callFuel"}'>Call for fuel (60)</button></div>`; break;
    }
    if (force || html !== lastHtml) {
      // keep typed input in forms
      const input = card.querySelector('input[name=code]');
      const val = input?.value; const focused = document.activeElement === input;
      card.innerHTML = html; lastHtml = html;
      const ni = card.querySelector('input[name=code]');
      if (ni && val) ni.value = val;
      if (ni && focused) ni.focus();
    }
  }

  function storyHtml(s) {
    if (!s) return '';
    const btns = s.choices ? s.choices.map((c) => `<button data-act='${JSON.stringify({ t: 'storyOk', choice: c.id })}'>${esc(c.label)}</button>`).join('') : `<button data-act='{"t":"storyOk"}'>${s.kind === 'journal' ? 'Close the journal' : 'Keep digging'}</button>`;
    return `<div class="story ${s.kind}"><h2>${esc(s.title)}</h2>${s.lines.map((l) => `<p>${esc(l)}</p>`).join('')}<div class="row">${btns}</div></div>`;
  }

  function routeHtml(g, me) {
    const nodes = g.route?.nodes || [];
    const pilot = g.crew.find((c) => c.cls === 'pilot');
    const locked = nodes.find((n) => n.locked);
    return `<h2>The tunnel forks</h2>
      <p class="muted">${pilot?.human ? 'You\'re the pilot. Pick where we stop next.' : `${esc(pilot?.name || 'The pilot')} is waiting for your call (picks in ${Math.max(0, Math.ceil(6 - (g.route?.t || 0)))}s).`}
      Fuel ${Math.ceil(g.ship.fuel)}/${g.ship.fuelMax} · Hull ${Math.ceil(g.ship.hull)}/${g.ship.hullMax}</p>
      <div class="nodes">${nodes.map((n, i) => `<button class="node ${n.locked ? 'locked' : ''}" style="--c:${n.color}" ${n.locked ? 'disabled' : ''} data-act='${JSON.stringify({ t: 'route', i })}'>
        <span class="ic">${n.icon}</span><b>${esc(n.name)}</b><span>${esc(n.desc)}</span></button>`).join('')}</div>
      ${locked ? `<form data-form="transponder" class="tp"><label>Targeting computer — transponder ID</label><div class="row"><input name="code" maxlength="6" autocomplete="off" placeholder="####"><button>Lock on</button></div></form>` : ''}`;
  }

  function aftermathHtml(g) {
    const l = g.lastLoot;
    const crates = g.objs.filter((o) => o.kind === 'crate').length;
    return `<h2>${g.enemyShip?.kind === 'ship' || g.lastLoot ? 'Victory!' : 'All clear'}</h2>
      ${l ? `<p>+${Math.round(l.scrap)} scrap · +${l.gems} gems · +${Math.round(l.money)} money for everyone</p>` : ''}
      ${crates ? `<p class="muted">${crates} loot crate${crates > 1 ? 's' : ''} left on their ship. Grab them (E) or the crew strips them when you go.</p>` : ''}
      ${g.breaches ? `<p class="bad">${g.breaches} hull breach${g.breaches > 1 ? 'es' : ''} still open. They'll keep leaking.</p>` : ''}
      <p class="muted">Take a moment: repair (hold E), clean up, cook, research. Then undock.</p>
      <div class="row"><button data-act='{"t":"continue"}'>${g.resume ? 'Back to the descent' : 'Undock & keep digging'}</button><button class="ghost" data-act='{"close":1}'>Stay a bit</button></div>`;
  }

  function portHtml(g, me) {
    const P = g.port; if (!P) return '';
    const s = g.ship;
    const tabs = ['market', 'ship', 'rooms', 'crew'].filter((t) => (t === 'rooms' ? P.rooms : t === 'ship' ? P.upgrades : true));
    const tabBtns = tabs.map((t) => `<button class="tab ${portTab === t ? 'on' : ''}" data-act='${JSON.stringify({ tab: t })}'>${{ market: 'Market', ship: 'Ship upgrades', rooms: 'Build rooms', crew: 'Crew & class' }[t]}</button>`).join('');
    let body = '';
    const btn = (label, act, ok = true) => `<button ${ok ? '' : 'disabled'} data-act='${JSON.stringify(act)}'>${label}</button>`;
    if (portTab === 'market' || !tabs.includes(portTab)) {
      const fuelNeed = Math.ceil(s.fuelMax - s.fuel), hullNeed = Math.ceil(s.hullMax - s.hull);
      body = `<div class="grid2">
        <div class="item"><b>💎 Sell gems</b><span>${s.gems} gems × ${P.gemPrice} = ${s.gems * P.gemPrice}, split between ${g.crew.length} crew</span>${btn('Sell all', { t: 'sell' }, s.gems > 0)}</div>
        <div class="item"><b>⛽ Fuel</b><span>${fuelNeed} needed · ${P.fuelPrice}/unit</span>${btn(`Fill up (${Math.ceil(fuelNeed * P.fuelPrice)})`, { t: 'buyFuel' }, fuelNeed > 0 && me.wallet >= 1)}</div>
        <div class="item"><b>🛠 Hull patch</b><span>${hullNeed} hull missing · 1 per 2 hull</span>${btn(`Patch (${Math.ceil(hullNeed / 2)})`, { t: 'repairHull' }, hullNeed > 0 && me.wallet >= 1)}</div>
        <div class="item"><b>🔧 Dock crew</b><span>Fix every system, door, wall and breach</span>${btn('Fix all (40)', { t: 'fixAll' }, me.wallet >= 40)}</div>
        ${P.shop ? `<div class="item"><b>🚀 D-missile</b><span>${s.missiles}/${s.missilesMax} in the rack</span>${btn('Buy (25)', { t: 'buyMissile' }, me.wallet >= 25 && s.missiles < s.missilesMax)}</div>
        <div class="item"><b>⚙ Scrap</b><span>25 scrap for repairs & gadgets</span>${btn('Buy (20)', { t: 'buyScrap' }, me.wallet >= 20)}</div>
        <div class="item"><b>🍖 Groceries</b><span>1 grub, shroom, fish, spice</span>${btn('Buy (15)', { t: 'buyFood' }, me.wallet >= 15)}</div>
        ${s.food.crops ? `<div class="item"><b>🌽 Sell crops</b><span>${s.food.crops} crops</span>${btn('Sell', { t: 'sellCrops' })}</div>` : ''}
        ${me.cls === 'agent' ? `<div class="item"><b>🍸 Meet a contact</b><span>Swap "knowledge" for "information": more marked targets</span>${btn('Buy intel (40)', { t: 'buyIntel' }, me.wallet >= 40)}</div>` : ''}` : ''}
      </div>`;
    } else if (portTab === 'ship') {
      body = `<div class="grid2">${Object.entries(SHIP_UPGRADES).map(([id, u]) => { const lvl = s.up[id]; const cost = u.cost * (lvl + 1);
        return `<div class="item"><b>${u.name} <small>Lv ${lvl}/5</small></b><span>${u.desc}</span>${lvl >= 5 ? '<em>MAX</em>' : btn(`Upgrade (${cost})`, { t: 'buyUpgrade', id }, me.wallet >= cost)}</div>`; }).join('')}</div>`;
    } else if (portTab === 'rooms') {
      if (roomPick) {
        body = `<p>Where should the new <b>${ROOMS[roomPick].name}</b> go? Click a free slot.</p>${shipMapHtml(g, roomPick)}<div class="row"><button class="ghost" data-act='{"pick":null}'>Cancel</button></div>`;
      } else {
        body = `<p class="muted">The ship grows one room at a time. New crew bring their own room. Rooms are ${g.ourRooms.length}/66.</p><div class="grid2">${BUYABLE_ROOMS.map((r) => { const n = g.ourRooms.filter((x) => x.type === r.type).length; const cost = Math.round(r.cost * (1 + 0.5 * n));
          return `<div class="item"><b>${ROOMS[r.type].name} <small>×${n}</small></b><span>${r.desc}</span>${btn(`Build (${cost})`, { pick: r.type }, me.wallet >= cost)}</div>`; }).join('')}</div>${shipMapHtml(g, null)}`;
      }
    } else if (portTab === 'crew') {
      const others = g.crew.filter((c) => c !== me && c.cls !== 'urchid');
      body = `${P.recruits.length ? `<p class="good">New crew signed on here: ${P.recruits.map((c) => CLASSES[c].name).join(', ')}</p>` : ''}
        <p>Switch who you play as. Every class plays its own game.</p>
        <div class="classes">${others.map((c) => `<button class="cls" style="--c:${CLASSES[c.cls].color}" ${c.human || me.cls === 'urchid' ? 'disabled' : ''} data-act='${JSON.stringify({ t: 'switchClass', cls: c.cls })}'>
          <b>${esc(c.name)}</b><span>${CLASSES[c.cls].name}</span><small>${esc(CLASSES[c.cls].blurb)}</small></button>`).join('')}</div>
        <p class="muted">Personal upgrades for ${esc(me.name)}: press <kbd>Tab</kbd> any time.</p>`;
    }
    return `<div class="port"><h2>⚓ ${esc(P.name)}</h2><p class="muted">${esc(P.flavor)}</p>
      <div class="wallet-line">Your money: <b>💰 ${Math.floor(me.wallet)}</b> · Ship gems: 💎 ${s.gems} · Scrap ⚙ ${Math.floor(s.scrap)}</div>
      <div class="tabs">${tabBtns}</div>${body}
      <div class="row end"><button class="ghost" data-act='{"ui":"upgrades"}'>My upgrades</button><button class="big" data-act='{"t":"depart"}'>Undock & dig →</button></div></div>`;
  }

  function shipMapHtml(g, pick) {
    const free = pick ? g.freeSlots() : [];
    const cells = [];
    for (let sy = 0; sy < 6; sy++) for (let sx = 0; sx < 11; sx++) {
      const r = g.ourRooms.find((x) => x.sx === sx && x.sy === sy);
      const f = free.find((x) => x.sx === sx && x.sy === sy);
      if (r) cells.push(`<div class="cell room" style="--c:${ROOMS[r.type].color}" title="${ROOMS[r.type].name}">${ROOMS[r.type].name.split(' ')[0]}</div>`);
      else if (f) cells.push(`<button class="cell free" data-act='${JSON.stringify({ t: 'buyRoom', type: pick, sx, sy })}'>+</button>`);
      else cells.push('<div class="cell"></div>');
    }
    return `<div class="shipmap">${cells.join('')}</div>`;
  }

  function upgradesHtml(g, me) {
    const def = CLASSES[me.cls];
    const ups = CLASS_UPGRADES[me.cls];
    const abil = Object.entries(def.abilities).map(([k, id]) => `<li><kbd>${k.toUpperCase()}</kbd> <b>${ABILITIES[id].name}</b> — ${esc(ABILITIES[id].desc)}</li>`).join('');
    return `<h2>${esc(me.name)} the ${def.name}</h2><p class="muted">${esc(def.blurb)}</p>
      <ul class="abil"><li><kbd>LMB</kbd> <b>${weaponName(me)}</b></li>${abil}</ul>
      <div class="wallet-line">💰 ${Math.floor(me.wallet)}</div>
      <div class="grid2">${ups.map(([name, desc], k) => { const lvl = me.upgrades[k]; const cost = UPGRADE_BASE_COST * (lvl + 1);
        return `<div class="item"><b>${name} <small>${'★'.repeat(lvl)}${'☆'.repeat(5 - lvl)}</small></b><span>${desc}</span>${lvl >= 5 ? '<em>MAX</em>' : `<button ${me.wallet >= cost ? '' : 'disabled'} data-act='${JSON.stringify({ t: 'classUpgrade', track: k })}'>Buy (${cost})</button>`}</div>`; }).join('')}</div>
      <div class="row end"><button data-act='{"close":1}'>Done</button></div>`;
  }

  function pauseHtml(g) {
    return `<h2>Paused</h2><div class="col">
      <button data-act='{"close":1}'>Resume</button>
      <button class="ghost" data-act='{"ui":"help"}'>Controls</button>
      <button class="ghost" data-act='{"ui":"mute"}'>Sound on/off</button>
      <button class="danger" data-act='{"ui":"quit"}'>Abandon run & quit to lobby</button></div>`;
  }

  function helpHtml() {
    return `<h2>How to dig</h2><div class="help">
      <p><kbd>WASD</kbd> move · <kbd>Mouse</kbd> aim · <kbd>LMB</kbd> attack · <kbd>RMB</kbd> <kbd>Q</kbd> <kbd>F</kbd> <kbd>Space</kbd> abilities · <kbd>Shift</kbd> sprint</p>
      <p><kbd>E</kbd> use a station, open/hold doors, unseal doors (clearance). <b>Hold E</b> to repair breaches, walls, doors and systems.</p>
      <p><kbd>Tab</kbd> class upgrades · <kbd>M</kbd> whole-ship view · <kbd>Mouse wheel</kbd> zoom · <kbd>Esc</kbd> menu</p>
      <p><b>The loop:</b> “Sea Level” → enemy mix → <b>DIG!</b> → the pilot steers the descent (rocks hurt, gem veins pay) → pick a stop → fight, shop, or find Joe's notes.</p>
      <p><b>Dockings:</b> doors seal, boarders blow a hole and pour in. Both ships trade D-gun and D-missile fire; bubbles block guns, not missiles. Wreck their bridge + engine or kill their crew and they surrender. You can board them, too.</p>
      <p><b>Everything breaks, everything can be fixed:</b> breaches leak dirt and drain the hull. Engineers whack engines with a wrench. Somebody fix the doors.</p>
      </div><div class="row end"><button data-act='{"close":1}'>Got it</button></div>`;
  }

  function endHtml(g) {
    const won = g.phase === 'ending';
    const score = g.finalScore();
    const scores = api.highScores(g, score);
    return `<div class="end ${won ? 'won' : 'lost'}"><h2>${won ? '☀ The center of the world' : '💀 Lost in the dirt'}</h2>
      ${(won ? g.endLines : [g.endMsg || 'The ship is gone.']).map((l) => `<p>${esc(l)}</p>`).join('')}
      <div class="score">${won && g.joe.state === 'saved' ? '<span class="arms" title="Saved your brother">💪🤝💪</span> ' : ''}${esc(g.ship.name)}: <b>${score.toLocaleString()}</b></div>
      <p class="muted">Depth ${g.depthKm.toLocaleString()} km · ${g.stats.kills} kills · ${g.stats.gems} gems · ${g.stats.repairs} repairs · ${g.stats.meals} meals · ${g.stats.insults} insults</p>
      <h3>DIG high scores</h3><ol class="hs">${scores.map((s) => `<li class="${s.mine ? 'mine' : ''}">${s.arms ? '💪🤝💪 ' : ''}${esc(s.ship)} — ${s.score.toLocaleString()} <small>${esc(s.result)}</small></li>`).join('')}</ol>
      <div class="row"><button data-act='{"ui":"again"}'>Dig again</button><button class="ghost" data-act='{"ui":"quit"}'>Back to the lobby</button></div></div>`;
  }

  // ---------------- station panels
  function panelHtml(g, me, d) {
    const room = d.room != null ? g.rooms[d.room] : null;
    const s = g.ship;
    const head = (t, sub = '') => `<h2>${t}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}`;
    const sysLine = room?.sys ? `<div class="sysline">System ${Math.ceil(room.sys.hp)}/${room.sys.max} ${room.sys.hp < room.sys.max ? '· hold <kbd>E</kbd> at the station to repair' : '· all good'}</div>` : '';
    const owner = room ? CLASSES[ROOMS[room.type]?.cls] : null;
    const notMine = owner && me.cls !== ROOMS[room.type]?.cls;
    const close = `<div class="row end"><button data-act='{"close":1}'>Close</button></div>`;
    const btn = (label, act, ok = true) => `<button ${ok ? '' : 'disabled'} data-act='${JSON.stringify(act)}'>${label}</button>`;
    if (notMine && !['helm', 'weapons', 'vault', 'casino', 'lounge'].includes(d.panel)) return head(room.name, `This is ${owner.name}'s station.`) + sysLine + `<p class="muted">${esc(owner.blurb)}</p>` + close;
    switch (d.panel) {
      case 'helm':
        if (g.phase === 'descent' && me.cls === 'pilot') return head('The Helm', 'Steer through the tunnel toward the light. Rocks and creatures hurt; gem veins and fuel pockets pay.') + sysLine + `<div class="row">${btn('Take the helm', { t: 'helm', on: true })}</div>` + close;
        return head('The Helm', g.phase === 'encounter' ? 'Docked. Press <kbd>Q</kbd> here (pilot) for evasive maneuvers: enemy D-fire misses for 4s.' : 'The pilot steers during the descent.') + sysLine + `<p>Speed ×${speedFactor(g).toFixed(2)} · Fuel ${Math.ceil(s.fuel)}/${s.fuelMax}</p>` + close;
      case 'engine': {
        const engines = g.rooms.filter((r) => r.owner === 'us' && r.type === 'engine');
        return head('Engines', 'More engines = faster descent, more fuel, more to fix. Only engineers fix engines properly (hit them with the wrench).') + engines.map((r, k) => `<div class="sysline">Engine ${k + 1}: ${Math.ceil(r.sys.hp)}/${r.sys.max}</div>`).join('') + `<p>Speed ×${speedFactor(g).toFixed(2)}</p>` + close;
      }
      case 'weapons': {
        const theirs = g.rooms.map((r, i) => ({ r, i })).filter((x) => x.r.owner === 'them');
        const live = g.phase === 'encounter' && g.enemyShip && !g.enemyShip.done;
        return head('D-Weapons Bay', 'D-Gun fires itself. D-Missiles go through bubbles — pick the room to hit.') + sysLine +
          `<p>Missiles ${s.missiles}/${s.missilesMax} ${s.buildT > 0 ? `· building (${s.buildT.toFixed(1)}s)` : ''}</p>
          <div class="row">${btn('Build a missile (12 scrap)', { t: 'buildMissile' }, s.scrap >= 12 && s.buildT <= 0 && s.missiles < s.missilesMax)}
          ${live ? btn(s.missileReady ? '🚀 FIRE D-MISSILE' : 'Loading…', { t: 'fireMissile' }, s.missileReady) : ''}</div>
          ${live ? `<h3>Target</h3><div class="targets">${theirs.map(({ r, i }) => `<button class="${s.missileTarget === i ? 'on' : ''}" ${r.sys.hp > 0 ? '' : 'disabled'} data-act='${JSON.stringify({ t: 'target', room: i })}'>${esc(r.name)}<small>${Math.ceil(r.sys.hp)}/${r.sys.max}</small></button>`).join('')}</div>` : '<p class="muted">No enemy docked.</p>'}` + close;
      }
      case 'shield': return head('Bubble Generator', 'Bubbles block D-gun shots (not missiles). They recharge while this is online.') + sysLine + `<p>Bubbles ${s.bubble}/${s.bubbleMax}</p>` + close;
      case 'vault': return head('The Vault', 'Gems from the feeders land here. Thieves will come for them. Sell at ports.') + sysLine + `<p>💎 ${s.gems}/${s.gemCap}</p>${me.cls === 'guard' ? '<p class="muted">Upgrade Vault Mastery (Tab) for more space and bigger payouts. Q lunge, F lockdown.</p>' : ''}` + close;
      case 'kitchen': {
        const pantry = ['grub', 'shroom', 'fish', 'spice', 'crops'].map((k) => `${k} ${s.food[k] || 0}`).join(' · ');
        const targets = ['all', ...new Set(g.crew.filter((c) => c.cls !== 'urchid').map((c) => c.cls))];
        const tsel = modalData.target || 'all';
        return head('The Galley', 'Cook from feeder food and farm crops, then teleport the meal. Buffs come with small side-effects.') + sysLine +
          `<p>Pantry: ${pantry}</p>${me.cooking ? `<p class="good">Cooking ${RECIPES.find((r) => r.id === me.cooking.recipe).name}… ${me.cooking.t.toFixed(1)}s</p>` : ''}
          <div class="row wrap">Serve to: ${targets.map((t) => `<button class="chip ${tsel === t ? 'on' : ''}" data-act='${JSON.stringify({ ui: 'target', target: t })}'>${t === 'all' ? 'Everyone' : CLASSES[t].name}</button>`).join('')}</div>
          <div class="grid2">${RECIPES.map((r) => { const ok = Object.entries(r.needs).every(([k, v]) => (s.food[k] || 0) >= v);
            return `<div class="item"><b>${r.name}</b><span>${Object.entries(r.needs).map(([k, v]) => `${v} ${k}`).join(', ')} → ${r.text}</span>${btn('Cook', { t: 'cook', recipe: r.id, target: tsel }, ok && !me.cooking)}</div>`; }).join('')}</div>` + close;
      }
      case 'closet': return head('Janitor Closet', 'Hold E on messes to sweep (2 money each). A clean ship is a fast ship.') + sysLine + `<p>Messes aboard: ${g.messCount || 0} ${g.cleanBuff ? '· ✨ clean-ship bonus active' : ''}</p>` + close;
      case 'armory': return head('Armory', 'Mash broken parts into a makeshift gun anyone can use.') + sysLine + `<div class="row">${btn('Craft makeshift gun (15 scrap)', { t: 'craftGun' }, s.scrap >= 15)}</div>` + close;
      case 'farm': {
        const f = s.farm;
        return head('Dirt Farm', 'Dirt leaks in through breaches and the roof. Scoop it (E), bring it here, plant, wait, harvest.') + sysLine +
          `<p>Dirt ${f.dirt} · Crops ${s.food.crops || 0} ${me.carrying ? `· carrying ${me.carrying} (press E at the station to drop)` : ''}</p>
          <div class="plots">${f.plots.map((p, k) => `<div class="plot s${p.stage}"><b>Plot ${k + 1}</b><span>${['empty', 'sprout', 'growing', 'ripe!'][p.stage]}</span>${p.stage === 0 ? btn('Plant', { t: 'plant', plot: k }, f.dirt > 0) : p.stage >= 3 ? btn('Harvest', { t: 'harvest', plot: k }) : `<i style="width:${pct(p.t, 20)}"></i>`}</div>`).join('')}</div>` + close;
      }
      case 'lab': {
        const r = s.researching;
        return head('Laboratory', 'Research takes time at the lab and costs scrap. You can also route spare power.') + sysLine +
          (r ? `<p class="good">Researching ${RESEARCH.find((x) => x.id === r.id).name}: ${Math.floor(r.progress / r.time * 100)}% (stay in the lab)</p>` : '') +
          `<div class="grid2">${RESEARCH.map((x) => `<div class="item ${s.research.has(x.id) ? 'done' : ''}"><b>${x.name}</b><span>${x.desc} · ${x.scrap} scrap, ${x.time}s</span>${s.research.has(x.id) ? '<em>DONE</em>' : btn('Research', { t: 'research', id: x.id }, !r && s.scrap >= x.scrap)}</div>`).join('')}</div>
          <h3>Overclock (power routing)</h3><div class="row wrap">${['engine', 'shield', 'weapons', 'feeder'].map((k) => `<button class="chip ${s.overclock?.sys === k ? 'on' : ''}" data-act='${JSON.stringify({ t: 'overclock', sys: k })}'>${k}</button>`).join('')}<button class="chip" data-act='{"t":"overclock","sys":null}'>off</button></div>` + close;
      }
      case 'kennel': return head('Kennel', 'Lie still in the dog bed to heal. Upgrade the bed (Tab) to heal faster.') + sysLine + close;
      case 'pen': return head('Monster Pen', 'Knocked-out monsters revive here (faster while you stand in the pen).') + sysLine +
        `<div class="grid2">${me.monsters.map((m) => `<div class="item"><b>${esc(m.name)}</b><span>HP ×${m.hpMul.toFixed(2)} · DMG ×${m.dmgMul.toFixed(2)} · ${m.out ? 'out fighting' : m.reviveT > 0 ? `reviving ${Math.ceil(m.reviveT)}s` : 'ready'}</span>${btn('Release', { ui: 'release', type: m.type })}</div>`).join('') || '<p class="muted">No monsters yet. Weaken an enemy below 35% and throw a cube (Q).</p>'}</div>` + close;
      case 'den': return head('Vent Den', 'Every room has a vent. Press E at a vent to crawl to the next one. Docked enemy ships have vents too.') + sysLine + close;
      case 'bubbler': return head('Bubble Grotto', 'Air currents change with every docking, and they all connect. Bubbles ride them. So can you (Space).') + sysLine + close;
      case 'office': return head('Field Office', 'Marked targets show a gold ring. Take them out with the PPK.') + sysLine + `<p>Mission rank: ${me.missionRank || 0}. Higher rank = more dangerous marks, bigger pay.</p>` + close;
      case 'casino': {
        const last = me.lastSpin;
        return head('Casino Nook', 'Spin yourself for 5. Matching symbols pay; any real win doubles the money you pick up for 30s.') + sysLine +
          `${last ? `<div class="reels">${last.reels.map((r) => `<span>${r}</span>`).join('')}</div><p>${last.win ? `Won ${last.win}!` : 'Nothing.'}</p>` : ''}
          <div class="row">${me.cls === 'slots' ? btn('Spin (5)', { t: 'spin' }, me.wallet >= 5) : '<span class="muted">Only the Slot Machine plays itself.</span>'}</div>` + close;
      }
      case 'guardpost': return head('Guard Post', 'The Vurfenstaff becomes anything: staff, blade, rifle, shotgun (F). Phase out of this dimension (Q). Ice cubes (RMB) block bullets.') + sysLine + close;
      case 'lounge': return head("Urchid's Lounge", 'You sink into the lounge chair. The coconut juice is excellent. You have contributed nothing. Perfect.') + close;
      case 'feeder': return head('Feeder Hall', 'The auto-feeders rain gems, ore and food while we drill. Upgrade them at ports.') + sysLine + `<p>Feeder level ${s.up.feeders}</p>` + close;
      default: return head(room?.name || 'Station') + sysLine + close;
    }
  }

  // -------------------------------------------------------------------------
  function onFx(e, g, me) {
    switch (e.t) {
      case 'log': logItems.push({ kind: e.kind, text: e.text, at: performance.now() }); if (logItems.length > 40) logItems.shift(); break;
      case 'panel': if (me && e.crew === me.id) { if (e.panel === 'helm' && g.phase === 'descent' && me.cls === 'pilot') { api.cmd({ t: 'helm', on: true }); } else openModal('panel', { panel: e.panel, room: e.room }); } break;
      case 'recruit': toast(`🦊 ${e.name} the ${CLASSES[e.cls].name} joined the crew!`); break;
      case 'watch': if (me && e.crew === me.id) toast(`⌚ New mark: ${e.target}. ${e.text}`); break;
      case 'unlock': toast('📡 Signal locked!'); break;
      case 'switch': toast('You switched class.'); break;
    }
  }

  function panelTarget(t) { if (modalData) modalData.target = t; render(true); }

  return { canvas, update, onFx, openModal, closeModal, isOpen, kind: () => modalKind, toast, render, panelTarget, data: () => modalData };
}
