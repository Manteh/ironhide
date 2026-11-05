// Player UI for the IronHide Mac app. The native side plays the video with libmpv underneath this page and pushes
// mpv's state to window.__ihp.state(); this module draws the controls and sends commands back through Tauri.
(() => {
  const inv = window.__TAURI_INTERNALS__?.invoke;
  if (!inv || window.__ihp) return;
  const call = (c, a = {}) => inv(c, a).catch(() => {});
  const cmd = (...a) => call('player_cmd', { args: a.map(String) });
  const set = (name, value) => call('player_set', { name, value: String(value) });

  const I = {
    play: '<svg viewBox="0 0 24 24"><path class="f" d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><rect class="f" x="6" y="5" width="4.2" height="14" rx="1.4"/><rect class="f" x="13.8" y="5" width="4.2" height="14" rx="1.4"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
    b10: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5V8h3.5"/></svg>',
    f10: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V8h-3.5"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a8 8 0 0 1 0 11"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
    subs: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 12h3M13 12h4M7 15.5h6M16 15.5h1"/></svg>',
    audio: '<svg viewBox="0 0 24 24"><path d="M4 12h.01M8 8v8M12 5v14M16 8v8M20 11v2"/></svg>',
    pic: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9M4 12h3M11 12h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/><circle cx="9" cy="12" r="0"/></svg>',
    fs: '<svg viewBox="0 0 24 24"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/></svg>',
    cog: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
    snap: '<svg viewBox="0 0 24 24"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.2-1.8h6.2L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12.5" r="3.2"/></svg>',
  };

  const S = {};           // last state from mpv (strings)
  const n = (k, d = 0) => { const v = parseFloat(S[k]); return Number.isFinite(v) ? v : d; };
  const b = (k) => S[k] === 'yes' || S[k] === true;
  const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

  const PICTURE = [['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturation', 'Saturation'], ['gamma', 'Gamma'], ['hue', 'Hue']];
  const PRESETS = {
    Default: { brightness: 0, contrast: 0, saturation: 0, gamma: 0, hue: 0 },
    Vivid: { brightness: 2, contrast: 10, saturation: 22, gamma: 0, hue: 0 },
    Cinema: { brightness: -4, contrast: 12, saturation: -6, gamma: -6, hue: 0 },
    'Dark room': { brightness: -8, contrast: -4, saturation: 0, gamma: 14, hue: 0 },
    'Bright room': { brightness: 8, contrast: 6, saturation: 6, gamma: 10, hue: 0 },
    Warm: { brightness: 0, contrast: 4, saturation: 8, gamma: 0, hue: -4 },
  };
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const ASPECTS = [['Auto', '-1', 0], ['16:9', '16:9', 0], ['4:3', '4:3', 0], ['2.35:1', '2.35:1', 0], ['Fill', '-1', 1]];
  const TONE = ['auto', 'bt.2390', 'hable', 'mobius', 'reinhard'];

  const root = document.createElement('div');
  root.id = 'ihp'; root.hidden = true;
  const slider = (id, label, min, max, step) => `<div class="sl" data-id="${id}"><label title="Double-click to reset">${label}<output></output></label><input type="range" min="${min}" max="${max}" step="${step}" value="0"></div>`;
  root.innerHTML = `
    <div class="ihp-hit"></div><div class="ihp-shade t"></div><div class="ihp-shade b"></div>
    <div class="ihp-top"><button class="ihp-ib back" data-a="close" title="Close (Esc)">${I.back}</button><div class="ihp-title"></div><div class="ihp-info"></div></div>
    <div class="ihp-center"><div class="ihp-pulse"></div><div class="ihp-spin"></div></div>
    <div class="ihp-toast"></div>
    <div class="ihp-bar">
      <div class="ihp-scrub"><span class="t cur">0:00</span><div class="trk"><i class="buf"></i><i class="fill"></i><b class="knob"></b><em class="tip"></em></div><span class="t rem">0:00</span></div>
      <div class="ihp-row">
        <div class="g"><button class="ihp-ib main" data-a="toggle" title="Play / pause (Space)"></button>
          <button class="ihp-ib sm" data-a="back10" title="Back 10 s (←)">${I.b10}</button><button class="ihp-ib sm" data-a="fwd10" title="Forward 10 s (→)">${I.f10}</button>
          <div class="ihp-vol"><button class="ihp-ib sm" data-a="mute" title="Mute (M)"></button><input type="range" min="0" max="150" step="1" data-vol></div></div>
        <div class="g"><button class="ihp-sp" data-a="speed" title="Speed ([ and ])">1×</button>
          <button class="ihp-ib sm" data-a="tab:subs" title="Subtitles (C)">${I.subs}</button><button class="ihp-ib sm" data-a="tab:audio" title="Audio (A)">${I.audio}</button>
          <button class="ihp-ib sm" data-a="tab:pic" title="Picture (P)">${I.pic}</button><button class="ihp-ib sm" data-a="tab:play" title="More">${I.cog}</button>
          <button class="ihp-ib sm" data-a="fs" title="Full screen (F)">${I.fs}</button></div>
      </div>
    </div>
    <aside class="ihp-panel">
      <div class="ihp-tabs"><button data-tab="pic">Picture</button><button data-tab="audio">Audio</button><button data-tab="subs">Subtitles</button><button data-tab="play">Playback</button></div>
      <div class="ihp-pages">
        <div class="pg" data-pg="pic">
          <h4>Presets</h4><div class="chips" data-presets>${Object.keys(PRESETS).map((k) => `<button data-preset="${k}">${k}</button>`).join('')}</div>
          <h4>Adjust</h4>${PICTURE.map(([k, l]) => slider(k, l, -100, 100, 1)).join('')}
          <h4>Quality</h4>
          <div class="tg">Smooth motion<button data-tg="interp"></button></div><div class="tg">Remove banding<button data-tg="deband"></button></div>
          <h4>HDR tone mapping</h4><div class="chips" data-tone>${TONE.map((t) => `<button data-tone="${t}">${t}</button>`).join('')}</div>
          <button class="rst" data-a="resetpic">Reset picture</button>
        </div>
        <div class="pg" data-pg="audio"><h4>Track</h4><div data-list="audio"></div><h4>Sync</h4>${slider('audio-delay', 'Audio delay', -2, 2, 0.05)}</div>
        <div class="pg" data-pg="subs"><h4>Track</h4><div data-list="sub"></div><h4>Look</h4>${slider('sub-delay', 'Delay', -5, 5, 0.1)}${slider('sub-scale', 'Size', 0.5, 2.5, 0.05)}${slider('sub-pos', 'Position', 0, 100, 1)}</div>
        <div class="pg" data-pg="play">
          <h4>Speed</h4><div class="chips" data-speeds>${SPEEDS.map((s) => `<button data-speed="${s}">${s}×</button>`).join('')}</div>
          <h4>Aspect ratio</h4><div class="chips" data-aspects>${ASPECTS.map((a, i) => `<button data-aspect="${i}">${a[0]}</button>`).join('')}</div>
          <h4>Chapters</h4><div data-list="chap"></div>
          <h4>Tools</h4><div class="chips"><button data-a="shot">Save screenshot</button></div>
        </div>
      </div>
    </aside>`;
  const q = (s, r = root) => r.querySelector(s);
  const qa = (s, r = root) => [...r.querySelectorAll(s)];
  const fillRange = (el) => { const mn = +el.min, mx = +el.max; el.style.setProperty('--p', ((+el.value - mn) / (mx - mn) * 100) + '%'); };

  // ---------- feedback ----------
  let toastT = 0;
  function toast(t) { const el = q('.ihp-toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 1100); }
  function pulse(icon) { const el = q('.ihp-pulse'); el.innerHTML = icon; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); }

  // ---------- idle hide ----------
  let idleT = 0;
  function wake() { root.classList.add('ui'); clearTimeout(idleT); idleT = setTimeout(() => { if (!root.classList.contains('pn') && !dragging) root.classList.remove('ui'); }, 2800); }

  // ---------- state -> UI ----------
  let dragging = false, dragT = 0, lastPos = 0, lastAt = 0, lastTracks = '', playing = false;
  function paintStatic() {
    const paused = b('pause');
    q('[data-a=toggle]').innerHTML = paused ? I.play : I.pause;
    q('[data-a=mute]').innerHTML = b('mute') || n('volume') === 0 ? I.mute : I.vol;
    q('.ihp-title').textContent = S['media-title'] || '';
    root.classList.toggle('paused', paused);
    root.classList.toggle('buf', b('paused-for-cache'));
    const info = [];
    if (n('width')) info.push(n('height') >= 2000 ? '4K' : n('height') + 'p');
    if (S['hwdec-current'] && S['hwdec-current'] !== 'no') info.push('Hardware');
    q('.ihp-info').innerHTML = info.map((t) => `<span class="ihp-chip">${t}</span>`).join('');
    const vol = q('[data-vol]'); if (document.activeElement !== vol) { vol.value = n('volume', 100); fillRange(vol); }
    q('[data-a=speed]').textContent = (+n('speed', 1).toFixed(2)) + '×';
    for (const row of qa('.sl')) {
      const id = row.dataset.id, inp = q('input', row);
      if (document.activeElement !== inp && S[id] !== undefined) { inp.value = n(id); fillRange(inp); }
      q('output', row).textContent = valueText(id, n(id));
    }
    for (const x of qa('[data-speed]')) x.classList.toggle('on', Math.abs(+x.dataset.speed - n('speed', 1)) < 0.01);
    const pan = n('panscan'), asp = S['video-aspect-override'] || '-1';
    qa('[data-aspect]').forEach((x, i) => { const [, v, p] = ASPECTS[i]; x.classList.toggle('on', p ? pan > 0.5 : (!(pan > 0.5) && (v === asp || (v === '-1' && (asp === '-1' || asp === '-1.000000'))))); });
    qa('[data-tone]').forEach((x) => x.classList.toggle('on', x.dataset.tone === (S['tone-mapping'] || 'auto')));
    q('[data-tg=deband]').classList.toggle('on', b('deband'));
    q('[data-tg=interp]').classList.toggle('on', b('interpolation'));
  }
  function valueText(id, v) {
    if (id.endsWith('delay')) return (v > 0 ? '+' : '') + v.toFixed(2) + ' s';
    if (id === 'sub-scale') return Math.round(v * 100) + '%';
    if (id === 'sub-pos') return Math.round(v) + '';
    return (v > 0 ? '+' : '') + Math.round(v);
  }
  const trackLabel = (t, i) => [t.title, t.lang && t.lang.toUpperCase(), t.codec && t.codec.toUpperCase(), t['demux-channel-count'] > 2 ? t['demux-channel-count'] + ' ch' : ''].filter(Boolean).join(' · ') || ('Track ' + (i + 1));
  function paintTracks(list, chapters) {
    const key = JSON.stringify([list, chapters, S.sid, S.aid]);
    if (key === lastTracks) return; lastTracks = key;
    const mk = (type, prop, withOff) => {
      const items = list.filter((t) => t.type === type);
      const cur = S[prop]; let h = '';
      if (withOff) h += `<button class="tr ${cur === 'no' || cur === undefined ? 'on' : ''}" data-set="${prop}" data-v="no">Off</button>`;
      h += items.map((t, i) => `<button class="tr ${String(t.id) === String(cur) ? 'on' : ''}" data-set="${prop}" data-v="${t.id}">${trackLabel(t, i)}</button>`).join('');
      return h || '<div class="empty">None in this file</div>';
    };
    q('[data-list=audio]').innerHTML = mk('audio', 'aid', false);
    q('[data-list=sub]').innerHTML = mk('sub', 'sid', true);
    q('[data-list=chap]').innerHTML = (chapters || []).length ? chapters.map((c, i) => `<button class="tr" data-chap="${c.time}">${c.title || 'Chapter ' + (i + 1)}<small>${fmt(c.time)}</small></button>`).join('') : '<div class="empty">No chapters</div>';
    const trk = q('.trk'); qa('.ch', trk).forEach((e) => e.remove());
    const dur = n('duration');
    if (dur > 0) for (const c of chapters || []) if (c.time > 1) { const e = document.createElement('div'); e.className = 'ch'; e.style.left = (c.time / dur * 100) + '%'; trk.append(e); }
  }

  function paintTime(pos) {
    const dur = n('duration'), r = dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : 0;
    q('.fill').style.transform = `scaleX(${r})`;
    q('.knob').style.left = (r * 100) + '%';
    q('.t.cur').textContent = fmt(pos);
    q('.t.rem').textContent = '-' + fmt(Math.max(0, dur - pos));
  }
  function frame() {
    if (!playing) return;
    if (!dragging) {
      let pos = n('time-pos');
      if (!b('pause') && !b('paused-for-cache')) pos = lastPos + (performance.now() - lastAt) / 1000 * n('speed', 1);
      paintTime(pos);
    }
    requestAnimationFrame(frame);
  }

  // ---------- controls ----------
  const seekTo = (t) => cmd('seek', Math.max(0, t), 'absolute');
  const rel = (s) => { cmd('seek', s, 'relative'); toast((s > 0 ? '+' : '') + s + ' s'); };
  const setVol = (v) => { v = Math.max(0, Math.min(150, v)); set('volume', v); S.volume = v; toast('Volume ' + Math.round(v) + '%'); paintStatic(); };
  const setSpeed = (s) => { s = Math.max(0.25, Math.min(3, s)); set('speed', s); S.speed = s; toast('Speed ' + (+s.toFixed(2)) + '×'); paintStatic(); };
  function applyPicture(vals) { for (const [k, v] of Object.entries(vals)) { set(k, v); S[k] = v; } savePicture(); paintStatic(); }
  const savePicture = () => { try { localStorage.setItem('ihp.pic', JSON.stringify(Object.fromEntries(PICTURE.map(([k]) => [k, n(k)])))); } catch {} };
  function tab(name) { root.classList.add('pn'); wake(); qa('[data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === name)); qa('.pg').forEach((x) => x.classList.toggle('on', x.dataset.pg === name)); }
  const panelOpen = () => root.classList.contains('pn');
  function closePanel() { root.classList.remove('pn'); wake(); }
  let lastClick = 0;

  const actions = {
    close: () => call('player_close'),
    toggle: () => { cmd('cycle', 'pause'); pulse(b('pause') ? I.play : I.pause); },
    back10: () => rel(-10), fwd10: () => rel(10),
    mute: () => { cmd('cycle', 'mute'); toast(b('mute') ? 'Sound on' : 'Muted'); },
    fs: () => call('player_fullscreen'),
    speed: () => { const i = SPEEDS.findIndex((s) => Math.abs(s - n('speed', 1)) < 0.01); setSpeed(SPEEDS[(i + 1) % SPEEDS.length]); },
    resetpic: () => { applyPicture(PRESETS.Default); toast('Picture reset'); },
    shot: () => { cmd('screenshot', 'window'); toast('Screenshot saved to Pictures'); },
  };

  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (a) { const [k, v] = a.dataset.a.split(':'); if (k === 'tab') { panelOpen() && q(`[data-tab=${v}]`).classList.contains('on') ? closePanel() : tab(v); } else actions[k]?.(); return; }
    const t = e.target.closest('[data-tab]'); if (t) return tab(t.dataset.tab);
    const p = e.target.closest('[data-preset]'); if (p) { applyPicture(PRESETS[p.dataset.preset]); toast(p.dataset.preset); return; }
    const sp = e.target.closest('[data-speed]'); if (sp) return setSpeed(+sp.dataset.speed);
    const as = e.target.closest('[data-aspect]'); if (as) { const [name, v, pan] = ASPECTS[+as.dataset.aspect]; set('video-aspect-override', v); set('panscan', pan); S['video-aspect-override'] = v; S.panscan = pan; toast(name); paintStatic(); return; }
    const to = e.target.closest('[data-tone]'); if (to) { set('tone-mapping', to.dataset.tone); S['tone-mapping'] = to.dataset.tone; paintStatic(); return; }
    const tg = e.target.closest('[data-tg]'); if (tg) {
      if (tg.dataset.tg === 'deband') { const v = !b('deband'); set('deband', v ? 'yes' : 'no'); S.deband = v ? 'yes' : 'no'; }
      else { const v = !b('interpolation'); set('interpolation', v ? 'yes' : 'no'); if (v) set('video-sync', 'display-resample'); S.interpolation = v ? 'yes' : 'no'; }
      paintStatic(); return;
    }
    const st = e.target.closest('[data-set]'); if (st) { set(st.dataset.set, st.dataset.v); S[st.dataset.set] = st.dataset.v; lastTracks = ''; paintTracks(S['track-list'] || [], S['chapter-list'] || []); return; }
    const ch = e.target.closest('[data-chap]'); if (ch) return seekTo(+ch.dataset.chap);
    if (e.target.classList.contains('ihp-hit')) {
      if (panelOpen()) return closePanel();
      const now = performance.now();
      if (now - lastClick < 280) { lastClick = 0; actions.fs(); } else { lastClick = now; setTimeout(() => { if (lastClick && performance.now() - lastClick >= 270) { lastClick = 0; actions.toggle(); } }, 285); }
    }
  });
  // sliders
  root.addEventListener('input', (e) => {
    const el = e.target; if (el.type !== 'range') return;
    fillRange(el);
    if (el.hasAttribute('data-vol')) { set('volume', el.value); S.volume = el.value; q('[data-a=mute]').innerHTML = +el.value === 0 ? I.mute : I.vol; return; }
    const row = el.closest('.sl'); if (!row) return;
    const id = row.dataset.id; set(id, el.value); S[id] = el.value; q('output', row).textContent = valueText(id, +el.value);
    if (PICTURE.some(([k]) => k === id)) savePicture();
  });
  root.addEventListener('dblclick', (e) => { const l = e.target.closest('.sl label'); if (!l) return; const row = l.closest('.sl'), id = row.dataset.id, d = id === 'sub-scale' ? 1 : id === 'sub-pos' ? 100 : 0; set(id, d); S[id] = d; paintStatic(); if (PICTURE.some(([k]) => k === id)) savePicture(); });
  root.addEventListener('pointermove', wake);

  // scrubber
  const trk = q('.trk'), tip = q('.tip');
  const ratioAt = (e) => { const r = trk.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  trk.addEventListener('pointermove', (e) => { const r = ratioAt(e); tip.style.left = (r * 100) + '%'; tip.textContent = fmt(r * n('duration')); if (dragging) { dragT = r * n('duration'); paintTime(dragT); } });
  trk.addEventListener('pointerdown', (e) => { trk.setPointerCapture(e.pointerId); dragging = true; trk.classList.add('drag'); dragT = ratioAt(e) * n('duration'); paintTime(dragT); });
  trk.addEventListener('pointerup', () => { if (!dragging) return; dragging = false; trk.classList.remove('drag'); seekTo(dragT); lastPos = dragT; lastAt = performance.now(); });

  // keyboard
  document.addEventListener('keydown', (e) => {
    if (root.hidden || e.metaKey || e.ctrlKey) return;
    const k = e.key; let used = true;
    if (e.target.matches?.('input[type=range]') && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown')) e.target.blur();
    switch (k) {
      case ' ': case 'k': actions.toggle(); break;
      case 'ArrowLeft': rel(e.shiftKey ? -30 : -10); break;
      case 'ArrowRight': rel(e.shiftKey ? 30 : 10); break;
      case 'ArrowUp': setVol(n('volume', 100) + 5); break;
      case 'ArrowDown': setVol(n('volume', 100) - 5); break;
      case 'f': actions.fs(); break;
      case 'm': actions.mute(); break;
      case '[': setSpeed(n('speed', 1) - 0.25); break;
      case ']': setSpeed(n('speed', 1) + 0.25); break;
      case 'p': panelOpen() ? closePanel() : tab('pic'); break;
      case 'c': panelOpen() ? closePanel() : tab('subs'); break;
      case 'a': panelOpen() ? closePanel() : tab('audio'); break;
      case 'q': actions.close(); break;
      case 'Escape': panelOpen() ? closePanel() : (document.fullscreenElement || window.innerHeight === screen.height) ? actions.fs() : actions.close(); break;
      default: used = false;
    }
    if (used) { e.preventDefault(); e.stopPropagation(); wake(); }
  }, true);

  // ---------- called by the native side ----------
  window.__ihp = {
    open() {
      Object.keys(S).forEach((k) => delete S[k]); lastTracks = '';
      document.body.append(root); root.hidden = false; root.classList.remove('pn');
      document.documentElement.classList.add('ihp-on'); playing = true; wake(); requestAnimationFrame(frame);
      try { const p = JSON.parse(localStorage.getItem('ihp.pic') || 'null'); if (p) setTimeout(() => applyPicture(p), 500); } catch {}
      setTimeout(() => root.focus?.(), 0);
    },
    close() {
      playing = false; root.hidden = true; document.documentElement.classList.remove('ihp-on'); root.classList.remove('pn', 'ui');
    },
    state(s) {
      Object.assign(S, s); lastPos = n('time-pos'); lastAt = performance.now();
      if (S['track-list']) paintTracks(S['track-list'], S['chapter-list'] || []);
      q('.trk .buf').style.transform = `scaleX(${n('duration') > 0 ? Math.min(1, n('demuxer-cache-time') / n('duration')) : 0})`;
      paintStatic();
      if (!playing) return;
    },
  };
})();
