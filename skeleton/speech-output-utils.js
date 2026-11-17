// Pure helper for choosing a speech synthesis voice.
// No browser APIs are used here, so it is easy to test in Node.

// From a list of voices, pick the best one:
// a name containing "Natural" first, then "Online", then the first voice.
// Returns null if the list is empty.
function pickPreferred(matches) {
  if (matches.length === 0) return null;
  const natural = matches.find((v) => v.name && v.name.includes('Natural'));
  if (natural) return natural;
  const online = matches.find((v) => v.name && v.name.includes('Online'));
  if (online) return online;
  return matches[0];
}

// The language part of a tag, lower case: "hi-IN", "hi_IN" (Android) and "hi" all give "hi".
// The old Android code "in" for Indonesian is the same as "id".
function languageOf(tag) {
  const base = String(tag ?? '').split(/[-_]/)[0].toLowerCase();
  return base === 'in' ? 'id' : base;
}

function regionOf(tag) {
  return String(tag ?? '').split(/[-_]/)[1]?.toUpperCase() ?? '';
}

// Every voice that really speaks this language, best first: the exact region, then names with
// "Natural", then names with "Online", then the rest in their own order. A voice of another
// language is never returned, and the Cantonese voice (zh-HK) never stands in for Mandarin.
export function voicesForLanguage(voices, bcp47) {
  const list = Array.isArray(voices) ? voices : [];
  const base = languageOf(bcp47);
  if (base === '') return [];
  const wanted = String(bcp47).replace(/_/g, '-').toLowerCase();
  const asksForHongKong = regionOf(bcp47) === 'HK';
  const same = list.filter((voice) => {
    if (!voice || typeof voice.lang !== 'string' || languageOf(voice.lang) !== base) return false;
    return !(base === 'zh' && regionOf(voice.lang) === 'HK' && !asksForHongKong);
  });
  const points = (voice) =>
    (voice.lang.replace(/_/g, '-').toLowerCase() === wanted ? 100 : 0) +
    (voice.name && voice.name.includes('Natural') ? 10 : 0) +
    (voice.name && voice.name.includes('Online') ? 1 : 0);
  // sort() is stable, so voices with the same points keep the browser's order.
  return [...same].sort((a, b) => points(b) - points(a));
}

// Two voices for the two people of a conversation: a is the best voice, b is the next best voice
// with another name. { distinct: false } means the device has only one voice for this language
// (b is then the same voice; the caller can change its pitch). null when there is no voice.
export function pickVoicePair(voices, bcp47) {
  const ranked = voicesForLanguage(voices, bcp47);
  if (ranked.length === 0) return null;
  const a = ranked[0];
  const idOf = (voice) => voice.voiceURI || voice.name || '';
  const b = ranked.find((voice) => voice !== a && idOf(voice) !== idOf(a));
  return b ? { a, b, distinct: true } : { a, b: a, distinct: false };
}

// Choose a voice for a BCP-47 language tag such as "ta-IN".
// Step 1: voices whose lang matches exactly.
// Step 2: voices whose language prefix matches (e.g. "ta").
// Step 3: nothing found, so return null.
export function selectVoice(voices, bcp47) {
  const list = Array.isArray(voices) ? voices : [];

  // Step 1: exact matches
  const exact = list.filter((v) => v.lang === bcp47);
  if (exact.length > 0) return pickPreferred(exact);

  // Step 2: language-prefix matches
  const prefix = String(bcp47).split('-')[0];
  const partial = list.filter(
    (v) => typeof v.lang === 'string' && v.lang.startsWith(prefix)
  );
  if (partial.length > 0) return pickPreferred(partial);

  // Step 3: no voice available
  return null;
}
