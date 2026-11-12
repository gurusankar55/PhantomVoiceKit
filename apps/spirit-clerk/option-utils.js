// option-utils.js
// Pure helpers for choice and checkbox fields: finding the option a user said, and the Yes / No
// options of a tick box. No browser or DOM access here, so they are easy to test.

import { normalize } from '../../skeleton/voice-commands.js';

// A tick box (a checkbox field) has these two answers. The values are English: they go on the form.
export const CHECKBOX_VALUES = ['Yes', 'No'];

/**
 * Find the option the user said or typed.
 *   1. the same words (ignoring case, punctuation and spaces)
 *   2. the option appears in what was said ("I am male" -> Male); if several do, the longest one
 *   3. what was said is a whole word of one option ("married" -> Married / Unmarried is not clear)
 * A tie, or no match at all, gives -1: the user picks with a button.
 * @param {string} text  what was said
 * @param {{label:string}[]} options
 * @returns {number} the index of the option, or -1
 */
export function matchOption(text, options) {
  const heard = normalize(text);
  if (heard === '' || !Array.isArray(options) || options.length === 0) return -1;
  const labels = options.map((option) => normalize(option.label));

  const exact = labels.findIndex((label) => label !== '' && label === heard);
  if (exact !== -1) return exact;

  const padded = ` ${heard} `;
  // The option appears inside what was said.
  const inside = labels
    .map((label, index) => ({ label, index }))
    .filter(({ label }) => label !== '' && padded.includes(` ${label} `))
    .sort((a, b) => b.label.length - a.label.length);
  if (inside.length === 1 || (inside.length > 1 && inside[0].label.length > inside[1].label.length)) return inside[0].index;
  if (inside.length > 1) return -1;

  // What was said is part of exactly one option.
  if (heard.length >= 3) {
    const part = labels.map((label, index) => ({ label, index })).filter(({ label }) => ` ${label} `.includes(padded));
    if (part.length === 1) return part[0].index;
  }
  return -1;
}

/**
 * The option with this label (the answer that was stored), or null.
 * @param {{label:string}[]|undefined} options
 * @param {string} label
 */
export function findOption(options, label) {
  const wanted = normalize(label);
  if (wanted === '' || !Array.isArray(options)) return null;
  return options.find((option) => normalize(option.label) === wanted) ?? null;
}

/**
 * The options to show as buttons for a field: the options found on the form for a choice field,
 * Yes / No for a tick box.
 * @param {{kind:string, options?:{label:string}[]}} field
 * @returns {{label:string, value:string}[]}  label = what the button shows (null: translate it), value = the answer
 */
export function optionsFor(field) {
  if (field.kind === 'checkbox') return CHECKBOX_VALUES.map((value) => ({ label: null, value }));
  return (Array.isArray(field.options) ? field.options : []).map((option) => ({ label: option.label, value: option.label }));
}
