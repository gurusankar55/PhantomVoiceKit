// Phantom Lens · Form Translator - app.js
// The user uploads a form (photo or PDF). Each page is sent to the server once;
// the answer is every printed text block with its box and its translation.
// skeleton/form-overlay.js then paints the translation over the page.
// No voice input is needed here.

import { createLanguageDropdown, getCurrentLanguage } from '/skeleton/language-dropdown.js';
import { createSpeechOutput } from '/skeleton/speech-output.js';
import { translateLayout } from '/skeleton/api-client.js';
import { createNavMenu, createScreenHistory } from '/skeleton/nav-menu.js';
import { initI18n, t, setI18nText, clearI18n } from '/skeleton/i18n.js';
import { loadImage, prepareOverlay, drawOverlay } from '/skeleton/form-overlay.js';
import { clampOffset, readingOrder, MIN_OFFSET, MAX_OFFSET } from '/skeleton/form-overlay-utils.js';
import {
  MAX_PAGES,
  limitPages,
  fitImageSize,
  pdfPageSize,
  translatedFilename,
  chunkTexts,
} from '/apps/form-translator/translator-utils.js';

// Load the translations BEFORE the nav and language dropdown are created.
await initI18n();

// ---------- Constants ----------

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_IMAGE_SIDE = 2000; // pages are sent and drawn at this size at most (pixels)
const JPEG_QUALITY = 0.85; // quality of the page images sent to the server
const PDF_JPEG_QUALITY = 0.92; // quality of the pages inside the downloaded PDF
// pdf.js runs its work in a "worker" file that lives next to the library on the CDN.
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

// ---------- Module state ----------

const state = {
  selectedFile: null, // the valid file chosen by the user (kept so it can be translated again)
  working: false, // true while a form is being read and translated
  pages: [], // { canvas, image, blocks, prepared } for each page of the result
  resultLang: 'en-US', // language the pages were translated into
  scaleOffset: 0, // A- / A+ presses away from Auto
  reading: false, // true while "Read aloud" is speaking
  readToken: 0, // bumped whenever reading stops; old speech callbacks check it
};

// ---------- DOM references ----------

const screens = {
  upload: document.getElementById('screen-upload'),
  result: document.getElementById('screen-result'),
};
const fileInput = document.getElementById('file-input');
const fileName = document.getElementById('file-name');
const translateButton = document.getElementById('translate-button');
const uploadMessage = document.getElementById('upload-message');
const uploadLoading = document.getElementById('upload-loading');
const progressText = document.getElementById('progress-text');

const resultNotices = document.getElementById('result-notices');
const sizeSmaller = document.getElementById('size-smaller');
const sizeAuto = document.getElementById('size-auto');
const sizeBigger = document.getElementById('size-bigger');
const downloadButton = document.getElementById('download-pdf');
const readButton = document.getElementById('read-button');
const readLabel = document.getElementById('read-label');
const resultMessage = document.getElementById('result-message');
const pagesContainer = document.getElementById('pages');
const anotherButton = document.getElementById('another-button');

// ---------- Screens and navigation ----------

// Tracks the screens the user has seen (upload is the first one).
const screenHistory = createScreenHistory('upload');

// Show one screen ('upload' | 'result') and hide the other.
function showScreen(name) {
  screenHistory.visit(name);
  for (const [key, el] of Object.entries(screens)) {
    el.hidden = key !== name;
  }
}

// Leave the result screen: stop reading and free the page images.
function leaveResult() {
  stopReading();
  state.pages = [];
  pagesContainer.textContent = '';
  resultNotices.textContent = '';
  resultNotices.hidden = true;
  clearResultMessage();
  showScreen('upload');
}

// Back button. Returns true if we handled it, false to let the nav go Home.
function handleBack() {
  if (!screenHistory.canGoBack()) return false;
  screenHistory.back();
  leaveResult();
  return true;
}

const nav = createNavMenu(document.getElementById('app-header'), {
  current: 'form-translator',
  onBack: handleBack,
  onLeave: () => stopReading(),
});

// The translation language is read from the dropdown when the user presses "Translate".
createLanguageDropdown(nav.languageEl, {});

// ---------- Messages ----------

function showUploadMessage(key, params) {
  setI18nText(uploadMessage, key, params);
  uploadMessage.hidden = false;
}

function clearUploadMessage() {
  clearI18n(uploadMessage);
  uploadMessage.hidden = true;
}

function showResultMessage(key) {
  setI18nText(resultMessage, key);
  resultMessage.hidden = false;
}

function clearResultMessage() {
  clearI18n(resultMessage);
  resultMessage.hidden = true;
}

// Turn a server/client error code into a translation key.
function friendlyError(code) {
  if (code === 'timeout') return 'spiritClerk.errTimeout';
  if (code === 'busy') return 'common.rateLimit'; // every AI model is out of free quota
  if (code === 'network_error') return 'spiritClerk.errNetwork';
  return 'formTranslator.errGeneric';
}

// ---------- Upload screen ----------

// Returns an error message key for a bad file, or '' if the file is fine.
function validateFile(file) {
  if (!ALLOWED_TYPES.includes(file.type)) return 'spiritClerk.errFileType';
  if (file.size > MAX_FILE_BYTES) return 'spiritClerk.errFileSize';
  return '';
}

// Show the translated "No file chosen" text next to the picker button.
function showNoFileChosen() {
  setI18nText(fileName, 'spiritClerk.noFileChosen');
}

// When the user picks a file: check it before anything is sent.
fileInput.addEventListener('change', () => {
  clearUploadMessage();
  state.selectedFile = null;
  translateButton.disabled = true;

  const file = fileInput.files && fileInput.files[0];
  if (!file) {
    showNoFileChosen(); // the user cancelled the picker
    return;
  }

  const problem = validateFile(file);
  if (problem) {
    showNoFileChosen();
    showUploadMessage(problem);
    return;
  }

  // File names are user data, so they are shown as plain text (not translated).
  clearI18n(fileName);
  fileName.textContent = file.name;
  state.selectedFile = file;
  translateButton.disabled = false;
});

// ---------- Turning the file into page images ----------
// Both functions return { images: [{ dataUrl }], skipped } where each dataUrl is a JPEG
// whose long side is at most MAX_IMAGE_SIDE pixels, and skipped = pages ignored (over 5).

// Read a file as a "data:" URL.
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

// A photo: scale it down if it is big and save it as a JPEG.
async function renderImageFile(file) {
  const dataUrl = await readFileAsDataUrl(file);
  let image;
  try {
    image = await loadImage(dataUrl);
  } catch {
    throw new Error('read_failed');
  }

  const size = fitImageSize(image.naturalWidth, image.naturalHeight, MAX_IMAGE_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // JPEG has no see-through pixels: PNG transparency becomes white
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.drawImage(image, 0, 0, size.width, size.height);

  return { images: [{ dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY) }], skipped: 0 };
}

// A PDF: draw each page (the first 5) on a canvas with pdf.js.
async function renderPdfFile(file) {
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error('pdf_failed'); // the library did not load from the CDN
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

  let data;
  try {
    data = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new Error('read_failed');
  }

  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data }).promise;
  } catch {
    throw new Error('pdf_failed'); // damaged or password-protected PDF
  }

  try {
    const { count, skipped } = limitPages(pdf.numPages);
    const images = [];

    for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
      const page = await pdf.getPage(pageNumber);

      // Pick a scale so the long side of the page is about MAX_IMAGE_SIDE pixels.
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(4, MAX_IMAGE_SIDE / Math.max(natural.width, natural.height));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; // PDF pages have no background of their own
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push({ dataUrl: canvas.toDataURL('image/jpeg', JPEG_QUALITY) });

      page.cleanup();
      canvas.width = 0; // let the browser free the memory
    }
    return { images, skipped };
  } catch {
    throw new Error('pdf_failed');
  } finally {
    pdf.destroy();
  }
}

// ---------- Translate ----------

translateButton.addEventListener('click', async () => {
  const file = state.selectedFile;
  if (!file || state.working) return;

  clearUploadMessage();
  state.working = true;
  translateButton.disabled = true;
  uploadLoading.hidden = false;
  setI18nText(progressText, 'formTranslator.preparing');

  const lang = getCurrentLanguage().bcp47;

  try {
    // 1. Page images (a photo is one page; a PDF has up to 5).
    const { images, skipped } = file.type === 'application/pdf' ? await renderPdfFile(file) : await renderImageFile(file);

    // 2. One request per page, one after another.
    const results = [];
    for (let i = 0; i < images.length; i++) {
      setI18nText(progressText, 'formTranslator.progress', { n: i + 1, total: images.length });
      const dataUrl = images[i].dataUrl;
      const imageBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      results.push(await translateLayout({ imageBase64, mimeType: 'image/jpeg', lang }));
    }

    // 3. Draw the result.
    await showResult(images, results, skipped, lang);
  } catch (err) {
    if (err && err.message === 'pdf_failed') showUploadMessage('formTranslator.errPdf');
    else if (err && err.message === 'read_failed') showUploadMessage('spiritClerk.errReadFile');
    else showUploadMessage('formTranslator.errGeneric');
  } finally {
    // Always hide the spinner; keep the file so the user can try again.
    state.working = false;
    uploadLoading.hidden = true;
    translateButton.disabled = state.selectedFile === null;
  }
});

// Build the result screen from the page images and the server answers.
async function showResult(images, results, skipped, lang) {
  const pages = [];
  const notices = []; // { key, params }
  let translatedPages = 0;
  let totalBlocks = 0;
  let firstErrorCode = '';

  for (let i = 0; i < images.length; i++) {
    const image = await loadImage(images[i].dataUrl);
    const page = { canvas: null, image, blocks: [], prepared: [] };
    const result = results[i];

    if (result.error) {
      // This page stays as it was; the other pages still work.
      firstErrorCode = firstErrorCode || result.error;
      notices.push({ key: 'formTranslator.pageFailed', params: { n: i + 1 } });
    } else {
      try {
        const blocks = Array.isArray(result.blocks) ? result.blocks : [];
        page.prepared = prepareOverlay(image, blocks);
        page.blocks = blocks;
        translatedPages += 1;
        totalBlocks += blocks.length;
      } catch {
        notices.push({ key: 'formTranslator.pageFailed', params: { n: i + 1 } });
      }
    }
    pages.push(page);
  }

  // Nothing worked: stay on the upload screen with the reason.
  if (translatedPages === 0) {
    showUploadMessage(friendlyError(firstErrorCode));
    return;
  }
  if (totalBlocks === 0) {
    showUploadMessage('formTranslator.errNoText');
    return;
  }

  if (skipped > 0) notices.push({ key: 'formTranslator.pagesLimited', params: { max: MAX_PAGES } });

  // Fill the result screen.
  state.pages = pages;
  state.resultLang = lang;
  state.scaleOffset = 0;
  clearResultMessage();

  resultNotices.textContent = '';
  for (const notice of notices) {
    const item = document.createElement('li');
    setI18nText(item, notice.key, notice.params);
    resultNotices.appendChild(item);
  }
  resultNotices.hidden = notices.length === 0;

  pagesContainer.textContent = '';
  pages.forEach((page, index) => {
    const figure = document.createElement('figure');
    figure.className = 'page-figure';

    const caption = document.createElement('figcaption');
    caption.id = `page-caption-${index}`;
    setI18nText(caption, 'formTranslator.pageLabel', { n: index + 1, total: pages.length });

    const canvas = document.createElement('canvas');
    canvas.className = 'page-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-labelledby', caption.id);
    page.canvas = canvas;

    figure.append(caption, canvas);
    pagesContainer.appendChild(figure);
  });

  showScreen('result');
  redrawPages();
  setReadingUi(false);
}

// ---------- Preview: A- / Auto / A+ ----------

// Draw every page again with the current text size. Nothing is sent to the server.
function redrawPages() {
  for (const page of state.pages) {
    drawOverlay(page.canvas, page.image, page.prepared, {
      lang: state.resultLang,
      scaleOffset: state.scaleOffset,
    });
  }
  updateSizeButtons();
}

// aria-disabled (not disabled) keeps the keyboard focus on the button.
function updateSizeButtons() {
  sizeSmaller.setAttribute('aria-disabled', String(state.scaleOffset <= MIN_OFFSET));
  sizeBigger.setAttribute('aria-disabled', String(state.scaleOffset >= MAX_OFFSET));
  sizeAuto.setAttribute('aria-disabled', String(state.scaleOffset === 0));
}

function changeSize(newOffset) {
  const offset = clampOffset(newOffset);
  if (offset === state.scaleOffset) return;
  state.scaleOffset = offset;
  redrawPages();
}

sizeSmaller.addEventListener('click', () => changeSize(state.scaleOffset - 1));
sizeBigger.addEventListener('click', () => changeSize(state.scaleOffset + 1));
sizeAuto.addEventListener('click', () => changeSize(0));

anotherButton.addEventListener('click', () => {
  screenHistory.back();
  leaveResult();
});

// ---------- Download PDF ----------

downloadButton.addEventListener('click', () => {
  clearResultMessage();
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF is not loaded');
    if (state.pages.length === 0) return;

    // The text is part of each page picture, so any script (Tamil, Arabic...) shows correctly.
    let doc = null;
    for (const page of state.pages) {
      const size = pdfPageSize(page.canvas.width, page.canvas.height);
      if (doc === null) {
        doc = new window.jspdf.jsPDF({ orientation: size.orientation, unit: 'pt', format: [size.width, size.height] });
      } else {
        doc.addPage([size.width, size.height], size.orientation);
      }
      const picture = page.canvas.toDataURL('image/jpeg', PDF_JPEG_QUALITY);
      doc.addImage(picture, 'JPEG', 0, 0, size.width, size.height);
    }

    doc.save(translatedFilename(state.selectedFile ? state.selectedFile.name : '', state.resultLang, new Date()));
  } catch (err) {
    showResultMessage('formTranslator.pdfError');
  }
});

// ---------- Read aloud ----------

// Show "Read aloud" or "Stop" on the button.
function setReadingUi(on) {
  state.reading = on;
  readButton.classList.toggle('is-speaking', on);
  readButton.setAttribute('aria-pressed', String(on));
  setI18nText(readLabel, on ? 'formTranslator.stopReading' : 'formTranslator.readAloud');
}

function stopReading() {
  state.readToken += 1; // makes callbacks of the speech that is running now do nothing
  window.speechSynthesis?.cancel();
  setReadingUi(false);
}

// Speak all translations in reading order, page by page, a few sentences at a time.
function startReading() {
  clearResultMessage();

  const texts = state.pages.flatMap((page) => readingOrder(page.blocks).map((block) => block.translation));
  const chunks = chunkTexts(texts);
  if (chunks.length === 0) return;

  const speech = createSpeechOutput({ lang: state.resultLang });
  const token = ++state.readToken;
  let next = 0;
  setReadingUi(true);

  function speakNext() {
    if (token !== state.readToken) return; // Stop was pressed
    if (next >= chunks.length) {
      setReadingUi(false);
      return;
    }
    speech.speak(chunks[next++], {
      onEnd: speakNext,
      onError: (info) => {
        if (token !== state.readToken) return;
        setReadingUi(false);
        // No voice for this language in this browser: tell the user.
        if (info && info.audioUnavailable) showResultMessage('formTranslator.audioUnavailable');
      },
    });
  }
  speakNext();
}

readButton.addEventListener('click', () => {
  if (state.reading) stopReading();
  else startReading();
});
