import { spawn } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LUA_SCRIPT = join(__dirname, 'mpv-progress.lua');

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

    proc = spawn('/opt/homebrew/bin/mpv', [...mpvArgs, resolved.url], {
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

const PROGRESS_FILE = join(tmpdir(), 'ironhide-progress.json');

export async function playDetached(stream, subs = [], onFinish, resumeFrom) {
  const progressFile = PROGRESS_FILE;
  const subArgs = subs.flatMap(s => [`--sub-file=${s.path}`]);
  const resumeArgs = resumeFrom > 0 ? [`--start=${Math.floor(resumeFrom)}`] : [];
  const ipcSocket = '/tmp/ironhide-mpv.sock';
  const mpvArgs = ['--really-quiet', `--script=${LUA_SCRIPT}`, '--alang=eng,en,lit,lt,swe,sv', '--fullscreen=yes', `--input-ipc-server=${ipcSocket}`, ...resumeArgs, ...subArgs];

  let proc;

  if (stream.isRD && stream.url) {
    const res = await fetch(stream.url, { redirect: 'manual' });
    const location = res.headers.get('location');
    if (!location) return { status: 'not_cached', progressFile: null };

    proc = spawn('/opt/homebrew/bin/mpv', [...mpvArgs, location], {
      stdio: 'ignore',
      env: { ...process.env, IRONHIDE_PROGRESS_FILE: progressFile },
    });
  } else if (stream.magnet) {
    proc = spawn('/opt/homebrew/bin/webtorrent', [stream.magnet, '--mpv'], {
      stdio: 'ignore',
    });
    return { status: 'playing', progressFile: null };
  } else if (stream.torrentLink) {
    proc = spawn('/opt/homebrew/bin/webtorrent', [stream.torrentLink, '--mpv'], {
      stdio: 'ignore',
    });
    return { status: 'playing', progressFile: null };
  } else {
    return { status: 'error', progressFile: null };
  }

  // Monitor exit — fires when user closes mpv
  proc.on('exit', async () => {
    // Small delay to let Lua script finish writing
    await new Promise(r => setTimeout(r, 200));
    const progress = await readProgress(progressFile);
    if (onFinish) onFinish(progress);
  });

  return { status: 'playing', progressFile };
}

export { readProgress, formatTime };
