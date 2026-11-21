import { adminClient, aiJson, corsHeaders, HttpError, json, requireAdmin } from '../_shared/common.ts'

// Faptele pe care textele au voie să le folosească (nimic inventat în afara lor).
const FACTS = `Produsul: videoclip personalizat de la Moș Crăciun, în care Moșul îi vorbește copilului pe nume, despre ce a reușit, ce îi place și ce își dorește.
Fapte reale (folosește doar acestea): de la 39 lei; al doilea copil +15 lei în același videoclip; formularul durează ~3 minute; gata de obicei în sub o oră, pe email;
fără cont; fără poze cu copilul; datele se șterg după 30 de zile; plată cu cardul, Apple Pay sau Google Pay; opțiune de cadou cu livrare programată
(ex. dimineața de Crăciun la 8:00), bună pentru nași și bunici; pe site se poate asculta gratuit cum pronunță Moșul numele copilului. Site: postamosului.ro.
Nu inventa reduceri, termene, recenzii, cifre de clienți sau garanții.`

const PLATFORM_LABEL: Record<string, string> = {
  all: 'TikTok, Instagram Reels, Facebook Reels și YouTube Shorts', tiktok_video: 'TikTok', instagram_reel: 'Instagram Reels',
  facebook_reel: 'Facebook Reels', youtube_short: 'YouTube Shorts',
}

const GROUP_STYLE: Record<string, string> = {
  mamici: 'grup de mămici și părinți (comunitate, conversație)',
  vanzari: 'grup de vânzări / anunțuri (mami vinde, mami cumpără) – direct, ca un anunț curat',
  oras: 'grup local de părinți dintr-un oraș',
  general: 'grup general de părinți',
}

function socialPrompt(brief: string, platform: string, tone: string, voice: string) {
  return `Ești copywriter de performance pentru brandul românesc Poșta Moșului. ${FACTS}
Scrie 3 variante DIFERITE de postare pentru ${PLATFORM_LABEL[platform] || platform}, cu unghiul: ${brief}. Ton: ${tone}.
Reguli de vânzare: din primul rând se înțelege ce vindem (videoclip de la Moș Crăciun, cu numele copilului); beneficiu concret + preț sau viteză;
un îndemn clar la final („Comandă în 3 minute”). Fără clișee goale, fără majuscule excesive, maximum 2 emoji pe variantă.
Răspunde DOAR JSON: {"variants":[{"angle":"2-4 cuvinte","hook":"text pe ecran, max 8 cuvinte","title":"titlu YouTube, max 70 caractere","body":"caption 2-4 rânduri scurte","hashtags":["#PostaMosului", "...4-6 total"]}]}${voice ? `\nVocea brandului: ${voice}` : ''}`
}

function groupsPrompt(brief: string, groupType: string, length: string, voice: string) {
  const words = length === 'scurt' ? '45-70' : '80-120'
  return `Scrii postări pentru grupuri de Facebook, din partea lui Ioan, fondatorul Poșta Moșului (persoană reală, vorbește la persoana I). ${FACTS}
Tipul grupului: ${GROUP_STYLE[groupType] || GROUP_STYLE.general}. Accent opțional: ${brief || 'prezentare generală'}.
Scrie 5 postări DIFERITE (alt început, altă structură), fiecare ${words} de cuvinte. Scopul: încredere + să înțeleagă în 5 secunde ce oferim.
Fiecare postare: spune cine scrie (Ioan, de la Poșta Moșului), ce este produsul într-o propoziție simplă, cum merge (pe scurt: completezi, Moșul face clipul, îl primești pe email),
un detaliu care dă încredere (fără poze cu copilul / fără cont / datele șterse după 30 de zile / pot asculta gratuit numele), prețul, apoi linkul postamosului.ro la final.
Ton de om, nu de reclamă: fără majuscule, fără hashtag-uri, maximum 2 emoji, fără presiune agresivă, NU te prezenta drept client sau părinte care a cumpărat.
Răspunde DOAR JSON: {"posts":[{"angle":"2-4 cuvinte","text":"postarea completă cu rânduri noi \\n"}]}${voice ? `\nVocea brandului: ${voice}` : ''}`
}

const clean = (s: unknown, max = 2000) => String(s ?? '').trim().slice(0, max)

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed')
    // Întâi verificăm administratorul: nimeni altcineva nu consumă din cheile AI.
    const ownerId = await requireAdmin(request)
    const { data: settings } = await adminClient().from('automation_settings').select('brand_voice').eq('owner_id', ownerId).maybeSingle()
    const voice = clean(settings?.brand_voice, 300)
    const input = await request.json().catch(() => ({}))
    const mode = input.mode === 'groups' ? 'groups' : 'social'
    const brief = clean(input.prompt, 1500)
    if (mode === 'social' && !brief) throw new HttpError(400, 'Scrie ideea sau alege una din sugestii')

    if (mode === 'groups') {
      const result = await aiJson(groupsPrompt(brief, clean(input.group_type, 20), clean(input.length, 10), voice), 0.9, { fast: true })
      const posts = Array.isArray(result?.posts) ? (result!.posts as Record<string, unknown>[])
        .map(p => ({ angle: clean(p.angle, 40), text: clean(p.text, 1500) })).filter(p => p.text) : []
      if (!posts.length) throw new HttpError(502, 'AI-ul nu a răspuns. Încearcă din nou.')
      return json({ mode, posts, model: result?._model })
    }

    const platform = clean(input.platform || 'all', 40)
    const tone = clean(input.tone || 'cald, dar orientat spre vânzare', 80)
    const result = await aiJson(socialPrompt(brief, platform, tone, voice), 0.9, { fast: true })
    const variants = Array.isArray(result?.variants) ? (result!.variants as Record<string, unknown>[]).map(v => ({
      angle: clean(v.angle, 40), hook: clean(v.hook, 90), title: clean(v.title, 100), body: clean(v.body, 1200),
      hashtags: (Array.isArray(v.hashtags) ? v.hashtags : []).map(h => clean(h, 40)).filter(Boolean).slice(0, 8),
    })).filter(v => v.body) : []
    if (!variants.length) throw new HttpError(502, 'AI-ul nu a răspuns. Încearcă din nou.')
    // compatibilitate: primele câmpuri ca înainte (title/body/hashtags) pentru orice apelant vechi
    return json({ mode, platform, variants, title: variants[0].title, body: variants[0].body, hashtags: variants[0].hashtags, model: result?._model })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    return json({ error: (error as Error).message }, status)
  }
})
