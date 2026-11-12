// translation-rules.js
// Pure rules about WHICH text may stay unchanged in a translation. Shared by the
// server (prompt and log) and by the browser (form-overlay.js), so both agree.
// No DOM access.
//
// The rule: when the target language is not written in Latin letters, every block must be
// written fully in that language and script. Names, brand names and English words are written
// in the target script (John -> ஜான்). ONLY these stay as they are:
//   email addresses, web links, numbers, dates and ID codes (PAN, IFSC and similar).

// Languages written with Latin letters (first part of the BCP-47 code).
const LATIN_LANGS = ['en', 'es', 'fr', 'pt', 'id', 'de', 'vi', 'tr'];

/** True when the language is written with Latin letters, e.g. "es-ES". */
export function isLatinScriptLang(lang) {
  return LATIN_LANGS.includes(String(lang ?? '').split('-')[0].toLowerCase());
}

// Name of the writing system of each target language (used in the prompt).
const SCRIPT_NAMES = {
  ta: 'Tamil', hi: 'Devanagari', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', ko: 'Hangul (Korean)',
  zh: 'Chinese (Han characters)', ja: 'Japanese (kanji, hiragana and katakana)', ar: 'Arabic',
  ru: 'Cyrillic', bn: 'Bengali', ur: 'Urdu (Arabic-style script)',
};

/** Name of the script for a non-Latin target language, or '' for a Latin-script language. */
export function scriptNameFor(lang) {
  return SCRIPT_NAMES[String(lang ?? '').split('-')[0].toLowerCase()] ?? '';
}

// E-mail addresses and web links.
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const LINK = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|io|co|in|info)(?:\/\S*)?\b/gi;

/**
 * Remove everything that may stay unchanged: e-mail addresses, web links and every word
 * that contains a digit (numbers, dates like 12/03/1990, ID codes like ABCDE1234F or SBIN0001234).
 * What is left is the text that must be in the target language.
 */
export function stripKeepAsIs(text) {
  return String(text ?? '')
    .replace(EMAIL, ' ')
    .replace(LINK, ' ')
    .split(/\s+/)
    .filter((word) => !/\p{N}/u.test(word))
    .join(' ')
    .trim();
}

/**
 * True when the whole text is only e-mail addresses, links, numbers, dates or ID codes,
 * so it is allowed to stay as it is. "John" is NOT such a text; "SBIN0001234" is.
 */
export function isKeepAsIs(text) {
  const value = String(text ?? '').trim();
  if (value === '') return false;
  return !/\p{L}/u.test(stripKeepAsIs(value));
}

// ---------------------------------------------------------------------------
// AM and PM
// ---------------------------------------------------------------------------
// Time words must be translated in every language (only the numbers of the time stay). The prompt
// asks Gemini for it, and this table is a safety net for when Gemini still leaves "AM" or "PM".
// Languages that write AM / PM themselves (English, Portuguese, Indonesian, German) are not listed.
const TIME_WORDS = {
  ta: ['முற்பகல்', 'பிற்பகல்'],
  hi: ['पूर्वाह्न', 'अपराह्न'],
  te: ['పూర్వాహ్నం', 'అపరాహ్నం'],
  kn: ['ಪೂರ್ವಾಹ್ನ', 'ಅಪರಾಹ್ನ'],
  ml: ['പൂർവാഹ്നം', 'അപരാഹ്നം'],
  bn: ['পূর্বাহ্ণ', 'অপরাহ্ণ'],
  ko: ['오전', '오후'],
  zh: ['上午', '下午'],
  ja: ['午前', '午後'],
  ar: ['ص', 'م'],
  ur: ['صبح', 'شام'],
  ru: ['до полудня', 'после полудня'],
  es: ['a. m.', 'p. m.'],
  fr: ['du matin', "de l'après-midi"],
  vi: ['SA', 'CH'],
  tr: ['ÖÖ', 'ÖS'],
};

// AM or PM as a word of its own: "AM", "PM", "a.m.", "P. M.", or "am" / "pm" right after a digit
// ("10:30 am"). The word "am" in ordinary text and the letters inside other words are not touched.
// Groups 1, 3 and 5 are AM; groups 2, 4 and 6 are PM.
const AM_PM =
  /(?<![\p{L}\p{N}])(?:(AM)|(PM)|([aA]\.\s?[mM]\.?)|([pP]\.\s?[mM]\.?))(?![\p{L}\p{N}])|(?<=\d\s?)(?:(am)|(pm))(?![\p{L}\p{N}])/gu;

/**
 * Replace AM and PM in a text by the words of the target language.
 * Only a standalone AM / PM is touched; numbers and all other text stay as they are.
 * A language that writes AM / PM itself (English, Portuguese, Indonesian, German) is unchanged.
 * @param {string} text
 * @param {string} lang  BCP-47 code of the translation
 */
export function translateTimeWords(text, lang) {
  const words = TIME_WORDS[String(lang ?? '').split('-')[0].toLowerCase()];
  const value = String(text ?? '');
  if (!words) return value;
  return value.replace(AM_PM, (match, am, pm, amDots, pmDots, amLower) => (am || amDots || amLower ? words[0] : words[1]));
}

/**
 * True when a translation still has Latin letters outside the allowed exceptions
 * (so a word stayed in English). Only meaningful for non-Latin target languages.
 */
export function hasLeftoverLatin(translation) {
  return /\p{Script=Latin}/u.test(stripKeepAsIs(translation));
}
