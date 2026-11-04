// Avatar studio: photo upload, shapes, gradient faces, frames, one-click looks. Edits `av` in place and calls onChange().
import { DECOS } from './decorations.js';
import { $, $$, esc, icon, avatar, AVATAR_ICONS, AVATAR_COLORS, AV_SHAPES, AV_FRAMES, toast } from './ui.js';

const LOOKS = [
  { n: 'Aurora', shape: 'squircle', custom: true, ga: '#5eead4', gb: '#6366f1', angle: 150, frame: 'spin', fa: '#5eead4', fb: '#a78bfa' },
  { n: 'Sunset', shape: 'circle', custom: true, ga: '#fb923c', gb: '#e11d48', angle: 160, frame: 'gradient', fa: '#fde047', fb: '#fb7185' },
  { n: 'Neon', shape: 'hex', custom: true, ga: '#111827', gb: '#312e81', angle: 135, frame: 'glow', fa: '#22d3ee', fb: '#e879f9' },
  { n: 'Candy', shape: 'rounded', custom: true, ga: '#f9a8d4', gb: '#a78bfa', angle: 120, frame: 'double', fa: '#ffffff', fb: '#f472b6' },
  { n: 'Gold', shape: 'shield', custom: true, ga: '#78350f', gb: '#1c1917', angle: 180, frame: 'gradient', fa: '#fde68a', fb: '#d97706' },
  { n: 'Mono', shape: 'octagon', custom: true, ga: '#3f3f46', gb: '#09090b', angle: 135, frame: 'ring', fa: '#e4e4e7', fb: '#a1a1aa' },
  { n: 'Pulse', shape: 'diamond', custom: true, ga: '#f43f5e', gb: '#7c3aed', angle: 135, frame: 'pulse', fa: '#fb7185', fb: '#c4b5fd' },
];

// center-crop to a square, shrink, and keep lowering quality until it fits the relay's size cap
async function toDataUrl(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height), c = document.createElement('canvas'); c.width = c.height = 256;
  c.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  for (const q of [0.86, 0.74, 0.62, 0.5, 0.4]) { const u = c.toDataURL('image/jpeg', q); if (u.length <= 46000) return u; }
  const small = document.createElement('canvas'); small.width = small.height = 160; small.getContext('2d').drawImage(c, 0, 0, 160, 160);
  return small.toDataURL('image/jpeg', 0.6);
}

const shapeMini = (s) => avatar({ avatar: { shape: s, icon: 'user', color: 'slate' } }, 26);

export function mountStudio(el, av, onChange, name = '') {
  let saveT = 0;
  const changed = () => { paint(); clearTimeout(saveT); saveT = setTimeout(onChange, 350); };
  const cust = () => av.custom && av.ga && av.gb;

  function paint() {
    const frame = (a) => avatar({ avatar: a }, 0 || 0); void frame;
    el.innerHTML = `<div class="av-studio">
      <div class="av-prev"><div id="avBig">${avatar({ avatar: av }, 120)}</div><div class="row">${avatar({ avatar: av }, 44)}${avatar({ avatar: av }, 28)}</div>
        <button class="btn sm" id="avUp">Upload photo</button>${av.image ? '<button class="btn ghost sm" id="avRm">Remove photo</button>' : ''}
        <input type="file" id="avFile" accept="image/*" hidden></div>
      <div class="av-ctl">
        <div class="av-sec"><b>Looks</b><div class="av-presets">${LOOKS.map((l, i) => `<button class="av-pre" data-look="${i}">${avatar({ avatar: { ...l, icon: av.icon, image: av.image } }, 48)}<span>${l.n}</span></button>`).join('')}</div></div>
        <div class="av-sec"><b>Decoration</b><div class="deco-grid">
          <button class="deco-card ${av.deco ? '' : 'on'}" data-deco="">${avatar({ avatar: { ...av, deco: '' } }, 52)}None</button>
          ${Object.entries(DECOS).map(([k, d]) => `<button class="deco-card ${av.deco === k ? 'on' : ''}" data-deco="${k}">${avatar({ avatar: { ...av, deco: k, fa: d.fa, fb: d.fb } }, 52)}${d.name}</button>`).join('')}</div>
          ${av.deco ? `<div class="av-colors"><label><input type="color" id="fa" value="${av.fa || '#8f8cff'}">Main</label><label><input type="color" id="fb" value="${av.fb || '#ff7ad9'}">Accent</label><button class="btn ghost sm" id="decoReset">Reset colours</button></div>` : ''}</div>
        <div class="av-sec"><b>Shape</b><div class="av-chips">${AV_SHAPES.map((s) => `<button class="av-chip sq ${av.shape === s || (!av.shape && s === 'circle') ? 'on' : ''}" data-shape="${s}" aria-label="${s}" title="${s}">${shapeMini(s)}</button>`).join('')}</div></div>
        <div class="av-sec"><b>Frame</b><div class="av-chips">${AV_FRAMES.map(([k, l]) => `<button class="av-chip ${((av.frame || 'none') === k) ? 'on' : ''}" data-frame="${k}">${avatar({ avatar: { frame: k, icon: 'user', color: 'slate', fa: av.fa, fb: av.fb }, }, 26)}${l}</button>`).join('')}</div>
          ${(av.frame && av.frame !== 'none' && !av.deco) ? `<div class="av-colors"><label><input type="color" id="fa" value="${av.fa || '#8f8cff'}">Border</label>${av.frame !== 'ring' ? `<label><input type="color" id="fb" value="${av.fb || '#ff7ad9'}">Second</label>` : ''}</div>` : ''}</div>
        ${av.image ? '' : `<div class="av-sec"><b>Icon</b><div class="avatar-picker">${AVATAR_ICONS.map((i) => `<button class="av-opt ${av.icon === i ? 'on' : ''}" data-i="${i}" aria-label="${i}">${icon(i)}</button>`).join('')}</div></div>
        <div class="av-sec"><b>Background</b>
          <div class="swatches">${AVATAR_COLORS.map((c) => `<button class="color-opt av-${c} ${!cust() && av.color === c ? 'on' : ''}" data-c="${c}" aria-label="${c}"></button>`).join('')}</div>
          <div class="av-colors"><label><input type="color" id="ga" value="${av.ga || '#8f8cff'}">From</label><label><input type="color" id="gb" value="${av.gb || '#4b48d6'}">To</label>
            <label>Angle <input type="range" id="ang" min="0" max="360" value="${av.angle ?? 135}"></label></div></div>`}
      </div></div>`;
    bind();
  }

  function bind() {
    const file = $('#avFile', el);
    $('#avUp', el).onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      try { av.image = await toDataUrl(f); changed(); } catch { toast('That image could not be read', 'err'); }
    };
    $('#avRm', el)?.addEventListener('click', () => { av.image = null; changed(); });
    $$('[data-look]', el).forEach((b) => (b.onclick = () => { Object.assign(av, LOOKS[+b.dataset.look]); delete av.n; changed(); }));
    $$('[data-deco]', el).forEach((b) => (b.onclick = () => { const k = b.dataset.deco; av.deco = k || null; if (k) { av.fa = DECOS[k].fa; av.fb = DECOS[k].fb; } changed(); }));
    $('#decoReset', el)?.addEventListener('click', () => { const d = DECOS[av.deco]; if (d) { av.fa = d.fa; av.fb = d.fb; changed(); } });
    $$('[data-shape]', el).forEach((b) => (b.onclick = () => { av.shape = b.dataset.shape; changed(); }));
    $$('[data-frame]', el).forEach((b) => (b.onclick = () => { av.frame = b.dataset.frame; if (av.frame !== 'none') { av.fa ||= '#8f8cff'; av.fb ||= '#ff7ad9'; } changed(); }));
    $$('[data-i]', el).forEach((b) => (b.onclick = () => { av.icon = b.dataset.i; changed(); }));
    $$('[data-c]', el).forEach((b) => (b.onclick = () => { av.color = b.dataset.c; av.custom = false; changed(); }));
    // colour pickers update the live preview without rebuilding (rebuilding would close the picker)
    const live = () => { $('#avBig', el).innerHTML = avatar({ avatar: av }, 120); $$('.av-prev .row', el).forEach((r) => (r.innerHTML = avatar({ avatar: av }, 44) + avatar({ avatar: av }, 28))); clearTimeout(saveT); saveT = setTimeout(() => { onChange(); paint(); }, 600); };
    const col = (id, k, custom) => { const i = $('#' + id, el); if (i) i.oninput = () => { av[k] = i.value; if (custom) { av.custom = true; av.ga ||= '#8f8cff'; av.gb ||= '#4b48d6'; } live(); }; };
    col('fa', 'fa'); col('fb', 'fb'); col('ga', 'ga', true); col('gb', 'gb', true);
    const ang = $('#ang', el); if (ang) ang.oninput = () => { av.angle = +ang.value; av.custom = true; av.ga ||= '#8f8cff'; av.gb ||= '#4b48d6'; live(); };
  }
  paint();
}
