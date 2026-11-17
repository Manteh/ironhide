// The app's first frames after the start-up screen. This runs before anything else is painted and redraws, pixel for pixel, what the start-up screen was
// showing: the same orb (same shader) and the word "orbie" (as outlines, so no font has to load). It holds that picture until the main screen has really
// loaded (the app calls window.__bootDone), then the letters disappear and the orb slides away: to the middle and out (normal launch), or up to the
// manifesto's spot, which then opens around it (first launch). One live canvas the whole way, never a swap.
(function () {
  try {
    var q = new URLSearchParams(location.search), mode = q.get('intro') === '1' ? 'intro' : q.get('boot') === '1' ? 'boot' : '';
    if (!mode) mode = 'boot'; // an ordinary open or reload: the same orb holds the screen (instead of a blank page) until the main screen is complete, then dissolves
    document.documentElement.classList.add('intro');
    var FS = "precision highp float;\nuniform vec2 uRes;      // canvas size (device px)\nuniform float uT;       // seconds (of swirl)\nuniform vec2 uC;        // orb centre (device px, GL coords)\nuniform float uR;       // orb radius (device px)\nuniform float uGlow;    // bloom strength\nuniform float uFill;    // how much light is inside the orb\nuniform float uRing;    // shockwave radius (device px)\nuniform float uRingA;   // shockwave strength\nuniform float uFade;    // 1 = visible, 0 = the app's background colour\n\nfloat hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\nfloat hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\nfloat noise(vec3 x) {\n  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);\n  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),\n             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);\n}\nfloat fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }\n\nvoid main() {\n  vec2 p = gl_FragCoord.xy;\n  vec2 q = (p - uC) / uR;\n  float d = length(q);\n  float dpx = length(p - uC);\n\n  // the room: near-black with a violet haze around the orb\n  vec3 bg = vec3(0.027, 0.027, 0.05);\n  float out1 = max(d - 1.0, 0.0);\n  bg += vec3(0.42, 0.28, 1.0) * exp(-out1 * 2.4) * 0.32 * uGlow;\n  bg += vec3(0.75, 0.2, 0.65) * exp(-out1 * 0.7) * 0.07 * uGlow;\n  bg += vec3(0.25, 0.2, 0.6) * exp(-dpx / (uRes.y * 0.55)) * 0.06;\n\n  // the shockwave: a thin ring of light that splits into colours as it travels\n  float w = max(uR * 0.05, 3.0);\n  float rr = exp(-pow((dpx - uRing * 1.012) / w, 2.0));\n  float rg = exp(-pow((dpx - uRing) / w, 2.0));\n  float rb = exp(-pow((dpx - uRing * 0.988) / w, 2.0));\n  bg += vec3(rr * 0.9, rg * 0.75, rb * 1.25) * uRingA;\n  bg += vec3(0.5, 0.4, 1.0) * exp(-pow((dpx - uRing * 0.93) / (w * 5.0), 2.0)) * uRingA * 0.18;\n\n  vec3 col = bg;\n  if (d < 1.0) {\n    float z = sqrt(1.0 - d * d);\n    vec3 n = vec3(q, z);\n\n    // liquid light inside: domain-warped noise seen through curved glass (stronger bend near the edge)\n    vec2 uv = q * (1.0 + 0.45 * (1.0 - z));\n    float t = uT;\n    vec3 pp = vec3(uv * 1.35, t * 0.11);\n    float w1 = fbm(pp + vec3(0.0, 0.0, t * 0.05));\n    float w2 = fbm(pp + vec3(5.2, 1.3, 2.0));\n    float neb = fbm(pp + vec3(w1 * 1.7, w2 * 1.7, t * 0.07));\n    vec3 inner = mix(vec3(0.035, 0.015, 0.16), vec3(0.42, 0.18, 0.95), smoothstep(0.30, 0.78, neb));\n    inner = mix(inner, vec3(0.95, 0.25, 0.70), smoothstep(0.55, 0.85, w1) * 0.6);\n    // ridges of the flow: thin, bright threads of light, the way light pools in liquid glass\n    float ridge = 1.0 - abs(2.0 * fbm(pp * 0.75 + vec3(w2 * 1.3, w1 * 1.3, t * 0.06)) - 1.0);\n    inner += vec3(0.50, 0.80, 1.0) * pow(ridge, 7.0) * 0.42;\n    inner += vec3(1.0, 0.60, 0.95) * pow(ridge, 18.0) * 0.38;\n    inner *= (0.32 + 0.85 * z) * (0.6 + 0.4 * smoothstep(1.0, 0.55, d));              // deeper in the middle, darker glass at the edge\n    inner += vec3(0.8, 0.72, 1.0) * exp(-d * d * 4.0) * 0.16;                        // a soft core\n\n    // the glass\n    vec3 L = normalize(vec3(-0.5, 0.62, 0.62));\n    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));\n    float spec = pow(max(dot(n, H), 0.0), 220.0) * 1.6;\n    vec2 sb = (q - vec2(-0.36, 0.43));\n    sb = mat2(0.87, -0.5, 0.5, 0.87) * sb / vec2(0.30, 0.13);\n    float softbox = smoothstep(1.0, 0.25, length(sb)) * 0.42;                        // a window reflected in the glass\n    float F = pow(1.0 - z, 2.6);\n    // a thin-film sheen on the glass, kept to the brand's cyan and pink (no muddy rainbow)\n    vec3 iri = mix(vec3(0.42, 0.86, 1.0), vec3(1.0, 0.42, 0.86), 0.5 + 0.5 * sin(F * 7.0 + q.y * 2.2 + uT * 0.25));\n    vec3 shell = iri * F * 1.15 + vec3(0.55, 0.88, 1.0) * pow(1.0 - z, 7.0) * 0.9;\n    shell += vec3(1.0, 0.32, 0.72) * pow(max(dot(n, normalize(vec3(0.35, -0.85, 0.3))), 0.0), 2.0) * 0.35;  // warm bounce from below\n    float shade = 0.55 + 0.45 * max(dot(n, L), 0.0);\n\n    vec3 orb = inner * uFill * shade + shell + spec + softbox;\n    float aa = smoothstep(1.0, 1.0 - 1.5 / uR, d);\n    col = mix(col, orb, aa);\n  }\n\n  col = 1.0 - exp(-col * 1.3);                       // filmic roll-off: bright stays bright without clipping\n  col = mix(vec3(0.027, 0.027, 0.051), col, uFade);  // fade to the cosmic midnight background\n  gl_FragColor = vec4(col, 1.0);\n}\n"; // identical to the start-up screen's shader (mac/ui/index.html)
    var GLYPHS = ["M57.5 0V483H189V0ZM189 266.75 137.75 301.25Q147.25 389.5 190.24846625766872 441.25Q233.24693251533742 493 313.75 493Q349.25 493 377.125 481.25Q405 469.5 427.5 444L346 349.5Q334.5 362 319.09722222222223 367.875Q303.69444444444446 373.75 283.5 373.75Q241.5 373.75 215.25 347.562893081761Q189 321.37578616352204 189 266.75Z", "M326 -10Q273.75 -10 231.75 11.875Q189.75 33.75 164.625 71.625Q139.5 109.5 137.5 157V328.5Q139.5 376 165.0 413.25Q190.5 450.5 232.5 471.75Q274.5 493 326 493Q393 493 446.0 459.75Q499 426.5 529.5 369.625Q560 312.75 560 240.75Q560 169.5 529.5 112.75Q499 56 446.0 23.0Q393 -10 326 -10ZM57.5 0V723H189V364.25L166.75 247.5L187.75 129.75V0ZM303.5 111Q339.5 111 367.0 127.625Q394.5 144.25 410.25 173.75Q426 203.25 426 241.5Q426 279.75 410.25 309.25Q394.5 338.75 366.875 355.375Q339.25 372 303.25 372Q267.25 372 239.375 355.375Q211.5 338.75 196.25 309.375Q181 280 181 241.5Q181 203 196.375 173.5Q211.75 144 239.625 127.5Q267.5 111 303.5 111Z", "M58 0V483H189.5V0ZM123.75 560.5Q92 560.5 71.0 582.125Q50 603.75 50 635.5Q50 667.25 71.0 688.875Q92 710.5 123.75 710.5Q156.5 710.5 177.0 688.875Q197.5 667.25 197.5 635.5Q197.5 603.75 177.0 582.125Q156.5 560.5 123.75 560.5Z", "M288.75 -10.5Q213.25 -10.5 153.875 22.0Q94.5 54.5 60.25 111.875Q26 169.25 26 241.5Q26 313.5 59.625 370.375Q93.25 427.25 151.125 460.375Q209 493.5 280.25 493.5Q349.75 493.5 403.125 462.375Q456.5 431.25 487.0 376.75Q517.5 322.25 517.5 252.5Q517.5 239.75 516.0 226.25Q514.5 212.75 511 196L104.5 195.25V292.75L450 293.5L396.5 253.25Q395 296.25 381.375 325.125Q367.75 354 342.375 369.25Q317 384.5 279.75 384.5Q240.75 384.5 212.0 367.25Q183.25 350 167.625 318.625Q152 287.25 152 243.5Q152 199.5 168.625 167.125Q185.25 134.75 216.0 117.375Q246.75 100 288 100Q324.5 100 354.75 112.625Q385 125.25 407 150.25L484 72.75Q448.5 31.5 398.0 10.5Q347.5 -10.5 288.75 -10.5Z"]; // "rbie", Outfit 600, in font units (1000 per em)
    var VW = parseFloat(q.get('vw')) || innerWidth, VH = parseFloat(q.get('vh')) || innerHeight; // the window's size, as the start-up screen measured it (a new page can report a different size for its first moments)
    var cv = document.createElement('canvas'); cv.id = 'introOrb';
    cv.style.cssText = 'position:fixed;left:0;top:0;width:' + VW + 'px;height:' + VH + 'px;display:block;z-index:2147483000;background:#07070d';
    document.documentElement.appendChild(cv);
    var gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) { cv.remove(); return; }
    function sh(t, s) { var x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return gl.getShaderParameter(x, gl.COMPILE_STATUS) ? x : null; }
    var vs = sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'), fs = sh(gl.FRAGMENT_SHADER, FS);
    var pr = vs && fs && gl.createProgram(); if (!pr) { cv.remove(); return; }
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { cv.remove(); return; }
    gl.useProgram(pr); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var a = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    var U = {}; ['uRes', 'uT', 'uC', 'uR', 'uGlow', 'uFill', 'uRing', 'uRingA', 'uFade'].forEach(function (k) { U[k] = gl.getUniformLocation(pr, k); });

    var clamp = function (x) { return Math.max(0, Math.min(1, x)); }, inOut = function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }, lerp = function (a, b, x) { return a + (b - a) * x; };
    var R0 = 33.28; // the orb's radius in the "o" of the word (.64em of 104px, halved)
    var num = function (k, d) { var v = parseFloat(q.get(k)); return isFinite(v) ? v : d; };
    var lx = (q.get('lx') || '').split(',').map(parseFloat), hasWord = lx.length === 4 && lx.every(isFinite) && isFinite(parseFloat(q.get('lt'))) && isFinite(parseFloat(q.get('ox')));
    var geo = { ox: num('ox', VW / 2), oy: num('oy', VH / 2), lt: num('lt', 0) };

    // the word, as outlines in the same gradient the start-up screen paints it with
    var word = null;
    if (hasWord) {
      var SC = 104 / 1000, base = geo.lt + (104 - 1.26 * 104) / 2 + 104;
      var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
      svg.style.cssText = 'position:fixed;left:0;top:0;width:' + VW + 'px;height:' + VH + 'px;z-index:2147483001;pointer-events:none;overflow:visible'; // no viewBox: one unit is one pixel, whatever the viewport does
      svg.innerHTML = '<defs><linearGradient id="ibg" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="' + ((base - geo.lt) / SC) + '" y2="' + ((base - geo.lt - 104) / SC) + '"><stop offset=".3" stop-color="#fff"/><stop offset="1" stop-color="#d9d2ff"/></linearGradient></defs>';
      word = document.createElementNS(ns, 'g');
      GLYPHS.forEach(function (d, i) { var g = document.createElementNS(ns, 'g'); g.setAttribute('transform', 'translate(' + lx[i] + ',' + base + ') scale(' + SC + ',' + (-SC) + ')'); var p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', 'url(#ibg)'); g.appendChild(p); word.appendChild(g); });
      svg.appendChild(word); document.documentElement.appendChild(svg); word.__svg = svg;
    }

    var swirl = num('s', 3), ph = num('ph', 0), t0 = performance.now(), last = t0, W = 0, H = 0, dpr = 1, stopped = false, exitT = 0, revealed = false, fading = 0, fadeMs = 450;

    // While an ordinary open or reload waits for the main screen, the sphere itself does the moving: it blooms in out of a point of light, then breathes slowly,
    // its inner light flows faster, and it glows brighter the closer the app is to ready (real progress, reported by the app). When ready it draws a breath in
    // and lets go. Nothing is added around it. Coming from the start-up screen (the word "orbie" is there) it stays exactly as that screen left it.
    var prog = 0, shown = 0, busy = 0, work = hasWord ? 0 : 1, easeOut = function (x) { return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x); };
    window.__bootProgress = function (v) { v = Math.max(0, Math.min(1, v)); if (v > prog) prog = v; }; // 0..1, from the app

    function target() { if (mode === 'boot') return { cx: VW / 2, cy: VH / 2, R: R0 }; var css = VW <= 700 ? 240 : 340; return { cx: VW / 2, cy: Math.max(56 + css / 2, VH * 0.38), R: css * 0.318 }; } // intro: mirrors .hero in pages/manifesto.js
    function frame(now) {
      if (stopped) return;
      if (W !== VW || H !== VH) { dpr = Math.min(devicePixelRatio || 1, 2); W = VW; H = VH; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); gl.viewport(0, 0, cv.width, cv.height); }
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      var tt = (now - t0) / 1000, bl = work ? easeOut(clamp(tt / 0.8)) : 1;               // the bloom out of a point of light (plain reloads only)
      busy += ((exitT ? 0 : work) - busy) * Math.min(1, dt * 1.6); shown += (prog - shown) * Math.min(1, dt * 3);
      swirl += dt * (0.55 + 1.1 * busy);                                                   // the light inside flows a little faster while it works
      var breathe = busy * 0.04 * Math.sin(tt * 2.3);                                      // slow, smooth breathing
      var glow = 0.95 + 0.1 * Math.sin(ph + (now - t0) / 900) + busy * (0.1 + 0.3 * shown) - (1 - bl) * 0.6, e = 0, p = { cx: geo.ox, cy: geo.oy, R: lerp(2.2, R0 * (work ? 1.5 : 1), bl) * (1 + breathe) };
      if (exitT) {
        var te = now - exitT, T = target(); e = inOut(clamp(te / 800));
        p = (window.__introOrbPos && window.__introOrbPos()) || { cx: lerp(geo.ox, T.cx, e), cy: lerp(geo.oy, T.cy, e), R: lerp(R0, T.R, e) };
        if (!work || mode === 'intro') glow = lerp(glow, 1.0, e);
        else { p.R *= 1 - 0.09 * Math.sin(Math.PI * clamp(te / 380)); }                  // ready: a breath in, then it lets go
        var revealAt = (work && mode !== 'intro') ? 380 : 860;
        if (!revealed && te >= revealAt) { revealed = true; if (mode === 'intro') { if (window.__introReveal) window.__introReveal(); } else fading = now; }
      }
      var fadeV = 1, gp = 0;
      if (fading) { var kk = Math.min(1, (now - fading) / fadeMs); fadeV = 1 - Math.max(0, (kk - 0.12) / 0.88); gp = Math.sin(kk * Math.PI); if (kk >= 1) { window.__introOrb.dispose(); return; } }
      if (revealed && mode === 'intro') glow = 1.0 + 0.08 * Math.sin(now / 900);
      gl.uniform2f(U.uRes, cv.width, cv.height); gl.uniform1f(U.uT, swirl);
      gl.uniform2f(U.uC, p.cx * dpr, (H - p.cy) * dpr); gl.uniform1f(U.uR, Math.max(p.R, 0.5) * dpr);
      gl.uniform1f(U.uGlow, Math.max(glow, 0) + gp); gl.uniform1f(U.uFill, work ? lerp(0.35, 1, bl) : 1); gl.uniform1f(U.uRing, 0); gl.uniform1f(U.uRingA, 0); gl.uniform1f(U.uFade, fadeV);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(frame);
    }
    addEventListener('resize', function () { VW = innerWidth; VH = innerHeight; cv.style.width = '100%'; cv.style.height = '100%'; if (word) { word.__svg.style.width = '100%'; word.__svg.style.height = '100%'; } }); // only a real resize switches to the live size
    frame(performance.now()); // drawn synchronously, so the very first paint already shows the orb and the word

    function dispose() { stopped = true; cv.remove(); if (word) word.__svg.remove(); window.__introOrbPos = null; document.documentElement.classList.remove('intro'); }

    function exitSound() { // best effort: the window may block audio before a click, in which case this stays silent
      try {
        if (localStorage.getItem('orbie.sounds') === '0') return;
        var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; var ctx = new AC();
        Promise.resolve(ctx.resume && ctx.resume()).catch(function () {}).then(function () {
          if (ctx.state !== 'running') return;
          var T = ctx.currentTime, out = ctx.createGain(); out.gain.value = 0.5; var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; out.connect(lp); lp.connect(ctx.destination);
          var len = Math.floor(ctx.sampleRate * 0.8), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
          var src = ctx.createBufferSource(); src.buffer = buf; var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2; bp.frequency.setValueAtTime(1800, T); bp.frequency.exponentialRampToValueAtTime(400, T + 0.8);
          var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, T); g.gain.exponentialRampToValueAtTime(0.07, T + 0.36); g.gain.exponentialRampToValueAtTime(0.0001, T + 0.8); src.connect(bp); bp.connect(g); g.connect(out); src.start(T);
          [262, 392, 523, 659].forEach(function (f, k) { var o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; var s0 = T + 0.45 + k * 0.04; og.gain.setValueAtTime(0.0001, s0); og.gain.exponentialRampToValueAtTime(0.1, s0 + 0.04); og.gain.exponentialRampToValueAtTime(0.0001, s0 + 1.8); o.connect(og); og.connect(out); o.start(s0); o.stop(s0 + 1.9); });
          setTimeout(function () { ctx.close && ctx.close(); }, 4000);
        });
      } catch (e) {}
    }
    window.__bootDone = function () { // the app calls this once the main screen is loaded: the word goes, the orb slides away
      if (exitT || stopped) return; exitT = performance.now(); prog = 1; exitSound();
      if (word) word.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-8px) scale(.98)' }], { duration: 420, fill: 'forwards', easing: 'cubic-bezier(.22,1,.36,1)' });
    };
    setTimeout(function () { window.__bootDone(); }, 15000); // never trap anyone behind the orb
    window.__introOrb = { canvas: cv, dispose: dispose };
  } catch (e) { try { document.documentElement.classList.remove('intro'); } catch (_) {} }
})();
