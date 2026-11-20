#!/usr/bin/env python3
"""Afișe premium pentru grupuri/feed (4:5, 1080x1350) pe o scenă generată cu Moșul.

Șabloane:
  cinematic  – titlu serif sus pe cer, accent scris de mână, panou de sticlă jos cu site + preț
  letter     – scenă caldă sus, card crem jos (ca o scrisoare) cu titlu, text și sigiliu de preț
  classic    – fotografie + titlu mare alb + bandă roșie jos

  python3 make_poster.py --template cinematic --image scena.png --kicker "Pentru copilul tău" \
      --title "Un mesaj de la Moș Crăciun, cu numele lui" --subtitle "Videoclip personalizat · gata în sub o oră" --out p.jpg
"""
import argparse, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
F = lambda n: os.path.join(HERE, "fonts", n)
W, H = 1080, 1350
GOLD, GOLD_D, RED, NAVY, CREAM, INK = (238, 197, 112), (196, 150, 70), (178, 22, 42), (10, 18, 36), (250, 243, 230), (40, 28, 22)


def font(name, size, weight=None):
    f = ImageFont.truetype(F(name), size)
    if weight:
        try: f.set_variation_by_axes([weight])
        except Exception: pass
    return f


def cover(img, w, h, focus_y=0.4):
    s = max(w / img.width, h / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    l, t = (img.width - w) // 2, int((img.height - h) * focus_y)
    return img.crop((l, t, l + w, t + h))


def wrap(d, text, fnt, width):
    lines, cur = [], ""
    for word in text.split():
        test = f"{cur} {word}".strip()
        if d.textlength(test, font=fnt) <= width: cur = test
        else: lines.append(cur); cur = word
    return lines + ([cur] if cur else [])


def centered(d, y, text, fnt, fill, shadow=None, spacing=0):
    w = d.textlength(text, font=fnt)
    if shadow: d.text(((W - w) / 2 + 2, y + 3), text, font=fnt, fill=shadow)
    d.text(((W - w) / 2, y), text, font=fnt, fill=fill)


def vertical_fade(img, color, start, end, max_alpha, top=False):
    mask = Image.new("L", (1, H))
    for y in range(H):
        t = (start - y) / (start - end) if top else (y - start) / (end - start)
        mask.putpixel((0, y), int(max(0, min(1, t)) ** 1.3 * max_alpha))
    return Image.composite(Image.new("RGB", (W, H), color), img, mask.resize((W, H)))


def sparkles(img, n=70, seed=7, region=(0, 0, W, H)):
    rnd = random.Random(seed)
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(n):
        x, y = rnd.randint(region[0], region[2]), rnd.randint(region[1], region[3])
        r = rnd.choice([1, 1, 2, 2, 3])
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, rnd.randint(90, 200)))
    layer = layer.filter(ImageFilter.GaussianBlur(0.6))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def frame(d, inset=28, color=GOLD, width=2):
    d.rectangle([inset, inset, W - inset, H - inset], outline=color, width=width)
    for cx, cy in [(inset, inset), (W - inset, inset), (inset, H - inset), (W - inset, H - inset)]:
        d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=color)


def seal(img, cx, cy, top="de la", big="39", unit="lei"):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    r = 92
    d.ellipse([cx - r + 6, cy - r + 10, cx + r + 6, cy + r + 10], fill=(0, 0, 0, 90))
    layer = layer.filter(ImageFilter.GaussianBlur(8)); d = ImageDraw.Draw(layer)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED + (255,))
    d.ellipse([cx - r + 10, cy - r + 10, cx + r - 10, cy + r - 10], outline=GOLD + (255,), width=3)
    f1, f2, f3 = font("Montserrat.ttf", 22, 700), font("PlayfairDisplay-Black.ttf", 62), font("Montserrat.ttf", 24, 800)
    for txt, f, y in [(top, f1, cy - 62), (big, f2, cy - 40), (unit, f3, cy + 36)]:
        w = d.textlength(txt, font=f); d.text((cx - w / 2, y), txt, font=f, fill=CREAM + (255,))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def cinematic(base, a):
    img = cover(base, W, H, 0.35)
    img = vertical_fade(img, NAVY, 520, 0, 215, top=True)
    img = vertical_fade(img, NAVY, 900, H, 235)
    img = sparkles(img, 80, region=(40, 40, W - 40, 520))
    d = ImageDraw.Draw(img)
    frame(d)
    y = 92
    if a.kicker:
        centered(d, y, a.kicker, font("GreatVibes.ttf", 74), GOLD, shadow=(0, 0, 0)); y += 98
    tf = font("PlayfairDisplay-Black.ttf", 76)
    for line in wrap(d, a.title, tf, W - 180):
        centered(d, y, line, tf, CREAM, shadow=(0, 0, 0)); y += 90
    d.line([(W / 2 - 70, y + 34), (W / 2 + 70, y + 34)], fill=GOLD, width=2)
    # panou de sticlă jos
    panel = (70, H - 270, W - 70, H - 80)
    region = img.crop(panel).filter(ImageFilter.GaussianBlur(14))
    glass = Image.new("RGBA", region.size, (10, 18, 36, 150))
    region = Image.alpha_composite(region.convert("RGBA"), glass)
    img.paste(region.convert("RGB"), panel[:2])
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(panel, radius=26, outline=GOLD + (0,), width=2)
    d.rounded_rectangle(panel, radius=26, outline=GOLD, width=2)
    sf = font("Montserrat.ttf", 32, 600)
    centered(d, H - 245, a.subtitle, sf, CREAM)
    cf = font("Montserrat.ttf", 52, 850)
    centered(d, H - 185, a.cta, cf, GOLD)
    pf = font("Montserrat.ttf", 30, 700)
    centered(d, H - 122, a.price_line, pf, CREAM)
    return img


def letter(base, a):
    top_h = 820
    img = Image.new("RGB", (W, H), CREAM)
    scene = cover(base, W, top_h + 80, 0.25)
    img.paste(scene, (0, 0))
    img = vertical_fade(img, CREAM, top_h - 160, top_h + 40, 255)
    img = sparkles(img, 45, seed=3, region=(40, 40, W - 40, 420))
    d = ImageDraw.Draw(img)
    card = (64, top_h - 70, W - 64, H - 64)
    shadow = Image.new("RGBA", img.size, (0, 0, 0, 0)); sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((card[0] + 6, card[1] + 14, card[2] + 6, card[3] + 14), radius=22, fill=(60, 30, 10, 70))
    img = Image.alpha_composite(img.convert("RGBA"), shadow.filter(ImageFilter.GaussianBlur(14))).convert("RGB")
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(card, radius=22, fill=(255, 250, 240), outline=GOLD_D, width=2)
    d.rounded_rectangle((card[0] + 12, card[1] + 12, card[2] - 12, card[3] - 12), radius=16, outline=(232, 214, 180), width=1)
    y = card[1] + 34
    if a.kicker:
        centered(d, y, a.kicker, font("GreatVibes.ttf", 64), RED); y += 82
    tf = font("PlayfairDisplay-Black.ttf", 60)
    for line in wrap(d, a.title, tf, card[2] - card[0] - 300):
        w = d.textlength(line, font=tf); d.text((card[0] + 50, y), line, font=tf, fill=INK); y += 72
    sf = font("Montserrat.ttf", 29, 500)
    for line in wrap(d, a.subtitle, sf, card[2] - card[0] - 300):
        d.text((card[0] + 50, y + 10), line, font=sf, fill=(110, 86, 66)); y += 40
    cf = font("Montserrat.ttf", 40, 850)
    d.text((card[0] + 50, card[3] - 86), a.cta, font=cf, fill=RED)
    img = seal(img, card[2] - 130, card[1] + 150, top="de la", big="39", unit="lei")
    return img


def classic(base, a):
    img = cover(base, W, H, 0.3)
    img = vertical_fade(img, NAVY, int(H * 0.45), H, 235)
    d = ImageDraw.Draw(img)
    tf = font("Montserrat.ttf", 78, 850)
    lines = wrap(d, a.title.upper(), tf, W - 140)
    y = H - 128 - 60 - len(lines) * 92 - 70
    for line in lines:
        centered(d, y, line, tf, (255, 255, 255), shadow=(0, 0, 0)); y += 92
    centered(d, y + 12, a.subtitle, font("Montserrat.ttf", 38, 600), GOLD)
    d.rectangle([0, H - 128, W, H], fill=RED)
    d.text((60, H - 90), a.cta, font=font("Montserrat.ttf", 50, 850), fill=(255, 255, 255))
    pf = font("Montserrat.ttf", 40, 700); pw = d.textlength(a.price, font=pf)
    d.rounded_rectangle([W - 104 - pw, H - 98, W - 60, H - 30], radius=34, fill=GOLD)
    d.text((W - 82 - pw, H - 88), a.price, font=pf, fill=NAVY)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--template", default="cinematic", choices=["cinematic", "letter", "classic"])
    ap.add_argument("--image", required=True)
    ap.add_argument("--kicker", default="")
    ap.add_argument("--title", required=True)
    ap.add_argument("--subtitle", default="Videoclip personalizat · gata în sub o oră")
    ap.add_argument("--cta", default="POSTAMOSULUI.RO")
    ap.add_argument("--price", default="de la 39 lei")
    ap.add_argument("--price-line", default="de la 39 lei · fără cont · plată cu cardul")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    base = Image.open(a.image).convert("RGB")
    img = {"cinematic": cinematic, "letter": letter, "classic": classic}[a.template](base, a)
    img.save(a.out, quality=92)
    print(a.out)


if __name__ == "__main__":
    main()
