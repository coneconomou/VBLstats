// The Pregame mark: a shot-clock display whose 13 x 9 LED panel shows the alternating possession arrow
// (left side lit, right side dim). Used for the header logo (markSvg) and the app icons (app/make-icon.js).

// L = lit side, R = dim side, . = unlit LED.
export const POSSESSION = [
  '.....L.R.....',
  '....LL.RR....',
  '...LLL.RRR...',
  '..LLLL.RRRR..',
  '.LLLLL.RRRRR.',
  '..LLLL.RRRR..',
  '...LLL.RRR...',
  '....LL.RR....',
  '.....L.R.....',
];

// Everything below is in a 64 x 64 box.
export const COLORS = { lit: '#ffb000', dim: 'rgba(255, 176, 0, .34)', off: '#261d07', housing: '#000' };
export const HOUSING = { x: 4, y: 8, w: 56, h: 42, r: 5, stroke: 2.5 };
export const STAND = [{ x: 27, y: 50, w: 10, h: 6, r: 0 }, { x: 19, y: 55, w: 26, h: 3.5, r: 1.75 }];
const X0 = 10.4, Y0 = 14.6, STEP = 3.6;

// [{ cx, cy, r, color }] for every LED.
export function dots(rows = POSSESSION) {
  return rows.flatMap((row, y) => [...row].map((ch, x) => ({
    cx: +(X0 + x * STEP).toFixed(2),
    cy: +(Y0 + y * STEP).toFixed(2),
    r: ch === '.' ? 1.2 : 1.5,
    color: ch === 'L' ? COLORS.lit : ch === 'R' ? COLORS.dim : COLORS.off,
  })));
}

// Decorative: the header link carries the name.
export function markSvg() {
  const h = HOUSING;
  return '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">'
    + `<rect x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" rx="${h.r}" fill="${COLORS.housing}" stroke="${COLORS.lit}" stroke-width="${h.stroke}"/>`
    + dots().map(d => `<circle cx="${d.cx}" cy="${d.cy}" r="${d.r}" fill="${d.color}"/>`).join('')
    + STAND.map(s => `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.r}" fill="${COLORS.lit}"/>`).join('')
    + '</svg>';
}
