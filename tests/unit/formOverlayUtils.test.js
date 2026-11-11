// tests/unit/formOverlayUtils.test.js
// Unit tests for the pure overlay helpers in skeleton/form-overlay-utils.js
// (box conversion, wrapping, font fitting, colour sampling, reading order).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  boxToPixels,
  wrapText,
  fitText,
  clampOffset,
  scaleFromOffset,
  sampleBackground,
  readableTextColor,
  textHeight,
  contrastRatio,
  sampleDarkest,
  chooseTextColor,
  coverPadding,
  coverRect,
  isSameText,
  readingOrder,
} from '../../skeleton/form-overlay-utils.js';

// A fake "font": every character is `size` pixels wide (easy to reason about).
const measureAt = (text, size) => Array.from(text).length * size;

// Build an RGBA image of one colour.
function solidImage(width, height, [r, g, b, a = 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.set([r, g, b, a], i * 4);
  }
  return { data, width, height };
}

// Paint a rectangle on an image.
function paint(image, x0, y0, w, h, [r, g, b]) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      image.data.set([r, g, b, 255], (y * image.width + x) * 4);
    }
  }
}

describe('boxToPixels', () => {
  test('converts a 0-1000 box to pixels', () => {
    // [ymin, xmin, ymax, xmax] on a 2000 x 1000 image
    assert.deepEqual(boxToPixels([100, 250, 300, 750], 2000, 1000), { x: 500, y: 100, w: 1000, h: 200 });
  });

  test('a full-page box covers the whole image', () => {
    assert.deepEqual(boxToPixels([0, 0, 1000, 1000], 640, 480), { x: 0, y: 0, w: 640, h: 480 });
  });

  test('values outside the image are moved inside it', () => {
    const r = boxToPixels([-50, -50, 1200, 1200], 100, 100);
    assert.deepEqual(r, { x: 0, y: 0, w: 100, h: 100 });
  });

  test('a tiny box is at least 1 px wide and high', () => {
    const r = boxToPixels([500, 500, 500, 500], 100, 100);
    assert.equal(r.w, 1);
    assert.equal(r.h, 1);
  });

  test('property: the rectangle always lies inside the image', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -200, max: 1200 }), { minLength: 4, maxLength: 4 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 4000 }),
        (box, width, height) => {
          const r = boxToPixels(box, width, height);
          return r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= width && r.y + r.h <= height;
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('wrapText', () => {
  test('keeps short text on one line', () => {
    assert.deepEqual(wrapText('hello world', 100, (s) => s.length), ['hello world']);
  });

  test('wraps at spaces', () => {
    assert.deepEqual(wrapText('aaa bbb ccc', 7, (s) => s.length), ['aaa bbb', 'ccc']);
  });

  test('breaks a word that is wider than the box', () => {
    assert.deepEqual(wrapText('abcdefghij', 4, (s) => s.length), ['abcd', 'efgh', 'ij']);
  });

  test('breaks text without spaces (Chinese) between characters', () => {
    assert.deepEqual(wrapText('你好世界你好', 4, (s) => s.length), ['你好世界', '你好']);
  });

  test('keeps a Tamil consonant with its vowel sign when breaking', () => {
    // "கொ" is one letter made of 2-3 code points; it must never be split.
    const lines = wrapText('கொகொகொ', 2, (s) => Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)).length);
    assert.deepEqual(lines, ['கொகொ', 'கொ']);
  });

  test('respects line breaks and returns no lines for empty text', () => {
    assert.deepEqual(wrapText('a\nb', 10, (s) => s.length), ['a', 'b']);
    assert.deepEqual(wrapText('   ', 10, (s) => s.length), []);
  });

  test('a single character wider than the box does not loop forever', () => {
    assert.deepEqual(wrapText('abc', 0, () => 5), ['a', 'b', 'c']);
  });
});

describe('fitText', () => {
  test('picks the largest size that fits one line', () => {
    // 5 characters, each `size` wide, in a 100 x 40 box: width allows size 20, height allows 33.
    const fit = fitText({ text: 'Hello', boxW: 100, boxH: 40, measureAt });
    assert.equal(fit.size, 20);
    assert.deepEqual(fit.lines, ['Hello']);
    assert.equal(fit.fits, true);
  });

  test('wraps onto more lines when that allows a bigger size', () => {
    const fit = fitText({ text: 'aaaa bbbb', boxW: 40, boxH: 60, measureAt });
    assert.ok(fit.lines.length >= 2);
    assert.ok(fit.fits);
    assert.ok(textHeight(fit.lines.length, fit.size, fit.lineHeight) <= 60);
  });

  test('never goes below the minimum size, and says when it does not fit', () => {
    const fit = fitText({ text: 'a very long text that cannot fit', boxW: 20, boxH: 8, measureAt, minSize: 6 });
    assert.equal(fit.size, 6);
    assert.equal(fit.fits, false);
  });

  test('one line uses the FULL height of the box', () => {
    // Short text, wide box: only the height limits the size, so the size equals the box height.
    assert.equal(fitText({ text: 'Hi', boxW: 400, boxH: 30, measureAt }).size, 30);
    assert.equal(fitText({ text: 'Hi', boxW: 400, boxH: 47, measureAt }).size, 47);
  });

  test('textHeight: first line = size, every further line adds one line height', () => {
    assert.equal(textHeight(0, 20, 1.15), 0);
    assert.equal(textHeight(1, 20, 1.15), 20);
    assert.equal(textHeight(3, 20, 1.5), 20 + 2 * 30);
  });

  test('scale makes the text bigger or smaller than auto', () => {
    const base = fitText({ text: 'Hello', boxW: 100, boxH: 40, measureAt });
    const big = fitText({ text: 'Hello', boxW: 100, boxH: 40, measureAt, scale: 1.5 });
    const small = fitText({ text: 'Hello', boxW: 100, boxH: 40, measureAt, scale: 0.5 });
    assert.equal(big.size, Math.round(base.size * 1.5));
    assert.equal(small.size, Math.round(base.size * 0.5));
  });

  test('property: when it says "fits", the wrapped text really fits', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 60 }),
        fc.integer({ min: 10, max: 400 }),
        fc.integer({ min: 10, max: 300 }),
        (text, boxW, boxH) => {
          const fit = fitText({ text, boxW, boxH, measureAt });
          if (!fit.fits) return fit.size >= 6;
          return textHeight(fit.lines.length, fit.size, fit.lineHeight) <= boxH && fit.size >= 6;
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('A- / A+ offset', () => {
  test('0 (Auto) is exactly 1', () => {
    assert.equal(scaleFromOffset(0), 1);
  });

  test('plus is bigger and minus is smaller', () => {
    assert.ok(scaleFromOffset(1) > 1);
    assert.ok(scaleFromOffset(-1) < 1);
    assert.ok(scaleFromOffset(2) > scaleFromOffset(1));
  });

  test('the offset is limited to -6..6 and bad values become 0', () => {
    assert.equal(clampOffset(99), 6);
    assert.equal(clampOffset(-99), -6);
    assert.equal(clampOffset(2.4), 2);
    assert.equal(clampOffset(NaN), 0);
    assert.equal(clampOffset('x'), 0);
    assert.equal(scaleFromOffset(99), scaleFromOffset(6));
  });
});

describe('sampleBackground', () => {
  test('returns the colour around the box', () => {
    const image = solidImage(50, 50, [250, 240, 200]);
    assert.deepEqual(sampleBackground(image, { x: 20, y: 20, w: 10, h: 10 }), { r: 250, g: 240, b: 200 });
  });

  test('ignores the text inside the box', () => {
    const image = solidImage(50, 50, [255, 255, 255]);
    paint(image, 20, 20, 10, 10, [0, 0, 0]); // black "text" inside the box
    assert.deepEqual(sampleBackground(image, { x: 20, y: 20, w: 10, h: 10 }), { r: 255, g: 255, b: 255 });
  });

  test('a few dark pixels from a neighbour do not change the median', () => {
    const image = solidImage(50, 50, [200, 220, 255]);
    paint(image, 17, 17, 2, 2, [0, 0, 0]); // stray dark pixels in the ring
    assert.deepEqual(sampleBackground(image, { x: 20, y: 20, w: 10, h: 10 }), { r: 200, g: 220, b: 255 });
  });

  test('works for a box at the image edge', () => {
    const image = solidImage(30, 30, [10, 20, 30]);
    assert.deepEqual(sampleBackground(image, { x: 0, y: 0, w: 30, h: 30 }), { r: 255, g: 255, b: 255 }); // nothing around it
    assert.deepEqual(sampleBackground(image, { x: 0, y: 0, w: 10, h: 10 }), { r: 10, g: 20, b: 30 });
  });

  test('ignores see-through pixels', () => {
    const image = solidImage(30, 30, [10, 20, 30, 0]);
    assert.deepEqual(sampleBackground(image, { x: 10, y: 10, w: 5, h: 5 }), { r: 255, g: 255, b: 255 });
  });
});

describe('readableTextColor', () => {
  test('dark text on light backgrounds, white text on dark ones', () => {
    assert.equal(readableTextColor({ r: 255, g: 255, b: 255 }), '#000000');
    assert.equal(readableTextColor({ r: 250, g: 240, b: 200 }), '#000000');
    assert.equal(readableTextColor({ r: 0, g: 0, b: 0 }), '#ffffff');
    assert.equal(readableTextColor({ r: 20, g: 30, b: 90 }), '#ffffff');
  });
});

describe('readingOrder', () => {
  const block = (name, box_2d) => ({ name, box_2d });

  test('sorts rows top to bottom and each row left to right', () => {
    const blocks = [
      block('c', [300, 500, 340, 900]),
      block('b', [100, 500, 140, 900]),
      block('a', [102, 50, 142, 400]),
    ];
    assert.deepEqual(readingOrder(blocks).map((b) => b.name), ['a', 'b', 'c']);
  });

  test('does not change the original array', () => {
    const blocks = [block('b', [500, 0, 540, 100]), block('a', [0, 0, 40, 100])];
    readingOrder(blocks);
    assert.deepEqual(blocks.map((b) => b.name), ['b', 'a']);
  });

  test('handles an empty list', () => {
    assert.deepEqual(readingOrder([]), []);
  });
});

describe('coverPadding and coverRect', () => {
  test('padding is 20% of the box height, at least 3 px', () => {
    assert.equal(coverPadding({ x: 0, y: 0, w: 100, h: 50 }), 10);
    assert.equal(coverPadding({ x: 0, y: 0, w: 100, h: 20 }), 4);
    assert.equal(coverPadding({ x: 0, y: 0, w: 100, h: 10 }), 3); // 2 would be too little
    assert.equal(coverPadding({ x: 0, y: 0, w: 100, h: 1 }), 3);
  });

  test('the cover is bigger than the box on every side', () => {
    const box = { x: 100, y: 100, w: 200, h: 50 };
    assert.deepEqual(coverRect(box, 1000, 1000), { x: 90, y: 90, w: 220, h: 70 });
  });

  test('the cover stays inside the image', () => {
    assert.deepEqual(coverRect({ x: 0, y: 0, w: 100, h: 50 }, 105, 55), { x: 0, y: 0, w: 105, h: 55 });
    assert.deepEqual(coverRect({ x: 5, y: 40, w: 90, h: 10 }, 100, 52), { x: 2, y: 37, w: 96, h: 15 });
  });

  test('property: the cover always contains the box and lies inside the image', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 1, max: 400 }), fc.integer({ min: 1, max: 400 }),
        (x, y, w, h) => {
          const imageW = x + w + 10;
          const imageH = y + h + 10;
          const c = coverRect({ x, y, w, h }, imageW, imageH);
          return c.x <= x && c.y <= y && c.x + c.w >= x + w && c.y + c.h >= y + h &&
            c.x >= 0 && c.y >= 0 && c.x + c.w <= imageW && c.y + c.h <= imageH;
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('contrastRatio', () => {
  test('black on white is 21, identical colours are 1', () => {
    assert.ok(Math.abs(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }) - 21) < 0.01);
    assert.equal(contrastRatio({ r: 90, g: 90, b: 90 }, { r: 90, g: 90, b: 90 }), 1);
  });

  test('is the same in both directions', () => {
    const a = { r: 10, g: 200, b: 30 };
    const b = { r: 240, g: 240, b: 10 };
    assert.equal(contrastRatio(a, b), contrastRatio(b, a));
  });
});

describe('sampleDarkest', () => {
  test('finds the colour of the letters inside the box', () => {
    const image = solidImage(60, 40, [255, 255, 255]);
    paint(image, 12, 12, 20, 6, [200, 0, 0]); // dark red "text" inside the box
    const rect = { x: 10, y: 10, w: 40, h: 20 };
    assert.deepEqual(sampleDarkest(image, rect), { r: 200, g: 0, b: 0 });
  });

  test('averages only the darkest pixels, not the white background', () => {
    const image = solidImage(60, 40, [250, 250, 250]);
    paint(image, 12, 12, 20, 4, [20, 20, 20]);
    const c = sampleDarkest(image, { x: 10, y: 10, w: 40, h: 20 });
    assert.ok(c.r <= 30 && c.g <= 30 && c.b <= 30);
  });

  test('returns null when there is nothing to read', () => {
    assert.equal(sampleDarkest(solidImage(20, 20, [10, 10, 10, 0]), { x: 2, y: 2, w: 5, h: 5 }), null);
    assert.equal(sampleDarkest(solidImage(20, 20, [10, 10, 10]), { x: 50, y: 50, w: 5, h: 5 }), null);
  });
});

describe('chooseTextColor', () => {
  const white = { r: 255, g: 255, b: 255 };
  const navy = { r: 26, g: 58, b: 122 };

  test('uses the colour of the original text when it has enough contrast', () => {
    assert.equal(chooseTextColor({ r: 20, g: 20, b: 120 }, white), 'rgb(20, 20, 120)');
  });

  test('pure black on a light background when the original colour is too faint', () => {
    assert.equal(chooseTextColor({ r: 200, g: 200, b: 200 }, white), '#000000');
  });

  test('pure white on a dark background (light text on a dark bar)', () => {
    // inside the box the darkest pixels are the bar itself: no contrast with the bar
    assert.equal(chooseTextColor(navy, navy), '#ffffff');
  });

  test('pure black or white when the original colour is unknown', () => {
    assert.equal(chooseTextColor(null, white), '#000000');
    assert.equal(chooseTextColor(null, navy), '#ffffff');
  });

  test('property: the result is opaque and always has good contrast', () => {
    const channel = fc.integer({ min: 0, max: 255 });
    const colour = fc.record({ r: channel, g: channel, b: channel });
    const parse = (css) => {
      if (css === '#000000') return { r: 0, g: 0, b: 0 };
      if (css === '#ffffff') return { r: 255, g: 255, b: 255 };
      const [r, g, b] = css.match(/\d+/g).map(Number);
      return { r, g, b };
    };
    fc.assert(
      fc.property(fc.option(colour, { nil: null }), colour, (darkest, background) => {
        const css = chooseTextColor(darkest, background);
        if (!/^(#000000|#ffffff|rgb\(\d+, \d+, \d+\))$/.test(css)) return false; // no alpha, no grey names
        // black or white are the best choice there is, so they are always accepted
        return css.startsWith('#') || contrastRatio(parse(css), background) >= 4.5;
      }),
      { numRuns: 300 }
    );
  });
});

describe('isSameText (names, numbers and codes are left untouched)', () => {
  test('same text after trimming and ignoring case', () => {
    assert.equal(isSameText('John', 'John'), true);
    assert.equal(isSameText('John', ' john '), true);
    assert.equal(isSameText('DOE', 'doe'), true);
    assert.equal(isSameText('SBIN0001234', 'sbin0001234'), true);
    assert.equal(isSameText('12/03/1990', '12/03/1990'), true);
    assert.equal(isSameText('A  B', 'a b'), true); // extra inner spaces
  });

  test('different text is redrawn', () => {
    assert.equal(isSameText('First name', 'முதல் பெயர்'), false);
    assert.equal(isSameText('Submit', 'Enviar'), false);
    assert.equal(isSameText('John', 'John Doe'), false);
  });

  test('an unknown or blank original is never "the same"', () => {
    assert.equal(isSameText('', ''), false);
    assert.equal(isSameText('   ', '   '), false);
    assert.equal(isSameText(undefined, 'x'), false);
    assert.equal(isSameText(null, null), false);
  });
});
