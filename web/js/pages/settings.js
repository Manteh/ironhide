import { api, post, put, del } from '../api.js';
import { store, saveSettings, onLeave } from '../main.js';
import { $, $$, esc, icon, avatar, toast, AVATAR_ICONS, AVATAR_COLORS } from '../ui.js';

const SECTIONS = [
  ['profile', 'Profile', 'user'], ['appearance', 'Appearance', 'palette'], ['playback', 'Playback', 'sliders'],
  ['connectors', 'Connectors', 'plug'], ['together', 'Together', 'users'], ['nodes', 'Nodes', 'nodes'], ['about', 'About', 'info'],
];
const seg = (name, opts, cur) => `<div class="seg" data-seg="${name}">${opts.map(([v, l, ic]) => `<button data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${ic ? icon(ic) : ''}${l}</button>`).join('')}</div>`;
const card = ({ title, desc, body, foot, danger }) => `<section class="scard ${danger ? 'danger' : ''}"><div class="body"><h3>${title}</h3>${desc ? `<p class="desc">${desc}</p>` : ''}${body}</div>${foot ? `<div class="foot">${foot}</div>` : ''}</section>`;
const row = (label, hint, ctl) => `<div class="srow"><div class="lbl"><b>${label}</b>${hint ? `<span>${hint}</span>` : ''}</div>${ctl}</div>`;
// Settings save themselves; a small "Saved" confirmation appears in the card footer.
const savestat = (id) => `<span class="savestat" id="${id}" aria-live="polite"></span>`;
function flash(root, id) {
  const el = $('#' + id, root); if (!el) return;
  el.innerHTML = `${icon('check')} Saved`; el.classList.add('show'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 1700);
}
const debounce = (fn, ms = 500) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const bindSeg = (root, name, fn) => $$(`[data-seg="${name}"] button`, root).forEach((b) => (b.onclick = () => fn(b.dataset.v)));

export default async function settings(el, { section = 'profile' }) {
  if (!SECTIONS.some(([k]) => k === section)) section = 'profile';
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1 class="title">Settings</h1><div class="sub">Manage your profile, appearance, playback and connections.</div></div></div>
    <div class="settings"><nav class="snav" aria-label="Settings">${SECTIONS.map(([k, l, ic]) => `<a href="#/settings/${k}" class="${k === section ? 'on' : ''}">${icon(ic)} ${l}</a>`).join('')}</nav>
    <div class="scol" id="sbody"></div></div></div>`;
  const body = $('#sbody');
  await ({ profile, appearance, playback, connectors, together: togetherSettings, nodes, about }[section])(body);
}

// ---------- Profile ----------
function profile(body) {
  const p = JSON.parse(JSON.stringify(store.settings.profile));
  const draw = () => {
    body.innerHTML =
      card({ title: 'Display name', desc: 'Shown in the menu and the welcome screen.',
        body: `<div class="field"><label for="pname">Name</label><input id="pname" class="input" maxlength="40" value="${esc(p.name)}" style="max-width:340px"></div>`,
        foot: `<span>Up to 40 characters. Saves automatically.</span>${savestat('s1')}` }) +
      card({ title: 'Avatar', desc: 'Upload a photo or build one: shape, gradient, frame. Friends see it in Together.',
        body: '<div id="avStudio"></div>',
        foot: `<span>Saves automatically.</span>${savestat('s2')}` });
    const saveName = debounce(() => saveSettings({ profile: { name: p.name } }).then(() => flash(body, 's1')).catch((e) => toast(e.message, 'err')));
    $('#pname', body).oninput = (e) => { p.name = e.target.value; if (p.name.trim()) saveName(); };
    const saveAv = () => saveSettings({ profile: { avatar: p.avatar } }).then(() => flash(body, 's2')).catch((e) => toast(e.message, 'err'));
    import('../avatar-studio.js').then((m) => m.mountStudio($('#avStudio', body), p.avatar, saveAv, p.name));
    // sign out: on a hosted hub this erases the account; locally it starts over as a new user on this install
    fetch('/hub/health').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((h) => {
      if (!body.isConnected) return;
      const hub = !!h?.ok;
      if (!hub) mountInstances(body);
      body.insertAdjacentHTML('beforeend', card({ title: 'Sign out', desc: hub
        ? 'Leave this session. Your name is freed, and your settings, TorBox key and history on this server are erased. Anyone can then take the name.'
        : 'Start over as a new user. You get a new friend code and an empty friends list, and the name screen comes back in every open browser. Your TorBox key, appearance and playback settings stay.',
        body: '', foot: `<span></span><button class="btn danger" id="signout">Sign out and start fresh</button>` }));
      $('#signout', body).onclick = async () => {
        if (!confirm(hub ? 'Sign out and erase your data on this server? This cannot be undone.' : 'Sign out? You will lose your friends list and friend code. This cannot be undone.')) return;
        if (hub) { await fetch('/hub/leave', { method: 'POST' }); location.href = '/'; return; }
        await fetch('/api/account/reset', { method: 'POST' }); location.href = '/';
      };
    });
  };
  draw();
}

// ---------- Another person on this Mac ----------
function mountInstances(body) {
  body.insertAdjacentHTML('beforeend', card({ title: 'Another person on this Mac',
    desc: 'Start a second IronHide with its own profile, friend code and history, then open it in a new tab. Good for trying Together with yourself, or sharing this computer.',
    body: `<div id="instList" class="inst-list"></div>
      <div class="inst-new"><input id="instName" class="input" maxlength="40" placeholder="Name (optional)" aria-label="Name"><button class="btn primary" id="instGo">Start a new instance</button></div>
      <label class="inst-keys"><input type="checkbox" id="instKeys" checked> Use my debrid keys so they can play right away</label>`,
    foot: '<span>Each one runs on its own port and keeps its own folder.</span>' }));
  const list = $('#instList', body);
  const paint = async () => {
    let items = []; try { items = await api('/api/instances'); } catch {}
    if (!body.isConnected) return;
    list.innerHTML = items.map((i) => `<div class="inst"><span class="dot ${i.running ? 'online' : 'offline'}"></span><div class="inst-i"><b>${esc(i.name)}</b><span>localhost:${i.port} · ${i.running ? 'running' : 'stopped'}</span></div>
      ${i.running ? `<a class="btn sm" href="${i.url}" target="_blank" rel="noopener">Open</a><button class="btn ghost sm" data-stop="${i.id}">Stop</button>` : `<button class="btn sm" data-start="${i.id}">Start</button>`}<button class="btn ghost sm icon inst-rm" data-remove="${i.id}" data-rname="${esc(i.name)}" aria-label="Remove ${esc(i.name)}" title="Remove this person and their data">${icon('x')}</button></div>`).join('');
    $$('[data-remove]', list).forEach((b) => (b.onclick = async () => {
      if (!confirm(`Remove ${b.dataset.rname}? Their profile, friend code, history and keys on this Mac are deleted. This cannot be undone.`)) return;
      b.disabled = true; try { await del(`/api/instances/${b.dataset.remove}`); toast('Removed', 'ok'); } catch (e) { toast(e.message, 'err'); } paint();
    }));
    $$('[data-stop]', list).forEach((b) => (b.onclick = async () => { b.disabled = true; await post(`/api/instances/${b.dataset.stop}/stop`); setTimeout(paint, 800); }));
    $$('[data-start]', list).forEach((b) => (b.onclick = async () => { b.disabled = true; b.textContent = 'Starting…'; try { const r = await post(`/api/instances/${b.dataset.start}/start`); window.open(r.url, '_blank'); } catch (e) { toast(e.message, 'err'); } paint(); }));
  };
  $('#instGo', body).onclick = async (e) => {
    const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Starting…';
    try { const r = await post('/api/instances', { name: $('#instName', body).value, copyKeys: $('#instKeys', body).checked }); window.open(r.url, '_blank'); $('#instName', body).value = ''; toast('New instance started', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
    btn.disabled = false; btn.textContent = 'Start a new instance'; paint();
  };
  paint();
}

// ---------- Appearance (applies instantly) ----------
const THEMES = [['dark', 'Dark', '#0a0b10', '#1b1f2d'], ['midnight', 'Midnight', '#000', '#14161d'], ['light', 'Light', '#f5f6fa', '#dfe2ea'], ['system', 'System', 'linear-gradient(90deg,#0a0b10 50%,#f5f6fa 50%)', '#6b7080']];
const ACCENTS = { indigo: '#6d6af6', orange: '#ff7a2e', emerald: '#10b981', rose: '#f43f5e', sky: '#0ea5e9' };

function appearance(body) {
  const set = (k, v) => saveSettings({ appearance: { [k]: v } }).then(draw).catch((e) => toast(e.message, 'err'));
  const draw = () => {
    const a = store.settings.appearance;
    body.innerHTML =
      card({ title: 'Theme', desc: 'Choose how IronHide looks. System follows your Mac.', body: `<div class="theme-grid" role="radiogroup" aria-label="Theme">${THEMES.map(([k, l, bg, bar]) =>
        `<button class="theme-opt ${a.theme === k ? 'on' : ''}" data-th="${k}"><div class="prev" style="background:${bg}"><i style="top:12px;width:55%;background:${bar}"></i><i style="top:28px;width:80%;background:${bar};opacity:.6"></i><i style="top:44px;width:35%;background:${ACCENTS[a.accent]}"></i></div><b>${l}</b></button>`).join('')}</div>` }) +
      card({ title: 'Accent colour', desc: 'Used for buttons, focus rings and highlights.', body: `<div class="swatches" role="radiogroup" aria-label="Accent">${Object.entries(ACCENTS).map(([k, c]) => `<button class="sw ${a.accent === k ? 'on' : ''}" data-ac="${k}" style="background:${c}" aria-label="${k}">${a.accent === k ? icon('check') : ''}</button>`).join('')}</div>` }) +
      card({ title: 'Layout', desc: 'Tune spacing, corners and poster size.', body:
        row('Density', 'Compact fits more on screen.', seg('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], a.density)) +
        row('Corners', 'Roundness of cards and buttons.', seg('radius', [['sharp', 'Sharp'], ['round', 'Rounded'], ['pill', 'Soft']], a.radius)) +
        row('Layout', 'Posters in a grid, detailed cards with a synopsis, or a compact list.', seg('layout', [['grid', 'Grid', 'library'], ['detail', 'Detailed'], ['list', 'List']], a.layout)) +
        row('Card size', 'How big each poster or card is.', seg('posterSize', [['xs', 'XS'], ['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']], a.posterSize)) +
        row('Featured banner', 'Show the large banner at the top of For You.', `<button class="switch ${a.showHero !== false ? 'on' : ''}" id="hero" role="switch" aria-checked="${a.showHero !== false}" aria-label="Featured banner"></button>`) +
        row('Reduce motion', 'Turn off animations and transitions.', `<button class="switch ${a.motion === 'reduced' ? 'on' : ''}" id="motion" role="switch" aria-checked="${a.motion === 'reduced'}" aria-label="Reduce motion"></button>`) });
    $$('[data-th]', body).forEach((b) => (b.onclick = () => set('theme', b.dataset.th)));
    $$('[data-ac]', body).forEach((b) => (b.onclick = () => set('accent', b.dataset.ac)));
    ['density', 'radius', 'posterSize', 'layout'].forEach((k) => bindSeg(body, k, (v) => set(k, v)));
    $('#hero', body)?.addEventListener('click', () => set('showHero', a.showHero === false));
    $('#motion', body).onclick = () => set('motion', a.motion === 'reduced' ? 'full' : 'reduced');
  };
  draw();
}

// ---------- Playback ----------
async function playback(body) {
  const p = { ...store.settings.playback };
  const cap = await api('/api/webplay/capabilities').catch(() => ({ ffmpeg: false }));
  const { browserCaps } = await import('../player.js'); const bc = browserCaps();
  const draw = () => {
    body.innerHTML =
      card({ title: 'Player', desc: 'Where playback happens when you press Play.', body:
        row('Player', 'mpv opens a native fullscreen window. The web player plays inside this page.', seg('player', [['mpv', 'mpv (native)', 'monitor'], ['web', 'Web player', 'laptop']], p.player)) +
        (p.player === 'web' ? row('Quality when transcoding', 'Only used if the browser cannot decode the video directly.', seg('webMaxHeight', [['source', 'Source'], ['1080', '1080p'], ['720', '720p']], p.webMaxHeight)) +
          row('Always use GPU transcode', 'Skips direct play. Use if a file stutters or has no picture.', `<button class="switch ${p.forceTranscode ? 'on' : ''}" id="ftx" role="switch" aria-checked="${p.forceTranscode}" aria-label="Force transcode"></button>`) : '') +
        `<div class="banner" style="margin-top:var(--s4)">${icon('info')}<span>${cap.ffmpeg ? `ffmpeg found · GPU encoding via ${esc(cap.gpu)}. ` : 'ffmpeg not found, the web player is unavailable. '}This browser decodes HEVC: <b>${bc.hevc ? 'yes' : 'no'}</b>. Web playback streams the video untouched when possible (no CPU use) and converts audio to AAC.</span></div>` }) +
      card({ title: 'Preferred quality', desc: 'IronHide uses this to pick the “Best match” stream and for one-click play.', body:
      row('Resolution', 'Auto picks the highest available.', seg('quality', [['auto', 'Auto'], ['2160p', '4K'], ['1080p', '1080p'], ['720p', '720p']], p.quality)) +
      row('HDR / Dolby Vision', 'Needs a capable display.', seg('hdr', [['prefer', 'Prefer'], ['any', 'No preference'], ['avoid', 'Avoid']], p.hdr)) +
      row('Remux releases', 'Largest files, untouched quality.', seg('remux', [['prefer', 'Prefer'], ['any', 'No preference'], ['avoid', 'Avoid']], p.remux)) +
      row('Maximum file size', '0 means no limit.', `<div style="display:flex;align-items:center;gap:8px"><input id="maxsz" class="input" type="number" min="0" max="500" value="${p.maxSizeGb}" style="width:90px"><span class="muted">GB</span></div>`) +
      row('Cached streams only', 'Skip downloads that are not instantly available.', `<button class="switch ${p.cachedOnly ? 'on' : ''}" id="cached" role="switch" aria-checked="${p.cachedOnly}" aria-label="Cached only"></button>`),
      foot: `<span>Applies to the web app and Claude tools. Saves automatically.</span>${savestat('spb')}` });
    const persist = async (patch) => {
      Object.assign(p, patch, { maxSizeGb: +$('#maxsz', body).value || 0 });
      try { await saveSettings({ playback: p }); } catch (e) { return toast(e.message, 'err'); }
      draw(); flash(body, 'spb');
    };
    ['quality', 'hdr', 'remux', 'player', 'webMaxHeight'].forEach((k) => bindSeg(body, k, (v) => persist({ [k]: v })));
    $('#ftx', body)?.addEventListener('click', () => persist({ forceTranscode: !p.forceTranscode }));
    $('#cached', body).onclick = () => persist({ cachedOnly: !p.cachedOnly });
    $('#maxsz', body).oninput = debounce(() => { p.maxSizeGb = +$('#maxsz', body).value || 0; saveSettings({ playback: p }).then(() => flash(body, 'spb')).catch((e) => toast(e.message, 'err')); });
  };
  draw();
}

// ---------- Connectors ----------
const LOGOS = { torbox: 'bolt', realdebrid: 'bolt', alldebrid: 'bolt', tmdb: 'film', harvester: 'eye' };
async function connectors(body) {
  let data = await api('/api/connectors'), editing = null; const results = {};
  const draw = () => {
    const group = (kind) => data.items.filter((c) => c.kind === kind).map((c) => `<div class="conn"><div class="logo">${icon(LOGOS[c.id])}</div>
      <div class="info"><b>${esc(c.label)} ${c.active ? '<span class="badge acc">Active</span>' : ''}${results[c.id] ? `<span class="badge ${results[c.id].status === 'online' ? 'ok' : 'err'}">${esc(results[c.id].detail)}</span>` : c.configured ? '<span class="badge">Key saved</span>' : '<span class="badge">Not connected</span>'}</b>
        <span>${c.configured ? esc(c.masked) + ' · ' : ''}${esc(c.help)}</span>
        ${editing === c.id ? `<div class="edit"><input class="input" type="${c.url ? 'url' : 'password'}" id="keyin" placeholder="${c.url ? 'https://your-service.onrender.com' : 'Paste API key'}" autocomplete="off" spellcheck="false"><button class="btn primary" data-save="${c.id}">Save</button><button class="btn ghost" data-cancel>Cancel</button></div>` : ''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        ${c.configured ? `<button class="btn" data-test="${c.id}">Test</button>` : ''}<button class="btn" data-edit="${c.id}">${c.configured ? 'Replace' : 'Connect'}</button>
        ${c.configured && !c.url ? `<button class="btn ghost danger" data-rm="${c.id}" aria-label="Remove">${icon('trash')}</button>` : ''}</div></div>`).join('');
    body.innerHTML =
      card({ title: 'Debrid service', desc: 'Resolves torrents into instant streams. Only one is used at a time.', body:
        `<div class="srow" style="border:0;padding-top:0"><div class="lbl"><b>Active service</b><span>Used for every search and play.</span></div>
          <select class="input" id="prov" style="width:200px">${['torbox', 'realdebrid', 'alldebrid', 'none'].map((v) => `<option value="${v}" ${data.debridProvider === v ? 'selected' : ''}>${{ torbox: 'TorBox', realdebrid: 'Real-Debrid', alldebrid: 'AllDebrid', none: 'None (P2P)' }[v]}</option>`).join('')}</select></div>${group('debrid')}` }) +
      card({ title: 'Metadata', desc: 'Catalog sources. Cinemeta is built in and needs no key.', body: group('metadata'),
        foot: '<span>Keys are stored locally in your IronHide config folder.</span>' });
    $('#prov', body).onchange = async (e) => { data = await put('/api/connectors/provider', { provider: e.target.value }); window.refreshNodes?.(); toast('Debrid service updated', 'ok'); draw(); };
    $$('[data-edit]', body).forEach((b) => (b.onclick = () => { editing = b.dataset.edit; draw(); $('#keyin', body)?.focus(); }));
    $$('[data-cancel]', body).forEach((b) => (b.onclick = () => { editing = null; draw(); }));
    $$('[data-save]', body).forEach((b) => (b.onclick = async () => {
      const key = $('#keyin', body).value.trim(); if (!key) return;
      b.disabled = true;
      const t = await post(`/api/connectors/${b.dataset.save}/test`, { key });
      if (t.status !== 'online') { b.disabled = false; return toast(`Rejected: ${t.detail}`, 'err'); }
      data = await put(`/api/connectors/${b.dataset.save}`, { key }); editing = null; results[b.dataset.save] = t; window.refreshNodes?.(); toast('Connected', 'ok'); draw();
    }));
    $$('[data-test]', body).forEach((b) => (b.onclick = async () => { b.textContent = 'Testing…'; results[b.dataset.test] = await post(`/api/connectors/${b.dataset.test}/test`); draw(); }));
    $$('[data-rm]', body).forEach((b) => (b.onclick = async () => { if (!confirm('Remove this key?')) return; data = await del(`/api/connectors/${b.dataset.rm}`); delete results[b.dataset.rm]; window.refreshNodes?.(); draw(); }));
  };
  draw();
}

// ---------- Nodes ----------
function layout(nodes) {
  const left = nodes.filter((n) => n.group === 'players'), right = nodes.filter((n) => n.group !== 'players');
  const H = Math.max(360, 60 + right.length * 56), W = 1000, cy = H / 2;
  const place = (list, x) => list.map((n, i) => ({ ...n, x, y: (H / (list.length + 1)) * (i + 1) }));
  return { H, W, cy, items: [...place(left, 40), ...place(right, 760)] };
}
async function nodes(body) {
  let list = await api('/api/nodes');
  const draw = () => {
    const { H, W, cy, items } = layout(list);
    const edges = items.map((n) => { const left = n.x < 500, x1 = left ? 452 : 548, x2 = left ? n.x + 200 : n.x, y2 = n.y + 23;
      return `<path class="edge ${n.status === 'online' ? 'on' : ''}" d="M${x1} ${cy} C${(x1 + x2) / 2} ${cy}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}"/>`; }).join('');
    const boxes = items.map((n) => `<g class="gnode ${n.status}" transform="translate(${n.x} ${n.y})"><rect width="200" height="46" rx="12"/>
      <circle cx="20" cy="23" r="4.5" fill="${n.status === 'online' ? 'var(--ok)' : n.status === 'error' ? 'var(--err)' : 'var(--muted)'}"/>
      <text x="36" y="20" font-size="13" font-weight="600">${esc(n.name)}</text><text class="gsub" x="36" y="35" font-size="11">${esc(n.sub)}</text></g>`).join('');
    body.innerHTML = `<div class="graph"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Node graph">${edges}
      <g class="gcore" transform="translate(500 ${cy})"><circle r="48"/><path d="M0 -24l16 6v13c0 11-7 19-16 23-9-4-16-12-16-23v-13z" fill="var(--accent)" opacity=".9"/><text y="70" text-anchor="middle" font-size="13" font-weight="600">IronHide core</text></g>${boxes}</svg></div>
      <div class="page-head" style="margin-bottom:var(--s4)"><div><h3 style="font-size:17px">Connected nodes</h3><div class="sub">Players, debrid and sources IronHide talks to.</div></div><button class="btn" id="rf">${icon('refresh')} Refresh</button></div>
      <div class="nlist">${list.map((n) => `<div class="ncard"><div class="top"><span class="dot ${n.status}"></span><b>${esc(n.name)}</b>${n.active ? '<span class="badge acc">Active</span>' : ''}
        <span class="badge ${n.status === 'online' ? 'ok' : n.status === 'error' ? 'err' : ''}">${n.status}</span></div>
        <div class="t2">${esc(n.detail || '')}</div><div class="meta"><span>${esc(n.sub)}</span><span>${n.latencyMs ? n.latencyMs + ' ms' : ''}</span></div>
        ${n.configurable ? `<a class="btn" href="#/settings/connectors">Configure</a>` : ''}</div>`).join('')}</div>`;
    $('#rf', body).onclick = async (e) => { e.currentTarget.disabled = true; list = await api('/api/nodes?refresh=1'); window.refreshNodes?.(); draw(); };
  };
  draw();
  const t = setInterval(async () => { if (!$('#rf')) return; list = await api('/api/nodes?refresh=1').catch(() => list); draw(); }, 20000);
  onLeave(() => clearInterval(t));
}

// ---------- Together (relay, privacy) ----------
async function togetherSettings(body) {
  const { onState, fmtCode } = await import('../social.js');
  const draw = (s) => {
    const live = s.relay.status === 'online';
    const focus = document.activeElement?.id;
    body.innerHTML =
      card({ title: 'Relay', desc: 'A small server that passes friend, room and chat messages. No video goes through it. See relay/README.md to host your own on Render.', body:
        `<div class="field"><label for="relay">Relay address</label><input id="relay" class="input" placeholder="wss://your-relay.onrender.com" value="${esc(s.relay.url)}" spellcheck="false" autocomplete="off"></div>
         <div class="srow" style="margin-top:var(--s4)"><div class="lbl"><b>Status</b><span>${live ? 'Connected as ' + esc(s.you?.name || '') : s.relay.status === 'connecting' ? 'Connecting. A sleeping Render service can take a minute.' : s.relay.url ? 'Not connected' : 'Add an address to turn this on'}</span></div><span class="badge ${live ? 'ok' : s.relay.status === 'connecting' ? 'warn' : ''}">${esc(s.relay.status)}</span></div>`,
        foot: `<span>Saves automatically.</span>${savestat('s5')}` }) +
      card({ title: 'Your friend code', desc: 'Friends add this code to connect with you. Your name and avatar come from Profile.', body:
        `<div class="tg-code" style="font-size:30px">${s.you ? esc(fmtCode(s.you.id)) : '—'}</div>`, foot: `<span>Your private key stays on this Mac.</span><button class="btn" id="cpc" ${s.you ? '' : 'disabled'}>Copy code</button>` }) +
      card({ title: 'Privacy', body:
        row('Show what I am watching', 'Friends see the title you have open in the player.', `<button class="switch ${s.shareStatus ? 'on' : ''}" id="sh" role="switch" aria-checked="${s.shareStatus}" aria-label="Share status"></button>`) +
        row('Appear offline', 'Stay connected for rooms, but friends see you as offline.', `<button class="switch ${s.appearOffline ? 'on' : ''}" id="off" role="switch" aria-checked="${s.appearOffline}" aria-label="Appear offline"></button>`), foot: `<span>Saves automatically.</span>${savestat('s6')}` });
    const save = (patch, id) => put('/api/social/settings', patch).then(() => flash(body, id)).catch((e) => toast(e.message, 'err'));
    $('#relay', body).oninput = debounce((e) => save({ relayUrl: e.target.value.trim() }, 's5'), 700);
    $('#cpc', body)?.addEventListener('click', () => navigator.clipboard.writeText(s.you.id).then(() => toast('Friend code copied', 'ok')));
    $('#sh', body).onclick = () => save({ shareStatus: !s.shareStatus }, 's6'); $('#off', body).onclick = () => save({ appearOffline: !s.appearOffline }, 's6');
    if (focus === 'relay') { const i = $('#relay', body); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  };
  let sig = '';
  const off = onState((s) => { const k = JSON.stringify([s.relay, s.you?.id, s.shareStatus, s.appearOffline]); if (k === sig) return; sig = k; draw(s); });
  onLeave(off);
}

// ---------- About ----------
async function about(body) {
  const h = await api('/api/health').catch(() => ({}));
  body.innerHTML =
    card({ title: 'IronHide', desc: 'A private media hub for your Mac and Claude.', body:
      row('Service', 'Local daemon', `<span class="badge ok">Running · pid ${esc(h.pid || '?')}</span>`) +
      row('Address', 'Only reachable from this Mac', `<span class="t2">${esc(location.host)}</span>`) +
      row('Config folder', 'Settings, history and keys', `<span class="t2">~/.config/ironhide</span>`) }) +
    card({ danger: true, title: 'Reset appearance and playback', desc: 'Restores the default theme, layout and playback preferences. Your profile, keys and history are kept.', body: '',
      foot: `<span>This cannot be undone.</span><button class="btn danger" id="reset">Reset to defaults</button>` });
  $('#reset', body).onclick = async () => {
    if (!confirm('Reset appearance and playback to defaults?')) return;
    await saveSettings({ appearance: { theme: 'dark', accent: 'indigo', density: 'comfortable', radius: 'round', motion: 'full', posterSize: 'm' }, playback: { quality: 'auto', hdr: 'any', remux: 'any', maxSizeGb: 0, cachedOnly: true } });
    toast('Defaults restored', 'ok');
  };
}
