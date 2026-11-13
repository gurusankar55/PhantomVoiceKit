// nav-menu.js
// Shared navigation header (Requirement 16):
//   [ ☰ menu ] [ ← Back ] [ coins ] [ sound ]          [ language dropdown ]
// plus a slide-in drawer with links to Home, Spirit Clerk, Ghost Tutor, Form Translator,
// Ghost Echo, the Sticker book, My documents and Voice notes.
//
// Nothing here touches `document` or `window` when the file is loaded,
// so createScreenHistory can be imported and tested in plain Node.

import { setI18nText, setI18nAttr } from './i18n.js';
import { createRewardsBar } from './celebrate.js';

// ---------------------------------------------------------------------------
// Screen history
// ---------------------------------------------------------------------------

// Keeps track of which in-app screens the user has seen, so Back can return
// to the previous one.
export function createScreenHistory(firstScreen) {
  const stack = [firstScreen];

  return {
    // Remember that `name` is now showing.
    visit(name) {
      const top = stack[stack.length - 1];
      if (name === top) return; // already showing: nothing to do

      const index = stack.indexOf(name);
      if (index !== -1) {
        // Seen before: cut the stack back to it so it never loops.
        stack.length = index + 1;
      } else {
        stack.push(name);
      }
    },

    // Remove the current screen and return the previous one (or null).
    back() {
      if (stack.length <= 1) return null;
      stack.pop();
      return stack[stack.length - 1];
    },

    // Name of the screen being shown now.
    current() {
      return stack[stack.length - 1];
    },

    // True when there is a previous screen to go back to.
    canGoBack() {
      return stack.length > 1;
    },
  };
}

// ---------------------------------------------------------------------------
// Navigation header
// ---------------------------------------------------------------------------

// The pages that can appear in the menu.
const MENU_LINKS = [
  { id: 'home', labelKey: 'nav.home', href: '/' },
  { id: 'spirit-clerk', labelKey: 'nav.spiritClerk', href: '/apps/spirit-clerk/index.html', subtitle: 'Spirit Clerk · Voice Form Filler' },
  { id: 'ghost-tutor', labelKey: 'nav.ghostTutor', href: '/apps/ghost-tutor/index.html', subtitle: 'Ghost Tutor · Voice Teacher' },
  { id: 'form-translator', labelKey: 'nav.formTranslator', href: '/apps/form-translator/index.html', subtitle: 'Phantom Lens · Form Translator' },
  { id: 'ghost-echo', labelKey: 'nav.ghostEcho', href: '/apps/ghost-echo/index.html', subtitle: 'Ghost Echo · Voice Memory Game' },
  { id: 'sticker-book', labelKey: 'nav.stickerBook', href: '/apps/sticker-book/index.html' },
  { id: 'my-documents', labelKey: 'nav.myDocuments', href: '/apps/my-documents/index.html' },
  { id: 'voice-notes', labelKey: 'nav.voiceNotes', href: '/apps/voice-notes/index.html' },
  { id: 'picture-book', labelKey: 'nav.pictureBook', href: '/apps/picture-book/index.html', subtitle: 'Picture Book · Talking Words' },
  { id: 'pumpkin-math', labelKey: 'nav.pumpkinMath', href: '/apps/pumpkin-math/index.html', subtitle: 'Pumpkin Math · Count and Add' },
  { id: 'story-time', labelKey: 'nav.storyTime', href: '/apps/story-time/index.html', subtitle: 'Story Time · Read Aloud' },
];

// Stop any speech that is currently playing (safe if unsupported).
function cancelSpeech() {
  window.speechSynthesis?.cancel();
}

export function createNavMenu(
  headerEl,
  { current, showBack = true, onBack, getLeaveMessage, onLeave } = {}
) {
  // --- Remove any drawer/overlay from an earlier call (avoid duplicates) ---
  document.querySelectorAll('.nav-drawer, .nav-overlay').forEach((el) => el.remove());

  // --- Header bar ----------------------------------------------------------
  headerEl.textContent = '';
  headerEl.classList.add('nav-header');

  const bar = document.createElement('div');
  bar.className = 'nav-bar';

  const leftGroup = document.createElement('div');
  leftGroup.className = 'nav-left';

  // Hamburger button with three lines
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nav-toggle';
  toggle.setAttribute('aria-controls', 'nav-drawer');
  toggle.setAttribute('aria-expanded', 'false');
  setI18nAttr(toggle, 'aria-label', 'nav.openMenu');
  for (let i = 0; i < 3; i++) {
    const line = document.createElement('span');
    line.className = 'nav-toggle-line';
    toggle.appendChild(line);
  }

  // Back button
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'nav-back';
  setI18nAttr(backBtn, 'aria-label', 'nav.backLabel');
  // The arrow is separate so CSS can flip it in right-to-left languages.
  const backArrow = document.createElement('span');
  backArrow.className = 'nav-back-arrow';
  backArrow.setAttribute('aria-hidden', 'true');
  backArrow.textContent = '←';
  const backText = document.createElement('span');
  setI18nText(backText, 'nav.back');
  backBtn.append(backArrow, backText);
  backBtn.hidden = !showBack;

  leftGroup.appendChild(toggle);
  leftGroup.appendChild(backBtn);

  // Right slot: the page passes this to createLanguageDropdown
  const languageEl = document.createElement('div');
  languageEl.className = 'nav-lang';

  bar.appendChild(leftGroup);
  // The coin bag (shared by all apps) and the sound on / off button
  bar.appendChild(createRewardsBar());
  bar.appendChild(languageEl);
  headerEl.appendChild(bar);

  // --- Drawer and overlay --------------------------------------------------
  const drawer = document.createElement('nav');
  drawer.className = 'nav-drawer';
  drawer.id = 'nav-drawer';
  setI18nAttr(drawer, 'aria-label', 'nav.mainMenu');
  drawer.inert = true; // closed: not reachable by keyboard

  const title = document.createElement('p');
  title.className = 'nav-drawer-title';
  setI18nText(title, 'nav.drawerTitle');
  drawer.appendChild(title);

  const links = [];
  for (const item of MENU_LINKS) {
    const a = document.createElement('a');
    a.className = 'nav-link';
    a.href = item.href;

    const icon = document.createElement('span');
    icon.className = 'icon-ghost';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    setI18nText(text, item.labelKey);

    a.appendChild(icon);
    if (item.subtitle) {
      // Big translated name, with the small spooky English name below it.
      const wrapper = document.createElement('span');
      wrapper.className = 'nav-link-text';
      const sub = document.createElement('span');
      sub.className = 'brand-sub';
      sub.lang = 'en';
      sub.dir = 'ltr';
      sub.textContent = item.subtitle;
      wrapper.append(text, sub);
      a.appendChild(wrapper);
    } else {
      a.appendChild(text);
    }

    if (item.id === current) {
      a.classList.add('is-current');
      a.setAttribute('aria-current', 'page');
    }

    a.addEventListener('click', (event) => {
      event.preventDefault();
      closeMenu(false);
      // Already on this page: just close the menu, do not reload.
      if (item.id === current) return;
      goTo(item.href);
    });

    drawer.appendChild(a);
    links.push(a);
  }

  const overlay = document.createElement('div');
  overlay.className = 'nav-overlay';

  document.body.appendChild(drawer);
  document.body.appendChild(overlay);

  // --- Behaviour -----------------------------------------------------------
  let isOpen = false;

  function openMenu() {
    isOpen = true;
    drawer.inert = false;
    drawer.classList.add('is-open');
    overlay.classList.add('is-open');
    document.body.classList.add('nav-open'); // lightly lock page scroll
    toggle.setAttribute('aria-expanded', 'true');
    setI18nAttr(toggle, 'aria-label', 'nav.closeMenu');
    links[0]?.focus();
  }

  // returnFocus: put focus back on the hamburger (used for Escape).
  function closeMenu(returnFocus = false) {
    if (!isOpen) return;
    isOpen = false;
    drawer.classList.remove('is-open');
    overlay.classList.remove('is-open');
    document.body.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
    setI18nAttr(toggle, 'aria-label', 'nav.openMenu');
    drawer.inert = true;
    if (returnFocus) toggle.focus();
  }

  // Leave the page, unless the app asks for confirmation and the user declines.
  function goTo(href) {
    const message = getLeaveMessage?.();
    if (typeof message === 'string' && message !== '' && !window.confirm(message)) {
      return;
    }
    cancelSpeech();
    onLeave?.();
    window.location.href = href;
  }

  toggle.addEventListener('click', () => {
    if (isOpen) closeMenu(true);
    else openMenu();
  });

  overlay.addEventListener('click', () => closeMenu(false));

  backBtn.addEventListener('click', () => {
    // The app may handle Back itself (show its previous screen).
    if (onBack && onBack() === true) {
      cancelSpeech();
      return;
    }
    goTo('/');
  });

  // Escape closes the menu; Tab stays inside the drawer while it is open.
  document.addEventListener('keydown', (event) => {
    if (!isOpen) return;

    if (event.key === 'Escape') {
      closeMenu(true);
      return;
    }

    if (event.key === 'Tab') {
      const first = links[0];
      const last = links[links.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!drawer.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  // Stop speech whenever the page is left or hidden.
  window.addEventListener('pagehide', cancelSpeech);

  return {
    languageEl,
    setBackVisible(visible) {
      backBtn.hidden = !visible;
    },
    closeMenu() {
      closeMenu(false);
    },
  };
}
