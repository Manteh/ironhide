// Discovery: Trakt feeds (optional client id) with a Cinemeta fallback, plus
// Cinemeta search and title metadata. Ported from the nitrate CLI.
import { getConfig } from './config.js';

const CINEMETA = 'https://v3-cinemeta.strem.io';
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const traktClientId = () => getConfig().trakt_client_id;

export const FEEDS = [
  { id: 'trending_movies', label: 'Movies', type: 'movie', trakt: '/movies/trending' },
  { id: 'trending_shows', label: 'Series', type: 'series', trakt: '/shows/trending' },
  { id: 'popular_movies', label: 'Popular', type: 'movie', trakt: '/movies/popular' },
  { id: 'popular_shows', label: 'TV Hits', type: 'series', trakt: '/shows/popular' },
  { id: 'watched_weekly', label: 'Trending', type: 'movie', trakt: '/movies/watched/weekly' },
  { id: 'anticipated', label: 'Upcoming', type: 'movie', trakt: '/movies/anticipated' },
];

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

function fromTrakt(entry, type) {
  const media = entry.movie || entry.show || entry;
  const imdbId = media.ids?.imdb;
  if (!imdbId) return null;
  return {
    imdbId,
    type,
    title: media.title,
    year: media.year ? String(media.year) : '',
    rating: media.rating ? media.rating.toFixed(1) : '',
    genres: (media.genres || []).map(g => g[0].toUpperCase() + g.slice(1)),
    overview: media.overview || '',
    poster: poster(imdbId),
  };
}

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await fn();
  if (value && (!Array.isArray(value) || value.length)) cache.set(key, { at: Date.now(), value });
  return value;
}

export async function getFeed(feedId) {
  const feed = FEEDS.find(f => f.id === feedId);
  if (!feed) return null;
  return cached(`feed:${feedId}`, async () => {
    const clientId = traktClientId();
    if (clientId) {
      try {
        const raw = await getJson(
          `https://api.trakt.tv${feed.trakt}?extended=full&limit=40`,
          { 'trakt-api-key': clientId, 'trakt-api-version': '2' },
        );
        const items = raw.map(e => fromTrakt(e, feed.type)).filter(Boolean);
        if (items.length) return items;
      } catch { /* fall through to Cinemeta */ }
    }
    try {
      const data = await getJson(`${CINEMETA}/catalog/${feed.type}/top.json`);
      return (data.metas || []).slice(0, 40).map(m => fromCinemeta(m, feed.type));
    } catch {
      return [];
    }
  });
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
