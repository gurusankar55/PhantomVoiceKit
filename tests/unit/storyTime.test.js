// storyTime.test.js
// The Story time rules (progress, text size, spoken commands) and the story texts in the real
// locale files of all 20 languages. No browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';

import { parseWords } from '../../skeleton/voice-commands.js';
import {
  STORIES, STORY_IDS, PARAGRAPHS, titleKey, paragraphKey, clampParagraph, stepParagraph, afterParagraphEnd,
  PROGRESS_KEY, emptyProgress, cleanProgress, loadProgress, saveProgress, atParagraph, finishStory,
  FONT_STEPS, clampFontStep, fontScale, storyCommand,
} from '../../apps/story-time/story-utils.js';

const LOCALES = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr'];
const STRINGS = Object.fromEntries(LOCALES.map((code) => [code, JSON.parse(readFileSync(new URL(`../../skeleton/locales/${code}.json`, import.meta.url), 'utf8'))]));

// A tiny in-memory storage, and one that always throws (private mode, blocked storage).
function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
}
const blockedStorage = {
  getItem() { throw new Error('blocked'); },
  setItem() { throw new Error('blocked'); },
};

// The command words of one language, as the app reads them.
function wordsOf(code) {
  const s = STRINGS[code];
  return {
    next: parseWords(s['storyTime.nextWords']),
    back: parseWords(s['storyTime.backWords']),
    stop: parseWords(s['storyTime.stopWords']),
  };
}

describe('the 6 stories in all 20 languages', () => {
  test('6 different stories, each with an emoji', () => {
    assert.equal(STORIES.length, 6);
    assert.equal(new Set(STORY_IDS).size, 6);
    for (const story of STORIES) assert.ok(story.emoji.length > 0, story.id);
  });

  test('every emoji is one plain picture (no joined sequences that Windows shows as a box)', () => {
    for (const story of STORIES) {
      assert.ok(!story.emoji.includes('\u200D'), `${story.id} uses a zero-width joiner`);
      assert.equal([...story.emoji.replace(/\uFE0F/g, '')].length, 1, story.id);
    }
    assert.equal(STORIES.find((s) => s.id === 'crow').emoji, '🐦');
  });

  test('every title and all 8 paragraphs exist and are not empty in every locale', () => {
    for (const code of LOCALES) {
      for (const id of STORY_IDS) {
        const keys = [titleKey(id), ...Array.from({ length: PARAGRAPHS }, (_, i) => paragraphKey(id, i))];
        for (const key of keys) {
          assert.equal(typeof STRINGS[code][key], 'string', `${code} ${key}`);
          assert.ok(STRINGS[code][key].trim() !== '', `${code} ${key}`);
        }
      }
    }
  });

  test('a translated story is not just the English text (except English itself)', () => {
    for (const code of LOCALES.filter((c) => c !== 'en')) {
      for (const id of STORY_IDS) {
        assert.notEqual(STRINGS[code][paragraphKey(id, 0)], STRINGS.en[paragraphKey(id, 0)], `${code} ${id}`);
      }
    }
  });

  test('paragraph keys are p1 to p8', () => {
    assert.equal(paragraphKey('lion', 0), 'story.lion.p1');
    assert.equal(paragraphKey('lion', 7), 'story.lion.p8');
    assert.equal(titleKey('ghost'), 'story.ghost.title');
  });
});

describe('clampParagraph', () => {
  test('always a whole number from 0 to 7 (100 runs)', () => {
    fc.assert(fc.property(fc.anything(), (value) => {
      const n = clampParagraph(value);
      return Number.isInteger(n) && n >= 0 && n < PARAGRAPHS;
    }), { numRuns: 100 });
  });

  test('keeps valid numbers', () => {
    assert.equal(clampParagraph(3), 3);
    assert.equal(clampParagraph(-1), 0);
    assert.equal(clampParagraph(99), 7);
    assert.equal(clampParagraph('x'), 0);
  });
});

describe('Next and Back move exactly one paragraph', () => {
  test('one step from the highlighted paragraph, stopping at the first and last', () => {
    assert.equal(stepParagraph(0, 1), 1);
    assert.equal(stepParagraph(3, 1), 4);
    assert.equal(stepParagraph(3, -1), 2);
    assert.equal(stepParagraph(0, -1), 0);
    assert.equal(stepParagraph(7, 1), 7);
  });

  test('never more than one step, whatever the delta (100 runs)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 7 }), fc.integer({ min: -50, max: 50 }), (index, delta) => {
      const next = stepParagraph(index, delta);
      return Math.abs(next - index) <= 1 && next >= 0 && next < PARAGRAPHS;
    }), { numRuns: 100 });
  });

  test('the end of the paragraph being read moves on by one', () => {
    assert.equal(afterParagraphEnd({ run: 4, index: 0 }, { run: 4, index: 0, playing: true }), 1);
    assert.equal(afterParagraphEnd({ run: 4, index: 7 }, { run: 4, index: 7, playing: true }), 'finish');
  });

  test('a late end event after Pause, Next or Back is ignored', () => {
    // Paused: the run changed and nothing is playing.
    assert.equal(afterParagraphEnd({ run: 4, index: 0 }, { run: 5, index: 0, playing: false }), 'ignore');
    // Paused and then Next: the highlighted paragraph is now 1; the old end must not make it 2.
    assert.equal(afterParagraphEnd({ run: 4, index: 0 }, { run: 6, index: 1, playing: false }), 'ignore');
    // Next while reading: a new run reads paragraph 1; the end of the old paragraph 0 is ignored.
    assert.equal(afterParagraphEnd({ run: 4, index: 0 }, { run: 6, index: 1, playing: true }), 'ignore');
    // Same run, but the position was moved: ignored too.
    assert.equal(afterParagraphEnd({ run: 4, index: 0 }, { run: 4, index: 1, playing: true }), 'ignore');
    assert.equal(afterParagraphEnd(null, { run: 1, index: 0, playing: true }), 'ignore');
  });

  test('Pause, Next, then the old end event: exactly one step in total', () => {
    // A small model of the reader: the same rules app.js uses.
    const reader = { run: 1, index: 0, playing: true };
    const spoken = { run: reader.run, index: reader.index }; // paragraph 1 is being read
    reader.run += 1; reader.playing = false; // Pause
    reader.run += 1; reader.index = stepParagraph(reader.index, 1); // Next
    const late = afterParagraphEnd(spoken, reader); // the browser reports the old end late
    if (typeof late === 'number') reader.index = late;
    assert.equal(reader.index, 1);
  });
});

describe('progress', () => {
  test('save then load gives the same progress', () => {
    const storage = memoryStorage();
    let progress = atParagraph(emptyProgress(), 'crow', 4);
    progress = finishStory(progress, 'lion');
    progress = { ...progress, fontStep: 3 };
    assert.equal(saveProgress(storage, progress), true);
    assert.ok(storage.data.has(PROGRESS_KEY));
    assert.deepEqual(loadProgress(storage), cleanProgress(progress));
  });

  test('atParagraph remembers the story and the paragraph', () => {
    const progress = atParagraph(emptyProgress(), 'ant', 5);
    assert.equal(progress.last, 'ant');
    assert.equal(progress.at.ant, 5);
    assert.equal(atParagraph(progress, 'ant', 50).at.ant, 7);
  });

  test('finishStory marks the story read and starts it again from the beginning', () => {
    let progress = atParagraph(emptyProgress(), 'tortoise', 7);
    progress = finishStory(progress, 'tortoise');
    assert.deepEqual(progress.finished, ['tortoise']);
    assert.equal(progress.at.tortoise, 0);
    progress = finishStory(progress, 'lion');
    assert.deepEqual(progress.finished, ['lion', 'tortoise']); // list order, no duplicates
    assert.deepEqual(finishStory(progress, 'lion').finished, ['lion', 'tortoise']);
  });

  test('unknown stories are ignored', () => {
    assert.deepEqual(atParagraph(emptyProgress(), 'dragon', 2), emptyProgress());
    assert.deepEqual(finishStory(emptyProgress(), 'dragon'), emptyProgress());
  });

  test('blocked or broken storage never throws', () => {
    assert.deepEqual(loadProgress(blockedStorage), emptyProgress());
    assert.equal(saveProgress(blockedStorage, emptyProgress()), false);
    assert.deepEqual(loadProgress(undefined), emptyProgress());
    const broken = memoryStorage();
    broken.setItem(PROGRESS_KEY, '{not json');
    assert.deepEqual(loadProgress(broken), emptyProgress());
  });

  test('cleanProgress turns any value into valid progress (100 runs)', () => {
    fc.assert(fc.property(fc.anything(), (value) => {
      const p = cleanProgress(value);
      return (p.last === '' || STORY_IDS.includes(p.last))
        && Object.entries(p.at).every(([id, n]) => STORY_IDS.includes(id) && n >= 0 && n < PARAGRAPHS)
        && p.finished.every((id) => STORY_IDS.includes(id))
        && p.fontStep >= 0 && p.fontStep < FONT_STEPS.length;
    }), { numRuns: 100 });
  });
});

describe('text size', () => {
  test('the default is the normal size', () => {
    assert.equal(fontScale(undefined), 1);
    assert.equal(fontScale(emptyProgress().fontStep), 1);
  });

  test('A- and A+ stop at the smallest and biggest size', () => {
    assert.equal(clampFontStep(-5), 0);
    assert.equal(clampFontStep(99), FONT_STEPS.length - 1);
    assert.equal(fontScale(99), FONT_STEPS[FONT_STEPS.length - 1]);
  });

  test('bigger steps never give smaller text (100 runs)', () => {
    fc.assert(fc.property(fc.integer({ min: -10, max: 10 }), (step) => fontScale(step + 1) >= fontScale(step)), { numRuns: 100 });
  });
});

describe('storyCommand', () => {
  test('English words always work', () => {
    assert.equal(storyCommand('next'), 'next');
    assert.equal(storyCommand('Stop.'), 'stop');
    assert.equal(storyCommand('please go back'), 'back');
    assert.equal(storyCommand('continue'), 'next');
  });

  test('words of the chosen language', () => {
    assert.equal(storyCommand('அடுத்து', wordsOf('ta')), 'next');
    assert.equal(storyCommand('siguiente', wordsOf('es')), 'next');
    assert.equal(storyCommand('zurück', wordsOf('de')), 'back');
    assert.equal(storyCommand('стоп', wordsOf('ru')), 'stop');
    assert.equal(storyCommand('dừng lại', wordsOf('vi')), 'stop');
  });

  test('every locale word is understood as its own command', () => {
    for (const code of LOCALES) {
      const words = wordsOf(code);
      for (const command of ['next', 'back', 'stop']) {
        assert.ok(words[command].length > 0, `${code} ${command}`);
        for (const word of words[command]) assert.equal(storyCommand(word, words), command, `${code} "${word}"`);
      }
    }
  });

  test('silence and unrelated words give no command', () => {
    assert.equal(storyCommand(''), null);
    assert.equal(storyCommand('   '), null);
    assert.equal(storyCommand('elephant banana'), null);
  });
});

describe('button words are never broken', () => {
  const css = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  // The body of the first rule for `selector` ("sel {" or the start of a list "sel,").
  const rule = (text, selector) => {
    const start = text.indexOf(`${selector} {`) >= 0 ? text.indexOf(`${selector} {`) : text.indexOf(`${selector},`);
    assert.ok(start >= 0, selector);
    return text.slice(text.indexOf('{', start), text.indexOf('}', start));
  };

  test('the theme turns off breaking inside words for every button', () => {
    const body = rule(css('skeleton/theme.css'), '.btn');
    assert.match(body, /overflow-wrap:\s*normal/);
    assert.match(body, /word-break:\s*normal/);
  });

  test('no app style lets a button break anywhere inside a word', () => {
    for (const app of ['picture-book', 'pumpkin-math', 'story-time', 'ghost-echo', 'ghost-tutor', 'my-documents', 'voice-notes', 'spirit-clerk', 'form-translator', 'sticker-book']) {
      const text = css(`apps/${app}/style.css`);
      for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = m[1].trim();
        // Button-like selectors only (".story-play", "button", ".topic-chip"; not ".dual-display").
        if (/(^|[\s,.#>-])(btn|button|chip|choice|key|step|play)(?![\w])/.test(selector)) {
          assert.ok(!/overflow-wrap:\s*anywhere|word-break:\s*break-all/.test(m[2]), `${app}: ${selector}`);
        }
      }
    }
  });

  test('Picture book buttons go to a new row instead of squeezing', () => {
    const text = css('apps/picture-book/style.css');
    assert.match(rule(text, '.book-actions'), /auto-fit/);
    assert.match(rule(text, '.book-nav'), /auto-fit/);
  });
});

describe('no network in the three new apps', () => {
  test('Picture book, Pumpkin math and Story time make no fetch or API calls', () => {
    for (const app of ['picture-book', 'pumpkin-math', 'story-time']) {
      const code = readFileSync(new URL(`../../apps/${app}/app.js`, import.meta.url), 'utf8');
      assert.ok(!/\bfetch\s*\(/.test(code), `${app} fetch`);
      assert.ok(!/api-client/.test(code), `${app} api-client`);
    }
  });
});
