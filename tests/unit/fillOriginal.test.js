// tests/unit/fillOriginal.test.js
// The pure functions behind "Fill the original form" (Spirit Clerk):
// sorting answers onto pages, fitting an answer into its box, and the small page helpers.
// A fake font is used (every character has a fixed width), so the tests are exact.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { answerLine, usableBox, placeAnswers, moveOccupied, countPlaced, filledPdfFilename, MISSING_TRANSLATION } from '../../apps/spirit-clerk/fill-original-utils.js';
import { fitAnswer, layoutAt, boxToPixels, boxHasInk } from '../../skeleton/form-overlay-utils.js';
import { splitDataUrl } from '../../skeleton/page-images-utils.js';
import { limitPages, fitImageSize, pdfPageSize } from '../../apps/form-translator/translator-utils.js';

describe('answerLine', () => {
  test('the English meaning is used, trimmed', () => {
    assert.equal(answerLine({ englishMeaning: '  John Smith ' }), 'John Smith');
  });

  test('no English meaning gives the same words as the summary PDF', () => {
    assert.equal(answerLine({ englishMeaning: '', heardText: 'x' }), '(translation unavailable)');
    assert.equal(answerLine({}), MISSING_TRANSLATION);
  });

  test('a skipped or missing answer gives null (the field stays empty)', () => {
    assert.equal(answerLine({ skipped: true, englishMeaning: 'ignored' }), null);
    assert.equal(answerLine(undefined), null);
  });
});

describe('usableBox', () => {
  test('accepts four numbers 0..1000 that enclose an area', () => {
    assert.equal(usableBox([10, 20, 30, 40]), true);
    assert.equal(usableBox([0, 0, 1000, 1000]), true);
  });

  test('rejects null, wrong length, text, out of range, NaN and no area', () => {
    for (const box of [null, undefined, [], [1, 2, 3], [1, 2, 3, 4, 5], ['1', 2, 3, 4], [-1, 0, 5, 5], [0, 0, 5, 1001], [0, 0, NaN, 5], [10, 10, 10, 50], [10, 50, 40, 50], [40, 10, 10, 50]]) {
      assert.equal(usableBox(box), false, JSON.stringify(box));
    }
  });
});

describe('placeAnswers', () => {
  const fields = [
    { label: 'Name:', answerBox: [100, 100, 130, 500], page: 0 },
    { label: 'Address', answerBox: [200, 100, 260, 900], page: 1 },
    { label: 'No box', answerBox: null, page: 0 },
    { label: 'Skipped', answerBox: [300, 100, 330, 500], page: 0 },
    { label: 'Bad page', answerBox: [400, 100, 430, 500], page: 5 },
  ];
  const answers = [
    { englishMeaning: 'John Smith' },
    { englishMeaning: '12 High Street' },
    { englishMeaning: 'Blue' },
    { skipped: true },
    { englishMeaning: 'Green' },
  ];

  test('answers go to their page; the rest are unplaced with a clean label; skipped stays empty', () => {
    const { pages, unplaced } = placeAnswers(fields, answers, 2);
    assert.deepEqual(pages, [
      [{ index: 0, label: 'Name', type: 'text', text: 'John Smith', box: [100, 100, 130, 500], kind: undefined }],
      [{ index: 1, label: 'Address', type: 'text', text: '12 High Street', box: [200, 100, 260, 900], kind: undefined }],
    ]);
    assert.deepEqual(unplaced, [
      { index: 2, label: 'No box', text: 'Blue' },
      { index: 4, label: 'Bad page', text: 'Green' },
    ]);
    assert.equal(countPlaced({ pages, unplaced }), 2);
  });

  test('an answer without English text is still placed, with the PDF words', () => {
    const { pages } = placeAnswers([fields[0]], [{ englishMeaning: '' }], 1);
    assert.equal(pages[0][0].text, '(translation unavailable)');
  });

  test('a missing answer counts as skipped', () => {
    const { pages, unplaced } = placeAnswers(fields, [], 2);
    assert.equal(countPlaced({ pages, unplaced }), 0);
    assert.equal(unplaced.length, 0);
  });

  test('a field whose page is not a whole number is unplaced', () => {
    const { pages, unplaced } = placeAnswers([{ label: 'A', answerBox: [1, 1, 50, 50], page: 0.5 }, { label: 'B', answerBox: [1, 1, 50, 50] }], [{ englishMeaning: 'x' }, { englishMeaning: 'y' }], 1);
    assert.equal(countPlaced({ pages, unplaced }), 0);
    assert.equal(unplaced.length, 2);
  });

  test('property: every answered field is in exactly one place, nothing is lost', () => {
    const boxArb = fc.oneof(
      fc.constant(null),
      fc.constant([0, 0, 0, 0]),
      fc.tuple(fc.integer({ min: 0, max: 900 }), fc.integer({ min: 0, max: 900 }), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 100 })).map(([y, x, h, w]) => [y, x, y + h, x + w])
    );
    const fieldArb = fc.record({ label: fc.string(), answerBox: boxArb, page: fc.integer({ min: -1, max: 6 }) });
    const answerArb = fc.oneof(
      fc.constant(undefined),
      fc.constant({ skipped: true }),
      fc.record({ englishMeaning: fc.string() })
    );
    fc.assert(
      fc.property(fc.array(fc.tuple(fieldArb, answerArb), { maxLength: 15 }), fc.integer({ min: 0, max: 5 }), (pairs, pageCount) => {
        const fs = pairs.map(([f]) => f);
        const as = pairs.map(([, a]) => a);
        const { pages, unplaced } = placeAnswers(fs, as, pageCount);
        assert.equal(pages.length, pageCount);
        const answered = as.map((a, i) => (answerLine(a) === null ? -1 : i)).filter((i) => i !== -1);
        const seen = [...pages.flat().map((p) => p.index), ...unplaced.map((u) => u.index)].sort((a, b) => a - b);
        assert.deepEqual(seen, answered);
      }),
      { numRuns: 200 }
    );
  });
});

describe('filledPdfFilename', () => {
  test('{formName}_filled_{YYYY-MM-DD}.pdf', () => {
    assert.equal(filledPdfFilename('Bank_Form', new Date(2026, 10, 5)), 'Bank_Form_filled_2026-11-05.pdf');
  });
});

// ---------- fitAnswer ----------

// Every character is 0.5 of the font size wide.
const measureAt = (text, size) => text.length * size * 0.5;

describe('fitAnswer', () => {
  test('a short answer in a tall wide box is limited by maxSize (not by the box height)', () => {
    const result = fitAnswer({ text: 'John', boxW: 400, boxH: 100, measureAt, maxSize: 30 });
    assert.equal(result.size, 30);
    assert.deepEqual(result.lines, ['John']);
    assert.ok(result.fits);
  });

  test('a one-line answer in a thin box uses the box height at most', () => {
    const result = fitAnswer({ text: 'John', boxW: 400, boxH: 20, measureAt, maxSize: 50 });
    assert.equal(result.size, 20);
    assert.equal(result.lines.length, 1);
  });

  test('a long answer gets a smaller size so it fits, and then fits', () => {
    const text = 'x'.repeat(40); // 20 em wide
    const result = fitAnswer({ text, boxW: 200, boxH: 20, measureAt, maxSize: 20 });
    assert.equal(result.size, 10);
    assert.ok(result.fits);
    assert.ok(measureAt(result.lines[0], result.size) <= 200);
  });

  test('words are never split: the answer wraps between words when the box is high enough', () => {
    const text = 'alpha beta gamma delta';
    const result = fitAnswer({ text, boxW: 120, boxH: 60, measureAt, maxSize: 20 });
    assert.ok(result.fits);
    assert.equal(result.lines.join(' '), text);
    for (const line of result.lines) {
      for (const word of line.split(' ')) assert.ok(text.split(' ').includes(word), word);
    }
  });

  test('a word wider than the box stays whole at the smallest size and fits is false', () => {
    const result = fitAnswer({ text: 'internationalization', boxW: 30, boxH: 20, measureAt, maxSize: 20, minSize: 6 });
    assert.equal(result.size, 6);
    assert.deepEqual(result.lines, ['internationalization']);
    assert.equal(result.fits, false);
  });

  test('A- and A+ change the size by the scale; Auto (1) is the fitted size', () => {
    const base = fitAnswer({ text: 'John', boxW: 400, boxH: 100, measureAt, maxSize: 30 });
    const bigger = fitAnswer({ text: 'John', boxW: 400, boxH: 100, measureAt, maxSize: 30, scale: 1.15 });
    const smaller = fitAnswer({ text: 'John', boxW: 400, boxH: 100, measureAt, maxSize: 30, scale: 1 / 1.15 });
    assert.equal(bigger.size, Math.round(30 * 1.15));
    assert.equal(smaller.size, Math.round(30 / 1.15));
    assert.equal(bigger.auto, base.size);
    assert.equal(fitAnswer({ text: 'a', boxW: 5, boxH: 5, measureAt, scale: 0.01 }).size, 6); // never below the minimum
  });

  test('property: size is never below the minimum, and when fits is true nothing overflows', () => {
    fc.assert(
      fc.property(
        fc.array(fc.stringMatching(/^[a-z]{1,12}$/), { minLength: 1, maxLength: 8 }).map((w) => w.join(' ')),
        fc.integer({ min: 10, max: 500 }),
        fc.integer({ min: 4, max: 120 }),
        (text, boxW, boxH) => {
          const result = fitAnswer({ text, boxW, boxH, measureAt, maxSize: 60 });
          assert.ok(result.size >= 6);
          assert.equal(result.lines.join(' '), text); // nothing is lost or split
          if (result.fits) {
            assert.ok(result.lines.every((line) => measureAt(line, result.size) <= boxW + 0.5));
            const again = layoutAt({ text, boxW, boxH, measureAt, size: result.size });
            assert.ok(again.fits);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------- Shared page helpers ----------

describe('shared page helpers (moved to skeleton)', () => {
  test('splitDataUrl separates the type and the base64 text', () => {
    assert.deepEqual(splitDataUrl('data:image/jpeg;base64,QUJD'), { mimeType: 'image/jpeg', data: 'QUJD' });
    assert.deepEqual(splitDataUrl('data:image/png,AAAA'), { mimeType: 'image/png', data: 'AAAA' });
    assert.deepEqual(splitDataUrl('not a data url'), { mimeType: '', data: '' });
    assert.deepEqual(splitDataUrl(undefined), { mimeType: '', data: '' });
  });

  test('the Form Translator still exports the same helpers with the same results', () => {
    assert.deepEqual(limitPages(8), { count: 5, skipped: 3 });
    assert.equal(fitImageSize(4000, 2000).width, 2000);
    assert.equal(pdfPageSize(1000, 2000).height, 842);
  });

  test('boxToPixels turns an answer box into a rectangle inside the page', () => {
    assert.deepEqual(boxToPixels([100, 200, 130, 600], 1000, 2000), { x: 200, y: 200, w: 400, h: 60 });
  });
});

// ---------- A form that already has answers on it ----------

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

describe('boxHasInk: is something already written in the answer box?', () => {
  const RECT = { x: 40, y: 30, w: 200, h: 30 };

  test('an empty box is free', () => {
    assert.equal(boxHasInk(solid(300, 100), RECT), false);
  });

  test('printed text inside the box is found', () => {
    const image = solid(300, 100);
    // Four "letters" of a printed answer, 3 px wide and 12 px high, with gaps between them.
    for (let i = 0; i < 4; i++) paint(image, 60 + i * 8, 39, 3, 12, BLACK);
    assert.equal(boxHasInk(image, RECT), true);
  });

  test('light text on a dark box is found too', () => {
    const navy = { r: 26, g: 58, b: 122 };
    const image = solid(300, 100, navy);
    for (let i = 0; i < 4; i++) paint(image, 60 + i * 8, 39, 3, 12, WHITE);
    assert.equal(boxHasInk(image, RECT), true);
  });

  test('the border of the box and a line to write on do not count as text', () => {
    const image = solid(300, 100);
    paint(image, 40, 30, 200, 2, BLACK); // top border
    paint(image, 40, 58, 200, 2, BLACK); // bottom border
    paint(image, 40, 30, 2, 30, BLACK); // left border
    paint(image, 238, 30, 2, 30, BLACK); // right border
    assert.equal(boxHasInk(image, RECT), false);

    const line = solid(300, 100);
    paint(line, 40, 52, 200, 1, BLACK); // the line to write on, inside the box
    assert.equal(boxHasInk(line, RECT), false);
  });

  test('the dividers of a comb box (one cell per letter) are not text', () => {
    const image = solid(300, 100);
    for (let x = 40; x <= 240; x += 20) paint(image, x, 30, 1, 30, BLACK);
    assert.equal(boxHasInk(image, RECT), false);
  });

  test('a single speck or a very light mark is not text', () => {
    const image = solid(300, 100);
    paint(image, 100, 44, 1, 1, BLACK);
    assert.equal(boxHasInk(image, RECT), false);
    paint(image, 120, 40, 40, 10, { r: 245, g: 245, b: 245 });
    assert.equal(boxHasInk(image, RECT), false);
  });

  test('a box that is outside or too small never throws and is free', () => {
    assert.equal(boxHasInk(solid(50, 50), { x: 40, y: 40, w: 100, h: 100 }), false);
    assert.equal(boxHasInk(solid(50, 50), { x: 10, y: 10, w: 3, h: 3 }), false);
    assert.equal(boxHasInk(solid(50, 50), { x: -20, y: -20, w: 10, h: 10 }), false);
  });
});

describe('moveOccupied', () => {
  const fields = [
    { label: 'Name', answerBox: [100, 100, 130, 500], page: 0 },
    { label: 'City', answerBox: [200, 100, 230, 500], page: 0 },
    { label: 'Bank', answerBox: [100, 100, 130, 500], page: 1 },
    { label: 'No box', answerBox: null, page: 0 },
  ];
  const answers = [{ englishMeaning: 'John' }, { englishMeaning: 'Chennai' }, { englishMeaning: 'SBI' }, { englishMeaning: 'x' }];
  const placement = placeAnswers(fields, answers, 2);

  test('an answer whose box is filled moves to the unplaced list, in field order', () => {
    const result = moveOccupied(placement, [[false, true], [false]]);
    assert.deepEqual(result.pages[0].map((e) => e.text), ['John']);
    assert.deepEqual(result.pages[1].map((e) => e.text), ['SBI']);
    assert.deepEqual(result.unplaced, [
      { index: 1, label: 'City', text: 'Chennai' },
      { index: 3, label: 'No box', text: 'x' },
    ]);
  });

  test('nothing occupied changes nothing, and the input is not modified', () => {
    const result = moveOccupied(placement, [[false, false], [false]]);
    assert.deepEqual(result, placement);
    moveOccupied(placement, [[true, true], [true]]);
    assert.equal(countPlaced(placement), 3);
    assert.equal(placement.unplaced.length, 1);
  });

  test('everything occupied: all answers are listed and none is lost', () => {
    const result = moveOccupied(placement, [[true, true], [true]]);
    assert.equal(countPlaced(result), 0);
    assert.deepEqual(result.unplaced.map((e) => e.index), [0, 1, 2, 3]);
  });

  test('missing flags count as free', () => {
    const result = moveOccupied(placement, []);
    assert.deepEqual(result, placement);
  });
});
