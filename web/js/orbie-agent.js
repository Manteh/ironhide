// "Ask Orbie": click the orb in the top bar, say (or type) what you want, and Orbie drives the app: it puts a live shelf on screen,
// points at titles, opens pages and trailers, plays, and answers out loud while the orb moves with its voice.
//   listening  - the mic, with a quiet detector for when you stop talking (the audio goes to /api/agent/stt as a small WAV)
//   thinking   - /api/agent streams lines: say (spoken, sentence by sentence), act (done on screen), done
//   speaking   - the voice comes from /api/agent/tts; its sound goes through an analyser that drives the orb
// While Orbie is acting on the screen the window gets a soft moving light along its edge.
import { FS } from './orb-shader.js';
import { api } from './api.js';
import { esc } from './ui.js';

let ag = null; // the open session
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x)), lerp = (a, b, k) => a + (b - a) * k;
const REGION = () => (navigator.language || 'en-US').split('-')[1]?.toUpperCase() || 'US';
const invoke = (c, a = {}) => window.__TAURI_INTERNALS__?.invoke?.(c, a);

// ---------- small sounds (WebAudio, no files) ----------
let actx = null;
const audio = () => { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; };
function chime(kind) {
  try { if (localStorage.getItem('orbie.sounds') === '0') return; } catch {}
  const c = audio(), t0 = c.currentTime + 0.01, out = c.createGain(); out.gain.value = 0.5; out.connect(c.destination);
  const tone = (at, f0, f1, dur, vol) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t0 + at); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + at + dur); g.gain.setValueAtTime(0.0001, t0 + at); g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur); o.connect(g); g.connect(out); o.start(t0 + at); o.stop(t0 + at + dur + 0.05); };
  if (kind === 'open') { tone(0, 392, 784, 0.55, 0.16); tone(0.02, 395, 790, 0.55, 0.08); tone(0.16, 988, 988, 0.5, 0.09); tone(0.3, 1319, 1319, 0.6, 0.07); }
  else if (kind === 'heard') { tone(0, 660, 880, 0.14, 0.12); }
  else if (kind === 'close') { tone(0, 784, 330, 0.4, 0.12); tone(0.05, 523, 262, 0.45, 0.07); }
  else if (kind === 'act') { tone(0, 1175, 1175, 0.12, 0.05); }
}

// Where does each word start? Read from the sentence's own audio: the voice's first sound and last sound are found, the pauses inside it are matched to the commas and full stops,
// and the time between pauses is shared out by how long each word takes to say (syllables). That is accurate to about a tenth of a second, whichever voice is used.
function alignWords(pcm, words) {
  const win = 240, n = Math.floor(pcm.length / win); if (n < 8 || !words.length) return null;
  const env = new Float32Array(n); let peak = 0;
  for (let i = 0; i < n; i++) { let t = 0; for (let j = 0; j < win; j++) { const v = pcm[i * win + j]; t += v * v; } env[i] = Math.sqrt(t / win); if (env[i] > peak) peak = env[i]; }
  const thr = Math.max(0.005, peak * 0.05);
  let a = 0; while (a < n && env[a] < thr) a++; let b = n - 1; while (b > a && env[b] < thr) b--; if (b - a < 4) return null;
  const onset = a * 0.01, offset = (b + 1) * 0.01, gaps = [];
  for (let i = a; i <= b;) { if (env[i] < thr) { let j = i; while (j <= b && env[j] < thr) j++; if (j - i >= 11) gaps.push({ s: i * 0.01, e: j * 0.01, d: (j - i) * 0.01 }); i = j; } else i++; }
  const syl = (w) => { const v = (w.toLowerCase().match(/[aeiouy]+/g) || []).length, d = (w.match(/\d/g) || []).length; return Math.max(1, v + d * 1.3 + (/\d\.\d/.test(w) ? 1 : 0)); };
  const wt = words.map(syl);
  const strength = (w) => (/[.!?]$/.test(w) ? 3 : /[:;\u2014\u2013]$/.test(w) ? 2 : /,$/.test(w) ? 1 : 0);
  const breaks = []; words.forEach((w, i) => { if (i < words.length - 1 && strength(w)) breaks.push({ i, st: strength(w) }); });
  const use = gaps.slice().sort((x, y) => y.d - x.d).slice(0, breaks.length).sort((x, y) => x.s - y.s);   // the longest pauses, in time order
  const chosen = breaks.slice().sort((x, y) => y.st - x.st || x.i - y.i).slice(0, use.length).sort((x, y) => x.i - y.i); // the strongest punctuation gets them
  const times = new Array(words.length); let wi = 0, t0 = onset;
  const share = (from, to, t1, t2) => { let tot = 0; for (let k = from; k < to; k++) tot += wt[k]; let acc = 0; for (let k = from; k < to; k++) { times[k] = t1 + (acc / tot) * (t2 - t1); acc += wt[k]; } };
  chosen.forEach((br, k) => { share(wi, br.i + 1, t0, use[k].s); wi = br.i + 1; t0 = use[k].e; });
  share(wi, words.length, t0, offset);
  return times;
}
// ---------- the voice: fetch each sentence as it arrives, play them in order, feed the analyser ----------
function makeVoice(onError) {
  const c = audio(), an = c.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0.55; an.connect(c.destination);
  const bins = new Uint8Array(an.frequencyBinCount), RATE = 24000, queue = [], live = [], sources = new Set();
  let tail = 0, dead = false;
  const bands = () => { an.getByteFrequencyData(bins); const avg = (a, b) => { let t = 0; for (let i = a; i < b; i++) t += bins[i]; return t / (b - a) / 255; }; return { bass: avg(1, 5), mid: avg(5, 24), high: avg(24, 70) }; };
  const f32 = (u8) => { const n = u8.length >> 1, o = new Float32Array(n), dv = new DataView(u8.buffer, u8.byteOffset, n * 2); for (let i = 0; i < n; i++) o[i] = dv.getInt16(i * 2, true) / 32768; return o; };
  // the voice arrives as raw audio, a piece at a time: each piece is queued right behind the last, so it starts talking before the sentence has been made
  // The voice is converted to this device's own rate by hand and joined into steady blocks, with a short head start (a 0.18 s buffer)
  // and tiny fades at the ends: a lot of small buffers at another rate was what made the clicks and glitches.
  const OUT = c.sampleRate;
  const resampler = () => { const step = RATE / OUT; let pos = 0, prev = 0; return (inp) => { const out = []; while (Math.floor(pos) + 1 < inp.length) { const k = Math.floor(pos), fr = pos - k, a = k < 0 ? prev : inp[k], b = inp[k + 1]; out.push(a + (b - a) * fr); pos += step; } prev = inp[inp.length - 1]; pos -= inp.length; return out; }; };
  function flush(it, final) {
    const n = it.acc.length; if (!n) return;
    const buf = c.createBuffer(1, n, OUT), ch = buf.getChannelData(0); for (let i = 0; i < n; i++) ch[i] = it.acc[i]; it.acc = [];
    if (!it.faded) { const f = Math.min(n, Math.round(OUT * 0.008)); for (let i = 0; i < f; i++) ch[i] *= i / f; it.faded = true; }
    if (final) { const f = Math.min(n, Math.round(OUT * 0.01)); for (let i = 0; i < f; i++) ch[n - 1 - i] *= i / f; }
    const src = c.createBufferSource(); src.buffer = buf; src.connect(an); sources.add(src); src.onended = () => sources.delete(src);
    const at = Math.max(c.currentTime + 0.03, tail); if (it.start == null) { it.start = at; live.push(it); }
    src.start(at); tail = at + buf.duration; it.dur = tail - it.start;
  }
  function pump() {
    while (queue.length) {
      const it = queue[0];
      while (it.chunks.length) { const part = it.rs(it.chunks.shift()); for (let i = 0; i < part.length; i++) it.acc.push(part[i]); }
      if (it.done) { flush(it, true); queue.shift(); continue; }
      if (it.acc.length >= OUT * (it.start != null ? 0.08 : 0.18)) flush(it, false);
      break;
    }
  }
  const speak = (text, sent) => {
    const raw = [], it = { sent, chunks: [], acc: [], rs: resampler(), done: false, start: null, dur: 0, est: Math.max(0.9, text.length / 17) };
    queue.push(it);
    (async () => {
      try {
        const r = await fetch('/api/agent/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
        if (r.status === 204) throw new Error('silent'); // text only: nothing to play, the words just show
        if (!r.ok) { const d = await r.json().catch(() => ({})); onError?.(d.error || `voice error ${r.status}`); throw new Error('tts'); }
        const rd = r.body.getReader(); let left = null;
        for (;;) {
          const { value, done } = await rd.read(); if (done || dead) break;
          let b = value; if (left) { const m = new Uint8Array(left.length + b.length); m.set(left); m.set(b, left.length); b = m; left = null; }
          if (b.length & 1) { left = b.slice(b.length - 1); b = b.slice(0, b.length - 1); }
          if (b.length) { const ch = f32(b); raw.push(ch); it.chunks.push(ch); pump(); }
        }
      } catch { it.failed = true; }
      if (raw.length && sent) { try { let n = 0; for (const x of raw) n += x.length; const all = new Float32Array(n); let o = 0; for (const x of raw) { all.set(x, o); o += x.length; } const t = alignWords(all, sent.words.map((w) => w.textContent.trim())); if (t) { sent.times = t; } } catch {} }
      it.done = true; pump();
      if (it.start == null && !it.chunks.length) { if (it.sent) it.sent.frac = 1; const k = queue.indexOf(it); if (k >= 0) queue.splice(k, 1); } // nothing came at all: show the words anyway
    })();
  };
  // how far through each sentence the voice is (the words light up with it)
  const progress = () => {
    const now = c.currentTime;
    for (let i = live.length - 1; i >= 0; i--) {
      const it = live[i], el = now - it.start, total = it.done ? it.dur : Math.max(it.est, it.dur + 0.3), finished = it.done && el >= it.dur;
      if (it.sent) { it.sent.frac = finished ? 1 : clamp(el / total, 0, 0.985); it.sent.t0 = it.start; }
      if (finished) live.splice(i, 1);
    }
  };
  return { speak, bands, progress, now: () => c.currentTime, lat: () => Math.min(0.25, c.outputLatency || 0), get busy() { return queue.length > 0 || live.length > 0; }, async idle() { while (!dead && (queue.length || live.length)) await new Promise((r) => setTimeout(r, 60)); }, stop() { dead = true; for (const x of sources) { try { x.stop(); } catch {} } for (const it of [...queue, ...live]) if (it.sent) it.sent.frac = 1; } };
}

// ---------- the mic: records until you stop talking, returns a 16 kHz mono WAV ----------
async function listen({ patience = 7000, onLevel, signal }) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const c = audio(), src = c.createMediaStreamSource(stream), proc = c.createScriptProcessor(2048, 1, 1), mute = c.createGain(); mute.gain.value = 0;
  const chunks = []; let spoke = false, quiet = 0, noise = 0.004, t = 0, heard = 0;
  const rate = c.sampleRate;
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true; try { proc.disconnect(); src.disconnect(); } catch {} stream.getTracks().forEach((x) => x.stop());
      if (!ok || !spoke) return resolve(null);
      const n = chunks.reduce((s, x) => s + x.length, 0), all = new Float32Array(n); let o = 0; for (const x of chunks) { all.set(x, o); o += x.length; }
      resolve(wav16(all, rate));
    };
    signal?.addEventListener('abort', () => finish(false));
    ag && (ag.finishListen = () => finish(true));
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0); let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; const rms = Math.sqrt(s / d.length), dt = d.length / rate; t += dt;
      onLevel?.(rms);
      const loud = rms > Math.max(0.012, noise * 3);
      if (!spoke) { noise = lerp(noise, rms, 0.05); if (loud) { heard += dt; if (heard > 0.12) spoke = true; } else heard = 0; }
      if (spoke || t < 0.6) chunks.push(new Float32Array(d)); else { chunks.push(new Float32Array(d)); if (chunks.length > 14) chunks.shift(); } // keep a little lead-in
      if (spoke) { quiet = loud ? 0 : quiet + dt; if (quiet > 0.7 || t > 20) finish(true); }
      else if (t * 1000 > patience) finish(false);
    };
    src.connect(proc); proc.connect(mute); mute.connect(c.destination);
  });
}
function wav16(f32, rate) { // downsample to 16 kHz, 16-bit PCM
  const step = rate / 16000, n = Math.floor(f32.length / step), out = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, 16000, true); out.setUint32(28, 32000, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const a = Math.floor(i * step), b = Math.min(f32.length, Math.floor((i + 1) * step)); let s = 0; for (let j = a; j < b; j++) s += f32[j]; const v = clamp(s / Math.max(1, b - a), -1, 1); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
  return new Blob([out], { type: 'audio/wav' });
}

// ---------- the orb (the app's own shader, small, added onto the screen) ----------
function makeOrb(cv) {
  const gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' }); if (!gl) return null;
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return gl.getShaderParameter(x, gl.COMPILE_STATUS) ? x : null; };
  const vs = sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'), fsh = sh(gl.FRAGMENT_SHADER, FS), pr = vs && fsh && gl.createProgram(); if (!pr) return null;
  gl.attachShader(pr, vs); gl.attachShader(pr, fsh); gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const U = {}; for (const k of ['uRes', 'uT', 'uC', 'uR', 'uGlow', 'uFill', 'uRing', 'uRingA', 'uFade']) U[k] = gl.getUniformLocation(pr, k);
  const dpr = Math.min(devicePixelRatio || 1, 1.25), S = cv.clientWidth || 520; cv.width = cv.height = Math.round(S * dpr); gl.viewport(0, 0, cv.width, cv.height);
  let swirl = 3;
  return { draw(R, glow, spin, dt) { // R in css px
    swirl += dt * spin;
    gl.uniform2f(U.uRes, cv.width, cv.height); gl.uniform1f(U.uT, swirl); gl.uniform2f(U.uC, cv.width / 2, cv.height / 2); gl.uniform1f(U.uR, Math.max(R, 0.5) * dpr);
    gl.uniform1f(U.uGlow, Math.max(glow, 0)); gl.uniform1f(U.uFill, 1); gl.uniform1f(U.uRing, 0); gl.uniform1f(U.uRingA, 0); gl.uniform1f(U.uFade, 1); gl.drawArrays(gl.TRIANGLES, 0, 3); } };
}

// ---------- on screen: the live shelf, pointing, opening, playing ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 6000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await wait(80); } };
const typeOf = (t) => (t === 'tv' || t === 'series' ? 'series' : 'movie');
const NAV = { home: '#/', discover: '#/feed/discover', collections: '#/feed/collections', shelf: '#/shelf', continue: '#/continue', taste: '#/taste', friends: '#/friends', profile: '#/profile', settings: '#/settings', updates: '#/settings/updates', manifesto: '#/manifesto' };
const STATUS = { open_title: 'Opening…', play_trailer: 'Opening the trailer…', go_back: 'Going back…', scroll: 'Scrolling…', play: 'Starting it…', navigate: 'Opening…', open_versions: 'Opening the versions…', save_to_shelf: 'Saving to your shelf…' };
// what is readable on screen right now, so Orbie can answer from what you can see
function screenText() { const el = document.querySelector('.dossier.open') || document.querySelector('#app') || document.body; return (el.innerText || '').replace(/\s*\n\s*/g, ' | ').replace(/\s+/g, ' ').slice(0, 7000); }

// ---- the shelf is a carousel: at rest the cards sit in an even row; the one being talked about glides to the middle, big and sharp, and the rest
// fall away at the sides, smaller and blurred. When the talking is done they glide back into the row.
// Built for smoothness: every card is drawn once at its biggest size and only ever moved or scaled down (so it stays sharp and nothing is re-drawn while it moves);
// blur is a second, pre-blurred copy faded in and out (a live blur would be re-computed every frame); labels are separate so they are never scaled;
// nothing here changes the page layout while it animates, only transform and opacity, which the graphics chip handles by itself.
const cardHtml = (c, i) => `<button class="ag-card" data-n="${c.n}" style="--i:${i}" aria-label="${esc(c.title)}"><i class="s" style="background-image:url('${esc(c.poster || '')}')"></i><i class="bl" style="background-image:url('${esc(c.poster || '')}')"></i><em>${c.n}</em></button>`;
const labHtml = (c) => `<div class="ag-lab" data-n="${c.n}"><b>${esc(c.title)}</b><small>${esc([c.year, c.rating && '\u2605 ' + c.rating].filter(Boolean).join(' \u00b7 '))}</small></div>`;
function layoutShelf(s) {
  const stage = s.shelf.querySelector('.ag-stage'); if (!stage) return;
  const cards = [...stage.querySelectorAll('.ag-card')], labs = [...stage.querySelectorAll('.ag-lab')], n = cards.length; if (!n) return;
  const W = stage.clientWidth || innerWidth - 64, GAP = 22, f = s.hl > 0 ? s.hl - 1 : -1;
  const H = Math.round(Math.max(320, Math.min(innerHeight * 0.5, 540)));                 // the stage is always this tall, so nothing reflows
  const B = Math.round(Math.min(H * 0.6, W * 0.3));                                      // a card's drawn width = the biggest it ever gets (the focused one)
  const rest = Math.max(70, Math.min(B * 0.7, (W - 56 - (n - 1) * GAP) / n));            // at rest: sized to the room there is, so they never touch
  stage.style.setProperty('--cw', `${B}px`); stage.style.height = `${H}px`;
  s.shelf.classList.toggle('focusing', f >= 0);
  const cap = s.shelf.querySelector('.ag-fcap'); if (cap && f >= 0 && s.cards[f]) { const c = s.cards[f]; cap.querySelector('b').textContent = c.title; cap.querySelector('small').textContent = [c.year, c.rating && '\u2605 ' + c.rating].filter(Boolean).join(' \u00b7 '); }
  // the others fall away on both sides like a fanned stack: each smaller, blurrier and fainter, overlapping the one before by the same share
  const P = new Array(n);
  const place = (dir) => { let edge = B / 2, a = 0;
    for (let i = f + dir; i >= 0 && i < n; i += dir) { a++; const nw = B * Math.max(0.42, 0.74 - (a - 1) * 0.1), over = nw * 0.34, cx = dir * (edge - over * (a === 1 ? 0.2 : 1) + nw / 2); edge = Math.abs(cx) + nw / 2;
      P[i] = { tx: cx, sc: nw / B, blo: Math.min(1, 0.45 + (a - 1) * 0.2), op: Math.max(0.18, 0.84 - (a - 1) * 0.2), z: 20 - a }; } };
  if (f >= 0) { place(-1); place(1); }
  cards.forEach((el, i) => {
    const p = f < 0 ? { tx: (i - (n - 1) / 2) * (rest + GAP), sc: rest / B, blo: 0, op: 1, z: 1 } : i === f ? { tx: 0, sc: 1, blo: 0, op: 1, z: 30 } : P[i];
    el.style.setProperty('--tx', `${p.tx.toFixed(1)}px`); el.style.setProperty('--sc', p.sc.toFixed(4)); el.style.setProperty('--blo', p.blo.toFixed(2)); el.style.setProperty('--op', p.op.toFixed(2)); el.style.setProperty('--z', p.z);
    el.classList.toggle('focus', i === f);
    const lab = labs[i]; if (lab) { lab.style.setProperty('--lx', `${((i - (n - 1) / 2) * (rest + GAP)).toFixed(1)}px`); lab.style.setProperty('--lw', `${(rest + GAP - 6).toFixed(0)}px`); lab.style.setProperty('--ly', `${(rest * 0.75 + 12).toFixed(0)}px`); }
  });
}
function wireCards(s) { s.shelf.querySelectorAll('.ag-card').forEach((b) => (b.onclick = () => { const c = s.cards[+b.dataset.n - 1]; if (c) location.hash = `#/title/${c.type}/${c.imdbId}`; })); }
function paintShelf(s, spec) {
  if (spec.append && s.cards.length && s.shelf.querySelector('.ag-stage')) { // more titles join the shelf that is already up
    const start = s.cards.length, fresh = spec.items.filter((it) => !s.cards.some((c) => c.imdbId === it.imdbId)).map((it, i) => ({ n: start + i + 1, imdbId: it.imdbId, title: it.title, year: it.year, type: typeOf(it.type), poster: it.poster, rating: it.rating }));
    s.cards.push(...fresh); s.shelf.style.setProperty('--n', Math.min(s.cards.length, 10));
    s.shelf.querySelector('.ag-stage').insertAdjacentHTML('beforeend', fresh.map((c, i) => cardHtml(c, i)).join('') + fresh.map(labHtml).join(''));
    wireCards(s); s.shelf.classList.add('on'); s.shelf.classList.remove('away'); layoutShelf(s); return;
  }
  s.cards = spec.items.map((it, i) => ({ n: i + 1, imdbId: it.imdbId, title: it.title, year: it.year, type: typeOf(it.type), poster: it.poster, rating: it.rating }));
  s.hl = 0; s.shelfTitle = spec.title;
  s.shelf.innerHTML = `<div class="ag-stage">${s.cards.map(cardHtml).join('')}${s.cards.map(labHtml).join('')}</div><div class="ag-fcap"><b></b><small></small></div>`;
  s.shelf.style.setProperty('--n', Math.min(s.cards.length, 10)); s.shelf.classList.add('on'); s.shelf.classList.remove('away');
  wireCards(s); requestAnimationFrame(() => layoutShelf(s));
}
function highlight(s, n) { s.hl = n || 0; layoutShelf(s); } // n = 0 lets go: the row settles again
// is the app itself what the person is looking at (a title page, trailer, film, or a page Orbie opened)? otherwise Orbie is in focus and the app behind is blurred and locked
const showing = (s) => covered() || !!s.pageMode;
// which card is being talked about? the latest title (or "number 3" / "the second one") in the words spoken so far
const norm = (t) => ` ${String(t).toLowerCase().replace(/[\u2019']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const ORD = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
// which card is the voice on, or just about to be? a title (or "number 3" / "the second one") counts from the word where it starts, so the card moves as the name begins
function focusFor(words, L, cards) {
  const tok = [], at = []; words.forEach((w, i) => { for (const t of norm(w).trim().split(' ').filter(Boolean)) { tok.push(t); at.push(i); } });
  let best = 0, bestAt = -1, bestLen = 0;
  const hit = (k, n, len) => { const wi = at[k]; if (wi <= L - 1 && (wi > bestAt || (wi === bestAt && len > bestLen))) { best = n; bestAt = wi; bestLen = len; } };
  const starts = (seq, k) => seq.every((t, j) => tok[k + j] === t);
  for (const c of cards) {
    const full = norm(c.title).trim().split(' ').filter(Boolean), head = norm(String(c.title).split(/[:\u2013\u2014-]\s/)[0]).trim().split(' ').filter(Boolean), bare = full[0] === 'the' ? full.slice(1) : full;
    for (const seq of [full, head, bare]) { if (seq.join('').length < 3) continue; for (let k = 0; k + seq.length <= tok.length; k++) if (starts(seq, k)) hit(k, c.n, seq.length); }
  }
  for (let k = 0; k < tok.length; k++) {
    if (['number', 'pick', 'card', 'no'].includes(tok[k]) && /^\d{1,2}$/.test(tok[k + 1] || '') && cards[+tok[k + 1] - 1]) hit(k, +tok[k + 1], 2);
    if (ORD[tok[k]] && ['one', 'pick', 'film', 'movie', 'show', 'series', 'card'].includes(tok[k + 1]) && cards[ORD[tok[k]] - 1]) hit(k, ORD[tok[k]], 2);
  }
  return best;
}
function lastMention(spoken, cards) {
  const sp = norm(spoken); let best = 0, at = -1;
  for (const c of cards) {
    const full = norm(c.title).trim(), head = norm(String(c.title).split(/[:\u2013\u2014-]\s/)[0]).trim(), bare = full.replace(/^the /, '');
    for (const key of new Set([full, head, bare])) {
      if (key.length < 3) continue;
      const i = sp.lastIndexOf(` ${key} `); if (i > at || (i === at && i >= 0 && key.length > 0 && c.n !== best && key.length > (cards[best - 1] ? norm(cards[best - 1].title).trim().length : 0))) { if (i >= 0) { at = i; best = c.n; } }
    }
  }
  for (const m of sp.matchAll(/ (?:number|pick|card|no) (\d{1,2}) /g)) if (m.index > at && cards[+m[1] - 1]) { at = m.index; best = +m[1]; }
  for (const m of sp.matchAll(/ (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) (?:one|pick|film|movie|show|series|card) /g)) if (m.index > at && cards[ORD[m[1]] - 1]) { at = m.index; best = ORD[m[1]]; }
  return best;
}
const covered = () => !!document.querySelector('.dossier.open, .wp') || document.documentElement.classList.contains('ihp-on');

async function act(s, name, a) {
  document.documentElement.classList.add('ag-ctl'); chime('act'); // the edge light stays on until this turn is finished
  if (STATUS[name]) s.status(STATUS[name], 1800);
  if (name === 'show_shelf') { s.pageMode = false; if (location.hash.startsWith('#/title')) history.back(); paintShelf(s, a); return; }
  if (name === 'drop_cards') { const gone = new Set(a.imdbIds || []); const keep = s.cards.filter((c) => !gone.has(c.imdbId)); if (keep.length !== s.cards.length) { if (keep.length) paintShelf(s, { title: s.shelfTitle || '', items: keep }); else { s.cards = []; s.shelf.classList.remove('on'); s.shelf.innerHTML = ''; } } return `${s.cards.length} left on the shelf`; }
  if (name === 'highlight') return highlight(s, a.n || 0);
  if (name === 'navigate') { if (NAV[a.to]) { s.pageMode = true; location.hash = NAV[a.to]; } return; }
  if (name === 'change_settings') { const { saveSettings } = await import('./main.js'); const patch = {}; if (a.playback) patch.playback = a.playback; if (a.appearance) patch.appearance = a.appearance; if (Object.keys(patch).length) await saveSettings(patch); s.status('Settings updated', 1500); return; }
  if (name === 'rate_title') { const { post } = await import('./api.js'); await post('/api/rate', { imdbId: a.imdbId, title: a.title || '', type: typeOf(a.type), rating: Math.max(1, Math.min(5, a.stars | 0)) }).catch(() => {}); s.status(`Rated ${a.stars}★`, 1500); return; }
  if (name === 'hide_title') { const { post } = await import('./api.js'); await post('/api/notinterested', { imdbId: a.imdbId, title: a.title || '' }).catch(() => {}); s.status('Hidden', 1500); return; }
  if (name === 'mark_watched') { const { post } = await import('./api.js'); await post('/api/history/watched', { imdbId: a.imdbId, season: a.season ?? null, episode: a.episode ?? null }).catch(() => {}); s.status('Marked as watched', 1500); return; }
  if (name === 'open_search') { const { openPalette } = await import('./palette.js'); s.pageMode = true; openPalette(a.query || ''); return; }
  if (name === 'sort_versions' || name === 'filter_versions' || name === 'play_version') {
    const panel = () => document.querySelector('.dossier.open .vx2'); if (!panel()) { await wait(250); if (!panel()) return 'the versions picker is not open: open the versions first'; }
    s.pageMode = !covered() ? true : s.pageMode;
    const q = (sel) => [...document.querySelectorAll(`.dossier.open .vx2 ${sel}`)];
    const rowInfo = (r) => (r?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 110);
    if (name === 'sort_versions') {
      const by = { best: 'best', seeders: 'seeds', largest: 'size', smallest: 'size' }[a.by] || 'best';
      const dirOf = () => q(`[data-sort="size"] .vx2-dir`)[0]?.textContent || '';
      q(`[data-sort="${by}"]`)[0]?.click(); await wait(120);
      if (a.by === 'smallest' && dirOf() !== '↑') { q(`[data-sort="size"]`)[0]?.click(); await wait(120); }
      if (a.by === 'largest' && dirOf() === '↑') { q(`[data-sort="size"]`)[0]?.click(); await wait(120); }
      return `sorted by ${a.by}; first row now: ${rowInfo(q('.vx2-row')[0])}`;
    }
    if (name === 'filter_versions') {
      const tierWant = String(a.tier || '').toLowerCase().replace(/\s+/g, '');
      if (tierWant) { const b = q('[data-t]').find((x) => (tierWant === 'all' ? x.dataset.t === '*' : x.textContent.toLowerCase().replace(/\s+/g, '').includes(tierWant.replace('4k', '2160')) || x.textContent.toLowerCase().includes(tierWant))); if (b) { b.click(); await wait(120); } }
      for (const c of a.chips || []) { const b = q('[data-f]').find((x) => x.textContent.toLowerCase().includes(String(c.name).toLowerCase())); if (b && b.classList.contains('on') !== (c.on !== false)) { b.click(); await wait(120); } }
      return `${q('.vx2-row').length} versions shown; first: ${rowInfo(q('.vx2-row')[0])}`;
    }
    const rows = q('.vx2-row[data-p]'); let row = a.match ? rows.find((r) => rowInfo(r).toLowerCase().includes(String(a.match).toLowerCase())) : rows[(a.row || 1) - 1];
    if (!row) return 'no such version in the list';
    row.scrollIntoView({ block: 'center', behavior: 'smooth' }); row.classList.add('ag-spot'); await wait(500);
    const info = rowInfo(row); close(s); row.click();
    if (a.fullscreen) { await until(() => document.documentElement.classList.contains('ihp-on'), 40000); await wait(1500); if (!window.__ihFs) invoke('player_fullscreen'); }
    return `playing: ${info}`;
  }
  if (name === 'open_versions') { const dosOpen = document.querySelector('.dossier.open') && location.hash.includes(a.imdbId); if (dosOpen) document.querySelector('.dossier.open #dVBtn')?.click(); else location.hash = `#/title/${typeOf(a.type)}/${a.imdbId}?versions=1`; return; }
  if (name === 'open_collection') { s.pageMode = true; location.hash = `#/collection/${a.id}`; return 'opened'; }
  if (name === 'open_title') { location.hash = `#/title/${typeOf(a.type)}/${a.imdbId}`; return; }
  if (name === 'play_trailer') { const b = await until(() => document.querySelector('.dossier.open #dTrailer')); b?.click(); return; }
  if (name === 'point_at') {
    s.pageMode = !covered() ? true : s.pageMode; // the app comes to the front so it can be seen
    await wait(320);
    const scope = document.querySelector('.dossier.open') || document.querySelector('#app') || document.body, want = String(a.what || '').toLowerCase().trim(); if (!want) return 'nothing to point at';
    const cands = [...scope.querySelectorAll('button, a, h1, h2, h3, h4, [role=button], [data-tip], .bc, .dx-sec, article, section, li, span, p')]
      .map((el) => ({ el, t: ((el.getAttribute('aria-label') || '') + ' ' + (el.dataset?.tip || '') + ' ' + (el.title || '') + ' ' + (el.innerText || '')).toLowerCase().replace(/\s+/g, ' ').trim() }))
      .filter((x) => x.t.includes(want) && x.el.getClientRects().length).sort((x, y) => x.t.length - y.t.length);
    const hit = cands[0]?.el; if (!hit) return `could not find "${a.what}" on screen`;
    document.querySelectorAll('.ag-spot').forEach((e) => e.classList.remove('ag-spot'));
    hit.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }); await wait(450);
    hit.classList.add('ag-spot'); setTimeout(() => hit.classList.remove('ag-spot'), 4200);
    return `pointing at "${(hit.innerText || hit.getAttribute('aria-label') || a.what).slice(0, 60).replace(/\s+/g, ' ')}"`;
  }
  if (name === 'scroll' && (a.direction === 'left' || a.direction === 'right')) { // the shelf of picks scrolls sideways
    if (!s.cards.length) return 'there is no shelf on screen'; const nx = Math.max(1, Math.min(s.cards.length, (s.hl || (a.direction === 'left' ? 2 : 0)) + (a.direction === 'left' ? -1 : 1))); highlight(s, nx); return `now on card ${nx}`; // left and right move the focus along the shelf
  }
  if (name === 'scroll') {
    s.pageMode = !covered() ? true : s.pageMode; // scrolling means looking at the app, so it comes to the front
    const dos = document.querySelector('.dossier.open');
    const scroller = (() => { if (!dos) return null; if (/auto|scroll/.test(getComputedStyle(dos).overflowY) && dos.scrollHeight > dos.clientHeight) return dos; return [...dos.querySelectorAll('*')].find((e) => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 40) || null; })();
    if (a.to && dos) {
      const re = { comments: /trailer|comments|people say/i, cast: /^cast|cast &|top cast/i, reviews: /review/i, similar: /more like|similar/i, episodes: /episodes/i }[a.to];
      const target = (a.to === 'comments' && dos.querySelector('#dYt')) || [...dos.querySelectorAll('.dx-h, h3, h2')].find((h) => re.test(h.textContent || ''));
      if (!target) return `no ${a.to} section on this page`; target.scrollIntoView({ behavior: 'smooth', block: 'start' }); document.querySelectorAll('.ag-spot').forEach((e) => e.classList.remove('ag-spot')); target.classList.add('ag-spot'); setTimeout(() => target.classList.remove('ag-spot'), 3500); return `scrolled to ${a.to}`;
    }
    const el = scroller || document.scrollingElement, page = (scroller ? scroller.clientHeight : innerHeight) * 0.8;
    const top = a.direction === 'top' ? 0 : a.direction === 'bottom' ? el.scrollHeight : el.scrollTop + (a.direction === 'up' ? -page : page);
    el.scrollTo({ top, behavior: 'smooth' }); return `scrolled ${a.direction}`;
  }
  if (name === 'save_to_shelf') { const { toggleSave } = await import('./main.js'); const { wl } = await import('./ui.js'); if (!wl.has(a.imdbId)) await toggleSave({ imdbId: a.imdbId, type: typeOf(a.type), title: a.title || '', year: a.year || '', poster: a.poster || '' }); return; }
  if (name === 'go_back') {
    const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const hadTrailer = !!document.querySelector('.wp'), hadPage = !!document.querySelector('.dossier.open');
    if (a.how === 'trailer_only') { if (hadTrailer || hadPage) esc(); return 'closed'; }
    // "go back" returns to the shelf of picks: the trailer and the title page both close
    if (hadTrailer) { esc(); await wait(380); }
    if (document.querySelector('.dossier.open')) { esc(); await wait(320); }
    if (s.cards.length) { s.pageMode = false; return 'back at the shelf'; }
    if (!hadTrailer && !hadPage) { if (s.pageMode) s.pageMode = false; else history.back(); }
    return 'went back';
  }
  if (name === 'play') {
    const { quickPlay } = await import('./main.js');
    close(s); // the film gets the whole screen
    await quickPlay({ imdbId: a.imdbId, type: typeOf(a.type), title: a.title || '', poster: a.poster || '', year: a.year || '', season: a.season, episode: a.episode });
    if (a.fullscreen) { await until(() => document.documentElement.classList.contains('ihp-on'), 40000); await wait(1500); if (!window.__ihFs) invoke('player_fullscreen'); }
    return;
  }
  if (name === 'player_control') { window.__ihpDo?.(a.action, a.amount); return; }
}

// how far into a sentence the voice must be before the action it announces happens (at the verb: "Opening...", "Showing...", "Here are...")
function triggerAt(sent) {
  const words = sent.words.map((w) => w.textContent.trim()), text = words.join(' '), m = /\b(open(ing|ed)?|play(ing)?|show(ing)?|pull(ing)? up|bring(ing)? up|scroll(ing)?|go(ing)? back|head(ing)? (back|to)|here (are|is)|let me|i'll|sorting|filtering|switching|marking|saving)\b/i.exec(text);
  return m ? text.slice(0, m.index).split(' ').length - 1 : Math.floor(words.length * 0.5); // the index of the word that announces it: the action happens as that word is spoken
}
// everything Orbie should know about what is on screen right now
function screenCtx(s, textLen = 7000) {
  const inApp = showing(s);
  const view = document.querySelector('#ihbar .c')?.textContent?.trim() || '';
  const pageCards = getLiveScreenCards();
  const activeCards = (s.cards && s.cards.length) ? s.cards : pageCards;
  const dossier = getDossierContext();
  const player = getPlayerContext();
  const titles = activeCards.map((c) => c.title).join(', ');

  let visible = '';
  if (player) {
    visible = `Playing in player: "${player.title}" (${player.paused ? 'PAUSED' : 'PLAYING'} at ${player.posFmt}, ${player.leftFmt ? player.leftFmt + ' remaining' : ''}).`;
  } else if (dossier) {
    visible = `On title page for "${dossier.title}" (${dossier.meta}). Overview: ${dossier.overview}. Cast: ${dossier.cast.join(', ')}.${dossier.versionsOpen ? ` Versions picker is open (${dossier.topVersions.length} versions shown).` : ''}`;
  } else if (s.cards && s.cards.length) {
    visible = `Assistant shelf is on screen with ${s.cards.length} cards: ${titles}. (The app is visible behind it).`;
  } else if (pageCards.length) {
    visible = `The person is looking at the "${view}" page with cards visible: ${pageCards.slice(0, 12).map((c, i) => `${i + 1}. ${c.title} (${c.year}${c.section ? ` in ${c.section}` : ''})`).join('; ')}.`;
  } else {
    visible = `Looking at the "${view}" page.`;
  }

  return {
    view,
    visibleToPerson: visible,
    appInFront: inApp,
    page: location.hash || '#/',
    cards: activeCards,
    shelfCards: s.cards || [],
    pageCards,
    highlighted: s.hl || null,
    dossier,
    titlePage: dossier ? dossier.title : ((location.hash.match(/^#\/title\/(\w+)\/(tt\d+)/) || []).slice(1).join(' ') || null),
    trailerOpen: !!document.querySelector('.wp-trailer'),
    player,
    text: screenText().slice(0, textLen)
  };
}

// ---------- live voice: one WebRTC stream to OpenAI Realtime (hearing, thinking, speaking; you can talk over it) ----------
async function realtime(s) {
  const c = audio(), pc = new RTCPeerConnection(), el = new Audio(); el.autoplay = true; s.pc = pc; s.audioEl = el;
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); s.micStream = mic;
  pc.addTrack(mic.getAudioTracks()[0], mic);
  // levels: the mic while listening, the voice while speaking (these move the orb)
  const man = c.createAnalyser(); man.fftSize = 512; c.createMediaStreamSource(mic).connect(man); const mbuf = new Uint8Array(man.fftSize);
  const van = c.createAnalyser(); van.fftSize = 256; van.smoothingTimeConstant = 0.55; const vbins = new Uint8Array(van.frequencyBinCount), vtime = new Uint8Array(van.fftSize);
  pc.ontrack = (e) => { el.srcObject = e.streams[0]; try { c.createMediaStreamSource(e.streams[0]).connect(van); } catch {} };
  s.voice = { speak() {}, progress() {}, busy: false, idle: async () => {}, stop() {},
    level() { van.getByteTimeDomainData(vtime); let t = 0; for (let i = 0; i < vtime.length; i++) { const v = (vtime[i] - 128) / 128; t += v * v; } return Math.sqrt(t / vtime.length); },
    bands() { van.getByteFrequencyData(vbins); const avg = (a, b) => { let t = 0; for (let i = a; i < b; i++) t += vbins[i]; return t / (b - a) / 255; }; return { bass: avg(1, 5), mid: avg(5, 24), high: avg(24, 70) }; } };
  s.micLevel = () => { man.getByteTimeDomainData(mbuf); let t = 0; for (let i = 0; i < mbuf.length; i++) { const v = (mbuf[i] - 128) / 128; t += v * v; } return Math.sqrt(t / mbuf.length); };
  const dc = pc.createDataChannel('oai-events'); s.dc = dc;
  const send = (o) => { if (dc.readyState === 'open') dc.send(JSON.stringify(o)); };
  s.rtSend = send;
  const opened = new Promise((res, rej) => { dc.onopen = res; setTimeout(() => rej(new Error('live voice did not connect')), 12000); });
  await pc.setLocalDescription(await pc.createOffer());
  const r = await fetch('/api/agent/rt', { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw Object.assign(new Error(d.error || `live voice ${r.status}`), { fatal: r.status === 401 || /key/i.test(d.error || '') }); }
  await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
  await opened;
  s.rtActive = true;

  let ctxId = '', ctxN = 0, idleT = 0;
  const bump = () => { clearTimeout(idleT); idleT = setTimeout(() => { if (!s.closed) close(s); }, 90000); }; bump(); s.rtBumpClear = () => clearTimeout(idleT);
  const putContext = () => { // what is on screen right now goes into the conversation before the answer is made
    if (ctxId) send({ type: 'conversation.item.delete', item_id: ctxId });
    ctxId = `ctx${++ctxN}`; const sc = screenCtx(s, 3500);
    send({ type: 'conversation.item.create', item: { id: ctxId, type: 'message', role: 'system', content: [{ type: 'input_text', text: `The person is looking at: ${sc.visibleToPerson}\nScreen now: ${JSON.stringify({ view: sc.view, page: sc.page, cards: (sc.cards || []).slice(0, 12), highlighted: sc.highlighted, titlePage: sc.titlePage, trailerOpen: sc.trailerOpen, playing: sc.player })}\nReadable text of the app (${sc.appInFront ? 'what the person sees' : 'BEHIND Orbie, blurred: the person cannot see this'}): ${sc.text}` }] } });
  };
  putContext();
  const showWords = (text) => { // words appear dim as they are written; the voice lights them
    s.showCap(); const box = s.root.querySelector('.ag-said'); box.classList.add('on');
    let st = s.rt?.sent; if (!st) { const span = document.createElement('span'); span.className = 'sent'; box.append(span); st = s.rt.sent = { frac: 0, lit: 0, words: [], cum: [], total: 1, el: span }; s.sents = [st]; }
    const ws = text.split(/\s+/).filter(Boolean); let n = 0; st.cum = []; st.total = 1;
    ws.forEach((w, i) => { let sp = st.words[i]; if (!sp) { sp = document.createElement('span'); sp.className = 'w'; st.el.append(sp); st.words[i] = sp; } if (sp.textContent !== w + ' ') sp.textContent = w + ' '; n += w.length + 1; st.cum.push(n); });
    st.total = n || 1;
  };
  const runCalls = async (calls) => {
    const outs = []; for (const call of calls) outs.push(await (async () => {
      let args = {}; try { args = JSON.parse(call.arguments || '{}'); } catch {}
      try {
        const r = await (await fetch('/api/agent/tool', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: call.name, args, screen: screenCtx(s, 3500), region: REGION() }) })).json();
        let ui; for (const ev of r.events || []) { if (ev.t === 'status') s.status(ev.text); else if (ev.t === 'act') { const o = await act(s, ev.name, ev.args || {}); if (typeof o === 'string') ui = o; } }
        return { call_id: call.call_id, output: JSON.stringify(ui ? { ...(r.result && typeof r.result === 'object' ? r.result : {}), onScreen: ui } : (r.result ?? { ok: true })).slice(0, 6000) };
      } catch (e) { return { call_id: call.call_id, output: JSON.stringify({ error: String(e.message || e) }) }; }
    })());
    if (s.closed) return;
    for (const o of outs) send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: o.call_id, output: o.output } });
    send({ type: 'response.create' });
  };
  dc.onmessage = (m) => {
    let e; try { e = JSON.parse(m.data); } catch { return; }
    bump();
    switch (e.type) {
      case 'input_audio_buffer.speech_started': s.set('listening'); s.status(''); putContext(); break;
      case 'conversation.item.input_audio_transcription.completed': if (e.transcript?.trim()) s.hear(`“${e.transcript.trim()}”`); break;
      case 'response.created': s.set('thinking'); s.status('Thinking…'); document.documentElement.classList.add('ag-ctl'); { const box = s.root.querySelector('.ag-said'); box.textContent = ''; box.classList.add('wait'); } s.sents = []; s.rt = { text: '', t0: null, done: false, sent: null }; break;
      case 'response.output_audio_transcript.delta': if (s.rt) { s.rt.text += e.delta || ''; s.status(''); showWords(s.rt.text); } break;
      case 'output_audio_buffer.started': s.set('speaking'); s.root.querySelector('.ag-said').classList.remove('wait'); if (s.rt) s.rt.t0 = performance.now(); break;
      case 'output_audio_buffer.stopped': case 'output_audio_buffer.cleared': s.root.querySelector('.ag-said').classList.remove('wait'); if (s.rt) s.rt.done = true; s.set('listening'); document.documentElement.classList.remove('ag-ctl'); s.fadeCap(); break;
      case 'response.done': {
        const calls = (e.response?.output || []).filter((o) => o.type === 'function_call');
        if (e.response?.status === 'cancelled') { if (s.rt) s.rt.done = true; s.root.querySelector('.ag-said').classList.remove('wait'); break; }
        if (!(e.response?.output || []).some((o) => o.type === 'function_call')) setTimeout(() => s.root.querySelector('.ag-said')?.classList.remove('wait'), 1500); // never leave the words hidden if no audio came
        if (calls.length) runCalls(calls); else { s.status(''); if (s.state === 'thinking') s.set('listening'); }
        break;
      }
      case 'error': if (!/cancel|no active response/i.test(e.error?.message || '')) { s.status(''); s.say(e.error?.message || 'Something went wrong with the live voice.'); } break;
    }
  };
  s.say('Listening…', true); s.set('listening');
}

// ---------- one conversation turn ----------
async function ask(s, text) {
  s.set('thinking'); s.say(`“${text}”`, true); s.status('Thinking…'); document.documentElement.classList.add('ag-ctl');
  const screen = screenCtx(s);
  s.abort = new AbortController();
  // Actions happen in order and on the words that announce them: one that follows a sentence waits until the voice reaches the "opening / showing / playing" in it
  const actQ = []; let lastSent = null, running = false;
  const runActs = async () => {
    if (running) return; running = true;
    while (actQ.length && !s.closed) {
      const it = actQ.shift(), t0 = Date.now();
      while (it.after && !(it.after.lit > it.at) && it.after.frac < 1 && Date.now() - t0 < 9000 && !s.closed) await wait(25);
      if (!s.closed) await act(s, it.name, it.args);
    }
    running = false;
  };
  try {
    const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, screen, region: REGION() }), signal: s.abort.signal });
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await rd.read(); if (done || s.closed) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.t === 'say') { s.status(''); lastSent = s.addSentence(m.text); s.voice.speak(m.text, lastSent); s.set('speaking'); }
        else if (m.t === 'status') s.status(m.text);
        else if (m.t === 'act') { actQ.push({ name: m.name, args: m.args || {}, after: lastSent, at: lastSent ? triggerAt(lastSent) : 0 }); runActs(); }
        else if (m.t === 'error') { s.status(''); s.say(m.message); s.set('idle'); return false; }
        if (s.closed) return;
      }
    }
  } catch (e) { if (!s.closed && e.name !== 'AbortError') s.say('I lost the connection for a second. Try again.'); return false; }
  while ((running || actQ.length) && !s.closed) await wait(60); // everything announced has happened before the turn is over
  s.status('');
  return true;
}

// plain commands run at once, without waiting on the model
const QUICK = [
  [/^(go )?back$/, 'go_back', {}, 'Going back…'],
  [/^(pause|pause it|stop|hold on|wait|pause the (movie|film|video|show))$/, 'player_control', { action: 'pause' }, 'Paused', true],
  [/^(play|resume|continue|unpause|keep going|play it)$/, 'player_control', { action: 'resume' }, 'Playing', true],
  [/^(louder|volume up|turn it up|turn the volume up|turn up the volume)$/, 'player_control', { action: 'volume', amount: 10 }, 'Louder', true],
  [/^(quieter|volume down|turn it down|turn the volume down|turn down the volume|lower the volume)$/, 'player_control', { action: 'volume', amount: -10 }, 'Quieter', true],
  [/^(mute|unmute|mute it|unmute it)$/, 'player_control', { action: 'mute' }, 'Done', true],
  [/^(make it |go |exit |leave )?full ?screen$/, 'player_control', { action: 'fullscreen' }, 'Fullscreen', true],
  [/^(subtitles|captions|toggle subtitles|turn (on|off) (the )?(subtitles|captions))$/, 'player_control', { action: 'subtitles' }, 'Subtitles', true],
  [/^scroll down$/, 'scroll', { direction: 'down' }, 'Scrolling…'], [/^scroll up$/, 'scroll', { direction: 'up' }, 'Scrolling…'],
  [/^(go to )?(the )?top$/, 'scroll', { direction: 'top' }, 'Scrolling…'], [/^(go to )?(the )?bottom$/, 'scroll', { direction: 'bottom' }, 'Scrolling…'],
];
async function quick(s, text) {
  const t = text.toLowerCase().replace(/[.,!?"“”]/g, '').replace(/'/g, '').replace(/^(hey |ok |okay )?orbie\s*/, '').trim();
  if (/^(close|dismiss|never ?mind|thats all|thanks|thank you|bye|goodbye|go away|stop listening|im done|done)$/.test(t)) { close(s); return true; }
  const on = document.documentElement.classList.contains('ihp-on');
  const trailerOpen = !!document.querySelector('.wp-trailer');
  const dossierOpen = !!document.querySelector('.dossier.open');

  // Trailer active: instant close
  if (trailerOpen && /^(close|exit|stop|close trailer|exit trailer|stop trailer|back|go back|thats enough)$/.test(t)) {
    await act(s, 'go_back', { how: 'trailer_only' });
    s.status('Closed trailer', 1200);
    return true;
  }

  // Dossier active: instant actions
  if (dossierOpen) {
    if (/^(trailer|play trailer|watch trailer|show trailer|the trailer|play the trailer)$/.test(t)) {
      const tb = document.querySelector('.dossier.open #dTrailer');
      if (tb) { tb.click(); s.status('Playing trailer…', 1400); return true; }
    }
    if (/^(play|play it|play this|start|watch|watch it|play movie|play episode|quick play)$/.test(t)) {
      const pb = document.querySelector('.dossier.open #dPlay, .dossier.open .dx-play');
      if (pb) { close(s); pb.click(); return true; }
    }
    if (/^(versions|show versions|files|qualities|formats|pick version)$/.test(t)) {
      const vb = document.querySelector('.dossier.open #dVBtn');
      if (vb) { vb.click(); s.status('Versions', 1200); return true; }
    }
    if (/^(save|save it|save this|bookmark|add to shelf|save to shelf)$/.test(t)) {
      const sb = document.querySelector('.dossier.open #dSave, .dossier.open [data-hero-save]');
      if (sb) { sb.click(); s.status('Saved to shelf', 1200); return true; }
    }
  }

  // Direct card selection
  const ordMap = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  const mNum = /^(?:open |show |pick |card |number |#)?(\d{1,2})$/.exec(t) || /^(?:the )?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?: one| pick| card)?$/.exec(t);
  if (mNum) {
    const num = ordMap[mNum[1]] || +mNum[1];
    const cards = (s.cards && s.cards.length) ? s.cards : getLiveScreenCards();
    const target = cards[num - 1];
    if (target) {
      await act(s, 'open_title', { imdbId: target.imdbId, type: target.type });
      s.status(`Opening ${target.title}…`, 1500);
      return true;
    }
  }

  const sk = /^(skip|skip forward|skip ahead|fast forward|forward)(?: (\d+) seconds?)?$/.exec(t), rw = /^(rewind|skip back|go back|back)(?: (\d+) seconds?)?$/.exec(t);
  if (on && sk) { await act(s, 'player_control', { action: 'seek', amount: +sk[2] || 10 }); s.status(`+${+sk[2] || 10} seconds`, 1300); return true; }
  if (on && rw && (rw[2] || /^(rewind|skip back)$/.test(t))) { await act(s, 'player_control', { action: 'seek', amount: -(+rw[2] || 10) }); s.status(`−${+rw[2] || 10} seconds`, 1300); return true; }
  for (const [re, name, args, label, needsPlayer] of QUICK) {
    if (!re.test(t) || (needsPlayer && !on)) continue;
    await act(s, name, args); s.status(label, 1300); return true;
  }
  return false;
}

async function loop(s, first) {
  let patience = 22000; // how long to wait for you to start talking
  while (!s.closed) {
    s.set('listening'); s.say(first ? 'Listening…' : '', first);
    let wavBlob = null, typed = s.typed; s.typed = null;
    if (!typed) {
      try { wavBlob = await listen({ patience, onLevel: (v) => (s.mic = v), signal: s.listenAbort?.signal }); }
      catch { s.say('I can\u2019t reach the microphone. Allow it in System Settings \u2192 Privacy & Security \u2192 Microphone.'); s.set('idle'); await new Promise((r) => (s.wake = r)); typed = s.typed; s.typed = null; }
    }
    if (s.closed) return;
    if (!typed) {
      if (!wavBlob) { if (s.typed) continue; if (first || s.voice.busy || s.input?.value) { first = false; continue; } return close(s); } // nothing said: close after a quiet moment
      chime('heard'); s.set('thinking'); s.say('…');
      try { const r = await fetch('/api/agent/stt', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wavBlob }); const d = await r.json(); if (!r.ok) throw new Error(d.error); typed = (d.text || '').trim(); }
      catch (e) { s.say(e.message || 'I could not hear that.'); s.set('idle'); await wait(2500); continue; }
      if (!typed || /^\[.*\]$|^\(.*\)$/.test(typed)) { first = false; continue; }
    }
    first = false;
    if (await quick(s, typed)) { document.documentElement.classList.remove('ag-ctl'); s.say(`“${typed}”`, true); continue; }
    const ok = await ask(s, typed); if (s.closed) return;
    await s.voice.idle(); await wait(250); document.documentElement.classList.remove('ag-ctl'); s.fadeCap();
    patience = 30000; // after an answer, stay ready for a follow-up for a good while before going quiet
    s.followUp = true;
  }
}

// ---------- the overlay ----------
function open(btn) {
  const root = document.createElement('div'); root.id = 'ag'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'Ask Orbie');
  // the orb sits in its own root-level layer so it can be added onto the screen (screen blending only reaches what is under the layer)
  const layer = document.createElement('div'); layer.id = 'agOrb'; layer.innerHTML = '<div class="ag-orbwrap"><canvas class="ag-orb"></canvas></div>';
  const dim = document.createElement('div'); dim.id = 'agDim';
  document.body.append(dim, layer);
  root.innerHTML = `<div class="ag-stack"><div class="ag-shelf"></div>
    <div class="ag-cap"><div class="ag-status"><i></i><i></i><i></i><span></span></div><p class="ag-heard"></p><p class="ag-said"></p></div></div>
    <button type="button" class="ag-x" aria-label="Close Orbie" title="Close (Esc)">\u00d7</button>`;
  document.body.append(root);
  const cv = layer.querySelector('.ag-orb'), wrap = layer.querySelector('.ag-orbwrap'), cap = root.querySelector('.ag-cap');
  const s = { root, layer, dim, cards: [], hl: 0, mic: 0, closed: false, state: 'listening', shelf: root.querySelector('.ag-shelf'), typed: null };
  s.set = (st) => { s.state = st; root.dataset.state = st; };
  s.say = (txt, heard) => { s.showCap?.(); const el = cap.querySelector(heard ? '.ag-heard' : '.ag-said'); if (heard && txt) cap.querySelector('.ag-said').textContent = ''; el.textContent = txt; el.classList.toggle('on', !!txt); s.sents = []; };
  s.showCap = () => { clearTimeout(s.capT); cap.classList.remove('idle'); }; // over the app the caption fades a moment after Orbie stops talking
  s.fadeCap = () => { clearTimeout(s.capT); s.capT = setTimeout(() => cap.classList.add('idle'), 2600); };
  s.hear = (txt) => { s.showCap?.(); const el = cap.querySelector('.ag-heard'); el.textContent = txt; el.classList.toggle('on', !!txt); };
  // spoken words appear as live subtitles: dim until the voice reaches them
  s.sents = [];
  s.addSentence = (text) => {
    s.showCap(); const box = cap.querySelector('.ag-said'); box.classList.add('on');
    const el = document.createElement('span'); el.className = 'sent'; const ws = text.split(/\s+/).filter(Boolean), sent = { frac: 0, lit: 0, words: [], cum: [], total: 1 }; let n = 0;
    for (const w of ws) { const sp = document.createElement('span'); sp.className = 'w'; sp.textContent = w + ' '; el.append(sp); n += w.length + 1; sent.words.push(sp); sent.cum.push(n); }
    sent.total = n || 1; sent.el = el; box.append(el); s.sents.push(sent); return sent;
  };
  // "Searching…", "Opening the trailer…": what Orbie is doing right now
  const statusEl = cap.querySelector('.ag-status'); let statusT = 0;
  s.status = (txt, ms) => { clearTimeout(statusT); statusEl.querySelector('span').textContent = txt || ''; statusEl.classList.toggle('on', !!txt); if (txt && ms) statusT = setTimeout(() => statusEl.classList.remove('on'), ms); };
  s.voice = makeVoice((m) => { if (!s.voiceNoted) { s.voiceNoted = true; s.say(`I can't speak right now: ${m}`); } });
  s.listenAbort = new AbortController();
  const orb = makeOrb(cv);
  // fly out of the button
  const b = btn?.getBoundingClientRect?.(); requestAnimationFrame(() => { layer.classList.add('in'); dim.classList.add('in'); const r = wrap.getBoundingClientRect(); if (b) wrap.animate([{ transform: `translate(${b.left + b.width / 2 - (r.left + r.width / 2)}px, ${b.top + b.height / 2 - (r.top + r.height / 2)}px) scale(.04)`, opacity: 0 }, { opacity: 1, offset: .25 }, { transform: 'none', opacity: 1 }], { duration: 750, easing: 'cubic-bezier(.16,1,.3,1)' }); root.classList.add('in'); });
  chime('open');
  // the orb: moves with the voice, slow breath while listening, quick swirl while thinking
  let last = 0, R = 0, scale = 1, glow = 0.8, lv = { bass: 0, mid: 0, high: 0 }, micS = 0, born = performance.now(), raf = 0;
  const frame = (now) => {
    if (s.closed) return; raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
    const sp = s.state === 'speaking', th = s.state === 'thinking';
    const b = sp ? s.voice.bands() : { bass: 0, mid: 0, high: 0 };
    for (const k of ['bass', 'mid', 'high']) lv[k] += (b[k] - lv[k]) * (b[k] > lv[k] ? 0.5 : 0.12);
    micS += (Math.min(1, s.mic * 9) - micS) * 0.2;
    const cov = showing(s); for (const e of [s.root, s.layer, s.dim]) e.classList.toggle('compact', cov);
    if (s.focus !== !cov) { s.focus = !cov; for (const el of document.querySelectorAll('#app, #ihbar')) el.inert = s.focus; } // while Orbie is the focus, nothing behind it can be clicked, tabbed to or typed into // over a trailer or title page: a small orb at the top, out of the picture's way
    const showShelf = !cov && s.cards.length > 0; for (const e of [s.root, s.layer, s.dim]) e.classList.toggle('shelfmode', showShelf);
    scale += ((cov ? 0.34 : showShelf ? 0.55 : 1) - scale) * 0.12;
    const base = 78 * scale, grow = clamp((now - born) / 650), rise = 1 - Math.pow(1 - grow, 3);
    const breath = Math.sin(now / (th ? 420 : 1100)) * (th ? 0.025 : 0.018);
    const target = base * (1 + breath + (sp ? lv.bass * 0.28 + lv.mid * 0.1 : 0) + (s.state === 'listening' ? micS * 0.09 : 0));
    R += (target * rise - R) * 0.35;
    const spin = (th ? 2.4 : sp ? 0.7 + lv.mid * 4 : 0.5 + micS * 1.5), g = (sp ? 0.85 + lv.high * 1.3 + lv.mid * 0.5 : th ? 1.05 : 0.8 + micS * 0.35) * (0.4 + 0.6 * rise);
    glow += (g - glow) * 0.25;
    orb?.draw(R, glow, spin, dt);
    s.voice.progress();
    if (s.rt?.sent) { // the words follow the time the voice is really speaking (pauses included), at a speed learned from earlier answers
      const r = s.rt; s.cps ||= 17.5;
      if (r.t0 && !r.done && s.voice.level?.() > 0.012) r.voiced = (r.voiced || 0) + dt;
      if (r.done && !r.learned && r.voiced > 1 && r.text.length > 20) { r.learned = true; s.cps = clamp(0.4 * s.cps + 0.6 * (r.text.length / r.voiced), 11, 26); }
      r.sent.frac = r.done ? 1 : clamp((r.voiced || 0) * s.cps / Math.max(1, r.text.length), 0, 0.985);
    }
    if (s.rtActive && s.micLevel) s.mic = s.micLevel();
    { // words light strictly in order: a sentence only starts lighting once every sentence before it has been spoken (a later one can never run ahead and leave gaps)
      let before = true;
      for (const st of s.sents) {
        const f = before ? st.frac : 0;
        let n;
        if (f >= 1) n = st.words.length;
        else if (before && st.times && st.t0 != null) { const el = s.voice.now() - st.t0 - s.voice.lat(); n = el < 0 ? 0 : st.times.reduce((k, t) => k + (t <= el + 0.02 ? 1 : 0), 0); } // real word times, from the audio
        else n = f <= 0 ? 0 : st.cum.reduce((k, c) => k + (c / st.total <= f + 0.02 ? 1 : 0), 0);
        if (n !== st.lit) { st.words.forEach((w, i) => w.classList.toggle('lit', i < n)); st.lit = n; }
        before = before && st.frac >= 1;
      }
    }
    if (s.cards.length && !showing(s)) { // as a title is spoken, its card lifts and the rest dim, like pointing at it while talking
      let L = 0; for (const st of s.sents) L += st.lit;
      if (L !== s.mentionL) {
        s.mentionL = L;
        const n = focusFor(s.sents.flatMap((st) => st.words).map((w) => w.textContent), L, s.cards);
        if (n && n !== s.hl) highlight(s, n);
        clearTimeout(s.hlT); s.hlT = setTimeout(() => { if (!s.closed && s.hl) highlight(s, 0); }, 2800); // let go a moment after the talking stops
      }
    }
    { // safety: lit words are always one unbroken run from the start; nothing after a dim word may be lit
      let gap = false; for (const st of s.sents) for (const w of st.words) { const on = w.classList.contains('lit'); if (!on) gap = true; else if (gap) { w.classList.remove('lit'); st.lit = Math.min(st.lit, st.words.indexOf(w)); } }
    }
    { // the caption turns like pages (about two lines each) instead of sliding, so the text holds still while you read it
      let all = [], L = 0; for (const st of s.sents) { all = all.concat(st.words); L += st.lit; }
      const page = []; let pg = 0, ch = 0;
      for (let i = 0; i < all.length; i++) { const len = all[i].textContent.length; if (ch + len > 100 && ch > 0) { pg++; ch = 0; } ch += len; page[i] = pg; }
      const cur = all.length ? page[Math.min(Math.max(L - 1, 0), all.length - 1)] : 0, key = `${cur}:${all.length}`;
      if (s.win !== key) { s.win = key; all.forEach((w, i) => { w.hidden = page[i] !== cur; }); }
    }
    const away = showing(s); s.shelf.classList.toggle('away', away); s.dim.classList.toggle('shelf', !away); // the shelf steps aside while a title page, trailer or film is up; otherwise the app behind is blurred so Orbie is the focus
    const cen = !away && !s.cards.length; for (const e of [s.root, s.layer, s.dim]) e.classList.toggle('centered', cen); // nothing on the shelf yet: Orbie sits in the middle
  };
  raf = requestAnimationFrame(frame);
  root.querySelector('.ag-x').onclick = () => close(s);
  wrap.onclick = () => s.finishListen?.(); // tapping the orb says "that's it"
  s.onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.wp, .dossier.open')) { e.preventDefault(); close(s); } };
  addEventListener('keydown', s.onKey, true);
  s.dim.addEventListener('wheel', (e) => { if (!s.dim.classList.contains('compact')) e.preventDefault(); }, { passive: false });
  s.keyGuard = (e) => { // keys go to Orbie, not to the app behind it, while Orbie is the focus
    if (s.dim.classList.contains('compact') || e.metaKey || e.ctrlKey || e.altKey || e.key === 'Escape' || s.root.contains(e.target)) return;
    e.stopPropagation();
  };
  addEventListener('keydown', s.keyGuard, true);
  s.onResize = () => layoutShelf(s); addEventListener('resize', s.onResize);
  s.cleanup = () => { cancelAnimationFrame(raf); };
  s.btn = btn; btn?.classList.add('on');
  ag = s;
  api('/api/agent/status').then(async (st) => {
    if (!st.ready) { s.say('Add an OpenAI key in Settings → Connectors and I can get going.'); s.set('idle'); s.noKey = true; return; }
    let useRt = !!st.live; try { const o = localStorage.getItem('orbie.rt'); if (o === '1') useRt = true; else if (o === '0') useRt = false; } catch {} // the live voice costs much more, so it is off unless switched on
    if (useRt) { try { await realtime(s); return; } catch (e) { console.warn('[orbie] live voice unavailable, using the standard pipeline:', e.message); try { s.pc?.close(); s.micStream?.getTracks().forEach((t) => t.stop()); } catch {} s.rtActive = false; s.voice = makeVoice((m) => { if (!s.voiceNoted) { s.voiceNoted = true; s.say(`I can't speak right now: ${m}`); } }); if (e.fatal) { s.say(e.message); s.set('idle'); return; } } }
    loop(s, true);
  }).catch(() => loop(s, true));
  return s;
}
function close(s) {
  if (!s || s.closed) return; s.closed = true; chime('close');
  s.listenAbort?.abort(); s.abort?.abort(); s.voice.stop(); s.rtBumpClear?.(); try { s.dc?.close(); s.pc?.close(); s.micStream?.getTracks().forEach((t) => t.stop()); if (s.audioEl) s.audioEl.srcObject = null; } catch {} s.cleanup?.(); removeEventListener('keydown', s.onKey, true); removeEventListener('keydown', s.keyGuard, true); removeEventListener('resize', s.onResize); for (const el of document.querySelectorAll('#app, #ihbar')) el.inert = false;
  document.documentElement.classList.remove('ag-ctl'); s.btn?.classList.remove('on'); s.wake?.();
  for (const e of [s.root, s.layer, s.dim]) { e.classList.remove('in'); e.classList.add('out'); }
  setTimeout(() => { s.root.remove(); s.layer.remove(); s.dim.remove(); }, 450);
  if (ag === s) ag = null;
}
export function toggleAsk(btn) { if (ag) close(ag); else open(btn); }
export const isOpen = () => !!ag;

// lets the shelf be driven from outside (tests, and anything that wants to point at a card)
export function focusCard(n) { if (ag) highlight(ag, n || 0); }

// send a line to Orbie as if it had been spoken (tests, shortcuts)
export function sayToOrbie(text) { if (ag && !ag.rtActive) return ask(ag, String(text)); }
