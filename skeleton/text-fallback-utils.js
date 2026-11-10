// text-fallback-utils.js
// Pure helper for the text fallback input (no DOM, easy to test).

/**
 * Check whether the text a user typed is usable.
 * @param {string} value - the raw text from the textarea
 * @returns {'empty' | 'ok'} 'empty' if nothing is left after trimming, else 'ok'
 */
export function validateText(value) {
  // trim() removes spaces, tabs and newlines from both ends
  if (value.trim().length === 0) {
    return 'empty';
  }
  return 'ok';
}

/**
 * Tidy an answer before the app uses it.
 * Trims the text, then repeatedly removes trailing punctuation and spaces
 * (. । 。 ! ? , ; :). Edge speech recognition often adds a full stop,
 * e.g. "Shankar." becomes "Shankar".
 * @param {string} text - raw heard or typed text
 * @returns {string} the cleaned text (may be empty)
 */
export function cleanAnswer(text) {
  let result = String(text ?? '').trim();
  // Keep removing one trailing mark (or whitespace) until none is left.
  while (result.length > 0 && /[.\u0964\u3002!?,;:\s]$/.test(result)) {
    result = result.slice(0, -1);
  }
  return result;
}
