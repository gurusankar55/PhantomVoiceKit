// tests/unit/voiceConfirm.test.js
// The confirmation words "correct" / "wrong" in all 20 languages (voice.correctWords,
// voice.wrongWords) and the spoken prompt that names them (spiritClerk.confirmPrompt).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { matchCommand, parseWords, normalize } from '../../skeleton/voice-commands.js';
import { createRetryCounter } from '../../skeleton/voice-retry.js';

const LOCALES_DIR = path.join(process.cwd(), 'skeleton', 'locales');
const codes = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
const load = (code) => JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), 'utf8'));

describe('correct / wrong words and prompt, every language', () => {
  for (const code of codes) {
    test(code, () => {
      const data = load(code);
      const correct = parseWords(data['voice.correctWords']);
      const wrong = parseWords(data['voice.wrongWords']);
      assert.ok(correct.length >= 3, 'at least 3 correct words');
      assert.ok(wrong.length >= 3, 'at least 3 wrong words');
      for (const word of correct) assert.ok(!wrong.includes(word), `${word} is in both lists`);

      // The first word of each list is the one the prompt tells the user to say.
      const prompt = normalize(data['spiritClerk.confirmPrompt']);
      assert.ok(prompt.includes(correct[0]), `prompt does not name "${correct[0]}"`);
      assert.ok(prompt.includes(wrong[0]), `prompt does not name "${wrong[0]}"`);

      // Every word is understood, also with a full stop, capitals and a question mark.
      const words = { yes: correct, redo: wrong };
      for (const word of correct) {
        for (const variant of [word, `${word}.`, ` ${word}! `, `${word}?`]) {
          assert.equal(matchCommand(variant, words), 'yes', `correct: ${variant}`);
        }
      }
      for (const word of wrong) {
        for (const variant of [word, `${word}.`, ` ${word}! `, `${word}?`]) {
          assert.equal(matchCommand(variant, words), 'redo', `wrong: ${variant}`);
        }
      }
    });

    test(`${code}: the two big buttons start with ✓ and ✗`, () => {
      const data = load(code);
      assert.match(data['spiritClerk.confirm'], /^✓ \S/u);
      assert.match(data['spiritClerk.redo'], /^✗ \S/u);
      assert.ok(data['spiritClerk.done'].trim() !== '');
      assert.ok(data['spiritClerk.fixHeard'].trim() !== '');
    });
  }

  test('Tamil words and prompt are exactly as requested', () => {
    const data = load('ta');
    assert.equal(data['spiritClerk.confirmPrompt'], "சரி என்றால் 'சரி', தவறு என்றால் 'தவறு' என்று சொல்லுங்கள்");
    const words = { yes: parseWords(data['voice.correctWords']), redo: parseWords(data['voice.wrongWords']) };
    for (const word of ['சரி', 'ஆம்', 'ஆமா', 'ஓகே', 'ok', 'OK']) assert.equal(matchCommand(word, words), 'yes', word);
    for (const word of ['தவறு', 'மீண்டும்', 'இல்லை']) assert.equal(matchCommand(word, words), 'redo', word);
  });

  test('English words', () => {
    const data = load('en');
    const words = { yes: parseWords(data['voice.correctWords']), redo: parseWords(data['voice.wrongWords']) };
    assert.equal(matchCommand('Correct.', words), 'yes');
    assert.equal(matchCommand('wrong', words), 'redo');
    assert.equal(matchCommand('maybe', words), null);
  });

  test('the old Ghost Tutor yes / again words are not changed', () => {
    for (const code of codes) {
      const data = load(code);
      assert.ok(parseWords(data['voice.yesWords']).length >= 2, code);
      assert.ok(parseWords(data['voice.redoWords']).length >= 2, code);
    }
  });
});

describe('"I did not understand" is said only once', () => {
  test('a counter with limit 1 allows one retry, then says stop', () => {
    const counter = createRetryCounter(1);
    assert.equal(counter.next(), true);
    assert.equal(counter.next(), false);
    assert.equal(counter.next(), false);
    counter.reset();
    assert.equal(counter.next(), true);
  });
});
