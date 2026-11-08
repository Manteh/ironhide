// Trailer player: YouTube's official embedded player (privacy-enhanced host) driven through its
// IFrame API, with the same glass controls as the main player so it feels native.
import { $, esc, icon, fmtTime, toast } from './ui.js';

let apiReady = null, tr = null, T = null;

function loadApi() {
  if (window.YT?.Player) return Promise.resolve();
  return (apiReady ||= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api'; s.async = true; s.onerror = () => { apiReady = null; reject(new Error('offline')); };
    document.head.appendChild(s);
  }));
}
// call early (when a title sheet opens) so the player starts instantly on click
export const preload = () => { loadApi().catch(() => {}); };

export async function openTrailer({ ids, title, year, onPlay }) {
  if (tr) closeTrailer();
  tr = document.createElement('div');
  tr.className = 'wp wp-trailer';
  tr.innerHTML = `
    <div class="wp-poster"></div>
    <div class="tr-frame"><div id="trYT"></div></div>
    <div class="tr-hit" id="trHit"></div>
    <div class="wp-spin on" id="trSpin"><i></i></div>
    <div class="wp-pulse" id="trPulse"></div>
    <div class="tr-err hidden" id="trErr"><b>This trailer can’t be played here</b><span>The publisher blocks embedding.</span><a class="btn primary" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${year || ''} trailer`)}">Open on YouTube ${icon('ext')}</a></div>
    <div class="wp-top"><button class="wp-btn" id="trBack" aria-label="Close trailer">${icon('back')}<span>Back</span></button>
      <div class="wp-title"><b>${esc(title)}</b><span>Trailer${year ? ' · ' + esc(year) : ''}</span></div>
      <div class="wp-badges">${ids.length > 1 ? ids.map((_, i) => `<button class="tr-chip${i === 0 ? ' on' : ''}" data-i="${i}">Trailer ${i + 1}</button>`).join('') : ''}${onPlay ? `<button class="btn primary" id="trWatch">${icon('play')} Watch now</button>` : ''}</div></div>
    <div class="wp-bottom">
      <div class="wp-scrub" id="trScrub" role="slider" aria-label="Seek" tabindex="0"><div class="wp-track"><i class="wp-buf" id="trBuf"></i><i class="wp-fill" id="trFill"></i><b class="wp-knob" id="trKnob"></b></div><div class="wp-tip" id="trTip"><span>0:00</span></div></div>
      <div class="wp-row"><div class="wp-l"><button class="wp-btn ic big" id="trPlay" aria-label="Play or pause"></button><button class="wp-btn ic" id="trMute" aria-label="Mute"></button><span class="wp-time" id="trTime">0:00 / 0:00</span></div>
        <div class="wp-r"><button class="wp-btn ic" id="trFs" aria-label="Fullscreen">${icon('expand')}</button></div></div>
    </div>`;
  document.body.appendChild(tr);
  requestAnimationFrame(() => tr.classList.add('in'));
  T = { ids, idx: 0, yt: null, state: -1, timer: 0, idle: 0, dragging: false, onPlay, ready: false };
  bind();
  document.addEventListener('keydown', onKey, true);
  wake();
  try { await loadApi(); } catch { fail('Could not reach YouTube. Check your connection.'); return; }
  if (!tr) return;
  mount(0);
}

function mount(i) {
  T.idx = i; T.ready = false; $('#trErr', tr).classList.add('hidden'); $('#trSpin', tr).classList.add('on');
  if (T.yt) { try { T.yt.destroy(); } catch {} T.yt = null; }
  $('.tr-frame', tr).innerHTML = '<div id="trYT"></div>';
  T.yt = new YT.Player('trYT', {
    videoId: T.ids[i], host: 'https://www.youtube-nocookie.com',
    playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0, origin: location.origin },
    events: {
      onReady: (e) => { T.ready = true; e.target.setVolume(+(localStorage.getItem('tr-vol') ?? 80)); e.target.playVideo(); T.timer = setInterval(tick, 250); icons(); },
      onStateChange: (e) => { T.state = e.data; if (e.data === 1) { tr.classList.add('started'); $('#trSpin', tr).classList.remove('on'); } if (e.data === 3) $('#trSpin', tr).classList.add('on'); if (e.data === 0) { tr.classList.remove('idle'); } icons(); wake(); },
      onError: () => fail(),
    },
  });
}

function fail(msg) {
  if (!tr) return;
  $('#trSpin', tr).classList.remove('on');
  const err = $('#trErr', tr); if (msg) err.querySelector('span').textContent = msg; err.classList.remove('hidden');
}

const yt = () => (T?.ready ? T.yt : null);
function tick() {
  const p = yt(); if (!p || T.dragging) return;
  const d = p.getDuration() || 0, c = p.getCurrentTime() || 0;
  paint(c, d); $('#trBuf', tr).style.width = (p.getVideoLoadedFraction() || 0) * 100 + '%';
}
function paint(c, d) {
  const pct = d ? Math.min(100, (c / d) * 100) : 0;
  $('#trFill', tr).style.width = pct + '%'; $('#trKnob', tr).style.left = pct + '%'; $('#trTime', tr).textContent = `${fmtTime(c)} / ${fmtTime(d)}`;
}
function icons() {
  if (!tr) return;
  const playing = T.state === 1 || T.state === 3, p = yt(), muted = p ? p.isMuted() : false;
  $('#trPlay', tr).innerHTML = icon(playing ? 'pause' : 'play');
  $('#trMute', tr).innerHTML = muted ? '<svg class="i" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6M21 9l-4 6"/></svg>' : '<svg class="i" viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/></svg>';
}
function pulse(name) { const el = $('#trPulse', tr); el.innerHTML = icon(name); el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); }
function toggle() { const p = yt(); if (!p) return; if (T.state === 1 || T.state === 3) { p.pauseVideo(); pulse('pause'); } else { p.playVideo(); pulse('play'); } }
function wake() { tr.classList.remove('idle'); clearTimeout(T.idle); T.idle = setTimeout(() => { if (T.state === 1 && !T.dragging) tr.classList.add('idle'); }, 2800); }
const fs = () => (document.fullscreenElement ? document.exitFullscreen() : tr.requestFullscreen?.().catch(() => {}));

function bind() {
  $('#trBack', tr).onclick = closeTrailer;
  $('#trPlay', tr).onclick = toggle; $('#trHit', tr).onclick = toggle; $('#trHit', tr).ondblclick = fs;
  $('#trMute', tr).onclick = () => { const p = yt(); if (!p) return; p.isMuted() ? p.unMute() : p.mute(); icons(); };
  $('#trFs', tr).onclick = fs;
  $('#trWatch', tr)?.addEventListener('click', () => { const cb = T.onPlay; closeTrailer(); setTimeout(cb, 350); });
  tr.querySelectorAll('.tr-chip').forEach((b) => (b.onclick = () => { tr.querySelectorAll('.tr-chip').forEach((x) => x.classList.toggle('on', x === b)); mount(+b.dataset.i); }));
  const scrub = $('#trScrub', tr), tip = $('#trTip', tr);
  const at = (e) => { const r = $('.wp-track', tr).getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  const place = (e) => { const r = scrub.getBoundingClientRect(), f = at(e), w = tip.offsetWidth || 60; tip.querySelector('span').textContent = fmtTime(f * (yt()?.getDuration() || 0)); tip.style.left = Math.min(r.width - w / 2 - 4, Math.max(w / 2 + 4, f * r.width)) + 'px'; };
  scrub.addEventListener('pointerdown', (e) => { T.dragging = true; try { scrub.setPointerCapture(e.pointerId); } catch {} place(e); paint(at(e) * (yt()?.getDuration() || 0), yt()?.getDuration() || 0); });
  scrub.addEventListener('pointermove', (e) => { place(e); if (T.dragging) paint(at(e) * (yt()?.getDuration() || 0), yt()?.getDuration() || 0); });
  scrub.addEventListener('pointerup', (e) => { if (!T.dragging) return; T.dragging = false; const d = yt()?.getDuration() || 0; yt()?.seekTo(at(e) * d, true); });
  tr.addEventListener('pointermove', wake);
}

function onKey(e) {
  if (!tr) return; const p = yt(), k = e.key; let used = true;
  if (k === ' ' || k === 'k') toggle();
  else if (k === 'ArrowLeft' || k === 'j') p?.seekTo(Math.max(0, p.getCurrentTime() - 5), true);
  else if (k === 'ArrowRight' || k === 'l') p?.seekTo(p.getCurrentTime() + 5, true);
  else if (k === 'm') { p && (p.isMuted() ? p.unMute() : p.mute()); icons(); }
  else if (k === 'f') fs();
  else if (k === 'Escape') { if (!document.fullscreenElement) closeTrailer(); else used = false; }
  else used = false;
  if (used) { e.preventDefault(); e.stopPropagation(); wake(); }
}

export function closeTrailer() {
  if (!tr) return;
  clearInterval(T.timer); clearTimeout(T.idle); document.removeEventListener('keydown', onKey, true);
  try { T.yt?.getVolume && localStorage.setItem('tr-vol', T.yt.getVolume()); T.yt?.destroy(); } catch {}
  const el = tr; tr = null; T = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  el.classList.remove('in'); setTimeout(() => el.remove(), 500);
}
