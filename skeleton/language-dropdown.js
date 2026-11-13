// language-dropdown.js
// Renders a <select> with the 20 supported languages and remembers the user's choice in
// localStorage (language-store.js), so every tab and app opens in it.

import { setLocale, setI18nText } from './i18n.js';
import { readLanguageCode, saveLanguageCode, browserStorages } from './language-store.js';

// Canonical list from design.md (Language-to-BCP47 Map).
// label = English name, native = the language's own name.
export const LANGUAGES = Object.freeze([
  { label: 'English', bcp47: 'en-US', native: 'English' },
  { label: 'Tamil', bcp47: 'ta-IN', native: 'தமிழ்' },
  { label: 'Hindi', bcp47: 'hi-IN', native: 'हिन्दी' },
  { label: 'Telugu', bcp47: 'te-IN', native: 'తెలుగు' },
  { label: 'Kannada', bcp47: 'kn-IN', native: 'ಕನ್ನಡ' },
  { label: 'Malayalam', bcp47: 'ml-IN', native: 'മലയാളം' },
  { label: 'Korean', bcp47: 'ko-KR', native: '한국어' },
  { label: 'Chinese', bcp47: 'zh-CN', native: '中文' },
  { label: 'Japanese', bcp47: 'ja-JP', native: '日本語' },
  { label: 'Spanish', bcp47: 'es-ES', native: 'Español' },
  { label: 'French', bcp47: 'fr-FR', native: 'Français' },
  { label: 'Arabic', bcp47: 'ar-SA', native: 'العربية' },
  { label: 'Portuguese', bcp47: 'pt-BR', native: 'Português' },
  { label: 'Russian', bcp47: 'ru-RU', native: 'Русский' },
  { label: 'Bengali', bcp47: 'bn-IN', native: 'বাংলা' },
  { label: 'Urdu', bcp47: 'ur-PK', native: 'اردو' },
  { label: 'Indonesian', bcp47: 'id-ID', native: 'Bahasa Indonesia' },
  { label: 'German', bcp47: 'de-DE', native: 'Deutsch' },
  { label: 'Vietnamese', bcp47: 'vi-VN', native: 'Tiếng Việt' },
  { label: 'Turkish', bcp47: 'tr-TR', native: 'Türkçe' },
].map((lang) => Object.freeze(lang)));

const DEFAULT_LANGUAGE = LANGUAGES[0]; // English / en-US

// The select element created by createLanguageDropdown (if any).
let activeSelect = null;

// Find a language by its BCP-47 code. Returns the default if not found.
function findLanguage(bcp47) {
  return LANGUAGES.find((lang) => lang.bcp47 === bcp47) || DEFAULT_LANGUAGE;
}

// The remembered BCP-47 code (localStorage, then sessionStorage; null when none or blocked).
function readStoredCode() {
  const { local, session } = browserStorages();
  return readLanguageCode(local, session) || null;
}

// Remember the chosen language for every tab and app (if storage is blocked, the app still works).
function saveLanguage(lang) {
  const { local, session } = browserStorages();
  saveLanguageCode(lang.bcp47, local, session, lang.label);
}

// Returns { label, bcp47 } for the current language.
// Uses the on-screen select if there is one, otherwise the remembered language.
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
  setI18nText(label, 'language.label');

  const select = document.createElement('select');
  select.id = selectId;
  select.className = 'language-select';

  for (const lang of LANGUAGES) {
    const option = document.createElement('option');
    option.value = lang.bcp47;
    // English shows just "English"; others show "native (English)".
    option.textContent = lang.label === lang.native ? lang.label : `${lang.native} (${lang.label})`;
    // Tell the browser which script this option uses so it renders correctly.
    option.lang = lang.bcp47;
    option.dir = 'auto';
    option.selected = lang.bcp47 === current.bcp47;
    select.appendChild(option);
  }

  select.addEventListener('change', async () => {
    const chosen = findLanguage(select.value);
    saveLanguage(chosen);
    // Load the new strings first so apps re-render in the new language.
    await setLocale(chosen.bcp47);
    if (typeof onChange === 'function') {
      onChange({ label: chosen.label, bcp47: chosen.bcp47 });
    }
  });

  containerEl.innerHTML = '';
  containerEl.appendChild(label);
  containerEl.appendChild(select);
  activeSelect = select;

  // Make sure the storage always holds a value after init.
  saveLanguage(current);
}
