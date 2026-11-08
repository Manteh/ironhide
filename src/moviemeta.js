// "About this title" data for the in-app player: cast with photos, details and what people think.
// Cast, details and user reviews come from TMDB (needs tmdb_api_key). Reddit threads need Reddit API credentials
// (reddit_client_id and reddit_client_secret in ~/.config/ironhide/config.json, a free "script" app from reddit.com/prefs/apps),
// because Reddit blocks anonymous requests.
import { readFileSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';
import { getPlayState } from './playstate.js';

const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const UA = 'IronHide/1.0 (personal media hub)';
const cache = new Map();

const cfg = () => { try { return JSON.parse(readFileSync(join(CONFIG_DIR, 'config.json'), 'utf8')); } catch { return {}; } };
const getJson = async (url, opts = {}) => {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
};
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

let redditToken = { value: '', exp: 0 };
async function redditAuth(c) {
  if (redditToken.value && Date.now() < redditToken.exp) return redditToken.value;
  const basic = Buffer.from(`${c.reddit_client_id}:${c.reddit_client_secret}`).toString('base64');
  const d = await getJson('https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  redditToken = { value: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000 };
  return redditToken.value;
}
async function redditThreads(c, title, year) {
  const token = await redditAuth(c);
  const h = { Authorization: `Bearer ${token}`, 'User-Agent': UA };
  const q = encodeURIComponent(`${title} ${year || ''}`.trim());
  const found = await getJson(`https://oauth.reddit.com/r/movies+television+truefilm/search?q=${q}&restrict_sr=1&sort=relevance&t=all&limit=5&type=link`, { headers: h });
  const posts = (found?.data?.children || []).map((x) => x.data).filter((p) => p.num_comments > 5).slice(0, 4);
  return Promise.all(posts.map(async (p) => {
    let comments = [];
    try {
      const t = await getJson(`https://oauth.reddit.com/comments/${p.id}?limit=3&depth=1&sort=top`, { headers: h });
      comments = (t?.[1]?.data?.children || []).map((x) => x.data).filter((x) => x.body && !x.stickied).slice(0, 2).map((x) => ({ author: x.author, score: x.score, text: clip(x.body, 320) }));
    } catch {}
    return { title: clip(p.title, 140), subreddit: p.subreddit, score: p.score, comments: p.num_comments, url: `https://www.reddit.com${p.permalink}`, top: comments };
  }));
}

export async function getInfo(imdbId) {
  if (!/^tt\d+$/.test(imdbId || '')) return { error: 'No title is playing' };
  const hit = cache.get(imdbId);
  if (hit && Date.now() - hit.at < 6 * 3600e3) return hit.data;
  const c = cfg();
  if (!c.tmdb_api_key) return { error: 'Add tmdb_api_key to the config to see details' };
  const key = `api_key=${c.tmdb_api_key}`;
  const f = await getJson(`${TMDB}/find/${imdbId}?${key}&external_source=imdb_id`);
  const kind = f.movie_results?.[0] ? 'movie' : f.tv_results?.[0] ? 'tv' : null;
  if (!kind) return { error: 'Title not found' };
  const id = (f.movie_results?.[0] || f.tv_results?.[0]).id;
  const extra = kind === 'tv' ? 'aggregate_credits,credits,reviews,recommendations,similar,content_ratings,keywords' : 'credits,reviews,recommendations,similar,release_dates,keywords';
  const [d, omdb] = await Promise.all([
    getJson(`${TMDB}/${kind}/${id}?${key}&append_to_response=${extra}`),
    c.omdb_api_key ? getJson(`https://www.omdbapi.com/?i=${imdbId}&apikey=${encodeURIComponent(c.omdb_api_key)}`).catch(() => null) : null,
  ]);
  const title = d.title || d.name || '';
  const year = (d.release_date || d.first_air_date || '').slice(0, 4);
  const img = (p, size = 'w185') => (p ? `${IMG}/${size}${p}` : '');
  // cast: series use the cast across all seasons, with how many episodes each person is in
  const castSrc = kind === 'tv' && d.aggregate_credits?.cast?.length
    ? d.aggregate_credits.cast.map((p) => ({ ...p, character: p.roles?.[0]?.character || '', episodes: p.total_episode_count || 0 }))
    : d.credits?.cast || [];
  const crew = d.credits?.crew || [];
  const people = (jobs) => [...new Set(crew.filter((p) => jobs.includes(p.job)).map((p) => p.name))].slice(0, 3);
  const cert = kind === 'tv'
    ? (d.content_ratings?.results || []).find((r) => r.iso_3166_1 === 'US')?.rating || ''
    : ((d.release_dates?.results || []).find((r) => r.iso_3166_1 === 'US')?.release_dates || []).map((x) => x.certification).find(Boolean) || '';
  // "more like this": TMDB recommendations, topped up with similar titles; the app opens titles by IMDb id, so look those up
  const recs = [...(d.recommendations?.results || []), ...(d.similar?.results || [])].filter((r, i, a) => r.poster_path && a.findIndex((x) => x.id === r.id) === i).slice(0, 14);
  const similar = (await Promise.all(recs.map(async (r) => {
    try {
      const x = await getJson(`${TMDB}/${kind}/${r.id}/external_ids?${key}`);
      if (!x.imdb_id) return null;
      return { imdbId: x.imdb_id, type: kind === 'tv' ? 'series' : 'movie', title: r.title || r.name, year: (r.release_date || r.first_air_date || '').slice(0, 4), rating: r.vote_average ? r.vote_average.toFixed(1) : '', poster: img(r.poster_path, 'w342') };
    } catch { return null; }
  }))).filter(Boolean).slice(0, 12);
  // scores from different places: TMDB always, IMDb / Rotten Tomatoes / Metacritic when an OMDb key is set
  const scores = [];
  for (const r of omdb?.Ratings || []) {
    if (/internet movie/i.test(r.Source)) scores.push({ src: 'imdb', label: 'IMDb', value: r.Value.split('/')[0], max: '10', votes: omdb.imdbVotes && omdb.imdbVotes !== 'N/A' ? omdb.imdbVotes : '' });
    else if (/rotten/i.test(r.Source)) scores.push({ src: 'rt', label: 'Rotten Tomatoes', value: r.Value, note: 'Critics' });
    else if (/metacritic/i.test(r.Source)) scores.push({ src: 'mc', label: 'Metacritic', value: r.Value.split('/')[0], max: '100' });
  }
  if (d.vote_average) scores.push({ src: 'tmdb', label: 'TMDB', value: d.vote_average.toFixed(1), max: '10', votes: d.vote_count ? d.vote_count.toLocaleString('en-US') : '' });
  const revs = (d.reviews?.results || []);
  const rated = revs.map((r) => r.author_details?.rating).filter((x) => typeof x === 'number');
  if (rated.length >= 2) scores.push({ src: 'rev', label: 'Reviewers', value: (rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(1), max: '10', votes: `${rated.length} reviews` });
  const out = {
    title, year, kind, tagline: d.tagline || '', overview: d.overview || '',
    runtime: d.runtime || d.episode_run_time?.[0] || 0, genres: (d.genres || []).map((g) => g.name),
    rating: d.vote_average ? { score: +d.vote_average.toFixed(1), votes: d.vote_count } : null,
    scores, certification: cert, awards: omdb?.Awards && omdb.Awards !== 'N/A' ? omdb.Awards : '',
    backdrop: img(d.backdrop_path, 'w1280'),
    status: d.status || '', network: (d.networks || [])[0]?.name || '', language: (d.spoken_languages || []).map((l) => l.english_name).slice(0, 3),
    seasonsCount: d.number_of_seasons || 0, episodesCount: d.number_of_episodes || 0,
    lastAir: d.last_air_date || '', nextEpisode: d.next_episode_to_air ? { season: d.next_episode_to_air.season_number, episode: d.next_episode_to_air.episode_number, date: d.next_episode_to_air.air_date } : null,
    budget: d.budget || 0, revenue: d.revenue || 0, released: d.release_date || d.first_air_date || '',
    keywords: (d.keywords?.keywords || d.keywords?.results || []).map((k) => k.name).slice(0, 10),
    directors: people(['Director']), writers: people(['Screenplay', 'Writer', 'Novel']), creators: (d.created_by || []).map((p) => p.name).slice(0, 3),
    cast: castSrc.slice(0, 18).map((p) => ({ id: p.id, name: p.name, character: p.character || '', episodes: p.episodes || 0, photo: img(p.profile_path) })),
    reviews: revs.slice(0, 6).map((r) => ({ author: r.author, avatar: r.author_details?.avatar_path && !/^\/http/.test(r.author_details.avatar_path) ? img(r.author_details.avatar_path, 'w45') : '', rating: r.author_details?.rating ?? null, date: (r.created_at || '').slice(0, 10), text: clip(r.content, 1400), url: r.url })),
    similar,
    reddit: null, redditHint: false,
  };
  if (c.reddit_client_id && c.reddit_client_secret) {
    try { out.reddit = await redditThreads(c, title, year); } catch (e) { out.redditError = String(e.message || e).replace(/\b[A-Za-z0-9_-]{20,}\b/g, '***'); }
  } else out.redditHint = true;
  cache.set(imdbId, { at: Date.now(), data: out });
  return out;
}

export const nowImdbId = () => getPlayState().imdbId || '';

// Actor / crew profile: bio, facts, photos, and everything they've been in. Credits carry TMDB ids; the app opens titles by
// IMDb id, which tmdbToImdb() looks up when one is clicked (looking up hundreds up front would be slow).
const personCache = new Map();
export async function getPerson(pid) {
  if (!/^\d+$/.test(String(pid))) return { error: 'Unknown person' };
  const hit = personCache.get(pid);
  if (hit && Date.now() - hit.at < 12 * 3600e3) return hit.data;
  const c = cfg();
  if (!c.tmdb_api_key) return { error: 'Add tmdb_api_key to the config to see people' };
  const d = await getJson(`${TMDB}/person/${pid}?api_key=${c.tmdb_api_key}&append_to_response=combined_credits,external_ids,images`);
  const img = (p, size = 'w342') => (p ? `${IMG}/${size}${p}` : '');
  const year = (x) => (x.release_date || x.first_air_date || '').slice(0, 4);
  const credit = (x, role) => ({ tmdbId: x.id, kind: x.media_type === 'tv' ? 'tv' : 'movie', title: x.title || x.name || '', year: year(x), role, episodes: x.episode_count || 0,
    rating: x.vote_count > 20 && x.vote_average ? x.vote_average.toFixed(1) : '', votes: x.vote_count || 0, popularity: x.popularity || 0, poster: img(x.poster_path, 'w185') });
  // one entry per title (a person can have several characters or jobs in one show)
  const merge = (list) => { const m = new Map(); for (const x of list) { const k = `${x.kind}:${x.tmdbId}`, p = m.get(k); if (!p) m.set(k, x); else if (x.role && !p.role.includes(x.role)) p.role = `${p.role}, ${x.role}`; } return [...m.values()]; };
  const talk = /talk|news|reality|award|oscar|golden globe|late night|tonight show|jimmy|ellen|graham norton|saturday night live|self/i;
  const cast = merge((d.combined_credits?.cast || []).filter((x) => !(x.genre_ids || []).some((g) => [10763, 10764, 10767].includes(g)) && !talk.test(x.character || '')).map((x) => credit(x, x.character || '')));
  const crew = merge((d.combined_credits?.crew || []).filter((x) => ['Directing', 'Writing', 'Production'].includes(x.department) && ['Director', 'Screenplay', 'Writer', 'Creator', 'Producer', 'Executive Producer', 'Novel'].includes(x.job)).map((x) => credit(x, x.job)));
  const byYear = (a, b) => (b.year || '9999').localeCompare(a.year || '9999');
  const knownFor = [...(d.known_for_department === 'Acting' ? cast : [...crew, ...cast])].filter((x) => x.poster && x.votes > 50 && !(x.kind === 'tv' && x.episodes > 0 && x.episodes < 3)).sort((a, b) => (b.votes * (b.kind === 'tv' ? Math.min(1, (b.episodes || 1) / 10) : 1)) - (a.votes * (a.kind === 'tv' ? Math.min(1, (a.episodes || 1) / 10) : 1))).slice(0, 12);
  const years = [...cast, ...crew].map((x) => +x.year).filter(Boolean);
  const age = (from, to) => { if (!from) return 0; const a = new Date(from), b = to ? new Date(to) : new Date(); let n = b.getFullYear() - a.getFullYear(); if (b < new Date(b.getFullYear(), a.getMonth(), a.getDate())) n--; return n; };
  const x = d.external_ids || {};
  const out = {
    id: d.id, name: d.name, photo: img(d.profile_path, 'h632'), department: d.known_for_department || '', bio: d.biography || '',
    birthday: d.birthday || '', deathday: d.deathday || '', age: age(d.birthday, d.deathday), place: d.place_of_birth || '', aka: (d.also_known_as || []).slice(0, 3),
    gender: d.gender === 1 ? 'female' : d.gender === 2 ? 'male' : '',
    photos: (d.images?.profiles || []).slice(0, 14).map((p) => img(p.file_path, 'w342')),
    links: [x.imdb_id && ['IMDb', `https://www.imdb.com/name/${x.imdb_id}/`], x.instagram_id && ['Instagram', `https://instagram.com/${x.instagram_id}`], x.twitter_id && ['X', `https://x.com/${x.twitter_id}`], x.tiktok_id && ['TikTok', `https://www.tiktok.com/@${x.tiktok_id}`], x.wikidata_id && ['Wikidata', `https://www.wikidata.org/wiki/${x.wikidata_id}`], ['TMDB', `https://www.themoviedb.org/person/${d.id}`]].filter(Boolean),
    stats: { credits: cast.length + crew.length, movies: [...cast, ...crew].filter((c) => c.kind === 'movie').length, shows: [...cast, ...crew].filter((c) => c.kind === 'tv').length, first: years.length ? Math.min(...years) : 0, last: years.length ? Math.max(...years) : 0 },
    knownFor, acting: cast.sort(byYear), crew: crew.sort(byYear),
  };
  personCache.set(pid, { at: Date.now(), data: out });
  return out;
}

const idMap = new Map();
export async function tmdbToImdb(kind, tid) {
  const k = `${kind}:${tid}`;
  if (idMap.has(k)) return idMap.get(k);
  const c = cfg();
  const x = await getJson(`${TMDB}/${kind === 'tv' ? 'tv' : 'movie'}/${tid}/external_ids?api_key=${c.tmdb_api_key}`);
  const out = { imdbId: x.imdb_id || '', type: kind === 'tv' ? 'series' : 'movie' };
  idMap.set(k, out);
  return out;
}
