// Финал партии: проблемы, решения, уязвимости, нужды группы, судьбы игроков.
import { TRAITS, TRAIT_KEYS, aliveIds, norm, foodInfo, monthsText, plural, shuffle, pick } from './logic.js?v=2.9';

export const NEEDS = [
  { id: 'food', name: 'Еда', icon: '🍖' },
  { id: 'medicine', name: 'Медицина', icon: '🩺' },
  { id: 'repair', name: 'Ремонт и техника', icon: '🔧' },
  { id: 'defense', name: 'Защита', icon: '🛡️' },
  { id: 'morale', name: 'Мораль', icon: '🙂' },
  { id: 'reproduction', name: 'Продолжение рода', icon: '👶' },
];
export const NEED_IDS = NEEDS.map(n => n.id);
export const needMeta = id => NEEDS.find(n => n.id === id) || { id, name: id, icon: '•' };

const NEED_TEXT = {
  food: { ok: 'Голод бункеру не грозил.', weak: 'Еды было впритык, приходилось урезать пайки.', fail: 'Еды не хватило — начался голод.' },
  medicine: { ok: 'Болезни и травмы удавалось лечить.', weak: 'С лечением было туго — болели подолгу.', fail: 'Лечить было некому и нечем.' },
  repair: { ok: 'Системы бункера работали исправно.', weak: 'Бункер держался на честном слове.', fail: 'Бункер разваливался, чинить было некому.' },
  defense: { ok: 'Бункер был надёжно защищён.', weak: 'Оборона была слабой, но держалась.', fail: 'Защитить бункер было некому.' },
  morale: { ok: 'Люди держались вместе и не теряли надежды.', weak: 'Атмосфера была тяжёлой, но до бунта не дошло.', fail: 'Группа развалилась изнутри.' },
  reproduction: { ok: 'Есть кому продолжить род.', weak: 'Продолжить род будет непросто.', fail: 'Продолжить род некому.' },
};

const lc = s => (s ? s[0].toLowerCase() + s.slice(1) : s);
const SEP = ' + ';

// Поиск записи контента по тексту
function makeLookup(content) {
  const maps = {};
  return (file, text) => {
    if (!file || !text) return null;
    if (!maps[file]) {
      maps[file] = {};
      for (const x of content?.[file] || []) if (x && (x.title || x.text)) maps[file][x.title || x.text] = x;
    }
    return maps[file][text] || null;
  };
}

// Нужда из записи (поддержка старого поля food)
export function itemNeeds(it) {
  if (!it) return {};
  const n = { ...(it.needs || {}) };
  if (n.food === undefined && it.food) n.food = +it.food;
  return n;
}

// Все записи игрока: [{key, label, value, item}]
function playerItems(card, lookup) {
  const out = [];
  for (const t of TRAITS) {
    const raw = card?.raw?.[t.key];
    const vals = String(card?.traits?.[t.key] ?? '').split(SEP);
    if (!raw || raw === 'Нет') continue;
    String(raw).split(SEP).forEach((r, i) => {
      out.push({ key: t.key, label: t.label, raw: r, value: vals[i] || r, item: lookup(t.file, r) });
    });
  }
  return out;
}

const sumNeeds = items => {
  const s = {};
  for (const it of items) for (const [k, v] of Object.entries(itemNeeds(it.item))) s[k] = (s[k] || 0) + (+v || 0);
  return s;
};
const listNames = arr => (arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} и ${arr[arr.length - 1]}`);
// «пострадал(а)» → «пострадал» / «пострадала»; «сошёл(сошла)» → нужная форма
function genderize(text, female) {
  return String(text)
    .replace(/(\S+?)\((\S+?)\)/g, (m, base, alt) => {
      if (/^[а-яё]{1,3}$/i.test(alt)) {
        if (!female) return base;
        // пострадал(а) → пострадала; умер(ла) → умерла; справился(ась) → справилась
        if (/ся$/.test(base) && /^ась$|^ась$/.test(alt)) return base.replace(/ся$/, '') + alt.replace(/^ась$/, 'ась');
        if (/ся$/.test(base)) return base.replace(/с?я$/, '') + alt;
        return base + alt;
      }
      return female ? alt : base; // сошёл(сошла)
    });
}
const fill = (tpl, map) => String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => map[k] ?? '');

// ---------- Тексты про отдельные характеристики ----------
// w(m, f) — форма слова по полу персонажа (из «Биологии»)
const POS = {
  profession: (n, v, w) => `${n} — ${lc(v)} — ${w('оказался незаменимым', 'оказалась незаменимой')}.`,
  health: (n, v, w) => `${n} ${w('отличался', 'отличалась')} крепким здоровьем («${lc(v)}») и почти не ${w('болел', 'болела')}.`,
  hobby: (n, v, w) => `${n}: увлечение «${lc(v)}» неожиданно пригодилось всем.`,
  phobia: (n, v, w) => `${n}: фобия «${lc(v)}» здесь, под землёй, даже помогала.`,
  baggage: (n, v, w) => `${n}: багаж «${lc(v)}» спас группу не один раз.`,
  fact: (n, v, w) => `${n}: со временем все узнали — ${lc(v)}. И это очень пригодилось.`,
  character: (n, v, w) => `${n} — ${w('человек', 'человек')} с характером «${lc(v)}» — ${w('держал', 'держала')} группу вместе.`,
  biology: (n, v, w) => `${n} (${lc(v)}) — надежда на будущее человечества.`,
};
const NEG = {
  profession: (n, v, w) => `${n}: профессия «${lc(v)}» под землёй оказалась бесполезной, а то и вредной.`,
  health: (n, v, w) => `${n}: здоровье — ${lc(v)} — стало постоянной заботой всей группы.`,
  hobby: (n, v, w) => `${n}: увлечение «${lc(v)}» пугало соседей.`,
  phobia: (n, v, w) => `${n}: фобия — ${lc(v)} — не раз ставила под угрозу общий покой.`,
  baggage: (n, v, w) => `${n}: багаж «${lc(v)}» принёс больше проблем, чем пользы.`,
  fact: (n, v, w) => `${n}: всплыло неприятное — ${lc(v)}.`,
  character: (n, v, w) => `${n}: характер «${lc(v)}» отравлял жизнь в бункере.`,
  biology: (n, v, w) => `${n} (${lc(v)}) — увы, не в помощь продолжению рода.`,
};
const NEUTRAL = {
  profession: (n, v, w) => `${n} — ${lc(v)}; под землёй ${w('пришлось осваивать', 'пришлось осваивать')} новое дело.`,
  health: (n, v, w) => `${n}: здоровье — ${lc(v)} — особых хлопот не доставляло.`,
  hobby: (n, v, w) => `${n} ${w('коротал', 'коротала')} вечера за любимым делом: ${lc(v)}.`,
  phobia: (n, v, w) => `${n} ${w('жил', 'жила')} со своей фобией — ${lc(v)} — и ${w('справлялся', 'справлялась')}.`,
  baggage: (n, v, w) => `${n} всё время ${w('держал', 'держала')} при себе багаж: ${lc(v)}.`,
  fact: (n, v, w) => `${n}: со временем выяснилось — ${lc(v)}.`,
  character: (n, v, w) => `${n} — ${lc(v)} — быстро ${w('нашёл', 'нашла')} своё место в группе.`,
  biology: (n, v, w) => `${n} — ${lc(v)}.`,
};

// Самая значимая запись игрока (для строки истории)
// present — множество проблем, которые реально возникли в партии
function keyItem(items, present = new Set()) {
  let best = null, bestScore = -1;
  for (const it of shuffle(items)) {
    const n = itemNeeds(it.item);
    const score = Object.values(n).reduce((a, v) => a + Math.abs(+v || 0), 0) + (it.item?.solves || []).filter(x => present.has(x)).length * 2 + (it.item?.causes || []).filter(x => present.has(x)).length * 2;
    if (score > bestScore) { best = it; bestScore = score; }
  }
  return best;
}
function lineFor(name, it, w, present = new Set()) {
  if (!it) return '';
  const n = itemNeeds(it.item);
  const total = Object.values(n).reduce((a, v) => a + (+v || 0), 0) + (it.item?.solves || []).filter(x => present.has(x)).length - (it.item?.causes || []).filter(x => present.has(x)).length;
  const set = total > 0 ? POS : total < 0 ? NEG : NEUTRAL;
  return (set[it.key] || NEUTRAL.fact)(name, it.value, w);
}

// ---------- Главный расчёт ----------
export function makeFinal(gIn, cards, names, content, settingsIn = {}) {
  const g = norm(JSON.parse(JSON.stringify(gIn)));
  const s = { finalMode: 'full', finalFates: true, finalExiled: true, ...g.settings, ...settingsIn };
  const lookup = makeLookup(content);
  const tags = Object.fromEntries((content?.tags || []).filter(t => t && t.id).map(t => [t.id, t]));
  const nm = p => names[p] || 'игрок';
  const isF = p => /^Женщина/.test(String(cards[p]?.raw?.biology || ''));
  const W = p => (m, f) => (isF(p) ? f : m);
  const surv = aliveIds(g);
  const exiled = g.players.filter(p => !g.alive[p]);
  const items = Object.fromEntries(g.players.map(p => [p, playerItems(cards[p], lookup)]));
  const c = g.catastrophe || {};
  const catItem = lookup('catastrophes', c.title);
  const condItem = g.bunker.condition ? lookup('conditions', g.bunker.condition.text) : null;
  const featItems = (g.bunker.features || []).map(f => ({ text: f, item: lookup('bunkers', f) }));

  // 1) Проблемы
  const problems = {};
  const addProblem = (id, source) => {
    if (!tags[id]) return;
    problems[id] = problems[id] || { id, sources: [] };
    if (source && !problems[id].sources.includes(source)) problems[id].sources.push(source);
  };
  (catItem?.causes || []).forEach(id => addProblem(id, c.title));
  (condItem?.causes || []).forEach(id => addProblem(id, g.bunker.condition.text));
  featItems.forEach(f => (f.item?.causes || []).forEach(id => addProblem(id, f.text)));
  surv.forEach(p => items[p].forEach(it => (it.item?.causes || []).forEach(id => addProblem(id, `${nm(p)}: ${lc(it.value)}`))));
  // тесно, если на человека меньше 15 м²; скука, если сидеть больше 4 лет
  if (surv.length > g.slots) addProblem('cramped', `в бункере на ${g.slots} ${plural(g.slots, 'место', 'места', 'мест')} оказалось ${surv.length} ${plural(surv.length, 'человек', 'человека', 'человек')}`);
  if (surv.length && g.bunker.size / surv.length < 15) addProblem('cramped', `${g.bunker.size} м² на ${surv.length} ${plural(surv.length, 'человека', 'человек', 'человек')}`);
  if ((+c.months || 0) >= 48) addProblem('despair', `долгий срок: ${c.duration}`);

  const solversOf = (id, list) => list.filter(p => items[p].some(it => (it.item?.solves || []).includes(id)));
  const featSolves = id => featItems.filter(f => (f.item?.solves || []).includes(id)).map(f => f.text);
  const probList = Object.values(problems).map(pr => {
    const t = tags[pr.id];
    const bySurv = solversOf(pr.id, surv);
    const byFeat = featSolves(pr.id);
    const solved = bySurv.length > 0 || byFeat.length > 0;
    const who = listNames([...bySurv.map(nm), ...byFeat.map(f => `«${lc(f)}»`)]);
    const weak = surv.filter(p => items[p].some(it => (it.item?.weak || []).includes(pr.id)));
    return {
      id: pr.id, name: t.name, icon: t.icon || '⚠️', need: t.need, sources: pr.sources, solved,
      by: [...bySurv.map(nm), ...byFeat], weak: weak.map(nm), weakIds: weak,
      text: solved ? fill(t.solved || `Проблема «${t.name}» решена. Заслуга: {who}.`, { who }) : (t.unsolved || `С проблемой «${t.name}» никто не справился.`),
      power: +t.power || 1, foodLoss: +t.foodLoss || 0, deadly: !!t.deadly, weakTpl: t.weak,
    };
  });

  // 2) Нужды
  const imp = {}, demand = {}, supply = {};
  for (const n of NEED_IDS) {
    imp[n] = Math.min(3, 1 + (+itemNeeds(catItem)[n] || 0) + (+itemNeeds(condItem)[n] || 0));
    demand[n] = imp[n] - 1;
    supply[n] = 0;
  }
  surv.forEach(p => { const sn = sumNeeds(items[p]); for (const n of NEED_IDS) supply[n] += sn[n] || 0; });
  featItems.forEach(f => { const fn = itemNeeds(f.item); for (const n of NEED_IDS) supply[n] += +fn[n] || 0; });
  probList.filter(p => !p.solved).forEach(p => { if (demand[p.need] !== undefined) demand[p.need] += p.power; });

  const fi = foodInfo(g);
  const foodLoss = probList.filter(p => !p.solved).reduce((a, p) => a + p.foodLoss, 0);
  const foodMonths = fi.infinite ? Infinity : Math.max(0, fi.months - foodLoss);
  const foodSkill = surv.reduce((a, p) => a + Math.max(0, +sumNeeds(items[p]).food || 0), 0);

  const needs = NEED_IDS.map(n => {
    let status;
    if (n === 'food') {
      const need = +c.months || 0;
      if (fi.infinite || (need && foodMonths >= need)) status = 'ok';
      else if (!need) status = foodSkill >= 1 || foodMonths >= 24 ? 'ok' : 'weak';
      else status = foodSkill >= 2 ? 'ok' : foodSkill === 1 || foodMonths >= need * 0.6 ? 'weak' : 'fail';
      if (supply.food < 0 && status === 'ok' && !fi.infinite) status = 'weak';
    } else if (n === 'reproduction') {
      const bios = surv.map(p => (cards[p]?.raw || {}).biology || '');
      const fertile = b => !/бесплод|чайлдфри/i.test(b);
      const pair = bios.some(b => /^Мужчина/.test(b) && fertile(b)) && bios.some(b => /^Женщина/.test(b) && fertile(b));
      const pregnant = bios.some(b => /беременна/i.test(b));
      status = pair ? 'ok' : pregnant || supply.reproduction > 0 ? 'weak' : 'fail';
    } else {
      status = supply[n] >= demand[n] ? 'ok' : supply[n] >= demand[n] - 1 ? 'weak' : 'fail';
    }
    const m = needMeta(n);
    return { id: n, name: m.name, icon: m.icon, status, important: imp[n] >= 2, text: NEED_TEXT[n][status] };
  });

  // 3) Итог группы
  let level, verdictPts = 0;
  if (!surv.length) level = 'none';
  else {
    let pts = 0;
    for (const nd of needs) {
      if (nd.id === 'reproduction') continue;
      const w = nd.id === 'food' ? 2 : imp[nd.id];
      if (nd.status === 'fail') pts += w;
      else if (nd.status === 'weak') pts += 0.5 * (nd.important ? 2 : 1);
    }
    pts += probList.filter(p => !p.solved && p.deadly).length * 0.5;
    level = pts <= 1 ? 'good' : pts <= 3.5 ? 'losses' : 'fell';
    verdictPts = pts;
  }
  const VERDICT = {
    good: { icon: '🌅', title: 'Бункер выстоял', text: 'Все выжившие дождались, когда можно будет выйти наружу.' },
    losses: { icon: '⚖️', title: 'Выжили — но не все', text: 'Бункер продержался, но заплатил за это высокую цену.' },
    fell: { icon: '🕯️', title: 'Бункер не выстоял', text: 'Группа не справилась с тем, что выпало на её долю.' },
    none: { icon: '💀', title: 'В бункер не попал никто', text: 'Человечество проиграло.' },
  };

  // 4) Судьбы
  const score = Object.fromEntries(surv.map(p => {
    const sn = sumNeeds(items[p]);
    const pos = NEED_IDS.reduce((a, n) => a + (+sn[n] || 0) * (n === 'reproduction' ? 0.5 : imp[n]), 0);
    const solv = probList.filter(pr => pr.by.includes(nm(p))).length * 2;
    return [p, pos + solv];
  }));
  const fate = Object.fromEntries(surv.map(p => [p, { status: 'alive', reasons: [] }]));
  probList.filter(pr => !pr.solved).forEach(pr => pr.weakIds.forEach(p => {
    const f = fate[p];
    const txt = genderize(fill(pr.weakTpl || '{name} тяжело пострадал(а).', { name: nm(p) }), isF(p));
    if (pr.deadly) { f.status = 'dead'; f.reasons.push(txt); }
    else { if (f.status === 'alive') f.status = 'hurt'; f.reasons.push(txt); }
  }));
  const failed = needs.filter(n => n.status === 'fail' && n.id !== 'reproduction');
  const ranked = [...surv].sort((a, b) => score[a] - score[b]);
  if (level === 'losses' && !surv.some(p => fate[p].status === 'dead')) {
    const victim = ranked.find(p => fate[p].status !== 'dead');
    if (victim && surv.length > 1) {
      fate[victim].status = 'dead';
      const why = failed[0] || needs.find(n => n.status === 'weak' && n.id !== 'reproduction');
      fate[victim].reasons.push(`${nm(victim)} не ${W(victim)('пережил', 'пережила')} трудные времена${why ? `: ${lc(why.text)}` : '.'}`);
    }
  }
  if (level === 'fell') {
    const best = ranked[ranked.length - 1];
    ranked.forEach(p => {
      if (p === best && score[p] > 0) { fate[p].lastOne = true; return; }
      if (fate[p].status !== 'dead') {
        fate[p].status = 'dead';
        const why = failed[Math.floor(Math.random() * Math.max(1, failed.length))];
        fate[p].reasons.push(`${nm(p)} ${W(p)('погиб', 'погибла')}${why ? `: ${lc(why.text)}` : ' вместе с бункером.'}`);
      }
    });
  }
  const fates = surv.map(p => {
    const f = fate[p];
    const present2 = new Set(Object.keys(problems));
    const top = keyItem(items[p].filter(it => Object.values(itemNeeds(it.item)).some(v => v > 0) || (it.item?.solves || []).some(x => present2.has(x))), present2) || keyItem(items[p], present2);
    let text;
    if (f.status === 'dead') text = f.reasons.join(' ');
    else if (f.status === 'hurt') text = `${f.reasons.join(' ')} Но ${W(p)('выжил', 'выжила')}.`;
    else if (f.lastOne) text = `${nm(p)} — ${W(p)('единственный', 'единственная')}, кто выжил. Помогло: ${lc(top?.value || 'везение')}.`;
    else text = top ? `${nm(p)} ${W(p)('выжил', 'выжила')}. Главное, что пригодилось: ${lc(top.value)}.` : `${nm(p)} ${W(p)('выжил', 'выжила')}.`;
    return { pid: p, name: nm(p), status: f.status, text };
  });

  // 5) Изгнанные
  const exiledNotes = [];
  if (s.finalExiled) {
    for (const p of exiled) {
      const its = items[p];
      const helps = probList.filter(pr => !pr.solved && its.some(it => (it.item?.solves || []).includes(pr.id)));
      const sn = sumNeeds(its);
      const failedNeed = needs.find(n => n.status !== 'ok' && n.id !== 'reproduction' && (+sn[n.id] || 0) >= 2);
      const harmful = probList.filter(pr => its.some(it => (it.item?.causes || []).includes(pr.id)));
      const negTotal = NEED_IDS.reduce((a, n) => a + Math.min(0, +sn[n] || 0), 0);
      if (helps.length) {
        const it = its.find(x => (x.item?.solves || []).includes(helps[0].id));
        exiledNotes.push({ pid: p, kind: 'regret', text: `${nm(p)} (${lc(it.value)}) ${W(p)('мог', 'могла')} бы справиться с проблемой «${helps[0].name}», но ${W(p)('был изгнан', 'была изгнана')}. Похоже, зря.` });
      } else if (failedNeed) {
        const it = its.find(x => (+itemNeeds(x.item)[failedNeed.id] || 0) >= 2);
        exiledNotes.push({ pid: p, kind: 'regret', text: `${nm(p)} (${lc(it?.value || '')}) очень ${W(p)('пригодился', 'пригодилась')} бы: «${failedNeed.name}» — слабое место бункера. Но ${W(p)('его', 'её')} изгнали.` });
      } else if (harmful.length || negTotal <= -2) {
        const it = its.find(x => (x.item?.causes || []).length) || its.find(x => Object.values(itemNeeds(x.item)).some(v => v < 0));
        exiledNotes.push({ pid: p, kind: 'right', text: `${nm(p)} ${W(p)('был изгнан', 'была изгнана')} — и правильно${it ? `: ${lc(it.value)}` : ''}.` });
      }
    }
  }

  // 6) История
  const story = [];
  story.push(`${c.title}. ${c.text || ''} В бункере площадью ${g.bunker.size} м² укрылись ${surv.length} ${plural(surv.length, 'человек', 'человека', 'человек')}${surv.length ? ': ' + surv.map(nm).join(', ') : ''}. Продержаться под землёй предстояло: ${c.duration}.`.replace(/\s+/g, ' '));
  if (g.bunker.condition) story.push(`Сам бункер: ${lc(g.bunker.condition.text)}. ${g.bunker.condition.desc || ''}`.trim());
  const present = new Set(Object.keys(problems));
  const personal = shuffle(surv).map(p => lineFor(nm(p), keyItem(items[p], present), W(p), present)).filter(Boolean);
  if (personal.length) story.push(personal.join(' '));
  const probLines = probList.map(p => p.text);
  if (probLines.length) story.push(probLines.join(' '));
  if (fi.infinite) story.push('Голод выжившим не грозил: в бункере был неиссякаемый источник пищи.');
  else if (surv.length) {
    const fd = needs.find(n => n.id === 'food');
    const feeders = surv.filter(p => (+sumNeeds(items[p]).food || 0) > 0).map(nm);
    if (fd.status === 'ok' && feeders.length && !(c.months && foodMonths >= c.months)) story.push(`Запасов не хватало, но ${listNames(feeders)} ${feeders.length > 1 ? 'наладили' : 'наладил(а)'} добычу еды.`);
    else if (fd.status === 'ok') story.push(`Еды хватило: запасов было на ${monthsText(foodMonths)}.`);
    else if (fd.status === 'weak') story.push(`Еды было на ${monthsText(foodMonths)} — пайки пришлось урезать.`);
    else story.push(`Еды хватило лишь на ${monthsText(foodMonths)}, а добывать её никто не умел.`);
  }
  const repro = needs.find(n => n.id === 'reproduction');
  if (!surv.length) story.push('В бункер не попал никто. Человечество проиграло.');
  else if (level === 'fell') story.push('Когда двери бункера открылись, наружу почти некому было выходить.');
  else if (repro.status === 'ok') story.push('Когда двери бункера наконец открылись, выжившие вышли наружу. Среди них есть те, кто может продолжить род, — у человечества есть шанс.');
  else story.push('Двери бункера открылись, и выжившие увидели новый мир. Вот только продолжить род в этой компании некому.');

  return {
    v: 1,
    mode: s.finalMode === 'story' ? 'story' : 'full',
    story,
    verdict: { level, pts: verdictPts, ...VERDICT[level] },
    needs: needs.map(({ id, name, icon, status, important, text }) => ({ id, name, icon, status, important, text })),
    problems: probList.map(({ id, name, icon, solved, by, weak, sources, text, need }) => ({ id, name, icon, solved, by, weak, sources, text, need })),
    fates: s.finalFates ? fates : [],
    exiled: exiledNotes,
  };
}
