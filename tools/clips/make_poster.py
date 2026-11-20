#!/usr/bin/env python3
"""Imagine de promovare pentru grupurile de Facebook (4:5, 1080x1350): fotografia Moșului + titlu mare,
subtitlu și banda cu site-ul și prețul.

  python3 make_poster.py --image baza.jpg --title "Moșul îi spune copilului tău pe nume" \
      --subtitle "Videoclip personalizat, gata în sub o oră" --out poster.jpg
"""
import argparse, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = os.path.join(HERE, "fonts", "Montserrat.ttf")
W, H = 1080, 1350
GOLD, RED, NAVY, WHITE = (243, 201, 105), (200, 16, 46), (11, 20, 38), (255, 255, 255)


def font(size, weight=800):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def wrap(draw, text, fnt, width):
    lines, cur = [], ""
    for word in text.split():
        test = f"{cur} {word}".strip()
        if draw.textlength(test, font=fnt) <= width:
            cur = test
        else:
            lines.append(cur); cur = word
    if cur:
        lines.append(cur)
    return lines


def cover(img, w, h, focus_y=0.3):
    scale = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    left = (img.width - w) // 2
    top = int((img.height - h) * focus_y)
    return img.crop((left, top, left + w, top + h))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--title", required=True)
    ap.add_argument("--subtitle", default="Videoclip personalizat, gata în sub o oră")
    ap.add_argument("--cta", default="POSTAMOSULUI.RO")
    ap.add_argument("--price", default="de la 39 lei")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    base = cover(Image.open(a.image).convert("RGB"), W, H)
    canvas = base.copy()
    # gradient jos pentru lizibilitate
    grad = Image.new("L", (1, H))
    for y in range(H):
        grad.putpixel((0, y), int(max(0, (y - H * 0.42) / (H * 0.58)) ** 1.4 * 235))
    shade = Image.new("RGB", (W, H), NAVY)
    canvas = Image.composite(shade, canvas, grad.resize((W, H)))
    d = ImageDraw.Draw(canvas)

    title_font = font(78, 850)
    lines = wrap(d, a.title.upper(), title_font, W - 140)
    sub_font = font(38, 600)
    band_h = 128
    y = H - band_h - 60 - len(lines) * 92 - 70
    for line in lines:
        tw = d.textlength(line, font=title_font)
        d.text(((W - tw) / 2 + 3, y + 4), line, font=title_font, fill=(0, 0, 0))
        d.text(((W - tw) / 2, y), line, font=title_font, fill=WHITE)
        y += 92
    sw = d.textlength(a.subtitle, font=sub_font)
    d.text(((W - sw) / 2, y + 12), a.subtitle, font=sub_font, fill=GOLD)

    # banda de jos
    d.rectangle([0, H - band_h, W, H], fill=RED)
    cta_font, price_font = font(50, 850), font(40, 700)
    d.text((60, H - band_h + 38), a.cta, font=cta_font, fill=WHITE)
    pw = d.textlength(a.price, font=price_font)
    pill = [W - 60 - pw - 44, H - band_h + 30, W - 60, H - band_h + 98]
    d.rounded_rectangle(pill, radius=34, fill=GOLD)
    d.text((pill[0] + 22, H - band_h + 40), a.price, font=price_font, fill=NAVY)
    canvas.save(a.out, quality=90)
    print(a.out)


if __name__ == "__main__":
    main()
