// progress-utils.js
// Pure helpers for saving and restoring Ghost Tutor progress (localStorage).
// No DOM and no storage access here, so they are easy to test.
// The app wraps the real localStorage calls in try/catch.

import { coveredTitles } from './lesson-utils.js';

export const PROGRESS_KEY = 'phantomVoiceKit.ghostTutor.progress';
export const PROGRESS_VERSION = 1;

const PARTS_PER_ROUND = 4;
const MAX_ROUNDS = 5;

const isText = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Build the object that is saved.
 * score = the score at the START of the current part (so a replayed part is not counted twice).
 */
export function buildProgress({ topic, language, segments, segmentIndex, score, round }) {
  return {
    v: PROGRESS_VERSION,
    topic,
    language: { label: language.label, bcp47: language.bcp47 },
    segments: segments.map((s) => ({
      title: typeof s.title === 'string' ? s.title : '',
      segment: s.segment,
      quizQuestion: s.quizQuestion,
      lang: s.lang || language.bcp47, // language the original texts are written in
      correct: s.correct === true, // answered correctly (counts for the gift at the end of a round)
    })),
    segmentIndex,
    score,
    round,
    taught: coveredTitles(segments), // titles of the parts taught so far
    savedAt: Date.now(),
  };
}

/**
 * Read saved text. Returns a clean progress object, or null if there is
 * nothing saved or the data is damaged or does not look right.
 */
export function parseProgress(json) {
  if (typeof json !== 'string' || json === '') return null;
  let data;
  try {
    data = JSON.parse(json);
  } catch (err) {
    return null;
  }
  if (!data || typeof data !== 'object' || data.v !== PROGRESS_VERSION) return null;
  if (!isText(data.topic)) return null;
  if (!data.language || !isText(data.language.label) || !isText(data.language.bcp47)) return null;

  const { round, segmentIndex, score } = data;
  if (!Number.isInteger(round) || round < 1 || round > MAX_ROUNDS) return null;
  if (!Array.isArray(data.segments) || data.segments.length !== round * PARTS_PER_ROUND) return null;
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= data.segments.length) return null;
  if (!Number.isInteger(score) || score < 0 || score > segmentIndex) return null;

  const segments = [];
  for (const s of data.segments) {
    if (!s || !isText(s.segment) || !isText(s.quizQuestion) || !isText(s.lang)) return null;
    segments.push({
      title: typeof s.title === 'string' ? s.title : '',
      segment: s.segment,
      quizQuestion: s.quizQuestion,
      lang: s.lang,
      correct: s.correct === true, // older saves have no flag: not counted
    });
  }

  return {
    v: PROGRESS_VERSION,
    topic: data.topic,
    language: { label: data.language.label, bcp47: data.language.bcp47 },
    segments,
    segmentIndex,
    score,
    round,
    taught: Array.isArray(data.taught) ? data.taught.filter((x) => typeof x === 'string') : [],
    savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0,
  };
}

/**
 * Turn saved parts back into the segment objects the lesson uses
 * (each text is cached under the language it was written in).
 */
export function restoreSegments(list) {
  return list.map((s) => ({
    title: s.title,
    lang: s.lang,
    segment: s.segment,
    quizQuestion: s.quizQuestion,
    correct: s.correct === true,
    texts: {
      segment: { [s.lang]: s.segment },
      quizQuestion: { [s.lang]: s.quizQuestion },
    },
    feedbackTexts: {},
    feedbackSource: null,
  }));
}
