import { adminClient, aiErrors, aiJson, corsHeaders, HttpError, json, requireAdmin } from '../_shared/common.ts'

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

const GROUP_OPENINGS = ['o întrebare către părinți', 'o prezentare scurtă: cine ești și ce faci', 'o mică poveste sau situație de Crăciun', 'un sfat util pentru surprizele de sărbători', 'direct la subiect, ca un anunț curat']

function groupsPrompt(brief: string, groupType: string, length: string, voice: string, opening: string) {
  const words = length === 'scurt' ? '40-60' : '70-100'
  return `Scrii postări pentru grupuri de Facebook, din partea lui Ioan, fondatorul Poșta Moșului (persoană reală, vorbește la persoana I). ${FACTS}
Tipul grupului: ${GROUP_STYLE[groupType] || GROUP_STYLE.general}. Accent opțional: ${brief || 'prezentare generală'}.
Scrie O SINGURĂ postare de ${words} de cuvinte, care începe cu ${opening}. Scopul: încredere + să înțeleagă în 5 secunde ce oferim.
Fiecare postare: spune cine scrie (Ioan, de la Poșta Moșului), ce este produsul într-o propoziție simplă, cum merge (pe scurt: completezi, Moșul face clipul, îl primești pe email),
un detaliu care dă încredere (fără poze cu copilul / fără cont / datele șterse după 30 de zile / pot asculta gratuit numele), prețul, apoi linkul postamosului.ro la final.
Ton de om, nu de reclamă: fără majuscule, fără hashtag-uri, maximum 2 emoji, fără presiune agresivă, NU te prezenta drept client sau părinte care a cumpărat.
Răspunde DOAR JSON: {"angle":"2-4 cuvinte","text":"postarea completă, cu rânduri noi \\n"}${voice ? `\nVocea brandului: ${voice}` : ''}`
}

const clean = (s: unknown, max = 2000) => String(s ?? '').trim().slice(0, max)
/** Găsește lista din răspuns oricum ar numi-o modelul (variants / posts / items / prima listă). */
const listOf = (r: Record<string, unknown> | null, key: string) => {
  if (!r) return [] as Record<string, unknown>[]
  const v = r[key] ?? r.items ?? Object.values(r).find(Array.isArray)
  return (Array.isArray(v) ? v : []).map(x => typeof x === 'string' ? { text: x, body: x } : x) as Record<string, unknown>[]
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed')
    // Întâi verificăm administratorul: nimeni altcineva nu consumă din cheile AI.
    // Test automat (din diagnostic, cu secretul cron): rulează ca primul administrator.
    let ownerId: string
    const cronSecret = request.headers.get('x-cron-secret')
    if (cronSecret) {
      const { data: ok } = await adminClient().rpc('check_publisher_secret', { candidate: cronSecret })
      if (!ok) throw new HttpError(401, 'Secret cron invalid')
      const { data: admin } = await adminClient().from('profiles').select('id').eq('role', 'admin').order('created_at', { ascending: true }).limit(1).maybeSingle()
      if (!admin) throw new HttpError(500, 'Nu există administrator')
      ownerId = admin.id
    } else ownerId = await requireAdmin(request)
    const { data: settings } = await adminClient().from('automation_settings').select('brand_voice').eq('owner_id', ownerId).maybeSingle()
    const voice = clean(settings?.brand_voice, 300)
    const input = await request.json().catch(() => ({}))
    const mode = input.mode === 'groups' ? 'groups' : 'social'
    const brief = clean(input.prompt, 1500)
    if (mode === 'social' && !brief) throw new HttpError(400, 'Scrie ideea sau alege una din sugestii')

    if (mode === 'groups') {
      // 5 postări în paralel (câte una pe apel): răspuns în câteva secunde, nu un singur apel lung.
      const results = await Promise.all(GROUP_OPENINGS.map(o => aiJson(groupsPrompt(brief, clean(input.group_type, 20), clean(input.length, 10), voice, o), 0.95, { fast: true })))
      const result = results.find(Boolean) || null
      const posts = results.flatMap(r => r ? (typeof r.text === 'string' ? [r] : listOf(r, 'posts')) : [])
        .map(p => ({ angle: clean(p.angle, 40), text: clean(p.text ?? p.body ?? p.post, 1500) })).filter(p => p.text)
      if (!posts.length) throw new HttpError(502, result ? 'AI-ul a răspuns într-un format neașteptat. Încearcă din nou.' : `Niciun model AI nu a răspuns: ${aiErrors.join(' | ') || 'fără detalii'}`)
      return json({ mode, posts, model: result?._model })
    }

    const platform = clean(input.platform || 'all', 40)
    const tone = clean(input.tone || 'cald, dar orientat spre vânzare', 80)
    const result = await aiJson(socialPrompt(brief, platform, tone, voice), 0.9, { fast: true })
    const variants = listOf(result, 'variants').map(v => ({
      angle: clean(v.angle, 40), hook: clean(v.hook, 90), title: clean(v.title ?? v.hook, 100), body: clean(v.body ?? v.caption ?? v.text, 1200),
      hashtags: (Array.isArray(v.hashtags) ? v.hashtags : []).map(h => clean(h, 40)).filter(Boolean).slice(0, 8),
    })).filter(v => v.body)
    if (!variants.length) throw new HttpError(502, result ? 'AI-ul a răspuns într-un format neașteptat. Încearcă din nou.' : `Niciun model AI nu a răspuns: ${aiErrors.join(' | ') || 'fără detalii'}`)
    // compatibilitate: primele câmpuri ca înainte (title/body/hashtags) pentru orice apelant vechi
    return json({ mode, platform, variants, title: variants[0].title, body: variants[0].body, hashtags: variants[0].hashtags, model: result?._model })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    return json({ error: (error as Error).message }, status)
  }
})
