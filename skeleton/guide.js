// guide.js
// "How to use": a small "▶ How to use" button under the title of every app page opens a 3 or 4
// step walkthrough. Each step highlights the real button (a bright ring), a finger taps it, and
// the step is shown and read aloud in the chosen language. Skip / Next / Done. The guide opens by
// itself once, on the first visit to each app. The steps are in guide-utils.js.
// Called by nav-menu.js, so every app gets it without changing its own code.

import { t, setI18nText, getLocale } from './i18n.js';
import { createSpeechOutput } from './speech-output.js';
import { guideSteps, hasSeen, markSeen, pickTarget, placeBubble } from './guide-utils.js';

const AUTO_OPEN_MS = 900; // let the page settle before the first automatic walkthrough

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function reducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// Shown on the page: in the layout, not hidden, with a size.
function isShown(element) {
  return element.getClientRects().length > 0 && !element.closest('[hidden]');
}

/** Add the "How to use" button for this app (and open the guide once on the first visit). */
export function setupGuide(appId) {
  const steps = guideSteps(appId);
  const title = document.querySelector('main h1');
  if (steps.length === 0 || !title || document.querySelector('.pvk-guide-button')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn--secondary pvk-guide-button';
  const icon = document.createElement('span');
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '▶';
  const label = document.createElement('span');
  setI18nText(label, 'guide.button');
  button.append(icon, label);
  button.addEventListener('click', () => openGuide(appId, button));
  title.insertAdjacentElement('afterend', button);

  if (!hasSeen(storage(), appId)) {
    setTimeout(() => {
      if (document.visibilityState === 'visible' && !document.querySelector('.pvk-guide')) openGuide(appId, button);
    }, AUTO_OPEN_MS);
  }
}

/** Open the walkthrough of an app. */
export function openGuide(appId, returnFocus = null) {
  const steps = guideSteps(appId);
  if (steps.length === 0 || document.querySelector('.pvk-guide')) return;
  markSeen(storage(), appId);

  const voice = createSpeechOutput({ lang: getLocale().bcp47 });
  let index = 0;
  let target = null;

  // ----- the layer over the page (it catches every tap, so nothing below is pressed) -----
  const layer = document.createElement('div');
  layer.className = 'pvk-guide';
  const shade = document.createElement('div'); // dims the page when nothing is highlighted
  shade.className = 'pvk-guide-shade';
  const ring = document.createElement('div'); // the highlight (its huge shadow dims the rest)
  ring.className = 'pvk-guide-ring';
  ring.setAttribute('aria-hidden', 'true');
  const finger = document.createElement('span');
  finger.className = 'pvk-guide-finger';
  finger.setAttribute('aria-hidden', 'true');
  finger.textContent = '👆';

  const bubble = document.createElement('div');
  bubble.className = 'pvk-guide-bubble';
  bubble.setAttribute('role', 'dialog');
  bubble.setAttribute('aria-modal', 'true');
  const count = document.createElement('p');
  count.className = 'pvk-guide-count';
  const text = document.createElement('p');
  text.className = 'pvk-guide-text';
  text.id = 'pvk-guide-text';
  bubble.setAttribute('aria-labelledby', text.id);
  const buttons = document.createElement('div');
  buttons.className = 'pvk-guide-buttons';
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'btn btn--secondary';
  setI18nText(skip, 'guide.skip');
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn';
  buttons.append(skip, next);
  bubble.append(count, text, buttons);
  layer.append(shade, ring, finger, bubble);
  document.body.appendChild(layer);

  // ----- placing the ring, the finger and the bubble -----
  function place() {
    const view = { width: window.innerWidth, height: window.innerHeight };
    const rect = target ? target.getBoundingClientRect() : null;
    shade.hidden = Boolean(rect);
    ring.hidden = !rect;
    finger.hidden = !rect;
    if (rect) {
      const pad = 6;
      Object.assign(ring.style, {
        top: `${rect.top - pad}px`,
        left: `${rect.left - pad}px`,
        width: `${rect.width + pad * 2}px`,
        height: `${rect.height + pad * 2}px`,
      });
      // The finger taps the middle of the button.
      Object.assign(finger.style, { top: `${rect.top + rect.height / 2}px`, left: `${rect.left + rect.width / 2}px` });
    }
    const box = bubble.getBoundingClientRect();
    const spot = placeBubble(rect, view, { width: box.width, height: box.height });
    bubble.style.top = `${spot.top}px`;
    bubble.style.left = `${spot.left}px`;
    bubble.dataset.side = spot.side;
  }

  function show() {
    const step = steps[index];
    const last = index === steps.length - 1;
    target = pickTarget(step.target, (s) => document.querySelector(s), isShown);
    setI18nText(count, 'guide.step', { n: index + 1, total: steps.length });
    setI18nText(text, step.key);
    setI18nText(next, last ? 'guide.done' : 'guide.next');
    skip.hidden = last;
    // Restart the tap animation for the new button.
    finger.classList.remove('is-tapping');
    void finger.offsetWidth;
    finger.classList.add('is-tapping');
    if (target) target.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    place();
    // Smooth scrolling moves the button: place again once it has settled.
    setTimeout(place, reducedMotion() ? 0 : 350);
    window.speechSynthesis?.cancel();
    voice.speak(t(step.key));
    next.focus();
  }

  function close() {
    window.speechSynthesis?.cancel();
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    layer.remove();
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  }

  next.addEventListener('click', () => {
    if (index < steps.length - 1) {
      index += 1;
      show();
    } else {
      close();
    }
  });
  skip.addEventListener('click', close);
  layer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      // Keep the keyboard inside the bubble.
      const items = [skip, next].filter((b) => !b.hidden);
      const i = items.indexOf(document.activeElement);
      event.preventDefault();
      items[(i + (event.shiftKey ? items.length - 1 : 1)) % items.length].focus();
    }
  });
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  show();
}
