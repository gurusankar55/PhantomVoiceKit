// documents-store.js
// "My documents": every PDF the apps make is also kept on this device in IndexedDB (database
// "phantomVoiceKit", store "documents"). Nothing is uploaded and nothing is stored on a server.
// Every call is in try/catch: when the device cannot keep a document (private mode, full disk,
// no IndexedDB), the app still works and the download still happens.
// Nothing touches the browser when this module is imported.

import { makeDocumentRecord, sortNewestFirst } from './documents-utils.js';

const DB_NAME = 'phantomVoiceKit';
const DB_VERSION = 1;
const STORE = 'documents';

let opening = null;

// Open (and on the first use create) the database.
function openDb() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB could not be opened'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked'));
    } catch (err) {
      reject(err);
    }
  });
  opening.catch(() => {
    opening = null; // try again next time
  });
  return opening;
}

// Run one request in a transaction and resolve with its result.
async function run(mode, makeRequest) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = makeRequest(tx.objectStore(STORE));
    let result;
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

/** Keep one PDF. Resolves with its id. */
export async function saveDocument({ name, app, blob }) {
  const record = makeDocumentRecord({ name, app, blob });
  return run('readwrite', (store) => store.add(record));
}

/** Every kept document, newest first: [{ id, name, app, type, size, createdAt, blob }]. */
export async function listDocuments() {
  const all = await run('readonly', (store) => store.getAll());
  return sortNewestFirst(all ?? []);
}

/** One document, or undefined. */
export async function getDocument(id) {
  return run('readonly', (store) => store.get(id));
}

/** Delete one document. */
export async function deleteDocument(id) {
  await run('readwrite', (store) => store.delete(id));
}

/**
 * Keep a jsPDF document the app has just downloaded. Never throws: when it cannot be kept,
 * it resolves with null and the app goes on.
 * @param {{output:(type:string)=>Blob}} doc  a jsPDF document
 * @param {string} name  the file name it was downloaded with
 * @param {string} app   'spirit-clerk' | 'form-translator'
 * @returns {Promise<number|null>}
 */
export async function keepPdf(doc, name, app) {
  try {
    const blob = doc.output('blob');
    return await saveDocument({ name, app, blob });
  } catch {
    return null;
  }
}
