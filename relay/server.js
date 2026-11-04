#!/usr/bin/env node
// IronHide relay: a tiny WebSocket hub for friends, rooms, chat, reactions and playback sync.
// It never touches video. It only passes small JSON messages and keeps everything in memory.
import http from 'http';
import { createPublicKey, verify, createHash, randomBytes } from 'crypto';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8790;
const VERSION = 8; // 2 = rooms visible to friends, 3 = owner + kick + saved rooms, 4 = live player states, 5 = scheduled seeks, 6 = unfriend + temporary profiles, 7 = ready gate, pinned release, stall hold, cursors, 8 = rooms pause when every player has closed
const DIRECTORY = process.env.RELAY_DIRECTORY === '1'; // hosted mode: let members see who else is online
const MAX_CHAT = 500, HISTORY = 60, REACTIONS = new Set(['👍', '😂', '😮', '❤️', '🔥', '👏', '😢', '🤯']);

const users = new Map();      // id -> { id, name, avatar, ws, friends:Set, status, pending:[] }
const removedBy = new Map(); // id -> Set of ids that unfriended them while offline
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
  for (const id of u.friends) { const f = users.get(id); if (f && mutual(u, f)) send(f.ws, { t: 'presence', id: u.id, online: !!u.ws, status: u.hide ? null : u.status, away: !!u.away, temp: !!u.temp, room: u.hide ? null : roomBrief(u), name: u.name, avatar: u.avatar }); }
}
function presenceFor(u) {
  const out = [];
  for (const id of u.friends) { const f = users.get(id); if (f?.ws && mutual(u, f) && !f.hide) out.push({ id: f.id, online: true, status: f.status, away: !!f.away, temp: !!f.temp, room: roomBrief(f), name: f.name, avatar: f.avatar }); }
  return out;
}

// ---------- rooms ----------
const newCode = () => { let c; do { c = b32(randomBytes(4)).slice(0, 6); } while (rooms.has(c)); return c; };
const snapshot = (r) => ({
  code: r.code, name: r.name, owner: r.owner, host: r.host, control: r.control, open: r.open !== false, wait: r.wait !== false, gate: r.gate || null, media: r.media, pb: r.pb, startAt: r.startAt,
  members: [...r.members].map((id) => { const u = users.get(id); return u ? { ...profile(u), ready: r.ready.has(id), st: r.ms?.get(id) || null } : null; }).filter(Boolean),
});
const runs = (r, u) => r.host === u.id || r.owner === u.id;
const toRoom = (r, msg) => { for (const id of r.members) send(users.get(id)?.ws, msg); };
const pushRoom = (r) => { toRoom(r, { t: 'room', room: snapshot(r) }); for (const id of r.members) { const m = users.get(id); if (m && !m.hide) announce(m); } };
function say(r, text) { const m = { from: null, text, ts: Date.now() }; r.chat.push(m); if (r.chat.length > HISTORY) r.chat.shift(); toRoom(r, { t: 'chat', msg: m }); }
// Where the room's playback is right now, from its shared clock
const posNow = (r, t = Date.now()) => (r.pb.playing ? r.pb.pos + Math.max(0, t - r.pb.at) / 1000 * (r.pb.rate || 1) : r.pb.pos);
const ACTIVE = new Set(['playing', 'paused', 'buffering', 'away', 'loading', 'lobby']); // 'idle' = player closed
const hasPlayer = (r, exceptId) => [...r.members].some((id) => id !== exceptId && ACTIVE.has(r.ms?.get(id)?.state) && Date.now() - r.ms.get(id).at < 20000);
// When the last open player goes away, stop the shared clock at the last known position so the room can resume from there later
function freezeIfIdle(r, lastPos) {
  if (hasPlayer(r) || !r.pb.playing) return;
  r.pb = { playing: false, pos: Math.max(0, lastPos ?? posNow(r)), at: Date.now(), rate: r.pb.rate || 1 }; r.startAt = 0;
  toRoom(r, { t: 'room.pb', pb: r.pb, by: null, action: 'pause', now: Date.now() });
}

// --- ready gate: nobody's clock starts until everyone has buffered. The room waits, then all start the same frame together ---
const GATE_MS = 25000, LEAD_MS = 1800, START_LEAD_MS = 3000, STALL_MS = 4000, HOLD_GAP_MS = 30000;
let gateTok = 0;
function startGate(r, pos, reason, who) {
  const rate = r.pb.rate || 1;
  r.pb = { playing: false, pos: Math.max(0, pos), at: Date.now(), rate }; r.startAt = 0; r.ready.clear();
  r.gate = { token: ++gateTok, pos: r.pb.pos, until: Date.now() + GATE_MS, reason, who: who || null };
  r.stall = null;
  toRoom(r, { t: 'room.pb', pb: r.pb, by: null, action: 'gate', now: Date.now() }); pushRoom(r);
}
function releaseGate(r) {
  if (!r.gate) return;
  const pos = r.gate.pos, at = Date.now() + (r.gate.reason === 'play' && pos < 5 ? START_LEAD_MS : LEAD_MS); // the start of a film gets the full 3-2-1
  r.pb = { playing: true, pos, at, rate: r.pb.rate || 1 }; r.startAt = at; r.gate = null;
  toRoom(r, { t: 'room.pb', pb: r.pb, by: null, action: 'play', now: Date.now() }); pushRoom(r);
}
function checkGate(r) {
  if (!r.gate) return;
  if (!r.members.size) { r.gate = null; return; }
  const now = Date.now();
  const waiting = [...r.members].filter((id) => {
    const u = users.get(id); if (!u?.ws || r.ready.has(id)) return false;
    const st = r.ms?.get(id), active = st && ACTIVE.has(st.state) && now - st.at < 20000;
    return !(u.away && !active); // nobody at the keyboard and no player open: don't hold the room for them
  });
  if (!waiting.length || now >= r.gate.until) releaseGate(r);
}

function leaveRoom(u) {
  const r = u.room && rooms.get(u.room); u.room = null; if (!u.hide) announce(u); if (!r) return;
  const last = r.ms?.get(u.id); r.members.delete(u.id); r.ready.delete(u.id); r.ms?.delete(u.id); r.lastActive = Date.now();
  // their player was the last one open: pause the room right where they were
  if (last && ACTIVE.has(last.state)) freezeIfIdle(r, last.pos + (last.state === 'playing' ? Math.max(0, Date.now() - last.at) / 1000 : 0));
  else freezeIfIdle(r);
  checkGate(r);
  if (!r.members.size) return; // an empty room is kept (paused at its position) so people can come back to it
  if (r.host === u.id) { r.host = [...r.members][0]; if (r.owner === u.id) say(r, `${u.name} (owner) left. ${users.get(r.host)?.name || 'Someone'} is hosting until they are back`); else say(r, `${u.name} left`); } else say(r, `${u.name} left`);
  pushRoom(r);
}

// ---------- connection handling ----------
const server = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, service: 'ironhide-relay', v: VERSION, online: [...users.values()].filter((u) => u.ws).length, rooms: rooms.size })); }
  res.writeHead(404); res.end();
});
// Gate deadlines, and holding the room when someone has been stuck buffering for a while
setInterval(() => {
  const now = Date.now();
  for (const r of rooms.values()) {
    if (r.gate) { checkGate(r); continue; }
    if (!r.pb.playing || r.wait === false || !r.stall || r.pb.at > now || now - (r.lastHold || 0) < HOLD_GAP_MS) continue;
    const stuck = Object.entries(r.stall).find(([id, since]) => r.members.has(id) && now - since > STALL_MS);
    if (stuck) { r.lastHold = now; startGate(r, posNow(r), 'stall', users.get(stuck[0])?.name); }
  }
}, 1000).unref?.();

// A player that stopped reporting (browser closed, but the IronHide behind it is still connected) pauses the room where it last was
setInterval(() => {
  for (const r of rooms.values()) {
    if (!r.pb.playing || !r.members.size || hasPlayer(r)) continue;
    const latest = [...(r.ms?.values() || [])].sort((a, b) => b.at - a.at)[0];
    freezeIfIdle(r, latest?.pos); // their last reported position
  }
}, 5000).unref?.();
setInterval(() => { const cut = Date.now() - 7 * 864e5; for (const [c, r] of rooms) if (!r.members.size && (r.lastActive || 0) < cut) rooms.delete(c); }, 3600e3).unref?.();
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
        Object.assign(u, { name: uniqueName(clean(m.name, 32) || 'Guest', id), avatar: cleanAvatar(m.avatar), ws, hide: !!m.hide, temp: !!m.temp });
        me = u; clearTimeout(authTimer);
        send(ws, { t: 'welcome', you: profile(u), now: Date.now(), directory: DIRECTORY, v: VERSION });
        for (const req of offlineReq.get(id) || []) send(ws, { t: 'friend.req', from: req });
        offlineReq.delete(id);
        for (const gone of removedBy.get(id) || []) send(ws, { t: 'friend.removed', id: gone });
        removedBy.delete(id);
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
      case 'status': u.status = m.watching ? { title: clean(m.watching.title, 80), type: m.watching.type === 'movie' ? 'movie' : 'series', state: m.watching.state === 'paused' ? 'paused' : 'playing', imdbId: clean(m.watching.imdbId, 12), poster: clean(m.watching.poster, 200) } : null; if (!u.hide) announce(u); break;

      case 'room.create': {
        leaveRoom(u);
        const code = newCode(), r = { code, name: clean(m.name, 40) || `${u.name}'s room`, owner: u.id, host: u.id, members: new Set([u.id]), ready: new Set(), control: 'host', media: null, pb: { playing: false, pos: 0, at: now, rate: 1 }, startAt: 0, chat: [] };
        rooms.set(code, r); u.room = code; say(r, `${u.name} created the room`); pushRoom(r); send(ws, { t: 'chat.history', msgs: r.chat });
        break;
      }
      case 'room.join': {
        const r = rooms.get(clean(m.code, 8).toUpperCase()); if (!r) return send(ws, { t: 'room.error', msg: 'That room code does not exist (or it has closed).' });
        if (r.banned?.has(u.id)) return send(ws, { t: 'room.error', msg: 'The host removed you from this room.' });
        if (r.members.size >= 12) return send(ws, { t: 'room.error', msg: 'This room is full.' });
        leaveRoom(u); r.lastActive = Date.now();
        const wasEmpty = !r.members.size; r.members.add(u.id); u.room = r.code; if (wasEmpty && r.owner !== u.id && !users.get(r.host)?.room) r.host = u.id;
        if (r.owner === u.id && r.host !== u.id) { r.host = u.id; say(r, `${u.name} is back as host`); } else say(r, `${u.name} joined`); pushRoom(r); send(ws, { t: 'chat.history', msgs: r.chat });
        break;
      }
      case 'room.leave': leaveRoom(u); send(ws, { t: 'room', room: null }); break;
      case 'room.kick': { // host only: remove someone, and keep them out of this room
        const r = rooms.get(u.room), id = clean(m.to, 12), t = users.get(id);
        if (!r || !runs(r, u) || id === u.id || id === r.owner || !r.members.has(id)) break;
        (r.banned ||= new Set()).add(id); r.members.delete(id); r.ready.delete(id);
        if (t) { t.room = null; send(t.ws, { t: 'room', room: null }); send(t.ws, { t: 'room.kicked', by: u.name, room: r.name }); if (!t.hide) announce(t); }
        say(r, `${t?.name || 'Someone'} was removed by ${u.name}`); pushRoom(r); break;
      }
      case 'room.transfer': { // the owner can hand the room over for good
        const r = rooms.get(u.room), t = users.get(clean(m.to, 12));
        if (!r || r.owner !== u.id || !t || !r.members.has(t.id) || t.id === u.id) break;
        r.owner = r.host = t.id; say(r, `${u.name} made ${t.name} the owner`); pushRoom(r); break;
      }
      case 'room.restore': {
        for (const x of (Array.isArray(m.rooms) ? m.rooms : []).slice(0, 20)) {
          const code = clean(x?.code, 8).toUpperCase(); if (!/^[A-Z0-9]{4,8}$/.test(code) || rooms.has(code)) continue;
          const media = x.media && x.media.imdbId ? { imdbId: clean(x.media.imdbId, 12), type: x.media.type === 'series' ? 'series' : 'movie', title: clean(x.media.title, 100), year: clean(x.media.year, 12), poster: clean(x.media.poster, 200), season: Number(x.media.season) || null, episode: Number(x.media.episode) || null, pin: clean(x.media.pin, 140), pinLabel: clean(x.media.pinLabel, 120) } : null;
          const chat = (Array.isArray(x.chat) ? x.chat : []).slice(-HISTORY).map((c) => ({ from: c?.from ? { id: clean(c.from.id, 12), name: clean(c.from.name, 32), avatar: cleanAvatar(c.from.avatar) } : null, text: clean(c.text, MAX_CHAT), ts: Number(c.ts) || now }));
          const owner = clean(x.owner, 12) || u.id;
          rooms.set(code, { code, name: clean(x.name, 40) || 'Room', owner, host: owner, members: new Set(), ready: new Set(), control: x.control === 'all' ? 'all' : 'host', open: x.open !== false, media, pb: { playing: false, pos: Math.max(0, Math.min(1e6, Number(x.pos) || 0)), at: now, rate: 1 }, startAt: 0, chat, lastActive: Number(x.savedAt) || now });
        }
        break;
      }
      // A friend's profile: passed straight through between mutual friends, never kept here
      case 'profile.get': { const f = users.get(clean(m.to, 12)), rid = clean(m.rid, 16); if (f?.ws && mutual(u, f) && !f.hide) send(f.ws, { t: 'profile.get', from: u.id, rid }); else send(ws, { t: 'profile.res', id: clean(m.to, 12), rid, off: true }); break; }
      case 'profile.res': { const f = users.get(clean(m.to, 12)); if (f?.ws && mutual(u, f)) send(f.ws, { t: 'profile.res', id: u.id, rid: clean(m.rid, 16), z: typeof m.z === 'string' ? m.z : null, denied: !!m.denied }); break; }
      case 'friend.remove': {
        const to = clean(m.to, 12); if (!to || to === u.id) break;
        u.friends.delete(to); const t = users.get(to);
        if (t) t.friends.delete(u.id);
        if (t?.ws) send(t.ws, { t: 'friend.removed', id: u.id, name: u.name });
        else (removedBy.get(to) || removedBy.set(to, new Set()).get(to)).add(u.id);
        offlineReq.delete(to); break;
      }
      case 'away': u.away = !!m.away; if (!u.hide) announce(u); break; // their window is hidden, or their browser is closed
      case 'room.pin': { // the exact release the whole room plays
        const r = rooms.get(u.room); if (!r || !runs(r, u) || !r.media) break;
        r.media.pin = clean(m.key, 140); r.media.pinLabel = clean(m.label, 120); pushRoom(r); break;
      }
      case 'cursor': { // live pointers over the picture; not stored
        const r = rooms.get(u.room); if (!r) break;
        const x = Number(m.x), y = Number(m.y), off = !!m.off; if (!off && !(Number.isFinite(x) && Number.isFinite(y))) break;
        for (const id of r.members) if (id !== u.id) send(users.get(id)?.ws, { t: 'cursor', id: u.id, x, y, off }); break;
      }
      case 'room.invite': { const r = rooms.get(u.room), f = users.get(clean(m.to, 12)); if (r && f?.ws && mutual(u, f)) send(f.ws, { t: 'room.invite', from: profile(u), code: r.code, name: r.name, media: r.media }); break; }
      case 'room.settings': { const r = rooms.get(u.room); if (!r || !runs(r, u)) break; if (['host', 'all'].includes(m.control)) r.control = m.control; if (typeof m.open === 'boolean') r.open = m.open; if (typeof m.wait === 'boolean') r.wait = m.wait; if (m.name) r.name = clean(m.name, 40); pushRoom(r); break; }
      case 'room.media': {
        const r = rooms.get(u.room); if (!r || !runs(r, u)) break;
        r.media = m.media ? { imdbId: clean(m.media.imdbId, 12), type: m.media.type === 'series' ? 'series' : 'movie', title: clean(m.media.title, 100), year: clean(m.media.year, 12), poster: clean(m.media.poster, 200), season: Number(m.media.season) || null, episode: Number(m.media.episode) || null } : null;
        r.pb = { playing: false, pos: 0, at: now, rate: 1 }; r.ready.clear(); r.startAt = 0;
        if (r.media) say(r, `${u.name} picked ${r.media.title}${r.media.season ? ` S${String(r.media.season).padStart(2, '0')}E${String(r.media.episode).padStart(2, '0')}` : ''}`);
        pushRoom(r); break;
      }
      case 'room.state': { // a light, frequent update: what this person's player is doing and where it is
        const r = rooms.get(u.room); if (!r || !['playing', 'paused', 'buffering', 'away', 'loading', 'lobby', 'idle'].includes(m.state)) break;
        const st = { state: m.state, pos: Math.max(0, Math.min(1e6, Number(m.pos) || 0)), buf: Math.max(0, Math.min(9999, Number(m.buf) || 0)), at: now, tc: Number(m.tc) || now };
        r.stall ||= {}; if (m.state === 'buffering') r.stall[u.id] ||= now; else delete r.stall[u.id];
        (r.ms ||= new Map()).set(u.id, st); toRoom(r, { t: 'room.ms', id: u.id, st });
        if (m.state === 'idle') freezeIfIdle(r, st.pos); // the last player just closed
        break;
      }
      case 'room.ready': { const r = rooms.get(u.room); if (!r) break; if (r.gate && m.ready && m.token !== r.gate.token) break; m.ready ? r.ready.add(u.id) : r.ready.delete(u.id); pushRoom(r); checkGate(r); break; }
      case 'room.control': {
        const r = rooms.get(u.room); if (!r || (!runs(r, u) && r.control !== 'all')) break;
        const pos = Math.max(0, Number(m.pos) || 0);
        if (m.action === 'play') {
          // everyone starts at the same server instant a moment from now, once they are ready
          startGate(r, pos, 'play'); break;
        } else if (m.action === 'start') { releaseGate(r); break; // the owner chose not to wait any longer
        } else if (m.action === 'pause') { r.gate = null; r.pb = { playing: false, pos, at: now, rate: r.pb.rate }; r.startAt = 0; }
        else if (m.action === 'seek') { // while playing (or waiting) a seek goes back through the gate, so everyone lands together
          if (r.pb.playing || r.gate) { startGate(r, pos, 'seek'); break; }
          r.pb = { playing: false, pos, at: now, rate: r.pb.rate };
        }
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
