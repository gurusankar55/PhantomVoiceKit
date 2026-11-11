// form-overlay-utils.js
// Pure helper functions for drawing translated text over a form image
// (used by form-overlay.js). No browser or DOM access here, so they can be
// unit tested in plain Node.
//
// A "box" is [ymin, xmin, ymax, xmax] on a 0 to 1000 scale (Gemini's box_2d).

// ---------------------------------------------------------------------------
// Box conversion
// ---------------------------------------------------------------------------

// Keep a number between low and high.
function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

/**
 * Turn a 0-1000 box into a pixel rectangle on an image.
 * The rectangle always lies inside the image and is at least 1 px wide and high.
 * @param {number[]} box   [ymin, xmin, ymax, xmax]
 * @param {number} width   image width in pixels (at least 1)
 * @param {number} height  image height in pixels (at least 1)
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function boxToPixels(box, width, height) {
  const [ymin, xmin, ymax, xmax] = box;

  const x = clamp(Math.floor((xmin / 1000) * width), 0, width - 1);
  const y = clamp(Math.floor((ymin / 1000) * height), 0, height - 1);
  // The far edge is rounded up and must stay at least 1 px away from the near edge.
  const right = clamp(Math.ceil((xmax / 1000) * width), x + 1, width);
  const bottom = clamp(Math.ceil((ymax / 1000) * height), y + 1, height);

  return { x, y, w: right - x, h: bottom - y };
}

// ---------------------------------------------------------------------------
// Text wrapping and font fitting
// ---------------------------------------------------------------------------

// Split a word into "characters as the reader sees them". Grapheme clusters keep
// a Tamil consonant together with its vowel sign when we have to break a long word.
function splitGraphemes(word) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(word), (part) => part.segment);
  }
  return Array.from(word); // older browsers: one code point at a time
}

/**
 * Wrap text into lines that are not wider than maxWidth.
 * Words are kept whole when they fit. A word that is too wide on its own, and
 * text without spaces (Chinese, Japanese), is broken between characters.
 * @param {string} text
 * @param {number} maxWidth
 * @param {(s: string) => number} measure  width of a string at the current font size
 * @returns {string[]}
 */
export function wrapText(text, maxWidth, measure) {
  const lines = [];

  // Each line break in the text starts a new paragraph.
  for (const paragraph of String(text ?? '').split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter((word) => word !== '');
    let line = '';

    for (const word of words) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (measure(candidate) <= maxWidth) {
        line = candidate;
        continue;
      }

      // The word does not fit after the current line: close that line.
      if (line !== '') {
        lines.push(line);
        line = '';
      }

      if (measure(word) <= maxWidth) {
        line = word;
        continue;
      }

      // Too wide even alone: break it between characters.
      for (const character of splitGraphemes(word)) {
        // An empty line always takes one character, so this cannot loop forever.
        if (line === '' || measure(line + character) <= maxWidth) {
          line += character;
        } else {
          lines.push(line);
          line = character;
        }
      }
    }

    if (line !== '') lines.push(line);
  }

  return lines;
}

/**
 * Height of some lines of text. The first line needs only the font size itself
 * (so one line can use the FULL height of its box); every further line adds one
 * line height.
 * @param {number} lineCount
 * @param {number} size        font size in pixels
 * @param {number} lineHeight  line height as a multiple of the size
 */
export function textHeight(lineCount, size, lineHeight) {
  if (lineCount <= 0) return 0;
  return size + (lineCount - 1) * size * lineHeight;
}

/**
 * Find the largest font size at which the wrapped text fits inside the box.
 * @param {object} options
 *   text        the text to write
 *   boxW, boxH  box size in pixels
 *   measureAt   (s, size) => width of string s at that font size
 *   minSize     smallest allowed size (default 6)
 *   maxSize     largest allowed size (default: the box height)
 *   lineHeight  line height as a multiple of the size (default 1.15)
 *   scale       multiplier from the A- / A+ buttons (default 1 = Auto)
 * @returns {{size:number, lines:string[], lineHeight:number, fits:boolean}}
 *   size is in pixels; fits is false when even the smallest size overflows
 *   (or when scale made the text bigger than the box).
 */
export function fitText({ text, boxW, boxH, measureAt, minSize = 6, maxSize, lineHeight = 1.15, scale = 1 }) {
  const wrapAt = (size) => wrapText(text, boxW, (s) => measureAt(s, size));
  const heightAt = (lines, size) => textHeight(lines.length, size, lineHeight);

  // Binary search: the biggest whole-number size that still fits.
  let low = minSize;
  let high = Math.max(minSize, Math.floor(maxSize ?? boxH));
  let best = minSize;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (heightAt(wrapAt(middle), middle) <= boxH) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  // Apply the user's A- / A+ scale on top of the auto-fit size.
  const size = scale === 1 ? best : Math.max(minSize, Math.round(best * scale));
  const lines = wrapAt(size);
  return { size, lines, lineHeight, fits: heightAt(lines, size) <= boxH };
}

// ---------------------------------------------------------------------------
// A- / A+ text size
// ---------------------------------------------------------------------------

// Each A- / A+ press changes the text size by this factor.
const SCALE_STEP = 1.15;
// The offset (number of presses away from Auto) stays between these limits.
export const MIN_OFFSET = -6;
export const MAX_OFFSET = 6;

/** Keep the A- / A+ offset a whole number between MIN_OFFSET and MAX_OFFSET. */
export function clampOffset(offset) {
  const n = Math.round(Number(offset));
  return Number.isFinite(n) ? clamp(n, MIN_OFFSET, MAX_OFFSET) : 0;
}

/** Size multiplier for an offset. 0 (Auto) gives exactly 1. */
export function scaleFromOffset(offset) {
  return SCALE_STEP ** clampOffset(offset);
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

// Median of a list of numbers (the middle value; the list is changed).
function median(values) {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/**
 * Work out the background colour around a box.
 * Looks at a thin ring of pixels just outside the box (so the printed text inside
 * the box does not tint the result) and takes the median of each channel, which
 * ignores a few stray dark pixels from neighbouring text.
 * @param {{data: Uint8ClampedArray|number[], width:number, height:number}} image  RGBA pixels
 * @param {{x:number, y:number, w:number, h:number}} rect  the box in pixels
 * @param {number} pad   gap between the box and the ring (default 2)
 * @param {number} ring  thickness of the ring (default 3)
 * @returns {{r:number, g:number, b:number}}  white if there is nothing to look at
 */
export function sampleBackground(image, rect, pad = 2, ring = 3) {
  const { data, width, height } = image;

  // Inner edge of the ring (the box plus the gap) and outer edge (plus the ring).
  const innerLeft = rect.x - pad;
  const innerTop = rect.y - pad;
  const innerRight = rect.x + rect.w + pad;
  const innerBottom = rect.y + rect.h + pad;

  const startX = Math.max(0, innerLeft - ring);
  const startY = Math.max(0, innerTop - ring);
  const endX = Math.min(width, innerRight + ring);
  const endY = Math.min(height, innerBottom + ring);

  const reds = [];
  const greens = [];
  const blues = [];

  for (let py = startY; py < endY; py++) {
    for (let px = startX; px < endX; px++) {
      // Skip pixels inside the box (and its gap).
      const inside = px >= innerLeft && px < innerRight && py >= innerTop && py < innerBottom;
      if (inside) continue;

      const i = (py * width + px) * 4;
      if (data[i + 3] < 128) continue; // see-through pixel: ignore
      reds.push(data[i]);
      greens.push(data[i + 1]);
      blues.push(data[i + 2]);
    }
  }

  if (reds.length === 0) return { r: 255, g: 255, b: 255 };
  return { r: median(reds), g: median(greens), b: median(blues) };
}

/** "rgb(r, g, b)" text for canvas fillStyle. */
export function rgbToCss({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Pick pure black or pure white, whichever is easier to read on a background colour.
 * @param {{r:number, g:number, b:number}} background
 * @returns {string} '#000000' or '#ffffff'
 */
export function readableTextColor({ r, g, b }) {
  // Weighted brightness (the eye sees green brighter than blue).
  const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
  return brightness > 140 ? '#000000' : '#ffffff';
}

// How bright a colour looks, from 0 (black) to 1 (white), as defined by WCAG.
function relativeLuminance({ r, g, b }) {
  const channel = (value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Contrast between two colours: 1 (identical) to 21 (black on white).
 * 4.5 is the usual minimum for readable text.
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// The text colour must have at least this contrast with the background.
export const MIN_CONTRAST = 4.5;

/**
 * Find the colour of the original text: the average of the darkest pixels inside the box.
 * (Only the darkest 5% are used, so the thin, blurred edges of the letters and the
 * background do not wash the colour out.)
 * @param {{data: Uint8ClampedArray|number[], width:number, height:number}} image  RGBA pixels
 * @param {{x:number, y:number, w:number, h:number}} rect  the box in pixels
 * @returns {{r:number, g:number, b:number} | null}  null if the box has no usable pixels
 */
export function sampleDarkest(image, rect) {
  const { data, width, height } = image;
  const pixels = [];

  const endX = Math.min(width, rect.x + rect.w);
  const endY = Math.min(height, rect.y + rect.h);
  for (let py = Math.max(0, rect.y); py < endY; py++) {
    for (let px = Math.max(0, rect.x); px < endX; px++) {
      const i = (py * width + px) * 4;
      if (data[i + 3] < 128) continue; // see-through pixel: ignore
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      pixels.push({ r, g, b, brightness: 0.299 * r + 0.587 * g + 0.114 * b });
    }
  }
  if (pixels.length === 0) return null;

  pixels.sort((a, b) => a.brightness - b.brightness);
  const take = pixels.slice(0, Math.max(1, Math.floor(pixels.length * 0.05)));
  const mean = (key) => Math.round(take.reduce((sum, p) => sum + p[key], 0) / take.length);
  return { r: mean('r'), g: mean('g'), b: mean('b') };
}

/**
 * Choose the colour for the new text: the colour of the original text if it
 * stands out enough from the background, otherwise pure black or pure white.
 * @param {{r:number,g:number,b:number}|null} darkest  from sampleDarkest
 * @param {{r:number,g:number,b:number}} background
 * @returns {string} a CSS colour that is fully opaque
 */
export function chooseTextColor(darkest, background) {
  if (darkest && contrastRatio(darkest, background) >= MIN_CONTRAST) return rgbToCss(darkest);
  return readableTextColor(background);
}

// ---------------------------------------------------------------------------
// Cover rectangle and unchanged text
// ---------------------------------------------------------------------------

/**
 * How far the cover reaches beyond the box on every side: 20% of the box height,
 * and at least 3 px. The box from Gemini is tight, so the larger letters of the
 * original (and their antialiased edges) would otherwise show around the new text.
 */
export function coverPadding(rect) {
  return Math.max(3, Math.round(rect.h * 0.2));
}

/**
 * The area to paint over: the box grown by coverPadding on every side, kept inside the image.
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function coverRect(rect, imageWidth, imageHeight) {
  const pad = coverPadding(rect);
  const left = Math.max(0, rect.x - pad);
  const top = Math.max(0, rect.y - pad);
  const right = Math.min(imageWidth, rect.x + rect.w + pad);
  const bottom = Math.min(imageHeight, rect.y + rect.h + pad);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * True when the translation is the same as the original text (a name, a number,
 * a code...), ignoring spaces at the ends, extra spaces inside and capital letters.
 * Such a block is left untouched. An unknown original is never "the same".
 */
export function isSameText(original, translation) {
  const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  const a = clean(original);
  return a !== '' && a === clean(translation);
}

// ---------------------------------------------------------------------------
// Reading order
// ---------------------------------------------------------------------------

/**
 * Sort blocks into reading order: rows from top to bottom, and inside a row
 * from left to right. Blocks whose vertical centres are close (within half the
 * height of the first block of the row) count as the same row.
 * The original array is not changed.
 * @param {{box_2d:number[]}[]} blocks
 * @returns {object[]}
 */
export function readingOrder(blocks) {
  const centreY = (block) => (block.box_2d[0] + block.box_2d[2]) / 2;

  const sorted = [...blocks].sort((a, b) => centreY(a) - centreY(b));

  const rows = [];
  for (const block of sorted) {
    const row = rows[rows.length - 1];
    if (row) {
      const first = row[0];
      const firstHeight = first.box_2d[2] - first.box_2d[0];
      if (Math.abs(centreY(block) - centreY(first)) <= firstHeight / 2) {
        row.push(block);
        continue;
      }
    }
    rows.push([block]);
  }

  // Left to right inside each row (by xmin), then join the rows.
  return rows.flatMap((row) => row.sort((a, b) => a.box_2d[1] - b.box_2d[1]));
}
