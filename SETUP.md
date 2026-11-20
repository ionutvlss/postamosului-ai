# Configurare publicare automată

Platforma publică singură postările aprobate: Facebook Reels, Instagram Reels, YouTube Shorts și TikTok (în inbox).
Un job rulează la fiecare 5 minute și publică tot ce e „Programată” și are ora trecută.

> Nicio cheie nu se pune în cod sau în chat. Repo-ul este public.

## 1. Deploy automat Supabase (o singură dată)

În GitHub → repo `postamosului-ai` → **Settings → Secrets and variables → Actions → New repository secret**:

| Nume | De unde îl iei |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → avatar → **Account preferences → Access Tokens → Generate new token** |
| `SUPABASE_PROJECT_REF` | ID-ul proiectului: partea dintre `https://` și `.supabase.co` din URL-ul proiectului |

Apoi **Actions → „Deploy Supabase” → Run workflow**. Workflow-ul rulează migrarea din `supabase/migrations`
și publică toate Edge Functions. Rulează singur la fiecare push care modifică `supabase/`.

**Adresa de callback** (o folosești la pașii 2–4):

```
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/oauth-callback
```

## 2. Meta (Facebook + Instagram)

Înainte: Instagramul Poșta Moșului trebuie să fie **cont profesional (Business)** și **legat de Pagina de Facebook**.

1. developers.facebook.com → **My Apps → Create App**.
2. Use case: **„Manage everything on your Page”**; adaugă și **Instagram → „Manage messaging and content on Instagram” (API setup with Facebook login)**.
3. Leagă aplicația de Business Managerul în care e Pagina.
4. La **Facebook Login (for Business) → Settings → Valid OAuth Redirect URIs** pune adresa de callback.
5. Permisiuni folosite: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`, `instagram_basic`, `instagram_content_publish`.
   Dacă Meta îți cere o „Configuration” pentru Login for Business, creeaz-o cu aceste permisiuni și pune ID-ul ei în secretul `META_CONFIG_ID`.
6. Aplicația rămâne în **Development mode**. Fiind administratorul ei și al Paginii, nu ai nevoie de App Review.

Secrete în Supabase → **Edge Functions → Secrets**: `META_APP_ID`, `META_APP_SECRET` (din App settings → Basic), opțional `META_CONFIG_ID` și `META_PAGE_ID` (dacă ai mai multe Pagini).

## 3. YouTube

1. console.cloud.google.com → proiect nou „PostaMosului”.
2. **APIs & Services → Library → YouTube Data API v3 → Enable**.
3. **OAuth consent screen**: External, completează numele și emailul. Adaugă scope-urile `youtube.upload` și `youtube.readonly`.
   Apoi **Publish app** („In production”). În modul „Testing”, Google invalidează conectarea după 7 zile.
   Fără verificare, Google afișează un avertisment la conectare: apeși „Advanced → Continue”.
4. **Credentials → Create credentials → OAuth client ID → Web application**, cu redirect URI = adresa de callback.

Secrete în Supabase: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

Limitare Google: până treci [auditul YouTube API](https://support.google.com/youtube/contact/yt_api_form), clipurile urcate prin API rămân **private**.
Platforma le urcă oricum; le poți face publice manual din YouTube Studio.

## 4. TikTok

1. developers.tiktok.com → **Manage apps → Connect an app**.
2. Adaugă produsele **Login Kit** și **Content Posting API** (doar varianta Upload).
3. Scopes: `user.info.basic`, `video.upload`. Redirect URI (Login Kit → Web) = adresa de callback.
4. Cât aplicația e în **Sandbox**, adaugă-ți contul TikTok la **Target users**.

Secrete în Supabase: `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`.

Clipul ajunge în **inbox-ul TikTok** (notificare în aplicație). Îl deschizi, lipești textul din platformă și publici.
Postarea directă publică necesită auditul TikTok; până atunci TikTok le-ar publica doar privat.

## 5. Conectare și test

1. Platformă → **Conturi social → Conectează contul** pentru fiecare platformă.
2. **Media library** → încarcă un clip vertical (9:16, MP4).
3. **Automatizări → Programează următoarele 24h**.
4. **Calendar editorial** → „De aprobat” → **Publică acum** pe una dintre postări.

Dacă ceva eșuează, motivul apare sub postare, iar butonul „Reîncearcă” o reia.
