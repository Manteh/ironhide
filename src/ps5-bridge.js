// Shows chosen Orbie streams to Plex as ordinary files, so Plex clients (PS5) can play them. Nothing is downloaded up
// front: this serves a small file tree on 127.0.0.1, rclone mounts it as a folder, and reads are passed to the stream.
// Run: node src/ps5-bridge.js   (needs rclone; add ~/PlexOrbie/Movies and ~/PlexOrbie/TV Shows as Plex libraries)
import http from 'node:http';
import { createInterface } from 'node:readline';
import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname } from 'node:path';
import { CONFIG_DIR } from './config.js';
import { watchWatchlist, scanPlex, playingNow } from './ps5-watchlist.js';

for (const k of ['log', 'error']) {
  const out = console[k].bind(console);
  console[k] = (...a) => out(new Date().toTimeString().slice(0, 8), ...a);
}
const PORT = Number(process.env.PS5_BRIDGE_PORT) || 7698; // another port = test run: no mount, no Watchlist
const HOST = `127.0.0.1:${PORT}`;
const MOUNT = join(homedir(), 'PlexOrbie');
const STORE = join(CONFIG_DIR, 'ps5-items.json'); // stream links can carry the debrid key: keep private, never log them
const SCANNER = [join(homedir(), 'Applications'), '/Applications']
  .map((d) => join(d, 'Plex Media Server.app/Contents/MacOS/Plex Media Scanner')).find(existsSync);

let items = [];
try { items = JSON.parse(await readFile(STORE, 'utf-8')); } catch {}
async function save() {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(STORE + '.tmp', JSON.stringify(items, null, 2), { mode: 0o600 });
  await rename(STORE + '.tmp', STORE);
}

const clean = (s) => String(s || '').replace(/[\/\\:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').replace(/^\.+/, '').trim();
const pad = (n) => String(n).padStart(2, '0');

// Follow the add-on's redirect to the real file, reading one byte to learn its size.
const direct = new Map();
async function probe(url) {
  const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(30000) });
  await r.body?.cancel();
  const size = Number(r.headers.get('content-range')?.split('/')[1]);
  if (r.status !== 206 || !size) throw new Error(`The link did not return a seekable file (HTTP ${r.status})`);
  const name = r.headers.get('content-disposition')?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i)?.[1] || new URL(r.url).pathname;
  return { url: r.url, size, name };
}

// Some cached copies come down far too slowly to watch. Time 8 MB from inside the file before accepting one.
async function fastEnough(url, size) {
  const from = Math.floor(size / 3), t = Date.now();
  try {
    const r = await fetch(url, { headers: { Range: `bytes=${from}-${from + 8e6 - 1}` }, signal: AbortSignal.timeout(8000) });
    if (r.status !== 206) return false;
    // about 1.2 times the film's average rate, taking two hours as the running time
    return (await r.arrayBuffer()).byteLength / ((Date.now() - t) / 1000) >= Math.max(1e6, size / 6000);
  } catch { return false; }
}

async function add({ url, title, year, season, episode, edition, force }) {
  if (!/^https?:\/\//.test(url || '') || !clean(title)) throw new Error('Need a direct stream link and a title');
  const p = await probe(url);
  if (p.size < 50e6) throw new Error('That file is too small to be the film (probably a provider error clip)');
  console.log(`Link OK: ${(p.size / 1e9).toFixed(1)} GB on ${new URL(p.url).hostname.split('.')[0]}${force ? '' : ', testing speed'}`);
  if (!force && !(await fastEnough(p.url, p.size))) // force: chosen by hand, skip the rough speed test
    throw new Error('This copy downloads too slowly to watch');
  let ext = '';
  for (const n of [p.name, new URL(url).pathname]) {
    try { ext = extname(decodeURIComponent(n)).toLowerCase(); } catch { ext = extname(n).toLowerCase(); }
    if (/^\.(mkv|mp4|m4v|avi|ts|mov)$/.test(ext)) break;
    ext = '';
  }
  const show = clean(title) + (/^\d{4}$/.test(String(year)) ? ` (${year})` : '');
  const tv = season != null && episode != null;
  const path = tv
    ? ['TV Shows', show, `Season ${pad(season)}`, `${show} - S${pad(season)}E${pad(episode)}${ext || '.mkv'}`]
    : ['Movies', show, `${show}${edition ? ` - ${clean(edition)}` : ''}${ext || '.mkv'}`]; // an edition sits beside the plain copy
  const key = path.slice(0, -1).join('/') + '/' + path.at(-1).replace(/\.\w+$/, '');
  items = items.filter((i) => i.key !== key);
  items.push({ key, path, url, size: p.size, added: Date.now() });
  direct.set(url, { url: p.url, at: Date.now() });
  await save();
  setTimeout(() => scan(join(MOUNT, ...path.slice(0, -1))), 2500); // just after the folder's 2 s listing cache
  return { path: path.join('/'), size: p.size };
}

// Plex gets no change events from a network mount, so ask its scanner (it needs no token on this Mac).
// Pressing Play starts over: when Plex begins a session for a film, the remembered server address and any
// "leave it alone" mark are dropped, so the link is looked up again through TorBox.
const watching = new Set();
async function noticePlay() {
  const now = await playingNow();
  if (!now) return;
  for (const i of items) {
    const on = now.some((p) => p === i.path.at(-2) || p.endsWith('/' + i.path.join('/')));
    if (on && !watching.has(i.key)) {
      watching.add(i.key);
      console.log('Watchlist checks paused while this plays');
      direct.delete(i.url);
      resting.delete(i.url);
      console.log(`Play: ${i.path.at(-1)}, fresh link`);
    } else if (!on && watching.delete(i.key)) console.log(`Stopped: ${i.path.at(-1)}${watching.size ? '' : ', checking the Watchlist again'}`);
  }
}

async function scan(folder) {
  console.log(`Asking Plex to scan ${folder ? folder.slice(MOUNT.length + 1) : 'the library'}`);
  if (await scanPlex(folder).catch((e) => console.error('Plex scan:', e.message))) return;
  if (!SCANNER) return;
  execFile(SCANNER, ['--scan'], (err) => { if (err) console.error('Plex scanner:', err.message); });
}

// The cache has its own folder, emptied at every start and stop. Also clears what earlier versions of this bridge left in
// rclone's shared folder (only their own ':webdav{…}' and ':http{…}' entries). The list of films is not touched.
const CACHE = join(homedir(), 'Library', 'Caches', 'PlexOrbie');
async function clearCache() {
  const gone = (p) => rm(p, { recursive: true, force: true }).catch((e) => console.error('cache:', e.message));
  await gone(CACHE);
  for (const sub of ['vfs', 'vfsMeta']) {
    const dir = join(homedir(), 'Library', 'Caches', 'rclone', sub);
    for (const n of await readdir(dir).catch(() => [])) if (/^:(webdav|http)\{/.test(n)) await gone(join(dir, n));
  }
}

function listing(parts) {
  const names = new Map(parts.length ? [] : [['Movies', true], ['TV Shows', true]]);
  for (const i of items) {
    if (i.path.length > parts.length && parts.every((p, n) => i.path[n] === p)) names.set(i.path[parts.length], i.path.length > parts.length + 1);
  }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return [...names].map(([n, dir]) => `<a href="${encodeURIComponent(n)}${dir ? '/' : ''}">${esc(n)}</a>`).join('\n');
}

// WebDAV listing. It carries folder dates, which matter: Plex skips a folder whose modified date hasn't changed.
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function propfind(parts, depth) {
  const under = (p) => items.filter((i) => p.every((x, n) => i.path[n] === x));
  const entry = (p) => {
    const inside = under(p);
    const file = inside.find((i) => i.path.length === p.length);
    if (!file && !inside.length && p.length && !(p.length === 1 && ['Movies', 'TV Shows'].includes(p[0]))) return null;
    const when = new Date(Math.max(0, ...inside.map((i) => i.added))).toUTCString();
    const href = '/' + p.map(encodeURIComponent).join('/') + (file || !p.length ? '' : '/');
    return `<d:response><d:href>${xml(href)}</d:href><d:propstat><d:prop><d:resourcetype>${file ? '' : '<d:collection/>'}</d:resourcetype>`
      + `${file ? `<d:getcontentlength>${file.size}</d:getcontentlength>` : ''}<d:getlastmodified>${when}</d:getlastmodified>`
      + `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
  };
  const self = entry(parts);
  if (!self) return null;
  const names = new Set(parts.length ? [] : ['Movies', 'TV Shows']);
  for (const i of under(parts)) if (i.path.length > parts.length) names.add(i.path[parts.length]);
  const children = depth === '0' ? [] : [...names].map((n) => entry([...parts, n]));
  return `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">${[self, ...children].join('')}</d:multistatus>`;
}

// The way Orbie's own player does it (streamcache.js): one continuous download from wherever reading starts, passed
// straight through. rclone keeps what arrives in its cache, so nothing is held here and requests to the server are few.
const REST = 10 * 60e3, resting = new Map(), resolving = new Map();
const log = (...a) => console.log(...a);
const quiet = (message) => Object.assign(new Error(message), { quiet: true });

// A film whose server refuses is left alone for a while: one line in the log, no requests, reads fail at once.
function rest(item) {
  if (!(resting.get(item.url) > Date.now())) log(`${item.path.at(-1)}: its server refused the connection. Leaving it alone for 10 minutes.`);
  resting.set(item.url, Date.now() + REST);
  direct.delete(item.url);
}

// the redirects are followed once and remembered, however many reads arrive together
async function directUrl(item) {
  const d = direct.get(item.url);
  if (d && Date.now() - d.at < 60e3) { d.at = Date.now(); return d.url; } // idle for a minute: ask TorBox again
  if (!resolving.has(item.url)) {
    resolving.set(item.url, probe(item.url)
      .then((r) => { direct.set(item.url, { url: r.url, at: Date.now() }); return r.url; })
      .finally(() => resolving.delete(item.url)));
  }
  return resolving.get(item.url);
}

// one request to the server for start..end; an expired link is looked up again once
async function upstream(item, start, end, signal) {
  for (let attempt = 0; ; attempt++) {
    const url = await directUrl(item);
    const late = new AbortController(), timer = setTimeout(() => late.abort(), 30000); // for the answer, not the whole download
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.any([signal, late.signal]) });
      if (r.status === 206) {
        log(`${item.path.at(-1)}: from ${Math.round(start / 1e6)} MB, ${new URL(r.url).hostname.split('.')[0]}`);
        return r;
      }
      await r.body?.cancel();
      throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      if (signal.aborted || attempt || e.cause?.code === 'ECONNREFUSED') throw e;
      direct.delete(item.url);
    } finally { clearTimeout(timer); }
  }
}

const drained = (res) => new Promise((r) => { const go = () => { res.off('drain', go); res.off('close', go); r(); }; res.on('drain', go); res.on('close', go); });

async function stream(item, req, res) {
  const m = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  const start = m?.[1] ? Number(m[1]) : m?.[2] ? item.size - Number(m[2]) : 0;
  const end = m?.[1] && m[2] ? Math.min(Number(m[2]), item.size - 1) : item.size - 1;
  if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${item.size}` }); return res.end(); }
  const headers = { 'Content-Length': end - start + 1, 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  if (m) headers['Content-Range'] = `bytes ${start}-${end}/${item.size}`;
  if (req.method === 'HEAD') { res.writeHead(m ? 206 : 200, headers); return res.end(); }
  if (resting.get(item.url) > Date.now()) throw quiet('resting');

  const abort = new AbortController();
  res.on('close', () => abort.abort()); // the reader moved on: stop the download
  let at = start, drops = 0;
  while (at <= end && !res.destroyed) {
    const before = at;
    try {
      const r = await upstream(item, at, end, abort.signal);
      if (!res.headersSent) res.writeHead(m ? 206 : 200, headers);
      for await (const chunk of r.body) {
        at += chunk.length;
        if (!res.write(chunk)) await drained(res);
        if (res.destroyed) return;
      }
    } catch (e) {
      if (abort.signal.aborted) return;
      if (e.cause?.code === 'ECONNREFUSED') { rest(item); throw quiet('refused'); }
      log(`${item.path.at(-1)}: download broke at ${Math.round(at / 1e6)} MB: ${e.cause?.code || e.message}`);
    }
    drops = at > before ? 0 : drops + 1; // carry on from where it stopped, unless nothing is coming at all
    if (drops >= 3) throw quiet('no data');
    if (at <= end) await new Promise((r) => setTimeout(r, 1000));
  }
  res.end();
}

async function handle(req, res) {
  if (req.headers.host !== HOST || req.headers.origin) { res.writeHead(403); return res.end(); } // no web pages
  if (req.method === 'POST' && req.url === '/add') {
    if (!req.headers['content-type']?.startsWith('application/json')) { res.writeHead(415); return res.end(); }
    let body = '';
    for await (const c of req) if ((body += c).length > 1e5) throw new Error('Too large');
    try {
      const out = await add(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }
  if (!['GET', 'HEAD', 'PROPFIND'].includes(req.method)) { res.writeHead(405); return res.end(); }
  const raw = req.url.split('?')[0];
  const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  if (req.method === 'PROPFIND') {
    const body = propfind(parts, req.headers.depth);
    res.writeHead(body ? 207 : 404, { 'Content-Type': 'application/xml; charset=utf-8' });
    return res.end(body || undefined);
  }
  const file = items.find((i) => i.path.join('/') === parts.join('/'));
  if (file) return stream(file, req, res);
  if (!raw.endsWith('/')) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(req.method === 'HEAD' ? undefined : listing(parts));
}

const server = http.createServer((req, res) => handle(req, res).catch((e) => {
  if (e.name === 'AbortError' || e.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
  if (!e.quiet) console.error('ps5-bridge:', e.message);
  if (!res.headersSent) res.writeHead(502);
  res.destroy();
}));

server.listen(PORT, '127.0.0.1', async () => {
  if (PORT !== 7698) return console.log(`test bridge on ${HOST}`);
  // a restart can find the last mount still there: take it down first (fails harmlessly when there is none)
  await new Promise((done) => execFile('umount', [MOUNT], () => done()));
  await mkdir(MOUNT, { recursive: true }).catch(() => {});
  await clearCache();
  const rclone = spawn('rclone', ['nfsmount', ':webdav:', MOUNT, '--webdav-url', `http://${HOST}`, '--read-only',
    // disk cache, needed for smooth 4K: at most 80 GB, deleted about a minute after you stop, tries to leave 15 GB free.
    // A file that is still open can't be trimmed, so the limits can be overshot while watching.
    '--vfs-cache-mode', 'full', '--vfs-cache-max-size', '80G', '--vfs-cache-max-age', '1m', '--vfs-cache-poll-interval', '30s', '--cache-dir', CACHE, '--vfs-cache-min-free-space', '15G',
    '--vfs-read-ahead', '512M', '--buffer-size', '64M', '--vfs-read-chunk-size', '256M', '--vfs-read-chunk-size-limit', 'off', '--dir-cache-time', '2s', '--low-level-retries', '1', '--volname', 'PlexOrbie'], { stdio: ['ignore', 'inherit', 'pipe'] });
  // while a film is resting rclone complains about every retry against this bridge; the one line above says enough
  createInterface({ input: rclone.stderr }).on('line', (l) => { if (!/vfs cache: failed to (download|_ensure)|vfs reader: failed/.test(l)) console.error(l); });
  rclone.on('exit', (code) => { console.error('rclone stopped', code); process.exit(1); });
  const stop = () => { rclone.removeAllListeners('exit'); execFile('umount', [MOUNT], async () => { rclone.kill(); await clearCache(); process.exit(0); }); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log(`PS5 bridge on ${HOST}, mounted at ${MOUNT}`);
  const loop = () => noticePlay().catch((e) => console.error('play check:', e.message)).finally(() => setTimeout(loop, 3000));
  loop();
  watchWatchlist(add, () => watching.size > 0);
});
