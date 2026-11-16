// After something ends or is stopped near the end: check it was really finished (the server decides) and offer the next episode.
// With "Play the next episode" on (Settings → Playback), it starts by itself after a 10 second countdown you can cancel.
import { api, post } from './api.js';
import { $, esc, icon, pad, posterOf, toast } from './ui.js';

const COUNTDOWN = 10;
let card = null, cardKey = '';
export function closeNext() {
  if (!card) return;
  const c = card; card = null; cardKey = '';
  clearInterval(c._tick); document.removeEventListener('keydown', c._keys, true);
  c.classList.remove('in'); setTimeout(() => c.remove(), 400);
}

async function autoOn() {
  try { const { store } = await import('./main.js'); return store.settings?.playback?.autoNext !== false; } catch { return true; }
}

async function show(meta, next) {
  const key = `${meta.imdbId}:${next.season}:${next.episode}`;
  if (card && cardKey === key) return; // already offered (the app player and the remote both notice the end)
  closeNext();
  post('/api/nextup/prepare', { imdbId: meta.imdbId, season: next.season, episode: next.episode }).catch(() => {}); // fetch its versions now
  const auto = await autoOn();
  const c = card = document.createElement('div'); cardKey = key;
  c.className = 'nextup' + (auto ? ' auto' : '');
  c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', 'Up next');
  const tag = `S${pad(next.season)}E${pad(next.episode)}`;
  c.innerHTML = `<i class="nu-art" style="background-image:url('${esc(posterOf(meta.imdbId))}')"></i>
    <div class="nu-b"><span class="nu-k">Up next${auto ? ` <em class="nu-count" aria-live="polite">in <b>${COUNTDOWN}</b>s</em>` : ''}</span><b>${esc(meta.title || '')}</b><span class="nu-s">${tag}${next.name ? ' · ' + esc(next.name) : ''}</span>
      <div class="nu-a"><button class="pill" data-a="go">${icon('play')} Play ${auto ? 'now' : tag}</button><button class="btn ghost" data-a="no">${auto ? 'Cancel' : 'Not now'}</button></div></div>
    ${auto ? '<i class="nu-ring" aria-hidden="true"><u></u></i>' : ''}`;
  document.body.appendChild(c); requestAnimationFrame(() => c.classList.add('in'));
  const play = async () => {
    closeNext();
    const m = await import('./main.js');
    m.quickPlay({ imdbId: meta.imdbId, type: 'series', title: meta.title, season: next.season, episode: next.episode, poster: posterOf(meta.imdbId) });
  };
  c.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'go') play(); else closeNext();
  };
  // Escape cancels, Enter plays now
  c._keys = (e) => { if (card !== c) return; if (e.key === 'Escape') { e.preventDefault(); closeNext(); } else if (e.key === 'Enter' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); play(); } };
  document.addEventListener('keydown', c._keys, true);
  if (auto) {
    let left = COUNTDOWN;
    const ring = c.querySelector('.nu-ring u'); if (ring) ring.style.animationDuration = `${COUNTDOWN}s`;
    c._tick = setInterval(() => {
      if (card !== c) return clearInterval(c._tick);
      if (document.hidden) return; // paused while you're away from the window: it waits for you
      left -= 1; const b = c.querySelector('.nu-count b'); if (b) b.textContent = left;
      if (left <= 0) { clearInterval(c._tick); play(); }
    }, 1000);
    c.querySelector('[data-a="go"]')?.focus({ preventScroll: true });
  } else setTimeout(() => { if (card === c) closeNext(); }, 60000);
}

// meta: { imdbId, title, season, episode } of what just ended. Quiet unless it was finished.
export async function offerNext(meta) {
  if (!meta?.imdbId) return;
  let r; try { r = await api(`/api/nextup?imdbId=${meta.imdbId}${meta.season ? `&season=${meta.season}&episode=${meta.episode}` : ''}`); } catch { return; }
  if (!r?.finished) return;
  if (r.next) show(meta, r.next);
  else if (r.ended) toast(`That was the last episode of ${meta.title}`, 'ok');
}

// A film just ended: a small card to rate it (stars), once. It feeds your taste profile; Later just closes it.
let rateCard = null, ratedFor = '';
async function offerRating(st) {
  if (!st?.imdbId || ratedFor === st.imdbId) return;
  ratedFor = st.imdbId;
  try { const r = await api(`/api/rating/${st.imdbId}`); if (r?.rating) return; } catch {}
  rateCard?.remove();
  const c = rateCard = document.createElement('div'); c.className = 'nextup rate in-prep'; c.setAttribute('role', 'dialog'); c.setAttribute('aria-label', `Rate ${st.title}`);
  c.innerHTML = `<i class="nu-art" style="background-image:url('${esc(posterOf(st.imdbId))}')"></i>
    <div class="nu-b"><span class="nu-k">You finished</span><b>${esc(st.title || '')}</b><span class="nu-s">How was it?</span>
      <div class="nu-stars" role="radiogroup" aria-label="Your rating">${[1, 2, 3, 4, 5].map((n) => `<button data-r="${n}" role="radio" aria-checked="false" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
      <div class="nu-a"><button class="btn ghost" data-a="later">Later</button></div></div>`;
  document.body.appendChild(c); requestAnimationFrame(() => c.classList.add('in'));
  const close = () => { c.classList.remove('in'); setTimeout(() => c.remove(), 400); if (rateCard === c) rateCard = null; };
  c.addEventListener('mouseover', (e) => { const n = +e.target.closest('[data-r]')?.dataset.r || 0; c.querySelectorAll('[data-r]').forEach((b) => b.classList.toggle('on', +b.dataset.r <= n)); });
  c.addEventListener('mouseleave', () => c.querySelectorAll('[data-r]').forEach((b) => b.classList.remove('on')));
  c.onclick = async (e) => {
    if (e.target.closest('[data-a=later]')) return close();
    const n = +e.target.closest('[data-r]')?.dataset.r; if (!n) return;
    try { await post('/api/rate', { imdbId: st.imdbId, title: st.title, type: 'movie', rating: n }); toast(`Rated ${st.title} ${'★'.repeat(n)}`, 'ok'); window.browseTasteChanged?.(); } catch (err) { toast(err.message, 'err'); }
    close();
  };
  setTimeout(() => { if (rateCard === c) close(); }, 120000);
}

// After mpv (or the app's player) closes: ask what it was and whether it was finished
export async function offerAfterMpv() {
  let st; try { st = await api('/api/lastend'); } catch { return; }
  if (!st || st.status !== 'completed') return;
  if (!st.season && !st.nextEpisode && !st.seriesEnded) return offerRating(st); // a film
  if (st.nextEpisode) show({ imdbId: st.imdbId, title: st.title }, st.nextEpisode);
  else if (st.seriesEnded) toast(`That was the last episode of ${st.title}`, 'ok');
}
