// text-pages.js
// Draws a list of "label: answer" entries on canvases (one per page), so a PDF made from them shows
// every script correctly (Tamil, Arabic, Chinese...). The pages are added to the PDF as pictures,
// like the pages of the Form Translator. The layout itself is in text-pages-utils.js.

import { layoutEntries, PAGE_WIDTH, PAGE_HEIGHT } from './text-pages-utils.js';

// Font list: the same as the form overlay, so every script has a font.
const FONT_FAMILY =
  '"Nirmala UI", "Noto Sans", "Segoe UI", "Malgun Gothic", "Microsoft YaHei", "Yu Gothic", Tahoma, system-ui, sans-serif';

/**
 * Draw the entries on page canvases.
 * @param {{label:string, text:string, image?:HTMLImageElement}[]} entries  image = a loaded picture (a signature)
 * @param {{title?:string}} [options]
 * @returns {HTMLCanvasElement[]}  one canvas per page (A4 shape)
 */
export function drawTextPages(entries, { title = '' } = {}) {
  // Measuring needs a canvas context.
  const probe = document.createElement('canvas').getContext('2d');
  const measure = (text, size, bold) => {
    probe.font = `${bold ? '700 ' : ''}${size}px ${FONT_FAMILY}`;
    return probe.measureText(text).width;
  };

  const sizes = entries.map((entry) => ({
    label: entry.label,
    text: entry.text,
    image: entry.image ? { w: entry.image.naturalWidth || entry.image.width, h: entry.image.naturalHeight || entry.image.height } : undefined,
  }));
  const pages = layoutEntries(sizes, { title, measure });

  return pages.map((page) => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_WIDTH;
    canvas.height = PAGE_HEIGHT;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';

    for (const item of page.items) {
      if (item.type === 'text') {
        ctx.font = `${item.bold ? '700 ' : ''}${item.size}px ${FONT_FAMILY}`;
        ctx.direction = item.rtl ? 'rtl' : 'ltr';
        ctx.textAlign = item.rtl ? 'right' : 'left';
        ctx.fillText(item.text, item.x, item.y);
      } else {
        const picture = entries[item.entry].image;
        if (picture) ctx.drawImage(picture, item.x, item.y, item.w, item.h);
      }
    }
    return canvas;
  });
}
