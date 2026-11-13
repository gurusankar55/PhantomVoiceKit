// Pumpkin math: counting, adding and taking away with pumpkin pictures, 5 levels. The answer is
// tapped on the number buttons (0 to 20, always there) or said aloud (digits, or number words in
// the chosen language). A right answer gives coins; 5 in a row give a level-up, a gift and the next
// level. A wrong answer gently counts the pumpkins together. No Gemini calls.

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createSpeechInput } from '/skeleton/speech-input.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { createNavMenu } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n } from '/skeleton/i18n.js';
import { correct, levelUp, giftBox } from '/skeleton/celebrate.js';
import { spokenNumber, numberFormsFrom } from '/skeleton/number-words.js';
import {
  LEVELS,
  MAX_ANSWER,
  clampLevel,
  nextLevel,
  newProblem,
  isRight,
  nextStreak,
  isGiftStreak,
  pumpkinsOf,
  countingSteps,
} from '/apps/pumpkin-math/math-utils.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

const LEVEL_KEY = 'phantomVoiceKit.pumpkinMath.level';
const COUNT_STEP_MS = 700; // one pumpkin at a time when counting together
const SPEAK_GUARD_MS = 4000;

const levelsEl = document.getElementById('levels');
const levelText = document.getElementById('level-text');
const questionEl = document.getElementById('question');
const pumpkinsEl = document.getElementById('pumpkins');
const streakEl = document.getElementById('streak');
const messageEl = document.getElementById('message');
const nextButton = document.getElementById('next-button');
const speakButton = document.getElementById('speak-button');
const listeningIndicator = document.getElementById('listening-indicator');
const padEl = document.getElementById('pad');

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function readLevel() {
  try {
    return clampLevel(storage()?.getItem(LEVEL_KEY) || 1);
  } catch {
    return 1;
  }
}
function writeLevel(level) {
  try {
    storage()?.setItem(LEVEL_KEY, String(level));
  } catch {
    // not remembered: the game still works
  }
}

const state = {
  language: getCurrentLanguage(),
  level: readLevel(),
  problem: null,
  streak: 0,
  answered: false, // the current question is finished (right, or counted together)
};
let speechInput = null;
let speechOutput = null;
let listening = false;
let voiceOff = false;
let runId = 0;

const nav = createNavMenu(document.getElementById('app-header'), { current: 'pumpkin-math', onLeave: stopVoice });
createLanguageDropdown(nav.languageEl, {
  onChange: (lang) => {
    state.language = lang;
    createEngines();
    renderQuestion();
  },
});
state.language = getCurrentLanguage();

// ---------- Speech ----------

function stopVoice() {
  if (speechInput && speechInput.supported) speechInput.stop();
  if (speechOutput) speechOutput.stop();
  setListening(false);
}

function createEngines() {
  stopVoice();
  speechOutput = createSpeechOutput({ lang: state.language.bcp47 });
  const created = createSpeechInput({
    lang: state.language.bcp47,
    onResult: (text) => {
      if (speechInput === created) handleHeard(text);
    },
    onError: (info) => {
      if (speechInput === created) handleVoiceError(info);
    },
  });
  speechInput = created;
  voiceOff = !created.supported;
  speakButton.hidden = voiceOff;
}

function setListening(on) {
  listening = on;
  listeningIndicator.hidden = !on;
  speakButton.disabled = on;
}

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

speakButton.addEventListener('click', () => {
  if (voiceOff || listening || state.answered || !speechInput || !speechInput.supported) return;
  if (speechOutput) speechOutput.stop();
  hideMessage();
  setListening(true);
  speechInput.start({ continuous: false, lang: state.language.bcp47 });
});

function handleHeard(text) {
  setListening(false);
  if (state.answered) return;
  const heard = String(text ?? '').trim();
  const number = heard === '' ? null : spokenNumber(heard, state.language.bcp47, numberFormsFrom(t));
  if (number === null) {
    showMessage('pumpkinMath.notNumber');
    return;
  }
  answer(number, heard);
}

function handleVoiceError(info) {
  setListening(false);
  if (!info) return;
  if (info.fallbackOnly || ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(info.error)) {
    voiceOff = true;
    speakButton.hidden = true;
    showMessage('pumpkinMath.voiceOff'); // the number buttons keep working
  } else {
    showMessage('pumpkinMath.notNumber');
  }
}

// ---------- Messages ----------

function showMessage(key, params) {
  setI18nText(messageEl, key, params);
  messageEl.hidden = false;
}

function hideMessage() {
  clearI18n(messageEl);
  messageEl.hidden = true;
}

// ---------- The question ----------

// The question as words: shown and spoken.
function questionKey(problem) {
  return { count: 'pumpkinMath.qCount', add: 'pumpkinMath.qAdd', sub: 'pumpkinMath.qSub' }[problem.kind];
}
function spokenKey(problem) {
  return { count: 'pumpkinMath.qCount', add: 'pumpkinMath.sayAdd', sub: 'pumpkinMath.saySub' }[problem.kind];
}

function renderQuestion() {
  const p = state.problem;
  setI18nText(levelText, 'pumpkinMath.level', { level: state.level });
  setI18nText(questionEl, questionKey(p), { a: p.a, b: p.b });
  setI18nText(streakEl, 'pumpkinMath.streak', { count: state.streak });
  renderLevels();
}

function renderPumpkins() {
  pumpkinsEl.textContent = '';
  const kinds = pumpkinsOf(state.problem);
  pumpkinsEl.classList.toggle('math-pumpkins--many', kinds.length > 10);
  kinds.forEach((kind) => {
    const item = document.createElement('li');
    item.className = `math-pumpkin math-pumpkin--${kind}`;
    const face = document.createElement('span');
    face.className = 'math-pumpkin-face';
    face.textContent = '🎃';
    const count = document.createElement('span');
    count.className = 'math-count';
    item.append(face, count);
    pumpkinsEl.appendChild(item);
  });
}

function newQuestion() {
  runId += 1;
  stopVoice();
  hideMessage();
  state.answered = false;
  nextButton.hidden = true;
  state.problem = newProblem(state.level, state.problem);
  renderPumpkins();
  renderQuestion();
  setPadEnabled(true);
  speak(t(spokenKey(state.problem), { a: state.problem.a, b: state.problem.b }));
}

// ---------- Answering ----------

function answer(number, heard = '') {
  if (state.answered) return;
  stopVoice();
  const right = isRight(state.problem, number);
  state.streak = nextStreak(state.streak, right);
  setI18nText(streakEl, 'pumpkinMath.streak', { count: state.streak });
  state.answered = true;
  setPadEnabled(false);
  markButton(number, right);

  if (right) {
    showMessage('pumpkinMath.correct');
    if (heard) messageEl.append(' ', t('pumpkinMath.heard', { text: heard }));
    nextButton.hidden = false;
    nextButton.focus();
    correct({ coins: 1, from: questionEl });
    speak(t('pumpkinMath.correct'));
    if (isGiftStreak(state.streak)) {
      levelUp();
      giftBox();
      if (state.level < LEVELS[LEVELS.length - 1]) {
        setLevel(nextLevel(state.level), false);
        showMessage('pumpkinMath.nextLevel', { level: state.level });
      }
    }
  } else {
    countTogether();
  }
}

// A wrong answer: count the pumpkins together, one by one, gently.
async function countTogether() {
  const myId = ++runId;
  showMessage('pumpkinMath.wrong');
  await speak(t('pumpkinMath.wrong'));
  const items = pumpkinsEl.querySelectorAll('.math-pumpkin');
  for (const step of countingSteps(state.problem)) {
    if (myId !== runId) return;
    const item = items[step.index];
    item.classList.add('math-pumpkin--counted');
    item.querySelector('.math-count').textContent = String(step.number);
    speak(String(step.number));
    await new Promise((resolve) => setTimeout(resolve, COUNT_STEP_MS));
  }
  if (myId !== runId) return;
  showMessage('pumpkinMath.answerIs', { answer: state.problem.answer });
  markButton(state.problem.answer, true);
  speak(t('pumpkinMath.answerIs', { answer: state.problem.answer }));
  nextButton.hidden = false;
  nextButton.focus();
}

nextButton.addEventListener('click', () => newQuestion());

// ---------- Number buttons 0 to 20 ----------

function buildPad() {
  padEl.textContent = '';
  for (let n = 0; n <= MAX_ANSWER; n++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'math-key';
    button.textContent = String(n);
    button.dataset.n = String(n);
    button.addEventListener('click', () => answer(n));
    padEl.appendChild(button);
  }
}

function setPadEnabled(on) {
  for (const button of padEl.querySelectorAll('button')) {
    button.disabled = !on;
    button.classList.remove('math-key--right', 'math-key--wrong');
  }
}

function markButton(n, right) {
  const button = padEl.querySelector(`[data-n="${n}"]`);
  if (button) button.classList.add(right ? 'math-key--right' : 'math-key--wrong');
}

// ---------- Levels ----------

function setLevel(level, start = true) {
  state.level = clampLevel(level);
  writeLevel(state.level);
  renderLevels();
  setI18nText(levelText, 'pumpkinMath.level', { level: state.level });
  if (start) {
    state.streak = 0;
    newQuestion();
  }
}

function renderLevels() {
  levelsEl.textContent = '';
  for (const level of LEVELS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'math-level-button';
    const number = document.createElement('span');
    number.className = 'math-level-number';
    number.textContent = String(level);
    const name = document.createElement('span');
    setI18nText(name, `pumpkinMath.levelName${level}`);
    button.append(number, name);
    button.setAttribute('aria-pressed', String(level === state.level));
    button.addEventListener('click', () => setLevel(level, true));
    levelsEl.appendChild(button);
  }
}

// ---------- Start ----------

createEngines();
buildPad();
state.problem = newProblem(state.level, null);
renderPumpkins();
renderQuestion();
setPadEnabled(true);
