// tests/unit/translatorUtils.test.js
// Unit tests for apps/form-translator/translator-utils.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  limitPages,
  fitImageSize,
  pdfPageSize,
  translatedFilename,
  chunkTexts,
} from '../../apps/form-translator/translator-utils.js';

describe('limitPages', () => {
  test('uses up to 5 pages and counts the rest as skipped', () => {
    assert.deepEqual(limitPages(3), { count: 3, skipped: 0 });
    assert.deepEqual(limitPages(5), { count: 5, skipped: 0 });
    assert.deepEqual(limitPages(12), { count: 5, skipped: 7 });
  });

  test('bad numbers give 0 pages', () => {
    assert.deepEqual(limitPages(0), { count: 0, skipped: 0 });
    assert.deepEqual(limitPages(NaN), { count: 0, skipped: 0 });
    assert.deepEqual(limitPages(-4), { count: 0, skipped: 0 });
  });
});

describe('fitImageSize', () => {
  test('makes a big image smaller and keeps its shape', () => {
    const r = fitImageSize(4000, 3000, 2000);
    assert.deepEqual({ w: r.width, h: r.height }, { w: 2000, h: 1500 });
    assert.equal(r.scale, 0.5);
  });

  test('never makes an image bigger', () => {
    const r = fitImageSize(800, 600, 2000);
    assert.deepEqual({ w: r.width, h: r.height, s: r.scale }, { w: 800, h: 600, s: 1 });
  });

  test('works for tall images', () => {
    const r = fitImageSize(1000, 4000, 2000);
    assert.deepEqual({ w: r.width, h: r.height }, { w: 500, h: 2000 });
  });
});

describe('pdfPageSize', () => {
  test('keeps the shape of the image, long side 842', () => {
    assert.deepEqual(pdfPageSize(1000, 2000), { width: 421, height: 842, orientation: 'p' });
    assert.deepEqual(pdfPageSize(2000, 1000), { width: 842, height: 421, orientation: 'l' });
  });

  test('a square image is portrait', () => {
    assert.deepEqual(pdfPageSize(500, 500), { width: 842, height: 842, orientation: 'p' });
  });

  test('the ratio matches the image', () => {
    const r = pdfPageSize(1500, 2121);
    assert.ok(Math.abs(r.width / r.height - 1500 / 2121) < 0.001);
  });
});

describe('translatedFilename', () => {
  const date = new Date(2026, 10, 11); // 11 November 2026 (local time)

  test('builds name_code_date.pdf', () => {
    assert.equal(translatedFilename('Bank Form.pdf', 'ta-IN', date), 'Bank-Form_ta_2026-11-11.pdf');
  });

  test('removes the extension and unsafe characters', () => {
    assert.equal(translatedFilename('a/b\\c:d*e?.jpeg', 'fr-FR', date), 'a-b-c-d-e_fr_2026-11-11.pdf');
  });

  test('falls back to "form" when nothing is left', () => {
    assert.equal(translatedFilename('???.png', 'en-US', date), 'form_en_2026-11-11.pdf');
    assert.equal(translatedFilename('', 'en-US', date), 'form_en_2026-11-11.pdf');
  });

  test('keeps letters of other scripts', () => {
    assert.equal(translatedFilename('படிவம்.pdf', 'ta-IN', date), 'படிவம்_ta_2026-11-11.pdf');
  });
});

describe('chunkTexts', () => {
  test('joins short texts up to the limit', () => {
    assert.deepEqual(chunkTexts(['aaa', 'bbb', 'ccc'], 7), ['aaa\nbbb', 'ccc']);
  });

  test('drops empty texts and trims', () => {
    assert.deepEqual(chunkTexts(['  a ', '', '   ', 'b'], 100), ['a\nb']);
  });

  test('keeps one long text whole', () => {
    assert.deepEqual(chunkTexts(['x'.repeat(50), 'y'], 10), ['x'.repeat(50), 'y']);
  });

  test('no texts means no chunks', () => {
    assert.deepEqual(chunkTexts([]), []);
  });

  test('keeps every text, in order', () => {
    const texts = Array.from({ length: 40 }, (_, i) => `text ${i}`);
    const chunks = chunkTexts(texts, 60);
    assert.deepEqual(chunks.join('\n').split('\n'), texts);
    assert.ok(chunks.every((c) => c.length <= 60));
  });
});
