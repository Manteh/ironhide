// Synced playback for rooms. Everyone loads their own copy; the host's play/pause/seek is applied
// to every player on a shared server clock, and small drift is corrected continuously.
import { esc, icon, avatar, toast, $, $$ } from './ui.js';
import { social, onState, onEvent, sapi, serverNow, canControl, isHost } from './social.js';
import { mountChat, floatEmoji } from './chat.js';

export async function joinRoomPlayback() {
  const r = social.state?.room, m = r?.media;
  if (!m) return toast('Nothing has been picked yet', 'err');
  const { playWeb } = await import('./main.js');
  // start where the room is paused (not at the beginning, not at this person's own history)
  const pb = r.pb, at = pb?.playing ? (pb.pos + Math.max(0, serverNow() - pb.at) / 1000 * (pb.rate || 1)) : (pb?.pos || 0);
  playWeb({ imdbId: m.imdbId, type: m.type, title: m.title, poster: m.poster, season: m.season, episode: m.episode, roomStart: Math.max(0, Math.floor(at)), room: true });
}

// Called by the player once its DOM and stream are up.
export function attachRoom(P) {
  const root = P.root();
  root.classList.add('wp-roomed');
  const left = [];
  const on = (off) => left.push(off);

  // --- drawer: members + chat + reactions ---
  const drawer = document.createElement('aside');
  drawer.className = 'wp-drawer';
  drawer.innerHTML = `<div class="dw-head"><b id="dwName">Room</b><button class="wp-btn ic" id="dwClose" aria-label="Hide chat">${icon('x')}</button></div><div class="dw-mem" id="dwMem"></div><div class="dw-chat" id="dwChat"></div>`;
  const layer = document.createElement('div'); layer.className = 'rx-layer big';
  const count = document.createElement('div'); count.className = 'wp-count hidden';
  root.append(drawer, layer, count);
  const btn = document.createElement('button');
  btn.className = 'wp-btn'; btn.id = 'wpRoom'; btn.innerHTML = `${icon('users')}<span>Room</span><em id="wpRoomN"></em>`;
  $('.wp-r', root).prepend(btn);
  btn.onclick = () => drawer.classList.toggle('open');
  $('#dwClose', drawer).onclick = () => drawer.classList.remove('open');
  const unChat = mountChat($('#dwChat', drawer), { compact: true });

  // --- membership / readiness UI ---
  let lastMedia = '';
  on(onState((s) => {
    const r = s.room; if (!r) { if (Date.now() - (social.lastKick || 0) > 4000) toast('You left the room'); P.close(); return; }
    $('#dwName', drawer).textContent = r.name;
    $('#wpRoomN', root).textContent = r.members.length;
    $('#dwMem', drawer).innerHTML = r.members.map((u) => `<span class="dmb ${u.ready ? 'ready' : ''}" title="${esc(u.name)}${u.ready ? ' · ready' : ' · loading'}">${avatar({ avatar: u.avatar }, 30)}<i></i>${(r.host === s.you?.id || r.owner === s.you?.id) && u.id !== r.owner && u.id !== s.you?.id ? `<button class="dmb-x" data-kick="${u.id}" data-kname="${esc(u.name)}" aria-label="Remove ${esc(u.name)}" title="Remove ${esc(u.name)}">${icon('x')}</button>` : ''}</span>`).join('');
    $$('[data-kick]', drawer).forEach((b) => (b.onclick = () => { if (confirm(`Remove ${b.dataset.kname} from the room?`)) sapi('/room/kick', { id: b.dataset.kick }); }));
    root.classList.toggle('locked', !canControl());
    const key = r.media ? `${r.media.imdbId}:${r.media.season}:${r.media.episode}` : '';
    if (lastMedia && key && key !== lastMedia) toast(`${r.host === s.you?.id || r.owner === s.you?.id ? 'You' : 'The host'} picked ${r.media.title}. Reopen the player from Together to switch.`);
    lastMedia = key;
  }));
  on(onEvent((ev, d) => { if (ev === 'react') floatEmoji(layer, d.emoji, d.from?.name, d.x); if (ev === 'pb') applyPb(d.pb); }));

  // --- control (host / allowed members) ---
  P.hooks.onToggle = (playing) => {
    if (!canControl()) return toast('Only the host controls playback in this room');
    if (playing) { P.video().pause(); sapi('/room/control', { action: 'pause', pos: P.cur() }); }
    else sapi('/room/control', { action: 'play', pos: P.cur(), scheduled: true });
  };
  P.hooks.onSeek = (t) => {
    if (!canControl()) return toast('Only the host controls playback in this room');
    P.seek(t); sapi('/room/control', { action: 'seek', pos: t });
  };

  // --- apply the room's playback state ---
  let startT = 0, readySent = false;
  const target = (pb) => (pb.playing ? pb.pos + Math.max(0, serverNow() - pb.at) / 1000 * pb.rate : pb.pos);
  function applyPb(pb) {
    const v = P.video(); if (!v || !pb) return;
    clearTimeout(startT); count.classList.add('hidden');
    v.playbackRate = pb.rate || 1;
    if (!pb.playing) { v.pause(); if (Math.abs(P.cur() - pb.pos) > 0.4) P.seek(pb.pos); return; }
    const wait = pb.at - serverNow();
    if (wait > 60) {
      v.pause(); if (Math.abs(P.cur() - pb.pos) > 0.4) P.seek(pb.pos);
      let remain = Math.ceil(wait / 1000); count.textContent = remain; count.classList.remove('hidden');
      const tick = setInterval(() => { remain = Math.max(0, Math.ceil((pb.at - serverNow()) / 1000)); count.textContent = remain || ''; if (remain <= 0) clearInterval(tick); }, 200);
      startT = setTimeout(() => { clearInterval(tick); count.classList.add('hidden'); v.play().catch(() => {}); }, wait);
    } else {
      const t = target(pb); if (Math.abs(P.cur() - t) > 1) P.seek(t);
      v.play().catch(() => {});
    }
  }
  // late joiners and reloads: adopt whatever the room is doing now
  setTimeout(() => { const pb = social.state?.room?.pb; if (pb) applyPb(pb); }, 600);

  // --- keep drifting players aligned ---
  const drift = setInterval(() => {
    const pb = social.state?.room?.pb, v = P.video(); if (!pb || !pb.playing || !v || v.paused || pb.at > serverNow()) return;
    const d = P.cur() - target(pb);
    if (Math.abs(d) > 1.2) { P.seek(target(pb)); v.playbackRate = pb.rate || 1; }
    else if (Math.abs(d) > 0.2) v.playbackRate = (pb.rate || 1) * (1 - Math.max(-0.06, Math.min(0.06, d * 0.08))); // ease back instead of jumping
    else v.playbackRate = pb.rate || 1;
  }, 1500);

  // --- tell the room when our copy is loaded enough to start ---
  const ready = () => {
    const v = P.video(); if (!v) return;
    const ahead = v.buffered.length ? v.buffered.end(v.buffered.length - 1) - v.currentTime : 0;
    const ok = v.readyState >= 3 && ahead >= 6;
    if (ok !== readySent) { readySent = ok; sapi('/room/ready', { ready: ok }); }
  };
  const chk = setInterval(ready, 700);

  // --- tell the room what this player is doing (watching, paused, buffering, tabbed out) and where it is ---
  // The relay uses this to pause the whole room at the right spot when the last player closes.
  let lastPos = 0;
  const stateNow = () => {
    const v = P.video(); if (!v) return 'idle';
    if (document.hidden) return 'away';
    if (!readySent && v.readyState < 3) return 'loading';
    if (v.readyState < 3 && !v.paused) return 'buffering';
    return v.paused ? 'paused' : 'playing';
  };
  const report = () => { lastPos = P.cur() || lastPos; sapi('/room/state', { state: stateNow(), pos: lastPos }).catch(() => {}); };
  const rep = setInterval(report, 2000);
  const vEl = P.video(); const instant = ['play', 'pause', 'waiting', 'playing', 'seeked', 'canplay']; instant.forEach((e) => vEl?.addEventListener(e, report));
  document.addEventListener('visibilitychange', report);
  const bye = () => { try { fetch('/api/social/room/state', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'idle', pos: lastPos }) }); } catch {} };
  addEventListener('pagehide', bye);
  report();

  return () => {
    clearTimeout(startT); clearInterval(drift); clearInterval(chk); clearInterval(rep); left.forEach((f) => f()); unChat();
    instant.forEach((e) => vEl?.removeEventListener(e, report)); document.removeEventListener('visibilitychange', report); removeEventListener('pagehide', bye); bye(); // player closed: say so, with the last position
    P.hooks.onToggle = null; P.hooks.onSeek = null;
    sapi('/room/ready', { ready: false }).catch(() => {});
    drawer.remove(); layer.remove(); count.remove(); btn.remove(); root.classList.remove('wp-roomed', 'locked');
  };
}
