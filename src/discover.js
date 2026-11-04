// "For You": a mix that changes with the seed. Your genres, what's trending, what's new, hidden gems and something old.
// Never shows what you have already watched.
import { getFeed, cinemetaPage, CINE_GENRES, shuffle } from './catalog.js';
import { getHistory } from './history.js';
import { getWatchlist } from './settings.js';
import { tasteGenres } from './profile.js';

const good = (list, min) => list.filter((x) => x.poster && Number(x.rating) >= min);
const take = (list, n, seed, tag) => shuffle(list, seed).slice(0, n).map((x) => ({ ...x, tag }));

export async function forYou({ seed = 0 } = {}) {
  const [hist, mine, genres] = await Promise.all([getHistory(5000), getWatchlist(), tasteGenres()]);
  const done = new Set([...hist.map((h) => h.imdbId), ...mine.map((w) => w.imdbId)]);
  const year = new Date().getFullYear(), s = Number(seed) || 0, groups = [];
  const likes = (genres.length ? genres : ['Drama', 'Comedy', 'Thriller']).filter((g) => CINE_GENRES.includes(g)).slice(0, 3);
  const jobs = [
    // from your genres: a random page for each, movies and series
    ...likes.map(async (g, i) => {
      const skips = shuffle([0, 50, 100, 150, 200], s + i).slice(0, 2);
      const lists = await Promise.all(skips.flatMap((k) => ['movie', 'series'].map((t) => cinemetaPage(t, 'top', { genre: g, skip: k }))));
      return take(good(lists.flat(), 6.6), 8, s + 10 + i, `Because you like ${g}`);
    }),
    Promise.all([getFeed('trending_movies'), getFeed('trending_shows')]).then(([m, tv]) => take([...m, ...tv].slice(0, 80), 8, s + 20, 'Trending')),
    Promise.all(['movie', 'series'].map((t) => cinemetaPage(t, 'year', { genre: String(year) }))).then((l) => take(good(l.flat(), 6.4), 7, s + 30, 'New')),
    Promise.all([getFeed('gems', { type: 'movie', seed: s }), getFeed('gems', { type: 'series', seed: s })]).then(([m, tv]) => take([...m, ...tv], 7, s + 40, 'Hidden gem')),
    // something old, from a random decade
    Promise.resolve().then(async () => { const y = 1965 + Math.floor((shuffle([...Array(50).keys()], s + 50)[0])); const l = await Promise.all(['movie', 'series'].map((t) => cinemetaPage(t, 'year', { genre: String(y) }))); return take(good(l.flat(), 7.2), 5, s + 51, `From ${y}`); }),
  ];
  for (const j of jobs) groups.push(await j.catch(() => []));
  // interleave the groups so every screenful has a bit of everything
  const out = [], seen = new Set();
  for (let n = 0; n < 10; n++) for (const g of groups) { const x = g[n]; if (x && !done.has(x.imdbId) && !seen.has(x.imdbId)) { seen.add(x.imdbId); out.push(x); } }
  return out.slice(0, 48);
}
