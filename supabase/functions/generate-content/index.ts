const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (!authorization || !supabaseUrl || !supabaseAnonKey) return json({ error: 'Missing Supabase configuration' }, 500)
  if (!openAiKey) return json({ error: 'OPENAI_API_KEY nu este configurat în Edge Function Secrets' }, 503)

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseAnonKey, Authorization: authorization } })
  if (!userResponse.ok) return json({ error: 'Sesiunea administratorului este invalidă' }, 401)
  const user = await userResponse.json()
  const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&role=eq.admin&select=id&limit=1`, { headers: { apikey: supabaseAnonKey, Authorization: authorization } })
  if (!profileResponse.ok || (await profileResponse.json()).length === 0) return json({ error: 'Acces permis doar administratorilor' }, 403)

  const input = await request.json().catch(() => ({}))
  const prompt = String(input.prompt || '').trim()
  const platform = String(input.platform || 'instagram')
  const tone = String(input.tone || 'cald și inspirațional')
  if (!prompt) return json({ error: 'Promptul este obligatoriu' }, 400)

  const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini'
  const aiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
    body: JSON.stringify({
      model,
      input: `Ești copywriter-ul brandului românesc PostaMoșului. Generează conținut pentru ${platform}. Ton: ${tone}. Brief: ${prompt}. Răspunde exclusiv JSON valid cu cheile title, body și hashtags. hashtags trebuie să fie un array de 4-8 hashtag-uri fără explicații. Textul trebuie să fie natural, cald și potrivit pentru părinți.`,
    }),
  })
  const aiPayload = await aiResponse.json()
  if (!aiResponse.ok) return json({ error: aiPayload?.error?.message || 'OpenAI request failed' }, 502)
  const rawText = aiPayload.output_text || aiPayload.output?.flatMap((item: any) => item.content || []).find((item: any) => item.type === 'output_text')?.text || ''
  try {
    const parsed = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, '').trim())
    return json({ ...parsed, platform, model })
  } catch {
    return json({ title: 'Conținut generat', body: rawText, hashtags: [], platform, model })
  }
})
