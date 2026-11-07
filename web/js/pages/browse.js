// Browse: immersive hero, tab row and big portrait cards. One persistent view; tabs change by hash.
import { api } from '../api.js';
import { store, quickPlay, toggleSave } from '../main.js';
import { esc, pad, posterOf, wl, icon, $, $$ } from '../ui.js';
import { openDossier, closeDossier } from '../dossier.js';
import { paletteOf, prefetch } from '../tint.js';
import { makeDropdown, closeDropdown } from '../dropdown.js';

// Movies and series share one tab each: the Movies / Series switch picks which list is shown
const TABS = [
  ['home', 'For You', '#/'], ['new', 'New'], ['trending_movies', 'Trending'], ['popular_movies', 'Popular'], ['toprated', 'Top rated'], ['gems', 'Hidden gems'], ['surprise', 'Surprise me'],
  ['watched_weekly', 'Most watched'], ['anticipated', 'Upcoming'], ['boxoffice', 'Box office'], ['continue', 'Continue watching', '#/continue'], ['shelf', 'Shelf', '#/shelf'],
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
const st = { tab: 'home', genre: '', items: [], more: false, busy: false, token: 0, kind: ls('kind', 'movie'), sort: ls('sort', 'default'), min: ls('min', 0), hideSeen: ls('hide', false), year: '', seed: Math.floor(Date.now() / 1800000) };
const feedMeta = (id) => feeds.find((f) => f.id === id) || {};
const typeOf = (it) => (it.type === 'tv' || it.type === 'series' ? 'series' : 'movie');
// the feed id to ask for, given the Movies / Series switch
const feedId = () => (isTrakt(st.tab) ? (st.kind === 'series' ? PAIR[base(st.tab)] || st.tab : base(st.tab)) : st.tab);

// Sort, filter and hide what has been watched. Done here so changing them is instant.
function shown(items) {
  const seen = new Set(store.history.map((h) => h.imdbId));
  let out = items.filter((i) => (!st.min || Number(i.rating) >= st.min) && (!st.hideSeen || !seen.has(i.imdbId)) && (!(st.tab === 'new' && st.genre) || (i.genres || []).includes(st.genre)));
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
    if (tv && pct >= 90) out.push({ imdbId: h.imdbId, type: 'series', title: h.title, poster: posterOf(h.imdbId), season: h.season, episode: h.episode + 1, tag: `Next · S${pad(h.season)}E${pad(h.episode + 1)}`, pct: 0 });
    else if (pct > 3 && pct < 90) out.push({ imdbId: h.imdbId, type: tv ? 'series' : 'movie', title: h.title, poster: posterOf(h.imdbId), season: h.season, episode: h.episode, tag: tv ? `S${pad(h.season)}E${pad(h.episode)}` : 'Resume', pct, left: leftLabel(h) });
  }
  return out.slice(0, max);
}

// ---------- Cards ----------
function card(it, i = 0) {
  const type = it.type === 'tv' ? 'series' : it.type;
  const sub = [it.year, (it.genres || []).slice(0, 1).join('')].filter(Boolean).join(' · ');
  const right = it.left || (it.rating ? '★ ' + it.rating : it.tag || '');
  return `<article class="bc" tabindex="0" style="--i:${Math.min(i, 24)}" data-id="${esc(it.imdbId)}" data-type="${esc(type)}" data-title="${esc(it.title)}" data-poster="${esc(posterOf(it.imdbId) || it.poster || posterOf(it.imdbId))}" ${it.season ? `data-season="${it.season}" data-episode="${it.episode}"` : ''}>
    <div class="bposter"><div class="bimg" style="background-image:url('${esc(posterOf(it.imdbId))}')${it.poster ? `,url('${esc(it.poster)}')` : ''}"></div>
      ${it.pct ? `<div class="bprog"><i style="width:${Math.min(100, Math.max(4, Math.round(it.pct)))}%"></i></div>` : ''}</div>
    <div class="binfo"><h3>${esc(it.title)}</h3><div class="bmeta"><span>${esc(it.tag && it.rating ? it.tag : sub)}</span>${right ? `<em>${esc(right)}</em>` : ''}</div>${it.overview ? `<p class="bdesc">${esc(it.overview)}</p>` : ''}</div></article>`;
}
const skeleton = (n = 8) => Array.from({ length: n }, () => '<div class="bc sk"></div>').join('');

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
async function tintFor(url, at) { const my = ++hoverToken; const pal = await paletteOf(url); if (my === hoverToken && !tintLock) applyTint(pal, at); }
function resetTint() { if (tintLock) return; hoverToken++; applyTint(baseTint, { x: 32, y: 30 }); }
function heroTint() { const h = $('.hero2', root); if (!h) { baseTint = null; return resetTint(); } paletteOf(h.dataset.poster || h.dataset.bg).then((p) => { baseTint = p; resetTint(); }); }
window.setTitleTint = (url, lock) => { tintLock = false; if (lock) { hoverToken++; paletteOf(url).then((p) => { applyTint(p, { x: 22, y: 46 }); tintLock = true; }); } else resetTint(); };

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
  }
  st.busy = true;
  let items = [], label = '', added = null;
  if (st.tab === 'continue') { items = continueItems(store.history); }
  else if (st.tab === 'shelf') { items = store.watchlist.map((w) => ({ ...w, tag: '' })); }
  else if (st.tab === 'home') {
    const fy = await api(`/api/catalog/foryou?seed=${st.seed}`).catch(() => []);
    if (my !== st.token) return;
    const cont = continueItems(store.history, 4), seen = new Set(cont.map((c) => c.imdbId));
    items = [...cont, ...fy.filter((m) => !seen.has(m.imdbId))];
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
  const grid = $('#grid', root); if (!grid.querySelector('.bc.tmp')) grid.insertAdjacentHTML('beforeend', Array.from({ length: 4 }, () => '<div class="bc sk tmp"></div>').join('')); // placeholders, only if it isn't ready yet
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
  const dual = t === 'home' ? false : isTrakt(t) || fm.cine, glist = fm.cine ? cineGenres : genres;
  const years = Array.from({ length: new Date().getFullYear() - 1949 }, (_, i) => String(new Date().getFullYear() - i));
  el.innerHTML = `<div class="tl">
    ${dual ? `<div class="seg2" role="group" aria-label="Type"><button data-kind="movie" class="${st.kind === 'movie' ? 'on' : ''}">Movies</button><button data-kind="series" class="${st.kind === 'series' ? 'on' : ''}">Series</button></div>` : ''}
    ${t !== 'home' && t !== 'boxoffice' && glist.length ? '<span id="gsel"></span>' : ''}
    ${t === 'new' ? '<span id="ysel"></span>' : ''}
    <span id="srt"></span>
    <span id="mnr"></span>
    <button class="chk ${st.hideSeen ? 'on' : ''}" id="hws" aria-pressed="${st.hideSeen}">${icon('check')} Hide watched</button>
    ${t === 'home' || fm.shuffle || t === 'gems' ? `<button class="chk shuf" id="shuf">${icon('bolt')} Shuffle</button>` : ''}
    <span class="cnt" id="count"></span></div>`;
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

function paintChrome() {
  closeDropdown();
  $('#tabs', root).innerHTML = TABS.map((t) => `<a href="${hrefOf(t)}" class="${t[0] === st.tab ? 'on' : ''}">${t[1]}${t[0] === 'shelf' && wl.size ? `<em>${wl.size}</em>` : ''}</a>`).join('') + '<i class="ind"></i>';
  requestAnimationFrame(() => moveInd());
  paintTools();
  tabsToActive();
  // recent rail
  const seen = new Set(), rec = [];
  for (const h of store.history) { if (!seen.has(h.imdbId)) { seen.add(h.imdbId); rec.push(h); } if (rec.length >= 7) break; }
  $('#rail', root).innerHTML = rec.map((h) => `<a class="rdot" href="#/title/${h.type === 'tv' ? 'series' : 'movie'}/${esc(h.imdbId)}" title="${esc(h.title)}" style="background-image:url('https://images.metahub.space/poster/small/${esc(h.imdbId)}/img')"></a>`).join('') + `<button class="rdot rplus" id="rSearch" aria-label="Search">${icon('plus')}</button>`;
  $('#rSearch', root).onclick = () => import('../palette.js').then((m) => m.openPalette());
}

// ---------- Public API ----------
export async function mount(el) {
  root = el;
  el.innerHTML = `<div class="amb"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="spot"></i></div>
    <div class="bwrap"><div id="hero"></div>
      <div class="tabrow"><nav id="tabs" class="tabs2" aria-label="Categories"></nav></div><div id="tools" class="tools"></div>
      <div id="grid" class="bgrid"></div><div id="more" class="more"></div></div>
    <aside id="rail" class="rail2" aria-label="Recently watched"></aside>`;
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
    if (e.target.closest('[data-hero-play]')) { const h = e.target.closest('.hero2'); quickPlay({ imdbId: h.dataset.id, type: h.dataset.type, title: h.dataset.title, ...(h.dataset.season ? { season: +h.dataset.season, episode: +h.dataset.episode } : {}) }); return; }
    const c = e.target.closest('.bc[data-id]'); if (!c) return;
    location.hash = `#/title/${c.dataset.type}/${c.dataset.id}`;
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const c = e.target.closest?.('.bc[data-id]'); if (c) location.hash = `#/title/${c.dataset.type}/${c.dataset.id}`; } });
  // hover a card: the light glides toward it and takes on its colours
  el.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const c = e.target.closest('.bc[data-poster]');
    clearTimeout(leaveTimer);
    if (c) { const r = c.getBoundingClientRect(); tintFor(c.dataset.poster, { x: Math.round(((r.left + r.width / 2) / innerWidth) * 100), y: Math.round(((r.top + r.height / 2) / innerHeight) * 100) }); }
    else if (e.target.closest('.hero2')) { const h = $('.hero2', el); tintFor(h.dataset.poster || h.dataset.bg, { x: 62, y: 30 }); }
    else leaveTimer = setTimeout(resetTint, 140);
  });
  el.addEventListener('pointerleave', () => { leaveTimer = setTimeout(resetTint, 140); });

  // cursor spotlight (smoothed) + card tilt + hero parallax
  let tx = innerWidth * 0.5, ty = innerHeight * 0.4, cx = tx, cy = ty, raf = 0;
  const loop = () => { cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12; window.__spot ? window.__spot(cx, cy) : (document.documentElement.style.setProperty('--mx', cx.toFixed(1) + 'px'), document.documentElement.style.setProperty('--my', cy.toFixed(1) + 'px')); raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.5 ? requestAnimationFrame(loop) : 0; };
  let tiltCard = null;
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || el.classList.contains('hidden')) return;
    tx = e.clientX; ty = e.clientY; if (!raf) raf = requestAnimationFrame(loop);
    const c = e.target.closest?.('.bc[data-id]');
    if (tiltCard && tiltCard !== c) { const p = tiltCard.querySelector('.bposter'); p?.style.setProperty('--rx', '0deg'); p?.style.setProperty('--ry', '0deg'); p?.style.setProperty('--ty', '0px'); tiltCard = null; }
    if (c && !c.classList.contains('sk')) {
      const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5, p = c.querySelector('.bposter');
      p.style.setProperty('--rx', (-py * 7).toFixed(2) + 'deg'); p.style.setProperty('--ry', (px * 9).toFixed(2) + 'deg'); p.style.setProperty('--ty', '-5px'); tiltCard = c;
    }
    const h = e.target.closest?.('.hero2');
    if (h) { const r = h.getBoundingClientRect(); h.style.setProperty('--px', (((e.clientX - r.left) / r.width) - 0.5).toFixed(3)); h.style.setProperty('--py', (((e.clientY - r.top) / r.height) - 0.5).toFixed(3)); }
  }, { passive: true });
  window.addEventListener('resize', () => { moveInd(); tabEdges(); });
  $('#tabs', root).addEventListener('scroll', tabEdges, { passive: true });
  window.addEventListener('scroll', () => { if (st.more && !st.busy) checkMore(); }, { passive: true });
  window.browseRefresh = () => { paintChrome(); if (['continue', 'shelf'].includes(st.tab)) loadTab(true); };
}

export function handle(kind, params = {}) {
  if (kind === 'away') return;
  if (kind === 'title') { if (!st.items.length && !st.busy) { st.tab = 'home'; paintChrome(); loadTab(true).then(() => heroTint()); } openDossier({ type: params.type, id: params.id }); return; }
  closeDossier();
  const tab = kind === 'feed' ? params.feed : kind === 'continue' ? 'continue' : kind === 'shelf' ? 'shelf' : 'home';
  if (kind === 'search') { import('../palette.js').then((m) => m.openPalette(params.q || '')); }
  if (tab !== st.tab || !st.items.length || kind === 'home' && !$('.hero2', root)) { st.tab = isTrakt(tab) ? base(tab) : tab; if (isTrakt(tab)) st.kind = tab.endsWith('shows') ? 'series' : st.kind; st.genre = ''; st.year = ''; window.scrollTo({ top: 0, behavior: 'instant' }); paintChrome(); loadTab(true).then(() => heroTint()); }
  else paintChrome();
}
