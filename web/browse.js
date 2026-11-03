/* IronHide Browse — vanilla JS. Talks to the daemon API on the same origin. */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const api = async (path, opts) => {
  const r = await fetch(path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || r.statusText);
  return d;
};
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.textContent = msg;
  $('#toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

const posterOf = (id) => `https://images.metahub.space/poster/medium/${id}/img`;

function card(item, extra = '') {
  const type = item.type === 'tv' ? 'series' : item.type;
  return `<button class="card" data-id="${esc(item.imdbId)}" data-type="${esc(type)}" data-title="${esc(item.title)}">
    <div class="img" style="background-image:url('${esc(item.poster || posterOf(item.imdbId))}')">${extra}</div>
    <div class="t">${esc(item.title)}</div>
    <div class="m">${esc(item.year)}${item.rating ? ' · ★ ' + esc(item.rating) : ''}</div></button>`;
}

function historyCard(h) {
  const ep = h.season ? ` S${String(h.season).padStart(2, '0')}E${String(h.episode).padStart(2, '0')}` : '';
  const pct = Math.min(100, Math.round(h.percent || 0));
  return card({ imdbId: h.imdbId, type: h.type, title: h.title + ep, year: '', rating: '' }, pct ? `<div class="prog"><i style="width:${pct}%"></i></div>` : '');
}

async function renderHome() {
  const view = $('#view');
  view.innerHTML = '<div class="note">unlocking the vault…</div>';
  const [feeds, history] = await Promise.all([api('/api/catalog/feeds'), api('/api/history').catch(() => [])]);
  const seen = new Set();
  const recent = history.filter(h => !seen.has(h.imdbId) && seen.add(h.imdbId)).slice(0, 14);
  let html = recent.length ? `<section class="row"><h2>Continue watching</h2><div class="rail">${recent.map(historyCard).join('')}</div></section>` : '';
  html += feeds.map(f => `<section class="row" data-feed="${f.id}"><h2>${esc(f.label)}</h2><div class="rail"><div class="note">…</div></div></section>`).join('');
  view.innerHTML = html;
  feeds.forEach(async f => {
    const rail = $(`[data-feed="${f.id}"] .rail`);
    try {
      const items = await api('/api/catalog/feed/' + f.id);
      rail.innerHTML = items.length ? items.map(i => card(i)).join('') : '<div class="note">nothing here</div>';
    } catch { rail.innerHTML = '<div class="note">failed to load</div>'; }
  });
}

async function renderSearch(q) {
  const view = $('#view');
  view.innerHTML = '<div class="note">searching…</div>';
  try {
    const items = await api('/api/catalog/search?q=' + encodeURIComponent(q));
    if ($('#q').value.trim() !== q) return;
    view.innerHTML = items.length ? `<div class="grid">${items.map(i => card(i)).join('')}</div>` : '<div class="note">no results</div>';
  } catch (e) { view.innerHTML = `<div class="note">${esc(e.message)}</div>`; }
}

// ---------- Title modal ----------
let current = null; // { meta, season, episode }

async function openTitle(imdbId, type, fallbackTitle) {
  const modal = $('#modal'), panel = $('#modalPanel');
  modal.classList.remove('hidden');
  panel.innerHTML = '<div class="body note">loading…</div>';
  try {
    const meta = await api(`/api/title/${imdbId}?type=${type}`);
    current = { meta, season: null, episode: null };
    if (type === 'series') {
      const seasons = Object.keys(meta.seasons || {}).map(Number).sort((a, b) => a - b);
      current.season = seasons[0] ?? 1;
    }
    drawTitle();
    if (type === 'movie') loadStreams();
  } catch (e) {
    panel.innerHTML = `<button class="close" aria-label="Close">×</button><div class="body note">${esc(e.message || 'could not load ' + fallbackTitle)}</div>`;
  }
}

function drawTitle() {
  const { meta, season, episode } = current;
  const bg = meta.background ? `background-image:url('${esc(meta.background)}')` : '';
  let body = '';
  if (meta.type === 'series') {
    const seasons = Object.keys(meta.seasons || {}).map(Number).sort((a, b) => a - b);
    const eps = meta.seasons?.[season] || [];
    body = `<div class="tabs">${seasons.map(s => `<button class="tab ${s === season ? 'on' : ''}" data-season="${s}">Season ${s}</button>`).join('')}</div>
      <div class="eps">${eps.map(e => `<button class="ep ${e.episode === episode ? 'on' : ''}" data-ep="${e.episode}"><b>${e.episode}</b><span>${esc(e.name)}</span><span class="d">${esc(e.released)}</span></button>`).join('')}</div>`;
  }
  $('#modalPanel').innerHTML = `<button class="close" aria-label="Close">×</button>
    <div class="hero" style="${bg}"><div class="poster" style="background-image:url('${esc(meta.poster)}')"></div>
      <div><h1>${esc(meta.title)}</h1><div class="sub">${esc(meta.year)}${meta.runtime ? ' · ' + esc(meta.runtime) : ''}${meta.rating ? ' · ★ ' + esc(meta.rating) : ''}${meta.genres?.length ? ' · ' + esc(meta.genres.join(', ')) : ''}</div><p>${esc(meta.overview)}</p></div></div>
    <div class="body">${body}<div class="streams" id="streams"></div></div>`;
}

async function loadStreams() {
  const { meta, season, episode } = current;
  const box = $('#streams');
  if (meta.type === 'series' && episode == null) { box.innerHTML = '<div class="note">pick an episode</div>'; return; }
  box.innerHTML = '<div class="note">digging for streams…</div>';
  const qs = new URLSearchParams({ imdbId: meta.imdbId, type: meta.type, title: meta.title });
  if (meta.type === 'series') { qs.set('season', season); qs.set('episode', episode); }
  try {
    const streams = await api('/api/streams?' + qs);
    if (!streams.length) { box.innerHTML = '<div class="note">no streams found</div>'; return; }
    box.innerHTML = '<h3>Streams</h3>' + streams.slice(0, 20).map(s => `<div class="stream">
      <span>${s.isRD ? '<span class="badge rd">RD</span>' : '<span class="badge">P2P</span>'}</span>
      <span class="res">${esc(s.resolution || '—')}</span>
      <div><div>${s.tags.map(t => `<span class="badge ${t.toLowerCase()}">${t}</span>`).join('')}<span class="sz">${esc(s.size)} · ↑${s.seeds}</span></div><div class="q" title="${esc(s.quality)}">${esc(s.quality)}</div></div>
      <div class="acts"><button class="btn primary" data-play="${s.index}">Play</button>${s.isRD ? `<button class="btn" data-tv="${s.index}">TV</button>` : ''}</div></div>`).join('');
  } catch (e) { box.innerHTML = `<div class="note">${esc(e.message)}</div>`; }
}

async function play(index, target) {
  try {
    const r = await post('/api/play', { index, target });
    toast((r.content?.[0]?.text || 'started').split('\n')[0].slice(0, 90), 'success');
    setTimeout(pollRemote, 2500);
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- Events ----------
const closeModal = () => { $('#modal').classList.add('hidden'); current = null; };

document.addEventListener('click', (e) => {
  const t = e.target;
  const c = t.closest('.card'); if (c) return openTitle(c.dataset.id, c.dataset.type, c.dataset.title);
  if (t.closest('.close') || t.id === 'modal') return closeModal();
  const s = t.closest('[data-season]'); if (s) { current.season = Number(s.dataset.season); current.episode = null; drawTitle(); return; }
  const ep = t.closest('[data-ep]'); if (ep) { current.episode = Number(ep.dataset.ep); drawTitle(); return loadStreams(); }
  const p = t.closest('[data-play]'); if (p) return play(Number(p.dataset.play), 'mac');
  const tv = t.closest('[data-tv]'); if (tv) return play(Number(tv.dataset.tv), 'tv');
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

let timer;
$('#q').addEventListener('input', (e) => {
  clearTimeout(timer);
  const q = e.target.value.trim();
  timer = setTimeout(() => (q ? renderSearch(q) : renderHome()), 350);
});

// ---------- Remote ----------
const ctl = (action, value) => post('/api/control', { action, value }).then(pollRemote).catch(e => toast(e.message, 'error'));
$('#rPlay').onclick = () => ctl('toggle');
$('#rBack').onclick = () => ctl('seek_back', 30);
$('#rFwd').onclick = () => ctl('seek_forward', 30);
$('#rStop').onclick = () => ctl('stop');

async function pollRemote() {
  try {
    const np = await api('/api/nowplaying');
    const bar = $('#remote');
    if (!np) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    $('#rTitle').textContent = (np.playing ? '▶ ' : '⏸ ') + (np.title || 'Playing');
    $('#rFill').style.width = (np.percent || 0) + '%';
    $('#rTime').textContent = `${fmt(np.position)} / ${fmt(np.duration)}`;
  } catch { /* daemon restarting */ }
}
setInterval(pollRemote, 2000);

renderHome().catch(e => { $('#view').innerHTML = `<div class="note">${esc(e.message)}</div>`; });
pollRemote();
