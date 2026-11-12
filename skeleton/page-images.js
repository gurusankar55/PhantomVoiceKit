// page-images.js
// Turns an uploaded form (a photo or a PDF) into page images in the browser.
// Shared by Phantom Lens · Form Translator and Spirit Clerk, so the pictures that are sent to
// the server are the same pictures the user sees (the boxes the AI returns match them).
//
// A PDF needs the pdf.js script on the page (window.pdfjsLib, loaded from the CDN before app.js).
// Errors are thrown as Error('pdf_failed') or Error('read_failed').

import { loadImage } from './form-overlay.js';
import { limitPages, fitImageSize } from './page-images-utils.js';

// Pages are sent and drawn at this size at most (pixels, long side).
export const MAX_IMAGE_SIDE = 2000;
// Quality of the JPEG page images.
export const JPEG_QUALITY = 0.85;
// pdf.js runs its work in a "worker" file that lives next to the library on the CDN.
const PDFJS_WORKER_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

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

/**
 * Turn an uploaded file into page images: a photo is one page, a PDF has up to 5.
 * @param {File} file  image/jpeg, image/png, image/webp or application/pdf
 * @returns {Promise<{images: {dataUrl:string}[], skipped:number}>}
 *   every dataUrl is a JPEG whose long side is at most MAX_IMAGE_SIDE pixels;
 *   skipped = pages ignored because of the page limit
 */
export function renderPageImages(file) {
  return file.type === 'application/pdf' ? renderPdfFile(file) : renderImageFile(file);
}
