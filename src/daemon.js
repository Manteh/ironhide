#!/usr/bin/env node
// IronHide core service: one long-running process that owns the web UI/API,
// the tool handlers, the mpv monitor and the Tizen TV bridge.
import { startWebServer, WEB_PORT } from './web-server.js';
import { startBridge } from './tizen-bridge.js';
import { startBackground } from './tools.js';
import { startSocial } from './social.js';

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
    console.error(`IronHide daemon already running on :${WEB_PORT}`);
    return;
  }
  try {
    await startWebServer();
  } catch (err) {
    console.error(`Cannot start web server on :${WEB_PORT}: ${err.message}`);
    process.exit(1);
  }
  if (!process.env.IRONHIDE_NO_BRIDGE) startBridge();
  startBackground();
  startSocial();
  console.error(`IronHide daemon: http://localhost:${WEB_PORT}`);
}

import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
