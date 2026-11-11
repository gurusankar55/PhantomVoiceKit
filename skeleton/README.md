# Skeleton: build a new voice app

The `skeleton/` folder holds every shared module. Apps import these files by
absolute path (for example `/skeleton/theme.css`). Never copy skeleton code
into an app folder.

## Create a new voice app

1. **Create a folder under `apps/`.**
   For example `apps/my-app/` with `index.html`, `app.js` and `style.css`.

2. **Add an HTML entry point.**
   Load the theme and your own files with absolute paths. Import the skeleton
   modules you need from your `app.js`.

   ```html
   <link rel="stylesheet" href="/skeleton/theme.css" />
   <link rel="stylesheet" href="/apps/my-app/style.css" />
   <header id="app-header"></header>
   <main><!-- your screens --></main>
   <script type="module" src="/apps/my-app/app.js"></script>
   ```

   ```js
   // apps/my-app/app.js
   import { initI18n } from '/skeleton/i18n.js';
   import { createNavMenu } from '/skeleton/nav-menu.js';
   import { createLanguageDropdown } from '/skeleton/language-dropdown.js';
   import { createSpeechInput } from '/skeleton/speech-input.js';
   import { createSpeechOutput } from '/skeleton/speech-output.js';
   ```

3. **Call the server through `/skeleton/api-client.js`.**
   Import the functions you need (`translate`, `extractFields`, `lesson`,
   `evaluate`). If your app needs a new AI feature:
   - Add a route file in `server/routes/` that exports a router factory
     taking `callGemini`:

     ```js
     import { Router } from 'express';

     export function createMyRouter(callGemini) {
       const router = Router();
       router.post('/', async (req, res) => {
         // validate input, call callGemini({ prompt }), map errors to 400/429/502/504
       });
       return router;
     }
     ```

   - Import it in `server/index.js` and mount it with the real `callGemini`:

     ```js
     app.use('/api/my-feature', createMyRouter(callGemini));
     ```

   - Add a matching function to `skeleton/api-client.js` (it uses a shared
     `postJson` helper with a timeout).
   - Tests pass a fake `callGemini` directly to the factory. No mocking needed.

4. **Add a button on `index.html`** linking to the new app, and a link in the
   drawer inside `skeleton/nav-menu.js`:

   ```html
   <a class="btn btn--large" href="/apps/my-app/index.html">
     <span data-i18n="home.myApp">My App</span>
   </a>
   ```

   Add any new `data-i18n` keys to `skeleton/locales/en.json` and the other
   19 locale files (every file must have the same keys).

## Module reference

### `api-client.js`
All functions return the server's JSON, or `{ error: '<code>' }` on failure
(`timeout`, `network_error`, `bad_response`, `http_<status>` or a server code).
No API key is ever sent from the browser.
- `translate({ text, targetLang })` - translate text (5 s timeout).
- `extractFields({ fileBase64, mimeType, lang })` - read form fields from a PDF or image (35 s).
- `lesson({ topic, lang })` - get a lesson with segments and quiz questions (25 s).
- `evaluate({ topic, question, answer, lang })` - get feedback on a quiz answer (10 s).

### `dual-display.js`
- `renderDualDisplay(containerEl, { heardText, englishMeaning })` - shows what was heard and its English meaning. Hides the container if `heardText` is empty; shows a note if the English meaning is missing.

### `i18n.js`
- `SUPPORTED_LOCALE_CODES` - the 20 language codes that have a locale file.
- `RTL_CODES` - right-to-left language codes (`ar`, `ur`).
- `initI18n()` - load English plus the saved language and apply translations.
- `setLocale(bcp47)` - switch language; updates `<html lang>` and `dir`, re-translates the page, notifies listeners.
- `onLocaleChange(callback)` - listen for language changes; returns a function that removes the listener.
- `getLocale()` - copy of the current locale state.
- `isRtl()` - true when the current language is right-to-left.
- `t(key, params)` - look up a string (current language, then English, then the key); replaces `{name}` placeholders.
- `applyTranslations(root)` - translate `data-i18n`, `data-i18n-attr` and `data-i18n-params` inside `root`.
- `setI18nText(el, key, params)` - mark an element's text as translated so it updates on language change.
- `setI18nAttr(el, attr, key)` - same, for one attribute (`aria-label`, `placeholder`, `title`).
- `clearI18n(el)` - stop translating an element and empty it.

### `language-dropdown.js`
- `LANGUAGES` - frozen list of the 20 languages (`label`, `bcp47`, `native`).
- `createLanguageDropdown(containerEl, { onChange })` - render the language `<select>`; saves the choice in `sessionStorage`, calls `setLocale`, then `onChange({ label, bcp47 })`.
- `getCurrentLanguage()` - returns `{ label, bcp47 }` for the chosen language.

### `nav-menu.js`
- `createNavMenu(headerEl, { current, showBack, onBack, getLeaveMessage, onLeave })` - build the header (hamburger drawer, Back button, language slot). Returns `{ languageEl, setBackVisible(visible), closeMenu() }`.
- `createScreenHistory(firstScreen)` - track in-app screens for Back. Returns `{ visit(name), back(), current(), canGoBack() }`.

### `speech-input.js`
- `createSpeechInput({ lang, onResult, onError })` - wrap browser speech recognition. Returns `{ supported: true, start, stop }`, or `{ supported: false }` when the browser has no support. `onError` gets `{ inactivity: true }`, `{ fallbackOnly: true }` or `{ error }`.

### `speech-output.js`
- `createSpeechOutput({ lang })` - wrap browser speech synthesis. Returns `{ speak(text, { onStart, onEnd, onError }), stop() }`.

### `speech-output-utils.js`
- `selectVoice(voices, bcp47)` - pure; pick the best voice (exact match, then language prefix; prefers "Natural", then "Online"); `null` if none.

### `text-fallback.js`
- `createTextFallback(containerEl, { onSubmit, onError })` - render a text box and submit button; calls `onSubmit(text)` or `onError('empty')`.

### `text-fallback-utils.js`
- `validateText(value)` - pure; returns `'empty'` or `'ok'`.
- `cleanAnswer(text)` - pure; trims text and removes trailing punctuation.

### `voice-commands.js`
- `normalize(text)` - lower-case, remove punctuation, collapse spaces.
- `parseWords(str)` - split a `"yes|ok"` locale string into a clean word list.
- `matchCommand(text, words)` - returns `'yes'`, `'redo'` or `null` (`words` is `{ yes: [], redo: [] }`).

### `theme.css`
Halloween theme: colour variables, large touch targets, mobile-first layout,
navigation styles and right-to-left support.

### `locales/`
`en.json` plus 19 other `<code>.json` files with identical keys.
