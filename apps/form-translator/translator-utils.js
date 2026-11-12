// translator-utils.js
// Small pure helper functions for Phantom Lens · Form Translator.
// No browser or DOM access here, so they are easy to test.

// These are shared with Spirit Clerk, so they live in /skeleton (the only place for shared code).
// They are re-exported here so this app and its tests keep using the same names.
export { MAX_PAGES, limitPages, fitImageSize, pdfPageSize } from '../../skeleton/page-images-utils.js';

/**
 * File name of the translated PDF: "{name}_{code}_{YYYY-MM-DD}.pdf".
 * The name comes from the uploaded file (extension removed, unsafe characters
 * replaced); "form" is used when nothing usable is left.
 * @param {string} originalName  e.g. "Bank Form.pdf"
 * @param {string} langCode      e.g. "ta-IN" (only the part before "-" is used)
 * @param {Date} date
 */
export function translatedFilename(originalName, langCode, date) {
  const base = String(originalName ?? '')
    .replace(/\.[^./\\]*$/, '') // remove the extension
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-') // keep letters, their marks (Tamil vowel signs) and digits
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const code = String(langCode ?? '').split('-')[0].toLowerCase() || 'xx';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${base || 'form'}_${code}_${year}-${month}-${day}.pdf`;
}

/**
 * Join short texts into chunks of at most maxLength characters, so "Read aloud"
 * speaks a few long pieces instead of hundreds of tiny ones. Empty texts are
 * dropped. A single text longer than maxLength stays whole (as its own chunk).
 * @param {string[]} texts
 * @param {number} maxLength
 * @returns {string[]}
 */
export function chunkTexts(texts, maxLength = 200) {
  const chunks = [];
  let current = '';

  for (const raw of texts) {
    const text = String(raw ?? '').trim();
    if (text === '') continue;

    if (current === '') {
      current = text;
    } else if (current.length + 1 + text.length <= maxLength) {
      current += `\n${text}`;
    } else {
      chunks.push(current);
      current = text;
    }
  }

  if (current !== '') chunks.push(current);
  return chunks;
}
