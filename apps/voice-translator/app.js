// Voice Translator (Phantom Talk): speak or type, get a natural everyday translation into any of
// the 20 languages, shown large, with Read aloud, Copy and Share. It translates by itself after
// Done, when the target language changes and 1 s after typing stops.
// Conversation mode: two people, one phone. Each has a big microphone in their own language;
// every turn is translated into the other person's language and shown (original + translation).
// My reply has "Say it to them". "Turn around" rotates the other person's half.
// Message helper: paste a WhatsApp / Telegram message, see what it means, and get a short
// reply written in the sender's language.
// Silent by default: nothing is read aloud unless the user taps a button (or switches on
// "Speak translations automatically"). The last 30 translations are kept on this device.

import { createLanguageDropdown, getCurrentLanguage, LANGUAGES } from '/skeleton/language-dropdown.js';
import { createSpeechInput } from '/skeleton/speech-input.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { createNavMenu } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n, loadStrings } from '/skeleton/i18n.js';
import { parseWords } from '/skeleton/voice-commands.js';
import { translateSpeech, detectMessage, writeReplies } from '/skeleton/api-client.js';
import {
  AUTO_DELAY_MS,
  MAX_HINT,
  requestKey,
  shouldTranslate,
  detectedLanguage,
  cleanReplies,
  nextReplyIndex,
  cleanText,
  findLanguage,
  sameLanguage,
  defaultTarget,
  swapLanguages,
  turnLanguages,
  loadSettings,
  saveSettings,
  loadHistory,
  saveHistory,
  addEntry,
  removeEntry,
  errorKey,
  translationOf,
  canShareText,
} from '/apps/voice-translator/translator-utils.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

const ENGLISH_DONE_WORDS = ['done', 'finished', 'that is all'];
const TOAST_MS = 2200;

const $ = (id) => document.getElementById(id);
const el = {
  modeSingle: $('mode-single'),
  modeChat: $('mode-chat'),
  message: $('message'),
  single: $('screen-single'),
  chatScreen: $('screen-chat'),
  from: $('from-select'),
  to: $('to-select'),
  swap: $('swap-button'),
  source: $('source-text'),
  live: $('live-text'),
  listening: $('listening-indicator'),
  speak: $('speak-button'),
  done: $('done-button'),
  translate: $('translate-button'),
  working: $('working'),
  result: $('result'),
  resultText: $('result-text'),
  resultOriginal: $('result-original'),
  read: $('read-button'),
  copy: $('copy-button'),
  share: $('share-button'),
  flip: $('flip-button'),
  otherHalf: $('half-other'),
  otherSelect: $('other-select'),
  otherLast: $('other-last'),
  otherMic: $('other-mic'),
  otherForm: $('other-form'),
  otherInput: $('other-input'),
  meSelect: $('me-select'),
  meMic: $('me-mic'),
  meForm: $('me-form'),
  meInput: $('me-input'),
  chat: $('chat'),
  chatEmpty: $('chat-empty'),
  chatLive: $('chat-live'),
  history: $('history'),
  historyEmpty: $('history-empty'),
  toast: $('toast'),
  modeHelper: $('mode-helper'),
  speakAutoRow: $('speak-auto-row'),
  speakAuto: $('speak-auto'),
  helperScreen: $('screen-helper'),
  helperMessage: $('helper-message'),
  paste: $('paste-button'),
  helperWorking: $('helper-working'),
  helperWorkingText: $('helper-working-text'),
  helperMeaning: $('helper-meaning'),
  helperMeaningText: $('helper-meaning-text'),
  helperDetectFailed: $('helper-detect-failed'),
  helperLang: $('helper-lang'),
  hintInput: $('hint-input'),
  hintMic: $('hint-mic'),
  hintListening: $('hint-listening'),
  hintDone: $('hint-done'),
  replyButton: $('reply-button'),
  replyCard: $('reply-card'),
  replyLabel: $('reply-label'),
  replyText: $('reply-text'),
  replyMeaning: $('reply-meaning'),
  replyCount: $('reply-count'),
  meaningButton: $('meaning-button'),
  meaningLabel: $('meaning-label'),
  anotherButton: $('another-button'),
  replyCopy: $('reply-copy'),
  replyShare: $('reply-share'),
};

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const settings = loadSettings(storage(), LANGUAGES);
let pageLanguage = getCurrentLanguage();
const state = {
  mode: settings.mode, // 'single' | 'chat' | 'helper'
  speakAuto: settings.speakAuto, // off by default: nothing is read aloud by itself
  lastKey: '', // the last Translate request (the same one is never sent twice)
  entryId: '', // the history entry of the text being typed ('' = the next one is new)
  pending: false, // a newer text came while a translation was running
  helper: {
    lastKey: '', // the last message sent for "what it means"
    sender: '', // the language of the received message ('' = not known yet)
    replies: [], // [{ reply, meaning }]
    index: 0, // the reply shown
    showMeaning: false,
    busy: false,
    pending: false, // the message changed while it was being read
  },
  from: pageLanguage.bcp47, // default: the page language
  to: settings.to || defaultTarget(pageLanguage.bcp47),
  me: pageLanguage.bcp47,
  other: settings.other || settings.to || defaultTarget(pageLanguage.bcp47),
  listeningFor: '', // '' | 'single' | 'me' | 'other'
  busy: false,
  last: null, // the last translation of the Translate screen: { text, translation, from, to }
  turns: [], // this conversation: [{ speaker, from, to, text, translation }]
  history: loadHistory(storage()),
};
let speechInput = null;
let voiceOff = false;
let toastTimer = null;

function store() {
  saveSettings(storage(), { to: state.to, other: state.other, mode: state.mode, speakAuto: state.speakAuto }, LANGUAGES);
}

const nameOf = (code) => findLanguage(code, LANGUAGES)?.native ?? code;

// ---------- Nav and the page language ----------

const nav = createNavMenu($('app-header'), { current: 'voice-translator', onLeave: stopVoice });
createLanguageDropdown(nav.languageEl, {
  onChange: (lang) => {
    // "From" and "Me" follow the page language when they were still the page language.
    if (state.from === pageLanguage.bcp47) state.from = lang.bcp47;
    if (state.me === pageLanguage.bcp47) state.me = lang.bcp47;
    pageLanguage = lang;
    renderAll();
    // The meaning of a pasted message is shown in my language: show it in the new one.
    if (messageText() !== '' && !el.helperMeaning.hidden) understandMessage({ auto: true });
  },
});
pageLanguage = getCurrentLanguage();

// ---------- Messages and the "Copied" toast ----------

function showMessage(key, params) {
  setI18nText(el.message, key, params);
  el.message.hidden = false;
}

function hideMessage() {
  clearI18n(el.message);
  el.message.hidden = true;
}

function toast(key) {
  clearTimeout(toastTimer);
  setI18nText(el.toast, key);
  el.toast.hidden = false;
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, TOAST_MS);
}

// ---------- Language pickers ----------

function fillSelect(select, value) {
  select.textContent = '';
  for (const language of LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.bcp47;
    option.lang = language.bcp47;
    // The name in its own script, with the English name for helpers who read English.
    option.textContent = language.native === language.label ? language.native : `${language.native} – ${language.label}`;
    select.appendChild(option);
  }
  select.value = value;
}

el.from.addEventListener('change', () => {
  state.from = el.from.value;
  preloadDoneWords(state.from);
});
el.to.addEventListener('change', () => {
  state.to = el.to.value;
  store();
  translateSingle({ auto: true }); // a new target language: translate again at once
});
el.swap.addEventListener('click', () => {
  const swapped = swapLanguages({ from: state.from, to: state.to });
  state.from = swapped.from;
  state.to = swapped.to;
  // The last translation becomes the new text to translate back.
  if (state.last) el.source.value = state.last.translation;
  state.entryId = ''; // translating back is a new history entry
  store();
  renderSingle();
  translateSingle({ auto: true });
});

// Typing: translate 1 second after the last key (the Translate button still works at once).
let typingTimer = null;
el.source.addEventListener('input', () => {
  clearTimeout(typingTimer);
  if (el.source.value.trim() === '') state.entryId = ''; // the next text is a new entry
  typingTimer = setTimeout(() => translateSingle({ auto: true }), AUTO_DELAY_MS);
});

// Silent by default; "Speak translations automatically" brings back reading aloud by itself.
el.speakAuto.addEventListener('change', () => {
  state.speakAuto = el.speakAuto.checked;
  store();
});
el.meSelect.addEventListener('change', () => {
  state.me = el.meSelect.value;
  renderMics();
});
el.otherSelect.addEventListener('change', () => {
  state.other = el.otherSelect.value;
  store();
  renderMics();
});

// ---------- Modes ----------

function setMode(mode) {
  if (state.listeningFor) stopVoice();
  state.mode = mode;
  store();
  renderMode();
}

function renderMode() {
  el.modeSingle.setAttribute('aria-pressed', String(state.mode === 'single'));
  el.modeChat.setAttribute('aria-pressed', String(state.mode === 'chat'));
  el.modeHelper.setAttribute('aria-pressed', String(state.mode === 'helper'));
  el.single.hidden = state.mode !== 'single';
  el.chatScreen.hidden = state.mode !== 'chat';
  el.helperScreen.hidden = state.mode !== 'helper';
  el.speakAutoRow.hidden = state.mode === 'helper'; // the Message helper never speaks by itself
}

el.modeSingle.addEventListener('click', () => setMode('single'));
el.modeChat.addEventListener('click', () => setMode('chat'));
el.modeHelper.addEventListener('click', () => setMode('helper'));

// ---------- Speech ----------

// Done words of a language ("done", "முடிந்தது"...), from that language's own locale file.
// Loaded ahead of time (when a language is shown), so the microphone can start at once inside
// the tap: browsers may refuse to start it later.
const doneWordsCache = new Map();
function preloadDoneWords(code) {
  if (doneWordsCache.has(code)) return;
  doneWordsCache.set(code, ENGLISH_DONE_WORDS); // until the file arrives
  loadStrings(code).then((strings) => {
    doneWordsCache.set(code, [...parseWords(strings?.['voice.doneWords'] ?? ''), ...ENGLISH_DONE_WORDS]);
  });
}
function doneWordsFor(code) {
  preloadDoneWords(code);
  return doneWordsCache.get(code);
}

function createEngine() {
  const created = createSpeechInput({
    lang: state.from,
    onResult: (text) => {
      if (speechInput === created) handleHeard(text);
    },
    onError: (info) => {
      if (speechInput === created) handleVoiceError(info);
    },
    onInterim: (text) => {
      if (speechInput !== created || !state.listeningFor) return;
      if (state.listeningFor === 'hint') {
        el.hintInput.value = text; // the hint is shown in its own box while it is said
        return;
      }
      const live = state.listeningFor === 'single' ? el.live : el.chatLive;
      live.textContent = text;
      live.hidden = text === '';
    },
  });
  speechInput = created;
  setVoiceOff(!created.supported);
}

function setVoiceOff(off) {
  voiceOff = off;
  el.speak.hidden = off || state.listeningFor === 'single';
  el.meMic.hidden = off;
  el.otherMic.hidden = off;
  el.hintMic.hidden = off;
  if (off) showMessage('voiceTranslator.voiceOff'); // typing always works
}

function stopVoice() {
  if (speechInput && speechInput.supported) speechInput.stop();
  window.speechSynthesis?.cancel();
  setListening('');
}

function setListening(target) {
  state.listeningFor = target;
  el.listening.hidden = target !== 'single';
  el.done.hidden = target !== 'single';
  el.speak.hidden = voiceOff || target === 'single';
  el.hintListening.hidden = target !== 'hint';
  el.hintDone.hidden = target !== 'hint';
  el.hintMic.disabled = target !== '';
  if (target === '') {
    for (const live of [el.live, el.chatLive]) {
      live.hidden = true;
      live.textContent = '';
    }
  }
  renderMics();
  renderBusy();
}

// Start listening in a language, for the Translate screen ('single') or one side of the chat.
function listen(target, code) {
  if (voiceOff || state.listeningFor || state.busy || !speechInput || !speechInput.supported) return;
  window.speechSynthesis?.cancel(); // the microphone must not hear the reading voice
  hideMessage();
  setListening(target);
  speechInput.start({ continuous: true, lang: code, doneWords: doneWordsFor(code) });
}

function finishListening() {
  if (state.listeningFor && speechInput && speechInput.supported) speechInput.finish();
}

function handleHeard(text) {
  const target = state.listeningFor;
  setListening('');
  const heard = cleanText(text);
  if (heard === '') {
    showMessage('voiceTranslator.nothingHeard');
    return;
  }
  if (target === 'single') {
    el.source.value = heard;
    state.entryId = ''; // something new was said: a new history entry
    translateSingle({ auto: true }); // translated at once after Done
  } else if (target === 'me' || target === 'other') {
    takeTurn(target, heard);
  } else if (target === 'hint') {
    el.hintInput.value = heard.slice(0, MAX_HINT);
  }
}

function handleVoiceError(info) {
  const was = state.listeningFor;
  setListening('');
  if (!info) return;
  const broken = info.fallbackOnly || ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(info.error);
  if (broken) setVoiceOff(true);
  else if (was) showMessage('voiceTranslator.nothingHeard');
}

// Read a text aloud in its own language. No voice for it in this browser: say so on the screen.
function readAloud(text, code) {
  window.speechSynthesis?.cancel();
  const output = createSpeechOutput({ lang: code });
  output.speak(text, {
    onError: (info) => {
      if (info && info.audioUnavailable) showMessage('voiceTranslator.noVoice', { language: nameOf(code) });
    },
  });
}

// ---------- Translating ----------

// One translation. Same language: nothing to send. Returns { translation } or { error }.
async function translateText(text, from, to) {
  if (sameLanguage(from, to)) return { translation: text };
  const reply = await translateSpeech({ text, sourceLang: from, targetLang: to });
  const translation = translationOf(reply);
  if (reply.error || translation === '') return { error: reply.error || 'empty' };
  return { translation };
}

const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Keep a translation in the history. With an id, that entry is replaced (typing in the same
// text box updates one entry instead of adding one per pause).
function remember(entry, id = newId()) {
  state.history = addEntry(state.history, { id, at: Date.now(), ...entry });
  if (!saveHistory(storage(), state.history)) showMessage('voiceTranslator.saveFailed');
  renderHistory();
  return id;
}

// Read aloud by itself only when the user switched that on.
function speakIfWanted(text, code) {
  if (state.speakAuto) readAloud(text, code);
}

function renderBusy() {
  el.working.hidden = !state.busy;
  el.translate.disabled = state.busy || state.listeningFor !== '';
}

// Translate the text box. auto: started by itself (after Done, a new target language, or 1 s
// after typing): it says nothing when the box is empty, and never sends the same request twice.
async function translateSingle({ auto = false } = {}) {
  clearTimeout(typingTimer);
  const text = cleanText(el.source.value);
  if (text === '') {
    if (!auto) {
      showMessage('voiceTranslator.emptyText');
      el.source.focus();
    }
    return;
  }
  if (state.listeningFor === 'single') return; // still listening: Done translates
  const { from, to } = state;
  const key = requestKey(text, from, to);
  if (auto && !shouldTranslate(key, state.lastKey)) return;
  if (state.busy) {
    state.pending = true; // translate the newest text when this one is done
    return;
  }
  hideMessage();
  state.busy = true;
  renderBusy();
  const result = await translateText(text, from, to);
  state.busy = false;
  renderBusy();
  // The text or the languages changed meanwhile: translate the newest version, but only after
  // this result is handled, so results always appear in order.
  const rerun = state.pending;
  state.pending = false;
  if (result.error) {
    showMessage(errorKey(result.error));
  } else {
    state.lastKey = key;
    state.last = { text, translation: result.translation, from, to };
    renderResult();
    if (!auto) el.resultText.focus(); // never move the focus away from someone who is typing
    speakIfWanted(result.translation, to);
    state.entryId = remember({ from, to, text, translation: result.translation, speaker: '' }, state.entryId || newId());
  }
  if (rerun) translateSingle({ auto: true });
}

el.speak.addEventListener('click', () => listen('single', state.from));
el.done.addEventListener('click', finishListening);
el.translate.addEventListener('click', () => {
  if (state.listeningFor) finishListening();
  else translateSingle();
});

function renderResult() {
  const last = state.last;
  el.result.hidden = !last;
  if (!last) return;
  el.resultText.textContent = last.translation;
  el.resultText.lang = last.to;
  el.resultText.setAttribute('tabindex', '-1');
  el.resultOriginal.textContent = last.text;
  el.resultOriginal.lang = last.from;
}

el.read.addEventListener('click', () => {
  if (state.last) readAloud(state.last.translation, state.last.to);
});
el.copy.addEventListener('click', () => {
  if (state.last) copyText(state.last.translation);
});
el.share.addEventListener('click', async () => {
  if (!state.last || !canShareText(navigator)) return;
  try {
    await navigator.share({ text: state.last.translation });
  } catch {
    // the user closed the share sheet: nothing to do
  }
});

// ---------- Copy (Clipboard API, or the old way) ----------

async function copyText(text) {
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    // Fallback: a hidden text box, selected and copied.
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    box.remove();
  }
  toast(ok ? 'voiceTranslator.copied' : 'voiceTranslator.copyFailed');
}

// ---------- Conversation ----------

function renderMics() {
  for (const code of [state.from, state.me, state.other]) preloadDoneWords(code);
  for (const [button, side, code] of [[el.meMic, 'me', state.me], [el.otherMic, 'other', state.other]]) {
    const listening = state.listeningFor === side;
    button.textContent = '';
    const icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = listening ? '✓' : '🎤';
    const label = document.createElement('span');
    label.lang = listening ? '' : code;
    // The language name in its own script, so each person finds their button at a glance.
    label.textContent = listening ? t('voiceTranslator.doneIn', { language: nameOf(code) }) : t('voiceTranslator.speakIn', { language: nameOf(code) });
    button.append(icon, ' ', label);
    button.classList.toggle('is-listening', listening);
    button.setAttribute('aria-pressed', String(listening));
    button.disabled = state.busy || (state.listeningFor !== '' && !listening);
  }
}

function micClick(side) {
  if (state.listeningFor === side) finishListening(); // the same button is "Done"
  else listen(side, side === 'me' ? state.me : state.other);
}
el.meMic.addEventListener('click', () => micClick('me'));
el.otherMic.addEventListener('click', () => micClick('other'));

// Typing instead of speaking.
for (const [form, input, side] of [[el.meForm, el.meInput, 'me'], [el.otherForm, el.otherInput, 'other']]) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = cleanText(input.value);
    if (text === '' || state.busy || state.listeningFor) return;
    input.value = '';
    takeTurn(side, text);
  });
}

// One turn: the speaker's words, translated into the other language and shown as text.
// Nothing is read aloud by itself (only with "Speak translations automatically" switched on).
async function takeTurn(speaker, text) {
  const { from, to } = turnLanguages(speaker, state.me, state.other);
  hideMessage();
  state.busy = true;
  renderMics();
  renderBusy();
  const result = await translateText(text, from, to);
  state.busy = false;
  renderMics();
  renderBusy();
  if (result.error) {
    showMessage(errorKey(result.error));
    return;
  }
  const turn = { speaker, from, to, text, translation: result.translation };
  state.turns.push(turn);
  renderChat();
  speakIfWanted(result.translation, to);
  remember(turn);
}

function renderChat() {
  el.chat.textContent = '';
  el.chatEmpty.hidden = state.turns.length > 0;
  for (const turn of state.turns) {
    const item = document.createElement('li');
    item.className = `vt-bubble vt-bubble--${turn.speaker}`;
    const who = document.createElement('p');
    who.className = 'vt-bubble-who';
    setI18nText(who, turn.speaker === 'me' ? 'voiceTranslator.me' : 'voiceTranslator.otherPerson');
    const original = document.createElement('p');
    original.className = 'vt-bubble-original';
    original.lang = turn.from;
    original.dir = 'auto';
    original.textContent = turn.text; // plain text, never HTML
    const translated = document.createElement('p');
    translated.className = 'vt-bubble-translation';
    translated.lang = turn.to;
    translated.dir = 'auto';
    translated.textContent = turn.translation;
    // Silent: my reply is spoken to the other person only when I tap "Say it to them".
    const buttons = document.createElement('div');
    buttons.className = 'vt-bubble-buttons';
    if (turn.speaker === 'me') {
      const say = document.createElement('button');
      say.type = 'button';
      say.className = 'btn vt-say';
      const icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '🔊';
      const label = document.createElement('span');
      label.textContent = t('voiceTranslator.sayIt');
      say.append(icon, ' ', label);
      say.addEventListener('click', () => readAloud(turn.translation, turn.to));
      buttons.appendChild(say);
    }
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn--secondary';
    const copyIcon = document.createElement('span');
    copyIcon.setAttribute('aria-hidden', 'true');
    copyIcon.textContent = '📋';
    const copyLabel = document.createElement('span');
    copyLabel.textContent = t('voiceTranslator.copy');
    copy.append(copyIcon, ' ', copyLabel);
    copy.addEventListener('click', () => copyText(turn.translation));
    buttons.appendChild(copy);
    item.append(who, original, translated, buttons);
    el.chat.appendChild(item);
  }
  el.chat.lastElementChild?.scrollIntoView({ block: 'nearest' });
  // The other person's half shows the latest message in THEIR language (they may be facing it).
  const last = state.turns[state.turns.length - 1];
  el.otherLast.hidden = !last;
  if (last) {
    const theirs = last.speaker === 'me' ? last.translation : last.text;
    el.otherLast.textContent = theirs;
    el.otherLast.lang = state.other;
  }
}

el.flip.addEventListener('click', () => {
  const flipped = !el.otherHalf.classList.contains('vt-half--flipped');
  el.otherHalf.classList.toggle('vt-half--flipped', flipped);
  el.flip.setAttribute('aria-pressed', String(flipped));
});

// ---------- The last 30 translations ----------

function renderHistory() {
  el.history.textContent = '';
  el.historyEmpty.hidden = state.history.length > 0;
  for (const entry of state.history) {
    const item = document.createElement('li');
    item.className = 'vt-entry';
    const langs = document.createElement('p');
    langs.className = 'vt-entry-langs';
    langs.textContent = `${nameOf(entry.from)} → ${nameOf(entry.to)}`;
    langs.dir = 'auto';
    const original = document.createElement('p');
    original.className = 'vt-entry-original';
    original.lang = entry.from;
    original.dir = 'auto';
    original.textContent = entry.text;
    const translated = document.createElement('p');
    translated.className = 'vt-entry-translation';
    translated.lang = entry.to;
    translated.dir = 'auto';
    translated.textContent = entry.translation;
    const buttons = document.createElement('div');
    buttons.className = 'vt-row';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn--secondary';
    copy.textContent = t('voiceTranslator.copy');
    copy.addEventListener('click', () => copyText(entry.translation));
    const read = document.createElement('button');
    read.type = 'button';
    read.className = 'btn btn--secondary';
    read.textContent = t('voiceTranslator.readAloud');
    read.addEventListener('click', () => readAloud(entry.translation, entry.to));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn--secondary vt-delete';
    remove.textContent = t('common.delete');
    remove.addEventListener('click', () => {
      state.history = removeEntry(state.history, entry.id);
      saveHistory(storage(), state.history);
      renderHistory();
      toast('voiceTranslator.deleted');
      el.history.querySelector('button')?.focus();
    });
    buttons.append(copy, read, remove);
    item.append(langs, original, translated, buttons);
    el.history.appendChild(item);
  }
}

// ---------- Message helper: understand and answer a chat message ----------
// Two Gemini calls at most per message: one for "what it means" (with the language found in
// the same call) and one for the replies ("Another reply" first shows the other replies already
// written). Nothing is read aloud in this tab.

const MAX_MESSAGE = 2000;
const myLang = () => pageLanguage.bcp47;
const messageText = () => el.helperMessage.value.trim().slice(0, MAX_MESSAGE);

function setHelperWorking(key) {
  el.helperWorking.hidden = !key;
  if (key) setI18nText(el.helperWorkingText, key);
  else clearI18n(el.helperWorkingText);
  el.replyButton.disabled = Boolean(key);
  el.anotherButton.disabled = Boolean(key);
}

function fillHelperLang() {
  fillSelect(el.helperLang, state.helper.sender);
  // "—" while the language is not known: the user picks it.
  const unknown = document.createElement('option');
  unknown.value = '';
  unknown.textContent = '—';
  el.helperLang.prepend(unknown);
  el.helperLang.value = state.helper.sender;
}

// "What it means": the language and the meaning in my language, in ONE call.
let messageTimer = null;
async function understandMessage({ auto = false } = {}) {
  clearTimeout(messageTimer);
  const text = messageText();
  if (text === '') {
    if (!auto) showMessage('voiceTranslator.emptyMessage');
    return false;
  }
  const key = `${myLang()}|${text}`;
  if (key === state.helper.lastKey) return true;
  if (state.helper.busy) {
    state.helper.pending = true; // the message changed while it was being read: read it again after
    return false;
  }
  hideMessage();
  state.helper.busy = true;
  setHelperWorking('voiceTranslator.understanding');
  const reply = await detectMessage({ text, targetLang: myLang() });
  state.helper.busy = false;
  setHelperWorking('');
  el.helperMeaning.hidden = false;
  const rerun = state.helper.pending;
  state.helper.pending = false;
  let ok = false;
  if (reply.error) {
    showMessage(errorKey(reply.error));
    el.helperMeaningText.textContent = '';
    el.helperDetectFailed.hidden = state.helper.sender !== '';
  } else {
    state.helper.lastKey = key;
    state.helper.sender = detectedLanguage(reply.sourceLang, LANGUAGES);
    el.helperMeaningText.textContent = translationOf(reply) || text;
    el.helperMeaningText.lang = myLang();
    el.helperDetectFailed.hidden = state.helper.sender !== '';
    fillHelperLang();
    ok = true;
  }
  if (rerun) return understandMessage({ auto: true });
  return ok;
}

function resetReplies() {
  state.helper.replies = [];
  state.helper.index = 0;
  state.helper.showMeaning = false;
  el.replyCard.hidden = true;
}

el.helperMessage.addEventListener('input', () => {
  clearTimeout(messageTimer);
  state.helper.sender = ''; // a new message: its language is found again
  resetReplies();
  messageTimer = setTimeout(() => understandMessage({ auto: true }), AUTO_DELAY_MS);
});

el.helperLang.addEventListener('change', () => {
  state.helper.sender = el.helperLang.value;
  el.helperDetectFailed.hidden = state.helper.sender !== '';
  resetReplies(); // the replies must be in the new language
});

// Paste (Clipboard API); typing or the phone's own paste always work too.
el.paste.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text.trim() === '') throw new Error('empty');
    el.helperMessage.value = text.slice(0, MAX_MESSAGE);
    state.helper.sender = '';
    resetReplies();
    understandMessage({ auto: true });
  } catch {
    showMessage('voiceTranslator.pasteFailed');
    el.helperMessage.focus();
  }
});

// "Tell it what to say": typed or said in my language.
el.hintMic.addEventListener('click', () => listen('hint', myLang()));
el.hintDone.addEventListener('click', finishListening);

// "Write a reply for me": 3 short replies in the sender's language, with their meanings.
async function writeReply() {
  if (state.helper.busy) return;
  if (messageText() === '') {
    showMessage('voiceTranslator.emptyMessage');
    el.helperMessage.focus();
    return;
  }
  if (!state.helper.sender) await understandMessage({ auto: true }); // finds the language first
  const sender = state.helper.sender;
  if (!sender) {
    el.helperMeaning.hidden = false;
    el.helperDetectFailed.hidden = false;
    el.helperLang.focus();
    return;
  }
  hideMessage();
  state.helper.busy = true;
  setHelperWorking('voiceTranslator.writing');
  const reply = await writeReplies({ text: messageText(), senderLang: sender, myLang: myLang(), hint: el.hintInput.value.trim().slice(0, MAX_HINT) });
  state.helper.busy = false;
  setHelperWorking('');
  const replies = cleanReplies(reply);
  if (reply.error || replies.length === 0) {
    showMessage(errorKey(reply.error || 'empty'));
    return;
  }
  state.helper.replies = replies;
  state.helper.index = 0;
  state.helper.showMeaning = false;
  renderReply();
  el.replyText.setAttribute('tabindex', '-1');
  el.replyText.focus();
}

function currentReply() {
  return state.helper.replies[state.helper.index] ?? null;
}

function renderReply() {
  const reply = currentReply();
  el.replyCard.hidden = !reply;
  if (!reply) return;
  const sender = state.helper.sender;
  setI18nText(el.replyLabel, 'voiceTranslator.replyIn', { language: nameOf(sender) });
  el.replyText.textContent = reply.reply; // plain text, never HTML
  el.replyText.lang = sender;
  el.replyMeaning.textContent = reply.meaning;
  el.replyMeaning.lang = myLang();
  el.replyMeaning.hidden = !state.helper.showMeaning || reply.meaning === '';
  el.meaningButton.hidden = reply.meaning === '';
  el.meaningButton.setAttribute('aria-pressed', String(state.helper.showMeaning));
  if (state.helper.showMeaning) setI18nText(el.meaningLabel, 'voiceTranslator.hideMeaning');
  else setI18nText(el.meaningLabel, 'voiceTranslator.seeIn', { language: nameOf(myLang()) });
  const total = state.helper.replies.length;
  el.replyCount.hidden = total < 2;
  setI18nText(el.replyCount, 'voiceTranslator.replyCount', { n: state.helper.index + 1, total });
}

el.replyButton.addEventListener('click', writeReply);
el.meaningButton.addEventListener('click', () => {
  state.helper.showMeaning = !state.helper.showMeaning; // no extra call: the meaning came with the reply
  renderReply();
});
el.anotherButton.addEventListener('click', () => {
  const next = nextReplyIndex(state.helper.index, state.helper.replies.length);
  if (next === null) {
    writeReply(); // all shown: write new ones
    return;
  }
  state.helper.index = next;
  renderReply();
});
el.replyCopy.addEventListener('click', () => {
  const reply = currentReply();
  if (reply) copyText(reply.reply);
});
el.replyShare.addEventListener('click', async () => {
  const reply = currentReply();
  if (!reply || !canShareText(navigator)) return;
  try {
    await navigator.share({ text: reply.reply });
  } catch {
    // the user closed the share sheet
  }
});

// ---------- Start ----------

function renderSingle() {
  fillSelect(el.from, state.from);
  fillSelect(el.to, state.to);
  preloadDoneWords(state.from);
}

function renderAll() {
  renderSingle();
  fillSelect(el.meSelect, state.me);
  fillSelect(el.otherSelect, state.other);
  renderMode();
  renderMics();
  renderResult();
  renderChat();
  renderHistory();
  renderBusy();
  fillHelperLang();
  renderReply();
}

el.share.hidden = !canShareText(navigator);
el.replyShare.hidden = !canShareText(navigator);
el.paste.hidden = typeof navigator.clipboard?.readText !== 'function';
el.speakAuto.checked = state.speakAuto;
createEngine();
renderAll();
