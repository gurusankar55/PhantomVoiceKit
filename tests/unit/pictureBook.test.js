// pictureBook.test.js
// The 60 shared picture words and the Picture book rules, with the real locale files of all
// 20 languages. No browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';

import { PICTURE_WORDS, PICTURE_WORD_IDS, ECHO_WORD_IDS, CATEGORIES, wordsOf, emojiOf } from '../../skeleton/picture-words.js';
import { normalizeSpeech } from '../../skeleton/word-match.js';
import { categoryKey, isWordMilestone, stepIndex, shownName, formsFrom, heardWord, WORDS_PER_GIFT } from '../../apps/picture-book/book-utils.js';

const LOCALES = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr'];
const BCP47 = { en: 'en-US', ta: 'ta-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ml: 'ml-IN', ko: 'ko-KR', zh: 'zh-CN', ja: 'ja-JP', es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA', pt: 'pt-BR', ru: 'ru-RU', bn: 'bn-IN', ur: 'ur-PK', id: 'id-ID', de: 'de-DE', vi: 'vi-VN', tr: 'tr-TR' };
const STRINGS = Object.fromEntries(LOCALES.map((code) => [code, JSON.parse(readFileSync(new URL(`../../skeleton/locales/${code}.json`, import.meta.url), 'utf8'))]));
const FORMS = Object.fromEntries(LOCALES.map((code) => [code, formsFrom(STRINGS[code])]));

describe('the 60 picture words', () => {
  test('60 different words with an emoji and a page; Ghost Echo keeps its 30', () => {
    assert.equal(PICTURE_WORDS.length, 60);
    assert.equal(new Set(PICTURE_WORD_IDS).size, 60);
    assert.equal(ECHO_WORD_IDS.length, 30);
    for (const word of PICTURE_WORDS) {
      assert.ok(emojiOf(word.id) !== '', word.id);
      assert.ok(CATEGORIES.includes(word.category), word.id);
    }
    for (const category of ['animals', 'fruits', 'colours', 'numbers', 'body']) assert.ok(wordsOf(category).length >= 5, category);
    assert.equal(CATEGORIES.reduce((sum, c) => sum + wordsOf(c).length, 0), 60);
  });

  test('every word and every page has a name in all 20 languages; the 60 shown names are all different', () => {
    for (const code of LOCALES) {
      for (const id of PICTURE_WORD_IDS) assert.ok(FORMS[code][id].length > 0, `${code} words.${id}`);
      for (const c of CATEGORIES) assert.ok(STRINGS[code][categoryKey(c)], `${code} ${categoryKey(c)}`);
      const names = PICTURE_WORD_IDS.map((id) => normalizeSpeech(FORMS[code][id][0]));
      const twice = names.filter((n, i) => names.indexOf(n) !== i);
      assert.deepEqual(twice, [], `${code} has two words with the same name`);
    }
  });

  test('every language: each way to say a word counts for that word only', () => {
    for (const code of LOCALES) {
      for (const id of PICTURE_WORD_IDS) {
        for (const form of FORMS[code][id]) {
          assert.equal(heardWord(form, id, FORMS[code], BCP47[code]), true, `${code} ${id} "${form}"`);
        }
      }
    }
  });

  test('a different picture word does not count (spaced languages)', () => {
    for (const code of LOCALES.filter((c) => !['zh', 'ja'].includes(c))) {
      const ids = PICTURE_WORD_IDS;
      for (let i = 0; i < ids.length; i++) {
        const other = ids[(i + 7) % ids.length];
        assert.equal(heardWord(FORMS[code][other][0], ids[i], FORMS[code], BCP47[code]), false, `${code}: "${FORMS[code][other][0]}" taken for ${ids[i]}`);
      }
    }
  });

  test('Tamil examples: endings, colloquial forms, punctuation', () => {
    const f = FORMS.ta;
    assert.equal(heardWord('யானை!', 'elephant', f, 'ta-IN'), true);
    assert.equal(heardWord('யானையும்', 'elephant', f, 'ta-IN'), true);
    assert.equal(heardWord('ரெண்டு', 'two', f, 'ta-IN'), true);
    assert.equal(heardWord('பால்', 'tooth', f, 'ta-IN'), false); // milk, not tooth
    assert.equal(heardWord('பூனை', 'flower', f, 'ta-IN'), false); // cat, not flower
  });
});

describe('picture book rules', () => {
  test('a gift every 10 words', () => {
    assert.equal(WORDS_PER_GIFT, 10);
    assert.deepEqual([1, 9, 10, 11, 20, 30].map(isWordMilestone), [false, false, true, false, true, true]);
    assert.equal(isWordMilestone(0), false);
  });

  test('Next and Back go round the page', () => {
    assert.equal(stepIndex(0, 5, 1), 1);
    assert.equal(stepIndex(4, 5, 1), 0);
    assert.equal(stepIndex(0, 5, -1), 4);
    assert.equal(stepIndex(3, 0, 1), 0);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), fc.integer({ min: 1, max: 30 }), fc.integer({ min: -5, max: 5 }), (i, n, s) => {
        const next = stepIndex(i % n, n, s);
        return next >= 0 && next < n;
      }),
      { numRuns: 100 }
    );
  });

  test('the shown name is the first form', () => {
    assert.equal(shownName('பூனை|பூன', 'cat'), 'பூனை');
    assert.equal(shownName('', 'cat'), 'cat');
  });
});
