// Dossier: the detail sheet that slides over the browse view for one title.
import { api, post } from './api.js';
import { store, quickPlay, toggleSave } from './main.js';
import { $, $$, esc, icon, pad, posterOf, toast, wl } from './ui.js';

const TIERS = [['2160p', '4K'], ['1080p', '1080p'], ['720p', '720p'], ['480p', '480p'], ['', 'Other']];
const tierLabel = (r) => (TIERS.find(([k]) => k === (r || ''))?.[1] || 'Other');
const SORTS = [['best', 'Best first'], ['size', 'Largest'], ['small', 'Smallest'], ['seeds', 'Most seeders']];
const PREF_NAME = { auto: 'highest quality', '2160p': '4K', '1080p': '1080p', '720p': '720p' };
let el, token = 0;

function root() {
  if (el) return el;
  el = document.createElement('aside');
  el.className = 'dossier'; el.setAttribute('aria-label', 'Title details');
  document.body.appendChild(el);
  return el;
}

export function closeDossier() { token++; if (el?.classList.contains('open')) window.setTitleTint?.(null, false); el?.classList.remove('open'); }

export async function openDossier({ type, id }) {
  const my = ++token, box = root();
  box.classList.add('open');
  box.innerHTML = '<button class="dclose" aria-label="Close">' + icon('x') + '</button><div class="dbody"><div class="note">Opening…</div></div>';
  $('.dclose', box).onclick = () => { location.hash = '#/'; };
  let meta;
  try { meta = await api(`/api/title/${id}?type=${type}`); } catch (e) { box.querySelector('.dbody').innerHTML = `<div class="note">${esc(e.message)}</div>`; return; }
  if (my !== token) return;
  const history = store.history;
  const st = { season: null, episode: null, streams: null, loading: false, tier: null, sort: 'best', more: false, req: 0, epOpen: true };
  const watched = (s, e) => history.find((h) => h.imdbId === id && h.season === s && h.episode === e);
  if (type === 'series') {
    const seasons = Object.keys(meta.seasons || {}).map(Number).sort((a, b) => a - b);
    const last = history.find((h) => h.imdbId === id && h.season);
    st.season = last ? last.season : seasons[0];
    st.episode = last ? ((last.percent || 0) >= 90 ? last.episode + 1 : last.episode) : null;
    if (st.episode && !(meta.seasons[st.season] || []).some((x) => x.episode === st.episode)) { st.season = Math.min(st.season + 1, seasons.at(-1)); st.episode = 1; }
    st.epOpen = !st.episode; // known next episode -> start collapsed
    // no history: start from the first episode so streams show right away
    if (!st.episode) st.episode = (meta.seasons[st.season] || [])[0]?.episode || 1;
  }
  const item = { imdbId: id, type, title: meta.title, year: meta.year, poster: meta.poster, rating: meta.rating };
  window.setTitleTint?.(meta.poster || posterOf(id), true);

  // ----- episodes -----
  const epsHTML = () => (meta.seasons?.[st.season] || []).map((e) => {
    const w = watched(st.season, e.episode), done = w && (w.percent || 0) >= 90;
    return `<button class="ep ${e.episode === st.episode ? 'on' : ''}" data-e="${e.episode}"><span class="n">${e.episode}</span><span>${esc(e.name)}</span><span class="d">${done ? '<span class="badge ok">Watched</span>' : w ? `<span class="badge acc">${Math.round(w.percent || 0)}%</span>` : ''}</span></button>`;
  }).join('');
  const epTag = () => (type === 'series' && st.episode ? `S${pad(st.season)}E${pad(st.episode)}` : '');
  const playLabel = () => (type === 'series' ? (st.episode ? `Play ${epTag()}` : 'Play next episode') : 'Play');
  const setPlay = () => { const b = $('#dPlay', box); if (b) b.innerHTML = `${icon('play')} ${playLabel()}`; };
  const saveLabel = () => `${icon('bookmark')} ${wl.has(id) ? 'On your shelf' : 'Save'}`;

  const epObj = () => (meta.seasons?.[st.season] || []).find((e) => e.episode === st.episode);
  const epBarTitle = () => `${epTag()}${epObj()?.name ? ' · ' + epObj().name : ''}`;
  const actLabel = () => `${st.epOpen ? 'Collapse' : 'Change'} ${icon('chev')}`;
  function setEpBar() {
    const n = $('#dEpBar .n', box), t = $('#dEpBar .epbar-t', box);
    if (!n || !t) return;
    n.textContent = st.episode ?? '–';
    t.innerHTML = `<b>${esc(epBarTitle())}</b><small>Season ${st.season}</small>`;
  }
  function toEpSection() {
    const body = box.querySelector('.dbody'), sec = $('#dEpSec', box); if (!body || !sec) return;
    setTimeout(() => body.scrollTo({ top: Math.max(0, sec.offsetTop - 14), behavior: 'smooth' }), 80);
  }
  function toggleEps(open) {
    st.epOpen = open;
    $('#dEpSec', box)?.classList.toggle('collapsed', !open);
    const bar = $('#dEpBar', box); if (bar) { bar.setAttribute('aria-expanded', String(open)); $('.epbar-act', bar).innerHTML = actLabel(); }
    toEpSection();
  }

  function bindEps() {
    $$('[data-e]', box).forEach((b) => (b.onclick = () => {
      st.episode = +b.dataset.e;
      $$('[data-e]', box).forEach((x) => x.classList.toggle('on', x === b));
      setPlay(); setEpBar(); loadStreams();
      setTimeout(() => toggleEps(false), 220); // let the pick register, then fold the list away
    }));
  }

  function draw(first = false) {
    const keep = box.querySelector('.dbody')?.scrollTop || 0;
    const seasons = Object.keys(meta.seasons || {}).map(Number).sort((a, b) => a - b);
    const q = encodeURIComponent(`${meta.title} ${meta.year}`);
    box.innerHTML = `<button class="dclose" aria-label="Close">${icon('x')}</button>
      <div class="dbody${first ? ' enter' : ''}">
        ${meta.background ? `<div class="dbg" style="background-image:url('${esc(meta.background)}')"></div>` : ''}
        <div class="dhead"><div class="dposter" style="background-image:url('${esc(meta.poster || posterOf(id))}')"></div>
          <div><div class="dkick">${type === 'series' ? 'Series' : 'Film'}${meta.year ? ' · ' + esc(meta.year) : ''}</div><h2>${esc(meta.title)}</h2>
            <div class="dfacts">${[meta.runtime, meta.rating && '★ ' + meta.rating, ...(meta.genres || []).slice(0, 2)].filter(Boolean).map((f) => `<span>${esc(f)}</span>`).join('')}</div></div></div>
        <p class="dover">${esc(meta.overview)}</p>
        <div class="dacts"><button class="btn primary" id="dPlay">${icon('play')} ${playLabel()}</button>
          <button class="btn" id="dSave">${saveLabel()}</button>
          <a class="btn ghost" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${q}+trailer">Trailer ${icon('ext')}</a>
          <a class="btn ghost" target="_blank" rel="noopener" href="https://www.imdb.com/title/${esc(id)}/">IMDb ${icon('ext')}</a></div>
        ${type === 'series' ? `<div class="dsec epsec ${st.epOpen ? '' : 'collapsed'}" id="dEpSec">
          <button class="epbar" id="dEpBar" aria-expanded="${st.epOpen}"><span class="n">${st.episode ?? '–'}</span><span class="epbar-t"><b>${esc(epBarTitle())}</b><small>Season ${st.season}</small></span><span class="epbar-act">${actLabel()}</span></button>
          <div class="epwrap"><div class="epin"><div class="seg" style="margin:14px 0 10px">${seasons.map((n) => `<button data-s="${n}" class="${n === st.season ? 'on' : ''}">S${n}</button>`).join('')}</div>
            <div class="eps" id="dEps">${epsHTML()}</div></div></div></div>` : ''}
        <div class="dsec"><h3>Choose a version <span class="h3r" id="dEpTag">${epTag()}</span></h3><div id="dList"></div></div>
      </div>`;
    $('.dclose', box).onclick = () => { location.hash = '#/'; };
    $('#dPlay', box).onclick = () => quickPlay({ ...item, ...(st.episode ? { season: st.season, episode: st.episode } : {}) });
    $('#dSave', box).onclick = async () => { await toggleSave({ ...item }); $('#dSave', box).innerHTML = saveLabel(); };
    $('#dEpBar', box)?.addEventListener('click', () => toggleEps(!st.epOpen));
    $$('[data-s]', box).forEach((b) => (b.onclick = () => {
      st.season = +b.dataset.s; st.episode = (meta.seasons[st.season] || [])[0]?.episode || 1;
      $$('[data-s]', box).forEach((x) => x.classList.toggle('on', x === b));
      $('#dEps', box).innerHTML = epsHTML(); bindEps(); setPlay(); setEpBar(); loadStreams();
    }));
    bindEps(); renderStreams();
    const body = box.querySelector('.dbody'); if (body) body.scrollTop = keep;
  }

  // ----- streams -----
  async function loadStreams() {
    const my2 = ++st.req;
    st.streams = null; st.loading = true; st.tier = null; st.more = false;
    const tag = $('#dEpTag', box); if (tag) tag.textContent = epTag();
    renderStreams();
    const qs = new URLSearchParams({ imdbId: id, type, title: meta.title });
    if (type === 'series') { qs.set('season', st.season); qs.set('episode', st.episode); }
    let list = [];
    try { list = await api('/api/streams?' + qs); } catch (e) { toast(e.message, 'err'); }
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
  const hdrShort = (h) => (/vision/i.test(h) ? 'Dolby Vision' : h);
  const chipsOf = (s, max = 99) => [
    ...(s.hdr || []).map((h) => `<span class="badge ${/vision/i.test(h) ? 'dv' : 'hdr'}">${esc(hdrShort(h))}</span>`),
    s.audio ? `<span class="badge">${esc(s.audio)}</span>` : '',
    ...(s.langs || []).slice(0, 2).map((l) => `<span class="badge">${esc(l)}</span>`),
    s.cached ? '' : '<span class="badge warn">Download</span>',
  ].filter(Boolean).slice(0, max).join('');
  const headline = (s) => [s.source, s.codec].filter(Boolean).join(' · ') || (s.group ? `Release by ${s.group}` : 'Stream');

  function sorted(list) {
    const by = (f) => [...list].sort(f);
    if (st.sort === 'size') return by((a, b) => b.sizeGb - a.sizeGb);
    if (st.sort === 'small') return by((a, b) => a.sizeGb - b.sizeGb);
    if (st.sort === 'seeds') return by((a, b) => b.seeds - a.seeds);
    return by((a, b) => (b.best - a.best) || (b.cached - a.cached) || (b.sizeGb - a.sizeGb));
  }

  function renderStreams() {
    const out = $('#dList', box); if (!out) return;
    if (st.loading || !st.streams) {
      out.innerHTML = '<div class="rec sk"></div><div class="optsk"><i></i><i></i><i></i></div>'; return;
    }
    const all = st.streams;
    if (!all.length) { out.innerHTML = '<div class="note" style="padding:var(--s6) 0">No versions found for this one.</div>'; return; }
    const rec = all.find((s) => s.best) || all.find((s) => s.cached) || all[0];
    const rest = all.filter((s) => s !== rec);
    const counts = {}; rest.forEach((s) => { const k = s.resolution || ''; counts[k] = (counts[k] || 0) + 1; });
    const tiers = TIERS.filter(([k]) => counts[k]);
    if (st.tier === null || !counts[st.tier]) st.tier = counts[rec.resolution || ''] ? (rec.resolution || '') : tiers[0]?.[0] ?? '';
    const list = sorted(rest.filter((s) => (s.resolution || '') === st.tier));
    const shown = st.more ? list.slice(0, 40) : list.slice(0, 6);

    out.innerHTML = `
      <div class="rec">
        <div class="rec-top"><span class="badge acc">${icon('bolt')} Recommended</span><span class="rec-why">${why(rec).map(esc).join(' · ')}</span></div>
        <div class="rec-main">
          <div class="rec-res">${esc(tierLabel(rec.resolution))}</div>
          <div class="rec-info"><b>${esc(headline(rec))}</b><div class="chip-line">${chipsOf(rec)}</div></div>
          <div class="rec-size"><b>${esc(rec.size || '')}</b><span>${rec.seeds ? '↑' + rec.seeds + ' seeders' : ''}</span></div>
        </div>
        <button class="btn primary wide" data-p="${rec.index}" title="${esc(rec.quality)}">${icon('play')} Play this version</button>
      </div>
      ${rest.length ? `<div class="opt-head"><div class="seg">${tiers.map(([k, l]) => `<button data-t="${k}" class="${k === st.tier ? 'on' : ''}">${l} <em>${counts[k]}</em></button>`).join('')}</div>
        <select class="sel" id="dSort" aria-label="Sort">${SORTS.map(([k, l]) => `<option value="${k}" ${k === st.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="opts">${shown.map((s) => `<div class="opt" title="${esc(s.quality)}"><div class="o-res">${esc(tierLabel(s.resolution))}</div>
        <div class="o-info"><b>${esc(headline(s))}</b><div class="o-chips">${chipsOf(s, 4) || `<span class="o-none">${esc(s.group || 'Standard release')}</span>`}</div></div>
        <div class="o-size"><b>${esc(s.size || '—')}</b><span>${s.seeds ? '↑' + s.seeds : '&nbsp;'}</span></div>
        <button class="btn" data-p="${s.index}" aria-label="Play this version">${icon('play')}</button></div>`).join('')}</div>
      ${list.length > shown.length ? `<button class="btn ghost wide" id="dMore">Show ${Math.min(list.length, 40) - shown.length} more</button>` : ''}` : ''}`;

    $$('[data-t]', out).forEach((b) => (b.onclick = () => { st.tier = b.dataset.t; st.more = false; renderStreams(); }));
    $('#dSort', out)?.addEventListener('change', (e) => { st.sort = e.target.value; renderStreams(); });
    $('#dMore', out)?.addEventListener('click', () => { st.more = true; renderStreams(); });
    $$('[data-p]', out).forEach((b) => (b.onclick = async () => {
      window.watchLaunch?.({ title: meta.title, imdbId: id, poster: meta.poster });
      try { await post('/api/play', { index: +b.dataset.p }); }
      catch (e) { toast(e.message, 'err'); window.cancelLaunchUI?.(); }
    }));
  }

  draw(true);
  if (type === 'movie' || st.episode) loadStreams();
}
