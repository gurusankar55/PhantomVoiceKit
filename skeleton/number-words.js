// number-words.js
// A number from 0 to 20 said in any of the 20 languages, for the games (Pumpkin math).
// What is heard is read in this order:
//   1. digits, in any script ("12", "௧௨", "١٢")
//   2. the number words of the language, from the locale keys "numbers.0" ... "numbers.20"
//      ("பன்னிரண்டு|பனிரெண்டு"), with the forgiving match of word-match.js; when several fit,
//      the closest one wins, then the longest ("dix-sept" before "dix", "十二" before "十")
//   3. the digit words of Spirit Clerk (spoken-numbers.js): "ஒண்ணு ரெண்டு" -> 12
// Pure functions: no DOM, no network.

import { normalizeDigits } from './digits.js';
import { numbersToDigits } from './spoken-numbers.js';
import { normalizeSpeech, closeness, wordForms } from './word-match.js';

export const MAX_NUMBER = 20;

// Languages written without spaces between words: number words are found inside the text.
const NO_SPACE_LANGS = ['zh', 'ja', 'th'];

/** The locale key of the words of one number. */
export function numberKey(n) {
  return `numbers.${n}`;
}

/**
 * The ways to say every number 0..20, from a translate function (t) or a strings object.
 * @param {(key:string)=>string | Record<string,string>} source
 * @returns {string[][]}  index = the number
 */
export function numberFormsFrom(source) {
  const read = typeof source === 'function' ? source : (key) => (source ? source[key] : '');
  return Array.from({ length: MAX_NUMBER + 1 }, (_, n) => {
    const value = read(numberKey(n));
    return wordForms(value === numberKey(n) ? '' : value); // t() gives the key back when missing
  });
}

// The first whole number written with digits (any script), or null.
function digitsIn(text) {
  const match = normalizeDigits(String(text ?? '').normalize('NFKC')).match(/\d+/);
  return match ? Number(match[0]) : null;
}

// The number whose words fit what was heard best, or null.
function wordsIn(text, formsByNumber, lang) {
  const base = String(lang ?? '').split('-')[0].toLowerCase();
  const heard = normalizeSpeech(text);
  if (heard === '') return null;
  let best = null; // { n, score, length }
  const consider = (n, score, length) => {
    if (score === Infinity) return;
    if (!best || score < best.score || (score === best.score && length > best.length)) best = { n, score, length };
  };

  if (NO_SPACE_LANGS.includes(base)) {
    const plain = heard.replace(/ /g, '');
    formsByNumber.forEach((forms, n) => {
      for (const form of forms) {
        const f = normalizeSpeech(form).replace(/ /g, '');
        if (f !== '' && plain.includes(f)) consider(n, 0, Array.from(f).length);
      }
    });
    return best ? best.n : null;
  }

  const tokens = heard.split(' ');
  formsByNumber.forEach((forms, n) => {
    for (const form of forms) {
      const f = normalizeSpeech(form);
      if (f === '') continue;
      const width = f.split(' ').length;
      for (let j = 0; j + width <= tokens.length; j++) {
        consider(n, closeness(tokens.slice(j, j + width).join(' '), f), Array.from(f).length);
      }
    }
  });
  return best ? best.n : null;
}

/**
 * The number (0 to 20, or any number written with digits) that was said, or null.
 * @param {string} text  what the speech recognition gave
 * @param {string} lang  BCP-47 code of the language spoken
 * @param {string[][]} formsByNumber  from numberFormsFrom
 * @returns {number|null}
 */
export function spokenNumber(text, lang, formsByNumber) {
  const digits = digitsIn(text);
  if (digits !== null) return digits;
  const word = wordsIn(text, Array.isArray(formsByNumber) ? formsByNumber : [], lang);
  if (word !== null) return word;
  const fromDigitWords = digitsIn(numbersToDigits(text, lang).replace(/\s+/g, ''));
  return fromDigitWords;
}
