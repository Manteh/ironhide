// IronHide Tizen Bridge
// WebSocket server that connects to the TizenBrew app on the TV
// TV app connects here and receives play/control commands
// If another process already owns the bridge port, commands are proxied via HTTP

import { WebSocketServer } from 'ws';
import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const BRIDGE_PORT = 8787;
const STATUS_PORT = 8788; // HTTP status endpoint for tv-watcher
const PROXY_PORT = 9091;  // ffmpeg remux proxy for TV

let wss = null;
let statusServer = null;
let proxyServer = null;
let ffmpegProc = null;
let tvSocket = null;
let readyClients = new Set(); // all clients that sent 'ready'
let pendingResolves = []; // for request-response (status queries)
let lastPosition = { position: 0, duration: 0, state: 'IDLE' };
let onEventCallback = null;
let isRemote = false; // true when another process owns the bridge

// --- ffmpeg HLS proxy ---
// Remuxes video (copy) + transcodes audio to AAC as HLS segments
// TV plays the m3u8 playlist — seeking works per-segment, playable while downloading

const HLS_DIR = path.join(os.tmpdir(), 'ironhide-hls');

function killFfmpeg() {
  if (ffmpegProc) {
    try { ffmpegProc.kill('SIGTERM'); } catch {}
    ffmpegProc = null;
  }
}

function cleanupHls() {
  try {
    if (fs.existsSync(HLS_DIR)) {
      for (const f of fs.readdirSync(HLS_DIR)) {
        fs.unlinkSync(path.join(HLS_DIR, f));
      }
      fs.rmdirSync(HLS_DIR);
    }
  } catch {}
}

export function startProxy(sourceUrl) {
  killFfmpeg();
  cleanupHls();
  fs.mkdirSync(HLS_DIR, { recursive: true });

  return new Promise((resolve, reject) => {
    const proxyUrl = `http://192.168.1.242:${PROXY_PORT}/stream.m3u8`;

    // ffmpeg: copy video, transcode audio to AAC, output HLS segments
    ffmpegProc = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'warning',
      '-i', sourceUrl,
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
      '-f', 'hls',
      '-hls_time', '10',
      '-hls_list_size', '0',        // keep all segments in playlist
      '-hls_flags', 'append_list',   // append to playlist as segments are created
      '-hls_segment_filename', path.join(HLS_DIR, 'seg%04d.ts'),
      path.join(HLS_DIR, 'stream.m3u8'),
    ]);

    ffmpegProc.stderr.on('data', (d) => {
      console.error(`[ffmpeg] ${d.toString().trim()}`);
    });

    ffmpegProc.on('error', (err) => {
      console.error(`[ffmpeg] spawn error: ${err.message}`);
      reject(err);
    });

    ffmpegProc.on('close', (code) => {
      console.error(`[ffmpeg] exited with code ${code}`);
      ffmpegProc = null;
    });

    // Wait for first segment + playlist to appear
    const checkInterval = setInterval(() => {
      try {
        const playlist = path.join(HLS_DIR, 'stream.m3u8');
        const seg0 = path.join(HLS_DIR, 'seg0000.ts');
        if (fs.existsSync(playlist) && fs.existsSync(seg0)) {
          clearInterval(checkInterval);
          clearTimeout(failTimeout);
          console.error(`[proxy] HLS ready, first segment written`);
          resolve(proxyUrl);
        }
      } catch {}
    }, 300);

    const failTimeout = setTimeout(() => {
      clearInterval(checkInterval);
      killFfmpeg();
      reject(new Error('ffmpeg failed to produce HLS output'));
    }, 30000);

    // Start proxy HTTP server if not already running
    if (!proxyServer) {
      proxyServer = http.createServer((req, res) => {
        // Serve any file from HLS_DIR
        const reqPath = req.url.split('?')[0].replace(/^\//, '');
        const filePath = path.join(HLS_DIR, reqPath);

        // Security: ensure the path is within HLS_DIR
        if (!filePath.startsWith(HLS_DIR)) {
          res.writeHead(403);
          res.end();
          return;
        }

        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          res.end();
          return;
        }

        const stat = fs.statSync(filePath);
        const ext = path.extname(filePath);
        const contentType = ext === '.m3u8' ? 'application/vnd.apple.mpegurl'
                          : ext === '.ts' ? 'video/mp2t'
                          : 'application/octet-stream';

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': ext === '.m3u8' ? 'no-cache' : 'max-age=3600',
        });

        fs.createReadStream(filePath).pipe(res);
      });
      proxyServer.listen(PROXY_PORT, '0.0.0.0');
      proxyServer.on('error', (err) => {
        console.error(`[proxy] server error: ${err.message}`);
      });
      console.error(`[proxy] HTTP server listening on ${PROXY_PORT}`);
    }
  });
}

export function stopProxy() {
  killFfmpeg();
  cleanupHls();
}

export function startBridge() {
  if (wss) return;

  wss = new WebSocketServer({ port: BRIDGE_PORT, host: '0.0.0.0' });

  wss.on('connection', (ws) => {
    const remoteAddr = (ws._socket?.remoteAddress || '').replace('::ffff:', '');
    console.error(`[bridge] WS connection from ${remoteAddr}`);

    // Enforce single active client: kick any existing connections so only the
    // newest one receives play/config/command events.
    for (const old of readyClients) {
      if (old !== ws && old.readyState === 1) {
        try { old.send(JSON.stringify({ action: 'superseded' })); } catch {}
        try { old.close(4000, 'superseded by newer client'); } catch {}
      }
    }
    readyClients.clear();
    tvSocket = null;

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      // Update last known position
      if (msg.type === 'position' || msg.type === 'status') {
        lastPosition = {
          position: msg.position || 0,
          duration: msg.duration || 0,
          state: msg.state || 'IDLE',
          title: msg.title || '',
          isBuffering: msg.isBuffering || false,
        };
      }

      // Resolve pending status requests
      if (msg.type === 'status') {
        const resolvers = pendingResolves.splice(0);
        for (const resolve of resolvers) {
          resolve(msg);
        }
      }

      // Log all messages
      console.error(`[bridge] from ${remoteAddr}: ${JSON.stringify(msg).slice(0, 300)}`);

      // Client identifies itself with a 'ready' event
      if (msg.type === 'event' && msg.event === 'ready') {
        tvSocket = ws;
        readyClients.add(ws);
        console.error(`[bridge] client ready from ${remoteAddr} (${readyClients.size} total)`);
      }

      // Forward events
      if (msg.type === 'event' && onEventCallback) {
        onEventCallback(msg.event, msg.detail || {});
      }
    });

    ws.on('close', () => {
      readyClients.delete(ws);
      if (tvSocket === ws) tvSocket = null;
    });

    ws.on('error', () => {});
  });

  wss.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      // Another process owns the bridge — switch to remote/proxy mode
      wss = null;
      isRemote = true;
    }
  });

  // HTTP status + command endpoint for tv-watcher and remote MCP servers
  statusServer = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/command') {
      // Accept commands from other MCP server processes
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const cmd = JSON.parse(body);
          if (cmd.action === 'status-request') {
            // Return status via promise
            tvGetStatus(2000).then((status) => {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(status));
            });
            return;
          }
          sendCommand(cmd);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // GET — status check
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: isTVConnectedLocal(),
      ...lastPosition,
    }));
  });
  statusServer.listen(STATUS_PORT, '127.0.0.1');
  statusServer.on('error', () => {});
}

export function stopBridge() {
  if (wss) {
    wss.close();
    wss = null;
    tvSocket = null;
  }
}

// Local check — only works if this process owns the bridge
function isTVConnectedLocal() {
  for (const client of readyClients) {
    if (client.readyState === 1) return true;
  }
  return false;
}

// Check if TV is connected — works even from a remote process
export async function isTVConnectedAsync() {
  if (!isRemote) return isTVConnectedLocal();
  // Ask the bridge-owning process via HTTP
  try {
    const res = await fetch(`http://127.0.0.1:${STATUS_PORT}/`);
    const data = await res.json();
    return data.connected === true;
  } catch {
    return false;
  }
}

// Sync version — for backwards compat, but only accurate for local bridge
export function isTVConnected() {
  if (!isRemote) return isTVConnectedLocal();
  // In remote mode, can't do sync HTTP — return true optimistically
  // (the actual command will fail with a clear error if not connected)
  return true;
}

function sendCommand(cmd) {
  if (readyClients.size === 0) {
    throw new Error('No clients connected. Open IronHide on the TV or browser first.');
  }
  const msg = JSON.stringify(cmd);
  console.error(`[bridge] sending to ${readyClients.size} client(s): ${msg.slice(0, 200)}`);
  for (const client of readyClients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

// Send command via HTTP to the bridge-owning process
async function sendCommandRemote(cmd) {
  const res = await fetch(`http://127.0.0.1:${STATUS_PORT}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

function sendOrProxy(cmd) {
  if (!isRemote) {
    sendCommand(cmd);
    return Promise.resolve();
  }
  return sendCommandRemote(cmd);
}

// --- Commands ---

export async function tvPlay(url, title, resumeFrom) {
  await sendOrProxy({
    action: 'play',
    url,
    title: title || 'IronHide',
    resumeFrom: resumeFrom || 0,
  });
}

export async function tvNotify(msg, level) {
  await sendOrProxy({ action: 'notify', msg: msg || '', level: level || 'info' });
}

export async function tvPause() {
  await sendOrProxy({ action: 'pause' });
}

export async function tvResume() {
  await sendOrProxy({ action: 'resume' });
}

export async function tvStop() {
  await sendOrProxy({ action: 'stop' });
}

export async function tvSeek(ms, relative) {
  await sendOrProxy({ action: 'seek', ms, relative: !!relative });
}

export async function tvGetStatus(timeoutMs) {
  if (isRemote) {
    // Ask the bridge-owning process
    try {
      const data = await sendCommandRemote({ action: 'status-request' });
      return data;
    } catch {
      return { state: 'DISCONNECTED', position: 0, duration: 0 };
    }
  }

  if (!tvSocket || tvSocket.readyState !== 1) {
    return { state: 'DISCONNECTED', position: 0, duration: 0 };
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Remove this resolver and return last known
      const idx = pendingResolves.indexOf(resolve);
      if (idx >= 0) pendingResolves.splice(idx, 1);
      resolve(lastPosition);
    }, timeoutMs || 2000);

    pendingResolves.push((msg) => {
      clearTimeout(timer);
      resolve(msg);
    });

    sendCommand({ action: 'status' });
  });
}

export function getLastPosition() {
  return lastPosition;
}

export function onTVEvent(callback) {
  onEventCallback = callback;
}

export function getBridgePort() {
  return BRIDGE_PORT;
}
