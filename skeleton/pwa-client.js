// pwa-client.js
// The installable app (PWA), browser side: registers the service worker (/sw.js), keeps the
// browser's "install" offer for the "Install app" button in the menu, and tells pages when the
// device goes offline. Used by nav-menu.js, so every page gets it.
// Nothing runs when the file is loaded (safe to import in Node tests).

// Apps that need the internet (they call Gemini through our server). Offline they show a clear
// "needs internet" message; every other app works offline.
export const ONLINE_ONLY_APPS = Object.freeze(['spirit-clerk', 'ghost-tutor', 'form-translator', 'voice-translator']);

/** True when the app with this menu id needs the internet. */
export function needsInternet(appId) {
  return ONLINE_ONLY_APPS.includes(appId);
}

let registered = false;

/** Register /sw.js once (only where service workers are allowed: https or localhost). */
export function registerServiceWorker() {
  if (registered || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (typeof window !== 'undefined' && window.isSecureContext === false) return;
  registered = true;
  // After the page has loaded, so it never slows down the first paint.
  const go = () => navigator.serviceWorker.register('/sw.js').catch(() => {
    // Not installable here (private mode, old browser): the site works as before.
  });
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

// ---------- "Install app" ----------

let deferredPrompt = null;
const installListeners = new Set();
let installWatching = false;

function notifyInstall() {
  for (const callback of installListeners) {
    try {
      callback(deferredPrompt !== null);
    } catch {
      // a broken listener never stops the others
    }
  }
}

function watchInstall() {
  if (installWatching || typeof window === 'undefined') return;
  installWatching = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // we show our own button in the menu instead
    deferredPrompt = event;
    notifyInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notifyInstall();
  });
}

/**
 * Call `callback(available)` now and whenever the browser starts or stops offering to install.
 * Returns a function that stops listening.
 */
export function onInstallAvailable(callback) {
  watchInstall();
  installListeners.add(callback);
  callback(deferredPrompt !== null);
  return () => installListeners.delete(callback);
}

/** Show the browser's install question. Resolves true when the user accepted. */
export async function promptInstall() {
  const event = deferredPrompt;
  if (!event) return false;
  deferredPrompt = null; // the browser offers each prompt only once
  notifyInstall();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice?.outcome === 'accepted';
  } catch {
    return false;
  }
}

// ---------- Online / offline ----------

/** Call `callback(online)` now and whenever the connection changes. */
export function onConnectionChange(callback) {
  if (typeof window === 'undefined') return () => {};
  const report = () => callback(navigator.onLine !== false);
  window.addEventListener('online', report);
  window.addEventListener('offline', report);
  report();
  return () => {
    window.removeEventListener('online', report);
    window.removeEventListener('offline', report);
  };
}
