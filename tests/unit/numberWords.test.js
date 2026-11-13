// numberWords.test.js
// Numbers 0 to 20 said in the 20 languages (Pumpkin math), and the remembered language.
// Real locale files, no browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';

import { spokenNumber, numberFormsFrom, numberKey, MAX_NUMBER } from '../../skeleton/number-words.js';
import { readLanguageCode, saveLanguageCode, LANGUAGE_KEY } from '../../skeleton/language-store.js';

const LOCALES = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr'];
const BCP47 = { en: 'en-US', ta: 'ta-IN', hi: 'hi-IN', te: 'te-IN', kn: 'kn-IN', ml: 'ml-IN', ko: 'ko-KR', zh: 'zh-CN', ja: 'ja-JP', es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA', pt: 'pt-BR', ru: 'ru-RU', bn: 'bn-IN', ur: 'ur-PK', id: 'id-ID', de: 'de-DE', vi: 'vi-VN', tr: 'tr-TR' };
const strings = (code) => JSON.parse(readFileSync(new URL(`../../skeleton/locales/${code}.json`, import.meta.url), 'utf8'));
const FORMS = Object.fromEntries(LOCALES.map((code) => [code, numberFormsFrom(strings(code))]));
const hear = (code, text) => spokenNumber(text, BCP47[code], FORMS[code]);

describe('spokenNumber: 0 to 20 in every language', () => {
  test('every language has words for 0 to 20', () => {
    for (const code of LOCALES) {
      assert.equal(FORMS[code].length, MAX_NUMBER + 1);
      FORMS[code].forEach((forms, n) => assert.ok(forms.length > 0, `${code} ${numberKey(n)}`));
    }
  });

  test('every language: each word of each number gives that number', () => {
    for (const code of LOCALES) {
      FORMS[code].forEach((forms, n) => {
        for (const form of forms) assert.equal(hear(code, form), n, `${code} "${form}" should be ${n}`);
      });
    }
  });

  test('digits in any script, also inside a sentence', () => {
    assert.equal(hear('en', 'it is 12'), 12);
    assert.equal(hear('ta', '௧௨'), 12);
    assert.equal(hear('ar', '١٥'), 15);
    assert.equal(hear('hi', '७'), 7);
    assert.equal(hear('ja', '１８'), 18);
  });

  test('examples with words around the number and colloquial forms', () => {
    assert.equal(hear('en', 'I think it is eighteen.'), 18);
    assert.equal(hear('ta', 'பன்னெண்டு பூசணி'), 12);
    assert.equal(hear('ta', 'மூணு'), 3);
    assert.equal(hear('fr', 'dix-sept'), 17);
    assert.equal(hear('fr', 'dix'), 10);
    assert.equal(hear('zh', '十二个'), 12);
    assert.equal(hear('zh', '二十'), 20);
    assert.equal(hear('ja', 'じゅうに'), 12);
    assert.equal(hear('vi', 'mười lăm'), 15);
    assert.equal(hear('de', 'dreizehn'), 13);
    assert.equal(hear('ru', 'пятнадцать'), 15);
    assert.equal(hear('ar', 'ثلاثة عشر'), 13);
  });

  test('digit words of Spirit Clerk as the last try: "one two" is 12', () => {
    assert.equal(spokenNumber('ஒண்ணு ரெண்டு', 'ta-IN', []), 12);
  });

  test('nothing that is a number: null', () => {
    assert.equal(hear('en', 'pumpkin'), null);
    assert.equal(hear('en', ''), null);
    assert.equal(spokenNumber('hello', 'en-US', null), null);
  });

  test('property: any number 0-20 said with its first word in any language is understood', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LOCALES), fc.integer({ min: 0, max: 20 }), (code, n) => hear(code, FORMS[code][n][0]) === n),
      { numRuns: 300 }
    );
  });
});

describe('the remembered language', () => {
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

  test('saved in localStorage (and sessionStorage), read back by every tab', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    assert.equal(saveLanguageCode('ta-IN', local, session, 'Tamil'), true);
    assert.equal(local.data.get(LANGUAGE_KEY), 'ta-IN');
    assert.equal(session.data.get('chosenLang'), 'ta-IN');
    assert.equal(readLanguageCode(local, memoryStorage()), 'ta-IN', 'a new tab has an empty sessionStorage');
  });

  test('an older choice in sessionStorage still works; localStorage wins', () => {
    const session = memoryStorage();
    session.setItem('chosenLang', 'hi-IN');
    assert.equal(readLanguageCode(memoryStorage(), session), 'hi-IN');
    const local = memoryStorage();
    local.setItem(LANGUAGE_KEY, 'ko-KR');
    assert.equal(readLanguageCode(local, session), 'ko-KR');
  });

  test('blocked storage, nothing saved or a bad value: empty, never an error', () => {
    assert.equal(readLanguageCode(broken, broken), '');
    assert.equal(readLanguageCode(null, null), '');
    assert.equal(saveLanguageCode('ta-IN', broken, broken), false);
    const local = memoryStorage();
    local.setItem(LANGUAGE_KEY, '<script>');
    assert.equal(readLanguageCode(local, null), '');
    assert.equal(saveLanguageCode('not a code!', memoryStorage(), null), false);
  });
});
