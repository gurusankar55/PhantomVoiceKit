// i18n.js
// Tiny translation helper for the whole UI (20 languages).
//   - t(key, params)        -> translated string
//   - setLocale(bcp47)      -> switch language without reloading the page
//   - applyTranslations(el) -> fills in every data-i18n / data-i18n-attr element
//
// IMPORTANT: this file must not touch `document` or `window` when it is
// imported, so it can be loaded in Node for tests.

import { readLanguageCode, browserStorages } from './language-store.js';

// Language codes that have a file in /skeleton/locales/.
export const SUPPORTED_LOCALE_CODES = [
  'en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es',
  'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr',
];

// Right-to-left languages (Arabic and Urdu).
export const RTL_CODES = ['ar', 'ur'];

// code -> translations object (already loaded).
const cache = new Map();
// code -> Promise of a translations object (still loading).
const inFlight = new Map();
// Functions to call after the language changes.
const listeners = new Set();

// English is always the fallback. It starts empty until loaded.
let english = {};
// Strings for the current language (same object as `english` at first).
let current = english;
let currentState = { bcp47: 'en-US', code: 'en', dir: 'ltr' };

// Counts setLocale calls so an older, slower call can detect it lost the race.
let latestRequest = 0;

// Load one locale file. Returns the object, or null if loading failed.
// Successful loads are cached; parallel calls share one fetch.
function loadLocale(code) {
  if (cache.has(code)) return Promise.resolve(cache.get(code));
  if (inFlight.has(code)) return inFlight.get(code);

  const promise = (async () => {
    try {
      const response = await fetch(`/skeleton/locales/${code}.json`);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const strings = await response.json();
      cache.set(code, strings);
      return strings;
    } catch (err) {
      return null; // caller falls back to English
    } finally {
      inFlight.delete(code); // failures are not cached, so a retry can work
    }
  })();

  inFlight.set(code, promise);
  return promise;
}

// The remembered language (localStorage, so every tab and app opens in it), or English.
function readStoredLang() {
  const { local, session } = browserStorages();
  return readLanguageCode(local, session) || 'en-US';
}

/**
 * The strings of any language (for example a second language to learn). Cached; null when the
 * file could not be loaded. Only the app's own /skeleton/locales files are read.
 * @param {string} code  e.g. "ta" or "ta-IN"
 */
export function loadStrings(code) {
  const base = String(code ?? '').split('-')[0].toLowerCase();
  if (!SUPPORTED_LOCALE_CODES.includes(base)) return Promise.resolve(null);
  return loadLocale(base);
}

// Load English plus the chosen language, then apply everything.
// Safe to call more than once.
export async function initI18n() {
  await setLocale(readStoredLang());
}

// Switch to another language.
export async function setLocale(bcp47) {
  const request = ++latestRequest;
  const code = String(bcp47).split('-')[0].toLowerCase();

  // Load English and the target language at the same time.
  const [en, strings] = await Promise.all([loadLocale('en'), loadLocale(code)]);

  // A newer setLocale call started while we were waiting: let it win.
  if (request !== latestRequest) return;

  if (en) english = en;
  // If the language failed to load, keep showing English.
  const usable = strings || english;
  const usedCode = strings ? code : 'en';
  current = usable;

  const dir = RTL_CODES.includes(usedCode) ? 'rtl' : 'ltr';
  currentState = { bcp47: strings ? bcp47 : 'en-US', code: usedCode, dir };

  if (typeof document !== 'undefined') {
    document.documentElement.lang = currentState.bcp47;
    document.documentElement.dir = dir;
    applyTranslations(document);
    // Reveal the page (theme.css hides it until this class is set).
    // This also runs when the locale failed to load and English is used.
    document.documentElement.classList.add('i18n-ready');
  }

  // Tell listeners (copy first so they can unsubscribe while we loop).
  for (const callback of [...listeners]) {
    try {
      callback({ ...currentState });
    } catch (err) {
      console.error('onLocaleChange listener failed', err);
    }
  }
}

// Register a listener. Returns a function that removes it.
export function onLocaleChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getLocale() {
  return { ...currentState };
}

export function isRtl() {
  return currentState.dir === 'rtl';
}

// Look up a key: current language, then English, then the key itself.
// "{name}" placeholders are replaced from params; unknown ones stay as-is.
export function t(key, params) {
  let text = current[key] ?? english[key] ?? key;
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
    );
  }
  return text;
}

// Translate one element using its data-i18n* attributes.
function applyToElement(el) {
  const key = el.getAttribute('data-i18n');
  if (key) {
    let params;
    const rawParams = el.getAttribute('data-i18n-params');
    if (rawParams) {
      try {
        params = JSON.parse(rawParams);
      } catch (err) {
        params = undefined; // ignore bad JSON
      }
    }
    el.textContent = t(key, params);
  }

  // Format: "aria-label:key;placeholder:key;title:key"
  const attrSpec = el.getAttribute('data-i18n-attr');
  if (attrSpec) {
    for (const pair of attrSpec.split(';')) {
      const index = pair.indexOf(':');
      if (index < 1) continue;
      const attr = pair.slice(0, index).trim();
      const attrKey = pair.slice(index + 1).trim();
      if (attr && attrKey) el.setAttribute(attr, t(attrKey));
    }
  }
}

// Translate root (if it is an element) and everything inside it.
export function applyTranslations(root = document) {
  if (!root) return;
  if (root.nodeType === 1 && typeof root.matches === 'function') {
    if (root.matches('[data-i18n], [data-i18n-attr]')) applyToElement(root);
  }
  if (typeof root.querySelectorAll === 'function') {
    root.querySelectorAll('[data-i18n], [data-i18n-attr]').forEach(applyToElement);
  }
}

// Mark an element as translated text, so it updates on language change.
export function setI18nText(el, key, params) {
  el.setAttribute('data-i18n', key);
  if (params) {
    el.setAttribute('data-i18n-params', JSON.stringify(params));
  } else {
    el.removeAttribute('data-i18n-params');
  }
  el.textContent = t(key, params);
}

// Mark one attribute (aria-label, placeholder, title...) as translated.
export function setI18nAttr(el, attr, key) {
  const entries = (el.getAttribute('data-i18n-attr') || '')
    .split(';')
    .filter((pair) => pair && pair.split(':')[0].trim() !== attr);
  entries.push(`${attr}:${key}`);
  el.setAttribute('data-i18n-attr', entries.join(';'));
  el.setAttribute(attr, t(key));
}

// Stop translating an element and empty it (used when hiding messages).
export function clearI18n(el) {
  el.removeAttribute('data-i18n');
  el.removeAttribute('data-i18n-params');
  el.textContent = '';
}
