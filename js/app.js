import { firebaseConfig, appCheckSiteKey } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js';
import {
  getDatabase, ref, get, set, update, remove, push, onValue, onDisconnect,
  runTransaction, increment, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import * as L from './logic.js?v=1.9';
import { loadContent } from './content.js?v=1.9';

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
let content = null;
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
const traitFood = (pid, key) => +((itemIn(traitFile(key), state?.cards?.[pid]?.raw?.[key]) || {}).food || 0);
const featureFood = f => +((itemIn('bunkers', f) || {}).food || 0);
function foodScore(pid) { return L.TRAIT_KEYS.reduce((sum, k) => sum + Math.max(0, traitFood(pid, k)), 0); }
function foodTag(v, hot) {
  if (!v) return '';
  return `<span class="food-tag ${v > 0 ? 'plus' : 'minus'} ${hot ? 'hot' : ''}" title="${v > 0 ? 'Помогает с едой' : 'Нужно больше еды или особое питание'}">🍖 ${v > 0 ? 'еда' : '−еда'}</span>`;
}
const traitDesc = (key, raw) => descIn((L.TRAITS.find(t => t.key === key) || {}).file, raw);
const cardDesc = (pid, key) => traitDesc(key, state?.cards?.[pid]?.raw?.[key]);
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
  el.className = 'popup-bg';
  el.innerHTML = `<div class="popup ${e.cls || ''}" ${e.color ? `style="--tc:${e.color}"` : ''}>
    ${e.top ? `<div class="popup-top">${esc(e.top)}</div>` : ''}
    ${e.icon ? `<div class="popup-ico">${e.icon}</div>` : ''}
    ${e.label ? `<div class="popup-label">${esc(e.label)}</div>` : ''}
    ${e.value ? `<div class="popup-value">${esc(e.value)}</div>` : ''}
    ${e.name ? `<div class="popup-name">${esc(e.name)}</div>` : ''}
    ${e.sub ? `<div class="popup-sub">${esc(e.sub)}</div>` : ''}
  </div>`;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    el.classList.add('out');
    setTimeout(() => { el.remove(); nextPopup(); }, 250);
  };
  el.addEventListener('click', close);
  $ov.appendChild(el);
  setTimeout(close, e.long ? 6000 : popupQueue.length ? 2200 : 3200);
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
function notifyEntry(e) {
  if (!e) return;
  if (e.type === 'reveal') {
    const m = TMETA[e.key] || {};
    showPopup({ cls: e.key ? 'pop-trait' : '', color: m.color, icon: m.icon, top: `${e.who} раскрывает`, label: e.label, value: e.value, sub: e.desc });
  }
  else if (e.type === 'action') showPopup({ cls: 'pop-act', top: `${e.who} применяет карту`, icon: e.icon || '🃏', value: e.title, sub: e.sub });
  else if (e.type === 'exile') showPopup({ cls: 'exile', top: 'Изгнан(а) из бункера', name: e.who });
  else if (e.type === 'start') {
    ui.tab = 'bunker';
    render();
    showPopup({ cls: 'cat', top: 'Катастрофа', value: e.title, sub: `${e.catText} Продержаться: ${e.duration}.`, long: true });
    const fd = featureDesc(e.feature);
    const parts = [];
    if (e.condition) parts.push(`Состояние: ${e.condition}.`);
    if (e.food) parts.push(`Еды на ${L.monthsText(e.food)}${e.need ? (e.food >= e.need ? ' — хватит.' : ` — не хватит, нужно ${L.monthsText(e.need)}.`) : '.'}`);
    if (e.feature) parts.push(`В бункере есть: ${e.feature}${fd ? '. ' + fd : ''}`);
    showPopup({ cls: 'info', top: 'Ваш бункер', value: `${e.size} м² · мест: ${e.slots}`, sub: parts.join(' '), long: true });
  } else if (e.type === 'bunker') {
    const fm = +((itemIn('bunkers', e.feature) || {}).foodMonths || 0);
    const sub = [featureDesc(e.feature), fm ? `🍖 Еда: ${fm > 0 ? '+' : '−'}${L.monthsText(Math.abs(fm))}` : ''].filter(Boolean).join(' ');
    showPopup({ cls: 'info', top: e.round ? `Раунд ${e.round}` : 'Бункер', label: 'Открыта особенность бункера', value: e.feature, sub });
  }
  else if (e.type === 'vote' || e.type === 'presence') { if (e.actor !== me.id) toast(e.text, 'small'); }
  else toast(e.text);
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
    state = snap.val();
    if (!state) return exitRoom('Лобби больше не существует');
    const p = state.players?.[me.id];
    if (!p || !p.name) return exitRoom('Вас удалили из лобби');
    if (state.meta?.status === 'playing' && !content) loadContent().then(c => { content = c; descMaps = null; render(); }).catch(console.error);
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
  roomUnsub?.(); presenceUnsub?.();
  roomUnsub = presenceUnsub = null;
  if (roomCode) onDisconnect(R('')).cancel().catch(() => {});
  seenLog = null;
  roomCode = null; state = null; ui.modal = null; ui.tab = 'me';
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
  content = await loadContent();
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
    condition: game.bunker.condition?.text || '', food: L.foodInfo(game).months, need: game.catastrophe.months || 0,
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
              addLog(`@${sp}@ (время вышло) раскрыл(а) «${L.traitLabel(k)}»: ${value}`, { type: 'reveal', who: nameOf(sp), key: k, label: L.traitLabel(k), value, desc: cardDesc(sp, k), auto: true });
            }
          }
        }
        if (ex) addLog(g.event, { type: 'exile', who: nameOf(ex) });
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
  addLog(`@${me.id}@ раскрыл(а) «${L.traitLabel(key)}»: ${value}`, { type: 'reveal', actor: me.id, who: me.name, key, label: L.traitLabel(key), value, desc: cardDesc(me.id, key) });
}

async function vote(target) {
  const g = L.norm(clone(state.game));
  if (g.phase !== 'vote' || !g.alive[me.id]) return;
  if (g.votes[me.id] === target) return;
  await set(R(`game/votes/${me.id}`), target);
  const what = target === 'abstain' ? 'воздерживается' : `голосует → @${target}@`;
  addLog(g.settings.voteSecret ? `@${me.id}@ проголосовал(а)` : `@${me.id}@ ${what}`, { type: 'vote', actor: me.id });
}

const NEEDS_TARGET = ['reroll_target', 'swap', 'reveal_target', 'set_target', 'revive'];

function targetsFor(effect) {
  const g = L.norm(clone(state.game));
  const alive = L.aliveIds(g);
  switch (effect.type) {
    case 'revive': return g.players.filter(p => !g.alive[p]);
    case 'set_target': return alive;
    case 'reveal_target': return alive.filter(p => p !== me.id && (effect.key && effect.key !== 'random' ? L.hiddenKeys(g, p).includes(effect.key) : L.hiddenKeys(g, p).length > 0));
    default: return alive.filter(p => p !== me.id);
  }
}

async function useAction(i, target) {
  const c = content || await loadContent();
  content = c;
  const g = L.norm(clone(state.game));
  const cards = state.cards || {};
  const a = cards[me.id]?.actions?.[i];
  if (!a || a.used || !g.alive[me.id] || g.phase === 'end') return;
  const e = a.effect || {};
  const s = g.settings;
  const alive = L.aliveIds(g);
  const key = !e.key || e.key === 'random' ? L.pick(L.TRAIT_KEYS) : e.key;
  const label = L.traitLabel(key);
  const upd = {};
  let msg = `@${me.id}@ применил(а) карту «${a.title}»`;
  let revealExtra = null;

  const usedRaw = k => new Set(g.players.map(p => cards[p]?.raw?.[k]).filter(Boolean));
  const reroll = (pid, k) => {
    let age = cards[pid].age;
    if (k === 'biology') { age = L.makeAge(s); upd[`cards/${pid}/age`] = age; }
    const t = L.makeTrait(k, c, s, age, usedRaw(k));
    upd[`cards/${pid}/traits/${k}`] = t.value;
    upd[`cards/${pid}/raw/${k}`] = t.raw;
  };
  const put = (pid, k, from) => {
    upd[`cards/${pid}/traits/${k}`] = from.traits[k];
    upd[`cards/${pid}/raw/${k}`] = from.raw?.[k] || from.traits[k];
    if (k === 'biology') upd[`cards/${pid}/age`] = from.age;
  };

  switch (e.type) {
    case 'reroll_self':
      reroll(me.id, key); msg += ` и получил(а) новую характеристику «${label}»`; break;
    case 'reroll_target':
      reroll(target, key); msg += `: у @${target}@ заменена характеристика «${label}»`; break;
    case 'reroll_all':
      alive.forEach(p => reroll(p, key)); msg += `: у всех заменена характеристика «${label}»`; break;
    case 'swap':
      put(me.id, key, cards[target]); put(target, key, cards[me.id]);
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
      if (!k) return toast('У этого игрока уже всё раскрыто', 'warn');
      upd[`game/revealed/${target}/${k}`] = true;
      msg += `: у @${target}@ раскрыто «${L.traitLabel(k)}» — ${cards[target].traits[k]}`;
      revealExtra = { type: 'reveal', actor: me.id, who: nameOf(target), key: k, label: L.traitLabel(k), value: cards[target].traits[k], desc: cardDesc(target, k) };
      break;
    }
    case 'set_target':
      upd[`cards/${target}/traits/${key}`] = e.value;
      upd[`cards/${target}/raw/${key}`] = e.value;
      msg += `: у @${target}@ «${label}» теперь — ${e.value}`; break;
    case 'immunity':
      upd[`game/effects/immune/${me.id}`] = g.round; msg += ' — иммунитет в этом раунде'; break;
    case 'double_vote':
      upd[`game/effects/double/${me.id}`] = g.round; msg += ' — двойной голос в этом раунде'; break;
    case 'cancel_vote':
      if (g.phase !== 'vote') return toast('Эту карту можно применить только во время голосования', 'warn');
      upd['game/effects/cancelVote'] = g.round; msg += ' — голосование будет сорвано'; break;
    case 'extra_slot':
      upd['game/slots'] = increment(1); msg += ' — в бункере +1 место'; break;
    case 'bunker_reveal':
      if (g.bunker.shown >= g.bunker.features.length) return toast('Все особенности бункера уже открыты', 'warn');
      upd['game/bunker/shown'] = increment(1);
      msg += `: в бункере открыто — ${g.bunker.features[g.bunker.shown]}`;
      revealExtra = { type: 'bunker', feature: g.bunker.features[g.bunker.shown], actor: me.id };
      break;
    case 'revive':
      upd[`game/alive/${target}`] = true; msg += `: @${target}@ возвращается в игру`; break;
    default:
      return toast('Неизвестная карта действия', 'warn');
  }
  upd[`cards/${me.id}/actions/${i}/used`] = true;
  await update(R(''), upd);
  const prefix = `@${me.id}@ применил(а) карту «${a.title}»`;
  let sub = fillNames(msg.slice(prefix.length)).replace(/^\s*(:|—|и)\s*/, '');
  sub = sub ? sub[0].toUpperCase() + sub.slice(1) : '';
  addLog(msg, { type: 'action', actor: me.id, who: me.name, title: a.title, sub, icon: actIcon(a),
    ...(revealExtra && revealExtra.label ? { label: revealExtra.label, value: revealExtra.value } : {}) });
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
  addLog(alive ? `Хост вернул в игру @${pid}@` : `Хост исключил @${pid}@`);
}
async function adminReveal(pid) {
  const key = document.getElementById('adm-key-' + pid)?.value;
  if (!key) return;
  await set(R(`game/revealed/${pid}/${key}`), true);
  const value = state.cards[pid].traits[key];
  addLog(`Хост раскрыл у @${pid}@ «${L.traitLabel(key)}»: ${value}`, { type: 'reveal', actor: me.id, who: nameOf(pid), key, label: L.traitLabel(key), value, desc: cardDesc(pid, key) });
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
  { k: 'actionsPerPlayer', t: 'num', l: 'Карт действий на игрока', min: 0, max: 5 },
  { k: 'bunkerFeatures', t: 'num', l: 'Особенностей бункера', min: 1, max: 10 },
  { k: 'speechTime', t: 'num', l: 'Речь игрока, сек (0 — без таймера)', min: 0, max: 900 },
  { k: 'discussionTime', t: 'num', l: 'Обсуждение, сек', min: 0, max: 1800 },
  { k: 'voteTime', t: 'num', l: 'Голосование, сек', min: 0, max: 600 },
  { k: 'resultTime', t: 'num', l: 'Показ итога, сек', min: 0, max: 120 },
];

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
      <button class="btn small" data-a="copy">Ссылка</button>
    </div>
    <h2>Игроки · ${ps.length}</h2>
    <p class="muted small">Ходят по кругу сверху вниз.${host ? ' Перетаскивайте игроков за ⠿, чтобы поменять порядок.' : ''}</p>
    <ul class="plist ${host ? 'sortable' : ''}" id="seat-list">
      ${lobbyRows(ps, s, host)}
    </ul>
    <h2>Настройки</h2>
    <p class="muted small">Играют: ${playing}. Мест в бункере: ${s.slots > 0 ? Math.min(s.slots, Math.max(1, playing - 1)) : autoSlots}${s.slots > 0 ? '' : ' (авто)'}</p>
    ${host ? `<div class="settings">${FIELDS.map(f => settingInput(f, s[f.k], s)).join('')}</div>`
      : `<ul class="summary">${FIELDS.map(f => `<li><span>${f.l}</span><b>${esc(settingValueText(f, s[f.k]))}</b></li>`).join('')}</ul>`}
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
  return `<div class="banner">${body}<div class="banner-tools">${nextBtn}</div></div>`;
}

function traitRows(pid, g, { mine = false } = {}) {
  const card = state.cards?.[pid];
  if (!card) return '';
  const rev = g.revealed[pid] || {};
  const tiles = L.TRAITS.map(t => {
    const open = !!rev[t.key];
    if (!mine && !open) return '';
    const m = TMETA[t.key] || {};
    const desc = cardDesc(pid, t.key);
    const ft = foodTag(traitFood(pid, t.key), L.foodInfo(g).status === 'short');
    const btn = mine && !open && L.canReveal(g, pid, t.key) ? `<button class="btn small tc-btn" data-a="reveal" data-key="${t.key}">Раскрыть</button>` : '';
    const chip = mine ? (open ? '<span class="tc-chip on" title="Открыто всем">👁</span>' : '<span class="tc-chip" title="Видите только вы">🔒</span>') : '';
    return `<div class="tcard ${open ? 'open' : 'closed'}" style="--tc:${m.color}">
      <span class="tc-ico">${m.icon}</span>
      <div class="tc-body">
        <div class="tc-label">${t.label}${ft}</div>
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
    <div id="timer" class="timer"></div>
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
          <div class="act-body"><div class="act-kind">Карта действия</div><b>${esc(a.title)}</b><div class="act-text">${esc(a.text)}</div></div>
          <div class="act-side">${a.used ? '<span class="tag">использована</span>' : alive ? actionControl(a, i, g) : ''}</div>
        </div>`).join('')}</div>` : ''}
    <button class="btn ghost" data-a="leave">Выйти (можно вернуться)</button>`;
}

// Почему карту нельзя применить прямо сейчас ('' — можно)
function actionBlockReason(a, g) {
  const e = a.effect || {};
  if (g.phase === 'end') return 'Игра окончена';
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
    default:
      if (NEEDS_TARGET.includes(e.type) && !targetsFor(e).length) return 'Нет подходящих игроков';
      return '';
  }
}

function actIcon(a) {
  if (a.icon) return a.icon;
  const found = (content?.actions || []).find(x => x.id === a.id);
  return (found && found.icon) || '🃏';
}
function actionCardHtml(a) {
  return `<div class="act-hero"><div class="act-hero-ico">${actIcon(a)}</div><div class="act-kind">Карта действия</div><div class="act-hero-title">${esc(a.title)}</div><div class="act-text">${esc(a.text)}</div></div>`;
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
    const alive = g.alive[p];
    const hidden = L.hiddenKeys(g, p).length;
    const voted = g.phase === 'vote' && g.votes[p];
    const voteInfo = g.phase === 'vote' && voted
      ? (s.voteSecret ? '<span class="tag ok">голос ✓</span>' : `<span class="tag ok">→ ${g.votes[p] === 'abstain' ? 'воздерж.' : esc(nameOf(g.votes[p]))}</span>`) : '';
    return `<div class="pcard ${alive ? '' : 'dead'} ${L.currentSpeaker(g) === p ? 'speaking' : ''}">
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
  return `<span class="feat-name">${esc(f)}${foodTag(featureFood(f))}</span>${d ? `<span class="feat-desc">${esc(d)}</span>` : ''}`;
}
function foodLine(g) {
  const fi = L.foodInfo(g);
  if (!fi.has) return '';
  return ` · Еда: <b>на ${L.monthsText(fi.months)}</b>`;
}
function foodNote(g) {
  const fi = L.foodInfo(g);
  if (!fi.has) return '';
  if (fi.status === 'ok') return `<div class="food-note ok">🍖 Еды хватит на весь срок (${L.monthsText(fi.need)}).</div>`;
  if (fi.status === 'unknown') return `<div class="food-note">🍖 Сколько сидеть в бункере — неизвестно. Умения добывать еду пригодятся.</div>`;
  return `<div class="food-note short">🍖 Еды не хватит: нужно ${L.monthsText(fi.need)}, есть на ${L.monthsText(fi.months)}. Особенно ценны те, кто умеет добывать пищу — их характеристики помечены 🍖.</div>`;
}

function tabBunker(g) {
  const c = g.catastrophe || {};
  const f = g.bunker.features;
  return `
    <div class="card"><div class="tl">Катастрофа</div><h3>${esc(c.title)}</h3><p>${esc(c.text)}</p><p class="muted">Нужно продержаться: <b>${esc(c.duration)}</b></p></div>
    <div class="card"><div class="tl">Бункер</div>
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
  const targets = targetsFor(a.effect);
  return `<div class="modal-bg" data-a="closeModal"><div class="modal act-dlg" data-stop="1">
    ${actionCardHtml(a)}
    <p class="pick-label">Выберите игрока:</p>
    <div class="vote-grid">${targets.length ? targets.map(p => `<button class="btn small" data-a="target" data-pid="${p}">${esc(nameOf(p))}${p === me.id ? ' (вы)' : ''}</button>`).join('') : '<span class="muted">Подходящих игроков нет</span>'}</div>
    <button class="btn ghost" data-a="closeModal">Отмена</button>
  </div></div>`;
}

function renderEnd() {
  const g = L.norm(clone(state.game));
  const cards = state.cards || {};
  const names = Object.fromEntries(g.players.map(p => [p, nameOf(p)]));
  const storyKey = `${roomCode}:${g.version}`;
  if (!state.game.story && amAdvancer() && storyRequested !== storyKey) {
    // историю генерирует один клиент (хост или первый онлайн), чтобы у всех она была одинаковой
    storyRequested = storyKey;
    set(R('game/story'), L.makeStory(g, cards, names, Object.fromEntries(g.players.map(p => [p, foodScore(p)])))).catch(console.error);
  }
  const story = state.game.story || ['Пишем историю выживания…'];
  const block = list => list.map(p => `<div class="pcard ${g.alive[p] ? '' : 'dead'}"><div class="phead"><b>${esc(nameOf(p))}</b></div>${traitRows(p, g)}</div>`).join('');
  const surv = L.aliveIds(g), out = g.players.filter(p => !g.alive[p]);
  setHTML(`
  <div class="wrap">
    <h1 class="logo small">Финал</h1>
    <div class="card story">${story.map(x => `<p>${esc(x)}</p>`).join('')}</div>
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
      case 'tab': ui.tab = b.dataset.tab; render(); break;
      case 'reveal': await revealMine(b.dataset.key); break;
      case 'done': {
        const g = L.norm(clone(state.game));
        if (L.currentSpeaker(g) === me.id) await doAdvance(g.version);
        break;
      }
      case 'vote': await vote(pid); break;
      case 'act': {
        const i = +b.dataset.i;
        const act = state.cards[me.id].actions[i];
        const why = actionBlockReason(act, L.norm(clone(state.game)));
        if (why) { toast(why, 'warn'); break; }
        if (NEEDS_TARGET.includes(act.effect?.type)) { ui.modal = { i }; render(); }
        else if (await dialog({ html: actionCardHtml(act), ok: 'Применить', cls: 'act-dlg' })) await useAction(i);
        break;
      }
      case 'target': { const i = ui.modal.i; ui.modal = null; render(); await useAction(i, pid); break; }
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
