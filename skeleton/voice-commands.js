// voice-commands.js
// Voice commands (Requirement 18).
// Turns a short spoken answer such as "yes" or "again" into a command.
// This is a pure module: no DOM, no window. It can be imported in Node tests.

/**
 * Cleans text so it can be compared:
 * lower-case, no punctuation or symbols, one space between words, trimmed.
 * \p{P} = punctuation (. ! । 。 ، ؟ ...), \p{S} = symbols.
 * @param {unknown} text
 * @returns {string}
 */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFC') // same letters can be typed in different Unicode forms (Tamil, Hindi...)
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Splits a "|"-separated locale string (for example "yes|ok|correct")
 * into a list of cleaned words. Empty entries and duplicates are dropped.
 * @param {unknown} str
 * @returns {string[]}
 */
export function parseWords(str) {
  if (typeof str !== 'string') return [];
  const result = [];
  for (const part of str.split('|')) {
    const word = normalize(part);
    if (word !== '' && !result.includes(word)) {
      result.push(word);
    }
  }
  return result;
}

// True when the cleaned utterance is made only of repeats of one word,
// for example "yes yes" or "yes yes yes" for the word "yes".
function isRepeatOf(cleaned, word) {
  const pieces = cleaned.split(' ');
  // Only single-word entries can be repeated; multi-word entries
  // (such as "one more time") are compared as a whole string only.
  if (word.includes(' ')) return false;
  return pieces.every((piece) => piece === word);
}

// True when the utterance matches any word in the list.
function listMatches(cleaned, list) {
  if (!Array.isArray(list)) return false;
  return list.some((entry) => {
    const word = normalize(entry);
    if (word === '') return false;
    return cleaned === word || isRepeatOf(cleaned, word);
  });
}

/**
 * Decides whether a spoken text is a "yes" or a "redo" command.
 * @param {string} text  what the user said
 * @param {{ yes?: string[], redo?: string[] }} words  word lists for the language
 * @returns {'yes' | 'redo' | null}  null when nothing (or both) matches
 */
export function matchCommand(text, words) {
  const cleaned = normalize(text);
  if (cleaned === '') return null;

  const yesList = words && words.yes ? words.yes : [];
  const redoList = words && words.redo ? words.redo : [];

  const isYes = listMatches(cleaned, yesList);
  const isRedo = listMatches(cleaned, redoList);

  if (isYes && isRedo) return null; // ambiguous
  if (isYes) return 'yes';
  if (isRedo) return 'redo';
  return null;
}
