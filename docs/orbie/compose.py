"""Build the README images from raw app captures: a hero banner, framed window shots and zoomed details.
usage: python3 compose.py <captures dir> <out dir>"""
import sys, math
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

SRC, OUT = sys.argv[1], sys.argv[2]
FONT = '/Users/Manteh/ironhide/web/fonts/Outfit.ttf'

def font(size, weight=600):
    f = ImageFont.truetype(FONT, size)
    try: f.set_variation_by_axes([weight])
    except Exception: pass
    return f

def backdrop(w, h, glow=(0.5, 0.45)):
    """Deep night with a violet bloom and a hint of magenta, like the app's own intro."""
    import numpy as np
    y, x = np.mgrid[0:h, 0:w].astype('float32')
    gx, gy = glow[0] * w, glow[1] * h
    r = np.hypot((x - gx) / w, (y - gy) / h)
    base = np.array([7, 7, 13], 'float32')
    vio = np.array([96, 64, 230], 'float32') * np.exp(-(r / 0.42) ** 2)[..., None] * 0.55
    mag = np.array([200, 60, 150], 'float32') * np.exp(-(np.hypot((x - w * 0.8) / w, (y - h * 0.95) / h) / 0.35) ** 2)[..., None] * 0.22
    img = base + vio + mag
    img += (np.random.default_rng(1).random((h, w, 1)) - 0.5) * 3  # dither
    return Image.fromarray(img.clip(0, 255).astype('uint8'))

def rounded(im, rad):
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], rad, fill=255)
    out = im.convert('RGBA'); out.putalpha(m); return out

def shadow(size, rad, blur, alpha=170, spread=0):
    w, h = size; pad = blur * 3
    s = Image.new('L', (w + pad * 2, h + pad * 2), 0)
    ImageDraw.Draw(s).rounded_rectangle([pad - spread, pad - spread, pad + w + spread, pad + h + spread], rad, fill=alpha)
    return s.filter(ImageFilter.GaussianBlur(blur)), pad

def window(shot, width):
    """The capture inside a macOS window: rounded corners, a slim title bar with traffic lights, a hairline border."""
    sc = width / shot.width
    body = shot.resize((width, round(shot.height * sc)), Image.LANCZOS)
    bar = round(30 * width / 1600)
    win = Image.new('RGB', (width, body.height + bar), (14, 13, 22))
    win.paste(body, (0, bar))
    d = ImageDraw.Draw(win)
    for i, c in enumerate([(255, 95, 87), (254, 188, 46), (40, 200, 64)]):
        cx, cy, rr = bar * 0.75 + i * bar * 0.68, bar / 2, bar * 0.2
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=c)
    t = font(round(bar * 0.42), 500); label = 'Orbie'
    tw = d.textlength(label, font=t); d.text(((width - tw) / 2, bar * 0.27), label, font=t, fill=(170, 166, 196))
    win = rounded(win, round(width * 0.012))
    ImageDraw.Draw(win).rounded_rectangle([0, 0, win.width - 1, win.height - 1], round(width * 0.012), outline=(255, 255, 255, 34), width=2)
    return win

def place(canvas, layer, xy, rad, blur=40, alpha=190):
    s, pad = shadow(layer.size, rad, blur, alpha)
    canvas.paste((0, 0, 0), (xy[0] - pad, xy[1] - pad + blur // 2), s)
    canvas.paste(layer, xy, layer)

def framed(name, out, width=2400, pad=110):
    shot = Image.open(f'{SRC}/{name}.png').convert('RGB')
    win = window(shot, width - pad * 2)
    can = backdrop(width, win.height + pad * 2, glow=(0.5, 0.25))
    place(can, win, (pad, pad), round(win.width * 0.012), blur=46)
    can.save(f'{OUT}/{out}.jpg', quality=90, optimize=True, progressive=True)

def detail(name, box, out, width=1400, title='', sub=''):
    """A zoomed-in crop, as a floating card with a caption above it."""
    shot = Image.open(f'{SRC}/{name}.png').convert('RGB').crop(box)
    inner = width - 160
    card = shot.resize((inner, round(shot.height * inner / shot.width)), Image.LANCZOS)
    card = rounded(card, 26)
    ImageDraw.Draw(card).rounded_rectangle([0, 0, card.width - 1, card.height - 1], 26, outline=(255, 255, 255, 40), width=2)
    head = 150 if title else 70
    can = backdrop(width, card.height + head + 80, glow=(0.3, 0.2))
    d = ImageDraw.Draw(can)
    if title:
        d.text((80, 52), title, font=font(44, 600), fill=(246, 244, 255))
        d.text((80, 106), sub, font=font(25, 400), fill=(170, 166, 200))
    place(can, card, (80, head), 26, blur=30, alpha=170)
    can.save(f'{OUT}/{out}.jpg', quality=90, optimize=True, progressive=True)

def hero(out, w=2400, h=1000):
    can = backdrop(w, h, glow=(0.7, 0.5))
    orb = Image.open(f'{SRC}/orb-big.png').convert('RGB')
    # the rendered orb, cut out with a soft round mask so its halo melts into the banner
    ow, oh = orb.size; cx, cy = ow // 2, oh // 2; R = int(oh * 0.5)
    S = 900
    crop = orb.crop((cx - R, cy - R, cx + R, cy + R)).resize((S, S), Image.LANCZOS)
    # screen blend: the render's near-black room adds nothing, only its light shows, so there is no visible edge
    m = Image.new('L', (S, S), 0); ImageDraw.Draw(m).ellipse([S * 0.08, S * 0.08, S * 0.92, S * 0.92], fill=255); m = m.filter(ImageFilter.GaussianBlur(S * 0.07))
    box = (w - S - 120, (h - S) // 2)
    region = can.crop((box[0], box[1], box[0] + S, box[1] + S))
    lit = ImageChops.screen(region, crop)
    can.paste(Image.composite(lit, region, m), box)
    d = ImageDraw.Draw(can)
    small = Image.open(f'{SRC}/../orb-logo.png').convert('RGBA').resize((128, 128), Image.LANCZOS)
    big = font(178, 600)
    x0, base = 170, 470
    can.paste(small, (x0, base - 112), small)
    d.text((x0 + 140, base - 168), 'rbie', font=big, fill=(248, 246, 255))
    d.text((x0 + 4, base + 70), 'A private cinema for the people you trust.', font=font(46, 400), fill=(200, 196, 232))
    pill = 'Invite only  ·  macOS  ·  In development'
    pf = font(28, 500); pw = d.textlength(pill, font=pf)
    lay = Image.new('RGBA', can.size, (0, 0, 0, 0)); ld = ImageDraw.Draw(lay)
    ld.rounded_rectangle([x0, base + 170, x0 + pw + 56, base + 226], 28, fill=(255, 255, 255, 16), outline=(170, 150, 255, 150), width=2)
    can.paste(lay, (0, 0), lay); d = ImageDraw.Draw(can)
    d.text((x0 + 28, base + 181), pill, font=pf, fill=(214, 206, 255))
    can.save(f'{OUT}/{out}.jpg', quality=92, optimize=True, progressive=True)

if __name__ == '__main__':
    hero('hero')
    for n in ['home', 'title', 'versions', 'collections', 'sweden', 'profile', 'taste', 'search']:
        framed(n, n)
    detail('versions', (170, 250, 2870, 760), 'z-best', title='The best version, picked for you', sub='4K, Dolby Vision and Atmos when you have them. One click and it starts instantly.')
    detail('home', (270, 1330, 2140, 1720), 'z-mood', title='Tonight I want…', sub='Pick a mood and every shelf rearranges around it. Match scores come from your own ratings.')
    detail('profile', (480, 330, 2760, 680), 'z-stats', title='Your year in film', sub='Hours watched, streaks, medals: all kept on your own Mac.')
    detail('title', (590, 150, 2000, 760), 'z-title', title='Everything about a title, in one sheet', sub='Scores from IMDb, TMDB and critics, the cast, and where to start.')
    detail('search', (520, 140, 2500, 780), 'z-search', title='Find anything as you type', sub='Press ⌘K anywhere. Enter plays, → opens details.')
    detail('taste', (1460, 780, 2700, 1140), 'z-taste', title='Taste Lab', sub='Rate what you have seen in seconds. Every answer sharpens your picks.')
    print('done')
