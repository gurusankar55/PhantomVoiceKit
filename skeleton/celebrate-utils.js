// celebrate-utils.js
// Pure helpers for the celebrations (celebrate.js): the coins and stickers that are shared by
// all apps, the mute choice, and the particles of confetti, firecrackers and falling petals.
// Storage is passed in (localStorage in the browser, a fake in tests); every access is in
// try/catch, so a full or blocked storage never breaks a game. No DOM access here.

import { STICKERS } from './stickers.js';

export const REWARDS_KEY = 'phantomVoiceKit.rewards';
export const MUTED_KEY = 'phantomVoiceKit.muted';

// No game gives more than this many coins (keeps a damaged value from growing without end).
export const MAX_COINS = 999999;

const STICKER_IDS = new Set(STICKERS.map((sticker) => sticker.id));

/** Empty rewards: no coins, no stickers. */
export function emptyRewards() {
  return { coins: 0, stickers: {} };
}

/**
 * Make any value into clean rewards: whole coins from 0 to MAX_COINS, and only known stickers
 * with a whole count of at least 1.
 */
export function cleanRewards(value) {
  const rewards = emptyRewards();
  if (!value || typeof value !== 'object') return rewards;
  const coins = Number(value.coins);
  if (Number.isFinite(coins)) rewards.coins = Math.max(0, Math.min(MAX_COINS, Math.floor(coins)));
  if (value.stickers && typeof value.stickers === 'object') {
    for (const [id, count] of Object.entries(value.stickers)) {
      const n = Math.floor(Number(count));
      if (STICKER_IDS.has(id) && Number.isFinite(n) && n >= 1) rewards.stickers[id] = Math.min(n, 9999);
    }
  }
  return rewards;
}

/** Read the rewards from storage (missing, damaged or blocked storage gives empty rewards). */
export function loadRewards(storage) {
  try {
    const text = storage?.getItem(REWARDS_KEY);
    if (!text) return emptyRewards();
    return cleanRewards(JSON.parse(text));
  } catch {
    return emptyRewards();
  }
}

/** Save the rewards. Returns false when the storage could not be written. */
export function saveRewards(storage, rewards) {
  try {
    storage?.setItem(REWARDS_KEY, JSON.stringify(cleanRewards(rewards)));
    return true;
  } catch {
    return false;
  }
}

/** New rewards with `amount` more coins (0 or more, whole). */
export function addCoins(rewards, amount) {
  const clean = cleanRewards(rewards);
  const add = Math.max(0, Math.floor(Number(amount) || 0));
  return { ...clean, coins: Math.min(MAX_COINS, clean.coins + add) };
}

/** New rewards with one more of this sticker (an unknown id changes nothing). */
export function addSticker(rewards, id) {
  const clean = cleanRewards(rewards);
  if (!STICKER_IDS.has(id)) return clean;
  return { ...clean, stickers: { ...clean.stickers, [id]: (clean.stickers[id] ?? 0) + 1 } };
}

/** How many different stickers have been found. */
export function foundCount(rewards) {
  return Object.keys(cleanRewards(rewards).stickers).length;
}

/**
 * The sticker for the next gift: one that was not found yet when there is one (so the book
 * fills up), otherwise any sticker. random() gives a number from 0 (included) to 1.
 * @returns {string} a sticker id
 */
export function pickSticker(rewards, random = Math.random) {
  const owned = cleanRewards(rewards).stickers;
  const missing = STICKERS.filter((sticker) => !owned[sticker.id]);
  const pool = missing.length > 0 ? missing : STICKERS;
  const index = Math.min(pool.length - 1, Math.floor(clamp01(random()) * pool.length));
  return pool[index].id;
}

/** Is the sound turned off? (Missing or blocked storage: sound on.) */
export function loadMuted(storage) {
  try {
    return storage?.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Save the mute choice. Returns false when the storage could not be written. */
export function saveMuted(storage, muted) {
  try {
    storage?.setItem(MUTED_KEY, muted ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Particles (plain numbers; celebrate.js draws them on a canvas)
// ---------------------------------------------------------------------------

export const CONFETTI_COLORS = ['#ff7a1a', '#ffe14d', '#9cff57', '#5fd4ff', '#ff5fa2', '#b14dff', '#f6f3ff'];
export const PETAL_COLORS = ['#ff8cc6', '#ffb3c7', '#ffd23f', '#ff7a1a', '#b14dff', '#5fd4ff', '#9cff57'];

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(0.999999, Math.max(0, n));
}

/**
 * Confetti shot up from the bottom of the screen. Speeds are in pixels per second, gravity pulls
 * them back down. Each piece: { x, y, vx, vy, size, color, spin, angle, shape: 'rect' | 'circle', life }.
 */
export function confettiBurst({ width, height, count = 80, random = Math.random }) {
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const fromLeft = i % 2 === 0;
    pieces.push({
      x: fromLeft ? width * (0.05 + 0.3 * random()) : width * (0.65 + 0.3 * random()),
      y: height + 10,
      vx: (fromLeft ? 1 : -1) * (60 + 220 * random()),
      vy: -(height * (0.9 + 0.6 * random())),
      size: 6 + 6 * random(),
      color: CONFETTI_COLORS[Math.floor(clamp01(random()) * CONFETTI_COLORS.length)],
      spin: (random() - 0.5) * 12,
      angle: random() * Math.PI * 2,
      shape: random() < 0.7 ? 'rect' : 'circle',
      life: 2.2 + random() * 0.8,
    });
  }
  return pieces;
}

/**
 * One small firecracker: a ring of sparks from one point. Each spark: { x, y, vx, vy, size, color, life }.
 */
export function fireworkBurst({ x, y, count = 24, speed = 220, random = Math.random }) {
  const color = CONFETTI_COLORS[Math.floor(clamp01(random()) * CONFETTI_COLORS.length)];
  const sparks = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + random() * 0.2;
    const v = speed * (0.6 + 0.5 * random());
    sparks.push({ x, y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, size: 2 + 2 * random(), color, life: 0.8 + 0.4 * random() });
  }
  return sparks;
}

/**
 * Petals and coloured paper falling from the top, spread over `seconds` (a new piece starts
 * every so often). Each piece: { x, y, delay, fall, sway, swaySpeed, size, color, shape: 'petal' | 'paper', spin, angle }.
 */
export function fallingPieces({ width, height, count = 70, seconds = 4, random = Math.random }) {
  const pieces = [];
  for (let i = 0; i < count; i++) {
    pieces.push({
      x: width * random(),
      y: -20 - 40 * random(),
      delay: (seconds * 0.6) * (i / Math.max(1, count)),
      fall: height * (0.25 + 0.2 * random()), // pixels per second
      sway: 20 + 40 * random(),
      swaySpeed: 1 + 2 * random(),
      size: 8 + 8 * random(),
      color: PETAL_COLORS[Math.floor(clamp01(random()) * PETAL_COLORS.length)],
      shape: random() < 0.55 ? 'petal' : 'paper',
      spin: (random() - 0.5) * 4,
      angle: random() * Math.PI * 2,
    });
  }
  return pieces;
}
