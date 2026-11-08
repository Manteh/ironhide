// Avatar model shared by settings (own profile) and the relay copy of this logic.
// {icon,color} preset, optional uploaded image, shape, custom gradient and a frame.
export const SHAPES = ['circle', 'squircle', 'rounded', 'hex', 'octagon', 'diamond', 'shield', 'seal', 'flower', 'clover', 'starburst', 'star', 'blob', 'heart', 'gem', 'crystal', 'crest', 'cat', 'bolt', 'badge'];
export const DECOS = ['halo', 'wings', 'flame', 'orbit', 'crown', 'horns', 'blossom', 'cyber', 'ice', 'laurel', 'thorn', 'stars', 'royal', 'storm', 'aurora', 'prism'];
export const FRAMES = ['none', 'ring', 'gradient', 'double', 'glow', 'pulse', 'spin', 'bevel'];
const HEX = /^#[0-9a-fA-F]{6}$/;
const IMG = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/;
export const MAX_IMAGE = 48000; // characters of data URL; roughly a 256px photo

export function cleanAvatar(a = {}, base = {}) {
  const out = { ...base };
  if (typeof a.icon === 'string' && /^[a-z-]{1,20}$/.test(a.icon)) out.icon = a.icon;
  if (typeof a.color === 'string' && /^[a-z]{1,12}$/.test(a.color)) out.color = a.color;
  if ('image' in a) { if (a.image && typeof a.image === 'string' && a.image.length <= MAX_IMAGE && IMG.test(a.image)) out.image = a.image; else delete out.image; }
  if (SHAPES.includes(a.shape)) out.shape = a.shape;
  if (FRAMES.includes(a.frame)) out.frame = a.frame;
  if ('deco' in a) { if (DECOS.includes(a.deco)) out.deco = a.deco; else delete out.deco; }
  for (const k of ['ga', 'gb', 'fa', 'fb']) if (HEX.test(a[k] || '')) out[k] = a[k].toLowerCase();
  if ('facet' in a) out.facet = !!a.facet; // low-poly facet shading on the face
  if ('custom' in a) out.custom = !!a.custom; // true = use ga/gb gradient instead of the preset colour
  if (Number.isFinite(+a.angle)) out.angle = Math.max(0, Math.min(360, Math.round(+a.angle)));
  return out;
}
