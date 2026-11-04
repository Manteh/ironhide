// Friends: who your friends are and what they're doing, their rooms, starting your own, and the room lobby.
import { $, $$, esc, icon, avatar, posterOf, toast, fmtTime } from '../ui.js';
import { social, onState, sapi, inRoom, isHost, canControl, fmtCode } from '../social.js';
import { mountChat } from '../chat.js';
import { onLeave } from '../main.js';

const STATUS = { off: 'Not connected', connecting: 'Connecting…', online: 'Connected', invalid: 'Invalid relay address', replaced: 'Signed in elsewhere' };
const copy = async (text, msg) => { try { await navigator.clipboard.writeText(text); toast(msg, 'ok'); } catch { toast('Copy failed', 'err'); } };
const sig = (o) => JSON.stringify(o);
const RELAY_NEEDS = 8; // live player states, owner, kick and saved rooms need relay version 4
const relayWarn = (s) => (s.relay.status === 'online' && (s.relay.version || 0) < RELAY_NEEDS
  ? `<div class="banner warn" style="margin-bottom:var(--s4)">${icon('info')}<span><b>The relay is out of date.</b> Live states (watching, paused, tabbed out), room owner, kicking and saved rooms need a newer relay. Redeploy <b>${esc(s.relayHost || 'it')}</b> on Render from the latest code.</span></div>` : '');
// What a player is doing, in words (from the room's live state)
const STATE = { playing: ['Watching', 'ok'], paused: ['Paused', 'warn'], buffering: ['Buffering…', 'info'], loading: ['Loading…', 'info'], away: ['Tabbed out', 'away'], idle: ['In the lobby', 'idle'] };
const presenceLine = (f, s) => {
  if (!f.online) return '<span class="pl off">Offline</span>';
  const st = s.room?.members.find((m) => m.id === f.id)?.st?.state; // we are in the same room: use its live state
  if (st && STATE[st]) return `<span class="pl ${STATE[st][1]}"><i class="pdot"></i>In your room · ${STATE[st][0]}</span>`;
  if (f.away) return '<span class="pl away"><i class="pdot"></i>Tabbed out</span>';
  return '<span class="pl ok"><i class="pdot"></i>Online</span>';
};
// update each member's live state chip in place
function paintMemberStates(s) {
  for (const m of s.room?.members || []) {
    const el = document.querySelector(`.mb[data-mid="${m.id}"] .mst`); if (!el) continue;
    const st = m.st?.state, d = st && STATE[st];
    el.textContent = d ? d[0] : (m.ready ? 'Ready' : 'Joining'); el.className = `mst ${d ? d[1] : (m.ready ? 'ok' : 'info')}`;
  }
}
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
// Rooms you were in stay here, paused where the picture stopped, so you can come back any time (even after everyone closed their browsers)
const savedCard = (s) => {
  const list = (s.savedRooms || []).filter((x) => !x.current); if (!list.length) return '';
  const row = (x) => `<div class="sr">
    <span class="sr-p" style="background-image:url('${x.media ? esc(x.media.poster || posterOf(x.media.imdbId)) : ''}')"></span>
    <div class="sr-i"><b>${esc(x.name)}</b><span>${x.media ? `${esc(x.media.title)} · paused at <em>${fmtTime(x.pos)}</em>` : 'Nothing picked yet'}</span><span>${x.members.length} ${x.members.length === 1 ? 'person' : 'people'} · ${ago(x.savedAt)}</span>
      <div class="sr-av">${x.members.slice(0, 6).map((m) => avatar({ avatar: m.avatar }, 22)).join('')}</div></div>
    <button class="btn primary sm" data-rejoin="${esc(x.code)}">Rejoin</button><button class="btn ghost sm icon" data-forget="${esc(x.code)}" aria-label="Forget ${esc(x.name)}" title="Forget this room">${icon('x')}</button></div>`;
  return `<div class="tg-card"><div class="tg-k">Your rooms <span class="muted">paused where you left</span></div>${list.slice(0, 3).map(row).join('')}${list.length > 3 ? `<details class="sr-more"><summary>Show ${list.length - 3} older</summary>${list.slice(3).map(row).join('')}</details>` : ''}</div>`;
};

export default async function together(el) {
  el.innerHTML = `<div class="page together">
    <div class="page-head"><div><h1 class="title">Friends</h1><div class="sub" id="tgSub"></div></div><span id="tgLink" class="badge"></span></div>
    <div id="tgSetup"></div>
    <div class="tg-grid"><aside class="tg-friends" id="tgFriends"></aside><section class="tg-room" id="tgRoom"></section></div></div>`;
  const last = {}; let unChat = null, inviteNext = null;

  const draw = (s) => {
    const link = $('#tgLink', el); link.textContent = STATUS[s.relay.status] || s.relay.status; link.className = 'badge ' + (s.relay.status === 'connecting' ? 'warn' : ''); link.hidden = s.relay.status === 'online'; // only worth saying when something is wrong
    const onl = s.friends.filter((f) => f.online).length; $('#tgSub', el).textContent = s.friends.length ? `${onl} of ${s.friends.length} online` : 'See what your friends are watching and watch together.';
    if (s.room && inviteNext) { sapi('/room/invite', { id: inviteNext.id }); toast(`Invited ${inviteNext.name}`, 'ok'); inviteNext = null; } // "Watch together" made this room for them
    // setup card until a relay is configured
    const setupKey = sig([s.relay.url, s.relay.status]);
    if (last.setup !== setupKey) { last.setup = setupKey; setup(s); }
    const fKey = sig([s.you, s.people, s.friends, s.incoming, s.outgoing, s.room?.code, s.room?.members.map((m) => [m.id, m.st?.state]), s.relay.status]);
    if (last.f !== fKey) { last.f = fKey; friends(s); }
    // live member states (every ~2 s) must not rebuild the room card, or the chat would lose focus; they are painted in place
    const roomSig = s.room && { ...s.room, members: s.room.members.map(({ st, ...m }) => m) };
    const rKey = sig([roomSig, s.invites, s.relay.status, s.relay.version, s.friends.map((f) => f.id), s.savedRooms, s.room ? 0 : s.friends.map((f) => [f.online, f.inRoom])]); // while in a room this stays put so the chat keeps focus
    if (last.r !== rKey) { last.r = rKey; room(s); }
    paintMemberStates(s);
  };

  function setup(s) {
    const box = $('#tgSetup', el);
    if (s.relay.status === 'online') { box.innerHTML = ''; return; }
    box.innerHTML = s.relay.url
      ? `<div class="banner" style="margin-bottom:var(--s5)">${icon('info')}<span>Waiting for the relay at <b>${esc(s.relay.url)}</b>. On Render's free plan it can take about a minute to wake up. <a href="#/settings/together" style="text-decoration:underline">Change it</a></span></div>`
      : `<form class="tg-card" id="relayF" style="margin-bottom:var(--s5)"><div class="tg-k">Connect</div><p class="tg-note" style="margin:0 0 12px">Friends and rooms use a small relay that passes friend, room and chat messages. No video goes through it. Paste the address you were given.</p>
          <div class="tg-row"><input class="input" id="relayIn" placeholder="wss://your-relay.onrender.com" spellcheck="false" autocomplete="off"><button class="btn primary">Connect</button></div></form>`;
    $('#relayF', box)?.addEventListener('submit', (e) => { e.preventDefault(); const v = $('#relayIn', box).value.trim(); if (v) fetch('/api/social/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relayUrl: v }) }).catch((err) => toast(err.message, 'err')); });
  }

  function friends(s) {
    const live = s.relay.status === 'online';
    $('#tgFriends', el).innerHTML = `
      ${s.incoming.length ? `<div class="tg-card"><div class="tg-k">Requests</div>${s.incoming.map((r) => `<div class="fr"><span class="av">${avatar({ avatar: r.avatar }, 38)}</span><div class="fi"><b>${esc(r.name)}</b><span>wants to be friends</span></div><button class="btn primary sm" data-acc="${r.id}">Accept</button><button class="btn ghost sm" data-dec="${r.id}">Ignore</button></div>`).join('')}</div>` : ''}
      <div class="tg-card"><div class="tg-k">Your friends</div>
        ${s.friends.length ? s.friends.map((f) => `<div class="fr ${f.online ? 'on' : ''} ${f.online && f.status ? 'watching' : ''} ${f.online && f.away ? 'away' : ''}"><a class="av ${f.online ? 'live' : ''}" href="#/profile/${esc(f.id)}" title="See ${esc(f.name)}'s profile">${avatar({ avatar: f.avatar }, 38)}</a>
          <div class="fi"><b><a class="fr-link" href="#/profile/${esc(f.id)}">${esc(f.name)}</a></b>${presenceLine(f, s)}</div>
          <div class="fr-act">${s.room && f.online && !f.inRoom ? `<button class="btn sm" data-inv="${f.id}">Invite</button>` : ''}${!s.room && f.online && !f.inRoom ? `<button class="btn sm" data-with="${f.id}" data-name="${esc(f.name)}">Watch together</button>` : ''}</div>
          ${f.online && (f.inRoom || f.status) ? `<div class="fr-x">${f.inRoom ? `<span class="fr-room">${icon('users')}<span class="fr-rt"><em>${esc(f.inRoom.name)}</em><small>${f.inRoom.count} in${f.inRoom.media ? ` · ${esc(f.inRoom.media.title)}` : ''}</small></span></span>` : ''}${f.status ? `${f.status.imdbId && f.status.imdbId !== 'synctest' ? `<a class="fw-strip" href="#/title/${esc(f.status.type === 'movie' ? 'movie' : 'series')}/${esc(f.status.imdbId)}" title="Open ${esc(f.status.title)}"><span class="fw" style="background-image:url('${esc(f.status.poster || posterOf(f.status.imdbId))}')"></span>` : '<span class="fw-strip">'}<span class="fw-t"><small><i class="fw-dot ${f.status.state === 'paused' || f.away ? 'idle' : ''}"></i>${f.status.state === 'paused' ? 'Paused' : 'Watching now'}${f.away ? ' · tabbed out' : ''}</small><b>${esc(f.status.title)}</b></span>${f.status.imdbId && f.status.imdbId !== 'synctest' ? '</a>' : '</span>'}` : ''}</div>` : ''}</div>`).join('') : '<p class="tg-note" style="padding:var(--s3) 0">No friends yet. Add your first one below.</p>'}</div>
      <form class="tg-card add" id="addF"><div class="tg-k">Add a friend</div><div class="tg-row"><input class="input" id="fCode" placeholder="Their friend code" maxlength="12" autocomplete="off" spellcheck="false" ${live ? '' : 'disabled'}><button class="btn primary" ${live ? '' : 'disabled'}>Add</button></div>
        ${s.outgoing.length ? `<p class="tg-note">Waiting for ${s.outgoing.length} to accept…</p>` : ''}
        <div class="tg-mine"><span>Your code <b>${s.you ? esc(fmtCode(s.you.id)) : '—'}</b></span><button type="button" class="btn ghost sm" id="cpCode" ${s.you ? '' : 'disabled'}>Copy</button></div>
        <p class="tg-note">You only need this once. After that, you see each other's rooms and can just join.</p>
        ${s.relayHost && live ? `<p class="tg-note tg-relay"><i class="fw-dot"></i>On ${esc(s.relayHost)}. Friends must be on the same relay.</p>` : ''}</form>
      ${s.directory ? `<div class="tg-card"><div class="tg-k">People here <button class="btn ghost sm" id="rfP">Refresh</button></div>${s.people.length ? s.people.map((p) => `<div class="fr on"><span class="av live">${avatar({ avatar: p.avatar }, 38)}</span><div class="fi"><b>${esc(p.name)}</b><span>Online now</span></div>${s.outgoing.some((o) => o.id === p.id) ? '<span class="muted">Requested</span>' : `<button class="btn sm" data-add="${p.id}">Add</button>`}</div>`).join('') : '<p class="tg-note" style="padding:var(--s3) 0">No one else is online yet.</p>'}</div>` : ''}`;
    $('#cpCode', el)?.addEventListener('click', () => copy(s.you.id, 'Friend code copied'));
    $('#addF', el).onsubmit = async (e) => { e.preventDefault(); const v = $('#fCode', el).value.trim(); if (!v) return; try { await sapi('/friends', { code: v }); $('#fCode', el).value = ''; } catch (err) { toast(err.message, 'err'); } };
    $('#rfP', el)?.addEventListener('click', () => sapi('/people'));
    $$('[data-add]', el).forEach((b) => (b.onclick = () => sapi('/friends', { code: b.dataset.add }).catch((e) => toast(e.message, 'err'))));
    $$('[data-acc]', el).forEach((b) => (b.onclick = () => sapi('/friends/accept', { id: b.dataset.acc })));
    $$('[data-dec]', el).forEach((b) => (b.onclick = () => sapi('/friends/decline', { id: b.dataset.dec })));
    $$('[data-joinroom]', el).forEach((b) => (b.onclick = () => { b.disabled = true; sapi('/room/join', { code: b.dataset.joinroom }).catch((e) => { b.disabled = false; toast(e.message, 'err'); }); }));
    $$('[data-with]', el).forEach((b) => (b.onclick = () => { b.disabled = true; inviteNext = { id: b.dataset.with, name: b.dataset.name }; sapi('/room', { name: `${s.you?.name || 'My'}'s room` }).catch((e) => { inviteNext = null; b.disabled = false; toast(e.message, 'err'); }); }));
    $$('[data-inv]', el).forEach((b) => (b.onclick = () => { sapi('/room/invite', { id: b.dataset.inv }); toast('Invite sent', 'ok'); }));
  }

  function room(s) {
    unChat?.(); unChat = null;
    const live = s.relay.status === 'online', box = $('#tgRoom', el), r = s.room;
    if (!r) {
      // A friend's room needs no code: if you can see it, you can join it
      const seen = new Map(); for (const f of s.friends) if (f.online && f.inRoom && !seen.has(f.inRoom.code)) seen.set(f.inRoom.code, { ...f.inRoom, who: s.friends.filter((x) => x.online && x.inRoom?.code === f.inRoom.code) });
      // an invitation is just a room with a note on it
      for (const i of s.invites) { const c = seen.get(i.code); if (c) c.invitedBy = i.from.name; else seen.set(i.code, { code: i.code, name: i.name, media: i.media, invitedBy: i.from.name, who: [i.from], count: 0 }); }
      const roomsNow = [...seen.values()].sort((a, b) => !!b.invitedBy - !!a.invitedBy);
      box.innerHTML = `${relayWarn(s)}
        <div class="tg-card tg-rooms"><div class="tg-rh"><div><div class="tg-k">Rooms</div><p class="tg-note">${roomsNow.length ? 'Your friends are watching. Just join.' : 'Nobody is in a room right now.'}</p></div><button class="btn primary" id="mkRoom" ${live ? '' : 'disabled'}>${icon('play')} Start a room</button></div>
          ${roomsNow.map((x) => `<div class="sr"><span class="sr-p" style="background-image:url('${x.media ? esc(x.media.poster || posterOf(x.media.imdbId)) : ''}')"></span><div class="sr-i"><b>${esc(x.name)}</b><span>${x.media ? esc(x.media.title) : 'Picking something to watch'}</span>${x.invitedBy ? `<span class="sr-inv">${esc(x.invitedBy)} invited you</span>` : ''}${x.count ? `<span>${x.count} in the room</span>` : ''}<div class="sr-av">${x.who.slice(0, 6).map((u) => avatar({ avatar: u.avatar }, 22)).join('')}</div></div><button class="btn primary sm" data-join="${esc(x.code)}">Join</button>${x.invitedBy ? `<button class="btn ghost sm" data-no="${esc(x.code)}">Dismiss</button>` : ''}</div>`).join('')}</div>
        ${savedCard(s)}
        <details class="tg-code-join"><summary>Someone who isn't your friend gave you a room code?</summary><form class="tg-row" id="jnRoom"><input class="input" id="rCode" placeholder="Room code" maxlength="8" autocomplete="off" spellcheck="false" style="text-transform:uppercase" ${live ? '' : 'disabled'}><button class="btn" ${live ? '' : 'disabled'}>Join</button></form></details>`;
      $('#mkRoom', el).onclick = (e) => { e.currentTarget.disabled = true; sapi('/room', { name: `${s.you?.name || 'My'}'s room` }).catch((err) => toast(err.message, 'err')); };
      $('#jnRoom', el).onsubmit = (e) => { e.preventDefault(); const v = $('#rCode', el).value.trim(); if (v) sapi('/room/join', { code: v }); };
      $$('[data-join]', el).forEach((b) => (b.onclick = () => sapi('/room/join', { code: b.dataset.join })));
      $$('[data-rejoin]', el).forEach((b) => (b.onclick = () => { b.disabled = true; sapi('/room/join', { code: b.dataset.rejoin }).catch((e) => { b.disabled = false; toast(e.message, 'err'); }); }));
      $$('[data-forget]', el).forEach((b) => (b.onclick = () => { if (confirm('Forget this room? You will no longer see it here.')) sapi('/room/forget', { code: b.dataset.forget }); }));
      $$('[data-no]', el).forEach((b) => (b.onclick = () => sapi('/room/invite/dismiss', { code: b.dataset.no })));
      return;
    }
    const host = r.host === s.you?.id || r.owner === s.you?.id, owner = r.owner === s.you?.id, m = r.media, ep = m?.season ? `S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}` : '';
    box.innerHTML = `${relayWarn(s)}
      <div class="tg-card room-head"><div><div class="tg-k">Room</div><h2>${esc(r.name)}</h2></div>
        <div class="rh-r"><button class="btn sm" id="cpRoom" title="For someone who isn't your friend yet">Copy room code</button><button class="btn sm" id="lvRoom">Leave</button></div></div>
      <div class="tg-card"><div class="tg-k">In the room · ${r.members.length}</div><div class="mem">${r.members.map((u) => `<div class="mb ${u.ready ? 'ready' : ''}" data-mid="${u.id}"><span class="av">${avatar({ avatar: u.avatar }, 40)}</span><b>${esc(u.name)}${u.id === r.owner ? '<em class="own" title="Owner: always in control">owner</em>' : u.id === r.host ? '<em title="Hosting until the owner is back">host</em>' : ''}</b><small class="mst"></small><i title="${u.ready ? 'Loaded and ready' : 'Not ready'}"></i>${owner && u.id !== r.owner ? `<button class="mb-x mb-own" data-own="${u.id}" data-kname="${esc(u.name)}" aria-label="Make ${esc(u.name)} the owner" title="Make ${esc(u.name)} the owner">${icon('crown')}</button>` : ''}${host && u.id !== r.owner && u.id !== s.you?.id ? `<button class="mb-x" data-kick="${u.id}" data-kname="${esc(u.name)}" aria-label="Remove ${esc(u.name)} from the room" title="Remove from room">${icon('x')}</button>` : ''}</div>`).join('')}</div>
        ${host ? `<div class="srow" style="margin-top:var(--s4)"><div class="lbl"><b>Friends can see and join</b><span>Your friends see this room in their list and can hop in without a code.</span></div><button class="switch ${r.open !== false ? 'on' : ''}" id="openSw" role="switch" aria-checked="${r.open !== false}" aria-label="Friends can join"></button></div><div class="srow"><div class="lbl"><b>Who controls playback</b><span>The host always can.</span></div><div class="seg" data-seg="ctl"><button data-v="host" class="${r.control === 'host' ? 'on' : ''}">Only me</button><button data-v="all" class="${r.control === 'all' ? 'on' : ''}">Everyone</button></div></div>` : ''}</div>
      <div class="tg-card now">${m ? `<div class="nowrow"><div class="nposter2" style="background-image:url('${esc(m.poster || posterOf(m.imdbId))}')"></div>
          <div class="nwi"><div class="tg-k">${host ? 'You picked' : 'Now watching'}</div><h3>${esc(m.title)}</h3><div class="muted">${[ep, m.year].filter(Boolean).join(' · ') || (m.type === 'series' ? 'Series' : 'Film')}</div>
            <div class="tg-row" style="margin-top:var(--s4)"><button class="btn primary" id="goPlay">${icon('play')} Go to the movie</button>${host ? '<button class="btn" id="pick">Change</button>' : ''}</div></div></div>`
        : `<div class="tg-k">What are we watching?</div><p class="tg-note">${host ? 'Pick a title. Everyone in the room gets it and loads their own copy.' : 'Waiting for the host to pick something.'}</p>${host ? '<button class="btn primary" id="pick">Pick a title</button>' : ''}`}</div>
      <div class="tg-card chatbox" id="tgChat"></div>`;
    $('#cpRoom', el).onclick = () => copy(r.code, 'Room code copied'); $('#lvRoom', el).onclick = () => sapi('/room/leave');
    $$('[data-own]', el).forEach((b) => (b.onclick = () => { if (confirm(`Make ${b.dataset.kname} the owner of this room? You will lose owner control.`)) sapi('/room/transfer', { id: b.dataset.own }); }));
    $$('[data-kick]', el).forEach((b) => (b.onclick = () => { if (confirm(`Remove ${b.dataset.kname} from the room? They will not be able to rejoin it.`)) sapi('/room/kick', { id: b.dataset.kick }); }));
    $('#openSw', el)?.addEventListener('click', () => sapi('/room/settings', { open: !(r.open !== false) }));
    $$('[data-seg="ctl"] button', el).forEach((b) => (b.onclick = () => sapi('/room/settings', { control: b.dataset.v })));
    $('#pick', el)?.addEventListener('click', async () => { const { openPalette } = await import('../palette.js'); openPalette('', { pick: (t) => sapi('/room/media', { media: { imdbId: t.imdbId, type: t.type, title: t.title, year: t.year, poster: t.poster, ...(t.type === 'series' ? { season: 1, episode: 1 } : {}) } }) }); });
    $('#goPlay', el)?.addEventListener('click', async () => { const { joinRoomPlayback } = await import('../roomplay.js'); joinRoomPlayback(); });
    unChat = mountChat($('#tgChat', el));
  }

  const off = onState(draw);
  const poll = setInterval(() => { if (social.state?.directory) sapi('/people').catch(() => {}); }, 8000); // see newcomers
  onLeave(() => { off(); clearInterval(poll); unChat?.(); });
}
