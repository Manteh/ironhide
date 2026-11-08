// Recommendation engine: learns your taste from what you watch and rate, and picks what to show in "For You".
//
// 1. Signals -> a weight per title (-1.5 .. +1.5):
//      explicit rating (1-5 stars) is strongest; then how much you watched (finished film, episodes of a series, dropped
//      early); your shelf; "not for me". Older signals fade (half-life ~6 months).
// 2. Profile: every title has features (genres, themes/keywords, cast, directors/creators, language, decade, film/series).
//    Each feature collects the weights of the titles that have it, shrunk toward 0 when there are few (so one title can't
//    dominate). Result: a score per feature, positive = you like it.
// 3. Candidates: TMDB "people who liked X also liked" for your best titles, top titles in your strongest genres, trending.
// 4. Score = taste match + how many of your favourites point to it + rating quality (Bayesian) + freshness, with a light
//    seeded shuffle; the best ~60 are re-scored with their full cast/themes; then mixed for variety (no long runs of one
//    genre or one source). Every pick carries a match % and a reason.
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { CONFIG_DIR, getConfig } from './config.js';
import { getHistory } from './history.js';
import { getWatchlist } from './settings.js';

const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const TASTE_FILE = join(CONFIG_DIR, 'taste.json');
const FEAT_FILE = join(CONFIG_DIR, 'features.json');
const key = () => getConfig().tmdb_api_key;
const getJson = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); };
const DAY = 864e5;

// ---------- storage ----------
async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }
async function writeJson(file, data) { await mkdir(CONFIG_DIR, { recursive: true }); await writeFile(file, JSON.stringify(data)); }
export const loadTaste = () => readJson(TASTE_FILE, { ratings: [], preferences: {} });
const saveTaste = (t) => writeJson(TASTE_FILE, t);
export const saveTasteFile = saveTaste;

// ---------- features of one title (cached on disk: they don't change) ----------
let feats = null, featsDirty = false, featsTimer = 0;
async function featStore() { if (!feats) feats = await readJson(FEAT_FILE, {}); return feats; }
function persistFeats() { featsDirty = true; clearTimeout(featsTimer); featsTimer = setTimeout(() => { if (featsDirty) { featsDirty = false; writeJson(FEAT_FILE, feats).catch(() => {}); } }, 1500); }

const GENRE_IDS = { 28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics' };
// TV and film genre names that mean the same thing
const CANON = { 'Sci-Fi & Fantasy': ['Science Fiction', 'Fantasy'], 'Action & Adventure': ['Action', 'Adventure'], 'War & Politics': ['War'] };
const canonGenres = (names) => [...new Set(names.flatMap((g) => CANON[g] || [g]))];

function featuresFrom(d, kind) {
  const crew = d.credits?.crew || [];
  const cast = (kind === 'tv' && d.aggregate_credits?.cast?.length ? d.aggregate_credits.cast : d.credits?.cast || []).slice(0, 6).map((p) => p.name);
  const makers = kind === 'tv' ? (d.created_by || []).map((p) => p.name) : crew.filter((p) => p.job === 'Director').map((p) => p.name);
  const date = d.release_date || d.first_air_date || '';
  return {
    tmdbId: d.id, kind, title: d.title || d.name || '', year: date.slice(0, 4),
    genres: canonGenres((d.genres || []).map((g) => g.name)),
    keywords: (d.keywords?.keywords || d.keywords?.results || []).slice(0, 14).map((k) => k.name),
    cast, makers: makers.slice(0, 3), lang: d.original_language || '',
    vote: d.vote_average || 0, votes: d.vote_count || 0, poster: d.poster_path ? `${IMG}/w342${d.poster_path}` : '',
    collection: d.belongs_to_collection?.id || null, date,
    overview: (d.overview || '').slice(0, 300), recs: (d.recommendations?.results || []).slice(0, 20).map((r) => ({ id: r.id, kind })),
  };
}

// by IMDb id (titles you watched) -- finds the TMDB id first
async function featuresByImdb(imdbId) {
  const st = await featStore();
  if (st[imdbId] && Date.now() - (st[imdbId].at || 0) < 30 * DAY) return st[imdbId];
  const f = await getJson(`${TMDB}/find/${imdbId}?api_key=${key()}&external_source=imdb_id`);
  const kind = f.movie_results?.[0] ? 'movie' : f.tv_results?.[0] ? 'tv' : null;
  if (!kind) return null;
  const id = (f.movie_results?.[0] || f.tv_results?.[0]).id;
  const d = await getJson(`${TMDB}/${kind}/${id}?api_key=${key()}&append_to_response=${kind === 'tv' ? 'aggregate_credits,' : ''}credits,keywords,recommendations`);
  const out = { ...featuresFrom(d, kind), imdbId, at: Date.now() };
  st[imdbId] = out; persistFeats();
  return out;
}
// by TMDB id (candidates) -- also learns the IMDb id the app needs
async function featuresByTmdb(kind, id) {
  const st = await featStore(), k = `tmdb:${kind}:${id}`;
  if (st[k] && Date.now() - (st[k].at || 0) < 30 * DAY) return st[k];
  const d = await getJson(`${TMDB}/${kind}/${id}?api_key=${key()}&append_to_response=${kind === 'tv' ? 'aggregate_credits,' : ''}credits,keywords,external_ids`);
  const out = { ...featuresFrom(d, kind), imdbId: d.external_ids?.imdb_id || d.imdb_id || '', at: Date.now() };
  st[k] = out; persistFeats();
  return out;
}

export const featuresFor = ({ imdbId, kind, tmdbId }) => (imdbId ? featuresByImdb(imdbId) : featuresByTmdb(kind, tmdbId));

const featureKeys = (f) => [
  ...f.genres.map((g) => `g:${g}`),
  ...(f.keywords || []).map((k) => `k:${k}`),
  ...(f.cast || []).map((p) => `p:${p}`),
  ...(f.makers || []).map((p) => `m:${p}`),
  f.lang && `l:${f.lang}`,
  f.year && `d:${Math.floor(+f.year / 10) * 10}s`,
  `t:${f.kind}`,
].filter(Boolean);
// how much each kind of feature counts toward a match
const KIND_W = { g: 1, k: 0.55, p: 0.8, m: 1.1, l: 0.6, d: 0.35, t: 0.5 };

// ---------- 1. signals ----------
function watchWeight(entries, now) {
  // entries: all history rows for one title (episodes for a series)
  const latest = Math.max(...entries.map((e) => Date.parse(e.watchedAt || e.at || e.date || 0) || 0)) || now;
  const isTv = entries.some((e) => e.season);
  if (isTv) {
    const eps = new Set(entries.filter((e) => (e.percent || 0) >= 60).map((e) => `${e.season}x${e.episode}`)).size;
    if (eps === 0) { const p = Math.max(...entries.map((e) => e.percent || 0)); return { w: p < 30 && now - latest > 3 * DAY ? -0.3 : 0.05, latest, eps }; }
    return { w: Math.min(1.1, 0.25 + 0.11 * eps), latest, eps };
  }
  const p = Math.max(...entries.map((e) => e.percent || 0));
  if (p >= 85) return { w: 0.65, latest };
  if (p >= 40) return { w: 0.35, latest };
  if (p < 15 && now - latest > 2 * DAY) return { w: -0.35, latest };
  return { w: 0.08, latest };
}

async function signals() {
  const [hist, shelf, taste] = await Promise.all([getHistory(5000), getWatchlist().catch(() => []), loadTaste()]);
  const now = Date.now(), byId = new Map();
  for (const h of hist) { if (!/^tt\d+$/.test(h.imdbId || '')) continue; (byId.get(h.imdbId) || byId.set(h.imdbId, []).get(h.imdbId)).push(h); }
  const sig = new Map(); // imdbId -> { w, why, title }
  for (const [id, rows] of byId) { const r = watchWeight(rows, now); sig.set(id, { w: r.w, latest: r.latest, eps: r.eps, title: rows[0].title, watched: true }); }
  // Stars are read against your own scale: someone who gives most things 5 means "meh" by 3. Half absolute (3 is the
  // middle of the scale), half relative to your average and spread.
  const rs = (taste.ratings || []).map((r) => r.rating);
  const mean = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 3;
  const sd = rs.length > 4 ? Math.max(0.7, Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length)) : 1;
  const starW = (r) => { const abs = 1.5 * ((r - 3) / 2), rel = Math.max(-1.5, Math.min(1.5, ((r - mean) / sd) * 0.75)); return rs.length > 4 ? 0.5 * abs + 0.5 * rel : abs; };
  for (const r of taste.ratings || []) {
    const s = sig.get(r.imdbId) || { w: 0, latest: Date.parse(r.ratedAt) || now, title: r.title };
    s.rating = r.rating; s.w = 1.5 * starW(r.rating) + 0.25 * s.w; s.latest = Math.max(s.latest || 0, Date.parse(r.ratedAt) || 0);
    sig.set(r.imdbId, s);
  }
  for (const w of shelf) { if (!sig.has(w.imdbId)) sig.set(w.imdbId, { w: 0.3, latest: Date.parse(w.addedAt || 0) || now, title: w.title, saved: true }); }
  for (const n of taste.notInterested || []) sig.set(n.imdbId, { w: -1.2, latest: Date.parse(n.at) || now, title: n.title, nope: true });
  // head-to-head results (Taste Lab): titles that keep winning count as stronger likes, losers weaker
  for (const [id, elo] of Object.entries(taste.elo || {})) { const s = sig.get(id); if (s && !s.nope) s.w += Math.max(-0.5, Math.min(0.5, (elo - 1500) / 300)) * 0.6; }
  // fade with age: half-life ~6 months, never below a third
  for (const s of sig.values()) s.w *= Math.max(0.35, Math.pow(0.5, (now - (s.latest || now)) / (180 * DAY)));
  return { sig, taste, hist, shelf };
}

// ---------- 2. profile ----------
let lastProf = null, lastIdf = { idf: new Map(), maxIdf: 1 }; // the most recent profile, for cheap taste hints (search ranking)
export function tasteHint(genreNames = [], lang = '') { if (!lastProf) return 0; let s = 0; for (const g of canonGenres(genreNames)) s += lastProf.get(`g:${g}`) || 0; if (lang) s += (lastProf.get(`l:${lang}`) || 0) * 0.5; return s; }
export const GENRES = GENRE_IDS;
export { canonGenres };
export async function warmProfile() { if (!lastProf) await buildProfile().catch(() => {}); }
async function buildProfile() {
  const { sig, taste, hist, shelf } = await signals();
  const ids = [...sig.keys()].sort((a, b) => Math.abs(sig.get(b).w) - Math.abs(sig.get(a).w)).slice(0, 80);
  const titleFeats = new Map();
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(ids.slice(i, i + 8).map(async (id) => { try { const f = await featuresByImdb(id); if (f) titleFeats.set(id, f); } catch {} }));
  }
  const acc = new Map(); // feature -> { sum, n, pos }
  for (const [id, f] of titleFeats) {
    const w = sig.get(id).w;
    for (const k of featureKeys(f)) { const a = acc.get(k) || { sum: 0, n: 0, pos: 0 }; a.sum += w; a.n++; if (w > 0.3) a.pos++; acc.set(k, a); }
  }
  // how distinctive a feature is: "Drama" is on half of everything, "folk horror" isn't (inverse document frequency)
  const N = titleFeats.size || 1, idf = new Map();
  for (const [k, a] of acc) idf.set(k, Math.log((N + 1) / (a.n + 1)) + 1);
  const maxIdf = Math.max(1, ...idf.values());
  const prof = new Map();
  for (const [k, a] of acc) {
    // genres and form settle quickly; themes and people need repeated evidence (one show's voice cast is not a taste)
    const shrink = 'gtld'.includes(k[0]) ? 1.5 : a.pos >= 2 ? 2.5 : 6;
    prof.set(k, a.sum / (a.n + shrink));
  }
  lastProf = prof; lastIdf = { idf, maxIdf };
  return { prof, sig, titleFeats, taste, hist, shelf, acc };
}

function affinity(prof, f) {
  let s = 0, wsum = 0, best = null;
  for (const k of featureKeys(f)) {
    const id = lastIdf.idf.get(k), rare = id ? 0.55 + 0.9 * (id / lastIdf.maxIdf) : 1;
    const kw = (KIND_W[k[0]] || 0.5) * rare, v = prof.get(k) || 0;
    s += v * kw; wsum += kw;
    if (v > 0.12 && (!best || v * kw > best.v)) best = { k, v: v * kw };
  }
  return { a: wsum ? s / Math.sqrt(wsum) : 0, best };
}
const bayes = (vote, votes) => (votes * vote + 300 * 6.6) / (votes + 300); // pulls few-vote ratings toward the average

// ---------- 3/4. candidates and scoring ----------
async function listPage(url) { try { return (await getJson(url)).results || []; } catch { return []; } }
const rnd = (seed) => { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

let cache = { at: 0, seed: null, out: null, sections: null };

// what you were shown and what you opened: picks you keep scrolling past sink, ones you open rise
const STATS_FILE = join(CONFIG_DIR, 'recstats.json');
let recStats = null;
async function stats() { if (!recStats) recStats = await readJson(STATS_FILE, {}); return recStats; }
const saveStats = () => writeJson(STATS_FILE, recStats).catch(() => {});
export async function noteOpened(imdbId) { const st = await stats(); const x = st[imdbId] || (st[imdbId] = { shown: 0, opened: 0 }); x.opened++; x.at = Date.now(); saveStats(); }
async function noteShown(ids) { const st = await stats(), now = Date.now(); for (const id of ids) { const x = st[id] || (st[id] = { shown: 0, opened: 0 }); if (!x.lastShown || now - x.lastShown > 6 * 3600e3) { x.shown++; x.lastShown = now; } } saveStats(); }

// franchise key: a movie collection, or a two-word phrase shared with a title you know ("walking dead", "star wars")
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'tales', 'fear', 'from', 'in', 'to', 'part', 'season', 'movie', 'film', 'ii', 'iii', 'vol']);
const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w));
const bigrams = (t) => { const w = words(t); const out = []; for (let i = 0; i < w.length - 1; i++) out.push(`${w[i]} ${w[i + 1]}`); if (w.length === 1) out.push(w[0]); return out; };

export async function recommend({ seed = 0, limit = 48 } = {}) {
  if (!key()) return [];
  if (cache.out && cache.seed === seed && Date.now() - cache.at < 10 * 60e3) return cache.out;
  const { prof, sig, titleFeats } = await buildProfile();
  const R = rnd(Number(seed) + 7), st = await stats();
  const exclude = new Set([...sig.keys()]);
  const seen = new Set([...titleFeats.values()].map((f) => `${f.kind}:${f.tmdbId}`));
  const today = new Date().toISOString().slice(0, 10), thisYear = new Date().getFullYear();
  const knownBigrams = new Set([...titleFeats.values()].flatMap((f) => bigrams(f.title)));

  // sources: favourites' "people also liked" (weighted by how much you liked them), your strongest genres, trending,
  // and a discovery pool of acclaimed titles outside your usual genres
  const favs = [...titleFeats.entries()].filter(([id]) => sig.get(id).w > 0.35).sort((a, b) => sig.get(b[0]).w - sig.get(a[0]).w).slice(0, 18);
  const pool = new Map();
  const add = (kind, it, from, src) => { const k = `${kind}:${it.id}`; if (seen.has(k)) return; const p = pool.get(k) || { kind, id: it.id, item: it, from: [], src }; if (from) p.from.push(from); pool.set(k, p); };
  await Promise.all(favs.map(async ([id, f]) => {
    const list = await listPage(`${TMDB}/${f.kind}/${f.tmdbId}/recommendations?api_key=${key()}`);
    for (const it of list.slice(0, 20)) add(f.kind, it, { title: f.title, w: sig.get(id).w, rated: sig.get(id).rating, id }, 'rec');
  }));
  const gScores = [...prof.entries()].filter(([k]) => k.startsWith('g:'));
  const topGenres = gScores.filter(([, v]) => v > 0.08).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k.slice(2));
  const gid = (name, kind) => { const tv = kind === 'tv' ? { 'Science Fiction': 10765, Fantasy: 10765, Action: 10759, Adventure: 10759, War: 10768 }[name] : null; return tv || Object.entries(GENRE_IDS).find(([, n]) => n === name)?.[0]; };
  await Promise.all(topGenres.flatMap((g) => ['movie', 'tv'].map(async (kind) => {
    const id = gid(g, kind); if (!id) return;
    for (const it of await listPage(`${TMDB}/discover/${kind}?api_key=${key()}&with_genres=${id}&sort_by=vote_count.desc&vote_average.gte=7&page=${1 + Math.floor(R() * 3)}`)) add(kind, it, null, `genre:${g}`);
  })));
  for (const kind of ['movie', 'tv']) for (const it of await listPage(`${TMDB}/trending/${kind}/week?api_key=${key()}`)) add(kind, it, null, 'trending');
  // discovery: acclaimed titles in genres you haven't shown much interest in (but don't dislike)
  const quiet = Object.entries(GENRE_IDS).filter(([id, n]) => +id < 10000 && !['Documentary', 'Music', 'TV Movie'].includes(n) && Math.abs(prof.get(`g:${n}`) || 0) < 0.12).map(([id]) => id);
  for (const gidQ of quiet.sort(() => R() - 0.5).slice(0, 3)) for (const it of (await listPage(`${TMDB}/discover/movie?api_key=${key()}&with_genres=${gidQ}&sort_by=vote_average.desc&vote_count.gte=4000`)).slice(0, 8)) add('movie', it, null, 'explore');

  // first pass on list data
  const quick = [];
  for (const p of pool.values()) {
    const it = p.item, date = it.release_date || it.first_air_date || '';
    if (!it.poster_path || (it.vote_count || 0) < 60) continue;
    if (!date || date > today) continue; // not out yet
    if ((it.genre_ids || []).some((g) => [10763, 10764, 10767, 10766, 10770].includes(g))) continue; // news, reality, talk, soap, TV movie
    const f = { kind: p.kind, genres: canonGenres((it.genre_ids || []).map((g) => GENRE_IDS[g]).filter(Boolean)), keywords: [], cast: [], makers: [], lang: it.original_language, year: date.slice(0, 4) };
    const { a } = affinity(prof, f);
    const fromW = p.from.reduce((s2, x) => s2 + Math.max(0, x.w), 0);
    const q = (bayes(it.vote_average || 0, it.vote_count || 0) - 6) / 3;
    quick.push({ p, score: 0.9 * a + 0.5 * Math.min(1.6, fromW) + 0.5 * q + (R() - 0.5) * 0.16 });
  }
  quick.sort((x, y) => y.score - x.score);
  const short = [...quick.filter((x) => x.p.src !== 'explore').slice(0, 70), ...quick.filter((x) => x.p.src === 'explore').slice(0, 10)];

  // second pass: full features (cached), quality gates, learning from what you skipped/opened
  const scored = [];
  for (let i = 0; i < short.length; i += 8) {
    await Promise.all(short.slice(i, i + 8).map(async ({ p }) => {
      try {
        const f = await featuresByTmdb(p.kind, p.id);
        if (!f.imdbId || exclude.has(f.imdbId)) return;
        const { a, best } = affinity(prof, f);
        const qb = bayes(f.vote, f.votes);
        // quality floor: obscure or poorly rated titles only get through on a very strong taste match
        if ((f.votes < 250 || qb < 6.5) && a < 0.55) return;
        const fromW = p.from.reduce((s2, x) => s2 + Math.max(0, x.w), 0);
        const fresh = f.year && +f.year >= thisYear - 1 ? 0.12 : 0;
        const x = st[f.imdbId]; const fb = x ? (x.opened ? 0.12 : -Math.min(0.4, 0.08 * Math.max(0, x.shown - 2))) : 0;
        const score = 1.0 * a + 0.5 * Math.min(1.6, fromW) + 0.55 * ((qb - 6) / 3) + fresh + fb + (R() - 0.5) * 0.12;
        const fw = words(f.title); const fran = f.collection ? `c:${f.collection}` : bigrams(f.title).find((g) => knownBigrams.has(g)) || (fw[0] && fw[0].length > 3 ? `w:${fw[0]}` : bigrams(f.title)[0]) || f.imdbId;
        scored.push({ f, p, score, best, a, qb, fran, explore: p.src === 'explore' && a < 0.35 });
      } catch {}
    }));
  }
  scored.sort((x, y) => y.score - x.score);

  // assemble: variety rules (max 2 per franchise, max 3 per "because", no long genre runs) and ~1 in 8 a discovery
  const out = [], perFran = new Map(), perFrom = new Map();
  const ok = (x) => (perFran.get(x.fran) || 0) < 2 && (perFrom.get(x.p.from[0]?.title || '') || 0) < (x.p.from[0] ? 3 : 99);
  const take = (x) => { out.push(x); perFran.set(x.fran, (perFran.get(x.fran) || 0) + 1); if (x.p.from[0]) perFrom.set(x.p.from[0].title, (perFrom.get(x.p.from[0].title) || 0) + 1); };
  const main = scored.filter((x) => !x.explore), disc = scored.filter((x) => x.explore).sort((x, y) => y.qb - x.qb);
  while (out.length < limit && (main.length || disc.length)) {
    if (out.length % 8 === 7 && disc.length) { const d = disc.shift(); if (ok(d)) take(d); continue; }
    const last = out.slice(-2);
    let i = main.findIndex((x) => ok(x) && !(last.length === 2 && last.every((y) => y.f.genres[0] === x.f.genres[0])));
    if (i < 0) i = main.findIndex(ok);
    if (i < 0) { if (!disc.length) break; const d = disc.shift(); if (ok(d)) take(d); continue; }
    take(main.splice(i, 1)[0]);
  }
  const hi = Math.max(...out.map((x) => x.score), 0.0001), lo = Math.min(...out.map((x) => x.score), 0);
  const result = out.map(({ f, p, score, best, explore, qb }) => {
    const match = explore ? Math.round(60 + 15 * ((qb - 6.5) / 2)) : Math.round(70 + 28 * ((score - lo) / Math.max(0.0001, hi - lo)));
    const fav = p.from.slice().sort((x, y) => y.w - x.w)[0];
    let why;
    if (explore) why = `Something different: acclaimed ${f.genres[0] || 'pick'}`;
    else if (fav && fav.w > 0.45) why = fav.rated >= 5 ? `Because you loved ${fav.title}` : `Because you liked ${fav.title}`;
    else if (best?.k.startsWith('m:')) why = `From ${best.k.slice(2)}`;
    else if (best?.k.startsWith('p:')) why = `With ${best.k.slice(2)}`;
    else if (best?.k.startsWith('k:')) why = `For your love of ${best.k.slice(2)}`;
    else if (best?.k.startsWith('g:')) why = `Matches your taste for ${best.k.slice(2)}`;
    else if (p.src === 'trending') why = 'Trending now';
    else why = 'Picked for you';
    return { imdbId: f.imdbId, type: f.kind === 'tv' ? 'series' : 'movie', title: f.title, year: f.year, rating: f.vote ? f.vote.toFixed(1) : '', genres: f.genres.slice(0, 2), overview: f.overview, poster: f.poster, tag: why, match: Math.max(55, Math.min(99, match)), votes: f.votes, from: fav?.title || '', explore: !!explore };
  });
  const shape = (x) => { const fav = x.p.from.slice().sort((a2, b2) => b2.w - a2.w)[0]; return { imdbId: x.f.imdbId, type: x.f.kind === 'tv' ? 'series' : 'movie', title: x.f.title, year: x.f.year, rating: x.f.vote ? x.f.vote.toFixed(1) : '', genres: x.f.genres.slice(0, 2), overview: x.f.overview, poster: x.f.poster, tag: fav ? (fav.rated >= 5 ? `Because you loved ${fav.title}` : `Because you liked ${fav.title}`) : 'Picked for you', match: Math.max(55, Math.min(99, Math.round(70 + 28 * ((x.score - lo) / Math.max(0.0001, hi - lo))))), votes: x.f.votes, fromAll: x.p.from.map((y) => y.title), fran: x.fran, explore: !!x.explore }; };
  const poolOut = [...out, ...main].map(shape);
  noteShown(result.slice(0, 24).map((x) => x.imdbId));
  cache = { at: Date.now(), seed, out: result, sections: null, pool: poolOut };
  return result;
}

// For You as rows: top picks, "because you loved" for your strongest favourites, new, hidden gems, something different
export async function recommendSections({ seed = 0 } = {}) {
  const all = await recommend({ seed, limit: 48 });
  if (cache.sections && cache.seed === seed) return cache.sections;
  const thisYear = new Date().getFullYear(), used = new Set();
  const pick = (list, n) => { const outL = []; for (const x of list) { if (outL.length >= n) break; if (!used.has(x.imdbId)) { used.add(x.imdbId); outL.push(x); } } return outL; };
  const sections = [];
  const top = pick(all.filter((x) => !x.explore), 12); if (top.length) sections.push({ id: 'top', title: 'Top picks for you', sub: 'Best matches for your taste right now', items: top });
  // "because you loved": your two favourites with the most strong follow-ups in the whole ranked pool (max 2 per franchise)
  const poolAll = cache.pool || all, froms = {};
  for (const x of poolAll) for (const t of x.fromAll || []) (froms[t] ||= []).push(x);
  const favRated = new Map((await loadTaste()).ratings?.map((r2) => [r2.title, r2.rating]) || []);
  for (const [t, list] of Object.entries(froms).filter(([t2]) => (favRated.get(t2) || 5) >= 4).sort((a, b) => b[1].length - a[1].length).slice(0, 2)) {
    const fr = new Map(); const it = pick(list.filter((x) => +x.rating >= 6.8).filter((x) => { const n2 = fr.get(x.fran) || 0; fr.set(x.fran, n2 + 1); return n2 < 2; }).map((x) => ({ ...x, tag: `Because you loved ${t}` })), 10);
    if (it.length >= 4) sections.push({ id: `from:${t}`, title: `Because you loved ${t}`, items: it });
  }
  const fresh = pick(all.filter((x) => +x.year >= thisYear - 1 && !x.explore), 10); if (fresh.length >= 3) sections.push({ id: 'new', title: 'New for you', sub: 'Out in the last year or so', items: fresh });
  const gems = pick((cache.pool || all).filter((x) => (x.votes || 0) < 4000 && +x.rating >= 7.2 && x.match >= 84 && !x.explore), 10); if (gems.length >= 3) sections.push({ id: 'gems', title: 'Hidden gems for you', sub: 'Well liked, less known', items: gems });
  const diff = pick(all.filter((x) => x.explore), 10); if (diff.length >= 2) sections.push({ id: 'diff', title: 'Something different', sub: 'Acclaimed, outside your usual', items: diff });
  sections.sort((a, b) => (a.id === 'top' ? -1 : b.id === 'top' ? 1 : 0));
  cache.sections = { sections, all };
  return cache.sections;
}
export function invalidateRecommendations() { cache = { at: 0, seed: null, out: null, sections: null }; }

// ---------- taste summary (for the profile page) ----------
export async function tasteSummary() {
  if (!key()) return { error: 'Add tmdb_api_key to the config' };
  const { prof, sig, titleFeats, taste, acc: accRef } = await buildProfile();
  const top = (prefix, n, min = 0.06) => [...prof.entries()].filter(([k, v]) => k.startsWith(prefix) && v > min && ('gtld'.includes(prefix[0]) || (accRef.get(k)?.pos || 0) >= 2)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ name: k.slice(2), score: +v.toFixed(3) }));
  const bottom = (prefix, n) => [...prof.entries()].filter(([k, v]) => k.startsWith(prefix) && v < -0.06).sort((a, b) => a[1] - b[1]).slice(0, n).map(([k, v]) => ({ name: k.slice(2), score: +v.toFixed(3) }));
  const all = [...sig.values()];
  const watched = all.filter((s) => s.watched).length, rated = (taste.ratings || []).length;
  const strength = Math.min(100, Math.round(watched * 2.5 + rated * 6));
  const kinds = { movie: prof.get('t:movie') || 0, tv: prof.get('t:tv') || 0 };
  const LANG = { en: 'English', ko: 'Korean', ja: 'Japanese', fr: 'French', es: 'Spanish', de: 'German', it: 'Italian', hi: 'Hindi', sv: 'Swedish', lt: 'Lithuanian', da: 'Danish', no: 'Norwegian', zh: 'Chinese', ru: 'Russian', pt: 'Portuguese', tr: 'Turkish', th: 'Thai' };
  return {
    strength, watched, rated, avgRating: rated ? +((taste.ratings.reduce((s, r) => s + r.rating, 0)) / rated).toFixed(1) : null,
    genres: top('g:', 8), avoid: bottom('g:', 4), themes: top('k:', 12), people: [...top('m:', 4), ...top('p:', 8)].slice(0, 10),
    decades: top('d:', 3), languages: top('l:', 4).map((x) => ({ ...x, name: LANG[x.name] || x.name.toUpperCase() })),
    leaning: kinds.tv > kinds.movie + 0.05 ? 'series' : kinds.movie > kinds.tv + 0.05 ? 'films' : 'both',
    favourites: [...titleFeats.entries()].filter(([id]) => sig.get(id).w > 0.4).sort((a, b) => sig.get(b[0]).w - sig.get(a[0]).w).slice(0, 8).map(([id, f]) => ({ imdbId: id, title: f.title, poster: f.poster, type: f.kind === 'tv' ? 'series' : 'movie', rating: sig.get(id).rating || null })),
  };
}

// ---------- writes ----------
export async function rate({ imdbId, title, type, rating, liked = [], disliked = [] }) {
  if (!/^tt\d+$/.test(imdbId || '') || !(rating >= 0 && rating <= 5)) throw new Error('Bad rating');
  const t = await loadTaste();
  t.ratings = (t.ratings || []).filter((r) => r.imdbId !== imdbId);
  if (rating > 0) {
    let genres = []; try { genres = (await featuresByImdb(imdbId))?.genres || []; } catch {}
    t.ratings.push({ imdbId, title, type, rating, liked, disliked, genres, ratedAt: new Date().toISOString() });
  }
  t.notInterested = (t.notInterested || []).filter((n) => n.imdbId !== imdbId);
  await saveTaste(t); invalidateRecommendations();
  return { ok: true, rating };
}
export async function notInterested({ imdbId, title, undo = false }) {
  if (!/^tt\d+$/.test(imdbId || '')) throw new Error('Bad id');
  const t = await loadTaste();
  t.notInterested = (t.notInterested || []).filter((n) => n.imdbId !== imdbId);
  if (!undo) t.notInterested.push({ imdbId, title, at: new Date().toISOString() });
  await saveTaste(t); invalidateRecommendations();
  return { ok: true, hidden: !undo };
}
export async function ratingOf(imdbId) {
  const t = await loadTaste();
  const r = (t.ratings || []).find((x) => x.imdbId === imdbId);
  return { rating: r?.rating || 0, liked: r?.liked || [], disliked: r?.disliked || [], hidden: (t.notInterested || []).some((n) => n.imdbId === imdbId) };
}
