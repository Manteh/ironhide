// Avatar model shared by settings (own profile) and the relay copy of this logic.
// {icon,color} preset, optional uploaded image, shape, custom gradient and a frame.
export const SHAPES = ['circle', 'squircle', 'rounded', 'hex', 'octagon', 'diamond', 'shield'];
export const FRAMES = ['none', 'ring', 'gradient', 'double', 'glow', 'pulse', 'spin'];
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
  for (const k of ['ga', 'gb', 'fa', 'fb']) if (HEX.test(a[k] || '')) out[k] = a[k].toLowerCase();
  if ('custom' in a) out.custom = !!a.custom; // true = use ga/gb gradient instead of the preset colour
  if (Number.isFinite(+a.angle)) out.angle = Math.max(0, Math.min(360, Math.round(+a.angle)));
  return out;
}
