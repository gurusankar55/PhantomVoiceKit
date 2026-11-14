// guide-utils.js
// Pure rules of the "How to use" walkthrough (skeleton/guide.js): the 3 or 4 steps of every app,
// which apps were already shown once, and where to put the speech bubble. No DOM, no network.

// A step points at a real button of the page (the first of its selectors that is visible), or
// at nothing (target: []) when the thing it explains only appears later; the bubble is then
// shown in the middle of the screen. The text of step n is the locale key guide.<app>.<n>.
const S = (...target) => ({ target });

export const GUIDES = Object.freeze({
  'spirit-clerk': [S('.file-picker-button', 'label[for="file-input"]'), S('#upload-confirm'), S()],
  'ghost-tutor': [S('#topic-suggestions'), S('#topic-mic', '#topic-input'), S('#topic-start'), S()],
  'form-translator': [S('.file-picker-button', 'label[for="file-input"]'), S('#translate-button'), S()],
  'ghost-echo': [S('#start-button'), S(), S()],
  'sticker-book': [S('#book-coins'), S('#book-grid'), S()],
  'my-documents': [S('#docs-total'), S('#docs-list', '#docs-empty'), S()],
  'voice-notes': [S('#speak-button', '#note-input'), S('#save-button'), S('#search-input')],
  'picture-book': [S('#pages'), S('#hear-button'), S('#speak-button', '#said-button'), S('#said-button')],
  'pumpkin-math': [S('#levels'), S('#question-card'), S('#pad'), S('#speak-button')],
  'story-time': [S('#story-list'), S(), S()],
  'calm-time': [S('#go-meditate'), S('#go-activity'), S('#go-routine')],
  'voice-translator': [S('#from-select', '#to-select'), S('#speak-button', '#source-text'), S('#translate-button'), S('#mode-chat')],
});

export const GUIDE_SEEN_KEY = 'phantomVoiceKit.guidesSeen';

/** The steps of an app: [{ target: string[], key }], or [] when it has no guide. */
export function guideSteps(appId) {
  const steps = GUIDES[appId];
  if (!steps) return [];
  return steps.map((step, i) => ({ target: step.target, key: `guide.${appId}.${i + 1}` }));
}

/** Every locale key the guides use. */
export function allGuideKeys() {
  return Object.keys(GUIDES).flatMap((id) => guideSteps(id).map((s) => s.key));
}

function readSeen(storage) {
  try {
    const list = JSON.parse(storage?.getItem(GUIDE_SEEN_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** True when the guide of this app was already shown on this device. */
export function hasSeen(storage, appId) {
  return readSeen(storage).includes(appId);
}

/** Remember that the guide was shown (it then only opens with the button). */
export function markSeen(storage, appId) {
  try {
    const seen = readSeen(storage);
    if (!seen.includes(appId)) storage?.setItem(GUIDE_SEEN_KEY, JSON.stringify([...seen, appId]));
    return true;
  } catch {
    return false;
  }
}

/**
 * The first element of `selectors` that is shown on the page, or null.
 * @param {string[]} selectors
 * @param {(selector: string) => any} find      e.g. (s) => document.querySelector(s)
 * @param {(element: any) => boolean} isShown
 */
export function pickTarget(selectors, find, isShown) {
  for (const selector of selectors) {
    const element = find(selector);
    if (element && isShown(element)) return element;
  }
  return null;
}

/**
 * Where the speech bubble goes: under the highlighted button when there is room, else above
 * it; in the middle of the screen when there is nothing to point at. Always inside the screen.
 * @param {{top:number,bottom:number,left:number,width:number}|null} rect   the button (viewport px)
 * @param {{width:number,height:number}} view                              the screen
 * @param {{width:number,height:number}} bubble                            the bubble
 * @returns {{top:number, left:number, side:'below'|'above'|'center'}}
 */
export function placeBubble(rect, view, bubble, gap = 16, margin = 12) {
  const clampLeft = (x) => Math.max(margin, Math.min(x, view.width - bubble.width - margin));
  if (!rect) {
    return { top: Math.max(margin, (view.height - bubble.height) / 2), left: clampLeft((view.width - bubble.width) / 2), side: 'center' };
  }
  const left = clampLeft(rect.left + rect.width / 2 - bubble.width / 2);
  if (rect.bottom + gap + bubble.height + margin <= view.height) return { top: rect.bottom + gap, left, side: 'below' };
  if (rect.top - gap - bubble.height >= margin) return { top: rect.top - gap - bubble.height, left, side: 'above' };
  return { top: Math.max(margin, view.height - bubble.height - margin), left, side: 'below' };
}
