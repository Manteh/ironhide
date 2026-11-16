// Updates for the Mac app. The app passes its version (IRONHIDE_APP_VERSION) and where it is installed
// (IRONHIDE_APP_PATH). A new version comes from the latest GitHub release; installing runs the same install.sh people
// use the first time, detached, so it can quit the app, swap it and open the new one.
import { execFile, spawn } from 'child_process';
import { mkdirSync, openSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const REPO = 'Manteh/orbie-app';
const PATH = `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`;
let cache = null; // { at, value, viaGh }

const newer = (a, b) => { // is version a newer than b ("1.2.0" vs "1.1.9")
  const p = (v) => String(v).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const gh = (args) => new Promise((res) => execFile('gh', args, { env: { ...process.env, PATH }, timeout: 15000, maxBuffer: 4e6 }, (e, so) => res(e ? null : so)));

async function latestRelease() {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
    if (r.ok) return { rel: await r.json(), viaGh: false };
  } catch {}
  // a private repo: the GitHub CLI login can read it (the installer does the same)
  const out = await gh(['api', `repos/${REPO}/releases/latest`]);
  if (out) { try { return { rel: JSON.parse(out), viaGh: true }; } catch {} }
  return null;
}

export async function checkUpdate({ fresh = false } = {}) {
  const current = process.env.IRONHIDE_APP_VERSION;
  if (!current) return { available: false, error: 'Updates are for the Mac app' };
  if (!fresh && cache && Date.now() - cache.at < 3600e3) return cache.value;
  const got = await latestRelease();
  if (!got) return { available: false, current, error: 'GitHub could not be reached' };
  const latest = String(got.rel.tag_name || '').replace(/^v/, '');
  const value = { current, latest, available: !!latest && newer(latest, current), notes: String(got.rel.body || '').slice(0, 2000), url: got.rel.html_url || '' };
  cache = { at: Date.now(), value, viaGh: got.viaGh };
  return value;
}

export async function installUpdate() {
  const u = await checkUpdate({ fresh: true });
  if (!u.available) return { error: u.error || 'Already up to date' };
  const app = process.env.IRONHIDE_APP_PATH || '';
  const dest = app.endsWith('.app') ? path.dirname(app) : '';
  const fetchScript = cache?.viaGh
    ? `gh api repos/${REPO}/contents/install.sh -H "Accept: application/vnd.github.raw"`
    : `curl -fsSL https://raw.githubusercontent.com/${REPO}/HEAD/install.sh`;
  const logDir = path.join(homedir(), 'Library/Logs/IronHide');
  mkdirSync(logDir, { recursive: true });
  const log = openSync(path.join(logDir, 'update.log'), 'a');
  // its own session: it outlives this daemon and the app it is about to quit
  const child = spawn('/bin/bash', ['-c', `set -o pipefail; ${fetchScript} | bash`], {
    detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, PATH, NO_COLOR: '1', ...(dest ? { IRONHIDE_DEST: dest } : {}), IRONHIDE_OWNER: '' },
  });
  child.unref();
  return { ok: true, version: u.latest };
}
