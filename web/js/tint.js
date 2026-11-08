// Poster colours: sample dominant hues from a poster so the background can take on its mood.
const cache = new Map(), pending = new Map();
const proxied = (u) => `/api/img?u=${encodeURIComponent(u)}`; // same-origin copy so the canvas can read pixels

export function paletteOf(url) {
  if (!url) return Promise.resolve(null);
  if (cache.has(url)) return Promise.resolve(cache.get(url));
  if (pending.has(url)) return pending.get(url);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { let pal = null; try { pal = analyze(img); cache.set(url, pal); } catch {} pending.delete(url); resolve(pal); };
    img.onerror = () => { pending.delete(url); resolve(null); };
    img.src = proxied(url);
  });
  pending.set(url, p);
  return p;
}

// Warm the cache a few at a time so hovering is instant.
export function prefetch(urls, concurrency = 3) {
  const queue = [...new Set(urls)].filter((u) => u && !cache.has(u));
  const next = async () => { while (queue.length) { await paletteOf(queue.shift()); await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 400 }) : setTimeout(r, 40))); } };
  for (let i = 0; i < concurrency; i++) next();
}

function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

// A designed palette from the poster: its most characteristic colour (vivid AND well represented, not merely the biggest
// area), its second distinct colour if it has one, and a deep shade for depth. Then saturation and lightness are set in a
// rich-but-calm range so the three always sit well together. Grey posters get an elegant tinted grey.
function analyze(img) {
  const W = 48, H = 72, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const bins = Array.from({ length: 24 }, () => ({ n: 0, w: 0, s: 0, l: 0, x: 0, y: 0 })); // 15° hue bins
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const [h, s, l] = rgb2hsl(px[i], px[i + 1], px[i + 2]);
    total++;
    if (l < 0.08 || l > 0.94 || s < 0.12) continue;
    const b = bins[Math.floor(h / 15) % 24], w = Math.pow(s, 1.5) * (1 - Math.abs(l - 0.5) * 1.4);
    if (w <= 0) continue;
    const rad = (h * Math.PI) / 180;
    b.n++; b.w += w; b.s += s; b.l += l; b.x += Math.cos(rad) * w; b.y += Math.sin(rad) * w;
  }
  // merge neighbouring bins into hue groups, rank by weight
  const groups = bins.map((b, i) => { const p = bins[(i + 23) % 24], q = bins[(i + 1) % 24]; return { i, w: b.w + 0.5 * (p.w + q.w), b, x: b.x + 0.5 * (p.x + q.x), y: b.y + 0.5 * (p.y + q.y), s: b.n ? b.s / b.n : 0 }; })
    .filter((g) => g.b.n > total * 0.012).sort((a, b) => b.w - a.w);
  const hueOf = (g) => ((Math.atan2(g.y, g.x) * 180) / Math.PI + 360) % 360;
  const css = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  const key = groups[0];
  if (!key || key.s < 0.18) { // essentially monochrome: a quiet tinted grey from whatever hue there is
    const h = key ? hueOf(key) : 225;
    return [css(h, 0.22, 0.34), css(h + 18, 0.18, 0.28), css(h - 14, 0.2, 0.2)];
  }
  const h1 = hueOf(key), sat = Math.min(0.78, Math.max(0.46, key.s * 1.1));
  const second = groups.find((g) => { const d = Math.abs(((hueOf(g) - h1 + 540) % 360) - 180); return d > 40 && g.w > key.w * 0.18; });
  const h2 = second ? hueOf(second) : h1 + 28;
  const s2 = second ? Math.min(0.72, Math.max(0.4, second.s * 1.05)) : sat * 0.9;
  return [css(h1, sat, 0.4), css(h2, s2, 0.34), css(h1 - 24, Math.min(0.6, sat * 0.85), 0.22)];
}
