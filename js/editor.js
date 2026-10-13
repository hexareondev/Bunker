import { makeZip, downloadBlob, readZip } from './zip.js?v=3.0';
import * as E from './effects.js?v=3.0';

// ---------------- Описание разделов ----------------
const NEEDS = [['food', '🍖', 'Еда'], ['medicine', '🩺', 'Медицина'], ['repair', '🔧', 'Ремонт'], ['defense', '🛡️', 'Защита'], ['morale', '🙂', 'Мораль'], ['reproduction', '👶', 'Род']];
// Поля «для финала»: что даёт группе, что решает, к чему уязвим, что вызывает
const FINAL_FIELDS = [
  { t: 'heading', l: '🏁 Для финала' },
  { k: 'needs', l: 'Вклад в нужды группы (−2…+2)', t: 'needs' },
  { k: 'solves', l: '✔ Решает проблемы', t: 'probs' },
  { k: 'weak', l: '⚠ Уязвим к проблемам', t: 'probs' },
  { k: 'causes', l: '❗ Вызывает проблемы', t: 'probs' },
];
const TRAIT_FIELDS = [
  { k: 'text', l: 'Значение', t: 'text', req: true },
  { k: 'desc', l: 'Описание (необязательно)', t: 'area', ph: 'Чем это полезно или опасно в бункере' },
  { k: 'dark', l: 'Чёрный юмор', t: 'check' },
  ...FINAL_FIELDS,
];

const SECTIONS = [
  { f: 'tags', label: 'Проблемы', icon: '⚠️', main: 'name', color: '#c2541a',
    hint: 'Проблемы связывают карточки между собой в финале: катастрофа, бункер или игрок их вызывают, другие карточки решают, у третьих к ним уязвимость. В текстах можно писать {who} — кто решил, {name} — имя уязвимого. Формы вроде «умер(ла)» подстроятся под пол персонажа.',
    fields: [
      { k: 'icon', l: 'Значок (эмодзи)', t: 'text', short: true },
      { k: 'name', l: 'Название', t: 'text', req: true },
      { k: 'id', l: 'ID (латиницей, уникальный)', t: 'id', req: true },
      { k: 'desc', l: 'Описание', t: 'area' },
      { k: 'need', l: 'По какой нужде бьёт, если не решена', t: 'select', opts: NEEDS.map(([id, ic, n]) => [id, `${ic} ${n}`]) },
      { k: 'power', l: 'Сила удара по нужде (1–3)', t: 'num' },
      { k: 'foodLoss', l: 'Сколько месяцев еды пропадёт, если не решена', t: 'num' },
      { k: 'deadly', l: '💀 Смертельна для уязвимых, если не решена', t: 'check' },
      { k: 'solved', l: 'Текст, если решена ({who})', t: 'area' },
      { k: 'unsolved', l: 'Текст, если не решена', t: 'area' },
      { k: 'weak', l: 'Что случилось с уязвимым ({name})', t: 'area' },
    ] },
  { f: 'catastrophes', label: 'Катастрофы', icon: '☄️', main: 'title', fields: [
    { k: 'title', l: 'Название', t: 'text', req: true },
    { k: 'text', l: 'Описание', t: 'area' },
    { k: 'duration', l: 'Сколько сидеть (текстом)', t: 'text', ph: 'например: 2 года' },
    { k: 'months', l: 'Срок в месяцах — для расчёта еды (пусто — неизвестно)', t: 'num' },
    { k: 'dark', l: 'Чёрный юмор', t: 'check' },
    { t: 'heading', l: '🏁 Для финала' },
    { k: 'needs', l: 'Что особенно важно при этой катастрофе (0…+2)', t: 'needs', imp: true },
    { k: 'causes', l: '❗ Вызывает проблемы', t: 'probs' },
  ] },
  { f: 'conditions', label: 'Состояние бункера', icon: '🏚️', fields: [
    { k: 'text', l: 'Состояние', t: 'text', req: true },
    { k: 'desc', l: 'Описание', t: 'area' },
    { k: 'dark', l: 'Чёрный юмор', t: 'check' },
    { t: 'heading', l: '🏁 Для финала' },
    { k: 'needs', l: 'Что особенно важно в таком бункере (0…+2)', t: 'needs', imp: true },
    { k: 'causes', l: '❗ Вызывает проблемы', t: 'probs' },
  ] },
  { f: 'bunkers', label: 'Особенности бункера', icon: '🏗️', fields: [
    { k: 'text', l: 'Особенность', t: 'text', req: true },
    { k: 'desc', l: 'Описание', t: 'area' },
    { k: 'foodInfinite', l: '🍖 Бесконечная еда — перекрывает любую нужду в еде', t: 'check', re: true },
    { k: 'foodMonths', l: 'Меняет запас еды, месяцев (например 12 или -2)', t: 'num', showItem: x => !x.foodInfinite },
    { k: 'dark', l: 'Чёрный юмор', t: 'check' },
    ...FINAL_FIELDS,
  ] },
  { f: 'professions', label: 'Профессии', icon: '💼', color: '#3b82f6', hint: 'Стаж добавляется в игре автоматически.', fields: TRAIT_FIELDS },
  { f: 'biology', label: 'Биология', icon: '🧬', color: '#ec4899', hint: 'Начинайте с «Мужчина» или «Женщина», дополнение — через запятую. Возраст добавляется автоматически. Слово «бесплоден/бесплодна» учитывается в финале.', fields: TRAIT_FIELDS },
  { f: 'health', label: 'Здоровье', icon: '🩺', color: '#ef4444', fields: TRAIT_FIELDS },
  { f: 'hobbies', label: 'Хобби', icon: '🎨', color: '#f59e0b', fields: TRAIT_FIELDS },
  { f: 'phobias', label: 'Фобии', icon: '😱', color: '#8b5cf6', fields: TRAIT_FIELDS },
  { f: 'baggage', label: 'Багаж', icon: '🎒', color: '#10b981', fields: TRAIT_FIELDS },
  { f: 'facts', label: 'Факты', icon: '📜', color: '#78716c', fields: TRAIT_FIELDS },
  { f: 'characters', label: 'Характер', icon: '🎭', color: '#06b6d4', fields: TRAIT_FIELDS },
  { f: 'actions', label: 'Карты действий', icon: '🃏', color: '#7a5af8', main: 'title', fields: [
    { k: 'icon', l: 'Значок (эмодзи)', t: 'text', short: true },
    { k: 'title', l: 'Название', t: 'text', req: true },
    { k: 'text', l: 'Текст для игроков (если пусто — возьмётся описание действия)', t: 'area', gen: true },
    { k: 'effect.type', l: 'Тип карты', t: 'select', opts: E.KINDS, re: true },
    { k: 'effect.op', l: '① Действие', t: 'select', opts: E.OPS, re: true, show: ef => ef.type === 'change' },
    { k: 'effect.object', l: 'Что меняем', t: 'select', opts: E.OBJECTS, re: true, show: ef => ef.type === 'change' },
    { k: 'effect.key', l: 'Какая характеристика', t: 'select', opts: E.TRAIT_KEY_OPTS, re: true, show: E.needsKey },
    { k: 'effect.target', l: 'Кому', t: 'select', opts: E.TARGETS, re: true, show: ef => ef.type === 'change' && ef.object === 'trait' },
    { k: 'effect.mode', l: '② Какое значение', t: 'select', opts: ef => (ef.op === 'remove' ? E.MODES_REMOVE : E.MODES_ADD), re: true, show: E.hasModes },
    { k: 'effect.pool.source', l: 'Пул', t: 'select', re: true, show: E.usesPool,
      opts: ef => (ef.op === 'remove' ? [['random', 'Любое из имеющихся у цели'], ['preset', 'Только из заданного списка']] : E.POOL_SOURCES) },
    { k: 'effect.pool.items', l: 'Значения пула — отметьте из имеющихся', t: 'pick', show: ef => E.usesPool(ef) && ef.pool.source === 'preset' },
    { k: 'effect.pool.size', l: 'Сколько случайных вариантов набрать в пул', t: 'num', re: true, show: ef => E.usesPool(ef) && ef.pool.source === 'random' && ef.op !== 'remove' },
    { k: 'effect.value', l: 'Значение', t: 'text', re: true, list: true, show: ef => E.hasModes(ef) && ef.mode === 'fixed' },
    { k: 'effect.infinite', l: '🍖 Бесконечно — еды хватит на любой срок', t: 'check', re: true, show: ef => ef.type === 'change' && ef.object === 'food' && ef.op !== 'remove' },
    { k: 'effect.amount', l: 'Сколько (мест или месяцев еды)', t: 'num', re: true, show: ef => E.isNumeric(ef) && !ef.infinite },
    { k: 'id', l: 'ID (латиницей, уникальный)', t: 'id', req: true },
    { k: 'dark', l: 'Чёрный юмор', t: 'check' },
  ] },
];
const SEC = Object.fromEntries(SECTIONS.map(s => [s.f, s]));
const DRAFT_KEY = 'bunker.editor.draft.v1';

// ---------------- Состояние ----------------
const $ed = document.getElementById('ed');
let data = {};      // f -> массив
let orig = {};      // f -> строка JSON с сайта
let cur = 'catastrophes';
let query = '';
let opened = new Set();
let draftInfo = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ser = arr => JSON.stringify(arr.map(clean), null, 1);
const isChanged = f => ser(data[f] || []) !== orig[f];
const changedFiles = () => SECTIONS.map(s => s.f).filter(isChanged);

function getPath(o, path) { return path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o); }
function setPath(o, path, v) {
  const ks = path.split('.');
  let x = o;
  for (const k of ks.slice(0, -1)) { if (typeof x[k] !== 'object' || x[k] === null) x[k] = {}; x = x[k]; }
  x[ks[ks.length - 1]] = v;
}

// Чистка перед сохранением: убираем пустые необязательные поля
function clean(item) {
  const x = JSON.parse(JSON.stringify(item));
  if ('desc' in x && !String(x.desc || '').trim()) delete x.desc;
  if ('food' in x) { if (Number(x.food)) { x.needs = { ...(x.needs || {}) }; if (x.needs.food === undefined) x.needs.food = Number(x.food); } delete x.food; }
  if (x.needs && typeof x.needs === 'object') {
    for (const k of Object.keys(x.needs)) if (!Number(x.needs[k])) delete x.needs[k]; else x.needs[k] = Number(x.needs[k]);
    if (!Object.keys(x.needs).length) delete x.needs;
  }
  for (const k of ['solves', 'weak', 'causes']) if (Array.isArray(x[k]) && !x[k].length) delete x[k];
  if ('power' in x && !Number(x.power)) delete x.power;
  if ('foodLoss' in x && !Number(x.foodLoss)) delete x.foodLoss;
  if ('deadly' in x && !x.deadly) delete x.deadly;
  for (const k of ['name', 'solved', 'unsolved']) if (typeof x[k] === 'string') { x[k] = x[k].trim(); if (!x[k] && k !== 'name') delete x[k]; }
  if ('foodInfinite' in x && !x.foodInfinite) delete x.foodInfinite;
  if (x.foodInfinite) delete x.foodMonths;
  if ('foodMonths' in x && !Number(x.foodMonths)) delete x.foodMonths;
  if ('months' in x && (x.months === '' || x.months === undefined)) x.months = null;
  if ('icon' in x && !x.icon) delete x.icon;
  if (x.effect) x.effect = cleanEffect(x.effect);
  for (const k of ['text', 'title', 'desc', 'duration', 'id']) if (typeof x[k] === 'string') x[k] = x[k].trim();
  return x;
}

// Оставляем в эффекте только поля, нужные для выбранного типа
function cleanEffect(raw) {
  const e = JSON.parse(JSON.stringify(raw || {}));
  if (e.type !== 'change') {
    for (const k of ['op', 'object', 'target', 'mode', 'pool', 'value', 'amount']) delete e[k];
    if (!E.needsKey(e) || !e.key) delete e.key;
    return e;
  }
  if (e.object !== 'trait') { delete e.key; delete e.target; }
  if (!E.hasModes(e)) { delete e.mode; delete e.pool; delete e.value; }
  if (E.hasModes(e)) {
    if (e.mode !== 'fixed') delete e.value;
    if (!E.usesPool(e)) delete e.pool;
    else if (e.pool) {
      if (e.pool.source === 'preset') { delete e.pool.size; e.pool.items = (e.pool.items || []).map(v => String(v).trim()).filter(Boolean); }
      else delete e.pool.items;
      if (e.op === 'remove') delete e.pool.size;
    }
  }
  if (!E.isNumeric(e)) delete e.amount;
  if (e.object !== 'food' || e.op === 'remove' || !e.infinite) delete e.infinite;
  if (e.infinite) delete e.amount;
  return e;
}

function newItem(f) {
  if (f === 'catastrophes') return { title: '', text: '', duration: '', months: null, dark: false };
  if (f === 'tags') return { id: uniqueId('problem_' + Math.random().toString(36).slice(2, 5), -1), icon: '⚠️', name: '', need: 'morale', power: 1 };
  if (f === 'actions') return { id: uniqueId('card_' + Math.random().toString(36).slice(2, 6), -1, 'actions'), icon: '🃏', title: '', text: '', effect: { type: 'change', op: 'replace', object: 'trait', key: 'random', target: 'self', mode: 'random' }, dark: false };
  return { text: '', dark: false };
}

// ---------------- Загрузка и черновик ----------------
async function loadAll() {
  const res = await Promise.all(SECTIONS.map(async s => {
    const r = await fetch(`content/${s.f}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Не удалось загрузить content/${s.f}.json`);
    return [s.f, await r.json()];
  }));
  for (const [f, arr] of res) { orig[f] = JSON.stringify(arr, null, 1); data[f] = arr; }
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d && d.data) {
      const differs = SECTIONS.some(s => d.data[s.f] && JSON.stringify(d.data[s.f].map(clean), null, 1) !== orig[s.f]);
      if (differs) draftInfo = d;
    }
  } catch { /* нет черновика */ }
}

let saveTimer = null;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (changedFiles().length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ t: Date.now(), data }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* хранилище недоступно */ }
    updateCounters();
  }, 300);
}

// ---------------- Рендер ----------------
function render() {
  const sec = SEC[cur];
  const arr = data[cur] || [];
  const q = query.trim().toLowerCase();
  const idx = arr.map((x, i) => i).filter(i => !q || JSON.stringify(arr[i]).toLowerCase().includes(q));
  const ch = changedFiles();

  $ed.innerHTML = `
  <div class="ed-top">
    <a class="ed-back" href="./">← К игре</a>
    <h1>Редактор контента</h1>
  </div>
  <div class="wrap ed-wrap">
    ${draftInfo ? `<div class="ed-draft">
      Найден черновик от ${new Date(draftInfo.t).toLocaleString('ru-RU')}. Продолжить с ним?
      <div class="ed-draft-btns"><button class="btn small primary" data-a="draftUse">Продолжить</button><button class="btn small ghost" data-a="draftDrop">Начать с версии сайта</button></div>
    </div>` : ''}
    <p class="ed-note">Меняйте катастрофы, бункер, характеристики и карты действий. Черновик сохраняется в этом браузере.
    Чтобы изменения попали в игру, нажмите <b>«Скачать архив»</b> и распакуйте его в корень репозитория с заменой файлов.</p>

    <div class="ed-head">
      <button class="ed-menu-btn ${menuOpen ? 'open' : ''}" data-a="menu" aria-expanded="${menuOpen}">
        <span class="ed-menu-ico">${sec.icon}</span>
        <span class="ed-menu-txt"><span class="ed-menu-cap">Раздел</span><b>${esc(sec.label)}</b></span>
        <span class="ed-count">${arr.length}</span>
        <span class="ed-chev">▾</span>
      </button>
      <label class="btn small ed-file ed-open" title="Открыть архив набора (.zip)">📂 Архив<input type="file" accept=".zip,application/zip" id="ed-import-zip" hidden></label>
    </div>
    ${menuOpen ? menuHtml(ch) : ''}

    <div class="ed-bar">
      <input id="ed-q" type="search" placeholder="Поиск в разделе «${esc(sec.label)}»" value="${esc(query)}">
      <button class="btn small primary" data-a="add">+ Добавить</button>
    </div>
    ${sec.hint ? `<p class="ed-hint">💡 ${esc(sec.hint)}</p>` : ''}

    <div class="ed-list" style="${sec.color ? `--tc:${sec.color}` : ''}">
      ${idx.length ? idx.map(i => itemHtml(sec, arr[i], i)).join('') : `<p class="muted center">${q ? 'Ничего не найдено' : 'Пусто — добавьте первую запись'}</p>`}
    </div>

    <div class="ed-row ed-more">
      <button class="btn small ghost" data-a="json">Скачать «${esc(sec.label)}» (.json)</button>
      <label class="btn small ghost ed-file">Загрузить .json в раздел<input type="file" accept=".json,application/json" id="ed-import" hidden></label>
      <button class="btn small ghost" data-a="resetSec">Сбросить раздел</button>
      <button class="btn small ghost" data-a="resetAll">Сбросить всё</button>
    </div>
    <div class="ed-actions">
      <button class="btn primary" data-a="zip" id="ed-zip">⬇ Скачать архив${ch.length ? ` (изменено файлов: ${ch.length})` : ''}</button>
    </div>
  </div>
  <div class="ed-toast" id="ed-toast"></div>`;
}

const GROUPS = [
  ['Мир и бункер', ['catastrophes', 'conditions', 'bunkers']],
  ['Характеристики игроков', ['professions', 'biology', 'health', 'hobbies', 'phobias', 'baggage', 'facts', 'characters']],
  ['Карты и финал', ['actions', 'tags']],
];
let menuOpen = false;
function menuHtml(ch) {
  return `<div class="ed-menu">${GROUPS.map(([title, fs]) => `
    <div class="ed-menu-group"><div class="ed-menu-title">${title}</div>
      <div class="ed-menu-items">${fs.map(f => { const s = SEC[f]; return `
        <button class="ed-menu-item ${f === cur ? 'active' : ''}" data-a="sec" data-f="${f}" style="${s.color ? `--tc:${s.color}` : ''}">
          <span class="ed-menu-ico">${s.icon}</span><span class="ed-menu-name">${s.label}</span>
          <span class="ed-count">${(data[f] || []).length}</span>${ch.includes(f) ? '<span class="ed-dot" title="Есть изменения"></span>' : ''}
        </button>`; }).join('')}</div>
    </div>`).join('')}</div>`;
}

function badges(sec, x) {
  const b = [];
  if (x.dark) b.push('<span class="ed-b dark">чёрный юмор</span>');
  if (Number(x.food) > 0) b.push('<span class="ed-b food">🍖 еда</span>');
  if (Number(x.food) < 0) b.push('<span class="ed-b nofood">🍖 −еда</span>');
  if (x.foodInfinite) b.push('<span class="ed-b food">🍖 ∞ еда</span>');
  else if (Number(x.foodMonths)) b.push(`<span class="ed-b food">${x.foodMonths > 0 ? '+' : ''}${x.foodMonths} мес.</span>`);
  const nd = x.needs || {};
  const nv = NEEDS.filter(([id]) => Number(nd[id])).map(([id, ic]) => `${ic}${nd[id] > 0 ? '+' : ''}${nd[id]}`);
  if (Number(x.food) && !nd.food) nv.unshift(`🍖${x.food > 0 ? '+' : ''}${x.food}`);
  if (nv.length) b.push(`<span class="ed-b">${nv.join(' ')}</span>`);
  const ti = id => (data.tags || []).find(t => t.id === id)?.icon || '?';
  if ((x.solves || []).length) b.push(`<span class="ed-b food">✔${x.solves.map(ti).join('')}</span>`);
  if (sec.f !== 'tags' && (x.weak || []).length && Array.isArray(x.weak)) b.push(`<span class="ed-b nofood">⚠${x.weak.map(ti).join('')}</span>`);
  if ((x.causes || []).length) b.push(`<span class="ed-b dark">❗${x.causes.map(ti).join('')}</span>`);
  if (sec.f === 'tags' && x.deadly) b.push('<span class="ed-b dark">💀 смертельна</span>');
  if (x.desc) b.push('<span class="ed-b">описание</span>');
  return b.join('');
}

function summaryText(sec, x) {
  const main = sec.main ? x[sec.main] : x.text;
  const pre = sec.f === 'actions' || sec.f === 'tags' ? `${esc(x.icon || (sec.f === 'tags' ? '⚠️' : '🃏'))} ` : '';
  return `${pre}${main ? esc(main) : '<span class="muted">(пусто)</span>'}`;
}

function fieldHtml(f, x, i) {
  if (f.t === 'heading') return `<div class="ed-heading">${f.l}</div>`;
  const ef = E.normalizeEffect(x.effect || {});
  if (f.show && !f.show(ef)) return '';
  if (f.showItem && !f.showItem(x)) return '';
  const v = getPath(x, f.k);
  const id = `f-${i}-${f.k.replace(/\./g, '_')}`;
  const attrs = `id="${id}" data-i="${i}" data-k="${f.k}"`;
  if (f.t === 'check') return `<label class="row-check"><input type="checkbox" ${attrs} ${v ? 'checked' : ''}><span>${f.l}</span></label>`;
  let input;
  const opts = typeof f.opts === 'function' ? f.opts(ef) : f.opts;
  const cur = f.k.startsWith('effect.') ? getPath({ effect: ef }, f.k) : v;
  if (f.t === 'needs') {
    const nd = x.needs || {};
    const vals = f.imp ? [0, 1, 2] : [-2, -1, 0, 1, 2];
    const legacyFood = Number(x.food) && nd.food === undefined ? Number(x.food) : null;
    return `<div class="field"><span>${f.l}</span><div class="ed-needs">${NEEDS.map(([id, ic, nm]) => {
      const cv = legacyFood !== null && id === 'food' ? legacyFood : Number(nd[id] || 0);
      return `<label class="ed-need ${cv > 0 ? 'pos' : cv < 0 ? 'neg' : ''}"><span>${ic} ${nm}</span>
        <select data-i="${i}" data-k="needs.${id}">${vals.map(v => `<option value="${v}" ${v === cv ? 'selected' : ''}>${v > 0 ? '+' + v : v === 0 ? '0' : '−' + Math.abs(v)}</option>`).join('')}</select></label>`;
    }).join('')}</div></div>`;
  }
  if (f.t === 'probs') {
    const sel = new Set(Array.isArray(x[f.k]) ? x[f.k] : []);
    const tags = (data.tags || []).filter(t => t && t.id);
    if (!tags.length) return `<div class="field"><span>${f.l}</span><div class="ed-sub">Сначала создайте проблемы в разделе «Проблемы».</div></div>`;
    return `<div class="field"><span>${f.l}</span><div class="ed-probs">${tags.map(t => `
      <label class="ed-prob ${sel.has(t.id) ? 'on' : ''}" title="${esc(t.desc || '')}"><input type="checkbox" data-i="${i}" data-prob="${f.k}" value="${esc(t.id)}" ${sel.has(t.id) ? 'checked' : ''}>${esc(t.icon || '⚠️')} ${esc(t.name || t.id)}</label>`).join('')}</div></div>`;
  }
  if (f.t === 'id') {
    const dup = idDup(i);
    return `<label class="field"><span>${f.l} <span class="req">*</span></span>
      <span class="ed-id-row"><input type="text" ${attrs} value="${esc(v ?? '')}" spellcheck="false" autocomplete="off">
      <button type="button" class="btn small ghost" data-a="regenId" data-i="${i}" title="Сгенерировать новый ID">↻ Новый</button></span>
      <span class="ed-id-msg ${dup ? 'bad' : ''}" id="idmsg-${i}">${idMsg(i)}</span></label>`;
  }
  if (f.t === 'area') input = `<textarea ${attrs} rows="2" placeholder="${esc(f.ph || '')}">${esc(v ?? '')}</textarea>`;
  else if (f.t === 'pick') return `<div class="field"><span>${f.l}</span>${pickerHtml(ef, i, cur || [])}</div>`;
  else if (f.t === 'select') input = `<select ${attrs}>${opts.map(([val, lab]) => `<option value="${esc(val)}" ${String(cur ?? (f.num ? '0' : '')) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  else if (f.t === 'num') input = `<input type="number" inputmode="numeric" ${attrs} value="${cur === null || cur === undefined ? '' : esc(cur)}">`;
  else input = `<input type="text" ${attrs} value="${esc(cur ?? '')}" placeholder="${esc(f.ph || '')}" ${f.list ? `list="${listId(ef)}"` : ''}>${f.list ? suggestHtml(ef, true) : ''}`;
  const gen = f.gen ? ` <button type="button" class="ed-gen" data-a="gen" data-i="${i}">↻ взять из действия</button>` : '';
  return `<label class="field ${f.short ? 'short' : ''}"><span>${f.l}${f.req ? ' <span class="req">*</span>' : ''}${gen}</span>${input}</label>`;
}

// ID карт действий: латиница, уникальность, генерация
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
function slug(t) {
  return String(t || '').toLowerCase().split('').map(c => (c in TR ? TR[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
}
function idDup(i) {
  const id = String(data[cur]?.[i]?.id || '').trim();
  return !!id && (data[cur] || []).some((a, j) => j !== i && String(a.id || '').trim() === id);
}
function idMsg(i) {
  const id = String(data[cur]?.[i]?.id || '').trim();
  if (!id) return '⚠ ID обязателен';
  if (!/^[a-z0-9_]+$/i.test(id)) return '⚠ Только латиница, цифры и «_»';
  if (idDup(i)) return '⚠ Такой ID уже есть в этом разделе';
  return '✓ ID уникален';
}
function uniqueId(base, i, file = cur) {
  const taken = new Set((data[file] || []).filter((_, j) => j !== i).map(a => a.id));
  let id = base || 'card';
  if (!taken.has(id)) return id;
  for (let n = 2; n < 1000; n++) if (!taken.has(`${id}_${n}`)) return `${id}_${n}`;
  return `${id}_${Date.now().toString(36)}`;
}
function refreshIdMsgs() {
  if (!SEC[cur].fields.some(f => f.t === 'id')) return;
  document.querySelectorAll('[id^="idmsg-"]').forEach(el => {
    const i = +el.id.slice(6);
    el.textContent = idMsg(i);
    el.classList.toggle('bad', idMsg(i).startsWith('⚠'));
  });
}

// Выбор значений пула из уже имеющихся в разделе
function chipsHtml(i, items) {
  return `<div class="pick-chips">${items.length ? items.map(v => `<span class="pick-chip">${esc(v)}<button type="button" data-a="poolDel" data-i="${i}" data-v="${esc(v)}" aria-label="Убрать">×</button></span>`).join('') : '<span class="ed-sub">Пока ничего не выбрано</span>'}</div>`;
}
function pickerHtml(ef, i, items) {
  const file = fileFor(ef);
  if (!file) return '<div class="ed-sub">Сначала выберите конкретную характеристику — тогда появится список её значений.</div>';
  const vals = (data[file] || []).map(x => x.text).filter(Boolean);
  const sel = new Set(items);
  return `<div class="pick" data-i="${i}">
    ${chipsHtml(i, items)}
    <input type="search" class="pick-q" data-pick-q="${i}" placeholder="Поиск в «${esc(SEC[file]?.label || file)}» (${vals.length})">
    <div class="pick-list">${vals.map(v => `<label class="pick-row"><input type="checkbox" data-pick="${i}" value="${esc(v)}" ${sel.has(v) ? 'checked' : ''}><span>${esc(v)}</span></label>`).join('')}</div>
  </div>`;
}
function setPoolItems(i, items) {
  const item = data[cur][i];
  item.effect.pool = item.effect.pool || { source: 'preset' };
  item.effect.pool.items = items;
  const det = document.querySelector(`.ed-item[data-i="${i}"]`);
  if (det) {
    const chips = det.querySelector('.pick-chips');
    if (chips) chips.outerHTML = chipsHtml(i, items);
    det.querySelectorAll(`[data-pick="${i}"]`).forEach(cb => { cb.checked = items.includes(cb.value); });
    const pv = det.querySelector('.ed-preview'); if (pv) pv.outerHTML = previewHtml(item);
    det.querySelector('.ed-badges').innerHTML = badges(SEC[cur], item);
    det.classList.toggle('mod', changedItem(cur, i));
  }
  saveDraft();
}

// Подсказки значений из игры для пула и фиксированного значения
function fileFor(ef) {
  if (ef.object === 'feature') return 'bunkers';
  return { profession: 'professions', biology: 'biology', health: 'health', hobby: 'hobbies', phobia: 'phobias', baggage: 'baggage', fact: 'facts', character: 'characters' }[ef.key] || '';
}
const listId = ef => 'dl-' + (fileFor(ef) || 'none');
function suggestHtml(ef, asDatalist = false) {
  const file = fileFor(ef);
  if (!file) return asDatalist ? '' : '<span class="ed-sub">Выберите конкретную характеристику, чтобы видеть подсказки.</span>';
  const vals = (data[file] || []).map(x => x.text).filter(Boolean);
  if (asDatalist) return `<datalist id="${listId(ef)}">${vals.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
  return `<span class="ed-sub">Можно вписывать свои значения или существующие из раздела «${esc(SEC[file]?.label || file)}» (всего ${vals.length}).</span>`;
}

function itemHtml(sec, x, i) {
  return `<details class="ed-item ${changedItem(sec.f, i) ? 'mod' : ''}" data-i="${i}" ${opened.has(cur + ':' + i) ? 'open' : ''}>
    <summary><span class="ed-sum">${summaryText(sec, x)}</span><span class="ed-badges">${badges(sec, x)}</span></summary>
    <div class="ed-fields">
      ${sec.fields.map(f => fieldHtml(f, x, i)).join('')}
      ${sec.f === 'actions' ? `<div class="ed-preview"><b>Как сработает:</b> ${esc(E.describeEffect(x.effect))}${E.effectIssues(x.effect).length ? `<div class="ed-warn">⚠ ${esc(E.effectIssues(x.effect).join(', '))}</div>` : ''}</div>` : ''}
      <div class="ed-item-btns">
        <button class="btn small ghost" data-a="dup" data-i="${i}">Дублировать</button>
        <button class="btn small ghost danger-text" data-a="del" data-i="${i}">Удалить</button>
      </div>
    </div>
  </details>`;
}

// Изменена ли запись относительно версии сайта (простое сравнение по содержимому)
let origSets = {};
function changedItem(f, i) {
  if (!origSets[f]) origSets[f] = new Set(JSON.parse(orig[f]).map(x => JSON.stringify(clean(x))));
  return !origSets[f].has(JSON.stringify(clean(data[f][i])));
}

function updateCounters() {
  const ch = changedFiles();
  const mc = document.querySelector('.ed-menu-btn .ed-count');
  if (mc) mc.textContent = (data[cur] || []).length;
  document.querySelectorAll('.ed-menu-item').forEach(b => {
    const f = b.dataset.f;
    const dot = b.querySelector('.ed-dot');
    if (ch.includes(f) && !dot) b.insertAdjacentHTML('beforeend', '<span class="ed-dot" title="Есть изменения"></span>');
    if (!ch.includes(f) && dot) dot.remove();
    const cnt = b.querySelector('.ed-count');
    if (cnt) cnt.textContent = (data[f] || []).length;
  });
  const z = document.getElementById('ed-zip');
  if (z) z.textContent = `⬇ Скачать архив${ch.length ? ` (изменено файлов: ${ch.length})` : ''}`;
}

function toast(text) {
  const el = document.getElementById('ed-toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------------- Проверка и выгрузка ----------------
function validate() {
  const issues = [];
  for (const s of SECTIONS) {
    (data[s.f] || []).forEach((x, i) => {
      for (const f of s.fields) {
        if (f.req && !String(getPath(x, f.k) ?? '').trim()) issues.push(`${s.label}: запись №${i + 1} — не заполнено «${f.l}»`);
      }
    });
    if (!(data[s.f] || []).length) issues.push(`${s.label}: раздел пуст — в игре будет нечего выдавать`);
  }
  // ссылки на проблемы
  const tagIds = new Set((data.tags || []).map(t => t.id).filter(Boolean));
  const tagDup = (data.tags || []).map(t => t.id).filter((id, i, a) => id && a.indexOf(id) !== i);
  if (tagDup.length) issues.push(`Проблемы: повторяются ID — ${[...new Set(tagDup)].join(', ')}`);
  for (const s of SECTIONS) {
    if (s.f === 'tags') continue;
    (data[s.f] || []).forEach((x, i) => {
      for (const k of ['solves', 'weak', 'causes']) {
        if (!Array.isArray(x[k])) continue;
        const bad = x[k].filter(id => !tagIds.has(id));
        if (bad.length) issues.push(`${s.label}: «${x.title || x.text || '№' + (i + 1)}» ссылается на несуществующие проблемы: ${bad.join(', ')}`);
      }
    });
  }
  (data.actions || []).forEach((x, i) => {
    for (const msg of E.effectIssues(x.effect)) issues.push(`Карты действий: «${x.title || '№' + (i + 1)}» — ${msg}`);
    const ef = E.normalizeEffect(x.effect);
    if (E.usesPool(ef) && ef.pool.source === 'preset') {
      const ok = new Set((data[fileFor(ef)] || []).map(y => y.text));
      const bad = ef.pool.items.filter(v => !ok.has(v));
      if (bad.length) issues.push(`Карты действий: «${x.title || '№' + (i + 1)}» — в пуле есть значения, которых больше нет в игре: ${bad.join(', ')}`);
    }
  });
  const ids = (data.actions || []).map(a => a.id);
  const dup = ids.filter((id, i) => id && ids.indexOf(id) !== i);
  (data.actions || []).forEach((a, i) => { if (a.id && !/^[a-z0-9_]+$/i.test(a.id)) issues.push(`Карты действий: «${a.title || '№' + (i + 1)}» — ID «${a.id}» содержит недопустимые символы`); });
  if (dup.length) issues.push(`Карты действий: повторяются ID — ${[...new Set(dup)].join(', ')}`);
  return issues;
}

function confirmBox(title, lines, ok) {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'dlg-bg';
    el.innerHTML = `<div class="dlg"><h3>${esc(title)}</h3>
      <ul class="ed-issues">${lines.slice(0, 12).map(l => `<li>${esc(l)}</li>`).join('')}${lines.length > 12 ? `<li>…и ещё ${lines.length - 12}</li>` : ''}</ul>
      <div class="dlg-btns"><button class="btn ghost" data-r="0">Отмена</button><button class="btn primary" data-r="1">${esc(ok)}</button></div></div>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (b || e.target === el) { el.remove(); resolve(b?.dataset.r === '1'); }
    });
    document.body.appendChild(el);
  });
}

async function downloadZip() {
  const issues = validate();
  if (issues.length && !(await confirmBox('Есть замечания', issues, 'Всё равно скачать'))) return;
  const files = SECTIONS.map(s => ({ name: `content/${s.f}.json`, text: ser(data[s.f] || []) }));
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  downloadBlob(makeZip(files), `BunkIIr-content-${stamp}.zip`);
  toast('Архив скачан. Распакуйте его в корень репозитория с заменой.');
}

// ---------------- События ----------------
$ed.addEventListener('click', async e => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  const i = +b.dataset.i;
  if (a === 'menu') { menuOpen = !menuOpen; render(); }
  else if (a === 'sec') { cur = b.dataset.f; query = ''; menuOpen = false; render(); window.scrollTo(0, 0); }
  else if (a === 'add') {
    data[cur].unshift(newItem(cur));
    opened = new Set([...opened].map(k => { const [f, n] = k.split(':'); return f === cur ? `${f}:${+n + 1}` : k; }));
    opened.add(cur + ':0');
    query = '';
    render(); saveDraft();
    document.querySelector('.ed-item[data-i="0"] input, .ed-item[data-i="0"] textarea')?.focus();
  } else if (a === 'dup') {
    const copy = JSON.parse(JSON.stringify(data[cur][i]));
    if (cur === 'actions') copy.id = uniqueId((copy.id || 'card') + '_copy', -1);
    data[cur].splice(i + 1, 0, copy);
    opened.add(`${cur}:${i + 1}`);
    render(); saveDraft();
  } else if (a === 'del') {
    if (b.dataset.sure !== '1') {
      b.dataset.sure = '1'; b.textContent = 'Точно удалить?'; b.classList.add('sure');
      setTimeout(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = 'Удалить'; b.classList.remove('sure'); } }, 3000);
      return;
    }
    data[cur].splice(i, 1);
    opened = new Set();
    render(); saveDraft();
    toast('Запись удалена');
  } else if (a === 'regenId') {
    const item = data[cur][i];
    item.id = uniqueId(slug(item.title || item.name) || (cur === 'tags' ? 'problem' : 'card'), i);
    const inp = document.querySelector(`[data-i="${i}"][data-k="id"]`);
    if (inp) inp.value = item.id;
    refreshIdMsgs();
    const det = b.closest('.ed-item'); if (det) det.classList.toggle('mod', changedItem(cur, i));
    saveDraft();
  } else if (a === 'poolDel') {
    const items = (data[cur][i].effect.pool?.items || []).filter(v => v !== b.dataset.v);
    setPoolItems(i, items);
  } else if (a === 'gen') {
    const item = data[cur][i];
    item.text = E.describeEffect(item.effect);
    const det = b.closest('.ed-item');
    if (det) rerenderItem(det, i);
    saveDraft();
  } else if (a === 'zip') downloadZip();
  else if (a === 'json') {
    downloadBlob(new Blob([ser(data[cur])], { type: 'application/json' }), `${cur}.json`);
  } else if (a === 'resetSec') {
    if (!(await confirmBox(`Сбросить «${SEC[cur].label}»?`, ['Все изменения в этом разделе пропадут, вернётся версия с сайта.'], 'Сбросить'))) return;
    data[cur] = JSON.parse(orig[cur]); opened = new Set(); render(); saveDraft();
  } else if (a === 'resetAll') {
    if (!(await confirmBox('Сбросить всё?', ['Все изменения во всех разделах пропадут.'], 'Сбросить'))) return;
    for (const s of SECTIONS) data[s.f] = JSON.parse(orig[s.f]);
    opened = new Set(); render(); saveDraft();
  } else if (a === 'draftUse') {
    for (const s of SECTIONS) if (Array.isArray(draftInfo.data[s.f])) data[s.f] = draftInfo.data[s.f];
    draftInfo = null; render(); toast('Черновик загружен');
  } else if (a === 'draftDrop') {
    draftInfo = null;
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
    render();
  }
});

$ed.addEventListener('toggle', e => {
  const d = e.target;
  if (!d.classList?.contains('ed-item')) return;
  const key = cur + ':' + d.dataset.i;
  if (d.open) opened.add(key); else opened.delete(key);
}, true);

function onField(el, isChange = false) {
  const i = +el.dataset.i, k = el.dataset.k;
  const sec = SEC[cur];
  const f = sec.fields.find(x => x.k === k);
  const item = data[cur][i];
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (f && f.t === 'num') v = el.value === '' ? '' : Number(el.value);
  else if (f && f.num) v = Number(el.value);
  else if (k.startsWith('needs.')) v = Number(el.value);
  else v = el.value;
  setPath(item, k, v);
  if (k.startsWith('needs.')) {
    if ('food' in item) delete item.food; // старое поле еды переезжает в нужды
    const lab = el.closest('.ed-need');
    if (lab) { lab.classList.toggle('pos', v > 0); lab.classList.toggle('neg', v < 0); }
  }
  if (k === 'id') refreshIdMsgs();
  if (k.startsWith('effect.')) {
    E.fixDefaults(item.effect);
    // значения пула должны существовать в выбранном разделе
    const ef = item.effect;
    if (ef.pool && Array.isArray(ef.pool.items)) {
      const file = fileFor(ef);
      const ok = new Set((data[file] || []).map(x => x.text));
      ef.pool.items = file ? ef.pool.items.filter(v => ok.has(v)) : [];
    }
  }
  const det = el.closest('.ed-item');
  if (det) {
    det.querySelector('.ed-sum').innerHTML = summaryText(sec, item);
    det.querySelector('.ed-badges').innerHTML = badges(sec, item);
    det.classList.toggle('mod', changedItem(cur, i));
    // поля, от которых зависят другие, перерисовывают карточку (для текста — по завершении ввода)
    if (f && f.re && (el.tagName === 'SELECT' || el.type === 'checkbox' || isChange)) rerenderItem(det, i);
    else if (sec.f === 'actions') { const pv = det.querySelector('.ed-preview'); if (pv) pv.outerHTML = previewHtml(item); }
  }
  saveDraft();
}
function previewHtml(x) {
  const iss = E.effectIssues(x.effect);
  return `<div class="ed-preview"><b>Как сработает:</b> ${esc(E.describeEffect(x.effect))}${iss.length ? `<div class="ed-warn">⚠ ${esc(iss.join(', '))}</div>` : ''}</div>`;
}
let rerendering = false;
function rerenderItem(det, i) {
  if (rerendering || !det || !det.isConnected) return;
  rerendering = true;
  try { doRerender(det, i); } finally { rerendering = false; }
}
function doRerender(det, i) {
  const focusId = document.activeElement?.id;
  const tmp = document.createElement('div');
  tmp.innerHTML = itemHtml(SEC[cur], data[cur][i], i);
  const fresh = tmp.firstElementChild;
  fresh.open = true;
  det.replaceWith(fresh);
  if (focusId) document.getElementById(focusId)?.focus();
}

$ed.addEventListener('input', e => {
  if (e.target.dataset.pickQ !== undefined) {
    const q = e.target.value.trim().toLowerCase();
    e.target.closest('.pick').querySelectorAll('.pick-row').forEach(r => { r.style.display = !q || r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
    return;
  }
  if (e.target.id === 'ed-q') {
    query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = document.getElementById('ed-q');
    q.focus(); q.setSelectionRange(pos, pos);
    return;
  }
  if (e.target.dataset.k && e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox') onField(e.target);
});
$ed.addEventListener('change', async e => {
  if (e.target.dataset.prob) {
    const i = +e.target.dataset.i;
    const k = e.target.dataset.prob;
    const item = data[cur][i];
    const arr = new Set(Array.isArray(item[k]) ? item[k] : []);
    if (e.target.checked) arr.add(e.target.value); else arr.delete(e.target.value);
    item[k] = [...arr];
    e.target.closest('.ed-prob')?.classList.toggle('on', e.target.checked);
    const det = e.target.closest('.ed-item');
    if (det) { det.querySelector('.ed-badges').innerHTML = badges(SEC[cur], item); det.classList.toggle('mod', changedItem(cur, i)); }
    saveDraft();
    return;
  }
  if (e.target.dataset.pick !== undefined) {
    const i = +e.target.dataset.pick;
    const items = [...(data[cur][i].effect.pool?.items || [])];
    const v = e.target.value;
    if (e.target.checked && !items.includes(v)) items.push(v);
    if (!e.target.checked && items.includes(v)) items.splice(items.indexOf(v), 1);
    setPoolItems(i, items);
    return;
  }
  if (e.target.dataset.k && (e.target.type === 'checkbox' || e.target.tagName === 'SELECT')) onField(e.target);
  else if (e.target.dataset.k) onField(e.target, true);
  if (e.target.id === 'ed-import-zip') {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const entries = await readZip(await file.arrayBuffer());
      const loaded = [];
      for (const en of entries) {
        const f = en.name.split('/').pop().replace(/\.json$/i, '');
        if (!SEC[f]) continue;
        const arr = JSON.parse(en.text);
        if (Array.isArray(arr)) { data[f] = arr; loaded.push(SEC[f].label); }
      }
      if (!loaded.length) return toast('В архиве нет файлов контента');
      opened = new Set(); render(); saveDraft();
      toast(`Открыто: ${loaded.join(', ')}`);
    } catch (err) { toast('Не удалось открыть архив: ' + err.message); }
    return;
  }
  if (e.target.id === 'ed-import') {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const arr = JSON.parse(await file.text());
      if (!Array.isArray(arr)) throw new Error('В файле должен быть список (массив) записей');
      data[cur] = arr; opened = new Set(); render(); saveDraft();
      toast(`Загружено записей: ${arr.length}`);
    } catch (err) { toast('Не удалось прочитать файл: ' + err.message); }
  }
});

document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen) { menuOpen = false; render(); } });
document.addEventListener('click', e => {
  if (menuOpen && !e.target.closest('.ed-menu') && !e.target.closest('.ed-menu-btn')) { menuOpen = false; render(); }
});

window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer);
  try { if (changedFiles().length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ t: Date.now(), data })); } catch { /* */ }
});

loadAll().then(render).catch(err => {
  $ed.innerHTML = `<div class="wrap"><div class="err">Ошибка загрузки: ${esc(err.message)}</div><a class="btn" href="./">← К игре</a></div>`;
});
