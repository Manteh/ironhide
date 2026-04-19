import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';

const PREFS_DIR = join(homedir(), '.config', 'ironhide');
const PREFS_FILE = join(PREFS_DIR, 'preferences.json');

async function loadPrefs() {
  try {
    const data = await readFile(PREFS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function savePrefs(prefs) {
  await mkdir(PREFS_DIR, { recursive: true });
  await writeFile(PREFS_FILE, JSON.stringify(prefs, null, 2));
}

// Save which stream the user picked for a title
// Learns: resolution preference, size range, source preference
export async function learnQuality(imdbId, stream) {
  const prefs = await loadPrefs();

  // Extract resolution from name/quality
  let resolution = 'unknown';
  const q = (stream.quality || '') + ' ' + (stream.name || '');
  if (/2160p|4k|uhd/i.test(q)) resolution = '4k';
  else if (/1080p/i.test(q)) resolution = '1080p';
  else if (/720p/i.test(q)) resolution = '720p';
  else if (/480p/i.test(q)) resolution = '480p';

  const entry = {
    resolution,
    sizeBytes: stream.sizeBytes || 0,
    isRD: stream.isRD || false,
    pickedAt: new Date().toISOString(),
  };

  if (!prefs[imdbId]) {
    prefs[imdbId] = { picks: [] };
  }

  prefs[imdbId].picks.push(entry);
  // Keep last 5 picks per title
  if (prefs[imdbId].picks.length > 5) {
    prefs[imdbId].picks = prefs[imdbId].picks.slice(-5);
  }

  await savePrefs(prefs);
}

// Get the user's preferred quality for a title
// Returns { resolution, minSize, maxSize } or null
export async function getQualityPreference(imdbId) {
  const prefs = await loadPrefs();
  const titlePrefs = prefs[imdbId];
  if (!titlePrefs || titlePrefs.picks.length === 0) return null;

  // Most recent resolution wins
  const resolutions = titlePrefs.picks.map(p => p.resolution);
  const lastRes = resolutions[resolutions.length - 1];

  // Size range from picks with same resolution
  const samRes = titlePrefs.picks.filter(p => p.resolution === lastRes && p.sizeBytes > 0);
  let minSize = 0;
  let maxSize = Infinity;
  if (samRes.length > 0) {
    const sizes = samRes.map(p => p.sizeBytes);
    // Allow 50% below to 50% above their typical pick
    const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    minSize = avgSize * 0.5;
    maxSize = avgSize * 1.5;
  }

  return { resolution: lastRes, minSize, maxSize, prefersRD: true };
}

// Get global default quality (across all titles)
export async function getGlobalPreference() {
  const prefs = await loadPrefs();
  const allPicks = Object.values(prefs).flatMap(p => p.picks || []);
  if (allPicks.length === 0) return null;

  // Count resolution frequencies
  const resCounts = {};
  allPicks.forEach(p => {
    resCounts[p.resolution] = (resCounts[p.resolution] || 0) + 1;
  });

  // Most common resolution
  const resolution = Object.entries(resCounts).sort((a, b) => b[1] - a[1])[0][0];

  const samRes = allPicks.filter(p => p.resolution === resolution && p.sizeBytes > 0);
  let avgSize = 0;
  if (samRes.length > 0) {
    avgSize = samRes.reduce((a, b) => a + b.sizeBytes, 0) / samRes.length;
  }

  return { resolution, avgSize, totalPicks: allPicks.length };
}
