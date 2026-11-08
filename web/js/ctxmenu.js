// Right-click menu in the app's own style.
// openMenu(x, y, items, { title, sub, poster })  items: { label, icon, hint, danger, disabled, act } or { sep: true }
import { esc, icon } from './ui.js';

let cur = null;
export function closeMenu() {
  if (!cur) return; const c = cur; cur = null;
  c.el.classList.remove('in'); setTimeout(() => c.el.remove(), 130);
  document.removeEventListener('pointerdown', c.away, true); document.removeEventListener('keydown', c.key, true);
  removeEventListener('resize', closeMenu); removeEventListener('blur', closeMenu); removeEventListener('wheel', c.wheel, true);
}

export function openMenu(x, y, items, head = {}) {
  closeMenu();
  const list = items.filter(Boolean);
  const el = document.createElement('div'); el.className = 'ctx'; el.setAttribute('role', 'menu');
  el.innerHTML = `${head.title ? `<div class="ctx-h">${head.poster ? `<span class="ctx-p" style="background-image:url('${esc(head.poster)}')"></span>` : ''}<div><b>${esc(head.title)}</b>${head.sub ? `<small>${esc(head.sub)}</small>` : ''}</div></div>` : ''}
    ${list.map((it, i) => it.sep ? '<i class="ctx-s" role="separator"></i>' : `<button type="button" role="menuitem" class="ctx-i ${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon) : '<span class="ctx-n"></span>'}<span class="ctx-l">${esc(it.label)}</span>${it.hint ? `<em>${esc(it.hint)}</em>` : ''}</button>`).join('')}`;
  document.body.appendChild(el);
  const w = el.offsetWidth, h = el.offsetHeight;
  const left = Math.max(8, Math.min(x, innerWidth - w - 8)), top = Math.max(8, Math.min(y, innerHeight - h - 8));
  el.style.left = left + 'px'; el.style.top = top + 'px';
  el.style.transformOrigin = `${x > left + w / 2 ? 'right' : 'left'} ${y > top + h / 2 ? 'bottom' : 'top'}`;
  const btns = [...el.querySelectorAll('.ctx-i:not([disabled])')];
  const run = (b) => { const it = list[+b.dataset.i]; closeMenu(); it.act?.(); };
  el.onclick = (e) => { const b = e.target.closest('.ctx-i'); if (b && !b.disabled) run(b); };
  el.oncontextmenu = (e) => e.preventDefault();
  const away = (e) => { if (!el.contains(e.target)) closeMenu(); };
  const key = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const i = btns.indexOf(document.activeElement), n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i <= 0 ? btns.length - 1 : i - 1); btns[n]?.focus(); }
    else if (e.key === 'Tab') closeMenu();
  };
  const wheel = (e) => { if (!el.contains(e.target)) closeMenu(); };
  cur = { el, away, key, wheel };
  document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true);
  addEventListener('resize', closeMenu); addEventListener('blur', closeMenu); addEventListener('wheel', wheel, { capture: true, passive: true });
  requestAnimationFrame(() => el.classList.add('in'));
}
