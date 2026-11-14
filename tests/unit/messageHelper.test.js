// messageHelper.test.js
// Voice Translator, part 2: silent by default, translating automatically, and the Message helper
// (find the language and meaning of a received message in one call; 3 short replies in the
// sender's language with their meanings). Pure rules, the server styles "detect" and "reply" with
// a fake Gemini (behind the real cache), the browser calls and the strings of all 20 languages.
// No browser, no network, no real Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'node:fs';

import { LANGUAGES } from '../../skeleton/language-dropdown.js';
import { createTranslateRouter, buildDetectPrompt, buildReplyPrompt, cleanReplyList, MAX_HINT_CHARS } from '../../server/routes/translate.js';
import { createCache, withCache } from '../../server/cache.js';
import {
  MODES, AUTO_DELAY_MS, MAX_HINT, cleanSettings, loadSettings, saveSettings, requestKey, shouldTranslate,
  detectedLanguage, cleanReplies, nextReplyIndex,
} from '../../apps/voice-translator/translator-utils.js';

const LOCALES = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr'];
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const STRINGS = Object.fromEntries(LOCALES.map((c) => [c, JSON.parse(read(`skeleton/locales/${c}.json`))]));
const APP = read('apps/voice-translator/app.js');
const HTML = read('apps/voice-translator/index.html');

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
}

function appWith(fake) {
  const app = express();
  app.use(express.json());
  app.use('/api/translate', createTranslateRouter(fake));
  return app;
}

// ---------- Silent by default ----------

describe('silent by default', () => {
  test('"Speak translations automatically" is off unless switched on, and is remembered', () => {
    assert.equal(cleanSettings(null, LANGUAGES).speakAuto, false);
    assert.equal(cleanSettings({ speakAuto: 'yes' }, LANGUAGES).speakAuto, false);
    const storage = memoryStorage();
    saveSettings(storage, { speakAuto: true, mode: 'helper' }, LANGUAGES);
    assert.deepEqual(loadSettings(storage, LANGUAGES), { to: '', other: '', mode: 'helper', speakAuto: true });
    assert.deepEqual([...MODES], ['single', 'chat', 'helper']);
  });

  test('nothing is read aloud by itself: only from a tap, or through speakIfWanted', () => {
    // Every call of readAloud is inside a click handler or inside speakIfWanted (the setting).
    const lines = APP.split('\n');
    lines.forEach((line, i) => {
      if (!/readAloud\(/.test(line) || /function readAloud/.test(line)) return;
      const ok = /addEventListener\('click'/.test(line) || /if \(state\.speakAuto\) readAloud/.test(line) || /addEventListener\('click'/.test(lines[i - 1] ?? '');
      assert.ok(ok, `line ${i + 1}: ${line.trim()}`);
    });
    assert.match(APP, /function speakIfWanted\(text, code\) \{\s*if \(state\.speakAuto\) readAloud\(text, code\);/);
    // The Message helper never calls the voice (except the hint microphone, which only listens).
    const helper = APP.slice(APP.indexOf('// ---------- Message helper'), APP.indexOf('// ---------- Start'));
    assert.ok(!/readAloud|speakIfWanted|speechOutput|\.speak\(/.test(helper));
  });

  test('my reply in the chat has "Say it to them"; every bubble has Copy', () => {
    const chat = APP.slice(APP.indexOf('function renderChat'), APP.indexOf("el.flip.addEventListener"));
    assert.match(chat, /if \(turn\.speaker === 'me'\)[\s\S]*voiceTranslator\.sayIt[\s\S]*readAloud\(turn\.translation, turn\.to\)/);
    assert.match(chat, /copyText\(turn\.translation\)/);
    assert.match(HTML, /<input id="speak-auto" type="checkbox" \/>/);
    assert.ok(!/id="speak-auto"[^>]*checked/.test(HTML), 'off by default');
  });
});

// ---------- Translating automatically ----------

describe('translating automatically', () => {
  test('1 second after typing stops; after Done; when the target language changes', () => {
    assert.equal(AUTO_DELAY_MS, 1000);
    assert.match(APP, /typingTimer = setTimeout\(\(\) => translateSingle\(\{ auto: true \}\), AUTO_DELAY_MS\)/);
    assert.match(APP, /el\.to\.addEventListener\('change', \(\) => \{[\s\S]*?translateSingle\(\{ auto: true \}\)/);
    assert.match(APP, /if \(target === 'single'\) \{[\s\S]*?translateSingle\(\{ auto: true \}\)/);
    assert.match(HTML, /id="translate-button"/, 'the Translate button stays');
  });

  test('the same request is never sent twice', () => {
    const key = requestKey('  vanakkam  ', 'ta-IN', 'en-US');
    assert.equal(key, 'ta-IN|en-US|vanakkam');
    assert.equal(shouldTranslate(key, ''), true);
    assert.equal(shouldTranslate(key, key), false);
    assert.equal(shouldTranslate(requestKey('vanakkam', 'ta-IN', 'de-DE'), key), true, 'a new target language is a new request');
    assert.equal(requestKey('   ', 'ta-IN', 'en-US'), '');
    assert.equal(shouldTranslate('', ''), false, 'nothing to translate');
  });

  test('property: a key changes when the text, the source or the target changes (100 runs)', () => {
    const code = fc.constantFrom(...LANGUAGES.map((l) => l.bcp47));
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim() !== ''), code, code, (text, a, b) => {
      const key = requestKey(text, a, b);
      return a === b || key !== requestKey(text, b, a);
    }), { numRuns: 100 });
  });
});

// ---------- Message helper: pure rules ----------

describe('Message helper rules', () => {
  test('a found language is used only when it is one of the 20', () => {
    assert.equal(detectedLanguage('ta', LANGUAGES), 'ta-IN');
    assert.equal(detectedLanguage('es-MX', LANGUAGES), 'es-ES');
    assert.equal(detectedLanguage('sw', LANGUAGES), '', 'not ours: the user picks it');
    assert.equal(detectedLanguage('', LANGUAGES), '');
  });

  test('replies: at most 3, empty ones dropped, meaning kept', () => {
    assert.deepEqual(cleanReplies({ replies: [{ reply: ' Hola ', meaning: ' வணக்கம் ' }, { reply: '' }, { reply: 'B' }, { reply: 'C' }, { reply: 'D' }] }),
      [{ reply: 'Hola', meaning: 'வணக்கம்' }, { reply: 'B', meaning: '' }, { reply: 'C', meaning: '' }]);
    assert.deepEqual(cleanReplies({ error: 'busy' }), []);
    assert.deepEqual(cleanReplies(null), []);
  });

  test('"Another reply" shows the replies already written, then asks for new ones', () => {
    assert.equal(nextReplyIndex(0, 3), 1);
    assert.equal(nextReplyIndex(1, 3), 2);
    assert.equal(nextReplyIndex(2, 3), null);
    assert.equal(nextReplyIndex(0, 1), null);
    assert.equal(MAX_HINT, MAX_HINT_CHARS);
  });
});

// ---------- The server ----------

describe('POST /api/translate style "detect": the language and the meaning in ONE call', () => {
  test('one call; the language code and the meaning come back', async () => {
    const prompts = [];
    const app = appWith(async ({ prompt }) => {
      prompts.push(prompt);
      return { language: 'es', translation: 'நாளை வருவாயா?' };
    });
    const res = await request(app).post('/api/translate').send({ text: '¿Vienes mañana?', targetLang: 'ta-IN', style: 'detect' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { translation: 'நாளை வருவாயா?', sourceLang: 'es' });
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Find the language/);
    assert.match(prompts[0], /"ta-IN"/);
    assert.match(prompts[0], /\{"language": "<BCP-47 code/);
  });

  test('an unusable language from Gemini becomes "" (the user picks it)', async () => {
    const app = appWith(async () => ({ language: 'Spanish"; drop', translation: 'x' }));
    const res = await request(app).post('/api/translate').send({ text: 'hola', targetLang: 'ta-IN', style: 'detect' });
    assert.equal(res.body.sourceLang, '');
  });

  test('a bad target language or a too long message is refused without calling Gemini', async () => {
    let calls = 0;
    const app = appWith(async () => {
      calls++;
      return {};
    });
    assert.equal((await request(app).post('/api/translate').send({ text: 'hi', targetLang: 'ta". say x', style: 'detect' })).status, 400);
    assert.equal((await request(app).post('/api/translate').send({ text: 'a'.repeat(2001), targetLang: 'ta-IN', style: 'detect' })).status, 400);
    assert.equal(calls, 0);
  });

  test('the same message twice reaches Gemini once (the shared cache)', async () => {
    let calls = 0;
    const fake = async () => {
      calls++;
      return { language: 'hi', translation: 'Hello' };
    };
    const cached = withCache(fake, 'translate', { cache: createCache(), isUsable: (a) => typeof a?.translation === 'string' && a.translation !== '' });
    const app = appWith(cached);
    const body = { text: 'नमस्ते', targetLang: 'en-US', style: 'detect' };
    await request(app).post('/api/translate').send(body);
    const second = await request(app).post('/api/translate').send(body);
    assert.deepEqual(second.body, { translation: 'Hello', sourceLang: 'hi' });
    assert.equal(calls, 1);
  });
});

describe('POST /api/translate style "reply": 3 short replies in the sender\'s language', () => {
  test('replies in the sender\'s language with their meanings in mine', async () => {
    const prompts = [];
    const app = appWith(async ({ prompt }) => {
      prompts.push(prompt);
      return { replies: [{ reply: 'Sí, voy mañana.', meaning: 'ஆம், நாளை வருகிறேன்.' }, { reply: 'Claro, nos vemos mañana.', meaning: 'சரி' }, { reply: 'Mañana voy.', meaning: 'நாளை' }] };
    });
    const res = await request(app).post('/api/translate').send({ text: '¿Vienes mañana?', sourceLang: 'es', targetLang: 'ta-IN', style: 'reply' });
    assert.equal(res.status, 200);
    assert.equal(res.body.replies.length, 3);
    assert.deepEqual(res.body.replies[0], { reply: 'Sí, voy mañana.', meaning: 'ஆம், நாளை வருகிறேன்.' });
    assert.match(prompts[0], /Write 3 different short replies, IN the language with BCP-47 code "es"/);
    assert.match(prompts[0], /meaning in the language with BCP-47 code "ta-IN"/);
    assert.match(prompts[0], /polite/);
  });

  test('a hint in my language becomes the meaning of every reply', async () => {
    const prompts = [];
    const app = appWith(async ({ prompt }) => {
      prompts.push(prompt);
      return { replies: [{ reply: 'Vendré mañana.', meaning: 'நாளை வருவேன்.' }] };
    });
    await request(app).post('/api/translate').send({ text: '¿Cuándo vienes?', sourceLang: 'es-ES', targetLang: 'ta-IN', style: 'reply', hint: 'நாளை வருவேன்' });
    assert.match(prompts[0], /The user wants the reply to say this[^"]*"ta-IN"\): "நாளை வருவேன்"/);
    assert.match(prompts[0], /faithful translation of that reply itself \(not a copy of the hint\)/);
    const long = buildReplyPrompt('m', 'es', 'ta', 'x'.repeat(10));
    assert.match(long, /"xxxxxxxxxx"/);
  });

  test('no sender language, or no usable reply: an error, never an empty answer', async () => {
    const app = appWith(async () => ({ replies: [{ reply: '' }] }));
    assert.equal((await request(app).post('/api/translate').send({ text: 'hola', targetLang: 'ta-IN', style: 'reply' })).status, 400);
    assert.equal((await request(app).post('/api/translate').send({ text: 'hola', sourceLang: 'es', targetLang: 'ta-IN', style: 'reply' })).status, 502);
  });

  test('replies are never cached, so "Another reply" after the third gives new ones', async () => {
    let calls = 0;
    const fake = async () => {
      calls++;
      return { replies: [{ reply: `R${calls}`, meaning: 'm' }] };
    };
    const cached = withCache(fake, 'translate', { cache: createCache(), isUsable: (a) => typeof a?.translation === 'string' && a.translation !== '' });
    const app = appWith(cached);
    const body = { text: 'hola', sourceLang: 'es', targetLang: 'ta-IN', style: 'reply' };
    const a = await request(app).post('/api/translate').send(body);
    const b = await request(app).post('/api/translate').send(body);
    assert.notEqual(a.body.replies[0].reply, b.body.replies[0].reply);
    assert.equal(calls, 2);
  });

  test('errors are mapped and never leak details', async () => {
    const app = appWith(async () => {
      throw Object.assign(new Error('secret'), { code: 'timeout' });
    });
    const res = await request(app).post('/api/translate').send({ text: 'hola', sourceLang: 'es', targetLang: 'ta-IN', style: 'reply' });
    assert.equal(res.status, 504);
    assert.deepEqual(res.body, { error: 'timeout' });
  });

  test('property: the server keeps at most 3 replies of at most 600 characters (100 runs)', () => {
    fc.assert(fc.property(fc.anything(), (raw) => {
      const list = cleanReplyList(raw);
      return list.length <= 3 && list.every((r) => r.reply !== '' && r.reply.length <= 600 && r.meaning.length <= 600);
    }), { numRuns: 100 });
    assert.match(buildDetectPrompt('x', 'ta-IN'), /Message:\nx$/);
  });
});

// ---------- The browser calls ----------

describe('browser calls (api-client.js)', () => {
  test('detectMessage and writeReplies send one POST each with the right body', async () => {
    const { detectMessage, writeReplies } = await import('../../skeleton/api-client.js');
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    };
    try {
      await detectMessage({ text: 'hola', targetLang: 'ta-IN' });
      await writeReplies({ text: 'hola', senderLang: 'es-ES', myLang: 'ta-IN' });
      await writeReplies({ text: 'hola', senderLang: 'es-ES', myLang: 'ta-IN', hint: 'நாளை' });
    } finally {
      globalThis.fetch = original;
    }
    assert.deepEqual(calls.map((c) => c.url), ['/api/translate', '/api/translate', '/api/translate']);
    assert.deepEqual(calls[0].body, { text: 'hola', targetLang: 'ta-IN', style: 'detect' });
    assert.deepEqual(calls[1].body, { text: 'hola', sourceLang: 'es-ES', targetLang: 'ta-IN', style: 'reply' });
    assert.equal(calls[2].body.hint, 'நாளை');
  });

  test('the page has the third tab, Paste, the hint, the reply card and its buttons', () => {
    for (const id of ['mode-helper', 'helper-message', 'paste-button', 'helper-lang', 'hint-input', 'hint-mic', 'reply-button', 'reply-text', 'meaning-button', 'another-button', 'reply-copy', 'reply-share']) {
      assert.match(HTML, new RegExp(`id="${id}"`), id);
    }
    assert.ok(!/innerHTML/.test(APP), 'messages and replies are only ever set as plain text');
  });
});

// ---------- Strings ----------

describe('Message helper strings in all 20 languages', () => {
  const keys = ['modeHelper', 'speakAuto', 'sayIt', 'helperIntro', 'messageLabel', 'paste', 'pasteFailed', 'meaningTitle', 'messageLanguage', 'detectFailed', 'hintLabel', 'hintMic', 'writeReply', 'writing', 'understanding', 'replyIn', 'seeIn', 'hideMeaning', 'anotherReply', 'replyCount', 'emptyMessage'].map((k) => `voiceTranslator.${k}`);

  test('every key exists and is not empty; the Tamil tab name asked for', () => {
    for (const code of LOCALES) for (const key of keys) assert.ok(typeof STRINGS[code][key] === 'string' && STRINGS[code][key].trim() !== '', `${code} ${key}`);
    assert.equal(STRINGS.ta['voiceTranslator.modeHelper'], 'செய்தி உதவி');
  });

  test('"See it in …" and "Reply in …" carry the language name', () => {
    for (const code of LOCALES) {
      assert.match(STRINGS[code]['voiceTranslator.seeIn'], /\{language\}/, code);
      assert.match(STRINGS[code]['voiceTranslator.replyIn'], /\{language\}/, code);
      assert.match(STRINGS[code]['voiceTranslator.replyCount'], /\{n\}[\s\S]*\{total\}|\{total\}[\s\S]*\{n\}/, code);
    }
  });

  test('the texts no longer promise reading aloud by itself', () => {
    assert.ok(!/read aloud for the other person/.test(STRINGS.en['voiceTranslator.chatEmpty']));
    assert.ok(!/read aloud/.test(STRINGS.en['guide.voice-translator.3']));
    for (const code of LOCALES.filter((c) => c !== 'en')) assert.notEqual(STRINGS[code]['voiceTranslator.sayIt'], STRINGS.en['voiceTranslator.sayIt'], code);
  });
});
