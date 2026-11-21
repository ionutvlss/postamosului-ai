// Comentarii: le aduce de pe Facebook, Instagram și YouTube (la 10 minute, prin cron), scrie un răspuns cu AI
// și, după modul ales în Setări, îl trimite singur sau îl lasă la aprobare. Tot aici se trimit răspunsurile aprobate.
import { adminClient, aiJson, corsHeaders, env, fetchJson, GRAPH, HttpError, json, requireAdmin } from '../_shared/common.ts'

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
  const parsed = await aiJson(prompt, 0.6)
  if (!parsed) return { sentiment: 'other', safe: false, reply: '' }
  return { sentiment: String(parsed.sentiment || 'other'), safe: parsed.safe_to_auto === true, reply: String(parsed.reply || '').slice(0, 900) }
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

// Vizualizări, aprecieri și comentarii pentru clipurile publicate (ultimele 60 de zile), actualizate cel mult o dată la 2 ore pe postare.
async function syncStats() {
  const out: Record<string, number> = { updated: 0, errors: 0 }
  const { data: accounts } = await db().from('social_accounts').select('*').in('platform', ['facebook', 'instagram', 'youtube']).eq('status', 'connected')
  const stale = new Date(Date.now() - 2 * 3600_000).toISOString()
  for (const acc of (accounts || []) as Account[]) {
    let accessToken: string
    try { accessToken = await token(acc) } catch { out.errors++; continue }
    if (acc.platform !== 'youtube') {
      try {
        const dbg = await fetchJson(`${GRAPH}/debug_token?${new URLSearchParams({ input_token: accessToken, access_token: `${env('META_APP_ID')}|${env('META_APP_SECRET')}` })}`)
        await db().from('social_accounts').update({ metadata: { ...(acc.metadata || {}), granted_scopes: dbg.data?.scopes || [], token_type: dbg.data?.type || null } }).eq('id', acc.id)
      } catch (e) { console.error('debug_token', (e as Error).message) }
      // Sondă temporară: care apeluri de statistici merg cu tokenul actual (pentru depanare).
      const probe: Record<string, string> = {}
      const sample = (await db().from('posts').select('external_post_id').eq('platform', acc.platform).eq('status', 'published').not('external_post_id', 'is', null).order('published_at', { ascending: false }).limit(1)).data?.[0]?.external_post_id
      const tries: [string, string][] = acc.platform === 'instagram'
        ? [['reach', `${sample}/insights?metric=reach`], ['plays', `${sample}/insights?metric=ig_reels_aggregated_all_plays_count`], ['account', `${acc.external_account_id}/insights?metric=reach&period=day`]]
        : [['vi_all', `${sample}/video_insights`], ['views_field', `${sample}?fields=views,length`], ['page', `${acc.external_account_id}/insights?metric=page_impressions_unique&period=day`]]
      for (const [k, path] of tries) {
        try { const r = await fetchJson(`${GRAPH}/${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(accessToken)}`); probe[k] = 'OK ' + JSON.stringify(r).slice(0, 160) }
        catch (e) { probe[k] = 'ERR ' + (e as Error).message.slice(0, 160) }
      }
      const { data: fresh } = await db().from('social_accounts').select('metadata').eq('id', acc.id).maybeSingle()
      await db().from('social_accounts').update({ metadata: { ...(fresh?.metadata || {}), stats_probe: probe } }).eq('id', acc.id)
    }
    const { data: rows } = await db().from('posts').select('id, external_post_id, metadata').eq('owner_id', acc.owner_id).eq('platform', acc.platform)
      .eq('status', 'published').not('external_post_id', 'is', null).gte('published_at', new Date(Date.now() - 60 * 86400000).toISOString()).limit(80)
    const due = (rows || []).filter(r => !r.metadata?.stats?.at || r.metadata.stats.at < stale || r.metadata.stats.note).slice(0, 25)
    if (!due.length) continue
    const results = new Map<string, Record<string, unknown>>()
    if (acc.platform === 'youtube') {
      try {
        const r = await fetchJson(`https://www.googleapis.com/youtube/v3/videos?${new URLSearchParams({ part: 'statistics', id: due.map(d => d.external_post_id).join(',') })}`,
          { headers: { Authorization: `Bearer ${accessToken}` } })
        for (const v of r.items || []) results.set(v.id, { views: Number(v.statistics?.viewCount || 0), likes: Number(v.statistics?.likeCount || 0), comments: Number(v.statistics?.commentCount || 0) })
      } catch (e) { for (const d of due) results.set(d.external_post_id, { note: (e as Error).message.slice(0, 160) }) }
    } else {
      for (const d of due) {
        const id = d.external_post_id
        const stat: Record<string, unknown> = {}
        try {
          if (acc.platform === 'instagram') {
            const m = await fetchJson(`${GRAPH}/${id}?${new URLSearchParams({ fields: 'like_count,comments_count', access_token: accessToken })}`)
            stat.likes = Number(m.like_count || 0); stat.comments = Number(m.comments_count || 0)
            try {
              const ins = await fetchJson(`${GRAPH}/${id}/insights?${new URLSearchParams({ metric: 'views', access_token: accessToken })}`)
              stat.views = Number(ins.data?.find((x: any) => x.name === 'views')?.values?.[0]?.value ?? 0)
            } catch (e) { stat.note = `Vizualizările Instagram cer permisiunea „instagram_manage_insights”: reconectează Meta [${(e as Error).message.slice(0, 140)}]` }
          } else {
            const m = await fetchJson(`${GRAPH}/${id}?${new URLSearchParams({ fields: 'likes.summary(true).limit(0),comments.summary(true).limit(0)', access_token: accessToken })}`)
            stat.likes = Number(m.likes?.summary?.total_count || 0); stat.comments = Number(m.comments?.summary?.total_count || 0)
            try {
              const ins = await fetchJson(`${GRAPH}/${id}/video_insights?${new URLSearchParams({ metric: 'blue_reels_play_count', access_token: accessToken })}`)
              stat.views = Number(ins.data?.[0]?.values?.[0]?.value ?? 0)
            } catch (e) { stat.note = `Vizualizările Facebook cer permisiunea „read_insights”: reconectează Meta [${(e as Error).message.slice(0, 140)}]` }
          }
        } catch (e) { stat.note = (e as Error).message.slice(0, 160) }
        results.set(id, stat)
      }
    }
    for (const d of due) {
      const stat = results.get(d.external_post_id) || { note: 'Clipul nu a fost găsit (poate a fost șters)' }
      const prev = d.metadata?.stats || {}
      await db().from('posts').update({ metadata: { ...(d.metadata || {}), stats: { ...prev, ...stat, at: new Date().toISOString() } } }).eq('id', d.id)
      if (stat.note) out.errors++; else out.updated++
    }
  }
  return out
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const cronSecret = request.headers.get('x-cron-secret')
    if (cronSecret) {
      const { data: ok } = await db().rpc('check_publisher_secret', { candidate: cronSecret })
      if (!ok) throw new HttpError(401, 'Secret cron invalid')
      const comments = await sync()
      const stats = await syncStats().catch(e => ({ error: (e as Error).message }))
      return json({ ...comments, stats })
    }
    const ownerId = await requireAdmin(request)
    const input = await request.json().catch(() => ({}))
    if (input.action === 'sync') return json(await sync())
    if (input.action === 'stats') return json(await syncStats())
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
