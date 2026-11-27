// Synthesizes the whole soundtrack's effects and the quiet pad (no files, nothing to license). Writes public/sfx/master.wav.
import { writeFileSync } from 'node:fs';
const DUR = { 1: 13.333, 2: 19.0, 3: 19.8, 4: 7.2, 5: 25.2, 6: 14.8, 7: 20.5 }, START = {};
{ let s = 0; for (let i = 1; i <= 7; i++) { START[i] = s; s += DUR[i]; } var TOTAL = s; }
const LEAD = 0.5, SR = 44100, N = Math.floor(SR * (TOTAL + 0.6)), out = new Float32Array(N);
const add = (i, v) => { if (i >= 0 && i < N) out[i] += v; };
const rnd = (() => { let s = 1234567; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; })();

function tone(t0, f0, f1, dur, vol) {
  const n = Math.floor(dur * SR), i0 = Math.floor(t0 * SR); let ph = 0;
  for (let i = 0; i < n; i++) { const x = i / n, f = f0 * Math.pow(f1 / f0, x); ph += (2 * Math.PI * f) / SR; add(i0 + i, Math.sin(ph) * Math.min(1, i / (0.03 * SR)) * Math.pow(0.0001, x) * vol); }
}
function air(t0, f0, f1, dur, vol) {
  const n = Math.floor(dur * SR), i0 = Math.floor(t0 * SR); let lo = 0, bp = 0;
  for (let i = 0; i < n; i++) { const x = i / n, f = f0 * Math.pow(f1 / f0, x), g = 2 * Math.sin((Math.PI * f) / SR); const hi = rnd() - lo - 0.8 * bp; bp += g * hi; lo += g * bp; add(i0 + i, bp * Math.sin(Math.PI * x) ** 1.6 * vol * 0.6); }
}
const tick = (t, v = 0.22) => { tone(t, 1400, 900, 0.06, v); tone(t, 90, 60, 0.12, v * 0.8); };
const whoosh = (t, v = 0.12) => air(t, 500, 1800, 0.55, v);
const pop = (t, v = 0.2) => { tone(t, 523, 262, 0.3, v); tone(t, 82, 55, 0.35, v * 1.1); };
const note = (t, f, v = 0.12, d = 0.5) => tone(t, f, f, d, v);
const chime = (t, v = 0.12) => [523, 659, 784, 1047].forEach((f, k) => note(t + k * 0.05, f, v, 1.4));
const E = (sc, rel) => START[sc] + rel;          // a time inside a scene
const V = (sc, word) => START[sc] + LEAD + word; // a word time inside a scene's voice

// --- 01 open: the same sounds as the app's start-up ---
tone(0.28, 196, 784, 0.8, 0.22); tone(0.28, 199, 790, 0.8, 0.13); air(0.3, 300, 2400, 0.8, 0.12);
pop(1.3, 0.26); air(1.8, 500, 1800, 0.65, 0.14);
[880, 1047, 1319, 1568].forEach((f, i) => note(2.15 + i * 0.085, f, 0.14, 0.45));
tick(2.4 + 4.2); tick(2.4 + 4.7, 0.2); tick(2.4 + 7.3, 0.22); air(12.4, 1800, 400, 0.8, 0.12);
// --- 02 it knows you ---
whoosh(E(2, 0.4)); [4.8, 5.5, 6.5].forEach((x) => tick(V(2, x))); air(V(2, 7.8), 400, 2000, 1.6, 0.12);
for (let i = 0; i < 5; i++) note(V(2, 10.2) + i * 0.18, 784 + i * 120, 0.1, 0.35);
whoosh(E(2, 13.0), 0.1); tick(V(2, 14.0), 0.3);
// --- 03 the best version ---
whoosh(E(3, 0.3)); air(V(3, 3.2), 300, 900, 1.2, 0.07); air(V(3, 7.7), 300, 2200, 1.6, 0.13);
[10.3, 10.5, 11.1, 12.0].forEach((x) => tick(V(3, x), 0.16)); chime(V(3, 12.5), 0.1);
[0, 1, 2].forEach((i) => tick(V(3, 14.5) + i * 0.4, 0.14)); tick(V(3, 16.5), 0.3); tone(V(3, 17.1), 110, 330, 1.0, 0.18); air(E(3, 17.4), 300, 3000, 1.3, 0.13);
// --- 04 search ---
tick(V(4, 2.4), 0.3); tick(V(4, 2.45), 0.3); whoosh(V(4, 2.9), 0.1); [3.3, 3.7, 4.1, 4.4].forEach((x) => tick(V(4, x), 0.14)); tick(V(4, 4.8), 0.3); chime(V(4, 5.9), 0.1);
// --- 05 together ---
whoosh(E(5, 0.4)); whoosh(E(5, 3.7)); for (let k = 0; k < 12; k++) tone(E(5, 4.4 + k * 0.33), 1500 + (k % 2) * 300, 1500 + (k % 2) * 300, 0.07, 0.07);
[8.9, 9.2, 9.5].forEach((x, i) => note(V(5, x), 523 * Math.pow(1.26, i), 0.12, 0.4));
[10.8, 11.5, 12.2].forEach((x) => { tone(E(5, x), 330, 330, 0.18, 0.2); tone(E(5, x), 82, 82, 0.3, 0.2); });
chime(E(5, 12.9), 0.16); tone(E(5, 12.9), 55, 40, 1.4, 0.22);
whoosh(E(5, 18.5)); for (let i = 0; i < 14; i++) tone(E(5, 18.9 + i * 0.26), 700 + (i % 5) * 150, 1400 + (i % 5) * 200, 0.12, 0.06);
whoosh(E(5, 22.7), 0.1);
// --- 06 made with care ---
whoosh(E(6, 1.4)); tick(E(6, 2.7), 0.26); tone(E(6, 2.75), 70, 50, 0.4, 0.2);
// --- 07 close ---
whoosh(V(7, 0.1)); for (let i = 0; i < 6; i++) note(V(7, 3.9) + i * 0.22, 660 + i * 90, 0.1, 0.35);
whoosh(V(7, 5.9)); tick(V(7, 7.5), 0.22); tone(V(7, 10.2), 400, 800, 0.18, 0.16);
const L = E(7, 14.7); tone(L, 196, 784, 0.7, 0.2); pop(L + 1.0, 0.24); air(L + 1.5, 500, 1800, 0.65, 0.14); [880, 1047, 1319, 1568].forEach((f, i) => note(L + 1.85 + i * 0.085, f, 0.14, 0.5));
[262, 392, 523, 659].forEach((f, i) => note(L + 2.6 + i * 0.05, f, 0.1, 3.2));

// a quiet pad that changes chord with the scenes
const chords = { 1: [110, 164.81, 220.4], 2: [110, 164.81, 220.4], 3: [87.31, 130.81, 174.61], 4: [87.31, 130.81, 174.61], 5: [98, 146.83, 196], 6: [110, 164.81, 261.63], 7: [65.41, 98, 130.81, 196] };
for (let sc = 1; sc <= 7; sc++) {
  const a = Math.floor((START[sc] - 0.8) * SR), b = Math.floor((START[sc] + DUR[sc] + 0.8) * SR);
  for (let i = Math.max(0, a); i < Math.min(N, b); i++) {
    const t = i / SR, k = (i - a) / (b - a), env = Math.min(1, k * 8) * Math.min(1, (1 - k) * 8), lfo = 0.65 + 0.35 * Math.sin((2 * Math.PI * t) / 6.5);
    let v = 0; chords[sc].forEach((f, j) => { v += Math.sin(2 * Math.PI * f * t + j) * (j === 0 ? 1 : 0.55); });
    add(i, v * env * lfo * 0.028);
  }
}
const D = Math.floor(0.19 * SR), mix = new Float32Array(N);
for (let i = 0; i < N; i++) mix[i] = out[i] + (i >= D ? mix[i - D] * 0.3 : 0) * 0.9;
const pcm = Buffer.alloc(44 + N * 2);
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + N * 2, 4); pcm.write('WAVEfmt ', 8); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36); pcm.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) pcm.writeInt16LE(Math.round(Math.tanh(mix[i] * 1.2) * 0.9 * 32767), 44 + i * 2);
writeFileSync(new URL('../public/sfx/master.wav', import.meta.url), pcm);
console.log('wrote public/sfx/master.wav', (TOTAL + 0.6).toFixed(1) + 's');
