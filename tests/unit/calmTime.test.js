// calmTime.test.js
// The pure rules of Calm Ghost: timestamp timer, bells and spoken marks, breathing circle,
// daily routine (history, streak), reminders and the .ics calendar file. Plus the guidance and
// UI strings in the real locale files of all 20 languages. No browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';

import {
  MINUTE_MS, startTimer, elapsedMs, remainingMs, isFinished, isPaused, pauseTimer, resumeTimer, fractionLeft,
  formatClock, clampMinutes, MEDITATION_MINUTES, ACTIVITY_MINUTES, crossedMarks, intervalMarks,
  BREATH_IN_MS, BREATH_CYCLE_MS, breathPhase, GUIDANCE_KEYS, guidanceMarks, activityMarks, marksToPlay,
  dayKey, isDayKey, addDays, weekdayOf, ROUTINE_KEY, ACTIVITIES, ALL_DAYS, emptyRoutine, cleanTime, cleanDays,
  cleanRoutine, loadRoutine, saveRoutine, itemProblem, addItem, removeItem, plannedOn, isDone, setDone,
  dayStatus, history, streak, completedNow, timeOnDay, dueReminders,
  icsEscape, foldIcsLine, firstPlannedDay, buildIcs, icsFilename,
} from '../../apps/calm-time/calm-utils.js';

const LOCALES = ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr'];
const STRINGS = Object.fromEntries(LOCALES.map((code) => [code, JSON.parse(readFileSync(new URL(`../../skeleton/locales/${code}.json`, import.meta.url), 'utf8'))]));

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
}
const blockedStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

// ---------- Timer ----------

describe('the timer is made of timestamps', () => {
  test('counts down from the start time, whatever the ticks did', () => {
    const timer = startTimer(5 * MINUTE_MS, 1_000_000);
    assert.equal(remainingMs(timer, 1_000_000), 5 * MINUTE_MS);
    assert.equal(remainingMs(timer, 1_000_000 + 61_000), 5 * MINUTE_MS - 61_000);
    // A hidden tab: no tick for 4 minutes; the time is still right when it comes back.
    assert.equal(remainingMs(timer, 1_000_000 + 4 * MINUTE_MS), MINUTE_MS);
    assert.equal(isFinished(timer, 1_000_000 + 5 * MINUTE_MS), true);
    assert.equal(remainingMs(timer, 1_000_000 + 99 * MINUTE_MS), 0);
    assert.equal(remainingMs(timer, 0), 5 * MINUTE_MS); // a clock before the start: nothing ran
  });

  test('pauses do not count', () => {
    let timer = startTimer(10 * MINUTE_MS, 0);
    timer = pauseTimer(timer, 2 * MINUTE_MS);
    assert.equal(isPaused(timer), true);
    assert.equal(elapsedMs(timer, 9 * MINUTE_MS), 2 * MINUTE_MS); // frozen while paused
    assert.equal(pauseTimer(timer, 5 * MINUTE_MS), timer); // pausing twice changes nothing
    timer = resumeTimer(timer, 7 * MINUTE_MS);
    assert.equal(isPaused(timer), false);
    assert.equal(elapsedMs(timer, 8 * MINUTE_MS), 3 * MINUTE_MS);
    assert.equal(resumeTimer(timer, 9 * MINUTE_MS), timer);
  });

  test('property: elapsed + remaining = duration, and remaining never grows (100 runs)', () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 240 }),
      fc.array(fc.integer({ min: 0, max: 10 * MINUTE_MS }), { minLength: 1, maxLength: 12 }),
      (minutes, gaps) => {
        let now = 1_700_000_000_000;
        let timer = startTimer(minutes * MINUTE_MS, now);
        let last = remainingMs(timer, now);
        gaps.forEach((gap, i) => {
          now += gap;
          timer = i % 3 === 1 ? pauseTimer(timer, now) : resumeTimer(timer, now);
          const left = remainingMs(timer, now);
          assert.equal(elapsedMs(timer, now) + left, timer.durationMs);
          assert.ok(left <= last && left >= 0);
          last = left;
        });
      }
    ), { numRuns: 100 });
  });

  test('fraction left goes from 1 to 0', () => {
    const timer = startTimer(MINUTE_MS, 0);
    assert.equal(fractionLeft(timer, 0), 1);
    assert.equal(fractionLeft(timer, 30_000), 0.5);
    assert.equal(fractionLeft(timer, MINUTE_MS), 0);
    assert.equal(fractionLeft(startTimer(0, 0), 0), 0);
  });

  test('the clock shows whole seconds, rounded up', () => {
    assert.equal(formatClock(5 * MINUTE_MS), '05:00');
    assert.equal(formatClock(59_001), '01:00');
    assert.equal(formatClock(59_000), '00:59');
    assert.equal(formatClock(1), '00:01');
    assert.equal(formatClock(0), '00:00');
    assert.equal(formatClock(-5), '00:00');
    assert.equal(formatClock(60 * MINUTE_MS), '1:00:00');
    assert.equal(formatClock(90 * MINUTE_MS + 5000), '1:30:05');
  });

  test('typed minutes: whole numbers from 1 to 240 only', () => {
    assert.equal(clampMinutes('25'), 25);
    assert.equal(clampMinutes(' 1 '), 1);
    assert.equal(clampMinutes(240), 240);
    for (const bad of ['0', '241', '2.5', '-3', 'abc', '', null, undefined, '1e2']) assert.equal(clampMinutes(bad), null, String(bad));
  });

  test('the minute choices asked for', () => {
    assert.deepEqual([...MEDITATION_MINUTES], [5, 10, 20, 30]);
    assert.deepEqual([...ACTIVITY_MINUTES], [15, 30, 45, 60]);
  });
});

// ---------- Marks ----------

describe('bells and spoken words during a session', () => {
  test('crossedMarks: only marks after the last look and up to now', () => {
    const marks = [{ atMs: 10 }, { atMs: 20 }, { atMs: 30 }];
    assert.deepEqual(crossedMarks(marks, 0, 10), [{ atMs: 10 }]);
    assert.deepEqual(crossedMarks(marks, 10, 25), [{ atMs: 20 }]);
    assert.deepEqual(crossedMarks(marks, 25, 25), []);
    assert.deepEqual(crossedMarks(marks, 0, 99), marks);
  });

  test('property: looking often or rarely plays every mark exactly once (100 runs)', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 60_000 }), { minLength: 1, maxLength: 30 }), (steps) => {
      const marks = intervalMarks(30 * MINUTE_MS, 1);
      let at = 0;
      const seen = [];
      for (const step of [...steps, 30 * MINUTE_MS]) {
        const next = Math.min(30 * MINUTE_MS, at + step);
        seen.push(...crossedMarks(marks, at, next));
        at = next;
      }
      assert.deepEqual(seen, marks);
    }), { numRuns: 100 });
  });

  test('interval bells: inside the session only (start and end have their own bell)', () => {
    assert.deepEqual(intervalMarks(10 * MINUTE_MS, 5).map((m) => m.atMs), [5 * MINUTE_MS]);
    assert.equal(intervalMarks(5 * MINUTE_MS, 1).length, 4);
    assert.deepEqual(intervalMarks(10 * MINUTE_MS, 0), []);
    assert.ok(intervalMarks(30 * MINUTE_MS, 5).every((m) => m.kind === 'bell' && m.atMs > 0 && m.atMs < 30 * MINUTE_MS));
  });

  test('breathing circle: grows for 4 s, shrinks for 6 s, then again', () => {
    assert.equal(breathPhase(0).phase, 'in');
    assert.ok(Math.abs(breathPhase(0).scale - 0.6) < 1e-9);
    assert.equal(breathPhase(BREATH_IN_MS - 1).phase, 'in');
    assert.equal(breathPhase(BREATH_IN_MS).phase, 'out');
    assert.ok(Math.abs(breathPhase(BREATH_IN_MS).scale - 1) < 1e-9);
    assert.deepEqual(breathPhase(BREATH_CYCLE_MS + 1000), breathPhase(1000));
  });

  test('property: the circle size is always between 0.6 and 1 (100 runs)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 3 * 60 * MINUTE_MS }), (ms) => {
      const { scale } = breathPhase(ms);
      return scale >= 0.6 - 1e-9 && scale <= 1 + 1e-9;
    }), { numRuns: 100 });
  });

  test('guidance: settle, breathe with the circle, calm phrases, gentle ending', () => {
    for (const minutes of MEDITATION_MINUTES) {
      const duration = minutes * MINUTE_MS;
      const marks = guidanceMarks(duration);
      assert.equal(marks[0].key, 'calmTime.g.settle');
      assert.equal(marks[marks.length - 1].key, 'calmTime.g.ending');
      assert.equal(marks[marks.length - 1].atMs, duration - 30_000);
      assert.ok(marks.every((m) => m.kind === 'say' && m.atMs > 0 && m.atMs < duration && GUIDANCE_KEYS.includes(m.key)));
      // in time order, at least 4 seconds apart (a short phrase never talks over another)
      for (let i = 1; i < marks.length; i++) assert.ok(marks[i].atMs - marks[i - 1].atMs >= 4000, `${minutes} min #${i}`);
      // "breathe in" matches the circle starting to grow
      for (const m of marks.filter((x) => x.key === 'calmTime.g.breatheIn')) assert.equal(m.atMs % BREATH_CYCLE_MS, 0);
      for (const m of marks.filter((x) => x.key === 'calmTime.g.breatheOut')) assert.equal(breathPhase(m.atMs).phase, 'out');
    }
    // more calm phrases in a longer meditation
    assert.ok(guidanceMarks(30 * MINUTE_MS).length > guidanceMarks(5 * MINUTE_MS).length);
  });

  test('activity: halfway, 5 minutes left (end has its own message)', () => {
    assert.deepEqual(activityMarks(30 * MINUTE_MS).map((m) => [m.atMs / MINUTE_MS, m.key]), [[15, 'calmTime.halfway'], [25, 'calmTime.fiveLeft']]);
    assert.deepEqual(activityMarks(15 * MINUTE_MS).map((m) => m.key), ['calmTime.halfway', 'calmTime.fiveLeft']);
    // 10 minutes: halfway and "5 left" are the same moment: said once
    assert.deepEqual(activityMarks(10 * MINUTE_MS).map((m) => m.key), ['calmTime.halfway']);
    assert.deepEqual(activityMarks(3 * MINUTE_MS).map((m) => m.key), ['calmTime.halfway']);
    assert.deepEqual(activityMarks(MINUTE_MS), []);
  });

  test('marks passed at once (a hidden tab): one bell at most and only the latest words', () => {
    assert.deepEqual(marksToPlay([]), { bell: false, sayKey: null });
    assert.deepEqual(
      marksToPlay([{ kind: 'bell' }, { kind: 'say', key: 'a' }, { kind: 'bell' }, { kind: 'say', key: 'b' }]),
      { bell: true, sayKey: 'b' }
    );
  });
});

// ---------- Days ----------

describe('days', () => {
  test('day keys, adding days across months and years, weekdays', () => {
    assert.equal(dayKey(new Date(2026, 9, 31, 23, 59)), '2026-10-31');
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2028-03-01', -1), '2028-02-29');
    assert.equal(weekdayOf('2026-10-31'), 6); // a Saturday
    assert.equal(isDayKey('2026-02-30'), false);
    assert.equal(isDayKey('2026-2-3'), false);
    assert.equal(isDayKey('2026-02-28'), true);
  });

  test('property: adding n days then -n days gives the same day (100 runs)', () => {
    fc.assert(fc.property(fc.date({ min: new Date(2000, 0, 1), max: new Date(2090, 0, 1), noInvalidDate: true }), fc.integer({ min: -800, max: 800 }), (date, n) => {
      const key = dayKey(date);
      return addDays(addDays(key, n), -n) === key && isDayKey(addDays(key, n));
    }), { numRuns: 100 });
  });
});

// ---------- Routine ----------

const MON = '2026-10-26'; // a Monday
const walk = { activity: 'walking', time: '07:30', minutes: 30, days: [...ALL_DAYS] };
const read = { activity: 'reading', time: '21:00', minutes: '15', days: [1, 3, 5] }; // Mon Wed Fri

describe('daily routine', () => {
  test('checks what the user typed', () => {
    assert.equal(itemProblem(walk), null);
    assert.equal(itemProblem({ ...walk, activity: 'flying' }), 'calmTime.needActivity');
    assert.equal(itemProblem({ ...walk, activity: 'custom', name: '  ' }), 'calmTime.needName');
    assert.equal(itemProblem({ ...walk, activity: 'custom', name: 'Yoga' }), null);
    assert.equal(itemProblem({ ...walk, time: '25:00' }), 'calmTime.needTime');
    assert.equal(itemProblem({ ...walk, minutes: 0 }), 'calmTime.needMinutes');
    assert.equal(itemProblem({ ...walk, days: [] }), 'calmTime.needDay');
    assert.equal(cleanTime('7:05'), '07:05');
    assert.deepEqual(cleanDays([3, '1', 3, 9]), [1, 3]);
  });

  test('today’s list: only the planned days, sorted by time', () => {
    let routine = addItem(emptyRoutine(), read, MON, 'r');
    routine = addItem(routine, walk, MON, 'w');
    assert.deepEqual(plannedOn(routine, MON).map((i) => i.id), ['w', 'r']);
    assert.deepEqual(plannedOn(routine, addDays(MON, 1)).map((i) => i.id), ['w']); // Tuesday: no reading
    assert.deepEqual(plannedOn(routine, addDays(MON, -1)), []); // before they were added
    assert.deepEqual(addItem(routine, { ...walk, time: 'x' }, MON, 'bad'), routine); // invalid: nothing added
    assert.equal(addItem(routine, walk, MON, 'w').items.length, 2); // the same id is not added twice
  });

  test('ticking done, the day status and a completed day', () => {
    let routine = addItem(addItem(emptyRoutine(), walk, MON, 'w'), read, MON, 'r');
    assert.deepEqual(dayStatus(routine, MON), { total: 2, done: 0, complete: false });
    const before = routine;
    routine = setDone(routine, MON, 'w', true);
    assert.equal(isDone(routine, MON, 'w'), true);
    assert.equal(completedNow(before, routine, MON), false);
    const before2 = routine;
    routine = setDone(routine, MON, 'r', true);
    assert.deepEqual(dayStatus(routine, MON), { total: 2, done: 2, complete: true });
    assert.equal(completedNow(before2, routine, MON), true); // levelUp + giftBox now
    assert.equal(completedNow(routine, setDone(routine, MON, 'r', true), MON), false); // only once
    routine = setDone(routine, MON, 'r', false);
    assert.equal(dayStatus(routine, MON).complete, false);
    assert.equal(dayStatus(emptyRoutine(), MON).complete, false); // nothing planned is not "complete"
  });

  test('7-day history, oldest first, ending today', () => {
    let routine = addItem(emptyRoutine(), walk, addDays(MON, -3), 'w');
    routine = setDone(routine, addDays(MON, -3), 'w', true);
    routine = setDone(routine, addDays(MON, -1), 'w', true);
    const days = history(routine, MON);
    assert.equal(days.length, 7);
    assert.equal(days[6].key, MON);
    assert.equal(days[0].key, addDays(MON, -6));
    assert.deepEqual(days.map((d) => d.total), [0, 0, 0, 1, 1, 1, 1]);
    assert.deepEqual(days.map((d) => d.complete), [false, false, false, true, false, true, false]);
  });

  test('streak: today counts once complete; a missed day breaks it; free days are skipped', () => {
    const start = addDays(MON, -10);
    let routine = addItem(emptyRoutine(), walk, start, 'w');
    for (let i = 1; i <= 4; i++) routine = setDone(routine, addDays(MON, -i), 'w', true);
    assert.equal(streak(routine, MON), 4); // today not done yet: counted from yesterday
    routine = setDone(routine, MON, 'w', true);
    assert.equal(streak(routine, MON), 5); // 5 days ago was missed: the run is today + 4 days
    routine = setDone(routine, addDays(MON, -2), 'w', false);
    assert.equal(streak(routine, MON), 2); // a missed day breaks it: today and yesterday
    // reading only Mon/Wed/Fri: the days between do not break the streak
    let r2 = addItem(emptyRoutine(), read, addDays(MON, -7), 'r'); // from the Monday before
    for (const key of [addDays(MON, -7), addDays(MON, -5), addDays(MON, -3)]) r2 = setDone(r2, key, 'r', true);
    assert.equal(streak(r2, MON), 3);
    assert.equal(streak(emptyRoutine(), MON), 0);
  });

  test('removing: gone from today on, kept in the history before', () => {
    let routine = addItem(emptyRoutine(), walk, addDays(MON, -2), 'w');
    routine = setDone(routine, addDays(MON, -1), 'w', true);
    routine = removeItem(routine, 'w', MON);
    assert.deepEqual(plannedOn(routine, MON), []);
    assert.equal(dayStatus(routine, addDays(MON, -1)).complete, true);
    // added today and removed today: gone completely
    const r2 = removeItem(setDone(addItem(emptyRoutine(), walk, MON, 'x'), MON, 'x', true), 'x', MON);
    assert.deepEqual(r2, emptyRoutine());
  });

  test('saved and loaded; broken or blocked storage never throws', () => {
    const storage = memoryStorage();
    const routine = setDone(addItem(emptyRoutine(), { ...walk, activity: 'custom', name: ' Yoga ' }, MON, 'y'), MON, 'y', true);
    assert.equal(saveRoutine(storage, routine), true);
    const loaded = loadRoutine(storage);
    assert.deepEqual(loaded, routine);
    assert.equal(loaded.items[0].name, 'Yoga');
    assert.deepEqual(loadRoutine(blockedStorage), emptyRoutine());
    assert.equal(saveRoutine(blockedStorage, routine), false);
    storage.setItem(ROUTINE_KEY, '{oops');
    assert.deepEqual(loadRoutine(storage), emptyRoutine());
  });

  test('property: cleanRoutine turns anything into a valid routine (100 runs)', () => {
    fc.assert(fc.property(fc.anything(), (value) => {
      const r = cleanRoutine(value);
      return Array.isArray(r.items) && r.items.every((i) => ACTIVITIES.includes(i.activity) && i.days.length > 0)
        && Object.keys(r.done).every(isDayKey);
    }), { numRuns: 100 });
  });

  test('old ticks are forgotten after 120 days', () => {
    let routine = addItem(emptyRoutine(), walk, '2026-01-01', 'w');
    routine = setDone(routine, '2026-01-01', 'w', true);
    routine = setDone(routine, '2026-10-01', 'w', true);
    assert.deepEqual(Object.keys(routine.done), ['2026-10-01']);
  });
});

// ---------- Reminders ----------

describe('reminders', () => {
  test('due while the page is open: time passed since the last look, not done yet', () => {
    let routine = addItem(addItem(emptyRoutine(), walk, MON, 'w'), read, MON, 'r');
    const at730 = timeOnDay(MON, '07:30');
    assert.deepEqual(dueReminders(routine, at730 - 20_000, at730).map((i) => i.id), ['w']);
    assert.deepEqual(dueReminders(routine, at730, at730 + 20_000), []); // already reminded
    assert.deepEqual(dueReminders(routine, at730 - 3 * 60 * MINUTE_MS, at730 - MINUTE_MS), []);
    routine = setDone(routine, MON, 'w', true);
    assert.deepEqual(dueReminders(routine, at730 - 20_000, at730), []); // done already: no reminder
    const at9pm = timeOnDay(MON, '21:00');
    assert.deepEqual(dueReminders(routine, at9pm - 20_000, at9pm + 1).map((i) => i.id), ['r']);
  });
});

// ---------- Calendar file ----------

describe('the .ics calendar file', () => {
  const now = Date.UTC(2026, 9, 26, 6, 0, 0);

  test('a daily event at the chosen local time, with an alert', () => {
    const ics = buildIcs({ uid: 'w@calm', title: 'Walking', description: 'Time for walking (30 min).', time: '07:30', minutes: 30, days: ALL_DAYS, todayKey: MON, nowMs: now });
    const lines = ics.split('\r\n');
    assert.equal(lines[0], 'BEGIN:VCALENDAR');
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.ok(lines.includes('DTSTART:20261026T073000')); // no Z, no time zone: the phone's local time
    assert.ok(lines.includes('RRULE:FREQ=DAILY'));
    assert.ok(lines.includes('DURATION:PT30M'));
    assert.ok(lines.includes('DTSTAMP:20261026T060000Z'));
    assert.ok(lines.includes('BEGIN:VALARM') && lines.includes('TRIGGER:PT0M'));
    assert.ok(lines.includes('SUMMARY:Walking'));
    assert.ok(!/[^\r]\n/.test(ics)); // only CRLF line ends
  });

  test('some days only: weekly on those days, starting on the first of them', () => {
    const ics = buildIcs({ uid: 'r', title: 'Reading', time: '21:00', minutes: 15, days: [3, 5], todayKey: MON, nowMs: now });
    assert.ok(ics.includes('RRULE:FREQ=WEEKLY;BYDAY=WE,FR'));
    assert.ok(ics.includes('DTSTART:20261028T210000')); // Wednesday
    assert.equal(firstPlannedDay([1], MON), MON);
    assert.equal(firstPlannedDay([0], MON), addDays(MON, 6));
  });

  test('text is escaped, and long Tamil lines are folded without splitting a letter', () => {
    assert.equal(icsEscape('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
    const title = 'நடைப்பயிற்சி '.repeat(8);
    const ics = buildIcs({ uid: 'u', title, time: '07:00', minutes: 20, days: ALL_DAYS, todayKey: MON, nowMs: now });
    for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75, line);
    // unfolding gives back the original line
    const unfolded = ics.replace(/\r\n /g, '');
    assert.ok(unfolded.includes(`SUMMARY:${title}`));
  });

  test('property: folding never loses text and keeps every line within 75 bytes (100 runs)', () => {
    fc.assert(fc.property(fc.string({ unit: 'grapheme', maxLength: 200 }), (text) => {
      const folded = foldIcsLine(`SUMMARY:${text}`);
      return folded.replace(/\r\n /g, '') === `SUMMARY:${text}`
        && folded.split('\r\n').every((line) => Buffer.byteLength(line, 'utf8') <= 75);
    }), { numRuns: 100 });
  });

  test('a simple ASCII file name', () => {
    assert.equal(icsFilename('07:30'), 'calm-reminder-0730.ics');
    assert.equal(icsFilename('bad'), 'calm-reminder-daily.ics');
  });
});

// ---------- Strings and safety ----------

describe('Calm Ghost strings in all 20 languages', () => {
  test('every guidance phrase and activity name exists in every locale', () => {
    const keys = [...GUIDANCE_KEYS, ...ACTIVITIES.map((a) => `calmTime.act.${a}`), 'calmTime.halfway', 'calmTime.fiveLeft', 'nav.calmTime', 'home.calmTime'];
    for (const code of LOCALES) {
      for (const key of keys) {
        assert.equal(typeof STRINGS[code][key], 'string', `${code} ${key}`);
        assert.ok(STRINGS[code][key].trim() !== '', `${code} ${key}`);
      }
    }
  });

  test('the guidance is really translated (not English) outside English', () => {
    for (const code of LOCALES.filter((c) => c !== 'en')) {
      assert.notEqual(STRINGS[code]['calmTime.g.shoulders'], STRINGS.en['calmTime.g.shoulders'], code);
    }
  });

  test('the welcome text names the new app in every language', () => {
    for (const code of LOCALES) {
      assert.ok(STRINGS[code]['home.welcomeText'].includes(STRINGS[code]['home.calmTime']), code);
    }
  });

  test('the app makes no network calls and never uses the AI', () => {
    const code = readFileSync(new URL('../../apps/calm-time/app.js', import.meta.url), 'utf8');
    assert.ok(!/\bfetch\s*\(/.test(code));
    assert.ok(!/api-client/.test(code));
  });
});
