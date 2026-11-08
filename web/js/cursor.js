// A cursor that fits the app: a small dot with a soft ring that follows with a little give.
// It grows over things you can click, squeezes when you press, and steps aside over text fields and in fullscreen.
const KEY = 'cursor';
let dot, ring, raf = 0, x = -100, y = -100, rx = -100, ry = -100, on = false, fine = false;
const fineOk = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
export const cursorWanted = () => localStorage.getItem(KEY) !== 'off';

const LINK = 'a, button, [role="button"], [role="option"], [role="menuitem"], select, summary, label, .bc, .rd, .dd-o, .ctx-i, .seg2 button, [data-do], [data-v], .wp-scrub, .nscrub, input[type="range"], input[type="checkbox"]';
const TEXT = 'input:not([type="range"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]';

function frame() {
  const k = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off' ? 1 : 0.2;
  rx += (x - rx) * k; ry += (y - ry) * k;
  dot.style.transform = `translate(${x}px, ${y}px)`; ring.style.transform = `translate(${rx}px, ${ry}px)`;
  raf = (Math.abs(x - rx) > 0.1 || Math.abs(y - ry) > 0.1) ? requestAnimationFrame(frame) : 0;
}
function move(e) {
  if (e.pointerType === 'touch') return;
  x = e.clientX; y = e.clientY;
  if (!dot.classList.contains('seen')) { rx = x; ry = y; dot.classList.add('seen'); ring.classList.add('seen'); }
  const t = e.target;
  ring.classList.toggle('link', !!t.closest?.(LINK));
  const txt = !!t.closest?.(TEXT); document.documentElement.classList.toggle('cur-text', txt);
  if (!raf) raf = requestAnimationFrame(frame);
}
function apply() {
  const live = on && fine && !document.fullscreenElement;
  document.documentElement.classList.toggle('has-cursor', live);
  if (dot) dot.style.display = ring.style.display = live ? '' : 'none';
}

export function setCursor(want) { localStorage.setItem(KEY, want ? 'on' : 'off'); on = want; apply(); }

export function initCursor() {
  if (dot) return;
  fine = fineOk(); on = cursorWanted();
  dot = document.createElement('div'); dot.className = 'cur-dot'; ring = document.createElement('div'); ring.className = 'cur-ring';
  dot.setAttribute('aria-hidden', 'true'); ring.setAttribute('aria-hidden', 'true');
  document.body.append(ring, dot);
  addEventListener('pointermove', move, { passive: true });
  addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') ring.classList.add('down'); }, true);
  addEventListener('pointerup', () => ring.classList.remove('down'), true);
  document.addEventListener('pointerleave', () => { dot.classList.remove('seen'); ring.classList.remove('seen'); });
  document.addEventListener('fullscreenchange', apply);
  matchMedia('(hover: hover) and (pointer: fine)').addEventListener?.('change', () => { fine = fineOk(); apply(); });
  apply();
}
