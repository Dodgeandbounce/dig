// DOM overlays: HUD, ability bar, crew list, docking duel, route picker, stories,
// the port, station panels, upgrades, pause and the end screens.
import {
  CLASSES, ABILITIES, WEAPONS, CLASS_UPGRADES, UPGRADE_BASE_COST, SHIP_UPGRADES, BUYABLE_ROOMS, ROOMS, RECIPES, RESEARCH,
  NODE_TYPES, KM_PER_LEVEL, LEVELS, FOODS, SHIP_UP_MAX, CLASS_UP_MAX, xpCost, POWER_SYS, SHIP_GUNS, roomSize, SHIP_COLS, SHIP_ROWS,
  TILE, SLOT_W, SLOT_H, STARTER_MONSTERS, FURNITURE, FURNITURE_SPOTS,
} from '../shared/sim/data.js';
import { interactTarget, DASH_COST, fixKey } from '../shared/sim/classes.js';
import { speedFactor } from '../shared/sim/pilot.js';
import { gunPeriod, ROUTE_AFK } from '../shared/sim/game.js';
import { drawMob, drawCrew } from './sprites.js';

/** "-1548km below Sea Level" */
export const depthText = (g) => `-${g.depthKm}km below Sea Level`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => `${Math.max(0, Math.min(100, (a / b) * 100)).toFixed(1)}%`;

export function createUI(root, api) {
  root.innerHTML = `
    <canvas class="g-canvas"></canvas>
    <div class="g-top">
      <div class="g-ship"><b class="g-shipname"></b><span class="g-level"></span></div>
      <div class="g-meters">
        <div class="g-meter hull"><span>HULL</span><div><i></i></div><em></em></div>
        <div class="g-score" title="Score so far"><span>SCORE</span><b></b></div>
        <div class="g-meter fuel"><span>FUEL</span><div><i></i></div><em></em></div>
        <div class="g-pips" title="Bubble defense"></div>
      </div>
      <div class="g-res"></div>
    </div>
    <div class="g-phase"></div>
    <div class="g-duel g-ours hidden"></div>
    <div class="g-duel g-theirs hidden"></div>
    <div class="g-me"></div>
    <div class="g-crew"></div>
    <div class="g-log"></div>
    <div class="g-prompt hidden"></div>
    <div class="g-banner hidden"></div>
    <div class="g-modal hidden"><div class="g-card"></div></div>
    <div class="g-toast hidden"></div>
    <div class="g-hold hidden"></div>
    <div class="g-credits hidden"></div>
    <div class="g-actions"><button class="g-ghostoff hidden">👁 Back to my own eyes</button><button class="g-store hidden">⚓ Back to the market</button><button class="g-trader hidden"></button><button class="g-mission hidden"></button><button class="g-undock hidden"></button><button class="g-seal hidden"></button><button class="g-flee hidden"></button><button class="g-burn hidden" title="Redline an engine until it bursts: we tear free right now, guaranteed. Costs the engine (and sets it on fire).">🔥 Burn an engine: escape NOW</button></div>
    <div class="g-spawn hidden"></div>
    <form class="g-chat hidden"><input maxlength="200" placeholder="Say something to the crew… (Enter)"></form>
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
  let endSince = 0;            // when (client clock) the run ended: the end screen shows shortly after
  let aftermathSeen = null;    // which aftermath the player already closed ("stay and loot")
  let missionSeen = 0;         // the last secret mission report we showed (013)
  let starterSeen = false;     // the trainer's starter-pet pick
  let creditsSkipped = false;
  let furnPick = null;         // a Deep City bed/jukebox waiting for its room
  let portLeft = false;       // walked out of the store to roam the ship (the market button brings it back)

  // ---- click handling (delegated)
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = JSON.parse(b.dataset.act);
    api.sfx?.ui();
    if (act.close) { closeModal(); return; }
    const g0 = api.game();
    if (act.ui === 'stay' || act.t === 'continue') aftermathSeen = g0 ? aftermathKey(g0) : null;
    if (act.ui === 'stay') { closeModal(); return; }
    if (act.tab) { portTab = act.tab; roomPick = null; furnPick = null; render(true); return; }
    if (act.pick) { roomPick = act.pick; render(true); return; }
    if ('pickF' in act) { furnPick = act.pickF; render(true); return; }
    if (act.t === 'buyFurniture') furnPick = null;
    if (act.ui) { api.ui(act.ui, act); return; }
    api.cmd(act);
    if (['route', 'storyOk', 'continue', 'vent', 'switchClass', 'pickStarter', 'disguise'].includes(act.t)) closeModal();
    if (act.t === 'helm' && act.on) closeModal();
    if (act.t === 'buyRoom') roomPick = null;
    setTimeout(() => render(true), 30);
  });
  $('.g-undock').addEventListener('click', (e) => { e.currentTarget.blur(); api.sfx?.ui(); api.cmd({ t: 'continue' }); });
  $('.g-ghostoff').addEventListener('click', (e) => { e.currentTarget.blur(); api.sfx?.ui(); api.cmd({ t: 'ghostOff' }); });
  $('.g-store').addEventListener('click', (e) => { e.currentTarget.blur(); api.sfx?.ui(); portLeft = false; openModal('port'); });
  $('.g-seal').addEventListener('click', (e) => { e.currentTarget.blur(); api.sfx?.ui(); api.cmd({ t: 'seal' }); });
  $('.g-flee').addEventListener('click', (e) => { e.currentTarget.blur(); api.sfx?.ui(); api.cmd({ t: 'flee' }); });
  $('.g-burn').addEventListener('click', (e) => { e.currentTarget.blur(); api.sfx?.ui(); api.cmd({ t: 'burnEngine' }); });
  $('.g-trader').addEventListener('click', (e) => { e.currentTarget.blur(); api.sfx?.ui(); openModal('trader'); });
  $('.g-mission').addEventListener('click', (e) => { e.currentTarget.blur(); api.sfx?.ui(); openModal('mission'); });
  $('.g-credits').addEventListener('click', (e) => { if (e.target.closest('[data-scores]')) { creditsSkipped = true; openModal('end'); } });
  $('.g-spawn').addEventListener('click', (e) => { const b = e.target.closest('[data-sp]'); if (!b) return; b.blur(); api.sfx?.ui(); api.cmd({ t: 'spawnPick', d: +b.dataset.sp }); });
  card.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.form === 'transponder') { api.cmd({ t: 'transponder', code: f.code.value }); f.code.value = ''; setTimeout(() => render(true), 60); }
  });

  const aftermathKey = (g) => `${g.level}:${Math.round(g.time - g.phaseT)}`;
  function openModal(kind, data) { modalKind = kind; modalData = data; lastHtml = ''; modal.classList.remove('hidden'); modal.dataset.kind = kind; render(true); }
  function closeModal() { if (modalKind === 'port' && api.game()?.phase === 'port') portLeft = true; modalKind = null; modalData = null; modal.classList.add('hidden'); api.onClose?.(); }
  const isOpen = () => !!modalKind;

  function toast(text) { const el = $('.g-toast'); el.textContent = text; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 2600); }

  // -------------------------------------------------------------------------
  function update(g, me, view) {
    root.classList.toggle('piloting', !!view.pilot);
    // top bar
    const s = g.ship;
    $('.g-shipname').textContent = s.name;
    $('.g-level').textContent = `${depthText(g)}${g.path === 'brother' ? ' · following Joe' : ''}`;
    setMeter('.hull', s.hull, s.hullMax, s.hull < s.hullMax * 0.3 ? 'bad' : '');
    $('.g-score b').textContent = g.finalScore().toLocaleString();
    setMeter('.fuel', s.fuel, s.fuelMax, s.fuel < 25 ? 'bad' : '');
    $('.g-pips').innerHTML = Array.from({ length: s.bubbleMax }, (_, k) => `<i class="${k < s.bubble ? 'on' : ''}"></i>`).join('') + '<small>bubble</small>';
    const pu = Object.values(s.power?.alloc || {}).reduce((a, b) => a + b, 0);
    $('.g-res').innerHTML = `<span title="Gems in the vault (and what they're worth)">💎 ${s.gems}/${s.gemCap} <small>(${s.gemValue || 0})</small></span><span title="Scrap (repairs, gadgets, missiles)">⚙ ${Math.floor(s.scrap)}</span><span title="D-missiles">🚀 ${s.missiles}/${s.missilesMax}</span><span title="Power cells in use / total">⚡ ${pu}/${s.power?.cells ?? 0}</span>` +
      (g.breaches ? `<span class="bad" title="Hull breaches leak dirt and drain the hull">🕳 ${g.breaches}</span>` : '') +
      (g.cleanBuff ? '<span class="good" title="Clean ship: +10% speed">✨ clean</span>' : g.messCount > 4 ? `<span title="Messy ship">🧹 ${g.messCount}</span>` : '');

    // phase line
    const ph = $('.g-phase');
    const P = {
      briefing: 'Briefing', descent: g.descent?.stranded ? '⚠ STRANDED — out of fuel' : `Descending · ${Math.round(g.descent.progress * 100)}% to the next stop`,
      route: 'Choose the route', encounter: encounterLine(g),
      aftermath: 'Aftermath', port: g.port ? `Docked at ${g.port.name}` : 'Port', discovery: 'Discovery', gameover: 'Lost', ending: 'The center of the world',
    }[g.phase] || g.phase;
    ph.textContent = P;
    ph.className = 'g-phase ' + g.phase;

    // duel: us vs every ship that's docked (or on its way)
    // the fight: our ship's guns on the left under the minimap, every enemy ship on the right
    const ours = $('.g-ours'), duel = $('.g-theirs');
    ours.classList.toggle('nomap', !!view.minimapOff);   // (M hid the minimap: slide up into its spot)
    const ships = (g.enemyShips || []).filter((x) => !x.gone && x.kind !== 'derelict' && x.kind !== 'pod');
    if (g.phase === 'encounter' && ships.length) {
      ours.classList.remove('hidden');
      duel.classList.remove('hidden');
      const mp = 9 / (1 + 0.1 * s.up.dmissile);
      const tgt = g.rooms[s.missileTarget];
      const guns = (s.guns || []).map((gun) => `<div class="dbar ${gun.on === false ? 'off' : ''}"><label>${esc(SHIP_GUNS[gun.id].name)}${gun.on === false ? ' (no power)' : ''}</label><div><i style="width:${gun.on === false ? 0 : pct(gun.t || 0, gunPeriod(s, gun.id))}"></i></div></div>`).join('');
      ours.innerHTML = `
        <div class="side us"><b>${esc(s.name)}</b>
          ${guns}
          <div class="dbar ${s.missileReady ? 'ready' : ''}"><label>D-Missile ${s.missiles ? '' : '(empty)'}</label><div><i style="width:${s.missileReady ? '100%' : pct(s.missileT, mp)}"></i></div></div>
          ${tgt && !tgt.gone ? `<small>⌖ ${esc(tgt.name)}</small>` : ''}
          ${s.evasiveT > 0 ? '<em class="good">EVASIVE!</em>' : ''}${g.fleeT > 0 ? `<em class="bad">ESCAPING ${Math.ceil(g.fleeT)}s</em>` : ''}
        </div>`;
      duel.innerHTML = `
        <div class="ships">${ships.map((es) => es.docked ? `
        <div class="side them ${es.done ? 'beaten' : ''}"><b>${esc(es.name)}${es.surrendered ? ' 🏳' : es.destroyed ? ' 💥' : es.fled ? ' (fled)' : ''}</b>
          <div class="dbar hullb"><label>Hull</label><div><i style="width:${pct(es.hull, es.hullMax)}"></i></div></div>
          ${es.done ? '' : `<div class="dbar"><label>Gun</label><div><i style="width:${pct(es.gunT, es.gunPeriod)}"></i></div></div>
          <small>bubble ${'●'.repeat(es.bubble)}${'○'.repeat(Math.max(0, es.bubbleMax - es.bubble))} · ${es.crewLeft} more boarders${es.fleeT > 6 ? ' · <b class="bad">fleeing!</b>' : ''}</small>
          ${es.guns?.length ? `<small>rack: ${es.guns.map((gn) => `<span class="${gn.on ? '' : 'off'}">${SHIP_GUNS[gn.id]?.name || gn.id}${gn.on ? '' : ' (dark)'}</span>`).join(', ')}</small>` : ''}
          ${es.crewCls?.length ? `<small class="ecrew">crew: ${es.crewCls.map((cl) => { const up = g.mobs.some((m) => m.alive && m.officer === cl && m.esId === es.id); return `<span class="${up ? '' : 'down'}">${CLASSES[cl].name}${up ? '' : ' ✗'}</span>`; }).join(' · ')}</small>` : ''}`}
        </div>` : `<div class="side them incoming"><b>☠ ${esc(es.name)}</b><small>docking in ${Math.max(0, Math.ceil(es.approachT))}s</small></div>`).join('')}</div>`;
    } else if (g.phase === 'encounter' && g.boss && g.boss.alive) {
      ours.classList.add('hidden');
      duel.classList.remove('hidden');
      duel.innerHTML = `<div class="side them wide"><b>☀ ${esc(g.boss.name)}</b><div class="dbar hullb"><label>HP</label><div><i style="width:${pct(g.boss.hp, g.boss.maxHp)}"></i></div></div></div>`;
    } else { duel.classList.add('hidden'); ours.classList.add('hidden'); }

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
    const over = g.phase === 'gameover' || g.phase === 'ending';
    if (!over) endSince = 0; else if (!endSince) endSince = performance.now();
    if (g.storyOpen && modalKind !== 'story' && !over) openModal('story', g.storyOpen);
    else if ((!g.storyOpen || over) && modalKind === 'story') closeModal();
    // the end screen always comes up (online the server stops the clock, so go by ours). After a win
    // the credits roll first while everyone walks around the island.
    const won = g.phase === 'ending';
    if (over && modalKind !== 'end' && !(won && modalKind) && performance.now() - endSince > (won && !creditsSkipped ? 60000 : 1500)) openModal('end');
    renderCredits(g, won && modalKind !== 'end');
    // the trainer picks a starter pet (grass, fire, water, electric) the first time they play one
    if (me?.cls === 'trainer' && me.starterAuto && !starterSeen && !modalKind && !over && g.phase !== 'briefing') { starterSeen = true; openModal('starter'); }
    // 013: a paper report slides in when there's a new mark
    const ms = $('.g-mission');
    const mission = me?.cls === 'agent' && g.mission && g.mobs.some((m) => m.alive && m.marked) ? g.mission : null;
    if (mission && mission.id !== missionSeen && !modalKind) { missionSeen = mission.id; openModal('mission'); }
    ms.classList.toggle('hidden', !mission || modalKind === 'mission');
    if (mission) ms.textContent = `📄 Secret mission: ${mission.name}`;
    if (modalKind === 'mission' && !mission) closeModal();
    // a trader alongside (random event)
    const tr = $('.g-trader');
    tr.classList.toggle('hidden', !g.trader || modalKind === 'trader');
    if (g.trader) tr.textContent = `🛒 Trader alongside (${Math.ceil(g.trader.t)}s)`;
    if (modalKind === 'trader' && !g.trader) closeModal();
    if (!g.storyOpen && !over) {
      if (g.phase === 'route' && modalKind !== 'route') openModal('route');
      if (g.phase !== 'port') portLeft = false;
      if (g.phase === 'port' && !portLeft && modalKind !== 'port' && modalKind !== 'upgrades') openModal('port');
      if (g.phase === 'aftermath' && modalKind !== 'aftermath' && aftermathSeen !== aftermathKey(g) && (!modalKind || modalKind === 'stranded')) openModal('aftermath');
      if (modalKind === 'route' && g.phase !== 'route') closeModal();
      if (modalKind === 'port' && g.phase !== 'port') closeModal();
      if (modalKind === 'aftermath' && g.phase !== 'aftermath') closeModal();
      if (modalKind === 'stranded' && !(g.phase === 'descent' && g.descent.stranded)) closeModal();
    }
    if (modalKind === 'end' && !over) closeModal(); // host started a new run
    // floating action buttons: undock (aftermath), seal doors and escape (docked)
    const undock = $('.g-undock'), seal = $('.g-seal'), flee = $('.g-flee');
    const pilot = g.crew.find((c) => c.cls === 'pilot');
    const showUndock = g.phase === 'aftermath' && modalKind !== 'aftermath';
    undock.classList.toggle('hidden', !showUndock);
    if (showUndock) undock.textContent = !pilot || me === pilot || !pilot.human ? (g.departWarnT > 0 ? '⏏ Undock anyway (they get yanked back)' : '⏏ Undock & keep digging') : `⏏ Ask ${pilot.name} to undock`;
    // walked out of the port's store: a button back to the market (and the undock countdown)
    const store = $('.g-store');
    const showStore = g.phase === 'port' && modalKind !== 'port' && modalKind !== 'upgrades';
    store.classList.toggle('hidden', !showStore);
    if (showStore) store.textContent = g.port?.departT > 0 ? `⚓ Undocking in ${Math.ceil(g.port.departT)}s · back to the market` : '⚓ Back to the market';
    store.classList.toggle('urgent', !!(showStore && g.port?.departT > 0));
    // the urchid looking through someone else's eyes: a way back
    const gh = $('.g-ghostoff');
    const ghostOn = me?.cls === 'urchid' && me.ghost != null;
    gh.classList.toggle('hidden', !ghostOn);
    if (ghostOn) gh.textContent = `👁 Back to my own eyes (watching ${g.crew.find((c) => c.id === me.ghost)?.name || '?'})`;
    const docked = g.phase === 'encounter' && (g.enemyShips || []).some((es) => !es.gone);
    seal.classList.toggle('hidden', !docked);
    if (docked) seal.textContent = g.doorsSealed ? '🔓 Unseal doors (L)' : '🔒 Seal all doors (L)';
    const canFlee = docked && me === pilot && g.fightingShips?.some((es) => es.kind === 'ship');
    flee.classList.toggle('hidden', !canFlee);
    if (canFlee) flee.textContent = g.fleeT > 0 ? `Escaping in ${Math.ceil(g.fleeT)}s…` : `🏃 Escape: cut the tunnels (${escapeTime(g)}s)`;
    // the last resort: burn out an engine and we're gone, guaranteed
    const burn = $('.g-burn');
    const canBurn = canFlee && s.hull < s.hullMax * 0.35 && g.rooms.some((r) => r.owner === 'us' && r.type === 'engine' && r.sys.hp > 0);
    burn.classList.toggle('hidden', !canBurn);
    // downed: pick where you get back up
    const sp = $('.g-spawn');
    if (me && !me.alive && me.cls !== 'urchid') {
      const opts = g.rooms.map((r, i) => i).filter((i) => { const r = g.rooms[i]; return r.owner === 'us' && (r.type === 'quarters' || r.type === CLASSES[me.cls].room); });
      const cur = opts.includes(me.spawnPick) ? me.spawnPick : opts[0];
      sp.classList.remove('hidden');
      sp.innerHTML = `<div>Back up in <b>${Math.ceil(me.downT)}s</b> at:</div><div class="row"><button data-sp="-1">◀</button><b>${esc(g.rooms[cur]?.name || '?')}${g.rooms[cur]?.type === 'quarters' && opts.filter((i) => g.rooms[i].type === 'quarters').length > 1 ? ` #${opts.filter((i) => g.rooms[i].type === 'quarters').indexOf(cur) + 1}` : ''}</b><button data-sp="1">▶</button></div><small>A / D or ← → to choose</small>`;
      view.spawnRoom = cur;
    } else { sp.classList.add('hidden'); view.spawnRoom = null; }
    render(false);
  }
  function escapeTime(g) { const n = g.rooms.filter((r) => r.owner === 'us' && r.type === 'engine' && r.sys.hp > 0).length; return Math.round(14 / (1 + 0.4 * Math.max(0, n - 1)) * (n ? 1 : 1.6)); }

  function encounterLine(g) {
    const ships = (g.enemyShips || []).filter((x) => !x.gone);
    if (g.nest && !ships.length) return 'Creatures burrowing in!';
    if (!ships.length) return 'Encounter';
    const incoming = ships.filter((x) => !x.docked), fighting = ships.filter((x) => x.docked && !x.done);
    if (!fighting.length && !incoming.length) return 'Enemy ships beaten — clear the boarders';
    const parts = [];
    if (fighting.length) parts.push(`DOCKED: ${fighting.map((x) => x.name).join(', ')}`);
    if (incoming.length) parts.push(`incoming: ${incoming.length} (${Math.ceil(Math.min(...incoming.map((x) => x.approachT)))}s)`);
    return parts.join(' · ');
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
    slots.push(slot('LMB', me.lightning > 0 ? `⚡ Lightning gun (${me.lightning})` : weaponName(me), me.cd.fire, WEAPONS[def.weapon]?.rate || 1));
    for (const [key, k] of [['rmb', 'RMB'], ['q', 'Q'], ['r', 'R'], ['f', 'F'], ['g', 'G'], ['space', 'SPACE']]) {
      const id = def.abilities[key];
      if (!id) continue;
      const A = ABILITIES[id];
      let label = A.name;
      if (id === 'jarswap') label = `Jar: ${me.jar}`;
      if (id === 'staffform') label = `Staff: ${me.form}`;
      if (id === 'cloak' && me.cloaked) label = 'Uncloak';
      if (id === 'phase' && me.phased) label = `Phased ${me.phaseT.toFixed(1)}s`;
      if (id === 'tank' && (me.missionRank || 0) < 2) label = 'Tank (rank 2)';
      slots.push(slot(k, label, me.cd[key] || 0, A.cd || 1, A.desc));
    }
    if (me.cls === 'chef') slots.push(slot('RMB', 'Fish slap', me.cd.f, 9));
    if (me.cls !== 'urchid' && me.cls !== 'engineer') slots.push(slot(fixKey(me).toUpperCase(), 'Repair (hold)', 0, 1, 'Hold to fix the nearest broken system, wall, door or breach. Puts out fires too.'));
    const sm = me.stamMax || 100;
    if (me.cls !== 'urchid') slots.push(slot('SHIFT', 'Dash', (me.stam ?? sm) < DASH_COST ? (DASH_COST - (me.stam ?? sm)) / 26 : 0, DASH_COST / 26, 'A quick dash with a puff of smoke. Uses stamina.'));
    const buffs = (me.buffs || []).map((b) => `<span class="buff" title="${esc(JSON.stringify(b))}">${b.tag || 'buff'} ${Math.ceil(b.t)}s</span>`).join('');
    const extra = [];
    if (me.cls === 'trainer') extra.push(`Monsters: ${me.monsters.map((m) => `${m.starter ? '★' : ''}${esc(m.name)}${m.out ? ' (out)' : m.reviveT > 0 ? ` (${Math.ceil(m.reviveT)}s)` : ''}`).join(', ') || 'none yet — weaken an enemy, then Q'}`);
    if (me.cls === 'engineer') { const n = g.objs.filter((o) => o.kind === 'turret' && o.owner === me.id).length, max = 2 + me.upgrades[1]; extra.push(`<b class="${n >= max ? 'good' : ''}">Turrets ${n}/${max}</b>`); }
    if (me.cls === 'agent') extra.push(`Mission rank ${me.missionRank || 0}${me.disguise != null ? ` · <b class="good">disguised as ${esc(g.roster[me.disguise]?.name || '?')}</b>` : ''}${(me.missionRank || 0) >= 4 ? ' · laser' : ''}`);
    if (me.cls === 'slots' && me.coinWinT > 0) extra.push(`<b class="good">WINNING STREAK ×${me.coinWinMul} (${Math.ceil(me.coinWinT)}s)</b>`);
    if (me.makeshift?.ammo > 0) extra.push(`<b class="good">Makeshift gun: ${me.makeshift.ammo} shots ${me.makeshift.away ? "(put away: X to draw it)" : "(LMB · X to swap back)"}</b>`);
    if (me.cls === 'urchid') extra.push('Contributes nothing. Cannot die. Living the dream.');
    const ready = [0, 1, 2].some((k) => me.upgrades[k] < CLASS_UP_MAX && (me.xp || 0) >= xpCost(me.upgrades[k]));
    el.innerHTML = `
      <div class="who"><canvas class="portrait" width="56" height="56"></canvas>
        <div><b>${esc(me.name)}</b> <span class="muted">${def.name}</span>
          <div class="hp"><i style="width:${pct(me.hp, me.maxHp)}"></i><em>${me.alive ? `${Math.ceil(me.hp)} HP` : `DOWN ${Math.ceil(me.downT)}s`}</em></div>
          ${me.cls !== 'urchid' ? `<div class="stam ${(me.stam ?? sm) < DASH_COST ? 'low' : ''}" title="Stamina ${Math.floor(me.stam ?? sm)}/${sm}"><i style="width:${pct(me.stam ?? sm, sm)}"></i></div>` : ''}
          <div class="wallet">💰 ${Math.floor(me.wallet)} <span class="xp ${ready ? 'ready' : ''}" title="Experience: earned by doing your job. Spend it on stars (Tab).">✦ ${Math.floor(me.xp || 0)} xp${ready ? ' · ★ ready' : ''}</span> <span class="muted">· <kbd>Tab</kbd> upgrades · <kbd>C</kbd> crew · <kbd>Esc</kbd> menu</span></div>
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
      shotgun: 'Shotgun', jar: `Throw ${me.jar} jar`, bite: 'Bite', dagger: 'Dagger (from behind: instant kill)', whip: 'Whip', bubble: 'Blow bubbles', staff: 'Vurfenstaff', ppk: 'Walther PPK', coins: 'Fire coins ($1, they go right through)' }[CLASSES[me.cls].weapon];
  }
  function slot(key, label, cd, max, desc = '') {
    const f = cd > 0 ? Math.min(1, cd / max) : 0;
    return `<div class="slot ${cd > 0 ? 'cd' : ''}" title="${esc(desc)}"><kbd>${key}</kbd><span>${esc(label)}</span>${cd > 0.05 ? `<i style="height:${(f * 100).toFixed(0)}%"></i><em>${cd.toFixed(1)}</em>` : ''}</div>`;
  }

  function renderCrew(g, me) {
    const el = $('.g-crew');
    el.innerHTML = `<h4>Crew ${g.crew.length}/17</h4>` + g.crew.map((c) => `
      <div class="cm ${c.alive ? '' : 'down'} ${c === me ? 'me' : ''}" style="--c:${CLASSES[c.cls].color}">
        <span class="dot"></span><span class="n">${esc(c.name)}${api.online ? (c.human ? ` <small class="pl">${esc(c.player || 'player')}</small>` : ' <small class="bot">bot</small>') : ''}</span><span class="cl">${CLASSES[c.cls].name}</span>
        <span class="mini"><i style="width:${c.cls === 'urchid' ? 100 : pct(c.hp, c.maxHp)}"></i></span>
      </div>`).join('') + (g.joe.state === 'saved' ? '<div class="cm" style="--c:#f0a030"><span class="dot"></span><span class="n">Joe</span><span class="cl">Brother · NPC</span></div>' : '');
  }

  function renderBriefing(g, banner) {
    const solo = g.mix.length === 1 && g.mix[0].pct === 100;
    banner.innerHTML = `
      <div class="sea">${depthText(g)}</div>
      <div class="mix ${solo ? 'solo' : ''}">${g.mix.map((m) => `<div class="foe ${m.rare ? 'rare' : ''}"><canvas width="${solo ? 128 : 64}" height="${solo ? 128 : 64}" data-type="${m.type}"></canvas><b>${esc(g.roster[m.type].name)}</b><span>${m.pct}%</span>${m.rare ? '<small>rare!</small>' : ''}</div>`).join('')}</div>
      ${solo ? '<div class="solo-note">Just one. THE MAIN EVENT. It eats ships.</div>' : ''}
      <div class="dig">DIG!</div>`;
    banner.querySelectorAll('canvas').forEach((cv) => {
      const type = g.roster[+cv.dataset.type];
      const c = cv.getContext('2d');
      const S = cv.width / 2;
      const r = Math.min(S * 0.7, (solo ? 26 : 14) * Math.min(type.size, 2.2));
      drawMob(c, { x: S, y: S, r, facing: Math.PI / 2, id: 1 }, type, 0);
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
      case 'crew': html = crewHtml(g, me); break;
      case 'pause': html = pauseHtml(g); break;
      case 'help': html = helpHtml(); break;
      case 'end': html = endHtml(g); break;
      case 'mission': html = missionHtml(g, me); break;
      case 'trader': html = traderHtml(g, me); break;
      case 'starter': html = starterHtml(g, me); break;
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
    const humans = g.crew.filter((c) => c.human);
    const voting = humans.length > 1;
    const votes = g.route?.votes || {};
    const tally = {};
    for (const [id, i] of Object.entries(votes)) { const c = g.crew.find((x) => x.id === id); if (c?.human) tally[i] = (tally[i] || 0) + (c.cls === 'pilot' ? 3 : 1); }
    const left = g.route?.voteT != null ? Math.max(0, Math.ceil(15 - (g.route.t - g.route.voteT))) : null;
    const line = voting
      ? `🗳 Vote on where we stop (the pilot's vote counts 3x).${left != null ? ` Closes in ${left}s.` : ''} ${humans.filter((c) => votes[c.id] == null).length} still to vote.`
      : pilot?.human ? 'You\'re the pilot. Pick where we stop next.' : `${esc(pilot?.name || 'The pilot')} is waiting for your call.`;
    const afk = Math.max(0, Math.ceil(ROUTE_AFK - (g.route?.t || 0)));
    return `<h2>The tunnel forks</h2>
      <p class="muted">${line} ${g.route?.voteT == null ? `<small>(nobody picks in ${afk}s: the autopilot goes where the ship needs)</small>` : ''}
      Fuel ${Math.ceil(g.ship.fuel)}/${g.ship.fuelMax} · Hull ${Math.ceil(g.ship.hull)}/${g.ship.hullMax}</p>
      <div class="nodes">${nodes.map((n, i) => `<button class="node ${n.locked ? 'locked' : ''} ${votes[me?.id] === i ? 'voted' : ''}" style="--c:${n.color}" ${n.locked ? 'disabled' : ''} data-act='${JSON.stringify({ t: 'route', i })}'>
        <span class="ic">${n.icon}</span><b>${esc(n.name)}</b><span>${esc(n.desc)}</span>${voting ? `<em class="votes">${tally[i] ? `${tally[i]} vote${tally[i] > 1 ? 's' : ''}` : ''}${votes[me?.id] === i ? ' · yours' : ''}</em>` : ''}</button>`).join('')}</div>
      ${locked ? `<form data-form="transponder" class="tp"><label>Targeting computer — transponder ID</label><div class="row"><input name="code" maxlength="6" autocomplete="off" placeholder="####"><button>Lock on</button></div></form>` : ''}`;
  }

  function aftermathHtml(g) {
    const l = g.lastLoot;
    const me = api.me();
    const crates = g.objs.filter((o) => o.kind === 'crate').length;
    const pilot = g.crew.find((c) => c.cls === 'pilot');
    const iAmPilot = !pilot || pilot === me || !pilot.human;
    const bridge = g.rooms.find((r) => r.owner === 'us' && r.type === 'bridge');
    const fires = g.objs.filter((o) => o.kind === 'fire').length;
    return `<h2>${l?.fled ? 'We got away' : 'Victory!'}</h2>
      ${l ? `<p>+${Math.round(l.scrap)} scrap · +${l.gems} gems · +${Math.round(l.money)} money for everyone</p>` : ''}
      ${crates ? `<p class="good">${crates} loot crate${crates > 1 ? 's' : ''} on their ship. Walk over and press E on them. (Whatever's left gets stripped when we undock.)</p>` : ''}
      ${g.breaches ? `<p class="bad">${g.breaches} hull breach${g.breaches > 1 ? 'es' : ''} still open. They leak dirt, drain the hull, and things crawl in through them.</p>` : ''}
      ${fires ? `<p class="bad">🔥 ${fires} fire${fires > 1 ? 's' : ''} still burning. Hold E next to them.</p>` : ''}
      ${bridge && bridge.sys.hp <= 0 ? '<p class="bad">The bridge is wrecked: we can\'t undock until it\'s repaired.</p>' : ''}
      <p class="muted">Take a moment: loot, repair (hold R), put out fires, clean up, cook, research. ${iAmPilot ? 'You give the signal to undock once everyone is back aboard.' : `Only ${esc(pilot.name)} (the pilot) can undock.`}${!pilot?.human && pilot ? ` ${esc(pilot.name)} undocks on their own in about a minute.` : ''}</p>
      <div class="row"><button data-act='{"t":"continue"}'>${iAmPilot ? (g.resume ? 'Back to the descent' : 'Undock & keep digging') : `Ask ${esc(pilot.name)} to undock`}</button><button class="ghost" data-act='{"ui":"stay"}'>Stay & loot</button></div>`;
  }

  function portHtml(g, me) {
    const P = g.port; if (!P) return '';
    const s = g.ship;
    const tabs = ['market', 'ship', 'rooms', 'crew'].filter((t) => (t === 'rooms' ? P.rooms : t === 'ship' ? P.upgrades : true));
    const tabBtns = tabs.map((t) => `<button class="tab ${portTab === t ? 'on' : ''}" data-act='${JSON.stringify({ tab: t })}'>${{ market: 'Market', ship: 'Ship upgrades', rooms: 'Build rooms', crew: 'Crew & class' }[t]}</button>`).join('');
    let body = '';
    const btn = (label, act, ok = true) => `<button ${ok ? '' : 'disabled'} data-act='${JSON.stringify(act)}'>${label}</button>`;
    if (furnPick && P.kind === 'city') {
      const F = FURNITURE[furnPick];
      const opts = g.rooms.map((r, i) => [r, i]).filter(([r]) => r.owner === 'us' && !r.gone && r.type !== 'corridor');
      const full = (r) => (s.furniture || []).filter((f) => f.sx === r.sx && f.sy === r.sy).length >= FURNITURE_SPOTS.length;
      body = `<p>Which room gets the new <b>${F.icon} ${F.name}</b>? (${F.cost})</p><div class="grid2">${opts.map(([r, i]) => btn(`${esc(r.name)}${full(r) ? ' (full)' : ''}`, { t: 'buyFurniture', type: furnPick, room: i }, !full(r) && me.wallet >= F.cost)).join('')}</div>
        <div class="row"><button class="ghost" data-act='{"pickF":null}'>Cancel</button></div>`;
    } else if (portTab === 'market' || !tabs.includes(portTab)) {
      const fuelNeed = Math.ceil(s.fuelMax - s.fuel), hullNeed = Math.ceil(s.hullMax - s.hull);
      body = `<div class="grid2">
        <div class="item"><b>💎 Sell gems</b><span>${s.gems} gems × ${P.gemPrice} = ${s.gems * P.gemPrice}, split between ${g.crew.length} crew</span>${btn('Sell all', { t: 'sell' }, s.gems > 0)}</div>
        <div class="item"><b>⛽ Fuel</b><span>${fuelNeed} needed · ${P.fuelPrice}/unit</span>${btn(`Fill up (${Math.ceil(fuelNeed * P.fuelPrice)})`, { t: 'buyFuel' }, fuelNeed > 0 && me.wallet >= 1)}</div>
        <div class="item"><b>🛠 Hull patch</b><span>${hullNeed} hull missing · 1 per 2 hull</span>${btn(`Patch (${Math.ceil(hullNeed / 2)})`, { t: 'repairHull' }, hullNeed > 0 && me.wallet >= 1)}</div>
        <div class="item"><b>🔧 Dock crew</b><span>Fix every system, door, wall and breach</span>${btn('Fix all (40)', { t: 'fixAll' }, me.wallet >= 40)}</div>
        ${P.shop ? `<div class="item"><b>🚀 D-missile</b><span>${s.missiles}/${s.missilesMax} in the rack</span>${btn('Buy (25)', { t: 'buyMissile' }, me.wallet >= 25 && s.missiles < s.missilesMax)}</div>
        <div class="item"><b>⚙ Scrap</b><span>25 scrap for repairs & gadgets</span>${btn('Buy (20)', { t: 'buyScrap' }, me.wallet >= 20)}</div>
        <div class="item"><b>🍖 Groceries</b><span>1 grub, shroom, fish, spice</span>${btn('Buy (15)', { t: 'buyFood' }, me.wallet >= 15)}</div>
        ${P.kind === 'city' ? Object.entries(FURNITURE).map(([id, F]) => { const n = (s.furniture || []).filter((f) => f.type === id).length;
          return `<div class="item city"><b>${F.icon} ${F.name} <small>${n}/${F.max}</small></b><span>${F.desc} Only in the Deep Cities.</span>${btn(`Buy (${F.cost}) · pick a room`, { pickF: id }, me.wallet >= F.cost && n < F.max)}</div>`; }).join('') : ''}
        ${s.items.map((it, i) => { const G = SHIP_GUNS[it.id]; const price = Math.max(40, Math.round((G.cost || 80) * 0.5)); return `<div class="item"><b>🔫 Sell ${G.name}</b><span>Sitting in storage, not in the rack</span>${btn(`Sell (${price})`, { t: 'sellGun', item: i })}</div>`; }).join('')}
        ${s.food.crops ? `<div class="item"><b>🌽 Sell crops</b><span>${s.food.crops} crops</span>${btn('Sell', { t: 'sellCrops' })}</div>` : ''}
        ${me.cls === 'agent' ? `<div class="item"><b>🍸 Meet a contact</b><span>Swap "knowledge" for "information": more marked targets</span>${btn('Buy intel (40)', { t: 'buyIntel' }, me.wallet >= 40)}</div>` : ''}` : ''}
      </div>`;
    } else if (portTab === 'ship') {
      body = `<div class="grid2">${Object.entries(SHIP_UPGRADES).map(([id, u]) => { const lvl = s.up[id]; const cost = u.cost * (lvl + 1);
        return `<div class="item"><b>${u.name} <small>Lv ${lvl}/${SHIP_UP_MAX}</small></b><span>${u.desc}</span>${lvl >= SHIP_UP_MAX ? '<em>MAX</em>' : btn(`Upgrade (${cost})`, { t: 'buyUpgrade', id }, me.wallet >= cost)}</div>`; }).join('')}</div>
        ${(P.guns || []).length ? `<h3>Gun dealer</h3><p class="muted">Guns go into storage. The missile technician installs them at the weapons bay; each one needs power cells (route them at the lab, or build a Power Core).</p>
        <div class="grid2">${P.guns.map((id) => { const G = SHIP_GUNS[id]; return `<div class="item"><b>${G.name} <small>⚡${G.power}</small></b><span>${G.desc} ${G.shots > 1 ? `${G.shots} × ${G.dmg}` : G.dmg} dmg every ${G.period}s.</span>${btn(`Buy (${G.cost})`, { t: 'buyGun', id }, me.wallet >= G.cost)}</div>`; }).join('')}</div>` : ''}`;
    } else if (portTab === 'rooms') {
      if (roomPick) {
        const [w, h] = roomSize(roomPick);
        body = `<p>Where should the new <b>${ROOMS[roomPick].name}</b> go?${w * h > 1 ? ` It takes ${w}×${h} slots: click where its top-left corner goes.` : ' Click a free slot.'}</p>${shipMapHtml(g, roomPick)}<div class="row"><button class="ghost" data-act='{"pick":null}'>Cancel</button></div>`;
      } else {
        const used = g.ourRooms.reduce((a, r) => { const [w, h] = roomSize(r.type); return a + w * h; }, 0);
        body = `<p class="muted">The ship grows one room at a time. New crew bring their own room. ${used}/${SHIP_COLS * SHIP_ROWS} slots used.</p><div class="grid2">${BUYABLE_ROOMS.map((r) => { const n = g.ourRooms.filter((x) => x.type === r.type).length; const cost = Math.round(r.cost * (1 + 0.5 * n));
          return `<div class="item"><b>${ROOMS[r.type].name} <small>×${n}</small></b><span>${r.desc}</span>${btn(`Build (${cost})`, { pick: r.type }, me.wallet >= cost && g.freeSlots(r.type).length > 0)}</div>`; }).join('')}</div>${shipMapHtml(g, null)}`;
      }
    } else if (portTab === 'crew') {
      body = `${P.recruits.length ? `<p class="good">New crew signed on here: ${P.recruits.map((c) => CLASSES[c].name).join(', ')}</p>` : ''}${switchListHtml(g, me)}`;
    }
    return `<div class="port"><h2>⚓ ${esc(P.name)}</h2><p class="muted">${esc(P.flavor)}</p>
      <div class="wallet-line">Your money: <b>💰 ${Math.floor(me.wallet)}</b> · Ship gems: 💎 ${s.gems} · Scrap ⚙ ${Math.floor(s.scrap)}</div>
      <div class="tabs">${tabBtns}</div>${body}
      ${P.departT > 0 ? `<p class="bad warnline">⚓ Pilot ${esc(P.departBy || '')} is preparing to UNDOCK in ${Math.ceil(P.departT)}s. Finish purchasing. Get ready to go!</p>` : ''}
      <div class="row end"><button class="ghost" data-act='{"ui":"upgrades"}'>My upgrades</button><button class="ghost" data-act='{"close":1}'>🚶 Leave the store (walk around)</button>${departBtn(g, me, P)}</div></div>`;
  }
  function departBtn(g, me, P) {
    const pilot = g.crew.find((c) => c.cls === 'pilot');
    const mine = !pilot || pilot === me || !pilot.human;
    if (!mine) return `<button class="big" disabled title="Only the pilot can undock">Only ${esc(pilot.player || pilot.name)} (the pilot) can undock</button>`;
    const others = g.crew.some((c) => c.human && c !== me);
    const label = P.departT > 0 ? 'Undock now →' : others ? 'Undock & dig → (15s warning)' : 'Undock & dig →';
    return `<button class="big" data-act='{"t":"depart"}'>${label}</button>`;
  }

  function shipMapHtml(g, pick) {
    const free = pick ? g.freeSlots(pick) : [];
    const cells = [];
    const covered = new Map();   // "sx,sy" -> the room covering that slot
    for (const r of g.ourRooms) { const [w, h] = roomSize(r.type); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) covered.set(`${r.sx + x},${r.sy + y}`, r); }
    for (let sy = 0; sy < SHIP_ROWS; sy++) for (let sx = 0; sx < SHIP_COLS; sx++) {
      const r = covered.get(`${sx},${sy}`);
      const f = free.find((x) => x.sx === sx && x.sy === sy);
      if (r) {
        const [w, h] = roomSize(r.type);
        if (r.sx !== sx || r.sy !== sy) continue;   // a big room is drawn once, spanning its slots
        cells.push(`<div class="cell room" style="--c:${ROOMS[r.type].color};grid-column:${sx + 1} / span ${w};grid-row:${sy + 1} / span ${h}" title="${ROOMS[r.type].name}">${ROOMS[r.type].name.split(' ')[0]}</div>`);
      } else if (f) cells.push(`<button class="cell free" style="grid-column:${sx + 1};grid-row:${sy + 1}" data-act='${JSON.stringify({ t: 'buyRoom', type: pick, sx, sy })}'>+</button>`);
      else cells.push(`<div class="cell" style="grid-column:${sx + 1};grid-row:${sy + 1}"></div>`);
    }
    return `<div class="shipmap">${cells.join('')}</div>`;
  }

  function upgradesHtml(g, me) {
    const def = CLASSES[me.cls];
    const ups = CLASS_UPGRADES[me.cls];
    const abil = Object.entries(def.abilities).map(([k, id]) => `<li><kbd>${k.toUpperCase()}</kbd> <b>${ABILITIES[id].name}</b> — ${esc(ABILITIES[id].desc)}</li>`).join('');
    const xp = Math.floor(me.xp || 0);
    return `<h2>${esc(me.name)} the ${def.name}</h2><p class="muted">${esc(def.blurb)}</p>
      <ul class="abil"><li><kbd>LMB</kbd> <b>${weaponName(me)}</b></li>${abil}<li><kbd>SHIFT</kbd> <b>Dash</b> — a quick burst with a puff of smoke (uses stamina${['engineer', 'chef', 'mrclean', 'dog', 'chameleon', 'trainer', 'vaelift'].includes(me.cls) ? '; melee fighters go further' : ''}).</li></ul>
      <div class="wallet-line"><span class="xp">✦ ${xp} XP</span> <span class="muted">· earned by doing your job: ${esc(xpHint(me.cls))}</span></div>
      <div class="grid2">${ups.map(([name, desc], k) => { const lvl = me.upgrades[k]; const cost = xpCost(lvl);
        return `<div class="item"><b>${name} <small>${'★'.repeat(lvl)}${'☆'.repeat(CLASS_UP_MAX - lvl)}</small></b><span>${desc}</span>${lvl >= CLASS_UP_MAX ? '<em>MAX</em>' : `<button ${xp >= cost ? '' : 'disabled'} data-act='${JSON.stringify({ t: 'classUpgrade', track: k })}'>★ for ${cost} XP</button>`}</div>`; }).join('')}</div>
      <div class="row end"><button data-act='{"close":1}'>Done</button></div>`;
  }
  function xpHint(cls) {
    return { pilot: 'flying the descent, gem veins, rallying', engineer: 'repairing anything', urchid: 'insulting people (barely)', guard: 'repairs, fights, guarding', chef: 'serving meals (more for more mouths)',
      mrclean: 'sweeping, putting out fires', missiletech: 'missile hits, installing guns', commando: 'kills, crafting guns', farmer: 'planting, watering, harvesting',
      scientist: 'research', dog: 'kills', chameleon: 'backstabs, vents', trainer: 'captures', jorbal: 'bubble pops and chains', vaelift: 'kills, repairs',
      agent: 'marked targets', slots: 'spins and wins' }[cls] + '; plus repairs, fires, kills, looting and every layer you survive';
  }

  /** Take over any crew member nobody else is playing. */
  function switchListHtml(g, me) {
    const others = g.crew.filter((c) => c !== me && c.cls !== 'urchid');
    const urchid = g.crew.find((c) => c.cls === 'urchid');
    const canTroll = me.cls !== 'urchid' && (!urchid || !urchid.human);
    return `<p>Switch who you play as, any time. A bot keeps your old job going, so every station stays crewed.</p>
      <div class="classes">${others.map((c) => `<button class="cls" style="--c:${CLASSES[c.cls].color}" ${c.human ? 'disabled' : ''} data-act='${JSON.stringify({ t: 'switchClass', cls: c.cls })}'>
        <b>${esc(c.name)}${c.human ? ` <small>(${esc(c.player || 'player')})</small>` : ''}</b><span>${CLASSES[c.cls].name} · ${'★'.repeat(c.upgrades.reduce((a, b) => a + b, 0) > 0 ? 1 : 0)}${c.upgrades.reduce((a, b) => a + b, 0)} stars</span><small>${esc(CLASSES[c.cls].blurb)}</small></button>`).join('')}
      ${canTroll ? `<button class="cls troll" style="--c:${CLASSES.urchid.color}" data-act='${JSON.stringify({ t: 'switchClass', cls: 'urchid' })}'><b>Become the Urchid</b><span>⚠ TROLL CLASS</span><small>Contributes nothing. Sits in a lounge chair, sips coconut juice and insults everyone. Can't die. Just along for the ride.</small></button>` : ''}</div>
      ${me.cls === 'urchid' ? '<p class="muted">The Urchid does not get up. (Fine. It gets up if you pick someone above.)</p>' : ''}`;
  }
  function crewHtml(g, me) {
    return `<h2>The crew</h2>${switchListHtml(g, me)}<div class="row end"><button data-act='{"close":1}'>Close</button></div>`;
  }

  function pauseHtml(g) {
    if (api.online) {
      const host = api.isHost();
      const w = world;
      const aboard = w ? w.members.filter((m) => m.online).map((m) => `${esc(m.name)}${m.host ? ' ★' : ''}`).join(', ') : '';
      return `<h2>${esc(g.ship.name)}</h2>
        <p class="muted">Online ship. The game keeps running while this menu is open.${aboard ? ` Aboard: ${aboard}.` : ''}</p>
        <p class="muted">Press <kbd>Enter</kbd> to chat.</p>
        <div class="col">
        <button data-act='{"close":1}'>Back to the game</button>
        <button class="ghost" data-act='{"ui":"crew"}'>Switch crew member (C)</button>
        <button class="ghost" data-act='{"ui":"help"}'>Controls</button>
        <button class="ghost" data-act='{"ui":"mute"}'>Sound on/off</button>
        <button class="ghost" data-act='{"ui":"leave"}'>Leave the ship (a bot takes over)</button>
        ${host ? `<h3>Host</h3>
        <button class="ghost" data-act='{"ui":"restart"}'>End run & restart</button>
        <button class="ghost" data-act='{"ui":"shelve"}'>Save & send everyone to the lobby</button>
        <button class="danger" data-act='{"ui":"destroy"}'>Destroy this ship</button>` : ''}</div>`;
    }
    return `<h2>Paused</h2><div class="col">
      <button data-act='{"close":1}'>Resume</button>
      <button class="ghost" data-act='{"ui":"crew"}'>Switch crew member (C)</button>
      <button class="ghost" data-act='{"ui":"help"}'>Controls</button>
      <button class="ghost" data-act='{"ui":"mute"}'>Sound on/off</button>
      <button class="danger" data-act='{"ui":"quit"}'>Abandon run & quit to lobby</button></div>`;
  }

  function helpHtml() {
    return `<h2>How to dig</h2><div class="help">
      <p><kbd>WASD</kbd> move · <kbd>Mouse</kbd> aim · <kbd>LMB</kbd> attack · <kbd>RMB</kbd> <kbd>Q</kbd> <kbd>F</kbd> <kbd>Space</kbd> abilities (the engineer's <kbd>R</kbd> is the repair wrench; 013 also has <kbd>R</kbd> and <kbd>G</kbd>) · <kbd>X</kbd> swap to/from a makeshift gun · <kbd>Shift</kbd> dash (uses stamina)</p>
      <p><b>Candy</b> turns up around the ship: green = faster, red = faster trigger, blue = longer range, yellow = double gold per kill, white = a lightning chain gun, rainbow = all of it. Every star you spend also adds health and stamina.</p>
      <p><b>Random events</b> happen on the way down (traders, fires, broken engines, storks, viruses, worms, strawberries...). The deeper you go, the nastier they get.</p>
      <p><kbd>E</kbd> use a station, shut a door or prop it open, unseal doors (clearance), lie down in a bed. <b>Hold <kbd>R</kbd></b> to repair the nearest broken system, wall, door, breach or wreckage, and to spray your fire extinguisher (013 uses <kbd>V</kbd>: his R is a mine). Holding E works too.</p>
      <p><kbd>Esc</kbd> as the Urchid in ghost mode: back to your own eyes.</p>
      <p><kbd>L</kbd> seal / unseal every door during a docking. A walkway runs around the whole ship with 4 blast doors (open until someone shuts them; each one shuts as a whole).</p>
      <p><kbd>Tab</kbd> upgrades (spend XP: you earn it doing your job) · <kbd>C</kbd> switch crew member · <kbd>M</kbd> hide/show the minimap · <kbd>Mouse wheel</kbd> zoom · <kbd>Esc</kbd> menu</p>
      <p><b>Power:</b> the scientist routes the ship's power cells at the lab: engines (speed, dodging), bubbles (recharge), weapons (every gun needs power), systems (feeders, research) and the galley (better meals). Build Power Cores for more.</p>
      <p><b>Guns:</b> found in wrecks or bought at ports, installed by the missile technician at the weapons bay.</p>
      <p><b>The loop:</b> “Sea Level” → enemy mix → <b>DIG!</b> → the pilot steers the descent (rocks hurt, gem veins pay) → pick a stop → fight, shop, or find Joe's notes.</p>
      <p><b>Dockings:</b> you see them coming. Deeper down, up to four ships dock at once and blow holes in the hull. The weapons bay (or the pilot) picks which of their rooms our D-guns and missiles hit; bubbles block guns, not missiles. Wreck their bridge + engine or kill their crew and they surrender: then loot them, and the pilot undocks when everyone's back. Lose our weapons bay and we can't shoot; lose the bridge and we can't escape; lose an engine and the ship catches fire.</p>
      <p><b>Everything breaks, everything can be fixed:</b> breaches leak dirt and creatures crawl through them. Smashed doorways sometimes cave in and block the way. Fires spread unless you put them out (MrClean is fastest). Somebody fix the doors.</p>
      </div><div class="row end"><button data-act='{"close":1}'>Got it</button></div>`;
  }

  /** 013's secret mission: a typed paper report, with the mark's picture and a disguise. */
  function missionHtml(g, me) {
    const M = g.mission; if (!M) return '';
    const disguised = me.disguise != null;
    setTimeout(() => { const cv = card.querySelector('canvas.mark'); if (cv && g.roster[M.type]) { const c = cv.getContext('2d'); c.clearRect(0, 0, 96, 96); drawMob(c, { x: 48, y: 50, r: 26, facing: Math.PI / 2, id: 7, marked: true }, g.roster[M.type], performance.now() / 1000); } }, 0);
    return `<div class="paper"><div class="stamp">TOP SECRET</div><h2>Mission #${M.id}</h2>
      <div class="paper-row"><canvas class="mark" width="96" height="96"></canvas><div><p><b>THE MARK:</b> one of the ${esc(M.name)} (gold ring on the watch).</p><p>${esc(M.text)}</p><p class="muted">${esc(M.brief)}</p></div></div>
      <p>An arrow on your watch points the way. Shooting gives away a disguise.</p>
      <div class="row"><button data-act='${JSON.stringify(disguised ? { t: 'disguise', off: true } : { t: 'disguise' })}'>${disguised ? 'Take the disguise off' : `Put on the ${esc(M.name)} uniform (disguise)`}</button><button class="ghost" data-act='{"close":1}'>Burn after reading</button></div></div>`;
  }
  /** A trader alongside (random event): missiles and scrap both ways, plus guns you can't get anywhere else. */
  function traderHtml(g, me) {
    const T_ = g.trader; if (!T_) return '';
    const s = g.ship;
    const btn = (label, act, ok = true) => `<button ${ok ? '' : 'disabled'} data-act='${JSON.stringify(act)}'>${label}</button>`;
    return `<h2>🛒 A trader pulls alongside</h2><p class="muted">"Missiles, scrap, money, and things you won't find at any port. Quick, I'm leaving in ${Math.ceil(T_.t)}s."</p>
      <div class="wallet-line">Your money: <b>💰 ${Math.floor(me.wallet)}</b> · 🚀 ${s.missiles}/${s.missilesMax} · ⚙ ${Math.floor(s.scrap)}</div>
      <div class="grid2">
        <div class="item"><b>Sell a D-missile</b><span>They pay ${T_.missileBuy}</span>${btn(`Sell (+${T_.missileBuy})`, { t: 'trade', what: 'sellMissile' }, s.missiles > 0)}</div>
        <div class="item"><b>Buy a D-missile</b><span>${T_.missilePrice} each</span>${btn(`Buy (${T_.missilePrice})`, { t: 'trade', what: 'buyMissile' }, me.wallet >= T_.missilePrice && s.missiles < s.missilesMax)}</div>
        <div class="item"><b>Sell 20 scrap</b><span>They pay ${T_.scrapBuy}</span>${btn(`Sell (+${T_.scrapBuy})`, { t: 'trade', what: 'sellScrap' }, s.scrap >= 20)}</div>
        <div class="item"><b>Buy 20 scrap</b><span>${T_.scrapPrice}</span>${btn(`Buy (${T_.scrapPrice})`, { t: 'trade', what: 'buyScrap' }, me.wallet >= T_.scrapPrice)}</div>
        ${T_.guns.map((id, i) => { const G = SHIP_GUNS[id]; return `<div class="item"><b>${G.name} <small>⚡${G.power}</small>${G.trader ? ' <small class="good">trader only</small>' : ''}</b><span>${G.desc}</span>${btn(`Buy (${G.cost})`, { t: 'trade', what: 'buyGun', i }, me.wallet >= G.cost)}</div>`; }).join('')}
      </div><div class="row end"><button data-act='{"close":1}'>Done</button></div>`;
  }
  /** The monster trainer's first pet. */
  function starterHtml(g, me) {
    setTimeout(() => card.querySelectorAll('canvas[data-st]').forEach((cv) => { const ty = g.roster.find((x) => x.starter === cv.dataset.st); if (ty) { const c = cv.getContext('2d'); c.clearRect(0, 0, 72, 72); drawMob(c, { x: 36, y: 38, r: 20, facing: Math.PI / 2, id: 3 }, ty, 0); } }), 0);
    return `<h2>Pick your starter monster</h2><p class="muted">A trainer never goes into a fight empty-handed. Pick one; you can catch the rest of your team yourself (Q).</p>
      <div class="classes">${STARTER_MONSTERS.map((s) => `<button class="cls" style="--c:${s.color}" data-act='${JSON.stringify({ t: 'pickStarter', id: s.id, close: 0 })}'><canvas data-st="${s.id}" width="72" height="72"></canvas><b>${s.icon} ${esc(s.name)}</b><small>${esc(s.desc)}</small></button>`).join('')}</div>`;
  }
  /** The credits roll over the island, bottom to top. */
  function renderCredits(g, on) {
    const el = $('.g-credits');
    if (!on) { if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; }
    if (el.classList.contains('hidden')) {
      const crew = g.crew.map((c) => `<p><b>${esc(c.name)}</b> · ${esc(CLASSES[c.cls].name)}${c.player ? ` <i>(${esc(c.player)})</i>` : ''}</p>`).join('');
      el.innerHTML = `<div class="roll">
        <h2>DO I GO?</h2><p class="muted">${esc(g.ship.name)} made it to the center of the world.</p>
        ${(g.endLines || []).map((l) => `<p>${esc(l)}</p>`).join('')}
        <h3>The crew</h3>${crew}${g.joe.state === 'saved' ? '<p><b>Joe</b> · Brother · fixed every door on the island</p>' : ''}
        <h3>Featuring</h3><p>${g.stats.kills} enemies who should have stayed home</p><p>${g.stats.repairs} repairs · ${g.stats.meals} meals · ${g.stats.insults} insults</p>
        <h3>Game design</h3><p>commanderstitch (right, yeah, that guy again)</p>
        <h3>Special thanks</h3><p>The Urchid, for contributing nothing</p><p>Every door that held</p>
        <p class="muted">Go on, have a walk around the island.</p></div>
        <button class="scores" data-scores="1">Show the scores</button>`;
      el.classList.remove('hidden');
    }
  }

  function endHtml(g) {
    const won = g.phase === 'ending';
    const score = g.finalScore();
    const scores = api.highScores(g, score);
    return `<div class="end ${won ? 'won' : 'lost'}"><h2>${won ? '☀ The center of the world' : '💀 Lost in the dirt'}</h2>
      ${(won ? g.endLines : [g.endMsg || 'The ship is gone.']).map((l) => `<p>${esc(l)}</p>`).join('')}
      <div class="score">${won && g.joe.state === 'saved' ? '<span class="arms" title="Saved your brother">💪🤝💪</span> ' : ''}${esc(g.ship.name)}: <b>${score.toLocaleString()}</b></div>
      <p class="muted">${depthText(g)} · ${g.stats.kills} kills · ${g.stats.gems} gem value · ${g.stats.repairs} repairs · ${g.stats.meals} meals · ${g.stats.insults} insults</p>
      <h3>DIG high scores</h3><ol class="hs">${scores.map((s) => `<li class="${s.mine ? 'mine' : ''}">${s.arms ? '💪🤝💪 ' : ''}${esc(s.ship)} — ${s.score.toLocaleString()} <small>${esc(s.result)}</small></li>`).join('')}</ol>
      ${api.online
        ? `<div class="row">${api.isHost() ? `<button data-act='{"ui":"restart"}'>Dig again (new run)</button>` : '<span class="muted">Waiting for the host to start a new run.</span>'}<button class="ghost" data-act='{"ui":"leave"}'>Back to the lobby</button></div></div>`
        : `<div class="row"><button data-act='{"ui":"again"}'>Dig again</button><button class="ghost" data-act='{"ui":"quit"}'>Back to the lobby</button></div></div>`}`;
  }

  // ---------------- station panels
  function panelHtml(g, me, d) {
    const room = d.room != null ? g.rooms[d.room] : null;
    const s = g.ship;
    const head = (t, sub = '') => `<h2>${t}</h2>${sub ? `<p class="muted">${sub}</p>` : ''}`;
    const sysLine = room?.sys ? `<div class="sysline">System ${Math.ceil(room.sys.hp)}/${room.sys.max} ${room.sys.hp < room.sys.max ? `· hold <kbd>${fixKey(me).toUpperCase()}</kbd> near it to repair` : '· all good'}</div>` : '';
    const owner = room ? CLASSES[ROOMS[room.type]?.cls] : null;
    const notMine = owner && me.cls !== ROOMS[room.type]?.cls;
    const close = `<div class="row end"><button data-act='{"close":1}'>Close</button></div>`;
    const btn = (label, act, ok = true) => `<button ${ok ? '' : 'disabled'} data-act='${JSON.stringify(act)}'>${label}</button>`;
    if (d.panel !== 'vents' && notMine && !['helm', 'weapons', 'vault', 'casino', 'lounge', 'lab'].includes(d.panel)) return head(room.name, `This is ${owner.name}'s station.`) + sysLine + `<p class="muted">${esc(owner.blurb)}</p>` + close;
    switch (d.panel) {
      case 'vents': return ventMapHtml(g, me, d);
      case 'power': return head('Power Core', 'Each running Power Core adds 3 cells to the bank. The scientist routes them at the lab.') + sysLine + `<p>Cells: ${s.power.cells}</p>` + close;
      case 'helm':
        if (g.phase === 'descent' && me.cls === 'pilot') return head('The Helm', 'Steer through the tunnel toward the light. Rocks and creatures hurt; gem veins and fuel pockets pay.') + sysLine + `<div class="row">${btn('Take the helm', { t: 'helm', on: true })}</div>` + close;
      {
        const noTech = !g.crew.some((c) => c.cls === 'missiletech');
        const fighting = g.phase === 'encounter' && g.fightingShips.some((es) => es.kind === 'ship' || es.kind === 'boss');
        const engOk = g.rooms.some((r) => r.owner === 'us' && r.type === 'engine' && r.sys.hp > 0);
        return head('The Helm', g.phase === 'encounter' ? 'Docked. Press <kbd>Q</kbd> here (pilot) for evasive maneuvers: enemy D-fire misses for 4s.' : 'The pilot steers during the descent.') + sysLine
          + `<p>Speed ×${speedFactor(g).toFixed(2)} · Fuel ${Math.ceil(s.fuel)}/${s.fuelMax} · Dodge ${Math.round(g.dodgeChance() * 100)}% (engine power)</p>`
          + (fighting && me.cls === 'pilot' ? `<div class="row">${btn(g.fleeT > 0 ? `Escaping in ${Math.ceil(g.fleeT)}s…` : `🏃 Escape: cut the tunnels and run (${escapeTime(g)}s; more engines = faster)`, { t: 'flee' }, !(g.fleeT > 0) && room?.sys.hp > 0)}
            ${btn('🔥 Burn an engine: escape NOW (guaranteed)', { t: 'burnEngine' }, engOk && !g.weFled)}</div>` : '')
          + (fighting && noTech ? `<p class="muted">No missile technician aboard: you pick what our D-guns and missiles hit.</p>${targetsHtml(g)}` : '') + close;
      }
      case 'engine': {
        const engines = g.rooms.filter((r) => r.owner === 'us' && r.type === 'engine');
        return head('Engines', 'More engines = faster descent, more fuel, more to fix. Only engineers fix engines properly (hit them with the wrench).') + engines.map((r, k) => `<div class="sysline">Engine ${k + 1}: ${Math.ceil(r.sys.hp)}/${r.sys.max}</div>`).join('') + `<p>Speed ×${speedFactor(g).toFixed(2)}</p>` + close;
      }
      case 'weapons': {
        const live = g.phase === 'encounter' && g.fightingShips.length > 0;
        const tech = me.cls === 'missiletech';
        let pw = g.pw('weapons');
        const rack = s.guns.map((gun, i) => { const G = SHIP_GUNS[gun.id]; const on = pw >= G.power; if (on) pw -= G.power;
          return `<div class="item ${on ? '' : 'off'}"><b>${i + 1}. ${G.name} <small>⚡${G.power}${on ? '' : ' · NO POWER'}</small></b><span>${G.desc}</span>${tech ? `<div class="row">${i > 0 ? btn('▲', { t: 'gunUp', gun: i }) : ''}${btn('Remove', { t: 'uninstall', gun: i })}</div>` : ''}</div>`; }).join('');
        const store = s.items.map((it, i) => { const G = SHIP_GUNS[it.id]; return `<div class="item"><b>${G.name} <small>⚡${G.power}</small></b><span>${G.desc}</span>${tech ? btn('Install', { t: 'install', item: i }, s.guns.length < s.gunSlots) : '<em>missile tech installs</em>'}</div>`; }).join('');
        return head('D-Weapons Bay', 'Pick the enemy room our guns and D-missiles hit. Bubbles stop most guns, not missiles. Lose this room and we can\'t fire at all.') + sysLine +
          `<p>Weapons power: ⚡${g.pw('weapons')} (the first guns in the rack get it first) · rack ${s.guns.length}/${s.gunSlots}
          ${tech && s.gunSlots < 10 ? btn(`Extend the rack (+1 slot, ${40 + 25 * (s.rackUp || 0)} scrap)`, { t: 'expandRack' }, s.scrap >= 40 + 25 * (s.rackUp || 0)) : ''}</p>
          <div class="grid2">${rack}</div>
          ${s.items.length ? `<h3>In storage</h3><div class="grid2">${store}</div>` : ''}
          <p>Missiles ${s.missiles}/${s.missilesMax} ${s.buildT > 0 ? `· building (${s.buildT.toFixed(1)}s)` : ''}</p>
          <div class="row">${btn('Build a missile (12 scrap)', { t: 'buildMissile' }, s.scrap >= 12 && s.buildT <= 0 && s.missiles < s.missilesMax)}
          ${live ? btn(s.missileReady ? '🚀 FIRE D-MISSILE' : 'Loading…', { t: 'fireMissile' }, s.missileReady) : ''}</div>
          ${live ? targetsHtml(g) : '<p class="muted">No enemy docked.</p>'}` + close;
      }
      case 'shield': return head('Bubble Generator', 'Bubbles block D-gun shots (not missiles). They recharge while this is online.') + sysLine + `<p>Bubbles ${s.bubble}/${s.bubbleMax}</p>` + close;
      case 'vault': return head('The Vault', 'Gems from the feeders land here. Thieves will come for them. Sell at ports.') + sysLine + `<p>💎 ${s.gems}/${s.gemCap}</p>${me.cls === 'guard' ? '<p class="muted">Upgrade Vault Mastery (Tab) for more space and bigger payouts. Q lunge, F lockdown.</p>' : ''}` + close;
      case 'kitchen': {
        const pantry = ['grub', 'shroom', 'fish', 'spice', 'crops'].map((k) => `${k} ${s.food[k] || 0}`).join(' · ');
        const targets = ['all', ...new Set(g.crew.filter((c) => c.cls !== 'urchid').map((c) => c.cls))];
        const tsel = modalData.target || 'all';
        const kp = g.pw('kitchen');
        return head('The Galley', 'Cook from feeder food and farm crops, then teleport the meal. Every meal heals (the better the food, the more), and buffs come with small side-effects.') + sysLine +
          `<p>Pantry: ${pantry} · Galley power ⚡${kp} (more power: better gear, bigger heals, faster cooking)</p>${me.cooking ? `<p class="good">Cooking ${RECIPES.find((r) => r.id === me.cooking.recipe).name}… ${me.cooking.t.toFixed(1)}s</p>` : ''}
          <div class="row wrap">Serve to: ${targets.map((t) => `<button class="chip ${tsel === t ? 'on' : ''}" data-act='${JSON.stringify({ ui: 'target', target: t })}'>${t === 'all' ? 'Everyone' : CLASSES[t].name}</button>`).join('')}</div>
          <div class="grid2">${RECIPES.map((r) => { const ok = Object.entries(r.needs).every(([k, v]) => (s.food[k] || 0) >= v); const powered = kp >= r.power;
            const heal = Math.round(r.heal * (1 + 0.35 * kp) * (1 + 0.1 * me.upgrades[0]));
            return `<div class="item ${powered ? '' : 'off'}"><b>${r.name} <small>+${heal} HP${r.power ? ` · ⚡${r.power}` : ''}</small></b><span>${Object.entries(r.needs).map(([k, v]) => `${v} ${k}`).join(', ')} → ${r.text}</span>${btn(powered ? 'Cook' : `Needs ⚡${r.power}`, { t: 'cook', recipe: r.id, target: tsel }, ok && !me.cooking && powered)}</div>`; }).join('')}</div>` + close;
      }
      case 'closet': return head('Janitor Closet', 'Hold E on messes to sweep (2 money each). A clean ship is a fast ship.') + sysLine + `<p>Messes aboard: ${g.messCount || 0} ${g.cleanBuff ? '· ✨ clean-ship bonus active' : ''}</p>` + close;
      case 'armory': return head('Armory', 'Mash broken parts into a makeshift gun anyone can use.') + sysLine + `<div class="row">${btn('Craft makeshift gun (15 scrap)', { t: 'craftGun' }, s.scrap >= 15)}</div>` + close;
      case 'farm': {
        const f = s.farm;
        return head('Dirt Farm', 'A big farm. Dirt leaks in through breaches and the roof. Scoop it (E), bring it here, plant, water (twice as fast), harvest.') + sysLine +
          `<p>Dirt ${f.dirt} · Crops ${s.food.crops || 0} ${me.carrying ? `· carrying ${me.carrying} (press E at the station to drop)` : ''}</p>
          <div class="plots">${f.plots.map((p, k) => `<div class="plot s${p.stage} ${p.wet ? 'wet' : ''}"><b>Plot ${k + 1}</b><span>${['empty', 'sprout', 'growing', 'ripe!'][p.stage]}${p.wet ? ' 💧' : ''}</span>${p.stage === 0 ? btn('Plant', { t: 'plant', plot: k }, f.dirt > 0) : p.stage >= 3 ? btn('Harvest', { t: 'harvest', plot: k }) : `${p.wet ? '' : btn('Water', { t: 'water', plot: k })}<i style="width:${pct(p.t, 20)}"></i>`}</div>`).join('')}</div>` + close;
      }
      case 'lab': {
        const r = s.researching;
        const sci = me.cls === 'scientist';
        const used = g.powerUsed();
        const cells = Array.from({ length: s.power.cells }, (_, k) => `<i class="${k < used ? 'on' : ''}"></i>`).join('');
        const rows = Object.entries(POWER_SYS).map(([k, P]) => { const n = g.pw(k);
          return `<div class="prow"><b>${P.name}</b><span class="pips">${Array.from({ length: P.max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>
            ${sci ? `${btn('−', { t: 'power', sys: k, d: -1 }, n > 0)}${btn('+', { t: 'power', sys: k, d: 1 }, used < s.power.cells && n < P.max)}` : ''}<small>${esc(P.desc)}</small></div>`; }).join('');
        return head('Laboratory', 'Research takes time at the lab and costs scrap. The power cells are routed from here.') + sysLine +
          `<h3>⚡ Power routing</h3><div class="cells">${cells}<small>${used}/${s.power.cells} cells in use${sci ? '' : ' · only the scientist can move them (without one, they spread out on their own)'}</small></div>
          <div class="power">${rows}</div>
          <p class="muted">Need more? Build a Power Core at a port (+3 cells). Guns that don't get their power shut down.</p>
          <h3>🔬 Research</h3>` +
          (r ? `<p class="good">Researching ${RESEARCH.find((x) => x.id === r.id).name}: ${Math.floor(r.progress / r.time * 100)}% (stay in the lab)</p>` : '') +
          `<div class="grid2">${RESEARCH.map((x) => `<div class="item ${s.research.has(x.id) ? 'done' : ''}"><b>${x.name}</b><span>${x.desc} · ${x.scrap} scrap, ${x.time}s</span>${s.research.has(x.id) ? '<em>DONE</em>' : btn('Research', { t: 'research', id: x.id }, sci && !r && s.scrap >= x.scrap)}</div>`).join('')}</div>` + close;
      }
      case 'kennel': return head('Kennel', 'Lie still in the dog bed to heal. Upgrade the bed (Tab) to heal faster.') + sysLine + close;
      case 'pen': return head('Monster Pen', 'Knocked-out monsters revive here (faster while you stand in the pen).') + sysLine +
        `<div class="grid2">${me.monsters.map((m) => `<div class="item"><b>${esc(m.name)}</b><span>HP ×${m.hpMul.toFixed(2)} · DMG ×${m.dmgMul.toFixed(2)} · ${m.out ? 'out fighting' : m.reviveT > 0 ? `reviving ${Math.ceil(m.reviveT)}s` : 'ready'}</span>${btn('Release', { ui: 'release', type: m.type })}</div>`).join('') || '<p class="muted">No monsters yet. Weaken an enemy below 35% and throw a cube (Q).</p>'}</div>` + close;
      case 'den': return head('Vent Den', 'Every room has a vent. Press E at a vent (or point at one and press E) and pick which vent to come out of on the map. Docked enemy ships have vents too.') + sysLine + close;
      case 'bubbler': return head('Bubble Grotto', 'You can see the air currents: one runs all the way round the outer walkway, and a couple wind from room to room. They shift with every docking. Bubbles ride them, and so can you: Space hops onto a bubble.') + sysLine + close;
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
      case 'panel': if (me && e.crew === me.id) { if (e.panel === 'helm' && g.phase === 'descent' && me.cls === 'pilot') { api.cmd({ t: 'helm', on: true }); } else openModal('panel', { panel: e.panel, room: e.room, vent: e.vent, sel: 0 }); } break;
      case 'gunfound': toast(`🔫 Found a ${SHIP_GUNS[e.id]?.name || 'gun'}! The missile tech can install it at the weapons bay.`); break;
      case 'recruit': toast(`🦊 ${e.name} the ${CLASSES[e.cls].name} joined the crew!`); break;
      case 'watch': if (me && e.crew === me.id) toast(`⌚ New mark: ${e.target}. ${e.text}`); break;
      case 'event': toast(`${e.good ? '✨' : '⚠'} ${e.name}!`); break;
      case 'mainevent': toast(`☠ THE MAIN EVENT: ${e.name}`); break;
      case 'unlock': toast('📡 Signal locked!'); break;
      case 'switch': if (!api.online || (me && (e.to === me.id || e.from === me.id))) toast('You switched class.'); break;
    }
  }

  // ---- the chameleon's vent map: every vent on every ship; click one (or arrows/WASD + Enter/E)
  function ventList(g, d) { return g.objs.filter((o) => o.kind === 'vent' && !o.broken && o.id !== d.vent); }
  function ventMapHtml(g, me, d) {
    const vents = ventList(g, d);
    const from = g.objs.find((o) => o.id === d.vent);
    if (!vents.length || !from) return `<h2>Vent map</h2><p class="muted">No other vents to crawl to.</p><div class="row end"><button data-act='{"close":1}'>Close</button></div>`;
    d.sel = Math.max(0, Math.min(vents.length - 1, d.sel ?? 0));
    const rooms = g.rooms.filter((r) => !r.gone);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rooms) { x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x0 + (r.w ?? SLOT_W)); y1 = Math.max(y1, r.y0 + (r.h ?? SLOT_H)); }
    const W = 620, sc = W / ((x1 - x0 + 2) * TILE), H = Math.round((y1 - y0 + 2) * TILE * sc);
    const X = (px) => ((px / TILE - x0 + 1) * TILE * sc).toFixed(1), Y = (py) => ((py / TILE - y0 + 1) * TILE * sc).toFixed(1);
    const rects = rooms.map((r) => `<rect x="${X(r.x0 * TILE)}" y="${Y(r.y0 * TILE)}" width="${((r.w ?? SLOT_W) * TILE * sc).toFixed(1)}" height="${((r.h ?? SLOT_H) * TILE * sc).toFixed(1)}" fill="${r.owner === 'them' ? '#4a2622' : ROOMS[r.type]?.color || '#333'}" stroke="${r.owner === 'them' ? '#a04030' : '#6a625a'}" stroke-width="1.5"/>`).join('');
    const dots = vents.map((v, i) => `<g class="vdot ${i === d.sel ? 'sel' : ''}" data-act='${JSON.stringify({ t: 'vent', from: d.vent, to: v.id })}'><circle cx="${X(v.x)}" cy="${Y(v.y)}" r="${i === d.sel ? 11 : 8}" fill="${v.owner === 'them' ? '#ff6a3a' : '#40d090'}" stroke="#fff" stroke-width="${i === d.sel ? 3 : 1}"/></g>`).join('');
    const sel = vents[d.sel];
    const where = g.rooms[g.grid.room[Math.floor(sel.y / TILE) * g.W + Math.floor(sel.x / TILE)]];
    return `<h2>🕳 Vent map</h2><p class="muted">Pick a vent to come out of. Green: ours. Orange: theirs. <kbd>←↑→↓</kbd>/<kbd>WASD</kbd> to choose, <kbd>Enter</kbd> or <kbd>E</kbd> to go, or click.</p>
      <svg class="ventmap" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${rects}<circle cx="${X(from.x)}" cy="${Y(from.y)}" r="9" fill="none" stroke="#f4c542" stroke-width="3" stroke-dasharray="4 3"/>${dots}</svg>
      <p>→ <b>${esc(where?.name || 'somewhere')}</b>${sel.owner === 'them' ? ' <span class="bad">(their ship)</span>' : ''}</p>
      <div class="row end"><button class="ghost" data-act='{"close":1}'>Stay here</button><button data-act='${JSON.stringify({ t: 'vent', from: d.vent, to: sel.id })}'>Crawl there</button></div>`;
  }
  /** Keys while a modal is open. Returns true if the key was used. */
  function keyNav(code) {
    if (modalKind !== 'panel' || modalData?.panel !== 'vents') return false;
    const g = api.game(); if (!g) return false;
    const vents = ventList(g, modalData);
    if (!vents.length) return false;
    const cur = vents[modalData.sel ?? 0] || vents[0];
    const dirs = { ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0], ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1] };
    if (dirs[code]) {
      // the nearest vent in that direction (or just the next one)
      const [dx, dy] = dirs[code];
      let best = -1, bd = Infinity;
      vents.forEach((v, i) => { const ox = v.x - cur.x, oy = v.y - cur.y; const along = ox * dx + oy * dy; if (along <= 4) return; const d = along + Math.abs(ox * dy - oy * dx) * 2; if (d < bd) { bd = d; best = i; } });
      modalData.sel = best >= 0 ? best : ((modalData.sel ?? 0) + (dx + dy > 0 ? 1 : -1) + vents.length) % vents.length;
      api.sfx?.uiHover?.(); render(true); return true;
    }
    if (code === 'Enter' || code === 'KeyE' || code === 'Space') { api.cmd({ t: 'vent', from: modalData.vent, to: cur.id }); closeModal(); return true; }
    return false;
  }

  /** Room picker for our D-weapons, one row per docked enemy ship. */
  function targetsHtml(g) {
    const s = g.ship;
    return g.fightingShips.map((es) => `<h3>${esc(es.name)}</h3><div class="targets">${es.rooms.map((i) => { const r = g.rooms[i];
      return `<button class="${s.missileTarget === i ? 'on' : ''}" ${r.sys.hp > 0 ? '' : 'disabled'} data-act='${JSON.stringify({ t: 'target', room: i })}'>${esc(r.name)}<small>${Math.ceil(r.sys.hp)}/${r.sys.max}</small></button>`; }).join('')}</div>`).join('');
  }

  function panelTarget(t) { if (modalData) modalData.target = t; render(true); }

  // ---- online: ship info from the server, and chat
  let world = null;
  function setWorld(w) {
    const was = world;
    world = w;
    const banner = $('.g-hold');
    const msg = w.pausedReason && w.run.status === 'active' ? `⏸ ${w.pausedReason}` : '';
    banner.textContent = msg; banner.classList.toggle('hidden', !msg);
    if (was && modalKind === 'pause') render(true);
  }
  const chat = $('.g-chat');
  function openChat() {
    chat.classList.remove('hidden');
    chat.querySelector('input').focus();
  }
  chat.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = chat.querySelector('input');
    if (input.value.trim()) api.chat?.(input.value);
    input.value = ''; input.blur(); chat.classList.add('hidden');
  });
  chat.querySelector('input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.target.value = ''; e.target.blur(); chat.classList.add('hidden'); e.stopPropagation(); }
  });

  return { canvas, update, onFx, openModal, closeModal, isOpen, kind: () => modalKind, toast, render, panelTarget, data: () => modalData, setWorld, openChat, keyNav };
}
