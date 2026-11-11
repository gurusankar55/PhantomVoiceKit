// server/routes/evaluate.js
// POST /api/evaluate - gives short spoken feedback on a quiz answer.
// Body: { topic, question, answer, lang }  ->  Response: { feedback }

import { Router } from 'express';

// Factory: callGemini is passed in so tests can supply a fake function.
export function createEvaluateRouter(callGemini) {
  const router = Router();

  // Mounted at /api/evaluate, so the path here is just '/'.
  router.post('/', async (req, res) => {
    const { topic, question, answer, lang, skipped } = req.body ?? {};
    // skipped: true means the learner pressed Skip, so there is no answer to check.
    const isSkip = skipped === true;

    // The answer must be a non-empty string (whitespace only does not count).
    if (!isSkip && (typeof answer !== 'string' || answer.trim() === '')) {
      return res.status(400).json({ error: 'invalid_input' });
    }

    const prompt = isSkip
      ? 'The learner skipped a quiz question about "' + topic + '" and does not know the answer. ' +
        'Write "feedback" in the language with BCP-47 code "' + lang + '", in very simple words: ' +
        'say what the correct answer is, then give ONE short, simple sentence that explains why. ' +
        'Be kind. Never ask the user to try again. ' +
        'Reply with JSON only, in this shape: { "correct": false, "feedback": string }. ' +
        'Question: ' + question + '.'
      : 'Evaluate the following answer to a quiz question about "' + topic + '". ' +
        'Decide if the answer is correct. Be generous: accept an answer that has the right meaning even if it is worded differently. ' +
        'Write "feedback" in the language with BCP-47 code "' + lang + '", in very simple words. ' +
        'If the answer is correct: write one short sentence of praise. ' +
        'If the answer is wrong: say what the correct answer is, then give ONE short, simple sentence that explains why. ' +
        'Never ask the user to try again. ' +
        'Reply with JSON only, in this shape: { "correct": boolean, "feedback": string }. ' +
        'Question: ' + question + '. Answer: ' + answer + '.';

    try {
      const result = await callGemini({ prompt });
      // "correct" is true only when Gemini clearly said true; anything else counts as wrong.
      // A skipped question is never correct.
      return res.json({ correct: !isSkip && result.correct === true, feedback: result.feedback });
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
