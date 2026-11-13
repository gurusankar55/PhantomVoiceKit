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
  fitAnswer,
  boxHasInk,
  findWritingLine,
  baselinesAboveLine,
  LINE_GAP_PX,
  measureLabelHeight,
  answerSizeFromLabel,
  signaturePlacement,
  signatureThickenRadius,
  thickenOffsets,
  detectCombCells,
  layoutComb,
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
// Answers written on the original form (see drawAnswers): dark blue like pen ink ...
const ANSWER_INK = '#14267b';
// ... starting this many pixels from the left edge of the answer box ...
const ANSWER_PAD = 2;
// ... and never taller than this share of the page height (a big empty box does not get huge letters).
const ANSWER_MAX_HEIGHT_SHARE = 0.02;
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

/**
 * Which answer boxes of a page already hold text or other ink? (A form that was already partly
 * filled in.) Reads the pixels of the page once.
 * @param {HTMLImageElement} image
 * @param {number[][]} boxes  [ymin, xmin, ymax, xmax] on a 0 to 1000 scale
 * @returns {boolean[]} one answer per box: true = something is already written there
 */
export function findOccupiedBoxes(image, boxes) {
  if (boxes.length === 0) return [];
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);

  const occupied = boxes.map((box) => boxHasInk(pixels, boxToPixels(box, width, height)));
  scratch.width = 0; // let the browser free the memory
  return occupied;
}

/**
 * Look at the answer boxes of a page (reads the pixels once): is something already written in
 * each box, is it divided into character cells (a comb box), is there a line to write on
 * (solid, dashed or dotted), and how tall is the printed label next to it (answers are sized from it)?
 * @param {HTMLImageElement} image
 * @param {number[][]} boxes  [ymin, xmin, ymax, xmax] on a 0 to 1000 scale
 * @returns {{occupied:boolean, cells:{x:number, y:number, w:number, h:number}[]|null, line:{top:number, bottom:number}|null, labelHeight:number|null}[]}  one per box
 */
export function analyzeBoxes(image, boxes) {
  if (boxes.length === 0) return [];
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height);

  const result = boxes.map((box) => {
    const rect = boxToPixels(box, width, height);
    return {
      occupied: boxHasInk(pixels, rect),
      cells: detectCombCells(pixels, rect),
      line: findWritingLine(pixels, rect),
      labelHeight: measureLabelHeight(pixels, rect),
    };
  });
  scratch.width = 0; // let the browser free the memory
  return result;
}

/**
 * The drawn signature, ready to put on the form: scaled to `place`, every stroke pixel turned into
 * solid dark ink (faint, thin edges after scaling become crisp), and thickened by `radius` pixels
 * on each side so strokes are at least 2.5 px.
 * @param {HTMLImageElement} picture  the signature (transparent background)
 * @param {{w:number, h:number}} place  from signaturePlacement
 * @param {number} radius  from signatureThickenRadius
 * @returns {{canvas:HTMLCanvasElement, pad:number} | null}  pad = extra pixels around the picture
 */
function darkSignature(picture, place, radius) {
  const w = Math.max(1, Math.round(place.w));
  const h = Math.max(1, Math.round(place.h));
  const scaled = document.createElement('canvas');
  scaled.width = w;
  scaled.height = h;
  const sctx = scaled.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(picture, 0, 0, w, h);

  // Solid dark ink wherever the pen went.
  const pixels = sctx.getImageData(0, 0, w, h);
  const ink = { r: 0x14, g: 0x26, b: 0x7b }; // ANSWER_INK
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i + 3] >= 40) {
      pixels.data[i] = ink.r;
      pixels.data[i + 1] = ink.g;
      pixels.data[i + 2] = ink.b;
      pixels.data[i + 3] = 255;
    } else {
      pixels.data[i + 3] = 0;
    }
  }
  sctx.putImageData(pixels, 0, 0);

  // Thicker strokes: the picture drawn once for each small shift around a circle.
  const pad = Math.ceil(radius) + 1;
  const out = document.createElement('canvas');
  out.width = w + pad * 2;
  out.height = h + pad * 2;
  const octx = out.getContext('2d');
  for (const { dx, dy } of thickenOffsets(radius)) octx.drawImage(scaled, pad + dx, pad + dy);
  scaled.width = 0; // let the browser free the memory
  return { canvas: out, pad };
}

/**
 * Draw a page with answers written on it (Spirit Clerk: "Fill the original form"). Nothing is
 * covered or changed: the page is drawn as it is and the answers are put on top, in dark blue.
 * Cheap to call again for A- / A+.
 * Each item is one of:
 *   { type: 'text', text, box, kind?, cells?, line? }   the answer written left-aligned: just ABOVE
 *        the line to write on when there is one (line = its top and bottom in pixels, see
 *        findWritingLine; the letters never touch it), otherwise vertically centred in the box;
 *        when the box is divided into character cells (cells = their pixel rectangles, see
 *        detectCombCells) and the answer fits them, ONE character per cell, centred
 *   { type: 'tick', box }                         a tick mark in the box (an option, a tick box)
 *   { type: 'image', image, box, line?, labelHeight? }   the drawn signature (a loaded HTMLImageElement),
 *        its shape kept, up to 2x the label height, its bottom a few pixels above the line,
 *        in dark ink with strokes of at least 2.5 px (see signaturePlacement)
 *   text and image items may carry labelHeight (see measureLabelHeight): answers are sized from it
 * (an item without a type is a text item). box = [ymin, xmin, ymax, xmax] on a 0 to 1000 scale.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLImageElement} image
 * @param {object[]} items
 * @param {{scaleOffset?:number}} options  scaleOffset = A- / A+ presses away from Auto (0 = auto-fit)
 * @returns {object[]} what was drawn, one per item: { type, text?, lines?, size?, fits?, comb? }
 */
export function drawAnswers(canvas, image, items, { scaleOffset = 0 } = {}) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  // Changing the size also clears the canvas and resets its settings.
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, width, height);

  ctx.direction = 'ltr'; // answers are English
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = ANSWER_INK;
  ctx.strokeStyle = ANSWER_INK;

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

  const scale = scaleFromOffset(scaleOffset);
  const maxSize = Math.max(10, Math.round(height * ANSWER_MAX_HEIGHT_SHARE));
  const lineHeight = 1.15;

  // One character in each cell of a comb box, centred.
  function drawComb(characters, cells) {
    const cellW = Math.min(...cells.map((cell) => cell.w));
    const base = Math.min(cells[0].h * 0.7, cellW * 0.8, maxSize * 1.3);
    const size = Math.max(6, Math.round(base * scale));
    ctx.font = `${size}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    characters.forEach((character, i) => {
      if (character !== '') ctx.fillText(character, cells[i].x + cells[i].w / 2, cells[i].y + cells[i].h / 2);
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    return size;
  }

  return items.map((item) => {
    const rect = boxToPixels(item.box, width, height);

    if (item.type === 'tick') {
      // A check mark: a short stroke down to the bottom, then a long one up to the top right.
      const size = Math.min(rect.w, rect.h);
      ctx.lineWidth = Math.max(2, size * 0.16);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(rect.x + rect.w * 0.18, rect.y + rect.h * 0.55);
      ctx.lineTo(rect.x + rect.w * 0.4, rect.y + rect.h * 0.8);
      ctx.lineTo(rect.x + rect.w * 0.85, rect.y + rect.h * 0.2);
      ctx.stroke();
      return { type: 'tick' };
    }

    if (item.type === 'image') {
      // The drawn signature: big (up to 2x the label height), above the line, never touching it,
      // with strokes thickened to at least 2.5 px in dark ink.
      const picture = item.image;
      if (!picture) return { type: 'image', drawn: false };
      const lineTop = item.line && Number.isFinite(item.line.top) ? item.line.top : null;
      const place = signaturePlacement({
        imageW: picture.naturalWidth || picture.width,
        imageH: picture.naturalHeight || picture.height,
        rect,
        lineTop,
        labelHeight: item.labelHeight,
      });
      const ink = darkSignature(picture, place, signatureThickenRadius(place.scale));
      if (ink) ctx.drawImage(ink.canvas, Math.round(place.x) - ink.pad, Math.round(place.y) - ink.pad);
      return { type: 'image', drawn: Boolean(ink), size: Math.round(place.h) };
    }

    // Text: cell by cell when the box is a comb box and the answer fits it.
    if (Array.isArray(item.cells) && item.cells.length >= 4) {
      const characters = layoutComb(item.text, item.cells.length, item.kind);
      if (characters) return { type: 'text', text: item.text, comb: true, size: drawComb(characters, item.cells), fits: true };
    }

    const boxW = Math.max(1, rect.w - ANSWER_PAD * 2);

    // The size comes from the printed label on the same row (about 85% of it, never below 70%)
    // when a label was found; otherwise the answer is fitted to the area as before.
    const labelSized = (maxHeight) =>
      answerSizeFromLabel({ text: item.text, labelHeight: item.labelHeight, boxW, measureAt, maxHeight, scale, lineHeight });

    // A line to write on (solid, dashed, dotted): the text stands on it, a few pixels ABOVE it, so
    // it never looks crossed out. The space for the text ends just above the line.
    const lineTop = item.line && Number.isFinite(item.line.top) ? item.line.top : null;
    if (lineTop !== null) {
      const room = Math.max(lineTop - LINE_GAP_PX - rect.y, rect.h * 0.6);
      const fitted = labelSized(Infinity) || fitAnswer({ text: item.text, boxW, boxH: room, measureAt, maxSize, lineHeight, scale });
      const baselines = baselinesAboveLine({ lineTop, size: fitted.size, lineCount: fitted.lines.length, lineHeight });
      ctx.font = `${fitted.size}px ${FONT_FAMILY}`;
      ctx.textBaseline = 'alphabetic';
      fitted.lines.forEach((line, i) => ctx.fillText(line, rect.x + ANSWER_PAD, baselines[i]));
      ctx.textBaseline = 'top';
      return { type: 'text', text: item.text, lines: fitted.lines, size: fitted.size, fits: fitted.fits, aboveLine: true };
    }

    // Inside a box: never taller than the box allows.
    const inBox = labelSized(rect.h * 0.8);
    const sized = inBox
      ? { ...inBox, fits: inBox.fits && textHeight(inBox.lines.length, inBox.size, lineHeight) <= rect.h }
      : fitAnswer({ text: item.text, boxW, boxH: rect.h, measureAt, maxSize, lineHeight, scale });
    const { size, lines, fits } = sized;

    // Inside a box: centre the lines up and down when they fit; otherwise start at the top edge.
    const offsetY = fits ? (rect.h - textHeight(lines.length, size, lineHeight)) / 2 : 0;
    ctx.font = `${size}px ${FONT_FAMILY}`;
    lines.forEach((line, i) => {
      ctx.fillText(line, rect.x + ANSWER_PAD, rect.y + offsetY + i * size * lineHeight);
    });
    return { type: 'text', text: item.text, lines, size, fits };
  });
}
