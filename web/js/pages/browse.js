import { api } from '../api.js';
import { esc, card, $, $$ } from '../ui.js';

const KINDS = {
  movies: { title: 'Movies', sub: 'What people are watching right now.', feeds: [['trending_movies', 'Trending'], ['popular_movies', 'Popular'], ['watched_weekly', 'Most watched'], ['anticipated', 'Upcoming']] },
  series: { title: 'Series', sub: 'Shows worth starting.', feeds: [['trending_shows', 'Trending'], ['popular_shows', 'Popular']] },
};

export default async function browse(el, { kind }) {
  const k = KINDS[kind] || KINDS.movies;
  let feed = k.feeds[0][0], genre = 'All', items = [];

  async function load() {
    el.innerHTML = head() + '<div class="note">Loading…</div></div>'; bind();
    items = await api('/api/catalog/feed/' + feed).catch(() => []);
    draw();
  }
  const head = () => `<div class="page"><div class="page-head"><div><h1 class="title">${k.title}</h1><div class="sub">${k.sub}</div></div>
    <div class="seg" role="tablist">${k.feeds.map(([id, l]) => `<button data-f="${id}" class="${id === feed ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  function draw() {
    const genres = ['All', ...new Set(items.flatMap((i) => i.genres || []))].slice(0, 12);
    const list = genre === 'All' ? items : items.filter((i) => (i.genres || []).includes(genre));
    el.innerHTML = head() + `<div class="seg" style="margin-bottom:var(--s5)" role="tablist">${genres.map((g) => `<button data-g="${esc(g)}" class="${g === genre ? 'on' : ''}">${esc(g)}</button>`).join('')}</div>
      ${list.length ? `<div class="grid">${list.map((i) => card(i)).join('')}</div>` : '<div class="note">Nothing here.</div>'}</div>`;
    bind();
  }
  function bind() {
    $$('[data-f]', el).forEach((b) => (b.onclick = () => { feed = b.dataset.f; genre = 'All'; load(); }));
    $$('[data-g]', el).forEach((b) => (b.onclick = () => { genre = b.dataset.g; draw(); }));
  }
  load();
}
