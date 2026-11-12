// tests/unit/speechUtils.test.js
// Voice-message style listening: done words, the safety stop, restarting the recognition and joining
// the parts (skeleton/speech-utils.js and skeleton/speech-input.js).
// A fake SpeechRecognition class is used, so no browser and no microphone are needed.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';

import {
  SAFETY_SILENCE_MS,
  joinParts,
  transcriptFromResults,
  silenceElapsed,
  splitDoneWord,
} from '../../skeleton/speech-utils.js';
import { createSpeechInput } from '../../skeleton/speech-input.js';
import { parseWords } from '../../skeleton/voice-commands.js';

// One result of a SpeechRecognition event: [{ transcript }] with an isFinal flag.
const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });

describe('safety silence', () => {
  test('15 seconds of total silence, and the old 2.5 s / 4 s logic is gone', async () => {
    assert.equal(SAFETY_SILENCE_MS, 15000);
    const utils = await import('../../skeleton/speech-utils.js');
    assert.equal(utils.SILENCE_MS, undefined);
    assert.equal(utils.LONG_SILENCE_MS, undefined);
    assert.equal(utils.silenceMsForKind, undefined);
  });

  test('silenceElapsed is true exactly when the silence has lasted long enough', () => {
    assert.equal(silenceElapsed(1000, 15999), false);
    assert.equal(silenceElapsed(1000, 16000), true);
    assert.equal(silenceElapsed(1000, 3500, 2500), true);
    assert.equal(silenceElapsed(1000, 3499, 2500), false);
  });
});

describe('joinParts and transcriptFromResults', () => {
  test('parts are trimmed, empty ones dropped, and joined with one space', () => {
    assert.equal(joinParts(['98765', ' 43210 ', '', null, undefined]), '98765 43210');
    assert.equal(joinParts([]), '');
    assert.equal(joinParts(undefined), '');
  });

  test('final and interim text are separated', () => {
    const parts = transcriptFromResults([result('abcde', true), result('1234', true), result('f', false)]);
    assert.deepEqual(parts, { final: 'abcde 1234', interim: 'f' });
    assert.deepEqual(transcriptFromResults([]), { final: '', interim: '' });
    assert.deepEqual(transcriptFromResults(undefined), { final: '', interim: '' });
  });

  test('property: joining never leaves a space at the ends', () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[ a-z0-9]{0,6}$/), { maxLength: 6 }), (parts) => {
        const joined = joinParts(parts);
        assert.equal(joined, joined.trim());
      })
    );
  });
});

describe('splitDoneWord: a done word at the END ends the answer', () => {
  const doneWords = ['done', 'finished', 'that is all', 'முடிந்தது', 'போதும்', '完成'];

  test('the done word is taken off the end', () => {
    assert.deepEqual(splitDoneWord('ABCDE 1234 F done', doneWords), { text: 'ABCDE 1234 F', done: true });
    assert.deepEqual(splitDoneWord('my name is Ravi. Done.', doneWords), { text: 'my name is Ravi.', done: true });
    assert.deepEqual(splitDoneWord('12 high street DONE!', doneWords), { text: '12 high street', done: true });
  });

  test('a done word of several words, and the longest word wins', () => {
    assert.deepEqual(splitDoneWord('Anna Nagar that is all', doneWords), { text: 'Anna Nagar', done: true });
  });

  test('only the done word: an empty text and done', () => {
    assert.deepEqual(splitDoneWord('done', doneWords), { text: '', done: true });
    assert.deepEqual(splitDoneWord(' Done. ', doneWords), { text: '', done: true });
  });

  test('a done word in the middle, or part of another word, is not a done word', () => {
    assert.deepEqual(splitDoneWord('done deal street', doneWords), { text: 'done deal street', done: false });
    assert.deepEqual(splitDoneWord('Undone', doneWords), { text: 'Undone', done: false });
    assert.deepEqual(splitDoneWord('abc defined', doneWords), { text: 'abc defined', done: false });
  });

  test('Tamil and Chinese done words', () => {
    assert.deepEqual(splitDoneWord('சென்னை முடிந்தது', doneWords), { text: 'சென்னை', done: true });
    assert.deepEqual(splitDoneWord('சென்னை போதும்.', doneWords), { text: 'சென்னை', done: true });
    assert.deepEqual(splitDoneWord('北京市完成', doneWords), { text: '北京市', done: true });
    assert.deepEqual(splitDoneWord('北京市完成。', doneWords), { text: '北京市', done: true });
  });

  test('no done words or no text gives no done', () => {
    assert.deepEqual(splitDoneWord('hello done', []), { text: 'hello done', done: false });
    assert.deepEqual(splitDoneWord('', doneWords), { text: '', done: false });
    assert.deepEqual(splitDoneWord(undefined, doneWords), { text: '', done: false });
  });

  test('property: a text without a done word is returned unchanged (trimmed)', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-c ]{0,20}$/), (text) => {
        const out = splitDoneWord(text, ['done']);
        assert.equal(out.done, false);
        assert.equal(out.text, text.trim());
      })
    );
  });
});

describe('done words in every locale', () => {
  const dir = path.join(process.cwd(), 'skeleton', 'locales');
  const codes = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  const load = (code) => JSON.parse(fs.readFileSync(path.join(dir, `${code}.json`), 'utf8'));

  for (const code of codes) {
    test(code, () => {
      const data = load(code);
      const done = parseWords(data['voice.doneWords']);
      assert.ok(done.length >= 3, 'at least 3 done words');
      // The word on the Done button works as a done word.
      assert.ok(done.includes(parseWords(data['spiritClerk.done'])[0]), 'the button word is a done word');
      // A done word is never also a "correct" or "wrong" word.
      const others = [...parseWords(data['voice.correctWords']), ...parseWords(data['voice.wrongWords'])];
      for (const word of done) assert.ok(!others.includes(word), `${word} is also a correct / wrong word`);
      // Every done word ends an answer.
      for (const word of done) {
        const spoken = splitDoneWord(`ABC ${word}.`, done);
        assert.equal(spoken.done, true, word);
        assert.equal(spoken.text, 'ABC', word);
      }
    });
  }

  test('Tamil done words are exactly as requested', () => {
    assert.deepEqual(parseWords(load('ta')['voice.doneWords']), ['முடிந்தது', 'முடிஞ்சது', 'போதும்', 'done']);
  });
});

// ---------- Listening with a fake recognizer ----------

let created;
class FakeRecognition {
  constructor() {
    this.starts = 0;
    this.stops = 0;
    this.running = false;
    this.failStarts = 0; // how many start() calls throw before one works
    created.push(this);
  }
  start() {
    if (this.failStarts > 0) {
      this.failStarts -= 1;
      throw new Error('InvalidStateError');
    }
    if (this.running) throw new Error('already started');
    this.running = true;
    this.starts += 1;
  }
  stop() {
    this.stops += 1;
    this.running = false;
    setImmediate(() => this.onend && this.onend()); // like a browser: the end event follows stop()
  }
  abort() {
    this.running = false;
  }
  // Test helpers
  say(...results) {
    this.onresult({ results });
  }
  browserEnds() {
    this.running = false;
    this.onend();
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('listening like a voice message', () => {
  beforeEach(() => {
    created = [];
    globalThis.window = { SpeechRecognition: FakeRecognition };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  function make(options = {}) {
    const seen = { results: [], errors: [], interim: [] };
    const input = createSpeechInput({
      lang: 'ta-IN',
      onResult: (text) => seen.results.push(text),
      onError: (info) => seen.errors.push(info),
      onInterim: (text) => seen.interim.push(text),
      ...options,
    });
    return { input, seen, recognition: created[created.length - 1] };
  }

  test('a pause does NOT end the answer; only "Done" (finish) does', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, safetyMs: 60_000 });
    assert.equal(recognition.continuous, true);
    assert.equal(recognition.interimResults, true);

    recognition.say(result('98765', true));
    await sleep(300); // a long pause: nothing happens
    assert.deepEqual(seen.results, []);
    recognition.say(result('98765', true), result('43210', true));
    await sleep(300);
    assert.deepEqual(seen.results, []);

    input.finish();
    await sleep(30);
    assert.deepEqual(seen.results, ['98765 43210']);
    assert.deepEqual(seen.errors, []);
  });

  test('the language of one answer can differ from the default (en-IN for a PAN code)', () => {
    const { input, recognition } = make();
    input.start({ continuous: true, lang: 'en-IN', safetyMs: 60_000 });
    assert.equal(recognition.lang, 'en-IN');
    input.stop();
    input.start({ continuous: false });
    assert.equal(recognition.lang, 'ta-IN');
    input.stop();
  });

  test('the live text grows while the user speaks', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, safetyMs: 60_000 });
    recognition.say(result('abc', false));
    recognition.say(result('abcde', false));
    recognition.say(result('abcde 12', true));
    assert.deepEqual(seen.interim, ['abc', 'abcde', 'abcde 12']);
    input.stop();
  });

  test('a done word ends the answer and is not part of the text', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, safetyMs: 60_000, doneWords: ['done', 'முடிந்தது'] });
    recognition.say(result('ABCDE', true));
    await sleep(30);
    assert.deepEqual(seen.results, []);
    recognition.say(result('ABCDE', true), result('முடிந்தது', false));
    await sleep(60);
    assert.deepEqual(seen.results, ['ABCDE']);
    assert.equal(seen.interim.at(-1), 'ABCDE'); // the live text never shows the done word
  });

  test('when the browser ends the recognition it is restarted silently and the text is kept', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, safetyMs: 60_000 });
    recognition.say(result('987', true));
    recognition.browserEnds();
    await sleep(250); // the restart delay is 120 ms
    assert.equal(recognition.starts, 2, 'recognition was started again');

    recognition.browserEnds(); // and again, with nothing said
    await sleep(250);
    assert.equal(recognition.starts, 3);

    recognition.say(result('654', true));
    assert.equal(seen.interim.at(-1), '987 654');
    assert.deepEqual(seen.results, []);
    assert.deepEqual(seen.errors, []);
    input.finish();
    await sleep(30);
    assert.deepEqual(seen.results, ['987 654']);
  });

  test('if start() refuses (the browser is still stopping) it tries again a few times', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, safetyMs: 60_000 });
    recognition.say(result('abc', true));
    recognition.failStarts = 2; // the next two start() calls throw
    recognition.browserEnds();
    await sleep(900);
    assert.equal(recognition.starts, 2, 'it worked on the third try');
    assert.deepEqual(seen.errors, []);
    input.finish();
    await sleep(30);
    assert.deepEqual(seen.results, ['abc']);
  });

  test('the safety stop: total silence ends the answer with what was heard', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, safetyMs: 150 });
    recognition.say(result('abc', true));
    await sleep(80); // something was heard: the 150 ms start again
    recognition.say(result('abc', true), result('def', true));
    await sleep(80);
    assert.deepEqual(seen.results, [], 'still waiting: the last words were heard 80 ms ago');
    await sleep(300);
    assert.deepEqual(seen.results, ['abc def']);
  });

  test('the safety stop with nothing heard reports noSpeech', async () => {
    const { input, seen } = make();
    input.start({ continuous: true, safetyMs: 100 });
    await sleep(300);
    assert.deepEqual(seen.results, []);
    assert.deepEqual(seen.errors, [{ noSpeech: true }]);
  });

  test('"Done" with nothing heard reports noSpeech once', async () => {
    const { input, seen } = make();
    input.start({ continuous: true, safetyMs: 60_000 });
    input.finish();
    await sleep(30);
    input.finish();
    await sleep(30);
    assert.deepEqual(seen.errors, [{ noSpeech: true }]);
  });

  test('no-speech and aborted errors are not failures; a passing network error is survived', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, safetyMs: 60_000 });
    recognition.onerror({ error: 'no-speech' });
    recognition.onerror({ error: 'aborted' });
    recognition.onerror({ error: 'network' });
    recognition.browserEnds();
    await sleep(250);
    assert.equal(recognition.starts, 2);
    recognition.say(result('abc', true)); // something heard: the network errors start counting again
    input.finish();
    await sleep(30);
    assert.deepEqual(seen.results, ['abc']);
    assert.deepEqual(seen.errors, []);
  });

  test('three network errors in a row, or a refused microphone, end the answer with an error', async () => {
    let run = make();
    run.input.start({ continuous: true, safetyMs: 60_000 });
    for (let i = 0; i < 3; i++) run.recognition.onerror({ error: 'network' });
    assert.deepEqual(run.seen.errors, [{ error: 'network' }]);

    run = make();
    run.input.start({ continuous: true, safetyMs: 60_000 });
    run.recognition.onerror({ error: 'not-allowed' });
    assert.deepEqual(run.seen.errors, [{ error: 'not-allowed' }]);
    await sleep(30);
    assert.deepEqual(run.seen.results, []);
  });

  test('stop() gives nothing, even if the browser still reports words', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, safetyMs: 60 });
    recognition.say(result('abc', true));
    input.stop();
    await sleep(250);
    assert.deepEqual(seen.results, []);
    assert.deepEqual(seen.errors, []);
  });

  test('the default is still one phrase: the final result is cleaned and given at once', async () => {
    const { input, seen, recognition } = make();
    input.start();
    assert.equal(recognition.continuous, false);
    recognition.say(result('Shankar.', true));
    assert.deepEqual(seen.results, ['Shankar']);
  });
});
