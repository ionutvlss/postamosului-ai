#!/usr/bin/env python3
"""Generare automată pentru comenzile de grup PLĂTITE (rulează din GitHub Actions, la 5 minute).

Ia o comandă plătită de pe site, generează vocea și videoclipul, le încarcă în spațiul privat și o trece pe
„De verificat”. Ioan ascultă în /admin-grupuri și apasă „Aprobă și trimite clientului”: nimic nu pleacă la client automat.

Secrete (doar din mediu, nu se afișează): SITE_URL, AUTOMATION_SHARED_SECRET, WAVESPEED_API_KEY.
"""
import json, os, sys, tempfile, traceback, urllib.error, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from daily_run import ws_balance  # noqa: E402
from group_video import build_segments, estimate, run  # noqa: E402

UA = "postamosului-group-job/1.0"


def site(body):
    url = os.environ["SITE_URL"].rstrip("/") + "/api/public/group-jobs"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": UA,
                                          "x-automation-secret": os.environ["AUTOMATION_SHARED_SECRET"]})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"site {body['action']}: HTTP {e.code}")


def put_file(url, path, content_type):
    with open(path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(url, data=data, method="PUT",
                                 headers={"Content-Type": content_type, "x-upsert": "true", "cache-control": "max-age=3600", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=600) as r:
        if r.status >= 300:
            raise RuntimeError(f"încărcare eșuată: HTTP {r.status}")


def main():
    for k in ("SITE_URL", "AUTOMATION_SHARED_SECRET", "WAVESPEED_API_KEY"):
        if not os.environ.get(k):
            sys.exit(f"Lipsește {k} din mediu (secret GitHub).")
    order = site({"action": "claim"}).get("order")
    if not order:
        print("Nicio comandă de grup de generat.")
        return
    oid = order["id"]
    print(f"Comandă {oid}: {order['group_name']} ({len(order['children'])} copii)")
    try:
        segs = build_segments(order)
        secs, usd = estimate(segs)
        balance = ws_balance()
        if balance is None or balance < usd * 1.3:
            raise RuntimeError(f"Sold WaveSpeed insuficient ({balance} $; necesar ~{usd * 1.3:.1f} $). Încarcă credit și apasă Regenerează.")
        work = tempfile.mkdtemp(prefix="grup_")
        final, voice = run(order, segs, work)
        urls = site({"action": "upload_urls", "id": oid})
        put_file(urls["voice_upload_url"], voice, "audio/mpeg")
        put_file(urls["video_upload_url"], final, "video/mp4")
        site({"action": "complete", "id": oid})
        print("Gata: de verificat în /admin-grupuri.")
    except BaseException as e:  # noqa: BLE001
        traceback.print_exc()
        msg = str(e)[:300] or e.__class__.__name__
        try:
            site({"action": "fail", "id": oid, "message": msg})
        except Exception:
            print("Nu am putut raporta eșecul la site.")
        sys.exit(1)


if __name__ == "__main__":
    main()
