// Updates for the Mac app. The app passes its version (IRONHIDE_APP_VERSION) and where it is installed
// (IRONHIDE_APP_PATH). A new version comes from the latest GitHub release:
//   1. download it in the background (with progress, for the circle in the header),
//   2. check it: size, GitHub's SHA-256, unpacks, signature intact, right app, newer version,
//   3. a small helper script waits for Orbie to quit and swaps the app (keeping the old one until that worked).
// "Restart now" quits Orbie and the helper opens the new one. Otherwise it goes in whenever Orbie is next quit,
// so nothing is ever interrupted.
//
// The checks prove the download is the file on the release and is undamaged. The app is only ad-hoc signed, so they
// do not prove who made it: that rests on the GitHub account the releases come from.
import { execFile, spawn } from 'child_process';
import { createHash } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync, accessSync, constants, openSync, readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const REPO = 'Manteh/orbie-app';
const API = process.env.ORBIE_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`; // override: tests
const BUNDLE_ID = 'app.ironhide.mac';
const dir = () => path.join(homedir(), 'Library/Caches/Orbie/update');
let cache = null; // { at, rel }
let job = { state: 'idle', pct: 0, error: '', version: '' }; // idle | downloading | ready | error

const newer = (a, b) => { // is version a newer than b ("1.2.0" vs "1.1.9")
  const p = (v) => String(v).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const run = (cmd, args) => new Promise((ok, fail) => execFile(cmd, args, { timeout: 180000, maxBuffer: 4e6 },
  (e, out, err) => (e ? fail(new Error(String(err || e.message).trim().split('\n')[0])) : ok(out.trim()))));

async function latestRelease(fresh) {
  if (!fresh && cache && Date.now() - cache.at < 10 * 60e3) return cache.rel; // GitHub allows 60 asks an hour: this uses 6 at most
  const r = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  cache = { at: Date.now(), rel: await r.json() };
  return cache.rel;
}

export async function checkUpdate({ fresh = false } = {}) {
  const current = process.env.IRONHIDE_APP_VERSION;
  if (!current) return { available: false, state: 'idle', error: 'Updates are for the Mac app' };
  let rel;
  try { rel = await latestRelease(fresh); } catch { return { available: false, current, state: job.state, error: 'GitHub could not be reached' }; }
  const latest = String(rel.tag_name || '').replace(/^v/, '');
  const mine = job.version === latest;
  return { current, latest, available: !!latest && newer(latest, current), notes: String(rel.body || '').slice(0, 2000),
    state: mine ? job.state : 'idle', pct: mine ? job.pct : 0, error: mine ? job.error : '' };
}

// where the running app is, or why it cannot be replaced
function installedApp() {
  const app = process.env.IRONHIDE_APP_PATH || '';
  if (!app.endsWith('.app')) throw new Error('This Orbie was not started from the app');
  if (app.startsWith('/Volumes/') || app.includes('/AppTranslocation/')) throw new Error('Drag Orbie into Applications first, then update');
  try { accessSync(path.dirname(app), constants.W_OK); } catch { throw new Error(`No permission to write to ${path.dirname(app)}`); }
  return app;
}

async function fetchAndCheck(rel, version) {
  const asset = (rel.assets || []).find((a) => /^Orbie-.*-arm64\.zip$/.test(a.name));
  if (!asset) throw new Error('This release has no Mac download');
  const d = dir(), zip = path.join(d, 'Orbie.zip'), out = path.join(d, 'unpacked');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const r = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(30 * 60e3) });
  if (!r.ok || !r.body) throw new Error('The download failed');
  const hash = createHash('sha256'), file = createWriteStream(zip);
  let got = 0;
  for await (const chunk of r.body) {
    hash.update(chunk); got += chunk.length;
    if (!file.write(chunk)) await new Promise((ok) => file.once('drain', ok));
    job.pct = Math.min(99, Math.floor((got / (asset.size || got)) * 100));
  }
  await new Promise((ok, fail) => file.end((e) => (e ? fail(e) : ok())));
  if (asset.size && got !== asset.size) throw new Error('The download was cut short');
  if (asset.digest && asset.digest !== `sha256:${hash.digest('hex')}`) throw new Error('The download does not match the release');
  await run('/usr/bin/ditto', ['-x', '-k', zip, out]);
  const app = path.join(out, 'Orbie.app');
  if (!existsSync(app)) throw new Error('The download has no Orbie in it');
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const info = (k) => run('/usr/bin/plutil', ['-extract', k, 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')]);
  if (await info('CFBundleIdentifier') !== BUNDLE_ID) throw new Error('The download is a different app');
  const inside = await info('CFBundleShortVersionString');
  if (inside !== version || !newer(inside, process.env.IRONHIDE_APP_VERSION)) throw new Error(`The download is version ${inside}, expected ${version}`);
  rmSync(zip, { force: true });
  return app;
}

// waits for Orbie to quit, swaps the app, and opens it again only if "Restart now" left its note
const SWAP = `
set -u
APP_PID="$1"; NEW="$2"; DEST="$3"; DIR="$4"
while kill -0 "$APP_PID" 2>/dev/null; do sleep 1; done
sleep 1
OLD="$DIR/previous.app"
rm -rf "$OLD"
if mv "$DEST" "$OLD"; then
  if mv "$NEW" "$DEST"; then
    xattr -dr com.apple.quarantine "$DEST" 2>/dev/null; rm -rf "$OLD"; echo "updated"
  else
    rm -rf "$DEST"; mv "$OLD" "$DEST"; echo "update failed, kept the old Orbie"
  fi
else echo "could not move the old Orbie"; fi
if [ -f "$DIR/relaunch" ]; then rm -f "$DIR/relaunch"; \${ORBIE_UPDATE_OPEN:-open} "$DEST"; fi
`;

function arm(newApp, dest) {
  const d = dir(), pidFile = path.join(d, 'helper.pid');
  try { process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGTERM'); } catch {} // one helper at a time
  rmSync(path.join(d, 'relaunch'), { force: true });
  const script = path.join(d, 'swap.sh');
  writeFileSync(script, SWAP);
  const logDir = path.join(homedir(), 'Library/Logs/IronHide');
  mkdirSync(logDir, { recursive: true });
  const log = openSync(path.join(logDir, 'update.log'), 'a');
  const appPid = Number(process.env.ORBIE_UPDATE_APP_PID) || process.ppid; // the app that started this service
  // its own session: it outlives this service and the app it waits for
  const helper = spawn('/bin/bash', [script, String(appPid), newApp, dest, d], { detached: true, stdio: ['ignore', log, log] });
  helper.unref();
  writeFileSync(pidFile, String(helper.pid));
}

// start (or report) the background download
export async function downloadUpdate() {
  if (job.state === 'downloading') return { ok: true };
  // after a failure, ask GitHub again: the release may have been fixed since
  const u = await checkUpdate({ fresh: job.state === 'error' });
  if (!u.available) return { error: u.error || 'Already up to date' };
  if (job.state === 'downloading' || (job.state === 'ready' && job.version === u.latest)) return { ok: true };
  let dest;
  try { dest = installedApp(); } catch (e) { job = { state: 'error', pct: 0, error: e.message, version: u.latest }; return { error: e.message }; }
  job = { state: 'downloading', pct: 0, error: '', version: u.latest };
  fetchAndCheck(cache.rel, u.latest)
    .then((app) => { arm(app, dest); job = { ...job, state: 'ready', pct: 100 }; })
    .catch((e) => { console.warn(`[update] ${e.message}`); job = { ...job, state: 'error', error: e.message }; });
  return { ok: true };
}

// "Restart now": leave the note, quit the app; the helper does the rest
export async function installUpdate() {
  if (job.state !== 'ready') return { error: 'The update is not downloaded yet' };
  writeFileSync(path.join(dir(), 'relaunch'), '');
  if (!process.env.ORBIE_UPDATE_APP_PID) setTimeout(() => execFile('/usr/bin/osascript', ['-e', `quit app id "${BUNDLE_ID}"`], () => {}), 300);
  return { ok: true, version: job.version };
}
