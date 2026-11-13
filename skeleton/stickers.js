// stickers.js
// The stickers that can be won in the games (shared by all apps). Each one is a small picture
// drawn as an inline SVG string with fixed shapes and colours (no user text inside), so it can
// be put on the page safely. nameKey is the translation key of its name.
// Pure data: no DOM access, so it is easy to test.

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" focusable="false" aria-hidden="true">${body}</svg>`;

export const STICKERS = Object.freeze([
  {
    id: 'ghost',
    nameKey: 'sticker.ghost',
    svg: svg(
      '<path d="M32 6C20 6 12 15 12 27v29l7-5 6 5 7-5 7 5 6-5 7 5V27C52 15 44 6 32 6z" fill="#f6f3ff" stroke="#6a45a8" stroke-width="2"/>' +
        '<ellipse cx="25" cy="27" rx="3.5" ry="5" fill="#1a0f2e"/><ellipse cx="39" cy="27" rx="3.5" ry="5" fill="#1a0f2e"/>' +
        '<ellipse cx="32" cy="38" rx="4" ry="3" fill="#1a0f2e"/><circle cx="20" cy="34" r="3" fill="#ffb3c7"/><circle cx="44" cy="34" r="3" fill="#ffb3c7"/>'
    ),
  },
  {
    id: 'pumpkin',
    nameKey: 'sticker.pumpkin',
    svg: svg(
      '<path d="M30 14c0-5 3-8 7-9l2 3c-3 1-5 3-5 6z" fill="#3f8f3a"/>' +
        '<ellipse cx="32" cy="38" rx="25" ry="20" fill="#ff7a1a"/><ellipse cx="32" cy="38" rx="11" ry="20" fill="#ff9a3d"/>' +
        '<path d="M20 34l6-6 6 6zM32 34l6-6 6 6z" fill="#1a0f2e"/><path d="M19 44q13 9 26 0l-4 1-3-3-4 4-4-4-4 4-3-3z" fill="#1a0f2e"/>'
    ),
  },
  {
    id: 'owl',
    nameKey: 'sticker.owl',
    svg: svg(
      '<path d="M14 18l6 6M50 18l-6 6" stroke="#8a5a2b" stroke-width="5" stroke-linecap="round"/>' +
        '<ellipse cx="32" cy="38" rx="20" ry="22" fill="#a0703f"/><ellipse cx="32" cy="45" rx="12" ry="12" fill="#e8c99a"/>' +
        '<circle cx="24" cy="30" r="8" fill="#fff"/><circle cx="40" cy="30" r="8" fill="#fff"/>' +
        '<circle cx="24" cy="30" r="4" fill="#1a0f2e"/><circle cx="40" cy="30" r="4" fill="#1a0f2e"/><path d="M29 36l3 5 3-5z" fill="#ffa24d"/>'
    ),
  },
  {
    id: 'moon',
    nameKey: 'sticker.moon',
    svg: svg(
      '<path d="M40 8a24 24 0 1 0 16 38A20 20 0 1 1 40 8z" fill="#ffe14d" stroke="#d8b400" stroke-width="2"/>' +
        '<circle cx="26" cy="30" r="3" fill="#d8b400"/><circle cx="22" cy="42" r="2" fill="#d8b400"/><circle cx="32" cy="48" r="2.5" fill="#d8b400"/>'
    ),
  },
  {
    id: 'bat',
    nameKey: 'sticker.bat',
    svg: svg(
      '<path d="M32 22c-4 0-6 3-6 6-5-6-13-8-22-6 5 3 7 8 6 13 4-3 8-2 10 1 1-3 4-4 6-2 1 4 4 8 6 8s5-4 6-8c2-2 5-1 6 2 2-3 6-4 10-1-1-5 1-10 6-13-9-2-17 0-22 6 0-3-2-6-6-6z" fill="#3b2a5c"/>' +
        '<path d="M27 21l2-6 3 5 3-5 2 6" fill="#3b2a5c"/><circle cx="29" cy="27" r="1.6" fill="#ffe14d"/><circle cx="35" cy="27" r="1.6" fill="#ffe14d"/>'
    ),
  },
  {
    id: 'star',
    nameKey: 'sticker.star',
    svg: svg(
      '<path d="M32 5l8 17 18 2-13 12 4 18-17-9-17 9 4-18L6 24l18-2z" fill="#ffd23f" stroke="#e69b00" stroke-width="2" stroke-linejoin="round"/>' +
        '<circle cx="26" cy="30" r="2" fill="#1a0f2e"/><circle cx="38" cy="30" r="2" fill="#1a0f2e"/><path d="M27 37q5 4 10 0" stroke="#1a0f2e" stroke-width="2" fill="none" stroke-linecap="round"/>'
    ),
  },
  {
    id: 'cat',
    nameKey: 'sticker.cat',
    svg: svg(
      '<path d="M14 14l8 12h20l8-12 2 26c0 12-9 18-20 18S12 52 12 40z" fill="#2b2238"/>' +
        '<ellipse cx="25" cy="36" rx="4" ry="5" fill="#9cff57"/><ellipse cx="39" cy="36" rx="4" ry="5" fill="#9cff57"/>' +
        '<ellipse cx="25" cy="36" rx="1.4" ry="4" fill="#1a0f2e"/><ellipse cx="39" cy="36" rx="1.4" ry="4" fill="#1a0f2e"/>' +
        '<path d="M30 44l2 2 2-2zM18 46h8M38 46h8" stroke="#f6f3ff" stroke-width="1.5" fill="#ffb3c7"/>'
    ),
  },
  {
    id: 'candy',
    nameKey: 'sticker.candy',
    svg: svg(
      '<path d="M18 32l-12-9v18zM46 32l12-9v18z" fill="#ff5fa2"/>' +
        '<circle cx="32" cy="32" r="15" fill="#ff8cc6"/>' +
        '<path d="M22 22q10 10 0 20M32 17q10 15 0 30M42 22q-10 10 0 20" stroke="#fff" stroke-width="3" fill="none"/>'
    ),
  },
  {
    id: 'spider',
    nameKey: 'sticker.spider',
    svg: svg(
      '<path d="M32 2v14" stroke="#cfc6e8" stroke-width="1.5"/>' +
        '<path d="M22 30l-14-8M22 36l-16 0M22 42l-14 10M42 30l14-8M42 36l16 0M42 42l14 10" stroke="#1a0f2e" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="32" cy="24" r="8" fill="#2b2238"/><ellipse cx="32" cy="40" rx="12" ry="13" fill="#2b2238"/>' +
        '<circle cx="29" cy="23" r="2" fill="#ff5f5f"/><circle cx="35" cy="23" r="2" fill="#ff5f5f"/>'
    ),
  },
  {
    id: 'witchHat',
    nameKey: 'sticker.witchHat',
    svg: svg(
      '<ellipse cx="32" cy="50" rx="27" ry="7" fill="#4b2a7a"/>' +
        '<path d="M20 48L30 10c2-4 8-4 10 2l-6 4 4 32z" fill="#5d3596"/>' +
        '<path d="M21 42h24v6H21z" fill="#ff7a1a"/><rect x="29" y="41" width="8" height="8" rx="1" fill="#ffe14d"/>'
    ),
  },
  {
    id: 'cauldron',
    nameKey: 'sticker.cauldron',
    svg: svg(
      '<circle cx="24" cy="14" r="4" fill="#9cff57"/><circle cx="34" cy="9" r="3" fill="#9cff57"/><circle cx="40" cy="16" r="3.5" fill="#9cff57"/>' +
        '<ellipse cx="32" cy="24" rx="20" ry="5" fill="#9cff57"/>' +
        '<path d="M12 24h40c0 18-8 30-20 30S12 42 12 24z" fill="#2b2238"/>' +
        '<path d="M18 54l-3 6M46 54l3 6" stroke="#2b2238" stroke-width="4" stroke-linecap="round"/>'
    ),
  },
  {
    id: 'lantern',
    nameKey: 'sticker.lantern',
    svg: svg(
      '<path d="M26 6h12v6H26z" fill="#6a45a8"/><path d="M28 2h8" stroke="#6a45a8" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M20 12h24l-3 40H23z" fill="#ffe9a8" stroke="#6a45a8" stroke-width="3"/>' +
        '<path d="M32 22c-5 7-5 12 0 16 5-4 5-9 0-16z" fill="#ff7a1a"/><path d="M18 52h28v6H18z" fill="#6a45a8"/>'
    ),
  },
  {
    id: 'mushroom',
    nameKey: 'sticker.mushroom',
    svg: svg(
      '<path d="M6 34C6 18 18 8 32 8s26 10 26 26z" fill="#e8394a"/>' +
        '<circle cx="20" cy="22" r="4" fill="#fff"/><circle cx="36" cy="16" r="3" fill="#fff"/><circle cx="46" cy="27" r="4" fill="#fff"/>' +
        '<path d="M24 34h16l2 20c0 3-4 4-10 4s-10-1-10-4z" fill="#f6eedd"/>' +
        '<circle cx="29" cy="44" r="1.6" fill="#1a0f2e"/><circle cx="35" cy="44" r="1.6" fill="#1a0f2e"/>'
    ),
  },
  {
    id: 'potion',
    nameKey: 'sticker.potion',
    svg: svg(
      '<path d="M26 4h12v6H26z" fill="#a0703f"/>' +
        '<path d="M27 10h10v12l12 18c4 8-1 18-11 18H26c-10 0-15-10-11-18l12-18z" fill="#cfc6e8" opacity="0.9"/>' +
        '<path d="M17 42h30c2 8-3 13-9 13H26c-6 0-11-5-9-13z" fill="#b14dff"/>' +
        '<circle cx="28" cy="47" r="2" fill="#f6f3ff"/><circle cx="36" cy="50" r="1.5" fill="#f6f3ff"/>'
    ),
  },
]);

/** The sticker with this id, or null. */
export function stickerById(id) {
  return STICKERS.find((sticker) => sticker.id === id) ?? null;
}
