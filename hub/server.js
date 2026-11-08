#!/usr/bin/env node
// IronHide hub: hosted mode. Visitors pick a unique name, get a cookie, and are proxied to their own
// private IronHide daemon (own keys, history, settings, identity). The relay runs beside it.
// No daemon changes needed: each user is just `src/daemon.js` with its own IRONHIDE_HOME and port.
import http from 'http';
import net from 'net';
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const DATA = process.env.HUB_DATA || join(ROOT, '.hub-data');
const ACCESS_CODE = process.env.HUB_CODE || '';            // optional: members-only passphrase
const MAX_USERS = Number(process.env.HUB_MAX_ACTIVE) || 8;  // simultaneously running daemons
const IDLE_MS = (Number(process.env.HUB_IDLE_MIN) || 20) * 60000;
const RELAY_PORT = 18790;
mkdirSync(DATA, { recursive: true });

// ---------- users ----------
const FILE = join(DATA, 'users.json');
let users = {}; // lower(name) -> { id, name, token }
try { users = JSON.parse(readFileSync(FILE, 'utf-8')); } catch {}
const save = () => writeFileSync(FILE, JSON.stringify(users, null, 2), { mode: 0o600 });
const byToken = (t) => t && Object.values(users).find((u) => u.token === t);
const cookieOf = (req) => /(?:^|;\s*)ih_hub=([a-f0-9]{32})/.exec(req.headers.cookie || '')?.[1];

// ---------- relay (child) ----------
function startRelay() {
  const p = spawn(process.execPath, [join(ROOT, 'relay', 'server.js')], { env: { ...process.env, PORT: String(RELAY_PORT), RELAY_DIRECTORY: '1' }, stdio: 'inherit' });
  p.on('exit', () => setTimeout(startRelay, 1500));
}

// ---------- per-user daemons ----------
const procs = new Map(); // id -> { port, child, ready:Promise, last, conns }
let nextPort = 20000;
const health = (port) => fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(700) }).then((r) => r.ok).catch(() => false);

function ensure(u) {
  const have = procs.get(u.id);
  if (have) { have.last = Date.now(); return have.ready.then(() => have); }
  if (procs.size >= MAX_USERS) { // evict the least recently used one without live sockets
    const idle = [...procs.entries()].filter(([, p]) => !p.conns).sort((a, b) => a[1].last - b[1].last)[0];
    if (!idle) throw new Error('The hub is full right now. Try again in a few minutes.');
    stop(idle[0]);
  }
  const port = nextPort++; if (nextPort > 29999) nextPort = 20000;
  const home = join(DATA, 'users', u.id); mkdirSync(home, { recursive: true });
  const child = spawn(process.execPath, [join(ROOT, 'src', 'daemon.js')], {
    env: { ...process.env, IRONHIDE_HOME: home, IRONHIDE_PORT: String(port), IRONHIDE_NO_BRIDGE: '1', IRONHIDE_HOSTED: '1', IRONHIDE_RELAY: `ws://127.0.0.1:${RELAY_PORT}` },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const p = { port, child, last: Date.now(), conns: 0 };
  p.ready = (async () => {
    for (let i = 0; i < 80; i++) { if (await health(port)) break; await new Promise((r) => setTimeout(r, 150)); }
    if (!u.seeded) { // first run: set their name/avatar and prefer the in-browser player (no mpv on a server)
      await fetch(`http://127.0.0.1:${port}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: { name: u.name }, playback: { player: 'web' } }) }).catch(() => {});
      u.seeded = true; save();
    }
  })();
  child.on('exit', () => { if (procs.get(u.id) === p) procs.delete(u.id); });
  procs.set(u.id, p);
  return p.ready.then(() => p);
}
function stop(id) { const p = procs.get(id); if (!p) return; procs.delete(id); try { p.child.kill('SIGTERM'); } catch {} }
setInterval(() => { for (const [id, p] of procs) if (!p.conns && Date.now() - p.last > IDLE_MS) stop(id); }, 60000).unref();
process.on('exit', () => procs.forEach((_, id) => stop(id)));
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(0));

// ---------- entry page ----------
const page = (msg = '') => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IronHide</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0d0f;color:#f3f3f5;font:16px/1.5 -apple-system,system-ui,sans-serif}
form{width:min(380px,92vw);display:flex;flex-direction:column;gap:12px;padding:28px;border-radius:22px;background:#17171b;border:1px solid #ffffff14;box-shadow:0 30px 80px #0008}
h1{margin:0;font-size:30px;letter-spacing:-.03em}p{margin:0;color:#9a9aa5;font-size:14px}.e{color:#ff7b7b}
input{height:46px;border-radius:12px;border:1px solid #ffffff1c;background:#1f1f25;color:inherit;padding:0 14px;font-size:16px;outline:none}input:focus{border-color:#ffffff80}
button{height:46px;border:0;border-radius:12px;background:#6d6af2;color:#fff;font-weight:600;font-size:16px;cursor:pointer}</style>
<form method="post" action="/hub/enter"><h1>IronHide</h1><p>Pick a name to come in. Come back with the same browser to pick up where you left off.</p>
${msg ? `<p class="e">${msg}</p>` : ''}<input name="name" placeholder="Your name" maxlength="24" autofocus autocomplete="off" required>
${ACCESS_CODE ? '<input name="code" placeholder="Access code" autocomplete="off" required>' : ''}<button>Enter</button></form>`;

const readBody = (req) => new Promise((res) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 4096) req.destroy(); }); req.on('end', () => res(new URLSearchParams(b))); });
const html = (res, code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(body); };

async function enter(req, res) {
  const f = await readBody(req);
  const name = String(f.get('name') || '').replace(/[\u0000-\u001f<>&"']/g, '').trim().replace(/\s+/g, ' ').slice(0, 24);
  if (name.length < 2) return html(res, 400, page('Use at least 2 characters.'));
  if (ACCESS_CODE && f.get('code') !== ACCESS_CODE) return html(res, 403, page('That access code is not right.'));
  const key = name.toLowerCase(), mine = cookieOf(req), cur = users[key];
  if (cur && cur.token !== mine) return html(res, 409, page('That name is taken. Pick another one.'));
  let u = cur;
  if (!u) { u = users[key] = { id: randomBytes(8).toString('hex'), name, token: randomBytes(16).toString('hex') }; save(); }
  res.writeHead(303, { location: '/', 'set-cookie': `ih_hub=${u.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`, 'cache-control': 'no-store' }); res.end();
}

// ---------- proxy ----------
async function proxy(req, res, u) {
  let p; try { p = await ensure(u); } catch (e) { return html(res, 503, page(e.message)); }
  p.last = Date.now();
  const headers = { ...req.headers, host: `127.0.0.1:${p.port}` }; delete headers.cookie;
  const up = http.request({ host: '127.0.0.1', port: p.port, method: req.method, path: req.url, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  res.on('close', () => up.destroy());
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/hub/health') return res.end(JSON.stringify({ ok: true, active: procs.size }));
  if (path === '/hub/enter' && req.method === 'POST') return enter(req, res);
  if (path === '/hub/leave' && req.method === 'POST') { // sign out: erase this user (settings, keys, history) and free the name
    const u = byToken(cookieOf(req));
    if (u) { stop(u.id); delete users[u.name.toLowerCase()]; save(); try { rmSync(join(DATA, 'users', u.id), { recursive: true, force: true }); } catch {} }
    res.writeHead(200, { 'set-cookie': 'ih_hub=; Path=/; Max-Age=0', 'content-type': 'application/json' }); return res.end('{"ok":true}');
  }
  const u = byToken(cookieOf(req));
  if (!u) return /^\/(api|js|css)\//.test(path) ? (res.writeHead(401), res.end()) : html(res, 200, page());
  proxy(req, res, u);
});

server.on('upgrade', async (req, sock, head) => {
  const u = byToken(cookieOf(req)); if (!u) return sock.destroy();
  let p; try { p = await ensure(u); } catch { return sock.destroy(); }
  p.conns++; p.last = Date.now();
  const up = net.connect(p.port, '127.0.0.1', () => {
    const headers = { ...req.headers, host: `127.0.0.1:${p.port}` }; delete headers.cookie;
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    sock.pipe(up).pipe(sock);
  });
  const done = () => { if (!done.x) { done.x = 1; p.conns--; p.last = Date.now(); } sock.destroy(); up.destroy(); };
  up.on('error', done); sock.on('error', done); up.on('close', done); sock.on('close', done);
});

startRelay();
server.listen(PORT, () => console.error(`IronHide hub on :${PORT}${ACCESS_CODE ? ' (access code required)' : ''}`));
