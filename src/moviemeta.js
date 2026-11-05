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
  const d = await getJson(`${TMDB}/${kind}/${id}?${key}&append_to_response=credits,reviews`);
  const title = d.title || d.name || '';
  const year = (d.release_date || d.first_air_date || '').slice(0, 4);
  const out = {
    title, year, kind, tagline: d.tagline || '', overview: d.overview || '',
    runtime: d.runtime || d.episode_run_time?.[0] || 0, genres: (d.genres || []).map((g) => g.name),
    rating: d.vote_average ? { score: +d.vote_average.toFixed(1), votes: d.vote_count } : null,
    directors: (d.credits?.crew || []).filter((p) => p.job === 'Director').map((p) => p.name).slice(0, 3),
    cast: (d.credits?.cast || []).slice(0, 14).map((p) => ({ name: p.name, character: p.character || '', photo: p.profile_path ? `${IMG}/w185${p.profile_path}` : '' })),
    reviews: (d.reviews?.results || []).slice(0, 5).map((r) => ({ author: r.author, rating: r.author_details?.rating ?? null, text: clip(r.content, 520), url: r.url })),
    reddit: null, redditHint: false,
  };
  if (c.reddit_client_id && c.reddit_client_secret) {
    try { out.reddit = await redditThreads(c, title, year); } catch (e) { out.redditError = String(e.message || e).replace(/\b[A-Za-z0-9_-]{20,}\b/g, '***'); }
  } else out.redditHint = true;
  cache.set(imdbId, { at: Date.now(), data: out });
  return out;
}

export const nowImdbId = () => getPlayState().imdbId || '';
