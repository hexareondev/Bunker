// Звуки и личные настройки (тема, звук, громкость).
// Звуки синтезируются в браузере через Web Audio — никаких файлов.

const KEY = 'bunker.prefs';
export const THEMES = [
  ['auto', 'Как в системе', ['#f4f3ef', '#151514', '#e07a3f']],
  ['dark', 'Тёмная', ['#151514', '#1f1f1d', '#e07a3f']],
  ['light', 'Светлая', ['#f4f3ef', '#ffffff', '#c2541a']],
  ['terminal', 'Терминал', ['#050b06', '#0a140c', '#39ff6a']],
  ['rust', 'Ржавчина', ['#1a110d', '#2a1b15', '#e2702e']],
  ['waste', 'Пустошь', ['#e6d6b4', '#f5ebd3', '#a94f24']],
  ['sakura', 'Сакура', ['#fbeef3', '#fff8fb', '#e0457b']],
  ['neon', 'Неон', ['#140a1c', '#20112d', '#ff4fa3']],
  ['mint', 'Мята', ['#e8f6f2', '#f8fffd', '#0f9b8a']],
  ['lagoon', 'Лагуна', ['#061a1d', '#0c272b', '#2dd4bf']],
];
export const MOTION_MODES = [['full', 'Все'], ['reduced', 'Меньше'], ['off', 'Выкл']];
export const SOUND_MODES = [['all', 'Все события'], ['mine', 'Только мои'], ['off', 'Выкл']];

const DEFAULTS = { theme: 'auto', sound: 'all', vol: 0.6, motion: 'full' };
export const prefs = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
})();

export function setPref(k, v) {
  prefs[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch {}
  if (k === 'theme' || k === 'motion') applyTheme();
}
export function applyTheme() {
  const t = prefs.theme;
  if (!t || t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  if (prefs.motion && prefs.motion !== 'full') document.documentElement.dataset.motion = prefs.motion;
  else delete document.documentElement.dataset.motion;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta && bg) meta.content = bg;
}
applyTheme();

// ---------------- Web Audio ----------------
let ctx = null, master = null;
function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}
// Браузеры разрешают звук только после первого касания страницы
['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));

function tone({ f = 440, f2 = null, t = 0, d = 0.15, type = 'sine', v = 0.3, a = 0.006, out = master }) {
  const t0 = ctx.currentTime + t;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + d);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.connect(g); g.connect(out);
  o.start(t0); o.stop(t0 + d + 0.05);
  return o;
}
let noiseBuf = null;
function noise({ t = 0, d = 0.2, v = 0.2, f = 1000, f2 = null, q = 1, type = 'bandpass', a = 0.01 }) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + t;
  const s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true;
  flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f, t0);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t0 + d);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  s.connect(flt); flt.connect(g); g.connect(master);
  s.start(t0); s.stop(t0 + d + 0.05);
}
const arp = (notes, step, opts) => notes.forEach((f, i) => tone({ f, t: i * step, ...opts }));

const SOUNDS = {
  // переворот карты: шорох + звонкая нота
  flip() { noise({ d: 0.22, v: 0.18, f: 500, f2: 3000, q: 0.8 }); tone({ f: 880, f2: 1320, t: 0.32, d: 0.35, type: 'triangle', v: 0.22 }); tone({ f: 1760, t: 0.36, d: 0.3, v: 0.06 }); },
  // карта действия: волшебное арпеджио
  action() { noise({ d: 0.5, v: 0.05, f: 6000, type: 'highpass' }); arp([523, 659, 784, 1047, 1319], 0.065, { d: 0.3, type: 'triangle', v: 0.16 }); },
  swap() { tone({ f: 500, f2: 950, d: 0.32, type: 'triangle', v: 0.18 }); tone({ f: 950, f2: 500, d: 0.32, type: 'triangle', v: 0.18 }); tone({ f: 1250, t: 0.34, d: 0.25, v: 0.1 }); },
  shield() { tone({ f: 330, f2: 660, d: 0.45, type: 'sawtooth', v: 0.06 }); tone({ f: 990, t: 0.12, d: 0.6, v: 0.12 }); tone({ f: 1485, t: 0.12, d: 0.6, v: 0.05 }); },
  stamp() { noise({ d: 0.12, v: 0.35, f: 300, type: 'lowpass' }); tone({ f: 140, f2: 60, d: 0.2, type: 'square', v: 0.12 }); },
  heart() { tone({ f: 90, f2: 60, d: 0.14, v: 0.45 }); tone({ f: 90, f2: 60, t: 0.22, d: 0.14, v: 0.35 }); tone({ f: 660, t: 0.45, d: 0.4, type: 'triangle', v: 0.12 }); tone({ f: 990, t: 0.55, d: 0.4, type: 'triangle', v: 0.1 }); },
  // изгнание: глухой удар и падающий гул
  exile() { noise({ d: 0.35, v: 0.4, f: 200, type: 'lowpass' }); tone({ f: 220, f2: 45, d: 0.9, type: 'sawtooth', v: 0.14 }); tone({ f: 110, f2: 40, d: 1, v: 0.3 }); },
  // особенность бункера: лязг металла и шипение двери
  bunker() { tone({ f: 180, d: 0.4, type: 'square', v: 0.08 }); tone({ f: 271, d: 0.35, type: 'square', v: 0.06 }); noise({ d: 0.08, v: 0.3, f: 3000, type: 'highpass' }); noise({ t: 0.15, d: 0.7, v: 0.08, f: 1800, f2: 400, q: 0.6 }); },
  // катастрофа: сирена и гул
  siren() {
    const t0 = ctx.currentTime, d = 2.2;
    const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 620;
    lfo.frequency.value = 1.4; lg.gain.value = 180; lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g); g.connect(master); o.start(t0); lfo.start(t0); o.stop(t0 + d); lfo.stop(t0 + d);
    noise({ d: 2, v: 0.25, f: 120, type: 'lowpass', a: 0.3 });
  },
  turn() { tone({ f: 660, d: 0.25, type: 'triangle', v: 0.2 }); tone({ f: 990, t: 0.14, d: 0.4, type: 'triangle', v: 0.2 }); },
  vote() { tone({ f: 420, d: 0.07, type: 'square', v: 0.05 }); },
  tick() { tone({ f: 1200, d: 0.05, type: 'square', v: 0.05 }); },
  pop() { tone({ f: 600, f2: 900, d: 0.08, v: 0.1 }); },
  win() { arp([523, 659, 784], 0.12, { d: 0.35, type: 'triangle', v: 0.18 }); tone({ f: 1047, t: 0.4, d: 1.1, type: 'triangle', v: 0.2 }); tone({ f: 1319, t: 0.4, d: 1.1, v: 0.1 }); tone({ f: 784, t: 0.4, d: 1.1, v: 0.1 }); },
  meh() { arp([523, 494, 440], 0.18, { d: 0.4, type: 'triangle', v: 0.16 }); tone({ f: 392, t: 0.6, d: 0.9, type: 'triangle', v: 0.16 }); },
  lose() { arp([392, 370, 349], 0.25, { d: 0.5, type: 'sawtooth', v: 0.07 }); tone({ f: 330, f2: 160, t: 0.75, d: 1.4, type: 'sawtooth', v: 0.08 }); tone({ f: 82, t: 0.75, d: 1.4, v: 0.25 }); },
};

// mine = событие касается этого игрока (для режима «только мои»)
export function play(name, { mine = false } = {}) {
  if (prefs.sound === 'off' || (prefs.sound === 'mine' && !mine)) return;
  if (!ctx || ctx.state !== 'running' || !SOUNDS[name]) return;
  try {
    master.gain.setValueAtTime(Math.max(0, Math.min(1, +prefs.vol || 0)), ctx.currentTime);
    SOUNDS[name]();
  } catch (e) { console.warn(e); }
}
export const SOUND_NAMES = Object.keys(SOUNDS);
