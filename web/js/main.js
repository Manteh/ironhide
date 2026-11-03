import { api, post } from './api.js';
import { $, $$, esc, icon, avatar, LOGO, applyAppearance, fmtTime, toast, wl } from './ui.js';

export const store = { settings: null, nodes: [], history: [] };
const routes = [];
let leaveFns = [];
export const onLeave = (fn) => leaveFns.push(fn);

export function route(pattern, loader) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ re, keys, loader });
}

export async function saveSettings(patch) {
  store.settings = await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  applyAppearance(store.settings.appearance);
  renderChrome();
  return store.settings;
}

// ---------- Actions shared by every page ----------
export async function quickPlay(item) {
  toast(`Finding the best stream for ${item.title}…`);
  try {
    const r = await post('/api/quickplay', item);
    const ep = r.played?.season ? ` S${String(r.played.season).padStart(2, '0')}E${String(r.played.episode).padStart(2, '0')}` : '';
    toast(`Playing ${item.title}${ep}`, 'ok');
    setTimeout(() => { window.pollRemote?.(); refreshHistory(); }, 3000);
  } catch (e) { toast(e.message, 'err'); }
}

async function toggleSave(item, btn) {
  const r = await post('/api/watchlist/toggle', item);
  r.saved ? wl.add(item.imdbId) : wl.delete(item.imdbId);
  btn?.classList.toggle('on', r.saved);
  toast(r.saved ? 'Saved to watchlist' : 'Removed from watchlist', 'ok');
  renderChrome();
}

document.addEventListener('click', (e) => {
  const qp = e.target.closest('[data-qp]'), sv = e.target.closest('[data-wl]');
  if (!qp && !sv) return;
  const c = e.target.closest('[data-id]'); if (!c) return;
  e.preventDefault(); e.stopPropagation();
  const item = { imdbId: c.dataset.id, type: c.dataset.type, title: c.dataset.title, year: c.dataset.year, poster: c.dataset.poster, rating: c.dataset.rating };
  if (qp) {
    const s = qp.dataset.season ? { season: +qp.dataset.season, episode: +qp.dataset.episode } : {};
    quickPlay({ ...item, ...s });
  } else toggleSave(item, sv);
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q')?.focus(); }
});

// ---------- Shell ----------
const NAV = [['/', 'Home', 'home', /^#\/?$/], ['/browse/movies', 'Movies', 'film', /^#\/browse\/movies/], ['/browse/series', 'Series', 'tv', /^#\/browse\/series/], ['/library', 'Library', 'bookmark', /^#\/library/]];

function renderShell() {
  $('#app').innerHTML = `<div class="shell"><aside class="side" id="side"></aside><div class="main"><header class="topbar" id="topbar"></header><main id="view"></main></div></div><nav class="tabbar" id="tabbar" aria-label="Main"></nav>`;
  renderChrome();
}

function renderChrome() {
  const s = store.settings, p = s.profile, hash = location.hash || '#/';
  const online = store.nodes.filter((n) => n.status === 'online').length;
  const recent = []; const seen = new Set();
  for (const h of store.history) { if (!seen.has(h.imdbId)) { seen.add(h.imdbId); recent.push(h); } if (recent.length >= 5) break; }
  const q = hash.startsWith('#/search/') ? decodeURIComponent(hash.slice(9)) : '';

  $('#side').innerHTML = `
    <a class="brand" href="#/">${LOGO}<span>IronHide</span></a>
    <nav class="sidenav" aria-label="Main">${NAV.map(([h, l, ic, re]) => `<a href="#${h}" class="${re.test(hash) ? 'on' : ''}">${icon(ic)}<span>${l}</span>${l === 'Library' && wl.size ? `<em class="count" style="font-style:normal">${wl.size}</em>` : ''}</a>`).join('')}</nav>
    ${recent.length ? `<div><h4>Recently watched</h4><div class="recent">${recent.map((h) => `<a href="#/title/${h.type === 'tv' ? 'series' : 'movie'}/${esc(h.imdbId)}"><i style="background-image:url('https://images.metahub.space/poster/small/${esc(h.imdbId)}/img')"></i><span>${esc(h.title)}</span></a>`).join('')}</div></div>` : ''}
    <div class="side-foot">
      <a class="status-chip" href="#/settings/nodes" title="Nodes">${`<span class="dot ${online ? 'online' : 'offline'}" style="margin:0"></span>`}<b>${online} node${online === 1 ? '' : 's'} online</b></a>
      <div class="me"><a href="#/settings/profile" aria-label="Profile">${avatar(p, 34)}</a><div class="nm"><b>${esc(p.name)}</b><small>Private library</small></div>
        <a class="btn ghost icon" href="#/settings/profile" aria-label="Settings">${icon('sliders')}</a></div>
    </div>`;
  $('#topbar').innerHTML = `<form class="search" id="searchForm" role="search">${icon('search')}<input id="q" type="search" placeholder="Search movies and series" autocomplete="off" value="${esc(q)}" aria-label="Search"><kbd>/</kbd></form>`;
  $('#searchForm').onsubmit = (e) => { e.preventDefault(); const v = $('#q').value.trim(); if (v) location.hash = '#/search/' + encodeURIComponent(v); };
  $('#tabbar').innerHTML = [...NAV.map(([h, l, ic, re]) => [h, l, ic, re.test(hash)]), ['/settings/profile', 'Settings', 'user', /^#\/settings/.test(hash)]]
    .map(([h, l, ic, on]) => `<a href="#${h}" class="${on ? 'on' : ''}">${icon(ic)}<span>${l}</span></a>`).join('');
}

// ---------- Router ----------
async function navigate() {
  leaveFns.forEach((f) => f()); leaveFns = [];
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const view = $('#view');
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    view.innerHTML = '<div class="page"><div class="note">Loading…</div></div>';
    window.scrollTo(0, 0);
    renderChrome();
    try { await (await r.loader()).default(view, params); }
    catch (e) { view.innerHTML = `<div class="page"><div class="note">${esc(e.message)}</div></div>`; }
    return;
  }
  view.innerHTML = '<div class="page"><div class="note">Page not found</div></div>';
}

// ---------- Now-playing remote ----------
function setupRemote() {
  $('#rPlay').innerHTML = icon('play'); $('#rBack').innerHTML = icon('back'); $('#rFwd').innerHTML = icon('fwd'); $('#rStop').innerHTML = icon('stop');
  const ctl = (action, value) => post('/api/control', { action, value }).then(poll).catch((e) => toast(e.message, 'err'));
  $('#rPlay').onclick = () => ctl('toggle'); $('#rBack').onclick = () => ctl('seek_back', 30);
  $('#rFwd').onclick = () => ctl('seek_forward', 30); $('#rStop').onclick = () => ctl('stop');
  async function poll() {
    try {
      const np = await api('/api/nowplaying');
      const bar = $('#remote');
      if (!np) return bar.classList.add('hidden');
      bar.classList.remove('hidden');
      $('#rTitle').textContent = np.title || 'Playing';
      $('#rPlay').innerHTML = icon(np.playing ? 'pause' : 'play');
      $('#rFill').style.width = (np.percent || 0) + '%';
      $('#rTime').textContent = `${fmtTime(np.position)} / ${fmtTime(np.duration)}`;
    } catch {}
  }
  setInterval(poll, 2000); poll();
  window.pollRemote = poll;
}

async function refreshNodes() { try { store.nodes = await api('/api/nodes'); renderChrome(); } catch {} }
async function refreshHistory() { try { store.history = await api('/api/history'); renderChrome(); } catch {} }
window.refreshNodes = refreshNodes;

function splash() {
  const g = $('#gate');
  if (sessionStorage.getItem('ih-in')) return g.remove();
  sessionStorage.setItem('ih-in', '1');
  g.innerHTML = `${LOGO.replace('id="lg"', 'id="lg2"').replace('url(#lg)', 'url(#lg2)')}<b>Welcome back, ${esc(store.settings.profile.name)}</b><span>Private access</span>`;
  setTimeout(() => { g.classList.add('out'); setTimeout(() => g.remove(), 700); }, 1000);
}

route('/', () => import('./pages/home.js'));
route('/browse/:kind', () => import('./pages/browse.js'));
route('/library', () => import('./pages/library.js'));
route('/search/:q', () => import('./pages/search.js'));
route('/title/:type/:id', () => import('./pages/title.js'));
route('/settings', () => import('./pages/settings.js'));
route('/settings/:section', () => import('./pages/settings.js'));

(async function boot() {
  const [settings, list, history] = await Promise.all([api('/api/settings'), api('/api/watchlist').catch(() => []), api('/api/history').catch(() => [])]);
  store.settings = settings; store.history = history; list.forEach((w) => wl.add(w.imdbId));
  applyAppearance(settings.appearance);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyAppearance(store.settings.appearance));
  splash(); renderShell(); setupRemote();
  window.addEventListener('hashchange', navigate);
  navigate(); refreshNodes(); setInterval(refreshNodes, 30000);
})();
