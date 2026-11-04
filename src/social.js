// Friends, rooms, chat and playback sync. This daemon keeps one outbound connection to the relay;
// the web UI talks to it over the local API/WebSocket. No video ever goes through the relay.
import WebSocket from 'ws';
import { generateKeyPairSync, createPrivateKey, sign } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';
import { getSettings } from './settings.js';
import { getConfig } from './config.js';

const FILE = join(CONFIG_DIR, 'social.json');
const REACTIONS = ['👍', '😂', '😮', '❤️', '🔥', '👏', '😢', '🤯'];

let data = { priv: '', pub: '', relayUrl: '', friends: [], shareStatus: true, appearOffline: false, rooms: {} };
let ws = null, link = 'off', backoff = 1000, timer = 0, pingTimer = 0, stopped = false;
const S = { directory: false, people: [], you: null, presence: new Map(), incoming: [], outgoing: [], room: null, chat: [], invites: [], offsets: [], watching: null };
let emit = () => {}, pushTimer = 0;
export const onSocial = (fn) => { emit = fn; };

// ---------- identity + persistence ----------
function load() {
  try { data = { ...data, ...JSON.parse(readFileSync(FILE, 'utf-8')) }; } catch {}
  if (!data.priv) genKeys();
}
function genKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  data.pub = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  data.priv = privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64');
  save();
}
function save() {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

const relayHost = () => { try { return new URL(data.relayUrl).host; } catch { return 'this relay'; } };
const validRelay = (u) => { try { const x = new URL(u); return x.protocol === 'wss:' || (x.protocol === 'ws:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname)); } catch { return false; } };
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// ---------- state for the UI ----------
export function snapshot() {
  const friends = data.friends.map((f) => { const p = S.presence.get(f.id); return { ...f, name: p?.name || f.name, avatar: p?.avatar || f.avatar, online: !!p?.online, status: p?.status || null, away: !!p?.away, inRoom: p?.room || null }; });
  friends.sort((a, b) => (b.online - a.online) || (!!b.status - !!a.status) || a.name.localeCompare(b.name)); // online first, then watchers
  return {
    you: S.you, savedRooms: savedRooms().map((x) => ({ code: x.code, name: x.name, media: x.media, pos: x.pos, savedAt: x.savedAt, members: x.members, current: S.room?.code === x.code })).sort((a, b) => b.savedAt - a.savedAt), relayHost: relayHost(), directory: S.directory, people: S.people.filter((p) => !data.friends.some((f) => f.id === p.id)), relay: { url: data.relayUrl, status: link, version: S.relayV || 0 }, friends, incoming: S.incoming, outgoing: S.outgoing, room: S.room, chat: S.chat, invites: S.invites,
    offset: median(S.offsets), shareStatus: data.shareStatus, appearOffline: data.appearOffline, reactions: REACTIONS,
  };
}
const ROOM_KEEP_MS = 14 * 864e5;
let roomSaveAt = 0;
// Remember the room I'm in (where it is paused, what is picked, who is in it, the chat) so I can come back to it later.
function saveRoom(now = false) {
  const r = S.room; if (!r) return;
  if (!now) { if (roomSaveAt) return; roomSaveAt = setTimeout(() => { roomSaveAt = 0; saveRoom(true); }, 4000); return; }
  const t = Date.now() + median(S.offsets), pb = r.pb || { playing: false, pos: 0, at: t, rate: 1 };
  const pos = pb.playing ? pb.pos + Math.max(0, t - pb.at) / 1000 * (pb.rate || 1) : pb.pos;
  (data.rooms ||= {})[r.code] = { code: r.code, name: r.name, owner: r.owner, control: r.control, open: r.open !== false, media: r.media, pos, savedAt: Date.now(), members: [...r.members.map((m) => ({ id: m.id, name: m.name, avatar: m.avatar })), ...(data.rooms[r.code]?.members || []).filter((o) => !r.members.some((m) => m.id === o.id))].slice(0, 12), chat: S.chat.slice(-60) };
  save();
}
const savedRooms = () => Object.values(data.rooms || {}).filter((x) => Date.now() - x.savedAt < ROOM_KEEP_MS);
export const forgetRoom = (code) => { delete (data.rooms ||= {})[String(code).toUpperCase()]; save(); push(); };

const push = () => { clearTimeout(pushTimer); pushTimer = setTimeout(() => emit('state', snapshot()), 30); if (S.room) saveRoom(); };

// ---------- connection ----------
const tx = (msg) => { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); };
async function profileNow() {
  const p = (await getSettings()).profile;
  return { name: p.name, avatar: p.avatar, hide: data.appearOffline };
}

export function connect() {
  clearTimeout(timer); stopped = false;
  if (ws) { try { ws.removeAllListeners(); ws.close(); } catch {} ws = null; }
  if (!data.relayUrl) { link = 'off'; return push(); }
  if (!validRelay(data.relayUrl)) { link = 'invalid'; return push(); }
  link = 'connecting'; push();
  try { ws = new WebSocket(data.relayUrl, { handshakeTimeout: 20000 }); } catch { link = 'invalid'; return push(); }
  const sock = ws;
  sock.on('message', (raw) => { try { handle(JSON.parse(raw)); } catch {} });
  sock.on('open', () => { backoff = 1000; });
  sock.on('close', () => { if (sock !== ws) return; ws = null; clearInterval(pingTimer); link = 'connecting'; S.presence.clear(); S.room = null; S.chat = []; push(); if (!stopped) timer = setTimeout(connect, backoff = Math.min(backoff * 1.8, 30000)); });
  sock.on('error', () => {});
}
export function disconnect() { stopped = true; clearTimeout(timer); clearInterval(pingTimer); try { ws?.close(); } catch {} ws = null; link = 'off'; push(); }

async function handle(m) {
  switch (m.t) {
    case 'challenge': {
      const key = createPrivateKey({ key: Buffer.from(data.priv, 'base64'), format: 'der', type: 'pkcs8' });
      tx({ t: 'auth', pub: data.pub, sig: sign(null, Buffer.from(m.nonce), key).toString('base64'), ...(await profileNow()) });
      break;
    }
    case 'welcome':
      S.you = m.you; S.relayV = m.v || 1; link = 'online'; S.directory = !!m.directory; if (S.directory) tx({ t: 'directory' }); S.offsets = [Date.now() - m.now];
      tx({ t: 'friends', ids: data.friends.map((f) => f.id) });
      if (savedRooms().length) tx({ t: 'room.restore', rooms: savedRooms() });
      clearInterval(pingTimer); pingTimer = setInterval(() => tx({ t: 'ping', c: Date.now() }), 8000); tx({ t: 'ping', c: Date.now() });
      tx({ t: 'status', watching: data.shareStatus ? S.watching : null }); tx({ t: 'away', away: S.away }); // always say what is true now, so an old status on the relay can never linger
      push(); break;
    case 'pong': { const rtt = Date.now() - m.c; S.offsets.push(m.s + rtt / 2 - Date.now()); if (S.offsets.length > 7) S.offsets.shift(); break; } // server clock - local clock
    case 'you': S.you = m.you; push(); break; // the relay may have adjusted our name to keep it unique
    case 'directory': S.people = m.list; push(); break;
    case 'presence.all': S.presence = new Map(m.list.map((p) => [p.id, p])); push(); break;
    case 'presence': { if (!data.friends.some((f) => f.id === m.id)) break; { const was = S.presence.get(m.id); if (m.room && m.room.code !== was?.room?.code && m.online) emit('toast', { kind: 'info', text: `${m.name} opened a room${m.room.media ? `: ${m.room.media.title}` : ''}` }); } S.presence.set(m.id, m); const f = data.friends.find((x) => x.id === m.id); if (m.name) { f.name = m.name; f.avatar = m.avatar; save(); } push(); break; }
    case 'friend.req':
      if (data.friends.some((f) => f.id === m.from.id)) { acceptFriend(m.from.id, m.from); break; }
      if (!S.incoming.some((r) => r.id === m.from.id)) S.incoming.push(m.from);
      emit('toast', { kind: 'info', text: `${m.from.name} sent you a friend request` }); push(); break;
    case 'friend.accepted': addFriendLocal(m.from); S.outgoing = S.outgoing.filter((o) => o.id !== m.from.id); emit('toast', { kind: 'ok', text: `${m.from.name} accepted your request` }); break;
    case 'friend.sent': emit('toast', { kind: 'ok', text: `Request sent to ${m.name}` }); break;
    case 'friend.unknown': S.outgoing = S.outgoing.filter((o) => o.id !== m.to); emit('toast', { kind: 'err', text: `No one with that code is online on ${relayHost()}. They need to be connected to the same relay.` }); push(); break;
    case 'room': if (!m.room && S.room) { saveRoom(true); S.prevRoom = S.room; } S.room = m.room; if (!m.room) { S.chat = []; } push(); break;
    case 'room.pb': if (S.room) S.room.pb = m.pb; emit('pb', m); break;
    case 'chat.history': S.chat = m.msgs; push(); break;
    case 'chat': S.chat.push(m.msg); if (S.chat.length > 80) S.chat.shift(); emit('chat', m.msg); break;
    case 'react': emit('react', m); break;
    case 'room.invite': S.invites = [m, ...S.invites.filter((i) => i.code !== m.code)].slice(0, 5); emit('toast', { kind: 'info', text: `${m.from.name} invited you to ${m.name}` }); push(); break;
    case 'room.ms': { const mem = S.room?.members.find((x) => x.id === m.id); if (mem) { mem.st = m.st; push(); } break; }
    case 'room.kicked': emit('kicked', { by: m.by, room: m.room }); if (S.prevRoom) { delete data.rooms?.[S.prevRoom.code]; save(); } emit('toast', { kind: 'err', text: `${m.by} removed you from ${m.room}` }); break;
    case 'room.error': emit('toast', { kind: 'err', text: m.msg }); break;
    case 'replaced': stopped = true; link = 'replaced'; push(); break;
  }
}

// ---------- friends ----------
function addFriendLocal(p) {
  if (!data.friends.some((f) => f.id === p.id)) data.friends.push({ id: p.id, name: p.name, avatar: p.avatar }); else Object.assign(data.friends.find((f) => f.id === p.id), { name: p.name, avatar: p.avatar });
  S.incoming = S.incoming.filter((r) => r.id !== p.id); save();
  tx({ t: 'friends', ids: data.friends.map((f) => f.id) }); push();
}
export function addFriend(code) {
  const id = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  if (id.length < 8) throw new Error('That does not look like a friend code');
  if (id === S.you?.id) throw new Error('That is your own code');
  if (link !== 'online') throw new Error('Not connected to the relay yet');
  if (data.friends.some((f) => f.id === id)) throw new Error('Already friends');
  S.outgoing.push({ id, name: S.people.find((p) => p.id === id)?.name || id }); tx({ t: 'friend.req', to: id }); push();
}
export function acceptFriend(id, prof) { const p = prof || S.incoming.find((r) => r.id === id); if (!p) return; addFriendLocal(p); tx({ t: 'friend.accept', to: id }); }
export function declineFriend(id) { S.incoming = S.incoming.filter((r) => r.id !== id); push(); }
export function removeFriend(id) { data.friends = data.friends.filter((f) => f.id !== id); S.presence.delete(id); save(); tx({ t: 'friends', ids: data.friends.map((f) => f.id) }); push(); }

// ---------- rooms ----------
export const createRoom = (name) => tx({ t: 'room.create', name });
export const joinRoom = (code) => {
  const c = String(code).toUpperCase(); S.invites = S.invites.filter((i) => i.code !== c);
  if (data.rooms?.[c]) tx({ t: 'room.restore', rooms: [data.rooms[c]] }); // harmless if the relay still has it; brings it back if not
  tx({ t: 'room.join', code });
};
export const leaveRoom = () => { saveRoom(true); S.prevRoom = S.room; tx({ t: 'room.leave' }); S.room = null; S.chat = []; push(); };
export const invite = (id) => tx({ t: 'room.invite', to: id });
export const kick = (id) => tx({ t: 'room.kick', to: id });
export const transfer = (id) => tx({ t: 'room.transfer', to: id });
export const roomMedia = (media) => tx({ t: 'room.media', media });
export const roomState = (state, pos) => tx({ t: 'room.state', state, pos });
export const roomReady = (ready) => tx({ t: 'room.ready', ready: !!ready });
export const roomControl = (action, pos, extra = {}) => tx({ t: 'room.control', action, pos, ...extra });
export const roomSettings = (s) => tx({ t: 'room.settings', ...s });
export const chat = (text) => tx({ t: 'chat', text });
export const react = (emoji) => tx({ t: 'react', emoji });
export const refreshPeople = () => tx({ t: 'directory' });
export const dismissInvite = (code) => { S.invites = S.invites.filter((i) => i.code !== code); push(); };

// ---------- settings / profile / status ----------
export function setSocialSettings(p) {
  let reconnect = false;
  if (typeof p.relayUrl === 'string' && p.relayUrl.trim() !== data.relayUrl) { data.relayUrl = p.relayUrl.trim(); reconnect = true; }
  if (typeof p.shareStatus === 'boolean') data.shareStatus = p.shareStatus;
  if (typeof p.appearOffline === 'boolean') { data.appearOffline = p.appearOffline; sendProfile(); }
  save();
  if (reconnect) connect(); else push();
}
export async function sendProfile() {
  const p = await profileNow();
  if (S.you) { S.you = { ...S.you, name: p.name, avatar: p.avatar }; push(); }
  if (link === 'online') tx({ t: 'profile', ...p });
}
export function setWatching(w) { S.watching = w; S.watchingAt = Date.now(); if (link === 'online') tx({ t: 'status', watching: data.shareStatus ? w : null }); }

// A status the player stopped refreshing (tab closed, crash) expires on its own after a couple of minutes.
setInterval(() => { if (S.watching && Date.now() - (S.watchingAt || 0) > 150000) setWatching(null); }, 30000).unref?.();

// Is anyone looking? Each open browser tab reports "visible" every ~20 s; none seen recently means away (hidden window or closed browser).
const tabs = new Map();
S.away = true;
function evalAway() {
  const now = Date.now(); for (const [k, t] of tabs) if (now - t > 45000) tabs.delete(k);
  const away = tabs.size === 0;
  if (away !== S.away) { S.away = away; if (link === 'online') tx({ t: 'away', away }); }
}
export function tabSeen(id, visible) { if (visible) tabs.set(String(id).slice(0, 40), Date.now()); else tabs.delete(String(id).slice(0, 40)); evalAway(); }
setInterval(evalAway, 5000).unref?.();

export function startSocial() {
  load(); S.you = null;
  if (!data.relayUrl && getConfig().relay_url) { data.relayUrl = getConfig().relay_url; save(); } // shared default relay
  if (data.relayUrl) connect();
}
export const myCode = () => S.you?.id || '';

// Sign out: forget this identity (new keys, so a new friend code), drop friends and rooms, and reconnect as a fresh user.
// The relay address and privacy switches stay.
export function resetIdentity() {
  disconnect();
  data.friends = []; data.priv = ''; data.pub = ''; genKeys();
  Object.assign(S, { you: null, presence: new Map(), incoming: [], outgoing: [], room: null, chat: [], invites: [], people: [], offsets: [], watching: null });
  emit('reset', {});
  if (data.relayUrl) connect(); else push();
}
