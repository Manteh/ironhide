#!/usr/bin/env node
// Watches Samsung TV playback state. Exits when playback stops.
// Works with both native IronHide TizenBrew app (polls bridge HTTP) and DLNA.
// Used as a background task so Claude detects when TV playback ends.

const TV_URL = 'http://192.168.1.209:9197/upnp/control/AVTransport1';
const BRIDGE_STATUS_URL = 'http://127.0.0.1:8788/';

let useNative = false;

// Detect if native bridge is running
async function detectMode() {
  try {
    const res = await fetch(BRIDGE_STATUS_URL, { signal: AbortSignal.timeout(1500) });
    const data = await res.json();
    return data.connected === true;
  } catch {
    return false;
  }
}

async function getNativeState() {
  try {
    const res = await fetch(BRIDGE_STATUS_URL, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    if (!data.connected) return 'DISCONNECTED';
    return data.state || 'IDLE';
  } catch {
    return 'UNKNOWN';
  }
}

async function getDLNAState() {
  try {
    const res = await fetch(TV_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': '"urn:schemas-upnp-org:service:AVTransport:1#GetTransportInfo"',
      },
      body: `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetTransportInfo xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID></u:GetTransportInfo></s:Body></s:Envelope>`,
      signal: AbortSignal.timeout(3000),
    });
    const body = await res.text();
    const match = body.match(/<CurrentTransportState>(.*?)<\/CurrentTransportState>/);
    return match?.[1] || 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

function isPlaying(state) {
  return ['PLAYING', 'PAUSED', 'PAUSED_PLAYBACK', 'TRANSITIONING', 'READY'].includes(state);
}

async function getState() {
  return useNative ? getNativeState() : getDLNAState();
}

// --- Main ---
useNative = await detectMode();

// Wait for playback to start
let started = false;
for (let i = 0; i < 30; i++) {
  const state = await getState();
  if (isPlaying(state)) {
    started = true;
    break;
  }
  await new Promise(r => setTimeout(r, 2000));
}

if (!started) {
  console.log('IRONHIDE_TV_NEVER_STARTED');
  process.exit(0);
}

// Monitor until stopped
while (true) {
  const state = await getState();
  if (!isPlaying(state)) {
    console.log('IRONHIDE_TV_STOPPED');
    process.exit(0);
  }
  await new Promise(r => setTimeout(r, 5000));
}
