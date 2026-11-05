// "Artwork" accent: derive the UI accent from the poster colours the background already follows (--c1 is set by the
// browse page when you point at a card or the hero). Falls back to ember when there is no artwork colour yet.
const root = document.documentElement;
const DEFAULT_TINT = 'hsl(228 38% 36%)'; // the browse page's idle background colour; not artwork, so use ember instead
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let last = '';
function apply() {
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
new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['style', 'data-accent'] });
apply();
