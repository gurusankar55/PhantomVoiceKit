// translator-utils.js
// Small pure helper functions for Phantom Lens · Form Translator.
// No browser or DOM access here, so they are easy to test.

// A PDF is translated page by page; only the first pages are used.
export const MAX_PAGES = 5;

/**
 * How many pages of a document are used.
 * @param {number} totalPages  pages in the document
 * @param {number} max         page limit (default 5)
 * @returns {{count:number, skipped:number}}  count pages are used, skipped are ignored
 */
export function limitPages(totalPages, max = MAX_PAGES) {
  const total = Math.max(0, Math.floor(Number(totalPages) || 0));
  const count = Math.min(total, max);
  return { count, skipped: total - count };
}

/**
 * Size to render a page image at: never bigger than maxSide on the long side,
 * and never enlarged. Big photos are made smaller so the upload stays fast.
 * @returns {{width:number, height:number, scale:number}}  scale is new size / old size
 */
export function fitImageSize(width, height, maxSide = 2000) {
  const longSide = Math.max(width, height);
  const scale = longSide > maxSide ? maxSide / longSide : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/**
 * Page size for the PDF: the same shape as the image, with the long side set to
 * about an A4 page (842 points).
 * @returns {{width:number, height:number, orientation:'p'|'l'}}
 */
export function pdfPageSize(imageWidth, imageHeight, longSide = 842) {
  const scale = longSide / Math.max(imageWidth, imageHeight);
  const round2 = (n) => Math.round(n * 100) / 100;
  return {
    width: round2(imageWidth * scale),
    height: round2(imageHeight * scale),
    orientation: imageWidth > imageHeight ? 'l' : 'p',
  };
}

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
