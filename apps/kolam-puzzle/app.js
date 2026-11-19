// Kolam Puzzle: draw ONE line through every dot, moving only up, down, left or right, never across
// a wall. Start on the glowing green dot and drag (mouse or touch); slide back to undo; tap a dot on
// the line to cut it back there. One "Daily Kolam" per day (seeded from the date) and free play.
// Everything runs on the device: no Gemini, no network.

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { createNavMenu } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, setI18nAttr, clearI18n } from '/skeleton/i18n.js';
import { correct, levelUp, giftBox } from '/skeleton/celebrate.js';
import {
  LEVELS,
  COINS,
  sizeOf,
  makePuzzle,
  dailySeed,
  freeSeed,
  todayKey,
  rowOf,
  colOf,
  hasWall,
  dragTo,
  tryMove,
  cutAt,
  isSolved,
  deadEnd,
  cellAt,
  loadRecords,
  saveRecords,
  recordSolve,
  currentStreak,
  dailySolved,
  formatTime,
  loadLevel,
  saveLevel,
} from '/apps/kolam-puzzle/kolam-utils.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

const SVG_NS = 'http://www.w3.org/2000/svg';
const SAY_AGAIN_MS = 2500; // the same spoken message is not repeated sooner than this
const TICK_MS = 250;

// ---------- DOM ----------

const $ = (id) => document.getElementById(id);
const levelButtons = [...document.querySelectorAll('#difficulty [data-level]')];
const dailyButton = $('daily-button');
const newButton = $('new-button');
const puzzleLabel = $('puzzle-label');
const timerEl = $('timer');
const bestText = $('best-text');
const streakText = $('streak-text');
const progressEl = $('progress');
const progressFill = $('progress-fill');
const progressText = $('progress-text');
const board = $('board');
const messageEl = $('message');
const undoButton = $('undo-button');
const resetButton = $('reset-button');
const solvedEl = $('solved');
const solvedText = $('solved-text');
const newBestEl = $('new-best');
const againButton = $('again-button');

// ---------- State ----------

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let records = loadRecords(storage());
const state = {
  language: getCurrentLanguage(),
  level: loadLevel(storage()),
  daily: true, // the Daily Kolam, or free play
  dateKey: todayKey(),
  puzzle: null,
  line: [],
  startedAt: 0, // the time of the first move (0 = not started)
  finishedMs: 0, // the time of a solved puzzle
  solved: false,
  stuck: null, // the dead end reported now: null | 'noMove' | 'cutOff'
  dragging: false,
  pointerId: null,
};
let speechOutput = null;
let tickTimer = null;
const lastSaid = new Map(); // message key -> when it was last spoken

// ---------- Speech ----------

function createVoice() {
  if (speechOutput) speechOutput.stop();
  speechOutput = createSpeechOutput({ lang: state.language.bcp47 });
}

// Speak a short message in the chosen language. A device without a voice for that language stays
// silent (the text is on the screen anyway); a message is not repeated within SAY_AGAIN_MS.
function say(key, params) {
  const now = Date.now();
  if (now - (lastSaid.get(key) ?? -Infinity) < SAY_AGAIN_MS) return;
  lastSaid.set(key, now);
  try {
    speechOutput.stop();
    speechOutput.speak(t(key, params));
  } catch {
    // speaking is a bonus; the game never depends on it
  }
}

function showMessage(key, params, kind = 'info') {
  setI18nText(messageEl, key, params);
  messageEl.dataset.kind = kind;
  messageEl.hidden = false;
}

function hideMessage() {
  clearI18n(messageEl);
  messageEl.hidden = true;
}

// ---------- Puzzle ----------

// Bring the whole board into view (when the player picked a puzzle; not on the first load).
function showBoard() {
  const rect = board.getBoundingClientRect();
  if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
  let smooth = true;
  try {
    smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // keep smooth
  }
  board.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
}

function newPuzzle({ daily, scroll = true }) {
  state.daily = daily;
  state.dateKey = todayKey();
  const size = sizeOf(state.level);
  const seed = daily ? dailySeed(state.dateKey, size) : freeSeed();
  state.puzzle = makePuzzle({ size, seed });
  state.line = [state.puzzle.start];
  state.startedAt = 0;
  state.finishedMs = 0;
  state.solved = false;
  state.stuck = null;
  stopTimer();
  solvedEl.hidden = true;
  hideMessage();
  drawBoard();
  renderAll();
  say('kolamPuzzle.speakStart');
  if (scroll) showBoard();
}

function renderAll() {
  renderChoices();
  renderLabel();
  renderRecords();
  renderLine();
  renderProgress();
  renderTimer();
  undoButton.disabled = state.line.length <= 1 || state.solved;
  resetButton.disabled = state.line.length <= 1 || state.solved;
}

function renderChoices() {
  for (const button of levelButtons) button.setAttribute('aria-pressed', String(button.dataset.level === state.level));
  dailyButton.setAttribute('aria-pressed', String(state.daily));
  newButton.setAttribute('aria-pressed', String(!state.daily));
}

function renderLabel() {
  const n = state.puzzle.n;
  if (state.daily) {
    const done = dailySolved(records, state.dateKey, n);
    setI18nText(puzzleLabel, done ? 'kolamPuzzle.dailyDone' : 'kolamPuzzle.dailyLabel', { size: `${n} × ${n}` });
  } else {
    setI18nText(puzzleLabel, 'kolamPuzzle.freeLabel', { size: `${n} × ${n}` });
  }
}

function renderRecords() {
  const best = records.best[state.puzzle.n];
  if (best) setI18nText(bestText, 'kolamPuzzle.best', { time: formatTime(best) });
  else setI18nText(bestText, 'kolamPuzzle.noBest');
  setI18nText(streakText, 'kolamPuzzle.streak', { n: currentStreak(records, todayKey()) });
}

function renderProgress() {
  const total = state.puzzle.n * state.puzzle.n;
  const done = state.line.length;
  progressFill.style.inlineSize = `${(100 * done) / total}%`;
  progressEl.setAttribute('aria-valuemax', String(total));
  progressEl.setAttribute('aria-valuenow', String(done));
  setI18nText(progressText, 'kolamPuzzle.progress', { done, total });
  setI18nAttr(progressEl, 'aria-label', 'kolamPuzzle.progressLabel');
}

// ---------- Timer (computed from timestamps, so a hidden tab stays correct) ----------

function elapsed() {
  if (state.solved) return state.finishedMs;
  return state.startedAt ? Date.now() - state.startedAt : 0;
}

function renderTimer() {
  timerEl.textContent = formatTime(elapsed());
}

function startTimer() {
  if (state.startedAt) return;
  state.startedAt = Date.now();
  clearInterval(tickTimer);
  tickTimer = setInterval(renderTimer, TICK_MS);
}

function stopTimer() {
  clearInterval(tickTimer);
  tickTimer = null;
}

// ---------- The board (SVG, one unit between dots) ----------

let lineEl = null;
let dotEls = [];

function svg(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
}

const centre = (n, cell) => ({ x: colOf(n, cell) + 0.5, y: rowOf(n, cell) + 0.5 });

function drawBoard() {
  const { n, start } = state.puzzle;
  board.textContent = '';
  board.setAttribute('viewBox', `0 0 ${n} ${n}`);
  labelBoard();

  // A soft glow for the start dot (a gradient, not a filter: fast on old phones).
  const defs = svg('defs');
  const glow = svg('radialGradient', { id: 'kolam-glow' });
  glow.append(svg('stop', { offset: '0', 'stop-color': '#9cff57', 'stop-opacity': '0.85' }), svg('stop', { offset: '1', 'stop-color': '#9cff57', 'stop-opacity': '0' }));
  defs.appendChild(glow);
  board.appendChild(defs);

  // Walls: a short bar across the middle of the edge between two dots.
  const walls = svg('g', { class: 'kolam-walls' });
  for (const key of state.puzzle.walls) {
    const [a, b] = key.split('-').map(Number);
    const p = centre(n, a);
    const q = centre(n, b);
    const mx = (p.x + q.x) / 2;
    const my = (p.y + q.y) / 2;
    const across = rowOf(n, a) === rowOf(n, b); // a left-right edge gets an up-down bar
    walls.appendChild(svg('line', across
      ? { x1: mx, y1: my - 0.36, x2: mx, y2: my + 0.36, class: 'kolam-wall', 'data-edge': key }
      : { x1: mx - 0.36, y1: my, x2: mx + 0.36, y2: my, class: 'kolam-wall', 'data-edge': key }));
  }

  lineEl = svg('polyline', { class: 'kolam-line', fill: 'none' });

  const dots = svg('g', { class: 'kolam-dots' });
  const startGlow = svg('circle', { ...toXY(centre(n, start)), r: 0.42, fill: 'url(#kolam-glow)', class: 'kolam-start-glow' });
  dots.appendChild(startGlow);
  dotEls = [];
  for (let cell = 0; cell < n * n; cell++) {
    const dot = svg('circle', { ...toXY(centre(n, cell)), r: cell === start ? 0.17 : 0.11, class: cell === start ? 'kolam-dot kolam-dot--start' : 'kolam-dot' });
    dots.appendChild(dot);
    dotEls.push(dot);
  }
  board.append(walls, lineEl, dots);
}

const toXY = ({ x, y }) => ({ cx: x, cy: y });

// The board's name for screen readers, with its size (set here: the text has a {size} part).
function labelBoard() {
  const n = state.puzzle.n;
  board.setAttribute('aria-label', t('kolamPuzzle.boardLabel', { size: `${n} × ${n}` }));
}

function renderLine() {
  const n = state.puzzle.n;
  lineEl.setAttribute('points', state.line.map((cell) => { const p = centre(n, cell); return `${p.x},${p.y}`; }).join(' '));
  lineEl.classList.toggle('kolam-line--solved', state.solved);
  const onLine = new Set(state.line);
  const end = state.line[state.line.length - 1];
  dotEls.forEach((dot, cell) => {
    dot.classList.toggle('kolam-dot--on', onLine.has(cell));
    dot.classList.toggle('kolam-dot--end', cell === end && !state.solved);
  });
}

// A wall that blocked the line flashes for a moment.
function flashWall(a, b) {
  const key = a < b ? `${a}-${b}` : `${b}-${a}`;
  const el = board.querySelector(`[data-edge="${key}"]`);
  if (!el) return;
  el.classList.remove('kolam-wall--hit');
  void el.getBoundingClientRect(); // restart the animation
  el.classList.add('kolam-wall--hit');
}

// ---------- Changing the line ----------

function setLine(next) {
  if (next === state.line) return;
  if (next.length > state.line.length) startTimer();
  state.line = next;
  afterChange();
}

function afterChange() {
  if (isSolved(state.puzzle, state.line)) {
    finish();
    return;
  }
  const stuck = deadEnd(state.puzzle, state.line);
  if (stuck && stuck !== state.stuck) {
    const key = stuck === 'noMove' ? 'kolamPuzzle.deadEnd' : 'kolamPuzzle.cutOff';
    showMessage(key, undefined, 'warn');
    say(key);
  } else if (!stuck && state.stuck) {
    hideMessage();
  }
  state.stuck = stuck;
  renderAll();
}

function blockedBy(reason, from, to) {
  if (reason !== 'wall') return;
  flashWall(from, to);
  showMessage('kolamPuzzle.wall', undefined, 'warn');
  say('kolamPuzzle.wall');
}

function finish() {
  state.solved = true;
  state.stuck = null;
  state.finishedMs = state.startedAt ? Date.now() - state.startedAt : 0;
  state.dragging = false;
  stopTimer();
  const n = state.puzzle.n;
  const result = recordSolve(records, { size: n, ms: state.finishedMs, daily: state.daily, dateKey: state.dateKey });
  records = result.records;
  saveRecords(storage(), records);
  hideMessage();
  renderAll();
  const time = formatTime(state.finishedMs);
  setI18nText(solvedText, 'kolamPuzzle.solved', { time });
  newBestEl.hidden = !result.newBest;
  solvedEl.hidden = false;
  say('kolamPuzzle.solved', { time });
  againButton.focus(); // before the gift: its Collect button gives the focus back here
  correct({ coins: COINS[n], from: board });
  levelUp();
  if (result.firstDailyToday) giftBox();
}

// ---------- Drag and tap (pointer events: mouse, touch and pen) ----------

function boardPoint(event) {
  const rect = board.getBoundingClientRect();
  const n = state.puzzle.n;
  return { x: ((event.clientX - rect.left) / rect.width) * n, y: ((event.clientY - rect.top) / rect.height) * n };
}

function hitCell(event) {
  const { x, y } = boardPoint(event);
  return cellAt(state.puzzle.n, x, y);
}

board.addEventListener('pointerdown', (event) => {
  if (state.solved || !state.puzzle) return;
  const cell = hitCell(event);
  if (cell === null) return;
  event.preventDefault();
  if (state.line.includes(cell)) {
    // A dot on the line: cut the line back to it, and go on dragging from there.
    setLine(cutAt(state.line, cell));
  } else {
    const result = tryMove(state.puzzle, state.line, cell);
    if (result.ok) setLine(result.line);
    else {
      blockedBy(result.reason, state.line[state.line.length - 1], cell);
      return;
    }
  }
  state.dragging = true;
  state.pointerId = event.pointerId;
  try {
    board.setPointerCapture(event.pointerId);
  } catch {
    // capture is a bonus
  }
});

board.addEventListener('pointermove', (event) => {
  if (!state.dragging || event.pointerId !== state.pointerId || state.solved) return;
  event.preventDefault();
  const cell = hitCell(event);
  if (cell === null) return;
  const result = dragTo(state.puzzle, state.line, cell);
  if (result.changed) setLine(result.line);
  if (result.blocked) {
    const at = result.line[result.line.length - 1];
    blockedBy(result.blocked, at, nextToward(at, cell));
  }
});

// The dot after `from` on the way to `to` (for the wall that blocked a straight drag).
function nextToward(from, to) {
  const n = state.puzzle.n;
  if (rowOf(n, from) === rowOf(n, to)) return from + (to > from ? 1 : -1);
  return from + (to > from ? n : -n);
}

function endDrag(event) {
  if (event.pointerId !== state.pointerId) return;
  state.dragging = false;
  state.pointerId = null;
}
board.addEventListener('pointerup', endDrag);
board.addEventListener('pointercancel', endDrag);
board.addEventListener('lostpointercapture', endDrag);

// Keyboard: the arrow keys move the end of the line, Backspace undoes.
board.addEventListener('keydown', (event) => {
  if (state.solved || !state.puzzle) return;
  const n = state.puzzle.n;
  const end = state.line[state.line.length - 1];
  const moves = {
    ArrowUp: rowOf(n, end) > 0 ? end - n : null,
    ArrowDown: rowOf(n, end) < n - 1 ? end + n : null,
    ArrowLeft: colOf(n, end) > 0 ? end - 1 : null,
    ArrowRight: colOf(n, end) < n - 1 ? end + 1 : null,
  };
  if (event.key === 'Backspace') {
    event.preventDefault();
    undo();
    return;
  }
  if (!(event.key in moves)) return;
  event.preventDefault();
  // The board is drawn the same in every language, so the arrows follow the board.
  const target = moves[event.key];
  if (target === null) return;
  const result = tryMove(state.puzzle, state.line, target);
  if (result.ok) setLine(result.line);
  else blockedBy(result.reason, end, target);
});

// ---------- Buttons ----------

function undo() {
  if (state.line.length <= 1 || state.solved) return;
  setLine(state.line.slice(0, -1));
}

undoButton.addEventListener('click', undo);
resetButton.addEventListener('click', () => {
  if (state.solved) return;
  setLine([state.puzzle.start]);
});

for (const button of levelButtons) {
  button.addEventListener('click', () => {
    state.level = button.dataset.level;
    saveLevel(storage(), state.level);
    newPuzzle({ daily: state.daily });
  });
}
dailyButton.addEventListener('click', () => newPuzzle({ daily: true }));
newButton.addEventListener('click', () => newPuzzle({ daily: false }));
againButton.addEventListener('click', () => newPuzzle({ daily: false }));

// ---------- Nav and language ----------

const nav = createNavMenu(document.getElementById('app-header'), {
  current: 'kolam-puzzle',
  onLeave: () => {
    stopTimer();
    if (speechOutput) speechOutput.stop();
  },
});

createLanguageDropdown(nav.languageEl, {
  onChange: (lang) => {
    state.language = lang;
    createVoice();
    renderAll(); // the numbers inside the texts
    labelBoard();
  },
});
state.language = getCurrentLanguage();

// A new day while the page stays open: the Daily Kolam button gives the new day's puzzle.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) renderRecords();
});

// ---------- Start ----------

if (!LEVELS.includes(state.level)) state.level = 'easy';
createVoice();
newPuzzle({ daily: true, scroll: false });
