// Your profile: what you watched, your favourites, numbers, medals and friends. All of it from your own Orbie.
import { $, $$, esc, icon, avatar, ask, posterCard } from '../ui.js';
import { api } from '../api.js';
import { store } from '../main.js';

const poster = (id) => `https://images.metahub.space/poster/small/${id}/img`;
const route = (x) => `#/title/${x.type === 'tv' || x.type === 'series' ? 'series' : 'movie'}/${x.imdbId}`;
const num = (n) => Number(n || 0).toLocaleString();
const dayKey = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const IS_TV = (p) => p.type === 'tv' || p.type === 'series';
const withTimeout = (promise, ms, fallback) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);

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
// the same poster card as Home (size, tilt, hover), so rows here feel like the rest of the app
const card = (x, sub, extra = '') => posterCard({ ...x, poster: x.poster || poster(x.imdbId) }, { sub, extra });
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
export default function profile(el, params = {}) {
  const fid = params.id;
  el.innerHTML = `<div class="page pf"><header class="pf-hero"><span class="pf-av">${fid ? '' : avatar(store.settings?.profile || {}, 112)}</span><div class="pf-who"><h1>${fid ? 'Profile' : esc(store.settings?.profile?.name || 'Your profile')}</h1><p>${fid ? 'Loading profile details…' : 'Your Orbie profile'}</p></div>${fid ? '' : '<div class="pf-acts"><a class="btn sm" href="#/settings/profile">Edit profile</a></div>'}</header><p class="pf-empty">${fid ? 'Loading profile details…' : 'Loading your profile details…'}</p></div>`;
  // Do not hold the whole profile screen behind social sync. The local profile
  // data is enough to render a useful page, and sync can be stale or slow while
  // the daemon is reconnecting.
  const social = { friends: [] };
  const buddy = null;
  if (fid) {
    $('.pf', el).innerHTML = `<div class="pf-closed"><h1>Friend profile</h1><p>Open a friend profile from Together so their shared data can be loaded securely.</p><p><a class="btn sm" href="#/friends">Back to Friends</a></p></div>`;
    return;
  }
  const data = {
    plays: store.history || [],
    ratings: [],
    watchlist: store.watchlist || []
  };
  // Keep the route usable if a slow local service or catalog call misses the first window.
  // The profile is local and can safely render its empty state while the next reload retries.
  const safe = data || { plays: [], ratings: [], watchlist: [] };
  const me = fid ? { name: buddy.name, avatar: buddy.avatar } : store.settings.profile;
  const friends = fid ? { length: safe.friendCount || 0 } : social.friends || [], x = crunch(safe.plays, safe.ratings, friends);
  const hoursTxt = x.hours >= 100 ? num(Math.round(x.hours)) : x.hours.toFixed(1);
  const stat = (v, k, s = '') => `<div class="pf-st"><b>${v}</b><span>${esc(k)}</span>${s ? `<small>${esc(s)}</small>` : ''}</div>`;
  // recent titles: one card per film or show
  const recent = new Map(); for (const r of [...x.rows].sort((a, b) => b.at - a.at)) if (!recent.has(r.imdbId)) recent.set(r.imdbId, r);
  const favs = [...safe.ratings].filter((r) => r.rating >= 4).sort((a, b) => b.rating - a.rating || +new Date(b.ratedAt) - +new Date(a.ratedAt));
  const topShows = [...x.shows].sort((a, b) => b.secs - a.secs).slice(0, 6);
  const filmH = x.films.reduce((a, r) => a + r.secs, 0) / 3600, tvH = x.episodes.reduce((a, r) => a + r.secs, 0) / 3600, share = filmH + tvH ? (filmH / (filmH + tvH)) * 100 : 50;
  const earned = MEDALS.filter((m) => m.val(x) >= m.tiers[0]).length;
  const stars = (n) => `<span class="pf-stars">${'★'.repeat(n)}</span>`;
  const presence = (f) => (f.inRoom ? `In ${esc(f.inRoom.name)}` : f.status?.title ? `Watching ${esc(f.status.title)}` : f.online ? 'Online' : 'Offline');

  // laid out as tiles: the page keeps its shape from day one, and fills in as you watch
  const fresh = !recent.size && !favs.length && !safe.watchlist.length;
  const row = (list) => `<div class="pf-row">${list}</div>`;
  const tile = (cls, title, body, aside = '') => `<section class="bt ${cls}">${title ? `<header><h2>${title}</h2>${aside ? `<span>${aside}</span>` : ''}</header>` : ''}${body}</section>`;
  const month = new Date(x.since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const week = [...Array(7)].map((_, i) => x.days.has(dayKey(Date.now() - (6 - i) * 864e5)));
  const big = (v, unit) => `<p class="bt-num">${v}<small>${unit}</small></p>`;
  const slots = `<div class="pf-slots" aria-hidden="true">${'<i></i>'.repeat(7)}</div>`;
  const recentCards = [...recent.values()].slice(0, 14).map((r) => card(r, IS_TV(r) ? `S${r.season} E${r.episode} · ${ago(r.at)}` : ago(r.at), r.pct > 0 && r.pct < 97 ? `<div class="bprog"><i style="width:${Math.max(4, Math.round(r.pct))}%"></i></div>` : '')).join('');
  $('.pf', el).innerHTML = `
    <div class="bento">
      <div class="bt bt-photo">${avatar(me, 300)}</div>
      <section class="bt bt-who">
        <div><h1>${esc(me.name)}</h1><p>With Orbie since ${month}</p></div>
        <div class="bt-counts"><span><b>${num(x.films.length)}</b>${x.films.length === 1 ? 'film' : 'films'}</span><span><b>${num(x.shows.length)}</b>${x.shows.length === 1 ? 'show' : 'shows'}</span><span><b>${num(x.finished.length)}</b>finished</span><a href="#/settings/profile">Edit profile</a></div>
      </section>
      ${tile('bt-hours', 'Watched', big(hoursTxt, 'hours'))}
      ${tile('bt-activity', 'Activity', heatmap(x.days), `${num(x.days.size)} ${x.days.size === 1 ? 'day' : 'days'}`)}
      ${tile('bt-streak', 'Current streak', `${big(`${icon('flame')}${num(x.streak)}`, x.streak === 1 ? 'day' : 'days')}<div class="bt-dots" aria-label="The last seven days">${week.map((on) => `<i class="${on ? 'on' : ''}"></i>`).join('')}</div>`)}
      ${tile('bt-best', 'Longest streak', `${big(`${icon('flame')}${num(x.best)}`, x.best === 1 ? 'day' : 'days')}<p class="bt-sub">${x.best && x.streak === x.best ? 'You are on it right now' : 'Your record so far'}</p>`)}
      ${tile('bt-recent', 'Recently watched', recent.size ? row(recentCards) : `${slots}<div class="pf-cta"><p>Nothing watched yet.</p><a class="btn primary" href="#/">Find something to watch</a></div>`)}
      ${tile('bt-medals', 'Medals', `<div class="bt-badges">${MEDALS.map((m) => { const v = m.val(x), got = m.tiers.filter((t) => v >= t).length; return `<span class="bdg t${got}" title="${esc(m.name)}: ${got ? TIER[got - 1] : `${num(v)} of ${num(m.tiers[0])} ${esc(m.what.toLowerCase())}`}">${icon(m.icon)}</span>`; }).join('')}</div>`, `${MEDALS.filter((m) => m.val(x) >= m.tiers[0]).length} of ${MEDALS.length}`)}
      ${tile('bt-shows', 'Most watched shows', topShows.length ? bars(topShows.slice(0, 5), (s) => `<a href="${route(s)}">${esc(s.title)}</a>`, (s) => s.secs, (s) => `${(s.secs / 3600).toFixed(1)} h`) : '<p class="bt-sub">Shows you watch rank here.</p>')}
      ${favs.length ? tile('bt-wide', 'Favourites', row(favs.slice(0, 14).map((r) => card(r, stars(r.rating))).join(''))) : ''}
      ${safe.watchlist.length ? tile('bt-wide', 'Your list', row(safe.watchlist.slice(0, 14).map((w) => card(w, esc(w.year || ''))).join('')), `${num(safe.watchlist.length)} saved`) : ''}
      <div id="pfNextWrap" class="bt-slot"></div>
      <div id="pfTasteWrap" class="bt-slot"></div>
    </div>`;


  $('#pfRm', el)?.addEventListener('click', async () => { if (!(await ask(`Remove ${buddy.name} from your friends?`, { ok: 'Remove', danger: true }))) return; await fetch(`/api/social/friends/${encodeURIComponent(fid)}`, { method: 'DELETE' }); location.hash = '#/friends'; });
  // taste profile (from what you watch and rate): computed by the recommendation engine
  if (!fresh) api('/api/taste').then((t) => {
    const wrap = $('#pfTasteWrap', el); if (!wrap || t.error) return;
    const chips = (list) => (list || []).map((c) => `<span>${esc(c.name)}</span>`).join('');
    const body = [['Genres', t.genres], ['Themes', t.themes], ['People', t.people]].filter(([, l]) => l?.length)
      .map(([k, l]) => `<div><h4>${k}</h4><div class="tz-chips">${chips(l.slice(0, 8))}</div></div>`).join('');
    if (body) wrap.innerHTML = `<section class="bt bt-wide"><header><h2>Your taste</h2><span><a href="#/taste">Open Taste Lab</a></span></header><div class="pf-taste">${body}</div></section>`;
  }).catch(() => {});
  // release dates come from the catalog, so they arrive a moment later
  if (!fresh) api('/api/profile/meta').then((m) => {
    const wrap = $('#pfNextWrap', el); if (!wrap || !m.upcoming?.length) return;
    const inDays = (d) => { const n = Math.round((+new Date(`${d}T12:00`) - Date.now()) / 864e5); return n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : n < 14 ? `In ${n} days` : new Date(`${d}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
    wrap.innerHTML = `<section class="bt bt-wide"><header><h2>Coming up</h2></header><div class="pf-next">${m.upcoming.slice(0, 5).map((u) => `<a href="#/title/series/${u.imdbId}"><span class="pf-np" style="background-image:url('${esc(u.poster || poster(u.imdbId))}')"></span><div><b>${esc(u.title)}</b><small>S${u.season} E${u.episode}${u.name ? ` · ${esc(u.name)}` : ''}</small></div><em>${esc(inDays(u.released))}</em></a>`).join('')}</div></section>`;
  }).catch(() => {});
}
