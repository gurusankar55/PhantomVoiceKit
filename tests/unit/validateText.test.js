// Unit + property tests for validateText and cleanAnswer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { validateText, cleanAnswer } from '../../skeleton/text-fallback-utils.js';

// ---- validateText ----
test('validateText: empty string is empty', () => {
  assert.equal(validateText(''), 'empty');
});

test('validateText: whitespace-only is empty', () => {
  assert.equal(validateText('   '), 'empty');
  assert.equal(validateText('\t\n \r\n'), 'empty');
});

test('validateText: real text is ok', () => {
  assert.equal(validateText('Shankar'), 'ok');
  assert.equal(validateText('  hi  '), 'ok');
});

// ---- cleanAnswer ----
test('cleanAnswer: removes trailing full stop', () => {
  assert.equal(cleanAnswer('Shankar.'), 'Shankar');
  assert.equal(cleanAnswer('T.'), 'T');
});

test('cleanAnswer: removes each trailing mark', () => {
  for (const mark of ['.', '।', '。', '!', '?', ',', ';', ':']) {
    assert.equal(cleanAnswer('word' + mark), 'word');
  }
});

test('cleanAnswer: removes mixed marks and spaces', () => {
  assert.equal(cleanAnswer('Hello ?! . '), 'Hello');
});

test('cleanAnswer: trims leading and trailing whitespace', () => {
  assert.equal(cleanAnswer('  Hello  '), 'Hello');
});

test('cleanAnswer: keeps inner punctuation', () => {
  assert.equal(cleanAnswer('a.b, c'), 'a.b, c');
  assert.equal(cleanAnswer('3.5'), '3.5');
});

test('cleanAnswer: only punctuation gives empty string', () => {
  assert.equal(cleanAnswer('?!.'), '');
  assert.equal(cleanAnswer(' . , '), '');
});

test('cleanAnswer: empty gives empty; clean text unchanged', () => {
  assert.equal(cleanAnswer(''), '');
  assert.equal(cleanAnswer('Shankar'), 'Shankar');
});

// ---- property tests ----
test('property: cleanAnswer is idempotent', () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      const once = cleanAnswer(s);
      assert.equal(cleanAnswer(once), once);
    }),
    { numRuns: 100 }
  );
});

test('property: cleanAnswer result never ends with a trailing mark or whitespace', () => {
  fc.assert(
    fc.property(fc.string(), (s) => {
      assert.doesNotMatch(cleanAnswer(s), /[.\u0964\u3002!?,;:\s]$/);
    }),
    { numRuns: 100 }
  );
});

test('property: whitespace-only strings are always rejected', () => {
  const ws = fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { maxLength: 30 }).map((a) => a.join(''));
  fc.assert(
    fc.property(ws, (s) => {
      assert.equal(validateText(s), 'empty');
    }),
    { numRuns: 100 }
  );
});
