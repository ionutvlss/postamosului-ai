#!/usr/bin/env python3
"""Editează un clip de reclamă cu Moșul: subtitrări sincronizate, hook sus, call-to-action la final,
zoom lent și volum normalizat pentru rețelele sociale.

Folosire:
  python3 make_clip.py --video avatar.mp4 --spec spec.json --out clip.mp4 [--voice voce.mp3]

spec.json (exemplu):
  {
    "lines": ["Părinți, o secundă!", "Eu știu cum îl cheamă pe copilul vostru..."],
    "hook": "MOȘUL ȘTIE CUM ÎL CHEAMĂ\\NPE COPILUL TĂU",
    "cta": "POSTAMOSULUI.RO",
    "cta_sub": "de la 39 lei · gata în sub o oră",
    "style": "karaoke" | "box" | "clean",
    "highlight": ["Crăciun", "nume"]
  }

Sincronizarea: pauzele din voce (ffmpeg silencedetect) dau intervalele de vorbire; cuvintele se împart
proporțional cu lungimea lor doar în timpul vorbit, deci funcționează și când numărul de pauze diferă de
numărul de replici.
"""
import argparse, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
W, H = 1080, 1920
YELLOW = "&H0069C9F3&"  # #F3C969 în BGR
RED_BOX = "&H002E10C8"   # #C8102E


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).stdout
    return float(out.strip())


def speech_intervals(audio, total):
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", audio, "-af", "silencedetect=noise=-35dB:d=0.22", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", err)]
    ends = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", err)]
    silences = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else total
        silences.append((s, e))
    speech, cursor = [], 0.0
    for s, e in silences:
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
    total_w = sum(weights)
    spoken = sum(e - s for s, e in speech)

    def at(offset):  # timp vorbit cumulat → timp real
        for s, e in speech:
            if offset <= e - s:
                return s + offset
            offset -= e - s
        return speech[-1][1]

    out, acc = [], 0.0
    for i, (w, wt) in enumerate(zip(words, weights)):
        start = at(acc / total_w * spoken)
        acc += wt
        end = at(acc / total_w * spoken - 1e-6)
        out.append({"w": w, "s": start, "e": end, "line_end": i in line_end_idx})
    return out


def groups_of(words, size):
    groups, cur = [], []
    for w in words:
        cur.append(w)
        if len(cur) == size or w["line_end"] or w["w"].endswith((",", ".", "!", "?")):
            groups.append(cur); cur = []
    if cur:
        groups.append(cur)
    return groups


def ts(t):
    t = max(0.0, t)
    return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"


def esc(text):
    return text.replace("{", "(").replace("}", ")")


def build_ass(spec, words, total):
    style = spec.get("style", "karaoke")
    highlight = {h.lower().strip(".,!?") for h in spec.get("highlight", [])}
    head = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}", "WrapStyle: 0", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Karaoke,Montserrat ExtraBold,96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,3,2,60,60,560,1",
        f"Style: Box,Montserrat ExtraBold,84,&H00FFFFFF,&H00FFFFFF,{RED_BOX},{RED_BOX},-1,0,0,0,100,100,0,0,3,18,0,2,80,80,600,1",
        "Style: Clean,Montserrat ExtraBold,86,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,6,6,2,80,80,460,1",
        "Style: Hook,Montserrat ExtraBold,76,&H00FFFFFF,&H00FFFFFF,&H002E10C8,&H002E10C8,-1,0,0,0,100,100,0,0,3,26,0,8,70,70,200,1",
        "Style: Cta,Montserrat ExtraBold,70,&H00172030,&H00172030,&H0069C9F3,&H0069C9F3,-1,0,0,0,100,100,0,0,3,24,0,8,70,70,190,1",
        "Style: EndBig,Playfair Display Black,104,&H00E6F3FA,&H00E6F3FA,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,4,5,60,60,0,1",
        "Style: EndUrl,Montserrat ExtraBold,82,&H0069C9F3,&H0069C9F3,&H00000000,&H00000000,-1,0,0,0,100,100,1,0,1,0,3,5,60,60,0,1",
        "Style: EndSub,Montserrat ExtraBold,46,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,3,5,60,60,0,1",
        "Style: EndBtn,Montserrat ExtraBold,50,&H00FFFFFF,&H00FFFFFF,&H002E10C8,&H002E10C8,-1,0,0,0,100,100,0,0,3,30,0,5,60,60,0,1",
        "Style: Brand,Montserrat ExtraBold,40,&H00E6F3FA,&H00E6F3FA,&H00000000,&H78000000,-1,0,0,0,100,100,2,0,3,14,0,7,48,48,70,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    ev = []
    end_start = max(0, total - min(2.4, total * 0.25)) if spec.get("cta", "POSTAMOSULUI.RO") else total
    words = [dict(w, e=min(w["e"], end_start)) for w in words if w["s"] < end_start - 0.05]
    if style == "karaoke":
        for g in groups_of(words, 3):
            for i, cur in enumerate(g):
                end = g[i + 1]["s"] if i + 1 < len(g) else min(cur["e"] + 0.15, end_start)
                parts = []
                for j, w in enumerate(g):
                    word = esc(w["w"].upper())
                    parts.append(r"{\c" + YELLOW + r"\fscx112\fscy112}" + word + r"{\c&H00FFFFFF&\fscx100\fscy100}" if j == i else word)
                ev.append(f"Dialogue: 1,{ts(cur['s'])},{ts(end)},Karaoke,,0,0,0,," + " ".join(parts))
    elif style == "box":
        for g in groups_of(words, 2):
            text = " ".join(esc(w["w"].upper()) for w in g)
            if any(w["w"].lower().strip(".,!?") in highlight for w in g):
                text = r"{\c" + YELLOW + "}" + text
            ev.append(f"Dialogue: 1,{ts(g[0]['s'])},{ts(g[-1]['e'] + 0.1)},Box,,0,0,0,,"
                      + r"{\fscx70\fscy70\t(0,120,\fscx105\fscy105)\t(120,200,\fscx100\fscy100)}" + text)
    else:  # clean: propoziții întregi, cuvintele cheie colorate
        for g in groups_of(words, 7):
            parts = []
            for w in g:
                word = esc(w["w"])
                parts.append(r"{\c" + YELLOW + "}" + word + r"{\c&H00FFFFFF&}" if w["w"].lower().strip(".,!?") in highlight else word)
            ev.append(f"Dialogue: 1,{ts(g[0]['s'])},{ts(g[-1]['e'] + 0.12)},Clean,,0,0,0,,{{\\fad(80,80)}}" + " ".join(parts))
    hook = spec.get("hook")
    if hook:
        hook_end = min(2.8, total)
        ev.append(rf"Dialogue: 2,0:00:00.00,{ts(hook_end)},Hook,,0,0,0,,{{\fad(0,200)\t(0,180,\fscx106\fscy106)\t(180,360,\fscx100\fscy100)}}{esc(hook).replace(chr(92)+'n', chr(92)+'N')}")
    cta = spec.get("cta", "POSTAMOSULUI.RO")
    end_len = min(2.4, total * 0.25)
    end_start = max(0, total - end_len)
    if spec.get("brand", True):
        ev.append(rf"Dialogue: 0,{ts(min(2.8, total))},{ts(end_start)},Brand,,0,0,0,,{{\fad(200,150)}}POȘTA MOȘULUI")
    if cta:
        sub = spec.get("cta_sub", "de la 39 lei · gata în sub o oră")
        kicker = spec.get("end_title", "Moșul îl așteaptă")
        ev.append(rf"Dialogue: 3,{ts(end_start)},{ts(total)},EndBig,,0,0,0,,{{\pos(540,700)\fad(250,0)\t(0,300,\fscx104\fscy104)}}{esc(kicker)}")
        ev.append(rf"Dialogue: 3,{ts(end_start + 0.15)},{ts(total)},EndUrl,,0,0,0,,{{\pos(540,860)\fad(250,0)}}{esc(cta)}")
        ev.append(rf"Dialogue: 3,{ts(end_start + 0.3)},{ts(total)},EndSub,,0,0,0,,{{\pos(540,960)\fad(250,0)}}{esc(sub)}")
        ev.append(rf"Dialogue: 3,{ts(end_start + 0.45)},{ts(total)},EndBtn,,0,0,0,,{{\pos(540,1110)\fad(200,0)\t(300,600,\fscx106\fscy106)\t(600,900,\fscx100\fscy100)}}Comandă acum  →")
    return "\n".join(head + ev) + "\n"


def write_snow(path, total, fps=25, seed=11):
    """Strat de fulgi (540x960, RGBA) ca secvență PNG comprimată într-un .mov cu alpha."""
    import random
    from PIL import Image, ImageDraw, ImageFilter
    rnd = random.Random(seed)
    w, h = 540, 960
    flakes = [[rnd.uniform(0, w), rnd.uniform(-h, h), rnd.uniform(0.8, 2.6), rnd.uniform(18, 55), rnd.uniform(0, 6.28), rnd.randint(110, 230)] for _ in range(110)]
    frames_dir = path + "_frames"
    os.makedirs(frames_dir, exist_ok=True)
    import math
    n = int(total * fps) + 1
    for i in range(n):
        t = i / fps
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
        for x, y0, r, speed, ph, a in flakes:
            y = (y0 + speed * t) % (h + 40) - 20
            xx = x + math.sin(t * 0.9 + ph) * 10
            d.ellipse([xx - r, y - r, xx + r, y + r], fill=(255, 255, 255, a))
        im.filter(ImageFilter.GaussianBlur(0.7)).save(f"{frames_dir}/{i:05d}.png", compress_level=1)
    run(["ffmpeg", "-y", "-framerate", str(fps), "-i", f"{frames_dir}/%05d.png", "-c:v", "qtrle", path])
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="clipul cu avatarul (vertical 1080x1920 sau oricare)")
    ap.add_argument("--voice", help="vocea separat (implicit: sunetul din video)")
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-zoom", action="store_true")
    ap.add_argument("--no-snow", action="store_true")
    a = ap.parse_args()
    spec = json.load(open(a.spec, encoding="utf-8"))
    total = duration(a.video)
    with tempfile.TemporaryDirectory() as tmp:
        audio = a.voice
        if not audio:
            audio = os.path.join(tmp, "a.wav")
            run(["ffmpeg", "-y", "-i", a.video, "-vn", "-ac", "1", "-ar", "16000", audio])
        speech = speech_intervals(audio, min(total, duration(audio)))
        words = word_timings(spec["lines"], speech)
        ass = os.path.join(tmp, "subs.ass")
        open(ass, "w", encoding="utf-8").write(build_ass(spec, words, total))
        zoom = "" if a.no_zoom else f"scale=w='trunc({W}*(1.07-0.07*t/{total:.2f})/2)*2':h=-2:eval=frame,crop={W}:{H},"
        end_start = max(0, total - min(2.4, total * 0.25))
        grade = "eq=contrast=1.05:saturation=1.1:gamma=0.98,colorbalance=rs=0.03:gs=0.01:bs=-0.03,vignette=PI/5"
        endfx = f"boxblur=18:2:enable='gte(t,{end_start:.2f})',eq=brightness=-0.12:enable='gte(t,{end_start:.2f})'"
        inputs = ["-i", a.video]
        chain = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},{zoom}{grade},{endfx}[base]"
        if not a.no_snow:
            snow = write_snow(os.path.join(tmp, "snow.mov"), total)
            inputs += ["-i", snow]
            chain += f";[1:v]scale={W}:{H},format=rgba[snow];[base][snow]overlay=0:0:shortest=1[sn]"
            last = "sn"
        else:
            last = "base"
        chain += f";color=c=0xF3C969:s={W}x10:d={total:.2f}[bar];[{last}][bar]overlay=x='-W+W*t/{total:.2f}':y=H-10:shortest=1[pb]"
        chain += f";[pb]ass={ass}:fontsdir={FONTS}[v]"
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", chain, "-map", "[v]", "-map", "0:a",
             "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
             "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-t", f"{total:.2f}", a.out])
    print(json.dumps({"out": a.out, "duration": round(total, 2), "words": len(words), "speech_segments": len(speech)}))


if __name__ == "__main__":
    sys.exit(main())
