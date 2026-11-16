// "New episodes": shows you were caught up on that have aired more since. A show counts as followed once you have
// watched an episode of it; it has something new when you finished the latest you watched and the next one came out
// after that (so a show you are simply behind on isn't "new").
import { getHistory } from './history.js';
import { getTitle } from './catalog.js';

let cache = { at: 0, value: null };

export async function newEpisodes({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < 30 * 60e3) return cache.value;
  const today = new Date().toISOString().slice(0, 10);
  const hist = await getHistory(1000);
  const latest = new Map(); // the most recent entry per show
  for (const h of hist) if (h.season && h.imdbId && !latest.has(h.imdbId)) latest.set(h.imdbId, h);
  const out = [];
  await Promise.all([...latest.values()].slice(0, 40).map(async (h) => {
    if ((h.percent || 0) < 90) return; // still in the middle of an episode: that's Continue watching, not news
    const t = await getTitle(h.imdbId, 'series').catch(() => null);
    if (!t?.seasons) return;
    const eps = Object.entries(t.seasons).flatMap(([sn, list]) => list.map((e) => ({ ...e, season: +sn })))
      .filter((e) => e.released && e.released <= today && (e.season > h.season || (e.season === h.season && e.episode > h.episode)))
      .sort((a, b) => a.season - b.season || a.episode - b.episode);
    const seen = (h.watchedAt || '').slice(0, 10);
    const fresh = eps.filter((e) => e.released >= seen); // aired since you caught up
    if (!fresh.length) return;
    const next = eps[0];
    out.push({ imdbId: h.imdbId, type: 'series', title: t.title || h.title, poster: t.poster || '', season: next.season, episode: next.episode, name: next.name, released: fresh.at(-1).released, count: fresh.length, still: next.thumbnail || '' });
  }));
  out.sort((a, b) => b.released.localeCompare(a.released));
  cache = { at: Date.now(), value: out };
  return out;
}

// A Mac notification when a show you follow gets a new episode. Each episode is announced once; the very first check
// only takes note of what is already out, so turning this on doesn't bring a flood of old news.
import { execFile } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';
import { getSettings } from './settings.js';

const SEEN_FILE = join(CONFIG_DIR, 'announced-episodes.json');
const osa = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

export async function announceNewEpisodes() {
  if (process.platform !== 'darwin' || process.env.IRONHIDE_HOSTED === '1') return;
  if ((await getSettings()).playback?.notifyNewEpisodes === false) return;
  const list = await newEpisodes({ fresh: true }).catch(() => []);
  const first = !existsSync(SEEN_FILE);
  let seen = []; try { seen = JSON.parse(readFileSync(SEEN_FILE, 'utf8')); } catch {}
  const key = (n) => `${n.imdbId}:${n.season}:${n.episode}:${n.count}`;
  const fresh = list.filter((n) => !seen.includes(key(n)));
  if (!first) for (const n of fresh.slice(0, 3)) {
    const ep = `S${String(n.season).padStart(2, '0')}E${String(n.episode).padStart(2, '0')}`;
    const body = n.count > 1 ? `${n.count} new episodes, starting with ${ep}` : `${ep}${n.name ? ` · ${n.name}` : ''} is out`;
    execFile('osascript', ['-e', `display notification ${osa(body)} with title "Orbie" subtitle ${osa(n.title)}`], () => {});
  }
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(SEEN_FILE, JSON.stringify([...new Set([...seen, ...list.map(key)])].slice(-500)));
}
