// server/routes/extract-fields.js
// POST /api/extract-fields
// Reads a form (PDF or image) with Gemini and returns its fields plus a
// short spoken question for each one, written in the user's language.
// In the same call it also finds, for each field, the empty space where the answer is written
// (answerBox) and the page it is on, so the answers can be written on the original form.

import { Router } from 'express';
import { parseAnswerBox, parseOptions, ANSWER_BOX_KEYS, PAGE_KEYS } from './answer-box-parser.js';
import { resolveFormat } from '../../skeleton/field-formats.js';

// File types we accept in the old body (one file, base64).
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
// Page images we accept in the new body (a PDF is turned into images in the browser).
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// At most this many page images in one request.
export const MAX_IMAGES = 5;


/**
 * Check the request body and turn it into the parts to send to Gemini.
 * Two shapes are accepted:
 *   { images: [{ mimeType, data }], lang }          1 to 5 page images, in page order
 *   { fileBase64, mimeType, lang }                  one file (the old shape)
 * @returns {{ inlineParts: object[], pageCount: number } | null}  null = invalid input
 */
export function readUpload(body) {
  const { images, fileBase64, mimeType } = body ?? {};

  if (images !== undefined) {
    if (!Array.isArray(images) || images.length === 0 || images.length > MAX_IMAGES) return null;
    const inlineParts = [];
    for (const image of images) {
      const ok =
        image !== null &&
        typeof image === 'object' &&
        IMAGE_MIME_TYPES.includes(image.mimeType) &&
        typeof image.data === 'string' &&
        image.data.trim() !== '';
      if (!ok) return null;
      inlineParts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }
    return { inlineParts, pageCount: inlineParts.length };
  }

  const hasFile = typeof fileBase64 === 'string' && fileBase64.trim() !== '';
  if (!hasFile || !ALLOWED_MIME_TYPES.includes(mimeType)) return null;
  return { inlineParts: [{ inlineData: { mimeType, data: fileBase64 } }], pageCount: 1 };
}

/**
 * Factory: receives callGemini so tests can pass a fake function.
 * @param {Function} callGemini - async ({ prompt, inlineParts }) => object
 * @returns {import('express').Router}
 */
export function createExtractFieldsRouter(callGemini) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { lang } = req.body ?? {};

    // 1. Validate the input.
    const upload = readUpload(req.body);
    if (!upload) {
      return res.status(400).json({ error: 'invalid_input' });
    }
    const { inlineParts, pageCount } = upload;

    // 2. Build the prompt.
    const prompt =
      'You are given a form (a PDF or a photo). ' +
      (pageCount > 1
        ? `It comes as ${pageCount} page images, in page order. `
        : '') +
      'Identify ALL form fields in document order (top-to-bottom, left-to-right). ' +
      'For each field, write a short, friendly question that can be spoken aloud, ' +
      `in the language with BCP-47 code "${lang}", even if the form itself is in another language. ` +
      'Also, for each field write "help": one short, simple sentence that explains what the field means, ' +
      'with a small example, in the same language as the question ' +
      `(BCP-47 code "${lang}"), even if the form is in another language. ` +
      'For example, "IFSC code" means the bank branch code printed on your cheque book, like SBIN0001234; ' +
      '"DOB" means your date of birth, like 15 August 1990. ' +
      'Also, for each field give "kind": what the field holds. Use exactly one of: ' +
      '"name" for ANY person\'s name (first name, last name, surname, full name, father\'s name, mother\'s name, spouse name, nominee name, etc.), ' +
      '"text" for short free text (a city, an occupation, a reason), "address" for an address (street, area, city, state, PIN), ' +
      '"date" for dates, "number" for numbers made only of digits (Aadhaar, account number, PIN code, amounts), ' +
      '"phone" for a phone or mobile number, "email" for an email address, ' +
      '"code" for identification codes made of letters and digits, such as PAN, IFSC, GSTIN, passport, driving licence, voter ID, ' +
      'vehicle registration, policy or reference numbers, ' +
      '"choice" for a field where one option must be picked from a list (for example gender or marital status), ' +
      '"checkbox" for a tick box or yes / no question, and "signature" for a signature, a thumb impression or a "sign here" space. ' +
      'For "code", "number" and "phone" fields also give "pattern" when the exact format is known: one character for each ' +
      'character of the answer, where A means a letter, 9 means a digit, X means a letter or a digit, and a digit from 0 to 8 ' +
      'means exactly that digit. For example PAN is AAAAA9999A, IFSC is AAAA0XXXXXX, Aadhaar is 999999999999, ' +
      'an Indian mobile number is 9999999999, a PIN code is 999999. Give "" when the format is not known. ' +      'Also, for each field give "answerBox": the EMPTY space where the answer is written on the form: ' +
      'the input box, the line to write on, or the free space right after the label. ' +
      'Do NOT include the printed label in it. It is a FLAT list of exactly 4 whole numbers [ymin, xmin, ymax, xmax] ' +
      'on a scale from 0 to 1000 for BOTH axes, whatever the size of the image: y runs from 0 (top edge) to 1000 (bottom edge), ' +
      'x runs from 0 (left edge) to 1000 (right edge). Do NOT use pixels, do NOT use values from 0 to 1, ' +
      'do NOT put the list inside another list, and do NOT use an object. ' +
      'For a "checkbox" field the answerBox is the small tick box itself; for a "signature" field it is the empty space to sign in. ' +
      'If a field has no such empty space, set "answerBox" to null. ' +
      'And give "page": the 0-based number of the image the field is on (0 for the first image). ' +
      'For a "choice" field also give "options": a list with one item for EACH option printed on the form, ' +
      '{ "label": the words of the option as printed, "box": the small box, circle or bracket to tick for that option ' +
      '(NOT its words), in the same format as "answerBox" (or null if the option has no such box) }. ' +
      'Use an empty list for fields that are not "choice" fields. ' +
      'Reply with JSON only, in this shape: ' +
      '{ "fields": [ { "label": string, "inputType": "text" | "date" | "checkbox" | "selection", "kind": "name" | "text" | "address" | "date" | "number" | "phone" | "email" | "code" | "choice" | "checkbox" | "signature", "pattern": string, "options": [ { "label": string, "box": [ymin, xmin, ymax, xmax] | null } ], "question": string, "help": string, "answerBox": [ymin, xmin, ymax, xmax] | null, "page": number } ] }';

    // 3. Call Gemini and map errors to HTTP statuses.
    try {
      const result = await callGemini({ prompt, inlineParts });
      const rawFields = Array.isArray(result?.fields) ? result.fields : [];

      // Normalise: skip non-objects; help is a trimmed string or "" (never fails);
      // answerBox is a clean box or null, page is a whole number.
      const counts = {};
      const fields = rawFields
        .filter((f) => f !== null && typeof f === 'object' && !Array.isArray(f))
        .map((f) => {
          const placed = parseAnswerBox(f, pageCount);
          const format = resolveFormat(f);
          counts[placed.status] = (counts[placed.status] ?? 0) + 1;

          // Copy the field without the different names a model may use for the box and page.
          const clean = { ...f };
          for (const key of [...ANSWER_BOX_KEYS, ...PAGE_KEYS]) delete clean[key];

          return {
            ...clean,
            help: typeof f.help === 'string' ? f.help.trim() : '',
            // kind is one of the known kinds and pattern a usable character pattern (or ''): the label
            // can add the built-in patterns (PAN, IFSC, Aadhaar, mobile, PIN) without asking Gemini.
            kind: format.kind,
            pattern: format.pattern,
            // the options with their boxes to tick (only a choice field has them)
            options: format.kind === 'choice' ? parseOptions(f.options) : [],
            answerBox: placed.answerBox,
            page: placed.page,
          };
        });

      // Counts only, never the content of the form.
      const reasons = Object.entries(counts)
        .filter(([status]) => status !== 'ok')
        .map(([status, n]) => `${status}=${n}`)
        .join(' ');
      console.log(`[extract-fields] pages=${pageCount} fields=${fields.length} withBox=${counts.ok ?? 0}${reasons ? ` ${reasons}` : ''}`);

      return res.json({ fields });
    } catch (err) {
      if (err?.code === 'timeout') return res.status(504).json({ error: 'timeout' });
      if (err?.code === 'rate_limit') return res.status(429).json({ error: 'busy' });
      return res.status(502).json({ error: 'gemini_error' });
    }
  });

  return router;
}
