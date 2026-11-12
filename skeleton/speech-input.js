// speech-input.js
// Wraps the browser SpeechRecognition API (Edge / Chrome).
//
// Usage:
//   const input = createSpeechInput({ lang: 'ta-IN', onResult, onError });
//   if (input.supported === false) { /* hide mic button, show message */ }
//   else { input.start(); }
//
// Two ways of listening:
//   - one phrase (the default): the browser decides when the phrase ends. Good for "correct" / "wrong"
//     and for one character.
//   - continuous, like a voice message: start({ continuous: true, doneWords }) listens until the user
//     presses "Done" (finish()), says a done word, or has been silent for 15 seconds. A pause does NOT
//     end it. If the browser ends the recognition, it is restarted silently and the text is kept.
//     onInterim(text) gets the live text while the user speaks.
//   start({ lang }) listens in another language for that answer (e.g. en-IN for a PAN code).
//
import { cleanAnswer } from './text-fallback-utils.js';
import { SAFETY_SILENCE_MS, joinParts, transcriptFromResults, silenceElapsed, splitDoneWord } from './speech-utils.js';

// onResult(heardText)  -> called with the final transcript
// onInterim(text)      -> (continuous only) called with everything heard so far, while speaking
// onError(info)        -> called with one of:
//     { noSpeech: true }     the microphone closed without hearing anything usable
//     { inactivity: true }   no speech for 30 seconds (one-phrase mode)
//     { fallbackOnly: true } 3 recognition failures: use the text box only
//     { error: '<code>' }    a single recognition failure

const INACTIVITY_MS = 30000;  // one-phrase mode: 30 seconds without any speech
const MAX_FAILURES = 3;       // after this many errors, use text fallback only
const MAX_RESTARTS = 300;     // continuous mode: how often the browser may end early and be restarted
const RESTART_DELAY_MS = 120; // wait a moment before restarting a recognition the browser ended
const RESTART_TRIES = 5;      // if start() refuses (still stopping), try again this many times
const MAX_NETWORK_ERRORS = 3; // continuous mode: network errors in a row (without any result) that end the answer
const FINISH_WAIT_MS = 1500;  // after stop(), wait at most this long for the last words

export function createSpeechInput({ lang, onResult, onError, onInterim, doneWords: defaultDoneWords = [] }) {
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
  let doneWords = defaultDoneWords;
  let active = false;        // the continuous answer is not finished yet
  let finishing = false;     // stop() was called; waiting for the last words
  let delivered = false;     // the result (or error) of this answer was already given
  let committed = [];        // text of earlier recognition sessions of this answer
  let session = { final: '', interim: '' }; // text of the current recognition session
  let lastActivityAt = 0;    // when something was last heard (or when listening started)
  let restarts = 0;
  let networkErrors = 0;
  let safetyTimer = null;
  let finishTimer = null;
  let restartTimer = null;

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
    clearTimeout(safetyTimer);
    clearTimeout(finishTimer);
    clearTimeout(restartTimer);
    safetyTimer = null;
    finishTimer = null;
    restartTimer = null;
  }

  // One-phrase mode: the 30-second timer.
  function startTimer() {
    clearTimer();
    inactivityTimer = setTimeout(() => {
      inactivityTimer = null;
      stop();
      notifyError({ inactivity: true });
    }, INACTIVITY_MS);
  }

  // ----- continuous mode -----

  // Everything heard so far in this answer, without a done word at the end.
  function heardSoFar() {
    return splitDoneWord(joinParts([...committed, session.final, session.interim]), doneWords).text;
  }

  // Did the user say a done word?
  function saidDoneWord() {
    return splitDoneWord(joinParts([...committed, session.final, session.interim]), doneWords).done;
  }

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
    // Safety: onend should call deliver first. If the browser never reports the end, force it.
    finishTimer = setTimeout(() => {
      try {
        recognition.abort();
      } catch (err) {
        // Ignore: not every browser has abort() and a stopped recognizer cannot be aborted.
      }
      deliver();
    }, FINISH_WAIT_MS);
  }

  // (Re)start the safety timer: 15 seconds without anything heard end the answer.
  function armSafetyTimer(waitMs = SAFETY_SILENCE_MS) {
    clearTimeout(safetyTimer);
    safetyTimer = setTimeout(() => {
      if (!active || finishing) return;
      if (silenceElapsed(lastActivityAt, Date.now(), currentSafetyMs)) finishNow();
      else armSafetyTimer(currentSafetyMs - (Date.now() - lastActivityAt)); // something was heard meanwhile
    }, Math.max(1, waitMs));
  }
  let currentSafetyMs = SAFETY_SILENCE_MS;

  function startLong(options) {
    longMode = true;
    active = true;
    finishing = false;
    delivered = false;
    committed = [];
    session = { final: '', interim: '' };
    restarts = 0;
    networkErrors = 0;
    lastActivityAt = Date.now();
    doneWords = options.doneWords ?? defaultDoneWords;
    currentSafetyMs = options.safetyMs ?? SAFETY_SILENCE_MS;
    clearLongTimers();
    recognition.continuous = true;
    recognition.interimResults = true;
  }

  // A result event while a continuous answer is running.
  function onLongResult(event) {
    session = transcriptFromResults(event.results);
    if (joinParts([session.final, session.interim]) === '') return;
    lastActivityAt = Date.now();
    restarts = 0;
    networkErrors = 0;
    if (!finishing) armSafetyTimer(currentSafetyMs);
    if (typeof onInterim === 'function') onInterim(heardSoFar());
    if (!finishing && saidDoneWord()) finishNow(); // the user said "done"
  }

  // Try to start the recognition again (after the browser ended it). Silent: the caller sees nothing.
  function restart(triesLeft) {
    restartTimer = setTimeout(() => {
      if (!active || finishing) return;
      try {
        recognition.start();
        listening = true;
      } catch (err) {
        // Still stopping: try again a little later; give up only after several tries.
        if (triesLeft > 1) restart(triesLeft - 1);
        else finishNow();
      }
    }, triesLeft === RESTART_TRIES ? RESTART_DELAY_MS : RESTART_DELAY_MS * 2);
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

    // The browser ended it by itself (a long pause, a network blip): listen again and keep the text.
    if (restarts >= MAX_RESTARTS) {
      finishNow();
      return;
    }
    restarts += 1;
    restart(RESTART_TRIES);
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
    // 'aborted' happens when we call stop() ourselves, and 'no-speech' only means a quiet moment
    // (the browser ends the recognition and we restart it), so neither counts as a failure.
    if (event.error === 'aborted' || event.error === 'no-speech') return;

    if (longMode && event.error === 'network' && active && !finishing) {
      // A passing network problem: onend restarts the recognition. Only many in a row end the answer.
      networkErrors += 1;
      if (networkErrors < MAX_NETWORK_ERRORS) return;
    }

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
   * @param {{continuous?:boolean, lang?:string, doneWords?:string[], safetyMs?:number}} [options]
   *   continuous  listen like a voice message (see above); default: one phrase
   *   lang        language for this answer (default: the language of createSpeechInput)
   *   doneWords   words that end a continuous answer
   *   safetyMs    total silence that ends a continuous answer (default 15 seconds)
   */
  function start(options = {}) {
    if (listening) return;
    // Once 3 failures happened, voice is disabled: tell the caller again.
    if (failureCount >= MAX_FAILURES) {
      notifyError({ fallbackOnly: true });
      return;
    }
    recognition.lang = options.lang ?? lang; // set the language before every start()
    gotResult = false;
    stoppedByUs = false;
    errorReported = false;

    if (options.continuous) {
      startLong(options);
    } else {
      longMode = false;
      active = false;
      recognition.continuous = false;
      recognition.interimResults = false;
    }

    try {
      recognition.start();
      listening = true;
      if (options.continuous) armSafetyTimer(currentSafetyMs);
      else startTimer();
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
