// Avatar decorations: big, layered, animated frames that extend past the avatar (like Discord's), drawn as SVG.
// The face is always a circle (radius 50 in a 0..100 box). The viewBox is -28..128 so pieces can sit above, beside and around it.
// Colours come from --fa / --fb on the avatar, so each decoration can be recoloured. Motion is SMIL + a little CSS.
const f = (n) => +n.toFixed(2);
const P = (r, a, cx = 50, cy = 50) => [f(cx + r * Math.cos((a * Math.PI) / 180)), f(cy + r * Math.sin((a * Math.PI) / 180))];
const S = (v) => `style="stop-color:var(${v})"`;
const rng = (n) => Array.from({ length: n }, (_, i) => i);
const grad = (id, x1 = 0, y1 = 0, x2 = 1, y2 = 1, mid) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" ${S('--fa')}/>${mid ? `<stop offset=".5" ${S('--fb')}/>` : ''}<stop offset="1" ${mid ? S('--fa') : S('--fb')}/></linearGradient>`;
const blur = (id, sd = 2.4) => `<filter id="${id}" x="-70%" y="-70%" width="240%" height="240%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
const spin = (dur, dir = 1, cx = 50, cy = 50) => `<animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="${360 * dir} ${cx} ${cy}" dur="${dur}s" repeatCount="indefinite"/>`;
const star = (cx, cy, r) => `M${cx} ${f(cy - r)}Q${cx} ${cy} ${f(cx + r)} ${cy}Q${cx} ${cy} ${cx} ${f(cy + r)}Q${cx} ${cy} ${f(cx - r)} ${cy}Q${cx} ${cy} ${cx} ${f(cy - r)}Z`;
// a twinkling four-point sparkle
const spark = (cx, cy, r, begin = 0, color = '#fff') => `<path fill="${color}" d="${star(cx, cy, r)}"><animate attributeName="opacity" values="0;1;0" dur="2.4s" begin="${begin}s" repeatCount="indefinite"/><animateTransform attributeName="transform" type="scale" additive="sum" values="0.4;1;0.4" dur="2.4s" begin="${begin}s" repeatCount="indefinite"/></path>`;
// a particle drifting along (dx,dy) while fading in and out
const part = (x, y, dx, dy, r, dur, begin, fill = '#fff', glowId = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${glowId ? `filter="url(#${glowId})"` : ''} opacity="0"><animateMotion path="M0 0 L${dx} ${dy}" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;.9;0" keyTimes="0;.15;.65;1" dur="${dur}s" begin="${begin}s" repeatCount="indefinite"/></circle>`;
// a bright arc that sweeps around the ring
const sweep = (r, w, dur, u, len = 46) => { const [x1, y1] = P(r, -len / 2), [x2, y2] = P(r, len / 2); return `<g>${spin(dur)}<path d="M${x1} ${y1}A${r} ${r} 0 0 1 ${x2} ${y2}" fill="none" stroke="#fff" stroke-width="${w * 2.2}" stroke-linecap="round" opacity=".55" filter="url(#sw${u})"/><path d="M${x1} ${y1}A${r} ${r} 0 0 1 ${x2} ${y2}" fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" opacity=".95"/></g>`; };
const SW = (u) => blur('sw' + u, 1.6);

export const DECOS = {
  halo: { name: 'Celestial', fa: '#fde68a', fb: '#f59e0b', svg: (u) => `<defs>
      <linearGradient id="h${u}" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox"><stop offset="0" ${S('--fa')}/><stop offset=".35" stop-color="#fff"/><stop offset=".65" ${S('--fb')}/><stop offset="1" ${S('--fa')}/>
        <animateTransform attributeName="gradientTransform" type="translate" values="-0.6 0;0.6 0;-0.6 0" dur="3.6s" repeatCount="indefinite"/></linearGradient>${blur('g' + u, 3.4)}${blur('s' + u, 1.4)}</defs>
    <ellipse cx="50" cy="-8" rx="34" ry="11" fill="var(--fa)" filter="url(#g${u})" opacity=".55"><animate attributeName="opacity" values=".35;.7;.35" dur="3s" repeatCount="indefinite"/></ellipse>
    <g><animateTransform attributeName="transform" type="translate" values="0 0;0 -3;0 0" dur="3.2s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"/>
      <ellipse cx="50" cy="-8" rx="32" ry="9.4" fill="none" stroke="var(--fa)" stroke-width="1" opacity=".6"/>
      <ellipse cx="50" cy="-8" rx="28" ry="8" fill="none" stroke="url(#h${u})" stroke-width="7" filter="url(#s${u})" opacity=".8"/>
      <ellipse cx="50" cy="-8" rx="28" ry="8" fill="none" stroke="url(#h${u})" stroke-width="3.8"/>
      <ellipse cx="50" cy="-9" rx="28" ry="7.4" fill="none" stroke="#fff" stroke-width=".9" opacity=".8"/></g>
    ${spark(86, -9, 6, 0)}${spark(14, -14, 4.2, -.8)}${spark(70, -22, 3.4, -1.5)}${spark(30, -24, 3, -.4)}
    ${rng(8).map((i) => part(26 + i * 7.5, -6 + (i % 3) * 2, (i % 2 ? 3 : -3), -22 - (i % 3) * 5, 1.1 + (i % 3) * .35, 2.8 + (i % 4) * .4, -i * .45, i % 2 ? '#fff' : 'var(--fa)')).join('')}` },

  wings: { name: 'Angel', fa: '#e0e7ff', fb: '#a5b4fc', svg: (u) => {
    const row = (set, op, sc) => set.map(([a, L]) => `<path transform="rotate(${a}) scale(${sc})" d="M0 0C${f(L * .28)} ${-L * .22} ${f(L * .72)} ${-L * .2} ${L} ${-L * .03}C${f(L * .8)} ${f(L * .17)} ${f(L * .3)} ${f(L * .22)} 0 0Z" fill="url(#w${u})" opacity="${op}" stroke="var(--fb)" stroke-width=".55"/>`).join('');
    const back = [[238, 26], [220, 31], [202, 34], [184, 33], [166, 29], [150, 23]], front = [[228, 21], [208, 25], [188, 27], [168, 24], [152, 18]];
    const wing = `<g transform="translate(10 56) scale(1.8)"><g><animateTransform attributeName="transform" type="rotate" values="0;-9;0" dur="3s" repeatCount="indefinite" calcMode="spline" keyTimes="0;.5;1" keySplines=".4 0 .6 1;.4 0 .6 1"/>
      <g filter="url(#g${u})" opacity=".55">${row(back, 1, 1)}</g>${row(back, .78, 1)}${row(front, 1, 1)}</g></g>`;
    return `<defs><linearGradient id="w${u}" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#fff"/><stop offset=".55" ${S('--fa')}/><stop offset="1" ${S('--fb')}/></linearGradient>${blur('g' + u, 2.6)}</defs>${wing}<g transform="translate(100 0) scale(-1 1)">${wing}</g>
    ${rng(6).map((i) => `<g><ellipse rx="1.3" ry="3.4" fill="#fff" opacity="0"><animateMotion path="M${i % 2 ? 100 + 8 * i : -4 - 6 * i} 30 C${i % 2 ? 108 : -12} 48, ${i % 2 ? 92 : 8} 60, ${i % 2 ? 100 : 0} 82" dur="${5 + i * .6}s" begin="${-i * 1.1}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;.9;.9;0" keyTimes="0;.2;.7;1" dur="${5 + i * .6}s" begin="${-i * 1.1}s" repeatCount="indefinite"/></ellipse></g>`).join('')}
    ${spark(-14, 28, 4, -.3)}${spark(114, 30, 4, -1.2)}` ; } },

  flame: { name: 'Inferno', fa: '#ef4444', fb: '#fde047', svg: (u) => {
    const layer = (n, off, long, short, fill, delay) => rng(n).map((i) => `<g transform="translate(50 50) rotate(${i * (360 / n) + off})"><path class="fl" style="animation-delay:${((i * 7) % 5) * -.21 + delay}s;animation-duration:${1 + (i % 3) * .18}s" d="M-6 -49C-10.5 -57 -2.5 -63 0 -${i % 2 ? short : long}C2.5 -63 10.5 -57 6 -49Z" fill="${fill}"/></g>`).join('');
    return `<defs><linearGradient id="a${u}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" ${S('--fa')}/><stop offset="1" stop-color="#7f1d1d"/></linearGradient><linearGradient id="b${u}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" ${S('--fb')}/><stop offset="1" ${S('--fa')}/></linearGradient><linearGradient id="c${u}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" ${S('--fb')}/></linearGradient>${blur('g' + u, 4)}${blur('e' + u, .9)}</defs>
      <circle cx="50" cy="50" r="54" fill="none" stroke="var(--fa)" stroke-width="9" filter="url(#g${u})" opacity=".7"><animate attributeName="opacity" values=".45;.85;.45" dur="1.6s" repeatCount="indefinite"/></circle>
      ${layer(16, 4, 78, 66, `url(#a${u})`, 0)}${layer(16, 15, 70, 60, `url(#b${u})`, -.3)}${layer(16, 9, 60, 54, `url(#c${u})`, -.5)}
      <circle cx="50" cy="50" r="51.5" fill="none" stroke="url(#b${u})" stroke-width="2.6"/>
      ${rng(14).map((i) => { const [x, y] = P(54, -140 + i * 14); return part(x, y, (i % 2 ? 6 : -6), -26 - (i % 4) * 7, 1 + (i % 3) * .35, 1.8 + (i % 5) * .35, -i * .4, i % 3 ? 'var(--fb)' : '#fff', 'e' + u); }).join('')}`; } },

  orbit: { name: 'Galaxy', fa: '#22d3ee', fb: '#a78bfa', svg: (u) => {
    const ring = (rot, c, dur, begin) => `<g transform="rotate(${rot} 50 50)"><ellipse cx="50" cy="50" rx="66" ry="25" fill="none" stroke="${c}" stroke-width="1.2" opacity=".75"/>${[0, 1, 2, 3].map((k) => `<circle r="${[3.6, 2.8, 2, 1.3][k]}" fill="${k ? c : '#fff'}" opacity="${[1, .7, .45, .25][k]}" ${k === 0 ? `filter="url(#o${u})"` : ''}><animateMotion path="M-16 50A66 25 0 1 1 116 50A66 25 0 1 1 -16 50Z" dur="${dur}s" begin="${begin + k * .09}s" repeatCount="indefinite"/></circle>`).join('')}</g>`;
    return `<defs>${blur('o' + u, 1.6)}</defs>${ring(24, 'var(--fa)', 4.6, 0)}${ring(-32, 'var(--fb)', 5.8, -1.7)}${ring(88, '#fff', 7.2, -3.1)}
      ${rng(10).map((i) => { const [x, y] = P(58 + (i % 3) * 5, i * 36 + 9); return `<circle cx="${x}" cy="${y}" r="${1 + (i % 3) * .35}" fill="#fff"><animate attributeName="opacity" values=".1;1;.1" dur="${1.8 + (i % 4) * .5}s" begin="${-i * .3}s" repeatCount="indefinite"/></circle>`; }).join('')}
      ${spark(-8, 6, 5, -.5, 'var(--fa)')}${spark(112, 94, 5, -1.4, 'var(--fb)')}` ; } },

  crown: { name: 'Crown', fa: '#fde047', fb: '#d97706', svg: (u) => {
    const D = 'M26 6L22 -17L37 -5L50 -26L63 -5L78 -17L74 6Z';
    return `<defs>${grad('c' + u, 0, 0, 0, 1)}${blur('g' + u, 2.6)}<clipPath id="cl${u}"><path d="${D}"/></clipPath>
      <linearGradient id="sh${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      <path transform="translate(50 6) scale(1.3) translate(-50 -6)" d="${D}" fill="var(--fa)" filter="url(#g${u})" opacity=".6"><animate attributeName="opacity" values=".4;.75;.4" dur="2.6s" repeatCount="indefinite"/></path>
      <g transform="translate(50 6) scale(1.3) translate(-50 -6)"><g><animateTransform attributeName="transform" type="translate" values="0 0;0 -1.6;0 0" dur="3s" repeatCount="indefinite"/>
        <path d="${D}" fill="url(#c${u})" stroke="#fff" stroke-opacity=".6" stroke-width=".9" stroke-linejoin="round"/>
        <g clip-path="url(#cl${u})"><rect x="-30" y="-34" width="16" height="60" fill="url(#sh${u})" transform="rotate(18)"><animateTransform attributeName="transform" additive="sum" type="translate" values="-30 0;-30 0;120 0;120 0" keyTimes="0;.15;.6;1" dur="3.4s" repeatCount="indefinite"/></rect></g>
        <rect x="26" y="2" width="48" height="6.4" rx="2.6" fill="var(--fb)" stroke="#fff" stroke-opacity=".5" stroke-width=".6"/>
        <circle cx="50" cy="-10" r="3.8" fill="#ef4444" stroke="#fff" stroke-width=".8"><animate attributeName="r" values="3.6;4.2;3.6" dur="2s" repeatCount="indefinite"/></circle><circle cx="34" cy="-3" r="2.4" fill="#38bdf8" stroke="#fff" stroke-width=".6"/><circle cx="66" cy="-3" r="2.4" fill="#38bdf8" stroke="#fff" stroke-width=".6"/>
        <circle cx="22" cy="-17" r="2" fill="#fff"/><circle cx="50" cy="-26" r="2.2" fill="#fff"/><circle cx="78" cy="-17" r="2" fill="#fff"/></g></g>
      ${spark(50, -26, 5, 0)}${spark(24, -19, 3.4, -.9)}${spark(76, -19, 3.4, -1.7)}${spark(64, -10, 3, -.4)}
      ${rng(5).map((i) => part(32 + i * 9, -14 - (i % 2) * 6, (i % 2 ? 4 : -4), -16, 1.2, 2.6, -i * .6, '#fff')).join('')}` ; } },

  horns: { name: 'Demon', fa: '#7f1d1d', fb: '#ef4444', svg: (u) => {
    const h = `<path d="M23 8C6 6 0 -10 11 -25C14 -11 25 -3 38 2Z" fill="url(#hn${u})" stroke="var(--fb)" stroke-width=".9" stroke-linejoin="round"/><path d="M13 -19C15 -10 21 -4 30 0" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.3" stroke-linecap="round"/><path d="M11 -25C12 -20 14 -16 16 -13" stroke="var(--fb)" stroke-width="1.2" fill="none" filter="url(#g${u})"/>`;
    return `<defs><linearGradient id="hn${u}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" ${S('--fa')}/><stop offset=".6" ${S('--fb')}/><stop offset="1" stop-color="#fecaca"/></linearGradient>${blur('g' + u, 2)}${blur('a' + u, 4)}${blur('e' + u, .8)}</defs>
      <circle cx="50" cy="50" r="52" fill="none" stroke="var(--fb)" stroke-width="7" filter="url(#a${u})" opacity=".55"><animate attributeName="opacity" values=".25;.7;.25" dur="2.2s" repeatCount="indefinite"/></circle>
      <circle cx="50" cy="50" r="51.4" fill="none" stroke="var(--fb)" stroke-width="1.2" opacity=".75"/>
      <g transform="translate(23 8) scale(1.3) translate(-23 -8)">${h}</g><g transform="translate(100 0) scale(-1 1)"><g transform="translate(23 8) scale(1.3) translate(-23 -8)">${h}</g></g>
      ${rng(14).map((i) => { const [x, y] = P(53, -150 + i * 17); return part(x, y, (i % 2 ? 5 : -5), -24 - (i % 4) * 6, .9 + (i % 3) * .35, 2 + (i % 5) * .3, -i * .37, i % 3 ? 'var(--fb)' : '#fecaca', 'e' + u); }).join('')}` ; } },

  blossom: { name: 'Sakura', fa: '#f9a8d4', fb: '#f472b6', svg: (u) => {
    const petal = (x, y, a, s, c) => `<path transform="translate(${x} ${y}) rotate(${a}) scale(${s})" d="M0 -5C4 -4 5 2 0 5C-5 2 -4 -4 0 -5Z M0 5L0 2.4" fill="${c}" stroke="#fff" stroke-opacity=".5" stroke-width=".5"/>`;
    return `<defs>${blur('g' + u, 3)}</defs>
      <circle cx="50" cy="50" r="54" fill="none" stroke="var(--fa)" stroke-width="6" filter="url(#g${u})" opacity=".5"/>
      <g>${spin(70)}${rng(18).map((i) => { const [x, y] = P(54.5, i * 20); return petal(x, y, i * 20 + 90, 1 + (i % 2) * .35, i % 2 ? 'var(--fb)' : 'var(--fa)'); }).join('')}</g>
      ${rng(10).map((i) => { const sx = -10 + i * 12, d = 4 + i * .5; return `<g><g opacity="0">${petal(0, 0, 0, .8 + (i % 3) * .2, i % 2 ? 'var(--fa)' : 'var(--fb)')}<animateMotion path="M${sx} -16 C${sx + 12} 8, ${sx - 12} 34, ${sx + 6} 70" dur="${d + 2}s" begin="${-i * .9}s" repeatCount="indefinite" rotate="auto"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.15;.75;1" dur="${d + 2}s" begin="${-i * .9}s" repeatCount="indefinite"/></g></g>`; }).join('')}` ; } },

  cyber: { name: 'Hologram', fa: '#22d3ee', fb: '#e879f9', svg: (u) => {
    const [ax, ay] = P(57, -28), [bx, by] = P(57, 28);
    return `<defs>${grad('y' + u, 0, 0, 1, 1)}${blur('g' + u, 2.4)}${blur('t' + u, 1.4)}</defs>
      <g>${spin(10)}<circle cx="50" cy="50" r="57" fill="none" stroke="url(#y${u})" stroke-width="5" stroke-dasharray="34 7 6 7" filter="url(#g${u})" opacity=".85"/><circle cx="50" cy="50" r="57" fill="none" stroke="url(#y${u})" stroke-width="2.4" stroke-dasharray="34 7 6 7"/></g>
      <g>${spin(16, -1)}<circle cx="50" cy="50" r="64" fill="none" stroke="var(--fb)" stroke-width="1" stroke-dasharray="2 4.4" opacity=".9"/></g>
      ${rng(36).map((i) => { const [x1, y1] = P(68, i * 10), [x2, y2] = P(i % 3 ? 70.5 : 73.5, i * 10); return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${i % 3 ? 'var(--fa)' : '#fff'}" stroke-width="${i % 3 ? .7 : 1.2}" opacity="${i % 3 ? .6 : .95}"/>`; }).join('')}
      ${sweep(57, 2, 3.2, u, 60)}
      ${[0, 1, 2].map((k) => `<g>${spin(5 + k * 2.2, k % 2 ? -1 : 1)}<rect x="${f(50 + 64 - 2)}" y="48" width="4" height="4" fill="${k === 1 ? 'var(--fb)' : 'var(--fa)'}" transform="rotate(${k * 120} 50 50)"/></g>`).join('')}
      <circle cx="50" cy="50" r="57" fill="none" stroke="var(--fb)" stroke-width="1.4" opacity="0" transform="translate(2.4 0)"><animate attributeName="opacity" values="0;0;.8;0;0;.7;0;0" keyTimes="0;.5;.52;.56;.8;.82;.85;1" dur="4s" repeatCount="indefinite"/></circle>` ; } },

  ice: { name: 'Frost', fa: '#7dd3fc', fb: '#e0f2fe', svg: (u) => `<defs><linearGradient id="i${u}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" ${S('--fa')}/><stop offset="1" stop-color="#fff"/></linearGradient>${blur('g' + u, 3)}</defs>
    <circle cx="50" cy="50" r="54" fill="none" stroke="var(--fa)" stroke-width="8" filter="url(#g${u})" opacity=".6"><animate attributeName="opacity" values=".35;.75;.35" dur="3s" repeatCount="indefinite"/></circle>
    ${rng(24).map((i) => { const a = i * 15, L = [72, 62, 66, 58][i % 4], [bx1, by1] = P(51, a - 4.4), [bx2, by2] = P(51, a + 4.4), [tx, ty] = P(L, a); return `<path d="M${bx1} ${by1}L${tx} ${ty}L${bx2} ${by2}Z" fill="url(#i${u})" stroke="#fff" stroke-opacity=".8" stroke-width=".5" stroke-linejoin="round"><animate attributeName="opacity" values=".7;1;.7" dur="${2 + (i % 5) * .4}s" begin="${-i * .23}s" repeatCount="indefinite"/></path>`; }).join('')}
    <circle cx="50" cy="50" r="51.5" fill="none" stroke="#fff" stroke-width="2.2" opacity=".85"/>${sweep(51.5, 1.8, 4, u, 50)}
    ${rng(12).map((i) => part(-14 + i * 11.5, -20 - (i % 3) * 3, (i % 2 ? 7 : -7), 100 + (i % 3) * 8, 1 + (i % 3) * .5, 6 + (i % 4), -i * .8, '#fff')).join('')}${spark(-6, 12, 4.5, -.3, '#fff')}${spark(108, 80, 4.5, -1.3, '#fff')}` },

  laurel: { name: 'Laurel', fa: '#fde68a', fb: '#ca8a04', svg: (u) => {
    const leaves = (inner) => rng(16).map((i) => { const a = 94 + i * 10, r = 55.5 + (inner ? -1.6 : 2.4), [x, y] = P(r, a); return `<path transform="rotate(${a + 90 + (inner ? -34 : 30)} ${x} ${y}) translate(${x} ${y})" d="M0 -9C4.4 -5 4.4 5 0 9C-4.4 5 -4.4 -5 0 -9Z M0 -8L0 8" fill="url(#l${u})" stroke="#fff" stroke-opacity=".5" stroke-width=".5"><animate attributeName="opacity" values=".7;1;.7" dur="2.6s" begin="${-i * .16}s" repeatCount="indefinite"/></path>`; }).join('');
    const [sx, sy] = P(55, 94), [ex, ey] = P(55, 254);
    const br = `<path d="M${sx} ${sy}A55 55 0 0 1 ${ex} ${ey}" fill="none" stroke="var(--fb)" stroke-width="1.8" stroke-linecap="round"/>${leaves(false)}${leaves(true)}`;
    return `<defs>${grad('l' + u, 0, 0, 1, 1)}${blur('g' + u, 3)}</defs><circle cx="50" cy="50" r="56" fill="none" stroke="var(--fa)" stroke-width="7" filter="url(#g${u})" opacity=".35"/>${br}<g transform="translate(100 0) scale(-1 1)">${br}</g>
      <g transform="translate(50 107)"><path d="M0 0C-9 -4 -13 4 -7 6C-3 7 -1 3 0 0C1 3 3 7 7 6C13 4 9 -4 0 0Z" fill="url(#l${u})" stroke="#fff" stroke-opacity=".6" stroke-width=".6"/><circle r="2.2" fill="#fff"/></g>${spark(8, 40, 4, -.4)}${spark(92, 36, 4, -1.5)}${spark(50, 112, 3.4, -.9)}`; } },

  thorn: { name: 'Gothic', fa: '#ef4444', fb: '#fb7185', svg: (u) => {
    const pts = rng(120).map((i) => { const a = i * 3, r = 53 + Math.sin(a * Math.PI / 180 * 9) * 1.8; const [x, y] = P(r, a); return `${i ? 'L' : 'M'}${x} ${y}`; }).join('') + 'Z';
    return `<defs>${blur('g' + u, 2.6)}${blur('m' + u, 5)}${blur('e' + u, .8)}</defs>
      <circle cx="50" cy="50" r="56" fill="none" stroke="#7f1d1d" stroke-width="10" filter="url(#m${u})" opacity=".5"><animate attributeName="opacity" values=".25;.6;.25" dur="3.4s" repeatCount="indefinite"/></circle>
      <path d="${pts}" fill="none" stroke="#0e0509" stroke-width="5.6"/><path d="${pts}" fill="none" stroke="var(--fa)" stroke-width=".9" opacity=".7"/>
      ${rng(18).map((i) => { const a = i * 20 + 4, L = i % 2 ? 66 : 74, [x1, y1] = P(52, a - 5.5), [x2, y2] = P(52, a + 5.5), [tx, ty] = P(L, a + 5); return `<path d="M${x1} ${y1}L${tx} ${ty}L${x2} ${y2}Z" fill="#0e0509" stroke="var(--fa)" stroke-width=".8" stroke-linejoin="round"/>`; }).join('')}
      ${[0, 90, 180, 270].map((a, k) => { const [x, y] = P(53, a + 10); return `<circle cx="${x}" cy="${y}" r="5" fill="var(--fa)" filter="url(#g${u})"><animate attributeName="opacity" values=".35;1;.35" dur="2.2s" begin="${-k * .5}s" repeatCount="indefinite"/></circle><circle cx="${x}" cy="${y}" r="3.2" fill="var(--fa)" stroke="#fff" stroke-opacity=".7" stroke-width=".7"/><circle cx="${f(x - 1)}" cy="${f(y - 1)}" r=".9" fill="#fff"/>`; }).join('')}
      ${rng(10).map((i) => { const [x, y] = P(58, i * 36); return part(x, y, (i % 2 ? 4 : -4), -22, .9, 2.2 + (i % 3) * .4, -i * .45, 'var(--fb)', 'e' + u); }).join('')}`; } },

  stars: { name: 'Cosmic', fa: '#fde68a', fb: '#ffffff', svg: (u) => `<defs><linearGradient id="ss${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>${blur('g' + u, 2.2)}</defs>
    <circle cx="50" cy="50" r="55" fill="none" stroke="var(--fb)" stroke-width="9" filter="url(#g${u})" opacity=".3"><animate attributeName="opacity" values=".15;.4;.15" dur="4s" repeatCount="indefinite"/></circle>
    <circle cx="50" cy="50" r="56" fill="none" stroke="var(--fa)" stroke-width="1" stroke-dasharray="1 4.4" opacity=".9"/>
    <g>${spin(14)}<circle cx="50" cy="-6" r="2.8" fill="#fff" filter="url(#g${u})"/><circle cx="50" cy="-6" r="1.6" fill="var(--fa)"/></g>
    <g>${spin(20, -1)}<circle cx="106" cy="50" r="2.2" fill="var(--fb)"/></g>
    ${[[58, -48, 8], [62, 20, 10], [58, 108, 6.5], [66, 198, 9], [61, 250, 6.5], [57, 328, 5.5]].map(([r, a, s], i) => { const [x, y] = P(r, a); return spark(x, y, s, -i * .45, i % 2 ? 'var(--fa)' : '#fff'); }).join('')}
    ${rng(14).map((i) => { const [x, y] = P(55 + (i % 4) * 4, i * 25.7 + 7); return `<circle cx="${x}" cy="${y}" r="${.9 + (i % 3) * .3}" fill="#fff"><animate attributeName="opacity" values=".1;1;.1" dur="${1.4 + (i % 5) * .4}s" begin="${-i * .3}s" repeatCount="indefinite"/></circle>`; }).join('')}
    <g transform="rotate(35 50 50)"><g><path d="M-30 -10L-6 -10" stroke="url(#ss${u})" stroke-width="1.8" stroke-linecap="round"/><circle cx="-5" cy="-10" r="2" fill="#fff" filter="url(#g${u})"/>
      <animateTransform attributeName="transform" type="translate" values="-20 0;-20 0;150 80;150 80" keyTimes="0;.1;.4;1" dur="5s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;.1;.2;.4;1" dur="5s" repeatCount="indefinite"/></g></g>` },

  royal: { name: 'Royal', fa: '#fde68a', fb: '#b45309', svg: (u) => `<defs>${grad('r' + u, 0, 0, 1, 1, 1)}${blur('g' + u, 2.6)}${SW(u)}</defs>
    <circle cx="50" cy="50" r="54" fill="none" stroke="var(--fa)" stroke-width="8" filter="url(#g${u})" opacity=".5"><animate attributeName="opacity" values=".3;.65;.3" dur="3s" repeatCount="indefinite"/></circle>
    <circle cx="50" cy="50" r="54" fill="none" stroke="url(#r${u})" stroke-width="4.4"/><circle cx="50" cy="50" r="54" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".7" transform="translate(0 -.8)"/>
    <circle cx="50" cy="50" r="60.5" fill="none" stroke="var(--fb)" stroke-width="1"/><circle cx="50" cy="50" r="63" fill="none" stroke="var(--fa)" stroke-width=".6" stroke-dasharray="1.2 3"/>
    ${sweep(54, 2, 4.2, u, 56)}
    ${rng(12).map((i) => { const [x, y] = P(60.5, i * 30 + 15); return `<rect x="${f(x - 2.6)}" y="${f(y - 2.6)}" width="5.2" height="5.2" transform="rotate(45 ${x} ${y})" fill="var(--fa)" stroke="#fff" stroke-opacity=".7" stroke-width=".5"/>`; }).join('')}
    ${[[0, 4, '#ef4444'], [90, 4, '#38bdf8'], [180, 4, '#34d399'], [270, 4, '#38bdf8'], [-90, 6, '#ef4444']].map(([a, r, c]) => { const [x, y] = P(57, a); return `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="#fff" stroke-width="1"/><circle cx="${f(x - r * .3)}" cy="${f(y - r * .3)}" r="${f(r * .32)}" fill="#fff" opacity=".9"/>`; }).join('')}
    ${spark(50, -17, 5, 0)}${spark(104, 38, 3.6, -1)}${spark(-4, 66, 3.6, -1.8)}` },

  storm: { name: 'Storm', fa: '#60a5fa', fb: '#fef08a', svg: (u) => {
    const bolt = (a, k) => { const pts = []; let r = 53; for (let i = 0; i < 6; i++) { const aa = a + (i % 2 ? 4 : -4) * (k % 2 ? 1 : -1) + (i === 5 ? 0 : 0); pts.push(P(r, aa)); r += 3.6 + (i % 2); } return `M${pts.map(([x, y]) => `${x} ${y}`).join('L')}`; };
    return `<defs>${blur('g' + u, 2.4)}${blur('s' + u, 5)}</defs>
      <circle cx="50" cy="50" r="54" fill="none" stroke="var(--fa)" stroke-width="9" filter="url(#s${u})" opacity=".5"><animate attributeName="opacity" values=".25;.8;.3;.75;.25" keyTimes="0;.1;.2;.3;1" dur="2.4s" repeatCount="indefinite"/></circle>
      <circle cx="50" cy="50" r="52" fill="none" stroke="var(--fa)" stroke-width="2.4"/><circle cx="50" cy="50" r="52" fill="none" stroke="#fff" stroke-width=".7" opacity=".9"/>
      <path d="${rng(72).map((i) => { const [x, y] = P(57 + (i % 2 ? 2.6 : -2.6) + (i % 5) * .5, i * 5); return `${i ? 'L' : 'M'}${x} ${y}`; }).join('')}Z" fill="none" stroke="var(--fb)" stroke-width="1.1" stroke-linejoin="round" filter="url(#g${u})" opacity=".7"><animate attributeName="opacity" values=".35;.95;.4;.9;.35" keyTimes="0;.2;.4;.7;1" dur="0.9s" repeatCount="indefinite"/></path>
      ${rng(10).map((i) => { const a = i * 36 + 8, d = bolt(a, i); return `<g opacity="0"><path d="${d}" fill="none" stroke="var(--fa)" stroke-width="4" filter="url(#g${u})"/><path d="${d}" fill="none" stroke="var(--fb)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/><animate attributeName="opacity" values="0;1;.35;1;.2;0" keyTimes="0;.06;.12;.2;.32;1" dur="${1.5 + (i % 4) * .35}s" begin="${-i * .37}s" repeatCount="indefinite"/></g>`; }).join('')}
      ${rng(10).map((i) => { const [x, y] = P(56, i * 36 + 20); return part(x, y, (i % 2 ? 5 : -5), -9 + (i % 3) * 5, .9, 1.6 + (i % 3) * .3, -i * .3, 'var(--fb)'); }).join('')}`; } },

  aurora: { name: 'Aurora', fa: '#34d399', fb: '#a78bfa', svg: (u) => {
    const wave = (k, ph, amp) => rng(90).map((i) => { const a = i * 4, r = 55 + Math.sin(a * Math.PI / 180 * k + ph) * amp; const [x, y] = P(r, a); return `${i ? 'L' : 'M'}${x} ${y}`; }).join('') + 'Z';
    return `<defs><linearGradient id="au${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" ${S('--fa')}/><stop offset=".5" ${S('--fb')}/><stop offset="1" ${S('--fa')}/></linearGradient>${blur('g' + u, 3)}${blur('t' + u, 1)}</defs>
      <g filter="url(#g${u})" opacity=".9"><g>${spin(11)}<path d="${wave(3, 0, 5)}" fill="none" stroke="var(--fa)" stroke-width="5"/></g><g>${spin(15, -1)}<path d="${wave(4, 1.2, 4.5)}" fill="none" stroke="var(--fb)" stroke-width="5"/></g></g>
      <g>${spin(11)}<path d="${wave(3, 0, 5)}" fill="none" stroke="url(#au${u})" stroke-width="1.8" stroke-linecap="round"/></g>
      <g>${spin(15, -1)}<path d="${wave(4, 1.2, 4.5)}" fill="none" stroke="url(#au${u})" stroke-width="1.8" stroke-linecap="round"/></g>
      <g>${spin(21)}<path d="${wave(2, 2.4, 6)}" fill="none" stroke="#fff" stroke-width=".8" opacity=".7"/></g>
      ${rng(12).map((i) => { const [x, y] = P(58, i * 30); return part(x, y, (i % 2 ? 4 : -4), -16 - (i % 3) * 5, 1 + (i % 3) * .3, 2.6 + (i % 4) * .4, -i * .5, i % 2 ? 'var(--fa)' : '#fff', 't' + u); }).join('')}${spark(2, 20, 4, -.5, 'var(--fa)')}${spark(98, 80, 4, -1.4, 'var(--fb)')}`; } },

  prism: { name: 'Prism', fa: '#ffffff', fb: '#ffffff', fixed: true, svg: (u) => `<defs>${blur('g' + u, 3)}${SW(u)}</defs>
    <g>${spin(7)}<g filter="url(#g${u})" opacity=".8">${rng(36).map((i) => { const [x1, y1] = P(54, i * 10), [x2, y2] = P(54, i * 10 + 11); return `<path d="M${x1} ${y1}A54 54 0 0 1 ${x2} ${y2}" fill="none" stroke="hsl(${i * 10} 95% 62%)" stroke-width="8"/>`; }).join('')}</g>
    ${rng(36).map((i) => { const [x1, y1] = P(54, i * 10), [x2, y2] = P(54, i * 10 + 11); return `<path d="M${x1} ${y1}A54 54 0 0 1 ${x2} ${y2}" fill="none" stroke="hsl(${i * 10} 95% 62%)" stroke-width="5.4"/>`; }).join('')}</g>
    <circle cx="50" cy="50" r="51" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width=".8"/>${sweep(54, 2, 3.4, u, 40)}
    ${rng(8).map((i) => { const [x, y] = P(60, i * 45); return part(x, y, (i % 2 ? 3 : -3), -12, 1, 2.4, -i * .4, `hsl(${i * 45} 95% 70%)`); }).join('')}` },
};

export const DECO_IDS = Object.keys(DECOS);
let uid = 0;
export function decoSvg(id) {
  const d = DECOS[id]; if (!d) return '';
  const u = ++uid;
  return `<svg class="avd-svg" viewBox="-28 -28 156 156" aria-hidden="true">${d.svg(u)}</svg>`;
}
