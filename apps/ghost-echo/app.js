// Ghost Echo: a voice memory game.
// The ghost shows and speaks a few picture words in the chosen language (2 at level 1, one more
// each level). The player says them back in the same order, or taps the pictures. The check of
// what was said is forgiving (see echo-utils.js). No Gemini calls: everything runs on the device.

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createSpeechInput } from '/skeleton/speech-input.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { createNavMenu } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n } from '/skeleton/i18n.js';
import { parseWords } from '/skeleton/voice-commands.js';
import { correct, levelUp, giftBox } from '/skeleton/celebrate.js';
import {
  WORD_IDS,
  wordKey,
  emojiOf,
  wordForms,
  makeSequence,
  choiceWords,
  matchSequence,
  tapsMatch,
  isMilestone,
  loadBest,
  saveBest,
} from '/apps/ghost-echo/echo-utils.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

// ---------- Timing ----------

const SHOW_MIN_MS = 1300; // each picture stays at least this long
const GAP_MS = 350; // a short pause between two pictures
const SPEAK_GUARD_MS = 4000; // a voice that never says it finished does not block the game
const ENGLISH_DONE_WORDS = ['done', 'finished'];

// ---------- DOM ----------

const screens = {
  start: document.getElementById('screen-start'),
  play: document.getElementById('screen-play'),
};
const startButton = document.getElementById('start-button');
const bestStart = document.getElementById('best-start');
const levelText = document.getElementById('level-text');
const bestText = document.getElementById('best-text');
const stageStatus = document.getElementById('stage-status');
const stageCard = document.getElementById('stage-card');
const stageEmoji = document.getElementById('stage-emoji');
const stageWord = document.getElementById('stage-word');
const stageDots = document.getElementById('stage-dots');
const answerArea = document.getElementById('answer-area');
const answerSlots = document.getElementById('answer-slots');
const speakButton = document.getElementById('speak-button');
const doneButton = document.getElementById('done-button');
const listeningIndicator = document.getElementById('listening-indicator');
const liveText = document.getElementById('live-text');
const voiceMessage = document.getElementById('voice-message');
const choicesEl = document.getElementById('choices');
const clearButton = document.getElementById('clear-button');
const resultArea = document.getElementById('result-area');
const resultText = document.getElementById('result-text');
const heardText = document.getElementById('heard-text');
const rightOrder = document.getElementById('right-order');
const nextButton = document.getElementById('next-button');
const retryButton = document.getElementById('retry-button');

// ---------- State ----------

const state = {
  language: getCurrentLanguage(),
  level: 1,
  sequence: [], // word ids in the order they were shown
  choices: [], // the picture buttons
  taps: [], // word ids tapped so far
  phase: 'start', // 'start' | 'show' | 'answer' | 'result'
};
let runId = 0; // every new step increases it; old timers and callbacks then do nothing
let speechInput = null;
let speechOutput = null;
let listening = false;
let voiceOff = false;

// localStorage may be blocked: every use is in try/catch (inside echo-utils too).
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
let best = loadBest(storage());

// ---------- Words ----------

// The shown and spoken name of a word in the chosen language (the first form).
function wordLabel(id) {
  return wordForms(t(wordKey(id)))[0] || id;
}

// Every word's ways to say it in the chosen language.
function allForms() {
  const forms = {};
  for (const id of WORD_IDS) forms[id] = wordForms(t(wordKey(id)));
  return forms;
}

// A picture with its name: [emoji] [word].
function pictureContent(container, id) {
  container.textContent = '';
  const emoji = document.createElement('span');
  emoji.className = 'echo-emoji';
  emoji.setAttribute('aria-hidden', 'true');
  emoji.textContent = emojiOf(id);
  const word = document.createElement('span');
  word.className = 'echo-word';
  word.textContent = wordLabel(id);
  container.append(emoji, word);
}

// ---------- Nav, language and speech ----------

function handleBack() {
  if (state.phase === 'start') return false; // leave to Home
  goToStart();
  return true;
}

function stopVoice() {
  if (speechOutput) speechOutput.stop();
  if (speechInput && speechInput.supported) speechInput.stop();
  setListening(false);
}

const nav = createNavMenu(document.getElementById('app-header'), {
  current: 'ghost-echo',
  onBack: handleBack,
  onLeave: stopVoice,
});

createLanguageDropdown(nav.languageEl, {
  onChange: (lang) => {
    state.language = lang;
    createEngines();
    refreshWords();
    // The pictures were being spoken in the old language: show them again in the new one.
    if (state.phase === 'show') showSequence();
  },
});
state.language = getCurrentLanguage();

function createEngines() {
  if (speechOutput) speechOutput.stop();
  if (speechInput && speechInput.supported) speechInput.stop();
  setListening(false);
  const lang = state.language.bcp47;
  speechOutput = createSpeechOutput({ lang });
  const created = createSpeechInput({
    lang,
    onResult: (text) => {
      if (speechInput === created) handleHeard(text);
    },
    onError: (info) => {
      if (speechInput === created) handleVoiceError(info);
    },
    onInterim: (text) => {
      if (speechInput === created) handleInterim(text);
    },
  });
  speechInput = created;
  setVoiceOff(!created.supported);
}

function setVoiceOff(off) {
  voiceOff = off;
  speakButton.hidden = off;
  if (off) showVoiceMessage('ghostEcho.voiceOff');
  else hideVoiceMessage();
}

function showVoiceMessage(key) {
  setI18nText(voiceMessage, key);
  voiceMessage.hidden = false;
}

function hideVoiceMessage() {
  clearI18n(voiceMessage);
  voiceMessage.hidden = true;
}

function setListening(on) {
  listening = on;
  listeningIndicator.hidden = !on;
  doneButton.hidden = !on;
  speakButton.hidden = on || voiceOff;
  if (!on) {
    liveText.hidden = true;
    liveText.textContent = '';
  }
}

// Speak a text; resolves when it is finished, could not be spoken, or after a guard time.
function speak(text) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, SPEAK_GUARD_MS);
    try {
      speechOutput.speak(text, { onEnd: finish, onError: finish });
    } catch {
      finish();
    }
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Screens ----------

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

function renderBest() {
  for (const el of [bestStart, bestText]) {
    if (best > 0) {
      setI18nText(el, 'ghostEcho.best', { level: best });
      el.hidden = false;
    } else {
      clearI18n(el);
      el.hidden = true;
    }
  }
}

function goToStart() {
  runId += 1;
  stopVoice();
  state.phase = 'start';
  showScreen('start');
  renderBest();
  startButton.focus();
}

// ---------- One level ----------

function startLevel(sameWords = false) {
  runId += 1;
  stopVoice();
  if (!sameWords || state.sequence.length === 0) {
    state.sequence = makeSequence(state.level);
    state.choices = choiceWords(state.sequence);
  }
  state.taps = [];
  showScreen('play');
  setI18nText(levelText, 'ghostEcho.level', { level: state.level });
  renderBest();
  answerArea.hidden = true;
  resultArea.hidden = true;
  hideVoiceMessage();
  if (voiceOff) showVoiceMessage('ghostEcho.voiceOff');
  showSequence();
}

// The ghost shows and says the words one by one.
async function showSequence() {
  runId += 1;
  const myId = runId;
  stopVoice();
  state.phase = 'show';
  answerArea.hidden = true;
  setI18nText(stageStatus, 'ghostEcho.watch');
  renderDots(-1);
  await sleep(500);

  for (let i = 0; i < state.sequence.length; i++) {
    if (myId !== runId) return;
    const id = state.sequence[i];
    stageEmoji.textContent = emojiOf(id);
    stageWord.textContent = wordLabel(id);
    stageCard.hidden = false;
    stageCard.classList.remove('echo-card--in');
    void stageCard.offsetWidth; // restart the small "appear" animation
    stageCard.classList.add('echo-card--in');
    renderDots(i);
    await Promise.all([speak(wordLabel(id)), sleep(SHOW_MIN_MS)]);
    if (myId !== runId) return;
    stageCard.hidden = true;
    await sleep(GAP_MS);
  }
  if (myId !== runId) return;
  beginAnswer();
}

function renderDots(current) {
  stageDots.textContent = '';
  state.sequence.forEach((id, i) => {
    const dot = document.createElement('li');
    dot.className = i <= current ? 'echo-dot echo-dot--on' : 'echo-dot';
    stageDots.appendChild(dot);
  });
}

// The player's turn: picture buttons (always) and the Speak button (when voice works).
function beginAnswer() {
  state.phase = 'answer';
  state.taps = [];
  setI18nText(stageStatus, 'ghostEcho.yourTurn');
  answerArea.hidden = false;
  resultArea.hidden = true;
  renderChoices();
  renderSlots();
  speak(t('ghostEcho.yourTurn'));
  (voiceOff ? choicesEl.querySelector('button') : speakButton)?.focus();
}

function renderChoices() {
  choicesEl.textContent = '';
  for (const id of state.choices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'echo-choice';
    button.dataset.id = id;
    pictureContent(button, id);
    button.addEventListener('click', () => tapWord(id));
    choicesEl.appendChild(button);
  }
}

// One slot for each word to say: what was tapped so far, then empty slots.
function renderSlots() {
  answerSlots.textContent = '';
  state.sequence.forEach((_, i) => {
    const slot = document.createElement('li');
    const id = state.taps[i];
    if (id) {
      slot.className = 'echo-slot echo-slot--filled';
      pictureContent(slot, id);
    } else {
      slot.className = 'echo-slot';
      slot.textContent = '?';
    }
    answerSlots.appendChild(slot);
  });
  clearButton.hidden = state.taps.length === 0;
}

function tapWord(id) {
  if (state.phase !== 'answer') return;
  if (listening) stopVoice(); // tapping wins over listening
  state.taps.push(id);
  renderSlots();
  if (state.taps.length === state.sequence.length) finishAnswer(tapsMatch(state.taps, state.sequence), '');
}

clearButton.addEventListener('click', () => {
  state.taps = [];
  renderSlots();
  choicesEl.querySelector('button')?.focus();
});

// ---------- Voice ----------

speakButton.addEventListener('click', () => {
  if (state.phase !== 'answer' || voiceOff || !speechInput || !speechInput.supported || listening) return;
  if (speechOutput) speechOutput.stop();
  hideVoiceMessage();
  setListening(true);
  speechInput.start({
    continuous: true,
    lang: state.language.bcp47,
    doneWords: [...parseWords(t('voice.doneWords')), ...ENGLISH_DONE_WORDS],
  });
});

doneButton.addEventListener('click', () => {
  if (listening && speechInput && speechInput.supported) speechInput.finish();
});

// While speaking: show what is heard, and stop as soon as every word was said in order.
function handleInterim(text) {
  if (!listening) return;
  liveText.textContent = text;
  liveText.hidden = text === '';
  if (matchSequence(text, state.sequence, allForms(), state.language.bcp47).ok) speechInput.finish();
}

function handleHeard(text) {
  if (!listening) return;
  setListening(false);
  if (state.phase !== 'answer') return;
  const heard = String(text ?? '').trim();
  if (heard === '') {
    showVoiceMessage('ghostEcho.nothingHeard');
    return;
  }
  const result = matchSequence(heard, state.sequence, allForms(), state.language.bcp47);
  finishAnswer(result.ok, heard);
}

function handleVoiceError(info) {
  const wasListening = listening;
  setListening(false);
  if (!info) return;
  const broken = info.fallbackOnly || ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(info.error);
  if (broken) {
    setVoiceOff(true); // the picture buttons keep working
    return;
  }
  if (wasListening && state.phase === 'answer') showVoiceMessage('ghostEcho.nothingHeard');
}

// ---------- Result ----------

function finishAnswer(ok, heard) {
  runId += 1;
  stopVoice();
  state.phase = 'result';
  answerArea.hidden = true;
  resultArea.hidden = false;
  stageStatus.textContent = '';
  clearI18n(stageStatus);

  if (heard) {
    setI18nText(heardText, 'ghostEcho.heard', { text: heard }); // plain text, never HTML
    heardText.hidden = false;
  } else {
    clearI18n(heardText);
    heardText.hidden = true;
  }

  if (ok) {
    setI18nText(resultText, 'ghostEcho.correct');
    rightOrder.hidden = true;
    nextButton.hidden = false;
    retryButton.hidden = true;
    correct({ coins: state.sequence.length, from: resultText });
    best = saveBest(storage(), state.level);
    renderBest();
    if (isMilestone(state.level)) {
      levelUp();
      giftBox();
    }
    speak(t('ghostEcho.correct'));
    nextButton.focus();
  } else {
    // Gently show the right order and offer to try the same words again.
    setI18nText(resultText, 'ghostEcho.wrong');
    renderRightOrder();
    rightOrder.hidden = false;
    nextButton.hidden = true;
    retryButton.hidden = false;
    speak(`${t('ghostEcho.wrong')} ${state.sequence.map(wordLabel).join(', ')}`);
    retryButton.focus();
  }
}

function renderRightOrder() {
  rightOrder.textContent = '';
  for (const id of state.sequence) {
    const item = document.createElement('li');
    item.className = 'echo-slot echo-slot--filled';
    pictureContent(item, id);
    rightOrder.appendChild(item);
  }
}

nextButton.addEventListener('click', () => {
  state.level += 1;
  startLevel(false);
});

retryButton.addEventListener('click', () => startLevel(true));

startButton.addEventListener('click', () => {
  state.level = 1;
  startLevel(false);
});

// New language: every picture name on the screen in the new language.
function refreshWords() {
  if (state.phase === 'answer') {
    renderChoices();
    renderSlots();
  }
  if (state.phase === 'result' && !rightOrder.hidden) renderRightOrder();
}

// ---------- Start ----------

createEngines();
goToStart();
