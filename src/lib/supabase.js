// Supabase REST adapter. It keeps the app dependency-light while using the
// official Auth, PostgREST and Storage endpoints with the anon key.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const isSupabaseConfigured = Boolean(url && anonKey)
let currentSession = JSON.parse(localStorage.getItem('postamosului.session') || 'null')
const listeners = new Set()
const headers = (session = currentSession) => ({ apikey: anonKey, Authorization: `Bearer ${session?.access_token || anonKey}`, 'Content-Type': 'application/json' })
const notify = () => listeners.forEach(listener => listener(currentSession))

async function request(path, options = {}, session = currentSession) {
  const response = await fetch(`${url}${path}`, { ...options, headers: { ...headers(session), ...(options.headers || {}) } })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.msg || payload?.message || payload?.error_description || payload?.error || `Supabase request failed (${response.status})`)
  return payload
}

const auth = {
  async getSession() {
    if (currentSession?.refresh_token) {
      try { currentSession = await request('/auth/v1/token?grant_type=refresh_token', { method:'POST', body:JSON.stringify({ refresh_token:currentSession.refresh_token }) }, null); localStorage.setItem('postamosului.session', JSON.stringify(currentSession)) } catch { currentSession = null; localStorage.removeItem('postamosului.session') }
    }
    return { data: { session: currentSession } }
  },
  onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } } },
  async signInWithPassword({ email, password }) {
    try { currentSession = await request('/auth/v1/token?grant_type=password', { method:'POST', body:JSON.stringify({ email, password }) }, null); localStorage.setItem('postamosului.session', JSON.stringify(currentSession)); notify(); return { data:{session:currentSession}, error:null } }
    catch (error) { return { data:{session:null}, error } }
  },
  async signOut() { currentSession = null; localStorage.removeItem('postamosului.session'); notify() }
}

function table(name) {
  return { select: (columns='*') => ({ order: async (column, {ascending=true}={}) => ({ data: await request(`/rest/v1/${name}?select=${encodeURIComponent(columns)}&order=${column}.${ascending?'asc':'desc'}`), error:null }), eq: (column, value) => ({ single: async () => request(`/rest/v1/${name}?select=${encodeURIComponent(columns)}&${column}=eq.${encodeURIComponent(value)}`, { headers:{Prefer:'return=representation'} }).then(rows => ({ data:rows?.[0]||null, error:null })) }) }), insert: (values) => ({ select: () => ({ single: async () => request(`/rest/v1/${name}`, { method:'POST', headers:{Prefer:'return=representation'}, body:JSON.stringify(values) }).then(rows => ({ data:rows?.[0], error:null })) }) }), update: (values) => ({ eq: (column, value) => ({ select: () => ({ single: async () => request(`/rest/v1/${name}?${column}=eq.${encodeURIComponent(value)}`, { method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify(values) }).then(rows => ({ data:rows?.[0], error:null })) }) }) }), delete: () => ({ eq: async (column, value) => { await request(`/rest/v1/${name}?${column}=eq.${encodeURIComponent(value)}`, { method:'DELETE' }); return { data:null, error:null } } }), upsert: (values, options={}) => ({ select: () => ({ single: async () => request(`/rest/v1/${name}?on_conflict=${encodeURIComponent(options.onConflict || '')}`, { method:'POST', headers:{Prefer:'resolution=merge-duplicates,return=representation'}, body:JSON.stringify(values) }).then(rows => ({ data:rows?.[0], error:null })) }) }) }
}

function storage(bucket) { return { upload: async (path, file, options={}) => { const response = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, { method:'POST', headers:{...headers(), 'Content-Type':options.contentType || file.type || 'application/octet-stream', 'x-upsert':String(options.upsert || false)}, body:file }); if (!response.ok) throw new Error('Uploadul în Storage a eșuat'); return { data: await response.json() } }, remove: async paths => { const response = await fetch(`${url}/storage/v1/object/${bucket}`, { method:'DELETE', headers:headers(), body:JSON.stringify({prefixes:paths}) }); if (!response.ok) throw new Error('Ștergerea din Storage a eșuat'); return { data:await response.json() } }, createSignedUrl: async (path, expiresIn=3600) => { const response = await fetch(`${url}/storage/v1/object/sign/${bucket}/${path}`, { method:'POST', headers:headers(), body:JSON.stringify({expiresIn}) }); const payload=await response.json().catch(()=>null); if(!response.ok) throw new Error(payload?.message||'Preview-ul video nu a putut fi creat'); const signedURL=payload?.signedURL||payload?.signedUrl; return { data:{signedUrl:signedURL?.startsWith('http')?signedURL:`${url}/storage/v1${signedURL}` } } } } }

export const supabase = isSupabaseConfigured ? { auth, from: table, storage: { from: storage }, functions: { invoke: async (name, { body } = {}) => { if (currentSession?.refresh_token) { try { currentSession = await request('/auth/v1/token?grant_type=refresh_token', { method:'POST', body:JSON.stringify({ refresh_token:currentSession.refresh_token }) }, null); localStorage.setItem('postamosului.session', JSON.stringify(currentSession)) } catch {} } return { data: await request(`/functions/v1/${name}`, { method:'POST', body:JSON.stringify(body) }), error:null } } } } : null
