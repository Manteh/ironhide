import { TMDB_API_KEY as API_KEY } from './config.js';
const BASE = 'https://api.themoviedb.org/3';

export async function searchMedia(query, type = 'movie') {
  const endpoint = type === 'tv' ? 'search/tv' : 'search/movie';
  const res = await fetch(`${BASE}/${endpoint}?api_key=${API_KEY}&query=${encodeURIComponent(query)}`);
  const data = await res.json();

  if (!data.results || data.results.length === 0) return [];

  return data.results.slice(0, 10).map(r => ({
    id: r.id,
    title: r.title || r.name,
    year: (r.release_date || r.first_air_date || '').slice(0, 4),
    rating: r.vote_average?.toFixed(1) || 'N/A',
    overview: r.overview?.slice(0, 100) || '',
  }));
}

export async function getImdbId(tmdbId, type = 'movie') {
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const res = await fetch(`${BASE}/${mediaType}/${tmdbId}/external_ids?api_key=${API_KEY}`);
  const data = await res.json();
  return data.imdb_id || null;
}

export async function getLatestEpisode(tmdbId) {
  const res = await fetch(`${BASE}/tv/${tmdbId}?api_key=${API_KEY}`);
  const data = await res.json();
  const ep = data.last_episode_to_air;
  if (!ep) return null;
  return {
    season: ep.season_number,
    episode: ep.episode_number,
    name: ep.name,
    airDate: ep.air_date,
    overview: ep.overview?.slice(0, 100) || '',
  };
}
