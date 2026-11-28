// The start-up animation, on demand: click the orb in the top bar and it flies out of the button, blooms, shrinks, slides into "orbie", then
// slides to the manifesto's spot and the manifesto opens around it. One live canvas the whole way (the manifesto adopts it).
import { FS } from './orb-shader.js';
import { orbSounds } from './orb-sound.js';

let running = false;
const clamp = (x) => Math.max(0, Math.min(1, x)), span = (t, a, b) => clamp((t - a) / (b - a));
const inOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2), outExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)), outCubic = (x) => 1 - Math.pow(1 - x, 3), lerp = (a, b, x) => a + (b - a) * x;

export async function playSequence(from) {
  if (running || document.getElementById('mf-root')) return;
  const { openManifesto } = await import('./pages/manifesto.js');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const box = document.createElement('div');
  box.id = 'orbSeq';
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#07070d;opacity:0;transition:opacity .3s ease;display:grid;place-items:center;font:600 104px/1 Outfit,-apple-system,sans-serif;letter-spacing:-.035em;color:#f3f1ff;-webkit-font-smoothing:antialiased';
  const cv = document.createElement('canvas'); cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  const lock = document.createElement('div'); lock.style.cssText = 'position:relative;display:flex;align-items:baseline';
  const slot = document.createElement('span'); slot.style.cssText = 'display:inline-block;width:.64em;height:.64em;margin:0 .035em 0 0';
  const rest = document.createElement('span');
  const letters = [...'rbie'].map((ch) => { const s = document.createElement('span'); s.textContent = ch; s.style.cssText = 'display:inline-block;opacity:0;background:linear-gradient(180deg,#fff 30%,#d9d2ff);-webkit-background-clip:text;background-clip:text;color:transparent'; rest.appendChild(s); return s; });
  lock.append(slot, rest); box.append(cv, lock);

  const gl = !reduce && cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return gl.getShaderParameter(x, gl.COMPILE_STATUS) ? x : null; };
  const vs = gl && sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'), fsh = gl && sh(gl.FRAGMENT_SHADER, FS);
  const pr = vs && fsh && gl.createProgram();
  if (pr) { gl.attachShader(pr, vs); gl.attachShader(pr, fsh); gl.linkProgram(pr); }
  if (!pr || !gl.getProgramParameter(pr, gl.LINK_STATUS)) { openManifesto({ intro: false }); return; } // no WebGL: just open it
  running = true;
  orbSounds(); // starts on the click, on the same timeline
  gl.useProgram(pr); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const a = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const U = {}; for (const k of ['uRes', 'uT', 'uC', 'uR', 'uGlow', 'uFill', 'uRing', 'uRingA', 'uFade']) U[k] = gl.getUniformLocation(pr, k);
  document.body.appendChild(box); requestAnimationFrame(() => (box.style.opacity = '1'));

  const fb = from.getBoundingClientRect(), p0 = { x: fb.left + fb.width / 2, y: fb.top + fb.height / 2 }, R0 = 8.5;
  let W = 0, H = 0, dpr = 1, swirl = 3, last = 0, start = 0, stopped = false, handed = 0, lettersOn = false, fadedLock = false;
  const target = () => { const css = W <= 700 ? 240 : 340; return { cx: W / 2, cy: Math.max(56 + css / 2, H * 0.38), R: css * 0.318 }; }; // mirrors .hero in pages/manifesto.js
  const T_BACK = 3.0, T_END = 3.8;

  function frame(now) {
    if (stopped) return;
    if (W !== innerWidth || H !== innerHeight) { dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); gl.viewport(0, 0, cv.width, cv.height); }
    if (!start) start = now;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
    const t = (now - start) / 1000, T = target();
    let cx, cy, R, glow, ring = 0, ringA = 0;

    if (!handed) {
      const r = slot.getBoundingClientRect(), fx = r.left + r.width / 2, fy = r.top + r.height / 2, fr = r.width / 2, r0 = Math.min(W, H) * 0.21;
      const fly = outExpo(span(t, 0, 0.8)), shrink = inOut(span(t, 0.85, 1.35)), slide = inOut(span(t, 1.3, 1.95)), back = inOut(span(t, T_BACK, T_END));
      R = lerp(lerp(lerp(R0, r0, fly), fr, shrink), T.R, back);
      cx = lerp(lerp(lerp(p0.x, W / 2, fly), fx, slide), T.cx, back);
      cy = lerp(lerp(lerp(p0.y, H / 2, fly), fy, slide), T.cy, back);
      swirl += dt * lerp(3.2, 0.55, span(t, 0.2, 1.6)) * (1 - back);
      glow = lerp(lerp(0.6, 1.5, span(t, 0, 0.3)) - 0.55 * span(t, 0.3, 0.9), 1.0, back);
      const wave = span(t, 1.3, 2.2); ring = lerp(fr * 2, Math.hypot(W, H) * 0.95, outCubic(wave));
      ringA = wave > 0 && wave < 1 ? Math.sin(Math.PI * Math.min(1, wave * 1.15)) * (1 - wave) * 1.6 : 0;
      if (!lettersOn && t > 1.6) { lettersOn = true; letters.forEach((l, i) => l.animate([{ opacity: 0, transform: 'translateY(.18em) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: i * 85, easing: 'cubic-bezier(.2,.9,.25,1)', fill: 'both' })); }
      if (!fadedLock && t > T_BACK) { fadedLock = true; lock.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-8px) scale(.98)' }], { duration: 400, fill: 'forwards', easing: 'cubic-bezier(.22,1,.36,1)' }); }
      if (t >= T_END) { // hand over: the manifesto adopts this very canvas
        handed = now;
        window.__introOrb = { canvas: cv, dispose: () => { stopped = true; cv.remove(); window.__introOrbPos = null; running = false; } };
        openManifesto({ intro: true });
        cv.style.zIndex = '0'; box.remove();
      }
    } else {
      const p = (window.__introOrbPos && window.__introOrbPos()) || T, k = Math.min(1, (now - handed) / 1200);
      cx = p.cx; cy = p.cy; R = p.R; swirl += dt * 0.55 * k; glow = 1.0 + 0.08 * Math.sin(now / 900) * k;
    }
    gl.uniform2f(U.uRes, cv.width, cv.height); gl.uniform1f(U.uT, swirl);
    gl.uniform2f(U.uC, cx * dpr, (H - cy) * dpr); gl.uniform1f(U.uR, Math.max(R, 0.5) * dpr);
    gl.uniform1f(U.uGlow, Math.max(glow, 0)); gl.uniform1f(U.uFill, 1); gl.uniform1f(U.uRing, ring * dpr); gl.uniform1f(U.uRingA, ringA); gl.uniform1f(U.uFade, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
