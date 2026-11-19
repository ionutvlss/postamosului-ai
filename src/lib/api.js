import { supabase } from './supabase'

const requireClient = () => {
  if (!supabase) throw new Error('Supabase nu este configurat. Copiază .env.example în .env.local.')
  return supabase
}

export async function listPosts() {
  const client = requireClient()
  const { data, error } = await client.from('posts').select('*').order('scheduled_for', { ascending: true })
  if (error) throw error
  return data
}

export async function createPost(input) {
  const client = requireClient()
  const { data, error } = await client.from('posts').insert(input).select().single()
  if (error) throw error
  return data
}

export async function listMedia() {
  const client = requireClient()
  const { data, error } = await client.from('media_assets').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function uploadMedia(file, userId) {
  const client = requireClient()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-')
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`
  const { error: uploadError } = await client.storage.from('media').upload(path, file, { upsert: false, contentType: file.type })
  if (uploadError) throw uploadError
  const { data, error } = await client.from('media_assets').insert({ name: file.name, storage_path: path, mime_type: file.type, size_bytes: file.size }).select().single()
  if (error) throw error
  return data
}

export async function listPublishingSchedules() {
  const client = requireClient()
  const { data, error } = await client.from('publishing_schedules').select('*').order('platform', { ascending: true })
  if (error) throw error
  return data
}

export async function savePublishingSchedule(input) {
  const client = requireClient()
  const { data, error } = await client.from('publishing_schedules').insert(input).select().single()
  if (error) throw error
  return data
}

export async function listGroupCandidates() {
  const client = requireClient()
  const { data, error } = await client.from('group_candidates').select('*').order('relevance_score', { ascending: false })
  if (error) throw error
  return data
}
