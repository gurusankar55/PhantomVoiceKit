// Voice notes: speak (Speak / Done) or type a note; the notes are saved on this device
// (localStorage) with their date. Each note can be read aloud in the chosen language, edited and
// deleted (with a question inside the page). Newest first, with a search box. No network calls.

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createSpeechInput } from '/skeleton/speech-input.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { createNavMenu } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n } from '/skeleton/i18n.js';
import { parseWords } from '/skeleton/voice-commands.js';
import { showInlineConfirm } from '/skeleton/inline-confirm.js';
import { loadNotes, saveNotes, addNote, updateNote, deleteNote, searchNotes, cleanNoteText } from '/apps/voice-notes/notes-utils.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

const ENGLISH_DONE_WORDS = ['done', 'finished'];

const input = document.getElementById('note-input');
const speakButton = document.getElementById('speak-button');
const doneButton = document.getElementById('done-button');
const listeningIndicator = document.getElementById('listening-indicator');
const liveText = document.getElementById('live-text');
const saveButton = document.getElementById('save-button');
const messageEl = document.getElementById('notes-message');
const searchInput = document.getElementById('search-input');
const countEl = document.getElementById('notes-count');
const emptyEl = document.getElementById('notes-empty');
const listEl = document.getElementById('notes-list');

// localStorage may be blocked: every use is in try/catch (inside notes-utils too).
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let notes = loadNotes(storage());
let language = getCurrentLanguage();
let speechInput = null;
let speechOutput = null;
let listening = false;
let voiceOff = false;
let readingId = ''; // the note that is being read aloud ('' = none)
let editingId = ''; // the note that is being edited ('' = none)

const nav = createNavMenu(document.getElementById('app-header'), { current: 'voice-notes', onLeave: stopVoice });
createLanguageDropdown(nav.languageEl, {
  onChange: (lang) => {
    language = lang;
    createEngines();
    render();
  },
});
language = getCurrentLanguage();

// ---------- Messages ----------

function showMessage(key) {
  setI18nText(messageEl, key);
  messageEl.hidden = false;
}

function hideMessage() {
  clearI18n(messageEl);
  messageEl.hidden = true;
}

// ---------- Speech ----------

function stopVoice() {
  if (speechInput && speechInput.supported) speechInput.stop();
  if (speechOutput) speechOutput.stop();
  setListening(false);
  readingId = '';
}

function createEngines() {
  stopVoice();
  speechOutput = createSpeechOutput({ lang: language.bcp47 });
  const created = createSpeechInput({
    lang: language.bcp47,
    onResult: (text) => {
      if (speechInput === created) handleHeard(text);
    },
    onError: (info) => {
      if (speechInput === created) handleVoiceError(info);
    },
    onInterim: (text) => {
      if (speechInput === created && listening) {
        liveText.textContent = text;
        liveText.hidden = text === '';
      }
    },
  });
  speechInput = created;
  setVoiceOff(!created.supported);
}

function setVoiceOff(off) {
  voiceOff = off;
  speakButton.hidden = off || listening;
  if (off) showMessage('voiceNotes.voiceOff');
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

speakButton.addEventListener('click', () => {
  if (voiceOff || listening || !speechInput || !speechInput.supported) return;
  if (speechOutput) speechOutput.stop();
  readingId = '';
  renderReadButtons();
  hideMessage();
  setListening(true);
  speechInput.start({
    continuous: true,
    lang: language.bcp47,
    doneWords: [...parseWords(t('voice.doneWords')), ...ENGLISH_DONE_WORDS],
  });
});

doneButton.addEventListener('click', () => {
  if (listening && speechInput && speechInput.supported) speechInput.finish();
});

// What was said is added to the text box (the user can still change it before saving).
function handleHeard(text) {
  setListening(false);
  const heard = String(text ?? '').trim();
  if (heard === '') {
    showMessage('voiceNotes.nothingHeard');
    return;
  }
  const before = input.value.trim();
  input.value = before === '' ? heard : `${before} ${heard}`;
  input.focus();
}

function handleVoiceError(info) {
  const was = listening;
  setListening(false);
  if (!info) return;
  const broken = info.fallbackOnly || ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(info.error);
  if (broken) setVoiceOff(true); // typing keeps working
  else if (was) showMessage('voiceNotes.nothingHeard');
}

// ---------- Save ----------

function store() {
  if (!saveNotes(storage(), notes)) showMessage('voiceNotes.saveFailed');
}

saveButton.addEventListener('click', () => {
  if (listening) speechInput.finish(); // keep what was said so far
  const text = cleanNoteText(input.value);
  if (text === '') {
    showMessage('voiceNotes.emptyNote');
    input.focus();
    return;
  }
  const result = addNote(notes, text, { lang: language.bcp47 });
  notes = result.notes;
  store();
  input.value = '';
  searchInput.value = '';
  showMessage('voiceNotes.saved');
  render();
});

// ---------- The list ----------

function formatDate(time) {
  try {
    return new Intl.DateTimeFormat(language.bcp47, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time));
  } catch {
    return new Date(time).toLocaleString();
  }
}

function button(icon, key, className, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn ${className}`;
  const iconEl = document.createElement('span');
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  const text = document.createElement('span');
  text.className = 'notes-button-text';
  setI18nText(text, key);
  b.append(iconEl, text);
  b.addEventListener('click', onClick);
  return b;
}

// Read a note aloud in the chosen language (again: stop).
function readAloud(note) {
  if (readingId === note.id) {
    speechOutput.stop();
    readingId = '';
    renderReadButtons();
    return;
  }
  if (listening) stopVoice();
  speechOutput.stop();
  readingId = note.id;
  renderReadButtons();
  speechOutput.speak(note.text, {
    onEnd: () => {
      if (readingId === note.id) {
        readingId = '';
        renderReadButtons();
      }
    },
    onError: (info) => {
      if (readingId === note.id) {
        readingId = '';
        renderReadButtons();
      }
      if (info && info.audioUnavailable) showMessage('voiceNotes.audioUnavailable');
    },
  });
}

// The Read aloud buttons say "Stop" while their note is being read.
function renderReadButtons() {
  for (const b of listEl.querySelectorAll('.notes-read')) {
    const on = b.dataset.id === readingId;
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('[aria-hidden]').textContent = on ? '⏹️' : '🔊';
    setI18nText(b.querySelector('.notes-button-text'), on ? 'voiceNotes.stop' : 'voiceNotes.readAloud');
  }
}

function askDelete(note, card) {
  showInlineConfirm(card, {
    message: t('voiceNotes.confirmDelete'),
    confirmKey: 'common.delete',
    onConfirm: () => {
      if (readingId === note.id) stopVoice();
      notes = deleteNote(notes, note.id);
      store();
      showMessage('voiceNotes.deleted');
      render();
      searchInput.focus();
    },
  });
}

// Edit inside the card: a text box with Save and Cancel.
function startEdit(note) {
  editingId = note.id;
  render();
  listEl.querySelector('.notes-edit-input')?.focus();
}

function noteCard(note) {
  const card = document.createElement('li');
  card.className = 'notes-card';

  const date = document.createElement('p');
  date.className = 'notes-date';
  date.textContent = formatDate(note.createdAt);
  if (note.updatedAt > note.createdAt) {
    const edited = document.createElement('span');
    edited.className = 'notes-edited';
    setI18nText(edited, 'voiceNotes.edited', { date: formatDate(note.updatedAt) });
    date.append(' · ', edited);
  }
  card.appendChild(date);

  if (editingId === note.id) {
    const label = document.createElement('label');
    label.className = 'notes-label';
    const box = document.createElement('textarea');
    box.className = 'notes-input notes-edit-input';
    box.id = `edit-${note.id}`;
    box.rows = 4;
    box.maxLength = 5000;
    box.value = note.text;
    label.htmlFor = box.id;
    setI18nText(label, 'voiceNotes.edit');
    const buttons = document.createElement('div');
    buttons.className = 'notes-buttons';
    buttons.append(
      button('💾', 'voiceNotes.saveEdit', 'notes-save-edit', () => {
        const text = cleanNoteText(box.value);
        if (text === '') {
          box.focus();
          return;
        }
        notes = updateNote(notes, note.id, text);
        editingId = '';
        store();
        showMessage('voiceNotes.saved');
        render();
      }),
      button('✖️', 'common.cancel', 'btn--secondary', () => {
        editingId = '';
        render();
      })
    );
    card.append(label, box, buttons);
    return card;
  }

  const text = document.createElement('p');
  text.className = 'notes-text';
  text.dir = 'auto';
  text.textContent = note.text; // plain text, never HTML
  const buttons = document.createElement('div');
  buttons.className = 'notes-buttons';
  const read = button('🔊', 'voiceNotes.readAloud', 'notes-read', () => readAloud(note));
  read.dataset.id = note.id;
  read.setAttribute('aria-pressed', 'false');
  buttons.append(
    read,
    button('✏️', 'voiceNotes.edit', 'btn--secondary', () => startEdit(note)),
    button('🗑️', 'common.delete', 'btn--secondary notes-delete', () => askDelete(note, card))
  );
  card.append(text, buttons);
  return card;
}

function render() {
  const shown = searchNotes(notes, searchInput.value);
  listEl.textContent = '';
  for (const note of shown) listEl.appendChild(noteCard(note));
  setI18nText(countEl, 'voiceNotes.count', { count: shown.length });
  if (notes.length === 0) {
    setI18nText(emptyEl, 'voiceNotes.empty');
    emptyEl.hidden = false;
  } else if (shown.length === 0) {
    setI18nText(emptyEl, 'voiceNotes.noResults');
    emptyEl.hidden = false;
  } else {
    clearI18n(emptyEl);
    emptyEl.hidden = true;
  }
  renderReadButtons();
}

searchInput.addEventListener('input', () => render());

// Another tab changed the notes.
window.addEventListener('storage', () => {
  notes = loadNotes(storage());
  if (editingId === '') render();
});

createEngines();
render();
