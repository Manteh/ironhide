// Chat + reactions for the current room. Used on the Together page and inside the player.
import { $, esc, icon, avatar } from './ui.js';
import { social, onState, onEvent, sapi } from './social.js';

const hhmm = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Floating emoji over any container (reaction from anyone in the room)
export function floatEmoji(layer, emoji, who, x) {
  const el = document.createElement('div');
  el.className = 'rx';
  el.style.left = Math.round(8 + (x ?? Math.random()) * 80) + '%';
  el.innerHTML = `<span class="rx-e">${emoji}</span>${who ? `<span class="rx-n">${esc(who)}</span>` : ''}`;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function mountChat(host, { compact = false } = {}) {
  host.classList.add('chat'); host.classList.toggle('compact', compact);
  host.innerHTML = `<div class="chat-list" id="cList" aria-live="polite"></div>
    <div class="chat-react" role="group" aria-label="Reactions"></div>
    <form class="chat-form" autocomplete="off"><input class="input" id="cIn" maxlength="500" placeholder="Say something…" aria-label="Message"><button class="btn primary" aria-label="Send">${icon('fwd')}</button></form>
    <div class="rx-layer"></div>`;
  const list = $('#cList', host), layer = $('.rx-layer', host);
  const youId = () => social.state?.you?.id;
  const line = (m) => {
    if (!m.from) return `<div class="cm sys"><span>${esc(m.text)}</span></div>`;
    const me = m.from.id === youId();
    return `<div class="cm ${me ? 'me' : ''}">${me ? '' : avatar({ avatar: m.from.avatar }, 28)}<div class="bub"><b>${esc(m.from.name)}<time>${hhmm(m.ts)}</time></b><p>${esc(m.text)}</p></div></div>`;
  };
  const stick = () => { list.scrollTop = list.scrollHeight; };
  let shown = -1;
  const fill = (s) => {
    const msgs = s.chat || [];
    if (shown === msgs.length && msgs.length) return;
    list.innerHTML = msgs.map(line).join(''); shown = msgs.length; stick();
  };
  const react = $('.chat-react', host);
  const buildReact = (s) => { if (react.childElementCount) return; react.innerHTML = (s.reactions || []).map((e) => `<button type="button" data-e="${e}" aria-label="React ${e}">${e}</button>`).join(''); };

  const offState = onState((s) => { buildReact(s); fill(s); });
  const offEvent = onEvent((ev, d) => {
    if (ev === 'chat') { const stuck = list.scrollHeight - list.scrollTop - list.clientHeight < 60; list.insertAdjacentHTML('beforeend', line(d)); shown++; if (stuck) stick(); }
    if (ev === 'react') floatEmoji(layer, d.emoji, d.from?.name, d.x);
  });
  react.addEventListener('click', (e) => { const b = e.target.closest('[data-e]'); if (b) sapi('/react', { emoji: b.dataset.e }); });
  $('.chat-form', host).addEventListener('submit', (e) => { e.preventDefault(); const i = $('#cIn', host), t = i.value.trim(); if (!t) return; sapi('/chat', { text: t }); i.value = ''; });
  return () => { offState(); offEvent(); };
}
