// spoken-chars.js
// Pure functions that turn what the recognizer heard into characters: a PAN chunk spelled letter by
// letter, digits said as words ("மூணு", "तीन", "three"), letter names in the chosen language
// ("பி" = B) or in English, "B for Bombay", and the part of an e-mail address before the @ sign.
// No browser or DOM access here, so they are easy to test.

import { cleanEmail } from './answer-cleaning.js';
import { numbersToDigits } from '../../skeleton/spoken-numbers.js';
import { letterNameMap, exampleLinks } from './letter-names.js';

// "alpha bravo charlie ..." -> letters
const NATO = {
  alpha: 'A', alfa: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E', foxtrot: 'F', golf: 'G', hotel: 'H',
  india: 'I', juliet: 'J', juliett: 'J', kilo: 'K', lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P',
  quebec: 'Q', romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U', victor: 'V', whiskey: 'W', xray: 'X',
  yankee: 'Y', zulu: 'Z',
};

// Words the recognizer writes for the NAME of a letter ("bee" for B, "are" for R).
const LETTER_NAMES = {
  ay: 'A', eh: 'A', oh: 'O', be: 'B', bee: 'B', see: 'C', sea: 'C', cee: 'C', dee: 'D', gee: 'G', jay: 'J', kay: 'K',
  el: 'L', ell: 'L', em: 'M', en: 'N', pee: 'P', cue: 'Q', queue: 'Q', are: 'R', ess: 'S', tea: 'T', tee: 'T',
  you: 'U', vee: 'V', ex: 'X', why: 'Y', wye: 'Y', zed: 'Z', zee: 'Z', eye: 'I', aye: 'I',
};

// Numbers said as words in English (the words of the other languages are in spoken-numbers.js).
const NUMBER_WORDS = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };

// Words the recognizer writes instead of a digit ("to" for 2) - used only where a digit is expected.
const DIGIT_SOUNDS = { to: '2', too: '2', for: '4', fore: '4', won: '1', ate: '8', tree: '3', nein: '9' };

// Small words people say around the characters; they are not characters.
const FILLERS = new Set([
  'um', 'umm', 'uh', 'uhh', 'er', 'ah', 'hmm', 'the', 'and', 'is', 'it', 'its', 'my', 'number', 'code', 'card',
  'okay', 'ok', 'yes', 'no', 'please', 'sorry', 'first', 'last', 'now', 'next', 'then', 'so', 'letters', 'digits',
  'again', 'wait', 'done', 'finished',
]);

// "double u" is the letter W; "double 5" = 55 is handled by numbersToDigits.
const REPEATS = { double: 2, dubble: 2, triple: 3, treble: 3 };

// Words that join a letter and its example word: "B for Bombay", "B as in Bombay".
const EXAMPLE_LINKS = ['for', 'as', 'like'];

// Cut a text into lower case tokens: letters, their marks and digits stay, everything else separates.
function tokenize(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[\u200c\u200d]/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// "B for Bombay" / "b as in bombay" / Tamil "பி ஃபார் பாம்பே": tokens[i] is the letter, tokens[i+1]
// the link, then the example word. Returns { letter, skip } when there is one at position i, else null.
function exampleAt(tokens, i, links, nativeLetters) {
  const link = tokens[i + 1];
  if (!EXAMPLE_LINKS.includes(link) && !links.includes(link)) return null;
  let wordIndex = i + 2;
  if (link === 'as' && tokens[wordIndex] === 'in') wordIndex += 1;
  const word = tokens[wordIndex];
  if (!word || !/^[\p{L}\p{M}]{2,}$/u.test(word)) return null;

  const spoken = tokens[i];
  let letter = null;
  if (/^[a-z]$/.test(spoken)) letter = spoken.toUpperCase();
  else if (LETTER_NAMES[spoken]) letter = LETTER_NAMES[spoken];
  else if (NATO[spoken]) letter = NATO[spoken];
  else if (nativeLetters.has(spoken)) letter = nativeLetters.get(spoken);
  // The letter was misheard: a Latin example word gives it (b for BOMBAY -> B).
  if (letter === null && /^[a-z]/.test(word)) letter = word[0].toUpperCase();
  if (letter === null || !/^[A-Z]$/.test(letter)) return null;
  return { letter, skip: wordIndex - i + 1 };
}

/**
 * Turn heard words into characters for one group of a pattern.
 * @param {string} text  e.g. "A B C D E", "ஏ பி சி", "b for bombay", "மூணு ஒண்ணு", "double five", "abcde 1234 f"
 * @param {'letters'|'digits'|'any'} type  what is expected (decides how sounds like "to" and "oh" are read)
 * @param {string} [lang]  BCP-47 code of the language that was spoken: its number words and letter names
 *   are understood as well as the English ones
 * @returns {string}  capital letters and digits (may be longer or shorter than the group)
 */
export function spokenToChars(text, type = 'any', lang = '') {
  // Number words (of the language and English) become digits first. Not in a letters group.
  const source = type === 'letters' ? text : numbersToDigits(text, lang);
  const tokens = tokenize(source);
  const nativeLetters = letterNameMap(lang);
  const links = exampleLinks(lang);

  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];

    // "double u" is the letter W; "double 5" repeats the next character.
    if (REPEATS[token] !== undefined) {
      if (next === 'u' || next === 'you') {
        out += 'W';
        i += 1;
        continue;
      }
      const repeated = spokenToChars(next ?? '', type, lang);
      if (repeated !== '') {
        out += repeated[0].repeat(REPEATS[token]) + repeated.slice(1);
        i += 1;
      }
      continue;
    }

    // "B for Bombay": not in a digits group ("for" may be the digit 4 there)
    if (type !== 'digits') {
      const example = exampleAt(tokens, i, links, nativeLetters);
      if (example) {
        out += example.letter;
        i += example.skip - 1;
        continue;
      }
    }

    if (NUMBER_WORDS[token] !== undefined && !(token === 'oh' && type === 'letters')) {
      out += NUMBER_WORDS[token];
    } else if (type === 'digits' && DIGIT_SOUNDS[token] !== undefined) {
      out += DIGIT_SOUNDS[token];
    } else if (type === 'digits' && (token === 'o' || token === 'oh')) {
      out += '0';
    } else if (/^\d+$/.test(token)) {
      out += token;
    } else if (type !== 'digits' && nativeLetters.has(token)) {
      out += nativeLetters.get(token); // a letter name in the chosen language: "பி" = B
    } else if (type !== 'digits' && NATO[token] !== undefined) {
      out += NATO[token];
    } else if (type !== 'digits' && LETTER_NAMES[token] !== undefined) {
      out += LETTER_NAMES[token];
    } else if (type !== 'digits' && !FILLERS.has(token) && /^[a-z0-9]+$/.test(token)) {
      out += token.toUpperCase(); // spelled in one piece: "abcde", "a1b2"
    }
    // anything else (filler words, letters in a digits group) is ignored
  }
  return out;
}

// Spoken symbols inside an e-mail name.
const EMAIL_SYMBOLS = { underscore: '_', dash: '-', hyphen: '-', minus: '-', plus: '+' };

/**
 * The part of an e-mail address that was said or spelled: "j o h n dot d o e one two three" ->
 * "john.doe123"; "john at gmail dot com" -> "john@gmail.com" (a full address is kept).
 * "B for Bombay" gives the letter b, number words (also those of the chosen language) become
 * digits, "double 5" gives 55, letter names of the chosen language ("ஜே" = j) give letters.
 * @param {string} text
 * @param {{atWords?:string[], dotWords?:string[]}} [words]  the words of the language for "at" and "dot"
 * @param {string} [lang]  BCP-47 code of the language that was spoken
 * @returns {string}  lower case, no spaces
 */
export function parseEmailSpeech(text, words = {}, lang = '') {
  // An address that is already written (typed) is only cleaned. (Recognition results have no
  // "@" or "." of their own: those come from the words "at" and "dot".)
  if (String(text ?? '').includes('@')) return cleanEmail(text, words).replace(/[^a-z0-9._%+@-]/g, '');

  const tokens = tokenize(numbersToDigits(text, lang));
  const nativeLetters = letterNameMap(lang);
  const links = exampleLinks(lang);
  const pieces = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const next = tokens[i + 1];

    if (REPEATS[token] !== undefined && next !== undefined) {
      const repeated = spokenToChars(next, 'any', lang);
      if (repeated !== '') {
        pieces.push(repeated[0].repeat(REPEATS[token]) + repeated.slice(1));
        i += 1;
        continue;
      }
    }
    const example = exampleAt(tokens, i, links, nativeLetters);
    if (example) {
      pieces.push(example.letter.toLowerCase());
      i += example.skip - 1;
      continue;
    }
    if (NUMBER_WORDS[token] !== undefined && token !== 'oh') pieces.push(NUMBER_WORDS[token]);
    else if (EMAIL_SYMBOLS[token] !== undefined) pieces.push(EMAIL_SYMBOLS[token]);
    else if (nativeLetters.has(token)) pieces.push(nativeLetters.get(token).toLowerCase());
    else pieces.push(token);
  }
  return cleanEmail(pieces.join(' '), words).replace(/[^a-z0-9._%+@-]/g, '');
}
