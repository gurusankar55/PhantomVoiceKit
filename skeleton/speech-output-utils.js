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
