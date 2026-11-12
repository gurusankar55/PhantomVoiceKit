# Phantom Voice Kit

A reusable skeleton for voice-first web apps, with a spooky ghost / Halloween theme. Built for the Kiroween 2026 Skeleton Crew category.

It is made for people who cannot easily read or type English forms. The whole interface is translated into 20 languages (Arabic and Urdu are right-to-left). Every step can be done by voice, and a text box is always available as a fallback.

Supported languages: English, Tamil, Hindi, Telugu, Kannada, Malayalam, Korean, Chinese, Japanese, Spanish, French, Arabic, Portuguese, Russian, Bengali, Urdu, Indonesian, German, Vietnamese, Turkish.

The project has three parts:

- **skeleton/** shared modules (speech input and output, language dropdown, dual display, text fallback, theme, API client, translations).
- **Spirit Clerk** a voice assistant that helps fill in forms.
- **Ghost Tutor** a voice tutor that teaches a topic in short lessons.

## Prerequisites

- Node.js 20 or newer (includes npm)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/)
- **Microsoft Edge (recommended).** Edge has Tamil and many other "Online (Natural)" voices. Google Chrome also works, but has no Tamil voice on Windows.

## Setup (Windows PowerShell)

```powershell
# 1. Install dependencies
npm install

# 2. Copy the example settings file
Copy-Item .env.example .env

# 3. Open .env and set GEMINI_API_KEY to your key
notepad .env

# 4. Start the server
npm start
```

Then open http://localhost:3000 in Microsoft Edge.

The `.env` file holds:

| Variable | Meaning |
| --- | --- |
| `GEMINI_API_KEY` | Your Gemini API key. Stays on the server only. |
| `GEMINI_MODELS` | Models to try in order, main first, for example `gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite`. On HTTP 429 or 503 the next model is used. |
| `PORT` | Server port. Default is `3000`. |

To run the automated tests:

```powershell
npm test
```

Tests never call the real Gemini API.

## Spirit Clerk

Upload a form as a PDF or a photo. Spirit Clerk reads the fields, asks each question aloud in your language, and listens to your answer. You see what it heard next to the English meaning, then confirm or say it again. At the end you download a filled PDF summary in English.

<!-- Screenshot placeholder: add docs/spirit-clerk.png and link it here -->
![Spirit Clerk screenshot (coming soon)](docs/spirit-clerk.png)

## Ghost Tutor

Pick a topic, or type your own. Ghost Tutor explains it in 4 short segments. After each segment it asks a quiz question, listens to your answer, and gives spoken feedback.

<!-- Screenshot placeholder: add docs/ghost-tutor.png and link it here -->
![Ghost Tutor screenshot (coming soon)](docs/ghost-tutor.png)

## Privacy

Nothing is saved on the server. Uploaded forms, answers, topics and lessons are only sent to Gemini to get a result, and are not stored in any file or database. Your chosen language is kept in the browser session only. Your API key stays in `.env` and is never sent to the browser.

## Build your own voice app

See [skeleton/README.md](skeleton/README.md) for a step-by-step guide and a list of every skeleton module.

## License

MIT 2026. See [LICENSE](LICENSE).
