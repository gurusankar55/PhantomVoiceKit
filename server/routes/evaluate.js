// server/routes/evaluate.js
// POST /api/evaluate - gives short spoken feedback on a quiz answer.
// Body: { topic, question, answer, lang }  ->  Response: { feedback }

import { Router } from 'express';

// Factory: callGemini is passed in so tests can supply a fake function.
export function createEvaluateRouter(callGemini) {
  const router = Router();

  // Mounted at /api/evaluate, so the path here is just '/'.
  router.post('/', async (req, res) => {
    const { topic, question, answer, lang } = req.body ?? {};

    // The answer must be a non-empty string (whitespace only does not count).
    if (typeof answer !== 'string' || answer.trim() === '') {
      return res.status(400).json({ error: 'invalid_input' });
    }

    const prompt =
      `Evaluate the following answer to a quiz question about "${topic}". ` +
      `Provide brief spoken feedback in the language with BCP-47 code "${lang}". ` +
      `Reply with JSON only, in this shape: { "feedback": string }. ` +
      `Question: ${question}. Answer: ${answer}.`;

    try {
      const result = await callGemini({ prompt });
      return res.json({ feedback: result.feedback });
    } catch (err) {
      // Map our simple error codes to HTTP statuses.
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
