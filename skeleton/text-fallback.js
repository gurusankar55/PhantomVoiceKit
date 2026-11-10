// text-fallback.js
// A simple typed-input box used when voice input is unavailable or fails.
// Usage: createTextFallback(containerEl, { onSubmit, onError })

import { validateText, cleanAnswer } from './text-fallback-utils.js';

// Counter so each textarea gets a unique id (needed to link the label to it)
let fallbackCounter = 0;

/**
 * Render a textarea + submit button inside containerEl.
 * @param {HTMLElement} containerEl - where to render the controls
 * @param {{ onSubmit: (text: string) => void, onError: (code: string) => void }} callbacks
 */
export function createTextFallback(containerEl, { onSubmit, onError } = {}) {
  fallbackCounter += 1;
  const textareaId = `text-fallback-input-${fallbackCounter}`;
  const messageId = `text-fallback-message-${fallbackCounter}`;

  // Start with an empty container
  containerEl.innerHTML = '';

  // Accessible label for the textarea
  const label = document.createElement('label');
  label.htmlFor = textareaId;
  label.textContent = 'Type your answer';
  label.className = 'text-fallback-label';

  // The text box itself (max 500 characters)
  const textarea = document.createElement('textarea');
  textarea.id = textareaId;
  textarea.className = 'text-fallback-input';
  textarea.maxLength = 500;
  textarea.rows = 3;
  textarea.setAttribute('aria-describedby', messageId);

  // Inline validation message (hidden until needed)
  const message = document.createElement('p');
  message.id = messageId;
  message.className = 'text-fallback-message';
  message.setAttribute('role', 'alert');
  message.hidden = true;

  // Submit button
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-fallback-submit';
  button.textContent = 'Submit';

  containerEl.append(label, textarea, message, button);

  // Check the text and call the right callback
  function submit() {
    // Remove trailing punctuation/spaces; text with only punctuation counts as empty.
    const value = cleanAnswer(textarea.value);
    const result = validateText(value);

    if (result === 'empty') {
      message.textContent = 'Please type something before submitting.';
      message.hidden = false;
      if (typeof onError === 'function') onError('empty');
      return;
    }

    // Valid: clear any old message and hand the text to the app
    message.textContent = '';
    message.hidden = true;
    if (typeof onSubmit === 'function') onSubmit(value);
  }

  button.addEventListener('click', submit);

  // Enter submits; Shift+Enter falls through and inserts a newline
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  });
}
