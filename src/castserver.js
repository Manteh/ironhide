// "Show on PS5" (or any box that can't be cast to): Orbie opens a small server on the home network and the PS5 pulls the video.
// Two doors, same video:
//   1. A DLNA / UPnP media server called "Orbie" (found by SSDP). Devices with a media player that lists network servers see it.
//   2. A plain page, http://<this Mac>:7677/tv, for a browser (the PS5 has a hidden web browser).
// The daemon itself stays on 127.0.0.1. This is a separate listener that serves ONLY the current cast, and it only runs while
// something is being shown.
import http from 'http';
import dgram from 'dgram';
import os from 'os';
import { createHash } from 'crypto';
import { createSession, getSession, streamTo, closeSession } from './webplay.js';

export const CAST_PORT = Number(process.env.IRONHIDE_CAST_PORT) || 7677;
const NAME = 'Orbie';
const SSDP_ADDR = '239.255.255.250', SSDP_PORT = 1900;
const h = createHash('sha1').update('orbie-cast-' + os.hostname()).digest('hex');
const UDN = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
const ST = ['upnp:rootdevice', `uuid:${UDN}`, 'urn:schemas-upnp-org:device:MediaServer:1', 'urn:schemas-upnp-org:service:ContentDirectory:1', 'urn:schemas-upnp-org:service:ConnectionManager:1'];
const SERVER_HDR = `macOS UPnP/1.0 Orbie/1.0`;

let server = null, ssdp = null, aliveTimer = null, ssdpOk = false;
let current = null; // { id, title, start, duration, mode }
let updateId = 1;

// ---------- network ----------
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal && !/^(utun|awdl|llw|bridge|vmnet|docker)/.test(name)) out.push({ name, address: i.address, netmask: i.netmask });
  }
  return out.sort((a, b) => (/^en[01]$/.test(a.name) ? 0 : 1) - (/^en[01]$/.test(b.name) ? 0 : 1));
}
const toInt = (ip) => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
// the address of this Mac that sits on the same network as whoever is asking
function ipFacing(peer) {
  const all = lanAddresses();
  const hit = peer && all.find((a) => (toInt(a.address) & toInt(a.netmask)) === (toInt(peer) & toInt(a.netmask)));
  return (hit || all[0] || { address: '127.0.0.1' }).address;
}
export const primaryIp = () => ipFacing(null);

// ---------- xml helpers ----------
const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const hms = (sec) => { sec = Math.max(0, Math.round(sec || 0)); return `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; };
const CDS = 'urn:schemas-upnp-org:service:ContentDirectory:1', CM = 'urn:schemas-upnp-org:service:ConnectionManager:1';
const DLNA_FEATURES = 'DLNA.ORG_OP=00;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000'; // streamed, no byte seeking: Orbie's stream is made on the fly

function deviceXml(ip) {
  return `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:dlna="urn:schemas-dlna-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion>
<device><dlna:X_DLNADOC>DMS-1.50</dlna:X_DLNADOC><deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
<friendlyName>${NAME}</friendlyName><manufacturer>Orbie</manufacturer><modelName>Orbie</modelName><modelNumber>1</modelNumber><UDN>uuid:${UDN}</UDN>
<serviceList>
<service><serviceType>${CDS}</serviceType><serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId><SCPDURL>/dlna/cds.xml</SCPDURL><controlURL>/dlna/cds/control</controlURL><eventSubURL>/dlna/cds/event</eventSubURL></service>
<service><serviceType>${CM}</serviceType><serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId><SCPDURL>/dlna/cm.xml</SCPDURL><controlURL>/dlna/cm/control</controlURL><eventSubURL>/dlna/cm/event</eventSubURL></service>
</serviceList><presentationURL>http://${ip}:${CAST_PORT}/tv</presentationURL></device></root>`;
}

// [action, [[argName, 'in'|'out', relatedStateVariable]...]]
const scpd = (actions, vars) => `<?xml version="1.0"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0"><specVersion><major>1</major><minor>0</minor></specVersion>
<actionList>${actions.map(([n, args]) => `<action><name>${n}</name><argumentList>${args.map(([a, d, v]) => `<argument><name>${a}</name><direction>${d}</direction><relatedStateVariable>${v}</relatedStateVariable></argument>`).join('')}</argumentList></action>`).join('')}</actionList>
<serviceStateTable>${vars.map(([n, t, ev, allowed]) => `<stateVariable sendEvents="${ev ? 'yes' : 'no'}"><name>${n}</name><dataType>${t}</dataType>${allowed ? `<allowedValueList>${allowed.map((a) => `<allowedValue>${a}</allowedValue>`).join('')}</allowedValueList>` : ''}</stateVariable>`).join('')}</serviceStateTable></scpd>`;

const CDS_SCPD = scpd([
  ['Browse', [['ObjectID', 'in', 'A_ARG_TYPE_ObjectID'], ['BrowseFlag', 'in', 'A_ARG_TYPE_BrowseFlag'], ['Filter', 'in', 'A_ARG_TYPE_Filter'], ['StartingIndex', 'in', 'A_ARG_TYPE_Index'], ['RequestedCount', 'in', 'A_ARG_TYPE_Count'], ['SortCriteria', 'in', 'A_ARG_TYPE_SortCriteria'], ['Result', 'out', 'A_ARG_TYPE_Result'], ['NumberReturned', 'out', 'A_ARG_TYPE_Count'], ['TotalMatches', 'out', 'A_ARG_TYPE_Count'], ['UpdateID', 'out', 'A_ARG_TYPE_UpdateID']]],
  ['GetSearchCapabilities', [['SearchCaps', 'out', 'SearchCapabilities']]],
  ['GetSortCapabilities', [['SortCaps', 'out', 'SortCapabilities']]],
  ['GetSystemUpdateID', [['Id', 'out', 'SystemUpdateID']]],
], [['A_ARG_TYPE_ObjectID', 'string'], ['A_ARG_TYPE_Result', 'string'], ['A_ARG_TYPE_BrowseFlag', 'string', 0, ['BrowseMetadata', 'BrowseDirectChildren']], ['A_ARG_TYPE_Filter', 'string'], ['A_ARG_TYPE_SortCriteria', 'string'], ['A_ARG_TYPE_Index', 'ui4'], ['A_ARG_TYPE_Count', 'ui4'], ['A_ARG_TYPE_UpdateID', 'ui4'], ['SearchCapabilities', 'string'], ['SortCapabilities', 'string'], ['SystemUpdateID', 'ui4', 1]]);

const CM_SCPD = scpd([
  ['GetProtocolInfo', [['Source', 'out', 'SourceProtocolInfo'], ['Sink', 'out', 'SinkProtocolInfo']]],
  ['GetCurrentConnectionIDs', [['ConnectionIDs', 'out', 'CurrentConnectionIDs']]],
  ['GetCurrentConnectionInfo', [['ConnectionID', 'in', 'A_ARG_TYPE_ConnectionID'], ['RcsID', 'out', 'A_ARG_TYPE_RcsID'], ['AVTransportID', 'out', 'A_ARG_TYPE_AVTransportID'], ['ProtocolInfo', 'out', 'A_ARG_TYPE_ProtocolInfo'], ['PeerConnectionManager', 'out', 'A_ARG_TYPE_ConnectionManager'], ['PeerConnectionID', 'out', 'A_ARG_TYPE_ConnectionID'], ['Direction', 'out', 'A_ARG_TYPE_Direction'], ['Status', 'out', 'A_ARG_TYPE_ConnectionStatus']]],
], [['SourceProtocolInfo', 'string', 1], ['SinkProtocolInfo', 'string', 1], ['CurrentConnectionIDs', 'string', 1], ['A_ARG_TYPE_ConnectionStatus', 'string', 0, ['OK', 'ContentFormatMismatch', 'InsufficientBandwidth', 'UnreliableChannel', 'Unknown']], ['A_ARG_TYPE_ConnectionManager', 'string'], ['A_ARG_TYPE_Direction', 'string', 0, ['Input', 'Output']], ['A_ARG_TYPE_ProtocolInfo', 'string'], ['A_ARG_TYPE_ConnectionID', 'i4'], ['A_ARG_TYPE_AVTransportID', 'i4'], ['A_ARG_TYPE_RcsID', 'i4']]);

const soap = (service, action, inner) => `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action}Response xmlns:u="${service}">${inner}</u:${action}Response></s:Body></s:Envelope>`;
const fault = (code, msg) => `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>${msg}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`;

// ---------- the one thing on the shelf: what is being shown right now ----------
function itemDidl(ip) {
  const c = current;
  return `<item id="now" parentID="0" restricted="1"><dc:title>${esc(c.title)}</dc:title><upnp:class>object.item.videoItem.movie</upnp:class>` +
    `<res protocolInfo="http-get:*:video/mp4:${DLNA_FEATURES}" duration="${hms(Math.max(0, c.duration - c.start))}">http://${ip}:${CAST_PORT}/stream/${c.id}.mp4</res></item>`;
}
function browse(body, ip) {
  const pick = (k) => body.match(new RegExp(`<${k}>([^<]*)</${k}>`))?.[1] ?? '';
  const obj = pick('ObjectID'), flag = pick('BrowseFlag') || 'BrowseDirectChildren';
  const wrap = (inner) => `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">${inner}</DIDL-Lite>`;
  const rootBox = `<container id="0" parentID="-1" restricted="1" searchable="0" childCount="${current ? 1 : 0}"><dc:title>${NAME}</dc:title><upnp:class>object.container.storageFolder</upnp:class></container>`;
  let didl, n;
  if (flag === 'BrowseMetadata') {
    if (obj === '0') { didl = wrap(rootBox); n = 1; }
    else if (obj === 'now' && current) { didl = wrap(itemDidl(ip)); n = 1; }
    else return null;
  } else {
    if (obj !== '0') return null;
    didl = wrap(current ? itemDidl(ip) : ''); n = current ? 1 : 0;
  }
  return soap(CDS, 'Browse', `<Result>${esc(didl)}</Result><NumberReturned>${n}</NumberReturned><TotalMatches>${n}</TotalMatches><UpdateID>${updateId}</UpdateID>`);
}

function readBody(req, max = 65536) {
  return new Promise((resolve) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > max) req.destroy(); }); req.on('end', () => resolve(b)); req.on('error', () => resolve(b)); });
}
const send = (res, code, type, body, extra = {}) => { res.writeHead(code, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Server': SERVER_HDR, ...extra }); res.end(body); };

async function handle(req, res) {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  const ip = ipFacing((req.socket.remoteAddress || '').replace(/^::ffff:/, ''));
  const method = req.method;
  if (method === 'GET' && (p === '/' )) { res.writeHead(302, { Location: '/tv' }); return res.end(); }
  if (method === 'GET' && p === '/dlna/device.xml') return send(res, 200, 'text/xml; charset="utf-8"', deviceXml(ip));
  if (method === 'GET' && p === '/dlna/cds.xml') return send(res, 200, 'text/xml; charset="utf-8"', CDS_SCPD);
  if (method === 'GET' && p === '/dlna/cm.xml') return send(res, 200, 'text/xml; charset="utf-8"', CM_SCPD);
  if (p.endsWith('/event') && (method === 'SUBSCRIBE' || method === 'UNSUBSCRIBE')) { res.writeHead(200, { SID: `uuid:${UDN}-sub`, TIMEOUT: 'Second-1800', 'Content-Length': 0 }); return res.end(); }
  if (method === 'POST' && (p === '/dlna/cds/control' || p === '/dlna/cm/control')) {
    const body = await readBody(req);
    const action = (req.headers.soapaction || '').replace(/"/g, '').split('#')[1] || body.match(/<u:(\w+)/)?.[1] || '';
    const xml = 'text/xml; charset="utf-8"';
    if (p === '/dlna/cm/control') {
      if (action === 'GetProtocolInfo') return send(res, 200, xml, soap(CM, action, `<Source>http-get:*:video/mp4:*</Source><Sink></Sink>`));
      if (action === 'GetCurrentConnectionIDs') return send(res, 200, xml, soap(CM, action, '<ConnectionIDs>0</ConnectionIDs>'));
      if (action === 'GetCurrentConnectionInfo') return send(res, 200, xml, soap(CM, action, '<RcsID>-1</RcsID><AVTransportID>-1</AVTransportID><ProtocolInfo></ProtocolInfo><PeerConnectionManager></PeerConnectionManager><PeerConnectionID>-1</PeerConnectionID><Direction>Output</Direction><Status>OK</Status>'));
      return send(res, 500, xml, fault(401, 'Invalid Action'));
    }
    if (action === 'Browse') { const r = browse(body, ip); return r ? send(res, 200, xml, r) : send(res, 500, xml, fault(701, 'No such object')); }
    if (action === 'GetSystemUpdateID') return send(res, 200, xml, soap(CDS, action, `<Id>${updateId}</Id>`));
    if (action === 'GetSearchCapabilities') return send(res, 200, xml, soap(CDS, action, '<SearchCaps></SearchCaps>'));
    if (action === 'GetSortCapabilities') return send(res, 200, xml, soap(CDS, action, '<SortCaps></SortCaps>'));
    return send(res, 500, xml, fault(401, 'Invalid Action'));
  }
  // the video: only the current cast's id is served
  const m = p.match(/^\/stream\/([a-f0-9-]+)\.mp4$/);
  if (m && (method === 'GET' || method === 'HEAD')) {
    if (!current || m[1] !== current.id || !getSession(current.id)) { res.writeHead(404); return res.end(); }
    const start = u.searchParams.has('start') ? Number(u.searchParams.get('start')) : current.start;
    res.setHeader('transferMode.dlna.org', 'Streaming'); res.setHeader('contentFeatures.dlna.org', DLNA_FEATURES);
    if (method === 'HEAD') { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'none' }); return res.end(); }
    return streamTo(res, current.id, Number.isFinite(start) ? start : 0, Number(u.searchParams.get('audio')) || 0);
  }
  if (method === 'GET' && p === '/tv/state') return send(res, 200, 'application/json', JSON.stringify(current ? { id: current.id, title: current.title, start: current.start, duration: current.duration, src: `/stream/${current.id}.mp4` } : { id: null }));
  if (method === 'GET' && p === '/tv') return send(res, 200, 'text/html; charset=utf-8', TV_PAGE);
  res.writeHead(404); res.end();
}

// A page for a browser on the TV box. Big buttons (a controller can focus them), seek by restarting the stream at a new time.
const TV_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orbie</title>
<style>
html,body{margin:0;height:100%;background:#000;color:#f5f5f7;font:28px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;overflow:hidden}
#v{position:fixed;inset:0;width:100%;height:100%;background:#000}
#msg{position:fixed;inset:0;display:grid;place-content:center;text-align:center;gap:14px;padding:0 8vw}
#msg b{font-size:54px;letter-spacing:.02em}#msg span{color:#8e8e93}
#bar{position:fixed;left:0;right:0;bottom:0;padding:22px 3vw 26px;display:flex;gap:14px;align-items:center;justify-content:center;flex-wrap:wrap;background:linear-gradient(transparent,rgba(0,0,0,.85));transition:opacity .4s}
#bar.hide{opacity:0;pointer-events:none}
button{font:inherit;color:#fff;background:rgba(255,255,255,.14);border:2px solid transparent;border-radius:14px;padding:14px 26px;cursor:pointer}
button:focus,button:hover{outline:none;border-color:#fff;background:rgba(255,255,255,.26)}
#t{min-width:230px;text-align:center;font-variant-numeric:tabular-nums}
</style></head><body>
<video id="v" playsinline autoplay></video>
<div id="msg"><b>Orbie</b><span id="m2">Nothing is being shown yet. In Orbie, play something and press the PS5 button.</span><button id="go" hidden>Play</button></div>
<div id="bar" class="hide"><button data-d="-600">-10 min</button><button data-d="-60">-1 min</button><button data-d="-10">-10 s</button><span id="t"></span><button data-d="10">+10 s</button><button data-d="60">+1 min</button><button data-d="600">+10 min</button></div>
<script>
const v=document.getElementById('v'),msg=document.getElementById('msg'),bar=document.getElementById('bar'),t=document.getElementById('t'),go=document.getElementById('go'),m2=document.getElementById('m2');
let cur=null,offset=0,hideT;
const fmt=s=>{s=Math.max(0,Math.floor(s));const h=Math.floor(s/3600),m=Math.floor(s/60)%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(s%60).padStart(2,'0')};
const pos=()=>offset+(v.currentTime||0);
function load(at){offset=at;v.src=cur.src+'?start='+Math.floor(at);v.play().then(()=>{msg.hidden=true}).catch(()=>{msg.hidden=false;m2.textContent=cur.title;go.hidden=false;go.focus()})}
async function poll(){try{const s=await (await fetch('/tv/state',{cache:'no-store'})).json();
  if(s.id&&(!cur||cur.id!==s.id)){cur=s;document.title=s.title;go.hidden=true;m2.textContent='Starting '+s.title+'…';load(s.start)}
  if(!s.id&&cur){cur=null;v.removeAttribute('src');v.load();msg.hidden=false;go.hidden=true;m2.textContent='Nothing is being shown yet. In Orbie, play something and press the PS5 button.'}
}catch(e){}setTimeout(poll,3000)}
go.onclick=()=>{v.play();msg.hidden=true};
bar.onclick=e=>{const d=e.target.dataset?.d;if(d&&cur){load(Math.max(0,Math.min((cur.duration||1e9)-5,pos()+Number(d))))}};
function wake(){bar.classList.remove('hide');clearTimeout(hideT);hideT=setTimeout(()=>{if(!v.paused)bar.classList.add('hide')},4000)}
['keydown','mousemove','click','touchstart'].forEach(e=>addEventListener(e,wake));
document.addEventListener('keydown',e=>{if(e.key===' '&&document.activeElement===document.body){v.paused?v.play():v.pause();e.preventDefault()}});
setInterval(()=>{if(cur)t.textContent=fmt(pos())+(cur.duration?' / '+fmt(cur.duration):'')},500);
v.onended=()=>{msg.hidden=false;m2.textContent='Finished: '+(cur?.title||'')};
poll();
</script></body></html>`;

// ---------- SSDP: how a media player on the network finds "Orbie" ----------
const usn = (st) => (st === `uuid:${UDN}` ? st : `uuid:${UDN}::${st}`);
function startSsdp() {
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let done = false; const fin = (ok) => { if (!done) { done = true; ssdpOk = ok; resolve(ok); } };
    sock.on('error', (e) => { console.warn(`[cast] SSDP unavailable: ${e.message}`); try { sock.close(); } catch {} if (ssdp === sock) ssdp = null; fin(false); });
    sock.on('message', (msg, rinfo) => {
      const text = msg.toString();
      if (!/^M-SEARCH/i.test(text)) return;
      const want = text.match(/^ST:\s*(.+)$/im)?.[1]?.trim();
      const hits = want === 'ssdp:all' ? ST : ST.filter((s) => s === want);
      const ip = ipFacing(rinfo.address);
      for (const st of hits) {
        const reply = Buffer.from(`HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nEXT:\r\nLOCATION: http://${ip}:${CAST_PORT}/dlna/device.xml\r\nSERVER: ${SERVER_HDR}\r\nST: ${st}\r\nUSN: ${usn(st)}\r\n\r\n`);
        setTimeout(() => { try { sock.send(reply, rinfo.port, rinfo.address); } catch {} }, Math.random() * 400);
      }
    });
    sock.bind(SSDP_PORT, '0.0.0.0', () => {
      try { for (const a of lanAddresses()) { try { sock.addMembership(SSDP_ADDR, a.address); } catch {} } sock.setMulticastTTL(2); } catch {}
      ssdp = sock; announce('alive'); aliveTimer = setInterval(() => announce('alive'), 600000); aliveTimer.unref?.();
      fin(true);
    });
  });
}
function announce(kind) {
  if (!ssdp) return;
  for (const a of lanAddresses()) for (const st of ST) {
    const m = Buffer.from(`NOTIFY * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` + (kind === 'alive' ? `CACHE-CONTROL: max-age=1800\r\nLOCATION: http://${a.address}:${CAST_PORT}/dlna/device.xml\r\nSERVER: ${SERVER_HDR}\r\n` : '') + `NT: ${st}\r\nNTS: ssdp:${kind}\r\nUSN: ${usn(st)}\r\n\r\n`);
    try { ssdp.setMulticastInterface(a.address); ssdp.send(m, SSDP_PORT, SSDP_ADDR); } catch {}
  }
}

// ---------- start / stop ----------
async function ensureServer() {
  if (server) return;
  await new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} }); });
    s.once('error', (e) => reject(e.code === 'EADDRINUSE' ? new Error(`Port ${CAST_PORT} is already in use`) : e));
    s.listen(CAST_PORT, '0.0.0.0', () => { server = s; resolve(); });
  });
  await startSsdp();
}

/** Prepare a stream for the TV box and open the doors. `start` is where to begin, in seconds. */
export async function startCast({ url, origin, title, meta, start = 0, settings = {} }) {
  await ensureServer();
  if (current) closeSession(current.id);
  const info = await createSession({ url, origin, title, meta, subs: [], caps: {}, settings, delivery: 'proxy' });
  current = { id: info.id, title: title || 'Orbie', start: Math.max(0, Math.floor(start) || 0), duration: info.duration || 0, mode: info.mode };
  updateId++;
  const ip = primaryIp();
  return { ...castStatus(), ip };
}

export function castStatus() {
  const ip = primaryIp();
  return { running: !!server, ssdp: ssdpOk, name: NAME, ip, port: CAST_PORT, tvUrl: `http://${ip}:${CAST_PORT}/tv`, now: current ? { title: current.title, start: current.start, mode: current.mode } : null };
}

export function stopCast() {
  if (current) { closeSession(current.id); current = null; updateId++; }
  if (ssdp) { announce('byebye'); const s = ssdp; ssdp = null; clearInterval(aliveTimer); setTimeout(() => { try { s.close(); } catch {} }, 300); }
  ssdpOk = false;
  if (server) { try { server.closeAllConnections?.(); server.close(); } catch {} server = null; }
}
