// Your profile: what you watched, your favourites, numbers, medals and friends. All of it from your own IronHide.
import { $, esc, icon, avatar } from '../ui.js';
import { api } from '../api.js';
import { store } from '../main.js';

const poster = (id) => `https://images.metahub.space/poster/small/${id}/img`;
const route = (x) => `#/title/${x.type === 'tv' || x.type === 'series' ? 'series' : 'movie'}/${x.imdbId}`;
const num = (n) => Number(n || 0).toLocaleString();
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const IS_TV = (p) => p.type === 'tv' || p.type === 'series';

// ---------- turning the history into numbers ----------
function crunch(plays, ratings, friends) {
  const eps = new Map(); // one row per film or episode, however many times it was resumed
  for (const p of plays) {
    const k = `${p.imdbId}:${p.season}:${p.episode}`, c = eps.get(k);
    const secs = Math.max(0, p.position || 0), pct = p.percent || 0, at = +new Date(p.watchedAt);
    if (!c) eps.set(k, { ...p, secs, pct, at, first: at });
    else { c.secs = Math.max(c.secs, secs); c.pct = Math.max(c.pct, pct); if (at > c.at) c.at = at; if (at < c.first) c.first = at; }
  }
  const rows = [...eps.values()], films = rows.filter((r) => !IS_TV(r)), episodes = rows.filter(IS_TV);
  const hours = rows.reduce((a, r) => a + r.secs, 0) / 3600, finished = rows.filter((r) => r.pct >= 90);
  const shows = new Map();
  for (const r of episodes) { const s = shows.get(r.imdbId) || { imdbId: r.imdbId, type: 'series', title: r.title, secs: 0, eps: 0, at: 0 }; s.secs += r.secs; s.eps++; s.at = Math.max(s.at, r.at); shows.set(r.imdbId, s); }
  // days
  const days = new Map();
  for (const r of rows) { const d = dayKey(r.at); days.set(d, (days.get(d) || 0) + r.secs / 3600); }
  for (const p of plays) { const d = dayKey(p.watchedAt); if (!days.has(d)) days.set(d, 0); }
  const has = (d) => days.has(dayKey(d));
  let streak = 0, c = new Date(); if (!has(c)) c = new Date(Date.now() - 864e5);
  while (has(c)) { streak++; c = new Date(c.getTime() - 864e5); }
  let best = 0, run = 0, prev = null;
  for (const d of [...days.keys()].sort()) { run = prev && (+new Date(`${d}T12:00`) - +new Date(`${prev}T12:00`)) < 1.5 * 864e5 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  // a day with three or more episodes of one show
  const binge = {}; for (const r of episodes) { const k = `${r.imdbId}:${dayKey(r.at)}`; binge[k] = (binge[k] || 0) + 1; }
  const maxBinge = Math.max(0, ...Object.values(binge)), maxShow = Math.max(0, ...[...shows.values()].map((s) => s.eps));
  // one per film or episode per night: resuming the same thing five times is still one late night
  const nights = new Set(plays.filter((p) => new Date(p.watchedAt).getHours() < 5).map((p) => `${p.imdbId}:${p.season}:${p.episode}:${dayKey(p.watchedAt)}`)).size;
  const since = Math.min(...plays.map((p) => +new Date(p.watchedAt)), ...ratings.map((r) => +new Date(r.ratedAt)), Date.now());
  return { rows, films, episodes, hours, finished, shows: [...shows.values()], days, streak, best, maxBinge, maxShow, nights, since, friends: friends.length, rated: ratings.length };
}

// ---------- medals ----------
// Each medal has tiers. Only what actually happened counts.
const MEDALS = [
  { id: 'hours', name: 'Screen time', what: 'Hours watched', icon: 'eye', tiers: [10, 50, 200, 1000], val: (x) => Math.floor(x.hours) },
  { id: 'films', name: 'Film buff', what: 'Different films', icon: 'film', tiers: [5, 25, 100, 500], val: (x) => x.films.length },
  { id: 'eps', name: 'Series regular', what: 'Different episodes', icon: 'tv', tiers: [10, 50, 250, 1000], val: (x) => x.episodes.length },
  { id: 'done', name: 'Finisher', what: 'Watched to the end', icon: 'check', tiers: [5, 25, 100, 500], val: (x) => x.finished.length },
  { id: 'binge', name: 'Just one more', what: 'Episodes of a show in one day', icon: 'flame', tiers: [3, 6, 10, 20], val: (x) => x.maxBinge },
  { id: 'streak', name: 'On a roll', what: 'Days in a row', icon: 'bolt', tiers: [3, 7, 30, 100], val: (x) => x.best },
  { id: 'night', name: 'Night owl', what: 'Started between midnight and 5', icon: 'moon', tiers: [5, 25, 100, 300], val: (x) => x.nights },
  { id: 'critic', name: 'Critic', what: 'Ratings given', icon: 'star', tiers: [5, 25, 100, 300], val: (x) => x.rated },
  { id: 'friends', name: 'Good company', what: 'Friends added', icon: 'user', tiers: [1, 3, 10, 25], val: (x) => x.friends },
];
const TIER = ['Bronze', 'Silver', 'Gold', 'Diamond'];
function medalHtml(m, x) {
  const v = m.val(x), got = m.tiers.filter((t) => v >= t).length, next = m.tiers[got], from = m.tiers[got - 1] || 0;
  const pct = next ? Math.min(100, ((v - from) / (next - from)) * 100) : 100, cls = got ? `t${got}` : 'off';
  return `<div class="md ${cls}" title="${esc(m.what)}">
    <span class="md-art"><svg viewBox="0 0 64 72" aria-hidden="true"><path class="md-hex" d="M32 3 59 18.5v35L32 69 5 53.5v-35z"/><path class="md-in" d="M32 10 53 22v28L32 62 11 50V22z"/></svg>${icon(m.icon)}</span>
    <div class="md-t"><b>${esc(m.name)}</b><small>${got ? TIER[got - 1] : 'Not earned yet'}</small>
    <div class="md-bar"><i style="width:${pct}%"></i></div><small class="md-n">${next ? `${num(v)} / ${num(next)} ${esc(m.what.toLowerCase())}` : `${num(v)} ${esc(m.what.toLowerCase())}: top tier`}</small></div></div>`;
}

// ---------- pieces ----------
const card = (x, sub, extra = '') => `<a class="pf-c" href="${route(x)}" title="${esc(x.title)}"><span class="pf-p" style="background-image:url('${esc(x.poster || poster(x.imdbId))}')">${extra}</span><b>${esc(x.title)}</b>${sub ? `<small>${sub}</small>` : ''}</a>`;
const section = (title, sub, body, cls = '') => `<section class="pf-s ${cls}"><header><h2>${esc(title)}</h2>${sub ? `<span>${sub}</span>` : ''}</header>${body}</section>`;
const empty = (t) => `<p class="pf-empty">${esc(t)}</p>`;
const ago = (t) => { const d = Math.floor((Date.now() - t) / 864e5); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };

// Six months of days, like a contribution graph
function heatmap(days) {
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const start = new Date(today.getTime() - 25 * 7 * 864e5); start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const cells = []; let months = '', last = -1, w = 0;
  for (let d = new Date(start); d <= today; d = new Date(d.getTime() + 864e5)) {
    const h = days.get(dayKey(d)), on = h !== undefined, lv = !on ? 0 : h < 0.5 ? 1 : h < 1.5 ? 2 : h < 3 ? 3 : 4;
    cells.push(`<i class="l${lv}" title="${esc(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}: ${on ? `${h.toFixed(1)} h` : 'nothing'}"></i>`);
    if (((d.getDay() + 6) % 7) === 0) { if (d.getMonth() !== last) { last = d.getMonth(); months += `<em style="grid-column:${w + 1}">${d.toLocaleDateString(undefined, { month: 'short' })}</em>`; } w++; }
  }
  return `<div class="pf-heat"><div class="pf-hm" style="grid-template-columns:repeat(${w},1fr)">${months}</div><div class="pf-hg" style="grid-template-columns:repeat(${w},1fr)">${cells.join('')}</div></div>`;
}
const bars = (rows, label, val, fmt) => { const top = Math.max(...rows.map(val), 0.01); return `<div class="pf-bars">${rows.map((r) => `<div><span>${label(r)}</span><i><u style="width:${(val(r) / top) * 100}%"></u></i><b>${fmt(r)}</b></div>`).join('')}</div>`; };

// ---------- the page ----------
export default async function profile(el, params = {}) {
  const fid = params.id;
  el.innerHTML = `<div class="page pf"><div class="pf-load">Loading ${fid ? 'profile' : 'your profile'}…</div></div>`;
  const social = await api('/api/social').catch(() => ({ friends: [] }));
  const buddy = fid ? (social.friends || []).find((f) => f.id === fid) : null;
  if (fid === social.you?.id) { location.hash = '#/profile'; return; }
  let got = null;
  if (fid) {
    const back = `<p><a class="btn sm" href="#/friends">Back to Friends</a></p>`;
    if (!buddy) { $('.pf', el).innerHTML = `<div class="pf-load">This person isn't on your friends list.${back}</div>`; return; }
    got = await api(`/api/social/friends/${encodeURIComponent(fid)}/profile`).catch(() => ({ none: 'offline' }));
    if (location.hash !== `#/profile/${fid}`) return;
    if (got.none) { $('.pf', el).innerHTML = `<div class="pf-closed"><span class="pf-av">${avatar({ avatar: buddy.avatar }, 112)}</span><h1>${esc(buddy.name)}</h1><p>${got.none === 'private' ? `${esc(buddy.name)} keeps their profile private.` : `${esc(buddy.name)} is offline, and you haven't seen their profile before. It opens once they're online.`}</p>${back}</div>`; return; }
  }
  const data = fid ? got.profile : await api('/api/profile');
  const me = fid ? { name: buddy.name, avatar: buddy.avatar } : store.settings.profile;
  const friends = fid ? { length: data.friendCount || 0 } : social.friends || [], x = crunch(data.plays, data.ratings, friends);
  const hoursTxt = x.hours >= 100 ? num(Math.round(x.hours)) : x.hours.toFixed(1);
  const stat = (v, k, s = '') => `<div class="pf-st"><b>${v}</b><span>${esc(k)}</span>${s ? `<small>${esc(s)}</small>` : ''}</div>`;
  // recent titles: one card per film or show
  const recent = new Map(); for (const r of [...x.rows].sort((a, b) => b.at - a.at)) if (!recent.has(r.imdbId)) recent.set(r.imdbId, r);
  const favs = [...data.ratings].filter((r) => r.rating >= 4).sort((a, b) => b.rating - a.rating || +new Date(b.ratedAt) - +new Date(a.ratedAt));
  const topShows = [...x.shows].sort((a, b) => b.secs - a.secs).slice(0, 6);
  const filmH = x.films.reduce((a, r) => a + r.secs, 0) / 3600, tvH = x.episodes.reduce((a, r) => a + r.secs, 0) / 3600, share = filmH + tvH ? (filmH / (filmH + tvH)) * 100 : 50;
  const earned = MEDALS.filter((m) => m.val(x) >= m.tiers[0]).length;
  const stars = (n) => `<span class="pf-stars">${'★'.repeat(n)}</span>`;
  const presence = (f) => (f.inRoom ? `In ${esc(f.inRoom.name)}` : f.status?.title ? `Watching ${esc(f.status.title)}` : f.online ? 'Online' : 'Offline');

  $('.pf', el).innerHTML = `
    <header class="pf-hero">
      <span class="pf-av">${avatar(me, 112)}</span>
      <div class="pf-who"><h1>${esc(me.name)}</h1><p>${fid ? `${buddy.online ? 'Online' : 'Offline'}${got.live ? '' : ` · last updated ${esc(ago(got.at).toLowerCase())}`} · ` : ''}Watching with IronHide since ${new Date(x.since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} · ${earned} of ${MEDALS.length} medals · ${friends.length} friend${friends.length === 1 ? '' : 's'}</p></div>
      <div class="pf-acts">${fid ? `<a class="btn sm" href="#/friends">${icon('users')} Friends</a><button class="btn sm" id="pfRm">Remove friend</button>` : `<a class="btn sm" href="#/settings/profile">${icon('user')} Edit profile</a>`}</div>
    </header>
    <div class="pf-stats">${stat(hoursTxt, 'hours watched')}${stat(num(x.films.length), x.films.length === 1 ? 'film' : 'films')}${stat(num(x.shows.length), x.shows.length === 1 ? 'show' : 'shows', `${num(x.episodes.length)} episodes`)}${stat(num(x.finished.length), 'finished')}${stat(num(x.streak), 'day streak', `best ${x.best}`)}${stat(num(data.watchlist.length), fid ? 'on their list' : 'on your list')}</div>

    ${section('Recently watched', '', recent.size ? `<div class="pf-row">${[...recent.values()].slice(0, 14).map((r) => card(r, IS_TV(r) ? `S${r.season} E${r.episode} · ${ago(r.at)}` : ago(r.at), r.pct > 0 && r.pct < 97 ? `<i class="pf-prog"><u style="width:${r.pct}%"></u></i>` : '')).join('')}</div>` : empty(fid ? 'Nothing yet.' : 'Nothing yet. Press play on something.'))}

    <div class="pf-two">
      ${section('Activity', `${num(x.days.size)} days with something on`, heatmap(x.days))}
      ${section('Films and shows', '', `<div class="pf-split"><i style="width:${share}%"></i></div><div class="pf-leg"><span><u class="a"></u>Films · ${filmH.toFixed(1)} h</span><span><u class="b"></u>Shows · ${tvH.toFixed(1)} h</span></div><div id="pfGenres"></div>`)}
    </div>

    ${fid ? '' : section('Your taste', 'What your picks are built from · <a href="#/taste">Open Taste Lab</a>', '<div id="pfTaste" class="tz"><p class="pf-empty">Reading your taste…</p></div>')}
    ${section('Favourites', fid ? 'Rated 4 or 5 stars' : 'Everything you rated 4 or 5 stars', favs.length ? `<div class="pf-row">${favs.slice(0, 14).map((r) => card(r, stars(r.rating))).join('')}</div>` : empty(fid ? 'No favourites yet.' : 'Rate something 4 or 5 stars and it lands here.'))}

    <div class="pf-two">
      ${section('Waiting for', fid ? 'Next episodes of what they watch' : 'Next episodes of what you watch', '<div id="pfNext" class="pf-next"><p class="pf-empty">Checking release dates…</p></div>')}
      ${section('Most watched shows', '', topShows.length ? bars(topShows, (s) => `<a href="${route(s)}">${esc(s.title)}</a>`, (s) => s.secs, (s) => `${(s.secs / 3600).toFixed(1)} h`) : empty('No shows yet.'))}
    </div>

    ${section(fid ? 'Their list' : 'Your list', `${num(data.watchlist.length)} saved`, data.watchlist.length ? `<div class="pf-row">${data.watchlist.slice(0, 14).map((w) => card(w, esc(w.year || ''))).join('')}</div>` : empty(fid ? 'Nothing saved yet.' : 'Bookmark a title and it shows up here.'))}

    ${section('Medals', `${earned} of ${MEDALS.length} earned`, `<div class="pf-medals">${MEDALS.map((m) => medalHtml(m, x)).join('')}</div>`)}

    ${fid ? '' : section('Friends', friends.length ? `${friends.filter((f) => f.online).length} online` : '', friends.length ? `<div class="pf-fr">${friends.map((f) => `<a href="#/profile/${esc(f.id)}" class="${f.online ? 'on' : ''}"><span>${avatar(f, 44)}</span><div><b>${esc(f.name)}</b><small>${presence(f)}</small></div></a>`).join('')}</div>` : `<p class="pf-empty">No friends yet. <a href="#/friends">Add one here</a>.</p>`)}
    <p class="pf-note">${fid ? 'Hours count how far they got in each film or episode once.' : "Hours count how far you got in each film or episode once, so rewatches don't add up. Until now IronHide only kept your last 100 plays, so older watching isn't counted. From here on it keeps 5,000. Friends can see this page: you can turn that off in Settings, Together."}</p>`;

  $('#pfRm', el)?.addEventListener('click', async () => { if (!confirm(`Remove ${buddy.name} from your friends?`)) return; await fetch(`/api/social/friends/${encodeURIComponent(fid)}`, { method: 'DELETE' }); location.hash = '#/friends'; });
  // taste profile (from what you watch and rate): computed by the recommendation engine
  if (!fid) api('/api/taste').then((t) => {
    const tz = $('#pfTaste', el); if (!tz) return;
    if (t.error) { tz.innerHTML = `<p class="pf-empty">${esc(t.error)}</p>`; return; }
    const max = Math.max(...(t.genres || []).map((g) => g.score), 0.01);
    const chips = (list) => list.map((x) => `<span>${esc(x.name)}</span>`).join('');
    tz.innerHTML = `
      <div class="tz-top"><div class="tz-meter"><b>${t.strength}%</b><small>taste known</small><i><u style="width:${t.strength}%"></u></i></div>
        <p>Built from <b>${t.watched}</b> titles you watched${t.rated ? ` and <b>${t.rated}</b> you rated (avg ${t.avgRating}★)` : ''}. You lean toward <b>${t.leaning === 'both' ? 'films and series equally' : t.leaning}</b>.${t.rated < 10 ? ' Rating more titles makes your picks sharper.' : ''}</p></div>
      <div class="tz-grid">
        <div><h4>Genres you love</h4>${(t.genres || []).map((g) => `<div class="tz-bar"><span>${esc(g.name)}</span><i><u style="width:${Math.round((g.score / max) * 100)}%"></u></i></div>`).join('') || '<p class="pf-empty">Not enough yet.</p>'}
          ${t.avoid?.length ? `<h4 class="tz-sub">Less your thing</h4><div class="tz-chips dim">${chips(t.avoid)}</div>` : ''}</div>
        <div><h4>Themes that pull you in</h4><div class="tz-chips">${chips(t.themes || [])}</div>
          <h4 class="tz-sub">People you follow</h4><div class="tz-chips">${chips(t.people || [])}</div>
          ${t.languages?.length ? `<h4 class="tz-sub">Languages</h4><div class="tz-chips">${chips(t.languages)}</div>` : ''}
          ${t.decades?.length ? `<h4 class="tz-sub">Eras</h4><div class="tz-chips">${chips(t.decades)}</div>` : ''}</div>
      </div>
      ${t.favourites?.length ? `<h4 class="tz-sub">Shaping your picks most</h4><div class="tz-favs">${t.favourites.map((f) => `<a href="#/title/${f.type}/${f.imdbId}"><i style="background-image:url('${esc(f.poster)}')"></i><span>${esc(f.title)}</span>${f.rating ? `<em>${'★'.repeat(f.rating)}</em>` : ''}</a>`).join('')}</div>` : ''}`;
  }).catch(() => {});
  // release dates and genres come from the catalog, so they arrive a moment later
  (fid ? Promise.resolve({ upcoming: data.upcoming || [], genres: data.genres || [] }) : api('/api/profile/meta')).then((m) => {
    const next = $('#pfNext', el), g = $('#pfGenres', el); if (!next) return;
    const inDays = (d) => { const n = Math.round((+new Date(`${d}T12:00`) - Date.now()) / 864e5); return n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 14 ? `In ${n} days` : new Date(`${d}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
    next.innerHTML = m.upcoming.length ? m.upcoming.slice(0, 8).map((u) => `<a href="#/title/series/${u.imdbId}"><span class="pf-np" style="background-image:url('${esc(u.poster || poster(u.imdbId))}')"></span><div><b>${esc(u.title)}</b><small>S${u.season} E${u.episode}${u.name ? ` · ${esc(u.name)}` : ''}</small></div><em>${esc(inDays(u.released))}</em></a>`).join('') : empty('Nothing with a release date right now.');
    if (m.genres.length && g) g.innerHTML = bars(m.genres, (r) => esc(r.name), (r) => r.hours, (r) => `${r.hours.toFixed(1)} h`);
  }).catch(() => { const n = $('#pfNext', el); if (n) n.innerHTML = empty("Couldn't reach the catalog."); });
}
