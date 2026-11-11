// tests/unit/nameFormat.test.js
// Tests for the pure name helpers in apps/spirit-clerk/form-utils.js.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { toTitleCase, formatAnswerByKind } from '../../apps/spirit-clerk/form-utils.js';

describe('toTitleCase', () => {
  test('capitalises the first letter of each word and lowers the rest', () => {
    assert.equal(toTitleCase('RENUKA DEVI'), 'Renuka Devi');
    assert.equal(toTitleCase('SANKAR'), 'Sankar');
    assert.equal(toTitleCase('shankar'), 'Shankar');
    assert.equal(toTitleCase('mArY aNn'), 'Mary Ann');
  });

  test('handles hyphens, apostrophes and initials', () => {
    assert.equal(toTitleCase('MARY-ANN'), 'Mary-Ann');
    assert.equal(toTitleCase("o'neil"), "O'Neil");
    assert.equal(toTitleCase('A.K. SHARMA'), 'A.K. Sharma');
  });

  test('keeps extra spaces and handles empty or odd input', () => {
    assert.equal(toTitleCase(''), '');
    assert.equal(toTitleCase(null), '');
    assert.equal(toTitleCase(undefined), '');
    assert.equal(toTitleCase('  anna   maria '), '  Anna   Maria ');
  });

  test('property: idempotent, and the result matches the lower-case text', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const once = toTitleCase(s);
        assert.equal(toTitleCase(once), once);
        assert.equal(once.toLocaleLowerCase(), s.toLocaleLowerCase());
      }),
      { numRuns: 100 }
    );
  });
});

describe('formatAnswerByKind', () => {
  test('name fields are changed to Title Case', () => {
    assert.equal(formatAnswerByKind('RENUKA DEVI', 'name'), 'Renuka Devi');
  });

  test('emails, numbers, dates, codes and other text are never changed', () => {
    assert.equal(formatAnswerByKind('John.Doe@Example.COM', 'email'), 'John.Doe@Example.COM');
    assert.equal(formatAnswerByKind('ABCDE1234F', 'number'), 'ABCDE1234F');
    assert.equal(formatAnswerByKind('15 AUGUST 1990', 'date'), '15 AUGUST 1990');
    assert.equal(formatAnswerByKind('SBIN0001234', 'text'), 'SBIN0001234');
    assert.equal(formatAnswerByKind('12 MAIN STREET', 'text'), '12 MAIN STREET');
  });

  test('missing or unknown kind leaves the text alone', () => {
    assert.equal(formatAnswerByKind('ABC', undefined), 'ABC');
    assert.equal(formatAnswerByKind('ABC', 'banana'), 'ABC');
  });

  test('property: any kind other than "name" returns the text unchanged', () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom('email', 'number', 'date', 'text'), (s, kind) => {
        assert.equal(formatAnswerByKind(s, kind), s);
      }),
      { numRuns: 100 }
    );
  });
});
