// Spirit Clerk - app.js
// Task 6.3: the Upload screen.
// Tasks 6.4 (form fill) and 6.5 (summary) will extend this file.

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createSpeechInput } from '/skeleton/speech-input.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { renderDualDisplay } from '/skeleton/dual-display.js';
import { createTextFallback } from '/skeleton/text-fallback.js';
import { extractFields, translate } from '/skeleton/api-client.js';
import { nextRedoOrSkip, nextSilenceOrSkip, pdfFilename, cleanLabel } from '/apps/spirit-clerk/form-utils.js';
import { cleanAnswer } from '/skeleton/text-fallback-utils.js';
import { createNavMenu, createScreenHistory } from '/skeleton/nav-menu.js';

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
  }
}

// ---------- Navigation header (menu, Back, language) ----------

const LEAVE_MESSAGE = 'Your answers will be lost. Go back?';

// Ask before leaving only while the user is answering questions.
function getLeaveMessage() {
  return screenHistory.current() === 'fill' && fillActive ? LEAVE_MESSAGE : null;
}

// Called when the user really leaves the page: stop speech and microphone.
function onLeave() {
  stopEverything();
}

// Back button. Returns true if we handled it, false to let the nav go Home.
function handleBack() {
  if (!screenHistory.canGoBack()) return false;

  if (screenHistory.current() === 'fill' && fillActive) {
    if (!window.confirm(LEAVE_MESSAGE)) return true; // stay, but handled
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
function showUploadMessage(text) {
  uploadMessage.textContent = text;
  uploadMessage.hidden = false;
}

function clearUploadMessage() {
  uploadMessage.textContent = '';
  uploadMessage.hidden = true;
}

// Turn a server/client error code into friendly text.
function friendlyError(code) {
  if (code === 'timeout') {
    return 'Reading the form took too long. Please try again.';
  }
  if (code === 'busy') {
    return 'The service is busy right now. Please wait a moment and try again.';
  }
  if (code === 'network_error') {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return 'Something went wrong while reading your form. Please try again.';
}

// Returns an error message for a bad file, or '' if the file is fine.
function validateFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return 'Please choose a PDF, JPEG, PNG or WEBP file.';
  }
  if (file.size > MAX_FILE_BYTES) {
    return 'That file is too large. Please choose a file of 10 MB or less.';
  }
  return '';
}

// When the user picks a file: validate it before anything is sent.
fileInput.addEventListener('change', () => {
  clearUploadMessage();
  state.selectedFile = null;
  uploadConfirm.disabled = true;

  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  const problem = validateFile(file);
  if (problem) {
    showUploadMessage(problem);
    return;
  }

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
      showUploadMessage('We could not find any fields in that file. Please try again with a clearer file.');
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
    }));
    state.answers = [];
    state.currentIndex = 0;
    state.formName = makeFormName(file.name);
    startFormFill();
  } catch (err) {
    showUploadMessage('Could not read that file. Please choose it again.');
  } finally {
    // Always hide the spinner; keep the file so the user can retry.
    uploadLoading.hidden = true;
    uploadConfirm.disabled = state.selectedFile === null;
  }
});

// ---------- Stubs for later tasks ----------

// ---------- Form-fill screen (task 6.4) ----------

// Show / clear the short status message on the fill screen.
function showFillMessage(text) {
  fillMessage.textContent = text;
  fillMessage.hidden = false;
}

function clearFillMessage() {
  fillMessage.textContent = '';
  fillMessage.hidden = true;
}

// Update the mic button to show whether we are listening.
function setListening(isListening) {
  micListening = isListening;
  micButton.classList.toggle('listening', isListening);
  micButton.textContent = isListening ? 'Stop' : 'Speak';
  micButton.setAttribute('aria-pressed', String(isListening));
}

// Stop any speech that is playing and any microphone that is listening.
function stopEverything() {
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
    micMessage.textContent = 'Voice input is not available in this browser.';
    micMessage.hidden = false;
  } else {
    micButton.hidden = false;
    micMessage.textContent = '';
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

  // Reset the screen for this question.
  fillLoading.hidden = true;
  confirmControls.hidden = true;
  renderDualDisplay(dualDisplayContainer, { heardText: '', englishMeaning: '' });
  fillAudioNote.textContent = '';
  fillAudioNote.hidden = true;
  clearFillMessage();
  const typedBox = textFallbackContainer.querySelector('textarea');
  if (typedBox) typedBox.value = '';

  // The question text is always visible, even without audio.
  // (Starts as the original text; replaced below if we translate it.)
  fillProgress.textContent = `Question ${state.currentIndex + 1} of ${state.fields.length}`;
  fillQuestion.textContent = field.question;
  if (notice) showFillMessage(notice);

  // After speech finishes (or is skipped), listen once for this question.
  let moved = false;
  function afterSpeech() {
    if (moved) return;
    moved = true;
    if (myId !== askId) return; // a newer question or language took over
    autoStartListening();
  }

  // Show the "audio unavailable" note.
  function showAudioNote() {
    fillAudioNote.textContent = 'Audio is not available, so please read the question.';
    fillAudioNote.hidden = false;
  }

  // Speak the given question text.
  function speakQuestion(text) {
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
  clearFillMessage();
  if (speechOutput) speechOutput.stop(); // do not listen to our own voice
  setListening(true);
  speechInput.start();
});

// A voice answer arrived.
function handleVoiceResult(text) {
  if (!micListening) return; // we already stopped listening: stale result
  handleAnswer(text);
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
    micMessage.textContent = 'Voice input is not working. Please type your answer below.';
    micMessage.hidden = false;
  } else {
    showFillMessage('Please try again.');
  }
}

// Nothing was heard for a long time.
function handleSilence() {
  if (nextSilenceOrSkip(silenceCount) === 'reask') {
    silenceCount += 1;
    askCurrentQuestion('I did not hear anything. Let me ask again.');
  } else {
    storeAnswer('', '', true);
    advance('No answer heard. Skipping this question.');
  }
}

// An answer (voice or typed) arrived for the current question.
async function handleAnswer(text) {
  if (phase !== 'asking') return; // ignore late or duplicate answers
  const heardText = cleanAnswer(text); // also covers typed and spoken text
  if (heardText === '') return;

  const myId = askId;
  phase = 'translating';
  stopEverything();
  clearFillMessage();

  let englishMeaning = heardText;
  if (state.language.bcp47 !== 'en-US') {
    fillLoading.hidden = false;
    const result = await translate({ text: heardText, targetLang: 'en' });
    if (myId !== askId) return; // question or language changed while waiting
    fillLoading.hidden = true;
    // On failure the English meaning stays '' (shown as unavailable).
    englishMeaning =
      result && !result.error && typeof result.translation === 'string'
        ? cleanAnswer(result.translation)
        : '';
  }

  pendingAnswer = { heardText, englishMeaning };
  phase = 'confirming';
  renderDualDisplay(dualDisplayContainer, pendingAnswer);
  confirmControls.hidden = false;
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

confirmButton.addEventListener('click', () => {
  if (phase !== 'confirming' || !pendingAnswer) return;
  storeAnswer(pendingAnswer.heardText, pendingAnswer.englishMeaning, false);
  advance();
});

redoButton.addEventListener('click', () => {
  if (phase !== 'confirming') return;
  if (nextRedoOrSkip(redoCount) === 'redo') {
    redoCount += 1;
    askCurrentQuestion(); // clears the display and asks again
  } else {
    storeAnswer('', '', true);
    advance('Too many tries. Skipping this question.');
  }
});

// ---------- Summary screen (task 6.5) ----------

const summaryLoading = document.getElementById('summary-loading');
const summaryList = document.getElementById('summary-list');
const summarySkipped = document.getElementById('summary-skipped');
const downloadPdfButton = document.getElementById('download-pdf');
const summaryMessage = document.getElementById('summary-message');

let summaryListenerAttached = false; // the Download click listener is added once

// The text to show/print for an answer: English meaning, else what was heard.
function answerText(answer) {
  if (answer.skipped) return '(skipped)';
  return answer.englishMeaning || answer.heardText || '';
}

// The text to print in the PDF. Only English text goes in (the default PDF font
// cannot draw other scripts), so a missing translation is reported as unavailable.
function pdfAnswerText(answer) {
  if (answer.skipped) return '(skipped)';
  return answer.englishMeaning || '(translation unavailable)';
}

// Show the filled summary screen.
async function showSummary() {
  stopEverything();
  showScreen('summary');

  summaryMessage.textContent = '';
  summaryMessage.hidden = true;
  summaryList.textContent = '';
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
        const result = await translate({ text: answer.heardText, targetLang: 'en' });
        if (result && !result.error && typeof result.translation === 'string') {
          answer.englishMeaning = cleanAnswer(result.translation);
        }
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
    value.textContent = answerText(answer);
    li.append(label, value);
    if (answer.skipped) {
      li.classList.add('summary-item--skipped');
      skippedCount += 1;
    }
    summaryList.appendChild(li);
  });

  if (skippedCount > 0) {
    summarySkipped.textContent =
      skippedCount === 1 ? '1 field was skipped.' : `${skippedCount} fields were skipped.`;
    summarySkipped.hidden = false;
  }
}

// Build and download the PDF summary.
function downloadPdf() {
  summaryMessage.textContent = '';
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
    summaryMessage.textContent = 'Sorry, the PDF could not be created. Your summary is still here.';
    summaryMessage.hidden = false;
  }
}

// ---------- Start ----------

showScreen('upload');
