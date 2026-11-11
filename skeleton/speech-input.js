// speech-input.js
// Wraps the browser SpeechRecognition API (Edge / Chrome).
//
// Usage:
//   const input = createSpeechInput({ lang: 'ta-IN', onResult, onError });
//   if (input.supported === false) { /* hide mic button, show message */ }
//   else { input.start(); }
//
import { cleanAnswer } from './text-fallback-utils.js';

// onResult(heardText)  -> called with the final transcript
// onError(info)        -> called with one of:
//     { noSpeech: true }     the microphone closed without hearing anything usable
//     { inactivity: true }   no speech for 30 seconds
//     { fallbackOnly: true } 3 recognition failures: use the text box only
//     { error: '<code>' }    a single recognition failure (retry allowed)

const INACTIVITY_MS = 30000; // 30 seconds of silence
const MAX_FAILURES = 3;      // after this many errors, use text fallback only

export function createSpeechInput({ lang, onResult, onError }) {
  // Find the browser's SpeechRecognition class (Chrome uses a webkit prefix).
  const SpeechRecognitionClass =
    typeof window !== 'undefined'
      ? window.SpeechRecognition || window.webkitSpeechRecognition
      : undefined;

  // Not supported: callers hide the mic button and show a short message.
  if (!SpeechRecognitionClass) {
    return { supported: false };
  }

  const recognition = new SpeechRecognitionClass();
  recognition.continuous = false;     // stop after one phrase
  recognition.interimResults = false; // only final results

  let failureCount = 0;     // how many recognition errors so far
  let inactivityTimer = null;
  let listening = false;
  let gotResult = false;    // true once a final result was delivered
  let stoppedByUs = false;  // true when stop() ended the session (not the browser)
  let errorReported = false; // true when onerror already told the caller

  // Safely call a callback if the caller provided one.
  function notifyError(info) {
    if (typeof onError === 'function') onError(info);
  }

  function clearTimer() {
    if (inactivityTimer !== null) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }
  }

  // Start (or restart) the 30-second silence timer.
  function startTimer() {
    clearTimer();
    inactivityTimer = setTimeout(() => {
      inactivityTimer = null;
      stop();
      notifyError({ inactivity: true });
    }, INACTIVITY_MS);
  }

  // A final transcript arrived.
  recognition.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    if (!last || !last.isFinal) return;
    // cleanAnswer trims and removes trailing punctuation such as the full stop Edge adds.
    const heardText = cleanAnswer(last[0] && last[0].transcript ? last[0].transcript : '');
    if (heardText === '') return; // empty result: treated as an error by onend
    gotResult = true;
    clearTimer();
    failureCount = 0; // success resets the retry counter
    if (typeof onResult === 'function') onResult(heardText);
  };

  recognition.onerror = (event) => {
    // 'aborted' happens when we call stop() ourselves, and 'no-speech' is
    // handled by the inactivity timer, so neither counts as a failure.
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    clearTimer();
    listening = false;
    errorReported = true; // onend must not report this a second time
    failureCount += 1;
    if (failureCount >= MAX_FAILURES) {
      notifyError({ fallbackOnly: true });
    } else {
      notifyError({ error: event.error });
    }
  };

  recognition.onend = () => {
    listening = false;
    if (gotResult) {
      clearTimer();
      return;
    }
    // The browser closed the microphone without a result and without an error
    // (it heard nothing, or only noise). Tell the caller right away instead of
    // waiting for the 30 second timer. Not reported when we stopped it ourselves.
    if (!stoppedByUs && !errorReported) {
      clearTimer();
      notifyError({ noSpeech: true });
    }
  };

  function start() {
    if (listening) return;
    // Once 3 failures happened, voice is disabled: tell the caller again.
    if (failureCount >= MAX_FAILURES) {
      notifyError({ fallbackOnly: true });
      return;
    }
    recognition.lang = lang; // set the language before every start()
    gotResult = false;
    stoppedByUs = false;
    errorReported = false;
    try {
      recognition.start();
      listening = true;
      startTimer();
    } catch (err) {
      // start() throws if the recognizer is already running.
      failureCount += 1;
      if (failureCount >= MAX_FAILURES) {
        notifyError({ fallbackOnly: true });
      } else {
        notifyError({ error: String(err && err.message ? err.message : err) });
      }
    }
  }

  function stop() {
    clearTimer();
    listening = false;
    stoppedByUs = true;
    try {
      recognition.stop();
    } catch (err) {
      // Ignore: stopping an already-stopped recognizer is harmless.
    }
  }

  return { supported: true, start, stop };
}
