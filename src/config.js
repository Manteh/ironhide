import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_PATH = join(homedir(), '.config', 'ironhide', 'config.json');

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

const config = loadConfig();

export const TMDB_API_KEY = process.env.TMDB_API_KEY || config.tmdb_api_key || '';
export const RD_API_KEY = process.env.RD_API_KEY || config.rd_api_key || '';

if (!TMDB_API_KEY) {
  console.error('Missing TMDB_API_KEY — set it in ~/.config/ironhide/config.json or as an env var');
  process.exit(1);
}
if (!RD_API_KEY) {
  console.error('Missing RD_API_KEY — set it in ~/.config/ironhide/config.json or as an env var');
  process.exit(1);
}
