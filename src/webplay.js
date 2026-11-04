// In-browser playback: probe a debrid file with ffprobe, then stream it to a <video> element as
// fragmented MP4. Video is copied (zero CPU) when the browser can decode it, otherwise encoded on the GPU
// (VideoToolbox). Audio goes to AAC. Seeking restarts the stream at the requested time.
import { spawn } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';

const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg'].find(existsSync);
const FFPROBE = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe'].find(existsSync);
const sessions = new Map();

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

export async function createSession({ url, title, meta, subs = [], caps = {}, settings = {}, delivery = 'proxy' }) {
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
  const copyVideo = canCopy && !settings.forceTranscode;
  const id = randomUUID().slice(0, 12);
  const sess = {
    id, url, title, meta, duration, subs, audio, procs: new Set(), createdAt: Date.now(),
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

function ffArgs(s, start, audioIdx, force = false, sync = 0) {
  const copyVideo = s.plan.copyVideo && !force;
  const maxH = copyVideo ? 0 : (s.plan.maxH || (force ? 1080 : 0));
  const a = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
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
  a.push('-sn', '-dn', '-avoid_negative_ts', 'make_zero', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1');
  return a;
}

export function streamTo(res, id, start = 0, audio = 0, force = false, sync = 0) {
  const s = sessions.get(id);
  if (!s) { res.writeHead(404); return res.end('Unknown session'); }
  const proc = spawn(FFMPEG, ffArgs(s, Math.max(0, start), audio, force, sync), { stdio: ['ignore', 'pipe', 'pipe'] });
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

export function closeSession(id) {
  const s = sessions.get(id); if (!s) return;
  for (const p of s.procs) { try { p.kill('SIGKILL'); } catch {} }
  if (s.thumbs) { s.thumbs.stopped = true; for (const p of s.thumbs.procs) { try { p.kill('SIGKILL'); } catch {} } try { rmSync(s.thumbs.dir, { recursive: true, force: true }); } catch {} }
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
  while (!T.stopped && T.hold === 0 && T.running < 4 && T.queue.length) { T.running++; genThumb(s, T.queue.shift()).finally(() => { T.running--; pumpThumbs(s); }); }
}
function genThumb(s, i) {
  const T = s.thumbs, out = join(T.dir, `${i}.jpg`), t = Math.min(s.duration - 2, i * T.step + 1);
  return new Promise((resolve) => {
    const p = spawn('nice', ['-n', '12', FFMPEG, '-hide_banner', '-loglevel', 'error', '-nostdin', '-probesize', '500000', '-analyzeduration', '200000', '-noaccurate_seek', '-ss', String(t), '-i', s.url, '-frames:v', '1', '-an', '-sn', '-vf', 'scale=360:-2', '-q:v', '6', '-y', out], { stdio: 'ignore' });
    T.procs.add(p);
    const kill = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 25000);
    p.on('close', (code) => { clearTimeout(kill); T.procs.delete(p); if (code === 0 && existsSync(out)) T.ready.add(i); resolve(); });
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
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-probesize', '500000', '-analyzeduration', '200000', '-noaccurate_seek', '-ss', String(sec), '-i', s.url, '-frames:v', '1', '-an', '-sn', '-vf', 'scale=360:-2', '-q:v', '5', '-y', out], { stdio: 'ignore' });
    T.procs.add(p);
    const kill = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, 9000);
    p.on('close', (code) => { clearTimeout(kill); T.procs.delete(p); exactJobs.delete(key); T.hold--; pumpThumbs(s); resolve(code === 0 && existsSync(out) ? { path: out, t: sec } : null); });
    p.on('error', () => { clearTimeout(kill); exactJobs.delete(key); T.hold--; pumpThumbs(s); resolve(null); });
  });
  exactJobs.set(key, job);
  return job;
}
