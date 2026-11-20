"""Identitatea vizuală Poșta Moșului: culori, fonturi și unelte de desen comune pentru clipuri și afișe.

Direcție: editorial de lux, nu „reclamă de pe raft”. Serif de revistă (Bodoni Moda) pentru titluri, cu cuvântul
cheie în italic auriu; etichete mici în Inter, majuscule rărite. Mult aer, linii aurii subțiri, fără benzi groase
colorate și fără contururi negre.

Textul cu accent: cuvintele dintre *steluțe* ies în italic auriu, iar „|” rupe rândul.
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")

IVORY = (247, 240, 228)
CHAMPAGNE = (226, 196, 140)
GOLD = (212, 172, 104)
GOLD_LIGHT = (240, 218, 172)
BURGUNDY = (74, 14, 24)
WINE = (40, 8, 14)
INK = (24, 16, 14)
NIGHT = (10, 9, 12)

SERIF = "BodoniModa-Medium.ttf"
SERIF_BOLD = "BodoniModa-SemiBold.ttf"
SERIF_ITALIC = "BodoniModa-MediumItalic.ttf"
SANS = "Inter-Medium.ttf"
SANS_SEMI = "Inter-SemiBold.ttf"
SANS_BOLD = "Inter-Bold.ttf"

_cache = {}


def font(name, size):
    key = (name, size)
    if key not in _cache:
        _cache[key] = ImageFont.truetype(os.path.join(FONTS, name), size)
    return _cache[key]


def rgba(c, a=255):
    return (c[0], c[1], c[2], a)


def tracked_width(d, text, fnt, tracking):
    if not text:
        return 0
    return sum(d.textlength(ch, font=fnt) for ch in text) + tracking * (len(text) - 1)


def draw_tracked(d, xy, text, fnt, fill, tracking=0, anchor="l"):
    """Text cu spațiere între litere (Pillow nu are letter-spacing). anchor: l / m (centru pe x)."""
    x, y = xy
    if anchor == "m":
        x -= tracked_width(d, text, fnt, tracking) / 2
    for ch in text:
        d.text((x, y), ch, font=fnt, fill=fill)
        x += d.textlength(ch, font=fnt) + tracking
    return x


def parse_rich(text):
    """'Moșul știe *pe nume*|copilul tău' → [[(cuvânt, accent), ...], ...] pe rânduri."""
    lines = []
    for raw in text.replace("\\N", "|").split("|"):
        tokens, emph = [], False
        for part in raw.split("*"):
            for w in part.split():
                tokens.append((w, emph))
            emph = not emph
        lines.append(tokens)
    return lines


def rich_line_width(d, tokens, regular, italic, space):
    w = 0
    for i, (word, emph) in enumerate(tokens):
        w += d.textlength(word, font=italic if emph else regular)
        if i < len(tokens) - 1:
            w += space
    return w


def fit_rich(text, size, max_width, min_size=40, serif=None, italic_font=None):
    """Cea mai mare mărime (≤ size) la care cel mai lung rând încape în max_width."""
    serif, italic_font = serif or SERIF, italic_font or SERIF_ITALIC
    d = ImageDraw.Draw(Image.new("RGBA", (8, 8)))
    while size > min_size:
        regular, italic = font(serif, size), font(italic_font, size)
        space = d.textlength(" ", font=regular) * 0.92
        if max(rich_line_width(d, t, regular, italic, space) for t in parse_rich(text)) <= max_width:
            break
        size -= 2
    return size


def draw_rich(d, center_x, y, text, size, color, accent, line_gap=1.06, shadow=None, serif=SERIF, italic_font=SERIF_ITALIC):
    """Titlu serif centrat, cu cuvintele accentuate în italic (puțin mai mari ca să pară de aceeași greutate)."""
    regular, italic = font(serif, size), font(italic_font, size)
    space = d.textlength(" ", font=regular) * 0.92
    lines = parse_rich(text)
    for tokens in lines:
        x = center_x - rich_line_width(d, tokens, regular, italic, space) / 2
        for word, emph in tokens:
            f = italic if emph else regular
            if shadow:
                shadow.text((x, y + 4), word, font=f, fill=(0, 0, 0, 150))
            d.text((x, y), word, font=f, fill=accent if emph else color)
            x += d.textlength(word, font=f) + space
        y += size * line_gap
    return y


def soft_shadow_layer(size, draw_fn, blur=14):
    """Desenează aceeași compoziție pe un strat separat și o estompează: umbră moale, fără contur."""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(layer))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def vertical_gradient(w, h, stops):
    """stops: [(poziție 0..1, (r,g,b,a)), ...] → imagine RGBA."""
    col = Image.new("RGBA", (1, h))
    px = col.load()
    for y in range(h):
        t = y / max(1, h - 1)
        for i in range(len(stops) - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                k = (t - p0) / max(1e-6, p1 - p0)
                k = k * k * (3 - 2 * k)  # smoothstep: tranziții fără benzi
                px[0, y] = tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(4))
                break
    return col.resize((w, h), Image.BILINEAR)


def radial_glow(w, h, cx, cy, radius, color, alpha):
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=alpha)
    glow = glow.filter(ImageFilter.GaussianBlur(radius * 0.55))
    layer = Image.new("RGBA", (w, h), rgba(color, 0))
    layer.putalpha(glow)
    return layer


def grain(img, amount=7):
    """Granulație fină de film, ca imaginea să nu pară plată/digitală."""
    from PIL import ImageChops
    w, h = img.size
    n = Image.effect_noise((w, h), 64).point(lambda v: int(128 + (v - 128) * amount / 64))
    out = ImageChops.add(img.convert("RGB"), Image.merge("RGB", (n, n, n)), scale=1, offset=-128)
    return out if img.mode != "RGBA" else Image.merge("RGBA", (*out.split(), img.split()[-1]))


def ornament(d, cx, y, width, color, gap=22, star=True):
    """Linie fină — ✦ — linie fină."""
    half = width / 2
    d.line([(cx - half, y), (cx - gap, y)], fill=color, width=2)
    d.line([(cx + gap, y), (cx + half, y)], fill=color, width=2)
    if star:
        s = 7
        d.polygon([(cx, y - s * 1.6), (cx + s * 0.45, y - s * 0.45), (cx + s * 1.6, y), (cx + s * 0.45, y + s * 0.45),
                   (cx, y + s * 1.6), (cx - s * 0.45, y + s * 0.45), (cx - s * 1.6, y), (cx - s * 0.45, y - s * 0.45)], fill=color)


def frame(d, box, color, inset=14, width=2):
    """Ramă dublă aurie, subțire (ca pe o invitație)."""
    x0, y0, x1, y1 = box
    d.rectangle([x0, y0, x1, y1], outline=color, width=width)
    d.rectangle([x0 + inset, y0 + inset, x1 - inset, y1 - inset], outline=rgba(color[:3], int((color[3] if len(color) > 3 else 255) * 0.55)), width=1)
