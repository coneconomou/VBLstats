// Draws the Pregame app icon (src/mark.js on black) into:
//   app/icon.png (256px, rounded: favicon + Mac app), app/icon.ico (16-256px, Windows shortcuts),
//   app/apple-touch-icon.png (180px, square: iPhone/iPad home screen, iOS rounds the corners itself),
//   app/icon-192.png + app/icon-512.png (square, mark inside the safe zone: Android home screen).
// No dependencies: a tiny anti-aliased rasteriser + PNG/ICO writer.
// Run `node app/make-icon.js` after changing the mark, then `npm run install-app` to refresh shortcuts.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { COLORS, HOUSING, STAND, dots } from '../src/mark.js';

const SS = 4; // subsamples per pixel side
const BG = '#000';

function rgba(css) {
  if (css.startsWith('#')) {
    const hex = css.length === 4 ? [...css.slice(1)].map(c => c + c).join('') : css.slice(1);
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(1);
  }
  const [r, g, b, a = 1] = css.match(/[\d.]+/g).map(Number);
  return [r, g, b, a];
}

const inCircle = (c) => (x, y) => (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r ** 2;
const inRoundRect = (q) => (x, y) => {
  const dx = Math.max(q.x + q.r - x, 0, x - (q.x + q.w - q.r));
  const dy = Math.max(q.y + q.r - y, 0, y - (q.y + q.h - q.r));
  return x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h && dx * dx + dy * dy <= q.r * q.r;
};

// Shapes in icon pixels, painted in order: [test, bbox, color].
// radius: corner rounding as a share of the size (0 = square). scale: how much of the icon the mark fills.
function shapes(size, { radius = 0.225, scale = 0.76 } = {}) {
  const pad = size * (1 - scale) / 2, k = size * scale / 64;
  const map = (q) => ({ x: pad + q.x * k, y: pad + q.y * k, w: q.w * k, h: q.h * k, r: q.r * k });
  const rr = (q, color) => [inRoundRect(q), [q.x, q.y, q.x + q.w, q.y + q.h], color];
  const h = HOUSING, half = h.stroke / 2;
  const out = [
    rr({ x: 0, y: 0, w: size, h: size, r: size * radius }, BG),
    rr(map({ x: h.x - half, y: h.y - half, w: h.w + h.stroke, h: h.h + h.stroke, r: h.r + half }), COLORS.lit),
    rr(map({ x: h.x + half, y: h.y + half, w: h.w - h.stroke, h: h.h - h.stroke, r: h.r - half }), COLORS.housing),
  ];
  for (const d of dots()) {
    const c = { cx: pad + d.cx * k, cy: pad + d.cy * k, r: d.r * k };
    out.push([inCircle(c), [c.cx - c.r, c.cy - c.r, c.cx + c.r, c.cy + c.r], d.color]);
  }
  for (const s of STAND) out.push(rr(map(s), COLORS.lit));
  return out;
}

export function render(size, opts) {
  const px = new Float64Array(size * size * 4); // premultiplied RGBA, 0..1
  for (const [test, [x0, y0, x1, y1], css] of shapes(size, opts)) {
    const [r, g, b, a] = rgba(css);
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(size, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(size, Math.ceil(x1)); x++) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
          if (test(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hits++;
        }
        if (!hits) continue;
        const cov = a * hits / (SS * SS), i = (y * size + x) * 4;
        px[i] = r / 255 * cov + px[i] * (1 - cov);
        px[i + 1] = g / 255 * cov + px[i + 1] * (1 - cov);
        px[i + 2] = b / 255 * cov + px[i + 2] * (1 - cov);
        px[i + 3] = cov + px[i + 3] * (1 - cov);
      }
    }
  }
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    for (let c = 0; c < 3; c++) out[i + c] = a ? Math.round(px[i + c] / a * 255) : 0;
    out[i + 3] = Math.round(a * 255);
  }
  return out;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function png(size, opts) {
  const rgbaBuf = render(size, opts), stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgbaBuf.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO with PNG-compressed entries (Windows Vista and later).
export function ico(sizes) {
  const images = sizes.map(png);
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = s >= 256 ? 0 : s; head[e + 1] = s >= 256 ? 0 : s;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(images[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += images[i].length;
  });
  return Buffer.concat([head, ...images]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = new URL('.', import.meta.url);
  writeFileSync(new URL('icon.png', dir), png(256));
  writeFileSync(new URL('icon.ico', dir), ico([16, 24, 32, 48, 64, 256]));
  writeFileSync(new URL('apple-touch-icon.png', dir), png(180, { radius: 0, scale: 0.8 }));
  // Android may crop to a circle: keep the mark inside the middle 80% ("maskable" safe zone).
  for (const s of [192, 512]) writeFileSync(new URL(`icon-${s}.png`, dir), png(s, { radius: 0, scale: 0.62 }));
  console.log('Wrote app/icon.png, icon.ico, apple-touch-icon.png, icon-192.png and icon-512.png');
}
