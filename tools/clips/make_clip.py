#!/usr/bin/env python3
"""Editează un clip de reclamă cu Moșul în stil premium (editorial, nu „reclamă de raft”).

  python3 make_clip.py --video avatar.mp4 --spec spec.json --out clip.mp4 [--voice voce.mp3] [--no-zoom] [--no-snow]

spec.json:
  {
    "lines": ["Părinți, o secundă!", "Eu știu cum îl cheamă pe copilul vostru..."],
    "kicker": "Pentru părinți",                       # eticheta mică aurie de deasupra hook-ului
    "hook": "Moșul îi știe|*numele*",                  # *accent* = italic auriu, | = rând nou
    "style": "editorial" | "serif",                    # (vechile karaoke/clean → editorial, box → serif)
    "highlight": ["Crăciun", "nume"],                  # cuvinte scrise în italic auriu în subtitrări
    "end_title": "Un mesaj doar|pentru *el*.",
    "cta": "POSTAMOSULUI.RO",
    "cta_sub": "De la 39 lei · Gata în sub o oră · Fără cont",
    "button": "Comandă acum"
  }

Ce face, pe straturi: gradare caldă + granulație fină, ninsoare în trei planuri (adâncime), hook editorial sus
(apare cu o ridicare lină), semnătura „POȘTA MOȘULUI” sus, subtitrări cu cuvântul rostit evidențiat și cuvintele
cheie în serif italic auriu, iar la final un card ca o invitație (ramă aurie dublă, titlu serif, buton).
Textele stau în zonele sigure din TikTok/Reels/Shorts (sus ~200 px și jos ~420 px sunt acoperite de interfață).

Sincronizarea: pauzele din voce (silencedetect) dau intervalele de vorbire, iar cuvintele se împart proporțional
cu lungimea lor doar în timpul vorbit.
"""
import argparse, json, math, os, re, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brand as B

W, H = 1080, 1920
HOOK_END = 2.9
END_LEN = 2.8


def ass_color(rgb, alpha=0):
    r, g, b = rgb
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"


GOLD_ASS = ass_color(B.CHAMPAGNE)
IVORY_ASS = ass_color(B.IVORY)


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).stdout.strip())


def speech_intervals(audio, total):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", audio, "-af", "silencedetect=noise=-35dB:d=0.22", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", err)]
    speech, cursor = [], 0.0
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else total
        if s - cursor > 0.08:
            speech.append((cursor, s))
        cursor = e
    if total - cursor > 0.08:
        speech.append((cursor, total))
    return speech or [(0.0, total)]


def word_timings(lines, speech):
    words = [w for line in lines for w in line.split()]
    line_end_idx, n = set(), 0
    for line in lines:
        n += len(line.split())
        line_end_idx.add(n - 1)
    weights = [len(w) + 1 for w in words]
    total_w, spoken = sum(weights), sum(e - s for s, e in speech)

    def at(offset):
        for s, e in speech:
            if offset <= e - s:
                return s + offset
            offset -= e - s
        return speech[-1][1]

    out, acc = [], 0.0
    for i, (w, wt) in enumerate(zip(words, weights)):
        start = at(acc / total_w * spoken)
        acc += wt
        out.append({"w": w, "s": start, "e": at(acc / total_w * spoken - 1e-6), "line_end": i in line_end_idx})
    return out


def phrases(words, max_chars=30, max_words=6):
    """Grupuri scurte, rupte la punctuație sau la capăt de replică — se citesc dintr-o privire."""
    groups, cur = [], []
    for w in words:
        if cur and (len(" ".join(x["w"] for x in cur + [w])) > max_chars or len(cur) >= max_words):
            groups.append(cur); cur = []
        cur.append(w)
        if w["line_end"] or w["w"].endswith((",", ".", "!", "?", "…")):
            groups.append(cur); cur = []
    if cur:
        groups.append(cur)
    # nu lăsa un cuvânt orfan: îl lipim de grupul dinainte
    merged = []
    for g in groups:
        if merged and len(g) == 1 and len(merged[-1]) < max_words and not merged[-1][-1]["line_end"]:
            merged[-1] = merged[-1] + g
        else:
            merged.append(g)
    return merged


def split_two(group, threshold=17):
    """Rupe în două rânduri echilibrate când grupul e lung (indicele cuvântului după care vine \\N)."""
    text = " ".join(w["w"] for w in group)
    if len(text) <= threshold or len(group) < 2:
        return None
    best, best_diff, acc = None, 1e9, 0
    for i in range(len(group) - 1):
        acc += len(group[i]["w"]) + 1
        diff = abs(acc - (len(text) - acc))
        if diff < best_diff:
            best, best_diff = i, diff
    return best


def ts(t):
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def esc(text):
    return text.replace("{", "(").replace("}", ")").replace("\\", "")


def norm(word):
    return word.lower().strip(".,!?…\"„”")


def build_ass(spec, words, total, end_start):
    style = {"karaoke": "editorial", "clean": "editorial", "box": "serif"}.get(spec.get("style"), spec.get("style", "editorial"))
    highlight = {norm(h) for h in spec.get("highlight", [])}
    head = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        # umbra e un halou estompat (\blur), nu un contur negru
        f"Style: Editorial,Inter SemiBold,68,{IVORY_ASS},{IVORY_ASS},&H8C000000,&HFF000000,0,0,0,0,100,100,0.5,0,1,3.2,0,2,110,110,575,1",
        f"Style: Serif,Bodoni Moda Medium,94,{IVORY_ASS},{IVORY_ASS},&H96000000,&HFF000000,0,0,0,0,100,100,0,0,1,3.4,0,2,100,100,560,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    ev = []
    words = [dict(w, e=min(w["e"], end_start - 0.05)) for w in words if w["s"] < end_start - 0.15]
    italic = r"\fnBodoni Moda Medium Italic"

    def token(w, state, base_font, base_size, accent_size):
        """state: 'past' / 'now' / 'next'. Cuvintele cheie: serif italic auriu; cel rostit: auriu; următoarele: estompate."""
        word = esc(w["w"])
        key = norm(w["w"]) in highlight
        tags = ""
        if key:
            tags += italic + rf"\fs{accent_size}\c{GOLD_ASS}"
        elif state == "now":
            tags += rf"\c{GOLD_ASS}"
        if state == "next":
            tags += r"\1a&H5A&"
        reset = rf"\fn{base_font}\fs{base_size}\c{IVORY_ASS}\1a&H00&"
        return ("{" + tags + "}" if tags else "") + word + ("{" + reset + "}" if tags else "")

    groups = phrases(words, max_chars=30 if style == "editorial" else 30, max_words=6)
    for gi, g in enumerate(groups):
        brk = split_two(g, 17 if style == "editorial" else 15)
        g_end = min(g[-1]["e"] + 0.18, end_start - 0.05)
        if gi + 1 < len(groups):  # fraza se stinge complet înainte să apară următoarea (fără suprapuneri)
            g_end = max(g[-1]["e"], min(g_end, groups[gi + 1][0]["s"] - 0.02))
        if style == "editorial":
            for i, cur in enumerate(g):
                start = cur["s"] if i else g[0]["s"]
                end = g[i + 1]["s"] if i + 1 < len(g) else g_end
                parts = []
                for j, w in enumerate(g):
                    parts.append(token(w, "past" if j < i else "now" if j == i else "next", "Inter SemiBold", 68, 84))
                    if j < len(g) - 1:
                        parts.append(r"\N" if j == brk else " ")
                fade = r"{\blur7\fad(110,0)}" if i == 0 else r"{\blur7}"
                if i == len(g) - 1:
                    fade = fade[:-1] + r"\fad(0,140)}" if i else r"{\blur7\fad(110,140)}"
                ev.append(f"Dialogue: 1,{ts(start)},{ts(end)},Editorial,,0,0,0,,{fade}" + "".join(parts))
        else:
            parts = []
            for j, w in enumerate(g):
                parts.append(token(w, "past", "Bodoni Moda Medium", 94, 98))
                if j < len(g) - 1:
                    parts.append(r"\N" if j == brk else " ")
            ev.append(f"Dialogue: 1,{ts(g[0]['s'])},{ts(g_end)},Serif,,0,0,0,,"
                      + r"{\blur8\fad(160,160)\move(540,1382,540,1360,0,320)\an2}" + "".join(parts))
    return "\n".join(head + ev) + "\n"


# ---------- straturi grafice (PNG cu transparență) ----------

def layer_scrims(path):
    """Întunecare discretă sus (pentru semnătură) și jos (pentru subtitrări). Caldă, nu neagră-gri."""
    top = B.vertical_gradient(W, 420, [(0, (12, 7, 8, 150)), (1, (12, 7, 8, 0))])
    bottom = B.vertical_gradient(W, 900, [(0, (12, 7, 8, 0)), (0.6, (12, 7, 8, 95)), (1, (8, 5, 6, 185))])
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    im.alpha_composite(top, (0, 0))
    im.alpha_composite(bottom, (0, H - 900))
    im.save(path)


def layer_hook(path, kicker, hook):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    im.alpha_composite(B.vertical_gradient(W, 820, [(0, (14, 8, 9, 200)), (0.55, (14, 8, 9, 110)), (1, (14, 8, 9, 0))]), (0, 0))
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d, sd = ImageDraw.Draw(im), ImageDraw.Draw(shadow)
    y = 214
    if kicker:
        k = kicker.upper()
        f = B.font(B.SANS_SEMI, 27)
        tw = B.tracked_width(d, k, f, 8)
        B.draw_tracked(d, (W / 2, y), k, f, B.rgba(B.CHAMPAGNE), tracking=8, anchor="m")
        d.line([(W / 2 - tw / 2 - 70, y + 17), (W / 2 - tw / 2 - 24, y + 17)], fill=B.rgba(B.CHAMPAGNE, 200), width=2)
        d.line([(W / 2 + tw / 2 + 24, y + 17), (W / 2 + tw / 2 + 70, y + 17)], fill=B.rgba(B.CHAMPAGNE, 200), width=2)
        y += 66
    size = B.fit_rich(hook, 96, 900)
    B.draw_rich(d, W / 2, y, hook, size, B.rgba(B.IVORY), B.rgba(B.GOLD_LIGHT), line_gap=1.1, shadow=sd)
    out = Image.alpha_composite(Image.new("RGBA", (W, H), (0, 0, 0, 0)), shadow.filter(ImageFilter.GaussianBlur(10)))
    out.alpha_composite(im)
    out.save(path)


def layer_signature(path):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = B.font(B.SANS_SEMI, 25)
    text = "POȘTA MOȘULUI"
    tw = B.tracked_width(d, text, f, 9)
    y = 132
    B.draw_tracked(d, (W / 2, y), text, f, B.rgba(B.IVORY, 235), tracking=9, anchor="m")
    for sign in (-1, 1):
        x0 = W / 2 + sign * (tw / 2 + 22)
        d.line([(x0, y + 16), (x0 + sign * 40, y + 16)], fill=B.rgba(B.CHAMPAGNE, 220), width=2)
    im.save(path)


def layer_end(dir_, spec):
    """Cardul final în trei straturi, ca să apară în cascadă: fundal+ramă, titlu, detalii+buton."""
    bg = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bg.alpha_composite(B.vertical_gradient(W, H, [(0, (26, 6, 11, 215)), (0.5, (44, 9, 16, 200)), (1, (14, 5, 8, 235))]))
    bg.alpha_composite(B.radial_glow(W, H, W // 2, 820, 520, B.GOLD, 40))
    d = ImageDraw.Draw(bg)
    B.frame(d, (58, 236, W - 58, H - 330), B.rgba(B.CHAMPAGNE, 210), inset=14, width=2)
    B.ornament(d, W / 2, 486, 260, B.rgba(B.CHAMPAGNE, 230))
    f = B.font(B.SANS_SEMI, 25)
    B.draw_tracked(d, (W / 2, 528), "POȘTA MOȘULUI", f, B.rgba(B.CHAMPAGNE), tracking=9, anchor="m")
    bg.save(os.path.join(dir_, "end_bg.png"))

    title = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    end_title = spec.get("end_title", "Un mesaj doar|pentru *el*.")
    y = B.draw_rich(ImageDraw.Draw(title), W / 2, 630, end_title, B.fit_rich(end_title, 112, 860),
                    B.rgba(B.IVORY), B.rgba(B.GOLD_LIGHT), line_gap=1.0, shadow=ImageDraw.Draw(shadow))
    out = shadow.filter(ImageFilter.GaussianBlur(12))
    out.alpha_composite(title)
    out.save(os.path.join(dir_, "end_title.png"))

    det = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(det)
    y = max(y + 34, 920)
    d.line([(W / 2 - 60, y), (W / 2 + 60, y)], fill=B.rgba(B.CHAMPAGNE, 200), width=2)
    y += 52
    B.draw_tracked(d, (W / 2, y), spec.get("cta", "POSTAMOSULUI.RO").upper(), B.font(B.SANS_SEMI, 40), B.rgba(B.IVORY), tracking=7, anchor="m")
    y += 78
    sub = spec.get("cta_sub", "De la 39 lei · Gata în sub o oră · Fără cont")
    B.draw_tracked(d, (W / 2, y), sub, B.font(B.SANS, 31), B.rgba(B.IVORY, 205), tracking=1, anchor="m")
    y += 110
    label = spec.get("button", "Comandă acum")
    bf = B.font(B.SANS_SEMI, 34)
    lw = B.tracked_width(d, label, bf, 2)
    bw = lw + 56 + 150
    bx0, by0 = W / 2 - bw / 2, y
    btn = B.vertical_gradient(int(bw), 104, [(0, B.rgba(B.GOLD_LIGHT)), (1, B.rgba(B.GOLD))])
    mask = Image.new("L", btn.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, btn.width - 1, btn.height - 1], radius=52, fill=255)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle([bx0, by0 + 10, bx0 + bw, by0 + 114], radius=52, fill=(0, 0, 0, 140))
    det = Image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(16)), det)
    det.paste(btn, (int(bx0), int(by0)), mask)
    d = ImageDraw.Draw(det)
    tx = W / 2 - (lw + 56) / 2
    B.draw_tracked(d, (tx, by0 + 31), label, bf, B.rgba(B.INK), tracking=2)
    ax, ay = tx + lw + 24, by0 + 53
    d.line([(ax, ay), (ax + 32, ay)], fill=B.rgba(B.INK), width=3)
    d.line([(ax + 20, ay - 11), (ax + 33, ay), (ax + 20, ay + 11)], fill=B.rgba(B.INK), width=3, joint="curve")
    det.save(os.path.join(dir_, "end_details.png"))


def write_snow(path, total, fps=25, seed=11):
    """Ninsoare în trei planuri: fulgi mici și lenți în spate, medii, și câțiva mari, estompați, aproape de cameră."""
    import random
    rnd = random.Random(seed)
    w, h = 540, 960
    planes = [  # (număr, rază, viteză, opacitate, estompare)
        (55, (0.6, 1.2), (14, 26), (90, 150), 0.4),
        (26, (1.4, 2.2), (30, 48), (120, 190), 0.8),
        (7, (4.5, 7.5), (60, 85), (45, 80), 3.2),
    ]
    flakes = []
    for count, r, sp, al, blur in planes:
        flakes.append(([[rnd.uniform(0, w), rnd.uniform(-h, h), rnd.uniform(*r), rnd.uniform(*sp), rnd.uniform(0, 6.28),
                         rnd.randint(*al)] for _ in range(count)], blur))
    frames_dir = path + "_frames"
    os.makedirs(frames_dir, exist_ok=True)
    for i in range(int(total * fps) + 1):
        t = i / fps
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        for items, blur in flakes:
            layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            d = ImageDraw.Draw(layer)
            for x, y0, r, speed, ph, a in items:
                y = (y0 + speed * t) % (h + 40) - 20
                xx = x + math.sin(t * 0.7 + ph) * (6 + r * 2)
                d.ellipse([xx - r, y - r, xx + r, y + r], fill=(255, 250, 240, a))
            im.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))
        im.save(f"{frames_dir}/{i:05d}.png", compress_level=1)
    run(["ffmpeg", "-y", "-framerate", str(fps), "-i", f"{frames_dir}/%05d.png", "-c:v", "qtrle", path])
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--voice")
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-zoom", action="store_true")
    ap.add_argument("--no-snow", action="store_true")
    a = ap.parse_args()
    spec = json.load(open(a.spec, encoding="utf-8"))
    total = duration(a.video)
    end_start = max(0.0, total - min(END_LEN, total * 0.25)) if spec.get("cta", "POSTAMOSULUI.RO") else total
    hook_end = min(HOOK_END, end_start)
    with tempfile.TemporaryDirectory() as tmp:
        audio = a.voice
        if not audio:
            audio = os.path.join(tmp, "a.wav")
            run(["ffmpeg", "-y", "-i", a.video, "-vn", "-ac", "1", "-ar", "16000", audio])
        speech = speech_intervals(audio, min(total, duration(audio)))
        words = word_timings(spec["lines"], speech)
        ass = os.path.join(tmp, "subs.ass")
        open(ass, "w", encoding="utf-8").write(build_ass(spec, words, total, end_start))

        P = lambda n: os.path.join(tmp, n)
        layer_scrims(P("scrims.png"))
        layer_signature(P("sig.png"))
        if spec.get("hook"):
            layer_hook(P("hook.png"), spec.get("kicker", "Pentru părinți"), spec["hook"])
        layer_end(tmp, spec)

        zoom = "" if a.no_zoom else f"scale=w='trunc({W}*(1.06-0.06*t/{total:.2f})/2)*2':h=-2:eval=frame,crop={W}:{H},"
        grade = ("eq=contrast=1.05:saturation=1.07:gamma=1.02:brightness=0.012,colorbalance=rs=0.03:gs=0.008:bs=-0.035:rh=0.02:bh=-0.02,"
                 "vignette=PI/4.6,noise=alls=5:allf=t")
        endfx = f"gblur=sigma=22:enable='gte(t,{end_start:.2f})'"
        inputs = ["-i", a.video]

        chain = [f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},{zoom}{grade},{endfx}[v0]"]
        idx, last = 1, "v0"

        def add(label_in, file, filt, pos="0:0", enable=None):
            nonlocal idx, last
            inputs.extend(["-loop", "1", "-framerate", "25", "-t", f"{total:.2f}", "-i", P(file)])
            out = f"v{idx}"
            chain.append(f"[{idx}:v]format=rgba,{filt}[l{idx}]")
            en = f":enable='{enable}'" if enable else ""
            chain.append(f"[{last}][l{idx}]overlay={pos}:eval=frame{en}:shortest=1[{out}]")
            idx += 1
            last = out

        if not a.no_snow:
            inputs.extend(["-i", write_snow(P("snow.mov"), total)])
            chain.append(f"[{idx}:v]scale={W}:{H},format=rgba[sn]")
            chain.append(f"[{last}][sn]overlay=0:0:shortest=1[v{idx}]")
            last = f"v{idx}"; idx += 1

        add(None, "scrims.png", f"fade=t=out:st={end_start - 0.3:.2f}:d=0.3:alpha=1")
        if spec.get("hook"):
            rise = lambda t0, d=0.7, px=28: f"0:'{px}*pow(1-min(1,max(0,(t-{t0})/{d})),3)'"
            add(None, "hook.png", f"fade=t=in:st=0.12:d=0.5:alpha=1,fade=t=out:st={hook_end - 0.4:.2f}:d=0.4:alpha=1", rise(0.12), f"lt(t,{hook_end:.2f})")
            add(None, "sig.png", f"fade=t=in:st={hook_end - 0.25:.2f}:d=0.5:alpha=1,fade=t=out:st={end_start - 0.3:.2f}:d=0.3:alpha=1",
                enable=f"between(t,{hook_end - 0.3:.2f},{end_start:.2f})")
        else:
            add(None, "sig.png", f"fade=t=in:st=0.2:d=0.5:alpha=1,fade=t=out:st={end_start - 0.3:.2f}:d=0.3:alpha=1", enable=f"lt(t,{end_start:.2f})")
        chain.append(f"[{last}]ass={ass}:fontsdir={B.FONTS}[sub]")
        last = "sub"
        rise = lambda t0, d=0.8, px=34: f"0:'{px}*pow(1-min(1,max(0,(t-{t0:.2f})/{d})),3)'"
        add(None, "end_bg.png", f"fade=t=in:st={end_start:.2f}:d=0.45:alpha=1", enable=f"gte(t,{end_start:.2f})")
        add(None, "end_title.png", f"fade=t=in:st={end_start + 0.18:.2f}:d=0.6:alpha=1", rise(end_start + 0.18), f"gte(t,{end_start:.2f})")
        add(None, "end_details.png", f"fade=t=in:st={end_start + 0.5:.2f}:d=0.6:alpha=1", rise(end_start + 0.5, px=24), f"gte(t,{end_start:.2f})")
        chain.append(f"[{last}]format=yuv420p[v]")

        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(chain), "-map", "[v]", "-map", "0:a",
             "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:v", "libx264", "-preset", "veryfast", "-crf", "19", "-r", "25",
             "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-t", f"{total:.2f}", a.out])
    print(json.dumps({"out": a.out, "duration": round(total, 2), "words": len(words), "speech_segments": len(speech)}))


if __name__ == "__main__":
    sys.exit(main())
