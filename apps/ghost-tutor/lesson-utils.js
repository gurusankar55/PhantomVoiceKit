// lesson-utils.js
// Pure helper functions for the Ghost Tutor lesson flow.
// No DOM, no network: easy to test.

// A lesson has exactly 4 segments, numbered 0, 1, 2, 3.
const LAST_SEGMENT_INDEX = 3;

/**
 * Tells the app whether another segment follows the current one.
 * @param {number} segmentIndex - index of the segment just finished (0-3)
 * @returns {boolean} true if segmentIndex < 3, false if it is the last (3)
 */
export function computeHasMore(segmentIndex) {
  return segmentIndex < LAST_SEGMENT_INDEX;
}
