// sw-config.js
// The rules of the service worker (skeleton/pwa/sw.js): which files are kept for offline use,
// and what to do with each request. A classic script (the service worker loads it with
// importScripts), so it sets self.PVK_SW. The unit tests load it the same way.
//
// Rules:
//   - /api/... is NEVER cached and never answered from a cache (AI answers stay fresh and private).
//   - Only GET requests to this site are handled; everything else goes straight to the network.
//   - Pages: network first (the newest version when online), the cache when offline, and a
//     friendly "needs internet" page for a page that was never opened before.
//   - Files (scripts, styles, translations, icons): the cache first, refreshed in the background.

(function (root) {
  'use strict';

  // Change this when the precache list changes: old caches are then deleted.
  var VERSION = 'pvk-v1';
  var CACHE_NAME = VERSION + '-shell';
  var OFFLINE_PAGE = '/skeleton/pwa/offline.html';

  var LOCALES = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr'];

  // The shared skeleton: every page needs these.
  var SKELETON = [
    'api-client.js', 'app-icons.js', 'celebrate-utils.js', 'celebrate.js', 'digits.js', 'documents-store.js',
    'documents-utils.js', 'dual-display.js', 'field-formats.js', 'form-overlay-utils.js', 'form-overlay.js',
    'i18n.js', 'inline-confirm.js', 'language-dropdown.js', 'language-store.js', 'nav-menu.js', 'number-words.js',
    'page-images-utils.js', 'page-images.js', 'picture-words.js', 'pwa-client.js', 'speech-input.js',
    'speech-output-utils.js', 'speech-output.js', 'speech-utils.js', 'spoken-numbers.js', 'stickers.js',
    'text-fallback-utils.js', 'text-fallback.js', 'text-pages-utils.js', 'text-pages.js', 'text-size.js',
    'theme.css', 'translation-rules.js', 'voice-commands.js', 'voice-retry.js', 'word-match.js',
  ];

  // Apps that need no AI: kept completely, so they work offline.
  var OFFLINE_APPS = {
    'ghost-echo': ['index.html', 'app.js', 'echo-utils.js', 'style.css'],
    'sticker-book': ['index.html', 'app.js', 'style.css'],
    'my-documents': ['index.html', 'app.js', 'style.css'],
    'voice-notes': ['index.html', 'app.js', 'notes-utils.js', 'style.css'],
    'picture-book': ['index.html', 'app.js', 'book-utils.js', 'style.css'],
    'pumpkin-math': ['index.html', 'app.js', 'math-utils.js', 'style.css'],
    'story-time': ['index.html', 'app.js', 'story-utils.js', 'style.css'],
    'calm-time': ['index.html', 'app.js', 'calm-utils.js', 'style.css'],
  };

  // Apps that need the internet (Gemini): kept only after they were opened once; offline they
  // show "needs internet".
  var ONLINE_APPS = ['spirit-clerk', 'ghost-tutor', 'form-translator', 'voice-translator'];

  var PRECACHE = ['/', '/manifest.webmanifest', OFFLINE_PAGE, '/skeleton/pwa/icons/icon-192.png', '/skeleton/pwa/icons/icon-512.png']
    .concat(SKELETON.map(function (file) { return '/skeleton/' + file; }))
    .concat(LOCALES.map(function (code) { return '/skeleton/locales/' + code + '.json'; }));
  Object.keys(OFFLINE_APPS).forEach(function (app) {
    OFFLINE_APPS[app].forEach(function (file) { PRECACHE.push('/apps/' + app + '/' + file); });
  });

  /** True for the AI proxy routes (/api and everything below it). */
  function isApiPath(pathname) {
    return pathname === '/api' || pathname.indexOf('/api/') === 0;
  }

  /**
   * What to do with a request: 'network' (do not touch it), 'page' (network first, then cache,
   * then the offline page) or 'file' (cache first, refreshed in the background).
   * @param {string} method  e.g. 'GET'
   * @param {string} url     the full URL
   * @param {string} origin  this site, e.g. 'http://localhost:3000'
   * @param {string} mode    request.mode ('navigate' for a page)
   */
  function decide(method, url, origin, mode) {
    if (method !== 'GET') return 'network';
    var parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      return 'network';
    }
    if (parsed.origin !== origin) return 'network'; // fonts, the PDF library: the browser decides
    if (isApiPath(parsed.pathname)) return 'network';
    if (parsed.pathname === '/sw.js') return 'network';
    if (mode === 'navigate') return 'page';
    return 'file';
  }

  /** May this response be stored? Only complete, successful answers from this site. */
  function isCacheable(status, type, pathname) {
    return status === 200 && (type === 'basic' || type === 'default') && !isApiPath(pathname);
  }

  /** True for an old cache of this app that must be deleted. */
  function isOldCache(name) {
    return name.indexOf('pvk-') === 0 && name !== CACHE_NAME;
  }

  root.PVK_SW = {
    VERSION: VERSION,
    CACHE_NAME: CACHE_NAME,
    OFFLINE_PAGE: OFFLINE_PAGE,
    PRECACHE: PRECACHE,
    OFFLINE_APPS: OFFLINE_APPS,
    ONLINE_APPS: ONLINE_APPS,
    isApiPath: isApiPath,
    decide: decide,
    isCacheable: isCacheable,
    isOldCache: isOldCache,
  };
})(typeof self !== 'undefined' ? self : globalThis);
