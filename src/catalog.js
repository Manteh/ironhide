// Discovery: Trakt feeds (optional client id) with a Cinemeta fallback, plus
// Cinemeta search and title metadata. Ported from the nitrate CLI.
import { getConfig } from './config.js';

const CINEMETA = 'https://v3-cinemeta.strem.io';
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

export const FEEDS = [
  // live TMDB charts (films and series together; the type switch narrows them)
  { id: 'today', label: 'Popular today', short: 'Today', kind: 'both', tmdb: true },
  { id: 'rising', label: 'Rising fast', short: 'Rising', kind: 'both', tmdb: true, single: true },
  { id: 'fresh', label: 'New releases', short: 'New', kind: 'both', tmdb: true },
  { id: 'trending', label: 'Trending this week', short: 'Trending', kind: 'both', tmdb: true },
  { id: 'popular', label: 'Popular', kind: 'both', tmdb: true },
  { id: 'theaters', label: 'In cinemas now', short: 'In cinemas', kind: 'movies', tmdb: true },
  { id: 'trending_movies', label: 'Trending', kind: 'movies', type: 'movie' },
  { id: 'popular_movies', label: 'Popular', kind: 'movies', type: 'movie' },
  { id: 'watched_weekly', label: 'Most watched this week', short: 'Most watched', kind: 'movies', type: 'movie' },
  { id: 'anticipated', label: 'Most anticipated', short: 'Upcoming', kind: 'movies', type: 'movie' },
  { id: 'boxoffice', label: 'Box office top 10', short: 'Box office', kind: 'movies', type: 'movie', noGenre: true },
  { id: 'trending_shows', label: 'Trending', kind: 'series', type: 'series' },
  // Cinemeta-backed: work for movies and series, reach much deeper than the Trakt lists
  { id: 'new', label: 'New', kind: 'both', cine: true, year: true },
  { id: 'toprated', label: 'Top rated', kind: 'both', cine: true },
  { id: 'gems', label: 'Hidden gems', kind: 'both', cine: true },
  { id: 'surprise', label: 'Surprise me', kind: 'both', cine: true, shuffle: true },
  { id: 'popular_shows', label: 'Popular', kind: 'series', type: 'series' },
];

const harvester = () => getConfig().harvester_url;
export const CINE_GENRES = ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'];

// Seeded randomness, so a shuffle is repeatable while it is cached but different next time
export const rnd = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export const shuffle = (arr, seed) => { const r = rnd(seed), a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

async function getJson(url, headers = {}, timeoutMs = 8000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const poster = (imdbId) => `https://images.metahub.space/poster/large/${imdbId}/img`;

function fromCinemeta(m, type) {
  const imdbId = m.imdb_id || m.id;
  return {
    imdbId,
    type: m.type || type,
    title: m.name,
    year: String(m.releaseInfo || m.year || '').slice(0, 4),
    rating: m.imdbRating || '',
    genres: m.genres || [],
    overview: m.description || '',
    poster: m.poster || poster(imdbId),
  };
}

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await fn();
  if (value && (!Array.isArray(value) || value.length)) cache.set(key, { at: Date.now(), value });
  return value;
}

// Feeds come from the user's Trakt harvester (a Stremio catalog addon). Render's free tier
// can take ~40s to wake, so use a long timeout, cache results and serve stale on failure.
const stale = new Map();
// One page of a Cinemeta catalog (50 titles). 'top' is by popularity, 'year' takes the year as its genre.
export async function cinemetaPage(type, cat, { genre = '', skip = 0 } = {}) {
  const extra = [genre && `genre=${encodeURIComponent(genre)}`, skip && `skip=${Number(skip)}`].filter(Boolean).join('&');
  return cached(`cine:${type}:${cat}:${extra}`, async () => {
    const d = await getJson(`${CINEMETA}/catalog/${type}/${cat}${extra ? '/' + extra : ''}.json`, {}, 15000);
    return (d.metas || []).map((m) => fromCinemeta(m, type));
  }).catch(() => []);
}
const uniq = (list) => { const seen = new Set(); return list.filter((x) => x.poster && !seen.has(x.imdbId) && seen.add(x.imdbId)); };
const rated = (list, min) => list.filter((x) => Number(x.rating) >= min);
const dayN = () => Math.floor(Date.now() / 864e5);
const PAGES = (from, n) => Array.from({ length: n }, (_, i) => from + i * 50);

async function cineFeed(id, { genre = '', skip = 0, type = 'movie', year = '', seed = 0 } = {}) {
  const t = type === 'series' ? 'series' : 'movie', g = CINE_GENRES.includes(genre) ? genre : '';
  if (id === 'new') return cinemetaPage(t, 'year', { genre: String(Number(year) || new Date().getFullYear()), skip });
  if (id === 'toprated') {
    if (skip) return []; // one long ranked list
    const pages = await Promise.all(PAGES(0, 5).map((s) => cinemetaPage(t, 'top', { genre: g, skip: s })));
    return uniq(rated(pages.flat(), 7.4)).sort((a, b) => Number(b.rating) - Number(a.rating));
  }
  if (id === 'gems') { // well rated but further down the popularity list, so not what everybody is shown
    if (skip) return [];
    const [known, pages] = await Promise.all([Promise.all(PAGES(0, 3).map((s) => cinemetaPage(t, 'top', { genre: g, skip: s }))), Promise.all(PAGES(150, 8).map((s) => cinemetaPage(t, 'top', { genre: g, skip: s })))]);
    const famous = new Set(known.flat().map((x) => x.imdbId)); // what every list already shows
    return shuffle(uniq(rated(pages.flat(), 7.3)).filter((x) => !famous.has(x.imdbId)), dayN() + Number(seed || 0)).slice(0, 60);
  }
  if (id === 'surprise') {
    if (skip) return [];
    const r = rnd(Number(seed) || Date.now()), pickG = g || CINE_GENRES[Math.floor(r() * CINE_GENRES.length)];
    const offs = shuffle(PAGES(0, 10), Math.floor(r() * 1e9)).slice(0, 3);
    const pages = await Promise.all(offs.map((s) => cinemetaPage(t, 'top', { genre: pickG, skip: s })));
    return shuffle(uniq(rated(pages.flat(), 6.6)), Math.floor(r() * 1e9)).slice(0, 48).map((x) => ({ ...x, tag: pickG }));
  }
  return [];
}

export async function getFeed(feedId, { genre = '', skip = 0, type = '', year = '', seed = 0 } = {}) {
  const feed = FEEDS.find(f => f.id === feedId);
  if (!feed) return null;
  if (feed.tmdb) { const { chart } = await import('./charts.js'); const t = type === 'all' ? '' : type; const out = await chart(feedId, { type: t, genre, skip }).catch(() => null); if (out) return out; }
  if (feed.cine) return cineFeed(feedId, { genre, skip, type, year, seed });
  const g = feed.noGenre ? '' : genre;
  const extra = [g && `genre=${encodeURIComponent(g)}`, skip && `skip=${Number(skip)}`].filter(Boolean).join('&');
  const key = `feed:${feedId}:${extra}`;
  try {
    return await cached(key, async () => {
      const url = `${harvester()}/catalog/${feed.type}/trakt_${feedId}${extra ? '/' + extra : ''}.json`;
      const data = await getJson(url, {}, 45000);
      const items = (data.metas || []).map(m => fromCinemeta(m, feed.type));
      if (items.length) stale.set(key, items);
      return items;
    });
  } catch {
    if (stale.has(key)) return stale.get(key);
    if (g || skip) return [];
    try { // last resort: Cinemeta top list
      const data = await getJson(`${CINEMETA}/catalog/${feed.type}/top.json`);
      return (data.metas || []).slice(0, 40).map(m => fromCinemeta(m, feed.type));
    } catch { return []; }
  }
}

export async function getGenres() {
  return cached('genres', async () => {
    const m = await getJson(`${harvester()}/manifest.json`, {}, 45000);
    return m.catalogs?.find(c => c.extra?.some(e => e.name === 'genre'))?.extra.find(e => e.name === 'genre')?.options || [];
  }).catch(() => []);
}

export async function search(query) {
  const q = encodeURIComponent(query);
  const [movies, series] = await Promise.all(
    ['movie', 'series'].map(t =>
      getJson(`${CINEMETA}/catalog/${t}/top/search=${q}.json`).then(d => (d.metas || []).map(m => fromCinemeta(m, t))).catch(() => []),
    ),
  );
  const ql = query.toLowerCase();
  const score = (r) => (r.title.toLowerCase() === ql ? 0 : r.title.toLowerCase().startsWith(ql) ? 1 : 2);
  return [...series.slice(0, 8), ...movies.slice(0, 8)].sort((a, b) => score(a) - score(b));
}

export async function getTitle(imdbId, type) {
  return cached(`title:${type}:${imdbId}`, async () => {
    const data = await getJson(`${CINEMETA}/meta/${type}/${imdbId}.json`);
    const m = data.meta;
    if (!m) return null;
    const base = fromCinemeta(m, type);
    const out = { ...base, runtime: m.runtime || '', cast: (m.cast || []).slice(0, 8), background: m.background || '', trailers: [...new Set([...(m.trailerStreams || []).map((t) => t.ytId), ...(m.trailers || []).map((t) => t.source)].filter((x) => /^[\w-]{11}$/.test(x || '')))].slice(0, 3) };
    if (type === 'series') {
      const seasons = {};
      for (const v of m.videos || []) {
        if (!v.season || v.season < 1) continue;
        (seasons[v.season] ||= []).push({
          episode: v.number || v.episode,
          name: v.name || v.title || '',
          released: (v.released || '').slice(0, 10),
          overview: v.overview || v.description || '',
          thumbnail: v.thumbnail || '',
        });
      }
      for (const s of Object.values(seasons)) s.sort((a, b) => a.episode - b.episode);
      out.seasons = seasons;
    }
    return out;
  });
}

// The episode that comes after this one: the next in the season, else the first of the next season, else nothing (the series ended).
// Only counts episodes that are out already.
export async function nextEpisodeAfter(imdbId, season, episode) {
  const t = await getTitle(imdbId, 'series').catch(() => null);
  if (!t?.seasons) return null;
  const out = (e) => !e.released || e.released <= new Date().toISOString().slice(0, 10);
  const find = (sn, ep) => (t.seasons[sn] || []).find((e) => e.episode === ep && out(e));
  const here = (t.seasons[season] || []).find((e) => e.episode > episode && out(e));
  if (here) return { season, episode: here.episode, name: here.name };
  const later = Object.keys(t.seasons).map(Number).filter((n) => n > season && n > 0).sort((a, b) => a - b);
  for (const sn of later) { const e = (t.seasons[sn] || []).find(out); if (e) return { season: sn, episode: e.episode, name: e.name }; }
  return null;
}
