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

describe('short version from Gemini', () => {
  test('a short version is kept', () => {
    const { blocks } = normalizeBlocks([{ ...GOOD, short: ' முதல் ' }]);
    assert.equal(blocks[0].short, 'முதல்');
  });

  test('other key names for it', () => {
    assert.equal(normalizeBlocks([{ ...GOOD, short_translation: 'முதல்' }]).blocks[0].short, 'முதல்');
    assert.equal(normalizeBlocks([{ ...GOOD, shortVersion: 'முதல்' }]).blocks[0].short, 'முதல்');
  });

  test('a missing, blank, non-text or identical short version is left out', () => {
    for (const short of [undefined, '', '   ', 5, null, GOOD.translation]) {
      const [block] = normalizeBlocks([{ ...GOOD, short }]).blocks;
      assert.equal('short' in block, false, String(short));
    }
  });

  test('a block without a short version is not dropped', () => {
    const { blocks, report } = normalizeBlocks([GOOD]);
    assert.equal(blocks.length, 1);
    assert.equal(report.dropped, 0);
  });
});

describe('prompt: everything in the target language and script', () => {
  test('non-Latin target: names, brands and English words go into the target script', () => {
    const prompt = buildPrompt('ta-IN');
    assert.match(prompt, /Write EVERY word completely in Tamil, in the Tamil script/);
    assert.match(prompt, /names of people, brand names/);
    assert.match(prompt, /Do NOT leave any word in Latin \(English\) letters/);
    assert.match(prompt, /Keep unchanged ONLY: e-mail addresses, web links, numbers, dates and ID codes/);
    // the examples given for Tamil
    assert.ok(prompt.includes('காயின்மார்க்கெட்கேப்'));
    assert.ok(prompt.includes('கில்லி'));
    assert.ok(prompt.includes('ஜான்'));
  });

  test('other scripts get the same rule with their own script name, but no Tamil examples', () => {
    const hi = buildPrompt('hi-IN');
    assert.match(hi, /completely in Hindi, in the Devanagari script/);
    assert.ok(!hi.includes('காயின்மார்க்கெட்கேப்'));
    assert.match(buildPrompt('ar-SA'), /in the Arabic script/);
    assert.match(buildPrompt('ja-JP'), /Japanese \(kanji, hiragana and katakana\) script/);
  });

  test('Latin target: names stay, no script rule', () => {
    const es = buildPrompt('es-ES');
    assert.ok(!es.includes('Write EVERY word completely'));
    assert.match(es, /Spanish/);
    assert.match(es, /exactly as they are/);
  });

  test('every block asks for the short version too', () => {
    const prompt = buildPrompt('ta-IN');
    assert.match(prompt, /exactly four keys/);
    assert.match(prompt, /"short"/);
    assert.match(prompt, /SHORTER version/);
  });
});

describe('route log: short versions and leftover Latin text', () => {
  const body = { imageBase64: 'QUJD', mimeType: 'image/png' };
  const appFor = (reply) => {
    const app = express();
    app.use(express.json());
    app.use('/api/translate-layout', createTranslateLayoutRouter(async () => reply));
    return app;
  };
  const logLine = (mockCalls) => mockCalls.map((c) => c.arguments.join(' ')).find((l) => l.includes('[translate-layout]'));

  test('counts the translations that still have English words (non-Latin target)', async (t) => {
    const log = t.mock.method(console, 'log', () => {});
    const reply = {
      blocks: [
        { text: 'John', translation: 'John', box_2d: [10, 10, 40, 100] }, // stayed in English
        { text: 'John', translation: 'ஜான்', short: 'ஜா', box_2d: [60, 10, 90, 100] },
        { text: 'ID', translation: 'எண் ABCDE1234F', box_2d: [110, 10, 140, 100] }, // the code may stay
        { text: 'x', translation: 'CoinMarketCap வழியாக', box_2d: [160, 10, 190, 100] },
      ],
    };
    await request(appFor(reply)).post('/api/translate-layout').send({ ...body, lang: 'ta-IN' });
    const line = logLine(log.mock.calls);
    assert.match(line, / short=1 latinLeft=2$/);
    assert.ok(!line.includes('John'));
    assert.ok(!line.includes('CoinMarketCap'));
  });

  test('no latinLeft for a Latin-script target', async (t) => {
    const log = t.mock.method(console, 'log', () => {});
    const reply = { blocks: [{ text: 'John', translation: 'John', box_2d: [10, 10, 40, 100] }] };
    await request(appFor(reply)).post('/api/translate-layout').send({ ...body, lang: 'es-ES' });
    const line = logLine(log.mock.calls);
    assert.ok(!line.includes('latinLeft'));
    assert.match(line, / short=0$/);
  });

  test('the response keeps the short version', async (t) => {
    t.mock.method(console, 'log', () => {});
    const reply = { blocks: [{ text: 'Submit', translation: 'சமர்ப்பிக்கவும்', short: 'அனுப்பு', box_2d: [10, 10, 40, 100] }] };
    const res = await request(appFor(reply)).post('/api/translate-layout').send({ ...body, lang: 'ta-IN' });
    assert.equal(res.body.blocks[0].short, 'அனுப்பு');
  });
});

describe('time words: AM and PM', () => {
  const body = { imageBase64: 'QUJD', mimeType: 'image/png' };
  const appFor = (reply) => {
    const app = express();
    app.use(express.json());
    app.use('/api/translate-layout', createTranslateLayoutRouter(async () => reply));
    return app;
  };

  test('the prompt asks for time words and common abbreviations to be translated (every language except English)', () => {
    for (const lang of ['hi-IN', 'ta-IN', 'ar-SA', 'es-ES', 'fr-FR', 'ja-JP']) {
      const prompt = buildPrompt(lang);
      assert.match(prompt, /Time words and common abbreviations MUST be translated/, lang);
      assert.match(prompt, /AM and PM/, lang);
      assert.match(prompt, /10:30 AM/, lang);
      assert.match(prompt, /Mr, Mrs, Dr/, lang);
    }
    assert.ok(!buildPrompt('en-US').includes('Time words and common abbreviations'));
  });

  test('safety net: if Gemini still writes AM / PM in English, the route uses the words of the language', async (t) => {
    t.mock.method(console, 'log', () => {});
    const reply = {
      blocks: [{ text: 'Open 10:30 AM - 5:00 PM', translation: 'खुला 10:30 AM - 5:00 PM', short: '10:30 AM', box_2d: [10, 10, 40, 300] }],
    };
    const res = await request(appFor(reply)).post('/api/translate-layout').send({ ...body, lang: 'hi-IN' });
    assert.equal(res.body.blocks[0].translation, 'खुला 10:30 पूर्वाह्न - 5:00 अपराह्न');
    assert.equal(res.body.blocks[0].short, '10:30 पूर्वाह्न');
  });

  test('the safety net runs before the leftover-English count', async (t) => {
    const log = t.mock.method(console, 'log', () => {});
    const reply = { blocks: [{ text: 'Open 10:30 AM', translation: 'खुला 10:30 AM', box_2d: [10, 10, 40, 300] }] };
    await request(appFor(reply)).post('/api/translate-layout').send({ ...body, lang: 'hi-IN' });
    const line = log.mock.calls.map((c) => c.arguments.join(' ')).find((l) => l.includes('[translate-layout]'));
    assert.match(line, /latinLeft=0$/);
  });

  test('English and Portuguese answers are not changed', async (t) => {
    t.mock.method(console, 'log', () => {});
    const reply = { blocks: [{ text: 'Open 10:30 AM', translation: 'Aberto 10:30 AM', box_2d: [10, 10, 40, 300] }] };
    const res = await request(appFor(reply)).post('/api/translate-layout').send({ ...body, lang: 'pt-BR' });
    assert.equal(res.body.blocks[0].translation, 'Aberto 10:30 AM');
  });
});
