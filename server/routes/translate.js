// server/routes/translate.js
// POST /api/translate  (server/index.js mounts this router at /api/translate)
// Body: { text, targetLang, transliterate? }  ->  Response: { translation }
// transliterate: true means "write this name in the target letters, do not translate it".

import { Router } from 'express';

// Factory: receives callGemini so tests can pass a fake function.
export function createTranslateRouter(callGemini) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { text, targetLang, transliterate } = req.body ?? {};

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
    const prompt = transliterate === true
      ? `Transliterate the following personal name into the letters of the language with BCP-47 code or name "${targetLang}". ` +
        'Do NOT translate its meaning. Write how it sounds, using the usual spelling of that name, with no extra words. ' +
        'Reply with JSON only, in exactly this shape: {"translation": "<transliterated name>"}.\n\n' +
        `Name:\n${text}`
      : buildTranslatePrompt(text, targetLang);

    try {
      const result = await callGemini({ prompt });
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
