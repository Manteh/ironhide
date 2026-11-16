// Curated collections: themed shelves ("Edge of your seat", "Christmas", "Pixar") defined as data and served from
// TMDB discover. A collection is one small entry in COLLECTIONS: add a line and it shows up on Home, in the
// Collections tab and as a full "See all" grid (feed id `col_<id>`).
//   q        TMDB discover params. `with_keywords` is a list of keyword NAMES (resolved to ids and OR-ed together)
//   tv       optional overrides for the series side; `kind` is 'movie' | 'tv' | 'both'
//   moods    which "Tonight I want…" chips pull this shelf in
//   season   [from, to] as MM-DD: the shelf is only active (and goes first on Home) inside that window
import { shape, page, getJson, TMDB, tmdbKey } from './charts.js';
import { shuffle, rnd } from './catalog.js';

const movie = (id, group, title, sub, q, extra = {}) => ({ id, group, title, sub, kind: 'movie', q, ...extra });
// films and series made in one country (TMDB's origin country) and, where the country has its own language, made in
// it, so Hollywood co-productions stay out. The bar is lower for smaller film industries; series get a quarter of the
// films' vote count, since far fewer people rate them.
const country = (id, code, lang, title, sub, votes, extra = {}) => ({
  id, group: 'countries', title, sub, kind: 'both',
  q: { with_origin_country: code, ...(lang ? { with_original_language: lang } : {}), 'vote_average.gte': votes >= 300 ? 6.6 : 6, 'vote_count.gte': votes },
  tv: { 'vote_count.gte': Math.max(1, Math.round(votes / 4)) }, ...extra,
});

export const GROUPS = [
  { id: 'suspense', label: 'Suspense & thrillers' },
  { id: 'action', label: 'Action' },
  { id: 'dark', label: 'Dark & scary' },
  { id: 'scifi', label: 'Sci-fi & mind-benders' },
  { id: 'animation', label: 'Animation' },
  { id: 'vibes', label: 'By vibe' },
  { id: 'series', label: 'Series to binge' },
  { id: 'world', label: 'Eras & world cinema' },
  { id: 'countries', label: 'By country' },
  { id: 'seasonal', label: 'Seasonal' },
];

export const MOODS = [
  { id: 'tense', label: 'Tense' }, { id: 'adrenaline', label: 'Adrenaline' }, { id: 'mindbend', label: 'Mind-bending' },
  { id: 'scary', label: 'Scary' }, { id: 'cozy', label: 'Cozy' }, { id: 'funny', label: 'Funny' },
  { id: 'quick', label: 'Quick watch' }, { id: 'family', label: 'Family' }, { id: 'binge', label: 'Binge' },
];

const GOOD = { 'vote_average.gte': 6.6, 'vote_count.gte': 1200 };
export const COLLECTIONS = [
  // ---- suspense & thrillers
  movie('edge', 'suspense', 'Edge of your seat', 'Tight, tense thrillers', { with_genres: '53', 'vote_average.gte': 6.8, 'vote_count.gte': 2000 }, { moods: ['tense'] }),
  movie('slowburn', 'suspense', 'Slow-burn thrillers', 'Dread that builds', { with_genres: '53,9648', 'with_runtime.gte': 105, 'vote_average.gte': 7, 'vote_count.gte': 1500 }, { moods: ['tense'] }),
  movie('twists', 'suspense', 'Twist endings', 'You will not see it coming', { with_keywords: ['twist ending', 'plot twist'], ...GOOD, 'vote_average.gte': 6.9 }, { moods: ['tense', 'mindbend'] }),
  movie('heist', 'suspense', 'Heists & cons', 'Elaborate plans, things go wrong', { with_keywords: ['heist', 'con artist'], 'vote_average.gte': 6.4, 'vote_count.gte': 800 }, { moods: ['tense', 'adrenaline'] }),
  movie('survival', 'suspense', 'Survival', 'Alone against everything', { with_keywords: ['survival'], 'vote_average.gte': 6.4, 'vote_count.gte': 800 }, { moods: ['tense', 'adrenaline'] }),
  movie('paranoia', 'suspense', 'Paranoia & conspiracies', 'Trust nobody', { with_keywords: ['conspiracy', 'paranoia', 'surveillance'], ...GOOD }, { moods: ['tense', 'mindbend'] }),
  movie('killer', 'suspense', 'Hunting a killer', 'Detectives, profilers, obsession', { with_keywords: ['serial killer', 'detective'], with_genres: '53,80', ...GOOD, 'vote_average.gte': 6.9 }, { moods: ['tense'] }),
  movie('noir', 'suspense', 'Neo-noir', 'Rain, neon, bad decisions', { with_keywords: ['neo-noir', 'film noir'], 'vote_average.gte': 6.8, 'vote_count.gte': 600 }, { moods: ['tense'] }),
  movie('spies', 'suspense', 'Spies & espionage', 'Double agents and dead drops', { with_keywords: ['spy', 'secret agent', 'espionage'], 'vote_average.gte': 6.5, 'vote_count.gte': 1000 }, { moods: ['tense', 'adrenaline'] }),
  movie('trapped', 'suspense', 'One room, no way out', 'Claustrophobic and gripping', { with_keywords: ['claustrophobia', 'single location', 'locked room'], 'vote_average.gte': 6.4, 'vote_count.gte': 500 }, { moods: ['tense'] }),
  movie('truecrime', 'suspense', 'True crime on film', 'Based on real cases', { with_keywords: ['based on true story'], with_genres: '80', 'vote_average.gte': 6.9, 'vote_count.gte': 1000 }, { moods: ['tense'] }),
  // ---- action
  movie('actionbest', 'action', 'Action essentials', 'The ones that earned it', { with_genres: '28', 'vote_average.gte': 7.2, 'vote_count.gte': 4000 }, { moods: ['adrenaline'] }),
  movie('revenge', 'action', 'Revenge', 'They picked the wrong one', { with_keywords: ['revenge', 'vigilante'], with_genres: '28,53', 'vote_average.gte': 6.4, 'vote_count.gte': 1000 }, { moods: ['adrenaline'] }),
  movie('oneman', 'action', 'One-man army', 'Outnumbered, never outgunned', { with_keywords: ['one man army', 'lone wolf', 'assassin', 'hitman'], 'vote_average.gte': 6.4, 'vote_count.gte': 1000 }, { moods: ['adrenaline'] }),
  movie('chase', 'action', 'Chases & crashes', 'Pedal down', { with_keywords: ['car chase', 'street race'], 'vote_average.gte': 6.2, 'vote_count.gte': 1000 }, { moods: ['adrenaline'] }),
  movie('martial', 'action', 'Martial arts', 'Fights you can follow', { with_keywords: ['martial arts', 'kung fu'], 'vote_average.gte': 6.5, 'vote_count.gte': 500 }, { moods: ['adrenaline'] }),
  movie('disaster', 'action', 'Disaster zone', 'Everything is going wrong', { with_keywords: ['disaster', 'natural disaster'], 'vote_average.gte': 6, 'vote_count.gte': 800 }, { moods: ['adrenaline'] }),
  movie('war', 'action', 'War films', 'Front line stories', { with_genres: '10752', 'vote_average.gte': 7.2, 'vote_count.gte': 2000 }, { moods: ['tense', 'epic'] }),
  movie('heroes', 'action', 'Superheroes', 'Capes, powers and consequences', { with_keywords: ['superhero'], 'vote_average.gte': 6.8, 'vote_count.gte': 3000 }, { moods: ['adrenaline', 'family'] }),
  // ---- dark & scary
  movie('scary', 'dark', 'Scary good', 'Horror that is worth the lost sleep', { with_genres: '27', 'vote_average.gte': 6.7, 'vote_count.gte': 1500 }, { moods: ['scary'] }),
  movie('haunted', 'dark', 'Haunted', 'Things in the walls', { with_keywords: ['haunted house', 'ghost', 'supernatural'], with_genres: '27', 'vote_average.gte': 6.3, 'vote_count.gte': 800 }, { moods: ['scary'] }),
  movie('creature', 'dark', 'Creature features', 'Something is out there', { with_keywords: ['monster', 'creature', 'giant monster'], 'vote_average.gte': 6.3, 'vote_count.gte': 1000 }, { moods: ['scary', 'adrenaline'] }),
  movie('zombie', 'dark', 'The living dead', 'Rules of survival', { with_keywords: ['zombie', 'post-apocalyptic'], 'vote_average.gte': 6.3, 'vote_count.gte': 1000 }, { moods: ['scary', 'adrenaline'] }),
  movie('folk', 'dark', 'Folk & cult horror', 'Sunlit and wrong', { with_keywords: ['cult', 'folk horror', 'pagan'], with_genres: '27,53,9648', 'vote_average.gte': 6.3, 'vote_count.gte': 500 }, { moods: ['scary', 'tense'] }),
  // ---- sci-fi
  movie('bigscifi', 'scifi', 'Big sci-fi', 'Ideas on an enormous screen', { with_genres: '878', 'vote_average.gte': 7, 'vote_count.gte': 3000 }, { moods: ['mindbend', 'epic'] }),
  movie('mindbend', 'scifi', 'Mind-benders', 'Reality is negotiable', { with_keywords: ['mind bending', 'dream', 'nonlinear timeline', 'alternate reality'], 'vote_average.gte': 6.9, 'vote_count.gte': 1500 }, { moods: ['mindbend'] }),
  movie('timetravel', 'scifi', 'Time loops & time travel', 'Paradox included', { with_keywords: ['time travel', 'time loop'], 'vote_average.gte': 6.5, 'vote_count.gte': 1000 }, { moods: ['mindbend'] }),
  movie('dystopia', 'scifi', 'Dystopias', 'Futures to avoid', { with_keywords: ['dystopia', 'post-apocalyptic'], 'vote_average.gte': 6.5, 'vote_count.gte': 1500 }, { moods: ['mindbend', 'tense'] }),
  movie('space', 'scifi', 'Lost in space', 'Silence is not peaceful', { with_keywords: ['space', 'astronaut', 'space travel'], with_genres: '878', 'vote_average.gte': 6.6, 'vote_count.gte': 1200 }, { moods: ['mindbend', 'tense'] }),
  // ---- animation
  movie('pixar', 'animation', 'Pixar', 'Studio on a streak', { with_companies: '3', 'vote_count.gte': 1500 }, { moods: ['family', 'cozy'] }),
  movie('ghibli', 'animation', 'Studio Ghibli', 'Hand-drawn wonder', { with_companies: '10342', 'vote_count.gte': 300 }, { moods: ['family', 'cozy'] }),
  movie('dreamworks', 'animation', 'DreamWorks', 'Big, funny, surprisingly warm', { with_companies: '521', 'vote_count.gte': 1500 }, { moods: ['family', 'funny'] }),
  movie('animfam', 'animation', 'Animated for everyone', 'Great at any age', { with_genres: '16,10751', 'vote_average.gte': 7, 'vote_count.gte': 2000 }, { moods: ['family'] }),
  movie('adultanim', 'animation', 'Animation for adults', 'Not for kids', { with_genres: '16', with_keywords: ['adult animation', 'dark fantasy', 'violence'], 'vote_average.gte': 6.8, 'vote_count.gte': 500 }, { moods: ['mindbend', 'adrenaline'] }),
  movie('anime', 'animation', 'Anime films', 'Japanese animation, the cinema cut', { with_genres: '16', with_original_language: 'ja', 'vote_average.gte': 7, 'vote_count.gte': 500 }, { moods: ['mindbend'] }),
  movie('stopmotion', 'animation', 'Stop-motion', 'Every frame made by hand', { with_keywords: ['stop motion'], 'vote_count.gte': 300, 'vote_average.gte': 6.5 }, { moods: ['family', 'cozy'] }),
  // ---- by vibe
  movie('cozy', 'vibes', 'Feel-good', 'Leave the night better than you found it', { with_keywords: ['feel good', 'heartwarming', 'uplifting'], 'vote_average.gte': 6.8, 'vote_count.gte': 1000 }, { moods: ['cozy', 'funny'] }),
  movie('laugh', 'vibes', 'Laugh out loud', 'Comedies that hold up', { with_genres: '35', 'vote_average.gte': 7, 'vote_count.gte': 2500 }, { moods: ['funny'] }),
  movie('date', 'vibes', 'Date night', 'Romance without the eye-rolls', { with_genres: '10749', 'vote_average.gte': 7, 'vote_count.gte': 1500 }, { moods: ['cozy'] }),
  movie('short', 'vibes', 'Under 95 minutes', 'Short, sharp, no filler', { 'with_runtime.lte': 95, 'with_runtime.gte': 70, 'vote_average.gte': 7, 'vote_count.gte': 1500 }, { moods: ['quick'] }),
  movie('epic', 'vibes', 'Epics worth the evening', 'Clear your night', { 'with_runtime.gte': 150, 'vote_average.gte': 7.8, 'vote_count.gte': 3000 }, { moods: ['epic'] }),
  movie('truestory', 'vibes', 'Based on a true story', 'It really happened', { with_keywords: ['based on true story'], 'vote_average.gte': 7.2, 'vote_count.gte': 1500 }, { moods: ['tense'] }),
  movie('cult', 'vibes', 'Cult classics', 'Weird, loved, rewatched', { with_keywords: ['cult film'], 'vote_average.gte': 6.8, 'vote_count.gte': 800 }, { moods: ['funny', 'mindbend'] }),
  movie('docs', 'vibes', 'Documentaries that grip', 'Real, and hard to look away', { with_genres: '99', 'vote_average.gte': 7.5, 'vote_count.gte': 300 }, { moods: ['tense'] }),
  // ---- series
  { id: 'crimeseries', group: 'series', title: 'Crime series', sub: 'Cases that keep you up', kind: 'tv', q: { with_genres: '80', 'vote_average.gte': 8, 'vote_count.gte': 500 }, moods: ['binge', 'tense'] },
  { id: 'mini', group: 'series', title: 'Miniseries', sub: 'One season, finished properly', kind: 'tv', q: { with_type: '2', 'vote_average.gte': 7.8, 'vote_count.gte': 300 }, moods: ['binge'] },
  { id: 'scifiseries', group: 'series', title: 'Sci-fi & fantasy series', sub: 'Worlds worth a season pass', kind: 'tv', q: { with_genres: '10765', 'vote_average.gte': 7.8, 'vote_count.gte': 800 }, moods: ['binge', 'mindbend'] },
  { id: 'mysteryseries', group: 'series', title: 'Mystery series', sub: 'Slow reveals, big payoffs', kind: 'tv', q: { with_genres: '9648', 'vote_average.gte': 7.8, 'vote_count.gte': 500 }, moods: ['binge', 'tense'] },
  { id: 'animeseries', group: 'series', title: 'Anime series', sub: 'Start one tonight', kind: 'tv', q: { with_genres: '16', with_original_language: 'ja', 'vote_average.gte': 8, 'vote_count.gte': 300 }, moods: ['binge'] },
  // ---- eras & world cinema
  movie('e80', 'world', 'Back to the 80s', 'Practical effects and big hair', { 'primary_release_date.gte': '1980-01-01', 'primary_release_date.lte': '1989-12-31', 'vote_average.gte': 7, 'vote_count.gte': 1500 }, { moods: ['funny', 'adrenaline'] }),
  movie('e90', 'world', 'The 90s', 'The last great decade of the mid-budget film', { 'primary_release_date.gte': '1990-01-01', 'primary_release_date.lte': '1999-12-31', 'vote_average.gte': 7.3, 'vote_count.gte': 2500 }),
  movie('e00', 'world', 'The 2000s', 'DVD-era favourites', { 'primary_release_date.gte': '2000-01-01', 'primary_release_date.lte': '2009-12-31', 'vote_average.gte': 7.3, 'vote_count.gte': 3000 }),
  movie('korean', 'world', 'Korean cinema', 'Sharp, strange, brilliant', { with_original_language: 'ko', 'vote_average.gte': 7, 'vote_count.gte': 500 }, { moods: ['tense', 'mindbend'] }),
  movie('french', 'world', 'French thrillers & drama', 'Cool and clinical', { with_original_language: 'fr', with_genres: '53,80,18', 'vote_average.gte': 7, 'vote_count.gte': 400 }, { moods: ['tense'] }),
  // ---- by country: films and series from one place
  country('lithuanian', 'LT', 'lt', 'From Lithuania', 'Lithuanian films and series', 5),
  country('sweden', 'SE', 'sv', 'From Sweden', 'Nordic noir, Bergman and Swedish crime', 150, { moods: ['tense'] }),
  country('norway', 'NO', 'no', 'From Norway', 'Fjords, thrillers and dark comedy', 120, { moods: ['tense'] }),
  country('denmark', 'DK', 'da', 'From Denmark', 'Danish drama and crime', 150, { moods: ['tense'] }),
  country('finland', 'FI', 'fi', 'From Finland', 'Deadpan and dark', 40),
  country('iceland', 'IS', 'is', 'From Iceland', 'Small island, big landscapes', 30),
  country('poland', 'PL', 'pl', 'From Poland', 'Polish films and series', 100),
  country('latvia', 'LV', 'lv', 'From Latvia', 'Latvian films and series', 5),
  country('estonia', 'EE', 'et', 'From Estonia', 'Estonian films and series', 10),
  country('ukraine', 'UA', 'uk', 'From Ukraine', 'Ukrainian films and series', 20),
  country('uk', 'GB', '', 'From the UK', 'British films and series', 2000, { moods: ['funny'] }),
  country('ireland', 'IE', '', 'From Ireland', 'Irish films and series', 300),
  country('france', 'FR', 'fr', 'From France', 'French films and series', 800),
  country('germany', 'DE', 'de', 'From Germany', 'German films and series', 600, { moods: ['tense'] }),
  country('spain', 'ES', 'es', 'From Spain', 'Spanish thrillers, comedies and series', 500, { moods: ['tense', 'binge'] }),
  country('italy', 'IT', 'it', 'From Italy', 'Italian films and series', 600),
  country('japan', 'JP', 'ja', 'From Japan', 'Japanese films and series', 600, { moods: ['mindbend'] }),
  country('korea', 'KR', 'ko', 'From South Korea', 'K-thrillers and K-dramas', 400, { moods: ['tense', 'binge'] }),
  country('india', 'IN', '', 'From India', 'Indian films and series', 300),
  country('mexico', 'MX', 'es', 'From Mexico', 'Mexican films and series', 200),
  country('brazil', 'BR', 'pt', 'From Brazil', 'Brazilian films and series', 200),
  country('australia', 'AU', '', 'From Australia', 'Aussie films and series', 800, { moods: ['adrenaline'] }),
  country('turkey', 'TR', 'tr', 'From Turkey', 'Turkish films and series', 100),
  // ---- seasonal (only inside their window; they lead Home while active)
  { id: 'xmas', group: 'seasonal', title: 'Christmas', sub: 'Cosy, cheesy and the classics', kind: 'both', q: { with_keywords: ['christmas'], 'vote_count.gte': 150, 'vote_average.gte': 6.2 }, season: ['11-15', '01-06'], moods: ['cozy', 'family'] },
  { id: 'xmasdark', group: 'seasonal', title: 'Not-so-silent night', sub: 'Christmas, but make it dangerous', kind: 'movie', q: { with_keywords: ['christmas'], with_genres: '27,53,28', 'vote_count.gte': 150, 'vote_average.gte': 5.8 }, season: ['11-25', '12-31'], moods: ['tense'] },
  { id: 'halloween', group: 'seasonal', title: 'Halloween', sub: 'Pick your fear', kind: 'movie', q: { with_keywords: ['halloween'], 'vote_count.gte': 200, 'vote_average.gte': 6 }, season: ['09-25', '11-02'], moods: ['scary'] },
  { id: 'valentine', group: 'seasonal', title: "Valentine's", sub: 'For two', kind: 'movie', q: { with_genres: '10749', 'vote_average.gte': 7, 'vote_count.gte': 1500 }, season: ['02-01', '02-15'], moods: ['cozy'] },
  { id: 'summer', group: 'seasonal', title: 'Summer blockbusters', sub: 'Big screen energy', kind: 'movie', q: { with_genres: '28,12', 'vote_average.gte': 6.8, 'vote_count.gte': 4000 }, season: ['06-15', '08-31'], moods: ['adrenaline', 'family'] },
];
const BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]));

// is the date (default today) inside a [from, to] MM-DD window? windows may wrap the new year
export function inSeason(season, now = new Date()) {
  if (!season) return true;
  const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, [a, b] = season;
  return a <= b ? md >= a && md <= b : md >= a || md <= b;
}
const active = (now) => COLLECTIONS.filter((c) => inSeason(c.season, now));

// TMDB movie genre ids -> the ids series use
const TV_GENRE = { 28: 10759, 12: 10759, 878: 10765, 14: 10765, 10752: 10768, 10751: 10751 };
const tvGenres = (g) => [...new Set(String(g).split(/[,|]/).map((x) => TV_GENRE[x] || x))].join(',');

const kwCache = new Map();
async function keywordId(name) {
  if (!kwCache.has(name)) {
    kwCache.set(name, getJson(`${TMDB}/search/keyword?api_key=${tmdbKey()}&query=${encodeURIComponent(name)}`)
      .then((d) => { const r = d.results || []; return (r.find((x) => x.name.toLowerCase() === name.toLowerCase()) || r[0] || {}).id || 0; })
      .catch(() => { kwCache.delete(name); return 0; }));
  }
  return kwCache.get(name);
}

async function discover(kind, c, p) {
  const q = { ...c.q, ...(kind === 'tv' ? c.tv : {}) };
  const qs = new URLSearchParams({ api_key: tmdbKey(), sort_by: 'popularity.desc', page: String(p), include_adult: 'false' });
  for (const [k, v] of Object.entries(q)) {
    if (k === 'with_keywords') continue;
    if (kind === 'tv') { // series use first_air_date and have no runtime filter that means the same thing
      if (k.startsWith('with_runtime')) continue;
      qs.set(k.replace('primary_release_date', 'first_air_date'), k === 'with_genres' && !c.tv?.with_genres ? tvGenres(v) : v);
    } else qs.set(k, v);
  }
  if (q.with_keywords?.length) {
    const ids = (await Promise.all(q.with_keywords.map(keywordId))).filter(Boolean);
    if (!ids.length) return []; // none of the keywords exist: better an empty shelf than an unrelated one
    qs.set('with_keywords', ids.join('|'));
  }
  // movie-style genre lists mean "any of these" on the shelf pages: comma is AND in TMDB, so use the OR separator
  if (qs.has('with_genres') && !q.genreAll) qs.set('with_genres', qs.get('with_genres').replace(/,/g, '|'));
  return (await page(`${TMDB}/discover/${kind}?${qs}`)).map((x) => ({ ...x, _kind: kind }));
}

const cache = new Map();
// Cached for 30 minutes. Once a shelf is older than that it is still served straight away while a fresh copy loads
// behind it, so a click never waits on TMDB for a shelf it has seen before.
const memo = (k, fn, ttl = 30 * 60e3) => {
  const h = cache.get(k);
  if (h && (Date.now() - h.at < ttl || h.refreshing)) return h.v;
  const v = fn();
  if (h?.ok) { // stale: keep serving the old one until the new one is in
    h.refreshing = true;
    v.then(() => cache.set(k, { at: Date.now(), v, ok: true }), () => { h.refreshing = false; h.at = Date.now() - ttl + 60e3; });
    return h.v;
  }
  cache.set(k, { at: Date.now(), v });
  v.then(() => { const c = cache.get(k); if (c?.v === v) c.ok = true; }, () => { if (cache.get(k)?.v === v) cache.delete(k); });
  return v;
};

// One page (20 titles per kind) of a shelf. Films and series shelves interleave.
export async function getCollection(id, { skip = 0, type = '' } = {}) {
  const c = BY_ID.get(id); if (!c || !tmdbKey()) return null;
  const p = 1 + Math.floor((Number(skip) || 0) / 20);
  const kinds = c.kind === 'both' ? (type === 'movie' ? ['movie'] : type === 'series' ? ['tv'] : ['movie', 'tv']) : [c.kind];
  return memo(`col:${id}:${kinds}:${p}`, async () => {
    const lists = await Promise.all(kinds.map((k) => discover(k, c, p).catch(() => [])));
    const merged = []; for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) merged.push(l[i]);
    const seen = new Set();
    return shape(merged.filter((x) => !seen.has(x.id) && seen.add(x.id)), (x) => (x.vote_average >= 8 ? 'Acclaimed' : ''));
  });
}

export const collectionInfo = ({ id, group, title, sub, kind, moods = [], season }) => ({ id, group, title, sub, kind, moods, seasonal: !!season, live: inSeason(season) });
export function listCollections(now = new Date()) {
  return { groups: GROUPS, moods: MOODS, collections: COLLECTIONS.map((c) => ({ ...collectionInfo(c), live: inSeason(c.season, now) })) };
}

// Which shelves Home shows. In season shelves lead; otherwise a rotating pick across groups, weighted toward suspense and
// action. A mood narrows it to shelves tagged with that mood. `seed` changes every half hour so Home keeps moving.
export function pickShelves({ mood = '', seed = 0, now = new Date(), n = 8 } = {}) {
  const r = rnd(Number(seed) || 1), pool = active(now), live = pool.filter((c) => c.season);
  if (mood) return shuffle(pool.filter((c) => c.moods?.includes(mood)), Math.floor(r() * 1e9)).slice(0, n);
  const plan = [['suspense', 2], ['action', 2], ['dark', 1], ['scifi', 1], ['animation', 1], ['vibes', 1], ['series', 1], ['world', 1], ['countries', 1]];
  const out = [...live.slice(0, 2)];
  for (const [g, k] of plan) out.push(...shuffle(pool.filter((c) => c.group === g), Math.floor(r() * 1e9)).slice(0, k));
  // lead with a suspense/action shelf after the seasonal ones, then interleave the rest
  return out.slice(0, n + live.length);
}

// The shelves for Home as ready-to-paint sections
export async function homeShelves({ mood = '', seed = 0 } = {}) {
  const picks = pickShelves({ mood, seed });
  const r = rnd(Number(seed) || 1);
  const sections = await Promise.all(picks.map(async (c) => {
    const [a, b] = await Promise.all([getCollection(c.id, { skip: 0 }), getCollection(c.id, { skip: 20 })]).catch(() => [[], []]);
    const items = shuffle([...(a || []), ...(b || [])], Math.floor(r() * 1e9)).slice(0, 16);
    return items.length >= 5 ? { id: `col_${c.id}`, title: c.title, sub: c.sub, group: c.group, seasonal: !!c.season, items, more: `#/feed/col_${c.id}` } : null;
  }));
  return sections.filter(Boolean);
}

// Load every shelf a "Tonight I want" chip or Home can show ahead of time, a few at a time, so picking a mood paints
// from memory instead of waiting on a few hundred TMDB lookups. Run at start and every 25 minutes after.
export async function warmShelves({ concurrency = 3 } = {}) {
  if (!tmdbKey()) return;
  const queue = active(new Date()).flatMap((c) => [[c.id, 0], [c.id, 20]]);
  const work = async () => { for (let j; (j = queue.shift());) await getCollection(j[0], { skip: j[1] }).catch(() => {}); };
  await Promise.all(Array.from({ length: concurrency }, work));
}

// ---- endless scrolling: where a chart or shelf runs out, keep going with fresh titles of the same kind ----
const GENRE_ID = { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99, Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749, 'Sci-Fi': 878, Thriller: 53, War: 10752, Western: 37 };
const ENDLESS = {
  popular: { 'vote_count.gte': 150 },
  top: { sort_by: 'vote_average.desc', 'vote_count.gte': 1200, 'vote_average.gte': 7 },
  gems: { sort_by: 'vote_average.desc', 'vote_count.gte': 120, 'vote_count.lte': 2500, 'vote_average.gte': 7.2 },
  surprise: { 'vote_count.gte': 300, 'vote_average.gte': 6.6 },
  foryou: { 'vote_count.gte': 300, 'vote_average.gte': 6.4 },
};
// One page of "more like this" for a feed that ran out. `page` counts from 1; `foryou` re-ranks each page by your taste.
export async function endless({ mode = 'popular', type = '', genre = '', page = 1, seed = 0 } = {}) {
  if (!tmdbKey()) return [];
  const kinds = type === 'movie' ? ['movie'] : type === 'series' ? ['tv'] : ['movie', 'tv'];
  const spec = ENDLESS[mode] || ENDLESS.popular, p = mode === 'surprise' ? 1 + Math.floor(rnd((Number(seed) || 1) + Number(page))() * 120) : Math.min(Math.max(1, Number(page) || 1), 300);
  const q = { ...spec, ...(GENRE_ID[genre] ? { with_genres: String(GENRE_ID[genre]) } : {}) };
  const out = await memo(`end:${mode}:${kinds}:${q.with_genres || ''}:${p}`, async () => {
    const lists = await Promise.all(kinds.map((k) => discover(k, { q: k === 'tv' ? { ...q, 'vote_count.gte': Math.round((q['vote_count.gte'] || 0) / 3) } : q }, p).catch(() => [])));
    const merged = []; for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) merged.push(l[i]);
    return shape(merged, () => '');
  });
  if (mode !== 'foryou') return out;
  const { tasteHint } = await import('./recommend.js');
  return [...out].sort((a, b) => (tasteHint(b.genres || []) + Number(b.rating || 0) * 0.15) - (tasteHint(a.genres || []) + Number(a.rating || 0) * 0.15));
}
