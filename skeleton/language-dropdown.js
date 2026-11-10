// language-dropdown.js
// Renders a <select> with the 12 supported languages and keeps the
// user's choice in sessionStorage so every page can read it.

// Canonical list from design.md (Language-to-BCP47 Map).
const LANGUAGES = [
  { label: 'English', bcp47: 'en-US' },
  { label: 'Tamil', bcp47: 'ta-IN' },
  { label: 'Hindi', bcp47: 'hi-IN' },
  { label: 'Telugu', bcp47: 'te-IN' },
  { label: 'Kannada', bcp47: 'kn-IN' },
  { label: 'Malayalam', bcp47: 'ml-IN' },
  { label: 'Korean', bcp47: 'ko-KR' },
  { label: 'Chinese', bcp47: 'zh-CN' },
  { label: 'Japanese', bcp47: 'ja-JP' },
  { label: 'Spanish', bcp47: 'es-ES' },
  { label: 'French', bcp47: 'fr-FR' },
  { label: 'Arabic', bcp47: 'ar-SA' },
];

const DEFAULT_LANGUAGE = LANGUAGES[0]; // English / en-US

// The select element created by createLanguageDropdown (if any).
let activeSelect = null;

// Find a language by its BCP-47 code. Returns the default if not found.
function findLanguage(bcp47) {
  return LANGUAGES.find((lang) => lang.bcp47 === bcp47) || DEFAULT_LANGUAGE;
}

// Safely read the saved BCP-47 code (sessionStorage can be unavailable).
function readStoredCode() {
  try {
    return sessionStorage.getItem('chosenLang');
  } catch (err) {
    return null;
  }
}

// Safely save the chosen language.
function saveLanguage(lang) {
  try {
    sessionStorage.setItem('chosenLang', lang.bcp47);
    sessionStorage.setItem('chosenLangLabel', lang.label);
  } catch (err) {
    // Ignore: the app still works, the choice just is not remembered.
  }
}

// Returns { label, bcp47 } for the current language.
// Uses the on-screen select if there is one, otherwise sessionStorage.
export function getCurrentLanguage() {
  if (activeSelect) {
    return findLanguage(activeSelect.value);
  }
  return findLanguage(readStoredCode());
}

// Builds the dropdown inside containerEl.
// onChange({ label, bcp47 }) is called whenever the user picks a language.
export function createLanguageDropdown(containerEl, { onChange } = {}) {
  const current = findLanguage(readStoredCode());

  // Unique id so the <label> can point at the <select>.
  const selectId = 'language-select-' + Math.random().toString(36).slice(2, 8);

  const label = document.createElement('label');
  label.htmlFor = selectId;
  label.className = 'language-label';
  label.textContent = 'Language';

  const select = document.createElement('select');
  select.id = selectId;
  select.className = 'language-select';

  for (const lang of LANGUAGES) {
    const option = document.createElement('option');
    option.value = lang.bcp47;
    option.textContent = lang.label;
    option.selected = lang.bcp47 === current.bcp47;
    select.appendChild(option);
  }

  select.addEventListener('change', () => {
    const chosen = findLanguage(select.value);
    saveLanguage(chosen);
    if (typeof onChange === 'function') {
      onChange({ label: chosen.label, bcp47: chosen.bcp47 });
    }
  });

  containerEl.innerHTML = '';
  containerEl.appendChild(label);
  containerEl.appendChild(select);
  activeSelect = select;

  // Make sure sessionStorage always holds a value after init.
  saveLanguage(current);
}
