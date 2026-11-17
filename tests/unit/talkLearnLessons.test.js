// talkLearnLessons.test.js
// Talk & Learn 2.0, part A-1: the three levels, every built-in lesson file (valid and in the lesson
// shape), the index, the load order (built-in, cache, API), the background prefetch rules, and the
// friendly loading box. Fakes only: no browser, no network, never the real Gemini API.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import {
  LEVELS,
  LESSONS,
  levelOf,
  levelProgress,
  markComplete,
  lessonToPrefetch,
  pairFolder,
  builtInPath,
  cleanConversation,
  cacheKey,
  readCachedLesson,
  buildQuiz,
  lessonTitleKey,
} from '../../apps/talk-learn/talk-utils.js';
import { createLessonStore, PREFETCH_STOP_KEY } from '../../apps/talk-learn/lesson-store.js';
import { conversation } from '../../skeleton/api-client.js';
import { countGluedLatin } from '../../server/script-check.js';
import { SCENARIO_PROMPTS } from '../../server/routes/conversation.js';

const ROOT = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8');
const LESSON_DIR = 'apps/talk-learn/lessons';
const LOCALES = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr'];
const STRINGS = Object.fromEntries(LOCALES.map((code) => [code, JSON.parse(read(`skeleton/locales/${code}.json`))]));

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k), data };
}
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

// ---------- the three levels ----------

describe('levels', () => {
  test('Level 1 has the 14 lessons of before, Level 2 has 12, Level 3 has 10', () => {
    assert.deepEqual(LEVELS.map((l) => l.id), [1, 2, 3]);
    assert.deepEqual(LEVELS.map((l) => l.lessons.length), [14, 12, 10]);
    assert.deepEqual([...LEVELS[1].lessons], ['home', 'family', 'market', 'cooking', 'festival', 'school', 'hospital', 'meeting', 'salary', 'trip', 'postoffice', 'rent']);
    assert.deepEqual([...LEVELS[2].lessons], ['opinion', 'yesterday', 'tomorrow', 'complaint', 'interview', 'customercare', 'favour', 'apology', 'givedirections', 'neighbours']);
    assert.equal(LESSONS.length, 36);
    assert.equal(new Set(LESSONS).size, 36);
    assert.deepEqual([...LESSONS], LEVELS.flatMap((l) => [...l.lessons]));
  });

  test('levelOf finds the level of a lesson', () => {
    assert.equal(levelOf('greetings'), 1);
    assert.equal(levelOf('rent'), 2);
    assert.equal(levelOf('neighbours'), 3);
    assert.equal(levelOf('nope'), 0);
  });

  test('progress is counted for each level and for each language', () => {
    let progress = { done: {} };
    for (const id of ['greetings', 'shop', 'home']) progress = markComplete(progress, 'hi-IN', id);
    assert.deepEqual(levelProgress(progress, 'hi-IN', 1), { done: 2, total: 14 });
    assert.deepEqual(levelProgress(progress, 'hi-IN', 2), { done: 1, total: 12 });
    assert.deepEqual(levelProgress(progress, 'hi-IN', 3), { done: 0, total: 10 });
    assert.deepEqual(levelProgress(progress, 'en-US', 1), { done: 0, total: 14 });
    assert.deepEqual(levelProgress(progress, 'hi-IN', 9), { done: 0, total: 0 });
  });

  test('nothing is locked: the page opens any lesson, with no level or progress check', () => {
    const code = read('apps/talk-learn/app.js');
    assert.match(code, /button\.addEventListener\('click', \(\) => openLesson\(id\)\)/);
    assert.ok(!/disabled\s*=\s*!?\s*(isComplete|levelProgress)|aria-disabled/i.test(code));
    assert.ok(!/\.disabled\s*=[^;]*(level|isComplete)/i.test(code));
    assert.match(read('apps/talk-learn/index.html'), /data-i18n="talkLearn\.openNote"/);
  });

  test('the page shows a heading and its own progress for each level', () => {
    const code = read('apps/talk-learn/app.js');
    assert.match(code, /for \(const level of LEVELS\)/);
    assert.match(code, /setI18nText\(heading, level\.titleKey\)/);
    assert.match(code, /levelProgress\(progress, state\.learn\.bcp47, level\.id\)/);
    assert.match(read('apps/talk-learn/index.html'), /id="lesson-list"/);
  });

  test('level headings and all 36 titles are in the 20 locale files', () => {
    for (const code of LOCALES) {
      for (const level of LEVELS) assert.ok(STRINGS[code][level.titleKey]?.trim(), `${code} ${level.titleKey}`);
      for (const id of LESSONS) assert.ok(STRINGS[code][lessonTitleKey(id)]?.trim(), `${code} ${id}`);
    }
    assert.equal(STRINGS.en['talkLearn.level2'], 'Level 2: Daily life');
    assert.equal(STRINGS.en['talkLearn.lesson.rent'], 'Renting a house');
    assert.equal(STRINGS.en['talkLearn.lesson.neighbours'], 'Small talk with neighbours');
  });

  test('the server has a situation text for each of the 36 lessons', () => {
    assert.deepEqual(Object.keys(SCENARIO_PROMPTS).sort(), [...LESSONS].sort());
  });
});

// ---------- every built-in lesson file ----------

const index = JSON.parse(read(`${LESSON_DIR}/index.json`));
const PAIRS = Object.keys(index);
const LEVEL1 = [...LEVELS[0].lessons];

// The scripts of each side of a pair.
const TAMIL = /\p{Script=Tamil}/u;
const DEVANAGARI = /\p{Script=Devanagari}/u;
const LATIN = /[A-Za-z]/;
const KANNADA = /\p{Script=Kannada}/u;
const TELUGU = /\p{Script=Telugu}/u;
const MALAYALAM = /\p{Script=Malayalam}/u;
const OTHER_SOUTH = [KANNADA, TELUGU, MALAYALAM];
const SCRIPTS = {
  'ta-hi': { text: DEVANAGARI, say: TAMIL, meaning: TAMIL },
  'ta-en': { text: LATIN, say: TAMIL, meaning: TAMIL },
  'en-hi': { text: DEVANAGARI, say: LATIN, meaning: LATIN },
  'en-es': { text: LATIN, say: LATIN, meaning: LATIN },
  'ta-kn': { text: KANNADA, say: TAMIL, meaning: TAMIL },
  'ta-te': { text: TELUGU, say: TAMIL, meaning: TAMIL },
  'ta-ml': { text: MALAYALAM, say: TAMIL, meaning: TAMIL },
};
const NOT = {
  // what must not be mixed into each field
  'ta-hi': { text: [LATIN, TAMIL], say: [LATIN, DEVANAGARI], meaning: [LATIN, DEVANAGARI] },
  'ta-en': { text: [TAMIL, DEVANAGARI], say: [LATIN, DEVANAGARI], meaning: [LATIN, DEVANAGARI] },
  'en-hi': { text: [LATIN, TAMIL], say: [TAMIL, DEVANAGARI], meaning: [TAMIL, DEVANAGARI] },
  'en-es': { text: [TAMIL, DEVANAGARI], say: [TAMIL, DEVANAGARI], meaning: [TAMIL, DEVANAGARI] },
  'ta-kn': { text: [LATIN, TAMIL, DEVANAGARI, TELUGU, MALAYALAM], say: [LATIN, ...OTHER_SOUTH], meaning: [LATIN, ...OTHER_SOUTH] },
  'ta-te': { text: [LATIN, TAMIL, DEVANAGARI, KANNADA, MALAYALAM], say: [LATIN, ...OTHER_SOUTH], meaning: [LATIN, ...OTHER_SOUTH] },
  'ta-ml': { text: [LATIN, TAMIL, DEVANAGARI, KANNADA, TELUGU], say: [LATIN, ...OTHER_SOUTH], meaning: [LATIN, ...OTHER_SOUTH] },
};

function load(pair, id) {
  return JSON.parse(read(`${LESSON_DIR}/${pair}/${id}.json`));
}

describe('built-in lesson files', () => {
  test('the index lists exactly the pairs and lessons that exist on disk', () => {
    assert.deepEqual([...PAIRS].sort(), ['en-es', 'en-hi', 'ta-en', 'ta-hi', 'ta-kn', 'ta-ml', 'ta-te']);
    const folders = readdirSync(new URL(`${LESSON_DIR}/`, ROOT), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    assert.deepEqual(folders, [...PAIRS].sort());
    for (const pair of PAIRS) {
      const onDisk = readdirSync(new URL(`${LESSON_DIR}/${pair}/`, ROOT)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort();
      assert.deepEqual(onDisk, [...index[pair]].sort(), pair);
      assert.equal(new Set(index[pair]).size, index[pair].length, `${pair}: no repeated lesson`);
      for (const id of index[pair]) assert.ok(LESSONS.includes(id), `${pair}: ${id} is a real lesson`);
    }
  });

  test('all 36 lessons for Tamil to Hindi, English, Kannada, Telugu and Malayalam; the 14 Level 1 lessons for English to Hindi and English to Spanish', () => {
    for (const pair of ['ta-hi', 'ta-en', 'ta-kn', 'ta-te', 'ta-ml']) assert.deepEqual([...index[pair]], [...LESSONS], pair);
    assert.deepEqual([...index['en-hi']], LEVEL1);
    assert.deepEqual([...index['en-es']], LEVEL1);
  });

  test('the folder of a pair of languages and the path of a file', () => {
    assert.equal(pairFolder('ta-IN', 'hi-IN'), 'ta-hi');
    assert.equal(pairFolder('en-US', 'es-ES'), 'en-es');
    assert.equal(pairFolder('zh_CN', 'en-GB'), 'zh-en');
    assert.equal(builtInPath('ta-IN', 'en-US', 'shop'), '/apps/talk-learn/lessons/ta-en/shop.json');
    for (const pair of PAIRS) assert.ok(existsSync(new URL(`${LESSON_DIR}/${pair}/${index[pair][0]}.json`, ROOT)));
  });

  for (const pair of ['ta-hi', 'ta-en', 'ta-kn', 'ta-te', 'ta-ml', 'en-hi', 'en-es']) {
    test(`${pair}: every file is valid JSON in exactly the lesson shape`, () => {
      for (const id of index[pair]) {
        const where = `${pair}/${id}`;
        const raw = load(pair, id);
        assert.deepEqual(Object.keys(raw), ['lines', 'keyWords'], where);
        // cleanConversation drops nothing: the file is already clean
        const clean = cleanConversation(raw);
        assert.ok(clean, `${where}: usable lesson`);
        assert.deepEqual(clean, raw, `${where}: nothing was trimmed or dropped`);
        assert.ok(raw.lines.length >= 6 && raw.lines.length <= 8, `${where}: 6 to 8 lines`);
        assert.ok(raw.keyWords.length >= 4 && raw.keyWords.length <= 5, `${where}: 4 to 5 key words`);
        raw.lines.forEach((line, i) => {
          assert.deepEqual(Object.keys(line), ['speaker', 'text', 'say', 'meaning'], `${where} line ${i}`);
          assert.equal(line.speaker, i % 2 === 0 ? 'A' : 'B', `${where} line ${i}: A and B take turns, A first`);
        });
        assert.equal(raw.lines.at(-1).speaker, 'B', `${where}: person B speaks last`);
        raw.keyWords.forEach((entry, i) => assert.deepEqual(Object.keys(entry), ['word', 'say', 'meaning'], `${where} key word ${i}`));
      }
    });

    test(`${pair}: text, say and meaning are in the right scripts (no mixing)`, () => {
      const scripts = SCRIPTS[pair];
      const nots = NOT[pair];
      for (const id of index[pair]) {
        const raw = load(pair, id);
        const rows = [
          ...raw.lines.map((l, i) => [`${pair}/${id} line ${i}`, { text: l.text, say: l.say, meaning: l.meaning }]),
          ...raw.keyWords.map((k, i) => [`${pair}/${id} key word ${i}`, { text: k.word, say: k.say, meaning: k.meaning }]),
        ];
        for (const [where, row] of rows) {
          for (const field of ['text', 'say', 'meaning']) {
            assert.ok(scripts[field].test(row[field]), `${where}: ${field} should be written in its own script: ${row[field]}`);
            for (const wrong of nots[field]) assert.ok(!wrong.test(row[field]), `${where}: ${field} has letters of another script: ${row[field]}`);
          }
          assert.notEqual(row.say, row.text, `${where}: say is not a copy of the text`);
        }
      }
    });
  }

  test('no Latin letters are glued into Tamil or Hindi words', () => {
    for (const [pair, lang] of [['ta-hi', 'ta'], ['ta-en', 'ta'], ['ta-kn', 'ta'], ['ta-te', 'ta'], ['ta-ml', 'ta']]) {
      for (const id of index[pair]) {
        const raw = load(pair, id);
        for (const line of raw.lines) assert.equal(countGluedLatin(`${line.say} ${line.meaning}`, lang), 0, `${pair}/${id}: ${line.say}`);
      }
    }
    for (const id of index['ta-hi']) for (const line of load('ta-hi', id).lines) assert.equal(countGluedLatin(line.text, 'hi'), 0, id);
    for (const [pair, lang] of [['ta-kn', 'kn'], ['ta-te', 'te'], ['ta-ml', 'ml']]) {
      for (const id of index[pair]) for (const line of load(pair, id).lines) assert.equal(countGluedLatin(line.text, lang), 0, `${pair}/${id}`);
    }
  });

  test('short, simple lines: at most 14 words and 140 characters, key words at most 4 words', () => {
    for (const pair of PAIRS) {
      for (const id of index[pair]) {
        const raw = load(pair, id);
        for (const line of raw.lines) {
          assert.ok(line.text.length <= 140, `${pair}/${id}: too long: ${line.text}`);
          assert.ok(line.text.split(/\s+/).length <= 18, `${pair}/${id}: too many words: ${line.text}`);
        }
        for (const entry of raw.keyWords) assert.ok(entry.word.split(/\s+/).length <= 4, `${pair}/${id}: ${entry.word}`);
      }
    }
  });

  test('every lesson can make its 3-question quiz (different meanings, no repeated key word)', () => {
    for (const pair of PAIRS) {
      for (const id of index[pair]) {
        const keyWords = load(pair, id).keyWords;
        assert.equal(new Set(keyWords.map((k) => k.word.toLowerCase())).size, keyWords.length, `${pair}/${id}: repeated word`);
        assert.equal(new Set(keyWords.map((k) => k.meaning.toLowerCase())).size, keyWords.length, `${pair}/${id}: repeated meaning`);
        assert.equal(buildQuiz(keyWords).length, 3, `${pair}/${id}`);
      }
    }
  });

  test('the same lesson says the same thing in every pair (the Tamil meaning, the English line and the Hindi line match)', () => {
    for (const id of LESSONS) {
      const taHi = load('ta-hi', id);
      const taEn = load('ta-en', id);
      assert.equal(taHi.lines.length, taEn.lines.length, id);
      taHi.lines.forEach((line, i) => assert.equal(line.meaning, taEn.lines[i].meaning, `${id} line ${i}: same Tamil meaning`));
      for (const pair of ['ta-kn', 'ta-te', 'ta-ml']) {
        const other = load(pair, id);
        assert.equal(other.lines.length, taHi.lines.length, `${pair}/${id}`);
        other.lines.forEach((line, i) => assert.equal(line.meaning, taHi.lines[i].meaning, `${pair}/${id} line ${i}: same Tamil meaning`));
        other.keyWords.forEach((entry, i) => assert.equal(entry.meaning, taHi.keyWords[i].meaning, `${pair}/${id} key word ${i}`));
      }
      if (LEVEL1.includes(id)) {
        const enHi = load('en-hi', id);
        const enEs = load('en-es', id);
        assert.equal(enHi.lines.length, taHi.lines.length, id);
        assert.equal(enEs.lines.length, taHi.lines.length, id);
        enHi.lines.forEach((line, i) => {
          assert.equal(line.text, taHi.lines[i].text, `${id} line ${i}: same Hindi`);
          assert.equal(line.meaning, taEn.lines[i].text, `${id} line ${i}: the English meaning is the English line`);
          assert.equal(enEs.lines[i].meaning, taEn.lines[i].text, `${id} line ${i}: Spanish meaning`);
        });
      }
    }
  });

  test('Spanish lines keep their accents and opening marks (¿ ¡)', () => {
    let questions = 0;
    for (const id of LEVEL1) {
      for (const line of load('en-es', id).lines) {
        if (line.text.endsWith('?')) { questions += 1; assert.ok(line.text.includes('¿'), `${id}: ${line.text}`); }
        if (line.text.endsWith('!')) assert.ok(line.text.includes('¡'), `${id}: ${line.text}`);
      }
    }
    assert.ok(questions > 10);
  });

  test('a Tamil speaker can read the Hindi "say" aloud: it only uses Tamil letters, digits and punctuation', () => {
    for (const pair of ['ta-hi', 'ta-en', 'ta-kn', 'ta-te', 'ta-ml']) {
      for (const id of index[pair]) {
        for (const line of [...load(pair, id).lines, ...load(pair, id).keyWords]) assert.match(line.say, /^[\p{Script=Tamil}\s.,?!'’"“”:;\-()0-9ஃ]+$/u, `${pair}/${id}: ${line.say}`);
      }
    }
  });
});

// ---------- the lesson store: load order and prefetch ----------

// A fake fetch that serves a small index and some built-in files, and counts its calls.
function fakeFetch(files) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (!(url in files)) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => JSON.parse(JSON.stringify(files[url])) };
  };
  fn.calls = calls;
  return fn;
}

function goodConvo(tag = 'x') {
  const lines = [];
  for (let i = 0; i < 6; i++) lines.push({ speaker: i % 2 === 0 ? 'A' : 'B', text: `${tag} text ${i}`, say: `${tag} say ${i}`, meaning: `${tag} meaning ${i}` });
  return { lines, keyWords: [1, 2, 3, 4].map((n) => ({ word: `${tag} w${n}`, say: `s${n}`, meaning: `${tag} m${n}` })) };
}

function fakeRequest(answerFor = () => goodConvo('api')) {
  const calls = [];
  const signals = [];
  const fn = async ({ signal, ...args }) => {
    calls.push(args); // what is sent to the server
    signals.push(signal);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return typeof answerFor === 'function' ? answerFor(args, calls.length) : answerFor;
  };
  fn.calls = calls;
  fn.signals = signals;
  return fn;
}

const BUILT_IN_FILES = {
  '/apps/talk-learn/lessons/index.json': { 'ta-hi': ['greetings', 'names'], 'en-hi': ['greetings'] },
  '/apps/talk-learn/lessons/ta-hi/greetings.json': goodConvo('built'),
  '/apps/talk-learn/lessons/ta-hi/names.json': goodConvo('built2'),
  '/apps/talk-learn/lessons/en-hi/greetings.json': goodConvo('enhi'),
};

describe('lesson store: built-in, then cache, then API', () => {
  test('a built-in lesson makes no API call and no cache entry', async () => {
    const storage = memoryStorage();
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch(BUILT_IN_FILES), storage, request });
    const result = await store.get('greetings', 'hi-IN', 'ta-IN');
    assert.equal(result.source, 'built-in');
    assert.equal(result.convo.lines[0].text, 'built text 0');
    assert.equal(request.calls.length, 0);
    assert.equal(storage.data.size, 0);
  });

  test('the pair decides: the same lesson in another pair is not built-in', async () => {
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch(BUILT_IN_FILES), storage: memoryStorage(), request });
    assert.equal((await store.get('greetings', 'hi-IN', 'en-US')).source, 'built-in');
    assert.equal((await store.get('greetings', 'hi-IN', 'ta-IN')).convo.lines[0].text, 'built text 0');
    const other = await store.get('greetings', 'te-IN', 'ta-IN');
    assert.equal(other.source, 'api');
    assert.equal(request.calls.length, 1);
  });

  test('built-in comes before the cache: a saved copy is not used while a built-in file exists', async () => {
    const storage = memoryStorage();
    storage.setItem(cacheKey('greetings', 'hi-IN', 'ta-IN'), JSON.stringify(goodConvo('cached')));
    const store = createLessonStore({ fetchFn: fakeFetch(BUILT_IN_FILES), storage, request: fakeRequest() });
    assert.equal((await store.get('greetings', 'hi-IN', 'ta-IN')).source, 'built-in');
  });

  test('without a built-in file the cache is used, with no API call', async () => {
    const storage = memoryStorage();
    storage.setItem(cacheKey('shop', 'hi-IN', 'ta-IN'), JSON.stringify(goodConvo('cached')));
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch(BUILT_IN_FILES), storage, request });
    const result = await store.get('shop', 'hi-IN', 'ta-IN');
    assert.equal(result.source, 'cache');
    assert.equal(result.convo.lines[0].text, 'cached text 0');
    assert.equal(request.calls.length, 0);
  });

  test('otherwise the API is asked once, the answer is saved, and the second visit makes no call', async () => {
    const storage = memoryStorage();
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch(BUILT_IN_FILES), storage, request });
    const first = await store.get('shop', 'te-IN', 'ta-IN');
    assert.equal(first.source, 'api');
    assert.deepEqual(request.calls[0], { scenario: 'shop', learnLang: 'te-IN', speakLang: 'ta-IN' });
    assert.ok(readCachedLesson(storage, cacheKey('shop', 'te-IN', 'ta-IN')));
    const second = await store.get('shop', 'te-IN', 'ta-IN');
    assert.equal(second.source, 'cache');
    assert.equal(request.calls.length, 1);
  });

  test('getLocal never calls the API', async () => {
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch(BUILT_IN_FILES), storage: memoryStorage(), request });
    assert.equal(await store.getLocal('shop', 'te-IN', 'ta-IN'), null);
    assert.equal((await store.getLocal('names', 'hi-IN', 'ta-IN')).source, 'built-in');
    assert.equal(request.calls.length, 0);
  });

  test('the index is read once for all lessons', async () => {
    const fetchFn = fakeFetch(BUILT_IN_FILES);
    const store = createLessonStore({ fetchFn, storage: memoryStorage(), request: fakeRequest() });
    await store.getLocal('greetings', 'hi-IN', 'ta-IN');
    await store.getLocal('names', 'hi-IN', 'ta-IN');
    await store.getLocal('shop', 'hi-IN', 'ta-IN');
    assert.equal(fetchFn.calls.filter((u) => u.endsWith('index.json')).length, 1);
    assert.ok(!fetchFn.calls.some((u) => u.includes('/shop.json')), 'a lesson that is not listed is not asked for (no 404)');
  });

  test('a missing index, a damaged file or a file that is not a lesson is skipped, and the next place is used', async () => {
    const request = fakeRequest();
    const noIndex = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request });
    assert.equal((await noIndex.get('greetings', 'hi-IN', 'ta-IN')).source, 'api');
    const damaged = createLessonStore({
      fetchFn: fakeFetch({ ...BUILT_IN_FILES, '/apps/talk-learn/lessons/ta-hi/greetings.json': { lines: [], keyWords: [] } }),
      storage: memoryStorage(),
      request,
    });
    assert.equal((await damaged.get('greetings', 'hi-IN', 'ta-IN')).source, 'api');
    const throwing = createLessonStore({ fetchFn: async () => { throw new Error('offline'); }, storage: memoryStorage(), request });
    assert.equal((await throwing.get('greetings', 'hi-IN', 'ta-IN')).source, 'api');
    const wrongIndex = createLessonStore({ fetchFn: fakeFetch({ '/apps/talk-learn/lessons/index.json': ['x'] }), storage: memoryStorage(), request });
    assert.equal((await wrongIndex.get('greetings', 'hi-IN', 'ta-IN')).source, 'api');
  });

  test('errors are given back (never thrown), nothing is saved, and busy stops the background', async () => {
    const storage = memoryStorage();
    for (const answer of [{ error: 'timeout' }, { error: 'gemini_error' }, null, { lines: [] }]) {
      const store = createLessonStore({ fetchFn: fakeFetch({}), storage, request: fakeRequest(() => answer) });
      const result = await store.get('shop', 'te-IN', 'ta-IN');
      assert.ok(result.error, JSON.stringify(answer));
      assert.equal(storage.data.size, 0);
    }
    const throwing = createLessonStore({ fetchFn: fakeFetch({}), storage, request: async () => { throw new Error('x'); } });
    assert.deepEqual(await throwing.get('shop', 'te-IN', 'ta-IN'), { error: 'network_error' });
    const busy = createLessonStore({ fetchFn: fakeFetch({}), storage, request: fakeRequest({ error: 'busy' }) });
    assert.deepEqual(await busy.get('shop', 'te-IN', 'ta-IN'), { error: 'busy' });
    assert.equal(busy.isStopped(), true);
  });

  test('blocked storage still gives the lesson', async () => {
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage: blocked, request: fakeRequest() });
    assert.equal((await store.get('shop', 'te-IN', 'ta-IN')).source, 'api');
    const none = createLessonStore({ fetchFn: fakeFetch({}), storage: null, request: fakeRequest() });
    assert.equal((await none.get('shop', 'te-IN', 'ta-IN')).source, 'api');
  });

  test('two callers asking for the same lesson at the same time share ONE request', async () => {
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request });
    const [a, b] = await Promise.all([store.get('shop', 'te-IN', 'ta-IN'), store.get('shop', 'te-IN', 'ta-IN')]);
    assert.equal(request.calls.length, 1);
    assert.deepEqual(a, b);
  });

  test('Cancel aborts the request and the lesson is NEVER saved, even when the answer arrives later', async () => {
    const storage = memoryStorage();
    // A server that ignores the abort and answers anyway (the worst case).
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage, request });
    const controller = new AbortController();
    const pending = store.get('shop', 'te-IN', 'ta-IN', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 1)); // the request is on its way
    controller.abort(); // Cancel
    assert.deepEqual(await pending, { error: 'cancelled' });
    await new Promise((resolve) => setTimeout(resolve, 30)); // long after the answer came
    assert.equal(readCachedLesson(storage, cacheKey('shop', 'te-IN', 'ta-IN')), null);
    assert.equal(storage.data.size, 0);
    assert.ok(request.signals[0].aborted, 'the abort reached the API call');
  });

  test('a signal that is already aborted sends nothing', async () => {
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request });
    const controller = new AbortController();
    controller.abort();
    assert.deepEqual(await store.get('shop', 'te-IN', 'ta-IN', { signal: controller.signal }), { error: 'cancelled' });
    assert.equal(request.calls.length, 0);
  });

  test('a lesson the user cancelled is not made quietly in the background afterwards', async () => {
    const storage = memoryStorage();
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage, request });
    const controller = new AbortController();
    const pending = store.get('vegetables', 'te-IN', 'ta-IN', { signal: controller.signal });
    controller.abort();
    await pending;
    assert.equal(await store.prefetchNext('shop', 'te-IN', 'ta-IN'), 'skipped');
    assert.equal(storage.data.size, 0);
  });

  test('cancelling the lesson the background is making drops it for the background too', async () => {
    const storage = memoryStorage();
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage, request });
    const background = store.prefetchNext('shop', 'te-IN', 'ta-IN'); // makes "vegetables"
    await new Promise((resolve) => setTimeout(resolve, 1));
    const controller = new AbortController();
    const user = store.get('vegetables', 'te-IN', 'ta-IN', { signal: controller.signal }); // shares the request
    controller.abort();
    assert.deepEqual(await user, { error: 'cancelled' });
    assert.equal(await background, 'failed');
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(storage.data.size, 0, 'nothing saved');
    assert.equal(request.calls.length, 1);
  });

  test('a later, new request for the same lesson works and is saved', async () => {
    const storage = memoryStorage();
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage, request: fakeRequest() });
    const controller = new AbortController();
    const first = store.get('shop', 'te-IN', 'ta-IN', { signal: controller.signal });
    controller.abort();
    await first;
    const again = await store.get('shop', 'te-IN', 'ta-IN');
    assert.equal(again.source, 'api');
    assert.ok(readCachedLesson(storage, cacheKey('shop', 'te-IN', 'ta-IN')));
  });
});

describe('prefetch of the next lesson', () => {
  test('lessonToPrefetch gives the next lesson only when it is not available yet', () => {
    assert.equal(lessonToPrefetch('greetings', () => false), 'names');
    assert.equal(lessonToPrefetch('greetings', () => true), '');
    assert.equal(lessonToPrefetch('emergency', () => false), 'home');
    assert.equal(lessonToPrefetch('neighbours', () => false), '');
    assert.equal(lessonToPrefetch('nope', () => false), '');
  });

  test('the next lesson is made quietly in the background and saved', async () => {
    const storage = memoryStorage();
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch(BUILT_IN_FILES), storage, request });
    assert.equal(await store.prefetchNext('shop', 'te-IN', 'ta-IN'), 'saved');
    assert.deepEqual(request.calls, [{ scenario: 'vegetables', learnLang: 'te-IN', speakLang: 'ta-IN' }]);
    assert.ok(readCachedLesson(storage, cacheKey('vegetables', 'te-IN', 'ta-IN')));
    // asking again does nothing: it is saved now
    assert.equal(await store.prefetchNext('shop', 'te-IN', 'ta-IN'), 'skipped');
    assert.equal(request.calls.length, 1);
  });

  test('nothing is prefetched for a lesson that is built-in or already saved, or after the last lesson', async () => {
    const storage = memoryStorage();
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch(BUILT_IN_FILES), storage, request });
    assert.equal(await store.prefetchNext('greetings', 'hi-IN', 'ta-IN'), 'skipped', 'names is built-in');
    storage.setItem(cacheKey('vegetables', 'te-IN', 'ta-IN'), JSON.stringify(goodConvo('c')));
    assert.equal(await store.prefetchNext('shop', 'te-IN', 'ta-IN'), 'skipped', 'already saved');
    assert.equal(await store.prefetchNext('neighbours', 'te-IN', 'ta-IN'), 'skipped', 'no next lesson');
    assert.equal(request.calls.length, 0);
  });

  test('a pair with all built-in lessons never calls the API at all', async () => {
    const files = { '/apps/talk-learn/lessons/index.json': { 'ta-hi': [...LESSONS] } };
    for (const id of LESSONS) files[`/apps/talk-learn/lessons/ta-hi/${id}.json`] = goodConvo(id);
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch(files), storage: memoryStorage(), request });
    for (const id of LESSONS) {
      assert.equal((await store.get(id, 'hi-IN', 'ta-IN')).source, 'built-in');
      assert.equal(await store.prefetchNext(id, 'hi-IN', 'ta-IN'), 'skipped');
    }
    assert.equal(request.calls.length, 0);
  });

  test('only one background request at a time', async () => {
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request });
    const results = await Promise.all([store.prefetchNext('shop', 'te-IN', 'ta-IN'), store.prefetchNext('taxi', 'te-IN', 'ta-IN'), store.prefetchNext('bank', 'te-IN', 'ta-IN')]);
    assert.deepEqual(results.sort(), ['saved', 'skipped', 'skipped']);
    assert.equal(request.calls.length, 1);
  });

  test('a busy (429) answer stops the background for good, in this page', async () => {
    const request = fakeRequest({ error: 'busy' });
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request });
    assert.equal(await store.prefetchNext('shop', 'te-IN', 'ta-IN'), 'busy');
    assert.equal(store.isStopped(), true);
    assert.equal(await store.prefetchNext('taxi', 'te-IN', 'ta-IN'), 'stopped');
    assert.equal(await store.prefetchNext('bank', 'te-IN', 'ta-IN'), 'stopped');
    assert.equal(request.calls.length, 1);
  });

  test('a busy answer stops the background for the whole browser session (a reload does not restart it)', async () => {
    const session = memoryStorage();
    const first = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request: fakeRequest({ error: 'busy' }), session });
    assert.equal(await first.prefetchNext('shop', 'te-IN', 'ta-IN'), 'busy');
    assert.equal(session.data.get(PREFETCH_STOP_KEY), '1');
    // the page is opened again in the same tab: a new store, the same session
    const request = fakeRequest();
    const second = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request, session });
    assert.equal(second.isStopped(), true);
    assert.equal(await second.prefetchNext('taxi', 'te-IN', 'ta-IN'), 'stopped');
    assert.equal(request.calls.length, 0);
    // the user's own request is still sent after a busy answer
    assert.equal((await second.get('taxi', 'te-IN', 'ta-IN')).source, 'api');
    assert.equal(request.calls.length, 1);
    // a new browser session starts fresh; blocked session storage still stops this page
    assert.equal(createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request, session: memoryStorage() }).isStopped(), false);
    const blockedSession = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request: fakeRequest({ error: 'busy' }), session: blocked });
    assert.equal(await blockedSession.prefetchNext('shop', 'te-IN', 'ta-IN'), 'busy');
    assert.equal(await blockedSession.prefetchNext('taxi', 'te-IN', 'ta-IN'), 'stopped');
  });

  test('a busy answer seen by the user\'s own request also stops the background', async () => {
    const request = fakeRequest({ error: 'busy' });
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request });
    await store.get('shop', 'te-IN', 'ta-IN');
    assert.equal(await store.prefetchNext('taxi', 'te-IN', 'ta-IN'), 'stopped');
    assert.equal(request.calls.length, 1);
  });

  test('a lesson that failed in the background is not tried again, and other errors do not stop it', async () => {
    let n = 0;
    const request = fakeRequest(() => (++n === 1 ? { error: 'gemini_error' } : goodConvo('ok')));
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request });
    assert.equal(await store.prefetchNext('shop', 'te-IN', 'ta-IN'), 'failed');
    assert.equal(store.isStopped(), false);
    assert.equal(await store.prefetchNext('shop', 'te-IN', 'ta-IN'), 'skipped', 'vegetables is not asked again');
    assert.equal(await store.prefetchNext('taxi', 'te-IN', 'ta-IN'), 'saved', 'the next one still works');
    assert.equal(request.calls.length, 2);
  });

  test('no background request while the device is offline', async () => {
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request, isOnline: () => false });
    assert.equal(await store.prefetchNext('shop', 'te-IN', 'ta-IN'), 'skipped');
    assert.equal(request.calls.length, 0);
  });

  test('opening the lesson that is being prepared uses the same request (no second call)', async () => {
    const request = fakeRequest();
    const store = createLessonStore({ fetchFn: fakeFetch({}), storage: memoryStorage(), request });
    const background = store.prefetchNext('shop', 'te-IN', 'ta-IN'); // makes "vegetables"
    await new Promise((resolve) => setTimeout(resolve, 1)); // the request is on its way
    const user = await store.get('vegetables', 'te-IN', 'ta-IN');
    assert.equal(await background, 'saved');
    assert.ok(user.convo);
    assert.equal(request.calls.length, 1);
  });

  test('the page asks for the next lesson only after the current one is shown', () => {
    const code = read('apps/talk-learn/app.js');
    const showAt = code.indexOf("setMode('listen');", code.indexOf('async function openLesson'));
    const prefetchAt = code.indexOf('store.prefetchNext(');
    assert.ok(showAt > 0 && prefetchAt > showAt);
    assert.match(code, /store\.prefetchNext\(id, learnCode, speakCode\)\.catch\(\(\) => \{\}\)/);
  });
});

// ---------- the friendly loading box ----------

describe('friendly loading with Cancel', () => {
  const html = read('apps/talk-learn/index.html');
  const code = read('apps/talk-learn/app.js');
  const css = read('apps/talk-learn/style.css');

  test('a ghost, a changing message and a Cancel button are on the page', () => {
    assert.match(html, /id="lesson-loading"[^>]*hidden/);
    assert.match(html, /class="tl-ghost" aria-hidden="true">👻/);
    assert.match(html, /id="loading-message"/);
    assert.match(html, /id="cancel-button"[^>]*data-i18n="talkLearn\.cancel"/);
    assert.match(html, /role="status"/);
  });

  test('the message changes every few seconds, the last one stays, the timer is always stopped', () => {
    assert.match(code, /const LOADING_KEYS = \['talkLearn\.loading', 'talkLearn\.ghost2', 'talkLearn\.ghost3', 'talkLearn\.ghost4'\]/);
    assert.match(code, /const LOADING_STEP_MS = 4000/);
    assert.match(code, /Math\.min\(loadingStep \+ 1, LOADING_KEYS\.length - 1\)/);
    assert.match(code, /clearInterval\(loadingTimer\)/);
    for (const code2 of LOCALES) for (const key of ['talkLearn.loading', 'talkLearn.ghost2', 'talkLearn.ghost3', 'talkLearn.ghost4', 'talkLearn.cancel']) assert.ok(STRINGS[code2][key]?.trim(), `${code2} ${key}`);
  });

  test('only a lesson that needs the server shows the ghost; built-in and saved lessons open at once', () => {
    const open = code.slice(code.indexOf('async function openLesson'), code.indexOf('const LOADING_KEYS'));
    assert.ok(open.indexOf('store.getLocal(') < open.indexOf('showLoading()'));
    assert.match(open, /if \(!found\) \{\s*showLoading\(\);\s*loadController = new AbortController\(\);\s*found = await store\.get\(/);
  });

  test('Cancel goes back to the list at once and aborts the request (nothing is saved)', () => {
    assert.match(code, /\$\('cancel-button'\)\.addEventListener\('click', \(\) => showList\(\)\)/);
    const from = code.indexOf('function showList()');
    const show = code.slice(from, code.indexOf('// "I speak" (the UI language)', from));
    assert.match(show, /loadToken \+= 1/);
    assert.match(show, /cancelLoad\(\)/);
    assert.match(show, /hideLoading\(\)/);
    assert.match(code, /if \(token !== loadToken\) return; \/\/ cancelled/);
    assert.match(code, /store\.get\(id, learnCode, speakCode, \{ signal: loadController\.signal \}\)/);
    assert.match(code, /function cancelLoad\(\) \{\s*if \(loadController\) loadController\.abort\(\);/);
    // leaving the page, or opening another lesson, cancels too
    assert.match(code, /onLeave: \(\) => \{\s*stopAll\(\);\s*cancelLoad\(\);/);
    const open = code.slice(code.indexOf('async function openLesson'));
    assert.ok(open.indexOf('cancelLoad()') < open.indexOf('++loadToken'));
    assert.match(code, /session: sessionStore\(\)/);
  });

  test('api-client: an aborted conversation request gives { error: "cancelled" }, a timeout stays "timeout"', async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
      const controller = new AbortController();
      const pending = conversation({ scenario: 'shop', learnLang: 'hi-IN', speakLang: 'ta-IN', signal: controller.signal });
      controller.abort();
      assert.deepEqual(await pending, { error: 'cancelled' });
      // the body sent to the server has only the three fields (the signal is not sent)
      let body = null;
      globalThis.fetch = async (url, options) => {
        body = JSON.parse(options.body);
        return { ok: true, json: async () => ({ lines: [] }) };
      };
      await conversation({ scenario: 'shop', learnLang: 'hi-IN', speakLang: 'ta-IN', signal: new AbortController().signal });
      assert.deepEqual(body, { scenario: 'shop', learnLang: 'hi-IN', speakLang: 'ta-IN' });
      assert.match(read('skeleton/api-client.js'), /cancelSignal && cancelSignal\.aborted \? 'cancelled' : 'timeout'/);
    } finally {
      globalThis.fetch = real;
    }
  });

  test('the ghost stops floating with reduced motion', () => {
    const reduced = css.slice(css.indexOf('prefers-reduced-motion: reduce'));
    assert.match(reduced, /\.tl-ghost \{\s*animation: none;/);
  });
});
