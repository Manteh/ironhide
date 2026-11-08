import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const HISTORY_DIR = join(homedir(), '.config', 'ironhide');
const HISTORY_FILE = join(HISTORY_DIR, 'history.json');
const TMP_FILE = HISTORY_FILE + '.tmp';

// Serialize all history I/O behind a single promise chain so concurrent
// writers in the same process can't race. Atomic file writes via tmp+rename
// so readers never observe a half-written file (which used to cause
// loadHistory to return [] and subsequent saves to wipe out real entries).
let ioChain = Promise.resolve();
function serialize(fn) {
  const next = ioChain.then(fn, fn);
  ioChain = next.catch(() => {});
  return next;
}

async function loadHistoryRaw() {
  try {
    const data = await readFile(HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    // Fall back to tmp if main is corrupt (partial write crash recovery)
    try {
      const data = await readFile(TMP_FILE, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }
}

async function saveHistoryRaw(history) {
  await mkdir(HISTORY_DIR, { recursive: true });
  await writeFile(TMP_FILE, JSON.stringify(history, null, 2));
  await rename(TMP_FILE, HISTORY_FILE);
}

function loadHistory() { return serialize(loadHistoryRaw); }

// Some play paths only know the torrent's file name ("Musk (2026) [1080p] [WEBRip] [5.1]", "Disclosure.Day.2026.2160p.iT.WEB-DL").
// Show people the title: reuse a clean one already in history for this IMDb id, else strip the release noise.
const RELEASE_NOISE = /[\[(]?\b(19|20)\d{2}\b[\])]?.*$|\[.*$|\b(2160p|1080p|720p|480p|4k|uhd|web-?dl|webrip|bluray|remux|hdtv|x26[45]|h\.?26[45]|hevc|ddp?\d?|aac|s\d{2}e\d{2})\b.*$/i;
export function cleanTitle(title, history = []) {
  const t = String(title || '').trim();
  if (!/[\[\]]|\.(19|20)\d{2}\.|\b(2160p|1080p|720p|web-?dl|webrip)\b/i.test(t)) return t;
  let c = t.replace(/\.(?=\S)/g, ' ').replace(RELEASE_NOISE, '').replace(/[\s\-_.(]+$/, '').trim();
  return c || t;
}
const titleFor = (entry, history) => {
  const clean = history.find((h) => h.imdbId === entry.imdbId && h.title && cleanTitle(h.title) === h.title)?.title;
  return clean || cleanTitle(entry.title);
};

export async function addToHistory(entry) {
  return serialize(async () => {
    const history = await loadHistoryRaw();
    entry = { ...entry, title: titleFor(entry, history) };
    // Playing it again must not wipe where you were: carry the position over unless the last time was finished
    const prev = history.find((h) => h.imdbId === entry.imdbId && (h.season || null) === (entry.season || null) && (h.episode || null) === (entry.episode || null));
    if (prev && !entry.position && prev.position && (prev.percent || 0) < 90) { entry = { ...entry, position: prev.position, duration: prev.duration, percent: prev.percent }; }
    history.unshift({
      title: entry.title,
      imdbId: entry.imdbId,
      type: entry.type,
      season: entry.season || null,
      episode: entry.episode || null,
      quality: entry.quality || '',
      position: entry.position || null,
      duration: entry.duration || null,
      percent: entry.percent || null,
      streamUrl: entry.streamUrl || null,
      streamMagnet: entry.streamMagnet || null,
      streamTorrentLink: entry.streamTorrentLink || null,
      streamIsRD: entry.streamIsRD || false,
      watchedAt: new Date().toISOString(),
    });
    await saveHistoryRaw(history.slice(0, 5000));
  });
}

// Take a film or show out of the history (and so out of Continue watching)
export async function removeFromHistory(imdbId) {
  return serialize(async () => {
    const history = await loadHistoryRaw();
    const keep = history.filter((h) => h.imdbId !== imdbId);
    if (keep.length !== history.length) await saveHistoryRaw(keep);
    return history.length - keep.length;
  });
}

// Mark as watched: the latest entry for it counts as finished, so it leaves Continue watching and a show moves on to the next episode
export async function markWatched(imdbId, season, episode) {
  return serialize(async () => {
    const history = await loadHistoryRaw();
    const i = history.findIndex((h) => h.imdbId === imdbId && (season == null || (h.season || null) === (season || null)) && (episode == null || (h.episode || null) === (episode || null)));
    if (i < 0) return false;
    history[i].percent = 100; history[i].position = history[i].duration || history[i].position;
    await saveHistoryRaw(history);
    return true;
  });
}

export async function getHistory(limit = 20) {
  const all = await loadHistory();
  return all.slice(0, limit).map((h) => (cleanTitle(h.title) === h.title ? h : { ...h, title: titleFor(h, all) }));
}

export async function getLastWatched(imdbId) {
  const history = await loadHistory();
  return history.find(h => h.imdbId === imdbId) || null;
}

// Decide whether what was watched counts as finished. Stopping near the end (credits) means it is over; stopping at 90% of a
// long film with a quarter of an hour left does not. The player's own end-of-file flag settles it.
export function normalizeProgress(p) {
  const position = Math.max(0, Number(p.position) || 0), duration = Math.max(0, Number(p.duration) || 0);
  if (!(duration > 0)) return { position, duration, percent: Number(p.percent) || 0, finished: false };
  const left = duration - position, raw = Math.min(100, (position / duration) * 100);
  const finished = !!p.eof || (duration > 600 && left <= 150) || (raw >= 90 && left <= 480);
  // everything else in the app reads percent >= 90 as "finished", so keep that true only for finished things
  return { position, duration, percent: finished ? Math.max(raw, 100) : Math.min(raw, 89.5), finished };
}

// Legacy: updates history[0] in place. Kept for CLI/mpv callers.
// Risky if something else wrote a newer entry in between — prefer
// updateEntryProgress which is matched by imdb/season/episode.
export async function updateLatestProgress(progress) {
  return serialize(async () => {
    const history = await loadHistoryRaw();
    if (history.length === 0) return;
    const n = normalizeProgress(progress);
    history[0].position = n.position;
    history[0].duration = n.duration;
    history[0].percent = n.percent;
    await saveHistoryRaw(history);
  });
}

// Update the first matching entry (by imdb/season/episode) rather than
// blindly touching history[0]. Safer for concurrent writers.
export async function updateEntryProgress(match, progress) {
  return serialize(async () => {
    const history = await loadHistoryRaw();
    const idx = history.findIndex(h =>
      h.imdbId === match.imdbId
      && (h.season || null) === (match.season || null)
      && (h.episode || null) === (match.episode || null)
    );
    if (idx < 0) return null;
    const n = normalizeProgress(progress);
    history[idx].position = n.position;
    history[idx].duration = n.duration;
    history[idx].percent = n.percent;
    if ('nextEp' in progress) history[idx].nextEp = progress.nextEp; // the episode that follows, once this one is finished
    if (!n.finished) delete history[idx].nextEp;
    await saveHistoryRaw(history);
    return n;
  });
}
