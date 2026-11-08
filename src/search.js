// Smart search: fast, typo-tolerant, understands a little of what you mean.
//   "dune"               -> titles, best match first (exact/prefix title match, popularity, your taste, what you've started)
//   "korean thriller"    -> discover: thrillers in Korean
//   "sci-fi 2024", "comedy series", "90s horror"  -> discover with genre / year / decade / type
//   "like interstellar", "movies like dune"       -> titles similar to that one
//   "harold perrineau"   -> the person (and their best-known work); "person:6195" lists everything they're in
// TMDB answers in ~100-200ms; results are cached per query, IMDb ids (what the app opens titles by) are looked up once each.
import { getConfig } from './config.js';
import { getHistory } from './history.js';
import { tasteHint, GENRES, canonGenres, warmProfile } from './recommend.js';
import { search as cinemetaSearch } from './catalog.js';

const TMDB = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';
const key = () => getConfig().tmdb_api_key;
const getJson = async (url, signal) => { const r = await fetch(url, { signal: signal || AbortSignal.timeout(6000) }); if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); };

const qCache = new Map(); // query -> { at, data }
const idCache = new Map(); // "movie:123" -> imdbId
async function imdbOf(kind, id) {
  const k = `${kind}:${id}`;
  if (idCache.has(k)) return idCache.get(k);
  const p = getJson(`${TMDB}/${kind}/${id}/external_ids?api_key=${key()}`).then((x) => x.imdb_id || '').catch(() => '');
  idCache.set(k, p);
  return p;
}

// ---- understanding the query ----
const LANGS = { korean: 'ko', japanese: 'ja', anime: 'ja', french: 'fr', spanish: 'es', german: 'de', italian: 'it', indian: 'hi', hindi: 'hi', bollywood: 'hi', swedish: 'sv', danish: 'da', norwegian: 'no', chinese: 'zh', turkish: 'tr', thai: 'th', british: 'en', english: 'en', lithuanian: 'lt', russian: 'ru', polish: 'pl', brazilian: 'pt', portuguese: 'pt' };
const GENRE_WORDS = { action: 'Action', adventure: 'Adventure', animation: 'Animation', animated: 'Animation', anime: 'Animation', cartoon: 'Animation', comedy: 'Comedy', comedies: 'Comedy', funny: 'Comedy', crime: 'Crime', documentary: 'Documentary', docs: 'Documentary', drama: 'Drama', family: 'Family', kids: 'Family', fantasy: 'Fantasy', history: 'History', historical: 'History', horror: 'Horror', scary: 'Horror', music: 'Music', musical: 'Music', mystery: 'Mystery', romance: 'Romance', romantic: 'Romance', 'sci-fi': 'Science Fiction', scifi: 'Science Fiction', 'science fiction': 'Science Fiction', space: 'Science Fiction', thriller: 'Thriller', thrillers: 'Thriller', war: 'War', western: 'Western' };
const TV_IDS = { 'Science Fiction': 10765, Fantasy: 10765, Action: 10759, Adventure: 10759, War: 10768 };
const genreId = (name, kind) => (kind === 'tv' && TV_IDS[name]) || Object.entries(GENRES).find(([, n]) => n === name)?.[0];

function parse(q) {
  let s = ` ${q.toLowerCase()} `;
  const intent = { genres: [], lang: '', year: null, decade: null, kind: null, like: '', rest: '' };
  const like = /^\s*(?:movies?|films?|shows?|series)?\s*(?:like|similar to)\s+(.+)$/.exec(s.trim());
  if (like) { intent.like = like[1].trim(); return intent; }
  s = s.replace(/\b(tv shows?|series|shows?)\b/g, () => { intent.kind = 'tv'; return ' '; }).replace(/\b(movies?|films?)\b/g, () => { intent.kind = 'movie'; return ' '; });
  s = s.replace(/\b(19[2-9]\d|20[0-3]\d)\b/g, (m) => { intent.year = +m; return ' '; });
  s = s.replace(/\b(?:the\s+)?(\d0)'?s\b/g, (m, d) => { intent.decade = +d < 30 ? 2000 + +d : 1900 + +d; return ' '; });
  for (const w of Object.keys(GENRE_WORDS).sort((a, b) => b.length - a.length)) { const re = new RegExp(`\\b${w.replace('-', '\\-')}\\b`, 'g'); if (re.test(s)) { intent.genres.push(GENRE_WORDS[w]); s = s.replace(re, ' '); } }
  for (const [w, code] of Object.entries(LANGS)) { const re = new RegExp(`\\b${w}\\b`); if (re.test(s)) { intent.lang = code; s = s.replace(re, ' '); break; } }
  intent.rest = s.replace(/\b(best|good|top|new|the|a|with|some)\b/g, ' ').replace(/\s+/g, ' ').trim();
  intent.genres = [...new Set(intent.genres)];
  return intent;
}
const isFilter = (i) => !i.rest && (i.genres.length || i.lang || i.year || i.decade);

// ---- shaping results ----
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function textScore(title, q) {
  const t = norm(title), n = norm(q);
  if (!n) return 0;
  if (t === n) return 3;
  if (t.startsWith(n)) return 2.2;
  if (t.split(' ').some((w) => w.startsWith(n))) return 1.5;
  if (t.includes(n)) return 1.1;
  const qs = n.split(' '); const hit = qs.filter((w) => t.includes(w)).length / qs.length;
  return hit * 0.9;
}
async function shape(items, q, progress) {
  const top = items.filter((x) => (x.media_type ? ['movie', 'tv'].includes(x.media_type) : true) && x.poster_path).slice(0, 16);
  const out = await Promise.all(top.map(async (x) => {
    const kind = x.media_type || x._kind; const imdbId = await imdbOf(kind, x.id);
    if (!imdbId) return null;
    const date = x.release_date || x.first_air_date || '';
    const genres = canonGenres((x.genre_ids || []).map((g) => GENRES[g]).filter(Boolean));
    const pop = Math.log10(1 + (x.popularity || 0)) + Math.log10(1 + (x.vote_count || 0)) * 0.6;
    const p = progress.get(imdbId);
    const score = textScore(x.title || x.name, q) * 2 + pop * 0.45 + tasteHint(genres, x.original_language) * 1.2 + (p ? 0.6 : 0);
    return {
      imdbId, type: kind === 'tv' ? 'series' : 'movie', title: x.title || x.name, year: date.slice(0, 4), genres: genres.slice(0, 2),
      rating: x.vote_average ? x.vote_average.toFixed(1) : '', overview: (x.overview || '').slice(0, 220),
      poster: `${IMG}/w342${x.poster_path}`, backdrop: x.backdrop_path ? `${IMG}/w780${x.backdrop_path}` : '',
      progress: p ? { pct: Math.round(p.percent || 0), season: p.season, episode: p.episode } : null, score,
    };
  }));
  const seen = new Set();
  return out.filter((x) => x && !seen.has(x.imdbId) && seen.add(x.imdbId));
}

export async function smartSearch(raw) {
  const q = String(raw || '').trim().slice(0, 80);
  if (!q) return { titles: [], people: [] };
  const ck = q.toLowerCase(), hit = qCache.get(ck);
  if (hit && Date.now() - hit.at < 15 * 60e3) return hit.data;
  if (!key()) { const t = await cinemetaSearch(q).catch(() => []); return { titles: t, people: [], intent: null }; }
  warmProfile(); // taste ranking improves once the profile has been built (it's cached after)
  const hist = await getHistory(400).catch(() => []);
  const progress = new Map(); for (const h of hist) if (!progress.has(h.imdbId) && (h.percent || 0) > 3) progress.set(h.imdbId, h);
  const k = key();
  let data;

  const person = /^person:(\d+)$/.exec(q);
  if (person) {
    const d = await getJson(`${TMDB}/person/${person[1]}?api_key=${k}&append_to_response=combined_credits`);
    const credits = [...(d.combined_credits?.cast || []), ...(d.combined_credits?.crew || []).filter((c) => ['Director', 'Creator'].includes(c.job))]
      .filter((c) => (c.vote_count || 0) > 30).sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
    const titles = (await shape(credits, '', progress)).slice(0, 16);
    data = { titles, people: [], intent: { label: `With ${d.name}` } };
  } else {
    const intent = parse(q);
    if (intent.like) {
      // "like X": find X, then what people who liked X also liked
      const found = (await getJson(`${TMDB}/search/multi?api_key=${k}&query=${encodeURIComponent(intent.like)}`)).results?.find((x) => ['movie', 'tv'].includes(x.media_type));
      const recs = found ? (await getJson(`${TMDB}/${found.media_type}/${found.id}/recommendations?api_key=${k}`)).results.map((x) => ({ ...x, media_type: found.media_type })) : [];
      const titles = (await shape(recs, '', progress)).sort((a, b) => b.score - a.score);
      data = { titles, people: [], intent: { label: found ? `Like ${found.title || found.name}` : `Nothing found for “${intent.like}”` } };
    } else if (isFilter(intent)) {
      // "korean thriller", "sci-fi 2024", "90s horror series": discover, best-rated first
      const kinds = intent.kind ? [intent.kind] : ['movie', 'tv'];
      const lists = await Promise.all(kinds.map(async (kind) => {
        const qs = new URLSearchParams({ api_key: k, sort_by: 'vote_count.desc', 'vote_average.gte': '6.4' });
        const g = intent.genres.map((n) => genreId(n, kind)).filter(Boolean); if (g.length) qs.set('with_genres', g.join(','));
        if (intent.lang) qs.set('with_original_language', intent.lang);
        const field = kind === 'tv' ? 'first_air_date' : 'primary_release_date';
        if (intent.year) { qs.set(`${field}.gte`, `${intent.year}-01-01`); qs.set(`${field}.lte`, `${intent.year}-12-31`); qs.set('sort_by', 'popularity.desc'); }
        if (intent.decade) { qs.set(`${field}.gte`, `${intent.decade}-01-01`); qs.set(`${field}.lte`, `${intent.decade + 9}-12-31`); }
        return (await getJson(`${TMDB}/discover/${kind}?${qs}`)).results.map((x) => ({ ...x, media_type: kind }));
      }));
      const merged = lists.flat().sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
      const titles = (await shape(merged, '', progress)).sort((a, b) => b.score - a.score);
      const label = [intent.decade && `${intent.decade}s`, intent.year, Object.entries(LANGS).find(([, c]) => c === intent.lang)?.[0]?.replace(/^./, (c) => c.toUpperCase()), ...intent.genres, intent.kind === 'tv' ? 'series' : intent.kind === 'movie' ? 'films' : ''].filter(Boolean).join(' ');
      data = { titles, people: [], intent: { label: label || q } };
    } else {
      // plain text: titles and people in one go; a year or type in the query narrows it
      const text = intent.rest || q;
      const [multi, page2] = await Promise.all([
        getJson(`${TMDB}/search/multi?api_key=${k}&query=${encodeURIComponent(text)}&include_adult=false`),
        text.length > 3 ? getJson(`${TMDB}/search/multi?api_key=${k}&query=${encodeURIComponent(text)}&include_adult=false&page=2`).catch(() => ({ results: [] })) : { results: [] },
      ]);
      let res = [...(multi.results || []), ...(page2.results || [])];
      if (intent.kind) res = res.filter((x) => x.media_type === intent.kind || x.media_type === 'person');
      if (intent.year) res = res.filter((x) => x.media_type === 'person' || (x.release_date || x.first_air_date || '').startsWith(String(intent.year)));
      const titles = (await shape(res, text, progress)).sort((a, b) => b.score - a.score);
      const people = res.filter((x) => x.media_type === 'person' && x.profile_path).slice(0, 6).map((p) => ({
        id: p.id, name: p.name, photo: `${IMG}/w185${p.profile_path}`, dept: p.known_for_department === 'Acting' ? (p.gender === 1 ? 'Actress' : 'Actor') : p.known_for_department === 'Directing' ? 'Director' : p.known_for_department || '',
        known: (p.known_for || []).map((k2) => k2.title || k2.name).filter(Boolean).slice(0, 2), score: textScore(p.name, text) * 2 + Math.log10(1 + (p.popularity || 0)),
      })).sort((a, b) => b.score - a.score);
      // a person typed exactly ("harold perrineau") outranks loosely matching titles
      const personFirst = people[0] && people[0].score >= 6 && (!titles[0] || textScore(titles[0].title, text) < 2.2);
      data = { titles, people, personFirst, intent: (intent.kind || intent.year) ? { label: [intent.kind === 'tv' ? 'Series' : intent.kind === 'movie' ? 'Films' : '', intent.year].filter(Boolean).join(' · ') } : null };
      // TMDB found nothing (odd spelling): fall back to the catalogue's own search
      if (!titles.length && !people.length) data.titles = (await cinemetaSearch(q).catch(() => [])).slice(0, 12);
    }
  }
  qCache.set(ck, { at: Date.now(), data });
  if (qCache.size > 300) qCache.delete(qCache.keys().next().value);
  return data;
}
