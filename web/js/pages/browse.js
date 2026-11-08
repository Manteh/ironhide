// Browse: immersive hero, tab row and big portrait cards. One persistent view; tabs change by hash.
import { api, post } from '../api.js';
import { store, quickPlay, toggleSave, refreshHistory } from '../main.js';
import { openMenu } from '../ctxmenu.js';
import { esc, pad, posterOf, wl, icon, avatar, toast, $, $$ } from '../ui.js';
import { social, onState, sapi } from '../social.js';
import { openDossier, closeDossier, prefetchTitle } from '../dossier.js';
import { paletteOf, prefetch } from '../tint.js';
import { makeDropdown, closeDropdown } from '../dropdown.js';

// Movies and series share one tab each: the Movies / Series switch picks which list is shown
const TABS = [
  ['home', 'For You', '#/'], ['today', 'Today'], ['rising', 'Rising'], ['fresh', 'New'], ['trending', 'Trending'], ['popular', 'Popular'], ['theaters', 'In cinemas'],
  ['toprated', 'Top rated'], ['gems', 'Hidden gems'], ['anticipated', 'Upcoming'], ['boxoffice', 'Box office'], ['watched_weekly', 'Most watched'], ['surprise', 'Surprise me'], ['shelf', 'Shelf', '#/shelf'],  // Continue watching has its own row on Home, "See all" and the sidebar's Resume
];
const hrefOf = ([id, , h]) => h || `#/feed/${id}`;
const PAIR = { trending_movies: 'trending_shows', trending_shows: 'trending_movies', popular_movies: 'popular_shows', popular_shows: 'popular_movies' };
const isTrakt = (id) => id in PAIR;
const base = (id) => (id === 'trending_shows' ? 'trending_movies' : id === 'popular_shows' ? 'popular_movies' : id);
const SORTS = [['default', 'Default order'], ['rating', 'Highest rated'], ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['az', 'A to Z']];
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem('br-' + k)) ?? d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem('br-' + k, JSON.stringify(v)); } catch {} };
const FEED_NAME = { new: 'New', toprated: 'Top rated', gems: 'Hidden gem', surprise: 'Surprise', trending_movies: 'Trending', trending_shows: 'Trending series', popular_movies: 'Popular', popular_shows: 'TV hit', watched_weekly: 'Most watched', anticipated: 'Upcoming', boxoffice: 'Box office' };

let root, feeds = [], genres = [], cineGenres = [];
const st = { tkind: ls('tkind', ''), tab: 'home', genre: '', items: [], more: false, busy: false, token: 0, kind: ls('kind', 'movie'), sort: ls('sort', 'default'), min: ls('min', 0), hideSeen: ls('hide', false), year: '', seed: Math.floor(Date.now() / 1800000) };
const feedMeta = (id) => feeds.find((f) => f.id === id) || {};
const typeOf = (it) => (it.type === 'tv' || it.type === 'series' ? 'series' : 'movie');
// the feed id to ask for, given the Movies / Series switch
const feedId = () => (isTrakt(st.tab) ? (st.kind === 'series' ? PAIR[base(st.tab)] || st.tab : base(st.tab)) : st.tab);

// Titles you said you're not interested in (kept on this Mac)
const hiddenIds = () => new Set(ls('hidden', []));
const setHidden = (set) => { keep('hidden', [...set].slice(-500)); regrid(); paintRail(); paintCont(); };
// "Not interested" everywhere: remembered here (instant), told to the engine (out of recommendations, similar titles drop),
// and the card leaves every row and the grid right away (not Continue watching: that's your own progress)
export function hideTitle(id, title, undo = false) {
  const hid = hiddenIds(); undo ? hid.delete(id) : hid.add(id); keep('hidden', [...hid].slice(-500));
  post('/api/notinterested', { imdbId: id, title, undo }).catch(() => {});
  if (!undo) document.querySelectorAll(`.bc[data-id="${CSS.escape(id)}"]`).forEach((c) => { if (!c.closest('.cont-row')) c.remove(); });
  st.tasteDirty = true; regrid(); paintRail();
}
window.ihHideTitle = hideTitle;

// ---------- Right-click menus ----------
const IMDB = (id) => `https://www.imdb.com/title/${id}/`;
const copyText = async (t, msg) => { try { await navigator.clipboard.writeText(t); toast(msg, 'ok'); } catch { toast('Copy failed', 'err'); } };
async function sendToRoom(media, name) {
  try {
    if (social.state?.relay?.status !== 'online') return toast('Friends need the relay to be connected', 'err');
    if (!social.state.room) { await sapi('/room', { name: `${name} night` }); for (let i = 0; i < 25 && !social.state.room; i++) await new Promise((r) => setTimeout(r, 150)); }
    await sapi('/room/media', { media }); toast('Sent to your room', 'ok'); location.hash = '#/friends';
  } catch (e) { toast(e.message, 'err'); }
}
const forgetTitle = async (id, title) => { await post('/api/history/remove', { imdbId: id }); await refreshHistory(); toast(`${title} removed from Continue watching`, 'ok'); };
const watchedTitle = async (id, title, season, episode) => { await post('/api/history/watched', { imdbId: id, season, episode }); await refreshHistory(); toast(`${title} marked as watched`, 'ok'); };

function cardMenu(c) {
  const d = c.dataset, id = d.id, type = d.type === 'tv' ? 'series' : d.type, title = d.title, season = d.season ? +d.season : null, episode = d.episode ? +d.episode : null;
  const item = { imdbId: id, type, title, poster: d.poster, ...(season ? { season, episode } : {}) };
  const h = store.history.find((x) => x.imdbId === id), inProgress = h && (h.percent || 0) > 3 && (h.percent || 0) < 90, saved = wl.has(id), hid = hiddenIds();
  const web = store.settings?.playback?.player === 'web';
  const left = c.querySelector('.bmeta span')?.textContent || '';
  return { head: { title, sub: [d.year, type === 'series' ? 'Series' : 'Film'].filter(Boolean).join(' · '), poster: d.poster }, items: [
    { label: inProgress ? 'Resume' : 'Play', icon: 'play', hint: inProgress ? left.split(' · ').pop() : '', act: () => quickPlay(item) },
    { label: web ? 'Play in mpv instead' : 'Play in the browser instead', icon: web ? 'monitor' : 'laptop', act: () => quickPlay(item, { player: web ? 'mpv' : 'web' }) },
    { label: 'Choose a version…', icon: 'sliders', act: () => { location.hash = `#/title/${type}/${id}`; } },
    { sep: true },
    { label: 'Open details', icon: 'info', act: () => { location.hash = `#/title/${type}/${id}`; } },
    { label: 'Watch together', icon: 'users', hint: social.state?.room ? 'in your room' : '', act: () => sendToRoom({ imdbId: id, type, title, year: d.year, poster: d.poster, ...(type === 'series' ? { season: season || 1, episode: episode || 1 } : {}) }, title) },
    { label: saved ? 'Remove from shelf' : 'Save to shelf', icon: 'bookmark', act: () => toggleSave({ imdbId: id, type, title, year: d.year, poster: d.poster, rating: d.rating }) },
    { sep: true },
    h ? { label: 'Remove from Continue watching', icon: 'x', act: () => forgetTitle(id, title) } : null,
    h && !((h.percent || 0) >= 90) ? { label: season ? 'Mark episode as watched' : 'Mark as watched', icon: 'check', act: () => watchedTitle(id, title, season, episode) } : null,
    { label: 'Not interested', icon: 'eye', act: () => { hideTitle(id, title); toast(`${title} hidden. Your picks won't suggest it, and similar titles drop`, 'ok'); } },
    hid.size ? { label: `Show ${hid.size} hidden title${hid.size === 1 ? '' : 's'} again`, icon: 'eye', act: () => { for (const x of hid) post('/api/notinterested', { imdbId: x, undo: true }).catch(() => {}); setHidden(new Set()); st.tasteDirty = true; toast('Hidden titles are back', 'ok'); } } : null,
    { sep: true },
    { label: 'Open on IMDb', icon: 'ext', act: () => window.open(IMDB(id), '_blank', 'noopener') },
    { label: 'Copy IMDb link', icon: 'ext', act: () => copyText(IMDB(id), 'Link copied') },
  ] };
}

function railMenu(b) {
  const d = b.dataset, r = d.r;
  if (r === 'now') return { head: { title: d.title || 'Now playing', sub: d.sub, poster: d.pid ? pk(d.pid) : '' }, items: [
    { label: 'Open the remote', icon: 'play', act: () => import('../now.js').then((m) => m.openNow()) },
    { label: 'Play / pause', icon: 'pause', act: () => post('/api/control', { action: 'toggle' }).then(() => window.pollRemote?.()) },
    { sep: true },
    { label: 'Stop playback', icon: 'stop', danger: true, act: () => post('/api/control', { action: 'stop' }).then(() => window.pollRemote?.()) },
  ] };
  if (r === 'play') {
    const season = d.season ? +d.season : null, episode = d.episode ? +d.episode : null, item = { imdbId: d.id, type: d.type, title: d.title, ...(season ? { season, episode } : {}) }, web = store.settings?.playback?.player === 'web';
    return { head: { title: d.title, sub: d.sub, poster: pk(d.id) }, items: [
      { label: 'Resume', icon: 'play', act: () => quickPlay(item) },
      { label: web ? 'Resume in mpv' : 'Resume in the browser', icon: web ? 'monitor' : 'laptop', act: () => quickPlay(item, { player: web ? 'mpv' : 'web' }) },
      { label: 'Open details', icon: 'info', act: () => { location.hash = d.href; } },
      { sep: true },
      { label: season ? 'Mark episode as watched' : 'Mark as watched', icon: 'check', act: () => watchedTitle(d.id, d.title, season, episode) },
      { label: 'Remove from Continue watching', icon: 'x', danger: true, act: () => forgetTitle(d.id, d.title) },
    ] };
  }
  if (r === 'friend') {
    const mine = social.state?.room, theirs = d.room;
    return { head: { title: d.name, sub: d.sub }, items: [
      { label: 'View profile', icon: 'user', act: () => { location.hash = `#/profile/${d.id}`; } },
      theirs ? { label: 'Join their room', icon: 'users', act: () => sapi('/room/join', { code: theirs }).then(() => toast('Joining the room', 'ok')).catch((e) => toast(e.message, 'err')) } : null,
      !theirs && mine ? { label: 'Invite to my room', icon: 'users', act: () => { sapi('/room/invite', { id: d.id }); toast('Invite sent', 'ok'); } } : null,
      !theirs && !mine ? { label: 'Start a room together', icon: 'users', act: async () => { try { await sapi('/room', { name: `${social.state?.you?.name || 'My'}'s room` }); for (let i = 0; i < 25 && !social.state.room; i++) await new Promise((x) => setTimeout(x, 150)); await sapi('/room/invite', { id: d.id }); toast(`Invited ${d.name}`, 'ok'); location.hash = '#/friends'; } catch (e) { toast(e.message, 'err'); } } } : null,
      { sep: true },
      { label: 'Open Friends', icon: 'users', act: () => { location.hash = '#/friends'; } },
    ] };
  }
  return null;
}

// Sort, filter and hide what has been watched. Done here so changing them is instant.
function shown(items) {
  const seen = new Set(store.history.map((h) => h.imdbId)), hid = hiddenIds();
  let out = items.filter((i) => !hid.has(i.imdbId) && (!st.min || Number(i.rating) >= st.min) && (!st.hideSeen || !seen.has(i.imdbId)) && (!(st.tab === 'new' && st.genre) || (i.genres || []).includes(st.genre)));
  const yr = (i) => parseInt(i.year, 10) || 0, num = (i) => Number(i.rating) || 0;
  if (st.sort === 'rating') out = [...out].sort((a, b) => num(b) - num(a));
  else if (st.sort === 'newest') out = [...out].sort((a, b) => yr(b) - yr(a));
  else if (st.sort === 'oldest') out = [...out].sort((a, b) => yr(a) - yr(b));
  else if (st.sort === 'az') out = [...out].sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

const leftLabel = (h) => {
  const sec = (h.duration || 0) - (h.position || 0);
  if (!(sec > 60)) return '';
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m left` : `${m}m left`;
};

export function continueItems(history, max = 40) {
  const seen = new Set(), out = [];
  for (const h of history) {
    if (seen.has(h.imdbId)) continue; seen.add(h.imdbId);
    const pct = h.percent || 0, tv = h.type === 'tv' || h.type === 'series';
    if (tv && pct >= 90) {
      if (h.nextEp === null) continue; // that was the last episode out
      const ns = h.nextEp?.season ?? h.season, ne = h.nextEp?.episode ?? h.episode + 1; // the server checked the episode list; older entries just add one
      out.push({ imdbId: h.imdbId, type: 'series', title: h.title, poster: posterOf(h.imdbId), season: ns, episode: ne, tag: `Next · S${pad(ns)}E${pad(ne)}`, pct: 0 });
    }
    else if (pct > 3 && pct < 90) out.push({ imdbId: h.imdbId, type: tv ? 'series' : 'movie', title: h.title, poster: posterOf(h.imdbId), season: h.season, episode: h.episode, tag: tv ? `S${pad(h.season)}E${pad(h.episode)}` : 'Resume', pct, left: leftLabel(h) });
  }
  return out.slice(0, max);
}

// ---------- Cards ----------
// Posters are real <img> (lazy, decoded off the main thread) and fade in once decoded, so scrolling never stalls on a paint.
const posterDone = (img) => img.classList.add('ld');
document.addEventListener('load', (e) => { if (e.target.classList?.contains('bimg')) posterDone(e.target); }, true);
document.addEventListener('error', (e) => {
  const img = e.target; if (!img.classList?.contains('bimg')) return;
  if (img.dataset.fb) { const fb = img.dataset.fb; delete img.dataset.fb; img.src = fb; } else posterDone(img); // nothing else to try: show the plain tile
}, true);
// recommendation reasons, short enough to read on a card (the full sentence is the tooltip)
const shortWhy = (t) => t.replace(/^Because you loved /, '♥ Because of ').replace(/^Because you liked /, 'Because of ').replace(/^Matches your taste for /, 'Your taste: ');
// poster source for a card: TMDB's small copy when we have it (fast CDN, right size), else metahub's medium; the other is the fallback
const cardSrc = (it) => {
  const meta = posterOf(it.imdbId, 'medium'), tm = /image\.tmdb\.org/.test(it.poster || '') ? it.poster.replace(/\/w\d+\//, '/w342/').replace('/original/', '/w342/') : '';
  return tm ? { src: tm, fb: meta } : { src: meta, fb: it.poster && it.poster !== posterOf(it.imdbId) ? it.poster : '' };
};
function card(it, i = 0) {
  const type = it.type === 'tv' ? 'series' : it.type;
  const sub = [it.year, (it.genres || []).slice(0, 1).join('')].filter(Boolean).join(' · ');
  const resuming = !!it.left;  // continue-watching cards say where you are, right under the title
  const right = resuming ? '' : (it.rating ? '★ ' + it.rating : it.chart ? '' : it.tag || ''); // chart badges already sit on the left
  return `<article class="bc" tabindex="0" draggable="true" data-year="${esc(it.year || '')}" data-rating="${esc(it.rating || '')}" style="--i:${Math.min(i, 24)}" data-id="${esc(it.imdbId)}" data-type="${esc(type)}" data-title="${esc(it.title)}" data-poster="${esc(posterOf(it.imdbId) || it.poster || posterOf(it.imdbId))}" ${it.season ? `data-season="${it.season}" data-episode="${it.episode}"` : ''}>
    <div class="bposter"><img class="bimg" src="${esc(cardSrc(it).src)}"${cardSrc(it).fb ? ` data-fb="${esc(cardSrc(it).fb)}"` : ''} alt="" loading="${i < 8 ? 'eager' : 'lazy'}"${i < 6 ? ' fetchpriority="high"' : ''} decoding="async" draggable="false">
      ${it.match ? `<span class="bmatch" title="How well this fits your taste">${it.match}% match</span>` : ''}
      ${it.rank && it.rank <= 20 ? `<span class="brank${it.rank <= 3 ? ' top' : ''}">${it.rank}</span>` : ''}
      ${it.pct ? `<div class="bprog"><i style="width:${Math.min(100, Math.max(4, Math.round(it.pct)))}%"></i></div>` : ''}</div>
    <div class="binfo"><h3>${esc(it.title)}</h3>${it.match && it.tag ? `<div class="bwhy" title="${esc(it.tag)}">${esc(shortWhy(it.tag))}</div>` : ''}<div class="bmeta"><span>${esc(resuming ? [it.tag === 'Resume' ? '' : it.tag, it.left].filter(Boolean).join(' · ') : it.match ? sub : it.tag && (it.rating || it.chart) ? it.tag : sub)}</span>${right ? `<em>${esc(right)}</em>` : ''}</div>${it.overview ? `<p class="bdesc">${esc(it.overview)}</p>` : ''}</div></article>`;
}
// A loading card has the same shape as a real one: glass poster with a soft light sweeping across, and two lines for the text
const skCard = (i = 0, extra = '') => `<div class="bc sk ${extra}" style="--i:${i}" aria-hidden="true"><div class="bposter">${icon('film')}</div><div class="binfo"><i class="skl"></i><i class="skl s"></i></div></div>`;
const skeleton = (n = 8) => Array.from({ length: n }, (_, i) => skCard(i)).join('');

// ---------- Ambient backdrop follows what you point at ----------
let tintLock = false, hoverToken = 0, baseTint = null, leaveTimer = 0;
const DEFAULT_TINT = ['hsl(228 38% 36%)', 'hsl(262 34% 32%)', 'hsl(200 30% 30%)'];

// Drive the ambient light: three colours plus where the glow sits (toward the card you point at).
function applyTint(pal, at) {
  const p = pal || DEFAULT_TINT, x = at ? at.x : 30, y = at ? at.y : 32, st = document.documentElement.style;
  st.setProperty('--c1', p[0]); st.setProperty('--c2', p[1]); st.setProperty('--c3', p[2]);
  st.setProperty('--x1', x + '%'); st.setProperty('--y1', y + '%');
  st.setProperty('--x2', Math.round(100 - x * 0.7) + '%'); st.setProperty('--y2', Math.round(100 - y * 0.6) + '%');
  st.setProperty('--x3', (x > 50 ? x - 40 : x + 40) + '%'); st.setProperty('--y3', (y > 50 ? y - 42 : y + 42) + '%');
}
async function tintFor(url, at) { const my = ++hoverToken; if (!tintLock) window.__ambArt?.(url); const pal = await paletteOf(url); if (my === hoverToken && !tintLock) applyTint(pal, at); }
let baseUrl = '';
function resetTint() { if (tintLock) return; hoverToken++; window.__ambArt?.(baseUrl); applyTint(baseTint, { x: 32, y: 30 }); }
function heroTint() { const h = $('.hero2', root); if (!h) { baseTint = null; baseUrl = continueItems(store.history, 1)[0]?.poster || ''; return resetTint(); } baseUrl = h.dataset.poster || h.dataset.bg; paletteOf(baseUrl).then((p) => { baseTint = p; resetTint(); }); }
let tintT = 0;
window.setTitleTint = (url, lock) => {
  clearTimeout(tintT);
  // closing a sheet: unlock right away (a delayed unlock could be skipped by a quick hover and freeze the colours);
  // the colour itself stays until the next hovered card
  if (!lock) { tintLock = false; return; }
  hoverToken++; const my = hoverToken;
  tintT = setTimeout(() => { // opening: change the colour after the sheet has animated in
    if (my !== hoverToken) return;
    paletteOf(url).then((p) => { if (my !== hoverToken) return; applyTint(p, { x: 22, y: 46 }); tintLock = true; });
  }, 380);
};

// ---------- Views ----------
async function renderHero(items) {
  const cont = continueItems(store.history, 1)[0];
  const pick = cont || items[0]; if (!pick) return '';
  const type = pick.type === 'series' || pick.type === 'tv' ? 'series' : 'movie';
  const meta = await api(`/api/title/${pick.imdbId}?type=${type}`).catch(() => null);
  const bg = meta?.background || meta?.poster || posterOf(pick.imdbId);
  const kick = cont ? (cont.pct ? 'Continue watching' : 'Next up') : 'Trending';
  const facts = [meta?.year, meta?.runtime || (type === 'series' ? 'Series' : ''), meta?.rating && '★ ' + meta.rating, ...(meta?.genres || []).slice(0, 2)].filter(Boolean);
  const resuming = !!(cont && cont.pct);
  const saved = wl.has(pick.imdbId);
  return `<section class="hero2" data-id="${esc(pick.imdbId)}" data-type="${type}" data-title="${esc(pick.title)}" data-year="${esc(meta?.year || '')}" data-poster="${esc(meta?.poster || '')}" data-rating="${esc(meta?.rating || '')}" ${pick.season ? `data-season="${pick.season}" data-episode="${pick.episode}"` : ''} data-bg="${esc(bg)}">
    <div class="h2bg" style="background-image:url('${esc(bg)}')"></div>
    <div class="h2in">
      <span class="chip2">${icon('bolt')} ${kick}${cont?.tag && cont.tag !== 'Resume' ? ' · ' + esc(cont.tag) : ''}</span>
      <h2>${esc(pick.title)}</h2>
      <div class="facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
      ${meta?.overview ? `<p>${esc(meta.overview)}</p>` : ''}
      ${resuming ? `<div class="hprog"><div><i style="width:${Math.min(100, Math.round(cont.pct))}%"></i></div><span>${esc(cont.left || Math.round(cont.pct) + '% watched')}</span></div>` : ''}
      <div class="hbtns"><button class="pill" data-hero-play>${icon('play')} ${resuming ? 'Resume' : 'Play'}</button><a class="pill ghost2" href="#/title/${type}/${esc(pick.imdbId)}">Details</a>
        <button class="pill ghost2 sq ${saved ? 'on' : ''}" data-hero-save aria-label="${saved ? 'Remove from shelf' : 'Save to shelf'}">${icon('bookmark')}</button></div>
    </div>
    ${meta?.poster ? `<div class="hposter" style="background-image:url('${esc(meta.poster)}')"></div>` : ''}</section>`;
}

async function loadTab(reset = true) {
  const my = ++st.token;
  const grid = $('#grid', root), hero = $('#hero', root), more = $('#more', root);
  if (reset) {
    st.items = [];
    if (grid.children.length && !grid.querySelector('.sk')) { grid.classList.add('leaving'); hero.classList.add('leaving'); await new Promise((r) => setTimeout(r, 170)); }
    if (my !== st.token) return;
    grid.classList.remove('leaving'); hero.classList.remove('leaving');
    grid.innerHTML = skeleton(8); hero.innerHTML = ''; more.innerHTML = '';
    { const c = $('#count', root); if (c) c.textContent = ''; } // the old count would be wrong while this loads
  }
  st.busy = true;
  let items = [], label = '', added = null;
  if (st.tab !== 'home') paintRows([]);
  if (st.tab === 'continue') { items = continueItems(store.history); }
  else if (st.tab === 'shelf') { items = store.watchlist.map((w) => ({ ...w, tag: '' })); }
  else if (st.tab === 'home') {
    const [fy, secs] = await Promise.all([api(`/api/catalog/foryou?seed=${st.seed}`).catch(() => []), api(`/api/foryou/sections?seed=${st.seed}`).catch(() => ({ sections: [] }))]);
    if (my !== st.token) return;
    paintRows(secs.sections || []);
    const cont = continueItems(store.history, 4), seen = new Set(cont.map((c) => c.imdbId));
    const inRows = new Set((secs.sections || []).flatMap((x) => x.items.map((i) => i.imdbId)));
    items = fy.filter((m) => !seen.has(m.imdbId) && !inRows.has(m.imdbId));  // in progress and row picks are shown above
    hero.innerHTML = await renderHero(fy.filter((x) => x.tag === 'Trending').concat(fy));
    if (my !== st.token) return;
  } else {
    const skip = reset ? 0 : st.items.length, key = feedKey(skip);
    // the next page was probably fetched while you were still reading this one
    const got = await (st.pre?.key === key ? st.pre.p : api(feedUrl(skip)).catch(() => []));
    st.pre = null;
    if (my !== st.token) return;
    const seen = new Set(st.items.map((i) => i.imdbId)); const fresh = got.filter((i) => !seen.has(i.imdbId));
    added = fresh.map((f) => ({ ...f, label: FEED_NAME[st.tab] }));
    items = [...st.items, ...added];
    st.more = fresh.length >= 10 && !['boxoffice', 'toprated', 'gems', 'surprise'].includes(st.tab);
  }
  if (my !== st.token) return;
  st.items = items; st.busy = false;
  more.innerHTML = '';
  const emptyHtml = `<div class="empty">${st.tab === 'shelf' ? 'Your shelf is empty. Open a title and tap Save.' : st.tab === 'continue' ? 'Nothing in progress yet.' : 'Nothing here right now.'}</div>`;
  const view = ['continue', 'shelf'].includes(st.tab) ? items : shown(items);
  if (reset) { paintTools(); grid.innerHTML = view.length ? view.map(card).join('') : emptyHtml; }
  else syncGrid(view, emptyHtml); // more arriving at the end: nothing you are looking at is touched
  prefetch(view.map((i) => posterOf(i.imdbId)));
  if (st.more) readAhead();
  checkMore(); // the page may still be short (filters hide titles), so look again
}

// ---- endless scrolling: the next page is fetched in the background as soon as one arrives, and added before you reach the end
function feedUrl(skip) {
  const fm = feedMeta(base(st.tab)), qs = new URLSearchParams();
  if (st.genre && st.tab !== 'new') qs.set('genre', st.genre);
  if (fm.tmdb) qs.set('type', st.tkind || '');
  if (fm.cine) { qs.set('type', st.kind); if (st.year) qs.set('year', st.year); if (fm.shuffle || st.tab === 'gems') qs.set('seed', st.seed); }
  if (skip) qs.set('skip', skip);
  return `/api/catalog/feed/${feedId()}?${qs}`;
}
const feedKey = (skip) => feedUrl(skip);
function readAhead() {
  const skip = st.items.length, key = feedKey(skip);
  if (st.pre?.key === key) return;
  const p = api(feedUrl(skip)).catch(() => []);
  st.pre = { key, p };
  p.then((l) => prefetch(l.map((i) => posterOf(i.imdbId)))); // warm the posters too
}
const nearBottom = () => { const m = $('#more', root); return !!m && m.getBoundingClientRect().top < innerHeight * 2.2; };
function checkMore() {
  if (!st.more || st.busy || root.classList.contains('hidden') || !nearBottom()) return;
  const grid = $('#grid', root); if (!grid.querySelector('.bc.tmp')) grid.insertAdjacentHTML('beforeend', Array.from({ length: 4 }, (_, i) => skCard(i, 'tmp')).join('')); // placeholders, only if it isn't ready yet
  loadTab(false);
}

// Redraw only the cards, after a sort or filter change. No network.
function regrid() {
  const view = shown(st.items);
  syncGrid(view, '<div class="empty">Nothing matches these filters. Try loosening them.</div>');
  const c = $('#count', root); if (c) c.textContent = `${view.length} title${view.length === 1 ? '' : 's'}`;
  checkMore();
}

// Update the cards without moving the page. New cards at the end are simply added; anything else is
// swapped in while the grid keeps its height and the scroll position is put back.
function syncGrid(view, emptyHtml) {
  const grid = $('#grid', root);
  grid.querySelectorAll('.bc.tmp').forEach((n) => n.remove());
  const have = [...grid.querySelectorAll('.bc[data-id]:not(.sk)')].map((n) => n.dataset.id), want = view.map((i) => i.imdbId);
  const append = have.length && have.length <= want.length && have.every((id, k) => id === want[k]) && !grid.querySelector('.empty, .sk');
  if (append) { if (want.length > have.length) grid.insertAdjacentHTML('beforeend', view.slice(have.length).map((it, k) => card(it, k % 6)).join('')); return; }
  const y = scrollY; grid.style.minHeight = grid.offsetHeight + 'px';
  grid.innerHTML = view.length ? view.map(card).join('') : emptyHtml;
  scrollTo({ top: y, behavior: 'instant' });
  requestAnimationFrame(() => { grid.style.minHeight = ''; });
}

function paintTools() {
  const el = $('#tools', root); if (!el) return;
  const t = st.tab, fm = feedMeta(base(t)), isFeed = !['continue', 'shelf'].includes(t);
  if (!isFeed) { el.innerHTML = ''; return; }
  const dual = t === 'home' || fm.tmdb ? false : isTrakt(t) || fm.cine, glist = fm.cine || fm.tmdb ? cineGenres : genres;
  const years = Array.from({ length: new Date().getFullYear() - 1949 }, (_, i) => String(new Date().getFullYear() - i));
  el.innerHTML = `<div class="tl">
    ${dual ? `<div class="seg2" role="group" aria-label="Type"><button data-kind="movie" class="${st.kind === 'movie' ? 'on' : ''}">Movies</button><button data-kind="series" class="${st.kind === 'series' ? 'on' : ''}">Series</button></div>` : ''}
    ${fm.tmdb && fm.kind === 'both' ? `<div class="seg2" role="group" aria-label="Type"><button data-tk="" class="${!st.tkind ? 'on' : ''}">All</button><button data-tk="movie" class="${st.tkind === 'movie' ? 'on' : ''}">Films</button><button data-tk="series" class="${st.tkind === 'series' ? 'on' : ''}">Series</button></div>` : ''}
    ${t !== 'home' && t !== 'boxoffice' && glist.length ? '<span id="gsel"></span>' : ''}
    ${t === 'new' ? '<span id="ysel"></span>' : ''}
    <span id="srt"></span>
    <span id="mnr"></span>
    <button class="chk ${st.hideSeen ? 'on' : ''}" id="hws" aria-pressed="${st.hideSeen}">${icon('check')} Hide watched</button>
    ${t === 'home' || fm.shuffle || t === 'gems' ? `<button class="chk shuf" id="shuf">${icon('bolt')} Shuffle</button>` : ''}
    <span class="cnt" id="count"></span></div>`;
  $$('[data-tk]', el).forEach((b) => (b.onclick = () => { st.tkind = b.dataset.tk; keep('tkind', st.tkind); loadTab(true); }));
  $$('[data-kind]', el).forEach((b) => (b.onclick = () => { st.kind = b.dataset.kind; keep('kind', st.kind); st.genre = ''; loadTab(true); }));
  const dd = (id, label, options, value, onChange) => { const h = $('#' + id, el); if (h) makeDropdown(h, { label, options, value, onChange }); };
  dd('gsel', 'Genre', [['', 'All genres'], ...glist.map((g) => [g, g])], st.genre, (v) => { st.genre = v; t === 'new' ? regrid() : loadTab(true); });
  dd('ysel', 'Year', years.map((y) => [y, y === String(new Date().getFullYear()) ? `${y} (this year)` : y]), st.year || years[0], (v) => { st.year = v; loadTab(true); });
  dd('srt', 'Sort', SORTS, st.sort, (v) => { st.sort = v; keep('sort', v); regrid(); });
  dd('mnr', 'Minimum rating', [[0, 'Any rating'], [6, '6+ rating'], [7, '7+ rating'], [8, '8+ rating']], st.min, (v) => { st.min = +v; keep('min', st.min); regrid(); });
  $('#hws', el).onclick = (e) => { st.hideSeen = !st.hideSeen; keep('hide', st.hideSeen); e.currentTarget.classList.toggle('on', st.hideSeen); e.currentTarget.setAttribute('aria-pressed', String(st.hideSeen)); regrid(); };
  $('#shuf', el)?.addEventListener('click', () => { st.seed = Math.floor(Math.random() * 1e9); loadTab(true); });
  const c = $('#count', el); if (c) c.textContent = `${shown(st.items).length} title${shown(st.items).length === 1 ? '' : 's'}`;
}

// Keep the active tab in view by scrolling the strip sideways only (scrollIntoView also moved the page up and down)
function tabEdges() {
  const t = $('#tabs', root); if (!t) return;
  t.style.setProperty('--ml', t.scrollLeft > 4 ? '36px' : '0px');
  t.style.setProperty('--mr', t.scrollLeft + t.clientWidth < t.scrollWidth - 4 ? '36px' : '0px');
}
function tabsToActive() {
  const t = $('#tabs', root), on = t?.querySelector('a.on'); if (!on) return;
  const left = on.offsetLeft, right = left + on.offsetWidth, pad = 48;
  if (left - pad < t.scrollLeft) t.scrollTo({ left: Math.max(0, left - pad), behavior: 'smooth' });
  else if (right + pad > t.scrollLeft + t.clientWidth) t.scrollTo({ left: right + pad - t.clientWidth, behavior: 'smooth' });
  tabEdges();
}

function moveInd() {
  const tabs = $('#tabs', root), on = tabs?.querySelector('a.on'), ind = tabs?.querySelector('.ind');
  if (!on || !ind) return;
  ind.style.width = on.offsetWidth + 'px'; ind.style.transform = `translateX(${on.offsetLeft}px)`;
}

// ---------- The rail on the right: what needs you, what is playing, what to continue, who is online ----------
const attr = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
const pk = (id) => `https://images.metahub.space/poster/small/${id}/img`;
const mins = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m left` : `${m}m left`; };
function paintRail() {
  const el = $('#rail', root); if (!el) return;
  const s = social.state || {}, np = store.np, fr = (s.friends || []).filter((f) => f.online);
  const invites = (s.invites || []).slice(0, 2), reqs = s.incoming || [], room = s.room;
  const slots = Math.max(4, Math.floor((innerHeight - 150) / 62));
  const fixed = 1 + (np ? 1 : 0) + (room ? 1 : 0) + invites.length + (reqs.length ? 1 : 0), left = Math.max(1, slots - fixed);
  const frN = Math.min(fr.length, Math.floor(left * 0.4)), contN = Math.min(left - frN, 6);
  const cont = continueItems(store.history, 12).filter((c) => !np || c.imdbId !== np.imdbId).slice(0, contN);
  const poster = (id) => `style="background-image:url('${pk(esc(id))}')"`;
  const route = (t, id) => `#/title/${t === 'tv' || t === 'series' ? 'series' : 'movie'}/${esc(id)}`;
  const out = []; let k = 0;
  const K = () => `style="--k:${k++}"`;
  // things that are waiting for you come first
  for (const iv of invites) out.push(`<button class="rd inv" ${K()} ${attr({ r: 'invite', kind: 'invite', code: iv.code, title: iv.from.name, sub: `invited you to ${iv.name}`, pid: iv.media?.imdbId, media: iv.media?.title, hint: '' })} aria-label="${esc(iv.from.name)} invited you"><span class="rd-i">${avatar({ avatar: iv.from.avatar }, 46)}</span><b class="rd-ping"></b></button>`);
  if (reqs.length) out.push(`<button class="rd inv" ${K()} ${attr({ r: 'req', kind: 'req', id: reqs[0].id, title: reqs[0].name, sub: reqs.length > 1 ? `and ${reqs.length - 1} more want to be friends` : 'wants to be friends' })} aria-label="Friend request"><span class="rd-i">${avatar({ avatar: reqs[0].avatar }, 46)}</span><b class="rd-ping"></b><b class="rd-n">${reqs.length}</b></button>`);
  if (np) out.push(`<button class="rd now" ${K()} style="--p:0" ${attr({ r: 'now', kind: 'now', p: np.pct, pid: np.imdbId, title: np.title, sub: [np.season ? `S${pad(np.season)}E${pad(np.episode)}` : '', np.left ? mins(np.left) : ''].filter(Boolean).join(' · '), pct: np.pct })} aria-label="Now playing: ${esc(np.title || '')}"><i class="rd-i" ${np.imdbId ? poster(np.imdbId) : ''}></i><b class="rd-pulse"></b></button>`);
  if (room) out.push(`<button class="rd room" ${K()} ${attr({ r: 'room', kind: 'room', title: room.name, pid: room.media?.imdbId, sub: room.media?.title ? `${room.media.title}` : 'Picking something to watch', n: room.members.length, state: room.gate ? 'Getting ready' : room.pb?.playing ? 'Playing' : 'Paused' })} aria-label="Your room: ${esc(room.name)}"><i class="rd-i" ${room.media?.imdbId ? poster(room.media.imdbId) : ''}>${room.media?.imdbId ? '' : icon('users')}</i><b class="rd-n">${room.members.length}</b></button>`);
  for (const c of cont) out.push(`<button class="rd" ${K()} style="--p:0" ${attr({ r: 'play', kind: 'play', p: c.pct, id: c.imdbId, type: c.type, title: c.title, season: c.season, episode: c.episode, href: route(c.type, c.imdbId), pid: c.imdbId, pct: Math.round(c.pct || 0), sub: [c.tag === 'Resume' ? '' : c.tag, c.left].filter(Boolean).join(' · ') })} aria-label="Resume ${esc(c.title)}"><i class="rd-i" ${poster(c.imdbId)}></i></button>`);
  if (frN) out.push('<i class="rd-sep" aria-hidden="true"></i>');
  for (const f of fr.slice(0, frN)) {
    const what = f.status?.title ? `Watching ${f.status.title}` : f.inRoom ? `In ${f.inRoom.name}` : f.away ? 'Tabbed out' : 'Online';
    out.push(`<button class="rd fr ${f.status || f.inRoom ? 'busy' : ''}" ${K()} ${attr({ r: 'friend', kind: 'friend', id: f.id, room: f.inRoom?.code, name: f.name, title: f.name, sub: what, mine: room && !f.inRoom ? '1' : '', pid: f.status?.imdbId && f.status.imdbId !== 'synctest' ? f.status.imdbId : '' })} aria-label="${esc(f.name)}"><span class="rd-i">${avatar({ avatar: f.avatar }, 46)}</span><b class="rd-live"></b></button>`);
  }
  out.push(`<button class="rd plus" ${K()} id="rSearch" ${attr({ r: 'search', kind: 'search', title: 'Search', sub: 'Drop a title here to save it' })} aria-label="Search">${icon('search')}</button>`);
  const html = out.join('');
  if (el._h === html) return;
  el._h = html; el.innerHTML = html; dock.dirty = true; dock.list = [];
  requestAnimationFrame(() => requestAnimationFrame(() => el.querySelectorAll('.rd[data-p]').forEach((b) => b.style.setProperty('--p', Math.min(100, Math.max(3, +b.dataset.p || 0))))));  // rings fill up
  if (!el.dataset.ready) setTimeout(() => { el.dataset.ready = '1'; }, 1600);  // the entrance only plays the first time
}

// ---------- The dock: circles swell toward the pointer and push their neighbours away, on a spring ----------
// Positions are measured once (not on every move), and every frame is plain arithmetic plus one transform per circle.
const dock = { list: [], seps: [], py: null, raf: 0, dirty: true };
function dockMeasure(rail) {
  dock.list = [...rail.querySelectorAll('.rd')].map((b) => ({ b, c: b.offsetTop + b.offsetHeight / 2, s: 1, vs: 0, ts: 1, y: 0, vy: 0, ty: 0 }));
  dock.seps = [...rail.querySelectorAll('.rd-sep')].map((b) => ({ b, mid: b.offsetTop + b.offsetHeight / 2, y: 0 }));
  dock.top = rail.getBoundingClientRect().top; dock.dirty = false;
}
function dockAim(rail, clientY) {
  if (dock.dirty || !dock.list.length) dockMeasure(rail);
  const L = dock.list; if (!L.length) return;
  if (clientY == null) L.forEach((i) => { i.ts = 1; i.ty = 0; });
  else {
    const py = clientY - dock.top, H = 46; let m = 0;
    L.forEach((it, i) => { it.ts = 1 + 0.4 * Math.exp(-((py - it.c) ** 2) / (2 * 52 * 52)); if (Math.abs(py - it.c) < Math.abs(py - L[m].c)) m = i; });
    const y = L.map((it) => it.c);                       // new centres: the circle under the pointer stays put, the rest make room
    for (let i = m + 1; i < L.length; i++) y[i] = y[i - 1] + (H * L[i - 1].ts + H * L[i].ts) / 2 + (L[i].c - L[i - 1].c - H);
    for (let i = m - 1; i >= 0; i--) y[i] = y[i + 1] - (H * L[i + 1].ts + H * L[i].ts) / 2 - (L[i + 1].c - L[i].c - H);
    L.forEach((it, i) => { it.ty = y[i] - it.c; });
  }
  dock.py = clientY;
  if (!dock.raf) dock.raf = requestAnimationFrame(dockStep);
}
function dockStep() {
  dock.raf = 0; let moving = false;
  const instant = matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'off';
  for (const it of dock.list) {
    if (instant) { it.s = it.ts; it.y = it.ty; it.vs = it.vy = 0; }
    else { it.vs = (it.vs + (it.ts - it.s) * 0.22) * 0.6; it.s += it.vs; it.vy = (it.vy + (it.ty - it.y) * 0.22) * 0.6; it.y += it.vy; }
    if (Math.abs(it.ts - it.s) > 0.002 || Math.abs(it.vs) > 0.002 || Math.abs(it.ty - it.y) > 0.05 || Math.abs(it.vy) > 0.05) moving = true;
    it.b.style.transform = `translate3d(0, ${it.y.toFixed(2)}px, 0) scale(${it.s.toFixed(4)})`;
  }
  for (const sp of dock.seps) { let k = 0; dock.list.forEach((it, i) => { if (it.c < sp.mid) k = i; }); const a = dock.list[k], b = dock.list[Math.min(k + 1, dock.list.length - 1)]; sp.b.style.transform = `translate3d(0, ${(((a?.y || 0) + (b?.y || 0)) / 2).toFixed(2)}px, 0)`; }
  if (moving) dock.raf = requestAnimationFrame(dockStep);
  else if (dock.py == null) { dock.list.forEach((it) => { it.b.style.transform = ''; }); dock.seps.forEach((sp) => { sp.b.style.transform = ''; }); }
}

// ---------- Pop-out preview: the circle opens into a card that shows what it is, with buttons you can press ----------
let peek = null, peekT = 0, hideT = 0, peekFor = null, peekD = null;
const ic = (n) => icon(n);
function peekActions(d) {
  const a = (act, label, icn, cls = '') => `<button type="button" class="pk-a ${cls}" data-pa="${act}">${icn ? ic(icn) : ''}${label ? `<span>${label}</span>` : ''}</button>`;
  switch (d.kind) {
    case 'play': return a('resume', 'Resume', 'play', 'main') + a('details', '', 'info') + a('forget', '', 'x');
    case 'now': return a('back', '', 'back') + a('toggle', '', 'pause', 'main') + a('fwd', '', 'fwd') + a('remote', 'Remote', '');
    case 'room': return a('room', 'Open', 'play', 'main') + a('leave', 'Leave', '');
    case 'invite': return a('join', 'Join', 'play', 'main') + a('dismiss', 'Dismiss', '');
    case 'req': return a('accept', 'Accept', 'check', 'main') + a('ignore', 'Ignore', '');
    case 'friend': return (d.room ? a('joinfriend', 'Join', 'users', 'main') : a('profile', 'Profile', 'user', 'main')) + (d.mine ? a('invite', 'Invite', 'users') : '');
    default: return '';
  }
}
const KICK = { play: 'Continue watching', now: 'Playing now', room: 'Your room', invite: 'Invitation', req: 'Friend request', friend: 'Friend' };
function peekHtml(b) {
  const d = b.dataset, bar = d.pct ? `<div class="pk-bar"><i style="width:${Math.min(100, +d.pct)}%"></i></div>` : '';
  if (d.kind === 'search') return `<div class="pk-t"><b>${esc(d.title)}</b><small>${esc(d.sub)}</small></div>`;
  const acts = `<div class="pk-acts">${peekActions(d)}</div>`;
  if (d.kind === 'friend' || d.kind === 'invite' || d.kind === 'req') {
    const p = d.kind === 'friend' ? social.state?.friends?.find((f) => f.id === d.id) : d.kind === 'invite' ? social.state?.invites?.find((i) => i.code === d.code)?.from : social.state?.incoming?.find((r) => r.id === d.id);
    return `<span class="pk-av">${avatar({ avatar: p?.avatar }, 54)}</span><div class="pk-t"><em>${KICK[d.kind]}</em><b>${esc(d.title)}</b><small>${esc(d.sub)}</small>${acts}</div>${d.pid ? `<span class="pk-p small" style="background-image:url('${pk(esc(d.pid))}')"></span>` : ''}`;
  }
  if (d.kind === 'room') {
    const r = social.state?.room, who = (r?.members || []).slice(0, 6).map((m) => `<span title="${esc(m.name)}">${avatar({ avatar: { ...m.avatar, deco: null, frame: 'none' } }, 24)}</span>`).join('');
    return `${d.pid ? `<span class="pk-p" style="background-image:url('${pk(esc(d.pid))}')"></span>` : `<span class="pk-av">${ic('users')}</span>`}<div class="pk-t"><em>${KICK.room} · ${esc(d.state)}</em><b>${esc(d.title)}</b><small>${esc(d.sub)}</small><div class="pk-who">${who}<small>${esc(d.n)} here</small></div>${acts}</div>`;
  }
  return `<span class="pk-p" style="background-image:url('${pk(esc(d.pid))}')"></span><div class="pk-t"><em>${KICK[d.kind] || ''}</em><b>${esc(d.title)}</b><small>${esc(d.sub)}</small>${bar}${acts}</div>`;
}
function showPeek(b) {
  clearTimeout(hideT);
  if (peekFor === b && peek?.classList.contains('in')) return;
  if (!peek) {
    peek = document.createElement('div'); peek.className = 'rpeek'; document.body.appendChild(peek);
    peek.addEventListener('pointerenter', () => clearTimeout(hideT)); peek.addEventListener('pointerleave', hidePeek);
    peek.addEventListener('click', peekClick);
  }
  const was = peek.classList.contains('in'), my = peekFor = b; peekD = { ...b.dataset };
  const place = () => {
    const r = b.getBoundingClientRect(), h = peek.offsetHeight, top = Math.max(12, Math.min(innerHeight - h - 12, r.top + r.height / 2 - h / 2));
    peek.style.top = top + 'px'; peek.style.right = innerWidth - r.left + 12 + 'px';
    peek.style.setProperty('--oy', Math.round(r.top + r.height / 2 - top) + 'px'); // the circle it grows out of
  };
  const fill = () => { peek.innerHTML = peekHtml(b); peek.classList.toggle('slim', b.dataset.kind === 'search'); place(); };
  if (was) { peek.classList.add('swap'); setTimeout(() => { if (peekFor !== my) return; fill(); peek.classList.remove('swap'); }, 90); place(); }
  else { fill(); requestAnimationFrame(() => peek.classList.add('in')); }
  const id = b.dataset.pid; // the colours of the poster light the card and the ring
  if (id) paletteOf(posterOf(id)).then((p) => { if (peekFor === my && p) { peek.style.setProperty('--glow', p[0]); b.style.setProperty('--glow', p[0]); } });
  else peek.style.removeProperty('--glow');
}
function hidePeek() { clearTimeout(hideT); hideT = setTimeout(() => { peekFor = null; peek?.classList.remove('in', 'swap'); }, 160); }
const ctl = (action, value) => post('/api/control', { action, value }).then(() => window.pollRemote?.());
function peekClick(e) {
  const a = e.target.closest('[data-pa]'); if (!a || !peekD) return; e.stopPropagation();
  const d = peekD, act = a.dataset.pa, item = { imdbId: d.id, type: d.type, title: d.title, ...(d.season ? { season: +d.season, episode: +d.episode } : {}) };
  const err = (er) => toast(er.message, 'err');
  const done = () => { peekFor = null; peek?.classList.remove('in'); };
  switch (act) {
    case 'resume': done(); quickPlay(item); break;
    case 'details': done(); location.hash = d.href; break;
    case 'forget': done(); forgetTitle(d.id, d.title); break;
    case 'back': ctl('seek_back', 30); break;
    case 'fwd': ctl('seek_forward', 30); break;
    case 'toggle': ctl('toggle').then(() => { a.innerHTML = ic(store.np?.playing ? 'play' : 'pause'); }); break;
    case 'remote': done(); import('../now.js').then((m) => m.openNow()); break;
    case 'room': done(); import('../roomplay.js').then((m) => (social.state?.room?.media ? m.joinRoomPlayback() : (location.hash = '#/friends'))); break;
    case 'leave': done(); sapi('/room/leave').catch(err); break;
    case 'join': done(); sapi('/room/join', { code: d.code }).then(() => toast('Joining the room', 'ok')).catch(err); break;
    case 'dismiss': done(); sapi('/room/invite/dismiss', { code: d.code }).catch(err); break;
    case 'accept': done(); sapi('/friends/accept', { id: d.id }).catch(err); break;
    case 'ignore': done(); sapi('/friends/decline', { id: d.id }).catch(err); break;
    case 'joinfriend': done(); sapi('/room/join', { code: d.room }).then(() => toast('Joining the room', 'ok')).catch(err); break;
    case 'profile': done(); location.hash = `#/profile/${d.id}`; break;
    case 'invite': sapi('/room/invite', { id: d.id }); toast(`Invited ${d.name}`, 'ok'); break;
  }
}
function railClick(e) {
  const b = e.target.closest('[data-r]'); if (!b) return;
  const r = b.dataset.r;
  if (r === 'play') { b.classList.add('go'); setTimeout(() => b.classList.remove('go'), 5000); hidePeek(); quickPlay({ imdbId: b.dataset.id, type: b.dataset.type, title: b.dataset.title, ...(b.dataset.season ? { season: +b.dataset.season, episode: +b.dataset.episode } : {}) }); }
  else if (r === 'now') import('../now.js').then((m) => m.openNow());
  else if (r === 'search') import('../palette.js').then((m) => m.openPalette());
  else if (r === 'room') import('../roomplay.js').then((m) => (social.state?.room?.media ? m.joinRoomPlayback() : (location.hash = '#/friends')));
  else if (r === 'invite') sapi('/room/join', { code: b.dataset.code }).then(() => toast('Joining the room', 'ok')).catch((er) => toast(er.message, 'err'));
  else if (r === 'req') location.hash = '#/friends';
  else if (r === 'friend') { if (b.dataset.room) sapi('/room/join', { code: b.dataset.room }).then(() => toast('Joining the room', 'ok')).catch((er) => toast(er.message, 'err')); else location.hash = `#/profile/${b.dataset.id}`; }
}

// The row on Home with what you are in the middle of. Updates as soon as history changes.
function paintCont() {
  const el = $('#cont', root); if (!el) return;
  const list = st.tab === 'home' ? continueItems(store.history, 14) : [];
  if (st.tab !== 'home') { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  const h = new Date().getHours(), hi = h < 5 ? 'Still up' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening', name = store.settings?.profile?.name || '', top = list[0];
  const what = top ? `${esc(top.title)}${top.left ? ` · ${esc(top.left)}` : ''}${top.tag && top.tag !== 'Resume' ? ` · ${esc(top.tag.replace('Next · ', ''))}` : ''}` : '';
  el.innerHTML = `<div class="greet"><div><h1>${hi}${name ? `, ${esc(name)}` : ''}</h1><p>${top ? `${top.pct ? 'Pick up where you left off' : 'Up next'}: <b>${what}</b>` : 'What are we watching tonight?'}</p></div>
    <div class="greet-b">${top ? `<button class="pill" data-gplay data-id="${esc(top.imdbId)}" data-type="${esc(top.type)}" data-title="${esc(top.title)}" ${top.season ? `data-season="${top.season}" data-episode="${top.episode}"` : ''}>${icon('play')} ${top.pct ? 'Resume' : 'Play'}</button>` : ''}<button class="pill ghost2" data-gsearch>${icon('search')} Search</button></div></div>
    ${list.length ? `<header><h2>Continue watching</h2><a href="#/continue">See all</a></header><div class="cont-row">${list.map((it, i) => card(it, i)).join('')}</div>` : ''}`;
}

// For You rows: top picks, "because you loved", new, hidden gems, something different (from the taste engine)
function paintRows(sections) {
  const el = $('#fyRows', root); if (!el) return;
  const hid = hiddenIds(); sections = sections.map((x) => ({ ...x, items: x.items.filter((i) => !hid.has(i.imdbId)) })).filter((x) => x.items.length);
  el.innerHTML = sections.map((sec) => `<section class="fy-row"><header><h3>${esc(sec.title)}</h3>${sec.sub ? `<span>${esc(sec.sub)}</span>` : ''}</header>
    <div class="fy-scroll">${sec.items.map((it, i) => card(it, i)).join('')}</div></section>`).join('') + (sections.length ? '<header class="fy-more"><h3>More for you</h3><span>Sort and filter apply here</span></header>' : '');
}
function paintChrome() {
  paintCont();
  closeDropdown();
  $('#tabs', root).innerHTML = TABS.map((t) => `<a href="${hrefOf(t)}" class="${t[0] === st.tab ? 'on' : ''}">${t[1]}${t[0] === 'shelf' && wl.size ? `<em>${wl.size}</em>` : ''}</a>`).join('') + '<i class="ind"></i>';
  requestAnimationFrame(() => moveInd());
  paintTools();
  tabsToActive();
  paintRail();
}

// ---------- Public API ----------
export async function mount(el) {
  root = el;
  el.innerHTML = `<div class="amb"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="spot"></i></div>
    <div class="bwrap"><div id="hero"></div>
      <section id="cont" class="cont hidden" aria-label="Continue watching"></section>
      <div class="tabrow"><nav id="tabs" class="tabs2" aria-label="Categories"></nav></div>
      <div id="fyRows" class="fy-rows"></div><div id="tools" class="tools"></div><div id="grid" class="bgrid"></div><div id="more" class="more"></div></div>
    <aside id="rail" class="rail2" aria-label="Continue watching, friends and now playing"></aside>`;
  applyTint(null);
  const meta = await api('/api/catalog/feeds').catch(() => ({ feeds: [], genres: [] }));
  feeds = meta.feeds; genres = meta.genres; cineGenres = meta.cineGenres || [];

  // interactions: delegation on the whole view
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-hero-save]')) {
      const h = e.target.closest('.hero2'), btn = e.target.closest('[data-hero-save]');
      toggleSave({ imdbId: h.dataset.id, type: h.dataset.type, title: h.dataset.title, year: h.dataset.year, poster: h.dataset.poster, rating: h.dataset.rating }).then((on) => btn.classList.toggle('on', on));
      return;
    }
    const gp = e.target.closest('[data-gplay]');
    if (gp) { quickPlay({ imdbId: gp.dataset.id, type: gp.dataset.type, title: gp.dataset.title, ...(gp.dataset.season ? { season: +gp.dataset.season, episode: +gp.dataset.episode } : {}) }); return; }
    if (e.target.closest('[data-gsearch]')) { import('../palette.js').then((m) => m.openPalette()); return; }
    if (e.target.closest('[data-hero-play]')) { const h = e.target.closest('.hero2'); quickPlay({ imdbId: h.dataset.id, type: h.dataset.type, title: h.dataset.title, ...(h.dataset.season ? { season: +h.dataset.season, episode: +h.dataset.episode } : {}) }); return; }
    const c = e.target.closest('.bc[data-id]'); if (!c) return;
    location.hash = `#/title/${c.dataset.type}/${c.dataset.id}`;
  });
  el.addEventListener('pointerdown', (e) => { const c = e.target.closest?.('.bc[data-id]'); if (c) prefetchTitle(c.dataset.type, c.dataset.id); });
  // cards on screen quietly warm their details (title data only, two at a time, when the app is idle)
  const warmQ = [], warmSeen = new Set(); let warming = 0;
  const pump = () => { while (warming < 2 && warmQ.length) { const c = warmQ.shift(); warming++; (window.requestIdleCallback || setTimeout)(() => { prefetchTitle(c.type, c.id, true); setTimeout(() => { warming--; pump(); }, 250); }, { timeout: 1500 }); } };
  const warmIO = new IntersectionObserver((es) => { for (const e of es) { if (!e.isIntersecting) continue; const d = e.target.dataset; warmIO.unobserve(e.target); if (!d.id || warmSeen.has(d.id)) continue; warmSeen.add(d.id); warmQ.push({ id: d.id, type: d.type }); } pump(); }, { rootMargin: '200px 0px' });
  new MutationObserver(() => el.querySelectorAll('.bc[data-id]:not([data-warm])').forEach((c) => { c.dataset.warm = '1'; warmIO.observe(c); })).observe(el, { childList: true, subtree: true });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const c = e.target.closest?.('.bc[data-id]'); if (c) location.hash = `#/title/${c.dataset.type}/${c.dataset.id}`; } });
  // hover a card: the light glides toward it and takes on its colours
  let warmT = 0, scrolling = 0; addEventListener('scroll', () => { clearTimeout(scrolling); scrolling = setTimeout(() => { scrolling = 0; }, 160); }, { passive: true, capture: true });
  el.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || scrolling) return;
    const c = e.target.closest('.bc[data-poster]');
    clearTimeout(leaveTimer);
    if (c && c.dataset.id) { clearTimeout(warmT); warmT = setTimeout(() => prefetchTitle(c.dataset.type, c.dataset.id), 60); }
    if (c) { const r = c.getBoundingClientRect(); tintFor(c.dataset.poster, { x: Math.round(((r.left + r.width / 2) / innerWidth) * 100), y: Math.round(((r.top + r.height / 2) / innerHeight) * 100) }); }
    else if (e.target.closest('.hero2')) { const h = $('.hero2', el); tintFor(h.dataset.poster || h.dataset.bg, { x: 62, y: 30 }); }
    // gaps and empty space keep the last card's colour: it only changes when another card is hovered
  });

  // cursor spotlight (smoothed) + card tilt + hero parallax
  let tx = innerWidth * 0.5, ty = innerHeight * 0.4, cx = tx, cy = ty, raf = 0;
  const loop = () => { cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12; window.__spot ? window.__spot(cx, cy) : (document.documentElement.style.setProperty('--mx', cx.toFixed(1) + 'px'), document.documentElement.style.setProperty('--my', cy.toFixed(1) + 'px')); raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.5 ? requestAnimationFrame(loop) : 0; };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || el.classList.contains('hidden')) return;
    tx = e.clientX; ty = e.clientY; if (!raf) raf = requestAnimationFrame(loop);
    const h = e.target.closest?.('.hero2');
    if (h) { const r = h.getBoundingClientRect(); h.style.setProperty('--px', (((e.clientX - r.left) / r.width) - 0.5).toFixed(3)); h.style.setProperty('--py', (((e.clientY - r.top) / r.height) - 0.5).toFixed(3)); }
  }, { passive: true });
  window.addEventListener('resize', () => { moveInd(); tabEdges(); dock.dirty = true; paintRail(); });
  window.addEventListener('rail-refresh', paintRail);
  onState((st) => { const k = JSON.stringify([st.friends.map((f) => [f.id, f.online, f.status?.title, f.inRoom?.code, f.away]), st.room && [st.room.code, st.room.name, st.room.media?.imdbId, st.room.members.length, !!st.room.gate, st.room.pb?.playing], (st.invites || []).map((i) => i.code), (st.incoming || []).map((r) => r.id)]); if (k !== root._fk) { root._fk = k; paintRail(); } });
  const rail = $('#rail', root);
  rail.addEventListener('click', railClick);
  // the dock and the pop-out preview
  rail.addEventListener('pointerenter', () => { dock.dirty = true; });
  rail.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    dockAim(rail, e.clientY);
    const b = e.target.closest('.rd');
    if (b) { clearTimeout(peekT); peekT = setTimeout(() => showPeek(b), peek?.classList.contains('in') ? 0 : 80); } else hidePeek();
  }, { passive: true });
  rail.addEventListener('pointerleave', () => { clearTimeout(peekT); dockAim(rail, null); hidePeek(); });
  rail.addEventListener('focusin', (e) => { const b = e.target.closest('.rd'); if (b) showPeek(b); });
  rail.addEventListener('focusout', hidePeek);
  // right-click on a card or a circle opens its menu
  document.addEventListener('contextmenu', (e) => {
    if (root.classList.contains('hidden') || e.target.closest('input, textarea, select, .dossier, .wp, .ctx')) return;
    const b = e.target.closest('#rail .rd'), c = !b && e.target.closest('.bc[data-id]:not(.sk)');
    const m = b ? railMenu(b) : c ? cardMenu(c) : null; if (!m) return;
    e.preventDefault(); hidePeek(); openMenu(e.clientX, e.clientY, m.items, m.head);
  });
  // drag a card onto the magnifier to save it to the shelf
  el.addEventListener('dragstart', (e) => { const c = e.target.closest?.('.bc[data-id]'); if (!c || c.classList.contains('sk')) return; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', c.dataset.title); window.__drag = { imdbId: c.dataset.id, type: c.dataset.type, title: c.dataset.title, year: c.dataset.year, poster: c.dataset.poster, rating: c.dataset.rating }; rail.classList.add('dropping'); });
  el.addEventListener('dragend', () => { window.__drag = null; rail.classList.remove('dropping'); $('#rSearch', rail)?.classList.remove('over'); });
  rail.addEventListener('dragover', (e) => { if (window.__drag && e.target.closest('#rSearch')) { e.preventDefault(); $('#rSearch', rail).classList.add('over'); } });
  rail.addEventListener('dragleave', (e) => { if (e.target.closest('#rSearch')) $('#rSearch', rail).classList.remove('over'); });
  rail.addEventListener('drop', async (e) => { const d = window.__drag; if (!d || !e.target.closest('#rSearch')) return; e.preventDefault(); window.__drag = null; rail.classList.remove('dropping'); $('#rSearch', rail)?.classList.remove('over'); if (wl.has(d.imdbId)) return toast(`${d.title} is already on your shelf`); await toggleSave(d); });
  $('#tabs', root).addEventListener('scroll', tabEdges, { passive: true });
  window.addEventListener('scroll', () => { if (st.more && !st.busy) checkMore(); }, { passive: true });
  window.browseTasteChanged = () => { st.tasteDirty = true; };
  window.browseRefresh = () => { paintCont(); paintChrome(); if (['continue', 'shelf'].includes(st.tab)) loadTab(true); };
}

export function handle(kind, params = {}) {
  if (kind === 'away') return;
  if (kind === 'title') { if (!st.items.length && !st.busy) { st.tab = 'home'; paintChrome(); loadTab(true).then(() => heroTint()); } openDossier({ type: params.type, id: params.id }); return; }
  const fromSheet = !!document.querySelector('.dossier.open');
  closeDossier();
  const tab = kind === 'feed' ? params.feed : kind === 'continue' ? 'continue' : kind === 'shelf' ? 'shelf' : 'home';
  if (kind === 'search') { import('../palette.js').then((m) => m.openPalette(params.q || '')); }
  if (tab !== st.tab || !st.items.length || kind === 'home' && !$('.hero2', root)) { st.tab = isTrakt(tab) ? base(tab) : tab; if (isTrakt(tab)) st.kind = tab.endsWith('shows') ? 'series' : st.kind; st.genre = ''; st.year = ''; window.scrollTo({ top: 0, behavior: 'instant' }); paintChrome(); loadTab(true).then(() => heroTint()); }
  else if (!fromSheet) paintChrome(); // closing a title sheet: the page underneath is already right, repainting it was the lag on close
  if (st.tasteDirty && st.tab === 'home' && !fromSheet) { st.tasteDirty = false; loadTab(true); }
}
