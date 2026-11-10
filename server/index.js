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

// ROOT = repository root (one folder above /server).
const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

const app = express();

// Allow large JSON bodies (uploaded forms are sent as base64).
app.use(express.json({ limit: '15mb' }));

// Home screen. We use sendFile for this one file instead of serving the whole repo,
// so server/, .env and other private files are never exposed.
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));

// Static files: ONLY the shared skeleton and the apps.
app.use('/skeleton', express.static(path.join(ROOT, 'skeleton')));
app.use('/apps', express.static(path.join(ROOT, 'apps')));

// API routes. Each factory receives the real callGemini function.
app.use('/api/translate', createTranslateRouter(callGemini));
app.use('/api/extract-fields', createExtractFieldsRouter(callGemini));
app.use('/api/lesson', createLessonRouter(callGemini));
app.use('/api/evaluate', createEvaluateRouter(callGemini));

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
