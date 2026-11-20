#!/usr/bin/env python3
"""Afișe premium pentru feed și grupuri (4:5, 1080x1350) pe o scenă generată cu Moșul.

Șabloane:
  editorial   – fotografia pe tot cadrul, umbră caldă jos, titlu serif cu accent italic auriu, ramă fină
  invitation  – scena sus, jos o carte de vizită fildeș (ca o invitație) cu titlu, text și medalion de preț
  (vechile nume: cinematic → editorial, letter/classic → invitation)

Textul cu accent: *cuvinte* = italic auriu, | = rând nou.

  python3 make_poster.py --template editorial --image scena.png --kicker "Pentru copilul tău" \
      --title "Un mesaj de la Moș Crăciun,|*cu numele lui*" --out p.jpg
"""
import argparse, os, sys
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brand as B

W, H = 1080, 1350


def cover(img, w, h, focus_y=0.4):
    s = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    l, t = (img.width - w) // 2, int((img.height - h) * focus_y)
    return img.crop((l, t, l + w, t + h))


def grade(img):
    """Aceeași gradare caldă ca în clipuri, ca afișele și videoclipurile să pară din aceeași campanie."""
    from PIL import ImageEnhance
    img = ImageEnhance.Contrast(img.convert("RGB")).enhance(1.05)
    img = ImageEnhance.Color(img).enhance(1.04)
    r, g, b = img.split()
    r = r.point(lambda v: min(255, int(v * 1.02 + 2)))
    b = b.point(lambda v: int(v * 0.96))
    return Image.merge("RGB", (r, g, b))


def vignette(img, strength=120):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse([-W * 0.25, -H * 0.2, W * 1.25, H * 1.2], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(160))
    dark = Image.new("RGB", img.size, (10, 6, 7))
    return Image.composite(img, Image.blend(img, dark, strength / 255), mask)


def kicker(d, y, text, color):
    t = text.upper()
    f = B.font(B.SANS_SEMI, 24)
    tw = B.tracked_width(d, t, f, 8)
    B.draw_tracked(d, (W / 2, y), t, f, color, tracking=8, anchor="m")
    for s in (-1, 1):
        x0 = W / 2 + s * (tw / 2 + 22)
        d.line([(x0, y + 15), (x0 + s * 46, y + 15)], fill=color, width=2)


def editorial(base, a):
    img = vignette(grade(cover(base, W, H, a.focus if a.focus is not None else 0.35)), 90).convert("RGBA")
    img.alpha_composite(B.vertical_gradient(W, 260, [(0, (12, 7, 8, 150)), (1, (12, 7, 8, 0))]), (0, 0))
    img.alpha_composite(B.vertical_gradient(W, 760, [(0, (14, 7, 9, 0)), (0.45, (14, 7, 9, 170)), (1, (10, 5, 7, 245))]), (0, H - 760))
    d = ImageDraw.Draw(img)
    B.frame(d, (34, 34, W - 34, H - 34), B.rgba(B.CHAMPAGNE, 190), inset=10, width=2)
    sig = B.font(B.SANS_SEMI, 22)
    B.draw_tracked(d, (W / 2, 78), "POȘTA MOȘULUI", sig, B.rgba(B.IVORY, 230), tracking=9, anchor="m")

    lines = len(B.parse_rich(a.title))
    size = B.fit_rich(a.title, 82 if lines <= 2 else 72, 880)
    y = H - 140 - 150 - lines * size * 1.02 - (60 if a.kicker else 0)
    if a.kicker:
        kicker(d, y, a.kicker, B.rgba(B.CHAMPAGNE)); y += 62
    shadow, text = Image.new("RGBA", img.size, (0, 0, 0, 0)), Image.new("RGBA", img.size, (0, 0, 0, 0))
    y = B.draw_rich(ImageDraw.Draw(text), W / 2, y, a.title, size, B.rgba(B.IVORY), B.rgba(B.GOLD_LIGHT), line_gap=1.02, shadow=ImageDraw.Draw(shadow))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(10)))
    img.alpha_composite(text)
    d = ImageDraw.Draw(img)
    y += 40
    d.line([(W / 2 - 50, y), (W / 2 + 50, y)], fill=B.rgba(B.CHAMPAGNE, 200), width=2)
    y += 34
    B.draw_tracked(d, (W / 2, y), a.cta.upper(), B.font(B.SANS_SEMI, 34), B.rgba(B.IVORY), tracking=7, anchor="m")
    y += 62
    B.draw_tracked(d, (W / 2, y), a.details, B.font(B.SANS, 25), B.rgba(B.IVORY, 200), tracking=1, anchor="m")
    return B.grain(img.convert("RGB"), 5)


def invitation(base, a):
    split = 700
    img = Image.new("RGB", (W, H), (244, 236, 222))
    photo = vignette(grade(cover(base, W, split + 140, a.focus if a.focus is not None else 0.3)), 60)
    img.paste(photo, (0, 0))
    img = img.convert("RGBA")
    img.alpha_composite(B.vertical_gradient(W, 220, [(0, (12, 7, 8, 140)), (1, (12, 7, 8, 0))]), (0, 0))
    img.alpha_composite(B.vertical_gradient(W, 200, [(0, (244, 236, 222, 0)), (1, (244, 236, 222, 255))]), (0, split + 140 - 200))
    d = ImageDraw.Draw(img)
    B.draw_tracked(d, (W / 2, 70), "POȘTA MOȘULUI", B.font(B.SANS_SEMI, 22), B.rgba(B.IVORY, 235), tracking=9, anchor="m")

    # cartea fildeș, cu umbră moale și hârtie ușor texturată
    cx0, cy0, cx1, cy1 = 70, split - 40, W - 70, H - 60
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([cx0, cy0 + 18, cx1, cy1 + 18], radius=10, fill=(30, 12, 10, 120))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(26)))
    card = B.vertical_gradient(cx1 - cx0, cy1 - cy0, [(0, (251, 246, 236, 255)), (1, (243, 233, 215, 255))])
    card = B.grain(card, 4)
    mask = Image.new("L", card.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, card.width - 1, card.height - 1], radius=10, fill=255)
    img.paste(card, (cx0, cy0), mask)
    d = ImageDraw.Draw(img)
    B.frame(d, (cx0 + 22, cy0 + 22, cx1 - 22, cy1 - 22), B.rgba(B.GOLD, 200), inset=8, width=2)

    ink, accent = B.rgba(B.INK), B.rgba((140, 28, 40))

    def content(d, y):
        B.ornament(d, W / 2, y, 200, B.rgba(B.GOLD))
        y += 34
        if a.kicker:
            f = B.font(B.SERIF_ITALIC, 42)
            d.text((W / 2, y), a.kicker, font=f, fill=B.rgba(B.GOLD[:3]), anchor="mt")
            y += 64
        lines = len(B.parse_rich(a.title))
        y = B.draw_rich(d, W / 2, y, a.title, B.fit_rich(a.title, 66 if lines <= 2 else 58, 800), ink, accent, line_gap=1.12)
        y += 44
        for line in a.subtitle.split("|"):
            d.text((W / 2, y), line, font=B.font(B.SANS, 26), fill=(90, 74, 64, 255), anchor="mt")
            y += 40
        y += 30
        B.draw_tracked(d, (W / 2, y), a.cta.upper(), B.font(B.SANS_SEMI, 30), B.rgba((120, 24, 36)), tracking=7, anchor="m")
        return y + 30

    scratch = ImageDraw.Draw(Image.new("RGBA", (W, H)))
    height = content(scratch, 0)
    content(d, cy0 + (cy1 - cy0 - height) / 2 + 8)

    # medalion de preț, ca un sigiliu de ceară, la marginea dintre fotografie și carte
    mx, my, r = cx1 - 110, cy0 - 6, 84
    med = Image.new("RGBA", img.size, (0, 0, 0, 0))
    md = ImageDraw.Draw(med)
    md.ellipse([mx - r + 4, my - r + 12, mx + r + 4, my + r + 12], fill=(20, 4, 8, 110))
    med = med.filter(ImageFilter.GaussianBlur(10))
    md = ImageDraw.Draw(med)
    disc = B.vertical_gradient(2 * r, 2 * r, [(0, (128, 22, 36, 255)), (1, (78, 12, 22, 255))])
    dm = Image.new("L", disc.size, 0); ImageDraw.Draw(dm).ellipse([0, 0, 2 * r - 1, 2 * r - 1], fill=255)
    med.paste(disc, (mx - r, my - r), dm)
    md = ImageDraw.Draw(med)
    md.ellipse([mx - r + 9, my - r + 9, mx + r - 9, my + r - 9], outline=B.rgba(B.CHAMPAGNE, 220), width=2)
    md.text((mx, my - 34), "de la", font=B.font(B.SERIF_ITALIC, 28), fill=B.rgba(B.CHAMPAGNE), anchor="ms")
    md.text((mx, my + 24), "39", font=B.font(B.SERIF_BOLD, 68), fill=B.rgba(B.IVORY), anchor="ms")
    B.draw_tracked(md, (mx + 3, my + 38), "LEI", B.font(B.SANS_SEMI, 17), B.rgba(B.CHAMPAGNE), tracking=5, anchor="m")
    img.alpha_composite(med)
    return img.convert("RGB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", default="editorial", choices=["editorial", "invitation", "cinematic", "letter", "classic"])
    ap.add_argument("--image", required=True)
    ap.add_argument("--kicker", default="")
    ap.add_argument("--title", required=True)
    ap.add_argument("--subtitle", default="Un videoclip doar pentru copilul tău,|despre anul lui și dorința de Crăciun.")
    ap.add_argument("--cta", default="POSTAMOSULUI.RO")
    ap.add_argument("--details", default="De la 39 lei  ·  Gata în sub o oră  ·  Fără cont")
    ap.add_argument("--focus", type=float, help="încadrare pe verticală: 0 = sus, 1 = jos")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    template = {"cinematic": "editorial", "letter": "invitation", "classic": "invitation"}.get(a.template, a.template)
    base = Image.open(a.image).convert("RGB")
    out = editorial(base, a) if template == "editorial" else invitation(base, a)
    out.save(a.out, quality=93, subsampling=0)
    print(a.out)


if __name__ == "__main__":
    main()
