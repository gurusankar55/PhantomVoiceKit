// server/routes/translate.js
// POST /api/translate  (server/index.js mounts this router at /api/translate)
// Body: { text, targetLang, transliterate? }  ->  Response: { translation }
// transliterate: true means "write this name in the target letters, do not translate it".

import { Router } from 'express';
import { FIELD_KINDS, isValidPattern } from '../../skeleton/field-formats.js';

// Factory: receives callGemini so tests can pass a fake function.
export function createTranslateRouter(callGemini) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { text, targetLang, transliterate, kind, label, pattern, options, list, style, sourceLang } = req.body ?? {};

    // The options of a choice field, translated in ONE call: { list: [...], targetLang } gives
    // { translations: [{ label, aliases }] } in the same order (aliases = other ways to say it).
    if (Array.isArray(list)) {
      const items = cleanOptions(list);
      if (items.length === 0 || typeof targetLang !== 'string' || targetLang.trim() === '') {
        return res.status(400).json({ error: 'invalid_input' });
      }
      try {
        const result = await callGemini({ prompt: buildListPrompt(items, targetLang) });
        const raw = Array.isArray(result?.translations) ? result.translations : [];
        const translations = items.map((_, i) => {
          const entry = raw[i];
          const text = typeof entry === 'string' ? entry : typeof entry?.label === 'string' ? entry.label : '';
          const aliases = Array.isArray(entry?.aliases)
            ? entry.aliases.filter((a) => typeof a === 'string' && a.trim() !== '').map((a) => a.trim().slice(0, 80)).slice(0, 4)
            : [];
          return { label: text.trim().slice(0, 80), aliases };
        });
        return res.json({ translations });
      } catch (err) {
        if (err && err.code === 'timeout') return res.status(504).json({ error: 'timeout' });
        if (err && err.code === 'rate_limit') return res.status(429).json({ error: 'busy' });
        return res.status(502).json({ error: 'gemini_error' });
      }
    }

    // Reject missing, non-string, empty or whitespace-only text.
    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'invalid_input' });
    }

    // Message helper (Voice Translator): find the language of a received message and its meaning
    // in mine, in ONE call; or write 3 short replies in the sender's language with their meanings.
    if (style === 'detect' || style === 'reply') {
      const mine = cleanLangCode(targetLang);
      const sender = cleanLangCode(sourceLang);
      const hint = typeof req.body.hint === 'string' ? req.body.hint.trim().slice(0, MAX_HINT_CHARS) : '';
      if (mine === '' || text.length > MAX_EVERYDAY_CHARS || (style === 'reply' && sender === '')) {
        return res.status(400).json({ error: 'invalid_input' });
      }
      try {
        if (style === 'detect') {
          const result = await callGemini({ prompt: buildDetectPrompt(text, mine) });
          const translation = typeof result?.translation === 'string' ? result.translation.trim() : '';
          return res.json({ translation, sourceLang: cleanLangCode(typeof result?.language === 'string' ? result.language : '') });
        }
        const result = await callGemini({ prompt: buildReplyPrompt(text, sender, mine, hint) });
        const replies = cleanReplyList(result?.replies);
        if (replies.length === 0) return res.status(502).json({ error: 'gemini_error' });
        return res.json({ replies });
      } catch (err) {
        if (err && err.code === 'timeout') return res.status(504).json({ error: 'timeout' });
        if (err && err.code === 'rate_limit') return res.status(429).json({ error: 'busy' });
        return res.status(502).json({ error: 'gemini_error' });
      }
    }

    // targetLang must also be a non-empty string.
    if (typeof targetLang !== 'string' || targetLang.trim() === '') {
      return res.status(400).json({ error: 'invalid_input' });
    }

    // Names are never translated: they are written with the letters of the
    // target language, keeping the sound (for example Tamil "ஷங்கர்" -> "Shankar").
    // An answer to a form field: ONE call gives the English meaning AND the form-ready value
    // (date as DD/MM/YYYY, digits only, a valid e-mail address, a code that matches its pattern...).
    const wantsValue = typeof kind === 'string' && FIELD_KINDS.includes(kind);
    // Voice Translator: what one person says to another, in natural everyday words.
    const everyday = style === 'everyday' && !wantsValue && transliterate !== true;
    // Only a real language code goes into this prompt (never free text); a bad source language is
    // left out (Gemini then detects it), a bad target language is refused.
    if (everyday && (text.length > MAX_EVERYDAY_CHARS || cleanLangCode(targetLang) === '')) {
      return res.status(400).json({ error: 'invalid_input' });
    }
    const prompt = everyday
      ? buildEverydayPrompt(text, cleanLangCode(sourceLang), cleanLangCode(targetLang))
      : wantsValue
      ? buildValuePrompt(text, kind, typeof label === 'string' ? label.slice(0, 200) : '', isValidPattern(pattern) ? pattern : '', cleanOptions(options))
      : transliterate === true
      ? `Transliterate the following personal name into the letters of the language with BCP-47 code or name "${targetLang}". ` +
        'Do NOT translate its meaning. Write how it sounds, using the usual spelling of that name, with no extra words. ' +
        'Reply with JSON only, in exactly this shape: {"translation": "<transliterated name>"}.\n\n' +
        `Name:\n${text}`
      : buildTranslatePrompt(text, targetLang);

    try {
      const result = await callGemini({ prompt });
      if (wantsValue) {
        // value is optional: the browser falls back to cleaning the translation itself.
        const value = typeof result.value === 'string' ? result.value.trim() : '';
        return res.json({ translation: result.translation, value });
      }
      return res.json({ translation: result.translation });
    } catch (err) {
      // Map known error codes; never expose internals or the API key.
      if (err && err.code === 'timeout') {
        return res.status(504).json({ error: 'timeout' });
      }
      if (err && err.code === 'rate_limit') {
        return res.status(429).json({ error: 'busy' });
      }
      return res.status(502).json({ error: 'gemini_error' });
    }
  });

  return router;
}

// The instruction for an answer to a form field: English meaning + form-ready value.
// The instruction for translating the options of a choice field into the language of the user.
function buildListPrompt(items, targetLang) {
  return (
    `These are the options of a form field: ${JSON.stringify(items)}. ` +
    `Translate each option into the language with BCP-47 code or name "${targetLang}". ` +
    'Reply with JSON only, in exactly this shape, with one item for each option in the SAME order: ' +
    '{"translations": [{"label": "<natural translation>", "aliases": ["<up to 3 other ways a speaker says it aloud, ' +
    'including the English word written in the letters of that language>"]}]}.'
  );
}

// The options of a choice field, as a short list of plain strings (anything else is dropped).
function cleanOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .filter((option) => typeof option === 'string' && option.trim() !== '')
    .map((option) => option.trim().slice(0, 80))
    .slice(0, 12);
}

function buildValuePrompt(text, kind, label, pattern, options = []) {
  const rules = {
    name: "a person's name written in English letters (transliterate it, do NOT translate its meaning), in Title Case",
    text: 'short plain English text',
    address: 'the full address in English (translate or transliterate every part), Title Case, parts separated by commas, nothing left out',
    date: 'the date as DD/MM/YYYY: day first, two digits for day and month, four digits for the year (for example 03/06/1990); use "" if it is not a clear date',
    number: 'digits only, no spaces, dashes or commas',
    phone: 'digits only, no spaces, dashes, plus sign or country code',
    email: 'one valid e-mail address in lower case, with @ and dots, no spaces',
    code: 'UPPERCASE letters and digits only, no spaces, dots or dashes',
    choice: 'the chosen option in English, short',
    checkbox: '"Yes" or "No"',
    signature: '""',
  };
  return (
    `A person answered the form field "${label || kind}" (kind: ${kind}). The answer was said or typed in some language, maybe not English. ` +
    'Reply with JSON only, in exactly this shape: {"translation": "<the answer translated into English, plain>", "value": "<the form-ready answer>"}. ' +
    `"value" is the answer exactly as it must be written on the form, in English: ${rules[kind]}. ` +
    (options.length > 0 && (kind === 'choice' || kind === 'checkbox')
      ? `The form offers exactly these options: ${JSON.stringify(options)}. "value" must be ONE of them, written exactly as given (choose the one the person meant, whatever language they used); use "" if none fits. `
      : '') +
    (pattern
      ? `It must match this pattern, one character per position: A is a letter, 9 is a digit, X is a letter or a digit, a digit 0-8 is exactly that digit (pattern: ${pattern}). `
      : '') +
    'Do not add words, labels or explanations.\n\n' +
    `Answer:\n${text}`
  );
}

// Longest text the Voice Translator may send in one turn.
export const MAX_EVERYDAY_CHARS = 2000;

// A language code such as "ta-IN" or "en" (letters, digits and dashes only), or "" for anything
// else, so a language field can never carry extra instructions into the prompt.
export function cleanLangCode(value) {
  if (typeof value !== 'string') return '';
  const code = value.trim();
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/.test(code) ? code : '';
}

// Longest "tell it what to say" hint of the Message helper.
export const MAX_HINT_CHARS = 300;

// Message helper: the language of a received chat message and its meaning in my language.
export function buildDetectPrompt(text, myLang) {
  return (
    'Someone received the chat message below (for example on WhatsApp or Telegram). ' +
    'Find the language it is written in, and translate it into the language with BCP-47 code ' +
    `"${myLang}" in natural, everyday words, keeping its meaning, tone, names, numbers and emoji. ` +
    'Do not answer the message and do not explain. ' +
    'Reply with JSON only, in exactly this shape: {"language": "<BCP-47 code of the message language, such as ta, hi, en, es>", "translation": "<the meaning>"}.\n\n' +
    `Message:\n${text}`
  );
}

// Message helper: 3 short, polite replies in the sender's language, each with its meaning in mine.
export function buildReplyPrompt(text, senderLang, myLang, hint = '') {
  return (
    'Someone received the chat message below (for example on WhatsApp or Telegram) and wants to reply. ' +
    `Write 3 different short replies, IN the language with BCP-47 code "${senderLang}" (the language of the message), ` +
    'as a polite native speaker would really type them in a chat: natural, warm, 1 or 2 short sentences, no hashtags, ' +
    'no quotation marks, no names unless the message has them. ' +
    (hint
      ? `The user wants the reply to say this (written in the language with BCP-47 code "${myLang}"): "${hint}". Every reply must keep that meaning. `
      : 'Each reply must fit the message; make them a little different from each other (for example warm, short, more detailed). ') +
    `For each reply also give its meaning in the language with BCP-47 code "${myLang}": ` +
    'a faithful translation of that reply itself (not a copy of the hint), so the user can check exactly what it says. ' +
    'Reply with JSON only, in exactly this shape: {"replies": [{"reply": "<the reply>", "meaning": "<its meaning>"}]}.\n\n' +
    `Message:\n${text}`
  );
}

// The replies from Gemini as a clean list: at most 3, each with text (anything else is dropped).
export function cleanReplyList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      reply: typeof item?.reply === 'string' ? item.reply.trim().slice(0, 600) : '',
      meaning: typeof item?.meaning === 'string' ? item.meaning.trim().slice(0, 600) : '',
    }))
    .filter((item) => item.reply !== '')
    .slice(0, 3);
}

// Voice Translator: natural, everyday spoken translation (not word by word).
export function buildEverydayPrompt(text, sourceLang, targetLang) {
  const from = sourceLang ? `from the language with BCP-47 code "${sourceLang}" ` : '';
  return (
    'You are an interpreter helping two people talk to each other. ' +
    `Translate what the person said ${from}into the language with BCP-47 code "${targetLang}". ` +
    'Use natural, everyday spoken words that a native speaker would really say, with the same meaning, ' +
    'tone and politeness. Do not translate word by word, and do not make it formal unless the original is formal. ' +
    'The text may come from speech recognition: ignore small recognition mistakes and missing punctuation, and add normal punctuation. ' +
    'Keep or transliterate names, numbers, times, prices and addresses so they stay correct. ' +
    'Do not answer the text, do not explain and do not add notes or quotation marks. ' +
    'If it is already in the target language, return it unchanged. ' +
    'Reply with JSON only, in exactly this shape: {"translation": "<translated text>"}.\n\n' +
    `What the person said:\n${text}`
  );
}

// The normal translation instruction.
function buildTranslatePrompt(text, targetLang) {
  return (
    `Translate the following text into the language with BCP-47 code or name "${targetLang}". ` +
      'Keep or transliterate proper names, numbers, dates, email addresses, phone numbers ' +
      'and postal addresses so they stay correct and recognisable. ' +
      'Reply with JSON only, in exactly this shape: {"translation": "<translated text>"}.\n\n' +
      `Text:\n${text}`
  );
}
