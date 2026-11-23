#!/usr/bin/env python3
"""Rularea zilnică fără Claude (GitHub Actions): 2 clipuri cu Moșul → coada de aprobare + grupurile de Facebook.

Urmează RUNBOOK.md cu regula zilei:
  - clipurile sunt pentru ziua curentă (sloturile 12:30 = slot 0 și 19:30 = slot 1);
  - grupuri: zi pară = afiș nou (make_poster.py), zi impară = fără imagine, textele merg pe primul clip.

Secrete (doar din env, nu se afișează niciodată): WAVESPEED_API_KEY, GEMINI_API_KEY, INGEST_SECRET.
Rulează din rădăcina repo-ului, cu branch-ul `media` deschis ca worktree la MEDIA_DIR.
"""
import datetime as dt, json, os, random, re, subprocess, sys, tempfile, time, urllib.error, urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(ROOT, "..", ".."))
MEDIA_DIR = os.environ.get("MEDIA_DIR", os.path.join(REPO, "..", "media"))
RAW = "https://raw.githubusercontent.com/ionutvlss/postamosului-ai/media/"
INGEST_URL = "https://kpjerjzajizzyexissbv.supabase.co/functions/v1/ingest-video"
WS = "https://api.wavespeed.ai/api/v3/"
AVATAR = RAW + "avatar/mos-vertical.jpg"
AVATAR_PROMPT = "Warm, friendly Santa looking straight into the camera, natural expressions, gentle nod and a small inviting hand gesture at the end."
TEST = os.environ.get("TEST_MODE") == "1"
TODAY = dt.datetime.now(ZoneInfo("Europe/Bucharest")).date()
DAY = TODAY.isoformat()
cost = 0.0


def log(msg):
    print(msg, flush=True)


def http(url, body=None, headers=None, method=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data else "GET"),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}


def download(url, path):
    for attempt in range(3):
        try:
            urllib.request.urlretrieve(url, path)
            return path
        except Exception as e:
            log(f"descărcare reîncercată ({e.__class__.__name__})")
            time.sleep(5)
    raise RuntimeError("Nu am putut descărca un fișier generat")


# ---------- platforma ----------
def ingest(body):
    return http(INGEST_URL, body, {"x-ingest-secret": os.environ["INGEST_SECRET"]}, timeout=180)


def log_run(status, summary, cost_usd=None):
    if TEST:
        log(f"[test] jurnal: {status} · {summary}")
        return
    body = {"action": "log_run", "status": status, "summary": summary[:1000]}
    if cost_usd is not None:
        body["cost_usd"] = round(cost_usd, 2)
    code, _ = ingest(body)
    log(f"jurnal: {status} ({code})")


# ---------- WaveSpeed ----------
def ws_headers():
    return {"Authorization": "Bearer " + os.environ["WAVESPEED_API_KEY"]}


def ws_balance():
    code, res = http(WS + "balance", headers=ws_headers())
    try:
        return float(res["data"]["balance"])
    except Exception:
        return None


def ws_run(model, inputs, wait=900):
    code, res = http(WS + model, inputs, ws_headers())
    pid = (res.get("data") or {}).get("id")
    if not pid:
        raise RuntimeError(f"WaveSpeed {model}: cerere refuzată ({code}) {str(res.get('message', ''))[:160]}")
    deadline = time.time() + wait
    while time.time() < deadline:
        time.sleep(6)
        code, res = http(WS + f"predictions/{pid}/result", headers=ws_headers())
        data = res.get("data") or {}
        if data.get("status") == "completed" and data.get("outputs"):
            return data["outputs"][0]
        if data.get("status") == "failed":
            raise RuntimeError(f"WaveSpeed {model}: {str(data.get('error', ''))[:200]}")
    raise RuntimeError(f"WaveSpeed {model}: a durat prea mult")


# ---------- Gemini ----------
def gemini_json(prompt, temperature=0.9):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("lipsește GEMINI_API_KEY")
    models = [m for m in [os.environ.get("GEMINI_MODEL"), "gemini-3.5-flash", "gemini-3.8-flash"] if m]
    last = ""
    for model in models:
        code, res = http(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                         {"contents": [{"role": "user", "parts": [{"text": prompt}]}],
                          "generationConfig": {"temperature": temperature, "responseMimeType": "application/json"}},
                         {"x-goog-api-key": key}, timeout=120)
        try:
            text = res["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text)
        except Exception:
            last = f"{model}: {code}"
    raise RuntimeError("Gemini nu a răspuns (" + last + ")")


FACTS = ("Produsul: videoclip personalizat în care Moș Crăciun vorbește copilului pe nume, despre anul lui și dorința de Crăciun. "
         "Fapte reale (doar acestea): de la 39 lei (30 s), 59 lei (60 s), 79 lei (90 s); al doilea copil +15 lei; gata de obicei în sub o oră, "
         "pe email; fără cont și fără poze cu copilul; opțiune de cadou cu livrare programată; site: postamosului.ro. "
         "Publicul: PĂRINȚII, niciodată copiii. Fără promisiuni false, fără clienți sau recenzii inventate.")


def new_scripts(bank, n):
    examples = [{k: s[k] for k in ("hook", "tts", "lines", "highlight", "title", "caption", "kicker", "end_title")} for s in bank[-3:]]
    used_ids = [s["id"] for s in bank]
    out = gemini_json(
        f"Scrii reclame scurte (10-15 secunde) în română, rostite de Moș Crăciun, pentru Poșta Moșului. {FACTS}\n"
        f"Scrie {n} scripturi NOI, cu unghiuri diferite între ele și față de acestea (id-uri existente: {used_ids}).\n"
        "Reguli: 'tts' are 25-35 de cuvinte, cu indicații ElevenLabs între paranteze drepte ([warmly], [short pause]); "
        "din primele 2 secunde se înțelege produsul; se încheie cu un îndemn clar (ex. „De la 39 de lei, pe Poșta Moșului”). "
        "'lines' = același text fără indicații, împărțit în 3-5 rânduri. 'highlight' = 2-4 cuvinte exact cum apar în lines (cu punctuație). "
        "'hook' și 'end_title' folosesc *accent* pentru partea italic aurie și | pentru rând nou; fără majuscule în exces, fără emoji. "
        "'caption' începe cu rândul de produs (ca în exemple), ton editorial. 'kicker' = 2-3 cuvinte. 'id' = slug scurt cu cratime. "
        "'angle' = un cuvânt.\nExemple de format:\n" + json.dumps(examples, ensure_ascii=False) +
        '\nRăspunde doar cu JSON: {"scripts": [{"id","angle","hook","tts","lines","highlight","title","caption","kicker","end_title"}]}')
    scripts = []
    for s in out.get("scripts", [])[:n]:
        if not all(s.get(k) for k in ("id", "tts", "lines", "hook", "caption")):
            continue
        s["id"] = re.sub(r"[^a-z0-9-]", "", s["id"].lower())[:40] or f"auto-{random.randint(100, 999)}"
        while s["id"] in used_ids:
            s["id"] += "-2"
        s.update({"from": DAY, "to": "2026-12-24", "style": random.choice(["editorial", "serif"]), "source": "auto"})
        scripts.append(s)
    return scripts


def group_texts(media_kind):
    out = gemini_json(
        f"Scrii 5 postări pentru grupuri de Facebook de părinți din România, despre Poșta Moșului. {FACTS}\n"
        f"Postarea are atașat {'un afiș' if media_kind == 'poster' else 'un clip scurt cu Moșul'}.\n"
        "Reguli: fiecare text are 50-110 cuvinte, ton cald și firesc, nu de reclamă. Începe cu ceva util (o idee de surpriză, o întrebare "
        "pentru părinți), produsul vine natural la mijloc, iar linkul postamosului.ro la final. Autorul NU se prezintă ca părinte sau client "
        "și nu povestește experiențe inventate; nu inventa clienți, cifre sau recenzii. Majuscule normale la început de propoziție, maximum 2 emoji, "
        "fără hashtag-uri. Fiecare text are alt început și altă structură.\n"
        'Răspunde doar cu JSON: {"texts": ["...", "...", "...", "...", "..."]}', temperature=1.0)
    texts = [str(t).strip() for t in out.get("texts", []) if str(t).strip()]
    if len(texts) < 3:
        raise RuntimeError("Gemini a dat prea puține texte pentru grupuri")
    return texts[:5]


def poster_copy(old_titles):
    out = gemini_json(
        f"Scrii titlul unui afiș pentru Poșta Moșului. {FACTS}\n"
        f"Titlu NOU, diferit de acestea: {old_titles[-12:]}.\n"
        "Format: 5-9 cuvinte, cu | pentru rând nou (o singură dată) și *accent* pe partea a doua (italic auriu). "
        "'kicker' = etichetă de 2-4 cuvinte (ex. „Cadoul de Crăciun”). Fără emoji, fără majuscule în exces.\n"
        'Răspunde doar cu JSON: {"title": "...", "kicker": "..."}')
    title = str(out.get("title", "")).strip()
    if not title or title in old_titles:
        raise RuntimeError("titlu de afiș invalid")
    return title, str(out.get("kicker", "Cadoul de Crăciun")).strip()[:40]


# ---------- producție ----------
def duration(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                       capture_output=True, text=True)
    return float(r.stdout.strip() or 0)


def make_clip(script, defaults, work):
    global cost
    tts = script["tts"]
    for attempt in range(2):
        audio_url = ws_run("elevenlabs/eleven-v3", {"text": tts, "voice_id": "Bill", "stability": 0.5}, wait=300)
        cost += 0.2
        secs = duration(download(audio_url, os.path.join(work, script["id"] + ".mp3")))
        log(f"{script['id']}: voce {secs:.1f} s")
        if secs <= 15.5 or attempt:
            break
        try:  # prea lung: scurtează o singură dată
            short = gemini_json("Scurtează acest text rostit de Moș Crăciun la maximum 28 de cuvinte, păstrând indicațiile între "
                                "paranteze drepte, produsul și îndemnul final. Răspunde doar cu JSON: "
                                '{"tts": "...", "lines": ["3-5 rânduri, fără indicații"]}\n' + tts)
            tts, script["tts"], script["lines"] = short["tts"], short["tts"], short["lines"]
        except Exception as e:
            log(f"nu am putut scurta textul ({e}); păstrez vocea")
            break
    video_url = ws_run("heygen/avatar-6/turbo", {"image": AVATAR, "audio": audio_url, "resolution": "1080p", "prompt": AVATAR_PROMPT}, wait=1500)
    cost += 0.06 * secs
    avatar = download(video_url, os.path.join(work, script["id"] + "-avatar.mp4"))
    spec = {k: script[k] for k in ("lines", "kicker", "hook", "highlight", "style", "end_title") if k in script}
    spec.update({k: defaults[k] for k in ("cta", "cta_sub", "button") if k in defaults})
    spec_path = os.path.join(work, script["id"] + ".json")
    json.dump(spec, open(spec_path, "w"), ensure_ascii=False)
    out = os.path.join(work, f"{DAY}-{script['id']}.mp4")
    subprocess.run([sys.executable, os.path.join(ROOT, "make_clip.py"), "--video", avatar, "--spec", spec_path, "--out", out], check=True)
    if duration(out) < 8:
        raise RuntimeError(f"clipul {script['id']} a ieșit prea scurt")
    return out, secs


def git(*args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True)


def main():
    global cost
    for k in ("WAVESPEED_API_KEY", "INGEST_SECRET"):
        if not os.environ.get(k):
            sys.exit(f"Lipsește secretul {k} în GitHub (Settings → Secrets and variables → Actions).")

    # 0. Verificări
    code, st = ingest({"action": "status"})
    if code != 200:
        sys.exit(f"Platforma nu răspunde la status ({code}). Verifică secretul INGEST_SECRET.")
    if not st.get("daily_enabled") and not TEST:
        log("Automatizarea zilnică e oprită din platformă. Nu generez nimic.")
        return
    if not TEST and any(r.get("status") == "done" and str(r.get("created_at", "")).startswith(DAY) for r in st.get("last_runs", [])):
        log("Există deja o rulare reușită azi. Mă opresc.")
        return
    bal = ws_balance()
    if bal is not None and bal < 2:
        log_run("skipped", f"Sold WaveSpeed {bal:.2f} $ — încarcă minimum 10 $")
        sys.exit(f"Sold WaveSpeed prea mic: {bal:.2f} $")

    bank_path = os.path.join(ROOT, "scripts.json")
    bank = json.load(open(bank_path))
    scripts, defaults = bank["scripts"], bank["defaults"]
    posted = bank.setdefault("posted_creatives", [])

    # 1. Scripturile: întâi banca (fereastra cea mai scurtă primul), apoi Gemini dacă nu ajung
    n = 1 if TEST else 2
    free = sorted([s for s in scripts if not s.get("used") and s.get("from", DAY) <= DAY <= s.get("to", DAY)],
                  key=lambda s: (s.get("to", "9999"), s["id"]))
    chosen = []
    for s in free:
        if len(chosen) < n and (not chosen or s.get("style") != chosen[0].get("style") or len(free) <= n):
            chosen.append(s)
    for s in free:
        if len(chosen) < n and s not in chosen:
            chosen.append(s)
    if len(chosen) < n:
        fresh = new_scripts(scripts, n - len(chosen))
        scripts.extend(fresh)
        chosen.extend(fresh)
        log(f"scripturi noi scrise cu Gemini: {[s['id'] for s in fresh]}")
    if len(chosen) < n:
        raise RuntimeError("Nu am scripturi disponibile pentru azi")

    work = tempfile.mkdtemp(prefix="clipuri-")
    clips = []
    for s in chosen:
        path, secs = make_clip(s, defaults, work)
        clips.append((s, path, secs))

    # 2. Grupurile (campanie > afiș în zi pară > clip în zi impară)
    group_note, poster_file, poster_meta, texts, campaign_media = "", None, None, None, None
    for name in sorted(os.listdir(os.path.join(ROOT, "campaigns"))):
        cpath = os.path.join(ROOT, "campaigns", name)
        camp = json.load(open(cpath))
        entry = (camp.get("groups") or {}).get(DAY)
        if entry and not entry.get("done"):
            texts, campaign_media = entry["texts"], entry["media"]
            if not TEST:
                entry["done"] = True
                json.dump(camp, open(cpath, "w"), ensure_ascii=False, indent=2)
            group_note = f"grupuri: campania {name}"
            break
    if texts is None:
        try:
            if TODAY.day % 2 == 0:
                titles = [p.get("title") for p in posted if p.get("kind") == "poster"]
                title, kicker = poster_copy(titles)
                scenes = sorted(f for f in os.listdir(os.path.join(MEDIA_DIR, "scene")) if f.endswith((".png", ".jpg")) and "card" not in f)
                last_used = {}
                for p in posted:
                    if p.get("scene"):
                        last_used[p["scene"]] = p["date"]
                scene = min(scenes, key=lambda f: (last_used.get("scene/" + f, ""), f))
                last_tpl = next((p.get("template") for p in reversed(posted) if p.get("kind") == "poster"), "invitation")
                template = "invitation" if last_tpl == "editorial" else "editorial"
                poster_file = os.path.join(work, f"{DAY}.jpg")
                subprocess.run([sys.executable, os.path.join(ROOT, "make_poster.py"), "--template", template,
                                "--image", os.path.join(MEDIA_DIR, "scene", scene), "--kicker", kicker, "--title", title,
                                "--out", poster_file], check=True)
                texts = group_texts("poster")
                poster_meta = {"date": DAY, "kind": "poster", "template": template, "scene": "scene/" + scene, "title": title, "note": "rulare GitHub"}
                group_note = "grupuri: afiș nou (zi pară)"
            else:
                texts = group_texts("clip")
                group_note = "grupuri: primul clip (zi impară)"
        except Exception as e:
            texts, poster_file = None, None
            group_note = f"grupuri: nu s-au putut genera ({str(e)[:120]})"
            log(group_note)

    # 3. Găzduire pe branch-ul media
    sub = "test/" if TEST else ""
    for s, path, _ in clips:
        dest = os.path.join(MEDIA_DIR, sub + "clipuri")
        os.makedirs(dest, exist_ok=True)
        subprocess.run(["cp", path, dest], check=True)
    if poster_file:
        os.makedirs(os.path.join(MEDIA_DIR, sub + "postere"), exist_ok=True)
        subprocess.run(["cp", poster_file, os.path.join(MEDIA_DIR, sub + "postere", f"{DAY}.jpg")], check=True)
    git("add", "-A", cwd=MEDIA_DIR)
    git("commit", "-q", "-m", f"{'Test' if TEST else 'Clipuri zilnice'} {DAY} (GitHub)", cwd=MEDIA_DIR)
    git("push", "-q", "origin", "HEAD:media", cwd=MEDIA_DIR)

    if TEST:
        log("TEST reușit. Fișiere: " + ", ".join(RAW + "test/clipuri/" + os.path.basename(p) for _, p, _ in clips))
        log(f"cost estimat: {cost:.2f} $")
        return

    time.sleep(20)  # raw.githubusercontent are nevoie de câteva secunde după push
    hooks = []
    for i, (s, path, secs) in enumerate(clips):
        name = os.path.basename(path)
        hook = re.sub(r"\s+", " ", s["hook"].replace("*", "").replace("|", " ")).strip()
        body = {
            "video_url": RAW + "clipuri/" + name, "name": name, "title": s.get("title", hook),
            "captions": {"default": s["caption"] + "\n\nLink în bio.", "facebook": s["caption"] + "\n\npostamosului.ro",
                         "youtube": s["caption"] + "\n\nComandă pe postamosului.ro"},
            "hashtags": defaults["hashtags"], "platforms": ["tiktok", "facebook", "instagram", "youtube"],
            "slot_index": i, "ingest_id": f"{DAY}-{s['id']}", "source": "github-daily",
            "hook": hook, "script": " ".join(s["lines"]), "duration_seconds": round(secs + 3),
        }
        if i == 0 and texts and not poster_file:
            body["group_posts"] = {"texts": texts}
            if campaign_media:
                body.pop("group_posts")
        code, res = ingest(body)
        if code == 409:
            log_run("skipped", "Automatizarea a fost oprită din platformă în timpul rulării")
            return
        if code != 200:
            raise RuntimeError(f"ingest {name}: {code} {str(res.get('error', ''))[:160]}")
        log(f"{name}: {len(res.get('posts', []))} postări create")
        s["used"] = DAY
        posted.append({"date": DAY, "kind": "clip", "script": s["id"], "style": s.get("style"),
                       "note": f"rulare GitHub, slot {'12:30' if i == 0 else '19:30'}"})
        hooks.append(hook)

    if campaign_media:
        ingest({"video_url": campaign_media, "name": os.path.basename(campaign_media), "title": "Campanie grupuri",
                "platforms": [], "ingest_id": f"{DAY}-campanie-grupuri", "source": "github-daily", "group_posts": {"texts": texts}})
    elif poster_file and texts:
        code, res = ingest({"video_url": RAW + f"postere/{DAY}.jpg", "name": f"{DAY}-poster.jpg", "title": poster_meta["title"].replace("*", "").replace("|", " "),
                            "platforms": [], "ingest_id": f"{DAY}-grupuri", "source": "github-daily", "group_posts": {"texts": texts}})
        log(f"afiș grupuri: {code}")
        posted.append(poster_meta)

    if texts:
        md = f"# Grupuri {DAY}\n\n" + "\n\n---\n\n".join(texts) + "\n"
        os.makedirs(os.path.join(ROOT, "grupuri"), exist_ok=True)
        open(os.path.join(ROOT, "grupuri", f"{DAY}.md"), "w").write(md)
    json.dump(bank, open(bank_path, "w"), ensure_ascii=False, indent=2)
    open(bank_path, "a").write("\n")
    git("add", "-A", "tools/clips", cwd=REPO)
    git("commit", "-q", "-m", f"Clipuri zilnice {DAY}: {', '.join(s['id'] for s, _, _ in clips)} (GitHub) [skip ci]", cwd=REPO)
    git("push", "-q", "origin", "HEAD:main", cwd=REPO)

    bal = ws_balance()
    summary = f"2 clipuri: {' · '.join(hooks)} — programate azi 12:30 și 19:30; {group_note}; cost ~{cost:.2f} $" + (f", sold WaveSpeed {bal:.2f} $" if bal is not None else "")
    log_run("done", summary, cost)
    log(summary)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        log(f"EROARE: {e}")
        try:
            log_run("failed", f"Rularea GitHub a eșuat: {str(e)[:300]}", cost or None)
        except Exception:
            pass
        sys.exit(1)
