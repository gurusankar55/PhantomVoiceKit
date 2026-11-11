// voice-retry.js
// Small helpers for "I did not understand" retries. No DOM, so it is easy to test.

// How many times we ask the user to say it once more, then stop listening.
export const MAX_NOT_UNDERSTOOD = 2;

// Wait this long after our own spoken prompt ends before opening the microphone,
// so the microphone does not hear the end of our own voice.
export const LISTEN_DELAY_MS = 500;

/**
 * Counts "not understood" retries.
 * next() returns true while a retry is still allowed (and uses one up),
 * and false once the limit is reached.
 * @param {number} [max]
 */
export function createRetryCounter(max = MAX_NOT_UNDERSTOOD) {
  let used = 0;
  return {
    next() {
      if (used >= max) return false;
      used += 1;
      return true;
    },
    reset() {
      used = 0;
    },
    count() {
      return used;
    },
  };
}
