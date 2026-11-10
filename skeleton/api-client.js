// api-client.js
// Small helper functions that call our own backend (never Gemini directly).
// No API key is ever sent from the browser; the server holds it in .env.
//
// Every function:
//   - POSTs JSON to its /api/* route
//   - gives up after a timeout
//   - NEVER throws. On any problem it returns { error: '<description>' }
//   - on success returns the parsed JSON body from the server

// Timeouts in milliseconds (a bit longer than the server's own limits where needed).
const TIMEOUT_TRANSLATE_MS = 5000;
const TIMEOUT_EXTRACT_MS = 35000;
const TIMEOUT_LESSON_MS = 25000;
const TIMEOUT_EVALUATE_MS = 10000;

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
export function translate({ text, targetLang }) {
  return postJson('/api/translate', { text, targetLang }, TIMEOUT_TRANSLATE_MS);
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
