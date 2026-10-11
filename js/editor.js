import { makeZip, downloadBlob } from './zip.js?v=1.9';

// ---------------- Описание разделов ----------------
const FOOD = { t: 'select', opts: [['0', 'нет'], ['1', '🍖 помогает с едой'], ['-1', '🍖 −еда (нужно больше еды)']], num: true };
const TRAIT_FIELDS = [
  { k: 'text', l: 'Значение', t: 'text', req: true },
  { k: 'desc', l: 'Описание (необязательно)', t: 'area', ph: 'Чем это полезно или опасно в бункере' },
  { k: 'food', l: 'Связь с едой', ...FOOD },
  { k: 'dark', l: 'Чёрный юмор', t: 'check' },
];
const TRAIT_KEYS = [['', '— нет —'], ['random', 'случайная'], ['profession', 'Профессия'], ['biology', 'Биология'], ['health', 'Здоровье'], ['hobby', 'Хобби'], ['phobia', 'Фобия'], ['baggage', 'Багаж'], ['fact', 'Факт'], ['character', 'Характер']];
const EFFECTS = [
  ['reroll_self', 'Заменить свою характеристику на случайную'],
  ['reroll_target', 'Заменить характеристику выбранному игроку'],
  ['reroll_all', 'Заменить характеристику всем'],
  ['swap', 'Обменяться характеристикой с игроком'],
  ['shuffle_all', 'Перемешать характеристику у всех'],
  ['reveal_target', 'Раскрыть характеристику игрока'],
  ['set_target', 'Установить игроку значение (поле «Значение»)'],
  ['immunity', 'Иммунитет от голосов в этом раунде'],
  ['double_vote', 'Двойной голос в этом раунде'],
  ['cancel_vote', 'Сорвать текущее голосование'],
  ['extra_slot', '+1 место в бункере'],
  ['bunker_reveal', 'Открыть особенность бункера'],
  ['revive', 'Вернуть изгнанного игрока'],
];

const SECTIONS = [
  { f: 'catastrophes', label: 'Катастрофы', icon: '☄️', main: 'title', fields: [
    { k: 'title', l: 'Название', t: 'text', req: true },
    { k: 'text', l: 'Описание', t: 'area' },
    { k: 'duration', l: 'Сколько сидеть (текстом)', t: 'text', ph: 'например: 2 года' },
    { k: 'months', l: 'Срок в месяцах — для расчёта еды (пусто — неизвестно)', t: 'num' },
    { k: 'dark', l: 'Чёрный юмор', t: 'check' },
  ] },
  { f: 'conditions', label: 'Состояние бункера', icon: '🏚️', fields: [
    { k: 'text', l: 'Состояние', t: 'text', req: true },
    { k: 'desc', l: 'Описание', t: 'area' },
    { k: 'dark', l: 'Чёрный юмор', t: 'check' },
  ] },
  { f: 'bunkers', label: 'Особенности бункера', icon: '🏗️', fields: [
    { k: 'text', l: 'Особенность', t: 'text', req: true },
    { k: 'desc', l: 'Описание', t: 'area' },
    { k: 'food', l: 'Связь с едой', ...FOOD },
    { k: 'foodMonths', l: 'Меняет запас еды, месяцев (например 12 или -2)', t: 'num' },
    { k: 'dark', l: 'Чёрный юмор', t: 'check' },
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
    { k: 'text', l: 'Что делает (текст для игроков)', t: 'area', req: true },
    { k: 'effect.type', l: 'Действие', t: 'select', opts: EFFECTS },
    { k: 'effect.key', l: 'Какая характеристика', t: 'select', opts: TRAIT_KEYS },
    { k: 'effect.value', l: 'Значение (только для «Установить игроку значение»)', t: 'text' },
    { k: 'id', l: 'ID (латиницей, уникальный)', t: 'text', short: true, req: true },
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
  if ('food' in x && !Number(x.food)) delete x.food;
  if ('foodMonths' in x && !Number(x.foodMonths)) delete x.foodMonths;
  if ('months' in x && (x.months === '' || x.months === undefined)) x.months = null;
  if ('icon' in x && !x.icon) delete x.icon;
  if (x.effect) {
    if (!x.effect.key) delete x.effect.key;
    if (!x.effect.value) delete x.effect.value;
  }
  for (const k of ['text', 'title', 'desc', 'duration', 'id']) if (typeof x[k] === 'string') x[k] = x[k].trim();
  return x;
}

function newItem(f) {
  if (f === 'catastrophes') return { title: '', text: '', duration: '', months: null, dark: false };
  if (f === 'actions') return { id: 'custom_' + Date.now().toString(36), icon: '🃏', title: '', text: '', effect: { type: 'reroll_self', key: 'random' }, dark: false };
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

    <nav class="ed-secs">${SECTIONS.map(s => `<button class="${s.f === cur ? 'active' : ''}" data-a="sec" data-f="${s.f}">
      <span>${s.icon}</span>${s.label}<span class="ed-count">${(data[s.f] || []).length}</span>${ch.includes(s.f) ? '<span class="ed-dot" title="Есть изменения"></span>' : ''}</button>`).join('')}</nav>

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

function badges(sec, x) {
  const b = [];
  if (x.dark) b.push('<span class="ed-b dark">чёрный юмор</span>');
  if (Number(x.food) > 0) b.push('<span class="ed-b food">🍖 еда</span>');
  if (Number(x.food) < 0) b.push('<span class="ed-b nofood">🍖 −еда</span>');
  if (Number(x.foodMonths)) b.push(`<span class="ed-b food">${x.foodMonths > 0 ? '+' : ''}${x.foodMonths} мес.</span>`);
  if (x.desc) b.push('<span class="ed-b">описание</span>');
  return b.join('');
}

function summaryText(sec, x) {
  const main = sec.main ? x[sec.main] : x.text;
  const pre = sec.f === 'actions' ? `${esc(x.icon || '🃏')} ` : '';
  return `${pre}${main ? esc(main) : '<span class="muted">(пусто)</span>'}`;
}

function fieldHtml(f, x, i) {
  const v = getPath(x, f.k);
  const id = `f-${i}-${f.k.replace('.', '_')}`;
  const attrs = `id="${id}" data-i="${i}" data-k="${f.k}"`;
  if (f.t === 'check') return `<label class="row-check"><input type="checkbox" ${attrs} ${v ? 'checked' : ''}><span>${f.l}</span></label>`;
  let input;
  if (f.t === 'area') input = `<textarea ${attrs} rows="2" placeholder="${esc(f.ph || '')}">${esc(v ?? '')}</textarea>`;
  else if (f.t === 'select') input = `<select ${attrs}>${f.opts.map(([val, lab]) => `<option value="${esc(val)}" ${String(v ?? (f.num ? '0' : '')) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
  else if (f.t === 'num') input = `<input type="number" inputmode="numeric" ${attrs} value="${v === null || v === undefined ? '' : esc(v)}">`;
  else input = `<input type="text" ${attrs} value="${esc(v ?? '')}" placeholder="${esc(f.ph || '')}">`;
  return `<label class="field ${f.short ? 'short' : ''}"><span>${f.l}${f.req ? ' <span class="req">*</span>' : ''}</span>${input}</label>`;
}

function itemHtml(sec, x, i) {
  return `<details class="ed-item ${changedItem(sec.f, i) ? 'mod' : ''}" data-i="${i}" ${opened.has(cur + ':' + i) ? 'open' : ''}>
    <summary><span class="ed-sum">${summaryText(sec, x)}</span><span class="ed-badges">${badges(sec, x)}</span></summary>
    <div class="ed-fields">
      ${sec.fields.map(f => fieldHtml(f, x, i)).join('')}
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
  document.querySelectorAll('.ed-secs button').forEach(b => {
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
  const ids = (data.actions || []).map(a => a.id);
  const dup = ids.filter((id, i) => id && ids.indexOf(id) !== i);
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
  if (a === 'sec') { cur = b.dataset.f; query = ''; render(); window.scrollTo(0, 0); }
  else if (a === 'add') {
    data[cur].unshift(newItem(cur));
    opened = new Set([...opened].map(k => { const [f, n] = k.split(':'); return f === cur ? `${f}:${+n + 1}` : k; }));
    opened.add(cur + ':0');
    query = '';
    render(); saveDraft();
    document.querySelector('.ed-item[data-i="0"] input, .ed-item[data-i="0"] textarea')?.focus();
  } else if (a === 'dup') {
    const copy = JSON.parse(JSON.stringify(data[cur][i]));
    if (cur === 'actions') copy.id = (copy.id || 'card') + '_copy' + Date.now().toString(36).slice(-3);
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

function onField(el) {
  const i = +el.dataset.i, k = el.dataset.k;
  const sec = SEC[cur];
  const f = sec.fields.find(x => x.k === k);
  const item = data[cur][i];
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (f && f.t === 'num') v = el.value === '' ? '' : Number(el.value);
  else if (f && f.num) v = Number(el.value);
  else v = el.value;
  setPath(item, k, v);
  const det = el.closest('.ed-item');
  if (det) {
    det.querySelector('.ed-sum').innerHTML = summaryText(sec, item);
    det.querySelector('.ed-badges').innerHTML = badges(sec, item);
    det.classList.toggle('mod', changedItem(cur, i));
  }
  saveDraft();
}

$ed.addEventListener('input', e => {
  if (e.target.id === 'ed-q') {
    query = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const q = document.getElementById('ed-q');
    q.focus(); q.setSelectionRange(pos, pos);
    return;
  }
  if (e.target.dataset.k) onField(e.target);
});
$ed.addEventListener('change', async e => {
  if (e.target.dataset.k && (e.target.type === 'checkbox' || e.target.tagName === 'SELECT')) onField(e.target);
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

window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer);
  try { if (changedFiles().length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ t: Date.now(), data })); } catch { /* */ }
});

loadAll().then(render).catch(err => {
  $ed.innerHTML = `<div class="wrap"><div class="err">Ошибка загрузки: ${esc(err.message)}</div><a class="btn" href="./">← К игре</a></div>`;
});
