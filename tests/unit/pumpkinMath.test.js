// pumpkinMath.test.js
// Pumpkin math rules: levels, questions, the streak and counting together. No browser, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  LEVELS,
  MAX_ANSWER,
  STREAK_FOR_GIFT,
  clampLevel,
  nextLevel,
  makeProblem,
  newProblem,
  sameProblem,
  isRight,
  nextStreak,
  isGiftStreak,
  pumpkinsOf,
  countingSteps,
} from '../../apps/pumpkin-math/math-utils.js';

const randomFrom = (values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('Pumpkin math levels and questions', () => {
  test('5 levels; levels are kept from 1 to 5', () => {
    assert.deepEqual(LEVELS, [1, 2, 3, 4, 5]);
    assert.equal(clampLevel(0), 1);
    assert.equal(clampLevel(9), 5);
    assert.equal(clampLevel('x'), 1);
    assert.equal(nextLevel(2), 3);
    assert.equal(nextLevel(5), 5);
  });

  test('property: every question fits its level, and the answer is 0 to 20', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 5, maxLength: 5 }), (level, values) => {
        const p = makeProblem(level, randomFrom(values));
        const answerOk = Number.isInteger(p.answer) && p.answer >= 0 && p.answer <= MAX_ANSWER;
        const math = p.kind === 'add' ? p.answer === p.a + p.b : p.kind === 'sub' ? p.answer === p.a - p.b : p.answer === p.a && p.b === 0;
        const levelOk =
          (level === 1 && p.kind === 'count' && p.a >= 1 && p.a <= 5) ||
          (level === 2 && p.kind === 'count' && p.a >= 1 && p.a <= 10) ||
          (level === 3 && p.kind === 'add' && p.answer <= 10 && p.a >= 1 && p.b >= 1) ||
          (level === 4 && p.kind === 'sub' && p.a <= 10 && p.b >= 1 && p.answer >= 1) ||
          (level === 5 && (p.kind === 'add' || p.kind === 'sub') && p.a <= 20 && p.answer <= 20);
        return answerOk && math && levelOk;
      }),
      { numRuns: 300 }
    );
  });

  test('the next question is a new one', () => {
    const last = { kind: 'count', a: 3, b: 0, answer: 3 };
    const same = randomFrom([0.5]); // would give 3 pumpkins again on level 1
    const fresh = newProblem(1, last, randomFrom([0.5, 0.5, 0.9]));
    assert.equal(sameProblem(makeProblem(1, same), last), true);
    assert.equal(sameProblem(fresh, last), false);
  });

  test('right or wrong', () => {
    const p = { kind: 'add', a: 2, b: 3, answer: 5 };
    assert.equal(isRight(p, 5), true);
    assert.equal(isRight(p, 4), false);
    assert.equal(isRight(p, null), false);
  });
});

describe('the streak and the gift', () => {
  test('5 correct in a row earn a gift; a wrong answer starts again', () => {
    assert.equal(STREAK_FOR_GIFT, 5);
    let streak = 0;
    const gifts = [];
    for (const right of [true, true, true, true, true, true, false, true]) {
      streak = nextStreak(streak, right);
      gifts.push(isGiftStreak(streak));
    }
    assert.deepEqual(gifts, [false, false, false, false, true, false, false, false]);
    assert.equal(streak, 1);
  });
});

describe('counting together', () => {
  test('counting: every pumpkin is counted', () => {
    assert.deepEqual(countingSteps({ kind: 'count', a: 3, b: 0, answer: 3 }), [
      { index: 0, number: 1 },
      { index: 1, number: 2 },
      { index: 2, number: 3 },
    ]);
  });

  test('adding: all pumpkins are counted; taking away: only the ones that are left', () => {
    assert.deepEqual(pumpkinsOf({ kind: 'add', a: 2, b: 1, answer: 3 }), ['one', 'one', 'more']);
    assert.equal(countingSteps({ kind: 'add', a: 2, b: 1, answer: 3 }).length, 3);
    assert.deepEqual(pumpkinsOf({ kind: 'sub', a: 5, b: 2, answer: 3 }), ['one', 'one', 'one', 'away', 'away']);
    assert.deepEqual(countingSteps({ kind: 'sub', a: 5, b: 2, answer: 3 }).map((s) => s.index), [0, 1, 2]);
  });

  test('property: counting together always ends at the answer', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (level) => {
        const p = makeProblem(level);
        const steps = countingSteps(p);
        return steps.length === p.answer && steps.every((s, i) => s.number === i + 1);
      }),
      { numRuns: 200 }
    );
  });
});
