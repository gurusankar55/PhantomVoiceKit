// Unit + property tests for skeleton/voice-commands.js (Requirement 18).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { matchCommand, parseWords } from '../../skeleton/voice-commands.js';

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skeleton', 'locales');

// Reads one locale file and builds a { yes, redo } word object from it.
function loadWords(code) {
  const json = JSON.parse(fs.readFileSync(path.join(localesDir, `${code}.json`), 'utf8'));
  return {
    yes: parseWords(json['voice.yesWords']),
    redo: parseWords(json['voice.redoWords']),
  };
}

const english = { yes: ['yes', 'ok', 'correct'], redo: ['again', 'no', 'redo'] };

test('English examples', () => {
  assert.equal(matchCommand('Yes.', english), 'yes');
  assert.equal(matchCommand('  OK!! ', english), 'yes');
  assert.equal(matchCommand('again', english), 'redo');
  assert.equal(matchCommand('No', english), 'redo');
  assert.equal(matchCommand('yes yes', english), 'yes');
  assert.equal(matchCommand('maybe', english), null);
  assert.equal(matchCommand('', english), null);
});

test('Tamil words from ta.json', () => {
  const words = loadWords('ta');
  assert.equal(matchCommand('சரி', words), 'yes');
  assert.equal(matchCommand('மறுபடி', words), 'redo');
});

test('Arabic yes word followed by the Arabic question mark', () => {
  const words = loadWords('ar');
  assert.equal(matchCommand('نعم؟', words), 'yes');
});

test('a word in both lists returns null', () => {
  assert.equal(matchCommand('maybe', { yes: ['maybe'], redo: ['maybe'] }), null);
});

test('parseWords trims entries and drops empty ones', () => {
  assert.deepEqual(parseWords(' yes | |ok||'), ['yes', 'ok']);
});

test('property: punctuation, whitespace and case changes keep the command', () => {
  const punct = fc
    .array(fc.constantFrom('.', '!', '?', ',', ' ', '\t', '؟', '。'), { maxLength: 4 })
    .map((chars) => chars.join(''));
  const cases = [
    { list: 'yes', words: english.yes },
    { list: 'redo', words: english.redo },
  ];
  fc.assert(
    fc.property(
      fc.constantFrom(...cases),
      fc.nat(),
      punct,
      punct,
      fc.boolean(),
      (entry, index, before, after, upper) => {
        const word = entry.words[index % entry.words.length];
        const spoken = before + (upper ? word.toUpperCase() : word) + after;
        assert.equal(matchCommand(spoken, english), entry.list);
      }
    ),
    { numRuns: 200 }
  );
});

test('every locale has >= 2 yes words, >= 2 redo words, and no overlap', () => {
  const files = fs.readdirSync(localesDir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0);
  const problems = [];
  for (const file of files) {
    const json = JSON.parse(fs.readFileSync(path.join(localesDir, file), 'utf8'));
    const yes = parseWords(json['voice.yesWords']);
    const redo = parseWords(json['voice.redoWords']);
    if (yes.length < 2) problems.push(`${file}: only ${yes.length} yes word(s)`);
    if (redo.length < 2) problems.push(`${file}: only ${redo.length} redo word(s)`);
    const shared = yes.filter((w) => redo.includes(w));
    if (shared.length > 0) problems.push(`${file}: shared words ${JSON.stringify(shared)}`);
  }
  assert.deepEqual(problems, [], 'Locale data problems:\n' + problems.join('\n'));
});
