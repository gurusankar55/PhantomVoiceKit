// Story time: 6 short, kind stories with a moral, read aloud paragraph by paragraph in the chosen
// language with the paragraph highlighted. Big text (A- / A+), Pause / Resume, Next / Back by
// buttons or by voice ("next", "back", "stop"), and the place where the reader stopped is
// remembered. Finishing a story gives a gift. The stories are in the locale files: no Gemini.

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createSpeechInput } from '/skeleton/speech-input.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { createNavMenu } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n } from '/skeleton/i18n.js';
import { parseWords } from '/skeleton/voice-commands.js';
import { giftBox } from '/skeleton/celebrate.js';
import {
  STORIES,
  PARAGRAPHS,
  titleKey,
  paragraphKey,
  clampParagraph,
  loadProgress,
  saveProgress,
  atParagraph,
  finishStory,
  clampFontStep,
  fontScale,
  storyCommand,
} from '/apps/story-time/story-utils.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

const screens = { list: document.getElementById('screen-list'), read: document.getElementById('screen-read') };
const listEl = document.getElementById('story-list');
const listButton = document.getElementById('list-button');
const smallerButton = document.getElementById('smaller-button');
const biggerButton = document.getElementById('bigger-button');
const titleEl = document.getElementById('story-title');
const progressEl = document.getElementById('story-progress');
const paragraphsEl = document.getElementById('paragraphs');
const theEnd = document.getElementById('the-end');
const previousButton = document.getElementById('previous-button');
const playButton = document.getElementById('play-button');
const nextButton = document.getElementById('next-button');
const voiceButton = document.getElementById('voice-button');
const listeningIndicator = document.getElementById('listening-indicator');
const messageEl = document.getElementById('message');

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let progress = loadProgress(storage());
const state = {
  language: getCurrentLanguage(),
  story: '', // the story id on the reader screen
  index: 0, // the paragraph being read (0 to 7)
  playing: false, // reading aloud right now
  started: false, // reading was started once (the button then says Resume)
};
let speechInput = null;
let speechOutput = null;
let listening = false;
let voiceOff = false;
let runId = 0; // every new reading step makes old callbacks do nothing

function handleBack() {
  if (screens.read.hidden) return false; // leave to Home
  showList();
  return true;
}

const nav = createNavMenu(document.getElementById('app-header'), { current: 'story-time', onBack: handleBack, onLeave: stopAll });
createLanguageDropdown(nav.languageEl, {
  onChange: (lang) => {
    state.language = lang;
    const wasPlaying = state.playing;
    createEngines();
    renderList();
    if (state.story) {
      renderStory();
      if (wasPlaying) play(); // go on reading in the new language
    }
  },
});
state.language = getCurrentLanguage();

function store() {
  saveProgress(storage(), progress);
}

// ---------- Speech ----------

function stopAll() {
  runId += 1;
  if (speechOutput) speechOutput.stop();
  if (speechInput && speechInput.supported) speechInput.stop();
  setListening(false);
  state.playing = false;
  renderPlayButton();
}

function createEngines() {
  stopAll();
  speechOutput = createSpeechOutput({ lang: state.language.bcp47 });
  const created = createSpeechInput({
    lang: state.language.bcp47,
    onResult: (text) => {
      if (speechInput === created) handleCommand(text);
    },
    onError: (info) => {
      if (speechInput === created) handleVoiceError(info);
    },
  });
  speechInput = created;
  voiceOff = !created.supported;
  voiceButton.hidden = voiceOff;
}

function setListening(on) {
  listening = on;
  listeningIndicator.hidden = !on;
  voiceButton.disabled = on;
}

// ---------- Messages ----------

function showMessage(key) {
  setI18nText(messageEl, key);
  messageEl.hidden = false;
}

function hideMessage() {
  clearI18n(messageEl);
  messageEl.hidden = true;
}

// ---------- The list ----------

function showList() {
  stopAll();
  state.story = '';
  screens.list.hidden = false;
  screens.read.hidden = true;
  renderList();
  listEl.querySelector('button')?.focus();
}

function renderList() {
  listEl.textContent = '';
  for (const story of STORIES) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'story-choice';
    const emoji = document.createElement('span');
    emoji.className = 'story-choice-emoji';
    emoji.setAttribute('aria-hidden', 'true');
    emoji.textContent = story.emoji;
    const text = document.createElement('span');
    text.className = 'story-choice-text';
    const title = document.createElement('span');
    title.className = 'story-choice-title';
    setI18nText(title, titleKey(story.id));
    const status = document.createElement('span');
    status.className = 'story-choice-status';
    const at = progress.at[story.id] ?? 0;
    if (at > 0) setI18nText(status, 'storyTime.continueAt', { n: at + 1 });
    else if (progress.finished.includes(story.id)) setI18nText(status, 'storyTime.finished');
    text.append(title, status);
    button.append(emoji, text);
    button.addEventListener('click', () => openStory(story.id));
    item.appendChild(button);
    listEl.appendChild(item);
  }
}

// ---------- The reader ----------

function openStory(id) {
  stopAll();
  state.story = id;
  state.index = clampParagraph(progress.at[id] ?? 0);
  state.started = false;
  progress = atParagraph(progress, id, state.index);
  store();
  screens.list.hidden = true;
  screens.read.hidden = false;
  hideMessage();
  renderStory();
  playButton.focus();
}

function renderStory() {
  setI18nText(titleEl, titleKey(state.story));
  paragraphsEl.textContent = '';
  for (let i = 0; i < PARAGRAPHS; i++) {
    const item = document.createElement('li');
    item.className = 'story-paragraph';
    item.dir = 'auto';
    setI18nText(item, paragraphKey(state.story, i));
    // Tap a paragraph to read from there.
    item.addEventListener('click', () => {
      goTo(i, true);
    });
    paragraphsEl.appendChild(item);
  }
  applyFontSize();
  renderPosition();
  renderPlayButton();
}

function renderPosition() {
  paragraphsEl.querySelectorAll('.story-paragraph').forEach((item, i) => {
    const on = i === state.index;
    item.classList.toggle('story-paragraph--now', on);
    if (on) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  });
  setI18nText(progressEl, 'storyTime.progress', { n: state.index + 1, total: PARAGRAPHS });
  previousButton.disabled = state.index === 0;
  theEnd.hidden = true;
}

function renderPlayButton() {
  const key = state.playing ? 'storyTime.pause' : state.started ? 'storyTime.resume' : 'storyTime.play';
  playButton.textContent = '';
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = state.playing ? '⏸️' : '▶️';
  const label = document.createElement('span');
  setI18nText(label, key);
  playButton.append(icon, ' ', label);
  playButton.setAttribute('aria-pressed', String(state.playing));
}

function scrollToCurrent() {
  const item = paragraphsEl.children[state.index];
  if (!item) return;
  let smooth = true;
  try {
    smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // keep smooth
  }
  item.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
}

// Read from the current paragraph to the end of the story.
function play() {
  if (!state.story) return;
  runId += 1;
  const myId = runId;
  if (speechInput && speechInput.supported) speechInput.stop();
  setListening(false);
  speechOutput.stop();
  state.playing = true;
  state.started = true;
  hideMessage();
  renderPlayButton();
  readCurrent(myId);
}

function readCurrent(myId) {
  renderPosition();
  scrollToCurrent();
  progress = atParagraph(progress, state.story, state.index);
  store();
  const text = t(paragraphKey(state.story, state.index));
  speechOutput.speak(text, {
    onEnd: () => {
      if (myId !== runId || !state.playing) return;
      if (state.index < PARAGRAPHS - 1) {
        state.index += 1;
        readCurrent(myId);
      } else {
        storyFinished();
      }
    },
    onError: (info) => {
      if (myId !== runId) return;
      state.playing = false;
      renderPlayButton();
      if (info && info.audioUnavailable) showMessage('storyTime.audioUnavailable');
    },
  });
}

function pause() {
  runId += 1;
  speechOutput.stop();
  state.playing = false;
  renderPlayButton();
}

// The last paragraph was read to its end: the story is finished.
function storyFinished() {
  state.playing = false;
  state.started = false;
  progress = finishStory(progress, state.story);
  store();
  renderPlayButton();
  theEnd.hidden = false;
  theEnd.scrollIntoView({ block: 'center' });
  speechOutput.speak(t('storyTime.theEnd'));
  giftBox();
}

// Go to a paragraph; reading goes on when it was on (or when `andPlay`).
function goTo(index, andPlay = false) {
  const wasPlaying = state.playing;
  pause();
  state.index = clampParagraph(index);
  progress = atParagraph(progress, state.story, state.index);
  store();
  renderPosition();
  scrollToCurrent();
  if (wasPlaying || andPlay) play();
}

playButton.addEventListener('click', () => (state.playing ? pause() : play()));
previousButton.addEventListener('click', () => goTo(state.index - 1));
nextButton.addEventListener('click', () => {
  if (state.index >= PARAGRAPHS - 1) {
    pause();
    storyFinished(); // Next on the last paragraph ends the story
    return;
  }
  goTo(state.index + 1);
});
listButton.addEventListener('click', () => showList());

// ---------- Voice commands: next, back, stop ----------

voiceButton.addEventListener('click', () => {
  if (voiceOff || listening || !speechInput || !speechInput.supported) return;
  pause(); // the microphone must not hear the reading voice
  hideMessage();
  setListening(true);
  speechInput.start({ continuous: false, lang: state.language.bcp47 });
});

function handleCommand(text) {
  setListening(false);
  const command = storyCommand(text, {
    next: parseWords(t('storyTime.nextWords')),
    back: parseWords(t('storyTime.backWords')),
    stop: parseWords(t('storyTime.stopWords')),
  });
  if (command === 'next') {
    if (state.index >= PARAGRAPHS - 1) storyFinished();
    else goTo(state.index + 1, true);
  } else if (command === 'back') {
    goTo(state.index - 1, true);
  } else if (command === 'stop') {
    pause();
  } else {
    showMessage('storyTime.notUnderstood');
  }
}

function handleVoiceError(info) {
  setListening(false);
  if (!info) return;
  if (info.fallbackOnly || ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(info.error)) {
    voiceOff = true;
    voiceButton.hidden = true;
    showMessage('storyTime.voiceOff'); // the buttons keep working
  } else {
    showMessage('storyTime.notUnderstood');
  }
}

// ---------- Text size ----------

function applyFontSize() {
  const step = clampFontStep(progress.fontStep);
  paragraphsEl.style.setProperty('--story-scale', String(fontScale(step)));
  smallerButton.disabled = step === 0;
  biggerButton.disabled = fontScale(step + 1) === fontScale(step);
}

function changeFont(delta) {
  progress = { ...progress, fontStep: clampFontStep(progress.fontStep + delta) };
  store();
  applyFontSize();
}

smallerButton.addEventListener('click', () => changeFont(-1));
biggerButton.addEventListener('click', () => changeFont(1));

// ---------- Start ----------

createEngines();
// Coming back: open the story that was being read, at its paragraph (reading starts on a tap).
if (progress.last && (progress.at[progress.last] ?? 0) > 0) openStory(progress.last);
else showList();
