import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Backdrop, Chip, Glass, Shot, VOICE, Words, FPS, W, H, LEAD, clamp, span, inOut, outExpo, outCubic, lerp, vis } from './lib';
import { Lockup } from './Lockup';

const useT = () => useCurrentFrame() / FPS;
const w = (x: number) => LEAD + x; // a word time inside the voice clip -> scene time
const fonts: React.CSSProperties = { fontFamily: 'Outfit, sans-serif' };

/* ------------------------------------------------------------------ 02: it knows you */
const TILES = [['#2a2145', '#5b3f8a'], ['#16313a', '#2f7d86'], ['#3a2020', '#8a4a3f'], ['#1d2a1d', '#4a8a4f'], ['#33281a', '#8a6a2f']];
export const Scene02: React.FC = () => {
  const t = useT();
  const chips = ['Tense', 'Adrenaline', 'Mind-bending', 'Scary', 'Cozy', 'Funny'];
  const active = t >= w(6.2) ? 2 : t >= w(5.5) ? 4 : t >= w(4.8) ? 0 : -1;
  const show = vis(t, 5.2, 13.2, 0.5, 0.5);
  // the shelf reshuffles on "shuffles around that"
  const sh = inOut(span(t, w(7.8), w(9.9)));
  const from = [0, 1, 2, 3, 4], to = [3, 0, 4, 1, 2];
  const badge = (i: number) => outCubic(span(t, w(10.2) + i * 0.18, w(10.2) + i * 0.18 + 0.4));
  const pcts = ['98%', '95%', '93%', '91%', '91%'];
  const lock = vis(t, w(14.0), 18.9, 0.6, 0.5);
  return (
    <AbsoluteFill style={fonts}>
      <Backdrop />
      <Shot src="clips/version.mp4" vw={1618} vh={1080} clipFrom={4.0} clipTo={8.8} at={0.4} width={1500} cy={540} zoomTo={1.04} />
      <div style={{ position: 'absolute', inset: 0, opacity: show }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 150, textAlign: 'center' }}>
          <div style={{ fontSize: 28, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8f8aa8', marginBottom: 26 }}>Tonight I want</div>
          <div style={{ display: 'flex', gap: 18, justifyContent: 'center' }}>
            {chips.map((c, i) => <Chip key={c} on={active === i ? 1 : 0}>{c}</Chip>)}
          </div>
        </div>
        {TILES.map((c, i) => {
          const pos = lerp(from.indexOf(i), to.indexOf(i), sh);
          const x = 160 + pos * 330, lift = Math.sin(Math.PI * sh) * -30;
          return (
            <div key={i} style={{ position: 'absolute', left: x, top: 420 + lift, width: 290, height: 435, borderRadius: 22, background: `linear-gradient(160deg, ${c[0]}, ${c[1]})`, border: '1px solid rgba(255,255,255,.14)', boxShadow: '0 40px 80px -30px rgba(0,0,0,.9)' }}>
              <div style={{ position: 'absolute', left: 18, bottom: 22, width: 170, height: 14, borderRadius: 7, background: 'rgba(255,255,255,.35)' }} />
              <div style={{ position: 'absolute', left: 18, bottom: 48, width: 110, height: 10, borderRadius: 5, background: 'rgba(255,255,255,.18)' }} />
              <div style={{ position: 'absolute', left: 16, top: 16, padding: '6px 14px', borderRadius: 10, background: 'rgba(8,12,12,.75)', color: '#7be0a6', fontSize: 26, fontWeight: 600, border: '1px solid rgba(123,224,166,.3)', opacity: badge(i), transform: `translateY(${(1 - badge(i)) * 8}px)` }}>{pcts[i]} match</div>
            </div>
          );
        })}
        <Words size={38} color="#bdb8d6" style={{ position: 'absolute', left: 160, top: 890, opacity: vis(t, w(11.3), 13.0, 0.4, 0.4) }}>Because you rate slow, tense thrillers highly</Words>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', opacity: lock }}>
        <div style={{ textAlign: 'center' }}>
          <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#e9e6fa" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          <Words size={84} weight={600} style={{ marginTop: 20 }}>Stays on your Mac.</Words>
        </div>
      </div>
      {VOICE(2, '02-taste.wav')}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ 03: the best version */
const ROWS = [
  ['4K', 'Atmos', 'English', '69 GB'], ['1080p', '5.1', 'Multi', '12 GB'], ['4K', '7.1', 'English', '41 GB'], ['720p', 'Stereo', 'English', '3 GB'],
  ['1080p', 'Atmos', 'Multi', '18 GB'], ['4K', '5.1', 'Multi', '33 GB'], ['1080p', 'Stereo', 'English', '2 GB'],
];
const seeded = (i: number, k: number) => { const x = Math.sin(i * 91.7 + k * 17.3) * 10000; return x - Math.floor(x); };
export const Scene03: React.FC = () => {
  const t = useT();
  const pile = vis(t, w(3.2), 17.3, 0.5, 0.45);
  const sort = inOut(span(t, w(7.7), w(9.5)));
  const hdrs = ['Picture', 'Sound', 'Language', 'Size'], hx = [330, 620, 900, 1230];
  const hdrOn = (i: number) => outCubic(span(t, [w(10.3), w(10.5), w(11.1), w(12.0)][i], [w(10.3), w(10.5), w(11.1), w(12.0)][i] + 0.4));
  const best = outCubic(span(t, w(12.5), w(13.3)));
  const checks = ['Matches your 4K preference', 'Starts instantly', 'Dolby Vision'];
  const press = span(t, w(16.5), w(16.5) + 0.25), pressed = Math.sin(Math.PI * press);
  return (
    <AbsoluteFill style={fonts}>
      <Backdrop />
      <Shot src="clips/version.mp4" vw={1618} vh={1080} clipFrom={7.6} clipTo={11.0} at={0.3} width={1500} cy={540} zoomTo={1.05} />
      <div style={{ position: 'absolute', inset: 0, opacity: pile }}>
        {ROWS.map((r, i) => {
          const msy = 150 + seeded(i, 1) * 560, msx = 330 + seeded(i, 2) * 500, rot = (seeded(i, 3) - 0.5) * 24;
          const nx = 250, ny = 190 + i * 96;
          const jit = (1 - sort) * Math.sin(t * 2 + i) * 6;
          const x = lerp(msx, nx, sort), y = lerp(msy, ny, sort) + jit;
          const isBest = i === 0, dim = isBest ? 1 : 1 - best * 0.55;
          const grow = isBest ? best : 0;
          return (
            <div key={i} style={{ position: 'absolute', left: x, top: y - grow * 20, width: 1400 * (0.7 + 0.3 * sort), height: 78 + grow * 40, borderRadius: 18, transform: `rotate(${rot * (1 - sort)}deg)`, opacity: dim,
              background: isBest && best > 0 ? 'linear-gradient(160deg, rgba(255,255,255,.14), rgba(255,255,255,.05))' : 'rgba(255,255,255,.06)', border: `1px solid rgba(255,255,255,${isBest ? 0.1 + best * 0.3 : 0.12})`,
              boxShadow: isBest ? `0 0 ${best * 70}px rgba(255,255,255,${best * 0.16})` : 'none', display: 'flex', alignItems: 'center', fontSize: 34, color: '#e9e6fa' }}>
              {hdrs.map((_, c) => <div key={c} style={{ position: 'absolute', left: hx[c] - 250 + 60, opacity: sort * hdrOn(c), fontWeight: c === 0 ? 700 : 500 }}>{r[c]}</div>)}
              <div style={{ position: 'absolute', left: 40, opacity: 1 - sort * 0.0, color: '#8f8aa8', fontSize: 28 }}>{sort < 0.5 ? `Copy ${i + 1}` : ''}</div>
              {isBest && <div style={{ position: 'absolute', right: 30, top: 12, fontSize: 22, letterSpacing: '0.16em', color: '#7be0a6', opacity: best }}>BEST FOR YOU</div>}
            </div>
          );
        })}
        {hdrs.map((h, i) => <div key={h} style={{ position: 'absolute', left: hx[i] + 60 - 250 + 250, top: 130, fontSize: 26, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8f8aa8', opacity: hdrOn(i) * sort }}>{h}</div>)}
        <div style={{ position: 'absolute', left: 250, top: 190 + 7 * 96 + 14 }}>
          {checks.map((c, i) => { const o = outCubic(span(t, w(14.5) + i * 0.4, w(14.5) + i * 0.4 + 0.35)); return <div key={c} style={{ display: 'inline-block', marginRight: 46, fontSize: 32, color: '#cfe9d9', opacity: o, transform: `translateY(${(1 - o) * 10}px)` }}>✓ {c}</div>; })}
        </div>
        <div style={{ position: 'absolute', left: 1290, top: 190 + 20 - 20, opacity: outCubic(span(t, w(15.8), w(15.8) + 0.4)) }}>
          <div style={{ padding: '18px 44px', borderRadius: 18, background: '#f6f5ff', color: '#16113a', fontSize: 36, fontWeight: 700, transform: `scale(${1 - pressed * 0.08})`, boxShadow: `0 ${20 - pressed * 10}px 60px rgba(255,255,255,.25)` }}>▶ Play</div>
        </div>
      </div>
      <Shot src="clips/version.mp4" vw={1618} vh={1080} clipFrom={14.4} clipTo={16.6} at={17.5} width={1100} crop={{ x: 0.4, y: 0.2, w: 0.58, h: 0.6 }} cy={540} />
      {VOICE(3, '03-version.wav')}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ 04: search */
export const Scene04: React.FC = () => {
  const t = useT();
  const keys = vis(t, w(2.0), w(3.0), 0.25, 0.25), kp = Math.sin(Math.PI * span(t, w(2.4), w(2.4) + 0.3));
  const bar = outCubic(span(t, w(2.9), w(2.9) + 0.45)), word = 'dune';
  const typed = t < w(3.3) ? 0 : t < w(3.7) ? 1 : t < w(4.1) ? 2 : t < w(4.4) ? 3 : 4;
  const q = word.slice(0, typed);
  const enter = Math.sin(Math.PI * span(t, w(4.8), w(4.8) + 0.3)), picked = span(t, w(4.9), w(5.2));
  const rows = ['Dune', 'Dune: Part Two', 'Dune: Prophecy'];
  const done = outCubic(span(t, w(5.9), w(5.9) + 0.35));
  const Key: React.FC<{ c: string; press?: number }> = ({ c, press = 0 }) => (
    <div style={{ width: 150, height: 150, borderRadius: 30, background: 'linear-gradient(180deg,#26242f,#17161e)', border: '1px solid rgba(255,255,255,.16)', display: 'grid', placeItems: 'center', fontSize: 78, fontWeight: 500, color: '#f3f1ff', transform: `translateY(${press * 10}px) scale(${1 - press * 0.04})`, boxShadow: `0 ${24 - press * 14}px 50px rgba(0,0,0,.6)` }}>{c}</div>
  );
  return (
    <AbsoluteFill style={fonts}>
      <Backdrop />
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', opacity: keys }}>
        <div style={{ display: 'flex', gap: 30 }}><Key c="⌘" press={kp} /><Key c="K" press={kp} /></div>
      </div>
      <div style={{ position: 'absolute', left: 260, top: 230, width: 1400, opacity: bar, transform: `translateY(${(1 - bar) * 30}px) scale(${0.96 + 0.04 * bar})` }}>
        <div style={{ height: 120, borderRadius: 28, background: '#141418', border: '1px solid rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', padding: '0 40px', fontSize: 54, color: '#f3f1ff', boxShadow: '0 50px 100px -30px #000' }}>
          <span style={{ color: '#8f8aa8', marginRight: 24 }}>⌕</span>{q}<span style={{ width: 3, height: 60, background: '#f3f1ff', marginLeft: 4, opacity: Math.floor(t * 2.2) % 2 }} />
          <div style={{ marginLeft: 'auto', transform: `translateY(${enter * 6}px)` }}><span style={{ padding: '8px 22px', borderRadius: 12, background: 'rgba(255,255,255,.1)', fontSize: 30, color: '#cfcae6' }}>↵ Enter</span></div>
        </div>
        <div style={{ marginTop: 22, opacity: typed > 0 ? 1 : 0 }}>
          {rows.map((r, i) => (
            <div key={r} style={{ height: 110, marginBottom: 14, borderRadius: 22, background: i === 0 && picked > 0 ? '#f4f2ff' : 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', display: 'flex', alignItems: 'center', padding: '0 28px', gap: 26, fontSize: 44, fontWeight: 500, color: i === 0 && picked > 0 ? '#0c0b14' : '#e9e6fa', transform: `scale(${i === 0 ? 1 + picked * 0.02 : 1})`, opacity: typed >= 2 || i === 0 ? 1 : 0.4 }}>
              <div style={{ width: 54, height: 78, borderRadius: 10, background: 'linear-gradient(160deg,#33281a,#8a6a2f)' }} />{r}
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', right: 300, bottom: 150, opacity: done, transform: `scale(${0.8 + 0.2 * done})` }}>
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#7be0a6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5l3 3 6-7" /></svg>
      </div>
      {VOICE(4, '04-search.wav')}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ 05: together */
const Mac: React.FC<{ x: number; y: number; label: string; t: number; o: number }> = ({ x, y, label, t, o }) => (
  <div style={{ position: 'absolute', left: x, top: y, width: 560, height: 360, borderRadius: 24, background: '#0d0c14', border: '1px solid rgba(255,255,255,.16)', opacity: o, boxShadow: '0 50px 100px -30px #000' }}>
    <div style={{ display: 'flex', gap: 10, padding: '18px 20px' }}>{['#ff5f57', '#febc2e', '#28c840'].map((c) => <i key={c} style={{ width: 14, height: 14, borderRadius: 7, background: c }} />)}</div>
    <div style={{ position: 'absolute', left: 40, right: 40, top: 80, bottom: 100, borderRadius: 14, background: 'linear-gradient(160deg,#1f1a33,#3a2a55)' }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 24, height: 6, margin: '0 28px', borderRadius: 3, background: 'rgba(255,255,255,.15)' }}><div style={{ width: `${(t * 6) % 100}%`, height: '100%', borderRadius: 3, background: '#f4f2ff' }} /></div>
    </div>
    <div style={{ position: 'absolute', bottom: 28, left: 0, right: 0, textAlign: 'center', fontSize: 34, color: '#cfcae6' }}>{label}</div>
  </div>
);
const EMOJI = ['👍', '😂', '😮', '❤️', '🔥', '👏'];
export const Scene05: React.FC = () => {
  const t = useT();
  const macs = vis(t, 3.7, 8.6, 0.5, 0.5);
  const dots = [0, 1, 2, 3, 4, 5].map((k) => { const p = ((t * 0.9 + k / 6) % 1); return k % 2 ? 1 - p : p; });
  const ready = vis(t, w(8.3), w(9.8), 0.4, 0.3);
  const n = t < 11.5 ? 3 : t < 12.2 ? 2 : 1, cd = vis(t, 10.7, 12.95, 0.2, 0.15);
  const frac = t < 11.5 ? span(t, 10.8, 11.5) : t < 12.2 ? span(t, 11.5, 12.2) : span(t, 12.2, 12.9);
  const pop = outExpo(span(t, n === 3 ? 10.8 : n === 2 ? 11.5 : 12.2, (n === 3 ? 10.8 : n === 2 ? 11.5 : 12.2) + 0.25));
  const flash = Math.sin(Math.PI * span(t, 12.9, 13.5));
  const sync = vis(t, 12.9, 18.3, 0.4, 0.5), u = Math.max(0, t - 12.9);
  const tc = `0:${String(Math.floor(u) + 27).padStart(2, '0')}`;
  const floatsOn = vis(t, 18.9, 22.8, 0.2, 0.5);
  return (
    <AbsoluteFill style={fonts}>
      <Backdrop />
      <Shot src="clips/together.mp4" vw={1618} vh={1080} clipFrom={0.4} clipTo={3.6} at={0.4} width={1480} cy={540} zoomTo={1.04} />
      <Mac x={150} y={270} label="Your Mac" t={t} o={macs} />
      <Mac x={1210} y={270} label="Their Mac" t={t} o={macs} />
      <div style={{ position: 'absolute', inset: 0, opacity: macs }}>
        {dots.map((p, i) => <i key={i} style={{ position: 'absolute', left: 740 + p * 430, top: 440 + Math.sin(p * Math.PI) * -60, width: 18, height: 18, borderRadius: 9, background: '#f4f2ff', boxShadow: '0 0 24px rgba(255,255,255,.7)' }} />)}
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', opacity: ready }}>
        <div style={{ display: 'flex', gap: 40 }}>
          {['#d452cc', '#2f8fd8', '#3ddc84'].map((c, i) => (
            <div key={c} style={{ position: 'relative', width: 150, height: 150, borderRadius: 75, background: `linear-gradient(135deg, ${c}, #1a1730)`, boxShadow: `0 0 0 5px rgba(61,220,132,${outCubic(span(t, w(8.9) + i * 0.3, w(8.9) + i * 0.3 + 0.3))}), 0 0 50px rgba(61,220,132,.4)` }}>
              <div style={{ position: 'absolute', right: -6, bottom: -6, width: 46, height: 46, borderRadius: 23, background: '#3ddc84', display: 'grid', placeItems: 'center', color: '#06270f', fontSize: 30, fontWeight: 800, opacity: outCubic(span(t, w(9.0) + i * 0.3, w(9.0) + i * 0.3 + 0.25)) }}>✓</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', opacity: cd }}>
        <div style={{ position: 'relative', width: 480, height: 480 }}>
          <svg width="480" height="480" viewBox="0 0 480 480" style={{ position: 'absolute', inset: 0 }}>
            <circle cx="240" cy="240" r="220" fill="rgba(0,0,0,.35)" stroke="rgba(255,255,255,.14)" strokeWidth="3" />
            <circle cx="240" cy="240" r="220" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeDasharray={2 * Math.PI * 220} strokeDashoffset={2 * Math.PI * 220 * (1 - frac)} transform="rotate(-90 240 240)" style={{ filter: 'drop-shadow(0 0 14px rgba(255,255,255,.6))' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 280, fontWeight: 700, letterSpacing: '-0.05em', color: '#fff', transform: `scale(${1.3 - 0.3 * pop})`, opacity: pop }}>{n}</div>
        </div>
      </div>
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle, rgba(255,255,255,${flash * 0.3}), transparent 60%)` }} />
      <div style={{ position: 'absolute', inset: 0, opacity: sync }}>
        {[{ x: 200, l: 'You' }, { x: 1120, l: 'A friend' }].map((m) => (
          <div key={m.l} style={{ position: 'absolute', left: m.x, top: 360, width: 600, height: 300, borderRadius: 26, background: '#0d0c14', border: '1px solid rgba(255,255,255,.16)', textAlign: 'center', paddingTop: 50 }}>
            <div style={{ fontSize: 30, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#8f8aa8' }}>{m.l}</div>
            <div style={{ fontSize: 120, fontWeight: 600, color: '#f4f2ff', fontVariantNumeric: 'tabular-nums', marginTop: 8 }}>{tc}</div>
            <div style={{ margin: '14px 60px 0', height: 8, borderRadius: 4, background: 'rgba(255,255,255,.14)' }}><div style={{ width: `${Math.min(100, (u / 5.4) * 100)}%`, height: '100%', borderRadius: 4, background: '#fff' }} /></div>
          </div>
        ))}
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0 }}><path d="M800 510 C 900 380, 1020 380, 1120 510" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="3" strokeDasharray="4 12" strokeLinecap="round" /></svg>
      </div>
      <Shot src="clips/together.mp4" vw={1618} vh={1080} clipFrom={20} clipTo={24} at={18.5} width={1500} crop={{ x: 0, y: 0.76, w: 1, h: 0.24 }} cy={800} />
      <div style={{ position: 'absolute', inset: 0, opacity: floatsOn }}>
        {Array.from({ length: 14 }).map((_, i) => {
          const s = 18.9 + i * 0.26, k = span(t, s, s + 2.6), x = 260 + seeded(i, 5) * 1400;
          return <div key={i} style={{ position: 'absolute', left: x + Math.sin(k * 6 + i) * 30, top: 880 - k * 700, fontSize: 90, opacity: Math.sin(Math.PI * k) * 0.95, transform: `scale(${0.7 + 0.4 * k})` }}>{EMOJI[i % 6]}</div>;
        })}
      </div>
      <Shot src="clips/together.mp4" vw={1618} vh={1080} clipFrom={26.2} clipTo={28.7} at={22.7} width={820} cy={520} />
      {VOICE(5, '05-together.wav')}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ 06: made with care */
export const Scene06: React.FC = () => {
  const t = useT();
  return (
    <AbsoluteFill style={fonts}>
      <Backdrop />
      <Shot src="clips/orbie.mp4" vw={1092} vh={720} clipFrom={0} clipTo={16} rate={1.25} at={1.4} width={1400} crop={{ x: 0.03, y: 0.06, w: 0.94, h: 0.9 }} cy={470} />
      <Words size={60} style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', top: 940, opacity: vis(t, w(9.3), 11.9, 0.4, 0.35) }}>Films are worth watching properly.</Words>
      <Words size={60} style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', top: 940, opacity: vis(t, w(11.2), 14.6, 0.4, 0.4) }}>And the software should get out of the way.</Words>
      {VOICE(6, '06-care.wav')}
    </AbsoluteFill>
  );
};

/* ------------------------------------------------------------------ 07: close */
export const Scene07: React.FC = () => {
  const t = useT();
  const head = vis(t, w(0.1), w(2.9), 0.5, 0.4);
  const nodes = [[0, 0], [-1, 1], [1, 1], [-1.6, 2], [0.4, 2], [1.7, 2]];
  const edges = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5]];
  const chain = vis(t, w(3.5), w(5.9), 0.4, 0.4);
  const card = vis(t, w(5.9), 11.4, 0.5, 0.5);
  const nameOn = outCubic(span(t, w(7.5), w(7.5) + 0.4));
  const bubble = outExpo(span(t, w(10.2), w(10.2) + 0.35));
  const early = vis(t, w(12.9), 14.6, 0.5, 0.4);
  const u = t - 14.7;
  const tag = outCubic(span(t, w(15.0), w(15.0) + 0.8));
  return (
    <AbsoluteFill style={fonts}>
      <Backdrop />
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', opacity: head }}>
        <Words size={130} weight={600} style={{ textAlign: 'center' }}>Invite only,<br />on purpose.</Words>
      </div>
      <div style={{ position: 'absolute', inset: 0, opacity: chain }}>
        <svg width={W} height={H}>
          {edges.map(([a, b], i) => { const A = nodes[a], B = nodes[b], k = outCubic(span(t, w(4.2) + i * 0.25, w(4.2) + i * 0.25 + 0.4)); const x1 = 960 + A[0] * 240, y1 = 330 + A[1] * 200, x2 = 960 + B[0] * 240, y2 = 330 + B[1] * 200; return <line key={i} x1={x1} y1={y1} x2={lerp(x1, x2, k)} y2={lerp(y1, y2, k)} stroke="rgba(255,255,255,.4)" strokeWidth="3" />; })}
          {nodes.map((n, i) => { const k = outExpo(span(t, w(3.9) + i * 0.22, w(3.9) + i * 0.22 + 0.35)); return <circle key={i} cx={960 + n[0] * 240} cy={330 + n[1] * 200} r={44 * k} fill={i === 0 ? '#f4f2ff' : 'rgba(255,255,255,.14)'} stroke="rgba(255,255,255,.4)" strokeWidth="2" />; })}
        </svg>
        <Words size={46} color="#bdb8d6" style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', top: 800 }}>Everyone who is in came from someone who knows them.</Words>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', opacity: card }}>
        <div style={{ position: 'relative', width: 1000, height: 520, borderRadius: 36, background: 'linear-gradient(160deg,#1a1826,#0f0e18)', border: '1px solid rgba(255,255,255,.18)', boxShadow: '0 70px 140px -30px #000', padding: '60px 70px', transform: `rotate(${-2 + 2 * outCubic(span(t, w(5.9), w(7))) }deg)` }}>
          <div style={{ fontSize: 28, letterSpacing: '0.22em', textTransform: 'uppercase', color: '#8f8aa8' }}>Your invite</div>
          <div style={{ marginTop: 40, fontSize: 84, fontWeight: 600, fontFamily: 'ui-monospace, Menlo, monospace', letterSpacing: '0.04em', color: '#f4f2ff' }}>orbie-7F3K…</div>
          <div style={{ position: 'absolute', left: 70, bottom: 70, opacity: nameOn, transform: `translateY(${(1 - nameOn) * 12}px)` }}>
            <div style={{ fontSize: 28, color: '#8f8aa8' }}>Invited by</div>
            <div style={{ fontSize: 60, fontWeight: 600, color: '#fff', marginTop: 4 }}>a friend you trust</div>
          </div>
        </div>
        <div style={{ position: 'absolute', right: 230, top: 150, padding: '22px 36px', borderRadius: 36, background: '#f4f2ff', color: '#0c0b14', fontSize: 46, fontWeight: 500, opacity: bubble, transform: `scale(${0.7 + 0.3 * bubble})`, transformOrigin: 'bottom left' }}>Can I get an invite?</div>
      </div>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', opacity: early }}>
        <Words size={110} weight={600}>It is still early.</Words>
      </div>
      {t > 14.4 && <Lockup u={u} offsetY={-60} fs={300} />}
      <Words size={64} color="#cfcae6" style={{ position: 'absolute', left: 0, right: 0, textAlign: 'center', top: H / 2 + 200, opacity: tag, transform: `translateY(${(1 - tag) * 16}px)` }}>A private cinema for the people you trust.</Words>
      {VOICE(7, '07-close.wav')}
    </AbsoluteFill>
  );
};
