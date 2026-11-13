// Calm Ghost (apps/calm-time): meditation with a soft bell, a breathing circle and optional calm
// words; an activity timer with spoken encouragement; and a daily routine with ticks, a 7-day
// history, a streak and reminders (a calendar file for the phone, plus in-page reminders while
// the page is open). Everything is kept on this device (localStorage). No Gemini calls.
//
// The timer is made of timestamps (calm-utils.js), never of counted ticks: when the tab is hidden
// the browser slows the ticks down, but the time shown is always right.

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { createNavMenu } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n } from '/skeleton/i18n.js';
import { correct, levelUp, giftBox, isMuted } from '/skeleton/celebrate.js';
import { showInlineConfirm } from '/skeleton/inline-confirm.js';
import {
  MINUTE_MS,
  startTimer,
  elapsedMs,
  remainingMs,
  isFinished,
  isPaused,
  pauseTimer,
  resumeTimer,
  fractionLeft,
  formatClock,
  clampMinutes,
  MEDITATION_MINUTES,
  ACTIVITY_MINUTES,
  INTERVAL_CHOICES,
  crossedMarks,
  intervalMarks,
  breathPhase,
  guidanceMarks,
  activityMarks,
  marksToPlay,
  BELL_TONES,
  dayKey,
  addDays,
  weekdayOf,
  dateOf,
  ACTIVITIES,
  loadRoutine,
  saveRoutine,
  itemProblem,
  addItem,
  removeItem,
  plannedOn,
  isDone,
  setDone,
  dayStatus,
  history as routineHistory,
  streak,
  completedNow,
  dueReminders,
  buildIcs,
  icsFilename,
} from '/apps/calm-time/calm-utils.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

const TICK_MS = 250; // how often the screen is updated (the time itself comes from Date.now())
const REMINDER_CHECK_MS = 15 * 1000;
const RING_LENGTH = 2 * Math.PI * 90; // the circle in index.html has r = 90
const TIMER_KINDS = ['walking', 'running', 'exercise', 'reading', 'custom']; // activity timer choices
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first in the day picker

const $ = (id) => document.getElementById(id);
const screens = {
  start: $('screen-start'),
  meditate: $('screen-meditate'),
  activity: $('screen-activity'),
  session: $('screen-session'),
  routine: $('screen-routine'),
};
const el = {
  summary: $('start-summary'),
  medMinutes: $('med-minutes'),
  medInterval: $('med-interval'),
  medGuidance: $('med-guidance'),
  actKinds: $('act-kinds'),
  actNameRow: $('act-name-row'),
  actName: $('act-name'),
  actMinutes: $('act-minutes'),
  actCustomRow: $('act-custom-row'),
  actCustomMinutes: $('act-custom-minutes'),
  actProblem: $('act-problem'),
  sessionTitle: $('session-title'),
  ring: $('ring'),
  breath: $('breath'),
  breathLabel: $('breath-label'),
  clock: $('clock'),
  sessionMessage: $('session-message'),
  sessionButtons: $('session-buttons'),
  pause: $('pause-button'),
  stop: $('stop-button'),
  done: $('done-button'),
  streak: $('streak'),
  today: $('today-list'),
  todayEmpty: $('today-empty'),
  history: $('history'),
  form: $('add-form'),
  addActivity: $('add-activity'),
  addNameRow: $('add-name-row'),
  addName: $('add-name'),
  addTime: $('add-time'),
  addMinutes: $('add-minutes'),
  addDays: $('add-days'),
  addProblem: $('add-problem'),
  notify: $('notify-button'),
  notifyStatus: $('notify-status'),
  confirm: $('routine-confirm'),
  reminder: $('reminder'),
  reminderText: $('reminder-text'),
  reminderStart: $('reminder-start'),
  reminderOk: $('reminder-ok'),
};

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const state = {
  language: getCurrentLanguage(),
  screen: 'start',
  medMinutes: 10,
  medInterval: 0,
  actKind: 'walking',
  actMinutes: 30, // a number, or 'custom'
  routine: loadRoutine(storage()),
  session: null, // the running (or just finished) session
  lastReminderCheck: Date.now(), // reminders only for times after the page was opened
  reminderItem: null,
};
let speechOutput = null;
let tickTimer = null;
let wakeLock = null;
let audioWarned = false;

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---------- Nav and language ----------

function handleBack() {
  if (state.screen === 'start') return false; // leave to Home
  if (state.screen === 'session') endSession();
  show('start');
  return true;
}

const nav = createNavMenu($('app-header'), { current: 'calm-time', onBack: handleBack, onLeave: endSession });
createLanguageDropdown(nav.languageEl, {
  onChange: (lang) => {
    state.language = lang;
    speechOutput?.stop();
    speechOutput = createSpeechOutput({ lang: lang.bcp47 });
    audioWarned = false;
    renderAll();
  },
});
state.language = getCurrentLanguage();
speechOutput = createSpeechOutput({ lang: state.language.bcp47 });

// ---------- Small helpers ----------

function show(name, moveFocus = true) {
  state.screen = name;
  for (const [key, section] of Object.entries(screens)) section.hidden = key !== name;
  if (name === 'start') renderSummary();
  if (name === 'routine') renderRoutine();
  const heading = screens[name].querySelector('h2, .calm-choice');
  if (heading && moveFocus) {
    if (heading.tagName === 'H2') heading.setAttribute('tabindex', '-1');
    heading.focus();
  }
}

function showMessage(target, key, params) {
  setI18nText(target, key, params);
  target.hidden = false;
}

function hideMessage(target) {
  clearI18n(target);
  target.hidden = true;
}

// The name of an activity: the translated word, or the user's own name for "something else".
function activityName(activity, customName = '') {
  return activity === 'custom' ? customName : t(`calmTime.act.${activity}`);
}

// "7:30 AM" or "07:30", the way the chosen language writes times.
function formatTime(time) {
  try {
    const [h, m] = time.split(':').map(Number);
    const date = new Date(2026, 0, 5, h, m);
    return new Intl.DateTimeFormat(state.language.bcp47, { hour: 'numeric', minute: '2-digit' }).format(date);
  } catch {
    return time;
  }
}

function weekdayName(day, style = 'short') {
  // 2026-01-04 is a Sunday: add `day` days to get that weekday.
  try {
    return new Intl.DateTimeFormat(state.language.bcp47, { weekday: style }).format(dateOf(addDays('2026-01-04', day)));
  } catch {
    return String(day);
  }
}

// Say a sentence. When this browser has no voice for the language, say so once on the screen.
function speak(text) {
  try {
    speechOutput.speak(text, {
      onError: (info) => {
        if (info && info.audioUnavailable && !audioWarned && state.screen === 'session') {
          audioWarned = true;
          showMessage(el.sessionMessage, 'calmTime.audioUnavailable');
        }
      },
    });
  } catch {
    // speaking is a help, never required
  }
}

// ---------- The bell (Web Audio, made on the device) ----------

let audioCtx = null;
function bell(times = 1) {
  if (isMuted()) return; // the sound on / off button in the header
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  try {
    if (!audioCtx) audioCtx = new Context();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    for (let k = 0; k < times; k++) {
      const start = audioCtx.currentTime + 0.05 + k * 1.8;
      for (const tone of BELL_TONES) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(tone.freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(tone.volume, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.seconds);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + tone.seconds + 0.1);
      }
    }
  } catch {
    // a bell is a bonus: never let it break the timer
  }
}

// ---------- Keep the screen awake (only where the Wake Lock API exists) ----------

async function keepAwake() {
  if (wakeLock || !('wakeLock' in navigator)) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    const s = state.session;
    if (!s || s.over) {
      lock.release(); // the session ended while the browser was still answering
      return;
    }
    wakeLock = lock;
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
  } catch {
    wakeLock = null; // not allowed (battery saver, hidden tab): the timer still works
  }
}

function letSleep() {
  try {
    wakeLock?.release();
  } catch {
    // already released
  }
  wakeLock = null;
}

// ---------- Choices (chips) ----------

function renderChips(container, values, selected, label, onPick) {
  container.textContent = '';
  for (const value of values) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calm-chip';
    button.textContent = label(value);
    button.setAttribute('aria-pressed', String(value === selected));
    button.addEventListener('click', () => onPick(value));
    container.appendChild(button);
  }
}

function renderMeditateSetup() {
  renderChips(el.medMinutes, MEDITATION_MINUTES, state.medMinutes, (n) => t('calmTime.minutes', { n }), (n) => {
    state.medMinutes = n;
    renderMeditateSetup();
  });
  renderChips(
    el.medInterval,
    INTERVAL_CHOICES,
    state.medInterval,
    (n) => (n === 0 ? t('calmTime.intervalOff') : t('calmTime.interval', { n })),
    (n) => {
      state.medInterval = n;
      renderMeditateSetup();
    }
  );
}

function renderActivitySetup() {
  renderChips(el.actKinds, TIMER_KINDS, state.actKind, (kind) => t(`calmTime.act.${kind}`), (kind) => {
    state.actKind = kind;
    renderActivitySetup();
    if (kind === 'custom') el.actName.focus();
  });
  renderChips(el.actMinutes, [...ACTIVITY_MINUTES, 'custom'], state.actMinutes, (n) => (n === 'custom' ? t('calmTime.customMinutes') : t('calmTime.minutes', { n })), (n) => {
    state.actMinutes = n;
    renderActivitySetup();
    if (n === 'custom') el.actCustomMinutes.focus();
  });
  el.actNameRow.hidden = state.actKind !== 'custom';
  el.actCustomRow.hidden = state.actMinutes !== 'custom';
}

$('go-meditate').addEventListener('click', () => show('meditate'));
$('go-activity').addEventListener('click', () => show('activity'));
$('go-routine').addEventListener('click', () => show('routine'));

$('med-start').addEventListener('click', () => {
  startSession({
    kind: 'meditation',
    minutes: state.medMinutes,
    name: t('calmTime.act.meditation'),
    intervalMinutes: state.medInterval,
    guidance: el.medGuidance.checked,
  });
});

$('act-start').addEventListener('click', () => {
  hideMessage(el.actProblem);
  const name = state.actKind === 'custom' ? el.actName.value.trim() : '';
  if (state.actKind === 'custom' && name === '') {
    showMessage(el.actProblem, 'calmTime.needName');
    el.actName.focus();
    return;
  }
  const minutes = state.actMinutes === 'custom' ? clampMinutes(el.actCustomMinutes.value) : state.actMinutes;
  if (!minutes) {
    showMessage(el.actProblem, 'calmTime.needMinutes');
    el.actCustomMinutes.focus();
    return;
  }
  startSession({ kind: 'activity', minutes, activity: state.actKind, name: activityName(state.actKind, name) });
});

// ---------- A session: meditation or activity ----------

/**
 * @param {{kind:'meditation'|'activity', minutes:number, name:string, activity?:string,
 *   intervalMinutes?:number, guidance?:boolean, itemId?:string}} options
 */
function startSession(options) {
  endSession();
  const durationMs = options.minutes * MINUTE_MS;
  const marks =
    options.kind === 'meditation'
      ? [...intervalMarks(durationMs, options.intervalMinutes ?? 0), ...(options.guidance ? guidanceMarks(durationMs) : [])].sort((a, b) => a.atMs - b.atMs)
      : activityMarks(durationMs);
  state.session = { ...options, marks, timer: startTimer(durationMs, Date.now()), lastElapsed: 0, over: false };
  audioWarned = false;
  hideMessage(el.sessionMessage);
  el.sessionButtons.hidden = false;
  el.done.hidden = true;
  el.breath.hidden = options.kind !== 'meditation';
  el.breathLabel.hidden = options.kind !== 'meditation';
  setI18nText(el.pause, 'calmTime.pause');
  renderSessionTitle();
  show('session');
  el.pause.focus();
  bell(1); // the start bell
  if (options.kind === 'activity') speak(t('calmTime.activityStart', { activity: options.name, minutes: options.minutes }));
  keepAwake();
  tick();
  tickTimer = setInterval(tick, TICK_MS);
}

function renderSessionTitle() {
  const s = state.session;
  if (!s) return;
  // The name may be the user's own words (a custom activity), so it is a parameter, not a key.
  const name = s.activity ? activityName(s.activity, s.activity === 'custom' ? s.name : '') : t('calmTime.act.meditation');
  if (s.activity !== 'custom') s.name = name;
  setI18nText(el.sessionTitle, 'calmTime.sessionTitle', { name, minutes: s.minutes });
}

// One look at the clock: update the screen, play what came due, finish when the time is up.
function tick() {
  const s = state.session;
  if (!s || s.over) return;
  const now = Date.now();
  const elapsed = elapsedMs(s.timer, now);
  const due = marksToPlay(crossedMarks(s.marks, s.lastElapsed, elapsed));
  s.lastElapsed = elapsed;
  if (due.bell) bell(1);
  if (due.sayKey) speak(t(due.sayKey));
  renderDial(now);
  if (isFinished(s.timer, now)) finishSession();
}

function renderDial(now) {
  const s = state.session;
  el.clock.textContent = formatClock(remainingMs(s.timer, now));
  el.ring.style.strokeDasharray = String(RING_LENGTH);
  el.ring.style.strokeDashoffset = String(RING_LENGTH * (1 - fractionLeft(s.timer, now)));
  if (s.kind !== 'meditation') return;
  const breath = breathPhase(elapsedMs(s.timer, now));
  // Reduced motion: the circle stays still; the words "Breathe in / out" still guide.
  el.breath.style.transform = reducedMotion() ? 'scale(0.8)' : `scale(${breath.scale.toFixed(3)})`;
  if (isPaused(s.timer)) {
    clearI18n(el.breathLabel);
    el.breathLabel.textContent = '';
  } else {
    setI18nText(el.breathLabel, breath.phase === 'in' ? 'calmTime.breatheIn' : 'calmTime.breatheOut');
  }
}

el.pause.addEventListener('click', () => {
  const s = state.session;
  if (!s || s.over) return;
  const now = Date.now();
  if (isPaused(s.timer)) {
    s.timer = resumeTimer(s.timer, now);
    setI18nText(el.pause, 'calmTime.pause');
    hideMessage(el.sessionMessage);
    keepAwake();
  } else {
    s.timer = pauseTimer(s.timer, now);
    speechOutput.stop();
    setI18nText(el.pause, 'calmTime.resume');
    showMessage(el.sessionMessage, 'calmTime.paused');
  }
  renderDial(now);
});

el.stop.addEventListener('click', () => {
  const s = state.session;
  if (!s) return;
  const backTo = s.itemId ? 'routine' : s.kind === 'meditation' ? 'meditate' : 'activity';
  endSession();
  show(backTo);
});

// Stop the clock, the voice and the wake lock (no reward).
function endSession() {
  clearInterval(tickTimer);
  tickTimer = null;
  speechOutput?.stop();
  letSleep();
  if (state.session) state.session.over = true;
}

// The time is up: end bell, kind words, coins; a routine item is ticked done.
function finishSession() {
  const s = state.session;
  endSession();
  el.clock.textContent = formatClock(0);
  el.ring.style.strokeDashoffset = String(RING_LENGTH); // the ring is empty
  el.breathLabel.textContent = '';
  el.sessionButtons.hidden = true;
  el.done.hidden = false;
  el.done.focus();
  bell(2); // two soft strokes at the end
  const key = s.kind === 'meditation' ? 'calmTime.meditationDone' : 'calmTime.activityDone';
  const params = { minutes: s.minutes, activity: s.name };
  showMessage(el.sessionMessage, key, params);
  // Speak after the end bell has started to fade.
  setTimeout(() => speak(t(key, params)), 1500);
  correct({ coins: 1, from: el.clock });
  if (s.itemId) markItem(s.itemId, true, el.clock);
}

el.done.addEventListener('click', () => {
  const s = state.session;
  show(s && s.itemId ? 'routine' : 'start');
});

// Coming back to the tab: catch up at once (the browser may have slowed the ticks down).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  tick();
  checkReminders();
  const s = state.session;
  if (s && !s.over && !isPaused(s.timer)) keepAwake(); // the lock is lost when the tab is hidden
});

// ---------- Daily routine ----------

function todayKey() {
  return dayKey(new Date());
}

function store() {
  saveRoutine(storage(), state.routine);
}

function renderSummary() {
  const status = dayStatus(state.routine, todayKey());
  if (status.total > 0) setI18nText(el.summary, 'calmTime.todaySummary', { done: status.done, total: status.total });
  else setI18nText(el.summary, 'calmTime.noPlanYet');
}

function renderRoutine() {
  const today = todayKey();
  setI18nText(el.streak, 'calmTime.streak', { count: streak(state.routine, today) });

  // Today's list
  el.today.textContent = '';
  const planned = plannedOn(state.routine, today);
  el.todayEmpty.hidden = planned.length > 0;
  for (const item of planned) el.today.appendChild(renderItem(item, today));

  // The last 7 days
  el.history.textContent = '';
  for (const day of routineHistory(state.routine, today)) {
    const li = document.createElement('li');
    li.className = 'calm-day';
    if (day.complete) li.classList.add('calm-day--complete');
    if (day.key === today) li.classList.add('calm-day--today');
    const name = document.createElement('span');
    name.className = 'calm-day-name';
    name.textContent = weekdayName(weekdayOf(day.key));
    const mark = document.createElement('span');
    mark.className = 'calm-day-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = day.total === 0 ? '–' : day.complete ? '✓' : `${day.done}/${day.total}`;
    const spoken = document.createElement('span');
    spoken.className = 'visually-hidden';
    spoken.textContent = day.total === 0 ? t('calmTime.historyFree') : t('calmTime.historyDone', { done: day.done, total: day.total });
    li.append(name, mark, spoken);
    el.history.appendChild(li);
  }
}

function renderItem(item, today) {
  const done = isDone(state.routine, today, item.id);
  const name = activityName(item.activity, item.name);
  const li = document.createElement('li');
  li.className = 'calm-item';
  if (done) li.classList.add('calm-item--done');

  const label = document.createElement('label');
  label.className = 'calm-item-check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = done;
  box.addEventListener('change', () => markItem(item.id, box.checked, box));
  const text = document.createElement('span');
  text.className = 'calm-item-text';
  const time = document.createElement('span');
  time.className = 'calm-item-time';
  time.textContent = formatTime(item.time);
  const what = document.createElement('span');
  what.className = 'calm-item-name';
  what.textContent = name; // plain text: a custom name is never HTML
  const minutes = document.createElement('span');
  minutes.className = 'calm-item-minutes';
  minutes.textContent = t('calmTime.minutes', { n: item.minutes });
  text.append(time, what, minutes);
  label.append(box, text);

  const buttons = document.createElement('div');
  buttons.className = 'calm-item-buttons';
  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'btn';
  start.textContent = t('calmTime.startNow');
  start.addEventListener('click', () => startItem(item));
  const remind = document.createElement('button');
  remind.type = 'button';
  remind.className = 'btn btn--secondary';
  remind.textContent = t('calmTime.addReminder');
  remind.addEventListener('click', () => downloadReminder(item, remind));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn--secondary calm-remove';
  remove.textContent = t('calmTime.remove');
  remove.addEventListener('click', () => {
    showInlineConfirm(el.confirm, {
      message: t('calmTime.removeConfirm', { name }),
      confirmKey: 'common.delete',
      onConfirm: () => {
        state.routine = removeItem(state.routine, item.id, todayKey());
        store();
        renderRoutine();
        el.form.querySelector('select').focus();
      },
    });
  });
  buttons.append(start, remind, remove);
  li.append(label, buttons);
  return li;
}

// Tick (or untick) an item today. A tick gives coins; the last tick of the day gives a level-up
// and the gift box.
function markItem(id, done, from) {
  const key = todayKey();
  const before = state.routine;
  state.routine = setDone(state.routine, key, id, done);
  store();
  if (state.screen === 'routine') renderRoutine();
  if (!done) return;
  if (from !== el.clock) correct({ coins: 1, from }); // a finished session already gave coins
  if (completedNow(before, state.routine, key)) {
    levelUp();
    giftBox();
    speak(t('calmTime.dayComplete'));
  }
}

// Start the timer of a routine item; when it finishes, the item is ticked done.
function startItem(item) {
  hideReminder();
  if (item.activity === 'meditation') {
    startSession({ kind: 'meditation', minutes: item.minutes, name: t('calmTime.act.meditation'), intervalMinutes: 0, guidance: el.medGuidance.checked, itemId: item.id });
  } else {
    startSession({ kind: 'activity', minutes: item.minutes, activity: item.activity, name: activityName(item.activity, item.name), itemId: item.id });
  }
}

// ---------- Add an item ----------

function renderAddForm() {
  const chosen = el.addActivity.value || 'walking';
  el.addActivity.textContent = '';
  for (const activity of ACTIVITIES) {
    const option = document.createElement('option');
    option.value = activity;
    option.textContent = t(`calmTime.act.${activity}`);
    el.addActivity.appendChild(option);
  }
  el.addActivity.value = chosen;
  el.addNameRow.hidden = chosen !== 'custom';

  // The 7 days, all ticked at first (keep the user's ticks when the language changes)
  const ticked = new Set([...el.addDays.querySelectorAll('input:checked')].map((box) => Number(box.value)));
  const first = el.addDays.children.length === 0;
  el.addDays.textContent = '';
  for (const day of WEEK_ORDER) {
    const label = document.createElement('label');
    label.className = 'calm-day-pick';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = String(day);
    box.checked = first || ticked.has(day);
    const name = document.createElement('span');
    name.textContent = weekdayName(day);
    label.title = weekdayName(day, 'long');
    label.append(box, name);
    el.addDays.appendChild(label);
  }
}

el.addActivity.addEventListener('change', () => {
  el.addNameRow.hidden = el.addActivity.value !== 'custom';
  if (el.addActivity.value === 'custom') el.addName.focus();
});

el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = {
    activity: el.addActivity.value,
    name: el.addName.value,
    time: el.addTime.value,
    minutes: el.addMinutes.value,
    days: [...el.addDays.querySelectorAll('input:checked')].map((box) => Number(box.value)),
  };
  const problem = itemProblem(input);
  if (problem) {
    showMessage(el.addProblem, problem);
    return;
  }
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  state.routine = addItem(state.routine, input, todayKey(), id);
  store();
  el.addName.value = '';
  showMessage(el.addProblem, 'calmTime.added');
  renderRoutine();
});

// ---------- Reminders ----------

// A calendar file with a daily (or weekly) repeating event: the phone's calendar app reminds,
// even when this page is closed.
function downloadReminder(item, button) {
  const name = activityName(item.activity, item.name);
  const ics = buildIcs({
    uid: `${item.id}@phantom-voice-kit`,
    title: name,
    description: t('calmTime.icsDescription', { name, minutes: item.minutes }),
    time: item.time,
    minutes: item.minutes,
    days: item.days,
    todayKey: todayKey(),
    nowMs: Date.now(),
  });
  try {
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = icsFilename(item.time);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    showMessage(el.addProblem, 'calmTime.reminderSaved');
  } catch {
    showMessage(el.addProblem, 'calmTime.reminderFailed');
  }
  button.focus();
}

function notificationsSupported() {
  return typeof window.Notification === 'function';
}

function renderNotify() {
  if (!notificationsSupported()) {
    el.notify.hidden = true;
    setI18nText(el.notifyStatus, 'calmTime.notifyUnsupported');
    return;
  }
  const permission = Notification.permission;
  el.notify.hidden = permission !== 'default';
  if (permission === 'granted') setI18nText(el.notifyStatus, 'calmTime.notifyOn');
  else if (permission === 'denied') setI18nText(el.notifyStatus, 'calmTime.notifyBlocked');
  else {
    clearI18n(el.notifyStatus);
    el.notifyStatus.textContent = '';
  }
}

el.notify.addEventListener('click', async () => {
  if (!notificationsSupported()) return;
  try {
    await Notification.requestPermission();
  } catch {
    // old browsers: nothing to do
  }
  renderNotify();
});

// While the page is open: remind in the page (and as a notification, if allowed).
function checkReminders() {
  const now = Date.now();
  const due = dueReminders(state.routine, state.lastReminderCheck, now);
  state.lastReminderCheck = now;
  if (due.length > 0) showReminder(due[0]);
}

function showReminder(item) {
  const name = activityName(item.activity, item.name);
  state.reminderItem = item;
  setI18nText(el.reminderText, 'calmTime.reminderNow', { name, time: formatTime(item.time) });
  el.reminder.hidden = false;
  const busy = state.session && !state.session.over;
  if (!busy) {
    bell(1);
    speak(t('calmTime.reminderNow', { name, time: formatTime(item.time) }));
  }
  if (notificationsSupported() && Notification.permission === 'granted') {
    try {
      new Notification(t('calmTime.title'), { body: t('calmTime.reminderNow', { name, time: formatTime(item.time) }), tag: item.id });
    } catch {
      // Some phones only allow notifications from an installed app: the in-page reminder is shown.
    }
  }
}

function hideReminder() {
  el.reminder.hidden = true;
  clearI18n(el.reminderText);
  state.reminderItem = null;
}

el.reminderStart.addEventListener('click', () => {
  if (state.reminderItem) startItem(state.reminderItem);
});
el.reminderOk.addEventListener('click', () => hideReminder());

// ---------- Start ----------

function renderAll() {
  renderMeditateSetup();
  renderActivitySetup();
  renderAddForm();
  renderNotify();
  renderSessionTitle();
  if (state.screen === 'start') renderSummary();
  if (state.screen === 'routine') renderRoutine();
  if (state.session && !state.session.over) renderDial(Date.now());
}

el.medGuidance.checked = true;
renderAll();
show('start', false); // no focus jump when the page opens
setInterval(checkReminders, REMINDER_CHECK_MS);
