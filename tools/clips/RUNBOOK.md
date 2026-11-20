# Rețeta zilnică: 2 reclame cu Moșul → coada de aprobare

Rulează o dată pe zi (dimineața). Rezultat: 2 clipuri de 10–15 s, fiecare pe TikTok, Facebook Reels,
Instagram Reels și YouTube Shorts, în „De aprobat”, la sloturile 1 și 2 ale zilei următoare libere.

## 0. Verificări înainte
- Sold WaveSpeed ≥ 2 $ (`get_balance`). Dacă e mai mic: nu genera nimic, anunță-l pe Ioan să încarce.
- Clonează `ionutvlss/postamosului-ai` (main) și branch-ul `media`.

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
`spec.json` = `{lines, hook, highlight, style}` din script (+ `cta`, `cta_sub` din `defaults`).
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
    "default": "<caption> Link în bio 🎄",
    "facebook": "<caption> 👉 postamosului.ro",
    "youtube": "<caption> Comandă pe postamosului.ro"
  },
  "hashtags": ["…defaults.hashtags"],
  "platforms": ["tiktok", "facebook", "instagram", "youtube"],
  "slot_index": 0,
  "ingest_id": "AAAA-LL-ZZ-<id>",
  "source": "claude-daily",
  "hook": "<hook>", "script": "<lines unite>", "duration_seconds": 13
}
```
  Primul clip: `slot_index: 0`. Al doilea: `slot_index: 1`. Verifică răspunsul: 4 postări create.

## 6. Final
- Marchează scripturile folosite (`"used": "AAAA-LL-ZZ"`) în `scripts.json` și fă commit pe main.
- Raport scurt pentru Ioan: cele 2 hook-uri, ora la care sunt programate, costul (vocea + avatarul) și soldul rămas.
