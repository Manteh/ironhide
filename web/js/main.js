import { api, post } from './api.js';
import { $, esc, icon, avatar, LOGO, applyAppearance, fmtTime, toast, friendly, wl, posterOf } from './ui.js';
import { connectSocial, onEvent, onState } from './social.js';

export const store = { settings: null, nodes: [], history: [], watchlist: [], socialCount: 0 };
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
const usingWeb = () => store.settings?.playback?.player === 'web';

// In-browser player: the daemon picks/resolves/probes, then the player streams it.
export async function playWeb(body, opts = {}) {
  if (!opts.quiet) watchLaunch({ title: body.title || '', imdbId: body.imdbId, poster: body.poster }, 'web');
  const L = !opts.quiet ? launch : null; // Cancel on the launch screen marks this, so a stream that was still being found never opens the player afterwards
  try {
    const { browserCaps, openPlayer } = await import('./player.js');
    const info = await post('/api/webplay', { ...body, caps: browserCaps() });
    if (L && L.cancelled) return false;
    if (!opts.quiet) hideLaunch(); openPlayer(info, { room: !!body.room, parked: !!opts.parked, prefs: store.settings.playback });
    if (info.swapped) toast(`That version isn't working, so we picked another: ${info.size || 'next best'}`, 'info');
    setTimeout(() => refreshHistory(), 700); setTimeout(() => refreshHistory(), 3000);
    return true;
  } catch (e) { if (L && L.cancelled) return false; if (!opts.quiet) hideLaunch(); toast(e.message, 'err', { action: { label: 'Try again', run: () => playWeb(body, opts) } }); return false; }
}

// play a specific stream row from the version picker
export async function playIndex(index, info) {
  if (usingWeb()) return playWeb({ index, ...info });
  watchLaunch(info);
  try { await post('/api/play', { index }); return true; } catch (e) { launchFailed(e.message); return false; }
}
window.playIndex = playIndex;

export async function quickPlay(item, opts = {}) {
  if (opts.player === 'web' || (opts.player !== 'mpv' && usingWeb())) return playWeb(item);
  watchLaunch({ title: item.title, imdbId: item.imdbId, type: item.type, poster: item.poster, backdrop: item.backdrop, season: item.season, episode: item.episode, version: item.startOver ? 'From the beginning' : 'Picking the best version' });
  try {
    await post('/api/quickplay', item);
    setTimeout(() => refreshHistory(), 1200); setTimeout(() => refreshHistory(), 4000);
    return true;
  } catch (e) { launchFailed(e.message, { retry: !/no streams/i.test(e.message) }); return false; }
}

// ---------- Launch overlay: between "Play" and mpv taking over ----------
const STEPS = [['finding', 'Finding the best stream'], ['resolving', 'Resolving the link'], ['launching', 'Starting the player'], ['buffering', 'Buffering a few seconds'], ['playing', 'Starting playback']];
const WEB_STEPS = [['finding', 'Finding the best stream'], ['resolving', 'Resolving the link'], ['probing', 'Checking codecs and tracks'], ['playing', 'Opening the player']];
let launch = null;

export function watchLaunch(info, mode = 'mpv') {
  hideLaunch(true);
  if (info?.title) window.__ihpTitle = info.title + (info.episode ? ` · S${String(info.season).padStart(2, '0')}E${String(info.episode).padStart(2, '0')}` : '');
  const STEPS_ = mode === 'web' ? WEB_STEPS : STEPS;
  const el = document.createElement('div');
  el.className = 'launch lx';
  const art = info.poster || (info.imdbId ? posterOf(info.imdbId) : '');
  const sub = [info.episode ? `S${String(info.season).padStart(2, '0')}E${String(info.episode).padStart(2, '0')}` : '', info.version || ''].filter(Boolean).join(' · ');
  el.innerHTML = `<div class="lx-bg">${info.backdrop || art ? `<img src="${esc(info.backdrop || art)}" alt="" decoding="async">` : ''}</div>
    <div class="lcard lx-card">
      <div class="lx-poster">${art ? `<img src="${esc(art)}" alt="" decoding="async">` : ''}<span class="lx-sheen"></span></div>
      <div class="lbody lx-body">
        <div class="lkick">Getting ready</div>
        <h3>${esc(info.title || 'Your title')}</h3>
        ${sub ? `<div class="lx-ver">${esc(sub)}</div>` : ''}
        <ol class="lsteps lx-steps">${STEPS_.map(([k, l]) => `<li data-s="${k}" title="${l}"><i></i></li>`).join('')}</ol>
        <div class="lx-now"><span class="lx-spin"></span><span class="ldetail" id="lDetail">${STEPS_[0][1]}</span><span class="lx-time" id="lTime">0:00</span></div>
        <div class="lbar" hidden><div id="lFill"></div></div>
        <button class="lx-cancel" id="lCancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const startedAt = Date.now();
  launch = { el, startedAt, done: false, timer: null, info, mode };
  const apply = (st) => {
    if (st.phase === 'error') { launchFailed(st.detail || 'Could not start playback', { retry: st.retry !== false }); return; }
    const idx = STEPS_.findIndex(([k]) => k === st.phase);
    if (idx < 0) return;
    $$li(el).forEach((li, i) => { li.classList.toggle('done', i < idx || (i === idx && st.phase === 'playing')); li.classList.toggle('now', i === idx && st.phase !== 'playing'); });
    $('#lFill', el).style.width = Math.round(((idx + (st.phase === 'playing' ? 1 : 0.55)) / STEPS_.length) * 100) + '%';
    $('#lDetail', el).textContent = st.detail || STEPS_[idx][1];
    if (st.phase === 'playing' && !launch.done) {
      launch.done = true;
      if (mode === 'web') return; // the player opens when the session is ready
      el.querySelector('.lkick').textContent = 'Now playing'; el.classList.add('ready');
      setTimeout(() => { hideLaunch(); import('./now.js').then((m) => m.openNow()); }, 1500);
    }
  };
  const poll = async () => {
    if (!launch || launch.el !== el) return;
    if (launch.failed) return;
    try { const st = await api('/api/playstate'); if (st.at >= startedAt - 400) apply(st); } catch {}
    if (launch && !launch.failed && Date.now() - startedAt > 90000) launchFailed('Starting took too long. This version may be slow right now.');
  };
  launch.timer = setInterval(() => { poll(); const t = Math.floor((Date.now() - startedAt) / 1000), te = el.querySelector('#lTime'); if (te) te.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }, 350); poll();
  $('#lCancel', el).onclick = async () => { if (launch) launch.cancelled = true; hideLaunch(); await post('/api/play/cancel').catch(() => {}); toast('Cancelled'); };
}
const $$li = (el) => [...el.querySelectorAll('.lsteps li')];

// Playback didn't start: keep the card up and offer a way forward instead of a toast that vanishes.
function launchFailed(message, { retry = true } = {}) {
  if (!launch) { toast(message, 'err'); return; }
  const { el, info, mode } = launch;
  launch.failed = true; clearInterval(launch.timer);
  el.classList.add('failed');
  el.querySelector('.lkick').textContent = "Couldn't start";
  const now = el.querySelector('.lx-now'); if (now) now.innerHTML = `<span class="ldetail lx-err">${esc(friendly(message))}</span>`;
  const canPick = info?.imdbId && info?.type;
  const acts = document.createElement('div'); acts.className = 'lx-acts';
  acts.innerHTML = `${retry && mode !== 'web' ? `<button class="btn primary" data-f="next">${icon('play')} Try another version</button>` : ''}
    ${canPick ? `<button class="btn" data-f="pick">${icon('sliders')} Pick a version</button>` : ''}<button class="btn ghost" data-f="close">Close</button>`;
  el.querySelector('#lCancel')?.replaceWith(acts);
  acts.onclick = async (e) => {
    const f = e.target.closest('[data-f]')?.dataset.f; if (!f) return;
    if (f === 'close') return hideLaunch();
    if (f === 'pick') { hideLaunch(); location.hash = `#/title/${info.type === 'tv' ? 'series' : info.type}/${info.imdbId}?versions=1`; return; }
    watchLaunch({ ...info, version: 'Trying another version' }, mode);
    try { await post('/api/play/next'); setTimeout(() => refreshHistory(), 4000); } catch (err) { launchFailed(err.message, { retry: false }); }
  };
  acts.querySelector('button')?.focus();
}

export function hideLaunch(instant = false) {
  if (!launch) return;
  clearInterval(launch.timer);
  const el = launch.el; launch = null;
  if (instant) return el.remove();
  el.classList.remove('in'); setTimeout(() => el.remove(), 500);
}
window.watchLaunch = watchLaunch; window.cancelLaunchUI = () => hideLaunch();

export async function toggleSave(item) {
  const r = await post('/api/watchlist/toggle', item);
  r.saved ? wl.add(item.imdbId) : wl.delete(item.imdbId);
  store.watchlist = r.list;
  toast(r.saved ? 'Saved to your shelf' : 'Removed from your shelf', 'ok');
  window.browseRefresh?.();
  return r.saved;
}

// Re-reads the watch history, and redraws only if something actually changed (it is asked a few times after the player closes, and the screen should not flicker for the ones that find nothing new).
export async function refreshHistory() {
  try {
    if (refreshHistory.sig === undefined) refreshHistory.sig = JSON.stringify(store.history);
    const h = await api('/api/history'), sig = JSON.stringify(h);
    if (sig === refreshHistory.sig) return;
    refreshHistory.sig = sig; store.history = h; renderNav(); window.browseRefresh?.();
  } catch {}
}

// ---------- Top nav ----------
export function renderNav() {
  const s = store.settings; if (!s) return;
  window.__ihMe?.(s.profile); // the Mac app's top bar
  const hash = location.hash || '#/';
  const online = store.friendsOnline || 0; // friends online right now (from the relay)
  const on = (re) => (re.test(hash) ? 'on' : '');
  $('#nav').innerHTML = `
    <a class="rlogo" href="#/" aria-label="Orbie home" data-tip="Orbie"><span class="tile">${LOGO}</span></a>
    <i class="rsep"></i>
    <a href="#/" class="ri ${on(/^#\/?$|^#\/feed|^#\/title/)}" aria-label="Home" data-tip="Home">${icon('home')}<span>Home</span></a>
    <button id="nSearch" class="ri" aria-label="Search" data-tip="Search  /">${icon('search')}<span>Search</span></button>
    <a href="#/continue" class="ri ${on(/^#\/continue/)}" aria-label="Continue watching" data-tip="Continue watching">${icon('play')}<span>Resume</span></a>
    <a href="#/shelf" class="ri ${on(/^#\/shelf/)}" aria-label="Shelf" data-tip="Shelf">${icon('bookmark')}<span>Shelf</span></a>
    <a href="#/taste" class="ri ${on(/^#\/taste/)}" aria-label="Taste Lab" data-tip="Taste Lab">${icon('heart')}<span>Taste</span></a>
    <i class="rsep"></i>
    <a href="#/settings" class="ri ${on(/^#\/settings/)}" aria-label="Settings" data-tip="Settings  ⌘,">${icon('gear')}<span>Settings</span></a>
    <a class="rme ${on(/^#\/profile/)}" href="#/profile" aria-label="Your profile" data-tip="${esc(s.profile.name)}">${avatar(s.profile, 32)}</a>`;
  $('#nSearch').onclick = () => import('./palette.js').then((m) => m.openPalette());
}

// ---------- Now playing pill ----------
function npMarkup() {
  return `<button class="rb main" data-r="toggle" aria-label="Play or pause"></button>
    <button class="npi" data-r="open" aria-label="Open now playing"><span class="npt"></span><span class="npbar"><i></i></span></button><span class="npx"></span>
    <button class="rb" data-r="back" aria-label="Back 30 seconds">${icon('back')}</button>
    <button class="rb" data-r="fwd" aria-label="Forward 30 seconds">${icon('fwd')}</button>
    <button class="rb" data-r="stop" aria-label="Stop">${icon('stop')}</button>`;
}
function setupNowPlaying() {
  const np = $('#np'); np.innerHTML = npMarkup();
  const ctl = (action, value) => post('/api/control', { action, value }).then(() => pollRemote()).catch((e) => toast(e.message, 'err'));
  np.onclick = (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    ({ open: () => import('./now.js').then((m) => m.openNow()), toggle: () => ctl('toggle'), back: () => ctl('seek_back', 30), fwd: () => ctl('seek_forward', 30), stop: () => ctl('stop') })[b.dataset.r]();
  };
}
let npMiss = 0;
// what mpv is playing right now, for the side rail. Only tells the rail when something it shows has changed.
function setNp(v) {
  const k = JSON.stringify(v && { ...v, left: Math.round(v.left / 60), pct: Math.round(v.pct / 3) });
  if (k === store._npk) return;
  store._npk = k; store.np = v; window.dispatchEvent(new Event('rail-refresh'));
}
async function pollRemote() {
  try {
    const d = await api('/api/nowplaying');
    const el = $('#np');
    if (!d) { if (++npMiss >= 4) { el.classList.add('hidden'); document.body.classList.remove('np-on'); setNp(null); } return; } // a slow answer is not the end
    npMiss = 0; el.classList.remove('hidden'); document.body.classList.add('np-on');
    setNp({ title: d.title, imdbId: d.meta?.imdbId, season: d.meta?.season, episode: d.meta?.episode, playing: d.playing, pct: Math.round(d.percent || 0), left: Math.max(0, (d.duration || 0) - (d.position || 0)) });
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
      if (r.loader !== 'title') store.lastBrowse = location.hash || '#/';
      page.innerHTML = ''; page.classList.add('hidden'); browseEl.classList.remove('hidden');
      if (!browse) browse = await import('./pages/browse.js').then(async (v) => { await v.mount(browseEl); return v; });
      browse.handle(r.loader, params);
    } else {
      browseEl.classList.add('hidden'); page.classList.remove('hidden');
      browse?.handle('away');
      page.innerHTML = `<div id="pg"><div class="page pg-sk" aria-busy="true" aria-label="Loading"><i class="skl h"></i><i class="skl"></i><i class="skl s"></i><div class="pg-skc"><i></i><i></i><i></i></div></div></div>`;
      window.scrollTo(0, 0);
      // Version page modules so a packaged app update cannot keep an older
      // dynamically imported page in the browser module cache.
      try { await (await import(`./pages/${r.loader}.js?v=20261127-profile-fix`)).default($('#pg'), params); }
      catch (e) { $('#pg').innerHTML = `<div class="page"><div class="note">${esc(e.message)}</div></div>`; }
    }
    return;
  }
  location.hash = '#/';
}

// Resolves once the screen in view has finished loading: fonts, no skeletons, and every picture in view drawn (or after a few seconds regardless).
async function settled(maxMs = 3500) {
  const t0 = performance.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try { await Promise.race([document.fonts?.ready, sleep(700)]); } catch {}
  progress(0.5); // fonts are ready
  while (performance.now() - t0 < maxMs) {
    const busy = document.querySelector('#app .sk, #app .skl, #app [aria-busy="true"]');
    const onHome = document.querySelector('#browse:not(.hidden)'), cards = !onHome || document.querySelector('#browse .bc:not(.sk)'); // the home screen is not loaded until its first real cards are there
    const inView = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight; };
    const imgs = [...document.querySelectorAll('#app img')].filter(inView);
    // posters are mostly CSS backgrounds: wait for those pictures too
    const bgs = [...document.querySelectorAll('#app [style*="background-image"]')].filter(inView).map((e) => /url\(["']?([^"')]+)/.exec(e.getAttribute('style') || '')?.[1]).filter(Boolean);
    const bgReady = await Promise.all([...new Set(bgs)].slice(0, 24).map((u) => bgSeen.get(u) || (bgSeen.set(u, new Promise((res) => { const im = new Image(); im.onload = im.onerror = () => res(true); im.src = u; setTimeout(() => res(true), 2500); })), bgSeen.get(u))));
    // real progress: the shelves are there (0.7), then the share of pictures in view that have loaded (up to 1)
    const doneImgs = imgs.filter((i) => i.complete).length + bgs.length * 0, total = imgs.length + bgs.length;
    progress(0.5 + (cards && !busy ? 0.2 : 0) + 0.28 * (total ? (doneImgs + (bgReady.every(Boolean) ? bgs.length : 0)) / total : 1));
    if (!busy && cards && imgs.every((i) => i.complete) && bgReady.every(Boolean)) break;
    await sleep(80);
  }
  await frames();
}
const bgSeen = new Map();
const progress = (v) => { window.__bootProgress && window.__bootProgress(v); }; // lets the start-up orb show how far along the app is
// Ordinary open or reload: the page was held back (html.reload); fade it in now that it is complete.
function reveal() {
  const h = document.documentElement; if (!h.classList.contains('reload')) return;
  h.classList.add('ready'); setTimeout(() => h.classList.remove('reload', 'ready'), 900);
}
const bootDone = () => { window.__bootDone && window.__bootDone(); reveal(); };

async function refreshNodes() { try { store.nodes = await api('/api/nodes'); renderNav(); } catch {} }
window.refreshNodes = refreshNodes;

route('/', 'browse', 'home');
route('/feed/:feed', 'browse', 'feed');
route('/continue', 'browse', 'continue');
route('/shelf', 'browse', 'shelf');
route('/title/:type/:id', 'browse', 'title');
route('/search/:q', 'browse', 'search');
route('/friends', 'page', 'together');
route('/together', 'page', 'together');
route('/taste', 'page', 'taste');
route('/collection/:id', 'page', 'collection');
route('/profile', 'page', 'profile');
route('/profile/:id', 'page', 'profile');
route('/settings', 'page', 'settings');
route('/settings/:section', 'page', 'settings');
route('/manifesto', 'page', 'manifesto');
route('/sanctuary', 'page', 'manifesto');

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault();
    import('./palette.js').then((m) => m.openPalette());
  }
  // Ask Orbie (voice assistant) is hidden for now: no button and no Option+Space. Its code is still in orbie-agent.js
});

(async function boot() {
  // First launch from the start-up screen: the manifesto opens at once, taking over the orb the start-up screen left on screen.
  // Coming from the start-up screen: the page behind the orb is the main screen; the orb and the word are held by js/intro-boot.js until it has loaded.
  let fromStart = false; try { fromStart = /[?&]intro=1\b/.test(location.search); if (fromStart || /[?&]boot=1\b/.test(location.search)) window.history.replaceState(null, '', location.pathname + location.hash); } catch {}
  if (fromStart) window.__introReveal = () => import('./pages/manifesto.js').then((m) => m.openManifesto({ first: true, intro: true })).catch(() => { window.__introOrb && window.__introOrb.dispose(); });
  const [settings, list, history] = await Promise.all([api('/api/settings'), api('/api/watchlist').catch(() => []), api('/api/history').catch(() => [])]);
  store.settings = settings; store.history = history; store.watchlist = list; list.forEach((w) => wl.add(w.imdbId));
  progress(0.22); // settings, shelf and history are in
  applyAppearance(settings.appearance);
  // invite only: no membership yet means the invite comes first (someone already set up only sees that step)
  const mem = await api('/api/membership').catch(() => ({ member: true }));
  if (!mem.member || !settings.profile.named) {
    bootDone(); // setup needs the screen: let the orb go first
    const { welcome } = await import('./welcome.js');
    store.settings = await welcome(settings, { invite: !mem.member, onlyInvite: !mem.member && settings.profile.named });
  }
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => applyAppearance(store.settings.appearance));
  $('#app').innerHTML = `<nav id="nav" class="rail" aria-label="Main"></nav><div id="browse" class="hidden"></div><div id="page" class="hidden"></div><div id="np" class="np hidden"></div>`;
  renderNav(); setupNowPlaying();
  window.pollRemote = pollRemote; setInterval(pollRemote, 2000); pollRemote();
  connectSocial();
  import('./roomplay.js').then((m) => m.watchRoom());
  // Tell the daemon whether anyone is looking, so friends see "tabbed out" instead of a stale "active".
  const tab = crypto.randomUUID?.() || String(Math.random());
  const seen = () => post('/api/social/visible', { tab, visible: document.visibilityState === 'visible' }).catch(() => {});
  document.addEventListener('visibilitychange', seen); addEventListener('focus', seen);
  addEventListener('pagehide', () => { try { fetch('/api/social/visible', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tab, visible: false }) }); } catch {} });
  seen(); setInterval(() => { if (document.visibilityState === 'visible') seen(); }, 20000);
  onEvent((ev, d) => { if (ev === 'reset') { location.href = '/'; return; } if (ev === 'toast') toast(d.text, d.kind === 'err' ? 'err' : d.kind === 'ok' ? 'ok' : ''); });
  onState((st) => { const n = st.incoming.length + st.invites.length, on = st.friends.filter((f) => f.online).length; if (n !== store.socialCount || on !== store.friendsOnline) { store.socialCount = n; store.friendsOnline = on; renderNav(); } });
  import('./updates-bell.js').then((m) => m.mountBell());
  import('./cursor.js').then((m) => m.initCursor());
  window.addEventListener('hashchange', navigate);
  progress(0.4); // the app's frame is built
  navigate(); refreshNodes(); setInterval(refreshNodes, 30000);
  settled().then(bootDone); // the start-up orb (or, on a reload, a blank screen) stays until the main screen is really there
  // first time in: the manifesto, full screen, once (after the welcome-back moment)
  let seenManifesto = true; try { seenManifesto = !!localStorage.getItem('orbie.manifesto.seen'); } catch {}
  if (!seenManifesto && !fromStart) setTimeout(() => import('./pages/manifesto.js').then((m) => m.openManifesto({ first: true })).catch(() => {}), 2100);
})();
