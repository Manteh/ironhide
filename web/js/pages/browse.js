import { api } from '../api.js';
import { esc, card, $, $$ } from '../ui.js';

const KIND = { movies: 'Movies', series: 'Series' };

export default async function browse(el, { kind, feed: wanted }) {
  const { feeds, genres } = await api('/api/catalog/feeds');
  const mine = feeds.filter((f) => f.kind === (kind === 'series' ? 'series' : 'movies'));
  let feed = mine.find((f) => f.id === wanted) || mine[0], genre = '', items = [], more = false, busy = false;

  const shell = () => `<div class="page"><div class="page-head"><div><h1 class="title">${KIND[kind] || 'Movies'}</h1><div class="sub">${esc(feed.label)}</div></div></div>
    <div class="seg" style="margin-bottom:var(--s4)" role="tablist">${mine.map((f) => `<button data-f="${f.id}" class="${f.id === feed.id ? 'on' : ''}">${esc(f.short)}</button>`).join('')}</div>
    ${feed.noGenre ? '' : `<div class="chips" role="tablist"><button data-g="" class="${genre === '' ? 'on' : ''}">All genres</button>${genres.map((g) => `<button data-g="${esc(g)}" class="${g === genre ? 'on' : ''}">${esc(g)}</button>`).join('')}</div>`}
    <div id="out"></div></div>`;

  function paint(loading) {
    const out = $('#out', el); if (!out) return;
    out.innerHTML = (items.length ? `<div class="grid">${items.map((i) => card(i)).join('')}</div>` : loading ? '' : '<div class="note">Nothing here.</div>')
      + (loading ? '<div class="note" id="hint">Loading…</div>' : more ? '<div style="text-align:center;margin-top:var(--s7)"><button class="btn" id="more">Load more</button></div>' : '');
    if (loading) setTimeout(() => { const h = $('#hint', el); if (h) h.textContent = 'Waking up the catalog service. The first load can take up to a minute…'; }, 6000);
    $('#more', el)?.addEventListener('click', () => load(false));
  }

  async function load(reset) {
    if (busy) return; busy = true;
    if (reset) items = [];
    paint(true);
    const qs = new URLSearchParams();
    if (genre) qs.set('genre', genre);
    if (!reset && items.length) qs.set('skip', items.length);
    const got = await api(`/api/catalog/feed/${feed.id}?${qs}`).catch(() => []);
    const seen = new Set(items.map((i) => i.imdbId));
    const fresh = got.filter((i) => !seen.has(i.imdbId));
    items = [...items, ...fresh]; more = !feed.noGenre && fresh.length >= 10; busy = false;
    paint(false);
  }

  function bind() {
    $$('[data-f]', el).forEach((b) => (b.onclick = () => {
      feed = mine.find((f) => f.id === b.dataset.f); genre = '';
      history.replaceState(null, '', `#/browse/${kind}/${feed.id}`);
      el.innerHTML = shell(); bind(); load(true);
    }));
    $$('[data-g]', el).forEach((b) => (b.onclick = () => {
      genre = b.dataset.g; $$('[data-g]', el).forEach((x) => x.classList.toggle('on', x === b)); load(true);
    }));
  }
  el.innerHTML = shell(); bind(); load(true);
}
