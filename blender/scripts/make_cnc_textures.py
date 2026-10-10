"""Draws the decal textures for the ZAPPA M-1600 plotter model (stickers, ruler, labels).

Run with plain Python (needs Pillow):  python make_cnc_textures.py <out_dir>
Sizes follow the model frame used by build_cnc_m1600.py (10 px per model millimetre unless noted).
"""
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "textures")
os.makedirs(OUT, exist_ok=True)
FONTS = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


ORANGE = (247, 168, 0)
YELLOW = (242, 191, 13)
NAVY = (13, 18, 28)
BLACK = (12, 12, 12)
WHITE = (240, 240, 236)


def text_layer(txt, fnt, fill, stroke=0, stroke_fill=None):
    """Tightly cropped RGBA image of a text run."""
    box = fnt.getbbox(txt, stroke_width=stroke)
    w, h = box[2] - box[0] + 8, box[3] - box[1] + 8
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((4 - box[0], 4 - box[1]), txt, font=fnt, fill=fill,
                            stroke_width=stroke, stroke_fill=stroke_fill)
    return im


def shear(im, k):
    """Italic slant: shift rows to the right going up."""
    w, h = im.size
    extra = int(abs(k) * h) + 2
    return im.transform((w + extra, h), Image.AFFINE, (1, k, -extra if k > 0 else 0, 0, 1, 0), Image.BICUBIC)


def fit(im, w=None, h=None):
    sx = (w / im.width) if w else None
    sy = (h / im.height) if h else None
    sx = sx or sy
    sy = sy or sx
    return im.resize((max(1, int(im.width * sx)), max(1, int(im.height * sy))), Image.LANCZOS)


# ------------------------------------------------------------------ ZAPPA sticker on the beam (0.174 x 0.046)
def logo():
    W, H = 1740, 460
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, W - 1, H - 1), radius=40, fill=ORANGE)
    d.rounded_rectangle((22, 22, W - 23, H - 23), radius=26, fill=BLACK)
    z = text_layer("ZAPPA", font("ariblk.ttf", 300), ORANGE, stroke=6, stroke_fill=(70, 40, 0))
    z = shear(z, 0.18)
    z = fit(z, w=int(W * 0.86), h=int(H * 0.60))
    im.alpha_composite(z, ((W - z.width) // 2, 34))
    t = text_layer("PAINT PROTECTION FILM", font("arialbd.ttf", 120), WHITE)
    t = fit(t, w=int(W * 0.90), h=int(H * 0.17))
    im.alpha_composite(t, ((W - t.width) // 2, H - t.height - 40))
    im.save(os.path.join(OUT, "logo_zappa.png"))


# ------------------------------------------------------------------ numbered sticker (20 cells of 11.6 mm, 0.232 x 0.027)
def numbers(name, labels):
    W, H = 2320, 270
    stripe_h = 175
    im = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(im)
    cell = W / 20
    f = font("arial.ttf", 64)
    for i, lab in enumerate(labels):
        x0 = i * cell
        d.rectangle((x0, 0, x0 + cell * 0.45, stripe_h), fill=YELLOW)
        d.rectangle((x0 + cell * 0.45, 0, x0 + cell, stripe_h), fill=NAVY)
        d.line((x0, stripe_h, x0, H), fill=BLACK, width=3)
        tw = d.textlength(lab, font=f)
        d.text((x0 + (cell - tw) / 2, stripe_h + 12), lab, font=f, fill=BLACK)
    d.rectangle((0, stripe_h, W - 1, H - 1), outline=BLACK, width=3)
    im.save(os.path.join(OUT, name))


# ------------------------------------------------------------------ ruler (1.677 m true across the image, zero at the RIGHT)
def ruler():
    W, H = 12000, 96
    im = Image.new("RGB", (W, H), (14, 14, 14))
    d = ImageDraw.Draw(im)
    total_cm = 167.7
    px_cm = W / total_cm
    mid = H // 2
    d.rectangle((0, mid - 1, W, mid + 1), fill=WHITE)
    fi = font("arial.ttf", 15)
    # inch scale in the back (top) half, 1/16" ticks
    px_in = px_cm * 2.54
    n16 = int(total_cm / 2.54 * 16)
    for k in range(n16 + 1):
        x = W - k * px_in / 16
        L = 30 if k % 16 == 0 else 20 if k % 8 == 0 else 14 if k % 4 == 0 else 9 if k % 2 == 0 else 5
        d.line((x, mid - L, x, mid), fill=WHITE, width=2)
        if k % 16 == 0 and k:
            s = str(k // 16)
            d.text((x - d.textlength(s, font=fi) - 3, 2), s, font=fi, fill=WHITE)
    # centimetre scale in the front (bottom) half, 1 mm ticks
    for k in range(int(total_cm * 10) + 1):
        x = W - k * px_cm / 10
        L = 28 if k % 10 == 0 else 18 if k % 5 == 0 else 9
        d.line((x, mid, x, mid + L), fill=WHITE, width=2)
        if k % 10 == 0 and k:
            s = str(k // 10)
            d.text((x - d.textlength(s, font=fi) - 3, H - 19), s, font=fi, fill=WHITE)
    im.save(os.path.join(OUT, "ruler.png"))


# ------------------------------------------------------------------ CAUTION sticker on the right cap nose (0.093 x 0.048)
def caution():
    W, H = 930, 480
    im = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, W - 1, H - 1), outline=(60, 60, 60), width=4)
    # pictogram: black-bordered square with a hand reaching under a blade
    sq = (40, 70, 340, 410)
    d.rectangle(sq, outline=BLACK, width=10)
    d.polygon([(95, 300), (190, 230), (300, 230), (300, 270), (215, 270), (230, 300), (300, 300), (300, 335),
               (220, 335), (300, 360), (290, 385), (180, 370), (120, 360)], fill=BLACK)
    d.polygon([(70, 140), (250, 105), (255, 125), (75, 165)], fill=BLACK)
    d.polygon([(250, 105), (310, 150), (255, 125)], fill=BLACK)
    # yellow warning block
    d.rectangle((372, 18, W - 18, H - 18), fill=(244, 214, 52))
    lines = ["CAUTION", "VORSICHT", "PRUDENCE", "PRECAUCION", "CAUTELA", "注意"]
    f = font("arialbd.ttf", 54)
    fz = font("msyhbd.ttc", 52)
    y = 34
    for s in lines:
        d.polygon([(392, y + 50), (420, y + 4), (448, y + 50)], fill=BLACK)
        d.text((462, y), s, font=fz if s == "注意" else f, fill=BLACK)
        y += 70
    im.save(os.path.join(OUT, "caution.png"))


# ------------------------------------------------------------------ product label on the back (0.090 x 0.042)
def product_label():
    W, H = 900, 420
    im = Image.new("RGB", (W, H), (236, 236, 232))
    d = ImageDraw.Draw(im)
    f = font("arial.ttf", 40)
    rows = ["Name of Product:  Cutting Plotter", "Model number:  M-1600", "Voltage:  AC 110-240V",
            "Current:  1A", "Serial Number:  24102101"]
    for i, s in enumerate(rows):
        d.text((26, 22 + i * 76), s, font=f, fill=BLACK)
        d.line((20, 74 + i * 76, 690, 74 + i * 76), fill=(150, 150, 150), width=2)
    d.text((730, 120), "CE", font=font("arialbd.ttf", 84), fill=BLACK)
    d.text((712, 230), "RoHS", font=font("arialbd.ttf", 56), fill=BLACK)
    im.save(os.path.join(OUT, "label_product.png"))


# ------------------------------------------------------------------ "Model: M-1600" barcode label at the front-left (0.058 x 0.020)
def model_label():
    W, H = 580, 200
    im = Image.new("RGB", (W, H), (238, 238, 234))
    d = ImageDraw.Draw(im)
    d.text((20, 10), "Model: M-1600", font=font("arial.ttf", 52), fill=BLACK)
    x = 22
    k = 0
    while x < W - 30:
        w = 3 + (k * 7) % 9
        if k % 3 != 2:
            d.rectangle((x, 90, x + w, 180), fill=BLACK)
        x += w + 4 + (k * 5) % 6
        k += 1
    im.save(os.path.join(OUT, "label_model.png"))


logo()
numbers("sticker_front.png", [str(n) for n in range(20, 0, -1)])
numbers("sticker_back.png", [str(n) for n in range(1, 21)])
ruler()
caution()
product_label()
model_label()
print("textures written to", os.path.abspath(OUT))
