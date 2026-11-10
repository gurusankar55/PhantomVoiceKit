// server/routes/extract-fields.js
// POST /api/extract-fields
// Reads a form (PDF or image) with Gemini and returns its fields plus a
// short spoken question for each one, written in the user's language.

import { Router } from 'express';

// File types we accept.
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/**
 * Factory: receives callGemini so tests can pass a fake function.
 * @param {Function} callGemini - async ({ prompt, inlineParts }) => object
 * @returns {import('express').Router}
 */
export function createExtractFieldsRouter(callGemini) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { fileBase64, mimeType, lang } = req.body ?? {};

    // 1. Validate the input.
    const hasFile = typeof fileBase64 === 'string' && fileBase64.trim() !== '';
    if (!hasFile || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      return res.status(400).json({ error: 'invalid_input' });
    }

    // 2. Build the prompt.
    const prompt =
      'You are given a form (a PDF or a photo). ' +
      'Identify ALL form fields in document order (top-to-bottom, left-to-right). ' +
      'For each field, write a short, friendly question that can be spoken aloud, ' +
      `in the language with BCP-47 code "${lang}", even if the form itself is in another language. ` +
      'Reply with JSON only, in this shape: ' +
      '{ "fields": [ { "label": string, "inputType": "text" | "date" | "checkbox" | "selection", "question": string } ] }';

    // The file is sent to Gemini as inline data.
    const inlineParts = [{ inlineData: { mimeType, data: fileBase64 } }];

    // 3. Call Gemini and map errors to HTTP statuses.
    try {
      const result = await callGemini({ prompt, inlineParts });
      const fields = Array.isArray(result?.fields) ? result.fields : [];
      return res.json({ fields });
    } catch (err) {
      if (err?.code === 'timeout') return res.status(504).json({ error: 'timeout' });
      if (err?.code === 'rate_limit') return res.status(429).json({ error: 'busy' });
      return res.status(502).json({ error: 'gemini_error' });
    }
  });

  return router;
}
