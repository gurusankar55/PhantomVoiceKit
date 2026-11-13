// polish.test.js
// Spirit Clerk polish: names in Title Case, the code keypad (fixed characters, next box, delete),
// edit keeps the earlier answer, answers sized from the printed label, and the signature placement.
// Pure functions only: no browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { finalAnswer, previousAnswerValue } from '../../apps/spirit-clerk/form-utils.js';
import {
  parsePattern,
  emptyValues,
  valuesToString,
  fillFrom,
  typeKey,
  deleteKey,
  cursorCell,
} from '../../skeleton/field-formats.js';
import {
  measureLabelHeight,
  answerSizeFromLabel,
  signaturePlacement,
  signatureThickenRadius,
  thickenOffsets,
  LABEL_INK_SHARE,
  ANSWER_LABEL_SHARE,
  ANSWER_LABEL_MIN_SHARE,
  SIGNATURE_LINE_GAP_PX,
  SIGNATURE_MIN_STROKE_PX,
  PAD_STROKE_PX,
} from '../../skeleton/form-overlay-utils.js';

const IFSC = parsePattern('AAAA0XXXXXX');
const PAN = parsePattern('AAAAA9999A');

// Press keys one after the other from the cursor, like the on-screen keypad.
function typeAll(cells, keys, start = 0, values = emptyValues(cells)) {
  let state = { values, cursor: start };
  for (const key of keys) state = typeKey(state.values, cells, state.cursor, key);
  return state;
}

// ---------------------------------------------------------------------------
// 3. Names in Title Case
// ---------------------------------------------------------------------------

describe('finalAnswer: the kept answer (typed or spoken)', () => {
  test('a name typed in English becomes Title Case', () => {
    assert.equal(finalAnswer('ravi kumar', 'name'), 'Ravi Kumar');
    assert.equal(finalAnswer('  RAVI KUMAR ', 'name'), 'Ravi Kumar');
    assert.equal(finalAnswer('mary-ann o\'neil', 'name'), "Mary-Ann O'Neil");
  });

  test('an e-mail is lower case; other kinds are only trimmed', () => {
    assert.equal(finalAnswer(' Ravi@Gmail.COM ', 'email'), 'ravi@gmail.com');
    assert.equal(finalAnswer(' ravi kumar ', 'text'), 'ravi kumar');
    assert.equal(finalAnswer('SBIN0001234', 'code'), 'SBIN0001234');
    assert.equal(finalAnswer('chennai', 'address'), 'chennai');
  });

  test('a name in a script without capitals is unchanged', () => {
    assert.equal(finalAnswer('ரவி குமார்', 'name'), 'ரவி குமார்');
  });

  test('property: a kept name is already in Title Case (doing it again changes nothing)', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = finalAnswer(s, 'name');
        return finalAnswer(once, 'name') === once;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Edit keeps the earlier answer
// ---------------------------------------------------------------------------

describe('previousAnswerValue: what goes back in the box when an answer is edited', () => {
  test('the kept English answer, or the signature picture', () => {
    assert.equal(previousAnswerValue({ englishMeaning: 'Ravi Kumar' }), 'Ravi Kumar');
    assert.equal(previousAnswerValue({ englishMeaning: '13/05/1987' }), '13/05/1987');
    assert.equal(previousAnswerValue({ englishMeaning: '(signature)', signatureImage: 'data:image/png;base64,AAA' }), 'data:image/png;base64,AAA');
  });

  test('nothing for a skipped, missing or empty answer', () => {
    assert.equal(previousAnswerValue(undefined), null);
    assert.equal(previousAnswerValue({ skipped: true, englishMeaning: 'x' }), null);
    assert.equal(previousAnswerValue({ englishMeaning: '   ' }), null);
  });
});

// ---------------------------------------------------------------------------
// 4. The code keypad
// ---------------------------------------------------------------------------

describe('typeKey: the keypad cursor', () => {
  test('typing the whole IFSC "SBIN0001234" works: the fixed 0 is stepped over, not shifted', () => {
    const { values, cursor } = typeAll(IFSC, Array.from('SBIN0001234'));
    assert.equal(valuesToString(values), 'SBIN0001234');
    assert.equal(cursor, IFSC.length);
  });

  test('a different key on the fixed cell goes into the next box', () => {
    const { values, cursor } = typeAll(IFSC, Array.from('SBINA'));
    assert.equal(valuesToString(values), 'SBIN0A');
    assert.equal(cursor, 6);
  });

  test('a tapped box that is replaced moves the cursor to the NEXT box, not to the end', () => {
    const full = typeAll(PAN, Array.from('ABCDE1234F')).values;
    const replaced = typeKey(full, PAN, 2, 'X'); // tap box 3 and press X
    assert.equal(valuesToString(replaced.values), 'ABXDE1234F');
    assert.equal(replaced.cursor, 3);
    assert.equal(cursorCell(PAN, replaced.cursor), 3);
  });

  test('at the end nothing changes; a key that is not a letter or digit is ignored', () => {
    const full = typeAll(PAN, Array.from('ABCDE1234F'));
    assert.deepEqual(typeKey(full.values, PAN, full.cursor, 'Z'), { values: full.values, cursor: PAN.length });
    assert.deepEqual(typeKey(full.values, PAN, 0, '-'), { values: full.values, cursor: 0 });
  });

  test('cursorCell: a fixed cell highlights the next box; the end has no box', () => {
    assert.equal(cursorCell(IFSC, 4), 5);
    assert.equal(cursorCell(IFSC, 0), 0);
    assert.equal(cursorCell(IFSC, IFSC.length), -1);
  });
});

describe('deleteKey: the ⌫ key', () => {
  test('on a filled box: clears it and stays', () => {
    const full = typeAll(PAN, Array.from('ABCDE1234F')).values;
    const result = deleteKey(full, PAN, 3);
    assert.equal(valuesToString(result.values), 'ABCE1234F');
    assert.equal(result.values[3], '');
    assert.equal(result.cursor, 3);
  });

  test('on an empty box: moves back one box and clears it (like a backspace)', () => {
    const state = typeAll(PAN, Array.from('ABC')); // cursor on box 4 (empty)
    const result = deleteKey(state.values, PAN, state.cursor);
    assert.equal(valuesToString(result.values), 'AB');
    assert.equal(result.cursor, 2);
  });

  test('at the end: clears the last box', () => {
    const state = typeAll(PAN, Array.from('ABCDE1234F'));
    const result = deleteKey(state.values, PAN, state.cursor);
    assert.equal(valuesToString(result.values), 'ABCDE1234');
    assert.equal(result.cursor, PAN.length - 1);
  });

  test('going back steps over the fixed 0 of IFSC and never clears it', () => {
    const state = typeAll(IFSC, Array.from('SBIN0')); // the cursor is on box 5, just after the fixed 0
    assert.equal(state.cursor, 5);
    const result = deleteKey(state.values, IFSC, state.cursor);
    assert.equal(valuesToString(result.values), 'SBI0');
    assert.equal(result.values[4], '0');
    assert.equal(result.cursor, 3);
  });

  test('on the first, empty box nothing breaks', () => {
    const result = deleteKey(emptyValues(PAN), PAN, 0);
    assert.equal(valuesToString(result.values), '');
    assert.equal(result.cursor, 0);
  });

  test('property: typing then deleting as often always ends empty, and fixed cells stay', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...'ABCDEFGHIJ0123456789'), { maxLength: 14 }), (keys) => {
        let state = typeAll(IFSC, keys);
        for (let i = 0; i < 20; i++) state = deleteKey(state.values, IFSC, state.cursor);
        return valuesToString(state.values) === '0' && state.values[4] === '0';
      }),
      { numRuns: 100 }
    );
  });
});

describe('fillFrom: spoken codes follow the same fixed-character rule', () => {
  test('the whole IFSC said with its 0 is not shifted', () => {
    assert.equal(valuesToString(fillFrom(emptyValues(IFSC), IFSC, 0, 'SBIN0001234').values), 'SBIN0001234');
    assert.equal(valuesToString(fillFrom(emptyValues(IFSC), IFSC, 0, 'S B I N 0 0 0 1 2 3 4').values), 'SBIN0001234');
  });

  test('without the 0 (exactly the boxes to fill) the fixed cell is skipped, as before', () => {
    assert.equal(valuesToString(fillFrom(emptyValues(IFSC), IFSC, 0, 'SBIN001234').values), 'SBIN0001234');
  });
});

// ---------------------------------------------------------------------------
// 1. Answer size from the printed label
// ---------------------------------------------------------------------------

// A fake measure: every character is half the font size wide.
const measureAt = (s, size) => s.length * size * 0.5;

describe('answerSizeFromLabel: about 85% of the label, never below 70%', () => {
  test('the label size is its ink height / 0.7 (so answers come out close to the label size)', () => {
    assert.equal(LABEL_INK_SHARE, 0.7);
  });

  test('a short answer gets 85% of the label size', () => {
    const labelHeight = 14; // ink height in pixels: the label size is 14 / 0.7 = 20
    const result = answerSizeFromLabel({ text: 'Ravi Kumar', labelHeight, boxW: 600, measureAt });
    assert.equal(result.size, 17); // 85% of 20
    assert.equal(result.size, Math.round((labelHeight / LABEL_INK_SHARE) * ANSWER_LABEL_SHARE));
    assert.deepEqual(result.lines, ['Ravi Kumar']);
    assert.equal(result.fits, true);
  });

  test('a longer answer shrinks only down to 70%, then wraps', () => {
    const labelHeight = 14; // label size 20: from 17 down to 14
    // 20 characters: at size 17 it is 170 px, at 16 it is 160 px.
    const shrunk = answerSizeFromLabel({ text: 'abcdefghij klmnopqrs', labelHeight, boxW: 160, measureAt });
    assert.equal(shrunk.size, 16);
    assert.equal(shrunk.lines.length, 1);

    const wrapped = answerSizeFromLabel({ text: 'abcdefghij klmnopqrs tuvwxyz', labelHeight, boxW: 160, measureAt });
    assert.equal(wrapped.size, 14); // 70% of 20
    assert.equal(wrapped.size, Math.round((labelHeight / LABEL_INK_SHARE) * ANSWER_LABEL_MIN_SHARE));
    assert.ok(wrapped.lines.length >= 2);
  });

  test('inside a closed box the box height wins', () => {
    const result = answerSizeFromLabel({ text: 'Ravi', labelHeight: 14, boxW: 600, measureAt, maxHeight: 12 });
    assert.equal(result.size, 12);
  });

  test('A- / A+ scale the label size', () => {
    const result = answerSizeFromLabel({ text: 'Ravi', labelHeight: 14, boxW: 600, measureAt, scale: 1.2 });
    assert.equal(result.size, Math.round(20 * 0.85 * 1.2));
  });

  test('no usable label height: null (the old fitting is used)', () => {
    assert.equal(answerSizeFromLabel({ text: 'Ravi', labelHeight: null, boxW: 600, measureAt }), null);
    assert.equal(answerSizeFromLabel({ text: 'Ravi', labelHeight: 0, boxW: 600, measureAt }), null);
  });

  test('property: the size is between 70% and 85% of the label size (no cap)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 8, max: 80 }),
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.integer({ min: 50, max: 1200 }),
        (labelHeight, text, boxW) => {
          const labelSize = labelHeight / LABEL_INK_SHARE;
          const { size } = answerSizeFromLabel({ text, labelHeight, boxW, measureAt });
          return size <= Math.round(labelSize * ANSWER_LABEL_SHARE) && size >= Math.round(labelSize * ANSWER_LABEL_MIN_SHARE);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// In-memory RGBA images.
function solid(width, height) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { data, width, height };
}
function paint(image, x, y, w, h) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) image.data.set([0, 0, 0, 255], (py * image.width + px) * 4);
  }
}

describe('measureLabelHeight: the printed label on the same row', () => {
  test('a label to the left of the area, with a dashed line under it', () => {
    const image = solid(500, 120);
    for (let x = 60; x < 180; x += 9) paint(image, x, 45, 6, 12); // "letters" 12 px high
    for (let x = 0; x < 500; x += 10) paint(image, x, 60, 6, 1); // the dashed line
    assert.equal(measureLabelHeight(image, { x: 200, y: 40, w: 200, h: 30 }), 12);
  });

  test('a label just above the area (nothing to the left)', () => {
    const image = solid(500, 120);
    for (let x = 110; x < 200; x += 9) paint(image, x, 30, 6, 14);
    assert.equal(measureLabelHeight(image, { x: 100, y: 60, w: 200, h: 30 }), 14);
  });

  test('no label: null', () => {
    assert.equal(measureLabelHeight(solid(500, 120), { x: 200, y: 40, w: 200, h: 30 }), null);
  });
});

// ---------------------------------------------------------------------------
// 2. The signature on the original form
// ---------------------------------------------------------------------------

describe('signaturePlacement: big, above the line, shape kept', () => {
  const rect = { x: 100, y: 200, w: 400, h: 40 };

  test('up to 2x the label height, its bottom a few pixels above the line', () => {
    const place = signaturePlacement({ imageW: 300, imageH: 100, rect, lineTop: 236, labelHeight: 18 });
    assert.ok(place.h <= 2 * 18 + 1e-9);
    assert.ok(place.h >= 1.5 * 18 - 1e-9, `height ${place.h}`);
    assert.ok(place.y + place.h <= 236 - SIGNATURE_LINE_GAP_PX + 1e-9);
    assert.ok(Math.abs(place.w / place.h - 3) < 1e-9, 'shape kept');
    assert.ok(place.w <= rect.w);
  });

  test('a wide signature is limited by the width of the area', () => {
    const place = signaturePlacement({ imageW: 2000, imageH: 100, rect, lineTop: 236, labelHeight: 18 });
    assert.ok(place.w <= rect.w * 0.96 + 1e-9);
    assert.ok(Math.abs(place.w / place.h - 20) < 1e-9);
  });

  test('no line and no label: most of the area', () => {
    const place = signaturePlacement({ imageW: 100, imageH: 100, rect });
    assert.ok(place.h >= rect.h * 0.8);
    assert.ok(place.y >= rect.y && place.y + place.h <= rect.y + rect.h);
  });

  test('strokes are thickened to at least 2.5 px', () => {
    const scale = 0.3; // 3.2 px strokes become 0.96 px
    const radius = signatureThickenRadius(scale);
    assert.ok(PAD_STROKE_PX * scale + 2 * radius >= SIGNATURE_MIN_STROKE_PX - 1e-9);
    assert.equal(signatureThickenRadius(1), 0); // already thick enough
    assert.deepEqual(thickenOffsets(0), [{ dx: 0, dy: 0 }]);
    const offsets = thickenOffsets(radius);
    assert.ok(offsets.length >= 9);
    assert.ok(offsets.every(({ dx, dy }) => Math.hypot(dx, dy) <= radius + 1e-9));
  });
});
