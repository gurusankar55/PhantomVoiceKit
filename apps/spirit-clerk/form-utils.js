// form-utils.js
// Small pure helper functions for Spirit Clerk.
// No browser or DOM access here, so they are easy to test.

// How many times a user may redo an answer before the field is skipped.
const MAX_REDOS = 3;

// How many times we re-ask after silence before the field is skipped.
const MAX_SILENCE_REASKS = 1;

/**
 * After the user rejects an answer, decide what to do next.
 * @param {number} redoCount - how many redos have already happened
 * @returns {'redo'|'skip'} 'redo' while under 3 redos, otherwise 'skip'
 */
export function nextRedoOrSkip(redoCount) {
  return redoCount < MAX_REDOS ? 'redo' : 'skip';
}

/**
 * After the microphone hears nothing, decide what to do next.
 * @param {number} silenceCount - how many silences have already happened
 * @returns {'reask'|'skip'} 'reask' on the first silence, otherwise 'skip'
 */
export function nextSilenceOrSkip(silenceCount) {
  return silenceCount < MAX_SILENCE_REASKS ? 'reask' : 'skip';
}

/**
 * Build the PDF file name: "{formName}_{YYYY-MM-DD}.pdf".
 * Uses the LOCAL year, month and day of the given date,
 * so the same date always gives the same name.
 * @param {string} formName - name of the form
 * @param {Date} date - date to put in the file name
 * @returns {string}
 */
export function pdfFilename(formName, date) {
  const year = date.getFullYear();
  // getMonth() is 0-based, so add 1. padStart adds a leading zero.
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${formName}_${year}-${month}-${day}.pdf`;
}

/**
 * Tidy a form label so we can safely add our own ": " after it.
 * Trims the label and removes trailing colons (and spaces before/after them),
 * e.g. "First name:" becomes "First name".
 * @param {string} label
 * @returns {string}
 */
export function cleanLabel(label) {
  let result = String(label ?? '').trim();
  while (result.length > 0 && /[:\uFF1A\s]$/.test(result)) {
    result = result.slice(0, -1);
  }
  return result;
}
