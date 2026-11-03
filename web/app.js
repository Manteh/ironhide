/* ============================================================
   IRONHIDE PLAYLIST — app.js
   Vanilla ES2022+, no framework, no external libs
   ============================================================ */

const API_BASE = 'http://localhost:7676';
const WS_URL   = 'ws://localhost:7676';
const SEARCH_DEBOUNCE_MS = 400;

// ============================================================
// STATE
// ============================================================
const state = {
  playlists: [],
  selectedPlaylistId: null,
  selectedPlaylist: null,   // { id, name, items, state }
  nowPlaying: null,         // latest progress event data
  queueState: null,         // latest queue_state data
  searchResults: [],
  searchType: 'movie',
  searchQuery: '',
  isSearching: false,
  dragSrcItemId: null,
  tvEpisodeFormId: null,    // result id that currently shows the TV episode form
};

// ============================================================
// WebSocket
// ============================================================
let ws = null;
let wsReconnectTimer = null;
let wsConnected = false;

function connectWS() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    wsConnected = true;
    clearTimeout(wsReconnectTimer);
    updateWSIndicator(true);
  });

  ws.addEventListener('close', () => {
    wsConnected = false;
    updateWSIndicator(false);
    wsReconnectTimer = setTimeout(connectWS, 3000);
  });

  ws.addEventListener('error', () => {
    wsConnected = false;
    updateWSIndicator(false, true);
  });

  ws.addEventListener('message', (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleWSMessage(msg);
  });
}

function handleWSMessage(msg) {
  const { type, data } = msg;

  switch (type) {
    case 'item_start': {
      state.queueState = { playing: true, ...data };
      renderNowPlayingBar();
      if (state.selectedPlaylist) refreshPlayingIndicator(data.index);
      break;
    }
    case 'item_done': {
      // leave queueState intact, next item_start or queue_done will update
      break;
    }
    case 'queue_done': {
      closeStreamOverlay(0);
      state.nowPlaying = null;
      state.queueState = null;
      renderNowPlayingBar();
      refreshPlayingIndicator(-1);
      if (state.selectedPlaylistId === data.playlistId) {
        loadPlaylist(state.selectedPlaylistId);
      }
      break;
    }
    case 'stopped': {
      closeStreamOverlay(0);
      state.nowPlaying = null;
      state.queueState = null;
      renderNowPlayingBar();
      refreshPlayingIndicator(-1);
      break;
    }
    case 'queue_state': {
      state.queueState = data;
      renderNowPlayingBar();
      if (data && state.selectedPlaylist) refreshPlayingIndicator(data.itemIndex ?? -1);
      break;
    }
    case 'stream_search_start': {
      showStreamOverlay(data.title, data.episode);
      break;
    }
    case 'stream_results': {
      if (data.streams.length === 0) {
        logActivity(data.error ? `⚠ Error: ${data.error}` : '⚠ No streams found', 'err');
        closeStreamOverlay(1200);
        showToast(data.error ? `Stream error: ${data.error}` : 'No streams found — skipping', 'error');
      } else {
        logActivity(`📋 Found ${data.totalCount} streams (${data.rdCount} on Real-Debrid) — will try ${data.attemptCount}`);
        renderStreamResults(data.streams, data.selectedIndex, data.reason, data.selectedIsRD);
      }
      break;
    }
    case 'stream_launching': {
      const label = data.isRD ? '⚡ RD' : '↓ torrent';
      logActivity(`${label} resolving ${data.attempt}/${data.total}: ${(data.quality || '').slice(0, 45)}`);
      updateOverlayAttempt(data.attempt, data.total, data.isRD, data.quality);
      break;
    }
    case 'stream_attempt_failed': {
      logActivity(`✗ Not cached — trying next stream`, 'warn');
      updateOverlayStatus(`Stream not cached, trying next…`);
      break;
    }
    case 'stream_launched': {
      logActivity(`✓ Stream ready — launching mpv (${data.isRD ? 'Real-Debrid' : 'webtorrent'})`, 'ok');
      logActivity(`⏳ mpv buffering — window opens shortly…`);
      updateOverlayLaunching(data.isRD, data.quality, data.size);
      break;
    }
    case 'progress': {
      const wasLoading = state.nowPlaying == null;
      state.nowPlaying = data;
      if (state.queueState === null) state.queueState = { playing: true };
      renderNowPlayingBar();
      if (state.selectedPlaylist) refreshPlayingIndicator(data.itemIndex);
      // First confirmed playback — close overlay with brief "Playing" flash
      if (streamOverlayEl) {
        logActivity(`▶ Playing — mpv window open`, 'ok');
        closeStreamOverlay(1200);
      }
      break;
    }
    case 'error': {
      logActivity(`⚠ ${data.message || 'Playback error'}`, 'err');
      closeStreamOverlay(1500);
      showToast(data.message || 'Playback error', 'error');
      break;
    }
  }
}

function updateWSIndicator(connected, error = false) {
  const el = document.getElementById('headerStatus');
  if (!el) return;
  el.innerHTML = `
    <span class="ws-dot ${connected ? 'connected' : error ? 'error' : ''}"></span>
    <span>${connected ? 'Live' : 'Reconnecting…'}</span>
  `;
}

// ============================================================
// API helpers
// ============================================================
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return null;
}

// ============================================================
// Data loading
// ============================================================
async function loadPlaylists() {
  try {
    const data = await apiFetch('/api/playlists');
    state.playlists = data ?? [];
    renderSidebar();
  } catch (err) {
    showToast(`Failed to load playlists: ${err.message}`, 'error');
  }
}

async function loadPlaylist(id) {
  try {
    const data = await apiFetch(`/api/playlists/${id}`);
    state.selectedPlaylist = data;
    state.selectedPlaylistId = id;
    state.searchResults = [];
    state.searchQuery = '';
    state.tvEpisodeFormId = null;
    renderMain();
    renderSidebar();
  } catch (err) {
    showToast(`Failed to load playlist: ${err.message}`, 'error');
  }
}

// ============================================================
// Playlist CRUD
// ============================================================
async function createPlaylist(name) {
  try {
    const data = await apiFetch('/api/playlists', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await loadPlaylists();
    if (data?.id) selectPlaylist(data.id);
  } catch (err) {
    showToast(`Failed to create playlist: ${err.message}`, 'error');
  }
}

async function selectPlaylist(id) {
  if (state.selectedPlaylistId === id && state.selectedPlaylist) return;
  state.selectedPlaylistId = id;
  state.selectedPlaylist = null;
  renderMain(); // show loading
  await loadPlaylist(id);
}

async function deletePlaylist(id) {
  if (!confirm('Delete this playlist?')) return;
  try {
    await apiFetch(`/api/playlists/${id}`, { method: 'DELETE' });
    state.selectedPlaylistId = null;
    state.selectedPlaylist = null;
    await loadPlaylists();
    renderMain();
  } catch (err) {
    showToast(`Failed to delete playlist: ${err.message}`, 'error');
  }
}

// ============================================================
// Items CRUD
// ============================================================
async function addItem(playlistId, item) {
  try {
    await apiFetch(`/api/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify(item),
    });
    await loadPlaylist(playlistId);
    showToast(`Added: ${item.title}`, 'success');
  } catch (err) {
    showToast(`Failed to add item: ${err.message}`, 'error');
  }
}

async function removeItem(playlistId, itemId) {
  try {
    await apiFetch(`/api/playlists/${playlistId}/items/${itemId}`, { method: 'DELETE' });
    await loadPlaylist(playlistId);
  } catch (err) {
    showToast(`Failed to remove item: ${err.message}`, 'error');
  }
}

async function reorderItems(playlistId, order) {
  try {
    await apiFetch(`/api/playlists/${playlistId}/items/reorder`, {
      method: 'PUT',
      body: JSON.stringify({ order }),
    });
    await loadPlaylist(playlistId);
  } catch (err) {
    showToast(`Failed to reorder: ${err.message}`, 'error');
  }
}

// ============================================================
// Playback
// ============================================================
async function play(id, fromIndex = 0) {
  // Optimistically show now playing bar
  state.queueState = { playing: true, title: 'Resolving stream…' };
  state.nowPlaying = { title: 'Resolving stream…', percent: 0 };
  renderNowPlayingBar();
  try {
    await apiFetch(`/api/playlists/${id}/play`, {
      method: 'POST',
      body: JSON.stringify({ fromIndex }),
    });
  } catch (err) {
    state.queueState = null;
    state.nowPlaying = null;
    renderNowPlayingBar();
    showToast(`Playback failed: ${err.message}`, 'error');
  }
}

async function resume(id) {
  try {
    await apiFetch(`/api/playlists/${id}/resume`, { method: 'POST' });
  } catch (err) {
    showToast(`Resume failed: ${err.message}`, 'error');
  }
}

async function skip() {
  try {
    await apiFetch('/api/playlist/skip', { method: 'POST' });
  } catch (err) {
    showToast(`Skip failed: ${err.message}`, 'error');
  }
}

async function stop() {
  try {
    await apiFetch('/api/playlist/stop', { method: 'POST' });
  } catch (err) {
    showToast(`Stop failed: ${err.message}`, 'error');
  }
}

// ============================================================
// Search
// ============================================================
let searchDebounceTimer = null;

async function search(q, type) {
  if (!q || q.trim().length < 2) {
    state.searchResults = [];
    renderSearchResults();
    return;
  }
  state.isSearching = true;
  renderSearchResults();
  try {
    const results = await apiFetch(`/api/search?q=${encodeURIComponent(q)}&type=${type}`);
    state.searchResults = results ?? [];
  } catch (err) {
    state.searchResults = [];
    showToast(`Search failed: ${err.message}`, 'error');
  } finally {
    state.isSearching = false;
    renderSearchResults();
  }
}

function scheduleSearch(q, type) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => search(q, type), SEARCH_DEBOUNCE_MS);
}

// ============================================================
// Helpers
// ============================================================
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimeFull(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function totalRuntime(items) {
  const total = items.reduce((sum, i) => sum + (i.duration ?? 0), 0);
  return total > 0 ? formatTime(total) : null;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 300ms';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================================
// RENDER — Sidebar
// ============================================================
function renderSidebar() {
  const el = document.getElementById('sidebarPlaylists');
  if (!el) return;

  if (state.playlists.length === 0) {
    el.innerHTML = `<div class="sidebar-section-label">No playlists yet</div>`;
    return;
  }

  el.innerHTML = `<div class="sidebar-section-label">Playlists</div>` +
    state.playlists.map(pl => {
      const isSelected = pl.id === state.selectedPlaylistId;
      const count = pl.itemCount ?? 0;
      return `
        <div class="playlist-item ${isSelected ? 'selected' : ''}"
             data-id="${pl.id}"
             role="button"
             tabindex="0">
          <span class="playlist-item-icon">🎬</span>
          <div class="playlist-item-info">
            <div class="playlist-item-name">${escapeHtml(pl.name)}</div>
            <div class="playlist-item-meta">${count} item${count !== 1 ? 's' : ''}</div>
          </div>
          <span class="playlist-play-hint">▶</span>
        </div>`;
    }).join('');

  el.querySelectorAll('.playlist-item').forEach(item => {
    item.addEventListener('click', () => selectPlaylist(item.dataset.id));
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') selectPlaylist(item.dataset.id);
    });
  });
}

// ============================================================
// RENDER — Main content
// ============================================================
function renderMain() {
  const el = document.getElementById('mainContent');
  if (!el) return;

  if (!state.selectedPlaylistId) {
    renderHome(el);
    return;
  }

  if (!state.selectedPlaylist) {
    el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Loading…</div></div>`;
    return;
  }

  renderPlaylistDetail(el, state.selectedPlaylist);
}

function renderHome(el) {
  if (state.playlists.length === 0) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎬</div>
        <div class="empty-state-title">No playlists yet</div>
        <div class="empty-state-sub">Create your first playlist to start queuing up movies and TV episodes.</div>
        <button class="btn-primary" id="emptyCreateBtn">+ New Playlist</button>
      </div>`;
    el.querySelector('#emptyCreateBtn').addEventListener('click', triggerNewPlaylist);
  } else {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">👈</div>
        <div class="empty-state-title">Select a playlist</div>
        <div class="empty-state-sub">Choose a playlist from the sidebar to view and manage its contents.</div>
      </div>`;
  }
}

function renderPlaylistDetail(el, playlist) {
  const currentIndex = getCurrentPlayingIndex();
  const items = playlist.items ?? [];
  const runtime = totalRuntime(items);
  const hasState = !!playlist.state;

  el.innerHTML = `
    <div class="playlist-detail">
      <div class="detail-header">
        <div class="detail-title">${escapeHtml(playlist.name)}</div>
        <div class="detail-meta">
          ${items.length} item${items.length !== 1 ? 's' : ''}${runtime ? ` · ${runtime} total` : ''}
        </div>
        <div class="detail-actions">
          <button class="btn-play" id="btnPlay">▶ Play</button>
          ${hasState ? `<button class="btn-resume" id="btnResume">↩ Resume</button>` : ''}
          <button class="btn-delete-playlist" id="btnDeletePlaylist">Delete playlist</button>
        </div>
      </div>

      <div class="items-list" id="itemsList">
        ${items.length === 0
          ? `<div class="empty-state" style="height:120px"><div class="empty-state-sub">No items yet. Use the search below to add some.</div></div>`
          : items.map((item, idx) => renderItemRow(item, idx, idx === currentIndex)).join('')}
      </div>

      <div class="search-add-section" id="searchAddSection">
        <div class="search-add-header">
          <input type="text" class="search-input" id="searchInput" placeholder="Search to add…" value="${escapeHtml(state.searchQuery)}" autocomplete="off" />
          <div class="search-type-toggle">
            <button class="search-type-btn ${state.searchType === 'movie' ? 'active' : ''}" data-type="movie">Movie</button>
            <button class="search-type-btn ${state.searchType === 'tv' ? 'active' : ''}" data-type="tv">TV</button>
          </div>
        </div>
        <div class="search-results" id="searchResults">
          ${renderSearchResultsHTML()}
        </div>
      </div>
    </div>`;

  // Wire up events
  el.querySelector('#btnPlay').addEventListener('click', () => play(playlist.id, 0));
  const btnResume = el.querySelector('#btnResume');
  if (btnResume) btnResume.addEventListener('click', () => resume(playlist.id));
  el.querySelector('#btnDeletePlaylist').addEventListener('click', () => deletePlaylist(playlist.id));

  // Search events
  const searchInput = el.querySelector('#searchInput');
  searchInput.addEventListener('input', e => {
    state.searchQuery = e.target.value;
    scheduleSearch(e.target.value, state.searchType);
  });
  searchInput.focus();

  el.querySelectorAll('.search-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.searchType = btn.dataset.type;
      el.querySelectorAll('.search-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (state.searchQuery) scheduleSearch(state.searchQuery, state.searchType);
    });
  });

  // Items: remove buttons
  el.querySelectorAll('.btn-remove-item').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeItem(playlist.id, btn.dataset.itemId);
    });
  });

  // Items: drag and drop
  attachDragHandlers(el.querySelector('#itemsList'), playlist.id, items);

  // Search result interactions
  attachSearchResultEvents(el.querySelector('#searchResults'), playlist.id);
}

function renderItemRow(item, idx, isPlaying) {
  const poster = item.posterUrl
    ? `<img src="${escapeHtml(item.posterUrl)}" alt="" loading="lazy" />`
    : `🎬`;

  const epInfo = (item.type === 'tv' && item.season != null && item.episode != null)
    ? `S${String(item.season).padStart(2,'0')}E${String(item.episode).padStart(2,'0')}`
    : '';

  const playingBadge = isPlaying
    ? `<span class="badge-playing"><span class="playing-dot"></span> Playing</span>`
    : '';

  return `
    <div class="item-row ${isPlaying ? 'playing' : ''}"
         data-item-id="${item.id}"
         data-index="${idx}"
         draggable="true">
      <span class="drag-handle" title="Drag to reorder">⠿</span>
      <div class="item-poster">${poster}</div>
      <div class="item-info">
        <div class="item-title-row">
          <span class="item-title">${escapeHtml(item.title)}</span>
          ${item.year ? `<span class="item-year">${item.year}</span>` : ''}
          ${playingBadge}
        </div>
        ${epInfo ? `<div class="item-episode">${epInfo}</div>` : ''}
      </div>
      <span class="item-duration">${item.duration ? formatTime(item.duration) : '—'}</span>
      <button class="btn-remove-item" data-item-id="${item.id}" title="Remove">✕</button>
    </div>`;
}

// ============================================================
// RENDER — Search results (in-place refresh)
// ============================================================
function renderSearchResults() {
  const el = document.getElementById('searchResults');
  if (!el) return;
  el.innerHTML = renderSearchResultsHTML();
  if (state.selectedPlaylistId) {
    attachSearchResultEvents(el, state.selectedPlaylistId);
  }
}

function renderSearchResultsHTML() {
  if (state.isSearching) {
    return `<div class="search-loading">Searching…</div>`;
  }
  if (!state.searchQuery || state.searchQuery.trim().length < 2) return '';
  if (state.searchResults.length === 0) {
    return `<div class="search-empty">No results for "${escapeHtml(state.searchQuery)}"</div>`;
  }

  return state.searchResults.map(r => {
    const isTVForm = state.tvEpisodeFormId === r.id;
    return `
      <div class="search-result-item" data-result-id="${r.id}" data-result-type="${r.type ?? state.searchType}">
        <div class="result-main">
          <span class="result-title">${escapeHtml(r.title)}</span>
          ${r.year ? `<span class="result-year">${r.year}</span>` : ''}
          ${r.rating ? `<span class="result-rating">★ ${r.rating}</span>` : ''}
        </div>
        ${r.overview ? `<div class="result-overview">${escapeHtml(r.overview)}</div>` : ''}
        ${r.latestEp ? `<div class="result-latest-ep">Latest: ${escapeHtml(r.latestEp)}</div>` : ''}
        ${isTVForm ? renderTVEpisodeForm(r.id) : ''}
      </div>`;
  }).join('');
}

function renderTVEpisodeForm(resultId) {
  return `
    <div class="tv-episode-form" data-form-id="${resultId}">
      <label>Season</label>
      <input type="number" class="tv-season" value="1" min="1" max="99" />
      <label>Episode</label>
      <input type="number" class="tv-episode" value="1" min="1" max="999" />
      <button class="btn-confirm tv-add-btn">Add</button>
    </div>`;
}

function attachSearchResultEvents(container, playlistId) {
  if (!container) return;

  container.querySelectorAll('.search-result-item').forEach(item => {
    const resultId = item.dataset.resultId;
    const resultType = item.dataset.resultType;

    item.addEventListener('click', e => {
      // Don't trigger if clicking inside the TV form
      if (e.target.closest('.tv-episode-form')) return;

      const result = state.searchResults.find(r => String(r.id) === String(resultId));
      if (!result) return;

      if (resultType === 'tv') {
        // Toggle TV form
        state.tvEpisodeFormId = state.tvEpisodeFormId === result.id ? null : result.id;
        renderSearchResults();
      } else {
        // Add movie directly
        addItem(playlistId, {
          title: result.title,
          imdbId: result.imdbId,
          type: 'movie',
          year: result.year,
          posterUrl: result.posterUrl,
          tmdbId: result.id,
        });
      }
    });
  });

  container.querySelectorAll('.tv-add-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const form = btn.closest('.tv-episode-form');
      const resultId = form.dataset.formId;
      const result = state.searchResults.find(r => String(r.id) === String(resultId));
      if (!result) return;
      const season = parseInt(form.querySelector('.tv-season').value, 10) || 1;
      const episode = parseInt(form.querySelector('.tv-episode').value, 10) || 1;
      addItem(playlistId, {
        title: result.title,
        imdbId: result.imdbId,
        type: 'tv',
        season,
        episode,
        year: result.year,
        posterUrl: result.posterUrl,
        tmdbId: result.id,
      });
      state.tvEpisodeFormId = null;
    });
  });
}

// ============================================================
// RENDER — Now Playing bar
// ============================================================
function renderNowPlayingBar() {
  const bar = document.getElementById('nowPlayingBar');
  if (!bar) return;

  const body = document.querySelector('.app-body');
  const active = state.queueState !== null || state.nowPlaying !== null;

  if (!active) {
    bar.classList.add('hidden');
    body?.classList.remove('has-player');
    return;
  }

  bar.classList.remove('hidden');
  body?.classList.add('has-player');

  const np = state.nowPlaying ?? {};
  const qs = state.queueState ?? {};

  const title = np.title ?? qs.title ?? '—';
  const episode = buildEpisodeLabel(np, qs);
  const percent = np.percent ?? 0;
  const position = np.position ?? 0;
  const duration = np.duration ?? 0;
  const isPlaying = np.playing ?? true;
  const itemIndex = np.itemIndex ?? qs.index ?? 0;
  const totalItems = np.totalItems ?? qs.totalItems ?? 0;
  const isBuffering = (title === 'Resolving stream…') || (qs.buffering);

  document.getElementById('npTitle').textContent = title;
  document.getElementById('npEpisode').textContent = episode;
  document.getElementById('npProgressFill').style.width = `${Math.min(100, percent)}%`;
  document.getElementById('npTime').textContent = isBuffering
    ? 'Buffering…'
    : `${formatTimeFull(position)} / ${formatTimeFull(duration)}`;
  document.getElementById('npPosition').textContent =
    totalItems > 0 ? `${itemIndex + 1} / ${totalItems}` : '';
  document.getElementById('npPlayPause').textContent = isPlaying ? '⏸' : '▶';
}

function buildEpisodeLabel(np, qs) {
  if (np.episode) {
    return `S${String(np.season ?? qs.season ?? '?').padStart(2,'0')}E${String(np.episode).padStart(2,'0')}`;
  }
  if (qs.season && qs.episode) {
    return `S${String(qs.season).padStart(2,'0')}E${String(qs.episode).padStart(2,'0')}`;
  }
  return '';
}

function refreshPlayingIndicator(activeIndex) {
  const list = document.getElementById('itemsList');
  if (!list) return;
  list.querySelectorAll('.item-row').forEach(row => {
    const idx = parseInt(row.dataset.index, 10);
    const playing = idx === activeIndex;
    row.classList.toggle('playing', playing);
    const badge = row.querySelector('.badge-playing');
    if (playing && !badge) {
      const titleRow = row.querySelector('.item-title-row');
      if (titleRow) {
        const b = document.createElement('span');
        b.className = 'badge-playing';
        b.innerHTML = `<span class="playing-dot"></span> Playing`;
        titleRow.appendChild(b);
      }
    } else if (!playing && badge) {
      badge.remove();
    }
  });
}

function getCurrentPlayingIndex() {
  if (!state.queueState && !state.nowPlaying) return -1;
  return state.nowPlaying?.itemIndex ?? state.queueState?.index ?? -1;
}

// ============================================================
// DRAG AND DROP
// ============================================================
function attachDragHandlers(listEl, playlistId, items) {
  if (!listEl) return;

  let dragSrcEl = null;

  listEl.querySelectorAll('.item-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragSrcEl = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.itemId);
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      listEl.querySelectorAll('.item-row').forEach(r => r.classList.remove('drag-over'));
      dragSrcEl = null;
    });

    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      listEl.querySelectorAll('.item-row').forEach(r => r.classList.remove('drag-over'));
      if (row !== dragSrcEl) row.classList.add('drag-over');
    });

    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (!dragSrcEl || dragSrcEl === row) return;

      const allRows = [...listEl.querySelectorAll('.item-row')];
      const srcIdx = allRows.indexOf(dragSrcEl);
      const dstIdx = allRows.indexOf(row);

      // Reorder items array locally for order computation
      const itemsCopy = [...items];
      const [moved] = itemsCopy.splice(srcIdx, 1);
      itemsCopy.splice(dstIdx, 0, moved);
      const newOrder = itemsCopy.map(i => i.id);

      reorderItems(playlistId, newOrder);
    });
  });
}

// ============================================================
// NEW PLAYLIST UI
// ============================================================
function triggerNewPlaylist() {
  const btn = document.getElementById('btnNewPlaylist');
  const row = document.getElementById('newPlaylistInputRow');
  if (!btn || !row) return;
  btn.classList.add('hidden');
  row.classList.remove('hidden');
  const input = document.getElementById('newPlaylistName');
  input.value = '';
  input.focus();
}

function confirmNewPlaylist() {
  const input = document.getElementById('newPlaylistName');
  const name = input?.value?.trim();
  if (!name) return;
  cancelNewPlaylist();
  createPlaylist(name);
}

function cancelNewPlaylist() {
  const btn = document.getElementById('btnNewPlaylist');
  const row = document.getElementById('newPlaylistInputRow');
  btn?.classList.remove('hidden');
  row?.classList.add('hidden');
}

// ============================================================
// GLOBAL EVENT WIRING (header + sidebar footer)
// ============================================================
function wireStaticEvents() {
  document.getElementById('btnNewPlaylist')?.addEventListener('click', triggerNewPlaylist);
  document.getElementById('btnConfirmNewPlaylist')?.addEventListener('click', confirmNewPlaylist);
  document.getElementById('btnCancelNewPlaylist')?.addEventListener('click', cancelNewPlaylist);
  document.getElementById('newPlaylistName')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmNewPlaylist();
    if (e.key === 'Escape') cancelNewPlaylist();
  });

  document.getElementById('npSkip')?.addEventListener('click', skip);
  document.getElementById('npStop')?.addEventListener('click', stop);
  document.getElementById('npPlayPause')?.addEventListener('click', () => {
    // Toggle play/pause — backend determines behavior on resume/play
    if (state.nowPlaying?.playing) {
      stop();
    } else if (state.selectedPlaylistId) {
      resume(state.selectedPlaylistId);
    }
  });
}

// ============================================================
// UTILITY
// ============================================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// STREAM PICKER OVERLAY
// ============================================================
let streamOverlayEl = null;
let streamOverlayCloseTimer = null;

function showStreamOverlay(title, episode) {
  clearTimeout(streamOverlayCloseTimer);
  if (streamOverlayEl) { streamOverlayEl.remove(); streamOverlayEl = null; }

  const el = document.createElement('div');
  el.className = 'stream-overlay';
  el.innerHTML = `
    <div class="stream-picker">
      <div class="sp-header">
        <div class="sp-spinner"></div>
        <div class="sp-title-wrap">
          <div class="sp-label">Finding stream for</div>
          <div class="sp-title">${escapeHtml(title)}${episode ? ` <span class="sp-episode">${escapeHtml(episode)}</span>` : ''}</div>
        </div>
        <button class="sp-skip-btn" onclick="skipAndClose()" title="Skip this item">Skip ⏭</button>
      </div>
      <div class="sp-status">Fetching from Torrentio…</div>
      <div class="sp-streams" id="spStreams"></div>
      <div class="sp-selected hidden" id="spSelected"></div>
      <div class="sp-activity-label">Activity</div>
      <div class="sp-activity" id="spActivity"></div>
    </div>
  `;
  document.body.appendChild(el);
  streamOverlayEl = el;
  requestAnimationFrame(() => el.classList.add('visible'));
  logActivity('🔍 Searching Torrentio…');
}

function logActivity(text, kind = '') {
  if (!streamOverlayEl) return;
  const feed = streamOverlayEl.querySelector('#spActivity');
  if (!feed) return;
  const line = document.createElement('div');
  line.className = `sp-act-line${kind ? ' ' + kind : ''}`;
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  line.innerHTML = `<span class="sp-act-time">${time}</span> ${escapeHtml(text)}`;
  feed.appendChild(line);
  feed.scrollTop = feed.scrollHeight;
}

function renderStreamResults(streams, selectedIndex, reason, selectedIsRD) {
  if (!streamOverlayEl) return;
  const container = streamOverlayEl.querySelector('#spStreams');
  const selectedEl = streamOverlayEl.querySelector('#spSelected');
  const statusEl = streamOverlayEl.querySelector('.sp-status');
  statusEl.textContent = `Found ${streams.length} source${streams.length !== 1 ? 's' : ''}`;

  streams.forEach((s, i) => {
    setTimeout(() => {
      if (!streamOverlayEl) return;
      const row = document.createElement('div');
      const isSelected = i === selectedIndex;
      row.className = `sp-stream-row${isSelected ? ' selected' : ''}`;
      row.innerHTML = `
        <span class="sp-idx">${i + 1}</span>
        ${s.isRD ? '<span class="sp-rd">⚡ RD</span>' : '<span class="sp-torrent">↓</span>'}
        <span class="sp-quality">${escapeHtml((s.quality || '').slice(0, 55))}</span>
        <span class="sp-size">${escapeHtml(s.size || '?')}</span>
        ${s.seeds ? `<span class="sp-seeds" title="seeders">↑${s.seeds}</span>` : ''}
        ${isSelected ? '<span class="sp-badge">SELECTED</span>' : ''}
      `;
      container.appendChild(row);

      if (i === streams.length - 1) {
        setTimeout(() => {
          if (!streamOverlayEl) return;
          const sel = streams[selectedIndex];
          if (sel && selectedEl) {
            selectedEl.innerHTML = `
              <span class="sp-check">✓</span>
              <span class="sp-sel-info">${escapeHtml((sel.quality || '').slice(0, 50))} · ${escapeHtml(sel.size || '?')}${sel.isRD ? ' · ⚡ RD instant' : ''}</span>
              <span class="sp-reason">${escapeHtml(reason || '')}</span>
            `;
            selectedEl.classList.remove('hidden');
          }
        }, 300);
      }
    }, i * 80);
  });
}

function updateOverlayStatus(text) {
  if (!streamOverlayEl) return;
  const statusEl = streamOverlayEl.querySelector('.sp-status');
  if (statusEl) statusEl.textContent = text;
}

function updateOverlayAttempt(attempt, total, isRD, quality) {
  if (!streamOverlayEl) return;
  const statusEl = streamOverlayEl.querySelector('.sp-status');
  if (statusEl) {
    const label = isRD ? '⚡ Real-Debrid' : '↓ Torrent';
    statusEl.innerHTML = `<span class="sp-launching">${label} — resolving stream ${attempt}/${total}…</span>`;
  }
}

function updateOverlayLaunching(isRD, quality, size) {
  if (!streamOverlayEl) return;
  const statusEl = streamOverlayEl.querySelector('.sp-status');
  const spinnerEl = streamOverlayEl.querySelector('.sp-spinner');
  if (isRD) {
    if (statusEl) statusEl.innerHTML = '<span class="sp-launching">⚡ Launching mpv…</span>';
    if (spinnerEl) spinnerEl.style.borderTopColor = '#22c55e';
    closeStreamOverlay(4000);
  } else {
    if (statusEl) statusEl.innerHTML = '<span class="sp-buffering">↓ Webtorrent downloading — mpv opens once buffered. Use Skip ⏭ if it takes too long.</span>';
    if (spinnerEl) spinnerEl.style.borderTopColor = '#f59e0b';
    // No IPC socket for webtorrent-spawned mpv, so close overlay and let bar handle it
    closeStreamOverlay(3500);
  }
}

function closeStreamOverlay(delayMs = 0) {
  clearTimeout(streamOverlayCloseTimer);
  const el = streamOverlayEl;
  if (!el) return;
  streamOverlayEl = null;
  streamOverlayCloseTimer = setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 300);
  }, delayMs);
}

async function skipAndClose() {
  closeStreamOverlay(0);
  await skip();
}

// ============================================================
// BOOT
// ============================================================
async function init() {
  wireStaticEvents();
  updateWSIndicator(false);
  connectWS();
  await loadPlaylists();
  renderMain();
}

document.addEventListener('DOMContentLoaded', init);
