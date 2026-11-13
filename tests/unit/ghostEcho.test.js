// ghostEcho.test.js
// Ghost Echo, the voice memory game: words, levels, sequences, the forgiving voice check in all
// 20 languages (with the real locale files), taps and the best level. No browser, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';

import {
  WORDS,
  WORD_IDS,
  wordKey,
  emojiOf,
  wordForms,
  sequenceLength,
  makeSequence,
  choiceWords,
  isMilestone,
  tapsMatch,
  normalizeSpeech,
  editDistance,
  closeness,
  matchSequence,
  loadBest,
  saveBest,
  BEST_KEY,
  MAX_SEQUENCE,
} from '../../apps/ghost-echo/echo-utils.js';

const LOCALES = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr'];
const BCP47 = { en: 'en-US', ta: 'ta-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ml: 'ml-IN', ko: 'ko-KR', zh: 'zh-CN', ja: 'ja-JP', es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA', pt: 'pt-BR', ru: 'ru-RU', bn: 'bn-IN', ur: 'ur-PK', id: 'id-ID', de: 'de-DE', vi: 'vi-VN', tr: 'tr-TR' };

// Every word's forms in one language, from the real locale file.
function formsFor(code) {
  const strings = JSON.parse(readFileSync(new URL(`../../skeleton/locales/${code}.json`, import.meta.url), 'utf8'));
  const forms = {};
  for (const id of WORD_IDS) forms[id] = wordForms(strings[wordKey(id)]);
  return { forms, strings };
}
const ALL = Object.fromEntries(LOCALES.map((code) => [code, formsFor(code)]));
const shown = (code, id) => ALL[code].forms[id][0];
const NO_SPACES = ['zh', 'ja'];
const say = (code, ids) => ids.map((id) => shown(code, id)).join(NO_SPACES.includes(code) ? '' : ' ');
const check = (code, heard, ids) => matchSequence(heard, ids, ALL[code].forms, BCP47[code]);

describe('the 30 picture words', () => {
  test('30 different words, each with an emoji', () => {
    assert.equal(WORDS.length, 30);
    assert.equal(new Set(WORD_IDS).size, 30);
    for (const word of WORDS) assert.ok(emojiOf(word.id) !== '', word.id);
    assert.equal(emojiOf('dragon'), '');
  });

  test('every word has a name in all 20 languages; the shown names of a language are all different', () => {
    for (const code of LOCALES) {
      for (const id of WORD_IDS) assert.ok(ALL[code].forms[id].length >= 1, `${code} ${id}`);
      const names = WORD_IDS.map((id) => normalizeSpeech(shown(code, id)));
      assert.equal(new Set(names).size, 30, `${code} has two words with the same name`);
    }
  });

  test('the Tamil names asked for', () => {
    assert.equal(shown('ta', 'cat'), 'பூனை');
    assert.equal(shown('ta', 'moon'), 'நிலா');
    assert.equal(shown('ta', 'tree'), 'மரம்');
    assert.equal(shown('ta', 'flower'), 'பூ');
    assert.equal(shown('ta', 'fish'), 'மீன்');
  });

  test('wordForms splits the variants', () => {
    assert.deepEqual(wordForms('பூனை|பூன'), ['பூனை', 'பூன']);
    assert.deepEqual(wordForms(' cat | | kitty '), ['cat', 'kitty']);
    assert.deepEqual(wordForms(undefined), []);
  });
});

describe('levels and sequences', () => {
  test('2 words at level 1, one more each level, at most MAX_SEQUENCE', () => {
    assert.equal(sequenceLength(1), 2);
    assert.equal(sequenceLength(2), 3);
    assert.equal(sequenceLength(5), 6);
    assert.equal(sequenceLength(500), MAX_SEQUENCE);
    assert.equal(sequenceLength(0), 2);
  });

  test('a level-up and a gift every 3 levels', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(isMilestone), [false, false, true, false, false, true, true]);
    assert.equal(isMilestone(0), false);
  });

  test('property: a sequence has the right length, known words, none twice', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 40, maxLength: 40 }), (level, values) => {
        let i = 0;
        const random = () => values[i++ % values.length];
        const sequence = makeSequence(level, random);
        return sequence.length === sequenceLength(level) && new Set(sequence).size === sequence.length && sequence.every((id) => WORD_IDS.includes(id));
      }),
      { numRuns: 100 }
    );
  });

  test('property: the picture buttons hold every word of the sequence and 3 more (at least 6)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 15 }), (level) => {
        const sequence = makeSequence(level);
        const choices = choiceWords(sequence);
        return (
          sequence.every((id) => choices.includes(id)) &&
          new Set(choices).size === choices.length &&
          choices.length === Math.min(30, Math.max(6, sequence.length + 3))
        );
      }),
      { numRuns: 100 }
    );
  });

  test('taps must be exactly the sequence', () => {
    assert.equal(tapsMatch(['cat', 'moon'], ['cat', 'moon']), true);
    assert.equal(tapsMatch(['moon', 'cat'], ['cat', 'moon']), false);
    assert.equal(tapsMatch(['cat'], ['cat', 'moon']), false);
    assert.equal(tapsMatch(null, ['cat']), false);
  });
});

describe('the forgiving voice check', () => {
  test('normalizeSpeech: no punctuation, lower case, single spaces', () => {
    assert.equal(normalizeSpeech('  Cat, MOON!  tree. '), 'cat moon tree');
    assert.equal(normalizeSpeech('பூனை। நிலா?'), 'பூனை நிலா');
    assert.equal(normalizeSpeech('猫、犬。'), '猫 犬');
  });

  test('editDistance and closeness', () => {
    assert.equal(editDistance('kitten', 'sitting'), 3);
    assert.equal(closeness('cat', 'cat'), 0);
    assert.equal(closeness('பூனையும்', 'பூனை'), 0.5); // an ending stuck to it
    assert.equal(closeness('القطة', 'قطة'), 0.5); // "the" in front (Arabic)
    assert.equal(closeness('달을', '달'), 0.5); // Korean particle
    assert.equal(closeness('kat', 'cat'), 1); // a small spelling difference
    assert.equal(closeness('banan', 'banana'), 1);
    assert.equal(closeness('dog', 'cat'), Infinity);
    assert.equal(closeness('er', 'ei'), Infinity); // two-letter words must be exact
  });

  test('English: order, punctuation, case, variants, filler words, small mistakes', () => {
    assert.equal(check('en', 'Cat, moon!', ['cat', 'moon']).ok, true);
    assert.equal(check('en', 'kitty and then the moon', ['cat', 'moon']).ok, true);
    assert.equal(check('en', 'kat moon', ['cat', 'moon']).ok, true);
    assert.equal(check('en', 'bananas mangoes', ['banana', 'mango']).ok, true);
    assert.equal(check('en', 'moon cat', ['cat', 'moon']).ok, false); // wrong order
    assert.deepEqual(check('en', 'cat', ['cat', 'moon']), { matched: 1, ok: false }); // one missing
    assert.equal(check('en', 'car moon', ['cat', 'moon']).ok, false); // "car" is another picture word
    assert.equal(check('en', '', ['cat']).ok, false);
  });

  test('Tamil: words with endings, colloquial forms and punctuation', () => {
    assert.equal(check('ta', 'பூனை, நிலா.', ['cat', 'moon']).ok, true);
    assert.equal(check('ta', 'பூனையும் நிலாவும் மரமும்', ['cat', 'moon', 'tree']).ok, true);
    assert.equal(check('ta', 'பூன மீன் பூ', ['cat', 'fish', 'flower']).ok, true);
    assert.equal(check('ta', 'தண்ணி பஸ்', ['water', 'bus']).ok, true);
    assert.equal(check('ta', 'நிலா பூனை', ['cat', 'moon']).ok, false);
  });

  test('other languages: Korean particles, Chinese and Japanese without spaces, Arabic "al-", Vietnamese two-word names, Russian cases', () => {
    assert.equal(check('ko', '고양이가 달을 봐요', ['cat', 'moon']).ok, true);
    assert.equal(check('zh', '猫，月亮，树。', ['cat', 'moon', 'tree']).ok, true);
    assert.equal(check('zh', '月亮猫', ['cat', 'moon']).ok, false);
    assert.equal(check('ja', 'ねこといぬ', ['cat', 'dog']).ok, true);
    assert.equal(check('ja', '猫と月', ['cat', 'moon']).ok, true);
    assert.equal(check('ar', 'القطة والقمر', ['cat', 'moon']).ok, true);
    assert.equal(check('vi', 'con mèo và mặt trăng', ['cat', 'moon']).ok, true);
    assert.equal(check('ru', 'кошку и луну', ['cat', 'moon']).ok, true);
    assert.equal(check('hi', 'बिल्ली, चाँद और पेड़', ['cat', 'moon', 'tree']).ok, true);
    assert.equal(check('es', 'el gato y la luna', ['cat', 'moon']).ok, true);
    assert.equal(check('de', 'Katze, Mond, Ei', ['cat', 'moon', 'egg']).ok, true);
    assert.equal(check('tr', 'kedi ay ayakkabı', ['cat', 'moon', 'shoe']).ok, true);
  });

  test('property (all 20 languages): saying the shown names in order always passes', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LOCALES), fc.integer({ min: 1, max: 11 }), (code, level) => {
        const sequence = makeSequence(level);
        return check(code, say(code, sequence), sequence).ok;
      }),
      { numRuns: 300 }
    );
  });

  test('every language: all 30 shown names said in a row are all recognised', () => {
    for (const code of LOCALES) {
      const result = check(code, say(code, WORD_IDS), WORD_IDS);
      assert.equal(result.matched, 30, `${code} recognised only ${result.matched}`);
    }
  });

  test('every language: each variant counts for its own word', () => {
    for (const code of LOCALES) {
      for (const id of WORD_IDS) {
        for (const form of ALL[code].forms[id]) {
          assert.equal(check(code, form, [id]).ok, true, `${code} ${id} "${form}"`);
        }
      }
    }
  });

  test('property (spaced languages): two words said the other way round do not pass', () => {
    const spaced = LOCALES.filter((code) => !NO_SPACES.includes(code));
    fc.assert(
      fc.property(fc.constantFrom(...spaced), (code) => {
        const sequence = makeSequence(1);
        return check(code, say(code, [...sequence].reverse()), sequence).ok === false;
      }),
      { numRuns: 200 }
    );
  });
});

describe('best level', () => {
  function memoryStorage() {
    const data = new Map();
    return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
  }
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };

  test('only a better level is saved', () => {
    const storage = memoryStorage();
    assert.equal(loadBest(storage), 0);
    assert.equal(saveBest(storage, 3), 3);
    assert.equal(saveBest(storage, 2), 3);
    assert.equal(loadBest(storage), 3);
    assert.equal(storage.data.get(BEST_KEY), '3');
  });

  test('damaged or blocked storage never throws', () => {
    const storage = memoryStorage();
    storage.setItem(BEST_KEY, 'lots');
    assert.equal(loadBest(storage), 0);
    assert.equal(loadBest(broken), 0);
    assert.equal(saveBest(broken, 4), 4);
  });
});
