// Watching together. Everyone plays the same release from their own debrid account; the relay runs one shared clock.
//   Pick a title  -> every member's player opens by itself and buffers.
//   Press play    -> the room goes through a ready gate: nobody starts until all have buffered (or time runs out),
//                    then everyone starts the same frame at the same shared instant.
//   While playing -> tiny speed changes remove drift; a viewer who falls far behind jumps ahead to a keyframe and waits for the clock.
// Moves inside what a player has buffered are instant; anything further is a stream restart on a keyframe.
import { esc, icon, avatar, toast, $ } from './ui.js';
import { social, onState, onEvent, sapi, serverNow, canControl, sendCursor } from './social.js';
import { mountChat, floatEmoji } from './chat.js';
import { isPlayerOpen, playerKey, closePlayer, isRoomAttached, reattachRoom, unparkPlayer, parkPlayer, isParked, detachRoom } from './player.js';

const PREBUFFER = 20;      // seconds buffered before a viewer counts as ready
const NEAR = 0.3;          // close enough to start without restarting the stream
const JUMP_AT = 2;         // further than this from the room: restart ahead of it
const RESTART_GAP = 6000;  // never restart more often than this
const mediaKey = (r) => (r?.media ? `${r.media.imdbId}:${r.media.season || 0}:${r.media.episode || 0}` : '');
const target = (pb) => (pb.playing ? pb.pos + Math.max(0, serverNow() - pb.at) / 1000 * (pb.rate || 1) : pb.pos);
const runsRoom = (r, s) => r.host === s.you?.id || r.owner === s.you?.id;

// ---------- chimes ----------
// Two soft notes made in the browser: rising when someone arrives, falling when someone goes.
let audio = null;
const soundsOn = () => localStorage.getItem('rm-sounds') !== '0';
function chime(up) {
  if (!soundsOn()) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const t0 = audio.currentTime + 0.01;
    (up ? [523.25, 783.99] : [659.25, 440]).forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = t0 + i * 0.13;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.36);
    });
  } catch {}
}

// ---------- opening by itself ----------
let opening = false, dismissed = '', leftTimer = 0, leftKey = '';
async function openFor(r) {
  if (opening) return; opening = true;
  try {
    const { playWeb } = await import('./main.js'), m = r.media, at = target(r.gate ? { playing: false, pos: r.gate.pos } : r.pb);
    await playWeb({ imdbId: m.imdbId, type: m.type, title: m.title, poster: m.poster, season: m.season, episode: m.episode, roomStart: Math.max(0, at), room: true, ...(m.pin ? { pin: m.pin } : {}) });
  } finally { opening = false; }
}
export async function joinRoomPlayback() {
  const r = social.state?.room; if (!r?.media) return toast('Nothing has been picked yet', 'err');
  dismissed = '';
  if (!leader) { holdPlayer(true); return; } // take the room over from the other tab; opening follows
  if (isPlayerOpen() && playerKey() === mediaKey(r)) return unparkPlayer();
  openFor(r);
}
// One person = one player. With several tabs open on the same IronHide, only one runs the room player;
// otherwise each would report its own state and they would fight (paused / tabbed out / paused...).
// The others wait in line and take over if that tab closes, or right away when you press "Open the player" there.
const LOCK = 'ironhide-room-player';
let leader = !navigator.locks; // no Web Locks support: behave as before
function holdPlayer(steal = false) {
  if (!navigator.locks) return;
  navigator.locks.request(LOCK, steal ? { steal: true } : {}, () => new Promise(() => { leader = true; const s = social.state; if (s) social.states.forEach((f) => f(s)); }))
    .catch(() => { // another tab took over
      leader = false;
      if (isPlayerOpen() && isRoomAttached()) { closePlayer(); toast('The room moved to another tab'); }
      holdPlayer();
    });
}

let watching = false;
export function watchRoom() {
  if (watching) return; watching = true;
  holdPlayer();
  onState((s) => {
    const r = s.room;
    if (!r || !leader) return;
    clearTimeout(leftTimer); // back in a room: nothing to expire
    const key = mediaKey(r);
    if (!r.media) { if (isPlayerOpen() && isRoomAttached()) closePlayer(); return; }
    if (isPlayerOpen()) {
      if (playerKey() !== key) { closePlayer(); return; }           // the owner picked something else; the next update reopens
      if (!isRoomAttached()) { const again = leftKey === key; leftKey = ''; reattachRoom(); if (again) unparkPlayer(); } // came back: no reload at all
      return;
    }
    if (dismissed === key || opening) return;
    if (r.media.pin || runsRoom(r, s)) openFor(r); // members wait for the owner's copy to choose the exact release
  });
}

// ---------- attached to a player ----------
export function attachRoom(P) {
  const root = P.root(), info = P.info();
  root.classList.add('wp-roomed');
  const off = []; const on = (f) => off.push(f);
  P.hooks.onDismiss = () => { dismissed = mediaKey(social.state?.room); };

  // the owner's copy decides the release everyone plays; tell anyone who could not get it
  { const r = social.state?.room, s = social.state;
    if (r && !r.media?.pin && runsRoom(r, s) && info.pin) sapi('/room/pin', { key: info.pin, label: info.quality || '' }).catch(() => {});
    if (info.pinned === false) toast('You could not get the same version as the room, so sync may be off', 'err'); }

  // ---------- overlay ----------
  const panel = document.createElement('aside'); panel.className = 'rm-panel';
  panel.innerHTML = `<div class="rm-head"><div><b id="rmName"></b><button class="rm-code" id="rmCode" title="Copy room code"></button></div><button class="wp-btn ic" id="rmClose" aria-label="Hide room panel">${icon('x')}</button></div>
    <div class="rm-sec"><div class="rm-k" id="rmCountK">Watching</div><div id="rmMem" class="rm-mem"></div></div>
    <div class="rm-sec" id="rmOwner"></div>
    <div class="rm-chat" id="rmChat"></div>`;
  const gateEl = document.createElement('div'); gateEl.className = 'rm-gate hidden';
  const notes = document.createElement('div'); notes.className = 'rm-notes'; notes.setAttribute('aria-live', 'polite');
  const count = document.createElement('div'); count.className = 'wp-count hidden';
  const layer = document.createElement('div'); layer.className = 'rx-layer big';
  const cursors = document.createElement('div'); cursors.className = 'rm-cursors';
  const soundBtn = document.createElement('button'); soundBtn.className = 'rm-sound hidden'; soundBtn.innerHTML = `${icon('bolt')} Tap for sound`;
  const rxBar = document.createElement('div'); rxBar.className = 'rm-rx';
  rxBar.innerHTML = (social.state?.reactions || []).map((e) => `<button data-rx="${e}" aria-label="React ${e}">${e}</button>`).join('');
  root.append(panel, gateEl, notes, count, layer, cursors, soundBtn);
  $('.wp-bottom', root).prepend(rxBar);
  const pill = document.createElement('button'); pill.className = 'rm-pill'; pill.title = 'Show who is watching'; $('.wp-top', root).insertBefore(pill, $('#wpBadges', root));
  const btn = document.createElement('button'); btn.className = 'wp-btn'; btn.id = 'wpRoom'; btn.innerHTML = `${icon('users')}<span>Room</span><em id="wpRoomN"></em>`;
  $('.wp-r', root).prepend(btn);
  const setPanel = (open) => { root.classList.toggle('rm-open', open); localStorage.setItem('rm-panel', open ? '1' : '0'); };
  setPanel(localStorage.getItem('rm-panel') !== '0');
  btn.onclick = pill.onclick = () => setPanel(!root.classList.contains('rm-open'));
  $('#rmClose', panel).onclick = () => setPanel(false);
  $('#rmCode', panel).onclick = () => navigator.clipboard?.writeText(social.state?.room?.code || '').then(() => toast('Room code copied', 'ok'));
  rxBar.addEventListener('click', (e) => { const b = e.target.closest('[data-rx]'); if (b) sapi('/react', { emoji: b.dataset.rx }); });
  const unChat = mountChat($('#rmChat', panel), { compact: true });

  // Panel buttons survive repainting because the clicks are handled here
  panel.addEventListener('click', (e) => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    const d = b.dataset, r = social.state?.room; if (!r) return;
    if (d.do === 'kick') { if (confirm(`Remove ${d.name} from the room? They will not be able to rejoin it.`)) sapi('/room/kick', { id: d.id }); }
    if (d.do === 'own') { if (confirm(`Make ${d.name} the owner of this room? You will lose owner control.`)) sapi('/room/transfer', { id: d.id }); }
    if (d.do === 'sync') sapi('/room/control', { action: 'seek', pos: P.cur() });
    if (d.do === 'resync') { reconcile(true); toast('Lining you up with the room'); }
    if (d.do === 'toggle') P.hooks.onToggle?.(!P.video().paused);
    if (d.do === 'wait') sapi('/room/settings', { wait: r.wait === false });
    if (d.do === 'ctl') sapi('/room/settings', { control: r.control === 'all' ? 'host' : 'all' });
    if (d.do === 'open') sapi('/room/settings', { open: r.open === false });
    if (d.do === 'sounds') { localStorage.setItem('rm-sounds', soundsOn() ? '0' : '1'); paint(social.state); if (soundsOn()) chime(true); }
    if (d.do === 'cursors') { localStorage.setItem('rm-cursors', showCursors() ? '0' : '1'); if (!showCursors()) { cursors.innerHTML = ''; seen.clear(); sendCursor(0, 0, true); } paint(social.state); }
  });
  gateEl.addEventListener('click', (e) => { const b = e.target.closest('[data-do]'); if (!b) return; if (b.dataset.do === 'start') sapi('/room/control', { action: 'start', pos: P.cur() }); if (b.dataset.do === 'play') P.hooks.onToggle?.(false); });

  // ---------- control: the owner (or everyone, if allowed) ----------
  P.hooks.onToggle = (playing) => {
    if (!canControl()) return toast('The room owner controls playback');
    if (playing) { P.video().pause(); sapi('/room/control', { action: 'pause', pos: P.cur() }); }
    else sapi('/room/control', { action: 'play', pos: P.cur() });
  };
  P.hooks.onSeek = async (t) => {
    if (!canControl()) return toast('The room owner controls playback');
    // land on a real keyframe: with the same file, every viewer restarts on exactly this frame
    let pos = t; try { pos = (await P.keyframes(t)).prev; } catch {}
    sapi('/room/control', { action: 'seek', pos });
  };

  // ---------- starting without being blocked ----------
  const play = (v) => v.play().catch((e) => {
    if (e?.name !== 'NotAllowedError') return;
    v.muted = true; v.play().catch(() => {}); soundBtn.classList.remove('hidden'); // browsers block sound until you click once
  });
  const unmute = () => { const v = P.video(); if (v && !soundBtn.classList.contains('hidden')) { v.muted = false; soundBtn.classList.add('hidden'); } };
  soundBtn.onclick = unmute; addEventListener('pointerdown', unmute);

  // ---------- following the room ----------
  let tok = 0, startT = 0, tick = 0, lastRestart = 0, catching = false, loadedAt = 0, sig = '';
  const ahead = (v) => { for (let i = v.buffered.length - 1; i >= 0; i--) if (v.currentTime >= v.buffered.start(i) - 0.5) return Math.max(0, v.buffered.end(i) - v.currentTime); return 0; };
  const hideCount = () => { clearInterval(tick); count.classList.add('hidden'); };
  const waitPlayable = (my, ms = 12000) => new Promise((res) => { const end = Date.now() + ms; const t = setInterval(() => { const v = P.video(); if (my !== tok || !v) { clearInterval(t); return res(false); } if (v.readyState >= 3 || Date.now() > end) { clearInterval(t); res(v.readyState >= 3); } }, 50); });
  // Be on `pos`: stay if already there, otherwise restart on the keyframe at or just after it
  async function place(pos, my) {
    if (P.hasStream() && Math.abs(P.cur() - pos) <= NEAR) return true;
    if (P.jump(pos)) return true; // already buffered: instant, no restart
    let K = pos; try { const kf = await P.keyframes(pos); K = Math.abs(kf.prev - pos) < 0.05 ? kf.prev : kf.next; } catch {}
    if (my !== tok) return false;
    P.load(K, false); loadedAt = Date.now(); lastRestart = Date.now();
    return waitPlayable(my);
  }
  // Start at the shared instant the room's clock reaches where this player is standing
  function startAligned(pb, my) {
    const v = P.video(), rate = pb.rate || 1, c = P.cur();
    const wall = pb.at + Math.max(0, c - pb.pos) / rate * 1000;
    const go = () => { if (my !== tok) return; hideCount(); catching = false; v.playbackRate = rate; play(v); };
    const wait = wall - serverNow();
    if (wait <= 15) return go();
    v.pause(); v.playbackRate = rate;
    count.textContent = Math.max(1, Math.ceil(wait / 1000)); count.classList.remove('hidden');
    clearInterval(tick); tick = setInterval(() => { const left = Math.ceil((wall - serverNow()) / 1000); if (left > 0) count.textContent = left; }, 150);
    clearTimeout(startT);
    startT = setTimeout(() => { const spin = () => { if (my !== tok) return; if (serverNow() >= wall) go(); else requestAnimationFrame(spin); }; if (document.hidden) { go(); } else spin(); }, Math.max(0, wait - 40));
  }
  async function reconcile(force = false) {
    const r = social.state?.room, v = P.video(); if (!r || !v) return;
    const my = ++tok, pb = r.pb; clearTimeout(startT); hideCount();
    if (r.gate) { v.pause(); await place(r.gate.pos, my); return; }                 // the ready loop below reports when buffered
    if (!pb.playing) { v.pause(); await place(pb.pos, my); return; }
    const rate = pb.rate || 1;
    if (!force && !v.paused && Math.abs(P.cur() - target(pb)) < JUMP_AT) return;    // already moving with the room: drift control has it
    let spare = 3;
    for (let tries = 0; tries < 3; tries++) {
      if (P.jump(target(pb) + 0.4)) break;                                          // we already hold that spot: be there instantly
      const t = target(pb), c = P.cur();
      if (P.hasStream() && c - t >= -NEAR && c - t < 12) break;                     // on the spot or a little ahead: just wait for the clock
      catching = true;
      const want = Math.max(pb.pos, t + spare * rate);                              // aim past where the room will be once this has loaded
      let K = want; try { K = (await P.keyframes(want)).next; } catch {}
      if (my !== tok) return;
      P.load(K, false); loadedAt = Date.now(); lastRestart = Date.now();
      await waitPlayable(my); if (my !== tok) return;
      spare *= 2;                                                                   // too slow? aim further next time
    }
    startAligned(pb, my);
  }

  // ---------- drift control ----------
  const drift = setInterval(() => {
    const pb = social.state?.room?.pb, v = P.video(); if (!pb || !v || !pb.playing || v.paused || catching || pb.at > serverNow()) return;
    const d = P.cur() - target(pb), rate = pb.rate || 1;
    if (Math.abs(d) > JUMP_AT && Date.now() - lastRestart > RESTART_GAP) { reconcile(true); return; }
    v.playbackRate = Math.abs(d) > 0.03 ? rate * (1 - Math.max(-0.1, Math.min(0.1, d * 0.9))) : rate;   // inaudible below about 10 %
  }, 200);

  // ---------- telling the room how we are doing ----------
  let readySent = null;
  const ready = () => {
    const v = P.video(), r = social.state?.room; if (!v || !r) return;
    const want = r.gate ? r.gate.pos : r.pb.pos, a = ahead(v), since = Date.now() - loadedAt;
    const there = P.hasStream() && P.cur() >= want - NEAR;
    const ok = there && v.readyState >= 3 && (a >= PREBUFFER || (since > 6000 && a >= 3) || v.ended);
    const mark = `${ok}:${r.gate?.token || 0}`;
    if (mark !== readySent) { readySent = mark; sapi('/room/ready', { ready: ok, token: r.gate?.token }).catch(() => {}); }
  };
  const readyT = setInterval(ready, 300);
  let lastPos = 0;
  const stateNow = () => {
    const v = P.video(); if (!v) return 'idle';
    if (!v.paused && v.readyState < 3) return 'buffering';
    if (!P.hasStream() || v.readyState < 2) return 'loading';
    if (P.parked()) return 'lobby';
    if (document.hidden) return 'away';
    return v.paused ? 'paused' : 'playing';
  };
  const report = () => { const v = P.video(); if (!v) return; lastPos = P.cur() || lastPos; sapi('/room/state', { state: stateNow(), pos: lastPos, buf: +ahead(v).toFixed(1), tc: serverNow() }).catch(() => {}); };
  const rep = setInterval(report, 1000);
  const vEl = P.video(), instant = ['play', 'pause', 'waiting', 'playing', 'canplay'];
  instant.forEach((e) => vEl.addEventListener(e, report));
  document.addEventListener('visibilitychange', report);
  const bye = () => { try { fetch('/api/social/room/state', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'idle', pos: lastPos }) }); } catch {} };
  addEventListener('pagehide', bye);

  // ---------- painting ----------
  const LABEL = { playing: 'Watching', paused: 'Paused', buffering: 'Buffering', loading: 'Loading', away: 'Tabbed out', lobby: 'In the lobby', idle: 'Not watching' };
  const driftOf = (u, pb) => {
    const st = u.st; if (!st || st.state !== 'playing' || !pb.playing || Date.now() + 0 - st.at > 5000 || st.tc < pb.at) return null;
    return (st.pos - (pb.pos + (st.tc - pb.at) / 1000 * (pb.rate || 1))) * 1000;
  };
  const showCursors = () => localStorage.getItem('rm-cursors') !== '0';
  const sw = (id, label, val, hint = '') => `<button class="rm-sw" data-do="${id}" title="${esc(hint)}"><span>${esc(label)}</span><i class="${val ? 'on' : ''}"></i></button>`;
  function paint(s) {
    const r = s?.room; if (!r) return;
    const me = s.you?.id, runs = runsRoom(r, s), pb = r.pb;
    $('#rmName', panel).textContent = r.name; $('#rmCode', panel).textContent = r.code; $('#wpRoomN', root).textContent = r.members.length;
    root.classList.toggle('locked', !canControl());
    const drifts = r.members.map((u) => ({ u, d: driftOf(u, pb) }));
    $('#rmCountK', panel).textContent = `Watching · ${r.members.length}`;
    $('#rmMem', panel).innerHTML = drifts.map(({ u, d }) => {
      const st = u.st?.state || (u.ready ? 'paused' : 'loading'), buf = u.st?.buf;
      const ds = d == null ? '' : Math.abs(d) < 50 ? 'in sync' : `${d > 0 ? '+' : '−'}${Math.abs(d) < 1000 ? Math.round(Math.abs(d)) + ' ms' : (Math.abs(d) / 1000).toFixed(1) + ' s'}`;
      return `<div class="rm-m ${esc(st)}"><span class="rm-av">${avatar({ avatar: u.avatar }, 34)}</span><div class="rm-mi"><b>${esc(u.name)}${u.id === me ? ' <small>you</small>' : ''}${u.id === r.owner ? '<em>owner</em>' : u.id === r.host ? '<em>host</em>' : ''}</b>
        <span><i class="rm-dot"></i>${LABEL[st] || st}${ds ? ` · <span class="rm-d ${d != null && Math.abs(d) > 500 ? 'bad' : d != null && Math.abs(d) > 120 ? 'warn' : 'ok'}">${ds}</span>` : ''}${buf != null ? ` · ${Math.round(buf)} s buffered` : ''}</span></div>
        ${runs && u.id !== me && u.id !== r.owner ? `<div class="rm-acts">${r.owner === me ? `<button class="wp-btn ic" data-do="own" data-id="${u.id}" data-name="${esc(u.name)}" title="Make owner">${icon('crown')}</button>` : ''}<button class="wp-btn ic" data-do="kick" data-id="${u.id}" data-name="${esc(u.name)}" title="Remove from room">${icon('x')}</button></div>` : ''}</div>`;
    }).join('');
    const owner = r.members.find((u) => u.id === r.owner);
    $('#rmOwner', panel).innerHTML = runs
      ? `<div class="rm-k">Room controls</div><div class="rm-btns"><button class="wp-btn" data-do="toggle">${icon(P.video()?.paused ? 'play' : 'pause')}<span>${P.video()?.paused ? 'Play for everyone' : 'Pause for everyone'}</span></button><button class="wp-btn" data-do="sync" title="Everyone restarts on the same frame"><span>Sync everyone</span></button></div>
         ${sw('wait', 'Wait for slow viewers', r.wait !== false, 'Hold the room when someone is stuck buffering')}${sw('ctl', 'Everyone can control', r.control === 'all')}${sw('open', 'Friends can join', r.open !== false)}${sw('cursors', 'Show cursors', showCursors())}${sw('sounds', 'Join and leave sounds', soundsOn())}
         ${r.media?.pinLabel ? `<div class="rm-ver" title="${esc(r.media.pinLabel)}">Version: ${esc(r.media.pinLabel)}</div>` : ''}`
      : `<div class="rm-k">Hosted by ${esc(owner?.name || 'the owner')}</div><div class="rm-btns"><button class="wp-btn" data-do="resync"><span>Sync me</span></button></div>${sw('cursors', 'Show cursors', showCursors())}${sw('sounds', 'Join and leave sounds', soundsOn())}`;
    // health pill
    const worst = drifts.reduce((a, x) => (x.d != null && Math.abs(x.d) > Math.abs(a?.d ?? 0) ? x : a), null);
    const stuck = r.members.filter((u) => u.st?.state === 'buffering').length, away = r.members.filter((u) => u.st?.state === 'away').length;
    let txt, cls;
    if (r.gate) { txt = 'Getting ready'; cls = 'warn'; }
    else if (!pb.playing) { txt = 'Paused'; cls = ''; }
    else if (stuck) { txt = `${stuck} buffering`; cls = 'warn'; }
    else if (worst && Math.abs(worst.d) > 500) { txt = `${worst.u.name} is ${(Math.abs(worst.d) / 1000).toFixed(1)} s ${worst.d > 0 ? 'ahead' : 'behind'}`; cls = 'bad'; }
    else { txt = worst ? `In sync · ${Math.round(Math.abs(worst.d))} ms` : 'In sync'; cls = 'ok'; }
    pill.className = `rm-pill ${cls}`; pill.innerHTML = `${icon('users')}<span>${r.members.length} · ${esc(txt)}${away ? ` · ${away} tabbed out` : ''}</span>`;
    // gate / waiting card
    const before = !r.gate && !pb.playing && pb.pos < 1;
    if (r.gate || before) {
      const readyN = r.members.filter((u) => u.ready).length;
      const title = r.gate ? (r.gate.reason === 'stall' ? `Waiting for ${esc(r.gate.who || 'someone')}` : r.gate.reason === 'seek' ? 'Jumping together' : 'Getting everyone ready') : (runs ? 'Ready when you are' : `Waiting for ${esc(owner?.name || 'the owner')} to start`);
      gateEl.innerHTML = `<h3>${title}</h3><div class="rm-gm">${r.members.map((u) => { const b = Math.min(100, ((u.st?.buf || 0) / PREBUFFER) * 100); return `<div class="${u.ready ? 'on' : ''}" title="${esc(u.name)}"><span class="rm-ring" style="--p:${u.ready ? 100 : b}">${avatar({ avatar: u.avatar }, 40)}</span><small>${esc(u.name)}</small></div>`; }).join('')}</div>
        <p>${readyN} of ${r.members.length} ready</p>${runs ? (r.gate ? '<button class="btn sm" data-do="start">Start now</button>' : `<button class="btn primary" data-do="play">${icon('play')} Play for everyone</button>`) : ''}`;
      gateEl.classList.remove('hidden');
    } else gateEl.classList.add('hidden');
  }

  // ---------- who came and went ----------
  // A small notice over the movie (a toast if the player is in the corner) and a chime.
  const WATCHING = new Set(['playing', 'paused', 'buffering', 'away', 'loading']);
  let known = null;
  const notify = (u, text, up) => {
    chime(up);
    if (P.parked()) return toast(`${u.name} ${text}`);
    const n = document.createElement('div'); n.className = `rm-note ${up ? 'in' : 'out'}`;
    n.innerHTML = `${avatar({ avatar: { ...u.avatar, deco: null, frame: 'none' } }, 26)}<span><b>${esc(u.name)}</b> ${esc(text)}</span>`;
    notes.append(n); setTimeout(() => n.classList.add('bye'), 3600); setTimeout(() => n.remove(), 4000);
  };
  function announce(s) {
    const r = s.room, me = s.you?.id, now = new Map(r.members.map((u) => [u.id, u]));
    if (known) {
      for (const [id, u] of now) {
        if (id === me) continue;
        const was = known.get(id);
        if (!was) { notify(u, 'joined the room', true); continue; }
        const a = was.st?.state, b = u.st?.state;
        if (WATCHING.has(a) && (b === 'lobby' || b === 'idle')) notify(u, b === 'lobby' ? 'went to the lobby' : 'stopped watching', false);
        else if ((a === 'lobby' || a === 'idle') && WATCHING.has(b)) notify(u, 'is back', true);
      }
      for (const [id, u] of known) if (id !== me && !now.has(id)) notify(u, 'left the room', false);
    }
    known = now;
  }

  // ---------- reacting to the room ----------
  on(onState((s) => {
    const r = s.room;
    if (!r) { goneFromRoom(); return; }
    paint(s); announce(s);
    const next = JSON.stringify([r.pb, r.gate?.token || 0]);
    if (next !== sig) { sig = next; readySent = null; reconcile(); }
  }));
  on(onEvent((ev, d) => {
    if (ev === 'react') floatEmoji(layer, d.emoji, d.from?.name, d.x);
    if (ev === 'cursor') drawCursor(d);
  }));
  // Left the room. Kicked: stop. Otherwise keep the player going for a few minutes in the corner: returning is instant.
  let gone = false;
  function goneFromRoom() {
    if (gone) return; gone = true;
    const kicked = Date.now() - (social.lastKick || 0) < 4000, key = playerKey();
    if (kicked) { closePlayer(); return; }
    const wasAlone = (social.lastRoomSize || 2) <= 1; if (wasAlone) P.video()?.pause(); // an empty room freezes where we stopped, so stop with it
    parkPlayer(); detachRoom(); leftKey = key;
    clearTimeout(leftTimer); leftTimer = setTimeout(() => { if (leftKey === key && !isRoomAttached()) { leftKey = ''; closePlayer(); } }, 180000);
  }
  on(onState((s) => { if (s.room) social.lastRoomSize = s.room.members.length; }));

  // ---------- live cursors ----------
  // Positions are fractions of the picture itself, so everyone points at the same spot whatever their window size.
  const picture = () => { const v = P.video(), b = v.getBoundingClientRect(), ar = (v.videoWidth / v.videoHeight) || 16 / 9; let w = b.width, h = w / ar; if (h > b.height) { h = b.height; w = h * ar; } return { x: b.left + (b.width - w) / 2, y: b.top + (b.height - h) / 2, w, h }; };
  let sentAt = 0, shown = false;
  const move = (e) => {
    if (P.parked() || !showCursors() || e.target.closest('.rm-panel')) return;
    const now = performance.now(); if (now - sentAt < 66) return; sentAt = now;
    const p = picture(); sendCursor(+((e.clientX - p.x) / p.w).toFixed(4), +((e.clientY - p.y) / p.h).toFixed(4)); shown = true;
  };
  const out = () => { if (shown) { sendCursor(0, 0, true); shown = false; } };
  root.addEventListener('pointermove', move); root.addEventListener('pointerleave', out);
  const seen = new Map();
  function drawCursor(d) {
    if (!showCursors() || P.parked()) return;
    let c = seen.get(d.id);
    if (d.off) { if (c) { c.el.remove(); clearTimeout(c.t); seen.delete(d.id); } return; }
    if (!c) {
      const u = social.state?.room?.members.find((m) => m.id === d.id); if (!u) return;
      const el = document.createElement('div'); el.className = 'rm-cur';
      el.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M3 2l13 6.5-5.5 1.8L8 16z" fill="#fff" stroke="rgba(0,0,0,.55)" stroke-width="1.2" stroke-linejoin="round"/></svg><span class="rm-curl">${avatar({ avatar: { ...u.avatar, deco: null, frame: 'none' } }, 20)}<b>${esc(u.name)}</b></span>`;
      cursors.append(el); c = { el, t: 0 }; seen.set(d.id, c);
    }
    const p = picture(), rootBox = root.getBoundingClientRect();
    c.el.style.transform = `translate(${p.x - rootBox.left + d.x * p.w}px, ${p.y - rootBox.top + d.y * p.h}px)`;
    c.el.classList.add('live'); clearTimeout(c.t);
    c.t = setTimeout(() => c.el.classList.remove('live'), 3000);
  }

  report(); reconcile();

  return () => {
    tok++; clearTimeout(startT); hideCount(); clearInterval(drift); clearInterval(readyT); clearInterval(rep); off.forEach((f) => f()); unChat();
    instant.forEach((e) => vEl.removeEventListener(e, report)); document.removeEventListener('visibilitychange', report); removeEventListener('pagehide', bye); removeEventListener('pointerdown', unmute);
    root.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', out); out(); bye();
    P.hooks.onToggle = null; P.hooks.onSeek = null; P.hooks.onDismiss = null;
    sapi('/room/ready', { ready: false }).catch(() => {});
    [panel, gateEl, notes, count, layer, cursors, soundBtn, rxBar, pill, btn].forEach((n) => n.remove()); root.classList.remove('wp-roomed', 'locked', 'rm-open');
  };
}
