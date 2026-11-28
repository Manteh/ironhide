import React from 'react';
import { OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';

export const FPS = 30, W = 1920, H = 1080;
export const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const span = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
export const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const lerp = (a: number, b: number, x: number) => a + (b - a) * x;

// How long each scene runs (seconds), and where it starts in the whole video.
export const DUR: Record<number, number> = { 1: 13.333, 2: 19.0, 3: 19.8, 4: 7.2, 5: 25.2, 6: 14.8, 7: 20.5 };
export const START: Record<number, number> = {};
{ let s = 0; for (let i = 1; i <= 7; i++) { START[i] = s; s += DUR[i]; } }
export const TOTAL_SECONDS = Object.values(DUR).reduce((a, b) => a + b, 0);
export const LEAD = 0.5; // the voice starts this long after a scene begins (scene 1 has its own)

// a thing that fades in at a, out at b
export const vis = (t: number, a: number, b: number, fin = 0.35, fout = 0.3) => span(t, a, a + fin) * (1 - span(t, b - fout, b));

export const Backdrop: React.FC<{ glow?: number }> = ({ glow = 0.5 }) => (
  <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(60% 55% at 50% 45%, rgba(255,255,255,${0.035 * glow * 2}), transparent 70%), #07070d` }} />
);

export const Glass: React.FC<{ x: number; y: number; w: number; h: number; r?: number; style?: React.CSSProperties; children?: React.ReactNode }> = ({ x, y, w, h, r = 22, style, children }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: r, overflow: 'hidden', background: '#0b0a14', border: '1px solid rgba(255,255,255,.14)', boxShadow: '0 50px 110px -30px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.08)', ...style }}>{children}</div>
);

export const Chip: React.FC<{ children: React.ReactNode; on?: number; size?: number }> = ({ children, on = 0, size = 38 }) => (
  <div style={{
    padding: `${size * 0.32}px ${size * 0.7}px`, borderRadius: 999, fontSize: size, fontWeight: 500, letterSpacing: '-0.01em', whiteSpace: 'nowrap',
    color: on > 0.5 ? '#0c0b14' : '#d8d3f2', background: on > 0.5 ? '#f4f2ff' : 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.14)',
    boxShadow: on > 0.5 ? '0 12px 40px rgba(255,255,255,.18)' : 'none', transform: `scale(${1 + on * 0.06})`,
  }}>{children}</div>
);

export const Words: React.FC<{ children: React.ReactNode; size?: number; color?: string; weight?: number; style?: React.CSSProperties }> = ({ children, size = 64, color = '#e9e6fa', weight = 500, style }) => (
  <div style={{ fontSize: size, fontWeight: weight, color, letterSpacing: '-0.025em', lineHeight: 1.1, ...style }}>{children}</div>
);

// A piece of a screen recording, cropped to the part that matters, in a soft glass frame.
export const Shot: React.FC<{
  src: string; vw: number; vh: number; clipFrom: number; clipTo: number; at: number; rate?: number;
  crop?: { x: number; y: number; w: number; h: number }; width: number; cx?: number; cy?: number; zoomTo?: number; fadeIn?: number; fadeOut?: number;
}> = (p) => {
  const rate = p.rate ?? 1, dur = (p.clipTo - p.clipFrom) / rate;
  return (
    <Sequence from={Math.round(p.at * FPS)} durationInFrames={Math.max(1, Math.round(dur * FPS))} layout="none">
      <ShotInner {...p} rate={rate} dur={dur} />
    </Sequence>
  );
};
const ShotInner: React.FC<any> = (p) => {
  const f = useCurrentFrame(), t = f / FPS;
  const crop = p.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const sx = p.width / (crop.w * p.vw), h = crop.h * p.vh * sx;
  const cx = p.cx ?? W / 2, cy = p.cy ?? H / 2;
  const o = outCubic(span(t, 0, p.fadeIn ?? 0.4)) * (1 - span(t, p.dur - (p.fadeOut ?? 0.3), p.dur));
  const z = 1 + ((p.zoomTo ?? 1) - 1) * span(t, 0, p.dur);
  return (
    <Glass x={cx - p.width / 2} y={cy - h / 2} w={p.width} h={h} style={{ opacity: o, transform: `scale(${(0.97 + 0.03 * o) * z})` }}>
      <OffthreadVideo
        src={staticFile(p.src)} muted volume={0} playbackRate={p.rate}
        trimBefore={Math.round(p.clipFrom * FPS)} trimAfter={Math.round(p.clipTo * FPS)}
        style={{ position: 'absolute', left: -crop.x * p.vw * sx, top: -crop.y * p.vh * sx, width: p.vw * sx, height: p.vh * sx }}
      />
    </Glass>
  );
};

export const VOICE = (n: number, file: string) => (
  <Sequence from={Math.round(LEAD * FPS)} layout="none"><AudioTag file={file} /></Sequence>
);
import { Audio } from 'remotion';
const AudioTag: React.FC<{ file: string }> = ({ file }) => <Audio src={staticFile(`vo/${file}`)} volume={1} />;
