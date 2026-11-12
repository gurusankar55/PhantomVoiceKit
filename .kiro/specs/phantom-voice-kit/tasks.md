# Implementation Plan: Phantom Voice Kit

## Overview

Build the Phantom Voice Kit from the ground up: project scaffolding → Express server + Gemini proxy → shared skeleton modules → home screen → Spirit Clerk app → Ghost Tutor app → README files → automated tests → UX improvements for low-literacy users (voice commands, field help, how it works, privacy note, topic by voice). Each task creates or modifies exactly one file (or one closely related group) and wires it into the preceding steps.

## Tasks

- [x] 1. Set up project scaffold
  - [x] 1.1 Create `package.json`
    - Set `"type": "module"`, `"scripts": { "start": "node server/index.js", "test": "node --test" }`
    - Add dependencies: `express`, `@google/genai`, `dotenv`; devDependencies: `fast-check`, `supertest`
    - _Requirements: R7, R14_

  - [x] 1.2 Create `.gitignore`, `.env.example`, and `LICENSE`
    - `.gitignore`: ignore `node_modules/` and `.env`; do NOT ignore `.kiro/`
    - `.env.example`: include `GEMINI_API_KEY`, `GEMINI_MODEL`, `PORT` with placeholder values
    - `LICENSE`: standard MIT License text, copyright year 2026, author TODO
    - _Requirements: R7, R15_

- [x] 2. Implement the Express server and Gemini proxy
  - [x] 2.1 Create `server/gemini.js`
    - `import { GoogleGenAI } from '@google/genai'`; read `GEMINI_API_KEY` and `GEMINI_MODEL` from `process.env` via `dotenv`
    - Export `callGemini({ prompt, inlineParts })` async function
    - Build `contents` array: text part from `prompt` plus any `inlineParts`
    - Call `ai.models.generateContent({ model, contents, config })` where `config` includes `responseMimeType: 'application/json'` and `thinkingConfig: { thinkingBudget: 0 }`
    - Wrap SDK call in `Promise.race` with a 30-second `AbortSignal` timeout
    - Parse and return the JSON response body
    - Throw `{ code: 'timeout' }` on timeout, `{ code: 'rate_limit' }` on HTTP 429, `{ code: 'gemini_error', message }` on other errors
    - _Requirements: R7_

  - [x] 2.2 Create `server/index.js`
    - Import `express`, `path`, `dotenv/config`; create Express app
    - Configure `express.json({ limit: '15mb' })`
    - Serve home screen: `app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')))`
    - Mount static routes only for `/skeleton` and `/apps` (never expose `server/`, `.env`, etc.)
    - Import and mount all four route files under `/api`
    - Add a generic error-handling middleware that returns `{ error: 'internal_error' }` with HTTP 500 (strip stack traces)
    - Listen on `process.env.PORT ?? 3000`
    - Import the real `callGemini` from `server/gemini.js` and pass it to each router factory: e.g. `app.use('/api/translate', createTranslateRouter(callGemini))`
    - _Requirements: R7_

  - [x] 2.3 Create `server/routes/translate.js`
    - Export a factory function `createTranslateRouter(callGemini)` that accepts `callGemini` as a parameter and returns an Express Router. `server/index.js` passes the real `callGemini`; tests pass a fake function directly.
    - `POST /api/translate` accepts `{ text, targetLang }`
    - Return HTTP 400 `{ error: 'invalid_input' }` if `text` is empty or missing
    - Prompt: translate `text` to `targetLang`; preserve proper names, numbers, dates, emails, phone/postal addresses; reply `{ translation: string }`
    - Call `callGemini`; on `{ code: 'timeout' }` return HTTP 504; on `{ code: 'rate_limit' }` return HTTP 429; on other error return HTTP 502
    - _Requirements: R7, R2_

  - [x] 2.4 Create `server/routes/extract-fields.js`
    - Export a factory function `createExtractFieldsRouter(callGemini)` that accepts `callGemini` as a parameter and returns an Express Router.
    - `POST /api/extract-fields` accepts `{ fileBase64, mimeType, lang }`
    - Return HTTP 400 if `fileBase64` is empty or `mimeType` not in `['application/pdf','image/jpeg','image/png','image/webp']`
    - Pass base64 file as `inlineParts`; prompt identifies all form fields, generates friendly spoken questions in `lang`, returns `{ fields: [{ label, inputType, question }] }`
    - Same timeout / error → HTTP status mapping as translate
    - _Requirements: R7, R8, R9_

  - [x] 2.5 Create `server/routes/lesson.js`
    - Export a factory function `createLessonRouter(callGemini)` that accepts `callGemini` as a parameter and returns an Express Router.
    - `POST /api/lesson` accepts `{ topic, lang }`
    - Return HTTP 400 if `topic` is empty or whitespace-only
    - Prompt: generate lesson as exactly 4 segments, each with `segment` and `quizQuestion` in `lang`, reply `{ segments: [{ segment, quizQuestion }] }`
    - Same timeout / error → HTTP status mapping
    - _Requirements: R7, R11, R12_

  - [x] 2.6 Create `server/routes/evaluate.js`
    - Export a factory function `createEvaluateRouter(callGemini)` that accepts `callGemini` as a parameter and returns an Express Router.
    - `POST /api/evaluate` accepts `{ topic, question, answer, lang }`
    - Return HTTP 400 if `answer` is empty
    - Prompt: evaluate quiz answer for `topic`, provide brief spoken feedback in `lang`, reply `{ feedback: string }`
    - Same timeout / error → HTTP status mapping
    - _Requirements: R7, R12_

- [x] 3. Checkpoint — verify server routes
  - Start the server (`npm start`) and verify all four API routes respond with HTTP 400 on empty input using curl or a REST client.

- [x] 4. Implement skeleton modules
  - [x] 4.1 Create `skeleton/speech-output-utils.js`
    - Export pure function `selectVoice(voices, bcp47)`:
      - Step 1: collect exact-match voices (`voice.lang === bcp47`); if any, return the first whose name contains "Natural", else the first whose name contains "Online", else the first match
      - Step 2: otherwise collect language-prefix matches (`voice.lang.startsWith(bcp47.split('-')[0])`) and apply the same preference (Natural, then Online, then first)
      - Step 3: return `null`
    - _Requirements: R3, R14_

  - [x] 4.2 Create `skeleton/text-fallback-utils.js`
    - Export pure function `validateText(value)`:
      - Return `'empty'` if `value.trim()` is empty (zero characters after trim)
      - Return `'ok'` otherwise
    - _Requirements: R5, R14_

  - [x] 4.3 Create `apps/spirit-clerk/form-utils.js`
    - Export `nextRedoOrSkip(redoCount)`: return `'redo'` if `redoCount < 3`, `'skip'` if `redoCount >= 3`
    - Export `nextSilenceOrSkip(silenceCount)`: return `'reask'` if `silenceCount < 1`, `'skip'` if `silenceCount >= 1`
    - Export `pdfFilename(formName, date)`: return `'{formName}_{YYYY-MM-DD}.pdf'` where date is formatted from the `date` argument
    - _Requirements: R9, R10_

  - [x] 4.4 Create `apps/ghost-tutor/lesson-utils.js`
    - Export `computeHasMore(segmentIndex)`: return `true` if `segmentIndex < 3`, `false` if `segmentIndex === 3`
    - _Requirements: R12_

  - [x] 4.5 Create `skeleton/speech-input.js`
    - Export `createSpeechInput({ lang, onResult, onError })`; returns `{ start(), stop() }`
    - Wrap `SpeechRecognition` (or `webkitSpeechRecognition`); set `recognition.lang` to `lang` before each `start()` call
    - On a successful final result call `onResult(heardText)` with transcript
    - Start a 30-second inactivity timer on `start()`; on expiry call `stop()` and fire `onError({ inactivity: true })`
    - Track retry counter (max 3); on recognition error increment counter; after 3 failures call `onError({ fallbackOnly: true })`
    - If neither `window.SpeechRecognition` nor `window.webkitSpeechRecognition` exists, return `{ supported: false }`; callers hide the microphone button and show a short "voice input is not available in this browser" message, using Text_Fallback only
    - _Requirements: R2_

  - [x] 4.6 Create `skeleton/speech-output.js`
    - Export `createSpeechOutput({ lang })`; returns `{ speak(text, { onStart, onEnd, onError }), stop() }`
    - Import `selectVoice` from `./speech-output-utils.js`
    - On `speak()`: call `selectVoice(speechSynthesis.getVoices(), lang)`; if `null` call `onError({ audioUnavailable: true })` and return
    - If voice found: create `SpeechSynthesisUtterance`, set `.voice` and `.lang`; fire `onStart` synchronously before queueing; on utterance end fire `onEnd`; on utterance error fire `onError`
    - `stop()` calls `window.speechSynthesis.cancel()`
    - Listen for `voiceschanged` on first call to handle async voice loading
    - _Requirements: R3_

  - [x] 4.7 Create `skeleton/language-dropdown.js`
    - Export `createLanguageDropdown(containerEl, { onChange })` and `getCurrentLanguage()`
    - On init: read `sessionStorage.chosenLang`; fall back to `en-US`
    - Render a `<select>` populated with the 20 supported languages (English label + bcp47 + native name); each option text is `<native name> (<English name>)`, e.g. `தமிழ் (Tamil)`, `हिन्दी (Hindi)`, `中文 (Chinese)`
    - Languages: English, Tamil, Hindi, Telugu, Kannada, Malayalam, Korean, Chinese (zh-CN), Japanese, Spanish, French, Arabic (ar-SA), Portuguese (pt-BR), Russian (ru-RU), Bengali (bn-IN), Urdu (ur-PK), Indonesian (id-ID), German (de-DE), Vietnamese (vi-VN), Turkish (tr-TR)
    - On change: write `sessionStorage.chosenLang` and `sessionStorage.chosenLangLabel`; call `onChange({ label, bcp47 })`
    - On change also call `setLocale(bcp47)` from `./i18n.js` (see task 4.12); the `label` passed to `onChange` and stored in `chosenLangLabel` stays the English name
    - `getCurrentLanguage()` reads from the active select or `sessionStorage`
    - _Requirements: R1, R13, R17_

  - [x] 4.8 Create `skeleton/dual-display.js`
    - Export `renderDualDisplay(containerEl, { heardText, englishMeaning })`
    - If `heardText` is empty (zero characters): hide `containerEl` and return
    - If `englishMeaning` is absent or null: render only the `heardText` section with a note that English meaning is unavailable
    - Otherwise: render two labeled sections — one for Chosen_Language text, one for English meaning
    - _Requirements: R4_

  - [x] 4.9 Create `skeleton/text-fallback.js`
    - Export `createTextFallback(containerEl, { onSubmit, onError })`
    - Render a `<textarea>` (max 500 chars) and a submit button inside `containerEl`
    - Import `validateText` from `./text-fallback-utils.js`
    - On submit (button click or Enter key): call `validateText(value)`; if `'empty'` call `onError('empty')` and show inline validation message; if `'ok'` call `onSubmit(text)`
    - _Requirements: R5_

  - [x] 4.10 Create `skeleton/theme.css`
    - Define CSS custom properties for Halloween palette (dark purples, oranges, ghost-white)
    - Include `@font-face` or Google Fonts import with a fallback font stack
    - Ghost-themed iconography via CSS masks or inline SVG
    - Mobile-first responsive baseline: min touch targets 44×44 px; no horizontal overflow on 320–767 px widths
    - CSS fallbacks for all asset load failures (background-color instead of background-image, etc.)
    - _Requirements: R6_

  - [x] 4.11 Create `skeleton/api-client.js`
    - Export four async functions: `translate({ text, targetLang })`, `extractFields({ fileBase64, mimeType, lang })`, `lesson({ topic, lang })`, `evaluate({ topic, question, answer, lang })`
    - Each function `POST`s JSON to the corresponding `/api/*` endpoint
    - `translate` enforces a 5-second client-side timeout via `AbortSignal`; `extractFields` enforces a 35-second timeout; `lesson` enforces a 25-second timeout; `evaluate` enforces a 10-second timeout
    - On network error or non-OK response: return `{ error: '<description>' }`
    - Never include any API key in requests
    - _Requirements: R7, R2, R11, R12_

  - [x] 4.12 Create `skeleton/i18n.js`
    - Export `initI18n()`, `setLocale(bcp47)`, `onLocaleChange(callback)`, `t(key, params)`, `applyTranslations(root)`, `setI18nText(el, key, params)`, `setI18nAttr(el, attr, key)`
    - Loader: `fetch('/skeleton/locales/<code>.json')` with `<code>` = `bcp47.split('-')[0]`; cache every loaded file in a `Map`; English is always loaded and is the fallback for any missing key (then the key itself)
    - `t(key, params)` replaces `{name}` placeholders with values from `params`
    - `applyTranslations(root)` translates `data-i18n` (text), `data-i18n-attr="aria-label:key;placeholder:key"` (attributes) and optional `data-i18n-params` (JSON)
    - `setLocale` updates `<html lang>` (language code) and `dir` (`rtl` for `ar` and `ur`, otherwise `ltr`), re-applies translations to the whole document and notifies `onLocaleChange` listeners, with no page reload
    - Importing the module in Node must not touch `document` or `window` at load time
    - _Requirements: R17_

  - [x] 4.13 Create `skeleton/locales/*.json` (20 files)
    - `en.json` is a flat key/value object with every fixed UI string used on the Home Screen, nav menu, text fallback, dual display, language dropdown and Spirit Clerk (titles, buttons, labels, placeholders, tips, aria-labels, confirmation dialogs, error and status messages)
    - Create `ta, hi, te, kn, ml, ko, zh, ja, es, fr, ar, pt, ru, bn, ur, id, de, vi, tr` `.json` with natural, simple translations and exactly the same keys as `en.json`
    - No empty values; placeholders such as `{n}` kept unchanged
    - _Requirements: R17_

- [x] 5. Create Home Screen
  - [x] 5.1 Create `index.html`
    - Import `skeleton/language-dropdown.js` and `skeleton/theme.css`
    - Render Halloween-themed home screen: language dropdown (English pre-selected), "Spirit Clerk" button, "Ghost Tutor" button
    - Language change stores selection in `sessionStorage` immediately via `createLanguageDropdown`
    - "Spirit Clerk" button navigates to `apps/spirit-clerk/index.html`; "Ghost Tutor" navigates to `apps/ghost-tutor/index.html`
    - Show a small tip reading exactly "For the best voices in Indian languages, open this app in Microsoft Edge."
    - All interactive controls meet 44×44 px minimum touch target
    - _Requirements: R1, R13_

  - [x] 5.2 Create `skeleton/nav-menu.js` and apply it to the Home Screen
    - Export `createNavMenu(headerEl, { current, showBack, onBack, getLeaveMessage, onLeave })` returning `{ languageEl, setBackVisible(visible), closeMenu() }`, and `createScreenHistory(firstScreen)` returning `{ visit(name), back(), current(), canGoBack() }`
    - Render a top header bar: hamburger button (three lines) on the left, "← Back" button next to it, language dropdown slot (`languageEl`) on the right
    - Hamburger opens a left slide-in drawer with links Home (`/`), Spirit Clerk (`/apps/spirit-clerk/index.html`), Ghost Tutor (`/apps/ghost-tutor/index.html`); highlight the current page with a class and `aria-current="page"`
    - Hamburger uses `aria-expanded`, `aria-controls` and an `aria-label` ("Open menu" / "Close menu"); drawer closes on link click, outside (overlay) click, or Escape; drawer is not keyboard-reachable while closed
    - Back: call `onBack()`; if it returns `true` the app handled it, otherwise navigate to `/`; `showBack: false` hides Back (Home Screen)
    - Before any navigation call `getLeaveMessage()`; if it returns text, ask `window.confirm` and cancel navigation when declined
    - Before any navigation call `window.speechSynthesis.cancel()` and `onLeave()`; also cancel speech on `pagehide`
    - Add navigation styles to `skeleton/theme.css` (spooky theme, 44×44 px touch targets, no horizontal overflow at 320–767 px, `prefers-reduced-motion` respected)
    - Update `index.html` to use the header (`showBack: false`, `current: 'home'`) with the language dropdown rendered into `languageEl`
    - _Requirements: R16, R13, R6_

  - [x] 5.3 Apply localization to the Home Screen and nav menu
    - `index.html` awaits `initI18n()` before building the header and marks all fixed text with `data-i18n` / `data-i18n-attr` (title, subtitle, app buttons and hints, Edge tip, page `<title>`)
    - `skeleton/nav-menu.js` labels (drawer title, link names, "Back", hamburger aria-labels) come from `t()` through `data-i18n` attributes so they update on language change; the toggle aria-label switches between two keys
    - `skeleton/language-dropdown.js`, `skeleton/text-fallback.js`, `skeleton/dual-display.js` labels, placeholder, buttons, validation and note text use i18n keys
    - `skeleton/theme.css` and `index.html` styles use CSS logical properties instead of left/right; the drawer slides in from the right when `[dir="rtl"]`
    - _Requirements: R17, R16, R13_

- [x] 6. Implement Spirit Clerk app
  - [x] 6.1 Create `apps/spirit-clerk/style.css`
    - Extend `skeleton/theme.css` with Spirit Clerk–specific layout rules
    - Upload area, form-fill area, summary screen, loading spinner styles
    - _Requirements: R6_

  - [x] 6.2 Create `apps/spirit-clerk/index.html`
    - Import `theme.css`, `style.css`, `app.js` (type="module")
    - All skeleton files must be loaded with absolute paths (e.g. `/skeleton/theme.css`, `/skeleton/language-dropdown.js`, `/skeleton/api-client.js`) and `app.js` must be referenced as `/apps/spirit-clerk/app.js`
    - Add a script tag that loads jsPDF from a pinned CDN version before `app.js`: `<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>`
    - Page header is an empty `<header id="app-header">` filled by `skeleton/nav-menu.js` (menu drawer, Back button, language dropdown on the right); no separate Home button (Home is a drawer link)
    - Placeholder `<main>` containers for each screen (upload, form-fill, summary); `app.js` shows/hides them
    - _Requirements: R8, R9, R10, R13, R16_

  - [x] 6.3 Create `apps/spirit-clerk/app.js` — Upload screen
    - Import all skeleton modules and `api-client.js`; import `form-utils.js`
    - Render file input accepting PDF, JPEG, PNG, WEBP; validate size ≤ 10 MB and MIME type client-side before sending
    - On confirm: read file as base64, show loading spinner, call `extractFields({ fileBase64, mimeType, lang })`
    - On success with fields: store `fields[]` in module state; transition to form-fill screen
    - On zero fields: display inline retry message
    - On error / timeout: display inline error, allow retry without clearing state
    - _Requirements: R8_

  - [x] 6.4 Extend `apps/spirit-clerk/app.js` — Form-fill screen
    - Iterate `fields[]`; for each field speak `field.question` via `speech-output.js`; display question text
    - Accept voice via `speech-input.js` or typed via `text-fallback.js`
    - On answer received: call `translate()` if `chosenLang !== 'en-US'`; render `dual-display.js` with `heardText` + `englishMeaning`; show confirm / redo controls
    - Redo logic: call `nextRedoOrSkip(redoCount)`; if `'skip'` mark field skipped and advance; if `'redo'` re-ask (max 3 redos)
    - Silence logic: listen for `onError({ inactivity: true })` from `speech-input.js`; call `nextSilenceOrSkip(silenceCount)`; if `'reask'` re-ask once; if `'skip'` mark field skipped and advance
    - Store each answer as `FieldAnswer { field, heardText, englishMeaning, skipped }`
    - If `createSpeechInput` returns `supported: false`, hide the microphone button and show the "voice input is not available in this browser" message
    - Language change mid-session: recreate `SpeechInput` + `SpeechOutput` after current speech ends
    - When all fields processed: advance to summary screen
    - _Requirements: R1, R2, R3, R4, R5, R9_

  - [x] 6.5 Extend `apps/spirit-clerk/app.js` — Filled summary screen
    - Before rendering: collect all non-skipped `FieldAnswer` entries with empty `englishMeaning`; call `translate()` for each
    - Render all field-answer pairs in document order using `englishMeaning` as answer text; show skipped-field count if any
    - "Download PDF" button: use jsPDF (from CDN); build one label-answer pair per line; use `pdfFilename(formName, new Date())` for filename
    - On PDF error: show inline error message; retain summary on screen
    - _Requirements: R10_

  - [x] 6.6 Apply localization to Spirit Clerk
    - `apps/spirit-clerk/index.html` uses `data-i18n` on all fixed text and `app.js` awaits `initI18n()` before building the nav
    - `app.js`: every message, status, button text (Speak/Stop), progress (`Question {n} of {total}`), error text and the confirmation dialog uses `t()` / `setI18nText` and updates immediately when the language changes (including a message already on screen)
    - `style.css` uses CSS logical properties so the layout mirrors in right-to-left languages
    - The PDF stays in English (title, `(skipped)`, `(translation unavailable)` are not localized)
    - _Requirements: R17, R9, R10_

- [x] 7. Checkpoint — verify Spirit Clerk
  - Run the app, upload a sample form, complete a guided fill in at least one non-English language, and download the PDF summary.

- [x] 8. Implement Ghost Tutor app
  - [x] 8.1 Create `apps/ghost-tutor/style.css`
    - Extend `skeleton/theme.css` with Ghost Tutor–specific layout rules
    - Topic selection screen, lesson card, quiz area, feedback area, loading spinner styles
    - _Requirements: R6_

  - [x] 8.2 Create `apps/ghost-tutor/index.html`
    - Import `theme.css`, `style.css`, `app.js` (type="module")
    - All skeleton files must be loaded with absolute paths (e.g. `/skeleton/theme.css`, `/skeleton/language-dropdown.js`, `/skeleton/api-client.js`) and `app.js` must be referenced as `/apps/ghost-tutor/app.js`
    - Page header is an empty `<header id="app-header">` filled by `skeleton/nav-menu.js` (menu drawer, Back button, language dropdown on the right); no separate Home button (Home is a drawer link)
    - Placeholder `<main>` containers for topic-selection and lesson screens; `app.js` shows/hides them
    - Mark fixed text with `data-i18n`; Ghost Tutor strings are added to `skeleton/locales/en.json` (the sync hook adds them to the other 19 files); `app.js` awaits `initI18n()`; styles use CSS logical properties
    - _Requirements: R11, R12, R13, R16, R17_

  - [x] 8.3 Create `apps/ghost-tutor/app.js` — Topic selection screen
    - Import all skeleton modules, `api-client.js`, and `lesson-utils.js`
    - Render 5–20 suggested topic buttons plus a free-text input (max 100 chars)
    - Validate non-empty, non-whitespace on submit; show inline error if invalid
    - On valid submit: show loading indicator; call `lesson({ topic, lang })` with a 25-second client-side timeout
    - Store returned `segments[]` (4 items) in module state; on success transition to lesson screen
    - On timeout / error: show inline error; preserve topic so user can retry without retyping
    - _Requirements: R11_

  - [x] 8.4 Create `apps/ghost-tutor/app.js` — Lesson screen
    - Iterate `segments[0..3]` locally using a `segmentIndex` counter
    - For each segment: speak `segment` text via `speech-output.js`; display transcript within 500 ms of audio start
    - Speak and display `quizQuestion`; open a 30-second answer window
    - On silence timeout (`onError({ inactivity: true })`): re-ask the same quiz question once; if no answer on second attempt advance anyway
    - Accept voice or text fallback; show `dual-display.js` with `heardText` + `englishMeaning`
    - If `createSpeechInput` returns `supported: false`, hide the microphone button and show the "voice input is not available in this browser" message
    - Call `evaluate({ topic, question, answer, lang })`; if no response within 10 s show error and re-ask
    - Speak and display `feedback`
    - Call `computeHasMore(segmentIndex)`: if `true` increment `segmentIndex` and continue loop; if `false` speak and display topic-complete message
    - Language change mid-session: recreate `SpeechInput` + `SpeechOutput` after current speech ends
    - _Requirements: R1, R2, R3, R4, R5, R12_

- [x] 9. Checkpoint — verify Ghost Tutor
  - Run the app, select a topic, complete all 4 lesson segments in at least one non-English language, and verify the topic-complete message.

- [x] 10. Create README files
  - [x] 10.1 Create `README.md`
    - Project overview, prerequisites, setup instructions (`npm install`, copy `.env.example` to `.env`, fill in keys, `npm start`)
    - Brief description of Spirit Clerk and Ghost Tutor with screenshots placeholder
    - Link to `skeleton/README.md` for developer extension guide
    - _Requirements: R14_

  - [x] 10.2 Create `skeleton/README.md`
    - Numbered steps for a developer to create a new voice app using the skeleton:
      1. Create a new folder under `apps/`
      2. Add an HTML entry point importing `theme.css` and the skeleton modules you need
      3. Import the functions you need from `/skeleton/api-client.js` in your app's JavaScript; if your app needs a new AI feature, add a new route file in `server/routes/` and mount it in `server/index.js`
      4. Add a button on `index.html` linking to the new app
    - List all exported functions from each skeleton module with brief descriptions
    - _Requirements: R14_

- [x] 11. Write automated tests
  - [x] 11.1 Create `tests/unit/selectVoice.test.js`
    - Import `selectVoice` from `skeleton/speech-output-utils.js`
    - Test: exact-match voice returned; prefix-match voice returned when no exact match; `null` returned when no match at all
    - Test: Natural preferred over Online and plain; Online preferred over plain; first match when no Natural/Online; same preference applied among prefix matches; null when nothing matches
    - _Requirements: R3_

  - [x] 11.2 Create `tests/unit/validateText.test.js`
    - Import `validateText` and `cleanAnswer` from `skeleton/text-fallback-utils.js`
    - Test: empty string → `'empty'`; whitespace-only (spaces, tabs, newlines) → `'empty'`; non-empty valid text → `'ok'`
    - `cleanAnswer`: `'Shankar.'` → `'Shankar'`; `'T.'` → `'T'`; trailing `।`, `。`, `!`, `?`, `,`, `;`, `:` and mixed/repeated marks and spaces (e.g. `'Hello ?! . '`) are all removed; leading/trailing whitespace is trimmed; inner punctuation is kept (`'a.b, c'` unchanged, `'3.5'` unchanged); text of only punctuation → `''`; empty string → `''`; already clean text is unchanged (idempotent)
    - Property test (fast-check, ≥100 runs): `cleanAnswer(cleanAnswer(s)) === cleanAnswer(s)` and the result never ends with a trailing mark or whitespace
    - _Requirements: R5_

  - [x] 11.3 Create `tests/unit/formUtils.test.js`
    - Import `nextRedoOrSkip`, `nextSilenceOrSkip`, `pdfFilename`, `cleanLabel` from `apps/spirit-clerk/form-utils.js`
    - `nextRedoOrSkip`: `'redo'` for counts 0, 1, 2; `'skip'` for count 3
    - `nextSilenceOrSkip`: `'reask'` for count 0; `'skip'` for count 1
    - `pdfFilename`: returns correct `'{name}_{YYYY-MM-DD}.pdf'` format
    - `cleanLabel`: `'First name:'` → `'First name'`; `'First name::'` → `'First name'`; `'First name :  '` → `'First name'`; `'  Date of birth '` → `'Date of birth'`; full-width colon `'名前：'` → `'名前'`; inner colons kept (`'Time: hh:mm'` unchanged except trailing); colon-only or empty → `''`; already clean label unchanged
    - _Requirements: R9, R10_

  - [x] 11.4 Create `tests/unit/lessonUtils.test.js`
    - Import `computeHasMore` from `apps/ghost-tutor/lesson-utils.js`
    - Test: `true` for indexes 0, 1, 2; `false` for index 3
    - _Requirements: R12_

  - [x] 11.5 Create `tests/unit/routes.test.js`
    - Import each router factory (`createTranslateRouter`, `createExtractFieldsRouter`, `createLessonRouter`, `createEvaluateRouter`) directly — no module mocking, no experimental Node flags
    - Create a fake `callGemini` function for each test case: a simple async function that either returns a canned response or throws `{ code: 'timeout' }`, `{ code: 'rate_limit' }`, or `{ code: 'gemini_error', message }`
    - Pass the fake `callGemini` directly to the router factory; mount it on a minimal Express app using `supertest` (or Node's built-in fetch against a test server)
    - For each route, test: HTTP 400 on empty / missing required input; HTTP 504 when fake throws `{ code: 'timeout' }`; HTTP 502 when fake throws `{ code: 'gemini_error', message }`; HTTP 429 when fake throws `{ code: 'rate_limit' }`; response body never contains the value of `GEMINI_API_KEY`
    - _Requirements: R7_

  - [x] 11.9 Create `tests/unit/locales.test.js`
    - Read every `skeleton/locales/*.json` with `fs` and `JSON.parse` (no network)
    - Test exactly 20 files exist (en, ta, hi, te, kn, ml, ko, zh, ja, es, fr, ar, pt, ru, bn, ur, id, de, vi, tr)
    - Test every locale file has exactly the same set of keys as `en.json` (report missing and extra keys by name)
    - Test no value is empty or whitespace-only and every value is a string
    - Test placeholders such as `{n}` in an English value also appear in the translated value
    - _Requirements: R17_

  - [x] 11.10 Create `tests/unit/voiceCommands.test.js`
    - Import `matchCommand`, `parseWords` from `skeleton/voice-commands.js`
    - English examples with `words = { yes: ['yes','ok','correct'], redo: ['again','no','redo'] }`: `'Yes.'` → `'yes'`; `'  OK!! '` → `'yes'`; `'again'` → `'redo'`; `'No'` → `'redo'`; `'yes yes'` → `'yes'`; `'maybe'` → `null`; `''` → `null`
    - Tamil: load `skeleton/locales/ta.json` with `fs`, build words with `parseWords` from `voice.yesWords` / `voice.redoWords`; `'சரி'` → `'yes'` and `'மறுபடி'` → `'redo'`
    - Arabic: load `skeleton/locales/ar.json`; a yes word followed by the Arabic question mark (e.g. `'نعم؟'`) → `'yes'`
    - A word present in both lists → `null`
    - `parseWords`: trims entries and drops empty entries (e.g. `' yes | |ok||'` → `['yes','ok']`)
    - Property test (fast-check, ≥100 runs): for any word `w` taken from a list and any added surrounding punctuation, whitespace and case changes, `matchCommand` returns that list's command
    - Locale check: for every `skeleton/locales/*.json`, `voice.yesWords` and `voice.redoWords` each parse to at least 2 words and the two lists share no word
    - _Requirements: R18_

  - [x] 11.11 Extend `tests/unit/routes.test.js` for field help
    - Use a fake `callGemini` returning `fields` with and without `help` (missing, blank, non-string)
    - Test every returned field has a string `help`, and it is `""` when the fake omitted it or returned a blank/non-string value; the request still succeeds with HTTP 200
    - Test the prompt passed to `callGemini` mentions the help sentence and the requested `lang`
    - _Requirements: R20_

  - [x] 11.12 Create `tests/unit/privacy.test.js`
    - Static check: read every file under `server/` with `fs`; none imports or calls fs write APIs (`writeFile`, `appendFile`, `createWriteStream`, `mkdir`) or a database / upload-storage package (e.g. `multer`, `sqlite`, `mongoose`, `pg`)
    - Static check: no `console.log` / `console.error` call in `server/` logs `req.body`
    - Supertest check: `POST /api/extract-fields` with a fake `callGemini` leaves no new files in the repository or the OS temp directory (compare directory listings before and after)
    - _Requirements: R22_

  - [ ]* 11.6 Write property test for translation non-empty preservation
    - `// Feature: phantom-voice-kit, Property 1: Translation non-empty preservation`
    - Use fast-check to generate arbitrary non-empty, non-whitespace strings as `text` and arbitrary valid `targetLang` strings
    - Mock `callGemini` to return `{ translation: text.trim().replace(/\s+/g, ' ') }` (non-empty for valid input)
    - Assert the returned `translation` field is a non-empty string for all generated inputs
    - **Property 1: Translation non-empty preservation**
    - **Validates: Requirements R2.3, R5.4**

  - [ ]* 11.7 Write property test for field extraction response shape
    - `// Feature: phantom-voice-kit, Property 2: Field extraction response shape validity`
    - Use fast-check to generate arbitrary arrays of field objects; mock `callGemini` to return those arrays as `fields`
    - Assert every item has `inputType ∈ { 'text', 'date', 'checkbox', 'selection' }` AND a non-empty `question` string
    - **Property 2: Field extraction response shape validity**
    - **Validates: Requirements R8.3, R9.2**

  - [ ]* 11.8 Write property test for text-fallback whitespace rejection
    - `// Feature: phantom-voice-kit, Property 3: Text Fallback whitespace rejection`
    - Use fast-check to generate arbitrary strings composed entirely of whitespace characters (spaces, tabs, newlines)
    - Assert `validateText(whitespaceString) === 'empty'` for all generated inputs
    - **Property 3: Text Fallback whitespace rejection**
    - **Validates: Requirements R5.3, R11.3**

- [x] 12. Add the localization Kiro hook
  - [x] 12.1 Create `.kiro/hooks/sync-locales.kiro.hook`
    - Trigger `fileEdited` on `skeleton/locales/en.json`, action `askAgent`
    - Prompt: add new or changed keys to the other 19 locale files with natural, simple translations; remove keys that no longer exist in `en.json`; never change key names; keep `{placeholders}`; leave unchanged keys untouched; validate that every file is valid JSON with the same keys as `en.json`
    - _Requirements: R17_

- [x] 13. UX improvements for low-literacy users
  - [x] 13.1 Create `skeleton/voice-commands.js`
    - Export pure functions `matchCommand(text, words)`, `parseWords(str)` and `normalize(text)`; no DOM access, importable in Node
    - `parseWords(str)`: split on `|`, trim each entry, drop empty entries
    - `normalize(text)`: `toLocaleLowerCase()`, remove punctuation and symbols with `\p{P}` and `\p{S}` (Unicode `u` flag), collapse whitespace and trim
    - `matchCommand(text, words)` with `words = { yes: string[], redo: string[] }`: compare the whole cleaned utterance with each cleaned word, also accept an utterance made only of repeats of one word (e.g. "yes yes"); return `'yes'`, `'redo'` or `null`; return `null` if both lists match
    - Add keys `voice.yesWords` and `voice.redoWords` (a `|`-separated list of short words) to `skeleton/locales/en.json` and all 19 other locale files, e.g. English `yes|ok|correct` and `again|no|redo`
    - _Requirements: R18, R17_

  - [x] 13.2 Extend `server/routes/extract-fields.js` with field help
    - Extend the prompt to ask for a `help` string per field: one short, simple sentence in `lang` explaining what the field means with a small example
    - Normalise each returned field so `help` is a string, `""` if missing, blank or not a string; a missing `help` never fails the request
    - Keep the same route and the same single Gemini call
    - Confirm no route or module in `server/` writes request data to disk or logs (no fs writes, no logging of `req.body`)
    - _Requirements: R20, R22, R7_

  - [x] 13.3 Add How it works and the privacy note
    - `skeleton/theme.css`: shared `.how-it-works` styles using CSS logical properties; steps stacked vertically on 320–767 px and side by side on wider screens; touch-friendly spacing, no horizontal overflow
    - `apps/spirit-clerk/index.html` and `apps/ghost-tutor/index.html`: add the three-step `.how-it-works` list at the top of the first screen, with `data-i18n` on every step
    - `apps/spirit-clerk/index.html`: add the privacy note on the upload screen with `data-i18n`
    - Add the new keys (six steps and the privacy note) to `skeleton/locales/en.json` and all 19 other locale files
    - _Requirements: R21, R22, R17_

  - [x] 13.4 Spirit Clerk voice confirm and field help
    - `apps/spirit-clerk/app.js`, `index.html`, `style.css`
    - After the dual display is shown, speak `t('spiritClerk.confirmPrompt')` and listen once; run `matchCommand` on the Heard_Text with words built by `parseWords(t('voice.yesWords'))` / `parseWords(t('voice.redoWords'))`; `'yes'` → Confirm, `'redo'` → Redo, anything else → keep waiting; Confirm/Redo buttons keep working; a spoken command is never stored as an answer
    - Add a "(?)" help button (44×44 px, translated `aria-label`) next to each question; activating it shows and speaks `field.help`, pausing listening while it speaks and resuming after; hide the button when the field has no help
    - Cache help texts per language like the questions; on language change translate them with `translate()`; if translation fails show the original help with the audio-unavailable note and do not speak it
    - Add the new keys (e.g. `spiritClerk.confirmPrompt`, help button label) to `skeleton/locales/en.json` and all 19 other locale files
    - _Requirements: R18, R20, R17, R9_

  - [x] 13.5 Ghost Tutor topic by voice
    - `apps/ghost-tutor/app.js`, `index.html`, `style.css`
    - Add a microphone button next to the topic input using the skeleton speech input in the Chosen_Language; hide it when speech input is not supported
    - Put the cleaned Heard_Text (max 100 chars) into the topic box; speak and show `t('ghostTutor.confirmTopic', { topic })` and listen once with `matchCommand`
    - `'yes'` or pressing Start begins the lesson with the same validation and request as typed topics; any other words leave the topic in the box for editing
    - Add the new keys (e.g. `ghostTutor.confirmTopic`, mic button label) to `skeleton/locales/en.json` and all 19 other locale files
    - _Requirements: R19, R18, R17, R11_

- [x] 14. Phantom Lens · Form Translator (third app)
  - [x] 14.1 Pure helpers and unit tests
    - `skeleton/form-overlay-utils.js`: `boxToPixels`, `wrapText`, `fitText`, `scaleFromOffset`, `clampOffset`, `sampleBackground`, `readableTextColor`, `readingOrder` (no DOM access)
    - `apps/form-translator/translator-utils.js`: `limitPages`, `fitImageSize`, `pdfPageSize`, `translatedFilename`, `chunkTexts`
    - Unit tests in `tests/unit/formOverlayUtils.test.js` and `tests/unit/translatorUtils.test.js`
    - _Requirements: R23.7, R23.8, R23.9, R23.10, R23.11_

  - [x] 14.2 Route `POST /api/translate-layout`
    - `server/routes/translate-layout.js`: factory `createTranslateLayoutRouter(callGemini)` and exported `validateBlocks(raw)`; mount in `server/index.js`
    - Validate input (400), validate and clamp Gemini's boxes, map errors like `/api/extract-fields`; no logging of bodies
    - Add `translateLayout()` to `skeleton/api-client.js`
    - Unit tests with a fake `callGemini` in `tests/unit/translateLayout.test.js`
    - _Requirements: R23.2, R23.3, R23.4, R22_

  - [x] 14.3 Shared module `skeleton/form-overlay.js`
    - `loadImage`, `prepareOverlay`, `drawOverlay` using the pure helpers; browser fonts for all scripts; RTL support
    - _Requirements: R23.7_

  - [x] 14.4 App page `apps/form-translator`
    - `index.html`, `app.js`, `style.css`: upload screen with how-it-works, privacy note and spinner; PDF pages rendered with pdf.js (max 5); one `translateLayout` call per page; preview with A- / Auto / A+; Download PDF with jsPDF; Read aloud / Stop
    - _Requirements: R23.1, R23.5, R23.6, R23.9, R23.10, R23.11, R23.13_

  - [x] 14.5 Home card, nav menu and locales
    - `index.html`: third app card ("Translate a form" + "Phantom Lens · Form Translator"); `skeleton/nav-menu.js`: new menu entry
    - Add all new keys to `en.json` and the 19 other locale files
    - _Requirements: R23.12, R23.14, R17_

  - [ ] 14.6 Verify
    - [x] Run `npm test` (314 pass); re-read every changed file; headless Edge check of the overlay (Tamil, Arabic, Chinese, A- / A+) and of the page load
    - [ ] Manual check in Microsoft Edge with a real form and the real Gemini key (PDF upload, PDF download, read aloud)

- [x] 15. Form Translator: adaptive cover, more room for text, everything in the target script
  - [x] 15.1 `skeleton/form-overlay-utils.js`: `growCover`, `stripHasLine`, `sampleInkColor`, `findFreeWidth`, `textArea`, `estimateOriginalSize`, `pickVersion`, `leaveUntouched`; `skeleton/form-overlay.js` uses them (`prepareOverlay(image, blocks, { lang })`)
    - _Requirements: R23.15, R23.16, R23.17_
  - [x] 15.2 `skeleton/translation-rules.js` (shared); `server/routes/translate-layout.js` prompt (target script, `short` key) and log (`short`, `latinLeft`); `server/routes/layout-parser.js` keeps `short`
    - _Requirements: R23.16, R23.17_
  - [x] 15.3 Unit tests: `formOverlayScan.test.js`, `translationRules.test.js`, additions to `layoutParser.test.js`; two real Gemini calls for the final check

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Checkpoints (tasks 3, 7, 9) are manual verification steps and are not automated.
- Property tests (11.6–11.8) mock the Gemini API — no live API calls are made in automated tests.
- Unit tests use Node's built-in test runner (`node --test`); run with `npm test`.
- The Express server is never started during automated tests; route tests import handlers directly.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5", "2.6"] },
    { "id": 4, "tasks": ["4.1", "4.2", "4.3", "4.4"] },
    { "id": 5, "tasks": ["4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.11"] },
    { "id": 6, "tasks": ["4.12"] },
    { "id": 7, "tasks": ["4.13"] },
    { "id": 8, "tasks": ["5.1"] },
    { "id": 9, "tasks": ["5.2"] },
    { "id": 10, "tasks": ["5.3"] },
    { "id": 11, "tasks": ["6.1", "6.2"] },
    { "id": 12, "tasks": ["6.3"] },
    { "id": 13, "tasks": ["6.4"] },
    { "id": 14, "tasks": ["6.5"] },
    { "id": 15, "tasks": ["6.6"] },
    { "id": 16, "tasks": ["8.1", "8.2"] },
    { "id": 17, "tasks": ["8.3"] },
    { "id": 18, "tasks": ["8.4"] },
    { "id": 19, "tasks": ["10.1", "10.2"] },
    { "id": 20, "tasks": ["11.1", "11.2", "11.3", "11.4"] },
    { "id": 21, "tasks": ["11.5", "11.9", "11.10", "11.11", "11.12"] },
    { "id": 22, "tasks": ["11.6", "11.7", "11.8"] },
    { "id": 23, "tasks": ["12.1"] },
    { "id": 24, "tasks": ["13.1", "13.2"] },
    { "id": 25, "tasks": ["13.3"] },
    { "id": 26, "tasks": ["13.4"] },
    { "id": 27, "tasks": ["13.5"] },
    { "id": 28, "tasks": ["14.1", "14.2"] },
    { "id": 29, "tasks": ["14.3"] },
    { "id": 30, "tasks": ["14.4", "14.5"] },
    { "id": 31, "tasks": ["14.6"] }
  ]
}
```
