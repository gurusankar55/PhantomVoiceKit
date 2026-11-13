// picture-words.js
// The 60 picture words shared by the games (Ghost Echo uses the first 30, Picture book all 60).
// The names of a word in every language are the locale key "words.<id>":
// "shown name|other way to say it|...". Pure data: no DOM, easy to test.

// The pages of the picture book, in this order.
export const CATEGORIES = Object.freeze(['animals', 'fruits', 'colours', 'numbers', 'body', 'things', 'nature']);

export const PICTURE_WORDS = Object.freeze(
  [
    // --- the 30 words of Ghost Echo ---
    { id: 'cat', emoji: '🐱', category: 'animals' },
    { id: 'dog', emoji: '🐶', category: 'animals' },
    { id: 'fish', emoji: '🐟', category: 'animals' },
    { id: 'bird', emoji: '🐦', category: 'animals' },
    { id: 'cow', emoji: '🐄', category: 'animals' },
    { id: 'moon', emoji: '🌙', category: 'nature' },
    { id: 'sun', emoji: '☀️', category: 'nature' },
    { id: 'star', emoji: '⭐', category: 'nature' },
    { id: 'tree', emoji: '🌳', category: 'nature' },
    { id: 'flower', emoji: '🌸', category: 'nature' },
    { id: 'apple', emoji: '🍎', category: 'fruits' },
    { id: 'banana', emoji: '🍌', category: 'fruits' },
    { id: 'mango', emoji: '🥭', category: 'fruits' },
    { id: 'milk', emoji: '🥛', category: 'things' },
    { id: 'water', emoji: '💧', category: 'nature' },
    { id: 'house', emoji: '🏠', category: 'things' },
    { id: 'car', emoji: '🚗', category: 'things' },
    { id: 'bus', emoji: '🚌', category: 'things' },
    { id: 'boat', emoji: '⛵', category: 'things' },
    { id: 'ball', emoji: '⚽', category: 'things' },
    { id: 'book', emoji: '📖', category: 'things' },
    { id: 'chair', emoji: '🪑', category: 'things' },
    { id: 'cup', emoji: '☕', category: 'things' },
    { id: 'key', emoji: '🔑', category: 'things' },
    { id: 'clock', emoji: '⏰', category: 'things' },
    { id: 'hat', emoji: '🎩', category: 'things' },
    { id: 'shoe', emoji: '👟', category: 'things' },
    { id: 'rain', emoji: '🌧️', category: 'nature' },
    { id: 'fire', emoji: '🔥', category: 'nature' },
    { id: 'egg', emoji: '🥚', category: 'things' },
    // --- 30 more for the picture book ---
    { id: 'elephant', emoji: '🐘', category: 'animals' },
    { id: 'horse', emoji: '🐴', category: 'animals' },
    { id: 'monkey', emoji: '🐒', category: 'animals' },
    { id: 'lion', emoji: '🦁', category: 'animals' },
    { id: 'rabbit', emoji: '🐰', category: 'animals' },
    { id: 'duck', emoji: '🦆', category: 'animals' },
    { id: 'orange', emoji: '🍊', category: 'fruits' },
    { id: 'grapes', emoji: '🍇', category: 'fruits' },
    { id: 'watermelon', emoji: '🍉', category: 'fruits' },
    { id: 'strawberry', emoji: '🍓', category: 'fruits' },
    { id: 'pineapple', emoji: '🍍', category: 'fruits' },
    { id: 'coconut', emoji: '🥥', category: 'fruits' },
    { id: 'red', emoji: '🟥', category: 'colours' },
    { id: 'blue', emoji: '🟦', category: 'colours' },
    { id: 'green', emoji: '🟩', category: 'colours' },
    { id: 'yellow', emoji: '🟨', category: 'colours' },
    { id: 'black', emoji: '⬛', category: 'colours' },
    { id: 'white', emoji: '⬜', category: 'colours' },
    { id: 'one', emoji: '1️⃣', category: 'numbers' },
    { id: 'two', emoji: '2️⃣', category: 'numbers' },
    { id: 'three', emoji: '3️⃣', category: 'numbers' },
    { id: 'four', emoji: '4️⃣', category: 'numbers' },
    { id: 'five', emoji: '5️⃣', category: 'numbers' },
    { id: 'eye', emoji: '👁️', category: 'body' },
    { id: 'ear', emoji: '👂', category: 'body' },
    { id: 'nose', emoji: '👃', category: 'body' },
    { id: 'mouth', emoji: '👄', category: 'body' },
    { id: 'hand', emoji: '✋', category: 'body' },
    { id: 'foot', emoji: '🦶', category: 'body' },
    { id: 'tooth', emoji: '🦷', category: 'body' },
  ].map((word) => Object.freeze(word))
);

export const PICTURE_WORD_IDS = Object.freeze(PICTURE_WORDS.map((word) => word.id));

// The 30 words of Ghost Echo (the first 30, in their old order).
export const ECHO_WORD_IDS = Object.freeze(PICTURE_WORD_IDS.slice(0, 30));

/** The locale key of a word's names. */
export function wordKey(id) {
  return `words.${id}`;
}

/** The emoji of a word ('' for an unknown id). */
export function emojiOf(id) {
  return PICTURE_WORDS.find((word) => word.id === id)?.emoji ?? '';
}

/** The words of one page of the picture book, in list order. */
export function wordsOf(category) {
  return PICTURE_WORDS.filter((word) => word.category === category).map((word) => word.id);
}
