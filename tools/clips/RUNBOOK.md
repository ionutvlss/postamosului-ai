# Rețeta zilnică: 2 reclame cu Moșul → coada de aprobare

Rulează o dată pe zi (dimineața). Rezultat: 2 clipuri de 10–15 s, fiecare pe TikTok, Facebook Reels,
Instagram Reels și YouTube Shorts, în „De aprobat”, la sloturile 1 și 2 ale zilei următoare libere.

## 0. Verificări înainte (în ordinea asta, înainte de orice cost)
1. **Butonul Start/Stop din platformă.** n8n, workflow `npH2gNtmpaCJXN5j`, `execute_workflow` manual, trigger „Primește clip”,
   body `{"action": "status"}`. Citește răspunsul nodului „Trimite în platformă” (`get_workflow_execution`, includeData).
   - `daily_enabled: false` → **oprește-te aici**: nu genera nimic, nu scrie nimic în jurnal, încheie cu o propoziție.
   - `daily_enabled: true` → continuă.
2. **Sold WaveSpeed ≥ 2 $** (`get_balance`). Dacă e mai mic: nu genera nimic; trimite în jurnal
   `{"action": "log_run", "status": "skipped", "summary": "Sold WaveSpeed X $ — încarcă minimum 10 $"}` și anunță-l pe Ioan.
3. Nu rula de două ori în aceeași zi: dacă `last_runs` din pasul 1 are deja `done` cu data de azi, oprește-te.
4. Clonează `ionutvlss/postamosului-ai` (main) și branch-ul `media`.

## 1. Alege scripturile
- Din `tools/clips/scripts.json`: 2 scripturi fără `used`, cu data de azi între `from` și `to`.
- Preferă unghiuri și stiluri diferite între cele două; scripturile cu fereastră scurtă (Moș Nicolae, Ajun) au prioritate.
- Dacă rămân sub 2 disponibile: scrie altele noi în același format (public: părinții; 25–35 de cuvinte;
  fără promisiuni false; fapte reale: de la 39 lei, gata de obicei în sub o oră, fără cont, fără poze,
  al doilea copil +15 lei, opțiunea de cadou cu livrare programată) și adaugă-le în bancă.

## 2. Vocea (WaveSpeed `elevenlabs/eleven-v3`)
- `voice_id: "Bill"`, `stability: 0.5`, `text` = câmpul `tts`.
- Descarcă mp3-ul și măsoară-l cu ffprobe. Ținta: 10–15,5 s. Dacă e mai lung, scurtează textul și regenerează o singură dată.

## 3. Avatarul (WaveSpeed `heygen/avatar-6/turbo`, ~0,06 $/s)
- `image`: `https://raw.githubusercontent.com/ionutvlss/postamosului-ai/media/avatar/mos-vertical.jpg`
- `audio`: URL-ul mp3 de la pasul 2, `resolution: "1080p"`
- `prompt`: „Warm, friendly Santa looking straight into the camera, natural expressions, gentle nod and a small inviting hand gesture at the end.”
- Dacă `run_model` dă eroare de rețea: verifică `list_predictions` înainte să retrimiți (nu plăti de două ori).

## 4. Editarea
```bash
python3 tools/clips/make_clip.py --video avatar.mp4 --spec spec.json --out clip.mp4
```
`spec.json` = `{lines, kicker, hook, highlight, style, end_title}` din script (+ `cta`, `cta_sub`, `button` din `defaults`). Stilul vizual (premium, editorial) e fix în `make_clip.py` și `brand.py`; nu adăuga benzi colorate, emoji sau majuscule în hook.
Verifică 3 cadre (0,5 s, mijloc, final): text lizibil, nu acoperă fața, CTA la final.

Alternativ, dacă sunt credite OpusClip: AI Producer (`start_project_from_attachment` cu URL-ul avatarului → `build_captions` → `start_export`).

## 5. Găzduire și trimitere
- Pune clipul în branch-ul `media`, la `clipuri/AAAA-LL-ZZ-<id>.mp4`, și fă push.
  URL: `https://raw.githubusercontent.com/ionutvlss/postamosului-ai/media/clipuri/<fișier>`
- n8n, workflow `npH2gNtmpaCJXN5j` („PostaMoșului AI · Trimite clip spre aprobare”), `execute_workflow` în modul manual,
  trigger „Primește clip”, body:
```json
{
  "video_url": "<URL>", "name": "<fișier>", "title": "<title>",
  "captions": {
    "default": "<caption>\n\nLink în bio.",
    "facebook": "<caption>\n\npostamosului.ro",
    "youtube": "<caption>\n\nComandă pe postamosului.ro"
  },
  "hashtags": ["…defaults.hashtags"],
  "platforms": ["tiktok", "facebook", "instagram", "youtube"],
  "slot_index": 0,
  "ingest_id": "AAAA-LL-ZZ-<id>",
  "source": "claude-daily",
  "hook": "<hook fără * și |, cu | înlocuit de spațiu>", "script": "<lines unite>", "duration_seconds": 13
}
```
  Primul clip: `slot_index: 0`. Al doilea: `slot_index: 1`. Verifică răspunsul: 4 postări create.

## 6. Final
- Marchează scripturile folosite (`"used": "AAAA-LL-ZZ"`) în `scripts.json` și fă commit pe main.
- Jurnal în platformă (apare în Automatizări → Ultimele rulări): `{"action": "log_run", "status": "done",
  "summary": "2 clipuri: <hook 1> · <hook 2> — programate <zi> 12:30 și 19:30", "cost_usd": <cost>}`.
  La orice eroare care oprește rularea: `"status": "failed"` cu motivul pe scurt.
- Dacă ingest-ul răspunde 409 („Automatizarea zilnică este oprită”), Ioan a apăsat Stop între timp: nu mai trimite nimic.
- Raport scurt pentru Ioan: cele 2 hook-uri, ora la care sunt programate, costul (vocea + avatarul) și soldul rămas.

## 7. Grupurile de Facebook (5 postări pe zi, postate manual de Ioan)
**Întâi campaniile:** dacă un fișier din `tools/clips/campaigns/` are `groups["AAAA-LL-ZZ"]` pentru azi (fără `"done": true`),
folosește exact acele texte și media (`video_url` = câmpul `media`, `platforms: []`, `ingest_id: "AAAA-LL-ZZ-campanie-grupuri"`,
`group_posts: {"texts": [...]}`), apoi marchează ziua cu `"done": true` și sari peste restul pasului 7.

Alternanță: **zilele pare = clip** (unul dintre clipurile zilei), **zilele impare = imagine AI**.

**Textele (5, toate diferite):** 50–110 cuvinte, ton de părinte pentru părinți, nu de reclamă. Încep cu ceva util
sau personal (o idee de surpriză, o întrebare), produsul vine natural la mijloc, iar linkul `postamosului.ro` la final.
Fără majuscule în exces, maximum 2 emoji, fără hashtag-uri. Fiecare text cu alt început și altă structură.

**Ziua cu clip:** la apelul n8n pentru primul clip adaugă `"group_posts": {"texts": [5 texte]}`. Aceleași postări
sociale + 5 ciorne pentru grupuri, cu același clip.

**Ziua cu imagine:**
1. Fundal nou (variație de scenă), WaveSpeed: un model de editare de imagine cu referința
   `.../media/avatar/mos-vertical.jpg` (ex. Moșul la birou cu scrisori, lângă brad, cu o tabletă, în atelier),
   format portret. Max. ~0,05 $.
2. `python3 tools/clips/make_poster.py --template editorial|invitation --image fundal.jpg --kicker "<etichetă>" --title "<titlu cu *accent* și |>" --out poster.jpg` (alternează șabloanele de la o zi la alta)
3. Pune-l în branch-ul `media`, la `postere/AAAA-LL-ZZ.jpg`.
4. n8n, cu `"platforms": []`, `"name": "AAAA-LL-ZZ-poster.jpg"`, `"title"`, `"ingest_id": "AAAA-LL-ZZ-grupuri"` și `"group_posts": {"texts": [5 texte]}`.

Platforma alege singură cele 5 grupuri (cele mai de mult nefolosite, niciunul de două ori în 6 zile) și le pune în
„Grupuri Facebook → De postat azi”. Dacă sunt mai puține grupuri disponibile, creează doar câte încap.
