// celebrate.js
// Happy celebrations shared by all apps (no libraries, no audio files, works on phones):
//   correct()  confetti and small firecrackers from the bottom, a short happy sound, and coins
//              flying into the coin bag in the header
//   levelUp()  flower petals and coloured paper falling from the top for about 4 seconds, a bigger sound
//   giftBox()  a gift box shakes, the lid flies off and a sticker pops out (saved in the sticker book)
// Coins and stickers are shared by all apps (localStorage, see celebrate-utils.js).
//
// A celebration never blocks the page: every layer is fixed, ignores the pointer
// (pointer-events: none), is hidden from screen readers and removes itself when done. A short
// polite announcement says what happened. With prefers-reduced-motion a soft glow is shown
// instead of moving pieces. Nothing touches the DOM when this module is imported.
// The styles are in theme.css (section 16).

import { t, setI18nText, setI18nAttr } from './i18n.js';
import { STICKERS, stickerById } from './stickers.js';
import {
  loadRewards,
  saveRewards,
  addCoins,
  addSticker,
  pickSticker,
  loadMuted,
  saveMuted,
  confettiBurst,
  fireworkBurst,
  fallingPieces,
} from './celebrate-utils.js';

// The event sent on window whenever the coins or stickers change (detail = the rewards).
export const REWARDS_EVENT = 'pvk:rewards';

// ---------------------------------------------------------------------------
// Storage and small helpers
// ---------------------------------------------------------------------------

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null; // storage blocked (private mode, settings): the games still work
  }
}

/** The coins and stickers of the player: { coins, stickers: { id: count } }. */
export function getRewards() {
  return loadRewards(storage());
}

function setRewards(rewards) {
  saveRewards(storage(), rewards);
  window.dispatchEvent(new CustomEvent(REWARDS_EVENT, { detail: rewards }));
}

/** Call `callback(rewards)` whenever the coins or stickers change. Returns a function that stops it. */
export function onRewardsChange(callback) {
  const handler = () => callback(getRewards());
  window.addEventListener(REWARDS_EVENT, handler);
  window.addEventListener('storage', handler); // another tab won something
  return () => {
    window.removeEventListener(REWARDS_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

export function isMuted() {
  return loadMuted(storage());
}

export function setMuted(muted) {
  saveMuted(storage(), muted);
  window.dispatchEvent(new CustomEvent('pvk:muted', { detail: muted }));
}

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// One polite live region for all announcements.
let liveRegion = null;
function announce(text) {
  if (!liveRegion || !liveRegion.isConnected) {
    liveRegion = document.createElement('div');
    liveRegion.className = 'pvk-sr-only';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('role', 'status');
    document.body.appendChild(liveRegion);
  }
  liveRegion.textContent = '';
  // A tiny wait so the same text twice in a row is still read.
  setTimeout(() => {
    if (liveRegion) liveRegion.textContent = text;
  }, 50);
}

// A fixed layer over the page that never takes the pointer and is hidden from screen readers.
function makeLayer(className) {
  const layer = document.createElement('div');
  layer.className = `pvk-layer ${className}`;
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

// Reduced motion: a soft glow around the screen that fades away.
function glow(kind = 'gold') {
  const layer = makeLayer(`pvk-glow pvk-glow--${kind}`);
  setTimeout(() => layer.remove(), 1600);
}

// ---------------------------------------------------------------------------
// Sound (Web Audio, short notes made on the device; nothing when muted)
// ---------------------------------------------------------------------------

let audio = null;
function audioContext() {
  if (audio) return audio;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  try {
    audio = new Context();
  } catch {
    audio = null;
  }
  return audio;
}

// notes: [{ freq, at, length, type?, volume? }] (seconds from now)
function playNotes(notes) {
  if (isMuted()) return;
  const ctx = audioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const start = ctx.currentTime + 0.02;
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = note.type || 'triangle';
      osc.frequency.setValueAtTime(note.freq, start + note.at);
      const volume = note.volume ?? 0.18;
      gain.gain.setValueAtTime(0.0001, start + note.at);
      gain.gain.exponentialRampToValueAtTime(volume, start + note.at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + note.at);
      osc.stop(start + note.at + note.length + 0.05);
    }
  } catch {
    // A sound is a bonus: never let it break the game.
  }
}

const SOUND_CORRECT = [
  { freq: 523.25, at: 0, length: 0.14 },
  { freq: 659.25, at: 0.09, length: 0.14 },
  { freq: 783.99, at: 0.18, length: 0.24 },
];
const SOUND_LEVEL = [
  { freq: 523.25, at: 0, length: 0.18 },
  { freq: 659.25, at: 0.14, length: 0.18 },
  { freq: 783.99, at: 0.28, length: 0.18 },
  { freq: 1046.5, at: 0.42, length: 0.45, volume: 0.22 },
  { freq: 1318.5, at: 0.62, length: 0.4, type: 'sine', volume: 0.12 },
  { freq: 1568.0, at: 0.78, length: 0.5, type: 'sine', volume: 0.1 },
];
const SOUND_POP = [
  { freq: 220, at: 0, length: 0.08, type: 'square', volume: 0.08 },
  { freq: 880, at: 0.06, length: 0.2, type: 'sine', volume: 0.16 },
  { freq: 1174.7, at: 0.16, length: 0.3, type: 'sine', volume: 0.14 },
];

// ---------------------------------------------------------------------------
// Canvas animations
// ---------------------------------------------------------------------------

// Run `step(ctx, seconds, dt, width, height)` on a full-screen canvas until it returns false or
// `maxSeconds` passed; then the canvas is removed.
function runCanvas(step, maxSeconds) {
  const canvas = document.createElement('canvas');
  canvas.className = 'pvk-layer pvk-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(ratio, ratio);
  document.body.appendChild(canvas);

  let started = null;
  let last = null;
  function frame(now) {
    if (started === null) {
      started = now;
      last = now;
    }
    const seconds = (now - started) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, width, height);
    const alive = step(ctx, seconds, dt, width, height);
    if (alive && seconds < maxSeconds && canvas.isConnected) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(frame);
}

const GRAVITY = 900; // pixels per second per second

// Confetti from the bottom corners and two or three small firecrackers.
function confettiAndFireworks() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const pieces = confettiBurst({ width, height, count: width < 500 ? 60 : 90 });
  let sparks = [];
  const launches = [0.15, 0.45, 0.75].map((at) => ({
    at,
    x: width * (0.2 + 0.6 * Math.random()),
    y: height * (0.25 + 0.3 * Math.random()),
    done: false,
  }));

  runCanvas((ctx, seconds, dt) => {
    // Firecrackers: a ring of sparks when their time comes.
    for (const launch of launches) {
      if (!launch.done && seconds >= launch.at) {
        launch.done = true;
        sparks = sparks.concat(fireworkBurst({ x: launch.x, y: launch.y, count: 22 }));
      }
    }

    let alive = launches.some((launch) => !launch.done);
    for (const piece of pieces) {
      if (seconds > piece.life) continue;
      piece.vy += GRAVITY * 0.6 * dt;
      piece.vx *= 0.99;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.angle += piece.spin * dt;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, (piece.life - seconds) * 1.5));
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.angle);
      ctx.fillStyle = piece.color;
      if (piece.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, piece.size / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      }
      ctx.restore();
      alive = true;
    }
    for (const spark of sparks) {
      spark.life -= dt;
      if (spark.life <= 0) continue;
      spark.vy += GRAVITY * 0.25 * dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      ctx.globalAlpha = Math.min(1, spark.life * 1.5);
      ctx.fillStyle = spark.color;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
      ctx.fill();
      alive = true;
    }
    ctx.globalAlpha = 1;
    return alive;
  }, 3.5);
}

// Petals and coloured paper falling from the top for about 4 seconds.
function petalsAndPaper() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const seconds = 4;
  const pieces = fallingPieces({ width, height, count: width < 500 ? 50 : 80, seconds });

  runCanvas((ctx, time) => {
    let alive = false;
    for (const piece of pieces) {
      const own = time - piece.delay;
      if (own < 0) {
        alive = true;
        continue;
      }
      const y = piece.y + piece.fall * own;
      if (y > height + 30) continue;
      alive = true;
      const x = piece.x + Math.sin(own * piece.swaySpeed) * piece.sway;
      ctx.save();
      ctx.globalAlpha = time > seconds ? Math.max(0, 1 - (time - seconds) * 2) : 1;
      ctx.translate(x, y);
      ctx.rotate(piece.angle + piece.spin * own);
      ctx.fillStyle = piece.color;
      if (piece.shape === 'petal') {
        ctx.beginPath();
        ctx.ellipse(0, 0, piece.size / 2, piece.size / 4, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // coloured paper turning in the air: its width changes
        ctx.fillRect(-piece.size / 2, -piece.size / 3, piece.size * Math.abs(Math.cos(own * 3)), (piece.size * 2) / 3);
      }
      ctx.restore();
    }
    return alive || time < seconds;
  }, seconds + 1);
}

// ---------------------------------------------------------------------------
// Coins flying into the bag
// ---------------------------------------------------------------------------

function flyCoins(count, from) {
  const bag = document.querySelector('.pvk-coin-bag');
  if (!bag || typeof bag.animate !== 'function') return;
  const target = bag.getBoundingClientRect();
  let origin = from && typeof from.getBoundingClientRect === 'function' ? from.getBoundingClientRect() : null;
  if (origin && origin.width === 0 && origin.height === 0) origin = null; // hidden: start in the middle
  const startX = origin ? origin.left + origin.width / 2 : window.innerWidth / 2;
  const startY = origin ? origin.top + origin.height / 2 : window.innerHeight * 0.6;
  const endX = target.left + target.width / 2;
  const endY = target.top + target.height / 2;

  const layer = makeLayer('pvk-coins-layer');
  const shown = Math.max(1, Math.min(6, count));
  let landed = 0;
  for (let i = 0; i < shown; i++) {
    const coin = document.createElement('span');
    coin.className = 'pvk-coin';
    layer.appendChild(coin);
    const spread = (i - (shown - 1) / 2) * 18;
    const animation = coin.animate(
      [
        { transform: `translate(${startX + spread}px, ${startY}px) scale(0.6)`, opacity: 0 },
        { transform: `translate(${startX + spread}px, ${startY - 60}px) scale(1.1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${endX}px, ${endY}px) scale(0.5)`, opacity: 0.9 },
      ],
      { duration: 900 + i * 90, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }
    );
    animation.onfinish = () => {
      landed += 1;
      bag.classList.remove('pvk-bump');
      void bag.offsetWidth; // restart the bump animation
      bag.classList.add('pvk-bump');
      if (landed === shown) layer.remove();
    };
  }
  setTimeout(() => layer.remove(), 2500); // never left behind
}

// ---------------------------------------------------------------------------
// The three celebrations
// ---------------------------------------------------------------------------

/**
 * A correct answer: confetti, firecrackers, a happy sound, and `coins` coins flying into the bag.
 * @param {{coins?:number, from?:Element}} [options]  from = where the coins start (default: the middle)
 */
export function correct({ coins = 1, from } = {}) {
  try {
    setRewards(addCoins(getRewards(), coins));
    playNotes(SOUND_CORRECT);
    if (reducedMotion()) {
      glow('gold');
    } else {
      confettiAndFireworks();
      flyCoins(coins, from);
    }
    announce(t('celebrate.correct', { count: coins }));
  } catch {
    // A celebration must never break the app.
  }
}

/** A new level: petals and coloured paper falling for about 4 seconds, with a bigger sound. */
export function levelUp() {
  try {
    playNotes(SOUND_LEVEL);
    if (reducedMotion()) glow('pink');
    else petalsAndPaper();
    announce(t('celebrate.levelUp'));
  } catch {
    // never break the app
  }
}

/**
 * A gift: the box shakes, the lid flies off and a sticker pops out. The sticker is saved in the
 * sticker book. Resolves with the sticker id when the sticker is shown.
 * @returns {Promise<string>}
 */
export function giftBox() {
  return new Promise((resolve) => {
    let id = STICKERS[0].id;
    try {
      const before = getRewards();
      id = pickSticker(before);
      setRewards(addSticker(before, id));
      const sticker = stickerById(id);
      const name = t(sticker.nameKey);
      const still = reducedMotion();

      const layer = makeLayer('pvk-gift-layer');
      const scene = document.createElement('div');
      scene.className = still ? 'pvk-gift pvk-gift--open pvk-gift--still' : 'pvk-gift';
      scene.innerHTML =
        '<div class="pvk-gift-box"><div class="pvk-gift-front"></div><div class="pvk-gift-side"></div>' +
        '<div class="pvk-gift-ribbon"></div></div>' +
        '<div class="pvk-gift-lid"><div class="pvk-gift-bow"></div></div>' +
        `<div class="pvk-gift-sticker">${sticker.svg}</div>`; // sticker.svg is a fixed constant (stickers.js)
      const label = document.createElement('p');
      label.className = 'pvk-gift-label';
      label.textContent = t('celebrate.gotSticker', { name }); // plain text, never HTML
      scene.appendChild(label);
      layer.appendChild(scene);

      const open = () => {
        scene.classList.add('pvk-gift--open');
        playNotes(SOUND_POP);
        announce(t('celebrate.gotSticker', { name }));
        resolve(id);
      };
      if (still) {
        open();
        setTimeout(() => layer.remove(), 3200);
      } else {
        requestAnimationFrame(() => scene.classList.add('pvk-gift--shake'));
        setTimeout(open, 1000);
        setTimeout(() => scene.classList.add('pvk-gift--leave'), 3400);
        setTimeout(() => layer.remove(), 3900);
      }
    } catch {
      resolve(id);
    }
  });
}

// ---------------------------------------------------------------------------
// The coin counter and the mute button (in the nav header)
// ---------------------------------------------------------------------------

const BAG_SVG =
  '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
  '<path d="M11 6h10l-3 5h-4z" fill="#a0703f"/>' +
  '<path d="M13 11h6c7 3 10 9 10 13 0 4-4 6-13 6S3 28 3 24c0-4 3-10 10-13z" fill="#c8934f"/>' +
  '<circle cx="16" cy="21" r="5" fill="#ffd23f" stroke="#e69b00" stroke-width="1.5"/></svg>';

/**
 * The coin bag with the number of coins, and the sound on / off button. Used by nav-menu.js.
 * The number updates by itself when coins are won (in this tab or another one).
 * @returns {HTMLElement}
 */
export function createRewardsBar() {
  const bar = document.createElement('div');
  bar.className = 'pvk-rewards';

  // The bag is a link to the sticker book (coins and stickers in one place).
  const bag = document.createElement('a');
  bag.className = 'pvk-coin-bag';
  bag.href = '/apps/sticker-book/index.html';
  const icon = document.createElement('span');
  icon.className = 'pvk-coin-icon';
  icon.innerHTML = BAG_SVG; // fixed constant
  const number = document.createElement('span');
  number.className = 'pvk-coin-count';
  number.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'pvk-sr-only';
  bag.append(icon, number, label);

  const mute = document.createElement('button');
  mute.type = 'button';
  mute.className = 'pvk-mute';
  const muteIcon = document.createElement('span');
  muteIcon.setAttribute('aria-hidden', 'true');
  mute.appendChild(muteIcon);

  function showCoins(rewards) {
    number.textContent = String(rewards.coins);
    setI18nText(label, 'celebrate.coins', { count: rewards.coins });
  }
  function showMute() {
    const muted = isMuted();
    muteIcon.textContent = muted ? '🔇' : '🔊';
    mute.setAttribute('aria-pressed', String(muted));
    setI18nAttr(mute, 'aria-label', muted ? 'celebrate.soundOn' : 'celebrate.soundOff');
    setI18nAttr(mute, 'title', muted ? 'celebrate.soundOn' : 'celebrate.soundOff');
  }

  mute.addEventListener('click', () => {
    setMuted(!isMuted());
    showMute();
  });
  window.addEventListener('pvk:muted', showMute);
  onRewardsChange(showCoins);

  showCoins(getRewards());
  showMute();
  bar.append(bag, mute);
  return bar;
}
