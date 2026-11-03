import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { tools, getLoadedStreams } from './tools.js';
import { FEEDS, getFeed, search as catalogSearch, getTitle } from './catalog.js';
import { getHistory } from './history.js';
import { WebSocketServer } from 'ws';

import {
  listPlaylists, getPlaylist, createPlaylist, deletePlaylist,
  addItem, removeItem, reorderItems,
  startPlaylist, resumePlaylist, skipCurrent, stopQueue,
  getQueueState, setBroadcast,
} from './playlist.js';

import { searchMedia, getImdbId, getLatestEpisode } from './tmdb.js';
import { getNowPlaying, isMpvRunning } from './mpv-ipc.js';

const WEB_DIR = fileURLToPath(new URL('../web', import.meta.url));
export const WEB_PORT = Number(process.env.IRONHIDE_PORT) || 7676;

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
const streamTags = (q) => TAG_PATTERNS.filter(([, re]) => re.test(q)).map(([t]) => t);

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
  jsonResponse(res, { error: message }, status);
}

async function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(WEB_DIR, urlPath);
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
      return jsonResponse(res, FEEDS.map(({ id, label, type }) => ({ id, label, type })));
    }

    const feedMatch = urlPath.match(/^\/api\/catalog\/feed\/([a-z_]+)$/);
    if (feedMatch && method === 'GET') {
      const items = await getFeed(feedMatch[1]);
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
      return jsonResponse(res, await getHistory(30));
    }

    // Stream picker: loads streams into the shared tool state so /api/play can use the index.
    if (method === 'GET' && urlPath === '/api/streams') {
      const p = new URL(req.url, 'http://localhost').searchParams;
      const type = p.get('type') === 'series' ? 'tv' : 'movie';
      const season = p.get('season') ? Number(p.get('season')) : undefined;
      const episode = p.get('episode') ? Number(p.get('episode')) : undefined;
      await tools.ironhide_streams.handler({ imdbId: p.get('imdbId'), title: p.get('title') || '', type, season, episode });
      const { streams } = getLoadedStreams();
      return jsonResponse(res, streams.map((s, i) => ({
        index: i + 1,
        isRD: s.isRD,
        quality: s.quality,
        size: s.size,
        seeds: s.seeds,
        resolution: (s.quality.match(/2160p|4k|1080p|720p|480p/i) || [''])[0].replace(/4k/i, '2160p'),
        tags: streamTags(s.quality),
      })));
    }

    if (method === 'POST' && urlPath === '/api/play') {
      const body = await parseBody(req);
      const tool = body.target === 'tv' ? tools.ironhide_cast_tv : tools.ironhide_play;
      return jsonResponse(res, await tool.handler({ index: Number(body.index), resumeFrom: body.resumeFrom }));
    }

    if (method === 'POST' && urlPath === '/api/control') {
      const body = await parseBody(req);
      return jsonResponse(res, await tools.ironhide_control.handler({ action: body.action, value: body.value }));
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
      return jsonResponse(res, np);
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

    wss.on('connection', ws => {
      clients.add(ws);
      ws.send(JSON.stringify({ type: 'queue_state', data: getQueueState() }));
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
    });

    server.listen(WEB_PORT, '127.0.0.1', () => resolve(server));
  });
}
