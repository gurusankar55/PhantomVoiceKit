// choice-words.js
// The three options that almost every form has (Male, Female, Other) in the 20 languages, with the
// ways people really say them: the standard word first, then colloquial forms and the English word
// written in the script of the language (Tamil "மேல்" = male, "ஃபீமேல்" = female). The buttons show the
// first form; saying ANY of them (or the English word) chooses the option. The form and the PDF keep
// the original English option. Other options are translated with Gemini (see the translate route).
// Pure data and functions: no browser or DOM access here, so they are easy to test.

export const COMMON_OPTIONS = {
  male: {
    ta: ['ஆண்', 'மேல்', 'ஆம்பளை', 'ஆண்பால்'],
    hi: ['पुरुष', 'मेल', 'आदमी'],
    te: ['పురుషుడు', 'మేల్', 'మగ'],
    kn: ['ಪುರುಷ', 'ಮೇಲ್', 'ಗಂಡು'],
    ml: ['പുരുഷൻ', 'മെയിൽ', 'ആൺ'],
    bn: ['পুরুষ', 'মেল', 'ছেলে'],
    ur: ['مرد', 'میل', 'مذکر'],
    ar: ['ذكر', 'رجل'],
    zh: ['男', '男性', '男士'],
    ja: ['男性', '男', 'おとこ'],
    ko: ['남성', '남자', '남'],
    es: ['Hombre', 'Masculino', 'Varón'],
    fr: ['Homme', 'Masculin'],
    de: ['Männlich', 'Mann'],
    pt: ['Masculino', 'Homem'],
    ru: ['Мужской', 'Мужчина', 'Муж'],
    id: ['Laki-laki', 'Pria'],
    tr: ['Erkek'],
    vi: ['Nam'],
  },
  female: {
    ta: ['பெண்', 'ஃபீமேல்', 'பீமேல்', 'பெண்பால்'],
    hi: ['महिला', 'फीमेल', 'औरत', 'स्त्री'],
    te: ['స్త్రీ', 'ఫీమేల్', 'ఆడ'],
    kn: ['ಮಹಿಳೆ', 'ಫೀಮೇಲ್', 'ಹೆಣ್ಣು'],
    ml: ['സ്ത്രീ', 'ഫീമെയിൽ', 'പെൺ'],
    bn: ['মহিলা', 'ফিমেল', 'মেয়ে'],
    ur: ['عورت', 'فی میل', 'مؤنث'],
    ar: ['أنثى', 'انثى', 'امرأة'],
    zh: ['女', '女性', '女士'],
    ja: ['女性', '女', 'おんな'],
    ko: ['여성', '여자', '여'],
    es: ['Mujer', 'Femenino'],
    fr: ['Femme', 'Féminin'],
    de: ['Weiblich', 'Frau'],
    pt: ['Feminino', 'Mulher'],
    ru: ['Женский', 'Женщина', 'Жен'],
    id: ['Perempuan', 'Wanita'],
    tr: ['Kadın', 'Kız'],
    vi: ['Nữ'],
  },
  other: {
    ta: ['மற்றவை', 'மற்றவர்', 'அதர்', 'மற்றவர்கள்'],
    hi: ['अन्य', 'दूसरा', 'अदर'],
    te: ['ఇతర', 'అదర్'],
    kn: ['ಇತರೆ', 'ಅದರ್'],
    ml: ['മറ്റുള്ളവ', 'അദർ'],
    bn: ['অন্যান্য', 'অন্য', 'আদার'],
    ur: ['دیگر', 'دوسرا'],
    ar: ['آخر', 'أخرى'],
    zh: ['其他', '其它'],
    ja: ['その他', '他'],
    ko: ['기타', '그 외'],
    es: ['Otro'],
    fr: ['Autre'],
    de: ['Andere', 'Sonstige'],
    pt: ['Outro'],
    ru: ['Другое', 'Другой'],
    id: ['Lainnya'],
    tr: ['Diğer'],
    vi: ['Khác'],
  },
};

// The English labels a form uses for each of them.
const ENGLISH_NAMES = {
  male: ['male', 'm', 'man'],
  female: ['female', 'f', 'woman'],
  other: ['other', 'others', 'others (specify)', 'any other'],
};

function plain(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/gu, ' ').trim();
}

/**
 * Is this option one of Male, Female, Other (in English)?
 * @param {string} label  the option as printed on the form
 * @returns {'male'|'female'|'other'|null}
 */
export function commonOptionKey(label) {
  const text = plain(label);
  for (const [key, names] of Object.entries(ENGLISH_NAMES)) {
    if (names.includes(text)) return key;
  }
  return null;
}

/**
 * The option in the chosen language: what the button shows (first) and the other ways to say it.
 * @param {string} label  the option as printed on the form
 * @param {string} lang   BCP-47 code of the chosen language
 * @returns {{label:string, aliases:string[]} | null}  null when the option is not one of the common ones or the language is English
 */
export function localizedOption(label, lang) {
  const key = commonOptionKey(label);
  const base = String(lang ?? '').split('-')[0].toLowerCase();
  const forms = key ? COMMON_OPTIONS[key][base] : undefined;
  if (!forms) return null;
  return { label: forms[0], aliases: forms.slice(1) };
}
