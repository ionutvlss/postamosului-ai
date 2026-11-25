#!/usr/bin/env python3
"""Videoclip de la Moș Crăciun pentru un GRUP (clasă, grădiniță, familie), din JSON-ul comenzii.

Folosire:
  1. În /admin-grupuri apasă „Copiază JSON comandă” și salvează-l ca comanda.json.
  2. Verificare gratuită (nu costă nimic):   python3 group_video.py comanda.json
     Arată textul Moșului pe segmente, durata estimată și costul estimat.
  3. Generare reală (costă bani):            WAVESPEED_API_KEY=... python3 group_video.py comanda.json --run --yes
     Rezultatul: out/<id>/final.mp4 (16:9). Încarcă-l în /admin-grupuri și apasă „Marchează gata”.

Fiecare segment (voce + avatar) se salvează în out/<id>/; o rulare repetată NU plătește din nou segmentele deja făcute.
Cheia WaveSpeed vine doar din mediu și nu se afișează niciodată. Textul „mesaj comun” al clientului
se folosește exact cum e scris: citește-l în dry-run înainte de --run.
"""
import argparse, hashlib, json, os, subprocess, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from daily_run import AVATAR, AVATAR_PROMPT, download, ws_run  # noqa: E402

WORDS_PER_SEC = 2.3          # ritm de vorbire estimat pentru vocea Moșului
AVATAR_USD_PER_SEC = 0.06    # heygen/avatar-6/turbo, 1080p
TTS_USD_PER_SEGMENT = 0.20   # elevenlabs/eleven-v3 (estimare prudentă)

NAME_LINES = [
    "[warmly] {names}, v-am văzut anul acesta și sunt tare mândru de voi!",
    "[warmly] {names}, spiridușii mi-au spus că ați fost foarte cuminți!",
    "[warmly] {names}, să știți că vă țin minte pe fiecare, de la Polul Nord!",
    "[warmly] {names}, aveți un loc special pe lista mea de copii minunați!",
    "[warmly] {names}, Rudolf vă salută și el, și așteaptă să vă cunoască!",
]


def join_names(names):
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " și " + names[-1]


def chunk(names, size=4):
    out = [names[i:i + size] for i in range(0, len(names), size)]
    if len(out) > 1 and len(out[-1]) == 1:
        last = out.pop()
        out[-1] += last
    return out


def build_segments(order):
    group = order["group_name"].strip()
    spoken = [(c.get("pronunciation") or c["name"]).strip() for c in order["children"]]
    segs = [f"[warmly] Ho-ho-ho! Dragi copii din {group}! Sunt Moș Crăciun, și am pregătit un mesaj numai pentru voi."]
    for i, g in enumerate(chunk(spoken)):
        segs.append(NAME_LINES[i % len(NAME_LINES)].format(names=join_names(g)))
    common = (order.get("common_message") or "").strip()
    if common:
        segs.append("[warmly] " + common)
    segs.append("[warmly] Fiți cuminți, ascultați de părinți și de învățători, și vă aștept cu drag de Crăciun! Ho-ho-ho, sărbători fericite!")
    return segs


def estimate(segs):
    secs = sum(len(s.split()) / WORDS_PER_SEC for s in segs)
    return secs, secs * AVATAR_USD_PER_SEC + len(segs) * TTS_USD_PER_SEGMENT


def run(order, segs, work):
    os.makedirs(work, exist_ok=True)
    clips = []
    for i, text in enumerate(segs):
        h = hashlib.sha1(text.encode()).hexdigest()[:10]
        clip = os.path.join(work, f"seg{i:02d}_{h}.mp4")
        if not os.path.exists(clip):
            urlfile = os.path.join(work, f"seg{i:02d}_{h}.audio_url")
            if os.path.exists(urlfile):
                audio_url = open(urlfile).read().strip()
            else:
                audio_url = ws_run("elevenlabs/eleven-v3", {"text": text, "voice_id": "Bill", "stability": 0.5}, wait=300)
                open(urlfile, "w").write(audio_url)  # nu plătim vocea a doua oară dacă avatarul eșuează
            print(f"segment {i + 1}/{len(segs)}: voce gata, generez avatarul", flush=True)
            url = ws_run("heygen/avatar-6/turbo", {"image": AVATAR, "audio": audio_url, "resolution": "1080p", "prompt": AVATAR_PROMPT}, wait=1200)
            download(url, clip)
        clips.append(clip)
    lst = os.path.join(work, "list.txt")
    with open(lst, "w") as f:
        f.writelines(f"file '{os.path.abspath(c)}'\n" for c in clips)
    joined = os.path.join(work, "joined.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst,
                    "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", joined], check=True)
    final = os.path.join(work, "final.mp4")
    vf = ("[0:v]split[a][b];[a]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,boxblur=20[bg];"
          "[b]scale=-2:720[fg];[bg][fg]overlay=(W-w)/2:0,format=yuv420p[v]")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", joined, "-filter_complex", vf, "-map", "[v]", "-map", "0:a",
                    "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", final], check=True)
    return final


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("order_json")
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--yes", action="store_true", help="confirmă costul")
    ap.add_argument("--out", default="out")
    a = ap.parse_args()
    order = json.load(open(a.order_json, encoding="utf-8"))
    segs = build_segments(order)
    secs, usd = estimate(segs)
    print(f"Grup: {order['group_name']} · {len(order['children'])} copii · pachet {order['package']}")
    for i, s in enumerate(segs, 1):
        print(f"\n[{i}] ({len(s.split())} cuvinte)\n{s}")
    print(f"\nDurată estimată: ~{secs:.0f} s · cost estimat: ~{usd:.2f} $.")
    if not a.run:
        print("Dry-run: nu s-a generat nimic. Adaugă --run --yes ca să generezi.")
        return
    if not a.yes:
        sys.exit("Costă bani: confirmă cu --yes.")
    if not os.environ.get("WAVESPEED_API_KEY"):
        sys.exit("Lipsește WAVESPEED_API_KEY în mediu.")
    print("Gata:", run(order, segs, os.path.join(a.out, order["id"])))


if __name__ == "__main__":
    main()
