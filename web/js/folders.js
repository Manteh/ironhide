// Shelf collections: the tiles above the shelf, the add flow, and the helpers the collection page uses.
import { api, post } from './api.js';
import { store } from './main.js';
import { esc, icon, toast } from './ui.js';

// where a title stands for this person: from the watch history
export function statusOf(it) {
  const hs = store.history.filter((h) => h.imdbId === it.imdbId); if (!hs.length) return { state: 'unseen', label: 'Not seen', pct: 0 };
  const h = hs[0], p = Math.round(h.percent || 0), tv = it.type === 'series' || it.type === 'tv';
  if (!tv) return p >= 90 ? { state: 'watched', label: 'Watched', pct: 100 } : p > 3 ? { state: 'progress', label: `${p}% watched`, pct: p } : { state: 'unseen', label: 'Not seen', pct: 0 };
  const ep = h.season ? `S${String(h.season).padStart(2, '0')}E${String(h.episode).padStart(2, '0')}` : '';
  if (p >= 90 && h.nextEp === null) return { state: 'watched', label: 'Watched', pct: 100 }; // the last episode out was finished
  return { state: 'progress', label: `Watching${ep ? ' · ' + ep : ''}`, pct: Math.max(5, p) };
}
export const ordered = (f) => { const ids = f.orders?.[f.order] || f.items.map((x) => x.imdbId); return ids.map((id) => f.items.find((x) => x.imdbId === id)).filter(Boolean); };
export const nextUp = (f) => ordered(f).find((x) => statusOf(x).state !== 'watched') || null;
export const progress = (f) => { const l = ordered(f); return { done: l.filter((x) => statusOf(x).state === 'watched').length, total: l.length }; };

let state = { folders: [], presets: [] };
export const loadFolders = async () => { state = await api('/api/folders').catch(() => state); return state; };

const tile = (f) => {
  const l = ordered(f), pr = progress(f), nx = nextUp(f), pos = l.slice(0, 3);
  return `<a class="fld-tile" href="#/collection/${esc(f.id)}">
    <div class="fld-fan">${pos.map((x, i) => `<i style="background-image:url('${esc(x.poster)}')" data-i="${i}"></i>`).join('')}</div>
    <div class="fld-txt"><b>${esc(f.name)}</b><span>${pr.done} of ${pr.total} watched</span>
      <div class="fld-bar"><u style="width:${pr.total ? Math.round((pr.done / pr.total) * 100) : 0}%"></u></div>
      <small>${nx ? `Up next: ${esc(nx.title.replace(/^The Lord of the Rings: |^The Hobbit: /, ''))}` : 'All done'}</small></div></a>`;
};

// the add flow: whole franchises in their proper order, or an empty collection of your own
function openAdd(root, refresh) {
  document.querySelector('.fld-modal')?.remove();
  const m = document.createElement('div'); m.className = 'fld-modal';
  m.innerHTML = `<div class="fld-card" role="dialog" aria-label="Add a collection"><header><h3>Add a collection</h3><button class="fld-x" aria-label="Close">${icon('x')}</button></header>
    <p class="fld-sub">Whole franchises, with the order to watch them worked out.</p>
    <div class="fld-presets">${state.presets.map((p) => `<button class="fld-preset" data-p="${esc(p.id)}"><div><b>${esc(p.name)}</b><span>${esc(p.blurb)}</span></div><em>${p.count} titles</em><i>Add</i></button>`).join('')}</div>
    <h4>Or start your own</h4>
    <form class="fld-new"><input class="input" placeholder="Name, for example Weekend horror" maxlength="60" aria-label="Collection name"><button class="btn primary" type="submit">Create</button></form></div>`;
  document.body.append(m); requestAnimationFrame(() => m.classList.add('on'));
  const close = () => { m.classList.remove('on'); setTimeout(() => m.remove(), 250); };
  m.onclick = (e) => { if (e.target === m || e.target.closest('.fld-x')) close(); };
  m.querySelectorAll('[data-p]').forEach((b) => (b.onclick = async () => {
    b.classList.add('busy'); b.querySelector('i').textContent = 'Adding…';
    try { await post('/api/folders', { op: 'preset', preset: b.dataset.p }); close(); await refresh(); toast('Added to your shelf', 'ok'); location.hash = `#/collection/${b.dataset.p}`; } catch (e) { b.classList.remove('busy'); b.querySelector('i').textContent = 'Add'; toast(e.message, 'err'); }
  }));
  m.querySelector('.fld-new').onsubmit = async (e) => { e.preventDefault(); const name = e.target.querySelector('input').value.trim(); if (!name) return; try { await post('/api/folders', { op: 'create', name }); close(); await refresh(); } catch (er) { toast(er.message, 'err'); } };
  setTimeout(() => m.querySelector('.fld-new input')?.focus(), 200);
  addEventListener('keydown', function esc1(e) { if (e.key === 'Escape') { close(); removeEventListener('keydown', esc1); } });
}

// the row of collection tiles above the shelf
export async function mountFolderRow(el) {
  if (!el) return;
  const draw = async () => {
    await loadFolders(); if (!el.isConnected) return;
    el.innerHTML = `<div class="fld-head"><h3>Collections</h3><button class="fld-add">${icon('plus')} Add a collection</button></div>
      <div class="fld-tiles">${state.folders.map(tile).join('') || `<button class="fld-empty fld-add"><b>Keep titles together</b><span>Add a whole franchise like The Lord of the Rings in the order to watch it, or make your own.</span></button>`}</div>`;
    el.querySelectorAll('.fld-add').forEach((b) => (b.onclick = () => openAdd(el, draw)));
  };
  await draw();
}
