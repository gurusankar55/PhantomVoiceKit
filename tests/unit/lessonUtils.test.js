// Unit tests for computeHasMore (Ghost Tutor lesson flow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHasMore, canLearnMore, coveredTitles, MAX_ROUNDS } from '../../apps/ghost-tutor/lesson-utils.js';

test('computeHasMore returns true for segment indexes 0, 1 and 2', () => {
  for (const index of [0, 1, 2]) {
    assert.equal(computeHasMore(index), true);
  }
});

test('computeHasMore returns false for the last segment (index 3)', () => {
  assert.equal(computeHasMore(3), false);
});

test('computeHasMore works for later rounds (8 and 20 parts loaded)', () => {
  assert.equal(computeHasMore(3, 8), true);
  assert.equal(computeHasMore(6, 8), true);
  assert.equal(computeHasMore(7, 8), false);
  assert.equal(computeHasMore(18, 20), true);
  assert.equal(computeHasMore(19, 20), false);
});

test('canLearnMore allows at most 5 rounds', () => {
  assert.equal(MAX_ROUNDS, 5);
  for (const round of [1, 2, 3, 4]) assert.equal(canLearnMore(round), true);
  assert.equal(canLearnMore(5), false);
  assert.equal(canLearnMore(6), false);
});

test('coveredTitles uses titles and falls back to the start of the text', () => {
  const longText = 'x'.repeat(200);
  const result = coveredTitles([
    { title: '  The moon  ', segment: 'The moon is far away.' },
    { title: '', segment: 'Plants need light.' },
    { segment: longText },
    { title: '   ', segment: '   ' },
    null,
  ]);
  assert.deepEqual(result, ['The moon', 'Plants need light.', 'x'.repeat(80)]);
  assert.deepEqual(coveredTitles(undefined), []);
});