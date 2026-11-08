// "Artwork" accent: derive the UI accent from the poster colours the background already follows (--c1 is set by the
// browse page when you point at a card or the hero). Falls back to ember when there is no artwork colour yet.
const root = document.documentElement;
const DEFAULT_TINT = 'hsl(228 38% 36%)'; // the browse page's idle background colour; not artwork, so use ember instead
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let last = '';
function apply() {
  // The interface no longer recolours itself from artwork (it changed buttons and glows on every hover). Only the
  // background light follows the poster now; "Artwork" keeps the app's own neutral accent.
  for (const p of ['--accent', '--accent-2', '--on-accent']) root.style.removeProperty(p);
  return;
  const on = root.dataset.accent === 'auto';
  const key = on + '|' + root.style.getPropertyValue('--c1');
  if (key === last) return; last = key;
  if (!on) { for (const p of ['--accent', '--accent-2', '--on-accent']) root.style.removeProperty(p); return; }
  const m = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(root.style.getPropertyValue('--c1') || '');
  if (!m || root.style.getPropertyValue('--c1').trim() === DEFAULT_TINT) { for (const p of ['--accent', '--accent-2', '--on-accent']) root.style.removeProperty(p); return; }
  const h = +m[1], s = clamp(+m[2] + 28, 62, 94);
  root.style.setProperty('--accent', `hsl(${h} ${s}% 66%)`);
  root.style.setProperty('--accent-2', `hsl(${h} ${clamp(s - 4, 55, 90)}% 53%)`);
  root.style.setProperty('--on-accent', '#100c0a');
}
// --accent is inherited by everything, so changing it restyles the whole page: do it once the pointer settles, when idle
let t = 0;
const later = () => { clearTimeout(t); t = setTimeout(() => (window.requestIdleCallback || setTimeout)(apply, { timeout: 300 }), 420); };
new MutationObserver(later).observe(root, { attributes: true, attributeFilter: ['style', 'data-accent'] });
apply();
