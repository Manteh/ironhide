// Hands a stream to the PS5 bridge (ps5-bridge.js), starting the bridge first if it isn't running.
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { CONFIG_DIR } from './config.js';

const BRIDGE = 'http://127.0.0.1:7698';
const up = () => fetch(BRIDGE + '/Movies/', { signal: AbortSignal.timeout(1000) }).then((r) => r.ok).catch(() => false);

async function ensureBridge() {
  if (await up()) return;
  await mkdir(CONFIG_DIR, { recursive: true });
  const log = openSync(join(CONFIG_DIR, 'ps5-bridge.log'), 'a', 0o600);
  // its own process group, so the folder stays mounted when Orbie quits; the app's PATH lacks Homebrew
  spawn(process.execPath, [fileURLToPath(new URL('./ps5-bridge.js', import.meta.url))], {
    detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, PATH: `${process.env.PATH || ''}:/opt/homebrew/bin:/usr/local/bin` },
  }).unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await up()) return;
  }
  throw new Error('The PS5 bridge did not start');
}

export async function sendToPs5(item) {
  await ensureBridge();
  const r = await fetch(BRIDGE + '/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || 'The PS5 bridge refused it');
  return out;
}
