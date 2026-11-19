// app-icons.js
// One colourful "soft 3D" icon per app, as inline SVG: gradients for the volume, a white
// highlight for the shine and a soft oval shadow underneath (no filters, so it stays fast on old
// phones). Used by the menu (nav-menu.js) and the Home cards (index.html).
//
// The SVG text is built only from the constants in this file (never from user input), so it is
// safe to put into innerHTML. Every call gets its own gradient ids, so the same icon can appear
// twice on one page (menu + Home card) without the ids clashing.

export const APP_ICON_IDS = Object.freeze([
  'home',
  'spirit-clerk',
  'ghost-tutor',
  'form-translator',
  'ghost-echo',
  'sticker-book',
  'my-documents',
  'voice-notes',
  'picture-book',
  'pumpkin-math',
  'story-time',
  'calm-time',
  'voice-translator',
  'talk-learn',
  'kolam-puzzle',
]);

let counter = 0; // makes the gradient ids unique on the page

// ---------- small helpers ----------

// A top-to-bottom gradient (light at the top: lit from above).
function lin(id, from, to) {
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
}

// A round gradient lit from the top left (looks like a ball or a soft bump).
function rad(id, from, to) {
  return `<radialGradient id="${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></radialGradient>`;
}

// A four-pointed sparkle.
function sparkle(cx, cy, r, fill) {
  return `<path d="M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z" fill="${fill}"/>`;
}

// The soft shadow under every icon.
const SHADOW = '<ellipse cx="24" cy="45" rx="15" ry="2.4" fill="#05010f" opacity="0.35"/>';

// A microphone on a stand (used by two icons, in two colours).
function microphone(fill, stand) {
  return (
    `<rect x="31" y="21" width="9" height="14" rx="4.5" fill="${fill}"/>` +
    `<path d="M28.5 30.5a7 7 0 0014 0M35.5 37.5v4M32 41.5h7" fill="none" stroke="${stand}" stroke-width="2" stroke-linecap="round"/>` +
    '<rect x="33" y="23" width="2.2" height="7" rx="1.1" fill="#fff" opacity="0.55"/>'
  );
}

// ---------- the icons (viewBox 0 0 48 48) ----------
// Each one gets u(name) -> a unique id and returns { defs, body }.

const ICONS = {
  // Smiling ghost house
  home: (u) => ({
    defs: lin(u('roof'), '#a77bff', '#5b2fb3') + rad(u('wall'), '#ffffff', '#cbbdf0'),
    body:
      '<rect x="31" y="8" width="5" height="9" rx="1" fill="#7d4fd6"/>' +
      `<path d="M24 5L43 21H5Z" fill="url(#${u('roof')})" stroke="#4a2394" stroke-width="1" stroke-linejoin="round"/>` +
      `<path d="M10 20H38V40L33.3 37L28.7 40L24 37L19.3 40L14.7 37L10 40Z" fill="url(#${u('wall')})"/>` +
      '<circle cx="18.5" cy="26" r="2.3" fill="#2a1648"/><circle cx="29.5" cy="26" r="2.3" fill="#2a1648"/>' +
      '<path d="M18.5 31Q24 35.5 29.5 31" fill="none" stroke="#2a1648" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M23.5 8.5L13 17.5" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.45"/>' +
      '<ellipse cx="14" cy="25" rx="1.8" ry="3.6" fill="#fff" opacity="0.8"/>',
  }),

  // Clipboard with a microphone
  'spirit-clerk': (u) => ({
    defs: lin(u('board'), '#d9995a', '#8a5424') + lin(u('paper'), '#ffffff', '#e2daf5') + lin(u('clip'), '#e6e9f2', '#8b93a8') + lin(u('mic'), '#ff7f9c', '#c81e4a'),
    body:
      `<rect x="7" y="7" width="26" height="35" rx="4" fill="url(#${u('board')})"/>` +
      `<rect x="10" y="11" width="20" height="27" rx="2" fill="url(#${u('paper')})"/>` +
      `<rect x="14" y="4.5" width="12" height="6" rx="2" fill="url(#${u('clip')})" stroke="#6b7280" stroke-width="0.8"/>` +
      '<path d="M13.5 18h13M13.5 23h13M13.5 28h8" stroke="#9a8fc0" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M9 12v26" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity="0.3"/>' +
      microphone(`url(#${u('mic')})`, '#c81e4a'),
  }),

  // Graduation cap with a speech bubble
  'ghost-tutor': (u) => ({
    defs: lin(u('top'), '#7282ff', '#2c3aa8') + lin(u('cap'), '#4a5bd6', '#1b2470') + lin(u('tassel'), '#ffe27a', '#e09a00') + lin(u('bubble'), '#8af5bc', '#1fa866'),
    body:
      `<path d="M27 4h14a4 4 0 014 4v8a4 4 0 01-4 4h-6l-4.5 4.5V20H27a4 4 0 01-4-4V8a4 4 0 014-4z" fill="url(#${u('bubble')})"/>` +
      '<circle cx="30" cy="12" r="1.5" fill="#fff"/><circle cx="34" cy="12" r="1.5" fill="#fff"/><circle cx="38" cy="12" r="1.5" fill="#fff"/>' +
      `<path d="M11 28v7c0 3 5.5 5 11 5s11-2 11-5v-7l-11 5z" fill="url(#${u('cap')})"/>` +
      `<path d="M3 24L22 16L41 24L22 32Z" fill="url(#${u('top')})" stroke="#1b2470" stroke-width="0.8" stroke-linejoin="round"/>` +
      `<path d="M22 24L36 27.5V35" fill="none" stroke="url(#${u('tassel')})" stroke-width="1.8" stroke-linecap="round"/>` +
      `<circle cx="36" cy="36.5" r="2.3" fill="url(#${u('tassel')})"/>` +
      '<path d="M8.5 23.5L22 18" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>',
  }),

  // Document with a magnifying lens and "A/அ"
  'form-translator': (u) => ({
    defs: lin(u('paper'), '#ffffff', '#d9cff2') + rad(u('lens'), '#d6f2ff', '#3b8fd6') + lin(u('handle'), '#ffb15c', '#c9560a'),
    body:
      `<rect x="6" y="4" width="25" height="35" rx="3" fill="url(#${u('paper')})"/>` +
      '<path d="M25 4l6 6h-4a2 2 0 01-2-2z" fill="#c6bce6"/>' +
      '<text x="9" y="19" font-family="Arial, sans-serif" font-size="10" font-weight="700" fill="#5b2fb3">A</text>' +
      '<text x="16.2" y="19" font-family="Arial, sans-serif" font-size="9" font-weight="700" fill="#7d6bb0">/</text>' +
      '<text x="19" y="19" font-family="Nirmala UI, Latha, Noto Sans Tamil, sans-serif" font-size="9" font-weight="700" fill="#c9560a">அ</text>' +
      '<path d="M10 25h13M10 29.5h9" stroke="#a99bd6" stroke-width="1.8" stroke-linecap="round"/>' +
      `<path d="M37.5 36.5l6 6" stroke="url(#${u('handle')})" stroke-width="4.5" stroke-linecap="round"/>` +
      `<circle cx="32" cy="31" r="8" fill="url(#${u('lens')})" stroke="#2a1648" stroke-width="2.2"/>` +
      '<ellipse cx="29.5" cy="28.3" rx="2.6" ry="1.7" fill="#fff" opacity="0.75"/>',
  }),

  // Brain with sparkles
  'ghost-echo': (u) => ({
    defs: rad(u('brain'), '#ffd0e8', '#e0569b'),
    body:
      `<path d="M23 9c-5-3-12 0-12 6-4 1-5 7-2 10-2 4 1 9 6 9 2 3 6 3 8 1z" fill="url(#${u('brain')})"/>` +
      `<path d="M25 9c5-3 12 0 12 6 4 1 5 7 2 10 2 4-1 9-6 9-2 3-6 3-8 1z" fill="url(#${u('brain')})"/>` +
      '<path d="M15 17c3 0 4 2 4 4M14 26c3-1 6 0 6 3M33 17c-3 0-4 2-4 4M34 26c-3-1-6 0-6 3" fill="none" stroke="#b8306f" stroke-width="1.6" stroke-linecap="round"/>' +
      '<ellipse cx="16" cy="12.5" rx="3.4" ry="1.9" fill="#fff" opacity="0.6"/>' +
      sparkle(41, 7, 5, '#ffd23f') +
      sparkle(6, 8, 3.5, '#fff3a8') +
      sparkle(42.5, 35, 3, '#fff3a8'),
  }),

  // Star sticker with a peeled corner
  'sticker-book': (u) => ({
    defs: rad(u('star'), '#fff6b8', '#ffad00') + lin(u('peel'), '#ffffff', '#cfc6e8'),
    body:
      `<path d="M24 7L28.4 18.9L41.1 19.4L31.1 27.3L34.6 39.6L24 32.5L13.4 39.6L16.9 27.3L6.9 19.4L19.6 18.9Z" fill="url(#${u('star')})" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>` +
      `<path d="M34.6 39.6L33.4 34.2L37.8 36.6Z" fill="url(#${u('peel')})" stroke="#b8acd9" stroke-width="0.6" stroke-linejoin="round"/>` +
      '<ellipse cx="19.5" cy="19.5" rx="3" ry="1.8" fill="#fff" opacity="0.7"/>' +
      sparkle(41, 8, 3.5, '#fff3a8'),
  }),

  // Folder with a lock
  'my-documents': (u) => ({
    defs: lin(u('back'), '#4fa3ff', '#1f5fc9') + lin(u('front'), '#8ccaff', '#2f78e0') + lin(u('lock'), '#ffe27a', '#d99a00') + lin(u('shackle'), '#eef0f6', '#8b93a8'),
    body:
      `<path d="M5 12a3 3 0 013-3h9l3 3h15a3 3 0 013 3v20H5z" fill="url(#${u('back')})"/>` +
      `<path d="M4 18h37a2 2 0 012 2l-2 17a3 3 0 01-3 3H7a3 3 0 01-3-3z" fill="url(#${u('front')})"/>` +
      '<path d="M7 20.5h20" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>' +
      `<path d="M30.5 30v-3a4 4 0 018 0v3" fill="none" stroke="url(#${u('shackle')})" stroke-width="2.6"/>` +
      `<rect x="28" y="29" width="13" height="11" rx="2.2" fill="url(#${u('lock')})" stroke="#9a6a00" stroke-width="0.8"/>` +
      '<circle cx="34.5" cy="33.5" r="1.5" fill="#6b4a00"/><rect x="33.9" y="33.5" width="1.2" height="3.2" rx="0.6" fill="#6b4a00"/>' +
      '<path d="M29.5 30.5h4" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity="0.6"/>',
  }),

  // Notepad with a microphone
  'voice-notes': (u) => ({
    defs: lin(u('pad'), '#fff6b8', '#ffd24a') + lin(u('head'), '#ff9a50', '#d85f00') + lin(u('mic'), '#7fdcff', '#1f7ac9'),
    body:
      `<rect x="6" y="8" width="26" height="34" rx="3" fill="url(#${u('pad')})"/>` +
      `<path d="M6 11a3 3 0 013-3h20a3 3 0 013 3v4H6z" fill="url(#${u('head')})"/>` +
      '<g fill="#fff" stroke="#8a5424" stroke-width="0.9"><circle cx="11" cy="8" r="1.7"/><circle cx="16.5" cy="8" r="1.7"/><circle cx="22" cy="8" r="1.7"/><circle cx="27.5" cy="8" r="1.7"/></g>' +
      '<path d="M10 21h16M10 26h16M10 31h10" stroke="#c9a23a" stroke-width="1.7" stroke-linecap="round"/>' +
      microphone(`url(#${u('mic')})`, '#1f7ac9'),
  }),

  // Open book with a cat
  'picture-book': (u) => ({
    defs: lin(u('cover'), '#ff9a50', '#c9560a') + lin(u('page'), '#ffffff', '#e1d8f6') + rad(u('cat'), '#ffd08f', '#f08a1c'),
    body:
      `<path d="M2.5 13L24 16L45.5 13V39L24 42L2.5 39Z" fill="url(#${u('cover')})"/>` +
      `<path d="M5 11c6-1 13 0 18 3v25c-5-3-12-4-18-3z" fill="url(#${u('page')})"/>` +
      `<path d="M43 11c-6-1-13 0-18 3v25c5-3 12-4 18-3z" fill="url(#${u('page')})"/>` +
      '<path d="M24 14v25" stroke="#bfb2e3" stroke-width="1.2"/>' +
      `<path d="M9.3 21l1.2-5.6 4 3.3zM18.7 21l-1.2-5.6-4 3.3z" fill="url(#${u('cat')})"/>` +
      `<circle cx="14" cy="24.5" r="5.6" fill="url(#${u('cat')})"/>` +
      '<circle cx="11.8" cy="24" r="0.95" fill="#2a1648"/><circle cx="16.2" cy="24" r="0.95" fill="#2a1648"/>' +
      '<path d="M13.2 26.2h1.6l-0.8 0.9z" fill="#e0569b"/>' +
      '<ellipse cx="12" cy="21.8" rx="1.6" ry="0.9" fill="#fff" opacity="0.6"/>' +
      '<path d="M28 19h11M28 23.5h11M28 28h8" stroke="#a99bd6" stroke-width="1.6" stroke-linecap="round"/>',
  }),

  // Pumpkin with + and =
  'pumpkin-math': (u) => ({
    defs: rad(u('pumpkin'), '#ffbf6e', '#e0600a') + lin(u('stem'), '#79d964', '#2f7a22'),
    body:
      `<g fill="url(#${u('pumpkin')})" stroke="#b84a00" stroke-width="1"><ellipse cx="15.5" cy="29" rx="9.5" ry="12"/><ellipse cx="32.5" cy="29" rx="9.5" ry="12"/><ellipse cx="24" cy="29" rx="9" ry="13.5"/></g>` +
      `<path d="M23 16c0-4 1-7 4-9l2 2c-2 2-3 4-3 7z" fill="url(#${u('stem')})"/>` +
      '<path d="M11.5 29h6M14.5 26v6M29.5 27h6M29.5 31h6" stroke="#4a1a00" stroke-width="2.4" stroke-linecap="round"/>' +
      '<ellipse cx="20.5" cy="22" rx="2.6" ry="4.2" fill="#fff" opacity="0.45"/>',
  }),

  // Storybook with a moon
  'story-time': (u) => ({
    defs: lin(u('cover'), '#9a72ff', '#4a1f9e') + rad(u('moon'), '#fff6c2', '#ffc21a'),
    body:
      '<rect x="11" y="8" width="29" height="34" rx="3" fill="#efe9ff"/>' +
      `<rect x="8" y="5.5" width="29" height="34" rx="3" fill="url(#${u('cover')})"/>` +
      '<rect x="8" y="5.5" width="5" height="34" rx="2" fill="#3a1680"/>' +
      `<path d="M27.5 12a8.5 8.5 0 106.5 14 7 7 0 11-6.5-14z" fill="url(#${u('moon')})"/>` +
      sparkle(19, 14, 2.6, '#fff3b0') +
      sparkle(32, 31.5, 1.8, '#fff3b0') +
      '<rect x="16" y="33" width="15" height="2.6" rx="1.3" fill="#fff" opacity="0.5"/>' +
      '<rect x="14.5" y="8" width="1.8" height="29" rx="0.9" fill="#fff" opacity="0.25"/>',
  }),

  // Two speech bubbles with A and அ
  'voice-translator': (u) => ({
    defs: lin(u('left'), '#ffb066', '#e0600a') + lin(u('right'), '#6fe3d6', '#138f86'),
    body:
      `<path d="M8 5h19a4 4 0 014 4v11a4 4 0 01-4 4H15l-6 5v-5H8a4 4 0 01-4-4V9a4 4 0 014-4z" fill="url(#${u('left')})"/>` +
      '<path d="M7 8.5h12" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.55"/>' +
      '<text x="12" y="20.5" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="#3a1400">A</text>' +
      `<path d="M21 18h19a4 4 0 014 4v11a4 4 0 01-4 4h-1v5l-6-5H21a4 4 0 01-4-4V22a4 4 0 014-4z" fill="url(#${u('right')})" stroke="#0b4d4d" stroke-width="0.8"/>` +
      '<path d="M20.5 21.5h14" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>' +
      '<text x="25" y="33" font-family="Nirmala UI, Latha, Noto Sans Tamil, sans-serif" font-size="11" font-weight="700" fill="#06302e">அ</text>',
  }),

  // A smiling ghost with a speech bubble that holds a star
  'talk-learn': (u) => ({
    defs: lin(u('bubble'), '#ffb066', '#d85f00') + rad(u('ghost'), '#ffffff', '#cbbdf0') + rad(u('star'), '#fff6b8', '#ffad00'),
    body:
      `<path d="M22 4H40a5 5 0 015 5V18a5 5 0 01-5 5H31L25 28V23H22a5 5 0 01-5-5V9a5 5 0 015-5z" fill="url(#${u('bubble')})" stroke="#8a3a00" stroke-width="0.8" stroke-linejoin="round"/>` +
      '<path d="M20 7h14" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>' +
      `<path d="M31 7.6L32.53 11.7L36.9 11.88L33.47 14.6L34.64 18.82L31 16.4L27.36 18.82L28.53 14.6L25.1 11.88L29.47 11.7Z" fill="url(#${u('star')})" stroke="#9a6a00" stroke-width="0.6" stroke-linejoin="round"/>` +
      `<path d="M3 44V32C3 25 8 20 14 20S25 25 25 32V44L21.5 41L18 44L14.5 41L11 44L7.5 41Z" fill="url(#${u('ghost')})" stroke="#a99bd6" stroke-width="0.8" stroke-linejoin="round"/>` +
      '<circle cx="9.5" cy="31" r="1.9" fill="#2a1648"/><circle cx="18.5" cy="31" r="1.9" fill="#2a1648"/>' +
      '<path d="M10 36Q14 39.5 18 36" fill="none" stroke="#2a1648" stroke-width="1.8" stroke-linecap="round"/>' +
      '<ellipse cx="8" cy="25.5" rx="1.6" ry="3" fill="#fff" opacity="0.85"/>',
  }),

  // A kolam: a square of glowing dots with one curving line through them, and a green start dot
  'kolam-puzzle': (u) => ({
    defs: lin(u('tile'), '#7a4ad6', '#3a1680') + lin(u('line'), '#ffd27a', '#ff7a1a') + rad(u('start'), '#e9ffd2', '#3fbf1f'),
    body:
      `<rect x="5" y="5" width="38" height="38" rx="9" fill="url(#${u('tile')})"/>` +
      '<path d="M9 9h30" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity="0.35"/>' +
      `<path d="M14 14H34Q37 14 37 17V21Q37 24 34 24H14Q11 24 11 27V31Q11 34 14 34H34" fill="none" stroke="url(#${u('line')})" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` +
      '<g fill="#f6f3ff"><circle cx="24" cy="14" r="1.9"/><circle cx="34" cy="14" r="1.9"/><circle cx="14" cy="24" r="1.9"/><circle cx="24" cy="24" r="1.9"/><circle cx="34" cy="24" r="1.9"/><circle cx="14" cy="34" r="1.9"/><circle cx="24" cy="34" r="1.9"/><circle cx="34" cy="34" r="1.9"/></g>' +
      `<circle cx="14" cy="14" r="3.4" fill="url(#${u('start')})" stroke="#1f7a1f" stroke-width="0.8"/>` +
      '<ellipse cx="13" cy="12.8" rx="1.2" ry="0.8" fill="#fff" opacity="0.8"/>' +
      sparkle(40, 40, 3, '#fff3a8'),
  }),

  // Lotus with a timer ring
  'calm-time': (u) => ({
    defs: lin(u('ring'), '#8af5e6', '#1fa8a0') + rad(u('petal'), '#ffd6ec', '#e0569b') + rad(u('petal2'), '#ffeaf5', '#f07ab8'),
    body:
      '<circle cx="24" cy="24" r="19" fill="none" stroke="#2a1648" stroke-width="4" opacity="0.35"/>' +
      `<circle cx="24" cy="24" r="19" fill="none" stroke="url(#${u('ring')})" stroke-width="4" stroke-dasharray="90 30" stroke-linecap="round" transform="rotate(-90 24 24)"/>` +
      '<circle cx="24" cy="5" r="2.4" fill="#fff"/>' +
      `<path d="M24 34c-8 0-13-5-14-10 5 0 10 2 14 10zM24 34c8 0 13-5 14-10-5 0-10 2-14 10z" fill="url(#${u('petal2')})"/>` +
      `<path d="M24 34c-5-2-8-7-7-13 4 2 7 7 7 13zM24 34c5-2 8-7 7-13-4 2-7 7-7 13z" fill="url(#${u('petal')})"/>` +
      `<path d="M24 34c-3-3-4-8 0-14 4 6 3 11 0 14z" fill="url(#${u('petal2')})"/>` +
      '<ellipse cx="24" cy="35" rx="9" ry="1.8" fill="#1fa866"/>' +
      '<ellipse cx="23" cy="25" rx="0.9" ry="2.6" fill="#fff" opacity="0.75"/>',
  }),
};

/**
 * The SVG text of an icon, or '' for an unknown id. `direction: ltr` keeps the "A/அ" letters in
 * place on right-to-left pages.
 * @param {string} id one of APP_ICON_IDS
 */
export function appIconSvg(id) {
  const make = ICONS[id];
  if (!make) return '';
  counter += 1;
  const prefix = `pvk-icon-${counter}`;
  const { defs, body } = make((name) => `${prefix}-${name}`);
  return `<svg class="app-icon-svg" viewBox="0 0 48 48" direction="ltr" aria-hidden="true" focusable="false"><defs>${defs}</defs>${SHADOW}${body}</svg>`;
}

/**
 * An icon element: <span class="app-icon-3d" aria-hidden="true"><svg…></span>.
 * @param {string} id one of APP_ICON_IDS
 */
export function createAppIcon(id) {
  const span = document.createElement('span');
  span.className = 'app-icon-3d';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = appIconSvg(id); // built only from the constants above
  return span;
}
