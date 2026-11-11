// Unit tests for the locale files in skeleton/locales.
// Reads every JSON file from disk (no network) and checks consistency with en.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skeleton', 'locales');

const EXPECTED = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es',
  'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr'];

// Load every .json file into { code: parsedObject }
const files = fs.readdirSync(localesDir).filter((f) => f.endsWith('.json')).sort();
const locales = {};
for (const f of files) {
  locales[f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(localesDir, f), 'utf8'));
}

// Placeholders such as {n} or {total}
const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort();

test('exactly 20 locale files exist with the expected codes', () => {
  assert.equal(files.length, 20);
  assert.deepEqual(Object.keys(locales).sort(), [...EXPECTED].sort());
});

const enKeys = Object.keys(locales.en || {});

for (const code of EXPECTED) {
  test(`${code}.json has exactly the same keys as en.json`, () => {
    const keys = Object.keys(locales[code] || {});
    const missing = enKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !enKeys.includes(k));
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] },
      `${code}: missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`);
  });

  test(`${code}.json values are all non-empty strings`, () => {
    const bad = Object.entries(locales[code] || {})
      .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
      .map(([k]) => k);
    assert.deepEqual(bad, [], `${code}: empty or non-string values for [${bad.join(', ')}]`);
  });

  test(`${code}.json keeps the placeholders found in English`, () => {
    const bad = [];
    for (const k of enKeys) {
      const value = (locales[code] || {})[k];
      if (typeof value !== 'string') continue; // reported by other tests
      const want = placeholders(locales.en[k]);
      for (const p of want) {
        if (!value.includes(p)) bad.push(`${k} (missing ${p})`);
      }
    }
    assert.deepEqual(bad, [], `${code}: placeholders lost in [${bad.join(', ')}]`);
  });
}
