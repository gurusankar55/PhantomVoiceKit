// server/gemini.js
// Thin wrapper around the Google Gemini SDK.
// The API key is read from the environment (.env) and never leaves the server.

import 'dotenv/config'; // loads .env into process.env
import { GoogleGenAI } from '@google/genai';

// How long we wait for Gemini before giving up (30 seconds).
const TIMEOUT_MS = 30_000;

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

/**
 * Ask Gemini for a JSON answer.
 * @param {{ prompt: string, inlineParts?: object[] }} options
 *   prompt      - the instruction text
 *   inlineParts - optional extra parts, e.g. [{ inlineData: { mimeType, data } }]
 * @returns {Promise<object>} the parsed JSON response
 * @throws {{code: 'timeout'} | {code: 'rate_limit'} | {code: 'gemini_error', message: string}}
 */
export async function callGemini({ prompt, inlineParts = [] } = {}) {
  // One user message: the text first, then any files/images.
  const contents = [{ role: 'user', parts: [{ text: prompt }, ...inlineParts] }];

  // The AbortSignal cancels the HTTP request if it takes too long.
  const controller = new AbortController();
  let timer;

  // This promise rejects after 30 seconds; it races against the real call.
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject({ code: 'timeout' });
    }, TIMEOUT_MS);
  });

  try {
    const request = getClient().models.generateContent({
      model: process.env.GEMINI_MODEL,
      contents,
      config: {
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 }, // no "thinking" = faster replies
        abortSignal: controller.signal,
      },
    });

    const response = await Promise.race([request, timeout]);
    return JSON.parse(response.text);
  } catch (err) {
    throw toGeminiError(err);
  } finally {
    clearTimeout(timer); // always stop the timer
  }
}
