// Who may talk to the daemon. It listens on 127.0.0.1 only, but any web page open in a browser on this Mac can still
// send requests to 127.0.0.1, and a rebinding DNS name can make it look same-origin. So:
//   - the Host header must be a loopback name (stops DNS rebinding),
//   - a browser request from another site is refused (Origin / Sec-Fetch-Site),
//   - requests without an Origin (the MCP server, curl, the Mac app) are allowed: they are local programs.
// Hosted mode (the hub proxies a public site to this daemon) has its own access control, so these checks are off there.

const HOSTED = process.env.IRONHIDE_HOSTED === '1';
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export const hostAllowed = (req) => HOSTED || LOOPBACK.test(req.headers.host || '');
export const originAllowed = (origin) => HOSTED || !origin || LOOPBACK_ORIGIN.test(origin);

/** A request from a page on another site (fetch, form post, image tag), which must not reach the API. */
export function crossSite(req) {
  if (HOSTED) return false;
  if (!originAllowed(req.headers.origin)) return true;
  return req.headers['sec-fetch-site'] === 'cross-site';
}

/** The reason to refuse a request, or '' to let it through. */
export function refuse(req) {
  if (!hostAllowed(req)) return 'Unknown host';
  if (crossSite(req)) return 'Not allowed from this site';
  return '';
}

// What pages served by the daemon may load. Inline styles stay (the UI sets many); scripts only from here and YouTube's
// player API (trailers). ipc: is the Mac app's bridge to the native player.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http://127.0.0.1:* http://localhost:*",
  "media-src 'self' blob: data: https:",
  "font-src 'self' data:",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:* ipc: http://ipc.localhost",
  'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');
