---
inclusion: always
---

# Phantom Voice Kit — Tech Rules

## Stack (do not deviate)
- Frontend: plain HTML + CSS + vanilla JavaScript ES modules. No React, no bundler, no TypeScript.
- Backend: Node.js (type:module) + Express. One server at http://localhost:3000.
- AI: @google/genai — import GoogleGenAI, call ai.models.generateContent({ model, contents, config }). Model from process.env.GEMINI_MODEL (use gemini-3.5-flash; gemini-2.5-flash returns 404 for new accounts). Set thinkingConfig.thinkingBudget = 0 for speed.
- Speech: browser Web Speech API (SpeechRecognition + speechSynthesis). Supported browsers: Microsoft Edge (recommended, has Tamil and many Online (Natural) voices) and Google Chrome (no Tamil voice on Windows). Voice choice prefers names containing Natural, then Online, then the first match.
- PDF: jsPDF from CDN — https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js

## Security rules
- GEMINI_API_KEY lives only in .env. Never write it into any browser-delivered file.
- Do NOT mount express.static on the repository root. Serve index.html with res.sendFile(). Mount static only for /skeleton and /apps.
- .env is in .gitignore; .kiro is NOT.

## Route factory pattern
Every route file exports a factory function, e.g. createTranslateRouter(callGemini), that receives callGemini as a parameter and returns an Express Router.
server/index.js passes the real callGemini. Tests pass a fake function directly — no module mocking, no experimental Node flags.

## Testing
- Runner: node --test (npm test).
- Property tests: fast-check (minimum 100 iterations each).
- HTTP route tests: supertest.
- Never call the real Gemini API in automated tests.

## Developer environment
- OS: Windows. Always give PowerShell commands (use ; not &&, use dollar-sign-env:VAR notation).

## Code style
Keep code simple and well commented for a beginner. Prefer clarity over cleverness.
