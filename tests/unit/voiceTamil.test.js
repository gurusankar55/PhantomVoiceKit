// tests/unit/voiceTamil.test.js
// Faults found in the Tamil voice test in Edge: automatic full stops, number words said in the
// chosen language, letter names in the chosen language, whole-number phone fields and options in
// the chosen language. Pure functions, a fake recognizer and routes only: no browser, no Gemini.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import fc from 'fast-check';

import { stripPunctuation, joinParts, transcriptFromResults } from '../../skeleton/speech-utils.js';
import { createSpeechInput } from '../../skeleton/speech-input.js';
import { parseSpokenDate, parsePattern, chunksOf, BUILTIN_PATTERNS } from '../../skeleton/field-formats.js';
import { cleanDate, cleanByKind, cleanNumber } from '../../apps/spirit-clerk/answer-cleaning.js';
import { DIGIT_WORDS, REPEAT_WORDS, numberWordTable, numbersToDigits, baseLanguage } from '../../skeleton/spoken-numbers.js';
import { LETTER_NAMES, EXAMPLE_LINKS, letterNameMap } from '../../apps/spirit-clerk/letter-names.js';
import { spokenToChars, parseEmailSpeech } from '../../apps/spirit-clerk/spoken-chars.js';
import { COMMON_OPTIONS, commonOptionKey, localizedOption } from '../../apps/spirit-clerk/choice-words.js';
import { matchOptionWords, optionEntries } from '../../apps/spirit-clerk/option-utils.js';
import { needsGemini, NUMERIC_KINDS, isEnglishLang } from '../../apps/spirit-clerk/answer-flow.js';
import { createTranslateRouter } from '../../server/routes/translate.js';

const LOCALES_DIR = path.join(process.cwd(), 'skeleton', 'locales');
const CODES = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort();

const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });

// ---------- 1. Automatic punctuation ----------

describe('stripPunctuation: the marks Edge adds after every pause', () => {
  test('"13." and "13. 05. 1987" lose their full stops', () => {
    assert.equal(stripPunctuation('13.'), '13');
    assert.equal(stripPunctuation('13. 05. 1987'), '13 05 1987');
    assert.equal(stripPunctuation('98765, 43210?'), '98765 43210');
  });

  test('every sentence mark of the 20 languages', () => {
    for (const mark of ['.', ',', '?', '!', ';', ':', '।', '॥', '۔', '。', '、', '，', '！', '？', '،', '؛', '؟', '…', '¿', '¡']) {
      assert.equal(stripPunctuation(`ab${mark} cd`), 'ab cd', mark);
      assert.equal(stripPunctuation(`${mark}ab${mark}`), 'ab', mark);
    }
  });

  test('apostrophes, hyphens, slashes and @ stay', () => {
    assert.equal(stripPunctuation("O'Neil, Anna-Nagar"), "O'Neil Anna-Nagar");
    assert.equal(stripPunctuation('13/05/1987.'), '13/05/1987');
    assert.equal(stripPunctuation('john@gmail'), 'john@gmail');
  });

  test('spaces are tidied: one space between words, none at the ends', () => {
    assert.equal(stripPunctuation('  a  .  b ,, c  '), 'a b c');
    assert.equal(stripPunctuation('...'), '');
    assert.equal(stripPunctuation(undefined), '');
  });

  test('property: no sentence punctuation and no double space is ever left', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const out = stripPunctuation(text);
        assert.ok(!/[.,?!;:。、，！？；：…।॥۔،؛؟¿¡]/u.test(out));
        assert.ok(!out.includes('  '));
        assert.equal(out, out.trim());
        assert.equal(stripPunctuation(out), out);
      }),
      { numRuns: 200 }
    );
  });

  test('the parts heard before and after a pause are joined with ONE space, without marks', () => {
    assert.equal(joinParts(['13.', '05.', '1987.']), '13 05 1987');
    assert.equal(joinParts(['98765,', '', '43210?']), '98765 43210');
    assert.deepEqual(transcriptFromResults([result('13.', true), result('05.', true), result('19', false)]), { final: '13 05', interim: '19' });
  });

  test('"13. 05. 1987" becomes 13/05/1987', () => {
    assert.equal(parseSpokenDate(stripPunctuation('13. 05. 1987')), '13/05/1987');
    assert.equal(cleanDate(stripPunctuation('13. 05. 1987')), '13/05/1987');
    assert.equal(cleanByKind(stripPunctuation('13. 05. 1987.'), 'date'), '13/05/1987');
  });

  test('digit by digit: "1 3 0 5 1 9 8 7" is a date too', () => {
    assert.equal(parseSpokenDate('1 3 0 5 1 9 8 7'), '13/05/1987');
  });

  test('a phone number said in parts has no dots between the parts', () => {
    assert.equal(cleanNumber(stripPunctuation('98765. 43210.')), '9876543210');
  });
});

describe('the recognizer strips the marks from interim and final text', () => {
  let created;
  class FakeRecognition {
    constructor() {
      this.running = false;
      created.push(this);
    }
    start() {
      this.running = true;
    }
    stop() {
      this.running = false;
      setImmediate(() => this.onend && this.onend());
    }
    abort() {
      this.running = false;
    }
    say(...results) {
      this.onresult({ results });
    }
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(() => {
    created = [];
    globalThis.window = { SpeechRecognition: FakeRecognition };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  test('continuous listening: live text and the final text have no full stops', async () => {
    const seen = { results: [], interim: [] };
    const input = createSpeechInput({
      lang: 'ta-IN',
      onResult: (text) => seen.results.push(text),
      onError: () => {},
      onInterim: (text) => seen.interim.push(text),
    });
    const recognition = created[0];
    input.start({ continuous: true, safetyMs: 60_000 });
    recognition.say(result('13.', true));
    recognition.say(result('13.', true), result('05.', true));
    recognition.say(result('13.', true), result('05.', true), result('1987.', false));
    assert.deepEqual(seen.interim, ['13', '13 05', '13 05 1987']);
    input.finish();
    await sleep(30);
    assert.deepEqual(seen.results, ['13 05 1987']);
  });

  test('one-phrase listening: inner marks go too, not only the last one', async () => {
    const seen = [];
    const input = createSpeechInput({ lang: 'ta-IN', onResult: (text) => seen.push(text), onError: () => {} });
    created[0].onend = created[0].onend || (() => {});
    input.start();
    created[0].say(result('98765, 43210.', true));
    assert.deepEqual(seen, ['98765 43210']);
    input.stop();
  });
});

// ---------- 2. Number words of the 20 languages ----------

describe('number word tables', () => {
  test('there is a table for every one of the 20 languages', () => {
    assert.deepEqual(Object.keys(DIGIT_WORDS).sort(), CODES);
  });

  for (const code of CODES) {
    test(`${code}: every digit 0 to 9 has words, none is used for two digits`, () => {
      const table = DIGIT_WORDS[code];
      assert.equal(table.length, 10);
      const seen = new Map();
      table.forEach((words, digit) => {
        assert.ok(words.length >= 1 && words.every((w) => typeof w === 'string' && w.trim() !== ''), `digit ${digit} has no word`);
        for (const word of words) {
          const key = word.normalize('NFKC').toLowerCase();
          assert.ok(!seen.has(key) || seen.get(key) === digit, `${word} is the word of ${seen.get(key)} and of ${digit}`);
          seen.set(key, digit);
        }
      });
    });

    test(`${code}: every word becomes its digit (also together with the English words)`, () => {
      DIGIT_WORDS[code].forEach((words, digit) => {
        for (const word of words) {
          assert.equal(numbersToDigits(word, `${code}-XX`).replace(/\s/g, ''), String(digit), `${code}: ${word}`);
        }
      });
      // English digit words always work too
      assert.equal(numbersToDigits('nine eight seven', code), '9 8 7');
    });

    test(`${code}: the language and English never give one word two digits`, () => {
      const { words } = numberWordTable(code);
      const english = numberWordTable('en').words;
      for (const [word, digit] of english) {
        if (words.has(word)) assert.equal(words.get(word), digit, `${word}`);
      }
    });
  }

  test('"double" and "triple" exist for the languages that say them', () => {
    for (const [code, table] of Object.entries(REPEAT_WORDS)) {
      assert.ok(CODES.includes(code), code);
      for (const times of Object.values(table)) assert.ok(times === 2 || times === 3);
    }
  });

  test('numbers in a text keep the other words and repeat words need a number', () => {
    assert.equal(numbersToDigits('call nine eight now', 'en-US'), 'call 9 8 now');
    assert.equal(numbersToDigits('double u', 'en-US'), 'double u');
    assert.equal(baseLanguage('ta-IN'), 'ta');
  });

  test('digits written in the script of the language become 0-9', () => {
    assert.equal(numbersToDigits('௧௩ ௦௫', 'ta-IN'), '13 05');
    assert.equal(numbersToDigits('९८७', 'hi-IN'), '987');
    assert.equal(numbersToDigits('٣٤', 'ar-SA'), '34');
  });
});

describe('Tamil examples from the test in Edge', () => {
  test('"மூணு" is 3 (it was heard as "Wonder" with English recognition)', () => {
    assert.equal(numbersToDigits('மூணு', 'ta-IN'), '3');
    assert.equal(spokenToChars('மூணு', 'digits', 'ta-IN'), '3');
  });

  test('all the digits, standard and colloquial', () => {
    const standard = 'பூஜ்யம் ஒன்று இரண்டு மூன்று நான்கு ஐந்து ஆறு ஏழு எட்டு ஒன்பது';
    const colloquial = 'சைபர் ஒண்ணு ரெண்டு மூணு நாலு அஞ்சு ஆறு ஏழு எட்டு ஒம்பது';
    assert.equal(spokenToChars(standard, 'digits', 'ta-IN'), '0123456789');
    assert.equal(spokenToChars(colloquial, 'digits', 'ta-IN'), '0123456789');
    assert.equal(numbersToDigits(colloquial, 'ta-IN'), '0 1 2 3 4 5 6 7 8 9');
  });

  test('"டபுள்" (double) and "ட்ரிபிள்" (triple), with a digit or a number word', () => {
    assert.equal(spokenToChars('டபுள் 5', 'digits', 'ta-IN'), '55');
    assert.equal(spokenToChars('டபுள் ஐந்து', 'digits', 'ta-IN'), '55');
    assert.equal(spokenToChars('ஒன்பது டபுள் எட்டு', 'digits', 'ta-IN'), '988');
    assert.equal(spokenToChars('ட்ரிபிள் 7', 'digits', 'ta-IN'), '777');
  });

  test('a Tamil mobile number said with pauses and full stops', () => {
    const heard = stripPunctuation('ஒன்பது. எட்டு. ஏழு. ஆறு. ஐந்து. நான்கு. மூன்று. இரண்டு. ஒன்று. சைபர்.');
    assert.equal(spokenToChars(heard, 'digits', 'ta-IN'), '9876543210');
    assert.equal(cleanByKind(numbersToDigits(heard, 'ta-IN'), 'phone', {}, BUILTIN_PATTERNS.mobile), '9876543210');
  });

  test('a Tamil date said word by word is a date', () => {
    const heard = stripPunctuation('ஒன்று. மூன்று. சைபர். ஐந்து. ஒன்று. ஒன்பது. எட்டு. ஏழு.');
    assert.equal(cleanDate(numbersToDigits(heard, 'ta-IN')), '13/05/1987');
  });

  test('English digit words also work in a Tamil answer', () => {
    assert.equal(spokenToChars('nine மூணு two', 'digits', 'ta-IN'), '932');
  });

  test('the digit part of a PAN and of an IFSC, and the e-mail name, in Tamil', () => {
    assert.equal(spokenToChars('ஒன்று இரண்டு மூன்று நான்கு', 'digits', 'ta-IN'), '1234');
    assert.equal(spokenToChars('சைபர் சைபர் ஒன்று இரண்டு மூன்று நான்கு', 'any', 'ta-IN'), '001234');
    assert.equal(parseEmailSpeech('ஜே ஓ எச் என் ஒன்று இரண்டு மூன்று', {}, 'ta-IN'), 'john123');
  });
});

describe('number words in the other languages', () => {
  test('examples', () => {
    assert.equal(spokenToChars('तीन चार पाँच', 'digits', 'hi-IN'), '345');
    assert.equal(spokenToChars('డబుల్ ఐదు', 'digits', 'te-IN'), '55');
    assert.equal(spokenToChars('മൂന്ന് നാല്', 'digits', 'ml-IN'), '34');
    assert.equal(spokenToChars('ಮೂರು ಏಳು', 'digits', 'kn-IN'), '37');
    assert.equal(spokenToChars('তিন সাত', 'digits', 'bn-IN'), '37');
    assert.equal(spokenToChars('تین سات', 'digits', 'ur-PK'), '37');
    assert.equal(spokenToChars('ثلاثة سبعة', 'digits', 'ar-SA'), '37');
    assert.equal(spokenToChars('trois sept', 'digits', 'fr-FR'), '37');
    assert.equal(spokenToChars('tres siete', 'digits', 'es-ES'), '37');
    assert.equal(spokenToChars('drei sieben', 'digits', 'de-DE'), '37');
    assert.equal(spokenToChars('три семь', 'digits', 'ru-RU'), '37');
    assert.equal(spokenToChars('tiga tujuh', 'digits', 'id-ID'), '37');
    assert.equal(spokenToChars('üç yedi', 'digits', 'tr-TR'), '37');
    assert.equal(spokenToChars('ba bảy', 'digits', 'vi-VN'), '37');
  });

  test('Chinese, Japanese and Korean have no spaces between the words', () => {
    assert.equal(spokenToChars('一三零五', 'digits', 'zh-CN'), '1305');
    assert.equal(spokenToChars('いちさんまるご', 'digits', 'ja-JP'), '1305');
    assert.equal(spokenToChars('일곱 삼 공 오', 'digits', 'ko-KR'), '7305');
    assert.equal(spokenToChars('일곱삼', 'digits', 'ko-KR'), '73');
  });
});

// ---------- 3. Letter names ----------

describe('letter names in the chosen language', () => {
  const LANGS = ['ta', 'hi', 'te', 'kn', 'ml', 'bn', 'ur'];
  const ALPHABET = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ');

  test('tables for the Indian-script languages, with all 26 letters', () => {
    assert.deepEqual(Object.keys(LETTER_NAMES).sort(), [...LANGS].sort());
    for (const lang of LANGS) {
      assert.deepEqual(Object.keys(LETTER_NAMES[lang]).sort(), ALPHABET, lang);
    }
  });

  for (const lang of LANGS) {
    test(`${lang}: no spelling is the name of two letters, and none is also a number word`, () => {
      const seen = new Map();
      for (const [letter, spellings] of Object.entries(LETTER_NAMES[lang])) {
        assert.ok(spellings.length >= 1);
        for (const spelling of spellings) {
          const key = spelling.normalize('NFKC').toLowerCase();
          assert.ok(!seen.has(key) || seen.get(key) === letter, `${spelling}: ${seen.get(key)} and ${letter}`);
          seen.set(key, letter);
        }
      }
      const numbers = numberWordTable(lang).words;
      for (const key of seen.keys()) assert.ok(!numbers.has(key), `${key} is a letter and a number`);
      assert.equal(letterNameMap(lang).size, seen.size);
    });

    test(`${lang}: every letter name is understood as its letter`, () => {
      for (const [letter, spellings] of Object.entries(LETTER_NAMES[lang])) {
        for (const spelling of spellings) assert.equal(spokenToChars(spelling, 'letters', `${lang}-XX`), letter, `${lang}: ${spelling}`);
      }
      const alphabet = ALPHABET.map((letter) => LETTER_NAMES[lang][letter][0]).join(' ');
      assert.equal(spokenToChars(alphabet, 'letters', lang), ALPHABET.join(''));
    });
  }

  test('the Tamil table is exactly the one that was asked for', () => {
    const wanted = { A: 'ஏ', B: 'பி', C: 'சி', D: 'டி', E: 'ஈ', F: 'எஃப்', G: 'ஜி', H: 'எச்', I: 'ஐ', J: 'ஜே', K: 'கே', L: 'எல்', M: 'எம்', N: 'என்', O: 'ஓ', P: 'பீ', Q: 'க்யூ', R: 'ஆர்', S: 'எஸ்', T: 'டீ', U: 'யூ', V: 'வி', W: 'டபிள்யூ', X: 'எக்ஸ்', Y: 'ஒய்', Z: 'இசட்' };
    for (const [letter, spelling] of Object.entries(wanted)) {
      assert.equal(LETTER_NAMES.ta[letter][0], spelling, letter);
    }
  });

  test('a PAN spelled in Tamil: letters, digits and the last letter', () => {
    assert.equal(spokenToChars('ஏ பி சி டி ஈ', 'letters', 'ta-IN'), 'ABCDE');
    assert.equal(spokenToChars('ஒன்று இரண்டு மூன்று நான்கு', 'digits', 'ta-IN'), '1234');
    assert.equal(spokenToChars('எஃப்', 'letters', 'ta-IN'), 'F');
    assert.equal(spokenToChars('ஏ பி சி டி ஈ ஒன்று இரண்டு மூன்று நான்கு எஃப்', 'any', 'ta-IN'), 'ABCDE1234F');
  });

  test('English letter names and "B for Bombay" still work in a Tamil answer', () => {
    assert.equal(spokenToChars('A B C', 'letters', 'ta-IN'), 'ABC');
    assert.equal(spokenToChars('b for bombay', 'letters', 'ta-IN'), 'B');
    assert.equal(spokenToChars('பி ஃபார் பாம்பே', 'letters', 'ta-IN'), 'B');
    assert.equal(spokenToChars('बी फॉर बॉम्बे', 'letters', 'hi-IN'), 'B');
    assert.ok(Object.keys(EXAMPLE_LINKS).every((lang) => LANGS.includes(lang)));
  });

  test('without a table the English names still work (and a Tamil name is ignored)', () => {
    assert.equal(spokenToChars('bee see', 'letters', 'fr-FR'), 'BC');
    assert.equal(spokenToChars('பி', 'letters', 'en-US'), '');
  });

  test('property: the result only has capital letters and digits, whatever the language', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom('letters', 'digits', 'any'), fc.constantFrom('ta-IN', 'hi-IN', 'en-IN', 'zh-CN', 'ja-JP', 'ar-SA', ''), (text, type, lang) => {
        assert.match(spokenToChars(text, type, lang), /^[A-Z0-9]*$/);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------- 4. Phone, PIN and Aadhaar in one turn ----------

describe('only codes that mix letters and digits are asked in groups', () => {
  const lengths = (pattern) => chunksOf(parsePattern(pattern)).map((chunk) => chunk.length);

  test('phone, PIN and Aadhaar: the whole number in ONE group', () => {
    assert.deepEqual(lengths(BUILTIN_PATTERNS.mobile), [10]);
    assert.deepEqual(lengths(BUILTIN_PATTERNS.pin), [6]);
    assert.deepEqual(lengths(BUILTIN_PATTERNS.aadhaar), [12]);
  });

  test('PAN and IFSC are still asked group by group', () => {
    assert.deepEqual(lengths(BUILTIN_PATTERNS.pan), [5, 4, 1]);
    assert.deepEqual(lengths(BUILTIN_PATTERNS.ifsc), [4, 6]);
  });

  test('a number that Gemini could not read is sent to Gemini; a read number is not', () => {
    assert.equal(needsGemini({ kind: 'phone' }, 'வணக்கம்', '', 'ta-IN'), true);
    assert.equal(needsGemini({ kind: 'phone' }, 'மூணு', '3', 'ta-IN'), false);
    assert.equal(needsGemini({ kind: 'number' }, 'hello', '', 'en-US'), false);
    assert.ok(NUMERIC_KINDS.includes('date') && NUMERIC_KINDS.includes('phone') && NUMERIC_KINDS.includes('number') && NUMERIC_KINDS.includes('code'));
    assert.equal(isEnglishLang('en-IN'), true);
    assert.equal(isEnglishLang('ta-IN'), false);
  });
});

// ---------- 5. Options in the chosen language ----------

describe('Male, Female, Other in the 20 languages', () => {
  test('every language has all three, with at least one way to say each', () => {
    for (const key of ['male', 'female', 'other']) {
      assert.deepEqual(Object.keys(COMMON_OPTIONS[key]).sort(), CODES.filter((code) => code !== 'en'), key);
      for (const [code, forms] of Object.entries(COMMON_OPTIONS[key])) {
        assert.ok(forms.length >= 1 && forms.every((f) => f.trim() !== ''), `${key} ${code}`);
      }
    }
  });

  test('the printed English labels are found', () => {
    assert.equal(commonOptionKey('Male'), 'male');
    assert.equal(commonOptionKey(' FEMALE '), 'female');
    assert.equal(commonOptionKey('M'), 'male');
    assert.equal(commonOptionKey('Others'), 'other');
    assert.equal(commonOptionKey('Married'), null);
  });

  test('Tamil buttons: ஆண், பெண், மற்றவை; English gives nothing to translate', () => {
    assert.equal(localizedOption('Male', 'ta-IN').label, 'ஆண்');
    assert.equal(localizedOption('Female', 'ta-IN').label, 'பெண்');
    assert.equal(localizedOption('Other', 'ta-IN').label, 'மற்றவை');
    assert.equal(localizedOption('Married', 'ta-IN'), null);
    assert.equal(localizedOption('Male', 'en-US'), null);
  });

  test('a form of one word in any language is different from the forms of the others', () => {
    for (const code of CODES.filter((c) => c !== 'en')) {
      const all = ['male', 'female', 'other'].flatMap((key) => COMMON_OPTIONS[key][code].map((form) => form.normalize('NFKC').toLowerCase()));
      assert.equal(new Set(all).size, all.length, code);
    }
  });
});

describe('saying the option: the printed word or the chosen language, also colloquial', () => {
  const options = [{ value: 'Male' }, { value: 'Female' }, { value: 'Other' }];
  const localized = options.map((option) => localizedOption(option.value, 'ta-IN'));
  const entries = optionEntries(options, localized);
  const say = (text) => matchOptionWords(text, entries);

  test('Tamil words and the colloquial "மேல்" / "ஃபீமேல்"', () => {
    assert.equal(say('ஆண்'), 0);
    assert.equal(say('மேல்'), 0);
    assert.equal(say('பெண்'), 1);
    assert.equal(say('ஃபீமேல்'), 1);
    assert.equal(say('பீமேல்'), 1);
    assert.equal(say('மற்றவை'), 2);
  });

  test('the printed English word still works; "female" is not "male"', () => {
    assert.equal(say('male'), 0);
    assert.equal(say('Female.'), 1);
    assert.equal(say('other'), 2);
    assert.equal(say('I am female'), 1);
  });

  test('a sentence with the option, and unknown words', () => {
    assert.equal(say('நான் ஆண்'), 0);
    assert.equal(say('வணக்கம்'), -1);
    assert.equal(say(''), -1);
  });

  test('the forms of ONE option never compete with each other', () => {
    const two = optionEntries([{ value: 'Male' }], [{ label: 'ஆண்', aliases: ['ஆண்', 'மேல்'] }]);
    assert.equal(matchOptionWords('ஆண் மேல்', two), 0);
  });

  test('two options in one sentence pick the longest matching label', () => {
    assert.equal(say('ஆண் பெண்'), 1);
  });

  test('without a translation only the printed words work', () => {
    const plain = optionEntries(options, []);
    assert.equal(matchOptionWords('female', plain), 1);
    assert.equal(matchOptionWords('பெண்', plain), -1);
  });
});

describe('translate with a list (the options of a choice field in one call)', () => {
  function appWith(fake) {
    const app = express();
    app.use(express.json());
    app.use('/api/translate', createTranslateRouter(fake));
    return app;
  }

  test('one call; the reply keeps the order and has aliases', async () => {
    let calls = 0;
    let prompt = '';
    const app = appWith(async (args) => {
      calls += 1;
      prompt = args.prompt;
      return { translations: [{ label: 'திருமணமானவர்', aliases: ['மேரீட்'] }, { label: 'திருமணமாகாதவர்' }] };
    });
    const res = await request(app).post('/api/translate').send({ list: ['Married', 'Single'], targetLang: 'Tamil' });
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
    assert.deepEqual(res.body, {
      translations: [
        { label: 'திருமணமானவர்', aliases: ['மேரீட்'] },
        { label: 'திருமணமாகாதவர்', aliases: [] },
      ],
    });
    assert.ok(prompt.includes('["Married","Single"]'));
    assert.ok(prompt.includes('Tamil'));
  });

  test('a reply that is too short still has one item for every option', async () => {
    const app = appWith(async () => ({ translations: [{ label: 'ஆண்' }] }));
    const res = await request(app).post('/api/translate').send({ list: ['Male', 'Female'], targetLang: 'ta-IN' });
    assert.deepEqual(res.body.translations, [{ label: 'ஆண்', aliases: [] }, { label: '', aliases: [] }]);
  });

  test('an empty list or no language is rejected without a call', async () => {
    let calls = 0;
    const app = appWith(async () => {
      calls += 1;
      return {};
    });
    assert.equal((await request(app).post('/api/translate').send({ list: [], targetLang: 'ta-IN' })).status, 400);
    assert.equal((await request(app).post('/api/translate').send({ list: ['Male'] })).status, 400);
    assert.equal((await request(app).post('/api/translate').send({ list: [42, ''], targetLang: 'ta-IN' })).status, 400);
    assert.equal(calls, 0);
  });
});
