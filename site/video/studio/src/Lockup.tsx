import React from 'react';
import { Orb } from './Orb';
import { GLYPHS, ADV } from './glyphs';
import { W, H, clamp, span, inOut, outExpo, outCubic, lerp } from './lib';

const swirlAt = (t: number) => { let s = 3; for (let x = 0; x < t; x += 1 / 30) s += (1 / 30) * lerp(3.2, 0.55, span(x, 0.6, 2.2)); return s; };

// The orb and the word, the same as the start-up screen: the orb arrives, shrinks, slides left, and "rbie" rises behind it.
// u is seconds since the lockup began.
export const Lockup: React.FC<{ u: number; bloomAt?: number; offsetY?: number; fs?: number }> = ({ u, offsetY = 0, fs = 300 }) => {
  const SC = fs / 1000, slotR = 0.32 * fs;
  const total = 2.346 * fs, x0 = W / 2 - total / 2;
  const slotX = x0 + slotR, base = H / 2 + 0.4048 * fs + offsetY, slotY = base - slotR, top = base - 0.9048 * fs;
  const pens: number[] = []; let pen = x0 + 0.675 * fs; ADV.forEach((a) => { pens.push(pen); pen += a * SC - 0.035 * fs; });
  const r0 = Math.min(W, H) * 0.21;
  const bloom = outExpo(span(u, 0, 0.7)), shrink = inOut(span(u, 1.0, 1.55)), slide = inOut(span(u, 1.5, 2.15));
  const R = lerp(lerp(2.2, r0, bloom), slotR, shrink);
  const cx = lerp(W / 2, slotX, slide), cy = lerp(H / 2 + offsetY, slotY, slide);
  const glow = lerp(0, 1.5, span(u, 0, 0.3)) - 0.55 * span(u, 0.3, 1.1) + 0.1 * Math.sin(u * 2.3) * span(u, 2.1, 2.9);
  const wave = span(u, 1.5, 2.4);
  const ring = lerp(slotR * 2, Math.hypot(W, H) * 0.95, outCubic(wave));
  const ringA = wave > 0 && wave < 1 ? Math.sin(Math.PI * Math.min(1, wave * 1.15)) * (1 - wave) * 1.6 : 0;
  return (
    <>
      <Orb cx={cx} cy={cy} R={R} swirl={swirlAt(u + 4)} glow={glow} fill={lerp(0.35, 1, span(u, 0, 0.7))} ring={ring} ringA={ringA} />
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <defs>
          <linearGradient id="lg" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={(base - top) / SC} y2={(base - top - fs) / SC}>
            <stop offset=".3" stopColor="#fff" /><stop offset="1" stopColor="#d9d2ff" />
          </linearGradient>
        </defs>
        {GLYPHS.map((d, i) => {
          const k = outExpo(span(u, 1.85 + i * 0.085, 2.55 + i * 0.085));
          return <g key={i} opacity={k} transform={`translate(${pens[i]},${base + (1 - k) * 0.18 * fs}) scale(${SC},${-SC})`}><path d={d} fill="url(#lg)" /></g>;
        })}
      </svg>
    </>
  );
};
