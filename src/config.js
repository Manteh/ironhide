import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { DEFAULT_RELAY } from './relay-default.js';

export const CONFIG_DIR = process.env.IRONHIDE_HOME || join(homedir(), '.config', 'ironhide');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

// Read fresh each call so edits from the web UI apply without a restart.
export function getConfig() {
  let file = {};
  try { file = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  const env = process.env;
  const cfg = {
    tmdb_api_key: env.TMDB_API_KEY || file.tmdb_api_key || '',
    torbox_api_key: env.TORBOX_API_KEY || file.torbox_api_key || '',
    rd_api_key: env.RD_API_KEY || file.rd_api_key || '',
    ad_api_key: env.AD_API_KEY || file.ad_api_key || '',
    relay_url: env.IRONHIDE_RELAY || file.relay_url || DEFAULT_RELAY,
    harvester_url: (env.HARVESTER_URL || file.harvester_url || 'https://stremio-trakt-stealth-harvester.onrender.com').replace(/\/+$/, ''),
  };
  // Which debrid service to use. Explicit choice wins; otherwise first key found.
  let provider = file.debrid_provider;
  if (env.NO_DEBRID === '1' || file.no_debrid === true) provider = provider || 'none';
  if (!provider) provider = cfg.torbox_api_key ? 'torbox' : cfg.rd_api_key ? 'realdebrid' : cfg.ad_api_key ? 'alldebrid' : 'none';
  cfg.debrid_provider = provider;
  return cfg;
}

export function debridKey(cfg = getConfig()) {
  return { torbox: cfg.torbox_api_key, realdebrid: cfg.rd_api_key, alldebrid: cfg.ad_api_key }[cfg.debrid_provider] || '';
}

// Merge a patch into config.json (atomic write). Pass null/'' to remove a key.
export function saveConfig(patch) {
  let file = {};
  try { file = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') delete file[k]; else file[k] = v;
  }
  if (patch.debrid_provider) delete file.no_debrid;
  mkdirSync(CONFIG_DIR, { recursive: true });
  const tmp = CONFIG_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
  renameSync(tmp, CONFIG_PATH);
}
