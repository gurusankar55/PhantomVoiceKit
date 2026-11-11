// lesson-utils.js
// Pure helper functions for the Ghost Tutor lesson flow.
// No DOM, no network: easy to test.

// Each round teaches 4 parts. A topic can have at most 5 rounds (20 parts).
export const PARTS_PER_ROUND = 4;
export const MAX_ROUNDS = 5;

/**
 * Tells the app whether another part follows the current one.
 * @param {number} segmentIndex - index of the part just finished (0-based)
 * @param {number} [total] - how many parts are loaded so far (4 in the first round, 8 after the second...)
 * @returns {boolean} true if there is a next part
 */
export function computeHasMore(segmentIndex, total = PARTS_PER_ROUND) {
  return segmentIndex < total - 1;
}

/**
 * True while the learner may start another round on the same topic.
 * @param {number} round - the round that was just finished (1-based)
 */
export function canLearnMore(round) {
  return round < MAX_ROUNDS;
}

/**
 * Titles of the parts already taught, sent to the server so nothing is repeated.
 * A part without a title uses the start of its text instead.
 * @param {{ title?: string, segment?: string }[]} segments
 * @returns {string[]}
 */
export function coveredTitles(segments) {
  const titles = [];
  for (const s of Array.isArray(segments) ? segments : []) {
    const title = typeof s?.title === 'string' ? s.title.trim() : '';
    const text = typeof s?.segment === 'string' ? s.segment.trim().slice(0, 80) : '';
    const chosen = title || text;
    if (chosen) titles.push(chosen);
  }
  return titles;
}
