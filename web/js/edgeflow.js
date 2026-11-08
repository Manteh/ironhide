// Horizontal rows (Continue watching): instead of being sliced by the row's edge, cards near either end turn away,
// shrink and fade into the distance, like a carousel. Transform + opacity only (composited), recomputed once per frame
// while the row scrolls, from layout positions (offsetLeft), so it never forces extra layout.
const SEL = '.cont-row, .fy-scroll';
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const pending = new Set(); let raf = 0;
// Cards sit on the outside of a cylinder centred on the row: the middle is nearly flat, and towards the ends each card turns
// away and is pulled inward (wrapping round), shrinking and fading, so nothing gets sliced by the row's edge.
// focal point per row: rests on the first card; follows the pointer while it's over the row, eased so it glides
const focus = new WeakMap(); // row -> { cur, tgt, raf }
function restX(row) { const cs = getComputedStyle(row), first = row.firstElementChild; return (parseFloat(cs.paddingLeft) || 0) + (first ? first.offsetWidth / 2 : 100); }
function fState(row) { let f = focus.get(row); if (!f) { f = { cur: restX(row), tgt: null, raf: 0 }; focus.set(row, f); } return f; }
function glide(row) {
  const f = fState(row);
  const tgt = f.tgt ?? restX(row);
  f.cur += (tgt - f.cur) * 0.16;
  apply(row);
  f.raf = Math.abs(tgt - f.cur) > 0.5 ? requestAnimationFrame(() => glide(row)) : 0;
}
const aim = () => {}; // the row no longer follows the pointer (flat row; hover is a CSS lift)
document.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  const row = e.target.closest?.(SEL); if (!row) return;
  // lock onto the centre of the card under the pointer (its untransformed slot): that card then sits perfectly flat and
  // still, so it can't slide out from under the cursor. In a gap between cards nothing changes.
  const card = e.target.closest('.bc'); if (!card || card.parentElement !== row) return;
  aim(row, card.offsetLeft - row.scrollLeft + card.offsetWidth / 2);
}, { passive: true });
document.addEventListener('pointerout', (e) => {
  const row = e.target.closest?.(SEL); if (!row || row.contains(e.relatedTarget)) return;
  aim(row, null);
}, { passive: true });

// Flat, honest row: every card faces you. The only position effect is a soft fade for cards sliding past the window edge,
// so nothing gets sliced. Hover is a simple lift in CSS (perf.css). Opacity only: composited, free every frame.
function apply(row) {
  const w = row.clientWidth, sl = row.scrollLeft;
  const off = reduce.matches || document.documentElement.dataset.motion === 'off';
  const cs = getComputedStyle(row), padL = parseFloat(cs.paddingLeft) || 0;
  for (const c of row.children) {
    if (c.style.transform) c.style.transform = '';
    c.style.visibility = '';
    if (off) { c.style.opacity = ''; continue; }
    const x = c.offsetLeft - sl, cw = c.offsetWidth;
    const outR = x + cw - (w - 8), outL = Math.max(0, padL * 0.35) - x; // how far it sticks past each edge
    const out = Math.max(outR, outL);
    const o = out <= 0 ? 1 : Math.max(0, 1 - out / (cw * 0.9));
    c.style.opacity = o < 0.995 ? o.toFixed(3) : '';
  }
}
// stretch a row to the window's edges while its first card stays lined up with the content column (measured, so it is
// exact at any window size); wider windows therefore show more cards
function bleed(row) {
  const host = row.parentElement; if (!host) return;
  const r = host.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  const L = Math.max(24, Math.round(r.left)), Rt = Math.max(24, Math.round(vw - r.right));
  const key = `${L}|${Rt}`; if (row.dataset.bleed === key) return; row.dataset.bleed = key;
  Object.assign(row.style, { marginLeft: `${-L}px`, marginRight: `${-Rt}px`, paddingLeft: `${L}px`, paddingRight: `${Rt}px`, scrollPaddingLeft: `${L}px` });
}
const flush = () => { raf = 0; for (const r of pending) if (r.isConnected) { bleed(r); apply(r); } pending.clear(); };
export function edgeflow(row) { if (!row) return; pending.add(row); if (!raf) raf = requestAnimationFrame(flush); }
document.addEventListener('scroll', (e) => { if (e.target instanceof Element && e.target.matches(SEL)) edgeflow(e.target); }, { passive: true, capture: true });
addEventListener('resize', () => document.querySelectorAll(SEL).forEach((r) => { const f = focus.get(r); if (f && f.tgt == null) f.cur = restX(r); edgeflow(r); }));
// only when the row itself is (re)built: watching every change on the page did needless work
new MutationObserver((muts) => {
  if (muts.some((m) => m.target.closest?.('#cont') || [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.(SEL) || n.querySelector?.(SEL))))) document.querySelectorAll(SEL).forEach(edgeflow);
}).observe(document.body, { childList: true, subtree: true });

// html.scrolling while the page or any scroller moves (CSS pauses decorative motion and hover effects then)
let scrollT = 0;
document.addEventListener('scroll', () => {
  const h = document.documentElement;
  if (!h.classList.contains('scrolling')) h.classList.add('scrolling');
  clearTimeout(scrollT); scrollT = setTimeout(() => h.classList.remove('scrolling'), 140);
}, { passive: true, capture: true });
