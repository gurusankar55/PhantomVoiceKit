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
const TIMEOUT_LAYOUT_MS = TIMEOUT_MS;

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
// With kind (and label, pattern) the text is an ANSWER to a form field: the reply also has
// "value", the form-ready English answer (date as DD/MM/YYYY, digits, e-mail, code...).
export function translate({ text, targetLang, transliterate = false, kind, label, pattern, options }) {
  const body = transliterate ? { text, targetLang, transliterate: true } : { text, targetLang };
  if (kind) {
    body.kind = kind;
    if (label) body.label = label;
    if (pattern) body.pattern = pattern;
    if (Array.isArray(options) && options.length > 0) body.options = options; // the labels of a choice field
  }
  return postJson('/api/translate', body, TIMEOUT_TRANSLATE_MS);
}

// Ask the server to read the form fields from a base64 PDF/image.
// Either one file (fileBase64 + mimeType) or 1 to 5 page images
// images: [{ mimeType, data }] (data = base64 without the "data:" prefix).
// Each returned field has answerBox ([ymin, xmin, ymax, xmax] on a 0 to 1000 scale, or null) and page (0-based).
export function extractFields({ fileBase64, mimeType, lang, images }) {
  const body = Array.isArray(images) ? { images, lang } : { fileBase64, mimeType, lang };
  return postJson('/api/extract-fields', body, TIMEOUT_EXTRACT_MS);
}

// Translate ONE page image. Returns { blocks: [{ text, translation, box_2d }] } where
// box_2d is [ymin, xmin, ymax, xmax] on a 0 to 1000 scale.
export function translateLayout({ imageBase64, mimeType, lang }) {
  return postJson('/api/translate-layout', { imageBase64, mimeType, lang }, TIMEOUT_LAYOUT_MS);
}

// Get a short lesson (segments + quiz questions) for a topic.
// covered (optional): titles of parts already taught, so new parts go deeper.
export function lesson({ topic, lang, covered }) {
  const body = Array.isArray(covered) && covered.length > 0 ? { topic, lang, covered } : { topic, lang };
  return postJson('/api/lesson', body, TIMEOUT_LESSON_MS);
}

// Evaluate the learner's answer to a quiz question.
// skipped: true asks for the correct answer and a short explanation (no answer to check).
export function evaluate({ topic, question, answer, lang, skipped = false }) {
  const body = skipped ? { topic, question, answer: '', lang, skipped: true } : { topic, question, answer, lang };
  return postJson('/api/evaluate', body, TIMEOUT_EVALUATE_MS);
}
