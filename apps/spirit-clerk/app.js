// Spirit Clerk - app.js
// The Upload screen, the form-fill screen (answers by voice like a voice message, or typed),
// the summary and "Fill the original form".
//
// How an answer works: the user presses "Speak", talks as long as needed and presses "Done"
// (or says a done word). The answer then appears in a real, editable box (or in character boxes,
// an e-mail box or date pickers, depending on the kind of the field). Nothing moves on by itself:
// only "✓ Correct" (button or word) goes to the next field and "✗ Wrong" clears the answer and
// listens again.

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createSpeechInput } from '/skeleton/speech-input.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { extractFields, translate, translateList } from '/skeleton/api-client.js';
import { pdfFilename, cleanLabel, finalAnswer, previousAnswerValue } from '/apps/spirit-clerk/form-utils.js';
import { renderPageImages } from '/skeleton/page-images.js';
import { MAX_PAGES, pdfPageSize, splitDataUrl } from '/skeleton/page-images-utils.js';
import { loadImage, drawAnswers, analyzeBoxes } from '/skeleton/form-overlay.js';
import { drawTextPages } from '/skeleton/text-pages.js';
import { clampOffset, MIN_OFFSET, MAX_OFFSET } from '/skeleton/form-overlay-utils.js';
import { answerLine, placeAnswers, moveOccupied, countPlaced, filledPdfFilename, reviewRows, SIGNATURE_TEXT } from '/apps/spirit-clerk/fill-original-utils.js';
import { matchOptionWords, optionEntries, optionsFor } from '/apps/spirit-clerk/option-utils.js';
import { localizedOption } from '/apps/spirit-clerk/choice-words.js';
import { numbersToDigits } from '/apps/spirit-clerk/spoken-numbers.js';
import { createNavMenu, createScreenHistory } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n } from '/skeleton/i18n.js';
import { keepPdf } from '/skeleton/documents-store.js';
import { matchCommand, parseWords } from '/skeleton/voice-commands.js';
import { LISTEN_DELAY_MS } from '/skeleton/voice-retry.js';
import { cleanByKind, hasNonLatinLetters } from '/apps/spirit-clerk/answer-cleaning.js';
import { spokenToChars, parseEmailSpeech } from '/apps/spirit-clerk/spoken-chars.js';
import { createAnswerWidget } from '/apps/spirit-clerk/answer-widgets.js';
import { resolveFormat, chunkPosition } from '/skeleton/field-formats.js';
import {
  ENGLISH_RECOGNITION_LANG,
  ENGLISH_DONE_WORDS,
  listeningPlan,
  chunkPromptKeys,
  needsGemini,
  checkboxValue,
  NUMERIC_KINDS,
  isKeypadFirst,
  progressNumbers,
  lastAskableIndex,
  validationMessage,
  englishStep,
  acceptEnglish,
} from '/apps/spirit-clerk/answer-flow.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

// ---------- Constants ----------

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const SPEAK_GUARD_MS = 12000; // if the voice never reports that it finished, go on after this long

// ---------- Module state ----------

// FieldAnswer: { field, heardText, englishMeaning, skipped, signature? }
const state = {
  fields: [],          // fields returned by the server (kind and pattern already resolved)
  answers: [],         // FieldAnswer objects, one per field
  currentIndex: 0,     // which field we are on
  formName: '',        // used in the PDF file name
  fieldsLang: null,    // { label, bcp47 } the questions were generated in
  language: getCurrentLanguage(), // { label, bcp47 }
  selectedFile: null,  // the valid file chosen by the user (kept for retries)
  pages: [],           // page images of the uploaded form: { dataUrl } (up to 5), kept for the preview
  pagesSkipped: 0,     // pages ignored because of the page limit
  editing: null,       // index of the field that is being changed from the review screen (or null)
};

// ---------- DOM references ----------

const screens = {
  upload: document.getElementById('screen-upload'),
  fill: document.getElementById('screen-fill'),
  review: document.getElementById('screen-review'),
  summary: document.getElementById('screen-summary'),
  original: document.getElementById('screen-original'),
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
const listeningIndicator = document.getElementById('listening-indicator');
const liveText = document.getElementById('live-text');
const doneButton = document.getElementById('done-button');
const chunkPrompt = document.getElementById('chunk-prompt');
const heardLine = document.getElementById('heard-line');
const heardTextEl = document.getElementById('heard-text');
const englishLine = document.getElementById('english-line');
const englishTextEl = document.getElementById('english-text');
const answerArea = document.getElementById('answer-area');
const answerHint = document.getElementById('answer-hint');
const confirmControls = document.getElementById('confirm-controls');
const confirmButton = document.getElementById('confirm-button');
const redoButton = document.getElementById('redo-button');
const confirmPrompt = document.getElementById('confirm-prompt');
const skipButton = document.getElementById('skip-button');
const howTo = document.getElementById('how-to-answer');
const fillMessage = document.getElementById('fill-message');
const fillLoading = document.getElementById('fill-loading');
const helpButton = document.getElementById('help-button');
const helpText = document.getElementById('help-text');

// ---------- Form-fill state ----------

let fillActive = false;    // true while the form-fill screen is running
let askId = 0;             // changes on every question and language change; late callbacks check it
let voiceToken = 0;        // bumped whenever speech or the microphone is stopped; late callbacks check it
let speechInput = null;    // result of createSpeechInput (may be { supported: false })
let speechOutput = null;   // result of createSpeechOutput
let voiceDisabled = false; // true when the microphone does not work: typing and buttons only
let listenMode = '';       // '' | 'answer' (the answer, until Done) | 'command' ("correct" / "wrong") | 'char' (one character)
let preparing = false;     // the prompt for the next group is being spoken; the microphone opens after it
let micListening = false;  // is the microphone open?
let busy = false;          // the answer is being translated
let widget = null;         // the answer widget of the current field
let currentField = null;
let currentFormat = { kind: 'text', pattern: '' };
let currentChunk = null;   // the group of characters that is being heard (boxes only)
let heardParts = [];       // what the user said for this field, in order
let charTarget = null;     // { type } while one character is being heard
let helpActive = false;    // true while the help is being read
let englishFallback = false; // the chosen language gave nothing for this field: the next try uses English (en-IN)
let localizedOptions = []; // the options of the current choice field in the chosen language: { label, aliases } or null
let keypadMode = false;    // codes and account numbers: the keypad is the main input, voice a small extra
// The English that will be written on the form for the text in the box: { source, english }.
// source = the answer in the box it belongs to (it is shown only while the box still says that).
let englishPreview = null;

// ---------- Screen helper ----------

// Tracks the screens the user has seen (upload is the first one).
const screenHistory = createScreenHistory('upload');

// Show one screen ('upload' | 'fill' | 'summary' | 'original') and hide the others.
function showScreen(name) {
  screenHistory.visit(name); // remember it so Back can return here
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

// ---------- Language handling ----------

// Called when the user picks a different language. If the form-fill screen is running, stop the
// microphone, build speech input and output for the new language and show the question again.
// The answer typed or heard so far is kept.
function onLanguageChanged() {
  if (!fillActive) return;
  stopEverything();
  askId += 1;
  createSpeechEngines();
  helpText.textContent = '';
  helpText.hidden = true;
  clearFillMessage();
  showQuestion(askId);
  if (currentField) loadOptionLabels(currentField, currentFormat, askId); // buttons in the new language
  updateButtons();
}

// ---------- Navigation header (menu, Back, language) ----------

// Ask before leaving only while the user is answering questions.
function getLeaveMessage() {
  const current = screenHistory.current();
  const answering = current === 'fill' && fillActive && state.editing === null;
  return answering || current === 'review' ? t('spiritClerk.leaveConfirm') : null;
}

// Called when the user really leaves the page: stop speech and microphone.
function onLeave() {
  stopEverything();
}

// Back button. Returns true if we handled it, false to let the nav go Home.
function handleBack() {
  if (!screenHistory.canGoBack()) return false;

  // Changing one answer from the review: Back returns to the review and keeps every answer.
  if (screenHistory.current() === 'fill' && fillActive && state.editing !== null) {
    askId += 1;
    stopEverything();
    fillActive = false;
    state.editing = null;
    destroyWidget();
    showReview();
    return true;
  }

  if (screenHistory.current() === 'fill' && fillActive) {
    if (!window.confirm(t('spiritClerk.leaveConfirm'))) return true; // stay, but handled
    // Leave the fill screen cleanly.
    askId += 1;
    stopEverything();
    fillActive = false;
    state.answers = [];
    fillLoading.hidden = true;
    destroyWidget();
  }

  const previous = screenHistory.back();
  if (previous === 'fill') {
    reopenLastQuestion(); // coming back from the summary
  } else {
    showScreen(previous);
  }
  return true;
}

// From the summary, go back to the last question that is asked (stored answers are kept).
function reopenLastQuestion() {
  const index = lastAskableIndex(state.fields);
  if (index < 0) {
    showReview();
    return;
  }
  showScreen('fill');
  fillActive = true;
  state.editing = null;
  state.currentIndex = index;
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
    // The form (photo or PDF) becomes up to 5 page images. They are sent to the server, and the
    // same pictures are shown later, so the answer boxes the AI finds match them.
    const { images, skipped } = await renderPageImages(file);
    const lang = getCurrentLanguage().bcp47;
    const result = await extractFields({ images: images.map(({ dataUrl }) => splitDataUrl(dataUrl)), lang });

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
      ...resolveFormat(f), // kind and character pattern (built-in patterns for PAN, IFSC, Aadhaar, mobile, PIN)
      questionLang: lang,
      questionTexts: { [lang]: f.question },
      helpTexts: { [lang]: typeof f.help === 'string' ? f.help : '' },
    }));
    state.answers = [];
    state.currentIndex = 0;
    state.pages = images;
    state.pagesSkipped = skipped;
    state.formName = makeFormName(file.name);
    startFormFill();
  } catch (err) {
    if (err && err.message === 'pdf_failed') showUploadMessage('formTranslator.errPdf');
    else showUploadMessage('spiritClerk.errReadFile');
  } finally {
    // Always hide the spinner; keep the file so the user can retry.
    uploadLoading.hidden = true;
    uploadConfirm.disabled = state.selectedFile === null;
  }
});


// ---------- Form-fill screen ----------

// Show / clear the short status message on the fill screen.
function showFillMessage(key, params) {
  setI18nText(fillMessage, key, params);
  fillMessage.hidden = false;
}

function clearFillMessage() {
  clearI18n(fillMessage);
  fillMessage.hidden = true;
}

// Show / clear the hint under the answer ("check the red boxes").
function showHint(message) {
  if (message) {
    setI18nText(answerHint, message.key, message.params);
    answerHint.hidden = false;
  } else {
    clearI18n(answerHint);
    answerHint.hidden = true;
  }
}

// What the user said, shown above the answer box (not editable).
function renderHeard() {
  const text = heardParts.join(' ').trim();
  heardTextEl.textContent = text;
  heardLine.hidden = text === '';
  renderEnglish();
}

// The English value under the heard text: shown while the box still holds the answer it belongs to.
function renderEnglish() {
  const current = widget && currentFormat.kind !== 'signature' ? finalAnswer(widget.getValue(), currentFormat.kind) : '';
  const show = Boolean(englishPreview) && englishPreview.source === current && englishPreview.english !== '';
  englishTextEl.textContent = show ? englishPreview.english : '';
  englishLine.hidden = !show;
}

// Turn an answer (typed or spoken, any language) into its form-ready English value with ONE
// Gemini call: a name transliterated in Title Case, an address or text translated, a date as
// DD/MM/YYYY... Gives null when there is no usable English value (no reply, or still not English).
async function toEnglish(text, format) {
  const result = await translate({
    text,
    targetLang: 'en',
    kind: format.kind,
    label: cleanLabel(currentField.label),
    pattern: format.pattern,
  });
  if (!result || result.error) return null;
  const raw = typeof result.value === 'string' && result.value.trim() !== '' ? result.value : result.translation;
  return acceptEnglish(raw, format, emailWords());
}

// Is the widget's answer valid right now?
function answerIsValid() {
  return Boolean(widget) && widget.validate().valid;
}

// Enable and hide the buttons according to what is going on. Called after every change.
function updateButtons() {
  const answering = listenMode === 'answer' || preparing;
  const voiceOk = Boolean(speechInput && speechInput.supported) && !voiceDisabled;

  // "Speak" is hidden while the answer is being heard; "Done" is shown while the microphone is open for it.
  // A signature is drawn on a pad, never spoken: no "Speak" for it.
  const spoken = currentFormat.kind !== 'signature';
  micButton.hidden = answering || !voiceOk || !spoken;
  // Codes and account numbers: the keypad is the main input, so "Speak" is a small extra button
  // and the keypad shows its own short hint.
  micButton.classList.toggle('btn--large', !keypadMode);
  micButton.classList.toggle('btn--small', keypadMode);
  doneButton.hidden = listenMode !== 'answer';
  howTo.hidden = !voiceOk || !spoken || keypadMode;
  if (widget && typeof widget.setVoiceAvailable === 'function') widget.setVoiceAvailable(voiceOk);
  setI18nText(micButton, 'spiritClerk.speak');

  // "Correct" needs a valid answer and nothing else going on. "Wrong" and "Skip" work at any time.
  confirmButton.disabled = answering || busy || !answerIsValid();
  redoButton.disabled = busy;
  skipButton.disabled = false;
}

// The microphone opened or closed.
function setListening(on) {
  micListening = on;
  listeningIndicator.hidden = !on;
  micButton.classList.toggle('listening', on);
  if (!on) {
    liveText.hidden = true;
    liveText.textContent = '';
  }
  updateButtons();
}

// The words of the current language for "at" and "dot" in an e-mail address.
function emailWords() {
  return { atWords: parseWords(t('voice.atWords')), dotWords: parseWords(t('voice.dotWords')) };
}

// Stop everything that talks or listens, and forget callbacks that are still on their way.
function stopEverything() {
  voiceToken += 1;
  listenMode = '';
  preparing = false;
  charTarget = null;
  helpActive = false;
  if (speechOutput) speechOutput.stop();
  if (speechInput && speechInput.supported) speechInput.stop();
  chunkPrompt.hidden = true;
  confirmPrompt.hidden = true;
  setListening(false);
}

// (Re)create speech input and output using the current language.
function createSpeechEngines() {
  if (speechInput && speechInput.supported) speechInput.stop();
  if (speechOutput) speechOutput.stop();
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
    onInterim: (text) => {
      if (speechInput === created) handleInterim(text);
    },
  });
  speechInput = created;

  if (!created.supported) {
    setVoiceOff(); // no speech recognition in this browser
  } else {
    clearI18n(micMessage);
    micMessage.hidden = true;
  }
  setListening(false);
}

// Voice cannot be used (no speech recognition in this browser, or the microphone is blocked or
// does not work). ONE clear message says so; typing and every button keep working.
function setVoiceOff() {
  voiceDisabled = true;
  setI18nText(micMessage, 'spiritClerk.voiceOff');
  micMessage.hidden = false;
  updateButtons();
}

// If the browser already knows that the microphone is blocked, say so before the first question.
async function checkMicrophonePermission() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    if (status.state === 'denied') setVoiceOff();
    status.onchange = () => {
      if (status.state === 'denied') setVoiceOff();
    };
  } catch {
    // This browser cannot tell (or has no Permissions API): the first listening will find out.
  }
}

// Speak a text and call `then` when it is finished, or when the voice cannot speak, or after a
// guard time (so a voice that never reports its end cannot leave the user waiting).
function speakThen(text, then) {
  let called = false;
  let timer = null;
  const once = () => {
    if (called) return;
    called = true;
    clearTimeout(timer);
    then();
  };
  timer = setTimeout(once, SPEAK_GUARD_MS);
  speechOutput.speak(text, { onEnd: once, onError: once });
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

  state.editing = null;

  createSpeechEngines();
  checkMicrophonePermission();
  askCurrentQuestion();
}

function destroyWidget() {
  if (widget) widget.destroy();
  widget = null;
  answerArea.textContent = '';
}

// Show the current question and its answer area. Nothing listens until the user presses "Speak".
// `notice` is an optional short message to show with the question.
function askCurrentQuestion(notice) {
  const field = state.fields[state.currentIndex];
  const format = resolveFormat(field);

  askId += 1;
  const myId = askId; // callbacks below ignore themselves if askId changes
  stopEverything();

  currentField = field;
  currentFormat = format;
  currentChunk = null;
  heardParts = [];
  englishPreview = null;
  busy = false;

  // Reset the screen for this question.
  fillLoading.hidden = true;
  helpText.textContent = '';
  helpText.hidden = true;
  helpButton.hidden = !(typeof field.help === 'string' && field.help.trim() !== '');
  clearI18n(fillAudioNote);
  fillAudioNote.hidden = true;
  clearFillMessage();
  showHint(null);
  renderHeard();

  destroyWidget();
  keypadMode = isKeypadFirst(format, field.label);
  widget = createAnswerWidget(answerArea, format, {
    onChange: onAnswerChanged,
    onSayChar: startCharListening,
    onSignLater: doSignLater,
    options: optionsFor({ kind: format.kind, options: field.options }),
    lang: state.language.bcp47,
    keypadFirst: keypadMode,
  });

  // Edit from the review: the earlier answer is already in the box (text, boxes, date, option,
  // signature), so the user only changes what is wrong.
  if (state.editing === state.currentIndex) {
    const previous = previousAnswerValue(state.answers[state.currentIndex]);
    if (previous !== null) widget.setValue(previous);
  }

  englishFallback = false;
  localizedOptions = [];
  loadOptionLabels(field, format, myId); // the options as buttons in the chosen language (choice fields)

  setI18nText(fillProgress, 'spiritClerk.progress', progressNumbers(state.fields, state.currentIndex));
  fillQuestion.textContent = field.question; // the original text until it is translated
  if (notice) showFillMessage(notice);

  showQuestion(myId);
  updateButtons();
}

// Show the question in the chosen language (translating it once) and read it aloud.
function showQuestion(myId) {
  const field = currentField;
  if (!field) return;
  const wanted = state.language;
  field.questionTexts = field.questionTexts || {};
  const cached = field.questionTexts[wanted.bcp47];

  const speakQuestion = (text) => {
    if (myId !== askId || helpActive) return;
    speechOutput.speak(text, {
      onError: (info) => {
        if (myId === askId && info && info.audioUnavailable) {
          setI18nText(fillAudioNote, 'spiritClerk.audioUnavailable');
          fillAudioNote.hidden = false;
        }
      },
    });
  };

  if (cached) {
    fillQuestion.textContent = cached;
    speakQuestion(cached);
    return;
  }

  // The question was generated in another language: translate it first.
  fillQuestion.textContent = field.question;
  fillLoading.hidden = false;
  translate({ text: field.question, targetLang: wanted.label }).then((result) => {
    if (myId !== askId) return; // question or language changed while waiting
    fillLoading.hidden = true;
    const ok = result && !result.error && typeof result.translation === 'string' && result.translation.trim() !== '';
    if (ok) {
      field.questionTexts[wanted.bcp47] = result.translation; // cache it
      fillQuestion.textContent = result.translation;
      speakQuestion(result.translation);
    } else {
      // Do not speak with a mismatched voice: keep the original text on screen.
      setI18nText(fillAudioNote, 'spiritClerk.audioUnavailable');
      fillAudioNote.hidden = false;
    }
  });
}

// The "?" button: show the help in the chosen language and read it aloud (again: hide it).
helpButton.addEventListener('click', async () => {
  const field = currentField;
  if (!field) return;
  if (!helpText.hidden) {
    helpText.hidden = true;
    helpActive = false;
    if (speechOutput) speechOutput.stop();
    return;
  }

  const myId = askId;
  const wanted = state.language;
  field.helpTexts = field.helpTexts || {};
  let text = field.helpTexts[wanted.bcp47];
  if (!text) {
    fillLoading.hidden = false;
    const result = await translate({ text: field.help, targetLang: wanted.label });
    if (myId !== askId) return;
    fillLoading.hidden = true;
    if (result && !result.error && typeof result.translation === 'string' && result.translation.trim() !== '') {
      text = result.translation;
      field.helpTexts[wanted.bcp47] = text;
    }
  }

  const spoken = Boolean(text);
  helpText.textContent = text || field.help; // if translating failed, the original help is shown
  helpText.hidden = false;
  if (spoken) {
    helpActive = true;
    speechOutput.speak(text, {
      onEnd: () => {
        helpActive = false;
      },
      onError: (info) => {
        helpActive = false;
        if (info && info.audioUnavailable) {
          setI18nText(fillAudioNote, 'spiritClerk.audioUnavailable');
          fillAudioNote.hidden = false;
        }
      },
    });
  } else {
    setI18nText(fillAudioNote, 'spiritClerk.audioUnavailable');
    fillAudioNote.hidden = false;
  }
});

// ---------- Listening ----------

// The user changed the answer (typing, a picker, a box...).
function onAnswerChanged() {
  // Typing or tapping ends the short wait for a spoken "correct" / "wrong" (and the question being read).
  if (listenMode === 'command') {
    cancelCommandListening();
  } else if (listenMode === '' && !preparing) {
    voiceToken += 1;
    confirmPrompt.hidden = true;
    if (speechOutput) speechOutput.stop();
  }
  renderEnglish(); // the English shown only belongs to the text it was made for
  showHint(liveHint());
  updateButtons();
}

// The hint while the user types or taps. It stays quiet while an answer is still being built:
// boxes only complain about a wrong character, an e-mail only once it has an ending.
function liveHint() {
  if (!widget) return null;
  const value = widget.getValue().trim();
  if (value === '') return null;
  if (widget.type === 'cells') return widget.hasBad() ? { key: 'spiritClerk.invalidFormat' } : null;
  if (currentFormat.kind === 'email' && !value.includes('@')) return null;
  return validationMessage(widget.validate());
}

// The live text while the user speaks.
function handleInterim(text) {
  if (listenMode !== 'answer') return;
  liveText.textContent = text;
  liveText.hidden = text === '';
}

// "Speak": listen until "Done". Boxes are asked group by group, an e-mail address part by part.
function startAnswerListening() {
  if (!fillActive || busy || !currentField) return;
  if (!speechInput || !speechInput.supported || voiceDisabled) return;
  if (listenMode === 'answer' || preparing) return;

  stopEverything(); // stops the question being read and any wait for "correct" / "wrong"
  clearFillMessage();
  helpText.hidden = true;

  let chunk = null;
  let promptText = '';
  if (widget.type === 'cells' && keypadMode) {
    // A code: the whole code in one turn from the first empty box, no "First: letters (5)".
    chunk = { type: 'any', start: widget.firstEmptyIndex(), length: widget.cells.length };
  } else if (widget.type === 'cells') {
    // The next group that is still empty; when everything is filled, start again from the first.
    chunk = widget.nextChunk() || { ...widget.chunks[0] };
    promptText = chunkPromptText(chunk);
  } else if (currentFormat.kind === 'email') {
    promptText = t('spiritClerk.emailAsk');
  }
  beginListening(chunk, promptText);
}

// The words that tell which group to say: "First: letters (5)".
function chunkPromptText(chunk) {
  const { keys, params } = chunkPromptKeys(chunkPosition(widget.chunks, chunk), chunk);
  return keys.map((key) => t(key, params)).join(' ');
}

// Say the prompt (if any), then open the microphone for the answer.
function beginListening(chunk, promptText) {
  const myId = askId;
  const myToken = voiceToken;
  currentChunk = chunk;

  const open = () => {
    if (myId !== askId || myToken !== voiceToken) return;
    preparing = false;
    listenMode = 'answer';
    liveText.textContent = '';
    liveText.hidden = true;
    const plan = listeningPlan(currentFormat, state.language.bcp47, englishFallback);
    const doneWords = [...parseWords(t('voice.doneWords')), ...ENGLISH_DONE_WORDS];
    setListening(true);
    speechInput.start({ continuous: true, lang: plan.lang, doneWords });
  };

  if (promptText === '') {
    open();
    return;
  }
  preparing = true;
  chunkPrompt.textContent = promptText;
  chunkPrompt.hidden = false;
  updateButtons();
  speakThen(promptText, () => setTimeout(open, LISTEN_DELAY_MS)); // let our own voice die away first
}

// "Done": end the answer now with what was heard.
doneButton.addEventListener('click', () => {
  if (listenMode === 'answer' && speechInput && speechInput.supported) speechInput.finish();
});

// "Speak"
micButton.addEventListener('click', () => {
  clearFillMessage();
  startAnswerListening();
});

// One character, said again for a tapped box.
function startCharListening(index, type) {
  if (!fillActive || busy) return;
  if (!speechInput || !speechInput.supported || voiceDisabled) return;
  stopEverything();
  clearFillMessage();
  charTarget = { type: { letter: 'letters', digit: 'digits', any: 'any' }[type] || 'any' };
  listenMode = 'char';
  setListening(true);
  // One letter or digit: the chosen language first, English (en-IN) after it gave nothing.
  speechInput.start({ continuous: false, lang: listeningPlan(currentFormat, state.language.bcp47, englishFallback).lang });
}

// One short word: "correct" / "wrong" (not an answer). Quiet: nothing heard means nothing happens.
function startCommandListening() {
  if (!fillActive || busy || micListening || voiceDisabled) return;
  if (!speechInput || !speechInput.supported) return;
  listenMode = 'command';
  setListening(true);
  speechInput.start({ continuous: false, lang: state.language.bcp47 });
}

// Stop waiting for "correct" / "wrong".
function cancelCommandListening() {
  voiceToken += 1;
  listenMode = '';
  confirmPrompt.hidden = true;
  if (speechOutput) speechOutput.stop();
  if (speechInput && speechInput.supported) speechInput.stop();
  setListening(false);
}

// After a valid answer: ask "Is this correct?" aloud once and listen once for "correct" / "wrong".
// The user can also just press a button; typing or tapping cancels the listening.
function offerVoiceConfirm() {
  if (!speechInput || !speechInput.supported || voiceDisabled) return;
  const myId = askId;
  const myToken = voiceToken;
  setI18nText(confirmPrompt, 'spiritClerk.confirmPrompt');
  confirmPrompt.hidden = false;
  speakThen(t('spiritClerk.confirmPrompt'), () => {
    setTimeout(() => {
      if (myId !== askId || myToken !== voiceToken || listenMode !== '' || !answerIsValid()) return;
      startCommandListening();
    }, LISTEN_DELAY_MS);
  });
}

// A voice result arrived.
function handleVoiceResult(text) {
  if (!micListening) return; // we already stopped listening: stale result
  const mode = listenMode;
  listenMode = '';
  setListening(false);
  if (mode === 'answer') handleAnswerHeard(text);
  else if (mode === 'command') handleCommandHeard(text);
  else if (mode === 'char') handleCharHeard(text);
}

// "correct" / "wrong" said aloud. Anything else is ignored quietly.
function handleCommandHeard(text) {
  confirmPrompt.hidden = true;
  const command = matchCommand(text, {
    yes: parseWords(t('voice.correctWords')),
    redo: parseWords(t('voice.wrongWords')),
  });
  if (command === 'yes') doConfirm();
  else if (command === 'redo') doWrong();
}

// One character said for a tapped box.
function handleCharHeard(text) {
  const chars = spokenToChars(text, charTarget ? charTarget.type : 'any', state.language.bcp47);
  charTarget = null;
  if (chars === '' || !widget || widget.type !== 'cells') {
    tryEnglishNext(); // the next try uses English
    showFillMessage('spiritClerk.nothingHeard');
    return;
  }
  widget.putCharAtSelected(chars[0]);
  afterAnswerReady();
}

// The microphone reported a problem.
function handleVoiceError(info) {
  const mode = listenMode;
  listenMode = '';
  charTarget = null;
  chunkPrompt.hidden = true;
  setListening(false);
  if (!info) return;

  // The microphone is not allowed or does not work: typing and the buttons only.
  const broken = info.fallbackOnly || ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(info.error);
  if (broken) {
    setVoiceOff();
    clearFillMessage();
    if (widget) widget.focus();
    return;
  }
  // Nothing was heard (or a passing problem): say so once. No automatic second try.
  if (mode === 'answer' || mode === 'char') showFillMessage('spiritClerk.nothingHeard');
  updateButtons();
}

// ---------- Understanding the answer ----------

// The user finished speaking (Done, a done word, or the 15 second safety stop).
async function handleAnswerHeard(text) {
  const myId = askId;
  const heard = String(text ?? '').trim();
  const chunk = currentChunk;
  chunkPrompt.hidden = true;
  if (heard === '') {
    showFillMessage('spiritClerk.nothingHeard');
    return;
  }
  heardParts.push(heard);
  renderHeard();

  // Boxes: the characters go into the boxes of this group (and the next ones if more were said).
  if (widget.type === 'cells') {
    const chars = spokenToChars(heard, chunk ? chunk.type : 'any', state.language.bcp47);
    if (chars === '') {
      tryEnglishNext(); // nothing could be read in the chosen language: the next try uses English
      showFillMessage('spiritClerk.nothingHeard');
      return;
    }
    widget.putChars(chunk ? chunk.start : 0, chars);
    const next = keypadMode ? null : widget.nextChunk(); // a code is never asked group by group
    if (next) {
      // Go on with the next group, as long as something was heard (so this always ends).
      currentChunk = next;
      beginListening(next, chunkPromptText(next));
      return;
    }
    afterAnswerReady();
    return;
  }

  // Options as buttons (a choice, a tick box): the option that was said is chosen.
  if (widget.type === 'choice') {
    busy = true;
    fillLoading.hidden = false;
    updateButtons();
    const index = await findSpokenOption(heard);
    if (myId !== askId) return; // question changed while waiting
    busy = false;
    fillLoading.hidden = true;
    if (index === -1) {
      updateButtons();
      showFillMessage('spiritClerk.noOptionMatch'); // the buttons are right there
      return;
    }
    widget.setValue(widget.options[index].value);
    afterAnswerReady();
    return;
  }

  // E-mail: the part before the @ (a whole address is kept as it is).
  if (currentFormat.kind === 'email') {
    const name = parseEmailSpeech(heard, emailWords(), state.language.bcp47);
    if (name === '') {
      tryEnglishNext();
      showFillMessage('spiritClerk.nothingHeard');
      return;
    }
    widget.setHeard(name);
    afterAnswerReady();
    return;
  }

  // Everything else: clean it, and ask Gemini for the form-ready English value when needed.
  busy = true;
  fillLoading.hidden = false;
  updateButtons();
  const result = await interpretAnswer(heard, currentFormat);
  if (myId !== askId) return; // question changed while waiting
  busy = false;
  fillLoading.hidden = true;
  widget.setValue(result.text);
  // Said in another language: the English value is shown under what was heard.
  if (result.text && hasNonLatinLetters(heard)) {
    const shown = finalAnswer(widget.getValue(), currentFormat.kind);
    englishPreview = { source: shown, english: shown };
    renderEnglish();
  }
  if (result.unavailable) showFillMessage('dualDisplay.unavailable');
  afterAnswerReady();
}

// Nothing could be read from what the chosen language gave for letters, digits or an e-mail name:
// the next listening for this field uses English (en-IN) instead.
function tryEnglishNext() {
  englishFallback = true;
}

// Show the options of a choice field in the chosen language and remember every way to say them.
//   - Yes / No: the words of the page language
//   - Male, Female, Other: the built-in words of the language (with colloquial forms)
//   - other options: translated in ONE Gemini call (cached for the field and the language)
// The value of an option stays the printed (English) label: that is what goes on the form and the PDF.
async function loadOptionLabels(field, format, myId) {
  if (!widget || widget.type !== 'choice') return;
  const lang = state.language.bcp47;

  if (format.kind === 'checkbox') {
    localizedOptions = [
      { label: t('spiritClerk.yes'), aliases: [] },
      { label: t('spiritClerk.no'), aliases: [] },
    ];
    return;
  }
  if (lang.split('-')[0].toLowerCase() === 'en') {
    localizedOptions = [];
    widget.setDisplay(widget.options.map(() => null));
    return;
  }

  field.optionLabels = field.optionLabels || {};
  let local = field.optionLabels[lang];
  if (!local) {
    local = widget.options.map((option) => localizedOption(option.value, lang));
    localizedOptions = local;
    widget.setDisplay(local.map((entry) => (entry ? entry.label : null)));

    const missing = local.map((entry, i) => (entry ? -1 : i)).filter((i) => i !== -1);
    if (missing.length > 0) {
      const result = await translateList({ list: missing.map((i) => widget.options[i].value), targetLang: state.language.label });
      if (myId !== askId) return; // question or language changed while waiting
      if (result && !result.error && Array.isArray(result.translations)) {
        missing.forEach((optionIndex, k) => {
          const translated = result.translations[k];
          if (translated && translated.label) local[optionIndex] = { label: translated.label, aliases: translated.aliases ?? [] };
        });
      }
    }
    field.optionLabels[lang] = local; // kept for this field and language
  }
  localizedOptions = local;
  widget.setDisplay(local.map((entry) => (entry ? entry.label : null)));
}

// Which option was said? The index in widget.options, or -1.
//   1. the words of the option (or its Yes / No): found on this device
//   2. a tick box: the "correct" / "wrong" words of the language mean Yes / No
//   3. otherwise ONE Gemini call picks the option, whatever language was spoken
async function findSpokenOption(heard) {
  const options = widget.options.map((option) => ({ label: option.value }));
  // The printed label, the label in the chosen language and its colloquial forms ("மேல்", "ஃபீமேல்").
  let index = matchOptionWords(heard, optionEntries(widget.options, localizedOptions));
  if (index !== -1) return index;

  if (currentFormat.kind === 'checkbox') {
    const command = matchCommand(heard, {
      yes: parseWords(t('voice.correctWords')),
      redo: parseWords(t('voice.wrongWords')),
    });
    if (command) return options.findIndex((option) => option.label === (command === 'yes' ? 'Yes' : 'No'));
  }

  const result = await translate({
    text: heard,
    targetLang: 'en',
    kind: currentFormat.kind,
    label: cleanLabel(currentField.label),
    options: options.map((option) => option.label),
  });
  if (result && !result.error) {
    index = matchOptionWords(
      typeof result.value === 'string' && result.value !== '' ? result.value : result.translation,
      optionEntries(widget.options)
    );
  }
  return index;
}

// The English form-ready value for what was said: { text, unavailable? }.
// ONE Gemini call (translate with kind, label and pattern) gives the meaning and the value.
async function interpretAnswer(heard, format) {
  const words = emailWords();
  const lang = state.language.bcp47;
  if (format.kind === 'checkbox' && lang === 'en-US') return { text: checkboxValue(heard) };

  // Numbers said as words ("மூணு ஒண்ணு") become digits before the text is cleaned.
  const prepared = NUMERIC_KINDS.includes(format.kind) ? numbersToDigits(heard, lang) : heard;
  const local = cleanByKind(prepared, format.kind, words, format.pattern);
  if (!needsGemini(format, prepared, local, lang)) return { text: local };

  // The same conversion as for a typed answer (see doConfirm).
  const english = await toEnglish(heard, format);
  if (english !== null) return { text: english };
  // Gemini did not answer: an English speaker keeps the cleaned text; others type the English.
  return lang === 'en-US' ? { text: local } : { text: '', unavailable: true };
}

// The answer box has been filled by voice: show what is wrong, or offer "correct" / "wrong" by voice.
function afterAnswerReady() {
  const result = widget.validate();
  showHint(validationMessage(result));
  updateButtons();
  if (result.valid) offerVoiceConfirm();
}

// ---------- Correct, Wrong, Skip ----------

// Save the answer for the current field (kept in field order).
function storeAnswer(heardText, englishMeaning, skipped, extra = {}) {
  state.answers[state.currentIndex] = {
    field: state.fields[state.currentIndex],
    heardText,
    englishMeaning,
    skipped,
    ...extra,
  };
}

// Move to the next field, or to the review screen when all are done. When one answer is being
// changed from the review, go back to the review.
function advance(notice) {
  askId += 1; // ignore anything still in flight for the old question
  stopEverything();

  if (state.editing !== null) {
    state.editing = null;
    fillActive = false;
    destroyWidget();
    showReview();
    return;
  }

  state.currentIndex += 1;
  if (state.currentIndex >= state.fields.length) {
    fillActive = false;
    destroyWidget();
    showReview();
    return;
  }
  askCurrentQuestion(notice);
}

// "✓ Correct" (button or word): keep the answer and go to the next field.
function doConfirm() {
  if (!fillActive || busy || !widget) return;
  const result = widget.validate();
  if (!result.valid) {
    showHint(validationMessage(result));
    return;
  }

  // The drawn signature is kept as a picture; the text of the answer is only a note.
  if (currentFormat.kind === 'signature') {
    stopEverything();
    storeAnswer('', SIGNATURE_TEXT, false, { signature: true, signatureImage: widget.getImage() });
    advance();
    return;
  }

  // An e-mail address is kept in lower case and a name in Title Case, whatever the user typed.
  const value = finalAnswer(widget.getValue(), currentFormat.kind);
  const step = englishStep(value, englishPreview);
  if (step.action === 'convert') {
    convertBeforeKeeping(value);
    return;
  }
  stopEverything();
  storeAnswer(heardParts.join(' ').trim() || value, step.text, false);
  advance();
}

// The answer in the box is not English (typed in Tamil, for example): ONE Gemini call turns it
// into the English value, which is shown under the heard text. The user checks it and presses
// "✓ Correct" again to keep it. When it cannot be converted, the user stays on the question and
// nothing that is not English is written on the form.
async function convertBeforeKeeping(value) {
  const myId = askId;
  stopEverything();
  busy = true;
  fillLoading.hidden = false;
  clearFillMessage();
  updateButtons();
  const english = await toEnglish(value, currentFormat);
  if (myId !== askId) return; // question changed while waiting
  busy = false;
  fillLoading.hidden = true;
  if (english === null) {
    englishPreview = null;
    renderEnglish();
    showFillMessage('spiritClerk.englishFailed');
  } else {
    englishPreview = { source: value, english };
    renderEnglish();
    showFillMessage('spiritClerk.checkEnglish');
  }
  updateButtons();
}

// "✗ Wrong" (button or word): clear the answer and listen again.
function doWrong() {
  if (!fillActive || busy || !widget) return;
  stopEverything();
  heardParts = [];
  englishPreview = null;
  renderHeard();
  clearFillMessage();
  showHint(null);
  if (widget.type === 'cells') widget.clear();
  else widget.setValue('');
  updateButtons();
  // A signature is drawn again and a code is typed again on the keypad (no listening); everything
  // else is listened to again.
  if (currentFormat.kind !== 'signature' && !keypadMode && speechInput && speechInput.supported && !voiceDisabled) startAnswerListening();
  else widget.focus();
}

// "Skip this question": the field stays empty.
function doSkip() {
  if (!fillActive) return;
  stopEverything();
  storeAnswer('', '', true, currentFormat.kind === 'signature' ? { signature: true } : {});
  advance();
}

// "I will sign by hand after printing": the signature field stays empty on purpose.
function doSignLater() {
  if (!fillActive) return;
  stopEverything();
  storeAnswer('', '', true, { signature: true, signatureLater: true });
  advance();
}

confirmButton.addEventListener('click', doConfirm);
redoButton.addEventListener('click', doWrong);
skipButton.addEventListener('click', doSkip);

// ---------- Review screen ----------
// Every field with its answer. "Edit" goes back to that one question and then returns here;
// "All correct" goes on to the summary.

const reviewList = document.getElementById('review-list');
const reviewAllCorrect = document.getElementById('review-all-correct');

// Fill one list item with the answer of a row: text, a small picture (signature) or a note.
function fillAnswerCell(cell, row) {
  if (row.status === 'signature') {
    const picture = document.createElement('img');
    picture.className = 'signature-small';
    picture.src = row.image;
    picture.alt = t('spiritClerk.signatureAlt');
    cell.appendChild(picture);
  } else if (row.status === 'signLater') {
    setI18nText(cell, 'spiritClerk.signByHand');
  } else if (row.status === 'skipped') {
    setI18nText(cell, 'spiritClerk.skippedAnswer');
  } else {
    cell.textContent = row.text; // the answer: plain text, never HTML
  }
}

function showReview() {
  stopEverything();
  showScreen('review');
  reviewList.textContent = '';
  for (const row of reviewRows(state.fields, state.answers)) {
    const item = document.createElement('li');
    if (row.status === 'skipped') item.classList.add('summary-item--skipped');

    const label = document.createElement('span');
    label.className = 'summary-label';
    label.textContent = row.label;
    const value = document.createElement('span');
    value.className = 'summary-answer';
    fillAnswerCell(value, row);

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn--secondary review-edit';
    edit.textContent = t('spiritClerk.edit');
    edit.setAttribute('aria-label', `${t('spiritClerk.edit')}: ${row.label}`);
    edit.addEventListener('click', () => editAnswer(row.index));

    item.append(label, value, edit);
    reviewList.appendChild(item);
  }
  reviewAllCorrect.focus();
}

// Go back to one question; after it, the review is shown again.
function editAnswer(index) {
  state.editing = index;
  state.currentIndex = index;
  fillActive = true;
  showScreen('fill');
  askCurrentQuestion();
}

reviewAllCorrect.addEventListener('click', () => showSummary());

// ---------- Summary screen ----------

const summaryList = document.getElementById('summary-list');
const summarySkipped = document.getElementById('summary-skipped');
const downloadPdfButton = document.getElementById('download-pdf');
const fillOriginalButton = document.getElementById('fill-original');
const summaryMessage = document.getElementById('summary-message');

let summaryListenerAttached = false; // the button listeners are added once

// The text of an answer for a PDF. The PDF always stays in English (Requirement 17.9), so these
// words are NOT translated; the labels and answers are drawn as pictures, so any script shows.
function pdfRowText(row) {
  if (row.status === 'signature') return SIGNATURE_TEXT;
  if (row.status === 'signLater') return '(to be signed by hand)';
  if (row.status === 'skipped') return '(skipped)';
  return row.text;
}

// Show the filled summary screen.
function showSummary() {
  stopEverything();
  showScreen('summary');

  clearI18n(summaryMessage);
  summaryMessage.hidden = true;
  summaryList.textContent = '';
  clearI18n(summarySkipped);
  summarySkipped.hidden = true;

  // Attach the button listeners only once.
  if (!summaryListenerAttached) {
    downloadPdfButton.addEventListener('click', downloadPdf);
    fillOriginalButton.addEventListener('click', showOriginal);
    summaryListenerAttached = true;
  }
  downloadPdfButton.disabled = false;
  fillOriginalButton.disabled = state.pages.length === 0;

  // Render every field in document order.
  let skippedCount = 0;
  for (const row of reviewRows(state.fields, state.answers)) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'summary-label';
    label.textContent = row.label;
    const value = document.createElement('span');
    value.className = 'summary-answer';
    fillAnswerCell(value, row);
    item.append(label, value);

    if (row.status === 'skipped' || row.status === 'signLater') item.classList.add('summary-item--skipped');
    const answer = state.answers[row.index];
    // A signature that is left for later is not a skipped question.
    if (row.status === 'skipped' && !(answer && answer.signature)) skippedCount += 1;
    summaryList.appendChild(item);
  }

  if (skippedCount > 0) {
    if (skippedCount === 1) {
      setI18nText(summarySkipped, 'spiritClerk.skippedOne');
    } else {
      setI18nText(summarySkipped, 'spiritClerk.skippedMany', { count: skippedCount });
    }
    summarySkipped.hidden = false;
  }
}

const PDF_JPEG_QUALITY = 0.92; // quality of the pages inside the downloaded PDFs

// Add canvases to a PDF, one page each (the text is part of the picture). Starts the PDF if needed.
function addCanvasesToPdf(doc, canvases) {
  let pdf = doc;
  for (const canvas of canvases) {
    const size = pdfPageSize(canvas.width, canvas.height);
    if (pdf === null) {
      pdf = new window.jspdf.jsPDF({ orientation: size.orientation, unit: 'pt', format: [size.width, size.height] });
    } else {
      pdf.addPage([size.width, size.height], size.orientation);
    }
    pdf.addImage(canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY), 'JPEG', 0, 0, size.width, size.height);
  }
  return pdf;
}

// Load a picture once (the signatures are data URLs).
async function loadPictures(dataUrls) {
  const pictures = new Map();
  for (const url of new Set(dataUrls.filter(Boolean))) pictures.set(url, await loadImage(url));
  return pictures;
}

// Build and download the PDF summary. The text is drawn on canvases and added as pictures, like the
// Form Translator PDF, so labels and answers in any script (Tamil, Arabic, Chinese...) are shown.
async function downloadPdf() {
  clearI18n(summaryMessage);
  summaryMessage.hidden = true;
  downloadPdfButton.disabled = true;
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF is not loaded');

    const rows = reviewRows(state.fields, state.answers);
    const pictures = await loadPictures(rows.map((row) => row.image));
    const entries = rows.map((row) => ({
      label: row.label,
      text: pdfRowText(row),
      image: row.image ? pictures.get(row.image) : undefined,
    }));
    // The PDF stays English on purpose (Requirement 17.9): "Form: " is a literal.
    const canvases = drawTextPages(entries, { title: `Form: ${state.formName}` });
    const doc = addCanvasesToPdf(null, canvases);
    for (const canvas of canvases) canvas.width = 0; // let the browser free the memory
    const name = pdfFilename(state.formName, new Date());
    doc.save(name);
    keepPdf(doc, name, 'spirit-clerk'); // also kept in "My documents" on this device (never throws)
  } catch (err) {
    setI18nText(summaryMessage, 'spiritClerk.pdfError');
    summaryMessage.hidden = false;
  } finally {
    downloadPdfButton.disabled = false;
  }
}

// ---------- Fill the original form ----------

const originalNotices = document.getElementById('original-notices');
const originalNoBox = document.getElementById('original-nobox');
const originalMessage = document.getElementById('original-message');
const originalUnplaced = document.getElementById('original-unplaced');
const originalUnplacedList = document.getElementById('original-unplaced-list');
const originalPages = document.getElementById('original-pages');
const originalSmaller = document.getElementById('original-smaller');
const originalAuto = document.getElementById('original-auto');
const originalBigger = document.getElementById('original-bigger');
const originalDownload = document.getElementById('original-download');
const originalBack = document.getElementById('original-back');

// What the preview shows now.
const original = {
  placement: null,  // { pages, unplaced } from placeAnswers
  figures: [],      // { canvas, image } for each page
  pictures: new Map(), // the signatures: data URL -> loaded picture
  scaleOffset: 0,   // A- / A+ presses away from Auto
};

function showOriginalMessage(key) {
  setI18nText(originalMessage, key);
  originalMessage.hidden = false;
}

function clearOriginalMessage() {
  clearI18n(originalMessage);
  originalMessage.hidden = true;
}

// Open the preview: the uploaded pages with every confirmed answer written in its answer box.
async function showOriginal() {
  clearOriginalMessage();
  if (state.pages.length === 0) return;

  try {
    const images = await Promise.all(state.pages.map((page) => loadImage(page.dataUrl)));

    // Where does each answer go? A box that already holds text is not used (nothing is written on
    // top of printed answers) and its answer is listed instead. A box divided into character cells
    // is written cell by cell. A box with a line to write on (solid, dashed, dotted) gets the text
    // just above the line. A tick mark needs no check: its box holds a printed circle or square.
    const first = placeAnswers(state.fields, state.answers, state.pages.length);
    const occupied = images.map((image, p) => {
      const entries = first.pages[p];
      const analysis = analyzeBoxes(image, entries.map((entry) => entry.box));
      entries.forEach((entry, i) => {
        if (entry.type === 'text') entry.cells = analysis[i].cells;
        if (entry.type === 'text' || entry.type === 'image') {
          entry.line = analysis[i].line; // the line to write or sign on
          entry.labelHeight = analysis[i].labelHeight; // the printed label: answers are sized from it
        }
      });
      return entries.map((entry, i) => entry.type !== 'tick' && analysis[i].occupied);
    });
    original.placement = moveOccupied(first, occupied);
    original.scaleOffset = 0;

    // The signatures, as loaded pictures.
    const urls = [...original.placement.pages.flat(), ...original.placement.unplaced].map((entry) => entry.image);
    original.pictures = await loadPictures(urls);

    // One canvas per page.
    originalPages.textContent = '';
    original.figures = images.map((image, index) => {
      const figure = document.createElement('figure');
      figure.className = 'page-figure';

      const caption = document.createElement('figcaption');
      caption.id = `original-caption-${index}`;
      setI18nText(caption, 'formTranslator.pageLabel', { n: index + 1, total: images.length });

      const canvas = document.createElement('canvas');
      canvas.className = 'page-canvas';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-labelledby', caption.id);

      figure.append(caption, canvas);
      originalPages.appendChild(figure);
      return { canvas, image };
    });

    // Notes: pages that were ignored (page limit).
    originalNotices.textContent = '';
    if (state.pagesSkipped > 0) {
      const item = document.createElement('li');
      setI18nText(item, 'formTranslator.pagesLimited', { max: MAX_PAGES });
      originalNotices.appendChild(item);
    }
    originalNotices.hidden = originalNotices.childElementCount === 0;

    // Answers that have no empty space on the form are listed, so none is lost.
    const { unplaced } = original.placement;
    originalUnplacedList.textContent = '';
    for (const entry of unplaced) {
      const item = document.createElement('li');
      item.textContent = `${entry.label}: ${entry.text}`; // the form's own words, plain text
      if (entry.image) {
        const picture = document.createElement('img');
        picture.className = 'signature-small';
        picture.src = entry.image;
        picture.alt = t('spiritClerk.signatureAlt');
        item.appendChild(picture);
      }
      originalUnplacedList.appendChild(item);
    }
    originalUnplaced.hidden = unplaced.length === 0;
    originalNoBox.hidden = !(unplaced.length > 0 && countPlaced(original.placement) === 0);

    showScreen('original');
    redrawOriginal();
  } catch {
    showOriginalMessage('spiritClerk.pdfError');
    showScreen('original');
  }
}

// What to draw for one placed answer.
function drawItem(entry) {
  if (entry.type === 'tick') return { type: 'tick', box: entry.box };
  if (entry.type === 'image') {
    return { type: 'image', box: entry.box, image: original.pictures.get(entry.image), line: entry.line, labelHeight: entry.labelHeight };
  }
  return {
    type: 'text',
    text: entry.text,
    box: entry.box,
    kind: entry.kind,
    cells: entry.cells,
    line: entry.line,
    labelHeight: entry.labelHeight,
  };
}

// Draw every page again with the current text size. Nothing is sent to the server.
function redrawOriginal() {
  original.figures.forEach(({ canvas, image }, index) => {
    drawAnswers(canvas, image, original.placement.pages[index].map(drawItem), { scaleOffset: original.scaleOffset });
  });
  // aria-disabled (not disabled) keeps the keyboard focus on the button.
  originalSmaller.setAttribute('aria-disabled', String(original.scaleOffset <= MIN_OFFSET));
  originalBigger.setAttribute('aria-disabled', String(original.scaleOffset >= MAX_OFFSET));
  originalAuto.setAttribute('aria-disabled', String(original.scaleOffset === 0));
}

function changeOriginalSize(newOffset) {
  const offset = clampOffset(newOffset);
  if (offset === original.scaleOffset) return;
  original.scaleOffset = offset;
  redrawOriginal();
}

originalSmaller.addEventListener('click', () => changeOriginalSize(original.scaleOffset - 1));
originalBigger.addEventListener('click', () => changeOriginalSize(original.scaleOffset + 1));
originalAuto.addEventListener('click', () => changeOriginalSize(0));

originalBack.addEventListener('click', () => {
  screenHistory.back();
  showScreen('summary');
});

// Download: one PDF page per page image (the answers are part of the picture), and an extra last
// page "Answers that could not be placed", drawn as a picture too so any script shows.
// The PDF stays English (Requirement 17.9).
originalDownload.addEventListener('click', async () => {
  clearOriginalMessage();
  originalDownload.disabled = true;
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF is not loaded');
    if (original.figures.length === 0) return;

    let doc = addCanvasesToPdf(null, original.figures.map(({ canvas }) => canvas));

    const { unplaced } = original.placement;
    if (unplaced.length > 0) {
      const entries = unplaced.map((entry) => ({
        label: entry.label,
        text: entry.text,
        image: entry.image ? original.pictures.get(entry.image) : undefined,
      }));
      const canvases = drawTextPages(entries, { title: 'Answers that could not be placed' });
      doc = addCanvasesToPdf(doc, canvases);
      for (const canvas of canvases) canvas.width = 0;
    }

    const name = filledPdfFilename(state.formName, new Date());
    doc.save(name);
    keepPdf(doc, name, 'spirit-clerk'); // also kept in "My documents" on this device (never throws)
  } catch (err) {
    showOriginalMessage('spiritClerk.pdfError');
  } finally {
    originalDownload.disabled = false;
  }
});

// ---------- Start ----------

showScreen('upload');
