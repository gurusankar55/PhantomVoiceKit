// tests/unit/spiritClerkPart2.test.js
// Spirit Clerk redesign, part 2: the signature, options and tick marks, comb boxes, the review
// screen and the PDF pages made of pictures. Pure functions and routes only: no browser, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import fc from 'fast-check';

import { inkBounds, growRect, fitInBox, midPoint, isRealSignature } from '../../apps/spirit-clerk/signature-utils.js';
import { matchOption, findOption, optionsFor, CHECKBOX_VALUES } from '../../apps/spirit-clerk/option-utils.js';
import { answerLine, placeAnswers, moveOccupied, reviewRows, SIGNATURE_TEXT } from '../../apps/spirit-clerk/fill-original-utils.js';
import { detectCombCells, layoutComb } from '../../skeleton/form-overlay-utils.js';
import { layoutEntries, isRtlText, PAGE_WIDTH, PAGE_HEIGHT } from '../../skeleton/text-pages-utils.js';
import { parseOptions, MAX_OPTIONS } from '../../server/routes/answer-box-parser.js';
import { createExtractFieldsRouter } from '../../server/routes/extract-fields.js';
import { createTranslateRouter } from '../../server/routes/translate.js';

// ---------- helpers ----------

// An RGBA image of one colour, and a way to paint a rectangle on it.
const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };
function solid(width, height, color = WHITE) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([color.r, color.g, color.b, 255], i * 4);
  return { data, width, height };
}
function paint(image, x, y, w, h, color) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) image.data.set([color.r, color.g, color.b, 255], (py * image.width + px) * 4);
  }
}
// A transparent image with some opaque pixels (a signature).
function transparent(width, height) {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}
function ink(image, x, y, w = 1, h = 1) {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) image.data[(py * image.width + px) * 4 + 3] = 255;
}

// ---------- 1. Signature ----------

describe('signature utils', () => {
  test('inkBounds: the rectangle around everything that was drawn', () => {
    const image = transparent(100, 60);
    ink(image, 10, 20, 5, 5);
    ink(image, 70, 40, 3, 2);
    assert.deepEqual(inkBounds(image), { x: 10, y: 20, w: 63, h: 22 });
  });

  test('inkBounds: nothing drawn gives null; a faint pixel (almost see-through) is not ink', () => {
    assert.equal(inkBounds(transparent(50, 50)), null);
    const faint = transparent(10, 10);
    faint.data[3] = 5;
    assert.equal(inkBounds(faint), null);
  });

  test('growRect adds a margin but stays inside the image', () => {
    assert.deepEqual(growRect({ x: 10, y: 10, w: 20, h: 20 }, 5, 100, 100), { x: 5, y: 5, w: 30, h: 30 });
    assert.deepEqual(growRect({ x: 2, y: 2, w: 96, h: 96 }, 10, 100, 100), { x: 0, y: 0, w: 100, h: 100 });
  });

  test('isRealSignature: a dot or a tiny mark is not a signature', () => {
    assert.equal(isRealSignature(null), false);
    assert.equal(isRealSignature({ w: 3, h: 3 }), false);
    assert.equal(isRealSignature({ w: 120, h: 40 }), true);
    assert.equal(isRealSignature({ w: 4, h: 80 }), true);
  });

  test('fitInBox: the shape is kept, the picture is centred and inside the box', () => {
    const box = { x: 100, y: 50, w: 400, h: 100 };
    const fitted = fitInBox(200, 100, box); // twice as wide as high
    assert.ok(Math.abs(fitted.w / fitted.h - 2) < 1e-9, 'shape kept');
    assert.ok(fitted.x >= box.x && fitted.x + fitted.w <= box.x + box.w);
    assert.ok(fitted.y >= box.y && fitted.y + fitted.h <= box.y + box.h);
    assert.ok(Math.abs(fitted.x + fitted.w / 2 - (box.x + box.w / 2)) < 1e-9, 'centred across');
    assert.ok(Math.abs(fitted.y + fitted.h / 2 - (box.y + box.h / 2)) < 1e-9, 'centred up and down');
    // A tall picture in a wide box is limited by the height.
    const tall = fitInBox(50, 200, box);
    assert.ok(tall.h <= box.h && Math.abs(tall.w / tall.h - 0.25) < 1e-9);
  });

  test('fitInBox: a tiny picture is not enlarged more than 4 times', () => {
    const fitted = fitInBox(10, 5, { x: 0, y: 0, w: 1000, h: 1000 });
    assert.equal(fitted.w, 40);
  });

  test('property: the fitted picture always lies inside the box and keeps its shape', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2000 }), fc.integer({ min: 1, max: 2000 }), fc.integer({ min: 20, max: 1500 }), fc.integer({ min: 20, max: 1500 }), (iw, ih, bw, bh) => {
        const box = { x: 10, y: 20, w: bw, h: bh };
        const fitted = fitInBox(iw, ih, box);
        assert.ok(fitted.x >= box.x - 1e-6 && fitted.y >= box.y - 1e-6);
        assert.ok(fitted.x + fitted.w <= box.x + box.w + 1e-6 && fitted.y + fitted.h <= box.y + box.h + 1e-6);
        assert.ok(Math.abs(fitted.w / fitted.h - iw / ih) < 1e-6);
      }),
      { numRuns: 200 }
    );
  });

  test('midPoint', () => {
    assert.deepEqual(midPoint({ x: 0, y: 10 }, { x: 10, y: 30 }), { x: 5, y: 20 });
  });
});

// ---------- 2. Options and tick marks ----------

describe('matchOption: the option that was said', () => {
  const gender = [{ label: 'Male' }, { label: 'Female' }, { label: 'Other' }];

  test('the same words, ignoring case and full stops', () => {
    assert.equal(matchOption('male', gender), 0);
    assert.equal(matchOption('Female.', gender), 1);
    assert.equal(matchOption('  OTHER ', gender), 2);
  });

  test('the option inside a sentence; the longest one wins', () => {
    assert.equal(matchOption('I am female', gender), 1); // "male" is not a whole word of "female"
    const marital = [{ label: 'Married' }, { label: 'Unmarried' }, { label: 'Single' }];
    assert.equal(matchOption('I am unmarried', marital), 1);
    assert.equal(matchOption('married', marital), 0);
  });

  test('part of exactly one option', () => {
    assert.equal(matchOption('self employed', [{ label: 'Self employed' }, { label: 'Salaried' }]), 0);
    assert.equal(matchOption('employed', [{ label: 'Self employed' }, { label: 'Salaried' }]), 0);
    assert.equal(matchOption('employed', [{ label: 'Self employed' }, { label: 'Employed by others' }]), -1); // not clear
  });

  test('no match, an empty text or no options give -1', () => {
    assert.equal(matchOption('banana', gender), -1);
    assert.equal(matchOption('', gender), -1);
    assert.equal(matchOption('male', []), -1);
    assert.equal(matchOption('male', undefined), -1);
  });

  test('yes and no', () => {
    const yesNo = CHECKBOX_VALUES.map((label) => ({ label }));
    assert.equal(matchOption('Yes.', yesNo), 0);
    assert.equal(matchOption('no', yesNo), 1);
  });

  test('findOption and optionsFor', () => {
    const options = [{ label: 'Male', box: [1, 2, 3, 4] }, { label: 'Female', box: null }];
    assert.equal(findOption(options, ' female ').label, 'Female');
    assert.equal(findOption(options, 'x'), null);
    assert.equal(findOption(undefined, 'x'), null);
    assert.deepEqual(optionsFor({ kind: 'checkbox' }), [{ label: null, value: 'Yes' }, { label: null, value: 'No' }]);
    assert.deepEqual(optionsFor({ kind: 'choice', options }), [{ label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }]);
    assert.deepEqual(optionsFor({ kind: 'choice' }), []);
  });
});

describe('parseOptions (the options of a choice field, with their boxes)', () => {
  test('texts, objects with other key names and boxes in different shapes', () => {
    const options = parseOptions([
      'Male',
      { label: 'Female', box: [100, 200, 120, 220] },
      { text: 'Other', tick_box: [[100, 400, 120, 420]] },
      { name: 'Unknown', box: { ymin: 100, xmin: 600, ymax: 120, xmax: 620 } },
    ]);
    assert.deepEqual(options, [
      { label: 'Male', box: null },
      { label: 'Female', box: [100, 200, 120, 220] },
      { label: 'Other', box: [100, 400, 120, 420] },
      { label: 'Unknown', box: [100, 600, 120, 620] },
    ]);
  });

  test('empty words and repeats are dropped; a box that is too big or too small is dropped, the option stays', () => {
    const options = parseOptions([
      { label: '  ' },
      { label: 'A', box: [0, 0, 500, 500] }, // a whole block, not a tick box
      { label: 'a' }, // repeat
      { label: 'B', box: [10, 10, 11, 11] }, // too small
      null,
      42,
      { label: 'C', box: 'none' },
    ]);
    assert.deepEqual(options, [{ label: 'A', box: null }, { label: 'B', box: null }, { label: 'C', box: null }]);
  });

  test('values on a 0 to 1 scale are repaired; at most 12 options; no array gives []', () => {
    assert.deepEqual(parseOptions([{ label: 'A', box: [0.1, 0.2, 0.12, 0.22] }])[0].box, [100, 200, 120, 220]);
    assert.equal(parseOptions(Array.from({ length: 30 }, (_, i) => `Option ${i}`)).length, MAX_OPTIONS);
    for (const bad of [undefined, null, 'x', {}, 5]) assert.deepEqual(parseOptions(bad), []);
  });
});

describe('extract-fields returns the options', () => {
  const path = '/api/extract-fields';
  const body = { images: [{ mimeType: 'image/jpeg', data: 'QUJD' }], lang: 'en-US' };
  const run = async (fields) => {
    const app = express();
    app.use(express.json());
    app.use(path, createExtractFieldsRouter(async () => ({ fields })));
    const res = await request(app).post(path).send(body);
    assert.equal(res.status, 200);
    return res.body.fields;
  };

  test('a choice field has its options with boxes; other fields have []', async () => {
    const fields = await run([
      { label: 'Gender', kind: 'choice', options: [{ label: 'Male', box: [100, 200, 120, 220] }, 'Female'] },
      { label: 'Name', kind: 'name', options: ['should be ignored'] },
      { label: 'Agree', kind: 'checkbox' },
    ]);
    assert.deepEqual(fields[0].options, [{ label: 'Male', box: [100, 200, 120, 220] }, { label: 'Female', box: null }]);
    assert.deepEqual(fields[1].options, []);
    assert.deepEqual(fields[2].options, []);
  });

  test('the prompt asks for the option boxes in the same call', async () => {
    let seen;
    const app = express();
    app.use(express.json());
    app.use(path, createExtractFieldsRouter(async (args) => {
      seen = args;
      return { fields: [] };
    }));
    await request(app).post(path).send(body);
    assert.match(seen.prompt, /"options"/);
    assert.match(seen.prompt, /box, circle or bracket to tick/);
  });
});

describe('translate with options', () => {
  test('the options are in the prompt, as plain strings only', async () => {
    let prompt = '';
    const app = express();
    app.use(express.json());
    app.use('/api/translate', createTranslateRouter(async (args) => {
      prompt = args.prompt;
      return { translation: 'Male', value: 'Male' };
    }));
    await request(app).post('/api/translate').send({ text: 'ஆண்', targetLang: 'en', kind: 'choice', label: 'Gender', options: ['Male', 'Female', 42, '', { x: 1 }] });
    assert.ok(prompt.includes('["Male","Female"]'));
    await request(app).post('/api/translate').send({ text: 'x', targetLang: 'en', kind: 'name', options: ['Male'] });
    assert.ok(!prompt.includes('exactly these options'));
  });
});

// ---------- placing answers: tick marks, signature, checkbox ----------

describe('placeAnswers: ticks, signature and checkbox', () => {
  const fields = [
    { label: 'Gender', kind: 'choice', page: 0, answerBox: [100, 100, 130, 900], options: [{ label: 'Male', box: [100, 200, 120, 220] }, { label: 'Female', box: [100, 400, 120, 420] }] },
    { label: 'Marital status', kind: 'choice', page: 0, answerBox: [200, 100, 230, 900], options: [{ label: 'Single', box: null }] },
    { label: 'I agree', kind: 'checkbox', page: 0, answerBox: [300, 100, 320, 120] },
    { label: 'Newsletter', kind: 'checkbox', page: 0, answerBox: [350, 100, 370, 120] },
    { label: 'Signature', kind: 'signature', page: 1, answerBox: [800, 100, 900, 500] },
    { label: 'Thumb', kind: 'signature', page: 1, answerBox: null },
  ];
  const answers = [
    { englishMeaning: 'Female' },
    { englishMeaning: 'Single' },
    { englishMeaning: 'Yes' },
    { englishMeaning: 'No' },
    { englishMeaning: SIGNATURE_TEXT, signatureImage: 'data:image/png;base64,AAAA' },
    { englishMeaning: SIGNATURE_TEXT, signatureImage: 'data:image/png;base64,BBBB' },
  ];

  test('a chosen option gets a tick in ITS box; no box falls back to text; Yes ticks; No draws nothing', () => {
    const { pages, unplaced } = placeAnswers(fields, answers, 2);
    assert.deepEqual(pages[0].map((e) => [e.index, e.type, e.box]), [
      [0, 'tick', [100, 400, 120, 420]],
      [1, 'text', [200, 100, 230, 900]],
      [2, 'tick', [300, 100, 320, 120]],
    ]);
    assert.ok(!pages[0].some((e) => e.index === 3), 'a tick box answered No is not drawn');
    assert.ok(!unplaced.some((e) => e.index === 3), 'and it is not "lost" either');
  });

  test('the drawn signature goes into the signature box as an image; without a box it is listed with its picture', () => {
    const { pages, unplaced } = placeAnswers(fields, answers, 2);
    assert.deepEqual(pages[1].map((e) => [e.index, e.type, e.image]), [[4, 'image', 'data:image/png;base64,AAAA']]);
    assert.deepEqual(unplaced, [{ index: 5, label: 'Thumb', text: SIGNATURE_TEXT, image: 'data:image/png;base64,BBBB' }]);
  });

  test('"I will sign by hand" and skipped fields stay empty and are not listed', () => {
    const { pages, unplaced } = placeAnswers(fields, [undefined, undefined, undefined, undefined, { skipped: true, signatureLater: true }, { skipped: true }], 2);
    assert.equal(pages.flat().length, 0);
    assert.equal(unplaced.length, 0);
  });

  test('a checkbox Yes without a box is listed as text', () => {
    const { unplaced } = placeAnswers([{ label: 'Agree', kind: 'checkbox', page: 0, answerBox: null }], [{ englishMeaning: 'Yes' }], 1);
    assert.deepEqual(unplaced, [{ index: 0, label: 'Agree', text: 'Yes' }]);
  });

  test('a signature moved off the page by a filled box keeps its picture', () => {
    const placement = placeAnswers(fields, answers, 2);
    const moved = moveOccupied(placement, [[false, false, false], [true]]);
    assert.equal(moved.pages[1].length, 0);
    assert.ok(moved.unplaced.some((e) => e.index === 4 && e.image === 'data:image/png;base64,AAAA'));
  });

  test('answerLine of a signature', () => {
    assert.equal(answerLine({ signatureImage: 'x', englishMeaning: '' }), SIGNATURE_TEXT);
    assert.equal(answerLine({ skipped: true, signatureLater: true }), null);
  });
});

// ---------- 3. Comb boxes ----------

describe('detectCombCells', () => {
  // 8 cells of 30 px in a box from x = 20 to x = 260, with dividers 2 px wide.
  function comb({ withEdges = true } = {}) {
    const image = solid(300, 80);
    const from = withEdges ? 0 : 1;
    const to = withEdges ? 8 : 7;
    for (let k = from; k <= to; k++) paint(image, 20 + k * 30, 20, 2, 40, BLACK);
    return image;
  }
  const RECT = { x: 20, y: 20, w: 242, h: 40 };

  test('dividers 30 px apart make 8 cells', () => {
    const cells = detectCombCells(comb(), RECT);
    assert.equal(cells.length, 8);
    for (const cell of cells) assert.ok(Math.abs(cell.w - 30) <= 2, `cell width ${cell.w}`);
    assert.ok(cells[0].x <= 22 && cells[7].x + cells[7].w >= 258);
  });

  test('the first and the last cell may reach to the edge of the box', () => {
    const cells = detectCombCells(comb({ withEdges: false }), RECT);
    assert.equal(cells.length, 8);
  });

  test('cells keep the height of the box', () => {
    const cells = detectCombCells(comb(), RECT);
    assert.ok(cells.every((cell) => cell.y === RECT.y && cell.h === RECT.h));
  });

  test('no dividers, a plain border, a few dividers or uneven dividers are not a comb', () => {
    assert.equal(detectCombCells(solid(300, 80), RECT), null);

    const border = solid(300, 80);
    paint(border, 20, 20, 2, 40, BLACK);
    paint(border, 260, 20, 2, 40, BLACK);
    assert.equal(detectCombCells(border, RECT), null);

    const few = solid(300, 80);
    for (const x of [20, 100, 180]) paint(few, x, 20, 2, 40, BLACK);
    assert.equal(detectCombCells(few, RECT), null); // 3 cells at most: too few to be a comb

    const uneven = solid(300, 80);
    for (const x of [20, 40, 100, 130, 220, 260]) paint(uneven, x, 20, 2, 40, BLACK);
    assert.equal(detectCombCells(uneven, RECT), null);
  });

  test('printed letters in an ordinary box are not dividers', () => {
    const image = solid(300, 80);
    for (let i = 0; i < 6; i++) paint(image, 40 + i * 10, 35, 2, 10, BLACK); // short strokes of text
    assert.equal(detectCombCells(image, RECT), null);
  });

  test('a box that is too small or outside the image never throws', () => {
    assert.equal(detectCombCells(solid(300, 80), { x: 10, y: 10, w: 20, h: 40 }), null);
    assert.equal(detectCombCells(solid(100, 80), { x: 500, y: 500, w: 200, h: 40 }), null);
  });
});

describe('layoutComb: one character per cell', () => {
  test('as many characters as cells', () => {
    assert.deepEqual(layoutComb('ABCDE1234F', 10, 'code'), ['A', 'B', 'C', 'D', 'E', '1', '2', '3', '4', 'F']);
    assert.deepEqual(layoutComb('9876543210', 10, 'phone'), Array.from('9876543210'));
  });

  test('a date: 8 digits for 8 cells; 10 cells with printed separators keep them empty', () => {
    assert.deepEqual(layoutComb('03/06/1990', 8, 'date'), Array.from('03061990'));
    assert.deepEqual(layoutComb('03/06/1990', 10, 'date'), ['0', '3', '', '0', '6', '', '1', '9', '9', '0']);
  });

  test('spaces are ignored', () => {
    assert.deepEqual(layoutComb('AB CD', 4, 'name'), ['A', 'B', 'C', 'D']);
  });

  test('a code, number, phone or date with fewer characters is written from the left', () => {
    assert.deepEqual(layoutComb('1234', 6, 'number'), ['1', '2', '3', '4', '', '']);
  });

  test('a name that does not fit the cells, or too many characters, is not written cell by cell', () => {
    assert.equal(layoutComb('Ravi', 8, 'name'), null);
    assert.equal(layoutComb('ABCDEFGH', 4, 'code'), null);
    assert.equal(layoutComb('', 4, 'code'), null);
    assert.equal(layoutComb('...', 4, 'code'), null);
    assert.equal(layoutComb('A', 0, 'code'), null);
  });

  test('property: the result has exactly one entry per cell and keeps the characters in order', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[A-Z0-9]{1,12}$/), fc.integer({ min: 4, max: 14 }), fc.constantFrom('code', 'number', 'phone', 'date', 'name'), (text, cells, kind) => {
        const result = layoutComb(text, cells, kind);
        if (result === null) return;
        assert.equal(result.length, cells);
        assert.equal(result.join(''), text);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------- 4. Review screen ----------

describe('reviewRows', () => {
  const fields = [{ label: 'Name:' }, { label: 'Date of birth' }, { label: 'Signature' }, { label: 'Thumb' }, { label: 'Phone' }];
  const answers = [
    { englishMeaning: 'Ravi Kumar' },
    { skipped: true },
    { englishMeaning: SIGNATURE_TEXT, signatureImage: 'data:image/png;base64,AAAA', signature: true },
    { skipped: true, signature: true, signatureLater: true },
    undefined,
  ];

  test('every field has a row, in order, with a clean label', () => {
    const rows = reviewRows(fields, answers);
    assert.deepEqual(rows.map((r) => r.index), [0, 1, 2, 3, 4]);
    assert.equal(rows[0].label, 'Name');
  });

  test('answered, skipped, signature picture, sign later, missing', () => {
    const rows = reviewRows(fields, answers);
    assert.deepEqual(rows.map((r) => r.status), ['answered', 'skipped', 'signature', 'signLater', 'skipped']);
    assert.equal(rows[0].text, 'Ravi Kumar');
    assert.equal(rows[2].image, 'data:image/png;base64,AAAA');
    assert.equal(rows[2].text, '');
  });

  test('an answer without English text shows the PDF words', () => {
    assert.equal(reviewRows([{ label: 'A' }], [{ englishMeaning: ' ' }])[0].text, '(translation unavailable)');
  });
});

// ---------- 5. PDF pages made of pictures ----------

describe('layoutEntries (text drawn on canvases, so any script shows)', () => {
  const measure = (text, size) => text.length * size * 0.5;
  const base = { measure, width: 600, height: 400, margin: 40, bodySize: 20, titleSize: 30 };

  test('the title is on the first page; every entry is "Label: answer"', () => {
    const pages = layoutEntries([{ label: 'Name', text: 'Ravi' }], { ...base, title: 'Form: bank' });
    assert.equal(pages.length, 1);
    const texts = pages[0].items.filter((i) => i.type === 'text');
    assert.equal(texts[0].text, 'Form: bank');
    assert.equal(texts[0].bold, true);
    assert.equal(texts[1].text, 'Name: Ravi');
  });

  test('a long entry is wrapped between words: no word is cut and nothing is lost', () => {
    const text = 'twelve high street near the old market chennai tamil nadu india';
    const pages = layoutEntries([{ label: 'Address', text }], { ...base, width: 300 });
    const lines = pages.flatMap((p) => p.items.filter((i) => i.type === 'text').map((i) => i.text));
    assert.ok(lines.length > 1);
    assert.equal(lines.join(' '), `Address: ${text}`);
    for (const line of lines) assert.ok(measure(line, 20) <= 300 - 80 || !line.includes(' '), line);
  });

  test('a full page starts a new page; every line stays inside the page', () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ label: `Field ${i}`, text: `Answer ${i}` }));
    const pages = layoutEntries(entries, base);
    assert.ok(pages.length > 1);
    for (const page of pages) {
      for (const item of page.items) assert.ok(item.y + 20 <= base.height - base.margin + 1, `y ${item.y}`);
    }
    const count = pages.reduce((sum, p) => sum + p.items.length, 0);
    assert.equal(count, 40);
  });

  test('a picture (the signature) gets its own place under the entry, keeping its shape', () => {
    const pages = layoutEntries([{ label: 'Signature', text: '(signature)', image: { w: 400, h: 100 } }], { ...base, imageHeight: 60 });
    const picture = pages[0].items.find((i) => i.type === 'image');
    assert.equal(picture.entry, 0);
    assert.ok(Math.abs(picture.w / picture.h - 4) < 0.05);
    assert.ok(picture.h <= 60);
    const text = pages[0].items.find((i) => i.type === 'text');
    assert.ok(picture.y > text.y, 'under the text');
  });

  test('right-to-left text (Arabic, Urdu) is found and aligned to the right edge', () => {
    assert.equal(isRtlText('الاسم: رافي'), true);
    assert.equal(isRtlText('نام'), true);
    assert.equal(isRtlText('Name: رافي'), false); // the first letter decides
    assert.equal(isRtlText('12 - ابتدا'), true);
    assert.equal(isRtlText('தமிழ்'), false);
    assert.equal(isRtlText(''), false);
    const pages = layoutEntries([{ label: 'الاسم', text: 'رافي' }], base);
    const line = pages[0].items[0];
    assert.equal(line.rtl, true);
    assert.equal(line.x, base.width - base.margin);
  });

  test('at least one page, even without entries; A4 size by default', () => {
    assert.equal(layoutEntries([], base).length, 1);
    assert.equal(PAGE_WIDTH, 1240);
    assert.equal(PAGE_HEIGHT, 1754);
  });

  test('property: every entry text appears, in order, whatever the page size', () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[a-z]{1,10}( [a-z]{1,10}){0,6}$/), { minLength: 1, maxLength: 12 }), fc.integer({ min: 250, max: 700 }), (texts, width) => {
        const entries = texts.map((text, i) => ({ label: `L${i}`, text }));
        const pages = layoutEntries(entries, { ...base, width, height: 300 });
        const lines = pages.flatMap((p) => p.items.filter((i) => i.type === 'text').map((i) => i.text));
        assert.equal(lines.join(' '), entries.map((e) => `${e.label}: ${e.text}`).join(' '));
      }),
      { numRuns: 100 }
    );
  });
});

// ---------- 6. Voice not available ----------

describe('locales: the new strings exist in all 20 languages', () => {
  const dir = path.join(process.cwd(), 'skeleton', 'locales');
  const codes = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  const KEYS = [
    'spiritClerk.signHere', 'spiritClerk.signLater', 'spiritClerk.padHint', 'spiritClerk.padClear', 'spiritClerk.padUse',
    'spiritClerk.padEmpty', 'spiritClerk.signatureAlt', 'spiritClerk.signByHand', 'spiritClerk.chooseOption',
    'spiritClerk.yes', 'spiritClerk.no', 'spiritClerk.reviewHeading', 'spiritClerk.reviewHint', 'spiritClerk.edit',
    'spiritClerk.allCorrect', 'spiritClerk.voiceOff', 'spiritClerk.noOptionMatch',
  ];

  for (const code of codes) {
    test(code, () => {
      const data = JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));
      for (const key of KEYS) assert.ok(typeof data[key] === 'string' && data[key].trim() !== '', `${key} missing`);
    });
  }

  test('every key used by the Spirit Clerk page and script exists in en.json', () => {
    const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));
    const used = new Set();
    for (const file of ['apps/spirit-clerk/app.js', 'apps/spirit-clerk/answer-widgets.js', 'apps/spirit-clerk/index.html', 'apps/spirit-clerk/answer-flow.js']) {
      const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      for (const match of text.matchAll(/['"`]((?:spiritClerk|fillOriginal|dualDisplay|common|formTranslator)\.[A-Za-z]+)['"`]/g)) used.add(match[1]);
    }
    const missing = [...used].filter((key) => !(key in en));
    assert.deepEqual(missing, [], `keys used but missing in en.json: ${missing.join(', ')}`);
  });
});
