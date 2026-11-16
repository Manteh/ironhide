// First run, three short steps so the first Play can't fail on setup:
//   1. a name and a look (what friends see), 2. a debrid key that is checked before you go on, 3. player and languages.
// Steps 2 and 3 are skipped when they are already set up, and can be skipped by hand.
import { $, $$, esc, icon, avatar, AVATAR_ICONS, AVATAR_COLORS } from './ui.js';

const json = (url, method = 'GET', body) => fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; });
const LANGS = [['en', 'English'], ['lt', 'Lithuanian'], ['sv', 'Swedish'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ru', 'Russian'], ['pl', 'Polish']];
const DEBRID = [['torbox', 'TorBox', 'torbox.app/settings'], ['realdebrid', 'Real-Debrid', 'real-debrid.com/apitoken'], ['alldebrid', 'AllDebrid', 'alldebrid.com/apikeys']];

export function welcome(settings) {
  return new Promise((done) => {
    const av = { ...settings.profile.avatar };
    const box = document.createElement('div'); box.className = 'welcome';
    let saved = settings, step = 1;
    const dots = () => `<div class="wl-steps" aria-label="Step ${step} of 3">${[1, 2, 3].map((n) => `<i class="${n === step ? 'on' : n < step ? 'done' : ''}"></i>`).join('')}</div>`;
    const finish = () => { box.remove(); done(saved); };

    // ---- 1. name and look ----
    const stepName = () => {
      box.innerHTML = `<form autocomplete="off">${dots()}<div style="display:flex;justify-content:center">${avatar({ avatar: av }, 72)}</div>
        <h1>Pick a name</h1><p>This is how friends see you in Orbie. You can change it later in Settings.</p>
        <input class="input" id="wn" maxlength="24" placeholder="Your name" aria-label="Your name" spellcheck="false" value="${esc(box.dataset.n || '')}">
        <div class="avatar-picker">${AVATAR_ICONS.slice(0, 10).map((i) => `<button type="button" class="av-opt ${av.icon === i ? 'on' : ''}" data-i="${i}" aria-label="${i}">${icon(i)}</button>`).join('')}</div>
        <div class="swatches">${AVATAR_COLORS.map((c) => `<button type="button" class="color-opt av-${c} ${av.color === c ? 'on' : ''}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div>
        <button class="btn primary" style="height:46px">Continue</button></form>`;
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
    const stepDebrid = async () => {
      let data = null; try { data = await json('/api/connectors'); } catch {}
      const active = data?.items?.find((c) => c.kind === 'debrid' && c.active && c.configured);
      if (active) { step = 3; return stepPlayback(`${active.label} is already connected`); }
      let prov = data?.debridProvider && DEBRID.some(([id]) => id === data.debridProvider) ? data.debridProvider : 'torbox';
      const draw = (msg = '', kind = '') => {
        const where = DEBRID.find(([id]) => id === prov)?.[2] || '';
        box.innerHTML = `<form autocomplete="off">${dots()}<h1>Connect your debrid</h1>
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
    stepName(); document.body.appendChild(box);
  });
}
