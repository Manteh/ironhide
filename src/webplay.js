// In-browser playback: probe a debrid file with ffprobe, then stream it to a <video> element as
// fragmented MP4. Video is copied (zero CPU) when the browser can decode it, otherwise encoded on the GPU
// (VideoToolbox). Audio goes to AAC. Seeking restarts the stream at the requested time.
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';

const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(existsSync);
const FFPROBE = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe'].find(existsSync);
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

async function probe(url) {
  const out = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', '-analyzeduration', '8000000', '-probesize', '30000000', url], 40000);
  return JSON.parse(out);
}

export async function createSession({ url, title, meta, subs = [], caps = {}, settings = {} }) {
  if (!FFMPEG || !FFPROBE) throw new Error('ffmpeg is not installed (brew install ffmpeg)');
  const info = await probe(url);
  const video = info.streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new Error('No video stream found in this file');
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
    plan: { copyVideo, maxH: copyVideo ? 0 : (maxH || 0), hevc: video.codec_name === 'hevc' },
    log: [],
  };
  sessions.set(id, sess);
  return publicInfo(sess);
}

export function publicInfo(s) {
  return {
    id: s.id, title: s.title, meta: s.meta, duration: s.duration, video: s.video, audio: s.audio,
    subs: s.subs.map((x, i) => ({ index: i, lang: x.lang })), mode: s.plan.copyVideo ? 'direct' : 'transcode',
  };
}

export const getSession = (id) => sessions.get(id);

function ffArgs(s, start, audioIdx, force = false) {
  const copyVideo = s.plan.copyVideo && !force;
  const maxH = copyVideo ? 0 : (s.plan.maxH || (force ? 1080 : 0));
  const a = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (!copyVideo) a.push('-hwaccel', 'videotoolbox');
  // already probed once: keep re-analysis tiny so seeks restart quickly
  a.push('-probesize', '1500000', '-analyzeduration', '800000', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '3');
  if (start > 0) a.push('-ss', String(start));
  a.push('-i', s.url, '-map', '0:v:0');
  const track = s.audio[audioIdx] || s.audio.find((x) => x.default) || s.audio[0];
  if (track) a.push('-map', `0:a:${track.index}`);
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

export function streamTo(res, id, start = 0, audio = 0, force = false) {
  const s = sessions.get(id);
  if (!s) { res.writeHead(404); return res.end('Unknown session'); }
  const proc = spawn(FFMPEG, ffArgs(s, Math.max(0, start), audio, force), { stdio: ['ignore', 'pipe', 'pipe'] });
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
  sessions.delete(id);
}

// drop sessions nobody has touched for a while
setInterval(() => { for (const [id, s] of sessions) if (!s.procs.size && Date.now() - s.createdAt > 6 * 3600e3) closeSession(id); }, 600e3).unref();
