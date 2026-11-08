// Dossier: the detail sheet for one title. One scroller: a cinematic header (backdrop, scores, actions), then the things you
// came for in order of use: episodes (series), versions (sticky on the right, always one click from playing), about, cast,
// reviews and more like this. Versions start loading the moment the sheet opens, in parallel with the title details.
import { api, post } from './api.js';
import { store, quickPlay, toggleSave } from './main.js';
import { $, $$, esc, icon, pad, posterOf, toast, wl } from './ui.js';
import { social, sapi } from './social.js';
import { heroIn, heroFill, watchSections, versionsIn, personIn, chain } from './reveal.js';

const TIERS = [['2160p', '4K'], ['1080p', '1080p'], ['720p', '720p'], ['480p', '480p'], ['', 'Other']];
const tierLabel = (r) => (TIERS.find(([k]) => k === (r || ''))?.[1] || 'Other');
const SORTS = [['best', 'Best first'], ['size', 'Largest'], ['small', 'Smallest'], ['seeds', 'Most seeders']];
const PREF_NAME = { auto: 'highest quality', '2160p': '4K', '1080p': '1080p', '720p': '720p' };
let el, scrim, token = 0;
const dismiss = () => { location.hash = store.lastBrowse || '#/'; };

// small caches so reopening a title (or going back from a similar one) is instant
const metaCache = new Map(), infoCache = new Map();
const metaDone = new Map(); // already-arrived details, readable without waiting
const getMeta = (type, id) => { const k = `${type}:${id}`; if (!metaCache.has(k)) metaCache.set(k, api(`/api/title/${id}?type=${type}`).then((m) => { metaDone.set(k, m); return m; }).catch((e) => { metaCache.delete(k); throw e; })); return metaCache.get(k); };
const getInfo = (id) => { if (!infoCache.has(id)) infoCache.set(id, api(`/api/info/${id}`).catch(() => ({ error: 'offline' }))); return infoCache.get(id); };
// no client cache for versions: the server keeps the list that "play #n" refers to, so it must be the one shown
const getStreams = (qs) => api('/api/streams?' + qs);
// warm the details while the pointer rests on a card, so the sheet opens with everything already there
export function prefetchTitle(type, id, light = false) {
  if (!/^tt\d+$/.test(id || '')) return;
  if (light) { getMeta(type, id).catch(() => {}); return; }
  getMeta(type, id).then((m) => { if (m?.background) { const im = new Image(); im.decoding = 'async'; im.src = m.background; } }).catch(() => {});
  getInfo(id);
}

// ---------- people ----------
const personCache = new Map();
function personData(pid) { if (!personCache.has(pid)) personCache.set(pid, api(`/api/person/${pid}`).catch((e) => { personCache.delete(pid); return { error: e.message }; })); return personCache.get(pid); }
const fmtD = (d) => { if (!d) return ''; const t = new Date(d + 'T00:00:00'); return isNaN(t) ? d : t.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }); };
const personShell = (back) => `<header class="pv-top"><button class="btn ghost vx-back" data-pback>${icon('back')} ${esc(back)}</button></header>
  <div class="pv-scroll"><div class="pv-body"><div class="pv-hero"><div class="pv-photo sk"></div><div class="pv-id"><i class="skl"></i><i class="skl s"></i><div class="dx-sk" style="margin-top:22px"><i></i><i></i><i></i><i class="s"></i></div></div></div></div></div>`;
function personHTML(p, back) {
  const dept = { Acting: p.gender === 'female' ? 'Actress' : 'Actor', Directing: 'Director', Writing: 'Writer', Production: 'Producer' }[p.department] || p.department;
  const facts = [
    p.birthday && ['Born', `${fmtD(p.birthday)}${!p.deathday && p.age ? ` (age ${p.age})` : ''}`],
    p.deathday && ['Died', `${fmtD(p.deathday)} (aged ${p.age})`],
    p.place && ['Birthplace', p.place],
    p.stats.first && ['Career', `${p.stats.first}–${p.deathday ? p.stats.last : 'now'}`],
    p.aka?.length && ['Also known as', p.aka.join(', ')],
  ].filter(Boolean);
  const kf = p.knownFor || [];
  return `<header class="pv-top"><button class="btn ghost vx-back" data-pback>${icon('back')} ${esc(back)}</button></header>
  <div class="pv-scroll"><div class="pv-body">
    <div class="pv-hero">
      <div class="pv-photo">${p.photo ? `<img src="${esc(p.photo)}" alt="" decoding="async" onload="this.classList.add('ld')">` : `<span>${esc((p.name || '?')[0])}</span>`}</div>
      <div class="pv-id">
        <div class="dx-kick"><span>${esc(dept || 'Person')}</span></div>
        <h2>${esc(p.name)}</h2>
        <div class="pv-stats">
          <div><b>${p.stats.credits}</b><small>credits</small></div><div><b>${p.stats.movies}</b><small>films</small></div><div><b>${p.stats.shows}</b><small>series</small></div>
          ${p.stats.first ? `<div><b>${(p.deathday ? p.stats.last : new Date().getFullYear()) - p.stats.first}</b><small>years active</small></div>` : ''}
        </div>
        <dl class="pv-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        ${p.links?.length ? `<div class="pv-links">${p.links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(l)} ${icon('ext')}</a>`).join('')}</div>` : ''}
      </div>
    </div>
    ${p.bio ? `<section class="dx-sec"><h3 class="dx-h">Biography</h3><p class="pv-bio">${esc(p.bio)}</p><button class="pv-more">Read full biography</button></section>` : ''}
    ${kf.length ? `<section class="dx-sec"><div class="dx-sh"><h3 class="dx-h">Known for</h3></div><div class="dx-row">${kf.map((c) => `
      <a class="dx-sim" href="#" data-tid="${c.tmdbId}" data-kind="${c.kind}"><i><img src="${esc(c.poster)}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ld')"></i>
        <b>${esc(c.title)}</b><small>${esc([c.year, c.role].filter(Boolean).join(' · '))}</small></a>`).join('')}</div></section>` : ''}
    ${p.photos?.length > 1 ? `<section class="dx-sec"><div class="dx-sh"><h3 class="dx-h">Photos</h3><span class="dx-count">${p.photos.length}</span></div><div class="dx-row pv-photos">${p.photos.map((u) => `<i><img src="${esc(u)}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ld')"></i>`).join('')}</div></section>` : ''}
    <section class="dx-sec"><div class="dx-sh"><h3 class="dx-h">Filmography</h3>
      <div class="pv-tabs">${p.crew?.length ? `<div class="seg"><button data-ptab="acting" class="on">Acting <em>${p.acting.length}</em></button><button data-ptab="crew">Behind the camera <em>${p.crew.length}</em></button></div>` : ''}
        <div class="seg"><button data-pkind="all" class="on">All</button><button data-pkind="movie">Films</button><button data-pkind="tv">Series</button></div></div></div>
      <div class="pv-list" id="pvList">${filmography(p, { tab: 'acting', kind: 'all' })}</div></section>
  </div></div>`;
}
function filmography(p, st) {
  const list = (st.tab === 'crew' ? p.crew : p.acting).filter((c) => st.kind === 'all' || c.kind === st.kind);
  if (!list.length) return '<p class="dx-hint">Nothing here.</p>';
  let last = null;
  return list.map((c) => {
    const y = c.year || 'Upcoming', head = y !== last ? `<div class="pv-year">${esc(y)}</div>` : ''; last = y;
    return `${head}<a class="pv-row" href="#" data-tid="${c.tmdbId}" data-kind="${c.kind}">
      <i>${c.poster ? `<img src="${esc(c.poster)}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ld')">` : ''}</i>
      <span class="pv-t"><b>${esc(c.title)}</b><small>${esc([c.role && (st.tab === 'crew' ? c.role : `as ${c.role}`), c.kind === 'tv' && c.episodes ? `${c.episodes} episode${c.episodes > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · '))}</small></span>
      <span class="pv-k">${c.kind === 'tv' ? 'Series' : 'Film'}</span>
      ${c.rating ? `<span class="pv-r">${icon('star')} ${esc(c.rating)}</span>` : '<span class="pv-r"></span>'}</a>`;
  }).join('');
}

function root() {
  if (el) return el;
  scrim = document.createElement('div');
  scrim.className = 'dscrim'; scrim.addEventListener('pointerdown', dismiss);
  document.body.appendChild(scrim);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !el?.classList.contains('open')) return;
    if (document.querySelector('.wp, .pal, .nowv, .launch')) return; // those handle Esc themselves
    e.preventDefault();
    if (el.classList.contains('pmode')) el._pback?.(); else if (el.classList.contains('vmode')) el._back?.(); else dismiss();
  });
  el = document.createElement('aside');
  el.className = 'dossier dx'; el.setAttribute('aria-label', 'Title details');
  document.body.appendChild(el);
  return el;
}

export function closeDossier() { token++; if (el?.classList.contains('open')) window.setTitleTint?.(null, false); el?.classList.remove('open'); scrim?.classList.remove('on'); }

const fmtDate = (d) => { if (!d) return ''; const t = new Date(d + 'T00:00:00'); return isNaN(t) ? d : t.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); };
const money = (n) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : '');
const SCORE_ICON = { imdb: 'IMDb', tmdb: 'TMDB', rt: '🍅', mc: 'MC', rev: '✎' };

// Skeleton shown instantly, before anything has loaded: same shape as the real sheet so nothing jumps.
// What the sheet shows the instant a card is clicked: the same header layout as the finished sheet, filled from what the card
// already knows (poster, title, year, rating), with a working Play button. When the details arrive the rest fills in
// around it without restarting the animation.
const shell = (type, id, g = {}) => `<button class="dclose" aria-label="Close">${icon('x')}</button>
  <div class="dx-scroll" id="dScroll"><header class="dx-hero">
    <div class="dx-bgw"></div>
    <div class="dx-head"><div class="dx-poster">${g.poster || posterOf(id) ? `<img src="${esc(g.poster || posterOf(id))}" alt="" decoding="async">` : ''}</div>
      <div class="dx-title">
        <div class="dx-kick"><span>${type === 'series' ? 'Series' : 'Film'}</span></div>
        <h2>${esc(g.title || '')}</h2>
        <div class="dx-facts">${[g.year, g.rating && '★ ' + g.rating].filter(Boolean).map((f) => `<span>${esc(f)}</span>`).join('')}</div>
        <div class="dx-scores"></div>
        <p class="dx-over dx-wait"><i class="skl"></i><i class="skl s"></i></p>
        <div class="dx-acts">
          <button class="btn primary dx-play" id="dPlayShell">${icon('play')} Play</button>
          <button class="btn dx-sec2" disabled>${icon('sliders')} Versions</button>
          <button class="btn dx-sec2" disabled>${icon('bookmark')} Save</button>
        </div>
        <div class="dx-status"></div>
      </div></div>
  </header><div class="dx-main"><div class="dx-a"><div class="dx-sk" style="margin-top:24px"><i></i><i></i><i class="s"></i></div></div></div></div>`;

export async function openDossier({ type, id }) {
  const my = ++token, box = root();
  // already open (a similar title, back/forward): fade the old content out briefly instead of swapping it in one frame
  if (box.classList.contains('open') && box.querySelector('.dx-scroll')) {
    box.classList.add('swap'); await new Promise((r) => setTimeout(r, 140));
    if (my !== token) return;
  }
  const wasOpen = box.classList.contains('open');
  const guessEl = document.querySelector(`.bc[data-id="${CSS.escape(id)}"]`);
  // grow out of the card that was clicked
  if (!wasOpen && guessEl) {
    const r = guessEl.getBoundingClientRect(), w = box.offsetWidth, h = box.offsetHeight;
    const ox = r.left + r.width / 2 - (innerWidth - w) / 2, oy = r.top + r.height / 2 - (innerHeight - h) / 2;
    box.style.setProperty('--ox', `${Math.round(ox)}px`); box.style.setProperty('--oy', `${Math.round(oy)}px`);
  } else if (!wasOpen) { box.style.removeProperty('--ox'); box.style.removeProperty('--oy'); }
  // start everything at once: title, details and (for films) the versions
  const metaP = getMeta(type, id), infoP = getInfo(id);
  post('/api/rec/opened', { imdbId: id }).catch(() => {}); // the picks learn what you open
  // preloaded (hovered card): paint the finished sheet before it animates in; otherwise open at once with a placeholder
  const quick = metaDone.get(`${type}:${id}`) || null; // no waiting: either it's here already, or the instant sheet opens now
  let shellShown = false;
  if (!quick) {
    const g = guessEl?.dataset || {};
    box.innerHTML = shell(type, id, { title: g.title, poster: g.poster, year: g.year, rating: g.rating });
    $('.dclose', box).onclick = dismiss;
    $('#dPlayShell', box).onclick = () => quickPlay({ imdbId: id, type, title: g.title || '', poster: g.poster });
    shellShown = true;
  }
  box.classList.remove('vmode', 'pmode');
  void box.offsetWidth; // commit the closed state so the transition always runs, without waiting for a frame callback
  box.classList.add('open'); scrim.classList.add('on'); box.classList.remove('swap');
  const openedAt = performance.now();
  if (shellShown) heroIn(box, 0);
  window.setTitleTint?.(guessEl?.dataset.poster || posterOf(id), true);

  let nameForStreams = guessEl?.dataset.title || '';
  const qsFor = (s, e) => { const q = new URLSearchParams({ imdbId: id, type, title: nameForStreams }); if (type === 'series') { q.set('season', s); q.set('episode', e); } return q; };
  let earlyStreams = null;
  if (type === 'movie') earlyStreams = getStreams(qsFor()); // title isn't needed for films' stream lookup beyond display
  let meta;
  try { meta = await metaP; } catch (e) { $('.dx-a', box).innerHTML = `<div class="note">${esc(e.message)}</div>`; return; }
  if (my !== token) return;
  nameForStreams = meta.title || nameForStreams;
  if (meta.background) { const im = new Image(); im.decoding = 'async'; im.src = meta.background; }
  const history = store.history;
  const st = { season: null, episode: null, streams: null, loading: false, tier: null, sort: 'best', more: false, req: 0, info: null };
  const watched = (s, e) => history.find((h) => h.imdbId === id && h.season === s && h.episode === e);
  const seasons = Object.keys(meta.seasons || {}).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
  if (type === 'series') {
    const last = history.find((h) => h.imdbId === id && h.season);
    st.season = last ? last.season : seasons[0];
    st.episode = last ? ((last.percent || 0) >= 90 ? last.episode + 1 : last.episode) : null;
    if (st.episode && !(meta.seasons[st.season] || []).some((x) => x.episode === st.episode)) { st.season = Math.min(st.season + 1, seasons.at(-1)); st.episode = 1; }
    if (!st.episode) st.episode = (meta.seasons[st.season] || [])[0]?.episode || 1;
    earlyStreams = getStreams(qsFor(st.season, st.episode));
  }
  const item = { imdbId: id, type, title: meta.title, year: meta.year, poster: meta.poster, rating: meta.rating };
  const resumeH = type === 'movie' ? history.find((h) => h.imdbId === id && (h.percent || 0) > 3 && (h.percent || 0) < 90) : null;
  const today = new Date().toISOString().slice(0, 10);

  // ----- labels -----
  const epTag = () => (type === 'series' && st.episode ? `S${pad(st.season)}E${pad(st.episode)}` : '');
  const epObj = () => (meta.seasons?.[st.season] || []).find((e) => e.episode === st.episode);
  const playLabel = () => (type === 'series' ? `Play ${epTag()}` : resumeH ? 'Resume' : 'Play');
  const vSub = () => (type === 'series' ? `${epTag()}${epObj()?.name ? ' · ' + epObj().name : ''}` : [meta.year, meta.runtime].filter(Boolean).join(' · '));
  const setPlay = () => { const b = $('#dPlay', box); if (b) b.innerHTML = `${icon('play')} ${playLabel()}`; const t = $('#dVSub', box); if (t) t.textContent = vSub(); };
  // Play opens the versions view: it slides over the details inside the same sheet
  function openVersions() {
    setPlay(); box.classList.add('vmode'); $('#dVers', box)?.removeAttribute('aria-hidden');
    if (st.dirty || !$('#dList .vx-l', box)) { st.dirty = false; renderStreams(); }
    if ($('#dList .rec:not(.sk)', box)) versionsIn(box); else st.animIn = true; // still loading: animate when it arrives
    if (!st.streams && !st.loading) loadStreams();
    const v = $('#dVersScroll', box); if (v) v.scrollTop = 0;
    setTimeout(() => $('#dVers [data-p]', box)?.focus({ preventScroll: true }), 380);
  }
  function closeVersions() { box.classList.remove('vmode'); $('#dVers', box)?.setAttribute('aria-hidden', 'true'); $('#dPlay', box)?.focus({ preventScroll: true }); }
  box._back = closeVersions;
  const saveLabel = () => `${icon(wl.has(id) ? 'check' : 'bookmark')} ${wl.has(id) ? 'On your shelf' : 'Save'}`;
  const playEp = (s, e) => quickPlay({ ...item, ...(type === 'series' ? { season: s, episode: e } : {}) });

  // ----- episodes -----
  const epsHTML = () => (meta.seasons?.[st.season] || []).map((e) => {
    const w = watched(st.season, e.episode), pct = Math.round(w?.percent || 0), done = pct >= 90, soon = e.released && e.released > today;
    return `<div class="dx-ep ${e.episode === st.episode ? 'on' : ''} ${soon ? 'soon' : ''}" data-e="${e.episode}" role="button" tabindex="0">
      <div class="dx-th">${e.thumbnail ? `<img src="${esc(e.thumbnail)}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ld')">` : ''}
        ${soon ? '' : `<button class="dx-thp" data-pe="${e.episode}" aria-label="Play episode ${e.episode}">${icon('play')}</button>`}
        ${w && !done ? `<i class="dx-prog"><u style="width:${Math.max(4, pct)}%"></u></i>` : ''}${done ? `<span class="dx-done">${icon('check')}</span>` : ''}</div>
      <div class="dx-et"><b><span>${e.episode}.</span> ${esc(e.name || `Episode ${e.episode}`)}</b>
        <small>${soon ? `Out ${fmtDate(e.released)}` : fmtDate(e.released)}${w && !done ? ` · ${pct}% watched` : ''}</small>
        ${e.overview ? `<p>${esc(e.overview)}</p>` : ''}</div></div>`;
  }).join('');
  function bindEps() {
    $$('.dx-ep[data-e]', box).forEach((b) => {
      const pick = () => { if (b.classList.contains('soon')) return; st.episode = +b.dataset.e; $$('.dx-ep', box).forEach((x) => x.classList.toggle('on', x === b)); setPlay(); loadStreams(); };
      b.onclick = (ev) => { if (ev.target.closest('[data-pe]')) return; pick(); };
      b.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); } };
    });
    $$('[data-pe]', box).forEach((b) => (b.onclick = (ev) => {
      ev.stopPropagation(); const n = +b.dataset.pe;
      if (n !== st.episode) { st.episode = n; $$('.dx-ep', box).forEach((x) => x.classList.toggle('on', +x.dataset.e === n)); setPlay(); loadStreams(); }
      quickPlay({ ...item, season: st.season, episode: n });
    }));
    const on = $('.dx-ep.on', box), list = $('#dEps', box);
    if (on && list) list.scrollTop = Math.max(0, on.offsetTop - list.offsetTop - 12);
  }

  // ----- scores -----
  function scoresHTML() {
    const list = [...(st.info?.scores || [])];
    if (meta.rating && !list.some((s) => s.src === 'imdb')) list.unshift({ src: 'imdb', label: 'IMDb', value: meta.rating, max: '10' });
    return list.map((s) => `<div class="dx-score s-${s.src}" title="${esc(s.label)}${s.votes ? ' · ' + esc(s.votes) + (/\d$/.test(s.votes) ? ' votes' : '') : ''}${s.note ? ' · ' + esc(s.note) : ''}">
      <span class="dx-sl">${SCORE_ICON[s.src] || esc(s.label)}</span><b>${esc(s.value)}</b>${s.max ? `<small>/${esc(s.max)}</small>` : ''}${s.votes ? `<em>${esc(s.votes)}${/\d$/.test(s.votes) ? ' votes' : ''}</em>` : `<em>${esc(s.label)}</em>`}</div>`).join('');
  }

  // ----- the sheet -----
  function draw() {
    const q = encodeURIComponent(`${meta.title} ${meta.year}`);
    const kick = type === 'series' ? 'Series' : 'Film';
    const mins = parseInt(meta.runtime, 10);
    const rt = mins > 59 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : meta.runtime;
    const facts = [meta.year, rt, ...(meta.genres || []).slice(0, 3)].filter(Boolean);
    const left = resumeH && resumeH.duration ? Math.max(0, Math.round((resumeH.duration - (resumeH.position || 0)) / 60)) : 0;
    const canTogether = social.state?.relay?.status === 'online' && (!social.state.room || (social.state.room.host === social.state.you?.id || social.state.room.owner === social.state.you?.id));
    box.innerHTML = `<button class="dclose" aria-label="Close">${icon('x')}</button>
    <div class="dx-scroll" id="dScroll">
      <header class="dx-hero">
        <div class="dx-bgw">${meta.background ? `<img class="dx-bg" src="${esc(meta.background)}" alt="" decoding="async" onload="this.classList.add('ld')">` : ''}</div>
        <div class="dx-head">
          <div class="dx-poster"><img src="${esc(meta.poster || posterOf(id))}" alt="" decoding="async"></div>
          <div class="dx-title">
            <div class="dx-kick" id="dKick"><span>${esc(kick)}</span></div>
            <h2>${esc(meta.title)}</h2>
            <div class="dx-facts" id="dFacts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>
            <div class="dx-scores" id="dScores">${scoresHTML()}</div>
            <p class="dx-over" id="dOver">${esc(meta.overview || '')}</p>
            <div class="dx-acts">
              <button class="btn primary dx-play" id="dPlay">${icon('play')} ${playLabel()}</button>
              <button class="btn dx-sec2" id="dVBtn">${icon('sliders')} Versions</button>
              <button class="btn dx-sec2" id="dSave">${saveLabel()}</button>
              <span class="dx-round">
                ${meta.trailers?.length ? `<button class="dx-ib" id="dTrailer" data-tip="Trailer" aria-label="Trailer">${icon('trailer')}</button>` : `<a class="dx-ib" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${q}+trailer" data-tip="Trailer" aria-label="Trailer">${icon('trailer')}</a>`}
                ${canTogether ? `<button class="dx-ib" id="dTogether" data-tip="Watch together" aria-label="Watch together">${icon('users')}</button>` : ''}
                <a class="dx-ib dx-imdb" target="_blank" rel="noopener" href="https://www.imdb.com/title/${esc(id)}/" data-tip="Open on IMDb" aria-label="Open on IMDb">IMDb</a>
              </span>
            </div>
            <div class="dx-rate" id="dRate"></div>
            <div class="dx-status">
              <div class="dx-best wait" id="dBest"></div>
              ${resumeH ? `<div class="dx-resume"><i><u style="width:${Math.round(resumeH.percent)}%"></u></i><span>${left ? `${left >= 60 ? `${Math.floor(left / 60)}h ${String(left % 60).padStart(2, '0')}m` : `${left}m`} left` : `${Math.round(resumeH.percent)}% watched`}</span></div>` : ''}
            </div>
          </div>
        </div>
      </header>
      <div class="dx-main ${type === 'series' ? 'is-series' : 'is-movie'}">
        <div class="dx-a">
          ${type === 'series' ? `<section class="dx-sec" id="dEpSec">
            <div class="dx-sh"><h3 class="dx-h">Episodes</h3>
              <div class="seg dx-seasons">${seasons.map((n) => `<button data-s="${n}" class="${n === st.season ? 'on' : ''}">${seasons.length > 6 ? n : 'Season ' + n}</button>`).join('')}</div></div>
            <div class="dx-eps" id="dEps">${epsHTML()}</div></section>` : ''}
        </div>
        <section class="dx-sec dx-about" id="dAbout"></section>
        <div class="dx-b" id="dMore"></div>
      </div>
    </div>
    <section class="dx-pv" id="dPerson" aria-hidden="true" aria-label="Person"></section>
    <section class="dx-vers" id="dVers" aria-hidden="true" aria-label="Choose a version">
      <div class="vx-bg">${meta.background ? `<img src="${esc(meta.background)}" alt="" decoding="async" loading="lazy">` : ''}</div>
      <header class="vx-top">
        <button class="btn ghost vx-back" id="dBack">${icon('back')} Details</button>
        <div class="vx-who"><img src="${esc(meta.poster || posterOf(id))}" alt="" decoding="async"><div><small>Choose a version</small><b>${esc(meta.title)}</b><span id="dVSub">${esc(vSub())}</span></div></div>
      </header>
      <div class="vx-scroll" id="dVersScroll"><div id="dList"></div></div>
    </section>`;
    $('.dclose', box).onclick = dismiss;
    $('#dPlay', box).onclick = playNow;
    $('#dVBtn', box).onclick = openVersions;
    $('#dOver', box).onclick = (e) => e.currentTarget.classList.contains('long') && e.currentTarget.classList.toggle('open');
    $('#dBack', box).onclick = closeVersions;
    $('#dTrailer', box)?.addEventListener('click', async () => {
      const { openTrailer } = await import('./trailer.js');
      openTrailer({ ids: meta.trailers, title: meta.title, year: meta.year, onPlay: () => playNow() });
    });
    $('#dTogether', box)?.addEventListener('click', async () => {
      const media = { imdbId: id, type, title: meta.title, year: meta.year, poster: meta.poster, ...(type === 'series' ? { season: st.season || 1, episode: st.episode || 1 } : {}) };
      try {
        if (!social.state.room) { await sapi('/room', { name: `${meta.title} night` }); for (let i = 0; i < 25 && !social.state.room; i++) await new Promise((r) => setTimeout(r, 150)); }
        await sapi('/room/media', { media }); toast('Sent to your room', 'ok'); location.hash = '#/friends';
      } catch (e) { toast(e.message, 'err'); }
    });
    $('#dSave', box).onclick = async () => { await toggleSave({ ...item }); $('#dSave', box).innerHTML = saveLabel(); };
    $$('[data-s]', box).forEach((b) => (b.onclick = () => {
      st.season = +b.dataset.s;
      const eps = meta.seasons[st.season] || [];
      st.episode = (eps.find((e) => !e.released || e.released <= today) || eps[0])?.episode || 1;
      $$('[data-s]', box).forEach((x) => x.classList.toggle('on', x === b));
      $('#dEps', box).innerHTML = epsHTML(); bindEps(); setPlay(); loadStreams();
      chain($$('#dEps .dx-ep', box), { step: 32, max: 8, y: 12, dur: 460 });
    }));
    bindEps(); renderStreams(); renderInfo(); renderRate();
    if (shellShown) heroFill(box); else heroIn(box, 0);
    st.rescan = watchSections($('#dScroll', box), box);
  }

  // ----- about, cast, reviews, more like this (filled in when the details arrive) -----
  function renderInfo() {
    const inf = st.info, about = $('#dAbout', box), more = $('#dMore', box);
    if (!about || !more) return;
    if (!inf) { // placeholders with the final shape
      about.innerHTML = `<h3 class="dx-h">About</h3><div class="dx-sk"><i></i><i></i><i class="s"></i></div>`;
      more.innerHTML = `<section class="dx-sec"><h3 class="dx-h">Cast</h3><div class="dx-row">${'<div class="dx-person sk"><i></i><b></b></div>'.repeat(7)}</div></section>`;
      return;
    }
    const ok = !inf.error;
    const rows = ok ? [
      inf.creators?.length && ['Created by', inf.creators.join(', ')],
      inf.directors?.length && ['Directed by', inf.directors.join(', ')],
      inf.writers?.length && ['Written by', inf.writers.join(', ')],
      inf.network && ['Network', inf.network],
      inf.status && type === 'series' && ['Status', inf.status === 'Returning Series' ? (inf.nextEpisode ? `New episode ${fmtDate(inf.nextEpisode.date)}` : 'Returning') : inf.status],
      inf.seasonsCount && ['Seasons', `${inf.seasonsCount} · ${inf.episodesCount} episodes`],
      inf.released && [type === 'series' ? 'First aired' : 'Released', fmtDate(inf.released)],
      inf.language?.length && ['Language', inf.language.join(', ')],
      inf.budget && money(inf.budget) && ['Budget', money(inf.budget)],
      inf.revenue && money(inf.revenue) && ['Box office', money(inf.revenue)],
      inf.awards && ['Awards', inf.awards],
    ].filter(Boolean) : [];
    // the longer, richer description wins; the tagline sits above it
    const over = ok && (inf.overview || '').length > (meta.overview || '').length ? inf.overview : meta.overview;
    const ov = $('#dOver', box); if (ov && over && over !== ov.textContent) { ov.textContent = over; requestAnimationFrame(() => ov.classList.toggle('long', ov.scrollHeight > ov.clientHeight + 2)); }
    about.innerHTML = `<h3 class="dx-h">About</h3>
      ${ok && inf.tagline ? `<p class="dx-tagline">“${esc(inf.tagline)}”</p>` : ''}
      ${rows.length ? `<dl class="dx-dl">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${ok && inf.keywords?.length ? `<div class="dx-kw">${inf.keywords.map((k) => `<span>${esc(k)}</span>`).join('')}</div>` : ''}`;

    const cast = ok && inf.cast?.length ? inf.cast : (meta.cast || []).map((n) => ({ name: n }));
    const reviews = ok ? inf.reviews || [] : [];
    const sim = ok ? inf.similar || [] : [];
    more.innerHTML = `
      ${cast.length ? `<section class="dx-sec"><div class="dx-sh"><h3 class="dx-h">Cast</h3><span class="dx-count">${cast.length}</span></div><div class="dx-row">${cast.map((c) => `
        <a class="dx-person" ${c.id ? `href="#" data-pid="${c.id}" aria-label="About ${esc(c.name)}"` : ''}>
          <i>${c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ld')">` : `<span>${esc((c.name || '?')[0])}</span>`}</i>
          <b>${esc(c.name)}</b>${c.character ? `<small>${esc(c.character)}</small>` : ''}${c.episodes > 1 ? `<em>${c.episodes} episodes</em>` : ''}</a>`).join('')}</div></section>` : ''}
      ${reviews.length ? `<section class="dx-sec"><div class="dx-sh"><h3 class="dx-h">Reviews</h3><span class="dx-count">${reviews.length}</span></div><div class="dx-revs">${reviews.map((r) => `
        <article class="dx-rev"><header><span class="dx-av">${r.avatar ? `<img src="${esc(r.avatar)}" alt="" loading="lazy">` : esc((r.author || '?')[0])}</span>
          <div><b>${esc(r.author)}</b><small>${fmtDate(r.date)}</small></div>${r.rating != null ? `<span class="dx-rr ${r.rating >= 7 ? 'hi' : r.rating >= 5 ? 'mid' : 'lo'}">${icon('star')} ${r.rating}</span>` : ''}</header>
          <p>${esc(r.text)}</p><footer><button class="dx-rm">Read more</button><a href="${esc(r.url)}" target="_blank" rel="noopener">Full review ${icon('ext')}</a></footer></article>`).join('')}</div></section>` : ''}
      ${sim.length ? `<section class="dx-sec"><div class="dx-sh"><h3 class="dx-h">More like this</h3></div><div class="dx-row dx-sims">${sim.map((s) => `
        <a class="dx-sim" href="#/title/${esc(s.type)}/${esc(s.imdbId)}" data-sim="${esc(s.imdbId)}" data-type="${esc(s.type)}"><i><img src="${esc(s.poster)}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ld')"></i>
          <b>${esc(s.title)}</b><small>${[s.year, s.rating && '★ ' + s.rating].filter(Boolean).join(' · ')}</small></a>`).join('')}</div></section>` : ''}
      ${inf.error && inf.error !== 'offline' ? `<p class="dx-hint">${esc(inf.error)}</p>` : ''}`;
    // review: show the whole text only if it was actually clipped
    $$('.dx-rev', more).forEach((r) => { const p = $('p', r), b = $('.dx-rm', r); requestAnimationFrame(() => { if (p.scrollHeight <= p.clientHeight + 2) b.remove(); }); b.onclick = () => { r.classList.toggle('open'); b.textContent = r.classList.contains('open') ? 'Show less' : 'Read more'; }; });
    $$('[data-pid]', more).forEach((a) => {
      a.onclick = (e) => { e.preventDefault(); openPerson(+a.dataset.pid); };
      a.addEventListener('pointerenter', () => personData(+a.dataset.pid), { once: true }); // warm it up
    });
    $$('.dx-sim', more).forEach((a) => a.addEventListener('pointerenter', () => prefetchTitle(a.dataset.type, a.dataset.sim), { once: true }));
    const sc = $('#dScores', box); if (sc) sc.innerHTML = scoresHTML();
    const kk = $('#dKick', box); if (kk && ok) kk.innerHTML = [type === 'series' ? 'Series' : 'Film', type === 'series' && inf.seasonsCount ? `${inf.seasonsCount} season${inf.seasonsCount > 1 ? 's' : ''}` : '', inf.network].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('') + (inf.certification ? `<em class="dx-cert">${esc(inf.certification)}</em>` : '');
    about.removeAttribute('data-rv'); st.rescan?.();
    if (ok && !meta.background && inf.backdrop && !$('.dx-bg', box)) $('.dx-bgw', box).innerHTML = `<img class="dx-bg" src="${esc(inf.backdrop)}" alt="" decoding="async" onload="this.classList.add('ld')">`;
  }

  // ----- your rating: stars, "not for me", and (once rated) what stood out -----
  const ASPECTS = ['Story', 'Acting', 'Characters', 'Visuals', 'World', 'Action', 'Humour', 'Music', 'Ending', 'Pace'];
  st.mine = st.mine || null;
  api(`/api/rating/${id}`).then((m) => { if (my !== token) return; st.mine = m; renderRate(); }).catch(() => {});
  function renderRate() {
    const el2 = $('#dRate', box); if (!el2 || !st.mine) return;
    const m = st.mine, label = ['', 'Not for me', 'It was okay', 'Liked it', 'Really liked it', 'Loved it'];
    el2.innerHTML = `<div class="rt-row"><span class="rt-k">Your rating</span>
      <span class="rt-stars" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map((n) => `<button class="rt-s ${n <= m.rating ? 'on' : ''}" data-r="${n}" role="radio" aria-checked="${n === m.rating}" aria-label="${n} star${n > 1 ? 's' : ''}">${icon('star')}</button>`).join('')}</span>
      <span class="rt-l">${m.rating ? esc(label[m.rating]) : 'Rate it to sharpen your picks'}</span>
      <button class="rt-no ${m.hidden ? 'on' : ''}" id="dNope">${m.hidden ? 'Hidden from your picks · Undo' : 'Not for me'}</button></div>
      ${m.rating ? `<div class="rt-asp"><span class="rt-k">What stood out?</span>${ASPECTS.map((a) => `<button class="rt-a ${m.liked.includes(a) ? 'on' : ''}" data-a="${a}">${a}</button>`).join('')}</div>` : ''}`;
    const stars = $$('.rt-s', el2);
    stars.forEach((b) => {
      b.onmouseenter = () => stars.forEach((x) => x.classList.toggle('hov', +x.dataset.r <= +b.dataset.r));
      b.onclick = () => save(+b.dataset.r === m.rating ? 0 : +b.dataset.r, m.liked);
    });
    $('.rt-stars', el2).onmouseleave = () => stars.forEach((x) => x.classList.remove('hov'));
    $$('.rt-a', el2).forEach((b) => (b.onclick = () => { const a = b.dataset.a; const liked = m.liked.includes(a) ? m.liked.filter((x) => x !== a) : [...m.liked, a]; save(m.rating, liked); }));
    $('#dNope', el2).onclick = async () => {
      const undo = m.hidden;
      try { if (window.ihHideTitle) window.ihHideTitle(id, meta.title, undo); else await post('/api/notinterested', { imdbId: id, title: meta.title, undo }); st.mine = { ...m, hidden: !undo, rating: undo ? m.rating : 0 }; renderRate(); toast(undo ? 'Back in your picks' : "Got it. You won't see this in your picks, and similar titles drop", 'ok'); window.browseTasteChanged?.(); } catch (e) { toast(e.message, 'err'); }
    };
  }
  async function save(rating, liked) {
    const prev = st.mine; st.mine = { ...prev, rating, liked: rating ? liked : [], hidden: false }; renderRate();
    try { await post('/api/rate', { imdbId: id, title: meta.title, type, rating, liked: rating ? liked : [] }); window.browseTasteChanged?.(); if (rating && !prev.rating) toast('Thanks. Your picks will learn from this', 'ok'); }
    catch (e) { st.mine = prev; renderRate(); toast(e.message, 'err'); }
  }

  // ----- people -----
  let personTok = 0;
  async function openPerson(pid) {
    const my3 = ++personTok, pv = $('#dPerson', box); if (!pv) return;
    pv.innerHTML = personShell(meta.title);
    pv.removeAttribute('aria-hidden'); box.classList.add('pmode');
    $('[data-pback]', pv).onclick = closePerson;
    const p = await personData(pid);
    if (my3 !== personTok || my !== token) return;
    if (p.error) { $('.pv-body', pv).innerHTML = `<p class="dx-hint">${esc(p.error)}</p>`; return; }
    pv.innerHTML = personHTML(p, meta.title);
    personIn(pv); watchSections($('.pv-scroll', pv), pv);
    $('.pv-scroll', pv).scrollTop = 0;
    bindPerson(pv, p);
  }
  function closePerson() { box.classList.remove('pmode'); $('#dPerson', box)?.setAttribute('aria-hidden', 'true'); }
  box._pback = closePerson;
  function bindPerson(pv, p) {
    $('[data-pback]', pv).onclick = closePerson;
    const bio = $('.pv-bio', pv), more = $('.pv-more', pv);
    if (bio && more) requestAnimationFrame(() => { if (bio.scrollHeight <= bio.clientHeight + 2) more.remove(); });
    more?.addEventListener('click', () => { bio.classList.toggle('open'); more.textContent = bio.classList.contains('open') ? 'Show less' : 'Read full biography'; });
    const st2 = { tab: 'acting', kind: 'all' };
    const draw2 = () => { const l = $('#pvList', pv); if (l) l.innerHTML = filmography(p, st2); $$('[data-ptab]', pv).forEach((b) => b.classList.toggle('on', b.dataset.ptab === st2.tab)); $$('[data-pkind]', pv).forEach((b) => b.classList.toggle('on', b.dataset.pkind === st2.kind)); };
    $$('[data-ptab]', pv).forEach((b) => (b.onclick = () => { st2.tab = b.dataset.ptab; draw2(); }));
    $$('[data-pkind]', pv).forEach((b) => (b.onclick = () => { st2.kind = b.dataset.pkind; draw2(); }));
    // any title opens in this same sheet
    pv.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-tid]'); if (!t) return;
      e.preventDefault(); t.classList.add('busy');
      try { const r = await api(`/api/tmdb/${t.dataset.kind}/${t.dataset.tid}`); if (r.imdbId) location.hash = `#/title/${r.type}/${r.imdbId}`; else toast('That one isn\'t in the catalogue yet'); }
      catch (err) { toast(err.message, 'err'); } finally { t.classList.remove('busy'); }
    });
  }

  // ----- streams -----
  async function loadStreams(pre) {
    const my2 = ++st.req;
    st.streams = null; st.loading = true; st.tier = null; st.more = false;
    renderStreams();
    let list = [];
    try { list = await (pre || getStreams(qsFor(st.season, st.episode))); } catch (e) { toast(e.message, 'err'); }
    if (my !== token || my2 !== st.req) return;
    st.streams = list; st.loading = false;
    renderStreams();
  }

  const prefName = () => PREF_NAME[store.settings.playback.quality] || 'highest quality';
  const why = (s) => {
    const out = [];
    const want = store.settings.playback.quality;
    if (want === 'auto' || s.resolution === want) out.push(want === 'auto' ? 'Highest quality available' : `Matches your ${prefName()} preference`);
    out.push(s.cached ? 'Starts instantly' : 'Needs a download first');
    if (s.hdr?.length) out.push(s.hdr[0]);
    return out.slice(0, 3);
  };
  // ---- making sense of many near-identical torrents ----
  const LANG = { RU: 'Russian', UA: 'Ukrainian', IT: 'Italian', FR: 'French', ES: 'Spanish', DE: 'German', PL: 'Polish', PT: 'Portuguese', LT: 'Lithuanian', SE: 'Swedish', JP: 'Japanese', KR: 'Korean', ZH: 'Chinese', CZ: 'Czech', HU: 'Hungarian', TR: 'Turkish', HI: 'Hindi', NO: 'Norwegian', NL: 'Dutch', DA: 'Danish', FI: 'Finnish' };
  const CODE = { sv: 'SE', lt: 'LT', en: 'EN', ru: 'RU', uk: 'UA', it: 'IT', fr: 'FR', es: 'ES', de: 'DE', pl: 'PL', pt: 'PT', ja: 'JP', ko: 'KR', no: 'NO', nb: 'NO' };
  const myLangs = (store.settings.playback.audioLangs || []).map((l) => CODE[l] || l.toUpperCase()).filter((l) => l !== 'EN');
  const RES = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1 };
  const picScore = (s) => (RES[s.resolution] || 0) * 100 + (s.hdr?.includes('Dolby Vision') ? 26 : 0) + (s.hdr?.length ? 14 : 0) + ({ Remux: 30, 'Blu-ray': 14, 'WEB-DL': 9, WEB: 6, WEBRip: 4, HDTV: 1 }[s.source] || 0) + (s.tenbit ? 3 : 0) + Math.min(s.sizeGb || 0, 80) / 4;
  const audScore = (s) => ({ Atmos: 60, TrueHD: 50, 'DTS-HD': 46 }[s.audio?.split(' ')[0]] || (/^DD\+/.test(s.audio) ? 30 : /^DTS/.test(s.audio) ? 28 : /^DD /.test(s.audio) ? 22 : /^AAC/.test(s.audio) ? 6 : 0)) + (s.channels === '7.1' ? 6 : s.channels === '5.1' ? 3 : 0);
  const langLine = (s) => {
    const l = (s.langs || []).filter((x) => x !== 'MULTI');
    if ((s.langs || []).includes('MULTI') && !l.length) return 'Multi-language';
    if (!l.length) return 'English';
    const names = l.map((x) => LANG[x] || x).join(' + ');
    return s.dub ? `${names} dub${s.original ? ' + original' : ''}` : `${names}${s.original ? ' + English' : ''}`;
  };
  const hdrShort = (h) => (/vision/i.test(h) ? 'Dolby Vision' : h);
  const chipsOf = (s, max = 99) => [
    ...(s.hdr || []).map((h) => `<span class="badge ${/vision/i.test(h) ? 'dv' : 'hdr'}">${esc(hdrShort(h))}</span>`),
    s.audio ? `<span class="badge ${audScore(s) >= 46 ? 'aud' : ''}">${esc(s.audio)}</span>` : '',
    (s.langs || []).some((l) => myLangs.includes(l)) ? `<span class="badge mine">${esc(langLine(s))}</span>` : '',
    s.pack ? '<span class="badge">Season pack</span>' : '',
    s.cached ? '' : '<span class="badge warn">Download</span>',
  ].filter(Boolean).slice(0, max).join('');
  const headline = (s) => [s.source, s.codec, s.tenbit ? '10-bit' : ''].filter(Boolean).join(' · ') || (s.group ? `Release by ${s.group}` : 'Stream');
  const plain = (s) => [langLine(s), s.audio && !s.audio.includes(' sound') ? '' : s.audio, s.service, s.fixes].filter(Boolean).join(' · ');
  // near-identical copies (same picture, sound, language, size) become one row; the best-seeded working copy plays
  function grouped(list) {
    const m = new Map();
    for (const s of list) {
      const k = [s.resolution, s.source, s.codec, (s.hdr || []).join(), s.audio, (s.langs || []).join(), s.pack, s.dub, Math.round((s.sizeGb || 0) * 10)].join('|');
      const g = m.get(k);
      if (!g) { m.set(k, { ...s, copies: 1 }); continue; }
      g.copies++;
      const better = (!s.broken && g.broken) || (s.cached && !g.cached) || (s.broken === g.broken && s.cached === g.cached && (s.seeds || 0) > (g.seeds || 0));
      if (better) m.set(k, { ...s, copies: g.copies, seeds: Math.max(s.seeds || 0, g.seeds || 0) }); else g.seeds = Math.max(s.seeds || 0, g.seeds || 0);
    }
    return [...m.values()];
  }
  // a few clearly different choices, each labelled with what it's good for
  function picks(groups, rec) {
    const ok = groups.filter((s) => !s.broken && s.index !== rec.index && (s.cached || !store.settings.playback.cachedOnly));
    const out = new Map(), add = (s, label, why, ic) => { if (!s) return; const p = out.get(s.index); if (p) p.labels.push(label); else out.set(s.index, { s, labels: [label], why, ic }); };
    const top = (f, filt = () => true) => ok.filter(filt).sort((a, b) => f(b) - f(a))[0];
    const bp = top(picScore); if (bp && picScore(bp) > picScore(rec) + 5) add(bp, 'Best picture', [bp.hdr?.[0], bp.source === 'Remux' ? 'untouched disc quality' : '', bp.size].filter(Boolean).join(' · '), 'eye');
    const ba = top(audScore, (s) => audScore(s) >= 46); if (ba && audScore(ba) > audScore(rec)) add(ba, 'Best sound', `${ba.audio} surround`, 'star');
    for (const l of myLangs) { const bl = top((s) => picScore(s) + (s.seeds || 0) / 10, (s) => s.langs?.includes(l)); if (bl) add(bl, `In ${LANG[l] || l}`, langLine(bl), 'users'); }
    const lt = top((s) => -(s.sizeGb || 99), (s) => RES[s.resolution] >= 3 && s.sizeGb > 0.3 && s.sizeGb < (rec.sizeGb || 99) * 0.55 && !s.dub);
    if (lt) add(lt, 'Lightest', `${lt.size} · starts fast, easy on Wi-Fi`, 'bolt');
    const ms = top((s) => s.seeds || 0, (s) => (s.seeds || 0) >= 25 && (s.seeds || 0) > (rec.seeds || 0) * 2);
    if (ms) add(ms, 'Most shared', `${ms.seeds} people seeding`, 'flame');
    return [...out.values()].slice(0, 4);
  }
  const FILTERS = [['hdr', 'HDR / Dolby Vision', (s) => s.hdr?.length], ['sound', 'Surround sound', (s) => audScore(s) >= 22], ['en', 'English audio', (s) => !s.dub && (s.original || !(s.langs || []).length)], ['ep', 'Just this episode', (s) => !s.pack]];

  function sorted(list) {
    const by = (f) => [...list].sort(f);
    if (st.sort === 'size') return by((a, b) => b.sizeGb - a.sizeGb);
    if (st.sort === 'small') return by((a, b) => a.sizeGb - b.sizeGb);
    if (st.sort === 'seeds') return by((a, b) => b.seeds - a.seeds);
    return by((a, b) => (b.best - a.best) || (b.cached - a.cached) || (picScore(b) + audScore(b) / 3) - (picScore(a) + audScore(a) / 3));
  }
  const playBtn = (s, cls = 'btn') => (s.broken ? '<span class="badge warn" title="The debrid server refused this one. It gets another chance in 30 minutes.">Not working</span>' : `<button class="${cls}" data-p="${s.index}" aria-label="Play this version">${icon('play')}</button>`);

  function recOf(all) {
    let rec = all.find((s) => s.best) || all.find((s) => s.cached && !s.broken) || all.find((s) => !s.broken) || all[0];
    // never recommend a dub in a language you don't speak when an original-audio copy of the same quality exists
    const foreign = (s) => s.dub || (s.langs || []).some((l) => l !== 'MULTI' && !myLangs.includes(l));
    if (rec && foreign(rec) && !(rec.langs || []).some((l) => myLangs.includes(l))) {
      const alt = all.filter((s) => !s.broken && !foreign(s) && s.resolution === rec.resolution && (s.cached || !rec.cached)).sort((a, b) => (picScore(b) + audScore(b) / 3 + Math.min(b.seeds || 0, 50) / 5) - (picScore(a) + audScore(a) / 3 + Math.min(a.seeds || 0, 50) / 5))[0];
      if (alt) rec = alt;
    }
    return rec;
  }
  // the line under Play: what you'll get when you press it
  function setBest() {
    const b = $('#dBest', box); if (!b) return;
    if (st.loading || !st.streams) { b.className = 'dx-best wait'; b.innerHTML = `<span class="dx-dots"><i></i><i></i><i></i></span> Finding the best version…`; return; }
    const r = recOf(st.streams);
    if (!r) { b.className = 'dx-best none'; b.textContent = 'No versions found'; return; }
    const bits = [tierLabel(r.resolution), r.hdr?.[0] && hdrShort(r.hdr[0]), r.audio && audScore(r) >= 22 ? r.audio : '', r.size, langLine(r), r.cached ? 'starts instantly' : 'needs a download'].filter(Boolean);
    b.className = 'dx-best'; b.innerHTML = `${icon('bolt')}<span>${bits.map(esc).join(' · ')}</span>`;
  }
  const playNow = () => {
    const r = st.streams && !st.loading ? recOf(st.streams) : null;
    if (r && !r.broken) return playStream(r);
    return quickPlay({ ...item, backdrop: meta.background, ...(type === 'series' ? { season: st.season, episode: st.episode } : {}) });
  };

  const verOf = (s) => [tierLabel(s.resolution), s.hdr?.[0] && hdrShort(s.hdr[0]), s.audio, s.size].filter(Boolean).join(' · ');
  const playStream = (s) => window.playIndex?.(s.index, { title: meta.title, imdbId: id, poster: meta.poster, backdrop: meta.background, type, version: verOf(s), ...(type === 'series' ? { season: st.season, episode: st.episode } : {}) });

  function renderStreams() {
    setBest();
    if (!box.classList.contains('vmode')) { st.dirty = true; return; } // built when the versions view opens
    const out = $('#dList', box); if (!out) return;
    if (st.loading || !st.streams) {
      // placeholders in the exact shape of what's coming, so the view never looks empty or jumps when it fills
      const b = (w, h = 12, r = 6) => `<i class="vk" style="width:${w};height:${h}px;border-radius:${r}px"></i>`;
      out.innerHTML = `<div class="vx2 vx-loading">
        <div class="vx3-best rec vk-card"><i class="vk" style="width:72px;height:64px;border-radius:14px"></i>
          <div class="vk-col">${b('110px', 10)}${b('46%', 18, 7)}<div class="vk-row">${b('44px', 22)}${b('60px', 22)}${b('70px', 22)}${b('140px', 14)}</div></div>
          <div class="vk-col end">${b('70px', 16)}${b('40px', 10)}</div><i class="vk" style="width:100%;height:54px;border-radius:14px"></i></div>
        <div class="vx3-alts">${[0, 1, 2, 3].map(() => `<div class="vx3-alt vk-alt">${b('70px', 9)}${b('80%', 14)}${b('60%', 10)}</div>`).join('')}</div>
        <div class="vx-head"><h4>All versions</h4><div class="dx-finding"><span class="dx-dots"><i></i><i></i><i></i></span> Searching sources for versions…</div></div>
        <div class="vx2-table"><div class="vx2-hd"><span class="vx2-th">Version</span><span class="vx2-th c-p">Picture</span><span class="vx2-th c-s">Sound</span><span class="vx2-th c-l">Language</span><span class="vx2-th c-z">Size</span><span class="vx2-th c-d">Seeders</span><span class="c-a"></span></div>
          ${Array.from({ length: 6 }, (_, i) => `<div class="vx2-row vk-r" style="--d:${i}"><span class="c-v">${b('46px', 26, 7)}<span class="vk-col">${b(`${55 + (i * 13) % 35}%`, 13)}${b('40%', 10)}</span></span><span class="c-p">${b('36px', 22)}</span><span class="c-s">${b('54px', 22)}</span><span class="c-l">${b('70%', 12)}</span><span class="c-z">${b('60%', 12)}</span><span class="c-d">${b('46px', 12)}</span><span class="c-a">${b('34px', 34, 17)}</span></div>`).join('')}
        </div></div>`; return;
    }
    const all = st.streams;
    if (!all.length) {
      out.innerHTML = `<div class="vx-empty"><div class="vx-empty-i">${icon('film')}</div>
        <h3>No versions available yet</h3>
        <p>None of the sources has ${esc(meta.title)}${type === 'series' && st.episode ? ` ${esc(epTag())}` : ''} right now. New releases usually show up within a day or two; older or rare titles sometimes never get a copy.</p>
        <div class="vx-empty-b"><button class="btn primary" data-retry>${icon('refresh')} Try again</button>
          <button class="btn" data-shelf>${icon('bookmark')} ${wl.has(id) ? 'On your shelf' : 'Save for later'}</button>
          <button class="btn ghost" data-back>${icon('back')} Back to details</button></div></div>`;
      $('[data-retry]', out).onclick = () => loadStreams();
      $('[data-shelf]', out).onclick = async (e) => { if (!wl.has(id)) await toggleSave({ ...item }); e.currentTarget.innerHTML = `${icon('check')} On your shelf`; };
      $('[data-back]', out).onclick = closeVersions;
      return;
    }
    st.f ||= new Set();
    const rec = recOf(all);
    const groups = grouped(all), pk = picks(groups, rec);
    const recCopies = groups.find((g) => g.index === rec.index)?.copies || 1;
    const rest = groups.filter((s) => s.index !== rec.index);
    const fl = FILTERS.filter(([k]) => type === 'series' || k !== 'ep').filter(([, , f]) => rest.some(f) && !rest.every(f));
    const active = fl.filter(([k]) => st.f.has(k));
    const passing = rest.filter((s) => active.every(([, , f]) => f(s)));
    const counts = {}; passing.forEach((s) => { const k = s.resolution || ''; counts[k] = (counts[k] || 0) + 1; });
    const tiers = TIERS.filter(([k]) => counts[k]);
    if (st.tier === null || (st.tier !== '*' && !counts[st.tier])) st.tier = tiers.length > 1 && counts[rec.resolution || ''] ? (rec.resolution || '') : '*';
    const list = sorted(st.tier === '*' ? passing : passing.filter((s) => (s.resolution || '') === st.tier));
    const shown = st.more ? list.slice(0, 60) : list.slice(0, 12);
    const dupes = all.length - groups.length;
    const maxGb = Math.max(...list.map((x) => x.sizeGb || 0), rec.sizeGb || 0, 1);

    // cells
    const qcls = (x) => ({ '2160p': 'q4k', '1080p': 'qhd', '720p': 'q72' }[x.resolution] || 'qsd');
    const pic = (x) => [x.hdr?.some((h) => /vision/i.test(h)) && '<i class="t dv">DV</i>', x.hdr?.some((h) => /hdr10\+/i.test(h)) ? '<i class="t hdr">HDR10+</i>' : x.hdr?.some((h) => /hdr/i.test(h)) && '<i class="t hdr">HDR</i>', x.tenbit && !x.hdr?.length && '<i class="t">10-bit</i>'].filter(Boolean).join('') || '<i class="t dim">SDR</i>';
    const snd = (x) => x.audio ? `<i class="t ${audScore(x) >= 46 ? 'atm' : ''}">${esc(x.audio)}</i>` : '<i class="t dim">Stereo</i>';
    const lang = (x) => {
      const mine = (x.langs || []).some((l) => myLangs.includes(l)), foreign = x.dub && !mine;
      return `<span class="vx2-lang ${mine ? 'mine' : foreign ? 'warn' : ''}">${esc(langLine(x))}</span>`;
    };
    const seedBars = (n) => { const lv = n >= 200 ? 4 : n >= 40 ? 3 : n >= 8 ? 2 : n >= 1 ? 1 : 0; return `<span class="vx2-sig" title="${n || 0} seeding">${[1, 2, 3, 4].map((i) => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('')}<em>${n || 0}</em></span>`; };
    const sizeCell = (x) => `<span class="vx2-size"><b>${esc(x.size || '—')}</b><i><u style="width:${Math.max(4, Math.round(((x.sizeGb || 0) / maxGb) * 100))}%"></u></i></span>`;
    const reasons = why(rec);
    const sortHead = (k, label, cls = '') => `<button class="vx2-th ${cls} ${(st.sort === k || (k === 'size' && st.sort === 'small')) ? 'on' : ''}" data-sort="${k}">${label}${(st.sort === k || (k === 'size' && st.sort === 'small')) ? `<span class="vx2-dir">${st.sort === 'small' ? '↑' : '↓'}</span>` : ''}</button>`;

    out.innerHTML = `<div class="vx2">
      <div class="vx3-best rec" >
        <div class="vx2-q ${qcls(rec)}">${esc(tierLabel(rec.resolution))}</div>
        <div class="vx3-info">
          <div class="vx3-k">${icon('bolt')} Best for you${recCopies > 1 ? ` <span>· ${recCopies} sources</span>` : ''}</div>
          <b>${esc(headline(rec))}</b>
          <div class="vx3-line"><span class="vx2-tags">${pic(rec)}${snd(rec)}${lang(rec)}${rec.pack ? '<i class="t">Season pack</i>' : ''}</span>
            <span class="vx3-why">${reasons.map((r) => `<span>${icon('check')}${esc(r)}</span>`).join('')}</span></div>
        </div>
        <div class="vx3-meta"><b>${esc(rec.size || '')}</b>${seedBars(rec.seeds)}</div>
        <button class="btn primary vx3-play" data-p="${rec.index}" title="${esc(rec.quality)}">${icon('play')} Play</button>
      </div>
      ${pk.length ? `<div class="vx3-alts">${pk.map(({ s, labels, why: w, ic }) => `<button class="vx-pick vx3-alt" data-p="${s.index}" title="${esc(s.quality)}">
        <span class="vx3-al">${icon(ic)}${esc(labels.join(' · '))}</span>
        <span class="vx3-av"><i class="vx2-q sm ${qcls(s)}">${esc(tierLabel(s.resolution))}</i><b>${esc(headline(s))}</b></span>
        <small>${esc(w)}</small></button>`).join('')}</div>` : ''}
      ${rest.length ? `<div class="vx-head"><h4>All versions <em>${groups.length - 1} different${dupes ? ` · ${dupes} duplicates merged` : ''}</em></h4></div>
      <div class="vx-filters">
        ${tiers.length > 1 ? `<div class="vx2-seg"><button data-t="*" class="${st.tier === '*' ? 'on' : ''}">All <em>${passing.length}</em></button>${tiers.map(([k, l]) => `<button data-t="${k}" class="${k === st.tier ? 'on' : ''}">${l} <em>${counts[k]}</em></button>`).join('')}</div>` : ''}
        ${fl.map(([k, l]) => `<button data-f="${k}" class="vx-f tog ${st.f.has(k) ? 'on' : ''}">${st.f.has(k) ? icon('check') : ''}${l}</button>`).join('')}</div>
      <div class="vx2-table">
        <div class="vx2-hd">${sortHead('best', 'Version', 'c-v')}<span class="vx2-th c-p">Picture</span><span class="vx2-th c-s">Sound</span><span class="vx2-th c-l">Language</span>${sortHead('size', 'Size', 'c-z')}${sortHead('seeds', 'Seeders', 'c-d')}<span class="c-a"></span></div>
        ${shown.length ? shown.map((x) => `<div class="vx-opt vx2-row ${x.broken ? 'broken' : ''}" title="${esc(x.quality)}" ${x.broken ? '' : `data-p="${x.index}" role="button" tabindex="0"`}>
          <span class="c-v"><i class="vx2-q sm ${qcls(x)}">${esc(tierLabel(x.resolution))}</i><span class="vx2-src"><b>${esc([x.source, x.codec].filter(Boolean).join(' · ') || 'Stream')}</b><small>${esc([x.service, x.group, x.fixes, x.pack ? 'season pack' : '', x.copies > 1 ? `${x.copies} sources` : ''].filter(Boolean).join(' · '))}</small></span></span>
          <span class="c-p">${pic(x)}</span><span class="c-s">${snd(x)}</span><span class="c-l">${lang(x)}</span>
          <span class="c-z">${sizeCell(x)}</span><span class="c-d">${seedBars(x.seeds)}</span>
          <span class="c-a">${x.broken ? '<span class="badge warn" title="The debrid server refused this one. It gets another chance in 30 minutes.">Not working</span>' : `<span class="vx2-go">${icon('play')}</span>`}</span></div>`).join('') : '<div class="note" style="padding:18px 4px">Nothing matches these filters.</div>'}
      </div>
      ${list.length > shown.length ? `<button class="btn ghost wide vx2-more" id="dMoreV">Show ${Math.min(list.length, 60) - shown.length} more</button>` : ''}` : ''}
    </div>`;

    if (st.animIn) { st.animIn = false; versionsIn(box); }
    else if (st.reflow) { st.reflow = false; chain($$('.vx-opt', out), { step: 26, max: 8, x: 16, y: 0, dur: 420 }); }
    $$('[data-t]', out).forEach((b) => (b.onclick = () => { st.tier = b.dataset.t; st.more = false; st.reflow = true; renderStreams(); }));
    $$('[data-f]', out).forEach((b) => (b.onclick = () => { const k = b.dataset.f; st.f.has(k) ? st.f.delete(k) : st.f.add(k); st.more = false; st.reflow = true; renderStreams(); }));
    $$('[data-sort]', out).forEach((b) => (b.onclick = () => { const k = b.dataset.sort; st.sort = k === 'size' ? (st.sort === 'size' ? 'small' : 'size') : k; st.reflow = true; renderStreams(); }));
    $$('.vx2-row[data-p]', out).forEach((r) => (r.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.click(); } }));
    $('#dMoreV', out)?.addEventListener('click', () => { st.more = true; renderStreams(); });
    $$('[data-p]', out).forEach((b) => (b.onclick = () => { const s = all.find((x) => x.index === +b.dataset.p); if (s) playStream(s); }));
  }

  draw();
  const settled = new Promise((r) => setTimeout(r, Math.max(0, openedAt + 180 - performance.now())));
  Promise.all([infoP, settled]).then(([inf]) => { if (my !== token) return; st.info = inf; (window.requestIdleCallback || setTimeout)(() => { if (my === token) renderInfo(); }, { timeout: 200 }); });
  if (meta.trailers?.length) import('./trailer.js').then((m) => m.preload());
  loadStreams(earlyStreams);
}
