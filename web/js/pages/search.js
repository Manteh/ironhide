import { api } from '../api.js';
import { esc, card } from '../ui.js';

export default async function search(el, { q }) {
  el.innerHTML = `<div class="page"><div class="page-head"><div><h1 class="title">Results for “${esc(q)}”</h1></div></div><div class="note">Searching…</div></div>`;
  const items = await api('/api/catalog/search?q=' + encodeURIComponent(q));
  el.querySelector('.note').outerHTML = items.length ? `<div class="grid">${items.map((i) => card(i)).join('')}</div>` : '<div class="note">No results. Try another title.</div>';
}
