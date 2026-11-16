// Skip intro: where a show's opening ends, remembered per show once you mark it (press the key at the end of the intro).
// Episodes of one show usually share the same cold-open length, so the next episode offers "Skip intro" at that point.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';

const FILE = join(CONFIG_DIR, 'intros.json');
const load = () => { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return {}; } };

export const getIntro = (imdbId) => load()[imdbId] || null;

/** { start, end } in seconds, or null to forget it */
export function setIntro(imdbId, value) {
  const all = load();
  if (value && value.end > 0) {
    const start = Math.max(0, Number(value.start) || 0), end = Number(value.end);
    if (!(end > start) || end - start > 600) throw new Error('An intro is between 0 and 10 minutes long');
    all[imdbId] = { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10, at: new Date().toISOString() };
  } else delete all[imdbId];
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(all, null, 1));
  return all[imdbId] || null;
}
