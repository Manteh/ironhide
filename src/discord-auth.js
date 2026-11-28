// "Continue with Discord": fills in your name and picture from your Discord account. Read-only (the `identify`
// scope: id, name, avatar), no password:
//   1. the app opens Discord's consent page in your browser
//   2. Discord sends the browser back to this daemon (/auth/discord) with a short-lived token in the address
//   3. that page hands the token to the daemon, which asks Discord who you are
//   4. the daemon shows the token to Orbie's website, which checks the member list (site/api/member.mjs), then forgets it
// Needs the redirect http://127.0.0.1:<port>/auth/discord added under OAuth2 > Redirects in the Discord developer portal.
import { randomBytes } from 'crypto';
import { updateSettings } from './settings.js';
import { getConfig, saveConfig } from './config.js';
import { grantDiscord } from './membership.js';

export const DISCORD_APP_ID = '1571624961829765170'; // the Orbie application (also used for "Watching" on Discord)
export const OWNER_DISCORD_ID = '260496326213632001';
const pending = new Map(); // state -> { at, done, name, error }

export function start(port) {
  const state = randomBytes(16).toString('hex');
  pending.set(state, { at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > 15 * 60e3) pending.delete(k);
  const q = new URLSearchParams({ client_id: DISCORD_APP_ID, response_type: 'token', scope: 'identify', state,
    redirect_uri: `http://127.0.0.1:${port}/auth/discord`, prompt: 'consent' });
  return { state, url: `https://discord.com/oauth2/authorize?${q}` };
}

export function status(state) {
  const p = pending.get(String(state || ''));
  return p ? { done: !!p.done, name: p.name || '', error: p.error || '', member: p.member ?? null, username: p.username || '', gift: !!p.gift } : { done: false, error: 'expired' };
}

// The member list: the website says whether this Discord account is on it, and hands over a TorBox key if the owner
// shares one. The address is fixed here, never from Settings, since it gets to see the sign-in token.
// member: true = on the list, false = not on it, null = couldn't ask. gift: they now stream on the owner's TorBox. A TorBox key you added yourself is left alone.
const MEMBER_URL = 'https://orbie-site.vercel.app/api/member';
async function checkList(token, discord) {
  try {
    const r = await fetch(MEMBER_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { member: null };
    const d = await r.json();
    if (d?.member !== true) return { member: false };
    grantDiscord(discord);
    const have = getConfig();
    let gift = false;
    if (d.torbox && (!have.torbox_api_key || have.vip_torbox)) {
      const other = (have.rd_api_key || have.ad_api_key) && !have.torbox_api_key; // keep using the service they set up
      saveConfig({ torbox_api_key: String(d.torbox), vip_torbox: true, ...(other ? {} : { debrid_provider: 'torbox' }) });
      gift = !other;
    }
    return { member: true, gift };
  } catch { return { member: null }; } // signing in must never fail because of this
}

export async function complete({ token, state }) {
  const p = pending.get(String(state || ''));
  if (!p || p.done) throw new Error('This sign-in link has expired. Start again from Orbie.');
  try {
    const me = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) });
    if (!me.ok) throw new Error(`Discord said no (${me.status})`);
    const u = await me.json();
    const name = u.id === OWNER_DISCORD_ID ? 'Shimara' : String(u.global_name || u.username || '').slice(0, 40);
    let image = '';
    if (u.avatar) { // a 256px WebP stays well under the profile picture limit
      const r = await fetch(`https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.webp?size=256`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); if (b.length < 34000) image = `data:image/webp;base64,${b.toString('base64')}`; }
    }
    await updateSettings({ profile: { ...(name ? { name } : {}), ...(image ? { avatar: { image } } : {}), discord: { id: u.id, username: u.username, at: Date.now() } } });
    const { member, gift } = await checkList(token, { id: u.id, username: u.username });
    Object.assign(p, { done: true, name, member, gift, username: u.username });
    return { ok: true, name, member };
  } catch (e) {
    p.error = e.message; throw e;
  }
}
