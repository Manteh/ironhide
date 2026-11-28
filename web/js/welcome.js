// First run:
//   1. sign in with Discord (your name and picture). The owner's member list is the invite: on it, you are in,
//   2. a debrid key that is checked before you go on (skipped if the list gave you one), 3. languages and quality.
// Someone already set up who isn't a member yet only sees step 1.
import { $, $$, esc, icon } from './ui.js';

const json = (url, method = 'GET', body) => fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; });
const LANGS = [['en', 'English'], ['lt', 'Lithuanian'], ['sv', 'Swedish'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['pl', 'Polish']];
const DEBRID = [['torbox', 'TorBox', 'torbox.app/settings'], ['realdebrid', 'Real-Debrid', 'real-debrid.com/apitoken'], ['alldebrid', 'AllDebrid', 'alldebrid.com/apikeys']];

// the Discord mark, for the sign-in button
const DISCORD = '<svg viewBox="0 0 24 24" aria-hidden="true" class="i"><path fill="currentColor" stroke="none" d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.6 19.6 0 0 0-4.9 1.5C.6 9.1-.3 13.7.2 18.2A19.8 19.8 0 0 0 6.2 21l1.3-2.1a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 12 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.7 19.7 0 0 0 6-3c.6-5.2-.9-9.8-3.5-13.8ZM8.3 15.4c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Zm7.4 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.2 1.1 2.1 2.4c0 1.3-.9 2.4-2.1 2.4Z"/></svg>';

export function welcome(settings, { invite = false, onlyInvite = false } = {}) {
  return new Promise((done) => {
    const box = document.createElement('div'); box.className = 'welcome';
    let saved = settings, step = 1, discordWait = 0, gift = false; // gift: streaming on the owner's TorBox
    const steps = onlyInvite ? [1] : [1, 2, 3];
    const dots = () => steps.length < 2 ? '' : `<div class="wl-steps" aria-label="Step ${steps.indexOf(step) + 1} of ${steps.length}">${steps.map((n) => `<i class="${n === step ? 'on' : n < step ? 'done' : ''}"></i>`).join('')}</div>`;
    // while setting up, the window header shows only the window controls: no name, Resume or Settings yet
    document.documentElement.classList.add('onboarding');
    const finish = () => { clearInterval(discordWait); box.remove(); document.documentElement.classList.remove('onboarding'); done(saved); };

    // ---- 1. who you are: Discord only ----
    const linkDiscord = async () => {
      const btn = $('#wdc', box), cancel = $('#wdcancel', box), msg = $('#wdm', box);
      if (!btn) return;
      btn.disabled = true; btn.innerHTML = `${DISCORD} Waiting for Discord…`;
      if (msg) { msg.className = 'wl-msg'; msg.textContent = ''; }
      if (cancel) cancel.hidden = false;
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
            // not a member yet: only the owner's list lets you past this step
            if (invite && !(await json('/api/membership')).member) {
              return stepDiscord(st.member === false
                ? `You're not on the list yet. Send your Discord username, @${st.username}, to whoever told you about Orbie, then try again.`
                : "Couldn't check the member list. Wait a minute and try again.", 'err');
            }
            if (onlyInvite) return finish();
            gift = !!st.gift;
            step = 2; stepDebrid(`Linked as ${st.name}`);
          } else if (st.error || Date.now() > until) {
            clearInterval(discordWait);
            stepDiscord(st.error === 'expired' ? 'Sign-in session expired. Try again.' : (st.error || 'Discord took too long. Try again.'), 'err');
          }
        }, 1200);
      } catch (e) { clearInterval(discordWait); stepDiscord(e.message, 'err'); }
    };
    const stepDiscord = (note = '', kind = 'ok') => {
      box.innerHTML = `<form autocomplete="off" class="wl-invite wl-dc">${dots()}<div class="wl-orb"><img src="/img/orbie-orb.png" alt=""></div>
        <h1>Sign in with Discord</h1><p>${invite ? 'Orbie is private. If you are on the list, signing in lets you straight in.' : 'Orbie uses your Discord account for your name and profile picture.'}</p>
        <div class="wl-msg ${note ? kind : ''}" role="status" id="wdm">${note ? `${kind === 'ok' ? icon('check') + ' ' : ''}${esc(note)}` : ''}</div>
        <button type="button" class="btn wl-discord" style="height:48px" id="wdc">${DISCORD} Continue with Discord</button>
        <button type="button" class="btn ghost wl-skip" id="wdcancel" hidden>Cancel</button></form>`;
      $('#wdc', box).onclick = linkDiscord;
      $('#wdcancel', box).onclick = () => { clearInterval(discordWait); stepDiscord(); };
      $('#wdc', box).focus();
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

    // ---- 3. languages and quality (the player is always mpv here; Settings can change it) ----
    const stepPlayback = (note = '', kind = 'ok') => {
      const pb = { ...saved.playback, autoSkipIntro: true }; // on for new people; the switch below turns it off
      const al = new Set(pb.audioLangs?.length ? pb.audioLangs : ['en']);
      const draw = () => {
        box.innerHTML = `<form autocomplete="off">${dots()}${gift ? `<div class="wl-gift"><b>⚡ Shimara shared TorBox with you</b><span>Nothing to set up or pay for. Films start almost instantly.</span></div>`
          : note ? `<div class="wl-msg ${kind}">${kind === 'ok' ? icon('check') + ' ' : ''}${esc(note)}</div>` : ''}<h1>How do you watch?</h1>
          <p>You can change any of this later in Settings.</p>
          <label class="wl-l">Audio languages</label>
          <div class="wl-chips">${LANGS.map(([c, l]) => `<button type="button" class="chip ${al.has(c) ? 'on' : ''}" aria-pressed="${al.has(c)}" data-al="${c}">${l}</button>`).join('')}</div>
          <label class="wl-l" for="wsub">Subtitles</label>
          <select class="input" id="wsub"><option value="">Automatic</option><option value="off" ${pb.subLang === 'off' ? 'selected' : ''}>Off</option>${LANGS.map(([c, l]) => `<option value="${c}" ${pb.subLang === c ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <label class="wl-l">Quality</label>
          <div class="seg wl-seg" role="radiogroup" aria-label="Quality">${[['auto', 'Auto'], ['2160p', '4K'], ['1080p', '1080p'], ['720p', '720p']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${(pb.quality || 'auto') === v}" class="${(pb.quality || 'auto') === v ? 'on' : ''}" data-q="${v}">${l}</button>`).join('')}</div>
          <label class="wl-l">Skip intros</label>
          <div class="seg wl-seg" role="radiogroup" aria-label="Skip intros">${[[true, 'On'], [false, 'Off']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${pb.autoSkipIntro === v}" class="${pb.autoSkipIntro === v ? 'on' : ''}" data-si="${v}">${l}</button>`).join('')}</div>
          <button class="btn primary" style="height:46px">Start watching</button></form>`;
        $$('[data-q]', box).forEach((b) => (b.onclick = () => { pb.quality = b.dataset.q; draw(); }));
        $$('[data-si]', box).forEach((b) => (b.onclick = () => { pb.autoSkipIntro = b.dataset.si === 'true'; draw(); }));
        $$('[data-al]', box).forEach((b) => (b.onclick = () => { const c = b.dataset.al; if (al.has(c) && al.size > 1) al.delete(c); else al.add(c); draw(); }));
        $('#wsub', box).onchange = (e) => { pb.subLang = e.target.value; };
        $('form', box).onsubmit = async (e) => {
          e.preventDefault();
          try { saved = await json('/api/settings', 'PUT', { playback: { player: 'mpv', audioLangs: [...al], subLang: pb.subLang || '', quality: pb.quality || 'auto', autoSkipIntro: pb.autoSkipIntro } }); } catch {}
          finish();
        };
      };
      draw();
    };

    document.getElementById('gate')?.classList.add('out'); // drop the splash so the form is visible
    stepDiscord();
    document.body.appendChild(box);
  });
}
