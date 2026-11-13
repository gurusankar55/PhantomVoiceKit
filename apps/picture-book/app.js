// Picture book: big emoji pictures in pages (animals, fruits, colours, numbers, body...). The
// ghost says the word; the child says it back (forgiving match) or taps "I said it". Every word
// said gives a coin; every 10 words a level-up and a gift. "Learn another language" shows and
// says the word in a second language too. No Gemini calls: everything runs on the device.

import { createLanguageDropdown, getCurrentLanguage, LANGUAGES } from '/skeleton/language-dropdown.js';
import { createSpeechInput } from '/skeleton/speech-input.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { createNavMenu } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n, loadStrings } from '/skeleton/i18n.js';
import { correct, levelUp, giftBox } from '/skeleton/celebrate.js';
import { emojiOf } from '/skeleton/picture-words.js';
import { CATEGORIES, wordsOf, wordKey, categoryKey, isWordMilestone, stepIndex, shownName, formsFrom, heardWord } from '/apps/picture-book/book-utils.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

const SECOND_KEY = 'phantomVoiceKit.pictureBook.second'; // the second language (BCP-47 code)
const SPEAK_GUARD_MS = 4000;
const NEXT_DELAY_MS = 1400; // after a word was said, the next picture comes by itself

const pagesEl = document.getElementById('pages');
const card = document.getElementById('card');
const positionEl = document.getElementById('position');
const emojiEl = document.getElementById('emoji');
const wordEl = document.getElementById('word');
const secondWordEl = document.getElementById('second-word');
const hearButton = document.getElementById('hear-button');
const speakButton = document.getElementById('speak-button');
const saidButton = document.getElementById('said-button');
const listeningIndicator = document.getElementById('listening-indicator');
const messageEl = document.getElementById('message');
const previousButton = document.getElementById('previous-button');
const nextButton = document.getElementById('next-button');
const learnedEl = document.getElementById('learned');
const secondToggle = document.getElementById('second-toggle');
const secondSelect = document.getElementById('second-select');

const state = {
  language: getCurrentLanguage(),
  category: CATEGORIES[0],
  index: 0,
  learned: 0, // words said in this visit
  saidHere: false, // this picture already counted
  second: null, // { bcp47, strings } when "learn another language" is on
};
let speechInput = null;
let speechOutput = null;
let secondOutput = null;
let listening = false;
let voiceOff = false;
let runId = 0; // a new picture or a new step makes old timers and callbacks do nothing
let nextTimer = null;

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const nav = createNavMenu(document.getElementById('app-header'), { current: 'picture-book', onLeave: stopVoice });
createLanguageDropdown(nav.languageEl, {
  onChange: (lang) => {
    state.language = lang;
    createEngines();
    fillSecondSelect();
    renderPages();
    showWord(true);
  },
});
state.language = getCurrentLanguage();

// ---------- Words ----------

const currentIds = () => wordsOf(state.category);
const currentId = () => currentIds()[state.index];
const nameOf = (id) => shownName(t(wordKey(id)), id);
function secondNameOf(id) {
  if (!state.second || !state.second.strings) return '';
  return shownName(state.second.strings[wordKey(id)], '');
}

// ---------- Speech ----------

function stopVoice() {
  if (speechInput && speechInput.supported) speechInput.stop();
  if (speechOutput) speechOutput.stop();
  if (secondOutput) secondOutput.stop();
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
  if (voiceOff) showMessage('pictureBook.voiceOff');
}

function setListening(on) {
  listening = on;
  listeningIndicator.hidden = !on;
  speakButton.disabled = on;
}

function speakWith(output, text) {
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
      output.speak(text, { onEnd: finish, onError: finish });
    } catch {
      finish();
    }
  });
}

// The ghost says the word (and then the word in the second language).
async function sayWord() {
  const myId = ++runId;
  stopVoice();
  const id = currentId();
  await speakWith(speechOutput, nameOf(id));
  if (myId !== runId) return;
  const second = secondNameOf(id);
  if (second && secondOutput) await speakWith(secondOutput, second);
}

speakButton.addEventListener('click', () => {
  if (voiceOff || listening || !speechInput || !speechInput.supported) return;
  runId += 1;
  if (speechOutput) speechOutput.stop();
  if (secondOutput) secondOutput.stop();
  hideMessage();
  setListening(true);
  speechInput.start({ continuous: false, lang: state.language.bcp47 });
});

function handleHeard(text) {
  setListening(false);
  const heard = String(text ?? '').trim();
  if (heard === '') {
    showMessage('pictureBook.tryAgain');
    return;
  }
  if (heardWord(heard, currentId(), formsFrom(t), state.language.bcp47)) {
    wordSaid();
  } else {
    showMessage('pictureBook.heard', { text: heard });
    messageEl.append(' ', t('pictureBook.tryAgain'));
    sayWord(); // listen to it once more
  }
}

function handleVoiceError(info) {
  setListening(false);
  if (!info) return;
  if (info.fallbackOnly || ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(info.error)) {
    voiceOff = true;
    speakButton.hidden = true;
    showMessage('pictureBook.voiceOff'); // "I said it" keeps working
  } else {
    showMessage('pictureBook.tryAgain');
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

// ---------- A word was said ----------

function wordSaid() {
  if (state.saidHere) {
    showMessage('pictureBook.great');
    return;
  }
  state.saidHere = true;
  state.learned += 1;
  renderLearned();
  showMessage('pictureBook.great');
  correct({ coins: 1, from: card });
  if (isWordMilestone(state.learned)) {
    levelUp();
    giftBox();
  }
  clearTimeout(nextTimer);
  nextTimer = setTimeout(() => {
    if (document.querySelector('.pvk-gift-overlay')) return; // the gift is open: the child goes on with Next
    move(1);
  }, NEXT_DELAY_MS);
}

saidButton.addEventListener('click', () => {
  stopVoice();
  wordSaid();
});

// ---------- Moving between pictures and pages ----------

function showWord(speak = true) {
  clearTimeout(nextTimer);
  state.saidHere = false;
  const ids = currentIds();
  state.index = stepIndex(state.index, ids.length, 0);
  const id = currentId();
  emojiEl.textContent = emojiOf(id);
  wordEl.textContent = nameOf(id); // plain text, never HTML
  const second = secondNameOf(id);
  secondWordEl.textContent = second;
  secondWordEl.hidden = second === '';
  if (state.second) secondWordEl.lang = state.second.bcp47;
  setI18nText(positionEl, 'pictureBook.position', { n: state.index + 1, total: ids.length });
  card.classList.remove('book-card--in');
  void card.offsetWidth; // restart the small "appear" animation
  card.classList.add('book-card--in');
  if (speak) sayWord();
}

function move(step) {
  hideMessage();
  state.index = stepIndex(state.index, currentIds().length, step);
  showWord(true);
}

previousButton.addEventListener('click', () => move(-1));
nextButton.addEventListener('click', () => move(1));
hearButton.addEventListener('click', () => sayWord());

function renderPages() {
  pagesEl.textContent = '';
  for (const category of CATEGORIES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'book-page';
    const emoji = document.createElement('span');
    emoji.setAttribute('aria-hidden', 'true');
    emoji.textContent = emojiOf(wordsOf(category)[0]);
    const label = document.createElement('span');
    setI18nText(label, categoryKey(category));
    button.append(emoji, label);
    button.setAttribute('aria-pressed', String(category === state.category));
    button.addEventListener('click', () => {
      state.category = category;
      state.index = 0;
      hideMessage();
      renderPages();
      showWord(true);
    });
    pagesEl.appendChild(button);
  }
}

function renderLearned() {
  setI18nText(learnedEl, 'pictureBook.learned', { count: state.learned });
}

// ---------- Learn another language ----------

function fillSecondSelect() {
  const saved = readSecond();
  secondSelect.textContent = '';
  for (const lang of LANGUAGES) {
    if (lang.bcp47 === state.language.bcp47) continue;
    const option = document.createElement('option');
    option.value = lang.bcp47;
    option.textContent = lang.label === lang.native ? lang.label : `${lang.native} (${lang.label})`;
    option.lang = lang.bcp47;
    secondSelect.appendChild(option);
  }
  const wanted = saved && saved !== state.language.bcp47 ? saved : state.language.bcp47 === 'en-US' ? 'ta-IN' : 'en-US';
  secondSelect.value = wanted;
}

function readSecond() {
  try {
    return storage()?.getItem(SECOND_KEY) || '';
  } catch {
    return '';
  }
}

function writeSecond(code) {
  try {
    storage()?.setItem(SECOND_KEY, code);
  } catch {
    // not remembered: the page still works
  }
}

async function setSecond(on) {
  secondSelect.disabled = !on;
  if (!on) {
    state.second = null;
    if (secondOutput) secondOutput.stop();
    secondOutput = null;
    showWord(false);
    return;
  }
  const code = secondSelect.value;
  writeSecond(code);
  const strings = await loadStrings(code); // the app's own locale file (no AI)
  if (!secondToggle.checked || secondSelect.value !== code) return; // changed while loading
  state.second = { bcp47: code, strings };
  secondOutput = createSpeechOutput({ lang: code });
  showWord(true);
}

secondToggle.addEventListener('change', () => setSecond(secondToggle.checked));
secondSelect.addEventListener('change', () => setSecond(true));

// ---------- Start ----------

createEngines();
fillSecondSelect();
renderPages();
renderLearned();
showWord(false); // the first word is said when the child presses a button (browsers need a tap before sound)
