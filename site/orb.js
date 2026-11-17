// The real Orbie orb for the landing page: the same shader as the app's start-up screen (mac/ui/index.html), not a picture of it.
// It blooms in on load, then keeps breathing and swirling. It follows the cursor a little and only draws while the hero is on screen.
(function () {
  var cv = document.getElementById('heroOrb'), slot = document.getElementById('orbSlot');
  if (!cv || !slot) return;
  var FS = "precision highp float;\nuniform vec2 uRes;      // canvas size (device px)\nuniform float uT;       // seconds (of swirl)\nuniform vec2 uC;        // orb centre (device px, GL coords)\nuniform float uR;       // orb radius (device px)\nuniform float uGlow;    // bloom strength\nuniform float uFill;    // how much light is inside the orb\nuniform float uRing;    // shockwave radius (device px)\nuniform float uRingA;   // shockwave strength\nuniform float uFade;    // 1 = visible, 0 = the app's background colour\n\nfloat hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\nfloat hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\nfloat noise(vec3 x) {\n  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);\n  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),\n             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);\n}\nfloat fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }\n\nvoid main() {\n  vec2 p = gl_FragCoord.xy;\n  vec2 q = (p - uC) / uR;\n  float d = length(q);\n  float dpx = length(p - uC);\n\n  // the room: near-black with a violet haze around the orb\n  vec3 bg = vec3(0.027, 0.027, 0.05);\n  float out1 = max(d - 1.0, 0.0);\n  bg += vec3(0.42, 0.28, 1.0) * exp(-out1 * 2.4) * 0.32 * uGlow;\n  bg += vec3(0.75, 0.2, 0.65) * exp(-out1 * 0.7) * 0.07 * uGlow;\n  bg += vec3(0.25, 0.2, 0.6) * exp(-dpx / (uRes.y * 0.55)) * 0.06;\n\n  // the shockwave: a thin ring of light that splits into colours as it travels\n  float w = max(uR * 0.05, 3.0);\n  float rr = exp(-pow((dpx - uRing * 1.012) / w, 2.0));\n  float rg = exp(-pow((dpx - uRing) / w, 2.0));\n  float rb = exp(-pow((dpx - uRing * 0.988) / w, 2.0));\n  bg += vec3(rr * 0.9, rg * 0.75, rb * 1.25) * uRingA;\n  bg += vec3(0.5, 0.4, 1.0) * exp(-pow((dpx - uRing * 0.93) / (w * 5.0), 2.0)) * uRingA * 0.18;\n\n  vec3 col = bg;\n  if (d < 1.0) {\n    float z = sqrt(1.0 - d * d);\n    vec3 n = vec3(q, z);\n\n    // liquid light inside: domain-warped noise seen through curved glass (stronger bend near the edge)\n    vec2 uv = q * (1.0 + 0.45 * (1.0 - z));\n    float t = uT;\n    vec3 pp = vec3(uv * 1.35, t * 0.11);\n    float w1 = fbm(pp + vec3(0.0, 0.0, t * 0.05));\n    float w2 = fbm(pp + vec3(5.2, 1.3, 2.0));\n    float neb = fbm(pp + vec3(w1 * 1.7, w2 * 1.7, t * 0.07));\n    vec3 inner = mix(vec3(0.035, 0.015, 0.16), vec3(0.42, 0.18, 0.95), smoothstep(0.30, 0.78, neb));\n    inner = mix(inner, vec3(0.95, 0.25, 0.70), smoothstep(0.55, 0.85, w1) * 0.6);\n    // ridges of the flow: thin, bright threads of light, the way light pools in liquid glass\n    float ridge = 1.0 - abs(2.0 * fbm(pp * 0.75 + vec3(w2 * 1.3, w1 * 1.3, t * 0.06)) - 1.0);\n    inner += vec3(0.50, 0.80, 1.0) * pow(ridge, 7.0) * 0.42;\n    inner += vec3(1.0, 0.60, 0.95) * pow(ridge, 18.0) * 0.38;\n    inner *= (0.32 + 0.85 * z) * (0.6 + 0.4 * smoothstep(1.0, 0.55, d));              // deeper in the middle, darker glass at the edge\n    inner += vec3(0.8, 0.72, 1.0) * exp(-d * d * 4.0) * 0.16;                        // a soft core\n\n    // the glass\n    vec3 L = normalize(vec3(-0.5, 0.62, 0.62));\n    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));\n    float spec = pow(max(dot(n, H), 0.0), 220.0) * 1.6;\n    vec2 sb = (q - vec2(-0.36, 0.43));\n    sb = mat2(0.87, -0.5, 0.5, 0.87) * sb / vec2(0.30, 0.13);\n    float softbox = smoothstep(1.0, 0.25, length(sb)) * 0.42;                        // a window reflected in the glass\n    float F = pow(1.0 - z, 2.6);\n    // a thin-film sheen on the glass, kept to the brand's cyan and pink (no muddy rainbow)\n    vec3 iri = mix(vec3(0.42, 0.86, 1.0), vec3(1.0, 0.42, 0.86), 0.5 + 0.5 * sin(F * 7.0 + q.y * 2.2 + uT * 0.25));\n    vec3 shell = iri * F * 1.15 + vec3(0.55, 0.88, 1.0) * pow(1.0 - z, 7.0) * 0.9;\n    shell += vec3(1.0, 0.32, 0.72) * pow(max(dot(n, normalize(vec3(0.35, -0.85, 0.3))), 0.0), 2.0) * 0.35;  // warm bounce from below\n    float shade = 0.55 + 0.45 * max(dot(n, L), 0.0);\n\n    vec3 orb = inner * uFill * shade + shell + spec + softbox;\n    float aa = smoothstep(1.0, 1.0 - 1.5 / uR, d);\n    col = mix(col, orb, aa);\n  }\n\n  col = 1.0 - exp(-col * 1.3);                       // filmic roll-off: bright stays bright without clipping\n  col = mix(vec3(0.027, 0.027, 0.051), col, uFade);  // fade to the cosmic midnight background\n  gl_FragColor = vec4(col, 1.0);\n}\n";
  var gl = cv.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  function bail() { document.documentElement.classList.add('nogl'); if (cv.parentNode) cv.remove(); }
  if (!gl) return bail();
  function sh(t, s) { var x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); return gl.getShaderParameter(x, gl.COMPILE_STATUS) ? x : null; }
  var vs = sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'), fs = sh(gl.FRAGMENT_SHADER, FS);
  var pr = vs && fs && gl.createProgram(); if (!pr) return bail();
  gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr); if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return bail();
  gl.useProgram(pr); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var a = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  var U = {}; ['uRes', 'uT', 'uC', 'uR', 'uGlow', 'uFill', 'uRing', 'uRingA', 'uFade'].forEach(function (k) { U[k] = gl.getUniformLocation(pr, k); });

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (x) { return Math.max(0, Math.min(1, x)); }, span = function (t, a, b) { return clamp((t - a) / (b - a)); };
  var outExpo = function (x) { return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x); }, lerp = function (a, b, x) { return a + (b - a) * x; };
  var W = 0, H = 0, dpr = 1, swirl = 3, last = 0, start = 0, vis = true, mx = 0, my = 0, tx = 0, ty = 0;
  addEventListener('pointermove', function (e) { tx = e.clientX / innerWidth * 2 - 1; ty = e.clientY / innerHeight * 2 - 1; }, { passive: true });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { vis = es[0].isIntersecting; if (vis) requestAnimationFrame(frame); }).observe(cv);

  function frame(now) {
    if (!vis) { last = 0; return; }
    var b = cv.getBoundingClientRect();
    var w = Math.round(b.width * Math.min(devicePixelRatio || 1, 2)), h = Math.round(b.height * Math.min(devicePixelRatio || 1, 2));
    if (w !== W || h !== H) { W = w; H = h; dpr = W / b.width; cv.width = W; cv.height = H; gl.viewport(0, 0, W, H); }
    if (!start) start = now;
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
    var t = reduce ? 9 : (now - start) / 1000;
    mx += (tx - mx) * 0.05; my += (ty - my) * 0.05;
    var s = slot.getBoundingClientRect();
    var cx = s.left + s.width / 2 - b.left + (reduce ? 0 : mx * 10), cy = s.top + s.height / 2 - b.top + (reduce ? 0 : my * 8);
    var R = lerp(2.2, s.width / 2, outExpo(span(t, 0.2, 1.3)));
    swirl += dt * lerp(3.2, 0.55, span(t, 0.6, 2.2));
    var glow = lerp(0, 1.5, span(t, 0, 0.35)) - 0.55 * span(t, 0.6, 1.4) + 0.08 * Math.sin(now / 900) * span(t, 1.6, 2.6);
    gl.uniform2f(U.uRes, W, H); gl.uniform1f(U.uT, swirl);
    gl.uniform2f(U.uC, cx * dpr, (b.height - cy) * dpr); gl.uniform1f(U.uR, Math.max(R, 0.5) * dpr);
    gl.uniform1f(U.uGlow, Math.max(glow, 0)); gl.uniform1f(U.uFill, lerp(0.35, 1, span(t, 0.2, 1))); gl.uniform1f(U.uRing, 0); gl.uniform1f(U.uRingA, 0); gl.uniform1f(U.uFade, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!reduce || t < 9) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
