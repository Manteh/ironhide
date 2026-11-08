// Taste Lab: teach the recommender by playing. Four tabs:
//   Rate        - a card stack. Swipe right = liked (4★), left = not for me, up = want to watch, down = haven't seen;
//                 or tap 1-5 stars. Keys: 1-5, S (haven't seen), W (want to watch), X (not for me), ←/→ swipe.
//   This or that - two titles you've seen; pick the better one (Elo). Keys: ← / → , space = can't decide, S = skip.
//   Board       - your favourites, ranked by stars and duels.
//   Stats       - rating spread and what your taste is made of.
import { api, post } from '../api.js';
import { toggleSave, store } from '../main.js';
import { $, $$, esc, icon, toast, wl } from '../ui.js';

const TABS = [['rate', 'Rate'], ['duel', 'This or that'], ['board', 'Your board'], ['stats', 'Stats']];

export default async function taste(el, params = {}) {
  let tab = (location.hash.split('?')[1] || '').replace('tab=', '') || 'rate';
  el.innerHTML = `<div class="page lab">
    <header class="lab-h"><div><h1>Taste Lab</h1><p>Every answer teaches your picks what you like. A minute here is worth hours of browsing.</p></div>
      <div class="lab-score" id="labScore"></div></header>
    <nav class="lab-tabs">${TABS.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}<i class="lab-ind"></i></nav>
    <section class="lab-body" id="labBody"></section></div>`;
  const body = $('#labBody', el);
  let cleanup = () => {};
  const session = { rated: 0, duels: 0 };
  const score = () => { const s = $('#labScore', el); if (s) s.innerHTML = session.rated + session.duels ? `<b>${session.rated + session.duels}</b><span>answers this session</span>` : ''; };

  function setTab(t) {
    tab = t; cleanup(); cleanup = () => {};
    $$('.lab-tabs button', el).forEach((b, i) => { b.classList.toggle('on', b.dataset.tab === t); if (b.dataset.tab === t) { const ind = $('.lab-ind', el); ind.style.width = `${b.offsetWidth}px`; ind.style.transform = `translateX(${b.offsetLeft}px)`; } });
    ({ rate: rateTab, duel: duelTab, board: boardTab, stats: statsTab })[t]();
  }
  $$('.lab-tabs button', el).forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

  // ---------- Rate: swipeable stack ----------
  async function rateTab() {
    body.innerHTML = '<div class="lab-stack"><div class="lab-card sk"></div></div>';
    let deck = [], seed = Math.floor(Math.random() * 1000), busy = false;
    const more = async () => { const d = await api(`/api/lab/deck?n=20&seed=${seed++}`).catch(() => []); const have = new Set(deck.map((c) => c.imdbId)); deck.push(...d.filter((c) => !have.has(c.imdbId))); };
    await more();
    if (tab !== 'rate') return;
    const cardHTML = (c, depth) => `<article class="lab-card" data-id="${esc(c.imdbId)}" style="--d:${depth}">
      <div class="lab-art" style="background-image:url('${esc(c.poster)}')"></div>
      <div class="lab-info"><small>${esc(c.why || '')}</small><h2>${esc(c.title)}</h2><div class="lab-meta">${esc([c.year, c.type === 'series' ? 'Series' : 'Film', ...(c.genres || [])].filter(Boolean).join(' · '))}</div>${c.overview ? `<p>${esc(c.overview)}</p>` : ''}</div>
      <span class="lab-stamp like">Liked</span><span class="lab-stamp nope">Not for me</span><span class="lab-stamp want">Want to watch</span><span class="lab-stamp skip">Haven't seen</span></article>`;
    function draw() {
      if (!deck.length) { body.innerHTML = `<div class="lab-empty"><h3>That's everything for now</h3><p>Your picks have learned from all of it. Come back after watching a few more.</p><a class="btn primary" href="#/">See your picks</a></div>`; return; }
      body.innerHTML = `<div class="lab-rate"><div class="lab-stack">${deck.slice(0, 3).map((c, i) => cardHTML(c, i)).reverse().join('')}</div>
        <div class="lab-ctl">
          <div class="lab-stars" role="group" aria-label="Rate it">${[1, 2, 3, 4, 5].map((n) => `<button data-star="${n}" aria-label="${n} stars"><span>${icon('star')}</span><em>${['', 'Bad', 'Meh', 'Good', 'Great', 'Loved it'][n]}</em></button>`).join('')}</div>
          <div class="lab-acts"><button data-act="skip">${icon('eye')}<span>Haven't seen</span><kbd>S</kbd></button><button data-act="nope">${icon('x')}<span>Not for me</span><kbd>X</kbd></button><button data-act="want">${icon('bookmark')}<span>Want to watch</span><kbd>W</kbd></button></div>
          <p class="lab-hint">Swipe the card: → liked · ← not for me · ↑ want to watch · ↓ haven't seen. Or press 1–5.</p></div></div>`;
      bindTop();
      $$('[data-star]', body).forEach((b) => (b.onclick = () => act('star', +b.dataset.star)));
      $$('[data-act]', body).forEach((b) => (b.onclick = () => act(b.dataset.act)));
    }
    async function act(kind, stars = 0) {
      if (busy || !deck.length) return; busy = true;
      const c = deck[0], topEl = $('.lab-card:not(.sk)[style*="--d:0"]', body);
      const dir = kind === 'star' ? (stars >= 3 ? 'r' : 'l') : { skip: 'd', nope: 'l', want: 'u' }[kind];
      topEl?.classList.add('out', `out-${dir}`, kind === 'star' ? (stars >= 3 ? 's-like' : 's-nope') : `s-${kind}`);
      const req = kind === 'star' ? post('/api/rate', { imdbId: c.imdbId, title: c.title, type: c.type, rating: stars })
        : kind === 'skip' ? post('/api/lab/skip', { imdbId: c.imdbId })
        : kind === 'nope' ? post('/api/notinterested', { imdbId: c.imdbId, title: c.title })
        : (wl.has(c.imdbId) ? Promise.resolve() : toggleSave({ imdbId: c.imdbId, type: c.type, title: c.title, year: c.year, poster: c.poster })).then(() => post('/api/lab/skip', { imdbId: c.imdbId }));
      req.catch((e) => toast(e.message, 'err'));
      if (kind !== 'skip') { session.rated++; score(); }
      await new Promise((r) => setTimeout(r, 260));
      deck.shift(); busy = false; draw();
      if (deck.length < 6) more().then(() => { if (tab === 'rate' && deck.length && !$('.lab-card', body)) draw(); });
    }
    // drag to swipe (pointer), with live tilt and stamps
    function bindTop() {
      const c = $('.lab-card[style*="--d:0"]', body); if (!c) return;
      let x0 = 0, y0 = 0, dx = 0, dy = 0, drag = false;
      c.onpointerdown = (e) => { if (e.button) return; drag = true; x0 = e.clientX; y0 = e.clientY; c.setPointerCapture(e.pointerId); c.classList.add('drag'); };
      c.onpointermove = (e) => {
        if (!drag) return; dx = e.clientX - x0; dy = e.clientY - y0;
        c.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 18}deg)`;
        const h = Math.abs(dx) > Math.abs(dy);
        c.style.setProperty('--like', h && dx > 0 ? Math.min(1, dx / 120) : 0); c.style.setProperty('--nope', h && dx < 0 ? Math.min(1, -dx / 120) : 0);
        c.style.setProperty('--want', !h && dy < 0 ? Math.min(1, -dy / 120) : 0); c.style.setProperty('--skip', !h && dy > 0 ? Math.min(1, dy / 120) : 0);
      };
      c.onpointerup = () => {
        if (!drag) return; drag = false; c.classList.remove('drag');
        const T = 110;
        if (dx > T && Math.abs(dx) > Math.abs(dy)) return act('star', 4);
        if (dx < -T && Math.abs(dx) > Math.abs(dy)) return act('nope');
        if (dy < -T) return act('want');
        if (dy > T) return act('skip');
        c.style.transform = ''; ['--like', '--nope', '--want', '--skip'].forEach((p) => c.style.setProperty(p, 0)); dx = dy = 0;
      };
    }
    const key = (e) => {
      if (tab !== 'rate' || e.target.closest('input, textarea') || e.metaKey || e.ctrlKey) return;
      if (/^[1-5]$/.test(e.key)) act('star', +e.key);
      else if (e.key === 's' || e.key === 'ArrowDown') act('skip');
      else if (e.key === 'x' || e.key === 'ArrowLeft') act('nope');
      else if (e.key === 'ArrowRight') act('star', 4);
      else if (e.key === 'w' || e.key === 'ArrowUp') act('want');
      else return;
      e.preventDefault();
    };
    document.addEventListener('keydown', key);
    cleanup = () => document.removeEventListener('keydown', key);
    draw();
  }

  // ---------- This or that ----------
  async function duelTab() {
    body.innerHTML = '<div class="lab-duel"><div class="lab-dc sk"></div><div class="lab-vs">or</div><div class="lab-dc sk"></div></div>';
    let cur = null, busy = false;
    async function next() {
      cur = await api('/api/lab/pair').catch((e) => ({ error: e.message }));
      if (tab !== 'duel') return;
      if (cur.error) { body.innerHTML = `<div class="lab-empty"><h3>Not enough yet</h3><p>${esc(cur.error)}. Rate a few titles in the Rate tab, then come back.</p></div>`; return; }
      const side = (c, k) => `<button class="lab-dc" data-pick="${k}"><i style="background-image:url('${esc(c.poster)}')"></i><div><b>${esc(c.title)}</b><small>${esc([c.year, c.type === 'series' ? 'Series' : 'Film'].filter(Boolean).join(' · '))}${c.stars ? ` · ${'★'.repeat(c.stars)}` : ''}</small></div><kbd>${k === 'a' ? '←' : '→'}</kbd></button>`;
      body.innerHTML = `<div class="lab-q">Which did you enjoy more?</div><div class="lab-duel">${side(cur.a, 'a')}<div class="lab-vs">or</div>${side(cur.b, 'b')}</div>
        <div class="lab-dacts"><button data-tie>Can't decide <kbd>space</kbd></button><button data-skipd>Haven't seen one <kbd>S</kbd></button><span>${cur.duels} picks so far</span></div>`;
      $$('[data-pick]', body).forEach((b) => (b.onclick = () => pick(b.dataset.pick)));
      $('[data-tie]', body).onclick = () => pick('tie'); $('[data-skipd]', body).onclick = () => next();
    }
    async function pick(k) {
      if (busy || !cur?.a) return; busy = true;
      const w = k === 'b' ? cur.b : cur.a, l = k === 'b' ? cur.a : cur.b;
      if (k !== 'tie') $(`[data-pick="${k}"]`, body)?.classList.add('won'), $(`[data-pick="${k === 'a' ? 'b' : 'a'}"]`, body)?.classList.add('lost');
      await post('/api/lab/duel', { winner: w.imdbId, loser: l.imdbId, tie: k === 'tie' }).catch((e) => toast(e.message, 'err'));
      session.duels++; score();
      await new Promise((r) => setTimeout(r, 280)); busy = false; next();
    }
    const key = (e) => { if (tab !== 'duel' || e.metaKey || e.ctrlKey) return; if (e.key === 'ArrowLeft') pick('a'); else if (e.key === 'ArrowRight') pick('b'); else if (e.key === ' ') pick('tie'); else if (e.key === 's') next(); else return; e.preventDefault(); };
    document.addEventListener('keydown', key); cleanup = () => document.removeEventListener('keydown', key);
    next();
  }

  // ---------- Board ----------
  async function boardTab() {
    body.innerHTML = '<div class="lab-board">' + '<div class="lab-bi sk"></div>'.repeat(10) + '</div>';
    const b = await api('/api/lab/board').catch(() => ({ titles: [] }));
    if (tab !== 'board') return;
    if (!b.titles.length) { body.innerHTML = '<div class="lab-empty"><h3>Your board is empty</h3><p>Rate titles 3★ or more, or pick favourites in This or that.</p></div>'; return; }
    body.innerHTML = `<p class="lab-sub">Ranked by your stars, then by your This-or-that picks. ${b.duels < 10 ? 'A few rounds of This or that sharpen the order.' : ''}</p>
      <div class="lab-podium">${b.titles.slice(0, 3).map((t, i) => `<a class="lab-pod p${i + 1}" href="#/title/${t.type}/${t.imdbId}"><i style="background-image:url('${esc(t.poster)}')"></i><span class="lab-rank">${i + 1}</span><b>${esc(t.title)}</b><small>${t.stars ? '★'.repeat(t.stars) : 'Watched'}</small></a>`).join('')}</div>
      <div class="lab-board">${b.titles.slice(3).map((t, i) => `<a class="lab-bi" href="#/title/${t.type}/${t.imdbId}"><span class="lab-rank">${i + 4}</span><i style="background-image:url('${esc(t.poster)}')"></i><div><b>${esc(t.title)}</b><small>${esc([t.year, t.stars ? '★'.repeat(t.stars) : 'Watched'].filter(Boolean).join(' · '))}</small></div></a>`).join('')}</div>`;
  }

  // ---------- Stats ----------
  async function statsTab() {
    body.innerHTML = '<div class="lab-stats"><div class="lab-sc sk"></div><div class="lab-sc sk"></div></div>';
    const [b, t] = await Promise.all([api('/api/lab/board').catch(() => ({ dist: [0, 0, 0, 0, 0] })), api('/api/taste').catch(() => ({}))]);
    if (tab !== 'stats') return;
    const max = Math.max(1, ...b.dist);
    const gmax = Math.max(0.01, ...(t.genres || []).map((g) => g.score));
    body.innerHTML = `<div class="lab-stats">
      <div class="lab-sc"><h4>How much your picks know</h4><div class="lab-big">${t.strength ?? 0}%</div><div class="lab-meter"><u style="width:${t.strength ?? 0}%"></u></div>
        <ul class="lab-kv"><li><span>Titles watched</span><b>${t.watched ?? 0}</b></li><li><span>Rated</span><b>${b.rated ?? 0}</b></li><li><span>This-or-that picks</span><b>${b.duels ?? 0}</b></li><li><span>Marked haven't seen</span><b>${b.skipped ?? 0}</b></li><li><span>Leaning</span><b>${esc(t.leaning === 'both' ? 'Films & series' : t.leaning || '–')}</b></li></ul></div>
      <div class="lab-sc"><h4>Your ratings</h4><div class="lab-hist">${b.dist.map((v, i) => `<div><i style="height:${Math.round((v / max) * 100)}%"></i><b>${v}</b><span>${i + 1}★</span></div>`).join('')}</div>
        <p class="lab-sub">${b.rated ? `Average ${t.avgRating ?? '–'}★. ${b.dist[4] / Math.max(1, b.rated) > 0.6 ? 'You rate generously: pick favourites in This or that to tell them apart.' : 'A nicely spread scale: that gives your picks plenty to learn from.'}` : 'Rate a few titles to see your scale.'}</p></div>
      <div class="lab-sc wide"><h4>Genres you love</h4>${(t.genres || []).map((g) => `<div class="lab-bar"><span>${esc(g.name)}</span><i><u style="width:${Math.round((g.score / gmax) * 100)}%"></u></i></div>`).join('') || '<p class="lab-sub">Not enough yet.</p>'}</div>
      <div class="lab-sc wide"><h4>Themes</h4><div class="lab-chips">${(t.themes || []).map((x) => `<span>${esc(x.name)}</span>`).join('')}</div><h4 style="margin-top:18px">People</h4><div class="lab-chips">${(t.people || []).map((x) => `<span>${esc(x.name)}</span>`).join('')}</div></div>
    </div>`;
  }

  setTab(TABS.some(([k]) => k === tab) ? tab : 'rate');
  window.addEventListener('hashchange', () => cleanup(), { once: true });
}
