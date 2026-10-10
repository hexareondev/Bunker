// Чистая игровая логика «Бункера» — без Firebase и DOM.

export const TRAITS = [
  { key: 'profession', label: 'Профессия', file: 'professions' },
  { key: 'biology', label: 'Биология', file: 'biology' },
  { key: 'health', label: 'Здоровье', file: 'health' },
  { key: 'hobby', label: 'Хобби', file: 'hobbies' },
  { key: 'phobia', label: 'Фобия', file: 'phobias' },
  { key: 'baggage', label: 'Багаж', file: 'baggage' },
  { key: 'fact', label: 'Факт', file: 'facts' },
  { key: 'character', label: 'Характер', file: 'characters' },
];
export const TRAIT_KEYS = TRAITS.map(t => t.key);
export const traitLabel = k => (TRAITS.find(t => t.key === k) || {}).label || k;

export const DEFAULT_SETTINGS = {
  hostPlays: true,
  slots: 0,               // 0 — авто (половина игроков)
  ageMin: 18,
  ageMax: 80,
  darkHumor: true,
  forceProfession: true,  // в 1-м раунде первой раскрывается профессия
  firstRoundReveals: 1,
  revealsPerRound: 1,
  voteStartRound: 2,
  voteSecret: false,
  tieRule: 'revote',      // revote | random | none
  exiledRevealsAll: true,
  actionCards: true,
  actionsPerPlayer: 2,
  bunkerFeatures: 5,
  speechTime: 60,         // секунды, 0 — без таймера
  discussionTime: 120,
  voteTime: 45,
  resultTime: 10,
};

export const PHASE_NAMES = {
  start: 'Подготовка', speech: 'Речи игроков', discussion: 'Обсуждение',
  vote: 'Голосование', result: 'Итог голосования', end: 'Игра окончена',
};

// ---------- утилиты ----------
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a >= 11 && a <= 14) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
export const yearsWord = n => plural(n, 'год', 'года', 'лет');
export const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
export const pick = a => a[Math.floor(Math.random() * a.length)];
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export const defaultSlots = n => Math.max(1, Math.floor(n / 2));
export const textOf = x => (typeof x === 'string' ? x : x.text);

// Пул контента с учётом настройки чёрного юмора
export function pool(content, file, s) {
  const arr = content[file] || [];
  const f = s.darkHumor ? arr : arr.filter(x => !(x && x.dark));
  return f.length ? f : arr;
}

export function makeAge(s) {
  const a = Math.min(+s.ageMin || 18, +s.ageMax || 80);
  const b = Math.max(+s.ageMin || 18, +s.ageMax || 80);
  return randInt(a, b);
}

export function formatTrait(key, raw, age) {
  if (key === 'biology') {
    const [base, ...rest] = raw.split(',');
    const extra = rest.join(',').trim();
    return `${base.trim()}, ${age} ${yearsWord(age)}${extra ? ', ' + extra : ''}`;
  }
  if (key === 'profession') {
    const st = randInt(0, Math.max(0, Math.min(45, age - 18)));
    return st === 0 ? `${raw}, без стажа` : `${raw}, стаж ${st} ${yearsWord(st)}`;
  }
  return raw;
}

// Новая случайная характеристика (exclude — набор raw-значений, занятых другими)
export function makeTrait(key, content, s, age, exclude = new Set()) {
  const file = TRAITS.find(t => t.key === key).file;
  const p = pool(content, file, s).map(textOf);
  const fresh = p.filter(x => !exclude.has(x));
  const raw = pick(fresh.length ? fresh : p);
  return { raw, value: formatTrait(key, raw, age) };
}

// ---------- создание партии ----------
export function newGame(playerIds, content, settings, now) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const n = playerIds.length;
  let slots = s.slots > 0 ? Math.min(+s.slots, n - 1) : defaultSlots(n);
  slots = Math.max(1, slots);

  const decks = {};
  for (const t of TRAITS) decks[t.key] = shuffle(pool(content, t.file, s).map(textOf));
  const actDeck = shuffle(pool(content, 'actions', s));
  let ai = 0;

  const cards = {};
  playerIds.forEach((pid, i) => {
    const age = makeAge(s);
    const traits = {}, raw = {};
    for (const t of TRAITS) {
      const d = decks[t.key];
      const r = d[i % d.length];
      raw[t.key] = r;
      traits[t.key] = formatTrait(t.key, r, age);
    }
    const actions = [];
    if (s.actionCards && actDeck.length) {
      for (let k = 0; k < (+s.actionsPerPlayer || 0); k++) {
        const a = actDeck[ai++ % actDeck.length];
        actions.push(JSON.parse(JSON.stringify({ id: a.id, title: a.title, text: a.text, effect: a.effect, used: false })));
      }
    }
    cards[pid] = { age, traits, raw, actions };
  });

  const cat = pick(pool(content, 'catastrophes', s));
  const features = shuffle(pool(content, 'bunkers', s)).slice(0, Math.max(1, +s.bunkerFeatures || 5)).map(textOf);

  const game = {
    version: 0, round: 0, phase: 'start', turn: 0, order: [],
    phaseEndsAt: 0, paused: 0, settings: s, slots,
    players: [...playerIds],
    alive: Object.fromEntries(playerIds.map(p => [p, true])),
    revealed: {}, revealedRound: {}, votes: {}, effects: {},
    catastrophe: { title: cat.title, text: cat.text || '', duration: cat.duration || 'неизвестно' },
    bunker: { size: randInt(60, 450), features, shown: 0 },
    event: '',
  };
  startRound(game, now);
  game.event = 'Игра началась. Раунд 1';
  return { cards, game };
}

// ---------- состояние ----------
export function norm(g) {
  if (!g) return g;
  g.order = g.order || [];
  g.players = g.players || [];
  g.alive = g.alive || {};
  g.revealed = g.revealed || {};
  g.revealedRound = g.revealedRound || {};
  g.votes = g.votes || {};
  g.effects = g.effects || {};
  g.effects.immune = g.effects.immune || {};
  g.effects.double = g.effects.double || {};
  g.candidates = g.candidates || null;
  g.bunker = g.bunker || {};
  g.bunker.features = g.bunker.features || [];
  g.bunker.shown = g.bunker.shown || 0;
  g.settings = { ...DEFAULT_SETTINGS, ...(g.settings || {}) };
  g.turn = g.turn || 0;
  g.round = g.round || 0;
  g.version = g.version || 0;
  g.paused = g.paused || 0;
  g.phaseEndsAt = g.phaseEndsAt || 0;
  return g;
}

export const aliveIds = g => g.players.filter(p => g.alive[p]);
export const hiddenKeys = (g, pid) => TRAIT_KEYS.filter(k => !(g.revealed[pid] || {})[k]);
export const currentSpeaker = g => (g.phase === 'speech' ? g.order[g.turn] || null : null);

export function revealsRequired(g) {
  return g.round === 1 ? +g.settings.firstRoundReveals : +g.settings.revealsPerRound;
}
// Сколько ещё нужно раскрыть игроку в этом раунде
export function revealsLeft(g, pid) {
  const done = g.revealedRound[pid] || 0;
  return Math.max(0, Math.min(revealsRequired(g) - done, hiddenKeys(g, pid).length));
}
// Можно ли раскрыть именно эту характеристику сейчас
export function canReveal(g, pid, key) {
  if (currentSpeaker(g) !== pid) return false;
  if ((g.revealed[pid] || {})[key]) return false;
  if (revealsLeft(g, pid) <= 0) return false;
  const hid = hiddenKeys(g, pid);
  if (g.round === 1 && g.settings.forceProfession && hid.includes('profession') && key !== 'profession') return false;
  return true;
}

function autoReveal(g, pid) {
  g.revealed[pid] = g.revealed[pid] || {};
  const opened = [];
  while (revealsLeft(g, pid) > 0) {
    const hid = hiddenKeys(g, pid);
    const k = g.round === 1 && g.settings.forceProfession && hid.includes('profession') ? 'profession' : pick(hid);
    g.revealed[pid][k] = true;
    g.revealedRound[pid] = (g.revealedRound[pid] || 0) + 1;
    opened.push(traitLabel(k));
  }
  return opened;
}

const PHASE_TIMER = { speech: 'speechTime', discussion: 'discussionTime', vote: 'voteTime', result: 'resultTime' };
function setPhase(g, phase, now) {
  g.phase = phase;
  const sec = PHASE_TIMER[phase] ? +g.settings[PHASE_TIMER[phase]] || 0 : 0;
  g.phaseEndsAt = sec > 0 ? now + sec * 1000 : 0;
  g.paused = 0;
}

function startRound(g, now) {
  g.round++;
  const alive = aliveIds(g);
  const shift = alive.length ? (g.round - 1) % alive.length : 0;
  g.order = alive.slice(shift).concat(alive.slice(0, shift));
  g.turn = 0;
  g.revealedRound = {};
  g.votes = {};
  g.candidates = null;
  g.revoteDone = false;
  g.lastResult = null;
  g.bunker.shown = Math.min(g.bunker.features.length, (g.bunker.shown || 0) + 1);
  setPhase(g, 'speech', now);
  g.event = `Раунд ${g.round}`;
}

export function endGame(g) {
  norm(g);
  g.phase = 'end';
  g.phaseEndsAt = 0;
  g.paused = 0;
  for (const p of g.players) {
    g.revealed[p] = g.revealed[p] || {};
    for (const k of TRAIT_KEYS) g.revealed[p][k] = true;
  }
  g.bunker.shown = g.bunker.features.length;
  g.event = 'Игра окончена';
  return g;
}

export function needsVote(g) {
  return g.round >= (+g.settings.voteStartRound || 1) && aliveIds(g).length > g.slots;
}

// Кого игрок может выбрать в голосовании
export function voteTargets(g, voter) {
  const base = g.candidates || aliveIds(g);
  return base.filter(p => p !== voter && g.alive[p] && g.effects.immune[p] !== g.round);
}

export function allVoted(g) {
  const voters = aliveIds(g);
  return voters.length > 0 && voters.every(p => g.votes[p]);
}

export function tally(g) {
  const counts = {};
  for (const [voter, target] of Object.entries(g.votes)) {
    if (!target || target === 'abstain') continue;
    if (!g.alive[voter] || !g.alive[target] || voter === target) continue;
    if (g.effects.immune[target] === g.round) continue;
    if (g.candidates && !g.candidates.includes(target)) continue;
    counts[target] = (counts[target] || 0) + (g.effects.double[voter] === g.round ? 2 : 1);
  }
  const max = Math.max(0, ...Object.values(counts));
  const leaders = max > 0 ? Object.keys(counts).filter(k => counts[k] === max) : [];
  return { counts, leaders };
}

function resolveVote(g, now) {
  const s = g.settings;
  if (g.effects.cancelVote === g.round) {
    g.lastResult = { exiled: null, counts: {}, note: 'Голосование сорвано картой «Саботаж»' };
    g.event = g.lastResult.note;
    setPhase(g, 'result', now);
    return;
  }
  const { counts, leaders } = tally(g);
  let exiled = null, note = '';
  if (leaders.length === 0) note = 'Никто не проголосовал — изгнания нет';
  else if (leaders.length === 1) exiled = leaders[0];
  else if (s.tieRule === 'revote' && !g.revoteDone) {
    g.revoteDone = true;
    g.candidates = leaders;
    g.votes = {};
    g.lastResult = { exiled: null, counts, note: 'Ничья — переголосование между лидерами' };
    g.event = 'Ничья — переголосование';
    setPhase(g, 'vote', now);
    return;
  } else if (s.tieRule === 'none') note = 'Ничья — никто не изгнан';
  else { exiled = pick(leaders); note = 'Ничья — изгнанный выбран жребием'; }

  if (exiled) {
    g.alive[exiled] = false;
    if (s.exiledRevealsAll) {
      g.revealed[exiled] = g.revealed[exiled] || {};
      for (const k of TRAIT_KEYS) g.revealed[exiled][k] = true;
    }
  }
  g.lastResult = { exiled, counts, note };
  g.event = exiled ? `Изгнан(а): @${exiled}@${note ? ' (' + note + ')' : ''}` : note;
  setPhase(g, 'result', now);
}

// Переход к следующему этапу. Мутирует и возвращает g.
export function advance(g, now) {
  norm(g);
  g.event = '';
  switch (g.phase) {
    case 'start':
      startRound(g, now);
      break;
    case 'speech': {
      const sp = g.order[g.turn];
      const opened = sp && g.alive[sp] ? autoReveal(g, sp) : [];
      if (opened.length) g.event = `@${sp}@: время вышло, автоматически раскрыто — ${opened.join(', ')}`;
      g.turn++;
      while (g.turn < g.order.length && !g.alive[g.order[g.turn]]) g.turn++;
      setPhase(g, g.turn >= g.order.length ? 'discussion' : 'speech', now);
      break;
    }
    case 'discussion':
      if (aliveIds(g).length <= g.slots) endGame(g);
      else if (needsVote(g)) {
        g.votes = {}; g.candidates = null; g.revoteDone = false;
        setPhase(g, 'vote', now);
        g.event = 'Начинается голосование';
      } else startRound(g, now);
      break;
    case 'vote':
      resolveVote(g, now);
      break;
    case 'result':
      if (aliveIds(g).length <= g.slots) endGame(g);
      else startRound(g, now);
      break;
    default:
      break;
  }
  g.version++;
  return g;
}

// ---------- финальная история ----------
const lc = s => (s ? s[0].toLowerCase() + s.slice(1) : s);
const STORY = {
  profession: (n, v) => `${n}: профессия «${lc(v)}» пригодилась уже в первые недели.`,
  health: (n, v) => `${n}: здоровье — «${lc(v)}» — стало постоянной заботой всей группы.`,
  hobby: (n, v) => `${n}: хобби «${lc(v)}» не давало остальным сойти с ума от скуки.`,
  phobia: (n, v) => `${n}: фобия — «${lc(v)}» — не раз ставила под угрозу общий покой.`,
  baggage: (n, v) => `${n}: багаж «${lc(v)}» неожиданно оказался очень к месту.`,
  fact: (n, v) => `${n}: со временем всплыл важный факт — «${lc(v)}».`,
  character: (n, v) => `${n}: характер — «${lc(v)}» — влиял на атмосферу в бункере сильнее, чем хотелось бы.`,
};

export function makeStory(g, cards, names) {
  norm(g);
  const surv = aliveIds(g);
  const c = g.catastrophe || {};
  const nm = p => names[p] || 'игрок';
  const out = [];
  out.push(`${c.title}. ${c.text} В бункере площадью ${g.bunker.size} м² укрылись ${surv.length} ${plural(surv.length, 'человек', 'человека', 'человек')}: ${surv.map(nm).join(', ')}. Продержаться под землёй предстояло: ${c.duration}.`);

  let keys = [];
  const lines = shuffle(surv).map(p => {
    if (!keys.length) keys = shuffle(Object.keys(STORY));
    const k = keys.pop();
    return STORY[k](nm(p), (cards[p]?.traits || {})[k] || '');
  });
  if (lines.length) out.push(lines.join(' '));

  const shown = g.bunker.features.slice(0, g.bunker.shown || g.bunker.features.length);
  if (shown.length) out.push(`Из того, что было в бункере, сильнее всего повлияло: ${lc(pick(shown))}.`);

  const bios = surv.map(p => (cards[p]?.raw || {}).biology || '');
  const fertile = b => !/бесплод/i.test(b);
  const men = bios.some(b => /^Мужчина/.test(b) && fertile(b));
  const women = bios.some(b => /^Женщина/.test(b) && fertile(b));
  if (men && women) out.push('Когда двери бункера наконец открылись, выжившие вышли наружу. Среди них есть те, кто может продолжить род, — у человечества есть шанс начать всё заново.');
  else if (surv.length) out.push('Двери бункера открылись, и выжившие увидели новый мир. Вот только продолжить род в этой компании некому — похоже, человечество закончится на них.');
  else out.push('В бункер не попал никто. Человечество проиграло.');
  return out;
}
