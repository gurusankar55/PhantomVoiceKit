// writingLine.test.js
// "Fill the original form": lines to write on (solid, dashed, dotted, underscores) are not
// "text already there", the answer is written just ABOVE such a line (never on it), and codes
// use the keypad first. All images are made in memory: no browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  boxHasInk,
  rowIsRuled,
  findWritingLine,
  baselinesAboveLine,
  DESCENT_SHARE,
  LINE_GAP_PX,
} from '../../skeleton/form-overlay-utils.js';
import { isKeypadFirst } from '../../apps/spirit-clerk/answer-flow.js';

// An RGBA image of one colour, and a way to paint a rectangle on it.
const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };
const GREY = { r: 150, g: 150, b: 150 };
function solid(width, height, color = WHITE) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([color.r, color.g, color.b, 255], i * 4);
  return { data, width, height };
}
function paint(image, x, y, w, h, color = BLACK) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) image.data.set([color.r, color.g, color.b, 255], (py * image.width + px) * 4);
  }
}

// A row of repeated marks from x0 to x1: `mark` pixels of ink, then `gap` pixels of paper.
function marks(image, x0, x1, y, { mark, gap, thick = 1, color = BLACK }) {
  for (let x = x0; x + mark <= x1; x += mark + gap) paint(image, x, y, mark, thick, color);
}

// One row as 0 / 1 values: "##..##..".
const row = (text) => Array.from(text, (c) => (c === '#' ? 1 : 0));

// The answer box used below: 200 x 30 pixels.
const RECT = { x: 40, y: 30, w: 200, h: 30 };

describe('rowIsRuled: is one row of pixels a line to write on?', () => {
  test('a solid row is a solid line', () => {
    assert.equal(rowIsRuled(row('#'.repeat(100))), 'solid');
  });

  test('dashes, dots and underscores are a dashed line', () => {
    assert.equal(rowIsRuled(row('######....'.repeat(10))), 'dashed'); // dashes
    assert.equal(rowIsRuled(row('#...'.repeat(25))), 'dashed'); // dots
    assert.equal(rowIsRuled(row('##....'.repeat(16))), 'dashed'); // bigger dots
    assert.equal(rowIsRuled(row('######..'.repeat(12))), 'dashed'); // typed underscores "________"
    assert.equal(rowIsRuled(row('#######.'.repeat(12))), 'solid'); // underscores with tiny gaps: a line too
  });

  test('a few marks, a short run of marks or uneven marks are not a line', () => {
    assert.equal(rowIsRuled(row('######....'.repeat(3) + '.'.repeat(70))), null); // only 3 marks
    assert.equal(rowIsRuled(row('#...'.repeat(8) + '.'.repeat(68))), null); // marks on a third of the row only
    // A row through handwritten letters: marks and gaps of very different sizes.
    assert.equal(rowIsRuled(row('#..########...............##...#..............................#########....#')), null);
    assert.equal(rowIsRuled(row('.'.repeat(80))), null);
    assert.equal(rowIsRuled([]), null);
  });
});

describe('boxHasInk ignores dashed, dotted and underscore lines', () => {
  test('a dashed line in the box is not "already written"', () => {
    const image = solid(300, 100);
    marks(image, 40, 240, 50, { mark: 6, gap: 4 });
    assert.equal(boxHasInk(image, RECT), false);
  });

  test('a thick dashed line (2 and 3 pixels) is not "already written"', () => {
    for (const thick of [2, 3]) {
      const image = solid(300, 100);
      marks(image, 40, 240, 49, { mark: 8, gap: 5, thick });
      assert.equal(boxHasInk(image, RECT), false, `thickness ${thick}`);
    }
  });

  test('a dotted line (small and bigger dots) is not "already written"', () => {
    const small = solid(300, 100);
    marks(small, 40, 240, 50, { mark: 1, gap: 3 });
    assert.equal(boxHasInk(small, RECT), false);

    const big = solid(300, 100);
    marks(big, 40, 240, 49, { mark: 2, gap: 4, thick: 2 });
    assert.equal(boxHasInk(big, RECT), false);
  });

  test('a line of typed underscores (tiny gaps) is not "already written"', () => {
    const image = solid(300, 100);
    marks(image, 40, 240, 51, { mark: 7, gap: 1 });
    assert.equal(boxHasInk(image, RECT), false);
  });

  test('the soft grey edge just above a dashed line is not ink', () => {
    const image = solid(300, 100);
    marks(image, 40, 240, 50, { mark: 6, gap: 4, thick: 2 });
    // Grey specks above some of the dashes only (too few and too uneven to be a line themselves).
    for (const x of [50, 60, 70, 130, 140]) paint(image, x, 49, 3, 1, GREY);
    assert.equal(boxHasInk(image, RECT), false);
  });

  test('a dashed line in a grey box (dark paper) is not "already written"', () => {
    const paper = { r: 220, g: 220, b: 200 };
    const image = solid(300, 100, paper);
    marks(image, 40, 240, 50, { mark: 5, gap: 5 });
    assert.equal(boxHasInk(image, RECT), false);
  });

  test('text written above a dashed line IS found', () => {
    const image = solid(300, 100);
    marks(image, 40, 240, 52, { mark: 6, gap: 4 });
    for (let i = 0; i < 4; i++) paint(image, 60 + i * 8, 38, 3, 12); // four "letters"
    assert.equal(boxHasInk(image, RECT), true);
  });

  test('evenly spaced letters ("IIIIIIII") are many rows high, so they are text, not a dashed line', () => {
    const image = solid(300, 100);
    for (let x = 50; x < 230; x += 8) paint(image, x, 37, 2, 14);
    assert.equal(boxHasInk(image, RECT), true);
  });

  test('a solid line still counts as a line (as before)', () => {
    const image = solid(300, 100);
    paint(image, 40, 52, 200, 1);
    assert.equal(boxHasInk(image, RECT), false);
  });

  test('property: any regular dashed or dotted line alone is never "already written"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }), // mark length
        fc.integer({ min: 1, max: 8 }), // gap
        fc.integer({ min: 1, max: 3 }), // thickness
        fc.integer({ min: 37, max: 50 }), // where in the box
        (mark, gap, thick, y) => {
          const image = solid(300, 100);
          marks(image, 40, 240, y, { mark, gap, thick });
          return boxHasInk(image, RECT) === false;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('findWritingLine: the line the answer stands on', () => {
  test('a solid line near the bottom of the box', () => {
    const image = solid(300, 100);
    paint(image, 40, 55, 200, 1);
    assert.deepEqual(findWritingLine(image, RECT), { top: 55, bottom: 55 });
  });

  test('a dashed line and a dotted line', () => {
    const dashed = solid(300, 100);
    marks(dashed, 40, 240, 54, { mark: 6, gap: 4, thick: 2 });
    assert.deepEqual(findWritingLine(dashed, RECT), { top: 54, bottom: 55 });

    const dotted = solid(300, 100);
    marks(dotted, 40, 240, 56, { mark: 1, gap: 3 });
    assert.deepEqual(findWritingLine(dotted, RECT), { top: 56, bottom: 56 });
  });

  test('a line just below the box (the box is drawn above it) is found', () => {
    const image = solid(300, 100);
    marks(image, 40, 240, 63, { mark: 6, gap: 4 });
    assert.deepEqual(findWritingLine(image, RECT), { top: 63, bottom: 63 });
  });

  test('a line with letters already above it is still found', () => {
    const image = solid(300, 100);
    marks(image, 40, 240, 55, { mark: 6, gap: 4 });
    for (let i = 0; i < 4; i++) paint(image, 60 + i * 8, 40, 3, 12);
    assert.deepEqual(findWritingLine(image, RECT), { top: 55, bottom: 55 });
  });

  test('a closed box (a line at the top and at the bottom) has no writing line: the text is centred', () => {
    const image = solid(300, 100);
    paint(image, 40, 30, 200, 1);
    paint(image, 40, 59, 200, 1);
    paint(image, 40, 30, 1, 30);
    paint(image, 239, 30, 1, 30);
    assert.equal(findWritingLine(image, RECT), null);
  });

  test('an empty area, or one outside the page, has no line', () => {
    assert.equal(findWritingLine(solid(300, 100), RECT), null);
    assert.equal(findWritingLine(solid(50, 50), { x: 60, y: 60, w: 100, h: 30 }), null);
  });
});

describe('baselinesAboveLine: the text stands ABOVE the line, never on it', () => {
  test('one line: the lowest point of the letters is a few pixels above the line', () => {
    const [baseline] = baselinesAboveLine({ lineTop: 100, size: 20, lineCount: 1, lineHeight: 1.15 });
    assert.ok(baseline < 100);
    const lowest = baseline + 20 * DESCENT_SHARE; // the bottom of g, p, y
    assert.ok(lowest <= 100 - LINE_GAP_PX, `lowest ${lowest}`);
    assert.ok(100 - baseline <= 12, 'not floating far above the line');
  });

  test('several lines: the last one is just above the line, the others above it', () => {
    const baselines = baselinesAboveLine({ lineTop: 200, size: 16, lineCount: 3, lineHeight: 1.2 });
    assert.equal(baselines.length, 3);
    assert.ok(baselines[2] + 16 * DESCENT_SHARE <= 200 - LINE_GAP_PX);
    assert.ok(Math.abs(baselines[2] - baselines[1] - 16 * 1.2) < 1e-9);
    assert.ok(Math.abs(baselines[1] - baselines[0] - 16 * 1.2) < 1e-9);
  });

  test('property: for any size the letters never touch the line', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 3000 }),
        fc.integer({ min: 6, max: 80 }),
        fc.integer({ min: 1, max: 4 }),
        (lineTop, size, lineCount) => {
          const baselines = baselinesAboveLine({ lineTop, size, lineCount, lineHeight: 1.15 });
          const last = baselines[baselines.length - 1];
          return baselines.length === lineCount && last + size * DESCENT_SHARE <= lineTop - LINE_GAP_PX;
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('isKeypadFirst: codes and account numbers are typed on the keypad first', () => {
  test('every code kind (PAN, IFSC, GSTIN, passport...) is keypad-first', () => {
    assert.equal(isKeypadFirst({ kind: 'code', pattern: 'AAAAA9999A' }, 'PAN'), true);
    assert.equal(isKeypadFirst({ kind: 'code', pattern: 'AAAA0XXXXXX' }, 'IFSC Code'), true);
    assert.equal(isKeypadFirst({ kind: 'code', pattern: '' }, 'Passport number'), true);
  });

  test('bank account numbers are keypad-first', () => {
    assert.equal(isKeypadFirst({ kind: 'number' }, 'Account Number'), true);
    assert.equal(isKeypadFirst({ kind: 'number' }, 'Bank A/c No.'), true);
    assert.equal(isKeypadFirst({ kind: 'number' }, 'Savings acct no'), true);
  });

  test('phone, PIN, Aadhaar and other fields stay voice-first', () => {
    assert.equal(isKeypadFirst({ kind: 'phone', pattern: '9999999999' }, 'Mobile number'), false);
    assert.equal(isKeypadFirst({ kind: 'number', pattern: '999999' }, 'PIN code'), false);
    assert.equal(isKeypadFirst({ kind: 'number', pattern: '999999999999' }, 'Aadhaar number'), false);
    assert.equal(isKeypadFirst({ kind: 'number' }, 'Permanent Account Number'), false);
    assert.equal(isKeypadFirst({ kind: 'name' }, 'Account holder name'), false);
    assert.equal(isKeypadFirst({ kind: 'date' }, 'Date of birth'), false);
  });
});
