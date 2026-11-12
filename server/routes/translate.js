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
    const { text, targetLang, transliterate, kind, label, pattern, options } = req.body ?? {};

    // Reject missing, non-string, empty or whitespace-only text.
    if (typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'invalid_input' });
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
    const prompt = wantsValue
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
