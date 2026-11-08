// Web player: full-screen <video> (GPU decoded) fed by the daemon's ffmpeg stream, with custom controls.
import { api, post } from './api.js';
import { $, $$, esc, icon, fmtTime, toast, pad, posterOf } from './ui.js';

const ISO = { en: ['eng', 'en'], lt: ['lit', 'lt'], sv: ['swe', 'sv'], es: ['spa', 'es'], fr: ['fre', 'fra', 'fr'], de: ['ger', 'deu', 'de'], it: ['ita', 'it'], pt: ['por', 'pt'], ru: ['rus', 'ru'], pl: ['pol', 'pl'] };
const LANG = { eng: 'English', en: 'English', lit: 'Lithuanian', lt: 'Lithuanian', swe: 'Swedish', sv: 'Swedish', chi: 'Chinese', zho: 'Chinese', jpn: 'Japanese', spa: 'Spanish', fre: 'French', ger: 'German', ita: 'Italian', rus: 'Russian', und: 'Unknown' };
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SYNCS = [-400, -300, -200, -150, -100, -50, 0, 50, 100, 200, 300]; // ms: <0 sound earlier, >0 sound later
const syncLabel = (v) => (v === 0 ? 'In sync' : v < 0 ? `Sound ${-v} ms earlier` : `Sound ${v} ms later`);

let wp = null, S = null, roomOff = null; // S: all live player state
export const hooks = { onToggle: null, onSeek: null }; // set by roomplay.js in room mode

export const isPlayerOpen = () => !!wp;

export function browserCaps() {
  const v = document.createElement('video');
  const ok = (t) => { const r = v.canPlayType(t); return r === 'probably' || r === 'maybe'; };
  return { hevc: ok('video/mp4; codecs="hvc1.1.6.L153.B0"') || ok('video/mp4; codecs="hev1.1.6.L153.B0"'), av1: ok('video/mp4; codecs="av01.0.08M.08"') };
}

const watchingNow = (info) => ({ state: S?.video?.paused ? 'paused' : 'playing', title: info.title, type: info.meta?.type === 'movie' ? 'movie' : 'series', imdbId: info.meta?.imdbId || '', poster: info.meta?.imdbId ? posterOf(info.meta.imdbId) : '' });
// closing the tab also ends the status
addEventListener('pagehide', () => { try { if (S?.info?.id) { const d = dur(), p = cur(); if (d > 0 && p > 5 && S.info.id) fetch(`/api/wp/${S.info.id}/progress`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position: p, duration: d }) }); fetch(`/api/wp/${S.info.id}`, { method: 'DELETE', keepalive: true }); } fetch('/api/social/watching', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ watching: null }) }); } catch {} });

export function openPlayer(info, opts = {}) {
  if (wp) closePlayer();
  const ep = info.meta?.season ? `S${pad(info.meta.season)}E${pad(info.meta.episode)}` : '';
  wp = document.createElement('div');
  wp.className = 'wp';
  wp.innerHTML = `
    <div class="wp-mini"><span class="wp-mini-t">${esc(info.title)}</span><button class="wp-btn ic" id="wpMiniX" aria-label="Stop watching">${icon('x')}</button></div>
    <div class="wp-poster" style="background-image:url('${info.meta?.imdbId ? posterOf(info.meta.imdbId) : ''}')"></div>
    <video class="wp-video" playsinline preload="auto"></video>
    <div class="wp-cues" id="wpCues"></div>
    <div class="wp-spin" id="wpSpin"><i></i></div>
    <div class="wp-pulse" id="wpPulse"></div>
    <div class="wp-top"><button class="wp-btn" id="wpBack" aria-label="Close player">${icon('back')}<span>Back</span></button>
      <div class="wp-title"><b>${esc(info.title)}</b><span>${esc([ep, info.meta?.year].filter(Boolean).join(' · '))}</span></div>
      <div class="wp-badges" id="wpBadges"></div></div>
    <div class="wp-bottom">
      <div class="wp-scrub" id="wpScrub" role="slider" aria-label="Seek" tabindex="0"><div class="wp-track"><i class="wp-buf" id="wpBuf"></i><i class="wp-fill" id="wpFill"></i><b class="wp-knob" id="wpKnob"></b></div><div class="wp-tip" id="wpTip"><div class="wp-thumb"><img alt=""></div><span>0:00</span></div></div>
      <div class="wp-row">
        <div class="wp-l">
          <button class="wp-btn ic big" id="wpPlay" aria-label="Play or pause"></button>
          <button class="wp-btn ic" id="wpBk" aria-label="Back 10 seconds">${icon('back')}</button>
          <button class="wp-btn ic" id="wpFw" aria-label="Forward 10 seconds">${icon('fwd')}</button>
          <div class="wp-vol"><button class="wp-btn ic" id="wpMute" aria-label="Mute"></button><input type="range" id="wpVol" min="0" max="1" step="0.02" aria-label="Volume"></div>
          <span class="wp-time" id="wpTime">0:00 / 0:00</span>
        </div>
        <div class="wp-r">
          <button class="wp-btn" id="wpSubs"><span>Subtitles</span></button>
          <button class="wp-btn" id="wpAudio"><span>Audio</span></button>
          <button class="wp-btn" id="wpSpeed"><span>1x</span></button>
          <button class="wp-btn ic" id="wpPip" aria-label="Picture in picture">${icon('pip')}</button>
          <button class="wp-btn ic" id="wpFs" aria-label="Fullscreen">${icon('expand')}</button>
        </div>
      </div>
      <div class="wp-menu hidden" id="wpMenu"></div>
    </div>`;
  if (opts.parked) wp.classList.add('parked');
  document.body.appendChild(wp); fullFlag();
  requestAnimationFrame(() => wp.classList.add('in'));

  const video = $('.wp-video', wp);
  S = { info, video, offset: 0, audio: info.audio.findIndex((a) => a.default) >= 0 ? info.audio.findIndex((a) => a.default) : 0, wasPlaying: true, transcode: false, dragging: false,
    sync: +(localStorage.getItem('wp-sync') || 0) || 0, cues: [], cueOn: -1, subIdx: -1, rate: 1, idle: 0, saver: 0, retried: false, lastUI: 0, room: !!opts.room };
  video.volume = +(localStorage.getItem('wp-vol') ?? 1); $('#wpVol', wp).value = video.volume;
  // the audio and subtitles this person asked for in Settings, Streams
  const P = opts.prefs || {};
  for (const l of P.audioLangs || []) { const i = info.audio.findIndex((a) => ISO[l]?.includes(a.lang)); if (i >= 0) { S.audio = i; break; } }
  const wantSub = ISO[P.subLang] && info.subs.find((x) => ISO[P.subLang].includes(x.lang));
  if (wantSub) setTimeout(() => { if (S?.info === info) setSub(wantSub.index); }, 0);

  badges();
  bind();
  // in a room, the room decides where the stream starts (see roomplay.js)
  if (!S.room) load(info.start > 20 ? info.start : 0, true);
  S.saver = setInterval(save, 10000);
  S.beat = setInterval(() => post('/api/social/watching', { watching: watchingNow(info) }).catch(() => {}), 45000); // keep the 'watching' status fresh while the player is open
  post('/api/social/watching', { watching: watchingNow(info) }).catch(() => {});
  if (S.room) attachToRoom();
  document.addEventListener('keydown', onKey, true);
  wake();
}

// ---------- rooms ----------
const roomApi = () => ({ root: () => wp, video: () => S?.video, info: () => S?.info, cur: () => (S ? cur() : 0), dur: () => (S ? dur() : 0), hasStream: () => !!S?.video.getAttribute('src'),
  load: (t, autoplay = false) => { if (S) load(t, autoplay); }, jump: (t) => jumpTo(t), holds: (t) => !!S && !!mse && bufferedRange(S.video, t - S.offset), usesMse: () => !!mse, mseCapable: () => mseCapable(), keyframes: (t) => api(`/api/wp/${S.info.id}/keyframes?t=${Number(t).toFixed(3)}`), close: () => closePlayer(), hooks, park: () => parkPlayer(), unpark: () => unparkPlayer(), parked: () => !!wp?.classList.contains('parked'), wake: () => wake() });
function attachToRoom() { return import('./roomplay.js').then((m) => { if (S && wp && !roomOff) roomOff = m.attachRoom(roomApi()); }); }
export const isRoomAttached = () => !!roomOff;
export const isRoomPlayer = () => !!S?.room;
export const detachRoom = () => { roomOff?.(); roomOff = null; };
export const reattachRoom = () => attachToRoom();
export const playerKey = () => { const m = S?.info?.meta; return m ? `${m.imdbId}:${m.season || 0}:${m.episode || 0}` : ''; };
export const isParked = () => !!wp?.classList.contains('parked');
// Back in a room shrinks the player to a corner and keeps it running, so coming back is instant and still in sync.
// While the player fills the window, nothing behind it should spend time painting
const fullFlag = () => document.body.classList.toggle('wp-full', !!wp && !wp.classList.contains('parked'));
export function parkPlayer() { if (!wp) return; if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); wp.classList.add('parked'); fullFlag(); }
export function unparkPlayer() { if (!wp) return; wp.classList.remove('parked'); fullFlag(); wake(); }

// ---------- Media Source feed ----------
// With a plain <video src>, browsers read only ~2.5 s ahead on a piped stream and cannot seek in it. Fetching it ourselves and appending to a
// MediaSource buffers minutes ahead (also while paused), survives debrid hiccups, and makes jumps inside the buffer instant.
const MAX_AHEAD = 300; // seconds to hold ahead before pausing the download
let mse = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findBox(u8, name) { const a = name.charCodeAt(0), b = name.charCodeAt(1), c = name.charCodeAt(2), d = name.charCodeAt(3); for (let i = 0; i + 3 < u8.length; i++) if (u8[i] === a && u8[i + 1] === b && u8[i + 2] === c && u8[i + 3] === d) return i; return -1; }
const hex2 = (n) => n.toString(16).padStart(2, '0');
function codecsOf(u8) {
  let video = null, i;
  if ((i = findBox(u8, 'avcC')) >= 0) video = `avc1.${hex2(u8[i + 5])}${hex2(u8[i + 6])}${hex2(u8[i + 7])}`;
  else if ((i = findBox(u8, 'hvcC')) >= 0) {
    const b = i + 4, pb = u8[b + 1], space = ['', 'A', 'B', 'C'][pb >> 6], tier = pb & 0x20 ? 'H' : 'L', prof = pb & 0x1f;
    let compat = (u8[b + 2] << 24 | u8[b + 3] << 16 | u8[b + 4] << 8 | u8[b + 5]) >>> 0, rev = 0; for (let k = 0; k < 32; k++) { rev = (rev << 1 | compat & 1) >>> 0; compat >>>= 1; }
    const cons = Array.from(u8.slice(b + 6, b + 12)); while (cons.length && cons[cons.length - 1] === 0) cons.pop();
    video = `hvc1.${space}${prof}.${rev.toString(16)}.${tier}${u8[b + 12]}${cons.length ? '.' + cons.map((x) => x.toString(16).toUpperCase()).join('.') : ''}`;
  }
  return video ? `video/mp4; codecs="${video}, mp4a.40.2"` : null;
}
function mseStop() { if (!mse) return; mse.dead = true; try { mse.ctl.abort(); } catch {} mse = null; }
const bufferedRange = (video, rel) => { for (let i = 0; i < video.buffered.length; i++) if (rel >= video.buffered.start(i) - 0.25 && rel <= video.buffered.end(i) - 0.5) return true; return false; };
const mseCapable = () => !!window.MediaSource && !S?.noMse;
function mseStart(url, video, from = 0) {
  mseStop();
  const m = { dead: false, ctl: new AbortController(), want: from }, ms = new MediaSource(); mse = m;
  video.src = URL.createObjectURL(ms);
  const fallback = () => { if (m.dead) return; m.dead = true; if (S) { S.noMse = true; load(from, S.wasPlaying); } };
  ms.addEventListener('sourceopen', async () => {
    let sb = null, head = new Uint8Array(0);
    // The connection dropped before the end: keep playing what we hold, then reconnect at the same spot.
    const lost = async () => {
      if (m.dead || !S) return;
      const n = S.retries = (S.retries || 0) + 1;
      if (n > 6) { spin(false); toast('The stream keeps failing. The debrid server may be down, so try another version.', 'err'); return; }
      while (!m.dead && video.buffered.length && video.buffered.end(video.buffered.length - 1) - video.currentTime > 4) await sleep(500);
      await sleep(Math.min(16000, 1000 * 2 ** (n - 1)));
      if (!m.dead && S) { const go = !video.paused || S.wasPlaying; load(cur(), go); }
    };
    const idle = () => new Promise((r) => { if (!sb.updating) return r(); sb.addEventListener('updateend', r, { once: true }); });
    const append = async (chunk) => {
      for (;;) {
        if (m.dead) return; await idle(); if (m.dead) return;
        try { sb.appendBuffer(chunk); await idle(); return; }
        catch (e) {
          if (e.name !== 'QuotaExceededError') throw e;
          const t = video.currentTime; // full: drop what is well behind us, or wait for playback to make room
          if (video.buffered.length && t - video.buffered.start(0) > 20) { sb.remove(0, t - 15); await idle(); } else await sleep(1000);
        }
      }
    };
    try {
      const res = await fetch(url, { signal: m.ctl.signal }); if (!res.ok || !res.body) return lost();
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read(); if (m.dead) return;
        if (done) break;
        if (!sb) {
          const joined = new Uint8Array(head.length + value.length); joined.set(head); joined.set(value, head.length); head = joined;
          if (findBox(head, 'moof') < 0) continue;
          const type = codecsOf(head); if (!type || !MediaSource.isTypeSupported(type)) { reader.cancel().catch(() => {}); return fallback(); }
          sb = ms.addSourceBuffer(type); sb.mode = 'segments';
          try { ms.duration = S?.info.duration || Infinity; } catch {}
          await append(head);
        } else await append(value);
        if (m.dead) return;
        if (S) S.retries = 0;
        // the very first frame can sit a hair after 0: start on it rather than waiting at a gap
        // the stream begins on the keyframe before the spot we asked for: go to the exact spot as soon as it has arrived
        if (m.want != null && bufferedRange(video, m.want)) { video.currentTime = Math.max(m.want, video.buffered.start(0)); m.want = null; }
        while (!m.dead && video.buffered.length && video.buffered.end(video.buffered.length - 1) - video.currentTime > MAX_AHEAD) await sleep(1000);
      }
      if (m.dead) return;
      if (sb) await idle();
      const heldTo = (S?.offset || 0) + (video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0);
      if (sb && S && heldTo >= (S.info.duration || 0) - 5) { if (ms.readyState === 'open') ms.endOfStream(); return; }
      lost(); // the stream ended early: that is a dropped connection, not the end of the film
    } catch (e) { if (m.dead || e.name === 'AbortError') return; lost(); }
  }, { once: true });
  return true;
}
// Jump to t without restarting the stream, if we already hold it. Instant.
function jumpTo(t) { if (!S || !mse) return false; const rel = t - S.offset; if (rel < 0 || !bufferedRange(S.video, rel)) return false; S.video.currentTime = rel; return true; }

// ---------- loading / seeking ----------
function load(start, autoplay) {
  const { video, info } = S;
  if (info.mode === 'cdn') { // played straight from the CDN: native seeking, no restarts, offset stays 0
    S.offset = 0; S.wasPlaying = autoplay; spin(true);
    if (!video.src) { video.src = info.src; video.addEventListener('loadedmetadata', () => { if (start > 0) video.currentTime = start; }, { once: true }); }
    video.playbackRate = S.rate; if (autoplay) video.play().catch(() => {});
    return;
  }
  S.wasPlaying = autoplay; spin(true);
  const from = Math.max(0, start); S.resumeAt = from; // the clock keeps saying where we are going, not 0:00, while the new spot loads
  const url = `/api/wp/${info.id}/stream?start=${from.toFixed(2)}&audio=${S.audio}${S.transcode ? '&transcode=1' : ''}${S.sync ? `&sync=${S.sync}` : ''}&t=${Date.now()}`;
  if (mseCapable()) { S.offset = 0; mseStart(`${url}&abs=1`, video, from); } // real timestamps: currentTime is the film's own time
  else { mseStop(); S.offset = from; video.src = url; }
  video.playbackRate = S.rate;
  if (autoplay) video.play().catch(() => {});
}
const cur = () => mse?.want != null ? mse.want : S.video.readyState === 0 && S.resumeAt != null ? S.resumeAt : curRaw();
const curRaw = () => S.offset + (S.video.currentTime || 0);
const dur = () => S.info.duration || (S.offset + (S.video.duration || 0));

function seekTo(t) {
  const { video } = S; t = Math.min(Math.max(0, t), Math.max(0, dur() - 1)); const rel = t - S.offset;
  if (S.info.mode === 'cdn') { paintTime(t); video.currentTime = t; return; }
  // Inside what we hold: instant. Otherwise restart the stream at the new spot. (A plain piped <video src> cannot seek at all: setting currentTime sends it to 0:00.)
  paintTime(t);
  if (mse && bufferedRange(video, rel)) video.currentTime = rel; else load(t, !video.paused || S.wasPlaying);
}

function userSeek(t) { if (S.room && hooks.onSeek) return hooks.onSeek(t); seekTo(t); }

// ---------- UI painting ----------
function paintTime(t = cur()) {
  const d = dur(), pct = d ? Math.min(100, (t / d) * 100) : 0;
  $('#wpFill', wp).style.width = pct + '%'; $('#wpKnob', wp).style.left = pct + '%';
  $('#wpTime', wp).textContent = `${fmtTime(t)} / ${fmtTime(d)}`;
  // subtitles follow absolute time
  if (S.cues.length) {
    const c = S.cues.findIndex((q) => t >= q.s && t <= q.e);
    if (c !== S.cueOn) { S.cueOn = c; $('#wpCues', wp).innerHTML = c >= 0 ? `<span>${S.cues[c].t.split('\n').map(esc).join('<br>')}</span>` : ''; }
  }
}
function paintBuffer() {
  const { video } = S, d = dur(); if (!d || !video.buffered.length) return;
  const end = S.offset + video.buffered.end(video.buffered.length - 1);
  $('#wpBuf', wp).style.width = Math.min(100, (end / d) * 100) + '%';
}
const syncBtn = () => { const b = $('#wpSync span', wp); if (b) b.textContent = S.sync ? `Sync ${S.sync > 0 ? '+' : ''}${S.sync}` : 'Sync'; };
const spin = (on) => $('#wpSpin', wp)?.classList.toggle('on', on);
function badges() {
  const v = S.info.video, mode = S.info.mode !== 'transcode' && !S.transcode;
  const parts = [S.info.mode === 'cdn' ? 'Direct from CDN' : mode ? 'Direct play' : 'GPU transcode', (v.codec || '').toUpperCase(), v.height ? `${v.height}p` : '', v.dv ? 'Dolby Vision' : v.hdr].filter(Boolean);
  $('#wpBadges', wp).innerHTML = parts.map((p, i) => `<span class="${i === 0 ? 'hl' : ''}">${esc(p)}</span>`).join('');
}
function playIcon() { $('#wpPlay', wp).innerHTML = icon(S.video.paused ? 'play' : 'pause'); $('#wpMute', wp).innerHTML = S.video.muted || S.video.volume === 0 ? '<svg class="i" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6M21 9l-4 6"/></svg>' : '<svg class="i" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/></svg>'; }
function pulse(name) { const p = $('#wpPulse', wp); p.innerHTML = icon(name); p.classList.remove('go'); void p.offsetWidth; p.classList.add('go'); }

// ---------- controls ----------
function toggle() { if (S.room && hooks.onToggle) return hooks.onToggle(!S.video.paused); const { video } = S; if (video.paused) { video.play().catch(() => {}); S.wasPlaying = true; pulse('play'); } else { video.pause(); S.wasPlaying = false; pulse('pause'); } }
function wake() { wp.classList.remove('idle'); clearTimeout(S.idle); S.idle = setTimeout(() => { if (!S.video.paused && $('#wpMenu', wp).classList.contains('hidden') && !S.dragging) wp.classList.add('idle'); }, 2800); }

function bind() {
  const { video } = S;
  video.addEventListener('timeupdate', () => { const now = performance.now(); if (!S.dragging && now - S.lastUI > 200) { S.lastUI = now; paintTime(); } paintBuffer(); });
  video.addEventListener('progress', paintBuffer);
  video.addEventListener('waiting', () => spin(true)); video.addEventListener('stalled', () => spin(true));
  video.addEventListener('playing', () => { spin(false); wp.classList.add('started'); playIcon(); if (!S.thumbsOn && S.info.mode !== 'cdn' && !S.room) { S.thumbsOn = true; setTimeout(() => S && post(`/api/wp/${S.info.id}/thumbs`).catch(() => {}), 3000); } });
  video.addEventListener('canplay', () => spin(false));
  video.addEventListener('loadeddata', () => wp.classList.add('started'));
  // friends see Watching / Paused the moment it changes
  const tellWatch = () => post('/api/social/watching', { watching: watchingNow(S.info) }).catch(() => {});
  video.addEventListener('pause', () => { playIcon(); wake(); tellWatch(); }); video.addEventListener('play', () => { playIcon(); wake(); tellWatch(); });
  video.addEventListener('volumechange', () => { localStorage.setItem('wp-vol', video.volume); playIcon(); });
  video.addEventListener('ended', () => { const m = S.info.meta, t = S.info.title, room = S.room; save(true).then(() => { if (!room) import('./nextup.js').then((n) => n.offerNext({ ...m, title: m?.title || t })); }); hooks.onDismiss?.(); closePlayer(true); toast('Finished', 'ok'); });
  video.addEventListener('error', () => {
    if (!S.retried && S.info.mode === 'direct') { S.retried = true; S.transcode = true; badges(); toast('This browser can’t play that directly. Switching to GPU transcode…'); load(cur(), true); }
    else { spin(false); toast('Playback failed. Try the mpv player in Settings.', 'err'); }
  });
  video.addEventListener('click', toggle); video.addEventListener('dblclick', fs);

  $('#wpBack', wp).onclick = () => { if (S.room) { parkPlayer(); if (!location.hash.startsWith('#/friends')) location.hash = '#/friends'; } else closePlayer(); };
  wp.addEventListener('click', (e) => { if (wp.classList.contains('parked') && !e.target.closest('#wpMiniX')) { e.stopPropagation(); unparkPlayer(); } }, true);
  $('#wpMiniX', wp).onclick = (e) => { e.stopPropagation(); hooks.onDismiss?.(); closePlayer(); };
  $('#wpPlay', wp).onclick = toggle;
  $('#wpBk', wp).onclick = () => { userSeek(cur() - 10); pulse('back'); }; $('#wpFw', wp).onclick = () => { userSeek(cur() + 10); pulse('fwd'); };
  $('#wpMute', wp).onclick = () => { video.muted = !video.muted; };
  $('#wpVol', wp).oninput = (e) => { video.volume = +e.target.value; video.muted = false; };
  $('#wpPip', wp).onclick = () => { document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture?.().catch(() => toast('Picture in picture is not available', 'err')); };
  $('#wpFs', wp).onclick = fs;
  $('#wpSubs', wp).onclick = (e) => menu('subs', e.currentTarget); $('#wpAudio', wp).onclick = (e) => menu('audio', e.currentTarget); $('#wpSpeed', wp).onclick = (e) => menu('speed', e.currentTarget);

  // scrubber
  const scrub = $('#wpScrub', wp), tip = $('#wpTip', wp);
  const at = (e) => { const r = $('.wp-track', wp).getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  scrub.addEventListener('pointerdown', (e) => { S.dragging = true; try { scrub.setPointerCapture(e.pointerId); } catch {} paintTime(at(e) * dur()); place(e); });
  // Preview: nearest frame we already have shows instantly; if the pointer rests, the exact frame replaces it.
  let thumbReq = 0, nearTimer = 0, exactTimer = 0, ctl = null, lastUrl = '';
  const fetchThumb = async (url, my, exact, t) => {
    ctl?.abort(); ctl = new AbortController();
    try {
      const r = await fetch(url, { signal: ctl.signal }); if (r.status !== 200) return;
      const actual = +r.headers.get('X-Thumb-Time'), blob = await r.blob();
      if (my !== thumbReq || !S) return;
      const img = $('img', tip), old = lastUrl; lastUrl = URL.createObjectURL(blob); img.src = lastUrl; if (old) setTimeout(() => URL.revokeObjectURL(old), 400);
      tip.classList.add('has'); tip.classList.toggle('approx', !exact && Math.abs(actual - t) > 6);
    } catch {}
  };
  const showThumb = (t) => {
    if (S.info.mode === 'cdn' || S.room) return; // no preview frames straight from the CDN, or in rooms: the movie gets the bandwidth
    const my = ++thumbReq; clearTimeout(nearTimer); clearTimeout(exactTimer);
    nearTimer = setTimeout(() => fetchThumb(`/api/wp/${S.info.id}/thumb?t=${t.toFixed(1)}`, my, false, t), 30);
    exactTimer = setTimeout(() => fetchThumb(`/api/wp/${S.info.id}/thumb?t=${Math.round(t)}&exact=1`, my, true, t), 260);
  };
  const place = (e) => {
    const r = scrub.getBoundingClientRect(), f = at(e), w = tip.offsetWidth || 200, x = Math.min(r.width - w / 2 - 4, Math.max(w / 2 + 4, f * r.width));
    tip.querySelector('span').textContent = fmtTime(f * dur()); tip.style.left = x + 'px'; showThumb(f * dur());
  };
  scrub.addEventListener('pointermove', (e) => { place(e); if (S.dragging) paintTime(at(e) * dur()); });
  scrub.addEventListener('pointerup', (e) => { if (!S.dragging) return; S.dragging = false; userSeek(at(e) * dur()); });
  scrub.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') userSeek(cur() - 10); if (e.key === 'ArrowRight') userSeek(cur() + 10); });

  wp.addEventListener('pointermove', wake); wp.addEventListener('pointerdown', (e) => { wake(); if (!e.target.closest('#wpMenu, #wpSubs, #wpAudio, #wpSpeed')) $('#wpMenu', wp).classList.add('hidden'); });
  playIcon();
}

function fs() { document.fullscreenElement ? document.exitFullscreen() : wp.requestFullscreen?.().catch(() => {}); }

function menu(kind, anchor) {
  const m = $('#wpMenu', wp), open = !m.classList.contains('hidden') && m.dataset.kind === kind;
  if (open) return m.classList.add('hidden');
  const labelA = (a) => `${LANG[a.lang] || a.lang}${a.title ? ' · ' + a.title : ''} · ${a.codec.toUpperCase()}${a.channels > 2 ? ' ' + (a.channels - 1) + '.1' : ''}`;
  let items = [];
  if (kind === 'audio') items = S.info.audio.map((a, i) => ({ label: labelA(a), on: i === S.audio, act: () => { if (i === S.audio) return; S.audio = i; load(cur(), !S.video.paused || S.wasPlaying); } }));
  if (kind === 'subs') items = [{ label: 'Off', on: S.subIdx < 0, act: () => setSub(-1) }, ...S.info.subs.map((s) => ({ label: LANG[s.lang] || s.lang, on: S.subIdx === s.index, act: () => setSub(s.index) }))];
  if (kind === 'audio') items.push({ label: `Sound timing: ${syncLabel(S.sync || 0)} ›`, on: false, act: () => setTimeout(() => menu('sync', anchor), 0) });
  if (kind === 'sync') items = [...SYNCS.map((v) => ({ label: syncLabel(v), on: (S.sync || 0) === v, act: () => { S.sync = v; localStorage.setItem('wp-sync', String(v)); syncBtn(); load(cur(), !S.video.paused || S.wasPlaying); } }))];
  if (kind === 'speed') items = SPEEDS.map((r) => ({ label: r === 1 ? 'Normal' : r + 'x', on: S.rate === r, act: () => { S.rate = r; S.video.playbackRate = r; $('#wpSpeed span', wp).textContent = r + 'x'; } }));
  if (!items.length) items = [{ label: kind === 'subs' ? 'No subtitles found for this title' : 'Single audio track', on: false, act() {} }];
  m.dataset.kind = kind;
  m.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.on ? 'on' : ''}"><i>${it.on ? icon('check') : ''}</i>${esc(it.label)}</button>`).join('');
  $$('button', m).forEach((b) => (b.onclick = () => { items[+b.dataset.i].act(); m.classList.add('hidden'); }));
  const r = anchor.getBoundingClientRect(), wr = wp.getBoundingClientRect();
  m.style.right = Math.max(12, wr.right - r.right) + 'px'; m.classList.remove('hidden');
}

async function setSub(i) {
  S.subIdx = i; S.cues = []; S.cueOn = -1; $('#wpCues', wp).innerHTML = '';
  $('#wpSubs span', wp).textContent = i < 0 ? 'Subtitles' : (LANG[S.info.subs[i].lang] || 'On');
  if (i < 0) return;
  try { S.cues = parseVtt(await (await fetch(`/api/wp/${S.info.id}/sub/${i}.vtt`)).text()); paintTime(); } catch { toast('Could not load subtitles', 'err'); }
}
function parseVtt(text) {
  const out = [], t = (s) => { const [h, m, x] = s.replace(',', '.').split(':'); return +h * 3600 + +m * 60 + parseFloat(x); };
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split('\n'), k = lines.findIndex((l) => l.includes('-->')); if (k < 0) continue;
    const [a, b] = lines[k].split('-->').map((s) => s.trim().split(' ')[0]);
    out.push({ s: t(a), e: t(b), t: lines.slice(k + 1).join('\n').replace(/<[^>]+>/g, '') });
  }
  return out;
}

// ---------- keyboard ----------
// Press I: what the player is really doing
let statsT = 0;
function toggleStats() {
  const old = wp.querySelector('.wp-stats');
  if (old) { old.remove(); clearInterval(statsT); statsT = 0; return; }
  const el = document.createElement('div'); el.className = 'wp-stats'; wp.append(el);
  let q0 = S.video.getVideoPlaybackQuality(), t0 = performance.now();
  const draw = () => {
    const v = S?.video; if (!v) return;
    const q = v.getVideoPlaybackQuality(), secs = (performance.now() - t0) / 1000, shown = q.totalVideoFrames - q.droppedVideoFrames - (q0.totalVideoFrames - q0.droppedVideoFrames), lost = q.droppedVideoFrames - q0.droppedVideoFrames;
    const end = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
    el.textContent = `${v.videoWidth}×${v.videoHeight}  ·  ${v.paused ? 'paused' : `${secs > 0 ? (shown / secs).toFixed(1) : '0'} fps`}  ·  ${lost} dropped  ·  ${Math.max(0, end - v.currentTime).toFixed(0)} s buffered  ·  ${S.transcode ? 'converted' : S.info.mode || 'direct'}`;
    q0 = q; t0 = performance.now();
  };
  draw(); statsT = setInterval(draw, 2000);
}
function onKey(e) {
  if (!wp || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && e.key !== 'Escape') return;
  const k = e.key; let used = true;
  if (k === ' ' || k === 'k') toggle();
  else if (k === 'ArrowLeft' || k === 'j') { userSeek(cur() - (e.shiftKey ? 30 : 10)); pulse('back'); }
  else if (k === 'ArrowRight' || k === 'l') { userSeek(cur() + (e.shiftKey ? 30 : 10)); pulse('fwd'); }
  else if (k === 'ArrowUp') S.video.volume = Math.min(1, S.video.volume + 0.08);
  else if (k === 'ArrowDown') S.video.volume = Math.max(0, S.video.volume - 0.08);
  else if (k === 'm') S.video.muted = !S.video.muted;
  else if (k === 'i') toggleStats();
  else if (k === 'f') fs();
  else if (k === 'c') setSub(S.subIdx < 0 && S.info.subs.length ? S.info.subs[0].index : -1);
  else if (k === 'Escape') { if (document.fullscreenElement) used = false; else if (S.room) { parkPlayer(); if (!location.hash.startsWith('#/friends')) location.hash = '#/friends'; } else closePlayer(); }
  else used = false;
  if (used) { e.preventDefault(); e.stopPropagation(); wake(); }
}

// ---------- persistence / teardown ----------
function save(eof = false) { if (!S) return Promise.resolve(); const d = dur(), p = cur(); return d > 0 && p > 5 ? post(`/api/wp/${S.info.id}/progress`, { position: p, duration: d, eof }).catch(() => {}) : Promise.resolve(); }

// read-only snapshot of the player, for diagnostics and sync tests
export const debugState = () => (S ? { pos: cur(), paused: S.video.paused, offset: S.offset, ready: S.video.readyState, rate: S.video.playbackRate, mode: S.info.mode } : null);

export function closePlayer(already = false) {
  if (!wp) return;
  document.body.classList.remove('wp-full'); clearInterval(statsT); statsT = 0;
  // save where we are first; stopping near the end counts as finished and offers the next episode
  const saved = already ? Promise.resolve() : save(), meta = S.info.meta, mtitle = S.info.title, nearEnd = dur() > 0 && (dur() - cur() < 240 || cur() / dur() > 0.88), inRoom = S.room;
  if (!already && nearEnd && !inRoom) saved.then(() => import('./nextup.js').then((n) => n.offerNext({ ...meta, title: meta?.title || mtitle })));
  clearInterval(S.saver); clearInterval(S.beat); clearTimeout(S.idle); mseStop();
  roomOff?.(); roomOff = null;
  post('/api/social/watching', { watching: null }).catch(() => {});
  document.removeEventListener('keydown', onKey, true);
  const id = S.info.id, el = wp, video = S.video;
  wp = null; S = null;
  try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
  saved.finally(() => fetch(`/api/wp/${id}`, { method: 'DELETE' }).catch(() => {})); // after the position is saved, not racing it
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  el.classList.remove('in'); setTimeout(() => el.remove(), 500);
  import('./main.js').then((m) => m.refreshHistory?.());
}
