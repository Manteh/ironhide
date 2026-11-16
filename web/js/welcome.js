// First run. Orbie is invite only, so it starts with the invite, then three short steps so the first Play can't fail:
//   0. the invite code (someone you trust sent it), 1. who you are: Continue with Discord, or a name and a look,
//   2. a debrid key that is checked before you go on, 3. player and languages.
// Someone already set up who just needs an invite (an update made Orbie invite only) only sees step 0.
import { $, $$, esc, icon, avatar, AVATAR_ICONS, AVATAR_COLORS } from './ui.js';

const json = (url, method = 'GET', body) => fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; });
const LANGS = [['en', 'English'], ['lt', 'Lithuanian'], ['sv', 'Swedish'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['pl', 'Polish']];
const DEBRID = [['torbox', 'TorBox', 'torbox.app/settings'], ['realdebrid', 'Real-Debrid', 'real-debrid.com/apitoken'], ['alldebrid', 'AllDebrid', 'alldebrid.com/apikeys']];

// the Discord mark, for the sign-in button
const DISCORD = '<svg viewBox="0 0 24 24" aria-hidden="true" class="i"><path fill="currentColor" stroke="none" d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.6 19.6 0 0 0-4.9 1.5C.6 9.1-.3 13.7.2 18.2A19.8 19.8 0 0 0 6.2 21l1.3-2.1a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 12 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.7 19.7 0 0 0 6-3c.6-5.2-.9-9.8-3.5-13.8ZM8.3 15.4c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm7.4 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z"/></svg>';

export function welcome(settings, { invite = false, onlyInvite = false } = {}) {
  return new Promise((done) => {
    const av = { ...settings.profile.avatar };
    const box = document.createElement('div'); box.className = 'welcome';
    let saved = settings, step = invite ? 0 : 1;
    const steps = onlyInvite ? [0] : invite ? [0, 1, 2, 3] : [1, 2, 3];
    const dots = () => steps.length < 2 ? '' : `<div class="wl-steps" aria-label="Step ${steps.indexOf(step) + 1} of ${steps.length}">${steps.map((n) => `<i class="${n === step ? 'on' : n < step ? 'done' : ''}"></i>`).join('')}</div>`;
    const finish = () => { box.remove(); done(saved); };

    // ---- 0. the invite ----
    const stepInvite = (msg = '', kind = '') => {
      box.innerHTML = `<form autocomplete="off" class="wl-invite">${dots()}<div class="wl-orb"><img src="/img/orbie-orb.png" alt=""></div>
        <h1>Welcome to Orbie</h1><p>Orbie is invite only. Paste the invite someone you trust sent you.</p>
        <textarea class="input wl-code" id="wc" rows="3" placeholder="orbie-…" aria-label="Invite code" spellcheck="false">${esc(box.dataset.c || '')}</textarea>
        <div class="wl-msg ${kind}" role="status" id="wm">${esc(msg)}</div>
        <button class="btn primary" style="height:46px" id="wgo">Join Orbie</button></form>`;
      const c = $('#wc', box), m = $('#wm', box); c.focus();
      let t = 0;
      c.oninput = () => { // say who it is from as soon as a whole code is there
        box.dataset.c = c.value; clearTimeout(t);
        t = setTimeout(async () => {
          if (c.value.trim().length < 40) { m.className = 'wl-msg'; m.textContent = ''; return; }
          const p = await json('/api/membership/peek', 'POST', { code: c.value }).catch((e) => ({ ok: false, error: e.message }));
          m.className = `wl-msg ${p.ok ? 'ok' : 'err'}`; m.innerHTML = p.ok ? `${icon('check')} ${p.from ? `An invite from <b>${esc(p.from)}</b>` : 'A valid invite'}` : esc(p.error);
        }, 250);
      };
      $('form', box).onsubmit = async (e) => {
        e.preventDefault(); if (!c.value.trim()) return c.focus();
        const go = $('#wgo', box); go.disabled = true; go.textContent = 'Checking…';
        try {
          const r = await json('/api/membership/redeem', 'POST', { code: c.value });
          if (onlyInvite) return finish();
          step = 1; stepName(r.from ? `You're in. Invited by ${r.from}.` : "You're in.");
        } catch (err) { stepInvite(err.message, 'err'); }
      };
    };

    // ---- 1. who you are: from Discord, or a name and a look ----
    let discordWait = 0;
    const linkDiscord = async (btn) => {
      btn.disabled = true; btn.innerHTML = `${DISCORD} Waiting for Discord…`;
      try {
        const { url, state } = await json('/api/auth/discord/start', 'POST', {});
        window.open(url, '_blank'); // the Mac app opens it in your browser
        const until = Date.now() + 5 * 60e3;
        clearInterval(discordWait);
        discordWait = setInterval(async () => {
          const st = await json(`/api/auth/discord/status?state=${state}`).catch(() => ({}));
          if (st.done) {
            clearInterval(discordWait); saved = await json('/api/settings');
            if (!saved.profile.named) saved = await json('/api/settings', 'PUT', { profile: { name: saved.profile.name } });
            step = 2; stepDebrid(`Linked as ${st.name}`);
          } else if (st.error && st.error !== 'expired' || Date.now() > until) {
            clearInterval(discordWait); stepName(st.error || 'Discord took too long. Try again, or pick a name below.', 'err');
          }
        }, 1200);
      } catch (e) { stepName(e.message, 'err'); }
    };
    const stepName = (note = '', kind = 'ok') => {
      box.innerHTML = `<form autocomplete="off">${dots()}${note ? `<div class="wl-msg ${kind}">${kind === 'ok' ? icon('check') + ' ' : ''}${esc(note)}</div>` : ''}
        <h1>Who's watching?</h1><p>Bring your name and picture from Discord, or pick them here. You can change them later.</p>
        <button type="button" class="btn wl-discord" style="height:48px" id="wdc">${DISCORD} Continue with Discord</button>
        <div class="wl-or"><span>or</span></div>
        <div style="display:flex;justify-content:center">${avatar({ avatar: av }, 72)}</div>
        <input class="input" id="wn" maxlength="24" placeholder="Your name" aria-label="Your name" spellcheck="false" value="${esc(box.dataset.n || '')}">
        <div class="avatar-picker">${AVATAR_ICONS.slice(0, 10).map((i) => `<button type="button" class="av-opt ${av.icon === i ? 'on' : ''}" data-i="${i}" aria-label="${i}">${icon(i)}</button>`).join('')}</div>
        <div class="swatches">${AVATAR_COLORS.map((c) => `<button type="button" class="color-opt av-${c} ${av.color === c ? 'on' : ''}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div>
        <button class="btn primary" style="height:46px">Continue</button></form>`;
      $('#wdc', box).onclick = (e) => linkDiscord(e.currentTarget);
      const keep = () => { box.dataset.n = $('#wn', box).value; };
      $$('[data-i]', box).forEach((b) => (b.onclick = () => { keep(); av.icon = b.dataset.i; stepName(); }));
      $$('[data-c]', box).forEach((b) => (b.onclick = () => { keep(); av.color = b.dataset.c; stepName(); }));
      const n = $('#wn', box); n.focus(); n.setSelectionRange(n.value.length, n.value.length);
      $('form', box).onsubmit = async (e) => {
        e.preventDefault(); const name = n.value.trim(); if (!name) return n.focus();
        saved = await json('/api/settings', 'PUT', { profile: { name, avatar: av } });
        step = 2; stepDebrid();
      };
    };

    // ---- 2. debrid: checked now, not at the first Play ----
    const stepDebrid = async (note = '') => {
      let data = null; try { data = await json('/api/connectors'); } catch {}
      const active = data?.items?.find((c) => c.kind === 'debrid' && c.active && c.configured);
      if (active) { step = 3; return stepPlayback(`${active.label} is already connected`); }
      let prov = data?.debridProvider && DEBRID.some(([id]) => id === data.debridProvider) ? data.debridProvider : 'torbox';
      const draw = (msg = '', kind = '') => {
        const where = DEBRID.find(([id]) => id === prov)?.[2] || '';
        box.innerHTML = `<form autocomplete="off">${dots()}${note && !msg ? `<div class="wl-msg ok">${icon('check')} ${esc(note)}</div>` : ''}<h1>Connect your debrid</h1>
          <p>Orbie streams through a debrid service, so playback starts instantly. Your key stays on this Mac.</p>
          <div class="seg wl-seg" role="radiogroup" aria-label="Debrid service">${DEBRID.map(([id, label]) => `<button type="button" role="radio" aria-checked="${id === prov}" class="${id === prov ? 'on' : ''}" data-p="${id}">${label}</button>`).join('')}</div>
          <input class="input" id="wk" placeholder="API key" aria-label="API key" spellcheck="false" autocomplete="off">
          <small class="wl-hint">Find it at ${esc(where)}</small>
          <div class="wl-msg ${kind}" role="status">${esc(msg)}</div>
          <button class="btn primary" style="height:46px" id="wgo">Check and continue</button>
          <button type="button" class="btn ghost wl-skip" id="wskip">Skip for now</button></form>`;
        $$('[data-p]', box).forEach((b) => (b.onclick = () => { prov = b.dataset.p; draw(); }));
        $('#wk', box).focus();
        $('#wskip', box).onclick = () => { step = 3; stepPlayback('You can add a key later in Settings → Connectors', 'info'); };
        $('form', box).onsubmit = async (e) => {
          e.preventDefault(); const key = $('#wk', box).value.trim(); if (!key) return $('#wk', box).focus();
          const go = $('#wgo', box); go.disabled = true; go.textContent = 'Checking…';
          try {
            const t = await json(`/api/connectors/${prov}/test`, 'POST', { key });
            if (t.status !== 'online') throw new Error(t.detail || 'That key was not accepted');
            await json(`/api/connectors/${prov}`, 'PUT', { key });
            await json('/api/connectors/provider', 'PUT', { provider: prov });
            window.refreshNodes?.();
            step = 3; stepPlayback(`${DEBRID.find(([id]) => id === prov)[1]} connected`);
          } catch (err) { draw(err.message.replace(/^HTTP \d+$/, 'That key was not accepted'), 'err'); }
        };
      };
      draw();
    };

    // ---- 3. player and languages ----
    const stepPlayback = (note = '', kind = 'ok') => {
      const pb = { ...saved.playback };
      const al = new Set(pb.audioLangs?.length ? pb.audioLangs : ['en']);
      const draw = () => {
        box.innerHTML = `<form autocomplete="off">${dots()}${note ? `<div class="wl-msg ${kind}">${kind === 'ok' ? icon('check') + ' ' : ''}${esc(note)}</div>` : ''}<h1>How do you watch?</h1>
          <p>Where Play opens, and which languages to look for.</p>
          <label class="wl-l">Player</label>
          <div class="seg wl-seg" role="radiogroup" aria-label="Player">
            <button type="button" role="radio" aria-checked="${pb.player !== 'web'}" class="${pb.player !== 'web' ? 'on' : ''}" data-pl="mpv">${icon('monitor')} mpv (best quality)</button>
            <button type="button" role="radio" aria-checked="${pb.player === 'web'}" class="${pb.player === 'web' ? 'on' : ''}" data-pl="web">${icon('laptop')} In this window</button></div>
          <label class="wl-l">Audio languages</label>
          <div class="wl-chips">${LANGS.map(([c, l]) => `<button type="button" class="chip ${al.has(c) ? 'on' : ''}" aria-pressed="${al.has(c)}" data-al="${c}">${l}</button>`).join('')}</div>
          <label class="wl-l" for="wsub">Subtitles</label>
          <select class="input" id="wsub"><option value="">Automatic</option><option value="off" ${pb.subLang === 'off' ? 'selected' : ''}>Off</option>${LANGS.map(([c, l]) => `<option value="${c}" ${pb.subLang === c ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <button class="btn primary" style="height:46px">Start watching</button></form>`;
        $$('[data-pl]', box).forEach((b) => (b.onclick = () => { pb.player = b.dataset.pl; draw(); }));
        $$('[data-al]', box).forEach((b) => (b.onclick = () => { const c = b.dataset.al; if (al.has(c) && al.size > 1) al.delete(c); else al.add(c); draw(); }));
        $('#wsub', box).onchange = (e) => { pb.subLang = e.target.value; };
        $('form', box).onsubmit = async (e) => {
          e.preventDefault();
          try { saved = await json('/api/settings', 'PUT', { playback: { player: pb.player || 'mpv', audioLangs: [...al], subLang: pb.subLang || '' } }); } catch {}
          finish();
        };
      };
      draw();
    };

    document.getElementById('gate')?.classList.add('out'); // drop the splash so the form is visible
    if (invite) stepInvite(); else stepName();
    document.body.appendChild(box);
  });
}
