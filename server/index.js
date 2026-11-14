// Phantom Voice Kit - Express server.
// Serves the home screen, the shared skeleton, the apps, and the Gemini API proxy routes.

import 'dotenv/config'; // loads .env into process.env (GEMINI_API_KEY stays on the server)
import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { callGemini } from './gemini.js';
import { createTranslateRouter } from './routes/translate.js';
import { createExtractFieldsRouter } from './routes/extract-fields.js';
import { createLessonRouter } from './routes/lesson.js';
import { createEvaluateRouter } from './routes/evaluate.js';
import { createTranslateLayoutRouter } from './routes/translate-layout.js';
import { parseLayoutReply } from './routes/layout-parser.js';
import { createCache, withCache } from './cache.js';

// ROOT = repository root (one folder above /server).
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

const app = express();

// Allow large JSON bodies (uploaded forms are sent as base64).
app.use(express.json({ limit: '15mb' }));

// Home screen. We use sendFile for this one file instead of serving the whole repo,
// so server/, .env and other private files are never exposed.
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

// Health check for the host (Render): answers at once, never calls Gemini, shows no settings.
app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true });
});

// Installable app (PWA). The service worker must be served from the root to cover the whole site;
// both files live in skeleton/pwa and are sent one by one (no static folder at the root).
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache'); // the browser checks for a new version every time
  res.type('application/javascript');
  res.sendFile(path.join(ROOT, 'skeleton', 'pwa', 'sw.js'));
});
app.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(ROOT, 'skeleton', 'pwa', 'manifest.webmanifest'));
});

// Static files: ONLY the shared skeleton and the apps.
app.use('/skeleton', express.static(path.join(ROOT, 'skeleton')));
app.use('/apps', express.static(path.join(ROOT, 'apps')));

// One small cache (200 answers, 24 hours) shared by translate, extract-fields and translate-layout,
// so the same text or the same form image is never sent to Gemini twice.
// Lessons and quiz answers are not cached: they should be different each time.
const cache = createCache();
const hasText = (value) => typeof value === 'string' && value.trim() !== '';
const cachedTranslate = withCache(callGemini, 'translate', { cache, isUsable: (answer) => hasText(answer?.translation) });
const cachedExtract = withCache(callGemini, 'extract-fields', {
  cache,
  isUsable: (answer) => Array.isArray(answer?.fields) && answer.fields.length > 0,
});
const cachedLayout = withCache(callGemini, 'translate-layout', {
  cache,
  isUsable: (answer) => (parseLayoutReply(answer)?.blocks.length ?? 0) > 0,
});

// API routes. Each factory receives callGemini (or its cached version).
app.use('/api/translate', createTranslateRouter(cachedTranslate));
app.use('/api/extract-fields', createExtractFieldsRouter(cachedExtract));
app.use('/api/lesson', createLessonRouter(callGemini));
app.use('/api/evaluate', createEvaluateRouter(callGemini));
app.use('/api/translate-layout', createTranslateLayoutRouter(cachedLayout));

// Generic error handler: never leak stack traces to the browser.
// (Express recognises error handlers by their four parameters.)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Log only a short code. Body-parser messages can quote the request body.
  console.error('Server error:', err?.type || err?.code || 'unknown');
  res.status(500).json({ error: 'internal_error' });
});

export { app };

// Start listening only when this file is run directly (npm start),
// so tests can import `app` without opening a port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT ?? 3000;
  app.listen(port, () => {
    console.log(`Phantom Voice Kit running at http://localhost:${port}`);
  });
}
