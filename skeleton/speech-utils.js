// speech-utils.js
// Pure helpers for listening to long answers (a PAN code, a phone number, an e-mail address).
// No DOM and no browser API here, so they are easy to test.

// The answer is finished when the user has been silent for this long ...
export const SILENCE_MS = 2500;
// ... or for this long for numbers, codes and e-mail addresses (people pause while reading them out).
export const LONG_SILENCE_MS = 4000;

// Kinds of field whose answers are read out slowly, with pauses.
const LONG_KINDS = ['number', 'code', 'email'];

/**
 * How long the user must be silent before the answer counts as finished.
 * @param {string} [kind]  "name" | "email" | "number" | "code" | "date" | "text"
 * @returns {number} milliseconds
 */
export function silenceMsForKind(kind) {
  return LONG_KINDS.includes(kind) ? LONG_SILENCE_MS : SILENCE_MS;
}

/**
 * Join pieces of heard text into one text: each piece is trimmed, empty pieces are dropped and
 * the rest are joined with one space.
 * @param {unknown[]} parts
 * @returns {string}
 */
export function joinParts(parts) {
  return (parts ?? [])
    .map((part) => String(part ?? '').trim())
    .filter((part) => part !== '')
    .join(' ');
}

/**
 * Split the results of one recognition session into the text that is final and the text that is
 * still changing (interim).
 * @param {ArrayLike<{isFinal:boolean, 0:{transcript:string}}>} results  event.results of SpeechRecognition
 * @returns {{final:string, interim:string}}
 */
export function transcriptFromResults(results) {
  const finals = [];
  const interims = [];
  for (let i = 0; i < (results?.length ?? 0); i++) {
    const result = results[i];
    const text = result && result[0] ? result[0].transcript : '';
    (result && result.isFinal ? finals : interims).push(text);
  }
  return { final: joinParts(finals), interim: joinParts(interims) };
}

/**
 * Has the user been silent long enough?
 * @param {number} lastActivityAt  time (ms) of the last thing heard
 * @param {number} now             time (ms) now
 * @param {number} silenceMs       how long a silence ends the answer
 */
export function silenceElapsed(lastActivityAt, now, silenceMs) {
  return now - lastActivityAt >= silenceMs;
}
