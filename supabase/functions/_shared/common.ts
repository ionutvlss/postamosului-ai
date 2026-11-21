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
  // TikTok trimite și la succes `error: { code: "ok" }`; doar alte coduri înseamnă eroare.
  const apiError = payload?.error && !(typeof payload.error === 'object' && payload.error.code === 'ok')
  if (!response.ok || apiError) {
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

/**
 * Cere un răspuns JSON de la AI, cu rezerve: modelul din GEMINI_MODEL (dacă e setat), gemini-3.5-flash,
 * gemini-2.5-flash, apoi OpenAI (OPENAI_MODEL sau gpt-4.1-mini). Întoarce null dacă niciunul nu răspunde valid.
 */
/** Modelul răspunde uneori cu o listă direct, în loc de obiect: o punem sub cheia „items”. */
/** Erorile ultimului apel aiJson (pentru mesaje clare în platformă). */
export const aiErrors: string[] = []
const asObject = (v: unknown) => Array.isArray(v) ? { items: v } : (v && typeof v === 'object' ? v as Record<string, unknown> : { value: v })

/** `fast`: fără „gândire” extinsă (răspuns în câteva secunde) și cu limită de timp pe fiecare model. */
export async function aiJson(prompt: string, temperature = 0.7, opts: { fast?: boolean } = {}): Promise<Record<string, unknown> | null> {
  aiErrors.length = 0
  const geminiKey = Deno.env.get('GEMINI_API_KEY')
  const timeout = () => opts.fast ? AbortSignal.timeout(40000) : AbortSignal.timeout(60000)
  if (geminiKey) {
    const models = [Deno.env.get('GEMINI_MODEL'), 'gemini-3.5-flash', 'gemini-3.8-flash'].filter(Boolean) as string[]
    for (const model of [...new Set(models)]) {
      const thinking = !opts.fast ? undefined : model.startsWith('gemini-2.5') ? { thinkingBudget: 0 } : { thinkingLevel: 'minimal' }
      const call = (withThinking: boolean | 'low') => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey }, signal: timeout(),
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature, ...(withThinking === 'low' ? { thinkingConfig: { thinkingLevel: 'low' } } : withThinking && thinking ? { thinkingConfig: thinking } : {}) } }),
      })
      try {
        let res = await call(true)
        if (res.status === 400 && thinking) res = await call('low') // modelul nu acceptă „minimal”: încearcă „low”
        if (res.status === 503) { await new Promise(r => setTimeout(r, 1500)); res = await call(true) } // supraîncărcare de moment
        const payload = await res.json().catch(() => ({}))
        const text = payload?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || ''
        if (res.ok && text) return { ...asObject(JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim())), _model: model }
        console.error('aiJson gemini', model, res.status, payload?.error?.message || '')
        aiErrors.push(`${model}: ${res.status} ${String(payload?.error?.message || (text ? 'răspuns gol' : 'fără text')).slice(0, 160)}`)
      } catch (e) { console.error('aiJson gemini', model, (e as Error).message); aiErrors.push(`${model}: ${(e as Error).message.slice(0, 160)}`) }
    }
  }
  // Rezervă gratuită: Groq (API compatibil OpenAI).
  const groqKey = Deno.env.get('GROQ_API_KEY')
  if (groqKey) {
    const models = [Deno.env.get('GROQ_MODEL'), 'openai/gpt-oss-120b', 'llama-3.3-70b-versatile'].filter(Boolean) as string[]
    for (const model of [...new Set(models)]) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` }, signal: timeout(),
          body: JSON.stringify({ model, temperature, ...(model.startsWith('openai/') ? { reasoning_effort: 'low' } : { response_format: { type: 'json_object' } }),
            messages: [{ role: 'system', content: 'Răspunzi doar cu JSON valid, în limba română.' }, { role: 'user', content: prompt }] }),
        })
        const payload = await res.json().catch(() => ({}))
        const text = payload?.choices?.[0]?.message?.content || ''
        if (res.ok && text) { const t = String(text); return { ...asObject(JSON.parse(t.slice(t.indexOf('{') >= 0 && (t.indexOf('[') < 0 || t.indexOf('{') < t.indexOf('[')) ? t.indexOf('{') : t.indexOf('['), Math.max(t.lastIndexOf('}'), t.lastIndexOf(']')) + 1))), _model: `groq:${model}` } }
        aiErrors.push(`groq ${model}: ${res.status} ${String(payload?.error?.message || '').slice(0, 160)}`)
      } catch (e) { aiErrors.push(`groq ${model}: ${(e as Error).message.slice(0, 160)}`) }
    }
  }
  const openAiKey = Deno.env.get('OPENAI_API_KEY')
  if (openAiKey) {
    const model = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini'
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openAiKey}` },
        signal: timeout(),
        body: JSON.stringify({ model, input: prompt, temperature, text: { format: { type: 'json_object' } } }),
      })
      const payload = await res.json().catch(() => ({}))
      const text = payload.output_text || payload.output?.flatMap((i: { content?: unknown[] }) => i.content || [])
        .find((i: { type?: string }) => i.type === 'output_text')?.text || ''
      if (res.ok && text) return { ...asObject(JSON.parse(String(text).replace(/^```json\s*|\s*```$/g, '').trim())), _model: model }
      console.error('aiJson openai', res.status, payload?.error?.message || '')
      aiErrors.push(`${model}: ${res.status} ${String(payload?.error?.message || '').slice(0, 160)}`)
    } catch (e) { console.error('aiJson openai', (e as Error).message); aiErrors.push(`openai: ${(e as Error).message.slice(0, 160)}`) }
  }
  return null
}
