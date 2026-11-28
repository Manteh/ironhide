// Prints the npm packages the daemon (src/daemon.js) really imports, following its local imports.
// release.sh installs only these into the app, not the CLI/MCP-only ones (@modelcontextprotocol/sdk, yargs, …).
import { readFileSync, existsSync } from 'fs';
import { builtinModules } from 'module';
import path from 'path';

const seen = new Set(), pkgs = new Set();
function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  for (const [, dep] of readFileSync(file, 'utf8').matchAll(/(?:\bfrom|\bimport\s*\()\s*['"]([^'"]+)['"]/g)) {
    if (dep.startsWith('.')) { const p = path.resolve(path.dirname(file), dep); if (existsSync(p)) walk(p); continue; }
    const name = dep.replace(/^node:/, '');
    if (builtinModules.includes(name) || builtinModules.includes(name.split('/')[0])) continue;
    const pkg = dep.split('/').slice(0, dep.startsWith('@') ? 2 : 1).join('/');
    if (/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(pkg)) pkgs.add(pkg); // skips import-like text inside strings
  }
}
walk(path.resolve(process.argv[2] || 'src/daemon.js'));
console.log([...pkgs].sort().join(' '));
