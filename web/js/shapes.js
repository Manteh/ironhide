// Avatar silhouettes and faceted ("low-poly") shading.
// Every shape is a polygon in a 0..100 box. Polygons clip the face and the frame, and the same points drive the
// bevel, so each facet of the border is lit from the top left like a cut gem.
const TAU = Math.PI * 2;
const f = (n) => +n.toFixed(2);

// build a polygon from a radius function r(theta), then fit it to the box
function polar(fn, n = 180, start = -Math.PI / 2) {
  const pts = Array.from({ length: n }, (_, i) => { const t = start + (i / n) * TAU, r = fn(t - start); return [Math.cos(t) * r, Math.sin(t) * r]; });
  return fit(pts);
}
function fit(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = 98 / Math.max(x1 - x0, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return pts.map(([x, y]) => [f(50 + (x - cx) * s), f(50 + (y - cy) * s)]);
}
const spikes = (n, a, b) => Array.from({ length: n * 2 }, (_, i) => { const t = -Math.PI / 2 + (i / (n * 2)) * TAU, r = i % 2 ? b : a; return [Math.cos(t) * r, Math.sin(t) * r]; });

export const POLYS = {
  seal: polar((t) => 46 + 4 * Math.cos(18 * t)),
  flower: polar((t) => 34 + 14 * Math.abs(Math.cos(4 * t)), 240),
  clover: polar((t) => 30 + 20 * Math.abs(Math.cos(2 * t)), 200),
  starburst: fit(spikes(12, 50, 36)),
  star: fit(spikes(5, 50, 21)),
  blob: polar((t) => 42 + 4 * Math.sin(2 * t + 1) + 3 * Math.sin(3 * t + 2) + 2.2 * Math.sin(5 * t)),
  heart: fit(Array.from({ length: 120 }, (_, i) => { const t = (i / 120) * TAU; return [16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]; })),
  gem: [[24, 4], [76, 4], [98, 34], [50, 98], [2, 34]],
  crystal: [[50, 0], [88, 20], [88, 76], [50, 100], [12, 76], [12, 20]],
  crest: [[50, 0], [78, 9], [99, 5], [97, 46], [86, 76], [50, 100], [14, 76], [3, 46], [1, 5], [22, 9]],
  cat: [[6, 2], [38, 24], [62, 24], [94, 2], [99, 52], [84, 86], [50, 99], [16, 86], [1, 52]],
  bolt: [[58, 0], [14, 56], [44, 56], [30, 100], [86, 40], [54, 40]],
  badge: [[50, 0], [74, 8], [92, 26], [100, 50], [92, 74], [74, 92], [50, 100], [26, 92], [8, 74], [0, 50], [8, 26], [26, 8]],
};
export const POLY_NAMES = Object.keys(POLYS);
export const POLY_LABEL = { seal: 'Seal', flower: 'Flower', clover: 'Clover', starburst: 'Burst', star: 'Star', blob: 'Blob', heart: 'Heart', gem: 'Gem', crystal: 'Crystal', crest: 'Crest', cat: 'Cat', bolt: 'Bolt', badge: 'Badge' };

export const clipOf = (name) => { const p = POLYS[name]; return p ? `polygon(${p.map(([x, y]) => `${x}% ${y}%`).join(',')})` : ''; };

// pick the vertices used for facets: real corners for angular shapes, an even sample for smooth ones
function facetPoints(name) {
  const p = POLYS[name]; if (!p) return null;
  if (p.length <= 16) return p;
  const m = 24; return Array.from({ length: m }, (_, i) => p[Math.floor((i / m) * p.length)]);
}
const LIGHT = -135 * Math.PI / 180;
const shade = (a, b) => { // lighting of an edge from its normal angle
  const mx = (a[0] + b[0]) / 2 - 50, my = (a[1] + b[1]) / 2 - 50, ang = Math.atan2(my, mx);
  return Math.cos(ang - LIGHT);
};

// SVG overlay: a lit bevel ring and (optionally) triangular facets across the face.
// `bw` is the border width as a fraction of the avatar (0..1). Works for any polygon, and falls back to the circle.
export function facetSvg(name, bevel, facets, bw) {
  const P = facetPoints(name) || Array.from({ length: 28 }, (_, i) => { const t = (i / 28) * TAU - Math.PI / 2; return [f(50 + 50 * Math.cos(t)), f(50 + 50 * Math.sin(t))]; });
  const k = 1 - Math.min(0.4, bw) * 2; // inner polygon scale
  const I = P.map(([x, y]) => [f(50 + (x - 50) * k), f(50 + (y - 50) * k)]);
  let out = '';
  for (let i = 0; i < P.length; i++) {
    const j = (i + 1) % P.length, s = shade(P[i], P[j]);
    if (bevel) {
      out += `<path d="M${P[i]}L${P[j]}L${I[j]}L${I[i]}Z" fill="${s > 0 ? `rgba(255,255,255,${f(0.62 * s)})` : `rgba(0,0,0,${f(0.5 * -s)})`}" stroke="rgba(255,255,255,.35)" stroke-width=".35" stroke-linejoin="round"/>`;
    }
    if (facets) {
      // a faceted gem table: each triangle from the centre is lit differently
      const t = shade(I[i], I[j]);
      out += `<path d="M50 50L${I[i]}L${I[j]}Z" fill="${t > 0 ? `rgba(255,255,255,${f(0.16 * t)})` : `rgba(0,0,0,${f(0.22 * -t)})`}" stroke="rgba(255,255,255,.12)" stroke-width=".25"/>`;
    }
  }
  if (bevel) out += `<path d="M${I.map((p) => p.join(' ')).join('L')}Z" fill="none" stroke="rgba(0,0,0,.35)" stroke-width=".5"/><path d="M${P.map((p) => p.join(' ')).join('L')}Z" fill="none" stroke="rgba(255,255,255,.5)" stroke-width=".5"/>`;
  return `<svg class="avf" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${out}</svg>`;
}
