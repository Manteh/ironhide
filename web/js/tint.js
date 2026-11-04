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

function analyze(img) {
  const W = 36, H = 54, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let avgL = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const [h, s, l] = rgb2hsl(px[i], px[i + 1], px[i + 2]);
    avgL += l; n++;
    if (l < 0.1 || l > 0.94 || s < 0.16) continue;
    const w = s * s * (1 - Math.abs(l - 0.5) * 1.5);
    if (w < 0.01) continue;
    const b = bins[Math.floor(h / 30) % 12];
    b.w += w; b.r += px[i] * w; b.g += px[i + 1] * w; b.b += px[i + 2] * w;
  }
  const ranked = bins.map((b, i) => ({ ...b, i })).filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
  const picked = [];
  for (const b of ranked) {
    if (picked.every((p) => { const d = Math.abs(p.i - b.i); return Math.min(d, 12 - d) >= 2; })) picked.push(b);
    if (picked.length === 3) break;
  }
  const toCss = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  const cols = picked.map((b) => {
    const [h, s, l] = rgb2hsl(b.r / b.w, b.g / b.w, b.b / b.w);
    return [h, Math.min(0.85, Math.max(0.5, s * 1.15)), Math.min(0.56, Math.max(0.36, l))];
  });
  // not enough distinct colour in the poster: derive neighbours of what we have
  const base = cols[0] || [225, 0.28, 0.38];
  while (cols.length < 3) { const k = cols.length; cols.push([(base[0] + (k === 1 ? 38 : -42) + 360) % 360, Math.max(0.3, base[1] * 0.85), Math.max(0.3, base[2] - 0.04)]); }
  return cols.map((c) => toCss(...c));
}
