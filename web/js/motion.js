// Directional motion blur for horizontally scrolling rows: the faster a row moves, the more it smears sideways.
// One shared SVG filter (blur on the x axis only); applied to a row only while it is moving.
const NS = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(NS, 'svg');
svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.cssText = 'position:absolute;pointer-events:none';
svg.innerHTML = '<filter id="ih-hblur" x="-5%" y="0" width="110%" height="100%" color-interpolation-filters="sRGB"><feGaussianBlur id="ih-hblur-s" stdDeviation="0 0"/></filter>';
document.addEventListener('DOMContentLoaded', () => document.body.append(svg));
if (document.body) document.body.append(svg);
const std = () => svg.querySelector('#ih-hblur-s');
if (matchMedia('(prefers-reduced-motion: reduce)').matches) { /* no blur */ } else {
  let el = null, lastX = 0, lastT = 0, sd = 0, raf = 0, idle = 0;
  const tick = () => {
    const quiet = performance.now() - idle > 90;
    sd *= quiet ? 0.7 : 1; // ease out after the scroll stops
    if (sd < 0.15) { sd = 0; if (el) el.style.filter = ''; el = null; std().setAttribute('stdDeviation', '0 0'); raf = 0; return; }
    std().setAttribute('stdDeviation', `${sd.toFixed(2)} 0`);
    raf = requestAnimationFrame(tick);
  };
  document.addEventListener('scroll', (e) => {
    const t = e.target; if (!(t instanceof Element) || document.documentElement.dataset.motion === 'off') return;
    const ox = getComputedStyle(t).overflowX; if ((ox !== 'auto' && ox !== 'scroll') || t.scrollWidth <= t.clientWidth + 2) return;
    const now = performance.now();
    if (el !== t) { if (el) el.style.filter = ''; el = t; lastX = t.scrollLeft; lastT = now; }
    const dt = Math.max(8, now - lastT), v = Math.abs(t.scrollLeft - lastX) / dt * 16; // px per frame
    lastX = t.scrollLeft; lastT = now; idle = now;
    sd = Math.max(sd * 0.6, Math.min(7, v * 0.1));
    if (sd > 0.6) t.style.filter = 'url(#ih-hblur)';
    if (!raf) raf = requestAnimationFrame(tick);
  }, true);
}
