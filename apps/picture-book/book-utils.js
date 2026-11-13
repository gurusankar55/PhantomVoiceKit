// book-utils.js
// Pure rules of the Picture book: the pages (categories of the 60 shared picture words), moving
// between words, the forgiving check of the word the child said, the count of words said and the
// gift every 10 words. No DOM, no network.

import { PICTURE_WORD_IDS, CATEGORIES, wordsOf, wordKey } from '../../skeleton/picture-words.js';
import { wordForms, matchSequence } from '../../skeleton/word-match.js';

export { CATEGORIES, wordsOf, wordKey };

// A level-up and a gift every this many words said.
export const WORDS_PER_GIFT = 10;

/** The translation key of a page name. */
export function categoryKey(category) {
  return `pictureBook.cat.${category}`;
}

/** Does this count of words said earn a level-up and a gift? (10, 20, 30...) */
export function isWordMilestone(count) {
  return Number.isInteger(count) && count > 0 && count % WORDS_PER_GIFT === 0;
}

/** The next or previous word on a page (it goes round: after the last comes the first). */
export function stepIndex(index, length, step) {
  if (!Number.isInteger(length) || length <= 0) return 0;
  const i = Number.isInteger(index) ? index : 0;
  return (((i + step) % length) + length) % length;
}

/** The shown name of a word: the first form of its locale value (or the id when it is missing). */
export function shownName(value, id) {
  return wordForms(value)[0] || id;
}

/**
 * The ways to say every one of the 60 words, from a translate function (t) or a strings object.
 * @returns {Record<string, string[]>}
 */
export function formsFrom(source) {
  const read = typeof source === 'function' ? source : (key) => (source ? source[key] : '');
  const forms = {};
  for (const id of PICTURE_WORD_IDS) {
    const value = read(wordKey(id));
    forms[id] = wordForms(value === wordKey(id) ? '' : value);
  }
  return forms;
}

/**
 * Did the child say this word? Forgiving: punctuation, case, endings and small spelling
 * differences are fine, but not when another picture word fits better.
 */
export function heardWord(heard, id, formsById, lang) {
  return matchSequence(heard, [id], formsById, lang).ok;
}
