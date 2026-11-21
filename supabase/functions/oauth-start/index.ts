// Pornește conectarea unui cont: întoarce adresa de autorizare a platformei.
import { adminClient, callbackUrl, corsHeaders, env, HttpError, json, randomToken, requireAdmin } from '../_shared/common.ts'

const ALLOWED_RETURN = [/^https:\/\/ionutvlss\.github\.io\/postamosului-ai\//, /^http:\/\/localhost:\d+\//, /^http:\/\/127\.0\.0\.1:\d+\//]

const META_SCOPES = [
  'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'read_insights',
  'pages_read_user_content', 'pages_manage_engagement', 'instagram_manage_comments',
].join(',')
const YOUTUBE_SCOPES = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.force-ssl'
// video.publish (publicare directă) se cere doar când modul TikTok din Automatizări e „direct”.
const TIKTOK_SCOPES = 'user.info.basic,video.upload'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed')
    const ownerId = await requireAdmin(request)
    const input = await request.json().catch(() => ({}))
    const provider = String(input.provider || '')
    const returnTo = String(input.return_to || '')
    if (!['meta', 'youtube', 'tiktok'].includes(provider)) throw new HttpError(400, 'Platformă necunoscută')
    if (!ALLOWED_RETURN.some(rule => rule.test(returnTo))) throw new HttpError(400, 'Adresă de întoarcere nepermisă')

    const state = randomToken(24)
    const db = adminClient()
    const { data: settings } = await db.from('automation_settings').select('tiktok_mode').eq('owner_id', ownerId).maybeSingle()
    const tiktokScopes = settings?.tiktok_mode === 'direct' ? `${TIKTOK_SCOPES},video.publish` : TIKTOK_SCOPES
    await db.from('oauth_states').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString())
    const { error } = await db.from('oauth_states').insert({ state, owner_id: ownerId, provider, return_to: returnTo })
    if (error) throw error

    const redirect = callbackUrl()
    let url: string
    if (provider === 'meta') {
      // Facebook Login for Business folosește config_id; altfel cerem permisiunile direct.
      const configId = Deno.env.get('META_CONFIG_ID')
      url = `https://www.facebook.com/v23.0/dialog/oauth?${new URLSearchParams({
        client_id: env('META_APP_ID'), redirect_uri: redirect, state, response_type: 'code',
        ...(configId ? { config_id: configId } : { scope: META_SCOPES }),
      })}`
    } else if (provider === 'youtube') {
      url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirect, state, scope: YOUTUBE_SCOPES,
        response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
      })}`
    } else {
      url = `https://www.tiktok.com/v2/auth/authorize/?${new URLSearchParams({
        client_key: env('TIKTOK_CLIENT_KEY'), redirect_uri: redirect, state, scope: tiktokScopes, response_type: 'code',
      })}`
    }
    return json({ url })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    return json({ error: (error as Error).message }, status)
  }
})
