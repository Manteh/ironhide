// Frame-rate overlay: Cmd+Shift+F (View > Show Frame Rate in the Mac app). Measures the page's own frames with
// requestAnimationFrame: fps now, the 1% low, the slowest frame and the stutters (frames that took more than 1.5x the
// display's frame time), with a graph of the last ~2 seconds. While the in-app player is open it adds the video's numbers
// from mpv: the film's frame rate, the display rate mpv sees and the frames it dropped.
// Costs nothing while hidden: no frame loop runs.

const KEY = 'ih-fps';
let hud = null, raf = 0, last = 0, refresh = 0;
const times = []; // recent frame durations (ms)
const stutters = []; // timestamps of slow frames
let shown = 0, frames = 0, winStart = 0, fpsNow = 0;

function build() {
  hud = document.createElement('div');
  hud.id = 'ihfps';
  hud.innerHTML = `<style>
    #ihfps{position:fixed;top:44px;right:14px;z-index:2147483647;width:236px;padding:10px 12px 9px;border-radius:12px;background:rgba(10,10,14,.86);
      border:1px solid rgba(255,255,255,.1);box-shadow:0 10px 30px -8px rgba(0,0,0,.7);color:#e8e8ee;font:11.5px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;
      pointer-events:none;-webkit-user-select:none;user-select:none;contain:layout paint}
    #ihfps .big{display:flex;align-items:baseline;gap:6px;margin-bottom:4px}
    #ihfps .big b{font-size:26px;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
    #ihfps .big span{color:#8b8b98}
    #ihfps canvas{display:block;width:212px;height:44px;margin:4px 0 6px;border-radius:6px;background:rgba(255,255,255,.04)}
    #ihfps .row{display:flex;justify-content:space-between;font-variant-numeric:tabular-nums}
    #ihfps .row span{color:#8b8b98}
    #ihfps .sec{margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.08)}
    #ihfps .ok{color:#7ee2a8} #ihfps .meh{color:#ffd166} #ihfps .bad{color:#ff7a70}
    #ihfps small{display:block;margin-top:6px;color:#6b6b78;font-size:10px}
  </style>
  <div class="big"><b id="fpsN">–</b><span>fps · UI</span></div>
  <canvas id="fpsG" width="424" height="88"></canvas>
  <div class="row"><span>Frame clock</span><i id="fpsR">–</i></div>
  <div class="row"><span>1% low</span><i id="fpsL">–</i></div>
  <div class="row"><span>Slowest frame</span><i id="fpsW">–</i></div>
  <div class="row"><span>Stutters (10 s)</span><i id="fpsJ">–</i></div>
  <div class="row"><span>Elements on page</span><i id="fpsD">–</i></div>
  <div class="sec" id="fpsV" hidden>
    <div class="row"><span>Video</span><i id="fpsVf">–</i></div>
    <div class="row"><span>Display (mpv)</span><i id="fpsVd">–</i></div>
    <div class="row"><span>Dropped (dec / vo)</span><i id="fpsVx">–</i></div>
    <div class="row"><span>Decoder</span><i id="fpsVh">–</i></div>
  </div>
  <small>Cmd+Shift+F to hide</small>`;
  document.body.appendChild(hud);
}

const $ = (id) => hud.querySelector('#' + id);
const tone = (fps, target) => (fps >= target * 0.92 ? 'ok' : fps >= target * 0.7 ? 'meh' : 'bad');
const set = (id, text, cls) => { const e = $(id); if (e.textContent !== text) e.textContent = text; if (cls !== undefined) e.className = cls; };

function tick(now) {
  raf = requestAnimationFrame(tick);
  if (last) {
    const dt = now - last;
    if (dt < 1000) { // a hidden window pauses the loop; don't count the gap
      times.push(dt); if (times.length > 240) times.shift();
      // the display's frame time: the typical short frame (60 Hz = 16.7 ms, 120 Hz = 8.3 ms)
      if (times.length >= 30 && (!refresh || frames % 60 === 0)) { const s = [...times].sort((a, b) => a - b); refresh = s[Math.floor(s.length * 0.2)]; }
      if (refresh && dt > refresh * 1.5) stutters.push(now);
    }
  }
  last = now; frames++;
  if (now - winStart >= 500) { fpsNow = (frames - shown) * 1000 / (now - winStart); shown = frames; winStart = now; paint(now); }
  draw();
}

function paint(now) {
  while (stutters.length && now - stutters[0] > 10000) stutters.shift();
  const RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];
  const hz = refresh ? RATES.reduce((a, b) => (Math.abs(b - 1000 / refresh) < Math.abs(a - 1000 / refresh) ? b : a)) : 0;
  const target = hz || 60;
  set('fpsN', String(Math.round(fpsNow)), tone(fpsNow, target));
  set('fpsR', hz ? `${hz} Hz` : '–');
  if (times.length > 20) {
    const s = [...times].sort((a, b) => b - a), worst = s[0], p1 = s[Math.max(0, Math.floor(s.length / 100))];
    const low = 1000 / p1;
    set('fpsL', `${Math.round(low)} fps`, tone(low, target));
    set('fpsW', `${worst.toFixed(1)} ms`, worst > (refresh || 16.7) * 3 ? 'bad' : worst > (refresh || 16.7) * 1.5 ? 'meh' : 'ok');
  }
  set('fpsJ', String(stutters.length), stutters.length > 10 ? 'bad' : stutters.length > 2 ? 'meh' : 'ok');
  if (frames % 4 === 0) set('fpsD', document.getElementsByTagName('*').length.toLocaleString());
  // the in-app player's numbers from mpv
  const v = document.documentElement.classList.contains('ihp-on') && window.__ihp?.stats?.();
  $('fpsV').hidden = !v;
  if (v) {
    const n = (x) => (x == null || x === '' ? null : Number(x));
    const vf = n(v['container-fps']), df = n(v['display-fps']);
    set('fpsVf', vf ? `${vf.toFixed(2)} fps` : '–');
    set('fpsVd', df ? `${df.toFixed(1)} Hz` : '–');
    const dd = n(v['decoder-frame-drop-count']) || 0, vd = n(v['frame-drop-count']) || 0;
    set('fpsVx', `${dd} / ${vd}`, dd + vd > 0 ? 'meh' : 'ok');
    set('fpsVh', v['hwdec-current'] && v['hwdec-current'] !== 'no' ? `hardware (${v['hwdec-current']})` : 'software');
  }
}

// frame times as bars; the line is the display's frame time, bars above it are late frames
function draw() {
  const c = $('fpsG'), g = c.getContext('2d'), W = c.width, H = c.height, max = Math.max(34, (refresh || 16.7) * 3);
  g.clearRect(0, 0, W, H);
  const n = Math.min(times.length, 106), bw = W / 106, ref = refresh || 16.7;
  for (let i = 0; i < n; i++) {
    const t = times[times.length - n + i], h = Math.min(H, (t / max) * H);
    g.fillStyle = t > ref * 2 ? '#ff7a70' : t > ref * 1.5 ? '#ffd166' : 'rgba(126,226,168,.75)';
    g.fillRect(i * bw, H - h, Math.max(1, bw - 1), h);
  }
  const y = H - (ref / max) * H;
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, y, W, 1);
}

function show(on) {
  if (on) {
    if (!hud) build();
    hud.hidden = false; times.length = 0; stutters.length = 0; last = 0; frames = shown = 0; winStart = performance.now(); refresh = 0;
    if (!raf) raf = requestAnimationFrame(tick);
  } else {
    if (hud) hud.hidden = true;
    cancelAnimationFrame(raf); raf = 0;
  }
  try { localStorage.setItem(KEY, on ? '1' : ''); } catch {}
}

const toggle = () => show(!hud || hud.hidden);
window.__ihFps = toggle;
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggle(); }
});
try { if (localStorage.getItem(KEY)) show(true); } catch {}
