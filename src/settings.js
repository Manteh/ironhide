// User settings (profile, appearance, playback), connector status and node status.
import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { userInfo } from 'os';
import { CONFIG_DIR, getConfig, saveConfig } from './config.js';
import { isMpvRunning, getNowPlaying } from './mpv-ipc.js';

const FILE = join(CONFIG_DIR, 'settings.json');
const WATCHLIST = join(CONFIG_DIR, 'watchlist.json');

const defaults = () => ({
  profile: { name: cap(userInfo().username), avatar: { icon: 'film', color: 'indigo' } },
  appearance: { theme: 'dark', accent: 'indigo', density: 'comfortable', radius: 'round', motion: 'full', posterSize: 'm' },
  playback: { quality: 'auto', hdr: 'any', remux: 'any', maxSizeGb: 0, cachedOnly: true },
});
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : 'You');

const ALLOWED = {
  appearance: {
    theme: ['dark', 'midnight', 'light', 'system'],
    accent: ['indigo', 'orange', 'emerald', 'rose', 'sky'],
    density: ['comfortable', 'compact'],
    radius: ['sharp', 'round', 'pill'],
    motion: ['full', 'reduced'],
    posterSize: ['s', 'm', 'l'],
  },
  playback: {
    quality: ['auto', '2160p', '1080p', '720p'],
    hdr: ['prefer', 'any', 'avoid'],
    remux: ['prefer', 'any', 'avoid'],
  },
};

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
      if (patch.profile.avatar) {
        const { icon, color } = patch.profile.avatar;
        if (typeof icon === 'string' && /^[a-z-]{1,20}$/.test(icon)) cur.profile.avatar.icon = icon;
        if (typeof color === 'string' && /^[a-z]{1,12}$/.test(color)) cur.profile.avatar.color = color;
      }
    }
    for (const section of ['appearance', 'playback']) {
      for (const [k, v] of Object.entries(patch[section] || {})) {
        const allowed = ALLOWED[section][k];
        if (allowed ? allowed.includes(v) : k in cur[section]) {
          if (k === 'maxSizeGb') cur[section][k] = Math.max(0, Math.min(500, Number(v) || 0));
          else if (k === 'cachedOnly') cur[section][k] = !!v;
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
export function pickBest(streams, p) {
  const res = (s) => (s.quality.match(/2160p|4k|1080p|720p|480p/i) || [''])[0].toLowerCase().replace('4k', '2160p');
  const rank = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1, '': 0 };
  let pool = streams.filter((s) => (p.cachedOnly ? s.cached : true));
  if (!pool.length) pool = streams;
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
