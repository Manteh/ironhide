// In-browser playback: probe a debrid file with ffprobe, then stream it to a <video> element as
// fragmented MP4. Video is copied (zero CPU) when the browser can decode it, otherwise encoded on the GPU
// (VideoToolbox). Audio goes to AAC. Seeking restarts the stream at the requested time.
import { spawn } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';

const BIN = process.env.IRONHIDE_BIN || ''; // the Mac app's own tools come first
const FFMPEG = [BIN && `${BIN}/ffmpeg`, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].filter(Boolean).find(existsSync);
const FFPROBE = [BIN && `${BIN}/ffprobe`, '/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'].find(existsSync);
const sessions = new Map();

// A built-in test clip for checking sync: the picture flashes and a beep sounds together every 2 s, with a running clock on screen.
// Long keyframe gaps (5 s) on purpose, like real releases, so seeks behave as they do in real life.
const SYNC_CLIP = join(tmpdir(), 'ironhide-synctest-v3.mp4');
export const syncClipPath = () => SYNC_CLIP;
let clipJob = null;
export function ensureSyncClip() {
  if (existsSync(SYNC_CLIP)) return Promise.resolve(SYNC_CLIP);
  if (!FFMPEG) return Promise.reject(new Error('ffmpeg is not installed'));
  clipJob ||= new Promise((resolve, reject) => {
    // drawbox is fast (a per-pixel filter took minutes); the picture flashes white for 0.12 s every 2 s
    const v = "testsrc=size=640x360:rate=30:duration=240,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='lt(mod(t,2),0.12)'";
    const a = "aevalsrc='0.8*sin(2*PI*1000*t)*lt(mod(t,2),0.12)':s=48000:c=stereo:d=240";
    const tmp = SYNC_CLIP + '.part.mp4';
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', v, '-f', 'lavfi', '-i', a, '-c:v', 'libx264', '-preset', 'veryfast', '-g', '150', '-keyint_min', '150', '-sc_threshold', '0', '-bf', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', tmp], { stdio: 'ignore' });
    p.on('close', (c) => { clipJob = null; if (c !== 0) return reject(new Error('Could not make the test clip')); import('fs').then((fs) => { fs.renameSync(tmp, SYNC_CLIP); resolve(SYNC_CLIP); }); });
  });
  return clipJob;
}

export function capabilities() {
  return { ffmpeg: !!(FFMPEG && FFPROBE), gpu: FFMPEG ? 'VideoToolbox' : null };
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('Timed out reading the file')); }, timeoutMs);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').pop() || `exit ${code}`)); });
  });
}

// TorBox links bounce through their API on every request (~0.6s each). Resolve the final CDN address
// once so probing, seeking and preview frames all hit the fast host directly.
async function resolveFinal(url) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
    try { await r.arrayBuffer(); } catch {}
    if (r.ok) return r.url || url;
  } catch {}
  return url;
}

async function probe(url) {
  const out = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', '-analyzeduration', '8000000', '-probesize', '30000000', url], 40000);
  return JSON.parse(out);
}

// "cdn" delivery: the viewer's browser plays the debrid file straight from the CDN, so none of the
// video passes through this process. Only files a browser can decode as-is qualify.
const CDN_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
function cdnCompatible(info, video, audioStreams) {
  const container = String(info.format?.format_name || '');
  if (!/mp4|webm/.test(container)) return 'container ' + container.split(',')[0];
  const okVideo = (video.codec_name === 'h264' && !/10/.test(video.pix_fmt || '')) || video.codec_name === 'vp9' || video.codec_name === 'av1';
  if (!okVideo) return 'video ' + video.codec_name;
  const a = audioStreams.find((s) => s.disposition?.default) || audioStreams[0];
  if (a && !CDN_AUDIO.has(a.codec_name)) return 'audio ' + a.codec_name;
  return '';
}

export async function createSession({ url, origin = '', title, meta, subs = [], caps = {}, settings = {}, delivery = 'proxy' }) {
  if (!FFMPEG || !FFPROBE) throw new Error('ffmpeg is not installed (brew install ffmpeg)');
  url = await resolveFinal(url);
  const info = await probe(url);
  const video = info.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new Error('No video stream found in this file');
  if (delivery === 'cdn') {
    const why = cdnCompatible(info, video, info.streams.filter((s) => s.codec_type === 'audio'));
    if (why) { const e = new Error(`Not playable straight in a browser (${why})`); e.incompatible = true; throw e; }
  }
  const audio = info.streams.filter((s) => s.codec_type === 'audio').map((s, i) => ({
    index: i, codec: s.codec_name, channels: s.channels || 2, lang: s.tags?.language || 'und', title: s.tags?.title || '', default: !!s.disposition?.default,
  }));
  const duration = parseFloat(info.format?.duration) || 0;
  const hdr = video.color_transfer === 'smpte2084' ? 'HDR10' : video.color_transfer === 'arib-std-b67' ? 'HLG' : '';
  const dv = (video.side_data_list || []).some((d) => /dovi/i.test(d.side_data_type || ''));
  const tenBitH264 = video.codec_name === 'h264' && /10/.test(video.pix_fmt || '');
  const maxH = settings.webMaxHeight === 'source' ? 0 : parseInt(settings.webMaxHeight || '1080', 10);
  const tooTall = maxH && video.height > maxH && settings.webMaxHeight !== 'source';
  const canCopy = (video.codec_name === 'h264' && !tenBitH264) || (video.codec_name === 'hevc' && !!caps.hevc);
  const copyVideo = canCopy && !tooTall && !settings.forceTranscode; // only a 4K release exists and the cap is on: bring it down rather than make the browser decode 4K
  const id = randomUUID().slice(0, 12);
  const sess = {
    id, url, origin, title, meta, duration, subs, audio, procs: new Set(), createdAt: Date.now(), seen: Date.now(),
    video: { codec: video.codec_name, width: video.width, height: video.height, hdr, dv, fps: video.avg_frame_rate },
    plan: { copyVideo, maxH: copyVideo ? 0 : (maxH || 0), hevc: video.codec_name === 'hevc', cdn: delivery === 'cdn' },
    log: [],
  };
  sessions.set(id, sess);
  return publicInfo(sess);
}

export function publicInfo(s) {
  return {
    id: s.id, title: s.title, meta: s.meta, duration: s.duration, video: s.video, audio: s.audio,
    subs: s.subs.map((x, i) => ({ index: i, lang: x.lang })), mode: s.plan.cdn ? 'cdn' : s.plan.copyVideo ? 'direct' : 'transcode',
    ...(s.plan.cdn ? { src: s.url } : {}),
  };
}

export const getSession = (id) => sessions.get(id);

// Copy-mode streams can only start on a keyframe. Report the keyframes either side of a time, so the player knows what it will really show
// (and rooms can start every viewer on the same frame).
export async function keyframesAround(id, t) {
  const s = sessions.get(id); t = Math.max(0, Number(t) || 0);
  if (t < 0.01) return { prev: 0 };
  if (!s || !s.plan.copyVideo) return { prev: t };
  // Seek there and read a single packet: the demuxer lands on the keyframe at or before t. Cheap even on a huge remux.
  const first = async (at) => {
    const out = await run(FFPROBE, ['-v', 'error', '-probesize', '1500000', '-analyzeduration', '800000', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', '-read_intervals', `${at}%+#1`, s.url], 9000);
    const [pts, flags] = out.trim().split('\n')[0].split(','); const k = parseFloat(pts);
    return Number.isFinite(k) && flags?.includes('K') ? k : null;
  };
  try {
    let k = await first(t); if (k != null && k > t + 0.01) k = await first(Math.max(0, t - 15));
    return { prev: k != null && k <= t + 0.01 ? k : t };
  } catch { return { prev: t }; }
}

// A debrid link can die mid-session (a download node going away). Before starting a stream, check it, and ask for a new one if needed.
export async function refreshLink(id) {
  const s = sessions.get(id); if (!s?.origin || Date.now() - (s.checkedAt || 0) < 15000) return;
  s.checkedAt = Date.now();
  try { const r = await fetch(s.url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(4000) }); await r.arrayBuffer().catch(() => {}); if (r.ok) return; } catch {}
  try { const r = await fetch(s.origin, { redirect: 'manual', signal: AbortSignal.timeout(8000) }); const next = r.headers.get('location'); if (next) { s.url = await resolveFinal(next); s.log.push('link renewed'); } } catch {}
}
export const touchSession = (id) => { const s = sessions.get(id); if (s) s.seen = Date.now(); };


function ffArgs(s, start, audioIdx, force = false, sync = 0, abs = false) {
  const copyVideo = s.plan.copyVideo && !force;
  const maxH = copyVideo ? 0 : (s.plan.maxH || (force ? 1080 : 0));
  const a = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (abs) a.push('-copyts'); // keep the film's real timestamps: the player then knows exactly what it received, wherever the keyframe was
  // Audio sync (like mpv's audio delay): <0 plays the sound earlier, >0 later. Browsers cannot see Bluetooth latency,
  // so this lets the user line the sound up with the picture. Done by opening the file twice and shifting one stream's timestamps.
  const lag = Math.max(-1500, Math.min(1500, Math.round(Number(sync) || 0)));
  const input = (offsetMs, forVideo) => {
    const x = [];
    if (forVideo && !copyVideo) x.push('-hwaccel', 'videotoolbox');
    // already probed once: keep re-analysis tiny so seeks restart quickly
    x.push('-probesize', '1500000', '-analyzeduration', '800000', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '3');
    if (start > 0) x.push('-ss', String(start));
    if (offsetMs) x.push('-itsoffset', (offsetMs / 1000).toFixed(3));
    x.push('-i', s.url);
    return x;
  };
  a.push(...input(0, lag >= 0));                    // input 0
  if (lag !== 0) a.push(...input(Math.abs(lag), lag < 0)); // input 1: the stream that has to arrive later
  const vIn = lag < 0 ? 1 : 0, aIn = lag > 0 ? 1 : 0;
  a.push('-map', `${vIn}:v:0`);
  const track = s.audio[audioIdx] || s.audio.find((x) => x.default) || s.audio[0];
  if (track) a.push('-map', `${aIn}:a:${track.index}`);
  if (copyVideo) {
    a.push('-c:v', 'copy');
    if (s.plan.hevc) a.push('-tag:v', 'hvc1');
  } else {
    if (maxH) a.push('-vf', `scale=-2:'min(${maxH},ih)'`);
    const h = Math.min(maxH || s.video.height || 1080, s.video.height || 1080);
    a.push('-c:v', 'h264_videotoolbox', '-b:v', h > 1440 ? '28M' : h > 900 ? '12M' : '6M', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-realtime', '1');
  }
  if (track) {
    const ch = track.channels > 2 ? 6 : 2;
    a.push('-c:a', 'aac', '-b:a', ch > 2 ? '448k' : '192k', '-ac', String(ch));
  }
  a.push('-sn', '-dn', ...(abs ? ['-avoid_negative_ts', 'disabled'] : ['-avoid_negative_ts', 'make_zero']), '-movflags', `frag_keyframe+empty_moov+default_base_moof${abs ? '+frag_discont' : ''}`, // without frag_discont the muxer rewinds every stream to 0:00
      '-f', 'mp4', 'pipe:1');
  return a;
}

export function streamTo(res, id, start = 0, audio = 0, force = false, sync = 0, abs = false) {
  const s = sessions.get(id);
  if (!s) { res.writeHead(404); return res.end('Unknown session'); }
  s.seen = Date.now();
  const proc = spawn(FFMPEG, ffArgs(s, Math.max(0, start), audio, force, sync, abs), { stdio: ['ignore', 'pipe', 'pipe'] });
  s.procs.add(proc);
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store', 'Accept-Ranges': 'none', 'X-Content-Type-Options': 'nosniff' });
  proc.stdout.pipe(res);
  proc.stderr.on('data', (d) => { s.log.push(String(d).trim()); if (s.log.length > 20) s.log.shift(); });
  const stop = () => { s.procs.delete(proc); try { proc.kill('SIGKILL'); } catch {} };
  res.on('close', stop); res.on('error', stop); proc.on('close', () => { s.procs.delete(proc); res.end(); });
}

// SRT -> WebVTT
export async function subtitleVtt(id, index) {
  const s = sessions.get(id); const sub = s?.subs[index];
  if (!sub) return null;
  const srt = (await readFile(sub.path, 'utf-8')).replace(/^﻿/, '');
  return 'WEBVTT\n\n' + srt.replace(/\r+/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}

// A closed tab can't always say goodbye. Nobody streaming and nothing heard from the player: stop its background work, then forget it.
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.procs.size) { s.seen = now; continue; }
    if (s.thumbs && now - s.seen > 120000) s.thumbs.stopped = true;
    if (now - s.seen > 1800000) closeSession(id);
  }
}, 30000).unref?.();

export function closeSession(id) {
  const s = sessions.get(id); if (!s) return;
  for (const p of s.procs) { try { p.kill('SIGKILL'); } catch {} }
  if (s.thumbs) { s.thumbs.stopped = true; clearTimeout(s.thumbs.gap); for (const p of s.thumbs.procs) { try { p.kill('SIGKILL'); } catch {} } try { rmSync(s.thumbs.dir, { recursive: true, force: true }); } catch {} }
  sessions.delete(id);
}

// drop sessions nobody has touched for a while
setInterval(() => { for (const [id, s] of sessions) if (!s.procs.size && Date.now() - s.createdAt > 6 * 3600e3) closeSession(id); }, 600e3).unref();


// ---------- preview frames for the scrubber ----------
// A few ffmpeg jobs (low priority) grab one small frame at evenly spaced points, coarse first,
// so hovering the scrubber shows a picture almost immediately and sharpens as more arrive.
function coarseToFine(n) {
  const bits = Math.ceil(Math.log2(Math.max(2, n))), out = [];
  for (let i = 0; i < (1 << bits); i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); if (r < n) out.push(r); }
  return out;
}
export function startThumbs(s) {
  if (!sessions.has(s.id) || !s.duration || s.duration < 30 || s.thumbs) return;
  const step = Math.max(10, Math.ceil(s.duration / 700)), count = Math.max(1, Math.floor(s.duration / step));
  const dir = join(tmpdir(), 'ironhide-thumbs', s.id); mkdirSync(dir, { recursive: true });
  s.thumbs = { dir, step, count, ready: new Set(), queue: coarseToFine(count), running: 0, hold: 0, stopped: false, procs: new Set() };
  pumpThumbs(s);
}
function pumpThumbs(s) {
  const T = s.thumbs;
  // One at a time and spaced out: every frame is a new connection to the debrid server, and the movie itself needs the bandwidth.
  if (T.stopped || T.hold !== 0 || T.running || !T.queue.length) return;
  T.running = 1; genThumb(s, T.queue.shift()).finally(() => { T.running = 0; if (T.fails >= 3) { T.stopped = true; return; } T.gap = setTimeout(() => pumpThumbs(s), 1500); });
}
function genThumb(s, i) {
  const T = s.thumbs, out = join(T.dir, `${i}.jpg`), t = Math.min(s.duration - 2, i * T.step + 1);
  return new Promise((resolve) => {
    const p = spawn('nice', ['-n', '12', FFMPEG, '-hide_banner', '-loglevel', 'error', '-nostdin', '-probesize', '500000', '-analyzeduration', '200000', '-threads', '1', '-skip_frame', 'nokey', '-noaccurate_seek', '-ss', String(t), '-i', s.url, '-frames:v', '1', '-an', '-sn', '-vf', 'scale=360:-2', '-q:v', '6', '-y', out], { stdio: 'ignore' });
    T.procs.add(p);
    const kill = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 25000);
    p.on('close', (code) => { clearTimeout(kill); T.procs.delete(p); if (code === 0 && existsSync(out)) { T.ready.add(i); T.fails = 0; } else T.fails = (T.fails || 0) + 1; resolve(); });
    p.on('error', () => { clearTimeout(kill); T.procs.delete(p); resolve(); });
  });
}
// nearest frame we already have for time t (seconds)
export function thumbFor(id, t) {
  const s = sessions.get(id), T = s?.thumbs; if (!T || !T.ready.size) return null;
  const i0 = Math.min(T.count - 1, Math.max(0, Math.round(t / T.step)));
  for (let r = 0; r <= T.count; r++) for (const i of [i0 - r, i0 + r]) if (T.ready.has(i)) return { path: join(T.dir, `${i}.jpg`), t: i * T.step };
  return null;
}


// Exact frame on demand (used when the pointer rests on a spot): accurate seek, front of the line.
const exactJobs = new Map();
export function exactThumb(id, t) {
  const s = sessions.get(id), T = s?.thumbs; if (!T) return Promise.resolve(null);
  const sec = Math.max(0, Math.min(Math.round(t), Math.floor(s.duration) - 1)), out = join(T.dir, `x${sec}.jpg`), key = id + ':' + sec;
  if (existsSync(out)) return Promise.resolve({ path: out, t: sec });
  if (exactJobs.has(key)) return exactJobs.get(key);
  T.hold++;
  const job = new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-probesize', '500000', '-analyzeduration', '200000', '-threads', '1', '-skip_frame', 'nokey', '-noaccurate_seek', '-ss', String(sec), '-i', s.url, '-frames:v', '1', '-an', '-sn', '-vf', 'scale=360:-2', '-q:v', '5', '-y', out], { stdio: 'ignore' });
    T.procs.add(p);
    const kill = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 9000);
    p.on('close', (code) => { clearTimeout(kill); T.procs.delete(p); exactJobs.delete(key); T.hold--; pumpThumbs(s); resolve(code === 0 && existsSync(out) ? { path: out, t: sec } : null); });
    p.on('error', () => { clearTimeout(kill); exactJobs.delete(key); T.hold--; pumpThumbs(s); resolve(null); });
  });
  exactJobs.set(key, job);
  return job;
}
