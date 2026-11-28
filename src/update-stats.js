// Real numbers for Settings → Updates (commits, lines, files per release), straight from git.
// The Mac app has no git checkout inside it, so release.sh writes these numbers to updates-stats.json at build time
// and the daemon reads that file when git is not there.
import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BUNDLED = fileURLToPath(new URL('../updates-stats.json', import.meta.url));
const HASH = /^[0-9a-f]{7,40}$/, RANGE = /^[0-9a-f]{7,40}\.\.([0-9a-f]{7,40}|HEAD)$/;
const skip = (f) => /^docs\/screens\/|package-lock\.json$/.test(f);
const git = (args) => new Promise((res) => execFile('git', args, { cwd: ROOT, maxBuffer: 4e7 }, (e, so) => res(e ? '' : so)));

function count(txt, r) {
  for (const l of txt.split('\n')) {
    if (l.startsWith('@')) { r.commits++; const at = l.slice(1); r.lastAt ||= at; r.firstAt = at; continue; }
    const m = l.match(/^(\d+)\t(\d+)\t(.+)$/);
    if (m && !skip(m[3])) { r.add += +m[1]; r.del += +m[2]; r.files.add(m[3]); }
  }
}

/** items: [{ version, range?, commits?, work? }] → { [version]: { commits, add, del, files, lastAt, firstAt } } */
export async function updateStats(items) {
  if (!existsSync(`${ROOT}/.git`)) {
    try { const saved = JSON.parse(readFileSync(BUNDLED, 'utf8')); return Object.fromEntries(items.filter((it) => saved[it.version]).map((it) => [it.version, saved[it.version]])); } catch { return {}; }
  }
  const out = {};
  for (const it of items.slice(0, 40)) {
    const args = it.range && RANGE.test(it.range) ? [it.range] : Array.isArray(it.commits) && it.commits.every((h) => HASH.test(h)) ? ['--no-walk', ...it.commits] : null;
    if (!args) continue;
    const r = { commits: 0, add: 0, del: 0, files: new Set(), lastAt: '', firstAt: '' };
    count(await git(['log', '--date-order', '--numstat', '--format=@%cI', ...args]), r);
    const row = { commits: r.commits, add: r.add, del: r.del, files: r.files.size, lastAt: r.lastAt, firstAt: r.firstAt };
    if (it.work) { const w = { commits: 0, add: 0, del: 0, files: new Set() }; count(await git(['diff', '--numstat', 'HEAD']), w); row.workAdd = w.add; row.workDel = w.del; }
    out[it.version] = row;
  }
  return out;
}

// `node src/update-stats.js > updates-stats.json` (release.sh): the numbers for every changelog entry, without work-in-progress
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { CHANGELOG } = await import('../web/js/changelog.js');
  const stats = await updateStats(CHANGELOG.map((u) => ({ version: u.version, range: u.range, commits: u.commits })));
  process.stdout.write(JSON.stringify(stats, null, 1) + '\n');
}
