// inline-confirm.js
// A question asked inside the page (never window.confirm), for example "Delete this note?":
// the message and two big buttons, the dangerous one in red. Focus goes to Cancel, Escape cancels.
// Shared by "My documents" and "Voice notes". Styles: theme.css (section 17).

import { t } from './i18n.js';

/**
 * Show the question at the end of `container` (any open question there is closed first).
 * @param {HTMLElement} container
 * @param {{message:string, confirmKey:string, cancelKey?:string, onConfirm:()=>void, onCancel?:()=>void}} options
 *   message = the question (plain text); confirmKey / cancelKey = translation keys of the buttons
 * @returns {() => void} a function that closes the question
 */
export function showInlineConfirm(container, { message, confirmKey, cancelKey = 'common.cancel', onConfirm, onCancel }) {
  container.querySelectorAll(':scope > .pvk-confirm').forEach((old) => old.remove());

  const box = document.createElement('div');
  box.className = 'pvk-confirm';
  box.setAttribute('role', 'alertdialog');
  const text = document.createElement('p');
  text.className = 'pvk-confirm-text';
  text.id = `pvk-confirm-${Date.now()}`;
  text.textContent = message; // plain text, never HTML
  box.setAttribute('aria-labelledby', text.id);

  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'btn btn--large pvk-confirm-yes';
  yes.textContent = t(confirmKey);
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'btn btn--large btn--secondary pvk-confirm-no';
  no.textContent = t(cancelKey);

  const buttons = document.createElement('div');
  buttons.className = 'pvk-confirm-buttons';
  buttons.append(yes, no);
  box.append(text, buttons);
  container.appendChild(box);

  const returnFocus = document.activeElement;
  function close(focusBack = true) {
    box.remove();
    if (focusBack && returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus();
  }
  yes.addEventListener('click', () => {
    close(false);
    onConfirm();
  });
  no.addEventListener('click', () => {
    close(true);
    if (typeof onCancel === 'function') onCancel();
  });
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      no.click();
    }
  });
  no.focus();
  return () => close(false);
}
