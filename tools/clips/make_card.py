#!/usr/bin/env python3
"""Clip scurt (5–6 s): Moșul ține un card gol, iar oferta apare pe card, rând cu rând, cu tipografia brandului.

    python3 make_card.py --video santa_card.mp4 --spec card.json --out card.mp4

Fundalul e un clip AI cu camera fixă și cardul nemișcat (vezi RUNBOOK, „Clip-card”). `card.json`:
{
  "box": [x0, y0, x1, y1],            # zona de text pe card, în pixeli ai clipului sursă
  "kicker": "Poșta Moșului",
  "title": "Videoclip personalizat|de la *Moș Crăciun*",
  "sub": "cu numele și povestea copilului tău",
  "points": ["Gata în sub o oră, pe email", "Fără cont · fără poze", "De la 39 lei"],
  "button": "postamosului.ro"
}
"""
import argparse
import json
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw

import brand as B
from make_motion import write_music

W, H, FPS = 1080, 1920, 25
INK = (34, 22, 18)
WINE = (110, 24, 34)
GOLD_DEEP = (166, 120, 52)


def run(cmd):
    subprocess.run(cmd, check=True)


def probe(path, entry):
    return subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", entry, "-of", "csv=p=0", path],
                          capture_output=True, text=True, check=True).stdout.strip()


def blank():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def layers(tmp, spec, box):
    x0, y0, x1, y1 = box
    cx, width = (x0 + x1) / 2, x1 - x0
    out, y = [], y0

    im = blank(); d = ImageDraw.Draw(im)
    kf = B.font(B.SANS_SEMI, 25)
    B.draw_tracked(d, (cx, y), spec.get("kicker", "Poșta Moșului").upper(), kf, B.rgba(GOLD_DEEP), tracking=7, anchor="m")
    B.ornament(d, cx, y + 52, 230, B.rgba(GOLD_DEEP, 220), gap=16)
    out.append(("kicker", im, 0.2)); y += 112

    im = blank(); d = ImageDraw.Draw(im)
    title = spec["title"]
    size = B.fit_rich(title, 96, width - 10, min_size=56)
    y = B.draw_rich(d, cx, y, title, size, B.rgba(INK), B.rgba(WINE), line_gap=1.08)
    out.append(("title", im, 0.5)); y += 48

    if spec.get("sub"):
        im = blank(); d = ImageDraw.Draw(im)
        sf = B.font(B.SANS, 36)
        d.text((cx, y), spec["sub"], font=sf, fill=B.rgba((92, 70, 58)), anchor="mt")
        out.append(("sub", im, 1.05)); y += 96

    im = blank(); d = ImageDraw.Draw(im)
    d.line([(cx - 120, y), (cx + 120, y)], fill=B.rgba(GOLD_DEEP, 200), width=2)
    out.append(("rule", im, 1.4)); y += 50

    pf = B.font(B.SANS_SEMI, 38)
    for i, text in enumerate(spec.get("points", [])):
        im = blank(); d = ImageDraw.Draw(im)
        tw = d.textlength(text, font=pf)
        left = cx - (tw + 52) / 2
        r, my = 15, y + 22
        d.ellipse([left, my - r, left + 2 * r, my + r], fill=B.rgba(WINE))
        d.line([(left + 8, my), (left + 13, my + 6), (left + 23, my - 6)], fill=B.rgba(B.IVORY), width=4, joint="curve")
        d.text((left + 52, y + 2), text, font=pf, fill=B.rgba(INK))
        out.append((f"point{i}", im, 1.6 + 0.25 * i)); y += 70

    n = len(spec.get("points", []))
    t_next = 1.6 + 0.25 * n + 0.1
    if spec.get("price"):
        y += 22
        im = blank(); d = ImageDraw.Draw(im)
        y = B.draw_rich(d, cx, y, spec["price"], 84, B.rgba(INK), B.rgba(WINE), line_gap=1.0)
        out.append(("price", im, t_next)); t_next += 0.4; y += 52
    else:
        y += 30
    im = blank(); d = ImageDraw.Draw(im)
    bf = B.font(B.SANS_BOLD, 38)
    label = spec.get("button", "postamosului.ro")
    bw = d.textlength(label, font=bf) + 150
    bx0, bx1, by0, by1 = cx - bw / 2, cx + bw / 2, y, y + 96
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([bx0, by0 + 10, bx1, by1 + 10], radius=48, fill=(60, 10, 18, 110))
    from PIL import ImageFilter
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([bx0, by0, bx1, by1], radius=48, fill=B.rgba(WINE))
    d.rounded_rectangle([bx0 + 5, by0 + 5, bx1 - 5, by1 - 5], radius=43, outline=B.rgba(B.CHAMPAGNE, 150), width=2)
    d.text((cx - 22, (by0 + by1) / 2), label, font=bf, fill=B.rgba(B.IVORY), anchor="mm")
    ax = cx - 22 + d.textlength(label, font=bf) / 2 + 22
    ay = (by0 + by1) / 2
    d.line([(ax, ay), (ax + 30, ay)], fill=B.rgba(B.GOLD_LIGHT), width=4)
    d.line([(ax + 18, ay - 11), (ax + 31, ay), (ax + 18, ay + 11)], fill=B.rgba(B.GOLD_LIGHT), width=4, joint="curve")
    out.append(("button", im, t_next))

    paths = []
    for name, img, t in out:
        p = os.path.join(tmp, f"{name}.png")
        img.save(p)
        paths.append((p, t))
    return paths


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--duration", type=float, default=6.0)
    a = ap.parse_args()
    spec = json.load(open(a.spec, encoding="utf-8"))
    sw, sh = map(int, probe(a.video, "stream=width,height").split(","))
    scale = max(W / sw, H / sh)
    ox, oy = (sw * scale - W) / 2, (sh * scale - H) / 2
    bx = spec["box"]
    box = [bx[0] * scale - ox, bx[1] * scale - oy, bx[2] * scale - ox, bx[3] * scale - oy]
    total = a.duration

    with tempfile.TemporaryDirectory() as tmp:
        music = os.path.join(tmp, "music.wav")
        write_music(music, total)
        paths = layers(tmp, spec, box)
        inputs = ["-i", a.video]
        for p, _ in paths:
            inputs += ["-loop", "1", "-framerate", str(FPS), "-t", f"{total:.2f}", "-i", p]
        inputs += ["-i", music]
        grade = ("eq=contrast=1.04:saturation=1.06:gamma=1.02,colorbalance=rs=0.025:bs=-0.03:rh=0.015:bh=-0.015,"
                 "vignette=PI/5")
        chain = [f"[0:v]tpad=stop_mode=clone:stop_duration={total:.2f},scale=-2:{H}:flags=lanczos,crop={W}:{H},"
                 f"fps={FPS},{grade}[b0]"]
        last = "b0"
        for i, (_, t) in enumerate(paths, start=1):
            chain.append(f"[{i}:v]format=rgba,fade=t=in:st={t:.2f}:d=0.45:alpha=1[l{i}]")
            rise = f"'{H}*0+if(lt(t,{t:.2f}),14,if(lt(t,{t + 0.45:.2f}),14*(1-(t-{t:.2f})/0.45),0))'"
            chain.append(f"[{last}][l{i}]overlay=x=0:y={rise}:shortest=1[b{i}]")
            last = f"b{i}"
        # o împingere de cameră foarte lentă peste tot cadrul (text + card împreună), apoi grain fin
        chain.append(f"[{last}]scale=w='trunc({W}*(1+0.035*t/{total:.2f})/2)*2':h=-2:eval=frame,crop={W}:{H},"
                     f"noise=alls=4:allf=t,fade=t=out:st={total - 0.25:.2f}:d=0.25,format=yuv420p[v]")
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(chain),
             "-map", "[v]", "-map", f"{len(paths) + 1}:a", "-af", f"afade=t=out:st={total - 0.6:.2f}:d=0.6,loudnorm=I=-16:TP=-1.5",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", str(FPS), "-c:a", "aac", "-b:a", "160k",
             "-movflags", "+faststart", "-t", f"{total:.2f}", a.out])
    print(json.dumps({"out": a.out, "duration": total}))


if __name__ == "__main__":
    main()
