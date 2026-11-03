import { api, post } from '../api.js';
import { esc, card, icon, pad, posterOf, $, $$ } from '../ui.js';

export default async function library(el) {
  let tab = 'watchlist';
  const [watchlist, history] = await Promise.all([api('/api/watchlist'), api('/api/history').catch(() => [])]);

  function draw() {
    const list = tab === 'watchlist' ? watchlist : history;
    el.innerHTML = `<div class="page">
      <div class="page-head"><div><h1 class="title">Library</h1><div class="sub">Your saved titles and watch history.</div></div>
        <div class="seg" role="tablist"><button data-t="watchlist" class="${tab === 'watchlist' ? 'on' : ''}">${icon('bookmark')} Watchlist ${watchlist.length}</button>
        <button data-t="history" class="${tab === 'history' ? 'on' : ''}">${icon('refresh')} History ${history.length}</button></div></div>
      ${list.length ? `<div class="grid">${list.map((i) => tab === 'watchlist' ? card(i) : card({ imdbId: i.imdbId, type: i.type === 'tv' ? 'series' : i.type, title: i.title + (i.season ? ` S${pad(i.season)}E${pad(i.episode)}` : ''), poster: posterOf(i.imdbId), year: (i.watchedAt || '').slice(0, 10) },
        i.percent ? `<div class="prog"><i style="width:${Math.min(100, Math.round(i.percent))}%"></i></div>` : '')).join('')}</div>`
      : `<div class="note">${tab === 'watchlist' ? 'Nothing saved yet. Use “Watchlist” on any title.' : 'Nothing watched yet.'}</div>`}
    </div>`;
    $$('[data-t]', el).forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
  }
  draw();
}
