// Составные эффекты карт действий — общий модуль для игры и редактора.
//
// Составной эффект:
// { type: 'change',
//   op: 'add' | 'remove' | 'replace',
//   object: 'trait' | 'feature' | 'slots' | 'food',
//   key: 'profession' | … | 'random',            — для object = trait
//   target: 'self' | 'player' | 'all' | 'random_player', — для object = trait
//   mode: 'random' | 'pool_random' | 'pool_choice' | 'fixed', — для trait и feature
//   pool: { source: 'preset' | 'random', items: [..], size: 3 },
//   value: 'текст',                               — для mode = fixed
//   amount: 1 }                                   — для slots и food
//
// Особые эффекты: swap, shuffle_all, reveal_target, immunity, double_vote, cancel_vote, bunker_reveal, revive,
// give (отдать свою характеристику), peek (тайно подсмотреть), block_reveal (запрет раскрываться), steal_card, protect, peek_goal.
// Только для событий раунда: none (без последствий), extra_reveal (всем +N раскрытий в раунде).

export const TRAIT_LABELS = {
  profession: 'Профессия', biology: 'Биология', health: 'Здоровье', hobby: 'Хобби',
  phobia: 'Фобия', baggage: 'Багаж', fact: 'Факт', character: 'Характер',
};
// Винительный падеж для текстов «заменяет профессию»
const TRAIT_ACC = {
  profession: 'профессию', biology: 'биологию', health: 'здоровье', hobby: 'хобби',
  phobia: 'фобию', baggage: 'багаж', fact: 'факт', character: 'характер',
};

export const KINDS = [
  ['change', 'Изменение: добавить / убрать / заменить'],
  ['swap', 'Обмен характеристикой с игроком'],
  ['give', 'Отдать свою характеристику игроку'],
  ['shuffle_all', 'Перемешать характеристику у всех'],
  ['reveal_target', 'Раскрыть характеристику игрока'],
  ['immunity', 'Иммунитет от голосов в этом раунде'],
  ['double_vote', 'Двойной голос в этом раунде'],
  ['cancel_vote', 'Сорвать текущее голосование'],
  ['bunker_reveal', 'Открыть скрытую особенность бункера'],
  ['revive', 'Вернуть изгнанного игрока'],
  ['peek', 'Тайно подсмотреть характеристику игрока'],
  ['block_reveal', 'Запретить игроку раскрываться в этом раунде'],
  ['steal_card', 'Украсть карту действия у игрока'],
  ['protect', 'Защитить игрока от голосов в этом раунде'],
  ['peek_goal', 'Тайно узнать секретную цель игрока'],
];
// Последствия событий раунда
export const EVENT_KINDS = [
  ['none', 'Без последствий — только история'],
  ['change', 'Изменение: добавить / убрать / заменить'],
  ['swap', 'Два случайных игрока меняются характеристикой'],
  ['shuffle_all', 'Перемешать характеристику у всех'],
  ['reveal_target', 'Раскрыть характеристику случайного игрока'],
  ['bunker_reveal', 'Открыть скрытую особенность бункера'],
  ['revive', 'Вернуть случайного изгнанного'],
  ['cancel_vote', 'В этом раунде голосования не будет'],
  ['extra_reveal', 'Все раскрывают больше характеристик в этом раунде'],
  ['immunity', 'Случайный игрок получает иммунитет от голосов'],
  ['double_vote', 'Случайный игрок голосует дважды'],
];
export const EVENT_TARGETS = [['random_player', 'Случайному игроку'], ['all', 'Всем игрокам']];
// Когда карту можно сыграть
export const WHEN_OPTS = [
  ['alive', 'Только пока игрок в бункере'],
  ['any', 'И в игре, и после изгнания'],
  ['exiled', 'Только после изгнания (посмертная)'],
  ['auto', 'Срабатывает сама, когда владельца изгоняют'],
];
export function whenText(w) {
  return { any: 'Можно сыграть и после изгнания.', exiled: 'Играется только после изгнания.', auto: 'Сработает сама, если вас изгонят (цель и вариант выбираются случайно).' }[w] || '';
}
export const whenTag = w => ({ any: 'и после изгнания', exiled: 'посмертная', auto: 'при изгнании' }[w] || '');
export const OPS = [['add', 'Добавить'], ['remove', 'Убрать'], ['replace', 'Заменить']];
export const OBJECTS = [['trait', 'Характеристику игрока'], ['feature', 'Особенность бункера'], ['slots', 'Места в бункере'], ['food', 'Запас еды (месяцев)']];
export const TARGETS = [['self', 'Себе'], ['player', 'Выбранному игроку'], ['all', 'Всем игрокам'], ['random_player', 'Случайному игроку']];
export const MODES_ADD = [
  ['random', 'Случайно из всей игры'],
  ['pool_random', 'Случайно из пула'],
  ['pool_choice', 'Игрок выбирает из пула'],
  ['fixed', 'Заранее заданное значение'],
];
export const MODES_REMOVE = [
  ['random', 'Случайное из имеющихся'],
  ['pool_random', 'Случайное из имеющихся, но только из пула'],
  ['pool_choice', 'Игрок выбирает, что убрать'],
  ['fixed', 'Конкретное значение'],
];
export const POOL_SOURCES = [['random', 'Случайный набор из игры'], ['preset', 'Заданный список']];
export const TRAIT_KEY_OPTS = [['random', 'Случайная характеристика'], ...Object.entries(TRAIT_LABELS)];

// Перевод старых типов карт в составные
export function normalizeEffect(e) {
  e = JSON.parse(JSON.stringify(e || {}));
  switch (e.type) {
    case 'reroll_self': return { type: 'change', op: 'replace', object: 'trait', key: e.key || 'random', target: 'self', mode: 'random' };
    case 'reroll_target': return { type: 'change', op: 'replace', object: 'trait', key: e.key || 'random', target: 'player', mode: 'random' };
    case 'reroll_all': return { type: 'change', op: 'replace', object: 'trait', key: e.key || 'random', target: 'all', mode: 'random' };
    case 'set_target': return { type: 'change', op: 'replace', object: 'trait', key: e.key || 'health', target: 'player', mode: 'fixed', value: e.value || '' };
    case 'extra_slot': return { type: 'change', op: 'add', object: 'slots', amount: 1 };
    default: break;
  }
  if (e.type === 'extra_reveal') e.amount = Math.max(1, +e.amount || 1);
  if (e.type === 'change') {
    e.op = e.op || 'replace';
    e.object = e.object || 'trait';
    if (e.object === 'trait') { e.key = e.key || 'random'; e.target = e.target || 'self'; }
    if (e.object === 'trait' || e.object === 'feature') {
      e.mode = e.mode || 'random';
      if (e.mode === 'pool_random' || e.mode === 'pool_choice') {
        e.pool = e.pool || {};
        e.pool.source = e.pool.source || 'random';
        e.pool.items = Array.isArray(e.pool.items) ? e.pool.items : [];
        e.pool.size = Math.max(1, +e.pool.size || 3);
      }
    }
    if (e.object === 'slots' || e.object === 'food') e.amount = Math.max(0, +e.amount || 1);
    if (e.object !== 'food' || e.op === 'remove') delete e.infinite;
  }
  return e;
}

// Подставить значения по умолчанию после смены полей в редакторе
export function fixDefaults(e) {
  const n = normalizeEffect(e);
  for (const k of Object.keys(e)) delete e[k];
  Object.assign(e, n);
  return e;
}

export const usesPool = e => e.type === 'change' && (e.mode === 'pool_random' || e.mode === 'pool_choice');
export const hasModes = e => e.type === 'change' && (e.object === 'trait' || e.object === 'feature');
export const isNumeric = e => (e.type === 'change' && (e.object === 'slots' || e.object === 'food')) || e.type === 'extra_reveal';
export const needsKey = e => (e.type === 'change' && e.object === 'trait') || ['swap', 'give', 'shuffle_all', 'reveal_target', 'peek'].includes(e.type);
export const needsPlayer = e => ['swap', 'give', 'reveal_target', 'revive', 'peek', 'block_reveal', 'steal_card', 'protect', 'peek_goal'].includes(e.type) || (e.type === 'change' && e.object === 'trait' && e.target === 'player');
export const needsChoice = e => e.type === 'change' && hasModes(e) && e.mode === 'pool_choice';

function listText(items, max = 4) {
  const a = (items || []).filter(Boolean);
  if (!a.length) return '(список пуст)';
  return a.slice(0, max).map(x => `«${x}»`).join(', ') + (a.length > max ? ` и ещё ${a.length - max}` : '');
}

// Человеческое описание эффекта
export function describeEffect(raw) {
  const e = normalizeEffect(raw);
  const months = n => `${n} мес.`;
  switch (e.type) {
    case 'swap': return `Обменяться характеристикой «${keyText(e.key)}» с выбранным игроком.`;
    case 'give': return `Отдать свою характеристику «${keyText(e.key)}» выбранному игроку: она добавляется к его собственной, а у вас не остаётся ничего.`;
    case 'shuffle_all': return `Перемешать характеристику «${keyText(e.key)}» у всех оставшихся игроков.`;
    case 'reveal_target': return `Раскрыть ${e.key && e.key !== 'random' ? `«${TRAIT_LABELS[e.key]}»` : 'случайную скрытую характеристику'} выбранного игрока.`;
    case 'immunity': return 'В этом раунде голоса против вас не засчитываются.';
    case 'double_vote': return 'В этом раунде ваш голос считается за два.';
    case 'cancel_vote': return 'Срывает текущее голосование.';
    case 'bunker_reveal': return 'Открывает следующую скрытую особенность бункера.';
    case 'revive': return 'Возвращает в игру одного изгнанного игрока.';
    case 'peek': return `Тайно посмотреть ${e.key && e.key !== 'random' ? `«${TRAIT_LABELS[e.key]}»` : 'одну скрытую характеристику'} выбранного игрока — увидите только вы.`;
    case 'block_reveal': return 'Выбранный игрок не может раскрывать характеристики в этом раунде.';
    case 'steal_card': return 'Заберите у выбранного игрока случайную неиспользованную карту действия.';
    case 'protect': return 'Голоса против выбранного игрока в этом раунде не засчитываются.';
    case 'peek_goal': return 'Тайно узнайте секретную цель выбранного игрока.';
    case 'none': return 'Без последствий — просто событие для атмосферы.';
    case 'extra_reveal': return `В этом раунде каждый раскрывает на ${Math.max(1, +e.amount || 1)} ${(+e.amount || 1) === 1 ? 'характеристику' : 'характеристики'} больше.`;
    case 'change': break;
    default: return 'Неизвестное действие.';
  }
  const places = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'место' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'места' : 'мест'}`;
  if (e.object === 'slots') return { add: `+${places(e.amount)} в бункере.`, remove: `−${places(e.amount)} в бункере (минимум 1 останется).`, replace: `В бункере становится ${places(e.amount)}.` }[e.op];
  if (e.object === 'food' && e.infinite) return 'Запас еды становится бесконечным — голод больше не грозит.';
  if (e.object === 'food') return { add: `+${months(e.amount)} запаса еды в бункере.`, remove: `−${months(e.amount)} запаса еды в бункере.`, replace: `Запас еды становится ${months(e.amount)}.` }[e.op];

  const who = { self: 'себе', player: 'выбранному игроку', all: 'всем игрокам', random_player: 'случайному игроку' }[e.target] || '';
  const what = e.object === 'feature' ? 'особенность бункера' : (e.key === 'random' ? 'случайную характеристику' : TRAIT_ACC[e.key] || 'характеристику');
  const poolTxt = e.pool?.source === 'preset' ? `из списка ${listText(e.pool.items)}` : `из ${e.pool?.size || 3} случайных вариантов`;

  if (e.op === 'remove') {
    const whoGen = { self: 'у себя', player: 'у выбранного игрока', all: 'у всех игроков', random_player: 'у случайного игрока' }[e.target] || '';
    const from = e.object === 'feature' ? 'Убирает из бункера' : `Убирает ${whoGen}`;
    const tail = {
      random: e.object === 'feature' ? 'случайную открытую особенность' : `${what} (случайное значение из имеющихся)`,
      pool_random: `${e.object === 'feature' ? 'случайную особенность' : what}, если она есть в списке ${listText(e.pool?.items)}`,
      pool_choice: e.object === 'feature' ? 'особенность на выбор игрока' : `${what} — игрок выбирает, что именно убрать`,
      fixed: `«${e.value || '…'}»`,
    }[e.mode];
    return `${from}: ${tail}.`;
  }
  const src = {
    random: 'случайное значение из всей игры',
    pool_random: `случайное значение ${poolTxt}`,
    pool_choice: `на выбор ${poolTxt}`,
    fixed: `«${e.value || '…'}»`,
  }[e.mode];
  if (e.object === 'feature') return e.op === 'add' ? `Добавляет в бункер новую особенность: ${src}.` : `Заменяет случайную открытую особенность бункера: ${src}.`;
  return `${e.op === 'add' ? 'Добавляет' : 'Заменяет'} ${who} ${what}: ${src}.`;
}

function keyText(k) { return k && k !== 'random' ? TRAIT_LABELS[k] : 'случайная'; }

// Проверка для редактора
export function effectIssues(raw) {
  const e = normalizeEffect(raw);
  const out = [];
  if (e.type === 'change') {
    if (hasModes(e) && e.mode === 'fixed' && !String(e.value || '').trim()) out.push('не задано значение');
    if (usesPool(e) && e.pool.source === 'preset' && !e.pool.items.filter(Boolean).length) out.push('пул пуст');
    if (isNumeric(e) && !e.infinite && !(+e.amount > 0)) out.push('количество должно быть больше 0');
  }
  return out;
}
