// Taste Lab: quick ways to teach the recommender.
//  deck   - titles to rate: what you watched but never rated first, then well-known titles you've probably seen, then
//           titles the engine thinks you'd like (each one you rate is a strong signal).
//  skip   - "haven't seen it": never asked again.
//  duel   - "this or that" between two titles you've seen; an Elo rating per title (K=32) orders your favourites finely,
//           and feeds back into the engine (titles that keep winning count as stronger likes).
//  pair   - the next duel: two seen titles with close ratings and few duels so far (the most informative question).
//  board  - your favourites, ranked by stars and duels.
import { getConfig } from './config.js';
import { getHistory } from './history.js';
import { getWatchlist } from './settings.js';
import { loadTaste, saveTasteFile, featuresFor, invalidateRecommendations, recommend } from './recommend.js';

const TMDB = 'https://api.themoviedb.org/3';
const key = () => getConfig().tmdb_api_key;
const getJson = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); };
const card = (f, extra = {}) => f && f.imdbId ? { imdbId: f.imdbId, type: f.kind === 'tv' ? 'series' : 'movie', title: f.title, year: f.year, poster: f.poster, genres: f.genres.slice(0, 3), overview: f.overview, vote: f.vote ? f.vote.toFixed(1) : '', ...extra } : null;

export async function deck({ n = 20, seed = 0 } = {}) {
  if (!key()) return [];
  const [t, hist, shelf] = await Promise.all([loadTaste(), getHistory(5000), getWatchlist().catch(() => [])]);
  const done = new Set([...(t.ratings || []).map((r) => r.imdbId), ...(t.notInterested || []).map((x) => x.imdbId), ...(t.unseen || []), ...shelf.map((w) => w.imdbId)]);
  const out = [], have = new Set();
  const push = (c) => { if (c && !done.has(c.imdbId) && !have.has(c.imdbId)) { have.add(c.imdbId); out.push(c); } };
  // 1. watched, never rated (most valuable: you know them)
  const watched = []; const seenIds = new Set();
  for (const h of hist) if (/^tt\d+$/.test(h.imdbId) && !seenIds.has(h.imdbId) && !done.has(h.imdbId) && (h.percent || 0) > 20) { seenIds.add(h.imdbId); watched.push(h.imdbId); }
  await Promise.all(watched.slice(0, 8).map(async (id) => { try { push(card(await featuresFor({ imdbId: id }), { why: 'You watched this' })); } catch {} }));
  // 2. well-known titles across the years (likely seen), shuffled by seed
  const page = 1 + (Number(seed) % 5);
  const lists = await Promise.all([
    getJson(`${TMDB}/movie/top_rated?api_key=${key()}&page=${page}`).catch(() => ({ results: [] })),
    getJson(`${TMDB}/tv/top_rated?api_key=${key()}&page=${page}`).catch(() => ({ results: [] })),
    getJson(`${TMDB}/trending/all/week?api_key=${key()}&page=${1 + (Number(seed) % 3)}`).catch(() => ({ results: [] })),
  ]);
  const known = [...lists[0].results.map((x) => ['movie', x]), ...lists[1].results.map((x) => ['tv', x]), ...lists[2].results.filter((x) => ['movie', 'tv'].includes(x.media_type)).map((x) => [x.media_type, x])]
    .filter(([, x]) => x.poster_path && (x.vote_count || 0) > 800).sort(() => Math.random() - 0.5).slice(0, 12);
  await Promise.all(known.map(async ([kind, x]) => { try { push(card(await featuresFor({ kind, tmdbId: x.id }), { why: 'Popular. Seen it?' })); } catch {} }));
  // 3. what the engine thinks you'd like (rating these tells it whether it's right)
  try { (await recommend({ seed })).slice(0, 10).forEach((r) => push({ ...r, why: r.tag })); } catch {}
  // interleave so it's not 8 of your own titles in a row
  const a = out.filter((c) => c.why === 'You watched this'), b = out.filter((c) => c.why !== 'You watched this');
  const mixed = []; while (a.length || b.length) { if (a.length) mixed.push(a.shift()); if (b.length) mixed.push(b.shift()); if (b.length) mixed.push(b.shift()); }
  return mixed.slice(0, n);
}

export async function skip({ imdbId }) {
  if (!/^tt\d+$/.test(imdbId || '')) throw new Error('Bad id');
  const t = await loadTaste(); t.unseen = [...new Set([...(t.unseen || []), imdbId])].slice(-2000);
  await saveTasteFile(t); return { ok: true };
}

const EXPECT = (a, b) => 1 / (1 + Math.pow(10, (b - a) / 400));
export async function duel({ winner, loser, tie = false }) {
  if (![winner, loser].every((x) => /^tt\d+$/.test(x || ''))) throw new Error('Bad ids');
  const t = await loadTaste(); t.elo ||= {}; t.duels ||= [];
  const ra = t.elo[winner] ?? 1500, rb = t.elo[loser] ?? 1500, ea = EXPECT(ra, rb), sa = tie ? 0.5 : 1;
  t.elo[winner] = Math.round(ra + 32 * (sa - ea)); t.elo[loser] = Math.round(rb + 32 * ((1 - sa) - (1 - ea)));
  t.duels.push({ w: winner, l: loser, tie, at: Date.now() }); t.duels = t.duels.slice(-3000);
  await saveTasteFile(t); invalidateRecommendations();
  return { ok: true, elo: { [winner]: t.elo[winner], [loser]: t.elo[loser] } };
}

async function seenPool() {
  const [t, hist] = await Promise.all([loadTaste(), getHistory(5000)]);
  const ids = new Map(); // imdbId -> stars (0 = watched, unrated)
  for (const h of hist) if (/^tt\d+$/.test(h.imdbId) && (h.percent || 0) > 40 && !ids.has(h.imdbId)) ids.set(h.imdbId, 0);
  for (const r of t.ratings || []) ids.set(r.imdbId, r.rating);
  for (const n of t.notInterested || []) ids.delete(n.imdbId);
  return { t, ids };
}

export async function pair() {
  const { t, ids } = await seenPool();
  const pool = [...ids.entries()].filter(([, s]) => s === 0 || s >= 3).map(([id, s]) => ({ id, s, elo: t.elo?.[id] ?? 1500 + (s ? (s - 3) * 120 : 0), n: (t.duels || []).filter((d) => d.w === id || d.l === id).length }));
  if (pool.length < 2) return { error: 'Rate or watch a few more titles first' };
  pool.sort((a, b) => a.n - b.n);
  const a = pool[Math.floor(Math.random() * Math.min(6, pool.length))];
  const recent = new Set((t.duels || []).slice(-30).filter((d) => d.w === a.id || d.l === a.id).map((d) => (d.w === a.id ? d.l : d.w)));
  const b = pool.filter((x) => x.id !== a.id && !recent.has(x.id)).sort((x, y) => Math.abs(x.elo - a.elo) - Math.abs(y.elo - a.elo))[Math.floor(Math.random() * 3)] || pool.find((x) => x.id !== a.id);
  const [fa, fb] = await Promise.all([featuresFor({ imdbId: a.id }), featuresFor({ imdbId: b.id })]);
  return { a: card(fa, { stars: a.s }), b: card(fb, { stars: b.s }), duels: (t.duels || []).length };
}

export async function board() {
  const { t, ids } = await seenPool();
  const items = [...ids.entries()].filter(([, s]) => s === 0 || s >= 3).map(([id, s]) => ({ id, s, elo: t.elo?.[id] ?? 1500, n: (t.duels || []).filter((d) => d.w === id || d.l === id).length }));
  // stars set the band; duels order within it (and lift an unrated-but-winning title)
  const score = (x) => (x.s || 3) * 100 + (x.elo - 1500) / 3;
  items.sort((a, b) => score(b) - score(a));
  const top = items.slice(0, 48);
  const feats = await Promise.all(top.map((x) => featuresFor({ imdbId: x.id }).catch(() => null)));
  const dist = [1, 2, 3, 4, 5].map((s) => (t.ratings || []).filter((r) => r.rating === s).length);
  return { titles: top.map((x, i) => card(feats[i], { stars: x.s, elo: x.elo, duels: x.n })).filter(Boolean), dist, rated: (t.ratings || []).length, duels: (t.duels || []).length, skipped: (t.unseen || []).length };
}
