// speech-utils.js
// Pure helpers for listening to long answers (a PAN code, an address, an e-mail address).
// No DOM and no browser API here, so they are easy to test.
//
// Listening works like a voice message: it does NOT stop when the user pauses. It ends when the
// user presses "Done", says a done word (voice.doneWords), or after a long total silence.

import { normalize } from './voice-commands.js';

// Safety stop: if nothing at all is heard for this long, listening ends by itself.
export const SAFETY_SILENCE_MS = 15000;

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
 * Has the user been silent long enough for the safety stop?
 * @param {number} lastActivityAt  time (ms) of the last thing heard (or of the start)
 * @param {number} now             time (ms) now
 * @param {number} [silenceMs]     default SAFETY_SILENCE_MS
 */
export function silenceElapsed(lastActivityAt, now, silenceMs = SAFETY_SILENCE_MS) {
  return now - lastActivityAt >= silenceMs;
}

// A language with no spaces between words (Chinese, Japanese): a done word may end the text directly.
const NO_SPACE_SCRIPT = /[\u3040-\u30ff\u3400-\u9fff]/u;

/**
 * Look for a done word at the END of what was heard ("... ABCDE done") and take it off.
 * Only the end counts, so a word like "done" in the middle of an answer is left alone.
 * Case, punctuation and extra spaces are ignored.
 * @param {string} text        what was heard so far
 * @param {string[]} doneWords the done words (parsed list, e.g. from parseWords(t('voice.doneWords')))
 * @returns {{text:string, done:boolean}}  text without the done word
 */
export function splitDoneWord(text, doneWords) {
  const original = String(text ?? '').trim();
  const words = (doneWords ?? [])
    .map((word) => normalize(word))
    .filter((word) => word !== '')
    .sort((a, b) => b.length - a.length); // the longest first: "that is all" before "all"
  if (original === '' || words.length === 0) return { text: original, done: false };

  // 1. Words separated by spaces: compare the last words.
  // Each token is cut into the pieces normalize() makes of it ("c'est" -> "c", "est"), and every
  // piece remembers which token it came from.
  const tokens = original.split(/\s+/u);
  const pieces = [];
  tokens.forEach((token, tokenIndex) => {
    normalize(token)
      .split(' ')
      .filter(Boolean)
      .forEach((piece, pieceIndex) => pieces.push({ piece, tokenIndex, first: pieceIndex === 0 }));
  });
  for (const word of words) {
    const wordPieces = word.split(' ');
    if (wordPieces.length > pieces.length) continue;
    const tail = pieces.slice(pieces.length - wordPieces.length);
    // The done word must start at the beginning of a token (not in the middle of "c'est").
    if (tail[0].first && tail.every((entry, i) => entry.piece === wordPieces[i])) {
      return { text: tokens.slice(0, tail[0].tokenIndex).join(' ').trim(), done: true };
    }
  }

  // 2. Chinese and Japanese: the done word may follow the last character directly.
  const withoutEndMarks = original.replace(/[\s\p{P}\p{S}]+$/u, '');
  for (const word of words) {
    if (!NO_SPACE_SCRIPT.test(word)) continue;
    if (normalize(withoutEndMarks).endsWith(word)) {
      return { text: withoutEndMarks.slice(0, Math.max(0, withoutEndMarks.length - word.length)).trim(), done: true };
    }
  }
  return { text: original, done: false };
}
