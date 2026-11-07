// The ambient background and cursor spotlight, rebuilt to cost almost nothing per frame:
//  - colours are painted once into a hidden scene which then cross-fades in (opacity only, composited on the GPU), instead of
//    transitioning inherited custom properties on the page root (which re-styles every element, every frame);
//  - the spotlight is a small fixed element moved with transform, instead of a full-screen blended gradient driven by root variables.
// The browse page still decides the colours (it writes --c1..--y3 on <html>); this only changes how they are shown.
const root = document.documentElement;
const el = document.createElement('div');
el.id = 'ihamb';
const scene = () => '<div class="sc"><i class="b1"></i><i class="b2"></i><i class="b3"></i></div>';
el.innerHTML = scene() + scene() + '<i id="ihspot"></i>';
const mount = () => { if (!el.isConnected) document.body.prepend(el); };
if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);
const scenes = [...el.querySelectorAll('.sc')], spot = el.querySelector('#ihspot');
const V = ['--c1', '--c2', '--c3', '--x1', '--y1', '--x2', '--y2', '--x3', '--y3'];
const DEFAULTS = { '--c1': '#3a3f5a', '--c2': '#4a3a5a', '--c3': '#2f4a55', '--x1': '30%', '--y1': '32%', '--x2': '72%', '--y2': '64%', '--x3': '55%', '--y3': '88%' };
const read = () => Object.fromEntries(V.map((k) => [k, root.style.getPropertyValue(k).trim() || DEFAULTS[k]]));
let shown = -1, lastKey = '', timer = 0, lastAt = 0;
function paint(i, v) {
  const sc = scenes[i], b = sc.children;
  [[1, 62], [2, 52], [3, 46]].forEach(([n, pct]) => {
    const blob = b[n - 1];
    blob.style.left = v[`--x${n}`]; blob.style.top = v[`--y${n}`];
    blob.style.background = `radial-gradient(closest-side, color-mix(in srgb, ${v[`--c${n}`]} ${pct}%, transparent), transparent)`;
  });
}
function show(v) {
  const next = shown === 0 ? 1 : 0;
  paint(next, v);
  requestAnimationFrame(() => { scenes[next].classList.add('on'); if (shown >= 0) scenes[shown].classList.remove('on'); shown = next; });
  spot.style.setProperty('--spc', v['--c1']);
}
function check() {
  const v = read(), key = V.map((k) => v[k]).join('|');
  if (key === lastKey) return; lastKey = key;
  const wait = Math.max(0, 380 - (performance.now() - lastAt)); // don't restart a fade every few milliseconds while sweeping across cards
  clearTimeout(timer);
  timer = setTimeout(() => { lastAt = performance.now(); show(read()); }, wait);
}
new MutationObserver(check).observe(root, { attributes: true, attributeFilter: ['style'] });
check(); if (shown < 0) show(read());

// cursor spotlight: moved with transform only
window.__spot = (x, y) => { spot.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`; spot.style.opacity = '1'; };
