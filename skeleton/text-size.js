// text-size.js
// Large text mode: text and buttons about 125 % bigger in every app (the "Aa" button in the
// header). Remembered in localStorage, so every app and every new tab opens the same way.
// The look itself is in theme.css (html.large-text). Every storage access is in try/catch.

export const LARGE_TEXT_KEY = 'phantomVoiceKit.largeText';
export const LARGE_TEXT_CLASS = 'large-text';

/** True when large text was switched on (a missing or blocked storage means "off"). */
export function readLargeText(storage) {
  try {
    return storage?.getItem(LARGE_TEXT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember the choice. Returns false when it could not be saved (the page still changes). */
export function saveLargeText(storage, on) {
  try {
    if (on) storage?.setItem(LARGE_TEXT_KEY, '1');
    else storage?.removeItem(LARGE_TEXT_KEY);
    return true;
  } catch {
    return false;
  }
}

function localStore() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Put the class on <html> (or take it off). */
export function applyLargeText(on, root = typeof document !== 'undefined' ? document.documentElement : null) {
  root?.classList.toggle(LARGE_TEXT_CLASS, Boolean(on));
}

/** Read the remembered choice and apply it (called before the page is shown, from i18n.js). */
export function applyStoredLargeText() {
  const on = readLargeText(localStore());
  applyLargeText(on);
  return on;
}

/** Switch large text on or off, remember it, and return the new state. */
export function setLargeText(on) {
  applyLargeText(on);
  saveLargeText(localStore(), on);
  return Boolean(on);
}

/** True while large text is on. */
export function isLargeText() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains(LARGE_TEXT_CLASS);
}
