// spiritClerkTranslate.test.js
// Spirit Clerk: on a non-English page every text and address answer is translated into English
// (one /api/translate call, style "everyday"), also when it is written in Latin letters, like the
// Spanish "Calle Mayor 12, segundo piso, Madrid" that used to be saved unchanged. Numbers, dates,
// phones, e-mails, codes and names are not translated. No browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';

import { needsEnglishTranslation, translateAnswer, englishStep, needsGemini, sameText, TRANSLATED_KINDS } from '../../apps/spirit-clerk/answer-flow.js';

const SPANISH = 'Calle Mayor 12, segundo piso, Madrid';
const ENGLISH = 'Calle Mayor 12, second floor, Madrid';

// A fake translateSpeech (the real one is in skeleton/api-client.js) that counts its calls.
function fakeTranslate(reply = { translation: ENGLISH }) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { fn, calls };
}

describe('which answers are translated into English', () => {
  test('a Spanish address on a Spanish page: translate is called once, the English is saved', async () => {
    const { fn, calls } = fakeTranslate();
    const result = await translateAnswer(SPANISH, { kind: 'address' }, 'es-ES', fn);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { text: SPANISH, sourceLang: 'es-ES', targetLang: 'en-US' });
    assert.equal(result.translated, true);
    assert.match(result.text, /Second Floor|second floor/i);
    assert.ok(!/segundo piso/i.test(result.text));
  });

  test('an English page: translate is not called', async () => {
    for (const lang of ['en-US', 'en-IN', 'en-GB']) {
      const { fn, calls } = fakeTranslate();
      assert.equal(await translateAnswer(SPANISH, { kind: 'address' }, lang, fn), null, lang);
      assert.equal(calls.length, 0, lang);
      assert.equal(needsEnglishTranslation('address', SPANISH, lang), false, lang);
    }
  });

  test('a number field: translate is not called (nor for dates, phones, e-mails, codes, names, choices)', async () => {
    for (const [kind, text] of [['number', '12'], ['date', '13/05/1987'], ['phone', '9876543210'], ['email', 'ana@gmail.com'], ['code', 'ABCDE1234F'], ['name', 'María López'], ['choice', 'Sí'], ['checkbox', 'Sí'], ['signature', '']]) {
      const { fn, calls } = fakeTranslate();
      assert.equal(await translateAnswer(text, { kind }, 'es-ES', fn), null, kind);
      assert.equal(calls.length, 0, kind);
    }
    assert.deepEqual([...TRANSLATED_KINDS], ['text', 'address']);
  });

  test('every non-English page and every script: Latin letters are not a reason to skip it', () => {
    for (const lang of ['es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'it-IT', 'id-ID', 'vi-VN', 'tr-TR', 'ta-IN', 'hi-IN']) {
      assert.equal(needsEnglishTranslation('text', 'Voy mañana', lang), true, lang);
      assert.equal(needsEnglishTranslation('address', SPANISH, lang), true, lang);
    }
    assert.equal(needsEnglishTranslation('address', 'நுங்கம்பாக்கம், சென்னை', 'ta-IN'), true);
    assert.equal(needsEnglishTranslation('address', '12 / 45', 'es-ES'), false, 'no letters: nothing to translate');
    assert.equal(needsEnglishTranslation('address', '', 'es-ES'), false);
  });

  test('property: only text and address answers of non-English pages are translated (100 runs)', () => {
    const kinds = fc.constantFrom('text', 'address', 'name', 'number', 'phone', 'date', 'email', 'code', 'choice', 'checkbox', 'signature');
    const langs = fc.constantFrom('en-US', 'en-IN', 'es-ES', 'fr-FR', 'ta-IN', 'de-DE');
    fc.assert(fc.property(kinds, langs, (kind, lang) => {
      const wanted = (kind === 'text' || kind === 'address') && !lang.startsWith('en');
      return needsEnglishTranslation(kind, 'Calle Mayor', lang) === wanted;
    }), { numRuns: 100 });
  });
});

describe('when translation fails', () => {
  test('an answer in Latin letters is kept as it is, with no error', async () => {
    for (const reply of [{ error: 'network_error' }, { error: 'busy' }, { translation: '' }, new Error('offline')]) {
      const { fn } = fakeTranslate(reply);
      const result = await translateAnswer(SPANISH, { kind: 'address' }, 'es-ES', fn);
      assert.equal(result.failed, undefined);
      assert.equal(result.translated, false);
      assert.equal(result.text, SPANISH);
    }
  });

  test('an answer in another script cannot go on the English form: it is marked failed, as before', async () => {
    const { fn } = fakeTranslate({ error: 'network_error' });
    assert.deepEqual(await translateAnswer('நுங்கம்பாக்கம், சென்னை', { kind: 'address' }, 'ta-IN', fn), { text: '', translated: false, failed: true });
  });

  test('a reply that is still not in English letters is not accepted', async () => {
    const { fn } = fakeTranslate({ translation: 'நுங்கம்பாக்கம்' });
    const result = await translateAnswer('Calle Mayor', { kind: 'text' }, 'es-ES', fn);
    assert.equal(result.translated, false);
    assert.equal(result.text, 'Calle Mayor');
  });
});

describe('"✓ Correct" for a typed answer', () => {
  test('a text or address answer on a non-English page waits for its English', () => {
    assert.deepEqual(englishStep(SPANISH, null, true), { action: 'convert' });
    assert.deepEqual(englishStep(SPANISH, { source: SPANISH, english: ENGLISH }, true), { action: 'store', text: ENGLISH });
    assert.deepEqual(englishStep(SPANISH, { source: 'something else', english: ENGLISH }, true), { action: 'convert' });
  });

  test('other answers are kept as before', () => {
    assert.deepEqual(englishStep('9876543210', null), { action: 'store', text: '9876543210' });
    assert.deepEqual(englishStep('María López', null, false), { action: 'store', text: 'María López' });
    assert.deepEqual(englishStep('ஷங்கர்', null, false), { action: 'convert' });
  });

  test('an English reply equal to the answer is stored at once (no second check)', () => {
    assert.equal(sameText('Main Street 5', ' main  street 5 '), true);
    assert.equal(sameText(SPANISH, ENGLISH), false);
  });
});

describe('names, numbers and English pages in the spoken path', () => {
  test('a name is only transliterated when it is not in English letters', () => {
    assert.equal(needsGemini({ kind: 'name' }, 'María López', 'María López', 'es-ES'), false);
    assert.equal(needsGemini({ kind: 'name' }, 'ஷங்கர்', 'ஷங்கர்', 'ta-IN'), true);
  });

  test('an English page (also en-IN and en-GB) never sends a text answer to Gemini', () => {
    for (const lang of ['en-US', 'en-IN', 'en-GB']) assert.equal(needsGemini({ kind: 'text' }, 'Main street', 'Main street', lang), false, lang);
    assert.equal(needsGemini({ kind: 'number' }, '12', '12', 'es-ES'), false, 'digits are cleaned on the device');
  });

  test('the app uses translateAnswer for spoken and typed answers', () => {
    const app = readFileSync(new URL('../../apps/spirit-clerk/app.js', import.meta.url), 'utf8');
    assert.match(app, /const translated = await translateAnswer\(heard, format, lang, translateSpeech\);/);
    assert.match(app, /const translated = await translateAnswer\(value, currentFormat, lang, translateSpeech\);/);
    assert.match(app, /englishStep\(value, englishPreview, needsEnglishTranslation\(currentFormat\.kind, value, state\.language\.bcp47\)\)/);
    // The review keeps both: what was said (heardText) and the English value (englishMeaning).
    assert.match(app, /storeAnswer\(heardParts\.join\(' '\)\.trim\(\) \|\| value, translated\.translated \? translated\.text : value, false\)/);
  });
});
