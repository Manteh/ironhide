// Avatar decorations: big ornate frames that extend past the avatar (like Discord's), drawn as SVG.
// The avatar fills 0..100 in a viewBox of -22..122, so pieces can sit above, beside and around it.
// Colours come from --fa / --fb on the avatar, so every decoration can be recoloured.
const f = (n) => +n.toFixed(2);
const P = (r, a, cx = 50, cy = 50) => [f(cx + r * Math.cos((a * Math.PI) / 180)), f(cy + r * Math.sin((a * Math.PI) / 180))];
const S = (v) => `style="stop-color:var(${v})"`;
const grad = (id, x1 = 0, y1 = 0, x2 = 1, y2 = 1, mid) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop offset="0" ${S('--fa')}/>${mid ? `<stop offset=".5" ${S('--fb')}/>` : ''}<stop offset="1" ${mid ? S('--fa') : S('--fb')}/></linearGradient>`;
const glow = (id, sd = 2.2) => `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
const spark = (cx, cy, r, cls = '', style = '') => `<path class="tw ${cls}" style="${style}" fill="#fff" d="M${cx} ${f(cy - r)}Q${cx} ${cy} ${f(cx + r)} ${cy}Q${cx} ${cy} ${cx} ${f(cy + r)}Q${cx} ${cy} ${f(cx - r)} ${cy}Q${cx} ${cy} ${cx} ${f(cy - r)}Z"/>`;
const rng = (n) => Array.from({ length: n }, (_, i) => i);

export const DECOS = {
  halo: { name: 'Halo', fa: '#fde68a', fb: '#f59e0b', svg: (u) => `<defs>${grad('h' + u, 0, 0, 1, 0, 1)}${glow('g' + u)}</defs>
    <g><animateTransform attributeName="transform" type="translate" values="0 0;0 -2.6;0 0" dur="3.2s" repeatCount="indefinite"/>
    <ellipse cx="50" cy="-9" rx="28" ry="8" fill="none" stroke="url(#h${u})" stroke-width="6" filter="url(#g${u})" opacity=".85"/>
    <ellipse cx="50" cy="-9" rx="28" ry="8" fill="none" stroke="url(#h${u})" stroke-width="3.4"/>
    <ellipse cx="50" cy="-9.8" rx="28" ry="7.4" fill="none" stroke="#fff" stroke-width=".9" opacity=".75"/></g>${spark(86, -8, 5)}${spark(14, -12, 3.5, 'd2')}` },

  wings: { name: 'Wings', fa: '#e0e7ff', fb: '#a5b4fc', svg: (u) => {
    const wing = [[235, 22], [213, 27], [191, 29], [169, 26], [147, 20]].map(([a, L]) => `<path transform="rotate(${a})" d="M0 0C${f(L * .3)} ${-L * .2} ${f(L * .75)} ${-L * .18} ${L} 0C${f(L * .78)} ${f(L * .15)} ${f(L * .3)} ${f(L * .2)} 0 0Z" fill="url(#w${u})" stroke="var(--fb)" stroke-width=".7"/>`).join('');
    const w = `<g transform="translate(9 54) scale(1.4)"><g><animateTransform attributeName="transform" type="rotate" values="0;-6;0" dur="2.8s" repeatCount="indefinite"/>${wing}</g></g>`;
    return `<defs><linearGradient id="w${u}" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" ${S('--fa')}/></linearGradient></defs>${w}<g transform="translate(100 0) scale(-1 1)">${w}</g>`; } },

  flame: { name: 'Flame', fa: '#ef4444', fb: '#fde047', svg: (u) => `<defs><linearGradient id="f${u}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" ${S('--fb')}/><stop offset="1" ${S('--fa')}/></linearGradient>${glow('g' + u, 3)}</defs>
    <circle cx="50" cy="50" r="52" fill="none" stroke="var(--fa)" stroke-width="5" opacity=".7" filter="url(#g${u})"/>
    ${rng(14).map((i) => `<g transform="translate(50 50) rotate(${i * (360 / 14)})"><path class="fl" style="animation-delay:${(i % 5) * -.23}s" d="M-5.4 -49C-9 -57 -2 -62 0 -${i % 2 ? 66 : 71}C2 -62 9 -57 5.4 -49Z" fill="url(#f${u})"/></g>`).join('')}
    <circle cx="50" cy="50" r="51.5" fill="none" stroke="url(#f${u})" stroke-width="2.4"/>` },

  orbit: { name: 'Orbit', fa: '#22d3ee', fb: '#a78bfa', svg: (u) => `<defs>${glow('g' + u, 1.6)}</defs>
    <g><animateTransform attributeName="transform" type="rotate" values="0 50 50;360 50 50" dur="14s" repeatCount="indefinite"/>
    <ellipse cx="50" cy="50" rx="62" ry="22" transform="rotate(28 50 50)" fill="none" stroke="var(--fa)" stroke-width="1.6" opacity=".9"/>
    <ellipse cx="50" cy="50" rx="62" ry="22" transform="rotate(-28 50 50)" fill="none" stroke="var(--fb)" stroke-width="1.6" opacity=".9"/>
    <circle cx="${P(62, 0)[0] + 0}" cy="50" r="3.6" fill="#fff" transform="rotate(28 50 50)" filter="url(#g${u})"/><circle cx="${P(62, 180)[0]}" cy="50" r="3" fill="var(--fb)" transform="rotate(-28 50 50)"/><circle cx="${P(62, 0)[0]}" cy="50" r="2.4" fill="#fff" transform="rotate(-28 50 50)"/></g>
    <circle cx="50" cy="50" r="56" fill="none" stroke="var(--fa)" stroke-width=".8" stroke-dasharray="1 5" opacity=".8"/>` },

  crown: { name: 'Crown', fa: '#fde047', fb: '#d97706', svg: (u) => `<defs>${grad('c' + u, 0, 0, 0, 1)}${glow('g' + u, 2)}</defs>
    <path d="M27 5L24 -14L38 -4L50 -20L62 -4L76 -14L73 5Z" fill="var(--fa)" opacity=".5" filter="url(#g${u})"/>
    <path d="M27 5L24 -14L38 -4L50 -20L62 -4L76 -14L73 5Z" fill="url(#c${u})" stroke="#fff" stroke-opacity=".55" stroke-width=".8" stroke-linejoin="round"/>
    <rect x="27" y="1.4" width="46" height="5.6" rx="2.4" fill="var(--fb)" stroke="#fff" stroke-opacity=".4" stroke-width=".6"/>
    <circle cx="50" cy="-9" r="3" fill="#ef4444" stroke="#fff" stroke-width=".7"/><circle cx="35" cy="-3" r="2" fill="#38bdf8"/><circle cx="65" cy="-3" r="2" fill="#38bdf8"/>${spark(50, -9, 4, 'd3')}` },

  horns: { name: 'Horns', fa: '#7f1d1d', fb: '#ef4444', svg: (u) => {
    const h = `<path d="M24 7C9 6 3 -8 12 -21C15 -8 24 -2 37 2Z" fill="url(#hn${u})" stroke="var(--fb)" stroke-width=".8" stroke-linejoin="round"/><path d="M14 -16C16 -9 21 -4 28 0" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1" stroke-linecap="round"/>`;
    return `<defs><linearGradient id="hn${u}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" ${S('--fa')}/><stop offset="1" ${S('--fb')}/></linearGradient></defs>${h}<g transform="translate(100 0) scale(-1 1)">${h}</g>`; } },

  blossom: { name: 'Blossom', fa: '#f9a8d4', fb: '#f472b6', svg: () => `<g><animateTransform attributeName="transform" type="rotate" values="0 50 50;360 50 50" dur="70s" repeatCount="indefinite"/>
    ${rng(16).map((i) => { const [x, y] = P(i % 2 ? 56 : 54, i * 22.5); return `<ellipse cx="${x}" cy="${y}" rx="${i % 2 ? 4 : 5.2}" ry="${i % 2 ? 7 : 9}" transform="rotate(${i * 22.5 + 90} ${x} ${y})" fill="var(${i % 2 ? '--fb' : '--fa'})" stroke="#fff" stroke-opacity=".5" stroke-width=".6"/>`; }).join('')}
    ${rng(8).map((i) => { const [x, y] = P(61, i * 45 + 11); return `<circle cx="${x}" cy="${y}" r="1.7" fill="#fff" opacity=".9"/>`; }).join('')}</g>` },

  cyber: { name: 'Cyber', fa: '#22d3ee', fb: '#e879f9', svg: (u) => `<defs>${grad('y' + u, 0, 0, 1, 1)}${glow('g' + u, 2)}</defs>
    <g><animateTransform attributeName="transform" type="rotate" values="0 50 50;360 50 50" dur="9s" repeatCount="indefinite"/>
    <circle cx="50" cy="50" r="56" fill="none" stroke="url(#y${u})" stroke-width="4" stroke-dasharray="30 7 6 7" filter="url(#g${u})" opacity=".8"/>
    <circle cx="50" cy="50" r="56" fill="none" stroke="url(#y${u})" stroke-width="2.2" stroke-dasharray="30 7 6 7"/></g>
    <g><animateTransform attributeName="transform" type="rotate" values="360 50 50;0 50 50" dur="14s" repeatCount="indefinite"/>
    <circle cx="50" cy="50" r="62" fill="none" stroke="var(--fb)" stroke-width="1" stroke-dasharray="2 5"/></g>
    ${[45, 135, 225, 315].map((a) => { const [x1, y1] = P(50.5, a - 16), [x2, y2] = P(50.5, a + 16); return `<path d="M${x1} ${y1}A50.5 50.5 0 0 1 ${x2} ${y2}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>`; }).join('')}` },

  ice: { name: 'Frost', fa: '#7dd3fc', fb: '#e0f2fe', svg: (u) => `<defs><linearGradient id="i${u}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" ${S('--fa')}/><stop offset="1" stop-color="#fff"/></linearGradient></defs>
    <circle cx="50" cy="50" r="51.5" fill="none" stroke="var(--fa)" stroke-width="3" opacity=".9"/>
    ${rng(20).map((i) => { const a = i * 18, L = i % 2 ? 60 : 70, [bx1, by1] = P(51, a - 5), [bx2, by2] = P(51, a + 5), [tx, ty] = P(L, a); return `<path class="tw" style="animation-delay:${(i % 6) * -.5}s" d="M${bx1} ${by1}L${tx} ${ty}L${bx2} ${by2}Z" fill="url(#i${u})" stroke="var(--fb)" stroke-width=".6" stroke-linejoin="round"/>`; }).join('')}` },

  laurel: { name: 'Laurel', fa: '#fde68a', fb: '#ca8a04', svg: (u) => {
    const side = rng(14).map((i) => { const a = 98 + i * 11, r = 55 + (i % 2 ? 3.5 : -1), [x, y] = P(r, a); return `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="9" transform="rotate(${a + 90 + (i % 2 ? 24 : -24)} ${x} ${y})" fill="url(#l${u})" stroke="#fff" stroke-opacity=".45" stroke-width=".5"/>`; }).join('');
    const [sx, sy] = P(54, 98), [ex, ey] = P(54, 252);
    const br = `<path d="M${sx} ${sy}A54 54 0 0 1 ${ex} ${ey}" fill="none" stroke="var(--fb)" stroke-width="1.6" stroke-linecap="round"/>${side}`;
    return `<defs>${grad('l' + u, 0, 0, 1, 1)}</defs>${br}<g transform="translate(100 0) scale(-1 1)">${br}</g>`; } },

  thorn: { name: 'Thorns', fa: '#ef4444', fb: '#fb7185', svg: (u) => `<defs>${glow('g' + u, 2.4)}</defs>
    ${rng(14).map((i) => { const a = i * (360 / 14) + 6, L = i % 2 ? 64 : 71, [x1, y1] = P(50.5, a - 6), [x2, y2] = P(50.5, a + 6), [tx, ty] = P(L, a + 4); return `<path d="M${x1} ${y1}L${tx} ${ty}L${x2} ${y2}Z" fill="#1a0d14" stroke="var(--fa)" stroke-width=".8" stroke-linejoin="round"/>`; }).join('')}
    <circle cx="50" cy="50" r="52" fill="none" stroke="#1a0d14" stroke-width="5.5"/><circle cx="50" cy="50" r="52" fill="none" stroke="var(--fb)" stroke-width=".8" opacity=".6"/>
    ${[0, 90, 180, 270].map((a) => { const [x, y] = P(52, a); return `<circle cx="${x}" cy="${y}" r="4.4" fill="var(--fa)" filter="url(#g${u})"><animate attributeName="opacity" values=".5;1;.5" dur="2.4s" repeatCount="indefinite"/></circle><circle cx="${x}" cy="${y}" r="3" fill="var(--fa)" stroke="#fff" stroke-opacity=".6" stroke-width=".7"/>`; }).join('')}` },

  stars: { name: 'Stardust', fa: '#fde68a', fb: '#ffffff', svg: () => `<circle cx="50" cy="50" r="56" fill="none" stroke="var(--fa)" stroke-width=".9" stroke-dasharray="1 4.5" opacity=".85"/>
    ${[[58, -50, 7], [61, 18, 9], [57, 110, 6], [64, 196, 8], [60, 252, 6], [56, 326, 5]].map(([r, a, s], i) => { const [x, y] = P(r, a); return `<path class="tw" style="animation-delay:${i * -.45}s" fill="var(${i % 2 ? '--fa' : '--fb'})" d="M${x} ${f(y - s)}Q${x} ${y} ${f(x + s)} ${y}Q${x} ${y} ${x} ${f(y + s)}Q${x} ${y} ${f(x - s)} ${y}Q${x} ${y} ${x} ${f(y - s)}Z"/>`; }).join('')}
    ${rng(9).map((i) => { const [x, y] = P(54 + (i % 3) * 5, i * 40 + 7); return `<circle class="tw" style="animation-delay:${i * -.3}s" cx="${x}" cy="${y}" r="1.3" fill="#fff"/>`; }).join('')}` },

  royal: { name: 'Royal', fa: '#fde68a', fb: '#b45309', svg: (u) => `<defs>${grad('r' + u, 0, 0, 1, 1, 1)}${glow('g' + u, 2)}</defs>
    <circle cx="50" cy="50" r="53" fill="none" stroke="var(--fa)" stroke-width="5" opacity=".4" filter="url(#g${u})"/>
    <circle cx="50" cy="50" r="53" fill="none" stroke="url(#r${u})" stroke-width="3.6"/><circle cx="50" cy="50" r="58.5" fill="none" stroke="var(--fb)" stroke-width=".9"/>
    ${rng(8).map((i) => { const [x, y] = P(58.5, i * 45 + 22.5); return `<rect x="${f(x - 2.4)}" y="${f(y - 2.4)}" width="4.8" height="4.8" transform="rotate(45 ${x} ${y})" fill="var(--fa)" stroke="#fff" stroke-opacity=".6" stroke-width=".5"/>`; }).join('')}
    ${[[0, 3.6, '--fb'], [90, 3.6, '--fb'], [180, 3.6, '--fb'], [270, 3.6, '--fb'], [-90, 5.4, '--fa']].map(([a, r, c]) => { const [x, y] = P(55.5, a); return `<circle cx="${x}" cy="${y}" r="${r}" fill="var(${c})" stroke="#fff" stroke-width=".9"/><circle cx="${f(x - r * .3)}" cy="${f(y - r * .3)}" r="${f(r * .3)}" fill="#fff" opacity=".85"/>`; }).join('')}` },
};

export const DECO_IDS = Object.keys(DECOS);
let uid = 0;
export function decoSvg(id) {
  const d = DECOS[id]; if (!d) return '';
  const u = ++uid;
  return `<svg class="avd-svg" viewBox="-22 -22 144 144" aria-hidden="true">${d.svg(u)}</svg>`;
}
