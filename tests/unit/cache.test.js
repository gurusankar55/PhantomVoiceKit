// tests/unit/cache.test.js
// Tests for the in-memory cache (server/cache.js) and for using it in front of a route.
// A fake callGemini is used, so the real Gemini API is never called.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createCache, hashRequest, withCache, MAX_ENTRIES, TTL_MS } from '../../server/cache.js';
import { createTranslateRouter } from '../../server/routes/translate.js';

let logged;
let realLog;
beforeEach(() => {
  logged = [];
  realLog = console.log;
  console.log = (...args) => logged.push(args.join(' '));
});
afterEach(() => {
  console.log = realLog;
});

describe('createCache', () => {
  test('the defaults are 200 entries and 24 hours', () => {
    assert.equal(MAX_ENTRIES, 200);
    assert.equal(TTL_MS, 24 * 60 * 60 * 1000);
  });

  test('saves and returns a value; an unknown key gives undefined', () => {
    const cache = createCache();
    cache.set('a', { x: 1 });
    assert.deepEqual(cache.get('a'), { x: 1 });
    assert.equal(cache.get('b'), undefined);
  });

  test('never holds more than 200 entries: the oldest is dropped', () => {
    const cache = createCache();
    for (let i = 0; i < 205; i++) cache.set(`k${i}`, i);
    assert.equal(cache.size, 200);
    assert.equal(cache.get('k0'), undefined);
    assert.equal(cache.get('k4'), undefined);
    assert.equal(cache.get('k5'), 5);
    assert.equal(cache.get('k204'), 204);
  });

  test('saving a key again keeps it as the newest', () => {
    const cache = createCache({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 3); // a is now newer than b
    cache.set('c', 4); // drops b
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('a'), 3);
  });

  test('a value is kept for just under 24 hours and gone after it', () => {
    let time = 1_000_000;
    const cache = createCache({ now: () => time });
    cache.set('a', 'value');
    time += TTL_MS - 1;
    assert.equal(cache.get('a'), 'value');
    time += 1;
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.size, 0);
  });
});

describe('hashRequest', () => {
  const image = { inlineData: { mimeType: 'image/png', data: 'AAAA' } };

  test('the same request gives the same hash (64 hex characters)', () => {
    const a = hashRequest('translate-layout', { prompt: 'p', inlineParts: [image] });
    const b = hashRequest('translate-layout', { prompt: 'p', inlineParts: [{ inlineData: { ...image.inlineData } }] });
    assert.equal(a, b);
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  test('another route, text, language (in the prompt) or image gives another hash', () => {
    const base = hashRequest('translate', { prompt: 'Translate "hi" into ta-IN' });
    assert.notEqual(base, hashRequest('extract-fields', { prompt: 'Translate "hi" into ta-IN' }));
    assert.notEqual(base, hashRequest('translate', { prompt: 'Translate "hello" into ta-IN' }));
    assert.notEqual(base, hashRequest('translate', { prompt: 'Translate "hi" into hi-IN' }));

    const withImage = hashRequest('translate-layout', { prompt: 'p', inlineParts: [image] });
    const otherImage = { inlineData: { mimeType: 'image/png', data: 'BBBB' } };
    assert.notEqual(withImage, hashRequest('translate-layout', { prompt: 'p', inlineParts: [otherImage] }));
    assert.notEqual(withImage, hashRequest('translate-layout', { prompt: 'p' }));
  });
});

describe('withCache', () => {
  test('the second identical call is answered from the cache and logged', async () => {
    let calls = 0;
    const gemini = withCache(async () => ({ translation: `answer ${++calls}` }), 'translate');
    const first = await gemini({ prompt: 'same' });
    const second = await gemini({ prompt: 'same' });
    assert.deepEqual(second, first);
    assert.equal(calls, 1);
    assert.ok(logged.some((line) => line.includes('[cache] hit translate')));
  });

  test('a different request is not a hit', async () => {
    let calls = 0;
    const gemini = withCache(async () => ({ n: ++calls }), 'translate');
    await gemini({ prompt: 'one' });
    await gemini({ prompt: 'two' });
    assert.equal(calls, 2);
  });

  test('the same request on another route is not a hit (one shared store)', async () => {
    let calls = 0;
    const cache = createCache();
    const fake = async () => ({ n: ++calls });
    await withCache(fake, 'translate', { cache })({ prompt: 'same' });
    await withCache(fake, 'extract-fields', { cache })({ prompt: 'same' });
    assert.equal(calls, 2);
    assert.equal(cache.size, 2);
  });

  test('an error is not saved: the next call asks Gemini again', async () => {
    let calls = 0;
    const gemini = withCache(async () => {
      calls += 1;
      if (calls === 1) throw { code: 'timeout' };
      return { ok: true };
    }, 'translate');
    await assert.rejects(gemini({ prompt: 'p' }), { code: 'timeout' });
    assert.deepEqual(await gemini({ prompt: 'p' }), { ok: true });
    assert.equal(calls, 2);
  });

  test('an answer that is not usable is not saved', async () => {
    let calls = 0;
    const gemini = withCache(async () => ({ n: ++calls }), 'translate', { isUsable: () => false });
    await gemini({ prompt: 'p' });
    await gemini({ prompt: 'p' });
    assert.equal(calls, 2);
  });

  test('changing an answer in a route does not change the cached copy', async () => {
    const gemini = withCache(async () => ({ blocks: [{ translation: 'a' }] }), 'translate-layout');
    const first = await gemini({ prompt: 'p' });
    first.blocks[0].translation = 'CHANGED';
    const second = await gemini({ prompt: 'p' });
    assert.equal(second.blocks[0].translation, 'a');
    second.blocks[0].translation = 'CHANGED AGAIN';
    assert.equal((await gemini({ prompt: 'p' })).blocks[0].translation, 'a');
  });
});

describe('cache in front of a real route', () => {
  test('POST /api/translate twice with the same body: Gemini is called once', async () => {
    let calls = 0;
    const fake = async () => ({ translation: `hola ${++calls}` });
    const app = express();
    app.use(express.json());
    app.use('/api/translate', createTranslateRouter(withCache(fake, 'translate')));

    const body = { text: 'hello', targetLang: 'es-ES' };
    const first = await request(app).post('/api/translate').send(body);
    const second = await request(app).post('/api/translate').send(body);
    assert.equal(first.status, 200);
    assert.deepEqual(second.body, first.body);
    assert.equal(calls, 1);

    // Another language is a new question.
    await request(app).post('/api/translate').send({ text: 'hello', targetLang: 'fr-FR' });
    assert.equal(calls, 2);
  });
});
