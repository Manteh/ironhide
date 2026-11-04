import { getConfig, debridKey } from './config.js';
import { getSettings, STREAM_LANGS, HIDE_KINDS } from './settings.js';

const SERVICE_SLUG = { torbox: 'torbox', realdebrid: 'realdebrid', alldebrid: 'alldebrid' };

// What this person asked for in Settings, Streams, in Torrentio's own format
function torrentioOpts(pb) {
  const hide = (pb.hideKinds || []).filter((k) => HIDE_KINDS[k]), langs = (pb.audioLangs || []).filter((c) => c !== 'en' && STREAM_LANGS[c]).map((c) => STREAM_LANGS[c].name);
  return [hide.length ? `qualityfilter=${hide.join(',')}` : '', `sort=${pb.sortBy || 'qualitysize'}`, langs.length ? `language=${langs.join(',')}` : ''].filter(Boolean).join('|') + '|';
}
function torrentioBase(custom = '') {
  const cfg = getConfig();
  const key = debridKey(cfg);
  const slug = SERVICE_SLUG[cfg.debrid_provider];
  // Hosted mode plays in the browser, so skip releases no browser can decode (4K/HDR/DV/remux)
  const opts = process.env.IRONHIDE_HOSTED === '1' ? 'qualityfilter=brremux,hdrall,dolbyvision,4k,scr,cam|sort=qualitysize|' : custom;
  return slug && key ? `https://torrentio.strem.fun/${opts}${slug}=${key}` : 'https://torrentio.strem.fun';
}

// Comet (debrid-aware indexer), same source nitrate merges with Torrentio.
function cometUrl(path) {
  const cfg = getConfig();
  const key = debridKey(cfg);
  const service = { torbox: 'torbox', realdebrid: 'realdebrid' }[cfg.debrid_provider];
  if (!service || !key) return null;
  const b64 = Buffer.from(JSON.stringify({ debridServices: [{ service, apiKey: key }] })).toString('base64');
  return `https://comet.elfhosted.com/${b64}/${path}`;
}

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://exodus.desync.com:6969/announce',
];

function parseStream(s) {
  const isRD = !!s.url;
  const lines = (s.title || '').split('\n');

  // Extract info from the title lines
  let seeds = 0;
  let size = '';
  for (const line of lines) {
    const seedMatch = line.match(/👤\s*(\d+)/);
    if (seedMatch) seeds = parseInt(seedMatch[1], 10);
    const sizeMatch = line.match(/💾\s*([\d.]+\s*[GMKT]B)/i);
    if (sizeMatch) size = sizeMatch[1];
  }

  // Parse size to bytes for sorting
  let sizeBytes = 0;
  const sizeNumMatch = size.match(/([\d.]+)\s*(GB|MB|TB|KB)/i);
  if (sizeNumMatch) {
    const num = parseFloat(sizeNumMatch[1]);
    const unit = sizeNumMatch[2].toUpperCase();
    if (unit === 'TB') sizeBytes = num * 1e12;
    else if (unit === 'GB') sizeBytes = num * 1e9;
    else if (unit === 'MB') sizeBytes = num * 1e6;
    else if (unit === 'KB') sizeBytes = num * 1e3;
  }

  // Source and quality from the name field
  const name = s.name || '';
  const qualityLine = lines[0] || '';

  // Build magnet for non-RD streams
  let magnet = null;
  if (!isRD && s.infoHash) {
    const trackerParams = TRACKERS.map(t => `&tr=${encodeURIComponent(t)}`).join('');
    magnet = `magnet:?xt=urn:btih:${s.infoHash}${trackerParams}`;
  }

  const cached = /\[(TB|RD|AD)\+\]|⚡/.test(s.name || '');

  return {
    isRD,
    cached,
    url: s.url || null,
    magnet,
    name,
    quality: qualityLine,
    seeds,
    size,
    sizeBytes,
    infoHash: s.infoHash || null,
    fileIdx: s.fileIdx != null ? s.fileIdx : null,
  };
}

async function fetchStreams(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    return (await res.json()).streams || [];
  } catch {
    return [];
  }
}

export async function getStreams(imdbId, type = 'movie', season, episode) {
  const path = type === 'tv' && season != null && episode != null
    ? `stream/series/${imdbId}:${season}:${episode}.json`
    : `stream/movie/${imdbId}.json`;

  const comet = cometUrl(path);
  const [fromTorrentio, fromComet] = await Promise.all([
    fetchStreams(`${torrentioBase(torrentioOpts((await getSettings()).playback))}/${path}`),
    comet ? fetchStreams(comet) : [],
  ]);

  const seen = new Set();
  const raw = [...fromComet, ...fromTorrentio].filter((s) => {
    // Drop provider error placeholders (expired key, not cached, etc.)
    const label = `${s.name || ''} ${s.title || ''} ${s.url || ''}`;
    if (/(TB|RD|AD) error|failed_access|Expired/i.test(label)) return false;
    const id = s.infoHash ? `${s.infoHash}:${s.fileIdx ?? ''}` : s.url;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (raw.length === 0) return [];

  const streams = raw.map(parseStream);

  // Sort: deprioritize DUAL/dubbed, debrid first, then by size, then seeds
  const isDual = (q) => /\bDUAL\b|DUBBED|\bDUB\b/i.test(q);
  streams.sort((a, b) => {
    const aDual = isDual(a.quality);
    const bDual = isDual(b.quality);
    if (aDual && !bDual) return 1;
    if (!aDual && bDual) return -1;
    if (a.cached !== b.cached) return a.cached ? -1 : 1;
    if (a.isRD && !b.isRD) return -1;
    if (!a.isRD && b.isRD) return 1;
    if (b.sizeBytes !== a.sizeBytes) return b.sizeBytes - a.sizeBytes;
    return b.seeds - a.seeds;
  });

  return streams;
}
