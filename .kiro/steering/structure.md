---
inclusion: always
---

# Phantom Voice Kit — Folder Structure

## Layout
```
/
|-- skeleton/                  <- shared modules (only place for shared code)
|   |-- speech-input.js
|   |-- speech-output.js
|   |-- speech-output-utils.js <- pure: selectVoice(voices, bcp47)
|   |-- language-dropdown.js
|   |-- dual-display.js
|   |-- text-fallback.js
|   |-- text-fallback-utils.js <- pure: validateText(value)
|   |-- nav-menu.js
|   |-- i18n.js                <- t(key), setLocale, applyTranslations
|   |-- locales/               <- en.json + 19 other <code>.json files (same keys)
|   |-- theme.css
|   +-- api-client.js
|-- apps/
|   |-- spirit-clerk/
|   |   |-- index.html
|   |   |-- app.js
|   |   |-- style.css
|   |   +-- form-utils.js      <- pure: nextRedoOrSkip, nextSilenceOrSkip, pdfFilename
|   +-- ghost-tutor/
|       |-- index.html
|       |-- app.js
|       |-- style.css
|       +-- lesson-utils.js    <- pure: computeHasMore(segmentIndex)
|-- server/
|   |-- index.js               <- sendFile for /; static only for /skeleton and /apps
|   |-- gemini.js              <- GoogleGenAI client, callGemini(), 30s timeout
|   +-- routes/
|       |-- translate.js
|       |-- extract-fields.js
|       |-- lesson.js
|       +-- evaluate.js
|-- tests/
|   |-- unit/
|   +-- property/
|-- index.html                 <- Home Screen (served via sendFile at /)
|-- .env                       <- not committed
|-- .env.example
|-- .gitignore
|-- LICENSE
|-- package.json
+-- README.md
```

## The one skeleton rule
Shared code lives **only** in /skeleton. Apps import skeleton files using **absolute paths**
(/skeleton/theme.css, /skeleton/api-client.js, etc.) and **never copy** skeleton code into their own folders.
