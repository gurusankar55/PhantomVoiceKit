// Spirit Clerk - app.js
// Task 6.3: the Upload screen.
// Tasks 6.4 (form fill) and 6.5 (summary) will extend this file.

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createSpeechInput } from '/skeleton/speech-input.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { renderDualDisplay } from '/skeleton/dual-display.js';
import { createTextFallback } from '/skeleton/text-fallback.js';
import { extractFields, translate } from '/skeleton/api-client.js';
import { nextRedoOrSkip, pdfFilename, cleanLabel, formatAnswerByKind } from '/apps/spirit-clerk/form-utils.js';
import { cleanAnswer } from '/skeleton/text-fallback-utils.js';
import { createNavMenu, createScreenHistory } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n } from '/skeleton/i18n.js';
import { matchCommand, parseWords } from '/skeleton/voice-commands.js';
import { createRetryCounter, LISTEN_DELAY_MS } from '/skeleton/voice-retry.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

// ---------- Constants ----------

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

// ---------- Module state ----------

// FieldAnswer (filled in by 6.4): { field, heardText, englishMeaning, skipped }
const state = {
  fields: [],          // fields returned by the server
  answers: [],         // FieldAnswer objects, one per field
  currentIndex: 0,     // which field we are on
  formName: '',        // used in the PDF file name
  fieldsLang: null,    // { label, bcp47 } the questions were generated in
  language: getCurrentLanguage(), // { label, bcp47 }
  selectedFile: null,  // the valid file chosen by the user (kept for retries)
};

// ---------- DOM references ----------

const screens = {
  upload: document.getElementById('screen-upload'),
  fill: document.getElementById('screen-fill'),
  summary: document.getElementById('screen-summary'),
};
const fileInput = document.getElementById('file-input');
const fileName = document.getElementById('file-name');
const uploadConfirm = document.getElementById('upload-confirm');
const uploadMessage = document.getElementById('upload-message');
const uploadLoading = document.getElementById('upload-loading');

// Form-fill DOM references
const fillProgress = document.getElementById('fill-progress');
const fillQuestion = document.getElementById('fill-question');
const fillAudioNote = document.getElementById('fill-audio-note');
const micButton = document.getElementById('mic-button');
const micMessage = document.getElementById('mic-message');
const textFallbackContainer = document.getElementById('text-fallback-container');
const dualDisplayContainer = document.getElementById('dual-display-container');
const confirmControls = document.getElementById('confirm-controls');
const confirmButton = document.getElementById('confirm-button');
const redoButton = document.getElementById('redo-button');
const fillMessage = document.getElementById('fill-message');
const fillLoading = document.getElementById('fill-loading');
const helpButton = document.getElementById('help-button');
const helpText = document.getElementById('help-text');
const confirmPrompt = document.getElementById('confirm-prompt');
const listeningIndicator = document.getElementById('listening-indicator');
const notUnderstood = createRetryCounter(); // "I did not understand" retries (max 2)
// ---------- Form-fill state ----------

let fillActive = false;   // true while the form-fill screen is running
let phase = 'idle';       // 'idle' | 'asking' | 'translating' | 'confirming'
let askId = 0;            // changes on every (re-)ask; used to ignore stale callbacks
let redoCount = 0;        // redos used for the current field
let silenceCount = 0;     // silences used for the current field
let pendingAnswer = null; // { heardText, englishMeaning } waiting for Confirm
let micListening = false; // is the microphone currently listening?
let voiceDisabled = false; // true when only typing should be used
let speechInput = null;   // result of createSpeechInput (may be { supported: false })
let speechOutput = null;  // result of createSpeechOutput
let textFallbackReady = false; // the typed box is created only once
let listenMode = '';      // '' | 'answer' (hearing an answer) | 'command' (hearing yes / redo)
let voiceToken = 0;       // bumped whenever speech/mic is stopped; old callbacks check it
let commandPending = false; // the confirm prompt is being spoken; we will listen after it
let helpActive = false;   // true while the help text is being fetched or spoken
// ---------- Screen helper ----------

// Tracks the screens the user has seen (upload is the first one).
const screenHistory = createScreenHistory('upload');

// Show one screen ('upload' | 'fill' | 'summary') and hide the others.
function showScreen(name) {
  screenHistory.visit(name); // remember it so Back can return here
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

// ---------- Language handling ----------

// Called when the user picks a different language. If the form-fill screen
// is running, rebuild speech input/output and re-ask the current question.
function onLanguageChanged() {
  if (!fillActive) return;

  // Stop whatever is happening (speech and listening) for the old language.
  // Bumping askId makes late callbacks from the old engines get ignored.
  stopEverything();
  askId += 1;
  createSpeechEngines();

  // If a question is waiting for an answer, ask it again in the new language.
  // (Stopping the old speech has already ended it, so nothing overlaps.)
  // A pending answer waiting for Confirm/Redo is left alone.
  if (phase === 'asking' || phase === 'translating') {
    phase = 'asking';
    fillLoading.hidden = true;
    askCurrentQuestion();
  } else if (phase === 'confirming') {
    // Hide the old help (it was in the old language) and ask the
    // confirm question again in the new language, then listen once more.
    helpText.textContent = '';
    helpText.hidden = true;
    promptConfirm();
  }
}

// ---------- Navigation header (menu, Back, language) ----------

// Ask before leaving only while the user is answering questions.
function getLeaveMessage() {
  return screenHistory.current() === 'fill' && fillActive ? t('spiritClerk.leaveConfirm') : null;
}

// Called when the user really leaves the page: stop speech and microphone.
function onLeave() {
  stopEverything();
}

// Back button. Returns true if we handled it, false to let the nav go Home.
function handleBack() {
  if (!screenHistory.canGoBack()) return false;

  if (screenHistory.current() === 'fill' && fillActive) {
    if (!window.confirm(t('spiritClerk.leaveConfirm'))) return true; // stay, but handled
    // Leave the fill screen cleanly.
    askId += 1;
    stopEverything();
    fillActive = false;
    phase = 'idle';
    pendingAnswer = null;
    state.answers = [];
    fillLoading.hidden = true;
    confirmControls.hidden = true;
  }

  const previous = screenHistory.back();
  if (previous === 'fill') {
    reopenLastQuestion(); // coming back from the summary
  } else {
    showScreen(previous);
  }
  return true;
}

// From the summary, go back to the last question (stored answers are kept).
function reopenLastQuestion() {
  showScreen('fill');
  fillActive = true;
  state.currentIndex = state.fields.length - 1;
  redoCount = 0;
  silenceCount = 0;
  askCurrentQuestion();
}

// The nav is created before the language dropdown, which lives inside it.
const nav = createNavMenu(document.getElementById('app-header'), {
  current: 'spirit-clerk',
  onBack: handleBack,
  getLeaveMessage,
  onLeave,
});

createLanguageDropdown(nav.languageEl, {
  onChange: (lang) => {
    state.language = lang;
    onLanguageChanged();
  },
});
state.language = getCurrentLanguage();

// ---------- Upload screen ----------

// Show an inline message under the upload controls.
function showUploadMessage(key) {
  setI18nText(uploadMessage, key);
  uploadMessage.hidden = false;
}

function clearUploadMessage() {
  clearI18n(uploadMessage);
  uploadMessage.hidden = true;
}

// Turn a server/client error code into a translation key.
function friendlyError(code) {
  if (code === 'timeout') {
    return 'spiritClerk.errTimeout';
  }
  if (code === 'busy') {
    return 'common.rateLimit'; // every AI model is out of free quota
  }
  if (code === 'network_error') {
    return 'spiritClerk.errNetwork';
  }
  return 'spiritClerk.errGeneric';
}

// Returns an error message key for a bad file, or '' if the file is fine.
function validateFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'spiritClerk.errFileType';
  }
  if (file.size > MAX_FILE_BYTES) {
    return 'spiritClerk.errFileSize';
  }
  return '';
}

// Show the translated "No file chosen" text next to the picker button.
function showNoFileChosen() {
  setI18nText(fileName, 'spiritClerk.noFileChosen');
}

// When the user picks a file: validate it before anything is sent.
fileInput.addEventListener('change', () => {
  clearUploadMessage();
  state.selectedFile = null;
  uploadConfirm.disabled = true;

  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    showNoFileChosen(); // the user cancelled the picker
    return;
  }

  const problem = validateFile(file);
  if (problem) {
    showNoFileChosen();
    showUploadMessage(problem);
    return;
  }

  // File names are user data, so they are shown as plain text (not translated).
  clearI18n(fileName);
  fileName.textContent = file.name;
  state.selectedFile = file;
  uploadConfirm.disabled = false;
});

// Read a file and resolve with its base64 text (without the data: prefix).
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// "My Form.final.pdf" -> "My_Form_final" (letters, digits, - and _ only).
function makeFormName(fileName) {
  const withoutExtension = fileName.replace(/\.[^.]*$/, '');
  const cleaned = withoutExtension.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'form';
}

// When the user confirms: send the file to the server.
uploadConfirm.addEventListener('click', async () => {
  const file = state.selectedFile;
  if (!file) return;

  clearUploadMessage();
  uploadConfirm.disabled = true;
  uploadLoading.hidden = false;

  try {
    const fileBase64 = await readFileAsBase64(file);
    const lang = getCurrentLanguage().bcp47;
    const result = await extractFields({ fileBase64, mimeType: file.type, lang });

    if (result.error) {
      showUploadMessage(friendlyError(result.error));
      return;
    }

    if (!Array.isArray(result.fields) || result.fields.length === 0) {
      showUploadMessage('spiritClerk.errNoFields');
      return;
    }

    // Success: remember the fields and move on.
    // Remember which language the questions were written in, and keep a cache
    // of the question text per language (the original is stored right away).
    state.fieldsLang = getCurrentLanguage();
    state.fields = result.fields.map((f) => ({
      ...f,
      questionLang: lang,
      questionTexts: { [lang]: f.question },
      helpTexts: { [lang]: typeof f.help === 'string' ? f.help : '' },
    }));
    state.answers = [];
    state.currentIndex = 0;
    state.formName = makeFormName(file.name);
    startFormFill();
  } catch (err) {
    showUploadMessage('spiritClerk.errReadFile');
  } finally {
    // Always hide the spinner; keep the file so the user can retry.
    uploadLoading.hidden = true;
    uploadConfirm.disabled = state.selectedFile === null;
  }
});

// ---------- Stubs for later tasks ----------

// ---------- Form-fill screen (task 6.4) ----------

// Show / clear the short status message on the fill screen.
function showFillMessage(key) {
  setI18nText(fillMessage, key);
  fillMessage.hidden = false;
}

function clearFillMessage() {
  clearI18n(fillMessage);
  fillMessage.hidden = true;
}

// Update the mic button to show whether we are listening.
function setListening(isListening) {
  micListening = isListening;
  micButton.classList.toggle('listening', isListening);
  setI18nText(micButton, isListening ? 'spiritClerk.stop' : 'spiritClerk.speak');
  micButton.setAttribute('aria-pressed', String(isListening));
  listeningIndicator.hidden = !isListening; // clear "Listening..." sign
}

// Stop any speech that is playing and any microphone that is listening.
function stopEverything() {
  voiceToken += 1;        // old speech callbacks must not start the microphone
  listenMode = '';
  commandPending = false;
  helpActive = false;
  if (speechOutput) speechOutput.stop();
  if (speechInput && speechInput.supported) speechInput.stop();
  setListening(false);
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
    setI18nText(micMessage, 'spiritClerk.voiceUnavailable');
    micMessage.hidden = false;
  } else {
    micButton.hidden = false;
    clearI18n(micMessage);
    micMessage.hidden = true;
  }
}

// Start of the form-fill flow (called after the fields are extracted).
function startFormFill() {
  showScreen('fill');

  // Fresh start.
  askId += 1;
  stopEverything();
  fillActive = true;
  state.answers = [];
  state.currentIndex = 0;
  state.language = getCurrentLanguage();
  redoCount = 0;
  silenceCount = 0;

  // The typed-answer box is created only once and always available.
  if (!textFallbackReady) {
    createTextFallback(textFallbackContainer, {
      onSubmit: (text) => handleAnswer(text),
      onError: () => {}, // the box shows its own "please type something" message
    });
    textFallbackReady = true;
  }

  createSpeechEngines();
  askCurrentQuestion();
}

// Show the current question, speak it, then start listening.
// `notice` is an optional short message to show with the question.
function askCurrentQuestion(notice) {
  const field = state.fields[state.currentIndex];
  askId += 1;
  const myId = askId; // callbacks below ignore themselves if askId changes
  stopEverything();

  phase = 'asking';
  pendingAnswer = null;
  autoListenTried = false;
  notUnderstood.reset();

  // Reset the screen for this question.
  fillLoading.hidden = true;
  confirmControls.hidden = true;
  clearI18n(confirmPrompt);
  confirmPrompt.hidden = true;
  helpText.textContent = '';
  helpText.hidden = true;
  helpButton.hidden = !(typeof field.help === 'string' && field.help.trim() !== '');
  renderDualDisplay(dualDisplayContainer, { heardText: '', englishMeaning: '' });
  clearI18n(fillAudioNote);
  fillAudioNote.hidden = true;
  clearFillMessage();
  const typedBox = textFallbackContainer.querySelector('textarea');
  if (typedBox) typedBox.value = '';

  // The question text is always visible, even without audio.
  // (Starts as the original text; replaced below if we translate it.)
  setI18nText(fillProgress, 'spiritClerk.progress', {
    n: state.currentIndex + 1,
    total: state.fields.length,
  });
  fillQuestion.textContent = field.question;
  if (notice) showFillMessage(notice);

  // After speech finishes (or is skipped), listen once for this question.
  let moved = false;
  function afterSpeech() {
    if (moved) return;
    moved = true;
    if (myId !== askId) return; // a newer question or language took over
    // Wait a moment so the microphone does not hear the end of our own voice.
    setTimeout(() => {
      if (myId === askId) autoStartListening();
    }, LISTEN_DELAY_MS);
  }

  // Show the "audio unavailable" note.
  function showAudioNote() {
    setI18nText(fillAudioNote, 'spiritClerk.audioUnavailable');
    fillAudioNote.hidden = false;
  }

  // Speak the given question text.
  function speakQuestion(text) {
    if (helpActive) return; // the help is being read: do not talk over it
    speechOutput.speak(text, {
      onEnd: afterSpeech,
      onError: (info) => {
        if (myId !== askId) return;
        if (info && info.audioUnavailable) showAudioNote();
        afterSpeech();
      },
    });
  }

  // Is the question already available in the current language?
  const wanted = state.language;
  field.questionTexts = field.questionTexts || {};
  const cached = field.questionTexts[wanted.bcp47];
  if (cached) {
    fillQuestion.textContent = cached;
    speakQuestion(cached);
    return;
  }

  // The question was generated in another language: translate it first.
  fillLoading.hidden = false;
  translate({ text: field.question, targetLang: wanted.label }).then((result) => {
    if (myId !== askId) return; // question or language changed while waiting
    fillLoading.hidden = true;

    const ok =
      result && !result.error && typeof result.translation === 'string' && result.translation.trim() !== '';
    if (ok) {
      field.questionTexts[wanted.bcp47] = result.translation; // cache it
      fillQuestion.textContent = result.translation;
      speakQuestion(result.translation);
    } else {
      // Do not speak with a mismatched voice: keep the original text on screen.
      showAudioNote();
      afterSpeech();
    }
  });
}

let autoListenTried = false; // auto-listen happens at most once per question

// Start the microphone automatically after the question was spoken.
function autoStartListening() {
  if (autoListenTried) return; // never start twice
  autoListenTried = true;
  if (phase !== 'asking' || micListening || voiceDisabled || helpActive) return;
  startAnswerListening();
}

// Open the microphone for an ANSWER.
function startAnswerListening() {
  if (phase !== 'asking' || micListening || voiceDisabled) return;
  if (!speechInput || !speechInput.supported) return;
  listenMode = 'answer';
  setListening(true); // set first: start() may report an error right away
  speechInput.start();
}

// Open the microphone ONCE for a command ("yes" / "again").
function startCommandListening() {
  commandPending = false;
  if (phase !== 'confirming' || micListening || voiceDisabled) return;
  if (!speechInput || !speechInput.supported) return;
  listenMode = 'command';
  setListening(true);
  speechInput.start();
}

// Stop command listening (if it is on). Used before Confirm / Redo run.
function cancelCommandListening() {
  commandPending = false;
  if (listenMode !== 'command') return;
  listenMode = '';
  if (speechInput && speechInput.supported) speechInput.stop();
  setListening(false);
}

// Show and speak "Is this right? Say yes or again.", then listen once.
function promptConfirm() {
  notUnderstood.reset();
  const myId = askId;
  const myToken = voiceToken;
  setI18nText(confirmPrompt, 'spiritClerk.confirmPrompt');
  confirmPrompt.hidden = false;
  commandPending = true;

  let done = false;
  function listenAfterPrompt() {
    if (done) return;
    done = true;
    // Ignore if the question changed, speech was stopped, or help is open.
    if (myId !== askId || myToken !== voiceToken || phase !== 'confirming' || helpActive) return;
    // Open the microphone only after our own voice has fully stopped.
    setTimeout(() => {
      if (myId !== askId || myToken !== voiceToken || phase !== 'confirming' || helpActive) return;
      startCommandListening();
    }, LISTEN_DELAY_MS);
  }
  speechOutput.speak(t('spiritClerk.confirmPrompt'), {
    onEnd: listenAfterPrompt,
    onError: listenAfterPrompt, // no audio: still listen
  });
}

// The mic button toggles listening on and off.
micButton.addEventListener('click', () => {
  if (!speechInput || !speechInput.supported || voiceDisabled) return;
  notUnderstood.reset(); // the user is in control: two fresh retries

  if (phase === 'asking') {
    autoListenTried = true; // the user is in control now
    if (micListening) {
      speechInput.stop();
      listenMode = '';
      setListening(false);
      return;
    }
    clearFillMessage();
    stopEverything(); // silences question / help speech: do not listen to our own voice
    startAnswerListening();
  } else if (phase === 'confirming') {
    // One more listen for a command (never an answer).
    if (micListening && listenMode === 'command') {
      cancelCommandListening();
      return;
    }
    clearFillMessage();
    stopEverything();
    startCommandListening();
  }
});

// A voice result arrived.
function handleVoiceResult(text) {
  if (!micListening) return; // we already stopped listening: stale result
  if (listenMode === 'command') {
    handleCommandResult(text);
  } else if (listenMode === 'answer') {
    if (cleanAnswer(text) === '') handleNotUnderstood(); // nothing usable was heard
    else handleAnswer(text);
  }
}

// A spoken command while confirming. It is never stored as an answer.
function handleCommandResult(text) {
  if (phase !== 'confirming') return;
  const command = matchCommand(text, {
    yes: parseWords(t('voice.yesWords')),
    redo: parseWords(t('voice.redoWords')),
  });
  if (command === null) {
    handleNotUnderstood(); // neither "yes" nor "again"
    return;
  }
  listenMode = '';
  setListening(false);
  if (command === 'yes') doConfirm();
  else doRedo();
}

// The microphone reported a problem (silence, unclear speech or a mic error).
function handleVoiceError(info) {
  if (!info || listenMode === '') return; // not listening for anything
  if (info.fallbackOnly) {
    // Too many mic failures: typing and the buttons only.
    listenMode = '';
    setListening(false);
    voiceDisabled = true;
    micButton.hidden = true;
    setI18nText(micMessage, 'spiritClerk.voiceNotWorking');
    micMessage.hidden = false;
    return;
  }
  handleNotUnderstood();
}

// Nothing was heard, or it was unclear, or the mic failed once.
// Say and show "I did not understand. Please say it once more." and listen
// again by itself, at most 2 times. After that listening stops and the
// buttons and the type box stay ready.
function handleNotUnderstood() {
  const mode = listenMode || (phase === 'confirming' ? 'command' : 'answer');
  listenMode = '';
  setListening(false);
  if (speechInput && speechInput.supported) speechInput.stop();
  if (!notUnderstood.next()) return; // both retries used: stop here

  const myId = askId;
  const myToken = voiceToken;
  showFillMessage('common.notUnderstood');

  let done = false;
  function listenAgain() {
    if (done) return;
    done = true;
    // Open the microphone only after the spoken message has finished.
    setTimeout(() => {
      if (myId !== askId || myToken !== voiceToken || helpActive) return;
      if (mode === 'answer' && phase === 'asking') startAnswerListening();
      else if (mode === 'command' && phase === 'confirming') startCommandListening();
    }, LISTEN_DELAY_MS);
  }
  speechOutput.speak(t('common.notUnderstood'), { onEnd: listenAgain, onError: listenAgain });
}

// The English text for something the user said.
// Names (field.kind === 'name') are NOT translated: they are written in English
// letters (ஷங்கர் -> Shankar) and then put in Title Case. Other fields are translated.
// Returns '' when the server could not do it.
async function englishFor(heardText, field) {
  const kind = field ? field.kind : 'text';
  const result = await translate({ text: heardText, targetLang: 'en', transliterate: kind === 'name' });
  if (result && !result.error && typeof result.translation === 'string') {
    return formatAnswerByKind(cleanAnswer(result.translation), kind);
  }
  return '';
}

// An answer (voice or typed) arrived for the current question.
async function handleAnswer(text) {
  if (phase !== 'asking') return; // ignore late or duplicate answers
  const heardText = cleanAnswer(text); // also covers typed and spoken text
  if (heardText === '') return;

  const myId = askId;
  const field = state.fields[state.currentIndex];
  phase = 'translating';
  stopEverything();
  clearFillMessage();

  // Already English: only names are tidied (Title Case).
  let englishMeaning = formatAnswerByKind(heardText, field.kind);
  if (state.language.bcp47 !== 'en-US') {
    fillLoading.hidden = false;
    // On failure the English meaning stays '' (shown as unavailable).
    englishMeaning = await englishFor(heardText, field);
    if (myId !== askId) return; // question or language changed while waiting
    fillLoading.hidden = true;
  }

  pendingAnswer = { heardText, englishMeaning };
  phase = 'confirming';
  renderDualDisplay(dualDisplayContainer, pendingAnswer);
  confirmControls.hidden = false;
  promptConfirm(); // ask aloud, then listen once for "yes" / "again"
}

// Save the answer for the current field (kept in field order).
function storeAnswer(heardText, englishMeaning, skipped) {
  state.answers[state.currentIndex] = {
    field: state.fields[state.currentIndex],
    heardText,
    englishMeaning,
    skipped,
  };
}

// Move to the next field, or to the summary when all are done.
function advance(notice) {
  askId += 1; // ignore anything still in flight for the old question
  stopEverything();
  state.currentIndex += 1;
  redoCount = 0;
  silenceCount = 0;

  if (state.currentIndex >= state.fields.length) {
    phase = 'idle';
    fillActive = false;
    showSummary();
    return;
  }
  askCurrentQuestion(notice);
}

// Confirm the answer. Used by the Confirm button AND by a spoken "yes".
function doConfirm() {
  if (phase !== 'confirming' || !pendingAnswer) return;
  storeAnswer(pendingAnswer.heardText, pendingAnswer.englishMeaning, false);
  advance();
}

// Ask the question again. Used by the Redo button AND by a spoken "again".
function doRedo() {
  if (phase !== 'confirming') return;
  if (nextRedoOrSkip(redoCount) === 'redo') {
    redoCount += 1;
    askCurrentQuestion(); // clears the display and asks again
  } else {
    storeAnswer('', '', true);
    advance('spiritClerk.tooManyTries');
  }
}

confirmButton.addEventListener('click', doConfirm);
redoButton.addEventListener('click', doRedo);

// ---------- Summary screen (task 6.5) ----------

const summaryLoading = document.getElementById('summary-loading');
const summaryList = document.getElementById('summary-list');
const summarySkipped = document.getElementById('summary-skipped');
const downloadPdfButton = document.getElementById('download-pdf');
const summaryMessage = document.getElementById('summary-message');

let summaryListenerAttached = false; // the Download click listener is added once

// The text to show for an answer: English meaning, else what was heard.
function answerText(answer) {
  if (answer.skipped) return null; // the caller shows the translated '(skipped)'
  return answer.englishMeaning || answer.heardText || '';
}

// The PDF always stays in English (Requirement 17.9), so these strings are
// NOT translated. Only English text goes in (the default PDF font
// cannot draw other scripts), so a missing translation is reported as unavailable.
function pdfAnswerText(answer) {
  // PDF stays English on purpose (Requirement 17.9): do not translate these.
  if (answer.skipped) return '(skipped)';
  return answer.englishMeaning || '(translation unavailable)';
}

// Show the filled summary screen.
async function showSummary() {
  stopEverything();
  showScreen('summary');

  clearI18n(summaryMessage);
  summaryMessage.hidden = true;
  summaryList.textContent = '';
  clearI18n(summarySkipped);
  summarySkipped.hidden = true;

  // Attach the Download button listener only once.
  if (!summaryListenerAttached) {
    downloadPdfButton.addEventListener('click', downloadPdf);
    summaryListenerAttached = true;
  }

  // Translate answers that have no English meaning yet (in parallel).
  summaryLoading.hidden = false;
  downloadPdfButton.disabled = true;
  await Promise.all(
    state.answers.map(async (answer) => {
      if (!answer || answer.skipped || answer.englishMeaning) return;
      try {
        answer.englishMeaning = await englishFor(answer.heardText, answer.field);
      } catch (err) {
        // Ignore: the heard text is used as the fallback below.
      }
      // If this failed, englishMeaning stays '' (screen shows the heard text; the PDF says unavailable).

    })
  );
  summaryLoading.hidden = true;
  downloadPdfButton.disabled = false;

  // Render every field in document order.
  let skippedCount = 0;
  state.fields.forEach((field, i) => {
    const answer = state.answers[i] || { field, heardText: '', englishMeaning: '', skipped: true };
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'summary-label';
    label.textContent = cleanLabel(field.label);
    const value = document.createElement('span');
    value.className = 'summary-answer';
    const shown = answerText(answer);
    if (shown === null) {
      setI18nText(value, 'spiritClerk.skippedAnswer');
    } else {
      value.textContent = shown;
    }
    li.append(label, value);
    if (answer.skipped) {
      li.classList.add('summary-item--skipped');
      skippedCount += 1;
    }
    summaryList.appendChild(li);
  });

  if (skippedCount > 0) {
    if (skippedCount === 1) {
      setI18nText(summarySkipped, 'spiritClerk.skippedOne');
    } else {
      setI18nText(summarySkipped, 'spiritClerk.skippedMany', { count: skippedCount });
    }
    summarySkipped.hidden = false;
  }
}

// Build and download the PDF summary.
function downloadPdf() {
  clearI18n(summaryMessage);
  summaryMessage.hidden = true;
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('jsPDF is not loaded');
    }
    // The default jsPDF font only supports Latin text, so we print the
    // English meaning (not the original script).
    const doc = new window.jspdf.jsPDF();
    const margin = 15;
    const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
    const pageBottom = doc.internal.pageSize.getHeight() - margin;
    let y = margin;

    doc.setFontSize(16);
    // The PDF stays English on purpose (Requirement 17.9): "Form: " is a literal.
    doc.text(`Form: ${state.formName}`, margin, y);
    y += 12;

    doc.setFontSize(12);
    const lineHeight = 7;
    state.fields.forEach((field, i) => {
      const answer = state.answers[i] || { skipped: true };
      const lines = doc.splitTextToSize(`${cleanLabel(field.label)}: ${pdfAnswerText(answer)}`, maxWidth);
      for (const line of lines) {
        if (y + lineHeight > pageBottom) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += lineHeight;
      }
      y += 2; // small gap between fields
    });

    doc.save(pdfFilename(state.formName, new Date()));
  } catch (err) {
    setI18nText(summaryMessage, 'spiritClerk.pdfError');
    summaryMessage.hidden = false;
  }
}

// ---------- Start ----------

showScreen('upload');
