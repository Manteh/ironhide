"""Render the Orbie app icon: a lit glass-like sphere on a dark macOS squircle.

The sphere is shaded per pixel from its surface normal: soft key light from the top left, a warm magenta bounce from
below, a cyan rim where the surface turns away, and a sharp specular highlight. Rendered at 2x and scaled down so every
edge is smooth. Output: mac/brand/orbie-1024.png (feed it to `cargo tauri icon`).
"""
import sys
import numpy as np
from PIL import Image

S = 2048  # work size; downsampled to 1024
out = sys.argv[1] if len(sys.argv) > 1 else 'orbie-1024.png'
y, x = np.mgrid[0:S, 0:S].astype(np.float32) + 0.5

def smooth(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

# ---- squircle body (Apple's icon grid: 824/1024 body, superellipse corners) ----
c, half = S / 2, S * 824 / 1024 / 2
n = 5.0
dx, dy = np.abs(x - c) / half, np.abs(y - c) / half
d = (dx ** n + dy ** n) ** (1 / n)
body = 1 - smooth(0.995, 1.0, d)

# background: deep night gradient with a violet glow behind the sphere
top = np.array([16, 14, 34], np.float32) / 255
bot = np.array([5, 5, 12], np.float32) / 255
t = ((y - (c - half)) / (2 * half)).clip(0, 1)[..., None]
bg = top * (1 - t) + bot * t
cx, cy, R = c, c - S * 0.01, S * 0.29
r = np.hypot(x - cx, y - cy)
halo = np.exp(-((r / (R * 1.28)) ** 2))[..., None]
bg = bg + halo * np.array([0.45, 0.28, 1.0]) * 0.30 + np.exp(-((r / (R * 2.1)) ** 2))[..., None] * np.array([0.30, 0.12, 0.45]) * 0.16
# soft contact shadow under the sphere
sh = np.exp(-(((x - cx) / (R * 0.95)) ** 2 + ((y - (cy + R * 1.04)) / (R * 0.16)) ** 2))[..., None]
bg = bg * (1 - 0.55 * sh)

# ---- the sphere ----
nx, ny = (x - cx) / R, (y - cy) / R
rr = nx * nx + ny * ny
inside = rr <= 1
nz = np.sqrt(np.clip(1 - rr, 0, 1))
N = np.stack([nx, -ny, nz], -1)  # y up

def norm(v):
    v = np.array(v, np.float32); return v / np.linalg.norm(v)

key, bounce, view = norm([-0.55, 0.65, 0.55]), norm([0.35, -0.85, 0.25]), np.array([0, 0, 1], np.float32)
lam = np.clip(N @ key, 0, 1)
bnc = np.clip(N @ bounce, 0, 1)
fres = (1 - nz) ** 2.6

# colour drifts across the surface: lilac at the lit top left, violet, indigo, magenta towards the bottom right
u = np.clip((nx * 0.6 - (-ny) * 0.8 + 1) / 2, 0, 1)[..., None]  # 0 at top left, 1 at bottom right
stops = [(0.0, (0.86, 0.78, 1.0)), (0.35, (0.55, 0.36, 0.98)), (0.62, (0.30, 0.22, 0.86)), (0.85, (0.62, 0.20, 0.72)), (1.0, (0.92, 0.30, 0.62))]
base = np.zeros((S, S, 3), np.float32)
for (a, ca), (b, cb) in zip(stops, stops[1:]):
    m = ((u >= a) & (u <= b)).astype(np.float32)
    k = ((u - a) / (b - a)).clip(0, 1)
    base += m * (np.array(ca) * (1 - k) + np.array(cb) * k)
base = np.minimum(base, np.array([1, 1, 1]))

col = base * (0.10 + 0.90 * lam[..., None] ** 1.15)
col += bnc[..., None] ** 2 * np.array([0.95, 0.25, 0.65]) * 0.55          # warm bounce from below
col += fres[..., None] * np.array([0.35, 0.85, 1.0]) * 0.75               # cyan rim
H = norm(key + view)
spec = np.clip(N @ H, 0, 1) ** 260
col += spec[..., None] * 1.15                                             # sharp highlight
soft = np.exp(-(((nx + 0.30) / 0.42) ** 2 + ((ny + 0.42) / 0.24) ** 2))
col += soft[..., None] * np.array([0.9, 0.9, 1]) * 0.16                       # broad glossy sheen
# a faint band of light around the equator: the sphere's "seam", where it unwraps in the animation
col = np.clip(col, 0, 1)

edge = smooth(1.0, 0.996, np.sqrt(rr))[..., None]  # anti-aliased sphere edge
if '--orb' in sys.argv:  # just the sphere on transparent, for the in-app logo
    size = int(sys.argv[sys.argv.index('--orb') + 1])
    pad = int(S * 0.2)  # crop to the sphere
    x0, x1, y0, y1 = int(cx - R) - 8, int(cx + R) + 8, int(cy - R) - 8, int(cy + R) + 8
    rgba = np.concatenate([np.clip(col, 0, 1), edge], -1)[y0:y1, x0:x1]
    Image.fromarray((rgba * 255).astype(np.uint8)).resize((size, size), Image.LANCZOS).save(out)
    print('wrote', out); sys.exit(0)
img = bg * (1 - edge) + col * edge

# glass rim on the squircle, then cut it out
ring = (smooth(0.975, 0.99, d) * (1 - smooth(0.99, 1.0, d)))[..., None]
img = img + ring * 0.06
rgba = np.concatenate([np.clip(img, 0, 1), body[..., None]], -1)
im = Image.fromarray((rgba * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS)
im.save(out)
print('wrote', out)
