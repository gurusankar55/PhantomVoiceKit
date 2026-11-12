// form-overlay.js
// Draws a translated version of a form page on a canvas, like Google Lens:
//   1. the page image is drawn,
//   2. every block of printed text is covered with the background colour
//      sampled around it (the cover grows until no old letters are left),
//   3. the translated text is written in the cleared area. All blocks of the page are laid out
//      together: lines that had the same size in the original get the same size here.
//
// Usage:
//   const image = await loadImage(dataUrl);
//   const prepared = prepareOverlay(image, blocks, { lang: 'ta-IN' }); // reads pixels ONCE
//   drawOverlay(canvas, image, prepared, { lang: 'ta-IN' });           // fast: call again for A- / A+
//
// The text is drawn with the browser's own fonts, so Tamil and the other
// scripts show correctly. The maths lives in form-overlay-utils.js (unit tested).

import {
  boxToPixels,
  coverPadding,
  coverRect,
  growCover,
  insetRect,
  findFreeWidth,
  textArea,
  leaveUntouched,
  describeOriginal,
  planTextLayout,
  layoutAt,
  textHeight,
  sampleBackground,
  sampleDarkest,
  sampleInkColor,
  chooseTextColor,
  rgbToCss,
  scaleFromOffset,
} from './form-overlay-utils.js';

// Font list: Windows fonts for Indic, Korean, Chinese and Japanese first, then generic ones.
// The canvas also falls back font by font for any character a font does not have.
const FONT_FAMILY =
  '"Nirmala UI", "Noto Sans", "Segoe UI", "Malgun Gothic", "Microsoft YaHei", "Yu Gothic", Tahoma, system-ui, sans-serif';

// Space between the edge of the text area and the new text.
const TEXT_PAD = 1;
// Text up to this size gets a thin outline in its own colour, so small letters look solid, not grey.
const SOLID_TEXT_MAX_SIZE = 22;
// Free space beside a block is used up to this share of the page width away from the page edge.
const PAGE_MARGIN_SHARE = 0.03;
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
 * @param {{text?:string, translation:string, short?:string, box_2d:number[]}[]} blocks
 * @param {{lang?:string}} options  lang = BCP-47 code of the translation; it decides which
 *   unchanged texts may stay (see leaveUntouched) and on which side the text continues
 * @returns {object[]} one item per block that must be redrawn (blocks that may stay as they
 *   are are left out): text, short, originalHeight, originalLines, rect, cover, area, background, color
 */
export function prepareOverlay(image, blocks, { lang = '' } = {}) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const rtl = isRtlLang(lang);
  // The page margin: text may reach this close to the edge of the page, never closer.
  const margin = Math.round(width * PAGE_MARGIN_SHARE);

  // Draw the original page on a scratch canvas and read its pixels once.
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);

  // A translation that equals the original is left as it is when that is allowed
  // (see leaveUntouched): e-mail, links, numbers, dates, codes - and names only in Latin-script languages.
  const rects = blocks.map((block) => boxToPixels(block.box_2d, width, height));
  const redrawn = blocks.map((block) => !leaveUntouched(block.text, block.translation, lang));

  // The boxes a cover must not enter. An untouched block keeps its full box (it must stay exactly
  // as it is). A block that is redrawn is protected a little less: boxes of neighbours often overlap
  // by a few pixels, and its own cover repaints that edge anyway.
  const guards = rects.map((rect, i) => (redrawn[i] ? insetRect(rect, Math.max(2, Math.round(rect.h * 0.25))) : rect));

  const prepared = [];
  blocks.forEach((block, index) => {
    if (!redrawn[index]) return;

    const rect = rects[index];
    const others = guards.filter((_, i) => i !== index);

    // The background is read just outside the first cover, so no original letters are in it.
    const background = sampleBackground(pixels, rect, coverPadding(rect));
    // The text colour is the colour of the original letters when it is a real colour that stands
    // out strongly; otherwise solid black or white.
    const color = chooseTextColor(sampleDarkest(pixels, rect), background);

    // Start with the padded box, then grow each side while pieces of the old letters are left
    // (also letters behind a gap, e.g. the "AM" after "10:30").
    const cover = growCover({
      image: pixels,
      rect,
      cover: coverRect(rect, width, height),
      background,
      ink: sampleInkColor(pixels, rect, background),
      avoid: others,
    });

    // Plain background next to the cover may hold longer text: it is used BEFORE the text is made
    // smaller. The scan goes on up to the page margin and stops at ink, a border or another block.
    // (It looks beside the cover, and above and below it for a second line.)
    const rightRoom = Math.max(0, width - margin - (cover.x + cover.w));
    const leftRoom = Math.max(0, cover.x - margin);
    const sideScan = { image: pixels, cover, background, avoid: others };
    const freeRight = findFreeWidth({ ...sideScan, direction: 'right', maxExtra: rightRoom });
    const freeLeft = findFreeWidth({ ...sideScan, direction: 'left', maxExtra: leftRoom });
    const wide = textArea({ rect, cover, freeLeft, freeRight, rtl, maxWidth: width });
    const rowScan = {
      image: pixels,
      cover: { x: wide.left, y: cover.y, w: wide.right - wide.left, h: cover.h },
      background,
      avoid: others,
      maxExtra: Math.round(rect.h * 0.5),
    };
    const area = textArea({
      rect, cover, freeLeft, freeRight, rtl, maxWidth: width,
      freeUp: findFreeWidth({ ...rowScan, direction: 'up' }),
      freeDown: findFreeWidth({ ...rowScan, direction: 'down' }),
    });

    const original = describeOriginal(rect, block.text);
    prepared.push({
      text: block.translation,
      short: block.short || '',
      originalHeight: original.height,
      originalLines: original.lines,
      rect,
      cover,
      area,
      background: rgbToCss(background),
      color,
    });
  });
  return prepared;
}

// The layout of a page (text, lines, sizes) is worked out once per language and kept here, so
// pressing A- / A+ only has to redraw.
const planCache = new WeakMap();

/**
 * Draw the page with the translated text on a canvas. Cheap to call again.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement} image
 * @param {object[]} prepared  result of prepareOverlay
 * @param {{lang?:string, scaleOffset?:number}} options
 *   lang         BCP-47 code of the translation (sets the text direction, the line breaking and the glyph style)
 *   scaleOffset  A- / A+ presses away from Auto (0 = auto-fit)
 * @returns {object[]} what was drawn for every item: { text, lines, size, usedShort, group, align, x, area, fits }
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

  // Step 2: decide text, lines and size of every block together (cached per language).
  const memo = new Map(); // measuring is the slow part: remember every answer
  const measureAt = (text, size) => {
    const key = `${size}|${text}`;
    let value = memo.get(key);
    if (value === undefined) {
      ctx.font = `${size}px ${FONT_FAMILY}`;
      value = ctx.measureText(text).width;
      memo.set(key, value);
    }
    return value;
  };
  const boxOf = (item) => ({
    boxW: Math.max(1, item.area.right - item.area.left - TEXT_PAD * 2),
    boxH: Math.max(1, item.area.bottom - item.area.top - TEXT_PAD * 2),
  });

  let cached = planCache.get(prepared);
  if (!cached || cached.lang !== lang) {
    const items = prepared.map((item) => ({
      text: item.text,
      short: item.short,
      originalHeight: item.originalHeight,
      originalLines: item.originalLines,
      ...boxOf(item),
    }));
    cached = { lang, plan: planTextLayout({ items, measureAt, lang }) };
    planCache.set(prepared, cached);
  }

  // Step 3: write the translations.
  const scale = scaleFromOffset(scaleOffset);
  const drawn = [];
  prepared.forEach((item, index) => {
    const base = cached.plan[index];
    const { boxW, boxH } = boxOf(item);

    // A- / A+ changes the size of the planned text; the lines are wrapped again at the new size.
    let { size, lines, fits } = base;
    if (scale !== 1) {
      size = Math.max(6, Math.round(base.size * scale));
      ({ lines, fits } = layoutAt({ text: base.text, boxW, boxH, measureAt, size, lang }));
    }

    // Centre the text up and down when it fits; otherwise start at the top edge.
    const lineHeightPx = size * base.lineHeight;
    const offsetY = fits ? (boxH - textHeight(lines.length, size, base.lineHeight)) / 2 : 0;
    const startY = item.area.top + TEXT_PAD + offsetY;
    const x = rtl ? item.area.right - TEXT_PAD : item.area.left + TEXT_PAD;

    ctx.font = `${size}px ${FONT_FAMILY}`;
    ctx.fillStyle = item.color;
    ctx.strokeStyle = item.color;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.6, size * 0.035);
    lines.forEach((line, i) => {
      const y = startY + i * lineHeightPx;
      ctx.fillText(line, x, y);
      if (size <= SOLID_TEXT_MAX_SIZE) ctx.strokeText(line, x, y); // small text: a thin outline makes it solid
    });

    drawn.push({ text: base.text, lines, size, usedShort: base.usedShort, group: base.group, align: rtl ? 'right' : 'left', x, area: item.area, fits });
  });
  return drawn;
}
