// Search: instant, smart, keyboard-first.
//  - Every keystroke: titles you already know (history, shelf, what's on screen) match instantly on this device, while the
//    server's smart search answers in the background (the previous request is cancelled, answers are cached).
//  - The server understands intent: "korean thriller", "sci-fi 2024", "90s horror series", "like interstellar", actor names.
//  - Empty search shows your recent searches, recently opened titles and a few picks for you.
//  - Keys: ↑↓ move, Enter opens details, ⌘/Ctrl+Enter plays, Esc closes.
import { api } from './api.js';
import { store, saveSettings, quickPlay } from './main.js';
import { $, $$, esc, icon, posterOf } from './ui.js';

let box;
const COMMANDS = [
  ['Continue watching', '#/continue', 'bookmark'], ['Movies', '#/feed/trending_movies', 'film'], ['Series', '#/feed/trending_shows', 'tv'],
  ['Popular', '#/feed/popular_movies', 'film'], ['Most watched', '#/feed/watched_weekly', 'film'], ['Upcoming', '#/feed/anticipated', 'film'], ['Box office', '#/feed/boxoffice', 'film'],
  ['Taste Lab: rate and compare', '#/taste', 'heart'], ['Your taste and profile', '#/profile', 'user'], ['Open settings', '#/settings/profile', 'user'], ['Playback preferences', '#/settings/playback', 'sliders'], ['Open connectors', '#/settings/connectors', 'plug'],
  ['Theme: Dark', { theme: 'dark' }, 'moon'], ['Theme: Midnight', { theme: 'midnight' }, 'moon'], ['Theme: Light', { theme: 'light' }, 'sun'], ['Theme: System', { theme: 'system' }, 'monitor'],
];
const TRY = ['korean thriller', 'sci-fi series 2024', 'like interstellar', '90s horror', 'anime films', 'comedy series'];

// ---- remembered searches and opened titles (this device) ----
const LS = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const recentQ = () => LS.get('ih-recent-q', []);
const rememberQ = (q) => { q = q.trim(); if (q.length < 2 || q.startsWith('person:')) return; LS.set('ih-recent-q', [q, ...recentQ().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8)); };
const forgetQ = (q) => LS.set('ih-recent-q', recentQ().filter((x) => x !== q));
const recentT = () => LS.get('ih-recent-t', []);
const rememberT = (r) => LS.set('ih-recent-t', [{ imdbId: r.imdbId, type: r.type, title: r.title, year: r.year, poster: r.poster }, ...recentT().filter((x) => x.imdbId !== r.imdbId)].slice(0, 10));

// ---- instant local matches: titles this device already knows about ----
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function localPool() {
  const m = new Map();
  const add = (x) => { if (x?.imdbId && x.title && !m.has(x.imdbId)) m.set(x.imdbId, { imdbId: x.imdbId, type: x.type === 'tv' || x.type === 'series' ? 'series' : 'movie', title: x.title, year: x.year || '', poster: x.poster || posterOf(x.imdbId), local: true }); };
  (store.history || []).forEach((h) => add({ ...h, poster: posterOf(h.imdbId) }));
  (store.watchlist || []).forEach(add);
  recentT().forEach(add);
  document.querySelectorAll('.bc[data-id]').forEach((c) => add({ imdbId: c.dataset.id, type: c.dataset.type, title: c.dataset.title, year: c.dataset.year, poster: c.dataset.poster }));
  return [...m.values()];
}
function localMatch(pool, q) {
  const n = norm(q); if (n.length < 1) return [];
  return pool.map((x) => { const t = norm(x.title); const s = t === n ? 3 : t.startsWith(n) ? 2 : t.split(' ').some((w) => w.startsWith(n)) ? 1.5 : t.includes(n) ? 1 : 0; return { x, s }; })
    .filter((r) => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 6).map((r) => r.x);
}
const mark = (title, q) => {
  const t = esc(title), n = q.trim(); if (!n || n.includes(':')) return t;
  const i = norm(title).indexOf(norm(n)); if (i < 0) return t;
  // norm() keeps length for plain titles; fall back to no highlight when accents/punctuation shift positions
  if (norm(title) !== title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()) return t;
  const raw = String(title); const start = raw.toLowerCase().indexOf(n.toLowerCase()); if (start < 0) return t;
  return `${esc(raw.slice(0, start))}<mark>${esc(raw.slice(start, start + n.length))}</mark>${esc(raw.slice(start + n.length))}`;
};

export function openPalette(prefill = '', opts = {}) {
  if (box) return;
  box = document.createElement('div'); box.className = 'pal sx';
  box.innerHTML = `<div class="pal-in sx-in" role="dialog" aria-label="Search">
    <div class="pal-q sx-q">${icon('search')}<input id="pq" placeholder="Search titles, people, or try “korean thriller”" autocomplete="off" spellcheck="false" aria-label="Search"><span class="sx-spin" hidden></span><kbd>esc</kbd></div>
    <div id="pr" class="sx-body"></div>
    <footer class="sx-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> details</span><span><kbd>⌘</kbd><kbd>↵</kbd> play</span><span><kbd>esc</kbd> close</span></footer></div>`;
  document.body.appendChild(box);
  const input = $('#pq', box), out = $('#pr', box), spin = $('.sx-spin', box);
  const pool = localPool(), cache = new Map();
  let sel = 0, items = [], timer = 0, ctrl = null, my = 0, override = '', last = null;

  const close = () => { ctrl?.abort(); box.remove(); box = null; document.removeEventListener('keydown', key, true); };
  const go = (it, play = false) => {
    if (!it) return;
    if (it.kind === 'recent') { input.value = it.q; override = ''; run(true); return; }
    if (it.kind === 'try') { input.value = it.q; override = ''; run(true); return; }
    if (it.kind === 'person') { override = `person:${it.p.id}`; input.value = it.p.name; run(true); return; }
    if (it.kind === 'title') {
      rememberQ(input.value); rememberT(it.r);
      if (opts.pick) { close(); opts.pick(it.r); return; }
      close();
      if (play) quickPlay({ imdbId: it.r.imdbId, type: it.r.type, title: it.r.title, poster: it.r.poster, ...(it.r.progress?.season ? { season: it.r.progress.season, episode: it.r.progress.episode } : {}) });
      else location.hash = `#/title/${it.r.type}/${it.r.imdbId}`;
      return;
    }
    close();
    if (it.href) location.hash = it.href; else if (it.theme) saveSettings({ appearance: { theme: it.theme } });
  };
  function paint() {
    $$('[data-i]', out).forEach((e) => e.classList.toggle('on', +e.dataset.i === sel));
    $(`[data-i="${sel}"]`, out)?.scrollIntoView({ block: 'nearest' });
  }
  const bind = () => $$('[data-i]', out).forEach((e) => {
    e.onclick = (ev) => { if (ev.target.closest('[data-x]')) return; go(items[+e.dataset.i], !!ev.target.closest('[data-play]')); };
    e.onmousemove = () => { if (sel !== +e.dataset.i) { sel = +e.dataset.i; paint(); } };
  });
  const meta = (r) => [r.year, r.type === 'series' ? 'Series' : 'Film', r.rating && `★ ${r.rating}`].filter(Boolean).join(' · ');
  const prog = (r) => (r.progress ? `<span class="sx-prog">${r.progress.season ? `S${r.progress.season}E${r.progress.episode} · ` : ''}${r.progress.pct}%</span>` : '');

  // ---- empty: recents, recently opened, ideas ----
  function home() {
    items = []; const rq = recentQ(), rt = recentT();
    const cmds = COMMANDS.slice(0, 6).map(([label, to, ic]) => ({ kind: 'cmd', label, ic, ...(typeof to === 'string' ? { href: to } : to) }));
    let html = '';
    if (rq.length) html += `<section><h5>Recent searches</h5><div class="sx-recent">${rq.map((q) => { items.push({ kind: 'recent', q }); return `<span class="sx-rq" data-i="${items.length - 1}">${icon('refresh')}${esc(q)}<button data-x="${esc(q)}" aria-label="Remove">${icon('x')}</button></span>`; }).join('')}</div></section>`;
    if (rt.length) html += `<section><h5>Jump back in</h5><div class="sx-strip">${rt.slice(0, 8).map((r) => { items.push({ kind: 'title', r }); return `<div class="sx-card" data-i="${items.length - 1}"><i style="background-image:url('${esc(r.poster || posterOf(r.imdbId))}')"></i><b>${esc(r.title)}</b><small>${esc(r.year || '')}</small></div>`; }).join('')}</div></section>`;
    html += `<section><h5>Try</h5><div class="sx-recent">${TRY.map((q) => { items.push({ kind: 'try', q }); return `<span class="sx-rq try" data-i="${items.length - 1}">${icon('search')}${esc(q)}</span>`; }).join('')}</div></section>`;
    html += `<section><h5>Go to</h5><div class="sx-cmds">${cmds.map((c) => { items.push(c); return `<div class="sx-cmd" data-i="${items.length - 1}">${icon(c.ic)}<span>${esc(c.label)}</span></div>`; }).join('')}</div></section>`;
    out.innerHTML = html; sel = 0; paint(); bind();
    $$('[data-x]', out).forEach((b) => (b.onclick = (e) => { e.stopPropagation(); forgetQ(b.dataset.x); home(); }));
  }

  // ---- results ----
  function render(q, data, pending) {
    const local = localMatch(pool, q);
    const server = data?.titles || [];
    const have = new Set(server.map((x) => x.imdbId));
    const titles = data ? [...server, ...(override ? [] : local.filter((x) => !have.has(x.imdbId)).slice(0, 2))] : local;
    const people = data?.people || [];
    const cmds = override ? [] : COMMANDS.filter(([l]) => l.toLowerCase().includes(q.toLowerCase())).slice(0, 3).map(([label, to, ic]) => ({ kind: 'cmd', label, ic, ...(typeof to === 'string' ? { href: to } : to) }));
    items = [];
    const hq = override ? '' : q;
    let topHtml = '';
    if (data?.personFirst && people[0]) {
      const p = people[0]; items.push({ kind: 'person', p });
      topHtml = `<div class="sx-top sx-person" data-i="0"><i class="sx-ph" style="background-image:url('${esc(p.photo)}')"></i><div><small>${esc(p.dept || 'Person')}</small><h3>${mark(p.name, hq)}</h3>${p.known.length ? `<p>Known for ${p.known.map(esc).join(', ')}</p>` : ''}<span class="sx-go">See everything with ${esc(p.name.split(' ')[0])} ${icon('chev')}</span></div></div>`;
    } else if (titles[0]) {
      const r = titles[0]; items.push({ kind: 'title', r });
      topHtml = `<div class="sx-top" data-i="0">${r.backdrop ? `<img class="sx-bd" src="${esc(r.backdrop)}" alt="" decoding="async">` : ''}<div class="sx-tc"><i class="sx-pp" style="background-image:url('${esc(r.poster || posterOf(r.imdbId))}')"></i>
        <div class="sx-ti"><small>Top result${r.local ? ' · in your library' : ''}</small><h3>${mark(r.title, hq)}</h3><div class="sx-meta">${esc(meta(r))}${r.genres?.length ? ` · ${esc(r.genres.join(', '))}` : ''}${prog(r)}</div>${r.overview ? `<p>${esc(r.overview)}</p>` : ''}
        <div class="sx-btns"><button class="btn primary sm" data-play>${icon('play')} ${r.progress ? 'Resume' : 'Play'} <kbd>⌘↵</kbd></button><button class="btn sm">Details <kbd>↵</kbd></button></div></div></div></div>`;
    }
    const rest = (data?.personFirst ? titles : titles.slice(1)).slice(0, 9);
    const listHtml = rest.map((r) => { items.push({ kind: 'title', r }); return `<div class="sx-row" data-i="${items.length - 1}"><i style="background-image:url('${esc(r.poster || posterOf(r.imdbId))}')"></i><div><b>${mark(r.title, hq)}</b><small>${esc(meta(r))}${r.local ? ' · in your library' : ''}</small></div>${prog(r)}</div>`; }).join('');
    const ppl = (data?.personFirst ? people.slice(1) : people).slice(0, 5);
    const pplHtml = ppl.map((p) => { items.push({ kind: 'person', p }); return `<div class="sx-pr" data-i="${items.length - 1}"><i style="background-image:url('${esc(p.photo)}')"></i><b>${mark(p.name, hq)}</b><small>${esc(p.dept)}</small></div>`; }).join('');
    const cmdHtml = cmds.map((c) => { items.push(c); return `<div class="sx-cmd" data-i="${items.length - 1}">${icon(c.ic)}<span>${esc(c.label)}</span></div>`; }).join('');
    const label = data?.intent?.label;
    out.innerHTML = (label ? `<div class="sx-intent">${icon('sliders')} ${esc(label)}</div>` : '')
      + (topHtml || listHtml ? `<div class="sx-grid">${topHtml ? `<div class="sx-l">${topHtml}</div>` : ''}<div class="sx-r">${listHtml ? `<section><h5>${data?.personFirst ? 'Titles' : 'More results'}</h5><div class="sx-list">${listHtml}</div></section>` : ''}${pplHtml ? `<section><h5>People</h5><div class="sx-people">${pplHtml}</div></section>` : ''}</div></div>` : '')
      + (cmdHtml ? `<section><h5>Go to</h5><div class="sx-cmds">${cmdHtml}</div></section>` : '')
      + (!items.length ? (pending ? '<div class="sx-empty">Searching…</div>' : `<div class="sx-empty">Nothing for “${esc(q)}”. Try fewer words, or something like “${esc(TRY[Math.floor(Math.random() * TRY.length)])}”.</div>`) : '');
    sel = Math.min(sel, Math.max(0, items.length - 1)); paint(); bind();
  }

  async function run(now = false) {
    const q = input.value.trim(), sq = override || q, id = ++my;
    if (!q) { ctrl?.abort(); spin.hidden = true; override = ''; home(); return; }
    if (cache.has(sq.toLowerCase())) { last = cache.get(sq.toLowerCase()); spin.hidden = true; render(q, last, false); return; }
    render(q, null, true); // instant: local matches while the server works
    clearTimeout(timer);
    timer = setTimeout(async () => {
      ctrl?.abort(); ctrl = new AbortController(); spin.hidden = false;
      try {
        const data = await api('/api/search/smart?q=' + encodeURIComponent(sq), { signal: ctrl.signal });
        cache.set(sq.toLowerCase(), data);
        if (id !== my) return;
        last = data; render(q, data, false);
      } catch (e) { if (e.name !== 'AbortError' && id === my) render(q, { titles: [], people: [] }, false); }
      finally { if (id === my) spin.hidden = true; }
    }, now ? 0 : sq.length < 3 ? 160 : 90);
  }
  function key(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (override) { override = ''; run(true); return; } close(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (input.value.trim()) rememberQ(input.value); go(items[sel], e.metaKey || e.ctrlKey); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paint(); }
  }
  document.addEventListener('keydown', key, true);
  box.addEventListener('pointerdown', (e) => { if (e.target === box) close(); });
  input.addEventListener('input', () => { override = ''; sel = 0; run(); });
  input.value = prefill; input.focus();
  if (prefill) run(true); else home();
}
