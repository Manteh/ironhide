import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { spawn } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { getStreams } from './torrentio.js';
import { fetchSubtitles } from './subtitles.js';
import { playDetached, isMpvRunning } from './player.js';
import { addToHistory, updateLatestProgress } from './history.js';
import { getQualityPreference, getGlobalPreference, learnQuality } from './preferences.js';
import { getNowPlaying, stop } from './mpv-ipc.js';

const CONFIG_DIR = join(homedir(), '.config', 'ironhide');
const PLAYLISTS_FILE = join(CONFIG_DIR, 'playlists.json');
const TMP_FILE = PLAYLISTS_FILE + '.tmp';

let ioChain = Promise.resolve();
function serialize(fn) {
  const next = ioChain.then(fn, fn);
  ioChain = next.catch(() => {});
  return next;
}

async function loadRaw() {
  try {
    const data = await readFile(PLAYLISTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { playlists: [] };
  }
}

async function saveRaw(db) {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(TMP_FILE, JSON.stringify(db, null, 2));
  await rename(TMP_FILE, PLAYLISTS_FILE);
}

function load() { return serialize(loadRaw); }

async function savePlaybackState(playlistId, itemIndex, position) {
  return serialize(async () => {
    const db = await loadRaw();
    const pl = db.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    pl.state = {
      currentItemIndex: itemIndex,
      currentItemPosition: position,
      updatedAt: new Date().toISOString(),
    };
    await saveRaw(db);
  });
}

let broadcastFn = null;
export function setBroadcast(fn) {
  broadcastFn = fn;
}

function broadcast(msg) {
  if (broadcastFn) broadcastFn(msg);
}

let activeQueue = null;
let progressPoller = null;
let skipRequested = false;

function stopProgressPoller() {
  if (progressPoller) {
    clearInterval(progressPoller);
    progressPoller = null;
  }
}

function startProgressPoller(playlistId, items, currentIndex) {
  stopProgressPoller();
  progressPoller = setInterval(async () => {
    const np = await getNowPlaying();
    if (!np) return;

    await savePlaybackState(playlistId, currentIndex, np.position || 0);

    const item = items[currentIndex];
    const nextItem = items[currentIndex + 1];
    broadcast({
      type: 'progress',
      data: {
        title: item.title,
        episode: item.episode,
        position: np.position,
        duration: np.duration,
        percent: np.percent,
        playing: np.playing,
        itemIndex: currentIndex,
        totalItems: items.length,
        nextTitle: nextItem ? nextItem.title : null,
      },
    });
  }, 3000);
}

async function rankStreams(item) {
  const ep = item.season != null
    ? `S${String(item.season).padStart(2,'0')}E${String(item.episode).padStart(2,'0')}`
    : null;

  broadcast({ type: 'stream_search_start', data: { title: item.title, episode: ep } });

  let streams;
  try {
    streams = await getStreams(item.imdbId, item.type, item.season, item.episode);
  } catch (err) {
    broadcast({ type: 'stream_results', data: { streams: [], selected: null, error: err.message } });
    return [];
  }

  if (!streams || streams.length === 0) {
    broadcast({ type: 'stream_results', data: { streams: [], selected: null } });
    return [];
  }

  const pref = await getQualityPreference(item.imdbId).catch(() => null)
    || await getGlobalPreference().catch(() => null);

  const rd = streams.filter(s => s.isRD);
  const torrents = streams.filter(s => !s.isRD);

  // Streamability score: prefer 1080p, most seeders, smallest size. Avoid REMUX.
  // Seeders matter even for RD — popular torrents are far more likely to be RD-cached.
  const score = (s) => {
    const q = (s.quality || '') + ' ' + (s.name || '');
    let v = 0;
    if (/1080p/i.test(q)) v += 100;                 // 1080p sweet spot
    else if (/720p/i.test(q)) v += 50;
    else if (/2160p|4k|uhd/i.test(q)) v += 25;
    v += Math.min(s.seeds || 0, 60);                // more seeders = more likely cached + reliable
    v -= ((s.sizeBytes || 0) / 1e9) * 2.5;          // smaller files stream faster
    if (/x265|hevc/i.test(q)) v += 10;              // efficient codec
    if (/REMUX/i.test(q)) v -= 60;                  // too large to stream
    return v;
  };

  const rankedRD = [...rd].sort((a, b) => score(b) - score(a));
  const rankedTorrents = [...torrents].sort((a, b) => score(b) - score(a));

  // Try up to 15 RD streams (instant), then up to 2 torrent fallbacks
  const ranked = [...rankedRD.slice(0, 15), ...rankedTorrents.slice(0, 2)];

  const first = ranked[0];
  broadcast({
    type: 'stream_results',
    data: {
      streams: streams.slice(0, 12).map((s, i) => ({
        index: i,
        quality: s.quality,
        size: s.size,
        seeds: s.seeds,
        isRD: s.isRD,
      })),
      totalCount: streams.length,
      rdCount: rd.length,
      attemptCount: ranked.length,
      selectedIndex: first ? streams.indexOf(first) : -1,
      selectedIsRD: first?.isRD,
      reason: first?.isRD ? 'trying Real-Debrid (instant)' : `torrent · ${first?.seeds || 0} seeders`,
    },
  });

  return ranked;
}

async function playItem(playlistId, items, index, resumeFrom = 0) {
  if (index >= items.length) {
    activeQueue = null;
    stopProgressPoller();
    await serialize(async () => {
      const db = await loadRaw();
      const pl = db.playlists.find(p => p.id === playlistId);
      if (pl) {
        pl.state = { currentItemIndex: 0, currentItemPosition: 0, updatedAt: new Date().toISOString() };
        await saveRaw(db);
      }
    });
    broadcast({ type: 'queue_done', data: { playlistId } });
    return;
  }

  const item = items[index];

  activeQueue = { playlistId, items, currentIndex: index, status: 'resolving' };
  broadcast({
    type: 'item_start',
    data: {
      index,
      totalItems: items.length,
      title: item.title,
      imdbId: item.imdbId,
      type: item.type,
      season: item.season,
      episode: item.episode,
    },
  });

  const ranked = await rankStreams(item);
  if (ranked.length === 0) {
    broadcast({ type: 'error', data: { message: `No streams found for ${item.title}` } });
    await playItem(playlistId, items, index + 1);
    return;
  }

  const subs = await fetchSubtitles(item.imdbId, item.season, item.episode);
  skipRequested = false;

  let torrentTimeoutId = null;

  const onFinish = async (progress) => {
    clearTimeout(torrentTimeoutId);
    stopProgressPoller();
    if (progress) await updateLatestProgress(progress);

    if (skipRequested || !progress || progress.percent >= 90) {
      broadcast({ type: 'item_done', data: { index, title: item.title } });
      await playItem(playlistId, items, index + 1, 0);
    } else {
      activeQueue = null;
      const savedPosition = progress?.position || resumeFrom;
      await savePlaybackState(playlistId, index, savedPosition);
      broadcast({
        type: 'stopped',
        data: {
          index,
          title: item.title,
          position: progress?.position || null,
          percent: progress?.percent || null,
        },
      });
    }
  };

  // Try each ranked stream until one actually launches mpv
  let launched = null;
  for (let i = 0; i < ranked.length; i++) {
    const stream = ranked[i];
    broadcast({
      type: 'stream_launching',
      data: {
        isRD: stream.isRD,
        quality: stream.quality,
        size: stream.size,
        attempt: i + 1,
        total: ranked.length,
      },
    });

    const result = await playDetached(stream, subs, onFinish, resumeFrom);

    if (result.status !== 'playing') {
      broadcast({ type: 'stream_attempt_failed', data: { quality: stream.quality, reason: result.status } });
      continue;
    }

    if (stream.isRD) {
      // RD streams launch mpv directly — trust it
      launched = stream;
      activeQueue.status = 'playing';
      break;
    }

    // Torrent: wait for webtorrent to buffer enough that mpv actually opens.
    activeQueue.status = 'buffering';
    broadcast({ type: 'buffering', data: { quality: stream.quality, seeds: stream.seeds, size: stream.size } });
    const opened = await waitForMpvOpen(BUFFER_TIMEOUT_MS, () => skipRequested);

    if (opened) {
      launched = stream;
      activeQueue.status = 'playing';
      break;
    }

    // Didn't buffer in time — abandon this torrent, try the next one
    result.cancel?.();
    spawn('pkill', ['-f', 'webtorrent'], { stdio: 'ignore' }).on('error', () => {});
    broadcast({ type: 'stream_attempt_failed', data: { quality: stream.quality, reason: 'buffer_timeout' } });
    if (skipRequested) break;
  }

  if (!launched) {
    broadcast({ type: 'error', data: { message: `No playable stream for "${item.title}" — skipping` } });
    await playItem(playlistId, items, index + 1);
    return;
  }

  broadcast({
    type: 'stream_launched',
    data: { isRD: launched.isRD, quality: launched.quality, size: launched.size },
  });

  // For torrent streams: auto-skip after 3 minutes if mpv never opened
  if (!launched.isRD) {
    torrentTimeoutId = setTimeout(async () => {
      if (activeQueue && activeQueue.currentIndex === index) {
        broadcast({ type: 'error', data: { message: `"${item.title}" took too long to buffer — skipping` } });
        skipRequested = true;
        const { stop: stopMpv } = await import('./mpv-ipc.js');
        await stopMpv().catch(() => {});
        spawn('pkill', ['-f', 'webtorrent'], { stdio: 'ignore' }).on('error', () => {});
      }
    }, 3 * 60 * 1000);
  }

  await addToHistory({
    title: item.title,
    imdbId: item.imdbId,
    type: item.type,
    season: item.season,
    episode: item.episode,
    quality: launched.quality,
    streamUrl: launched.url || null,
    streamMagnet: launched.magnet || null,
    streamTorrentLink: launched.torrentLink || null,
    streamIsRD: launched.isRD || false,
  });

  await learnQuality(item.imdbId, launched);

  startProgressPoller(playlistId, items, index);
}

export async function listPlaylists() {
  const db = await load();
  return db.playlists.map(pl => ({
    id: pl.id,
    name: pl.name,
    createdAt: pl.createdAt,
    lastPlayedAt: pl.lastPlayedAt,
    itemCount: pl.items.length,
    state: pl.state,
  }));
}

export async function getPlaylist(id) {
  const db = await load();
  return db.playlists.find(pl => pl.id === id) || null;
}

export async function createPlaylist(name) {
  return serialize(async () => {
    const db = await loadRaw();
    const playlist = {
      id: randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      lastPlayedAt: null,
      items: [],
      state: { currentItemIndex: 0, currentItemPosition: 0, updatedAt: new Date().toISOString() },
    };
    db.playlists.push(playlist);
    await saveRaw(db);
    return playlist;
  });
}

export async function deletePlaylist(id) {
  return serialize(async () => {
    const db = await loadRaw();
    db.playlists = db.playlists.filter(pl => pl.id !== id);
    await saveRaw(db);
  });
}

export async function addItem(playlistId, { title, imdbId, type, season, episode, year, posterUrl, tmdbId, duration }) {
  return serialize(async () => {
    const db = await loadRaw();
    const pl = db.playlists.find(p => p.id === playlistId);
    if (!pl) throw new Error(`Playlist ${playlistId} not found`);

    const item = {
      id: randomUUID(),
      position: pl.items.length,
      title,
      imdbId,
      type,
      season: season || null,
      episode: episode || null,
      year: year || null,
      posterUrl: posterUrl || null,
      tmdbId: tmdbId || null,
      duration: duration || null,
    };
    pl.items.push(item);
    await saveRaw(db);
    return item;
  });
}

export async function removeItem(playlistId, itemId) {
  return serialize(async () => {
    const db = await loadRaw();
    const pl = db.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    pl.items = pl.items.filter(i => i.id !== itemId);
    pl.items.forEach((item, idx) => { item.position = idx; });
    await saveRaw(db);
  });
}

export async function reorderItems(playlistId, orderedIds) {
  return serialize(async () => {
    const db = await loadRaw();
    const pl = db.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    const itemMap = new Map(pl.items.map(i => [i.id, i]));
    pl.items = orderedIds.map((id, idx) => {
      const item = itemMap.get(id);
      item.position = idx;
      return item;
    });
    await saveRaw(db);
  });
}

export async function startPlaylist(playlistId, fromIndex = 0) {
  const db = await load();
  const pl = db.playlists.find(p => p.id === playlistId);
  if (!pl) throw new Error(`Playlist ${playlistId} not found`);

  await serialize(async () => {
    const db2 = await loadRaw();
    const pl2 = db2.playlists.find(p => p.id === playlistId);
    if (pl2) {
      pl2.lastPlayedAt = new Date().toISOString();
      await saveRaw(db2);
    }
  });

  const items = [...pl.items].sort((a, b) => a.position - b.position);
  await playItem(playlistId, items, fromIndex, 0);
}

export async function resumePlaylist(playlistId) {
  const db = await load();
  const pl = db.playlists.find(p => p.id === playlistId);
  if (!pl) throw new Error(`Playlist ${playlistId} not found`);

  const { currentItemIndex, currentItemPosition } = pl.state || {};
  const index = currentItemIndex || 0;
  const position = currentItemPosition || 0;

  const items = [...pl.items].sort((a, b) => a.position - b.position);
  await playItem(playlistId, items, index, position);
}

export async function skipCurrent() {
  if (!activeQueue) return;
  skipRequested = true;
  await stop();
}

export async function stopQueue() {
  if (!activeQueue) return;
  stopProgressPoller();
  activeQueue = null;
  await stop();
}

export function getQueueState() {
  if (!activeQueue) return null;
  return {
    playlistId: activeQueue.playlistId,
    items: activeQueue.items,
    currentIndex: activeQueue.currentIndex,
    status: activeQueue.status,
  };
}
