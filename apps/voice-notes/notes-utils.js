// notes-utils.js
// Pure rules of "Voice notes": the notes saved on this device (localStorage), adding, editing,
// deleting, newest first, and the search. Storage is passed in (localStorage in the browser, a
// fake in tests); every access is in try/catch. No DOM, no network.

export const NOTES_KEY = 'phantomVoiceKit.voiceNotes';
// The longest note that is kept (characters) and the most notes.
export const MAX_NOTE_LENGTH = 5000;
export const MAX_NOTES = 500;

// A clean note text: one Unicode form, no control characters (new lines are kept), trimmed, not too long.
export function cleanNoteText(text) {
  const clean = String(text ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .trim();
  return Array.from(clean).slice(0, MAX_NOTE_LENGTH).join('');
}

// Is this a usable note? { id, text, createdAt, updatedAt, lang }
function cleanNote(value) {
  if (!value || typeof value !== 'object') return null;
  const text = cleanNoteText(value.text);
  if (text === '' || typeof value.id !== 'string' || value.id === '') return null;
  const createdAt = Number(value.createdAt);
  if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
  const updatedAt = Number(value.updatedAt);
  return {
    id: value.id.slice(0, 64),
    text,
    createdAt,
    updatedAt: Number.isFinite(updatedAt) && updatedAt >= createdAt ? updatedAt : createdAt,
    lang: typeof value.lang === 'string' ? value.lang.slice(0, 20) : '',
  };
}

/** The notes, newest first (a copy). */
export function sortNotes(notes) {
  return [...notes].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
}

/** Read the notes (missing, damaged or blocked storage gives none; damaged notes are left out). */
export function loadNotes(storage) {
  try {
    const text = storage?.getItem(NOTES_KEY);
    if (!text) return [];
    const data = JSON.parse(text);
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    const notes = [];
    for (const item of data) {
      const note = cleanNote(item);
      if (note && !seen.has(note.id)) {
        seen.add(note.id);
        notes.push(note);
      }
    }
    return sortNotes(notes).slice(0, MAX_NOTES);
  } catch {
    return [];
  }
}

/** Save the notes. Returns false when the storage could not be written (full or blocked). */
export function saveNotes(storage, notes) {
  try {
    storage?.setItem(NOTES_KEY, JSON.stringify(sortNotes(notes).slice(0, MAX_NOTES)));
    return true;
  } catch {
    return false;
  }
}

/** A new id that is not in the list yet. */
export function newNoteId(notes, now = Date.now(), random = Math.random) {
  const used = new Set(notes.map((note) => note.id));
  for (;;) {
    const id = `n${now.toString(36)}${Math.floor(random() * 1e9).toString(36)}`;
    if (!used.has(id)) return id;
    now += 1;
  }
}

/**
 * Add a note. An empty text changes nothing.
 * @returns {{notes: object[], note: object|null}}  the new list (newest first) and the new note
 */
export function addNote(notes, text, { now = Date.now(), lang = '', random = Math.random } = {}) {
  const clean = cleanNoteText(text);
  if (clean === '') return { notes: sortNotes(notes), note: null };
  const note = { id: newNoteId(notes, now, random), text: clean, createdAt: now, updatedAt: now, lang: String(lang ?? '').slice(0, 20) };
  return { notes: sortNotes([note, ...notes]).slice(0, MAX_NOTES), note };
}

/** Change the text of one note (an empty text or an unknown id changes nothing). */
export function updateNote(notes, id, text, now = Date.now()) {
  const clean = cleanNoteText(text);
  if (clean === '') return sortNotes(notes);
  return sortNotes(notes.map((note) => (note.id === id ? { ...note, text: clean, updatedAt: Math.max(now, note.createdAt) } : note)));
}

/** Remove one note. */
export function deleteNote(notes, id) {
  return sortNotes(notes.filter((note) => note.id !== id));
}

// Text ready for searching: lower case, and letters with accents count as the plain letter
// ("café" is found with "cafe"). Marks of Indian scripts (vowel signs) are kept: they change the word.
function searchable(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents on Latin, Greek and Cyrillic letters only
    .normalize('NFC')
    .toLocaleLowerCase();
}

/**
 * The notes that contain every word of the search (in any order). An empty search gives all notes.
 */
export function searchNotes(notes, query) {
  const words = searchable(query).split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return sortNotes(notes);
  return sortNotes(notes.filter((note) => {
    const text = searchable(note.text);
    return words.every((word) => text.includes(word));
  }));
}
