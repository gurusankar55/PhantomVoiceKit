// speech-input.js
// Wraps the browser SpeechRecognition API (Edge / Chrome).
//
// Usage:
//   const input = createSpeechInput({ lang: 'ta-IN', onResult, onError });
//   if (input.supported === false) { /* hide mic button, show message */ }
//   else { input.start(); }
//
// Two ways of listening:
//   - one phrase (the default): the browser decides when the phrase ends. Good for "yes" / "again".
//   - continuous: start({ continuous: true, silenceMs }) keeps listening through short pauses (a PAN
//     code, a phone number) until the user has been silent for silenceMs. If the browser ends the
//     recognition early, it is restarted and the parts are joined. onInterim(text) gets the live
//     text while the user speaks, and finish() ends the answer at once ("Done" button).
//
import { cleanAnswer } from './text-fallback-utils.js';
import { SILENCE_MS, joinParts, transcriptFromResults, silenceElapsed } from './speech-utils.js';

// onResult(heardText)  -> called with the final transcript
// onInterim(text)      -> (continuous only) called with everything heard so far, while speaking
// onError(info)        -> called with one of:
//     { noSpeech: true }     the microphone closed without hearing anything usable
//     { inactivity: true }   no speech for 30 seconds
//     { fallbackOnly: true } 3 recognition failures: use the text box only
//     { error: '<code>' }    a single recognition failure (retry allowed)

const INACTIVITY_MS = 30000; // 30 seconds without any speech
const MAX_FAILURES = 3;      // after this many errors, use text fallback only
const MAX_RESTARTS = 60;     // continuous mode: how often the browser may end early and be restarted
const RESTART_DELAY_MS = 150; // wait a moment before restarting a recognition the browser ended
const FINISH_WAIT_MS = 1500; // after stop(), wait at most this long for the last words

export function createSpeechInput({ lang, onResult, onError, onInterim, continuous = false, silenceMs = SILENCE_MS }) {
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

  // ----- continuous mode state -----
  let longMode = false;      // true while a continuous answer is being listened to
  let currentSilenceMs = silenceMs;
  let active = false;        // the continuous answer is not finished yet
  let finishing = false;     // stop() was called; waiting for the last words
  let delivered = false;     // the result (or error) of this answer was already given
  let committed = [];        // text of earlier recognition sessions of this answer
  let session = { final: '', interim: '' }; // text of the current recognition session
  let heardAnything = false;
  let lastActivityAt = 0;
  let restarts = 0;
  let silenceTimer = null;
  let finishTimer = null;

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

  function clearLongTimers() {
    clearTimeout(silenceTimer);
    clearTimeout(finishTimer);
    silenceTimer = null;
    finishTimer = null;
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

  // Everything heard so far in this answer (continuous mode).
  function heardSoFar() {
    return joinParts([...committed, session.final, session.interim]);
  }

  // ----- continuous mode -----

  // Give the answer to the caller, once.
  function deliver() {
    if (delivered) return;
    delivered = true;
    active = false;
    finishing = false;
    clearLongTimers();
    clearTimer();
    listening = false;
    const text = heardSoFar();
    if (text === '') {
      notifyError({ noSpeech: true });
      return;
    }
    gotResult = true;
    failureCount = 0;
    if (typeof onResult === 'function') onResult(text);
  }

  // End the answer now: stop the microphone, wait a moment for the last words, then deliver.
  function finishNow() {
    if (!active || finishing) return;
    finishing = true;
    clearLongTimers();
    stoppedByUs = true;
    try {
      recognition.stop();
    } catch (err) {
      // Ignore: stopping an already-stopped recognizer is harmless.
    }
    finishTimer = setTimeout(deliver, FINISH_WAIT_MS); // safety: onend should call deliver first
  }

  // (Re)start the timer that ends the answer after the user has been silent long enough.
  function armSilenceTimer(waitMs = currentSilenceMs) {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (!active || finishing) return;
      if (silenceElapsed(lastActivityAt, Date.now(), currentSilenceMs)) finishNow();
      else armSilenceTimer(currentSilenceMs - (Date.now() - lastActivityAt)); // heard something meanwhile
    }, Math.max(1, waitMs));
  }

  function startLong() {
    longMode = true;
    active = true;
    finishing = false;
    delivered = false;
    committed = [];
    session = { final: '', interim: '' };
    heardAnything = false;
    restarts = 0;
    lastActivityAt = Date.now();
    clearLongTimers();
    recognition.continuous = true;
    recognition.interimResults = true;
  }

  // A result event while a continuous answer is running.
  function onLongResult(event) {
    session = transcriptFromResults(event.results);
    if (joinParts([session.final, session.interim]) === '') return;
    heardAnything = true;
    lastActivityAt = Date.now();
    clearTimer(); // the 30 second wait for a first word is over
    if (!finishing) armSilenceTimer();
    if (typeof onInterim === 'function') onInterim(heardSoFar());
  }

  // The browser ended the recognition while a continuous answer was running.
  function onLongEnd() {
    listening = false;
    committed.push(joinParts([session.final, session.interim]));
    session = { final: '', interim: '' };

    if (finishing) {
      deliver(); // we asked it to stop: this is the normal end
      return;
    }
    if (!active) return;

    // The browser ended it early (a long pause, a network blip): listen again and keep the parts.
    if (restarts >= MAX_RESTARTS) {
      finishNow();
      return;
    }
    restarts += 1;
    setTimeout(() => {
      if (!active || finishing) return;
      try {
        recognition.start();
        listening = true;
      } catch (err) {
        finishNow();
      }
    }, RESTART_DELAY_MS);
  }

  // ----- recognition events -----

  recognition.onresult = (event) => {
    if (longMode) {
      onLongResult(event);
      return;
    }
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
    if (longMode) {
      // End the answer without delivering a half result; the caller decides what to do.
      active = false;
      finishing = false;
      delivered = true;
      clearLongTimers();
    }
    failureCount += 1;
    if (failureCount >= MAX_FAILURES) {
      notifyError({ fallbackOnly: true });
    } else {
      notifyError({ error: event.error });
    }
  };

  recognition.onend = () => {
    if (longMode) {
      onLongEnd();
      return;
    }
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

  /**
   * Start listening.
   * @param {{continuous?:boolean, silenceMs?:number}} [options]  override the defaults for this answer
   */
  function start(options = {}) {
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

    const wantLong = options.continuous ?? continuous;
    currentSilenceMs = options.silenceMs ?? silenceMs;
    if (wantLong) {
      startLong();
    } else {
      longMode = false;
      active = false;
      recognition.continuous = false;
      recognition.interimResults = false;
    }

    try {
      recognition.start();
      listening = true;
      startTimer();
    } catch (err) {
      active = false;
      // start() throws if the recognizer is already running.
      failureCount += 1;
      if (failureCount >= MAX_FAILURES) {
        notifyError({ fallbackOnly: true });
      } else {
        notifyError({ error: String(err && err.message ? err.message : err) });
      }
    }
  }

  // Stop listening and give nothing to the caller.
  function stop() {
    clearTimer();
    clearLongTimers();
    listening = false;
    stoppedByUs = true;
    if (longMode) {
      active = false;
      finishing = false;
      delivered = true; // whatever the browser still says is ignored
    }
    try {
      recognition.stop();
    } catch (err) {
      // Ignore: stopping an already-stopped recognizer is harmless.
    }
  }

  // Finish the answer now with what was heard so far ("Done" button). Only for continuous listening.
  function finish() {
    if (longMode && active) finishNow();
  }

  return { supported: true, start, stop, finish };
}
