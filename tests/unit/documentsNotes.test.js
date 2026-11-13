// documentsNotes.test.js
// "My documents" (PDFs kept on the device), "Voice notes" (notes in localStorage) and the bigger
// gift box. Pure modules only: no browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';

import {
  APP_NAME_KEYS,
  MAX_NAME_LENGTH,
  safePdfName,
  makeDocumentRecord,
  sortNewestFirst,
  totalBytes,
  formatBytes,
} from '../../skeleton/documents-utils.js';
import {
  NOTES_KEY,
  MAX_NOTE_LENGTH,
  MAX_NOTES,
  cleanNoteText,
  loadNotes,
  saveNotes,
  addNote,
  updateNote,
  deleteNote,
  sortNotes,
  searchNotes,
} from '../../apps/voice-notes/notes-utils.js';
import { giftScale, GIFT_SCALE, GIFT_AUTO_CLOSE_MS, fallingPieces, FALLING_SHAPES } from '../../skeleton/celebrate-utils.js';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
}
const broken = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('full');
  },
};

// ---------------------------------------------------------------------------
// My documents
// ---------------------------------------------------------------------------

describe('My documents: the saved record', () => {
  test('a record has the name, the app, the size and the date (the id comes from IndexedDB)', () => {
    const blob = { size: 2048.4, type: 'application/pdf' };
    const record = makeDocumentRecord({ name: 'Bank form_2026-11-12.pdf', app: 'spirit-clerk', blob, now: 1000 });
    assert.deepEqual(record, { name: 'Bank form_2026-11-12.pdf', app: 'spirit-clerk', type: 'application/pdf', size: 2048, createdAt: 1000, blob });
    assert.equal(makeDocumentRecord({ name: 'x', app: 'unknown', blob, now: 1 }).app, 'other');
    assert.throws(() => makeDocumentRecord({ name: 'x', app: 'spirit-clerk', blob: null }));
  });

  test('every app that makes PDFs has a name key that exists in the locales', () => {
    const en = JSON.parse(read('skeleton/locales/en.json'));
    assert.deepEqual(Object.keys(APP_NAME_KEYS).sort(), ['form-translator', 'spirit-clerk']);
    for (const key of Object.values(APP_NAME_KEYS)) assert.ok(en[key], key);
  });

  test('safePdfName: always a safe name that ends in .pdf (letters of any language kept)', () => {
    assert.equal(safePdfName('Bank form.pdf'), 'Bank form.pdf');
    assert.equal(safePdfName('Bank form'), 'Bank form.pdf');
    assert.equal(safePdfName('../../etc/passwd'), 'etc passwd.pdf');
    assert.equal(safePdfName('வங்கி படிவம்.PDF'), 'வங்கி படிவம்.pdf');
    assert.equal(safePdfName(''), 'document.pdf');
    assert.equal(safePdfName(null), 'document.pdf');
    assert.equal(safePdfName('a<b>c:d"e|f?g*h'), 'a b c d e f g h.pdf');
  });

  test('property: any name gives a short safe name ending in .pdf', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (name) => {
        const safe = safePdfName(name);
        const base = safe.slice(0, -4);
        return safe.endsWith('.pdf') && base !== '' && Array.from(base).length <= MAX_NAME_LENGTH && !/[/\\<>:"|?*\u0000-\u001f]/.test(base) && !base.startsWith('.');
      }),
      { numRuns: 200 }
    );
  });

  test('newest first, and the total size', () => {
    const list = [
      { id: 1, createdAt: 100, size: 1000 },
      { id: 2, createdAt: 300, size: 2500 },
      { id: 3, createdAt: 200, size: -5 },
      { id: 4, createdAt: 300, size: 500 },
    ];
    assert.deepEqual(sortNewestFirst(list).map((d) => d.id), [4, 2, 3, 1]);
    assert.equal(totalBytes(list), 4000);
    assert.equal(totalBytes(null), 0);
    assert.deepEqual(list.map((d) => d.id), [1, 2, 3, 4], 'the list itself is not changed');
  });

  test('formatBytes: bytes, kB and MB, written for the language', () => {
    assert.match(formatBytes(850, 'en-US'), /^850\s?(B|byte)/);
    assert.match(formatBytes(12 * 1024, 'en-US'), /^12\s?kB/);
    assert.match(formatBytes(3.4 * 1024 * 1024, 'en-US'), /^3\.4\s?MB/);
    assert.ok(formatBytes(3.4 * 1024 * 1024, 'de-DE').includes('3,4'));
    assert.match(formatBytes(-3), /^0/);
    assert.ok(formatBytes(1024, 'xx-not-a-locale').length > 0);
  });

  test('every PDF the apps make is also kept in My documents', () => {
    const clerk = read('apps/spirit-clerk/app.js');
    const translator = read('apps/form-translator/app.js');
    assert.equal((clerk.match(/doc\.save\(/g) || []).length, 2);
    assert.equal((clerk.match(/keepPdf\(doc, name, 'spirit-clerk'\)/g) || []).length, 2);
    assert.equal((translator.match(/doc\.save\(/g) || []).length, 1);
    assert.equal((translator.match(/keepPdf\(doc, name, 'form-translator'\)/g) || []).length, 1);
  });

  test('no window.confirm, no network calls and no server storage on the new pages', () => {
    for (const path of ['apps/my-documents/app.js', 'apps/voice-notes/app.js', 'skeleton/documents-store.js', 'skeleton/inline-confirm.js']) {
      // Only the code counts, not the comments ("never window.confirm").
      const source = read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
      assert.doesNotMatch(source, /window\.confirm|\bconfirm\(/, path);
      assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|api-client/, path);
    }
  });
});

// ---------------------------------------------------------------------------
// Voice notes
// ---------------------------------------------------------------------------

describe('Voice notes', () => {
  test('add, newest first, saved with the date, and read back', () => {
    const storage = memoryStorage();
    let { notes, note } = addNote([], '  Buy milk  ', { now: 1000, lang: 'en-US', random: () => 0.1 });
    assert.equal(note.text, 'Buy milk');
    assert.equal(note.createdAt, 1000);
    ({ notes } = addNote(notes, 'பால் வாங்கு', { now: 2000, lang: 'ta-IN', random: () => 0.2 }));
    assert.deepEqual(notes.map((n) => n.text), ['பால் வாங்கு', 'Buy milk']);
    assert.equal(saveNotes(storage, notes), true);
    assert.ok(storage.data.has(NOTES_KEY));
    assert.deepEqual(loadNotes(storage), notes);
  });

  test('an empty note is not added', () => {
    const { notes, note } = addNote([], '   \n  ');
    assert.equal(note, null);
    assert.deepEqual(notes, []);
  });

  test('edit changes the text and the edited date; delete removes the note', () => {
    let { notes, note } = addNote([], 'first', { now: 1000 });
    notes = updateNote(notes, note.id, 'first, changed', 5000);
    assert.equal(notes[0].text, 'first, changed');
    assert.equal(notes[0].updatedAt, 5000);
    assert.equal(notes[0].createdAt, 1000);
    assert.deepEqual(updateNote(notes, note.id, '   ', 6000), notes, 'an empty text changes nothing');
    assert.deepEqual(deleteNote(notes, note.id), []);
    assert.deepEqual(deleteNote(notes, 'nope'), notes);
  });

  test('ids are never the same', () => {
    let notes = [];
    for (let i = 0; i < 50; i++) notes = addNote(notes, `note ${i}`, { now: 1000, random: () => 0.5 }).notes;
    assert.equal(new Set(notes.map((n) => n.id)).size, 50);
  });

  test('damaged, blocked or full storage never throws', () => {
    const storage = memoryStorage();
    storage.setItem(NOTES_KEY, '{oops');
    assert.deepEqual(loadNotes(storage), []);
    storage.setItem(NOTES_KEY, JSON.stringify([{ id: 'a', text: 'ok', createdAt: 5 }, { id: 'b', text: '', createdAt: 6 }, 'x', { id: 'a', text: 'twice', createdAt: 7 }, { text: 'no id', createdAt: 8 }]));
    assert.deepEqual(loadNotes(storage).map((n) => n.text), ['ok']);
    assert.deepEqual(loadNotes(broken), []);
    assert.equal(saveNotes(broken, []), false);
  });

  test('a note is cleaned: no control characters, new lines kept, not too long', () => {
    assert.equal(cleanNoteText('a\u0000b\r\nc\u0007'), 'ab\nc');
    assert.equal(Array.from(cleanNoteText('x'.repeat(MAX_NOTE_LENGTH + 50))).length, MAX_NOTE_LENGTH);
  });

  test('at most MAX_NOTES notes are kept (the newest)', () => {
    let notes = [];
    for (let i = 0; i < MAX_NOTES + 5; i++) notes = addNote(notes, `n${i}`, { now: 1000 + i }).notes;
    assert.equal(notes.length, MAX_NOTES);
    assert.equal(notes[0].text, `n${MAX_NOTES + 4}`);
  });

  test('search: every word, any order, case and accents ignored, any script', () => {
    const notes = [
      { id: '1', text: 'Buy MILK and bread', createdAt: 1, updatedAt: 1, lang: 'en-US' },
      { id: '2', text: 'Doctor on Monday', createdAt: 2, updatedAt: 2, lang: 'en-US' },
      { id: '3', text: 'Café with Ana', createdAt: 3, updatedAt: 3, lang: 'es-ES' },
      { id: '4', text: 'பால் வாங்கு, மருத்துவர்', createdAt: 4, updatedAt: 4, lang: 'ta-IN' },
    ];
    assert.deepEqual(searchNotes(notes, 'milk').map((n) => n.id), ['1']);
    assert.deepEqual(searchNotes(notes, 'bread buy').map((n) => n.id), ['1']);
    assert.deepEqual(searchNotes(notes, 'cafe').map((n) => n.id), ['3']);
    assert.deepEqual(searchNotes(notes, 'பால்').map((n) => n.id), ['4']);
    assert.deepEqual(searchNotes(notes, 'milk doctor'), []);
    assert.deepEqual(searchNotes(notes, '   ').map((n) => n.id), ['4', '3', '2', '1']);
  });

  test('property: the search result is part of the notes, newest first, and a note always finds itself', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 1, maxLength: 15 }), (texts) => {
        let notes = [];
        texts.forEach((text, i) => (notes = addNote(notes, text, { now: 1000 + i }).notes));
        if (notes.length === 0) return true;
        const target = notes[notes.length - 1];
        const found = searchNotes(notes, target.text);
        const sorted = sortNotes(found);
        return found.some((n) => n.id === target.id) && found.every((n) => notes.includes(n)) && found.every((n, i) => n === sorted[i]);
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// The bigger gift box and the flowers
// ---------------------------------------------------------------------------

describe('gift box and flowers', () => {
  test('about 3x bigger on a big screen, smaller on a phone so it fits, never below 1', () => {
    assert.equal(GIFT_SCALE, 3);
    assert.equal(giftScale(1920, 1080), 3);
    const phone = giftScale(360, 640);
    assert.ok(phone > 1 && phone < 3, `phone scale ${phone}`);
    assert.ok(170 * phone <= 360 - 32 + 1e-9 && 230 * phone <= 640 - 190 + 1e-9);
    assert.equal(giftScale(200, 300), 1);
    assert.equal(giftScale(undefined, null), 1);
  });

  test('the gift closes by itself after 8 seconds', () => {
    assert.equal(GIFT_AUTO_CLOSE_MS, 8000);
  });

  test('levelUp drops flowers and daisies too', () => {
    assert.deepEqual([...FALLING_SHAPES].sort(), ['daisy', 'flower', 'paper', 'petal']);
    let i = 0;
    const steps = [0.1, 0.3, 0.6, 0.9];
    const pieces = fallingPieces({ width: 400, height: 800, count: 200, random: () => steps[i++ % steps.length] });
    const shapes = new Set(pieces.map((p) => p.shape));
    assert.ok(shapes.has('flower') || shapes.has('daisy'), [...shapes].join(','));
    const random = fallingPieces({ width: 400, height: 800, count: 400 });
    for (const shape of FALLING_SHAPES) assert.ok(random.some((p) => p.shape === shape), shape);
  });

  test('the gift is a dialog with a Collect button and an auto close', () => {
    const source = read('skeleton/celebrate.js');
    assert.match(source, /'role', 'dialog'/);
    assert.match(source, /celebrate\.collect/);
    assert.match(source, /setTimeout\(close, GIFT_AUTO_CLOSE_MS\)/);
  });
});
