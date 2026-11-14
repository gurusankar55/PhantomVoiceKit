// translator-utils.js
// Pure rules of the Voice Translator: languages, swap, whose turn is translated into what, the
// last 30 translations, the remembered settings and the error messages. Storage is passed in;
// every access is in try/catch. No DOM, no network.

export const HISTORY_KEY = 'phantomVoiceKit.voiceTranslator.history';
export const SETTINGS_KEY = 'phantomVoiceKit.voiceTranslator.settings';
export const MAX_HISTORY = 30;
export const MAX_TEXT = 1000; // characters in one turn (the server allows 2000)

/** Text ready to translate: spaces tidied, at most MAX_TEXT characters. */
export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

/** "ta-IN" -> "ta". */
export function baseOf(code) {
  return String(code ?? '').split('-')[0].toLowerCase();
}

/**
 * The language object of a code ("ta-IN" or just "ta"), or null.
 * @param {string} code
 * @param {ReadonlyArray<{bcp47:string}>} languages  the 20 languages (language-dropdown.js)
 */
export function findLanguage(code, languages) {
  if (typeof code !== 'string' || code === '') return null;
  return languages.find((l) => l.bcp47 === code) ?? languages.find((l) => baseOf(l.bcp47) === baseOf(code)) ?? null;
}

/** True when both codes are the same language (nothing to translate). */
export function sameLanguage(a, b) {
  return baseOf(a) !== '' && baseOf(a) === baseOf(b);
}

/** A good "To" language when none was chosen yet: English, or Tamil for English speakers. */
export function defaultTarget(fromCode) {
  return baseOf(fromCode) === 'en' ? 'ta-IN' : 'en-US';
}

/** From and To swapped. */
export function swapLanguages({ from, to }) {
  return { from: to, to: from };
}

/**
 * Conversation mode: who speaks decides the direction.
 * 'me' speaks my language and is translated into the other person's; 'other' the other way round.
 */
export function turnLanguages(speaker, me, other) {
  return speaker === 'other' ? { from: other, to: me } : { from: me, to: other };
}

// ---------- Settings ----------

export const MODES = Object.freeze(['single', 'chat', 'helper']);

/**
 * { to, other, mode, speakAuto } with valid codes only ('' = not chosen).
 * speakAuto: read translations aloud by themselves (off unless the user switched it on).
 */
export function cleanSettings(value, languages) {
  const pick = (code) => findLanguage(code, languages)?.bcp47 ?? '';
  const v = value && typeof value === 'object' ? value : {};
  return { to: pick(v.to), other: pick(v.other), mode: MODES.includes(v.mode) ? v.mode : 'single', speakAuto: v.speakAuto === true };
}

// ---------- Translating automatically ----------

export const AUTO_DELAY_MS = 1000; // translate 1 s after typing stops

/**
 * The same request twice is never sent: the key of a request is its languages and text.
 * Returns '' when there is nothing to translate.
 */
export function requestKey(text, from, to) {
  const clean = cleanText(text);
  return clean === '' ? '' : `${from}|${to}|${clean}`;
}

/** True when a new request should go out (there is text and it differs from the last one). */
export function shouldTranslate(key, lastKey) {
  return key !== '' && key !== lastKey;
}

// ---------- Message helper ----------

export const MAX_HINT = 300;

/** The language found by the server, if it is one of ours ('' otherwise: the user picks it). */
export function detectedLanguage(code, languages) {
  return findLanguage(code, languages)?.bcp47 ?? '';
}

/** The replies from /api/translate (style "reply") as a clean list of at most 3. */
export function cleanReplies(reply) {
  const list = Array.isArray(reply?.replies) ? reply.replies : [];
  return list
    .map((item) => ({ reply: String(item?.reply ?? '').trim(), meaning: String(item?.meaning ?? '').trim() }))
    .filter((item) => item.reply !== '')
    .slice(0, 3);
}

/**
 * "Another reply": the next of the replies already written, or null after the last one
 * (then new replies are asked for).
 */
export function nextReplyIndex(index, count) {
  return index + 1 < count ? index + 1 : null;
}

export function loadSettings(storage, languages) {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return cleanSettings(text ? JSON.parse(text) : null, languages);
  } catch {
    return cleanSettings(null, languages);
  }
}

export function saveSettings(storage, settings, languages) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(cleanSettings(settings, languages)));
    return true;
  } catch {
    return false;
  }
}

// ---------- The last 30 translations ----------
// An entry: { id, at, from, to, text, translation, speaker } (speaker: 'me' | 'other' | '').

function cleanEntry(value) {
  if (!value || typeof value !== 'object') return null;
  const text = cleanText(value.text);
  const translation = String(value.translation ?? '').trim().slice(0, MAX_TEXT * 2);
  if (typeof value.id !== 'string' || value.id === '' || text === '' || translation === '') return null;
  const code = (c) => (typeof c === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(c) ? c : '');
  return {
    id: value.id,
    at: Number.isFinite(value.at) ? value.at : 0,
    from: code(value.from),
    to: code(value.to),
    text,
    translation,
    speaker: value.speaker === 'me' || value.speaker === 'other' ? value.speaker : '',
  };
}

/** Any stored value as a clean list: newest first, at most 30, no repeated ids. */
export function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const list = [];
  for (const raw of value) {
    const entry = cleanEntry(raw);
    if (entry && !seen.has(entry.id)) {
      seen.add(entry.id);
      list.push(entry);
    }
  }
  return list.sort((a, b) => b.at - a.at).slice(0, MAX_HISTORY);
}

export function loadHistory(storage) {
  try {
    const text = storage?.getItem(HISTORY_KEY);
    return text ? cleanHistory(JSON.parse(text)) : [];
  } catch {
    return [];
  }
}

export function saveHistory(storage, history) {
  try {
    storage?.setItem(HISTORY_KEY, JSON.stringify(cleanHistory(history)));
    return true;
  } catch {
    return false;
  }
}

/** A new list with the entry first (the oldest beyond 30 is dropped). */
export function addEntry(history, entry) {
  const clean = cleanEntry(entry);
  if (!clean) return cleanHistory(history);
  return cleanHistory([clean, ...cleanHistory(history).filter((e) => e.id !== clean.id)]);
}

/** A new list without that entry. */
export function removeEntry(history, id) {
  return cleanHistory(history).filter((entry) => entry.id !== id);
}

// ---------- Errors ----------

/** The translation key of the message for an error from api-client.js. */
export function errorKey(error) {
  if (error === 'network_error') return 'voiceTranslator.offline';
  if (error === 'busy' || error === 'http_429') return 'common.rateLimit';
  if (error === 'timeout') return 'voiceTranslator.timeout';
  return 'voiceTranslator.failed';
}

/** The text of a reply from /api/translate, or '' when it has none. */
export function translationOf(reply) {
  return reply && typeof reply.translation === 'string' ? reply.translation.trim() : '';
}

/** True when this browser can share text (Web Share API). */
export function canShareText(nav) {
  return Boolean(nav) && typeof nav.share === 'function';
}
