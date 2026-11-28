// Your list is the invite: people on it get in by signing in with Discord, and get your debrid key if you set one.
// Discord itself says who they are (never the app), and only a sign-in made for Orbie counts.
//
// Set these in Vercel (project → Settings → Environment Variables), then redeploy. Never put them in this file.
//   ORBIE_MEMBERS     Discord user IDs and/or usernames, separated by commas. IDs are safest: a username can be
//                     changed and then taken by someone else.
//   ORBIE_TORBOX_KEY  optional: your TorBox key, given to listed people who have no key of their own.
//
// Removing someone stops new sign-ins only: an Orbie that already got in stays in. To take TorBox away, make a new
// TorBox key and put it here; the others sign in with Discord again.
const DISCORD_APP_ID = '1571624961829765170'; // same as src/discord-auth.js

export default async function handler(req, res) {
  const reply = (code, body) => {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  const members = new Set(String(process.env.ORBIE_MEMBERS || '').toLowerCase().split(/[\s,]+/).map((x) => x.replace(/^@/, '')).filter(Boolean));
  if (!members.size) return reply(503, { error: 'The member list is not set up' });

  // the Discord sign-in token comes in a header, so there is no body to parse
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token.length > 2000) return reply(400, { error: 'Missing token' });
  try {
    const r = await fetch('https://discord.com/api/v10/oauth2/@me', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return reply(401, { error: 'Discord did not accept that sign-in' });
    const who = await r.json();
    const u = who.user || {};
    const listed = members.has(String(u.id)) || members.has(String(u.username || '').toLowerCase());
    if (who.application?.id !== DISCORD_APP_ID || !listed) return reply(200, { member: false });
    const torbox = String(process.env.ORBIE_TORBOX_KEY || '').trim();
    return reply(200, { member: true, ...(torbox ? { torbox } : {}) });
  } catch {
    return reply(502, { error: 'Could not reach Discord' });
  }
}
