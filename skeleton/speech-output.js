// speech-output.js
// Wraps the browser's speechSynthesis (text-to-speech) API.
//
// Usage:
//   const out = createSpeechOutput({ lang: 'ta-IN' });
//   out.speak('Hello', { onStart, onEnd, onError });
//   out.stop();
//
// For a conversation between two people (Talk & Learn):
//   out.speak(text, { role: 'a' | 'b', rate: 0.7 })  two different voices of the SAME language
//   await out.canSpeak()                              true when the device has a voice for it

import { selectVoice, pickVoicePair } from './speech-output-utils.js';

// How long (ms) we wait for the browser to finish loading its voice list
// before we decide that no voice is available.
const VOICES_WAIT_MS = 1500;

/**
 * Resolve with the list of voices. Browsers (especially Chrome and Edge)
 * often return an empty list on the first call and fill it in later,
 * firing a "voiceschanged" event. We wait briefly for that event.
 */
function loadVoices() {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();

    // Voices are already loaded: nothing to wait for.
    if (voices.length > 0) {
      resolve(voices);
      return;
    }

    let finished = false;

    // Called once, either by the event or by the timer below.
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      synth.removeEventListener('voiceschanged', finish);
      resolve(synth.getVoices());
    }

    synth.addEventListener('voiceschanged', finish);
    const timer = setTimeout(finish, VOICES_WAIT_MS);
  });
}

/**
 * Create a speech output controller for one language.
 * @param {{ lang: string }} options  lang is a BCP-47 code such as "en-US"
 */
export function createSpeechOutput({ lang }) {
  // Remember if the voice list has been loaded already.
  let voicesReady = false;

  /**
   * Speak text aloud.
   * onStart: called right before audio is queued (so the UI can show text).
   * onEnd:   called when the utterance finishes.
   * onError: called with { audioUnavailable: true } if no voice exists,
   *          or with an error object if speaking fails.
   * role:    'a' or 'b' picks one of two different voices of this language (strict: a voice of
   *          another language is never used). Without a role the best voice is used, as before.
   * rate:    speaking speed, 1 is normal (0.7 is slow). pitch: 1 is normal.
   */
  function speak(text, { onStart, onEnd, onError, role, rate, pitch } = {}) {
    // If the browser has no speech synthesis at all, report it.
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      if (onError) onError({ audioUnavailable: true });
      return;
    }

    // Picks a voice and speaks. Runs once voices are available.
    function run(voices) {
      voicesReady = true;
      let voice;
      let voicePitch = pitch;
      if (role === 'a' || role === 'b') {
        const pair = pickVoicePair(voices, lang);
        voice = pair ? pair[role] : null;
        // Only one voice on this device: person B gets a higher pitch so the two can be told apart.
        if (pair && role === 'b' && !pair.distinct) voicePitch = Math.min(2, (pitch ?? 1) + 0.35);
      } else {
        voice = selectVoice(voices, lang);
      }

      // No matching voice: do not speak; the caller shows the text instead.
      if (!voice) {
        if (onError) onError({ audioUnavailable: true });
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = lang;
      if (typeof rate === 'number') utterance.rate = rate;
      if (typeof voicePitch === 'number') utterance.pitch = voicePitch;

      utterance.onend = () => {
        if (onEnd) onEnd();
      };
      utterance.onerror = (event) => {
        if (onError) onError(event);
      };

      // Fire onStart synchronously, before the audio is queued.
      if (onStart) onStart();
      window.speechSynthesis.speak(utterance);
    }

    if (voicesReady) {
      // Voices were loaded before, so we can use them right away.
      run(window.speechSynthesis.getVoices());
    } else {
      // First call: voices may still be loading, so wait briefly.
      loadVoices().then(run);
    }
  }

  /** Resolves true when the device has at least one voice for this language (never another one). */
  async function canSpeak() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return false;
    const voices = await loadVoices();
    if (voices.length > 0) voicesReady = true; // the next speak() can start at once
    return pickVoicePair(voices, lang) !== null;
  }

  /** Stop any speech that is playing or queued. */
  function stop() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }

  return { speak, stop, canSpeak };
}
