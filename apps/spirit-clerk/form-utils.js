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

/**
 * Title Case for a person's name: the first letter of each word is a capital
 * and the rest are small, e.g. "RENUKA DEVI" -> "Renuka Devi".
 * A letter also counts as the start of a word after a space, hyphen, period
 * or apostrophe, so "mary-ann" -> "Mary-Ann" and "o'neil" -> "O'Neil".
 * @param {string} text
 * @returns {string}
 */
export function toTitleCase(text) {
  return String(text ?? '')
    .toLocaleLowerCase()
    .replace(/(^|[\s\-.'\u2019])(\p{L})/gu, (match, before, letter) => before + letter.toLocaleUpperCase());
}

/**
 * Tidy an English answer according to the kind of field it belongs to.
 * Only "name" fields change (Title Case). Emails, numbers, dates, codes
 * (PAN, IFSC) and all other text are returned exactly as they are.
 * @param {string} text
 * @param {string} kind - "name" | "email" | "number" | "date" | "text"
 * @returns {string}
 */
export function formatAnswerByKind(text, kind) {
  const value = String(text ?? '');
  return kind === 'name' ? toTitleCase(value) : value;
}

/**
 * The answer that is kept when the user presses Correct (typed or spoken alike): trimmed, a name
 * in Title Case ("ravi kumar" -> "Ravi Kumar"), an e-mail address in lower case. This is the text
 * shown in the review, the summary and both PDFs.
 * @param {string} text
 * @param {string} kind  the kind of the field
 * @returns {string}
 */
export function finalAnswer(text, kind) {
  const value = String(text ?? '').trim();
  if (kind === 'email') return value.toLowerCase();
  return formatAnswerByKind(value, kind);
}

/**
 * What to put back in the answer box when an answer is edited from the review: the drawn
 * signature (a picture), or the kept English answer. null when there is nothing to show (no
 * answer yet, or the question was skipped).
 * @param {{skipped?:boolean, englishMeaning?:string, signatureImage?:string}|undefined} answer
 * @returns {string|null}
 */
export function previousAnswerValue(answer) {
  if (!answer || answer.skipped) return null;
  if (typeof answer.signatureImage === 'string' && answer.signatureImage !== '') return answer.signatureImage;
  const text = String(answer.englishMeaning ?? '').trim();
  return text === '' ? null : text;
}
