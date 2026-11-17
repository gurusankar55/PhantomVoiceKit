// visualStyle.test.js
// The soft 3D style: buttons never break inside a word, the 3D press changes no layout, reduced
// motion stops every lift and tilt, the big 64 px buttons stay, no heavy blur, text contrast stays
// WCAG AA on the new sheen, and every menu entry and Home card has its own 3D icon.
// Static checks of the CSS and HTML files: no browser, no network, no Gemini.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { APP_ICON_IDS, appIconSvg } from '../../skeleton/app-icons.js';

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const APPS = readdirSync(new URL('../../apps/', import.meta.url), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const HOME = read('index.html');
const HOME_CSS = HOME.slice(HOME.indexOf('<style>'), HOME.indexOf('</style>'));
const THEME = read('skeleton/theme.css');
const SOURCES = [['skeleton/theme.css', THEME], ['index.html', HOME_CSS], ...APPS.map((app) => [`apps/${app}/style.css`, read(`apps/${app}/style.css`)])];

// All innermost rules { selector, body } of a CSS text (comments removed; @media rules included).
function rules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}
// The body of the rules whose selector list contains exactly `selector`.
function bodiesOf(css, selector) {
  return rules(css)
    .filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector))
    .map((r) => r.body);
}
// The CSS inside the first @media (prefers-reduced-motion: reduce) block after `from`.
function reducedMotionBlocks(css) {
  const blocks = [];
  let at = css.indexOf('prefers-reduced-motion: reduce');
  while (at >= 0) {
    let depth = 0;
    let i = css.indexOf('{', at);
    const start = i;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      if (css[i] === '}' && --depth === 0) break;
    }
    blocks.push(css.slice(start + 1, i));
    at = css.indexOf('prefers-reduced-motion: reduce', i);
  }
  return blocks.join('\n');
}
// Button-like selectors: "button", ".btn", ".story-play", ".topic-chip"... (not ".dual-display").
const BUTTONISH = /(^|[\s,.#>-])(btn|button|chip|choice|key|step|play|cell|tile|nav-link)(?![\w])/;

describe('buttons never break inside a word', () => {
  test('the shared button rule keeps words whole (Korean too)', () => {
    const [body] = bodiesOf(THEME, 'button');
    assert.ok(body, 'the .btn, button rule');
    assert.match(body, /overflow-wrap:\s*normal/);
    assert.match(body, /word-break:\s*normal/);
    assert.match(body, /hyphens:\s*manual/);
    assert.ok(bodiesOf(THEME, ':lang(ko) button').some((b) => /word-break:\s*keep-all/.test(b)));
  });

  test('menu tiles keep words whole too', () => {
    assert.ok(bodiesOf(THEME, '.nav-link').some((b) => /overflow-wrap:\s*normal/.test(b)));
  });

  test('no style anywhere lets a button-like element split a word', () => {
    for (const [file, css] of SOURCES) {
      for (const { selector, body } of rules(css)) {
        if (!BUTTONISH.test(selector)) continue;
        assert.ok(!/overflow-wrap:\s*(anywhere|break-word)|word-wrap:\s*break-word|word-break:\s*break-(all|word)|hyphens:\s*auto/.test(body), `${file}: ${selector}`);
      }
    }
  });
});

describe('raised 3D buttons', () => {
  test('every button has the 3D edge and the soft sheen', () => {
    const [body] = bodiesOf(THEME, 'button');
    assert.match(body, /box-shadow:\s*var\(--depth-btn\)/);
    assert.match(body, /background-image:\s*var\(--sheen\)/);
    assert.match(THEME, /--depth-btn:[^;]*0 4px 0/);
  });

  test('pressing moves the button down 3 px onto its edge, and nothing else changes size', () => {
    const pressed = rules(THEME).filter((r) => /:active/.test(r.selector) && /(button|\.btn)/.test(r.selector));
    assert.ok(pressed.some((r) => /translateY\(3px\)/.test(r.body) && /var\(--depth-btn-pressed\)/.test(r.body)));
    for (const [file, css] of SOURCES) {
      for (const { selector, body } of rules(css)) {
        if (!/:active/.test(selector)) continue;
        // No layout shift: never margin, padding, border width or size on press.
        assert.ok(!/(^|;|\s)(margin|padding|border-width|width|height|top|bottom)\s*:/.test(body), `${file}: ${selector}`);
      }
    }
  });

  test('buttons with a state ring keep the 3D edge as well', () => {
    for (const [app, selector] of [['ghost-tutor', '#mic-button'], ['ghost-tutor', '.listening'], ['spirit-clerk', '.listening'], ['spirit-clerk', '.option-button--chosen'], ['spirit-clerk', '.cell--selected']]) {
      const bodies = bodiesOf(read(`apps/${app}/style.css`), selector).filter((b) => /box-shadow/.test(b));
      assert.ok(bodies.length > 0 && bodies.every((b) => /var\(--depth-btn\)/.test(b)), `${app} ${selector}`);
    }
  });

  test('the big 64 px Speak / Done buttons are still 64 px', () => {
    const big = [
      ['apps/spirit-clerk/style.css', '#mic-button'], ['apps/spirit-clerk/style.css', '#done-button'],
      ['apps/calm-time/style.css', '.calm-start'], ['apps/calm-time/style.css', '.calm-row .btn'],
      ['apps/ghost-echo/style.css', '.echo-done'], ['apps/picture-book/style.css', '.book-actions .btn'],
      ['apps/pumpkin-math/style.css', '.math-speak'], ['apps/story-time/style.css', '.story-controls .btn'],
      ['apps/voice-notes/style.css', '.notes-save'], ['skeleton/theme.css', '.pvk-gift-collect'],
    ];
    for (const [file, selector] of big) {
      assert.ok(bodiesOf(read(file), selector).some((b) => /min-height:\s*64px/.test(b)), `${file} ${selector}`);
    }
  });
});

describe('panels, tiles and cards', () => {
  test('panels get layered depth but keep a flat colour behind the text', () => {
    for (const [file, selector] of [['skeleton/theme.css', '.dual-display__section'], ['apps/ghost-tutor/style.css', '.lesson-card'], ['apps/pumpkin-math/style.css', '.math-card'], ['apps/spirit-clerk/style.css', '#fill-question'], ['apps/calm-time/style.css', '.calm-item']]) {
      const body = bodiesOf(read(file), selector).join('\n');
      assert.match(body, /box-shadow:\s*var\(--depth-panel\)/, `${file} ${selector}`);
      assert.ok(!/background(-image)?:\s*[^;]*gradient/.test(body), `${file} ${selector} has no gradient behind the text`);
    }
  });

  test('text boxes stay flat (no 3D shadow on inputs and text areas)', () => {
    for (const { selector, body } of rules(THEME)) {
      if (/(^|,\s*)(textarea|input|select)\b/.test(selector)) assert.ok(!/box-shadow/.test(body), selector);
    }
  });

  test('menu tiles lift and tilt on hover / focus; the current app is pressed in', () => {
    assert.ok(bodiesOf(THEME, '.nav-link:hover').some((b) => /translateY\(-3px\)/.test(b) && /rotateX/.test(b)));
    assert.ok(bodiesOf(THEME, '.nav-link:focus-visible').length > 0);
    assert.ok(bodiesOf(THEME, '.nav-link.is-current').some((b) => /var\(--depth-tile-pressed\)/.test(b)));
  });

  test('Home cards: 3D shadow, glossy edge behind the text, tilt only through the --tilt variables', () => {
    const card = bodiesOf(HOME_CSS, '.app-card').join('\n');
    assert.match(card, /rotateX\(var\(--tilt-x, 0deg\)\)/);
    assert.match(card, /isolation:\s*isolate/);
    assert.match(bodiesOf(HOME_CSS, '.app-card::before').join(''), /z-index:\s*-1/);
    // The tilt is only for a real mouse, and never with reduced motion.
    assert.match(HOME, /pointerType !== 'mouse'/);
    assert.match(HOME, /prefers-reduced-motion: reduce/);
  });
});

describe('reduced motion and old phones', () => {
  test('with reduced motion: no lift, tilt or press movement', () => {
    const theme = reducedMotionBlocks(THEME);
    for (const selector of ['.nav-link:hover', '.nav-link:focus-visible', '.nav-link.is-current', 'button:active:not(:disabled)']) {
      assert.ok(bodiesOf(theme, selector).some((b) => /transform:\s*none/.test(b)), selector);
    }
    assert.ok(bodiesOf(theme, '.btn').some((b) => /transition:\s*none/.test(b)));
    assert.ok(bodiesOf(reducedMotionBlocks(HOME_CSS), '.app-card').some((b) => /transform:\s*none/.test(b)));
  });

  test('no blur or backdrop filter anywhere (slow on old phones)', () => {
    for (const [file, css] of SOURCES) {
      const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
      assert.ok(!/filter:\s*blur|backdrop-filter/.test(clean), file);
    }
  });
});

// ---------- Contrast (WCAG 2.x) ----------

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const blend = (top, bottom, alpha) => top.map((c, i) => Math.round(c * alpha + bottom[i] * (1 - alpha)));
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('text contrast stays WCAG AA', () => {
  // The real sheen numbers from theme.css: white at the top, black at the bottom.
  const sheen = /--sheen:[^;]*rgba\(255, 255, 255, ([\d.]+)\) 0%[^;]*rgba\(0, 0, 0, ([\d.]+)\) 100%/.exec(THEME);
  const top = Number(sheen[1]);
  const bottom = Number(sheen[2]);
  const WHITE = [255, 255, 255];
  const BLACK = [0, 0, 0];

  test('the sheen is weak (at most 10 % light, 15 % shade)', () => {
    assert.ok(top <= 0.1 && bottom <= 0.15, `${top} ${bottom}`);
  });

  test('every button colour keeps 4.5:1 at the lightest and darkest point of the sheen', () => {
    const buttons = [
      ['#1a0f2e', '#ff7a1a'], // primary: dark text on orange
      ['#1a0f2e', '#ffa24d'], // primary hover
      ['#f6f3ff', '#a34400'], // pressed / listening (--color-orange-deep)
      ['#ffffff', '#1f7a45'], // green: Done, Correct, I said it
      ['#ffffff', '#b3261e'], // red: stop recording
      ['#ffffff', '#7a3e12'], // pumpkin number keys
      ['#ffffff', '#6b1d2a'], // a wrong number key
      ['#ffffff', '#136f6f'], // Voice Translator: the other person's microphone (teal)
      ['#1a0f2e', '#9cff57'], // the "Copied" toast
      ['#f6f3ff', '#35205c'], // secondary on the surface colour
      ['#f6f3ff', '#1a0f2e'], // secondary on the page
    ];
    for (const [text, bg] of buttons) {
      const base = hex(bg);
      for (const shade of [blend(WHITE, base, top), blend(BLACK, base, bottom)]) {
        assert.ok(contrast(hex(text), shade) >= 4.5, `${text} on ${bg}: ${contrast(hex(text), shade).toFixed(2)}`);
      }
    }
  });

  test('light text is never put on the old #d85f00 orange (only 3.4:1)', () => {
    assert.match(THEME, /--color-orange-deep:\s*#a34400/);
    for (const [file, css] of SOURCES) {
      for (const { selector, body } of rules(css)) {
        const light = /(^|;|\s)color:\s*(var\(--color-ghost\)|#fff\b|#ffffff)/.test(body);
        assert.ok(!(light && /background(-color)?:\s*(var\(--color-orange-dark\)|#d85f00)/.test(body)), `${file}: ${selector}`);
      }
    }
  });

  test('menu tiles: white text on the tile, dark text on the pressed-in orange tile', () => {
    const tileTop = blend(WHITE, hex('#35205c'), 0.07);
    assert.ok(contrast(hex('#f6f3ff'), tileTop) >= 4.5);
    const current = blend(BLACK, hex('#ff7a1a'), 0.1);
    assert.ok(contrast(hex('#1a0f2e'), current) >= 4.5);
    // The small English name: at 80 % opacity it would be 4.4:1, so it is drawn at full strength.
    assert.ok(contrast(blend(hex('#1a0f2e'), current, 0.8), current) < 4.5);
    assert.ok(bodiesOf(THEME, '.nav-link.is-current .brand-sub').some((b) => /opacity:\s*1\b/.test(b)));
  });

  test('Home cards: the glossy corner keeps the text readable', () => {
    const gloss = blend(WHITE, hex('#35205c'), 0.12);
    assert.ok(contrast(hex('#f6f3ff'), gloss) >= 4.5); // white text
    assert.ok(contrast(hex('#cfc6e8'), gloss) >= 4.5); // description
    assert.ok(contrast(hex('#ff7a1a'), gloss) >= 3); // the big orange name (large text: 3:1)
  });
});

// ---------- Icons ----------

describe('one 3D icon per entry', () => {
  const NAV = read('skeleton/nav-menu.js');
  const menuIds = [...NAV.slice(NAV.indexOf('const MENU_LINKS'), NAV.indexOf('];', NAV.indexOf('const MENU_LINKS'))).matchAll(/id: '([\w-]+)'/g)].map((m) => m[1]);

  test('the 14 icons asked for: Home and every app', () => {
    assert.deepEqual([...APP_ICON_IDS].sort(), ['calm-time', 'form-translator', 'ghost-echo', 'ghost-tutor', 'home', 'my-documents', 'picture-book', 'pumpkin-math', 'spirit-clerk', 'sticker-book', 'story-time', 'talk-learn', 'voice-notes', 'voice-translator']);
  });

  test('every menu entry has its own icon and the menu uses them', () => {
    assert.equal(menuIds.length, 14);
    for (const id of menuIds) assert.ok(APP_ICON_IDS.includes(id), id);
    assert.match(NAV, /createAppIcon\(item\.id\)/);
    assert.ok(!/icon-ghost/.test(NAV), 'the plain ghost is no longer used in the menu');
  });

  test('every Home card shows the icon of the app it opens', () => {
    const cards = [...HOME.matchAll(/data-app-icon="([\w-]+)"[\s\S]*?href="\/apps\/([\w-]+)\//g)];
    assert.equal(cards.length, 13);
    for (const [, icon, app] of cards) assert.equal(icon, app);
  });

  test('icons are different, 3D (gradient, shine, shadow), safe and never the plain ghost', () => {
    const plainGhost = 'M32 4C19 4 10 14 10 27';
    const bodies = new Set();
    for (const id of APP_ICON_IDS) {
      const svg = appIconSvg(id);
      assert.match(svg, /^<svg [^>]*viewBox="0 0 48 48"/, id);
      assert.match(svg, /aria-hidden="true"/, id);
      assert.match(svg, /direction="ltr"/, id); // "A/அ" stays in place on RTL pages
      assert.match(svg, /<(linear|radial)Gradient /, id);
      assert.match(svg, /(fill|stroke)="#fff"[^>]*opacity="0\.\d+"/, id); // a soft white highlight
      assert.match(svg, /<ellipse cx="24" cy="45"[^>]*opacity="0.35"/, id); // soft shadow
      assert.ok(!/<script|\son\w+=|href|javascript:|<foreignObject|<image/i.test(svg), id);
      assert.ok(!svg.includes(plainGhost), id);
      assert.ok(!/filter/.test(svg), `${id}: no SVG filters (fast on old phones)`);
      bodies.add(svg.replace(/pvk-icon-\d+/g, ''));
    }
    assert.equal(bodies.size, APP_ICON_IDS.length);
    assert.equal(appIconSvg('nope'), '');
  });

  test('two copies of one icon never share gradient ids', () => {
    const ids = (svg) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const a = ids(appIconSvg('home'));
    const b = ids(appIconSvg('home'));
    assert.ok(a.length > 0);
    assert.ok(a.every((id) => !b.includes(id)));
    // and every url(#…) points to an id of the same icon
    const svg = appIconSvg('calm-time');
    const own = new Set(ids(svg));
    for (const m of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(own.has(m[1]), m[1]);
  });
});
