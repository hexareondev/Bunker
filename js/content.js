// Загрузка контента из content/*.json и свои наборы карточек для лобби
import { readZip } from './zip.js?v=2.9';

export const FILES = ['tags', 'conditions', 'professions', 'biology', 'health', 'hobbies', 'phobias', 'baggage', 'facts', 'characters', 'catastrophes', 'bunkers', 'actions'];
export const FILE_LABELS = {
  tags: 'Проблемы (для финала)', catastrophes: 'Катастрофы', conditions: 'Состояния бункера', bunkers: 'Особенности бункера',
  professions: 'Профессии', biology: 'Биология', health: 'Здоровье', hobbies: 'Хобби', phobias: 'Фобии',
  baggage: 'Багаж', facts: 'Факты', characters: 'Характер', actions: 'Карты действий',
};
let cache = null;

export async function loadContent() {
  if (cache) return cache;
  const entries = await Promise.all(FILES.map(async f => {
    const r = await fetch(`content/${f}.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Не удалось загрузить content/${f}.json`);
    return [f, await r.json()];
  }));
  cache = Object.fromEntries(entries);
  return cache;
}

// Firebase может вернуть массив как объект с ключами 0,1,2…
export function toArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v && typeof v === 'object') return Object.keys(v).sort((a, b) => a - b).map(k => v[k]).filter(Boolean);
  return null;
}

// Стандартный контент + свой набор лобби
export function mergeContent(base, custom) {
  if (!base || !custom || !custom.files) return base;
  const out = { ...base };
  for (const f of FILES) {
    const arr = toArray(custom.files[f]);
    if (!arr || !arr.length) continue;
    out[f] = custom.mode === 'merge' ? [...(base[f] || []), ...arr] : arr;
  }
  return out;
}

// Разбор загруженных файлов: .zip из редактора или отдельные .json
export async function parseUpload(fileList) {
  const entries = [];
  for (const file of fileList) {
    if (/\.zip$/i.test(file.name)) entries.push(...await readZip(await file.arrayBuffer()));
    else entries.push({ name: file.name, text: await file.text() });
  }
  const files = {};
  const skipped = [];
  for (const e of entries) {
    const base = e.name.split('/').pop().replace(/\.json$/i, '');
    if (!FILES.includes(base)) { skipped.push(e.name); continue; }
    let arr;
    try { arr = JSON.parse(e.text); } catch { throw new Error(`Не удалось прочитать ${e.name}: это не JSON`); }
    if (!Array.isArray(arr)) throw new Error(`В ${e.name} должен быть список записей`);
    const clean = arr.filter(x => x && typeof x === 'object' && (x.text || x.title || x.id) && (base !== 'actions' || (x.effect && x.effect.type)));
    if (clean.length) files[base] = clean;
  }
  return { files, skipped };
}
