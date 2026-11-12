// tests/unit/spokenChars.test.js
// Chunk parser: what the recognizer heard (English) becomes characters, and the part of an e-mail
// address before the @. Also the answer flow decisions (apps/spirit-clerk/answer-flow.js).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { spokenToChars, parseEmailSpeech } from '../../apps/spirit-clerk/spoken-chars.js';
import {
  ENGLISH_RECOGNITION_LANG,
  ENGLISH_DONE_WORDS,
  usesCells,
  listeningPlan,
  chunkPromptKeys,
  needsGemini,
  checkboxValue,
  progressNumbers,
  lastAskableIndex,
  validationMessage,
} from '../../apps/spirit-clerk/answer-flow.js';

describe('spokenToChars: letters', () => {
  test('spelled letters', () => {
    assert.equal(spokenToChars('A B C D E', 'letters'), 'ABCDE');
    assert.equal(spokenToChars('a, b, c. d e', 'letters'), 'ABCDE');
    assert.equal(spokenToChars('abcde', 'letters'), 'ABCDE');
  });

  test('"B for Bombay" style words', () => {
    assert.equal(spokenToChars('A for Apple B for Bombay C for Chennai', 'letters'), 'ABC');
    assert.equal(spokenToChars('b as in bombay, k like kite', 'letters'), 'BK');
    assert.equal(spokenToChars('be for bombay', 'letters'), 'B'); // the letter name was misheard as "be"
    assert.equal(spokenToChars('xyz for zebra', 'letters'), 'Z'); // an unknown sound: the example word gives the letter
  });

  test('NATO words and letter names', () => {
    assert.equal(spokenToChars('alpha bravo charlie', 'letters'), 'ABC');
    assert.equal(spokenToChars('papa alpha november', 'letters'), 'PAN');
    assert.equal(spokenToChars('bee see dee are', 'letters'), 'BCDR');
    assert.equal(spokenToChars('double u', 'letters'), 'W');
    assert.equal(spokenToChars('oh', 'letters'), 'O');
  });

  test('filler words are not characters', () => {
    assert.equal(spokenToChars('um A B uh okay', 'letters'), 'AB');
    assert.equal(spokenToChars('the code is A B C', 'any'), 'ABC');
  });
});

describe('spokenToChars: digits', () => {
  test('digits, number words and runs', () => {
    assert.equal(spokenToChars('1 2 3 4', 'digits'), '1234');
    assert.equal(spokenToChars('1234', 'digits'), '1234');
    assert.equal(spokenToChars('nine eight seven six five', 'digits'), '98765');
    assert.equal(spokenToChars('zero oh one', 'digits'), '001');
    assert.equal(spokenToChars('98765 43210.', 'digits'), '9876543210');
  });

  test('double and triple', () => {
    assert.equal(spokenToChars('double five', 'digits'), '55');
    assert.equal(spokenToChars('triple 7 one', 'digits'), '7771');
    assert.equal(spokenToChars('nine double eight', 'digits'), '988');
  });

  test('sounds the recognizer writes instead of digits', () => {
    assert.equal(spokenToChars('to for won ate', 'digits'), '2418');
    assert.equal(spokenToChars('o', 'digits'), '0');
  });

  test('letters in a digits group are ignored', () => {
    assert.equal(spokenToChars('A 1 B 2', 'digits'), '12');
    assert.equal(spokenToChars('hello', 'digits'), '');
  });
});

describe('spokenToChars: any', () => {
  test('letters and digits together (IFSC end)', () => {
    assert.equal(spokenToChars('A B C one two three', 'any'), 'ABC123');
    assert.equal(spokenToChars('zero zero one two three four', 'any'), '001234');
    assert.equal(spokenToChars('a1b2', 'any'), 'A1B2');
  });

  test('nothing usable gives an empty string', () => {
    assert.equal(spokenToChars('', 'any'), '');
    assert.equal(spokenToChars('...', 'letters'), '');
    assert.equal(spokenToChars(undefined, 'digits'), '');
  });

  test('property: the result only has capital letters and digits', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom('letters', 'digits', 'any'), (text, type) => {
        assert.match(spokenToChars(text, type), /^[A-Z0-9]*$/);
      }),
      { numRuns: 200 }
    );
  });

  test('property: in a digits group the result is only digits', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        assert.match(spokenToChars(text, 'digits'), /^[0-9]*$/);
      }),
      { numRuns: 200 }
    );
  });
});

describe('parseEmailSpeech', () => {
  test('spelled or spoken, number words become digits', () => {
    assert.equal(parseEmailSpeech('j o h n one two three'), 'john123');
    assert.equal(parseEmailSpeech('john dot doe nine eight'), 'john.doe98');
    assert.equal(parseEmailSpeech('Ravi underscore kumar'), 'ravi_kumar');
    assert.equal(parseEmailSpeech('ravi dash kumar plus one'), 'ravi-kumar+1');
  });

  test('double digits and "B for Bombay"', () => {
    assert.equal(parseEmailSpeech('b for bombay r for ram double five'), 'br55');
  });

  test('a whole address said with at and dot is kept', () => {
    assert.equal(parseEmailSpeech('john dot doe at gmail dot com'), 'john.doe@gmail.com');
    assert.equal(parseEmailSpeech('John.Doe@Gmail.com.'), 'john.doe@gmail.com');
  });

  test('the words of the language are used', () => {
    assert.equal(parseEmailSpeech('juan punto perez arroba correo punto es', { atWords: ['arroba'], dotWords: ['punto'] }), 'juan.perez@correo.es');
  });

  test('letters of another script are dropped (they cannot be in an address)', () => {
    assert.equal(parseEmailSpeech('அருபத்திமூணு'), '');
  });

  test('property: only characters allowed in an address', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        assert.match(parseEmailSpeech(text), /^[a-z0-9._%+@-]*$/);
      }),
      { numRuns: 200 }
    );
  });
});

describe('answer flow decisions', () => {
  const PAN = { kind: 'code', pattern: 'AAAAA9999A' };

  test('which fields use boxes', () => {
    assert.equal(usesCells(PAN), true);
    assert.equal(usesCells({ kind: 'phone', pattern: '9999999999' }), true);
    assert.equal(usesCells({ kind: 'code', pattern: '' }), false);
    assert.equal(usesCells({ kind: 'name', pattern: 'AAAA' }), false);
  });

  test('codes with a pattern and e-mail are heard in English; the rest in the language of the user', () => {
    assert.equal(ENGLISH_RECOGNITION_LANG, 'en-IN');
    assert.deepEqual(listeningPlan(PAN, 'ta-IN'), { lang: 'en-IN', english: true });
    assert.deepEqual(listeningPlan({ kind: 'email' }, 'hi-IN'), { lang: 'en-IN', english: true });
    assert.deepEqual(listeningPlan({ kind: 'name' }, 'ta-IN'), { lang: 'ta-IN', english: false });
    assert.deepEqual(listeningPlan({ kind: 'date' }, 'ta-IN'), { lang: 'ta-IN', english: false });
    assert.deepEqual(listeningPlan({ kind: 'code', pattern: '' }, 'ta-IN'), { lang: 'ta-IN', english: false });
    assert.ok(ENGLISH_DONE_WORDS.includes('done'));
  });

  test('the prompt for a group: "First: letters (5)", "Now: digits (4)", "Last: letters (1)"', () => {
    assert.deepEqual(chunkPromptKeys('first', { type: 'letters', length: 5 }), { keys: ['spiritClerk.chunkFirst', 'spiritClerk.chunkLetters'], params: { count: 5 } });
    assert.deepEqual(chunkPromptKeys('next', { type: 'digits', length: 4 }), { keys: ['spiritClerk.chunkNext', 'spiritClerk.chunkDigits'], params: { count: 4 } });
    assert.deepEqual(chunkPromptKeys('last', { type: 'letters', length: 1 }), { keys: ['spiritClerk.chunkLast', 'spiritClerk.chunkLetters'], params: { count: 1 } });
    assert.deepEqual(chunkPromptKeys('only', { type: 'digits', length: 6 }), { keys: ['spiritClerk.chunkDigits'], params: { count: 6 } });
    assert.deepEqual(chunkPromptKeys('first', { type: 'any', length: 6 }).keys, ['spiritClerk.chunkFirst', 'spiritClerk.chunkAny']);
  });

  test('when Gemini is needed', () => {
    // numbers, phone numbers, codes and e-mail in Latin letters are cleaned on the device
    assert.equal(needsGemini({ kind: 'number' }, 'nine eight', '98', 'ta-IN'), false);
    assert.equal(needsGemini({ kind: 'phone' }, '98765 43210', '9876543210', 'hi-IN'), false);
    assert.equal(needsGemini({ kind: 'code' }, 'abc', 'ABC', 'ta-IN'), false);
    assert.equal(needsGemini({ kind: 'code' }, 'ஏபிசி', 'ஏபிசி', 'ta-IN'), true);
    assert.equal(needsGemini({ kind: 'email' }, 'john at gmail', 'john@gmail', 'en-US'), false);
    // another language needs the English value
    assert.equal(needsGemini({ kind: 'name' }, 'ரவி', 'ரவி', 'ta-IN'), true);
    assert.equal(needsGemini({ kind: 'address' }, 'சென்னை', 'சென்னை', 'ta-IN'), true);
    assert.equal(needsGemini({ kind: 'name' }, 'ravi', 'Ravi', 'en-US'), false);
    assert.equal(needsGemini({ kind: 'address' }, '12 high street', '12 high street', 'en-US'), false);
    // a date that is clear in English needs no call; a date in another language does
    assert.equal(needsGemini({ kind: 'date' }, '3 June 1990', '03/06/1990', 'en-US'), false);
    assert.equal(needsGemini({ kind: 'date' }, 'மூன்று ஜூன் ஆயிரத்து தொள்ளாயிரத்து தொண்ணூறு', 'x', 'ta-IN'), true);
    assert.equal(needsGemini({ kind: 'date' }, 'the day after tomorrow', 'x', 'en-US'), true);
    // a signature is never sent
    assert.equal(needsGemini({ kind: 'signature' }, 'x', 'x', 'ta-IN'), false);
  });

  test('checkbox answers in English', () => {
    for (const yes of ['yes', 'Yes.', 'yeah', 'ok', 'Okay!', 'correct']) assert.equal(checkboxValue(yes), 'Yes', yes);
    for (const no of ['no', 'No.', 'nope', 'not']) assert.equal(checkboxValue(no), 'No', no);
    assert.equal(checkboxValue('maybe later.'), 'maybe later');
  });

  test('progress counts every field (a signature is drawn on a pad)', () => {
    const fields = [{ kind: 'name' }, { kind: 'signature' }, { kind: 'date' }, { kind: 'signature' }];
    assert.deepEqual(progressNumbers(fields, 0), { n: 1, total: 4 });
    assert.deepEqual(progressNumbers(fields, 3), { n: 4, total: 4 });
    assert.equal(lastAskableIndex(fields), 3);
    assert.equal(lastAskableIndex([]), -1);
  });

  test('messages for an answer that is not valid yet', () => {
    assert.equal(validationMessage({ valid: true, reason: '' }), null);
    assert.equal(validationMessage({ valid: false, reason: 'empty' }), null);
    assert.deepEqual(validationMessage({ valid: false, reason: 'email' }), { key: 'spiritClerk.invalidEmail' });
    assert.deepEqual(validationMessage({ valid: false, reason: 'date' }), { key: 'spiritClerk.invalidDate' });
    assert.deepEqual(validationMessage({ valid: false, reason: 'digits', count: 10 }), { key: 'spiritClerk.invalidDigits', params: { count: 10 } });
    assert.deepEqual(validationMessage({ valid: false, reason: 'digits' }), { key: 'spiritClerk.invalidFormat' });
    assert.deepEqual(validationMessage({ valid: false, reason: 'format' }), { key: 'spiritClerk.invalidFormat' });
  });
});
