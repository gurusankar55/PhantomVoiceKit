// server/gemini.js
// Thin wrapper around the Google Gemini SDK.
// The API key is read from the environment (.env) and never leaves the server.

import 'dotenv/config'; // loads .env into process.env
import { GoogleGenAI } from '@google/genai';

// How long we wait for ONE Gemini attempt before giving up (90 seconds).
const TIMEOUT_MS = 90_000;

// The client is created lazily (on first use) so that importing this module
// without an API key does not crash the server or the tests.
let client = null;
function getClient() {
  if (!client) {
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// Turn any error from the SDK into one of our three simple error shapes.
function toGeminiError(err) {
  // Already one of our shapes (e.g. the timeout) - pass it through.
  if (err && typeof err === 'object' && ['timeout', 'rate_limit', 'gemini_error'].includes(err.code)) {
    return err;
  }
  // Aborted requests count as timeouts.
  if (err && err.name === 'AbortError') {
    return { code: 'timeout' };
  }
  // The SDK puts the HTTP status on err.status (some versions use err.code).
  if (err && (err.status === 429 || err.code === 429)) {
    return { code: 'rate_limit' };
  }
  return { code: 'gemini_error', message: err?.message ?? String(err) };
}

// Make an error safe to print: the API key is replaced if it ever appears in the text.
function safeText(err) {
  let text = err.message ? `${err.code}: ${err.message}` : String(err.code);
  const key = process.env.GEMINI_API_KEY;
  if (key) {
    text = text.split(key).join('[hidden]');
  }
  return text;
}

// One single attempt at calling ONE model (with its own 90 second timer).
// Resolves to the parsed JSON, or throws { code: 'timeout' | 'rate_limit' | 'gemini_error' }.
async function attemptGemini(model, contents) {
  // The AbortSignal cancels the HTTP request if it takes too long.
  const controller = new AbortController();
  let timer;

  // This promise rejects after the timeout; it races against the real call.
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject({ code: 'timeout' });
    }, TIMEOUT_MS);
  });

  try {
    const config = {
      responseMimeType: 'application/json',
      abortSignal: controller.signal,
    };
    // "No thinking" = faster replies. Only the main model gets this setting:
    // the lighter fallback model rejects thinkingBudget 0 with HTTP 400.
    if (model === process.env.GEMINI_MODEL) {
      config.thinkingConfig = { thinkingBudget: 0 };
    }

    const request = getClient().models.generateContent({ model, contents, config });

    const response = await Promise.race([request, timeout]);
    return JSON.parse(response.text);
  } catch (err) {
    throw toGeminiError(err);
  } finally {
    clearTimeout(timer); // always stop the timer
  }
}

/**
 * Build a callGemini function around an "attempt" function.
 * (Tests pass a fake attempt, so the real Gemini API is never called.)
 *
 * Rules:
 *  - rate_limit (HTTP 429): the same model is NOT tried again, because that only
 *    wastes the free quota. The call is tried once with GEMINI_FALLBACK_MODEL.
 *    If that is empty (or the same as GEMINI_MODEL) there is no fallback.
 *  - timeout or any other error: tried one more time on the same model.
 *  - If every model is rate limited, { code: 'rate_limit' } is thrown.
 * Every failed attempt, and the model that answered, is printed to the console.
 *
 * @param {(model: string, contents: object[]) => Promise<object>} attempt
 */
export function createCallGemini(attempt) {
  return async function callGemini({ prompt, inlineParts = [] } = {}) {
    // One user message: the text first, then any files/images.
    const contents = [{ role: 'user', parts: [{ text: prompt }, ...inlineParts] }];

    const primary = process.env.GEMINI_MODEL;
    const fallback = (process.env.GEMINI_FALLBACK_MODEL ?? '').trim();

    let model = primary;
    let fallbackUsed = false;
    let retryUsed = false;

    // The loop always ends: each failure uses up the fallback or the retry.
    for (;;) {
      const startedAt = Date.now();
      try {
        const result = await attempt(model, contents);
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[gemini] answered by ${model} in ${seconds}s`);
        return result;
      } catch (err) {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        const prefix = `[gemini] ${model} failed after ${seconds}s - ${safeText(err)}`;

        if (err.code === 'rate_limit') {
          // Never retry the same model on a rate limit: switch to the fallback once.
          if (fallback !== '' && fallback !== primary && !fallbackUsed) {
            console.error(`${prefix} - trying fallback model ${fallback}`);
            fallbackUsed = true;
            model = fallback;
            continue;
          }
          console.error(`${prefix} - giving up`);
          throw err;
        }

        // Timeout or other error: one more try on the same model.
        if (!retryUsed) {
          console.error(`${prefix} - retrying`);
          retryUsed = true;
          continue;
        }
        console.error(`${prefix} - giving up`);
        throw err;
      }
    }
  };
}

/**
 * Ask Gemini for a JSON answer.
 * @param {{ prompt: string, inlineParts?: object[] }} options
 *   prompt      - the instruction text
 *   inlineParts - optional extra parts, e.g. [{ inlineData: { mimeType, data } }]
 * @returns {Promise<object>} the parsed JSON response
 * @throws {{code: 'timeout'} | {code: 'rate_limit'} | {code: 'gemini_error', message: string}}
 */
export const callGemini = createCallGemini(attemptGemini);