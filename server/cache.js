// server/cache.js
// A small in-memory cache, so the same request is never sent to Gemini twice.
// Nothing is written to disk: the cache is gone when the server stops.

import { createHash } from 'node:crypto';

// At most this many answers are kept; when it is full, the oldest one is dropped.
export const MAX_ENTRIES = 200;
// An answer is kept for 24 hours.
export const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Make a cache.
 * @param {{maxEntries?:number, ttlMs?:number, now?:() => number}} options
 *   now = a clock (tests pass a fake one to skip 24 hours)
 */
export function createCache({ maxEntries = MAX_ENTRIES, ttlMs = TTL_MS, now = Date.now } = {}) {
  // A Map remembers the order things were added, so its first key is the oldest one.
  const entries = new Map();

  return {
    /** The saved value, or undefined when there is none or it is older than ttlMs. */
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.savedAt >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },

    /** Save a value. A key that is saved again moves to the newest place. */
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, savedAt: now() });
      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value); // drop the oldest
      }
    },

    get size() {
      return entries.size;
    },
  };
}

/**
 * A short fingerprint of a request: the route, the prompt (which holds the text and the
 * language) and any image or file data. Only this hash is used as the key, so the cache
 * never holds a second copy of an uploaded form.
 * @param {string} route  e.g. "translate-layout"
 * @param {{prompt?:string, inlineParts?:object[]}} request  the options given to callGemini
 */
export function hashRequest(route, { prompt = '', inlineParts = [] } = {}) {
  const hash = createHash('sha256');
  hash.update(`${route}\n${prompt}\n`);
  for (const part of inlineParts) {
    const data = part?.inlineData;
    hash.update(`${data?.mimeType ?? ''}\n${data?.data ?? ''}\n`);
  }
  return hash.digest('hex');
}

/**
 * Wrap callGemini so an answer that was already given is returned from the cache.
 * Only a usable answer is saved; an error is never saved, so a failed call can be tried again.
 * The cached value is copied on the way in and out, so a route can change its copy freely.
 * @param {Function} callGemini
 * @param {string} route  name of the route, part of the key and shown in the log
 * @param {{cache?:object, isUsable?:(answer:any) => boolean}} options
 */
export function withCache(callGemini, route, { cache = createCache(), isUsable = () => true } = {}) {
  return async function cachedGemini(request) {
    const key = hashRequest(route, request);

    const hit = cache.get(key);
    if (hit !== undefined) {
      console.log(`[cache] hit ${route} ${key.slice(0, 8)} (no Gemini call)`);
      return structuredClone(hit);
    }

    const answer = await callGemini(request);
    if (isUsable(answer)) cache.set(key, structuredClone(answer));
    return answer;
  };
}
