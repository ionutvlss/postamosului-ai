import { aiJson, corsHeaders, HttpError, json, requireAdmin } from '../_shared/common.ts'

const fallbackContent = (prompt: string, platform: string, tone: string, variation = 0) => {
  const cleanPrompt = prompt.replace(/\s+/g, ' ').trim()
  const shortPrompt = cleanPrompt.length > 120 ? `${cleanPrompt.slice(0, 117)}...` : cleanPrompt
  const platformLabel = platform.includes('youtube') || platform.includes('short') ? 'YouTube Shorts' : platform.includes('facebook') ? 'Facebook' : 'Instagram Reels'
  const angles = [
    ['O idee care aduce magia mai aproape', 'Amintește-ți că cele mai frumoase momente se construiesc împreună, pas cu pas.'],
    ['Un moment de păstrat în suflet', 'Transformă o clipă simplă într-o amintire pe care familia o va păstra mult timp.'],
    ['Hai să facem sărbătorile memorabile', 'Comunitatea părinților merită idei calde, sincere și ușor de transformat în bucurie.'],
  ][Math.abs(variation) % 3]
  return {
    title: `${angles[0]} · ${shortPrompt.slice(0, 42)}`,
    body: `${angles[1]} ${shortPrompt}. Creat pentru ${platformLabel}, într-un ton ${tone}. Spune-ne în comentarii ce ai alege pentru familia ta.`,
    hashtags: ['#PostaMosului', '#PentruParinti', '#MagiaSarbatorilor', '#Familie', variation % 2 ? '#IdeiPentruCopii' : '#CraciunRomanesc'],
    platform,
    tone,
    model: 'fallback-local',
    fallback: true,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed')
    // Întâi verificăm administratorul: nimeni altcineva nu consumă din cheile AI.
    await requireAdmin(request)
    const input = await request.json().catch(() => ({}))
    const prompt = String(input.prompt || '').trim().slice(0, 2000)
    const platform = String(input.platform || 'instagram_reel').slice(0, 40)
    const tone = String(input.tone || 'cald și inspirațional').slice(0, 80)
    const variation = Number(input.variation || Date.now())
    if (!prompt) throw new HttpError(400, 'Promptul este obligatoriu')
    const instruction = `Ești copywriter-ul brandului românesc Poșta Moșului. Generează conținut pentru ${platform}. Ton: ${tone}. Brief: ${prompt}. Variația creativă este ${variation}. Răspunde exclusiv JSON valid cu cheile title, body și hashtags. hashtags trebuie să fie un array de 4-8 hashtag-uri fără explicații. Textul trebuie să fie natural, elegant, cald și potrivit pentru părinți, fără emoji în exces.`
    const result = await aiJson(instruction, 0.85)
    if (!result) return json(fallbackContent(prompt, platform, tone, variation))
    const { _model, ...content } = result
    return json({ ...content, platform, model: _model })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    return json({ error: (error as Error).message }, status)
  }
})
