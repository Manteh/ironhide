// Web player: full-screen <video> (GPU decoded) fed by the daemon's ffmpeg stream, with custom controls.
import { api, post } from './api.js';
import { $, $$, esc, icon, fmtTime, toast, pad, posterOf } from './ui.js';

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
addEventListener('pagehide', () => { try { fetch('/api/social/watching', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ watching: null }) }); } catch {} });

export function openPlayer(info, opts = {}) {
  if (wp) closePlayer();
  const ep = info.meta?.season ? `S${pad(info.meta.season)}E${pad(info.meta.episode)}` : '';
  wp = document.createElement('div');
  wp.className = 'wp';
  wp.innerHTML = `
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
          <button class="wp-btn" id="wpSync" title="Line the sound up with the picture (Bluetooth headphones delay sound)"><span>Sync</span></button>
          <button class="wp-btn" id="wpSpeed"><span>1x</span></button>
          <button class="wp-btn ic" id="wpPip" aria-label="Picture in picture">${icon('pip')}</button>
          <button class="wp-btn ic" id="wpFs" aria-label="Fullscreen">${icon('expand')}</button>
        </div>
      </div>
      <div class="wp-menu hidden" id="wpMenu"></div>
    </div>`;
  document.body.appendChild(wp);
  requestAnimationFrame(() => wp.classList.add('in'));

  const video = $('.wp-video', wp);
  S = { info, video, offset: 0, audio: info.audio.findIndex((a) => a.default) >= 0 ? info.audio.findIndex((a) => a.default) : 0, wasPlaying: true, transcode: false, dragging: false,
    sync: +(localStorage.getItem('wp-sync') || 0) || 0, cues: [], cueOn: -1, subIdx: -1, rate: 1, idle: 0, saver: 0, retried: false, lastUI: 0, room: !!opts.room };
  video.volume = +(localStorage.getItem('wp-vol') ?? 1); $('#wpVol', wp).value = video.volume;

  badges();
  bind();
  // rooms start paused at the beginning; the room decides when everyone presses play
  load(S.room ? (info.start > 1 ? info.start : 0) : (info.start > 20 ? info.start : 0), !S.room);
  S.saver = setInterval(save, 10000);
  S.beat = setInterval(() => post('/api/social/watching', { watching: watchingNow(info) }).catch(() => {}), 45000); // keep the 'watching' status fresh while the player is open
  post('/api/social/watching', { watching: watchingNow(info) }).catch(() => {});
  if (S.room) import('./roomplay.js').then((m) => { if (S && wp) roomOff = m.attachRoom({ root: () => wp, video: () => S?.video, cur: () => (S ? cur() : 0), seek: (t) => S && seekTo(t), close: () => closePlayer(), hooks }); });
  document.addEventListener('keydown', onKey, true);
  wake();
}

// ---------- loading / seeking ----------
function load(start, autoplay) {
  const { video, info } = S;
  if (info.mode === 'cdn') { // played straight from the CDN: native seeking, no restarts, offset stays 0
    S.offset = 0; S.wasPlaying = autoplay; spin(true);
    if (!video.src) { video.src = info.src; video.addEventListener('loadedmetadata', () => { if (start > 0) video.currentTime = start; }, { once: true }); }
    video.playbackRate = S.rate; if (autoplay) video.play().catch(() => {});
    return;
  }
  S.offset = Math.max(0, start); S.wasPlaying = autoplay; spin(true);
  const url = `/api/wp/${info.id}/stream?start=${S.offset.toFixed(2)}&audio=${S.audio}${S.transcode ? '&transcode=1' : ''}${S.sync ? `&sync=${S.sync}` : ''}&t=${Date.now()}`;
  video.src = url; video.playbackRate = S.rate;
  if (autoplay) video.play().catch(() => {});
}
const cur = () => S.offset + (S.video.currentTime || 0);
const dur = () => S.info.duration || (S.offset + (S.video.duration || 0));

function seekTo(t) {
  const { video } = S; t = Math.min(Math.max(0, t), Math.max(0, dur() - 1)); const rel = t - S.offset;
  if (S.info.mode === 'cdn') { paintTime(t); video.currentTime = t; return; }
  // Only jump inside video the browser says is SEEKABLE. These streams are piped, so 'buffered' can be large while 'seekable' is empty;
  // setting currentTime there sends the video to 0:00. Anything else restarts the stream at the new spot.
  let inBuf = false; for (let i = 0; i < video.seekable.length; i++) if (rel >= video.seekable.start(i) - 0.1 && rel <= video.seekable.end(i) - 0.8) inBuf = true;
  paintTime(t);
  if (inBuf) video.currentTime = rel; else load(t, !video.paused || S.wasPlaying);
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
  video.addEventListener('playing', () => { spin(false); wp.classList.add('started'); playIcon(); if (!S.thumbsOn && S.info.mode !== 'cdn') { S.thumbsOn = true; setTimeout(() => S && post(`/api/wp/${S.info.id}/thumbs`).catch(() => {}), 3000); } });
  video.addEventListener('canplay', () => spin(false));
  video.addEventListener('loadeddata', () => wp.classList.add('started'));
  // friends see Watching / Paused the moment it changes
  const tellWatch = () => post('/api/social/watching', { watching: watchingNow(S.info) }).catch(() => {});
  video.addEventListener('pause', () => { playIcon(); wake(); tellWatch(); }); video.addEventListener('play', () => { playIcon(); wake(); tellWatch(); });
  video.addEventListener('volumechange', () => { localStorage.setItem('wp-vol', video.volume); playIcon(); });
  video.addEventListener('ended', () => { save(); closePlayer(); toast('Finished', 'ok'); });
  video.addEventListener('error', () => {
    if (!S.retried && S.info.mode === 'direct') { S.retried = true; S.transcode = true; badges(); toast('This browser can’t play that directly. Switching to GPU transcode…'); load(cur(), true); }
    else { spin(false); toast('Playback failed. Try the mpv player in Settings.', 'err'); }
  });
  video.addEventListener('click', toggle); video.addEventListener('dblclick', fs);

  $('#wpBack', wp).onclick = closePlayer;
  $('#wpPlay', wp).onclick = toggle;
  $('#wpBk', wp).onclick = () => { userSeek(cur() - 10); pulse('back'); }; $('#wpFw', wp).onclick = () => { userSeek(cur() + 10); pulse('fwd'); };
  $('#wpMute', wp).onclick = () => { video.muted = !video.muted; };
  $('#wpVol', wp).oninput = (e) => { video.volume = +e.target.value; video.muted = false; };
  $('#wpPip', wp).onclick = () => { document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture?.().catch(() => toast('Picture in picture is not available', 'err')); };
  $('#wpFs', wp).onclick = fs;
  $('#wpSubs', wp).onclick = (e) => menu('subs', e.currentTarget); $('#wpAudio', wp).onclick = (e) => menu('audio', e.currentTarget); $('#wpSync', wp).onclick = (e) => menu('sync', e.currentTarget); $('#wpSpeed', wp).onclick = (e) => menu('speed', e.currentTarget);

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
    if (S.info.mode === 'cdn') return; // no server-made preview frames when video goes straight to the browser
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

  wp.addEventListener('pointermove', wake); wp.addEventListener('pointerdown', (e) => { wake(); if (!e.target.closest('#wpMenu, #wpSubs, #wpAudio, #wpSync, #wpSpeed')) $('#wpMenu', wp).classList.add('hidden'); });
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
  if (kind === 'sync') items = [{ label: 'Sound earlier  ·  fixes sound that is late', on: false, head: true, act() {} }, ...SYNCS.map((v) => ({ label: syncLabel(v), on: (S.sync || 0) === v, act: () => { S.sync = v; localStorage.setItem('wp-sync', String(v)); syncBtn(); load(cur(), !S.video.paused || S.wasPlaying); } }))];
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
function onKey(e) {
  if (!wp || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && e.key !== 'Escape') return;
  const k = e.key; let used = true;
  if (k === ' ' || k === 'k') toggle();
  else if (k === 'ArrowLeft' || k === 'j') { userSeek(cur() - (e.shiftKey ? 30 : 10)); pulse('back'); }
  else if (k === 'ArrowRight' || k === 'l') { userSeek(cur() + (e.shiftKey ? 30 : 10)); pulse('fwd'); }
  else if (k === 'ArrowUp') S.video.volume = Math.min(1, S.video.volume + 0.08);
  else if (k === 'ArrowDown') S.video.volume = Math.max(0, S.video.volume - 0.08);
  else if (k === 'm') S.video.muted = !S.video.muted;
  else if (k === 'f') fs();
  else if (k === 'c') setSub(S.subIdx < 0 && S.info.subs.length ? S.info.subs[0].index : -1);
  else if (k === 'Escape') { if (!document.fullscreenElement) closePlayer(); else used = false; }
  else used = false;
  if (used) { e.preventDefault(); e.stopPropagation(); wake(); }
}

// ---------- persistence / teardown ----------
function save() { if (!S) return; const d = dur(), p = cur(); if (d > 0 && p > 5) post(`/api/wp/${S.info.id}/progress`, { position: p, duration: d }).catch(() => {}); }

// read-only snapshot of the player, for diagnostics and sync tests
export const debugState = () => (S ? { pos: cur(), paused: S.video.paused, offset: S.offset, ready: S.video.readyState, rate: S.video.playbackRate, mode: S.info.mode } : null);

export function closePlayer() {
  if (!wp) return;
  save(); clearInterval(S.saver); clearInterval(S.beat); clearTimeout(S.idle);
  roomOff?.(); roomOff = null;
  post('/api/social/watching', { watching: null }).catch(() => {});
  document.removeEventListener('keydown', onKey, true);
  const id = S.info.id, el = wp, video = S.video;
  wp = null; S = null;
  try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
  fetch(`/api/wp/${id}`, { method: 'DELETE' }).catch(() => {});
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  el.classList.remove('in'); setTimeout(() => el.remove(), 500);
  import('./main.js').then((m) => m.refreshHistory?.());
}
