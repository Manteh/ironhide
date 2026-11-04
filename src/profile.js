// Data for the Profile page. Everything comes from what IronHide already keeps on this Mac.
import { getHistory } from './history.js';
import { getRatings } from './taste.js';
import { getWatchlist } from './settings.js';
import { getTitle } from './catalog.js';

const HOUR = 3600;

// What a friend gets to see. Smaller on purpose: one row per title per day, no notes, no links, no quality or file names.
export async function profileShare(friendCount) {
  const { plays, ratings, watchlist } = await profileData();
  const rows = new Map();
  for (const p of plays) {
    const k = `${p.imdbId}:${p.season}:${p.episode}:${String(p.watchedAt).slice(0, 10)}`, c = rows.get(k);
    if (!c) rows.set(k, { title: p.title, imdbId: p.imdbId, type: p.type, season: p.season, episode: p.episode, position: Math.round(p.position || 0), percent: Math.round(p.percent || 0), watchedAt: p.watchedAt });
    else { c.position = Math.max(c.position, Math.round(p.position || 0)); c.percent = Math.max(c.percent, Math.round(p.percent || 0)); }
  }
  const meta = await Promise.race([profileMeta(), new Promise((res) => setTimeout(() => res({ upcoming: [], genres: [] }), 5000))]);
  return {
    plays: [...rows.values()].slice(0, 1500),
    ratings: ratings.map(({ imdbId, title, type, rating, ratedAt }) => ({ imdbId, title, type, rating, ratedAt })),
    watchlist: watchlist.slice(0, 100).map(({ imdbId, type, title, year, poster }) => ({ imdbId, type, title, year, poster })),
    upcoming: meta.upcoming.slice(0, 8).map(({ imdbId, title, poster, season, episode, name, released }) => ({ imdbId, title, poster, season, episode, name, released })), genres: meta.genres, friendCount,
  };
}

export async function profileData() {
  const [history, ratings, watchlist] = await Promise.all([getHistory(5000), getRatings(1000), getWatchlist()]);
  // never hand stream links to the page: they carry debrid tokens
  const plays = history.map(({ title, imdbId, type, season, episode, position, duration, percent, watchedAt }) => ({ title, imdbId, type, season, episode, position, duration, percent, watchedAt }));
  return { plays, ratings, watchlist };
}

// The slow part: asks the catalog about each title, a few at a time. A title that fails is just left out.
// The genres this person actually watches most, for recommendations. Kept for half an hour.
let tasteMemo = { at: 0, v: [] };
export async function tasteGenres() {
  if (Date.now() - tasteMemo.at < 30 * 60 * 1000) return tasteMemo.v;
  const m = await Promise.race([profileMeta(), new Promise((res) => setTimeout(() => res({ genres: [] }), 8000))]).catch(() => ({ genres: [] }));
  tasteMemo = { at: Date.now(), v: m.genres.slice(0, 5).map((g) => g.name) };
  return tasteMemo.v;
}

export async function profileMeta() {
  const { plays, watchlist } = await profileData();
  const seen = new Map();
  for (const p of plays) {
    const t = p.type === 'tv' || p.type === 'series' ? 'series' : 'movie', cur = seen.get(p.imdbId) || { id: p.imdbId, type: t, title: p.title, secs: 0, keys: new Map(), watched: false };
    const k = `${p.season}:${p.episode}`; cur.keys.set(k, Math.max(cur.keys.get(k) || 0, p.position || 0)); cur.watched = true; seen.set(p.imdbId, cur);
  }
  for (const w of watchlist) if (!seen.has(w.imdbId)) seen.set(w.imdbId, { id: w.imdbId, type: w.type === 'tv' ? 'series' : w.type, title: w.title, keys: new Map(), watched: false });
  const list = [...seen.values()].slice(0, 60), today = new Date().toISOString().slice(0, 10), genres = {}, upcoming = [];
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < list.length) {
      const x = list[i++];
      try {
        const t = await Promise.race([getTitle(x.id, x.type), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 7000))]); if (!t) continue;
        const secs = [...x.keys.values()].reduce((a, b) => a + b, 0);
        for (const g of t.genres || []) genres[g] = (genres[g] || 0) + secs;
        if (x.type === 'series') {
          const next = Object.entries(t.seasons || {}).flatMap(([s, eps]) => eps.map((e) => ({ season: +s, ...e }))).filter((e) => e.released && e.released >= today).sort((a, b) => a.released.localeCompare(b.released))[0];
          if (next) upcoming.push({ imdbId: x.id, title: t.name || t.title || x.title, poster: t.poster || '', season: next.season, episode: next.episode, name: next.name, released: next.released, watched: x.watched });
        }
      } catch {}
    }
  }));
  upcoming.sort((a, b) => a.released.localeCompare(b.released));
  return { upcoming, genres: Object.entries(genres).filter(([, s]) => s > 0).map(([name, secs]) => ({ name, hours: secs / HOUR })).sort((a, b) => b.hours - a.hours).slice(0, 7) };
}
