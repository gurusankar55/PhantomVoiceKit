// language-store.js
// Where the chosen language is remembered: localStorage, so a new tab or another app opens in the
// same language. sessionStorage ("chosenLang", used before) is read as a fallback and kept in step.
// The storages are passed in (the browser's, or fakes in tests); every access is in try/catch.
// No DOM access here.

export const LANGUAGE_KEY = 'phantomVoiceKit.language';
const SESSION_KEY = 'chosenLang';
const SESSION_LABEL_KEY = 'chosenLangLabel';

// A BCP-47 code like "ta-IN" (letters, digits and dashes, not too long), or ''.
function cleanCode(value) {
  const code = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(code) && code.length <= 20 ? code : '';
}

function safeGet(storage, key) {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The remembered language: localStorage first, then sessionStorage. '' when none is saved.
 * @param {Storage|null} local
 * @param {Storage|null} session
 */
export function readLanguageCode(local, session) {
  return cleanCode(safeGet(local, LANGUAGE_KEY)) || cleanCode(safeGet(session, SESSION_KEY));
}

/**
 * Remember the language in both storages. Returns true when localStorage kept it.
 * @param {string} code  BCP-47 code
 * @param {string} [label]  English name of the language
 */
export function saveLanguageCode(code, local, session, label = '') {
  const clean = cleanCode(code);
  if (!clean) return false;
  const kept = safeSet(local, LANGUAGE_KEY, clean);
  safeSet(session, SESSION_KEY, clean);
  if (label) safeSet(session, SESSION_LABEL_KEY, String(label));
  return kept;
}

/** The browser's localStorage and sessionStorage (null when blocked or missing). */
export function browserStorages() {
  const get = (name) => {
    try {
      return typeof globalThis[name] === 'undefined' ? null : globalThis[name];
    } catch {
      return null; // reading the property itself can throw when storage is blocked
    }
  };
  return { local: get('localStorage'), session: get('sessionStorage') };
}
