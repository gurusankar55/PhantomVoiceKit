// server/routes/conversation.js
// POST /api/conversation   (server/index.js mounts this router at /api/conversation)
// Body: { scenario, learnLang, speakLang }
// Reply: { lines: [{ speaker, text, say, meaning }], keyWords: [{ word, say, meaning }] }
//
// Talk & Learn: Gemini writes a short everyday conversation between person A and person B in the
// language the user wants to learn, with a pronunciation guide in the script of the language the
// user speaks and the meaning of every line in that language.

import { Router } from 'express';
import { SCENARIO_IDS, cleanConversation } from '../../apps/talk-learn/talk-utils.js';
import { LANGUAGES } from '../../skeleton/language-dropdown.js';
import { callChecked, countGluedLatin, hasOwnScript } from '../script-check.js';

// The situation of each lesson, in English. Only these texts reach the prompt: the request
// itself only chooses one of them by its id.
export const SCENARIO_PROMPTS = Object.freeze({
  greetings: 'two people meet for the first time and greet each other politely (hello, how are you, nice to meet you)',
  names: 'one person asks the other person for their name and where they are from, and they answer the same questions',
  shop: 'a customer buys a few things at a small neighbourhood shop (asks for an item, asks the price, pays)',
  vegetables: 'a customer buys vegetables and fruit from a seller (asks the price and the weight, asks politely for a lower price, pays)',
  directions: 'a person asks a passer-by how to get to a place nearby (left, right, straight, near, far)',
  taxi: 'a passenger talks to an auto-rickshaw or taxi driver (the place to go to, the fare, where to stop)',
  ticket: 'a traveller buys a bus or train ticket at the counter (the place, how many tickets, the price, the time, the platform)',
  restaurant: 'a customer orders food and drink from a waiter in a restaurant and asks for the bill',
  doctor: 'a patient tells a doctor or a pharmacist what is wrong (pain, fever, for how long) and gets simple advice or medicine',
  colleague: 'a new colleague introduces himself or herself at work and another colleague welcomes them and offers help',
  phone: 'a simple phone call: one person asks to speak to someone, the other says that person is not there, and a message is left',
  bank: 'a customer at a bank counter wants to open an account or put in money, and the clerk asks for simple details',
  hotel: 'a guest checks in at a hotel (a booking, the room, how many nights, the key, the time of breakfast)',
  emergency: 'a person asks for help in an emergency (an accident or a sudden illness) and a helper says they will call the police or an ambulance',
  // Level 2: Daily life
  home: 'two people at home talk about the day: who is cooking, what to eat, tidying up, switching the lights and the fan on and off',
  family: 'one person talks about their family and relatives (mother, father, brother, sister, uncle, aunt, grandparents) and asks about the other person\'s family',
  market: 'a customer bargains politely at a market stall (asks the price, says it is too much, asks for less, agrees, pays)',
  cooking: 'two people cook a simple meal together (ingredients, how much, heat, salt, taste) and one asks the other for a recipe',
  festival: 'two people talk about a festival (what they will do, the food, new clothes, visiting relatives, wishing each other)',
  school: 'a parent talks to a teacher about a child (how the child is doing, homework, school time, fees, a meeting)',
  hospital: 'a patient visits a hospital (registers at the counter, sees the doctor, tests, medicine, the next visit)',
  meeting: 'colleagues in an office meeting (the plan for the week, who does what, a deadline, a question, thanks)',
  salary: 'an employee talks to the accounts person about salary and payments (the date, the amount, a missing part, a bank transfer, a receipt)',
  trip: 'a person books a trip with a travel agent (the place, the dates, the number of people, the price, the tickets and the hotel)',
  postoffice: 'a customer at the post office sends a letter and a parcel (the address, the weight, the price, speed post, a receipt)',
  rent: 'a person looks for a house to rent and talks to the owner (rooms, rent, deposit, water and power, when to move in)',
  // Level 3: Speak with confidence
  opinion: 'two people give and ask for opinions politely about a simple everyday topic (agree, partly agree, disagree, give a reason)',
  yesterday: 'one person tells another what happened yesterday, in the past tense (where they went, who they met, what went wrong, how it ended)',
  tomorrow: 'two people talk about their plans for tomorrow, in the future tense (time, place, who comes, what to bring, a backup plan)',
  complaint: 'a customer makes a polite but firm complaint to a shop or a service about a problem (what is wrong, since when, what they want) and the staff member offers a solution',
  interview: 'a job interview (introduce yourself, experience, strengths, why this job, a question for the interviewer)',
  customercare: 'a customer calls a customer care line about a problem with a bill or a service (account details, the problem, a complaint number, how long it takes)',
  favour: 'one person politely asks another for a favour (explains why, asks, the other agrees or says what they can do, thanks)',
  apology: 'one person apologises for being late or for a mistake, explains briefly, and the other accepts the apology kindly',
  givedirections: 'a person explains to a visitor how to reach their house or a place nearby (landmarks, turns, distance, how long it takes) and the visitor repeats it to check',
  neighbours: 'two neighbours make small talk (the weather, the building or street, children, a festival, offering help)',
});

// A language code such as "hi-IN" or "hi": letters, digits and dashes only.
const CODE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

const baseOf = (code) => String(code).split(/[-_]/)[0].toLowerCase();

/**
 * One of the 20 supported languages for a code ("hi-IN" or just "hi"), or null.
 * The name that goes into the prompt always comes from our own list, never from the request.
 */
export function findLanguage(value) {
  if (typeof value !== 'string' || !CODE_PATTERN.test(value.trim())) return null;
  const code = value.trim().toLowerCase();
  return (
    LANGUAGES.find((language) => language.bcp47.toLowerCase() === code) ??
    LANGUAGES.find((language) => baseOf(language.bcp47) === baseOf(code)) ??
    null
  );
}

/**
 * The instruction for Gemini.
 * @param {string} scenario  one of SCENARIO_IDS
 * @param {{label: string, bcp47: string}} learn  the language to learn
 * @param {{label: string, bcp47: string}} speak  the language the user speaks
 */
export function buildConversationPrompt(scenario, learn, speak) {
  return (
    'You are a friendly language teacher. Write a short, everyday spoken conversation between person A and person B ' +
    `for this situation: ${SCENARIO_PROMPTS[scenario]}. ` +
    `The learner speaks ${speak.label} (BCP-47 code "${speak.bcp47}") and is learning ${learn.label} (BCP-47 code "${learn.bcp47}"). ` +
    'Write 6 to 8 lines. Person A speaks first, then A and B take turns, and person B speaks last. ' +
    'Use a simple, polite, natural spoken style: short sentences (at most 10 words), everyday words, no rare words, no slang, no idioms. ' +
    'For every line give: ' +
    `"speaker" ("A" or "B"); ` +
    `"text" (the line in ${learn.label}, written in its normal script); ` +
    `"say" (how the line sounds when spoken aloud, written with the letters of ${speak.label} so that a ${speak.label} speaker can read it: a pronunciation guide, not a translation); ` +
    `"meaning" (the line translated into ${speak.label}). ` +
    `Also give "keyWords": 4 or 5 important words or very short phrases from the conversation, each with "word" (in ${learn.label}), "say" (its pronunciation in the letters of ${speak.label}) and "meaning" (in ${speak.label}). ` +
    'Every key word must have a different meaning. ' +
    'Reply with JSON only, in exactly this shape: ' +
    '{"lines": [{"speaker": "A", "text": "...", "say": "...", "meaning": "..."}], ' +
    '"keyWords": [{"word": "...", "say": "...", "meaning": "..."}]}.'
  );
}

// Latin letters glued into words of the two non-Latin languages of an answer (see script-check.js).
function brokenWords(result, learn, speak) {
  const check = (value, lang) => countGluedLatin(typeof value === 'string' ? value : '', lang);
  let count = 0;
  for (const line of result.lines) {
    count += check(line?.text, learn.bcp47) + check(line?.say, speak.bcp47) + check(line?.meaning, speak.bcp47);
  }
  for (const entry of Array.isArray(result.keyWords) ? result.keyWords : []) {
    count += check(entry?.word, learn.bcp47) + check(entry?.say, speak.bcp47) + check(entry?.meaning, speak.bcp47);
  }
  return count;
}

// Factory: receives callGemini so tests can pass a fake function.
export function createConversationRouter(callGemini) {
  const router = Router();

  router.post('/', async (req, res) => {
    const { scenario, learnLang, speakLang } = req.body ?? {};

    // Refuse anything that is not one of the 14 lessons or two different supported languages.
    const learn = findLanguage(learnLang);
    const speak = findLanguage(speakLang);
    if (typeof scenario !== 'string' || !SCENARIO_IDS.includes(scenario) || !learn || !speak || baseOf(learn.bcp47) === baseOf(speak.bcp47)) {
      return res.status(400).json({ error: 'invalid_input' });
    }

    const prompt = buildConversationPrompt(scenario, learn, speak);

    try {
      const result = await callChecked(
        callGemini,
        prompt,
        (r) => brokenWords(r, learn, speak),
        (r) => Array.isArray(r?.lines),
        hasOwnScript(learn.bcp47) ? learn.bcp47 : speak.bcp47
      );
      const conversation = cleanConversation(result);
      if (!conversation) {
        return res.status(502).json({ error: 'bad_ai_response' });
      }
      return res.json(conversation);
    } catch (err) {
      // Map known error codes; never expose internals or the API key.
      if (err && err.code === 'timeout') {
        return res.status(504).json({ error: 'timeout' });
      }
      if (err && err.code === 'rate_limit') {
        return res.status(429).json({ error: 'busy' });
      }
      return res.status(502).json({ error: 'gemini_error' });
    }
  });

  return router;
}
