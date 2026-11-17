// Talk & Learn: learn to SPEAK another language through short, real two-person conversations.
// 36 lessons in 3 levels (none locked). Each lesson has three ways to learn it (Listen, Line by line, Practice as person B)
// and ends with the key words and a 3-question quiz. A lesson comes from a built-in file, then from the
// browser's saved lessons, and only then from Gemini (the answer is saved). The next lesson is prepared
// quietly in the background.

import { createLanguageDropdown, getCurrentLanguage, LANGUAGES } from '/skeleton/language-dropdown.js';
import { createSpeechInput } from '/skeleton/speech-input.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { createTextFallback } from '/skeleton/text-fallback.js';
import { createNavMenu } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, setI18nAttr, clearI18n } from '/skeleton/i18n.js';
import { conversation } from '/skeleton/api-client.js';
import { correct } from '/skeleton/celebrate.js';
import {
  LEVELS,
  levelProgress,
  lessonTitleKey,
  nextLessonId,
  learnOptions,
  loadSettings,
  saveSettings,
  loadProgress,
  saveProgress,
  isComplete,
  markComplete,
  completedCount,
  LESSONS,
  scoreSpeech,
  starsFor,
  buildQuiz,
  isQuizAnswer,
} from '/apps/talk-learn/talk-utils.js';
import { createLessonStore } from '/apps/talk-learn/lesson-store.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

// ---------- The page ----------

const $ = (id) => document.getElementById(id);
const screens = { list: $('screen-list'), lesson: $('screen-lesson') };
const speakName = $('speak-name');
const learnSelect = $('learn-select');
const listProgress = $('list-progress');
const lessonList = $('lesson-list');

const lessonTitle = $('lesson-title');
const lessonLangs = $('lesson-langs');
const loadingEl = $('lesson-loading');
const loadingMessage = $('loading-message');
const errorBox = $('lesson-error');
const errorText = $('lesson-error-text');
const bodyEl = $('lesson-body');
const noVoice = $('no-voice');

const modeButtons = { listen: $('mode-listen'), line: $('mode-line'), practice: $('mode-practice') };
const panels = { listen: $('panel-listen'), line: $('panel-line'), practice: $('panel-practice'), end: $('panel-end') };

const listenLines = $('listen-lines');
const listenPlay = $('listen-play');

const lineCount = $('line-count');
const lineCard = $('line-card');
const linePlay = $('line-play');
const lineSlow = $('line-slow');
const lineNext = $('line-next');

const practiceCount = $('practice-count');
const practiceChat = $('practice-chat');
const practiceWaiting = $('practice-waiting');
const practiceContinue = $('practice-continue');
const practiceTurn = $('practice-turn');
const turnCard = $('turn-card');
const turnPlay = $('turn-play');
const turnSpeak = $('turn-speak');
const turnListening = $('turn-listening');
const turnMessage = $('turn-message');
const turnType = $('turn-type');
const practiceResult = $('practice-result');
const resultStars = $('result-stars');
const resultScore = $('result-score');
const resultFeedback = $('result-feedback');
const resultHeard = $('result-heard');
const resultCard = $('result-card');
const resultPlay = $('result-play');
const resultNext = $('result-next');

const keywordsEl = $('keywords');
const quizStart = $('quiz-start');
const quizEl = $('quiz');
const quizProgress = $('quiz-progress');
const quizQuestion = $('quiz-question');
const quizSay = $('quiz-say');
const quizOptions = $('quiz-options');
const quizFeedback = $('quiz-feedback');
const quizNext = $('quiz-next');
const lessonDone = $('lesson-done');
const quizResult = $('quiz-result');
const nextLessonButton = $('next-lesson');

// The buttons that make sound: they are switched off when the device has no voice.
const voiceButtons = [listenPlay, linePlay, lineSlow, turnPlay, resultPlay];

// ---------- State ----------

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const findLanguage = (code) => LANGUAGES.find((language) => language.bcp47 === code) ?? LANGUAGES[0];

let progress = loadProgress(storage());

// Built-in lessons, the browser's saved lessons, then the server; and the quiet prefetch of the next one.
const store = createLessonStore({
  fetchFn: window.fetch.bind(window),
  storage: storage(),
  request: conversation,
  isOnline: () => navigator.onLine !== false,
  session: sessionStore(), // a busy answer stops the background for the rest of this browser session
});

function sessionStore() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// The server request of the lesson being opened. Cancel (or leaving) aborts it, and then nothing is saved.
let loadController = null;

function cancelLoad() {
  if (loadController) loadController.abort();
  loadController = null;
}
const state = {
  speak: getCurrentLanguage(), // "I speak": the UI language
  learn: LANGUAGES[0], // "I want to learn" (set in start())
  lessonId: '',
  convo: null, // { lines, keyWords } of the open lesson
  mode: 'listen', // 'listen' | 'line' | 'practice' | 'end'
  voiceOk: true, // the device has a voice for the language being learned
  playing: false, // Listen: the conversation is being played
  lineIndex: 0, // Line by line
  practiceIndex: 0, // Practice: the line being played or practised
  turnLine: null, // Practice: the line the user has to say now
  listening: false, // the microphone is open
  quiz: [],
  quizIndex: 0,
  quizScore: 0,
};
let speechOutput = null;
let speechInput = null;
let voiceInputOff = false;
let runId = 0; // every new spoken step makes the callbacks of older steps do nothing
let speakTimer = null; // the short wait between stopping and speaking (Chrome drops speech right after cancel)
let waitTimer = null; // the pause between two lines
let loadToken = 0; // a lesson that finishes loading after the user left is ignored
const SPEAK_AFTER_STOP_MS = 80;
const PAUSE_BETWEEN_LINES_MS = 400;
const SLOW_RATE = 0.7;

// ---------- Small helpers ----------

function nameOf(language) {
  return language.native === language.label ? language.native : `${language.native} – ${language.label}`;
}

function setButton(button, icon, key) {
  button.textContent = '';
  const iconEl = document.createElement('span');
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  const label = document.createElement('span');
  setI18nText(label, key);
  button.append(iconEl, ' ', label);
}

function showText(el, key, params) {
  setI18nText(el, key, params);
  el.hidden = false;
}

function hideText(el) {
  clearI18n(el);
  el.hidden = true;
}

// ---------- Speech ----------

// Stop everything that is playing or listening. Callbacks of earlier steps now do nothing.
function stopAll() {
  runId += 1;
  clearTimeout(speakTimer);
  clearTimeout(waitTimer);
  if (speechOutput) speechOutput.stop();
  if (speechInput && speechInput.supported) speechInput.stop();
  state.playing = false;
  setListening(false);
  renderListenButton();
}

// A speech engine for each direction, for the language being learned.
function createEngines() {
  stopAll();
  speechOutput = createSpeechOutput({ lang: state.learn.bcp47 });
  const created = createSpeechInput({
    lang: state.learn.bcp47,
    onResult: (text) => {
      if (speechInput === created) handleHeard(text);
    },
    onError: (info) => {
      if (speechInput === created) handleVoiceError(info);
    },
  });
  speechInput = created;
  voiceInputOff = !created.supported;
  turnSpeak.hidden = voiceInputOff; // the typed answer stays
}

// Speak one text. Resolves 'done', 'unavailable' (no voice), 'error', or 'stale' (stopped or
// replaced by a newer step: the caller must do nothing more).
function speakText(text, role, rate, myRun) {
  return new Promise((resolve) => {
    clearTimeout(speakTimer);
    speakTimer = setTimeout(() => {
      if (myRun !== runId) {
        resolve('stale');
        return;
      }
      speechOutput.speak(text, {
        role,
        rate,
        onEnd: () => resolve(myRun === runId ? 'done' : 'stale'),
        onError: (info) => resolve(myRun !== runId ? 'stale' : info && info.audioUnavailable ? 'unavailable' : 'error'),
      });
    }, SPEAK_AFTER_STOP_MS);
  });
}

function pause(ms) {
  return new Promise((resolve) => {
    clearTimeout(waitTimer);
    waitTimer = setTimeout(resolve, ms);
  });
}

const roleOf = (line) => (line.speaker === 'A' ? 'a' : 'b');

// The device has no voice for the language being learned: the text stays, the sound buttons stop.
function setVoice(ok) {
  state.voiceOk = ok;
  if (ok) hideText(noVoice);
  else showText(noVoice, 'talkLearn.noVoice', { language: state.learn.native });
  for (const button of voiceButtons) button.disabled = !ok;
  for (const button of keywordsEl.querySelectorAll('.tl-hear')) button.disabled = !ok;
}

function setListening(on) {
  state.listening = on;
  turnListening.hidden = !on;
  turnSpeak.disabled = on;
}

// ---------- Lines on the screen ----------

// The three texts of a line: the sentence, how it sounds, what it means.
function lineParts(line) {
  const text = document.createElement('span');
  text.className = 'tl-text';
  text.lang = state.learn.bcp47;
  text.dir = 'auto';
  text.textContent = line.text;
  const say = document.createElement('span');
  say.className = 'tl-say';
  say.lang = state.speak.bcp47;
  say.dir = 'auto';
  say.textContent = line.say;
  const meaning = document.createElement('span');
  meaning.className = 'tl-meaning';
  meaning.lang = state.speak.bcp47;
  meaning.dir = 'auto';
  meaning.textContent = line.meaning;
  return [text, say, meaning];
}

// "A" or "B" in a round badge.
function whoBadge(line) {
  const badge = document.createElement('span');
  badge.className = 'tl-who';
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', t(line.speaker === 'A' ? 'talkLearn.personA' : 'talkLearn.personB'));
  badge.textContent = line.speaker;
  return badge;
}

// One line of a conversation (a chat bubble).
function lineItem(line) {
  const item = document.createElement('li');
  item.className = `tl-line tl-line--${line.speaker.toLowerCase()}`;
  const body = document.createElement('span');
  body.className = 'tl-line-body';
  body.append(...lineParts(line));
  item.append(whoBadge(line), body);
  return item;
}

// A big card for one line.
function fillCard(card, line) {
  card.textContent = '';
  card.className = `tl-card tl-card--${line.speaker.toLowerCase()}`;
  const head = document.createElement('div');
  head.className = 'tl-card-head';
  head.append(whoBadge(line));
  const body = document.createElement('div');
  body.className = 'tl-card-body';
  body.append(...lineParts(line));
  card.append(head, body);
}

function markCurrent(listEl, index) {
  [...listEl.children].forEach((item, i) => {
    item.classList.toggle('tl-line--now', i === index);
    if (i === index) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  });
}

function scrollToEl(el) {
  if (!el) return;
  let smooth = true;
  try {
    smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // keep smooth
  }
  el.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
}

// ---------- The lesson list ----------

function showList() {
  stopAll();
  loadToken += 1; // a lesson still loading is forgotten
  cancelLoad(); // ...and its request is dropped: a cancelled lesson is never saved
  hideLoading();
  errorBox.hidden = true;
  state.lessonId = '';
  screens.list.hidden = false;
  screens.lesson.hidden = true;
  renderSetup();
  renderList();
}

// "I speak" (the UI language) and the "I want to learn" dropdown.
function renderSetup() {
  speakName.textContent = nameOf(state.speak);
  speakName.lang = state.speak.bcp47;
  speakName.dir = 'auto';
  learnSelect.textContent = '';
  for (const language of learnOptions(LANGUAGES, state.speak.bcp47)) {
    const option = document.createElement('option');
    option.value = language.bcp47;
    option.lang = language.bcp47;
    option.dir = 'auto';
    option.textContent = nameOf(language);
    option.selected = language.bcp47 === state.learn.bcp47;
    learnSelect.appendChild(option);
  }
}

// Three levels, each with a heading, its own progress and its lessons. Nothing is locked.
function renderList() {
  lessonList.textContent = '';
  let number = 0; // the lesson number counts on through the levels (1 to 36)
  for (const level of LEVELS) {
    const section = document.createElement('section');
    section.className = 'tl-level';
    section.setAttribute('aria-labelledby', `level-${level.id}-heading`);
    const heading = document.createElement('h3');
    heading.id = `level-${level.id}-heading`;
    heading.className = 'tl-level-heading';
    setI18nText(heading, level.titleKey);
    const levelDone = document.createElement('p');
    levelDone.className = 'tl-progress';
    setI18nText(levelDone, 'talkLearn.progress', levelProgress(progress, state.learn.bcp47, level.id));
    const list = document.createElement('ol');
    list.className = 'tl-lessons';

    for (const id of level.lessons) {
      number += 1;
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tl-lesson';
      const badge = document.createElement('span');
      badge.className = 'tl-lesson-number';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = String(number);
      const title = document.createElement('span');
      title.className = 'tl-lesson-name';
      setI18nText(title, lessonTitleKey(id));
      button.append(badge, title);
      if (isComplete(progress, state.learn.bcp47, id)) {
        const tick = document.createElement('span');
        tick.className = 'tl-tick';
        tick.setAttribute('role', 'img');
        setI18nAttr(tick, 'aria-label', 'talkLearn.completedLabel');
        tick.textContent = '✓';
        button.appendChild(tick);
      }
      button.addEventListener('click', () => openLesson(id));
      item.appendChild(button);
      list.appendChild(item);
    }
    section.append(heading, levelDone, list);
    lessonList.appendChild(section);
  }
  setI18nText(listProgress, 'talkLearn.progress', { done: completedCount(progress, state.learn.bcp47), total: LESSONS.length });
}

learnSelect.addEventListener('change', () => {
  state.learn = findLanguage(learnSelect.value);
  saveSettings(storage(), { speak: state.speak.bcp47, learn: state.learn.bcp47 });
  createEngines();
  renderList();
});

// ---------- Opening a lesson ----------

async function openLesson(id) {
  stopAll();
  cancelLoad(); // another lesson was loading: drop it
  const token = ++loadToken;
  state.lessonId = id;
  state.convo = null;
  screens.list.hidden = true;
  screens.lesson.hidden = false;
  bodyEl.hidden = true;
  errorBox.hidden = true;
  hideText(noVoice);
  setI18nText(lessonTitle, lessonTitleKey(id));
  setI18nText(lessonLangs, 'talkLearn.learning', { language: state.learn.native });
  lessonTitle.tabIndex = -1;
  lessonTitle.focus();
  hideLoading();

  const learnCode = state.learn.bcp47;
  const speakCode = state.speak.bcp47;

  // 1. a built-in file, 2. a lesson saved in this browser: no API call and no loading screen.
  let found = await store.getLocal(id, learnCode, speakCode);
  if (token !== loadToken) return;

  // 3. the server. The ghost keeps the user company; Cancel leaves at once (the request
  // is dropped and nothing is saved).
  if (!found) {
    showLoading();
    loadController = new AbortController();
    found = await store.get(id, learnCode, speakCode, { signal: loadController.signal });
    if (token !== loadToken) return; // cancelled, or another lesson was opened meanwhile
    loadController = null;
    hideLoading();
    if (found.error) {
      showError(found.error);
      return;
    }
  }

  state.convo = found.convo;
  bodyEl.hidden = false;
  setMode('listen');
  // Does the device have a voice for this language? Asked at the same time, so nothing waits for it.
  speechOutput.canSpeak().then((ok) => {
    if (token === loadToken) setVoice(ok);
  });
  // The next lesson is prepared quietly in the background (one request at a time, never after a busy answer).
  store.prefetchNext(id, learnCode, speakCode).catch(() => {});
}

// ---------- The friendly ghost while a lesson is made ----------

const LOADING_KEYS = ['talkLearn.loading', 'talkLearn.ghost2', 'talkLearn.ghost3', 'talkLearn.ghost4'];
const LOADING_STEP_MS = 4000;
let loadingTimer = null;
let loadingStep = 0;

function showLoading() {
  loadingStep = 0;
  setI18nText(loadingMessage, LOADING_KEYS[0]);
  loadingEl.hidden = false;
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    loadingStep = Math.min(loadingStep + 1, LOADING_KEYS.length - 1); // the last message stays
    setI18nText(loadingMessage, LOADING_KEYS[loadingStep]);
  }, LOADING_STEP_MS);
}

function hideLoading() {
  clearInterval(loadingTimer);
  loadingTimer = null;
  loadingEl.hidden = true;
}

$('cancel-button').addEventListener('click', () => showList());

function showError(code) {
  const key =
    code === 'busy' ? 'talkLearn.errBusy' : code === 'timeout' ? 'talkLearn.errTimeout' : code === 'network_error' ? 'talkLearn.errNetwork' : 'talkLearn.errFailed';
  setI18nText(errorText, key);
  errorBox.hidden = false;
}

$('retry-button').addEventListener('click', () => openLesson(state.lessonId));
$('all-lessons').addEventListener('click', showList);
$('done-lessons').addEventListener('click', showList);

// ---------- The three modes ----------

function setMode(mode) {
  stopAll();
  state.mode = mode;
  for (const [name, button] of Object.entries(modeButtons)) button.setAttribute('aria-pressed', String(name === mode));
  for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== mode;
  if (mode === 'listen') renderListen();
  else if (mode === 'line') {
    state.lineIndex = 0;
    renderLine();
  } else if (mode === 'practice') startPractice();
  else if (mode === 'end') renderEnd();
}

for (const [name, button] of Object.entries(modeButtons)) button.addEventListener('click', () => setMode(name));

// ---------- 1. Listen ----------

function renderListen() {
  listenLines.textContent = '';
  for (const line of state.convo.lines) listenLines.appendChild(lineItem(line));
  renderListenButton();
}

function renderListenButton() {
  if (!listenPlay) return;
  if (state.playing) setButton(listenPlay, '⏹️', 'talkLearn.stop');
  else setButton(listenPlay, '▶️', 'talkLearn.playAll');
  listenPlay.disabled = !state.voiceOk;
}

async function playConversation() {
  if (!state.voiceOk) return;
  stopAll();
  const myRun = runId;
  state.playing = true;
  renderListenButton();
  const lines = state.convo.lines;
  for (let i = 0; i < lines.length; i++) {
    markCurrent(listenLines, i);
    scrollToEl(listenLines.children[i]);
    const result = await speakText(lines[i].text, roleOf(lines[i]), 1, myRun);
    if (result === 'stale') return;
    if (result === 'unavailable') {
      setVoice(false);
      break;
    }
    if (result === 'error') break;
    if (i < lines.length - 1) {
      await pause(PAUSE_BETWEEN_LINES_MS);
      if (myRun !== runId) return;
    }
  }
  state.playing = false;
  markCurrent(listenLines, -1);
  renderListenButton();
}

listenPlay.addEventListener('click', () => {
  if (state.playing) stopAll();
  else playConversation();
});
$('listen-finish').addEventListener('click', () => setMode('end'));

// ---------- 2. Line by line ----------

function renderLine() {
  const lines = state.convo.lines;
  const line = lines[state.lineIndex];
  fillCard(lineCard, line);
  setI18nText(lineCount, 'talkLearn.lineOf', { n: state.lineIndex + 1, total: lines.length });
  const last = state.lineIndex === lines.length - 1;
  setButton(lineNext, last ? '✓' : '→', last ? 'talkLearn.toQuiz' : 'talkLearn.next');
}

async function playLine(rate) {
  if (!state.voiceOk) return;
  stopAll();
  const myRun = runId;
  const line = state.convo.lines[state.lineIndex];
  const result = await speakText(line.text, roleOf(line), rate, myRun);
  if (result === 'unavailable') setVoice(false);
}

linePlay.addEventListener('click', () => playLine(1));
lineSlow.addEventListener('click', () => playLine(SLOW_RATE));
lineNext.addEventListener('click', () => {
  stopAll();
  if (state.lineIndex >= state.convo.lines.length - 1) {
    setMode('end');
    return;
  }
  state.lineIndex += 1;
  renderLine();
});

// ---------- 3. Practice: the user is person B ----------

function startPractice() {
  state.practiceIndex = 0;
  runPractice();
}

// Plays person A's lines one after the other and stops at each of B's lines, where the user speaks.
async function runPractice() {
  stopAll();
  const myRun = runId;
  const lines = state.convo.lines;
  practiceTurn.hidden = true;
  practiceResult.hidden = true;
  practiceContinue.hidden = true;
  hideText(practiceWaiting);

  while (state.practiceIndex < lines.length) {
    const index = state.practiceIndex;
    const line = lines[index];
    setI18nText(practiceCount, 'talkLearn.lineOf', { n: index + 1, total: lines.length });

    if (line.speaker === 'B') {
      renderChat(index);
      showTurn(line);
      return;
    }

    // Person A speaks (the line is shown while it is spoken).
    renderChat(index + 1, true);
    if (!state.voiceOk) {
      practiceContinue.hidden = false; // no sound: the user reads the line and goes on
      return;
    }
    showText(practiceWaiting, 'talkLearn.aSpeaking');
    const result = await speakText(line.text, 'a', 1, myRun);
    if (result === 'stale') return;
    hideText(practiceWaiting);
    if (result === 'unavailable') {
      setVoice(false);
      practiceContinue.hidden = false;
      return;
    }
    state.practiceIndex += 1;
    await pause(PAUSE_BETWEEN_LINES_MS / 2);
    if (myRun !== runId) return;
  }
  setMode('end'); // the last line is done
}

// The lines said so far, like a chat. With `speaking`, the last one (person A) is being spoken.
function renderChat(count, speaking = false) {
  practiceChat.textContent = '';
  for (const line of state.convo.lines.slice(0, count)) practiceChat.appendChild(lineItem(line));
  markCurrent(practiceChat, speaking ? count - 1 : -1);
  scrollToEl(practiceChat.lastElementChild);
}

practiceContinue.addEventListener('click', () => {
  state.practiceIndex += 1;
  runPractice();
});

// The user's turn.
function showTurn(line) {
  state.turnLine = line;
  practiceResult.hidden = true;
  practiceTurn.hidden = false;
  fillCard(turnCard, line);
  hideText(turnMessage);
  const textarea = turnType.querySelector('textarea');
  if (textarea) {
    textarea.value = '';
    textarea.lang = state.learn.bcp47;
    textarea.dir = 'auto';
  }
  scrollToEl(practiceTurn);
}

turnPlay.addEventListener('click', () => playTurnLine());
resultPlay.addEventListener('click', () => playTurnLine());

async function playTurnLine() {
  if (!state.voiceOk || !state.turnLine) return;
  stopAll();
  const result = await speakText(state.turnLine.text, 'b', 1, runId);
  if (result === 'unavailable') setVoice(false);
}

turnSpeak.addEventListener('click', () => {
  if (voiceInputOff || state.listening || !speechInput || !speechInput.supported) return;
  stopAll(); // the microphone must not hear the voice
  hideText(turnMessage);
  setListening(true);
  speechInput.start({ continuous: false, lang: state.learn.bcp47 });
});

// What the microphone heard (or what was typed).
function handleHeard(heard) {
  setListening(false);
  evaluate(heard);
}

function handleVoiceError(info) {
  setListening(false);
  if (!info) return;
  if (info.fallbackOnly || ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported'].includes(info.error)) {
    voiceInputOff = true;
    turnSpeak.hidden = true;
    showText(turnMessage, 'talkLearn.voiceOff'); // the typed answer keeps working
  } else {
    showText(turnMessage, 'talkLearn.notHeard');
  }
}

// Compare what was said with the line, show the stars and the line again.
function evaluate(heard) {
  const line = state.turnLine;
  // Only while a turn is waiting for its answer (a late result after the turn must not count twice).
  if (!line || state.mode !== 'practice' || practiceTurn.hidden) return;
  stopAll();
  const score = scoreSpeech(line.text, heard);
  const stars = starsFor(score);

  practiceTurn.hidden = true;
  practiceResult.hidden = false;
  resultStars.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  resultStars.setAttribute('aria-label', t('talkLearn.starsLabel', { n: stars }));
  setI18nText(resultScore, 'talkLearn.score', { score });
  setI18nText(resultFeedback, `talkLearn.feedback${stars}`);
  resultHeard.textContent = t('talkLearn.heard', { text: heard });
  resultHeard.lang = state.learn.bcp47;
  fillCard(resultCard, line); // the expected line again
  const last = state.practiceIndex >= state.convo.lines.length - 1;
  setButton(resultNext, last ? '✓' : '→', last ? 'talkLearn.toQuiz' : 'talkLearn.nextLine');
  scrollToEl(practiceResult);
  if (stars === 3) correct({ coins: 1, from: resultStars });
}

$('result-again').addEventListener('click', () => {
  stopAll();
  showTurn(state.turnLine);
});
resultNext.addEventListener('click', () => {
  state.practiceIndex += 1;
  runPractice();
});

// The typed answer (shared text fallback), always available.
createTextFallback(turnType, { onSubmit: (text) => evaluate(text) });

// ---------- The end: key words and quiz ----------

function renderEnd() {
  keywordsEl.textContent = '';
  for (const entry of state.convo.keyWords) {
    const item = document.createElement('li');
    item.className = 'tl-keyword';
    const texts = document.createElement('span');
    texts.className = 'tl-keyword-text';
    const word = document.createElement('span');
    word.className = 'tl-text';
    word.lang = state.learn.bcp47;
    word.dir = 'auto';
    word.textContent = entry.word;
    const say = document.createElement('span');
    say.className = 'tl-say';
    say.lang = state.speak.bcp47;
    say.dir = 'auto';
    say.textContent = entry.say;
    const meaning = document.createElement('span');
    meaning.className = 'tl-meaning';
    meaning.lang = state.speak.bcp47;
    meaning.dir = 'auto';
    meaning.textContent = entry.meaning;
    texts.append(word, say, meaning);
    const hear = document.createElement('button');
    hear.type = 'button';
    hear.className = 'btn btn--secondary tl-hear';
    hear.textContent = '🔊';
    setI18nAttr(hear, 'aria-label', 'talkLearn.play');
    hear.disabled = !state.voiceOk;
    hear.addEventListener('click', async () => {
      stopAll();
      const result = await speakText(entry.word, 'a', 1, runId);
      if (result === 'unavailable') setVoice(false);
    });
    item.append(texts, hear);
    keywordsEl.appendChild(item);
  }
  quizStart.hidden = false;
  quizEl.hidden = true;
  lessonDone.hidden = true;
  for (const [, button] of Object.entries(modeButtons)) button.setAttribute('aria-pressed', 'false');
}

quizStart.addEventListener('click', () => {
  state.quiz = buildQuiz(state.convo.keyWords);
  state.quizIndex = 0;
  state.quizScore = 0;
  quizStart.hidden = true;
  if (state.quiz.length === 0) {
    finishLesson(); // not enough different meanings to ask about
    return;
  }
  quizEl.hidden = false;
  showQuestion();
});

function showQuestion() {
  const question = state.quiz[state.quizIndex];
  setI18nText(quizProgress, 'talkLearn.quizProgress', { n: state.quizIndex + 1, total: state.quiz.length });
  setI18nText(quizQuestion, 'talkLearn.quizQuestion');
  quizSay.textContent = '';
  const word = document.createElement('span');
  word.className = 'tl-quiz-word';
  word.lang = state.learn.bcp47;
  word.dir = 'auto';
  word.textContent = question.word;
  const say = document.createElement('span');
  say.className = 'tl-say';
  say.lang = state.speak.bcp47;
  say.dir = 'auto';
  say.textContent = question.say;
  quizSay.append(word, say);
  quizOptions.textContent = '';
  for (const option of question.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--secondary tl-option';
    button.lang = state.speak.bcp47;
    button.dir = 'auto';
    button.textContent = option;
    button.addEventListener('click', () => answerQuestion(button, option));
    quizOptions.appendChild(button);
  }
  hideText(quizFeedback);
  quizNext.hidden = true;
  quizOptions.querySelector('button')?.focus();
}

function answerQuestion(chosen, option) {
  const question = state.quiz[state.quizIndex];
  const right = isQuizAnswer(question, option);
  if (right) state.quizScore += 1;
  for (const button of quizOptions.children) {
    button.disabled = true;
    const isRightOne = button.textContent === question.answer;
    button.classList.toggle('tl-option--right', isRightOne);
    button.classList.toggle('tl-option--wrong', button === chosen && !right);
  }
  if (right) showText(quizFeedback, 'talkLearn.quizRight');
  else showText(quizFeedback, 'talkLearn.quizWrong', { answer: question.answer });
  const last = state.quizIndex >= state.quiz.length - 1;
  setButton(quizNext, last ? '✓' : '→', last ? 'talkLearn.finish' : 'talkLearn.next');
  quizNext.hidden = false;
  quizNext.focus();
}

quizNext.addEventListener('click', () => {
  if (state.quizIndex >= state.quiz.length - 1) {
    finishLesson();
    return;
  }
  state.quizIndex += 1;
  showQuestion();
});

// The quiz is finished: the lesson gets its tick.
function finishLesson() {
  quizEl.hidden = true;
  progress = markComplete(progress, state.learn.bcp47, state.lessonId);
  saveProgress(storage(), progress);
  if (state.quiz.length > 0) setI18nText(quizResult, 'talkLearn.quizResult', { score: state.quizScore, total: state.quiz.length });
  else clearI18n(quizResult);
  nextLessonButton.hidden = nextLessonId(state.lessonId) === '';
  lessonDone.hidden = false;
  lessonDone.scrollIntoView({ block: 'nearest' });
}

nextLessonButton.addEventListener('click', () => {
  const next = nextLessonId(state.lessonId);
  if (next) openLesson(next);
});

// ---------- Navigation and language ----------

function handleBack() {
  if (screens.lesson.hidden) return false; // leave to Home
  showList();
  return true;
}

const nav = createNavMenu(document.getElementById('app-header'), {
  current: 'talk-learn',
  onBack: handleBack,
  onLeave: () => {
    stopAll();
    cancelLoad();
  },
});

// "I speak" follows the UI language. The lesson in view belongs to the old pair of languages,
// so the page goes back to the list.
function chooseLanguages(speakCode) {
  state.speak = findLanguage(speakCode);
  const settings = loadSettings(storage(), LANGUAGES, state.speak.bcp47);
  state.learn = findLanguage(settings.learn);
  saveSettings(storage(), settings);
}

createLanguageDropdown(nav.languageEl, {
  onChange: (language) => {
    chooseLanguages(language.bcp47);
    createEngines();
    showList();
  },
});

// ---------- Start ----------

chooseLanguages(getCurrentLanguage().bcp47);
createEngines();
showList();
