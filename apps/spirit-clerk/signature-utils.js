// signature-utils.js
// Pure helpers for the signature pad and for placing a drawn signature on the original form.
// No browser or DOM access here, so they are easy to test. A signature is only ever DRAWN by the
// user: nothing here makes up or types a signature.

// A pixel counts as part of the signature when it is at least this opaque (0 to 255).
export const INK_ALPHA = 24;

/**
 * The rectangle around everything that was drawn.
 * @param {{data: Uint8ClampedArray|number[], width:number, height:number}} image  RGBA pixels
 * @returns {{x:number, y:number, w:number, h:number} | null}  null when nothing was drawn
 */
export function inkBounds(image) {
  const { data, width, height } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] >= INK_ALPHA) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Grow a rectangle by `pad` pixels on every side, kept inside the image.
 */
export function growRect(rect, pad, width, height) {
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  const right = Math.min(width, rect.x + rect.w + pad);
  const bottom = Math.min(height, rect.y + rect.h + pad);
  return { x, y, w: right - x, h: bottom - y };
}

// Where to draw the picture inside a box (shape kept, centred): shared with the form overlay.
export { fitInBox } from '../../skeleton/form-overlay-utils.js';

/** The middle of two points (used to draw smooth curves between pen positions). */
export function midPoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Is a signature big enough to count? A tiny dot or a single touch is not a signature.
 * @param {{w:number, h:number} | null} bounds  from inkBounds
 * @param {number} [minSize]  smallest width or height in pixels (default 12)
 */
export function isRealSignature(bounds, minSize = 12) {
  return bounds !== null && (bounds.w >= minSize || bounds.h >= minSize) && bounds.w * bounds.h >= minSize * 4;
}
