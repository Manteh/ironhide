// A Sanctuary for Cinema: a full-screen reading room, shown once on first launch and from the appbar orb.
import { onLeave } from '../main.js';

const CSS = `
.mf{position:fixed;inset:0;z-index:100000;background:#07070d;color:#f3f1ff;font-family:'Outfit',-apple-system,BlinkMacSystemFont,sans-serif;-webkit-font-smoothing:antialiased;opacity:0;transition:opacity .55s ease}
.mf.on,.mf.instant{opacity:1}.mf.instant{transition:none}.mf.out{opacity:0;pointer-events:none}
.mf-drag{position:absolute;top:0;left:0;right:0;height:40px;-webkit-app-region:drag;z-index:3}
.mf-progress{position:absolute;top:0;left:0;height:3px;width:0;z-index:4;pointer-events:none;background:linear-gradient(90deg,#8b6ff0,#70d8ff,#e5b369)}
.mf-x{position:absolute;top:12px;right:18px;z-index:5;-webkit-app-region:no-drag;display:flex;align-items:center;gap:9px;height:36px;padding:0 15px;border-radius:999px;
  border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);color:#e9e5ff;font:500 13px 'Outfit',system-ui,sans-serif;cursor:pointer;transition:background .2s}
.mf-x:hover{background:rgba(255,255,255,.15)}.mf-x kbd{font:inherit;font-size:11px;opacity:.5}
.mf-scroll{z-index:1;position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scroll-behavior:smooth;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent}
.mf .canvas{position:relative;max-width:1080px;margin:0 auto;padding:0 28px 140px;counter-reset:ch}
.mf header.hero{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;text-align:center;padding:max(56px,calc(38vh - 170px)) 0 40px}
.mf .hero-emblem-wrap{position:relative;width:340px;height:340px;display:grid;place-items:center;margin-bottom:8px}
.mf .hero-orb-canvas{width:340px;height:340px;display:block}
.mf .hero-orb-fallback{position:absolute;inset:0;width:100%;height:100%;display:none;border-radius:50%}
.nogl .mf .hero-orb-fallback{display:block}.nogl .mf .hero-orb-canvas{display:none}
.mf h1{margin:0 0 20px;font-size:clamp(42px,6.6vw,80px);font-weight:700;letter-spacing:-.045em;line-height:1.03;
  background:linear-gradient(180deg,#fff 30%,#c9c0ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.mf p.standfirst{margin:0 auto;max-width:620px;font-size:clamp(17px,1.7vw,21px);line-height:1.62;color:rgba(222,217,248,.8)}
.mf .cue{margin-top:48px;display:flex;flex-direction:column;align-items:center;gap:12px;font-size:11.5px;letter-spacing:.2em;text-transform:uppercase;color:rgba(200,195,230,.5)}
.mf .cue i{width:1px;height:48px;transform-origin:top;background:linear-gradient(#8b6ff0,transparent);animation:mfcue 2.4s ease-in-out infinite}
@keyframes mfcue{0%{transform:scaleY(0);opacity:1}55%{transform:scaleY(1);opacity:1}100%{transform:scaleY(1);opacity:0}}
.mf .prose{max-width:700px;margin:0 auto}
.mf .prose p{margin:0 0 28px;font-size:19.5px;line-height:1.85;color:#dedaf7}
.mf .prose p.opening-lead{font-size:clamp(21px,2.3vw,26px);line-height:1.6;color:#fff;font-weight:500}
.mf .prose h2{counter-increment:ch;margin:96px 0 24px;font-size:clamp(30px,3.8vw,44px);font-weight:700;letter-spacing:-.035em;line-height:1.1;color:#fff}
.mf .prose h2::before{content:counter(ch,upper-roman);display:block;margin-bottom:14px;font-size:12px;font-weight:600;letter-spacing:.26em;color:#8b6ff0}
.mf .prose em{font-style:italic;color:#fff}
.mf .quote-artifact{margin:44px 0;padding:30px 34px 26px;border-radius:16px;background:rgba(18,16,26,.65);border:1px solid rgba(255,255,255,.08);box-shadow:0 16px 40px -12px rgba(0,0,0,.6)}
.mf .quote-text{margin:0 0 18px;font-size:19.5px;line-height:1.65;color:#f5f4ff;font-weight:400}
.mf .quote-footer{display:flex;justify-content:space-between;align-items:center;font-size:13px;letter-spacing:.02em;border-top:1px solid rgba(255,255,255,.07);padding-top:14px}
.mf .quote-author{color:#c9c4eb;font-weight:600}
.mf .quote-topic{color:rgba(200,195,230,.55);text-transform:uppercase;font-size:11px;letter-spacing:.06em}
.mf figure.plate{margin:80px 0 24px;width:100%}
.mf .plate-box{position:relative;width:100%;aspect-ratio:21/9;border-radius:22px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#000;box-shadow:0 20px 50px -10px rgba(0,0,0,.8)}
.mf .plate-box img{width:100%;height:100%;object-fit:cover;display:block;transform:scale(1.02);transition:transform 1.6s cubic-bezier(.2,.7,.2,1)}
.mf figure.plate.in .plate-box img{transform:scale(1)}
.mf .plate-box::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent 60%,rgba(7,7,9,.55));pointer-events:none}
.mf figure.plate figcaption{margin-top:14px;text-align:center;font-size:13.5px;font-style:italic;color:rgba(200,195,230,.5)}
.mf .orbie-inline{display:inline;white-space:nowrap;font-weight:500;color:#fff}
.mf .inline-orb{width:.82em;height:.82em;display:inline-block;vertical-align:-.06em;margin-right:.18em;border-radius:50%;filter:drop-shadow(0 0 5px rgba(165,140,255,.7));animation:mfglow 4s ease-in-out infinite alternate}
@keyframes mfglow{0%{transform:scale(.96)}100%{transform:scale(1.05);filter:drop-shadow(0 0 8px rgba(112,216,255,.85))}}
.mf footer.colophon{margin-top:110px;padding-top:56px;border-top:1px solid rgba(255,255,255,.08);text-align:center}
.mf .colophon-orb-img{width:48px;height:48px;border-radius:50%;display:block;margin:0 auto 18px;filter:drop-shadow(0 4px 18px rgba(139,111,240,.55))}
.mf .colophon-title{font-size:20px;font-weight:600;color:#fff;margin-bottom:6px}
.mf .colophon-subtitle{font-size:14.5px;color:rgba(200,195,230,.65);margin-bottom:22px}
.mf .colophon-meta{margin:0 auto 38px;font-size:13.5px;line-height:1.7;color:rgba(200,195,230,.45)}
.mf-enter{height:54px;padding:0 34px;border:0;border-radius:999px;cursor:pointer;font:600 16px 'Outfit',system-ui,sans-serif;color:#120d2e;
  background:linear-gradient(135deg,#fff,#d8ceff);box-shadow:0 12px 44px rgba(139,111,240,.5);transition:transform .25s,box-shadow .25s}
.mf-enter:hover{transform:translateY(-2px);box-shadow:0 18px 60px rgba(160,130,255,.7)}
.mf .rv{opacity:0;transform:translateY(26px);transition:opacity .9s ease,transform .9s cubic-bezier(.2,.7,.2,1)}
.mf .rv.in{opacity:1;transform:none}
@media (max-width:700px){.mf header.hero{padding-top:max(56px,calc(38vh - 120px))}.mf .hero-emblem-wrap,.mf .hero-orb-canvas{width:240px;height:240px}.mf .plate-box{aspect-ratio:16/10}.mf .prose p{font-size:18px}}
@media (prefers-reduced-motion:reduce){.mf .rv{opacity:1;transform:none;transition:none}.mf *{animation:none!important}}
`;

const FS_SHADER = `precision highp float;
uniform vec2 uRes;
uniform float uT;
uniform vec2 uC;
uniform float uR;
uniform float uGlow;
uniform float uFill;

float hash(vec3 p) { p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 q = (p - uC) / uR;
  float d = length(q);
  float dpx = length(p - uC);

  // Outer bloom aura with natural exponential decay to transparent
  float out1 = max(d - 1.0, 0.0);
  float falloff = smoothstep(uRes.x * 0.45, uRes.x * 0.18, dpx);
  vec3 aura = vec3(0.42, 0.28, 1.0) * exp(-out1 * 2.8) * 0.35 * uGlow;
  aura += vec3(0.75, 0.2, 0.65) * exp(-out1 * 1.6) * 0.12 * uGlow;
  float auraAlpha = clamp(exp(-out1 * 2.4) * 0.5 * uGlow * falloff, 0.0, 1.0);

  vec3 col = aura * falloff;
  float alpha = (d < 1.0) ? 1.0 : auraAlpha;

  if (d < 1.0) {
    float z = sqrt(1.0 - d * d);
    vec3 n = vec3(q, z);

    // Liquid light inside: domain-warped noise seen through curved glass
    vec2 uv = q * (1.0 + 0.45 * (1.0 - z));
    float t = uT;
    vec3 pp = vec3(uv * 1.35, t * 0.11);
    float w1 = fbm(pp + vec3(0.0, 0.0, t * 0.05));
    float w2 = fbm(pp + vec3(5.2, 1.3, 2.0));
    float neb = fbm(pp + vec3(w1 * 1.7, w2 * 1.7, t * 0.07));
    vec3 inner = mix(vec3(0.035, 0.015, 0.16), vec3(0.42, 0.18, 0.95), smoothstep(0.30, 0.78, neb));
    inner = mix(inner, vec3(0.95, 0.25, 0.70), smoothstep(0.55, 0.85, w1) * 0.6);
    float ridge = 1.0 - abs(2.0 * fbm(pp * 0.75 + vec3(w2 * 1.3, w1 * 1.3, t * 0.06)) - 1.0);
    inner += vec3(0.50, 0.80, 1.0) * pow(ridge, 7.0) * 0.42;
    inner += vec3(1.0, 0.60, 0.95) * pow(ridge, 18.0) * 0.38;
    inner *= (0.32 + 0.85 * z) * (0.6 + 0.4 * smoothstep(1.0, 0.55, d));
    inner += vec3(0.8, 0.72, 1.0) * exp(-d * d * 4.0) * 0.16;

    // Glass shell with softbox window reflection, iridescent rim, and specular highlight
    vec3 L = normalize(vec3(-0.5, 0.62, 0.62));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), 220.0) * 1.6;
    vec2 sb = (q - vec2(-0.36, 0.43));
    sb = mat2(0.87, -0.5, 0.5, 0.87) * sb / vec2(0.30, 0.13);
    float softbox = smoothstep(1.0, 0.25, length(sb)) * 0.42;
    float F = pow(1.0 - z, 2.6);
    vec3 iri = mix(vec3(0.42, 0.86, 1.0), vec3(1.0, 0.42, 0.86), 0.5 + 0.5 * sin(F * 7.0 + q.y * 2.2 + uT * 0.25));
    vec3 shell = iri * F * 1.15 + vec3(0.55, 0.88, 1.0) * pow(1.0 - z, 7.0) * 0.9;
    shell += vec3(1.0, 0.32, 0.72) * pow(max(dot(n, normalize(vec3(0.35, -0.85, 0.3))), 0.0), 2.0) * 0.35;
    float shade = 0.55 + 0.45 * max(dot(n, L), 0.0);\n
    vec3 orb = inner * uFill * shade + shell + spec + softbox;
    float aa = smoothstep(1.0, 1.0 - 1.5 / uR, d);
    col = mix(aura * falloff, orb, aa);
    alpha = mix(auraAlpha, 1.0, aa);
  }

  col = 1.0 - exp(-col * 1.3);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

const HTML_CONTENT = `<div class="canvas"><header class="hero prose" id="heroHeader">
    <div class="hero-emblem-wrap">
      <canvas id="heroOrbCanvas" class="hero-orb-canvas" width="720" height="720"></canvas>
      <img src="orb.png" alt="Orbie" class="hero-orb-fallback">
    </div>

    <h1>A Sanctuary for Cinema</h1>
    <p class="standfirst">Built for those who value the beauty of film, the dignity of craftsmanship, and the quiet room shared among friends.</p>
  <div class="cue"><span>Scroll</span><i></i></div></header>

  <div class="prose">
    <div class="quote-artifact">
      <div class="quote-text">
        It comes down to taste. It comes down to trying to expose yourself to the best things that humans have done, and then trying to bring those things into what you’re making.
      </div>
      <div class="quote-footer">
        <span class="quote-author">Steve Jobs</span>
        <span class="quote-topic">On Taste and Immersion</span>
      </div>
    </div>

    <p class="opening-lead">
      We built <span class="orbie-inline"><img src="orb.png" class="inline-orb" alt="">Orbie</span> out of a profound love for cinema, guided by the conviction that a great film remains one of the most transformative emotional experiences human beings have ever created.
    </p>

    <p>
      When the lights fade and the projector beam strikes the canvas, the entire outside world recedes, allowing you to live completely within another human being’s perspective, feeling what they feel, perceiving the world through their senses, and finding words for grief you never understood or a dream you carry for thirty years. That shared stillness is sacred, demanding an atmosphere of quiet, presence, and undivided care.
    </p>
  </div>

  <figure class="plate">
    <div class="plate-box">
      <img src="cinema_pixel.jpg" alt="A classic cinema auditorium with a 35mm projector beam cutting through the dark" loading="eager">
    </div>
    <figcaption>The 35mm projector beam cutting across the auditorium.</figcaption>
  </figure>

  <div class="prose">
    <h2>The Sensory Shock</h2>

    <p>
      Commercial streaming platforms systematically degraded that wonder, reducing a century of artistic devotion into frictionless background noise by crushing the image and flattening dynamic range to trim corporate bandwidth costs.
    </p>

    <p>
      When you experience a film uncompromised in its master state, the revelation strikes your senses with immediate physical weight. Colors arrive with visceral richness and warmth, accompanied by deep, velvety shadows where you can distinguish the intricate weave of a wool coat or the faint glint of moisture in low light, preserving the exact golden dusk Gordon Willis labored to photograph on <em>The Godfather</em>. Film grain breathes naturally across the frame with organic vitality, holding your focus so entirely that the impulse to check a phone or glance away simply evaporates.
    </p>

    <p>
      As the story unfolds, the rigid geometry of the computer screen softly dissolves, because just as light bouncing from a theater canvas naturally washes across the surrounding walls, <span class="orbie-inline"><img src="orb.png" class="inline-orb" alt="">Orbie</span> lets the atmosphere of the scene spill past the edge of the glass, bathing your room in electric cyan during a lightning strike or warming the shadows with the amber glow of stage footlights.
    </p>

    <p>
      Sound brings an even deeper sensory awakening, moving with genuine dynamic breath so that intimate dialogue feels dry, close, and whispered directly at your ear, before an orchestral swell or seismic engine rumble physically displaces the air in the room, tightening your chest and pulling your pulse into the rhythm of the cut.
    </p>
  </div>

  <figure class="plate">
    <div class="plate-box">
      <img src="sensory_pixel.jpg" alt="A private viewing room with ambient bias light bleeding into the dark room in electric cyan and violet" loading="lazy">
    </div>
    <figcaption>Ambient light spilling past the glass edge, washing the room in electric cyan and violet.</figcaption>
  </figure>

  <div class="prose">
    <h2>The Intuition of a Friend</h2>

    <p>
      Finding a film ought to feel like talking with someone who genuinely understands your taste, rather than confronting the familiar exhaustion of clicking through endless commercial tiles pushed by corporate engagement metrics until you give up in frustration and turn the television off.
    </p>

    <p>
      <span class="orbie-inline"><img src="orb.png" class="inline-orb" alt="">Orbie</span> behaves like a trusted friend who knows what captivates your imagination, reaching over to pull a single title from the shelf and handing it to you with the quiet certainty that it will stay with you long after the final cut, allowing you to settle into the evening calm and ready to enter the story.
    </p>
  </div>

  <figure class="plate">
    <div class="plate-box">
      <img src="intuition_pixel.jpg" alt="Two friends in a cozy late-night library sharing a classic film from the shelf" loading="lazy">
    </div>
    <figcaption>A trusted companion reaching to the shelf, knowing what will stay with you.</figcaption>
  </figure>

  <div class="prose">
    <h2>The Back of the Cabinet</h2>

    <p>
      We believe software should be built with the same moral devotion that guided the craftspeople who made the art it presents, an ethos Steve Jobs articulated through the discipline of fine carpentry:
    </p>

    <div class="quote-artifact">
      <div class="quote-text">
        When you're a carpenter making a beautiful chest of drawers, you're not going to use a piece of plywood on the back, even though it faces the wall and nobody will ever see it. You'll know it's there, so you're going to use a beautiful piece of wood on the back. For you to sleep well at night, the aesthetic, the quality, has to be carried all the way through.
      </div>
      <div class="quote-footer">
        <span class="quote-author">Steve Jobs</span>
        <span class="quote-topic">The Carpentry Principle</span>
      </div>
    </div>

    <p>
      That devotion governs every layer of <span class="orbie-inline"><img src="orb.png" class="inline-orb" alt="">Orbie</span>, where the machinery recedes so entirely that the screen transforms into pure glass, motion glides with the fluid ease of running water, and the pristine master copy begins instantly with the precise color grading and acoustic mastering envisioned in the mixing suite.
    </p>

    <p>
      Because craftsmanship also means honoring the viewer, the software treats your private life with absolute dignity, ensuring that whatever moves you to tears in the middle of the night remains solely on your personal drive, immune to remote surveillance, data harvesting, or behavioral profiling.
    </p>
  </div>

  <figure class="plate">
    <div class="plate-box">
      <img src="craft_pixel.jpg" alt="A late-night Mac workspace running the Orbie orb with a glowing screen and warm desk lamp" loading="lazy">
    </div>
    <figcaption>Late night in the workshop, built with the patience of woodwork.</figcaption>
  </figure>

  <div class="prose">
    <h2>The Private Screening Room</h2>

    <p>
      Historically, the greatest film experiences occurred within private screening rooms, where dedicated directors and cinephiles gathered a handful of close companions behind heavy soundproof doors, dimming the sconces to share the spell of an uncompressed master reel in complete intimacy.
    </p>

    <p>
      <span class="orbie-inline"><img src="orb.png" class="inline-orb" alt="">Orbie</span> recreates that sanctuary digitally across any geographic distance, keeping playback synchronized to the exact millisecond so that when an orchestral melody drops to a whisper or the image abruptly cuts to black, everyone in your circle holds their breath together in genuine communion, restoring the warmth of a late-night private screening among the people you trust most.
    </p>
  </div>

  <figure class="plate">
    <div class="plate-box">
      <img src="together_pixel.jpg" alt="Two private screening rooms across geographic distance synchronized to the exact millisecond" loading="lazy">
    </div>
    <figcaption>Synchronized across quiet distance, holding our breath at the exact same frame.</figcaption>
  </figure>

  <div class="prose">
    <h2>What We Owe the Filmmakers</h2>

    <p>
      Access to art without respect for its creators remains hollow, a truth illuminated by Jony Ive when describing the profound human connection embedded within genuine care:
    </p>

    <div class="quote-artifact">
      <div class="quote-text">
        It’s very easy to be different, but very difficult to be better. Most things are surrounded by an absence of care. When you sense that someone truly cared about every single detail, you feel something profound. You feel a connection to the human beings who made it.
      </div>
      <div class="quote-footer">
        <span class="quote-author">Jony Ive</span>
        <span class="quote-topic">On the Nature of Care</span>
      </div>
    </div>

    <p>
      Producing a masterwork demands immense personal sacrifice, requiring hundreds of dedicated artists to stand in the freezing mud at dawn, carpenters to construct authentic sets by hand, focus pullers to track moving actors with microscopic precision, composers to spend sleepless months discovering an essential melody, and editors to debate the pacing of a single cut.
    </p>

    <p>
      While streaming monopolies extract billions while distributing microscopic fractions of a penny to the artists who made the work, we believe viewers who are shaken to their core should have a direct channel of gratitude, enabling you to send support straight to the composer whose score haunts your thoughts, help finance an independent director’s next production, or contribute to archival film preservation crews, transforming the audience from passive consumers into real patrons of cinema.
    </p>
  </div>

  <figure class="plate">
    <div class="plate-box">
      <img src="artifact_pixel.jpg" alt="Archival 35mm film on a glowing lightbox, the orchestral score, and direct patronage to the creators" loading="lazy">
    </div>
    <figcaption>Archival 35mm film on the lightbox, the orchestral score, and direct patronage to the creators.</figcaption>
  </figure>

  <div class="prose">
    <h2>The Hearth and the Closed Door</h2>

    <p>
      Because trust cannot be mass-produced, <span class="orbie-inline"><img src="orb.png" class="inline-orb" alt="">Orbie</span> remains permanently invite-only, deliberately foregoing public registration and promotional marketing in order to protect the quiet intimacy of the room. When digital platforms expand indiscriminately, the noise inevitably drowns out the stillness, crowding the benches and eroding the mutual care required for a true sanctuary to endure.
    </p>

    <p>
      Every invitation token carries the enduring reputation of the member who granted it, binding personal honor to collective conduct.
    </p>

    <p>
      In the depth of winter, a warm hearth requires solid stone walls, because throwing the heavy door wide open to the howling gale outside merely extinguishes the fire for everyone gathered around it, whereas keeping the sanctuary quiet and protected ensures that the light on the screen remains pure for those who cherish cinema enough to guard it.
    </p>
  </div>

  <figure class="plate">
    <div class="plate-box">
      <img src="hearth_pixel.jpg" alt="A warm room with a glowing hearth and a cinema projector during a winter blizzard" loading="lazy">
    </div>
    <figcaption>The quiet room, light held against the winter storm.</figcaption>
  </figure>

  <footer class="colophon prose">
    <div class="colophon-emblem">
      <img src="orb.png" alt="Orbie" class="colophon-orb-img">
    </div>
    <div class="colophon-title">Orbie</div>
    <div class="colophon-subtitle">A sanctuary for those who value the beauty of cinema.</div>

    <p class="colophon-meta">
      Built natively for Apple Silicon.
    </p>
  <button class="mf-enter" type="button" data-enter>Enter Orbie</button></footer></div>`;

export function openManifesto({ first = false, intro = false, onClose } = {}) {
  document.getElementById('mf-root')?.remove();
  let styleEl = document.getElementById('mf-styles');
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'mf-styles'; styleEl.textContent = CSS; document.head.appendChild(styleEl); }

  const root = document.createElement('div');
  root.className = 'mf' + (intro ? ' instant' : ''); root.id = 'mf-root'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'A Sanctuary for Cinema');
  root.innerHTML = `<div class="mf-drag"></div><div class="mf-progress"></div><button class="mf-x" type="button">${first ? 'Skip' : 'Close'} <kbd>esc</kbd></button><div class="mf-scroll" tabindex="-1">${HTML_CONTENT}</div>`;
  document.body.appendChild(root);
  if (intro) { try { localStorage.setItem('orbie.manifesto.seen', '1'); } catch {} } else requestAnimationFrame(() => root.classList.add('on'));
  const scroller = root.querySelector('.mf-scroll'), bar = root.querySelector('.mf-progress');
  scroller.focus({ preventScroll: true });
  const enter = root.querySelector('[data-enter]'); if (enter && !first) enter.textContent = 'Back to Orbie';

  let closed = false, animId = 0;
  const cleanups = [];
  function close(silent) {
    if (closed) return; closed = true;
    try { localStorage.setItem('orbie.manifesto.seen', '1'); } catch {}
    cancelAnimationFrame(animId); cleanups.forEach((f) => f());
    root.classList.remove('on', 'instant'); void root.offsetWidth; root.classList.add('out');
    setTimeout(() => { root.remove(); styleEl.remove(); window.__introOrb && window.__introOrb.dispose(); }, 600);
    if (!silent && onClose) onClose();
  }
  root.querySelector('.mf-x').onclick = () => close();
  if (enter) enter.onclick = () => close();
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  window.addEventListener('keydown', onKey, true); cleanups.push(() => window.removeEventListener('keydown', onKey, true));

  // reading progress
  const onScroll = () => { const t = scroller.scrollHeight - scroller.clientHeight; if (t > 0) bar.style.width = Math.min(scroller.scrollTop / t * 100, 100) + '%'; };
  scroller.addEventListener('scroll', onScroll, { passive: true });

  // quiet reveal as each part comes into view
  const targets = [...root.querySelectorAll('.prose > *, figure.plate, .hero > *, footer.colophon > *')].filter((n) => !(intro && n.classList.contains('hero-emblem-wrap'))); // the orb is already on screen when handed over
  targets.forEach((n) => n.classList.add('rv'));
  if (intro) root.querySelectorAll('.hero > :not(.hero-emblem-wrap)').forEach((n, i) => { n.style.transitionDelay = (0.2 + i * 0.13) + 's'; });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { root: scroller, threshold: 0.12 });
    targets.forEach((n) => io.observe(n)); cleanups.push(() => io.disconnect());
  } else targets.forEach((n) => n.classList.add('in'));

  // the living orb. On a hand-over from the start-up screen, a still image held its place until this first frame is drawn.
  let live = false;
  const handed = intro && window.__introOrb; // the orb canvas the page has had since its first frame: adopt it
  if (handed) {
    const wrap = root.querySelector('.hero-emblem-wrap'); wrap.querySelector('canvas').style.display = 'none';
    handed.canvas.style.zIndex = '0'; root.insertBefore(handed.canvas, root.firstChild);
    window.__introOrbPos = () => { const r = wrap.getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, R: r.width * 0.318 }; };
  }
  const orbLive = () => {};
  const _unused = () => { if (live) return; live = true; requestAnimationFrame(() => { document.documentElement.classList.add('orb-live'); setTimeout(() => document.documentElement.classList.remove('intro', 'orb-live'), 600); }); };
  const cv = root.querySelector('#heroOrbCanvas');
  const gl = !handed && cv && cv.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (handed) { /* already live */ } else if (gl) {
    const sh = (type, s) => { const x = gl.createShader(type); gl.shaderSource(x, s); gl.compileShader(x); return gl.getShaderParameter(x, gl.COMPILE_STATUS) ? x : null; };
    const vs = sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'), fs = sh(gl.FRAGMENT_SHADER, FS_SHADER);
    const prog = vs && fs && gl.createProgram();
    if (prog) { gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog); }
    if (prog && gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const a = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
      const dpr = Math.min(window.devicePixelRatio || 2, 2), css = cv.clientWidth || 340;
      cv.width = Math.round(css * dpr); cv.height = Math.round(css * dpr); gl.viewport(0, 0, cv.width, cv.height);
      const U = {}; for (const k of ['uRes', 'uT', 'uC', 'uR', 'uGlow', 'uFill']) U[k] = gl.getUniformLocation(prog, k);
      gl.uniform2f(U.uRes, cv.width, cv.height); gl.uniform2f(U.uC, cv.width / 2, cv.height / 2);
      gl.uniform1f(U.uR, css * 0.318 * dpr); gl.uniform1f(U.uGlow, 1); gl.uniform1f(U.uFill, 1);
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, t0 = performance.now();
      let vis = true;
      const frame = (now) => { if (closed) return; if (vis) { gl.uniform1f(U.uT, 3 + (reduce ? 0 : (now - t0) / 1000 * 0.4)); gl.drawArrays(gl.TRIANGLES, 0, 3); orbLive(); } if (!reduce) animId = requestAnimationFrame(frame); };
      if ('IntersectionObserver' in window) { const o = new IntersectionObserver((es) => { vis = es[0].isIntersecting; }, { root: scroller }); o.observe(cv); cleanups.push(() => o.disconnect()); }
      frame(performance.now());
    } else { root.classList.add('nogl'); orbLive(); }
  } else { document.documentElement.classList.add('nogl'); orbLive(); }
  return close;
}

// As a page (#/manifesto, the appbar orb, ⌘K): opens the same full-screen reading room, and Close returns home.
export default async function manifesto() {
  const close = openManifesto({ onClose: () => { if (/^#\/(manifesto|sanctuary)/.test(location.hash)) location.hash = '#/'; } });
  onLeave(() => close(true));
}
