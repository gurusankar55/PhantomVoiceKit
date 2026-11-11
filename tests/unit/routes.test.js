// tests/unit/routes.test.js
// Unit tests for the four API routers. A fake callGemini is passed in,
// so the real Gemini API is never called.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

import { createTranslateRouter } from '../../server/routes/translate.js';
import { createExtractFieldsRouter } from '../../server/routes/extract-fields.js';
import { createLessonRouter } from '../../server/routes/lesson.js';
import { createEvaluateRouter } from '../../server/routes/evaluate.js';

// A fake secret. No response body may ever contain it.
const FAKE_KEY = 'FAKE-SECRET-KEY-12345';
process.env.GEMINI_API_KEY = FAKE_KEY;

// Build a minimal Express app with one router mounted.
function makeApp(path, router) {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  return app;
}

// Fake callGemini that always throws the given error.
const throwing = (err) => async () => {
  throw err;
};

// Valid segments for the lesson happy path.
const goodSegments = [1, 2, 3, 4].map((n) => ({
  segment: `Segment ${n}`,
  quizQuestion: `Question ${n}?`,
}));

// Each route: path, factory, valid body, bad bodies, and a fake success result + check.
const routes = [
  {
    name: 'translate',
    path: '/api/translate',
    factory: createTranslateRouter,
    validBody: { text: 'Hello', targetLang: 'ta-IN' },
    badBodies: [{}, { text: '', targetLang: 'ta-IN' }, { text: '   ', targetLang: 'ta-IN' }, { text: 'Hello' }],
    fakeResult: { translation: 'Vanakkam' },
    expected: { translation: 'Vanakkam' },
  },
  {
    name: 'extract-fields',
    path: '/api/extract-fields',
    factory: createExtractFieldsRouter,
    validBody: { fileBase64: 'QUJD', mimeType: 'application/pdf', lang: 'en-US' },
    badBodies: [
      {},
      { fileBase64: '', mimeType: 'application/pdf', lang: 'en-US' },
      { fileBase64: 'QUJD', mimeType: 'text/plain', lang: 'en-US' },
    ],
    fakeResult: { fields: [{ label: 'Name', inputType: 'text', question: 'Your name?', help: ' Full name ' }] },
    expected: { fields: [{ label: 'Name', inputType: 'text', question: 'Your name?', help: 'Full name', kind: 'text' }] },
  },
  {
    name: 'lesson',
    path: '/api/lesson',
    factory: createLessonRouter,
    validBody: { topic: 'Photosynthesis', lang: 'en-US' },
    badBodies: [{}, { topic: '' }, { topic: '   ' }],
    fakeResult: { segments: goodSegments },
    expected: { segments: goodSegments },
  },
  {
    name: 'evaluate',
    path: '/api/evaluate',
    factory: createEvaluateRouter,
    validBody: { topic: 'Math', question: '2+2?', answer: '4', lang: 'en-US' },
    badBodies: [{}, { answer: '' }, { answer: '   ' }],
    fakeResult: { correct: true, feedback: 'Correct!' },
    expected: { correct: true, feedback: 'Correct!' },
  },
];

for (const r of routes) {
  describe(`POST ${r.path}`, () => {
    test('happy path returns 200 with expected body', async () => {
      const app = makeApp(r.path, r.factory(async () => r.fakeResult));
      const res = await request(app).post(r.path).send(r.validBody);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, r.expected);
    });

    test('returns 400 on empty or missing input and does not call Gemini', async () => {
      let called = false;
      const app = makeApp(r.path, r.factory(async () => { called = true; return r.fakeResult; }));
      for (const body of r.badBodies) {
        const res = await request(app).post(r.path).send(body);
        assert.equal(res.status, 400, `body ${JSON.stringify(body)}`);
      }
      assert.equal(called, false);
    });

    test('returns 504 on timeout', async () => {
      const app = makeApp(r.path, r.factory(throwing({ code: 'timeout' })));
      const res = await request(app).post(r.path).send(r.validBody);
      assert.equal(res.status, 504);
    });

    test('returns 502 on gemini_error', async () => {
      const app = makeApp(r.path, r.factory(throwing({ code: 'gemini_error', message: `boom ${'x'}` })));
      const res = await request(app).post(r.path).send(r.validBody);
      assert.equal(res.status, 502);
    });

    test('returns 429 on rate_limit', async () => {
      const app = makeApp(r.path, r.factory(throwing({ code: 'rate_limit' })));
      const res = await request(app).post(r.path).send(r.validBody);
      assert.equal(res.status, 429);
    });

    test('response bodies never contain the GEMINI_API_KEY value', async () => {
      const errors = [
        { code: 'timeout' },
        { code: 'rate_limit' },
        // Even if an error message contains the key, it must not be echoed.
        { code: 'gemini_error', message: `failed with key ${FAKE_KEY}` },
      ];
      for (const err of errors) {
        const app = makeApp(r.path, r.factory(throwing(err)));
        const res = await request(app).post(r.path).send(r.validBody);
        assert.ok(!res.text.includes(FAKE_KEY), `leak for ${err.code}`);
      }
      // Bad input and success responses too.
      const okApp = makeApp(r.path, r.factory(async () => r.fakeResult));
      const ok = await request(okApp).post(r.path).send(r.validBody);
      assert.ok(!ok.text.includes(FAKE_KEY));
      const bad = await request(okApp).post(r.path).send({});
      assert.ok(!bad.text.includes(FAKE_KEY));
    });
  });
}

// ---- Field help for /api/extract-fields (R20) ----
describe('POST /api/extract-fields help text', () => {
  const path = '/api/extract-fields';
  const body = { fileBase64: 'QUJD', mimeType: 'application/pdf', lang: 'ta-IN' };

  // Fields with good, missing, blank and non-string help values.
  const fakeFields = [
    { label: 'IFSC', inputType: 'text', question: 'Q1', help: 'Bank branch code' },
    { label: 'Name', inputType: 'text', question: 'Q2' },
    { label: 'DOB', inputType: 'date', question: 'Q3', help: '   ' },
    { label: 'Age', inputType: 'text', question: 'Q4', help: 42 },
    { label: 'Sex', inputType: 'text', question: 'Q5', help: null },
    { label: 'City', inputType: 'text', question: 'Q6', help: { a: 1 } },
  ];

  test('every field has a string help; "" when omitted, blank or non-string; status 200', async () => {
    const app = makeApp(path, createExtractFieldsRouter(async () => ({ fields: fakeFields })));
    const res = await request(app).post(path).send(body);
    assert.equal(res.status, 200);
    assert.equal(res.body.fields.length, fakeFields.length);
    for (const f of res.body.fields) assert.equal(typeof f.help, 'string');
    assert.equal(res.body.fields[0].help, 'Bank branch code');
    for (const i of [1, 2, 3, 4, 5]) assert.equal(res.body.fields[i].help, '');
  });

  test('prompt asks for a help sentence and mentions the requested lang', async () => {
    let seen;
    const app = makeApp(
      path,
      createExtractFieldsRouter(async (args) => {
        seen = args;
        return { fields: [] };
      })
    );
    const res = await request(app).post(path).send(body);
    assert.equal(res.status, 200);
    assert.match(seen.prompt, /"help"/);
    assert.match(seen.prompt, /sentence/);
    assert.ok(seen.prompt.includes('ta-IN'));
  });
});

// ---- Field kind for /api/extract-fields ----
describe('POST /api/extract-fields kind', () => {
  const path = '/api/extract-fields';
  const body = { fileBase64: 'QUJD', mimeType: 'application/pdf', lang: 'en-US' };

  test('keeps the five known kinds and turns missing or unknown kinds into "text"', async () => {
    const fakeFields = [
      { label: 'Last name', kind: 'name' },
      { label: 'Email', kind: 'email' },
      { label: 'Phone', kind: 'number' },
      { label: 'DOB', kind: 'date' },
      { label: 'Address', kind: 'text' },
      { label: 'Missing' },
      { label: 'Unknown', kind: 'banana' },
      { label: 'Not a string', kind: 7 },
    ];
    const app = makeApp(path, createExtractFieldsRouter(async () => ({ fields: fakeFields })));
    const res = await request(app).post(path).send(body);
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.fields.map((f) => f.kind),
      ['name', 'email', 'number', 'date', 'text', 'text', 'text', 'text']
    );
  });

  test('prompt asks for a kind', async () => {
    let seen;
    const app = makeApp(path, createExtractFieldsRouter(async (args) => { seen = args; return { fields: [] }; }));
    await request(app).post(path).send(body);
    assert.match(seen.prompt, /"kind"/);
    assert.match(seen.prompt, /"name"/);
  });
});

// ---- Name transliteration for /api/translate ----
describe('POST /api/translate transliterate', () => {
  const path = '/api/translate';

  test('transliterate:true asks Gemini to write the name in letters, not translate it', async () => {
    let seen;
    const app = makeApp(path, createTranslateRouter(async (args) => { seen = args; return { translation: 'Shankar' }; }));
    const res = await request(app).post(path).send({ text: 'ஷங்கர்', targetLang: 'en', transliterate: true });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { translation: 'Shankar' });
    assert.match(seen.prompt, /Transliterate/);
    assert.match(seen.prompt, /Do NOT translate/);
  });

  test('without transliterate the normal translate prompt is used', async () => {
    let seen;
    const app = makeApp(path, createTranslateRouter(async (args) => { seen = args; return { translation: 'x' }; }));
    await request(app).post(path).send({ text: 'Hello', targetLang: 'ta' });
    assert.match(seen.prompt, /^Translate the following text/);
  });
});

// ---- Quiz result for /api/evaluate ----
describe('POST /api/evaluate correct flag', () => {
  const path = '/api/evaluate';
  const body = { topic: 'Math', question: '2+2?', answer: '5', lang: 'en-US' };

  test('correct is true only when Gemini says true', async () => {
    for (const [fake, expected] of [[true, true], [false, false], ['true', false], [undefined, false], [1, false]]) {
      const app = makeApp(path, createEvaluateRouter(async () => ({ correct: fake, feedback: 'ok' })));
      const res = await request(app).post(path).send(body);
      assert.equal(res.status, 200);
      assert.equal(res.body.correct, expected, 'for ' + String(fake));
    }
  });

  test('prompt asks for the correct answer and a short explanation when wrong', async () => {
    let seen;
    const app = makeApp(path, createEvaluateRouter(async (args) => { seen = args; return { correct: false, feedback: 'x' }; }));
    await request(app).post(path).send(body);
    assert.match(seen.prompt, /correct answer/);
    assert.match(seen.prompt, /"correct": boolean/);
  });
});
