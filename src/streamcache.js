// A small caching proxy between mpv and the debrid CDN, on its own loopback port.
//
// Why: switching the audio or subtitle track makes mpv's demuxer throw away everything it buffered and read the
// file again from a little before the current spot (1 s for audio, 10 s for subtitles), so every switch was a
// fresh download: 4-6 s of "buffering". mpv also followed the Torrentio -> TorBox -> CDN redirects again on every
// seek, which cost about a second each time.
//
// What it does:
//  - follows the redirects once and talks to the CDN directly; if the CDN stops accepting the link (it expired
//    during a long pause), it asks the original link for a fresh one and carries on
//  - keeps the most recently downloaded 4 MiB blocks in memory (1 GiB by default), so mpv's re-reads after a track
//    switch or a short seek back come from RAM instead of the internet
// Nothing touches the disk, and a film's memory is released when the next one starts or playback stops.

import http from 'http';
import { randomBytes } from 'crypto';

const BLOCK = 4 * 1024 * 1024;
const MAX_BYTES = Math.max(64, Number(process.env.IRONHIDE_STREAM_CACHE_MB) || 1024) * 1024 * 1024;
const MAX_BLOCKS = Math.floor(MAX_BYTES / BLOCK);
const UA = 'Orbie';

let server = null;
let port = 0;
const sessions = new Map(); // id -> session

function startServer() {
  if (server) return Promise.resolve(port);
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => handle(req, res).catch((e) => {
      console.error('[streamcache]', e.message);
      if (!res.headersSent) { res.writeHead(502); }
      res.end();
    }));
    s.keepAliveTimeout = 60000;
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { server = s; port = s.address().port; resolve(port); });
  });
}

/// Resolve the redirects once and give mpv a local URL for it. Falls back to the original URL if anything fails.
export async function proxied(sourceUrl) {
  try {
    await startServer();
    const sess = { source: sourceUrl, direct: null, size: 0, type: 'application/octet-stream', blocks: new Map(), resolving: null };
    await resolve(sess);
    if (!sess.size) return sourceUrl; // no length or ranges: nothing to cache, let mpv go direct
    for (const id of [...sessions.keys()]) drop(id); // one film at a time
    const id = randomBytes(16).toString('hex');
    sessions.set(id, sess);
    const name = decodeURIComponent(new URL(sourceUrl).pathname.split('/').pop() || 'video'); // mpv guesses the format from it too
    return `http://127.0.0.1:${port}/s/${id}/${encodeURIComponent(name)}`;
  } catch (e) {
    console.error('[streamcache] going direct:', e.message);
    return sourceUrl;
  }
}

/// Playback ended: free the memory.
export function release() { for (const id of [...sessions.keys()]) drop(id); }

function drop(id) { const s = sessions.get(id); if (s) { s.blocks.clear(); sessions.delete(id); } }

// follow the redirects to the CDN and learn the size
async function resolve(sess) {
  if (sess.resolving) return sess.resolving;
  sess.resolving = (async () => {
    const r = await fetch(sess.source, { headers: { Range: 'bytes=0-0', 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    await r.body?.cancel().catch(() => {});
    if (r.status !== 206) throw new Error(`no range support (HTTP ${r.status})`);
    const total = Number((r.headers.get('content-range') || '').split('/')[1]);
    if (!(total > 0)) throw new Error('unknown size');
    sess.direct = r.url;
    sess.size = total;
    sess.type = r.headers.get('content-type') || sess.type;
  })().finally(() => { sess.resolving = null; });
  return sess.resolving;
}

// one upstream request from `start`, re-resolving the link once if the CDN refuses it
async function upstream(sess, start, signal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(sess.direct, { headers: { Range: `bytes=${start}-`, 'User-Agent': UA }, redirect: 'follow', signal });
      if (r.status === 206) return r;
      await r.body?.cancel().catch(() => {});
      if (attempt === 0 && [401, 403, 404, 410, 429, 500, 502, 503].includes(r.status)) { await resolve(sess); continue; }
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (signal.aborted) throw e;
      if (attempt === 0) { await resolve(sess); continue; }
      throw e;
    }
  }
}

function getBlock(sess, i) {
  const b = sess.blocks.get(i);
  if (b) { sess.blocks.delete(i); sess.blocks.set(i, b); } // most recently used goes last
  return b;
}
function putBlock(sess, i, buf) {
  sess.blocks.delete(i);
  sess.blocks.set(i, buf);
  while (sess.blocks.size > MAX_BLOCKS) sess.blocks.delete(sess.blocks.keys().next().value);
}

function send(res, buf) {
  if (res.destroyed) return Promise.resolve(false);
  if (res.write(buf)) return Promise.resolve(true);
  return new Promise((ok) => {
    const done = (v) => { res.off('drain', onDrain); res.off('close', onClose); ok(v); };
    const onDrain = () => done(true), onClose = () => done(false);
    res.on('drain', onDrain); res.on('close', onClose);
  });
}

async function handle(req, res) {
  const m = /^\/s\/([0-9a-f]{32})(\/|$)/.exec(req.url || '');
  const sess = m && sessions.get(m[1]);
  if (!sess) { res.writeHead(404); return res.end(); }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

  const size = sess.size;
  let start = 0, end = size - 1, partial = false;
  const rh = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (rh) {
    partial = true;
    if (rh[1] === '') { start = Math.max(0, size - Number(rh[2])); } // suffix range: the last N bytes
    else { start = Number(rh[1]); if (rh[2] !== '') end = Math.min(size - 1, Number(rh[2])); }
    if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
  }
  const head = { 'Content-Type': sess.type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 };
  if (partial) head['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(partial ? 206 : 200, head);
  if (req.method === 'HEAD') return res.end();

  let ac = null; // the CDN request in flight, cancelled when the player hangs up
  res.on('close', () => ac?.abort());
  let pos = start;
  while (pos <= end && !res.destroyed) {
    // serve what is cached
    const i = Math.floor(pos / BLOCK);
    const cached = getBlock(sess, i);
    if (cached) {
      const from = pos - i * BLOCK, to = Math.min(cached.length, end - i * BLOCK + 1);
      if (!(await send(res, cached.subarray(from, to)))) break;
      pos = i * BLOCK + to;
      continue;
    }
    // not cached: stream from the CDN from here, keeping every whole block, until we reach a block we already have
    ac = new AbortController();
    const next = await fromUpstream(sess, res, pos, end, ac);
    if (next <= pos) break; // the CDN sent nothing more: end the response, mpv reconnects by itself
    pos = next;
  }
  res.end();
}

async function fromUpstream(sess, res, pos, end, ac) {
  const r = await upstream(sess, pos, ac.signal);
  const reader = r.body.getReader();
  // collect into the block that `pos` falls in; a block only counts once we saw it from its first byte
  let bi = Math.floor(pos / BLOCK);
  let whole = pos % BLOCK === 0;
  let parts = [], have = 0;
  const blockLen = (i) => Math.min(BLOCK, sess.size - i * BLOCK);
  try {
    while (pos <= end) {
      const { value, done } = await reader.read();
      if (done) break;
      let chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      while (chunk.length) {
        const room = (bi + 1) * BLOCK - pos; // bytes left in this block
        const take = chunk.subarray(0, Math.min(chunk.length, room));
        chunk = chunk.subarray(take.length);
        // to the player (only up to what it asked for)
        const want = Math.max(0, Math.min(take.length, end - pos + 1));
        if (want && !(await send(res, take.subarray(0, want)))) { ac.abort(); return end + 1; }
        if (whole) { parts.push(Buffer.from(take)); have += take.length; }
        pos += take.length;
        if (pos >= (bi + 1) * BLOCK || pos >= sess.size) {
          if (whole && have === blockLen(bi)) putBlock(sess, bi, Buffer.concat(parts, have));
          bi++; whole = true; parts = []; have = 0;
          // the next block is already here: let the caller serve it from memory
          if (pos <= end && sess.blocks.has(bi)) { ac.abort(); return pos; }
        }
        if (pos > end) break;
      }
    }
  } catch (e) {
    if (!ac.signal.aborted) throw e;
  } finally {
    reader.cancel().catch(() => {});
  }
  return pos > end ? end + 1 : pos;
}
