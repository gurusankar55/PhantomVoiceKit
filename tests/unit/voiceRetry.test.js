// tests/unit/voiceRetry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createRetryCounter, MAX_NOT_UNDERSTOOD, LISTEN_DELAY_MS } from '../../skeleton/voice-retry.js';

test('allows exactly 2 retries by default, then says stop', () => {
  assert.equal(MAX_NOT_UNDERSTOOD, 2);
  const counter = createRetryCounter();
  assert.equal(counter.next(), true);
  assert.equal(counter.next(), true);
  assert.equal(counter.next(), false);
  assert.equal(counter.next(), false);
  assert.equal(counter.count(), 2);
});

test('reset gives two fresh retries', () => {
  const counter = createRetryCounter();
  counter.next();
  counter.next();
  counter.reset();
  assert.equal(counter.count(), 0);
  assert.equal(counter.next(), true);
});

test('a custom limit works, and counters do not share state', () => {
  const a = createRetryCounter(1);
  const b = createRetryCounter(1);
  assert.equal(a.next(), true);
  assert.equal(a.next(), false);
  assert.equal(b.next(), true);
});

test('the pause before listening is positive', () => {
  assert.ok(LISTEN_DELAY_MS > 0);
});