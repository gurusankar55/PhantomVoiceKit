// tests/unit/layoutParser.test.js
// Every reply shape that Gemini models have given (or may give) for /api/translate-layout,
// plus the logging of the route. No real Gemini call is made.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

import { findBlockList, normalizeBlocks, parseLayoutReply, describeReport } from '../../server/routes/layout-parser.js';
import { createTranslateLayoutRouter, buildPrompt } from '../../server/routes/translate-layout.js';
import { parseModelJson } from '../../server/gemini.js';

const GOOD = { text: 'First name', translation: 'முதல் பெயர்', box_2d: [223, 51, 250, 180] };

// What gemini-3.5-flash-lite really answered for the test form with the FIRST prompt:
// every box was wrapped in one more list. This is what made the app say "no printed text".
const LITE_NESTED_REPLY = {
  blocks: [
    { text: 'Customer Registration Form', translation: 'வாடிக்கையாளர் பதிவுப் படிவம்', box_2d: [[49, 51, 101, 625]] },
    { text: 'First name', translation: 'முதல் பெயர்', box_2d: [[223, 51, 250, 180]] },
    { text: 'Last name', translation: 'கடைசிப் பெயர்', box_2d: [[355, 51, 384, 178]] },
  ],
};

describe('reply variations', () => {
  test('the normal shape needs no repair', () => {
    const { blocks, report } = parseLayoutReply({ blocks: [GOOD] });
    assert.deepEqual(blocks, [GOOD]);
    assert.deepEqual(report, { received: 1, kept: 1, dropped: 0, reasons: {}, fixes: {} });
  });

  test('REAL lite reply: box_2d nested in one more list', () => {
    const { blocks, report } = parseLayoutReply(LITE_NESTED_REPLY);
    assert.equal(blocks.length, 3);
    assert.deepEqual(blocks[0].box_2d, [49, 51, 101, 625]);
    assert.equal(report.dropped, 0);
    assert.deepEqual(report.fixes, { nested_box: 3 });
  });

  test('box as an object with ymin/xmin/ymax/xmax', () => {
    const { blocks, report } = normalizeBlocks([{ ...GOOD, box_2d: { ymin: 223, xmin: 51, ymax: 250, xmax: 180 } }]);
    assert.deepEqual(blocks[0].box_2d, [223, 51, 250, 180]);
    assert.equal(report.fixes.object_box, 1);
  });

  test('box as an object with y_min/x_min/y_max/x_max, and top/left/bottom/right', () => {
    const a = normalizeBlocks([{ ...GOOD, box_2d: { y_min: 1, x_min: 2, y_max: 30, x_max: 40 } }]).blocks[0].box_2d;
    const b = normalizeBlocks([{ ...GOOD, box_2d: { top: 1, left: 2, bottom: 30, right: 40 } }]).blocks[0].box_2d;
    assert.deepEqual(a, [1, 2, 30, 40]);
    assert.deepEqual(b, [1, 2, 30, 40]);
  });

  test('box as {x, y, width, height}', () => {
    const { blocks } = normalizeBlocks([{ ...GOOD, box_2d: { x: 50, y: 200, width: 130, height: 40 } }]);
    assert.deepEqual(blocks[0].box_2d, [200, 50, 240, 180]);
  });

  test('values on a 0 to 1 scale are multiplied by 1000', () => {
    const { blocks, report } = normalizeBlocks([{ ...GOOD, box_2d: [0.223, 0.051, 0.25, 0.18] }]);
    assert.deepEqual(blocks[0].box_2d, [223, 51, 250, 180]);
    assert.equal(report.fixes.scale_0_1, 1);
  });

  test('numbers written as strings', () => {
    const { blocks, report } = normalizeBlocks([{ ...GOOD, box_2d: ['223', '51', ' 250 ', '180'] }]);
    assert.deepEqual(blocks[0].box_2d, [223, 51, 250, 180]);
    assert.equal(report.fixes.string_numbers, 1);
  });

  test('other key names: bbox, translated_text, original_text', () => {
    const { blocks, report } = normalizeBlocks([
      { original_text: 'First name', translated_text: 'முதல் பெயர்', bbox: [223, 51, 250, 180] },
    ]);
    assert.deepEqual(blocks, [GOOD]);
    assert.equal(report.fixes.box_key, 1);
    assert.equal(report.fixes.translation_key, 1);
  });

  test('the list under another name, or as a top-level array', () => {
    assert.equal(parseLayoutReply({ text_blocks: [GOOD] }).blocks.length, 1);
    assert.equal(parseLayoutReply({ whatever_name: [GOOD], count: 1 }).blocks.length, 1);
    assert.equal(parseLayoutReply([GOOD]).blocks.length, 1);
    assert.equal(parseLayoutReply({ text_blocks: [GOOD] }).report.fixes['key:text_blocks'], 1);
  });

  test('no list at all gives null', () => {
    assert.equal(findBlockList({}), null);
    assert.equal(findBlockList({ a: [], b: [] }), null); // two lists: cannot tell which one
    assert.equal(findBlockList('text'), null);
    assert.equal(findBlockList(null), null);
    assert.equal(parseLayoutReply({ message: 'sorry' }), null);
  });
});

describe('dropped blocks are counted by reason', () => {
  test('each reason', () => {
    const { blocks, report } = normalizeBlocks([
      GOOD,
      null, // not_an_object
      { text: 'x', box_2d: [1, 2, 3, 4] }, // missing_translation
      { ...GOOD, translation: '  ' }, // empty_translation
      { text: 'x', translation: 'y' }, // missing_box
      { ...GOOD, box_2d: [1, 2, 3] }, // bad_box (3 numbers)
      { ...GOOD, box_2d: 'top left' }, // bad_box
      { ...GOOD, box_2d: [10, 10, 10, 50] }, // no_area
    ]);
    assert.equal(blocks.length, 1);
    assert.deepEqual(report.reasons, {
      not_an_object: 1,
      missing_translation: 1,
      empty_translation: 1,
      missing_box: 1,
      bad_box: 2,
      no_area: 1,
    });
    assert.equal(report.received, 8);
    assert.equal(report.kept, 1);
    assert.equal(report.dropped, 7);
  });

  test('more than 300 blocks: the extra ones are counted as too_many', () => {
    const { blocks, report } = normalizeBlocks(Array.from({ length: 320 }, () => GOOD));
    assert.equal(blocks.length, 300);
    assert.deepEqual(report.reasons, { too_many: 20 });
  });

  test('describeReport has only numbers and reason names', () => {
    const { report } = normalizeBlocks([GOOD, { ...GOOD, translation: '' }]);
    assert.equal(describeReport(report), 'received=2 kept=1 dropped=1 reasons={"empty_translation":1} fixes={}');
  });
});

describe('parseModelJson (markdown fences and extra words)', () => {
  const data = { blocks: [GOOD] };

  test('plain JSON', () => {
    assert.deepEqual(parseModelJson(JSON.stringify(data)), data);
  });

  test('wrapped in ```json fences', () => {
    assert.deepEqual(parseModelJson('```json\n' + JSON.stringify(data, null, 2) + '\n```'), data);
    assert.deepEqual(parseModelJson('```\n' + JSON.stringify(data) + '\n```'), data);
  });

  test('a sentence before and after the JSON', () => {
    assert.deepEqual(parseModelJson('Here is the result:\n' + JSON.stringify(data) + '\nHope this helps!'), data);
  });

  test('a top-level array', () => {
    assert.deepEqual(parseModelJson('```json\n[1,2]\n```'), [1, 2]);
  });

  test('unusable text throws an error that does not contain the text', () => {
    assert.throws(() => parseModelJson('secret form content, no json here'), (err) => {
      assert.ok(!err.message.includes('secret'));
      return true;
    });
    assert.throws(() => parseModelJson(undefined));
    assert.throws(() => parseModelJson('{"broken": '));
  });
});

describe('route: logging and prompt', () => {
  const validBody = { imageBase64: 'QUJD', mimeType: 'image/png', lang: 'ta-IN' };
  const makeApp = (reply) => {
    const app = express();
    app.use(express.json());
    app.use('/api/translate-layout', createTranslateLayoutRouter(async () => reply));
    return app;
  };

  test('the REAL lite reply (nested boxes) now gives blocks', async () => {
    const res = await request(makeApp(LITE_NESTED_REPLY)).post('/api/translate-layout').send(validBody);
    assert.equal(res.status, 200);
    assert.equal(res.body.blocks.length, 3);
  });

  test('logs counts and reasons, never text from the form', (t) => {
    const log = t.mock.method(console, 'log', () => {});
    return request(makeApp({ blocks: [GOOD, { ...GOOD, translation: '' }] }))
      .post('/api/translate-layout')
      .send(validBody)
      .then(() => {
        const lines = log.mock.calls.map((c) => c.arguments.join(' ')).filter((l) => l.includes('[translate-layout]'));
        assert.equal(lines.length, 1);
        assert.match(lines[0], /received=2 kept=1 dropped=1 reasons=\{"empty_translation":1\}/);
        assert.ok(!lines[0].includes('First name'));
        assert.ok(!lines[0].includes('முதல்'));
      });
  });

  test('a reply without any list is a 502 and logs only its key names', (t) => {
    const error = t.mock.method(console, 'error', () => {});
    return request(makeApp({ message: 'I cannot read this image' }))
      .post('/api/translate-layout')
      .send(validBody)
      .then((res) => {
        assert.equal(res.status, 502);
        const line = error.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
        assert.match(line, /keys=message/);
        assert.ok(!line.includes('cannot read'));
      });
  });

  test('the prompt asks for a flat 4-number box on a 0-1000 scale with an example', () => {
    const prompt = buildPrompt('ta-IN');
    assert.match(prompt, /FLAT list of exactly 4 whole numbers/);
    assert.match(prompt, /0 to 1000/);
    assert.match(prompt, /Tamil/);
    assert.match(prompt, /"box_2d": \[\d+, \d+, \d+, \d+\]/); // the example
    assert.match(prompt, /no markdown/);
  });
});
