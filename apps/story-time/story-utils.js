// story-utils.js
// Pure rules of Story time: the 6 stories (the texts are in the locale files), where the reader
// stopped, the stories finished, the text size, and the spoken commands. Storage is passed in;
// every access is in try/catch. No DOM, no network.

import { normalizeSpeech, closeness } from '../../skeleton/word-match.js';

export const PARAGRAPHS = 8;
export const STORIES = Object.freeze([
  { id: 'lion', emoji: '🦁' },
  { id: 'crow', emoji: '🐦' }, // plain bird: the black-bird sequence shows as a box on Windows
  { id: 'ant', emoji: '🐜' },
  { id: 'tortoise', emoji: '🐢' },
  { id: 'woodcutter', emoji: '🪓' },
  { id: 'ghost', emoji: '👻' },
]);
export const STORY_IDS = Object.freeze(STORIES.map((story) => story.id));

/** The locale key of a story's title. */
export function titleKey(id) {
  return `story.${id}.title`;
}

/** The locale key of paragraph `index` (0 to 7) of a story. */
export function paragraphKey(id, index) {
  return `story.${id}.p${index + 1}`;
}

/** A paragraph number from 0 to 7 (anything else is made into one). */
export function clampParagraph(index) {
  let n;
  try {
    n = Math.floor(Number(index));
  } catch {
    return 0; // an object that cannot become a number (for example { toString: '' }) from damaged saved data
  }
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(PARAGRAPHS - 1, n);
}

/**
 * The paragraph one step away from `index`: delta +1 is Next, -1 is Back.
 * Always exactly one step (or none at the first / last paragraph), never more.
 */
export function stepParagraph(index, delta) {
  const step = Math.sign(Number(delta) || 0);
  return clampParagraph(clampParagraph(index) + step);
}

/**
 * The voice says it finished reading a paragraph. What now?
 * `spoken` is { run, index } of the paragraph that was read; `now` is { run, index, playing }.
 * Returns 'ignore' for an old or stray end event (after Pause, Next, Back or a new start),
 * 'finish' after the last paragraph, or the number of the next paragraph.
 */
export function afterParagraphEnd(spoken, now) {
  if (!spoken || !now) return 'ignore';
  if (spoken.run !== now.run || !now.playing || spoken.index !== now.index) return 'ignore';
  return spoken.index >= PARAGRAPHS - 1 ? 'finish' : spoken.index + 1;
}

// ---------- Where the reader stopped ----------

export const PROGRESS_KEY = 'phantomVoiceKit.storyTime';

/** Empty progress: no last story, nothing read, nothing finished. */
export function emptyProgress() {
  return { last: '', at: {}, finished: [], fontStep: DEFAULT_STEP }; // normal text size
}

/** Make any value into clean progress (only known stories, paragraphs 0 to 7). */
export function cleanProgress(value) {
  const progress = emptyProgress();
  if (!value || typeof value !== 'object') return progress;
  if (STORY_IDS.includes(value.last)) progress.last = value.last;
  if (value.at && typeof value.at === 'object') {
    for (const id of STORY_IDS) if (value.at[id] !== undefined) progress.at[id] = clampParagraph(value.at[id]);
  }
  if (Array.isArray(value.finished)) progress.finished = STORY_IDS.filter((id) => value.finished.includes(id));
  progress.fontStep = clampFontStep(value.fontStep);
  return progress;
}

export function loadProgress(storage) {
  try {
    const text = storage?.getItem(PROGRESS_KEY);
    return text ? cleanProgress(JSON.parse(text)) : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(storage, progress) {
  try {
    storage?.setItem(PROGRESS_KEY, JSON.stringify(cleanProgress(progress)));
    return true;
  } catch {
    return false;
  }
}

/** New progress: the reader is at paragraph `index` of story `id`. */
export function atParagraph(progress, id, index) {
  const clean = cleanProgress(progress);
  if (!STORY_IDS.includes(id)) return clean;
  return { ...clean, last: id, at: { ...clean.at, [id]: clampParagraph(index) } };
}

/** New progress: story `id` was read to the end (it starts at the beginning next time). */
export function finishStory(progress, id) {
  const clean = cleanProgress(progress);
  if (!STORY_IDS.includes(id)) return clean;
  const finished = STORY_IDS.filter((s) => s === id || clean.finished.includes(s)); // in list order
  return { ...clean, last: id, at: { ...clean.at, [id]: 0 }, finished };
}

// ---------- Text size ----------

// A- / A+ steps: the text is this many times the normal size.
export const FONT_STEPS = Object.freeze([0.85, 1, 1.2, 1.45, 1.75]);
const DEFAULT_STEP = 1; // index of 1 in FONT_STEPS

/** A text size step: an index into FONT_STEPS (default: the normal size). */
export function clampFontStep(step) {
  const n = Math.floor(Number(step));
  if (!Number.isFinite(n)) return DEFAULT_STEP;
  return Math.min(FONT_STEPS.length - 1, Math.max(0, n));
}

/** The size multiplier of a step. */
export function fontScale(step) {
  return FONT_STEPS[clampFontStep(step)];
}

// ---------- Spoken commands: next, back, stop ----------

/**
 * What a spoken command means: 'next', 'back', 'stop' or null. The words of the chosen language
 * (from the locale: "next|go on") and the English words always work. Forgiving like the games.
 * @param {string} heard
 * @param {{next?:string[], back?:string[], stop?:string[]}} words
 */
export function storyCommand(heard, words = {}) {
  const tokens = normalizeSpeech(heard).split(' ').filter((token) => token !== '');
  if (tokens.length === 0) return null;
  const lists = {
    next: [...(words.next ?? []), 'next', 'go on', 'continue'],
    back: [...(words.back ?? []), 'back', 'previous', 'go back'],
    stop: [...(words.stop ?? []), 'stop', 'pause', 'wait'],
  };
  let best = null;
  for (const [command, list] of Object.entries(lists)) {
    for (const word of list) {
      const form = normalizeSpeech(word);
      if (form === '') continue;
      const width = form.split(' ').length;
      for (let j = 0; j + width <= tokens.length; j++) {
        const score = closeness(tokens.slice(j, j + width).join(' '), form);
        if (score !== Infinity && (!best || score < best.score || (score === best.score && form.length > best.length))) {
          best = { command, score, length: form.length };
        }
      }
    }
  }
  return best ? best.command : null;
}
