// Watches the Plex Watchlist: a film added there (from the PS5, say) is put in the bridge's folder in a copy the PS5
// can play without conversion, then Plex is asked to scan. Needs a one-time sign-in: node src/plex-login.js
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { getConfig, CONFIG_DIR } from './config.js';
import { getStreams } from './torrentio.js';

const SEEN = join(CONFIG_DIR, 'ps5-watchlist-seen.json');
const DISCOVER = 'https://discover.provider.plex.tv';
const PMS = 'http://127.0.0.1:32400';
const EVERY = 1000, AFTER_ERROR = 60000; // back right off if Plex objects to how often we ask

const plex = async (url, token) => {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'X-Plex-Token': token }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Plex answered HTTP ${r.status}`);
  const text = await r.text();
  return text ? JSON.parse(text).MediaContainer : {};
};

// 1080p H.264 without HDR: plays without Plex Pass tone mapping. The bigger the better; the bridge's speed check rejects what can't keep up.
// "Fast & Furious", "Fast.and.Furious" and "Fast and Furious" are the same name
const words = (t) => String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

export function ps5Versions(streams, title = '') {
  const fits = (q) => /1080p/i.test(q) && /x264|h\.?264|avc/i.test(q)
    && !/2160p|HDR|\bDV\b|DoVi|Vision|x265|h\.?265|HEVC|10.?bit|\bCAM\b|TELESYNC|\bTS\b|\b3D\b|DUBBED|\bDUB\b|LEKTOR|NAPISY|TRILOG|DIS[CK].?\d|\bCD.?\d\b|PART.?\d.?OF|\b(19|20)\d\d\s?-\s?(19|20)\d\d\b/i.test(q);
  const gb = (s) => s.sizeBytes / 1e9;
  // a release named after the English title is the safest sign of English audio
  const score = (s) => (title && words(s.quality.split('\n')[0]).startsWith(words(title)) ? 30 : 0) + (/DUAL|MULTI|\bITA\b|\bRUS\b|\bSPA\b|\bFRE\b|\bGER\b|\bHIN/i.test(s.quality) ? -20 : 0)
    + (/DD\+?5|AC-?3|DDP?5|AAC/i.test(s.quality) ? 10 : 0) - (/DTS|TrueHD/i.test(s.quality) ? 3 : 0) + gb(s)
    + Math.min(Number(s.seeds) || 0, 100) / 25; // well-seeded releases first among similar ones (TorBox, not peers, sets the speed)
  return streams.filter((s) => s.url && s.cached && fits(s.quality) && gb(s) > 1).sort((a, b) => score(b) - score(a));
}

// 4K comes first, but only without HDR. Names don't say reliably, so the likely ones are ranked here (SDR named first)
// and each is then read before it is accepted. Up to 75 GB, to fit the bridge's cache.
// AI-enhanced 60 fps releases are the user's favourite look: they go to the front
export const aiSixty = (q) => /60\s?FPS/i.test(q) && /\bAI\b|AI.?(Enhanced|Upscal)|upscal/i.test(q);

const saysSdr = (q) => /(?<![a-z])SDR(?![a-z])|8.?bit/i.test(q);

export function ps5Versions4k(streams, title = '') {
  const no = /\bDV\b|DoVi|Dolby.?Vision|HDR|HLG|\bAV1\b|\bCAM\b|TELESYNC|\b3D\b|DUBBED|\bDUB\b|LEKTOR|NAPISY|TRILOG|DIS[CK].?\d|\bCD.?\d\b|PART.?\d.?OF|\b(19|20)\d\d\s?-\s?(19|20)\d\d\b/i;
  const score = (s) => (aiSixty(s.quality) ? 1000 : 0) + (/\bSDR\b/i.test(s.quality) ? 200 : 0)
    + (title && words(s.quality.split('\n')[0]).startsWith(words(title)) ? 60 : 0)
    - (/DUAL|MULTI|\bITA\b|\bRUS\b|\bSPA|\bFRE\b|\bGER\b|\bHIN/i.test(s.quality) ? 40 : 0)
    + Math.min(Number(s.seeds) || 0, 100) / 2 + s.sizeBytes / 2e9;
  return streams.filter((s) => s.url && s.cached && /2160p/i.test(s.quality) && !no.test(s.quality) && s.sizeBytes > 4e9 && s.sizeBytes < 75e9
    // the name has to SAY standard colour: one that says nothing may well be HDR. The file is still checked.
    && saysSdr(s.quality))
    .sort((a, b) => score(b) - score(a));
}

// What the file really is: true only for 4K H.264/H.265 with no HDR and no Dolby Vision
export async function plain4k(url) {
  const { stdout } = await promisify(execFile)('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=codec_name,width,color_transfer,color_primaries,color_space:stream_side_data=side_data_type', '-of', 'json', url], { timeout: 12000 });
  const v = JSON.parse(stdout).streams?.[0] || {};
  return /^(h264|hevc)$/.test(v.codec_name) && v.width >= 3200 && !/smpte2084|arib-std-b67/.test(v.color_transfer || '')
    && !/bt2020/.test(`${v.color_primaries || ''} ${v.color_space || ''}`) // some HDR files carry only the colour space && !/DOVI/i.test(JSON.stringify(v.side_data_list || ''));
}

// File paths Plex is playing or has paused right now (null when it can't be asked, so nothing gets removed by mistake)
export async function playingNow() {
  const token = getConfig().plex_token;
  if (!token) return null;
  const { Metadata = [] } = await plex(`${PMS}/status/sessions`, token);
  return Metadata.flatMap((m) => [`${m.title} (${m.year})`, ...(m.Media || []).flatMap((v) => (v.Part || []).map((p) => p.file || ''))]);
}

// drop library entries whose files are gone
export async function emptyTrash() {
  const token = getConfig().plex_token;
  if (!token) return;
  const { Directory = [] } = await plex(`${PMS}/library/sections`, token);
  for (const d of Directory) {
    if (!d.Location?.some((l) => l.path.includes('PlexOrbie'))) continue;
    await fetch(`${PMS}/library/sections/${d.key}/emptyTrash`, { method: 'PUT', headers: { 'X-Plex-Token': token }, signal: AbortSignal.timeout(15000) });
  }
}

// With a folder, Plex looks only there: much quicker than going through the whole library
export async function scanPlex(folder) {
  const token = getConfig().plex_token;
  if (!token) return false;
  const { Directory = [] } = await plex(`${PMS}/library/sections`, token);
  for (const d of Directory) {
    const root = d.Location?.find((l) => l.path.includes('PlexOrbie'))?.path;
    if (!root || (folder && !folder.startsWith(root + '/'))) continue;
    await plex(`${PMS}/library/sections/${d.key}/refresh${folder ? `?path=${encodeURIComponent(folder)}` : ''}`, token);
  }
  return true;
}

const label = (s) => `${(s.sizeBytes / 1e9).toFixed(1)} GB  ${s.quality.split('\n')[0].slice(0, 70)}`;
// the reason, with any link (they can carry the TorBox key) taken out
const why = (e) => String(e.cause?.code || e.stderr || e.message || e).replace(/https?:\S+/g, '<link>').split('\n')[0].slice(0, 120);

// Releases the user wants by name (ps5-favorites.json, made from their AI 60fps list). Most are HDR / Dolby Vision, so
// HDR showed wrong on the user's PS5 setup (2026-11-25), so only the copies without HDR are used.
const HDR_FAVORITES = false;
let favorites = {};
try { favorites = JSON.parse(await readFile(new URL('./ps5-favorites.json', import.meta.url), 'utf-8')); } catch {}
export function favoriteCopies(imdb, streams) {
  return (favorites[imdb]?.copies || []).filter((c) => HDR_FAVORITES || (!c.hdr && saysSdr(c.name)))
    .map((c) => { const s = streams.find((x) => x.url && x.cached && x.infoHash === c.hash); return s && { ...s, hdr: c.hdr }; })
    .filter(Boolean);
}

export function watchWatchlist(add, busy = () => false) {
  let checks = 0, listed = 0, reported = Date.now();
  const tries = new Map();
  let seen = null, lastError = '';

  async function check() {
    const token = getConfig().plex_token;
    if (!token) return;
    if (!seen) { try { seen = new Set(JSON.parse(await readFile(SEEN, 'utf-8'))); } catch {} }
    const { Metadata = [], totalSize } = await plex(`${DISCOVER}/library/sections/watchlist/all?sort=watchlistedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=30`, token);
    checks++;
    listed = totalSize ?? Metadata.length;
    if (Date.now() - reported >= 60000) {
      console.log(`Watchlist: ${checks} checks in the last minute, ${listed} film(s) listed`);
      checks = 0;
      reported = Date.now();
    }
    if (!seen) { // first run: what is already on the list stays untouched
      seen = new Set(Metadata.map((m) => m.ratingKey));
      await writeFile(SEEN, JSON.stringify([...seen]));
      console.log(`Watchlist: watching for new films (${seen.size} already listed)`);
      return;
    }
    if (totalSize <= Metadata.length) { // the whole list is in view
      const listed = new Set(Metadata.map((x) => x.ratingKey)), kept = [...seen].filter((k) => listed.has(k));
      if (kept.length < seen.size) { seen = new Set(kept); await writeFile(SEEN, JSON.stringify(kept)); }
    }
    for (const m of Metadata.filter((x) => !seen.has(x.ratingKey))) {
      try {
        if (m.type !== 'movie') console.log(`Watchlist: skipped "${m.title}" (only films for now)`);
        else {
          const meta = (await plex(`${DISCOVER}/library/metadata/${m.ratingKey}`, token)).Metadata?.[0];
          const imdb = meta?.Guid?.find((g) => g.id.startsWith('imdb://'))?.id.slice(7);
          if (!imdb) throw new Error('no IMDb id');
          const began = Date.now(), took = () => `${((Date.now() - began) / 1000).toFixed(1)}s`;
          console.log(`Watchlist: "${m.title}" seen, looking for a copy`);
          const streams = await getStreams(imdb, 'movie');
          console.log(`Watchlist: copies listed after ${took()}`);
          let added = null;
          for (const s of favoriteCopies(imdb, streams)) {
            console.log(`  from your list${s.hdr ? ' (HDR/Dolby Vision)' : ''}: ${label(s)}`);
            // a name without "HDR" proves nothing: read the file before trusting it
            if (!HDR_FAVORITES && !(await plain4k(s.url).catch((e) => { console.log(`    could not read it: ${why(e)}`); return false; }))) { console.log('    passed over (HDR or wide colour, or unreadable)'); continue; }
            added = await add({ url: s.url, title: m.title, year: m.year }).catch((e) => { console.log(`    rejected: ${why(e)}`); return null; });
            if (added) break;
          }
          // at most three 4K files are opened: each one lands in the TorBox list and costs a request
          for (const s of added ? [] : ps5Versions4k(streams, m.title).slice(0, 3)) {
            console.log(`  trying 4K: ${label(s)}`);
            if (!(await plain4k(s.url).catch((e) => { console.log(`    could not read it: ${why(e)}`); return null; }))) { console.log('    passed over (HDR, Dolby Vision, other format, or unreadable)'); continue; }
            added = await add({ url: s.url, title: m.title, year: m.year }).catch((e) => { console.log(`    rejected: ${why(e)}`); return null; });
            if (added) break;
          }
          for (const s of added ? [] : ps5Versions(streams, m.title).slice(0, 5)) {
            console.log(`  trying 1080p: ${label(s)}`);
            added = await add({ url: s.url, title: m.title, year: m.year }).catch((e) => { console.log(`    rejected: ${why(e)}`); return null; });
            if (added) break;
          }
          if (!added) throw new Error('no cached version that fits (4K without HDR, or 1080p H.264)');
          console.log(`Watchlist: added ${added.path} after ${took()}`);
        }
      } catch (e) {
        const n = (tries.get(m.ratingKey) || 0) + 1;
        tries.set(m.ratingKey, n);
        console.error(`Watchlist: "${m.title}": ${e.message} (try ${n} of 3)`);
        if (n < 3) continue;
      }
      seen.add(m.ratingKey);
      await writeFile(SEEN, JSON.stringify([...seen]));
    }
  }

  const loop = async () => {
    let wait = EVERY;
    try { if (!busy()) { await check(); lastError = ''; } } // nothing is checked while a film is on
    catch (e) { wait = AFTER_ERROR; if (e.message !== lastError) console.error('Watchlist:', (lastError = e.message)); }
    setTimeout(loop, wait);
  };
  loop();
}
