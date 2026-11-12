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
 * Find the option that was said when each option can be said in several ways (the printed English
 * label, the translated label, colloquial forms). Same rules as matchOption, but the forms of one
 * option never compete with each other.
 * @param {string} text  what was said
 * @param {{label:string, index:number}[]} entries  every way to say an option: label + the index of its option
 * @returns {number}  the index of the option, or -1
 */
export function matchOptionWords(text, entries) {
  const heard = normalize(text);
  if (heard === '' || !Array.isArray(entries)) return -1;
  const items = entries.map((entry) => ({ label: normalize(entry.label), index: entry.index })).filter((entry) => entry.label !== '');

  const exact = items.find((entry) => entry.label === heard);
  if (exact) return exact.index;

  const padded = ` ${heard} `;
  // A form appears inside what was said: the longest form of each option, the longest option wins.
  const best = new Map();
  for (const { label, index } of items) {
    if (padded.includes(` ${label} `)) best.set(index, Math.max(best.get(index) ?? 0, label.length));
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 1 || (ranked.length > 1 && ranked[0][1] > ranked[1][1])) return ranked[0][0];
  if (ranked.length > 1) return -1;

  // What was said is part of exactly one option.
  if (heard.length >= 3) {
    const part = new Set(items.filter(({ label }) => ` ${label} `.includes(padded)).map((entry) => entry.index));
    if (part.size === 1) return [...part][0];
  }
  return -1;
}

/**
 * Every way to say each option: the printed label and, in the chosen language, the translated
 * label and its colloquial forms.
 * @param {{value:string}[]} options  the options of the widget
 * @param {({label:string, aliases:string[]}|null)[]} [localized]  one per option (same order), or nothing
 * @returns {{label:string, index:number}[]}
 */
export function optionEntries(options, localized = []) {
  const entries = [];
  options.forEach((option, index) => {
    entries.push({ label: option.value, index });
    const local = localized[index];
    if (local) {
      entries.push({ label: local.label, index });
      for (const alias of local.aliases ?? []) entries.push({ label: alias, index });
    }
  });
  return entries;
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
