// form-overlay.js
// Draws a translated version of a form page on a canvas, like Google Lens:
//   1. the page image is drawn,
//   2. every block of printed text is covered with the background colour
//      sampled around it,
//   3. the translated text is written inside the same box, wrapped and sized to fit.
//
// Usage:
//   const image = await loadImage(dataUrl);
//   const prepared = prepareOverlay(image, blocks);          // reads pixels ONCE
//   drawOverlay(canvas, image, prepared, { lang: 'ta-IN' }); // fast: call again for A- / A+
//
// The text is drawn with the browser's own fonts, so Tamil and the other
// scripts show correctly. The maths lives in form-overlay-utils.js (unit tested).

import {
  boxToPixels,
  coverPadding,
  coverRect,
  isSameText,
  fitText,
  textHeight,
  sampleBackground,
  sampleDarkest,
  chooseTextColor,
  rgbToCss,
  scaleFromOffset,
} from './form-overlay-utils.js';

// Font list: Windows fonts for Indic, Korean, Chinese and Japanese first, then generic ones.
// The canvas also falls back font by font for any character a font does not have.
const FONT_FAMILY =
  '"Nirmala UI", "Noto Sans", "Segoe UI", "Malgun Gothic", "Microsoft YaHei", "Yu Gothic", Tahoma, system-ui, sans-serif';

// Space between the box edge and the new text (small, so the text can use the full box height).
// The cover itself reaches further than the box: see coverPadding() in form-overlay-utils.js.
const TEXT_PAD = 1;
// Languages written from right to left.
const RTL_LANGS = ['ar', 'ur'];

/** True for a BCP-47 code of a right-to-left language, e.g. "ar-SA". */
export function isRtlLang(bcp47) {
  return RTL_LANGS.includes(String(bcp47 ?? '').split('-')[0].toLowerCase());
}

/**
 * Load an image from a URL, data URL or blob URL.
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image_load_failed'));
    image.src = src;
  });
}

/**
 * Work out, for every block, where to draw and which colours to use.
 * This reads the image pixels, so call it once per page and keep the result.
 * @param {HTMLImageElement} image
 * @param {{translation:string, box_2d:number[]}[]} blocks
 * @returns {{text:string, rect:object, cover:object, background:string, color:string}[]}
 *   one item per block that must be redrawn (blocks whose translation equals the
 *   original text are left out)
 */
export function prepareOverlay(image, blocks) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  // Draw the original page on a scratch canvas and read its pixels once.
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);

  return (
    blocks
      // A translation that equals the original (a name, a number, a code) is not redrawn:
      // its pixels stay exactly as they were.
      .filter((block) => !isSameText(block.text, block.translation))
      .map((block) => {
        const rect = boxToPixels(block.box_2d, width, height);

        // The background is read just outside the cover, so no original letters are in it.
        const background = sampleBackground(pixels, rect, coverPadding(rect));
        // The text colour is the colour of the original letters when it stands out enough.
        const color = chooseTextColor(sampleDarkest(pixels, rect), background);

        return {
          text: block.translation,
          rect,
          cover: coverRect(rect, width, height),
          background: rgbToCss(background),
          color,
        };
      })
  );
}

/**
 * Draw the page with the translated text on a canvas. Cheap to call again.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement} image
 * @param {object[]} prepared  result of prepareOverlay
 * @param {{lang?:string, scaleOffset?:number}} options
 *   lang         BCP-47 code of the translation (sets the text direction and glyph style)
 *   scaleOffset  A- / A+ presses away from Auto (0 = auto-fit)
 */
export function drawOverlay(canvas, image, prepared, { lang = '', scaleOffset = 0 } = {}) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  // Changing the size also clears the canvas and resets its settings.
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);

  const rtl = isRtlLang(lang);
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = rtl ? 'right' : 'left';
  ctx.textBaseline = 'top';
  if ('lang' in ctx && lang) ctx.lang = lang; // picks the right glyph shapes (Chinese vs Japanese)

  // Step 1: cover ALL the original text first, so a cover never hides new text.
  for (const item of prepared) {
    ctx.fillStyle = item.background;
    ctx.fillRect(item.cover.x, item.cover.y, item.cover.w, item.cover.h);
  }

  // Step 2: write the translations.
  const scale = scaleFromOffset(scaleOffset);
  const measureAt = (text, size) => {
    ctx.font = `${size}px ${FONT_FAMILY}`;
    return ctx.measureText(text).width;
  };

  for (const item of prepared) {
    // The text may use the whole cleared area: the full height of the cover, and the
    // width of the box plus the cleared space on the side where the text continues
    // (right for left-to-right languages, left for Arabic and Urdu).
    const { rect, cover } = item;
    const areaLeft = rtl ? cover.x : rect.x;
    const areaRight = rtl ? rect.x + rect.w : cover.x + cover.w;
    const boxW = Math.max(1, areaRight - areaLeft - TEXT_PAD * 2);
    const boxH = Math.max(1, cover.h - TEXT_PAD * 2);

    const fit = fitText({ text: item.text, boxW, boxH, measureAt, scale });
    const lineHeightPx = fit.size * fit.lineHeight;

    // Centre the text up and down when it fits; otherwise start at the top edge.
    const blockHeight = textHeight(fit.lines.length, fit.size, fit.lineHeight);
    const offsetY = fit.fits ? (boxH - blockHeight) / 2 : 0;
    const startY = cover.y + TEXT_PAD + offsetY;
    const x = rtl ? areaRight - TEXT_PAD : areaLeft + TEXT_PAD;

    ctx.font = `${fit.size}px ${FONT_FAMILY}`;
    ctx.fillStyle = item.color;
    fit.lines.forEach((line, index) => {
      ctx.fillText(line, x, startY + index * lineHeightPx);
    });
  }
}
