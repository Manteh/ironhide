import http from 'http';

const TV_IP = '192.168.1.209';
const TV_PORT = 9197;
const TRANSPORT_URL = `http://${TV_IP}:${TV_PORT}/upnp/control/AVTransport1`;
const RENDERING_URL = `http://${TV_IP}:${TV_PORT}/upnp/control/RenderingControl1`;
const PROXY_PORT = 8765;

let proxyServer = null;
let currentStreamUrl = null;
let currentFileSize = null;
let currentContentType = null;

function soapRequest(url, action, body) {
  const service = url.includes('RenderingControl')
    ? 'urn:schemas-upnp-org:service:RenderingControl:1'
    : 'urn:schemas-upnp-org:service:AVTransport:1';

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:${action} xmlns:u="${service}">
      ${body}
    </u:${action}>
  </s:Body>
</s:Envelope>`;

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${service}#${action}"`,
    },
    body: xml,
  });
}

function getContentType(filename) {
  if (/\.mkv$/i.test(filename)) return 'video/x-matroska';
  if (/\.mp4$/i.test(filename)) return 'video/mp4';
  if (/\.avi$/i.test(filename)) return 'video/x-msvideo';
  if (/\.ts$/i.test(filename)) return 'video/mp2t';
  return 'video/mp4';
}

// Start local HTTP proxy that streams RD content to the TV
export async function startProxy(streamUrl) {
  await stopProxy();
  currentStreamUrl = streamUrl;

  // Get file info from RD
  const headRes = await fetch(streamUrl, { method: 'HEAD' });
  currentFileSize = headRes.headers.get('content-length');
  const filename = decodeURIComponent(streamUrl.split('/').pop());
  currentContentType = getContentType(filename);

  return new Promise((resolve, reject) => {
    proxyServer = http.createServer(async (req, res) => {
      try {
        // Landing page — TV browser hits this and gets a video player
        if (req.url === '/' && req.method === 'GET' && !req.headers.range) {
          const title = currentTitle || 'IronHide';
          const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — IronHide</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #000; color: #fff; font-family: sans-serif; }
  video { width: 100vw; height: 100vh; }
  .info { position: fixed; top: 20px; left: 20px; z-index: 10; font-size: 24px; opacity: 0.7; }
</style>
</head><body>
<div class="info">${title}</div>
<video autoplay controls>
  <source src="/stream" type="${currentContentType || 'video/mp4'}">
</video>
<script>
  // Auto-fullscreen
  document.querySelector('video').addEventListener('click', function() {
    if (this.requestFullscreen) this.requestFullscreen();
  });
  // Hide info after 5s
  setTimeout(() => document.querySelector('.info').style.display = 'none', 5000);
</script>
</body></html>`;
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }

        // Video stream endpoint
        const streamPath = req.url === '/stream' || req.url === '/';
        const hasRange = !!req.headers.range;
        const upstreamHeaders = {};
        if (hasRange) upstreamHeaders['Range'] = req.headers.range;

        // Common DLNA headers for all responses
        const dlnaHeaders = {
          'Content-Type': currentContentType,
          'Accept-Ranges': 'bytes',
          'transferMode.dlna.org': 'Streaming',
          'contentFeatures.dlna.org': 'DLNA.ORG_OP=11;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000',
        };

        if (req.method === 'HEAD') {
          if (hasRange) {
            const upstream = await fetch(currentStreamUrl, { method: 'HEAD', headers: upstreamHeaders });
            const rHeaders = { ...dlnaHeaders };
            if (upstream.headers.get('content-length')) rHeaders['Content-Length'] = upstream.headers.get('content-length');
            if (upstream.headers.get('content-range')) rHeaders['Content-Range'] = upstream.headers.get('content-range');
            res.writeHead(upstream.status, rHeaders);
          } else {
            res.writeHead(200, {
              ...dlnaHeaders,
              'Content-Length': currentFileSize,
            });
          }
          res.end();
          return;
        }

        const upstream = await fetch(currentStreamUrl, { headers: upstreamHeaders });
        const rHeaders = { ...dlnaHeaders };
        if (upstream.headers.get('content-length')) rHeaders['Content-Length'] = upstream.headers.get('content-length');
        if (upstream.headers.get('content-range')) {
          rHeaders['Content-Range'] = upstream.headers.get('content-range');
        } else if (hasRange && currentFileSize) {
          // Construct Content-Range if upstream didn't provide one
          const contentLength = upstream.headers.get('content-length');
          const rangeMatch = req.headers.range.match(/bytes=(\d+)-(\d*)/);
          if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            const end = rangeMatch[2] ? parseInt(rangeMatch[2]) : start + parseInt(contentLength) - 1;
            rHeaders['Content-Range'] = `bytes ${start}-${end}/${currentFileSize}`;
          }
        }

        res.writeHead(hasRange ? 206 : 200, rHeaders);
        const reader = upstream.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) {
            await new Promise(r => res.once('drain', r));
          }
        }
        res.end();

        req.on('close', () => reader.cancel().catch(() => {}));
      } catch (err) {
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      }
    });

    proxyServer.listen(PROXY_PORT, '0.0.0.0', () => resolve(PROXY_PORT));
    proxyServer.on('error', reject);
  });
}

export async function stopProxy() {
  if (proxyServer) {
    proxyServer.close();
    proxyServer = null;
  }
}

export function isProxyRunning() {
  return proxyServer !== null;
}

// Cast to TV
export async function castToTV(url, title) {
  const ct = currentContentType || 'video/mp4';
  const sizeAttr = currentFileSize ? ` size="${currentFileSize}"` : '';
  const metadata = `&lt;DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:sec="http://www.sec.co.kr/dlna"&gt;&lt;item id="1" parentID="0" restricted="1"&gt;&lt;dc:title&gt;${escapeXml(title || 'IronHide')}&lt;/dc:title&gt;&lt;upnp:class&gt;object.item.videoItem.movie&lt;/upnp:class&gt;&lt;res protocolInfo="http-get:*:${ct}:DLNA.ORG_OP=11;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000"${sizeAttr}&gt;${escapeXml(url)}&lt;/res&gt;&lt;/item&gt;&lt;/DIDL-Lite&gt;`;

  const setRes = await soapRequest(TRANSPORT_URL, 'SetAVTransportURI', `
    <InstanceID>0</InstanceID>
    <CurrentURI>${escapeXml(url)}</CurrentURI>
    <CurrentURIMetaData>${metadata}</CurrentURIMetaData>
  `);

  const setBody = await setRes.text();
  if (setBody.includes('faultcode')) {
    const errMatch = setBody.match(/<errorDescription>(.*?)<\/errorDescription>/);
    throw new Error(`SetURI failed: ${errMatch?.[1] || 'unknown error'}`);
  }

  const playRes = await soapRequest(TRANSPORT_URL, 'Play', `
    <InstanceID>0</InstanceID>
    <Speed>1</Speed>
  `);

  const playBody = await playRes.text();
  if (playBody.includes('faultcode')) {
    const errMatch = playBody.match(/<errorDescription>(.*?)<\/errorDescription>/);
    throw new Error(`Play failed: ${errMatch?.[1] || 'unknown error'}`);
  }

  return true;
}

// Store the resolved direct URL and title for recasting
let currentDirectUrl = null;
let currentTitle = null;
let currentDuration = 0; // seconds, set after first position report

// Full cast flow: resolve RD URL → start proxy → cast to TV
export async function castStream(stream, title) {
  if (!stream.isRD || !stream.url) {
    throw new Error('TV casting only works with Real-Debrid streams');
  }

  // Resolve RD redirect
  const res = await fetch(stream.url, { redirect: 'manual' });
  const directUrl = res.headers.get('location');
  if (!directUrl) throw new Error('Could not resolve RD URL — stream may not be cached');

  currentDirectUrl = directUrl;
  currentTitle = title;

  const localIP = await getLocalIP();
  await startProxy(directUrl);
  const proxyUrl = `http://${localIP}:${PROXY_PORT}/`;

  await castToTV(proxyUrl, title);
  return { proxyUrl, directUrl };
}

// Proxy-level seek: pipe RD stream through ffmpeg starting at given time
// TV sees a fresh stream starting from the beginning, but it's actually seeking
export async function tvSeekViaProxy(seekSeconds) {
  if (!currentDirectUrl) throw new Error('No active stream to seek');

  const { spawn: spawnProcess } = await import('child_process');

  await stopProxy();

  const localIP = await getLocalIP();

  return new Promise((resolve, reject) => {
    proxyServer = http.createServer(async (req, res) => {
      try {
        if (req.method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': currentContentType || 'video/mp4',
            'Accept-Ranges': 'none',
            'transferMode.dlna.org': 'Streaming',
          });
          res.end();
          return;
        }

        // Use ffmpeg to seek and transcode to a TV-friendly format
        const ffmpeg = spawnProcess('/opt/homebrew/bin/ffmpeg', [
          '-ss', String(seekSeconds),
          '-i', currentDirectUrl,
          '-c:v', 'copy',        // don't re-encode video
          '-c:a', 'aac',         // re-encode audio to AAC (universally supported)
          '-ac', '2',            // stereo
          '-f', 'mpegts',        // MPEG-TS container for streaming
          '-movflags', 'frag_keyframe+empty_moov',
          'pipe:1',
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        res.writeHead(200, {
          'Content-Type': 'video/mp2t',
          'transferMode.dlna.org': 'Streaming',
        });

        ffmpeg.stdout.pipe(res);
        ffmpeg.stderr.on('data', () => {}); // suppress ffmpeg logs

        req.on('close', () => { ffmpeg.kill(); });
        res.on('close', () => { ffmpeg.kill(); });
      } catch (err) {
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      }
    });

    proxyServer.listen(PROXY_PORT, '0.0.0.0', async () => {
      try {
        const proxyUrl = `http://${localIP}:${PROXY_PORT}/`;
        await castToTV(proxyUrl, currentTitle || 'IronHide');
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    proxyServer.on('error', reject);
  });
}

// TV controls
export async function tvPause() {
  await soapRequest(TRANSPORT_URL, 'Pause', '<InstanceID>0</InstanceID>');
}

export async function tvPlay() {
  await soapRequest(TRANSPORT_URL, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>');
}

export async function tvStop() {
  await soapRequest(TRANSPORT_URL, 'Stop', '<InstanceID>0</InstanceID>');
  await stopProxy();
}

export async function tvSeek(time) {
  // Samsung TVs respond to ABS_TIME even though they return a fault code
  await soapRequest(TRANSPORT_URL, 'Seek', `
    <InstanceID>0</InstanceID>
    <Unit>ABS_TIME</Unit>
    <Target>${time}</Target>
  `).catch(() => {});
}

// Helper: convert seconds to HH:MM:SS
export function secondsToHMS(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Helper: convert HH:MM:SS to seconds
export function hmsToSeconds(hms) {
  const parts = hms.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

export async function tvGetPosition() {
  const res = await soapRequest(TRANSPORT_URL, 'GetPositionInfo', '<InstanceID>0</InstanceID>');
  const body = await res.text();

  const posMatch = body.match(/<RelTime>([\d:]+)<\/RelTime>/);
  const durMatch = body.match(/<TrackDuration>([\d:]+)<\/TrackDuration>/);

  return {
    position: posMatch?.[1] || '0:00:00',
    duration: durMatch?.[1] || '0:00:00',
  };
}

export async function tvGetTransportState() {
  const res = await soapRequest(TRANSPORT_URL, 'GetTransportInfo', '<InstanceID>0</InstanceID>');
  const body = await res.text();

  const stateMatch = body.match(/<CurrentTransportState>(.*?)<\/CurrentTransportState>/);
  const statusMatch = body.match(/<CurrentTransportStatus>(.*?)<\/CurrentTransportStatus>/);

  return {
    state: stateMatch?.[1] || 'UNKNOWN',
    status: statusMatch?.[1] || 'UNKNOWN',
  };
}

export async function tvSetVolume(vol) {
  await soapRequest(RENDERING_URL, 'SetVolume', `
    <InstanceID>0</InstanceID>
    <Channel>Master</Channel>
    <DesiredVolume>${vol}</DesiredVolume>
  `);
}

export async function tvGetVolume() {
  const res = await soapRequest(RENDERING_URL, 'GetVolume', `
    <InstanceID>0</InstanceID>
    <Channel>Master</Channel>
  `);
  const body = await res.text();
  const match = body.match(/<CurrentVolume>(\d+)<\/CurrentVolume>/);
  return parseInt(match?.[1] || '0', 10);
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function getLocalIP() {
  const { networkInterfaces } = await import('os');
  const nets = networkInterfaces();
  for (const name of ['en0', 'en1']) {
    const iface = nets[name];
    if (iface) {
      const ipv4 = iface.find(i => i.family === 'IPv4' && !i.internal);
      if (ipv4) return ipv4.address;
    }
  }
  return '127.0.0.1';
}

export async function isTVAvailable() {
  try {
    const res = await fetch(`http://${TV_IP}:${TV_PORT}/dmr`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}
