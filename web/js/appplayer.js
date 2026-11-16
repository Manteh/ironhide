// Player UI for the Orbie Mac app. The native side plays the video with libmpv underneath this page and pushes
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
  // Looks. mpv's equalizer runs -100..100; these are deliberately small moves (big ones crush blacks or clip highlights).
  //  - Reference: the picture as mastered (the idea behind TVs' Filmmaker Mode). Right for good HDR and well-graded films.
  //  - Film: a touch deeper mid-tones and contrast, like gamma 2.4 for a dim room, without crushing shadows.
  //  - Dark room: richer blacks for a dark room at night. Bright room: lifts shadows and adds punch against daylight glare.
  //  - Shadow detail: opens up murky, dark-graded streaming encodes (the "I can't see anything" episodes), with debanding.
  //  - Animation: cleaner, more saturated flat colours, debanded (gradients in anime band easily).
  //  - Restore: older or washed-out transfers get back contrast and colour. Vivid: showroom pop, for fun.
  // Your own presets from nitrate_presets.lua stay too.
  const P = (brightness, contrast, saturation, gamma, extra = {}) => ({ brightness, contrast, saturation, gamma, hue: 0, ...extra });
  const PRESETS = {
    Reference: [P(0, 0, 0, 0, { deband: 'no' }), 'linear-gradient(135deg,#2a2a31,#55555f)', 'As mastered. Best for good HDR and well-graded films.'],
    Film: [P(-1, 5, 2, -4), 'linear-gradient(135deg,#0e1218,#4b4a58 60%,#c9a77c)', 'Deeper mid-tones for a dim room, shadows kept.'],
    'Dark room': [P(-3, 7, 0, -6), 'linear-gradient(135deg,#050507,#1d2232 60%,#6d7591)', 'Richer blacks for watching at night.'],
    'Bright room': [P(4, 8, 7, 8), 'linear-gradient(135deg,#6d7b8a,#d6dee6 60%,#fff6dc)', 'Lifts shadows and adds punch against daylight.'],
    'Shadow detail': [P(3, -3, 2, 12, { deband: 'yes' }), 'linear-gradient(135deg,#0a0c12,#2f3a55 55%,#8fa3c9)', 'Opens up dark, murky streaming encodes.'],
    Animation: [P(0, 8, 14, -2, { deband: 'yes' }), 'linear-gradient(135deg,#ff6b8b,#ffc35c 45%,#5cb7ff)', 'Clean, saturated flat colours; no banding.'],
    Restore: [P(-2, 14, 10, -4), 'linear-gradient(135deg,#3d2f22,#8e6e4f 55%,#e8d2a8)', 'Brings back contrast and colour to older transfers.'],
    Vivid: [P(0, 12, 18, -2), 'linear-gradient(135deg,#00b4a6,#5b6cff 50%,#ff4fa3)', 'Showroom pop. Not accurate, just fun.'],
    'Vibrant Anime': [P(-5, 24, 26, -3), 'linear-gradient(135deg,#ff5d73,#ffb84a 45%,#4aa8ff)', 'Your preset.'],
    'Shadow Lift': [P(0, 22, 22, 5), 'linear-gradient(135deg,#0b0b12,#3a4a6c 55%,#d9b27a)', 'Your preset.'],
    'Cinephile Pop': [P(-2, 14, 12, -1), 'linear-gradient(135deg,#0d2230,#3a5a6c 55%,#c98a52)', 'Your preset.'],
  };
  PRESETS.Neutral = PRESETS.Reference; // older code paths reset to "Neutral"
  // which look fits what's playing (from its genres; HDR sources stay on Reference)
  let suggested = '';
  function suggest(genres = [], hdr = false) {
    const g = genres.map((x) => x.toLowerCase());
    if (hdr) return 'Reference';
    if (g.some((x) => x.includes('anim'))) return 'Animation';
    if (g.some((x) => /horror|thriller|crime|mystery/.test(x))) return 'Shadow detail';
    if (g.some((x) => /documentary|history/.test(x))) return 'Reference';
    return 'Film';
  }
  // render quality: the same options mpv's own `fast` and `high-quality` profiles set (from mpv's builtin.conf), plus your mpv.conf as "Balanced"
  const RENDER = {
    Performance: [{ scale: 'bilinear', cscale: 'bilinear', dscale: 'bilinear', 'correct-downscaling': 'no', 'linear-downscaling': 'no', 'sigmoid-upscaling': 'no', dither: 'no', 'hdr-compute-peak': 'no' }, 'bilinear', 'mpv “fast”: cheapest scaling, no dithering. For battery or a busy Mac.'],
    Balanced: [{ scale: 'spline36', cscale: 'spline36', dscale: 'hermite', 'correct-downscaling': 'yes', 'linear-downscaling': 'yes', 'sigmoid-upscaling': 'yes', dither: 'fruit', 'hdr-compute-peak': 'auto' }, 'spline36', 'Your mpv.conf: spline36 scaling, correct downscaling, 10-bit dithering.'],
    'High quality': [{ scale: 'ewa_lanczossharp', 'scale-antiring': '0.6', cscale: 'ewa_lanczossharp', dscale: 'hermite', 'correct-downscaling': 'yes', 'linear-downscaling': 'yes', 'sigmoid-upscaling': 'yes', dither: 'fruit', 'hdr-compute-peak': 'yes' }, 'ewa_lanczossharp', 'mpv “high-quality”: ewa_lanczossharp with anti-ringing. The sharpest scaling; heavier on the GPU.'],
  };
  // shader pipelines (files live in ~/.config/mpv/shaders). Hooks only run when they apply, e.g. upscalers when the picture is enlarged.
  const SH = (...f) => f.map((x) => '~/.config/mpv/shaders/' + x + '.glsl').join(':');
  // Benchmarked on this Mac at 1080p shown on a 2880x1802 window (24 fps, 8 s each): "Anime", "Anime denoise", "Anime GAN" and
  // "Live action" dropped 0 frames. Not offered because they dropped most frames here: Anime4K VL/HQ, Anime4K GAN M,
  // KrigBilateral (48 dropped on its own) and FSRCNNX combined with SSimSuperRes and KrigBilateral (169 dropped).
  const SHADERS = {
    Off: ['', {}, 'No extra shaders.'],
    Anime: [SH('Anime4K_Clamp_Highlights', 'Anime4K_Restore_CNN_M', 'Anime4K_Upscale_CNN_x2_M', 'Anime4K_AutoDownscalePre_x2', 'Anime4K_AutoDownscalePre_x4', 'Anime4K_Upscale_CNN_x2_S'), {}, 'Anime4K mode A (fast): restores line art, then upscales 2x twice. Real-time on this Mac.'],
    'Anime denoise': [SH('Anime4K_Clamp_Highlights', 'Anime4K_Upscale_Denoise_CNN_x2_M', 'Anime4K_AutoDownscalePre_x2', 'Anime4K_AutoDownscalePre_x4', 'Anime4K_Upscale_CNN_x2_S'), {}, 'Anime4K mode C (fast): removes noise while upscaling. For noisy or compressed anime.'],
    'Anime GAN': [SH('Anime4K_Clamp_Highlights', 'Anime4K_Upscale_GAN_x2_S', 'Anime4K_AutoDownscalePre_x2', 'Anime4K_AutoDownscalePre_x4'), {}, 'Anime4K GAN (small): sharper, more painted lines than the CNN modes. Real-time at 1080p here; the medium GAN is too heavy.'],
    'Live action': [SH('FSRCNNX_x2_8-0-4-1'), {}, 'FSRCNNX neural upscaling for live-action video shown larger than its resolution. Does nothing when the picture is shrunk (4K in a window).'],
    'Sharp downscale': [SH('SSimDownscaler'), { dscale: 'mitchell', 'linear-downscaling': 'no', 'correct-downscaling': 'yes' }, 'SSimDownscaler: keeps fine detail when 4K is shown in a smaller window. Not benchmarked.'],
  };

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const ASPECTS = [['Auto', '-1', 0], ['16:9', '16:9', 0], ['4:3', '4:3', 0], ['2.35:1', '2.35:1', 0], ['Fill', '-1', 1]];
  const TONE = ['auto', 'bt.2390', 'hable', 'mobius', 'reinhard'];
  const TABS = [['pic', 'Picture', I.pic], ['audio', 'Audio', I.audio], ['subs', 'Subtitles', I.subs], ['play', 'Playback', I.gauge]];

  const root = document.createElement('div');
  root.id = 'ihp'; root.hidden = true;
  const sld = (attrs, trk, cls = '') => `<div class="ihp-sld ${cls}" ${attrs} data-val="0" style="--trk:${trk || 'rgba(255,255,255,.16)'}"><i class="ihp-s-trk"></i><i class="ihp-s-fill"></i><b class="ihp-s-thumb"><em></em></b></div>`;
  const slider = (id, label, min, max, step, icon, trk, def = 0) => `<div class="sl" data-id="${id}"><label title="Double-click to reset">${icon ? I[icon] : ''}${label}<output></output></label>${sld(`data-min="${min}" data-max="${max}" data-step="${step}" data-def="${def}"`, trk)}</div>`;
  root.innerHTML = `
    <canvas class="ihp-amb" aria-hidden="true"></canvas><canvas class="ihp-aud" aria-hidden="true" hidden></canvas>
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
          <button class="ihp-ib" data-a="tab:pic" title="Picture (P)">${I.pic}</button><i class="sep"></i>
          <button class="ihp-ib" data-a="pip" title="Picture in picture (W)">${I.pip}</button>
          <button class="ihp-ib ihp-fs" data-a="fs" title="Full screen (F)"><span class="i-enter">${I.enter}</span><span class="i-exit">${I.exit}</span></button>
        </div>
      </div>
    </div>
    <section class="ihp-pinfo" aria-hidden="true"></section>
    <aside class="ihp-panel">
      <div class="ihp-tabs"><i class="ind"></i>${TABS.map(([k, l, ic]) => `<button data-tab="${k}">${ic}<span>${l}</span></button>`).join('')}</div>
      <div class="ihp-pages">
        <div class="pg" data-pg="pic">
          <h4>Looks<button data-a="resetpic">Reset</button></h4><div class="presets lk" data-presets>${Object.entries(PRESETS).filter(([k]) => k !== 'Neutral').map(([k, [, sw, d]]) => `<button data-preset="${k}" title="${d}"><i style="background:${sw}"></i><span>${k}</span></button>`).join('')}</div>
          <div class="ihp-note lk-note" data-lnote></div>
          <details class="ft"><summary>Fine-tune<span data-ftsum></span></summary>${PICTURE.map(([k, l, ic, trk]) => slider(k, l, -100, 100, 1, ic, trk)).join('')}</details>
          <h4>Frame<button data-frame="reset">Reset</button></h4>
          <div class="chips" data-frames><button data-frame="cinema">Cinema</button><button data-frame="lying">Lying down</button><button data-frame="smaller">Smaller</button><button data-frame="bigger">Bigger</button><button data-frame="up">Up</button><button data-frame="down">Down</button></div>
          <div class="amb-sl"><label>Light strength<output data-ambo="strength"></output></label><input type="range" min="0.3" max="2" step="0.05" data-amb="strength" aria-label="Light strength"></div>
          <div class="amb-sl"><label>Light reach<output data-ambo="reach"></output></label><input type="range" min="0.5" max="2" step="0.05" data-amb="reach" aria-label="Light reach"></div>
          <div class="amb-sl"><label>Audience<output data-ambo="crowd"></output></label><input type="range" min="0" max="1" step="0.05" data-amb="crowd" aria-label="Audience"></div>
          <div class="tg"><div>Ambient mode<small>Smaller, movable picture with the film's light around it (G). Off: normal full screen</small></div><button data-tg="amb"></button></div>
          <div class="ihp-note">Shrink and move the picture inside the black screen. Option+arrows move it, Option+− and Option+= resize, Option+drag places it, Option+0 resets. Kept for your next films.</div>
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
  function wake() { hidePaused(); if (b('pause')) showPaused(); root.classList.add('ui'); clearTimeout(idleT); idleT = setTimeout(() => { if (!panelOpen() && !dragging && !hoverUI) root.classList.remove('ui'); }, 3000); }
  let hoverUI = false;

  // ---------- state -> UI ----------
  let lastMi = '', lastTags = '', dragging = false, dragT = 0, lastPos = 0, lastAt = 0, lastTracks = '', playing = false, chapKey = '';
  function paintStatic() {
    const paused = b('pause');
    if (paused !== root.classList.contains('paused')) { if (paused) { buildPaused(); showPaused(); } else hidePaused(); }
    root.classList.toggle('paused', paused); audKick();
    root.classList.toggle('buf', b('paused-for-cache'));
    const v = n('volume', 100), muted = b('mute') || v === 0;
    const mi = muted ? I.mute : v < 50 ? I.vol1 : I.vol; if (mi !== lastMi) { lastMi = mi; q('[data-a=mute]').innerHTML = mi; }
    let ti = S['media-title'] || ''; if (!ti || /^https?:|requestdl|token=|[?&]\w+=/.test(ti)) ti = window.__ihpTitle || ti.replace(/[?#].*$/, '').split('/').pop();
    if (window.__ihpEpTitle && /S\d+E\d+/i.test(ti)) ti = window.__ihpEpTitle; if (q('.ihp-title').textContent !== ti) q('.ihp-title').textContent = ti;
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
    let cur = '';
    for (const x of qa('[data-preset]')) { const p = PRESETS[x.dataset.preset][0]; const on = PICTURE.every(([k]) => Math.round(n(k)) === p[k]); x.classList.toggle('on', on); x.classList.toggle('sug', x.dataset.preset === suggested); if (on && !cur) cur = x.dataset.preset; }
    const ln = q('[data-lnote]'); if (ln) ln.textContent = cur ? PRESETS[cur][2] : 'Custom: adjusted by hand.';
    const fs = q('[data-ftsum]'); if (fs) fs.textContent = PICTURE.filter(([k]) => Math.round(n(k))).map(([k, l]) => `${l} ${n(k) > 0 ? '+' : ''}${Math.round(n(k))}`).slice(0, 3).join(' · ');
    root.classList.toggle('fs', fsNow());
  }
  // the native side says when the window enters or leaves full screen (window.__ihp.fs); the size check is only a fallback
  const fsNow = () => (typeof window.__ihFs === 'boolean' ? window.__ihFs : !!document.fullscreenElement || (window.innerHeight >= screen.height - 2 && window.innerWidth >= screen.width - 2));
  // full screen as last seen, and when it last changed: Escape leaves full screen and never closes the player in the same press
  let fsWas = false, fsAt = 0;
  const fsTrack = () => { const f = fsNow(); if (f !== fsWas) { fsWas = f; fsAt = performance.now(); root.classList.toggle('fs', f); } };
  window.addEventListener('resize', fsTrack); document.addEventListener('fullscreenchange', fsTrack);
  function valueText(id, v) {
    if (id.endsWith('delay')) return (v > 0 ? '+' : '') + v.toFixed(2) + ' s';
    if (id === 'sub-scale') return Math.round(v * 100) + '%';
    if (id === 'sub-pos') return Math.round(v) + '';
    return (v > 0 ? '+' : '') + Math.round(v);
  }
  // A flag for each track's language. The region comes from the track ("es-419", "pt-BR") or its title ("Spanish (Latin
  // America)", "French (Canada)"), else the language's home country. Unknown languages keep a short code.
  const LANG_CC = {
    en: 'GB', eng: 'GB', fr: 'FR', fre: 'FR', fra: 'FR', de: 'DE', ger: 'DE', deu: 'DE', it: 'IT', ita: 'IT', es: 'ES', spa: 'ES',
    pt: 'PT', por: 'PT', nl: 'NL', dut: 'NL', nld: 'NL', sv: 'SE', swe: 'SE', no: 'NO', nor: 'NO', nb: 'NO', nob: 'NO', da: 'DK', dan: 'DK',
    fi: 'FI', fin: 'FI', is: 'IS', ice: 'IS', isl: 'IS', lt: 'LT', lit: 'LT', lv: 'LV', lav: 'LV', et: 'EE', est: 'EE', pl: 'PL', pol: 'PL',
    cs: 'CZ', cze: 'CZ', ces: 'CZ', sk: 'SK', slo: 'SK', slk: 'SK', hu: 'HU', hun: 'HU', ro: 'RO', rum: 'RO', ron: 'RO', bg: 'BG', bul: 'BG',
    hr: 'HR', hrv: 'HR', sr: 'RS', srp: 'RS', sl: 'SI', slv: 'SI', el: 'GR', gre: 'GR', ell: 'GR', tr: 'TR', tur: 'TR', ru: 'RU', rus: 'RU',
    uk: 'UA', ukr: 'UA', he: 'IL', heb: 'IL', ar: 'SA', ara: 'SA', fa: 'IR', per: 'IR', fas: 'IR', hi: 'IN', hin: 'IN', ta: 'IN', tam: 'IN',
    te: 'IN', tel: 'IN', bn: 'BD', ben: 'BD', th: 'TH', tha: 'TH', vi: 'VN', vie: 'VN', id: 'ID', ind: 'ID', ms: 'MY', may: 'MY', msa: 'MY',
    tl: 'PH', fil: 'PH', ja: 'JP', jpn: 'JP', ko: 'KR', kor: 'KR', zh: 'CN', chi: 'CN', zho: 'CN', cmn: 'CN', yue: 'HK', ca: 'ES', cat: 'ES',
  };
  const REGION_HINTS = [[/latin|latino|latam|mexic/i, 'MX'], [/brazil|brasil/i, 'BR'], [/canad|qu[eé]bec/i, 'CA'], [/\bus\b|american|united states/i, 'US'],
    [/portugal|european portuguese/i, 'PT'], [/castil|spain|españa|european spanish/i, 'ES'], [/france/i, 'FR'], [/belgi/i, 'BE'], [/swiss|switzerland/i, 'CH'],
    [/austria/i, 'AT'], [/taiwan|traditional/i, 'TW'], [/hong kong|cantonese/i, 'HK'], [/simplified|mandarin/i, 'CN'], [/australia/i, 'AU']];
  const flagOf = (cc) => String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  function langBadge(t) {
    const raw = String(t.lang || '').toLowerCase(), [base, region] = raw.split(/[-_]/);
    let cc = /^[a-z]{2}$/.test(region || '') ? region.toUpperCase() : /^\d{3}$/.test(region || '') ? 'MX' : '';
    if (!cc) cc = REGION_HINTS.find(([re]) => re.test(t.title || ''))?.[1] || '';
    if (cc && !LANG_CC[base] && !region) cc = ''; // a title hint alone, for a language we don't know: don't guess
    cc = cc || LANG_CC[base] || '';
    const name = base ? base.toUpperCase().slice(0, 3) : '';
    return cc ? `<span class="lang flag" title="${esc(raw || name)}">${flagOf(cc)}</span>` : `<span class="lang">${esc(name || '··')}</span>`;
  }
  function trackRow(prop, t, cur) {
    const ch = t['demux-channel-count'], codec = (t.codec || '').toUpperCase().replace('HDMV_PGS_SUBTITLE', 'PGS').replace('SUBRIP', 'SRT');
    const main = t.title || (t.type === 'audio' ? (ch > 2 ? 'Surround' : ch === 2 ? 'Stereo' : 'Audio') : t.forced ? 'Forced' : 'Subtitles');
    const sub = [codec, t.type === 'audio' && ch ? ch + ' ch' : '', t.forced && t.title ? 'Forced' : '', t.default ? 'Default' : ''].filter(Boolean).join(' · ');
    return `<button class="tr ${String(t.id) === String(cur) ? 'on' : ''}" data-set="${prop}" data-v="${t.id}">${langBadge(t)}<span>${esc(main)}<span class="d">${esc(sub)}</span></span>${I.check.replace('<svg', '<svg class="ck"')}</button>`;
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
    try { paintSkip(pos); } catch {} // declared further down; never let it stop the clock
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

  // ---------- paused info: what's on screen when you pause and leave the mouse still ----------
  // Instead of a still frame: the title, what it's about, who's in it and what people think, laid over a dimmed picture.
  // It appears after ~4 s of a paused, untouched player and leaves at the first mouse move, key or play.
  let pinfoFor = '', pinfoT = 0;
  // a review worth reading on pause: a good one (7/10 and up), cut at a sentence end
  const goodQuote = (reviews) => {
    const r = (reviews || []).filter((x) => x.rating != null && x.rating >= 7 && (x.text || '').length > 60).sort((a, b) => b.rating - a.rating)[0];
    if (!r) return null;
    let t = r.text.replace(/\s+/g, ' ').trim();
    if (t.length > 220) { const cut = t.slice(0, 220); const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? ')); t = end > 90 ? cut.slice(0, end + 1) : cut.replace(/\s\S*$/, '') + '…'; }
    return { text: t, author: r.author, rating: r.rating };
  };
  const hm = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
  async function buildPaused() {
    const title = S['media-title'] || ''; if (title === pinfoFor) return; pinfoFor = title;
    const el = q('.ihp-pinfo'); el.innerHTML = '';
    try {
      const d = await (await fetch('/api/info/now')).json(); if (d.error) return;
      const ep = d.episode, dur = n('duration'), pos = n('time-pos'), left = Math.max(0, dur - pos), pct = dur ? Math.min(100, (pos / dur) * 100) : 0;
      const rt = ep?.runtime || d.runtime;
      const facts = [d.year, ...(d.genres || []).slice(0, 2), !ep && rt ? hm(rt * 60) : ''].filter(Boolean);
      const imdb = (d.scores || []).find((x) => x.src === 'imdb'), tm = (d.scores || []).find((x) => x.src === 'tmdb'), rtm = (d.scores || []).find((x) => x.src === 'rt');
      const score = ep?.rating ? { k: 'Episode', v: ep.rating } : imdb ? { k: 'IMDb', v: imdb.value } : tm ? { k: 'TMDB', v: tm.value } : null;
      const quote = goodQuote(d.reviews);
      const cast = (d.cast || []).filter((c) => c.photo).slice(0, 5);
      el.innerHTML = `<div class="pi-wrap">
        <div class="pi-k"><span class="pi-pz"><i></i><i></i></span>Paused</div>
        <h2>${esc(d.title)}</h2>
        ${ep ? `<div class="pi-ep"><em>S${ep.season} · E${ep.episode}</em>${ep.name && !/^Episode \d+$/.test(ep.name) ? `<b>${esc(ep.name)}</b>` : ''}</div>` : d.tagline ? `<div class="pi-ep"><b class="pi-tag">${esc(d.tagline)}</b></div>` : ''}
        <div class="pi-m">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}${d.certification ? `<span class="pi-cert">${esc(d.certification)}</span>` : ''}
          ${score ? `<span class="pi-sc">${I.star}<b>${esc(String(score.v))}</b><small>${score.k}</small></span>` : ''}${rtm ? `<span class="pi-sc rt"><b>${esc(rtm.value)}</b><small>Rotten Tomatoes</small></span>` : ''}</div>
        ${dur ? `<div class="pi-prog"><div class="pi-bar"><u style="width:${pct.toFixed(1)}%"></u></div><span>${hm(pos)} in</span><span class="pi-left">${hm(left)} left</span></div>` : ''}
        <p class="pi-o">${esc(ep?.overview || d.overview)}</p>
        ${cast.length ? `<div class="pi-cast">${cast.map((c) => `<div class="pi-p"><img src="${esc(c.photo)}" alt="" draggable="false"><span><b>${esc(c.name)}</b>${c.character ? `<small>${esc(c.character.split('/')[0].trim())}</small>` : ''}</span></div>`).join('')}</div>` : ''}
        ${quote ? `<figure class="pi-q"><blockquote>${esc(quote.text)}</blockquote><figcaption><span class="pi-stars">${'★'.repeat(Math.round(quote.rating / 2))}</span>${esc(quote.author)}</figcaption></figure>` : ''}
      </div>
      <div class="pi-hint"><kbd>Space</kbd> to resume</div>`;
    } catch {}
  }
  function showPaused(now = false) {
    clearTimeout(pinfoT);
    const ok = () => b('pause') && !panelOpen() && !dragging && root.classList.contains('paused') && q('.ihp-pinfo').innerHTML;
    if (now) { buildPaused().then(() => { if (b('pause')) root.classList.add('pinfo'); }); return; }
    pinfoT = setTimeout(() => { buildPaused().then(() => { if (ok() && !root.classList.contains('ui')) root.classList.add('pinfo'); }); }, 4000);
  }
  const hidePaused = () => { clearTimeout(pinfoT); root.classList.remove('pinfo'); };

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
  // the suggestion comes from what's playing (genres via the title info); fetched once per title
  let sugFor = '';
  async function loadSuggestion() {
    const title = S['media-title'] || ''; if (!title || title === sugFor) return; sugFor = title;
    try { const d = await (await fetch('/api/info/now')).json(); const hdr = /hdr|dolby|dv\b/i.test(q('.ihp-tags')?.textContent || ''); suggested = suggest(d.genres || [], hdr); paintStatic(); } catch {}
  }
  const savePicture = () => { try { localStorage.setItem('ihp.pic', JSON.stringify(Object.fromEntries(PICTURE.map(([k]) => [k, n(k)])))); } catch {} };
  const panelOpen = () => root.classList.contains('pn');
  function tab(name) {
    root.classList.add('pn'); wake();
    const i = Math.max(0, TABS.findIndex((t) => t[0] === name));
    q('.ind').style.transform = `translateX(${i * 100}%)`; q('.ihp-panel').dataset.t = name;
    if (name === 'pic') loadSuggestion();
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
    const tg = e.target.closest('[data-tg]');
    if (tg?.dataset.tg === 'amb') { setAmb(!ambOn, true); return; }
    if (tg) {
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
  trk.addEventListener('pointermove', (e) => { const r = ratioAt(e), t = r * n('duration'); tip.style.left = Math.min(Math.max(r * 100, 6), 94) + '%'; tip.textContent = tipText(t); if (dragging) { dragT = t; paintTime(dragT); const now = performance.now(); if (now - (window.__ihpScrubAt || 0) > 180) { window.__ihpScrubAt = now; cmd('seek', Math.max(0, t), 'absolute+keyframes'); } } }); // live preview while dragging: fast keyframe seeks; the exact seek happens on release
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
    if (e.altKey && (k.startsWith('Arrow') || ['Minus', 'Equal', 'Digit0'].includes(e.code))) {
      const st = 0.025 / 2 ** pframe.zoom; // the same distance on screen at any size
      ({ ArrowUp: () => moveFrame(0, -st), ArrowDown: () => moveFrame(0, st), ArrowLeft: () => moveFrame(-st, 0), ArrowRight: () => moveFrame(st, 0),
         Minus: () => sizeFrame(-0.06), Equal: () => sizeFrame(0.06), Digit0: () => setFrame({ zoom: 0, x: 0, y: 0 }) })[k.startsWith('Arrow') ? k : e.code]?.();
      e.preventDefault(); e.stopPropagation(); return;
    }
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
      case 'i': showPaused(true); break; // show the paused info card now
      case 'q': actions.close(); break;
      case 'I': markIntro(); break;
      case 'g': setAmb(!ambOn, true); break; // Shift+I: mark where this show's intro starts, then ends
      case 's': if (!doSkip()) used = false; break;
      case '?': toggleKeys(); break;
      case 'Escape': fsTrack(); if (keysEl) toggleKeys(); else if (panelOpen()) closePanel(); else if (root.classList.contains('pip')) actions.pip(); else if (fsNow()) actions.fs(); else if (performance.now() - fsAt > 900) actions.close(); break;
      default: used = false;
    }
    if (used) { e.preventDefault(); e.stopPropagation(); wake(); }
  }, true);

  // ---------- frame: shrink and move the picture inside the black screen ----------
  // For watching lying down with the laptop on your chest: raise and shrink the picture to where your eyes are,
  // everything else stays black. mpv does the work (video-zoom is a power of two, pan is a fraction of the picture).
  const FRAME_KEY = 'ihp.pframe';
  let pframe = (() => { try { return { zoom: 0, x: 0, y: 0, ...JSON.parse(localStorage.getItem(FRAME_KEY) || '{}') }; } catch { return { zoom: 0, x: 0, y: 0 }; } })();
  // pan is measured in picture sizes: a smaller picture needs a bigger number to reach the edge (mpv allows up to 3)
  const clampF = (f) => {
    const zoom = Math.max(-1.6, Math.min(0.6, +f.zoom || 0)), lim = Math.min(3, 0.6 + 0.6 / 2 ** zoom);
    return { zoom, x: Math.max(-lim, Math.min(lim, +f.x || 0)), y: Math.max(-lim, Math.min(lim, +f.y || 0)) };
  };
  // the frame counts only in ambient mode; off is plain full screen
  const eff = () => (ambOn ? pframe : { zoom: 0, x: 0, y: 0 });
  function applyFrame() { const f = eff(); set('video-zoom', f.zoom.toFixed(3)); set('video-pan-x', f.x.toFixed(3)); set('video-pan-y', f.y.toFixed(3)); }
  function setFrame(f, quiet = false) {
    if (!ambOn) setAmb(true, false); // placing the picture means you want ambient mode
    pframe = clampF(f); applyFrame(); drawAmb();
    const plain = !pframe.zoom && !pframe.x && !pframe.y;
    try { plain ? localStorage.removeItem(FRAME_KEY) : localStorage.setItem(FRAME_KEY, JSON.stringify(pframe)); } catch {}
    if (!quiet) hud(I.enter, plain ? 'Frame reset' : `Picture ${Math.round(2 ** pframe.zoom * 100)}%${pframe.y < -0.005 ? ' · raised' : pframe.y > 0.005 ? ' · lowered' : ''}`, Math.min(1, 2 ** pframe.zoom));
  }
  const moveFrame = (dx, dy) => setFrame({ ...pframe, x: pframe.x + dx, y: pframe.y + dy });
  const moveScreen = (dx, dy) => moveFrame(dx / 2 ** pframe.zoom, dy / 2 ** pframe.zoom); // buttons: a step of the screen, not the picture
  const sizeFrame = (dz) => setFrame({ ...pframe, zoom: pframe.zoom + dz });
  // Cinema: about 74% of the screen, raised to leave a row of seats beneath it; Lying down: smaller and raised
  const FRAMES = { cinema: { zoom: Math.log2(0.74), x: 0, y: -0.11 }, lying: { zoom: -0.35, x: 0, y: -0.1 }, reset: { zoom: 0, x: 0, y: 0 } };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-frame]'); if (!b) return;
    e.stopPropagation(); const f = b.dataset.frame;
    if (FRAMES[f]) setFrame(FRAMES[f]); else if (f === 'smaller') sizeFrame(-0.1); else if (f === 'bigger') sizeFrame(0.1); else if (f === 'up') moveScreen(0, -0.03); else if (f === 'down') moveScreen(0, 0.03);
  }, true);
  // Option+drag moves the picture, Option+scroll resizes it (trackpad-friendly when the keyboard is out of reach)
  root.addEventListener('pointerdown', (e) => {
    if (!e.altKey || e.button !== 0 || e.target.closest('.ihp-bottom, .ihp-panel, .ihp-top, button, input')) return;
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, f0 = { ...pframe }, scale = 2 ** pframe.zoom;
    const mv = (m) => setFrame({ ...f0, x: f0.x + (m.clientX - x0) / (innerWidth * scale), y: f0.y + (m.clientY - y0) / (innerHeight * scale) }, true);
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); setFrame(pframe); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }, true);
  root.addEventListener('wheel', (e) => { if (!e.altKey) return; e.preventDefault(); e.stopPropagation(); sizeFrame(e.deltaY > 0 ? -0.03 : 0.03); }, { capture: true, passive: false });

  // ---------- ambient light: the picture's colours glow into the black around it ----------
  // The native side samples only the picture's own rectangle (40x22, ~20 times a second). From that:
  //  - every point of the black around the picture takes the colour of the nearest point on the picture's edge, averaged
  //    over a band just inside the edge. Continuous around the corners, so there are no seams or strips.
  //  - brightness falls off with distance like light does (inverse square), and the colour spreads wider the further it
  //    travels (three blur levels along the edge, mixed by distance).
  //  - the light buffer is small (the GPU stretches it smoothly) and eases toward each new sample at display rate, faster
  //    on a scene cut. Moving or resizing the picture redraws it at once.
  //  - nothing runs when the picture fills the screen (there is no black to light).
  const ambCv = q('.ihp-amb'), ambCtx = ambCv.getContext('2d');
  let ambOn = (() => { try { return localStorage.getItem('ihp.amb') === '1'; } catch { return false; } })(); // the setting from the server replaces this when the player opens
  // your light settings (Picture panel), kept on this Mac
  const AMBS = (() => {
    try {
      const v = JSON.parse(localStorage.getItem('ihp.ambs') || '{}');
      if (localStorage.getItem('ihp.crowd_set') !== '1') v.crowd = 0;
      return { strength: 1, reach: 1, crowd: 0, ...v };
    } catch { return { strength: 1, reach: 1, crowd: 0 }; }
  })();
  function paintAmbSliders() {
    for (const k of ['strength', 'reach', 'crowd']) { const i = q(`[data-amb=${k}]`), o = q(`[data-ambo=${k}]`); if (i) i.value = AMBS[k]; if (o) o.textContent = Math.round(AMBS[k] * 100) + '%'; }
  }
  root.addEventListener('input', (e) => {
    const k = e.target.dataset?.amb; if (!k) return;
    AMBS[k] = +e.target.value;
    if (k === 'crowd') { try { localStorage.setItem('ihp.crowd_set', '1'); } catch {} }
    try { localStorage.setItem('ihp.ambs', JSON.stringify(AMBS)); } catch {}
    paintAmbSliders(); ambBuild(true); audKick(true);
  });
  const A = { dim: 1, src: null, sw: 0, sh: 0, tgt: null, cur: null, LW: 0, LH: 0, img: null, raf: 0, last: 0, cut: false, geo: null, bars: { t: 0, b: 0 }, barCount: {}, barScenes: {}, scene: 0, barSamples: 0, barLocked: false, hole: null, holeTgt: null };
  // a film whose bars we already know: crop from the first frame, nothing to measure
  function barsFromMemory() {
    if (A.barLocked) return;
    try { const v = parseFloat(localStorage.getItem('ihp.bars:' + (S['media-title'] || ''))); if (v >= 0 && v < 0.3) { A.bars = { t: v, b: v }; A.barLocked = true; ambBuild(true); } } catch {}
  }
  function paintAmbBtn() { q('[data-tg=amb]')?.classList.toggle('on', ambOn); }
  // where mpv draws the picture in the window: fitted, then scaled and moved by the frame setting
  function videoRect() {
    const W = innerWidth, H = innerHeight, ov = parseFloat(S['video-aspect-override']);
    const a = ov > 0 ? ov : n('video-params/aspect') || (n('width') && n('height') ? n('width') / n('height') : 16 / 9);
    let vw, vh; if (W / H > a) { vh = H; vw = H * a; } else { vw = W; vh = W / a; }
    const f = eff(), sc = 2 ** f.zoom; vw *= sc; vh *= sc;
    const cx = W / 2 + f.x * vw, cy = H / 2 + f.y * vh;
    return { x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh, W, H };
  }
  // the part of the picture that's on screen
  function visRect() {
    const r = videoRect(), x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(r.W, r.x + r.w), y1 = Math.min(r.H, r.y + r.h);
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0), W: r.W, H: r.H };
  }
  const ambActive = () => { const v = visRect(); return ambOn && !root.hidden && !root.classList.contains('pip') && v.w > 8 && v.h > 8 && (v.w < v.W - 4 || v.h < v.H - 4); };
  // tell the native side what to sample (and whether to sample at all)
  function ambSync() {
    const v = visRect(), on = ambActive();
    call('player_ambient', { on, rect: [v.x / v.W, v.y / v.H, v.w / v.W, v.h / v.H] });
    ambCv.hidden = !on; audKick(true);
    if (on) ambBuild(true); else { cancelAnimationFrame(A.raf); A.raf = 0; }
  }
  // ambient mode on or off: the frame and the light together. save = remember it (Settings → Playback → Ambient mode)
  setTimeout(paintAmbSliders, 0);
  function setAmb(on, say = false, save = true) {
    ambOn = on; try { localStorage.setItem('ihp.amb', on ? '1' : '0'); } catch {}
    if (!on) { A.src = null; A.cur = null; ambCtx.clearRect(0, 0, ambCv.width, ambCv.height); }
    applyFrame(); ambSync();
    if (save) fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playback: { ambientMode: on } }) }).catch(() => {});
    if (say) hud(I.sun, on ? 'Ambient mode on' : 'Ambient mode off · full screen');
    paintAmbBtn();
  }
  const blur1 = (arr, n, r) => { // box blur of an n-long RGB line, repeated twice (close to gaussian)
    let a = arr;
    for (let pass = 0; pass < 2; pass++) {
      const o = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { let r0 = 0, g0 = 0, b0 = 0, c = 0; for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) { r0 += a[j * 3]; g0 += a[j * 3 + 1]; b0 += a[j * 3 + 2]; c++; } o[i * 3] = r0 / c; o[i * 3 + 1] = g0 / c; o[i * 3 + 2] = b0 / c; }
      a = o;
    }
    return a;
  };
  // the light the picture throws, as a target buffer; instant = also jump the shown light there (geometry changed)
  function ambBuild(instant = false) {
    if (!A.src || !ambActive()) return;
    const v = visRect(), { sw, sh, src } = A, { W, H } = v;
    const at = (x, y) => (Math.min(sh - 1, Math.max(0, y)) * sw + Math.min(sw - 1, Math.max(0, x))) * 3;
    const rowLum = (y) => { let l = 0; for (let x = 0; x < sw; x++) { const i = at(x, y); l += src[i] + src[i + 1] + src[i + 2]; } return l / sw / 3; };
    // black bars inside the file are surroundings, not picture
    // letterbox bars inside the file (measured natively at 4x this height, kept steady): the light starts at the image
    // the whole video is the picture, bars and all: its edge colours come from just inside the image area though,
    // skipping rows that are black right across (so a letterboxed film still throws its colours, not black)
    const bt = A.bars.t, bb = A.bars.b;
    let t = Math.min(sh - 2, Math.ceil(bt * sh)), b = Math.max(t + 1, sh - 1 - Math.ceil(bb * sh));
    // edge colours come from the image, not from black rows (until the bars are known, skip rows that are black across)
    while (t < sh * 0.22 && rowLum(t) < 9) t++; while (b > sh * 0.78 && rowLum(b) < 9) b--;
    const ch = Math.max(1, b - t + 1), band = Math.max(1, Math.round(ch * 0.18)), bandX = Math.max(1, Math.round(sw * 0.12));
    // edge colours: each one an average of a band just inside that edge
    const line = (n, f) => { const o = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const c = f(i); o.set(c, i * 3); } return o; };
    const bandAvg = (xa, xb, ya, yb) => { let r0 = 0, g0 = 0, b0 = 0, c = 0; for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const i = at(x, y); r0 += src[i]; g0 += src[i + 1]; b0 += src[i + 2]; c++; } return [r0 / c, g0 / c, b0 / c]; };
    const edges = {
      top: line(sw, (x) => bandAvg(x, x, t, t + band - 1)), bottom: line(sw, (x) => bandAvg(x, x, b - band + 1, b)),
      left: line(ch, (y) => bandAvg(0, bandX - 1, t + y, t + y)), right: line(ch, (y) => bandAvg(sw - bandX, sw - 1, t + y, t + y)),
    };
    // three blur levels per edge: near the picture the light keeps its shape, far away it is a soft wash
    const lv = {}; for (const k of Object.keys(edges)) { const nn = edges[k].length / 3; lv[k] = [blur1(edges[k], nn, 1), blur1(edges[k], nn, Math.max(2, nn / 6 | 0)), blur1(edges[k], nn, Math.max(4, nn / 2 | 0))]; }
    const pick = (k, u, d) => { // colour of edge k at position u (0..1), at distance weight d (0 near .. 1 far)
      const L = lv[k], nn = L[0].length / 3, f = Math.min(nn - 1, Math.max(0, u * (nn - 1))), i0 = f | 0, i1 = Math.min(nn - 1, i0 + 1), fr = f - i0;
      const w2 = Math.min(1, d * 2), w3 = Math.max(0, d * 2 - 1), out = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const s0 = (L[0][i0 * 3 + c] * (1 - fr) + L[0][i1 * 3 + c] * fr), s1 = (L[1][i0 * 3 + c] * (1 - fr) + L[1][i1 * 3 + c] * fr), s2 = (L[2][i0 * 3 + c] * (1 - fr) + L[2][i1 * 3 + c] * fr);
        out[c] = (s0 * (1 - w2) + s1 * w2) * (1 - w3) + s2 * w3;
        out[c] = out[c] * (1 - 0.5 * w3) + avg[c] * 0.5 * w3; // far light drifts toward the whole scene's colour, so one dark edge never leaves a black wedge
      }
      return out;
    };
    // the picture's content rectangle on screen
    // the image without its bars (fixed once known). A bar's real edge falls part-way through a row of the 88-row
    // measurement, and that last, partly black row isn't counted -- so crop one more row's worth, or a hairline shows.
    const over = 1 / 88, ct = bt > 0 ? bt + over : 0, cb = bb > 0 ? bb + over : 0;
    const cx0 = v.x, cx1 = v.x + v.w, cy0 = v.y + v.h * ct, cy1 = v.y + v.h * (1 - cb);
    const LW = 160, LH = Math.max(1, Math.round(LW * H / W)), k = LW / W;
    if (A.LW !== LW || A.LH !== LH) { A.LW = LW; A.LH = LH; ambCv.width = LW; ambCv.height = LH; A.img = ambCtx.createImageData(LW, LH); A.cur = null; }
    const tgt = new Float32Array(LW * LH * 3);
    const M = Math.max(W, H), RE = AMBS.reach, D = Math.max(60, 0.1 * M * RE), far = 0.3 * M * RE, cutoff = 0.32 * M * RE; // how far the light carries (screen px)
    // auto-exposure: gently lifts medium-dim scenes without amplifying pure blacks; drops to 0 on black scenes
    let sceneL = 0, avg = [0, 0, 0]; for (let i = 0; i < src.length; i += 3) { sceneL += 0.2126 * src[i] + 0.7152 * src[i + 1] + 0.0722 * src[i + 2]; avg[0] += src[i]; avg[1] += src[i + 1]; avg[2] += src[i + 2]; }
    const npx = src.length / 3; sceneL /= npx; avg = avg.map((v) => v / npx);
    const darkCut = Math.min(1, Math.max(0, (sceneL - 1) / 3)); // 0 when sceneL <= 1, 1 when sceneL >= 4
    const expo = darkCut * Math.min(1.5, Math.max(1, 1 + (28 - sceneL) / 60)) * AMBS.strength;
    for (let py = 0; py < LH; py++) {
      const Y = (py + 0.5) / k;
      for (let px = 0; px < LW; px++) {
        const X = (px + 0.5) / k;
        const nx = Math.min(cx1, Math.max(cx0, X)), ny = Math.min(cy1, Math.max(cy0, Y)), dx = X - nx, dy = Y - ny;
        if (!dx && !dy) { // on the picture: only its rounded corners (and the soft edge) show this, at the edge's full colour
          const dl = X - cx0, dr = cx1 - X, dt2 = Y - cy0, db2 = cy1 - Y, m = Math.min(dl, dr, dt2, db2);
          const col = m === dt2 ? pick('top', (X - cx0) / Math.max(1, cx1 - cx0), 0) : m === db2 ? pick('bottom', (X - cx0) / Math.max(1, cx1 - cx0), 0) : m === dl ? pick('left', (Y - cy0) / Math.max(1, cy1 - cy0), 0) : pick('right', (Y - cy0) / Math.max(1, cy1 - cy0), 0);
          const o = (py * LW + px) * 3; tgt[o] = Math.min(255, col[0] * 1.1); tgt[o + 1] = Math.min(255, col[1] * 1.1); tgt[o + 2] = Math.min(255, col[2] * 1.1);
          continue;
        }
        const dist = Math.hypot(dx, dy), u = (nx - cx0) / Math.max(1, cx1 - cx0), vv = (ny - cy0) / Math.max(1, cy1 - cy0), dw = Math.min(1, dist / far);
        // which edge the light comes from; diagonal corners blend the two edges by angle
        let col;
        const ax = Math.abs(dx), ay = Math.abs(dy);
        if (ay && ax) {
          const a1 = pick(dy < 0 ? 'top' : 'bottom', u, dw), a2 = pick(dx < 0 ? 'left' : 'right', vv, dw), m = ax / (ax + ay);
          col = [a1[0] * (1 - m) + a2[0] * m, a1[1] * (1 - m) + a2[1] * m, a1[2] * (1 - m) + a2[2] * m];
        } else col = ay ? pick(dy < 0 ? 'top' : 'bottom', u, dw) : pick(dx < 0 ? 'left' : 'right', vv, dw);
        // inverse-square falloff, a touch of saturation (glows read richer than the source), gentle gain
        const fall = Math.exp(-dist / cutoff) / (1 + (dist / D) ** 2), lum = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2];
        const effLum = Math.max(0, lum - 1.8);
        const gain = effLum > 0 ? 1.1 * fall * expo * (effLum / Math.max(0.1, lum)) : 0;
        const o = (py * LW + px) * 3;
        for (let c = 0; c < 3; c++) tgt[o + c] = Math.min(255, Math.max(0, (lum + (col[c] - lum) * 1.3) * gain));
      }
    }
    A.tgt = tgt;
    if (!A.cur || instant) A.cur = new Float32Array(tgt);
    // cut the picture out of the light layer (the soft CSS blur would otherwise spill over its edges)
    A.holeTgt = { x0: cx0, y0: cy0, x1: cx1, y1: cy1, W, H };
    if (!A.hole || instant) A.hole = { ...A.holeTgt };
    clipHole();
    // (the cut-out itself is drawn by clipHole, eased)
    if (!A.raf) { A.last = performance.now(); A.raf = requestAnimationFrame(ambTick); }
  }
  // the picture's cut-out in the light layer: rounded, 1.5 px inside the picture so no black hairline shows at its edge
  function clipHole() {
    const h = A.hole; if (!h) return;
    const inset = 1.5, x0 = h.x0 + inset, y0 = h.y0 + inset, x1 = h.x1 - inset, y1 = h.y1 - inset;
    const R = Math.max(6, Math.min(22, 0.035 * Math.min(x1 - x0, y1 - y0))), f1 = (n) => n.toFixed(1);
    ambCv.style.clipPath = `path(evenodd, 'M0 0H${h.W}V${h.H}H0Z M${f1(x0 + R)} ${f1(y0)}H${f1(x1 - R)}A${R} ${R} 0 0 1 ${f1(x1)} ${f1(y0 + R)}V${f1(y1 - R)}A${R} ${R} 0 0 1 ${f1(x1 - R)} ${f1(y1)}H${f1(x0 + R)}A${R} ${R} 0 0 1 ${f1(x0)} ${f1(y1 - R)}V${f1(y0 + R)}A${R} ${R} 0 0 1 ${f1(x0 + R)} ${f1(y0)}Z')`;
  }
  // ease the shown light toward the target at display rate: smooth between samples, quick on a cut
  function ambTick(now) {
    A.raf = 0;
    if (!A.tgt || !A.cur || !ambActive()) return;
    const dt = Math.min(0.1, (now - A.last) / 1000); A.last = now;
    const kk = 1 - Math.exp(-dt / (A.cut ? 0.05 : 0.16));
    const { cur, tgt, img } = A, d = img.data; let moving = 0;
    const dimTo = b('pause') ? 0.4 : 1; A.dim += (dimTo - A.dim) * (1 - Math.exp(-dt / 0.6)); const dm = A.dim;
    for (let i = 0, j = 0; i < cur.length; i += 3, j += 4) {
      const r0 = cur[i] += (tgt[i] - cur[i]) * kk, g0 = cur[i + 1] += (tgt[i + 1] - cur[i + 1]) * kk, b0 = cur[i + 2] += (tgt[i + 2] - cur[i + 2]) * kk;
      moving = Math.max(moving, Math.abs(tgt[i] - r0), Math.abs(tgt[i + 1] - g0), Math.abs(tgt[i + 2] - b0));
      d[j] = r0 * dm; d[j + 1] = g0 * dm; d[j + 2] = b0 * dm; d[j + 3] = 255;
    }
    ambCtx.putImageData(img, 0, 0);
    // the cut-out glides to a new size or place (e.g. once the bars are known) instead of jumping
    let holeMoving = 0;
    if (A.hole && A.holeTgt) {
      const hk = 1 - Math.exp(-dt / 0.14);
      for (const key of ['x0', 'y0', 'x1', 'y1']) { const d0 = A.holeTgt[key] - A.hole[key]; A.hole[key] += d0 * hk; holeMoving = Math.max(holeMoving, Math.abs(d0)); }
      A.hole.W = A.holeTgt.W; A.hole.H = A.holeTgt.H; clipHole();
    }
    if (moving > 0.6 || holeMoving > 0.3 || Math.abs(dimTo - A.dim) > 0.01) A.raf = requestAnimationFrame(ambTick); else A.cut = false;
  }

  // ---------- the audience: silhouettes in the dark below the picture, lit by the screen ----------
  // Three rows of seats seen from behind (far row small and hazy, near row big and nearly black). Their outlines catch the
  // colour of the film as it changes; pausing brings the house lights up (warm, everyone visible). Drawn only in the space
  // the picture leaves free, ~20 fps while playing, and not at all once the lights have settled on a pause.
  const audCv = q('.ihp-aud'), audCtx = audCv.getContext('2d');
  const AUD = { raf: 0, last: 0, col: [70, 70, 80], tgt: [70, 70, 80], house: 0, key: '', people: null, G: 0, colAt: 0, ev: null, evAt: 0 };
  const audGap = () => { const v = visRect(); return Math.max(0, v.H - (v.y + v.h)); };
  const audActive = () => ambActive() && AMBS.crowd > 0.02 && audGap() >= 0.07 * innerHeight;
  function audLayout(W, G) {
    let s = 20260511; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const u = G / 6.6, rows = [];
    // far -> near: scale, where the seat-back top sits (fraction of the free height), haze (how much screen light veils it)
    [[0.5, 0.34, 0.2], [0.72, 0.62, 0.1], [1, 0.98, 0]].forEach(([sc, yb, hz], ri) => {
      const r = u * sc, step = r * 3.1, ppl = []; let x = -step * (0.2 + 0.5 * ri) + rnd() * step * 0.3;
      for (; x < W + step; x += step * (0.92 + rnd() * 0.2)) {
        if (rnd() < 0.1) continue; // an empty seat
        ppl.push({ x, r: r * (0.9 + rnd() * 0.2), up: r * (rnd() * 0.3 - 0.1), bun: rnd() < 0.12, ph: rnd() * 6.28, sw: 0.02 + rnd() * 0.035 });
      }
      rows.push({ sc, yb: yb * G, hz, ppl, r });
    });
    return rows;
  }
  function audDraw(now) {
    const v = visRect(), W = v.W, G = Math.round(audGap()), sc = 0.75, t = now / 1000;
    const key = W + '|' + G; if (key !== AUD.key) { AUD.key = key; AUD.people = audLayout(W, G); AUD.G = G; audCv.width = Math.round(W * sc); audCv.height = Math.max(1, Math.round(G * sc)); audCv.style.height = G + 'px'; }
    const g = audCtx, h = AUD.house, [cr, cg, cb] = AUD.col;
    g.setTransform(sc, 0, 0, sc, 0, 0); g.clearRect(0, 0, W, G);
    // an idle moment now and then: one person leans toward their neighbour and back
    if (!AUD.ev || t > AUD.evAt + AUD.ev.dur) { const row = AUD.people[(Math.random() * 3) | 0], i = (Math.random() * row.ppl.length) | 0; AUD.ev = { row, i, dur: 2.2, amp: (Math.random() < 0.5 ? -1 : 1) * 0.5 }; AUD.evAt = t + 4 + Math.random() * 9; }
    const evk = t > AUD.evAt ? Math.sin(Math.min(1, (t - AUD.evAt) / AUD.ev.dur) * Math.PI) : 0;
    const lift = (c) => Math.min(255, c * 1.5 + 22);
    AUD.people.forEach((row, ri) => {
      // lit side: screen colour when dark, warm white when the house lights are up
      const rim = [lift(cr) * (1 - h) + 255 * h, lift(cg) * (1 - h) + 196 * h, lift(cb) * (1 - h) + 140 * h];
      const ra = (0.62 - ri * 0.2) * (1 - h) + (0.5 - ri * 0.08) * h;
      const fill = [4 + cr * row.hz * 0.35 + 30 * h, 4 + cg * row.hz * 0.35 + 24 * h, 6 + cb * row.hz * 0.35 + 22 * h].map((c) => Math.round(Math.min(90, c)));
      const rimS = `rgba(${rim.map(Math.round)},${ra.toFixed(3)})`, fillS = `rgb(${fill})`, lw = 1.2 + ri * 0.6;
      for (let i = 0; i < row.ppl.length; i++) {
        const p = row.ppl[i], r = p.r, yb = row.yb;
        const lean = (row === AUD.ev?.row && i === AUD.ev.i ? AUD.ev.amp * r * evk : 0) + Math.sin(t * 0.35 + p.ph) * p.sw * r * 6;
        const tilt = Math.sin(t * 0.27 + p.ph * 1.7) * p.sw * 2 + lean / r * 0.12;
        const hx = p.x + lean, hy = yb - r * 2.25 - p.up;
        const body = () => { g.beginPath(); g.moveTo(p.x - r * 2.2, yb + r); g.bezierCurveTo(p.x - r * 2.2, yb - r * 0.4, p.x - r * 1.35, yb - r * 1.3, p.x - r * 0.5 + lean * 0.4, yb - r * 1.55); g.lineTo(p.x + r * 0.5 + lean * 0.4, yb - r * 1.55); g.bezierCurveTo(p.x + r * 1.35, yb - r * 1.3, p.x + r * 2.2, yb - r * 0.4, p.x + r * 2.2, yb + r); g.closePath(); };
        const head = () => { g.beginPath(); g.ellipse(hx, hy, r * 0.92, r * 1.05, tilt, 0, 6.2832); if (p.bun) g.arc(hx - r * 0.1, hy - r * 1.15, r * 0.4, 0, 6.2832); };
        // rim: the same shape nudged up behind itself, then the dark shape over it
        g.fillStyle = rimS; g.save(); g.translate(0, -lw); body(); g.fill(); head(); g.fill(); g.restore();
        g.fillStyle = fillS; body(); g.fill(); head(); g.fill();
      }
      // the seat-back in front of this row's shoulders
      const top = row.yb - row.r * 1.05;
      g.fillStyle = rimS; g.fillRect(0, top - lw, W, lw + 0.5);
      g.fillStyle = `rgb(${fill.map((c) => Math.round(c * 0.8))})`; g.fillRect(0, top, W, G - top + 4);
    });
    audCv.style.opacity = Math.min(1, AMBS.crowd);
  }
  function audTick(now) {
    AUD.raf = 0;
    if (!audActive()) { audCv.hidden = true; return; }
    if (now - AUD.last < 48) { AUD.raf = requestAnimationFrame(audTick); return; }
    const dt = Math.min(0.2, (now - (AUD.last || now - 50)) / 1000); AUD.last = now;
    audCv.hidden = false;
    // the film's colour: the bottom of the picture (nearest the seats) mixed with the whole scene
    if (A.src && now - AUD.colAt > 250) {
      AUD.colAt = now; const { src, sw, sh } = A, rows = Math.max(2, (sh * 0.15) | 0); let bt = [0, 0, 0], all = [0, 0, 0];
      for (let i = 0; i < src.length; i += 3) { const y = ((i / 3) / sw) | 0; for (let c = 0; c < 3; c++) { all[c] += src[i + c]; if (y >= sh - rows) bt[c] += src[i + c]; } }
      const na = src.length / 3, nb = rows * sw;
      AUD.tgt = [0, 1, 2].map((c) => (bt[c] / nb) * 0.6 + (all[c] / na) * 0.4);
    }
    const k = 1 - Math.exp(-dt / 0.6); let d = 0;
    for (let c = 0; c < 3; c++) { AUD.col[c] += (AUD.tgt[c] - AUD.col[c]) * k; d = Math.max(d, Math.abs(AUD.tgt[c] - AUD.col[c])); }
    const hT = b('pause') ? 1 : 0, hOld = AUD.house; AUD.house += (hT - AUD.house) * (1 - Math.exp(-dt / 0.7));
    audDraw(now);
    if (!(hT === 1 && Math.abs(1 - AUD.house) < 0.01 && d < 1 && Math.abs(AUD.house - hOld) < 0.002)) AUD.raf = requestAnimationFrame(audTick); // settled on a pause: stop drawing
  }
  function audKick(relayout = false) { if (relayout) AUD.key = ''; if (!audActive()) { audCv.hidden = true; return; } if (!AUD.raf) { AUD.last = 0; AUD.raf = requestAnimationFrame(audTick); } }
  const drawAmb = () => ambSync(); // geometry changed (frame, full screen, window size)
  addEventListener('resize', () => ambSync());

  // ---------- ? : every key the player knows ----------
  const KEYS = [['Space / K', 'Play or pause'], ['← →', 'Back / forward 10 s'], ['↑ ↓', 'Volume'], ['M', 'Mute'], ['F', 'Full screen'], ['W', 'Picture in picture'],
    ['[ ]', 'Slower / faster'], ['C', 'Subtitles'], ['A', 'Audio'], ['P', 'Picture settings'], ['H', 'Chapters'], ['I', 'What you are watching'],
    ['S', 'Skip intro, recap or credits'], ['Option+arrows', 'Move the picture'], ['Option+− / =', 'Picture smaller / bigger'], ['Option+0', 'Picture back to full'], ['G', 'Ambient mode on or off'], ['Shift+I', 'Mark where the intro starts, then ends'], ['Alt+Z', 'Reset audio delay'], ['Q', 'Close the player'], ['Esc', 'Back out: panel, full screen, player'], ['?', 'This list']];
  let keysEl = null;
  function toggleKeys() {
    if (keysEl) { keysEl.remove(); keysEl = null; return; }
    keysEl = document.createElement('div'); keysEl.className = 'ihp-keys'; keysEl.setAttribute('role', 'dialog'); keysEl.setAttribute('aria-label', 'Player keys');
    keysEl.innerHTML = `<h4>Keys</h4><dl>${KEYS.map(([k, v]) => `<dt>${k.split(' ').map((x) => (x === '/' ? ' / ' : `<kbd>${esc(x)}</kbd>`)).join('')}</dt><dd>${esc(v)}</dd>`).join('')}</dl><small>Press ? or Esc to close</small>`;
    keysEl.onclick = () => toggleKeys();
    root.append(keysEl);
  }

  // ---------- skip intro / recap / credits ----------
  // From the file's chapters when they are named (Intro, Opening, Recap, Credits…), else the intro you marked for this show:
  // Shift+I where it starts, Shift+I again where it ends. Every episode of the show then offers "Skip intro" there.
  const skipBtn = document.createElement('button'); skipBtn.className = 'ihp-skipbtn'; skipBtn.hidden = true; skipBtn.title = 'Skip (S)';
  root.append(skipBtn);
  let intro = null, autoSkip = false, skipped = new Set(), skipNow = null, markStart = null;
  async function loadIntro() {
    intro = null; skipped = new Set(); markStart = null; skipBtn.hidden = true;
    try { intro = (await (await fetch('/api/intro/now')).json()).intro; } catch {}
    try {
      const pb = (await (await fetch('/api/settings')).json()).playback || {};
      autoSkip = !!pb.autoSkipIntro;
      if (!!pb.ambientMode !== ambOn) setAmb(!!pb.ambientMode, false, false);
    } catch {}
  }
  const KINDS = [[/\b(intro|opening|op|title sequence|main titles?)\b/i, 'Skip intro'], [/\b(recap|previously)\b/i, 'Skip recap'], [/\b(credits|ending|outro|end titles)\b/i, 'Skip credits']];
  function skipWindow(pos) {
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i], kind = KINDS.find(([re]) => re.test(c.title || ''));
      if (!kind) continue;
      const end = chapters[i + 1]?.time ?? n('duration');
      if (end - c.time > 900) continue; // a 15-minute "intro" chapter is a mislabel, not an intro
      if (pos >= c.time && pos < end - 1) return { label: kind[1], to: end, key: 'c' + c.time, credits: kind[1] === 'Skip credits' };
    }
    if (intro && pos >= intro.start && pos < intro.end - 1) return { label: 'Skip intro', to: intro.end, key: 'mark' };
    return null;
  }
  function paintSkip(pos) {
    const w = skipWindow(pos); skipNow = w;
    if (!w || dragging) { if (!skipBtn.hidden) skipBtn.hidden = true; return; }
    // credits are never skipped by themselves: that is where "Up next" takes over
    if (autoSkip && !w.credits && !skipped.has(w.key)) { skipped.add(w.key); seekTo(w.to); hud(I.f10, w.label.replace('Skip', 'Skipped')); return; }
    if (skipBtn.hidden || skipBtn.textContent !== w.label) { skipBtn.textContent = w.label; skipBtn.hidden = false; }
  }
  const doSkip = () => { if (!skipNow) return false; skipped.add(skipNow.key); seekTo(skipNow.to); skipBtn.hidden = true; return true; };
  skipBtn.addEventListener('click', (e) => { e.stopPropagation(); doSkip(); });
  async function markIntro() {
    const pos = n('time-pos'); if (!(pos >= 0)) return;
    if (markStart == null || pos <= markStart || pos - markStart > 600) { markStart = pos; hud(I.info, `Intro starts at ${fmt(pos)}. Press Shift+I again where it ends`); return; }
    try {
      const r = await fetch('/api/intro/now', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: markStart, end: pos }) });
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not save');
      intro = d.intro; skipped.add('mark'); markStart = null;
      hud(I.check, `Saved: every episode offers Skip intro from ${fmt(intro.start)} to ${fmt(intro.end)}`);
    } catch (e) { hud(I.info, e.message || 'Could not save'); }
  }

  // ---------- called by the native side ----------
  window.__ihp = {
    stats: () => S, // the frame-rate overlay (fps.js) reads the video numbers from here
    open() {
      Object.keys(S).forEach((k) => delete S[k]); lastTracks = ''; infoState = ''; q('[data-info]').innerHTML = '<div class="empty">Loading…</div>';
      document.body.append(root); root.hidden = false; root.classList.remove('pn');
      tab('pic'); root.classList.remove('pn');
      document.documentElement.classList.add('ihp-on'); playing = true; wake(); requestAnimationFrame(frame);
      loadIntro();
      setAmb(ambOn); // tells the native side whether to send colours
      try { const p = JSON.parse(localStorage.getItem('ihp.pic') || 'null'); if (p) setTimeout(() => applyPicture(p), 500); } catch {}
      try { const sh = localStorage.getItem('ihp.shader'); setTimeout(() => applyShader(SHADERS[sh] ? sh : 'Off', true), 700); } catch {}
      // the way you left it: full screen if you were watching full screen
      try { if (localStorage.getItem('ihp.fs') === '1' && !fsNow()) setTimeout(() => { if (!fsNow()) call('player_fullscreen'); }, 350); } catch {}
      // a series: "Black Doves · S1 E2 · The Episode Name" instead of the file's "Black Doves S01E02"
      window.__ihpEpTitle = '';
      setTimeout(() => fetch('/api/info/now').then((r) => r.json()).then((d) => { const e = d?.episode; if (e && d.title) window.__ihpEpTitle = `${d.title} · S${e.season} E${e.episode}${e.name && !/^Episode \d+$/.test(e.name) ? ' · ' + e.name : ''}`; }).catch(() => {}), 1500);
      A.barCount = {}; A.barScenes = {}; A.scene = 0; A.barSamples = 0; A.barLocked = false; A.bars = { t: 0, b: 0 }; A.hole = null;
      setTimeout(applyFrame, 600); // ambient mode: the frame you set last time (e.g. for lying down); off: plain full screen
    },
    pip(on) { root.classList.toggle('pip', !!on); setTimeout(ambSync, 50); if (on) { closePanel(); root.classList.remove('ch-open'); } wake(); },
    close(error) {
      root.classList.remove('pip'); playing = false; root.hidden = true; document.documentElement.classList.remove('ihp-on'); root.classList.remove('pn', 'ui');
      keysEl?.remove(); keysEl = null;
      A.src = null; A.cur = null; A.tgt = null; cancelAnimationFrame(A.raf); A.raf = 0; ambCtx.clearRect(0, 0, ambCv.width, ambCv.height); cancelAnimationFrame(AUD.raf); AUD.raf = 0; audCv.hidden = true; call('player_ambient', { on: false });
      if (error) import('/js/ui.js').then(({ toast }) => toast?.(error, 'err')).catch(() => {});
      // finished an episode? offer the next one (the daemon saves the position a moment after the player closes)
      else for (const ms of [1500, 4000]) setTimeout(() => import('/js/nextup.js').then((m) => m.offerAfterMpv()).catch(() => {}), ms);
    },
    fs(on) {
      window.__ihFs = !!on; fsTrack(); drawAmb();
      if (playing) try { localStorage.setItem('ihp.fs', on ? '1' : '0'); } catch {} // so a resume (or a restart) opens the same way
    },
    amb(hex, w, h, bt = 0, bb = 0) {
      if (!ambOn) return;
      // Letterbox bars are decided once per film, then never change while it plays:
      //  - measured at the top only (subtitles live at the bottom), in rows of 88, on bright frames, and only while the
      //    whole picture is on screen (pushed partly off-screen it would read short);
      //  - a real bar is the same size frame after frame; a dark scene gives bigger, varying readings. So the bar is the
      //    smallest size seen at least 10 times -- a one-off reading never counts;
      //  - it's applied once (one smooth glide) and remembered for the film, so a resume starts cropped with no change.
      if (!A.barLocked) {
        let l = 0; const nn = Math.min(hex.length / 2, w * h * 3); for (let i = 0; i < nn; i += 7) l += parseInt(hex.substr(i * 2, 2), 16);
        const r = videoRect(), whole = r.x >= -1 && r.y >= -1 && r.x + r.w <= r.W + 1 && r.y + r.h <= r.H + 1;
        if (whole && l / (nn / 7) > 18) {
          // ...and in at least 3 different scenes, so one long static shot (a dark opening) can't decide it
          const row = Math.round(bt * 88); A.barCount[row] = (A.barCount[row] || 0) + 1; A.barSamples++;
          (A.barScenes[row] ||= new Set()).add(A.scene);
          const seen = Object.keys(A.barCount).map(Number).filter((k) => A.barCount[k] >= 10 && A.barScenes[k].size >= 3).sort((p, q) => p - q);
          if (seen.length && A.barSamples >= 30) {
            const v = seen[0] / 88; A.barLocked = true; A.bars = { t: v, b: v };
            try { localStorage.setItem('ihp.bars:' + (S['media-title'] || ''), String(v)); } catch {}
          }
        }
      }
      const n3 = w * h * 3, src = new Float32Array(n3);
      for (let i = 0; i < n3; i++) src[i] = parseInt(hex.substr(i * 2, 2), 16);
      // a scene cut: the whole picture changed, so the light should follow quickly instead of easing
      if (A.src && A.src.length === n3) { let d = 0; for (let i = 0; i < n3; i++) d += Math.abs(src[i] - A.src[i]); if (d / n3 > 28) { A.cut = true; A.scene++; } }
      A.src = src; A.sw = w; A.sh = h;
      ambBuild();
    },
    state(s) {
      const geo = 'video-params/aspect' in s || 'width' in s || 'height' in s || 'video-aspect-override' in s;
      if ('media-title' in s) setTimeout(barsFromMemory, 0);
      if ('pause' in s && A.cur && !A.raf && ambActive()) { A.last = performance.now(); A.raf = requestAnimationFrame(ambTick); } // ease the light down or back up
      Object.assign(S, s);
      lastPos = n('time-pos'); lastAt = performance.now();
      if (geo) ambSync(); // the picture's real shape just arrived: sample the right rectangle
      if (S['track-list']) paintTracks(S['track-list'], S['chapter-list'] || []);
      q('.trk .buf').style.transform = `scaleX(${n('duration') > 0 ? Math.min(1, n('demuxer-cache-time') / n('duration')) : 0})`;
      paintStatic();
    },
  };
})();
