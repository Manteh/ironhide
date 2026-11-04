// User settings (profile, appearance, playback), connector status and node status.
import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { userInfo } from 'os';
import { CONFIG_DIR, getConfig, saveConfig } from './config.js';
import { cleanAvatar } from './avatar.js';
import { isMpvRunning, getNowPlaying } from './mpv-ipc.js';

const FILE = join(CONFIG_DIR, 'settings.json');
const WATCHLIST = join(CONFIG_DIR, 'watchlist.json');

const defaults = () => ({
  profile: { name: cap(userInfo().username), avatar: { icon: 'film', color: 'indigo' } },
  appearance: { theme: 'dark', accent: 'indigo', density: 'comfortable', radius: 'round', motion: 'full', posterSize: 'm', layout: 'grid', showHero: true },
  playback: { quality: 'auto', hdr: 'any', remux: 'any', maxSizeGb: 0, cachedOnly: true, player: 'mpv', webMaxHeight: '1080', forceTranscode: false, audioLangs: ['en'], subLang: '', hideKinds: ['threed', 'cam', 'scr'], sortBy: 'qualitysize', resultCount: 60 },
});
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : 'You');

const ALLOWED = {
  appearance: {
    theme: ['dark', 'midnight', 'light', 'system'],
    accent: ['indigo', 'orange', 'emerald', 'rose', 'sky'],
    density: ['comfortable', 'compact'],
    radius: ['sharp', 'round', 'pill'],
    motion: ['full', 'reduced'],
    posterSize: ['xs', 's', 'm', 'l', 'xl'],
    layout: ['grid', 'detail', 'list'],
  },
  playback: {
    quality: ['auto', '2160p', '1080p', '720p'],
    hdr: ['prefer', 'any', 'avoid'],
    remux: ['prefer', 'any', 'avoid'],
    player: ['mpv', 'web'],
    webMaxHeight: ['source', '1080', '720'],
    sortBy: ['qualitysize', 'quality', 'seeders', 'size'],
    resultCount: [20, 60, 100],
  },
};

// Languages a person can prefer: Torrentio's name, the codes used in files, and how releases mention them
export const STREAM_LANGS = {
  en: { name: 'english', iso: ['eng', 'en'], re: /\beng(lish)?\b|\u{1F1EC}\u{1F1E7}|\u{1F1FA}\u{1F1F8}/iu },
  lt: { name: 'lithuanian', iso: ['lit', 'lt'], re: /\blit(uanian)?\b|lietuv|\u{1F1F1}\u{1F1F9}/iu },
  sv: { name: 'swedish', iso: ['swe', 'sv'], re: /\bswe(dish)?\b|\u{1F1F8}\u{1F1EA}/iu },
  es: { name: 'spanish', iso: ['spa', 'es'], re: /\bspa(nish)?\b|castellano|latino|\besp\b|\u{1F1EA}\u{1F1F8}|\u{1F1F2}\u{1F1FD}/iu },
  fr: { name: 'french', iso: ['fre', 'fra', 'fr'], re: /\bfre(nch)?\b|truefrench|\bvff\b|\u{1F1EB}\u{1F1F7}/iu },
  de: { name: 'german', iso: ['ger', 'deu', 'de'], re: /\bger(man)?\b|deutsch|\u{1F1E9}\u{1F1EA}/iu },
  it: { name: 'italian', iso: ['ita', 'it'], re: /\bita(lian)?\b|\u{1F1EE}\u{1F1F9}/iu },
  pt: { name: 'portuguese', iso: ['por', 'pt'], re: /\bpor(tuguese)?\b|\u{1F1F5}\u{1F1F9}|\u{1F1E7}\u{1F1F7}/iu },
  ru: { name: 'russian', iso: ['rus', 'ru'], re: /\brus(sian)?\b|\u{1F1F7}\u{1F1FA}|[\u0430-\u044f]{3}/iu },
  pl: { name: 'polish', iso: ['pol', 'pl'], re: /\bpol(ish)?\b|lektor|\u{1F1F5}\u{1F1F1}/iu },
};
// Kinds of release a person can hide. The ids are Torrentio's; the patterns also cover results from Comet.
export const HIDE_KINDS = {
  '4k': /2160p|\b4k\b|\buhd\b/i, '1080p': /1080p/i, '720p': /720p/i, '480p': /480p/i, brremux: /remux/i, hdrall: /\bhdr/i,
  dolbyvision: /dolby.?vision|\bdv\b|\bdovi\b/i, threed: /\b3d\b|\bh?sbs\b|\bh?ou\b/i, cam: /\bcam\b|hdcam|telesync|\bts\b/i, scr: /\bscr\b|screener/i,
};
export const hiddenKind = (q, hide = []) => hide.some((k) => HIDE_KINDS[k]?.test(q));

let chain = Promise.resolve();
const serialize = (fn) => (chain = chain.then(fn, fn));

export async function getSettings() {
  let saved = {};
  try { saved = JSON.parse(await readFile(FILE, 'utf-8')); } catch {}
  const d = defaults();
  return {
    profile: { ...d.profile, ...saved.profile, avatar: { ...d.profile.avatar, ...saved.profile?.avatar } },
    appearance: { ...d.appearance, ...saved.appearance },
    playback: { ...d.playback, ...saved.playback },
  };
}

export function updateSettings(patch) {
  return serialize(async () => {
    const cur = await getSettings();
    if (patch.profile) {
      const n = String(patch.profile.name ?? cur.profile.name).trim().slice(0, 40);
      cur.profile.name = n || cur.profile.name;
      if (patch.profile.name != null) cur.profile.named = true;
      if (patch.profile.avatar) cur.profile.avatar = cleanAvatar(patch.profile.avatar, cur.profile.avatar);
    }
    for (const section of ['appearance', 'playback']) {
      for (const [k, v] of Object.entries(patch[section] || {})) {
        if (k === 'audioLangs') { if (Array.isArray(v)) cur[section][k] = [...new Set(v)].filter((c) => STREAM_LANGS[c]).slice(0, 4); continue; }
        if (k === 'hideKinds') { if (Array.isArray(v)) cur[section][k] = [...new Set(v)].filter((c) => HIDE_KINDS[c]); continue; }
        if (k === 'subLang') { if (v === '' || v === 'off' || STREAM_LANGS[v]) cur[section][k] = v; continue; }
        const allowed = ALLOWED[section][k];
        if (allowed ? allowed.includes(v) : k in cur[section]) {
          if (k === 'maxSizeGb') cur[section][k] = Math.max(0, Math.min(500, Number(v) || 0));
          else if (k === 'cachedOnly' || k === 'forceTranscode' || k === 'showHero') cur[section][k] = !!v;
          else cur[section][k] = v;
        }
      }
    }
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(FILE + '.tmp', JSON.stringify(cur, null, 2));
    await rename(FILE + '.tmp', FILE);
    return cur;
  });
}

// Sign out: back to a blank profile so the first-run name screen shows again. Keys, appearance and playback stay.
export function resetProfile() {
  return serialize(async () => {
    const cur = await getSettings();
    cur.profile = { ...defaults().profile }; // no `named` flag, default name and avatar
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(FILE + '.tmp', JSON.stringify(cur, null, 2));
    await rename(FILE + '.tmp', FILE);
    return cur;
  });
}

// ---------- Connectors ----------
const mask = (k) => (k ? '••••••••' + k.slice(-4) : '');

export const CONNECTORS = [
  { id: 'torbox', label: 'TorBox', kind: 'debrid', field: 'torbox_api_key', help: 'Instant cached streams. Key from torbox.app/settings.' },
  { id: 'realdebrid', label: 'Real-Debrid', kind: 'debrid', field: 'rd_api_key', help: 'Alternative debrid. Key from real-debrid.com/apitoken.' },
  { id: 'alldebrid', label: 'AllDebrid', kind: 'debrid', field: 'ad_api_key', help: 'Alternative debrid.' },
  { id: 'tmdb', label: 'TMDB', kind: 'metadata', field: 'tmdb_api_key', help: 'Used for search in MCP tools. Free key at themoviedb.org.' },
  { id: 'harvester', label: 'Trakt harvester', kind: 'metadata', field: 'harvester_url', url: true, help: 'Your Trakt catalog service. Powers trending, popular, box office and genres.' },
];

export function connectorsView() {
  const cfg = getConfig();
  return {
    debridProvider: cfg.debrid_provider,
    items: CONNECTORS.map((c) => ({
      id: c.id, label: c.label, kind: c.kind, help: c.help,
      configured: !!cfg[c.field],
      url: !!c.url,
      masked: c.url ? cfg[c.field] : mask(cfg[c.field]),
      active: c.kind === 'debrid' && cfg.debrid_provider === c.id,
    })),
  };
}

export function setConnectorKey(id, key) {
  const c = CONNECTORS.find((x) => x.id === id);
  if (!c) throw new Error('Unknown connector');
  const value = String(key || '').trim();
  const patch = { [c.field]: value || null };
  const cfg = getConfig();
  if (c.kind === 'debrid' && value && cfg.debrid_provider === 'none') patch.debrid_provider = id;
  if (c.kind === 'debrid' && !value && cfg.debrid_provider === id) patch.debrid_provider = 'none';
  saveConfig(patch);
}

export function setDebridProvider(id) {
  if (!['torbox', 'realdebrid', 'alldebrid', 'none'].includes(id)) throw new Error('Unknown provider');
  saveConfig({ debrid_provider: id });
}

async function timed(fn) {
  const t = Date.now();
  try { const r = await fn(); return { ...r, latencyMs: Date.now() - t }; }
  catch (e) { return { status: 'error', detail: e.name === 'TimeoutError' ? 'Timed out' : 'Unreachable', latencyMs: Date.now() - t }; }
}
const get = (url, headers, ms = 6000) => fetch(url, { headers, signal: AbortSignal.timeout(ms) });

const TESTS = {
  async torbox(key) {
    if (!key) return { status: 'unconfigured', detail: 'No key' };
    const d = await (await get('https://api.torbox.app/v1/api/user/me', { Authorization: `Bearer ${key}` })).json();
    if (!d.success) return { status: 'error', detail: 'Invalid key' };
    return { status: 'online', detail: d.data?.plan > 0 ? `Active · plan ${d.data.plan}` : 'Free tier' };
  },
  async realdebrid(key) {
    if (!key) return { status: 'unconfigured', detail: 'No key' };
    const r = await get('https://api.real-debrid.com/rest/1.0/user', { Authorization: `Bearer ${key}` });
    if (!r.ok) return { status: 'error', detail: 'Invalid key' };
    const d = await r.json();
    return { status: 'online', detail: d.type === 'premium' ? `Premium · ${Math.floor((d.premium || 0) / 86400)}d left` : 'Free / expired' };
  },
  async alldebrid(key) {
    if (!key) return { status: 'unconfigured', detail: 'No key' };
    const d = await (await get(`https://api.alldebrid.com/v4/user?agent=ironhide&apikey=${encodeURIComponent(key)}`)).json();
    return d.status === 'success' ? { status: 'online', detail: d.data?.user?.isPremium ? 'Premium' : 'Free' } : { status: 'error', detail: 'Invalid key' };
  },
  async tmdb(key) {
    if (!key) return { status: 'unconfigured', detail: 'No key' };
    const r = await get(`https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`);
    return r.ok ? { status: 'online', detail: 'Key valid' } : { status: 'error', detail: 'Invalid key' };
  },
  async harvester(url) {
    const r = await get(`${(url || getConfig().harvester_url).replace(/\/+$/, '')}/manifest.json`, {}, 45000);
    if (!r.ok) return { status: 'error', detail: `HTTP ${r.status}` };
    const m = await r.json();
    return m.catalogs ? { status: 'online', detail: `${m.catalogs.length} categories` } : { status: 'error', detail: 'Not a catalog service' };
  },
  async cinemeta() { const r = await get('https://v3-cinemeta.strem.io/manifest.json'); return r.ok ? { status: 'online', detail: 'Catalog & metadata' } : { status: 'error', detail: `HTTP ${r.status}` }; },
  async torrentio() { const r = await get('https://torrentio.strem.fun/manifest.json'); return r.ok ? { status: 'online', detail: 'Stream index' } : { status: 'error', detail: `HTTP ${r.status}` }; },
  async comet() { const r = await get('https://comet.elfhosted.com/manifest.json'); return r.ok ? { status: 'online', detail: 'Stream index' } : { status: 'error', detail: `HTTP ${r.status}` }; },
  async subtitles() { const r = await get('https://opensubtitles-v3.strem.io/manifest.json'); return r.ok ? { status: 'online', detail: 'Subtitles' } : { status: 'error', detail: `HTTP ${r.status}` }; },
};

export function testConnector(id, keyOverride) {
  const c = CONNECTORS.find((x) => x.id === id);
  const key = keyOverride ?? (c ? getConfig()[c.field] : undefined);
  if (!TESTS[id]) throw new Error('Unknown connector');
  return timed(() => TESTS[id](key));
}

// ---------- Nodes ----------
let nodeCache = { at: 0, value: null };

export async function getNodes(force = false) {
  if (!force && nodeCache.value && Date.now() - nodeCache.at < 20000) return nodeCache.value;
  const cfg = getConfig();
  const active = cfg.debrid_provider;

  const [mpvRunning, torbox, realdebrid, alldebrid, cinemeta, torrentio, comet, subtitles, harvester] = await Promise.all([
    Promise.resolve(isMpvRunning()).catch(() => false),
    testConnector('torbox'), testConnector('realdebrid'), testConnector('alldebrid'),
    testConnector('cinemeta'), testConnector('torrentio'), testConnector('comet'), testConnector('subtitles'),
    testConnector('harvester'),
  ]);
  const np = mpvRunning ? await getNowPlaying().catch(() => null) : null;
  const mpvPath = ['/opt/homebrew/bin/mpv', '/usr/local/bin/mpv'].find(existsSync);

  const debrid = { torbox, realdebrid, alldebrid };
  const nodes = [
    { id: 'mac', group: 'players', name: 'This Mac', sub: 'mpv player', status: mpvPath ? 'online' : 'error', detail: np ? `Playing: ${np.title}` : mpvPath ? 'Idle' : 'mpv not installed', busy: !!np },
    ...['torbox', 'realdebrid', 'alldebrid'].map((id) => ({
      id, group: 'debrid', name: { torbox: 'TorBox', realdebrid: 'Real-Debrid', alldebrid: 'AllDebrid' }[id], sub: id === active ? 'Active debrid' : 'Debrid',
      ...debrid[id], active: id === active, configurable: true,
    })).filter((n) => n.status !== 'unconfigured' || n.active),
    { id: 'cinemeta', group: 'sources', name: 'Cinemeta', sub: 'Catalog', ...cinemeta },
    { id: 'harvester', group: 'sources', name: 'Trakt harvester', sub: 'Category feeds', ...harvester, configurable: true },
    { id: 'torrentio', group: 'sources', name: 'Torrentio', sub: 'Streams', ...torrentio },
    { id: 'comet', group: 'sources', name: 'Comet', sub: 'Streams', ...comet },
    { id: 'subtitles', group: 'sources', name: 'OpenSubtitles', sub: 'Subtitles', ...subtitles },
  ];
  nodeCache = { at: Date.now(), value: nodes };
  return nodes;
}

// ---------- Preferred-quality pick ----------
export function pickBest(streams, p, { exclude = new Set(), browserSafe = false } = {}) {
  const res = (s) => (s.quality.match(/2160p|4k|1080p|720p|480p/i) || [''])[0].toLowerCase().replace('4k', '2160p');
  const rank = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1, '': 0 };
  let pool = streams.filter((s) => (p.cachedOnly ? s.cached : true) && !exclude.has(streams.indexOf(s) + 1));
  if (!pool.length) pool = streams.filter((s) => !exclude.has(streams.indexOf(s) + 1));
  if (!pool.length) return null;
  const score = (s) => {
    let v = 0;
    const r = res(s), q = s.quality;
    if (p.quality === 'auto') v += rank[r] * 10;
    else v += r === p.quality ? 100 : -Math.abs(rank[r] - rank[p.quality]) * 20;
    const hdr = /hdr|dv|dolby.?vision|dovi/i.test(q);
    if (p.hdr === 'prefer' && hdr) v += 25; if (p.hdr === 'avoid' && hdr) v -= 40;
    const remux = /remux/i.test(q);
    if (p.remux === 'prefer' && remux) v += 20; if (p.remux === 'avoid' && remux) v -= 40;
    if (p.maxSizeGb > 0 && s.sizeBytes > p.maxSizeGb * 1e9) v -= 200;
    if (/\bDUAL\b|DUBBED|\bDUB\b/i.test(q)) v -= 30;
    if (/CAM|TELESYNC|\bTS\b|HDCAM/i.test(q)) v -= 300;
    if (/\b3D\b|\bH?SBS\b|\bH?OU\b/i.test(q)) v -= 300; // two pictures in one frame: only right on a 3D screen
    if (browserSafe) { // files a browser can play untouched: mp4 with h264 + AAC
      if (/h\.?264|x264|avc/i.test(q)) v += 60;
      if (/hevc|x265|h\.?265|10.?bit|remux|av1/i.test(q)) v -= 80;
      if (/dts|truehd|atmos|dd\+|ddp|eac3|ac3/i.test(q)) v -= 50;
      if (/\.mkv\b/i.test(q)) v -= 20;
      if (r === '2160p') v -= 60;
    }
    // Your audio languages. Releases rarely mention English, so no language tag counts as probably original audio.
    const pref = p.audioLangs || [];
    if (pref.length) {
      const tags = Object.keys(STREAM_LANGS).filter((c) => STREAM_LANGS[c].re.test(q)), at = pref.findIndex((c) => tags.includes(c));
      if (tags.length) v += at === 0 ? 30 : at > 0 ? 15 : -40;
      else if (pref[0] !== 'en') v += /\bmulti\b/i.test(q) ? 10 : -10;
    }
    v += Math.min(s.seeds, 500) / 100;
    return v;
  };
  let best = null, bestScore = -Infinity;
  for (const s of pool) { const sc = score(s); if (sc > bestScore) { best = s; bestScore = sc; } }
  return best ? streams.indexOf(best) + 1 : null; // 1-based index
}

// ---------- Watchlist ----------
export async function getWatchlist() {
  try { return JSON.parse(await readFile(WATCHLIST, 'utf-8')); } catch { return []; }
}
export function toggleWatchlist(item) {
  return serialize(async () => {
    const list = await getWatchlist();
    const i = list.findIndex((x) => x.imdbId === item.imdbId);
    if (i >= 0) list.splice(i, 1);
    else list.unshift({ imdbId: item.imdbId, type: item.type, title: item.title, year: item.year, poster: item.poster, rating: item.rating });
    await mkdir(CONFIG_DIR, { recursive: true });
    await writeFile(WATCHLIST + '.tmp', JSON.stringify(list, null, 2));
    await rename(WATCHLIST + '.tmp', WATCHLIST);
    return { saved: i < 0, list };
  });
}
