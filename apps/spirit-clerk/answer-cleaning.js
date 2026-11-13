// answer-cleaning.js
// Pure functions that tidy a heard or typed answer according to the kind of field.
// Speech recognition adds full stops, spaces and capital letters that spoil a phone number, a PAN
// code or an e-mail address. No browser or DOM access here, so they are easy to test.
//
// Kinds: "number" (digits only), "code" (PAN, IFSC...: capital letters and digits),
//        "email" (lower case, spoken "at" / "dot" become @ and .), "name", "date", "text".

import { cleanAnswer } from '../../skeleton/text-fallback-utils.js';
import { normalizeDigits } from '../../skeleton/digits.js';
import { toTitleCase } from './form-utils.js';
import { parsePattern, parseDateString, parseSpokenDate, formatDate } from '../../skeleton/field-formats.js';

// normalizeDigits lives in the skeleton now (shared with the games); it is still offered here.
export { normalizeDigits };

// Kinds that are cleaned by their own rules (everything else just loses its trailing full stop).
const STRICT_KINDS = ['number', 'phone', 'code', 'email'];

// Spoken "at" and "dot" in English are always understood, whatever the language of the form.
const ENGLISH_AT = ['at', 'at the rate', 'at sign'];
const ENGLISH_DOT = ['dot', 'period'];

// Escape the characters that have a meaning in a regular expression.
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replace each spoken word of `words` (whole words only) by `symbol`. Longer words go first so
// "at the rate" is found before "at".
function replaceSpoken(text, words, symbol) {
  const unique = [...new Set(words.map((word) => String(word).trim().toLowerCase()).filter((word) => word !== ''))];
  unique.sort((a, b) => b.length - a.length);
  let result = text;
  for (const word of unique) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${escapeRegExp(word)}(?![\\p{L}\\p{N}\\p{M}])`, 'gu');
    result = result.replace(pattern, ` ${symbol} `);
  }
  return result;
}

// Remove punctuation and spaces at the end (and the start) of an e-mail address.
function trimEmail(text) {
  return text.replace(/^[\s.,;:!?\u3002\u0964-]+/u, '').replace(/[\s.,;:!?\u3002\u0964-]+$/u, '');
}

/**
 * Digits only: "98765 43210." -> "9876543210"; "९८७" -> "987".
 * @param {string} text
 */
export function cleanNumber(text) {
  return normalizeDigits(String(text ?? '').normalize('NFKC')).replace(/[^0-9]/g, '');
}

/**
 * A code such as PAN or IFSC: capital letters and digits only, no spaces, dots or dashes.
 * "abcde 1234 f." -> "ABCDE1234F".
 * @param {string} text
 */
export function cleanCode(text) {
  return normalizeDigits(String(text ?? '').normalize('NFKC'))
    .replace(/[^\p{L}\p{M}\p{N}]/gu, '')
    .toUpperCase();
}

/**
 * An e-mail address: lower case, no spaces, spoken "at" / "dot" (English and the words of the
 * language) become @ and ".". "John dot Doe at Gmail dot com." -> "john.doe@gmail.com".
 * @param {string} text
 * @param {{atWords?:string[], dotWords?:string[]}} [words]  the words of the language (see voice.atWords)
 */
export function cleanEmail(text, { atWords = [], dotWords = [] } = {}) {
  let result = String(text ?? '').normalize('NFKC').toLowerCase();
  result = replaceSpoken(result, [...atWords, ...ENGLISH_AT], '@');
  result = replaceSpoken(result, [...dotWords, ...ENGLISH_DOT], '.');
  return trimEmail(result.replace(/\s+/gu, ''));
}

/**
 * Digits for a field with a digit pattern: a number longer than the pattern keeps its LAST digits
 * (so "+91 98765 43210" becomes the 10 digits of the mobile number). Others are unchanged.
 * @param {string} digits
 * @param {string} [pattern]
 */
export function fitDigitsToPattern(digits, pattern = '') {
  const cells = parsePattern(pattern);
  const onlyDigits = cells.length > 0 && cells.every((cell) => cell.type === 'digit');
  return onlyDigits && digits.length > cells.length ? digits.slice(digits.length - cells.length) : digits;
}

/**
 * A date as DD/MM/YYYY when it can be read (written or said in English); otherwise the text as it is.
 */
export function cleanDate(text) {
  const parsed = parseDateString(text);
  if (parsed) return formatDate(parsed.day, parsed.month, parsed.year);
  return parseSpokenDate(text) ?? cleanAnswer(text);
}

/**
 * Clean an answer by the kind of its field.
 *   number, phone -> digits only      code  -> UPPERCASE letters and digits, nothing else
 *   email -> lower case, @ and .      date  -> DD/MM/YYYY when it can be read
 *   name  -> no trailing full stop, Title Case
 *   others (text, address, choice, checkbox) -> no trailing full stop
 * @param {string} text
 * @param {string} kind
 * @param {{atWords?:string[], dotWords?:string[]}} [words]
 * @param {string} [pattern]  the pattern of a code or number field
 * @returns {string}  may be empty
 */
export function cleanByKind(text, kind, words = {}, pattern = '') {
  if (kind === 'number' || kind === 'phone') return fitDigitsToPattern(cleanNumber(text), pattern);
  if (kind === 'code') return cleanCode(text);
  if (kind === 'email') return cleanEmail(text, words);
  if (kind === 'date') return cleanDate(text);
  const plain = cleanAnswer(text);
  return kind === 'name' ? toTitleCase(plain) : plain;
}

/**
 * The text to keep as "what was heard". Number, code and e-mail answers are cleaned at once, so
 * the user sees "9876543210" and not "98765 43210." Other answers only lose their trailing full stop.
 */
export function cleanHeard(text, kind, words = {}, pattern = '') {
  return STRICT_KINDS.includes(kind) ? cleanByKind(text, kind, words, pattern) : cleanAnswer(text);
}
/**
 * Does this text still hold letters of a script other than Latin? A code or an e-mail address
 * heard in Tamil letters has to be written in Latin letters (transliterated) first.
 * @param {string} text
 */
export function hasNonLatinLetters(text) {
  return /(?!\p{Script=Latin})\p{L}/u.test(String(text ?? ''));
}

/**
 * Is this a kind that is cleaned on this device instead of being translated?
 */
export function isStrictKind(kind) {
  return STRICT_KINDS.includes(kind);
}
