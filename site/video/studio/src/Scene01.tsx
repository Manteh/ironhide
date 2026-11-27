import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, Sequence, continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Orb } from './Orb';
import { GLYPHS, ADV } from './glyphs';

// Scene 01, "Open": the orb blooms out of a point of light, shrinks, slides into the word, and the narration starts as the word appears.
export const SCENE01_FRAMES = 400; // 13.3 s at 30 fps
const VO_AT = 2.4;                 // the voice starts once the word has nearly finished appearing

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const lerp = (a: number, b: number, x: number) => a + (b - a) * x;
const swirlAt = (t: number) => { let s = 3; for (let x = 0; x < t; x += 1 / 60) s += (1 / 60) * lerp(3.2, 0.55, span(x, 0.6, 2.2)); return s; };

// what the voice says, and when (seconds into the scene)
const CAPTIONS: { text: string; from: number; to: number }[] = [
  { text: 'No ads.', from: VO_AT + 4.2, to: VO_AT + 4.7 },
  { text: 'No endless rows of stuff you’ll never watch.', from: VO_AT + 4.7, to: VO_AT + 7.3 },
  { text: 'Nothing keeping track of you.', from: VO_AT + 7.3, to: 12.4 },
];

const useFont = () => {
  const [h] = useState(() => delayRender('font'));
  useEffect(() => {
    const f = new FontFace('Outfit', `url(${staticFile('fonts/Outfit.ttf')})`, { weight: '100 900' });
    f.load().then((ff) => { document.fonts.add(ff); continueRender(h); }).catch(() => continueRender(h));
  }, [h]);
};

export const Scene01: React.FC = () => {
  useFont();
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const t = frame / fps;

  // the word, laid out exactly like the app's start-up screen, at 1080p
  const fs = 300, SC = fs / 1000, slotR = 0.32 * fs;
  const total = 2.346 * fs, x0 = W / 2 - total / 2;
  const slotX = x0 + slotR, base = H / 2 + 0.4048 * fs, slotY = base - slotR, top = base - 0.9048 * fs;
  const pens: number[] = []; let pen = x0 + 0.675 * fs; ADV.forEach((a) => { pens.push(pen); pen += a * SC - 0.035 * fs; });

  // the orb
  const r0 = Math.min(W, H) * 0.21;
  const bloom = outExpo(span(t, 0.28, 1.25)), shrink = inOut(span(t, 1.3, 1.85)), slide = inOut(span(t, 1.8, 2.45));
  const exit = inOut(span(t, 12.4, 13.2));
  let R = lerp(lerp(2.2, r0, bloom), slotR, shrink);
  let cx = lerp(W / 2, slotX, slide), cy = lerp(H / 2, slotY, slide);
  R = lerp(R, slotR * 1.6, exit); cx = lerp(cx, W / 2, exit); cy = lerp(cy, H / 2, exit);
  const glow = lerp(0, 1.5, span(t, 0, 0.35)) - 0.55 * span(t, 0.6, 1.4) + 0.1 * Math.sin(t * 2.3) * span(t, 2.4, 3.2);
  const wave = span(t, 1.8, 2.7);
  const ring = lerp(slotR * 2, Math.hypot(W, H) * 0.95, outCubic(wave));
  const ringA = wave > 0 && wave < 1 ? Math.sin(Math.PI * Math.min(1, wave * 1.15)) * (1 - wave) * 1.6 : 0;
  const fill = lerp(0.35, 1, span(t, 0.2, 1));

  // the letters rise in behind the orb, one after another, and leave before the next scene
  const wordOut = 1 - span(t, 12.4, 12.9);

  return (
    <AbsoluteFill style={{ background: '#07070d', fontFamily: 'Outfit, sans-serif' }}>
      <Orb cx={cx} cy={cy} R={R} swirl={swirlAt(t)} glow={glow} fill={fill} ring={ring} ringA={ringA} />
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible', opacity: wordOut }}>
        <defs>
          <linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={(base - top) / SC} y2={(base - top - fs) / SC}>
            <stop offset=".3" stopColor="#fff" /><stop offset="1" stopColor="#d9d2ff" />
          </linearGradient>
        </defs>
        {GLYPHS.map((d, i) => {
          const k = outExpo(span(t, 2.15 + i * 0.085, 2.85 + i * 0.085));
          return (
            <g key={i} opacity={k} transform={`translate(${pens[i]},${base + (1 - k) * 0.18 * fs}) scale(${SC},${-SC})`}>
              <path d={d} fill="url(#g)" />
            </g>
          );
        })}
      </svg>
      {CAPTIONS.map((c, i) => {
        const inn = span(t, c.from, c.from + 0.35), out = span(t, c.to - 0.25, c.to), o = inn * (1 - out);
        return (
          <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: base + 150, textAlign: 'center', fontSize: 56, fontWeight: 500, letterSpacing: '-0.02em', color: '#d8d3f2', opacity: o * wordOut, transform: `translateY(${(1 - inn) * 18}px)` }}>
            {c.text}
          </div>
        );
      })}
      <Sequence from={Math.round(VO_AT * fps)}><Audio src={staticFile('vo/01-open.wav')} volume={1} /></Sequence>
    </AbsoluteFill>
  );
};
