// math-utils.js
// Pure rules of Pumpkin math: the 5 levels, the questions, the streak that earns a gift, and
// what to show when counting together after a wrong answer. No DOM, no network.

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 5;
export const MAX_ANSWER = 20;
// Correct answers in a row that earn a level-up and a gift (and the next level).
export const STREAK_FOR_GIFT = 5;

// The levels:
//   1 count 1 to 5 pumpkins          2 count 1 to 10 pumpkins
//   3 add, the sum is 10 at most     4 take away within 10
//   5 add or take away, up to 20
export const LEVELS = Object.freeze([1, 2, 3, 4, 5]);

/** A level from 1 to 5 (anything else is made into one). */
export function clampLevel(level) {
  const n = Math.floor(Number(level));
  if (!Number.isFinite(n)) return MIN_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, n));
}

/** The level after this one (it stays at the last level). */
export function nextLevel(level) {
  return Math.min(MAX_LEVEL, clampLevel(level) + 1);
}

// A whole number from min to max (both included) from random().
function between(random, min, max) {
  const r = Number(random());
  const safe = Number.isFinite(r) ? Math.min(0.999999, Math.max(0, r)) : 0;
  return min + Math.floor(safe * (max - min + 1));
}

/**
 * A question for a level.
 * @returns {{kind:'count'|'add'|'sub', a:number, b:number, answer:number}}
 *   count: a pumpkins (b = 0); add: a + b; sub: a - b (a pumpkins, b are taken away)
 */
export function makeProblem(level, random = Math.random) {
  switch (clampLevel(level)) {
    case 1: {
      const a = between(random, 1, 5);
      return { kind: 'count', a, b: 0, answer: a };
    }
    case 2: {
      const a = between(random, 1, 10);
      return { kind: 'count', a, b: 0, answer: a };
    }
    case 3: {
      const a = between(random, 1, 9);
      const b = between(random, 1, 10 - a);
      return { kind: 'add', a, b, answer: a + b };
    }
    case 4: {
      const a = between(random, 2, 10);
      const b = between(random, 1, a - 1);
      return { kind: 'sub', a, b, answer: a - b };
    }
    default: {
      if (random() < 0.5) {
        const a = between(random, 1, 19);
        const b = between(random, 1, 20 - a);
        return { kind: 'add', a, b, answer: a + b };
      }
      const a = between(random, 5, 20);
      const b = between(random, 1, a - 1);
      return { kind: 'sub', a, b, answer: a - b };
    }
  }
}

/** Two problems that are the same question (so the next question is a new one). */
export function sameProblem(x, y) {
  return Boolean(x && y) && x.kind === y.kind && x.a === y.a && x.b === y.b;
}

/** A new question that is not the same as the last one (tries a few times). */
export function newProblem(level, last, random = Math.random) {
  let problem = makeProblem(level, random);
  for (let i = 0; i < 8 && sameProblem(problem, last); i++) problem = makeProblem(level, random);
  return problem;
}

/** Is the answer right? (a number given by a button or by voice) */
export function isRight(problem, answer) {
  return Number.isInteger(answer) && answer === problem.answer;
}

/** The streak after an answer: one more when right, back to 0 when wrong. */
export function nextStreak(streak, right) {
  return right ? Math.max(0, Math.floor(Number(streak) || 0)) + 1 : 0;
}

/** Does this streak earn a level-up and a gift? (5, 10, 15...) */
export function isGiftStreak(streak) {
  return Number.isInteger(streak) && streak > 0 && streak % STREAK_FOR_GIFT === 0;
}

/**
 * The pumpkins on the screen: one entry per pumpkin, in order.
 *   count: a pumpkins            add: a pumpkins, then b more ('more')
 *   sub:   a pumpkins, the last b are taken away ('away')
 * @returns {('one'|'more'|'away')[]}
 */
export function pumpkinsOf(problem) {
  if (problem.kind === 'add') return [...Array(problem.a).fill('one'), ...Array(problem.b).fill('more')];
  if (problem.kind === 'sub') return [...Array(problem.a - problem.b).fill('one'), ...Array(problem.b).fill('away')];
  return Array(problem.a).fill('one');
}

/**
 * Counting together after a wrong answer: the pumpkins that are counted, in order, with the
 * number said at each one. Taken-away pumpkins are not counted.
 * @returns {{index:number, number:number}[]}  index = the place of the pumpkin on the screen
 */
export function countingSteps(problem) {
  const steps = [];
  pumpkinsOf(problem).forEach((kind, index) => {
    if (kind !== 'away') steps.push({ index, number: steps.length + 1 });
  });
  return steps;
}
