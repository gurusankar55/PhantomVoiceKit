// tests/unit/fieldFormats.test.js
// Kinds, patterns (PAN, IFSC, Aadhaar, mobile, PIN, date), cells, chunks and validators
// (skeleton/field-formats.js). Pure functions: no browser, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  FIELD_KINDS,
  BUILTIN_PATTERNS,
  normalizeKind,
  isValidPattern,
  detectBuiltin,
  resolveFormat,
  parsePattern,
  chunksOf,
  emptyValues,
  valuesToString,
  stringToValues,
  cellStates,
  isPatternComplete,
  fillFrom,
  setCell,
  chunkToAsk,
  chunkPosition,
  isValidEmail,
  isRealDate,
  formatDate,
  parseDateString,
  isValidDate,
  parseSpokenDate,
  validateAnswer,
} from '../../skeleton/field-formats.js';

describe('kinds', () => {
  test('the eleven kinds', () => {
    assert.deepEqual(FIELD_KINDS, ['name', 'text', 'address', 'date', 'number', 'phone', 'email', 'code', 'choice', 'checkbox', 'signature']);
  });

  test('known kinds stay; unknown ones become text', () => {
    for (const kind of FIELD_KINDS.filter((k) => k !== 'text')) assert.equal(normalizeKind(kind), kind);
    assert.equal(normalizeKind(' Email '), 'email');
    for (const bad of [undefined, null, 7, '', 'banana', {}]) assert.equal(normalizeKind(bad), 'text');
  });

  test('old and other names are repaired', () => {
    assert.equal(normalizeKind('selection'), 'choice');
    assert.equal(normalizeKind('dropdown'), 'choice');
    assert.equal(normalizeKind('mobile'), 'phone');
    assert.equal(normalizeKind('sign'), 'signature');
  });

  test('a generic text kind follows the input type', () => {
    assert.equal(normalizeKind('text', 'checkbox'), 'checkbox');
    assert.equal(normalizeKind(undefined, 'selection'), 'choice');
    assert.equal(normalizeKind('', 'date'), 'date');
    assert.equal(normalizeKind('name', 'checkbox'), 'name');
  });
});

describe('patterns', () => {
  test('the built-in patterns', () => {
    assert.deepEqual(BUILTIN_PATTERNS, { pan: 'AAAAA9999A', ifsc: 'AAAA0XXXXXX', aadhaar: '999999999999', mobile: '9999999999', pin: '999999' });
  });

  test('valid and invalid patterns', () => {
    for (const ok of ['AAAAA9999A', 'AAAA0XXXXXX', '999999', 'XX', 'A9']) assert.equal(isValidPattern(ok), true, ok);
    for (const bad of ['', 'A', '00', 'AAAA-999', 'aaaa', 'ABC999', '9'.repeat(41), null, undefined, 42]) assert.equal(isValidPattern(bad), false, String(bad));
  });

  test('labels get their built-in pattern', () => {
    assert.equal(detectBuiltin('PAN number').id, 'pan');
    assert.equal(detectBuiltin('Permanent Account Number').id, 'pan');
    assert.equal(detectBuiltin('IFSC code').id, 'ifsc');
    assert.equal(detectBuiltin('Aadhaar No.').id, 'aadhaar');
    assert.equal(detectBuiltin('Mobile number').id, 'mobile');
    assert.equal(detectBuiltin('Contact No').id, 'mobile');
    assert.equal(detectBuiltin('PIN code').id, 'pin');
    assert.equal(detectBuiltin('Pincode').id, 'pin');
    assert.equal(detectBuiltin('Postal code').id, 'pin');
    assert.equal(detectBuiltin('PIN').id, 'pin');
  });

  test('other labels get none (also words that only contain pan / pin)', () => {
    for (const label of ['First name', 'Company', 'Panel number', 'Spinning', 'Date of birth', 'Account number', '']) {
      assert.equal(detectBuiltin(label), null, label);
    }
  });

  test('resolveFormat: built-in patterns without asking Gemini', () => {
    assert.deepEqual(resolveFormat({ label: 'PAN', kind: 'text' }), { kind: 'code', pattern: 'AAAAA9999A' });
    assert.deepEqual(resolveFormat({ label: 'IFSC Code' }), { kind: 'code', pattern: 'AAAA0XXXXXX' });
    assert.deepEqual(resolveFormat({ label: 'Aadhaar number', kind: 'number' }), { kind: 'number', pattern: '999999999999' });
    assert.deepEqual(resolveFormat({ label: 'Mobile', kind: 'number' }), { kind: 'phone', pattern: '9999999999' });
    assert.deepEqual(resolveFormat({ label: 'PIN code', kind: 'text' }), { kind: 'number', pattern: '999999' });
  });

  test('resolveFormat: a valid pattern from Gemini wins; an invalid one is dropped', () => {
    assert.deepEqual(resolveFormat({ label: 'GSTIN', kind: 'code', pattern: '99AAAAA9999A9X9' }), { kind: 'code', pattern: '99AAAAA9999A9X9' });
    assert.deepEqual(resolveFormat({ label: 'Voter ID', kind: 'code', pattern: 'not a pattern' }), { kind: 'code', pattern: '' });
    assert.deepEqual(resolveFormat({ label: 'PAN', kind: 'code', pattern: '9999' }), { kind: 'code', pattern: '9999' });
  });

  test('resolveFormat: a phone field always has a pattern; other kinds never keep one', () => {
    assert.deepEqual(resolveFormat({ label: 'Telephone of employer', kind: 'phone' }), { kind: 'phone', pattern: '9999999999' });
    assert.deepEqual(resolveFormat({ label: 'Hobby', kind: 'text', pattern: '9999' }), { kind: 'text', pattern: '' });
    assert.deepEqual(resolveFormat({ label: 'Email', kind: 'email', pattern: 'AAAA' }), { kind: 'email', pattern: '' });
  });

  test('resolveFormat: an address that mentions a phone or PIN stays an address', () => {
    assert.deepEqual(resolveFormat({ label: 'Address and phone', kind: 'address' }), { kind: 'address', pattern: '' });
    assert.deepEqual(resolveFormat({ label: 'Address with PIN code', kind: 'text' }), { kind: 'text', pattern: '' });
  });

  test('resolveFormat: signature fields', () => {
    for (const label of ['Signature', 'Signature of applicant', 'Sign here', 'Left thumb impression', 'Signed by']) {
      assert.equal(resolveFormat({ label, kind: 'text' }).kind, 'signature', label);
    }
    assert.equal(resolveFormat({ label: 'Design', kind: 'text' }).kind, 'text');
    assert.equal(resolveFormat({ label: 'Name', kind: 'signature' }).kind, 'signature'); // Gemini says so
  });
});

describe('cells and chunks', () => {
  const PAN = parsePattern('AAAAA9999A');
  const IFSC = parsePattern('AAAA0XXXXXX');

  test('parsePattern', () => {
    assert.equal(PAN.length, 10);
    assert.deepEqual(PAN.map((c) => c.type), ['letter', 'letter', 'letter', 'letter', 'letter', 'digit', 'digit', 'digit', 'digit', 'letter']);
    assert.deepEqual(IFSC[4], { type: 'literal', char: '0' });
    assert.deepEqual(IFSC[5], { type: 'any' });
    assert.deepEqual(parsePattern('nope'), []);
  });

  test('chunks follow the pattern: PAN is 5 letters, 4 digits, 1 letter', () => {
    assert.deepEqual(chunksOf(PAN), [
      { type: 'letters', start: 0, length: 5 },
      { type: 'digits', start: 5, length: 4 },
      { type: 'letters', start: 9, length: 1 },
    ]);
  });

  test('chunks: IFSC skips the fixed 0; long runs are cut into equal parts', () => {
    assert.deepEqual(chunksOf(IFSC), [
      { type: 'letters', start: 0, length: 4 },
      { type: 'any', start: 5, length: 6 },
    ]);
    assert.deepEqual(chunksOf(parsePattern('999999999999')).map((c) => c.length), [6, 6]); // Aadhaar
    assert.deepEqual(chunksOf(parsePattern('9999999999')).map((c) => c.length), [5, 5]); // mobile
    assert.deepEqual(chunksOf(parsePattern('999999')).map((c) => c.length), [6]); // PIN
    assert.deepEqual(chunksOf(parsePattern('9999999')).map((c) => c.length), [4, 3]);
  });

  test('property: the chunks cover every editable cell exactly once and never a fixed cell', () => {
    const patternArb = fc.stringMatching(/^[A9X0-8]{2,40}$/).filter(isValidPattern);
    fc.assert(
      fc.property(patternArb, (pattern) => {
        const cells = parsePattern(pattern);
        const covered = [];
        for (const chunk of chunksOf(cells)) {
          assert.ok(chunk.length >= 1 && chunk.length <= 6);
          for (let i = chunk.start; i < chunk.start + chunk.length; i++) {
            assert.notEqual(cells[i].type, 'literal');
            covered.push(i);
          }
        }
        const editable = cells.map((c, i) => (c.type === 'literal' ? -1 : i)).filter((i) => i !== -1);
        assert.deepEqual(covered, editable);
      }),
      { numRuns: 200 }
    );
  });

  test('emptyValues has the fixed characters and nothing else', () => {
    assert.deepEqual(emptyValues(IFSC), ['', '', '', '', '0', '', '', '', '', '', '']);
  });

  test('stringToValues: a whole code goes cell by cell; fixed cells stay fixed', () => {
    assert.equal(valuesToString(stringToValues('abcde1234f', PAN)), 'ABCDE1234F');
    assert.equal(valuesToString(stringToValues('SBIN0001234', IFSC)), 'SBIN0001234');
    // a code that breaks the fixed 0 is not accepted as it is
    assert.equal(valuesToString(stringToValues('SBIN1001234', IFSC)), 'SBIN0001234');
  });

  test('stringToValues: a shorter text fills the cells one after the other', () => {
    assert.deepEqual(stringToValues('AB', PAN).slice(0, 4), ['A', 'B', '', '']);
  });

  test('cellStates: a letter in a digit box and a digit in a letter box are bad', () => {
    const values = ['A', '1', 'C', 'D', '', 'X', '2', '3', '4', 'F'];
    assert.deepEqual(cellStates(values, PAN), ['ok', 'bad', 'ok', 'ok', 'empty', 'bad', 'ok', 'ok', 'ok', 'ok']);
    assert.deepEqual(cellStates(emptyValues(IFSC), IFSC)[4], 'literal');
  });

  test('isPatternComplete only when every box is right', () => {
    assert.equal(isPatternComplete(stringToValues('ABCDE1234F', PAN), PAN), true);
    assert.equal(isPatternComplete(stringToValues('ABCDE123', PAN), PAN), false);
    assert.equal(isPatternComplete(stringToValues('ABCDE12X4F', PAN), PAN), false);
    assert.equal(isPatternComplete([], []), false);
  });

  test('fillFrom puts characters in order, skips fixed cells, drops the extra, keeps wrong ones (red)', () => {
    let result = fillFrom(emptyValues(PAN), PAN, 0, 'ABCDE');
    assert.equal(result.used, 5);
    result = fillFrom(result.values, PAN, 5, '1 2 3 4 F x');
    assert.equal(valuesToString(result.values), 'ABCDE1234F');
    assert.equal(result.used, 5);

    const ifsc = fillFrom(emptyValues(IFSC), IFSC, 0, 'SBIN001234');
    assert.equal(valuesToString(ifsc.values), 'SBIN0001234');

    const wrong = fillFrom(emptyValues(PAN), PAN, 0, 'AB1DE');
    assert.deepEqual(cellStates(wrong.values, PAN).slice(0, 5), ['ok', 'ok', 'bad', 'ok', 'ok']);
  });

  test('setCell changes one box and ignores a fixed box', () => {
    const values = setCell(emptyValues(IFSC), IFSC, 0, 'sx');
    assert.equal(values[0], 'S');
    assert.deepEqual(setCell(values, IFSC, 4, 'Q'), values);
    assert.deepEqual(setCell(values, IFSC, 99, 'Q'), values);
  });

  test('chunkToAsk: the first group with an empty box; a partly filled group asks only the rest', () => {
    const chunks = chunksOf(PAN);
    assert.deepEqual(chunkToAsk(emptyValues(PAN), PAN, chunks), { type: 'letters', start: 0, length: 5 });

    let values = fillFrom(emptyValues(PAN), PAN, 0, 'ABC').values;
    assert.deepEqual(chunkToAsk(values, PAN, chunks), { type: 'letters', start: 3, length: 2 });

    values = fillFrom(values, PAN, 3, 'DE12').values;
    assert.deepEqual(chunkToAsk(values, PAN, chunks), { type: 'digits', start: 7, length: 2 });

    values = fillFrom(values, PAN, 7, '34F').values;
    assert.equal(chunkToAsk(values, PAN, chunks), null);
  });

  test('chunkPosition: only / first / next / last', () => {
    const chunks = chunksOf(PAN);
    assert.equal(chunkPosition(chunks, chunks[0]), 'first');
    assert.equal(chunkPosition(chunks, chunks[1]), 'next');
    assert.equal(chunkPosition(chunks, chunks[2]), 'last');
    assert.equal(chunkPosition(chunks, { type: 'letters', start: 3, length: 2 }), 'first'); // cut short, still the first group
    const pin = chunksOf(parsePattern('999999'));
    assert.equal(chunkPosition(pin, pin[0]), 'only');
  });
});

describe('validators', () => {
  test('e-mail', () => {
    for (const ok of ['john@gmail.com', 'john.doe+tag@mail.co.in', 'a1@x-y.org', 'JOHN@Gmail.com']) assert.equal(isValidEmail(ok), true, ok);
    for (const bad of ['', 'john', 'john@', '@gmail.com', 'john@gmail', 'john@@gmail.com', 'jo hn@gmail.com', 'john@gmail..com', 'john.@gmail.com', '.john@gmail.com', 'john@gmail.c', 'john@-gmail.com']) {
      assert.equal(isValidEmail(bad), false, bad);
    }
  });

  test('real dates', () => {
    assert.equal(isRealDate(29, 2, 2000), true);
    assert.equal(isRealDate(29, 2, 1900), false); // 1900 was not a leap year
    assert.equal(isRealDate(31, 4, 2020), false);
    assert.equal(isRealDate(31, 12, 2099), true);
    assert.equal(isRealDate(1, 1, 1899), false);
    assert.equal(isRealDate(0, 1, 2000), false);
    assert.equal(isRealDate(1, 13, 2000), false);
    assert.equal(isRealDate('x', 1, 2000), false);
  });

  test('formatDate and parseDateString', () => {
    assert.equal(formatDate(3, 6, 1990), '03/06/1990');
    assert.deepEqual(parseDateString('3/6/1990'), { day: 3, month: 6, year: 1990 });
    assert.deepEqual(parseDateString('03-06-1990'), { day: 3, month: 6, year: 1990 });
    assert.deepEqual(parseDateString('3 6 1990'), { day: 3, month: 6, year: 1990 });
    assert.equal(parseDateString('31/04/1990'), null);
    assert.equal(parseDateString('3/6/90'), null);
    assert.equal(parseDateString('hello'), null);
  });

  test('isValidDate needs exactly DD/MM/YYYY', () => {
    assert.equal(isValidDate('03/06/1990'), true);
    assert.equal(isValidDate('3/6/1990'), false);
    assert.equal(isValidDate('31/02/1990'), false);
    assert.equal(isValidDate(''), false);
  });

  test('a spoken or written English date becomes DD/MM/YYYY', () => {
    assert.equal(parseSpokenDate('3 6 1990'), '03/06/1990');
    assert.equal(parseSpokenDate('03/06/1990'), '03/06/1990');
    assert.equal(parseSpokenDate('3 June 1990'), '03/06/1990');
    assert.equal(parseSpokenDate('June 3rd, 1990'), '03/06/1990');
    assert.equal(parseSpokenDate('3rd of June 1990'), '03/06/1990');
    assert.equal(parseSpokenDate('15 aug 1947'), '15/08/1947');
    assert.equal(parseSpokenDate('03061990'), '03/06/1990');
    assert.equal(parseSpokenDate('31 February 1990'), null);
    assert.equal(parseSpokenDate('3 6'), null);
    assert.equal(parseSpokenDate('tomorrow'), null);
  });

  test('property: a real date survives format and parse', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1900, max: 2100 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 31 }), (y, m, d) => {
        fc.pre(isRealDate(d, m, y));
        const text = formatDate(d, m, y);
        assert.equal(isValidDate(text), true);
        assert.deepEqual(parseDateString(text), { day: d, month: m, year: y });
        assert.equal(parseSpokenDate(`${d} ${m} ${y}`), text);
      }),
      { numRuns: 200 }
    );
  });
});

describe('validateAnswer: every pattern', () => {
  const pan = { kind: 'code', pattern: BUILTIN_PATTERNS.pan };
  const ifsc = { kind: 'code', pattern: BUILTIN_PATTERNS.ifsc };
  const aadhaar = { kind: 'number', pattern: BUILTIN_PATTERNS.aadhaar };
  const mobile = { kind: 'phone', pattern: BUILTIN_PATTERNS.mobile };
  const pin = { kind: 'number', pattern: BUILTIN_PATTERNS.pin };

  test('PAN AAAAA9999A', () => {
    assert.equal(validateAnswer('ABCDE1234F', pan).valid, true);
    for (const bad of ['ABCDE1234', 'ABCDE12345', 'ABCD11234F', 'ABCDE1234FF', '1BCDE1234F', 'ABCDE1234!']) {
      const result = validateAnswer(bad, pan);
      assert.equal(result.valid, false, bad);
      assert.equal(result.reason, 'format', bad);
    }
  });

  test('IFSC AAAA0XXXXXX', () => {
    assert.equal(validateAnswer('SBIN0001234', ifsc).valid, true);
    assert.equal(validateAnswer('HDFC0ABC123', ifsc).valid, true);
    for (const bad of ['SBIN1001234', 'SBI00001234', 'SBIN000123', 'SBIN00012345']) assert.equal(validateAnswer(bad, ifsc).valid, false, bad);
  });

  test('Aadhaar 12 digits, mobile 10 digits, PIN 6 digits', () => {
    assert.equal(validateAnswer('123456789012', aadhaar).valid, true);
    assert.equal(validateAnswer('12345678901', aadhaar).valid, false);
    assert.equal(validateAnswer('9876543210', mobile).valid, true);
    assert.deepEqual(validateAnswer('987654321', mobile), { valid: false, reason: 'digits', count: 10 });
    assert.equal(validateAnswer('98765432100', mobile).valid, false);
    assert.equal(validateAnswer('600001', pin).valid, true);
    assert.deepEqual(validateAnswer('60000A', pin), { valid: false, reason: 'digits', count: 6 });
  });

  test('a code or number without a pattern', () => {
    assert.equal(validateAnswer('AB12', { kind: 'code' }).valid, true);
    assert.equal(validateAnswer('ab 12', { kind: 'code' }).valid, false);
    assert.equal(validateAnswer('123456', { kind: 'number' }).valid, true);
    assert.equal(validateAnswer('12a', { kind: 'number' }).valid, false);
  });

  test('e-mail, date and plain text', () => {
    assert.deepEqual(validateAnswer('john@gmail.com', { kind: 'email' }), { valid: true, reason: '' });
    assert.equal(validateAnswer('john@gmail', { kind: 'email' }).reason, 'email');
    assert.equal(validateAnswer('03/06/1990', { kind: 'date' }).valid, true);
    assert.equal(validateAnswer('3 June 1990', { kind: 'date' }).reason, 'date');
    assert.equal(validateAnswer('Ravi', { kind: 'name' }).valid, true);
    for (const kind of ['name', 'text', 'address', 'email', 'date', 'code', 'number', 'phone']) {
      assert.deepEqual(validateAnswer('  ', { kind }), { valid: false, reason: 'empty' }, kind);
    }
  });
});
