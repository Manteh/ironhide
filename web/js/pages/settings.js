import { api, post, put, del } from '../api.js';
import { cursorWanted } from '../cursor.js';
import { store, saveSettings, onLeave } from '../main.js';
import { $, $$, esc, icon, avatar, toast, ask, AVATAR_ICONS, AVATAR_COLORS } from '../ui.js';

const SECTIONS = [
  ['profile', 'Profile', 'user'], ['appearance', 'Appearance', 'palette'], ['playback', 'Playback', 'sliders'], ['streams', 'Streams', 'film'],
  ['connectors', 'Connectors', 'plug'], ['together', 'Friends', 'users'], ['invites', 'Invites', 'key'], ['nodes', 'Nodes', 'nodes'], ['updates', 'Updates', 'bolt'], ['about', 'About', 'info'],
];
const SUBS = {
  profile: 'Your name and how you look to friends.', appearance: 'Theme, layout and motion.', playback: 'How titles start and which versions are picked.',
  streams: 'Where versions come from and how they are ranked.', connectors: 'Accounts and keys Orbie uses. They stay on this Mac.',
  together: 'Watch with friends.', invites: 'Orbie is invite only. Bring in people you trust.', nodes: 'Everything Orbie talks to, and whether it answers.', updates: "What's new in each version.", about: 'This install.',
};
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
  const cur = SECTIONS.find(([k]) => k === section);
  el.innerHTML = `<div class="page spage"><div class="settings">
    <aside class="sside"><h1 class="title">Settings</h1>
      <nav class="snav" aria-label="Settings">${SECTIONS.map(([k, l, ic]) => `<a href="#/settings/${k}" class="${k === section ? 'on' : ''}">${icon(ic)}<span>${l}</span></a>`).join('')}</nav></aside>
    <div class="smain"><header class="shead"><h2>${cur[1]}</h2><p>${SUBS[section] || ''}</p></header><div class="scol" id="sbody"></div></div></div></div>`;
  const body = $('#sbody');
  await ({ profile, appearance, playback, streams, connectors, together: togetherSettings, invites, nodes, updates, about }[section])(body);
}

// ---------- Profile ----------
function profile(body) {
  const p = JSON.parse(JSON.stringify(store.settings.profile));
  const draw = () => {
    body.innerHTML =
      card({ title: 'Discord', desc: p.discord ? 'Your name and picture come from this Discord account. Update them any time, or unlink: your current name and picture stay.' : 'Use your Discord name and picture. Only those two change: your history, taste, friends and settings stay as they are.',
        body: p.discord
          ? `<div class="dc-linked">${avatar(p, 52)}<div><b>Linked as ${esc(p.name)}</b><span>@${esc(p.discord.username || 'discord')} · since ${new Date(p.discord.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
             <div class="dc-acts"><button class="btn" id="linkDc">Update from Discord</button><button class="btn ghost" id="unlinkDc">Unlink</button></div></div>`
          : `<button class="btn dc-btn" id="linkDc">Link Discord</button>`,
        foot: '<span>Reads your public profile only. Nothing is posted.</span>' }) +
      card({ title: 'Display name', desc: 'Shown in the menu and the welcome screen.',
        body: `<div class="field"><label for="pname">Name</label><input id="pname" class="input" maxlength="40" value="${esc(p.name)}" style="max-width:340px"></div>`,
        foot: `<span>Up to 40 characters. Saves automatically.</span>${savestat('s1')}` }) +
      card({ title: 'Avatar', desc: 'Upload a photo or build one: shape, gradient, frame. Friends see it next to your name.',
        body: '<div id="avStudio"></div>',
        foot: `<span>Saves automatically.</span>${savestat('s2')}` });
    const saveName = debounce(() => saveSettings({ profile: { name: p.name } }).then(() => flash(body, 's1')).catch((e) => toast(e.message, 'err')));
    $('#pname', body).oninput = (e) => { p.name = e.target.value; if (p.name.trim()) saveName(); };
    $('#linkDc', body).onclick = async (e) => { // opens Discord in the browser, then picks up the name and picture
      const b = e.currentTarget, label = b.textContent; b.disabled = true; b.textContent = 'Waiting for Discord…';
      try {
        const { url, state } = await post('/api/auth/discord/start', {});
        window.open(url, '_blank');
        const until = Date.now() + 5 * 60e3;
        const tick = setInterval(async () => {
          const st = await api(`/api/auth/discord/status?state=${state}`).catch(() => ({}));
          if (st.done) { clearInterval(tick); store.settings = await api('/api/settings'); toast(`Linked as ${st.name}`, 'ok'); window.refreshNav?.(); profile(body); }
          else if ((st.error && st.error !== 'expired') || Date.now() > until || !body.isConnected) { clearInterval(tick); b.disabled = false; b.textContent = label; if (st.error) toast(st.error, 'err'); }
        }, 1200);
      } catch (err) { b.disabled = false; b.textContent = label; toast(err.message, 'err'); }
    };
    const un = $('#unlinkDc', body);
    if (un) un.onclick = async () => {
      await saveSettings({ profile: { discord: null } }).catch((e) => toast(e.message, 'err'));
      toast('Discord unlinked. Your name and picture stay.', 'ok'); profile(body);
    };
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
        if (!(await ask(hub ? 'Sign out and erase your data on this server? This cannot be undone.' : 'Sign out? You will lose your friends list and friend code. This cannot be undone.', { ok: 'Sign out', danger: true }))) return;
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
    desc: 'Start a second Orbie with its own profile, friend code and history, then open it in a new tab. Good for trying rooms with yourself, or sharing this computer.',
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
      if (!(await ask(`Remove ${b.dataset.rname}? Their profile, friend code, history and keys on this Mac are deleted. This cannot be undone.`, { ok: 'Remove', danger: true }))) return;
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
      card({ title: 'Theme', desc: 'Choose how Orbie looks. System follows your Mac.', body: `<div class="theme-grid" role="radiogroup" aria-label="Theme">${THEMES.map(([k, l, bg, bar]) =>
        `<button class="theme-opt ${a.theme === k ? 'on' : ''}" data-th="${k}"><div class="prev" style="background:${bg}"><i style="top:12px;width:55%;background:${bar}"></i><i style="top:28px;width:80%;background:${bar};opacity:.6"></i><i style="top:44px;width:35%;background:${ACCENTS[a.accent]}"></i></div><b>${l}</b></button>`).join('')}</div>` }) +
      card({ title: 'Accent colour', desc: 'Used for buttons, focus rings and highlights.', body: `<div class="swatches" role="radiogroup" aria-label="Accent">${Object.entries(ACCENTS).map(([k, c]) => `<button class="sw ${a.accent === k ? 'on' : ''}" data-ac="${k}" style="background:${c}" aria-label="${k}">${a.accent === k ? icon('check') : ''}</button>`).join('')}</div>` }) +
      card({ title: 'Layout', desc: 'Tune spacing, corners and poster size.', body:
        row('Density', 'Compact fits more on screen.', seg('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], a.density)) +
        row('Corners', 'Roundness of cards and buttons.', seg('radius', [['sharp', 'Sharp'], ['round', 'Rounded'], ['pill', 'Soft']], a.radius)) +
        row('Layout', 'Posters in a grid, detailed cards with a synopsis, or a compact list.', seg('layout', [['grid', 'Grid', 'library'], ['detail', 'Detailed'], ['list', 'List']], a.layout)) +
        row('Card size', 'How big each poster or card is.', seg('posterSize', [['xs', 'XS'], ['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']], a.posterSize)) +
        row('Featured banner', 'Show the large banner at the top of For You.', `<button class="switch ${a.showHero !== false ? 'on' : ''}" id="hero" role="switch" aria-checked="${a.showHero !== false}" aria-label="Featured banner"></button>`) +
        row('Custom cursor', 'A soft ring that follows your pointer and grows over things you can click. Only with a mouse or trackpad.', `<button class="switch ${cursorWanted() ? 'on' : ''}" id="cur" role="switch" aria-checked="${cursorWanted()}" aria-label="Custom cursor"></button>`) +
        row('Reduce motion', 'Turn off animations and transitions.', `<button class="switch ${a.motion === 'reduced' ? 'on' : ''}" id="motion" role="switch" aria-checked="${a.motion === 'reduced'}" aria-label="Reduce motion"></button>`) });
    $$('[data-th]', body).forEach((b) => (b.onclick = () => set('theme', b.dataset.th)));
    $$('[data-ac]', body).forEach((b) => (b.onclick = () => set('accent', b.dataset.ac)));
    ['density', 'radius', 'posterSize', 'layout'].forEach((k) => bindSeg(body, k, (v) => set(k, v)));
    $('#hero', body)?.addEventListener('click', () => set('showHero', a.showHero === false));
    $('#cur', body)?.addEventListener('click', () => { import('../cursor.js').then((m) => { m.setCursor(!m.cursorWanted()); draw(); }); });
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
        (p.player === 'web' ? row('Web player quality', 'The browser and rooms pick this version first. 4K stays smooth in mpv, which is not affected.', seg('webMaxHeight', [['source', 'Source'], ['1080', '1080p'], ['720', '720p']], p.webMaxHeight)) +
          row('Always use GPU transcode', 'Skips direct play. Use if a file stutters or has no picture.', `<button class="switch ${p.forceTranscode ? 'on' : ''}" id="ftx" role="switch" aria-checked="${p.forceTranscode}" aria-label="Force transcode"></button>`) : '') +
        `<div class="banner" style="margin-top:var(--s4)">${icon('info')}<span>${cap.ffmpeg ? `ffmpeg found · GPU encoding via ${esc(cap.gpu)}. ` : 'ffmpeg not found, the web player is unavailable. '}This browser decodes HEVC: <b>${bc.hevc ? 'yes' : 'no'}</b>. Web playback streams the video untouched when possible (no CPU use) and converts audio to AAC.</span></div>` }) +
      card({ title: 'While you watch', desc: 'What happens around an episode.', body:
        row('Play the next episode', 'When an episode ends, the next one starts after a 10 second countdown you can cancel.', `<button class="switch ${p.autoNext !== false ? 'on' : ''}" id="autonext" role="switch" aria-checked="${p.autoNext !== false}" aria-label="Play the next episode automatically"></button>`) +
        row('Skip intros by themselves', 'Off: a Skip intro button appears. On: known intros are skipped without asking. To teach it a show’s intro, press Shift+I where it starts and again where it ends.', `<button class="switch ${p.autoSkipIntro ? 'on' : ''}" id="autoskip" role="switch" aria-checked="${!!p.autoSkipIntro}" aria-label="Skip intros automatically"></button>`) +
        row('Ambient mode', 'In the Mac app: a smaller picture you can move, with light from the film glowing around it (G while watching, Option + arrows to place it). Off: normal full screen.', `<button class="switch ${p.ambientMode ? 'on' : ''}" id="ambmode" role="switch" aria-checked="${!!p.ambientMode}" aria-label="Ambient mode"></button>`) +
        row('Tell me about new episodes', 'A Mac notification when a show you were caught up on gets a new episode.', `<button class="switch ${p.notifyNewEpisodes !== false ? 'on' : ''}" id="notifynew" role="switch" aria-checked="${p.notifyNewEpisodes !== false}" aria-label="Notify about new episodes"></button>`) +
        row('Show on Discord', 'In the Mac app: your Discord profile says what you are watching, with the poster, the episode and how far in you are. Turn off to keep it private.', `<button class="switch ${p.discordPresence !== false ? 'on' : ''}" id="discord" role="switch" aria-checked="${p.discordPresence !== false}" aria-label="Show what I am watching on Discord"></button>`) }) +
      card({ title: 'Preferred quality', desc: 'Orbie uses this to pick the “Best match” stream and for one-click play.', body:
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
    $('#autonext', body).onclick = () => persist({ autoNext: p.autoNext === false });
    $('#autoskip', body).onclick = () => persist({ autoSkipIntro: !p.autoSkipIntro });
    $('#ambmode', body).onclick = () => persist({ ambientMode: !p.ambientMode });
    $('#notifynew', body).onclick = () => persist({ notifyNewEpisodes: p.notifyNewEpisodes === false });
    $('#discord', body).onclick = () => persist({ discordPresence: p.discordPresence === false });
    $('#maxsz', body).oninput = debounce(() => { p.maxSizeGb = +$('#maxsz', body).value || 0; saveSettings({ playback: p }).then(() => flash(body, 'spb')).catch((e) => toast(e.message, 'err')); });
  };
  draw();
}

// ---------- Connectors ----------
const LOGOS = { torbox: 'bolt', realdebrid: 'bolt', alldebrid: 'bolt', tmdb: 'film', youtube: 'trailer', harvester: 'eye' };
async function connectors(body) {
  let data = await api('/api/connectors'), editing = null; const results = {};
  const draw = () => {
    const status = (c) => {
      const r = results[c.id];
      if (r) return `<span class="cstat ${r.status === 'online' ? 'ok' : 'err'}"><i></i>${esc(r.detail)}</span>`;
      return c.configured ? '<span class="cstat ok"><i></i>Connected</span>' : '<span class="cstat"><i></i>Not connected</span>';
    };
    const group = (kind) => data.items.filter((c) => c.kind === kind).map((c) => `<div class="conn ${c.configured ? 'on' : ''}"><div class="logo">${icon(LOGOS[c.id])}</div>
      <div class="info"><div class="cname"><b>${esc(c.label)}</b>${c.active ? '<span class="ctag">In use</span>' : ''}${status(c)}</div>
        <p>${esc(c.help)}</p>${c.configured ? `<code class="ckey">${esc(c.masked)}</code>` : ''}
        ${editing === c.id ? `<div class="edit"><input class="input" type="${c.url ? 'url' : 'password'}" id="keyin" placeholder="${c.url ? 'https://your-service.onrender.com' : 'Paste API key'}" autocomplete="off" spellcheck="false"><button class="btn primary" data-save="${c.id}">Save</button><button class="btn ghost" data-cancel>Cancel</button></div>` : ''}</div>
      <div class="cact">
        ${c.configured ? `<button class="btn ghost" data-test="${c.id}">Test</button>` : ''}<button class="btn" data-edit="${c.id}">${c.configured ? 'Replace' : 'Connect'}</button>
        ${c.configured && !c.url ? `<button class="btn ghost icon cdel" data-rm="${c.id}" aria-label="Remove ${esc(c.label)} key" title="Remove key">${icon('trash')}</button>` : ''}</div></div>`).join('');
    body.innerHTML =
      card({ title: 'Debrid service', desc: 'Resolves torrents into instant streams. Only one is used at a time.', body:
        `<div class="srow sprov"><div class="lbl"><b>Use for streaming</b><span>Every search and play goes through this one.</span></div>
          <select class="input" id="prov">${['torbox', 'realdebrid', 'alldebrid', 'none'].map((v) => `<option value="${v}" ${data.debridProvider === v ? 'selected' : ''}>${{ torbox: 'TorBox', realdebrid: 'Real-Debrid', alldebrid: 'AllDebrid', none: 'None (P2P)' }[v]}</option>`).join('')}</select></div>${group('debrid')}` }) +
      card({ title: 'Titles and info', desc: 'Posters, details, recommendations and comments. Cinemeta is built in and needs no key.', body: group('metadata'),
        foot: '<span>Keys are stored only in ~/.config/ironhide on this Mac.</span>' });
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
    $$('[data-rm]', body).forEach((b) => (b.onclick = async () => { if (!(await ask(`Remove the ${b.closest('.conn')?.querySelector('.cname b')?.textContent || ''} key? You can add it again any time.`, { ok: 'Remove key', danger: true }))) return; data = await del(`/api/connectors/${b.dataset.rm}`); delete results[b.dataset.rm]; window.refreshNodes?.(); draw(); }));
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
      <g class="gcore" transform="translate(500 ${cy})"><circle r="48"/><image href="/img/orbie-orb.png" x="-26" y="-26" width="52" height="52"/><text y="70" text-anchor="middle" font-size="13" font-weight="600">Orbie core</text></g>${boxes}</svg></div>
      <div class="page-head" style="margin-bottom:var(--s4)"><div><h3 style="font-size:17px">Connected nodes</h3><div class="sub">Players, debrid and sources Orbie talks to.</div></div><button class="btn" id="rf">${icon('refresh')} Refresh</button></div>
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

// ---------- Streams: what Torrentio and Comet give this person ----------
const LANG_NAMES = [['en', 'English'], ['lt', 'Lithuanian'], ['sv', 'Swedish'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['pl', 'Polish']];
const KIND_NAMES = [['4k', '4K'], ['1080p', '1080p'], ['720p', '720p'], ['480p', '480p'], ['brremux', 'Remux'], ['hdrall', 'HDR'], ['dolbyvision', 'Dolby Vision'], ['threed', '3D'], ['cam', 'Cam'], ['scr', 'Screener']];
async function streams(body) {
  const p = { ...store.settings.playback };
  const draw = () => {
    const al = p.audioLangs || [], hide = p.hideKinds || [];
    body.innerHTML =
      card({ title: 'Languages', desc: 'Picks the version with your language first, then the right audio track when it plays.', body:
        `<div class="st-row"><b>Audio</b><span>Tap in order of preference. The number shows the order.</span><div class="st-chips">${LANG_NAMES.map(([c, n]) => { const i = al.indexOf(c); return `<button class="st-chip ${i >= 0 ? 'on' : ''}" data-al="${c}">${i >= 0 ? `<em>${i + 1}</em>` : ''}${n}</button>`; }).join('')}</div></div>` +
        row('Subtitles', 'Turned on automatically when found.', `<select class="input st-sel" id="stSub"><option value="">Off in the web player, mpv decides</option><option value="off">Always off</option>${LANG_NAMES.map(([c, n]) => `<option value="${c}">${n}</option>`).join('')}</select>`) }) +
      card({ title: 'Which versions you see', desc: 'Applies to every title, in the web player and mpv.', body:
        `<div class="st-row"><b>Hide these</b><span>Hidden versions never show up or get picked.</span><div class="st-chips">${KIND_NAMES.map(([k, n]) => `<button class="st-chip hide ${hide.includes(k) ? 'on' : ''}" data-hide="${k}">${n}</button>`).join('')}</div></div>` +
        row('Sort by', 'Order asked from Torrentio.', seg('sortBy', [['qualitysize', 'Quality, then size'], ['quality', 'Quality'], ['seeders', 'Seeders'], ['size', 'Size']], p.sortBy || 'qualitysize')) +
        row('How many to load', 'More gives more choice, especially smaller files.', seg('resultCount', [[20, '20'], [60, '60'], [100, '100']], p.resultCount || 60)),
        foot: `<span>Only for you: each friend's Orbie has its own. Saves automatically.</span>${savestat('sst')}` });
    $('#stSub', body).value = p.subLang || '';
    $('#stSub', body).onchange = (e) => persist({ subLang: e.target.value });
    $$('[data-al]', body).forEach((b) => (b.onclick = () => { const c = b.dataset.al; persist({ audioLangs: al.includes(c) ? al.filter((x) => x !== c) : [...al, c] }); }));
    $$('[data-hide]', body).forEach((b) => (b.onclick = () => { const k = b.dataset.hide; persist({ hideKinds: hide.includes(k) ? hide.filter((x) => x !== k) : [...hide, k] }); }));
    bindSeg(body, 'sortBy', (v) => persist({ sortBy: v }));
    bindSeg(body, 'resultCount', (v) => persist({ resultCount: +v }));
  };
  const persist = async (patch) => {
    Object.assign(p, patch);
    try { await saveSettings({ playback: p }); } catch (e) { return toast(e.message, 'err'); }
    draw(); flash(body, 'sst');
  };
  draw();
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
        row('Share my profile with friends', 'Friends can open your stats, favourites, list, medals and what you watched.', `<button class="switch ${s.shareProfile ? 'on' : ''}" id="shP" role="switch" aria-checked="${s.shareProfile}" aria-label="Share profile"></button>`) +
        row('Show what I am watching', 'Friends see the title you have open in the player.', `<button class="switch ${s.shareStatus ? 'on' : ''}" id="sh" role="switch" aria-checked="${s.shareStatus}" aria-label="Share status"></button>`) +
        row('Appear offline', 'Stay connected for rooms, but friends see you as offline.', `<button class="switch ${s.appearOffline ? 'on' : ''}" id="off" role="switch" aria-checked="${s.appearOffline}" aria-label="Appear offline"></button>`), foot: `<span>Saves automatically.</span>${savestat('s6')}` });
    const save = (patch, id) => put('/api/social/settings', patch).then(() => flash(body, id)).catch((e) => toast(e.message, 'err'));
    $('#relay', body).oninput = debounce((e) => save({ relayUrl: e.target.value.trim() }, 's5'), 700);
    $('#cpc', body)?.addEventListener('click', () => navigator.clipboard.writeText(s.you.id).then(() => toast('Friend code copied', 'ok')));
    $('#shP', body).onclick = () => save({ shareProfile: !s.shareProfile }, 's6'); $('#sh', body).onclick = () => save({ shareStatus: !s.shareStatus }, 's6'); $('#off', body).onclick = () => save({ appearOffline: !s.appearOffline }, 's6');
    if (focus === 'relay') { const i = $('#relay', body); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  };
  let sig = '';
  const off = onState((s) => { const k = JSON.stringify([s.relay, s.you?.id, s.shareStatus, s.shareProfile, s.appearOffline]); if (k === sig) return; sig = k; draw(s); });
  onLeave(off);
}

// ---------- Updates ----------
// ---------- Invites ----------
async function invites(body) {
  const m = await api('/api/membership').catch(() => null);
  if (!m) { body.innerHTML = card({ title: 'Invites', desc: "Couldn't reach the Orbie service.", body: '' }); return; }
  const when = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const left = m.root ? 'You can invite as many people as you like.' : m.left ? `${m.left} of ${m.quota} left.` : `You've used all ${m.quota}.`;
  const list = () => (m.made.length
    ? `<div class="inv-list">${m.made.slice().reverse().map((x) => `<div class="inv-row"><b>${esc(x.note || 'Invite')}</b><span>${when(x.at)}</span></div>`).join('')}</div>`
    : '<p class="desc">No invites yet.</p>');
  body.innerHTML =
    card({ title: 'Invite someone', desc: `Each invite carries your name. ${esc(left)}`,
      body: `<form class="inv-make" autocomplete="off">
          <input id="inote" class="input" maxlength="60" placeholder="Who is it for? (only you see this)" aria-label="Who is it for">
          <button class="btn primary" id="imake" ${!m.root && !m.left ? 'disabled' : ''}>Create invite</button></form>
        <div id="iout"></div>` }) +
    card({ title: m.root ? 'You own this Orbie' : 'Your membership', desc: m.root ? 'Every invite traces back to you.' : `Invited by ${esc(m.invitedBy || 'a member')}${m.since ? ` on ${when(m.since)}` : ''}.`,
      body: `<h4 class="inv-h">Invites you've made</h4><div id="ilist">${list()}</div>` });
  $('.inv-make', body).onsubmit = async (e) => {
    e.preventDefault();
    const b = $('#imake', body), note = $('#inote', body).value.trim(); b.disabled = true; b.textContent = 'Creating…';
    try {
      const { code, left: nowLeft } = await post('/api/membership/invite', { note });
      const msg = `You're invited to Orbie, a private cinema for the people I trust.\nDownload: https://github.com/Manteh/orbie-app\nYour invite: ${code}`;
      const short = `${code.slice(0, 14)}…${code.slice(-8)}`;
      $('#iout', body).innerHTML = `<div class="inv-ready">
          <div class="inv-msg"><p>You're invited to Orbie, a private cinema for the people I trust.</p>
            <p><span>Download</span> github.com/Manteh/orbie-app</p><p><span>Your invite</span> <code>${esc(short)}</code></p></div>
          <div class="inv-acts"><button class="btn primary" id="icopy">Copy invite</button><small>${note ? `For ${esc(note)} · ` : ''}send it however you like</small></div></div>`;
      const copyBtn = $('#icopy', body);
      const copy = () => navigator.clipboard.writeText(msg).then(() => { copyBtn.textContent = 'Copied'; copyBtn.classList.add('done'); setTimeout(() => { copyBtn.textContent = 'Copy invite'; copyBtn.classList.remove('done'); }, 2200); });
      copyBtn.onclick = copy; copy();
      m.made.push({ note, at: Date.now() }); if (!m.root) m.left = nowLeft;
      $('#ilist', body).innerHTML = list(); $('#inote', body).value = '';
      b.disabled = !m.root && !m.left; b.textContent = 'Create invite';
    } catch (err) { toast(err.message, 'err'); b.disabled = false; b.textContent = 'Create invite'; }
  };
}

async function updates(body) {
  const { CHANGELOG } = await import('../changelog.js');
  const when = (iso) => { const d = new Date(iso); return `${d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} at ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`; };
  const n = (x) => Number(x || 0).toLocaleString();
  const KIND = { New: 'new', Improved: 'imp', Fixed: 'fix', 'Known limits': 'lim' };
  // a small GitHub-style strip: ten blocks split by the share of added and removed lines
  const strip = (a, d) => { const t = a + d; if (!t) return ''; const g = Math.round((a / t) * 10); return `<span class="upd-strip" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<i class="${i < g ? 'a' : 'd'}"></i>`).join('')}</span>`; };
  const statsHtml = (st) => {
    if (!st || !st.commits) return '';
    return `<div class="upd-stat"><b class="plus">+${n(st.add)}</b><b class="minus">−${n(st.del)}</b>${strip(st.add, st.del)}<span>${n(st.commits)} commit${st.commits === 1 ? '' : 's'} · ${n(st.files)} file${st.files === 1 ? '' : 's'}</span>${st.workAdd || st.workDel ? `<span class="upd-work">plus uncommitted <b class="plus">+${n(st.workAdd)}</b> <b class="minus">−${n(st.workDel)}</b></span>` : ''}</div>`;
  };
  let stats = {}; try { stats = await post('/api/updates/stats', { items: CHANGELOG.map((u) => ({ version: u.version, range: u.range, commits: u.commits, work: u.work })) }); } catch {}
  const total = Object.values(stats).reduce((a, s) => ({ add: a.add + s.add, del: a.del + s.del, commits: a.commits + s.commits }), { add: 0, del: 0, commits: 0 });
  body.innerHTML = `<div class="upd"><header class="upd-top"><h2>What's new</h2><p>Every update to Orbie, newest first. Numbers come from git and leave out screenshots and lockfiles.</p>${total.commits ? `<div class="upd-stat big"><b class="plus">+${n(total.add)}</b><b class="minus">−${n(total.del)}</b>${strip(total.add, total.del)}<span>${n(total.commits)} commits in total</span></div>` : ''}</header>
    <ol class="upd-list">${CHANGELOG.map((u, i) => { const st = stats[u.version]; return `<li class="upd-i">
      <details ${i < 2 ? 'open' : ''}><summary><span class="upd-v">v${esc(u.version)}</span><span class="upd-h"><b>${esc(u.title)}</b>${u.status === 'dev' ? '<em>In testing</em>' : i === 0 ? '<em class="latest">Latest</em>' : ''}<small>${esc(when(st?.lastAt || `${u.date}T12:00:00`))}</small></span><span class="upd-c">${icon('chev')}</span></summary>
        ${statsHtml(st)}<p class="upd-s">${esc(u.summary)}</p>
        <div class="upd-g">${Object.entries(u.groups).map(([k, items]) => `<section class="${KIND[k] || ''}"><h4>${esc(k)}</h4><ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>`).join('')}</div>
      </details></li>`; }).join('')}</ol></div>`;
}

// ---------- About ----------
async function about(body) {
  const h = await api('/api/health').catch(() => ({}));
  body.innerHTML =
    card({ title: 'Orbie', desc: 'A private media hub for your Mac and Claude.', body:
      row('Service', 'Local daemon', `<span class="badge ok">Running · pid ${esc(h.pid || '?')}</span>`) +
      row('Address', 'Only reachable from this Mac', `<span class="t2">${esc(location.host)}</span>`) +
      row('Config folder', 'Settings, history and keys', `<span class="t2">~/.config/ironhide</span>`) }) +
    card({ danger: true, title: 'Reset appearance and playback', desc: 'Restores the default theme, layout and playback preferences. Your profile, keys and history are kept.', body: '',
      foot: `<span>This cannot be undone.</span><button class="btn danger" id="reset">Reset to defaults</button>` });
  $('#reset', body).onclick = async () => {
    if (!(await ask('Reset appearance and playback to defaults?', { ok: 'Reset', danger: true }))) return;
    await saveSettings({ appearance: { theme: 'dark', accent: 'indigo', density: 'comfortable', radius: 'round', motion: 'full', posterSize: 'm' }, playback: { quality: 'auto', hdr: 'any', remux: 'any', maxSizeGb: 0, cachedOnly: true } });
    toast('Defaults restored', 'ok');
  };
}
