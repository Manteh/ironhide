// "Another person on this Mac": extra IronHide daemons, each with its own folder (profile, friend code, history)
// and its own port. Handy for trying Together with yourself, or for sharing one computer.
import { spawn } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import { CONFIG_DIR } from './config.js';

const BASE = join(homedir(), '.config', 'ironhide-instances');
const REG = join(CONFIG_DIR, 'instances.json');
const DAEMON = fileURLToPath(new URL('./daemon.js', import.meta.url));
const FIRST_PORT = 7677;

const readReg = () => { try { return JSON.parse(readFileSync(REG, 'utf-8')); } catch { return []; } };
const writeReg = (r) => { mkdirSync(CONFIG_DIR, { recursive: true }); writeFileSync(REG, JSON.stringify(r, null, 2)); };
const health = (port) => fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(700) }).then((r) => r.json()).then((j) => j.service === 'ironhide').catch(() => false);
const portFree = (port) => new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(port, '127.0.0.1', () => s.close(() => res(true))); });

// Point an instance at the same relay as its creator (a relay saved earlier would otherwise win, and the two could never find each other)
async function syncRelay(port, relay) {
  if (!relay) return;
  await fetch(`http://127.0.0.1:${port}/api/social/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ relayUrl: relay }) }).catch(() => {});
}

async function waitUp(port, ms = 9000) { const end = Date.now() + ms; while (Date.now() < end) { if (await health(port)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; }

function launch(inst, relay) {
  const child = spawn(process.execPath, [DAEMON], {
    env: { ...process.env, IRONHIDE_HOME: inst.home, IRONHIDE_PORT: String(inst.port), IRONHIDE_NO_BRIDGE: '1', ...(relay ? { IRONHIDE_RELAY: relay } : {}) },
    detached: true, stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

export async function listInstances() {
  const reg = readReg();
  return Promise.all(reg.map(async (i) => ({ id: i.id, name: i.name, port: i.port, url: `http://localhost:${i.port}`, running: await health(i.port) })));
}

export async function createInstance({ name = '', copyKeys = true, relay = '' } = {}) {
  const reg = readReg();
  let port = FIRST_PORT;
  while (reg.some((i) => i.port === port) || !(await portFree(port))) { port++; if (port > FIRST_PORT + 40) throw new Error('No free port found'); }
  const id = `p${port}`;
  const home = join(BASE, `${id}-${Date.now().toString(36)}`); // unique, so a new person never inherits an old identity
  mkdirSync(home, { recursive: true });
  if (copyKeys) { // reuse this install's debrid keys so the new person can play right away
    const cfg = join(CONFIG_DIR, 'config.json');
    if (existsSync(cfg)) { copyFileSync(cfg, join(home, 'config.json')); try { chmodSync(join(home, 'config.json'), 0o600); } catch {} }
  }
  const inst = { id, name: String(name).trim().slice(0, 40) || `Person ${reg.length + 2}`, port, home, pid: 0 };
  inst.pid = launch(inst, relay);
  reg.push(inst); writeReg(reg);
  if (!(await waitUp(port))) throw new Error('The new instance did not start in time');
  await syncRelay(port, relay);
  if (String(name).trim()) { // a name was given: start them already named, no name screen
    await fetch(`http://127.0.0.1:${port}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile: { name: inst.name } }) }).catch(() => {});
  }
  return { id, name: inst.name, port, url: `http://localhost:${port}`, running: true };
}

export async function startInstance(id, relay = '') {
  const reg = readReg(), inst = reg.find((i) => i.id === id);
  if (!inst) throw new Error('Unknown instance');
  if (!(await health(inst.port))) { inst.pid = launch(inst, relay); writeReg(reg); await waitUp(inst.port); }
  await syncRelay(inst.port, relay);
  return { id, url: `http://localhost:${inst.port}` };
}

export async function stopInstance(id) {
  const inst = readReg().find((i) => i.id === id);
  if (!inst) throw new Error('Unknown instance');
  // find whatever is listening on its port (the pid we stored may be stale after a restart)
  try { if (inst.pid) process.kill(inst.pid); } catch {}
  return { id };
}
