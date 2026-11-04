// The corner button: shows when something new has landed, with a short list. Reading the list marks it as seen.
import { esc } from './ui.js';
import { CHANGELOG } from './changelog.js';

const KEY = 'upd-seen';
const stamp = () => { const u = CHANGELOG[0]; return `${u.version}:${Object.values(u.groups).flat().length}`; };
const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg>';

export function mountBell() {
  const app = document.querySelector('#app'); if (!app || document.querySelector('#updBell')) return;
  const box = document.createElement('div'); box.className = 'ub'; box.id = 'updBell';
  const paint = () => {
    const unread = localStorage.getItem(KEY) !== stamp();
    box.innerHTML = `<button class="ub-btn ${unread ? 'new' : ''}" aria-label="${unread ? 'New updates' : 'Updates'}" aria-expanded="false">${BELL}${unread ? '<span>New update</span>' : ''}</button>
      <div class="ub-pop" hidden><div class="ub-h"><b>What's new</b></div>
        ${CHANGELOG.slice(0, 3).map((u, i) => `<a class="ub-i" href="#/settings/updates"><em>v${esc(u.version)}</em><div><b>${esc(u.title)}${i === 0 && unread ? '<i>New</i>' : ''}</b><small>${esc(u.summary)}</small></div></a>`).join('')}
        <a class="ub-all" href="#/settings/updates">Read all updates</a></div>`;
    const btn = box.querySelector('.ub-btn'), pop = box.querySelector('.ub-pop');
    btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute('aria-expanded', String(!pop.hidden)); if (!pop.hidden) { localStorage.setItem(KEY, stamp()); btn.classList.remove('new'); btn.querySelector('span')?.remove(); } };
    pop.onclick = (e) => { if (e.target.closest('a')) pop.hidden = true; };
  };
  paint(); app.append(box);
  document.addEventListener('click', (e) => { if (!box.contains(e.target)) { const pop = box.querySelector('.ub-pop'); if (pop && !pop.hidden) paint(); } });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.querySelector('.ub-pop').hidden) paint(); });
}
