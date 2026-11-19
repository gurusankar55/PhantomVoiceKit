// kolamPuzzle.test.js
// Kolam Puzzle: the seeded random numbers, the Hamiltonian path (snake + backbite), walls only on
// unused edges (so every puzzle is solvable), moves, drag, undo and cut, dead ends (checked against
// a brute-force search), records and the daily streak, the 20 locale files, and how the app is
// registered like the other apps. No browser, no network.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync, readdirSync } from 'node:fs';
import {
  SIZES,
  LEVELS,
  COINS,
  sizeOf,
  hashString,
  mulberry32,
  todayKey,
  previousDay,
  dailySeed,
  neighbours,
  areNeighbours,
  edgeKey,
  allEdges,
  snakePath,
  backbite,
  hamiltonianPath,
  isHamiltonianPath,
  makeWalls,
  hasWall,
  makePuzzle,
  tryMove,
  dragTo,
  stepsToward,
  cutAt,
  freeMoves,
  isSolved,
  deadEnd,
  cellAt,
  RECORDS_KEY,
  loadRecords,
  saveRecords,
  recordSolve,
  currentStreak,
  dailySolved,
  formatTime,
  LEVEL_KEY,
  loadLevel,
  saveLevel,
  freeSeed,
} from '../../apps/kolam-puzzle/kolam-utils.js';
import { APP_AUDIENCE } from '../../skeleton/home-utils.js';
import { APP_ICON_IDS, appIconSvg } from '../../skeleton/app-icons.js';
import { needsInternet } from '../../skeleton/pwa-client.js';
import { guideSteps } from '../../skeleton/guide-utils.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const LOCALES = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr'];
const STRINGS = Object.fromEntries(LOCALES.map((code) => [code, JSON.parse(read(`skeleton/locales/${code}.json`))]));

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
}
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

// A hand-made puzzle (any size) for move and dead-end tests.
const plain = (n, walls = [], start = 0) => ({ n, start, walls: new Set(walls.map(([a, b]) => edgeKey(a, b))), solution: [] });

// Can `line` still be finished? A brute-force search (small boards only).
function canFinish(puzzle, line) {
  const visited = new Set(line);
  const total = puzzle.n * puzzle.n;
  const search = (end, count) => {
    if (count === total) return true;
    for (const next of neighbours(puzzle.n, end)) {
      if (visited.has(next) || hasWall(puzzle, end, next)) continue;
      visited.add(next);
      if (search(next, count + 1)) return true;
      visited.delete(next);
    }
    return false;
  };
  return search(line[line.length - 1], line.length);
}

// ---------- seeded random numbers and dates ----------

describe('seeded random numbers and the Daily Kolam', () => {
  test('the same seed always gives the same numbers, from 0 up to 1', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = Array.from({ length: 50 }, () => a());
    assert.deepEqual(first, Array.from({ length: 50 }, () => b()));
    assert.ok(first.every((x) => x >= 0 && x < 1));
    assert.notDeepEqual(first, Array.from({ length: 50 }, mulberry32(54321)));
  });

  test('hashString is stable and spreads small changes', () => {
    assert.equal(hashString('kolam'), hashString('kolam'));
    assert.notEqual(hashString('kolam-2026-01-01'), hashString('kolam-2026-01-02'));
    assert.ok(Number.isInteger(hashString('')) && hashString('x') >= 0);
  });

  test('today is the local date YYYY-MM-DD; the day before works across months and years', () => {
    assert.equal(todayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(todayKey(new Date(2026, 11, 31, 0, 1)), '2026-12-31');
    assert.equal(previousDay('2026-03-01'), '2026-02-28');
    assert.equal(previousDay('2028-03-01'), '2028-02-29');
    assert.equal(previousDay('2027-01-01'), '2026-12-31');
  });

  test('one Daily Kolam per day and size: the same for everyone that day, another one the next day', () => {
    assert.equal(dailySeed('2026-10-31', 5), dailySeed('2026-10-31', 5));
    assert.notEqual(dailySeed('2026-10-31', 5), dailySeed('2026-11-01', 5));
    assert.notEqual(dailySeed('2026-10-31', 5), dailySeed('2026-10-31', 6));
    const today = makePuzzle({ size: 6, seed: dailySeed('2026-10-31', 6) });
    const again = makePuzzle({ size: 6, seed: dailySeed('2026-10-31', 6) });
    assert.deepEqual(again.solution, today.solution);
    assert.deepEqual([...again.walls], [...today.walls]);
    assert.equal(again.start, today.start);
  });

  test('free play gets a fresh seed', () => {
    assert.equal(freeSeed(() => 0), 0);
    assert.equal(freeSeed(() => 0.5), 2147483648);
    const seeds = new Set(Array.from({ length: 20 }, () => freeSeed()));
    assert.ok(seeds.size > 15);
  });
});

// ---------- the path through every dot ----------

describe('Hamiltonian path: snake and backbite', () => {
  test('the sizes are 5, 6 and 7', () => {
    assert.deepEqual(SIZES, { easy: 5, medium: 6, hard: 7 });
    assert.deepEqual([...LEVELS], ['easy', 'medium', 'hard']);
    assert.equal(sizeOf('hard'), 7);
    assert.equal(sizeOf('nope'), 5);
  });

  test('the snake path is a valid path through every dot', () => {
    for (const n of [2, 3, 5, 6, 7]) assert.ok(isHamiltonianPath(snakePath(n), n), String(n));
    assert.deepEqual(snakePath(3), [0, 1, 2, 5, 4, 3, 6, 7, 8]);
  });

  test('isHamiltonianPath refuses gaps, repeats, jumps and wrong lengths', () => {
    assert.equal(isHamiltonianPath([0, 1, 2, 5, 4, 3, 6, 7], 3), false);
    assert.equal(isHamiltonianPath([0, 1, 2, 5, 4, 4, 6, 7, 8], 3), false);
    assert.equal(isHamiltonianPath([0, 1, 2, 3, 4, 5, 6, 7, 8], 3), false, '2 to 3 is not a step');
    assert.equal(isHamiltonianPath(null, 3), false);
  });

  test('property: every backbite move keeps a valid path through every dot (100 runs)', () => {
    fc.assert(fc.property(fc.integer({ min: 2, max: 7 }), fc.integer(), fc.integer({ min: 1, max: 300 }), (n, seed, moves) => {
      const random = mulberry32(seed);
      const path = snakePath(n);
      for (let i = 0; i < moves; i++) {
        backbite(path, n, random);
        if (!isHamiltonianPath(path, n)) return false;
      }
      return true;
    }), { numRuns: 100 });
  });

  test('backbite really mixes the path (not the plain snake), and starts vary', () => {
    const starts = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const path = hamiltonianPath(7, mulberry32(seed));
      assert.notDeepEqual(path, snakePath(7));
      starts.add(path[0]);
    }
    assert.ok(starts.size >= 10, `${starts.size} different start dots`);
  });
});

// ---------- puzzles: always solvable ----------

describe('puzzles are always solvable', () => {
  test('property: the solution goes through every dot and no wall is on it (100 runs, every size)', () => {
    fc.assert(fc.property(fc.constantFrom(5, 6, 7), fc.integer({ min: 0, max: 0xffffffff }), (size, seed) => {
      const p = makePuzzle({ size, seed });
      if (p.n !== size || p.start !== p.solution[0] || !isHamiltonianPath(p.solution, size)) return false;
      for (let i = 1; i < p.solution.length; i++) if (hasWall(p, p.solution[i - 1], p.solution[i])) return false;
      return true;
    }), { numRuns: 100 });
  });

  test('property: walls are only between neighbouring dots, never on the solution, and about the right share (100 runs)', () => {
    fc.assert(fc.property(fc.constantFrom(5, 6, 7), fc.integer({ min: 0, max: 0xffffffff }), (size, seed) => {
      const p = makePuzzle({ size, seed });
      const free = allEdges(size).length - (size * size - 1);
      const share = { 5: 0.3, 6: 0.35, 7: 0.4 }[size];
      if (p.walls.size !== Math.round(free * share)) return false;
      const used = new Set(p.solution.slice(1).map((cell, i) => edgeKey(p.solution[i], cell)));
      for (const key of p.walls) {
        const [a, b] = key.split('-').map(Number);
        if (!areNeighbours(size, a, b) || used.has(key)) return false;
      }
      return true;
    }), { numRuns: 100 });
  });

  test('property: the solution can be played move by move with no dead end reported (100 runs)', () => {
    fc.assert(fc.property(fc.constantFrom(5, 6, 7), fc.integer({ min: 0, max: 0xffffffff }), (size, seed) => {
      const p = makePuzzle({ size, seed });
      let line = [p.start];
      for (const cell of p.solution.slice(1)) {
        const result = tryMove(p, line, cell);
        if (!result.ok) return false;
        line = result.line;
        if (deadEnd(p, line) !== null) return false;
      }
      return isSolved(p, line);
    }), { numRuns: 100 });
  });

  test('the same size and seed always give the same puzzle; another seed gives another one', () => {
    const a = makePuzzle({ size: 7, seed: 99 });
    const b = makePuzzle({ size: 7, seed: 99 });
    assert.deepEqual(a.solution, b.solution);
    assert.deepEqual([...a.walls].sort(), [...b.walls].sort());
    assert.notDeepEqual(makePuzzle({ size: 7, seed: 100 }).solution, a.solution);
    assert.equal(makePuzzle({ size: 9, seed: 1 }).n, 5, 'an unknown size becomes easy');
  });

  test('makeWalls never uses an edge of the path, whatever the share', () => {
    const path = snakePath(5);
    const walls = makeWalls(path, 5, mulberry32(1), 1);
    assert.equal(walls.size, allEdges(5).length - 24, 'every free edge');
    for (let i = 1; i < path.length; i++) assert.ok(!walls.has(edgeKey(path[i - 1], path[i])));
    assert.equal(makeWalls(path, 5, mulberry32(1), 0).size, 0);
  });

  test('a puzzle is made fast enough for an old phone (7 x 7 under 50 ms on average)', () => {
    const t0 = Date.now();
    for (let seed = 0; seed < 40; seed++) makePuzzle({ size: 7, seed });
    assert.ok((Date.now() - t0) / 40 < 50);
  });
});

// ---------- moves ----------

describe('moves, drag, undo and cut', () => {
  const p = plain(5, [[2, 3]]); // a wall between dots 2 and 3

  test('the line grows to a free neighbour, goes back one step onto the dot before the end', () => {
    assert.deepEqual(tryMove(p, [0], 1), { ok: true, line: [0, 1], reason: 'grow' });
    assert.deepEqual(tryMove(p, [0, 1, 6], 1), { ok: true, line: [0, 1], reason: 'back' });
  });

  test('walls, dots already on the line, far dots and the end itself are refused', () => {
    assert.equal(tryMove(p, [0, 1, 2], 3).reason, 'wall');
    assert.equal(tryMove(p, [0, 1, 6, 5], 0).reason, 'visited');
    assert.equal(tryMove(p, [0], 2).reason, 'notNeighbour');
    assert.equal(tryMove(p, [0], 6).reason, 'notNeighbour', 'no diagonal moves');
    assert.equal(tryMove(p, [0, 1], 1).reason, 'same');
    const line = [0, 1, 2];
    const result = tryMove(p, line, 3);
    assert.equal(result.ok, false);
    assert.equal(result.line, line, 'the line is not changed');
  });

  test('tryMove never changes the old line', () => {
    const line = [0, 1];
    tryMove(p, line, 6);
    assert.deepEqual(line, [0, 1]);
  });

  test('stepsToward: the dots between two dots of one row or column', () => {
    assert.deepEqual(stepsToward(5, 0, 3), [1, 2, 3]);
    assert.deepEqual(stepsToward(5, 3, 0), [2, 1, 0]);
    assert.deepEqual(stepsToward(5, 1, 16), [6, 11, 16]);
    assert.deepEqual(stepsToward(5, 0, 6), [], 'diagonal');
    assert.deepEqual(stepsToward(5, 4, 4), []);
  });

  test('dragTo: a fast straight drag fills in the dots one by one and stops at a wall', () => {
    const open = plain(5);
    assert.deepEqual(dragTo(open, [0], 4).line, [0, 1, 2, 3, 4]);
    const stopped = dragTo(p, [0], 4);
    assert.deepEqual(stopped.line, [0, 1, 2]);
    assert.equal(stopped.blocked, 'wall');
    assert.equal(stopped.changed, true);
    assert.deepEqual(dragTo(open, [0, 1, 6], 0), { line: [0, 1, 6], changed: false, blocked: null }, 'diagonal: wait');
  });

  test('dragTo: sliding back along the line undoes it, several dots at once', () => {
    const open = plain(5);
    assert.deepEqual(dragTo(open, [0, 1, 2, 3, 4], 2).line, [0, 1, 2]);
    assert.deepEqual(dragTo(open, [0, 1, 2, 3, 4], 0).line, [0]);
    // across the line (not back along it): refused
    const result = dragTo(open, [0, 5, 6, 1, 2], 0);
    assert.equal(result.changed, false);
  });

  test('tapping a dot on the line cuts it back there', () => {
    assert.deepEqual(cutAt([0, 1, 2, 7, 6], 2), [0, 1, 2]);
    assert.deepEqual(cutAt([0, 1, 2], 0), [0]);
    const line = [0, 1];
    assert.equal(cutAt(line, 9), line);
  });

  test('freeMoves and isSolved', () => {
    assert.deepEqual(freeMoves(p, [0, 1, 2]).sort(), [7]);
    const open = plain(3);
    assert.equal(isSolved(open, snakePath(3)), true);
    assert.equal(isSolved(open, snakePath(3).slice(0, 8)), false);
  });

  test('cellAt: only a point close to a dot counts (a diagonal slip does nothing)', () => {
    assert.equal(cellAt(5, 0.5, 0.5), 0);
    assert.equal(cellAt(5, 4.5, 4.5), 24);
    assert.equal(cellAt(5, 2.6, 1.4), 7);
    assert.equal(cellAt(5, 1.0, 1.0), null, 'exactly between four dots');
    assert.equal(cellAt(5, -0.5, 0.5), null);
    assert.equal(cellAt(5, 5.4, 0.5), null);
  });
});

// ---------- dead ends ----------

describe('dead ends are found and told', () => {
  test('noMove: no free dot next to the end of the line', () => {
    assert.equal(deadEnd(plain(5, [], 1), [1, 6, 5, 0]), 'noMove');
  });

  test('cutOff: a dot can no longer be reached', () => {
    // the corner dot 4 lost both its neighbours (3 and 9) to the line
    assert.equal(deadEnd(plain(5), [0, 1, 2, 3, 8, 9, 14]), 'cutOff');
  });

  test('cutOff: two dots with only one way in cannot both be the last dot', () => {
    assert.equal(deadEnd(plain(5, [[20, 21]]), [0, 1, 2, 3, 8]), 'cutOff');
  });

  test('cutOff: a line straight across the board leaves two parts', () => {
    assert.equal(deadEnd(plain(5, [], 10), [10, 11, 12, 13, 14]), 'cutOff');
  });

  test('cutOff: a free dot whose only way in is the end of the line, while other dots are still free', () => {
    assert.equal(deadEnd(plain(5, [[9, 14]]), [0, 1, 2, 3, 8, 9]), 'cutOff'); // dot 4 can only be reached from 9
  });

  test('a fine line is not a dead end; a solved line is not either', () => {
    assert.equal(deadEnd(plain(5), [0, 1, 2, 3, 4]), null);
    assert.equal(deadEnd(plain(3), snakePath(3)), null);
  });

  test('property: never a false alarm, a dead end is only reported when the line really cannot be finished (100 runs)', () => {
    fc.assert(fc.property(fc.constantFrom(3, 4, 5), fc.integer(), fc.integer({ min: 1, max: 14 }), (n, seed, steps) => {
      const random = mulberry32(seed);
      const solution = hamiltonianPath(n, random, 200);
      const puzzle = { n, start: solution[0], walls: makeWalls(solution, n, random, 0.35), solution };
      // a random walk from the start (not the solution)
      let line = [puzzle.start];
      for (let i = 0; i < steps; i++) {
        const moves = freeMoves(puzzle, line);
        if (moves.length === 0) break;
        line = [...line, moves[Math.floor(random() * moves.length)]];
      }
      const reported = deadEnd(puzzle, line);
      return reported === null || !canFinish(puzzle, line);
    }), { numRuns: 100 });
  });

  test('property: "no move" is always reported when the line is stuck (100 runs)', () => {
    fc.assert(fc.property(fc.constantFrom(3, 4, 5), fc.integer(), (n, seed) => {
      const random = mulberry32(seed);
      const solution = hamiltonianPath(n, random, 200);
      const puzzle = { n, start: solution[0], walls: makeWalls(solution, n, random, 0.35), solution };
      let line = [puzzle.start];
      for (;;) {
        const moves = freeMoves(puzzle, line);
        if (moves.length === 0) break;
        line = [...line, moves[Math.floor(random() * moves.length)]];
      }
      return isSolved(puzzle, line) ? deadEnd(puzzle, line) === null : deadEnd(puzzle, line) === 'noMove';
    }), { numRuns: 100 });
  });
});

// ---------- records ----------

describe('best times and the daily streak', () => {
  const empty = () => loadRecords(memoryStorage());

  test('the best time of each size is kept when it is better', () => {
    let r = recordSolve(empty(), { size: 5, ms: 61000, dateKey: '2026-10-31' });
    assert.equal(r.newBest, true);
    assert.equal(r.records.best[5], 61000);
    r = recordSolve(r.records, { size: 5, ms: 70000, dateKey: '2026-10-31' });
    assert.equal(r.newBest, false);
    assert.equal(r.records.best[5], 61000);
    r = recordSolve(r.records, { size: 5, ms: 30000, dateKey: '2026-10-31' });
    assert.equal(r.records.best[5], 30000);
    assert.equal(r.records.best[6], undefined, 'other sizes untouched');
  });

  test('the streak grows by one the day after, once a day, and starts again after a gap', () => {
    let r = recordSolve(empty(), { size: 5, ms: 1000, daily: true, dateKey: '2026-10-30' });
    assert.equal(r.records.streak, 1);
    assert.equal(r.firstDailyToday, true);
    r = recordSolve(r.records, { size: 6, ms: 1000, daily: true, dateKey: '2026-10-30' });
    assert.equal(r.records.streak, 1, 'twice the same day');
    assert.equal(r.firstDailyToday, false);
    r = recordSolve(r.records, { size: 5, ms: 1000, daily: true, dateKey: '2026-10-31' });
    assert.equal(r.records.streak, 2);
    r = recordSolve(r.records, { size: 5, ms: 1000, daily: true, dateKey: '2026-11-01' });
    assert.equal(r.records.streak, 3, 'across a month');
    r = recordSolve(r.records, { size: 5, ms: 1000, daily: true, dateKey: '2026-11-03' });
    assert.equal(r.records.streak, 1, 'a day was missed');
  });

  test('free play never changes the streak; the shown streak is 0 after a missed day', () => {
    let r = recordSolve(empty(), { size: 5, ms: 1000, daily: true, dateKey: '2026-10-30' });
    r = recordSolve(r.records, { size: 5, ms: 1000, daily: false, dateKey: '2026-10-31' });
    assert.equal(r.records.streak, 1);
    assert.equal(r.records.lastDaily, '2026-10-30');
    assert.equal(currentStreak(r.records, '2026-10-30'), 1);
    assert.equal(currentStreak(r.records, '2026-10-31'), 1, 'still alive the next day');
    assert.equal(currentStreak(r.records, '2026-11-01'), 0, 'lost after a missed day');
  });

  test('dailySolved knows which sizes were solved today', () => {
    const r = recordSolve(empty(), { size: 6, ms: 1000, daily: true, dateKey: '2026-10-31' });
    assert.equal(dailySolved(r.records, '2026-10-31', 6), true);
    assert.equal(dailySolved(r.records, '2026-10-31', 5), false);
    assert.equal(dailySolved(r.records, '2026-11-01', 6), false);
  });

  test('saved in localStorage and read back; damaged or blocked storage starts empty and never throws', () => {
    const storage = memoryStorage();
    const { records } = recordSolve(empty(), { size: 7, ms: 125000, daily: true, dateKey: '2026-10-31' });
    assert.equal(saveRecords(storage, records), true);
    assert.deepEqual(loadRecords(storage), records);
    assert.ok(storage.data.has(RECORDS_KEY));
    storage.setItem(RECORDS_KEY, '{broken');
    assert.deepEqual(loadRecords(storage).best, {});
    storage.setItem(RECORDS_KEY, JSON.stringify({ best: { 5: -3, 6: 'x', 7: 5000 }, streak: 'many', lastDaily: 'yesterday', dailyDone: { date: '2026-10-31', sizes: [5, 9] } }));
    const cleaned = loadRecords(storage);
    assert.deepEqual(cleaned.best, { 7: 5000 });
    assert.equal(cleaned.streak, 0);
    assert.equal(cleaned.lastDaily, '');
    assert.deepEqual(cleaned.dailyDone, { date: '2026-10-31', sizes: [5] });
    assert.deepEqual(loadRecords(blocked).best, {});
    assert.equal(saveRecords(blocked, records), false);
    assert.equal(saveRecords(null, records), false);
  });

  test('recordSolve never changes the old records', () => {
    const before = empty();
    const copy = JSON.parse(JSON.stringify(before));
    recordSolve(before, { size: 5, ms: 1000, daily: true, dateKey: '2026-10-31' });
    assert.deepEqual(before, copy);
  });

  test('the chosen level is remembered', () => {
    const storage = memoryStorage();
    assert.equal(loadLevel(storage), 'easy');
    assert.equal(saveLevel(storage, 'hard'), true);
    assert.equal(storage.data.get(LEVEL_KEY), 'hard');
    assert.equal(loadLevel(storage), 'hard');
    assert.equal(saveLevel(storage, 'impossible'), false);
    storage.setItem(LEVEL_KEY, 'impossible');
    assert.equal(loadLevel(storage), 'easy');
    assert.equal(loadLevel(blocked), 'easy');
  });

  test('formatTime', () => {
    assert.equal(formatTime(0), '0:00');
    assert.equal(formatTime(83500), '1:23');
    assert.equal(formatTime(3723000), '1:02:03');
    assert.equal(formatTime(-5), '0:00');
    assert.equal(formatTime('x'), '0:00');
  });

  test('more coins for bigger boards', () => {
    assert.ok(COINS[5] < COINS[6] && COINS[6] < COINS[7]);
  });
});

// ---------- strings ----------

describe('strings in 20 languages', () => {
  const html = read('apps/kolam-puzzle/index.html');
  const js = read('apps/kolam-puzzle/app.js');
  const used = new Set([...(html + js).matchAll(/['"](kolamPuzzle\.[\w]+)['"]/g)].map((m) => m[1]));
  for (const m of html.matchAll(/data-i18n="(kolamPuzzle\.\w+)"/g)) used.add(m[1]);
  for (const m of html.matchAll(/data-i18n-attr="[^"]*?:(kolamPuzzle\.\w+)/g)) used.add(m[1]); // aria-label:kolamPuzzle.difficulty

  test('every key the page and the script use exists, non-empty, in all 20 languages', () => {
    assert.ok(used.size >= 28, `${used.size} keys`);
    for (const code of LOCALES) for (const key of used) assert.ok(STRINGS[code][key]?.trim(), `${code} ${key}`);
  });

  test('no unused kolamPuzzle keys in en.json', () => {
    for (const key of Object.keys(STRINGS.en).filter((k) => k.startsWith('kolamPuzzle.'))) assert.ok(used.has(key), `${key} is not used`);
  });

  test('menu, Home card and the 3 guide steps are translated; placeholders are kept', () => {
    const find = (s) => (String(s).match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const code of LOCALES) {
      for (const key of ['nav.kolamPuzzle', 'home.kolamPuzzle', 'home.kolamPuzzleHint', 'guide.kolam-puzzle.1', 'guide.kolam-puzzle.2', 'guide.kolam-puzzle.3']) assert.ok(STRINGS[code][key]?.trim(), `${code} ${key}`);
      assert.equal(STRINGS[code]['nav.kolamPuzzle'], STRINGS[code]['home.kolamPuzzle']);
      for (const key of Object.keys(STRINGS.en).filter((k) => k.startsWith('kolamPuzzle.'))) assert.equal(find(STRINGS[code][key]), find(STRINGS.en[key]), `${code} ${key}`);
      assert.match(STRINGS[code]['kolamPuzzle.pageTitle'], /Phantom Voice Kit/);
    }
    for (const code of LOCALES.filter((c) => c !== 'en')) {
      for (const key of ['home.kolamPuzzleHint', 'kolamPuzzle.wall', 'kolamPuzzle.deadEnd', 'kolamPuzzle.undo']) assert.notEqual(STRINGS[code][key], STRINGS.en[key], `${code} ${key}`);
    }
  });

  test('the welcome text of every language names the app', () => {
    for (const code of LOCALES) assert.ok(STRINGS[code]['home.welcomeText'].includes(STRINGS[code]['home.kolamPuzzle']), code);
  });

  test('the four spoken moments have their own sentence: start, wall, dead end, solved', () => {
    for (const key of ['kolamPuzzle.speakStart', 'kolamPuzzle.wall', 'kolamPuzzle.solved']) {
      assert.match(js, new RegExp(`say\\('${key.replace('.', '\\.')}'`), key);
    }
    // a dead end: one of two sentences, spoken through say(key)
    assert.match(js, /const key = stuck === 'noMove' \? 'kolamPuzzle\.deadEnd' : 'kolamPuzzle\.cutOff';\s*showMessage\(key, undefined, 'warn'\);\s*say\(key\);/);
  });
});

// ---------- the page and its registration ----------

describe('the page', () => {
  const html = read('apps/kolam-puzzle/index.html');
  const js = read('apps/kolam-puzzle/app.js');
  const css = read('apps/kolam-puzzle/style.css').replace(/\/\*[\s\S]*?\*\//g, '');

  test('uses the shared skeleton by absolute path, no network and no AI', () => {
    for (const file of ['language-dropdown', 'speech-output', 'nav-menu', 'i18n', 'celebrate']) assert.match(js, new RegExp(`from '/skeleton/${file}\\.js'`), file);
    assert.match(js, /from '\/apps\/kolam-puzzle\/kolam-utils\.js'/);
    assert.ok(!/\bfetch\s*\(|api-client|XMLHttpRequest|GEMINI_API_KEY|generativelanguage|@google\/genai/.test(js + read('apps/kolam-puzzle/kolam-utils.js')));
    assert.match(html, /href="\/skeleton\/theme\.css"/);
    assert.equal(needsInternet('kolam-puzzle'), false);
  });

  test('every id the script asks for is on the page', () => {
    for (const m of js.matchAll(/\$\('([\w-]+)'\)/g)) assert.match(html, new RegExp(`\\sid="${m[1]}"`), m[1]);
    for (const m of js.matchAll(/getElementById\('([\w-]+)'\)/g)) assert.match(html, new RegExp(`\\sid="${m[1]}"`), m[1]);
  });

  test('Undo, Reset, a timer, a progress bar, the three sizes, Daily Kolam and New puzzle', () => {
    for (const id of ['undo-button', 'reset-button', 'timer', 'progress', 'progress-fill', 'progress-text', 'board', 'daily-button', 'new-button', 'difficulty']) assert.match(html, new RegExp(`\\sid="${id}"`), id);
    for (const level of LEVELS) assert.match(html, new RegExp(`data-level="${level}"`));
    assert.match(html, /role="progressbar"/);
  });

  test('drag with pointer events (mouse, touch, pen), slide back to undo, tap the line to cut', () => {
    assert.match(js, /addEventListener\('pointerdown'/);
    assert.match(js, /addEventListener\('pointermove'/);
    assert.match(js, /setPointerCapture/);
    assert.match(js, /setLine\(cutAt\(state\.line, cell\)\)/);
    assert.match(js, /dragTo\(state\.puzzle, state\.line, cell\)/);
    assert.match(js, /deadEnd\(state\.puzzle, state\.line\)/);
  });

  test('rewards on solve: coins, level-up, and a gift for the first Daily Kolam of the day', () => {
    const finish = js.slice(js.indexOf('function finish()'));
    assert.match(finish, /correct\(\{ coins: COINS\[n\], from: board \}\)/);
    assert.match(finish, /levelUp\(\)/);
    assert.match(finish, /if \(result\.firstDailyToday\) giftBox\(\)/);
    assert.match(finish, /saveRecords\(storage\(\), records\)/);
  });

  test('speech in the language picked on the site, never repeated too fast', () => {
    assert.match(js, /createSpeechOutput\(\{ lang: state\.language\.bcp47 \}\)/);
    assert.match(js, /const SAY_AGAIN_MS = 2500/);
  });

  test('mobile: touch-action none on the board only; the board fits width and height', () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
    const withNone = rules.filter((r) => /touch-action:\s*none/.test(r.body)).map((r) => r.selector);
    assert.deepEqual(withNone, ['.kolam-board']);
    const board = rules.find((r) => r.selector === '.kolam-board').body;
    assert.match(board, /inline-size:\s*min\(100%, calc\(100svh - 13rem\), 32rem\)/, 'never wider than the page or taller than the screen');
    assert.match(board, /aspect-ratio:\s*1/);
    assert.ok(!/(margin|padding|border)-(left|right)\b|text-align:\s*(left|right)/.test(css), 'logical properties only (right to left safe)');
    assert.match(css, /prefers-reduced-motion: reduce/);
  });

  test('registered like the other apps: menu, Home card, 3D icon, everyone, guide, offline', () => {
    assert.match(read('skeleton/nav-menu.js'), /\{ id: 'kolam-puzzle', labelKey: 'nav\.kolamPuzzle', href: '\/apps\/kolam-puzzle\/index\.html', subtitle: 'Kolam Puzzle · One-Line Dot Game' \}/);
    assert.match(read('index.html'), /<article class="app-card" data-app="kolam-puzzle"[\s\S]*?data-app-icon="kolam-puzzle"[\s\S]*?href="\/apps\/kolam-puzzle\/index\.html"/);
    assert.equal(APP_AUDIENCE['kolam-puzzle'], 'everyone', 'shown for children and adults');
    assert.ok(APP_ICON_IDS.includes('kolam-puzzle'));
    assert.match(appIconSvg('kolam-puzzle'), /<svg [^>]*viewBox="0 0 48 48"/);
    assert.equal(guideSteps('kolam-puzzle').length, 3);
    const sw = read('skeleton/pwa/sw-config.js');
    assert.match(sw, /'kolam-puzzle': \['index\.html', 'app\.js', 'kolam-utils\.js', 'style\.css'\]/);
    assert.deepEqual(readdirSync(new URL('../../apps/kolam-puzzle/', import.meta.url)).sort(), ['app.js', 'index.html', 'kolam-utils.js', 'style.css']);
    assert.match(js, /current: 'kolam-puzzle'/);
    assert.match(html, /<span class="brand-sub" lang="en" dir="ltr">Kolam Puzzle · One-Line Dot Game<\/span>/);
  });

  test('the README explains how to play, and the spec has the requirement', () => {
    const readme = read('README.md');
    assert.ok(readme.includes('apps/kolam-puzzle'));
    assert.match(readme, /## How to play Kolam Puzzle/);
    assert.match(read('.kiro/specs/phantom-voice-kit/requirements.md'), /### Requirement 55: Kolam Puzzle/);
  });
});
