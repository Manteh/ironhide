import { execFile } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { tools, getLoadedStreams, getPlaybackStatus } from './tools.js';
import { FEEDS, CINE_GENRES, getFeed, getGenres, search as catalogSearch, getTitle } from './catalog.js';
import { forYou } from './discover.js';
import { recommend, recommendSections, noteOpened, tasteSummary, rate, notInterested, ratingOf, loadTaste } from './recommend.js';
const hiddenSet = async () => new Set(((await loadTaste().catch(() => ({}))).notInterested || []).map((n) => n.imdbId));
import { smartSearch } from './search.js';
import * as lab from './lab.js';
import { getHistory } from './history.js';
import { profileData, profileMeta } from './profile.js';
import { parseLangs } from './ui.js';
import * as social from './social.js';
import { listInstances, createInstance, startInstance, stopInstance, removeInstance } from './instances.js';
import { addToHistory, updateEntryProgress, removeFromHistory, markWatched } from './history.js';
import { learnQuality } from './preferences.js';
import { refreshLink, touchSession, keyframesAround, ensureSyncClip, syncClipPath, capabilities, createSession, getSession, streamTo, subtitleVtt, closeSession, thumbFor, exactThumb, startThumbs } from './webplay.js';
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
import { getInfo, nowImdbId, getPerson, tmdbToImdb } from './moviemeta.js';
import { nextEpisodeAfter } from './catalog.js';
import { getPlayState, setPlayState, beginLaunch } from './playstate.js';

const WEB_DIR = fileURLToPath(new URL('../web', import.meta.url));
// A key that names one release without any debrid key in it: the torrent hash and file when we can see them, else the release name.
// Where this person stopped in a film or episode, if it wasn't finished
const resumeFor = (hist, imdbId, season, episode) => {
  const h = hist.find((x) => x.imdbId === imdbId && (x.season || null) === (season || null) && (x.episode || null) === (episode || null));
  return h && (h.percent || 0) < 90 && h.position > 30 ? h.position : 0;
};
let lastNp = null; // the last good now-playing answer
// A release the debrid server refused stays marked for a while, so nobody is sent back to it
const brokenStreams = new Map(), BROKEN_MS = 30 * 60 * 1000;
const isBroken = (st) => { const k = streamPin(st), t = brokenStreams.get(k); if (t && Date.now() - t > BROKEN_MS) brokenStreams.delete(k); return brokenStreams.has(k); };
const brokenSet = (streams) => new Set(streams.flatMap((s, i) => (isBroken(s) ? [i + 1] : [])));
// The browser plays 1080p by default: lighter to download and decode, and it starts faster. mpv keeps your normal quality settings.
const webPrefs = (p) => (p.webMaxHeight === 'source' ? p : { ...p, quality: `${p.webMaxHeight}p`, remux: 'avoid', maxSizeGb: p.maxSizeGb || 20 }); // your 4K remux preference is for mpv
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
// Turns a release name into what a person cares about: picture, sound, languages, whether it's one episode or a whole pack.
const DUB_STUDIOS = /lostfilm|hdrezka|alexfilm|newstudio|jaskier|kubik|coldfilm|\bmvo\b|\bdvo\b|\bavo\b|дубляж|многоголос/i;
function describeStream(q, isSeries = false, title = '') {
  const source = /remux/i.test(q) ? 'Remux' : /blu-?ray|bdrip|brrip/i.test(q) ? 'Blu-ray' : /web-?dl|webmux/i.test(q) ? 'WEB-DL' : /webrip/i.test(q) ? 'WEBRip' : /\bweb\b/i.test(q) ? 'WEB' : /hdtv/i.test(q) ? 'HDTV' : /dvd/i.test(q) ? 'DVD' : /\bcam\b|telesync|\bts\b|hdcam/i.test(q) ? 'CAM' : '';
  const codec = /\bav1\b/i.test(q) ? 'AV1' : /hevc|x265|h[ .]?265/i.test(q) ? 'HEVC' : /x264|h[ .]?264|\bavc\b/i.test(q) ? 'H.264' : '';
  const ch = (q.match(/(?:ddp|dd\+|eac3|e-ac-3|ac3|dd|aac|dts(?:-?hd)?(?:[ .-]?ma)?|truehd|opus|flac)[ .]?([1-9])[ .]([01])\b/i) || [])
  const channels = ch[1] ? `${ch[1]}.${ch[2]}` : /\b7[ .]1\b/.test(q) ? '7.1' : /\b5[ .]1\b/.test(q) ? '5.1' : '';
  const codecA = /atmos/i.test(q) ? 'Atmos' : /truehd/i.test(q) ? 'TrueHD' : /dts-?hd|dts[ .-]?ma/i.test(q) ? 'DTS-HD' : /\bdts\b/i.test(q) ? 'DTS' : /ddp|dd\+|eac-?3|e-ac-3/i.test(q) ? 'DD+' : /\bdd(?=\d|\b)|\bac-?3\b/i.test(q) ? 'DD' : /\baac(?=\d|\b)/i.test(q) ? 'AAC' : /\bopus\b/i.test(q) ? 'Opus' : '';
  const audio = codecA && channels && !['Atmos'].includes(codecA) ? `${codecA} ${channels}` : codecA || (channels ? `${channels} sound` : '');
  const hdr = [];
  if (/dolby.?vision|\bdv\b|dovi/i.test(q)) hdr.push('Dolby Vision');
  if (/hdr10\+|hdr10plus/i.test(q)) hdr.push('HDR10+'); else if (/\bhdr(?:10)?\b/i.test(q) && !/\bsdr\b/i.test(q)) hdr.push('HDR10');
  const group = (q.match(/-([A-Za-z0-9]{2,14})(?:\[[^\]]*\])?(?:\.\w{2,4})?\s*$/) || [])[1] || (q.match(/\|\s*([A-Za-z][\w ]{2,20})\s*$/) || [])[1]?.trim() || '';
  // words from the title itself are not languages ("No Time to Die" is not Norwegian, "It" is not Italian)
  const tw = new Set(String(title).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const qNoTitle = q.split(/[.\s_\-]+/).filter((t) => !tw.has(t.toLowerCase())).join(' ');
  const langs = new Set(parseLangs(qNoTitle).filter((l) => l !== 'EN'));
  if (/[а-яё]/i.test(q) || DUB_STUDIOS.test(q)) langs.add('RU');
  if (/\bukr\b|ззовні|укр/i.test(q)) { langs.add('UA'); }
  if (/\bvff\b|\bvfq\b|\bvostfr\b/i.test(q)) langs.add('FR');
  if (/lektor|napisy/i.test(q)) langs.add('PL');
  if (/legendado|dublado/i.test(q)) langs.add('PT');
  if (/stagione/i.test(q)) langs.add('IT');
  // dubbed (voice-over in another language) vs original audio kept alongside
  const dub = DUB_STUDIOS.test(q) || /\blektor\b|\bdublado\b|\bvff\b/i.test(q);
  const original = /\boriginal\b|\beng\b|english|\+ ?eng/i.test(q) || !langs.size || /MULTI/i.test(q);
  const subs = /\bsubs?\b|napisy|legendado|vostfr|субт/i.test(q);
  const tenbit = /10[ .-]?bit/i.test(q);
  const service = (q.match(/\b(AMZN|NF|DSNP|ATVP|HMAX|MAX|STAN|HULU|PCOK|PMTP|CATCHPLAY|MGMP)\b/) || [])[1] || '';
  // a whole season (or several) in one torrent, rather than just this episode
  const pack = isSeries && (/\bS\d{1,2}(?![ .]?E\d)\b|\bS\d{1,2}-S?\d{1,2}\b|season|stagione|сезон|sezon|complete|\d{2}x\d{2}-\d{2}|E\d{2}-E?\d{2}/i.test(q)) && !/\bS\d{1,2}[ .]?E\d{1,3}(?![ .-]?E?\d)/i.test(q);
  const fixes = /\b(repack|proper|regrade)\b/i.test(q) ? (q.match(/\b(repack|proper|regrade)\b/i)[1]).toUpperCase() : '';
  return { source, codec, audio, channels, hdr, group, langs: [...langs].slice(0, 3), dub, original, subs, tenbit, service, pack, fixes };
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
      return jsonResponse(res, { feeds: FEEDS.map(({ id, label, short, kind, type, noGenre, cine, year, shuffle, tmdb, single }) => ({ id, label, short: short || label, kind, type, noGenre: !!noGenre, cine: !!cine, year: !!year, shuffle: !!shuffle, tmdb: !!tmdb, single: !!single })), cineGenres: CINE_GENRES, genres: await getGenres() });
    }

    if (method === 'GET' && urlPath === '/api/catalog/foryou') {
      // the taste engine; until it knows enough about you (or if TMDB is unreachable) the old mixed feed fills in
      const seed = new URL(req.url, 'http://localhost').searchParams.get('seed') || 0;
      const recs = await recommend({ seed }).catch(() => []);
      if (recs.length >= 12) return jsonResponse(res, recs);
      const mix = await forYou({ seed }); const have = new Set(recs.map((r) => r.imdbId)), hidden = await hiddenSet();
      return jsonResponse(res, [...recs, ...mix.filter((m) => !have.has(m.imdbId) && !hidden.has(m.imdbId))].slice(0, 48));
    }
    if (method === 'GET' && urlPath === '/api/foryou/sections') return jsonResponse(res, await recommendSections({ seed: new URL(req.url, 'http://localhost').searchParams.get('seed') || 0 }).catch((e) => ({ sections: [], error: String(e.message || e) })));
    if (method === 'POST' && urlPath === '/api/rec/opened') { const b = await parseBody(req); if (/^tt\d+$/.test(b.imdbId || '')) noteOpened(b.imdbId); return jsonResponse(res, { ok: true }); }
    if (method === 'GET' && urlPath === '/api/taste') return jsonResponse(res, await tasteSummary().catch((e) => ({ error: String(e.message || e) })));
    if (method === 'GET' && /^\/api\/rating\/tt\d+$/.test(urlPath)) return jsonResponse(res, await ratingOf(urlPath.split('/').pop()));
    if (method === 'POST' && urlPath === '/api/rate') { try { return jsonResponse(res, await rate(await parseBody(req))); } catch (e) { return errorResponse(res, e.message, 400); } }
    if (method === 'POST' && urlPath === '/api/notinterested') { try { return jsonResponse(res, await notInterested(await parseBody(req))); } catch (e) { return errorResponse(res, e.message, 400); } }

    const feedMatch = urlPath.match(/^\/api\/catalog\/feed\/([a-z_]+)$/);
    if (feedMatch && method === 'GET') {
      const fp = new URL(req.url, 'http://localhost').searchParams;
      const items = await getFeed(feedMatch[1], { genre: fp.get('genre') || '', skip: fp.get('skip') || 0, type: fp.get('type') || '', year: fp.get('year') || '', seed: fp.get('seed') || 0 });
      if (!items) return errorResponse(res, 'Unknown feed', 404);
      const hidden = await hiddenSet();
      return jsonResponse(res, items.filter((x) => !hidden.has(x.imdbId)));
    }

    if (urlPath.startsWith('/api/lab/')) {
      const sub = urlPath.slice(9), qp = new URL(req.url, 'http://localhost').searchParams;
      try {
        if (method === 'GET' && sub === 'deck') return jsonResponse(res, await lab.deck({ n: +qp.get('n') || 20, seed: +qp.get('seed') || 0 }));
        if (method === 'GET' && sub === 'pair') return jsonResponse(res, await lab.pair());
        if (method === 'GET' && sub === 'board') return jsonResponse(res, await lab.board());
        if (method === 'POST' && sub === 'skip') return jsonResponse(res, await lab.skip(await parseBody(req)));
        if (method === 'POST' && sub === 'duel') return jsonResponse(res, await lab.duel(await parseBody(req)));
      } catch (e) { return errorResponse(res, e.message, 400); }
    }
    if (method === 'GET' && urlPath === '/api/search/smart') {
      const q = (new URL(req.url, 'http://localhost').searchParams.get('q') || '').trim();
      return jsonResponse(res, await smartSearch(q).catch((e) => ({ titles: [], people: [], error: String(e.message || e) })));
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

    if (method === 'POST' && urlPath === '/api/history/remove') { const b = await parseBody(req); return jsonResponse(res, { removed: /^tt\d+$/.test(b.imdbId || '') ? await removeFromHistory(b.imdbId) : 0 }); }
    if (method === 'POST' && urlPath === '/api/history/watched') { const b = await parseBody(req); return jsonResponse(res, { ok: /^tt\d+$/.test(b.imdbId || '') ? await markWatched(b.imdbId, b.season ?? null, b.episode ?? null) : false }); }
    if (method === 'GET' && urlPath === '/api/history') {
      return jsonResponse(res, await getHistory(100));
    }

    // Stream picker: loads streams into the shared tool state so /api/play can use the index.
    if (method === 'GET' && urlPath === '/api/streams') {
      const p = new URL(req.url, 'http://localhost').searchParams;
      const type = p.get('type') === 'series' ? 'tv' : 'movie';
      const season = p.get('season') ? Number(p.get('season')) : undefined;
      const episode = p.get('episode') ? Number(p.get('episode')) : undefined;
      // the name matters (player title, history, telling title words from languages): look it up when the caller didn't send it
      let title = p.get('title') || '';
      if (!title && /^tt\d+$/.test(p.get('imdbId') || '')) title = (await getTitle(p.get('imdbId'), type === 'tv' ? 'series' : 'movie').catch(() => null))?.title || '';
      await tools.ironhide_streams.handler({ imdbId: p.get('imdbId'), title, type, season, episode });
      const { streams } = getLoadedStreams();
      const pb = (await getSettings()).playback;
      const best = pickBest(streams, pb.player === 'web' ? webPrefs(pb) : pb, { exclude: brokenSet(streams) });
      return jsonResponse(res, streams.map((s, i) => ({
        best: best === i + 1,
        broken: isBroken(s),
        index: i + 1,
        isRD: s.isRD,
        cached: s.cached,
        quality: s.quality,
        size: s.size,
        sizeGb: s.sizeBytes / 1e9,
        seeds: s.seeds,
        resolution: (s.quality.match(/2160p|4k|1080p|720p|480p/i) || [''])[0].toLowerCase().replace('4k', '2160p'),
        tags: streamTags(s.quality),
        ...describeStream(s.quality, type === 'tv', title),
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
        if (last) { const done = (last.percent || 0) >= 90; season = done && last.nextEp ? last.nextEp.season : last.season; episode = done ? (last.nextEp ? last.nextEp.episode : last.episode + 1) : last.episode; if (!done) resumeFrom = last.position; }
        else { season = 1; episode = 1; }
      }
      if (!resumeFrom) resumeFrom = resumeFor(hist, body.imdbId, type === 'tv' ? season : null, type === 'tv' ? episode : null);
      beginLaunch({ title: body.title || '', imdbId: body.imdbId });
      await tools.ironhide_streams.handler({ imdbId: body.imdbId, title: body.title || '', type, season, episode });
      const { streams } = getLoadedStreams();
      const best = pickBest(streams, playback, { exclude: brokenSet(streams) });
      if (!best) { setPlayState({ phase: 'error', detail: 'No streams found for this title' }); return errorResponse(res, 'No streams found for this title', 404); }
      setPlayState({ phase: 'resolving', detail: `Resolving ${streams[best - 1].size || 'stream'}` });
      const out = await tools.ironhide_play.handler({ index: best, resumeFrom });
      return jsonResponse(res, { ...out, played: { season, episode, resumeFrom: resumeFrom || 0 } });
    }

    // After something ends: was it finished, and what comes next? Checked against the saved history and the episode list.
    if (method === 'GET' && urlPath === '/api/nextup') {
      const p = new URL(req.url, 'http://localhost').searchParams, id = p.get('imdbId') || '';
      if (!/^tt\d+$/.test(id)) return jsonResponse(res, { finished: false, next: null });
      const season = p.get('season') ? Number(p.get('season')) : null, episode = p.get('episode') ? Number(p.get('episode')) : null;
      const h = (await getHistory(300)).find((x) => x.imdbId === id && (x.season || null) === season && (x.episode || null) === episode);
      const finished = !!h && (h.percent || 0) >= 90;
      const next = finished && season && episode ? (h.nextEp !== undefined ? h.nextEp : await nextEpisodeAfter(id, season, episode).catch(() => null)) : null;
      return jsonResponse(res, { finished, next, ended: finished && !!season && !next });
    }
    // The last thing mpv played, once it has closed
    if (method === 'GET' && urlPath === '/api/lastend') { const st = getPlaybackStatus(); return jsonResponse(res, st && st.status ? st : null); }
    if (method === 'GET' && urlPath === '/api/playstate') return jsonResponse(res, getPlayState());
    if (method === 'POST' && urlPath === '/api/play/cancel') { setPlayState({ phase: 'idle', detail: '' }); await tools.ironhide_control.handler({ action: 'stop' }).catch(() => {}); return jsonResponse(res, { ok: true }); }

    if (method === 'POST' && urlPath === '/api/play') {
      const body = await parseBody(req);
      const meta0 = getLoadedStreams().meta || {};
      beginLaunch({ title: meta0.title || '', imdbId: meta0.imdbId || '', detail: 'Resolving the link' });
      setPlayState({ phase: 'resolving' });
      const m0 = getLoadedStreams().meta || {};
      const resume = body.resumeFrom ?? resumeFor(await getHistory(200), m0.imdbId, m0.season, m0.episode);
      return jsonResponse(res, await tools.ironhide_play.handler({ index: Number(body.index), resumeFrom: resume || undefined }));
    }

    if (method === 'POST' && urlPath === '/api/control') {
      const body = await parseBody(req);
      return jsonResponse(res, await tools.ironhide_control.handler({ action: body.action, value: body.value }));
    }

    if (method === 'GET' && urlPath === '/api/settings') return jsonResponse(res, await getSettings());
    // cast, details and what people think, for the title that is playing (or a given IMDb id)
    if (method === 'GET' && /^\/api\/person\/\d+$/.test(urlPath)) return jsonResponse(res, await getPerson(urlPath.split('/').pop()).catch((e) => ({ error: String(e.message || e) })));
    if (method === 'GET' && /^\/api\/tmdb\/(movie|tv)\/\d+$/.test(urlPath)) { const [, , , kind, tid] = urlPath.split('/'); return jsonResponse(res, await tmdbToImdb(kind, tid).catch((e) => ({ error: String(e.message || e) }))); }
    if (method === 'GET' && urlPath.startsWith('/api/info/')) { const id = urlPath.slice(10); return jsonResponse(res, await getInfo(id === 'now' ? nowImdbId() : id).catch((e) => ({ error: String(e.message || e) }))); }
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

    if (method === 'GET' && urlPath === '/api/profile') return jsonResponse(res, await profileData());
    if (method === 'GET' && urlPath === '/api/profile/meta') return jsonResponse(res, await profileMeta());
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
    // Real numbers for the Updates tab, straight from git
    if (method === 'POST' && urlPath === '/api/updates/stats') {
      const items = (await parseBody(req)).items || [], out = {}, HASH = /^[0-9a-f]{7,40}$/, RANGE = /^[0-9a-f]{7,40}\.\.([0-9a-f]{7,40}|HEAD)$/;
      const git = (args) => new Promise((res2) => execFile('git', args, { cwd: fileURLToPath(new URL('..', import.meta.url)), maxBuffer: 4e7 }, (e, so) => res2(e ? '' : so)));
      const skip = (f) => /^docs\/screens\/|package-lock\.json$/.test(f);
      const count = (txt, r) => { for (const l of txt.split('\n')) { if (l.startsWith('@')) { r.commits++; const at = l.slice(1); r.lastAt ||= at; r.firstAt = at; continue; } const m = l.match(/^(\d+)\t(\d+)\t(.+)$/); if (m && !skip(m[3])) { r.add += +m[1]; r.del += +m[2]; r.files.add(m[3]); } } };
      for (const it of items.slice(0, 40)) {
        const args = it.range && RANGE.test(it.range) ? [it.range] : Array.isArray(it.commits) && it.commits.every((h) => HASH.test(h)) ? ['--no-walk', ...it.commits] : null; if (!args) continue;
        const r = { commits: 0, add: 0, del: 0, files: new Set(), lastAt: '', firstAt: '' };
        count(await git(['log', '--date-order', '--numstat', '--format=@%cI', ...args]), r);
        const row = { commits: r.commits, add: r.add, del: r.del, files: r.files.size, lastAt: r.lastAt, firstAt: r.firstAt };
        if (it.work) { const w = { commits: 0, add: 0, del: 0, files: new Set() }; count(await git(['diff', '--numstat', 'HEAD']), w); row.workAdd = w.add; row.workDel = w.del; }
        out[it.version] = row;
      }
      return jsonResponse(res, out);
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
        if (!resumeFrom) resumeFrom = resumeFor(await getHistory(200), loaded.meta.imdbId, season, episode); // picked a version by hand: still resume
        beginLaunch({ title: loaded.meta.title || '', imdbId: loaded.meta.imdbId || '', detail: 'Resolving the link' });
      } else {
        const hist = await getHistory(200);
        if (type === 'tv' && !(season && episode)) {
          const last = hist.find(h => h.imdbId === body.imdbId && h.season);
          if (last) { const done = (last.percent || 0) >= 90; season = done && last.nextEp ? last.nextEp.season : last.season; episode = done ? (last.nextEp ? last.nextEp.episode : last.episode + 1) : last.episode; if (!done) resumeFrom = last.position; }
          else { season = 1; episode = 1; }
        }
        if (!resumeFrom) resumeFrom = resumeFor(hist, body.imdbId, type === 'tv' ? season : null, type === 'tv' ? episode : null);
        beginLaunch({ title: body.title || '', imdbId: body.imdbId });
        await tools.ironhide_streams.handler({ imdbId: body.imdbId, title: body.title || '', type, season, episode });
        const loaded = getLoadedStreams();
        // In a room everyone plays the exact release the owner's copy chose. Without it, positions would not line up.
        const pinned = body.pin ? findPinned(loaded.streams, body.pin) : 0;
        const best = pinned || pickBest(loaded.streams, webPrefs(settings), { exclude: brokenSet(loaded.streams), browserSafe: CDN_DELIVERY || !!body.room });
        if (!best) { setPlayState({ phase: 'error', detail: 'No streams found for this title' }); return errorResponse(res, 'No streams found for this title', 404); }
        stream = loaded.streams[best - 1];
      }
      try {
        // CDN delivery (hosted mode): the browser plays straight from the debrid CDN, so only files it can
        // decode as-is qualify. Auto-pick moves on to the next best candidate when one doesn't.
        const tried = brokenSet(getLoadedStreams().streams), marked = [], first = stream; let info, direct;
        // A stream that fails gets marked and we move on to the next best one, even if it was picked by hand. Nobody needs to see "connection refused".
        for (let attempt = 0; attempt < 6; attempt++) {
          const loaded = getLoadedStreams(), meta = { ...loaded.meta, season, episode };
          try {
            if (!stream.isRD || !stream.url) throw new Error('The web player needs a debrid stream (this one is a torrent)');
            setPlayState({ phase: 'resolving', detail: `Resolving ${stream.size || 'stream'}` });
            const r = await fetch(stream.url, { redirect: 'manual' });
            direct = r.headers.get('location') || (r.status < 300 ? stream.url : null);
            if (!direct || /failed_|error|denied/i.test(direct)) throw new Error('That stream is not available right now');
            setPlayState({ phase: 'probing', detail: 'Checking codecs and tracks' });
            info = await createSession({ url: direct, origin: stream.url, title: meta.title || body.title || 'Playing', meta, subs: loaded.subs || [], caps: body.caps || {}, settings, delivery: CDN_DELIVERY ? 'cdn' : 'proxy' });
            break;
          } catch (e) {
            if (/ffmpeg is not installed/.test(e.message)) throw e;
            console.warn(`[webplay] stream failed: ${String(e.message).replace(/([?&](token|apikey|api_key)=)[^&\s]+/gi, '$1***').slice(0, 200)}`); // never log the debrid key
            if (stream.isRD && stream.url) { brokenStreams.set(streamPin(stream), Date.now()); marked.push(streamPin(stream)); }
            tried.add(loaded.streams.indexOf(stream) + 1);
            const next = pickBest(loaded.streams, webPrefs(settings), { exclude: tried, browserSafe: CDN_DELIVERY || !!body.room });
            if (!next) break;
            setPlayState({ phase: 'resolving', detail: "That version isn't working. Trying the next one" });
            stream = loaded.streams[next - 1];
          }
        }
        if (!info) {
          marked.forEach((k) => brokenStreams.delete(k)); // every one failed: more likely the debrid server than the releases, so let the next try start clean
          throw new Error("None of the versions we tried are working right now. Try again in a few minutes.");
        }
        const loaded = getLoadedStreams(), meta = { ...loaded.meta, season, episode };
        await addToHistory({ title: meta.title || stream.quality.slice(0, 40), imdbId: meta.imdbId || '', type: meta.type || type, season, episode, quality: stream.quality.slice(0, 80), streamUrl: stream.url, streamIsRD: true }).catch(() => {});
        if (meta.imdbId) await learnQuality(meta.imdbId, stream).catch(() => {});
        setPlayState({ phase: 'playing', detail: 'Opening the player' });
        if (body.fromStart) resumeFrom = 0;
        if (typeof body.roomStart === 'number' && body.roomStart >= 0) resumeFrom = body.roomStart; // a room that was paused here
        return jsonResponse(res, { ...info, swapped: stream !== first, start: resumeFrom || 0, pin: streamPin(stream), pinned: !body.pin || streamPin(stream) === body.pin, quality: stream.quality, size: stream.size });
      } catch (err) {
        setPlayState({ phase: 'error', detail: err.message });
        return errorResponse(res, err.message, 502);
      }
    }

    const wpMatch = urlPath.match(/^\/api\/wp\/([a-z0-9-]+)\/(stream|progress|thumbs|thumb|keyframes|sub\/(\d+)\.vtt)$/);
    if (wpMatch) {
      const [, id, what, subIdx] = wpMatch;
      touchSession(id);
      if (what === 'stream' && method === 'GET') {
        const q = new URL(req.url, 'http://localhost').searchParams;
        await refreshLink(id);
        return streamTo(res, id, Number(q.get('start')) || 0, Number(q.get('audio')) || 0, q.get('transcode') === '1', Number(q.get('sync')) || 0, q.get('abs') === '1');
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
        const sess = getSession(id), b = await parseBody(req); // take the session first: the player closes it right after saving
        if (sess && b.position >= 0 && b.duration > 0) {
          const m = sess.meta || {}, match = { imdbId: m.imdbId, season: m.season, episode: m.episode };
          const n = await updateEntryProgress(match, { position: b.position, duration: b.duration, eof: !!b.eof }).catch(() => null);
          if (n?.finished && m.season && m.episode) { const nextEp = await nextEpisodeAfter(m.imdbId, m.season, m.episode).catch(() => undefined); if (nextEp !== undefined) await updateEntryProgress(match, { position: b.position, duration: b.duration, eof: !!b.eof, nextEp }).catch(() => {}); }
          return jsonResponse(res, { ok: true, finished: !!n?.finished });
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
        const fp = sub.match(/^\/friends\/([A-Za-z0-9]+)\/profile$/); if (method === 'GET' && fp) return jsonResponse(res, await social.friendProfile(fp[1]));
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
      // mpv sometimes takes a moment to answer. Say "nothing playing" only after a few seconds of silence, so the page doesn't flicker.
      const running = await isMpvRunning();
      const np = running ? await getNowPlaying() : null;
      if (np) { lastNp = { at: Date.now(), v: { ...np, meta: getLoadedStreams().meta } }; return jsonResponse(res, lastNp.v); }
      if (lastNp && Date.now() - lastNp.at < 6000) return jsonResponse(res, { ...lastNp.v, stale: true });
      return jsonResponse(res, null);
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
