// pwa.test.js
// The installable app: manifest, icons, the service worker rules (never /api, offline apps kept),
// the server routes for /sw.js and /manifest.webmanifest, the "Install app" button and the
// "needs internet" notice, and large text mode. No browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import vm from 'node:vm';
import { inflateSync } from 'node:zlib';
import request from 'supertest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

import { app } from '../../server/index.js';
import { ONLINE_ONLY_APPS, needsInternet } from '../../skeleton/pwa-client.js';
import { LARGE_TEXT_KEY, readLargeText, saveLargeText, applyLargeText } from '../../skeleton/text-size.js';
import { encodePng, drawIcon } from '../../tools/make-icons.mjs';

const ROOT = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8');
const APPS = readdirSync(new URL('apps/', ROOT), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

// The service worker config, loaded the way the service worker loads it (a classic script).
function loadConfig() {
  const sandbox = { self: {}, URL };
  vm.runInNewContext(read('skeleton/pwa/sw-config.js'), sandbox);
  return sandbox.self.PVK_SW;
}
const SW = loadConfig();
const ORIGIN = 'http://localhost:3000';

// URL path -> file in the repository.
function fileOf(urlPath) {
  if (urlPath === '/') return 'index.html';
  if (urlPath === '/manifest.webmanifest') return 'skeleton/pwa/manifest.webmanifest';
  return urlPath.slice(1);
}

describe('manifest and icons', () => {
  const manifest = JSON.parse(read('skeleton/pwa/manifest.webmanifest'));

  test('name, colours, start page and display mode', () => {
    assert.equal(manifest.name, 'Phantom Voice Kit');
    assert.ok(manifest.short_name.length <= 15);
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
    assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  });

  test('192 and 512 icons, normal and maskable, are real PNG files of that size', () => {
    for (const size of [192, 512]) {
      for (const purpose of ['any', 'maskable']) {
        assert.ok(manifest.icons.some((i) => i.sizes === `${size}x${size}` && i.purpose === purpose && i.type === 'image/png'), `${size} ${purpose}`);
      }
      const png = readFileSync(new URL(`skeleton/pwa/icons/icon-${size}.png`, ROOT));
      assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      assert.equal(png.toString('ascii', 12, 16), 'IHDR');
      assert.equal(png.readUInt32BE(16), size);
      assert.equal(png.readUInt32BE(20), size);
    }
  });

  test('the icon writer makes valid pixel data (no packages needed)', () => {
    const png = encodePng(2, 1, new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]));
    const idatAt = png.indexOf('IDAT');
    const length = png.readUInt32BE(idatAt - 4);
    const rows = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + length));
    assert.deepEqual([...rows], [0, 255, 0, 0, 255, 0, 0, 255, 255]);
    // The drawn icon: opaque, dark purple corners, the white ghost in the middle
    const pixels = drawIcon(64);
    assert.ok(pixels.every((v, i) => i % 4 !== 3 || v === 255));
    const at = (x, y) => [...pixels.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];
    assert.ok(at(2, 2).every((v) => v < 120), 'corner is dark purple (#3b2068 at the top)');
    assert.ok(at(28, 18).every((v) => v > 200), 'ghost is light');
  });

  test('every page links the manifest and the icon', () => {
    for (const page of ['index.html', ...APPS.map((a) => `apps/${a}/index.html`)]) {
      const html = read(page);
      assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest" \/>/, page);
      assert.match(html, /<meta name="theme-color"/, page);
    }
  });
});

describe('service worker rules', () => {
  test('/api is never cached and never answered from a cache', () => {
    for (const method of ['GET', 'POST']) {
      for (const path of ['/api/translate', '/api/lesson', '/api', '/api/evaluate?x=1']) {
        assert.equal(SW.decide(method, ORIGIN + path, ORIGIN, method === 'GET' ? 'cors' : 'cors'), 'network', `${method} ${path}`);
      }
    }
    assert.equal(SW.isCacheable(200, 'basic', '/api/translate'), false);
    assert.ok(!SW.PRECACHE.some((url) => SW.isApiPath(url.split('?')[0])));
    assert.match(read('skeleton/pwa/sw.js'), /config\.isCacheable/);
  });

  test('pages: network first; files: cache first; other sites and POST: untouched', () => {
    assert.equal(SW.decide('GET', `${ORIGIN}/apps/ghost-echo/index.html`, ORIGIN, 'navigate'), 'page');
    assert.equal(SW.decide('GET', `${ORIGIN}/skeleton/theme.css`, ORIGIN, 'no-cors'), 'file');
    assert.equal(SW.decide('GET', 'https://fonts.googleapis.com/css2', ORIGIN, 'no-cors'), 'network');
    assert.equal(SW.decide('POST', `${ORIGIN}/skeleton/theme.css`, ORIGIN, 'cors'), 'network');
    assert.equal(SW.decide('GET', `${ORIGIN}/sw.js`, ORIGIN, 'no-cors'), 'network');
    assert.equal(SW.decide('GET', 'not a url', ORIGIN, 'cors'), 'network');
    assert.equal(SW.isApiPath('/apiary'), false);
  });

  test('property: anything under /api is always "network" (100 runs)', () => {
    fc.assert(fc.property(fc.webPath(), fc.constantFrom('GET', 'POST', 'PUT'), fc.constantFrom('navigate', 'cors', 'no-cors'), (path, method, mode) => {
      return SW.decide(method, `${ORIGIN}/api/${path.replace(/^\//, '')}`, ORIGIN, mode) === 'network';
    }), { numRuns: 100 });
  });

  test('only complete answers from this site are stored', () => {
    assert.equal(SW.isCacheable(200, 'basic', '/skeleton/i18n.js'), true);
    assert.equal(SW.isCacheable(404, 'basic', '/x'), false);
    assert.equal(SW.isCacheable(200, 'opaque', '/x'), false);
    assert.equal(SW.isOldCache('pvk-v0-shell'), true);
    assert.equal(SW.isOldCache(SW.CACHE_NAME), false);
    assert.equal(SW.isOldCache('someone-else'), false);
  });

  test('every precached file exists', () => {
    for (const url of SW.PRECACHE) assert.ok(existsSync(new URL(fileOf(url), ROOT)), url);
  });

  test('the app shell: Home, all skeleton files, the 20 translations and the offline page', () => {
    assert.ok(SW.PRECACHE.includes('/'));
    assert.ok(SW.PRECACHE.includes(SW.OFFLINE_PAGE));
    for (const file of readdirSync(new URL('skeleton/', ROOT)).filter((f) => /\.(js|css)$/.test(f))) assert.ok(SW.PRECACHE.includes(`/skeleton/${file}`), file);
    for (const file of readdirSync(new URL('skeleton/locales/', ROOT))) assert.ok(SW.PRECACHE.includes(`/skeleton/locales/${file}`), file);
  });

  test('the apps that need no AI are kept completely; every app is either offline or online-only', () => {
    for (const [appName, files] of Object.entries(SW.OFFLINE_APPS)) {
      const real = readdirSync(new URL(`apps/${appName}/`, ROOT)).sort();
      assert.deepEqual([...files].sort(), real, appName);
      for (const file of files) assert.ok(SW.PRECACHE.includes(`/apps/${appName}/${file}`));
    }
    assert.deepEqual([...Object.keys(SW.OFFLINE_APPS), ...SW.ONLINE_APPS].sort(), [...APPS].sort());
    assert.deepEqual([...SW.ONLINE_APPS].sort(), [...ONLINE_ONLY_APPS].sort());
    for (const appName of SW.ONLINE_APPS) assert.ok(!SW.PRECACHE.some((u) => u.startsWith(`/apps/${appName}/`)), appName);
  });

  test('the apps that call /api are exactly the online-only ones', () => {
    for (const appName of APPS) {
      const code = readdirSync(new URL(`apps/${appName}/`, ROOT)).filter((f) => f.endsWith('.js')).map((f) => read(`apps/${appName}/${f}`)).join('\n');
      assert.equal(/api-client\.js/.test(code), needsInternet(appName), appName);
    }
  });
});

describe('server routes for the installable app', () => {
  test('/sw.js is served from the root, never cached by the browser', async () => {
    const res = await request(app).get('/sw.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /javascript/);
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.match(res.text, /importScripts\('\/skeleton\/pwa\/sw-config.js'\)/);
  });

  test('/manifest.webmanifest has the manifest type', async () => {
    const res = await request(app).get('/manifest.webmanifest');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/manifest\+json/);
  });

  test('private files are still not served', async () => {
    for (const path of ['/.env', '/server/index.js', '/package.json', '/tools/make-icons.mjs']) {
      const res = await request(app).get(path);
      assert.equal(res.status, 404, path);
    }
  });
});

describe('Install app button and the "needs internet" notice', () => {
  const nav = read('skeleton/nav-menu.js');

  test('the menu shows "Install app" only when the browser offers it, and Tab can reach it', () => {
    assert.match(nav, /onInstallAvailable\(\(available\) => \{\s*install\.hidden = !available;/);
    assert.match(nav, /promptInstall\(\)/);
    assert.match(nav, /drawerItems\(\)/);
    assert.match(read('skeleton/pwa-client.js'), /beforeinstallprompt/);
  });

  test('AI apps say "needs internet" while offline; the service worker is registered on every page', () => {
    assert.match(nav, /if \(needsInternet\(current\)\)/);
    assert.match(nav, /'pwa\.needsInternet'/);
    assert.match(nav, /registerServiceWorker\(\)/);
    assert.deepEqual([...ONLINE_ONLY_APPS].sort(), ['form-translator', 'ghost-tutor', 'spirit-clerk', 'talk-learn', 'voice-translator']);
  });
});

// ---------- Large text mode ----------

describe('large text mode', () => {
  function memoryStorage() {
    const data = new Map();
    return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
  }

  test('remembered on and off; blocked storage means off and never throws', () => {
    const storage = memoryStorage();
    assert.equal(readLargeText(storage), false);
    assert.equal(saveLargeText(storage, true), true);
    assert.equal(storage.data.get(LARGE_TEXT_KEY), '1');
    assert.equal(readLargeText(storage), true);
    saveLargeText(storage, false);
    assert.equal(readLargeText(storage), false);
    const blocked = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    assert.equal(readLargeText(blocked), false);
    assert.equal(saveLargeText(blocked, true), false);
  });

  test('the class goes on <html> and off again', () => {
    const classes = new Set();
    const root = { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } };
    applyLargeText(true, root);
    assert.ok(classes.has('large-text'));
    applyLargeText(false, root);
    assert.ok(!classes.has('large-text'));
  });

  test('applied before the page is shown, with an "Aa" toggle in every header', () => {
    assert.match(read('skeleton/i18n.js'), /applyStoredLargeText\(\);\s*\n\s*await setLocale/);
    const nav = read('skeleton/nav-menu.js');
    assert.match(nav, /textSize\.textContent = 'Aa'/);
    assert.match(nav, /aria-pressed/);
  });

  test('about 125 %, bigger touch targets, and the header wraps instead of scrolling sideways', () => {
    const theme = read('skeleton/theme.css');
    assert.match(theme, /html\.large-text \{\s*font-size: 125%;\s*--touch-min: 55px;/);
    assert.match(theme, /\.nav-bar \{[^}]*flex-wrap: wrap;/);
  });

  test('no fixed width wider than a 320 px phone at 125 % (outside wide-screen rules)', () => {
    // 320 px - 32 px page padding = 288 px; at 125 % one rem is 20 px, so at most 14.4 rem.
    const files = ['skeleton/theme.css', ...APPS.map((a) => `apps/${a}/style.css`)];
    for (const file of files) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
      // Drop the wide-screen blocks (min-width: 480 px and up).
      const narrow = css.replace(/@media \(min-width: (4[89]\d|[5-9]\d\d|\d{4,})px\) \{[\s\S]*?\n\}/g, '');
      for (const m of narrow.matchAll(/(?<![-\w])(min-width|width|flex-basis):\s*([\d.]+)rem/g)) {
        assert.ok(Number(m[2]) <= 14.4, `${file}: ${m[0]}`);
      }
      for (const m of narrow.matchAll(/minmax\(\s*([\d.]+)rem/g)) {
        assert.ok(Number(m[1]) <= 14.4, `${file}: minmax(${m[1]}rem`);
      }
    }
  });
});
