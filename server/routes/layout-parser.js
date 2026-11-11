// server/routes/layout-parser.js
// Turns Gemini's reply for /api/translate-layout into clean blocks.
//
// Different Gemini models answer in slightly different shapes, for example:
//   - box_2d nested one level deeper:  [[ymin, xmin, ymax, xmax]]   (gemini-3.5-flash-lite)
//   - box as an object:                { ymin, xmin, ymax, xmax }
//   - numbers as strings, or on a 0 to 1 scale instead of 0 to 1000
//   - other key names (bbox, translated_text, ...) or another name for the list
// This file accepts all of those, repairs them, and counts what it did, so the
// server can log (numbers only, never the text) how many blocks were kept or dropped and why.
// No DOM, no Express, no Gemini here, so it is easy to unit test.

// A page never has more text blocks than this; extra ones are dropped.
export const MAX_BLOCKS = 300;

// Names a model may use for the list of blocks (the first one is the one we ask for).
const LIST_KEYS = ['blocks', 'text_blocks', 'textBlocks', 'items', 'results', 'regions', 'elements', 'data'];
// Names a model may use for the box.
const BOX_KEYS = ['box_2d', 'box2d', 'box', 'bbox', 'bounding_box', 'boundingBox', 'bounding_box_2d', 'coordinates', 'coords'];
// Names a model may use for the translated text and for the original text.
const TRANSLATION_KEYS = ['translation', 'translated_text', 'translatedText', 'translated', 'translation_text'];
const TEXT_KEYS = ['text', 'original_text', 'originalText', 'original', 'source_text', 'source'];
// Ways a box can be written as an object: [ymin, xmin, ymax, xmax] key names.
const OBJECT_BOX_KEYS = [
  ['ymin', 'xmin', 'ymax', 'xmax'],
  ['y_min', 'x_min', 'y_max', 'x_max'],
  ['top', 'left', 'bottom', 'right'],
  ['y1', 'x1', 'y2', 'x2'],
];

// Keep a number between 0 and 1000 and make it a whole number.
function clampBox(value) {
  return Math.round(Math.min(1000, Math.max(0, value)));
}

// A number, or text that is a number ("12", " 3.5 "), otherwise NaN.
function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

// First key of `names` that exists on `item`.
function firstKey(item, names) {
  return names.find((name) => item[name] !== undefined && item[name] !== null);
}

// Make a short, safe label out of a key name (it is only used in log lines).
function safeLabel(text) {
  return String(text).replace(/[^\w.:-]/g, '').slice(0, 30);
}

/**
 * Find the list of blocks inside Gemini's reply.
 * @param {unknown} reply  the parsed JSON
 * @returns {{list: unknown[], via: string} | null}  via says where it was found
 */
export function findBlockList(reply) {
  if (Array.isArray(reply)) return { list: reply, via: 'top_level_array' };
  if (reply === null || typeof reply !== 'object') return null;

  for (const key of LIST_KEYS) {
    if (Array.isArray(reply[key])) return { list: reply[key], via: key === 'blocks' ? 'blocks' : `key:${key}` };
  }
  // Last chance: the only array in the object, whatever its name.
  const arrays = Object.entries(reply).filter(([, value]) => Array.isArray(value));
  if (arrays.length === 1) return { list: arrays[0][1], via: `key:${safeLabel(arrays[0][0])}` };
  return null;
}

/**
 * Read the box of one block.
 * @returns {{box: number[], fixes: string[]} | {error: string}}
 *   box is [ymin, xmin, ymax, xmax] as whole numbers 0..1000
 */
function readBox(item) {
  const fixes = [];

  const boxKey = firstKey(item, BOX_KEYS);
  if (boxKey === undefined) return { error: 'missing_box' };
  if (boxKey !== 'box_2d') fixes.push('box_key');

  let raw = item[boxKey];
  let numbers;

  if (Array.isArray(raw)) {
    // [[ymin, xmin, ymax, xmax]]  ->  [ymin, xmin, ymax, xmax]
    if (raw.length === 1 && Array.isArray(raw[0])) {
      raw = raw[0];
      fixes.push('nested_box');
    }
    if (raw.length !== 4) return { error: 'bad_box' };
    if (raw.some((n) => typeof n === 'string')) fixes.push('string_numbers');
    numbers = raw.map(toNumber);
  } else if (raw !== null && typeof raw === 'object') {
    // { ymin, xmin, ymax, xmax } and friends
    const keys = OBJECT_BOX_KEYS.find((names) => names.every((name) => raw[name] !== undefined));
    if (keys) {
      numbers = keys.map((name) => toNumber(raw[name]));
    } else if (raw.x !== undefined && raw.y !== undefined && (raw.width ?? raw.w) !== undefined && (raw.height ?? raw.h) !== undefined) {
      // { x, y, width, height }
      const x = toNumber(raw.x);
      const y = toNumber(raw.y);
      numbers = [y, x, y + toNumber(raw.height ?? raw.h), x + toNumber(raw.width ?? raw.w)];
    } else {
      return { error: 'bad_box' };
    }
    fixes.push('object_box');
  } else {
    return { error: 'bad_box' };
  }

  if (!numbers.every((n) => Number.isFinite(n))) return { error: 'bad_box' };

  // Values that all lie between 0 and 1 are on a 0 to 1 scale: multiply by 1000.
  if (numbers.every((n) => Math.abs(n) <= 1)) {
    numbers = numbers.map((n) => n * 1000);
    fixes.push('scale_0_1');
  }

  const box = numbers.map(clampBox);
  if (box[2] <= box[0] || box[3] <= box[1]) return { error: 'no_area' };
  return { box, fixes };
}

/**
 * Clean a list of blocks from Gemini.
 * @param {unknown} list
 * @returns {{blocks: {text:string, translation:string, box_2d:number[]}[], report: object}}
 *   report = { received, kept, dropped, reasons: {reason: count}, fixes: {fix: count} }
 */
export function normalizeBlocks(list) {
  const report = { received: 0, kept: 0, dropped: 0, reasons: {}, fixes: {} };
  const count = (group, name) => {
    report[group][name] = (report[group][name] ?? 0) + 1;
  };
  const drop = (reason) => {
    report.dropped += 1;
    count('reasons', reason);
  };

  const blocks = [];
  if (!Array.isArray(list)) return { blocks, report };
  report.received = list.length;

  for (const item of list) {
    if (blocks.length >= MAX_BLOCKS) {
      drop('too_many');
      continue;
    }
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      drop('not_an_object');
      continue;
    }

    // The translation must be real text.
    const translationKey = firstKey(item, TRANSLATION_KEYS);
    const translation = translationKey === undefined ? '' : item[translationKey];
    if (typeof translation !== 'string' || translation.trim() === '') {
      drop(translationKey === undefined ? 'missing_translation' : 'empty_translation');
      continue;
    }

    const result = readBox(item);
    if (result.error) {
      drop(result.error);
      continue;
    }

    const fixes = [...result.fixes];
    if (translationKey !== 'translation') fixes.push('translation_key');
    fixes.forEach((fix) => count('fixes', fix));

    const textKey = firstKey(item, TEXT_KEYS);
    blocks.push({
      text: textKey !== undefined && typeof item[textKey] === 'string' ? item[textKey].trim() : '',
      translation: translation.trim(),
      box_2d: result.box,
    });
  }

  report.kept = blocks.length;
  return { blocks, report };
}

/**
 * Clean Gemini's whole reply: find the list, then clean the blocks.
 * @returns {{blocks: object[], report: object} | null}  null when there is no list at all
 */
export function parseLayoutReply(reply) {
  const found = findBlockList(reply);
  if (!found) return null;

  const { blocks, report } = normalizeBlocks(found.list);
  if (found.via !== 'blocks') report.fixes[found.via] = 1;
  return { blocks, report };
}

/** One safe log line: numbers and reason names only, never any text from the form. */
export function describeReport(report) {
  return (
    `received=${report.received} kept=${report.kept} dropped=${report.dropped}` +
    ` reasons=${JSON.stringify(report.reasons)} fixes=${JSON.stringify(report.fixes)}`
  );
}
