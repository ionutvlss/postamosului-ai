import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

export const GRAPH = 'https://graph.facebook.com/v23.0'

export function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Lipsește secretul ${name} în Supabase (Edge Functions → Secrets)`)
  return value
}

function serviceKey(): string {
  const direct = Deno.env.get('POSTAMOSULUI_SUPABASE_ADMIN_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (direct) return direct
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    const key = keys.default || Object.values(keys)[0]
    if (typeof key === 'string') return key
  } catch { /* ignore */ }
  throw new Error('Lipsește cheia service role')
}

let admin: SupabaseClient | null = null
export function adminClient(): SupabaseClient {
  if (!admin) admin = createClient(env('SUPABASE_URL'), serviceKey(), { auth: { persistSession: false } })
  return admin
}

export function callbackUrl(): string {
  return `${env('SUPABASE_URL')}/functions/v1/oauth-callback`
}

/** Verifică sesiunea din header și că utilizatorul are rol de admin. Întoarce id-ul lui. */
export async function requireAdmin(request: Request): Promise<string> {
  const authorization = request.headers.get('Authorization') || ''
  const token = authorization.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Autentificare necesară')
  const { data, error } = await adminClient().auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Sesiunea administratorului este invalidă')
  const { data: profile } = await adminClient().from('profiles').select('id').eq('id', data.user.id).eq('role', 'admin').maybeSingle()
  if (!profile) throw new HttpError(403, 'Doar administratorul poate face asta')
  return data.user.id
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.error) {
    const message = payload?.error?.message || payload?.error_description || payload?.error?.code || payload?.message ||
      (typeof payload?.error === 'string' ? payload.error : '') || `HTTP ${response.status}`
    throw new Error(String(message))
  }
  return payload
}

export function randomToken(bytes = 32): string {
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('')
}

/** Salvează (sau actualizează) un cont conectat și tokenurile lui. */
export async function saveAccount(input: {
  ownerId: string
  platform: 'facebook' | 'instagram' | 'youtube' | 'tiktok'
  name: string
  externalId: string
  accessToken: string
  refreshToken?: string | null
  expiresAt?: string | null
  extra?: Record<string, unknown>
  metadata?: Record<string, unknown>
}) {
  const db = adminClient()
  const { data: account, error } = await db.from('social_accounts').upsert({
    owner_id: input.ownerId,
    platform: input.platform,
    account_name: input.name,
    external_account_id: input.externalId,
    status: 'connected',
    token_expires_at: input.expiresAt ?? null,
    metadata: input.metadata ?? {},
    updated_at: new Date().toISOString(),
  }, { onConflict: 'owner_id,platform' }).select('id').single()
  if (error) throw error
  const { error: tokenError } = await db.from('social_tokens').upsert({
    account_id: account.id,
    access_token: input.accessToken,
    refresh_token: input.refreshToken ?? null,
    expires_at: input.expiresAt ?? null,
    extra: input.extra ?? {},
    updated_at: new Date().toISOString(),
  })
  if (tokenError) throw tokenError
}
