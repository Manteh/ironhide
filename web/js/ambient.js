// The ambient background: a soft mesh gradient made from the palette the browse page picks for the poster you point at.
//  - The three colours and a base tone are painted together onto a tiny canvas (overlapping wide radial washes over a filled
//    base), which is stretched over the whole window, so colours flow into each other with no edges and no dark holes.
//  - Two canvases cross-fade when the palette changes, so the light morphs rather than switching; the layer breathes slowly.
//  - Painting happens once per change on a ~64×40 canvas; after that only opacity and transform animate (GPU-composited).
// The browse page writes --c1..--y3 on <html>; this decides how they're shown. The cursor spotlight is a small transformed dot.
const root = document.documentElement;
const el = document.createElement('div');
el.id = 'ihamb';
el.innerHTML = '<canvas class="mesh"></canvas><canvas class="mesh"></canvas><i id="ihspot"></i>';
const mount = () => { if (!el.isConnected) document.body.prepend(el); };
if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);
const meshes = [...el.querySelectorAll('canvas')], spot = el.querySelector('#ihspot');
const W = 64, H = 40;
meshes.forEach((c) => { c.width = W; c.height = H; });

const V = ['--c1', '--c2', '--c3', '--x1', '--y1', '--x2', '--y2', '--x3', '--y3'];
const DEFAULTS = { '--c1': 'hsl(228 38% 36%)', '--c2': 'hsl(262 34% 32%)', '--c3': 'hsl(200 30% 22%)', '--x1': '30%', '--y1': '32%', '--x2': '72%', '--y2': '64%', '--x3': '55%', '--y3': '88%' };
const read = () => Object.fromEntries(V.map((k) => [k, root.style.getPropertyValue(k).trim() || DEFAULTS[k]]));

// parse "hsl(h s% l%)" (what the palette produces) or any CSS colour via a 1px canvas
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function rgba(color, a) {
  const m = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(color);
  if (m) return `hsla(${m[1]} ${m[2]}% ${m[3]}% / ${a})`;
  probe.fillStyle = color; probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data; return `rgba(${r},${g},${b},${a})`;
}
const shade = (color, dl) => { const m = /hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(color); return m ? `hsl(${m[1]} ${m[2]}% ${Math.max(4, Math.min(70, +m[3] + dl))}%)` : color; };

function paint(cv, v) {
  const g = cv.getContext('2d');
  const x = (k) => (parseFloat(v[k]) / 100) * W, y = (k) => (parseFloat(v[k]) / 100) * H;
  // base: a deep, dark version of the palette, so there is never a black hole but there is depth
  const base = g.createLinearGradient(0, 0, W, H);
  base.addColorStop(0, shade(v['--c3'], -12)); base.addColorStop(0.6, shade(v['--c2'], -20)); base.addColorStop(1, shade(v['--c3'], -16));
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.fillStyle = base; g.fillRect(0, 0, W, H);
  // overlapping washes, each reaching into the others so they blend; different sizes and strengths so all three colours show
  const wash = (cx, cy, r, color, a) => {
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    gr.addColorStop(0, rgba(color, a)); gr.addColorStop(0.5, rgba(color, a * 0.5)); gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  };
  wash(x('--x2'), y('--y2'), W * 0.62, v['--c2'], 0.7);
  wash(x('--x3'), y('--y3'), W * 0.55, shade(v['--c3'], 4), 0.6);
  wash(x('--x1'), y('--y1'), W * 0.6, v['--c1'], 0.75);
  wash(W - x('--x1') * 0.7, H * 0.1, W * 0.4, shade(v['--c2'], 4), 0.3); // soft counter-light so one side isn't empty
  // gently darker corners for depth (not a hard vignette)
  const vg = g.createRadialGradient(W * 0.5, H * 0.42, H * 0.35, W * 0.5, H * 0.5, W * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.38)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
}

let shown = -1, lastKey = '', timer = 0;
function show(v) {
  const next = shown === 0 ? 1 : 0;
  paint(meshes[next], v);
  meshes[next].classList.add('on'); if (shown >= 0) meshes[shown].classList.remove('on');
  shown = next;
  spot.style.setProperty('--spc', v['--c1']);
}
function check() {
  const v = read(), key = V.map((k) => v[k]).join('|');
  if (key === lastKey) return; lastKey = key;
  clearTimeout(timer);
  timer = setTimeout(() => show(read()), 60); // coalesce a quick sweep across cards, but respond almost at once
}
new MutationObserver(check).observe(root, { attributes: true, attributeFilter: ['style'] });
check(); if (shown < 0) show(read());

// cursor spotlight: moved with transform only
window.__spot = (x, y) => { spot.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`; spot.style.opacity = '1'; };
window.__ambArt = () => {}; // the blurred-artwork layer was retired; kept as a no-op for callers
