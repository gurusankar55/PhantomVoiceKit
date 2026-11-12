// tests/unit/translationRules.test.js
// Which text may stay unchanged in a translation (skeleton/translation-rules.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isLatinScriptLang,
  scriptNameFor,
  stripKeepAsIs,
  isKeepAsIs,
  hasLeftoverLatin,
} from '../../skeleton/translation-rules.js';

describe('isLatinScriptLang / scriptNameFor', () => {
  test('Latin-script languages', () => {
    for (const code of ['en-US', 'es-ES', 'fr-FR', 'pt-BR', 'id-ID', 'de-DE', 'vi-VN', 'tr-TR', 'en']) {
      assert.equal(isLatinScriptLang(code), true, code);
      assert.equal(scriptNameFor(code), '', code);
    }
  });

  test('every other supported language has its own script', () => {
    for (const code of ['ta-IN', 'hi-IN', 'te-IN', 'kn-IN', 'ml-IN', 'ko-KR', 'zh-CN', 'ja-JP', 'ar-SA', 'ru-RU', 'bn-IN', 'ur-PK']) {
      assert.equal(isLatinScriptLang(code), false, code);
      assert.notEqual(scriptNameFor(code), '', code);
    }
  });
});

describe('isKeepAsIs: only e-mail, links, numbers, dates and ID codes', () => {
  test('allowed texts', () => {
    for (const text of [
      'name@example.com', 'a.b-c@mail.co.in', 'https://example.com/path?x=1', 'www.example.com', 'example.com',
      '12345', '3.14', '12/03/1990', '1990-03-12', '₹ 1,200.50', '+91 98765 43210', '(044) 2345 6789', '50%',
      'ABCDE1234F', 'SBIN0001234', 'A-123/45',
    ]) {
      assert.equal(isKeepAsIs(text), true, text);
    }
  });

  test('names, brands and words are NOT allowed to stay', () => {
    for (const text of ['John', 'Doe', 'CoinMarketCap', 'ghilli', 'Submit', 'First name', 'Date of birth', 'March']) {
      assert.equal(isKeepAsIs(text), false, text);
    }
  });

  test('a mix of words and a number is not "only" an exception', () => {
    assert.equal(isKeepAsIs('Phone 98765'), false);
    assert.equal(isKeepAsIs('Email: john@example.com'), false);
  });

  test('empty text is not an exception', () => {
    assert.equal(isKeepAsIs(''), false);
    assert.equal(isKeepAsIs('   '), false);
    assert.equal(isKeepAsIs(undefined), false);
  });
});

describe('stripKeepAsIs', () => {
  test('removes e-mail, links and every word with a digit', () => {
    assert.equal(stripKeepAsIs('Write to john@example.com or see www.example.com now'), 'Write to or see now');
    // the comma belongs to the removed word "ABCDE1234F,"
    assert.equal(stripKeepAsIs('PAN ABCDE1234F, born 12/03/1990'), 'PAN born');
  });

  test('keeps text in other scripts', () => {
    assert.equal(stripKeepAsIs('பெயர் 12'), 'பெயர்');
  });
});

describe('hasLeftoverLatin (a word stayed in English)', () => {
  test('fully translated text has none', () => {
    assert.equal(hasLeftoverLatin('காயின்மார்க்கெட்கேப்'), false);
    assert.equal(hasLeftoverLatin('கில்லி'), false);
    assert.equal(hasLeftoverLatin('ஜான்'), false);
    assert.equal(hasLeftoverLatin('வணக்கம் 12/03/1990'), false);
  });

  test('allowed exceptions do not count', () => {
    assert.equal(hasLeftoverLatin('மின்னஞ்சல்: john@example.com'), false);
    assert.equal(hasLeftoverLatin('எண் ABCDE1234F'), false);
    assert.equal(hasLeftoverLatin('இணையதளம் www.example.com'), false);
  });

  test('only the code VALUE may stay: the word PAN itself must be written in the target script', () => {
    assert.equal(hasLeftoverLatin('PAN எண்'), true);
  });

  test('a name, brand or word left in Latin letters counts', () => {
    assert.equal(hasLeftoverLatin('John'), true);
    assert.equal(hasLeftoverLatin('CoinMarketCap வழியாக'), true);
    assert.equal(hasLeftoverLatin('ghilli'), true);
    assert.equal(hasLeftoverLatin('பெயர் Name'), true);
  });

  test('Cyrillic, Arabic and CJK text is not Latin', () => {
    for (const text of ['Джон', 'جون', '约翰', 'ジョン', '존']) assert.equal(hasLeftoverLatin(text), false, text);
  });
});

// ---------- AM and PM ----------

import { translateTimeWords } from '../../skeleton/translation-rules.js';
import { SAMPLES } from '../fixtures/layout-samples.js';

describe('translateTimeWords: AM and PM in every language', () => {
  const NON_EN = ['ta', 'hi', 'te', 'kn', 'ml', 'bn', 'ko', 'zh', 'ja', 'ar', 'ur', 'ru', 'es', 'fr', 'vi', 'tr'];

  test('AM and PM are replaced by the words of the language; the numbers stay', () => {
    for (const code of NON_EN) {
      const bcp47 = SAMPLES[code].bcp47;
      const result = translateTimeWords('Open 10:30 AM - 5:00 PM', bcp47);
      assert.ok(!/\b(AM|PM)\b/.test(result), `${code}: ${result}`);
      assert.ok(result.includes('10:30') && result.includes('5:00'), `${code}: ${result}`);
      assert.notEqual(result, 'Open 10:30 AM - 5:00 PM', code);
    }
  });

  test('AM and PM get different words', () => {
    for (const code of NON_EN) {
      const am = translateTimeWords('AM', SAMPLES[code].bcp47);
      const pm = translateTimeWords('PM', SAMPLES[code].bcp47);
      assert.notEqual(am, pm, code);
    }
  });

  test('real examples', () => {
    assert.equal(translateTimeWords('10:30 AM', 'hi-IN'), '10:30 पूर्वाह्न');
    assert.equal(translateTimeWords('5:00 PM', 'hi-IN'), '5:00 अपराह्न');
    assert.equal(translateTimeWords('9 AM - 4 PM', 'ta-IN'), '9 முற்பகல் - 4 பிற்பகல்');
    assert.equal(translateTimeWords('10:30 AM', 'ko-KR'), '10:30 오전');
    assert.equal(translateTimeWords('5:00 PM', 'ja-JP'), '5:00 午後');
    assert.equal(translateTimeWords('10:30 AM', 'ar-SA'), '10:30 ص');
  });

  test('other spellings: a.m., P. M., am / pm after a digit', () => {
    assert.equal(translateTimeWords('10:30 a.m.', 'hi'), '10:30 पूर्वाह्न');
    assert.equal(translateTimeWords('5:00 p. m.', 'hi'), '5:00 अपराह्न');
    assert.equal(translateTimeWords('5:00 P.M.', 'hi'), '5:00 अपराह्न');
    assert.equal(translateTimeWords('10:30am', 'hi'), '10:30पूर्वाह्न');
    assert.equal(translateTimeWords('5 pm', 'hi'), '5 अपराह्न');
  });

  test('the word "am", "pm" inside text and letters inside other words are not touched', () => {
    assert.equal(translateTimeWords('I am here', 'hi'), 'I am here');
    assert.equal(translateTimeWords('Samsung PMS CAMP', 'hi'), 'Samsung PMS CAMP');
    assert.equal(translateTimeWords('AMERICA', 'hi'), 'AMERICA');
  });

  test('languages that write AM / PM themselves, and English, are unchanged', () => {
    for (const lang of ['en-US', 'pt-BR', 'id-ID', 'de-DE']) {
      assert.equal(translateTimeWords('Open 10:30 AM - 5:00 PM', lang), 'Open 10:30 AM - 5:00 PM', lang);
    }
  });

  test('empty and missing text', () => {
    assert.equal(translateTimeWords('', 'hi'), '');
    assert.equal(translateTimeWords(undefined, 'hi'), '');
  });

  test('a time with a translated word has no leftover English (so it is not counted in the log)', () => {
    assert.equal(hasLeftoverLatin(translateTimeWords('Open 10:30 AM', 'ta-IN').replace('Open', 'திறந்திருக்கும்')), false);
    assert.equal(hasLeftoverLatin('திறந்திருக்கும் 10:30 AM'), true);
  });
});
