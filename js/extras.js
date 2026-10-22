// Разнообразие: секретные цели, связи между игроками, события раунда, пресеты правил.
import { pool, shuffle, pick, aliveIds } from './logic.js?v=4.5';

const fill = (tpl, map) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => map[k] ?? '');
const NEED_NAMES = { food: 'Еда', medicine: 'Медицина', repair: 'Ремонт и техника', defense: 'Защита', morale: 'Мораль', reproduction: 'Продолжение рода' };
const TARGET_KINDS = ['with', 'keep_out', 'protect'];

// ---------- Пресеты правил ----------
export const PRESETS = {
  fast: {
    icon: '⚡', title: 'Быстрая', desc: 'Короткие таймеры, по 2 раскрытия, голосуем с 1-го раунда. Без целей, связей и событий.',
    set: {
      speechTime: 40, discussionTime: 60, voteTime: 30, resultTime: 6,
      firstRoundReveals: 2, revealsPerRound: 2, voteStartRound: 1, forceProfession: true,
      actionCards: true, actionsPerPlayer: 1, bunkerFeatures: 3,
      voteSecret: false, tieRule: 'random', exiledRevealsAll: true, skipCatchUp: false,
      goals: false, events: 'off', relations: 'off',
    },
  },
  classic: {
    icon: '🎲', title: 'Классика', desc: 'Обычный темп. Иногда случаются события раунда, у некоторых игроков есть связи.',
    set: {
      speechTime: 60, discussionTime: 120, voteTime: 45, resultTime: 10,
      firstRoundReveals: 1, revealsPerRound: 1, voteStartRound: 2, forceProfession: true,
      actionCards: true, actionsPerPlayer: 2, bunkerFeatures: 5,
      voteSecret: false, tieRule: 'revote', exiledRevealsAll: true, skipCatchUp: false,
      goals: false, events: 'some', relations: 'few', relationsPublic: false,
    },
  },
  hard: {
    icon: '🔥', title: 'Хардкор', desc: 'Тайное голосование, жребий при ничьей, больше карт. Секретные цели с предателем, события каждый раунд, связи у всех.',
    set: {
      speechTime: 50, discussionTime: 90, voteTime: 30, resultTime: 8,
      firstRoundReveals: 1, revealsPerRound: 1, voteStartRound: 2, forceProfession: true,
      actionCards: true, actionsPerPlayer: 3, bunkerFeatures: 6,
      voteSecret: true, tieRule: 'random', exiledRevealsAll: false, skipCatchUp: true,
      goals: true, goalsTraitor: 'maybe', events: 'every', relations: 'many', relationsPublic: false,
    },
  },
};
export function presetOf(s) {
  for (const [k, p] of Object.entries(PRESETS)) if (Object.entries(p.set).every(([key, v]) => s[key] === v)) return k;
  return '';
}

// ---------- Секретные цели ----------
export function assignGoals(playerIds, content, s) {
  const all = pool(content, 'goals', s);
  if (!all.length || playerIds.length < 2) return {};
  const normal = all.filter(x => x.kind !== 'traitor');
  const traitors = all.filter(x => x.kind === 'traitor');
  const out = {};
  let deck = shuffle(normal);
  let traitor = null;
  if (traitors.length && playerIds.length >= 4 && (s.goalsTraitor === 'always' || (s.goalsTraitor === 'maybe' && Math.random() < 0.5))) traitor = pick(playerIds);
  for (const p of playerIds) {
    let g;
    if (p === traitor) g = pick(traitors);
    else { if (!deck.length) deck = shuffle(normal); g = deck.pop(); }
    if (!g) continue;
    const goal = { id: g.id, icon: g.icon || '🎯', title: g.title || 'Секретная цель', text: g.text || '', kind: g.kind || 'survive' };
    if (g.need) goal.need = g.need;
    if (TARGET_KINDS.includes(goal.kind)) goal.target = pick(playerIds.filter(x => x !== p));
    out[p] = goal;
  }
  return out;
}
export function goalText(goal, nameOf) {
  if (!goal) return '';
  return fill(goal.text, { target: goal.target ? nameOf(goal.target) : 'кто-то', need: NEED_NAMES[goal.need] || goal.need || '' });
}
// Итог по целям; fin — результат makeFinal
export function evalGoals(g, cards, fin, nameOf) {
  const out = [];
  const lvl = fin?.verdict?.level;
  const needOk = id => (fin?.needs || []).some(n => n.id === id && n.status === 'ok');
  for (const p of g.players || []) {
    const goal = cards?.[p]?.goal;
    if (!goal) continue;
    const alive = !!g.alive?.[p], t = goal.target;
    let ok = false;
    switch (goal.kind) {
      case 'survive': ok = alive; break;
      case 'with': ok = alive && !!g.alive?.[t]; break;
      case 'keep_out': ok = !!t && !g.alive?.[t]; break;
      case 'protect': ok = !!g.alive?.[t]; break;
      case 'need': ok = aliveIds(g).length > 0 && needOk(goal.need); break;
      case 'traitor': ok = lvl === 'fell' || lvl === 'none'; break;
      default: ok = alive;
    }
    out.push({ pid: p, name: nameOf(p), icon: goal.icon, title: goal.title, text: goalText(goal, nameOf), ok, traitor: goal.kind === 'traitor' });
  }
  return out;
}

// ---------- Связи между игроками ----------
export function assignRelations(playerIds, content, s) {
  const all = pool(content, 'relations', s);
  if (!all.length || playerIds.length < 2 || !s.relations || s.relations === 'off') return [];
  const n = playerIds.length;
  const pairs = s.relations === 'many' ? Math.floor(n / 2) : Math.max(1, Math.round(n / 4));
  const ps = shuffle(playerIds);
  let deck = shuffle(all);
  const out = [];
  for (let i = 0; i < pairs && i * 2 + 1 < ps.length; i++) {
    if (!deck.length) deck = shuffle(all);
    const r = deck.pop();
    out.push({ id: r.id, icon: r.icon || '🤝', title: r.title || 'Связь', text: r.text || '', a: ps[i * 2], b: ps[i * 2 + 1] });
  }
  return out;
}
export const relText = (r, nameOf) => fill(r.text, { a: nameOf(r.a), b: nameOf(r.b) });

// ---------- События раунда ----------
export function pickEvent(content, s, usedIds = []) {
  const all = pool(content, 'events', s);
  if (!all.length) return null;
  const fresh = all.filter(e => !usedIds.includes(e.id));
  return pick(fresh.length ? fresh : all);
}
export function shouldHaveEvent(s, round) {
  if (!s.events || s.events === 'off' || round < 2) return false;
  return s.events === 'every' || Math.random() < 0.5;
}
