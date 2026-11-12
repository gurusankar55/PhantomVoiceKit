// tests/unit/callGemini.test.js
// Tests for the model list, fallback and retry rules in server/gemini.js.
// A fake "attempt" function is used, so the real Gemini API is never called.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCallGemini, getModelList, modelConfig } from '../../server/gemini.js';

const SAVED = { ...process.env };
const SECRET = 'SECRET-KEY-FOR-TEST-123';
const KEYS = ['GEMINI_API_KEY', 'GEMINI_MODELS', 'GEMINI_MODEL', 'GEMINI_FALLBACK_MODEL'];

let logged;
let realLog;
let realError;

beforeEach(() => {
  process.env.GEMINI_API_KEY = SECRET;
  process.env.GEMINI_MODELS = 'main-model,lite-model,third-model';
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_FALLBACK_MODEL;

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
  for (const key of KEYS) {
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

describe('getModelList', () => {
  test('reads GEMINI_MODELS in order, trims it and drops empty entries and repeats', () => {
    process.env.GEMINI_MODELS = ' a , b,, a ,c ';
    assert.deepEqual(getModelList(), ['a', 'b', 'c']);
  });

  test('without GEMINI_MODELS the older two variables are used', () => {
    process.env.GEMINI_MODELS = '';
    process.env.GEMINI_MODEL = 'old-main';
    process.env.GEMINI_FALLBACK_MODEL = 'old-lite';
    assert.deepEqual(getModelList(), ['old-main', 'old-lite']);
    process.env.GEMINI_FALLBACK_MODEL = 'old-main';
    assert.deepEqual(getModelList(), ['old-main']);
  });
});

describe('modelConfig', () => {
  test('flash models get thinkingBudget 0', () => {
    assert.deepEqual(modelConfig('gemini-3.5-flash'), { thinkingConfig: { thinkingBudget: 0 } });
  });

  test('lite and pro models do not (they reject it with HTTP 400)', () => {
    for (const name of ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-pro']) {
      assert.deepEqual(modelConfig(name), {}, name);
    }
  });
});

describe('callGemini model list and retry', () => {
  test('success on the main model: one call, and the model is logged', async () => {
    const { attempt, models } = fakeAttempt([{ ok: { a: 1 } }]);
    const result = await createCallGemini(attempt)({ prompt: 'x' });
    assert.deepEqual(result, { a: 1 });
    assert.deepEqual(models, ['main-model']);
    assert.ok(logged.some((line) => line.includes('answered by main-model')));
  });

  test('rate_limit: the main model is NOT retried, the next model answers', async () => {
    const { attempt, models } = fakeAttempt([{ fail: { code: 'rate_limit' } }, { ok: { b: 2 } }]);
    const result = await createCallGemini(attempt)({ prompt: 'x' });
    assert.deepEqual(result, { b: 2 });
    assert.deepEqual(models, ['main-model', 'lite-model']);
    assert.ok(logged.some((line) => line.includes('answered by lite-model')));
  });

  test('unavailable (503) also moves on to the next model', async () => {
    const { attempt, models } = fakeAttempt([{ fail: { code: 'unavailable' } }, { ok: { b: 2 } }]);
    assert.deepEqual(await createCallGemini(attempt)({ prompt: 'x' }), { b: 2 });
    assert.deepEqual(models, ['main-model', 'lite-model']);
  });

  test('the whole list is walked in order: 429, then 503, then the third model answers', async () => {
    const { attempt, models } = fakeAttempt([
      { fail: { code: 'rate_limit' } },
      { fail: { code: 'unavailable' } },
      { ok: { c: 3 } },
    ]);
    assert.deepEqual(await createCallGemini(attempt)({ prompt: 'x' }), { c: 3 });
    assert.deepEqual(models, ['main-model', 'lite-model', 'third-model']);
  });

  test('every model rate limited: each is tried once, then rate_limit is thrown', async () => {
    const limited = { fail: { code: 'rate_limit' } };
    const { attempt, models } = fakeAttempt([limited, limited, limited, { ok: {} }]);
    await assert.rejects(createCallGemini(attempt)({ prompt: 'x' }), { code: 'rate_limit' });
    assert.deepEqual(models, ['main-model', 'lite-model', 'third-model']);
  });

  test('a list with one model: no second call', async () => {
    process.env.GEMINI_MODELS = 'main-model';
    const { attempt, models } = fakeAttempt([{ fail: { code: 'rate_limit' } }, { ok: {} }]);
    await assert.rejects(createCallGemini(attempt)({ prompt: 'x' }), { code: 'rate_limit' });
    assert.deepEqual(models, ['main-model']);
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

  test('timeout then rate_limit: the next model is still tried once', async () => {
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
