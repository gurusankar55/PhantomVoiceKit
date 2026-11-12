// form-overlay-utils.js
// Pure helper functions for drawing translated text over a form image
// (used by form-overlay.js). No browser or DOM access here, so they can be
// unit tested in plain Node.
//
// A "box" is [ymin, xmin, ymax, xmax] on a 0 to 1000 scale (Gemini's box_2d).

import { isLatinScriptLang, isKeepAsIs } from './translation-rules.js';

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

/**
 * Where to draw a picture inside a box: as big as possible, its shape kept (never stretched),
 * centred, with a small margin. It is not enlarged more than `maxScale` times.
 * @param {number} imageW
 * @param {number} imageH
 * @param {{x:number, y:number, w:number, h:number}} box
 * @param {{margin?:number, maxScale?:number}} [options]  margin = share of the box left free on each side (default 0.06)
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function fitInBox(imageW, imageH, box, { margin = 0.06, maxScale = 4 } = {}) {
  const availableW = Math.max(1, box.w * (1 - 2 * margin));
  const availableH = Math.max(1, box.h * (1 - 2 * margin));
  const scale = Math.min(availableW / Math.max(1, imageW), availableH / Math.max(1, imageH), maxScale);
  const w = imageW * scale;
  const h = imageH * scale;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

// ---------------------------------------------------------------------------
// Text wrapping (never inside a word) and font fitting
// ---------------------------------------------------------------------------

// First part of a BCP-47 code in lower case: "ta-IN" -> "ta".
function baseLang(lang) {
  return String(lang ?? '').split('-')[0].toLowerCase();
}

// Chinese and Japanese have no spaces: a line may break between any two characters.
const CHARACTER_BREAK_LANGS = ['zh', 'ja'];
// Thai, Lao, Khmer and Burmese have no spaces either, but a line may break only between WORDS
// (found with the browser's dictionary through Intl.Segmenter).
const WORD_SEGMENT_LANGS = ['th', 'lo', 'km', 'my'];

// Characters that must not start a line (closing marks, small kana, the long vowel mark) ...
const NO_LINE_START = new Set(Array.from('，。、．！？；：）］｝〉》」』】〕〗〙〛ー々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ～…,.;:!?)]}%'));
// ... and characters that must not end a line (opening brackets).
const NO_LINE_END = new Set(Array.from('（［｛〈《「『【〔〖〘〚([{'));
// Latin letters, digits and e-mail / time / number signs inside a Chinese or Japanese line stay in one piece.
const LATIN_RUN = /^[A-Za-z0-9@._:/#+%&=?~-]$/;

// Cut a text into pieces with Intl.Segmenter ("grapheme" = what the reader sees as one character,
// so a Tamil consonant stays with its vowel sign; "word" = a dictionary word).
// Returns [{ text, wordLike }]. Without Intl.Segmenter: one piece per code point (or one word).
function segments(text, granularity, lang) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter(lang || undefined, { granularity });
      return Array.from(segmenter.segment(text), (part) => ({ text: part.segment, wordLike: part.isWordLike }));
    } catch {
      // an unknown language tag: use the fallback below
    }
  }
  return granularity === 'grapheme'
    ? Array.from(text, (character) => ({ text: character, wordLike: false }))
    : [{ text, wordLike: true }];
}

// Chinese / Japanese: one unit per character, but "kinsoku" rules glue closing marks to the
// character before them and opening brackets to the character after them.
function splitCharacterUnits(text, lang) {
  const units = [];
  let gap = '';
  for (const part of segments(text, 'grapheme', lang)) {
    if (/^\s+$/.test(part.text)) {
      gap = units.length > 0 ? ' ' : '';
      continue;
    }
    const last = units[units.length - 1];
    const isRun = LATIN_RUN.test(part.text);
    if (last && gap === '' && isRun && last.run) {
      last.text += part.text; // goes on with the same e-mail / time / number
    } else {
      units.push({ text: part.text, gap, run: isRun });
    }
    gap = '';
  }

  const glued = [];
  for (const unit of units) {
    const previous = glued[glued.length - 1];
    const first = Array.from(unit.text)[0];
    const previousLast = previous ? Array.from(previous.text).pop() : '';
    if (previous && unit.gap === '' && (NO_LINE_START.has(first) || NO_LINE_END.has(previousLast))) {
      previous.text += unit.text;
      previous.run = false;
    } else {
      glued.push({ ...unit });
    }
  }
  return glued.map(({ text, gap }) => ({ text, gap }));
}

// Thai and similar: one unit per dictionary word; punctuation sticks to the word before it.
function splitWordUnits(text, lang) {
  const units = [];
  let gap = '';
  for (const part of segments(text, 'word', lang)) {
    if (/^\s+$/.test(part.text)) {
      gap = units.length > 0 ? ' ' : '';
    } else if (part.wordLike || units.length === 0) {
      units.push({ text: part.text, gap });
      gap = '';
    } else {
      units[units.length - 1].text += part.text;
    }
  }
  return units;
}

/**
 * Cut one line of text into the pieces a line may break between. Never inside a piece.
 *   - Chinese, Japanese: single characters (closing marks stay with the character before them)
 *   - Thai, Lao, Khmer, Burmese: dictionary words
 *   - every other language (Tamil, Hindi, Arabic, Urdu, Latin, Cyrillic, ...): words between spaces
 *     (so Indic vowel signs and conjuncts, and joined Arabic letters, can never be cut)
 * @param {string} paragraph
 * @param {string} [lang]  BCP-47 code, e.g. "ta-IN"
 * @returns {{text:string, gap:string}[]}  gap = what joins a piece to the one before it (' ' or '')
 */
export function splitUnits(paragraph, lang = '') {
  const text = String(paragraph ?? '');
  const base = baseLang(lang);
  if (CHARACTER_BREAK_LANGS.includes(base)) return splitCharacterUnits(text, lang);
  if (WORD_SEGMENT_LANGS.includes(base)) return splitWordUnits(text, lang);
  const words = text
    .split(/\s+/)
    .filter((word) => word !== '')
    .map((word, index) => ({ text: word, gap: index === 0 ? '' : ' ' }));
  return glueMarks(words);
}

// A mark that stands alone between two spaces ("E-mail : x", "« text »") must not be left at the
// start of a line (closing marks such as : ! ? ; » ) %) or at the end of one (opening marks such as « ( [).
// It is glued to the word before (closing) or after (opening) it.
function glueMarks(units) {
  const onlyFrom = (set, text) => text !== '' && Array.from(text).every((character) => set.has(character));
  const CLOSING = new Set([...NO_LINE_START, '»', '›', '”', '’']);
  const OPENING = new Set([...NO_LINE_END, '«', '‹', '“', '‘', '¿', '¡']);

  const out = [];
  let pendingOpening = null; // an opening mark waiting for the word after it
  for (const unit of units) {
    if (pendingOpening) {
      out.push({ text: pendingOpening.text + unit.gap + unit.text, gap: pendingOpening.gap });
      pendingOpening = null;
    } else if (out.length > 0 && onlyFrom(CLOSING, unit.text)) {
      out[out.length - 1].text += unit.gap + unit.text;
    } else if (onlyFrom(OPENING, unit.text)) {
      pendingOpening = unit;
    } else {
      out.push({ ...unit });
    }
  }
  if (pendingOpening) out.push(pendingOpening);
  return out;
}

/**
 * Wrap text into lines that are not wider than maxWidth. A line breaks ONLY between the pieces
 * from splitUnits, so a word (or a grapheme cluster) is never cut. A piece that is wider than
 * maxWidth on its own stays whole on a line of its own (the caller makes the font smaller).
 * @param {string} text
 * @param {number} maxWidth
 * @param {(s: string) => number} measure  width of a string at the current font size
 * @param {string} [lang]  BCP-47 code of the text, e.g. "ta-IN"
 * @returns {string[]}
 */
export function wrapText(text, maxWidth, measure, lang = '') {
  const lines = [];

  // Each line break in the text starts a new paragraph.
  for (const paragraph of String(text ?? '').split(/\r?\n/)) {
    let line = '';
    for (const unit of splitUnits(paragraph, lang)) {
      const candidate = line === '' ? unit.text : line + unit.gap + unit.text;
      // An empty line always takes its first piece, even if it is too wide.
      if (line === '' || measure(candidate) <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = unit.text;
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
 * Wrap a text at one font size and say whether it fits.
 * It fits when it has at most maxLines lines, no line is wider than the box (so no word is too
 * wide) and the lines are not higher than the box.
 * @param {object} options
 *   text, boxW, boxH, lang
 *   measureAt   (s, size) => width of string s at that font size
 *   size        font size in pixels
 *   lineHeight  line height as a multiple of the size (default 1.15)
 *   maxLines    most lines allowed (default: any number)
 * @returns {{lines:string[], fits:boolean}}
 */
export function layoutAt({ text, boxW, boxH, measureAt, size, lang = '', lineHeight = 1.15, maxLines = Infinity }) {
  const lines = wrapText(text, boxW, (s) => measureAt(s, size), lang);
  const widest = lines.reduce((most, line) => Math.max(most, measureAt(line, size)), 0);
  const fits = lines.length <= maxLines && widest <= boxW + 0.5 && textHeight(lines.length, size, lineHeight) <= boxH;
  return { lines, fits };
}

/**
 * The largest whole font size at which the text fits (see layoutAt).
 * @returns {number} the size, or 0 when it does not fit even at minSize
 */
export function maxFitSize({ text, boxW, boxH, measureAt, lang = '', lineHeight = 1.15, maxLines = Infinity, minSize = 6, maxSize }) {
  const fitsAt = (size) => layoutAt({ text, boxW, boxH, measureAt, size, lang, lineHeight, maxLines }).fits;
  if (!fitsAt(minSize)) return 0;

  // Binary search: the biggest whole-number size that still fits.
  let low = minSize;
  let high = Math.max(minSize, Math.floor(maxSize ?? boxH));
  let best = minSize;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (fitsAt(middle)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
}

/**
 * Find the largest font size at which the wrapped text fits inside the box.
 * @param {object} options
 *   text        the text to write
 *   boxW, boxH  box size in pixels
 *   measureAt   (s, size) => width of string s at that font size
 *   lang        BCP-47 code of the text (decides where a line may break)
 *   minSize     smallest allowed size (default 6)
 *   maxSize     largest allowed size (default: the box height)
 *   lineHeight  line height as a multiple of the size (default 1.15)
 *   scale       multiplier from the A- / A+ buttons (default 1 = Auto)
 * @returns {{size:number, lines:string[], lineHeight:number, fits:boolean}}
 *   size is in pixels; fits is false when even the smallest size overflows
 *   (or when scale made the text bigger than the box).
 */
export function fitText({ text, boxW, boxH, measureAt, lang = '', minSize = 6, maxSize, lineHeight = 1.15, scale = 1 }) {
  const best = maxFitSize({ text, boxW, boxH, measureAt, lang, lineHeight, minSize, maxSize }) || minSize;

  // Apply the user's A- / A+ scale on top of the auto-fit size.
  const size = scale === 1 ? best : Math.max(minSize, Math.round(best * scale));
  const { lines, fits } = layoutAt({ text, boxW, boxH, measureAt, size, lang, lineHeight });
  return { size, lines, lineHeight, fits };
}

// ---------------------------------------------------------------------------
// An answer written inside its box (Spirit Clerk: "Fill the original form")
// ---------------------------------------------------------------------------

/**
 * Size and lines of ONE answer written inside its (empty) answer box.
 * The size is the largest whole size at which the answer fits (at most maxSize), never below
 * minSize. Words are never split: a line breaks only between words, and a word that is wider
 * than the box stays whole (then fits is false). A- / A+ change the size afterwards (scale).
 * @param {object} options
 *   text        the answer
 *   boxW, boxH  size of the area the text may use, in pixels
 *   measureAt   (s, size) => width of string s at that size
 *   maxSize     largest size (default: the box height)
 *   minSize     smallest size (default 6)
 *   lineHeight  line height as a multiple of the size (default 1.15)
 *   scale       multiplier from the A- / A+ buttons (1 = Auto)
 * @returns {{size:number, lines:string[], fits:boolean, auto:number}}
 *   auto = the size before scale was applied
 */
export function fitAnswer({ text, boxW, boxH, measureAt, maxSize, minSize = 6, lineHeight = 1.15, scale = 1 }) {
  const cap = Math.max(minSize, Math.floor(Math.min(maxSize ?? boxH, boxH)));
  // 0 means "does not fit even at the smallest size": use the smallest size anyway.
  const auto = maxFitSize({ text, boxW, boxH, measureAt, lineHeight, minSize, maxSize: cap }) || minSize;
  const size = scale === 1 ? auto : Math.max(minSize, Math.round(auto * scale));
  const { lines, fits } = layoutAt({ text, boxW, boxH, measureAt, size, lineHeight });
  return { size, lines, fits, auto };
}

// ---------------------------------------------------------------------------
// One font size per group of similar lines
// ---------------------------------------------------------------------------

// Lines whose original text height differs by at most this share are one group.
export const GROUP_TOLERANCE = 0.15;
// The new text is never smaller than this share of the original text height (when there is any way to avoid it).
export const MIN_SIZE_SHARE = 0.7;

/**
 * Put lines of similar height into groups. Heights are sorted; a new group starts when a height
 * is more than 15% bigger than the smallest height of the current group.
 * @param {number[]} heights
 * @returns {number[]} for every input a group number (0, 1, 2, ...; the smallest heights are group 0)
 */
export function groupByHeight(heights, tolerance = GROUP_TOLERANCE) {
  const order = heights.map((height, index) => index).sort((a, b) => heights[a] - heights[b]);
  const groups = new Array(heights.length);
  let group = -1;
  let groupMin = 0;
  for (const index of order) {
    if (group === -1 || heights[index] > groupMin * (1 + tolerance)) {
      group += 1;
      groupMin = heights[index];
    }
    groups[index] = group;
  }
  return groups;
}

/**
 * How high the letters of the original text were and how many lines it had, worked out from
 * its box and its characters (see estimateOriginalSize). One line: the height of the box.
 * Several lines: the height of one line (the first line needs the size, each further line 1.15 more).
 * @returns {{height:number, lines:number}}  height is 0 only when the box has no height
 */
export function describeOriginal(rect, text) {
  const estimate = estimateOriginalSize(rect, text);
  if (estimate <= 0) return { height: rect.h, lines: 1 };
  const lines = Math.max(1, Math.round(rect.h / (1.15 * estimate)));
  return { height: rect.h / (1 + (lines - 1) * 1.15), lines };
}

// Middle value of a list of numbers.
function middleValue(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Decide the text, the number of lines and the font size of every block of a page at once, so
 * that lines that had the same size in the original get the same size in the translation.
 *
 * For every block there are four ways to write it, tried in this order: the full translation on
 * as many lines as the original had, the short version on the same number of lines, the full
 * translation on ONE MORE line, the short version on one more line. The first way that reaches
 * 70% of the original text height wins; if none does, the way that gives the biggest size is used.
 * Blocks in one group (original heights within 15%) then share ONE size: the smallest size any
 * of them needs. A block that cannot reach 70% at all does not drag its group down.
 * The size never exceeds the (middle) original text height of the group.
 *
 * @param {object} options
 *   items       [{ text, short, originalHeight, originalLines, boxW, boxH }] in any order
 *   measureAt   (s, size) => width of s at that size
 *   lang        BCP-47 code of the translation
 *   scale       A- / A+ multiplier (1 = auto). It is applied after the sizes are decided.
 *   minSize     absolute smallest font size (default 6)
 *   lineHeight  default 1.15
 * @returns {{text:string, usedShort:boolean, lines:string[], size:number, lineHeight:number,
 *            fits:boolean, group:number, belowMinimum:boolean}[]}  one result per item, same order
 */
export function planTextLayout({ items, measureAt, lang = '', scale = 1, minSize = 6, lineHeight = 1.15 }) {
  const groups = groupByHeight(items.map((item) => item.originalHeight));

  // The biggest size a group may use: the middle original height of its members.
  const caps = new Map();
  for (const group of new Set(groups)) {
    const heights = items.filter((_, i) => groups[i] === group).map((item) => item.originalHeight);
    caps.set(group, Math.max(minSize, Math.round(middleValue(heights))));
  }

  // Step 1: for every block find the way to write it and the biggest size that works.
  const plans = items.map((item, index) => {
    const cap = caps.get(groups[index]);
    const wanted = Math.min(cap, Math.max(minSize, Math.ceil(MIN_SIZE_SHARE * item.originalHeight)));
    const baseLines = Math.max(1, item.originalLines || 1);

    const ways = [];
    const add = (text, maxLines, usedShort) => {
      if (text && !ways.some((way) => way.text === text && way.maxLines === maxLines)) ways.push({ text, maxLines, usedShort });
    };
    add(item.text, baseLines, false);
    add(item.short, baseLines, true);
    add(item.text, baseLines + 1, false);
    add(item.short, baseLines + 1, true);

    for (const way of ways) {
      way.best = maxFitSize({ text: way.text, boxW: item.boxW, boxH: item.boxH, measureAt, lang, lineHeight, maxLines: way.maxLines, minSize, maxSize: cap });
    }
    const good = ways.find((way) => way.best >= wanted);
    const chosen = good ?? ways.reduce((a, b) => (b.best > a.best ? b : a));
    return { item, ways, chosen, good: Boolean(good), best: chosen.best || minSize };
  });

  // Step 2: one size per group (the smallest size a block that reaches 70% needs).
  const groupSize = new Map();
  plans.forEach((plan, index) => {
    if (!plan.good) return;
    const group = groups[index];
    groupSize.set(group, Math.min(groupSize.get(group) ?? Infinity, plan.best));
  });

  // Step 3: lay every block out at its size, using the first way that fits there.
  return plans.map((plan, index) => {
    const group = groups[index];
    const shared = groupSize.get(group);
    const size = shared === undefined ? plan.best : Math.min(plan.best, shared);
    const { item } = plan;

    let way = plan.ways.find((candidate) =>
      layoutAt({ text: candidate.text, boxW: item.boxW, boxH: item.boxH, measureAt, size, lang, lineHeight, maxLines: candidate.maxLines }).fits
    );
    if (!way) way = plan.chosen;

    // The A- / A+ scale changes the size afterwards; the text may then use more lines.
    const finalSize = scale === 1 ? size : Math.max(minSize, Math.round(size * scale));
    const { lines, fits } = layoutAt({
      text: way.text, boxW: item.boxW, boxH: item.boxH, measureAt, size: finalSize, lang, lineHeight,
      maxLines: scale === 1 ? way.maxLines : Infinity,
    });
    const wanted = Math.min(caps.get(group), Math.max(minSize, Math.ceil(MIN_SIZE_SHARE * item.originalHeight)));
    return { text: way.text, usedShort: way.usedShort, lines, size: finalSize, lineHeight, fits, group, belowMinimum: size < wanted };
  });
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

// The text colour must have at least this contrast with the background (7 is the strict
// "AAA" level: it keeps small text solid and dark).
export const MIN_CONTRAST = 7;

// A grey (no real colour): its three channels are almost equal.
function isNeutral({ r, g, b }) {
  return Math.max(r, g, b) - Math.min(r, g, b) < 40;
}

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
 * Choose the colour for the new text: the colour of the original text if it is a real colour
 * (not a grey) that stands out strongly from the background (contrast 7 or more), otherwise
 * pure black or pure white. The result is always fully opaque.
 * @param {{r:number,g:number,b:number}|null} darkest  from sampleDarkest
 * @param {{r:number,g:number,b:number}} background
 * @returns {string} a CSS colour that is fully opaque
 */
export function chooseTextColor(darkest, background) {
  // A real colour (blue, red...) with strong contrast is kept. Greys are NOT kept: small text
  // sampled from anti-aliased letters comes out grey and faint, so it becomes solid black or white.
  if (darkest && !isNeutral(darkest) && contrastRatio(darkest, background) >= MIN_CONTRAST) return rgbToCss(darkest);
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

/**
 * Should the pixels of a block be left exactly as they are?
 * Yes when the translation equals the original AND that is allowed:
 *   - for a language written with Latin letters (Spanish, French...) any equal text may stay
 *     (names, numbers, codes are the same in both languages);
 *   - for any other language ONLY e-mail addresses, links, numbers, dates and ID codes may stay.
 *     A name such as "John" must be written in the target script, so an unchanged "John"
 *     is still drawn again (and counted as a leftover English word).
 * @param {string} original
 * @param {string} translation
 * @param {string} [lang]  BCP-47 code of the translation; empty = treat as a Latin-script language
 */
export function leaveUntouched(original, translation, lang = '') {
  if (!isSameText(original, translation)) return false;
  return !lang || isLatinScriptLang(lang) || isKeepAsIs(original);
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

// ---------------------------------------------------------------------------
// Pixel scans: leftover ink around a cover, and free space next to a box
// ---------------------------------------------------------------------------
// All of these read RGBA pixels ({ data, width, height }) and never touch the DOM.

// A pixel counts as "not plain background" when its colour differs from the background
// by at least this much (distance in RGB, 0 to 441).
export const INK_DISTANCE = 40;

// Straight distance between two colours.
export function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * The colour of the original letters: the average of the 5% of pixels inside the box
 * that differ MOST from the background. (Unlike sampleDarkest this also works for light
 * letters on a dark bar.)
 * @returns {{r:number,g:number,b:number}|null}  null if nothing in the box differs from the background
 */
export function sampleInkColor(image, rect, background) {
  const { data, width, height } = image;
  const pixels = [];

  const endX = Math.min(width, rect.x + rect.w);
  const endY = Math.min(height, rect.y + rect.h);
  for (let py = Math.max(0, rect.y); py < endY; py++) {
    for (let px = Math.max(0, rect.x); px < endX; px++) {
      const i = (py * width + px) * 4;
      if (data[i + 3] < 128) continue;
      const color = { r: data[i], g: data[i + 1], b: data[i + 2] };
      pixels.push({ ...color, d: colorDistance(color, background) });
    }
  }
  if (pixels.length === 0) return null;

  pixels.sort((a, b) => b.d - a.d);
  const take = pixels.slice(0, Math.max(1, Math.floor(pixels.length * 0.05)));
  const mean = (key) => Math.round(take.reduce((sum, p) => sum + p[key], 0) / take.length);
  const ink = { r: mean('r'), g: mean('g'), b: mean('b') };
  return colorDistance(ink, background) >= INK_DISTANCE ? ink : null;
}

// Build a function (r, g, b, a) => true for pixels that are "ink": clearly different from the
// background AND closer to the ink colour than the background is (so they look like the letters,
// including their half-blended edges). Without a usable ink colour, "clearly different" is enough.
function makeInkTest(background, ink) {
  const inkToBackground = ink ? colorDistance(ink, background) : 0;
  const useInk = inkToBackground >= INK_DISTANCE;
  return (r, g, b, a) => {
    if (a < 128) return false;
    if (Math.hypot(r - background.r, g - background.g, b - background.b) < INK_DISTANCE) return false;
    return !useInk || Math.hypot(r - ink.r, g - ink.g, b - ink.b) < inkToBackground;
  };
}

// Any pixel that is not plain background (ink, a border, a picture...).
function makeNotPlainTest(background) {
  return (r, g, b, a) => a >= 128 && Math.hypot(r - background.r, g - background.g, b - background.b) >= INK_DISTANCE;
}

// How many pixels in the area [x0, x1) x [y0, y1) pass the test (the area is cut to the image).
function countPixels(image, x0, y0, x1, y1, test) {
  const { data, width, height } = image;
  let count = 0;
  for (let py = Math.max(0, y0); py < Math.min(height, y1); py++) {
    for (let px = Math.max(0, x0); px < Math.min(width, x1); px++) {
      const i = (py * width + px) * 4;
      if (test(data[i], data[i + 1], data[i + 2], data[i + 3])) count += 1;
    }
  }
  return count;
}

// Do two rectangles { x, y, w, h } share any area?
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Does a thin strip contain a long straight line (a form border)? A line fills most of one
 * row (for a strip above or below) or one column (for a strip on the left or right) AND goes on
 * beyond the end of the strip. A small piece of a letter does neither.
 * @param {{x:number,y:number,w:number,h:number}} strip
 * @param {boolean} horizontal  true: look along rows; false: look along columns
 */
export function stripHasLine(image, strip, test, horizontal) {
  const { x, y, w, h } = strip;
  const length = horizontal ? w : h;
  if (length < 6) return false;

  const lines = horizontal ? h : w; // number of rows (or columns) in the strip
  for (let k = 0; k < lines; k++) {
    const along = horizontal
      ? [x, y + k, x + w, y + k + 1]
      : [x + k, y, x + k + 1, y + h];
    if (countPixels(image, ...along, test) < 0.6 * length) continue;

    // Does the line continue past either end of the strip?
    const before = horizontal
      ? countPixels(image, x - 3, y + k, x, y + k + 1, test)
      : countPixels(image, x + k, y - 3, x + k + 1, y, test);
    const after = horizontal
      ? countPixels(image, x + w, y + k, x + w + 3, y + k + 1, test)
      : countPixels(image, x + k, y + h, x + k + 1, y + h + 3, test);
    if (before >= 2 || after >= 2) return true;
  }
  return false;
}

// The thin strip just outside one side of a cover, or null when the limit is reached.
function nextStrip(side, c, step, limit) {
  if (side === 'left') {
    const w = Math.min(step, c.left - limit.left);
    return w > 0 ? { x: c.left - w, y: c.top, w, h: c.bottom - c.top } : null;
  }
  if (side === 'right') {
    const w = Math.min(step, limit.right - c.right);
    return w > 0 ? { x: c.right, y: c.top, w, h: c.bottom - c.top } : null;
  }
  if (side === 'top') {
    const h = Math.min(step, c.top - limit.top);
    return h > 0 ? { x: c.left, y: c.top - h, w: c.right - c.left, h } : null;
  }
  const h = Math.min(step, limit.bottom - c.bottom);
  return h > 0 ? { x: c.left, y: c.bottom, w: c.right - c.left, h } : null;
}

// The cover may grow sideways by this many box heights (counted from the box). A line that Gemini
// cut short can have a whole word left over, which is more than one or two letters.
const SIDE_GROWTH = 2.5;
// How far (in box heights) we look past a clean ring for more letters of the same line.
const GAP_LOOKAHEAD = 0.8;

// Is there ink in the window of `distance` pixels beyond the left or right side of the cover,
// without a border line in it and without touching another block? (See growCover.)
function inkAhead(side, c, distance, limit, image, isInk, avoid) {
  const span = side === 'left' ? c.left - limit.left : limit.right - c.right;
  const w = Math.min(distance, span);
  if (w <= 0) return false;

  const window = {
    x: side === 'left' ? c.left - w : c.right,
    y: c.top,
    w,
    h: c.bottom - c.top,
  };
  if (avoid.some((box) => overlaps(window, box))) return false;
  if (countPixels(image, window.x, window.y, window.x + window.w, window.y + window.h, isInk) < 1) return false;
  return !stripHasLine(image, window, isInk, false);
}

/**
 * Make a block's box a little smaller on every side. Gemini's boxes of neighbouring blocks often
 * overlap by a few pixels, and a cover must not stop at such an overlap.
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function insetRect(rect, amount) {
  const dx = Math.min(amount, Math.floor((rect.w - 1) / 2));
  const dy = Math.min(amount, Math.floor((rect.h - 1) / 2));
  return { x: rect.x + dx, y: rect.y + dy, w: rect.w - 2 * dx, h: rect.h - 2 * dy };
}

// A row of the box counts as a ruled line (not text) when ink fills this share of it ...
const LINE_ROW_SHARE = 0.85;
// ... and a column counts as a border or a divider of a comb box when ink fills this share of it.
const LINE_COLUMN_SHARE = 0.95;

/**
 * Is there already something written or printed inside an empty answer box? Used before the
 * answers are written on the original form, so a new answer is never drawn on top of old text.
 * The edge of the box is skipped (its border), the background colour is the median colour inside,
 * and long straight lines (the line to write on, solid or made of dashes, dots or underscores; the
 * borders and dividers of the box) are not counted. What is left is ink: letters, digits, stamps.
 * @param {{data: Uint8ClampedArray|number[], width:number, height:number}} image  RGBA pixels
 * @param {{x:number, y:number, w:number, h:number}} rect  the answer box in pixels
 * @param {{inset?:number}} [options]  pixels to skip on every side (default: 20% of the box height, at least 2)
 * @returns {boolean}
 */
export function boxHasInk(image, rect, { inset } = {}) {
  const { data, width, height } = image;
  const pad = inset ?? Math.max(2, Math.round(rect.h * 0.2));
  const x0 = Math.max(0, rect.x + pad);
  const y0 = Math.max(0, rect.y + pad);
  const x1 = Math.min(width, rect.x + rect.w - pad);
  const y1 = Math.min(height, rect.y + rect.h - pad);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 4 || h < 3) return false; // too small to hold anything

  // The background: the middle colour of all the pixels inside (most of them are background).
  const reds = [];
  const greens = [];
  const blues = [];
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * width + px) * 4;
      if (data[i + 3] < 128) continue;
      reds.push(data[i]);
      greens.push(data[i + 1]);
      blues.push(data[i + 2]);
    }
  }
  if (reds.length === 0) return false;
  const background = { r: median(reds), g: median(greens), b: median(blues) };

  // Which pixels differ clearly from the background?
  const mask = new Uint8Array(w * h);
  const columnCount = new Array(w).fill(0);
  for (let row = 0; row < h; row++) {
    for (let column = 0; column < w; column++) {
      const i = ((y0 + row) * width + (x0 + column)) * 4;
      if (data[i + 3] < 128) continue;
      const pixel = { r: data[i], g: data[i + 1], b: data[i + 2] };
      if (colorDistance(pixel, background) >= INK_DISTANCE) {
        mask[row * w + column] = 1;
        columnCount[column] += 1;
      }
    }
  }

  // Rows that belong to a line to write on: a solid line, or a thin line of dashes, dots or underscores.
  const ruled = ruledRows(mask, w, h, maxLineThickness(rect.h));

  // Count the ink that is not part of a long straight line.
  let ink = 0;
  for (let row = 0; row < h; row++) {
    if (ruled.rows[row]) continue; // a line to write on
    for (let column = 0; column < w; column++) {
      if (mask[row * w + column] !== 1 || columnCount[column] >= LINE_COLUMN_SHARE * h) continue;
      // The soft edge of a dashed line (the row just above or below it, under its marks) is not ink.
      if (ruled.edge[row] && ruled.edgeColumns[row][column]) continue;
      ink += 1;
    }
  }
  return ink >= Math.max(8, Math.round(0.002 * w * h));
}

// ---------------------------------------------------------------------------
// Lines to write on: solid, dashed, dotted, underscores
// ---------------------------------------------------------------------------

// A row of repeated short marks (dashes, dots, underscores) is a line when it has at least this many marks ...
const DASH_MIN_MARKS = 5;
// ... they reach across at least this share of the row ...
const DASH_SPAN_SHARE = 0.6;
// ... each mark is at most this share of the row long ...
const DASH_MAX_MARK_SHARE = 0.12;
// ... and at most this share of the marks and gaps may be much shorter or longer than the usual one.
const DASH_ODD_SHARE = 0.15;

// A line of dashes or dots is thin: at most this share of the box height (and at least 4 pixels).
function maxLineThickness(boxHeight) {
  return Math.max(4, Math.round(boxHeight * 0.15));
}

// The runs of ink in one row: [{start, end}] (end not included).
function rowRuns(row) {
  const runs = [];
  for (let i = 0; i < row.length; ) {
    if (!row[i]) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < row.length && row[end]) end += 1;
    runs.push({ start: i, end });
    i = end;
  }
  return runs;
}

// Are (nearly) all the numbers about the same as the usual one (from half of it to twice it)?
function mostlyRegular(values) {
  if (values.length === 0) return true;
  const typical = median([...values]);
  const odd = values.filter((v) => v > 2 * typical + 2 || 2 * v + 2 < typical).length;
  return odd <= Math.max(1, Math.floor(values.length * DASH_ODD_SHARE));
}

/**
 * Is one row of pixels a ruled line? Either solid (ink almost all along it) or a row of repeated
 * short marks: dashes "- - - -", dots ". . . .", underscores "____" (with tiny gaps).
 * @param {ArrayLike<number>} row  1 = ink, 0 = background, one entry per pixel
 * @returns {'solid'|'dashed'|null}
 */
export function rowIsRuled(row) {
  const w = row.length;
  if (w === 0) return null;
  let count = 0;
  for (let i = 0; i < w; i++) if (row[i]) count += 1;
  if (count >= LINE_ROW_SHARE * w) return 'solid';

  const runs = rowRuns(row);
  if (runs.length < DASH_MIN_MARKS) return null;
  if (runs[runs.length - 1].end - runs[0].start < DASH_SPAN_SHARE * w) return null;
  const lengths = runs.map((run) => run.end - run.start);
  const gaps = runs.slice(1).map((run, i) => run.start - runs[i].end);
  if (median([...lengths]) > Math.max(4, DASH_MAX_MARK_SHARE * w)) return null; // long marks are words, not dashes
  // The first and the last mark may be cut by the edge of the box: only the marks between are compared.
  return mostlyRegular(lengths.slice(1, -1)) && mostlyRegular(gaps) ? 'dashed' : null;
}

/**
 * Which rows of an ink mask are lines to write on? Solid rows always count. Rows of repeated
 * marks count only in a thin band (a few rows): a word written in even letters is many rows high.
 * The rows just above and below a dashed band are its soft edge: there only the columns under
 * the marks are skipped.
 * @param {Uint8Array|number[]} mask  w * h entries, 1 = ink
 * @param {number} w
 * @param {number} h
 * @param {number} maxThickness  the most rows a dashed line may have
 * @returns {{rows:boolean[], edge:boolean[], edgeColumns:(Uint8Array|null)[], bands:{top:number, bottom:number}[]}}
 *   bands = every line, top and bottom row (bottom included), from top to bottom
 */
export function ruledRows(mask, w, h, maxThickness) {
  const kinds = [];
  for (let row = 0; row < h; row++) kinds.push(rowIsRuled(mask.slice(row * w, row * w + w)));

  const rows = new Array(h).fill(false);
  const edge = new Array(h).fill(false);
  const edgeColumns = new Array(h).fill(null);
  const bands = [];

  for (let row = 0; row < h; ) {
    if (kinds[row] === null) {
      row += 1;
      continue;
    }
    let end = row;
    while (end < h && kinds[end] !== null) end += 1;
    const solid = kinds.slice(row, end).every((kind) => kind === 'solid');
    if (solid || end - row <= maxThickness) {
      for (let r = row; r < end; r++) rows[r] = true;
      bands.push({ top: row, bottom: end - 1 });
      // The columns that are ink anywhere in the band: its soft edge above and below stays under them.
      const columns = new Uint8Array(w);
      for (let r = row; r < end; r++) {
        for (let c = 0; c < w; c++) if (mask[r * w + c]) columns[c] = 1;
      }
      for (const r of [row - 1, end]) {
        if (r < 0 || r >= h || rows[r]) continue;
        edge[r] = true;
        edgeColumns[r] = columns;
      }
    }
    row = end;
  }
  return { rows, edge, edgeColumns, bands };
}

/**
 * The line to write on inside (or just below) an answer box, if there is one. A box with a line
 * at its top AND one at its bottom is a closed box: then null (the answer is centred in it).
 * @param {{data: Uint8ClampedArray|number[], width:number, height:number}} image  RGBA pixels
 * @param {{x:number, y:number, w:number, h:number}} rect  the answer box in pixels
 * @returns {{top:number, bottom:number} | null}  the line's top and bottom row in page pixels
 */
export function findWritingLine(image, rect) {
  const { data, width, height } = image;
  const side = Math.max(2, Math.round(rect.w * 0.04)); // skip the side borders of a box
  const x0 = Math.max(0, rect.x + side);
  const x1 = Math.min(width, rect.x + rect.w - side);
  const y0 = Math.max(0, rect.y);
  const y1 = Math.min(height, Math.round(rect.y + rect.h * 1.25)); // the line is often just below the box
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 10 || h < 4) return null;

  // The background: the middle colour of the area.
  const reds = [];
  const greens = [];
  const blues = [];
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * width + px) * 4;
      if (data[i + 3] < 128) continue;
      reds.push(data[i]);
      greens.push(data[i + 1]);
      blues.push(data[i + 2]);
    }
  }
  if (reds.length === 0) return null;
  const background = { r: median(reds), g: median(greens), b: median(blues) };

  const mask = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    for (let column = 0; column < w; column++) {
      const i = ((y0 + row) * width + (x0 + column)) * 4;
      if (data[i + 3] >= 128 && colorDistance({ r: data[i], g: data[i + 1], b: data[i + 2] }, background) >= INK_DISTANCE) {
        mask[row * w + column] = 1;
      }
    }
  }

  const { bands } = ruledRows(mask, w, h, maxLineThickness(rect.h));
  const upper = bands.filter((band) => band.bottom < rect.h * 0.3);
  const lower = bands.filter((band) => band.top >= rect.h * 0.35);
  if (lower.length === 0 || upper.length > 0) return null; // no line, or a closed box
  const line = lower[lower.length - 1]; // the lowest line
  return { top: y0 + line.top, bottom: y0 + line.bottom };
}

// The space between the lowest point of the letters and the line, as a share of the text size.
// The letters' descent (g, p, y) is about 0.25 of the size; the gap is on top of that.
export const DESCENT_SHARE = 0.25;
export const LINE_GAP_PX = 3;

/**
 * Where the lines of an answer go when it is written ABOVE a line (never on it): the baseline
 * (alphabetic) of each line, the last line just above the line to write on.
 * @param {{lineTop:number, size:number, lineCount:number, lineHeight:number}} options
 * @returns {number[]}  the baseline y of each line, from top to bottom
 */
export function baselinesAboveLine({ lineTop, size, lineCount, lineHeight }) {
  const lastBaseline = lineTop - LINE_GAP_PX - Math.ceil(size * DESCENT_SHARE);
  return Array.from({ length: lineCount }, (_, i) => lastBaseline - (lineCount - 1 - i) * size * lineHeight);
}

// A column of the middle band counts as a divider of a comb box when ink fills this share of it.
const COMB_LINE_SHARE = 0.9;

/**
 * Is an answer box divided into character cells (a "comb" box: one little box for each letter or
 * digit, as for PAN, IFSC, dates and numbers)? The cells are found from the vertical dividers: thin
 * columns of ink that cross the middle of the box, about the same distance apart.
 * @param {{data: Uint8ClampedArray|number[], width:number, height:number}} image  RGBA pixels
 * @param {{x:number, y:number, w:number, h:number}} rect  the answer box in pixels
 * @returns {{x:number, y:number, w:number, h:number}[] | null}  the cells from left to right (4 or more), or null
 */
export function detectCombCells(image, rect) {
  const { data, width, height } = image;
  const x0 = Math.max(0, rect.x);
  const x1 = Math.min(width, rect.x + rect.w);
  const top = Math.max(0, Math.round(rect.y + rect.h * 0.3));
  const bottom = Math.min(height, Math.round(rect.y + rect.h * 0.7));
  const bandH = bottom - top;
  const w = x1 - x0;
  if (w < 40 || bandH < 4) return null;

  // The background of the band: the middle colour.
  const reds = [];
  const greens = [];
  const blues = [];
  for (let py = top; py < bottom; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (py * width + px) * 4;
      if (data[i + 3] < 128) continue;
      reds.push(data[i]);
      greens.push(data[i + 1]);
      blues.push(data[i + 2]);
    }
  }
  if (reds.length === 0) return null;
  const background = { r: median(reds), g: median(greens), b: median(blues) };

  // Which columns are ink from the top to the bottom of the band?
  const isLine = new Array(w).fill(false);
  for (let column = 0; column < w; column++) {
    let ink = 0;
    for (let py = top; py < bottom; py++) {
      const i = (py * width + (x0 + column)) * 4;
      if (data[i + 3] >= 128 && colorDistance({ r: data[i], g: data[i + 1], b: data[i + 2] }, background) >= INK_DISTANCE) ink += 1;
    }
    isLine[column] = ink >= COMB_LINE_SHARE * bandH;
  }

  // Neighbouring line columns are one divider; its position is the middle.
  const lines = [];
  for (let column = 0; column < w; ) {
    if (!isLine[column]) {
      column += 1;
      continue;
    }
    let end = column;
    while (end < w && isLine[end]) end += 1;
    if (end - column <= Math.max(6, bandH)) lines.push(x0 + (column + end - 1) / 2); // a wide block is a picture, not a divider
    column = end;
  }
  if (lines.length < 3) return null;

  // The dividers must be about the same distance apart.
  const gaps = lines.slice(1).map((line, i) => line - lines[i]);
  const typical = median([...gaps]);
  if (typical < 6) return null;
  if (!gaps.every((gap) => gap >= 0.6 * typical && gap <= 1.4 * typical)) return null;

  // The first and the last cell may reach to the edge of the box (its border is not a divider we see).
  const boundaries = [...lines];
  if (lines[0] - x0 >= 0.6 * typical) boundaries.unshift(x0);
  if (x1 - lines[lines.length - 1] >= 0.6 * typical) boundaries.push(x1);
  const cells = boundaries.slice(1).map((edge, i) => ({ x: boundaries[i], y: rect.y, w: edge - boundaries[i], h: rect.h }));
  return cells.length >= 4 ? cells : null;
}

/**
 * Which character goes into which cell of a comb box.
 *   - as many characters as cells: one each
 *   - without spaces, dashes and slashes as many as cells: one each
 *   - a date DD/MM/YYYY in a comb of 10 cells with a printed separator after the day and the month:
 *     the separator cells stay empty
 *   - a code, number, phone number or date with FEWER characters than cells: written from the left
 * Otherwise the answer is not written cell by cell (null): it does not fit the comb.
 * @param {string} text  the answer
 * @param {number} cellCount
 * @param {string} [kind]  the kind of the field
 * @returns {string[] | null}  one entry per cell ('' = empty cell)
 */
export function layoutComb(text, cellCount, kind = 'text') {
  const all = Array.from(String(text ?? '').replace(/\s+/gu, ''));
  if (cellCount < 1 || all.length === 0) return null;
  const letters = all.filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (letters.length === 0) return null;

  if (kind === 'date' && cellCount === 10 && letters.length === 8) {
    return [letters[0], letters[1], '', letters[2], letters[3], '', letters[4], letters[5], letters[6], letters[7]];
  }
  if (letters.length === cellCount) return letters;
  if (all.length === cellCount) return all;
  if (['code', 'number', 'phone', 'date'].includes(kind) && letters.length < cellCount) {
    return [...letters, ...new Array(cellCount - letters.length).fill('')];
  }
  return null;
}

/**
 * Grow a cover until no ink of the original letters is left just outside it.
 * Each side grows on its own, a few pixels at a time, while a thin strip outside it still
 * holds ink (pixels like the original text, clearly different from the background).
 * On the left and right it also looks 0.8 x the box height past a clean ring, so letters behind a
 * gap (the space between two words) are reached too.
 * A side stops when the strip is clean, or when it would
 *   - grow more than 2.5 x the box height sideways, or 0.5 x up and down (counted from the box),
 *   - leave the image,
 *   - run into a long straight line (a form border), or
 *   - run into the box of another block (`avoid`).
 * @param {object} options
 *   image       RGBA pixels { data, width, height }
 *   rect        the box in pixels
 *   cover       the first cover (see coverRect)
 *   background  background colour around the box
 *   ink         colour of the original letters (sampleInkColor) or null
 *   avoid       boxes of the OTHER blocks that must not be covered
 *   step        growth per step in pixels (default 2)
 * @returns {{x:number, y:number, w:number, h:number}} the grown cover (never smaller than `cover`)
 */
export function growCover({ image, rect, cover, background, ink = null, avoid = [], step = 2 }) {
  const isInk = makeInkTest(background, ink);
  const maxSide = Math.round(rect.h * SIDE_GROWTH);
  const maxVertical = Math.round(rect.h * 0.5);
  // How far past a clean ring we look for more letters (the space between two words is smaller).
  const lookAhead = Math.max(4, Math.round(rect.h * GAP_LOOKAHEAD));

  const limit = {
    left: Math.max(0, rect.x - maxSide),
    right: Math.min(image.width, rect.x + rect.w + maxSide),
    top: Math.max(0, rect.y - maxVertical),
    bottom: Math.min(image.height, rect.y + rect.h + maxVertical),
  };
  const c = { left: cover.x, top: cover.y, right: cover.x + cover.w, bottom: cover.y + cover.h };
  const stopped = { left: false, right: false, top: false, bottom: false };

  // Every round tries one step on every side that is still allowed to grow.
  for (let round = 0; round < 500; round++) {
    let grew = false;

    for (const side of ['left', 'right', 'top', 'bottom']) {
      if (stopped[side]) continue;

      const strip = nextStrip(side, c, step, limit);
      if (!strip || avoid.some((box) => overlaps(strip, box))) {
        stopped[side] = true; // limit, image edge or another block
        continue;
      }

      const inkCount = countPixels(image, strip.x, strip.y, strip.x + strip.w, strip.y + strip.h, isInk);
      if (inkCount < 1) {
        // The ring is clean. On the left and right there may still be letters BEHIND a gap (the
        // box from Gemini sometimes ends before the last word, e.g. before "AM"): look a little
        // further. If there are letters (and no border and no other block) in that window, cross
        // the gap with the next step. Otherwise this side is done for now.
        if ((side === 'left' || side === 'right') && inkAhead(side, c, lookAhead, limit, image, isInk, avoid)) {
          if (side === 'left') c.left = strip.x;
          else c.right = strip.x + strip.w;
          grew = true;
        }
        continue;
      }

      if (stripHasLine(image, strip, isInk, side === 'top' || side === 'bottom')) {
        stopped[side] = true; // a border: never cover it
        continue;
      }

      if (side === 'left') c.left = strip.x;
      else if (side === 'right') c.right = strip.x + strip.w;
      else if (side === 'top') c.top = strip.y;
      else c.bottom = strip.y + strip.h;
      grew = true;
    }

    if (!grew) break;
  }

  return { x: c.left, y: c.top, w: c.right - c.left, h: c.bottom - c.top };
}

/**
 * How much plain background (no ink, no border, no picture) lies next to a cover, in the
 * direction the text continues. Used to give the translation more room than its narrow box.
 * Stops at anything that is not plain, at another block's box and at the image edge.
 * @param {object} options
 *   image, cover, background, avoid  as for growCover
 *   direction  'right' (left-to-right text) or 'left' (Arabic, Urdu); 'up' and 'down' look above
 *              and below the rectangle (used to give a second line room)
 *   maxExtra   most pixels to look at
 * @returns {number}  free pixels (0 or more)
 */
export function findFreeWidth({ image, cover, background, avoid = [], direction = 'right', maxExtra, step = 2 }) {
  const notPlain = makeNotPlainTest(background);
  let extra = 0;

  while (extra < maxExtra) {
    const n = Math.min(step, maxExtra - extra); // thickness of this strip
    let strip;
    if (direction === 'right') strip = { x: cover.x + cover.w + extra, y: cover.y, w: n, h: cover.h };
    else if (direction === 'left') strip = { x: cover.x - extra - n, y: cover.y, w: n, h: cover.h };
    else if (direction === 'down') strip = { x: cover.x, y: cover.y + cover.h + extra, w: cover.w, h: n };
    else strip = { x: cover.x, y: cover.y - extra - n, w: cover.w, h: n }; // 'up'

    if (strip.x < 0 || strip.y < 0 || strip.x + strip.w > image.width || strip.y + strip.h > image.height) break;
    if (avoid.some((box) => overlaps(strip, box))) break;
    if (countPixels(image, strip.x, strip.y, strip.x + strip.w, strip.y + strip.h, notPlain) > 0) break;
    extra += n;
  }
  return extra;
}

// The same scan in all four directions ('left', 'right', 'up', 'down'). `cover` is any rectangle.
export const findFreeSpace = findFreeWidth;

/**
 * The area the translation may use: the cover, plus the free space found next to it in the
 * direction of the text, but never wider than maxWidth.
 * @param {object} options
 *   rect, cover  the box and its cover
 *   freeLeft, freeRight  free pixels beside the cover (findFreeWidth)
 *   freeUp, freeDown     free pixels above and below the cover
 *   rtl          true for right-to-left languages
 *   maxWidth     widest the area may be (default 2 x the width of the original box). The free
 *                space was already measured up to the page margin, so form-overlay.js passes the
 *                page width here: the text may use all the plain background beside it.
 * @returns {{left:number, right:number, top:number, bottom:number}}
 */
export function textArea({ rect, cover, freeLeft = 0, freeRight = 0, freeUp = 0, freeDown = 0, rtl = false, maxWidth = rect.w * 2 }) {
  // Plain space above and below may be used too (for a second line), at most half a box height each.
  const maxVertical = Math.round(rect.h * 0.5);
  const top = cover.y - Math.min(freeUp, maxVertical);
  const bottom = cover.y + cover.h + Math.min(freeDown, maxVertical);

  if (!rtl) {
    const coverRight = cover.x + cover.w;
    return { left: rect.x, right: Math.max(coverRight, Math.min(coverRight + freeRight, rect.x + maxWidth)), top, bottom };
  }
  const right = rect.x + rect.w;
  return { left: Math.min(cover.x, Math.max(cover.x - freeLeft, right - maxWidth)), right, top, bottom };
}

// ---------------------------------------------------------------------------
// Size of the original text
// ---------------------------------------------------------------------------

/**
 * Estimate the font size of the ORIGINAL text from its box and its characters: a Latin letter
 * is about half as wide as the font is high, and lines are about 1.15 high, so
 * width x height = 0.575 x characters x size^2. (For one line this is close to the box height.)
 * @returns {number} size in pixels, or 0 when the text is unknown
 */
export function estimateOriginalSize(rect, text) {
  const count = Array.from(String(text ?? '').trim()).length;
  if (count === 0) return 0;
  return Math.sqrt((rect.w * rect.h) / (0.575 * count));
}
