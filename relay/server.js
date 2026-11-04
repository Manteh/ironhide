#!/usr/bin/env node
// IronHide relay: a tiny WebSocket hub for friends, rooms, chat, reactions and playback sync.
// It never touches video. It only passes small JSON messages and keeps everything in memory.
import http from 'http';
import { createPublicKey, verify, createHash, randomBytes } from 'crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8790;
const DIRECTORY = process.env.RELAY_DIRECTORY === '1'; // hosted mode: let members see who else is online
const MAX_CHAT = 500, HISTORY = 60, REACTIONS = new Set(['👍', '😂', '😮', '❤️', '🔥', '👏', '😢', '🤯']);

const users = new Map();      // id -> { id, name, avatar, ws, friends:Set, status, pending:[] }
const offlineReq = new Map(); // id -> [{ from }]  (friend requests waiting for someone to come online)
const rooms = new Map();      // code -> room

const send = (ws, msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); };
const b32 = (buf) => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let out = '', bits = 0, v = 0; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += A[(v >>> (bits - 5)) & 31]; bits -= 5; } } return out; };
const idOf = (pubDer) => b32(createHash('sha256').update(pubDer).digest()).slice(0, 10);
// Same rules as src/avatar.js (this file deploys on its own)
const SHAPES = ['circle', 'squircle', 'rounded', 'hex', 'octagon', 'diamond', 'shield', 'seal', 'flower', 'clover', 'starburst', 'star', 'blob', 'heart', 'gem', 'crystal', 'crest', 'cat', 'bolt', 'badge'], FRAMES = ['none', 'ring', 'gradient', 'double', 'glow', 'pulse', 'spin', 'bevel'];
const HEX = /^#[0-9a-fA-F]{6}$/, IMG = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/;
function cleanAvatar(a = {}) {
  const o = { icon: String(a.icon || 'film').replace(/[^a-z-]/g, '').slice(0, 20) || 'film', color: String(a.color || 'indigo').replace(/[^a-z]/g, '').slice(0, 12) || 'indigo' };
  if (typeof a.image === 'string' && a.image.length <= 48000 && IMG.test(a.image)) o.image = a.image;
  if (['halo', 'wings', 'flame', 'orbit', 'crown', 'horns', 'blossom', 'cyber', 'ice', 'laurel', 'thorn', 'stars', 'royal', 'storm', 'aurora', 'prism'].includes(a.deco)) o.deco = a.deco;
  if (SHAPES.includes(a.shape)) o.shape = a.shape; if (FRAMES.includes(a.frame)) o.frame = a.frame;
  for (const k of ['ga', 'gb', 'fa', 'fb']) if (HEX.test(a[k] || '')) o[k] = a[k].toLowerCase();
  if (a.facet) o.facet = true; if (a.custom) o.custom = true; if (Number.isFinite(+a.angle)) o.angle = Math.max(0, Math.min(360, Math.round(+a.angle)));
  return o;
}
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
// Names stay unique among people online (the "People here" list is by name): "Sam" -> "Sam 2" if taken
function uniqueName(name, selfId) {
  if (!DIRECTORY) return name;
  const taken = (n) => [...users.values()].some((x) => x.ws && x.id !== selfId && String(x.name).toLowerCase() === n.toLowerCase());
  let n = name, i = 2; while (taken(n)) n = `${name.slice(0, 28)} ${i++}`;
  return n;
}
const profile = (u) => ({ id: u.id, name: u.name, avatar: u.avatar });

// What friends see of the room someone is in (code included, so they can just press Join). Hosts can switch this off.
function roomBrief(u) {
  const r = u.room && rooms.get(u.room);
  if (!r || r.open === false) return null;
  return { code: r.code, name: r.name, count: r.members.size, media: r.media ? { title: r.media.title, type: r.media.type, imdbId: r.media.imdbId, poster: r.media.poster, season: r.media.season, episode: r.media.episode } : null };
}

// ---------- presence (only between mutual friends) ----------
const mutual = (a, b) => a.friends.has(b.id) && b.friends.has(a.id);
function announce(u) {
  for (const id of u.friends) { const f = users.get(id); if (f && mutual(u, f)) send(f.ws, { t: 'presence', id: u.id, online: !!u.ws, status: u.hide ? null : u.status, room: u.hide ? null : roomBrief(u), name: u.name, avatar: u.avatar }); }
}
function presenceFor(u) {
  const out = [];
  for (const id of u.friends) { const f = users.get(id); if (f?.ws && mutual(u, f) && !f.hide) out.push({ id: f.id, online: true, status: f.status, room: roomBrief(f), name: f.name, avatar: f.avatar }); }
  return out;
}

// ---------- rooms ----------
const newCode = () => { let c; do { c = b32(randomBytes(4)).slice(0, 6); } while (rooms.has(c)); return c; };
const snapshot = (r) => ({
  code: r.code, name: r.name, host: r.host, control: r.control, open: r.open !== false, media: r.media, pb: r.pb, startAt: r.startAt,
  members: [...r.members].map((id) => { const u = users.get(id); return u ? { ...profile(u), ready: r.ready.has(id) } : null; }).filter(Boolean),
});
const toRoom = (r, msg) => { for (const id of r.members) send(users.get(id)?.ws, msg); };
const pushRoom = (r) => { toRoom(r, { t: 'room', room: snapshot(r) }); for (const id of r.members) { const m = users.get(id); if (m && !m.hide) announce(m); } };
function say(r, text) { const m = { from: null, text, ts: Date.now() }; r.chat.push(m); if (r.chat.length > HISTORY) r.chat.shift(); toRoom(r, { t: 'chat', msg: m }); }
function leaveRoom(u) {
  const r = u.room && rooms.get(u.room); u.room = null; if (!u.hide) announce(u); if (!r) return;
  r.members.delete(u.id); r.ready.delete(u.id);
  if (!r.members.size) { r.emptyTimer = setTimeout(() => rooms.delete(r.code), 5 * 60e3); return; }
  if (r.host === u.id) r.host = [...r.members][0];
  say(r, `${u.name} left`); pushRoom(r);
}

// ---------- connection handling ----------
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, service: 'ironhide-relay', online: [...users.values()].filter((u) => u.ws).length, rooms: rooms.size })); }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server, maxPayload: 80 * 1024 });

wss.on('connection', (ws) => {
  let me = null, hits = [];
  const nonce = randomBytes(16).toString('hex');
  send(ws, { t: 'challenge', nonce, now: Date.now() });
  const authTimer = setTimeout(() => { if (!me) ws.close(); }, 10000);

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const now = Date.now(); hits = hits.filter((t) => now - t < 1000); if (hits.push(now) > 25) return; // flood guard

    if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c, s: now });

    if (!me) {
      if (m.t !== 'auth') return;
      try {
        const der = Buffer.from(String(m.pub), 'base64'), key = createPublicKey({ key: der, format: 'der', type: 'spki' });
        if (!verify(null, Buffer.from(nonce), key, Buffer.from(String(m.sig), 'base64'))) throw new Error('bad signature');
        const id = idOf(der); let u = users.get(id);
        if (u?.ws && u.ws !== ws) { send(u.ws, { t: 'replaced' }); u.ws.close(); }
        if (!u) { u = { id, friends: new Set(), status: null, room: null, hide: false }; users.set(id, u); }
        Object.assign(u, { name: uniqueName(clean(m.name, 32) || 'Guest', id), avatar: cleanAvatar(m.avatar), ws, hide: !!m.hide });
        me = u; clearTimeout(authTimer);
        send(ws, { t: 'welcome', you: profile(u), now: Date.now(), directory: DIRECTORY });
        for (const req of offlineReq.get(id) || []) send(ws, { t: 'friend.req', from: req });
        offlineReq.delete(id);
        if (!u.hide) announce(u);
      } catch { ws.close(); }
      return;
    }

    const u = me;
    switch (m.t) {
      case 'profile': u.name = uniqueName(clean(m.name, 32) || u.name, u.id); if (m.avatar) u.avatar = cleanAvatar(m.avatar); u.hide = !!m.hide; send(ws, { t: 'you', you: profile(u) }); announce(u); break;
      case 'directory': if (DIRECTORY) send(ws, { t: 'directory', list: [...users.values()].filter((x) => x.ws && !x.hide && x.id !== u.id).map(profile).slice(0, 200) }); break;
      case 'friends': u.friends = new Set((m.ids || []).slice(0, 500).map((x) => clean(x, 12))); send(ws, { t: 'presence.all', list: presenceFor(u) }); announce(u); break;
      case 'friend.req': {
        const to = clean(m.to, 12).toUpperCase(); if (to === u.id) return;
        const f = users.get(to), payload = profile(u);
        if (!f) { send(ws, { t: 'friend.unknown', to }); break; }
        if (f.ws) send(f.ws, { t: 'friend.req', from: payload }); else offlineReq.set(to, [...(offlineReq.get(to) || []).filter((r) => r.id !== u.id), payload].slice(-20));
        send(ws, { t: 'friend.sent', to, name: f.name });
        break;
      }
      case 'friend.accept': { const f = users.get(clean(m.to, 12)); if (f?.ws) send(f.ws, { t: 'friend.accepted', from: profile(u) }); break; }
      case 'status': u.status = m.watching ? { title: clean(m.watching.title, 80), type: m.watching.type === 'movie' ? 'movie' : 'series', imdbId: clean(m.watching.imdbId, 12), poster: clean(m.watching.poster, 200) } : null; if (!u.hide) announce(u); break;

      case 'room.create': {
        leaveRoom(u);
        const code = newCode(), r = { code, name: clean(m.name, 40) || `${u.name}'s room`, host: u.id, members: new Set([u.id]), ready: new Set(), control: 'host', media: null, pb: { playing: false, pos: 0, at: now, rate: 1 }, startAt: 0, chat: [] };
        rooms.set(code, r); u.room = code; say(r, `${u.name} created the room`); pushRoom(r); send(ws, { t: 'chat.history', msgs: r.chat });
        break;
      }
      case 'room.join': {
        const r = rooms.get(clean(m.code, 8).toUpperCase()); if (!r) return send(ws, { t: 'room.error', msg: 'That room code does not exist (or it has closed).' });
        if (r.banned?.has(u.id)) return send(ws, { t: 'room.error', msg: 'The host removed you from this room.' });
        if (r.members.size >= 12) return send(ws, { t: 'room.error', msg: 'This room is full.' });
        leaveRoom(u); clearTimeout(r.emptyTimer);
        r.members.add(u.id); u.room = r.code; say(r, `${u.name} joined`); pushRoom(r); send(ws, { t: 'chat.history', msgs: r.chat });
        break;
      }
      case 'room.leave': leaveRoom(u); send(ws, { t: 'room', room: null }); break;
      case 'room.kick': { // host only: remove someone, and keep them out of this room
        const r = rooms.get(u.room), id = clean(m.to, 12), t = users.get(id);
        if (!r || r.host !== u.id || id === u.id || !r.members.has(id)) break;
        (r.banned ||= new Set()).add(id); r.members.delete(id); r.ready.delete(id);
        if (t) { t.room = null; send(t.ws, { t: 'room', room: null }); send(t.ws, { t: 'room.kicked', by: u.name, room: r.name }); if (!t.hide) announce(t); }
        say(r, `${t?.name || 'Someone'} was removed by ${u.name}`); pushRoom(r); break;
      }
      case 'room.invite': { const r = rooms.get(u.room), f = users.get(clean(m.to, 12)); if (r && f?.ws && mutual(u, f)) send(f.ws, { t: 'room.invite', from: profile(u), code: r.code, name: r.name, media: r.media }); break; }
      case 'room.settings': { const r = rooms.get(u.room); if (!r || r.host !== u.id) break; if (['host', 'all'].includes(m.control)) r.control = m.control; if (typeof m.open === 'boolean') r.open = m.open; if (m.name) r.name = clean(m.name, 40); pushRoom(r); break; }
      case 'room.media': {
        const r = rooms.get(u.room); if (!r || r.host !== u.id) break;
        r.media = m.media ? { imdbId: clean(m.media.imdbId, 12), type: m.media.type === 'series' ? 'series' : 'movie', title: clean(m.media.title, 100), year: clean(m.media.year, 12), poster: clean(m.media.poster, 200), season: Number(m.media.season) || null, episode: Number(m.media.episode) || null } : null;
        r.pb = { playing: false, pos: 0, at: now, rate: 1 }; r.ready.clear(); r.startAt = 0;
        if (r.media) say(r, `${u.name} picked ${r.media.title}${r.media.season ? ` S${String(r.media.season).padStart(2, '0')}E${String(r.media.episode).padStart(2, '0')}` : ''}`);
        pushRoom(r); break;
      }
      case 'room.ready': { const r = rooms.get(u.room); if (!r) break; m.ready ? r.ready.add(u.id) : r.ready.delete(u.id); pushRoom(r); break; }
      case 'room.control': {
        const r = rooms.get(u.room); if (!r || (r.host !== u.id && r.control !== 'all')) break;
        const pos = Math.max(0, Number(m.pos) || 0);
        if (m.action === 'play') {
          // everyone starts at the same server instant a moment from now, once they are ready
          const lead = m.scheduled ? 2500 : 0; r.startAt = now + lead; r.pb = { playing: true, pos, at: now + lead, rate: r.pb.rate };
        } else if (m.action === 'pause') { r.pb = { playing: false, pos, at: now, rate: r.pb.rate }; r.startAt = 0; }
        else if (m.action === 'seek') { r.pb = { playing: r.pb.playing, pos, at: now, rate: r.pb.rate }; }
        else if (m.action === 'rate') { const cur = r.pb.playing ? r.pb.pos + (now - r.pb.at) / 1000 * r.pb.rate : r.pb.pos; r.pb = { playing: r.pb.playing, pos: cur, at: now, rate: Math.min(2, Math.max(0.5, Number(m.rate) || 1)) }; }
        toRoom(r, { t: 'room.pb', pb: r.pb, by: u.id, action: m.action, now }); break;
      }
      case 'chat': {
        const r = rooms.get(u.room), text = clean(m.text, MAX_CHAT); if (!r || !text) break;
        const msg = { from: profile(u), text, ts: now }; r.chat.push(msg); if (r.chat.length > HISTORY) r.chat.shift(); toRoom(r, { t: 'chat', msg }); break;
      }
      case 'react': { const r = rooms.get(u.room); if (!r || !REACTIONS.has(m.emoji)) break; toRoom(r, { t: 'react', from: profile(u), emoji: m.emoji, x: Math.random() }); break; }
    }
  });

  ws.on('close', () => { clearTimeout(authTimer); if (!me || me.ws !== ws) return; me.ws = null; me.status = null; leaveRoom(me); announce(me); }); // a status only lives as long as the connection
  ws.on('error', () => {});
});

setInterval(() => { for (const [id, u] of users) if (!u.ws && !u.room) users.delete(id); }, 3600e3).unref();
server.listen(PORT, () => console.log(`IronHide relay on :${PORT}`));
