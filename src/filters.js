// Discover: filter everything at once (several genres with any/all and exclusions, release years, rating, countries, themes, streaming
// services) on TMDB's discover, and optionally by IMDb / Rotten Tomatoes scores when an OMDb key is set.
import { getConfig } from './config.js';
import { shape, page, getJson, TMDB, tmdbKey } from './charts.js';

const GENRES = { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749, 'Sci-Fi': 878, Thriller: 53, War: 10752, Western: 37 };
// movie genre id -> series genre ids (series merge some genres)
const TV = { 28: [10759], 12: [10759], 878: [10765], 14: [10765], 10752: [10768] };
const tvIds = (ids) => [...new Set(ids.flatMap((i) => TV[i] || [i]))];
// themes people ask for, as TMDB keyword names (several are OR-ed)
export const THEMES = [
  ['Video games', ['video game', 'based on video game']], ['Superheroes', ['superhero', 'based on comic']], ['Disaster', ['disaster', 'natural disaster']],
  ['Heists', ['heist']], ['Zombies', ['zombie']], ['Time travel', ['time travel']], ['True story', ['based on true story']], ['Serial killers', ['serial killer']],
  ['Space', ['space', 'outer space']], ['Post-apocalyptic', ['post-apocalyptic future']], ['Vampires', ['vampire']], ['Dystopia', ['dystopia']],
  ['Spies', ['spy']], ['Survival', ['survival']], ['Coming of age', ['coming of age']], ['Road trip', ['road trip']], ['Courtroom', ['courtroom']],
  ['Martial arts', ['martial arts']], ['Cold war', ['cold war']], ['Sports', ['sport']], ['Mafia', ['mafia', 'gangster']], ['Aliens', ['alien']],
  ['Detective', ['detective', 'private investigator', 'investigation', 'whodunit']], ['Neo-noir', ['neo-noir', 'film noir', 'noir']],
  ['Cyberpunk', ['cyberpunk', 'artificial intelligence', 'cyborg']], ['Psychological', ['psychological thriller', 'mind game', 'unreliable narrator']],
  ['Mind-bending', ['mind-bending', 'plot twist', 'alternate reality', 'surreal']],
  ['Robots', ['robot', 'humanoid robot', 'android', 'cyborg', 'giant robot', 'mecha']],
  ['AI', ['artificial intelligence (a.i.)', 'artificial intelligence', 'android', 'cyborg', 'robot']],
];
export const COUNTRIES = [['US', 'United States'], ['GB', 'United Kingdom'], ['KR', 'South Korea'], ['JP', 'Japan'], ['FR', 'France'], ['DE', 'Germany'], ['ES', 'Spain'], ['IT', 'Italy'], ['IN', 'India'], ['CN', 'China'], ['HK', 'Hong Kong'], ['CA', 'Canada'], ['AU', 'Australia'], ['SE', 'Sweden'], ['DK', 'Denmark'], ['NO', 'Norway'], ['FI', 'Finland'], ['PL', 'Poland'], ['LT', 'Lithuania'], ['TR', 'Turkey'], ['MX', 'Mexico'], ['BR', 'Brazil'], ['AR', 'Argentina'], ['NZ', 'New Zealand'], ['IE', 'Ireland'], ['TH', 'Thailand'], ['RU', 'Russia'], ['UA', 'Ukraine'], ['IS', 'Iceland'], ['BE', 'Belgium'], ['NL', 'Netherlands']];

const kw = new Map();
const keywordId = (name) => {
  if (!kw.has(name)) kw.set(name, getJson(`${TMDB}/search/keyword?api_key=${tmdbKey()}&query=${encodeURIComponent(name)}`).then((d) => { const r = d.results || []; return (r.find((x) => x.name.toLowerCase() === name.toLowerCase()) || r.find((x) => x.name.toLowerCase().includes(name.toLowerCase())) || r[0] || {}).id || 0; }).catch(() => { kw.delete(name); return 0; }));
  return kw.get(name);
};

// the streaming services in a region, biggest first (logos for the filter bar)
const provCache = new Map();
export async function providers(region = 'US') {
  region = /^[A-Z]{2}$/.test(region) ? region : 'US';
  if (!provCache.has(region)) {
    provCache.set(region, Promise.all(['movie', 'tv'].map((k) => getJson(`${TMDB}/watch/providers/${k}?api_key=${tmdbKey()}&watch_region=${region}`).then((d) => d.results || []).catch(() => []))).then(([m, t]) => {
      const by = new Map();
      for (const p of [...m, ...t]) { const o = by.get(p.provider_id); if (!o || p.display_priority < o.p) by.set(p.provider_id, { id: p.provider_id, name: p.provider_name, logo: `https://image.tmdb.org/t/p/w92${p.logo_path}`, p: p.display_priority }); }
      // drop store fronts, kids duplicates, betas and tiny niche services; the rest keep TMDB's popularity order
      const junk = /kids|store|beta|guide|docs|eventive|cultpix|magellan|dekkoo|takflix|filmzie|broadway|wow presents|curiosity|sun nxt|true story|amazon channel|channel$|apple tv\+? ?store|premium|plus amazon/i;
      return [...by.values()].filter((x) => !junk.test(x.name)).sort((a, b) => a.p - b.p).slice(0, 16).map(({ p, ...x }) => x);
    }).catch(() => { provCache.delete(region); return []; }));
  }
  return provCache.get(region);
}

export function meta() {
  return { genres: Object.keys(GENRES), themes: THEMES.map(([n]) => n), countries: COUNTRIES.map(([c, n]) => ({ code: c, name: n })), scores: !!getConfig().omdb_api_key };
}

// IMDb and Rotten Tomatoes scores from OMDb (key needed), remembered so a title is asked about once
const omdbCache = new Map();
export function scoresOf(imdbId) {
  const k = getConfig().omdb_api_key; if (!k || !imdbId) return Promise.resolve(null);
  if (!omdbCache.has(imdbId)) omdbCache.set(imdbId, getJson(`https://www.omdbapi.com/?i=${imdbId}&apikey=${encodeURIComponent(k)}`).then((d) => {
    if (d.Response === 'False') return null;
    const rt = (d.Ratings || []).find((r) => /rotten/i.test(r.Source))?.Value;
    const imdb = parseFloat(d.imdbRating);
    return { imdb: Number.isFinite(imdb) ? imdb : null, rt: rt ? parseInt(rt, 10) : null };
  }).catch(() => { omdbCache.delete(imdbId); return null; }));
  return omdbCache.get(imdbId);
}

const SORTS = { popular: 'popularity.desc', rating: 'vote_average.desc', newest: 'primary_release_date.desc', oldest: 'primary_release_date.asc' };
const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

// one page of results (20 titles per kind; films and series interleave)
export async function discoverFiltered(q = {}) {
  if (!tmdbKey()) return [];
  const kinds = q.type === 'movie' ? ['movie'] : q.type === 'series' ? ['tv'] : ['movie', 'tv'];
  const genres = list(q.genres).map((g) => GENRES[g]).filter(Boolean), skipG = list(q.exclude).map((g) => GENRES[g]).filter(Boolean);
  const all = q.mode === 'all', pg = Math.max(1, Math.min(200, Number(q.page) || 1));
  const themeIds = (await Promise.all(list(q.themes).flatMap((t) => (THEMES.find(([n]) => n.toLowerCase() === String(t).toLowerCase())?.[1] || [String(t)]).map(keywordId)))).filter(Boolean);
  const haveKey = !!getConfig().omdb_api_key, wantScores = haveKey && (q.imdbMin || q.rtMin);
  const lists = await Promise.all(kinds.map(async (kind) => {
    const tv = kind === 'tv', qs = new URLSearchParams({ api_key: tmdbKey(), page: String(pg), include_adult: 'false', sort_by: SORTS[q.sort] ? (tv ? SORTS[q.sort].replace('primary_release_date', 'first_air_date') : SORTS[q.sort]) : SORTS.popular });
    const inc = tv ? tvIds(genres) : genres, exc = tv ? tvIds(skipG) : skipG;
    if (inc.length) qs.set('with_genres', inc.join(all ? ',' : '|'));
    if (exc.length) qs.set('without_genres', exc.join(','));
    const dk = tv ? 'first_air_date' : 'primary_release_date';
    if (q.yearFrom) qs.set(`${dk}.gte`, `${Number(q.yearFrom)}-01-01`);
    if (q.yearTo) qs.set(`${dk}.lte`, `${Number(q.yearTo)}-12-31`);
    if (Number(q.ratingMin) > 0) qs.set('vote_average.gte', String(Number(q.ratingMin)));
    // a floor on votes so "7+" means something; lower for series, and higher for the rating sort
    qs.set('vote_count.gte', String(q.sort === 'rating' ? (tv ? 150 : 500) : (tv ? 30 : 100)));
    const cs = list(q.countries).filter((c) => /^[A-Z]{2}$/.test(c)); if (cs.length) qs.set('with_origin_country', cs.join('|'));
    if (themeIds.length) qs.set('with_keywords', themeIds.join('|'));
    const pv = list(q.providers).filter((x) => /^\d+$/.test(x));
    if (pv.length) { qs.set('with_watch_providers', pv.join('|')); qs.set('watch_region', /^[A-Z]{2}$/.test(q.region) ? q.region : 'US'); qs.set('with_watch_monetization_types', 'flatrate|free|ads'); }
    try { return (await page(`${TMDB}/discover/${kind}?${qs}`)).map((x) => ({ ...x, _kind: kind })); } catch { return []; }
  }));
  const merged = []; for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) merged.push(l[i]);
  const seen = new Set();
  const cap = Number(q.take) > 0 ? Number(q.take) : merged.length; // only the first few get the (slow) IMDb lookup
  let out = await shape(merged.slice(0, cap).filter((x) => !seen.has(`${x._kind}${x.id}`) && seen.add(`${x._kind}${x.id}`)), () => '');
  if (q.sort === 'newest') out.sort((a, b) => (b.year || '').localeCompare(a.year || ''));
  if (haveKey) {
    const sc = await Promise.all(out.map((x) => scoresOf(x.imdbId)));
    out = out.map((x, i) => ({ ...x, imdb: sc[i]?.imdb ?? null, rt: sc[i]?.rt ?? null }));
    if (wantScores) out = out.filter((x) => (!q.imdbMin || (x.imdb ?? 0) >= Number(q.imdbMin)) && (!q.rtMin || (x.rt ?? 0) >= Number(q.rtMin)));
  }
  return out;
}
