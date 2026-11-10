# Implementation Plan: Phantom Voice Kit

## Overview

Build the Phantom Voice Kit from the ground up: project scaffolding → Express server + Gemini proxy → shared skeleton modules → home screen → Spirit Clerk app → Ghost Tutor app → README files → automated tests. Each task creates or modifies exactly one file (or one closely related group) and wires it into the preceding steps.

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
    - Render a `<select>` populated with the 12 supported languages (label + bcp47)
    - On change: write `sessionStorage.chosenLang` and `sessionStorage.chosenLangLabel`; call `onChange({ label, bcp47 })`
    - `getCurrentLanguage()` reads from the active select or `sessionStorage`
    - _Requirements: R1, R13_

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

- [x] 5. Create Home Screen
  - [x] 5.1 Create `index.html`
    - Import `skeleton/language-dropdown.js` and `skeleton/theme.css`
    - Render Halloween-themed home screen: language dropdown (English pre-selected), "Spirit Clerk" button, "Ghost Tutor" button
    - Language change stores selection in `sessionStorage` immediately via `createLanguageDropdown`
    - "Spirit Clerk" button navigates to `apps/spirit-clerk/index.html`; "Ghost Tutor" navigates to `apps/ghost-tutor/index.html`
    - Show a small tip reading exactly "For the best voices in Indian languages, open this app in Microsoft Edge."
    - All interactive controls meet 44×44 px minimum touch target
    - _Requirements: R1, R13_

- [x] 6. Implement Spirit Clerk app
  - [x] 6.1 Create `apps/spirit-clerk/style.css`
    - Extend `skeleton/theme.css` with Spirit Clerk–specific layout rules
    - Upload area, form-fill area, summary screen, loading spinner styles
    - _Requirements: R6_

  - [x] 6.2 Create `apps/spirit-clerk/index.html`
    - Import `theme.css`, `style.css`, `app.js` (type="module")
    - All skeleton files must be loaded with absolute paths (e.g. `/skeleton/theme.css`, `/skeleton/language-dropdown.js`, `/skeleton/api-client.js`) and `app.js` must be referenced as `/apps/spirit-clerk/app.js`
    - Add a script tag that loads jsPDF from a pinned CDN version before `app.js`: `<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>`
    - Page header with language dropdown (rendered by `language-dropdown.js`) and "Home" button linking to `/`
    - Placeholder `<main>` containers for each screen (upload, form-fill, summary); `app.js` shows/hides them
    - _Requirements: R8, R9, R10, R13_

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

- [x] 7. Checkpoint — verify Spirit Clerk
  - Run the app, upload a sample form, complete a guided fill in at least one non-English language, and download the PDF summary.

- [ ] 8. Implement Ghost Tutor app
  - [ ] 8.1 Create `apps/ghost-tutor/style.css`
    - Extend `skeleton/theme.css` with Ghost Tutor–specific layout rules
    - Topic selection screen, lesson card, quiz area, feedback area, loading spinner styles
    - _Requirements: R6_

  - [ ] 8.2 Create `apps/ghost-tutor/index.html`
    - Import `theme.css`, `style.css`, `app.js` (type="module")
    - All skeleton files must be loaded with absolute paths (e.g. `/skeleton/theme.css`, `/skeleton/language-dropdown.js`, `/skeleton/api-client.js`) and `app.js` must be referenced as `/apps/ghost-tutor/app.js`
    - Page header with language dropdown and "Home" button linking to `/`
    - Placeholder `<main>` containers for topic-selection and lesson screens; `app.js` shows/hides them
    - _Requirements: R11, R12, R13_

  - [ ] 8.3 Create `apps/ghost-tutor/app.js` — Topic selection screen
    - Import all skeleton modules, `api-client.js`, and `lesson-utils.js`
    - Render 5–20 suggested topic buttons plus a free-text input (max 100 chars)
    - Validate non-empty, non-whitespace on submit; show inline error if invalid
    - On valid submit: show loading indicator; call `lesson({ topic, lang })` with a 25-second client-side timeout
    - Store returned `segments[]` (4 items) in module state; on success transition to lesson screen
    - On timeout / error: show inline error; preserve topic so user can retry without retyping
    - _Requirements: R11_

  - [ ] 8.4 Create `apps/ghost-tutor/app.js` — Lesson screen
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

- [ ] 9. Checkpoint — verify Ghost Tutor
  - Run the app, select a topic, complete all 4 lesson segments in at least one non-English language, and verify the topic-complete message.

- [ ] 10. Create README files
  - [ ] 10.1 Create `README.md`
    - Project overview, prerequisites, setup instructions (`npm install`, copy `.env.example` to `.env`, fill in keys, `npm start`)
    - Brief description of Spirit Clerk and Ghost Tutor with screenshots placeholder
    - Link to `skeleton/README.md` for developer extension guide
    - _Requirements: R14_

  - [ ] 10.2 Create `skeleton/README.md`
    - Numbered steps for a developer to create a new voice app using the skeleton:
      1. Create a new folder under `apps/`
      2. Add an HTML entry point importing `theme.css` and the skeleton modules you need
      3. Import the functions you need from `/skeleton/api-client.js` in your app's JavaScript; if your app needs a new AI feature, add a new route file in `server/routes/` and mount it in `server/index.js`
      4. Add a button on `index.html` linking to the new app
    - List all exported functions from each skeleton module with brief descriptions
    - _Requirements: R14_

- [ ] 11. Write automated tests
  - [ ] 11.1 Create `tests/unit/selectVoice.test.js`
    - Import `selectVoice` from `skeleton/speech-output-utils.js`
    - Test: exact-match voice returned; prefix-match voice returned when no exact match; `null` returned when no match at all
    - Test: Natural preferred over Online and plain; Online preferred over plain; first match when no Natural/Online; same preference applied among prefix matches; null when nothing matches
    - _Requirements: R3_

  - [ ] 11.2 Create `tests/unit/validateText.test.js`
    - Import `validateText` and `cleanAnswer` from `skeleton/text-fallback-utils.js`
    - Test: empty string → `'empty'`; whitespace-only (spaces, tabs, newlines) → `'empty'`; non-empty valid text → `'ok'`
    - `cleanAnswer`: `'Shankar.'` → `'Shankar'`; `'T.'` → `'T'`; trailing `।`, `。`, `!`, `?`, `,`, `;`, `:` and mixed/repeated marks and spaces (e.g. `'Hello ?! . '`) are all removed; leading/trailing whitespace is trimmed; inner punctuation is kept (`'a.b, c'` unchanged, `'3.5'` unchanged); text of only punctuation → `''`; empty string → `''`; already clean text is unchanged (idempotent)
    - Property test (fast-check, ≥100 runs): `cleanAnswer(cleanAnswer(s)) === cleanAnswer(s)` and the result never ends with a trailing mark or whitespace
    - _Requirements: R5_

  - [ ] 11.3 Create `tests/unit/formUtils.test.js`
    - Import `nextRedoOrSkip`, `nextSilenceOrSkip`, `pdfFilename`, `cleanLabel` from `apps/spirit-clerk/form-utils.js`
    - `nextRedoOrSkip`: `'redo'` for counts 0, 1, 2; `'skip'` for count 3
    - `nextSilenceOrSkip`: `'reask'` for count 0; `'skip'` for count 1
    - `pdfFilename`: returns correct `'{name}_{YYYY-MM-DD}.pdf'` format
    - `cleanLabel`: `'First name:'` → `'First name'`; `'First name::'` → `'First name'`; `'First name :  '` → `'First name'`; `'  Date of birth '` → `'Date of birth'`; full-width colon `'名前：'` → `'名前'`; inner colons kept (`'Time: hh:mm'` unchanged except trailing); colon-only or empty → `''`; already clean label unchanged
    - _Requirements: R9, R10_

  - [ ] 11.4 Create `tests/unit/lessonUtils.test.js`
    - Import `computeHasMore` from `apps/ghost-tutor/lesson-utils.js`
    - Test: `true` for indexes 0, 1, 2; `false` for index 3
    - _Requirements: R12_

  - [ ] 11.5 Create `tests/unit/routes.test.js`
    - Import each router factory (`createTranslateRouter`, `createExtractFieldsRouter`, `createLessonRouter`, `createEvaluateRouter`) directly — no module mocking, no experimental Node flags
    - Create a fake `callGemini` function for each test case: a simple async function that either returns a canned response or throws `{ code: 'timeout' }`, `{ code: 'rate_limit' }`, or `{ code: 'gemini_error', message }`
    - Pass the fake `callGemini` directly to the router factory; mount it on a minimal Express app using `supertest` (or Node's built-in fetch against a test server)
    - For each route, test: HTTP 400 on empty / missing required input; HTTP 504 when fake throws `{ code: 'timeout' }`; HTTP 502 when fake throws `{ code: 'gemini_error', message }`; HTTP 429 when fake throws `{ code: 'rate_limit' }`; response body never contains the value of `GEMINI_API_KEY`
    - _Requirements: R7_

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
    { "id": 6, "tasks": ["5.1"] },
    { "id": 7, "tasks": ["6.1", "6.2"] },
    { "id": 8, "tasks": ["6.3"] },
    { "id": 9, "tasks": ["6.4"] },
    { "id": 10, "tasks": ["6.5"] },
    { "id": 11, "tasks": ["8.1", "8.2"] },
    { "id": 12, "tasks": ["8.3"] },
    { "id": 13, "tasks": ["8.4"] },
    { "id": 14, "tasks": ["10.1", "10.2"] },
    { "id": 15, "tasks": ["11.1", "11.2", "11.3", "11.4"] },
    { "id": 16, "tasks": ["11.5"] },
    { "id": 17, "tasks": ["11.6", "11.7", "11.8"] }
  ]
}
```
