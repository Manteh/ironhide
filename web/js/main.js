import { api, post } from './api.js';
import { $, $$, esc, icon, avatar, LOGO, applyAppearance, fmtTime, toast } from './ui.js';

export const store = { settings: null, nodes: [] };
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
  renderNav();
  return store.settings;
}

// ---------- Shell ----------
function renderShell() {
  $('#app').innerHTML = `<header class="nav" id="nav"></header><main id="view"></main>`;
  renderNav();
}

function renderNav() {
  const s = store.settings, p = s.profile;
  const online = store.nodes.filter((n) => n.status === 'online').length;
  const hash = location.hash || '#/';
  const on = (m) => (m.test(hash) ? 'on' : '');
  const q = hash.startsWith('#/search/') ? decodeURIComponent(hash.slice(9)) : '';
  const nav = $('#nav');
  const hadFocus = document.activeElement?.id === 'q';
  nav.innerHTML = `
    <a class="brand" href="#/">${LOGO}<span>IronHide</span></a>
    <nav class="nav-links">
      <a href="#/" class="${on(/^#\/?$/)}">Home</a>
      <a href="#/library" class="${on(/^#\/library/)}">Library</a>
    </nav>
    <div class="nav-spacer"></div>
    <form class="search" id="searchForm" role="search">${icon('search')}<input id="q" type="search" placeholder="Search movies and shows" autocomplete="off" value="${esc(q)}" aria-label="Search" /></form>
    <a class="pill-btn" id="nodePill" href="#/settings/nodes" title="Nodes"><span class="dot ${online ? 'online' : 'offline'}"></span><b class="cnt">${online}</b><span class="lbl">online</span></a>
    <button class="avatar-btn" id="avBtn" aria-label="Account menu" aria-haspopup="true">${avatar(p, 34)}</button>`;
  $('#searchForm').onsubmit = (e) => { e.preventDefault(); const v = $('#q').value.trim(); if (v) location.hash = '#/search/' + encodeURIComponent(v); };
  $('#avBtn').onclick = (e) => { e.stopPropagation(); toggleMenu(); };
  if (hadFocus) { const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

function toggleMenu() {
  const old = $('#menu'); if (old) return old.remove();
  const s = store.settings, p = s.profile, th = s.appearance.theme;
  const m = document.createElement('div');
  m.className = 'menu'; m.id = 'menu';
  m.innerHTML = `<div class="who">${avatar(p, 40)}<div><b>${esc(p.name)}</b><span>Private library</span></div></div><hr>
    <a href="#/settings/profile">${icon('user')} Profile</a>
    <a href="#/settings/appearance">${icon('palette')} Appearance</a>
    <a href="#/settings/connectors">${icon('plug')} Connectors</a>
    <a href="#/settings/nodes">${icon('nodes')} Nodes</a><hr>
    <div class="seg-mini" role="group" aria-label="Theme">
      ${[['dark', 'moon'], ['light', 'sun'], ['system', 'monitor']].map(([t, ic]) => `<button data-t="${t}" class="${th === t ? 'on' : ''}" aria-label="${t}">${icon(ic)}</button>`).join('')}
    </div>`;
  document.body.appendChild(m);
  m.onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { saveSettings({ appearance: { theme: b.dataset.t } }).then(() => { m.remove(); }); } else if (e.target.closest('a')) m.remove(); };
}
document.addEventListener('click', (e) => { const m = $('#menu'); if (m && !m.contains(e.target)) m.remove(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#menu')?.remove(); });

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
    try { await (await r.loader()).default(view, params); }
    catch (e) { view.innerHTML = `<div class="page"><div class="note">${esc(e.message)}</div></div>`; }
    renderNav();
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

async function refreshNodes() {
  try { store.nodes = await api('/api/nodes'); renderNav(); } catch {}
}

// ---------- Boot ----------
function splash() {
  const g = $('#gate');
  if (sessionStorage.getItem('ih-in')) return g.remove();
  sessionStorage.setItem('ih-in', '1');
  g.innerHTML = `${LOGO.replace('id="lg"', 'id="lg2"').replace('url(#lg)', 'url(#lg2)')}<b>Welcome back, ${esc(store.settings.profile.name)}</b><span>Private access</span>`;
  setTimeout(() => { g.classList.add('out'); setTimeout(() => g.remove(), 700); }, 1000);
}

route('/', () => import('./pages/home.js'));
route('/library', () => import('./pages/library.js'));
route('/search/:q', () => import('./pages/search.js'));
route('/title/:type/:id', () => import('./pages/title.js'));
route('/settings', () => import('./pages/settings.js'));
route('/settings/:section', () => import('./pages/settings.js'));

(async function boot() {
  store.settings = await api('/api/settings');
  applyAppearance(store.settings.appearance);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyAppearance(store.settings.appearance));
  splash(); renderShell(); setupRemote();
  window.addEventListener('hashchange', navigate);
  navigate(); refreshNodes(); setInterval(refreshNodes, 30000);
  window.refreshNodes = refreshNodes;
})();
