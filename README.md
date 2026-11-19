# PostaMoșului AI

Dashboard pentru automatizarea conținutului PostaMoșului pe Instagram, Facebook și YouTube.

## Rulare locală

```bash
npm install
npm run dev
```

Copiază `.env.example` în `.env.local` și completează valorile Supabase. Fișierul `.env.local` este ignorat de Git și nu trebuie urcat pe GitHub.

## Build

```bash
npm run build
```

## Supabase

- `supabase/schema.sql` — schema inițială, RLS și Storage
- `supabase/phase2_automation.sql` — programări, variante AI, grupuri și comentarii
- `supabase/functions/generate-content/index.ts` — generare server-side prin OpenAI Responses API

## OpenAI Edge Function

Deploy-ul funcției se face cu Supabase CLI din rădăcina proiectului:

```bash
supabase functions deploy generate-content
supabase secrets set OPENAI_API_KEY=cheia-ta OPENAI_MODEL=gpt-4.1-mini
```

Cheia OpenAI rămâne în secrets Supabase și nu se adaugă în `.env.local` sau GitHub.
