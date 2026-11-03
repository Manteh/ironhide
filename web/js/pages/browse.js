// Browse: immersive hero, tab row and big portrait cards. One persistent view; tabs change by hash.
import { api } from '../api.js';
import { store, quickPlay, toggleSave } from '../main.js';
import { esc, pad, posterOf, wl, icon, $, $$ } from '../ui.js';
import { openDossier, closeDossier } from '../dossier.js';

const TABS = [
  ['home', 'For You', '#/'], ['trending_movies', 'Movies'], ['trending_shows', 'Series'], ['popular_movies', 'Popular'], ['popular_shows', 'TV Hits'],
  ['watched_weekly', 'Most watched'], ['anticipated', 'Upcoming'], ['boxoffice', 'Box office'], ['continue', 'Continue watching', '#/continue'], ['shelf', 'Shelf', '#/shelf'],
];
const hrefOf = ([id, , h]) => h || `#/feed/${id}`;
const FEED_NAME = { trending_movies: 'Trending', trending_shows: 'Trending series', popular_movies: 'Popular', popular_shows: 'TV hit', watched_weekly: 'Most watched', anticipated: 'Upcoming', boxoffice: 'Box office' };

let root, feeds = [], genres = [];
const st = { tab: 'home', genre: '', items: [], more: false, busy: false, token: 0 };

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
  return `<article class="bc" tabindex="0" style="--i:${Math.min(i, 24)}" data-id="${esc(it.imdbId)}" data-type="${esc(type)}" data-title="${esc(it.title)}" data-poster="${esc(it.poster || posterOf(it.imdbId))}" ${it.season ? `data-season="${it.season}" data-episode="${it.episode}"` : ''}>
    <div class="bposter"><div class="bimg" style="background-image:url('${esc(it.poster || posterOf(it.imdbId))}')"></div>
      ${it.pct ? `<div class="bprog"><i style="width:${Math.min(100, Math.max(4, Math.round(it.pct)))}%"></i></div>` : ''}</div>
    <div class="binfo"><h3>${esc(it.title)}</h3><div class="bmeta"><span>${esc(it.tag && it.rating ? it.tag : sub)}</span>${right ? `<em>${esc(right)}</em>` : ''}</div></div></article>`;
}
const skeleton = (n = 8) => Array.from({ length: n }, () => '<div class="bc sk"></div>').join('');

// ---------- Ambient backdrop follows what you point at ----------
let ambA, ambB, ambFront = 0;
function ambient(url) {
  const [show, hide] = ambFront ? [ambA, ambB] : [ambB, ambA]; ambFront ^= 1;
  if (!url) { ambA.style.opacity = ambB.style.opacity = 0; return; }
  show.style.backgroundImage = `url('${url}')`; show.style.opacity = 1; hide.style.opacity = 0;
}

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
  if (reset) { st.items = []; grid.innerHTML = skeleton(8); hero.innerHTML = ''; more.innerHTML = ''; }
  st.busy = true;
  let items = [], label = '';
  if (st.tab === 'continue') { items = continueItems(store.history); }
  else if (st.tab === 'shelf') { items = store.watchlist.map((w) => ({ ...w, tag: '' })); }
  else if (st.tab === 'home') {
    const ids = ['trending_movies', 'trending_shows', 'popular_movies', 'watched_weekly', 'popular_shows', 'anticipated'];
    const lists = await Promise.all(ids.map((id) => api(`/api/catalog/feed/${id}`).catch(() => [])));
    if (my !== st.token) return;
    const cont = continueItems(store.history, 4);
    const mixed = [];
    for (let n = 0; n < 8; n++) lists.forEach((l, k) => { if (l[n]) mixed.push({ ...l[n], label: FEED_NAME[ids[k]] }); });
    const seen = new Set(cont.map((c) => c.imdbId));
    items = [...cont, ...mixed.filter((m) => !seen.has(m.imdbId) && (seen.add(m.imdbId), true))].slice(0, 36);
    hero.innerHTML = await renderHero(lists[0].length ? lists[0] : mixed);
    if (my !== st.token) return;
  } else {
    const qs = new URLSearchParams(); if (st.genre) qs.set('genre', st.genre); if (!reset && st.items.length) qs.set('skip', st.items.length);
    const got = await api(`/api/catalog/feed/${st.tab}?${qs}`).catch(() => []);
    if (my !== st.token) return;
    const seen = new Set(st.items.map((i) => i.imdbId)); const fresh = got.filter((i) => !seen.has(i.imdbId));
    items = [...st.items, ...fresh.map((f) => ({ ...f, label: FEED_NAME[st.tab] }))];
    st.more = fresh.length >= 10 && st.tab !== 'boxoffice';
  }
  if (my !== st.token) return;
  st.items = items; st.busy = false;
  grid.innerHTML = items.length ? items.map(card).join('') : `<div class="empty">${st.tab === 'shelf' ? 'Your shelf is empty. Open a title and tap Save.' : st.tab === 'continue' ? 'Nothing in progress yet.' : 'Nothing here right now.'}</div>`;
  more.innerHTML = st.more ? '<button class="btn" id="loadMore">Load more</button>' : '';
  $('#loadMore', root)?.addEventListener('click', () => loadTab(false));
}

function paintChrome() {
  $('#tabs', root).innerHTML = TABS.map((t) => `<a href="${hrefOf(t)}" class="${t[0] === st.tab ? 'on' : ''}">${t[1]}${t[0] === 'shelf' && wl.size ? `<em>${wl.size}</em>` : ''}</a>`).join('');
  const isFeed = !['home', 'continue', 'shelf', 'boxoffice'].includes(st.tab);
  $('#tools', root).innerHTML = isFeed ? `<select id="gsel" class="sel" aria-label="Genre"><option value="">All genres</option>${genres.map((g) => `<option ${g === st.genre ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>` : '';
  $('#gsel', root)?.addEventListener('change', (e) => { st.genre = e.target.value; loadTab(true); });
  $('.on', $('#tabs', root))?.scrollIntoView({ inline: 'center', block: 'nearest' });
  // recent rail
  const seen = new Set(), rec = [];
  for (const h of store.history) { if (!seen.has(h.imdbId)) { seen.add(h.imdbId); rec.push(h); } if (rec.length >= 7) break; }
  $('#rail', root).innerHTML = rec.map((h) => `<a class="rdot" href="#/title/${h.type === 'tv' ? 'series' : 'movie'}/${esc(h.imdbId)}" title="${esc(h.title)}" style="background-image:url('https://images.metahub.space/poster/small/${esc(h.imdbId)}/img')"></a>`).join('') + `<button class="rdot rplus" id="rSearch" aria-label="Search">${icon('plus')}</button>`;
  $('#rSearch', root).onclick = () => import('../palette.js').then((m) => m.openPalette());
}

// ---------- Public API ----------
export async function mount(el) {
  root = el;
  el.innerHTML = `<div class="amb"><i id="ambA"></i><i id="ambB"></i></div>
    <div class="bwrap"><div id="hero"></div>
      <div class="tabrow"><nav id="tabs" class="tabs2" aria-label="Categories"></nav><div id="tools" class="tools"></div></div>
      <div id="grid" class="bgrid"></div><div id="more" class="more"></div></div>
    <aside id="rail" class="rail2" aria-label="Recently watched"></aside>`;
  ambA = $('#ambA'); ambB = $('#ambB');
  const meta = await api('/api/catalog/feeds').catch(() => ({ feeds: [], genres: [] }));
  feeds = meta.feeds; genres = meta.genres;

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
  el.addEventListener('pointerover', (e) => { const c = e.target.closest('.bc[data-poster]'); if (c) ambient(c.dataset.poster); else if (e.target.closest('.hero2')) ambient($('.hero2', el)?.dataset.bg); });
  el.addEventListener('pointerleave', () => ambient($('.hero2', el)?.dataset.bg || ''));
  window.browseRefresh = () => { paintChrome(); if (['continue', 'shelf'].includes(st.tab)) loadTab(true); };
}

export function handle(kind, params = {}) {
  if (kind === 'away') return;
  if (kind === 'title') { if (!st.items.length && !st.busy) { st.tab = 'home'; paintChrome(); loadTab(true).then(() => ambient($('.hero2', root)?.dataset.bg || '')); } openDossier({ type: params.type, id: params.id }); return; }
  closeDossier();
  const tab = kind === 'feed' ? params.feed : kind === 'continue' ? 'continue' : kind === 'shelf' ? 'shelf' : 'home';
  if (kind === 'search') { import('../palette.js').then((m) => m.openPalette(params.q || '')); }
  if (tab !== st.tab || !st.items.length || kind === 'home' && !$('.hero2', root)) { st.tab = tab; st.genre = ''; window.scrollTo({ top: 0, behavior: 'instant' }); paintChrome(); loadTab(true).then(() => ambient($('.hero2', root)?.dataset.bg || '')); }
  else paintChrome();
}
