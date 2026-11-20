// Comentarii: le aduce de pe Facebook, Instagram și YouTube (la 10 minute, prin cron), scrie un răspuns cu AI
// și, după modul ales în Setări, îl trimite singur sau îl lasă la aprobare. Tot aici se trimit răspunsurile aprobate.
import { adminClient, corsHeaders, env, fetchJson, GRAPH, HttpError, json, requireAdmin } from '../_shared/common.ts'

type Platform = 'facebook' | 'instagram' | 'youtube'
type Account = { id: string; owner_id: string; platform: Platform; external_account_id: string; account_name: string; metadata: Record<string, any> }
const db = () => adminClient()

const BRAND = `Ești echipa „Poșta Moșului” (postamosului.ro) și răspunzi la comentarii pe rețelele sociale, în română.
Fapte (nu inventa altele):
- Videoclip personalizat în care Moș Crăciun îi vorbește copilului pe nume: realizările din anul acesta, familia, prietenii, dorința de Crăciun.
- Pachete: 30 s – 39 lei, 60 s – 59 lei, 90 s – 79 lei. Al doilea copil în același videoclip: +15 lei.
- Se comandă pe postamosului.ro, fără cont, plată cu cardul / Apple Pay / Google Pay. Videoclipul vine pe email, de obicei în sub o oră.
- Nu cerem poze cu copilul. Detaliile despre copil se șterg la 30 de zile după livrare.
- Opțiune „Este un cadou”: videoclipul ajunge la părinți la data aleasă (ex. dimineața de Crăciun, 8:00).
- Videoclipul e realizat cu ajutorul tehnologiei (AI), cu vocea și chipul Moșului; spune adevărul dacă te întreabă.
Reguli: 1–2 propoziții, cald, natural, maximum un emoji. Fără promisiuni în afara faptelor de mai sus. Nu da sfaturi medicale/juridice.
La critici sau probleme cu o comandă: empatie scurtă și invitație la contact@postamosului.ro. Nu te certa niciodată.`

async function ai(platform: string, author: string, text: string) {
  const prompt = `${BRAND}

Comentariu pe ${platform}, de la ${author || 'un utilizator'}:
"""${text.slice(0, 1500)}"""

Răspunde DOAR cu JSON: {"sentiment":"positive|question|negative|spam|other","safe_to_auto":true|false,"reply":"..."}
safe_to_auto = true doar pentru laude simple sau întrebări la care faptele de mai sus răspund complet. Spam/insulte: reply gol.`
  const key = env('GEMINI_API_KEY')
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.6 } }),
  })
  const payload = await res.json().catch(() => ({}))
  const out = payload?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || ''
  try {
    const parsed = JSON.parse(out)
    return { sentiment: String(parsed.sentiment || 'other'), safe: parsed.safe_to_auto === true, reply: String(parsed.reply || '').slice(0, 900) }
  } catch {
    return { sentiment: 'other', safe: false, reply: '' }
  }
}

async function token(acc: Account) {
  const { data } = await db().from('social_tokens').select('*').eq('account_id', acc.id).maybeSingle()
  if (!data?.access_token) throw new Error(`Lipsește tokenul pentru ${acc.platform}`)
  if (acc.platform !== 'youtube') return data.access_token as string
  if (data.expires_at && new Date(data.expires_at).getTime() > Date.now() + 60_000) return data.access_token as string
  const fresh = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: data.refresh_token, grant_type: 'refresh_token' }),
  })
  await db().from('social_tokens').update({ access_token: fresh.access_token, expires_at: new Date(Date.now() + (fresh.expires_in - 60) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('account_id', acc.id)
  return fresh.access_token as string
}

type Fetched = { id: string; author: string; text: string; parentPost: string }

async function fetchComments(acc: Account, accessToken: string, externalPostId: string): Promise<Fetched[]> {
  if (acc.platform === 'facebook') {
    const r = await fetchJson(`${GRAPH}/${externalPostId}/comments?${new URLSearchParams({ fields: 'id,message,from{id,name}', filter: 'toplevel', order: 'reverse_chronological', limit: '50', access_token: accessToken })}`)
    return (r.data || []).filter((c: any) => c.message && c.from?.id !== acc.external_account_id)
      .map((c: any) => ({ id: c.id, author: c.from?.name || '', text: c.message, parentPost: externalPostId }))
  }
  if (acc.platform === 'instagram') {
    const r = await fetchJson(`${GRAPH}/${externalPostId}/comments?${new URLSearchParams({ fields: 'id,text,username', limit: '50', access_token: accessToken })}`)
    const own = String(acc.account_name || '').replace(/^@/, '')
    return (r.data || []).filter((c: any) => c.text && c.username !== own)
      .map((c: any) => ({ id: c.id, author: c.username || '', text: c.text, parentPost: externalPostId }))
  }
  const r = await fetchJson(`https://www.googleapis.com/youtube/v3/commentThreads?${new URLSearchParams({ part: 'snippet', videoId: externalPostId, maxResults: '50', order: 'time', textFormat: 'plainText' })}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  return (r.items || []).filter((t: any) => t.snippet?.topLevelComment?.snippet?.authorChannelId?.value !== acc.external_account_id)
    .map((t: any) => ({ id: t.snippet.topLevelComment.id, author: t.snippet.topLevelComment.snippet.authorDisplayName || '', text: t.snippet.topLevelComment.snippet.textDisplay || '', parentPost: externalPostId }))
}

async function sendReply(acc: Account, accessToken: string, commentId: string, text: string) {
  if (acc.platform === 'facebook') {
    const r = await fetchJson(`${GRAPH}/${commentId}/comments`, { method: 'POST', body: new URLSearchParams({ message: text, access_token: accessToken }) })
    return r.id as string
  }
  if (acc.platform === 'instagram') {
    const r = await fetchJson(`${GRAPH}/${commentId}/replies`, { method: 'POST', body: new URLSearchParams({ message: text, access_token: accessToken }) })
    return r.id as string
  }
  const r = await fetchJson('https://www.googleapis.com/youtube/v3/comments?part=snippet', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ snippet: { parentId: commentId, textOriginal: text } }),
  })
  return r.id as string
}

async function sync() {
  const { data: accounts } = await db().from('social_accounts').select('*').in('platform', ['facebook', 'instagram', 'youtube']).eq('status', 'connected')
  const summary: Record<string, number> = { new: 0, auto_sent: 0, errors: 0 }
  for (const acc of (accounts || []) as Account[]) {
    const { data: settings } = await db().from('automation_settings').select('comments_mode').eq('owner_id', acc.owner_id).maybeSingle()
    const mode = settings?.comments_mode || 'approve'
    if (mode === 'off') continue
    let accessToken: string
    try { accessToken = await token(acc) } catch { summary.errors++; continue }
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data: posts } = await db().from('posts').select('id, external_post_id').eq('owner_id', acc.owner_id).eq('platform', acc.platform)
      .eq('status', 'published').not('external_post_id', 'is', null).gte('published_at', since).limit(40)
    for (const post of posts || []) {
      let comments: Fetched[] = []
      try { comments = await fetchComments(acc, accessToken, post.external_post_id) } catch (e) { console.error('comments fetch', acc.platform, (e as Error).message); summary.errors++; continue }
      if (!comments.length) continue
      const { data: known } = await db().from('comment_threads').select('external_comment_id').eq('owner_id', acc.owner_id).eq('platform', acc.platform).in('external_comment_id', comments.map(c => c.id))
      const seen = new Set((known || []).map(k => k.external_comment_id))
      for (const c of comments.filter(x => !seen.has(x.id)).slice(0, 20)) {
        const draft = await ai(acc.platform, c.author, c.text)
        const auto = mode === 'auto_safe' && draft.safe && draft.reply && ['positive', 'question'].includes(draft.sentiment)
        const row: Record<string, unknown> = {
          owner_id: acc.owner_id, platform: acc.platform, external_comment_id: c.id, external_post_id: c.parentPost, post_id: post.id,
          author_name: c.author.slice(0, 120), comment_body: c.text.slice(0, 4000), sentiment: draft.sentiment, reply_draft: draft.reply,
          reply_status: draft.sentiment === 'spam' ? 'ignored' : 'unreviewed', metadata: { safe_to_auto: draft.safe },
        }
        if (auto) {
          try { row.metadata = { safe_to_auto: true, reply_id: await sendReply(acc, accessToken, c.id, draft.reply), auto: true }; row.reply_status = 'sent'; row.replied_at = new Date().toISOString(); summary.auto_sent++ }
          catch (e) { row.last_error = (e as Error).message.slice(0, 300) }
        }
        await db().from('comment_threads').upsert(row, { onConflict: 'owner_id,platform,external_comment_id', ignoreDuplicates: true })
        summary.new++
      }
    }
  }
  return summary
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const cronSecret = request.headers.get('x-cron-secret')
    if (cronSecret) {
      const { data: ok } = await db().rpc('check_publisher_secret', { candidate: cronSecret })
      if (!ok) throw new HttpError(401, 'Secret cron invalid')
      return json(await sync())
    }
    const ownerId = await requireAdmin(request)
    const input = await request.json().catch(() => ({}))
    if (input.action === 'sync') return json(await sync())
    if (input.action === 'redraft') {
      const { data: row } = await db().from('comment_threads').select('*').eq('id', input.id).eq('owner_id', ownerId).maybeSingle()
      if (!row) throw new HttpError(404, 'Comentariul nu există')
      const draft = await ai(row.platform, row.author_name, row.comment_body)
      await db().from('comment_threads').update({ reply_draft: draft.reply, sentiment: draft.sentiment, updated_at: new Date().toISOString() }).eq('id', row.id)
      return json({ reply: draft.reply })
    }
    if (input.action === 'send') {
      const text = String(input.text || '').trim().slice(0, 900)
      if (!text) throw new HttpError(400, 'Răspunsul e gol')
      const { data: row } = await db().from('comment_threads').select('*').eq('id', input.id).eq('owner_id', ownerId).maybeSingle()
      if (!row) throw new HttpError(404, 'Comentariul nu există')
      if (row.reply_status === 'sent') throw new HttpError(409, 'Ai răspuns deja la acest comentariu')
      const { data: acc } = await db().from('social_accounts').select('*').eq('owner_id', ownerId).eq('platform', row.platform).eq('status', 'connected').maybeSingle()
      if (!acc) throw new HttpError(400, `Contul ${row.platform} nu este conectat`)
      try {
        const replyId = await sendReply(acc as Account, await token(acc as Account), row.external_comment_id, text)
        await db().from('comment_threads').update({ reply_draft: text, reply_status: 'sent', replied_at: new Date().toISOString(), last_error: null, metadata: { ...(row.metadata || {}), reply_id: replyId }, updated_at: new Date().toISOString() }).eq('id', row.id)
        return json({ sent: true })
      } catch (e) {
        await db().from('comment_threads').update({ reply_status: 'failed', last_error: (e as Error).message.slice(0, 300) }).eq('id', row.id)
        throw e
      }
    }
    throw new HttpError(400, 'Acțiune necunoscută')
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    return json({ error: (error as Error).message }, status)
  }
})
