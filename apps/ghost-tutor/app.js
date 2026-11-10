// Ghost Tutor - app.js
// Task 8.3: the Topic selection screen.
// Task 8.4: the Lesson screen (segments, quiz, feedback, completion).

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createSpeechInput } from '/skeleton/speech-input.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { renderDualDisplay } from '/skeleton/dual-display.js';
import { createTextFallback } from '/skeleton/text-fallback.js';
import { lesson, translate, evaluate } from '/skeleton/api-client.js';
import { createNavMenu, createScreenHistory } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n } from '/skeleton/i18n.js';
import { computeHasMore } from '/apps/ghost-tutor/lesson-utils.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

// ---------- Module state ----------

const state = {
  language: getCurrentLanguage(), // { label, bcp47 } currently chosen in the dropdown
  topic: '',                      // topic of the loaded lesson
  segments: [],                   // [{ segment, quizQuestion }] x 4
  lessonLang: null,               // { label, bcp47 } the lesson was generated in
  segmentIndex: 0,                // which segment we are on (used by task 8.4)
};

// Speech objects for the lesson screen (created by task 8.4).
let speechInput = null;
let speechOutput = null;

// ---------- DOM references ----------

const screens = {
  topic: document.getElementById('screen-topic'),
  lesson: document.getElementById('screen-lesson'),
};
const topicSuggestions = document.getElementById('topic-suggestions');
const topicInput = document.getElementById('topic-input');
const topicStart = document.getElementById('topic-start');
const topicMessage = document.getElementById('topic-message');
const topicLoading = document.getElementById('topic-loading');

// ---------- Screen helper ----------

// Tracks the screens the user has seen (topic is the first one).
const screenHistory = createScreenHistory('topic');

// Show one screen ('topic' | 'lesson') and hide the other.
function showScreen(name) {
  screenHistory.visit(name); // remember it so Back can return here
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

// ---------- Stopping speech ----------

// Stop any speech output and microphone listening.
function stopEverything() {
  if (speechOutput && typeof speechOutput.stop === 'function') speechOutput.stop();
  if (speechInput && speechInput.supported && typeof speechInput.stop === 'function') speechInput.stop();
  setListening(false);
}

// The lesson screen code (startLesson, leaveLesson, onLanguageChanged) is
// in the "Lesson screen" section at the bottom of this file.

// ---------- Navigation header (menu, Back, language) ----------

// Back button. Returns true if we handled it, false to let the nav go Home.
function handleBack() {
  if (!screenHistory.canGoBack()) return false;
  leaveLesson();
  showScreen(screenHistory.back());
  return true;
}

// Called when the user really leaves the page: stop speech and microphone.
function onLeave() {
  stopEverything();
}

// The nav is created before the language dropdown, which lives inside it.
const nav = createNavMenu(document.getElementById('app-header'), {
  current: 'ghost-tutor',
  onBack: handleBack,
  onLeave,
});

createLanguageDropdown(nav.languageEl, {
  onChange: (lang) => {
    state.language = lang;
    onLanguageChanged();
  },
});
state.language = getCurrentLanguage();

// ---------- Topic screen ----------

// Suggested topics: the translation key of each chip.
const TOPIC_KEYS = [
  'ghostTutor.topics.moon',
  'ghostTutor.topics.water',
  'ghostTutor.topics.money',
  'ghostTutor.topics.plants',
  'ghostTutor.topics.heart',
  'ghostTutor.topics.weather',
  'ghostTutor.topics.computers',
  'ghostTutor.topics.health',
  'ghostTutor.topics.solar',
  'ghostTutor.topics.recycling',
];

// The translation key of the chip the user picked ('' = none).
let selectedChipKey = '';
const chipButtons = []; // [{ key, button }]

// Mark one chip as selected (or none when key is '').
function setSelectedChip(key) {
  selectedChipKey = key;
  for (const chip of chipButtons) {
    const isSelected = chip.key === key;
    chip.button.classList.toggle('is-selected', isSelected);
    chip.button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  }
}

// Build the suggestion buttons.
for (const key of TOPIC_KEYS) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'topic-chip';
  button.setAttribute('aria-pressed', 'false');
  setI18nText(button, key); // stays translated when the language changes
  button.addEventListener('click', () => {
    setSelectedChip(key);
    topicInput.value = t(key); // translated text at click time
    clearTopicMessage();
  });
  topicSuggestions.appendChild(button);
  chipButtons.push({ key, button });
}

// Typing changes the topic: drop the chip selection if the text no longer matches.
topicInput.addEventListener('input', () => {
  if (selectedChipKey && topicInput.value !== t(selectedChipKey)) {
    setSelectedChip('');
  }
  clearTopicMessage();
});

// Show / clear the inline message under the Start button.
function showTopicMessage(key) {
  setI18nText(topicMessage, key);
  topicMessage.hidden = false;
}

function clearTopicMessage() {
  clearI18n(topicMessage);
  topicMessage.hidden = true;
}

// Turn a client/server error code into a translation key.
function friendlyError(code) {
  if (code === 'timeout') return 'ghostTutor.errTimeout';
  if (code === 'busy') return 'ghostTutor.errBusy';
  if (code === 'network_error') return 'ghostTutor.errNetwork';
  return 'ghostTutor.errGeneric';
}

// True if the server reply has exactly 4 segments, each with real text.
function isValidLesson(data) {
  if (!data || !Array.isArray(data.segments) || data.segments.length !== 4) return false;
  return data.segments.every(
    (s) =>
      s &&
      typeof s.segment === 'string' && s.segment.trim() !== '' &&
      typeof s.quizQuestion === 'string' && s.quizQuestion.trim() !== ''
  );
}

// Show or hide the loading spinner and lock / unlock the controls.
function setTopicBusy(busy) {
  topicLoading.hidden = !busy;
  topicStart.disabled = busy;
  topicInput.disabled = busy;
}

// Validate the typed topic, ask the server for a lesson, then start it.
async function submitTopic() {
  if (topicStart.disabled) return; // a request is already running

  const topic = topicInput.value.trim().slice(0, 100);
  if (topic === '') {
    showTopicMessage('ghostTutor.errEmptyTopic'); // no API call
    return;
  }

  clearTopicMessage();
  setTopicBusy(true);
  const requestLang = state.language; // the language the lesson is asked for

  try {
    const data = await lesson({ topic, lang: requestLang.bcp47 });

    if (data && data.error) {
      showTopicMessage(friendlyError(data.error));
    } else if (!isValidLesson(data)) {
      showTopicMessage('ghostTutor.errGeneric');
    } else {
      state.topic = topic;
      // `texts` caches each text per language (the original is stored right away).
      state.segments = data.segments.map((s) => ({
        segment: s.segment,
        quizQuestion: s.quizQuestion,
        texts: {
          segment: { [requestLang.bcp47]: s.segment },
          quizQuestion: { [requestLang.bcp47]: s.quizQuestion },
        },
        feedbackTexts: {},   // feedback per language (filled after evaluate)
        feedbackSource: null, // { text, bcp47 } the feedback as first received
      }));
      state.lessonLang = requestLang;
      state.segmentIndex = 0;
      startLesson();
    }
  } catch (err) {
    showTopicMessage('ghostTutor.errGeneric');
  } finally {
    // Always unlock. The topic text stays in the input so the user can retry.
    setTopicBusy(false);
  }
}

topicStart.addEventListener('click', submitTopic);
topicInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitTopic();
  }
});

// ---------- Lesson screen (task 8.4) ----------

// DOM references for the lesson screen
const lessonProgress = document.getElementById('lesson-progress');
const lessonLoading = document.getElementById('lesson-loading');
const segmentText = document.getElementById('segment-text');
const lessonAudioNote = document.getElementById('lesson-audio-note');
const quizArea = document.getElementById('quiz-area');
const quizQuestionEl = document.getElementById('quiz-question');
const micButton = document.getElementById('mic-button');
const micMessage = document.getElementById('mic-message');
const textFallbackContainer = document.getElementById('text-fallback-container');
const dualDisplayContainer = document.getElementById('dual-display-container');
const quizMessage = document.getElementById('quiz-message');
const feedbackArea = document.getElementById('feedback-area');
const feedbackText = document.getElementById('feedback-text');
const completeArea = document.getElementById('complete-area');
const completeText = document.getElementById('complete-text');
const newTopicButton = document.getElementById('new-topic');

// Lesson flow state
// phase: 'idle' | 'segment' | 'asking' | 'translating' | 'evaluating' | 'feedback' | 'complete'
let phase = 'idle';
let askId = 0;                 // changes on every step; used to ignore stale callbacks
let silenceCount = 0;          // silences used for the current quiz question
let repeatTried = false;       // "please say it again" used for this question
let autoListenTried = false;   // auto-listen happens at most once per ask
let micListening = false;      // is the microphone currently listening?
let voiceDisabled = false;     // true when only typing should be used
let textFallbackReady = false; // the typed box is created only once
let currentQuestion = '';      // quiz question text shown to the user
let feedbackNoticeKey = '';    // set when a notice is shown instead of AI feedback
let loadingCount = 0;          // number of requests showing the spinner

// ----- Small helpers -----

// Spinner: several requests can overlap, so we count them.
function showLoading() {
  loadingCount += 1;
  lessonLoading.hidden = false;
}

function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0) lessonLoading.hidden = true;
}

function showAudioNote() {
  setI18nText(lessonAudioNote, 'ghostTutor.audioUnavailable');
  lessonAudioNote.hidden = false;
}

function clearAudioNote() {
  clearI18n(lessonAudioNote);
  lessonAudioNote.hidden = true;
}

function showQuizMessage(key) {
  setI18nText(quizMessage, key);
  quizMessage.hidden = false;
}

function clearQuizMessage() {
  clearI18n(quizMessage);
  quizMessage.hidden = true;
}

// Update the mic button to show whether we are listening.
function setListening(isListening) {
  micListening = isListening;
  micButton.classList.toggle('listening', isListening);
  setI18nText(micButton, isListening ? 'ghostTutor.stop' : 'ghostTutor.speak');
  micButton.setAttribute('aria-pressed', String(isListening));
}

// Empty the answer area (dual display, messages, typed box).
function clearAnswerArea() {
  renderDualDisplay(dualDisplayContainer, { heardText: '', englishMeaning: '' });
  clearQuizMessage();
  const typedBox = textFallbackContainer.querySelector('textarea');
  if (typedBox) typedBox.value = '';
}

// Hide everything that belongs to a later step of the lesson.
function resetLessonScreen() {
  quizArea.hidden = true;
  feedbackArea.hidden = true;
  completeArea.hidden = true;
  clearAnswerArea();
  clearAudioNote();
}

// Speak `text`, then call `done` once (when speech ends, fails or is unavailable).
// Nothing happens if the step became stale (askId changed) in the meantime.
function speakThen(text, myId, done) {
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    if (myId !== askId) return;
    done();
  }
  speechOutput.speak(text, {
    onEnd: finish,
    onError: (info) => {
      if (myId !== askId) return;
      if (info && info.audioUnavailable) showAudioNote();
      finish();
    },
  });
}

// When there is no audio the user needs time to read: wait before moving on.
function continueAfterReading(myId, done) {
  setTimeout(() => {
    if (myId === askId) done();
  }, 4000);
}

// (Re)create speech input and output using the current language.
function createSpeechEngines() {
  if (speechInput && speechInput.supported) speechInput.stop();
  if (speechOutput) speechOutput.stop();
  setListening(false);
  voiceDisabled = false;

  const lang = state.language.bcp47;
  speechOutput = createSpeechOutput({ lang });

  // Callbacks ignore events from an old engine that was replaced.
  const created = createSpeechInput({
    lang,
    onResult: (text) => {
      if (speechInput === created) handleVoiceResult(text);
    },
    onError: (info) => {
      if (speechInput === created) handleVoiceError(info);
    },
  });
  speechInput = created;

  if (!created.supported) {
    micButton.hidden = true;
    setI18nText(micMessage, 'ghostTutor.voiceUnavailable');
    micMessage.hidden = false;
  } else {
    micButton.hidden = false;
    clearI18n(micMessage);
    micMessage.hidden = true;
  }
}

// ----- Texts in the current language -----

// Find `original` in `cache` for the current language, translating if needed.
// Resolves to { text, ok }. ok=false means: show the original, do NOT speak it.
async function lookupText(cache, original) {
  const wanted = state.language;
  if (cache[wanted.bcp47]) return { text: cache[wanted.bcp47], ok: true };

  showLoading();
  try {
    const result = await translate({ text: original, targetLang: wanted.label });
    const good =
      result && !result.error && typeof result.translation === 'string' && result.translation.trim() !== '';
    if (good) {
      cache[wanted.bcp47] = result.translation; // remember it
      return { text: result.translation, ok: true };
    }
  } catch (err) {
    // fall through to the failure result
  } finally {
    hideLoading();
  }
  return { text: original, ok: false };
}

// field is 'segment' or 'quizQuestion'
function getText(item, field) {
  return lookupText(item.texts[field], item[field]);
}

// The feedback for the current language (translated if the language changed).
function getFeedbackText(item) {
  if (feedbackNoticeKey) return Promise.resolve({ text: t(feedbackNoticeKey), ok: true });
  return lookupText(item.feedbackTexts, item.feedbackSource.text);
}

// ----- Starting and leaving -----

function startLesson() {
  showScreen('lesson');

  askId += 1;
  stopEverything();
  state.language = getCurrentLanguage();
  state.segmentIndex = 0;
  silenceCount = 0;
  feedbackNoticeKey = '';
  feedbackArea.hidden = true;
  completeArea.hidden = true;

  // The typed-answer box is created only once and always available.
  if (!textFallbackReady) {
    createTextFallback(textFallbackContainer, {
      onSubmit: (text) => handleAnswer(text),
      onError: () => {}, // the box shows its own "please type something" message
    });
    textFallbackReady = true;
  }

  createSpeechEngines();
  playSegment();
}

function leaveLesson() {
  askId += 1;
  stopEverything();
  phase = 'idle';
  feedbackNoticeKey = '';
  lessonLoading.hidden = true;
  resetLessonScreen();
  clearI18n(micMessage);
  micMessage.hidden = true;
}

// ----- Segment -----

async function playSegment() {
  askId += 1;
  const myId = askId;
  stopEverything();
  phase = 'segment';
  silenceCount = 0;
  feedbackNoticeKey = '';
  resetLessonScreen();

  const item = state.segments[state.segmentIndex];
  setI18nText(lessonProgress, 'ghostTutor.progress', { n: state.segmentIndex + 1, total: 4 });
  segmentText.textContent = item.segment; // visible while a translation loads

  const result = await getText(item, 'segment');
  if (myId !== askId) return; // step or language changed while waiting

  // Show the text right before speaking it (R12.1).
  segmentText.textContent = result.text;
  if (!result.ok) {
    // No mismatched voice: keep the original text and carry on.
    showAudioNote();
    askQuiz();
    return;
  }
  speakThen(result.text, myId, () => askQuiz());
}

// ----- Quiz -----

// Show the quiz question, speak it, then listen once.
async function askQuiz(notice, isRepeat) {
  askId += 1;
  const myId = askId;
  stopEverything();
  phase = 'asking';
  autoListenTried = false;
  if (!isRepeat) repeatTried = false;

  const item = state.segments[state.segmentIndex];
  clearAudioNote();
  clearAnswerArea();
  feedbackArea.hidden = true;
  quizArea.hidden = false;
  quizQuestionEl.textContent = item.quizQuestion; // visible while a translation loads
  currentQuestion = item.quizQuestion;
  if (notice) showQuizMessage(notice);

  const result = await getText(item, 'quizQuestion');
  if (myId !== askId) return;

  quizQuestionEl.textContent = result.text;
  currentQuestion = result.text;
  if (!result.ok) {
    showAudioNote();
    autoStartListening(); // still open the answer window
    return;
  }
  speakThen(result.text, myId, () => autoStartListening());
}

// Start the microphone automatically after the question was spoken.
function autoStartListening() {
  if (autoListenTried) return; // never start twice
  autoListenTried = true;
  if (phase !== 'asking' || micListening || voiceDisabled) return;
  if (!speechInput || !speechInput.supported) return;
  setListening(true); // set first: start() may report an error right away
  speechInput.start();
}

// The mic button toggles listening on and off.
micButton.addEventListener('click', () => {
  if (phase !== 'asking' || !speechInput || !speechInput.supported || voiceDisabled) return;
  autoListenTried = true; // the user is in control now
  if (micListening) {
    speechInput.stop();
    setListening(false);
    return;
  }
  clearQuizMessage();
  if (speechOutput) speechOutput.stop(); // do not listen to our own voice
  setListening(true);
  speechInput.start();
});

// A voice answer arrived.
function handleVoiceResult(text) {
  if (!micListening) return; // we already stopped listening: stale result
  if (typeof text !== 'string' || text.trim() === '') {
    askToRepeat();
    return;
  }
  handleAnswer(text);
}

// R12.5: the voice result was empty. Say "please say it again", then listen once more.
function askToRepeat() {
  setListening(false);
  if (phase !== 'asking' || repeatTried) return;
  repeatTried = true;
  askId += 1;
  const myId = askId;
  stopEverything();
  showQuizMessage('ghostTutor.repeatAnswer');
  speakThen(t('ghostTutor.repeatAnswer'), myId, () => {
    autoListenTried = false;
    autoStartListening();
  });
}

// The microphone reported a problem.
function handleVoiceError(info) {
  if (phase !== 'asking' || !info) return;
  setListening(false);

  if (info.inactivity) {
    handleSilence();
  } else if (info.fallbackOnly) {
    voiceDisabled = true;
    micButton.hidden = true;
    setI18nText(micMessage, 'ghostTutor.voiceNotWorking');
    micMessage.hidden = false;
  } else {
    showQuizMessage('ghostTutor.tryAgain');
  }
}

// Nothing was heard for a long time: ask once more, then move on.
function handleSilence() {
  if (silenceCount < 1) {
    silenceCount += 1;
    askQuiz('ghostTutor.didNotHear', false);
  } else {
    nextSegment('ghostTutor.noAnswerNext');
  }
}

// An answer (voice or typed) arrived for the current quiz question.
async function handleAnswer(text) {
  if (phase !== 'asking') return; // ignore late or duplicate answers
  const heardText = String(text || '').trim();
  if (heardText === '') return;

  askId += 1;
  const myId = askId;
  const item = state.segments[state.segmentIndex];
  const requestLang = state.language;
  phase = 'translating';
  stopEverything();
  clearQuizMessage();

  // English meaning of the answer (for the dual display).
  let englishMeaning = heardText;
  if (requestLang.bcp47 !== 'en-US') {
    showLoading();
    let result = null;
    try {
      result = await translate({ text: heardText, targetLang: 'en' });
    } finally {
      hideLoading();
    }
    if (myId !== askId) return;
    englishMeaning =
      result && !result.error && typeof result.translation === 'string' ? result.translation.trim() : '';
  }
  renderDualDisplay(dualDisplayContainer, { heardText, englishMeaning });

  // Ask the server to check the answer.
  phase = 'evaluating';
  showLoading();
  let evalResult = null;
  try {
    evalResult = await evaluate({
      topic: state.topic,
      question: currentQuestion,
      answer: heardText,
      lang: requestLang.bcp47,
    });
  } finally {
    hideLoading();
  }
  if (myId !== askId) return;

  const feedback =
    evalResult && !evalResult.error && typeof evalResult.feedback === 'string'
      ? evalResult.feedback.trim()
      : '';
  if (feedback === '') {
    // Not counted as silence: ask the same question again.
    askQuiz('ghostTutor.errEvaluate', false);
    return;
  }

  item.feedbackSource = { text: feedback, bcp47: requestLang.bcp47 };
  item.feedbackTexts = { [requestLang.bcp47]: feedback };
  feedbackNoticeKey = '';
  playFeedback();
}

// ----- Feedback -----

// Show the feedback (or a notice) in the current language, speak it, then go on.
async function playFeedback() {
  askId += 1;
  const myId = askId;
  stopEverything();
  phase = 'feedback';
  clearAudioNote();

  const item = state.segments[state.segmentIndex];
  const result = await getFeedbackText(item);
  if (myId !== askId) return;

  if (feedbackNoticeKey) {
    setI18nText(feedbackText, feedbackNoticeKey); // a UI string: stays translated
  } else {
    clearI18n(feedbackText);
    feedbackText.textContent = result.text; // AI text: textContent only
  }
  feedbackArea.hidden = false;

  if (!result.ok) {
    showAudioNote();
    continueAfterReading(myId, () => nextSegment());
    return;
  }
  speakThen(result.text, myId, () => nextSegment());
}

// ----- Next segment / completion -----

// `notice` (optional) is a translation key shown and spoken before moving on.
function nextSegment(notice) {
  if (notice) {
    feedbackNoticeKey = notice;
    playFeedback(); // plays the notice, then calls nextSegment() again
    return;
  }

  feedbackNoticeKey = '';
  feedbackArea.hidden = true;
  clearI18n(feedbackText);

  if (computeHasMore(state.segmentIndex)) {
    state.segmentIndex += 1;
    playSegment();
  } else {
    playComplete();
  }
}

function playComplete() {
  askId += 1;
  const myId = askId;
  stopEverything();
  phase = 'complete';
  resetLessonScreen();

  setI18nText(completeText, 'ghostTutor.complete');
  completeArea.hidden = false;
  speakThen(t('ghostTutor.complete'), myId, () => {});
}

newTopicButton.addEventListener('click', () => {
  leaveLesson();
  showScreen('topic');
  topicInput.focus();
});

// ----- Language change -----

// Rebuild speech for the new language and repeat the current step in it.
function onLanguageChanged() {
  if (screens.lesson.hidden) return; // not on the lesson screen

  stopEverything();
  askId += 1;
  createSpeechEngines();

  if (phase === 'segment') {
    playSegment();
  } else if (phase === 'asking' || phase === 'translating' || phase === 'evaluating') {
    refreshSegmentText();
    askQuiz();
  } else if (phase === 'feedback') {
    refreshSegmentText();
    playFeedback();
  } else if (phase === 'complete') {
    playComplete();
  }
}

// Update the segment text on screen to the new language (no speech).
async function refreshSegmentText() {
  const item = state.segments[state.segmentIndex];
  const wanted = state.language.bcp47;
  const result = await getText(item, 'segment');
  // Ignore the result if the lesson was left, the segment moved on,
  // or the language changed again while waiting.
  if (phase === 'idle' || item !== state.segments[state.segmentIndex]) return;
  if (state.language.bcp47 !== wanted) return;
  segmentText.textContent = result.text;
}
