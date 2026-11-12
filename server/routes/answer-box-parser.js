// server/routes/answer-box-parser.js
// Reads the "answerBox" and "page" of one form field in Gemini's reply for /api/extract-fields.
//
// answerBox = the empty space where the answer is written, as [ymin, xmin, ymax, xmax] on a
// 0 to 1000 scale. Like layout-parser.js, this file accepts the different shapes models use
// (other key names, a box nested one level deeper, an object, numbers as text, a 0 to 1 scale).
// A field WITHOUT a usable box is fine: it just gets answerBox: null.
// No DOM, no Express, no Gemini here, so it is easy to unit test.

import { readBox } from './layout-parser.js';

// Names a model may use for the answer box (the first one is the one we ask for).
export const ANSWER_BOX_KEYS = [
  'answerBox', 'answer_box', 'answerbox', 'answer_box_2d', 'answerBox2d',
  'input_box', 'inputBox', 'answer_area', 'answerArea',
  // the names used for text boxes
  'box_2d', 'box2d', 'box', 'bbox',
];
// Names a model may use for the page number.
export const PAGE_KEYS = ['page', 'page_index', 'pageIndex', 'page_number', 'pageNumber'];

// A box smaller than this (on the 0 to 1000 scale) is not a place where anyone can write.
export const MIN_BOX_WIDTH = 10;
export const MIN_BOX_HEIGHT = 4;

// A number, or text that is a number ("2", " 1 "), otherwise NaN.
function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

// First key of `names` that exists on `item`.
function firstKey(item, names) {
  return names.find((name) => item[name] !== undefined && item[name] !== null);
}

/**
 * Read the answer box and the page of one field.
 * Never throws.
 * @param {unknown} item       one field of Gemini's reply
 * @param {number} pageCount   how many page images were sent (at least 1)
 * @returns {{answerBox: number[]|null, page: number, status: string}}
 *   page is always a whole number (0 when unknown); status says why there is no box:
 *   'ok', 'no_box', 'bad_box', 'too_small', 'bad_page' (used for log counts only)
 */
export function parseAnswerBox(item, pageCount = 1) {
  const pages = Math.max(1, Math.floor(Number(pageCount) || 1));
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return { answerBox: null, page: 0, status: 'no_box' };
  }

  // 1. The page. With one image the page is 0 even when it is missing.
  const pageKey = firstKey(item, PAGE_KEYS);
  let page = 0;
  let pageOk = true;
  if (pageKey === undefined) {
    pageOk = pages === 1;
  } else {
    const number = toNumber(item[pageKey]);
    if (Number.isInteger(number) && number >= 0 && number < pages) page = number;
    else pageOk = false;
  }

  // 2. The box.
  const result = readBox(item, ANSWER_BOX_KEYS);
  if (result.error) {
    return { answerBox: null, page, status: result.error === 'missing_box' ? 'no_box' : 'bad_box' };
  }
  const [ymin, xmin, ymax, xmax] = result.box;
  if (xmax - xmin < MIN_BOX_WIDTH || ymax - ymin < MIN_BOX_HEIGHT) {
    return { answerBox: null, page, status: 'too_small' };
  }
  if (!pageOk) return { answerBox: null, page, status: 'bad_page' };

  return { answerBox: result.box, page, status: 'ok' };
}

// ---------------------------------------------------------------------------
// Options of a choice field
// ---------------------------------------------------------------------------

// Names a model may use for the box to tick of an option.
export const OPTION_BOX_KEYS = ['box', 'box_2d', 'tick_box', 'tickBox', 'option_box', 'optionBox', 'checkbox', 'answerBox', 'answer_box', 'bbox'];
// Names a model may use for the words of an option.
const OPTION_LABEL_KEYS = ['label', 'text', 'name', 'option', 'value'];

// A field never has more options than this.
export const MAX_OPTIONS = 12;
// A tick box is small: it needs only this much (on the 0 to 1000 scale) to be usable.
export const MIN_OPTION_BOX = 3;
// An option box wider or higher than this is not a tick box (it is probably a whole block of text).
export const MAX_OPTION_BOX = 400;

/**
 * Read the options of a choice field: [{ label, box }] where box is the box to tick, or null.
 * Tolerant like parseAnswerBox: an option may be just a text, an object with other key names, a
 * box nested one level deeper, numbers as text... Options without words are dropped, repeats too.
 * Never throws.
 * @param {unknown} raw  the "options" of one field
 * @returns {{label:string, box:number[]|null}[]}
 */
export function parseOptions(raw) {
  if (!Array.isArray(raw)) return [];
  const options = [];
  const seen = new Set();

  for (const item of raw) {
    let label = '';
    let box = null;

    if (typeof item === 'string') {
      label = item;
    } else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      const key = OPTION_LABEL_KEYS.find((name) => typeof item[name] === 'string' && item[name].trim() !== '');
      label = key ? item[key] : '';
      const read = readBox(item, OPTION_BOX_KEYS);
      if (!read.error) {
        const [ymin, xmin, ymax, xmax] = read.box;
        const w = xmax - xmin;
        const h = ymax - ymin;
        if (w >= MIN_OPTION_BOX && h >= MIN_OPTION_BOX && w <= MAX_OPTION_BOX && h <= MAX_OPTION_BOX) box = read.box;
      }
    }

    label = label.trim().slice(0, 80);
    const id = label.toLowerCase();
    if (label === '' || seen.has(id)) continue;
    seen.add(id);
    options.push({ label, box });
    if (options.length >= MAX_OPTIONS) break;
  }
  return options;
}
