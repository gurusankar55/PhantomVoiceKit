// tests/unit/answerCleaning.test.js
// Cleaning of heard answers by the kind of field (apps/spirit-clerk/answer-cleaning.js),
// and the "at" / "dot" words of every language.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';

import {
  normalizeDigits,
  cleanNumber,
  cleanCode,
  cleanEmail,
  cleanByKind,
  cleanHeard,
  hasNonLatinLetters,
  isStrictKind,
} from '../../apps/spirit-clerk/answer-cleaning.js';
import { parseWords } from '../../skeleton/voice-commands.js';

const LOCALES_DIR = path.join(process.cwd(), 'skeleton', 'locales');
const codes = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
const load = (code) => JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), 'utf8'));

describe('normalizeDigits', () => {
  test('digits of other scripts become 0-9', () => {
    assert.equal(normalizeDigits('௯௮௭'), '987'); // Tamil
    assert.equal(normalizeDigits('٠١٢٣'), '0123'); // Arabic-Indic
    assert.equal(normalizeDigits('۴۵۶'), '456'); // Persian / Urdu
    assert.equal(normalizeDigits('९८७६५'), '98765'); // Devanagari
    assert.equal(normalizeDigits('১২৩'), '123'); // Bengali
    assert.equal(normalizeDigits('౧౨'), '12'); // Telugu
    assert.equal(normalizeDigits('೩೪'), '34'); // Kannada
    assert.equal(normalizeDigits('൫൬'), '56'); // Malayalam
    assert.equal(normalizeDigits('１２３'), '123'); // full-width
  });

  test('English digit words become digits, only as whole words', () => {
    assert.equal(normalizeDigits('nine eight SEVEN'), '9 8 7');
    assert.equal(normalizeDigits('someone'), 'someone');
    assert.equal(normalizeDigits('one1'), 'one1');
  });
});

describe('number -> digits only', () => {
  test('spaces, dots, dashes and a full stop are removed', () => {
    assert.equal(cleanNumber('98765 43210.'), '9876543210');
    assert.equal(cleanNumber('+91 98765-43210'), '919876543210');
    assert.equal(cleanNumber('9 8 7 6 5.'), '98765');
  });

  test('spoken digit words and other scripts work, and no digits gives ""', () => {
    assert.equal(cleanNumber('nine eight seven six'), '9876');
    assert.equal(cleanNumber('९८७६ ५४३२'), '98765432');
    assert.equal(cleanNumber('uh, what'), '');
  });
});

describe('code (PAN, IFSC...) -> UPPERCASE letters and digits', () => {
  test('no spaces, dots or dashes', () => {
    assert.equal(cleanCode('abcde 1234 f.'), 'ABCDE1234F');
    assert.equal(cleanCode('a b c d e 1 2 3 4 f'), 'ABCDE1234F');
    assert.equal(cleanCode('sbin.0001234'), 'SBIN0001234');
    assert.equal(cleanCode('SBIN-0001-234,'), 'SBIN0001234');
  });

  test('digits spoken as words or written in another script become digits', () => {
    assert.equal(cleanCode('a b c d e one two three four f'), 'ABCDE1234F');
    assert.equal(cleanCode('abcde ௧௨௩௪ f'), 'ABCDE1234F');
  });
});

describe('email -> lower case, @ and .', () => {
  test('spoken "at" and "dot" become @ and .', () => {
    assert.equal(cleanEmail('John dot Doe at Gmail dot com.'), 'john.doe@gmail.com');
    assert.equal(cleanEmail('john at the rate gmail dot com'), 'john@gmail.com');
    assert.equal(cleanEmail('Anita Period Rao at Yahoo dot co dot in'), 'anita.rao@yahoo.co.in');
  });

  test('an address that is already written stays, but lower case without spaces or a final dot', () => {
    assert.equal(cleanEmail('John.Doe@Gmail.com.'), 'john.doe@gmail.com');
    assert.equal(cleanEmail(' john.doe @ gmail.com '), 'john.doe@gmail.com');
    assert.equal(cleanEmail('john＠gmail.com'), 'john@gmail.com'); // full-width @
  });

  test('"at" and "dot" inside other words are not touched', () => {
    assert.equal(cleanEmail('patrick dot dotson at atlas dot com'), 'patrick.dotson@atlas.com');
  });

  test('the words of the language are used, longest first', () => {
    const words = { atWords: ['arroba'], dotWords: ['punto'] };
    assert.equal(cleanEmail('Juan punto Perez arroba Correo punto es', words), 'juan.perez@correo.es');
  });
});

describe('cleanByKind and cleanHeard', () => {
  test('name and text lose a trailing full stop; a name gets Title Case', () => {
    assert.equal(cleanByKind('shankar kumar.', 'name'), 'Shankar Kumar');
    assert.equal(cleanByKind('12 High Street, Chennai.', 'text'), '12 High Street, Chennai');
    assert.equal(cleanByKind('15 August 1990।', 'date'), '15 August 1990');
    assert.equal(cleanByKind('Yes.', undefined), 'Yes');
  });

  test('number, code and email use their own rules', () => {
    assert.equal(cleanByKind('98765 43210.', 'number'), '9876543210');
    assert.equal(cleanByKind('abcde 1234 f.', 'code'), 'ABCDE1234F');
    assert.equal(cleanByKind('A at B dot com', 'email'), 'a@b.com');
  });

  test('cleanHeard keeps names and text as spoken (only the full stop goes)', () => {
    assert.equal(cleanHeard('shankar kumar.', 'name'), 'shankar kumar');
    assert.equal(cleanHeard('98765 43210.', 'number'), '9876543210');
  });

  test('isStrictKind and hasNonLatinLetters', () => {
    for (const kind of ['number', 'code', 'email']) assert.equal(isStrictKind(kind), true);
    for (const kind of ['name', 'text', 'date', undefined]) assert.equal(isStrictKind(kind), false);
    assert.equal(hasNonLatinLetters('ABCDE1234F'), false);
    assert.equal(hasNonLatinLetters('ஏபிசிடிஇ1234'), true);
    assert.equal(hasNonLatinLetters('john@x.com'), false);
    assert.equal(hasNonLatinLetters('९८७६'), false); // digits only
  });

  test('property: results always follow the rules of their kind', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        assert.match(cleanNumber(text), /^[0-9]*$/);
        assert.match(cleanCode(text), /^[\p{L}\p{M}\p{N}]*$/u);
        const code = cleanCode(text);
        assert.equal(code, code.toUpperCase());
        const email = cleanEmail(text);
        assert.equal(email, email.toLowerCase());
        assert.ok(!/\s/u.test(email));
        assert.ok(!/[.,;:!?]$/.test(email));
        // cleaning twice changes nothing
        assert.equal(cleanNumber(cleanNumber(text)), cleanNumber(text));
      }),
      { numRuns: 200 }
    );
  });
});

describe('"at" and "dot" words in all 20 languages', () => {
  for (const code of codes) {
    test(code, () => {
      const data = load(code);
      const atWords = parseWords(data['voice.atWords']);
      const dotWords = parseWords(data['voice.dotWords']);
      assert.ok(atWords.length >= 2, 'voice.atWords needs at least 2 words');
      assert.ok(dotWords.length >= 2, 'voice.dotWords needs at least 2 words');
      for (const word of atWords) assert.ok(!dotWords.includes(word), `${word} is in both lists`);

      // Every word of each list works in a spoken address.
      for (const at of atWords) {
        for (const dot of dotWords) {
          const spoken = `john ${dot} doe ${at} gmail ${dot} com`;
          assert.equal(cleanEmail(spoken, { atWords, dotWords }), 'john.doe@gmail.com', spoken);
        }
      }
    });
  }
});
