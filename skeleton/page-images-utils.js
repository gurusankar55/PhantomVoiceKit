// page-images-utils.js
// Pure helper functions for turning a form (photo or PDF) into page images.
// Shared by Phantom Lens · Form Translator and Spirit Clerk. No browser or DOM access here,
// so they are easy to test.

// A PDF is read page by page; only the first pages are used.
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
 * Split a "data:image/jpeg;base64,AAAA" URL into the mime type and the base64 text.
 * @param {string} dataUrl
 * @returns {{mimeType:string, data:string}}  both are '' when the text is not a data URL
 */
export function splitDataUrl(dataUrl) {
  const match = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s.exec(String(dataUrl ?? ''));
  return match ? { mimeType: match[1], data: match[2] } : { mimeType: '', data: '' };
}
