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
  if (err && typeof err === 'object' && ['timeout', 'rate_limit', 'unavailable', 'gemini_error'].includes(err.code)) {
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
  // 503 = the model is overloaded right now. Like a rate limit, another model may be free.
  if (err && (err.status === 503 || err.code === 503)) {
    return { code: 'unavailable' };
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

/**
 * Turn the text of Gemini's reply into an object.
 * Models sometimes wrap the JSON in markdown fences (```json ... ```) or add a
 * sentence before or after it, even when JSON was requested. This accepts those.
 * The error thrown for unusable text never contains the text itself, because
 * it could hold the user's form and error messages are logged.
 * @param {unknown} text
 * @returns {any}
 */
export function parseModelJson(text) {
  const raw = String(text ?? '').trim();

  // 1. Plain JSON (the normal case).
  try {
    return JSON.parse(raw);
  } catch {
    // fall through to the repairs below
  }

  // 2. Remove markdown fences.
  const unfenced = raw.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '').trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    // fall through
  }

  // 3. Cut out the part from the first { or [ to the last } or ].
  const starts = [unfenced.indexOf('{'), unfenced.indexOf('[')].filter((i) => i !== -1);
  const ends = [unfenced.lastIndexOf('}'), unfenced.lastIndexOf(']')];
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  const end = Math.max(...ends);
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      // fall through
    }
  }

  throw new Error('Gemini reply is not valid JSON');
}

/**
 * Settings that differ from model to model.
 * "No thinking" (thinkingBudget 0) makes replies faster, but the lite and pro models reject it
 * with HTTP 400, so only the other (flash) models get it.
 * @param {string} model
 * @returns {object} extra generateContent config
 */
export function modelConfig(model) {
  if (/lite|pro/i.test(String(model))) return {};
  return { thinkingConfig: { thinkingBudget: 0 } };
}

/**
 * The ordered list of models to try, main model first.
 * Read from GEMINI_MODELS (comma separated). If it is not set, the older GEMINI_MODEL and
 * GEMINI_FALLBACK_MODEL variables are used. Empty entries and repeats are dropped.
 * @returns {string[]}
 */
export function getModelList() {
  const listed = (process.env.GEMINI_MODELS ?? '').split(',');
  const names = listed.some((name) => name.trim() !== '')
    ? listed
    : [process.env.GEMINI_MODEL, process.env.GEMINI_FALLBACK_MODEL];
  const clean = names.map((name) => String(name ?? '').trim()).filter((name) => name !== '');
  return [...new Set(clean)];
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
    // Settings that depend on the model (see modelConfig).
    Object.assign(config, modelConfig(model));

    const request = getClient().models.generateContent({ model, contents, config });

    const response = await Promise.race([request, timeout]);
    return parseModelJson(response.text);
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
 * The models come from getModelList(), main model first.
 * Rules:
 *  - rate_limit (HTTP 429) or unavailable (HTTP 503): the same model is NOT tried again.
 *    The call moves on to the next model in the list.
 *  - timeout or any other error: tried one more time on the same model (once per call).
 *  - If every model is rate limited or unavailable, the error of the last model is thrown.
 * Every failed attempt, and the model that answered, is printed to the console.
 *
 * @param {(model: string, contents: object[]) => Promise<object>} attempt
 */
export function createCallGemini(attempt) {
  return async function callGemini({ prompt, inlineParts = [] } = {}) {
    // One user message: the text first, then any files/images.
    const contents = [{ role: 'user', parts: [{ text: prompt }, ...inlineParts] }];

    const models = getModelList();
    let position = 0;
    let retryUsed = false;

    // The loop always ends: each failure moves to the next model or uses up the one retry.
    for (;;) {
      const model = models[position];
      const startedAt = Date.now();
      try {
        const result = await attempt(model, contents);
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(`[gemini] answered by ${model} in ${seconds}s`);
        return result;
      } catch (err) {
        const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
        const prefix = `[gemini] ${model} failed after ${seconds}s - ${safeText(err)}`;

        if (err.code === 'rate_limit' || err.code === 'unavailable') {
          // Never retry the same model: go to the next one, if there is one.
          if (position + 1 < models.length) {
            position += 1;
            console.error(`${prefix} - trying next model ${models[position]}`);
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