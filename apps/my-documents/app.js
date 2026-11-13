// My documents: every PDF the apps made (Spirit Clerk summary and filled form, Form Translator),
// kept on this device in IndexedDB. Open, Download, Share and Delete. Nothing is uploaded: there
// is no login and no server storage, and this page makes no network calls.

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createNavMenu } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n } from '/skeleton/i18n.js';
import { listDocuments, deleteDocument } from '/skeleton/documents-store.js';
import { APP_NAME_KEYS, totalBytes, formatBytes } from '/skeleton/documents-utils.js';
import { showInlineConfirm } from '/skeleton/inline-confirm.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

const nav = createNavMenu(document.getElementById('app-header'), { current: 'my-documents' });
createLanguageDropdown(nav.languageEl, { onChange: () => render() });

const totalEl = document.getElementById('docs-total');
const messageEl = document.getElementById('docs-message');
const emptyEl = document.getElementById('docs-empty');
const listEl = document.getElementById('docs-list');

let documents = []; // newest first

function showMessage(key, params) {
  setI18nText(messageEl, key, params);
  messageEl.hidden = false;
}

function hideMessage() {
  clearI18n(messageEl);
  messageEl.hidden = true;
}

// "12 Nov 2026, 14:05" in the chosen language.
function formatDate(time) {
  try {
    return new Intl.DateTimeFormat(getCurrentLanguage().bcp47, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(time));
  } catch {
    return new Date(time).toLocaleString();
  }
}

// The file of a document, for sharing.
function fileOf(doc) {
  try {
    return new File([doc.blob], doc.name, { type: 'application/pdf' });
  } catch {
    return null; // very old browsers have no File constructor
  }
}

// Can this browser share this file (Web Share API with files)?
function canShare(file) {
  try {
    return Boolean(file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  } catch {
    return false;
  }
}

// Open the PDF in a new tab (the browser's own PDF viewer).
function openDocument(doc) {
  const url = URL.createObjectURL(doc.blob);
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000); // the new tab has loaded it by then
}

function downloadDocument(doc) {
  const url = URL.createObjectURL(doc.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = doc.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function shareDocument(doc) {
  const file = fileOf(doc);
  if (!canShare(file)) return;
  try {
    await navigator.share({ files: [file], title: doc.name });
  } catch (err) {
    if (err && err.name === 'AbortError') return; // the user closed the share sheet
    showMessage('myDocuments.shareFailed');
  }
}

function askDelete(doc, card) {
  showInlineConfirm(card, {
    message: t('myDocuments.confirmDelete', { name: doc.name }),
    confirmKey: 'common.delete',
    onConfirm: async () => {
      try {
        await deleteDocument(doc.id);
        documents = documents.filter((d) => d.id !== doc.id);
        render();
        showMessage('myDocuments.deleted');
        (listEl.querySelector('button') || totalEl).focus?.();
      } catch {
        showMessage('myDocuments.error');
      }
    },
  });
}

// A big button with an icon and a translated label.
function actionButton(icon, key, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn ${className}`;
  const iconEl = document.createElement('span');
  iconEl.setAttribute('aria-hidden', 'true');
  iconEl.textContent = icon;
  const text = document.createElement('span');
  setI18nText(text, key);
  button.append(iconEl, text);
  button.addEventListener('click', onClick);
  return button;
}

function render() {
  const lang = getCurrentLanguage().bcp47;
  setI18nText(totalEl, 'myDocuments.total', { count: documents.length, size: formatBytes(totalBytes(documents), lang) });
  emptyEl.hidden = documents.length > 0;
  listEl.textContent = '';

  for (const doc of documents) {
    const card = document.createElement('li');
    card.className = 'docs-card';

    const name = document.createElement('p');
    name.className = 'docs-name';
    name.textContent = doc.name; // plain text, never HTML
    name.dir = 'auto';

    const meta = document.createElement('p');
    meta.className = 'docs-meta';
    const appName = APP_NAME_KEYS[doc.app] ? t(APP_NAME_KEYS[doc.app]) : t('myDocuments.otherApp');
    meta.textContent = `${appName} · ${formatDate(doc.createdAt)} · ${formatBytes(doc.size, lang)}`;

    const buttons = document.createElement('div');
    buttons.className = 'docs-buttons';
    buttons.append(
      actionButton('📄', 'myDocuments.open', 'docs-open', () => openDocument(doc)),
      actionButton('⬇️', 'myDocuments.download', 'btn--secondary', () => downloadDocument(doc))
    );
    if (canShare(fileOf(doc))) buttons.append(actionButton('📤', 'myDocuments.share', 'btn--secondary', () => shareDocument(doc)));
    buttons.append(actionButton('🗑️', 'common.delete', 'btn--secondary docs-delete', () => askDelete(doc, card)));

    card.append(name, meta, buttons);
    listEl.appendChild(card);
  }
}

async function load() {
  try {
    documents = await listDocuments();
    hideMessage();
  } catch {
    documents = [];
    showMessage('myDocuments.error');
  }
  render();
}

load();
