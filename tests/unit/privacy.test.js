// tests/unit/privacy.test.js
// Privacy checks: the server never stores user data (R20).
// (a) no file-write / database / upload packages in server/
// (b) no console call logs req.body
// (c) a real request through the router leaves no files behind

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { createExtractFieldsRouter } from '../../server/routes/extract-fields.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverDir = path.join(repoRoot, 'server');

// Recursively list every file under a folder (skipping node_modules and .git).
function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const serverFiles = listFiles(serverDir).filter((f) => f.endsWith('.js'));

test('server/ has files to check', () => {
  assert.ok(serverFiles.length > 0);
});

test('(a) server/ uses no fs write APIs or db/upload packages', () => {
  const writeApis = /\b(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync)\b/;
  const badPackages = /(?:from\s+|require\()\s*['"](multer|sqlite3?|better-sqlite3|mongoose|mongodb|pg)['"]/;
  for (const file of serverFiles) {
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(!writeApis.test(src), `${file} uses an fs write API`);
    assert.ok(!badPackages.test(src), `${file} imports a db/upload package`);
  }
});

test('(b) no console call in server/ logs req.body', () => {
  // Match a console.log/error call whose arguments mention req.body or body.
  const consoleCall = /console\.(log|error)\s*\(([^;]*)\)/g;
  for (const file of serverFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const match of src.matchAll(consoleCall)) {
      assert.ok(!/\bbody\b/.test(match[2]), `${file} logs a body: ${match[0]}`);
    }
  }
});

test('(c) POST /api/extract-fields leaves no new files in repo or temp dir', async () => {
  // Fake Gemini: never calls the real API.
  const fakeCallGemini = async () => ({
    fields: [{ label: 'Name', inputType: 'text', question: 'Your name?', help: 'Full name' }],
  });
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/extract-fields', createExtractFieldsRouter(fakeCallGemini));

  const repoBefore = listFiles(repoRoot).sort();
  const tmpBefore = fs.readdirSync(os.tmpdir()).sort();

  const res = await request(app)
    .post('/api/extract-fields')
    .send({ fileBase64: Buffer.from('fake pdf bytes').toString('base64'), mimeType: 'application/pdf', lang: 'en' });
  assert.equal(res.status, 200);

  const repoAfter = listFiles(repoRoot).sort();
  const tmpAfter = fs.readdirSync(os.tmpdir()).sort();

  // Only look for files that were added by the request.
  const newRepo = repoAfter.filter((f) => !repoBefore.includes(f));
  assert.deepEqual(newRepo, []);
  // The OS temp dir may be touched by other processes; only flag new entries.
  const newTmp = tmpAfter.filter((f) => !tmpBefore.includes(f));
  assert.deepEqual(newTmp, []);
});
