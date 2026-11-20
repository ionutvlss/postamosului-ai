#!/usr/bin/env python3
"""Clip premium dintr-o singură imagine (fără avatar și fără voce): mișcare lentă de cameră, ninsoare, hook,
2–3 fraze serif una după alta, card final, plus o muzică ambientală discretă compusă aici (fără drepturi de autor).

  python3 make_motion.py --image scena.png --spec spec.json --out clip.mp4

spec.json:
  {
    "kicker": "6 decembrie",
    "hook": "În ghete, lângă dulciuri:|*un mesaj de la Moș*",
    "statements": ["Moșul îi spune|copilului *pe nume*", "Despre anul lui|și *dorința de Crăciun*"],
    "end_title": "Magia începe|*de la ghete.*",
    "cta_sub": "Gata în sub o oră · De la 39 lei · Fără cont",
    "duration": 12,
    "statement_position": "bottom" | "top",  # sus când subiectul ocupă mijlocul cadrului
    "focus": 0.55,            # unde e subiectul pe verticală (0 sus, 1 jos) pentru încadrare
    "music": true
  }
"""
import argparse, json, math, os, subprocess, sys, tempfile, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import brand as B
import make_clip as M

W, H, FPS = 1080, 1920, 25


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def prepare_background(src, out, focus):
    """Încadrare 9:16 la 1.2x (spațiu pentru zoom), gradare caldă, granulație fină."""
    img = Image.open(src).convert("RGB")
    tw, th = int(W * 1.2), int(H * 1.2)
    s = max(tw / img.width, th / img.height)
    img = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    left = (img.width - tw) // 2
    top = int((img.height - th) * focus)
    img = img.crop((left, top, left + tw, top + th))
    from PIL import ImageEnhance
    img = ImageEnhance.Contrast(img).enhance(1.05)
    img = ImageEnhance.Color(img).enhance(1.04)
    img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    B.grain(img, 4).save(out, quality=95)


def layer_statement(path, text, position="bottom"):
    im, shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0)), Image.new("RGBA", (W, H), (0, 0, 0, 0))
    size = B.fit_rich(text, 86, 900)
    lines = len(B.parse_rich(text))
    y = 300 if position == "top" else 1330 - lines * size * 1.1
    if position == "top":
        im.alpha_composite(B.vertical_gradient(W, 760, [(0, (14, 8, 9, 190)), (0.6, (14, 8, 9, 90)), (1, (14, 8, 9, 0))]), (0, 0))
    B.draw_rich(ImageDraw.Draw(im), W / 2, y, text, size, B.rgba(B.IVORY), B.rgba(B.GOLD_LIGHT), line_gap=1.1, shadow=ImageDraw.Draw(shadow))
    out = shadow.filter(ImageFilter.GaussianBlur(12))
    out.alpha_composite(im)
    out.save(path)


def write_music(path, total, sr=44100):
    """Pad cald, lent (Cmaj9 → Am9 → Fmaj9 → G6/9), cu atac moale, câteva note de clopoțel și reverb."""
    t = np.arange(int(total * sr)) / sr
    chords = [[130.81, 196.0, 246.94, 293.66, 329.63], [110.0, 164.81, 196.0, 246.94, 261.63],
              [87.31, 130.81, 174.61, 220.0, 261.63], [98.0, 146.83, 196.0, 220.0, 293.66]]
    seg = total / 4
    out = np.zeros_like(t)
    for i, ch in enumerate(chords):
        start, end = i * seg - 0.6, (i + 1) * seg + 0.9
        env = np.clip((t - start) / 1.4, 0, 1) * np.clip((end - t) / 1.6, 0, 1)
        env = env ** 1.5
        for k, f in enumerate(ch):
            det = 1 + 0.0015 * (k - 2)
            tone = np.sin(2 * np.pi * f * det * t) * 0.6 + np.sin(2 * np.pi * f * 2 * t) * 0.12 + np.sin(2 * np.pi * f * 0.5 * t) * 0.18
            out += tone * env * (0.16 if k else 0.22)
    # clopoței discreți (ca o cutie muzicală), pe notele acordului
    bells = [(0.9, 1046.5), (3.6, 987.77), (6.3, 880.0), (9.0, 1174.66), (10.4, 1318.51)]
    for at, f in bells:
        if at >= total - 0.5:
            continue
        d = np.clip(t - at, 0, None)
        env = np.where(t >= at, np.exp(-d * 2.6), 0)
        out += (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t)) * env * 0.09
    fade = np.clip(t / 1.2, 0, 1) * np.clip((total - t) / 1.8, 0, 1)
    out *= fade
    out = np.tanh(out * 0.9)
    out /= max(1e-6, np.abs(out).max()) / 0.5
    stereo = np.stack([out, np.roll(out, int(sr * 0.012))], axis=1)
    pcm = (stereo * 32767).astype(np.int16)
    raw = path + ".raw.wav"
    with wave.open(raw, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes())
    run(["ffmpeg", "-y", "-i", raw, "-af", "aecho=0.8:0.7:120|260:0.35|0.22,lowpass=f=5200,loudnorm=I=-20:TP=-2:LRA=7", path])
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    spec = json.load(open(a.spec, encoding="utf-8"))
    total = float(spec.get("duration", 12))
    statements = spec.get("statements", [])[:3]
    end_start = total - 2.8
    hook_end = 3.2
    span = (end_start - hook_end) / max(1, len(statements))
    with tempfile.TemporaryDirectory() as tmp:
        P = lambda n: os.path.join(tmp, n)
        prepare_background(a.image, P("bg.jpg"), float(spec.get("focus", 0.5)))
        M.layer_scrims(P("scrims.png"))
        M.layer_signature(P("sig.png"))
        M.layer_hook(P("hook.png"), spec.get("kicker", ""), spec["hook"])
        M.layer_end(tmp, spec)
        for i, st in enumerate(statements):
            layer_statement(P(f"st{i}.png"), st, spec.get("statement_position", "bottom"))
        snow = M.write_snow(P("snow.mov"), total)
        music = write_music(P("music.wav"), total) if spec.get("music", True) else None

        frames = int(total * FPS)
        inputs = ["-i", P("bg.jpg"), "-i", snow]
        # zoom lent spre centru (1.0 → 1.12), pe imaginea pregătită la 1.2x
        chain = [f"[0:v]scale={int(W * 1.2 * 2)}:-2,zoompan=z='1+0.12*on/{frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={FPS},"
                 f"eq=contrast=1.03:saturation=1.05,vignette=PI/4.6,gblur=sigma=20:enable='gte(t,{end_start:.2f})'[v0]",
                 "[1:v]scale=1080:1920,format=rgba[sn]", "[v0][sn]overlay=0:0:shortest=1[v1]"]
        idx, last = 2, "v1"

        def add(file, filt, pos="0:0", enable=None):
            nonlocal idx, last
            inputs.extend(["-loop", "1", "-framerate", str(FPS), "-t", f"{total:.2f}", "-i", P(file)])
            chain.append(f"[{idx}:v]format=rgba,{filt}[l{idx}]")
            en = f":enable='{enable}'" if enable else ""
            chain.append(f"[{last}][l{idx}]overlay={pos}:eval=frame{en}:shortest=1[v{idx}]")
            last = f"v{idx}"; idx += 1

        rise = lambda t0, d=0.8, px=28: f"0:'{px}*pow(1-min(1,max(0,(t-{t0:.2f})/{d})),3)'"
        add("scrims.png", f"fade=t=out:st={end_start - 0.3:.2f}:d=0.3:alpha=1")
        add("hook.png", f"fade=t=in:st=0.2:d=0.6:alpha=1,fade=t=out:st={hook_end - 0.45:.2f}:d=0.45:alpha=1", rise(0.2), f"lt(t,{hook_end:.2f})")
        add("sig.png", f"fade=t=in:st={hook_end - 0.2:.2f}:d=0.5:alpha=1,fade=t=out:st={end_start - 0.3:.2f}:d=0.3:alpha=1",
            enable=f"between(t,{hook_end - 0.25:.2f},{end_start:.2f})")
        for i in range(len(statements)):
            s0 = hook_end + i * span + 0.1
            s1 = hook_end + (i + 1) * span - 0.05
            add(f"st{i}.png", f"fade=t=in:st={s0:.2f}:d=0.5:alpha=1,fade=t=out:st={s1 - 0.4:.2f}:d=0.4:alpha=1", rise(s0, px=22), f"between(t,{s0:.2f},{s1:.2f})")
        add("end_bg.png", f"fade=t=in:st={end_start:.2f}:d=0.45:alpha=1", enable=f"gte(t,{end_start:.2f})")
        add("end_title.png", f"fade=t=in:st={end_start + 0.18:.2f}:d=0.6:alpha=1", rise(end_start + 0.18, px=34), f"gte(t,{end_start:.2f})")
        add("end_details.png", f"fade=t=in:st={end_start + 0.5:.2f}:d=0.6:alpha=1", rise(end_start + 0.5, px=24), f"gte(t,{end_start:.2f})")
        chain.append(f"[{last}]format=yuv420p[v]")
        audio = ["-i", music] if music else ["-f", "lavfi", "-t", f"{total:.2f}", "-i", "anullsrc=r=44100:cl=stereo"]
        a_idx = idx
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs, *audio, "-filter_complex", ";".join(chain),
             "-map", "[v]", "-map", f"{a_idx}:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", str(FPS),
             "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-t", f"{total:.2f}", a.out])
    print(json.dumps({"out": a.out, "duration": total, "statements": len(statements)}))


if __name__ == "__main__":
    sys.exit(main())
