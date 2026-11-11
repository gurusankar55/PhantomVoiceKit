// server/routes/translate-layout.js
// POST /api/translate-layout
// Reads ONE page image with Gemini and returns every block of printed text on it,
// with its box and its translation into the user's language.
// Nothing is stored (Requirement 22). The server console gets only counts and
// reason names (how many blocks were kept or dropped), never any text from the form.

import { Router } from 'express';
import { parseLayoutReply, normalizeBlocks, describeReport } from './layout-parser.js';

// Image types we accept (a PDF page is turned into an image in the browser).
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Language names help Gemini more than codes alone. Key = first part of the BCP-47 code.
const LANGUAGE_NAMES = {
  en: 'English', ta: 'Tamil', hi: 'Hindi', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam',
  ko: 'Korean', zh: 'Chinese (Simplified)', ja: 'Japanese', es: 'Spanish', fr: 'French',
  ar: 'Arabic', pt: 'Portuguese', ru: 'Russian', bn: 'Bengali', ur: 'Urdu',
  id: 'Indonesian', de: 'German', vi: 'Vietnamese', tr: 'Turkish',
};

/**
 * Check what Gemini returned and keep only the good blocks.
 * (The work is done by layout-parser.js, which also repairs the shapes that
 * different models use. This wrapper is kept for the tests.)
 * @param {unknown} raw  the list of blocks from Gemini
 * @returns {{text:string, translation:string, box_2d:number[]}[]}
 */
export function validateBlocks(raw) {
  return normalizeBlocks(raw).blocks;
}

/**
 * The instruction sent to Gemini together with the page image.
 * The reply shape is shown with an example, because small models copy an example
 * better than they follow a description.
 * @param {string} lang  BCP-47 code such as "ta-IN"
 */
export function buildPrompt(lang) {
  const languageName = LANGUAGE_NAMES[lang.split('-')[0].toLowerCase()] ?? lang;
  return (
    'You are given ONE page of a form (a photo, a screenshot or a scan). ' +
    'Find EVERY block of printed or written text on the page: titles, field labels, paragraphs, ' +
    'list items, table cells, notes and small print. One block is one line or one short paragraph. ' +
    'Never merge text from different columns or table cells into one block.\n' +
    'For each block give exactly three keys:\n' +
    '1. "text": the text exactly as printed.\n' +
    `2. "translation": that text translated into ${languageName} (BCP-47 code "${lang}"). ` +
    'Keep names, numbers, dates, codes and e-mail addresses as they are. Never leave it empty.\n' +
    '3. "box_2d": a FLAT list of exactly 4 whole numbers [ymin, xmin, ymax, xmax] giving the tight box around the text. ' +
    'The numbers are on a scale from 0 to 1000 for BOTH axes, whatever the size of the image: ' +
    'y runs from 0 (top edge) to 1000 (bottom edge), x runs from 0 (left edge) to 1000 (right edge). ' +
    'Do NOT use pixels, do NOT use values from 0 to 1, do NOT put the list inside another list, and do NOT use an object.\n' +
    'List the blocks in reading order. If the page has no text, return {"blocks": []}.\n' +
    'Reply with JSON only (no markdown, no explanation), in exactly this shape. ' +
    'The numbers below are only an example of the format:\n' +
    '{"blocks": [{"text": "First name", "translation": "<First name in the target language>", "box_2d": [120, 40, 150, 230]}]}'
  );
}

/**
 * Factory: receives callGemini so tests can pass a fake function.
 * @param {Function} callGemini - async ({ prompt, inlineParts }) => object
 * @returns {import('express').Router}
 */
export function createTranslateLayoutRouter(callGemini) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { imageBase64, mimeType, lang } = req.body ?? {};

    // 1. Validate the input.
    const hasImage = typeof imageBase64 === 'string' && imageBase64.trim() !== '';
    const hasLang = typeof lang === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang);
    if (!hasImage || !ALLOWED_MIME_TYPES.includes(mimeType) || !hasLang) {
      return res.status(400).json({ error: 'invalid_input' });
    }

    // 2. Build the prompt. The page image is sent to Gemini as inline data (kept in memory only).
    const prompt = buildPrompt(lang);
    const inlineParts = [{ inlineData: { mimeType, data: imageBase64 } }];

    // 3. Call Gemini and map errors to HTTP statuses.
    try {
      const result = await callGemini({ prompt, inlineParts });

      // Find the blocks, repair the shapes different models use, and drop the unusable ones.
      const parsed = parseLayoutReply(result);
      if (!parsed) {
        // Only the kind of reply and its key names are logged, never its content.
        const kind = Array.isArray(result) ? 'array' : typeof result;
        const keys = result && typeof result === 'object' ? Object.keys(result).slice(0, 8).join(',') : '';
        console.error(`[translate-layout] ${lang} reply has no list of blocks (type=${kind} keys=${keys})`);
        return res.status(502).json({ error: 'gemini_error' });
      }

      console.log(`[translate-layout] ${lang} ${describeReport(parsed.report)}`);
      return res.json({ blocks: parsed.blocks });
    } catch (err) {
      if (err?.code === 'timeout') return res.status(504).json({ error: 'timeout' });
      if (err?.code === 'rate_limit') return res.status(429).json({ error: 'busy' });
      return res.status(502).json({ error: 'gemini_error' });
    }
  });

  return router;
}
