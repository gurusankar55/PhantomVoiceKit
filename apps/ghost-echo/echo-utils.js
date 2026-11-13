// echo-utils.js
// Pure rules of Ghost Echo, the voice memory game: its 30 picture words, the sequences, the taps
// and the best level. The forgiving voice check is shared (skeleton/word-match.js) and the words
// come from skeleton/picture-words.js. No DOM, no storage of its own (storage is passed in), no
// network: easy to test.

import { PICTURE_WORDS, ECHO_WORD_IDS, wordKey, emojiOf } from '../../skeleton/picture-words.js';
export { wordForms, normalizeSpeech, editDistance, closeness, matchSequence } from '../../skeleton/word-match.js';
export { wordKey, emojiOf };

// The 30 words of the memory game (the first 30 of the shared picture words).
export const WORDS = Object.freeze(PICTURE_WORDS.filter((word) => ECHO_WORD_IDS.includes(word.id)));
export const WORD_IDS = ECHO_WORD_IDS;

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
