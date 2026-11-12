// answer-flow.js
// Pure decisions of the Spirit Clerk answer flow (what to ask, in which language, when Gemini is
// needed, which message to show). No browser or DOM access here, so they are easy to test.

import { hasNonLatinLetters, cleanDate } from './answer-cleaning.js';
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

/**
 * How to listen for the answer of a field.
 *   - boxes (code / number with a pattern): English recognition, one group at a time
 *   - e-mail: English recognition, the part before the @
 *   - everything else: the language of the user
 * @param {{kind:string, pattern?:string}} format
 * @param {string} uiLang  BCP-47 code of the chosen language
 * @returns {{lang:string, english:boolean}}
 */
export function listeningPlan(format, uiLang) {
  const english = usesCells(format) || format.kind === 'email';
  return { lang: english ? ENGLISH_RECOGNITION_LANG : uiLang, english };
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
  if (kind === 'number' || kind === 'phone') return false;
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
