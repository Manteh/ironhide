// Dossier: the detail sheet that slides over the vault for one title.
import { api, post } from './api.js';
import { store, quickPlay, toggleSave } from './main.js';
import { $, $$, esc, icon, pad, posterOf, toast, wl } from './ui.js';

const CATS = [['best', 'Best match'], ['premium', '4K · Remux · DV'], ['size', 'Largest'], ['seeds', 'Seeders'], ['1080p', '1080p'], ['all', 'All']];
let el, token = 0;

function root() {
  if (el) return el;
  el = document.createElement('aside');
  el.className = 'dossier'; el.setAttribute('aria-label', 'Title details');
  document.body.appendChild(el);
  return el;
}

export function closeDossier() { token++; el?.classList.remove('open'); }

export async function openDossier({ type, id }) {
  const my = ++token, box = root();
  box.classList.add('open');
  box.innerHTML = '<button class="dclose" aria-label="Close">' + icon('x') + '</button><div class="dbody"><div class="note">Opening…</div></div>';
  $('.dclose', box).onclick = () => { location.hash = '#/'; };
  let meta;
  try { meta = await api(`/api/title/${id}?type=${type}`); } catch (e) { box.querySelector('.dbody').innerHTML = `<div class="note">${esc(e.message)}</div>`; return; }
  if (my !== token) return;
  const history = store.history;
  const st = { season: null, episode: null, cat: 'best', streams: null, open: false };
  const watched = (s, e) => history.find((h) => h.imdbId === id && h.season === s && h.episode === e);
  if (type === 'series') {
    const seasons = Object.keys(meta.seasons || {}).map(Number).sort((a, b) => a - b);
    const last = history.find((h) => h.imdbId === id && h.season);
    st.season = last ? last.season : seasons[0];
    st.episode = last ? ((last.percent || 0) >= 90 ? last.episode + 1 : last.episode) : null;
    if (st.episode && !(meta.seasons[st.season] || []).some((x) => x.episode === st.episode)) { st.season = Math.min(st.season + 1, seasons.at(-1)); st.episode = 1; }
  }
  const item = { imdbId: id, type, title: meta.title, year: meta.year, poster: meta.poster, rating: meta.rating };

  function draw() {
    const seasons = Object.keys(meta.seasons || {}).map(Number).sort((a, b) => a - b), eps = meta.seasons?.[st.season] || [];
    const q = encodeURIComponent(`${meta.title} ${meta.year}`), saved = wl.has(id);
    const playLabel = type === 'series' ? (st.episode ? `Play S${pad(st.season)}E${pad(st.episode)}` : 'Play next episode') : 'Play';
    box.innerHTML = `<button class="dclose" aria-label="Close">${icon('x')}</button>
      <div class="dbody">
        ${meta.background ? `<div class="dbg" style="background-image:url('${esc(meta.background)}')"></div>` : ''}
        <div class="dhead"><div class="dposter" style="background-image:url('${esc(meta.poster || posterOf(id))}')"></div>
          <div><div class="dkick">${type === 'series' ? 'Series' : 'Film'}${meta.year ? ' · ' + esc(meta.year) : ''}</div><h2>${esc(meta.title)}</h2>
            <div class="dfacts">${[meta.runtime, meta.rating && '★ ' + meta.rating, ...(meta.genres || []).slice(0, 2)].filter(Boolean).map((f) => `<span>${esc(f)}</span>`).join('')}</div></div></div>
        <p class="dover">${esc(meta.overview)}</p>
        <div class="dacts"><button class="btn primary" id="dPlay">${icon('play')} ${playLabel}</button>
          <button class="btn" id="dSave">${icon('bookmark')} ${saved ? 'On your shelf' : 'Save'}</button>
          <a class="btn ghost" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${q}+trailer">Trailer ${icon('ext')}</a>
          <a class="btn ghost" target="_blank" rel="noopener" href="https://www.imdb.com/title/${esc(id)}/">IMDb ${icon('ext')}</a></div>
        ${type === 'series' ? `<div class="dsec"><h3>Episodes</h3><div class="seg" style="margin-bottom:10px">${seasons.map((s) => `<button data-s="${s}" class="${s === st.season ? 'on' : ''}">S${s}</button>`).join('')}</div>
          <div class="eps">${eps.map((e) => { const w = watched(st.season, e.episode), done = w && (w.percent || 0) >= 90;
            return `<button class="ep ${e.episode === st.episode ? 'on' : ''}" data-e="${e.episode}"><span class="n">${e.episode}</span><span>${esc(e.name)}</span><span class="d">${done ? '<span class="badge ok">Watched</span>' : w ? `<span class="badge acc">${Math.round(w.percent || 0)}%</span>` : ''}</span></button>`; }).join('')}</div></div>` : ''}
        <div class="dsec"><h3>Streams <button class="link-btn" id="dStreams">${st.open ? 'Hide' : 'Choose a stream'}</button></h3><div id="dList"></div></div>
      </div>`;
    $('.dclose', box).onclick = () => { location.hash = '#/'; };
    $('#dPlay', box).onclick = () => quickPlay({ ...item, ...(st.episode ? { season: st.season, episode: st.episode } : {}) });
    $('#dSave', box).onclick = async () => { await toggleSave({ ...item }); draw(); };
    $('#dStreams', box).onclick = () => { st.open = !st.open; if (st.open && !st.streams) loadStreams(); draw(); };
    $$('[data-s]', box).forEach((b) => (b.onclick = () => { st.season = +b.dataset.s; st.episode = null; st.streams = null; st.open = false; draw(); }));
    $$('[data-e]', box).forEach((b) => (b.onclick = () => { st.episode = +b.dataset.e; st.streams = null; if (st.open) loadStreams(); draw(); }));
    renderList();
  }

  async function loadStreams() {
    const qs = new URLSearchParams({ imdbId: id, type, title: meta.title });
    if (type === 'series') { if (!st.episode) { st.season = st.season || 1; st.episode = 1; } qs.set('season', st.season); qs.set('episode', st.episode); }
    try { st.streams = await api('/api/streams?' + qs); } catch (e) { st.streams = []; toast(e.message, 'err'); }
    if (my === token) renderList();
  }

  const view = (list) => {
    const by = (f) => [...list].sort(f);
    switch (st.cat) {
      case 'best': return by((a, b) => (b.best - a.best) || (b.cached - a.cached));
      case 'premium': return list.filter((s) => /2160p|remux|dv|hdr/i.test(s.resolution + s.tags.join())).sort((a, b) => b.cached - a.cached);
      case 'size': return by((a, b) => b.sizeGb - a.sizeGb);
      case 'seeds': return by((a, b) => b.seeds - a.seeds);
      case '1080p': return list.filter((s) => s.resolution === '1080p');
      default: return list;
    }
  };

  function renderList() {
    const out = $('#dList', box); if (!out) return;
    if (!st.open) { out.innerHTML = '<div class="muted" style="font-size:13px">Play picks the best stream for your quality settings automatically.</div>'; return; }
    if (!st.streams) { out.innerHTML = '<div class="note" style="padding:var(--s5) 0">Searching…</div>'; return; }
    const list = view(st.streams).slice(0, 25);
    out.innerHTML = `<div class="chips" style="margin:0 0 var(--s4)">${CATS.map(([k, l]) => `<button data-c="${k}" class="${st.cat === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${list.length ? list.map((s) => `<div class="stream ${s.best ? 'best' : ''}"><div class="res">${esc(s.resolution || '—')}</div>
        <div><div class="line">${s.best ? '<span class="badge acc">Best</span>' : ''}${s.cached ? '<span class="badge ok">Cached</span>' : '<span class="badge warn">Download</span>'}${s.tags.map((t) => `<span class="badge ${t.toLowerCase()}">${t}</span>`).join('')}</div><div class="sz">${esc(s.size)} · ↑${s.seeds}</div><div class="q" title="${esc(s.quality)}">${esc(s.quality)}</div></div>
        <div class="acts"><button class="btn ${s.best ? 'primary' : ''}" data-p="${s.index}">${icon('play')} Play</button></div></div>`).join('') : '<div class="note">No streams for this filter.</div>'}`;
    $$('[data-c]', out).forEach((b) => (b.onclick = () => { st.cat = b.dataset.c; renderList(); }));
    $$('[data-p]', out).forEach((b) => (b.onclick = async () => {
      try { const r = await post('/api/play', { index: +b.dataset.p }); toast((r.content?.[0]?.text || 'Started').split('\n')[0].slice(0, 90), 'ok'); setTimeout(() => window.pollRemote?.(), 2500); }
      catch (e) { toast(e.message, 'err'); }
    }));
  }

  draw();
}
