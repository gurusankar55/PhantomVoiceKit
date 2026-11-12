// tests/unit/answerRoutes.test.js
// The server side of the new answer flow: extract-fields returns kind and pattern for every field,
// and translate (with a kind) returns the form-ready "value" in the SAME call.
// A fake callGemini is used: no real Gemini call.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

import { createExtractFieldsRouter } from '../../server/routes/extract-fields.js';
import { createTranslateRouter } from '../../server/routes/translate.js';

function appWith(path, router) {
  const app = express();
  app.use(express.json());
  app.use(path, router);
  return app;
}

describe('extract-fields: kind and pattern', () => {
  const path = '/api/extract-fields';
  const body = { images: [{ mimeType: 'image/jpeg', data: 'QUJD' }], lang: 'ta-IN' };
  const run = async (fields) => {
    const app = appWith(path, createExtractFieldsRouter(async () => ({ fields })));
    const res = await request(app).post(path).send(body);
    assert.equal(res.status, 200);
    return res.body.fields;
  };

  test('built-in patterns come from the label, without Gemini giving them', async () => {
    const fields = await run([
      { label: 'PAN', kind: 'text' },
      { label: 'IFSC code', kind: 'text' },
      { label: 'Aadhaar number', kind: 'number' },
      { label: 'Mobile no.', kind: 'number' },
      { label: 'PIN code', kind: 'number' },
    ]);
    assert.deepEqual(fields.map((f) => [f.kind, f.pattern]), [
      ['code', 'AAAAA9999A'],
      ['code', 'AAAA0XXXXXX'],
      ['number', '999999999999'],
      ['phone', '9999999999'],
      ['number', '999999'],
    ]);
  });

  test('a pattern from Gemini for another code is kept; a broken pattern is dropped', async () => {
    const fields = await run([
      { label: 'GSTIN', kind: 'code', pattern: '99AAAAA9999A9X9' },
      { label: 'Voter ID', kind: 'code', pattern: 'three letters then digits' },
      { label: 'Hobby', kind: 'text', pattern: '9999' },
    ]);
    assert.equal(fields[0].pattern, '99AAAAA9999A9X9');
    assert.equal(fields[1].pattern, '');
    assert.equal(fields[2].pattern, '');
  });

  test('all eleven kinds pass through; unknown kinds become text; signature is found by label', async () => {
    const kinds = ['name', 'text', 'address', 'date', 'number', 'phone', 'email', 'code', 'choice', 'checkbox', 'signature'];
    const fields = await run([
      ...kinds.map((kind) => ({ label: `Field ${kind}`, kind })),
      { label: 'Anything', kind: 'banana' },
      { label: 'Signature of applicant', kind: 'text' },
      { label: 'Gender', kind: 'selection' },
      { label: 'I agree', inputType: 'checkbox' },
    ]);
    assert.deepEqual(fields.slice(0, 11).map((f) => f.kind), kinds);
    assert.equal(fields[11].kind, 'text');
    assert.equal(fields[12].kind, 'signature');
    assert.equal(fields[13].kind, 'choice');
    assert.equal(fields[14].kind, 'checkbox');
  });

  test('the prompt explains every kind and the pattern letters', async () => {
    let seen;
    const app = appWith(path, createExtractFieldsRouter(async (args) => {
      seen = args;
      return { fields: [] };
    }));
    await request(app).post(path).send(body);
    for (const kind of ['name', 'text', 'address', 'date', 'number', 'phone', 'email', 'code', 'choice', 'checkbox', 'signature']) {
      assert.ok(seen.prompt.includes(`"${kind}"`), kind);
    }
    assert.match(seen.prompt, /"pattern"/);
    assert.match(seen.prompt, /AAAAA9999A/);
  });
});

describe('translate with a kind: the form-ready value in the same call', () => {
  const path = '/api/translate';

  test('the reply has the translation and the value; the prompt has kind, label and pattern', async () => {
    let calls = 0;
    let seen;
    const app = appWith(path, createTranslateRouter(async (args) => {
      calls += 1;
      seen = args;
      return { translation: 'third of June nineteen ninety', value: ' 03/06/1990 ' };
    }));
    const res = await request(app).post(path).send({ text: 'மூன்று ஜூன் 1990', targetLang: 'en', kind: 'date', label: 'Date of birth' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { translation: 'third of June nineteen ninety', value: '03/06/1990' });
    assert.equal(calls, 1, 'one Gemini call');
    assert.match(seen.prompt, /Date of birth/);
    assert.match(seen.prompt, /DD\/MM\/YYYY/);
    assert.ok(seen.prompt.includes('மூன்று ஜூன் 1990'));
  });

  test('a pattern is put in the prompt; a broken pattern is not', async () => {
    let prompt = '';
    const app = appWith(path, createTranslateRouter(async (args) => {
      prompt = args.prompt;
      return { translation: 'x', value: 'ABCDE1234F' };
    }));
    await request(app).post(path).send({ text: 'x', targetLang: 'en', kind: 'code', label: 'PAN', pattern: 'AAAAA9999A' });
    assert.ok(prompt.includes('AAAAA9999A'));
    await request(app).post(path).send({ text: 'x', targetLang: 'en', kind: 'code', label: 'PAN', pattern: 'drop table' });
    assert.ok(!prompt.includes('drop table'));
  });

  test('the prompt tells what each kind must look like', async () => {
    const wanted = {
      name: /Title Case/,
      address: /full address/,
      date: /DD\/MM\/YYYY/,
      phone: /digits only/,
      number: /digits only/,
      email: /e-mail/,
      code: /UPPERCASE/,
      checkbox: /"Yes" or "No"/,
    };
    for (const [kind, pattern] of Object.entries(wanted)) {
      let prompt = '';
      const app = appWith(path, createTranslateRouter(async (args) => {
        prompt = args.prompt;
        return { translation: 'x', value: 'x' };
      }));
      await request(app).post(path).send({ text: 'x', targetLang: 'en', kind });
      assert.match(prompt, pattern, kind);
    }
  });

  test('a missing value is an empty string (the browser then cleans the translation itself)', async () => {
    const app = appWith(path, createTranslateRouter(async () => ({ translation: 'Ravi' })));
    const res = await request(app).post(path).send({ text: 'ரவி', targetLang: 'en', kind: 'name' });
    assert.deepEqual(res.body, { translation: 'Ravi', value: '' });
  });

  test('without a kind (or with an unknown kind) the old reply is unchanged', async () => {
    const app = appWith(path, createTranslateRouter(async () => ({ translation: 'Hello', value: 'ignored' })));
    let res = await request(app).post(path).send({ text: 'வணக்கம்', targetLang: 'en' });
    assert.deepEqual(res.body, { translation: 'Hello' });
    res = await request(app).post(path).send({ text: 'வணக்கம்', targetLang: 'en', kind: 'banana' });
    assert.deepEqual(res.body, { translation: 'Hello' });
  });
});
