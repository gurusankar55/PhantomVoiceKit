// fill-original-utils.js
// Pure helper functions for "Fill the original form" and the review screen (Spirit Clerk).
// No browser or DOM access here, so they are easy to test.

import { cleanLabel } from './form-utils.js';
import { findOption } from './option-utils.js';

// What is written when an answer has no English text (the same words the summary PDF uses).
export const MISSING_TRANSLATION = '(translation unavailable)';

// What the summary and the PDF say for a signature that was drawn.
export const SIGNATURE_TEXT = '(signature)';

/**
 * The English text of one answer, as written in the summary PDF and on the original form.
 * @param {{skipped?:boolean, englishMeaning?:string, signatureImage?:string}|undefined} answer
 * @returns {string|null}  null for a skipped (or missing) answer: that field stays empty
 */
export function answerLine(answer) {
  if (!answer || answer.skipped) return null;
  if (answer.signatureImage) return SIGNATURE_TEXT;
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
 * in the list of its page, or in `unplaced`, or (a tick box answered "No") has nothing to draw.
 * What is drawn depends on the field:
 *   - text      the answer written in the answer box
 *   - tick      a tick mark in the box of the chosen option (choice) or in the tick box (checkbox "Yes")
 *   - image     the drawn signature, scaled to fit the signature box
 * A choice whose option has no box falls back to writing the text in the answer box.
 * A skipped field has no answer and stays empty.
 * @param {{label?:string, kind?:string, options?:{label:string, box:number[]|null}[], answerBox?:number[]|null, page?:number}[]} fields  in document order
 * @param {({skipped?:boolean, englishMeaning?:string, signatureImage?:string}|undefined)[]} answers  one per field, same order
 * @param {number} pageCount  number of page images
 * @returns {{pages: {index:number, label:string, type:'text'|'tick'|'image', text:string, box:number[], kind?:string, image?:string}[][],
 *   unplaced: {index:number, label:string, text:string, image?:string}[]}}
 */
export function placeAnswers(fields, answers, pageCount) {
  const pages = Array.from({ length: Math.max(0, Math.floor(Number(pageCount) || 0)) }, () => []);
  const unplaced = [];

  fields.forEach((field, index) => {
    const answer = answers[index];
    const text = answerLine(answer);
    if (text === null) return;

    const label = cleanLabel(field.label);
    const page = field.page;
    const pageFits = Number.isInteger(page) && page >= 0 && page < pages.length;
    const place = (type, box, extra = {}) => pages[page].push({ index, label, type, text, box, ...extra });
    const leave = () => {
      unplaced.push({ index, label, text, ...(answer.signatureImage ? { image: answer.signatureImage } : {}) });
    };

    // A drawn signature goes into the signature box, or to the list.
    if (answer.signatureImage) {
      if (pageFits && usableBox(field.answerBox)) place('image', field.answerBox, { image: answer.signatureImage });
      else leave();
      return;
    }

    if (field.kind === 'checkbox') {
      const value = text.toLowerCase();
      if (value === 'no') return; // not ticked: there is nothing to draw
      if (value === 'yes' && pageFits && usableBox(field.answerBox)) {
        place('tick', field.answerBox);
        return;
      }
    } else if (field.kind === 'choice') {
      const option = findOption(field.options, text);
      if (option && pageFits && usableBox(option.box)) {
        place('tick', option.box);
        return;
      }
    }

    if (pageFits && usableBox(field.answerBox)) place('text', field.answerBox, { kind: field.kind });
    else leave();
  });

  return { pages, unplaced };
}

/**
 * Take the answers whose box already holds text off the pages and put them in `unplaced`
 * (so they are listed on the extra last page of the PDF instead of being written on top of old text).
 * @param {{pages: object[][], unplaced: object[]}} placement  from placeAnswers
 * @param {boolean[][]} occupied  occupied[page][i] is true when the i-th entry of that page has a filled box
 * @returns {{pages: object[][], unplaced: object[]}}  a new placement (the input is not changed)
 */
export function moveOccupied(placement, occupied) {
  const moved = [];
  const pages = placement.pages.map((page, p) =>
    page.filter((entry, i) => {
      if (!occupied[p] || !occupied[p][i]) return true;
      moved.push({ index: entry.index, label: entry.label, text: entry.text, ...(entry.image ? { image: entry.image } : {}) });
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

/**
 * The rows of the review screen: every field with its answer.
 *   status 'answered'   text = the answer
 *          'signature'  image = the drawn signature (a picture)
 *          'signLater'  the user will sign by hand after printing
 *          'skipped'    no answer
 * @param {{label?:string}[]} fields
 * @param {({skipped?:boolean, englishMeaning?:string, signatureImage?:string, signatureLater?:boolean}|undefined)[]} answers
 * @returns {{index:number, label:string, status:'answered'|'signature'|'signLater'|'skipped', text:string, image:string}[]}
 */
export function reviewRows(fields, answers) {
  return fields.map((field, index) => {
    const answer = answers[index];
    const label = cleanLabel(field.label);
    if (answer && answer.signatureImage) return { index, label, status: 'signature', text: '', image: answer.signatureImage };
    if (!answer || answer.skipped) {
      return { index, label, status: answer && answer.signatureLater ? 'signLater' : 'skipped', text: '', image: '' };
    }
    return { index, label, status: 'answered', text: String(answer.englishMeaning ?? '').trim() || MISSING_TRANSLATION, image: '' };
  });
}
