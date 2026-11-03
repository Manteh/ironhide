import { api } from '../api.js';
import { esc, card, pad, posterOf } from '../ui.js';

// Mirrors nitrate's "Resume" tab: finished episodes become "Next up", partial ones resume.
export function continueItems(history) {
  const seen = new Set(), out = [];
  for (const h of history) {
    const key = h.imdbId; if (seen.has(key)) continue; seen.add(key);
    const pct = h.percent || 0, tv = h.type === 'tv' || h.type === 'series';
    if (tv && pct >= 90) out.push({ imdbId: h.imdbId, type: 'series', title: h.title, poster: posterOf(h.imdbId), tag: `Next · S${pad(h.season)}E${pad(h.episode + 1)}`, pct: 0 });
    else if (pct < 90) out.push({ imdbId: h.imdbId, type: tv ? 'series' : 'movie', title: h.title, poster: posterOf(h.imdbId), tag: tv ? `S${pad(h.season)}E${pad(h.episode)}` : (pct > 3 ? 'Resume' : 'Watched'), pct });
  }
  return out.slice(0, 16);
}

export default async function home(el) {
  const [feeds, history] = await Promise.all([api('/api/catalog/feeds'), api('/api/history').catch(() => [])]);
  const cont = continueItems(history);
  el.innerHTML = `<div class="page">
    <div class="page-head"><div><h1 class="title">Home</h1><div class="sub">Pick up where you left off, or find something new.</div></div></div>
    ${cont.length ? `<section class="section"><h2>Continue watching</h2><div class="rail">${cont.map((c) =>
      card(c, `<span class="tag">${esc(c.tag)}</span>${c.pct ? `<div class="prog"><i style="width:${Math.min(100, Math.round(c.pct))}%"></i></div>` : ''}`)).join('')}</div></section>` : ''}
    ${feeds.map((f) => `<section class="section" data-feed="${f.id}"><h2>${esc(f.label)}</h2><div class="rail"><div class="note">Loading…</div></div></section>`).join('')}
  </div>`;
  feeds.forEach(async (f) => {
    const rail = el.querySelector(`[data-feed="${f.id}"] .rail`);
    try {
      const items = await api('/api/catalog/feed/' + f.id);
      rail.innerHTML = items.length ? items.map((i) => card(i)).join('') : '<div class="note">Nothing here right now</div>';
    } catch { rail.innerHTML = '<div class="note">Could not load this feed</div>'; }
  });
}
