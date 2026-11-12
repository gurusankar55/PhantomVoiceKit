// tests/unit/formOverlayScan.test.js
// Pure functions that scan pixels: leftover ink around a cover (growCover), free space next to
// a box (findFreeWidth), the text area, the short version and the "leave untouched" rule.
// All images are made in memory, so no browser and no network are needed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  insetRect,
  growCover,
  findFreeWidth,
  textArea,
  sampleInkColor,
  stripHasLine,
  colorDistance,
  estimateOriginalSize,
  leaveUntouched,
  coverRect,
} from '../../skeleton/form-overlay-utils.js';

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

// An RGBA image of one colour.
function solid(width, height, { r, g, b }) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([r, g, b, 255], i * 4);
  return { data, width, height };
}

// Paint a rectangle.
function paint(image, x0, y0, w, h, { r, g, b }) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) image.data.set([r, g, b, 255], (y * image.width + x) * 4);
  }
}

// A label box 60 x 12 px at (50, 30). Its first cover is the box plus 3 px on every side.
const RECT = { x: 50, y: 30, w: 60, h: 12 };
const grow = (image, extra = {}) =>
  growCover({ image, rect: RECT, cover: coverRect(RECT, image.width, image.height), background: WHITE, ink: BLACK, ...extra });
const right = (c) => c.x + c.w;
const bottom = (c) => c.y + c.h;

describe('growCover: leftover pieces of the old letters', () => {
  test('a clean ring leaves the cover as it is', () => {
    const image = solid(200, 90, WHITE);
    assert.deepEqual(grow(image), coverRect(RECT, 200, 90));
  });

  test('a piece of a letter at the right end is covered completely', () => {
    const image = solid(200, 90, WHITE);
    paint(image, 108, 30, 9, 12, BLACK); // an "S" that starts inside the box and reaches x = 116
    const cover = grow(image);
    assert.ok(right(cover) >= 117, `cover ends at ${right(cover)}`);
    assert.ok(right(cover) <= 122, 'it must not grow much more than needed');
  });

  // Problem found in a real bank form: "10:30 AM" where Gemini's box ended after "10:30". The
  // letters "AM" start after the space between the words, so the thin ring just outside the cover
  // was clean and the scan stopped: the old letters were never reached.
  test('letters that start after a gap (a space between words) are still covered', () => {
    const image = solid(220, 90, WHITE);
    paint(image, 122, 30, 14, 12, BLACK); // "AM": the box ends at x = 110, the cover at 113, a 9 px gap
    const cover = grow(image);
    assert.ok(right(cover) >= 136, `cover ends at ${right(cover)}, the letters end at 136`);
  });

  test('also on the left (Arabic and Urdu lines end on the left)', () => {
    const image = solid(220, 90, WHITE);
    paint(image, 26, 30, 14, 12, BLACK); // letters left of the box (box starts at 50, cover at 47)
    const cover = grow(image);
    assert.ok(cover.x <= 26, `cover starts at ${cover.x}, the letters start at 26`);
  });

  test('a far-away second column (more than one letter height away) is NOT covered', () => {
    const image = solid(300, 90, WHITE);
    paint(image, 200, 30, 14, 12, BLACK); // 87 px away from the cover
    const cover = grow(image);
    assert.ok(right(cover) < 130, `cover ends at ${right(cover)}`);
  });

  test('the gap jump never crosses a border line', () => {
    const image = solid(220, 90, WHITE);
    paint(image, 120, 0, 2, 90, BLACK); // a form border 7 px right of the cover
    paint(image, 126, 30, 14, 12, BLACK); // text behind the border
    const cover = grow(image);
    assert.ok(right(cover) <= 120, `cover ends at ${right(cover)}`);
  });

  test('the gap jump never enters the box of another block', () => {
    const image = solid(220, 90, WHITE);
    paint(image, 122, 30, 14, 12, BLACK);
    const cover = grow(image, { avoid: [{ x: 118, y: 28, w: 30, h: 16 }] });
    assert.ok(right(cover) <= 118, `cover ends at ${right(cover)}`);
  });

  test('a dash under the text is covered (grows down)', () => {
    const image = solid(200, 90, WHITE);
    paint(image, 60, 40, 14, 8, BLACK); // a descender stroke from inside the box down to y = 47
    const cover = grow(image);
    assert.ok(bottom(cover) >= 48, `cover ends at ${bottom(cover)}`);
  });

  test('only the side that needs it grows', () => {
    const image = solid(200, 90, WHITE);
    paint(image, 108, 30, 9, 12, BLACK);
    const first = coverRect(RECT, 200, 90);
    const cover = grow(image);
    assert.equal(cover.x, first.x);
    assert.equal(cover.y, first.y);
    assert.equal(bottom(cover), bottom(first));
  });

  test('works for light letters on a dark bar', () => {
    const navy = { r: 26, g: 58, b: 122 };
    const image = solid(200, 90, navy);
    paint(image, 108, 30, 9, 12, WHITE);
    const cover = growCover({ image, rect: RECT, cover: coverRect(RECT, 200, 90), background: navy, ink: WHITE });
    assert.ok(right(cover) >= 117);
  });

  test('never grows over a straight border line', () => {
    const image = solid(200, 90, WHITE);
    paint(image, 108, 30, 6, 12, BLACK); // piece of a letter, reaches x = 113
    paint(image, 116, 0, 2, 90, BLACK); // a vertical form border
    const cover = grow(image);
    assert.ok(right(cover) <= 116, `cover ends at ${right(cover)}, the border starts at 116`);
  });

  test('never grows into the box of another block', () => {
    const image = solid(200, 90, WHITE);
    paint(image, 108, 30, 40, 12, BLACK); // ink that goes on for a long way to the right
    const cover = grow(image, { avoid: [{ x: 124, y: 28, w: 40, h: 16 }] });
    assert.ok(right(cover) <= 124, `cover ends at ${right(cover)}`);
  });

  test('sideways it grows at most 2.5 x the box height from the box', () => {
    const image = solid(300, 90, WHITE);
    paint(image, 108, 30, 150, 12, BLACK); // a bar of ink that never ends
    const cover = grow(image);
    assert.equal(right(cover), RECT.x + RECT.w + Math.round(RECT.h * 2.5)); // 110 + 30
  });

  test('up and down it grows at most 0.5 x the box height from the box', () => {
    const image = solid(200, 200, WHITE);
    paint(image, 70, 40, 12, 150, BLACK); // a vertical bar of ink that never ends
    const cover = grow(image);
    assert.equal(bottom(cover), RECT.y + RECT.h + Math.round(RECT.h * 0.5)); // 42 + 6
    assert.equal(cover.y, Math.min(cover.y, RECT.y - 3)); // not smaller than the first cover
  });

  test('stops at the edge of the image', () => {
    const image = solid(114, 90, WHITE);
    paint(image, 108, 30, 6, 12, BLACK);
    const cover = grow(image);
    assert.ok(right(cover) <= 114);
  });

  test('property: the cover only gets bigger, and stays inside the image and the limits', () => {
    const noise = fc.array(fc.record({ x: fc.integer({ min: 0, max: 199 }), y: fc.integer({ min: 0, max: 89 }), w: fc.integer({ min: 1, max: 30 }), h: fc.integer({ min: 1, max: 30 }) }), { maxLength: 6 });
    fc.assert(
      fc.property(noise, (boxes) => {
        const image = solid(200, 90, WHITE);
        for (const b of boxes) paint(image, b.x, b.y, Math.min(b.w, 200 - b.x), Math.min(b.h, 90 - b.y), BLACK);
        const first = coverRect(RECT, 200, 90);
        const c = grow(image);
        return (
          c.x <= first.x && c.y <= first.y && right(c) >= right(first) && bottom(c) >= bottom(first) &&
          c.x >= 0 && c.y >= 0 && right(c) <= 200 && bottom(c) <= 90 &&
          c.x >= RECT.x - 30 && right(c) <= RECT.x + RECT.w + 30 && c.y >= RECT.y - 6 && bottom(c) <= RECT.y + RECT.h + 6 ||
          // the first cover can already be bigger than the limit (3 px minimum padding): then it is unchanged
          (c.x === first.x && c.y === first.y && right(c) === right(first) && bottom(c) === bottom(first))
        );
      }),
      { numRuns: 100 }
    );
  });
});

describe('stripHasLine', () => {
  test('a long line is a line, a short piece of a letter is not', () => {
    const image = solid(100, 60, WHITE);
    paint(image, 0, 30, 100, 2, BLACK); // a border across the whole image
    paint(image, 40, 10, 6, 2, BLACK); // a small dash
    const test = (r, g, b) => r < 100 && g < 100 && b < 100;
    assert.equal(stripHasLine(image, { x: 20, y: 29, w: 40, h: 4 }, test, true), true);
    assert.equal(stripHasLine(image, { x: 30, y: 9, w: 30, h: 4 }, test, true), false);
  });
});

describe('sampleInkColor', () => {
  test('finds the colour of the letters, light or dark', () => {
    const dark = solid(60, 30, WHITE);
    paint(dark, 10, 10, 20, 4, { r: 10, g: 20, b: 200 });
    assert.deepEqual(sampleInkColor(dark, { x: 5, y: 5, w: 50, h: 20 }, WHITE), { r: 10, g: 20, b: 200 });

    const navy = { r: 26, g: 58, b: 122 };
    const light = solid(60, 30, navy);
    paint(light, 10, 10, 20, 4, WHITE);
    assert.deepEqual(sampleInkColor(light, { x: 5, y: 5, w: 50, h: 20 }, navy), WHITE);
  });

  test('null when nothing differs from the background', () => {
    assert.equal(sampleInkColor(solid(30, 30, WHITE), { x: 2, y: 2, w: 20, h: 20 }, WHITE), null);
  });

  test('colorDistance', () => {
    assert.equal(colorDistance(BLACK, BLACK), 0);
    assert.ok(Math.abs(colorDistance(BLACK, { r: 3, g: 4, b: 0 }) - 5) < 1e-9);
  });
});

describe('findFreeWidth: plain background next to a cover', () => {
  const cover = { x: 20, y: 10, w: 50, h: 30 };
  const scan = (image, extra = {}) =>
    findFreeWidth({ image, cover, background: WHITE, maxExtra: 100, direction: 'right', ...extra });

  test('all plain: as much as allowed', () => {
    assert.equal(scan(solid(300, 60, WHITE)), 100);
    assert.equal(scan(solid(300, 60, WHITE), { maxExtra: 41 }), 41);
  });

  test('stops at a border line', () => {
    const image = solid(300, 60, WHITE);
    paint(image, 100, 0, 2, 60, BLACK);
    assert.equal(scan(image), 30); // cover ends at x = 70, border at 100
  });

  test('stops at a button edge (a different colour)', () => {
    const red = { r: 200, g: 60, b: 45 };
    const image = solid(300, 60, red);
    paint(image, 120, 0, 180, 60, WHITE); // the button ends at x = 120
    assert.equal(findFreeWidth({ image, cover, background: red, maxExtra: 100, direction: 'right' }), 50);
  });

  test('stops at the box of another block', () => {
    assert.equal(scan(solid(300, 60, WHITE), { avoid: [{ x: 90, y: 0, w: 30, h: 60 }] }), 20);
  });

  test('stops at the edge of the image, also on the left', () => {
    assert.equal(scan(solid(80, 60, WHITE)), 10);
    assert.equal(scan(solid(300, 60, WHITE), { direction: 'left' }), 20);
  });

  test('0 when the next pixels are not plain', () => {
    const image = solid(300, 60, WHITE);
    paint(image, 71, 15, 3, 3, BLACK);
    assert.equal(scan(image), 0);
  });
});

describe('textArea', () => {
  const rect = { x: 100, y: 50, w: 60, h: 14 };
  const cover = { x: 95, y: 45, w: 70, h: 24 }; // 95..165

  test('left to right: starts at the box, may reach into the free space', () => {
    assert.deepEqual(textArea({ rect, cover, freeRight: 30 }), { left: 100, right: 195, top: 45, bottom: 69 });
  });

  test('never wider than 2 x the box width', () => {
    assert.equal(textArea({ rect, cover, freeRight: 500 }).right, 100 + 120);
  });

  test('without free space it is the cover', () => {
    assert.equal(textArea({ rect, cover }).right, 165);
  });

  test('right to left: ends at the box, reaches left into the free space', () => {
    assert.deepEqual(textArea({ rect, cover, freeLeft: 20, rtl: true }), { left: 75, right: 160, top: 45, bottom: 69 });
    assert.equal(textArea({ rect, cover, freeLeft: 500, rtl: true }).left, 160 - 120);
  });
});

describe('short version', () => {
  test('estimateOriginalSize is close to the font size of a one-line text', () => {
    // "Submit": 6 letters, each about 0.5 x 28 wide -> box about 84 x 28
    const size = estimateOriginalSize({ x: 0, y: 0, w: 84, h: 28 }, 'Submit');
    assert.ok(size > 24 && size < 30, `size ${size}`);
  });

  test('a paragraph gives the size of one line, not of the whole box', () => {
    // 4 lines of 25 characters at 20 px (a letter is about 10 px wide): 100 characters, box 250 x 92
    const size = estimateOriginalSize({ x: 0, y: 0, w: 250, h: 92 }, 'x'.repeat(100));
    assert.ok(size > 15 && size < 25, `size ${size}`);
  });

  test('unknown original text gives 0', () => {
    assert.equal(estimateOriginalSize(RECT, ''), 0);
    assert.equal(estimateOriginalSize(RECT, undefined), 0);
  });

});

describe('leaveUntouched', () => {
  test('different text is always redrawn', () => {
    assert.equal(leaveUntouched('First name', 'முதல் பெயர்', 'ta-IN'), false);
    assert.equal(leaveUntouched('Submit', 'Enviar', 'es-ES'), false);
  });

  test('Latin-script languages keep equal text (names are the same there)', () => {
    assert.equal(leaveUntouched('John', 'John', 'es-ES'), true);
    assert.equal(leaveUntouched('John', ' john ', 'de-DE'), true);
    assert.equal(leaveUntouched('Doe', 'Doe', 'en-US'), true);
  });

  test('other scripts keep ONLY e-mail, links, numbers, dates and ID codes', () => {
    for (const same of ['name@example.com', 'https://example.com/a', 'www.example.com', '12345', '12/03/1990', 'ABCDE1234F', 'SBIN0001234', '+91 98765 43210']) {
      assert.equal(leaveUntouched(same, same, 'ta-IN'), true, same);
    }
  });

  test('other scripts redraw names, brands and words that came back unchanged', () => {
    for (const same of ['John', 'Doe', 'CoinMarketCap', 'ghilli', 'Submit']) {
      assert.equal(leaveUntouched(same, same, 'ta-IN'), false, same);
      assert.equal(leaveUntouched(same, same.toUpperCase(), 'hi-IN'), false, same);
    }
  });

  test('without a language the old rule applies', () => {
    assert.equal(leaveUntouched('John', 'john'), true);
    assert.equal(leaveUntouched('John', 'john', ''), true);
  });

  test('an unknown original is never left untouched', () => {
    assert.equal(leaveUntouched('', '', 'ta-IN'), false);
    assert.equal(leaveUntouched(undefined, 'x', 'ta-IN'), false);
  });
});

describe('insetRect (neighbour boxes overlap a little)', () => {
  test('makes the box smaller on every side', () => {
    assert.deepEqual(insetRect({ x: 100, y: 50, w: 80, h: 20 }, 4), { x: 104, y: 54, w: 72, h: 12 });
  });

  test('never turns a small box into nothing', () => {
    const r = insetRect({ x: 10, y: 10, w: 5, h: 4 }, 10);
    assert.ok(r.w >= 1 && r.h >= 1);
  });

  test('a cover may grow into a few pixels of overlap with a neighbour box', () => {
    const image = solid(220, 90, WHITE);
    paint(image, 108, 30, 22, 12, BLACK); // the end of the line, up to x = 130
    // the neighbour's box starts at x = 127, i.e. it overlaps our own last letters by 3 pixels
    const neighbour = { x: 127, y: 28, w: 60, h: 16 };
    assert.ok(right(grow(image, { avoid: [neighbour] })) <= 127); // with the full box: blocked
    const cover = grow(image, { avoid: [insetRect(neighbour, 5)] }); // with the inset box: reaches the end
    assert.ok(right(cover) >= 130, `cover ends at ${right(cover)}`);
  });
});
