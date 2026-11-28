// Small synthesized sounds for the orb sequence (WebAudio, no files). Soft and short; silenced with localStorage 'orbie.sounds' = '0'.
export function orbSounds() {
  try { if (localStorage.getItem('orbie.sounds') === '0') return null; } catch {}
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  const ctx = new AC(); ctx.resume && ctx.resume();
  const out = ctx.createGain(); out.gain.value = 0.5;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200;
  // a short echo so it sounds like it is in a room
  const dly = ctx.createDelay(); dly.delayTime.value = 0.19; const fb = ctx.createGain(); fb.gain.value = 0.32; const wet = ctx.createGain(); wet.gain.value = 0.28;
  out.connect(lp); lp.connect(ctx.destination); lp.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(ctx.destination);
  const T0 = ctx.currentTime + 0.02;
  const tone = (at, f0, f1, dur, vol, type = 'sine') => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.setValueAtTime(f0, T0 + at); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, T0 + at + dur);
    g.gain.setValueAtTime(0.0001, T0 + at); g.gain.exponentialRampToValueAtTime(vol, T0 + at + Math.min(0.04, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, T0 + at + dur);
    o.connect(g); g.connect(out); o.start(T0 + at); o.stop(T0 + at + dur + 0.05);
  };
  const air = (at, f0, f1, dur, vol) => {
    const len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(f0, T0 + at); bp.frequency.exponentialRampToValueAtTime(f1, T0 + at + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, T0 + at); g.gain.exponentialRampToValueAtTime(vol, T0 + at + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.0001, T0 + at + dur);
    src.connect(bp); bp.connect(g); g.connect(out); src.start(T0 + at);
  };
  // the sequence, on the same clock as orb-seq.js (seconds from the click)
  tone(0, 520, 520, 0.12, 0.22);                              // the click
  tone(0.02, 196, 784, 0.8, 0.2); tone(0.02, 199, 790, 0.8, 0.12); // it blooms
  air(0.05, 300, 2400, 0.8, 0.07);
  tone(0.85, 523, 262, 0.35, 0.25); tone(0.85, 82, 55, 0.4, 0.3);  // it shrinks: a soft round pop
  air(1.3, 500, 1800, 0.65, 0.09);                            // it slides
  [880, 1047, 1319, 1568].forEach((f, i) => tone(1.6 + i * 0.085, f, f, 0.45, 0.13)); // the letters, one note each
  air(3.0, 1800, 400, 0.8, 0.07);                             // it slides back
  [262, 392, 523, 659].forEach((f, i) => tone(3.45 + i * 0.04, f, f, 1.8, 0.1)); // arrives: a warm chord under the manifesto
  setTimeout(() => ctx.close && ctx.close(), 7000);
  return ctx;
}
