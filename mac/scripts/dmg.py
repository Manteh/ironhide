#!/usr/bin/env python3
"""Make the installer disk image: Orbie on the left, an arrow, Applications on the right.

The window layout is written straight into the image by dmgbuild (`pip install dmgbuild pillow`), so nothing has to
drive Finder. The background is light on purpose: Finder draws the icon names in dark text over a picture.

usage: dmg.py <Orbie.app> <out.dmg>
"""
import os
import sys
import tempfile

import dmgbuild
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONT = os.path.join(ROOT, 'site', 'fonts', 'Outfit.ttf')
W, H = 660, 420
APP_AT, APPS_AT = (175, 215), (485, 215)  # icon centres, in window points


def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_axes([weight])
    except OSError:
        pass
    return f


def glow(img, centre, radius, colour, alpha):
    # blur only the transparency: blurring colour into empty (black) pixels leaves grey smudges
    mask = Image.new('L', img.size, 0)
    x, y = centre
    ImageDraw.Draw(mask).ellipse((x - radius, y - radius, x + radius, y + radius), fill=alpha)
    layer = Image.new('RGBA', img.size, colour + (0,))
    layer.putalpha(mask.filter(ImageFilter.GaussianBlur(radius * 0.6)))
    img.alpha_composite(layer)


def background(scale):
    s = scale
    img = Image.new('RGBA', (W * s, H * s), (246, 244, 255, 255))
    glow(img, (40 * s, 20 * s), 190 * s, (154, 123, 255), 110)
    glow(img, (640 * s, 420 * s), 220 * s, (232, 130, 220), 100)
    glow(img, (APP_AT[0] * s, APP_AT[1] * s), 90 * s, (150, 120, 255), 80)
    d = ImageDraw.Draw(img)

    def centred(text, y, size, weight, colour):
        d.text((W * s / 2, y * s), text, font=font(size * s, weight), fill=colour, anchor='mm')

    centred('Install Orbie', 58, 34, 600, (34, 22, 84, 255))
    centred('Drag Orbie into Applications', 98, 16, 400, (92, 82, 140, 255))

    # the arrow between the two icons
    y, x0, x1 = APP_AT[1] * s, 275 * s, 385 * s
    for x in range(x0, x1 - 16 * s, 16 * s):
        d.ellipse((x, y - 3 * s, x + 6 * s, y + 3 * s), fill=(124, 96, 224, 255))
    d.line([(x1 - 16 * s, y - 14 * s), (x1, y), (x1 - 16 * s, y + 14 * s)], fill=(124, 96, 224, 255), width=5 * s, joint='curve')

    centred('First time macOS blocks it? System Settings → Privacy & Security → Open Anyway', 385, 12, 400, (112, 104, 150, 255))
    return img.convert('RGB')


def main(app, out):
    with tempfile.TemporaryDirectory() as tmp:
        background(1).save(os.path.join(tmp, 'bg.png'))
        background(2).save(os.path.join(tmp, 'bg@2x.png'))  # dmgbuild picks this up for Retina screens
        name = os.path.basename(app)
        dmgbuild.build_dmg(out, 'Orbie', settings={
            'format': 'UDZO',
            'files': [app],
            'symlinks': {'Applications': '/Applications'},
            'icon': os.path.join(ROOT, 'mac', 'src-tauri', 'icons', 'icon.icns'),
            'background': os.path.join(tmp, 'bg.png'),
            'window_rect': ((200, 140), (W, H)),
            'default_view': 'icon-view',
            'show_status_bar': False, 'show_tab_view': False, 'show_toolbar': False,
            'show_pathbar': False, 'show_sidebar': False,
            'icon_size': 112, 'text_size': 13,
            'icon_locations': {name: APP_AT, 'Applications': APPS_AT},
        })
    print(out)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2]))
