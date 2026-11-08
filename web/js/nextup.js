// After something ends or is stopped near the end: check it was really finished (the server decides) and offer the next episode.
import { api } from './api.js';
import { $, esc, icon, pad, posterOf, toast } from './ui.js';

let card = null;
export function closeNext() { if (!card) return; const c = card; card = null; c.classList.remove('in'); setTimeout(() => c.remove(), 400); }

function show(meta, next) {
  closeNext();
  const c = card = document.createElement('div'); c.className = 'nextup';
  const tag = `S${pad(next.season)}E${pad(next.episode)}`;
  c.innerHTML = `<i class="nu-art" style="background-image:url('${esc(posterOf(meta.imdbId))}')"></i>
    <div class="nu-b"><span class="nu-k">Up next</span><b>${esc(meta.title || '')}</b><span class="nu-s">${tag}${next.name ? ' · ' + esc(next.name) : ''}</span>
      <div class="nu-a"><button class="pill" data-a="go">${icon('play')} Play ${tag}</button><button class="btn ghost" data-a="no">Not now</button></div></div>`;
  document.body.appendChild(c); requestAnimationFrame(() => c.classList.add('in'));
  c.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    closeNext();
    if (a === 'go') { const m = await import('./main.js'); m.quickPlay({ imdbId: meta.imdbId, type: 'series', title: meta.title, season: next.season, episode: next.episode, poster: posterOf(meta.imdbId) }); }
  };
  setTimeout(() => { if (card === c) closeNext(); }, 60000);
}

// meta: { imdbId, title, season, episode } of what just ended. Quiet unless it was finished.
export async function offerNext(meta) {
  if (!meta?.imdbId) return;
  let r; try { r = await api(`/api/nextup?imdbId=${meta.imdbId}${meta.season ? `&season=${meta.season}&episode=${meta.episode}` : ''}`); } catch { return; }
  if (!r?.finished) return;
  if (r.next) show(meta, r.next);
  else if (r.ended) toast(`That was the last episode of ${meta.title}`, 'ok');
}

// After mpv closes: ask what it was and whether it was finished
export async function offerAfterMpv() {
  let st; try { st = await api('/api/lastend'); } catch { return; }
  if (!st || st.status !== 'completed') return;
  if (st.nextEpisode) show({ imdbId: st.imdbId, title: st.title }, st.nextEpisode);
  else if (st.seriesEnded) toast(`That was the last episode of ${st.title}`, 'ok');
}
