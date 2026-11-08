// First run: pick a name (and look) before entering. The name is what friends see in Together.
import { $, $$, esc, icon, avatar, AVATAR_ICONS, AVATAR_COLORS } from './ui.js';

export function welcome(settings) {
  return new Promise((done) => {
    const av = { ...settings.profile.avatar };
    const box = document.createElement('div'); box.className = 'welcome';
    const draw = () => {
      box.innerHTML = `<form autocomplete="off"><div style="display:flex;justify-content:center">${avatar({ avatar: av }, 72)}</div>
        <h1>Pick a name</h1><p>This is how friends see you in IronHide. You can change it later in Settings.</p>
        <input class="input" id="wn" maxlength="24" placeholder="Your name" aria-label="Your name" spellcheck="false" value="${esc(box.dataset.n || '')}">
        <div class="avatar-picker">${AVATAR_ICONS.slice(0, 10).map((i) => `<button type="button" class="av-opt ${av.icon === i ? 'on' : ''}" data-i="${i}" aria-label="${i}">${icon(i)}</button>`).join('')}</div>
        <div class="swatches">${AVATAR_COLORS.map((c) => `<button type="button" class="color-opt av-${c} ${av.color === c ? 'on' : ''}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div>
        <button class="btn primary" style="height:46px">Enter</button></form>`;
      const keep = () => { box.dataset.n = $('#wn', box).value; };
      $$('[data-i]', box).forEach((b) => (b.onclick = () => { keep(); av.icon = b.dataset.i; draw(); }));
      $$('[data-c]', box).forEach((b) => (b.onclick = () => { keep(); av.color = b.dataset.c; draw(); }));
      const n = $('#wn', box); n.focus(); n.setSelectionRange(n.value.length, n.value.length);
      $('form', box).onsubmit = async (e) => {
        e.preventDefault(); const name = n.value.trim(); if (!name) return n.focus();
        const s = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { name, avatar: av } }) }).then((r) => r.json());
        box.remove(); done(s);
      };
    };
    document.getElementById('gate')?.classList.add('out'); // drop the splash so the form is visible
    draw(); document.body.appendChild(box);
  });
}
