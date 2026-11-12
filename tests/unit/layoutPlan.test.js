// tests/unit/layoutPlan.test.js
// Line breaking and font sizes for ALL 20 languages, without a browser and without Gemini:
//   - no word and no grapheme cluster is ever split, a line never starts with a closing mark
//   - lines that had the same size in the original get one size in the translation
//   - never below 70% of the original height when there is a way to avoid it
//   - the order of fallbacks: short version, then one more line, and never a broken word
// A fake font is used (every character has a fixed width), so the tests are exact.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  wrapText,
  groupByHeight,
  describeOriginal,
  planTextLayout,
  maxFitSize,
  layoutAt,
  textArea,
} from '../../skeleton/form-overlay-utils.js';
import { isRtlLang } from '../../skeleton/form-overlay.js';
import { SAMPLES, KEYS, THAI_SAMPLE } from '../fixtures/layout-samples.js';

const CODES = Object.keys(SAMPLES);

// ---------- A fake font ----------

// Characters that are as wide as they are high (Chinese, Japanese, Korean) ...
const FULL_WIDTH = /[\u1100-\u11ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/u;
// ... all others are 0.55 of their height. A combining mark adds nothing (it is in the same
// grapheme cluster as its letter), like in a real font.
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemesOf = (text) => Array.from(segmenter.segment(text), (part) => part.segment);
const measureAt = (text, size) =>
  graphemesOf(text).reduce((sum, g) => sum + (FULL_WIDTH.test(g) ? 1 : 0.55) * size, 0);

const withoutSpaces = (text) => text.replace(/\s+/g, '');
const CLOSING_MARK = /^[，。、！？；：）」』】ー,.;:!?)\]}%]/;

// ---------- Nothing is split ----------

describe('line breaking in all 20 languages', () => {
  for (const code of CODES) {
    const sample = SAMPLES[code];

    test(`${code}: no word, no grapheme cluster and no e-mail address is ever split`, () => {
      for (const key of KEYS) {
        const text = sample[key];
        for (const width of [40, 60, 90, 130, 200, 400]) {
          const lines = wrapText(text, width, (s) => measureAt(s, 16), sample.bcp47);
          const where = `${code}/${key}/${width}: ${lines.join(' | ')}`;

          // 1. Nothing is lost or changed (spaces between lines may differ).
          assert.equal(withoutSpaces(lines.join('')), withoutSpaces(text), where);

          // 2. No grapheme cluster is cut: cutting every line into clusters gives the same clusters
          //    as cutting the whole text (so a vowel sign or a conjunct is never separated).
          //    (The spaces are kept while cutting: without them two words would grow together.)
          const visible = (parts) => parts.filter((g) => !/^\s+$/.test(g));
          assert.deepEqual(lines.flatMap((line) => visible(graphemesOf(line))), visible(graphemesOf(text)), where);

          // 3. Languages with spaces: every word is whole on one line.
          if (!['zh', 'ja'].includes(code)) {
            assert.deepEqual(lines.join(' ').split(/\s+/).filter(Boolean), text.split(/\s+/).filter(Boolean), where);
          }

          // 4. The e-mail address and the times stay in one piece.
          assert.ok(!text.includes('john.doe@example.com') || lines.some((l) => l.includes('john.doe@example.com')), where);
          assert.ok(!text.includes('10:30') || lines.some((l) => l.includes('10:30')), where);

          // 5. No line starts with a closing mark.
          for (const line of lines) assert.ok(!CLOSING_MARK.test(line), `"${line}" starts with a closing mark; ${where}`);
        }
      }
    });
  }

  test('Thai: lines break only between dictionary words', () => {
    const words = Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(THAI_SAMPLE.long), (p) => p.segment);
    const starts = new Set(words.map((_, i) => words.slice(0, i).join('').length));
    for (const width of [40, 60, 90, 130]) {
      const lines = wrapText(THAI_SAMPLE.long, width, (s) => measureAt(s, 16), THAI_SAMPLE.bcp47);
      let at = 0;
      for (const line of lines) {
        assert.ok(starts.has(at), `width ${width}: a line starts inside a word`);
        at += line.length;
      }
      assert.equal(lines.join(''), THAI_SAMPLE.long);
    }
  });

  test('Tamil "சமர்ப்பிக்கவும்" is never split, whatever the width', () => {
    for (let width = 5; width < 200; width += 5) {
      assert.deepEqual(wrapText('சமர்ப்பிக்கவும்', width, (s) => measureAt(s, 16), 'ta-IN'), ['சமர்ப்பிக்கவும்']);
    }
  });

  test('Arabic and Urdu: joined letters are never cut', () => {
    for (const code of ['ar', 'ur']) {
      for (const width of [20, 40, 80, 160]) {
        const lines = wrapText(SAMPLES[code].long, width, (s) => measureAt(s, 16), SAMPLES[code].bcp47);
        assert.deepEqual(lines.join(' ').split(/\s+/), SAMPLES[code].long.split(/\s+/));
      }
    }
  });
});

// ---------- Groups ----------

describe('groupByHeight', () => {
  test('heights within 15% of the smallest share a group', () => {
    assert.deepEqual(groupByHeight([20, 21, 23, 24, 40, 41, 100]), [0, 0, 0, 1, 2, 2, 3]);
  });

  test('the order of the input does not matter', () => {
    assert.deepEqual(groupByHeight([100, 21, 40, 20, 24, 41, 23]), [3, 0, 2, 0, 1, 2, 0]);
  });

  test('one height, equal heights, and no heights', () => {
    assert.deepEqual(groupByHeight([30]), [0]);
    assert.deepEqual(groupByHeight([30, 30, 30]), [0, 0, 0]);
    assert.deepEqual(groupByHeight([]), []);
  });

  test('describeOriginal: one line is the box height; a paragraph is the height of one line', () => {
    // "Submit": 6 letters of 28 px, about 84 px wide
    const one = describeOriginal({ x: 0, y: 0, w: 84, h: 28 }, 'Submit');
    assert.equal(one.lines, 1);
    assert.equal(one.height, 28);
    // four lines of 20 px (25 letters of 10 px each)
    const four = describeOriginal({ x: 0, y: 0, w: 250, h: 20 + 3 * 23 }, 'x'.repeat(100));
    assert.equal(four.lines, 4);
    assert.ok(Math.abs(four.height - 20) < 0.5, `height ${four.height}`);
  });

  test('describeOriginal: unknown text is one line of the box height', () => {
    assert.deepEqual(describeOriginal({ x: 0, y: 0, w: 80, h: 18 }, ''), { height: 18, lines: 1 });
  });
});

// ---------- Plans ----------

// A form with five blocks. Heights of the original text: title 38, three lines of 22/22/21, button 28.
// The boxes are 2 x the original height, as they are when plain space above and below can be used.
const BLOCKS = {
  title: { h: 38, w: 560 },
  long: { h: 22, w: 520 },
  email: { h: 22, w: 330 },
  time: { h: 21, w: 300 },
  button: { h: 28, w: 150 },
};
const itemsFor = (sample, { short = {} } = {}) =>
  KEYS.map((key) => ({
    text: sample[key],
    short: short[key] || '',
    originalHeight: BLOCKS[key].h,
    originalLines: 1,
    boxW: BLOCKS[key].w,
    boxH: BLOCKS[key].h * 2,
  }));

describe('planTextLayout in all 20 languages', () => {
  for (const code of CODES) {
    const sample = SAMPLES[code];

    test(`${code}: one size per group, never below 70% unless flagged, never above the original, no word broken`, () => {
      const items = itemsFor(sample);
      const plan = planTextLayout({ items, measureAt, lang: sample.bcp47 });
      assert.equal(plan.length, items.length);

      const sizeByGroup = new Map();
      plan.forEach((result, i) => {
        const item = items[i];
        const where = `${code}/${KEYS[i]}: size ${result.size}, lines ${result.lines.join(' | ')}`;

        // no word broken: the words of the lines are the words of the text
        assert.deepEqual(result.lines.join(' ').split(/\s+/).filter(Boolean).join('').replace(/\s/g, ''), withoutSpaces(result.text), where);
        if (!['zh', 'ja'].includes(code)) {
          assert.deepEqual(result.lines.join(' ').split(/\s+/).filter(Boolean), result.text.split(/\s+/).filter(Boolean), where);
        }

        // not bigger than the original text of its group (the group's middle height)
        const groupHeights = items.filter((_, j) => plan[j].group === result.group).map((it) => it.originalHeight);
        assert.ok(result.size <= Math.round(Math.max(...groupHeights)), where);

        if (result.belowMinimum) return; // reported below: the rule could not be met for this block
        assert.ok(result.size >= Math.ceil(0.7 * item.originalHeight), where);
        assert.equal(result.fits, true, where);

        // blocks of one group that reach the minimum all have the same size
        if (sizeByGroup.has(result.group)) assert.equal(result.size, sizeByGroup.get(result.group), where);
        sizeByGroup.set(result.group, result.size);
      });
    });
  }

  test('the three lines of the same original size get the same size', () => {
    const plan = planTextLayout({ items: itemsFor(SAMPLES.ta), measureAt, lang: 'ta-IN' });
    const [, long, email, time] = plan;
    assert.equal(long.group, email.group);
    assert.equal(email.group, time.group);
    assert.equal(long.size, email.size);
    assert.equal(email.size, time.size);
  });

  test('the title and the button are not squeezed to the size of the small lines', () => {
    const plan = planTextLayout({ items: itemsFor(SAMPLES.hi), measureAt, lang: 'hi-IN' });
    const [title, long, , , button] = plan;
    assert.ok(title.size > long.size);
    assert.ok(button.size > long.size);
  });
});

describe('the order of fallbacks: short version, one more line, last resort', () => {
  // a fake font: every character is half as wide as high, so a text of n characters is n/2 x size wide
  const half = (text, size) => Array.from(text).length * size * 0.5;
  const plan = (item, extra = {}) =>
    planTextLayout({ items: [{ originalHeight: 20, originalLines: 1, boxW: 100, boxH: 60, short: '', ...item }], measureAt: half, ...extra })[0];

  test('the full translation is used when it reaches 70% of the original', () => {
    const result = plan({ text: 'one two' }); // 7 characters: size 20 fits easily
    assert.equal(result.usedShort, false);
    assert.equal(result.lines.length, 1);
    assert.equal(result.size, 20); // never bigger than the original
  });

  test('1. the short version is used when the full text would be too small', () => {
    // full: 17 characters need size <= 11 on one line (11 < 14 = 70% of 20); short: 8 characters -> 20
    const result = plan({ text: 'word1 word2 word3', short: 'word1 w2' });
    assert.equal(result.usedShort, true);
    assert.equal(result.text, 'word1 w2');
    assert.equal(result.lines.length, 1);
    assert.ok(result.size >= 14);
  });

  test('2. without a short version the text goes on two lines', () => {
    const result = plan({ text: 'word1 word2 word3' });
    assert.equal(result.usedShort, false);
    assert.equal(result.lines.length, 2);
    assert.deepEqual(result.lines.join(' ').split(' '), ['word1', 'word2', 'word3']);
    assert.ok(result.size >= 14);
    assert.equal(result.belowMinimum, false);
  });

  test('a short version that is not shorter is ignored', () => {
    const result = plan({ text: 'word1 word2 word3', short: 'word1 word2 word3' });
    assert.equal(result.usedShort, false);
  });

  test('3. last resort: a word that is too wide stays whole and the size goes below 70%', () => {
    const word = 'x'.repeat(20); // needs size <= 10 (< 14)
    const result = plan({ text: word });
    assert.deepEqual(result.lines, [word]);
    assert.equal(result.size, 10);
    assert.equal(result.belowMinimum, true);
  });

  test('3. a word that does not fit even at the smallest size is still not broken', () => {
    const word = 'x'.repeat(60);
    const result = plan({ text: word });
    assert.deepEqual(result.lines, [word]);
    assert.equal(result.size, 6);
    assert.equal(result.fits, false);
    assert.equal(result.belowMinimum, true);
  });

  test('a big box does not make the text bigger than the original', () => {
    const result = plan({ text: 'Hi', boxW: 1000, boxH: 200 });
    assert.equal(result.size, 20);
  });

  test('a block that cannot reach 70% does not pull its group down', () => {
    const items = [
      { text: 'ab cd', originalHeight: 20, originalLines: 1, boxW: 100, boxH: 60, short: '' },
      { text: 'ef gh', originalHeight: 21, originalLines: 1, boxW: 100, boxH: 60, short: '' },
      { text: 'x'.repeat(24), originalHeight: 20, originalLines: 1, boxW: 100, boxH: 60, short: '' }, // fits only at 8
    ];
    const [a, b, c] = planTextLayout({ items, measureAt: half });
    assert.equal(a.size, b.size);
    assert.equal(a.size, 20);
    assert.equal(c.size, 8);
    assert.equal(c.belowMinimum, true);
  });

  test('A- / A+ change the size after the plan and wrap again', () => {
    const items = [{ text: 'word1 word2 word3', originalHeight: 20, originalLines: 1, boxW: 100, boxH: 60, short: '' }];
    const normal = planTextLayout({ items, measureAt: half })[0];
    const bigger = planTextLayout({ items, measureAt: half, scale: 1.5 })[0];
    const smaller = planTextLayout({ items, measureAt: half, scale: 0.5 })[0];
    assert.equal(bigger.size, Math.round(normal.size * 1.5));
    assert.equal(smaller.size, Math.max(6, Math.round(normal.size * 0.5)));
    assert.ok(smaller.lines.length <= normal.lines.length);
  });

  test('maxFitSize / layoutAt: 0 when nothing fits, otherwise the biggest size', () => {
    const args = { text: 'abcd efgh', boxW: 40, boxH: 100, measureAt: half };
    assert.equal(maxFitSize({ ...args, maxSize: 50 }), 20); // 4 characters x 0.5 x size <= 40
    assert.equal(maxFitSize({ ...args, boxW: 5 }), 0);
    assert.equal(layoutAt({ ...args, size: 20 }).fits, true);
    assert.equal(layoutAt({ ...args, size: 21 }).fits, false);
    assert.equal(layoutAt({ ...args, size: 20, maxLines: 1 }).fits, false); // two words need two lines at this width
  });
});

// ---------- Right to left ----------

describe('right to left', () => {
  test('only Arabic and Urdu are right to left', () => {
    for (const code of CODES) assert.equal(isRtlLang(SAMPLES[code].bcp47), code === 'ar' || code === 'ur', code);
  });

  test('the text area of Arabic and Urdu is anchored at the RIGHT edge of the box', () => {
    const rect = { x: 100, y: 50, w: 60, h: 14 };
    const cover = { x: 95, y: 45, w: 70, h: 24 };
    const area = textArea({ rect, cover, freeLeft: 40, rtl: true });
    assert.equal(area.right, rect.x + rect.w); // the right edge stays where the original text ended
    assert.ok(area.left < rect.x); // and more room is found on the left
    const ltr = textArea({ rect, cover, freeRight: 40 });
    assert.equal(ltr.left, rect.x);
  });
});

// ---------- Room beside a block, then one size per group ----------

describe('free space is used before the text is made smaller', () => {
  const rect = { x: 40, y: 100, w: 200, h: 20 };
  const cover = { x: 37, y: 96, w: 206, h: 28 };

  test('textArea: the default is at most 2 x the width of the original box', () => {
    const area = textArea({ rect, cover, freeRight: 900 });
    assert.equal(area.right, rect.x + rect.w * 2);
  });

  test('textArea: with maxWidth = the page width, all the free space is used', () => {
    const area = textArea({ rect, cover, freeRight: 500, maxWidth: 1000 });
    assert.equal(area.right, cover.x + cover.w + 500);
    assert.equal(area.left, rect.x);
    // Right-to-left text grows to the left instead.
    const rtl = textArea({ rect, cover, freeLeft: 20, rtl: true, maxWidth: 1000 });
    assert.equal(rtl.right, rect.x + rect.w);
    assert.equal(rtl.left, cover.x - 20);
  });

  test('a line that is too long for its box reaches 70% once it may use the free space', () => {
    const text = 'x'.repeat(40); // 40 characters of 0.55 em
    const item = { text, short: '', originalHeight: 20, originalLines: 1, boxH: 24 };
    const narrow = planTextLayout({ items: [{ ...item, boxW: 200 }], measureAt })[0];
    const wide = planTextLayout({ items: [{ ...item, boxW: 520 }], measureAt })[0];
    assert.ok(narrow.belowMinimum, 'in the narrow box it cannot reach 70%');
    assert.ok(!wide.belowMinimum, 'with the free space it can');
    assert.ok(wide.size > narrow.size);
  });
});

describe('every block of a group gets the same final size', () => {
  // Four lines of the "Important notice" paragraph: same original height, different box widths.
  const make = (length, boxW) => ({
    text: 'word '.repeat(length).trim(),
    short: '',
    originalHeight: 20,
    originalLines: 1,
    boxW,
    boxH: 24,
  });

  test('blocks that reach 70% all get the smallest size that every one of them can use', () => {
    // Widths are chosen so each line alone could be written at a different size (14 to 20).
    const items = [make(8, 520), make(8, 470), make(8, 430), make(8, 400)];
    const alone = items.map((item) => maxFitSize({ ...item, measureAt, maxLines: 1, maxSize: 20 }));
    assert.ok(new Set(alone).size > 1, `the test needs different sizes alone: ${alone}`);

    const plan = planTextLayout({ items, measureAt });
    assert.ok(plan.every((p) => !p.belowMinimum));
    assert.equal(new Set(plan.map((p) => p.size)).size, 1, `sizes: ${plan.map((p) => p.size)}`);
    assert.equal(plan[0].size, Math.min(...alone));
  });

  test('a block that can never reach 70% does not pull the others down', () => {
    const items = [make(8, 520), make(8, 470), make(8, 120)];
    const plan = planTextLayout({ items, measureAt });
    assert.ok(plan[2].belowMinimum);
    assert.equal(plan[0].size, plan[1].size);
    assert.ok(plan[0].size > plan[2].size);
  });
});
