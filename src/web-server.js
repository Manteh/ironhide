import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { tools, getLoadedStreams } from './tools.js';
import { FEEDS, getFeed, getGenres, search as catalogSearch, getTitle } from './catalog.js';
import { getHistory } from './history.js';
import { parseLangs } from './ui.js';
import * as social from './social.js';
import { listInstances, createInstance, startInstance, stopInstance, removeInstance } from './instances.js';
import { addToHistory, updateEntryProgress } from './history.js';
import { learnQuality } from './preferences.js';
import { keyframesAround, ensureSyncClip, syncClipPath, capabilities, createSession, getSession, streamTo, subtitleVtt, closeSession, thumbFor, exactThumb, startThumbs } from './webplay.js';
import { readFile as readFileAsync } from 'fs/promises';
import {
  getSettings, updateSettings, resetProfile, connectorsView, setConnectorKey, setDebridProvider, testConnector,
  getNodes, pickBest, getWatchlist, toggleWatchlist,
} from './settings.js';
import { WebSocketServer } from 'ws';

import {
  listPlaylists, getPlaylist, createPlaylist, deletePlaylist,
  addItem, removeItem, reorderItems,
  startPlaylist, resumePlaylist, skipCurrent, stopQueue,
  getQueueState, setBroadcast,
} from './playlist.js';

import { searchMedia, getImdbId, getLatestEpisode } from './tmdb.js';
import { getNowPlaying, isMpvRunning } from './mpv-ipc.js';
import { getPlayState, setPlayState, beginLaunch } from './playstate.js';

const WEB_DIR = fileURLToPath(new URL('../web', import.meta.url));
// A key that names one release without any debrid key in it: the torrent hash and file when we can see them, else the release name.
export const streamPin = (st) => { const h = (st.url || '').match(/\b[a-f0-9]{40}\b/i)?.[0] || st.infoHash; return h ? `h:${h.toLowerCase()}:${st.fileIdx ?? ''}` : `q:${String(st.quality || '').slice(0, 120)}`; };
const findPinned = (streams, pin) => {
  let i = streams.findIndex((x) => streamPin(x) === pin);
  if (i < 0 && pin.startsWith('h:')) { const hash = pin.split(':')[1]; i = streams.findIndex((x) => streamPin(x).split(':')[1] === hash); }
  return i >= 0 ? i + 1 : 0;
};
export const WEB_PORT = Number(process.env.IRONHIDE_PORT) || 7676;
// Hosted mode: video goes from the debrid CDN straight to each viewer's browser, never through this server.
const CDN_DELIVERY = process.env.IRONHIDE_HOSTED === '1' || process.env.IRONHIDE_DELIVERY === 'cdn';

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const TAG_PATTERNS = [
  ['REMUX', /remux/i], ['DV', /\bDV\b|dolby.?vision|dovi/i], ['HDR', /hdr/i],
  ['IMAX', /imax/i], ['Atmos', /atmos|truehd|dts-hd/i],
];
function describeStream(q) {
  const source = /remux/i.test(q) ? 'Remux' : /blu-?ray|bdrip|brrip/i.test(q) ? 'Blu-ray' : /web-?dl/i.test(q) ? 'WEB-DL' : /webrip/i.test(q) ? 'WEBRip' : /hdtv/i.test(q) ? 'HDTV' : /dvd/i.test(q) ? 'DVD' : /\bcam\b|telesync|\bts\b|hdcam/i.test(q) ? 'CAM' : '';
  const codec = /\bav1\b/i.test(q) ? 'AV1' : /hevc|x265|h\.?265/i.test(q) ? 'HEVC' : /x264|h\.?264|\bavc\b/i.test(q) ? 'H.264' : '';
  const audio = /atmos/i.test(q) ? 'Atmos' : /truehd/i.test(q) ? 'TrueHD' : /dts-?hd/i.test(q) ? 'DTS-HD' : /\bdts\b/i.test(q) ? 'DTS' : /ddp ?5\.1|ddp ?7\.1|dd\+/i.test(q) ? 'DD+ 5.1' : /dd ?5\.1|\bac-?3\b/i.test(q) ? 'DD 5.1' : /\baac\b/i.test(q) ? 'AAC' : '';
  const hdr = [];
  if (/dolby.?vision|\bdv\b|dovi/i.test(q)) hdr.push('Dolby Vision');
  if (/hdr10\+/i.test(q)) hdr.push('HDR10+'); else if (/hdr/i.test(q)) hdr.push('HDR10');
  const group = (q.match(/-([A-Za-z0-9]{2,14})(?:\[[^\]]*\])?(?:\.\w{2,4})?\s*$/) || [])[1] || '';
  return { source, codec, audio, hdr, group, langs: parseLangs(q).filter((l) => l !== 'EN').slice(0, 3) };
}
const streamTags = (q) => TAG_PATTERNS.filter(([, re]) => re.test(q)).map(([t]) => t);

const IMG_HOSTS = /(^|\.)(metahub\.space|trakt\.tv|media-amazon\.com|tmdb\.org|fanart\.tv|strem\.io|stremio\.com|imdb\.com)$/;
const clients = new Set();

function broadcastToAll(msg) {
  const data = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

async function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
  });
}

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function errorResponse(res, message, status = 500) {
  // never let an API key leave in an error message (debrid links carry it in the query string)
  jsonResponse(res, { error: String(message).replace(/([?&](?:token|apikey|api_key|key)=)[^&\s"']+/gi, '$1***') }, status);
}

async function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(WEB_DIR, path.normalize(urlPath));
  if (!filePath.startsWith(WEB_DIR + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

async function handleApi(req, res, urlPath) {
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    if (method === 'GET' && urlPath === '/api/catalog/feeds') {
      return jsonResponse(res, { feeds: FEEDS.map(({ id, label, short, kind, type, noGenre }) => ({ id, label, short: short || label, kind, type, noGenre: !!noGenre })), genres: await getGenres() });
    }

    const feedMatch = urlPath.match(/^\/api\/catalog\/feed\/([a-z_]+)$/);
    if (feedMatch && method === 'GET') {
      const fp = new URL(req.url, 'http://localhost').searchParams;
      const items = await getFeed(feedMatch[1], { genre: fp.get('genre') || '', skip: fp.get('skip') || 0 });
      if (!items) return errorResponse(res, 'Unknown feed', 404);
      return jsonResponse(res, items);
    }

    if (method === 'GET' && urlPath === '/api/catalog/search') {
      const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim();
      return jsonResponse(res, q ? await catalogSearch(q) : []);
    }

    const titleMatch = urlPath.match(/^\/api\/title\/(tt\d+)$/);
    if (titleMatch && method === 'GET') {
      const type = new URL(req.url, 'http://localhost').searchParams.get('type') === 'series' ? 'series' : 'movie';
      const t = await getTitle(titleMatch[1], type);
      return t ? jsonResponse(res, t) : errorResponse(res, 'Not found', 404);
    }

    if (method === 'GET' && urlPath === '/api/history') {
      return jsonResponse(res, await getHistory(100));
    }

    // Stream picker: loads streams into the shared tool state so /api/play can use the index.
    if (method === 'GET' && urlPath === '/api/streams') {
      const p = new URL(req.url, 'http://localhost').searchParams;
      const type = p.get('type') === 'series' ? 'tv' : 'movie';
      const season = p.get('season') ? Number(p.get('season')) : undefined;
      const episode = p.get('episode') ? Number(p.get('episode')) : undefined;
      await tools.ironhide_streams.handler({ imdbId: p.get('imdbId'), title: p.get('title') || '', type, season, episode });
      const { streams } = getLoadedStreams();
      const best = pickBest(streams, (await getSettings()).playback);
      return jsonResponse(res, streams.map((s, i) => ({
        best: best === i + 1,
        index: i + 1,
        isRD: s.isRD,
        cached: s.cached,
        quality: s.quality,
        size: s.size,
        sizeGb: s.sizeBytes / 1e9,
        seeds: s.seeds,
        resolution: (s.quality.match(/2160p|4k|1080p|720p|480p/i) || [''])[0].toLowerCase().replace('4k', '2160p'),
        tags: streamTags(s.quality),
        ...describeStream(s.quality),
      })));
    }

    // One-click play: pick the best stream for the user's preferences and start it.
    if (method === 'POST' && urlPath === '/api/quickplay') {
      const body = await parseBody(req);
      const type = body.type === 'series' || body.type === 'tv' ? 'tv' : 'movie';
      const playback = (await getSettings()).playback;
      let { season, episode } = body, resumeFrom;
      const hist = await getHistory(200);
      if (type === 'tv' && !(season && episode)) {
        const last = hist.find(h => h.imdbId === body.imdbId && h.season);
        if (last) { season = last.season; episode = (last.percent || 0) >= 90 ? last.episode + 1 : last.episode; if (episode === last.episode) resumeFrom = last.position; }
        else { season = 1; episode = 1; }
      } else if (type === 'movie') {
        const last = hist.find(h => h.imdbId === body.imdbId);
        if (last && (last.percent || 0) < 90 && last.position > 30) resumeFrom = last.position;
      }
      beginLaunch({ title: body.title || '', imdbId: body.imdbId });
      await tools.ironhide_streams.handler({ imdbId: body.imdbId, title: body.title || '', type, season, episode });
      const { streams } = getLoadedStreams();
      const best = pickBest(streams, playback);
      if (!best) { setPlayState({ phase: 'error', detail: 'No streams found for this title' }); return errorResponse(res, 'No streams found for this title', 404); }
      setPlayState({ phase: 'resolving', detail: `Resolving ${streams[best - 1].size || 'stream'}` });
      const out = await tools.ironhide_play.handler({ index: best, resumeFrom });
      return jsonResponse(res, { ...out, played: { season, episode, resumeFrom: resumeFrom || 0 } });
    }

    if (method === 'GET' && urlPath === '/api/playstate') return jsonResponse(res, getPlayState());
    if (method === 'POST' && urlPath === '/api/play/cancel') { setPlayState({ phase: 'idle', detail: '' }); await tools.ironhide_control.handler({ action: 'stop' }).catch(() => {}); return jsonResponse(res, { ok: true }); }

    if (method === 'POST' && urlPath === '/api/play') {
      const body = await parseBody(req);
      const meta0 = getLoadedStreams().meta || {};
      beginLaunch({ title: meta0.title || '', imdbId: meta0.imdbId || '', detail: 'Resolving the link' });
      setPlayState({ phase: 'resolving' });
      return jsonResponse(res, await tools.ironhide_play.handler({ index: Number(body.index), resumeFrom: body.resumeFrom }));
    }

    if (method === 'POST' && urlPath === '/api/control') {
      const body = await parseBody(req);
      return jsonResponse(res, await tools.ironhide_control.handler({ action: body.action, value: body.value }));
    }

    if (method === 'GET' && urlPath === '/api/settings') return jsonResponse(res, await getSettings());
    // extra IronHides on this Mac (another person, own friend code). Spawns processes, so only our own pages may call it.
    if (urlPath === '/api/instances' || /^\/api\/instances\/[a-z0-9]+(\/(start|stop))?$/.test(urlPath)) {
      if (req.headers.origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) return errorResponse(res, 'Not allowed from this site', 403);
      const relay = social.snapshot().relay.url || '';
      if (method === 'GET' && urlPath === '/api/instances') return jsonResponse(res, await listInstances());
      if (method === 'POST' && urlPath === '/api/instances') { const b = await parseBody(req); return jsonResponse(res, await createInstance({ name: b.name, copyKeys: b.copyKeys !== false, relay })); }
      const gone = urlPath.match(/^\/api\/instances\/([a-z0-9]+)$/);
      if (method === 'DELETE' && gone) return jsonResponse(res, await removeInstance(gone[1]));
      const m = urlPath.match(/^\/api\/instances\/([a-z0-9]+)\/(start|stop)$/);
      if (method === 'POST' && m) return jsonResponse(res, m[2] === 'start' ? await startInstance(m[1], relay) : await stopInstance(m[1]));
    }
    if (method === 'POST' && urlPath === '/api/account/purge') { if (req.headers.origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) return errorResponse(res, 'Not allowed from this site', 403); social.purgeFriends(); return jsonResponse(res, { ok: true }); }
    if (method === 'POST' && urlPath === '/api/account/reset') { if (req.headers.origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin)) return errorResponse(res, 'Not allowed from this site', 403); await resetProfile(); social.resetIdentity(); return jsonResponse(res, { ok: true }); }
    if (method === 'PUT' && urlPath === '/api/settings') { const out = await updateSettings(await parseBody(req)); social.sendProfile(); return jsonResponse(res, out); }

    if (method === 'GET' && urlPath === '/api/connectors') return jsonResponse(res, connectorsView());
    if (method === 'PUT' && urlPath === '/api/connectors/provider') {
      setDebridProvider((await parseBody(req)).provider);
      return jsonResponse(res, connectorsView());
    }
    const connMatch = urlPath.match(/^\/api\/connectors\/([a-z]+)(\/test)?$/);
    if (connMatch && method === 'PUT' && !connMatch[2]) {
      setConnectorKey(connMatch[1], (await parseBody(req)).key);
      return jsonResponse(res, connectorsView());
    }
    if (connMatch && method === 'DELETE') {
      setConnectorKey(connMatch[1], '');
      return jsonResponse(res, connectorsView());
    }
    if (connMatch && method === 'POST' && connMatch[2]) {
      return jsonResponse(res, await testConnector(connMatch[1], (await parseBody(req)).key));
    }

    if (method === 'GET' && urlPath === '/api/nodes') {
      return jsonResponse(res, await getNodes(new URL(req.url, 'http://localhost').searchParams.has('refresh')));
    }

    if (method === 'GET' && urlPath === '/api/watchlist') return jsonResponse(res, await getWatchlist());
    if (method === 'POST' && urlPath === '/api/watchlist/toggle') return jsonResponse(res, await toggleWatchlist(await parseBody(req)));

    if (method === 'GET' && urlPath === '/api/img') {
      const u = new URL(req.url, 'http://localhost').searchParams.get('u') || '';
      let t; try { t = new URL(u); } catch { return errorResponse(res, 'Bad url', 400); }
      if (t.protocol !== 'https:' || !IMG_HOSTS.test(t.hostname)) return errorResponse(res, 'Host not allowed', 403);
      const r = await fetch(t, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) return errorResponse(res, 'Upstream ' + r.status, 502);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 6e6) return errorResponse(res, 'Too large', 413);
      res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'public, max-age=604800', 'Access-Control-Allow-Origin': '*' });
      return res.end(buf);
    }

    if (method === 'GET' && urlPath === '/api/synctest.mp4') {
      const f = syncClipPath(); if (!fs.existsSync(f)) return errorResponse(res, 'Not ready', 404);
      const size = fs.statSync(f).size, rg = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      let a = 0, b = size - 1; if (rg) { if (rg[1] !== '') a = +rg[1]; if (rg[2] !== '') b = Math.min(+rg[2], size - 1); if (rg[1] === '' && rg[2] !== '') { a = Math.max(0, size - +rg[2]); b = size - 1; } }
      res.writeHead(rg ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1, ...(rg ? { 'Content-Range': `bytes ${a}-${b}/${size}` } : {}) });
      return fs.createReadStream(f, { start: a, end: b }).pipe(res);
    }
    if (method === 'GET' && urlPath === '/api/webplay/capabilities') return jsonResponse(res, capabilities());

    // In-browser playback: pick a stream, resolve the direct link, probe it, return a session.
    if (method === 'POST' && urlPath === '/api/webplay') {
      const body = await parseBody(req);
      const settings = (await getSettings()).playback;
      if (body.imdbId === 'synctest') {
        await ensureSyncClip();
        const info = await createSession({ url: `http://127.0.0.1:${WEB_PORT}/api/synctest.mp4`, title: 'Sync test clip', meta: { title: 'Sync test clip', imdbId: 'synctest', type: 'movie', year: '' }, subs: [], caps: body.caps || {}, settings, delivery: 'proxy' });
        return jsonResponse(res, { ...info, start: typeof body.roomStart === 'number' ? body.roomStart : 0, quality: 'Sync test clip', size: '', pin: 'synctest', pinned: true });
      }
      const type = body.type === 'series' || body.type === 'tv' ? 'tv' : 'movie';
      let { season, episode } = body, resumeFrom = body.resumeFrom;
      let stream;
      if (body.index) {
        const loaded = getLoadedStreams();
        stream = loaded.streams[Number(body.index) - 1];
        if (!stream) return errorResponse(res, 'Pick a stream first', 400);
        season = loaded.meta.season; episode = loaded.meta.episode;
        beginLaunch({ title: loaded.meta.title || '', imdbId: loaded.meta.imdbId || '', detail: 'Resolving the link' });
      } else {
        const hist = await getHistory(200);
        if (type === 'tv' && !(season && episode)) {
          const last = hist.find(h => h.imdbId === body.imdbId && h.season);
          if (last) { season = last.season; episode = (last.percent || 0) >= 90 ? last.episode + 1 : last.episode; if (episode === last.episode) resumeFrom = last.position; }
          else { season = 1; episode = 1; }
        } else if (type === 'movie') {
          const last = hist.find(h => h.imdbId === body.imdbId);
          if (last && (last.percent || 0) < 90 && last.position > 30) resumeFrom = last.position;
        }
        beginLaunch({ title: body.title || '', imdbId: body.imdbId });
        await tools.ironhide_streams.handler({ imdbId: body.imdbId, title: body.title || '', type, season, episode });
        const loaded = getLoadedStreams();
        // In a room everyone plays the exact release the owner's copy chose. Without it, positions would not line up.
        const pinned = body.pin ? findPinned(loaded.streams, body.pin) : 0;
        const best = pinned || pickBest(loaded.streams, settings, { browserSafe: CDN_DELIVERY || !!body.room });
        if (!best) { setPlayState({ phase: 'error', detail: 'No streams found for this title' }); return errorResponse(res, 'No streams found for this title', 404); }
        stream = loaded.streams[best - 1];
      }
      try {
        // CDN delivery (hosted mode): the browser plays straight from the debrid CDN, so only files it can
        // decode as-is qualify. Auto-pick moves on to the next best candidate when one doesn't.
        const tried = new Set(); let info, direct;
        // Auto-pick also moves on when a stream's download node can't be reached or the link is dead.
        let lastErr;
        for (let attempt = 0; attempt < (body.index ? 1 : 6); attempt++) {
          const loaded = getLoadedStreams(), meta = { ...loaded.meta, season, episode };
          try {
            if (!stream.isRD || !stream.url) throw new Error('The web player needs a debrid stream (this one is a torrent)');
            setPlayState({ phase: 'resolving', detail: `Resolving ${stream.size || 'stream'}` });
            const r = await fetch(stream.url, { redirect: 'manual' });
            direct = r.headers.get('location') || (r.status < 300 ? stream.url : null);
            if (!direct || /failed_|error|denied/i.test(direct)) throw new Error('That stream is not available right now');
            setPlayState({ phase: 'probing', detail: 'Checking codecs and tracks' });
            info = await createSession({ url: direct, title: meta.title || body.title || 'Playing', meta, subs: loaded.subs || [], caps: body.caps || {}, settings, delivery: CDN_DELIVERY ? 'cdn' : 'proxy' });
            break;
          } catch (e) {
            lastErr = e;
            if (body.index) throw e;
            tried.add(loaded.streams.indexOf(stream) + 1);
            const next = pickBest(loaded.streams, settings, { exclude: tried, browserSafe: CDN_DELIVERY });
            if (!next) break;
            setPlayState({ phase: 'resolving', detail: 'Trying another source' });
            stream = loaded.streams[next - 1];
          }
        }
        if (!info) throw lastErr || new Error('No stream for this title could be opened.');
        const loaded = getLoadedStreams(), meta = { ...loaded.meta, season, episode };
        await addToHistory({ title: meta.title || stream.quality.slice(0, 40), imdbId: meta.imdbId || '', type: meta.type || type, season, episode, quality: stream.quality.slice(0, 80), streamUrl: stream.url, streamIsRD: true }).catch(() => {});
        if (meta.imdbId) await learnQuality(meta.imdbId, stream).catch(() => {});
        setPlayState({ phase: 'playing', detail: 'Opening the player' });
        if (body.fromStart) resumeFrom = 0;
        if (typeof body.roomStart === 'number' && body.roomStart >= 0) resumeFrom = body.roomStart; // a room that was paused here
        return jsonResponse(res, { ...info, start: resumeFrom || 0, pin: streamPin(stream), pinned: !body.pin || streamPin(stream) === body.pin, quality: stream.quality, size: stream.size });
      } catch (err) {
        setPlayState({ phase: 'error', detail: err.message });
        return errorResponse(res, err.message, 502);
      }
    }

    const wpMatch = urlPath.match(/^\/api\/wp\/([a-z0-9-]+)\/(stream|progress|thumbs|thumb|keyframes|sub\/(\d+)\.vtt)$/);
    if (wpMatch) {
      const [, id, what, subIdx] = wpMatch;
      if (what === 'stream' && method === 'GET') {
        const q = new URL(req.url, 'http://localhost').searchParams;
        return streamTo(res, id, Number(q.get('start')) || 0, Number(q.get('audio')) || 0, q.get('transcode') === '1', Number(q.get('sync')) || 0);
      }
      if (what === 'keyframes' && method === 'GET') return jsonResponse(res, await keyframesAround(id, new URL(req.url, 'http://localhost').searchParams.get('t')));
      if (what === 'thumbs' && method === 'POST') { const sess = getSession(id); if (sess) startThumbs(sess); return jsonResponse(res, { ok: true }); }
      if (what === 'thumb' && method === 'GET') {
        const q = new URL(req.url, 'http://localhost').searchParams, t = Number(q.get('t')) || 0;
        const f = (q.get('exact') === '1' && await exactThumb(id, t)) || thumbFor(id, t);
        if (!f) { res.writeHead(204); return res.end(); }
        const buf = await readFileAsync(f.path);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=600', 'X-Thumb-Time': String(f.t), 'Access-Control-Expose-Headers': 'X-Thumb-Time' });
        return res.end(buf);
      }
      if (what.startsWith('sub/') && method === 'GET') {
        const vtt = await subtitleVtt(id, Number(subIdx));
        if (!vtt) return errorResponse(res, 'No such subtitle', 404);
        res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(vtt);
      }
      if (what === 'progress' && method === 'POST') {
        const b = await parseBody(req), sess = getSession(id);
        if (sess && b.position >= 0 && b.duration > 0) {
          await updateEntryProgress({ imdbId: sess.meta?.imdbId, season: sess.meta?.season, episode: sess.meta?.episode }, { position: b.position, duration: b.duration, percent: (b.position / b.duration) * 100 }).catch(() => {});
        }
        return jsonResponse(res, { ok: true });
      }
    }
    const wpDel = urlPath.match(/^\/api\/wp\/([a-z0-9-]+)$/);
    if (wpDel && method === 'DELETE') { closeSession(wpDel[1]); return jsonResponse(res, { ok: true }); }

    // ---------- friends, rooms, chat (relay-backed) ----------
    if (urlPath.startsWith('/api/social')) {
      const sub = urlPath.slice('/api/social'.length) || '/';
      const body = method === 'GET' ? {} : await parseBody(req);
      const ok = () => jsonResponse(res, social.snapshot());
      try {
        if (method === 'GET' && sub === '/') return ok();
        if (method === 'PUT' && sub === '/settings') { social.setSocialSettings(body); return ok(); }
        if (method === 'POST' && sub === '/people') { social.refreshPeople(); return ok(); }
        if (method === 'POST' && sub === '/friends') { social.addFriend(body.code); return ok(); }
        if (method === 'POST' && sub === '/friends/accept') { social.acceptFriend(body.id); return ok(); }
        if (method === 'POST' && sub === '/friends/decline') { social.declineFriend(body.id); return ok(); }
        const del = sub.match(/^\/friends\/([A-Z0-9]+)$/);
        if (method === 'DELETE' && del) { social.removeFriend(del[1]); return ok(); }
        if (method === 'POST' && sub === '/room') { social.createRoom(body.name); return ok(); }
        if (method === 'POST' && sub === '/room/join') { social.joinRoom(body.code); return ok(); }
        if (method === 'POST' && sub === '/room/leave') { social.leaveRoom(); return ok(); }
        if (method === 'POST' && sub === '/visible') { social.tabSeen(body.tab, !!body.visible); return jsonResponse(res, { ok: true }); }
        if (method === 'POST' && sub === '/room/state') { social.roomState(body.state, body.pos, body.buf, body.tc); return jsonResponse(res, { ok: true }); }
        if (method === 'POST' && sub === '/room/forget') { social.forgetRoom(body.code); return ok(); }
        if (method === 'POST' && sub === '/room/transfer') { social.transfer(body.id); return ok(); }
        if (method === 'POST' && sub === '/room/kick') { social.kick(body.id); return ok(); }
        if (method === 'POST' && sub === '/room/invite') { social.invite(body.id); return ok(); }
        if (method === 'POST' && sub === '/room/invite/dismiss') { social.dismissInvite(body.code); return ok(); }
        if (method === 'POST' && sub === '/room/media') { social.roomMedia(body.media); return ok(); }
        if (method === 'POST' && sub === '/room/ready') { social.roomReady(body.ready, body.token); return ok(); }
        if (method === 'POST' && sub === '/room/pin') { social.roomPin(body.key, body.label); return ok(); }
        if (method === 'POST' && sub === '/room/control') { social.roomControl(body.action, body.pos, { scheduled: !!body.scheduled, rate: body.rate }); return ok(); }
        if (method === 'POST' && sub === '/room/settings') { social.roomSettings(body); return ok(); }
        if (method === 'POST' && sub === '/chat') { social.chat(body.text); return ok(); }
        if (method === 'POST' && sub === '/react') { social.react(body.emoji); return ok(); }
        if (method === 'POST' && sub === '/watching') { social.setWatching(body.watching || null); return ok(); }
      } catch (err) { return errorResponse(res, err.message, 400); }
      return errorResponse(res, 'Not found', 404);
    }

    if (method === 'GET' && urlPath === '/api/health') {
      return jsonResponse(res, { ok: true, service: 'ironhide', pid: process.pid });
    }

    // Generic tool endpoint: the MCP server (and any other client) calls tools here.
    const toolMatch = urlPath.match(/^\/api\/tools\/([a-z_]+)$/);
    if (toolMatch && method === 'POST') {
      const tool = tools[toolMatch[1]];
      if (!tool) return errorResponse(res, 'Unknown tool', 404);
      const body = await parseBody(req);
      const args = z.object(tool.inputSchema || {}).parse(body);
      return jsonResponse(res, await tool.handler(args));
    }

    if (method === 'GET' && urlPath === '/api/playlists') {
      return jsonResponse(res, await listPlaylists());
    }

    if (method === 'POST' && urlPath === '/api/playlists') {
      const body = await parseBody(req);
      const playlist = await createPlaylist(body.name);
      return jsonResponse(res, playlist, 201);
    }

    if (method === 'GET' && urlPath === '/api/queue') {
      return jsonResponse(res, getQueueState());
    }

    if (method === 'GET' && urlPath === '/api/nowplaying') {
      const running = await isMpvRunning();
      if (!running) return jsonResponse(res, null);
      const np = await getNowPlaying();
      return jsonResponse(res, np && { ...np, meta: getLoadedStreams().meta });
    }

    if (method === 'GET' && urlPath.startsWith('/api/search')) {
      const url = new URL(req.url, 'http://localhost');
      const q = url.searchParams.get('q') || '';
      const type = url.searchParams.get('type') || 'movie';
      const results = await searchMedia(q, type);
      const enriched = await Promise.all(
        results.map(async r => {
          const [imdbId, latestEp] = await Promise.all([
            getImdbId(r.id, type).catch(() => null),
            type === 'tv' ? getLatestEpisode(r.id).catch(() => null) : Promise.resolve(null),
          ]);
          return { ...r, imdbId, latestEp, posterUrl: null };
        })
      );
      return jsonResponse(res, enriched);
    }

    if (method === 'POST' && urlPath === '/api/playlist/skip') {
      await skipCurrent();
      return jsonResponse(res, { ok: true });
    }

    if (method === 'POST' && urlPath === '/api/playlist/stop') {
      await stopQueue();
      return jsonResponse(res, { ok: true });
    }

    const playlistMatch = urlPath.match(/^\/api\/playlists\/([^/]+)$/);
    if (playlistMatch) {
      const id = playlistMatch[1];
      if (method === 'GET') {
        const playlist = await getPlaylist(id);
        if (!playlist) return errorResponse(res, 'Not found', 404);
        return jsonResponse(res, playlist);
      }
      if (method === 'DELETE') {
        await deletePlaylist(id);
        return jsonResponse(res, { ok: true });
      }
    }

    const itemsMatch = urlPath.match(/^\/api\/playlists\/([^/]+)\/items$/);
    if (itemsMatch && method === 'POST') {
      const id = itemsMatch[1];
      const body = await parseBody(req);
      const item = await addItem(id, body);
      return jsonResponse(res, item, 201);
    }

    const itemDeleteMatch = urlPath.match(/^\/api\/playlists\/([^/]+)\/items\/([^/]+)$/);
    if (itemDeleteMatch && method === 'DELETE') {
      const [, id, itemId] = itemDeleteMatch;
      await removeItem(id, itemId);
      return jsonResponse(res, { ok: true });
    }

    const reorderMatch = urlPath.match(/^\/api\/playlists\/([^/]+)\/items\/reorder$/);
    if (reorderMatch && method === 'PUT') {
      const id = reorderMatch[1];
      const body = await parseBody(req);
      await reorderItems(id, body.order);
      return jsonResponse(res, { ok: true });
    }

    const playMatch = urlPath.match(/^\/api\/playlists\/([^/]+)\/play$/);
    if (playMatch && method === 'POST') {
      const id = playMatch[1];
      const body = await parseBody(req);
      startPlaylist(id, body.fromIndex)
        .catch(err => broadcastToAll({ type: 'error', data: { message: err.message } }));
      return jsonResponse(res, { ok: true });
    }

    const resumeMatch = urlPath.match(/^\/api\/playlists\/([^/]+)\/resume$/);
    if (resumeMatch && method === 'POST') {
      const id = resumeMatch[1];
      resumePlaylist(id)
        .catch(err => broadcastToAll({ type: 'error', data: { message: err.message } }));
      return jsonResponse(res, { ok: true });
    }

    return errorResponse(res, 'Not found', 404);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
}

export function startWebServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      if (urlPath.startsWith('/api/')) {
        handleApi(req, res, urlPath);
      } else {
        serveStatic(req, res);
      }
    });

    const wss = new WebSocketServer({ server });
    wss.on('error', () => {}); // surfaced via server 'error' below
    server.once('error', reject);

    setBroadcast(broadcastToAll);
    social.onSocial((event, data) => broadcastToAll({ type: 'social', event, data }));

    wss.on('connection', ws => {
      clients.add(ws);
      ws.send(JSON.stringify({ type: 'queue_state', data: getQueueState() }));
    ws.send(JSON.stringify({ type: 'social', event: 'state', data: social.snapshot() }));
      ws.on('message', (raw) => { try { const m = JSON.parse(raw); if (m.type === 'cursor') social.cursor(m.x, m.y, m.off); } catch {} });
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
    });

    server.listen(WEB_PORT, '127.0.0.1', () => resolve(server));
  });
}
