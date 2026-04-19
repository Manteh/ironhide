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

export async function addToHistory(entry) {
  return serialize(async () => {
    const history = await loadHistoryRaw();
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
    await saveHistoryRaw(history.slice(0, 100));
  });
}

export async function getHistory(limit = 20) {
  return (await loadHistory()).slice(0, limit);
}

export async function getLastWatched(imdbId) {
  const history = await loadHistory();
  return history.find(h => h.imdbId === imdbId) || null;
}

// Legacy: updates history[0] in place. Kept for CLI/mpv callers.
// Risky if something else wrote a newer entry in between — prefer
// updateEntryProgress which is matched by imdb/season/episode.
export async function updateLatestProgress(progress) {
  return serialize(async () => {
    const history = await loadHistoryRaw();
    if (history.length === 0) return;
    history[0].position = progress.position;
    history[0].duration = progress.duration;
    history[0].percent = progress.percent;
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
    if (idx < 0) return;
    history[idx].position = progress.position;
    history[idx].duration = progress.duration;
    history[idx].percent = progress.percent;
    await saveHistoryRaw(history);
  });
}
