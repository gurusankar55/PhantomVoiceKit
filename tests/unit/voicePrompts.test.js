// tests/unit/voicePrompts.test.js
// For every locale: the "yes" and "again" words that the spoken prompt tells the
// user to say must be accepted by matchCommand (so voice works, not only buttons).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { matchCommand, parseWords, normalize } from '../../skeleton/voice-commands.js';

const LOCALES_DIR = path.join(process.cwd(), 'skeleton', 'locales');
const load = (code) => JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, code + '.json'), 'utf8'));

// The yes word and the "again" word named in spiritClerk.confirmPrompt of each locale
// ({ yes } is also named in ghostTutor.confirmTopic).
const PROMPT_WORDS = {
  ar: { yes: 'نعم', redo: 'مرة أخرى' },
  bn: { yes: 'হ্যাঁ', redo: 'আবার' },
  de: { yes: 'ja', redo: 'noch einmal' },
  en: { yes: 'yes', redo: 'again' },
  es: { yes: 'sí', redo: 'otra vez' },
  fr: { yes: 'oui', redo: 'encore' },
  hi: { yes: 'हाँ', redo: 'फिर से' },
  id: { yes: 'ya', redo: 'lagi' },
  ja: { yes: 'はい', redo: 'もう一度' },
  kn: { yes: 'ಹೌದು', redo: 'ಮತ್ತೆ' },
  ko: { yes: '예', redo: '다시' },
  ml: { yes: 'അതെ', redo: 'വീണ്ടും' },
  pt: { yes: 'sim', redo: 'de novo' },
  ru: { yes: 'да', redo: 'ещё раз' },
  ta: { yes: 'ஆம்', redo: 'மீண்டும்' },
  te: { yes: 'అవును', redo: 'మళ్లీ' },
  tr: { yes: 'evet', redo: 'tekrar' },
  ur: { yes: 'ہاں', redo: 'دوبارہ' },
  vi: { yes: 'có', redo: 'nói lại' },
  zh: { yes: '是', redo: '再说一遍' },
};

const codes = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

test('every locale has its prompt words listed in this test', () => {
  assert.deepEqual(Object.keys(PROMPT_WORDS).sort(), [...codes].sort());
});

describe('words named in the spoken prompts are accepted by matchCommand', () => {
  for (const code of codes) {
    test(code, () => {
      const data = load(code);
      const words = { yes: parseWords(data['voice.yesWords']), redo: parseWords(data['voice.redoWords']) };
      const named = PROMPT_WORDS[code];

      // The word really is named in the prompt text (so the test checks what users hear).
      assert.ok(normalize(data['spiritClerk.confirmPrompt']).includes(normalize(named.yes)), 'yes word not in prompt');
      assert.ok(normalize(data['spiritClerk.confirmPrompt']).includes(normalize(named.redo)), 'redo word not in prompt');
      assert.ok(normalize(data['ghostTutor.confirmTopic']).includes(normalize(named.yes)), 'yes word not in topic prompt');

      // matchCommand accepts them, also with punctuation, capitals and a question mark.
      for (const variant of [named.yes, named.yes + '.', ' ' + named.yes + '! ', named.yes + '?']) {
        assert.equal(matchCommand(variant, words), 'yes', 'yes: ' + variant);
      }
      for (const variant of [named.redo, named.redo + '.', ' ' + named.redo + '! ', named.redo + '?']) {
        assert.equal(matchCommand(variant, words), 'redo', 'redo: ' + variant);
      }
    });
  }
});

describe('Tamil word lists', () => {
  const data = load('ta');
  const words = { yes: parseWords(data['voice.yesWords']), redo: parseWords(data['voice.redoWords']) };

  test('Tamil yes words', () => {
    for (const w of ['ஆம்', 'ஆமா', 'ஆமாம்', 'சரி', 'ஓகே', 'ok', 'OK', 'yes']) {
      assert.equal(matchCommand(w, words), 'yes', w);
    }
  });

  test('Tamil redo words', () => {
    for (const w of ['மீண்டும்', 'மறுபடி', 'திரும்ப', 'இல்லை', 'no']) {
      assert.equal(matchCommand(w, words), 'redo', w);
    }
  });

  test('the same Tamil word written in a different Unicode form is still accepted', () => {
    // Decomposed form of the vowel sign "ொ" (U+0BCA) = U+0BC6 + U+0BBE.
    const decomposed = 'ஒகே'.normalize('NFD');
    assert.equal(matchCommand('ஆம்'.normalize('NFD'), words), 'yes');
    assert.equal(matchCommand('ஆம்'.normalize('NFC'), words), 'yes');
    assert.ok(decomposed.length > 0);
  });
});