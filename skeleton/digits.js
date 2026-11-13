// digits.js
// Digits of every script made into 0-9, shared by Spirit Clerk and the games.
// Pure function: no DOM, easy to test.

// The digit 0 of each script that has its own digits: a digit in that script is its offset + 0..9.
const DIGIT_ZEROS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0xff10];

// English digit words, for when the recognizer writes "one two three" instead of "1 2 3".
const DIGIT_WORDS = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };

/**
 * Turn digits of other scripts (Tamil ௯, Arabic ٩, Devanagari ९, full-width ９ ...) into 0-9 and
 * English digit words ("nine") into digits.
 * @param {string} text
 * @returns {string}
 */
export function normalizeDigits(text) {
  let result = '';
  for (const character of String(text ?? '')) {
    const code = character.codePointAt(0);
    const zero = DIGIT_ZEROS.find((start) => code >= start && code <= start + 9);
    result += zero === undefined ? character : String(code - zero);
  }
  return result.replace(/(?<![\p{L}\p{N}])(zero|one|two|three|four|five|six|seven|eight|nine)(?![\p{L}\p{N}])/giu, (word) => DIGIT_WORDS[word.toLowerCase()]);
}
