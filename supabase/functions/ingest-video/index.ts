// Primește un clip gata făcut (de ex. reclamele zilnice cu Moșul) și îl pune în coada de aprobare:
// salvează videoclipul în Media library și creează câte o postare „În aprobare” pe fiecare platformă.
// Autentificare: header x-ingest-secret = secretul INGEST_SECRET din Supabase.
import { adminClient, corsHeaders, env, HttpError, json } from '../_shared/common.ts'

const PLATFORMS = ['facebook', 'instagram', 'youtube', 'tiktok'] as const
type Platform = typeof PLATFORMS[number]
const DEFAULT_SLOTS = ['12:30', '19:30']
const MAX_BYTES = 200 * 1024 * 1024

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

function bucharestOffsetMinutes(at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bucharest', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  return Math.round((Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - Math.floor(at.getTime() / 60000) * 60000) / 60000)
}
function bucharestToUtc(day: string, time: string) {
  const [y, m, d] = day.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm)
  return new Date(guess - bucharestOffsetMinutes(new Date(guess)) * 60000)
}
function bucharestDay(at: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** Prima oră liberă (din sloturile platformei) începând cu `from`, fără altă postare activă în același minut. */
async function nextFreeSlot(ownerId: string, platform: Platform, from: Date, preferredSlot?: number) {
  const db = adminClient()
  const { data: schedule } = await db.from('publishing_schedules').select('slots').eq('owner_id', ownerId).eq('platform', platform).maybeSingle()
  const slots: string[] = Array.isArray(schedule?.slots) && schedule.slots.length ? schedule.slots : DEFAULT_SLOTS
  const ordered = preferredSlot !== undefined && slots[preferredSlot] ? [slots[preferredSlot]] : slots
  const { data: busy } = await db.from('posts').select('scheduled_for').eq('owner_id', ownerId).eq('platform', platform)
    .in('status', ['pending_approval', 'scheduled', 'publishing']).gte('scheduled_for', from.toISOString())
  const taken = new Set((busy || []).map(row => new Date(row.scheduled_for).toISOString().slice(0, 16)))
  for (let dayOffset = 0; dayOffset < 45; dayOffset++) {
    const day = bucharestDay(new Date(from.getTime() + dayOffset * 86400000))
    for (const slot of ordered) {
      const at = bucharestToUtc(day, slot)
      if (at.getTime() < from.getTime()) continue
      if (!taken.has(at.toISOString().slice(0, 16))) return at
    }
  }
  throw new Error(`Nu am găsit un slot liber pentru ${platform} în următoarele 45 de zile`)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed')
    if (!safeEqual(request.headers.get('x-ingest-secret') || '', env('INGEST_SECRET'))) throw new HttpError(401, 'Secret invalid')
    const input = await request.json().catch(() => null)
    if (!input || typeof input !== 'object') throw new HttpError(400, 'Body JSON invalid')

    const videoUrl = String(input.video_url || '')
    if (!/^https:\/\//.test(videoUrl)) throw new HttpError(400, 'video_url trebuie să fie un link https')
    const title = String(input.title || '').trim().slice(0, 150)
    if (!title) throw new HttpError(400, 'title este obligatoriu')
    const captions = (input.captions && typeof input.captions === 'object') ? input.captions as Record<string, unknown> : {}
    const defaultCaption = String(captions.default || input.caption || title).slice(0, 2200)
    const hashtags = Array.isArray(input.hashtags) ? (input.hashtags as unknown[]).map(String).map((t: string) => t.trim()).filter(Boolean).slice(0, 15) : []
    const platforms = (Array.isArray(input.platforms) && input.platforms.length ? input.platforms : PLATFORMS)
      .map(String).filter((p: string): p is Platform => (PLATFORMS as readonly string[]).includes(p))
    if (!platforms.length) throw new HttpError(400, 'Nicio platformă validă')
    const ingestId = String(input.ingest_id || '').slice(0, 120) || null
    const slotIndex = Number.isInteger(input.slot_index) ? Number(input.slot_index) : undefined
    const startFrom = input.not_before ? new Date(String(input.not_before)) : new Date(Date.now() + 30 * 60000)
    if (Number.isNaN(startFrom.getTime())) throw new HttpError(400, 'not_before invalid')

    const db = adminClient()
    const { data: owner } = await db.from('profiles').select('id').eq('role', 'admin').order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (!owner) throw new Error('Nu există un administrator în platformă')

    // Idempotent: același ingest_id nu creează postări de două ori.
    if (ingestId) {
      const { data: existing } = await db.from('posts').select('id, platform, scheduled_for, media_id').eq('owner_id', owner.id).eq('metadata->>ingest_id', ingestId)
      if (existing?.length) return json({ duplicate: true, media_id: existing[0].media_id, posts: existing })
    }

    const video = await fetch(videoUrl)
    if (!video.ok) throw new Error(`Nu am putut descărca videoclipul (${video.status})`)
    const bytes = new Uint8Array(await video.arrayBuffer())
    if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, 'Videoclipul depășește 200 MB')
    const mime = (video.headers.get('content-type') || 'video/mp4').split(';')[0]
    const name = String(input.name || `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) || 'clip'}.mp4`)
    const path = `${owner.id}/${crypto.randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const { error: uploadError } = await db.storage.from('media').upload(path, bytes, { contentType: mime.startsWith('video/') ? mime : 'video/mp4' })
    if (uploadError) throw uploadError
    const { data: asset, error: assetError } = await db.from('media_assets').insert({
      owner_id: owner.id, name, storage_path: path, mime_type: 'video/mp4', size_bytes: bytes.byteLength,
      duration_seconds: Number(input.duration_seconds) || null,
    }).select('id').single()
    if (assetError) throw assetError

    const created = []
    for (const platform of platforms) {
      const when = input.scheduled_for ? new Date(String(input.scheduled_for)) : await nextFreeSlot(owner.id, platform, startFrom, slotIndex)
      const { data: post, error } = await db.from('posts').insert({
        owner_id: owner.id, platform, title,
        body: String(captions[platform] || defaultCaption).slice(0, 2200),
        hashtags, media_id: asset.id, status: 'pending_approval', scheduled_for: when.toISOString(),
        metadata: { source: String(input.source || 'ingest'), ingest_id: ingestId, script: input.script ? String(input.script).slice(0, 2000) : null, hook: input.hook ? String(input.hook).slice(0, 300) : null },
      }).select('id, platform, scheduled_for').single()
      if (error) throw error
      created.push(post)
    }
    return json({ media_id: asset.id, posts: created })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    console.error('ingest-video', (error as Error).message)
    return json({ error: (error as Error).message }, status)
  }
})
