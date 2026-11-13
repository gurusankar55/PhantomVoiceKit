// echo-utils.js
// Pure rules of Ghost Echo, the voice memory game: the picture words, the sequences, and the
// forgiving check of what the player said or tapped. No DOM, no storage of its own (storage is
// passed in), no network: easy to test.

// The 30 picture words. The name of each word in every language is the locale key
// "ghostEcho.words.<id>": "shown name|other way to say it|...".
export const WORDS = Object.freeze([
  { id: 'cat', emoji: '🐱' },
  { id: 'dog', emoji: '🐶' },
  { id: 'fish', emoji: '🐟' },
  { id: 'bird', emoji: '🐦' },
  { id: 'cow', emoji: '🐄' },
  { id: 'moon', emoji: '🌙' },
  { id: 'sun', emoji: '☀️' },
  { id: 'star', emoji: '⭐' },
  { id: 'tree', emoji: '🌳' },
  { id: 'flower', emoji: '🌸' },
  { id: 'apple', emoji: '🍎' },
  { id: 'banana', emoji: '🍌' },
  { id: 'mango', emoji: '🥭' },
  { id: 'milk', emoji: '🥛' },
  { id: 'water', emoji: '💧' },
  { id: 'house', emoji: '🏠' },
  { id: 'car', emoji: '🚗' },
  { id: 'bus', emoji: '🚌' },
  { id: 'boat', emoji: '⛵' },
  { id: 'ball', emoji: '⚽' },
  { id: 'book', emoji: '📖' },
  { id: 'chair', emoji: '🪑' },
  { id: 'cup', emoji: '☕' },
  { id: 'key', emoji: '🔑' },
  { id: 'clock', emoji: '⏰' },
  { id: 'hat', emoji: '🎩' },
  { id: 'shoe', emoji: '👟' },
  { id: 'rain', emoji: '🌧️' },
  { id: 'fire', emoji: '🔥' },
  { id: 'egg', emoji: '🥚' },
]);

export const WORD_IDS = Object.freeze(WORDS.map((word) => word.id));

/** The locale key of a word's names. */
export function wordKey(id) {
  return `ghostEcho.words.${id}`;
}

/** The emoji of a word ('' for an unknown id). */
export function emojiOf(id) {
  return WORDS.find((word) => word.id === id)?.emoji ?? '';
}

/**
 * The ways to say a word, from its locale value "பூனை|பூன": the first one is the name that is
 * shown and spoken, the others are accepted too.
 * @param {string} value
 * @returns {string[]}
 */
export function wordForms(value) {
  return String(value ?? '')
    .split('|')
    .map((form) => form.trim())
    .filter((form) => form !== '');
}

// ---------------------------------------------------------------------------
// Levels and sequences
// ---------------------------------------------------------------------------

// The longest sequence (a level above this keeps this length).
export const MAX_SEQUENCE = 12;
// A level-up and a gift come every this many levels.
export const MILESTONE_EVERY = 3;

/** How many words are shown at a level: 2 at level 1, one more each level (at most MAX_SEQUENCE). */
export function sequenceLength(level) {
  const n = Math.max(1, Math.floor(Number(level) || 1));
  return Math.min(MAX_SEQUENCE, n + 1);
}

// A whole number from 0 to n - 1 from random() (any value is made safe).
function pick(random, n) {
  const r = Number(random());
  const safe = Number.isFinite(r) ? Math.min(0.999999, Math.max(0, r)) : 0;
  return Math.floor(safe * n);
}

// Shuffle a copy of a list (Fisher-Yates).
function shuffled(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = pick(random, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** The words of one level: sequenceLength(level) different words in a random order. */
export function makeSequence(level, random = Math.random) {
  return shuffled(WORD_IDS, random).slice(0, sequenceLength(level));
}

/**
 * The picture buttons: every word of the sequence and some other words, shuffled. At least
 * `minimum` buttons, and always 3 more than the sequence (at most all 30 words).
 */
export function choiceWords(sequence, random = Math.random, minimum = 6) {
  const total = Math.min(WORD_IDS.length, Math.max(minimum, sequence.length + 3));
  const others = shuffled(WORD_IDS.filter((id) => !sequence.includes(id)), random);
  return shuffled([...new Set(sequence)].concat(others).slice(0, total), random);
}

/** Does a finished level earn a level-up and a gift? (levels 3, 6, 9...) */
export function isMilestone(level) {
  return Number.isInteger(level) && level > 0 && level % MILESTONE_EVERY === 0;
}

/** Were the pictures tapped in exactly the right order? */
export function tapsMatch(taps, sequence) {
  return Array.isArray(taps) && taps.length === sequence.length && taps.every((id, i) => id === sequence[i]);
}

// ---------------------------------------------------------------------------
// The forgiving voice check
// ---------------------------------------------------------------------------

// Languages written without spaces between words: compared character by character.
const NO_SPACE_LANGS = ['zh', 'ja', 'th'];
// Endings stuck to a word that still count ("பூனையும்", "고양이가", "kediyi"): at most this many characters.
const MAX_ENDING = 6;

/**
 * Text ready to compare: one Unicode form, lower case, no punctuation or symbols, single spaces.
 */
export function normalizeSpeech(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** How many single-character changes turn a into b (insert, delete, replace). */
export function editDistance(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const row = [i];
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    previous = row;
  }
  return previous[y.length];
}

// Small spelling differences that are accepted: none for a word of 1 or 2 letters (German "Ei",
// Turkish "ay": one change would make it almost any short word), 1 for a short word, 2 for a longer one.
function allowedDistance(form) {
  const length = Array.from(form).length;
  if (length <= 2) return 0;
  return length <= 4 ? 1 : 2;
}

// A short word stuck to the FRONT that still counts: Arabic "ال" (the) and "و" (and), "القطة".
const MAX_FRONT = 3;

/**
 * How close a piece of what was heard is to one way of saying a word (smaller is closer):
 *   0     the same
 *   0.5   the word with an ending stuck to it ("பூனையும்"), or a short word in front ("القطة")
 *   1, 2  small spelling differences (also with an ending: + 0.5)
 *   Infinity  not this word
 */
export function closeness(piece, form) {
  if (piece === '' || form === '') return Infinity;
  if (piece === form) return 0;
  const pieceChars = Array.from(piece);
  const formChars = Array.from(form);
  const longer = pieceChars.length - formChars.length;
  // A one-letter word (Korean "달", "별") may only carry a short ending ("달을", "별이").
  const maxEnding = formChars.length >= 2 ? MAX_ENDING : 2;
  if (longer > 0 && longer <= maxEnding && piece.startsWith(form)) return 0.5;
  if (formChars.length >= 2 && longer > 0 && longer <= MAX_FRONT && piece.endsWith(form)) return 0.5;
  const limit = allowedDistance(form);
  const distance = editDistance(piece, form);
  if (distance <= limit) return distance;
  if (formChars.length >= 3 && longer > 0 && longer <= MAX_ENDING) {
    const start = editDistance(pieceChars.slice(0, formChars.length).join(''), form);
    if (start <= limit) return start + 0.5;
  }
  return Infinity;
}

// The best way a word matches the heard words starting at token j: { score, width }.
function wordAt(tokens, j, forms) {
  let best = { score: Infinity, width: 1 };
  for (const form of forms) {
    const width = form.split(' ').length;
    if (j + width > tokens.length) continue;
    const score = closeness(tokens.slice(j, j + width).join(' '), form);
    if (score < best.score) best = { score, width };
  }
  return best;
}

/**
 * Did the player say the words in the right order? Words in between ("and", "then") are skipped.
 * A heard word counts for the expected word only when no OTHER picture word fits it better (so
 * "car" is not taken for "cat").
 * @param {string} heard  what the speech recognition gave
 * @param {string[]} expected  the word ids, in order
 * @param {Record<string, string[]>} formsById  every word's ways to say it (see wordForms)
 * @param {string} [lang]  BCP-47 code of the language spoken
 * @returns {{matched:number, ok:boolean}}  matched = how many words were found in order from the start
 */
export function matchSequence(heard, expected, formsById, lang = '') {
  const forms = {};
  for (const [id, list] of Object.entries(formsById ?? {})) {
    forms[id] = (Array.isArray(list) ? list : []).map(normalizeSpeech).filter((form) => form !== '');
  }
  const base = String(lang).split('-')[0].toLowerCase();
  const matched = NO_SPACE_LANGS.includes(base) ? matchWithoutSpaces(heard, expected, forms) : matchWords(heard, expected, forms);
  return { matched, ok: expected.length > 0 && matched === expected.length };
}

function matchWords(heard, expected, forms) {
  const tokens = normalizeSpeech(heard).split(' ').filter((token) => token !== '');
  const ids = Object.keys(forms);
  let position = 0;
  let matched = 0;
  for (const id of expected) {
    let found = -1;
    let width = 1;
    for (let j = position; j < tokens.length && found === -1; j++) {
      const mine = wordAt(tokens, j, forms[id] ?? []);
      if (mine.score === Infinity) continue;
      const beaten = ids.some((other) => other !== id && wordAt(tokens, j, forms[other]).score < mine.score);
      if (!beaten) {
        found = j;
        width = mine.width;
      }
    }
    if (found === -1) break;
    matched += 1;
    position = found + width;
  }
  return matched;
}

// Chinese and Japanese: the words are found in the text, in order, without spaces.
function matchWithoutSpaces(heard, expected, forms) {
  const text = normalizeSpeech(heard).replace(/ /g, '');
  let position = 0;
  let matched = 0;
  for (const id of expected) {
    let best = -1;
    let length = 0;
    for (const form of forms[id] ?? []) {
      const plain = form.replace(/ /g, '');
      const at = plain === '' ? -1 : text.indexOf(plain, position);
      if (at !== -1 && (best === -1 || at < best)) {
        best = at;
        length = plain.length;
      }
    }
    if (best === -1) break;
    matched += 1;
    position = best + length;
  }
  return matched;
}

// ---------------------------------------------------------------------------
// Best level (localStorage, every access in try/catch)
// ---------------------------------------------------------------------------

export const BEST_KEY = 'phantomVoiceKit.ghostEcho.best';

/** The best level reached so far (0 when none, or when storage cannot be read). */
export function loadBest(storage) {
  try {
    const n = Math.floor(Number(storage?.getItem(BEST_KEY)));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 0;
  } catch {
    return 0;
  }
}

/** Save the level when it is better than the best so far. Returns the best level now. */
export function saveBest(storage, level) {
  const best = loadBest(storage);
  const n = Math.floor(Number(level) || 0);
  if (n <= best) return best;
  try {
    storage?.setItem(BEST_KEY, String(n));
  } catch {
    // storage blocked: the best level is just not kept
  }
  return n;
}
