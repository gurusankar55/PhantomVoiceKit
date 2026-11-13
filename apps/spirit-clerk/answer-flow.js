// answer-flow.js
// Pure decisions of the Spirit Clerk answer flow (what to ask, in which language, when Gemini is
// needed, which message to show). No browser or DOM access here, so they are easy to test.

import { hasNonLatinLetters, cleanDate, cleanByKind } from './answer-cleaning.js';
import { finalAnswer } from './form-utils.js';
import { isValidDate, PATTERN_KINDS, parsePattern } from '../../skeleton/field-formats.js';

// Characters (letters and digits) and e-mail names are English, so they are heard with English
// recognition (en-IN understands Indian English best), whatever language the user speaks.
export const ENGLISH_RECOGNITION_LANG = 'en-IN';

// Done words that always work (the words of the chosen language come from voice.doneWords).
export const ENGLISH_DONE_WORDS = ['done', 'finished', 'that is all'];

/**
 * Does this field have one box per character?
 * @param {{kind:string, pattern?:string}} format
 */
export function usesCells(format) {
  return PATTERN_KINDS.includes(format.kind) && parsePattern(format.pattern).length > 0;
}

// A label that names a bank account number ("Account No.", "A/c number", "Acct"), not the PAN.
const ACCOUNT_LABEL = /\b(account|acct)\b|\ba\s*\/\s*c\b/i;

/**
 * Is the big on-screen keypad the MAIN way to answer this field? For codes (PAN, IFSC, GSTIN,
 * passport...) and bank account numbers: spoken letters and digits are too often misheard, so the
 * keypad opens by itself with the boxes, and voice is only an optional small "Speak" button that
 * hears the whole code in one turn (never group by group).
 * Phone, PIN and Aadhaar numbers stay voice-first (one whole number in one turn).
 * @param {{kind:string}} format  from resolveFormat
 * @param {string} [label]  the field label
 */
export function isKeypadFirst(format, label = '') {
  if (format.kind === 'code') return true;
  const text = String(label ?? '');
  return format.kind === 'number' && ACCOUNT_LABEL.test(text) && !/permanent\s+account/i.test(text);
}

/** Is this the English language (en-US, en-IN...)? */
export function isEnglishLang(lang) {
  return String(lang ?? '').split('-')[0].toLowerCase() === 'en';
}

// Kinds whose answer is made of digits: number words are changed into digits before cleaning.
export const NUMERIC_KINDS = ['number', 'phone', 'date', 'code'];

/**
 * How to listen for the answer of a field.
 *   - boxes (code / number with a pattern) and e-mail: the characters are Latin, but people say
 *     them in their own language ("மூணு", "பி"), so the CHOSEN language is tried first, and English
 *     (en-IN) is the fallback when nothing could be understood (`useEnglish`)
 *   - everything else: the language of the user
 * An English speaker always uses en-IN, which understands Indian English best.
 * @param {{kind:string, pattern?:string}} format
 * @param {string} uiLang  BCP-47 code of the chosen language
 * @param {boolean} [useEnglish]  true after the chosen language gave nothing for this field
 * @returns {{lang:string, characters:boolean}}  characters = letters, digits and e-mail names are expected
 */
export function listeningPlan(format, uiLang, useEnglish = false) {
  const characters = usesCells(format) || format.kind === 'email';
  if (!characters) return { lang: uiLang, characters };
  return { lang: useEnglish || isEnglishLang(uiLang) ? ENGLISH_RECOGNITION_LANG : uiLang, characters };
}

/**
 * The words that tell the user which group to say, as translation keys:
 * "First: letters (5)", "Now: digits (4)", "Last: letters (1)".
 * @param {'only'|'first'|'next'|'last'} position  from chunkPosition
 * @param {{type:'letters'|'digits'|'any', length:number}} chunk
 * @returns {{keys:string[], params:{count:number}}}  the keys are joined with a space
 */
export function chunkPromptKeys(position, chunk) {
  const prefix = { first: 'spiritClerk.chunkFirst', next: 'spiritClerk.chunkNext', last: 'spiritClerk.chunkLast' }[position];
  const what = { letters: 'spiritClerk.chunkLetters', digits: 'spiritClerk.chunkDigits', any: 'spiritClerk.chunkAny' }[chunk.type];
  return { keys: prefix ? [prefix, what] : [what], params: { count: chunk.length } };
}

/**
 * Does the heard text need Gemini to become the form-ready value?
 * Gemini is used when the user spoke another language, for dates that are not clear in English,
 * and for a code or e-mail address that came out in letters of another script. Numbers, phone
 * numbers, codes in Latin letters and e-mail addresses are cleaned on the device.
 * @param {{kind:string}} format
 * @param {string} heardText
 * @param {string} localValue  the text cleaned on the device
 * @param {string} uiLang
 */
export function needsGemini(format, heardText, localValue, uiLang) {
  const { kind } = format;
  if (kind === 'signature') return false;
  if (kind === 'date') return !isValidDate(cleanDate(heardText));
  // Digits are cleaned on the device. Only when nothing could be read from the words (a number said in a way the tables do not know) Gemini helps.
  if (kind === 'number' || kind === 'phone') return String(localValue ?? '').trim() === '' && uiLang !== 'en-US' && String(heardText ?? '').trim() !== '';
  if (kind === 'code' || kind === 'email') return hasNonLatinLetters(localValue);
  return uiLang !== 'en-US' && String(heardText ?? '').trim() !== '';
}

/** "Yes" or "No" for a checkbox answer said in English; other text is kept. */
export function checkboxValue(text) {
  const value = String(text ?? '').trim().replace(/[.!?,]+$/u, '');
  if (/^(yes|yeah|yep|yup|sure|ok|okay|correct|true|tick|checked|right)$/i.test(value)) return 'Yes';
  if (/^(no|nope|nah|false|not|unchecked|wrong)$/i.test(value)) return 'No';
  return value;
}

/**
 * "Question 3 of 9": every field is asked (a signature is drawn on a pad).
 * @param {unknown[]} fields
 * @param {number} index  index in fields
 * @returns {{n:number, total:number}}
 */
export function progressNumbers(fields, index) {
  return { n: Math.min(Math.max(1, index + 1), Math.max(1, fields.length)), total: fields.length };
}

/** The index of the last field, or -1 when there are none (used to go back from the review). */
export function lastAskableIndex(fields) {
  return fields.length - 1;
}

/**
 * The message to show when an answer is not valid yet.
 * @param {{valid:boolean, reason:string, count?:number}} result  from validateAnswer
 * @returns {{key:string, params?:object} | null}  null when there is nothing to say (valid, or still empty)
 */
export function validationMessage(result) {
  if (result.valid || result.reason === 'empty' || result.reason === '') return null;
  if (result.reason === 'email') return { key: 'spiritClerk.invalidEmail' };
  if (result.reason === 'date') return { key: 'spiritClerk.invalidDate' };
  if (result.reason === 'digits' && result.count > 0) return { key: 'spiritClerk.invalidDigits', params: { count: result.count } };
  return { key: 'spiritClerk.invalidFormat' };
}

// ---------------------------------------------------------------------------
// Every answer in English before it is kept (typed or spoken, any language)
// ---------------------------------------------------------------------------

/**
 * What "✓ Correct" does with the answer in the box (already tidied by finalAnswer):
 *   - only English (Latin) letters: keep it                                  -> { action: 'store', text }
 *   - other letters, and its English was already shown for EXACTLY this text -> { action: 'store', text: english }
 *   - other letters, no English shown yet: convert it first (one Gemini call),
 *     show the English and wait for a second "Correct"                       -> { action: 'convert' }
 * So nothing that is not English is ever written on the form or in the PDFs.
 * @param {string} value  the answer in the box
 * @param {{source:string, english:string}|null} preview  the English shown under the heard text
 * @returns {{action:'store'|'convert', text?:string}}
 */
export function englishStep(value, preview) {
  const text = String(value ?? '');
  if (!hasNonLatinLetters(text)) return { action: 'store', text };
  const shown = preview && preview.source === text ? String(preview.english ?? '').trim() : '';
  if (shown !== '' && !hasNonLatinLetters(shown)) return { action: 'store', text: shown };
  return { action: 'convert' };
}

/**
 * The English value from Gemini's reply, tidied for its kind (a name in Title Case, an address
 * with its parts...). Null when it is empty or still has letters that are not English: then the
 * answer is not accepted and the user stays on the question.
 * @param {unknown} raw  the reply's value (or translation)
 * @param {{kind:string, pattern?:string}} format
 * @param {{atWords?:string[], dotWords?:string[]}} [words]  e-mail words
 * @returns {string|null}
 */
export function acceptEnglish(raw, format, words = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const cleaned = finalAnswer(cleanByKind(raw, format.kind, words, format.pattern ?? ''), format.kind);
  if (cleaned === '' || hasNonLatinLetters(cleaned)) return null;
  return cleaned;
}
