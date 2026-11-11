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
import { computeHasMore, canLearnMore, coveredTitles } from '/apps/ghost-tutor/lesson-utils.js';
import { matchCommand, parseWords } from '/skeleton/voice-commands.js';
import { buildProgress, parseProgress, restoreSegments, PROGRESS_KEY } from '/apps/ghost-tutor/progress-utils.js';
import { createRetryCounter, LISTEN_DELAY_MS } from '/skeleton/voice-retry.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

// ---------- Module state ----------

const state = {
  language: getCurrentLanguage(), // { label, bcp47 } currently chosen in the dropdown
  topic: '',                      // topic of the loaded lesson
  segments: [],                   // [{ segment, quizQuestion }] x 4
  lessonLang: null,               // { label, bcp47 } the lesson was generated in
  segmentIndex: 0,                // which segment we are on (used by task 8.4)
  round: 1,                       // which round of the topic (4 new parts each, max 5)
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
const topicMic = document.getElementById('topic-mic');
const topicMicText = topicMic.querySelector('[data-i18n]'); // the "Speak" / "Stop" label
const topicConfirm = document.getElementById('topic-confirm');
const topicListeningIndicator = document.getElementById('topic-listening-indicator');
const resumeCard = document.getElementById('resume-card');
const resumeText = document.getElementById('resume-text');
const resumeContinue = document.getElementById('resume-continue');
const resumeNew = document.getElementById('resume-new');

// ---------- Screen helper ----------

// Tracks the screens the user has seen (topic is the first one).
const screenHistory = createScreenHistory('topic');

// Show one screen ('topic' | 'lesson') and hide the other.
function showScreen(name) {
  screenHistory.visit(name); // remember it so Back can return here
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
  // Back on the topic screen: make fresh speech engines in the current language.
  if (name === 'topic') createTopicEngines();
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
  stopTopicVoice();
  leaveLesson();
  showScreen(screenHistory.back());
  return true;
}

// Called when the user really leaves the page: stop speech and microphone.
function onLeave() {
  stopTopicVoice();
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
    cancelTopicVoice(); // picking a chip cancels voice and hides the question
    setSelectedChip(key);
    topicInput.value = t(key); // translated text at click time
    clearTopicMessage();
  });
  topicSuggestions.appendChild(button);
  chipButtons.push({ key, button });
}

// Typing changes the topic: drop the chip selection if the text no longer matches.
topicInput.addEventListener('input', () => {
  cancelTopicVoice(); // typing cancels voice and hides the question
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
  if (code === 'busy') return 'common.rateLimit'; // every AI model is out of free quota
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

// Turn the server reply into segment objects. `texts` caches each text per language
// (the original is stored right away). Used for the first lesson and for later rounds.
function makeSegments(data, lang) {
  return data.segments.map((s) => ({
    title: typeof s.title === 'string' ? s.title.trim() : '', // short name, sent back when asking for deeper parts
    lang: lang.bcp47, // language the original texts are written in (saved with the progress)
    segment: s.segment,
    quizQuestion: s.quizQuestion,
    texts: {
      segment: { [lang.bcp47]: s.segment },
      quizQuestion: { [lang.bcp47]: s.quizQuestion },
    },
    feedbackTexts: {},    // feedback per language (filled after evaluate)
    feedbackSource: null, // { text, bcp47 } the feedback as first received
  }));
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

  cancelTopicVoice(); // Start (or a spoken "yes") ends any topic listening

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
      state.segments = makeSegments(data, requestLang);
      state.round = 1; // first round of this topic
      clearProgress(); // a new topic replaces any saved progress
      savedProgress = null;
      hideResumeCard();
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

// ---------- Topic by voice (task 13.5) ----------

// The topic screen has its own speech engines, separate from the lesson ones.
let topicSpeechInput = null;
let topicSpeechOutput = null;
let topicListening = false;  // is the topic microphone open?
let topicMode = '';          // 'topic' (hearing a topic) | 'command' (hearing yes)
let topicToken = 0;          // changes whenever voice must be cancelled
let topicListenToken = 0;    // the token that was current when listening began
const topicRetries = createRetryCounter(); // "I did not understand" retries (max 2)

// Update the mic button: orange pulse and "Stop" while listening.
function setTopicListening(isListening) {
  topicListening = isListening;
  topicMic.classList.toggle('listening', isListening);
  topicMic.setAttribute('aria-pressed', String(isListening));
  topicListeningIndicator.hidden = !isListening; // clear "Listening..." sign
  setI18nText(topicMicText, isListening ? 'ghostTutor.stop' : 'ghostTutor.speak');
}

// Hide the spoken question.
function hideTopicConfirm() {
  clearI18n(topicConfirm);
  topicConfirm.hidden = true;
}

// Stop topic speech and microphone. Late results are ignored afterwards.
function stopTopicVoice() {
  topicToken += 1;
  topicMode = '';
  if (topicSpeechOutput) topicSpeechOutput.stop();
  if (topicSpeechInput && topicSpeechInput.supported) topicSpeechInput.stop();
  setTopicListening(false);
}

// Stop voice AND hide the question (used by typing, chips, Start).
function cancelTopicVoice() {
  stopTopicVoice();
  hideTopicConfirm();
}

// (Re)create the topic speech engines in the current language.
function createTopicEngines() {
  stopTopicVoice();
  const lang = state.language.bcp47;
  topicSpeechOutput = createSpeechOutput({ lang });

  // Events from an old, replaced engine are ignored.
  const created = createSpeechInput({
    lang,
    onResult: (text) => {
      if (topicSpeechInput === created) handleTopicResult(text);
    },
    onError: (info) => {
      if (topicSpeechInput === created) handleTopicError(info);
    },
  });
  topicSpeechInput = created;
  topicMic.hidden = !created.supported;
}

// Open the microphone in the given mode.
function listenOnTopicScreen(mode) {
  if (!topicSpeechInput || !topicSpeechInput.supported) return;
  topicMode = mode;
  topicListenToken = topicToken;
  setTopicListening(true); // first: start() may report an error right away
  topicSpeechInput.start();
}

// Mic button: toggle listening for a spoken topic.
topicMic.addEventListener('click', () => {
  if (topicStart.disabled) return; // a lesson request is running
  if (topicListening) {
    stopTopicVoice();
    return;
  }
  stopTopicVoice(); // also silences the spoken question
  hideTopicConfirm();
  clearTopicMessage();
  topicRetries.reset(); // the user is in control: two fresh retries
  listenOnTopicScreen('topic');
});

// Something was heard on the topic screen.
function handleTopicResult(text) {
  // Ignore anything that is not for the current listening session.
  if (!topicListening || topicListenToken !== topicToken) return;

  if (topicMode === 'topic') {
    const topic = String(text || '').trim().slice(0, 100);
    if (topic === '') {
      handleTopicNotUnderstood();
      return;
    }
    setTopicListening(false);
    topicInput.value = topic;
    setSelectedChip('');
    clearTopicMessage();
    askTopicConfirmation(topic);
  } else if (topicMode === 'resume') {
    const command = matchCommand(text, {
      yes: parseWords(t('voice.yesWords')),
      redo: parseWords(t('voice.redoWords')),
    });
    if (command === null) {
      handleTopicNotUnderstood(); // say it once more (max 2 times)
      return;
    }
    setTopicListening(false);
    topicMode = '';
    clearTopicMessage();
    if (command === 'yes') continueSaved();
    // "no": stay here; the Continue and Start new buttons keep waiting
  } else if (topicMode === 'command') {
    const command = matchCommand(text, {
      yes: parseWords(t('voice.yesWords')),
      redo: parseWords(t('voice.redoWords')),
    });
    if (command === null) {
      handleTopicNotUnderstood(); // neither "yes" nor "no": say it once more
      return;
    }
    setTopicListening(false);
    topicMode = '';
    clearTopicMessage();
    if (command === 'yes') submitTopic(); // same checks and request as Start
    // "no" / "again": keep the topic and the question on screen.
  }
}

// The microphone reported silence, unclear speech or a problem.
function handleTopicError(info) {
  if (!topicListening || topicListenToken !== topicToken) return;
  if (info && info.fallbackOnly) {
    // Too many mic failures: typing and the buttons only.
    topicMode = '';
    setTopicListening(false);
    topicMic.hidden = true;
    return;
  }
  handleTopicNotUnderstood();
}

// Say and show "I did not understand. Please say it once more." and listen
// again by itself, at most 2 times. After that listening stops and the
// topic buttons and the type box stay ready.
function handleTopicNotUnderstood() {
  const mode = topicMode;
  setTopicListening(false);
  if (topicSpeechInput && topicSpeechInput.supported) topicSpeechInput.stop();
  if (mode === '' || !topicRetries.next()) {
    topicMode = '';
    return;
  }

  const myToken = topicToken;
  showTopicMessage('common.notUnderstood');

  let done = false;
  function listenAgain() {
    if (done) return;
    done = true;
    // Open the microphone only after the spoken message has finished.
    setTimeout(() => {
      if (myToken !== topicToken) return; // cancelled meanwhile
      listenOnTopicScreen(mode);
    }, LISTEN_DELAY_MS);
  }
  topicSpeechOutput.speak(t('common.notUnderstood'), { onEnd: listenAgain, onError: listenAgain });
}

// Show and speak "Shall I teach you about ...?", then listen once for "yes".
function askTopicConfirmation(topic) {
  topicRetries.reset();
  topicToken += 1;
  const myToken = topicToken;
  setI18nText(topicConfirm, 'ghostTutor.confirmTopic', { topic });
  topicConfirm.hidden = false;

  let finished = false;
  function listenAfterQuestion() {
    if (finished) return;
    finished = true;
    if (myToken !== topicToken) return; // cancelled meanwhile
    // Open the microphone only after our own voice has fully stopped.
    setTimeout(() => {
      if (myToken !== topicToken) return;
      listenOnTopicScreen('command');
    }, LISTEN_DELAY_MS);
  }
  topicSpeechOutput.speak(t('ghostTutor.confirmTopic', { topic }), {
    onEnd: listenAfterQuestion,
    onError: listenAfterQuestion, // no audio: still listen
  });
}

createTopicEngines();

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
const scoreText = document.getElementById('score-text');
const nextButton = document.getElementById('next-button');
const pauseButton = document.getElementById('pause-button');
const pausedNote = document.getElementById('paused-note');
const nextPrompt = document.getElementById('next-prompt');
const skipButton = document.getElementById('skip-button');
const learnMorePrompt = document.getElementById('learn-more-prompt');
const learnMoreButton = document.getElementById('learn-more');
const completeMessage = document.getElementById('complete-message');
const completeListeningIndicator = document.getElementById('complete-listening-indicator');
const listeningIndicator = document.getElementById('listening-indicator');
const notUnderstood = createRetryCounter(); // quiz "I did not understand" retries (max 2)
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
let score = 0;                 // how many quiz answers were correct in this lesson

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
  // One clear "Listening..." sign: on the end screen it sits in the end card.
  listeningIndicator.hidden = !isListening || phase === 'complete';
  completeListeningIndicator.hidden = !isListening || phase !== 'complete';
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
  skipButton.hidden = true;
  clearI18n(completeMessage);
  completeMessage.hidden = true;
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

function startLesson(resume = false) {
  cancelTopicVoice(); // topic speech and microphone end when the lesson starts
  showScreen('lesson');

  askId += 1;
  stopEverything();
  state.language = getCurrentLanguage();
  if (!resume) {
    state.segmentIndex = 0;
    score = 0;
  }
  silenceCount = 0;
  resetPause();
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
  resetPause();
  pauseButton.hidden = true;
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
  partStartScore = score; // the score before this part: what is saved
  pauseButton.hidden = false;
  saveProgress();

  const item = state.segments[state.segmentIndex];
  setI18nText(lessonProgress, 'ghostTutor.progress', { n: state.segmentIndex + 1, total: state.segments.length });
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
  notUnderstood.reset();
  skipButton.hidden = true;

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
  const myId = askId;
  // Wait a moment so the microphone does not hear the end of our own voice.
  setTimeout(() => {
    if (myId !== askId) return;
    if (phase !== 'asking' || micListening || voiceDisabled) return;
    if (!speechInput || !speechInput.supported) return;
    setListening(true); // set first: start() may report an error right away
    speechInput.start();
  }, LISTEN_DELAY_MS);
}

// The mic button toggles listening on and off.
micButton.addEventListener('click', () => {
  if (phase !== 'asking' || !speechInput || !speechInput.supported || voiceDisabled) return;
  autoListenTried = true; // the user is in control now
  notUnderstood.reset(); // two fresh retries
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
  if (phase === 'feedback') {
    handleNextCommand(text); // after the feedback: "next" / "yes" goes on
    return;
  }
  if (phase === 'complete') {
    handleCompleteCommand(text); // on the end screen: "yes" = learn more, "no" = new topic
    return;
  }
  if (typeof text !== 'string' || text.trim() === '') {
    handleNotUnderstood();
    return;
  }
  handleAnswer(text);
}

// The microphone reported a problem (silence, unclear speech or a mic error).
function handleVoiceError(info) {
  if (!info) return;
  if (phase === 'feedback' || phase === 'complete') {
    // The buttons always keep working.
    if (info.fallbackOnly) {
      setListening(false);
      voiceDisabled = true;
      return;
    }
    handleStepNotUnderstood();
    return;
  }
  if (phase !== 'asking') return;

  if (info.fallbackOnly) {
    // Too many mic failures: typing only.
    setListening(false);
    voiceDisabled = true;
    micButton.hidden = true;
    skipButton.hidden = false; // voice is off: the learner may still skip
    setI18nText(micMessage, 'ghostTutor.voiceNotWorking');
    micMessage.hidden = false;
    return;
  }
  handleNotUnderstood();
}

// Nothing was heard, or it was unclear, or the mic failed once (quiz answer).
// Say and show "I did not understand. Please say it once more." and listen
// again by itself, at most 2 times. After that listening stops and the Skip
// button appears; the mic button and the type box stay ready too.
function handleNotUnderstood() {
  setListening(false);
  if (speechInput && speechInput.supported) speechInput.stop();
  if (phase !== 'asking') return;
  if (!notUnderstood.next()) {
    skipButton.hidden = false; // both retries used: the learner may skip this question
    return;
  }

  const myId = askId;
  showQuizMessage('common.notUnderstood');
  speakThen(t('common.notUnderstood'), myId, () => {
    // Open the microphone only after the spoken message has finished.
    setTimeout(() => {
      if (myId !== askId || phase !== 'asking' || micListening || voiceDisabled) return;
      if (!speechInput || !speechInput.supported) return;
      setListening(true);
      speechInput.start();
    }, LISTEN_DELAY_MS);
  });
}

// Same retry flow for the "next part?" step and the end-screen question.
function handleStepNotUnderstood() {
  setListening(false);
  if (speechInput && speechInput.supported) speechInput.stop();
  if ((phase !== 'feedback' && phase !== 'complete') || !notUnderstood.next()) return; // buttons keep working

  const myId = askId;
  const stepPhase = phase;
  if (stepPhase === 'feedback') {
    showQuizMessage('common.notUnderstood');
  } else {
    setI18nText(completeMessage, 'common.notUnderstood');
    completeMessage.hidden = false;
  }
  speakThen(t('common.notUnderstood'), myId, () => {
    // Open the microphone only after the spoken message has finished.
    setTimeout(() => {
      if (myId !== askId || phase !== stepPhase || micListening || voiceDisabled) return;
      if (!speechInput || !speechInput.supported) return;
      setListening(true);
      speechInput.start();
    }, LISTEN_DELAY_MS);
  });
}

// An answer (voice or typed) arrived for the current quiz question.
async function handleAnswer(text) {
  if (paused || phase !== 'asking') return; // ignore late or duplicate answers
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

  applyEvaluation(item, evalResult, requestLang, true);
}

// Use the server reply: remember the feedback and play it.
// canScore is false for a skipped question (never counted as correct).
function applyEvaluation(item, evalResult, requestLang, canScore) {
  const feedback =
    evalResult && !evalResult.error && typeof evalResult.feedback === 'string'
      ? evalResult.feedback.trim()
      : '';
  if (feedback === '') {
    // The answer could not be checked. Never block the user: say so and offer Next.
    feedbackNoticeKey = 'ghostTutor.evaluateSkipped';
    playFeedback();
    return;
  }

  if (canScore && evalResult.correct === true) score += 1; // counted once per question
  item.feedbackSource = { text: feedback, bcp47: requestLang.bcp47 };
  item.feedbackTexts = { [requestLang.bcp47]: feedback };
  feedbackNoticeKey = '';
  playFeedback();
}

// Skip button: show and speak the correct answer with a short explanation.
async function handleSkip() {
  if (paused || phase !== 'asking') return;
  askId += 1;
  const myId = askId;
  const item = state.segments[state.segmentIndex];
  const requestLang = state.language;
  phase = 'evaluating';
  stopEverything();
  clearQuizMessage();
  skipButton.hidden = true;

  showLoading();
  let evalResult = null;
  try {
    evalResult = await evaluate({
      topic: state.topic,
      question: currentQuestion,
      skipped: true,
      lang: requestLang.bcp47,
    });
  } finally {
    hideLoading();
  }
  if (myId !== askId) return;

  applyEvaluation(item, evalResult, requestLang, false);
}

skipButton.addEventListener('click', handleSkip);

// ----- Feedback -----

// Show the feedback (or a notice) in the current language, speak it, then go on.
async function playFeedback() {
  askId += 1;
  const myId = askId;
  stopEverything();
  phase = 'feedback';
  notUnderstood.reset();
  nextPrompt.hidden = true;
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

  // The Next button is visible right away (feedbackArea is shown above).
  // After the feedback is spoken we also listen once for a spoken "yes".
  if (!result.ok) {
    showAudioNote();
    askNextByVoice(myId);
    return;
  }
  speakThen(result.text, myId, () => askNextByVoice(myId));
}

// Show and speak "Shall we go to the next part? Say next or yes.", then listen.
function askNextByVoice(myId) {
  if (myId !== askId || phase !== 'feedback') return;
  setI18nText(nextPrompt, 'ghostTutor.nextPrompt');
  nextPrompt.hidden = false;
  speakThen(t('ghostTutor.nextPrompt'), myId, () => listenForNext(myId));
}

// Open the microphone once, to hear "yes" (= Next) after the feedback.
function listenForNext(myId) {
  // Wait a moment so the microphone does not hear the end of our own voice.
  setTimeout(() => {
    if (myId !== askId || phase !== 'feedback' || micListening || voiceDisabled) return;
    if (!speechInput || !speechInput.supported) return;
    setListening(true); // set first: start() may report an error right away
    speechInput.start();
  }, LISTEN_DELAY_MS);
}

// A spoken "next" or "yes" (in the chosen language) moves on, like the Next button.
function handleNextCommand(text) {
  const command = matchCommand(text, {
    yes: [...parseWords(t('voice.yesWords')), ...parseWords(t('voice.nextWords'))],
    redo: parseWords(t('voice.redoWords')),
  });
  if (command === 'yes') {
    setListening(false);
    nextSegment();
  } else if (command === 'redo') {
    setListening(false); // "no": stay here; the Next button keeps waiting
  } else {
    handleStepNotUnderstood(); // unclear: say it once more (max 2 times)
  }
}

nextButton.addEventListener('click', () => {
  if (phase !== 'feedback') return;
  nextSegment();
});

// ----- Pause and resume -----

let paused = false;          // true while the lesson is frozen
let pausedPhase = 'idle';    // the step that was running when Pause was pressed
let partStartScore = 0;      // the score when the current part began

// Show or hide the paused look. inert freezes the answer area, the buttons, the
// microphone button and the type box; only the Resume button keeps working.
function setPausedUi(on) {
  screens.lesson.classList.toggle('is-paused', on);
  quizArea.inert = on;
  feedbackArea.inert = on;
  completeArea.inert = on;
  setI18nText(pauseButton, on ? 'ghostTutor.resume' : 'ghostTutor.pause');
  pauseButton.setAttribute('aria-pressed', String(on));
  pausedNote.hidden = !on;
}

// Forget any pause (used when a lesson starts or is left).
function resetPause() {
  paused = false;
  pausedPhase = 'idle';
  setPausedUi(false);
}

function pauseLesson() {
  if (paused || phase === 'idle' || phase === 'complete') return;
  paused = true;
  pausedPhase = phase;
  askId += 1; // every timer, speech callback and server reply of this step is now stale
  stopEverything(); // stops speech and the microphone at once
  loadingCount = 0;
  lessonLoading.hidden = true;
  setPausedUi(true);
}

// Resume repeats the current part (or the current quiz question) from its start.
function resumeLesson() {
  if (!paused) return;
  const wasPhase = pausedPhase;
  resetPause();
  if (wasPhase === 'segment') {
    playSegment();
  } else if (wasPhase === 'feedback') {
    playFeedback();
  } else {
    askQuiz(); // asking, translating or evaluating: ask the question again
  }
}

pauseButton.addEventListener('click', () => {
  if (paused) resumeLesson();
  else pauseLesson();
});

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

  if (computeHasMore(state.segmentIndex, state.segments.length)) {
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
  notUnderstood.reset();
  resetLessonScreen();
  pauseButton.hidden = true;
  clearProgress(); // the topic is finished

  const total = state.segments.length; // parts of ALL rounds; the score adds up too
  const more = canLearnMore(state.round);
  setI18nText(completeText, 'ghostTutor.complete');
  setI18nText(scoreText, 'ghostTutor.score', { score, total });
  if (more) {
    setI18nText(learnMorePrompt, 'ghostTutor.learnMorePrompt', { topic: state.topic });
  } else {
    setI18nText(learnMorePrompt, 'ghostTutor.maxRounds'); // 5 rounds done: suggest a new topic
  }
  learnMoreButton.hidden = !more;
  learnMoreButton.disabled = false;
  completeArea.hidden = false;

  const question = more ? t('ghostTutor.learnMorePrompt', { topic: state.topic }) : t('ghostTutor.maxRounds');
  const spoken = t('ghostTutor.score', { score, total }) + ' ' + t('ghostTutor.complete') + ' ' + question;
  speakThen(spoken, myId, () => {
    if (more) listenForLearnMore(myId);
  });
}

// Open the microphone once, to hear "yes" (learn more) or "no" (new topic).
function listenForLearnMore(myId) {
  // Wait a moment so the microphone does not hear the end of our own voice.
  setTimeout(() => {
    if (myId !== askId || phase !== 'complete' || micListening || voiceDisabled) return;
    if (!speechInput || !speechInput.supported) return;
    setListening(true);
    speechInput.start();
  }, LISTEN_DELAY_MS);
}

// A spoken answer on the end screen.
function handleCompleteCommand(text) {
  const command = matchCommand(text, {
    yes: parseWords(t('voice.yesWords')),
    redo: parseWords(t('voice.redoWords')),
  });
  if (command === 'yes') {
    setListening(false);
    learnMore();
  } else if (command === 'redo') {
    setListening(false);
    chooseAnotherTopic(); // "no"
  } else {
    handleStepNotUnderstood();
  }
}

// Learn more: 4 new parts that go deeper. The titles of the parts already
// taught are sent so nothing is repeated. The part counter and the score continue.
async function learnMore() {
  if (phase !== 'complete' || !canLearnMore(state.round)) return;
  askId += 1;
  const myId = askId;
  stopEverything();
  clearI18n(completeMessage);
  completeMessage.hidden = true;
  learnMoreButton.disabled = true; // no double requests; "Choose another topic" keeps working
  const requestLang = state.language;

  showLoading();
  let data = null;
  try {
    data = await lesson({
      topic: state.topic,
      lang: requestLang.bcp47,
      covered: coveredTitles(state.segments),
    });
  } finally {
    hideLoading();
  }
  if (myId !== askId) return; // the learner left or changed language meanwhile
  learnMoreButton.disabled = false;

  if (!data || data.error || !isValidLesson(data)) {
    setI18nText(completeMessage, data && data.error ? friendlyError(data.error) : 'ghostTutor.errGeneric');
    completeMessage.hidden = false;
    return; // the buttons stay: try again or choose another topic
  }

  const firstNewPart = state.segments.length;
  state.segments = state.segments.concat(makeSegments(data, requestLang));
  state.round += 1;
  state.segmentIndex = firstNewPart; // "Part 5 of 8"
  playSegment();
}

learnMoreButton.addEventListener('click', learnMore);

// Back to topic selection (button, or a spoken "no").
function chooseAnotherTopic() {
  leaveLesson();
  showScreen('topic');
  topicInput.focus();
}

newTopicButton.addEventListener('click', chooseAnotherTopic);

// ----- Language change -----

// Rebuild speech for the new language and repeat the current step in it.
function onLanguageChanged() {
  if (screens.lesson.hidden) {
    // Topic screen: new engines for the new language. The question (if shown)
    // re-translates by itself; it is not spoken again.
    createTopicEngines();
    return;
  }

  stopEverything();
  askId += 1;
  createSpeechEngines();

  if (paused) return; // stays paused; Resume continues in the new language

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

// ---------- Saved progress (localStorage) ----------

let savedProgress = null; // progress found when Ghost Tutor opened (or null)

// Save where the learner is. localStorage can be missing, blocked or full: any
// error is ignored and the lesson simply is not saved.
function saveProgress() {
  try {
    const data = buildProgress({
      topic: state.topic,
      language: state.lessonLang || state.language,
      segments: state.segments,
      segmentIndex: state.segmentIndex,
      score: partStartScore,
      round: state.round,
    });
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
  } catch (err) {
    // not saved
  }
}

function loadProgress() {
  try {
    return parseProgress(localStorage.getItem(PROGRESS_KEY));
  } catch (err) {
    return null;
  }
}

function clearProgress() {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch (err) {
    // nothing to do
  }
}

// ---------- Continue where you stopped ----------

function showResumeCard(progress) {
  setI18nText(resumeText, 'ghostTutor.resumePrompt', { topic: progress.topic, n: progress.segmentIndex + 1 });
  resumeCard.hidden = false;
}

function hideResumeCard() {
  clearI18n(resumeText);
  resumeCard.hidden = true;
}

// Speak "Continue <topic> from part N? Say yes to continue.", then listen once for "yes".
function askResume(progress) {
  topicRetries.reset();
  topicToken += 1;
  const myToken = topicToken;
  let done = false;
  function listenAfterQuestion() {
    if (done) return;
    done = true;
    if (myToken !== topicToken) return; // cancelled meanwhile
    // Open the microphone only after our own voice has fully stopped.
    setTimeout(() => {
      if (myToken !== topicToken) return;
      listenOnTopicScreen('resume');
    }, LISTEN_DELAY_MS);
  }
  const question = t('ghostTutor.resumePrompt', { topic: progress.topic, n: progress.segmentIndex + 1 });
  topicSpeechOutput.speak(question, { onEnd: listenAfterQuestion, onError: listenAfterQuestion });
}

// Continue (button or a spoken "yes"): the current part starts again from its beginning.
function continueSaved() {
  const saved = savedProgress;
  if (!saved) return;
  cancelTopicVoice();
  hideResumeCard();
  savedProgress = null;

  state.topic = saved.topic;
  state.segments = restoreSegments(saved.segments);
  state.lessonLang = saved.language;
  state.round = saved.round;
  state.segmentIndex = saved.segmentIndex;
  score = saved.score;
  startLesson(true);
}

// Start new: forget the saved lesson.
function startNewInstead() {
  cancelTopicVoice();
  clearProgress();
  savedProgress = null;
  hideResumeCard();
}

resumeContinue.addEventListener('click', continueSaved);
resumeNew.addEventListener('click', startNewInstead);

// When Ghost Tutor opens and progress was saved: ask on screen and by voice.
savedProgress = loadProgress();
if (savedProgress) {
  showResumeCard(savedProgress);
  askResume(savedProgress);
}
