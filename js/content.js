// Загрузка контента из content/*.json
const FILES = ['conditions', 'professions', 'biology', 'health', 'hobbies', 'phobias', 'baggage', 'facts', 'characters', 'catastrophes', 'bunkers', 'actions'];
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
