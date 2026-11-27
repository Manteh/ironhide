// Subtitles: find several candidates per language, pick the one that was made for the release being played,
// download it, check it is a real subtitle file (right text encoding, real timings), and fall back to the next one if not.
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { getSettings, STREAM_LANGS } from './settings.js';

const BASE = 'https://opensubtitles-v3.strem.io';
const LANGS = ['lit', 'eng', 'swe'];
const TRIES = 4; // candidates tried per language before giving up on it

// source kinds that rarely sync with each other: a cam subtitle drifts against a Blu-ray
const SRC = [['remux|blu-?ray|bdrip|brrip|\\bbd\\b|uhd', 'bluray'], ['web-?dl|webrip|\\bweb\\b|amzn|nf\\b|dsnp|hmax|atvp', 'web'], ['hdtv|pdtv|tvrip', 'tv'], ['dvdrip|dvd', 'dvd'], ['dvdscr|scr\\b', 'scr'], ['hdcam|\\bcam|telesync|\\bts\\b|\\btc\\b|hdts', 'cam']];
const kind = (s) => SRC.find(([re]) => new RegExp(re, 'i').test(s))?.[1] || '';
const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1));
const group = (s) => /-([a-z0-9]{2,14})(?:\.\w{2,4})?\s*$/i.exec(String(s || '').trim())?.[1]?.toLowerCase() || '';

// how well a subtitle's release name fits the file being played (higher is better)
export function score(sub, hint) {
  const rel = sub.movieReleaseName || sub.subtitleFileName || '', hk = kind(hint), sk = kind(rel);
  let s = 0;
  if (hint) {
    const a = words(hint), b = words(rel); let hit = 0; for (const w of b) if (a.has(w)) hit++; s += Math.min(hit, 8) * 2;
    if (hk && sk) s += hk === sk ? 12 : (hk === 'bluray' && sk === 'web') || (hk === 'web' && sk === 'bluray') ? 2 : -6;
    const g = group(hint); if (g && g === group(rel)) s += 15;
  }
  if (sk === 'cam' || sk === 'scr') s -= hint && (kind(hint) === 'cam' || kind(hint) === 'scr') ? 0 : 10; // never the first choice for a proper release
  if (/hearing|\bsdh\b|\bhi\b/i.test(rel)) s -= 1;
  return s;
}

// decode bytes to text: UTF-8 if it is, else the encoding the provider says it is (Lithuanian, Polish, Greek ... often are not UTF-8)
function decode(buf, enc) {
  let t = new TextDecoder('utf-8').decode(buf);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const bad = (t.match(/�/g) || []).length;
  if (bad > Math.max(3, t.length / 400)) {
    const labels = [enc && String(enc).toLowerCase().replace(/^cp/, 'windows-'), 'windows-1257', 'windows-1250', 'windows-1252'].filter(Boolean);
    for (const l of labels) { try { const x = new TextDecoder(l).decode(buf); if ((x.match(/�/g) || []).length < bad) { t = x; break; } } catch {} }
  }
  return t;
}
// a real subtitle file has many timed cues, and is not a web page or an error message
const valid = (t) => !/^\s*<(!doctype|html)/i.test(t) && (t.match(/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}/g) || []).length >= 15;

const cache = new Map(); // candidate lists for a title, so a second look is instant
async function candidates(imdbId, season, episode, hint) {
  const id = season != null && episode != null ? `series/${imdbId}:${season}:${episode}` : `movie/${imdbId}`;
  const extra = hint ? `/filename=${encodeURIComponent(String(hint).slice(0, 180))}` : '';
  const key = id + extra, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60e3) return hit.list;
  const tryUrl = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(12000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()).subtitles || []; };
  let list = [];
  try { list = await tryUrl(`${BASE}/subtitles/${id}${extra}.json`); } catch { try { list = await tryUrl(`${BASE}/subtitles/${id}.json`); } catch {} }
  list = list.filter((s) => s?.url && s.lang);
  cache.set(key, { at: Date.now(), list });
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  return list;
}

// hint: the release name of the stream that is about to play (so the subtitle can be matched to it)
export async function fetchSubtitles(imdbId, season, episode, hint = '') {
  const all = await candidates(imdbId, season, episode, hint);
  if (!all.length) return [];
  const mine = STREAM_LANGS[(await getSettings()).playback.subLang]?.iso[0];
  const langs = [...new Set(mine ? [mine, ...LANGS] : LANGS)];
  const one = async (lang) => {
    const pool = all.filter((s) => s.lang === lang).map((s) => ({ s, p: score(s, hint) })).sort((a, b) => b.p - a.p).slice(0, TRIES);
    for (const { s } of pool) {
      try {
        const r = await fetch(s.url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) continue;
        const text = decode(Buffer.from(await r.arrayBuffer()), s.SubEncoding); if (!valid(text)) continue;
        const path = join(tmpdir(), `ironhide-${imdbId}-${season ?? 0}x${episode ?? 0}-${lang}-${String(s.id).replace(/\W/g, '')}.srt`);
        await writeFile(path, text);
        return { lang, path, release: s.movieReleaseName || '' };
      } catch { /* next candidate */ }
    }
    return null;
  };
  return (await Promise.all(langs.map(one))).filter(Boolean);
}
