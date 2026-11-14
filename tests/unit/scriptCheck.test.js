// scriptCheck.test.js
// Latin letters glued into words of a non-Latin language, for example the real Gemini answer
// "வரவேற்ப Leukிறேன்" (English -> Tamil) instead of "வரவேற்கிறேன்". countGluedLatin() finds
// them, and every style of /api/translate then tries once more with a stricter prompt and keeps
// the better answer. With a fake Gemini: no network, no real Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';

import { countGluedLatin, hasOwnScript, baseLanguage, strictPrefix, callChecked } from '../../server/script-check.js';
import { createTranslateRouter } from '../../server/routes/translate.js';
import { createCache, withCache } from '../../server/cache.js';

const BROKEN = 'வரவேற்ப Leukிறேன்';
const GOOD = 'வரவேற்கிறேன்';

function appWith(fake) {
  const app = express();
  app.use(express.json());
  app.use('/api/translate', createTranslateRouter(fake));
  return app;
}

// A fake Gemini that answers from a list, one answer per call, and remembers the prompts.
function scripted(...answers) {
  const prompts = [];
  const fake = async ({ prompt }) => {
    prompts.push(prompt);
    const answer = answers[Math.min(prompts.length - 1, answers.length - 1)];
    if (answer instanceof Error) throw answer;
    return structuredClone(answer);
  };
  return { fake, prompts };
}

describe('countGluedLatin', () => {
  test('the real example: Latin letters glued into a Tamil word', () => {
    assert.equal(countGluedLatin(BROKEN, 'ta'), 1);
    assert.equal(countGluedLatin(GOOD, 'ta'), 0);
    assert.equal(countGluedLatin(`நான் உங்களை ${BROKEN}`, 'ta-IN'), 1);
    assert.equal(countGluedLatin(BROKEN, 'Tamil'), 1, 'a language name works too');
  });

  test('brand names, codes, e-mails and links on their own are fine', () => {
    assert.equal(countGluedLatin('GiveawayProof மற்றும் GenLayer பற்றி drand பயன்படுத்துகிறது', 'ta'), 0);
    assert.equal(countGluedLatin('GenLayer-இன் புதிய GiveawayProofஐப் பாருங்கள்', 'ta'), 0, 'a Tamil suffix after a brand name');
    assert.equal(countGluedLatin('எழுதுங்கள்: john.doe@gmail.com அல்லது https://genlayer.com/docs பாருங்கள்', 'ta'), 0);
    assert.equal(countGluedLatin('குறியீடு AB12CD, PAN ABCDE1234F', 'ta'), 0);
    assert.equal(countGluedLatin('GenLayer के बारे में drand देखें', 'hi'), 0);
    assert.equal(countGluedLatin('GenLayer를 사용하세요', 'ko'), 0, 'a Korean particle after a brand name');
    assert.equal(countGluedLatin('使用GenLayer的drand', 'zh'), 0, 'no spaces in Chinese: a brand may touch the characters');
  });

  test('other broken forms: Latin inside or at the end of a word, a Latin letter with a vowel sign', () => {
    assert.equal(countGluedLatin('வரLeukவேற்கிறேன்', 'ta'), 1);
    assert.equal(countGluedLatin('வரவேற்பLeuk', 'ta'), 1);
    assert.equal(countGluedLatin('नमस्तेk जी', 'hi'), 1);
    assert.equal(countGluedLatin('стoл', 'ru'), 1, 'a Latin "o" inside a Russian word');
    assert.equal(countGluedLatin('使用Leukி的', 'zh'), 1);
    assert.equal(countGluedLatin(`${BROKEN} வரLeukவே`, 'ta'), 2);
  });

  test('languages written in Latin letters are never checked', () => {
    for (const lang of ['en', 'es', 'fr', 'de', 'pt', 'id', 'vi', 'tr', 'en-US']) {
      assert.equal(hasOwnScript(lang), false, lang);
      assert.equal(countGluedLatin(BROKEN, lang), 0, lang);
    }
    for (const lang of ['ta', 'hi', 'te', 'kn', 'ml', 'bn', 'ar', 'ur', 'ru', 'ko', 'zh', 'ja']) assert.equal(hasOwnScript(lang), true, lang);
    assert.equal(baseLanguage('ta-IN'), 'ta');
    assert.equal(countGluedLatin(undefined, 'ta'), 0);
  });

  test('property: pure Tamil text and separate Latin words are never counted (100 runs)', () => {
    const tamil = fc.array(fc.constantFrom('வர', 'வே', 'ற்', 'கி', 'றே', 'ன்', 'நா', 'ம்', 'பு', 'தி'), { minLength: 1, maxLength: 6 }).map((a) => a.join(''));
    const latin = fc.stringMatching(/^[A-Za-z]{1,10}$/);
    fc.assert(fc.property(fc.array(fc.oneof(tamil, latin), { minLength: 1, maxLength: 10 }), (words) => countGluedLatin(words.join(' '), 'ta') === 0), { numRuns: 100 });
  });

  test('property: a Latin letter followed by a Tamil vowel sign is always counted (100 runs)', () => {
    fc.assert(fc.property(fc.stringMatching(/^[A-Za-z]{1,6}$/), fc.constantFrom('ி', 'ு', 'ே', 'ா', '்'), (latin, sign) => countGluedLatin(`வர ${latin}${sign}றேன்`, 'ta') === 1), { numRuns: 100 });
  });
});

describe('callChecked: one stricter retry, the better answer is kept', () => {
  const measure = (r) => countGluedLatin(r.translation, 'ta');
  const usable = (r) => typeof r?.translation === 'string';

  test('a clean first answer: no retry', async () => {
    const { fake, prompts } = scripted({ translation: GOOD });
    assert.deepEqual(await callChecked(fake, 'P', measure, usable, 'ta'), { translation: GOOD });
    assert.equal(prompts.length, 1);
  });

  test('a broken first answer: one retry with a stricter prompt, the clean answer is kept', async () => {
    const { fake, prompts } = scripted({ translation: BROKEN }, { translation: GOOD });
    assert.deepEqual(await callChecked(fake, 'P', measure, usable, 'ta'), { translation: GOOD });
    assert.equal(prompts.length, 2);
    assert.equal(prompts[1], strictPrefix('ta') + 'P');
    assert.match(prompts[1], /Never put Latin \(English\) letters inside a word/);
    assert.match(prompts[1], /brand name, e-mail address, link or code may stay in Latin letters only as a separate word/);
  });

  test('still broken after the retry: the better (or the first) answer is kept, never a third call', async () => {
    const worse = scripted({ translation: BROKEN }, { translation: `${BROKEN} வரLeukவே` });
    assert.deepEqual(await callChecked(worse.fake, 'P', measure, usable, 'ta'), { translation: BROKEN });
    const better = scripted({ translation: `${BROKEN} வரLeukவே` }, { translation: BROKEN });
    assert.deepEqual(await callChecked(better.fake, 'P', measure, usable, 'ta'), { translation: BROKEN });
    assert.equal(worse.prompts.length + better.prompts.length, 4);
  });

  test('a failed or unusable retry keeps the first answer', async () => {
    const failed = scripted({ translation: BROKEN }, Object.assign(new Error('x'), { code: 'timeout' }));
    assert.deepEqual(await callChecked(failed.fake, 'P', measure, usable, 'ta'), { translation: BROKEN });
    const odd = scripted({ translation: BROKEN }, { something: 'else' });
    assert.deepEqual(await callChecked(odd.fake, 'P', measure, usable, 'ta'), { translation: BROKEN });
  });
});

describe('every style of /api/translate retries once on glued Latin letters', () => {
  test('normal translation English -> Tamil: the exact real example', async () => {
    const { fake, prompts } = scripted({ translation: BROKEN }, { translation: GOOD });
    const res = await request(appWith(fake)).post('/api/translate').send({ text: 'I welcome you', targetLang: 'ta' });
    assert.deepEqual(res.body, { translation: GOOD });
    assert.equal(prompts.length, 2);
    assert.ok(prompts[1].startsWith('IMPORTANT: write every word of the language with BCP-47 code "ta"'));
  });

  test('a clean answer is one call, and English targets are never retried', async () => {
    const clean = scripted({ translation: GOOD });
    await request(appWith(clean.fake)).post('/api/translate').send({ text: 'I welcome you', targetLang: 'ta-IN' });
    assert.equal(clean.prompts.length, 1);
    const english = scripted({ translation: 'Hello Leukி' });
    await request(appWith(english.fake)).post('/api/translate').send({ text: 'வணக்கம்', targetLang: 'en' });
    assert.equal(english.prompts.length, 1);
  });

  test('everyday (Voice Translator), transliterated names and the option list', async () => {
    const everyday = scripted({ translation: BROKEN }, { translation: GOOD });
    assert.equal((await request(appWith(everyday.fake)).post('/api/translate').send({ text: 'welcome', sourceLang: 'en-US', targetLang: 'ta-IN', style: 'everyday' })).body.translation, GOOD);
    assert.equal(everyday.prompts.length, 2);

    const name = scripted({ translation: 'ஷLeukங்கர்' }, { translation: 'ஷங்கர்' });
    assert.equal((await request(appWith(name.fake)).post('/api/translate').send({ text: 'Shankar', targetLang: 'ta', transliterate: true })).body.translation, 'ஷங்கர்');

    const list = scripted({ translations: [{ label: 'ஆணLeukி', aliases: [] }] }, { translations: [{ label: 'ஆண்', aliases: ['மேல்'] }] });
    const res = await request(appWith(list.fake)).post('/api/translate').send({ list: ['Male'], targetLang: 'ta' });
    assert.deepEqual(res.body.translations, [{ label: 'ஆண்', aliases: ['மேல்'] }]);
    assert.equal(list.prompts.length, 2);
  });

  test('Message helper: the meaning ("detect") and the replies ("reply") are checked in both languages', async () => {
    const detect = scripted({ language: 'en', translation: BROKEN }, { language: 'en', translation: GOOD });
    const d = await request(appWith(detect.fake)).post('/api/translate').send({ text: 'I welcome you', targetLang: 'ta-IN', style: 'detect' });
    assert.deepEqual(d.body, { translation: GOOD, sourceLang: 'en' });

    // Replies in Hindi (the sender), meanings in Tamil (mine): a broken meaning causes the retry.
    const reply = scripted(
      { replies: [{ reply: 'मैं कल आऊँगा', meaning: BROKEN }] },
      { replies: [{ reply: 'मैं कल आऊँगा', meaning: GOOD }] }
    );
    const r = await request(appWith(reply.fake)).post('/api/translate').send({ text: 'कल आओगे?', sourceLang: 'hi', targetLang: 'ta-IN', style: 'reply' });
    assert.deepEqual(r.body.replies, [{ reply: 'मैं कल आऊँगा', meaning: GOOD }]);
    assert.equal(reply.prompts.length, 2);
    assert.match(reply.prompts[1], /^IMPORTANT: write every word of the language with BCP-47 code "hi"/);
  });

  test('form answers become English: never checked, never retried', async () => {
    const { fake, prompts } = scripted({ translation: 'Shankar', value: 'Shankar' });
    await request(appWith(fake)).post('/api/translate').send({ text: 'ஷங்கர்', targetLang: 'en', kind: 'name' });
    assert.equal(prompts.length, 1);
  });

  test('with the real cache: a repeated request costs no new Gemini call', async () => {
    const { fake, prompts } = scripted({ translation: BROKEN }, { translation: GOOD });
    const cached = withCache(fake, 'translate', { cache: createCache(), isUsable: (a) => typeof a?.translation === 'string' && a.translation !== '' });
    const app = appWith(cached);
    const body = { text: 'I welcome you', targetLang: 'ta' };
    assert.equal((await request(app).post('/api/translate').send(body)).body.translation, GOOD);
    assert.equal((await request(app).post('/api/translate').send(body)).body.translation, GOOD);
    assert.equal(prompts.length, 2, 'both tries come from the cache the second time');
  });
});
