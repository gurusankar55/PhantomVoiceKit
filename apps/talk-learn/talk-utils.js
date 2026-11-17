// talk-utils.js
// Pure rules of Talk & Learn: the 14 lessons, the two languages (remembered), the conversation
// Gemini writes (checked), the lesson cache, the progress ticks, how well a spoken line matches
// the expected line (scoreSpeech) and the 3-question quiz. No DOM, no network, no Gemini.
//
// The server (server/routes/conversation.js) imports SCENARIO_IDS and cleanConversation from
// here, so the browser and the server always agree on the lessons and on the shape of a lesson.

// ---------- The lessons ----------

// The lessons in their recommended order, in three levels. The id is also the "scenario" sent to
// /api/conversation. Nothing is locked: every lesson is open, the order is only a suggestion.
export const LEVELS = Object.freeze([
  Object.freeze({
    id: 1,
    titleKey: 'talkLearn.level1',
    lessons: Object.freeze(['greetings', 'names', 'shop', 'vegetables', 'directions', 'taxi', 'ticket', 'restaurant', 'doctor', 'colleague', 'phone', 'bank', 'hotel', 'emergency']),
  }),
  Object.freeze({
    id: 2,
    titleKey: 'talkLearn.level2',
    lessons: Object.freeze(['home', 'family', 'market', 'cooking', 'festival', 'school', 'hospital', 'meeting', 'salary', 'trip', 'postoffice', 'rent']),
  }),
  Object.freeze({
    id: 3,
    titleKey: 'talkLearn.level3',
    lessons: Object.freeze(['opinion', 'yesterday', 'tomorrow', 'complaint', 'interview', 'customercare', 'favour', 'apology', 'givedirections', 'neighbours']),
  }),
]);

/** All 36 lesson ids in order (Level 1, then 2, then 3). */
export const LESSONS = Object.freeze(LEVELS.flatMap((level) => [...level.lessons]));
export const SCENARIO_IDS = LESSONS;

/** The level (1, 2 or 3) of a lesson id, or 0 for an unknown id. */
export function levelOf(id) {
  return LEVELS.find((level) => level.lessons.includes(id))?.id ?? 0;
}
/** The locale key of a lesson title. */
export function lessonTitleKey(id) {
  return `talkLearn.lesson.${id}`;
}

/** The lesson after this one, or '' after the last lesson. */
export function nextLessonId(id) {
  const at = LESSONS.indexOf(id);
  return at >= 0 && at + 1 < LESSONS.length ? LESSONS[at + 1] : '';
}

// ---------- The two languages ----------

/** "ta-IN", "ta_IN" or "ta" gives "ta". */
export function baseCode(code) {
  return String(code ?? '').split(/[-_]/)[0].toLowerCase();
}

/** True when two codes are the same language (the region does not matter). */
export function sameLanguage(a, b) {
  const first = baseCode(a);
  return first !== '' && first === baseCode(b);
}

/** The languages that can be learned: all of them except the one the user speaks. */
export function learnOptions(languages, speak) {
  return languages.filter((language) => !sameLanguage(language.bcp47, speak));
}

/** The language to learn when nothing was chosen yet (English; Hindi for an English speaker). */
export function defaultLearn(speak) {
  return sameLanguage(speak, 'en-US') ? 'hi-IN' : 'en-US';
}

export const SETTINGS_KEY = 'phantomVoiceKit.talkLearn.settings';

/**
 * Both languages as { speak, learn } (BCP-47 codes from `languages`).
 * speak is always the UI language. learn is the remembered one, unless it is missing, unknown or
 * the same language as speak: then the default is used.
 * @param {Storage|null} storage
 * @param {{bcp47: string}[]} languages  the 20 supported languages
 * @param {string} speak                 the UI language
 */
export function loadSettings(storage, languages, speak) {
  let saved = '';
  try {
    const data = JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null');
    saved = typeof data?.learn === 'string' ? data.learn : '';
  } catch {
    saved = '';
  }
  const options = learnOptions(languages, speak);
  const found = options.find((language) => language.bcp47 === saved);
  const fallback = options.find((language) => language.bcp47 === defaultLearn(speak)) ?? options[0];
  return { speak, learn: (found ?? fallback).bcp47 };
}

/** Remember both languages. Returns false when the storage is blocked or full. */
export function saveSettings(storage, { speak, learn }) {
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify({ speak, learn }));
    return Boolean(storage);
  } catch {
    return false;
  }
}

// ---------- The conversation from Gemini ----------

export const MIN_LINES = 6;
export const MAX_LINES = 8;
export const MIN_KEY_WORDS = 4;
export const MAX_KEY_WORDS = 5;

// One short text from Gemini: trimmed, single spaces, not too long. '' when it is not a string.
function cleanField(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

// "A", "b", "Person A", "B:" give 'A' or 'B'; anything else gives ''.
function speakerOf(value) {
  const match = /^\s*(?:person\s*)?([ab])\s*[:.]?\s*$/i.exec(typeof value === 'string' ? value : '');
  return match ? match[1].toUpperCase() : '';
}

/**
 * Check a conversation (from Gemini or from the cache) and give it a clean shape, or null when it
 * cannot be used: 6 to 8 lines { speaker: 'A' | 'B', text, say, meaning } with both speakers, and
 * 4 to 5 keyWords { word, say, meaning }. Every field is a non-empty string. Lines or words that
 * are broken are dropped; extra ones beyond the maximum are cut.
 * @param {any} raw
 * @returns {{ lines: object[], keyWords: object[] } | null}
 */
export function cleanConversation(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lines) || !Array.isArray(raw.keyWords)) return null;

  const lines = raw.lines
    .map((item) => ({
      speaker: speakerOf(item?.speaker),
      text: cleanField(item?.text, 300),
      say: cleanField(item?.say, 400),
      meaning: cleanField(item?.meaning, 300),
    }))
    .filter((line) => line.speaker && line.text && line.say && line.meaning)
    .slice(0, MAX_LINES);
  if (lines.length < MIN_LINES) return null;
  if (!lines.some((line) => line.speaker === 'A') || !lines.some((line) => line.speaker === 'B')) return null;

  const keyWords = raw.keyWords
    .map((item) => ({
      word: cleanField(item?.word, 100),
      say: cleanField(item?.say, 200),
      meaning: cleanField(item?.meaning, 200),
    }))
    .filter((entry) => entry.word && entry.say && entry.meaning)
    .slice(0, MAX_KEY_WORDS);
  if (keyWords.length < MIN_KEY_WORDS) return null;

  return { lines, keyWords };
}

// ---------- The lesson cache (localStorage) ----------

export const CACHE_PREFIX = 'phantomVoiceKit.talkLearn.lesson.';

/** The storage key of one lesson in one pair of languages. */
export function cacheKey(scenario, learnLang, speakLang) {
  return `${CACHE_PREFIX}${scenario}.${learnLang}.${speakLang}`;
}

// ---------- Built-in lessons (static files, no API call) ----------

/** The folder of a pair of languages: ("ta-IN", "hi-IN") gives "ta-hi". */
export function pairFolder(speakLang, learnLang) {
  return `${baseCode(speakLang)}-${baseCode(learnLang)}`;
}

/** Where the built-in file of a lesson is served from. */
export function builtInPath(speakLang, learnLang, scenario) {
  return `/apps/talk-learn/lessons/${pairFolder(speakLang, learnLang)}/${scenario}.json`;
}

export const BUILT_IN_INDEX_PATH = '/apps/talk-learn/lessons/index.json';

/** A saved lesson, or null (nothing saved, damaged, or not a usable conversation any more). */
export function readCachedLesson(storage, key) {
  try {
    const text = storage?.getItem(key);
    return text ? cleanConversation(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

/** Save a lesson. Returns false when the storage is blocked or full (the lesson still works). */
export function saveCachedLesson(storage, key, conversation) {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(conversation));
    return true;
  } catch {
    return false;
  }
}

// ---------- Progress ticks ----------

export const PROGRESS_KEY = 'phantomVoiceKit.talkLearn.progress';

/** The saved progress { done: { <language to learn>: [lesson ids] } }; unknown ids are dropped. */
export function loadProgress(storage) {
  const done = {};
  try {
    const data = JSON.parse(storage?.getItem(PROGRESS_KEY) ?? 'null');
    if (data && typeof data.done === 'object' && data.done !== null) {
      for (const [code, ids] of Object.entries(data.done)) {
        if (Array.isArray(ids)) done[code] = LESSONS.filter((id) => ids.includes(id));
      }
    }
  } catch {
    // damaged data: start again
  }
  return { done };
}

export function saveProgress(storage, progress) {
  try {
    if (!storage) return false;
    storage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

/** True when the lesson was completed while learning this language. */
export function isComplete(progress, learnLang, id) {
  return (progress.done[baseCode(learnLang)] ?? []).includes(id);
}

/** A new progress with this lesson ticked (the old one is not changed; order stays fixed). */
export function markComplete(progress, learnLang, id) {
  if (!LESSONS.includes(id)) return progress;
  const code = baseCode(learnLang);
  const ids = new Set(progress.done[code] ?? []);
  ids.add(id);
  return { done: { ...progress.done, [code]: LESSONS.filter((lesson) => ids.has(lesson)) } };
}

/** { done, total } of one level (1, 2 or 3) for this language. */
export function levelProgress(progress, learnLang, level) {
  const lessons = LEVELS.find((entry) => entry.id === level)?.lessons ?? [];
  return { done: lessons.filter((id) => isComplete(progress, learnLang, id)).length, total: lessons.length };
}

/** The lesson after `id`, when `isAvailable(next)` says it is not ready yet; otherwise ''. */
export function lessonToPrefetch(id, isAvailable) {
  const next = nextLessonId(id);
  return next !== '' && !isAvailable(next) ? next : '';
}

/** How many lessons are ticked for this language. */
export function completedCount(progress, learnLang) {
  return (progress.done[baseCode(learnLang)] ?? []).length;
}

// ---------- How well was the line said? ----------

const LATIN_WORD = /^[\p{Script=Latin}\p{N}]+$/u;
const ASIAN_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Text in a form that is the same for the expected line and for what the recogniser heard:
 * lower case, no punctuation or symbols, no apostrophes, no Arabic vowel marks, single spaces.
 */
export function normalizeSpeech(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\u0307/g, '') // the dot of a Turkish capital İ after lower-casing
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // Arabic vowel marks and the stretch sign
    .replace(/\p{Cf}/gu, '') // zero-width joiners and other invisible format characters
    .replace(/['’‘`´]/g, '') // don't -> dont
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A Latin word without accents ("café" = "cafe", Turkish "ı" = "i"); other scripts are kept
// whole, because their vowel signs are part of the letters.
function foldWord(word) {
  if (!LATIN_WORD.test(word)) return word;
  return word.normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}

/**
 * The words of a text for comparing. Chinese and Japanese have no spaces between words, so each
 * Han, Hiragana or Katakana character counts as one word.
 */
export function speechWords(text) {
  const words = [];
  for (const chunk of normalizeSpeech(text).split(' ')) {
    let run = '';
    for (const char of chunk) {
      if (ASIAN_CHAR.test(char)) {
        if (run !== '') words.push(foldWord(run));
        run = '';
        words.push(char);
      } else {
        run += char;
      }
    }
    if (run !== '') words.push(foldWord(run));
  }
  return words;
}

/**
 * How well `heard` matches `expected`, from 0 to 100. Case, punctuation and accents are ignored.
 * Each expected word counts once when it was heard; the share is taken of the longer of the two
 * texts, so extra words that were not in the line lower the score a little. Nothing heard, or an
 * empty expected line, gives 0.
 * @param {string} expected
 * @param {string} heard
 * @returns {number} an integer from 0 to 100
 */
export function scoreSpeech(expected, heard) {
  const want = speechWords(expected);
  const got = speechWords(heard);
  if (want.length === 0 || got.length === 0) return 0;
  const available = new Map();
  for (const word of got) available.set(word, (available.get(word) ?? 0) + 1);
  let matched = 0;
  for (const word of want) {
    const left = available.get(word) ?? 0;
    if (left > 0) {
      matched += 1;
      available.set(word, left - 1);
    }
  }
  return Math.round((100 * matched) / Math.max(want.length, got.length));
}

/** 3 stars for 80 or more, 2 stars for 50 or more, otherwise 1. */
export function starsFor(score) {
  if (score >= 80) return 3;
  if (score >= 50) return 2;
  return 1;
}

// ---------- The quiz ----------

export const QUIZ_QUESTIONS = 3;

// A shuffled copy (Fisher-Yates). `random` gives a number from 0 up to (not including) 1.
function shuffled(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * The quiz of a lesson, made from its key words only (no Gemini call): up to 3 questions "what
 * does this word mean?". The options are the right meaning and up to two other meanings of the
 * same lesson, in a random order, never the same text twice. Words whose meaning is the same as
 * another word's are not asked, because the answer would not be clear.
 * @param {{word: string, say: string, meaning: string}[]} keyWords
 * @param {() => number} [random]
 * @returns {{ word: string, say: string, answer: string, options: string[] }[]}
 */
export function buildQuiz(keyWords, random = Math.random) {
  const list = Array.isArray(keyWords) ? keyWords : [];
  const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const meanings = [];
  for (const entry of list) {
    if (entry && typeof entry.meaning === 'string' && entry.meaning.trim() !== '' && !meanings.some((m) => same(m, entry.meaning))) {
      meanings.push(entry.meaning);
    }
  }
  const askable = list.filter((entry) => {
    if (!entry || typeof entry.meaning !== 'string' || typeof entry.word !== 'string' || entry.word.trim() === '' || entry.meaning.trim() === '') return false;
    return list.filter((other) => other && typeof other.meaning === 'string' && same(other.meaning, entry.meaning)).length === 1;
  });
  const questions = [];
  for (const entry of shuffled(askable, random)) {
    if (questions.length === QUIZ_QUESTIONS) break;
    const others = shuffled(meanings.filter((meaning) => !same(meaning, entry.meaning)), random).slice(0, 2);
    if (others.length === 0) continue; // nothing to choose from
    questions.push({
      word: entry.word,
      say: typeof entry.say === 'string' ? entry.say : '',
      answer: entry.meaning,
      options: shuffled([entry.meaning, ...others], random),
    });
  }
  return questions;
}

/** True when the chosen option is the right meaning. */
export function isQuizAnswer(question, choice) {
  return Boolean(question) && choice === question.answer;
}
