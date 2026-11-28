// Collections on the shelf: folders of titles in an order that makes sense to watch them.
// A folder is { id, name, blurb, items: [{ imdbId, type, title, year, poster, note }], orders: { release: [ids], story: [ids] }, order, preset? }.
// Presets are whole franchises with their orders worked out (ids checked against TMDB), added in one go.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CONFIG_DIR, getConfig } from './config.js';

const FILE = join(CONFIG_DIR, 'folders.json');
let chain = Promise.resolve();
const serialize = (fn) => (chain = chain.then(fn, fn));
const load = async () => { try { return JSON.parse(await readFile(FILE, 'utf8')); } catch { return []; } };
const save = async (list) => { await mkdir(CONFIG_DIR, { recursive: true }); const tmp = FILE + '.tmp'; await writeFile(tmp, JSON.stringify(list, null, 2)); await rename(tmp, FILE); };

export const PRESETS = {
  lotr: {
    name: 'The Lord of the Rings',
    aka: ['lord of the rings', 'lotr', 'the hobbit', 'middle earth', 'middle-earth', 'tolkien'],
    blurb: 'Middle-earth, all of it: the trilogy, The Hobbit, the series and the animated film.',
    order: 'release',
    orders: { release: ['tt0120737', 'tt0167261', 'tt0167260', 'tt0903624', 'tt1170358', 'tt2310332', 'tt7631058', 'tt14824600'], story: ['tt7631058', 'tt0903624', 'tt1170358', 'tt2310332', 'tt14824600', 'tt0120737', 'tt0167261', 'tt0167260'] },
    orderNotes: { release: 'The order they were made. Best for a first watch: The Hobbit and the series lean on what the trilogy sets up.', story: 'The order the story happens in, from the Second Age to the War of the Ring. Best for a rewatch.' },
    notes: {
      tt0120737: 'The trilogy begins: a hobbit, a ring and nine walkers.', tt0167261: 'The fellowship splits; Helm’s Deep.', tt0167260: 'The war ends. Extended cuts are worth it.',
      tt0903624: 'Bilbo’s adventure, sixty years before the trilogy.', tt1170358: 'The dragon, the lake and the Necromancer.', tt2310332: 'The Battle of the Five Armies; leads straight into Fellowship.',
      tt7631058: 'Thousands of years earlier: how the rings were forged. Season 2 is out too.', tt14824600: 'Animated: Helm Hammerhand and the origin of Helm’s Deep. Optional.',
    },
  },
};

const tmdb = async (path) => { const r = await fetch(`https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${getConfig().tmdb_api_key}`, { signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error(`TMDB ${r.status}`); return r.json(); };
// what a title is called, when it came out, and its poster, from its IMDb id
export async function describe(imdbId) {
  const r = await tmdb(`/find/${imdbId}?external_source=imdb_id`), x = r.movie_results?.[0] || r.tv_results?.[0]; if (!x) return null;
  const tv = !!r.tv_results?.[0];
  return { imdbId, type: tv ? 'series' : 'movie', title: x.title || x.name, year: (x.release_date || x.first_air_date || '').slice(0, 4), poster: x.poster_path ? `https://image.tmdb.org/t/p/w342${x.poster_path}` : '' };
}

export const listFolders = () => serialize(load);
export const findPreset = (q) => { const t = String(q || '').toLowerCase().trim(); return Object.entries(PRESETS).find(([id, p]) => id === t || p.name.toLowerCase() === t || p.aka.some((a) => t.includes(a) || (t.length >= 4 && a.includes(t))))?.[0] || null; };

export function addPreset(key) {
  return serialize(async () => {
    const P = PRESETS[key]; if (!P) throw new Error('Unknown collection');
    const all = [...new Set([...P.orders.release, ...P.orders.story])];
    const items = (await Promise.all(all.map((id) => describe(id).catch(() => null)))).filter(Boolean).map((it) => ({ ...it, note: P.notes[it.imdbId] || '' }));
    if (items.length < 2) throw new Error('Could not load the titles right now. Try again in a moment.');
    const list = await load(), folder = { id: key, name: P.name, blurb: P.blurb, preset: key, items, orders: P.orders, orderNotes: P.orderNotes, order: P.order, createdAt: Date.now() };
    const i = list.findIndex((f) => f.id === key); if (i >= 0) list[i] = { ...folder, createdAt: list[i].createdAt }; else list.push(folder);
    await save(list); return folder;
  });
}
export function createFolder({ name, items = [] }) {
  return serialize(async () => {
    const nm = String(name || '').trim().slice(0, 60); if (!nm) throw new Error('Give the collection a name');
    const list = await load(), id = `c_${randomBytes(4).toString('hex')}`;
    const its = items.filter((x) => /^tt\d+$/.test(x.imdbId || '')).map((x) => ({ imdbId: x.imdbId, type: x.type === 'tv' || x.type === 'series' ? 'series' : 'movie', title: x.title || '', year: x.year || '', poster: x.poster || '', note: '' }));
    const folder = { id, name: nm, blurb: '', items: its, orders: { release: its.map((x) => x.imdbId) }, order: 'release', createdAt: Date.now() };
    list.push(folder); await save(list); return folder;
  });
}
const edit = (id, fn) => serialize(async () => { const list = await load(), f = list.find((x) => x.id === id); if (!f) throw new Error('No such collection'); const out = fn(f, list); await save(list); return out ?? f; });
export const renameFolder = (id, name) => edit(id, (f) => { f.name = String(name || '').trim().slice(0, 60) || f.name; });
export const setOrder = (id, order) => edit(id, (f) => { if (f.orders?.[order]) f.order = order; });
export const addItem = (id, it) => edit(id, (f) => {
  if (!/^tt\d+$/.test(it?.imdbId || '')) throw new Error('Bad title'); if (f.items.some((x) => x.imdbId === it.imdbId)) return;
  f.items.push({ imdbId: it.imdbId, type: it.type === 'tv' || it.type === 'series' ? 'series' : 'movie', title: it.title || '', year: it.year || '', poster: it.poster || '', note: '' });
  for (const k of Object.keys(f.orders || {})) f.orders[k].push(it.imdbId); if (!f.orders?.release) f.orders = { release: f.items.map((x) => x.imdbId) };
});
export const removeItem = (id, imdbId) => edit(id, (f) => { f.items = f.items.filter((x) => x.imdbId !== imdbId); for (const k of Object.keys(f.orders || {})) f.orders[k] = f.orders[k].filter((x) => x !== imdbId); });
export const moveItem = (id, imdbId, dir) => edit(id, (f) => { const o = f.orders[f.order] || (f.orders[f.order] = f.items.map((x) => x.imdbId)), i = o.indexOf(imdbId), j = i + (dir < 0 ? -1 : 1); if (i < 0 || j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; });
export const deleteFolder = (id) => serialize(async () => { await save((await load()).filter((f) => f.id !== id)); return { ok: true }; });
