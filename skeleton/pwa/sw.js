// sw.js - the service worker of the installable app (served at /sw.js so it covers the whole site).
// The rules are in sw-config.js. /api is never cached.

/* global self, caches, fetch, Request, Response, importScripts */
importScripts('/skeleton/pwa/sw-config.js');
const config = self.PVK_SW;

// Install: keep the app shell and the apps that need no AI. One missing file never stops the rest.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(config.CACHE_NAME)
      .then((cache) =>
        Promise.all(config.PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)))
      )
      .then(() => self.skipWaiting())
  );
});

// Activate: delete the caches of older versions and take control of open pages.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter(config.isOldCache).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

// Store a copy of a good answer (never /api: config.isCacheable says no).
function remember(request, response) {
  const url = new URL(request.url);
  if (!config.isCacheable(response.status, response.type, url.pathname)) return;
  const copy = response.clone();
  caches.open(config.CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
}

// A page: the newest version when online; the kept copy or the "needs internet" page when offline.
async function page(request) {
  try {
    const response = await fetch(request);
    remember(request, response);
    return response;
  } catch {
    const kept = (await caches.match(request, { ignoreSearch: true })) || (await caches.match(config.OFFLINE_PAGE));
    return kept || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

// A file: the kept copy at once (fast, works offline), refreshed in the background.
async function file(request) {
  const kept = await caches.match(request);
  const fresh = fetch(request)
    .then((response) => {
      remember(request, response);
      return response;
    })
    .catch(() => null);
  if (kept) return kept;
  const response = await fresh;
  return response || new Response('', { status: 504 });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const decision = config.decide(request.method, request.url, self.location.origin, request.mode);
  if (decision === 'page') event.respondWith(page(request));
  else if (decision === 'file') event.respondWith(file(request));
  // 'network': not handled, the browser fetches it as usual (all of /api).
});
