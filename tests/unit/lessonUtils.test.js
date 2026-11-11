// Unit tests for computeHasMore (Ghost Tutor lesson flow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHasMore } from '../../apps/ghost-tutor/lesson-utils.js';

test('computeHasMore returns true for segment indexes 0, 1 and 2', () => {
  for (const index of [0, 1, 2]) {
    assert.equal(computeHasMore(index), true);
  }
});

test('computeHasMore returns false for the last segment (index 3)', () => {
  assert.equal(computeHasMore(3), false);
});
