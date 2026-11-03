import { api, post } from './api.js';
import { $, esc, icon, avatar, LOGO, applyAppearance, fmtTime, toast, wl } from './ui.js';

export const store = { settings: null, nodes: [], history: [], watchlist: [] };
const routes = [];
let leaveFns = [];
export const onLeave = (fn) => leaveFns.push(fn);

// kind 'browse' routes keep the browse view mounted; 'page' routes render standalone pages.
export function route(pattern, kind, loader) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z_]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
  routes.push({ re, keys, kind, loader });
}

export async function saveSettings(patch) {
  store.settings = await api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
  applyAppearance(store.settings.appearance);
  renderNav();
  return store.settings;
}

// ---------- Shared actions ----------
export async function quickPlay(item) {
  toast(`Finding the best stream for ${item.title}…`);
  try {
    const r = await post('/api/quickplay', item);
    const ep = r.played?.season ? ` S${String(r.played.season).padStart(2, '0')}E${String(r.played.episode).padStart(2, '0')}` : '';
    toast(`Playing ${item.title}${ep}`, 'ok');
    setTimeout(() => { window.pollRemote?.(); refreshHistory(); }, 3000);
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

export async function toggleSave(item) {
  const r = await post('/api/watchlist/toggle', item);
  r.saved ? wl.add(item.imdbId) : wl.delete(item.imdbId);
  store.watchlist = r.list;
  toast(r.saved ? 'Saved to your shelf' : 'Removed from your shelf', 'ok');
  window.browseRefresh?.();
  return r.saved;
}

export async function refreshHistory() {
  try { store.history = await api('/api/history'); renderNav(); window.browseRefresh?.(); } catch {}
}

// ---------- Top nav ----------
export function renderNav() {
  const s = store.settings; if (!s) return;
  const hash = location.hash || '#/';
  const online = store.nodes.filter((n) => n.status === 'online').length;
  const on = (re) => (re.test(hash) ? 'on' : '');
  $('#nav').innerHTML = `
    <a class="brand" href="#/" aria-label="IronHide home">${LOGO}<span>IronHide</span></a>
    <nav class="ncenter" aria-label="Main">
      <a href="#/" class="${on(/^#\/?$|^#\/feed|^#\/title/)}" aria-label="Home" title="Home">${icon('home')}</a>
      <button id="nSearch" aria-label="Search" title="Search ( / )">${icon('search')}</button>
      <a href="#/continue" class="${on(/^#\/continue/)}" aria-label="Continue watching" title="Continue watching">${icon('play')}</a>
      <a href="#/shelf" class="${on(/^#\/shelf/)}" aria-label="Shelf" title="Shelf">${icon('bookmark')}</a>
    </nav>
    <div class="nright">
      <a class="nodes" href="#/settings/nodes" title="${online} node${online === 1 ? '' : 's'} online"><span class="dot ${online ? 'online' : 'offline'}"></span>${online}</a>
      <a href="#/settings/profile" class="me" aria-label="Settings" title="${esc(s.profile.name)}">${avatar(s.profile, 36)}</a>
    </div>`;
  $('#nSearch').onclick = () => import('./palette.js').then((m) => m.openPalette());
}

// ---------- Now playing pill ----------
function npMarkup() {
  return `<button class="rb main" data-r="toggle" aria-label="Play or pause"></button>
    <div class="npi"><div class="npt"></div><div class="npbar"><i></i></div></div><span class="npx"></span>
    <button class="rb" data-r="back" aria-label="Back 30 seconds">${icon('back')}</button>
    <button class="rb" data-r="fwd" aria-label="Forward 30 seconds">${icon('fwd')}</button>
    <button class="rb" data-r="stop" aria-label="Stop">${icon('stop')}</button>`;
}
function setupNowPlaying() {
  const np = $('#np'); np.innerHTML = npMarkup();
  const ctl = (action, value) => post('/api/control', { action, value }).then(() => pollRemote()).catch((e) => toast(e.message, 'err'));
  np.onclick = (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    ({ toggle: () => ctl('toggle'), back: () => ctl('seek_back', 30), fwd: () => ctl('seek_forward', 30), stop: () => ctl('stop') })[b.dataset.r]();
  };
}
async function pollRemote() {
  try {
    const d = await api('/api/nowplaying');
    const el = $('#np');
    if (!d) return el.classList.add('hidden');
    el.classList.remove('hidden');
    el.querySelector('.npt').textContent = d.title || 'Playing';
    el.querySelector('[data-r="toggle"]').innerHTML = icon(d.playing ? 'pause' : 'play');
    el.querySelector('.npbar i').style.width = (d.percent || 0) + '%';
    el.querySelector('.npx').textContent = `${fmtTime(d.position)} / ${fmtTime(d.duration)}`;
  } catch {}
}

// ---------- Router ----------
let browse = null;
async function navigate() {
  leaveFns.forEach((f) => f()); leaveFns = [];
  const path = (location.hash.replace(/^#/, '') || '/').split('?')[0];
  const page = $('#page'), browseEl = $('#browse');
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    document.body.classList.toggle('is-browse', r.kind === 'browse');
    renderNav();
    if (r.kind === 'browse') {
      page.innerHTML = ''; page.classList.add('hidden'); browseEl.classList.remove('hidden');
      if (!browse) browse = await import('./pages/browse.js').then(async (v) => { await v.mount(browseEl); return v; });
      browse.handle(r.loader, params);
    } else {
      browseEl.classList.add('hidden'); page.classList.remove('hidden');
      browse?.handle('away');
      page.innerHTML = `<header class="mini"><a class="back" href="#/">${icon('back')} Home</a><span>${esc(params.section ? params.section[0].toUpperCase() + params.section.slice(1) : 'Settings')}</span></header><div id="pg"></div>`;
      window.scrollTo(0, 0);
      try { await (await import(`./pages/${r.loader}.js`)).default($('#pg'), params); }
      catch (e) { $('#pg').innerHTML = `<div class="page"><div class="note">${esc(e.message)}</div></div>`; }
    }
    return;
  }
  location.hash = '#/';
}

async function refreshNodes() { try { store.nodes = await api('/api/nodes'); renderNav(); } catch {} }
window.refreshNodes = refreshNodes;

function splash() {
  const g = $('#gate');
  if (sessionStorage.getItem('ih-in')) return g.remove();
  sessionStorage.setItem('ih-in', '1');
  g.innerHTML = `${LOGO.replace('id="lg"', 'id="lg2"').replace('url(#lg)', 'url(#lg2)')}<b>Welcome back, ${esc(store.settings.profile.name)}</b><span>Private access</span>`;
  setTimeout(() => { g.classList.add('out'); setTimeout(() => g.remove(), 700); }, 900);
}

route('/', 'browse', 'home');
route('/feed/:feed', 'browse', 'feed');
route('/continue', 'browse', 'continue');
route('/shelf', 'browse', 'shelf');
route('/title/:type/:id', 'browse', 'title');
route('/search/:q', 'browse', 'search');
route('/settings', 'page', 'settings');
route('/settings/:section', 'page', 'settings');

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); import('./palette.js').then((m) => m.openPalette()); }
});

(async function boot() {
  const [settings, list, history] = await Promise.all([api('/api/settings'), api('/api/watchlist').catch(() => []), api('/api/history').catch(() => [])]);
  store.settings = settings; store.history = history; store.watchlist = list; list.forEach((w) => wl.add(w.imdbId));
  applyAppearance(settings.appearance);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyAppearance(store.settings.appearance));
  $('#app').innerHTML = `<header id="nav" class="nav"></header><div id="browse" class="hidden"></div><div id="page" class="hidden"></div><div id="np" class="np hidden"></div>`;
  splash(); renderNav(); setupNowPlaying();
  window.pollRemote = pollRemote; setInterval(pollRemote, 2000); pollRemote();
  window.addEventListener('hashchange', navigate);
  navigate(); refreshNodes(); setInterval(refreshNodes, 30000);
})();
