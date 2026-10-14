import { firebaseConfig, appCheckSiteKey } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js';
import {
  getDatabase, ref, get, set, update, remove, push, onValue, onDisconnect,
  runTransaction, increment, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import * as L from './logic.js?v=3.2';
import { loadContent, mergeContent, parseUpload, toArray, FILES as CONTENT_FILES, FILE_LABELS } from './content.js?v=3.2';
import * as E from './effects.js?v=3.2';
import { makeFinal, NEEDS, needMeta, itemNeeds } from './final.js?v=3.2';
import * as S from './sfx.js?v=3.2';
import * as T from './tts.js?v=3.2';

// ---------------- Firebase ----------------
const fbApp = initializeApp(firebaseConfig);
// App Check: база принимает запросы только с этого сайта.
// На localhost используется отладочный токен (его нужно один раз добавить в Firebase Console → App Check → Manage debug tokens).
if (appCheckSiteKey) {
  if (['localhost', '127.0.0.1'].includes(location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  initializeAppCheck(fbApp, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true });
}
const db = getDatabase(fbApp);
let serverOffset = 0;
onValue(ref(db, '.info/serverTimeOffset'), s => { serverOffset = s.val() || 0; });
const now = () => Date.now() + serverOffset;

// ---------------- Локальное состояние ----------------
const LS = { pid: 'bunker.pid', name: 'bunker.name', room: 'bunker.room' };
const genId = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 16);
const me = { id: localStorage.getItem(LS.pid) || genId(), name: localStorage.getItem(LS.name) || '' };
localStorage.setItem(LS.pid, me.id);

let roomCode = null;
let state = null;
let roomUnsub = null, presenceUnsub = null;
let content = null;      // контент, с которым идёт игра (стандартный или свой набор лобби)
let baseContent = null;  // стандартный контент с сайта
let contentKey = null;

// Контент = стандартный + свой набор комнаты (rooms/{code}/content)
function syncContent() {
  if (!baseContent) {
    loadContent().then(c => { baseContent = c; syncContent(); render(); }).catch(console.error);
    return;
  }
  const key = state?.content ? String(state.content.at || 'custom') + ':' + (state.content.mode || '') : '';
  if (content && key === contentKey) return;
  contentKey = key;
  content = mergeContent(baseContent, state?.content);
  descMaps = null;
}
let advancing = false;
let storyRequested = '';
const ui = { tab: 'me', modal: null, error: '', prefill: '' };

const $app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o ?? null));
const R = p => ref(db, `rooms/${roomCode}${p ? '/' + p : ''}`);

const validPlayers = () => Object.entries(state?.players || {})
  .filter(([, p]) => p && p.name)
  .sort((a, b) => seatOf(a[1]) - seatOf(b[1]) || (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
function seatOf(p) { return typeof p.seat === 'number' ? p.seat : 1e9; }
// Оформление характеристик
const TMETA = {
  profession: { icon: '💼', color: '#3b82f6' },
  biology: { icon: '🧬', color: '#ec4899' },
  health: { icon: '🩺', color: '#ef4444' },
  hobby: { icon: '🎨', color: '#f59e0b' },
  phobia: { icon: '😱', color: '#8b5cf6' },
  baggage: { icon: '🎒', color: '#10b981' },
  fact: { icon: '📜', color: '#78716c' },
  character: { icon: '🎭', color: '#06b6d4' },
};
// Описания из content/*.json (поле desc)
let descMaps = null;
function itemIn(file, text) {
  if (!content || !text || !file) return null;
  descMaps = descMaps || {};
  if (!descMaps[file]) {
    descMaps[file] = {};
    for (const x of content[file] || []) if (x && x.text) descMaps[file][x.text] = x;
  }
  return descMaps[file][text] || null;
}
function descIn(file, text) { return (itemIn(file, text) || {}).desc || ''; }
const traitFile = key => (L.TRAITS.find(t => t.key === key) || {}).file;
// Характеристика может содержать несколько значений через « + » (после карт «Добавить»)
const SEP = ' + ';
const NONE = 'Нет';
function rawParts(pid, key) {
  const r = state?.cards?.[pid]?.raw?.[key];
  return r && r !== NONE ? String(r).split(SEP) : [];
}
const traitFood = (pid, key) => rawParts(pid, key).reduce((sum, r) => sum + (+itemNeeds(itemIn(traitFile(key), r)).food || 0), 0);
const featureFood = f => +itemNeeds(itemIn('bunkers', f)).food || 0;

// ---------- Метки нужд и проблем ----------
const tagInfo = id => (content?.tags || []).find(t => t && t.id === id) || { id, name: id, icon: '⚠️' };
function markerChips(items, hotFood = false) {
  const needs = {}, solves = new Set(), weak = new Set(), causes = new Set();
  for (const it of items) {
    if (!it) continue;
    for (const [k, v] of Object.entries(itemNeeds(it))) needs[k] = (needs[k] || 0) + (+v || 0);
    (it.solves || []).forEach(x => solves.add(x));
    (it.weak || []).forEach(x => weak.add(x));
    (it.causes || []).forEach(x => causes.add(x));
  }
  const out = [];
  for (const n of NEEDS) {
    const v = needs[n.id];
    if (!v) continue;
    out.push(`<span class="mk ${v > 0 ? 'plus' : 'minus'} ${n.id === 'food' && hotFood ? 'hot' : ''}" title="${esc(n.name)}">${n.icon}${v > 0 ? '+' : '−'}${Math.abs(v)}</span>`);
  }
  solves.forEach(id => { const t = tagInfo(id); out.push(`<span class="mk solve" title="Решает: ${esc(t.name)}">✔${t.icon}</span>`); });
  weak.forEach(id => { const t = tagInfo(id); out.push(`<span class="mk weak" title="Уязвим к: ${esc(t.name)}">⚠${t.icon}</span>`); });
  causes.forEach(id => { const t = tagInfo(id); out.push(`<span class="mk cause" title="Вызывает: ${esc(t.name)}">${t.icon}!</span>`); });
  return out.length ? `<span class="mks">${out.join('')}</span>` : '';
}
const showMarkers = g => !!g.settings?.showMarkers || g.phase === 'end';
function foodScore(pid) { return L.TRAIT_KEYS.reduce((sum, k) => sum + Math.max(0, traitFood(pid, k)), 0); }
function foodTag(v, hot) {
  if (!v) return '';
  return `<span class="food-tag ${v > 0 ? 'plus' : 'minus'} ${hot ? 'hot' : ''}" title="${v > 0 ? 'Помогает с едой' : 'Нужно больше еды или особое питание'}">🍖 ${v > 0 ? 'еда' : '−еда'}</span>`;
}
const traitDesc = (key, raw) => descIn((L.TRAITS.find(t => t.key === key) || {}).file, raw);
const cardDesc = (pid, key) => rawParts(pid, key).map(r => traitDesc(key, r)).filter(Boolean).join(' · ');
const featureDesc = f => descIn('bunkers', f);
const nameOf = pid => state?.players?.[pid]?.name || '???';
const isHost = () => state?.meta?.hostId === me.id;
const fillNames = t => String(t || '').replace(/@([A-Za-z0-9_-]+)@/g, (_, id) => nameOf(id));

function addLog(text, extra = {}) {
  if (!roomCode || !text) return;
  push(R('log'), { t: now(), text: fillNames(text), ...extra }).catch(console.error);
}

// ---------------- Игровые диалоги и уведомления ----------------
const $ov = document.createElement('div');
$ov.id = 'overlay';
document.body.appendChild($ov);
const $toasts = document.createElement('div');
$toasts.className = 'toasts';
$ov.appendChild($toasts);

function dialog({ title = '', text = '', html = '', ok = 'Да', cancel = 'Отмена', danger = false, cls = '' } = {}) {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'dlg-bg';
    el.innerHTML = `<div class="dlg ${cls}" role="dialog" aria-modal="true">
      ${title ? `<h3>${esc(title)}</h3>` : ''}${text ? `<p>${esc(text)}</p>` : ''}${html}
      <div class="dlg-btns">
        ${cancel ? `<button class="btn ghost" data-r="0">${esc(cancel)}</button>` : ''}
        <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button>
      </div></div>`;
    const done = v => { el.classList.add('out'); setTimeout(() => el.remove(), 160); resolve(v); };
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (b) done(b.dataset.r === '1');
      else if (e.target === el) done(false);
    });
    $ov.appendChild(el);
  });
}
const ask = (text, ok = 'Да', opts = {}) => dialog({ text, ok, ...opts });

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  el.addEventListener('click', () => el.remove());
  $toasts.prepend(el);
  while ($toasts.children.length > 4) $toasts.lastChild.remove();
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 3500);
}

// Анимированная карта: раскрытие характеристики или изгнание
const popupQueue = [];
let popupBusy = false;
function showPopup(entry) { popupQueue.push(entry); if (!popupBusy) nextPopup(); }
function nextPopup() {
  const e = popupQueue.shift();
  if (!e) { popupBusy = false; return; }
  popupBusy = true;
  const el = document.createElement('div');
  el.className = `popup-bg fx-${e.fx || 'reveal'}`;
  if (e.color) el.style.setProperty('--pc', e.color);
  const n = e.fx === 'exile' ? 0 : e.fx === 'cat' ? 26 : 18;
  const sparks = Array.from({ length: n }, (_, i) => {
    const ang = (i / n) * Math.PI * 2 + Math.random() * .5, dist = 110 + Math.random() * 90;
    const alt = i % 3 === 0 ? 'var(--accent)' : i % 3 === 1 ? '#fff' : 'var(--pc)';
    return `<i class="spark ${i % 2 ? 'sq' : ''}" style="--dx:${Math.cos(ang) * dist | 0}px;--dy:${Math.sin(ang) * dist | 0}px;--sc:${alt};--sd:${(.72 + Math.random() * .12).toFixed(2)}s"></i>`;
  }).join('');
  el.innerHTML = `<div class="fx-flash"></div>
  <div class="flip">
    <div class="card-back"><span>${e.back || '?'}</span></div>
    <div class="popup ${e.cls || ''}" ${e.color ? `style="--tc:${e.color}"` : ''}>
      ${e.top ? `<div class="popup-top">${esc(e.top)}</div>` : ''}
      ${e.anim || (e.icon ? `<div class="popup-ico">${e.icon}</div>` : '')}
      ${e.label ? `<div class="popup-label">${esc(e.label)}</div>` : ''}
      ${e.value ? `<div class="popup-value">${esc(e.value)}</div>` : ''}
      ${e.name ? `<div class="popup-name">${esc(e.name)}</div>` : ''}
      ${e.fx === 'exile' ? '<div class="stamp">ИЗГНАН</div>' : ''}
      ${e.sub ? `<div class="popup-sub">${esc(e.sub)}</div>` : ''}
    </div>
  </div>
  ${n ? `<div class="ring"></div><div class="sparks">${sparks}</div>` : ''}`;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    el.classList.add('out');
    setTimeout(() => { el.remove(); if (e.after) { e.after(); render(); } nextPopup(); }, 250);
  };
  el.addEventListener('click', close);
  $ov.appendChild(el);
  if (e.fx === 'cat') { document.body.classList.remove('quake'); void document.body.offsetWidth; document.body.classList.add('quake'); setTimeout(() => document.body.classList.remove('quake'), 1000); }
  if (e.sound) S.play(e.sound, { mine: !!e.mine });
  if (e.sound2) setTimeout(() => S.play(e.sound2, { mine: !!e.mine }), 900);
  setTimeout(close, e.long ? 6500 : popupQueue.length ? 2600 : 3600);
}

// Мини-анимация внутри карты действия — по типу эффекта
function actionAnim(e) {
  const f = e.fx || {};
  const g = (cls, glyph, extra = '') => `<div class="fxa ${cls}"><span class="fxa-g">${glyph}</span>${extra}</div>`;
  switch (f.kind) {
    case 'swap': return `<div class="fxa fxa-swap"><span class="chip">${esc(f.a || '')}</span><span class="mid">${esc(f.label || '')}</span><span class="chip">${esc(f.b || '')}</span></div>`;
    case 'shuffle_all': return '<div class="fxa fxa-shuffle"><span class="mini"></span><span class="mini"></span><span class="mini"></span></div>';
    case 'immunity': return g('fxa-shield', '🛡️');
    case 'double_vote': return g('fxa-pop', '✌️');
    case 'cancel_vote': return g('fxa-stamp', '🗳️', '<span class="x">✕</span>');
    case 'revive': return g('fxa-heart', '❤️');
    case 'reveal_target': return g('fxa-eye', '👁️');
    case 'bunker_reveal': return g('fxa-door', '🚪');
    case 'add': return g('fxa-pop', e.icon || '➕');
    case 'remove': return g('fxa-crumble', e.icon || '➖');
    case 'replace': return g('fxa-spin', e.icon || '🔄');
    default: return g('fxa-pop', e.icon || '🃏');
  }
}
const ACT_SOUND = { swap: 'swap', shuffle_all: 'swap', immunity: 'shield', double_vote: 'action', cancel_vote: 'stamp', revive: 'heart', bunker_reveal: 'bunker' };

// Недавние изменения на карточках — подсвечиваются анимацией
// Пока идёт окно раскрытия, карточка лежит «рубашкой вверх»; после окна переворачивается один раз.
const fresh = {};
const FRESH_MS = 1500;
function markFresh(id, cls) {
  delete pend[id]; delete hold[id];
  fresh[id] = { cls, t: Date.now() };
  setTimeout(render, FRESH_MS + 50); // убрать класс, чтобы анимация не повторялась при следующих обновлениях
}
function freshCls(id) { const f = fresh[id]; return f && Date.now() - f.t < FRESH_MS ? f.cls : ''; }
// pend — изменение уже пришло в базу, hold — его окно ещё в очереди или на экране
const pend = {}, hold = {};
function markPending(id) { if (!pend[id]) { pend[id] = Date.now(); setTimeout(render, 2600); } }
function isPending(id) { return !!pend[id] && (hold[id] || Date.now() - pend[id] < 2500); }
// Сравнить старое и новое состояние: что раскрылось и кого изгнали
function trackChanges(prev, cur) {
  const pg = prev?.game, cg = cur?.game;
  if (!pg || !cg || cg.phase === 'end') return;
  for (const [p, keys] of Object.entries(cg.revealed || {}))
    for (const k of Object.keys(keys || {})) if (keys[k] && !pg.revealed?.[p]?.[k]) markPending(`${p}:${k}`);
  for (const [p, a] of Object.entries(cg.alive || {})) if (!a && pg.alive?.[p]) markPending(p);
}

let seenLog = null;
function processLog() {
  const log = state?.log || {};
  const keys = Object.keys(log).sort();
  if (seenLog === null) { seenLog = new Set(keys); return; }
  for (const k of keys) {
    if (seenLog.has(k)) continue;
    seenLog.add(k);
    notifyEntry(log[k]);
  }
}
// ---------------- Озвучка ----------------
function narrMode() { return (state?.game?.settings || state?.settings || {}).narration || L.DEFAULT_SETTINGS.narration; }
function shouldNarrate() {
  if (!T.supported || S.prefs.tts === 'off') return false;
  const m = narrMode();
  return m === 'all' || (m === 'host' && isHost());
}
function narrate(text, opts) { if (shouldNarrate() && text) T.speak(text, opts); }
const dot = t => { t = String(t || '').trim(); return !t || /[.!?…]$/.test(t) ? t : t + '.'; };
function sayCatastrophe(g) {
  const c = g.catastrophe || {};
  return `Катастрофа. ${dot(c.title)} ${dot(c.text)} Продержаться нужно: ${dot(c.duration)}`;
}
function sayFeature(f) {
  const fm = featureFoodMonths(f);
  const food = fm === 'inf' ? 'Еды теперь бесконечно.' : fm > 0 ? `Еды прибавится на ${L.monthsText(fm)}.` : fm < 0 ? `Еды убавится на ${L.monthsText(-fm)}.` : '';
  return `${dot(f)} ${dot(featureDesc(f))} ${food}`;
}
function sayBunker(g) {
  const b = g.bunker, fi = L.foodInfo(g);
  const parts = [`Ваш бункер. Площадь ${b.size} квадратных метров. Мест: ${g.slots}.`];
  if (b.condition) parts.push(`Состояние: ${dot(b.condition.text)} ${dot(b.condition.desc)}`);
  if (fi.has) {
    if (fi.infinite) parts.push('Еда: неиссякаемый источник, голод не грозит.');
    else if (fi.status === 'ok') parts.push(`Еды на ${L.monthsText(fi.months)}, этого хватит на весь срок.`);
    else if (fi.status === 'short') parts.push(`Еды на ${L.monthsText(fi.months)}, а нужно ${L.monthsText(fi.need)}. Не хватит.`);
    else parts.push(`Еды на ${L.monthsText(fi.months)}.`);
  }
  const open = b.features.slice(0, b.shown);
  if (open.length) parts.push(`${open.length > 1 ? 'Открытые особенности' : 'В бункере есть'}: ${open.map(sayFeature).join(' ')}`);
  const hidden = b.features.length - b.shown;
  if (hidden > 0) parts.push(`Ещё ${hidden} ${L.plural(hidden, 'особенность откроется', 'особенности откроются', 'особенностей откроются')} позже.`);
  return parts.join(' ');
}
function sayFinal() {
  const fin = state?.game?.final;
  if (!fin) return '';
  const arr = v => (Array.isArray(v) ? v : v ? Object.values(v) : []);
  const story = arr(fin.story).length ? arr(fin.story) : arr(state.game.story);
  const head = fin.mode !== 'story' && fin.verdict ? `${dot(fin.verdict.title)} ${dot(fin.verdict.text)} ` : '';
  return head + story.map(dot).join(' ');
}
function sayAgain(what) {
  const g = state?.game ? L.norm(clone(state.game)) : null;
  if (!g) return;
  const text = what === 'cat' ? sayCatastrophe(g) : what === 'bunker' ? sayBunker(g) : what === 'final' ? sayFinal() : '';
  if (!T.supported) return toast('Этот браузер не умеет читать вслух', 'warn');
  if (!T.speak(text, { interrupt: true })) toast('На этом устройстве нет русского голоса для озвучки', 'warn');
}
const sayBtn = what => T.supported ? `<button class="say" data-a="say" data-say="${what}" title="Прочитать вслух">🔊</button>` : '';

function notifyEntry(e) {
  if (!e) return;
  if (e.type === 'reveal') {
    const m = TMETA[e.key] || {};
    if (e.pid && e.key) { markPending(`${e.pid}:${e.key}`); hold[`${e.pid}:${e.key}`] = true; }
    showPopup({ after: () => e.pid && e.key && markFresh(`${e.pid}:${e.key}`, 'fresh'), cls: e.key ? 'pop-trait' : '', fx: 'reveal', color: m.color, back: m.icon, icon: m.icon, top: `${e.who} раскрывает`, label: e.label, value: e.value, sub: e.desc, sound: 'flip', mine: e.pid === me.id });
  }
  else if (e.type === 'action') {
    const f = e.fx || {};
    const after = () => {
      if (f.kind === 'swap' && f.key) { markFresh(`${f.pa}:${f.key}`, 'fresh-swap'); markFresh(`${f.pb}:${f.key}`, 'fresh-swap'); }
      if (f.kind === 'shuffle_all' && f.key) (state?.game?.players || []).forEach(p => markFresh(`${p}:${f.key}`, 'fresh-swap'));
    };
    const mine = e.actor === me.id || f.pb === me.id || f.target === me.id || f.kind === 'shuffle_all';
    showPopup({ after, cls: 'pop-act', fx: 'act', back: '🃏', top: e.auto ? `${e.who} уходит — срабатывает карта` : `${e.who} применяет карту`, anim: actionAnim(e), value: e.title, sub: e.sub, sound: 'action', sound2: ACT_SOUND[f.kind], mine });
  }
  else if (e.type === 'exile') {
    if (e.pid) { markPending(e.pid); hold[e.pid] = true; }
    showPopup({ after: () => e.pid && markFresh(e.pid, 'fresh-dead'), cls: 'exile', fx: 'exile', top: 'Изгнан(а) из бункера', name: e.who, sound: 'exile', mine: e.pid === me.id });
  }
  else if (e.type === 'start') {
    ui.tab = 'bunker';
    render();
    if (shouldNarrate()) setTimeout(() => { const g = state?.game ? L.norm(clone(state.game)) : null; if (g) { T.stop(); narrate(sayCatastrophe(g)); narrate(sayBunker(g)); } }, 1800);
    showPopup({ cls: 'cat', fx: 'cat', back: '☢', top: 'Катастрофа', value: e.title, sub: `${e.catText} Продержаться: ${e.duration}.`, long: true, sound: 'siren', mine: true });
    const fd = featureDesc(e.feature);
    const parts = [];
    if (e.condition) parts.push(`Состояние: ${e.condition}.`);
    if (e.food === -1) parts.push('Еды бесконечно — голод не грозит.');
    else if (e.food) parts.push(`Еды на ${L.monthsText(e.food)}${e.need ? (e.food >= e.need ? ' — хватит.' : ` — не хватит, нужно ${L.monthsText(e.need)}.`) : '.'}`);
    if (e.feature) parts.push(`В бункере есть: ${e.feature}${fd ? '. ' + fd : ''}`);
    showPopup({ cls: 'info', fx: 'info', back: '🚪', top: 'Ваш бункер', value: `${e.size} м² · мест: ${e.slots}`, sub: parts.join(' '), long: true, sound: 'bunker', mine: true });
  } else if (e.type === 'bunker') {
    const fm = featureFoodMonths(e.feature);
    const sub = [featureDesc(e.feature), fm === 'inf' ? '🍖 Еда: бесконечно' : fm ? `🍖 Еда: ${fm > 0 ? '+' : '−'}${L.monthsText(Math.abs(fm))}` : ''].filter(Boolean).join(' ');
    narrate(`${e.round ? `Раунд ${e.round}. ` : ''}Открыта особенность бункера: ${sayFeature(e.feature)}`);
    showPopup({ cls: 'info', fx: 'info', back: '🚪', top: e.round ? `Раунд ${e.round}` : 'Бункер', label: 'Открыта особенность бункера', value: e.feature, sub, sound: 'bunker' });
  }
  else if (e.type === 'vote' || e.type === 'presence') { if (e.actor !== me.id) { toast(e.text, 'small'); if (e.type === 'vote') S.play('vote'); } }
  else { toast(e.text); S.play('pop'); }
}

// ---------------- Комнаты ----------------
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 4 }, () => CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]).join('');

function readName() {
  const el = document.getElementById('name');
  const name = (el?.value || '').trim().slice(0, 20);
  if (!name) { ui.error = 'Введите имя'; render(); return null; }
  me.name = name;
  localStorage.setItem(LS.name, name);
  return name;
}

async function createRoom() {
  const name = readName(); if (!name) return;
  let code = null;
  for (let i = 0; i < 10 && !code; i++) {
    const c = genCode();
    const s = await get(ref(db, 'rooms/' + c));
    if (!s.exists()) code = c;
  }
  if (!code) throw new Error('Не удалось подобрать код лобби, попробуйте ещё раз');
  await set(ref(db, 'rooms/' + code), {
    meta: { hostId: me.id, createdAt: now(), status: 'lobby' },
    settings: { ...L.DEFAULT_SETTINGS },
    players: { [me.id]: { name, online: true, joinedAt: now() } },
  });
  enterRoom(code);
}

async function joinRoom() {
  const name = readName(); if (!name) return;
  const code = (document.getElementById('code')?.value || '').trim().toUpperCase();
  if (code.length !== 4) { ui.error = 'Код лобби — 4 символа'; render(); return; }
  const snap = await get(ref(db, 'rooms/' + code));
  if (!snap.exists()) { ui.error = 'Лобби не найдено'; render(); return; }
  const r = snap.val();
  const ex = r.players?.[me.id];
  if (ex && ex.name) {
    if (ex.name !== name) await update(ref(db, `rooms/${code}/players/${me.id}`), { name });
  } else {
    const spectator = r.meta?.status !== 'lobby';
    await set(ref(db, `rooms/${code}/players/${me.id}`), { name, online: true, joinedAt: now(), spectator });
  }
  enterRoom(code);
}

let rejoinPending = false;
function enterRoom(code, { rejoin = false } = {}) {
  roomCode = code;
  ui.error = '';
  seenLog = null;
  rejoinPending = rejoin;
  localStorage.setItem(LS.room, code);
  if (location.hash !== '#' + code) history.replaceState(null, '', '#' + code);
  roomUnsub?.();
  roomUnsub = onValue(R(''), snap => {
    const prev = state;
    state = snap.val();
    trackChanges(prev, state);
    if (!state) return exitRoom('Лобби больше не существует');
    const p = state.players?.[me.id];
    if (!p || !p.name) return exitRoom('Вас удалили из лобби');
    syncContent();
    if (rejoinPending) {
      rejoinPending = false;
      if (state.meta?.status === 'playing') addLog(`@${me.id}@ вернулся(-ась) в игру`, { type: 'presence', actor: me.id });
    }
    processLog();
    render();
  });
  setupPresence();
}

function setupPresence() {
  presenceUnsub?.();
  const onlineRef = R(`players/${me.id}/online`);
  let connectedBefore = false;
  presenceUnsub = onValue(ref(db, '.info/connected'), snap => {
    if (snap.val() !== true) return;
    onDisconnect(onlineRef).set(false).then(() => set(onlineRef, true)).catch(console.error);
    // заранее готовим запись в журнал «отключился» — сервер запишет её сам при обрыве связи
    const offRef = push(R('log'));
    onDisconnect(offRef).set({ t: serverTimestamp(), text: `${me.name || 'Игрок'} отключился(-ась)`, type: 'presence', actor: me.id }).catch(console.error);
    if (connectedBefore && state?.meta?.status === 'playing') addLog(`@${me.id}@ снова на связи`, { type: 'presence', actor: me.id });
    connectedBefore = true;
  });
}

function exitRoom(msg) {
  T.stop();
  roomUnsub?.(); presenceUnsub?.();
  roomUnsub = presenceUnsub = null;
  if (roomCode) onDisconnect(R('')).cancel().catch(() => {});
  seenLog = null;
  roomCode = null; state = null; ui.modal = null; ui.tab = 'me';
  content = null; contentKey = null;
  localStorage.removeItem(LS.room);
  history.replaceState(null, '', location.pathname + location.search);
  ui.error = msg || '';
  render();
}

async function leaveRoom() {
  if (!state) return exitRoom();
  if (state.meta.status === 'lobby') {
    const others = validPlayers().filter(([id]) => id !== me.id);
    if (isHost()) {
      if (!others.length) { const code = roomCode; exitRoom(); await remove(ref(db, 'rooms/' + code)); return; }
      await update(R(''), { 'meta/hostId': others[0][0], [`players/${me.id}`]: null });
    } else {
      await remove(R(`players/${me.id}`));
    }
    exitRoom();
  } else {
    addLog(`@${me.id}@ вышел(-ла) из игры`, { type: 'presence', actor: me.id });
    await set(R(`players/${me.id}/online`), false);
    exitRoom();
  }
}

// ---------------- Хост: старт / новая партия ----------------
async function startGame() {
  baseContent = baseContent || await loadContent();
  contentKey = null;
  syncContent();
  const s = { ...L.DEFAULT_SETTINGS, ...state.settings };
  const ids = validPlayers().filter(([id]) => s.hostPlays || id !== state.meta.hostId).map(([id]) => id);
  if (ids.length < 2) return toast('Нужно минимум 2 игрока', 'warn');
  if (ids.length < 4 && !(await ask(`Игроков всего ${ids.length}. Обычно играют от 6. Начать всё равно?`, 'Начать'))) return;
  const { cards, game } = L.newGame(ids, content, s, now());
  const upd = { cards, game, 'meta/status': 'playing', log: null };
  validPlayers().forEach(([id]) => { upd[`players/${id}/spectator`] = null; });
  await update(R(''), upd);
  addLog(game.event, {
    type: 'start', title: game.catastrophe.title, catText: game.catastrophe.text, duration: game.catastrophe.duration,
    size: game.bunker.size, slots: game.slots, feature: game.bunker.features[0] || '',
    condition: game.bunker.condition?.text || '', food: L.foodInfo(game).infinite ? -1 : L.foodInfo(game).months, need: game.catastrophe.months || 0,
  });
}

async function backToLobby() {
  if (!(await ask('Вернуться в лобби? Текущая партия будет сброшена.', 'Сбросить', { danger: true }))) return;
  await update(R(''), { game: null, cards: null, log: null, 'meta/status': 'lobby' });
}

// ---------------- Ход игры ----------------
async function doAdvance(expectedVersion) {
  if (advancing) return;
  advancing = true;
  try {
    const before = clone(state?.game);
    const res = await runTransaction(R('game'), g => {
      if (!g) return g;
      if ((g.version || 0) !== expectedVersion) return; // кто-то уже продвинул
      return L.advance(g, now());
    });
    if (res.committed) {
      const g = res.snapshot.val();
      if (g?.event) {
        const ex = g.phase === 'result' && g.lastResult?.exiled;
        const newRound = g.phase === 'speech' && g.turn === 0 && g.round > 1 && g.event === `Раунд ${g.round}`;
        const feat = newRound ? (g.bunker?.features || [])[(g.bunker?.shown || 0) - 1] : null;
        // авто-раскрытие по таймеру: карточка для каждой раскрытой характеристики
        if (before?.phase === 'speech') {
          const sp = (before.order || [])[before.turn || 0];
          const was = (before.revealed || {})[sp] || {};
          const now_ = (g.revealed || {})[sp] || {};
          for (const k of L.TRAIT_KEYS) {
            if (now_[k] && !was[k]) {
              const value = state.cards?.[sp]?.traits?.[k] || '';
              addLog(`@${sp}@ (время вышло) раскрыл(а) «${L.traitLabel(k)}»: ${value}`, { type: 'reveal', pid: sp, who: nameOf(sp), key: k, label: L.traitLabel(k), value, desc: cardDesc(sp, k), auto: true });
            }
          }
        }
        if (ex) { addLog(g.event, { type: 'exile', pid: ex, who: nameOf(ex) }); triggerExileCards(ex); }
        else if (feat && (g.bunker.shown || 0) > (before?.bunker?.shown || 0)) addLog(`Раунд ${g.round}. В бункере открыто: ${feat}`, { type: 'bunker', round: g.round, feature: feat });
        else if (!/время вышло/.test(g.event)) addLog(g.event, { type: 'game' });
      }
    }
  } catch (e) { console.error(e); } finally { advancing = false; }
}

async function forceEnd() {
  if (!(await ask('Завершить игру сейчас?', 'Завершить', { danger: true }))) return;
  const res = await runTransaction(R('game'), g => (g ? L.endGame(g) : g));
  if (res.committed) addLog('Хост завершил игру');
}

function amAdvancer() {
  if (!state?.game) return false;
  const host = state.players?.[state.meta.hostId];
  if (host?.online) return state.meta.hostId === me.id;
  const first = validPlayers().find(([, p]) => p.online);
  return !!first && first[0] === me.id;
}

function tick() {
  updateTimer();
  if (!state?.game || state.meta?.status !== 'playing' || advancing) return;
  const g = L.norm(clone(state.game));
  if (g.phase === 'end' || g.paused || !amAdvancer()) return;
  const expired = g.phaseEndsAt > 0 && now() >= g.phaseEndsAt;
  const votesDone = g.phase === 'vote' && L.allVoted(g);
  const sp = L.currentSpeaker(g);
  const speakerGone = g.phase === 'speech' && sp && !g.alive[sp];
  if (expired || votesDone || speakerGone) doAdvance(g.version);
}
setInterval(tick, 500);

let lastTick = '';
function updateTimer() {
  const el = document.getElementById('timer');
  if (!el || !state?.game) return;
  const g = state.game;
  let ms;
  if (g.paused) ms = g.paused;
  else if (g.phaseEndsAt) ms = Math.max(0, g.phaseEndsAt - now());
  else { el.textContent = ''; el.className = 'timer'; return; }
  const sec = Math.ceil(ms / 1000);
  el.textContent = `${g.paused ? '⏸ ' : ''}${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  el.className = 'timer' + (sec <= 10 && !g.paused ? ' low' : '');
  const tk = `${g.phaseEndsAt}:${sec}`;
  if (!g.paused && sec > 0 && sec <= 5 && tk !== lastTick) {
    lastTick = tk;
    const sp = g.phase === 'speech' ? L.currentSpeaker(L.norm(clone(g))) : null;
    S.play('tick', { mine: sp === me.id || (g.phase === 'vote' && !g.votes?.[me.id] && g.alive?.[me.id]) });
  }
}

// ---------------- Действия игрока ----------------
async function revealMine(key) {
  const g = L.norm(clone(state.game));
  if (!L.canReveal(g, me.id, key)) return;
  await update(R('game'), {
    [`revealed/${me.id}/${key}`]: true,
    [`revealedRound/${me.id}`]: increment(1),
  });
  const value = state.cards[me.id].traits[key];
  addLog(`@${me.id}@ раскрыл(а) «${L.traitLabel(key)}»: ${value}`, { type: 'reveal', pid: me.id, actor: me.id, who: me.name, key, label: L.traitLabel(key), value, desc: cardDesc(me.id, key) });
}

async function vote(target) {
  const g = L.norm(clone(state.game));
  if (g.phase !== 'vote' || !g.alive[me.id]) return;
  if (g.votes[me.id] === target) return;
  await set(R(`game/votes/${me.id}`), target);
  const what = target === 'abstain' ? 'воздерживается' : `голосует → @${target}@`;
  addLog(g.settings.voteSecret ? `@${me.id}@ проголосовал(а)` : `@${me.id}@ ${what}`, { type: 'vote', actor: me.id });
}

function targetsFor(effect, owner = me.id) {
  const e = E.normalizeEffect(effect);
  const g = L.norm(clone(state.game));
  const alive = L.aliveIds(g);
  switch (e.type) {
    case 'revive': return g.players.filter(p => !g.alive[p] && p !== owner);
    case 'reveal_target': return alive.filter(p => p !== owner && (e.key && e.key !== 'random' ? L.hiddenKeys(g, p).includes(e.key) : L.hiddenKeys(g, p).length > 0));
    case 'change': return alive; // можно выбрать и себя
    default: return alive.filter(p => p !== owner);
  }
}

// ---------- Составные действия ----------
function traitPartsOf(card, k) {
  const raw = String(card?.raw?.[k] ?? card?.traits?.[k] ?? '');
  const val = String(card?.traits?.[k] ?? '');
  if (!raw || raw === NONE) return { raw: [], val: [] };
  const r = raw.split(SEP), v = val.split(SEP);
  return r.length === v.length ? { raw: r, val: v } : { raw: [raw], val: [val] };
}
function gamePool(file, g) { return L.pool(content, file, g.settings).map(L.textOf); }
function sample(arr, n) { return L.shuffle(arr).slice(0, n); }
const featureFoodMonths = f => { const it = itemIn('bunkers', f) || {}; return it.foodInfinite ? 'inf' : +(it.foodMonths || 0); };

// Ключ характеристики для действия (случайный выбирается один раз)
function resolveKey(e) { return e.key && e.key !== 'random' ? e.key : L.pick(L.TRAIT_KEYS); }

// Варианты для выбора игроком (mode = pool_choice)
function choiceOptions(e, g, target, key) {
  const cards = state.cards || {};
  if (e.object === 'feature') {
    const F = g.bunker.features, shown = F.slice(0, g.bunker.shown);
    if (e.op === 'remove') return e.pool?.source === 'preset' ? shown.filter(f => e.pool.items.includes(f)) : shown;
    const fresh = x => !F.includes(x);
    return e.pool.source === 'preset' ? e.pool.items.filter(fresh) : sample(gamePool('bunkers', g).filter(fresh), e.pool.size);
  }
  const file = traitFile(key);
  const own = traitPartsOf(cards[target], key).raw;
  if (e.op === 'remove') return e.pool?.source === 'preset' ? own.filter(x => e.pool.items.includes(x)) : own;
  if (e.pool.source === 'preset') return e.pool.items.filter(x => !own.includes(x));
  return sample(gamePool(file, g).filter(x => !own.includes(x)), e.pool.size);
}

// Новое значение для добавления/замены
function pickNewValue(e, g, file, exclude, choice) {
  if (e.mode === 'fixed') return e.value;
  if (e.mode === 'pool_choice') return choice;
  let list;
  if (e.mode === 'pool_random' && e.pool.source === 'preset') list = e.pool.items.filter(Boolean);
  else list = gamePool(file, g);
  const fresh = list.filter(x => !exclude.has(x));
  return L.pick(fresh.length ? fresh : list);
}

function applyChange(e, g, ctx, upd) {
  const cards = state.cards || {};
  const owner = ctx.owner || me.id;
  const out = []; // фразы для журнала
  let popup = null;

  if (e.object === 'slots') {
    const n = e.op === 'add' ? g.slots + e.amount : e.op === 'remove' ? Math.max(1, g.slots - e.amount) : Math.max(1, e.amount);
    upd['game/slots'] = n;
    out.push(`мест в бункере теперь ${n}`);
    return { out, popup };
  }
  if (e.object === 'food' && e.infinite) {
    upd['game/bunker/foodInfinite'] = true;
    out.push('еды теперь бесконечно много');
    return { out, popup };
  }
  if (e.object === 'food') {
    const base = +g.bunker.food || 0;
    upd['game/bunker/food'] = e.op === 'add' ? base + e.amount : e.op === 'remove' ? base - e.amount : e.amount - (L.foodInfo(g).months - base);
    const after = L.foodInfo({ ...g, bunker: { ...g.bunker, food: upd['game/bunker/food'] } }).months;
    out.push(`еды теперь на ${L.monthsText(after)}`);
    return { out, popup };
  }
  if (e.object === 'feature') {
    const F = [...g.bunker.features];
    const FF = [...(g.bunker.featureFood || F.map(() => 0))];
    while (FF.length < F.length) FF.push(0);
    let S = g.bunker.shown || 0;
    if (e.op === 'remove') {
      let cand = F.slice(0, S).map((f, idx) => ({ f, idx }));
      if (e.mode === 'pool_random' && e.pool.source === 'preset') cand = cand.filter(c => e.pool.items.includes(c.f));
      if (e.mode === 'fixed') cand = cand.filter(c => c.f === e.value);
      const c = e.mode === 'pool_choice' ? cand.find(x => x.f === ctx.choice) : L.pick(cand);
      if (!c) { out.push('в бункере нечего убрать'); return { out, popup }; }
      F.splice(c.idx, 1); FF.splice(c.idx, 1); S--;
      out.push(`из бункера пропало: ${c.f}`);
    } else {
      const v = pickNewValue(e, g, 'bunkers', new Set(F), ctx.choice);
      if (!v) { out.push('ничего не изменилось'); return { out, popup }; }
      const shownIdx = [...Array(S).keys()];
      if (e.op === 'replace' && shownIdx.length) {
        const idx = L.pick(shownIdx);
        out.push(`в бункере «${F[idx]}» заменено на «${v}»`);
        F[idx] = v; FF[idx] = featureFoodMonths(v);
      } else {
        F.splice(S, 0, v); FF.splice(S, 0, featureFoodMonths(v)); S++;
        out.push(`в бункере появилось: ${v}`);
      }
      popup = { type: 'bunker', feature: v };
    }
    upd['game/bunker/features'] = F;
    upd['game/bunker/featureFood'] = FF;
    upd['game/bunker/shown'] = S;
    return { out, popup };
  }

  // Характеристика игрока
  const key = ctx.key || resolveKey(e);
  const file = traitFile(key);
  const label = L.traitLabel(key);
  const alive = L.aliveIds(g);
  let targets;
  if (e.target === 'self') targets = [owner];
  else if (e.target === 'player') targets = [ctx.target];
  else if (e.target === 'all') targets = alive;
  else { const others = alive.filter(p => p !== owner); targets = [L.pick(others.length ? others : alive)]; }
  const used = new Set(g.players.flatMap(p => traitPartsOf(cards[p], key).raw));

  for (const pid of targets.filter(Boolean)) {
    const card = cards[pid];
    if (!card) continue;
    const parts = traitPartsOf(card, key);
    const open = !!(g.revealed[pid] || {})[key];
    const show = v => (open ? ` — ${v}` : ' (значение скрыто)');
    const whose = pid === owner ? 'у себя' : `у @${pid}@`;
    if (e.op === 'remove') {
      let cand = parts.raw.map((r, idx) => ({ r, idx }));
      if ((e.mode === 'pool_random' || e.mode === 'pool_choice') && e.pool?.source === 'preset') cand = cand.filter(c => e.pool.items.includes(c.r));
      if (e.mode === 'fixed') cand = cand.filter(c => c.r === e.value);
      const c = e.mode === 'pool_choice' && ctx.choice !== undefined ? cand.find(x => x.r === ctx.choice) : L.pick(cand);
      if (!c) { out.push(`${whose} нечего убрать в «${label}»`); continue; }
      const removed = parts.val[c.idx];
      parts.raw.splice(c.idx, 1); parts.val.splice(c.idx, 1);
      out.push(`${whose} убрано из «${label}»${show(removed)}`);
    } else {
      const v = pickNewValue(e, g, file, new Set([...used, ...parts.raw]), ctx.choice);
      if (!v) continue;
      used.add(v);
      const val = L.formatTrait(key, v, card.age);
      if (e.op === 'add') { parts.raw.push(v); parts.val.push(val); out.push(`${whose} добавлено в «${label}»${show(val)}`); }
      else { parts.raw = [v]; parts.val = [val]; out.push(`${whose} заменена характеристика «${label}»${show(val)}`); }
    }
    upd[`cards/${pid}/raw/${key}`] = parts.raw.length ? parts.raw.join(SEP) : NONE;
    upd[`cards/${pid}/traits/${key}`] = parts.val.length ? parts.val.join(SEP) : NONE;
  }
  if (e.target === 'all' && out.length > 2) return { out: [`у всех изменена характеристика «${label}»`], popup };
  return { out, popup };
}

async function useAction(i, ctx = {}) {
  const c = content || await loadContent();
  content = c;
  const g = L.norm(clone(state.game));
  const cards = state.cards || {};
  const owner = ctx.owner || me.id, auto = !!ctx.auto;
  const ownerName = nameOf(owner);
  const fail = m => (auto ? null : toast(m, 'warn'));
  const a = cards[owner]?.actions?.[i];
  if (!a || a.used || g.phase === 'end') return;
  const when = a.when || 'alive';
  if (!auto && !g.alive[owner] && when !== 'any' && when !== 'exiled') return;
  const e = E.normalizeEffect(a.effect);
  const target = ctx.target;
  const key = !e.key || e.key === 'random' ? L.pick(L.TRAIT_KEYS) : e.key;
  const label = L.traitLabel(key);
  const upd = {};
  const prefix = auto ? `При изгнании @${owner}@ сработала карта «${a.title}»` : `@${owner}@ применил(а) карту «${a.title}»`;
  let msg = prefix;
  let revealExtra = null;

  const put = (pid, k, from) => {
    upd[`cards/${pid}/traits/${k}`] = from.traits[k];
    upd[`cards/${pid}/raw/${k}`] = from.raw?.[k] || from.traits[k];
    if (k === 'biology') upd[`cards/${pid}/age`] = from.age;
  };
  const alive = L.aliveIds(g);

  switch (e.type) {
    case 'change': {
      const r = applyChange(e, g, ctx, upd);
      msg += r.out.length ? `: ${r.out.join('; ')}` : '';
      if (r.popup) revealExtra = r.popup;
      break;
    }
    case 'swap':
      put(owner, key, cards[target]); put(target, key, cards[owner]);
      msg += `: обмен характеристикой «${label}» с @${target}@`; break;
    case 'shuffle_all': {
      const sh = L.shuffle(alive.map(p => cards[p]));
      alive.forEach((p, j) => put(p, key, sh[j]));
      msg += `: перемешана характеристика «${label}» у всех`; break;
    }
    case 'reveal_target': {
      const hid = L.hiddenKeys(g, target);
      let k = e.key && e.key !== 'random' ? e.key : null;
      if (!k || !hid.includes(k)) k = hid.length ? L.pick(hid) : null;
      if (!k) return fail('У этого игрока уже всё раскрыто', 'warn');
      upd[`game/revealed/${target}/${k}`] = true;
      msg += `: у @${target}@ раскрыто «${L.traitLabel(k)}» — ${cards[target].traits[k]}`;
      revealExtra = { type: 'reveal', pid: target, actor: owner, who: nameOf(target), key: k, label: L.traitLabel(k), value: cards[target].traits[k], desc: cardDesc(target, k) };
      break;
    }
    case 'immunity':
      upd[`game/effects/immune/${owner}`] = g.round; msg += ' — иммунитет в этом раунде'; break;
    case 'double_vote':
      upd[`game/effects/double/${owner}`] = g.round; msg += ' — двойной голос в этом раунде'; break;
    case 'cancel_vote':
      if (g.phase !== 'vote') return fail('Эту карту можно применить только во время голосования', 'warn');
      upd['game/effects/cancelVote'] = g.round; msg += ' — голосование будет сорвано'; break;
    case 'bunker_reveal':
      if (g.bunker.shown >= g.bunker.features.length) return fail('Все особенности бункера уже открыты', 'warn');
      upd['game/bunker/shown'] = increment(1);
      msg += `: в бункере открыто — ${g.bunker.features[g.bunker.shown]}`;
      revealExtra = { type: 'bunker', feature: g.bunker.features[g.bunker.shown], actor: owner };
      break;
    case 'revive':
      upd[`game/alive/${target}`] = true; msg += `: @${target}@ возвращается в игру`; break;
    default:
      return fail('Неизвестная карта действия', 'warn');
  }
  upd[`cards/${owner}/actions/${i}/used`] = true;
  await update(R(''), upd);
  let sub = fillNames(msg.slice(prefix.length)).replace(/^\s*(:|—|и)\s*/, '');
  sub = sub ? sub[0].toUpperCase() + sub.slice(1) : '';
  const fx = { kind: e.type === 'change' ? e.op : e.type };
  if (e.type === 'swap') Object.assign(fx, { a: ownerName, b: nameOf(target), pa: owner, pb: target, key, label });
  if (e.type === 'shuffle_all') Object.assign(fx, { key });
  if (target) fx.target = target;
  addLog(msg, { type: 'action', actor: owner, who: ownerName, title: a.title, sub, icon: actIcon(a), fx, ...(auto ? { auto: true } : {}),
    ...(revealExtra && revealExtra.label ? { label: revealExtra.label, value: revealExtra.value } : {}) });
}

// Карты, которые срабатывают сами при изгнании владельца (запускает тот, кто изгнал)
async function triggerExileCards(pid) {
  await new Promise(r => setTimeout(r, 500));
  const acts = state?.cards?.[pid]?.actions || [];
  for (let i = 0; i < acts.length; i++) {
    const a = state?.cards?.[pid]?.actions?.[i];
    if (!a || a.used || a.when !== 'auto' || !state?.game) continue;
    const g = L.norm(clone(state.game));
    if (g.phase === 'end' || g.alive[pid]) return;
    const e = E.normalizeEffect(a.effect);
    if (e.type === 'cancel_vote' || e.type === 'immunity' || e.type === 'double_vote') continue;
    const ctx = { owner: pid, auto: true };
    if (E.needsPlayer(e)) { const t = targetsFor(e, pid); if (!t.length) continue; ctx.target = L.pick(t); }
    if (E.needsChoice(e)) {
      const key = e.object === 'trait' ? resolveKey(e) : undefined;
      const opts = choiceOptions(e, g, ctx.target ?? pid, key);
      if (!opts.length) continue;
      ctx.key = key; ctx.choice = L.pick(opts);
    }
    try { await useAction(i, ctx); } catch (err) { console.error(err); }
    await new Promise(r => setTimeout(r, 300));
  }
}

// Запуск карты: выбор игрока → выбор варианта → подтверждение
async function startAction(i) {
  const act = state.cards[me.id].actions[i];
  const g = L.norm(clone(state.game));
  const why = actionBlockReason(act, g);
  if (why) return toast(why, 'warn');
  const e = E.normalizeEffect(act.effect);
  if (E.needsPlayer(e)) { ui.modal = { i, step: 'target' }; render(); return; }
  if (E.needsChoice(e) && !(e.op === 'remove' && e.target !== 'self' && e.object === 'trait')) return openChoice(i, undefined);
  if (await dialog({ html: actionCardHtml(act), ok: 'Применить', cls: 'act-dlg' })) await useAction(i);
}
function openChoice(i, target) {
  const act = state.cards[me.id].actions[i];
  const g = L.norm(clone(state.game));
  const e = E.normalizeEffect(act.effect);
  const key = e.object === 'trait' ? resolveKey(e) : undefined;
  const tgt = target ?? me.id;
  const options = choiceOptions(e, g, tgt, key);
  if (!options.length) { ui.modal = null; render(); return toast(e.op === 'remove' ? 'Убирать нечего' : 'Не из чего выбрать', 'warn'); }
  ui.modal = { i, step: 'choice', target, key, options };
  render();
}

// ---------------- Админка ----------------
async function adminPause() {
  const g = state.game;
  if (g.paused || !g.phaseEndsAt) return;
  await update(R('game'), { paused: Math.max(1000, g.phaseEndsAt - now()) });
}
async function adminResume() {
  const g = state.game;
  if (!g.paused) return;
  await update(R('game'), { phaseEndsAt: now() + g.paused, paused: 0 });
}
async function adminAddTime() {
  const g = state.game;
  if (g.paused) await update(R('game'), { paused: g.paused + 30000 });
  else if (g.phaseEndsAt) await update(R('game'), { phaseEndsAt: Math.max(g.phaseEndsAt, now()) + 30000 });
  else await update(R('game'), { phaseEndsAt: now() + 30000 });
}
async function adminSetAlive(pid, alive) {
  await set(R(`game/alive/${pid}`), alive);
  addLog(alive ? `Хост вернул в игру @${pid}@` : `Хост исключил @${pid}@`, alive ? {} : { type: 'exile', pid, who: nameOf(pid) });
  if (!alive) triggerExileCards(pid);
}
async function adminReveal(pid) {
  const key = document.getElementById('adm-key-' + pid)?.value;
  if (!key) return;
  await set(R(`game/revealed/${pid}/${key}`), true);
  const value = state.cards[pid].traits[key];
  addLog(`Хост раскрыл у @${pid}@ «${L.traitLabel(key)}»: ${value}`, { type: 'reveal', pid, actor: me.id, who: nameOf(pid), key, label: L.traitLabel(key), value, desc: cardDesc(pid, key) });
}
async function adminReroll(pid) {
  const key = document.getElementById('adm-key-' + pid)?.value;
  if (!key) return;
  const c = content || await loadContent();
  const s = L.norm(clone(state.game)).settings;
  const card = state.cards[pid];
  let age = card.age;
  const upd = {};
  if (key === 'biology') { age = L.makeAge(s); upd[`cards/${pid}/age`] = age; }
  const used = new Set(Object.values(state.cards).map(cd => cd.raw?.[key]).filter(Boolean));
  const t = L.makeTrait(key, c, s, age, used);
  upd[`cards/${pid}/traits/${key}`] = t.value;
  upd[`cards/${pid}/raw/${key}`] = t.raw;
  await update(R(''), upd);
  addLog(`Хост заменил у @${pid}@ характеристику «${L.traitLabel(key)}»`);
}
async function makeHost(pid) {
  if (!(await ask(`Передать права хоста игроку ${nameOf(pid)}?`, 'Передать'))) return;
  await set(R('meta/hostId'), pid);
  ui.tab = 'me';
}

// ---------------- Настройки ----------------
const FIELDS = [
  { k: 'hostPlays', t: 'check', l: 'Хост тоже играет' },
  { k: 'firstSpeaker', t: 'player', l: 'Первым говорит' },
  { k: 'slots', t: 'num', l: 'Мест в бункере (0 — авто: половина)', min: 0, max: 30 },
  { k: 'ageMin', t: 'num', l: 'Возраст от', min: 1, max: 120 },
  { k: 'ageMax', t: 'num', l: 'Возраст до', min: 1, max: 120 },
  { k: 'darkHumor', t: 'check', l: 'Чёрный юмор в карточках' },
  { k: 'forceProfession', t: 'check', l: 'В 1-м раунде первой раскрывается профессия' },
  { k: 'firstRoundReveals', t: 'num', l: 'Раскрытий в 1-м раунде', min: 0, max: 8 },
  { k: 'revealsPerRound', t: 'num', l: 'Раскрытий в следующих раундах', min: 0, max: 8 },
  { k: 'voteStartRound', t: 'num', l: 'Голосование начиная с раунда', min: 1, max: 10 },
  { k: 'voteSecret', t: 'check', l: 'Тайное голосование' },
  { k: 'tieRule', t: 'select', l: 'При ничьей', opts: { revote: 'Переголосование', random: 'Жребий', none: 'Никто не изгнан' } },
  { k: 'exiledRevealsAll', t: 'check', l: 'Изгнанный раскрывает все карты' },
  { k: 'actionCards', t: 'check', l: 'Карты действий' },
  { k: 'showMarkers', t: 'check', l: 'Показывать метки нужд и проблем на карточках (иначе — только в финале)' },
  { k: 'finalMode', t: 'select', l: 'Финал', opts: { full: 'История + итог (выжили или нет и почему)', story: 'Только история' } },
  { k: 'finalFates', t: 'check', l: 'Финал: судьба каждого выжившего' },
  { k: 'finalExiled', t: 'check', l: 'Финал: учитывать изгнанных' },
  { k: 'actionsPerPlayer', t: 'num', l: 'Карт действий на игрока', min: 0, max: 5 },
  { k: 'bunkerFeatures', t: 'num', l: 'Особенностей бункера', min: 1, max: 10 },
  { k: 'speechTime', t: 'num', l: 'Речь игрока, сек (0 — без таймера)', min: 0, max: 900 },
  { k: 'discussionTime', t: 'num', l: 'Обсуждение, сек', min: 0, max: 1800 },
  { k: 'voteTime', t: 'num', l: 'Голосование, сек', min: 0, max: 600 },
  { k: 'resultTime', t: 'num', l: 'Показ итога, сек', min: 0, max: 120 },
  { k: 'narration', t: 'select', l: 'Кто зачитывает катастрофу, бункер и новые особенности', opts: { host: 'Телефон хоста (все в одной комнате)', all: 'Каждое устройство (игра по видеосвязи)', off: 'Никто' } },
  { k: 'narrateFinal', t: 'check', l: 'Зачитывать историю в финале' },
];

// Разделы настроек лобби (сворачиваются)
const secs = n => n ? `${n} с` : 'без таймера';
const SECTIONS = [
  { id: 'people', icon: '👥', title: 'Игроки и бункер', keys: ['hostPlays', 'firstSpeaker', 'slots', 'bunkerFeatures', 'ageMin', 'ageMax'],
    sum: s => `${s.hostPlays ? 'хост играет' : 'хост только ведёт'} · мест: ${s.slots || 'авто'} · возраст ${s.ageMin}–${s.ageMax}` },
  { id: 'reveal', icon: '🃏', title: 'Раскрытие характеристик', keys: ['forceProfession', 'firstRoundReveals', 'revealsPerRound', 'exiledRevealsAll'],
    sum: s => `в 1-м раунде: ${s.firstRoundReveals}, дальше: ${s.revealsPerRound}${s.forceProfession ? ' · сначала профессия' : ''}` },
  { id: 'vote', icon: '🗳️', title: 'Голосование', keys: ['voteStartRound', 'voteSecret', 'tieRule'],
    sum: s => `с ${s.voteStartRound}-го раунда · ${s.voteSecret ? 'тайное' : 'открытое'} · ничья: ${({ revote: 'переголосование', random: 'жребий', none: 'никого' })[s.tieRule] || s.tieRule}` },
  { id: 'cards', icon: '🎴', title: 'Карточки и карты действий', keys: ['darkHumor', 'actionCards', 'actionsPerPlayer', 'showMarkers'],
    sum: s => `${s.actionCards ? `карт действий: ${s.actionsPerPlayer}` : 'без карт действий'} · ${s.darkHumor ? 'с чёрным юмором' : 'без чёрного юмора'}` },
  { id: 'timers', icon: '⏱️', title: 'Таймеры', keys: ['speechTime', 'discussionTime', 'voteTime', 'resultTime'],
    sum: s => `речь ${secs(s.speechTime)} · обсуждение ${secs(s.discussionTime)} · голосование ${secs(s.voteTime)}` },
  { id: 'voice', icon: '🔊', title: 'Озвучка', keys: ['narration', 'narrateFinal'],
    sum: s => `${({ host: 'читает хост', all: 'читают все', off: 'выключена' })[s.narration] || 'читает хост'}${s.narration !== 'off' && s.narrateFinal ? ' · финал тоже' : ''}` },
  { id: 'final', icon: '🏁', title: 'Финал', keys: ['finalMode', 'finalFates', 'finalExiled'],
    sum: s => `${s.finalMode === 'story' ? 'только история' : 'история + итог'}${s.finalFates ? ' · судьбы' : ''}${s.finalExiled ? ' · изгнанные' : ''}` },
];
const openSecs = new Set((() => { try { return JSON.parse(localStorage.getItem('bunker.openSecs') || '[]'); } catch { return []; } })());
function toggleSec(id) {
  openSecs.has(id) ? openSecs.delete(id) : openSecs.add(id);
  try { localStorage.setItem('bunker.openSecs', JSON.stringify([...openSecs])); } catch {}
  render();
}
function settingsHtml(s, host) {
  const byKey = Object.fromEntries(FIELDS.map(f => [f.k, f]));
  const rest = FIELDS.filter(f => !SECTIONS.some(x => x.keys.includes(f.k)));
  const secList = rest.length ? [...SECTIONS, { id: 'other', icon: '⚙️', title: 'Прочее', keys: rest.map(f => f.k), sum: () => '' }] : SECTIONS;
  return `<div class="secs">${secList.map(sec => {
    const open = openSecs.has(sec.id);
    const fields = sec.keys.map(k => byKey[k]).filter(Boolean);
    const body = host
      ? `<div class="sec-body fields">${fields.map(f => settingInput(f, s[f.k], s)).join('')}</div>`
      : `<ul class="sec-body summary">${fields.map(f => `<li><span>${f.l}</span><b>${esc(settingValueText(f, s[f.k]))}</b></li>`).join('')}</ul>`;
    return `<section class="sec ${open ? 'open' : ''}">
      <button class="sec-head" data-a="sec" data-sec="${sec.id}" aria-expanded="${open}">
        <span class="sec-ico">${sec.icon}</span>
        <span class="sec-t"><b>${sec.title}</b><span class="sec-sum">${esc(sec.sum(s))}</span></span>
        <span class="sec-arr">▾</span>
      </button>
      ${open ? body : ''}
    </section>`;
  }).join('')}</div>`;
}

async function changeSetting(el) {
  const f = FIELDS.find(x => x.k === el.dataset.set);
  if (!f || !isHost()) return;
  let v;
  if (f.t === 'check') v = el.checked;
  else if (f.t === 'num') {
    v = Math.round(Number(el.value));
    if (!Number.isFinite(v)) v = L.DEFAULT_SETTINGS[f.k];
    v = Math.min(f.max, Math.max(f.min, v));
  } else v = el.value;
  await set(R(`settings/${f.k}`), v);
}

// ---------------- Рендер ----------------
// Перерисовка без лишних перестроений DOM и с сохранением выбранных значений в полях
let lastHTML = '';
function setHTML(html) {
  if (html === lastHTML) return;
  const keep = {};
  $app.querySelectorAll('select[id], input[id]').forEach(el => { keep[el.id] = el.value; });
  const active = document.activeElement?.id;
  lastHTML = html;
  $app.innerHTML = html;
  for (const [id, v] of Object.entries(keep)) {
    const el = document.getElementById(id);
    if (el && el.tagName === 'SELECT' && [...el.options].some(o => o.value === v)) el.value = v;
    else if (el && el.tagName === 'INPUT' && el.type !== 'number' && el.type !== 'checkbox') el.value = v;
  }
  if (active) document.getElementById(active)?.focus();
}
function render() {
  if (drag) { drag.pending = true; return; }
  try {
    if (!state) renderHome();
    else if (state.meta?.status === 'lobby') renderLobby();
    else if (state.game?.phase === 'end') renderEnd();
    else if (state.game) renderGame();
    else renderLobby();
  } catch (e) {
    console.error(e);
    setHTML(`<div class="wrap"><div class="err">Ошибка отображения: ${esc(e.message)}</div></div>`);
  }
  updateTimer();
}

function renderHome() {
  setHTML(`
  <button class="gear home-gear" data-a="prefs" title="Настройки">⚙️</button>
  <div class="wrap home">
    <h1 class="logo">БункИИр</h1>
    <p class="muted">Кто достоин выжить после конца света?</p>
    ${ui.error ? `<div class="err">${esc(ui.error)}</div>` : ''}
    <label class="field">Ваше имя<input id="name" maxlength="20" autocomplete="nickname" value="${esc(me.name)}"></label>
    <label class="field">Код лобби<input id="code" maxlength="4" autocapitalize="characters" autocomplete="off" value="${esc(ui.prefill)}" placeholder="ABCD"></label>
    <button class="btn primary" data-a="join">Войти в лобби</button>
    <div class="or">или</div>
    <button class="btn ghost" data-a="create">Создать своё лобби</button>
    <a class="home-link" href="editor.html">✏️ Редактор карточек, катастроф и бункера</a>
  </div>`);
}

function packHtml(host) {
  const c = state.content;
  let info;
  if (c && c.files) {
    const parts = CONTENT_FILES.map(f => [f, (toArray(c.files[f]) || []).length]).filter(([, n]) => n);
    info = `<div class="pack-title">📦 Свой набор${c.name ? ` — ${esc(c.name)}` : ''}</div>
      <div class="muted small">${c.mode === 'merge' ? 'Добавлен к стандартным карточкам' : 'Заменяет стандартные карточки в этих разделах (остальные — стандартные)'}:</div>
      <div class="pack-parts">${parts.map(([f, n]) => `<span>${esc(FILE_LABELS[f] || f)}: <b>${n}</b></span>`).join('')}</div>`;
  } else {
    info = '<div class="pack-title">Стандартный набор</div><div class="muted small">Карточки, катастрофы и карты действий с сайта.</div>';
  }
  const tools = host ? `<div class="pack-tools">
      <label class="btn small">${c ? 'Загрузить другой' : 'Загрузить свой набор'}<input type="file" id="pack-file" accept=".zip,.json,application/zip,application/json" multiple hidden></label>
      ${c ? `<select id="pack-mode"><option value="replace" ${c.mode !== 'merge' ? 'selected' : ''}>Заменить стандартные</option><option value="merge" ${c.mode === 'merge' ? 'selected' : ''}>Добавить к стандартным</option></select>
        <button class="btn small ghost" data-a="packClear">Вернуть стандартный</button>` : ''}
    </div>
    <div class="muted small">Архив из <a href="editor.html" target="_blank" rel="noopener">редактора</a> или отдельные .json-файлы. Набор действует только в этом лобби.</div>` : '';
  return `<div class="pack ${c ? 'custom' : ''}">${info}${tools}</div>`;
}

async function uploadPack(fileListLive) {
  const list = [...fileListLive];
  if (!isHost() || !list.length) return;
  const { files, skipped } = await parseUpload(list);
  const names = Object.keys(files);
  if (!names.length) return toast('В файлах не нашлось подходящих карточек' + (skipped.length ? ` (пропущено: ${skipped.slice(0, 3).join(', ')})` : ''), 'warn');
  // .zip — новый набор целиком; отдельные .json дополняют уже загруженный набор
  const onlyJson = list.every(f => /\.json$/i.test(f.name));
  const prev = state.content;
  const merged = onlyJson && prev?.files ? { ...prev.files, ...files } : files;
  const size = JSON.stringify(merged).length;
  if (size > 900000) return toast('Набор слишком большой (больше ~900 КБ)', 'warn');
  const name = onlyJson && prev?.files ? (prev.name || 'Свой набор')
    : list.length === 1 ? list[0].name.replace(/\.(zip|json)$/i, '') : 'Свой набор';
  await set(R('content'), { name, mode: prev?.mode || 'replace', at: now(), by: me.id, files: merged });
  toast(`${onlyJson && prev?.files ? 'Добавлено в набор' : 'Набор загружен'}: ${names.map(f => FILE_LABELS[f] || f).join(', ')}`);
}

function lobbyRows(ps, s, host) {
  let n = 0;
  return ps.map(([id, p]) => {
    const plays = s.hostPlays || id !== state.meta.hostId;
    return `
        <li data-pid="${id}">
          ${host ? '<span class="grip" aria-label="Перетащить">⠿</span>' : ''}
          <span class="seat">${plays ? ++n : '–'}</span>
          <span class="dot ${p.online ? 'on' : ''}"></span>
          <span class="pname">${esc(p.name)}${id === me.id ? ' <span class="muted">(вы)</span>' : ''}</span>
          ${id === state.meta.hostId ? `<span class="tag">${plays ? 'хост' : 'хост, не играет'}</span>` : ''}
          ${host && id !== me.id ? `<button class="link" data-a="kickLobby" data-pid="${id}">убрать</button>` : ''}
        </li>`;
  }).join('');
}

function lobbyPlayers(s) {
  return validPlayers().filter(([id]) => s.hostPlays || id !== state.meta.hostId);
}

function settingValueText(f, v) {
  if (f.t === 'check') return v ? 'да' : 'нет';
  if (f.t === 'player') return v && v !== 'random' && state.players?.[v]?.name ? nameOf(v) : 'случайно';
  if (f.t === 'select') return f.opts[v] || v;
  return v;
}

function renderLobby() {
  const s = { ...L.DEFAULT_SETTINGS, ...state.settings };
  const ps = validPlayers();
  const playing = ps.filter(([id]) => s.hostPlays || id !== state.meta.hostId).length;
  const autoSlots = L.defaultSlots(playing);
  const host = isHost();
  setHTML(`
  <div class="wrap">
    <div class="lobby-head">
      <div><div class="muted small">Код лобби</div><div class="code">${esc(roomCode)}</div></div>
      <div class="lobby-tools"><button class="btn small" data-a="copy">Ссылка</button><button class="gear" data-a="prefs" title="Настройки">⚙️</button></div>
    </div>
    <h2>Игроки · ${ps.length}</h2>
    <p class="muted small">Ходят по кругу сверху вниз.${host ? ' Перетаскивайте игроков за ⠿, чтобы поменять порядок.' : ''}</p>
    <ul class="plist ${host ? 'sortable' : ''}" id="seat-list">
      ${lobbyRows(ps, s, host)}
    </ul>
    <h2>Набор карточек</h2>
    ${packHtml(host)}
    <h2>Настройки</h2>
    <p class="muted small">Играют: ${playing}. Мест в бункере: ${s.slots > 0 ? Math.min(s.slots, Math.max(1, playing - 1)) : autoSlots}${s.slots > 0 ? '' : ' (авто)'}</p>
    ${settingsHtml(s, host)}
    <div class="actions-row">
      ${host ? '<button class="btn primary" data-a="start">Начать игру</button>' : '<p class="muted center">Ждём, пока хост начнёт игру…</p>'}
      <button class="btn ghost" data-a="leave">Выйти из лобби</button>
    </div>
  </div>`);
}

function settingInput(f, v, s) {
  if (f.t === 'player') {
    const ps = lobbyPlayers(s);
    const cur = ps.some(([id]) => id === v) ? v : 'random';
    return `<label class="field">${f.l}<select data-set="${f.k}">
      <option value="random" ${cur === 'random' ? 'selected' : ''}>Случайно</option>
      ${ps.map(([id, p]) => `<option value="${id}" ${cur === id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    </select></label>`;
  }
  if (f.t === 'check') return `<label class="row-check"><input type="checkbox" data-set="${f.k}" ${v ? 'checked' : ''}><span>${f.l}</span></label>`;
  if (f.t === 'select') return `<label class="field">${f.l}<select data-set="${f.k}">${Object.entries(f.opts).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  return `<label class="field">${f.l}<input type="number" inputmode="numeric" data-set="${f.k}" min="${f.min}" max="${f.max}" value="${esc(v)}"></label>`;
}

function phaseBanner(g) {
  const s = g.settings;
  const host = isHost();
  const nextBtn = host ? '<button class="btn small ghost" data-a="next">Далее ▸</button>' : '';
  let body = '';
  if (g.phase === 'speech') {
    const sp = L.currentSpeaker(g);
    const left = sp ? L.revealsLeft(g, sp) : 0;
    body = `<div>Говорит: <b>${esc(nameOf(sp))}</b> <span class="muted small">(${g.turn + 1}/${g.order.length})</span></div>`;
    if (sp === me.id) {
      body += `<div class="hint">${left > 0 ? `Раскройте ещё ${left} ${L.plural(left, 'характеристику', 'характеристики', 'характеристик')} во вкладке «Моя карта» и расскажите, почему вы нужны в бункере.` : 'Расскажите, почему вы нужны в бункере.'}</div>
        <button class="btn primary small" data-a="done">Закончить речь</button>`;
    }
  } else if (g.phase === 'discussion') {
    body = `<div><b>Общее обсуждение.</b> ${L.needsVote(g) ? 'Дальше — голосование.' : 'В этом раунде голосования не будет.'}</div>`;
  } else if (g.phase === 'vote') {
    const voters = L.aliveIds(g);
    const n = voters.filter(p => g.votes[p]).length;
    body = `<div><b>Голосование</b> ${g.candidates ? '<span class="tag warn">переголосование</span>' : ''} <span class="muted small">проголосовали ${n}/${voters.length}</span></div>`;
    if (g.alive[me.id]) {
      const mine = g.votes[me.id];
      body += `<div class="vote-grid">${L.voteTargets(g, me.id).map(p => `<button class="btn small ${mine === p ? 'primary' : ''}" data-a="vote" data-pid="${p}">${esc(nameOf(p))}</button>`).join('')}
        <button class="btn small ghost ${mine === 'abstain' ? 'primary' : ''}" data-a="vote" data-pid="abstain">Воздержаться</button></div>`;
    }
  } else if (g.phase === 'result') {
    const r = g.lastResult || {};
    const counts = Object.entries(r.counts || {}).sort((a, b) => b[1] - a[1]);
    body = `<div>${r.exiled ? `Изгнан(а): <b>${esc(nameOf(r.exiled))}</b>` : '<b>Изгнания нет</b>'}${r.note ? ` <span class="muted small">— ${esc(r.note)}</span>` : ''}</div>
      ${counts.length ? `<div class="muted small">${counts.map(([p, c]) => `${esc(nameOf(p))}: ${c}`).join(' · ')}</div>` : ''}`;
    if (!s.voteSecret) {
      const lines = Object.entries(g.votes).filter(([, t]) => t).map(([v, t]) => `${esc(nameOf(v))} → ${t === 'abstain' ? 'воздержался' : esc(nameOf(t))}`);
      if (lines.length) body += `<details class="small"><summary>Кто за кого</summary>${lines.join('<br>')}</details>`;
    }
  }
  const myTurn = g.phase === 'speech' && L.currentSpeaker(g) === me.id;
  return `<div class="banner ${myTurn ? 'my-turn' : ''}">${body}<div class="banner-tools">${nextBtn}</div></div>`;
}

function traitRows(pid, g, { mine = false } = {}) {
  const card = state.cards?.[pid];
  if (!card) return '';
  const rev = g.revealed[pid] || {};
  const tiles = L.TRAITS.map(t => {
    const id = `${pid}:${t.key}`;
    const waiting = !!rev[t.key] && isPending(id);
    const open = !!rev[t.key] && !waiting;
    if (!mine && !open && !waiting) return '';
    const m = TMETA[t.key] || {};
    if (waiting && !mine) return `<div class="tcard closed face-down" style="--tc:${m.color}"><span class="tc-ico">${m.icon}</span><div class="tc-body"><div class="tc-label">${t.label}</div><div class="tc-val">Раскрывается…</div></div></div>`;
    const desc = cardDesc(pid, t.key);
    const ft = showMarkers(g) ? markerChips(rawParts(pid, t.key).map(r => itemIn(t.file, r)), L.foodInfo(g).status === 'short') : '';
    const btn = mine && !open && !waiting && L.canReveal(g, pid, t.key) ? `<button class="btn small tc-btn" data-a="reveal" data-key="${t.key}">Раскрыть</button>` : '';
    const chip = mine ? (open ? '<span class="tc-chip on" title="Открыто всем">👁</span>' : '<span class="tc-chip" title="Видите только вы">🔒</span>') : '';
    return `<div class="tcard ${open ? 'open' : 'closed'} ${freshCls(id)}" style="--tc:${m.color}">
      <span class="tc-ico">${m.icon}</span>
      <div class="tc-body">
        <div class="tc-label">${t.label}</div>${ft ? `<div class="tc-marks">${ft}</div>` : ''}
        <div class="tc-val">${esc(card.traits[t.key])}</div>
        ${desc ? `<div class="tc-desc">${esc(desc)}</div>` : ''}
      </div>
      ${btn || chip ? `<div class="tc-side">${btn || chip}</div>` : ''}
    </div>`;
  }).join('');
  const hint = mine ? '<div class="tgrid-hint">🔒 видите только вы · 👁 открыто всем</div>' : '';
  return tiles ? `${hint}<div class="tgrid ${mine ? 'mine' : ''}">${tiles}</div>` : '';
}

function renderGame() {
  const g = L.norm(clone(state.game));
  const turnKey = g.phase === 'speech' && L.currentSpeaker(g) === me.id ? `${roomCode}:${g.round}:${g.turn}` : '';
  if (turnKey && turnKey !== ui.turnKey) S.play('turn', { mine: true });
  ui.turnKey = turnKey;
  const playing = g.players.includes(me.id);
  const host = isHost();
  const tabs = [['me', 'Карта'], ['players', 'Игроки'], ['bunker', 'Бункер'], ['log', 'Журнал']];
  if (host) tabs.push(['admin', 'Хост']);
  if (!tabs.some(t => t[0] === ui.tab)) ui.tab = 'me';
  const logEntries = Object.values(state.log || {});
  if (ui.tab === 'log') ui.logSeenAt = Math.max(ui.logSeenAt || 0, ...logEntries.map(e => e.t || 0));
  const unread = logEntries.filter(e => (e.t || 0) > (ui.logSeenAt || 0) && e.actor !== me.id).length;

  let body = '';
  if (ui.tab === 'me') body = tabMe(g, playing);
  else if (ui.tab === 'players') body = tabPlayers(g);
  else if (ui.tab === 'bunker') body = tabBunker(g);
  else if (ui.tab === 'log') body = tabLog();
  else if (ui.tab === 'admin') body = tabAdmin(g);

  setHTML(`
  <div class="topbar">
    <div><b>Раунд ${g.round}</b> · ${L.PHASE_NAMES[g.phase] || g.phase}<div class="muted small">Мест: ${g.slots} · в игре: ${L.aliveIds(g).length}${L.foodInfo(g).has ? ` · 🍖 ${L.monthsText(L.foodInfo(g).months, true)}` : ''} · код ${esc(roomCode)}</div></div>
    <div class="topbar-right"><div id="timer" class="timer"></div><button class="gear" data-a="prefs" title="Настройки">⚙️</button></div>
  </div>
  <div class="wrap game">
    ${phaseBanner(g)}
    <nav class="tabs">${tabs.map(([k, l]) => `<button class="${ui.tab === k ? 'active' : ''}" data-a="tab" data-tab="${k}">${l}${k === 'log' && unread ? `<span class="badge">${unread > 99 ? '99+' : unread}</span>` : ''}</button>`).join('')}</nav>
    <section>${body}</section>
  </div>
  ${renderModal(g)}`);
}

function tabMe(g, playing) {
  if (!playing) return `<p class="muted">Вы наблюдаете за игрой — карт у вас нет.</p><button class="btn ghost" data-a="leave">Выйти</button>`;
  const alive = g.alive[me.id];
  const card = state.cards?.[me.id];
  const acts = card?.actions || [];
  return `
    ${alive ? '' : '<div class="err">Вы изгнаны из бункера. Можно наблюдать и обсуждать.</div>'}
    ${g.effects.immune[me.id] === g.round ? '<div class="tag ok">Иммунитет в этом раунде</div>' : ''}
    ${g.effects.double[me.id] === g.round ? '<div class="tag ok">Двойной голос в этом раунде</div>' : ''}
    ${traitRows(me.id, g, { mine: true })}
    ${acts.length ? `<h3>Карты действий</h3>
      <div class="acts">${acts.map((a, i) => `
        <div class="act ${a.used ? 'used' : ''}">
          <span class="act-ico">${actIcon(a)}</span>
          <div class="act-body"><div class="act-kind">Карта действия${E.whenTag(a.when) ? ` · ${E.whenTag(a.when)}` : ''}</div><b>${esc(a.title)}</b><div class="act-text">${esc(a.text || E.describeEffect(a.effect))}</div></div>
          <div class="act-side">${a.used ? '<span class="tag">использована</span>' : actionControl(a, i, g)}</div>
        </div>`).join('')}</div>` : ''}
    <button class="btn ghost" data-a="leave">Выйти (можно вернуться)</button>`;
}

// Почему карту нельзя применить прямо сейчас ('' — можно)
function actionBlockReason(a, g) {
  const e = a.effect || {};
  if (g.phase === 'end') return 'Игра окончена';
  const when = a.when || 'alive', dead = !g.alive[me.id];
  if (when === 'auto') return dead ? 'Не смогла сработать' : 'Сработает сама, если вас изгонят';
  if (dead && when === 'alive') return 'После изгнания эту карту не сыграть';
  if (!dead && when === 'exiled') return 'Можно сыграть только после изгнания';
  if (dead && (e.type === 'immunity' || e.type === 'double_vote')) return 'После изгнания бесполезна';
  switch (e.type) {
    case 'cancel_vote':
      if (g.phase !== 'vote') return 'Доступна во время голосования';
      if (g.effects.cancelVote === g.round) return 'Голосование уже сорвано';
      return '';
    case 'double_vote':
      if (g.effects.double[me.id] === g.round) return 'Уже действует в этом раунде';
      if (g.phase === 'result' || !L.needsVote(g)) return 'В этом раунде нет голосования';
      return '';
    case 'immunity':
      if (g.effects.immune[me.id] === g.round) return 'Уже действует в этом раунде';
      if (g.phase === 'result' || !L.needsVote(g)) return 'В этом раунде нет голосования';
      return '';
    case 'bunker_reveal':
      return g.bunker.shown >= g.bunker.features.length ? 'Все особенности бункера открыты' : '';
    case 'revive':
      return targetsFor(e).length ? '' : 'Изгнанных пока нет';
    case 'reveal_target': {
      const ok = targetsFor(e).some(p => {
        const hid = L.hiddenKeys(g, p);
        return e.key && e.key !== 'random' ? hid.includes(e.key) : hid.length > 0;
      });
      return ok ? '' : 'Раскрывать нечего';
    }
    case 'change': {
      const n = E.normalizeEffect(e);
      if (n.object === 'slots' && n.op === 'remove' && g.slots <= 1) return 'Меньше мест быть не может';
      if (n.object === 'food' && n.op === 'remove' && L.foodInfo(g).months <= 0) return 'Еды и так нет';
      if (n.object === 'feature' && n.op === 'remove' && !(g.bunker.shown > 0)) return 'В бункере пока нечего убирать';
      if (n.object === 'trait' && n.op === 'remove' && n.target === 'self' && n.key !== 'random' && !rawParts(me.id, n.key).length) return 'Нечего убирать';
      return '';
    }
    default:
      if (E.needsPlayer(e) && !targetsFor(e).length) return 'Нет подходящих игроков';
      return '';
  }
}

function actIcon(a) {
  if (a.icon) return a.icon;
  const found = (content?.actions || []).find(x => x.id === a.id);
  return (found && found.icon) || '🃏';
}
function actionCardHtml(a) {
  return `<div class="act-hero"><div class="act-hero-ico">${actIcon(a)}</div><div class="act-kind">Карта действия${E.whenTag(a.when) ? ` · ${E.whenTag(a.when)}` : ''}</div><div class="act-hero-title">${esc(a.title)}</div><div class="act-text">${esc(a.text || E.describeEffect(a.effect))}</div></div>`;
}

function actionControl(a, i, g) {
  const reason = actionBlockReason(a, g);
  return reason
    ? `<span class="act-wait">${esc(reason)}</span>`
    : `<button class="btn small" data-a="act" data-i="${i}">Применить</button>`;
}

function tabPlayers(g) {
  const s = g.settings;
  return `<div class="players">${g.players.map(p => {
    const pl = state.players?.[p] || {};
    const alive = g.alive[p] || isPending(p);
    const hidden = L.hiddenKeys(g, p).length;
    const voted = g.phase === 'vote' && g.votes[p];
    const voteInfo = g.phase === 'vote' && voted
      ? (s.voteSecret ? '<span class="tag ok">голос ✓</span>' : `<span class="tag ok">→ ${g.votes[p] === 'abstain' ? 'воздерж.' : esc(nameOf(g.votes[p]))}</span>`) : '';
    return `<div class="pcard ${alive ? '' : 'dead'} ${L.currentSpeaker(g) === p ? 'speaking' : ''} ${freshCls(p)}">
      <div class="phead"><span class="dot ${pl.online ? 'on' : ''}"></span><b>${esc(pl.name || '???')}</b>${p === me.id ? ' <span class="muted">(вы)</span>' : ''}
        ${alive ? '' : '<span class="tag bad">изгнан</span>'}
        ${g.effects.immune[p] === g.round ? '<span class="tag ok">иммунитет</span>' : ''}${voteInfo}</div>
      ${traitRows(p, g)}
      ${hidden ? `<div class="muted small">Скрыто: ${hidden}</div>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function featureItem(f) {
  const d = featureDesc(f);
  const g = state?.game ? L.norm(clone(state.game)) : null;
  const marks = g && showMarkers(g) ? markerChips([itemIn('bunkers', f)]) : '';
  const inf = featureFoodMonths(f) === 'inf' && g && showMarkers(g) ? '<span class="mk plus">🍖∞</span>' : '';
  return `<span class="feat-name">${esc(f)}${inf}${marks}</span>${d ? `<span class="feat-desc">${esc(d)}</span>` : ''}`;
}
function foodLine(g) {
  const fi = L.foodInfo(g);
  if (!fi.has) return '';
  return fi.infinite ? ' · Еда: <b>бесконечно</b>' : ` · Еда: <b>на ${L.monthsText(fi.months)}</b>`;
}
function foodNote(g) {
  const fi = L.foodInfo(g);
  if (!fi.has) return '';
  if (fi.infinite) return '<div class="food-note ok">🍖 В бункере неиссякаемый источник еды — голод не грозит, сколько бы ни пришлось сидеть.</div>';
  if (fi.status === 'ok') return `<div class="food-note ok">🍖 Еды хватит на весь срок (${L.monthsText(fi.need)}).</div>`;
  if (fi.status === 'unknown') return `<div class="food-note">🍖 Сколько сидеть в бункере — неизвестно. Умения добывать еду пригодятся.</div>`;
  return `<div class="food-note short">🍖 Еды не хватит: нужно ${L.monthsText(fi.need)}, есть на ${L.monthsText(fi.months)}. Особенно ценны те, кто умеет добывать пищу${showMarkers(g) ? ' — их характеристики помечены 🍖' : ''}.</div>`;
}

function tabBunker(g) {
  const c = g.catastrophe || {};
  const f = g.bunker.features;
  return `
    <div class="card"><div class="tl">Катастрофа ${sayBtn('cat')}</div><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><p class="muted">Нужно продержаться: <b>${esc(c.duration)}</b></p></div>
    <div class="card"><div class="tl">Бункер ${sayBtn('bunker')}</div>
      <p>Площадь: <b>${g.bunker.size} м²</b> · Мест: <b>${g.slots}</b>${foodLine(g)}</p>
      ${g.bunker.condition ? `<div class="cond"><span class="cond-label">Состояние</span><b>${esc(g.bunker.condition.text)}</b>${g.bunker.condition.desc ? `<span class="feat-desc">${esc(g.bunker.condition.desc)}</span>` : ''}</div>` : ''}
      ${foodNote(g)}
      <ul class="feats">${f.map((x, i) => `<li>${i < g.bunker.shown ? featureItem(x) : '<span class="muted">??? (откроется позже)</span>'}</li>`).join('')}</ul>
    </div>`;
}

function tabLog() {
  const entries = Object.values(state.log || {}).sort((a, b) => b.t - a.t).slice(0, 100);
  if (!entries.length) return '<p class="muted">Пока пусто.</p>';
  return `<ul class="log">${entries.map(e => `<li class="${e.type ? 'lt-' + e.type : ''}"><span class="muted small">${new Date(e.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span> ${esc(e.text)}</li>`).join('')}</ul>`;
}

function tabAdmin(g) {
  return `
    <div class="admin-row">
      <button class="btn small" data-a="next">Следующий этап ▸</button>
      ${g.paused ? '<button class="btn small" data-a="resume">▶ Продолжить</button>' : '<button class="btn small" data-a="pause">⏸ Пауза</button>'}
      <button class="btn small" data-a="addTime">+30 сек</button>
    </div>
    <h3>Игроки</h3>
    <div class="players">${g.players.map(p => `
      <div class="pcard ${g.alive[p] ? '' : 'dead'}">
        <div class="phead"><b>${esc(nameOf(p))}</b> ${g.alive[p] ? '' : '<span class="tag bad">изгнан</span>'}</div>
        <div class="admin-row">
          <select id="adm-key-${p}">${L.TRAITS.map(t => `<option value="${t.key}">${t.label}${(g.revealed[p] || {})[t.key] ? ' ✓' : ''}</option>`).join('')}</select>
          <button class="btn small" data-a="admReveal" data-pid="${p}">Раскрыть</button>
          <button class="btn small" data-a="admReroll" data-pid="${p}">Заменить</button>
        </div>
        <div class="admin-row">
          ${g.alive[p] ? `<button class="btn small ghost" data-a="admKill" data-pid="${p}">Изгнать</button>` : `<button class="btn small ghost" data-a="admRevive" data-pid="${p}">Вернуть</button>`}
        </div>
      </div>`).join('')}</div>
    <h3>Передать права хоста</h3>
    <div class="admin-row">${validPlayers().filter(([id]) => id !== me.id).map(([id, p]) => `<button class="btn small ghost" data-a="makeHost" data-pid="${id}">${esc(p.name)}</button>`).join('') || '<span class="muted">Некому</span>'}</div>
    <h3>Партия</h3>
    <div class="admin-row">
      <button class="btn small ghost" data-a="endNow">Завершить игру</button>
      <button class="btn small ghost" data-a="toLobby">Сбросить в лобби</button>
    </div>`;
}

function renderModal(g) {
  if (!ui.modal) return '';
  const a = state.cards?.[me.id]?.actions?.[ui.modal.i];
  if (!a) { ui.modal = null; return ''; }
  const e = E.normalizeEffect(a.effect);
  let body;
  if (ui.modal.step === 'choice') {
    const what = e.object === 'feature' ? 'особенность бункера' : `«${L.traitLabel(ui.modal.key)}»`;
    const file = e.object === 'feature' ? 'bunkers' : traitFile(ui.modal.key);
    body = `<p class="pick-label">${e.op === 'remove' ? `Что убрать — ${what}:` : `Выберите ${what}:`}</p>
      <div class="choice-list">${ui.modal.options.map((o, ci) => {
        const d = descIn(file, o);
        return `<button class="choice" data-a="choose" data-ci="${ci}"><b>${esc(o)}</b>${d ? `<span>${esc(d)}</span>` : ''}</button>`;
      }).join('')}</div>`;
  } else {
    const targets = targetsFor(a.effect);
    body = `<p class="pick-label">Выберите игрока:</p>
      <div class="vote-grid">${targets.length ? targets.map(p => `<button class="btn small" data-a="target" data-pid="${p}">${esc(nameOf(p))}${p === me.id ? ' (вы)' : ''}</button>`).join('') : '<span class="muted">Подходящих игроков нет</span>'}</div>`;
  }
  return `<div class="modal-bg" data-a="closeModal"><div class="modal act-dlg" data-stop="1">
    ${actionCardHtml(a)}
    ${body}
    <button class="btn ghost" data-a="closeModal">Отмена</button>
  </div></div>`;
}

// Итог игры: конфетти или мрак + звук
function celebrate(fin) {
  const lvl = fin.mode === 'story' ? 'story' : fin.verdict?.level;
  const gs = state?.game?.settings || {};
  if (gs.narrateFinal !== false) setTimeout(() => narrate(sayFinal(), { interrupt: true }), 2600);
  setTimeout(() => {
    if (lvl === 'good') {
      S.play('win', { mine: true });
      const box = document.createElement('div');
      box.className = 'confetti';
      const cols = ['var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--act)', '#3b82f6', '#ec4899'];
      box.innerHTML = Array.from({ length: 70 }, (_, i) => `<i style="left:${Math.random() * 100}%;background:${cols[i % cols.length]};--cd:${(2.2 + Math.random() * 1.8).toFixed(2)}s;--cdl:${(Math.random() * 1.2).toFixed(2)}s;--cx:${(Math.random() * 160 - 80) | 0}px;--cr:${(Math.random() * 900 - 450) | 0}deg"></i>`).join('');
      $ov.appendChild(box);
      setTimeout(() => box.remove(), 5500);
    } else if (lvl === 'losses') S.play('meh', { mine: true });
    else if (lvl === 'fell' || lvl === 'none') {
      S.play('lose', { mine: true });
      const gl = document.createElement('div');
      gl.className = 'gloom';
      $ov.appendChild(gl);
      setTimeout(() => gl.remove(), 2600);
    }
  }, 900);
}

// ---------------- Личные настройки: тема и звук ----------------
function prefsHtml() {
  const P = S.prefs;
  return `<div class="pref-row">Тема оформления<div class="theme-grid">${S.THEMES.map(([k, l, c]) => `<button class="theme-opt ${P.theme === k ? 'on' : ''}" data-pref="theme" data-v="${k}"><span class="theme-sw">${c.map(x => `<i style="background:${x}"></i>`).join('')}</span>${l}</button>`).join('')}</div></div>
    <div class="pref-row">Звуки<div class="seg">${S.SOUND_MODES.map(([k, l]) => `<button class="${P.sound === k ? 'on' : ''}" data-pref="sound" data-v="${k}">${l}</button>`).join('')}</div>
      <span class="small">«Только мои» — звук только когда событие касается вас: ваш ход, карта против вас, финал.</span></div>
    <div class="pref-row">Анимации<div class="seg">${S.MOTION_MODES.map(([k, l]) => `<button class="${P.motion === k ? 'on' : ''}" data-pref="motion" data-v="${k}">${l}</button>`).join('')}</div>
      <span class="small">«Меньше» — без переворотов, искр и тряски, только плавное появление. Помогает на слабых телефонах.</span></div>
    ${ttsPrefsHtml()}
    <label class="pref-row">Громкость звуков<input type="range" min="0" max="1" step="0.05" value="${P.vol}" data-pref="vol"></label>
    <p class="muted small">Настройки сохраняются на этом устройстве.</p>`;
}
function ttsPrefsHtml() {
  const P = S.prefs;
  if (!T.supported) return '<div class="pref-row">Озвучка<span class="small">Этот браузер не умеет читать вслух.</span></div>';
  const vs = T.ruVoices();
  const cur = vs.find(v => v.voiceURI === P.ttsVoice) ? P.ttsVoice : '';
  const mode = narrMode();
  const who = mode === 'off' ? 'В этом лобби озвучка выключена.' : mode === 'all' ? 'В этом лобби читают все устройства.' : 'В этом лобби читает только телефон хоста.';
  return `<div class="pref-row">Озвучка на этом устройстве<div class="seg">${[['on', 'Вкл'], ['off', 'Выкл']].map(([k, l]) => `<button class="${(P.tts || 'on') === k ? 'on' : ''}" data-pref="tts" data-v="${k}">${l}</button>`).join('')}</div>
      ${state ? `<span class="small">${who} Кто читает, выбирает хост в настройках лобби.</span>` : ''}</div>
    ${vs.length ? `<label class="pref-row">Голос<select data-pref-sel="ttsVoice"><option value="">Автоматически</option>${vs.map(v => `<option value="${esc(v.voiceURI)}" ${cur === v.voiceURI ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
    <label class="pref-row">Скорость речи<input type="range" min="0.7" max="1.5" step="0.05" value="${P.ttsRate || 1}" data-pref="ttsRate"></label>
    <label class="pref-row">Громкость диктора<input type="range" min="0" max="1" step="0.05" value="${P.ttsVol == null ? 1 : P.ttsVol}" data-pref="ttsVol"></label>
    <button class="btn small" data-tts-test>▶ Проверить голос</button>` : '<span class="small muted">На этом устройстве нет русского голоса. На Android его можно скачать в настройках «Синтез речи», на iPhone — в «Универсальный доступ → Устный контент».</span>'}`;
}
function openPrefs() {
  // голоса в Chrome подгружаются не сразу — обновим окно, когда появятся
  if (T.supported && !T.ruVoices().length) setTimeout(() => { const box = document.querySelector('.prefs'); if (box && T.ruVoices().length) box.innerHTML = prefsHtml(); }, 700);
  return dialog({ title: 'Настройки', html: `<div class="prefs">${prefsHtml()}</div>`, ok: 'Готово', cancel: '' }); }
$ov.addEventListener('click', e => {
  const b = e.target.closest('[data-pref][data-v]');
  if (!b) return;
  S.setPref(b.dataset.pref, b.dataset.v);
  const box = b.closest('.prefs');
  if (box) box.innerHTML = prefsHtml();
  if (b.dataset.pref === 'sound' && b.dataset.v !== 'off') S.play('turn', { mine: true });
  if (b.dataset.pref === 'tts' && b.dataset.v === 'off') T.stop();
});
$ov.addEventListener('click', e => {
  if (!e.target.closest('[data-tts-test]')) return;
  if (!T.speak('Внимание, жители бункера. Двери закроются через одну минуту.', { interrupt: true })) toast('Нет русского голоса на этом устройстве', 'warn');
});
$ov.addEventListener('change', e => {
  const sel = e.target.dataset?.prefSel;
  if (sel) { S.setPref(sel, e.target.value); T.speak('Голос выбран.', { interrupt: true }); return; }
  if (e.target.dataset?.pref === 'ttsRate') { S.setPref('ttsRate', +e.target.value); T.speak('Так звучит новая скорость.', { interrupt: true }); return; }
  if (e.target.dataset?.pref === 'ttsVol') { S.setPref('ttsVol', +e.target.value); T.speak('Так звучит новая громкость.', { interrupt: true }); return; }
  if (e.target.dataset?.pref !== 'vol') return;
  S.setPref('vol', +e.target.value);
  S.play('flip', { mine: true });
});

function renderEnd() {
  const g = L.norm(clone(state.game));
  const cards = state.cards || {};
  const names = Object.fromEntries(g.players.map(p => [p, nameOf(p)]));
  const storyKey = `${roomCode}:${g.version}`;
  if (!state.game.final && content && amAdvancer() && storyRequested !== storyKey) {
    // финал считает один клиент (хост или первый онлайн), чтобы у всех он был одинаковым
    storyRequested = storyKey;
    try {
      const fin = makeFinal(g, cards, names, content, g.settings);
      update(R('game'), { final: JSON.parse(JSON.stringify(fin)), story: fin.story }).catch(console.error);
    } catch (e) { console.error(e); }
  }
  const fin = state.game.final;
  const surv = L.aliveIds(g), out = g.players.filter(p => !g.alive[p]);
  const block = list => list.map(p => `<div class="pcard ${g.alive[p] ? '' : 'dead'}"><div class="phead"><b>${esc(nameOf(p))}</b></div>${traitRows(p, g)}</div>`).join('');
  const full = fin && fin.mode !== 'story';
  const arr = v => (Array.isArray(v) ? v : v ? Object.values(v) : []);
  const verdict = fin && full ? `<div class="verdict v-${fin.verdict.level}"><div class="v-ico">${fin.verdict.icon}</div><div><div class="v-title">${esc(fin.verdict.title)}</div><div class="v-text">${esc(fin.verdict.text)}</div></div></div>` : '';
  const needsHtml = fin && full ? `<h2>Нужды бункера</h2><div class="needs">${arr(fin.needs).map(n => `
      <div class="need n-${n.status}"><div class="need-head"><span>${n.icon}</span><b>${esc(n.name)}</b>${n.important ? '<span class="need-imp" title="Особенно важно в этой катастрофе">важно</span>' : ''}<span class="need-st">${{ ok: '✓', weak: '~', fail: '✗' }[n.status]}</span></div><div class="need-text">${esc(n.text)}</div></div>`).join('')}</div>` : '';
  const probs = arr(fin?.problems);
  const probsHtml = fin && full && probs.length ? `<h2>Проблемы</h2><div class="probs">${probs.map(p => `
      <div class="prob ${p.solved ? 'ok' : 'bad'}"><div class="prob-head"><span>${p.icon}</span><b>${esc(p.name)}</b><span class="prob-st">${p.solved ? 'решена' : 'не решена'}</span></div>
        <div class="prob-text">${esc(p.text)}</div>
        ${arr(p.sources).length ? `<div class="prob-src">Откуда: ${esc(arr(p.sources).join('; '))}</div>` : ''}
        ${arr(p.weak).length && !p.solved ? `<div class="prob-src">Уязвимы: ${esc(arr(p.weak).join(', '))}</div>` : ''}</div>`).join('')}</div>` : '';
  const fates = arr(fin?.fates);
  const fatesHtml = fates.length ? `<h2>Судьбы</h2><ul class="fates">${fates.map(f => `<li class="f-${f.status}"><span class="f-ico">${{ alive: '🟢', hurt: '🟠', dead: '💀' }[f.status] || '•'}</span><span>${esc(f.text)}</span></li>`).join('')}</ul>` : '';
  const exiled = arr(fin?.exiled);
  const exiledHtml = exiled.length ? `<h2>Изгнанные</h2><ul class="fates">${exiled.map(x => `<li class="x-${x.kind}"><span class="f-ico">${x.kind === 'regret' ? '😔' : '👍'}</span><span>${esc(x.text)}</span></li>`).join('')}</ul>` : '';
  const story = arr(fin?.story).length ? arr(fin.story) : arr(state.game.story);
  if (fin && ui.endAnim?.key !== storyKey) { ui.endAnim = { key: storyKey, t: Date.now() }; celebrate(fin); }
  const anim = ui.endAnim?.key === storyKey && Date.now() - ui.endAnim.t < 7000 ? 'anim' : '';
  setHTML(`
  <button class="gear home-gear" data-a="prefs" title="Настройки">⚙️</button>
  <div class="wrap end ${anim}">
    <h1 class="logo small">Финал</h1>
    ${verdict}
    <div class="card story">${story.length ? `<div class="tl">История ${sayBtn('final')}</div>` : ''}${story.length ? story.map(x => `<p>${esc(x)}</p>`).join('') : '<p class="muted">Подводим итоги…</p>'}</div>
    ${needsHtml}${probsHtml}${fatesHtml}${exiledHtml}
    <h2>Выжившие · ${surv.length}</h2><div class="players">${block(surv)}</div>
    <h2>Остались снаружи · ${out.length}</h2><div class="players">${block(out)}</div>
    <div class="card"><div class="tl">Бункер</div><ul class="feats">${g.bunker.features.map(f => `<li>${featureItem(f)}</li>`).join('')}</ul></div>
    <div class="actions-row">
      ${isHost() ? '<button class="btn primary" data-a="toLobbyNoConfirm">Новая игра (в лобби)</button>' : '<p class="muted center">Хост может начать новую игру.</p>'}
      <button class="btn ghost" data-a="leave">Выйти</button>
    </div>
  </div>`);
}

// ---------------- События ----------------
$app.addEventListener('click', async e => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  if (b.classList.contains('modal-bg') && e.target.closest('[data-stop]')) return;
  const a = b.dataset.a, pid = b.dataset.pid;
  try {
    switch (a) {
      case 'create': await createRoom(); break;
      case 'join': await joinRoom(); break;
      case 'leave': await leaveRoom(); break;
      case 'copy': {
        const url = location.origin + location.pathname + '#' + roomCode;
        try { await navigator.clipboard.writeText(url); toast('Ссылка скопирована'); } catch { dialog({ title: 'Ссылка на лобби', html: `<input class="copy-field" readonly value="${esc(url)}" onclick="this.select()">`, ok: 'Готово', cancel: '' }); }
        break;
      }
      case 'kickLobby': if (await ask(`Убрать ${nameOf(pid)} из лобби?`, 'Убрать', { danger: true })) await remove(R(`players/${pid}`)); break;
      case 'start': await startGame(); break;
      case 'packClear': if (await ask('Вернуть стандартный набор карточек?', 'Вернуть')) await remove(R('content')); break;
      case 'tab': ui.tab = b.dataset.tab; render(); break;
      case 'prefs': await openPrefs(); break;
      case 'sec': toggleSec(b.dataset.sec); break;
      case 'say': sayAgain(b.dataset.say); break;
      case 'reveal': await revealMine(b.dataset.key); break;
      case 'done': {
        const g = L.norm(clone(state.game));
        if (L.currentSpeaker(g) === me.id) await doAdvance(g.version);
        break;
      }
      case 'vote': await vote(pid); break;
      case 'act': await startAction(+b.dataset.i); break;
      case 'target': {
        const i = ui.modal.i;
        const e = E.normalizeEffect(state.cards[me.id].actions[i].effect);
        if (E.needsChoice(e)) { openChoice(i, pid); break; }
        ui.modal = null; render();
        await useAction(i, { target: pid });
        break;
      }
      case 'choose': {
        const m = ui.modal;
        ui.modal = null; render();
        await useAction(m.i, { target: m.target, key: m.key, choice: m.options[+b.dataset.ci] });
        break;
      }
      case 'closeModal': ui.modal = null; render(); break;
      case 'next': await doAdvance(state.game.version || 0); break;
      case 'pause': await adminPause(); break;
      case 'resume': await adminResume(); break;
      case 'addTime': await adminAddTime(); break;
      case 'admReveal': await adminReveal(pid); break;
      case 'admReroll': await adminReroll(pid); break;
      case 'admKill': if (await ask(`Изгнать ${nameOf(pid)}?`, 'Изгнать', { danger: true })) await adminSetAlive(pid, false); break;
      case 'admRevive': await adminSetAlive(pid, true); break;
      case 'makeHost': await makeHost(pid); break;
      case 'endNow': await forceEnd(); break;
      case 'toLobby': await backToLobby(); break;
      case 'toLobbyNoConfirm': await update(R(''), { game: null, cards: null, log: null, 'meta/status': 'lobby' }); break;
    }
  } catch (err) {
    console.error(err);
    toast('Ошибка: ' + (err.message || err), 'warn');
  }
});

// ---------- Перетаскивание игроков в лобби ----------
let drag = null;
$app.addEventListener('pointerdown', e => {
  const grip = e.target.closest('.grip');
  if (!grip || !isHost()) return;
  const li = grip.closest('li');
  e.preventDefault();
  try { grip.setPointerCapture(e.pointerId); } catch {}
  drag = { li, list: li.parentElement, from: [...li.parentElement.children].indexOf(li), pending: false };
  li.classList.add('dragging');
  document.body.classList.add('no-select');
});
$app.addEventListener('pointermove', e => {
  if (!drag) return;
  e.preventDefault();
  const y = e.clientY;
  const items = [...drag.list.children].filter(x => x !== drag.li);
  let before = null;
  for (const it of items) {
    const r = it.getBoundingClientRect();
    if (y < r.top + r.height / 2) { before = it; break; }
  }
  if (before !== drag.li.nextElementSibling || (!before && drag.li !== drag.list.lastElementChild)) {
    drag.list.insertBefore(drag.li, before);
    renumberSeats(drag.list);
  }
});
async function endDrag() {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.li.classList.remove('dragging');
  document.body.classList.remove('no-select');
  const ids = [...d.list.children].map(x => x.dataset.pid);
  const changed = ids.indexOf(d.li.dataset.pid) !== d.from;
  if (changed && roomCode) {
    const upd = {};
    ids.forEach((id, i) => { upd[`players/${id}/seat`] = i; });
    lastHTML = '';
    try { await update(R(''), upd); } catch (err) { toast('Ошибка: ' + err.message, 'warn'); }
  }
  render();
}
$app.addEventListener('pointerup', endDrag);
$app.addEventListener('pointercancel', endDrag);
function renumberSeats(list) {
  const s = { ...L.DEFAULT_SETTINGS, ...state.settings };
  let n = 0;
  [...list.children].forEach(li => {
    const plays = s.hostPlays || li.dataset.pid !== state.meta.hostId;
    const el = li.querySelector('.seat');
    if (el) el.textContent = plays ? ++n : '–';
  });
}

$app.addEventListener('change', e => {
  if (e.target.id === 'pack-file') {
    uploadPack(e.target.files).catch(err => toast('Ошибка: ' + err.message, 'warn'));
    e.target.value = '';
    return;
  }
  if (e.target.id === 'pack-mode' && isHost()) {
    update(R('content'), { mode: e.target.value, at: now() }).catch(err => toast('Ошибка: ' + err.message, 'warn'));
    return;
  }
  const el = e.target.closest('[data-set]');
  if (el) changeSetting(el).catch(err => toast('Ошибка: ' + err.message, 'warn'));
});

$app.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'code') joinRoom().catch(err => toast(err.message, 'warn'));
  if (e.target.id === 'name') document.getElementById('code')?.focus();
});

// ---------------- Старт и переподключение ----------------
(async function boot() {
  const code = (location.hash.slice(1) || localStorage.getItem(LS.room) || '').toUpperCase();
  if (code) {
    ui.prefill = code;
    try {
      const snap = await get(ref(db, `rooms/${code}/players/${me.id}`));
      if (snap.exists() && snap.val()?.name) { enterRoom(code, { rejoin: true }); return; }
    } catch (e) { console.error(e); ui.error = 'Не удалось подключиться к базе. Проверьте js/firebase-config.js'; }
  }
  render();
})();
