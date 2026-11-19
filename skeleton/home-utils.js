// home-utils.js
// Pure rules of the Home screen: which apps are for children, adults or everyone, the filter
// chips (the chosen one is remembered), and the demo video link. No DOM, no network.

// Who each app is for. A chip shows exactly its own group; "All" shows every app.
export const APP_AUDIENCE = Object.freeze({
  'ghost-echo': 'children',
  'picture-book': 'children',
  'pumpkin-math': 'children',
  'story-time': 'children',
  'sticker-book': 'children',
  'spirit-clerk': 'adults',
  'form-translator': 'adults',
  'voice-translator': 'adults',
  'my-documents': 'adults',
  'voice-notes': 'adults',
  'ghost-tutor': 'everyone',
  'calm-time': 'everyone',
  'talk-learn': 'everyone',
  'kolam-puzzle': 'everyone',
});

export const FILTERS = Object.freeze(['all', 'children', 'adults', 'everyone']);
export const FILTER_KEY = 'phantomVoiceKit.homeFilter';

/** A known filter, or 'all'. */
export function cleanFilter(value) {
  return FILTERS.includes(value) ? value : 'all';
}

/** True when the app with this id is shown for the chosen filter. */
export function isVisible(appId, filter) {
  const chosen = cleanFilter(filter);
  return chosen === 'all' || APP_AUDIENCE[appId] === chosen;
}

/** The ids shown for a filter, in the order given. */
export function visibleApps(appIds, filter) {
  return appIds.filter((id) => isVisible(id, filter));
}

export function loadFilter(storage) {
  try {
    return cleanFilter(storage?.getItem(FILTER_KEY));
  } catch {
    return 'all';
  }
}

export function saveFilter(storage, filter) {
  try {
    storage?.setItem(FILTER_KEY, cleanFilter(filter));
    return true;
  } catch {
    return false;
  }
}

// ---------- The demo video ----------

// The link to the demo video (2 min 35 s, on YouTube). The Home "Watch the demo video" button
// opens it in a new tab; while this is empty, the button stays hidden.
export const DEMO_VIDEO_URL = 'https://youtu.be/Imi-Y5hDKcc';

/** The demo link when it is a real https address, else '' (the button stays hidden). */
export function demoUrl(value = DEMO_VIDEO_URL) {
  if (typeof value !== 'string' || value.trim() === '') return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}
