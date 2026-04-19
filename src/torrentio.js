import { RD_API_KEY as RD_KEY } from './config.js';
const BASE = `https://torrentio.strem.fun/realdebrid=${RD_KEY}`;

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

  return {
    isRD,
    url: s.url || null,
    magnet,
    name,
    quality: qualityLine,
    seeds,
    size,
    sizeBytes,
    infoHash: s.infoHash || null,
  };
}

export async function getStreams(imdbId, type = 'movie', season, episode) {
  let path;
  if (type === 'tv' && season != null && episode != null) {
    path = `stream/series/${imdbId}:${season}:${episode}.json`;
  } else {
    path = `stream/movie/${imdbId}.json`;
  }

  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) return [];

  const data = await res.json();
  if (!data.streams || data.streams.length === 0) return [];

  const streams = data.streams.map(parseStream);

  // Sort: deprioritize DUAL/dubbed, RD first, then by size, then seeds
  const isDual = (q) => /\bDUAL\b|DUBBED|\bDUB\b/i.test(q);
  streams.sort((a, b) => {
    const aDual = isDual(a.quality);
    const bDual = isDual(b.quality);
    if (aDual && !bDual) return 1;
    if (!aDual && bDual) return -1;
    if (a.isRD && !b.isRD) return -1;
    if (!a.isRD && b.isRD) return 1;
    if (b.sizeBytes !== a.sizeBytes) return b.sizeBytes - a.sizeBytes;
    return b.seeds - a.seeds;
  });

  return streams;
}
