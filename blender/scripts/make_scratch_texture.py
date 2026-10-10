"""Scratch-test texture for the hood film: three key scratches, one per colour channel (R, G, B), so each stroke can be
revealed independently in the shader. Strokes are defined in hood UV space (u across the car, v along it); the Blender
stage script uses the same STROKES to move the key.   python make_scratch_texture.py <out.png>"""
import math
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

SIZE = 2048
STROKES = [  # (v, u_start, u_end, bow) — keep in sync with live_film_stage4.py
    (0.44, 0.26, 0.74, 0.010),
    (0.52, 0.22, 0.70, -0.008),
    (0.60, 0.30, 0.78, 0.012),
]
out = sys.argv[1]
rng = random.Random(3)
chans = []
for v0, u0, u1, bow in STROKES:
    im = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(im)
    for line in range(5):                      # a key leaves a bundle of fine parallel scratches
        off = (line - 2) * 2.2 + rng.uniform(-0.6, 0.6)
        width = 1 if line in (0, 4) else 2
        level = 150 if line in (0, 4) else 255
        pts = []
        n = 240
        for k in range(n + 1):
            t = k / n
            u = u0 + (u1 - u0) * t
            v = v0 + bow * math.sin(math.pi * t) + 0.0015 * math.sin(t * 37 + line)
            pts.append((u * SIZE, (1 - v) * SIZE + off))
        # small skips where the key bounced
        seg = []
        for i, p in enumerate(pts):
            if rng.random() < 0.015 and seg:
                d.line(seg, fill=level, width=width)
                seg = []
                continue
            seg.append(p)
        if len(seg) > 1:
            d.line(seg, fill=level, width=width)
    chans.append(im.filter(ImageFilter.GaussianBlur(0.6)))
Image.merge("RGB", chans).save(out)
print("saved", out)
