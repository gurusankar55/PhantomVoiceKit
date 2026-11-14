// server/script-check.js
// A guard for /api/translate: Gemini sometimes glues Latin letters into a word of a non-Latin
// language, for example Tamil "வரவேற்ப Leukிறேன்" instead of "வரவேற்கிறேன்".
// countGluedLatin() finds such broken words; callChecked() then asks once more with a stricter
// instruction and keeps the better answer.
//
// Not counted (these are fine): a Latin word on its own ("GiveawayProof", "GenLayer", "drand"),
// a Latin word with a suffix after it ("GenLayer-இன்", "GiveawayProofஐ"), e-mail addresses,
// links and codes.

// The script of each language whose words are not written in Latin letters.
const SCRIPTS = {
  ta: 'Tamil', hi: 'Devanagari', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', bn: 'Bengali',
  ar: 'Arabic', ur: 'Arabic', ru: 'Cyrillic', ko: 'Hangul', zh: 'Han', ja: 'Han|Hiragana|Katakana',
};
// Chinese and Japanese put no spaces between words, so a Latin brand name may touch the
// characters around it: there only a broken letter (Latin + a vowel sign) is counted.
const NO_SPACES = new Set(['zh', 'ja']);
// Some callers send the language name instead of a code.
const NAMES = {
  tamil: 'ta', hindi: 'hi', telugu: 'te', kannada: 'kn', malayalam: 'ml', bengali: 'bn', bangla: 'bn',
  arabic: 'ar', urdu: 'ur', russian: 'ru', korean: 'ko', chinese: 'zh', japanese: 'ja',
};

/** "ta-IN", "ta" or "Tamil" -> "ta" (or '' when unknown). */
export function baseLanguage(lang) {
  const value = String(lang ?? '').trim().toLowerCase();
  return NAMES[value] ?? value.split(/[-_]/)[0];
}

/** True when the language is written in a non-Latin script that this guard knows. */
export function hasOwnScript(lang) {
  return Boolean(SCRIPTS[baseLanguage(lang)]);
}

// Pieces of a text that could be one word: split at spaces, then at punctuation and hyphens.
// Whole e-mail addresses, links and "www." addresses are skipped.
function words(text) {
  const pieces = [];
  for (const chunk of String(text ?? '').split(/\s+/)) {
    if (chunk === '' || /@|:\/\/|^www\./i.test(chunk)) continue;
    for (const piece of chunk.split(/[-‐-―'’‘"“”«»()[\]{}<>.,;:!?¡¿/\\|*_+=#&%~`^0-9]+/)) {
      if (piece !== '') pieces.push(piece);
    }
  }
  return pieces;
}

/**
 * How many words of a text in `lang` have Latin letters glued into them. 0 for languages
 * written in Latin letters (nothing to check).
 */
export function countGluedLatin(text, lang) {
  const base = baseLanguage(lang);
  const script = SCRIPTS[base];
  if (!script) return 0;
  // A letter or sign of the language's own script, e.g. (?:\p{Script=Tamil}).
  const ownChar = `(?:${script.split('|').map((name) => `\\p{Script=${name}}`).join('|')})`;
  const latinThenMark = /[A-Za-z]\p{M}/u; // "Leukி": a Latin letter with a vowel sign
  const inside = new RegExp(`${ownChar}\\p{M}*[A-Za-z]+${ownChar}`, 'u'); // Latin inside a word
  const atEnd = new RegExp(`${ownChar}\\p{M}*[A-Za-z]+$`, 'u'); // Latin stuck on the end of a word
  let count = 0;
  for (const word of words(text)) {
    if (!/[A-Za-z]/.test(word)) continue;
    if (latinThenMark.test(word)) count += 1;
    else if (!NO_SPACES.has(base) && (inside.test(word) || atEnd.test(word))) count += 1;
  }
  return count;
}

/** The stricter instruction for the second try (put before the normal prompt). */
export function strictPrefix(lang) {
  const named = hasOwnScript(lang) ? `the language with BCP-47 code "${baseLanguage(lang)}"` : 'any non-English language';
  return (
    `IMPORTANT: write every word of ${named} only in that language's own script. ` +
    'Never put Latin (English) letters inside a word, and never join Latin letters onto a word of that script. ' +
    'A brand name, e-mail address, link or code may stay in Latin letters only as a separate word, exactly as in the original. ' +
    'Check every word before you answer.\n\n'
  );
}

/**
 * Ask Gemini; when the answer has glued Latin letters, ask once more with a stricter prompt and
 * keep the better answer (fewer broken words; the first one when both are equally broken).
 * @param {(args:{prompt:string}) => Promise<any>} callGemini
 * @param {string} prompt
 * @param {(result:any) => number} measure   broken words in an answer
 * @param {(result:any) => boolean} usable   the answer has the expected shape
 * @param {string} lang                      the language named in the stricter instruction
 */
export async function callChecked(callGemini, prompt, measure, usable, lang) {
  const first = await callGemini({ prompt });
  const firstBad = usable(first) ? measure(first) : 0;
  if (firstBad === 0) return first;
  let second;
  try {
    second = await callGemini({ prompt: strictPrefix(lang) + prompt });
  } catch {
    return first; // the second try failed: the first answer is still better than nothing
  }
  if (!usable(second)) return first;
  return measure(second) < firstBad ? second : first;
}
