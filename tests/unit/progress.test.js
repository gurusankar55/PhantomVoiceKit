// tests/unit/progress.test.js
// Tests for the pure save / restore helpers of Ghost Tutor.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { buildProgress, parseProgress, restoreSegments, PROGRESS_KEY } from '../../apps/ghost-tutor/progress-utils.js';

const language = { label: 'Tamil', bcp47: 'ta-IN' };
const makeSegments = (count) =>
  Array.from({ length: count }, (_, i) => ({
    title: 'Title ' + i,
    segment: 'Segment ' + i,
    quizQuestion: 'Question ' + i + '?',
    lang: 'ta-IN',
    texts: { segment: {}, quizQuestion: {} }, // runtime-only data must not be saved
    feedbackTexts: { 'ta-IN': 'secret' },
  }));

const sample = () => buildProgress({ topic: 'The moon', language, segments: makeSegments(8), segmentIndex: 5, score: 3, round: 2 });

describe('buildProgress / parseProgress', () => {
  test('a saved lesson comes back unchanged', () => {
    const saved = sample();
    const back = parseProgress(JSON.stringify(saved));
    assert.equal(back.topic, 'The moon');
    assert.deepEqual(back.language, language);
    assert.equal(back.segmentIndex, 5);
    assert.equal(back.score, 3);
    assert.equal(back.round, 2);
    assert.equal(back.segments.length, 8);
    // correct: was this part answered correctly (counts for the gift at the end of a round)
    assert.deepEqual(back.segments[0], { title: 'Title 0', segment: 'Segment 0', quizQuestion: 'Question 0?', lang: 'ta-IN', correct: false });
    assert.equal(back.taught.length, 8);
    assert.equal(back.taught[0], 'Title 0');
  });

  test('runtime data (translations, feedback) is not saved', () => {
    const text = JSON.stringify(sample());
    assert.ok(!text.includes('secret'));
    assert.ok(!text.includes('feedbackTexts'));
    assert.ok(!text.includes('texts'));
  });

  test('a part without lang uses the saved language', () => {
    const saved = buildProgress({
      topic: 'T',
      language,
      segments: [1, 2, 3, 4].map((n) => ({ segment: 'S' + n, quizQuestion: 'Q' + n })),
      segmentIndex: 0,
      score: 0,
      round: 1,
    });
    assert.ok(saved.segments.every((s) => s.lang === 'ta-IN'));
    assert.ok(parseProgress(JSON.stringify(saved)));
  });

  test('nothing, damaged or wrong data gives null', () => {
    for (const bad of [null, undefined, '', 'not json', '{', '[]', 'null', '42', '{}']) {
      assert.equal(parseProgress(bad), null, String(bad));
    }
  });

  test('values that do not make sense give null', () => {
    const cases = [
      (p) => { p.v = 2; },
      (p) => { p.topic = '  '; },
      (p) => { p.language = null; },
      (p) => { p.language.bcp47 = ''; },
      (p) => { p.round = 0; },
      (p) => { p.round = 6; },
      (p) => { p.round = 1.5; },
      (p) => { p.round = 3; }, // 8 parts do not fit 3 rounds
      (p) => { p.segments.pop(); },
      (p) => { p.segments[2].segment = ''; },
      (p) => { p.segments[2].quizQuestion = 5; },
      (p) => { p.segments[2].lang = null; },
      (p) => { p.segmentIndex = 8; },
      (p) => { p.segmentIndex = -1; },
      (p) => { p.segmentIndex = '5'; },
      (p) => { p.score = -1; },
      (p) => { p.score = 6; }, // more than the parts finished before the current one
      (p) => { p.score = 1.2; },
    ];
    for (const [i, change] of cases.entries()) {
      const p = JSON.parse(JSON.stringify(sample()));
      change(p);
      assert.equal(parseProgress(JSON.stringify(p)), null, 'case ' + i);
    }
  });

  test('unknown extra fields are dropped', () => {
    const p = JSON.parse(JSON.stringify(sample()));
    p.evil = 'x';
    p.segments[0].evil = 'x';
    const back = parseProgress(JSON.stringify(p));
    assert.equal(back.evil, undefined);
    assert.equal(back.segments[0].evil, undefined);
  });

  test('property: any valid state round-trips', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.nat(), fc.nat(), fc.string({ minLength: 1 }), (round, a, b, topic) => {
        fc.pre(topic.trim() !== '');
        const total = round * 4;
        const segmentIndex = a % total;
        const score = b % (segmentIndex + 1);
        const saved = buildProgress({ topic, language, segments: makeSegments(total), segmentIndex, score, round });
        const back = parseProgress(JSON.stringify(saved));
        assert.ok(back);
        assert.equal(back.segmentIndex, segmentIndex);
        assert.equal(back.score, score);
        assert.equal(back.round, round);
        assert.equal(back.topic, topic);
      }),
      { numRuns: 100 }
    );
  });
});

describe('restoreSegments', () => {
  test('texts are cached under the language they were written in', () => {
    const [first] = restoreSegments([{ title: 'T', segment: 'S', quizQuestion: 'Q', lang: 'ta-IN' }]);
    assert.deepEqual(first.texts.segment, { 'ta-IN': 'S' });
    assert.deepEqual(first.texts.quizQuestion, { 'ta-IN': 'Q' });
    assert.deepEqual(first.feedbackTexts, {});
    assert.equal(first.feedbackSource, null);
    assert.equal(first.title, 'T');
  });
});

test('the storage key is a stable, specific name', () => {
  assert.match(PROGRESS_KEY, /ghostTutor/);
});
