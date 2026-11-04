// Together: friends, rooms, invitations, and the room lobby (members, picked title, chat).
import { $, $$, esc, icon, avatar, posterOf, toast } from '../ui.js';
import { social, onState, sapi, inRoom, isHost, canControl, fmtCode } from '../social.js';
import { mountChat } from '../chat.js';
import { onLeave } from '../main.js';

const STATUS = { off: 'Not connected', connecting: 'Connecting…', online: 'Connected', invalid: 'Invalid relay address', replaced: 'Signed in elsewhere' };
const copy = async (text, msg) => { try { await navigator.clipboard.writeText(text); toast(msg, 'ok'); } catch { toast('Copy failed', 'err'); } };
const sig = (o) => JSON.stringify(o);

export default async function together(el) {
  el.innerHTML = `<div class="page together">
    <div class="page-head"><div><h1 class="title">Together</h1><div class="sub">Watch at the same time as your friends, with chat and reactions.</div></div><span id="tgLink" class="badge"></span></div>
    <div id="tgSetup"></div>
    <div class="tg-grid"><aside class="tg-friends" id="tgFriends"></aside><section class="tg-room" id="tgRoom"></section></div></div>`;
  const last = {}; let unChat = null;

  const draw = (s) => {
    const link = $('#tgLink', el); link.textContent = STATUS[s.relay.status] || s.relay.status; link.className = 'badge ' + (s.relay.status === 'online' ? 'ok' : s.relay.status === 'connecting' ? 'warn' : '');
    // setup card until a relay is configured
    const setupKey = sig([s.relay.url, s.relay.status]);
    if (last.setup !== setupKey) { last.setup = setupKey; setup(s); }
    const fKey = sig([s.you, s.people, s.friends, s.incoming, s.outgoing, s.room?.code, s.relay.status]);
    if (last.f !== fKey) { last.f = fKey; friends(s); }
    const rKey = sig([s.room, s.invites, s.relay.status, s.friends.map((f) => f.id)]);
    if (last.r !== rKey) { last.r = rKey; room(s); }
  };

  function setup(s) {
    const box = $('#tgSetup', el);
    if (s.relay.status === 'online') { box.innerHTML = ''; return; }
    box.innerHTML = s.relay.url
      ? `<div class="banner" style="margin-bottom:var(--s5)">${icon('info')}<span>Waiting for the relay at <b>${esc(s.relay.url)}</b>. On Render's free plan it can take about a minute to wake up. <a href="#/settings/together" style="text-decoration:underline">Change it</a></span></div>`
      : `<form class="tg-card" id="relayF" style="margin-bottom:var(--s5)"><div class="tg-k">Connect</div><p class="tg-note" style="margin:0 0 12px">Together uses a small relay that passes friend, room and chat messages. No video goes through it. Paste the address you were given.</p>
          <div class="tg-row"><input class="input" id="relayIn" placeholder="wss://your-relay.onrender.com" spellcheck="false" autocomplete="off"><button class="btn primary">Connect</button></div></form>`;
    $('#relayF', box)?.addEventListener('submit', (e) => { e.preventDefault(); const v = $('#relayIn', box).value.trim(); if (v) fetch('/api/social/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relayUrl: v }) }).catch((err) => toast(err.message, 'err')); });
  }

  function friends(s) {
    const live = s.relay.status === 'online';
    $('#tgFriends', el).innerHTML = `
      <div class="tg-card code"><div class="tg-k">Your friend code</div>
        <div class="tg-code">${s.you ? esc(fmtCode(s.you.id)) : '—'}</div>
        <button class="btn" id="cpCode" ${s.you ? '' : 'disabled'}>${icon('bookmark')} Copy code</button>
        <p class="tg-note">Send this to a friend. They add it under “Add a friend”, and you accept.</p>
        ${s.relayHost && live ? `<p class="tg-note tg-relay"><i class="fw-dot"></i>On ${esc(s.relayHost)}. Friends must be on the same relay.</p>` : ''}</div>
      <form class="tg-card add" id="addF"><div class="tg-k">Add a friend</div><div class="tg-row"><input class="input" id="fCode" placeholder="Friend code" maxlength="12" autocomplete="off" spellcheck="false" ${live ? '' : 'disabled'}><button class="btn primary" ${live ? '' : 'disabled'}>Add</button></div>
        ${s.outgoing.length ? `<p class="tg-note">Waiting for ${s.outgoing.length} to accept…</p>` : ''}</form>
      ${s.directory ? `<div class="tg-card"><div class="tg-k">People here <button class="btn ghost sm" id="rfP">Refresh</button></div>${s.people.length ? s.people.map((p) => `<div class="fr on"><span class="av live">${avatar({ avatar: p.avatar }, 38)}</span><div class="fi"><b>${esc(p.name)}</b><span>Online now</span></div>${s.outgoing.some((o) => o.id === p.id) ? '<span class="muted">Requested</span>' : `<button class="btn sm" data-add="${p.id}">Add</button>`}</div>`).join('') : '<p class="tg-note" style="padding:var(--s3) 0">No one else is online yet.</p>'}</div>` : ''}
      ${s.incoming.length ? `<div class="tg-card"><div class="tg-k">Requests</div>${s.incoming.map((r) => `<div class="fr"><span class="av">${avatar({ avatar: r.avatar }, 38)}</span><div class="fi"><b>${esc(r.name)}</b><span>wants to be friends</span></div><button class="btn primary sm" data-acc="${r.id}">Accept</button><button class="btn ghost sm" data-dec="${r.id}">Ignore</button></div>`).join('')}</div>` : ''}
      <div class="tg-card"><div class="tg-k">Friends <span class="muted">${s.friends.filter((f) => f.online).length} online</span></div>
        ${s.friends.length ? s.friends.map((f) => `<div class="fr ${f.online ? 'on' : ''} ${f.online && f.status ? 'watching' : ''}"><span class="av ${f.online ? 'live' : ''}">${avatar({ avatar: f.avatar }, 38)}</span>
          <div class="fi"><b>${esc(f.name)}</b>${f.online ? (f.status ? `<span class="fr-watch"><i class="fw-dot"></i>Watching</span><span class="fr-title" title="${esc(f.status.title)}">${esc(f.status.title)}</span>` : '<span>Online</span>') : '<span>Offline</span>'}
            ${f.online && f.inRoom ? `<span class="fr-room">${icon('users')}<em>${esc(f.inRoom.name)}</em> · ${f.inRoom.count} in${f.inRoom.media ? ` · ${esc(f.inRoom.media.title)}` : ''}</span>` : ''}</div>
          ${f.online && f.inRoom ? (s.room?.code === f.inRoom.code ? '<span class="badge ok">Same room</span>' : `<button class="btn primary sm" data-joinroom="${esc(f.inRoom.code)}">Join</button>`) : ''}
          ${f.online && f.status ? `<a class="fw" href="#/title/${esc(f.status.type === 'movie' ? 'movie' : 'series')}/${esc(f.status.imdbId)}" title="Open ${esc(f.status.title)}" style="background-image:url('${esc(f.status.poster || posterOf(f.status.imdbId))}')"></a>` : ''}
          ${s.room && f.online ? `<button class="btn sm" data-inv="${f.id}">Invite</button>` : ''}<button class="btn ghost sm icon" data-rm="${f.id}" aria-label="Remove ${esc(f.name)}" title="Remove">${icon('x')}</button></div>`).join('') : '<p class="tg-note" style="padding:var(--s3) 0">No friends yet. Share your code to get started.</p>'}</div>`;
    $('#cpCode', el)?.addEventListener('click', () => copy(s.you.id, 'Friend code copied'));
    $('#addF', el).onsubmit = async (e) => { e.preventDefault(); const v = $('#fCode', el).value.trim(); if (!v) return; try { await sapi('/friends', { code: v }); $('#fCode', el).value = ''; } catch (err) { toast(err.message, 'err'); } };
    $('#rfP', el)?.addEventListener('click', () => sapi('/people'));
    $$('[data-add]', el).forEach((b) => (b.onclick = () => sapi('/friends', { code: b.dataset.add }).catch((e) => toast(e.message, 'err'))));
    $$('[data-acc]', el).forEach((b) => (b.onclick = () => sapi('/friends/accept', { id: b.dataset.acc })));
    $$('[data-dec]', el).forEach((b) => (b.onclick = () => sapi('/friends/decline', { id: b.dataset.dec })));
    $$('[data-joinroom]', el).forEach((b) => (b.onclick = () => { b.disabled = true; sapi('/room/join', { code: b.dataset.joinroom }).catch((e) => { b.disabled = false; toast(e.message, 'err'); }); }));
    $$('[data-inv]', el).forEach((b) => (b.onclick = () => { sapi('/room/invite', { id: b.dataset.inv }); toast('Invite sent', 'ok'); }));
    $$('[data-rm]', el).forEach((b) => (b.onclick = () => { if (confirm('Remove this friend?')) fetch('/api/social/friends/' + b.dataset.rm, { method: 'DELETE' }); }));
  }

  function room(s) {
    unChat?.(); unChat = null;
    const live = s.relay.status === 'online', box = $('#tgRoom', el), r = s.room;
    if (!r) {
      box.innerHTML = `<div class="tg-card hero-card"><div class="tg-k">Start a room</div><h2>Watch together</h2><p class="tg-note">Everyone plays their own copy. IronHide keeps play, pause and seeking in sync, and starts everyone on the same beat once they have loaded.</p>
        <form class="tg-row" id="mkRoom"><input class="input" id="rName" placeholder="Room name (optional)" maxlength="40" ${live ? '' : 'disabled'}><button class="btn primary" ${live ? '' : 'disabled'}>Create room</button></form></div>
        <div class="tg-card"><div class="tg-k">Join with a code</div><form class="tg-row" id="jnRoom"><input class="input" id="rCode" placeholder="Room code" maxlength="8" autocomplete="off" spellcheck="false" style="text-transform:uppercase" ${live ? '' : 'disabled'}><button class="btn" ${live ? '' : 'disabled'}>Join</button></form></div>
        ${s.invites.length ? `<div class="tg-card"><div class="tg-k">Invitations</div>${s.invites.map((i) => `<div class="fr"><span class="av">${avatar({ avatar: i.from.avatar }, 38)}</span><div class="fi"><b>${esc(i.name)}</b><span>from ${esc(i.from.name)}${i.media ? ' · ' + esc(i.media.title) : ''}</span></div><button class="btn primary sm" data-join="${i.code}">Join</button><button class="btn ghost sm" data-no="${i.code}">Dismiss</button></div>`).join('')}</div>` : ''}`;
      $('#mkRoom', el).onsubmit = (e) => { e.preventDefault(); sapi('/room', { name: $('#rName', el).value }); };
      $('#jnRoom', el).onsubmit = (e) => { e.preventDefault(); const v = $('#rCode', el).value.trim(); if (v) sapi('/room/join', { code: v }); };
      $$('[data-join]', el).forEach((b) => (b.onclick = () => sapi('/room/join', { code: b.dataset.join })));
      $$('[data-no]', el).forEach((b) => (b.onclick = () => sapi('/room/invite/dismiss', { code: b.dataset.no })));
      return;
    }
    const host = r.host === s.you?.id, m = r.media, ep = m?.season ? `S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}` : '';
    box.innerHTML = `
      <div class="tg-card room-head"><div><div class="tg-k">Room</div><h2>${esc(r.name)}</h2></div>
        <div class="rh-r"><button class="code-pill" id="cpRoom" title="Copy room code">${esc(r.code)} ${icon('bookmark')}</button><button class="btn ghost" id="lvRoom">Leave</button></div></div>
      <div class="tg-card"><div class="tg-k">In the room · ${r.members.length}</div><div class="mem">${r.members.map((u) => `<div class="mb ${u.ready ? 'ready' : ''}"><span class="av">${avatar({ avatar: u.avatar }, 40)}</span><b>${esc(u.name)}${u.id === r.host ? '<em>host</em>' : ''}</b><i title="${u.ready ? 'Loaded and ready' : 'Not ready'}"></i>${r.host === s.you?.id && u.id !== r.host ? `<button class="mb-x" data-kick="${u.id}" data-kname="${esc(u.name)}" aria-label="Remove ${esc(u.name)} from the room" title="Remove from room">${icon('x')}</button>` : ''}</div>`).join('')}</div>
        ${host ? `<div class="srow" style="margin-top:var(--s4)"><div class="lbl"><b>Friends can see and join</b><span>Your friends see this room in their list and can hop in without a code.</span></div><button class="switch ${r.open !== false ? 'on' : ''}" id="openSw" role="switch" aria-checked="${r.open !== false}" aria-label="Friends can join"></button></div><div class="srow"><div class="lbl"><b>Who controls playback</b><span>The host always can.</span></div><div class="seg" data-seg="ctl"><button data-v="host" class="${r.control === 'host' ? 'on' : ''}">Only me</button><button data-v="all" class="${r.control === 'all' ? 'on' : ''}">Everyone</button></div></div>` : ''}</div>
      <div class="tg-card now">${m ? `<div class="nowrow"><div class="nposter2" style="background-image:url('${esc(m.poster || posterOf(m.imdbId))}')"></div>
          <div class="nwi"><div class="tg-k">${host ? 'You picked' : 'Now watching'}</div><h3>${esc(m.title)}</h3><div class="muted">${[ep, m.year].filter(Boolean).join(' · ') || (m.type === 'series' ? 'Series' : 'Film')}</div>
            <div class="tg-row" style="margin-top:var(--s4)"><button class="btn primary" id="goPlay">${icon('play')} Open the player</button>${host ? '<button class="btn" id="pick">Change</button>' : ''}</div></div></div>`
        : `<div class="tg-k">What are we watching?</div><p class="tg-note">${host ? 'Pick a title. Everyone in the room gets it and loads their own copy.' : 'Waiting for the host to pick something.'}</p>${host ? '<button class="btn primary" id="pick">Pick a title</button>' : ''}`}</div>
      <div class="tg-card chatbox" id="tgChat"></div>`;
    $('#cpRoom', el).onclick = () => copy(r.code, 'Room code copied'); $('#lvRoom', el).onclick = () => sapi('/room/leave');
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
