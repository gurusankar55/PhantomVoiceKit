// tests/unit/answerBoxParser.test.js
// The tolerant reading of answerBox and page (server/routes/answer-box-parser.js) and the
// /api/extract-fields route that uses it. A fake callGemini is used: no real Gemini call.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import fc from 'fast-check';

import { parseAnswerBox } from '../../server/routes/answer-box-parser.js';
import { createExtractFieldsRouter, readUpload, MAX_IMAGES } from '../../server/routes/extract-fields.js';

describe('parseAnswerBox', () => {
  test('a good box and page are kept as they are', () => {
    const result = parseAnswerBox({ answerBox: [100, 200, 130, 600], page: 1 }, 2);
    assert.deepEqual(result, { answerBox: [100, 200, 130, 600], page: 1, status: 'ok' });
  });

  test('other key names are accepted', () => {
    for (const key of ['answer_box', 'answerbox', 'answer_box_2d', 'input_box', 'inputBox', 'box_2d', 'bbox']) {
      const result = parseAnswerBox({ [key]: [10, 20, 40, 300], page: 0 }, 1);
      assert.deepEqual(result.answerBox, [10, 20, 40, 300], key);
    }
    for (const key of ['page_index', 'pageIndex', 'page_number']) {
      assert.equal(parseAnswerBox({ answerBox: [10, 20, 40, 300], [key]: 2 }, 3).page, 2, key);
    }
  });

  test('a box nested one level deeper, an object and numbers as text are repaired', () => {
    assert.deepEqual(parseAnswerBox({ answerBox: [[10, 20, 40, 300]] }, 1).answerBox, [10, 20, 40, 300]);
    assert.deepEqual(parseAnswerBox({ answerBox: { ymin: 10, xmin: 20, ymax: 40, xmax: 300 } }, 1).answerBox, [10, 20, 40, 300]);
    assert.deepEqual(parseAnswerBox({ answerBox: { x: 20, y: 10, width: 280, height: 30 } }, 1).answerBox, [10, 20, 40, 300]);
    assert.deepEqual(parseAnswerBox({ answerBox: ['10', '20', ' 40', '300'], page: '0' }, 1), { answerBox: [10, 20, 40, 300], page: 0, status: 'ok' });
  });

  test('a 0 to 1 scale is turned into 0 to 1000 and values outside are clamped', () => {
    assert.deepEqual(parseAnswerBox({ answerBox: [0.1, 0.2, 0.15, 0.7] }, 1).answerBox, [100, 200, 150, 700]);
    assert.deepEqual(parseAnswerBox({ answerBox: [-50, 20, 40, 1300] }, 1).answerBox, [0, 20, 40, 1000]);
  });

  test('no box, null, text or a wrong length gives answerBox null but still a page', () => {
    for (const item of [{}, { answerBox: null }, { answerBox: 'none' }, { answerBox: [1, 2, 3] }, { answerBox: [1, 2, 'x', 4] }, { answerBox: {} }]) {
      const result = parseAnswerBox({ ...item, page: 1 }, 2);
      assert.equal(result.answerBox, null, JSON.stringify(item));
      assert.equal(result.page, 1);
    }
  });

  test('a box with no area or too small to write in gives null', () => {
    assert.equal(parseAnswerBox({ answerBox: [100, 100, 100, 400] }, 1).answerBox, null);
    assert.equal(parseAnswerBox({ answerBox: [100, 100, 102, 400] }, 1).status, 'too_small'); // 2 high
    assert.equal(parseAnswerBox({ answerBox: [100, 100, 140, 105] }, 1).status, 'too_small'); // 5 wide
  });

  test('page: missing is 0 for one image; for several images the box is dropped', () => {
    assert.deepEqual(parseAnswerBox({ answerBox: [10, 20, 40, 300] }, 1), { answerBox: [10, 20, 40, 300], page: 0, status: 'ok' });
    const several = parseAnswerBox({ answerBox: [10, 20, 40, 300] }, 3);
    assert.equal(several.answerBox, null);
    assert.equal(several.status, 'bad_page');
  });

  test('page: negative, too big, fractional or text that is no number drops the box', () => {
    for (const page of [-1, 2, 0.5, 'two', NaN, {}, []]) {
      const result = parseAnswerBox({ answerBox: [10, 20, 40, 300], page }, 2);
      assert.equal(result.answerBox, null, String(page));
      assert.equal(result.page, 0);
    }
  });

  test('something that is not an object never throws', () => {
    for (const item of [null, undefined, 'text', 42, [1, 2, 3, 4]]) {
      assert.deepEqual(parseAnswerBox(item, 1), { answerBox: null, page: 0, status: 'no_box' });
    }
  });

  test('property: the result is always null or a box inside 0..1000 with an area, and a whole page', () => {
    const anything = fc.oneof(fc.double({ noNaN: false }), fc.string(), fc.constant(null), fc.integer());
    fc.assert(
      fc.property(fc.array(anything, { maxLength: 6 }), anything, fc.integer({ min: 1, max: 5 }), (box, page, pageCount) => {
        const { answerBox, page: outPage } = parseAnswerBox({ answerBox: box, page }, pageCount);
        assert.ok(Number.isInteger(outPage) && outPage >= 0 && outPage < pageCount);
        if (answerBox !== null) {
          assert.equal(answerBox.length, 4);
          assert.ok(answerBox.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000));
          assert.ok(answerBox[2] > answerBox[0] && answerBox[3] > answerBox[1]);
        }
      }),
      { numRuns: 200 }
    );
  });
});

describe('readUpload', () => {
  const image = { mimeType: 'image/jpeg', data: 'QUJD' };

  test('1 to 5 images are accepted, in order', () => {
    const result = readUpload({ images: [image, { ...image, data: 'REVG' }], lang: 'ta-IN' });
    assert.equal(result.pageCount, 2);
    assert.deepEqual(result.inlineParts[1], { inlineData: { mimeType: 'image/jpeg', data: 'REVG' } });
    assert.equal(readUpload({ images: Array(MAX_IMAGES).fill(image) }).pageCount, MAX_IMAGES);
  });

  test('empty list, too many images, a PDF, empty data or a non-array are rejected', () => {
    assert.equal(readUpload({ images: [] }), null);
    assert.equal(readUpload({ images: Array(MAX_IMAGES + 1).fill(image) }), null);
    assert.equal(readUpload({ images: [{ mimeType: 'application/pdf', data: 'QUJD' }] }), null);
    assert.equal(readUpload({ images: [{ mimeType: 'image/png', data: '  ' }] }), null);
    assert.equal(readUpload({ images: [null] }), null);
    assert.equal(readUpload({ images: 'x' }), null);
  });

  test('the old body still works', () => {
    assert.deepEqual(readUpload({ fileBase64: 'QUJD', mimeType: 'application/pdf' }), {
      inlineParts: [{ inlineData: { mimeType: 'application/pdf', data: 'QUJD' } }],
      pageCount: 1,
    });
    assert.equal(readUpload({ fileBase64: '', mimeType: 'application/pdf' }), null);
    assert.equal(readUpload({}), null);
  });
});

describe('POST /api/extract-fields with answer boxes', () => {
  const path = '/api/extract-fields';
  const image = { mimeType: 'image/jpeg', data: 'QUJD' };
  let realLog;
  let logged;
  beforeEach(() => {
    logged = [];
    realLog = console.log;
    console.log = (...args) => logged.push(args.join(' '));
  });
  afterEach(() => {
    console.log = realLog;
  });

  function appWith(fake) {
    const app = express();
    app.use(express.json());
    app.use(path, createExtractFieldsRouter(fake));
    return app;
  }

  test('every field has answerBox (box or null) and page; fields without a box are kept', async () => {
    const fake = async () => ({
      fields: [
        { label: 'Name', question: 'Q1', answerBox: [100, 200, 130, 600], page: 0 },
        { label: 'Bank', question: 'Q2', answer_box: [[10, 20, 40, 300]], page_index: '1' },
        { label: 'No box', question: 'Q3' },
        { label: 'Null box', question: 'Q4', answerBox: null, page: 0 },
        { label: 'Bad page', question: 'Q5', answerBox: [10, 20, 40, 300], page: 7 },
      ],
    });
    const res = await request(appWith(fake)).post(path).send({ images: [image, image], lang: 'en-US' });
    assert.equal(res.status, 200);
    const fields = res.body.fields;
    assert.equal(fields.length, 5);
    assert.deepEqual([fields[0].answerBox, fields[0].page], [[100, 200, 130, 600], 0]);
    assert.deepEqual([fields[1].answerBox, fields[1].page], [[10, 20, 40, 300], 1]);
    for (const i of [2, 3, 4]) assert.equal(fields[i].answerBox, null);
    // The other names a model used do not leak into the answer.
    for (const f of fields) {
      assert.equal(f.answer_box, undefined);
      assert.equal(f.page_index, undefined);
    }
  });

  test('all images reach Gemini in order and the prompt asks for answerBox and page', async () => {
    let seen;
    const fake = async (args) => {
      seen = args;
      return { fields: [] };
    };
    const second = { mimeType: 'image/png', data: 'REVG' };
    await request(appWith(fake)).post(path).send({ images: [image, second], lang: 'hi-IN' });
    assert.equal(seen.inlineParts.length, 2);
    assert.equal(seen.inlineParts[1].inlineData.mimeType, 'image/png');
    assert.match(seen.prompt, /answerBox/);
    assert.match(seen.prompt, /"page"/);
    assert.match(seen.prompt, /2 page images/);
    assert.ok(seen.prompt.includes('hi-IN'));
  });

  test('invalid image lists give 400 and Gemini is not called', async () => {
    let calls = 0;
    const fake = async () => {
      calls += 1;
      return { fields: [] };
    };
    const app = appWith(fake);
    for (const images of [[], Array(MAX_IMAGES + 1).fill(image), [{ mimeType: 'application/pdf', data: 'QUJD' }]]) {
      const res = await request(app).post(path).send({ images, lang: 'en-US' });
      assert.equal(res.status, 400);
    }
    assert.equal(calls, 0);
  });

  test('only counts are logged, never the labels', async () => {
    const fake = async () => ({ fields: [{ label: 'SECRET LABEL', question: 'Q', answerBox: [10, 20, 40, 300], page: 0 }, { label: 'Other', question: 'Q' }] });
    await request(appWith(fake)).post(path).send({ images: [image], lang: 'en-US' });
    const line = logged.find((l) => l.includes('[extract-fields]'));
    assert.match(line, /fields=2 withBox=1 no_box=1/);
    assert.ok(logged.every((l) => !l.includes('SECRET LABEL')));
  });
});
