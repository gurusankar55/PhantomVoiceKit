// celebrate.test.js
// Shared celebrations: coins and stickers in storage, the sticker list, the particles, the mute
// choice, and the Ghost Tutor round rule. Pure modules only: no browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';

import { STICKERS, stickerById } from '../../skeleton/stickers.js';
import {
  REWARDS_KEY,
  MUTED_KEY,
  MAX_COINS,
  emptyRewards,
  cleanRewards,
  loadRewards,
  saveRewards,
  addCoins,
  addSticker,
  foundCount,
  pickSticker,
  loadMuted,
  saveMuted,
  confettiBurst,
  fireworkBurst,
  fallingPieces,
} from '../../skeleton/celebrate-utils.js';
import { roundCorrect, earnsRoundGift, ROUND_GIFT_MIN } from '../../apps/ghost-tutor/lesson-utils.js';
import { buildProgress, parseProgress, restoreSegments } from '../../apps/ghost-tutor/progress-utils.js';

// A storage like localStorage, in memory.
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    data,
  };
}
// A storage that throws on every access (blocked storage, private mode).
const brokenStorage = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('full');
  },
};

describe('stickers', () => {
  test('there are at least 12, with unique ids, and the ones asked for are there', () => {
    assert.ok(STICKERS.length >= 12);
    const ids = STICKERS.map((sticker) => sticker.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ['ghost', 'pumpkin', 'owl', 'moon', 'bat', 'star', 'cat', 'candy']) assert.ok(ids.includes(id), id);
  });

  test('each one is a small inline SVG without scripts, events or links', () => {
    for (const sticker of STICKERS) {
      assert.match(sticker.svg, /^<svg [^>]*viewBox="0 0 64 64"[^>]*>.*<\/svg>$/s, sticker.id);
      assert.doesNotMatch(sticker.svg, /<script|on\w+=|href|javascript:|<foreignObject/i, sticker.id);
      assert.equal(sticker.nameKey, `sticker.${sticker.id}`);
    }
  });

  test('every sticker has a name in all 20 languages', () => {
    for (const code of ['en', 'ta', 'hi', 'te', 'kn', 'ml', 'ko', 'zh', 'ja', 'es', 'fr', 'ar', 'pt', 'ru', 'bn', 'ur', 'id', 'de', 'vi', 'tr']) {
      const strings = JSON.parse(readFileSync(new URL(`../../skeleton/locales/${code}.json`, import.meta.url), 'utf8'));
      for (const sticker of STICKERS) assert.ok(strings[sticker.nameKey], `${code} ${sticker.nameKey}`);
    }
  });

  test('stickerById', () => {
    assert.equal(stickerById('owl').id, 'owl');
    assert.equal(stickerById('dragon'), null);
  });
});

describe('coins and stickers in storage', () => {
  test('nothing saved, damaged JSON or blocked storage: empty rewards', () => {
    assert.deepEqual(loadRewards(memoryStorage()), emptyRewards());
    const damaged = memoryStorage();
    damaged.setItem(REWARDS_KEY, '{not json');
    assert.deepEqual(loadRewards(damaged), emptyRewards());
    assert.deepEqual(loadRewards(brokenStorage), emptyRewards());
    assert.deepEqual(loadRewards(null), emptyRewards());
  });

  test('saving and loading gives the same rewards (shared by all apps under one key)', () => {
    const storage = memoryStorage();
    let rewards = addCoins(emptyRewards(), 5);
    rewards = addSticker(rewards, 'owl');
    rewards = addSticker(rewards, 'owl');
    rewards = addSticker(rewards, 'moon');
    assert.equal(saveRewards(storage, rewards), true);
    assert.ok(storage.data.has(REWARDS_KEY));
    assert.deepEqual(loadRewards(storage), { coins: 5, stickers: { owl: 2, moon: 1 } });
    assert.equal(foundCount(rewards), 2);
  });

  test('a full or blocked storage does not throw', () => {
    assert.equal(saveRewards(brokenStorage, addCoins(emptyRewards(), 3)), false);
  });

  test('bad values are repaired: negative or huge coins, unknown stickers, bad counts', () => {
    assert.deepEqual(cleanRewards({ coins: -4, stickers: { owl: 0, dragon: 3, moon: 'x', bat: 2.7 } }), { coins: 0, stickers: { bat: 2 } });
    assert.equal(cleanRewards({ coins: 1e12 }).coins, MAX_COINS);
    assert.deepEqual(cleanRewards('nonsense'), emptyRewards());
    assert.deepEqual(addSticker(emptyRewards(), 'dragon'), emptyRewards());
    assert.equal(addCoins(emptyRewards(), -10).coins, 0);
  });

  test('property: coins only go up, never above the limit', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -50, max: 50000 }), { maxLength: 30 }), (amounts) => {
        let rewards = emptyRewards();
        for (const amount of amounts) {
          const next = addCoins(rewards, amount);
          if (next.coins < rewards.coins || next.coins > MAX_COINS) return false;
          rewards = next;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

describe('pickSticker: the next gift', () => {
  test('a sticker that was not found yet comes first', () => {
    let rewards = emptyRewards();
    for (let i = 0; i < STICKERS.length; i++) {
      const id = pickSticker(rewards, () => 0.5);
      assert.equal(rewards.stickers[id], undefined, `${id} was already found`);
      rewards = addSticker(rewards, id);
    }
    assert.equal(foundCount(rewards), STICKERS.length);
    // All found: any sticker again.
    assert.ok(stickerById(pickSticker(rewards, () => 0.99)));
  });

  test('property: any random value gives a real sticker', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: false }), (r) => stickerById(pickSticker(emptyRewards(), () => r)) !== null),
      { numRuns: 100 }
    );
  });
});

describe('mute', () => {
  test('saved and read back; blocked storage means sound on and no error', () => {
    const storage = memoryStorage();
    assert.equal(loadMuted(storage), false);
    saveMuted(storage, true);
    assert.equal(storage.data.get(MUTED_KEY), '1');
    assert.equal(loadMuted(storage), true);
    saveMuted(storage, false);
    assert.equal(loadMuted(storage), false);
    assert.equal(loadMuted(brokenStorage), false);
    assert.equal(saveMuted(brokenStorage, true), false);
  });
});

describe('particles', () => {
  test('confetti starts at the bottom and flies up', () => {
    const pieces = confettiBurst({ width: 360, height: 640, count: 40 });
    assert.equal(pieces.length, 40);
    for (const piece of pieces) {
      assert.ok(piece.y >= 640 && piece.vy < 0);
      assert.ok(piece.x >= 0 && piece.x <= 360);
      assert.ok(piece.life > 0 && piece.size > 0);
    }
  });

  test('a firecracker is a ring of sparks around one point', () => {
    const sparks = fireworkBurst({ x: 100, y: 200, count: 12 });
    assert.equal(sparks.length, 12);
    assert.ok(sparks.every((spark) => spark.x === 100 && spark.y === 200));
    const angles = new Set(sparks.map((spark) => Math.round(Math.atan2(spark.vy, spark.vx) * 2)));
    assert.ok(angles.size >= 8, 'the sparks fly in many directions');
  });

  test('petals and paper start above the top and fall during about 4 seconds', () => {
    const pieces = fallingPieces({ width: 360, height: 640, count: 30, seconds: 4 });
    assert.equal(pieces.length, 30);
    assert.ok(pieces.every((piece) => piece.y < 0 && piece.fall > 0 && piece.delay >= 0 && piece.delay < 4));
    assert.ok(pieces.some((piece) => piece.shape === 'petal'));
  });
});

describe('Ghost Tutor: 3 or more correct in a round of 4 earns a level-up and a gift', () => {
  const parts = (flags) => flags.map((correct) => ({ correct }));

  test('roundCorrect counts the parts of one round only', () => {
    const segments = parts([true, false, true, true, false, false, true, false]);
    assert.equal(roundCorrect(segments, 1), 3);
    assert.equal(roundCorrect(segments, 2), 1);
    assert.equal(roundCorrect(segments, 3), 0);
    assert.equal(roundCorrect(null, 1), 0);
  });

  test('earnsRoundGift at 3 and 4, not at 2', () => {
    assert.equal(ROUND_GIFT_MIN, 3);
    assert.equal(earnsRoundGift(parts([true, true, true, false]), 1), true);
    assert.equal(earnsRoundGift(parts([true, true, true, true]), 1), true);
    assert.equal(earnsRoundGift(parts([true, false, true, false]), 1), false);
    assert.equal(earnsRoundGift(parts([true, true, true, true, true, false, false, true]), 2), false);
  });

  test('the correct flags survive saving and resuming (older saves count as not correct)', () => {
    const segments = [0, 1, 2, 3].map((i) => ({ title: `T${i}`, segment: `S${i}`, quizQuestion: `Q${i}`, lang: 'ta-IN', correct: i !== 1 }));
    const saved = buildProgress({ topic: 'Moon', language: { label: 'Tamil', bcp47: 'ta-IN' }, segments, segmentIndex: 3, score: 2, round: 1 });
    const parsed = parseProgress(JSON.stringify(saved));
    assert.deepEqual(parsed.segments.map((s) => s.correct), [true, false, true, true]);
    assert.deepEqual(restoreSegments(parsed.segments).map((s) => s.correct), [true, false, true, true]);

    const old = JSON.parse(JSON.stringify(saved));
    for (const s of old.segments) delete s.correct;
    assert.deepEqual(parseProgress(JSON.stringify(old)).segments.map((s) => s.correct), [false, false, false, false]);
  });
});
