// tests/unit/pauseButton.test.js
// The Ghost Tutor Pause button must be visible during the whole lesson and
// hidden only on the topic screen and the end screen.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { isPauseVisible } from '../../apps/ghost-tutor/lesson-utils.js';

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

// Every step of a lesson (see the phase comment in apps/ghost-tutor/app.js).
const LESSON_STATES = {
  idle: 'lesson screen just opened',
  segment: 'a part is being spoken',
  asking: 'the quiz question is asked / the mic is listening',
  translating: 'the answer is being translated',
  evaluating: 'the answer is being checked (or Skip was pressed)',
  feedback: 'feedback is shown',
};

describe('isPauseVisible', () => {
  for (const [phase, meaning] of Object.entries(LESSON_STATES)) {
    test(`shown on the lesson screen while ${meaning} (${phase})`, () => {
      assert.equal(isPauseVisible('lesson', phase), true);
    });
  }

  test('hidden on the end screen', () => {
    assert.equal(isPauseVisible('lesson', 'complete'), false);
  });

  test('hidden on the topic screen, whatever the phase', () => {
    for (const phase of [...Object.keys(LESSON_STATES), 'complete']) {
      assert.equal(isPauseVisible('topic', phase), false, phase);
    }
  });
});

describe('the page wiring', () => {
  const html = read('apps/ghost-tutor/index.html');
  const app = read('apps/ghost-tutor/app.js');
  const css = read('apps/ghost-tutor/style.css');

  test('the button sits in the lesson bar next to the counter, inside the lesson screen', () => {
    const lesson = html.slice(html.indexOf('<section id="screen-lesson"'), html.indexOf('</section>', html.indexOf('<section id="screen-lesson"')));
    const bar = lesson.slice(lesson.indexOf('<div id="lesson-bar"'), lesson.indexOf('</div>', lesson.indexOf('<div id="lesson-bar"')));
    assert.ok(bar.length > 0, 'lesson-bar missing in the lesson screen');
    assert.match(bar, /id="lesson-progress"/);
    assert.match(bar, /<button id="pause-button"[^>]*>/);
  });

  test('the button is not hidden by default in the HTML (old or missing JS cannot hide it)', () => {
    const tag = html.match(/<button id="pause-button"[^>]*>/)[0];
    assert.doesNotMatch(tag, /\shidden(\s|>|=)/);
  });

  test('the lesson bar stays at the top while scrolling', () => {
    const rule = css.slice(css.indexOf('.lesson-bar {'), css.indexOf('}', css.indexOf('.lesson-bar {')));
    assert.match(rule, /position:\s*sticky/);
  });

  test('app.js sets the button only through isPauseVisible, on every phase and screen change', () => {
    const toggles = app.match(/pauseButton\.hidden\s*=/g) || [];
    assert.equal(toggles.length, 1, 'only updatePauseButton may set pauseButton.hidden');
    assert.match(app, /pauseButton\.hidden = !isPauseVisible\(currentScreen, phase\)/);
    // No step may change the phase without going through setPhase (which updates the button).
    assert.doesNotMatch(app, /^\s+phase = '/m);
    assert.match(app, /function setPhase\(next\) \{\s*phase = next;\s*updatePauseButton\(\);/);
    assert.match(app, /currentScreen = name;\s*for \(const \[key, el\] of Object\.entries\(screens\)\) \{\s*el\.hidden = key !== name;\s*\}\s*updatePauseButton\(\);/);
  });

  test('pressing Pause stops speech and the mic at once', () => {
    const fn = app.slice(app.indexOf('function pauseLesson()'), app.indexOf('function resumeLesson()'));
    assert.match(fn, /askId \+= 1/);
    assert.match(fn, /stopEverything\(\)/);
    assert.match(fn, /setPausedUi\(true\)/);
  });
});
