// Unit + property tests for selectVoice (voice selection algorithm).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { selectVoice } from '../../skeleton/speech-output-utils.js';

const v = (name, lang) => ({ name, lang });

test('returns the exact-match voice', () => {
  const voices = [v('A', 'en-US'), v('B', 'ta-IN')];
  assert.equal(selectVoice(voices, 'ta-IN'), voices[1]);
});

test('falls back to a prefix match when no exact match', () => {
  const voices = [v('A', 'en-US'), v('B', 'ta-LK')];
  assert.equal(selectVoice(voices, 'ta-IN'), voices[1]);
});

test('returns null when nothing matches', () => {
  assert.equal(selectVoice([v('A', 'en-US')], 'ta-IN'), null);
  assert.equal(selectVoice([], 'ta-IN'), null);
});

test('Natural beats Online beats plain (exact matches)', () => {
  const plain = v('Plain', 'ta-IN');
  const online = v('Foo Online', 'ta-IN');
  const natural = v('Foo Online (Natural)', 'ta-IN');
  assert.equal(selectVoice([plain, online, natural], 'ta-IN'), natural);
  assert.equal(selectVoice([plain, online], 'ta-IN'), online);
});

test('first match is used when no Natural/Online', () => {
  const a = v('One', 'ta-IN');
  const b = v('Two', 'ta-IN');
  assert.equal(selectVoice([a, b], 'ta-IN'), a);
});

test('same preference applies among prefix matches', () => {
  const plain = v('Plain', 'ta-LK');
  const online = v('X Online', 'ta-MY');
  const natural = v('X Natural', 'ta-SG');
  assert.equal(selectVoice([plain, online, natural], 'ta-IN'), natural);
  assert.equal(selectVoice([plain, online], 'ta-IN'), online);
  assert.equal(selectVoice([plain, v('Other', 'ta-MY')], 'ta-IN'), plain);
});

test('exact match wins over a better-named prefix match', () => {
  const exact = v('Plain', 'ta-IN');
  const prefix = v('Fancy Natural', 'ta-LK');
  assert.equal(selectVoice([prefix, exact], 'ta-IN'), exact);
});

test('property: result is null or an exact/prefix match, Natural preferred', () => {
  const langs = ['ta-IN', 'ta-LK', 'en-US', 'hi-IN'];
  const names = ['Plain', 'X Online', 'X Natural', 'X Online Natural'];
  const voiceArb = fc.record({
    name: fc.constantFrom(...names),
    lang: fc.constantFrom(...langs),
  });
  fc.assert(
    fc.property(fc.array(voiceArb, { maxLength: 8 }), (voices) => {
      const result = selectVoice(voices, 'ta-IN');
      const exact = voices.filter((x) => x.lang === 'ta-IN');
      const pool = exact.length > 0 ? exact : voices.filter((x) => x.lang.startsWith('ta'));
      if (pool.length === 0) return result === null;
      if (!pool.includes(result)) return false;
      if (pool.some((x) => x.name.includes('Natural'))) return result.name.includes('Natural');
      if (pool.some((x) => x.name.includes('Online'))) return result.name.includes('Online');
      return result === pool[0];
    }),
    { numRuns: 100 }
  );
});
