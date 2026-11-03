// Command palette: search titles, jump to islands, change theme.
import { api } from './api.js';
import { store, saveSettings } from './main.js';
import { $, $$, esc, icon, posterOf } from './ui.js';

let box;
const COMMANDS = [
  ['Continue watching', '#/continue', 'bookmark'], ['Movies', '#/feed/trending_movies', 'film'], ['Series', '#/feed/trending_shows', 'tv'],
  ['Popular', '#/feed/popular_movies', 'film'], ['Most watched', '#/feed/watched_weekly', 'film'], ['Upcoming', '#/feed/anticipated', 'film'], ['Box office', '#/feed/boxoffice', 'film'],
  ['Open settings', '#/settings/profile', 'user'], ['Open nodes', '#/settings/nodes', 'nodes'], ['Open connectors', '#/settings/connectors', 'plug'], ['Playback preferences', '#/settings/playback', 'sliders'],
  ['Theme: Dark', { theme: 'dark' }, 'moon'], ['Theme: Midnight', { theme: 'midnight' }, 'moon'], ['Theme: Light', { theme: 'light' }, 'sun'], ['Theme: System', { theme: 'system' }, 'monitor'],
];

export function openPalette(prefill = '') {
  if (box) return;
  box = document.createElement('div'); box.className = 'pal';
  box.innerHTML = `<div class="pal-in" role="dialog" aria-label="Search"><div class="pal-q">${icon('search')}<input id="pq" placeholder="Search a title, or type a command" autocomplete="off" spellcheck="false" aria-label="Search"><kbd>esc</kbd></div><div id="pr" class="pal-r"></div></div>`;
  document.body.appendChild(box);
  const input = $('#pq', box), out = $('#pr', box); let sel = 0, items = [], timer, my = 0;

  const close = () => { box.remove(); box = null; document.removeEventListener('keydown', key, true); };
  const go = (it) => {
    close();
    if (it.href) location.hash = it.href;
    else if (it.theme) saveSettings({ appearance: { theme: it.theme } });
  };
  function paint() {
    $$('.pal-i', out).forEach((e, i) => e.classList.toggle('on', i === sel));
    $('.pal-i.on', out)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function render(q, results) {
    const cmds = COMMANDS.filter(([l]) => !q || l.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 4 : 15)
      .map(([label, to, ic]) => ({ kind: 'cmd', label, ic, ...(typeof to === 'string' ? { href: to } : to) }));
    items = [...results.map((r) => ({ kind: 'title', href: `#/title/${r.type}/${r.imdbId}`, r })), ...cmds];
    out.innerHTML = (results.length ? `<div class="pal-strip">${results.map((r, i) => `<div class="pal-i pal-t" data-i="${i}"><div class="pp" style="background-image:url('${esc(r.poster || posterOf(r.imdbId))}')"></div><b>${esc(r.title)}</b><span>${esc(r.year || '')}${r.type === 'series' ? ' · Series' : ''}</span></div>`).join('')}</div>` : '')
      + (cmds.length ? `<div class="pal-cmds">${cmds.map((c, i) => `<div class="pal-i pal-c" data-i="${results.length + i}">${icon(c.ic)}<span>${esc(c.label)}</span></div>`).join('')}</div>` : '')
      + (!results.length && q && !cmds.length ? '<div class="note" style="padding:var(--s6)">No results</div>' : '');
    sel = 0; paint();
    $$('.pal-i', out).forEach((e) => { e.onclick = () => go(items[+e.dataset.i]); e.onmousemove = () => { sel = +e.dataset.i; paint(); }; });
  }
  async function run() {
    const q = input.value.trim(), id = ++my;
    if (q.length < 2) return render(q, []);
    out.dataset.busy = '1';
    const res = await api('/api/catalog/search?q=' + encodeURIComponent(q)).catch(() => []);
    if (id !== my) return;
    delete out.dataset.busy; render(q, res.slice(0, 12));
  }
  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); items[sel] && go(items[sel]); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
  }
  document.addEventListener('keydown', key, true);
  box.addEventListener('pointerdown', (e) => { if (e.target === box) close(); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 220); });
  input.value = prefill; input.focus(); render(prefill, []); if (prefill) run();
}
