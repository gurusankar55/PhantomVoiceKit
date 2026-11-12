// text-pages-utils.js
// Pure page layout for a PDF made of pictures of text. jsPDF's own font cannot draw Tamil, Arabic,
// Chinese and the other scripts, so a text PDF is drawn on a canvas (text-pages.js) and added as an
// image, like the Form Translator PDF. This file only works out WHERE each line goes, so it can be
// tested without a browser.

import { wrapText } from './form-overlay-utils.js';

// An A4 page at about 150 dpi.
export const PAGE_WIDTH = 1240;
export const PAGE_HEIGHT = 1754;

// First letter that has a direction decides it: Hebrew, Arabic, Urdu, Syriac, Thaana.
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
const ANY_LETTER = /\p{L}/u;

/**
 * Does a text read from right to left (Arabic, Urdu...)? The first letter decides.
 */
export function isRtlText(text) {
  for (const character of String(text ?? '')) {
    if (RTL_CHAR.test(character)) return true;
    if (ANY_LETTER.test(character)) return false;
  }
  return false;
}

/**
 * Work out the lines of a list of entries on pages.
 * Each entry is "Label: text" (wrapped between words, a word is never cut) and may have a picture
 * (a signature) under it. A page that is full starts a new page; a long entry may go over two pages.
 * @param {{label:string, text:string, image?:{w:number, h:number}}[]} entries
 * @param {object} options
 *   title        text at the top of the FIRST page (optional)
 *   measure      (text, size, bold) => width in pixels
 *   width, height  page size (default A4 at 150 dpi)
 *   margin       free space around the text (default 90)
 *   bodySize, titleSize  font sizes (default 30 and 44)
 *   imageHeight  tallest picture (default 140)
 * @returns {{items: ({type:'text', text:string, x:number, y:number, size:number, bold:boolean, rtl:boolean}
 *   | {type:'image', entry:number, x:number, y:number, w:number, h:number})[]}[]}
 *   at least one page; y is the TOP of the line
 */
export function layoutEntries(entries, { title = '', measure, width = PAGE_WIDTH, height = PAGE_HEIGHT, margin = 90, bodySize = 30, titleSize = 44, imageHeight = 140 } = {}) {
  const lineHeight = Math.round(bodySize * 1.4);
  const gap = Math.round(bodySize * 0.6);
  const textWidth = width - margin * 2;
  const pages = [{ items: [] }];
  let page = pages[0];
  let y = margin;

  const newPage = () => {
    page = { items: [] };
    pages.push(page);
    y = margin;
  };
  const room = (needed) => y + needed <= height - margin;

  if (title !== '') {
    for (const line of wrapText(title, textWidth, (s) => measure(s, titleSize, true), '')) {
      page.items.push({ type: 'text', text: line, x: margin, y, size: titleSize, bold: true, rtl: false });
      y += Math.round(titleSize * 1.3);
    }
    y += gap * 2;
  }

  entries.forEach((entry, index) => {
    const full = `${entry.label}: ${entry.text}`;
    const lines = wrapText(full, textWidth, (s) => measure(s, bodySize, false), '');
    for (const line of lines) {
      if (!room(lineHeight)) newPage();
      const rtl = isRtlText(line);
      page.items.push({ type: 'text', text: line, x: rtl ? width - margin : margin, y, size: bodySize, bold: false, rtl });
      y += lineHeight;
    }
    if (entry.image && entry.image.w > 0 && entry.image.h > 0) {
      const scale = Math.min(imageHeight / entry.image.h, (textWidth * 0.5) / entry.image.w, 1.5);
      const w = Math.round(entry.image.w * scale);
      const h = Math.round(entry.image.h * scale);
      if (!room(h)) newPage();
      page.items.push({ type: 'image', entry: index, x: margin, y, w, h });
      y += h;
    }
    y += gap;
  });
  return pages;
}
