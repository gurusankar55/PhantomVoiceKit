// letter-names.js
// The names of the letters A to Z as people say them in the languages of India, written the way a
// recognizer writes them in that script (Tamil "பி" = B, Hindi "बी" = B). A PAN code spelled in
// the chosen language ("ஏ பி சி டி ஈ") is understood this way, with no need to switch to English.
// Pure data and functions: no browser or DOM access, so they are easy to test.
//
// LETTER_NAMES[language][letter] is a list of spellings: the usual one first, then others.

export const LETTER_NAMES = {
  ta: {
    A: ['ஏ', 'எய்'], B: ['பி'], C: ['சி', 'சீ'], D: ['டி'], E: ['ஈ'], F: ['எஃப்', 'எப்'], G: ['ஜி', 'ஜீ'],
    H: ['எச்', 'ஹெச்'], I: ['ஐ'], J: ['ஜே', 'ஜெ'], K: ['கே'], L: ['எல்'], M: ['எம்'], N: ['என்'], O: ['ஓ'],
    P: ['பீ'], Q: ['க்யூ', 'கியூ'], R: ['ஆர்'], S: ['எஸ்'], T: ['டீ'], U: ['யூ', 'யு'], V: ['வி'],
    W: ['டபிள்யூ', 'டபுள்யூ', 'டபிள்யு'], X: ['எக்ஸ்'], Y: ['ஒய்', 'வை'], Z: ['இசட்', 'ஜெட்'],
  },
  hi: {
    A: ['ए'], B: ['बी'], C: ['सी'], D: ['डी'], E: ['ई'], F: ['एफ', 'एफ़'], G: ['जी'], H: ['एच'], I: ['आई'],
    J: ['जे'], K: ['के'], L: ['एल'], M: ['एम'], N: ['एन'], O: ['ओ'], P: ['पी'], Q: ['क्यू'], R: ['आर'],
    S: ['एस'], T: ['टी'], U: ['यू'], V: ['वी'], W: ['डब्ल्यू', 'डबल्यू', 'डबलयू'], X: ['एक्स'], Y: ['वाई'],
    Z: ['ज़ेड', 'जेड'],
  },
  te: {
    A: ['ఎ', 'ఏ'], B: ['బి'], C: ['సి'], D: ['డి'], E: ['ఈ'], F: ['ఎఫ్'], G: ['జి'], H: ['ఎచ్'], I: ['ఐ'],
    J: ['జె'], K: ['కె'], L: ['ఎల్'], M: ['ఎమ్', 'ఎం'], N: ['ఎన్'], O: ['ఓ'], P: ['పి'], Q: ['క్యూ'], R: ['ఆర్'],
    S: ['ఎస్'], T: ['టి'], U: ['యు'], V: ['వి'], W: ['డబ్ల్యూ', 'డబ్లియు'], X: ['ఎక్స్'], Y: ['వై'], Z: ['జెడ్'],
  },
  kn: {
    A: ['ಎ', 'ಏ'], B: ['ಬಿ'], C: ['ಸಿ'], D: ['ಡಿ'], E: ['ಈ'], F: ['ಎಫ್'], G: ['ಜಿ'], H: ['ಎಚ್'], I: ['ಐ'],
    J: ['ಜೆ'], K: ['ಕೆ'], L: ['ಎಲ್'], M: ['ಎಂ'], N: ['ಎನ್'], O: ['ಓ'], P: ['ಪಿ'], Q: ['ಕ್ಯೂ'], R: ['ಆರ್'],
    S: ['ಎಸ್'], T: ['ಟಿ'], U: ['ಯು'], V: ['ವಿ'], W: ['ಡಬ್ಲ್ಯೂ', 'ಡಬ್ಲ್ಯು'], X: ['ಎಕ್ಸ್'], Y: ['ವೈ'], Z: ['ಜೆಡ್'],
  },
  ml: {
    A: ['എ', 'ഏ'], B: ['ബി'], C: ['സി'], D: ['ഡി'], E: ['ഈ'], F: ['എഫ്'], G: ['ജി'], H: ['എച്ച്'], I: ['ഐ'],
    J: ['ജെ'], K: ['കെ'], L: ['എൽ'], M: ['എം'], N: ['എൻ'], O: ['ഓ'], P: ['പി'], Q: ['ക്യൂ'], R: ['ആർ'],
    S: ['എസ്'], T: ['ടി'], U: ['യു'], V: ['വി'], W: ['ഡബ്ല്യു', 'ഡബ്ലിയു'], X: ['എക്സ്'], Y: ['വൈ'], Z: ['സെഡ്', 'ഇസഡ്'],
  },
  bn: {
    A: ['এ'], B: ['বি'], C: ['সি'], D: ['ডি'], E: ['ই'], F: ['এফ'], G: ['জি'], H: ['এইচ'], I: ['আই'],
    J: ['জে'], K: ['কে'], L: ['এল'], M: ['এম'], N: ['এন'], O: ['ও'], P: ['পি'], Q: ['কিউ'], R: ['আর'],
    S: ['এস'], T: ['টি'], U: ['ইউ'], V: ['ভি'], W: ['ডাবলু', 'ডাবল্যু', 'ডাব্লিউ'], X: ['এক্স'], Y: ['ওয়াই'], Z: ['জেড'],
  },
  ur: {
    A: ['اے'], B: ['بی'], C: ['سی'], D: ['ڈی'], E: ['ای'], F: ['ایف'], G: ['جی'], H: ['ایچ'], I: ['آئی'],
    J: ['جے'], K: ['کے'], L: ['ایل'], M: ['ایم'], N: ['این'], O: ['او'], P: ['پی'], Q: ['کیو'], R: ['آر'],
    S: ['ایس'], T: ['ٹی'], U: ['یو'], V: ['وی'], W: ['ڈبلیو'], X: ['ایکس'], Y: ['وائی'], Z: ['زیڈ'],
  },
};

// The word that joins a letter and its example word in each language: "बी फॉर बॉम्बे" (B for Bombay).
export const EXAMPLE_LINKS = {
  ta: ['ஃபார்', 'பார்', 'ஃபோர்'],
  hi: ['फॉर', 'फार', 'फ़ॉर'],
  te: ['ఫర్', 'ఫార్'],
  kn: ['ಫಾರ್'],
  ml: ['ഫോർ'],
  bn: ['ফর'],
  ur: ['فار'],
};

// Same spelling for the table and for the text: composed Unicode, lower case, no invisible joiners.
function norm(word) {
  return String(word ?? '').normalize('NFKC').replace(/[\u200c\u200d]/gu, '').toLowerCase();
}

// Cache: language -> Map(spelling -> letter).
const maps = new Map();

/**
 * The letter names of a language as a lookup: spelling -> capital letter.
 * @param {string} lang  BCP-47 code, e.g. "ta-IN"
 * @returns {Map<string, string>}  empty for a language without a table (English letter names are in spoken-chars.js)
 */
export function letterNameMap(lang) {
  const base = String(lang ?? '').split('-')[0].toLowerCase();
  if (maps.has(base)) return maps.get(base);
  const map = new Map();
  for (const [letter, spellings] of Object.entries(LETTER_NAMES[base] ?? {})) {
    for (const spelling of spellings) map.set(norm(spelling), letter);
  }
  maps.set(base, map);
  return map;
}

/**
 * The link words ("for") of a language, normalized.
 * @param {string} lang
 * @returns {string[]}
 */
export function exampleLinks(lang) {
  const base = String(lang ?? '').split('-')[0].toLowerCase();
  return (EXAMPLE_LINKS[base] ?? []).map(norm);
}
