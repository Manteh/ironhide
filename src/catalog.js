// Discovery: Trakt feeds (optional client id) with a Cinemeta fallback, plus
// Cinemeta search and title metadata. Ported from the nitrate CLI.
import { getConfig } from './config.js';

const CINEMETA = 'https://v3-cinemeta.strem.io';
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

export const FEEDS = [
  { id: 'trending_movies', label: 'Trending', kind: 'movies', type: 'movie' },
  { id: 'popular_movies', label: 'Popular', kind: 'movies', type: 'movie' },
  { id: 'watched_weekly', label: 'Most watched this week', short: 'Most watched', kind: 'movies', type: 'movie' },
  { id: 'anticipated', label: 'Most anticipated', short: 'Upcoming', kind: 'movies', type: 'movie' },
  { id: 'boxoffice', label: 'Box office top 10', short: 'Box office', kind: 'movies', type: 'movie', noGenre: true },
  { id: 'trending_shows', label: 'Trending', kind: 'series', type: 'series' },
  { id: 'popular_shows', label: 'Popular', kind: 'series', type: 'series' },
];

const harvester = () => getConfig().harvester_url;

async function getJson(url, headers = {}, timeoutMs = 8000) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const poster = (imdbId) => `https://images.metahub.space/poster/medium/${imdbId}/img`;

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
export async function getFeed(feedId, { genre = '', skip = 0 } = {}) {
  const feed = FEEDS.find(f => f.id === feedId);
  if (!feed) return null;
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
    const out = { ...base, runtime: m.runtime || '', cast: (m.cast || []).slice(0, 8), background: m.background || '' };
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
