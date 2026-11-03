import { api, post } from '../api.js';
import { store } from '../main.js';
import { $, $$, esc, icon, pad, toast, posterOf } from '../ui.js';

const CATS = [
  ['best', 'Best match'], ['premium', '4K · Remux · DV'], ['size', 'Largest'], ['seeds', 'Most seeders'], ['1080p', '1080p'], ['all', 'All'],
];

export default async function title(el, { type, id }) {
  const [meta, history, watchlist] = await Promise.all([
    api(`/api/title/${id}?type=${type}`), api('/api/history').catch(() => []), api('/api/watchlist').catch(() => []),
  ]);
  const prefs = store.settings.playback;
  const st = { season: null, episode: null, cat: 'best', streams: null, saved: watchlist.some((w) => w.imdbId === id) };

  const watched = (s, e) => history.find((h) => h.imdbId === id && h.season === s && h.episode === e);
  if (type === 'series') {
    const seasons = Object.keys(meta.seasons || {}).map(Number).sort((a, b) => a - b);
    // Default to the next episode after the last one watched, like nitrate's "Next up".
    const last = history.find((h) => h.imdbId === id && h.season);
    st.season = last ? last.season : seasons[0];
    st.episode = last ? ((last.percent || 0) >= 90 ? last.episode + 1 : last.episode) : null;
    if (st.episode && !(meta.seasons[st.season] || []).some((x) => x.episode === st.episode)) { st.season = Math.min(st.season + 1, seasons.at(-1)); st.episode = 1; }
  }

  function draw() {
    const seasons = Object.keys(meta.seasons || {}).map(Number).sort((a, b) => a - b);
    const eps = meta.seasons?.[st.season] || [];
    const q = encodeURIComponent(`${meta.title} ${meta.year}`);
    el.innerHTML = `<div class="page">
      <section class="hero">${meta.background ? `<div class="bg" style="background-image:url('${esc(meta.background)}')"></div>` : ''}
        <div class="in"><div class="poster" style="background-image:url('${esc(meta.poster || posterOf(id))}')"></div>
          <div><h1>${esc(meta.title)}</h1>
            <div class="facts">${[meta.year, meta.runtime, meta.rating && '★ ' + meta.rating].filter(Boolean).map((f) => `<span class="badge">${esc(f)}</span>`).join('')}${(meta.genres || []).slice(0, 3).map((g) => `<span class="badge acc">${esc(g)}</span>`).join('')}</div>
            <p>${esc(meta.overview)}</p>
            <div class="actions">
              <button class="btn primary" id="playBest">${icon('play')} ${type === 'series' && st.episode ? `Play S${pad(st.season)}E${pad(st.episode)}` : 'Play best match'}</button>
              <button class="btn" id="wl">${icon(st.saved ? 'check' : 'bookmark')} ${st.saved ? 'Saved' : 'Watchlist'}</button>
              <a class="btn ghost" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${q}+trailer">${icon('trailer')} Trailer</a>
              <a class="btn ghost" target="_blank" rel="noopener" href="https://www.imdb.com/title/${esc(id)}/">${icon('ext')} IMDb</a>
              <a class="btn ghost" target="_blank" rel="noopener" href="https://www.rottentomatoes.com/search?search=${q}">${icon('ext')} RT</a>
            </div></div></div></section>
      ${type === 'series' ? `<section class="section"><h2>Episodes</h2>
        <div class="seg">${seasons.map((s) => `<button data-s="${s}" class="${s === st.season ? 'on' : ''}">Season ${s}</button>`).join('')}</div>
        <div class="eps">${eps.map((e) => { const w = watched(st.season, e.episode); const done = w && (w.percent || 0) >= 90;
          return `<button class="ep ${e.episode === st.episode ? 'on' : ''}" data-e="${e.episode}"><span class="n">${e.episode}</span><span>${esc(e.name)}</span>
            <span class="d">${done ? '<span class="badge ok">Watched</span>' : w ? `<span class="badge acc">${Math.round(w.percent || 0)}%</span>` : ''}${esc(e.released)}</span></button>`; }).join('')}</div></section>` : ''}
      <section class="section" id="streams"></section></div>`;

    $('#wl').onclick = async () => { const r = await post('/api/watchlist/toggle', { imdbId: id, type, title: meta.title, year: meta.year, poster: meta.poster, rating: meta.rating }); st.saved = r.saved; toast(r.saved ? 'Added to watchlist' : 'Removed from watchlist', 'ok'); draw(); };
    $('#playBest').onclick = () => playBest();
    $$('[data-s]', el).forEach((b) => (b.onclick = () => { st.season = +b.dataset.s; st.episode = null; st.streams = null; draw(); }));
    $$('[data-e]', el).forEach((b) => (b.onclick = () => { st.episode = +b.dataset.e; st.streams = null; draw(); loadStreams(); }));
    renderStreams();
  }

  async function loadStreams() {
    if (type === 'series' && !st.episode) return;
    const box = $('#streams'); box.innerHTML = '<div class="note">Searching for streams…</div>';
    const qs = new URLSearchParams({ imdbId: id, type, title: meta.title });
    if (type === 'series') { qs.set('season', st.season); qs.set('episode', st.episode); }
    try { st.streams = await api('/api/streams?' + qs); } catch (e) { st.streams = []; toast(e.message, 'err'); }
    renderStreams();
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

  function renderStreams() {
    const box = $('#streams'); if (!box) return;
    if (type === 'series' && !st.episode) { box.innerHTML = '<div class="note">Pick an episode to see streams.</div>'; return; }
    if (!st.streams) { loadStreams(); return; }
    const list = view(st.streams).slice(0, 30);
    box.innerHTML = `<div class="streams-head"><h2 style="margin:0">Streams <span class="muted" style="font-weight:400">${st.streams.length}</span></h2>
</div>
      <div class="seg" style="margin-bottom:12px">${CATS.map(([k, l]) => `<button data-c="${k}" class="${st.cat === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${list.length ? list.map((s) => `<div class="stream ${s.best ? 'best' : ''}"><div class="res">${esc(s.resolution || '—')}</div>
        <div><div class="line">${s.best ? '<span class="badge acc">Best match</span>' : ''}${s.cached ? '<span class="badge ok">' + icon('bolt') + ' Cached</span>' : '<span class="badge warn">Download</span>'}
          ${s.tags.map((t) => `<span class="badge ${t.toLowerCase()}">${t}</span>`).join('')}<span class="muted">${esc(s.size)} · ↑${s.seeds}</span></div>
          <div class="q" title="${esc(s.quality)}">${esc(s.quality)}</div></div>
        <div class="acts"><button class="btn primary" data-p="${s.index}">${icon('play')} Play</button></div></div>`).join('') : '<div class="note">No streams for this filter.</div>'}`;
    $$('[data-c]', box).forEach((b) => (b.onclick = () => { st.cat = b.dataset.c; renderStreams(); }));
    $$('[data-p]', box).forEach((b) => (b.onclick = () => play(+b.dataset.p)));
  }

  async function play(index) {
    try {
      const r = await post('/api/play', { index });
      toast((r.content?.[0]?.text || 'Started').split('\n')[0].slice(0, 100), 'ok');
      setTimeout(() => window.pollRemote?.(), 2500);
    } catch (e) { toast(e.message, 'err'); }
  }
  async function playBest() {
    if (type === 'series' && !st.episode) { toast('Pick an episode first', ''); return $('.eps')?.scrollIntoView({ behavior: 'smooth' }); }
    if (!st.streams) await loadStreams();
    const best = st.streams?.find((s) => s.best) || st.streams?.[0];
    best ? play(best.index) : toast('No streams found', 'err');
  }

  draw();
  if (type === 'movie' || st.episode) loadStreams();
}
