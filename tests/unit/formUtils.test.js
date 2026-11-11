// Unit tests for apps/spirit-clerk/form-utils.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  nextRedoOrSkip,
  nextSilenceOrSkip,
  pdfFilename,
  cleanLabel,
} from '../../apps/spirit-clerk/form-utils.js';

test('nextRedoOrSkip returns redo for counts 0, 1, 2', () => {
  for (const n of [0, 1, 2]) assert.equal(nextRedoOrSkip(n), 'redo');
});

test('nextRedoOrSkip returns skip for count 3', () => {
  assert.equal(nextRedoOrSkip(3), 'skip');
});

test('nextSilenceOrSkip returns reask for 0 and skip for 1', () => {
  assert.equal(nextSilenceOrSkip(0), 'reask');
  assert.equal(nextSilenceOrSkip(1), 'skip');
});

test('pdfFilename uses {name}_{YYYY-MM-DD}.pdf', () => {
  assert.equal(pdfFilename('Visa', new Date(2026, 0, 5)), 'Visa_2026-01-05.pdf');
  assert.equal(pdfFilename('Form', new Date(2026, 11, 31)), 'Form_2026-12-31.pdf');
});

test('pdfFilename property: matches format for any date', () => {
  fc.assert(
    fc.property(
      fc.stringMatching(/^[A-Za-z0-9]{1,20}$/),
      fc.date({ min: new Date(1000, 0, 1), max: new Date(9000, 0, 1), noInvalidDate: true }),
      (name, date) => {
        const out = pdfFilename(name, date);
        return /^[A-Za-z0-9]+_\d{4,}-\d{2}-\d{2}\.pdf$/.test(out) && out.startsWith(name + '_');
      }
    ),
    { numRuns: 100 }
  );
});

test('cleanLabel examples', () => {
  assert.equal(cleanLabel('First name:'), 'First name');
  assert.equal(cleanLabel('First name::'), 'First name');
  assert.equal(cleanLabel('First name :  '), 'First name');
  assert.equal(cleanLabel('  Date of birth '), 'Date of birth');
  assert.equal(cleanLabel('名前：'), '名前');
  assert.equal(cleanLabel('Time: hh:mm'), 'Time: hh:mm');
  assert.equal(cleanLabel(':'), '');
  assert.equal(cleanLabel(' : :: '), '');
  assert.equal(cleanLabel(''), '');
  assert.equal(cleanLabel('Address'), 'Address');
});

test('cleanLabel property: result never ends with colon or whitespace', () => {
  fc.assert(
    fc.property(fc.string(), (s) => !/[:\uFF1A\s]$/.test(cleanLabel(s))),
    { numRuns: 100 }
  );
});

test('cleanLabel property: idempotent', () => {
  fc.assert(
    fc.property(fc.string(), (s) => cleanLabel(cleanLabel(s)) === cleanLabel(s)),
    { numRuns: 100 }
  );
});
