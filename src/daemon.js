#!/usr/bin/env node
// Orbie core service: one long-running process that owns the web UI/API,
// the tool handlers, the mpv monitor and the Tizen TV bridge.
import { startWebServer, WEB_PORT } from './web-server.js';
import { startBridge } from './tizen-bridge.js';
import { startBackground } from './tools.js';
import { startSocial } from './social.js';
import { announceNewEpisodes } from './newepisodes.js';

// One failed background task must not take the whole app down
const clean = (e) => String(e?.stack || e).replace(/([?&](token|apikey|api_key)=)[^&\s]+/gi, '$1***');
process.on('unhandledRejection', (e) => console.error('[daemon] background task failed:', clean(e)));
process.on('uncaughtException', (e) => console.error('[daemon] error:', clean(e)));

export async function isDaemonRunning() {
  try {
    const r = await fetch(`http://127.0.0.1:${WEB_PORT}/api/health`, { signal: AbortSignal.timeout(800) });
    return (await r.json()).service === 'ironhide';
  } catch {
    return false;
  }
}

async function main() {
  if (await isDaemonRunning()) {
    console.error(`Orbie daemon already running on :${WEB_PORT}`);
    return;
  }
  try {
    await startWebServer();
  } catch (err) {
    console.error(`Cannot start web server on :${WEB_PORT}: ${err.message}`);
    process.exit(1);
  }
  // Started by the Mac app: go away with it, even if it crashed or was force-quit and never got to stop us.
  if (process.env.IRONHIDE_OWNER === 'app') {
    const parent = process.ppid;
    setInterval(() => { if (process.ppid !== parent) { console.error('[daemon] the app is gone, stopping'); process.exit(0); } }, 2000).unref();
  }
  if (!process.env.IRONHIDE_NO_BRIDGE) startBridge();
  startBackground();
  startSocial();
  // new episodes of shows you follow: a minute after start, then every 3 hours
  setTimeout(() => announceNewEpisodes().catch(() => {}), 60e3);
  setInterval(() => announceNewEpisodes().catch(() => {}), 3 * 3600e3).unref();
  // the "Tonight I want" shelves, loaded ahead so a mood chip shows its cards at once
  const warm = () => import('./collections.js').then((m) => m.warmShelves()).catch(() => {});
  setTimeout(warm, 8e3);
  setInterval(warm, 25 * 60e3).unref();
  console.error(`Orbie daemon: http://localhost:${WEB_PORT}`);
}

import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
