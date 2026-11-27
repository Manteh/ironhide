// Orbie is invite only. Membership is a chain of signatures back to the owner, so it needs no server and no database,
// and it checks offline (the relay on a free plan sleeps and forgets).
//
//   invite code  = signed by the person giving it: { by: their key, n: a random id, at: when } + their own proof
//   proof        = the invite you redeemed + your signature binding your key to it
//   the chain ends at ROOT (the owner), whose key is built in here
//
// Every Orbie already has an Ed25519 key (friend codes come from it); the same key signs invites and acceptances.
// Limits are kept by each member's own app (3 invites each, the owner has no limit). That keeps strangers out; it is
// not DRM: someone who rewrites the app could skip the check.
import { createPrivateKey, createPublicKey, createHash, sign, verify, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR, saveConfig } from './config.js';
import { identity } from './social.js';

// Shimara's current local identity is the owner for this build. Keep the previous
// root accepted so invites already sent from the original owner remain valid.
export const ROOT = process.env.ORBIE_TEST_ROOT || '27kAujqdkFYyEl_ZJara_pcAVbjmFmn92IVga6_Yh1k'; // owner's public key (raw Ed25519, base64url)
const LEGACY_ROOT = 'vZapy7L6rLm0y8JtWX7lVztwbNnJXC7u0mrL8q_qW5s';
export const QUOTA = 3;
const FILE = join(CONFIG_DIR, 'membership.json');
const MAX_DEPTH = 24;

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');
const SPKI = Buffer.from('302a300506032b6570032100', 'hex'); // DER prefix of an Ed25519 public key
const pubKey = (raw) => createPublicKey({ key: Buffer.concat([SPKI, unb64u(raw)]), format: 'der', type: 'spki' });
const rawPub = (spkiB64) => b64u(Buffer.from(spkiB64, 'base64').subarray(12));
// the friend code someone has on the relay, from their raw key (same formula as relay/server.js idOf)
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function friendIdOf(raw) {
  const h = createHash('sha256').update(Buffer.concat([SPKI, unb64u(raw)])).digest();
  let out = '', bits = 0, v = 0;
  for (const b of h) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } }
  return out.slice(0, 10);
}
const ok = (raw, msg, sig) => { try { return unb64u(raw).length === 32 && verify(null, Buffer.from(msg), pubKey(raw), unb64u(sig)); } catch { return false; } };
const ticketMsg = (t) => `orbie-invite|1|${t.by}|${t.n}|${t.at}`;
const acceptMsg = (t, id) => `orbie-accept|1|${t.n}|${id}`;

function me() {
  const { pub, priv } = identity();
  return { id: rawPub(pub), key: createPrivateKey({ key: Buffer.from(priv, 'base64'), format: 'der', type: 'pkcs8' }) };
}
function load() { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; } }
function save(d) { mkdirSync(CONFIG_DIR, { recursive: true }); writeFileSync(FILE, JSON.stringify(d, null, 2), { mode: 0o600 }); }

// is this invite real: signed by its giver, and the giver is a member (all the way back to the owner)?
function validTicket(t, depth = 0) {
  if (!t || typeof t !== 'object' || depth > MAX_DEPTH) return false;
  if (!ok(t.by, ticketMsg(t), t.s)) return false;
  if (t.by === ROOT || t.by === LEGACY_ROOT) return true;
  return validProof(t.up, depth + 1) && t.up.id === t.by;
}
function validProof(p, depth = 0) {
  return !!p && typeof p === 'object' && validTicket(p.t, depth) && ok(p.id, acceptMsg(p.t, p.id), p.a);
}

// Compact binary, so a code stays short enough to paste in a chat: per level, the giver's key (32 bytes), a random id (9),
// the time (4), a name (1 + up to 40), the signature (64), then the giver's own proof (their key, signature, invite) if any.
function pack(t) {
  const name = Buffer.from(String(t.name || '').slice(0, 40), 'utf8').subarray(0, 40);
  const at = Buffer.alloc(4); at.writeUInt32BE(t.at >>> 0);
  const head = Buffer.concat([unb64u(t.by), unb64u(t.n), at, Buffer.from([name.length]), name, unb64u(t.s)]);
  if (!t.up) return Buffer.concat([head, Buffer.from([0])]);
  return Buffer.concat([head, Buffer.from([1]), unb64u(t.up.id), unb64u(t.up.a), pack(t.up.t)]);
}
function unpack(b, o = { i: 0 }, depth = 0) {
  if (depth > MAX_DEPTH) throw new Error('too deep');
  const take = (n) => { if (o.i + n > b.length) throw new Error('short'); const x = b.subarray(o.i, o.i + n); o.i += n; return x; };
  const t = { by: b64u(take(32)), n: b64u(take(9)), at: take(4).readUInt32BE() };
  t.name = take(take(1)[0]).toString('utf8');
  t.s = b64u(take(64));
  if (take(1)[0] === 1) { const id = b64u(take(32)), a = b64u(take(64)); t.up = { id, a, t: unpack(b, o, depth + 1) }; }
  return t;
}
const encode = (t) => 'orbie-' + b64u(pack(t));
function decode(code) {
  const raw = String(code || '');
  // the code may be pasted inside a whole message, or broken over lines by a chat app
  for (const s of [raw, raw.replace(/\s+/g, '')]) {
    for (const m of s.matchAll(/orbie-([A-Za-z0-9_-]{100,})/g)) { try { return unpack(unb64u(m[1])); } catch {} }
  }
  return null;
}
// who gave it: a name travels with the invite (not signed: it is only a label)
const giver = (t) => (t?.name ? String(t.name).slice(0, 40) : '');

export function status() {
  const { id } = me(); const d = load();
  const root = id === ROOT;
  const member = root || (validProof(d.proof) && d.proof.id === id);
  const made = d.made || [];
  return { member, root, invitedBy: member && !root ? giver(d.proof.t) : '', since: d.since || null,
    quota: root ? null : QUOTA, left: root ? null : Math.max(0, QUOTA - made.length), made: made.map(({ n, at, note, joined }) => ({ n, at, note, joined: joined ? { name: joined.name, at: joined.at } : null })) };
}

// check an invite without using it (the onboarding shows who it is from)
export function peek(code) {
  const t = decode(code);
  if (!t) return { ok: false, error: "That doesn't look like an Orbie invite. Paste the whole code." };
  if (!validTicket(t)) return { ok: false, error: "This invite isn't valid. Ask for a new one." };
  return { ok: true, from: giver(t) };
}

export function redeem(code) {
  const p = peek(code); if (!p.ok) return p;
  const t = decode(code), { id, key } = me();
  if (t.by === id) return { ok: false, error: "That's an invite you made. Send it to a friend instead." };
  const proof = { t, id, a: b64u(sign(null, Buffer.from(acceptMsg(t, id)), key)) };
  const d = load(); d.proof = proof; d.since = Date.now();
  // whoever invited you becomes a friend: social.js sends them a request tagged with this invite until they accept
  d.inviter = { id: friendIdOf(t.by), n: t.n, name: giver(t) };
  save(d);
  return { ok: true, from: p.from };
}

export function makeInvite({ note = '', name = '' } = {}) {
  const st = status();
  if (!st.member) return { error: 'Only members can invite people.' };
  if (!st.root && st.left <= 0) return { error: `You have used all ${QUOTA} of your invites.` };
  const { id, key } = me(); const d = load();
  const t = { by: id, n: b64u(randomBytes(9)), at: Math.floor(Date.now() / 1000), name: String(name || '').slice(0, 40) };
  t.s = b64u(sign(null, Buffer.from(ticketMsg(t)), key));
  if (id !== ROOT) t.up = d.proof;
  (d.made ||= []).push({ n: t.n, at: Date.now(), note: String(note || '').slice(0, 60) }); save(d);
  return { code: encode(t), left: st.root ? null : st.left - 1 };
}

export function makeBundle({ inviteCode, torboxKey, name = '' }) {
  const payload = JSON.stringify({ code: inviteCode, torbox: String(torboxKey || '').trim(), from: String(name || '').slice(0, 40) });
  return 'orbie-bundle-' + Buffer.from(payload, 'utf8').toString('base64url');
}

export function redeemBundle(bundleCode) {
  try {
    const raw = String(bundleCode || '').replace(/^orbie-bundle-/, '');
    const data = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!data.code) return { ok: false, error: 'Missing invite code in bundle' };
    const res = redeem(data.code);
    if (!res.ok) return res;
    if (data.torbox) {
      saveConfig({ torbox_api_key: String(data.torbox).trim(), debrid_provider: 'torbox' });
    }
    return { ok: true, from: data.from || res.from, torbox: !!data.torbox };
  } catch (err) {
    return { ok: false, error: 'Invalid bundle: ' + err.message };
  }
}

// ---- friends from invites (used by social.js) ----
// who invited this Orbie, while they aren't a friend yet: { id: friend code, n: the invite's id, name }
export function inviter() { return load().inviter || null; }
// a friend request carried this invite id: is it one this Orbie gave out? If so, remember who joined with it.
export function claimInvite(n, who) {
  const d = load(), x = (d.made || []).find((m) => m.n === String(n || ''));
  if (!x) return false;
  if (!x.joined) { x.joined = { id: who.id, name: String(who.name || '').slice(0, 40), at: Date.now() }; save(d); }
  return true;
}
