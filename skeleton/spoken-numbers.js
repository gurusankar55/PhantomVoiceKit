// spoken-numbers.js
// Number words of the 20 languages, so a number said in the user's own language ("மூணு", "तीन",
// "三") becomes digits. The recognizer is set to the chosen language, so it writes the words of that
// language (Tamil "மூணு"), not English ("Wonder"). English number words are always accepted too.
// Pure functions: no browser or DOM access, so they are easy to test.
//
// DIGIT_WORDS[language][digit] is a list of words: the standard word first, then colloquial forms
// and the spellings a recognizer may write. REPEAT_WORDS[language] are "double" and "triple".
// Digits written in the script of the language (Tamil ௯, Devanagari ९, Arabic ٩) become 0-9 as well.

import { normalizeDigits } from './digits.js';

// Words that mean the digits 0 to 9, per language (first part of the BCP-47 code).
export const DIGIT_WORDS = {
  en: [['zero', 'nought', 'naught', 'oh'], ['one'], ['two'], ['three'], ['four'], ['five'], ['six'], ['seven'], ['eight'], ['nine']],
  ta: [
    ['பூஜ்யம்', 'பூஜ்ஜியம்', 'சைபர்', 'ஜீரோ', 'சீரோ'],
    ['ஒன்று', 'ஒண்ணு', 'ஒன்னு'],
    ['இரண்டு', 'ரெண்டு', 'இரன்டு'],
    ['மூன்று', 'மூணு', 'மூனு'],
    ['நான்கு', 'நாலு', 'நாங்கு'],
    ['ஐந்து', 'அஞ்சு', 'அஞ்ச்'],
    ['ஆறு'],
    ['ஏழு'],
    ['எட்டு'],
    ['ஒன்பது', 'ஒம்பது'],
  ],
  hi: [
    ['शून्य', 'जीरो', 'ज़ीरो', 'सिफर', 'सिफ़र'],
    ['एक'],
    ['दो'],
    ['तीन'],
    ['चार'],
    ['पांच', 'पाँच'],
    ['छह', 'छः', 'छे', 'छै'],
    ['सात'],
    ['आठ'],
    ['नौ'],
  ],
  te: [
    ['సున్న', 'సున్నా', 'జీరో'],
    ['ఒకటి', 'ఒక్కటి'],
    ['రెండు'],
    ['మూడు'],
    ['నాలుగు'],
    ['ఐదు', 'అయిదు'],
    ['ఆరు'],
    ['ఏడు'],
    ['ఎనిమిది'],
    ['తొమ్మిది'],
  ],
  kn: [
    ['ಸೊನ್ನೆ', 'ಜೀರೋ'],
    ['ಒಂದು'],
    ['ಎರಡು'],
    ['ಮೂರು'],
    ['ನಾಲ್ಕು'],
    ['ಐದು'],
    ['ಆರು'],
    ['ಏಳು'],
    ['ಎಂಟು'],
    ['ಒಂಬತ್ತು'],
  ],
  ml: [
    ['പൂജ്യം', 'സീറോ'],
    ['ഒന്ന്'],
    ['രണ്ട്'],
    ['മൂന്ന്'],
    ['നാല്'],
    ['അഞ്ച്'],
    ['ആറ്'],
    ['ഏഴ്'],
    ['എട്ട്'],
    ['ഒമ്പത്', 'ഒൻപത്'],
  ],
  bn: [
    ['শূন্য', 'জিরো'],
    ['এক'],
    ['দুই', 'দুই'],
    ['তিন'],
    ['চার'],
    ['পাঁচ', 'পাচ'],
    ['ছয়', 'ছয়'],
    ['সাত'],
    ['আট'],
    ['নয়', 'নয়'],
  ],
  ur: [
    ['صفر', 'زیرو'],
    ['ایک'],
    ['دو'],
    ['تین'],
    ['چار'],
    ['پانچ'],
    ['چھ', 'چھے'],
    ['سات'],
    ['آٹھ'],
    ['نو'],
  ],
  ar: [
    ['صفر', 'زيرو'],
    ['واحد', 'واحدة'],
    ['اثنان', 'اثنين', 'اتنين'],
    ['ثلاثة', 'ثلاث', 'تلاتة'],
    ['أربعة', 'اربعة', 'أربع'],
    ['خمسة', 'خمس'],
    ['ستة', 'ست'],
    ['سبعة', 'سبع'],
    ['ثمانية', 'ثماني', 'تمانية'],
    ['تسعة', 'تسع'],
  ],
  zh: [['零', '〇'], ['一', '幺'], ['二', '两'], ['三'], ['四'], ['五'], ['六'], ['七'], ['八'], ['九']],
  ja: [
    ['ゼロ', 'れい', 'まる', '零'],
    ['いち', '一'],
    ['に', '二'],
    ['さん', '三'],
    ['よん', 'し', '四'],
    ['ご', '五'],
    ['ろく', '六'],
    ['なな', 'しち', '七'],
    ['はち', '八'],
    ['きゅう', 'く', '九'],
  ],
  ko: [
    ['영', '공'],
    ['일', '하나'],
    ['이', '둘'],
    ['삼', '셋'],
    ['사', '넷'],
    ['오', '다섯'],
    ['육', '여섯'],
    ['칠', '일곱'],
    ['팔', '여덟'],
    ['구', '아홉'],
  ],
  es: [['cero'], ['uno', 'una'], ['dos'], ['tres'], ['cuatro'], ['cinco'], ['seis'], ['siete'], ['ocho'], ['nueve']],
  fr: [['zéro', 'zero'], ['un', 'une'], ['deux'], ['trois'], ['quatre'], ['cinq'], ['six'], ['sept'], ['huit'], ['neuf']],
  de: [['null'], ['eins', 'ein'], ['zwei', 'zwo'], ['drei'], ['vier'], ['fünf'], ['sechs'], ['sieben'], ['acht'], ['neun']],
  pt: [['zero'], ['um', 'uma'], ['dois', 'duas'], ['três', 'tres'], ['quatro'], ['cinco'], ['seis'], ['sete'], ['oito'], ['nove']],
  ru: [['ноль', 'нуль'], ['один', 'одна'], ['два', 'две'], ['три'], ['четыре'], ['пять'], ['шесть'], ['семь'], ['восемь'], ['девять']],
  id: [['nol', 'kosong'], ['satu'], ['dua'], ['tiga'], ['empat'], ['lima'], ['enam'], ['tujuh'], ['delapan'], ['sembilan']],
  tr: [['sıfır'], ['bir'], ['iki'], ['üç'], ['dört'], ['beş'], ['altı'], ['yedi'], ['sekiz'], ['dokuz']],
  vi: [['không', 'khong'], ['một', 'mot'], ['hai'], ['ba'], ['bốn', 'bon'], ['năm', 'nam'], ['sáu', 'sau'], ['bảy', 'bay'], ['tám', 'tam'], ['chín', 'chin']],
};

// "double 5" = 55 and "triple 7" = 777, in each language (English always works too).
export const REPEAT_WORDS = {
  en: { double: 2, dubble: 2, triple: 3, treble: 3 },
  ta: { 'டபுள்': 2, 'டபிள்': 2, 'இரட்டை': 2, 'ட்ரிபிள்': 3, 'டிரிபிள்': 3, 'ட்ரிப்பிள்': 3 },
  hi: { 'डबल': 2, 'ट्रिपल': 3, 'ट्रिप्पल': 3 },
  te: { 'డబుల్': 2, 'ట్రిపుల్': 3 },
  kn: { 'ಡಬಲ್': 2, 'ಟ್ರಿಪಲ್': 3 },
  ml: { 'ഡബിൾ': 2, 'ട്രിപ്പിൾ': 3 },
  bn: { 'ডাবল': 2, 'ট্রিপল': 3 },
  ur: { 'ڈبل': 2, 'ٹرپل': 3 },
  ar: { 'دبل': 2, 'تربل': 3 },
  es: { doble: 2, triple: 3 },
  fr: { double: 2, triple: 3 },
  de: { doppel: 2, dreifach: 3 },
  pt: { duplo: 2, dobro: 2, triplo: 3 },
  ru: { 'дабл': 2, 'трипл': 3 },
  id: { dobel: 2, triple: 3 },
};

// Languages written without spaces between words: number words are searched anywhere in the text.
const SCAN_LANGUAGES = new Set(['zh', 'ja', 'ko']);

/** First part of a BCP-47 code in lower case: "ta-IN" -> "ta". */
export function baseLanguage(lang) {
  return String(lang ?? '').split('-')[0].toLowerCase();
}

// Same spelling for the table and for the text: composed Unicode, lower case.
function norm(word) {
  // The invisible joiners (ZWNJ, ZWJ) that some scripts use inside a word are not part of the spelling.
  return String(word ?? '').normalize('NFKC').replace(/[\u200c\u200d]/gu, '').toLowerCase();
}

// Cache: language -> { words: Map(word -> digit), repeats: Map(word -> times), scan: boolean }.
const tables = new Map();

/**
 * The number words of a language together with the English ones.
 * @param {string} lang  BCP-47 code, e.g. "ta-IN"
 * @returns {{words: Map<string, string>, repeats: Map<string, number>, scan: boolean}}
 */
export function numberWordTable(lang) {
  const base = baseLanguage(lang);
  if (tables.has(base)) return tables.get(base);

  const words = new Map();
  const repeats = new Map();
  for (const code of base === 'en' || !DIGIT_WORDS[base] ? ['en'] : ['en', base]) {
    DIGIT_WORDS[code].forEach((list, digit) => {
      for (const word of list) words.set(norm(word), String(digit));
    });
    for (const [word, times] of Object.entries(REPEAT_WORDS[code] ?? {})) repeats.set(norm(word), times);
  }
  const table = { words, repeats, scan: SCAN_LANGUAGES.has(base) };
  tables.set(base, table);
  return table;
}

// Cut a text into words (letters, marks and digits stay together).
function wordsOf(text) {
  return norm(text).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

// Languages without spaces: replace the number words found anywhere in the text, longest first.
function scanForDigits(text, words) {
  const list = [...words.keys()].sort((a, b) => b.length - a.length);
  let out = '';
  const chars = norm(text);
  for (let i = 0; i < chars.length; ) {
    const hit = list.find((word) => chars.startsWith(word, i));
    if (hit) {
      out += ` ${words.get(hit)} `;
      i += hit.length;
    } else {
      out += chars[i];
      i += 1;
    }
  }
  return out.replace(/\s+/gu, ' ').trim();
}

/**
 * Change the number words of a text into digits, in the chosen language and in English.
 * Other words stay. "மூணு ஒண்ணு" -> "3 1"; "டபுள் 5" -> "55"; "nine eight" -> "9 8".
 * A repeat word ("double") is only used when a number follows it, so "double u" stays.
 * @param {string} text
 * @param {string} lang  BCP-47 code of the language that was spoken
 * @returns {string}  the words separated by single spaces
 */
export function numbersToDigits(text, lang) {
  const { words, repeats, scan } = numberWordTable(lang);
  const source = normalizeDigits(text); // digits of other scripts become 0-9
  if (scan) return scanForDigits(source, words);

  const tokens = wordsOf(source);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const times = repeats.get(token);
    if (times !== undefined && i + 1 < tokens.length) {
      const next = tokens[i + 1];
      const digits = words.get(next) ?? (/^\p{N}+$/u.test(next) ? next : undefined);
      if (digits !== undefined) {
        out.push(digits[0].repeat(times) + digits.slice(1));
        i += 1;
        continue;
      }
    }
    out.push(words.get(token) ?? token);
  }
  return out.join(' ');
}
