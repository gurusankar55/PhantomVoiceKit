// hiddenHelpers.test.js
// No visually hidden helper (.visually-hidden, .pvk-sr-only, .file-input-hidden, the header's
// language label) may be wider or taller than 1 px. A small CSS cascade (specificity, order,
// !important, border-box sizing) works out the real size of every helper element in every app.
// The bug it guards against: input[type="file"] { width: 100%; padding; border; min-height } beat
// .file-input-hidden, so the "hidden" file input was 371 px wide and the page scrolled sideways.
// Static check of the CSS and HTML files: no browser.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const read = (file) => readFileSync(new URL(file, ROOT), 'utf8');
const APPS = readdirSync(new URL('apps/', ROOT), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const HELPERS = ['visually-hidden', 'pvk-sr-only', 'file-input-hidden', 'language-label'];

// ---------- a small CSS cascade ----------

// All rules of a style sheet, in order: { selectors: [...], decls: [{ prop, value, important }] }.
function parseRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = m[1].trim();
    if (head.startsWith('@') || /^(from|to|\d+%)/.test(head)) continue; // keyframe steps
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const at = d.indexOf(':');
      const value = d.slice(at + 1).trim();
      return { prop: d.slice(0, at).trim().toLowerCase(), value: value.replace(/\s*!important$/, ''), important: /!important$/.test(value) };
    });
    rules.push({ selectors: head.split(',').map((s) => s.trim()).filter(Boolean), decls });
  }
  return rules;
}

// Specificity [ids, classes + attributes + pseudo-classes, elements] of one selector.
function specificity(selector) {
  const s = selector.replace(/::?(before|after|placeholder|marker)\b/g, '').replace(/:(not|is|where|lang)\(([^)]*)\)/g, (_, fn, inner) => (fn === 'where' ? '' : fn === 'lang' ? ':x' : ` ${inner}`));
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) ?? []).length;
  const elements = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return [ids, classes, elements];
}

// Does the last compound of `selector` match the element? (Ancestors are assumed to match: that
// is the safe side, every rule that could reach the element is counted.)
function matches(selector, el) {
  if (/::?(before|after|placeholder|marker)/.test(selector)) return false;
  const last = selector.split(/\s*[\s>+~]\s*/).filter(Boolean).pop() ?? '';
  const compound = last.replace(/:(hover|focus|focus-visible|focus-within|active|disabled|checked|lang\([^)]*\)|not\([^)]*\)|first-child|last-child|empty)/g, '');
  if (compound === '' || compound === '*') return compound === '*';
  const tag = /^[a-z][\w-]*/i.exec(compound)?.[0];
  if (tag && tag.toLowerCase() !== el.tag) return false;
  for (const cls of compound.match(/\.[\w-]+/g) ?? []) if (!el.classes.includes(cls.slice(1))) return false;
  for (const id of compound.match(/#[\w-]+/g) ?? []) if (el.id !== id.slice(1)) return false;
  for (const attr of compound.match(/\[[^\]]+\]/g) ?? []) {
    const [, name, value] = /^\[([\w-]+)(?:[~|^$*]?="?([^"\]]*)"?)?\]$/.exec(attr) ?? [];
    if (name === 'type' && value !== undefined && el.type !== value) return false;
    if (name === 'hidden' || name === 'aria-pressed' || name === 'aria-disabled' || name === 'data-side') return false;
  }
  return Boolean(tag) || /[.#[]/.test(compound);
}

const LONGHANDS = {
  width: ['width'], 'min-width': ['min-width'], 'max-width': ['max-width'],
  height: ['height'], 'min-height': ['min-height'], 'max-height': ['max-height'],
  'padding-left': ['padding', 'padding-inline', 'padding-left', 'padding-inline-start', 'padding-inline-end'],
  'padding-right': ['padding', 'padding-inline', 'padding-right', 'padding-inline-start', 'padding-inline-end'],
  'padding-top': ['padding', 'padding-block', 'padding-top', 'padding-block-start'],
  'padding-bottom': ['padding', 'padding-block', 'padding-bottom', 'padding-block-end'],
  'border-left': ['border', 'border-width', 'border-inline', 'border-left', 'border-left-width', 'border-inline-start', 'border-inline-end', 'border-inline-width'],
  'border-right': ['border', 'border-width', 'border-inline', 'border-right', 'border-right-width', 'border-inline-start', 'border-inline-end', 'border-inline-width'],
  'border-top': ['border', 'border-width', 'border-top', 'border-top-width', 'border-block', 'border-block-start'],
  'border-bottom': ['border', 'border-width', 'border-bottom', 'border-bottom-width', 'border-block', 'border-block-end'],
};

// The winning value of a longhand for the element: !important first, then specificity, then order.
function resolve(rules, el, longhand) {
  let best = null;
  rules.forEach((rule, order) => {
    for (const selector of rule.selectors) {
      if (!matches(selector, el)) continue;
      const spec = specificity(selector);
      for (const decl of rule.decls) {
        if (!LONGHANDS[longhand].includes(decl.prop)) continue;
        const rank = [decl.important ? 1 : 0, ...spec, order];
        if (!best || compare(rank, best.rank) > 0) best = { rank, decl };
      }
    }
  });
  return best?.decl ?? null;
}
function compare(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// A length in px (large text mode: 1rem = 20 px). Unknown or relative sizes are Infinity.
function px(value) {
  const v = String(value ?? '').trim();
  if (v === '' || v === '0' || v === 'none' || v === '0px') return 0;
  const m = /^(-?[\d.]+)(px|rem|em)$/.exec(v);
  if (m) return Number(m[1]) * (m[2] === 'px' ? 1 : 20);
  if (v === 'var(--touch-min)') return 55;
  return Infinity; // 100%, auto, calc(...), fit-content: not a tiny fixed size
}
// The width of one side of a border shorthand ("2px solid x" -> 2, "0" -> 0, "none" -> 0).
function borderPx(decl) {
  if (!decl) return 0;
  const v = decl.value.trim();
  if (v === '0' || v === 'none' || /^0\s/.test(v)) return 0;
  const length = /(-?[\d.]+(px|rem|em))/.exec(v)?.[1];
  return length ? px(length) : /thin/.test(v) ? 1 : /medium/.test(v) ? 3 : /thick/.test(v) ? 5 : 3;
}
// One side of a padding shorthand ("0.6rem 0.75rem" -> left/right 0.75rem).
function paddingPx(decl, side) {
  if (!decl) return 0;
  const parts = decl.value.trim().split(/\s+/);
  if (decl.prop === 'padding') {
    const [top, right = top, bottom = top, left = right] = parts;
    return px({ top, right, bottom, left }[side]);
  }
  if (decl.prop === 'padding-inline' || decl.prop === 'padding-block') return px(parts[0]);
  return px(parts[0]);
}

/** The real width and height of an element (box-sizing: border-box, as in theme.css). */
function boxSize(rules, el) {
  const v = (prop) => resolve(rules, el, prop);
  const size = (dim, minDim, maxDim, a, b, pa, pb) => {
    const own = v(dim) ? px(v(dim).value) : Infinity; // auto: as wide as its content or its box
    const min = v(minDim) ? px(v(minDim).value) : 0;
    const max = v(maxDim) ? px(v(maxDim).value) : Infinity;
    const box = paddingPx(v(pa), pa.split('-')[1]) + paddingPx(v(pb), pb.split('-')[1]) + borderPx(v(a)) + borderPx(v(b));
    // max-width beats width, min-width beats max-width, and the padding + border always fit.
    return Math.max(Math.min(own, max), min, box);
  };
  return {
    width: size('width', 'min-width', 'max-width', 'border-left', 'border-right', 'padding-left', 'padding-right'),
    height: size('height', 'min-height', 'max-height', 'border-top', 'border-bottom', 'padding-top', 'padding-bottom'),
  };
}

// ---------- the helper elements of every page ----------

function helpersIn(html) {
  const found = [];
  for (const m of html.matchAll(/<(\w+)([^>]*)>/g)) {
    const attrs = m[2];
    const classes = /\sclass="([^"]*)"/.exec(attrs)?.[1].split(/\s+/) ?? [];
    if (!classes.some((c) => HELPERS.includes(c))) continue;
    found.push({ tag: m[1].toLowerCase(), classes, id: /\sid="([^"]*)"/.exec(attrs)?.[1] ?? '', type: /\stype="([^"]*)"/.exec(attrs)?.[1] ?? '' });
  }
  return found;
}

// Made by JavaScript (checked below that the code really makes them).
const SCRIPTED = [
  { file: 'skeleton/celebrate.js', pattern: /liveRegion\.className = 'pvk-sr-only'/, el: { tag: 'p', classes: ['pvk-sr-only'] } },
  { file: 'skeleton/celebrate.js', pattern: /label\.className = 'pvk-sr-only'/, el: { tag: 'span', classes: ['pvk-sr-only'] } },
  { file: 'skeleton/language-dropdown.js', pattern: /label\.className = 'language-label'/, el: { tag: 'label', classes: ['language-label'] } },
  { file: 'apps/calm-time/app.js', pattern: /spoken\.className = 'visually-hidden'/, el: { tag: 'span', classes: ['visually-hidden'] } },
  // Not used yet, but a helper must stay 1 px even on a button or a text box:
  { file: null, el: { tag: 'button', classes: ['visually-hidden'] } },
  { file: null, el: { tag: 'input', classes: ['visually-hidden'], type: 'text' } },
  { file: null, el: { tag: 'select', classes: ['pvk-sr-only'] } },
];

const THEME = parseRules(read('skeleton/theme.css'));
const pages = [
  { name: 'Home', html: read('index.html'), rules: [...THEME, ...parseRules(read('index.html').split('<style>')[1]?.split('</style>')[0] ?? '')] },
  ...APPS.map((app) => ({ name: app, html: read(`apps/${app}/index.html`), rules: [...THEME, ...parseRules(read(`apps/${app}/style.css`))] })),
];

describe('visually hidden helpers are at most 1 px', () => {
  test('the file inputs of Spirit Clerk and Form Translator are found', () => {
    for (const app of ['spirit-clerk', 'form-translator']) {
      const page = pages.find((p) => p.name === app);
      assert.ok(helpersIn(page.html).some((el) => el.tag === 'input' && el.type === 'file' && el.classes.includes('file-input-hidden')), app);
    }
  });

  test('every helper element of every page is at most 1 x 1 px', () => {
    let checked = 0;
    for (const page of pages) {
      const elements = [...helpersIn(page.html), ...SCRIPTED.map((s) => ({ id: '', type: '', ...s.el }))];
      for (const el of elements) {
        const { width, height } = boxSize(page.rules, el);
        assert.ok(width <= 1 && height <= 1, `${page.name}: <${el.tag} class="${el.classes.join(' ')}"> is ${width} x ${height} px`);
        checked++;
      }
    }
    assert.ok(checked > 80, `${checked} helpers checked`);
  });

  test('the JavaScript really makes the helpers listed here', () => {
    for (const s of SCRIPTED.filter((x) => x.file)) assert.match(read(s.file), s.pattern, s.file);
  });

  test('the helpers stay focusable and readable: clipped, never display:none or visibility:hidden', () => {
    const rule = THEME.find((r) => r.selectors.includes('.file-input-hidden'));
    assert.ok(rule, 'one shared rule in theme.css');
    for (const sel of ['.visually-hidden', '.pvk-sr-only', '.nav-lang .language-label']) assert.ok(rule.selectors.includes(sel), sel);
    const props = Object.fromEntries(rule.decls.map((d) => [d.prop, d.value]));
    assert.equal(props.position, 'absolute');
    assert.equal(props['clip-path'], 'inset(50%)');
    assert.equal(props.overflow, 'hidden');
    assert.equal(props['white-space'], 'nowrap');
    assert.equal(props.margin, '-1px');
    assert.ok(!('display' in props) && !('visibility' in props));
    for (const page of pages) {
      for (const r of page.rules) {
        if (!r.selectors.some((s) => HELPERS.some((h) => s.includes(`.${h}`)))) continue;
        for (const d of r.decls) assert.ok(!(d.prop === 'display' && d.value === 'none') && d.prop !== 'visibility', `${page.name}: ${r.selectors.join(', ')}`);
      }
    }
    // The hidden file input still opens through its translated label.
    for (const app of ['spirit-clerk', 'form-translator']) assert.match(read(`apps/${app}/index.html`), /<label for="file-input" class="btn btn--secondary file-picker-button"/);
  });

  test('regression: the old rules (one class, no !important) made the file input full width', () => {
    const old = parseRules(`
      input[type="file"] { display: block; width: 100%; min-height: var(--touch-min); padding: 0.6rem 0.75rem; border: 2px solid red; }
      .file-input-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); }
    `);
    const { width, height } = boxSize(old, { tag: 'input', classes: ['file-input-hidden'], id: 'file-input', type: 'file' });
    assert.equal(width, Infinity, 'width: 100% won');
    assert.ok(height >= 55, 'min-height won');
    // The same element with today's CSS:
    const now = boxSize(pages.find((p) => p.name === 'spirit-clerk').rules, { tag: 'input', classes: ['file-input-hidden'], id: 'file-input', type: 'file' });
    assert.deepEqual(now, { width: 1, height: 1 });
  });
});
