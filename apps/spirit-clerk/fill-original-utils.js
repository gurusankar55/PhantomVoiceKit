// fill-original-utils.js
// Pure helper functions for "Fill the original form" (Spirit Clerk).
// No browser or DOM access here, so they are easy to test.

import { cleanLabel } from './form-utils.js';

// What is written when an answer has no English text (the same words the summary PDF uses).
export const MISSING_TRANSLATION = '(translation unavailable)';

/**
 * The English text of one answer, as written in the summary PDF and on the original form.
 * @param {{skipped?:boolean, englishMeaning?:string}|undefined} answer
 * @returns {string|null}  null for a skipped (or missing) answer: that field stays empty
 */
export function answerLine(answer) {
  if (!answer || answer.skipped) return null;
  const text = String(answer.englishMeaning ?? '').trim();
  return text !== '' ? text : MISSING_TRANSLATION;
}

/**
 * Is this a box we can write in? Four finite numbers on the 0 to 1000 scale
 * [ymin, xmin, ymax, xmax] that enclose an area.
 */
export function usableBox(box) {
  return (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000) &&
    box[2] > box[0] &&
    box[3] > box[1]
  );
}

/**
 * Sort the answers onto the pages of the form. Nothing is lost: every answered field is either
 * in the list of its page or in `unplaced`. A skipped field has no answer and stays empty.
 * @param {{label?:string, answerBox?:number[]|null, page?:number}[]} fields  in document order
 * @param {({skipped?:boolean, englishMeaning?:string}|undefined)[]} answers  one per field, same order
 * @param {number} pageCount  number of page images
 * @returns {{pages: {index:number, text:string, box:number[]}[][], unplaced: {index:number, label:string, text:string}[]}}
 *   pages[p] = answers to write on page p; unplaced = answered fields with no usable box or page
 */
export function placeAnswers(fields, answers, pageCount) {
  const pages = Array.from({ length: Math.max(0, Math.floor(Number(pageCount) || 0)) }, () => []);
  const unplaced = [];

  fields.forEach((field, index) => {
    const text = answerLine(answers[index]);
    if (text === null) return;

    const page = field.page;
    if (usableBox(field.answerBox) && Number.isInteger(page) && page >= 0 && page < pages.length) {
      pages[page].push({ index, label: cleanLabel(field.label), text, box: field.answerBox });
    } else {
      unplaced.push({ index, label: cleanLabel(field.label), text });
    }
  });

  return { pages, unplaced };
}

/**
 * Take the answers whose box already holds text off the pages and put them in `unplaced`
 * (so they are listed on the extra last page of the PDF instead of being written on top of old text).
 * @param {{pages: {index:number, label:string, text:string, box:number[]}[][], unplaced: object[]}} placement  from placeAnswers
 * @param {boolean[][]} occupied  occupied[page][i] is true when the i-th answer of that page has a filled box
 * @returns {{pages: object[][], unplaced: {index:number, label:string, text:string}[]}}  a new placement (the input is not changed)
 */
export function moveOccupied(placement, occupied) {
  const moved = [];
  const pages = placement.pages.map((page, p) =>
    page.filter((entry, i) => {
      if (!occupied[p] || !occupied[p][i]) return true;
      moved.push({ index: entry.index, label: entry.label, text: entry.text });
      return false;
    })
  );
  const unplaced = [...placement.unplaced, ...moved].sort((a, b) => a.index - b.index);
  return { pages, unplaced };
}

/**
 * How many answers were placed on the pages.
 * @param {{pages: unknown[][]}} placement  result of placeAnswers
 */
export function countPlaced(placement) {
  return placement.pages.reduce((sum, page) => sum + page.length, 0);
}

/**
 * File name of the filled original form: "{formName}_filled_{YYYY-MM-DD}.pdf".
 * @param {string} formName
 * @param {Date} date
 */
export function filledPdfFilename(formName, date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${formName}_filled_${date.getFullYear()}-${month}-${day}.pdf`;
}
