// tests/unit/callGemini.test.js
// Tests for the model fallback and retry rules in server/gemini.js.
// A fake "attempt" function is used, so the real Gemini API is never called.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createCallGemini } from '../../server/gemini.js';

const SAVED = { ...process.env };
const SECRET = 'SECRET-KEY-FOR-TEST-123';
let logged;
let realLog;
let realError;

beforeEach(() => {
  process.env.GEMINI_API_KEY = SECRET;
  process.env.GEMINI_MODEL = 'main-model';
  process.env.GEMINI_FALLBACK_MODEL = 'lite-model';
  // Capture console output so we can check it (and keep the test output clean).
  logged = [];
  realLog = console.log;
  realError = console.error;
  console.log = (...args) => logged.push(args.join(' '));
  console.error = (...args) => logged.push(args.join(' '));
});

afterEach(() => {
  console.log = realLog;
  console.error = realError;
  for (const key of ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_FALLBACK_MODEL']) {
    if (SAVED[key] === undefined) delete process.env[key];
    else process.env[key] = SAVED[key];
  }
});

// Fake attempt: takes one outcome per call ({ ok } or { fail }) and records the models used.
function fakeAttempt(outcomes) {
  const models = [];
  const attempt = async (model) => {
    models.push(model);
    const next = outcomes[models.length - 1];
    if (next.fail) throw next.fail;
    return next.ok;
  };
  return { attempt, models };
}

describe('callGemini model fallback and retry', () => {
  test('success on the main model: one call, and the model is logged', async () => {
    const { attempt, models } = fakeAttempt([{ ok: { a: 1 } }]);
    const result = await createCallGemini(attempt)({ prompt: 'x' });
    assert.deepEqual(result, { a: 1 });
    assert.deepEqual(models, ['main-model']);
    assert.ok(logged.some((line) => line.includes('answered by main-model')));
  });

  test('rate_limit: the main model is NOT retried, the fallback answers', async () => {
    const { attempt, models } = fakeAttempt([{ fail: { code: 'rate_limit' } }, { ok: { b: 2 } }]);
    const result = await createCallGemini(attempt)({ prompt: 'x' });
    assert.deepEqual(result, { b: 2 });
    assert.deepEqual(models, ['main-model', 'lite-model']);
    assert.ok(logged.some((line) => line.includes('answered by lite-model')));
  });

  test('rate_limit on both models: throws rate_limit after exactly two calls', async () => {
    const { attempt, models } = fakeAttempt([{ fail: { code: 'rate_limit' } }, { fail: { code: 'rate_limit' } }]);
    await assert.rejects(createCallGemini(attempt)({ prompt: 'x' }), { code: 'rate_limit' });
    assert.deepEqual(models, ['main-model', 'lite-model']);
  });

  test('rate_limit with an empty fallback: no second call', async () => {
    process.env.GEMINI_FALLBACK_MODEL = '';
    const { attempt, models } = fakeAttempt([{ fail: { code: 'rate_limit' } }, { ok: {} }]);
    await assert.rejects(createCallGemini(attempt)({ prompt: 'x' }), { code: 'rate_limit' });
    assert.deepEqual(models, ['main-model']);
  });

  test('rate_limit with the fallback unset or equal to the main model: no second call', async () => {
    delete process.env.GEMINI_FALLBACK_MODEL;
    let run = fakeAttempt([{ fail: { code: 'rate_limit' } }, { ok: {} }]);
    await assert.rejects(createCallGemini(run.attempt)({ prompt: 'x' }), { code: 'rate_limit' });
    assert.deepEqual(run.models, ['main-model']);

    process.env.GEMINI_FALLBACK_MODEL = 'main-model';
    run = fakeAttempt([{ fail: { code: 'rate_limit' } }, { ok: {} }]);
    await assert.rejects(createCallGemini(run.attempt)({ prompt: 'x' }), { code: 'rate_limit' });
    assert.deepEqual(run.models, ['main-model']);
  });

  test('timeout: one retry on the same model', async () => {
    const { attempt, models } = fakeAttempt([{ fail: { code: 'timeout' } }, { ok: { c: 3 } }]);
    const result = await createCallGemini(attempt)({ prompt: 'x' });
    assert.deepEqual(result, { c: 3 });
    assert.deepEqual(models, ['main-model', 'main-model']);
  });

  test('other error: one retry on the same model, then the error is thrown', async () => {
    const error = { code: 'gemini_error', message: 'boom' };
    const { attempt, models } = fakeAttempt([{ fail: error }, { fail: error }, { ok: {} }]);
    await assert.rejects(createCallGemini(attempt)({ prompt: 'x' }), { code: 'gemini_error' });
    assert.deepEqual(models, ['main-model', 'main-model']);
  });

  test('timeout then rate_limit: the fallback is still tried once', async () => {
    const { attempt, models } = fakeAttempt([
      { fail: { code: 'timeout' } },
      { fail: { code: 'rate_limit' } },
      { ok: { d: 4 } },
    ]);
    const result = await createCallGemini(attempt)({ prompt: 'x' });
    assert.deepEqual(result, { d: 4 });
    assert.deepEqual(models, ['main-model', 'main-model', 'lite-model']);
  });

  test('the prompt and image parts reach the attempt, and the API key is never logged', async () => {
    let seen;
    const attempt = async (model, contents) => {
      seen = contents;
      throw { code: 'gemini_error', message: `bad key ${SECRET}` };
    };
    const part = { inlineData: { mimeType: 'image/png', data: 'QUJD' } };
    await assert.rejects(createCallGemini(attempt)({ prompt: 'hello', inlineParts: [part] }));
    assert.deepEqual(seen, [{ role: 'user', parts: [{ text: 'hello' }, part] }]);
    assert.ok(logged.length > 0);
    assert.ok(logged.every((line) => !line.includes(SECRET)));
  });
});