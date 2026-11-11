// POST /api/lesson
// Asks Gemini for a lesson of exactly 4 short segments, each with a quiz question.
import { Router } from 'express';

// Factory: callGemini is passed in so tests can give a fake function.
export function createLessonRouter(callGemini) {
  const router = Router();

  // Mounted at /api/lesson, so the path here is just '/'
  router.post('/', async (req, res) => {
    const { topic, lang, covered: rawCovered } = req.body || {};

    // Reject missing, non-string, empty or whitespace-only topics (no Gemini call)
    if (typeof topic !== 'string' || topic.trim() === '') {
      return res.status(400).json({ error: 'invalid_input' });
    }

    const cleanTopic = topic.trim();
    // Titles of the parts the learner already studied, so they are not repeated.
    const covered = Array.isArray(rawCovered)
      ? rawCovered
          .filter((c) => typeof c === 'string' && c.trim() !== '')
          .slice(0, 40)
          .map((c) => c.trim().slice(0, 200))
      : [];
    // Fall back to English if no language was sent
    const language = typeof lang === 'string' && lang.trim() !== '' ? lang.trim() : 'en-US';

    const alreadyTaught =
      covered.length > 0
        ? 'The learner has ALREADY studied these parts: ' +
          covered.map((c) => '"' + c + '"').join('; ') +
          '. Go deeper into new details. Do NOT repeat or re-explain any of them. '
        : '';

    const prompt =
      'You are a friendly tutor. Generate a complete lesson on the topic "' + cleanTopic + '" ' +
      'as exactly 4 short segments. Each segment has a spoken explanation ("segment"), ' +
      'a very short title of at most 6 words ("title") ' +
      'and a follow-up quiz question ("quizQuestion"), all written in the language ' + language + '. ' +
      alreadyTaught +
      'Reply with JSON only: { "segments": [ { "title": "...", "segment": "...", "quizQuestion": "..." } ] } ' +
      'with exactly 4 items.';

    try {
      const result = await callGemini({ prompt });

      // Gemini must give us at least 4 segments; extra ones are dropped.
      if (!result || !Array.isArray(result.segments) || result.segments.length < 4) {
        return res.status(502).json({ error: 'bad_ai_response' });
      }
      const segments = result.segments.slice(0, 4);

      // Every kept segment needs non-empty segment and quizQuestion strings.
      const isGood = (s) =>
        s &&
        typeof s.segment === 'string' && s.segment.trim() !== '' &&
        typeof s.quizQuestion === 'string' && s.quizQuestion.trim() !== '';
      if (!segments.every(isGood)) {
        return res.status(502).json({ error: 'bad_ai_response' });
      }

      return res.json({ segments });
    } catch (err) {
      // Map known error codes to HTTP statuses; never leak details
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
