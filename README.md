# Phantom Voice Kit

A reusable skeleton for voice-first web apps, with a soft 3D ghost / Halloween look, and 12 apps built on it. Entry for the **Kiroween 2026 Skeleton Crew** category.

It is made for people who cannot easily read or type English: older people, people working far from home, people who find reading or typing hard, and children who are still learning. Every screen is translated into **20 languages** (Arabic and Urdu are right-to-left), every step can be done by voice, and typing or tapping always works too.

Languages: English, Tamil, Hindi, Telugu, Kannada, Malayalam, Korean, Chinese, Japanese, Spanish, French, Arabic, Portuguese, Russian, Bengali, Urdu, Indonesian, German, Vietnamese, Turkish.

## The skeleton

`skeleton/` holds every shared module, and apps import it by absolute path (`/skeleton/...`), never by copying:

- speech input (one phrase, or continuous like a voice message with a Done button) and speech output with the best voice per language
- translations (`i18n.js`, 20 locale files with identical keys), the language picker and a remembered language
- the shared header: menu with a 3D tile and icon per app, Back, coins, sound on/off, **Aa** large text, language
- the "How to use" walkthrough, rewards (coins, level-up, gift box, sticker book), the theme, the API client
- the installable app (manifest, service worker, offline page)

A step-by-step guide for building a new app on it is in [skeleton/README.md](skeleton/README.md).

## The 12 apps

| App | Folder | For | What it does | Needs internet |
| --- | --- | --- | --- | --- |
| Spirit Clerk (Fill a form by speaking) | `apps/spirit-clerk` | Adults | Upload a form (PDF or photo); each field is asked aloud in your language; get a filled PDF | Yes |
| Phantom Lens (Translate a form) | `apps/form-translator` | Adults | See a form in your own language and hear it read aloud | Yes |
| Phantom Talk (Voice Translator) | `apps/voice-translator` | Adults | Speak or type for a natural translation (automatic, silent unless you tap 🔊); two-person conversation on one phone; Message helper that explains a WhatsApp / Telegram message and writes a polite reply in the sender's language | Yes |
| My documents | `apps/my-documents` | Adults | Your filled PDFs, kept on this device | No |
| Voice notes | `apps/voice-notes` | Adults | Speak or type notes and hear them again | No |
| Ghost Tutor (Learn by speaking) | `apps/ghost-tutor` | Everyone | Any topic in 4 spoken parts with a quiz after each | Yes |
| Calm Ghost (Calm time) | `apps/calm-time` | Everyone | Meditation with bell and breathing circle, activity timer, daily routine with calendar reminders | No |
| Ghost Echo (Memory game) | `apps/ghost-echo` | Children | Remember the pictures and say them back in order | No |
| Picture book | `apps/picture-book` | Children | 60 big pictures; hear the word, say it back, optionally in a second language | No |
| Pumpkin math | `apps/pumpkin-math` | Children | Count, add and take away with pumpkins; 5 levels; answer by tap or voice | No |
| Story time | `apps/story-time` | Children | 6 kind stories read aloud paragraph by paragraph | No |
| Sticker book | `apps/sticker-book` | Children | The stickers won in all the games | No |

On the Home screen, chips filter the cards: **All / For children / For adults / For everyone**, and the choice is remembered. Every app page has a **▶ How to use** button with a 3 or 4 step walkthrough: a finger taps the real buttons and each step is shown and read aloud in your language. It opens by itself once, the first time you open each app.

Other shared features:

- **Large text**: the Aa button makes everything about 125 % bigger in every app.
- **Installable**: the kit installs like an app. The 8 apps without AI work offline; the 4 AI apps say clearly when they need the internet. `/api` answers are never cached.
- **Rewards**: coins, level-ups and a gift box with stickers, shared by all the games.

## How Kiro was used

The whole project was built with Kiro, and the `.kiro` folder is committed on purpose.

- **Spec** (`.kiro/specs/phantom-voice-kit/`): `requirements.md` (46 requirements with acceptance criteria), `design.md` (modules, data shapes, storage keys, the route factory pattern) and `tasks.md` (40 tasks, each with the tests that cover it). Every new feature started as a requirement and a task, and the spec was updated in the same commit as the code.
- **Steering** (`.kiro/steering/`): `product.md` (who it is for, the 20 languages, the theme), `structure.md` (the one skeleton rule: shared code only in `/skeleton`, imported by absolute path) and `tech.md` (the stack, the security rules, the route factory pattern, testing with `node --test` and fast-check, never calling the real Gemini API in tests, PowerShell commands for Windows). These rules kept every change consistent with the rest of the kit.
- **Hooks** (`.kiro/hooks/sync-locales.kiro.hook`): when `skeleton/locales/en.json` is saved, Kiro brings the other 19 locale files in line with it (new keys translated, removed keys deleted, placeholders kept). `tests/unit/locales.test.js` then checks that all 20 files have the same keys and placeholders.

## Run it locally (Windows PowerShell)

You need Node.js 20 or newer and a Gemini API key from [Google AI Studio](https://aistudio.google.com/). Microsoft Edge is recommended: it has Tamil and many other natural voices. Chrome also works, but it has no Tamil voice on Windows.

```powershell
npm install
Copy-Item .env.example .env
notepad .env        # set GEMINI_API_KEY (and optionally GEMINI_MODELS)
npm start
```

Then open http://localhost:3000.

| Variable | Meaning |
| --- | --- |
| `GEMINI_API_KEY` | Your Gemini API key. It stays on the server only. |
| `GEMINI_MODELS` | Models to try in order, for example `gemini-3.5-flash,gemini-3.5-flash-lite`. On HTTP 429 or 503 the next one is used. |
| `PORT` | Server port. Default `3000`. |

Tests (more than 1,250, run with `node --test`; they never call the real Gemini API):

```powershell
npm test
```

## Deploy (Render, free tier)

The repository has a `render.yaml` Blueprint: one free Node web service with `npm install` as the build command, `npm start` as the start command and `/healthz` as the health check.

1. Push the repository to GitHub.
2. In Render, choose **New > Blueprint** and pick the repository.
3. When Render asks, enter `GEMINI_API_KEY` and `GEMINI_MODELS` in the dashboard. They are marked `sync: false`, so they are never stored in any file.
4. Deploy. The server listens on Render's `PORT`, and Render's https address lets the app be installed.

A free service sleeps when nobody uses it, so the first visit after a pause can take about a minute.

## Privacy

- Nothing is stored on the server. Forms, answers, topics and the sentences you translate are sent to Gemini only to get a result, and are not written to any file or database. The server logs only counts and short error codes.
- The API key stays in the server's environment and is never sent to the browser.
- Your language, text size, game levels, story positions, routine, recent translations, documents and notes stay in your own browser (localStorage / IndexedDB).
- The server only serves `/skeleton`, `/apps`, the Home page, the manifest and the service worker; private files such as `server/` and `.env` are never served.

## License

MIT 2026, Sankar D. See [LICENSE](LICENSE).
