// englishAnswers.test.js
// Every answer, typed or spoken, in any language, is turned into English before it is kept:
// nothing that is not English is written on the original form or in the PDFs.
// Pure functions only: no browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { englishStep, acceptEnglish } from '../../apps/spirit-clerk/answer-flow.js';
import { hasNonLatinLetters } from '../../apps/spirit-clerk/answer-cleaning.js';

const NAME = { kind: 'name', pattern: '' };
const ADDRESS = { kind: 'address', pattern: '' };
const TEXT = { kind: 'text', pattern: '' };

describe('englishStep: what Correct does with the answer in the box', () => {
  test('an English answer is kept as it is', () => {
    assert.deepEqual(englishStep('Ravi Kumar', null), { action: 'store', text: 'Ravi Kumar' });
    assert.deepEqual(englishStep('12 Lake View Road, Bengaluru 560001', null), {
      action: 'store',
      text: '12 Lake View Road, Bengaluru 560001',
    });
    assert.deepEqual(englishStep('13/05/1987', null), { action: 'store', text: '13/05/1987' });
  });

  test('a name or address typed in Tamil is converted first (never kept as Tamil)', () => {
    assert.deepEqual(englishStep('ரவி குமார்', null), { action: 'convert' });
    assert.deepEqual(englishStep('12 லேக் வியூ ரோடு, பெங்களூரு 560001', null), { action: 'convert' });
    assert.deepEqual(englishStep('Ravi குமார்', null), { action: 'convert' }); // partly Tamil
  });

  test('after the English was shown for exactly this text, the second Correct keeps the English', () => {
    const preview = { source: 'ரவி குமார்', english: 'Ravi Kumar' };
    assert.deepEqual(englishStep('ரவி குமார்', preview), { action: 'store', text: 'Ravi Kumar' });
  });

  test('a preview for a different (changed) text, or a preview that is not English, is not used', () => {
    assert.deepEqual(englishStep('ரவி', { source: 'ரவி குமார்', english: 'Ravi Kumar' }), { action: 'convert' });
    assert.deepEqual(englishStep('ரவி', { source: 'ரவி', english: 'ரவி' }), { action: 'convert' });
    assert.deepEqual(englishStep('ரவி', { source: 'ரவி', english: '  ' }), { action: 'convert' });
  });

  test('other scripts too (Hindi, Arabic, Chinese, Russian)', () => {
    for (const typed of ['रवि कुमार', 'رافي كومار', '拉维', 'Рави Кумар']) {
      assert.deepEqual(englishStep(typed, null), { action: 'convert' }, typed);
    }
  });

  test('property: whatever is stored has only English letters', () => {
    fc.assert(
      fc.property(fc.string(), fc.option(fc.record({ source: fc.string(), english: fc.string() }), { nil: null }), (value, preview) => {
        const step = englishStep(value, preview);
        return step.action === 'convert' || !hasNonLatinLetters(step.text);
      }),
      { numRuns: 200 }
    );
  });
});

describe('acceptEnglish: the English value from the reply', () => {
  test('a name comes out in Title Case', () => {
    assert.equal(acceptEnglish('ravi kumar', NAME), 'Ravi Kumar');
    assert.equal(acceptEnglish('RAVI KUMAR.', NAME), 'Ravi Kumar');
  });

  test('an address and text are kept as translated (trailing full stop removed)', () => {
    assert.equal(acceptEnglish('12 Lake View Road, Bengaluru 560001', ADDRESS), '12 Lake View Road, Bengaluru 560001');
    assert.equal(acceptEnglish('Teacher.', TEXT), 'Teacher');
  });

  test('a reply that is empty, missing or still not English is refused (the user stays on the question)', () => {
    assert.equal(acceptEnglish('', NAME), null);
    assert.equal(acceptEnglish('   ', NAME), null);
    assert.equal(acceptEnglish(undefined, NAME), null);
    assert.equal(acceptEnglish(42, NAME), null);
    assert.equal(acceptEnglish('ரவி குமார்', NAME), null);
    assert.equal(acceptEnglish('12 லேக் வியூ ரோடு', ADDRESS), null);
  });

  test('other kinds are tidied for their kind', () => {
    assert.equal(acceptEnglish('13-05-1987', { kind: 'date', pattern: '' }), '13/05/1987');
    assert.equal(acceptEnglish('Ravi@Gmail.com', { kind: 'email', pattern: '' }), 'ravi@gmail.com');
  });

  test('property: an accepted value never has letters that are not English', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom('name', 'address', 'text', 'number', 'code', 'email', 'date'), (raw, kind) => {
        const value = acceptEnglish(raw, { kind, pattern: '' });
        return value === null || (value !== '' && !hasNonLatinLetters(value));
      }),
      { numRuns: 200 }
    );
  });
});
