// One collection: the titles in the order to watch them, where you are, and what is next.
import { api, post } from '../api.js';
import { quickPlay } from '../main.js';
import { esc, icon, toast } from '../ui.js';
import { statusOf, ordered, nextUp, progress, loadFolders } from '../folders.js';

export default async function collection(el, { id }) {
  let folder = null;
  const reload = async () => { folder = ((await loadFolders()).folders || []).find((f) => f.id === id) || null; };
  await reload();
  if (!folder) { el.innerHTML = `<div class="page"><div class="empty">That collection is gone. <a href="#/shelf">Back to your shelf</a></div></div>`; return; }
  const draw = () => {
    const f = folder, list = ordered(f), pr = progress(f), nx = nextUp(f), custom = !f.preset, orders = Object.keys(f.orders || {}).filter((k) => f.orders[k]?.length);
    const names = { release: 'Release order', story: 'Story order' };
    el.innerHTML = `<div class="page coll">
      <a class="coll-back" href="#/shelf">${icon('back')} Shelf</a>
      <header class="coll-head"><div><h1>${esc(f.name)}</h1>${f.blurb ? `<p>${esc(f.blurb)}</p>` : ''}
        <div class="coll-meta"><span>${pr.done} of ${pr.total} watched</span><div class="fld-bar wide"><u style="width:${pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%"></u></div></div></div>
        <div class="coll-act">${nx ? `<button class="btn primary" id="cPlay">${icon('play')} ${statusOf(nx).state === 'progress' ? 'Continue' : 'Start'}: ${esc(nx.title.replace(/^The Lord of the Rings: |^The Hobbit: /, ''))}</button>` : '<span class="coll-done">You have watched them all</span>'}
        ${custom ? `<button class="btn ghost" id="cRename">Rename</button>` : ''}<button class="btn ghost" id="cDelete">Remove collection</button></div></header>
      ${orders.length > 1 ? `<div class="coll-order"><div class="seg" role="group" aria-label="Order">${orders.map((k) => `<button data-o="${k}" class="${f.order === k ? 'on' : ''}">${names[k] || k}</button>`).join('')}</div><p>${esc(f.orderNotes?.[f.order] || '')}</p></div>` : ''}
      <ol class="coll-list">${list.map((it, i) => { const s = statusOf(it), up = nx && nx.imdbId === it.imdbId;
        return `<li class="coll-row ${s.state} ${up ? 'up' : ''}" data-id="${esc(it.imdbId)}">
          <span class="coll-n">${i + 1}</span>
          <a class="coll-poster" href="#/title/${esc(it.type)}/${esc(it.imdbId)}" style="background-image:url('${esc(it.poster)}')" aria-label="${esc(it.title)}"></a>
          <div class="coll-info"><b>${esc(it.title)}</b><span>${esc([it.year, it.type === 'series' ? 'Series' : 'Film'].filter(Boolean).join(' · '))}</span>${it.note ? `<p>${esc(it.note)}</p>` : ''}</div>
          <div class="coll-st"><em class="chip ${s.state}">${s.state === 'watched' ? icon('check') : ''}${esc(up && s.state === 'unseen' ? 'Up next' : s.label)}</em>
            ${s.state === 'progress' ? `<div class="fld-bar"><u style="width:${s.pct}%"></u></div>` : ''}</div>
          <div class="coll-btns"><button class="btn ghost sm" data-play="${esc(it.imdbId)}" aria-label="Play ${esc(it.title)}">${icon('play')}</button>
            ${custom ? `<button class="btn ghost sm" data-mv="-1" aria-label="Move up">&uarr;</button><button class="btn ghost sm" data-mv="1" aria-label="Move down">&darr;</button><button class="btn ghost sm" data-rm="${esc(it.imdbId)}" aria-label="Remove">${icon('x')}</button>` : ''}</div>
        </li>`; }).join('') || '<li class="empty">Nothing here yet. Open a title and add it to this collection, or ask Orbie.</li>'}</ol>
    </div>`;
    const by = (iid) => folder.items.find((x) => x.imdbId === iid);
    const go = (it) => quickPlay({ imdbId: it.imdbId, type: it.type, title: it.title, poster: it.poster, year: it.year });
    el.querySelector('#cPlay')?.addEventListener('click', () => nx && go(nx));
    el.querySelectorAll('[data-play]').forEach((b) => (b.onclick = () => go(by(b.dataset.play))));
    el.querySelectorAll('[data-o]').forEach((b) => (b.onclick = async () => { await post('/api/folders', { op: 'order', id, order: b.dataset.o }); await reload(); draw(); }));
    el.querySelectorAll('[data-mv]').forEach((b) => (b.onclick = async () => { await post('/api/folders', { op: 'move', id, imdbId: b.closest('.coll-row').dataset.id, dir: +b.dataset.mv }); await reload(); draw(); }));
    el.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => { await post('/api/folders', { op: 'remove', id, imdbId: b.dataset.rm }); await reload(); draw(); }));
    el.querySelector('#cRename')?.addEventListener('click', async () => { const n = prompt('Name', f.name); if (n && n.trim()) { await post('/api/folders', { op: 'rename', id, name: n }); await reload(); draw(); } });
    el.querySelector('#cDelete').onclick = async () => { if (!confirm(`Remove “${f.name}” from your shelf? The titles stay available; only this collection goes.`)) return; await post('/api/folders', { op: 'delete', id }); toast('Collection removed', 'ok'); location.hash = '#/shelf'; };
  };
  draw();
}
