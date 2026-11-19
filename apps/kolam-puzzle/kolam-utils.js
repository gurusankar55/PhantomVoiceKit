// kolam-utils.js
// Pure rules of Kolam Puzzle: draw ONE line through every dot of a grid, moving only up, down,
// left or right, never crossing a wall. No DOM, no network, storage is passed in: easy to test.
//
// A cell (dot) is one number: row * n + col, from 0 to n * n - 1.
// The line is an array of cells, the first one is the green start dot.
//
// Every puzzle is solvable: a random path through ALL dots (a Hamiltonian path) is made first,
// then walls are put only on edges that this path does not use.

// ---------- Sizes ----------

export const SIZES = Object.freeze({ easy: 5, medium: 6, hard: 7 });
export const LEVELS = Object.freeze(['easy', 'medium', 'hard']);

// Share of the free edges (not used by the solution) that get a wall.
const WALL_FRACTION = Object.freeze({ 5: 0.3, 6: 0.35, 7: 0.4 });

// Coins for a solved puzzle.
export const COINS = Object.freeze({ 5: 3, 6: 5, 7: 8 });

/** The grid size of a level, 5 for anything unknown. */
export function sizeOf(level) {
  return SIZES[level] ?? SIZES.easy;
}

// ---------- Seeded random numbers ----------

/** A 32-bit number from a text (FNV-1a). The same text always gives the same number. */
export function hashString(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * A small seeded random generator (mulberry32). Returns a function that gives numbers from 0 up
 * to (not including) 1; the same seed always gives the same numbers.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Today's date in the user's own time zone as "YYYY-MM-DD". */
export function todayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The day before a "YYYY-MM-DD" key (local calendar, works across months and years). */
export function previousDay(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return todayKey(new Date(y, m - 1, d - 1));
}

/** The seed of the Daily Kolam of a day and size: the same for everyone on that day. */
export function dailySeed(dateKey, size) {
  return hashString(`kolam-daily-${dateKey}-${size}`);
}

/** A whole number from 0 to count - 1. */
function pick(random, count) {
  return Math.min(count - 1, Math.floor(random() * count));
}

// ---------- The grid ----------

export const rowOf = (n, cell) => Math.floor(cell / n);
export const colOf = (n, cell) => cell % n;

/** The dots next to a dot (up, down, left, right), inside the grid. */
export function neighbours(n, cell) {
  const row = rowOf(n, cell);
  const col = colOf(n, cell);
  const list = [];
  if (row > 0) list.push(cell - n);
  if (row < n - 1) list.push(cell + n);
  if (col > 0) list.push(cell - 1);
  if (col < n - 1) list.push(cell + 1);
  return list;
}

/** True when two dots are next to each other. */
export function areNeighbours(n, a, b) {
  return neighbours(n, a).includes(b);
}

/** One name for the edge between two dots (the same both ways round). */
export function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Every edge of the grid, each once. */
export function allEdges(n) {
  const edges = [];
  for (let cell = 0; cell < n * n; cell++) {
    if (colOf(n, cell) < n - 1) edges.push([cell, cell + 1]);
    if (rowOf(n, cell) < n - 1) edges.push([cell, cell + n]);
  }
  return edges;
}

// ---------- A random path through every dot ----------

/** The "snake" path: left to right on the first row, right to left on the next, and so on. */
export function snakePath(n) {
  const path = [];
  for (let row = 0; row < n; row++) {
    for (let i = 0; i < n; i++) path.push(row * n + (row % 2 === 0 ? i : n - 1 - i));
  }
  return path;
}

/**
 * One "backbite" move. Take one end of the path (chosen at random) and one of its grid neighbours
 * that is not already next to it on the path. Joining the end to that neighbour makes a loop;
 * cutting the loop open at the neighbour and turning that part round gives a new path through
 * every dot. The path is changed in place and also returned.
 */
export function backbite(path, n, random) {
  if (path.length < 3) return path;
  // Work on the last dot; for the first dot, turn the path round first (and back at the end).
  const useStart = random() < 0.5;
  if (useStart) path.reverse();
  const end = path[path.length - 1];
  const before = path[path.length - 2];
  const options = neighbours(n, end).filter((cell) => cell !== before);
  if (options.length > 0) {
    const target = options[pick(random, options.length)];
    const i = path.indexOf(target);
    // path[0..i] stays; path[i+1..end] is turned round, so the end now follows target.
    let lo = i + 1;
    let hi = path.length - 1;
    while (lo < hi) {
      [path[lo], path[hi]] = [path[hi], path[lo]];
      lo += 1;
      hi -= 1;
    }
  }
  if (useStart) path.reverse();
  return path;
}

/** A random path through all n * n dots (a Hamiltonian path), made by many backbite moves. */
export function hamiltonianPath(n, random, moves = n * n * 40) {
  const path = snakePath(n);
  for (let k = 0; k < moves; k++) backbite(path, n, random);
  return path;
}

/** True when `path` visits every dot of the n x n grid exactly once, one step at a time. */
export function isHamiltonianPath(path, n) {
  if (!Array.isArray(path) || path.length !== n * n) return false;
  const seen = new Set(path);
  if (seen.size !== n * n) return false;
  for (const cell of path) if (!Number.isInteger(cell) || cell < 0 || cell >= n * n) return false;
  for (let i = 1; i < path.length; i++) if (!areNeighbours(n, path[i - 1], path[i])) return false;
  return true;
}

// ---------- Walls ----------

/**
 * Walls on a share of the edges that the solution does NOT use, so the solution always stays open.
 * @returns {Set<string>} edge keys
 */
export function makeWalls(solution, n, random, fraction = WALL_FRACTION[n] ?? 0.3) {
  const used = new Set();
  for (let i = 1; i < solution.length; i++) used.add(edgeKey(solution[i - 1], solution[i]));
  const free = allEdges(n).filter(([a, b]) => !used.has(edgeKey(a, b)));
  // Shuffle the free edges, then keep the first part.
  for (let i = free.length - 1; i > 0; i--) {
    const j = pick(random, i + 1);
    [free[i], free[j]] = [free[j], free[i]];
  }
  const count = Math.round(free.length * fraction);
  return new Set(free.slice(0, count).map(([a, b]) => edgeKey(a, b)));
}

/** True when a wall is between two neighbouring dots. */
export function hasWall(puzzle, a, b) {
  return puzzle.walls.has(edgeKey(a, b));
}

/**
 * A whole puzzle from a size and a seed. The same size and seed always give the same puzzle.
 * @returns {{ n: number, seed: number, start: number, walls: Set<string>, solution: number[] }}
 */
export function makePuzzle({ size, seed }) {
  const n = [5, 6, 7].includes(size) ? size : 5;
  const random = mulberry32(seed >>> 0);
  const solution = hamiltonianPath(n, random);
  const walls = makeWalls(solution, n, random);
  return { n, seed: seed >>> 0, start: solution[0], walls, solution };
}

// ---------- Moves ----------

/**
 * Try to move the end of the line to `cell`.
 * - the dot just before the end: the line goes back one step (undo)
 * - a free neighbour with no wall in between: the line grows
 * Returns { ok, line, reason } with a NEW line (the old one is not changed).
 * reason: 'grow' | 'back' (ok) or 'wall' | 'visited' | 'notNeighbour' | 'same' (not ok).
 */
export function tryMove(puzzle, line, cell) {
  const end = line[line.length - 1];
  if (cell === end) return { ok: false, line, reason: 'same' };
  if (line.length >= 2 && cell === line[line.length - 2]) return { ok: true, line: line.slice(0, -1), reason: 'back' };
  if (!areNeighbours(puzzle.n, end, cell)) return { ok: false, line, reason: 'notNeighbour' };
  if (hasWall(puzzle, end, cell)) return { ok: false, line, reason: 'wall' };
  if (line.includes(cell)) return { ok: false, line, reason: 'visited' };
  return { ok: true, line: [...line, cell], reason: 'grow' };
}

/**
 * The dots from `from` (not included) to `to` (included) when both are in the same row or column,
 * else [] . Used for a fast drag that jumps over dots.
 */
export function stepsToward(n, from, to) {
  if (from === to) return [];
  const sameRow = rowOf(n, from) === rowOf(n, to);
  const sameCol = colOf(n, from) === colOf(n, to);
  if (!sameRow && !sameCol) return [];
  const step = sameRow ? (to > from ? 1 : -1) : to > from ? n : -n;
  const cells = [];
  for (let cell = from + step; ; cell += step) {
    cells.push(cell);
    if (cell === to) break;
  }
  return cells;
}

/**
 * The finger (or mouse) is now over `cell` while dragging. Handles:
 * - the dot just before the end, or several dots straight back along the line: the line goes back
 * - a free neighbour: the line grows
 * - a dot further away in the same row or column: one step at a time, stopping at the first
 *   step that is not allowed
 * Returns { line, changed, blocked } where blocked is 'wall' | 'visited' | null (the reason the
 * line could not go on).
 */
export function dragTo(puzzle, line, cell) {
  const n = puzzle.n;
  const end = line[line.length - 1];
  if (cell === end || cell === null || cell === undefined) return { line, changed: false, blocked: null };
  const steps = stepsToward(n, end, cell);
  if (steps.length === 0) return { line, changed: false, blocked: null }; // not in a straight line: wait
  // Straight back along the line: the dots before the end, in order.
  if (steps.every((step, i) => step === line[line.length - 2 - i])) {
    return { line: line.slice(0, line.length - steps.length), changed: true, blocked: null };
  }
  let current = line;
  for (const step of steps) {
    const result = tryMove(puzzle, current, step);
    if (!result.ok || result.reason !== 'grow') {
      const blocked = result.reason === 'wall' || result.reason === 'visited' ? result.reason : null;
      return { line: current, changed: current !== line, blocked };
    }
    current = result.line;
  }
  return { line: current, changed: true, blocked: null };
}

/** The line cut back to `cell` (kept), or the same line when `cell` is not on it. */
export function cutAt(line, cell) {
  const at = line.indexOf(cell);
  return at < 0 ? line : line.slice(0, at + 1);
}

/** The dots the line can grow to from its end. */
export function freeMoves(puzzle, line) {
  const end = line[line.length - 1];
  const visited = new Set(line);
  return neighbours(puzzle.n, end).filter((cell) => !visited.has(cell) && !hasWall(puzzle, end, cell));
}

/** True when the line goes through every dot. */
export function isSolved(puzzle, line) {
  return line.length === puzzle.n * puzzle.n && new Set(line).size === line.length;
}

/**
 * Is the line stuck?
 * - 'noMove': not finished and no free dot next to the end of the line
 * - 'cutOff': a dot that is not on the line can no longer be reached (it has no open way to the
 *   end of the line or to another free dot), or two free dots are left with only one way in
 *   (both would have to be the last dot)
 * - null: still possible
 */
export function deadEnd(puzzle, line) {
  if (isSolved(puzzle, line)) return null;
  if (freeMoves(puzzle, line).length === 0) return 'noMove';
  const end = line[line.length - 1];
  const visited = new Set(line);
  const freeCount = puzzle.n * puzzle.n - line.length;
  let oneWayIn = 0;
  for (let cell = 0; cell < puzzle.n * puzzle.n; cell++) {
    if (visited.has(cell)) continue;
    // Open ways from this free dot: to other free dots, or to the end of the line.
    const open = neighbours(puzzle.n, cell).filter((other) => !hasWall(puzzle, cell, other) && (!visited.has(other) || other === end));
    if (open.length === 0) return 'cutOff';
    // Its only way is the end of the line: it must be the next dot, and then the line cannot go on.
    if (open.length === 1 && open[0] === end && freeCount > 1) return 'cutOff';
    if (open.length === 1) oneWayIn += 1;
  }
  // A free dot with one way in must be the last dot of the line: two of them cannot both be last.
  if (oneWayIn > 1) return 'cutOff';
  // The rest of the line goes through free dots only, so they must all hang together
  // (a line straight across the board leaves two parts: only one of them can be visited).
  const first = freeMoves(puzzle, line)[0];
  const seen = new Set([first]);
  const queue = [first];
  while (queue.length > 0) {
    const cell = queue.pop();
    for (const other of neighbours(puzzle.n, cell)) {
      if (!seen.has(other) && !visited.has(other) && !hasWall(puzzle, cell, other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  if (seen.size < puzzle.n * puzzle.n - line.length) return 'cutOff';
  return null;
}

// ---------- Records: best times and the daily streak ----------

export const RECORDS_KEY = 'phantomVoiceKit.kolamPuzzle';

function emptyRecords() {
  return { best: {}, streak: 0, lastDaily: '', dailyDone: { date: '', sizes: [] } };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The saved records, cleaned; damaged or blocked storage gives empty records. */
export function loadRecords(storage) {
  const records = emptyRecords();
  try {
    const data = JSON.parse(storage?.getItem(RECORDS_KEY) ?? 'null');
    if (!data || typeof data !== 'object') return records;
    for (const size of [5, 6, 7]) {
      const ms = Number(data.best?.[size]);
      if (Number.isFinite(ms) && ms > 0) records.best[size] = Math.round(ms);
    }
    const streak = Math.floor(Number(data.streak));
    records.streak = Number.isFinite(streak) && streak > 0 ? streak : 0;
    records.lastDaily = typeof data.lastDaily === 'string' && DATE_PATTERN.test(data.lastDaily) ? data.lastDaily : '';
    if (data.dailyDone && typeof data.dailyDone.date === 'string' && DATE_PATTERN.test(data.dailyDone.date) && Array.isArray(data.dailyDone.sizes)) {
      records.dailyDone = { date: data.dailyDone.date, sizes: [5, 6, 7].filter((s) => data.dailyDone.sizes.includes(s)) };
    }
  } catch {
    // damaged data: start again
  }
  return records;
}

export function saveRecords(storage, records) {
  try {
    if (!storage) return false;
    storage.setItem(RECORDS_KEY, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

/**
 * The records after a solve (a new object). The best time of the size is kept when it was better.
 * A solved Daily Kolam counts for the streak once per day: +1 the day after the last one, 1 after
 * a gap.
 * @returns {{ records: object, newBest: boolean, firstDailyToday: boolean }}
 */
export function recordSolve(records, { size, ms, daily = false, dateKey }) {
  const next = { best: { ...records.best }, streak: records.streak, lastDaily: records.lastDaily, dailyDone: { ...records.dailyDone, sizes: [...records.dailyDone.sizes] } };
  const old = next.best[size];
  const newBest = Number.isFinite(ms) && ms > 0 && (!old || ms < old);
  if (newBest) next.best[size] = Math.round(ms);
  let firstDailyToday = false;
  if (daily) {
    if (next.dailyDone.date !== dateKey) next.dailyDone = { date: dateKey, sizes: [] };
    if (!next.dailyDone.sizes.includes(size)) next.dailyDone.sizes.push(size);
    if (next.lastDaily !== dateKey) {
      firstDailyToday = true;
      next.streak = next.lastDaily === previousDay(dateKey) ? next.streak + 1 : 1;
      next.lastDaily = dateKey;
    }
  }
  return { records: next, newBest, firstDailyToday };
}

/** The streak to show today: it is lost when more than a day has passed since the last Daily Kolam. */
export function currentStreak(records, dateKey) {
  if (records.lastDaily === dateKey || records.lastDaily === previousDay(dateKey)) return records.streak;
  return 0;
}

/** True when the Daily Kolam of this size was solved today. */
export function dailySolved(records, dateKey, size) {
  return records.dailyDone.date === dateKey && records.dailyDone.sizes.includes(size);
}

// The chosen level is remembered on its own (it is a setting, not a record).
export const LEVEL_KEY = 'phantomVoiceKit.kolamPuzzle.level';

export function loadLevel(storage) {
  try {
    const value = storage?.getItem(LEVEL_KEY);
    return LEVELS.includes(value) ? value : 'easy';
  } catch {
    return 'easy';
  }
}

export function saveLevel(storage, level) {
  try {
    if (!storage || !LEVELS.includes(level)) return false;
    storage.setItem(LEVEL_KEY, level);
    return true;
  } catch {
    return false;
  }
}

/** A fresh seed for "New puzzle" (any number works; `random` is Math.random in the page). */
export function freeSeed(random = Math.random) {
  return Math.floor(random() * 4294967296) >>> 0;
}

/**
 * The dot a board point is on. x and y are in board units (each dot is 1 unit apart, the first
 * dot at 0.5). Only points close to a dot count (radius), so a diagonal slip between dots does nothing.
 */
export function cellAt(n, x, y, radius = 0.42) {
  const col = Math.round(x - 0.5);
  const row = Math.round(y - 0.5);
  if (col < 0 || row < 0 || col >= n || row >= n) return null;
  const dx = x - (col + 0.5);
  const dy = y - (row + 0.5);
  return dx * dx + dy * dy <= radius * radius ? row * n + col : null;
}

/** 83500 ms gives "1:23" (minutes:seconds); an hour or more gives "1:02:03". */
export function formatTime(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
