export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
import { DECOS, decoSvg } from './decorations.js';
import { POLYS, clipOf, facetSvg } from './shapes.js';
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const posterOf = (id, size = 'large') => `https://images.metahub.space/poster/${size}/${id}/img`;
export const pad = (n) => String(n).padStart(2, '0');
export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${pad(m)}` : m) + ':' + pad(x);
}

// Stroke icons, 24x24 grid.
const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="M16.5 5.5l3.5-1 3 14-3.5 1z" transform="translate(-2 0)"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  pause: '<rect x="6" y="5" width="4.2" height="14" rx="1.3" fill="currentColor" stroke="none"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.3" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  back: '<path d="M11 6L5 12l6 6M19 6l-6 6 6 6"/>', fwd: '<path d="M13 6l6 6-6 6M5 6l6 6-6 6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>', users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.7 3.2-5.5 6.5-5.5s6 1.8 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.6 0 4.2 1.5 4.5 4"/>', expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', pip: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="12" width="7" height="5" rx="1"/>', chev: '<path d="M6 9l6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  palette: '<path d="M12 3a9 9 0 100 18c1.5 0 2-1 1.5-2.2-.5-1.2.3-2.3 1.6-2.3H17a4 4 0 004-4c0-5-4-9.5-9-9.5z"/><circle cx="8" cy="11" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16" cy="11" r="1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4"/>',
  nodes: '<circle cx="12" cy="12" r="2.5"/><circle cx="4.5" cy="5.5" r="2"/><circle cx="19.5" cy="5.5" r="2"/><circle cx="4.5" cy="18.5" r="2"/><circle cx="19.5" cy="18.5" r="2"/><path d="M10 10.5L6 7M14 10.5L18 7M10 13.5L6 17M14 13.5L18 17"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>',
  laptop: '<rect x="5" y="5" width="14" height="10" rx="1.5"/><path d="M3 19h18"/>',
  bolt: '<path d="M13 2L5 13h6l-1 9 8-11h-6z"/>', refresh: '<path d="M20 11a8 8 0 00-14-4L4 9M4 4v5h5M4 13a8 8 0 0014 4l2-2M20 20v-5h-5"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  ghost: '<path d="M5 20V11a7 7 0 0114 0v9l-3-2-2 2-2-2-2 2-2-2z"/><circle cx="9.5" cy="11" r="1"/><circle cx="14.5" cy="11" r="1"/>',
  flame: '<path d="M12 3c1 4 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-9z"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  rocket: '<path d="M5 15c-1 1-1.5 3-1.5 5 2 0 4-.5 5-1.5M14 4c4 0 6 2 6 6-3 4-6 6-8 7l-5-5c1-2 3-5 7-8z"/><circle cx="15" cy="9" r="1.5"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>', heart: '<path d="M12 20s-8-4.7-8-10.5A4.5 4.5 0 0112 7a4.5 4.5 0 018 2.5C20 15.300 12 20 12 20z"/>',
  skull: '<path d="M12 3a8 8 0 00-5 14.200V20h10v-2.800A8 8 0 0012 3z"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><path d="M10 20v-2M14 20v-2"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
  gamepad: '<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M7 10v4M5 12h4M16 11h.01M18 13h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  trailer: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9v6l5-3z"/>',
  thumb: '<path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 012 2v4h5.5a2 2 0 012 2.3l-1.2 7A2 2 0 0117.3 20H7"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
};
export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.film}</svg>`;
export const AVATAR_ICONS = ['film', 'ghost', 'flame', 'star', 'rocket', 'crown', 'heart', 'bolt', 'moon', 'skull', 'eye', 'key', 'gamepad', 'user'];
export const AVATAR_COLORS = ['indigo', 'orange', 'emerald', 'rose', 'sky', 'violet', 'amber', 'slate'];

export const AV_SHAPES = ['circle', 'squircle', 'rounded', 'hex', 'octagon', 'diamond', 'shield', ...Object.keys(POLYS)];
export const AV_FRAMES = [['none', 'None'], ['ring', 'Ring'], ['gradient', 'Gradient'], ['double', 'Double'], ['glow', 'Glow'], ['pulse', 'Pulse'], ['spin', 'Spin'], ['bevel', 'Bevel']];
const HEXC = /^#[0-9a-f]{6}$/i;
// Avatar = wrapper (glow) > frame (clipped, painted with the border colours) > face (photo or gradient + icon)
export const avatar = (profile, size = 34) => {
  const a = profile.avatar || {}, hasDeco = !!(a.deco && DECOS[a.deco]); // a decoration always sits on a circle, with no extra frame
  const shape = !hasDeco && AV_SHAPES.includes(a.shape) ? a.shape : 'circle', frame = hasDeco ? 'none' : (a.frame || 'none');
  const fa = HEXC.test(a.fa) ? a.fa : '#8f8cff', fb = HEXC.test(a.fb) ? a.fb : '#ff7ad9';
  const bw = frame === 'none' ? 0 : Math.max(2, Math.round(size * (frame === 'double' ? 0.11 : frame === 'bevel' ? 0.1 : 0.065)));
  const bg = a.custom && HEXC.test(a.ga) && HEXC.test(a.gb) ? `linear-gradient(${a.angle ?? 135}deg, ${a.ga}, ${a.gb})` : null;
  const face = a.image ? `<img src="${esc(a.image)}" alt="" draggable="false">` : icon(a.icon || 'film');
  const deco = a.deco && DECOS[a.deco] ? `<span class="avd">${decoSvg(a.deco)}</span>` : '';
  const poly = POLYS[shape] ? `--clip:${clipOf(shape)};--rad:0;` : '';
  const wantFacets = !hasDeco && !!a.facet, wantBevel = frame === 'bevel';
  const overlay = (wantFacets || wantBevel) && size >= 28 ? facetSvg(POLYS[shape] ? shape : '', wantBevel, wantFacets, bw / size) : '';
  return `<span class="avw fr-${frame}${deco ? ' has-deco' : ''}" style="--s:${size}px;--bw:${bw}px;--fa:${fa};--fb:${fb}"><span class="avx sh-${POLYS[shape] ? 'poly' : shape}" ${poly ? `style="${poly}"` : ''}><span class="avi av-${esc(a.color || 'indigo')}" ${bg && !a.image ? `style="background:${bg}"` : ''}>${face}</span>${overlay}</span>${deco}</span>`;
};

export const LOGO = '<img class="orb-logo" src="/img/orbie-orb.png" alt="" width="32" height="32" decoding="async" draggable="false">';

// Plain words instead of what a library threw ("Failed to fetch", "HTTP 502", a stack trace)
export function friendly(msg) {
  const m = String(msg?.message || msg || '').trim();
  if (/failed to fetch|networkerror|load failed|fetch failed|ECONNREFUSED/i.test(m)) return "Orbie's service isn't answering. Give it a moment and try again.";
  if (/timed? ?out|ETIMEDOUT|aborted/i.test(m)) return 'That took too long. Try again.';
  if (/\b(5\d\d)\b|bad gateway|service unavailable/i.test(m)) return 'A service Orbie uses is having trouble. Try again in a minute.';
  if (/\b401\b|\b403\b|unauthori[sz]ed|invalid (api )?key/i.test(m)) return 'A key in Settings → Connectors was refused. Check it there.';
  return m.replace(/^Error:\s*/, '').split('\n')[0].slice(0, 200) || 'Something went wrong';
}

/**
 * "Are you sure?" drawn by Orbie itself. The browser's confirm() can't be used: the Mac app's web view never shows it
 * and answers "no" straight away, so every such button silently did nothing there. Resolves true / false.
 * opts: { ok: 'Remove', danger: true }
 */
export function ask(message, opts = {}) {
  return new Promise((done) => {
    const prev = document.activeElement;
    const wrap = document.createElement('div'); wrap.className = 'askw';
    wrap.innerHTML = `<div class="ask" role="alertdialog" aria-modal="true" aria-labelledby="askT"><p id="askT"></p>
      <div class="ask-a"><button class="btn ghost" data-v="0">${esc(opts.cancel || 'Cancel')}</button><button class="btn ${opts.danger ? 'danger' : 'primary'}" data-v="1">${esc(opts.ok || 'OK')}</button></div></div>`;
    wrap.querySelector('#askT').textContent = message;
    const finish = (v) => { document.removeEventListener('keydown', keys, true); wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 180); prev?.focus?.(); done(v); };
    const keys = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(document.activeElement?.dataset?.v !== '0'); }
      else if (e.key === 'Tab') { const bs = [...wrap.querySelectorAll('button')], i = bs.indexOf(document.activeElement); e.preventDefault(); bs[(i + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus(); }
    };
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) finish(b.dataset.v === '1'); else if (e.target === wrap) finish(false); });
    document.addEventListener('keydown', keys, true);
    document.body.append(wrap); requestAnimationFrame(() => wrap.classList.add('in'));
    wrap.querySelector(opts.danger ? '[data-v="0"]' : '[data-v="1"]').focus(); // a destructive choice is never the default
  });
}

/** A short message at the top. opts: { action: { label, run }, ms } — an action (Retry, Undo) keeps it up longer. */
export function toast(msg, kind = '', opts = {}) {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  // a small mark says what kind of message it is: done, a problem, or just so you know
  const mark = document.createElement('i'); mark.className = 'toast-mark'; mark.innerHTML = icon(kind === 'err' ? 'info' : kind === 'ok' ? 'check' : 'bolt');
  const text = document.createElement('span'); text.className = 'toast-text'; text.textContent = kind === 'err' ? friendly(msg) : String(msg);
  el.append(mark, text);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  if (opts.action) {
    const b = document.createElement('button'); b.className = 'toast-act'; b.textContent = opts.action.label;
    b.onclick = () => { close(); opts.action.run(); }; el.append(b); el.classList.add('has-act');
  }
  const ms = opts.ms ?? (opts.action ? 8000 : kind === 'err' ? 6000 : 3800);
  // a hairline along the bottom runs down while the message stays; it waits while you point at it
  const bar = document.createElement('b'); bar.className = 'toast-time'; el.append(bar);
  const run = (d) => { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = `toast-time ${d}ms linear forwards`; };
  box.appendChild(el); run(ms);
  let t = setTimeout(close, ms);
  el.onmouseenter = () => { clearTimeout(t); bar.style.animationPlayState = 'paused'; };
  el.onmouseleave = () => { t = setTimeout(close, 2500); run(2500); };
  return close;
}

export const wl = new Set(); // imdb ids on the watchlist, filled at boot

// Poster card. Whole poster links to the title; hover buttons play or save in one click.
// The poster card from Home, for any page: same size, tilt, lift and hover, as a link to the title.
// `sub` is the line under the title, `extra` sits on the poster (a progress bar, a badge).
export function posterCard(it, { sub = '', extra = '', i = 0 } = {}) {
  const type = it.type === 'tv' ? 'series' : it.type;
  return `<a class="bc pc" href="#/title/${esc(type)}/${esc(it.imdbId)}" style="--i:${Math.min(i, 24)}" data-id="${esc(it.imdbId)}" data-type="${esc(type)}" data-title="${esc(it.title)}" data-poster="${esc(it.poster || '')}">
    <div class="bposter"><img class="bimg ld" src="${esc(it.poster || posterOf(it.imdbId))}" alt="" loading="${i < 8 ? 'eager' : 'lazy'}" decoding="async" draggable="false">${extra}</div>
    <div class="binfo"><h3>${esc(it.title)}</h3>${sub ? `<div class="bmeta"><span>${sub}</span></div>` : ''}</div></a>`;
}

export function card(item, extra = '') {
  const type = item.type === 'tv' ? 'series' : item.type;
  const href = `#/title/${esc(type)}/${esc(item.imdbId)}`;
  const data = `data-id="${esc(item.imdbId)}" data-type="${esc(type)}" data-title="${esc(item.title)}" data-year="${esc(item.year || '')}" data-poster="${esc(item.poster || '')}" data-rating="${esc(item.rating || '')}"`;
  const saved = wl.has(item.imdbId);
  return `<div class="card" ${data}>
    <a class="img" href="${href}" aria-label="${esc(item.title)}" style="--p:url('${esc(item.poster || posterOf(item.imdbId))}')">${extra}</a>
    <div class="ov"><button class="ob play" data-qp aria-label="Play ${esc(item.title)}">${icon('play')}<span>Play</span></button><button class="ob save ${saved ? 'on' : ''}" data-wl aria-label="${saved ? 'Remove from' : 'Save to'} watchlist">${icon('bookmark')}</button></div>
    <a class="t" href="${href}">${esc(item.title)}</a>
    <div class="m">${esc(item.year || '')}${item.rating ? '<i></i>' + esc(item.rating) : ''}</div></div>`;
}

// Apply appearance settings to <html> and cache them for a flash-free next load.
export function applyAppearance(a) {
  const root = document.documentElement;
  const theme = a.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : a.theme;
  root.dataset.theme = theme; root.dataset.accent = a.accent; root.dataset.density = a.density;
  root.dataset.radius = a.radius; root.dataset.motion = a.motion; root.dataset.poster = a.posterSize;
  root.dataset.layout = a.layout || 'grid'; root.dataset.hero = a.showHero === false ? 'off' : 'on';
  try { localStorage.setItem('ih-appearance', JSON.stringify(a)); } catch {}
}
