// Primește răspunsul de la Meta / Google / TikTok după autorizare și salvează conturile.
import { adminClient, callbackUrl, env, fetchJson, GRAPH, saveAccount } from '../_shared/common.ts'

const back = (returnTo: string, params: Record<string, string>) => {
  const url = new URL(returnTo)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return Response.redirect(url.toString(), 302)
}

async function connectMeta(ownerId: string, code: string) {
  const short = await fetchJson(`${GRAPH}/oauth/access_token?${new URLSearchParams({
    client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'), redirect_uri: callbackUrl(), code,
  })}`)
  const long = await fetchJson(`${GRAPH}/oauth/access_token?${new URLSearchParams({
    grant_type: 'fb_exchange_token', client_id: env('META_APP_ID'), client_secret: env('META_APP_SECRET'),
    fb_exchange_token: short.access_token,
  })}`)
  const pages = await fetchJson(`${GRAPH}/me/accounts?${new URLSearchParams({
    fields: 'id,name,access_token,instagram_business_account{id,username}', limit: '100', access_token: long.access_token,
  })}`)
  const list: any[] = pages.data || []
  if (!list.length) throw new Error('Nu am găsit nicio Pagină de Facebook. Bifează Pagina Poșta Moșului la conectare.')
  const wanted = Deno.env.get('META_PAGE_ID')
  const page = (wanted && list.find(p => p.id === wanted)) ||
    list.find(p => /mo[sș]/i.test(p.name) && p.instagram_business_account) ||
    list.find(p => p.instagram_business_account) || list[0]
  const pagesMeta = { pages: list.map(p => ({ id: p.id, name: p.name })) }

  // Tokenul de Pagină obținut dintr-un token de utilizator de lungă durată nu expiră.
  await saveAccount({
    ownerId, platform: 'facebook', name: page.name, externalId: page.id,
    accessToken: page.access_token, metadata: pagesMeta,
  })
  const ig = page.instagram_business_account
  if (ig?.id) {
    await saveAccount({
      ownerId, platform: 'instagram', name: ig.username ? `@${ig.username}` : page.name, externalId: ig.id,
      accessToken: page.access_token, metadata: { page_id: page.id },
    })
  }
  return ig?.id ? `Facebook (${page.name}) și Instagram` : `Facebook (${page.name}); Instagram nu e legat de Pagină`
}

async function connectYoutube(ownerId: string, code: string) {
  const token = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: callbackUrl(), grant_type: 'authorization_code',
    }),
  })
  if (!token.refresh_token) throw new Error('Google nu a trimis refresh token. Elimină accesul aplicației din contul Google și reconectează.')
  const channels = await fetchJson('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
  const channel = channels.items?.[0]
  if (!channel) throw new Error('Contul Google ales nu are un canal YouTube.')
  await saveAccount({
    ownerId, platform: 'youtube', name: channel.snippet?.title || 'YouTube', externalId: channel.id,
    accessToken: token.access_token, refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + (token.expires_in - 60) * 1000).toISOString(),
  })
  return `YouTube (${channel.snippet?.title})`
}

async function connectTiktok(ownerId: string, code: string) {
  const token = await fetchJson('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'),
      code, grant_type: 'authorization_code', redirect_uri: callbackUrl(),
    }),
  })
  let name = 'TikTok'
  try {
    const info = await fetchJson('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
    name = info.data?.user?.display_name || name
  } catch { /* numele e opțional */ }
  await saveAccount({
    ownerId, platform: 'tiktok', name, externalId: token.open_id,
    accessToken: token.access_token, refreshToken: token.refresh_token,
    expiresAt: new Date(Date.now() + (token.expires_in - 60) * 1000).toISOString(),
    extra: { refresh_expires_at: new Date(Date.now() + token.refresh_expires_in * 1000).toISOString() },
  })
  return `TikTok (${name})`
}

Deno.serve(async (request) => {
  const url = new URL(request.url)
  const state = url.searchParams.get('state') || ''
  const db = adminClient()
  const { data: saved } = await db.from('oauth_states').select('*').eq('state', state).maybeSingle()
  if (!saved) return new Response('Link de conectare expirat sau invalid. Încearcă din nou din platformă.', { status: 400 })
  await db.from('oauth_states').delete().eq('state', state)
  if (Date.now() - new Date(saved.created_at).getTime() > 3600_000) return back(saved.return_to, { connect_error: 'Linkul de conectare a expirat' })

  const providerError = url.searchParams.get('error_description') || url.searchParams.get('error')
  const code = url.searchParams.get('code')
  if (providerError || !code) return back(saved.return_to, { connect_error: providerError || 'Conectarea a fost anulată' })

  try {
    const label = saved.provider === 'meta' ? await connectMeta(saved.owner_id, code)
      : saved.provider === 'youtube' ? await connectYoutube(saved.owner_id, code)
      : await connectTiktok(saved.owner_id, code)
    return back(saved.return_to, { connected: label })
  } catch (error) {
    console.error('oauth-callback', saved.provider, (error as Error).message)
    return back(saved.return_to, { connect_error: (error as Error).message })
  }
})
