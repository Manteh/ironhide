// 3D poster cards: the card you point at tilts toward the cursor, lifts and scales with a spring, its artwork shifts for depth,
// a highlight follows the cursor and the shadow moves the other way. Everything is smoothed in one rAF loop (no CSS transition
// fighting the cursor), and it settles back softly when you leave.
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const cards = new Map(); // poster element -> { cur, tgt }
let active = null, raf = 0;
const REST = { rx: 0, ry: 0, y: 0, s: 1, gx: 50, gy: 50, ga: 0, ix: 0, iy: 0, is: 1, sx: 0, sy: 0 };
const K = ['rx', 'ry', 'y', 's', 'gx', 'gy', 'ga', 'ix', 'iy', 'is', 'sx', 'sy'];

function write(p, v) {
  p.style.setProperty('--c3d', `perspective(900px) translate3d(0, ${v.y.toFixed(2)}px, 0) rotateX(${v.rx.toFixed(2)}deg) rotateY(${v.ry.toFixed(2)}deg) scale(${v.s.toFixed(4)})`);
  p.style.setProperty('--gx', v.gx.toFixed(1) + '%'); p.style.setProperty('--gy', v.gy.toFixed(1) + '%'); p.style.setProperty('--ga', v.ga.toFixed(3));
  const img = p.querySelector('.bimg'); if (img) img.style.setProperty('transform', `translate3d(${v.ix.toFixed(2)}px, ${v.iy.toFixed(2)}px, 0) scale(${v.is.toFixed(4)})`);
}
function clear(p) {
  for (const n of ['--c3d', '--gx', '--gy', '--ga']) p.style.removeProperty(n);
  const img = p.querySelector('.bimg'); if (img) img.style.removeProperty('transform');
}
function frame() {
  let busy = false;
  for (const [p, st] of cards) {
    const follow = p === active ? 0.2 : 0.11; // follow the cursor briskly, ease back more gently
    let moving = false;
    for (const k of K) { const d = st.tgt[k] - st.cur[k]; st.cur[k] += d * follow; if (Math.abs(d) > (k === 's' || k === 'is' ? 0.0007 : 0.02)) moving = true; }
    write(p, st.cur);
    if (!moving && p !== active) { clear(p); cards.delete(p); } else busy = true;
  }
  raf = busy ? requestAnimationFrame(frame) : 0;
}
const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
function stateOf(p) { let s = cards.get(p); if (!s) { s = { cur: { ...REST }, tgt: { ...REST } }; cards.set(p, s); } return s; }
function release(p) { if (!p) return; const s = cards.get(p); if (s) s.tgt = { ...REST }; if (active === p) active = null; kick(); }

document.addEventListener('pointermove', (e) => {
  if (!fine.matches || reduce.matches || document.documentElement.dataset.motion === 'off' || e.pointerType === 'touch') return;
  const c = e.target.closest?.('.bc:not(.sk)');
  const lay = document.documentElement.dataset.layout;
  const p = c && lay !== 'list' && lay !== 'detail' ? c.querySelector('.bposter') : null;
  if (!p) { release(active); return; }
  if (active !== p) release(active);
  active = p;
  const r = p.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
  const t = stateOf(p).tgt;
  t.ry = px * 16; t.rx = -py * 13; t.y = -9; t.s = 1.085;
  t.gx = (px + 0.5) * 100; t.gy = (py + 0.5) * 100; t.ga = 1;
  t.ix = -px * 10; t.iy = -py * 12; t.is = 1.12;
  t.sx = -px * 22; t.sy = -py * 14 + 10;
  kick();
}, { passive: true });
document.addEventListener('pointerleave', () => release(active));
addEventListener('blur', () => release(active));
document.addEventListener('scroll', () => release(active), { passive: true, capture: true });
