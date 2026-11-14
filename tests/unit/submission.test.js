// submission.test.js
// The final pieces: Home categories and filter chips, the demo link, the "How to use" guides of
// every app (real buttons, all 20 languages), the deploy files (/healthz, engines, render.yaml,
// .gitignore), the LICENSE and no temp files left. No browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import request from 'supertest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

import { app } from '../../server/index.js';
import { APP_AUDIENCE, FILTERS, FILTER_KEY, cleanFilter, isVisible, visibleApps, loadFilter, saveFilter, DEMO_VIDEO_URL, demoUrl } from '../../skeleton/home-utils.js';
import { GUIDES, GUIDE_SEEN_KEY, guideSteps, allGuideKeys, hasSeen, markSeen, pickTarget, placeBubble } from '../../skeleton/guide-utils.js';

const ROOT = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8');
const APPS = readdirSync(new URL('apps/', ROOT), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const LOCALES = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr'];
const STRINGS = Object.fromEntries(LOCALES.map((c) => [c, JSON.parse(read(`skeleton/locales/${c}.json`))]));
const HOME = read('index.html');

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
}
const blocked = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };

// ---------- Home ----------

describe('Home categories', () => {
  test('the groups asked for, covering all 12 apps', () => {
    const group = (g) => Object.keys(APP_AUDIENCE).filter((id) => APP_AUDIENCE[id] === g).sort();
    assert.deepEqual(group('children'), ['ghost-echo', 'picture-book', 'pumpkin-math', 'sticker-book', 'story-time']);
    assert.deepEqual(group('adults'), ['form-translator', 'my-documents', 'spirit-clerk', 'voice-notes', 'voice-translator']);
    assert.deepEqual(group('everyone'), ['calm-time', 'ghost-tutor']);
    assert.deepEqual(Object.keys(APP_AUDIENCE).sort(), [...APPS].sort());
  });

  test('All shows every app; each chip shows exactly its group', () => {
    const ids = Object.keys(APP_AUDIENCE);
    assert.equal(visibleApps(ids, 'all').length, 12);
    for (const filter of ['children', 'adults', 'everyone']) {
      assert.ok(visibleApps(ids, filter).every((id) => APP_AUDIENCE[id] === filter));
    }
    assert.equal(cleanFilter('nonsense'), 'all');
  });

  test('property: every app is shown by All and by exactly one other chip (100 runs)', () => {
    fc.assert(fc.property(fc.constantFrom(...Object.keys(APP_AUDIENCE)), (id) => {
      return isVisible(id, 'all') && FILTERS.filter((f) => f !== 'all' && isVisible(id, f)).length === 1;
    }), { numRuns: 100 });
  });

  test('the chosen chip is remembered; blocked storage means All', () => {
    const storage = memoryStorage();
    assert.equal(saveFilter(storage, 'children'), true);
    assert.equal(storage.data.get(FILTER_KEY), 'children');
    assert.equal(loadFilter(storage), 'children');
    assert.equal(loadFilter(blocked), 'all');
    assert.equal(saveFilter(blocked, 'adults'), false);
  });

  test('Home has a card for each of the 12 apps, four chips and four "Who is it for?" cards', () => {
    const cards = [...HOME.matchAll(/<article class="app-card" data-app="([\w-]+)"[\s\S]*?href="\/apps\/([\w-]+)\//g)];
    assert.equal(cards.length, 12);
    for (const [, id, href] of cards) assert.equal(id, href);
    assert.deepEqual([...HOME.matchAll(/data-filter="(\w+)"/g)].map((m) => m[1]), FILTERS);
    assert.equal((HOME.match(/class="who-card"/g) ?? []).length, 4);
    assert.match(HOME, /data-i18n="home\.who4"/);
    assert.match(HOME, /showFilter\(loadFilter\(homeStorage\(\)\)\)/);
  });
});

describe('the demo video button', () => {
  test('the demo video link is set and opens in a new tab; an empty link hides the button', () => {
    assert.equal(DEMO_VIDEO_URL, 'https://youtu.be/aEdtDj24_uc');
    assert.equal(demoUrl(), 'https://youtu.be/aEdtDj24_uc');
    assert.equal(demoUrl(''), '', 'empty: the button stays hidden');
    assert.match(read('README.md'), /Demo video: https:\/\/youtu\.be\/aEdtDj24_uc/);
    // The button text has no length any more ("2-minute" was removed in every language).
    for (const code of LOCALES) assert.ok(!/\d/.test(STRINGS[code]['home.watchDemo']), code);
    assert.equal(STRINGS.en['home.watchDemo'], 'Watch the demo video');
    assert.equal(demoUrl('https://youtu.be/abc'), 'https://youtu.be/abc');
    assert.equal(demoUrl('http://example.com'), '', 'only https');
    assert.equal(demoUrl('javascript:alert(1)'), '');
    assert.equal(demoUrl('not a url'), '');
    assert.match(HOME, /<a id="demo-link"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*hidden>/);
  });
});

// ---------- How to use ----------

describe('"How to use" guides', () => {
  test('every app has 3 or 4 steps', () => {
    assert.deepEqual(Object.keys(GUIDES).sort(), [...APPS].sort());
    for (const id of APPS) {
      const steps = guideSteps(id);
      assert.ok(steps.length >= 3 && steps.length <= 4, id);
    }
    assert.deepEqual(guideSteps('nope'), []);
  });

  test('every step points at a real element of that app page (or at nothing)', () => {
    for (const id of APPS) {
      const html = read(`apps/${id}/index.html`);
      assert.match(html, /<main[\s\S]*?<h1/, `${id}: the button goes after the title`);
      for (const step of guideSteps(id)) {
        for (const selector of step.target) {
          const idMatch = /^#([\w-]+)$/.exec(selector);
          const classMatch = /^\.([\w-]+)$/.exec(selector);
          const forMatch = /^label\[for="([\w-]+)"\]$/.exec(selector);
          if (idMatch) assert.match(html, new RegExp(`\\sid="${idMatch[1]}"`), `${id} ${selector}`);
          else if (classMatch) assert.match(html, new RegExp(`class="[^"]*\\b${classMatch[1]}\\b`), `${id} ${selector}`);
          else if (forMatch) assert.match(html, new RegExp(`<label for="${forMatch[1]}"`), `${id} ${selector}`);
          else assert.fail(`${id}: unknown selector ${selector}`);
        }
      }
    }
  });

  test('every step and button is translated into all 20 languages', () => {
    const keys = [...allGuideKeys(), 'guide.button', 'guide.skip', 'guide.next', 'guide.done', 'guide.step'];
    for (const code of LOCALES) {
      for (const key of keys) assert.ok(typeof STRINGS[code][key] === 'string' && STRINGS[code][key].trim() !== '', `${code} ${key}`);
      assert.match(STRINGS[code]['guide.step'], /\{n\}[\s\S]*\{total\}|\{total\}[\s\S]*\{n\}/, code);
    }
    for (const code of LOCALES.filter((c) => c !== 'en')) assert.notEqual(STRINGS[code]['guide.ghost-echo.2'], STRINGS.en['guide.ghost-echo.2'], code);
  });

  test('shown once by itself: the first visit is remembered per app', () => {
    const storage = memoryStorage();
    assert.equal(hasSeen(storage, 'picture-book'), false);
    assert.equal(markSeen(storage, 'picture-book'), true);
    markSeen(storage, 'picture-book');
    assert.equal(hasSeen(storage, 'picture-book'), true);
    assert.equal(hasSeen(storage, 'story-time'), false);
    assert.deepEqual(JSON.parse(storage.data.get(GUIDE_SEEN_KEY)), ['picture-book']);
    assert.equal(hasSeen(blocked, 'x'), false);
    assert.equal(markSeen(blocked, 'x'), false);
    storage.setItem(GUIDE_SEEN_KEY, '{broken');
    assert.equal(hasSeen(storage, 'picture-book'), false);
  });

  test('the first shown element of the list is highlighted', () => {
    const page = { '#a': { shown: false }, '#b': { shown: true } };
    const find = (s) => page[s] ?? null;
    assert.equal(pickTarget(['#a', '#b'], find, (e) => e.shown), page['#b']);
    assert.equal(pickTarget(['#a', '#x'], find, (e) => e.shown), null);
    assert.equal(pickTarget([], find, () => true), null);
  });

  test('property: the bubble always fits on the screen, even on a 320 px phone (100 runs)', () => {
    fc.assert(fc.property(
      fc.integer({ min: 320, max: 1400 }), fc.integer({ min: 480, max: 1000 }),
      fc.integer({ min: 0, max: 1200 }), fc.integer({ min: 0, max: 900 }), fc.integer({ min: 20, max: 300 }), fc.integer({ min: 20, max: 120 }),
      fc.boolean(),
      (w, h, x, y, bw, bh, none) => {
        const view = { width: w, height: h };
        const bubble = { width: Math.min(352, w - 24), height: 220 };
        const rect = none ? null : { left: Math.min(x, w - 10), top: Math.min(y, h - 10), width: bw, height: bh, bottom: Math.min(y, h - 10) + bh };
        const spot = placeBubble(rect, view, bubble);
        return spot.left >= 12 && spot.left + bubble.width <= w - 12 + 0.001 && spot.top >= 12;
      }
    ), { numRuns: 100 });
  });

  test('below the button when there is room, above it near the bottom, centred with no button', () => {
    const view = { width: 400, height: 800 };
    const bubble = { width: 300, height: 200 };
    assert.equal(placeBubble({ left: 50, top: 100, width: 100, height: 50, bottom: 150 }, view, bubble).side, 'below');
    assert.equal(placeBubble({ left: 50, top: 700, width: 100, height: 50, bottom: 750 }, view, bubble).side, 'above');
    assert.equal(placeBubble(null, view, bubble).side, 'center');
  });

  test('wired into every app through the shared header, with Skip / Next / Done and reduced motion', () => {
    assert.match(read('skeleton/nav-menu.js'), /setupGuide\(current\)/);
    const guide = read('skeleton/guide.js');
    for (const key of ['guide.skip', 'guide.next', 'guide.done', 'guide.button']) assert.ok(guide.includes(`'${key}'`), key);
    assert.match(guide, /voice\.speak\(t\(step\.key\)\)/, 'each step is read aloud');
    assert.match(guide, /!hasSeen\(storage\(\), appId\)/, 'opens by itself only the first time');
    assert.ok(!/innerHTML/.test(guide));
    const theme = read('skeleton/theme.css');
    assert.match(theme, /@keyframes pvk-guide-tap/);
    assert.match(theme, /prefers-reduced-motion: reduce\) \{\s*\.pvk-guide-ring,\s*\.pvk-guide-finger\.is-tapping \{\s*animation: none;/);
  });
});

// ---------- Deploy ----------

describe('deploy ready', () => {
  test('/healthz answers without calling Gemini', async () => {
    const res = await request(app).get('/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
  });

  test('the server listens on process.env.PORT; package.json names a Node version', () => {
    assert.match(read('server/index.js'), /process\.env\.PORT/);
    const pkg = JSON.parse(read('package.json'));
    assert.match(pkg.engines.node, /^>=\s*20/);
    assert.equal(pkg.scripts.start, 'node server/index.js');
    assert.equal(pkg.license, 'MIT');
  });

  test('render.yaml: free web service, npm install / npm start, secrets only in the dashboard', () => {
    const yaml = read('render.yaml');
    for (const line of ['type: web', 'runtime: node', 'plan: free', 'buildCommand: npm install', 'startCommand: npm start', 'healthCheckPath: /healthz']) assert.ok(yaml.includes(line), line);
    for (const key of ['GEMINI_API_KEY', 'GEMINI_MODELS']) assert.match(yaml, new RegExp(`- key: ${key}\\s+sync: false`), key);
    assert.ok(!/value:/.test(yaml), 'no secret values in the file');
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(yaml));
  });

  test('.gitignore keeps secrets, dependencies and temp files out', () => {
    const ignore = read('.gitignore').split(/\r?\n/);
    for (const line of ['node_modules/', '.env', '_*.txt', '_*.mjs', '_*.ps1', '_*.html']) assert.ok(ignore.includes(line), line);
    assert.ok(ignore.includes('!.env.example'));
    assert.ok(!ignore.some((l) => /^\.kiro/.test(l)), '.kiro stays committed');
  });

  test('no API key is written in any committed text file', () => {
    const files = ['README.md', 'render.yaml', 'package.json', 'index.html', 'skeleton/api-client.js', 'skeleton/home-utils.js'];
    for (const file of files) assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(read(file)), file);
  });
});

describe('license, README and a clean repository', () => {
  test('MIT license by Sankar D', () => {
    const license = read('LICENSE');
    assert.match(license, /^MIT License/);
    assert.match(license, /Copyright \(c\) 2026 Sankar D/);
    assert.ok(!/TODO/.test(license));
  });

  test('the README covers the 12 apps, Kiro, running, deploying and privacy', () => {
    const readme = read('README.md');
    for (const id of APPS) assert.ok(readme.includes(`apps/${id}`), id);
    for (const part of ['## How Kiro was used', '.kiro/specs', '.kiro/steering', '.kiro/hooks', '## Run it locally', '## Deploy', 'render.yaml', '## Privacy', 'Sankar D']) assert.ok(readme.includes(part), part);
  });

  test('no temp files (_*.txt, _*.mjs, _*.ps1, _*.html) in the root or the app folders', () => {
    const temp = /^_.*\.(txt|mjs|ps1|html)$/;
    const folders = ['', 'skeleton/', ...APPS.map((a) => `apps/${a}/`)];
    for (const folder of folders) {
      const left = readdirSync(new URL(folder || './', ROOT)).filter((f) => temp.test(f));
      assert.deepEqual(left, [], folder || 'root');
    }
    assert.ok(existsSync(new URL('.kiro/steering/tech.md', ROOT)));
  });
});
