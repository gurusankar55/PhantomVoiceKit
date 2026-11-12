// answer-widgets.js
// The editable answer area of Spirit Clerk. One widget for each kind of field:
//   cells   one box per character for a code or a number with a pattern (PAN, IFSC, Aadhaar, mobile, PIN),
//           letter boxes and digit boxes in different colours, a wrong character turns red, a tap on a
//           box opens "say this character" and a big on-screen keypad
//   email   the part before the @ and big buttons for @gmail.com, @yahoo.com, @outlook.com and Other
//   date    day, month and year pickers (DD/MM/YYYY)
//   digits  a box that accepts digits only (a number or a phone number without a known pattern)
//   choice  the options of a choice field (or Yes / No of a tick box) as big buttons
//   signature  a white pad to draw the signature with a finger or the mouse (Clear, Use)
//   text    a real, always editable text box (name, text, address)
//
// Every widget has the same small interface:
//   { type, getValue(), setValue(text), validate(), focus(), destroy() }
// and calls onChange() whenever the user (or the code) changes the answer. The widgets use only
// textContent and value (never innerHTML), so user text can never inject HTML.

import { t, setI18nText } from '/skeleton/i18n.js';
import { inkBounds, growRect, midPoint, isRealSignature } from '/apps/spirit-clerk/signature-utils.js';
import {
  parsePattern,
  chunksOf,
  emptyValues,
  valuesToString,
  stringToValues,
  cellStates,
  fillFrom,
  setCell,
  chunkToAsk,
  validateAnswer,
  parseDateString,
  formatDate,
  isRealDate,
  MIN_YEAR,
} from '/skeleton/field-formats.js';

// The endings offered for an e-mail address.
export const EMAIL_DOMAINS = ['@gmail.com', '@yahoo.com', '@outlook.com'];

// Small helper: make an element with a class.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let widgetCounter = 0;
function nextId(prefix) {
  widgetCounter += 1;
  return `${prefix}-${widgetCounter}`;
}

// ---------------------------------------------------------------------------
// Text box
// ---------------------------------------------------------------------------

function createTextWidget(container, { multiline, onChange }) {
  const box = multiline ? el('textarea', 'answer-input') : el('input', 'answer-input');
  if (multiline) box.rows = 3;
  else box.type = 'text';
  box.maxLength = 500;
  box.id = nextId('answer-text');
  box.setAttribute('autocomplete', 'off');
  box.setAttribute('autocapitalize', 'off');
  box.spellcheck = false;
  box.addEventListener('input', () => onChange());
  container.appendChild(box);

  return {
    type: 'text',
    element: box,
    getValue: () => box.value,
    setValue(text) {
      box.value = String(text ?? '');
      onChange();
    },
    validate: () => validateAnswer(box.value, { kind: 'text' }),
    focus: () => box.focus(),
    destroy: () => box.remove(),
  };
}

// ---------------------------------------------------------------------------
// Digits only
// ---------------------------------------------------------------------------

function createDigitsWidget(container, { onChange, kind }) {
  const box = el('input', 'answer-input');
  box.type = 'text';
  box.inputMode = 'numeric';
  box.maxLength = 30;
  box.id = nextId('answer-digits');
  box.setAttribute('autocomplete', 'off');
  box.addEventListener('input', () => {
    const digits = box.value.replace(/\D/g, '');
    if (digits !== box.value) box.value = digits;
    onChange();
  });
  container.appendChild(box);

  return {
    type: 'digits',
    element: box,
    getValue: () => box.value,
    setValue(text) {
      box.value = String(text ?? '').replace(/\D/g, '');
      onChange();
    },
    validate: () => validateAnswer(box.value, { kind }),
    focus: () => box.focus(),
    destroy: () => box.remove(),
  };
}

// ---------------------------------------------------------------------------
// A code without a known pattern: capital letters and digits only
// ---------------------------------------------------------------------------

function createCodeWidget(container, { onChange }) {
  const box = el('input', 'answer-input');
  box.type = 'text';
  box.maxLength = 40;
  box.id = nextId('answer-code');
  box.setAttribute('autocomplete', 'off');
  box.setAttribute('autocapitalize', 'characters');
  box.spellcheck = false;
  const clean = (text) => String(text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  box.addEventListener('input', () => {
    const next = clean(box.value);
    if (next !== box.value) box.value = next;
    onChange();
  });
  container.appendChild(box);

  return {
    type: 'code',
    element: box,
    getValue: () => box.value,
    setValue(text) {
      box.value = clean(text);
      onChange();
    },
    validate: () => validateAnswer(box.value, { kind: 'code' }),
    focus: () => box.focus(),
    destroy: () => box.remove(),
  };
}

// ---------------------------------------------------------------------------
// E-mail: the part before the @ plus big ending buttons
// ---------------------------------------------------------------------------

function createEmailWidget(container, { onChange }) {
  const box = el('input', 'answer-input');
  box.type = 'text';
  box.inputMode = 'email';
  box.maxLength = 254;
  box.id = nextId('answer-email');
  box.setAttribute('autocomplete', 'off');
  box.setAttribute('autocapitalize', 'off');
  box.spellcheck = false;
  box.addEventListener('input', () => onChange());

  // The text before the @ (all of it while there is no @).
  const localPart = () => box.value.split('@')[0];

  const buttons = el('div', 'email-domains');
  for (const domain of EMAIL_DOMAINS) {
    const button = el('button', 'btn btn--secondary email-domain', domain);
    button.type = 'button';
    button.addEventListener('click', () => {
      box.value = localPart() + domain;
      onChange();
    });
    buttons.appendChild(button);
  }
  const other = el('button', 'btn btn--secondary email-domain');
  other.type = 'button';
  setI18nText(other, 'spiritClerk.domainOther');
  other.addEventListener('click', () => {
    // Leave the part before the @ and let the user type the ending.
    box.value = `${localPart()}@`;
    box.focus();
    onChange();
  });
  buttons.appendChild(other);

  container.append(box, buttons);

  return {
    type: 'email',
    element: box,
    getValue: () => box.value,
    setValue(text) {
      box.value = String(text ?? '');
      onChange();
    },
    // What was heard is the part before the @, unless a whole address was said.
    setHeard(text) {
      const heard = String(text ?? '');
      const keepDomain = box.value.includes('@') && !heard.includes('@') ? `@${box.value.split('@').slice(1).join('@')}` : '';
      box.value = heard + keepDomain;
      onChange();
    },
    validate: () => validateAnswer(box.value, { kind: 'email' }),
    focus: () => box.focus(),
    destroy: () => {
      box.remove();
      buttons.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Date: day, month and year pickers
// ---------------------------------------------------------------------------

function createDateWidget(container, { onChange, lang }) {
  const row = el('div', 'date-pickers');

  // A labelled <select> with an empty first option.
  function picker(labelKey) {
    const wrap = el('div', 'date-picker');
    const select = el('select', 'answer-select');
    select.id = nextId('answer-date');
    const label = el('label', 'date-label');
    label.htmlFor = select.id;
    setI18nText(label, labelKey);
    select.appendChild(new Option('', ''));
    wrap.append(label, select);
    row.appendChild(wrap);
    return select;
  }
  const day = picker('spiritClerk.dateDay');
  const month = picker('spiritClerk.dateMonth');
  const year = picker('spiritClerk.dateYear');

  for (let d = 1; d <= 31; d++) day.appendChild(new Option(String(d), String(d)));
  let monthNames;
  try {
    const formatter = new Intl.DateTimeFormat(lang || undefined, { month: 'long' });
    monthNames = Array.from({ length: 12 }, (_, i) => formatter.format(new Date(2000, i, 15)));
  } catch {
    monthNames = Array.from({ length: 12 }, (_, i) => String(i + 1));
  }
  monthNames.forEach((name, i) => month.appendChild(new Option(`${i + 1} - ${name}`, String(i + 1))));
  const thisYear = new Date().getFullYear();
  for (let y = thisYear + 1; y >= MIN_YEAR; y--) year.appendChild(new Option(String(y), String(y)));

  const shown = el('p', 'date-shown');
  shown.setAttribute('aria-live', 'polite');
  container.append(row, shown);

  function getValue() {
    if (day.value === '' || month.value === '' || year.value === '') return '';
    return formatDate(day.value, month.value, year.value);
  }
  function refresh() {
    shown.textContent = getValue();
    onChange();
  }
  for (const select of [day, month, year]) select.addEventListener('change', refresh);

  return {
    type: 'date',
    getValue,
    // text is DD/MM/YYYY (or any readable day month year); an unreadable text clears the pickers
    setValue(text) {
      const parsed = parseDateString(text);
      if (parsed) {
        day.value = String(parsed.day);
        month.value = String(parsed.month);
        year.value = String(parsed.year);
      } else {
        day.value = '';
        month.value = '';
        year.value = '';
      }
      refresh();
    },
    validate: () => validateAnswer(getValue(), { kind: 'date' }),
    focus: () => day.focus(),
    isRealDate: () => isRealDate(day.value, month.value, year.value),
    destroy: () => {
      row.remove();
      shown.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Cells: one box per character
// ---------------------------------------------------------------------------

const LETTERS = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
const DIGITS = Array.from('0123456789');

function createCellsWidget(container, { pattern, kind, onChange, onSayChar }) {
  const cells = parsePattern(pattern);
  const chunks = chunksOf(cells);
  let values = emptyValues(cells);
  let selected = -1; // the box that was tapped

  const grid = el('div', 'cells');
  grid.setAttribute('role', 'group');
  const buttons = cells.map((cell, index) => {
    const button = el('button', `cell cell--${cell.type}`);
    button.type = 'button';
    button.addEventListener('click', () => select(index));
    grid.appendChild(button);
    return button;
  });

  // The panel that opens when a box is tapped: "say this character" and the keypad.
  const panel = el('div', 'cell-panel');
  panel.hidden = true;
  const sayButton = el('button', 'btn btn--secondary cell-say');
  sayButton.type = 'button';
  setI18nText(sayButton, 'spiritClerk.sayChar');
  sayButton.addEventListener('click', () => {
    if (selected >= 0 && typeof onSayChar === 'function') onSayChar(selected, cells[selected].type);
  });
  const hint = el('p', 'cell-hint');
  setI18nText(hint, 'spiritClerk.tapBox');
  const keypad = el('div', 'keypad');
  keypad.setAttribute('role', 'group');
  panel.append(sayButton, keypad);
  container.append(hint, grid, panel);

  function buildKeypad(type) {
    keypad.textContent = '';
    const keys = type === 'letter' ? LETTERS : type === 'digit' ? DIGITS : [...LETTERS, ...DIGITS];
    for (const key of keys) {
      const button = el('button', `key ${/[0-9]/.test(key) ? 'key--digit' : 'key--letter'}`, key);
      button.type = 'button';
      button.addEventListener('click', () => {
        const at = selected;
        values = setCell(values, cells, at, key);
        // After a character, go to the next box that is still empty (or close the panel).
        const nextEmpty = values.findIndex((v, i) => i > at && cells[i].type !== 'literal' && v === '');
        if (nextEmpty !== -1) select(nextEmpty);
        else closePanel();
        render();
        onChange();
      });
      keypad.appendChild(button);
    }
  }

  function closePanel() {
    selected = -1;
    panel.hidden = true;
  }

  function select(index) {
    if (cells[index].type === 'literal') return;
    selected = index;
    buildKeypad(cells[index].type);
    panel.hidden = false;
    render();
  }

  function render() {
    const states = cellStates(values, cells);
    buttons.forEach((button, i) => {
      button.textContent = values[i] || '';
      button.classList.toggle('cell--bad', states[i] === 'bad');
      button.classList.toggle('cell--selected', i === selected);
      button.classList.toggle('cell--empty', states[i] === 'empty');
      button.setAttribute('aria-label', t('spiritClerk.cellLabel', { n: i + 1, total: cells.length }) + (values[i] ? `: ${values[i]}` : ''));
      button.setAttribute('aria-invalid', String(states[i] === 'bad'));
      if (cells[i].type === 'literal') button.disabled = true;
    });
  }
  render();

  return {
    type: 'cells',
    cells,
    chunks,
    getValue: () => valuesToString(values),
    getValues: () => [...values],
    setValue(text) {
      values = stringToValues(text, cells);
      closePanel();
      render();
      onChange();
    },
    // Put heard characters in the boxes, starting at the first box of a group (and going on into the next).
    putChars(startIndex, chars) {
      const result = fillFrom(values, cells, startIndex, chars);
      values = result.values;
      render();
      onChange();
      return result.used;
    },
    // One character for the tapped box (used by "say this character").
    putCharAtSelected(chars) {
      if (selected < 0) return;
      const at = selected;
      values = setCell(values, cells, at, chars);
      closePanel();
      render();
      onChange();
    },
    // "Say this character again" needs the microphone: it is hidden when voice cannot be used.
    setVoiceAvailable(available) {
      sayButton.hidden = !available;
    },
    // Is there a wrong character (a letter in a digit box or a digit in a letter box)?
    hasBad: () => cellStates(values, cells).includes('bad'),
    clear() {
      values = emptyValues(cells);
      closePanel();
      render();
      onChange();
    },
    // The next group to ask, or null when every box is filled.
    nextChunk: () => chunkToAsk(values, cells, chunks),
    selectedIndex: () => selected,
    validate: () => validateAnswer(valuesToString(values), { kind, pattern }),
    focus: () => buttons.find((b) => !b.disabled)?.focus(),
    destroy: () => {
      hint.remove();
      grid.remove();
      panel.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Choice and tick box: the options as big buttons
// ---------------------------------------------------------------------------

function createChoiceWidget(container, { options, onChange }) {
  const title = el('p', 'choose-title');
  setI18nText(title, 'spiritClerk.chooseOption');
  const list = el('div', 'options');
  list.setAttribute('role', 'group');
  let selected = '';

  const buttons = options.map((option) => {
    const button = el('button', 'btn btn--secondary option-button');
    button.type = 'button';
    if (option.label === null) setI18nText(button, option.value === 'Yes' ? 'spiritClerk.yes' : 'spiritClerk.no');
    else button.textContent = option.label; // the words printed on the form
    button.addEventListener('click', () => {
      selected = option.value;
      render();
      onChange();
    });
    list.appendChild(button);
    return button;
  });

  function render() {
    buttons.forEach((button, i) => {
      const on = options[i].value === selected;
      button.classList.toggle('option-button--chosen', on);
      button.setAttribute('aria-pressed', String(on));
    });
  }
  render();
  container.append(title, list);

  return {
    type: 'choice',
    options,
    getValue: () => selected,
    // The answer is the value of one option; any other text clears the choice.
    setValue(text) {
      const wanted = String(text ?? '').trim().toLowerCase();
      const found = options.find((option) => option.value.toLowerCase() === wanted);
      selected = found ? found.value : '';
      render();
      onChange();
    },
    validate: () => (selected === '' ? { valid: false, reason: 'empty' } : { valid: true, reason: '' }),
    focus: () => buttons[0]?.focus(),
    destroy: () => {
      title.remove();
      list.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Signature pad: the user DRAWS the signature (finger or mouse). Nothing is ever typed or made up.
// ---------------------------------------------------------------------------

const PAD_INK = '#14267b';

function createSignatureWidget(container, { onChange, onLater }) {
  const wrap = el('div', 'signature');
  const title = el('h4', 'signature-title');
  setI18nText(title, 'spiritClerk.signHere');
  const hint = el('p', 'signature-hint');
  setI18nText(hint, 'spiritClerk.padHint');

  // The white pad
  const canvas = el('canvas', 'signature-pad');
  canvas.setAttribute('role', 'img');
  const message = el('p', 'signature-message');
  message.setAttribute('role', 'alert');
  message.hidden = true;

  // The signature after "Use": a picture
  const preview = el('img', 'signature-preview');
  preview.hidden = true;
  setI18nAltText(preview);

  const clear = el('button', 'btn btn--secondary');
  clear.type = 'button';
  setI18nText(clear, 'spiritClerk.padClear');
  const use = el('button', 'btn btn--correct');
  use.type = 'button';
  setI18nText(use, 'spiritClerk.padUse');
  const buttons = el('div', 'signature-buttons');
  buttons.append(clear, use);

  const later = el('button', 'btn btn--secondary signature-later');
  later.type = 'button';
  setI18nText(later, 'spiritClerk.signLater');
  later.addEventListener('click', () => onLater());

  wrap.append(title, hint, canvas, preview, message, buttons, later);
  container.appendChild(wrap);

  // ----- drawing -----
  const ctx = canvas.getContext('2d');
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  let cssWidth = 0;
  let cssHeight = 0;
  let last = null; // the last pen position
  let drawing = false;
  let signature = ''; // the PNG data URL after "Use"

  function sizePad() {
    cssWidth = Math.max(240, canvas.clientWidth || wrap.clientWidth || 320);
    cssHeight = Math.max(160, canvas.clientHeight || 220);
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = PAD_INK;
    ctx.fillStyle = PAD_INK;
  }
  sizePad();

  // Position of the pen inside the pad, in CSS pixels.
  function point(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(1, rect.width)) * cssWidth,
      y: ((event.clientY - rect.top) / Math.max(1, rect.height)) * cssHeight,
    };
  }

  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (canvas.width !== Math.round(cssWidth * ratio)) sizePad();
    drawing = true;
    message.hidden = true;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // not every browser lets us capture the pointer: drawing still works inside the pad
    }
    last = point(event);
    // A tap leaves a dot.
    ctx.beginPath();
    ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    event.preventDefault();
    // Draw the pen's way in small steps (the browser may group several moves in one event).
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const step of events.length > 0 ? events : [event]) {
      const next = point(step);
      const middle = midPoint(last, next);
      ctx.quadraticCurveTo(last.x, last.y, middle.x, middle.y); // a smooth curve through the middle points
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(middle.x, middle.y);
      last = next;
    }
  });

  function stopDrawing(event) {
    if (!drawing) return;
    drawing = false;
    if (last) {
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
    last = null;
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // nothing to release
    }
  }
  canvas.addEventListener('pointerup', stopDrawing);
  canvas.addEventListener('pointercancel', stopDrawing);

  function clearPad() {
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.beginPath();
  }

  function showPad() {
    signature = '';
    preview.hidden = true;
    preview.removeAttribute('src');
    canvas.hidden = false;
    hint.hidden = false;
    use.hidden = false;
    clearPad();
    onChange();
  }

  clear.addEventListener('click', () => {
    message.hidden = true;
    showPad();
  });

  // "Use": cut the signature out of the pad (transparent background) and keep it as a picture.
  use.addEventListener('click', () => {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bounds = inkBounds(pixels);
    if (!isRealSignature(bounds)) {
      setI18nText(message, 'spiritClerk.padEmpty');
      message.hidden = false;
      return;
    }
    const box = growRect(bounds, Math.round(8 * ratio), canvas.width, canvas.height);
    const cut = document.createElement('canvas');
    cut.width = box.w;
    cut.height = box.h;
    cut.getContext('2d').drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    signature = cut.toDataURL('image/png');
    preview.src = signature;
    preview.hidden = false;
    canvas.hidden = true;
    hint.hidden = true;
    use.hidden = true;
    message.hidden = true;
    onChange();
  });

  return {
    type: 'signature',
    getValue: () => signature,
    getImage: () => signature,
    setValue(text) {
      if (String(text ?? '') === '') showPad();
    },
    validate: () => (signature === '' ? { valid: false, reason: 'empty' } : { valid: true, reason: '' }),
    focus: () => clear.focus(),
    destroy: () => wrap.remove(),
  };
}

// The picture of a signature needs a text alternative.
function setI18nAltText(image) {
  image.setAttribute('alt', t('spiritClerk.signatureAlt'));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the answer widget for a field.
 * @param {HTMLElement} container  an empty element
 * @param {{kind:string, pattern?:string}} format  from resolveFormat
 * @param {{onChange:()=>void, onSayChar?:(index:number, type:string)=>void, onSignLater?:()=>void, options?:{label:string|null, value:string}[], lang?:string}} options
 *   options = the buttons of a choice or tick box field (see optionsFor); onSignLater = "I will sign by hand" was pressed
 */
export function createAnswerWidget(container, format, { onChange, onSayChar, onSignLater, options = [], lang }) {
  const { kind, pattern } = format;
  if (kind === 'signature') return createSignatureWidget(container, { onChange, onLater: onSignLater || (() => {}) });
  if ((kind === 'choice' || kind === 'checkbox') && options.length > 0) return createChoiceWidget(container, { options, onChange });
  if (['code', 'number', 'phone'].includes(kind) && parsePattern(pattern).length > 0) {
    return createCellsWidget(container, { pattern, kind, onChange, onSayChar });
  }
  if (kind === 'code') return createCodeWidget(container, { onChange });
  if (kind === 'email') return createEmailWidget(container, { onChange });
  if (kind === 'date') return createDateWidget(container, { onChange, lang });
  if (kind === 'number' || kind === 'phone') return createDigitsWidget(container, { onChange, kind });
  return createTextWidget(container, { multiline: kind === 'address' || kind === 'text' || kind === 'choice', onChange });
}
