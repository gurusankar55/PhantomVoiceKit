// documents-utils.js
// Pure helpers for "My documents": the PDFs the apps make are also kept on the device
// (IndexedDB, see documents-store.js). No DOM and no storage here, so they are easy to test.

// The apps that make PDFs, and the translation key of each app's name.
export const APP_NAME_KEYS = Object.freeze({
  'spirit-clerk': 'nav.spiritClerk',
  'form-translator': 'nav.formTranslator',
});

// The longest file name that is kept (without ".pdf").
export const MAX_NAME_LENGTH = 120;

/**
 * A safe file name that ends in ".pdf": no folder signs or control characters, not empty, not
 * too long. Letters of any language are kept.
 */
export function safePdfName(name) {
  let base = String(name ?? '')
    .normalize('NFC')
    .replace(/\.pdf$/i, '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ') // signs that are not allowed in file names
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '') // no hidden file names, no ".." at the start
    .trim();
  if (base === '') base = 'document';
  if (Array.from(base).length > MAX_NAME_LENGTH) base = Array.from(base).slice(0, MAX_NAME_LENGTH).join('').trim();
  return `${base}.pdf`;
}

/**
 * The record that is saved for one PDF (the id is given by IndexedDB).
 * @param {{name:string, app:string, blob:{size:number,type?:string}, now?:number}} options
 * @returns {{name:string, app:string, type:string, size:number, createdAt:number, blob:object}}
 */
export function makeDocumentRecord({ name, app, blob, now = Date.now() }) {
  if (!blob || typeof blob.size !== 'number') throw new Error('A document needs its file');
  return {
    name: safePdfName(name),
    app: Object.prototype.hasOwnProperty.call(APP_NAME_KEYS, app) ? app : 'other',
    type: 'application/pdf',
    size: Math.max(0, Math.floor(blob.size)),
    createdAt: Number.isFinite(now) ? now : Date.now(),
    blob,
  };
}

/** A copy of the list, newest first (the bigger id first when two have the same time). */
export function sortNewestFirst(documents) {
  return [...(Array.isArray(documents) ? documents : [])].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || (b.id ?? 0) - (a.id ?? 0)
  );
}

/** The size of all documents together, in bytes. */
export function totalBytes(documents) {
  return (Array.isArray(documents) ? documents : []).reduce((sum, doc) => sum + (Number(doc?.size) > 0 ? Number(doc.size) : 0), 0);
}

/**
 * A size for people: "850 B", "12 kB", "3.4 MB", written the way the language writes numbers
 * and units (Intl), with a plain fallback.
 * @param {number} bytes
 * @param {string} [locale]  BCP-47 code
 */
export function formatBytes(bytes, locale = 'en-US') {
  const n = Math.max(0, Number(bytes) || 0);
  let value = n;
  let unit = 'byte';
  if (n >= 1024 * 1024) {
    value = n / (1024 * 1024);
    unit = 'megabyte';
  } else if (n >= 1024) {
    value = n / 1024;
    unit = 'kilobyte';
  }
  const digits = unit === 'byte' || value >= 10 ? 0 : 1;
  try {
    return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: digits }).format(value);
  } catch {
    const short = { byte: 'B', kilobyte: 'kB', megabyte: 'MB' }[unit];
    return `${value.toFixed(digits)} ${short}`;
  }
}
