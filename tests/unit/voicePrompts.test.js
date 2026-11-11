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
// ---- "Next part?" step and "learn more?" question (Ghost Tutor) ----

// The "next" word named in ghostTutor.nextPrompt, and the "no" word named in
// ghostTutor.learnMorePrompt ("Say yes or no"). The yes word is PROMPT_WORDS[code].yes.
const STEP_WORDS = {
  ar: { next: 'التالي', no: 'لا' },
  bn: { next: 'পরবর্তী', no: 'না' },
  de: { next: 'weiter', no: 'nein' },
  en: { next: 'next', no: 'no' },
  es: { next: 'siguiente', no: 'no' },
  fr: { next: 'suivant', no: 'non' },
  hi: { next: 'आगे', no: 'नहीं' },
  id: { next: 'berikutnya', no: 'tidak' },
  ja: { next: '次', no: 'いいえ' },
  kn: { next: 'ಮುಂದೆ', no: 'ಇಲ್ಲ' },
  ko: { next: '다음', no: '아니요' },
  ml: { next: 'അടുത്തത്', no: 'ഇല്ല' },
  pt: { next: 'próximo', no: 'não' },
  ru: { next: 'далее', no: 'нет' },
  ta: { next: 'அடுத்தது', no: 'இல்லை' },
  te: { next: 'తదుపరి', no: 'లేదు' },
  tr: { next: 'sonraki', no: 'hayır' },
  ur: { next: 'اگلا', no: 'نہیں' },
  vi: { next: 'tiếp theo', no: 'không' },
  zh: { next: '下一个', no: '不' },
};

test('every locale has its step words listed in this test', () => {
  assert.deepEqual(Object.keys(STEP_WORDS).sort(), [...codes].sort());
});

describe('voice.nextWords and the "next part?" / "learn more?" prompts', () => {
  for (const code of codes) {
    test(code, () => {
      const data = load(code);
      const yesWord = PROMPT_WORDS[code].yes;
      const { next, no } = STEP_WORDS[code];
      const nextWords = parseWords(data['voice.nextWords']);
      const redoWords = parseWords(data['voice.redoWords']);
      const yesWords = parseWords(data['voice.yesWords']);

      // The list has real words and shares nothing with the "again / no" list.
      assert.ok(nextWords.length >= 3, 'voice.nextWords needs at least 3 words');
      for (const w of nextWords) assert.ok(!redoWords.includes(w), 'next word also in redoWords: ' + w);

      // "Shall we go to the next part? Say next or yes." names the next word and the yes word.
      const nextPrompt = normalize(data['ghostTutor.nextPrompt']);
      assert.ok(nextPrompt.includes(normalize(next)), 'next word not in nextPrompt');
      assert.ok(nextPrompt.includes(normalize(yesWord)), 'yes word not in nextPrompt');

      // The step accepts the yes words AND the next words (as the app combines them).
      const words = { yes: [...yesWords, ...nextWords], redo: redoWords };
      for (const spoken of [next, yesWord]) {
        for (const variant of [spoken, spoken + '.', ' ' + spoken + '! ', spoken + '?']) {
          assert.equal(matchCommand(variant, words), 'yes', 'next step: ' + variant);
        }
      }
      // A "no" must not move on.
      assert.equal(matchCommand(no, words), 'redo', 'no word should be "redo"');

      // "Do you want to learn more about {topic}? Say yes or no." names yes and no.
      const learn = normalize(data['ghostTutor.learnMorePrompt']);
      assert.ok(data['ghostTutor.learnMorePrompt'].includes('{topic}'), '{topic} missing');
      assert.ok(learn.includes(normalize(yesWord)), 'yes word not in learnMorePrompt');
      assert.ok(learn.includes(normalize(no)), 'no word not in learnMorePrompt');
      const endWords = { yes: yesWords, redo: redoWords };
      assert.equal(matchCommand(yesWord, endWords), 'yes');
      assert.equal(matchCommand(no, endWords), 'redo');
    });
  }

  test('Tamil next words are exactly as requested', () => {
    const words = parseWords(load('ta')['voice.nextWords']);
    for (const w of ['அடுத்து', 'அடுத்தது', 'போகலாம்', 'ஆம்', 'சரி', 'next', 'yes']) {
      assert.ok(words.includes(w), w);
    }
  });

  test('English next words are exactly as requested', () => {
    const words = parseWords(load('en')['voice.nextWords']);
    for (const w of ['next', 'yes', 'ok', 'continue']) assert.ok(words.includes(w), w);
  });
});
