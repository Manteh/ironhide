import { api } from '../api.js';
import { store, quickPlay } from '../main.js';
import { esc, card, icon, pad, posterOf, wl, $, $$ } from '../ui.js';

// Mirrors nitrate's Resume tab: finished episodes become "Next up", partial ones resume.
export function continueItems(history) {
  const seen = new Set(), out = [];
  for (const h of history) {
    if (seen.has(h.imdbId)) continue; seen.add(h.imdbId);
    const pct = h.percent || 0, tv = h.type === 'tv' || h.type === 'series';
    if (tv && pct >= 90) out.push({ imdbId: h.imdbId, type: 'series', title: h.title, season: h.season, episode: h.episode + 1, label: `Next up · S${pad(h.season)}E${pad(h.episode + 1)}`, pct: 0 });
    else if (pct > 3 && pct < 90) out.push({ imdbId: h.imdbId, type: tv ? 'series' : 'movie', title: h.title, season: h.season, episode: h.episode, label: tv ? `S${pad(h.season)}E${pad(h.episode)} · ${Math.round(pct)}% watched` : `${Math.round(pct)}% watched`, pct });
  }
  return out.slice(0, 6);
}

export default async function home(el) {
  const cont = continueItems(store.history);
  const [movies, shows] = await Promise.all([api('/api/catalog/feed/trending_movies'), api('/api/catalog/feed/trending_shows')]);
  const watchlist = await api('/api/watchlist').catch(() => []);
  const pick = cont[0] ? { ...cont[0], kicker: cont[0].pct ? 'Continue watching' : 'Next up' } : movies[0] && { ...movies[0], kicker: 'Trending now' };
  const meta = pick ? await api(`/api/title/${pick.imdbId}?type=${pick.type === 'series' ? 'series' : 'movie'}`).catch(() => null) : null;

  el.innerHTML = `<div class="page">
    ${pick ? `<section class="feature" data-id="${esc(pick.imdbId)}" data-type="${esc(pick.type)}" data-title="${esc(pick.title)}" data-year="${esc(meta?.year || '')}" data-poster="${esc(meta?.poster || '')}" data-rating="${esc(meta?.rating || '')}">
      <div class="bg" style="background-image:url('${esc(meta?.background || meta?.poster || posterOf(pick.imdbId))}')"></div>
      <div class="in"><div class="kicker">${icon('bolt')} ${esc(pick.kicker)}${pick.label ? ' · ' + esc(pick.label) : ''}</div>
        <h1>${esc(pick.title)}</h1><p>${esc(meta?.overview || '')}</p>
        <div class="row"><button class="btn primary" data-qp ${pick.season ? `data-season="${pick.season}" data-episode="${pick.episode}"` : ''}>${icon('play')} Play</button>
          <a class="btn" href="#/title/${esc(pick.type)}/${esc(pick.imdbId)}">Details</a>
          <button class="btn ghost" data-wl>${icon('bookmark')} Watchlist</button></div></div></section>` : ''}
    ${cont.length > 1 ? `<section class="section"><div class="sec-head"><h2>Continue watching</h2></div><div class="conts">${cont.map((c) => `
      <div class="cont" data-id="${esc(c.imdbId)}" data-type="${esc(c.type)}" data-title="${esc(c.title)}">
        <a class="th" href="#/title/${esc(c.type)}/${esc(c.imdbId)}" style="background-image:url('${posterOf(c.imdbId)}')" aria-label="${esc(c.title)}"></a>
        <div class="tx"><b>${esc(c.title)}</b><small>${esc(c.label)}</small>${c.pct ? `<div class="bar"><i style="width:${Math.round(c.pct)}%"></i></div>` : ''}</div>
        <button class="go" data-qp ${c.season ? `data-season="${c.season}" data-episode="${c.episode}"` : ''} aria-label="Play">${icon('play')}</button></div>`).join('')}</div></section>` : ''}
    <section class="section"><div class="sec-head"><h2>Trending movies</h2><a class="link" href="#/browse/movies">See all</a></div><div class="grid">${movies.slice(0, 12).map((i) => card(i)).join('')}</div></section>
    <section class="section"><div class="sec-head"><h2>Trending series</h2><a class="link" href="#/browse/series">See all</a></div><div class="grid">${shows.slice(0, 12).map((i) => card(i)).join('')}</div></section>
    ${watchlist.length ? `<section class="section"><div class="sec-head"><h2>Your watchlist</h2><a class="link" href="#/library">See all</a></div><div class="grid">${watchlist.slice(0, 8).map((i) => card(i)).join('')}</div></section>` : ''}
  </div>`;
}
