import { supabase } from './supabase'

const requireClient = () => {
  if (!supabase) throw new Error('Supabase nu este configurat. Copiază .env.example în .env.local.')
  return supabase
}

export async function getProfile(userId) {
  const client = requireClient()
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).single()
  if (error) throw error
  return data
}

export async function updateProfile(userId, fullName) {
  const client = requireClient()
  const { data, error } = await client.from('profiles').update({ full_name: fullName }).eq('id', userId).select().single()
  if (error) throw error
  return data
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

export async function updatePost(id, input) {
  const client = requireClient()
  const { data, error } = await client.from('posts').update(input).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function listMedia() {
  const client = requireClient()
  const { data, error } = await client.from('media_assets').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return Promise.all(data.map(async asset => { try { const { data: signed } = await client.storage.from('media').createSignedUrl(asset.storage_path); return { ...asset, preview_url:signed.signedUrl } } catch { return asset } }))
}

export async function deleteMedia(asset) {
  const client = requireClient()
  await client.storage.from('media').remove([asset.storage_path])
  const { error } = await client.from('media_assets').delete().eq('id', asset.id)
  if (error) throw error
}

export async function listSocialAccounts() {
  const client = requireClient()
  const { data, error } = await client.from('social_accounts').select('*').order('platform', { ascending: true })
  if (error) throw error
  return data
}

export async function saveSocialAccount(input) {
  const client = requireClient()
  const { data, error } = await client.from('social_accounts').upsert(input, { onConflict:'owner_id,platform' }).select().single()
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
  try { const { data: signed } = await client.storage.from('media').createSignedUrl(path); return { ...data, preview_url:signed.signedUrl } } catch { return data }
}

export async function listPublishingSchedules() {
  const client = requireClient()
  const { data, error } = await client.from('publishing_schedules').select('*').order('platform', { ascending: true })
  if (error) throw error
  return data
}

export async function listAutomationSettings() {
  const client = requireClient()
  const { data, error } = await client.from('automation_settings').select('*').order('updated_at', { ascending: false })
  if (error) throw error
  return data?.[0] || null
}

export async function saveAutomationSettings(input) {
  const client = requireClient()
  const { data, error } = await client.from('automation_settings').upsert(input, { onConflict:'owner_id' }).select().single()
  if (error) throw error
  return data
}

export async function savePublishingSchedule(input) {
  const client = requireClient()
  const { data, error } = await client.from('publishing_schedules').upsert(input, { onConflict:'owner_id,platform' }).select().single()
  if (error) throw error
  return data
}

export async function listGroupCandidates() {
  const client = requireClient()
  const { data, error } = await client.from('group_candidates').select('*').order('relevance_score', { ascending: false })
  if (error) throw error
  return data
}

export async function createGroupCandidate(input) {
  const client = requireClient()
  const { data, error } = await client.from('group_candidates').upsert(input, { onConflict:'owner_id,external_group_id' }).select().single()
  if (error) throw error
  return data
}

export async function createGroupOutreachDraft(input) {
  const client = requireClient()
  const { data, error } = await client.from('group_outreach_drafts').insert(input).select().single()
  if (error) throw error
  return data
}

export async function createContentVariant(input) {
  const client = requireClient()
  const { data, error } = await client.from('content_variants').insert(input).select().single()
  if (error) throw error
  return data
}

export async function generateContent(input) {
  const client = requireClient()
  const { data, error } = await client.functions.invoke('generate-content', { body:input })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}

export async function startConnect(provider) {
  const client = requireClient()
  const returnTo = `${window.location.origin}${window.location.pathname}`
  const { data } = await client.functions.invoke('oauth-start', { body:{ provider, return_to:returnTo } })
  if (data?.error) throw new Error(data.error)
  window.location.href = data.url
}

export async function publishNow(postId) {
  const client = requireClient()
  const { data } = await client.functions.invoke('publish-due', { body:{ post_id:postId } })
  if (data?.error) throw new Error(data.error)
  return data
}

export async function deletePost(id) {
  const client = requireClient()
  await client.from('posts').delete().eq('id', id)
}

export async function listGroupDrafts() {
  const client = requireClient()
  const { data, error } = await client.from('group_outreach_drafts').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function updateGroupDraft(id, patch) {
  const client = requireClient()
  const { data, error } = await client.from('group_outreach_drafts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function updateGroupCandidate(id, patch) {
  const client = requireClient()
  const { data, error } = await client.from('group_candidates').update(patch).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function listComments() {
  const client = requireClient()
  const { data, error } = await client.from('comment_threads').select('*').order('created_at', { ascending: false }).limit(200)
  if (error) throw error
  return data
}

export async function updateComment(id, patch) {
  const client = requireClient()
  const { data, error } = await client.from('comment_threads').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function commentsAction(body) {
  const client = requireClient()
  const { data, error } = await client.functions.invoke('comments-sync', { body })
  if (data?.error) throw new Error(data.error)
  if (error) throw error
  return data
}

export async function setDailyAutomation(ownerId, enabled) {
  const client = requireClient()
  const { data, error } = await client.from('automation_settings')
    .upsert({ owner_id: ownerId, daily_enabled: enabled, daily_toggled_at: new Date().toISOString() }, { onConflict: 'owner_id' })
    .select().single()
  if (error) throw error
  return data
}

export async function listAutomationRuns() {
  const client = requireClient()
  const { data, error } = await client.from('automation_runs').select('*').order('created_at', { ascending: false }).limit(8)
  if (error) throw error
  return data
}

export async function listCosts() {
  const client = requireClient()
  const { data, error } = await client.from('marketing_costs').select('*').order('spent_on', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function addCost(row) {
  const client = requireClient()
  const { data: { user } } = await client.auth.getUser()
  const { error } = await client.from('marketing_costs').insert({ ...row, owner_id: user.id, source: 'manual' })
  if (error) throw error
}

export async function deleteCost(id) {
  const client = requireClient()
  const { error } = await client.from('marketing_costs').delete().eq('id', id)
  if (error) throw error
}
