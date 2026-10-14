// Озвучка текста встроенным синтезатором речи браузера (Web Speech API).
// Бесплатно, без ключей и серверов; качество голоса зависит от устройства.
import { prefs, setPref } from './sfx.js?v=3.1';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
export const supported = !!(synth && window.SpeechSynthesisUtterance);

let voices = [];
function loadVoices() {
  if (!supported) return;
  voices = synth.getVoices().filter(v => /^ru/i.test(v.lang));
}
if (supported) {
  loadVoices();
  synth.addEventListener?.('voiceschanged', loadVoices);
  // iOS разрешает речь только после касания: «разогреваем» синтезатор пустой фразой
  const warm = () => {
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch {}
    window.removeEventListener('pointerdown', warm, true);
  };
  window.addEventListener('pointerdown', warm, true);
}
export function ruVoices() { loadVoices(); return voices; }

function pickVoice() {
  const list = ruVoices();
  if (!list.length) return null;
  return list.find(v => v.voiceURI === prefs.ttsVoice)
    || list.find(v => /google/i.test(v.name))
    || list.find(v => /milena|милена|irina|ирина|svetlana|светлана/i.test(v.name))
    || list[0];
}

// Подготовка текста: без эмодзи, с понятными сокращениями
function clean(text) {
  return String(text || '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/м²/g, ' квадратных метров')
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}
// Длинный текст режем по предложениям: Chrome обрывает фразы длиннее ~15 секунд
function chunks(text) {
  const parts = clean(text).match(/[^.!?…]+[.!?…]*\s*/g) || [];
  const out = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + p).length > 180 && cur) { out.push(cur.trim()); cur = ''; }
    cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function stop() { if (supported) synth.cancel(); }

// interrupt — прервать то, что сейчас читается (для кнопки «прочитать ещё раз»)
export function speak(text, { interrupt = false } = {}) {
  if (!supported) return false;
  const voice = pickVoice();
  if (!voice) return false;
  if (interrupt) synth.cancel();
  for (const c of chunks(text)) {
    const u = new SpeechSynthesisUtterance(c);
    u.voice = voice;
    u.lang = voice.lang || 'ru-RU';
    u.rate = Math.max(0.6, Math.min(1.6, +prefs.ttsRate || 1));
    synth.speak(u);
  }
  // Chrome иногда «засыпает» после паузы — будим
  if (synth.paused) synth.resume();
  return true;
}

export function setVoice(uri) { setPref('ttsVoice', uri); }
export function setRate(r) { setPref('ttsRate', +r); }
export const speaking = () => supported && synth.speaking;
