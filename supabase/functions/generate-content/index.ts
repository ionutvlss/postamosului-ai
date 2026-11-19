const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

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
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  let supabaseServiceRoleKey = Deno.env.get('POSTAMOSULUI_SUPABASE_ADMIN_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseServiceRoleKey) {
    try {
      const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
      supabaseServiceRoleKey = secretKeys.default || Object.values(secretKeys)[0] as string | undefined
    } catch { /* fallback to the user's JWT below */ }
  }
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  if (!authorization || !supabaseUrl || !supabaseAnonKey) return json({ error: 'Missing Supabase configuration' }, 500)
  const input = await request.json().catch(() => ({}))
  const prompt = String(input.prompt || '').trim()
  const platform = String(input.platform || 'instagram_reel')
  const tone = String(input.tone || 'cald și inspirațional')
  const variation = Number(input.variation || Date.now())
  if (!prompt) return json({ error: 'Promptul este obligatoriu' }, 400)
  const instruction = `Ești copywriter-ul brandului românesc PostaMoșului. Generează conținut pentru ${platform}. Ton: ${tone}. Brief: ${prompt}. Variația creativă este ${variation}. Răspunde exclusiv JSON valid cu cheile title, body și hashtags. hashtags trebuie să fie un array de 4-8 hashtag-uri fără explicații. Textul trebuie să fie natural, cald și potrivit pentru părinți.`
  if (geminiKey) {
    const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', { method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':geminiKey}, body:JSON.stringify({contents:[{parts:[{text:instruction}]}],generationConfig:{responseMimeType:'application/json',temperature:0.85}}) })
    const geminiPayload = await geminiResponse.json().catch(() => ({}))
    const geminiText = geminiPayload?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || '').join('') || ''
    if (geminiResponse.ok && geminiText) { try { return json({ ...JSON.parse(geminiText), platform, model:'gemini-2.5-flash' }) } catch { /* fallback below */ } }
  }
  if (!openAiKey) return json(fallbackContent(prompt, platform, tone, variation))

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseAnonKey, Authorization: authorization } })
  if (!userResponse.ok) return json({ error: 'Sesiunea administratorului este invalidă' }, 401)
  const user = await userResponse.json()
  const profileHeaders = supabaseServiceRoleKey
    ? { apikey: supabaseServiceRoleKey, Authorization: `Bearer ${supabaseServiceRoleKey}` }
    : { apikey: supabaseAnonKey, Authorization: authorization }
  const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&role=eq.admin&select=id&limit=1`, { headers: profileHeaders })
  const profileRows = await profileResponse.json().catch(() => [])
  if (!profileResponse.ok) {
    const details = typeof profileRows?.message === 'string' ? `: ${profileRows.message}` : ''
    return json({ error: `Verificarea profilului a eșuat (${profileResponse.status})${details}` }, 500)
  }
  if (profileRows.length === 0) return json({ error: `Profil admin negăsit pentru utilizatorul autentificat (${user.id})` }, 403)

  const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini'
  const aiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
    body: JSON.stringify({
      model,
      input: instruction,
    }),
  })
  const aiPayload = await aiResponse.json()
  if (!aiResponse.ok) return json(fallbackContent(prompt, platform, tone, variation))
  const rawText = aiPayload.output_text || aiPayload.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text || ''
  try {
    const parsed = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, '').trim())
    return json({ ...parsed, platform, model })
  } catch {
    return json({ title: 'Conținut generat', body: rawText, hashtags: [], platform, model })
  }
})
