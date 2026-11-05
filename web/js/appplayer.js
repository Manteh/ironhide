// Player UI for the IronHide Mac app. The native side plays the video with libmpv underneath this page and pushes
// mpv's state to window.__ihp.state(); this module draws the controls and sends commands back through Tauri.
(() => {
  const inv = window.__TAURI_INTERNALS__?.invoke;
  if (!inv || window.__ihp) return;
  const call = (c, a = {}) => inv(c, a).catch((e) => { try { hud(I.info, 'Player error: ' + (e?.message || e)); } catch {} });
  const cmd = (...a) => call('player_cmd', { args: a.map(String) });
  const set = (name, value) => call('player_set', { name, value: String(value) });

  // ---------- icons (24px, rounded, one family) ----------
  const svg = (inner, extra = '') => `<svg viewBox="0 0 24 24" ${extra}>${inner}</svg>`;
  const I = {
    play: svg('<path class="f" d="M7.5 5.6v12.8c0 .8.9 1.3 1.6.9l10.2-6.4c.6-.4.6-1.4 0-1.8L9.1 4.7c-.7-.4-1.6.1-1.6.9Z"/>'),
    pause: svg('<rect class="f" x="6" y="4.8" width="4.1" height="14.4" rx="1.5"/><rect class="f" x="13.9" y="4.8" width="4.1" height="14.4" rx="1.5"/>'),
    back: svg('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
    b10: svg('<path d="M4.2 12.3a8 8 0 1 0 2.5-5.9"/><path d="M4 4.3v3.9h3.9"/><text x="12.2" y="15.1">10</text>'),
    f10: svg('<path d="M19.8 12.3a8 8 0 1 1-2.5-5.9"/><path d="M20 4.3v3.9h-3.9"/><text x="11.8" y="15.1">10</text>'),
    vol: svg('<path d="M4 9.6v4.8h3.4l4.3 3.6V6L7.4 9.6Z"/><path d="M15.2 9.2a4 4 0 0 1 0 5.6"/><path d="M17.9 6.6a7.6 7.6 0 0 1 0 10.8"/>'),
    vol1: svg('<path d="M4 9.6v4.8h3.4l4.3 3.6V6L7.4 9.6Z"/><path d="M15.2 9.2a4 4 0 0 1 0 5.6"/>'),
    mute: svg('<path d="M4 9.6v4.8h3.4l4.3 3.6V6L7.4 9.6Z"/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>'),
    subs: svg('<rect x="3" y="5.2" width="18" height="13.6" rx="3.4"/><path d="M6.8 11.2h3.2M12.6 11.2h4.6M6.8 14.6h5.4M14.8 14.6h2.4"/>'),
    audio: svg('<path d="M4 10v4M8 6.5v11M12 3.5v17M16 7.5v9M20 10.2v3.6"/>'),
    pic: svg('<circle cx="12" cy="12" r="8.4"/><path class="f" d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z"/>'),
    gauge: svg('<path d="M4.6 17.4a8.4 8.4 0 1 1 14.8 0"/><path d="m12 13 4-4.6"/><circle class="f" cx="12" cy="13.2" r="1.3"/>'),
    info: svg('<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2"/><circle class="f" cx="12" cy="7.9" r=".6"/>'),
    enter: svg('<path d="M4.5 9.5V6a1.5 1.5 0 0 1 1.5-1.5h3.5M14.5 4.5H18A1.5 1.5 0 0 1 19.5 6v3.5M19.5 14.5V18a1.5 1.5 0 0 1-1.5 1.5h-3.5M9.5 19.5H6A1.5 1.5 0 0 1 4.5 18v-3.5"/>'),
    exit: svg('<path d="M9.5 4.5V8a1.5 1.5 0 0 1-1.5 1.5H4.5M19.5 9.5H16A1.5 1.5 0 0 1 14.5 8V4.5M14.5 19.5V16a1.5 1.5 0 0 1 1.5-1.5h3.5M4.5 14.5H8A1.5 1.5 0 0 1 9.5 16v3.5"/>'),
    check: svg('<path d="m5 12.8 4.4 4.4L19 7.4"/>'),
    sun: svg('<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>'),
    drop: svg('<path d="M12 3.6c3.6 4.2 5.6 7 5.6 9.6a5.6 5.6 0 0 1-11.2 0c0-2.6 2-5.4 5.6-9.6Z"/>'),
    gamma: svg('<path d="M3.5 19.5C8 19.5 9.5 12 12 4.5M12 4.5c1.2 5 3 8.2 8.5 10.5" opacity="0"/><path d="M4 18c5-1 8.5-5 16-12"/><path d="M4 18C9 18 16 15 20 6" opacity="0"/>'),
    hue: svg('<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="3.4"/><path d="M12 3.6v5M12 15.4v5" opacity=".0"/>'),
    list: svg('<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20"/><circle class="f" cx="4.4" cy="6.5" r="1.1"/><circle class="f" cx="4.4" cy="12" r="1.1"/><circle class="f" cx="4.4" cy="17.5" r="1.1"/>'),
    pip: svg('<rect x="3.4" y="5.2" width="17.2" height="13.6" rx="3"/><rect class="f" x="11.6" y="11.2" width="6.6" height="4.6" rx="1.3"/>'),
    snap: svg('<path d="M4 8.7A2.7 2.7 0 0 1 6.7 6h1.1l1.2-1.9h6l1.2 1.9h1.1A2.7 2.7 0 0 1 20 8.7v7.6a2.7 2.7 0 0 1-2.7 2.7H6.7A2.7 2.7 0 0 1 4 16.3Z"/><circle cx="12" cy="12.4" r="3.3"/>'),
    star: svg('<path class="f" d="m12 3.8 2.5 5.3 5.8.7-4.3 4 1.1 5.7-5.1-2.9-5.1 2.9 1.1-5.7-4.3-4 5.8-.7Z"/>'),
    reddit: svg('<circle cx="12" cy="13.6" r="6.4"/><circle class="f" cx="9.6" cy="13" r=".9"/><circle class="f" cx="14.4" cy="13" r=".9"/><path d="M9.6 16c1.4 1 3.4 1 4.8 0M12 7.2l1.2-3.2 3.2.8"/>'),
  };

  const S = {};
  const n = (k, d = 0) => { const v = parseFloat(S[k]); return Number.isFinite(v) ? v : d; };
  const b = (k) => S[k] === 'yes' || S[k] === true;
  const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const PICTURE = [
    ['brightness', 'Brightness', 'sun', 'linear-gradient(90deg,#15151a,#f4f4f6)'],
    ['contrast', 'Contrast', 'pic', 'linear-gradient(90deg,#777,#777 40%,#111 40%,#111 60%,#eee 60%,#eee)'],
    ['saturation', 'Saturation', 'drop', 'linear-gradient(90deg,#8d8d94,#ff5d73,#ffb84a,#4fdc9a,#4aa8ff,#a86bff)'],
    ['gamma', 'Gamma', 'gamma', 'linear-gradient(90deg,#08080b,#9a9aa6 70%,#fff)'],
    ['hue', 'Hue', 'hue', 'linear-gradient(90deg,#ff5d5d,#ffd24a,#5ddc7d,#4ac8ff,#8a6bff,#ff5dc8,#ff5d5d)'],
  ];
  // your Nitrate presets (from ~/.config/mpv/scripts/nitrate_presets.lua)
  const PRESETS = {
    'Vibrant Anime': [{ brightness: -5, contrast: 24, saturation: 26, gamma: -3, hue: 0 }, 'linear-gradient(135deg,#ff5d73,#ffb84a 45%,#4aa8ff)'],
    'Shadow Lift': [{ brightness: 0, contrast: 22, saturation: 22, gamma: 5, hue: 0 }, 'linear-gradient(135deg,#0b0b12,#3a4a6c 55%,#d9b27a)'],
    'Cinephile Pop': [{ brightness: -2, contrast: 14, saturation: 12, gamma: -1, hue: 0 }, 'linear-gradient(135deg,#0d2230,#3a5a6c 55%,#c98a52)'],
    Neutral: [{ brightness: 0, contrast: 0, saturation: 0, gamma: 0, hue: 0 }, 'linear-gradient(135deg,#2d2d36,#4a4a56)'],
  };
  // render quality: the same options mpv's own `fast` and `high-quality` profiles set (from mpv's builtin.conf), plus your mpv.conf as "Balanced"
  const RENDER = {
    Performance: [{ scale: 'bilinear', cscale: 'bilinear', dscale: 'bilinear', 'correct-downscaling': 'no', 'linear-downscaling': 'no', 'sigmoid-upscaling': 'no', dither: 'no', 'hdr-compute-peak': 'no' }, 'bilinear', 'mpv “fast”: cheapest scaling, no dithering. For battery or a busy Mac.'],
    Balanced: [{ scale: 'spline36', cscale: 'spline36', dscale: 'hermite', 'correct-downscaling': 'yes', 'linear-downscaling': 'yes', 'sigmoid-upscaling': 'yes', dither: 'fruit', 'hdr-compute-peak': 'auto' }, 'spline36', 'Your mpv.conf: spline36 scaling, correct downscaling, 10-bit dithering.'],
    'High quality': [{ scale: 'ewa_lanczossharp', 'scale-antiring': '0.6', cscale: 'ewa_lanczossharp', dscale: 'hermite', 'correct-downscaling': 'yes', 'linear-downscaling': 'yes', 'sigmoid-upscaling': 'yes', dither: 'fruit', 'hdr-compute-peak': 'yes' }, 'ewa_lanczossharp', 'mpv “high-quality”: ewa_lanczossharp with anti-ringing. The sharpest scaling; heavier on the GPU.'],
  };
  // shader pipelines (files live in ~/.config/mpv/shaders). Hooks only run when they apply, e.g. upscalers when the picture is enlarged.
  const SH = (...f) => f.map((x) => '~/.config/mpv/shaders/' + x + '.glsl').join(':');
  const SHADERS = {
    Off: ['', {}, 'No extra shaders.'],
    Anime: [SH('Anime4K_Clamp_Highlights', 'Anime4K_Restore_CNN_M', 'Anime4K_Upscale_CNN_x2_M', 'Anime4K_AutoDownscalePre_x2', 'Anime4K_AutoDownscalePre_x4'), {}, 'Anime4K: restores line art, then upscales with a neural network. For anime and cartoons.'],
    'Live action': [SH('KrigBilateral', 'FSRCNNX_x2_8-0-4-1', 'SSimSuperRes'), {}, 'KrigBilateral chroma + FSRCNNX neural upscaling + SSimSuperRes. Sharpens lower-resolution films on a bigger screen.'],
    'Sharp downscale': [SH('KrigBilateral', 'SSimDownscaler'), { dscale: 'mitchell', 'linear-downscaling': 'no', 'correct-downscaling': 'yes' }, 'KrigBilateral chroma + SSimDownscaler. Keeps fine detail when 4K is shown in a smaller window.'],
  };
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const ASPECTS = [['Auto', '-1', 0], ['16:9', '16:9', 0], ['4:3', '4:3', 0], ['2.35:1', '2.35:1', 0], ['Fill', '-1', 1]];
  const TONE = ['auto', 'bt.2390', 'hable', 'mobius', 'reinhard'];
  const TABS = [['pic', 'Picture', I.pic], ['audio', 'Audio', I.audio], ['subs', 'Subtitles', I.subs], ['play', 'Playback', I.gauge], ['info', 'Info', I.info]];

  const root = document.createElement('div');
  root.id = 'ihp'; root.hidden = true;
  const sld = (attrs, trk, cls = '') => `<div class="ihp-sld ${cls}" ${attrs} data-val="0" style="--trk:${trk || 'rgba(255,255,255,.16)'}"><i class="ihp-s-trk"></i><i class="ihp-s-fill"></i><b class="ihp-s-thumb"><em></em></b></div>`;
  const slider = (id, label, min, max, step, icon, trk, def = 0) => `<div class="sl" data-id="${id}"><label title="Double-click to reset">${icon ? I[icon] : ''}${label}<output></output></label>${sld(`data-min="${min}" data-max="${max}" data-step="${step}" data-def="${def}"`, trk)}</div>`;
  root.innerHTML = `
    <div class="ihp-hit"></div><div class="ihp-shade t"></div><div class="ihp-shade b"></div>
    <div class="ihp-skip l"><b>${I.b10}<span>10 seconds</span></b></div><div class="ihp-skip r"><b>${I.f10}<span>10 seconds</span></b></div>
    <div class="ihp-top"><button class="ihp-round ihp-glass" data-a="close" title="Back (Esc)">${I.back}</button></div>
    <div class="ihp-center"><div class="ihp-pulse"></div><div class="ihp-spin"></div></div>
    <div class="ihp-hud ihp-glass"></div>
    <div class="ihp-bottom">
      <div class="ihp-meta"><div class="ihp-title"></div><div class="ihp-tags"></div></div>
      <div class="ihp-chaps"><div class="cs" data-list="chap"></div></div>
      <div class="ihp-scrub"><div class="trk"><i class="buf"></i><i class="fill"></i><b class="knob"></b><em class="tip"></em></div>
        <div class="ihp-times"><span class="cur">0:00</span><span class="rem">0:00</span></div></div>
      <div class="ihp-row">
        <div class="g">
          <button class="ihp-play" data-a="toggle" title="Play / pause (Space)"><span class="i-pause">${I.pause}</span><span class="i-play">${I.play}</span></button>
          <button class="ihp-ib sk" data-a="back10" title="Back 10 s (←)">${I.b10}</button><button class="ihp-ib sk" data-a="fwd10" title="Forward 10 s (→)">${I.f10}</button>
          <div class="ihp-vol"><button class="ihp-ib" data-a="mute" title="Mute (M)"></button>${sld('data-vol data-min="0" data-max="150" data-step="1" data-def="100"', '', 'sm')}</div>
        </div>
        <div class="g ihp-dock ihp-glass">
          <button class="ihp-sp" data-a="speed" title="Speed ([ and ])">1×</button><i class="sep"></i>
          <button class="ihp-ib" data-a="chaps" title="Chapters (H)" hidden>${I.list}</button>
          <button class="ihp-ib" data-a="tab:subs" title="Subtitles (C)">${I.subs}</button><button class="ihp-ib" data-a="tab:audio" title="Audio (A)">${I.audio}</button>
          <button class="ihp-ib" data-a="tab:pic" title="Picture (P)">${I.pic}</button><button class="ihp-ib" data-a="tab:info" title="About this title (I)">${I.info}</button><i class="sep"></i>
          <button class="ihp-ib" data-a="pip" title="Picture in picture (W)">${I.pip}</button>
          <button class="ihp-ib ihp-fs" data-a="fs" title="Full screen (F)"><span class="i-enter">${I.enter}</span><span class="i-exit">${I.exit}</span></button>
        </div>
      </div>
    </div>
    <aside class="ihp-panel">
      <div class="ihp-tabs"><i class="ind"></i>${TABS.map(([k, l, ic]) => `<button data-tab="${k}">${ic}<span>${l}</span></button>`).join('')}</div>
      <div class="ihp-pages">
        <div class="pg" data-pg="pic">
          <h4>Looks</h4><div class="presets" data-presets>${Object.entries(PRESETS).map(([k, [, sw]]) => `<button data-preset="${k}" style="--sw:${sw}">${k}</button>`).join('')}</div>
          <h4>Adjust<button data-a="resetpic">Reset</button></h4>${PICTURE.map(([k, l, ic, trk]) => slider(k, l, -100, 100, 1, ic, trk)).join('')}
          <h4>Render quality</h4><div class="chips" data-render>${Object.keys(RENDER).map((k) => `<button data-render="${k}">${k}</button>`).join('')}</div><div class="ihp-note" data-rnote></div>
          <h4>Shaders</h4><div class="chips" data-shaders>${Object.keys(SHADERS).map((k) => `<button data-shader="${k}">${k}</button>`).join('')}</div><div class="ihp-note" data-snote></div>
          <h4>Quality</h4>
          <div class="tg"><div>Smooth motion<small>Blends frames for fluid pans</small></div><button data-tg="interp"></button></div>
          <div class="tg"><div>Remove banding<small>Smooths gradients in dark scenes</small></div><button data-tg="deband"></button></div>
          <h4>HDR tone mapping</h4><div class="chips" data-tone>${TONE.map((t) => `<button data-tone="${t}">${t}</button>`).join('')}</div>
        </div>
        <div class="pg" data-pg="audio"><h4>Track</h4><div data-list="audio"></div><h4>Sync</h4>${slider('audio-delay', 'Audio delay', -2, 2, 0.05, '')}</div>
        <div class="pg" data-pg="subs"><h4>Track</h4><div data-list="sub"></div><h4>Look</h4>${slider('sub-delay', 'Delay', -5, 5, 0.1, '')}${slider('sub-scale', 'Size', 0.5, 2.5, 0.05, '', '', 1)}${slider('sub-pos', 'Position', 0, 100, 1, '', '', 100)}</div>
        <div class="pg" data-pg="play">
          <h4>Speed</h4><div class="chips" data-speeds>${SPEEDS.map((s) => `<button data-speed="${s}">${s}×</button>`).join('')}</div>
          <h4>Aspect ratio</h4><div class="chips" data-aspects>${ASPECTS.map((a, i) => `<button data-aspect="${i}">${a[0]}</button>`).join('')}</div>
          <h4>Tools</h4><div class="chips"><button data-a="shot">Save screenshot</button></div>
        </div>
        <div class="pg" data-pg="info"><div data-info><div class="empty">Loading…</div></div></div>
      </div>
    </aside>`;
  const q = (s, r = root) => r.querySelector(s);
  const qa = (s, r = root) => [...r.querySelectorAll(s)];
  // ---------- sliders: custom, GPU-friendly, throttled ----------
  const pend = {}; let pendT = 0;
  const flush = () => { pendT = 0; for (const k of Object.keys(pend)) { set(k, pend[k]); delete pend[k]; } };
  const setThrottled = (name, value) => { pend[name] = value; if (!pendT) pendT = setTimeout(flush, 32); };
  const sval = (el) => +el.dataset.val;
  function paintSlider(el) {
    const mn = +el.dataset.min, mx = +el.dataset.max, v = Math.min(mx, Math.max(mn, sval(el)));
    const p = (v - mn) / (mx - mn), mid = mn < 0 ? -mn / (mx - mn) : 0, lo = Math.min(p, mid), hi = Math.max(p, mid);
    q('.ihp-s-fill', el).style.transform = `translateX(${lo * 100}%) scaleX(${Math.max(hi - lo, 0.0001)})`;
    q('.ihp-s-thumb', el).style.left = (p * 100) + '%';
  }
  function setSlider(el, v, silent) {
    const mn = +el.dataset.min, mx = +el.dataset.max, step = +el.dataset.step || 1;
    v = Math.min(mx, Math.max(mn, Math.round(v / step) * step)); v = +v.toFixed(3);
    const def = +el.dataset.def; if (Math.abs(v - def) <= (mx - mn) * 0.012) v = def; // magnet at the default
    el.dataset.val = v; paintSlider(el);
    if (!silent) return v;
    return v;
  }
  function initSlider(el, onSlide, onEnd) {
    const tip = document.createElement('span'); tip.className = 'ihp-s-tip'; q('.ihp-s-thumb', el).append(tip);
    const label = (v) => { const row = el.closest('.sl'); return row ? valueText(row.dataset.id, v) : Math.round(v) + '%'; };
    const at = (e) => { const r = el.getBoundingClientRect(), mn = +el.dataset.min, mx = +el.dataset.max; return mn + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (mx - mn); };
    const move = (e) => { const v = setSlider(el, at(e)); tip.textContent = label(v); onSlide(v); };
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); el.classList.add('drag'); sliding++; move(e); });
    el.addEventListener('pointermove', (e) => { if (el.classList.contains('drag')) move(e); });
    const end = () => { if (!el.classList.contains('drag')) return; el.classList.remove('drag'); sliding--; flush(); onEnd && onEnd(sval(el)); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  let sliding = 0;

  // ---------- feedback ----------
  let hudT = 0;
  function hud(icon, text, ratio) {
    const el = q('.ihp-hud');
    el.innerHTML = `${icon}<span>${esc(text)}</span>${ratio == null ? '' : `<div class="bar"><i style="width:${Math.max(0, Math.min(1, ratio)) * 100}%"></i></div>`}`;
    el.classList.add('on'); clearTimeout(hudT); hudT = setTimeout(() => el.classList.remove('on'), 1300);
  }
  function pulse(icon) { const el = q('.ihp-pulse'); el.innerHTML = icon; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); }
  function ripple(side, label) { const el = q('.ihp-skip.' + side); q('span', el).textContent = label; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); }

  let idleT = 0;
  function wake() { root.classList.add('ui'); clearTimeout(idleT); idleT = setTimeout(() => { if (!panelOpen() && !dragging && !hoverUI) root.classList.remove('ui'); }, 3000); }
  let hoverUI = false;

  // ---------- state -> UI ----------
  let lastMi = '', lastTags = '', dragging = false, dragT = 0, lastPos = 0, lastAt = 0, lastTracks = '', playing = false, chapKey = '';
  function paintStatic() {
    const paused = b('pause');
    root.classList.toggle('paused', paused);
    root.classList.toggle('buf', b('paused-for-cache'));
    const v = n('volume', 100), muted = b('mute') || v === 0;
    const mi = muted ? I.mute : v < 50 ? I.vol1 : I.vol; if (mi !== lastMi) { lastMi = mi; q('[data-a=mute]').innerHTML = mi; }
    const ti = S['media-title'] || ''; if (q('.ihp-title').textContent !== ti) q('.ihp-title').textContent = ti;
    const tags = [];
    if (n('width')) tags.push([n('height') >= 2000 || n('width') >= 3600 ? '4K' : n('height') + 'p', true]);
    if (S['hwdec-current'] && S['hwdec-current'] !== 'no') tags.push(['Hardware decode']);
    const th = tags.map(([t, hi]) => `<span class="ihp-tag${hi ? ' hi' : ''}">${t}</span>`).join(''); if (th !== lastTags) { lastTags = th; q('.ihp-tags').innerHTML = th; }
    const vol = q('[data-vol]'); if (!vol.classList.contains('drag')) setSlider(vol, v, true);
    q('[data-a=speed]').textContent = (+n('speed', 1).toFixed(2)) + '×';
    for (const row of qa('.sl')) {
      const id = row.dataset.id, s = q('.ihp-sld', row);
      if (!s.classList.contains('drag') && S[id] !== undefined) { setSlider(s, n(id), true); }
      const t = valueText(id, sval(s)), o = q('output', row); if (o.textContent !== t) o.textContent = t;
    }
    for (const x of qa('[data-speed]')) x.classList.toggle('on', Math.abs(+x.dataset.speed - n('speed', 1)) < 0.01);
    const pan = n('panscan'), asp = S['video-aspect-override'] || '-1';
    qa('[data-aspect]').forEach((x, i) => { const [, val, p] = ASPECTS[i]; x.classList.toggle('on', p ? pan > 0.5 : (!(pan > 0.5) && (val === asp || (val === '-1' && (asp === '-1' || asp === '-1.000000'))))); });
    qa('[data-tone]').forEach((x) => x.classList.toggle('on', x.dataset.tone === (S['tone-mapping'] || 'auto')));
    q('[data-tg=deband]').classList.toggle('on', b('deband'));
    q('[data-tg=interp]').classList.toggle('on', b('interpolation'));
    const sc = S.scale || ''; let rn = '';
    qa('[data-render]').forEach((x) => { if (!x.dataset.render) return; const on = RENDER[x.dataset.render][1] === sc; x.classList.toggle('on', on); if (on) rn = RENDER[x.dataset.render][2]; });
    const rnote = q('[data-rnote]'); if (rnote && rnote.textContent !== rn) rnote.textContent = rn;
    for (const x of qa('[data-preset]')) { const p = PRESETS[x.dataset.preset][0]; x.classList.toggle('on', PICTURE.every(([k]) => Math.round(n(k)) === p[k])); }
    root.classList.toggle('fs', fsNow());
  }
  const fsNow = () => !!document.fullscreenElement || (window.innerHeight >= screen.height - 2 && window.innerWidth >= screen.width - 2);
  function valueText(id, v) {
    if (id.endsWith('delay')) return (v > 0 ? '+' : '') + v.toFixed(2) + ' s';
    if (id === 'sub-scale') return Math.round(v * 100) + '%';
    if (id === 'sub-pos') return Math.round(v) + '';
    return (v > 0 ? '+' : '') + Math.round(v);
  }
  const LANGS = { en: 'EN', eng: 'EN', it: 'IT', ita: 'IT', sv: 'SV', swe: 'SV', lt: 'LT', lit: 'LT', de: 'DE', ger: 'DE', deu: 'DE', fr: 'FR', fre: 'FR', fra: 'FR', es: 'ES', spa: 'ES', ja: 'JA', jpn: 'JA', ru: 'RU', rus: 'RU' };
  function trackRow(prop, t, cur) {
    const lang = LANGS[t.lang] || (t.lang ? t.lang.toUpperCase().slice(0, 3) : '··');
    const ch = t['demux-channel-count'], codec = (t.codec || '').toUpperCase().replace('HDMV_PGS_SUBTITLE', 'PGS').replace('SUBRIP', 'SRT');
    const main = t.title || (t.type === 'audio' ? (ch > 2 ? 'Surround' : ch === 2 ? 'Stereo' : 'Audio') : t.forced ? 'Forced' : 'Subtitles');
    const sub = [codec, t.type === 'audio' && ch ? ch + ' ch' : '', t.forced && t.title ? 'Forced' : '', t.default ? 'Default' : ''].filter(Boolean).join(' · ');
    return `<button class="tr ${String(t.id) === String(cur) ? 'on' : ''}" data-set="${prop}" data-v="${t.id}"><span class="lang">${lang}</span><span>${esc(main)}<span class="d">${esc(sub)}</span></span>${I.check.replace('<svg', '<svg class="ck"')}</button>`;
  }
  function paintTracks(list, chapters) {
    const key = JSON.stringify([list, chapters, S.sid, S.aid, n('duration')]);
    if (key === lastTracks) return; lastTracks = key;
    const mk = (type, prop, withOff) => {
      const items = list.filter((t) => t.type === type), cur = S[prop];
      let h = withOff ? `<button class="tr ${cur === 'no' || cur === undefined ? 'on' : ''}" data-set="${prop}" data-v="no"><span class="lang">OFF</span><span>Off</span>${I.check.replace('<svg', '<svg class="ck"')}</button>` : '';
      h += items.map((t) => trackRow(prop, t, cur)).join('');
      return h || '<div class="empty">None in this file</div>';
    };
    q('[data-list=audio]').innerHTML = mk('audio', 'aid', false);
    q('[data-list=sub]').innerHTML = mk('sub', 'sid', true);
    const cl = (chapters || []).slice().sort((a, b) => a.time - b.time);
    q('[data-list=chap]').innerHTML = cl.map((c, i) => `<button data-chap="${c.time}"><small>${fmt(c.time)}</small><b>${esc(c.title || 'Chapter ' + (i + 1))}</b></button>`).join('');
    q('[data-a=chaps]').hidden = cl.length < 2; if (cl.length < 2) root.classList.remove('ch-open');
    paintChapters(chapters || []);
  }
  // chapters split the timeline into segments; hovering shows the chapter name
  let chapters = [], lastCh = null;
  function paintChapters(list) {
    const dur = n('duration'); chapters = (list || []).filter((c) => c.time >= 0).sort((a, b) => a.time - b.time);
    const trk = q('.trk'); qa('.ch', trk).forEach((e) => e.remove());
    if (dur > 0 && chapters.length > 1) for (const c of chapters) if (c.time > 1 && c.time < dur - 1) { const e = document.createElement('div'); e.className = 'ch'; e.style.left = (c.time / dur * 100) + '%'; trk.append(e); }
  }
  const chapterAt = (t) => { let c = null; for (const x of chapters) if (x.time <= t + 0.2) c = x; return c; };
  function paintTime(pos) {
    const dur = n('duration'), r = dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : 0;
    q('.fill').style.transform = `scaleX(${r})`;
    q('.knob').style.left = (r * 100) + '%';
    q('.cur').textContent = fmt(pos);
    const cc = chapterAt(pos); if (cc !== lastCh) { lastCh = cc; qa('.cs button').forEach((x) => x.classList.toggle('on', cc && +x.dataset.chap === cc.time)); }
    q('.rem').textContent = '-' + fmt(Math.max(0, dur - pos));
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

  // ---------- info (cast, details, what people think) ----------
  let infoState = '';
  async function loadInfo() {
    if (infoState) return; infoState = 'loading';
    const box = q('[data-info]');
    try {
      const d = await (await fetch('/api/info/now')).json();
      if (d.error) { box.innerHTML = `<div class="empty">${esc(d.error)}</div>`; infoState = ''; return; }
      infoState = 'done';
      const meta = [d.year, d.runtime ? Math.floor(d.runtime / 60) + 'h ' + (d.runtime % 60) + 'm' : '', ...(d.genres || []).slice(0, 2)].filter(Boolean).join(' · ');
      box.innerHTML = `
        <div class="ihp-inf-h"><div><div class="ihp-inf-t">${esc(d.title)}</div><div class="ihp-inf-m">${esc(meta)}</div></div>
          ${d.rating ? `<div class="ihp-inf-r"><b>${I.star}${d.rating.score}</b><span>${d.rating.votes.toLocaleString()} votes</span></div>` : ''}</div>
        ${d.tagline ? `<div class="ihp-inf-q">“${esc(d.tagline)}”</div>` : ''}
        <p class="ihp-inf-o" title="Click to read more">${esc(d.overview)}</p>
        ${d.directors?.length ? `<div class="ihp-inf-d">Directed by <b>${esc(d.directors.join(', '))}</b></div>` : ''}
        <h4>Cast</h4><div class="ihp-cast">${(d.cast || []).map((c) => `<div class="ihp-cm"><span class="ihp-ph">${c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy" draggable="false">` : esc(c.name[0])}</span><b>${esc(c.name)}</b><small>${esc(c.character)}</small></div>`).join('')}</div>
        <h4>What people think</h4>
        <div class="ihp-rvs">
        ${(d.reddit || []).map((t) => `<div class="ihp-rv"><div class="ihp-rv-h">${I.reddit}<b>r/${esc(t.subreddit)}</b><span>${t.score.toLocaleString()} ↑</span></div><div class="ihp-rv-t">${esc(t.title)}</div>${t.top.map((c) => `<p>“${esc(c.text)}” <small>u/${esc(c.author)}</small></p>`).join('')}</div>`).join('')}
        ${(d.reviews || []).map((r) => `<div class="ihp-rv"><div class="ihp-rv-h">${I.star}<b>${esc(r.author)}</b>${r.rating != null ? `<span>${r.rating}/10</span>` : ''}</div><p>${esc(r.text)}</p></div>`).join('')}
        </div>
        ${!(d.reddit?.length || d.reviews?.length) ? '<div class="empty">No reviews found yet.</div>' : ''}
        ${d.redditHint ? '<div class="ihp-inf-hint">Reddit threads show up here once you add <b>reddit_client_id</b> and <b>reddit_client_secret</b> to <code>~/.config/ironhide/config.json</code> (a free “script” app from reddit.com/prefs/apps). Reddit blocks anonymous requests. These cards are TMDB user reviews.</div>' : ''}
        ${d.redditError ? `<div class="ihp-inf-hint">Reddit: ${esc(d.redditError)}</div>` : ''}`;
      box.onclick = (e) => { const t = e.target.closest('.ihp-rv, .ihp-inf-o'); if (t) t.classList.toggle('open'); };
    } catch (e) { box.innerHTML = '<div class="empty">Could not load details.</div>'; infoState = ''; }
  }

  // ---------- controls ----------
  const seekTo = (t) => cmd('seek', Math.max(0, t), 'absolute');
  const rel = (s) => { cmd('seek', s, 'relative'); };
  const setVol = (v) => { v = Math.max(0, Math.min(150, v)); set('volume', v); S.volume = v; hud(v === 0 ? I.mute : v < 50 ? I.vol1 : I.vol, Math.round(v) + '%', v / 150); paintStatic(); };
  const setSpeed = (s) => { s = Math.max(0.25, Math.min(3, s)); set('speed', s); S.speed = s; hud(I.gauge, 'Speed ' + (+s.toFixed(2)) + '×'); paintStatic(); };
  let shaderName = 'Off';
  function applyShader(name, quiet) {
    const [list, opts] = SHADERS[name] || SHADERS.Off; shaderName = name;
    if (list) set('glsl-shaders', list); else cmd('change-list', 'glsl-shaders', 'clr', ''); for (const [k, v] of Object.entries(opts)) set(k, v);
    try { localStorage.setItem('ihp.shader', name); } catch {}
    qa('[data-shader]').forEach((x) => x.classList.toggle('on', x.dataset.shader === name));
    const sn = q('[data-snote]'); if (sn) sn.textContent = SHADERS[name][2];
    if (!quiet) hud(I.pic, name === 'Off' ? 'Shaders off' : name + ' shaders');
  }
  function applyPicture(vals) { for (const [k, v] of Object.entries(vals)) { set(k, v); S[k] = v; } savePicture(); paintStatic(); }
  const savePicture = () => { try { localStorage.setItem('ihp.pic', JSON.stringify(Object.fromEntries(PICTURE.map(([k]) => [k, n(k)])))); } catch {} };
  const panelOpen = () => root.classList.contains('pn');
  function tab(name) {
    root.classList.add('pn'); wake();
    const i = Math.max(0, TABS.findIndex((t) => t[0] === name));
    q('.ind').style.transform = `translateX(${i * 100}%)`; q('.ihp-panel').dataset.t = name;
    qa('[data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
    qa('.pg').forEach((x) => x.classList.toggle('on', x.dataset.pg === name));
    if (name === 'info') loadInfo();
  }
  const currentTab = () => (q('[data-tab].on') || {}).dataset?.tab;
  function closePanel() { root.classList.remove('pn'); wake(); }
  let lastClick = 0, lastSide = '';

  const actions = {
    close: () => call('player_close'),
    toggle: () => { cmd('cycle', 'pause'); pulse(b('pause') ? I.play : I.pause); },
    back10: () => { rel(-10); ripple('l', '10 seconds'); }, fwd10: () => { rel(10); ripple('r', '10 seconds'); },
    mute: () => { cmd('cycle', 'mute'); hud(b('mute') ? I.vol : I.mute, b('mute') ? 'Sound on' : 'Muted'); },
    fs: () => { if (!root.classList.contains('pip')) call('player_fullscreen'); },
    pip: () => call('player_pip', { aspect: n('width') > 0 && n('height') > 0 ? n('width') / n('height') : null }),
    speed: () => { const i = SPEEDS.findIndex((s) => Math.abs(s - n('speed', 1)) < 0.01); setSpeed(SPEEDS[(i + 1) % SPEEDS.length]); },
    resetpic: () => { applyPicture(PRESETS.Neutral[0]); hud(I.pic, 'Picture reset'); },
    chaps: () => { root.classList.toggle('ch-open'); wake(); const on = q('.cs .on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); },
    shot: () => { cmd('screenshot', 'window'); hud(I.snap, 'Screenshot saved to Pictures'); },
  };

  // mini player: no visible controls. Tap = pause, drag = move the window, double tap = expand
  let pipTap = 0;
  root.addEventListener('pointerdown', (e) => {
    if (!root.classList.contains('pip') || e.button) return;
    const x0 = e.clientX, y0 = e.clientY; let moved = false;
    const mv = (m) => { if (!moved && Math.hypot(m.clientX - x0, m.clientY - y0) > 4) { moved = true; off(); call('player_drag'); } };
    const up = () => { off(); if (moved) return; const now = performance.now(); if (now - pipTap < 320) { pipTap = 0; actions.pip(); } else { pipTap = now; setTimeout(() => { if (pipTap === now) { pipTap = 0; actions.toggle(); } }, 330); } };
    const off = () => { removeEventListener('pointermove', mv, true); removeEventListener('pointerup', up, true); };
    addEventListener('pointermove', mv, true); addEventListener('pointerup', up, true);
  });
  root.addEventListener('click', (e) => {
    if (root.classList.contains('pip')) return;
    const a = e.target.closest('[data-a]');
    if (a) { const [k, v] = a.dataset.a.split(':'); if (k === 'tab') { panelOpen() && currentTab() === v ? closePanel() : tab(v); } else actions[k]?.(); return; }
    const t = e.target.closest('[data-tab]'); if (t) return tab(t.dataset.tab);
    const p = e.target.closest('[data-preset]'); if (p) { applyPicture(PRESETS[p.dataset.preset][0]); hud(I.pic, p.dataset.preset); return; }
    const sp = e.target.closest('[data-speed]'); if (sp) return setSpeed(+sp.dataset.speed);
    const as = e.target.closest('[data-aspect]'); if (as) { const [name, v, pan] = ASPECTS[+as.dataset.aspect]; set('video-aspect-override', v); set('panscan', pan); S['video-aspect-override'] = v; S.panscan = pan; hud(I.enter, name); paintStatic(); return; }
    const shd = e.target.closest('button[data-shader]'); if (shd) { applyShader(shd.dataset.shader); return; }
    const rd = e.target.closest('button[data-render]'); if (rd) { const [opts] = RENDER[rd.dataset.render]; for (const [k, v] of Object.entries(opts)) { set(k, v); } S.scale = opts.scale; hud(I.pic, rd.dataset.render + ' rendering'); paintStatic(); return; }
    const to = e.target.closest('[data-tone]'); if (to) { set('tone-mapping', to.dataset.tone); S['tone-mapping'] = to.dataset.tone; paintStatic(); return; }
    const tg = e.target.closest('[data-tg]'); if (tg) {
      if (tg.dataset.tg === 'deband') { const v = !b('deband'); set('deband', v ? 'yes' : 'no'); S.deband = v ? 'yes' : 'no'; }
      else { const v = !b('interpolation'); set('interpolation', v ? 'yes' : 'no'); if (v) { set('video-sync', 'display-resample'); set('tscale', 'oversample'); } else set('video-sync', 'audio'); S.interpolation = v ? 'yes' : 'no'; }
      paintStatic(); return;
    }
    const st = e.target.closest('[data-set]'); if (st) { set(st.dataset.set, st.dataset.v); S[st.dataset.set] = st.dataset.v; lastTracks = ''; paintTracks(S['track-list'] || [], S['chapter-list'] || []); return; }
    const ch = e.target.closest('[data-chap]'); if (ch) return seekTo(+ch.dataset.chap);
    if (e.target.classList.contains('ihp-hit')) {
      if (panelOpen()) return closePanel();
      const now = performance.now(), x = e.clientX / innerWidth, side = x < 0.33 ? 'l' : x > 0.67 ? 'r' : 'c';
      if (now - lastClick < 300 && side === lastSide) {
        lastClick = 0;
        if (side === 'l') actions.back10(); else if (side === 'r') actions.fwd10(); else actions.fs();
      } else { lastClick = now; lastSide = side; setTimeout(() => { if (lastClick === now) { lastClick = 0; actions.toggle(); } }, 310); }
    }
  });
  // wire every slider once
  initSlider(q('[data-vol]'), (v) => { S.volume = v; setThrottled('volume', v); const mi = v === 0 ? I.mute : v < 50 ? I.vol1 : I.vol; if (mi !== lastMi) { lastMi = mi; q('[data-a=mute]').innerHTML = mi; } });
  for (const row of qa('.sl')) {
    const id = row.dataset.id, s = q('.ihp-sld', row), isPic = PICTURE.some(([k]) => k === id);
    initSlider(s, (v) => { S[id] = v; setThrottled(id, v); q('output', row).textContent = valueText(id, v); if (isPic) qa('[data-preset].on').forEach((x) => x.classList.remove('on')); }, () => { if (isPic) savePicture(); });
  }
  root.addEventListener('dblclick', (e) => { const l = e.target.closest('.sl label'); if (!l) return; const row = l.closest('.sl'), id = row.dataset.id, d = +q('.ihp-sld', row).dataset.def; set(id, d); S[id] = d; paintStatic(); if (PICTURE.some(([k]) => k === id)) savePicture(); });
  root.addEventListener('pointermove', wake);
  for (const sel of ['.ihp-bottom', '.ihp-top']) { q(sel).addEventListener('pointerenter', () => { hoverUI = true; }); q(sel).addEventListener('pointerleave', () => { hoverUI = false; wake(); }); }

  // scrubber, with chapter names on hover
  const trk = q('.trk'), tip = q('.tip');
  const ratioAt = (e) => { const r = trk.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  const tipText = (t) => { const c = chapterAt(t); return fmt(t) + (c && c.title ? '  ·  ' + c.title : ''); };
  trk.addEventListener('pointermove', (e) => { const r = ratioAt(e), t = r * n('duration'); tip.style.left = Math.min(Math.max(r * 100, 6), 94) + '%'; tip.textContent = tipText(t); if (dragging) { dragT = t; paintTime(dragT); } });
  trk.addEventListener('pointerdown', (e) => { trk.setPointerCapture(e.pointerId); dragging = true; trk.classList.add('drag'); dragT = ratioAt(e) * n('duration'); paintTime(dragT); });
  trk.addEventListener('pointerup', () => { if (!dragging) return; dragging = false; trk.classList.remove('drag'); seekTo(dragT); lastPos = dragT; lastAt = performance.now(); });

  document.addEventListener('keydown', (e) => {
    if (root.hidden || e.metaKey) return;
    const k = e.key; let used = true;
    // your mpv picture nudges: Ctrl+Up/Down gamma, Ctrl+Left/Right brightness, Shift+Up/Down contrast, Shift+Left/Right saturation
    const nudge = (prop, d, label) => { const v = Math.max(-100, Math.min(100, n(prop) + d)); set(prop, v); S[prop] = v; paintStatic(); hud(I.pic, `${label} ${v > 0 ? '+' : ''}${v}`, (v + 100) / 200); };
    if (e.ctrlKey && k.startsWith('Arrow')) { ({ ArrowUp: () => nudge('gamma', 1, 'Gamma'), ArrowDown: () => nudge('gamma', -1, 'Gamma'), ArrowRight: () => nudge('brightness', 1, 'Brightness'), ArrowLeft: () => nudge('brightness', -1, 'Brightness') })[k](); e.preventDefault(); e.stopPropagation(); wake(); return; }
    if (e.shiftKey && k.startsWith('Arrow')) { ({ ArrowUp: () => nudge('contrast', 2, 'Contrast'), ArrowDown: () => nudge('contrast', -2, 'Contrast'), ArrowRight: () => nudge('saturation', 2, 'Saturation'), ArrowLeft: () => nudge('saturation', -2, 'Saturation') })[k](); e.preventDefault(); e.stopPropagation(); wake(); return; }
    if (e.ctrlKey) return;
    // audio sync like your input.conf: z/x +-50 ms, Z/X +-100 ms, Alt+z reset
    const adelay = (d) => { const v = +(n('audio-delay') + d).toFixed(2); set('audio-delay', v); S['audio-delay'] = v; paintStatic(); hud(I.audio, `Audio delay ${v > 0 ? '+' : ''}${(v * 1000).toFixed(0)} ms`); };
    if (k === 'z' || k === 'x' || k === 'Z' || k === 'X') { adelay((k === 'z' ? -0.05 : k === 'x' ? 0.05 : k === 'Z' ? -0.1 : 0.1)); e.preventDefault(); e.stopPropagation(); wake(); return; }
    if (e.altKey && e.code === 'KeyZ') { set('audio-delay', 0); S['audio-delay'] = 0; paintStatic(); hud(I.audio, 'Audio delay reset'); e.preventDefault(); e.stopPropagation(); return; }
    switch (k) {
      case ' ': case 'k': actions.toggle(); break;
      case 'ArrowLeft': rel(-10); ripple('l', '10 seconds'); break;
      case 'ArrowRight': rel(10); ripple('r', '10 seconds'); break;
      case 'ArrowUp': setVol(n('volume', 100) + 5); break;
      case 'ArrowDown': setVol(n('volume', 100) - 5); break;
      case 'f': actions.fs(); break;
      case 'w': actions.pip(); break;
      case 'm': actions.mute(); break;
      case '[': setSpeed(n('speed', 1) - 0.25); break;
      case ']': setSpeed(n('speed', 1) + 0.25); break;
      case 'p': panelOpen() && currentTab() === 'pic' ? closePanel() : tab('pic'); break;
      case 'c': panelOpen() && currentTab() === 'subs' ? closePanel() : tab('subs'); break;
      case 'a': panelOpen() && currentTab() === 'audio' ? closePanel() : tab('audio'); break;
      case 'h': actions.chaps(); break;
      case 'i': panelOpen() && currentTab() === 'info' ? closePanel() : tab('info'); break;
      case 'q': actions.close(); break;
      case 'Escape': panelOpen() ? closePanel() : root.classList.contains('pip') ? actions.pip() : fsNow() ? actions.fs() : actions.close(); break;
      default: used = false;
    }
    if (used) { e.preventDefault(); e.stopPropagation(); wake(); }
  }, true);

  // ---------- called by the native side ----------
  window.__ihp = {
    open() {
      Object.keys(S).forEach((k) => delete S[k]); lastTracks = ''; infoState = ''; q('[data-info]').innerHTML = '<div class="empty">Loading…</div>';
      document.body.append(root); root.hidden = false; root.classList.remove('pn');
      tab('pic'); root.classList.remove('pn');
      document.documentElement.classList.add('ihp-on'); playing = true; wake(); requestAnimationFrame(frame);
      try { const p = JSON.parse(localStorage.getItem('ihp.pic') || 'null'); if (p) setTimeout(() => applyPicture(p), 500); } catch {}
      try { const sh = localStorage.getItem('ihp.shader'); setTimeout(() => applyShader(SHADERS[sh] ? sh : 'Off', true), 700); } catch {}
    },
    pip(on) { root.classList.toggle('pip', !!on); if (on) { closePanel(); root.classList.remove('ch-open'); } wake(); },
    close() { root.classList.remove('pip'); playing = false; root.hidden = true; document.documentElement.classList.remove('ihp-on'); root.classList.remove('pn', 'ui'); },
    state(s) {
      Object.assign(S, s); lastPos = n('time-pos'); lastAt = performance.now();
      if (S['track-list']) paintTracks(S['track-list'], S['chapter-list'] || []);
      q('.trk .buf').style.transform = `scaleX(${n('duration') > 0 ? Math.min(1, n('demuxer-cache-time') / n('duration')) : 0})`;
      paintStatic();
    },
  };
})();
