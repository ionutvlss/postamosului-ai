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
  const { data: schedule, error: scheduleError } = await db.from('publishing_schedules').select('slots').eq('owner_id', ownerId).eq('platform', platform).maybeSingle()
  if (scheduleError) console.error('ingest-video schedule', platform, scheduleError.message)
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

/** Alege grupurile la rând pentru ziua `target`: niciun grup cu altă postare la mai puțin de 6 zile (înainte sau după),
 *  maximum 5 postări de grup pe zi, cele mai de mult nefolosite primele. */
async function createGroupDrafts(ownerId: string, mediaId: string, texts: string[], ingestId: string | null, target: Date) {
  const db = adminClient()
  const { data: groups } = await db.from('group_candidates').select('id, group_name')
    .eq('owner_id', ownerId).eq('status', 'shortlisted').order('created_at', { ascending: true })
  if (!groups?.length) return []
  const { data: existing } = await db.from('group_outreach_drafts').select('group_id, scheduled_for, created_at, status')
    .eq('owner_id', ownerId).neq('status', 'rejected').order('created_at', { ascending: false }).limit(1000)
  const day = bucharestDay(target)
  const sameDay = (existing || []).filter(r => bucharestDay(new Date(r.scheduled_for || r.created_at)) === day).length
  const room = Math.max(0, 5 - sameDay)
  if (!room) return []
  const SIX = 6 * 86400000
  const dates = new Map<string, number[]>()
  for (const r of existing || []) {
    const t = new Date(r.scheduled_for || r.created_at).getTime()
    dates.set(r.group_id, [...(dates.get(r.group_id) || []), t])
  }
  const lastBefore = (id: string) => Math.max(0, ...(dates.get(id) || []).filter(t => t <= target.getTime()))
  const ranked = groups
    .filter(g => !(dates.get(g.id) || []).some(t => Math.abs(t - target.getTime()) < SIX))
    .sort((a, b) => lastBefore(a.id) - lastBefore(b.id))
    .slice(0, Math.min(texts.length, room))
  const created = []
  for (const [i, group] of ranked.entries()) {
    const { data, error } = await db.from('group_outreach_drafts').insert({
      owner_id: ownerId, group_id: group.id, media_id: mediaId, body: texts[i].slice(0, 5000),
      status: 'pending_approval', scheduled_for: target.toISOString(), ai_model: ingestId ? `claude:${ingestId}` : 'claude',
    }).select('id').single()
    if (error) throw error
    created.push({ id: data.id, group: group.group_name, day })
  }
  return created
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed')
    if (!safeEqual(request.headers.get('x-ingest-secret') || '', env('INGEST_SECRET'))) throw new HttpError(401, 'Secret invalid')
    const input = await request.json().catch(() => null)
    if (!input || typeof input !== 'object') throw new HttpError(400, 'Body JSON invalid')

    // Automatizarea zilnică: starea butonului Start/Stop și jurnalul de rulări (le folosește sarcina programată).
    if (input.action === 'status' || input.action === 'log_run') {
      const dbA = adminClient()
      const { data: ownerA } = await dbA.from('profiles').select('id').eq('role', 'admin').order('created_at', { ascending: true }).limit(1).maybeSingle()
      if (!ownerA) throw new Error('Nu există un administrator în platformă')
      const { data: settingsA } = await dbA.from('automation_settings').select('daily_enabled, daily_toggled_at').eq('owner_id', ownerA.id).maybeSingle()
      const enabled = settingsA?.daily_enabled === true
      if (input.action === 'status') {
        const { data: lastRuns } = await dbA.from('automation_runs').select('status, summary, created_at').eq('owner_id', ownerA.id).order('created_at', { ascending: false }).limit(3)
        return json({ daily_enabled: enabled, toggled_at: settingsA?.daily_toggled_at || null, last_runs: lastRuns || [] })
      }
      const status = String(input.status || '')
      if (!['started', 'done', 'skipped', 'failed'].includes(status)) throw new HttpError(400, 'status invalid')
      const cost = Number(input.cost_usd)
      const { error: logError } = await dbA.from('automation_runs').insert({
        owner_id: ownerA.id, kind: 'daily_clips', status, summary: String(input.summary || '').slice(0, 1000) || null,
        cost_usd: Number.isFinite(cost) && cost >= 0 ? Math.min(cost, 999) : null,
      })
      if (logError) throw logError
      return json({ logged: true, daily_enabled: enabled })
    }

    // Sugestii de grupuri (găsite de Claude): nu au nevoie de video.
    if (Array.isArray(input.groups_suggest)) {
      const db0 = adminClient()
      const { data: owner0 } = await db0.from('profiles').select('id').eq('role', 'admin').order('created_at', { ascending: true }).limit(1).maybeSingle()
      if (!owner0) throw new Error('Nu există un administrator în platformă')
      const added = []
      for (const raw of (input.groups_suggest as Record<string, unknown>[]).slice(0, 100)) {
        const url = String(raw.url || '').trim().split('?')[0].replace(/\/$/, '')
        const match = /^https:\/\/(?:www\.|m\.)?facebook\.com\/groups\/([^/]+)$/.exec(url)
        const name = String(raw.name || '').trim().slice(0, 150)
        if (!match || !name) continue
        const externalId = `fb-${match[1]}`
        const { data: exists } = await db0.from('group_candidates').select('id').eq('owner_id', owner0.id).eq('external_group_id', externalId).maybeSingle()
        if (exists) continue
        const { error } = await db0.from('group_candidates').insert({
          owner_id: owner0.id, external_group_id: externalId, group_name: name, group_url: `https://www.facebook.com/groups/${match[1]}`,
          category: String(raw.category || '').slice(0, 80) || null, member_count: Number(raw.members) || null,
          relevance_score: Math.min(100, Math.max(0, Number(raw.score) || 0)) || null, status: 'discovered', language: 'ro',
          metadata: { reason: String(raw.reason || '').slice(0, 300), privacy: String(raw.privacy || ''), source: 'claude' },
        })
        if (!error) added.push(name)
      }
      return json({ added: added.length, groups: added })
    }

    const videoUrl = String(input.video_url || '')
    if (!/^https:\/\//.test(videoUrl)) throw new HttpError(400, 'video_url trebuie să fie un link https')
    const title = String(input.title || '').trim().slice(0, 150)
    if (!title) throw new HttpError(400, 'title este obligatoriu')
    const captions = (input.captions && typeof input.captions === 'object') ? input.captions as Record<string, unknown> : {}
    const defaultCaption = String(captions.default || input.caption || title).slice(0, 2200)
    const hashtags = Array.isArray(input.hashtags) ? (input.hashtags as unknown[]).map(String).map((t: string) => t.trim()).filter(Boolean).slice(0, 15) : []
    const platforms = (Array.isArray(input.platforms) ? input.platforms : PLATFORMS)
      .map(String).filter((p: string): p is Platform => (PLATFORMS as readonly string[]).includes(p))
    const groupTexts: string[] = Array.isArray(input.group_posts?.texts)
      ? (input.group_posts.texts as unknown[]).map(String).map((t: string) => t.trim()).filter(Boolean).slice(0, 10) : []
    if (!platforms.length && !groupTexts.length) throw new HttpError(400, 'Nicio platformă și niciun text pentru grupuri')
    const ingestId = String(input.ingest_id || '').slice(0, 120) || null
    const slotIndex = Number.isInteger(input.slot_index) ? Number(input.slot_index) : undefined
    const startFrom = input.not_before ? new Date(String(input.not_before)) : new Date(Date.now() + 30 * 60000)
    if (Number.isNaN(startFrom.getTime())) throw new HttpError(400, 'not_before invalid')

    const db = adminClient()
    const dryRun = input.dry_run === true
    const { data: owner } = await db.from('profiles').select('id').eq('role', 'admin').order('created_at', { ascending: true }).limit(1).maybeSingle()
    if (!owner) throw new Error('Nu există un administrator în platformă')

    // Butonul Stop din platformă are ultimul cuvânt: clipurile zilnice nu intră dacă automatizarea e oprită.
    if (String(input.source || '') === 'claude-daily') {
      const { data: settings } = await db.from('automation_settings').select('daily_enabled').eq('owner_id', owner.id).maybeSingle()
      if (settings?.daily_enabled !== true) throw new HttpError(409, 'Automatizarea zilnică este oprită din platformă')
    }

    // Publicare fără aprobare: doar dacă Ioan a pornit-o în Automatizări (clipurile intră direct ca „Programat”).
    const { data: publishSettings } = await db.from('automation_settings').select('auto_publish').eq('owner_id', owner.id).maybeSingle()
    const autoPublish = publishSettings?.auto_publish === true

    if (dryRun) {
      const slots = []
      for (const platform of platforms) slots.push({ platform, scheduled_for: (await nextFreeSlot(owner.id, platform, startFrom, slotIndex)).toISOString() })
      return json({ dry_run: true, slots })
    }

    // Idempotent: același ingest_id nu creează postări de două ori.
    if (ingestId) {
      const { data: existing } = await db.from('posts').select('id, platform, scheduled_for, media_id').eq('owner_id', owner.id).eq('metadata->>ingest_id', ingestId)
      if (existing?.length) return json({ duplicate: true, media_id: existing[0].media_id, posts: existing })
      const { data: existingDrafts } = await db.from('group_outreach_drafts').select('id, media_id').eq('owner_id', owner.id).eq('ai_model', `claude:${ingestId}`)
      if (existingDrafts?.length) return json({ duplicate: true, media_id: existingDrafts[0].media_id, group_drafts: existingDrafts })
    }

    const video = await fetch(videoUrl)
    if (!video.ok) throw new Error(`Nu am putut descărca videoclipul (${video.status})`)
    const bytes = new Uint8Array(await video.arrayBuffer())
    if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, 'Videoclipul depășește 200 MB')
    const name = String(input.name || `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) || 'clip'}.mp4`)
    const ext = name.toLowerCase().split('.').pop() || ''
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'video/mp4'
    if (mime.startsWith('image/') && platforms.length) throw new HttpError(400, 'Imaginile merg doar în grupuri (platforms: [])')
    const path = `${owner.id}/${crypto.randomUUID()}-${name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const { error: uploadError } = await db.storage.from('media').upload(path, bytes, { contentType: mime })
    if (uploadError) throw uploadError
    const { data: asset, error: assetError } = await db.from('media_assets').insert({
      owner_id: owner.id, name, storage_path: path, mime_type: mime, size_bytes: bytes.byteLength,
      duration_seconds: Number(input.duration_seconds) || null,
    }).select('id').single()
    if (assetError) throw assetError

    const created = []
    for (const platform of platforms) {
      const when = input.scheduled_for ? new Date(String(input.scheduled_for)) : await nextFreeSlot(owner.id, platform, startFrom, slotIndex)
      const { data: post, error } = await db.from('posts').insert({
        owner_id: owner.id, platform, title,
        body: String(captions[platform] || defaultCaption).slice(0, 2200),
        hashtags, media_id: asset.id, status: autoPublish ? 'scheduled' : 'pending_approval', scheduled_for: when.toISOString(),
        metadata: { source: String(input.source || 'ingest'), ingest_id: ingestId, script: input.script ? String(input.script).slice(0, 2000) : null, hook: input.hook ? String(input.hook).slice(0, 300) : null },
      }).select('id, platform, scheduled_for').single()
      if (error) throw error
      created.push(post)
    }
    const groupDay = input.group_posts?.scheduled_for ? new Date(String(input.group_posts.scheduled_for)) : new Date()
    if (Number.isNaN(groupDay.getTime())) throw new HttpError(400, 'group_posts.scheduled_for invalid')
    const groupDrafts = groupTexts.length ? await createGroupDrafts(owner.id, asset.id, groupTexts, ingestId, groupDay) : []
    return json({ media_id: asset.id, posts: created, group_drafts: groupDrafts })
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500
    console.error('ingest-video', (error as Error).message)
    return json({ error: (error as Error).message }, status)
  }
})
