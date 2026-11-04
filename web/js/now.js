// Now Playing: a companion screen in the web app while mpv is open (remote, scrubber, tracks).
import { api, post } from './api.js';
import { $, $$, esc, icon, pad, fmtTime, posterOf, toast } from './ui.js';

let box, timer, dragging = false, ended = 0;

const ctl = (action, value) => post('/api/control', { action, value }).then(poll).catch((e) => toast(e.message, 'err'));

export function isNowOpen() { return !!box; }

export function openNow() {
  if (box) return;
  box = document.createElement('div');
  box.className = 'nowv';
  box.innerHTML = `<div class="nbg"></div><div class="nshade"></div>
    <button class="nclose" aria-label="Hide now playing">${icon('x')}</button>
    <div class="nmain">
      <div class="nposter"></div>
      <div class="ninfo">
        <div class="nkick"><span class="dot online"></span> Now playing on this Mac</div>
        <h2 id="nTitle">Loading…</h2><div class="nsub" id="nSub"></div>
        <div class="nscrub" id="nScrub" role="slider" aria-label="Seek" tabindex="0"><div class="ntrack"><i id="nFill"></i><b id="nKnob"></b></div>
          <div class="ntimes"><span id="nPos">0:00</span><span id="nLeft"></span></div></div>
        <div class="nctl">
          <button class="nb" data-a="back" aria-label="Back 30 seconds">${icon('back')}</button>
          <button class="nb big" data-a="toggle" id="nToggle" aria-label="Play or pause">${icon('pause')}</button>
          <button class="nb" data-a="fwd" aria-label="Forward 30 seconds">${icon('fwd')}</button>
          <button class="nb stop" data-a="stop" aria-label="Stop">${icon('stop')}</button>
        </div>
        <div class="nopts">
          <label>Audio<select class="sel" id="nAudio"></select></label>
          <label>Subtitles<select class="sel" id="nSubs"></select></label>
          <label>Volume<input type="range" id="nVol" min="0" max="130" value="100"></label>
        </div>
      </div></div>`;
  document.body.appendChild(box);
  requestAnimationFrame(() => box.classList.add('in'));
  $('.nclose', box).onclick = closeNow;
  $$('[data-a]', box).forEach((b) => (b.onclick = () => ({ back: () => ctl('seek_back', 30), fwd: () => ctl('seek_forward', 30), toggle: () => ctl('toggle'), stop: () => ctl('stop') })[b.dataset.a]()));
  const scrub = $('#nScrub', box);
  const seekTo = (e) => { const r = $('.ntrack', box).getBoundingClientRect(); const pct = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)); $('#nFill', box).style.width = pct + '%'; $('#nKnob', box).style.left = pct + '%'; return pct; };
  scrub.addEventListener('pointerdown', (e) => { dragging = true; scrub.setPointerCapture(e.pointerId); seekTo(e); });
  scrub.addEventListener('pointermove', (e) => { if (dragging) seekTo(e); });
  scrub.addEventListener('pointerup', (e) => { if (!dragging) return; dragging = false; ctl('seek_percent', seekTo(e)); });
  scrub.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') ctl('seek_back', 10); if (e.key === 'ArrowRight') ctl('seek_forward', 10); });
  $('#nAudio', box).onchange = (e) => ctl('audio_track', +e.target.value);
  $('#nSubs', box).onchange = (e) => (e.target.value === 'off' ? ctl('subtitles_off') : ctl('subtitle_track', +e.target.value));
  $('#nVol', box).oninput = (e) => post('/api/control', { action: 'volume_set', value: +e.target.value });
  document.addEventListener('keydown', onKey);
  ended = 0; poll(); timer = setInterval(poll, 1000);
}

function onKey(e) { if (e.key === 'Escape' && box) closeNow(); if (e.key === ' ' && box && !/INPUT|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); ctl('toggle'); } }

export function closeNow() {
  if (!box) return;
  clearInterval(timer); document.removeEventListener('keydown', onKey);
  const b = box; box = null; b.classList.remove('in'); setTimeout(() => b.remove(), 600);
}

let lastPoster = '';
async function poll() {
  if (!box) return;
  let np = null;
  try { np = await api('/api/nowplaying'); } catch { return; }
  if (!box) return;
  if (!np) {
    if (++ended >= 3) { $('#nTitle', box).textContent = 'Playback ended'; $('#nSub', box).textContent = ''; setTimeout(closeNow, 1400); clearInterval(timer); }
    return;
  }
  ended = 0;
  const m = np.meta || {};
  const ep = m.season ? `S${pad(m.season)}E${pad(m.episode)}` : '';
  $('#nTitle', box).textContent = m.title || np.title;
  $('#nSub', box).textContent = [ep, np.fullscreen ? 'Fullscreen' : 'Windowed', np.speed && np.speed !== 1 ? `${np.speed}x` : ''].filter(Boolean).join(' · ');
  const poster = m.imdbId ? posterOf(m.imdbId) : '';
  if (poster && poster !== lastPoster) {
    lastPoster = poster;
    $('.nposter', box).style.backgroundImage = `url('${poster}')`; $('.nbg', box).style.backgroundImage = `url('${poster}')`;
  }
  $('#nToggle', box).innerHTML = icon(np.playing ? 'pause' : 'play');
  if (!dragging) { $('#nFill', box).style.width = (np.percent || 0) + '%'; $('#nKnob', box).style.left = (np.percent || 0) + '%'; }
  $('#nPos', box).textContent = fmtTime(np.position);
  $('#nLeft', box).textContent = np.duration ? `-${fmtTime(np.duration - np.position)}` : '';
  const aSel = $('#nAudio', box), sSel = $('#nSubs', box);
  const aHtml = (np.audioTracks || []).map((t) => `<option value="${t.id}" ${t.selected ? 'selected' : ''}>${esc([t.language, t.codec, t.channels ? t.channels + 'ch' : ''].filter(Boolean).join(' · ') || 'Track ' + t.id)}</option>`).join('');
  const sHtml = `<option value="off" ${(np.subTracks || []).some((t) => t.selected) ? '' : 'selected'}>Off</option>` + (np.subTracks || []).map((t) => `<option value="${t.id}" ${t.selected ? 'selected' : ''}>${esc([t.language, t.title].filter(Boolean).join(' · ') || 'Track ' + t.id)}</option>`).join('');
  if (document.activeElement !== aSel && aSel.innerHTML !== aHtml) aSel.innerHTML = aHtml;
  if (document.activeElement !== sSel && sSel.innerHTML !== sHtml) sSel.innerHTML = sHtml;
  const vol = $('#nVol', box); if (document.activeElement !== vol) vol.value = np.volume ?? 100;
}
