// calm-utils.js
// Pure rules of Calm Ghost: the timer (made of timestamps, so it stays right when the tab is
// hidden), the bells and spoken words during a session, the breathing circle, the daily routine
// with its history and streak, the calendar file (.ics) for reminders, and which reminders are due.
// No DOM, no network: storage and the current time are passed in.

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
// A timer is { durationMs, startedAt, pausedAt, pausedMs }. Time is never counted tick by tick:
// it is always worked out from Date.now(), so a hidden tab (where the browser slows timers down)
// still shows the right time as soon as it is looked at again.

export const MINUTE_MS = 60 * 1000;

/** A new timer that started at `now` (milliseconds, like Date.now()). */
export function startTimer(durationMs, now) {
  return { durationMs: Math.max(0, Number(durationMs) || 0), startedAt: now, pausedAt: null, pausedMs: 0 };
}

/** How long the timer has run, without the pauses (0 to durationMs). */
export function elapsedMs(timer, now) {
  const end = timer.pausedAt ?? now;
  const ran = end - timer.startedAt - timer.pausedMs;
  return Math.min(timer.durationMs, Math.max(0, ran));
}

/** How long is left (durationMs to 0). */
export function remainingMs(timer, now) {
  return timer.durationMs - elapsedMs(timer, now);
}

/** True when the time is up. */
export function isFinished(timer, now) {
  return remainingMs(timer, now) <= 0;
}

/** True while paused. */
export function isPaused(timer) {
  return timer.pausedAt !== null;
}

/** The timer paused at `now` (pausing twice changes nothing). */
export function pauseTimer(timer, now) {
  if (isPaused(timer)) return timer;
  return { ...timer, pausedAt: now };
}

/** The timer going on at `now`; the paused time does not count. */
export function resumeTimer(timer, now) {
  if (!isPaused(timer)) return timer;
  return { ...timer, pausedAt: null, pausedMs: timer.pausedMs + Math.max(0, now - timer.pausedAt) };
}

/** The part of the time that is left, from 1 (start) to 0 (end). */
export function fractionLeft(timer, now) {
  if (timer.durationMs <= 0) return 0;
  return remainingMs(timer, now) / timer.durationMs;
}

/** "05:00", "00:59" or "1:00:00" (whole seconds, rounded up so 0:00 means really finished). */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/** Minutes typed by the user: a whole number from 1 to 240, or null. */
export function clampMinutes(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= 240 ? n : null;
}

// ---------------------------------------------------------------------------
// Things that happen at a moment of the session: bells and spoken words
// ---------------------------------------------------------------------------
// A mark is { atMs, kind: 'bell' | 'say', key? } (atMs = time since the start, pauses not counted).

export const MEDITATION_MINUTES = Object.freeze([5, 10, 20, 30]);
export const ACTIVITY_MINUTES = Object.freeze([15, 30, 45, 60]);
export const INTERVAL_CHOICES = Object.freeze([0, 1, 5]); // 0 = no bell during the meditation

/** The marks passed when the session went from `fromMs` to `toMs` (fromMs < atMs <= toMs). */
export function crossedMarks(marks, fromMs, toMs) {
  return marks.filter((mark) => mark.atMs > fromMs && mark.atMs <= toMs);
}

/** A soft bell every `everyMinutes` (not at the start or at the end: those have their own bell). */
export function intervalMarks(durationMs, everyMinutes) {
  const every = Number(everyMinutes) * MINUTE_MS;
  const marks = [];
  if (!(every > 0)) return marks;
  for (let at = every; at < durationMs; at += every) marks.push({ atMs: at, kind: 'bell' });
  return marks;
}

// The breathing circle: 4 seconds in, 6 seconds out.
export const BREATH_IN_MS = 4000;
export const BREATH_OUT_MS = 6000;
export const BREATH_CYCLE_MS = BREATH_IN_MS + BREATH_OUT_MS;

/**
 * Where the breath is: { phase: 'in' | 'out', scale } with scale from 0.6 (empty) to 1 (full).
 * Worked out from the elapsed time, so it pauses and goes on with the timer.
 */
export function breathPhase(elapsed) {
  const x = ((Number(elapsed) || 0) % BREATH_CYCLE_MS + BREATH_CYCLE_MS) % BREATH_CYCLE_MS;
  const ease = (f) => (1 - Math.cos(Math.PI * f)) / 2; // soft start and end
  if (x < BREATH_IN_MS) return { phase: 'in', scale: 0.6 + 0.4 * ease(x / BREATH_IN_MS) };
  return { phase: 'out', scale: 1 - 0.4 * ease((x - BREATH_IN_MS) / BREATH_OUT_MS) };
}

// The calm words, said one at a time, in this order, again and again.
export const CALM_PHRASES = Object.freeze([
  'calmTime.g.shoulders',
  'calmTime.g.face',
  'calmTime.g.breath',
  'calmTime.g.thoughts',
  'calmTime.g.body',
  'calmTime.g.kind',
]);
export const GUIDANCE_KEYS = Object.freeze([
  'calmTime.g.settle',
  'calmTime.g.breatheIn',
  'calmTime.g.breatheOut',
  ...CALM_PHRASES,
  'calmTime.g.ending',
]);
const PHRASE_EVERY_MS = 90 * 1000;

/**
 * The spoken guidance of a meditation: settle in, breathe with the circle during the first
 * minute, a calm phrase every 90 seconds, and a gentle ending 30 seconds before the end.
 */
export function guidanceMarks(durationMs) {
  const marks = [{ atMs: 2000, kind: 'say', key: 'calmTime.g.settle' }];
  for (let cycle = 1; cycle <= 4; cycle++) {
    const start = cycle * BREATH_CYCLE_MS; // the circle starts to grow
    marks.push({ atMs: start, kind: 'say', key: 'calmTime.g.breatheIn' });
    marks.push({ atMs: start + BREATH_IN_MS, kind: 'say', key: 'calmTime.g.breatheOut' });
  }
  const ending = durationMs >= 2 * MINUTE_MS ? durationMs - 30 * 1000 : null;
  let n = 0;
  for (let at = MINUTE_MS; at < durationMs; at += PHRASE_EVERY_MS) {
    if (ending !== null && at > ending - 20 * 1000) break; // keep room before the ending
    marks.push({ atMs: at, kind: 'say', key: CALM_PHRASES[n % CALM_PHRASES.length] });
    n += 1;
  }
  if (ending !== null) marks.push({ atMs: ending, kind: 'say', key: 'calmTime.g.ending' });
  return marks.filter((mark) => mark.atMs < durationMs).sort((a, b) => a.atMs - b.atMs);
}

/**
 * The spoken encouragement of an activity: at halfway and when 5 minutes are left. When the two
 * would come less than a minute apart (a 10 minute walk), only "halfway" is said.
 */
export function activityMarks(durationMs) {
  const marks = [];
  const half = durationMs / 2;
  if (durationMs >= 2 * MINUTE_MS) marks.push({ atMs: half, kind: 'say', key: 'calmTime.halfway' });
  const fiveLeft = durationMs - 5 * MINUTE_MS;
  if (fiveLeft > 0 && Math.abs(fiveLeft - half) >= MINUTE_MS) {
    marks.push({ atMs: fiveLeft, kind: 'say', key: 'calmTime.fiveLeft' });
  }
  return marks.sort((a, b) => a.atMs - b.atMs);
}

/**
 * Of the marks passed at once (the tab was hidden for a while), what to do now: at most one bell
 * and only the latest words, never a burst of sounds.
 */
export function marksToPlay(crossed) {
  const bell = crossed.some((mark) => mark.kind === 'bell');
  const said = crossed.filter((mark) => mark.kind === 'say');
  return { bell, sayKey: said.length > 0 ? said[said.length - 1].key : null };
}

// A soft singing-bowl bell made of a few sine tones that fade slowly (Web Audio, in app.js).
// freq in Hz, volume 0..1, seconds = how long it rings.
export const BELL_TONES = Object.freeze([
  { freq: 528, volume: 0.22, seconds: 6 },
  { freq: 1056, volume: 0.08, seconds: 4 },
  { freq: 1584, volume: 0.04, seconds: 2.5 },
]);

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const two = (n) => String(n).padStart(2, '0');

/** "2026-10-31" for a Date, in the user's own time zone. */
export function dayKey(date) {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** True for a real day such as "2026-10-31". */
export function isDayKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return dayKey(dateOf(key)) === key;
}

/** The Date at noon of a day key (noon: never on the wrong day when clocks change). */
export function dateOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** The day `n` days after (or before, n < 0) the day `key`. */
export function addDays(key, n) {
  const date = dateOf(key);
  date.setDate(date.getDate() + n);
  return dayKey(date);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key) {
  return dateOf(key).getDay();
}

// ---------------------------------------------------------------------------
// Daily routine
// ---------------------------------------------------------------------------
// { items: [{ id, activity, name, time: "07:30", minutes, days: [0..6], from: dayKey, until }],
//   done: { dayKey: [item ids] } }
// An item is planned on the days of the week in `days`, from the day it was added (`from`) until
// the day it was removed (`until`, not included). Removed items stay, so the history stays true.

export const ROUTINE_KEY = 'phantomVoiceKit.calmTime.routine';
export const ACTIVITIES = Object.freeze(['meditation', 'walking', 'running', 'exercise', 'reading', 'custom']);
export const ALL_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6]);
const KEEP_DONE_DAYS = 120; // ticks older than this are forgotten
const MAX_NAME = 60;

export function emptyRoutine() {
  return { items: [], done: {} };
}

/** "07:30" for a valid 24-hour time, else null. */
export function cleanTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return `${two(h)}:${two(m)}`;
}

/** Days of the week: unique, 0 to 6, in order. */
export function cleanDays(value) {
  if (!Array.isArray(value)) return [];
  return ALL_DAYS.filter((day) => value.some((v) => Number(v) === day));
}

function cleanItem(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.id !== 'string' || value.id === '') return null;
  if (!ACTIVITIES.includes(value.activity)) return null;
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, MAX_NAME) : '';
  if (value.activity === 'custom' && name === '') return null;
  const time = cleanTime(value.time);
  const minutes = clampMinutes(value.minutes);
  const days = cleanDays(value.days);
  if (!time || !minutes || days.length === 0 || !isDayKey(value.from)) return null;
  const until = isDayKey(value.until) ? value.until : '';
  return { id: value.id, activity: value.activity, name, time, minutes, days, from: value.from, until };
}

/** Make any stored value into a clean routine (bad parts are dropped). */
export function cleanRoutine(value) {
  const routine = emptyRoutine();
  if (!value || typeof value !== 'object') return routine;
  if (Array.isArray(value.items)) {
    const seen = new Set();
    for (const raw of value.items) {
      const item = cleanItem(raw);
      if (item && !seen.has(item.id)) {
        seen.add(item.id);
        routine.items.push(item);
      }
    }
  }
  if (value.done && typeof value.done === 'object') {
    for (const [key, ids] of Object.entries(value.done)) {
      if (!isDayKey(key) || !Array.isArray(ids)) continue;
      const clean = [...new Set(ids.filter((id) => typeof id === 'string' && id !== ''))];
      if (clean.length > 0) routine.done[key] = clean;
    }
  }
  return routine;
}

export function loadRoutine(storage) {
  try {
    const text = storage?.getItem(ROUTINE_KEY);
    return text ? cleanRoutine(JSON.parse(text)) : emptyRoutine();
  } catch {
    return emptyRoutine();
  }
}

export function saveRoutine(storage, routine) {
  try {
    storage?.setItem(ROUTINE_KEY, JSON.stringify(cleanRoutine(routine)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check what the user typed for a new item. Returns the translation key of the problem, or null.
 * @param {{activity:string, name?:string, time:string, minutes:any, days:number[]}} input
 */
export function itemProblem(input) {
  if (!ACTIVITIES.includes(input?.activity)) return 'calmTime.needActivity';
  if (input.activity === 'custom' && String(input.name ?? '').trim() === '') return 'calmTime.needName';
  if (!cleanTime(input.time)) return 'calmTime.needTime';
  if (!clampMinutes(input.minutes)) return 'calmTime.needMinutes';
  if (cleanDays(input.days).length === 0) return 'calmTime.needDay';
  return null;
}

/** A new routine with the item added (from `todayKey`). Returns the same routine when invalid. */
export function addItem(routine, input, todayKey, id) {
  const clean = cleanRoutine(routine);
  if (itemProblem(input) !== null) return clean;
  const item = cleanItem({
    id,
    activity: input.activity,
    name: input.activity === 'custom' ? input.name : '',
    time: input.time,
    minutes: input.minutes,
    days: input.days,
    from: todayKey,
    until: '',
  });
  if (!item || clean.items.some((other) => other.id === id)) return clean;
  return { ...clean, items: [...clean.items, item] };
}

/**
 * A new routine without the item from today on. An item added today is removed completely;
 * an older one is kept for the history of the days before.
 */
export function removeItem(routine, id, todayKey) {
  const clean = cleanRoutine(routine);
  const items = [];
  for (const item of clean.items) {
    if (item.id !== id) items.push(item);
    else if (item.from < todayKey) items.push({ ...item, until: todayKey });
  }
  const done = { ...clean.done };
  if (done[todayKey]) {
    done[todayKey] = done[todayKey].filter((other) => other !== id);
    if (done[todayKey].length === 0) delete done[todayKey];
  }
  return { items, done };
}

/** The items planned on a day, sorted by time. */
export function plannedOn(routine, key) {
  const weekday = weekdayOf(key);
  return routine.items
    .filter((item) => item.from <= key && (item.until === '' || key < item.until) && item.days.includes(weekday))
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
}

export function isDone(routine, key, id) {
  return (routine.done[key] ?? []).includes(id);
}

/** A new routine with the item ticked (or not) on that day. Old ticks are forgotten. */
export function setDone(routine, key, id, done) {
  const clean = cleanRoutine(routine);
  const ids = new Set(clean.done[key] ?? []);
  if (done) ids.add(id);
  else ids.delete(id);
  const result = {};
  const oldest = addDays(key, -KEEP_DONE_DAYS);
  for (const [day, list] of Object.entries(clean.done)) if (day >= oldest && day !== key) result[day] = list;
  if (ids.size > 0) result[key] = [...ids];
  return { ...clean, done: result };
}

/** How a day went: { total, done, complete } (complete = something planned and all of it done). */
export function dayStatus(routine, key) {
  const planned = plannedOn(routine, key);
  const done = planned.filter((item) => isDone(routine, key, item.id)).length;
  return { total: planned.length, done, complete: planned.length > 0 && done === planned.length };
}

/** The last `days` days, oldest first, ending with today: [{ key, total, done, complete }]. */
export function history(routine, todayKey, days = 7) {
  const list = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = addDays(todayKey, -i);
    list.push({ key, ...dayStatus(routine, key) });
  }
  return list;
}

/**
 * Days in a row with everything done, counted back from today. Today counts once it is complete;
 * while today is still going on, the count starts from yesterday. Days with nothing planned are
 * skipped (they neither count nor break the streak).
 */
export function streak(routine, todayKey) {
  if (routine.items.length === 0) return 0;
  const first = routine.items.reduce((min, item) => (item.from < min ? item.from : min), todayKey);
  let key = dayStatus(routine, todayKey).complete ? todayKey : addDays(todayKey, -1);
  let count = 0;
  while (key >= first) {
    const status = dayStatus(routine, key);
    if (status.total > 0) {
      if (!status.complete) break;
      count += 1;
    }
    key = addDays(key, -1);
  }
  return count;
}

/** True when this tick made the whole day done (it was not complete before). */
export function completedNow(before, after, key) {
  return !dayStatus(before, key).complete && dayStatus(after, key).complete;
}

// ---------------------------------------------------------------------------
// Reminders while the page is open
// ---------------------------------------------------------------------------

/** The moment (ms) of "07:30" on the day of `key`, in the user's time zone. */
export function timeOnDay(key, time) {
  const [h, m] = cleanTime(time).split(':').map(Number);
  const date = dateOf(key);
  date.setHours(h, m, 0, 0);
  return date.getTime();
}

/** Today's items, not done yet, whose time came after `fromMs` and up to `toMs`. */
export function dueReminders(routine, fromMs, toMs) {
  const key = dayKey(new Date(toMs));
  return plannedOn(routine, key).filter((item) => {
    if (isDone(routine, key, item.id)) return false;
    const at = timeOnDay(key, item.time);
    return at > fromMs && at <= toMs;
  });
}

// ---------------------------------------------------------------------------
// Calendar file (.ics) for a daily reminder in the phone's calendar
// ---------------------------------------------------------------------------

const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** Text made safe for an .ics value: backslash, ; , and new lines are escaped. */
export function icsEscape(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// Bytes of one character in UTF-8.
function utf8Bytes(char) {
  const cp = char.codePointAt(0);
  return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
}

/**
 * Long lines folded as the calendar standard asks: at most 75 bytes per line, the next part on a
 * new line that starts with one space. Never splits a character (Tamil letters are 3 bytes).
 */
export function foldIcsLine(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = utf8Bytes(char);
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // the leading space of the next line counts too
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function icsUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}T${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`;
}

/** The first day from `todayKey` on which the item is planned. */
export function firstPlannedDay(days, todayKey) {
  const list = cleanDays(days);
  for (let i = 0; i < 7; i++) {
    const key = addDays(todayKey, i);
    if (list.includes(weekdayOf(key))) return key;
  }
  return todayKey;
}

/**
 * A calendar file with one repeating event and an alert at its time.
 * Every day: FREQ=DAILY; only some days: FREQ=WEEKLY;BYDAY=MO,WE. The time has no time zone, so
 * the calendar uses the phone's own local time ("07:30" stays 07:30).
 * @param {{uid:string, title:string, description?:string, time:string, minutes:number, days:number[], todayKey:string, nowMs:number}} event
 */
export function buildIcs({ uid, title, description = '', time, minutes, days, todayKey, nowMs }) {
  const list = cleanDays(days).length > 0 ? cleanDays(days) : [...ALL_DAYS];
  const clock = cleanTime(time) ?? '07:00';
  const start = firstPlannedDay(list, todayKey).replace(/-/g, '') + 'T' + clock.replace(':', '') + '00';
  const rule = list.length === 7 ? 'RRULE:FREQ=DAILY' : `RRULE:FREQ=WEEKLY;BYDAY=${list.map((d) => ICS_DAYS[d]).join(',')}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Phantom Voice Kit//Calm Ghost//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${icsUtc(nowMs)}`,
    `DTSTART:${start}`,
    `DURATION:PT${clampMinutes(minutes) ?? 15}M`,
    rule,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(title)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}

/** "calm-reminder-0730.ics": ASCII only, safe on every phone. */
export function icsFilename(time) {
  const clean = cleanTime(time);
  return `calm-reminder-${clean ? clean.replace(':', '') : 'daily'}.ics`;
}
