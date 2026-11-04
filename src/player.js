import { spawn } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { unlinkSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { getProp, setProp, isMpvRunning as ipcRunning } from './mpv-ipc.js';
import { setPlayState, getPlayState } from './playstate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LUA_SCRIPT = join(__dirname, 'mpv-progress.lua');
const MPV_BIN = '/Applications/mpv.app/Contents/MacOS/mpv';

async function resolveUrl(url) {
  const res = await fetch(url, { redirect: 'manual' });
  const location = res.headers.get('location');
  if (location) return { url: location, ready: true };

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    return { url, ready: false };
  }
  return { url, ready: true };
}

async function readProgress(progressFile) {
  try {
    const data = await readFile(progressFile, 'utf-8');
    const parsed = JSON.parse(data.trim());
    await unlink(progressFile).catch(() => {});
    return parsed;
  } catch {
    return null;
  }
}

function formatTime(seconds) {
  if (!seconds || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

export async function play(stream, subs = []) {
  const progressFile = PROGRESS_FILE;
  const subArgs = subs.flatMap(s => [`--sub-file=${s.path}`]);
  const ipcSocket = '/tmp/ironhide-mpv.sock';
  const mpvArgs = ['--really-quiet', `--script=${LUA_SCRIPT}`, '--alang=eng,en,lit,lt,swe,sv', '--fullscreen=yes', `--input-ipc-server=${ipcSocket}`, ...subArgs];

  let proc;

  if (stream.isRD && stream.url) {
    const resolved = await resolveUrl(stream.url);
    if (!resolved.ready) return { status: 'not_cached' };

    proc = spawn(MPV_BIN, [...mpvArgs, resolved.url], {
      stdio: 'inherit',
      env: { ...process.env, IRONHIDE_PROGRESS_FILE: progressFile },
    });
  } else if (stream.magnet) {
    proc = spawn('/opt/homebrew/bin/webtorrent', [stream.magnet, '--mpv'], {
      stdio: 'inherit',
    });
    return { status: 'playing', progress: null };
  } else if (stream.torrentLink) {
    proc = spawn('/opt/homebrew/bin/webtorrent', [stream.torrentLink, '--mpv'], {
      stdio: 'inherit',
    });
    return { status: 'playing', progress: null };
  } else {
    console.error('No playable URL or magnet link found.');
    process.exit(1);
  }

  return new Promise((resolve) => {
    proc.on('error', (err) => {
      console.error(`Failed to launch player: ${err.message}`);
      resolve({ status: 'error', progress: null });
    });

    proc.on('exit', async () => {
      const progress = await readProgress(progressFile);
      resolve({ status: 'done', progress });
    });
  });
}

const PROGRESS_FILE = '/tmp/ironhide-progress.json';

export function isMpvRunning() {
  return new Promise(resolve => {
    const p = spawn('pgrep', ['-x', 'mpv'], { stdio: 'ignore' });
    p.on('exit', code => resolve(code === 0));
    p.on('error', () => resolve(false));
  });
}

function watchMpvProcess(progressFile, onFinish) {
  let wasRunning = false;
  const interval = setInterval(async () => {
    const running = await isMpvRunning();
    if (running && !wasRunning) wasRunning = true;
    if (!running && wasRunning) {
      clearInterval(interval);
      await new Promise(r => setTimeout(r, 400));
      const progress = await readProgress(progressFile);
      if (onFinish) onFinish(progress);
    }
  }, 2000);
  return interval;
}

// Write a shell script and run via osascript so mpv/webtorrent get macOS GUI session access.
// Sets PATH so webtorrent can find mpv internally.
// Uses 'sh scriptPath' to avoid needing chmod +x.
function launchScript(lines) {
  const scriptPath = '/tmp/ironhide-launch.sh';
  writeFileSync(scriptPath, [
    '#!/bin/sh',
    'export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH',
    ...lines,
  ].join('\n') + '\n');
  spawn('osascript', ['-e', `do shell script "sh '${scriptPath}'"`], { stdio: 'ignore' });
}

function sh(s) {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export async function playDetached(stream, subs = [], onFinish, resumeFrom, title) {
  const progressFile = PROGRESS_FILE;
  const ipcSocket = '/tmp/ironhide-mpv.sock';
  try { unlinkSync(ipcSocket); } catch {}

  if (stream.isRD && stream.url) {
    const res = await fetch(stream.url, { redirect: 'manual' });
    const location = res.headers.get('location') || (res.status < 300 ? stream.url : null);
    if (!location) { setPlayState({ phase: 'error', detail: 'Stream is not available' }); return { status: 'not_cached', progressFile: null }; }
    if (/failed_|error|denied/i.test(location)) { setPlayState({ phase: 'error', detail: 'Stream is not cached' }); return { status: 'not_cached', progressFile: null }; }
    setPlayState({ phase: 'launching', detail: 'Starting the player' });

    const mpvArgs = [
      '--really-quiet', `--script=${LUA_SCRIPT}`, '--alang=eng,en,lit,lt,swe,sv',
      // open behind everything, paused, until the stream is buffered; then we reveal it
      '--focus-on=never', '--pause', '--fullscreen=no', '--demuxer-readahead-secs=10',
      `--input-ipc-server=${ipcSocket}`,
      ...(title ? [`--force-media-title=${title}`] : []),
      ...(resumeFrom > 0 ? [`--start=${Math.floor(resumeFrom)}`] : []),
      ...subs.map(x => `--sub-file=${x.path}`),
      location,
    ];
    launchScript([
      `export IRONHIDE_PROGRESS_FILE=${sh(progressFile)}`,
      `nohup /opt/homebrew/bin/mpv ${mpvArgs.map(sh).join(' ')} > /dev/null 2>&1 &`,
    ]);

    const interval = watchMpvProcess(progressFile, onFinish);
    presentWhenReady(getPlayState().token);
    return { status: 'playing', progressFile, cancel: () => clearInterval(interval) };

  } else if (stream.magnet) {
    const wtArgs = [stream.magnet, '--mpv'];
    if (stream.fileIdx != null) wtArgs.push('--select', String(stream.fileIdx));
    if (resumeFrom > 0) wtArgs.push('--player-args', `--start=${Math.floor(resumeFrom)}`);

    launchScript([
      `nohup /opt/homebrew/bin/webtorrent ${wtArgs.map(sh).join(' ')} > /dev/null 2>&1 &`,
    ]);

    const interval = watchMpvProcess(progressFile, onFinish);
    return { status: 'playing', progressFile, cancel: () => clearInterval(interval) };

  } else if (stream.torrentLink) {
    const tlArgs = [stream.torrentLink, '--mpv'];
    if (stream.fileIdx != null) tlArgs.push('--select', String(stream.fileIdx));
    if (resumeFrom > 0) tlArgs.push('--player-args', `--start=${Math.floor(resumeFrom)}`);

    launchScript([
      `nohup /opt/homebrew/bin/webtorrent ${tlArgs.map(sh).join(' ')} > /dev/null 2>&1 &`,
    ]);

    const interval = watchMpvProcess(progressFile, onFinish);
    return { status: 'playing', progressFile, cancel: () => clearInterval(interval) };

  } else {
    return { status: 'error', progressFile: null };
  }
}

export { readProgress, formatTime };


const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until mpv has the file open and a few seconds buffered, then unpause,
// go fullscreen and raise the window so the hand-over is seamless.
export async function presentWhenReady(token) {
  const t0 = Date.now();
  const stale = () => getPlayState().token !== token || getPlayState().phase === 'idle';
  let seenWindow = false;
  while (Date.now() - t0 < 60000) {
    await sleep(500);
    if (stale()) return;
    if (!(await ipcRunning().catch(() => false))) { if (Date.now() - t0 > 12000) break; continue; }
    seenWindow = true;
    const dur = await getProp('duration').catch(() => null);
    if (!(dur > 0)) continue;
    setPlayState({ phase: 'buffering', detail: 'Buffering' });
    const [cache, pos] = await Promise.all([getProp('demuxer-cache-time').catch(() => 0), getProp('time-pos').catch(() => 0)]);
    if ((cache || 0) - (pos || 0) >= 3 || Date.now() - t0 > 35000) break;
  }
  if (stale()) return;
  if (!seenWindow || !(await ipcRunning().catch(() => false))) { setPlayState({ phase: 'error', detail: 'The player did not start' }); return; }
  setPlayState({ phase: 'playing', detail: 'Opening fullscreen' });
  await setProp('fullscreen', true).catch(() => {});
  await setProp('pause', false).catch(() => {});
  // bring to front: toggling ontop raises the window without needing extra permissions
  await setProp('ontop', true).catch(() => {});
  await sleep(250);
  await setProp('ontop', false).catch(() => {});
  setTimeout(() => { if (getPlayState().token === token && getPlayState().phase === 'playing') setPlayState({ detail: 'Playing' }); }, 1200);
}
