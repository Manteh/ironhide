// Chained entrance animations for the title sheet, the versions view and actor profiles.
// Web Animations API on transform + opacity (composited, so they stay at full frame rate while the page works). A short
// motion blur is added only to a handful of small header elements, where it costs almost nothing; big blocks never blur.
// fill: 'backwards' means nothing lingers after an animation ends.
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const off = () => reduce.matches || document.documentElement.dataset.motion === 'off';
const EASE = 'cubic-bezier(.16, 1, .3, 1)';

export function rise(el, { delay = 0, y = 16, x = 0, scale = 1, blur = 0, dur = 560 } = {}) {
  if (!el || off() || !el.animate) return;
  const from = { opacity: 0, transform: `translate3d(${x}px, ${y}px, 0) scale(${scale})` };
  if (blur) from.filter = `blur(${blur}px)`;
  const to = { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' };
  if (blur) to.filter = 'blur(0px)';
  el.animate([from, to], { duration: dur, delay, easing: EASE, fill: 'backwards' });
}

// one after another: each element starts `step` ms after the previous; long lists stop staggering after `max` items
export function chain(els, { start = 0, step = 45, max = 12, ...o } = {}) {
  [...els].filter(Boolean).forEach((el, i) => rise(el, { ...o, delay: start + Math.min(i, max) * step }));
  return start + Math.min([...els].length, max) * step;
}

// the header of the sheet: the whole cascade is done in ~0.4s, so it feels instant but alive
export function heroIn(box, start = 0) {
  const q = (s) => box.querySelector(s), qa = (s) => [...box.querySelectorAll(s)];
  rise(q('.dx-poster'), { delay: start, y: 12, scale: .96, blur: 6, dur: 420 });
  let t = start + 30;
  for (const el of [q('.dx-kick'), q('.dx-title h2'), q('.dx-facts')]) { rise(el, { delay: t, y: 10, blur: 5, dur: 400 }); t += 28; }
  t = chain(qa('.dx-score'), { start: t, step: 22, y: 8, scale: .97, blur: 3, dur: 380 });
  rise(q('.dx-over'), { delay: t, y: 8, blur: 3, dur: 380 }); t += 28;
  t = chain(qa('.dx-acts > .btn, .dx-round > *'), { start: t, step: 20, y: 8, scale: .96, blur: 3, dur: 380 });
  rise(q('.dx-status'), { delay: t, y: 6, dur: 360 });
}

// the full header replaced the instant placeholder: fade in just what's new
export function heroFill(box) {
  const q = (s) => box.querySelector(s), qa = (s) => [...box.querySelectorAll(s)];
  chain(qa('.dx-score'), { start: 0, step: 22, y: 6, scale: .97, dur: 340 });
  rise(q('.dx-over'), { delay: 20, y: 4, dur: 320 });
  rise(q('.dx-status'), { delay: 60, y: 4, dur: 320 });
}

// sections reveal when they scroll into view; their cards chain in
const ITEMS = '.dx-ep, .dx-person, .dx-sim, .dx-rev, .dx-dl > div, .dx-kw > span, .dx-tagline, .dx-sk, .pv-row, .pv-year, .pv-photos > i, .pv-bio';
export function watchSections(scroller, root = scroller) {
  if (!scroller || off() || !('IntersectionObserver' in window)) return () => {};
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const sec = e.target;
      rise(sec.querySelector('.dx-h, .dx-sh'), { y: 10, dur: 380 });
      const items = [...sec.querySelectorAll(ITEMS)].filter((el) => !el.closest('.dx-eps') || el.classList.contains('dx-ep'));
      const sideways = sec.querySelector('.dx-row');
      chain(items.slice(0, 24), { start: 30, step: sideways ? 26 : 22, max: 10, y: sideways ? 0 : 10, x: sideways ? 20 : 0, dur: 420 });
    }
  }, { root: scroller, rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
  const scan = () => root.querySelectorAll('.dx-sec:not([data-rv])').forEach((s) => { s.dataset.rv = '1'; io.observe(s); });
  scan();
  return scan; // call again after new sections are added
}

// versions view: recommended card, then picks, then the list
export function versionsIn(box) {
  const q = (s) => box.querySelector(s), qa = (s) => [...box.querySelectorAll(s)];
  rise(q('.vx-top'), { y: 0, x: 14, dur: 380 });
  rise(q('.vx3-best, .vx2-rec, .vx-l .rec'), { delay: 30, y: 12, scale: .97, blur: 4, dur: 420 });
  let t = chain(qa('.vx-pick'), { start: 80, step: 26, y: 10, scale: .97, dur: 400 });
  rise(q('.vx-head'), { delay: 60, y: 8, dur: 380 }); rise(q('.vx-filters'), { delay: 90, y: 8, dur: 380 });
  chain(qa('.vx-opt'), { start: 110, step: 22, max: 8, x: 16, y: 0, dur: 400 });
  return t;
}

export function personIn(box) {
  const q = (s) => box.querySelector(s), qa = (s) => [...box.querySelectorAll(s)];
  rise(q('.pv-photo'), { delay: 40, y: 18, scale: .94, blur: 8, dur: 640 });
  let t = 110;
  for (const el of [q('.pv-id .dx-kick'), q('.pv-id h2')]) { rise(el, { delay: t, y: 14, blur: 6 }); t += 55; }
  t = chain(qa('.pv-stats > div'), { start: t, step: 45, y: 12, scale: .94 });
  t = chain(qa('.pv-facts > div'), { start: t - 60, step: 35, y: 10 });
  chain(qa('.pv-links > a'), { start: t, step: 30, y: 8 });
}
