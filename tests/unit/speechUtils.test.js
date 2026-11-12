// tests/unit/speechUtils.test.js
// Silence logic and continuous listening (skeleton/speech-utils.js and skeleton/speech-input.js).
// A fake SpeechRecognition class is used, so no browser and no microphone are needed.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  SILENCE_MS,
  LONG_SILENCE_MS,
  silenceMsForKind,
  joinParts,
  transcriptFromResults,
  silenceElapsed,
} from '../../skeleton/speech-utils.js';
import { createSpeechInput } from '../../skeleton/speech-input.js';

// One result of a SpeechRecognition event: [{ transcript }] with an isFinal flag.
const result = (transcript, isFinal) => Object.assign([{ transcript }], { isFinal });

describe('silence times', () => {
  test('2.5 seconds for ordinary answers, 4 seconds for number, code and email', () => {
    assert.equal(SILENCE_MS, 2500);
    assert.equal(LONG_SILENCE_MS, 4000);
    for (const kind of ['name', 'date', 'text', undefined, 'unknown']) assert.equal(silenceMsForKind(kind), 2500, String(kind));
    for (const kind of ['number', 'code', 'email']) assert.equal(silenceMsForKind(kind), 4000, kind);
  });

  test('silenceElapsed is true exactly when the silence has lasted long enough', () => {
    assert.equal(silenceElapsed(1000, 3499, 2500), false);
    assert.equal(silenceElapsed(1000, 3500, 2500), true);
    assert.equal(silenceElapsed(1000, 9000, 2500), true);
    assert.equal(silenceElapsed(1000, 1000, 2500), false);
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

  test('property: joining never leaves a double space or a space at the ends', () => {
    fc.assert(
      fc.property(fc.array(fc.stringMatching(/^[ a-z0-9]{0,6}$/), { maxLength: 6 }), (parts) => {
        const joined = joinParts(parts);
        assert.equal(joined, joined.trim());
        assert.ok(!joined.includes('  ') || parts.some((p) => p.trim().includes('  ')));
      })
    );
  });
});

// ---------- Continuous listening with a fake recognizer ----------

let created;
class FakeRecognition {
  constructor() {
    this.starts = 0;
    this.running = false;
    created.push(this);
  }
  start() {
    if (this.running) throw new Error('already started');
    this.running = true;
    this.starts += 1;
  }
  stop() {
    this.running = false;
    setImmediate(() => this.onend && this.onend()); // like a browser: the end event follows stop()
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

describe('continuous listening', () => {
  beforeEach(() => {
    created = [];
    globalThis.window = { SpeechRecognition: FakeRecognition };
  });
  afterEach(() => {
    delete globalThis.window;
  });

  // Make an input that records what it reports.
  function make(options = {}) {
    const seen = { results: [], errors: [], interim: [] };
    const input = createSpeechInput({
      lang: 'en-US',
      onResult: (text) => seen.results.push(text),
      onError: (info) => seen.errors.push(info),
      onInterim: (text) => seen.interim.push(text),
      ...options,
    });
    return { input, seen, recognition: created[created.length - 1] };
  }

  test('a short pause does not end the answer; the parts are joined after the silence', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, silenceMs: 120 });
    assert.equal(recognition.continuous, true);
    assert.equal(recognition.interimResults, true);

    recognition.say(result('98765', true));
    await sleep(50); // a pause shorter than the silence
    assert.deepEqual(seen.results, []);
    recognition.say(result('98765', true), result('43210', false)); // second part, still being recognised
    assert.equal(seen.interim.at(-1), '98765 43210');

    await sleep(300);
    assert.deepEqual(seen.results, ['98765 43210']);
    assert.deepEqual(seen.errors, []);
  });

  test('the live text grows while the user speaks', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, silenceMs: 80 });
    recognition.say(result('abc', false));
    recognition.say(result('abcde', false));
    recognition.say(result('abcde 12', true));
    assert.deepEqual(seen.interim, ['abc', 'abcde', 'abcde 12']);
    await sleep(250);
    assert.deepEqual(seen.results, ['abcde 12']);
  });

  test('when the browser ends the recognition early it is restarted and the parts are joined', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, silenceMs: 600 });
    recognition.say(result('987', true));
    recognition.browserEnds(); // ended early by the browser
    await sleep(260); // restart delay is 150 ms
    assert.equal(recognition.starts, 2, 'recognition was started again');
    assert.deepEqual(seen.results, []);

    recognition.say(result('654', true));
    assert.equal(seen.interim.at(-1), '987 654');
    await sleep(1200);
    assert.deepEqual(seen.results, ['987 654']);
  });

  test('"Done" (finish) gives what was heard at once, without waiting for the silence', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, silenceMs: 60_000 });
    recognition.say(result('abcde', true), result('1234', false));
    input.finish();
    await sleep(30);
    assert.deepEqual(seen.results, ['abcde 1234']);
  });

  test('finish with nothing heard reports noSpeech, and a result is given only once', async () => {
    const { input, seen } = make();
    input.start({ continuous: true, silenceMs: 60_000 });
    input.finish();
    await sleep(30);
    assert.deepEqual(seen.results, []);
    assert.deepEqual(seen.errors, [{ noSpeech: true }]);
    input.finish();
    await sleep(30);
    assert.equal(seen.errors.length, 1);
  });

  test('stop() gives nothing, even if the browser still reports words', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, silenceMs: 60 });
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

  test('a recognition error ends the answer and is reported once', async () => {
    const { input, seen, recognition } = make();
    input.start({ continuous: true, silenceMs: 60 });
    recognition.say(result('abc', true));
    recognition.onerror({ error: 'network' });
    await sleep(250);
    assert.deepEqual(seen.errors, [{ error: 'network' }]);
    assert.deepEqual(seen.results, []);
  });
});
