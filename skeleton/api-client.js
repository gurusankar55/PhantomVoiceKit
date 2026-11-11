// api-client.js
// Small helper functions that call our own backend (never Gemini directly).
// No API key is ever sent from the browser; the server holds it in .env.
//
// Every function:
//   - POSTs JSON to its /api/* route
//   - gives up after a timeout
//   - NEVER throws. On any problem it returns { error: '<description>' }
//   - on success returns the parsed JSON body from the server

// Timeout in milliseconds. The server waits up to 90 seconds for Gemini and tries
// a second time if the first attempt fails, so the browser must wait for both
// attempts (2 x 90 s) plus a little extra before it gives up.
const TIMEOUT_MS = 190000;
const TIMEOUT_TRANSLATE_MS = TIMEOUT_MS;
const TIMEOUT_EXTRACT_MS = TIMEOUT_MS;
const TIMEOUT_LESSON_MS = TIMEOUT_MS;
const TIMEOUT_EVALUATE_MS = TIMEOUT_MS;

// Shared helper: POST `body` as JSON to `url`, aborting after `timeoutMs`.
async function postJson(url, body, timeoutMs) {
  // AbortController + setTimeout works in all browsers we support.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // Try to read the JSON body (the server sends JSON for errors too).
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      // Prefer the server's error code, e.g. 'busy' or 'gemini_error'.
      const code = data && typeof data.error === 'string' ? data.error : `http_${response.status}`;
      return { error: code };
    }

    if (data === null || typeof data !== 'object') {
      return { error: 'bad_response' };
    }
    return data;
  } catch (err) {
    // AbortError means our timer fired; anything else is a network failure.
    if (err && err.name === 'AbortError') {
      return { error: 'timeout' };
    }
    return { error: 'network_error' };
  } finally {
    // Always clear the timer so it does not keep running.
    clearTimeout(timer);
  }
}

// Translate `text` into `targetLang` (a language code such as 'ta' or 'en').
// With transliterate: true the text is a NAME: it is written in the target
// letters (ஷங்கர் -> Shankar) and its meaning is not translated.
export function translate({ text, targetLang, transliterate = false }) {
  const body = transliterate ? { text, targetLang, transliterate: true } : { text, targetLang };
  return postJson('/api/translate', body, TIMEOUT_TRANSLATE_MS);
}

// Ask the server to read the form fields from a base64 PDF/image.
export function extractFields({ fileBase64, mimeType, lang }) {
  return postJson('/api/extract-fields', { fileBase64, mimeType, lang }, TIMEOUT_EXTRACT_MS);
}

// Get a short lesson (segments + quiz questions) for a topic.
export function lesson({ topic, lang }) {
  return postJson('/api/lesson', { topic, lang }, TIMEOUT_LESSON_MS);
}

// Evaluate the learner's answer to a quiz question.
export function evaluate({ topic, question, answer, lang }) {
  return postJson('/api/evaluate', { topic, question, answer, lang }, TIMEOUT_EVALUATE_MS);
}
