// Sticker book: every sticker that can be won in the games. Found ones are in colour with how
// many times they were won; missing ones are a grey silhouette. Coins and stickers are shared by
// all apps (skeleton/celebrate.js). No network calls.

import { createLanguageDropdown } from '/skeleton/language-dropdown.js';
import { createNavMenu } from '/skeleton/nav-menu.js';
import { initI18n, setI18nText } from '/skeleton/i18n.js';
import { STICKERS } from '/skeleton/stickers.js';
import { getRewards, onRewardsChange } from '/skeleton/celebrate.js';
import { foundCount } from '/skeleton/celebrate-utils.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

const nav = createNavMenu(document.getElementById('app-header'), { current: 'sticker-book' });
createLanguageDropdown(nav.languageEl);

const intro = document.getElementById('book-intro');
const coins = document.getElementById('book-coins');
const grid = document.getElementById('book-grid');

function render(rewards) {
  setI18nText(intro, 'stickerBook.intro', { found: foundCount(rewards), total: STICKERS.length });
  setI18nText(coins, 'stickerBook.coins', { count: rewards.coins });

  grid.textContent = '';
  for (const sticker of STICKERS) {
    const count = rewards.stickers[sticker.id] ?? 0;
    const item = document.createElement('li');
    item.className = count > 0 ? 'book-card' : 'book-card book-card--missing';

    const picture = document.createElement('span');
    picture.className = 'book-picture';
    picture.innerHTML = sticker.svg; // a fixed constant from stickers.js, never user text

    const name = document.createElement('span');
    name.className = 'book-name';
    if (count > 0) setI18nText(name, sticker.nameKey);
    else setI18nText(name, 'stickerBook.missing');

    item.append(picture, name);
    if (count > 0) {
      const times = document.createElement('span');
      times.className = 'book-count';
      setI18nText(times, 'stickerBook.count', { count });
      item.appendChild(times);
    }
    grid.appendChild(item);
  }
}

render(getRewards());
onRewardsChange(render);
