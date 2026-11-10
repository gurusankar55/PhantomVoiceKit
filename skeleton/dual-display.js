// dual-display.js
// Shows what the app heard (in the user's language) next to its English meaning.
// Only textContent is used, so user text can never inject HTML (XSS-safe).

import { setI18nText } from './i18n.js';

/**
 * Build one labeled section: a heading plus a paragraph of text.
 * @param {string} headingText - translation key, e.g. "dualDisplay.heard"
 * @param {string} bodyText - the text to show
 * @param {string} className - extra CSS class for styling
 * @returns {HTMLElement}
 */
function buildSection(headingText, bodyText, className) {
  const section = document.createElement('section');
  section.className = 'dual-display__section ' + className;

  const heading = document.createElement('h3');
  heading.className = 'dual-display__heading';
  setI18nText(heading, headingText); // headingText is a translation key

  const body = document.createElement('p');
  body.className = 'dual-display__text';
  body.textContent = bodyText; // user text: never translated

  section.appendChild(heading);
  section.appendChild(body);
  return section;
}

/**
 * Render the heard text and its English meaning inside containerEl.
 * @param {HTMLElement} containerEl - where to render
 * @param {{ heardText: string, englishMeaning?: string|null }} content
 */
export function renderDualDisplay(containerEl, { heardText, englishMeaning } = {}) {
  // Clear anything shown before.
  containerEl.textContent = '';

  // Nothing heard: hide the whole area and stop.
  if (typeof heardText !== 'string' || heardText.length === 0) {
    containerEl.hidden = true;
    return;
  }

  // There is text, so make sure the container is visible again.
  containerEl.hidden = false;

  // Section 1: the text in the user's chosen language.
  containerEl.appendChild(
    buildSection('dualDisplay.heard', heardText, 'dual-display__heard')
  );

  // Section 2: English meaning, or a note when it is not available.
  // Missing, empty or whitespace-only meaning all count as 'unavailable'.
  if (typeof englishMeaning !== 'string' || englishMeaning.trim() === '') {
    const note = document.createElement('p');
    note.className = 'dual-display__note';
    setI18nText(note, 'dualDisplay.unavailable');
    containerEl.appendChild(note);
  } else {
    containerEl.appendChild(
      buildSection('dualDisplay.english', englishMeaning, 'dual-display__english')
    );
  }
}
