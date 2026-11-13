// tools/make-icons.mjs
// Draws the app icon (a softly shaded ghost on a night-purple background) as PNG files for the
// installable app: skeleton/pwa/icons/icon-192.png and icon-512.png.
// Plain Node only (zlib + a tiny PNG writer), no packages. Run:  node tools/make-icons.mjs
//
// The ghost stays inside the middle 80 % circle, so the same image also works as a "maskable"
// icon (phones may cut it into a circle or a rounded square).

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'skeleton', 'pwa', 'icons');

// ---------- PNG writer ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** RGBA pixels (Uint8Array, width*height*4) -> PNG file bytes. */
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows[y * (width * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- drawing (coordinates 0..1) ----------

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

const BG_TOP = hex('#3b2068');
const BG_BOTTOM = hex('#140a26');
const GLOW = hex('#6a45a8');
const WHITE = hex('#ffffff');
const LAVENDER = hex('#bcaee8');
const DARK = hex('#1a0f2e');
const ORANGE = hex('#ffa24d');

function inGhost(x, y) {
  const dx = x - 0.5;
  const dy = y - 0.42;
  if (dx * dx + dy * dy <= 0.22 * 0.22) return true; // the round head
  if (x < 0.28 || x > 0.72 || y < 0.42) return false;
  const wave = 0.035 * Math.cos(((x - 0.28) / 0.44) * Math.PI * 2 * 3); // three soft bumps
  return y <= 0.7 + wave;
}
const inEllipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
function inSparkle(x, y, cx, cy, r) {
  const ax = Math.abs(x - cx) / r;
  const ay = Math.abs(y - cy) / r;
  return Math.sqrt(ax) + Math.sqrt(ay) <= 1; // a four-pointed star
}

// The colour of one point of the icon.
function colourAt(x, y) {
  // Night background with a soft purple glow behind the ghost
  let c = mix(BG_TOP, BG_BOTTOM, y);
  const glow = clamp01(1 - Math.hypot(x - 0.5, y - 0.47) / 0.42);
  c = mix(c, GLOW, glow * glow * 0.55);
  // Soft shadow under the ghost
  if (inEllipse(x, y, 0.5, 0.8, 0.17, 0.028)) c = mix(c, [0, 0, 0], 0.45);
  // An orange sparkle
  if (inSparkle(x, y, 0.77, 0.24, 0.06)) c = ORANGE;
  if (inGhost(x, y)) {
    // Lit from the top left: white there, lavender at the bottom right (soft 3D)
    const shade = clamp01(Math.hypot(x - 0.4, y - 0.28) / 0.48);
    c = mix(WHITE, LAVENDER, shade * shade);
    if (inEllipse(x, y, 0.42, 0.43, 0.036, 0.042) || inEllipse(x, y, 0.58, 0.43, 0.036, 0.042)) c = DARK;
    if (inEllipse(x, y, 0.5, 0.535, 0.032, 0.026)) c = DARK;
    if (inEllipse(x, y, 0.432, 0.418, 0.011, 0.011) || inEllipse(x, y, 0.592, 0.418, 0.011, 0.011)) c = WHITE; // eye glints
  }
  return c;
}

/** The icon as RGBA pixels, with 4 x 4 samples per pixel for smooth edges. */
export function drawIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  const n = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sum = [0, 0, 0];
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const c = colourAt((px + (sx + 0.5) / n) / size, (py + (sy + 0.5) / n) / size);
          sum = sum.map((v, i) => v + c[i]);
        }
      }
      const at = (py * size + px) * 4;
      rgba[at] = Math.round(sum[0] / (n * n));
      rgba[at + 1] = Math.round(sum[1] / (n * n));
      rgba[at + 2] = Math.round(sum[2] / (n * n));
      rgba[at + 3] = 255; // fully opaque (best for "maskable")
    }
  }
  return rgba;
}

// Run as a script: write the two icons.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(OUT, { recursive: true });
  for (const size of [192, 512]) {
    const file = path.join(OUT, `icon-${size}.png`);
    writeFileSync(file, encodePng(size, size, drawIcon(size)));
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }
}
