// Watch without a debrid service: stream a torrent straight from its peers. The webtorrent CLI downloads in playback
// order and serves the video over a local HTTP port; that URL goes to mpv exactly like a debrid link would.
// One torrent at a time: starting another (or stopping) tears the previous one down and deletes what it downloaded.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const WEBTORRENT = ['/opt/homebrew/bin/webtorrent', '/usr/local/bin/webtorrent'].find(existsSync) || 'webtorrent';
const CACHE = join(homedir(), 'Library', 'Caches', 'IronHide', 'torrents');
let current = null;

const freePort = () => new Promise((res, rej) => { const s = createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

export function stopTorrent() { if (current) { current.stop(); current = null; } }

// Resolves with { url, stop } once the torrent's metadata is found and the server is up (or rejects: no peers, no webtorrent).
export async function startTorrent(magnet, { fileIdx = null, timeoutMs = 60000 } = {}) {
  stopTorrent();
  const port = await freePort(), out = join(CACHE, String(Date.now()));
  mkdirSync(out, { recursive: true });
  const args = [magnet, '--port', String(port), '-o', out];
  if (fileIdx != null) args.push('--select', String(fileIdx)); // without it webtorrent serves the largest file
  const proc = spawn(WEBTORRENT, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; try { proc.kill('SIGTERM'); } catch {} setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} try { rmSync(out, { recursive: true, force: true }); } catch {} }, 1500); if (current?.stop === stop) current = null; };
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error('No peers found for this version. Try another one.')); }, timeoutMs);
    let buf = '';
    const onData = (d) => { buf += d.toString(); const m = buf.match(/Server running at:\s*(http:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]); } buf = buf.slice(-2000); };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.once('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? 'webtorrent is not installed (brew install webtorrent-cli)' : e.message)); });
    proc.once('exit', () => { clearTimeout(timer); reject(new Error('The torrent downloader stopped')); });
  });
  current = { stop };
  process.once('exit', stop);
  return { url, stop };
}
