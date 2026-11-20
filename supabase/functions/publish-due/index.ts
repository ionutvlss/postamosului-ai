// Publică postările aprobate a căror oră a venit. Rulează la 5 minute (pg_cron)
// sau manual din platformă („Publică acum”).
import { adminClient, corsHeaders, env, fetchJson, GRAPH, HttpError, json, requireAdmin } from '../_shared/common.ts'

type Post = {
  id: string; owner_id: string; platform: 'facebook' | 'instagram' | 'youtube' | 'tiktok'
  title: string; body: string | null; hashtags: string[] | null; media_id: string | null
  status: string; metadata: Record<string, any>; attempts: number
}
type Account = { id: string; external_account_id: string; account_name: string }
type Token = { access_token: string; refresh_token: string | null; expires_at: string | null; extra: Record<string, any> }
type Result = { done: true; externalId: string; url?: string; note?: string } | { done: false; metadata: Record<string, any> }

const db = () => adminClient()

function caption(post: Post, max = 2200) {
  const tags = (post.hashtags || []).filter(Boolean).map(t => (t.startsWith('#') ? t : `#${t}`)).join(' ')
  return [post.body?.trim() || post.title, tags].filter(Boolean).join('\n\n').slice(0, max)
}

async function account(post: Post): Promise<{ account: Account; token: Token }> {
  const { data: acc } = await db().from('social_accounts').select('id,external_account_id,account_name')
    .eq('owner_id', post.owner_id).eq('platform', post.platform).eq('status', 'connected').maybeSingle()
  if (!acc) throw new Error(`Contul ${post.platform} nu este conectat`)
  const { data: token } = await db().from('social_tokens').select('*').eq('account_id', acc.id).maybeSingle()
  if (!token?.access_token) throw new Error(`Lipsește tokenul pentru ${post.platform}. Reconectează contul.`)
  return { account: acc, token }
}

async function mediaUrl(post: Post) {
  if (!post.media_id) return null
  const { data: asset } = await db().from('media_assets').select('storage_path,size_bytes,mime_type').eq('id', post.media_id).maybeSingle()
  if (!asset) throw new Error('Videoclipul postării nu mai există în Media library')
  const { data, error } = await db().storage.from('media').createSignedUrl(asset.storage_path, 6 * 3600)
  if (error || !data?.signedUrl) throw new Error('Nu am putut crea linkul către videoclip')
  return { url: data.signedUrl, size: asset.size_bytes as number | null, mime: (asset.mime_type as string) || 'video/mp4' }
}

async function downloadVideo(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Descărcarea videoclipului a eșuat (${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}

async function saveToken(accountId: string, patch: Partial<Token>) {
  await db().from('social_tokens').update({ ...patch, updated_at: new Date().toISOString() }).eq('account_id', accountId)
}

// ---------- Facebook ----------
async function publishFacebook(post: Post): Promise<Result> {
  const { account: acc, token } = await account(post)
  const pageId = acc.external_account_id
  const media = await mediaUrl(post)
  if (!media) {
    const created = await fetchJson(`${GRAPH}/${pageId}/feed`, {
      method: 'POST', body: new URLSearchParams({ message: caption(post), access_token: token.access_token }),
    })
    return { done: true, externalId: created.id, url: `https://www.facebook.com/${created.id}` }
  }
  const start = await fetchJson(`${GRAPH}/${pageId}/video_reels`, {
    method: 'POST', body: new URLSearchParams({ upload_phase: 'start', access_token: token.access_token }),
  })
  const upload = await fetch(`https://rupload.facebook.com/video-upload/v23.0/${start.video_id}`, {
    method: 'POST', headers: { Authorization: `OAuth ${token.access_token}`, file_url: media.url },
  })
  const uploaded = await upload.json().catch(() => ({}))
  if (!upload.ok || uploaded?.success === false) throw new Error(uploaded?.debug_info?.message || `Încărcarea pe Facebook a eșuat (${upload.status})`)
  await fetchJson(`${GRAPH}/${pageId}/video_reels`, {
    method: 'POST',
    body: new URLSearchParams({
      upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED',
      description: caption(post), access_token: token.access_token,
    }),
  })
  return { done: true, externalId: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` }
}

// ---------- Instagram (în doi pași: container → publicare după procesare) ----------
async function publishInstagram(post: Post): Promise<Result> {
  const { account: acc, token } = await account(post)
  const igId = acc.external_account_id
  let container = post.metadata?.ig_container as string | undefined
  if (!container) {
    const media = await mediaUrl(post)
    if (!media) throw new Error('Instagram are nevoie de un videoclip')
    const created = await fetchJson(`${GRAPH}/${igId}/media`, {
      method: 'POST',
      body: new URLSearchParams({
        media_type: 'REELS', video_url: media.url, caption: caption(post), share_to_feed: 'true', access_token: token.access_token,
      }),
    })
    container = created.id as string
  }
  const status = await fetchJson(`${GRAPH}/${container}?${new URLSearchParams({ fields: 'status_code,status', access_token: token.access_token })}`)
  if (status.status_code === 'IN_PROGRESS') {
    return { done: false, metadata: { ...post.metadata, ig_container: container } }
  }
  if (status.status_code !== 'FINISHED') throw new Error(`Instagram a respins videoclipul: ${status.status || status.status_code}`)
  const published = await fetchJson(`${GRAPH}/${igId}/media_publish`, {
    method: 'POST', body: new URLSearchParams({ creation_id: container, access_token: token.access_token }),
  })
  let url: string | undefined
  try {
    const info = await fetchJson(`${GRAPH}/${published.id}?${new URLSearchParams({ fields: 'permalink', access_token: token.access_token })}`)
    url = info.permalink
  } catch { /* opțional */ }
  return { done: true, externalId: published.id, url }
}

// ---------- YouTube ----------
async function youtubeToken(acc: Account, token: Token) {
  if (token.expires_at && new Date(token.expires_at).getTime() > Date.now() + 60_000) return token.access_token
  if (!token.refresh_token) throw new Error('YouTube: lipsește refresh token. Reconectează canalul.')
  const fresh = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: token.refresh_token, grant_type: 'refresh_token',
    }),
  })
  await saveToken(acc.id, { access_token: fresh.access_token, expires_at: new Date(Date.now() + (fresh.expires_in - 60) * 1000).toISOString() })
  return fresh.access_token as string
}

async function publishYoutube(post: Post): Promise<Result> {
  const { account: acc, token } = await account(post)
  const media = await mediaUrl(post)
  if (!media) throw new Error('YouTube are nevoie de un videoclip')
  const accessToken = await youtubeToken(acc, token)
  const bytes = await downloadVideo(media.url)
  const title = (post.title || 'Poșta Moșului').replace(/[<>]/g, '').slice(0, 95)
  const description = `${caption(post, 4800)}\n\n#Shorts`
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': media.mime, 'X-Upload-Content-Length': String(bytes.byteLength),
    },
    body: JSON.stringify({
      snippet: { title, description, tags: (post.hashtags || []).map(t => t.replace(/^#/, '')).slice(0, 15), categoryId: '22', defaultLanguage: 'ro' },
      status: { privacyStatus: 'public', containsSyntheticMedia: true },
    }),
  })
  const location = init.headers.get('Location')
  if (!init.ok || !location) throw new Error(`YouTube a refuzat încărcarea: ${(await init.text()).slice(0, 300)}`)
  const upload = await fetch(location, { method: 'PUT', headers: { 'Content-Type': media.mime }, body: bytes })
  const video = await upload.json().catch(() => ({}))
  if (!upload.ok || !video.id) throw new Error(video?.error?.message || `Încărcarea pe YouTube a eșuat (${upload.status})`)
  const note = video.status?.privacyStatus === 'private' ? 'YouTube l-a urcat ca privat (aplicația nu e încă auditată)' : undefined
  return { done: true, externalId: video.id, url: `https://youtube.com/shorts/${video.id}`, note }
}

// ---------- TikTok (trimis în inbox-ul aplicației; publici tu din TikTok) ----------
async function tiktokToken(acc: Account, token: Token) {
  if (token.expires_at && new Date(token.expires_at).getTime() > Date.now() + 60_000) return token.access_token
  if (!token.refresh_token) throw new Error('TikTok: reconectează contul.')
  const fresh = await fetchJson('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'),
      grant_type: 'refresh_token', refresh_token: token.refresh_token,
    }),
  })
  await saveToken(acc.id, {
    access_token: fresh.access_token, refresh_token: fresh.refresh_token,
    expires_at: new Date(Date.now() + (fresh.expires_in - 60) * 1000).toISOString(),
  })
  return fresh.access_token as string
}

async function publishTiktok(post: Post): Promise<Result> {
  const { account: acc, token } = await account(post)
  const media = await mediaUrl(post)
  if (!media) throw new Error('TikTok are nevoie de un videoclip')
  const accessToken = await tiktokToken(acc, token)
  const bytes = await downloadVideo(media.url)
  const size = bytes.byteLength
  if (size > 64 * 1024 * 1024) throw new Error('Videoclipul depășește 64 MB pentru TikTok')
  const init = await fetchJson('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 } }),
  })
  const upload = await fetch(init.data.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': media.mime, 'Content-Length': String(size), 'Content-Range': `bytes 0-${size - 1}/${size}` },
    body: bytes,
  })
  if (!upload.ok) throw new Error(`Încărcarea pe TikTok a eșuat (${upload.status})`)
  return { done: true, externalId: init.data.publish_id, note: 'Trimis în inbox-ul TikTok: deschide aplicația și publică-l cu textul din platformă' }
}

const publishers = { facebook: publishFacebook, instagram: publishInstagram, youtube: publishYoutube, tiktok: publishTiktok }

async function process(post: Post) {
  try {
    const result = await publishers[post.platform](post)
    if (!result.done) {
      await db().from('posts').update({ metadata: result.metadata, updated_at: new Date().toISOString() }).eq('id', post.id)
      return { id: post.id, status: 'publishing' }
    }
    await db().from('posts').update({
      status: 'published', published_at: new Date().toISOString(), external_post_id: result.externalId,
      external_url: result.url ?? null, last_error: result.note ?? null,
      metadata: { ...post.metadata, ig_container: null }, updated_at: new Date().toISOString(),
    }).eq('id', post.id)
    return { id: post.id, status: 'published' }
  } catch (error) {
    const message = (error as Error).message.slice(0, 500)
    console.error('publish', post.platform, post.id, message)
    await db().from('posts').update({ status: 'failed', last_error: message, updated_at: new Date().toISOString() }).eq('id', post.id)
    return { id: post.id, status: 'failed', error: message }
  }
}

async function claim(postId?: string) {
  let pick = db().from('posts').select('id')
  pick = postId ? pick.eq('id', postId).in('status', ['scheduled', 'failed'])
    : pick.eq('status', 'scheduled').lte('scheduled_for', new Date().toISOString()).order('scheduled_for', { ascending: true }).limit(4)
  const { data: ids, error: pickError } = await pick
  if (pickError) throw pickError
  if (!ids?.length) return [] as Post[]
  const { data, error } = await db().from('posts')
    .update({ status: 'publishing', last_error: null, updated_at: new Date().toISOString() })
    .in('id', ids.map(row => row.id)).in('status', ['scheduled', 'failed'])
    .select('*')
  if (error) throw error
  for (const post of data || []) await db().from('posts').update({ attempts: (post.attempts || 0) + 1 }).eq('id', post.id)
  return (data || []) as Post[]
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const input = await request.json().catch(() => ({}))
    const cronSecret = request.headers.get('x-cron-secret')
    let postId: string | undefined
    if (cronSecret) {
      const { data: ok } = await db().rpc('check_publisher_secret', { candidate: cronSecret })
      if (!ok) throw new HttpError(401, 'Secret cron invalid')
    } else {
      const ownerId = await requireAdmin(request)
      postId = String(input.post_id || '') || undefined
      if (postId) {
        const { data: own } = await db().from('posts').select('id').eq('id', postId).eq('owner_id', ownerId).maybeSingle()
        if (!own) throw new HttpError(404, 'Postarea nu există')
      }
    }

    const results = []
    // Containerele Instagram care încă se procesau la rularea anterioară.
    if (!postId) {
      const { data: waiting } = await db().from('posts').select('*').eq('status', 'publishing').not('metadata->>ig_container', 'is', null).limit(10)
      for (const post of (waiting || []) as Post[]) results.push(await process(post))
      // Postări blocate (funcția a căzut la mijloc): le marcăm ca eșuate ca să le poți reîncerca.
      await db().from('posts').update({ status: 'failed', last_error: 'Publicarea s-a întrerupt. Apasă „Reîncearcă”.' })
        .eq('status', 'publishing').is('metadata->>ig_container', null).lt('updated_at', new Date(Date.now() - 30 * 60_000).toISOString())
    }
    for (const post of await claim(postId)) results.push(await process(post))
    return json({ processed: results.length, results })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    return json({ error: (error as Error).message }, status)
  }
})
