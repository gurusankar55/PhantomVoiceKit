// field-formats.js
// Pure rules about the FORMAT of form fields: the kind of a field, the character patterns of codes
// (PAN, IFSC...), validators (e-mail, date, pattern) and the cell logic of the one-box-per-character
// editor. Shared by the server (extract-fields) and the browser (Spirit Clerk). No DOM access.
//
// Kinds: name, text, address, date, number, phone, email, code, choice, checkbox, signature.
//
// A pattern says what each character of a code or number must be:
//   A = a letter    9 = a digit    X = a letter or a digit    0-8 = that exact digit (a fixed character)
//   PAN AAAAA9999A   IFSC AAAA0XXXXXX   Aadhaar 999999999999   Indian mobile 9999999999   PIN 999999

export const FIELD_KINDS = ['name', 'text', 'address', 'date', 'number', 'phone', 'email', 'code', 'choice', 'checkbox', 'signature'];

// Kinds that can have a character pattern.
export const PATTERN_KINDS = ['code', 'number', 'phone'];

// Patterns that are known without asking Gemini.
export const BUILTIN_PATTERNS = {
  pan: 'AAAAA9999A',
  ifsc: 'AAAA0XXXXXX',
  aadhaar: '999999999999',
  mobile: '9999999999',
  pin: '999999',
};

// Dates are always written like this.
export const DATE_FORMAT = 'DD/MM/YYYY';

// ---------------------------------------------------------------------------
// Kind and pattern of a field
// ---------------------------------------------------------------------------

/**
 * Make sure a kind is one of FIELD_KINDS. Old and unknown kinds are repaired.
 * @param {unknown} kind       the kind Gemini gave
 * @param {unknown} [inputType] "text" | "date" | "checkbox" | "selection" (used when the kind is missing or generic)
 * @returns {string}
 */
export function normalizeKind(kind, inputType) {
  const value = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  const input = typeof inputType === 'string' ? inputType.trim().toLowerCase() : '';

  if (FIELD_KINDS.includes(value) && value !== 'text') return value;
  if (['selection', 'select', 'dropdown', 'radio', 'option', 'options'].includes(value)) return 'choice';
  if (['phone number', 'mobile', 'telephone'].includes(value)) return 'phone';
  if (['signature', 'sign'].includes(value)) return 'signature';

  // A missing or generic kind: use what the input looks like.
  if (input === 'checkbox') return 'checkbox';
  if (input === 'selection') return 'choice';
  if (input === 'date') return 'date';
  return 'text';
}

/**
 * Is this a pattern we can use? Only A, 9, X and the fixed digits 0-8, 2 to 40 characters,
 * with at least one character that has to be filled in.
 * @param {unknown} pattern
 */
export function isValidPattern(pattern) {
  return typeof pattern === 'string' && /^[A9X0-8]{2,40}$/.test(pattern) && /[A9X]/.test(pattern);
}

// Words in a label that mean "this is a signature" (it is never asked by voice).
const SIGNATURE_LABEL = /signature|signed by|sign here|\bsign\b|thumb\s*impression|left thumb|right thumb/i;

/**
 * A pattern we know from the label alone.
 * @param {string} label
 * @returns {{id:string, pattern:string, kind:string} | null}
 */
export function detectBuiltin(label) {
  const text = String(label ?? '');
  if (/\bPAN\b/.test(text) || /permanent\s+account/i.test(text)) return { id: 'pan', pattern: BUILTIN_PATTERNS.pan, kind: 'code' };
  if (/\bifsc\b/i.test(text)) return { id: 'ifsc', pattern: BUILTIN_PATTERNS.ifsc, kind: 'code' };
  if (/aadhaar|aadhar|adhaar|\buid(ai)?\b/i.test(text)) return { id: 'aadhaar', pattern: BUILTIN_PATTERNS.aadhaar, kind: 'number' };
  if (/mobile|\bcell\b|phone|telephone|whatsapp|contact\s*(no|number|num)\b/i.test(text)) {
    return { id: 'mobile', pattern: BUILTIN_PATTERNS.mobile, kind: 'phone' };
  }
  if (!/address/i.test(text) && (/\bpin\s*-?\s*code\b|\bpincode\b|postal\s*code|\bzip\b/i.test(text) || /^\s*pin\s*[:.]?\s*$/i.test(text))) {
    return { id: 'pin', pattern: BUILTIN_PATTERNS.pin, kind: 'number' };
  }
  return null;
}

/**
 * The final kind and pattern of a field, from what Gemini said and the label.
 *   - a signature label always makes a signature field
 *   - a label like "PAN", "IFSC", "Aadhaar", "Mobile" or "PIN code" gets its built-in pattern
 *     (a valid pattern from Gemini is kept instead of the built-in one)
 *   - a phone field without a pattern gets the 10 digit Indian mobile pattern
 *   - only code, number and phone fields keep a pattern
 * @param {{label?:string, kind?:unknown, inputType?:unknown, pattern?:unknown}} field
 * @returns {{kind:string, pattern:string}}
 */
export function resolveFormat(field) {
  const label = String(field?.label ?? '');
  let kind = normalizeKind(field?.kind, field?.inputType);
  let pattern = isValidPattern(field?.pattern) ? field.pattern : '';

  if (kind === 'text' && SIGNATURE_LABEL.test(label)) kind = 'signature';

  // A label that names an address is an address, whatever else it mentions ("Address and phone").
  const builtin = /address/i.test(label) ? null : detectBuiltin(label);
  if (builtin && ['text', 'number', 'phone', 'code'].includes(kind)) {
    kind = builtin.kind;
    if (pattern === '') pattern = builtin.pattern;
  }

  if (kind === 'phone' && pattern === '') pattern = BUILTIN_PATTERNS.mobile;
  if (!PATTERN_KINDS.includes(kind)) pattern = '';
  return { kind, pattern };
}

// ---------------------------------------------------------------------------
// Cells: one box per character
// ---------------------------------------------------------------------------

/**
 * Turn a pattern into cells.
 * @param {string} pattern
 * @returns {{type:'letter'|'digit'|'any'|'literal', char?:string}[]}  [] for an invalid pattern
 */
export function parsePattern(pattern) {
  if (!isValidPattern(pattern)) return [];
  return Array.from(pattern, (c) => {
    if (c === 'A') return { type: 'letter' };
    if (c === '9') return { type: 'digit' };
    if (c === 'X') return { type: 'any' };
    return { type: 'literal', char: c };
  });
}

// The longest group of characters that is asked at once.
export const MAX_CHUNK = 6;

// Cut `length` into equal-ish parts of at most MAX_CHUNK: 12 -> [6, 6], 10 -> [5, 5], 4 -> [4].
function splitEvenly(length) {
  const parts = Math.ceil(length / MAX_CHUNK);
  const sizes = [];
  let left = length;
  for (let i = parts; i > 0; i--) {
    const size = Math.ceil(left / i);
    sizes.push(size);
    left -= size;
  }
  return sizes;
}

/**
 * The groups a pattern is asked in: runs of the same kind of cell, fixed characters left out.
 * A code that mixes letters and digits is asked group by group (PAN -> 5 letters, 4 digits,
 * 1 letter; IFSC -> 4 letters, 6 letters or digits), long runs cut into equal parts of at most 6.
 * A pattern with one kind of cell only (phone, PIN, Aadhaar: all digits) is ONE group: the whole
 * number is said in one turn.
 * @param {{type:string}[]} cells
 * @returns {{type:'letters'|'digits'|'any', start:number, length:number}[]}  start = index of the first cell
 */
export function chunksOf(cells) {
  const names = { letter: 'letters', digit: 'digits', any: 'any' };
  // A number made only of digits (phone, PIN, Aadhaar) is said in ONE turn, not cut into parts.
  // Only a code that mixes letters and digits (PAN, IFSC) is asked group by group.
  const mixed = new Set(cells.filter((cell) => cell.type !== 'literal').map((cell) => cell.type)).size > 1;
  const chunks = [];
  let i = 0;
  while (i < cells.length) {
    if (cells[i].type === 'literal') {
      i += 1;
      continue;
    }
    const type = cells[i].type;
    let end = i;
    while (end < cells.length && cells[end].type === type) end += 1;
    let start = i;
    for (const size of mixed ? splitEvenly(end - i) : [end - i]) {
      chunks.push({ type: names[type], start, length: size });
      start += size;
    }
    i = end;
  }
  return chunks;
}

/** Empty values for a pattern: '' for every cell the user fills in, the fixed character for the others. */
export function emptyValues(cells) {
  return cells.map((cell) => (cell.type === 'literal' ? cell.char : ''));
}

/** The values joined into the answer text. */
export function valuesToString(values) {
  return values.join('');
}

// Keep only A-Z and 0-9, in capitals.
function alnumUpper(text) {
  return String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Put a text (a typed or earlier answer) into cells. A text as long as the pattern goes cell by
 * cell; any other text fills the cells the user fills in, one after the other.
 * @returns {string[]}
 */
export function stringToValues(text, cells) {
  const chars = Array.from(alnumUpper(text));
  const values = emptyValues(cells);
  if (chars.length === cells.length) {
    return cells.map((cell, i) => (cell.type === 'literal' ? cell.char : chars[i]));
  }
  let next = 0;
  cells.forEach((cell, i) => {
    if (cell.type !== 'literal' && next < chars.length) {
      values[i] = chars[next];
      next += 1;
    }
  });
  return values;
}

/**
 * The state of each cell: 'literal' (fixed), 'empty', 'ok', or 'bad' (a digit in a letter box or a
 * letter in a digit box: it turns red).
 */
export function cellStates(values, cells) {
  return cells.map((cell, i) => {
    if (cell.type === 'literal') return 'literal';
    const value = values[i] ?? '';
    if (value === '') return 'empty';
    if (cell.type === 'letter') return /^[A-Z]$/.test(value) ? 'ok' : 'bad';
    if (cell.type === 'digit') return /^[0-9]$/.test(value) ? 'ok' : 'bad';
    return /^[A-Z0-9]$/.test(value) ? 'ok' : 'bad';
  });
}

/** Is every cell filled with a character of the right kind? */
export function isPatternComplete(values, cells) {
  return cells.length > 0 && cellStates(values, cells).every((state) => state === 'ok' || state === 'literal');
}

/**
 * Put characters into the cells one after the other, starting at cell `startIndex`. Fixed cells
 * are skipped, and characters that do not fit are dropped. A character of the wrong kind IS
 * placed (and shows red), so the user sees what was heard.
 * @returns {{values:string[], used:number}}  used = how many characters were placed
 */
export function fillFrom(values, cells, startIndex, chars) {
  const result = [...values];
  const list = Array.from(alnumUpper(chars));
  let used = 0;
  for (let i = Math.max(0, startIndex); i < cells.length && used < list.length; i++) {
    if (cells[i].type === 'literal') continue;
    result[i] = list[used];
    used += 1;
  }
  return { values: result, used };
}

/** Put one character into one cell (ignored for a fixed cell). */
export function setCell(values, cells, index, char) {
  if (index < 0 || index >= cells.length || cells[index].type === 'literal') return [...values];
  const next = [...values];
  next[index] = alnumUpper(char).slice(0, 1);
  return next;
}

/**
 * The next group to ask: the first one that still has an empty cell. If part of the group is
 * already filled, only the rest is asked (from the first empty cell to the end of the group).
 * Null when every cell is filled.
 * @returns {{type:string, start:number, length:number} | null}
 */
export function chunkToAsk(values, cells, chunks) {
  for (const chunk of chunks) {
    const end = chunk.start + chunk.length;
    for (let i = chunk.start; i < end; i++) {
      if (cells[i].type !== 'literal' && (values[i] ?? '') === '') return { type: chunk.type, start: i, length: end - i };
    }
  }
  return null;
}

/**
 * Where a group is in the list: 'only', 'first', 'next' or 'last' (used for "First: ...", "Now: ...", "Last: ...").
 * A group that was cut short by chunkToAsk counts as the group it belongs to.
 */
export function chunkPosition(chunks, chunk) {
  const index = chunks.findIndex((c) => chunk.start >= c.start && chunk.start < c.start + c.length);
  if (chunks.length <= 1 || index < 0) return 'only';
  if (index === 0) return 'first';
  if (index === chunks.length - 1) return 'last';
  return 'next';
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * A usable e-mail address: one @, a name before it, a domain with a dot and a 2+ letter ending,
 * no spaces and no two dots in a row.
 */
export function isValidEmail(email) {
  const value = String(email ?? '');
  if (value.length > 254 || /\s/.test(value) || value.includes('..')) return false;
  return /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i.test(value) && !/\.@/.test(value);
}

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

/** Is this a real day, month and year? */
export function isRealDate(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (![d, m, y].every(Number.isInteger) || y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

/** "03/06/1990" from the parts (no check). */
export function formatDate(day, month, year) {
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${String(year).padStart(4, '0')}`;
}

/**
 * Read a date written as day, month, year with / - . or spaces between. The year needs 4 digits.
 * @returns {{day:number, month:number, year:number} | null}  null when it is not a real date
 */
export function parseDateString(text) {
  const match = /^\s*(\d{1,2})\s*[/\-.\s]\s*(\d{1,2})\s*[/\-.\s]\s*(\d{4})\s*$/.exec(String(text ?? ''));
  if (!match) return null;
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return isRealDate(day, month, year) ? { day, month, year } : null;
}

/** Is it a real date written exactly as DD/MM/YYYY? */
export function isValidDate(text) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(String(text ?? '')) && parseDateString(text) !== null;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Read a date said or written in English: "3 6 1990", "03/06/1990", "3 June 1990", "June 3rd, 1990".
 * Day first for numbers (as on Indian forms). Returns null when it is not clear.
 * @returns {string | null}  DD/MM/YYYY
 */
export function parseSpokenDate(text) {
  const clean = String(text ?? '').toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/\bof\b/g, ' ');
  const parts = clean.replace(/[,]/g, ' ').split(/[\s/.\-]+/).filter(Boolean);
  const numbers = [];
  let month = 0;
  for (const part of parts) {
    const name = MONTH_NAMES.findIndex((m) => m === part || (part.length >= 3 && m.startsWith(part)));
    if (name !== -1) month = name + 1;
    else if (/^\d+$/.test(part)) numbers.push(part);
  }
  let day;
  let year;
  if (month) {
    // "3 June 1990" or "June 3 1990": the 4-digit number is the year, the other one the day.
    const yearText = numbers.find((n) => n.length === 4);
    const dayText = numbers.find((n) => n.length <= 2);
    if (!yearText || !dayText) return null;
    day = Number(dayText);
    year = Number(yearText);
  } else {
    // "3 6 1990" or "03061990"
    let list = numbers;
    // Said digit by digit ("1 3 0 5 1 9 8 7"): the eight digits are the day, month and year.
    if (list.length === 8 && list.every((n) => n.length === 1)) list = [list.join('')];
    if (list.length === 1 && list[0].length === 8) list = [list[0].slice(0, 2), list[0].slice(2, 4), list[0].slice(4)];
    if (list.length !== 3 || list[2].length !== 4) return null;
    [day, month, year] = [Number(list[0]), Number(list[1]), Number(list[2])];
  }
  return isRealDate(day, month, year) ? formatDate(day, month, year) : null;
}

/**
 * Check an answer against the rules of its field.
 * @param {string} value
 * @param {{kind?:string, pattern?:string}} format
 * @returns {{valid:boolean, reason:''|'empty'|'format'|'email'|'date'|'digits', count?:number}}
 *   reason says which message to show; count = how many digits are needed
 */
export function validateAnswer(value, { kind = 'text', pattern = '' } = {}) {
  const text = String(value ?? '').trim();
  if (text === '') return { valid: false, reason: 'empty' };

  if (kind === 'email') return isValidEmail(text) ? { valid: true, reason: '' } : { valid: false, reason: 'email' };
  if (kind === 'date') return isValidDate(text) ? { valid: true, reason: '' } : { valid: false, reason: 'date' };

  if (PATTERN_KINDS.includes(kind)) {
    const cells = parsePattern(pattern);
    if (cells.length > 0) {
      const values = stringToValues(text, cells);
      const complete = isPatternComplete(values, cells) && valuesToString(values) === alnumUpper(text);
      if (complete) return { valid: true, reason: '' };
      const onlyDigits = cells.every((cell) => cell.type === 'digit');
      return onlyDigits ? { valid: false, reason: 'digits', count: cells.length } : { valid: false, reason: 'format' };
    }
    if (kind === 'code') return /^[A-Z0-9]+$/.test(text) ? { valid: true, reason: '' } : { valid: false, reason: 'format' };
    return /^[0-9]+$/.test(text) ? { valid: true, reason: '' } : { valid: false, reason: 'digits' };
  }

  return { valid: true, reason: '' };
}
