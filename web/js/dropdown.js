// A dropdown in the app's own style (the browser's built-in one can't be styled).
// makeDropdown(host, { label, options: [[value, text], ...], value, onChange })
import { esc, icon } from './ui.js';

let open = null;
const CHEV = '<svg class="dd-c" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>';

export function closeDropdown() { if (!open) return; const o = open; open = null; o.menu.classList.remove('in'); o.btn.setAttribute('aria-expanded', 'false'); setTimeout(() => o.menu.remove(), 140); document.removeEventListener('pointerdown', o.away, true); document.removeEventListener('keydown', o.key, true); removeEventListener('resize', closeDropdown); removeEventListener('scroll', o.scroll, true); }

export function makeDropdown(host, { label, options, value, onChange }) {
  let cur = String(value ?? '');
  const text = () => (options.find(([v]) => String(v) === cur) || options[0])[1];
  host.classList.add('dd'); host.innerHTML = `<button type="button" class="dd-b" aria-haspopup="listbox" aria-expanded="false" aria-label="${esc(label)}"><span>${esc(text())}</span>${CHEV}</button>`;
  const btn = host.querySelector('.dd-b');
  btn.onclick = () => {
    if (open?.btn === btn) return closeDropdown();
    closeDropdown();
    const menu = document.createElement('div'); menu.className = 'dd-m'; menu.setAttribute('role', 'listbox'); menu.setAttribute('aria-label', label);
    menu.innerHTML = options.map(([v, t]) => `<button type="button" role="option" class="dd-o ${String(v) === cur ? 'on' : ''}" data-v="${esc(v)}" aria-selected="${String(v) === cur}"><span>${esc(t)}</span>${icon('check')}</button>`).join('');
    document.body.appendChild(menu);
    const r = btn.getBoundingClientRect(), below = innerHeight - r.bottom - 16, h = Math.min(menu.scrollHeight, 340);
    menu.style.minWidth = Math.max(r.width, 190) + 'px';
    menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 12) + 'px';
    menu.style.maxHeight = Math.max(160, Math.min(340, below > h ? below : r.top - 16)) + 'px';
    menu.style.top = (below >= Math.min(h, 220) ? r.bottom + 8 : Math.max(8, r.top - 8 - Math.min(h, r.top - 16))) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    const items = [...menu.querySelectorAll('.dd-o')], on = menu.querySelector('.on');
    const pick = (b) => { cur = b.dataset.v; btn.firstElementChild.textContent = text(); closeDropdown(); btn.focus(); onChange?.(cur); };
    menu.onclick = (e) => { const b = e.target.closest('.dd-o'); if (b) pick(b); };
    const away = (e) => { if (!menu.contains(e.target) && !btn.contains(e.target)) closeDropdown(); };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDropdown(); btn.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const i = items.indexOf(document.activeElement), n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1); items[n].focus(); }
      else if (e.key === 'Tab') closeDropdown();
    };
    const scroll = (e) => { if (!menu.contains(e.target)) closeDropdown(); };
    open = { btn, menu, away, key, scroll };
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true); addEventListener('resize', closeDropdown); addEventListener('scroll', scroll, true);
    requestAnimationFrame(() => { menu.classList.add('in'); (on || items[0]).focus({ preventScroll: true }); on?.scrollIntoView({ block: 'center' }); });
  };
  return { set(v) { cur = String(v); btn.firstElementChild.textContent = text(); } };
}
