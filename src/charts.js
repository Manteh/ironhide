// Live charts from TMDB (updated through the day): what's popular today, what's rising, what's genuinely new, this
// week's trending, all-time popular and what's in cinemas. Each item carries a short badge ("#3 today", "▲ up 18",
// "Out 4 days ago", "New season") and, for ranked charts, its rank. Lists are cached for 20 minutes.
import { getConfig } from './config.js';

const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const key = () => getConfig().tmdb_api_key;
const getJson = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); };
const GENRES = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action', 10765: 'Sci-Fi', 10768: 'War', 10762: 'Family', 10764: 'Reality', 10767: 'Talk', 10763: 'News', 10766: 'Soap' };
const JUNK = new Set([10763, 10764, 10766, 10767]); // news, reality, soap, talk

const cache = new Map();
const cached = async (k, fn, ttl = 20 * 60e3) => { const h = cache.get(k); if (h && Date.now() - h.at < ttl) return h.v; const v = await fn(); cache.set(k, { at: Date.now(), v }); return v; };
const ids = new Map();
const imdbOf = (kind, id) => { const k = `${kind}:${id}`; if (!ids.has(k)) ids.set(k, getJson(`${TMDB}/${kind}/${id}/external_ids?api_key=${key()}`).then((x) => x.imdb_id || '').catch(() => { ids.delete(k); return ''; })); return ids.get(k); };
const page = (url) => cached(url, async () => (await getJson(url)).results || []);
const ago = (date) => { const d = Math.round((Date.now() - Date.parse(date)) / 864e5); return d <= 0 ? 'Out today' : d === 1 ? 'Out yesterday' : d < 7 ? `Out ${d} days ago` : d < 14 ? 'Out last week' : `Out ${Math.round(d / 7)} weeks ago`; };

async function shape(list, badge) {
  const out = await Promise.all(list.map(async (x, i) => {
    const kind = x.media_type || x._kind; if (!['movie', 'tv'].includes(kind) || !x.poster_path) return null;
    if ((x.genre_ids || []).some((g) => JUNK.has(g))) return null;
    const imdbId = await imdbOf(kind, x.id); if (!imdbId) return null;
    const date = x.release_date || x.first_air_date || '';
    return {
      imdbId, type: kind === 'tv' ? 'series' : 'movie', title: x.title || x.name, year: date.slice(0, 4),
      rating: x.vote_average && x.vote_count > 20 ? x.vote_average.toFixed(1) : '', genres: [...new Set((x.genre_ids || []).map((g) => GENRES[g]).filter(Boolean))].slice(0, 2),
      overview: (x.overview || '').slice(0, 240), poster: `${IMG}/w342${x.poster_path}`, tag: badge(x, i), rank: x._rank || null, chart: true,
    };
  }));
  return out.filter(Boolean);
}
const wantType = (type) => (type === 'movie' ? ['movie'] : type === 'series' ? ['tv'] : ['movie', 'tv']);
const byGenre = (genre) => (x) => !genre || (x.genre_ids || []).some((g) => GENRES[g] === genre || (genre === 'Sci-Fi' && GENRES[g] === 'Sci-Fi'));

export const CHARTS = {
  // what people are looking at today, ranked
  async today({ type, genre, skip }) {
    const p = 1 + Math.floor(skip / 20);
    const kinds = wantType(type);
    const url = kinds.length === 2 ? `${TMDB}/trending/all/day?api_key=${key()}&page=${p}` : `${TMDB}/trending/${kinds[0]}/day?api_key=${key()}&page=${p}`;
    const list = (await page(url)).map((x, i) => ({ ...x, _kind: kinds.length === 1 ? kinds[0] : x.media_type, _rank: skip + i + 1 })).filter(byGenre(genre));
    return shape(list, (x) => `#${x._rank} today`);
  },
  // climbing fastest: today's chart vs this week's (new entries and big jumps first)
  async rising({ type, genre, skip }) {
    if (skip) return [];
    const kinds = wantType(type), seg = kinds.length === 2 ? 'all' : kinds[0];
    const [d1, d2, w1, w2, w3] = await Promise.all([1, 2].map((p) => page(`${TMDB}/trending/${seg}/day?api_key=${key()}&page=${p}`)).concat([1, 2, 3].map((p) => page(`${TMDB}/trending/${seg}/week?api_key=${key()}&page=${p}`))));
    const day = [...d1, ...d2], week = [...w1, ...w2, ...w3];
    const wRank = new Map(week.map((x, i) => [`${x.media_type || seg}:${x.id}`, i + 1]));
    const moves = day.map((x, i) => { const k = `${x.media_type || seg}:${x.id}`, wr = wRank.get(k); return { ...x, _kind: x.media_type || seg, d: i + 1, w: wr || null, jump: wr ? wr - (i + 1) : 100 - i }; })
      .filter((x) => x.jump >= 6).filter(byGenre(genre)).sort((a, b) => b.jump - a.jump).slice(0, 36);
    return shape(moves, (x) => (x.w ? `▲ up ${x.jump} places` : '▲ new in the chart'));
  },
  // genuinely new: films out (digital or cinema) in the last ~6 weeks, and series premiering or with a season airing now
  async fresh({ type, genre, skip }) {
    const p = 1 + Math.floor(skip / 20), kinds = wantType(type);
    const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 42 * 864e5).toISOString().slice(0, 10);
    const recent = new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10), premiereFrom = new Date(Date.now() - 75 * 864e5).toISOString().slice(0, 10);
    const lists = await Promise.all(kinds.map(async (kind) => {
      if (kind === 'movie') return (await page(`${TMDB}/discover/movie?api_key=${key()}&sort_by=popularity.desc&with_release_type=2|3|4&release_date.gte=${from}&release_date.lte=${today}&vote_count.gte=5&page=${p}`)).map((x) => ({ ...x, _kind: 'movie' }));
      // new series that premiered lately, and new seasons of shows from the last few years (not 25-season reruns)
      const [prem, air] = await Promise.all([
        page(`${TMDB}/discover/tv?api_key=${key()}&sort_by=popularity.desc&first_air_date.gte=${premiereFrom}&first_air_date.lte=${today}&vote_count.gte=5&page=${p}`),
        page(`${TMDB}/tv/on_the_air?api_key=${key()}&page=${p}`),
      ]);
      const seen = new Set(prem.map((x) => x.id));
      const seasons = air.filter((x) => !seen.has(x.id) && (x.first_air_date || '') >= recent && (x.vote_count || 0) > 30).map((x) => ({ ...x, _season: true }));
      return [...prem, ...seasons].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).map((x) => ({ ...x, _kind: 'tv' }));
    }));
    const merged = []; const [a = [], b = []] = lists; for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i]) merged.push(a[i]); if (b[i]) merged.push(b[i]); }
    return shape(merged.filter(byGenre(genre)), (x) => (x._kind === 'tv' ? (x._season ? 'New season' : 'New series') : (x.release_date || '') < from ? 'New on digital' : ago(x.release_date)));
  },
  async trending({ type, genre, skip }) {
    const p = 1 + Math.floor(skip / 20), kinds = wantType(type), seg = kinds.length === 2 ? 'all' : kinds[0];
    const list = (await page(`${TMDB}/trending/${seg}/week?api_key=${key()}&page=${p}`)).map((x, i) => ({ ...x, _kind: x.media_type || seg, _rank: skip + i + 1 })).filter(byGenre(genre));
    return shape(list, (x) => `#${x._rank} this week`);
  },
  async popular({ type, genre, skip }) {
    // popular titles from the last few years with real audiences (TMDB's raw "popular TV" is mostly reruns)
    const p = 1 + Math.floor(skip / 20), kinds = wantType(type), recent = new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10);
    const lists = await Promise.all(kinds.map(async (kind) => {
      const field = kind === 'tv' ? 'first_air_date' : 'primary_release_date';
      return (await page(`${TMDB}/discover/${kind}?api_key=${key()}&sort_by=popularity.desc&${field}.gte=${recent}&vote_count.gte=300&page=${p}`)).map((x) => ({ ...x, _kind: kind }));
    }));
    const merged = lists.flat().sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return shape(merged.filter(byGenre(genre)), (x) => (x.vote_average >= 7.8 ? 'Popular · loved' : 'Popular now'));
  },
  async theaters({ genre, skip }) {
    const p = 1 + Math.floor(skip / 20);
    const list = (await page(`${TMDB}/movie/now_playing?api_key=${key()}&page=${p}`)).sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).map((x) => ({ ...x, _kind: 'movie' }));
    return shape(list.filter(byGenre(genre)), (x) => (Date.now() - Date.parse(x.release_date) < 21 * 864e5 ? 'New in cinemas' : 'In cinemas'));
  },
};

export async function chart(id, { type = '', genre = '', skip = 0 } = {}) {
  if (!key() || !CHARTS[id]) return null;
  return cached(`chart:${id}:${type}:${genre}:${skip}`, () => CHARTS[id]({ type, genre, skip: Number(skip) || 0 }), 10 * 60e3);
}
