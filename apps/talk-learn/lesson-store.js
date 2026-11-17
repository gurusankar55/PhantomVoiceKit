// lesson-store.js
// Where a Talk & Learn lesson comes from, in this order:
//   1. a built-in file (apps/talk-learn/lessons/<speak>-<learn>/<scenario>.json, no API call)
//   2. the localStorage cache (a lesson that was made before)
//   3. /api/conversation (the answer is then saved in the cache)
// It also prepares the NEXT lesson quietly in the background (prefetch), one request at a time,
// and stops for the rest of the browser session after a "busy" (429) answer (remembered in
// sessionStorage, so a reload does not start it again). A cancelled lesson is never saved.
//
// No DOM here: fetch, the storage and the API call are passed in, so tests use fakes.

import {
  cleanConversation,
  cacheKey,
  readCachedLesson,
  saveCachedLesson,
  builtInPath,
  pairFolder,
  nextLessonId,
  lessonToPrefetch,
  BUILT_IN_INDEX_PATH,
} from './talk-utils.js';

/**
 * @param {{
 *   fetchFn: (url: string) => Promise<{ ok: boolean, json: () => Promise<any> }>,
 *   storage: Storage | null,
 *   request: (args: { scenario: string, learnLang: string, speakLang: string }) => Promise<any>,
 *   isOnline?: () => boolean,
 *   session?: Storage | null,   // where the busy stop is remembered for this browser session
 * }} options
 */
export const PREFETCH_STOP_KEY = 'phantomVoiceKit.talkLearn.prefetchStopped';

export function createLessonStore({ fetchFn, storage, request, isOnline = () => true, session = null }) {
  let indexPromise = null; // the list of built-in lessons, read once
  const inflight = new Map(); // cache key -> { controller, cancelled, promise } of that lesson's API request (shared)
  const failed = new Set(); // lessons the background could not make: not tried again
  let stopped = false; // a busy answer was seen: no more background requests

  // Stopped by a busy answer in this page, or earlier in this browser session.
  function isStopped() {
    if (stopped) return true;
    try {
      stopped = session?.getItem(PREFETCH_STOP_KEY) === '1';
    } catch {
      // blocked storage: only this page remembers
    }
    return stopped;
  }

  function stopPrefetch() {
    stopped = true;
    try {
      session?.setItem(PREFETCH_STOP_KEY, '1');
    } catch {
      // blocked storage: only this page remembers
    }
  }
  let prefetching = false; // one background request at a time

  // { "ta-hi": ["greetings", ...], ... }; {} when the file is missing or damaged.
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = (async () => {
        try {
          const response = await fetchFn(BUILT_IN_INDEX_PATH);
          if (!response.ok) return {};
          const data = await response.json();
          return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        } catch {
          return {};
        }
      })();
    }
    return indexPromise;
  }

  const listedIn = (index, scenario, learn, speak) => {
    const list = index[pairFolder(speak, learn)];
    return Array.isArray(list) && list.includes(scenario);
  };

  // The built-in lesson, or null (not listed, missing, or not a usable conversation).
  async function builtIn(scenario, learn, speak) {
    const index = await loadIndex();
    if (!listedIn(index, scenario, learn, speak)) return null;
    try {
      const response = await fetchFn(builtInPath(speak, learn, scenario));
      if (!response.ok) return null;
      return cleanConversation(await response.json());
    } catch {
      return null;
    }
  }

  /** The lesson when it needs no API call: { convo, source: 'built-in' | 'cache' }, or null. */
  async function getLocal(scenario, learn, speak) {
    const fixed = await builtIn(scenario, learn, speak);
    if (fixed) return { convo: fixed, source: 'built-in' };
    const saved = readCachedLesson(storage, cacheKey(scenario, learn, speak));
    return saved ? { convo: saved, source: 'cache' } : null;
  }

  // Ask the server and save the answer, unless the request was cancelled.
  // Never throws: { convo, source: 'api' } or { error }.
  async function askServer(scenario, learn, speak, entry) {
    let answer;
    try {
      answer = await request({ scenario, learnLang: learn, speakLang: speak, signal: entry.controller.signal });
    } catch {
      answer = { error: 'network_error' };
    }
    // Cancelled: the answer is thrown away, even when it arrived just before the cancel took effect.
    if (entry.cancelled) return { error: 'cancelled' };
    if (!answer || answer.error) {
      const error = answer?.error ?? 'bad_response';
      if (error === 'busy') stopPrefetch(); // the server is busy: no more background requests
      return { error };
    }
    const convo = cleanConversation(answer);
    if (!convo) return { error: 'bad_response' };
    saveCachedLesson(storage, cacheKey(scenario, learn, speak), convo); // full or blocked storage: still works
    return { convo, source: 'api' };
  }

  /**
   * The lesson from the best place. Two callers asking for the same lesson at the same time share
   * ONE request (for example a user opening the lesson that is being prepared in the background).
   * `signal` (optional) cancels: the request is dropped, NOTHING is saved, and every caller of
   * that request gets { error: 'cancelled' }. The background will not try that lesson again.
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<{ convo: object, source: string } | { error: string }>}
   */
  // The user cancelled this lesson: drop its request (also one the background started) and never
  // make it quietly afterwards. A late answer is thrown away (entry.cancelled), so nothing is saved.
  function cancelLesson(key) {
    failed.add(key);
    const entry = inflight.get(key);
    if (entry) {
      entry.cancelled = true;
      entry.controller.abort();
    }
  }

  async function get(scenario, learn, speak, { signal } = {}) {
    const key = cacheKey(scenario, learn, speak);
    if (signal?.aborted) {
      cancelLesson(key);
      return { error: 'cancelled' };
    }
    const local = await getLocal(scenario, learn, speak);
    if (local) return local;
    // Cancelled while the built-in and saved lessons were checked (the listener below was not there yet).
    if (signal?.aborted) {
      cancelLesson(key);
      return { error: 'cancelled' };
    }
    let entry = inflight.get(key);
    if (!entry) {
      entry = { controller: new AbortController(), cancelled: false, promise: null };
      entry.promise = askServer(scenario, learn, speak, entry).finally(() => {
        if (inflight.get(key) === entry) inflight.delete(key);
      });
      inflight.set(key, entry);
    }
    if (signal) {
      const cancel = () => cancelLesson(key);
      signal.addEventListener('abort', cancel, { once: true });
      entry.promise.finally(() => signal.removeEventListener('abort', cancel));
    }
    return entry.promise;
  }

  /**
   * Prepare the lesson that follows `current` when it is neither built-in nor saved.
   * Resolves when the background request (if any) has ended.
   * @returns {Promise<'saved' | 'skipped' | 'busy' | 'failed' | 'stopped'>}
   */
  async function prefetchNext(current, learn, speak) {
    if (isStopped()) return 'stopped';
    if (prefetching || !isOnline()) return 'skipped';
    const index = await loadIndex();
    const next = lessonToPrefetch(current, (id) =>
      listedIn(index, id, learn, speak) || readCachedLesson(storage, cacheKey(id, learn, speak)) !== null
    );
    if (next === '' || failed.has(cacheKey(next, learn, speak))) return 'skipped';
    if (isStopped()) return 'stopped';
    if (prefetching) return 'skipped'; // another call started while the index was loading
    prefetching = true;
    try {
      const result = await get(next, learn, speak);
      if (result.error) {
        if (result.error === 'busy') return 'busy';
        failed.add(cacheKey(next, learn, speak));
        return 'failed';
      }
      return result.source === 'api' ? 'saved' : 'skipped';
    } finally {
      prefetching = false;
    }
  }

  return { getLocal, get, prefetchNext, isStopped, hasNext: (id) => nextLessonId(id) !== '' };
}