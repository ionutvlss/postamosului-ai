import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { setDailyAutomation, listAutomationRuns, listComments, updateComment, commentsAction, listGroupDrafts, updateGroupDraft, updateGroupCandidate, deletePost, listPublishingSchedules, listSocialAccounts, publishNow, startConnect, createContentVariant, createGroupCandidate, createGroupOutreachDraft, createPost, deleteMedia, generateContent, getProfile, listAutomationSettings, listGroupCandidates, listMedia, listPosts, saveAutomationSettings, savePublishingSchedule, updatePost, updateProfile, uploadMedia } from './lib/api'

const icons = { grid:'⌘', social:'◎', media:'▣', studio:'✦', calendar:'▦', groups:'♧', comments:'✉', analytics:'↗', settings:'⚙' }
const nav = [
  ['Dashboard','grid'], ['Conturi social','social'], ['Media library','media'], ['AI Content Studio','studio'],
  ['Calendar editorial','calendar'], ['Automatizări','settings'], ['Grupuri Facebook','groups'], ['Comentarii','comments'], ['Analytics','analytics'], ['Setări','settings']
]

const PLATFORM = {
  instagram:{label:'Instagram',color:'ig',icon:'◎',type:'Reel'},
  facebook:{label:'Facebook',color:'fb',icon:'f',type:'Reel'},
  youtube:{label:'YouTube',color:'yt',icon:'▶',type:'Short'},
  tiktok:{label:'TikTok',color:'tt',icon:'♪',type:'Video'},
}
const STATUS = { draft:'Ciornă', pending_approval:'În aprobare', scheduled:'Programată', publishing:'Se publică', published:'Publicată', failed:'Eșuată' }
const todayLabel = (options) => new Date().toLocaleDateString('ro-RO', options).toUpperCase()
const daysToChristmas = () => { const now=new Date(); let xmas=new Date(now.getFullYear(),11,25); if(now>xmas) xmas=new Date(now.getFullYear()+1,11,25); return Math.ceil((xmas-now)/86400000) }
const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
const scheduled = [
  {time:'09:30', platform:'Instagram', color:'ig', title:'Magia începe cu o scrisoare ✨', type:'Reel', status:'Programată'},
  {time:'13:00', platform:'Facebook', color:'fb', title:'Tu ce i-ai scrie lui Moș Crăciun?', type:'Postare', status:'Programată'},
  {time:'19:45', platform:'YouTube', color:'yt', title:'Unboxing: cutia cu povești', type:'Short', status:'În aprobare'},
]
function App(){
  const [active, setActive] = useState('Dashboard')
  const [notice, setNotice] = useState('')
  const [searchOpen, setSearchOpen] = useState(false), [searchQuery, setSearchQuery] = useState(''), [menuOpen, setMenuOpen] = useState(false)
  const [posts, setPosts] = useState(isSupabaseConfigured ? [] : scheduled)
  const [media, setMedia] = useState([])
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState({ full_name:'Administrator' })
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured)
  const [prompt, setPrompt] = useState('O idee de postare despre magia sărbătorilor pentru părinți')
  const [generated, setGenerated] = useState(null)
  const showNotice = (text) => { setNotice(text); setTimeout(()=>setNotice(''), 4500) }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get('connected'), failed = params.get('connect_error')
    if (!connected && !failed) return
    setActive('Conturi social')
    showNotice(connected ? `Conectat: ${connected}` : `Conectarea a eșuat: ${failed}`)
    window.history.replaceState({}, '', window.location.pathname)
  }, [])
  useEffect(() => {
    if (!supabase) return
    let mounted = true
    supabase.auth.getSession().then(async ({ data }) => { if (mounted) { setSession(data.session); if(data.session?.user){try{setProfile(await getProfile(data.session.user.id))}catch{}} setAuthLoading(false) } })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])
  useEffect(() => {
    if (!session) return
    Promise.allSettled([listPosts(), listMedia()]).then(([postsResult, mediaResult]) => {
      if (postsResult.status === 'fulfilled') setPosts(postsResult.value.map(postFromDb))
      if (mediaResult.status === 'fulfilled') setMedia(mediaResult.value)
      const failed = [postsResult, mediaResult].find(result => result.status === 'rejected')
      if (failed) showNotice(`Unele date nu s-au putut încărca: ${failed.reason?.message || 'eroare Supabase'}`)
    })
  }, [session, active])
  const addPost = async () => {
    const draft = {time:'20:30',platform:'Instagram',color:'ig',title:'O surpriză de neuitat pentru cei mici',type:'Reel',status:'Ciornă'}
    if (session) {
      try { const created = await createPost({ platform:'instagram', title:draft.title, status:'draft', scheduled_for:new Date().toISOString() }); setPosts(p=>[...p, postFromDb(created)]); showNotice('Ciorna a fost salvată în Supabase'); return }
      catch (error) { showNotice(`Salvarea a eșuat: ${error.message}`); return }
    }
    setPosts(p=>[...p,draft]); showNotice('Ciorna a fost adăugată în modul demo')
  }
  if (authLoading) return <div className="auth-loading">Se verifică sesiunea administratorului…</div>
  if (isSupabaseConfigured && !session) return <AuthScreen />
  const render = () => {
    if(active==='Dashboard') return <Dashboard name={profile.full_name||'Administrator'} posts={posts} onNavigate={setActive}/>
    if(active==='Conturi social') return <Social onNotice={showNotice}/>
    if(active==='Media library') return <Media media={media} setMedia={setMedia} user={session?.user} onNotice={showNotice}/>
    if(active==='AI Content Studio') return <Studio prompt={prompt} setPrompt={setPrompt} generated={generated} setGenerated={setGenerated} user={session?.user} onNotice={showNotice}/>
    if(active==='Calendar editorial') return <Calendar posts={posts} onAdd={addPost} onNotice={showNotice}/>
    if(active==='Automatizări') return <Automation user={session?.user} onNotice={showNotice}/>
    if(active==='Grupuri Facebook') return <Groups user={session?.user} onNotice={showNotice}/>
    if(active==='Comentarii') return <Comments user={session?.user} onNotice={showNotice}/>
    if(active==='Analytics') return <Analytics/>
    return <Settings user={session?.user} profile={profile} setProfile={setProfile} onNotice={showNotice}/>
  }
  return <div className="app-shell">
    {menuOpen&&<div className="sidebar-backdrop" onClick={()=>setMenuOpen(false)}/>}<aside className={`sidebar ${menuOpen?'open':''}`}>
      <div className="brand"><div className="brand-mark">✦</div><div><strong>PostaMoșului</strong><span>AI command center</span></div></div>
      <div className="workspace"><span className="avatar">PM</span><div><b>PostaMoșului</b><small>Workspace principal</small></div><span className="chevron">⌄</span></div>
      <nav>{nav.map(([label,icon])=><button key={label} className={active===label?'active':''} onClick={()=>{setActive(label);setMenuOpen(false)}}><i>{icons[icon]}</i>{label}{label==='AI Content Studio' && <em>NEW</em>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="tip"><span>✦</span><div><b>Sezonul magic</b><small>{daysToChristmas()} zile până la Crăciun</small></div></div><div className="user"><span className="avatar gold">{(profile.full_name||'AD').slice(0,2).toUpperCase()}</span><div><b>{profile.full_name||'Administrator'}</b><small>Administrator</small></div><span>•••</span></div></div>
    </aside>
    <main className="main"><header><button className="mobile-menu" aria-label="Meniu" onClick={()=>setMenuOpen(v=>!v)}>☰</button><div className="crumb"><span>Workspace</span><b>/</b><strong>{active}</strong></div><div className="header-actions"><button className="icon-btn" aria-label="Caută" onClick={()=>setSearchOpen(v=>!v)}>⌕</button><button className="icon-btn notif" onClick={()=>setActive('Automatizări')}>♢<span></span></button><div className="date">{todayLabel({day:'numeric',month:'long',year:'numeric'})}</div></div>{searchOpen&&<div className="global-search"><input autoFocus value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Caută un modul..."/>{nav.filter(([label])=>label.toLowerCase().includes(searchQuery.toLowerCase())).map(([label])=><button key={label} onClick={()=>{setActive(label);setSearchOpen(false);setSearchQuery('')}}>{label}</button>)}</div>}</header>{!isSupabaseConfigured && <div className="demo-banner">Mod demo activ · configurează <code>.env.local</code> pentru autentificare și date persistente</div>}{notice && <div className={`toast ${/eșua|eroare|nu s-a|invalid|incorrect|lipse|refuz|nu există|nu este/i.test(notice)?'toast-error':''}`}>{/eșua|eroare|nu s-a|invalid|incorrect|lipse|refuz|nu există|nu este/i.test(notice)?'⚠':'✓'} {notice}</div>}<div className="content">{render()}</div></main>
  </div>
}
function postFromDb(post){ const meta=PLATFORM[post.platform]||PLATFORM.instagram; return { ...post, rawStatus:post.status, time: post.scheduled_for ? new Date(post.scheduled_for).toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'}) : '—', platform:meta.label, color:meta.color, type:meta.type, status:STATUS[post.status]||post.status } }
function AuthScreen(){
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  const signIn=async(e)=>{e.preventDefault();setBusy(true);setError('');const {error:authError}=await supabase.auth.signInWithPassword({email,password});if(authError)setError('Emailul sau parola sunt incorecte.');setBusy(false)}
  return <div className="auth-screen"><div className="auth-card"><div className="brand-mark">✦</div><div className="eyebrow">POSTAMOȘULUI AI</div><h1>Bine ai revenit</h1><p>Autentifică-te pentru a accesa command center-ul.</p><form onSubmit={signIn}><label>Email administrator<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label><label>Parolă<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label>{error&&<div className="auth-error">{error}</div>}<button className="primary wide" disabled={busy}>{busy?'Se autentifică…':'Intră în dashboard →'}</button></form><small>Acces restricționat administratorilor aprobați.</small></div></div>
}
function PageTitle({eyebrow,title,desc,action}){return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{desc}</p></div>{action}</div>}
function Dashboard({name,posts,onNavigate}){
  const raw=posts.filter(p=>p.rawStatus)
  const pending=raw.filter(p=>p.rawStatus==='pending_approval').length
  const scheduledCount=raw.filter(p=>p.rawStatus==='scheduled').length
  const published=raw.filter(p=>p.rawStatus==='published').length
  const failed=raw.filter(p=>p.rawStatus==='failed').length
  const upcoming=raw.filter(p=>['pending_approval','scheduled'].includes(p.rawStatus)&&p.scheduled_for&&new Date(p.scheduled_for)>new Date()).sort((a,b)=>new Date(a.scheduled_for)-new Date(b.scheduled_for)).slice(0,5)
  const days=Array.from({length:14},(_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+i);return d})
  const perDay=days.map(d=>raw.filter(p=>p.scheduled_for&&localDay(new Date(p.scheduled_for))===localDay(d)&&p.rawStatus!=='draft').length)
  const max=Math.max(4,...perDay)
  return <><PageTitle eyebrow={todayLabel({weekday:'long',day:'numeric',month:'long',year:'numeric'})} title={<>{new Date().getHours()<12?'Bună dimineața':new Date().getHours()<18?'Bună ziua':'Bună seara'}, {name} <span className="red">✦</span></>} desc="Ce ai de aprobat și ce urmează să se publice." action={<button className="primary" onClick={()=>onNavigate('Calendar editorial')}>Deschide aprobările</button>}/>
  <div className="stats"><Stat label="De aprobat" value={pending} change="necesită acțiune" tone="red" note="Calendar → De aprobat"/><Stat label="Programate" value={scheduledCount} change="aprobate" tone="gold" note="se publică automat"/><Stat label="Publicate" value={published} change="total" tone="green" note="pe toate platformele"/><Stat label="Eșuate" value={failed} change={failed?'de verificat':'nicio problemă'} tone={failed?'red':'green'} note="motivul apare în calendar"/></div>
  <div className="dashboard-grid"><section className="card activity"><CardHead title="Postări în următoarele 14 zile"/><div className="chart"><div className="chart-labels"><span>{max}</span><span></span><span>{Math.round(max/2)}</span><span></span><span>0</span></div><div className="bars">{perDay.map((v,i)=><div className="bar-wrap" key={i} title={`${days[i].toLocaleDateString('ro-RO',{day:'numeric',month:'short'})}: ${v} postări`}><div className={i===0?'bar hot':'bar'} style={{height:`${Math.max(2,v/max*100)}%`}}></div></div>)}</div></div><div className="chart-days">{[0,3,6,9,13].map(i=><span key={i}>{days[i].toLocaleDateString('ro-RO',{day:'numeric',month:'short'})}</span>)}</div></section>
  <section className="card quick"><CardHead title="Acces rapid"/><Quick icon="✓" title="Aprobă clipurile" desc={`${pending} așteaptă`} onClick={()=>onNavigate('Calendar editorial')}/><Quick icon="▣" title="Media library" desc="Clipurile tale" onClick={()=>onNavigate('Media library')}/><Quick icon="◎" title="Conturi social" desc="Conectează rețelele" onClick={()=>onNavigate('Conturi social')}/></section></div>
  <section className="card schedule"><CardHead title="Următoarele postări" link="Deschide calendarul" onClick={()=>onNavigate('Calendar editorial')}/><div className="post-list">{upcoming.length?upcoming.map(p=><PostRow key={p.id} p={{...p,time:new Date(p.scheduled_for).toLocaleString('ro-RO',{weekday:'short',hour:'2-digit',minute:'2-digit'})}}/>):<p className="muted">Nu ai postări programate.</p>}</div></section></>}
function Stat({label,value,change,tone,note}){return <div className="stat"><span>{label}</span><div><strong>{value}</strong><em className={tone}>{change}</em></div><small>{note}</small></div>}
function CardHead({title,link,onClick}){return <div className="card-head"><h2>{title}</h2>{link&&<button className="text-btn" onClick={onClick}>{link} →</button>}</div>}
function Quick({icon,title,desc,onClick}){return <button className="quick-row" onClick={onClick}><span className="quick-icon">{icon}</span><span><b>{title}</b><small>{desc}</small></span><i>→</i></button>}
function PostRow({p}){return <div className="post-row"><span className={'platform '+p.color}>{(Object.values(PLATFORM).find(x=>x.label===p.platform)||PLATFORM.youtube).icon}</span><div className="post-copy"><b>{p.title}</b><small>{p.platform} · {p.type}</small></div><time>{p.time}</time><span className={'status '+(p.status==='În aprobare'?'pending':'')}>{p.status}</span><button className="more">•••</button></div>}
function Social({onNotice}){
  const [accounts,setAccounts]=useState([]),[busy,setBusy]=useState('')
  useEffect(()=>{listSocialAccounts().then(setAccounts).catch(()=>{})},[])
  const find=platform=>accounts.find(a=>a.platform===platform&&a.status==='connected')
  const connect=async provider=>{setBusy(provider);try{await startConnect(provider)}catch(error){onNotice(`Conectarea nu a pornit: ${error.message}`);setBusy('')}}
  const cards=[
    {provider:'meta',title:'Facebook + Instagram',logo:'f',kind:'fb',api:'Meta Graph API',accounts:['facebook','instagram'],cap:'Reels pe Pagină și Instagram · răspunsuri AI la comentarii'},
    {provider:'youtube',title:'YouTube',logo:'▶',kind:'yt',api:'YouTube Data API v3',accounts:['youtube'],cap:'Shorts publice · răspunsuri AI la comentarii'},
    {provider:'tiktok',title:'TikTok',logo:'♪',kind:'tt',api:'TikTok Content Posting API',accounts:['tiktok'],cap:'Trimis în inbox, publici din aplicație'},
  ]
  return <><PageTitle eyebrow="DISTRIBUȚIE" title="Conturi social" desc="Conectează conturile oficiale. Tokenurile rămân doar pe server."/>
  <div className="accounts">{cards.map(card=>{const connected=card.accounts.map(find).filter(Boolean);return <div className="account-card" key={card.provider}><div className={'account-logo '+card.kind}>{card.logo}</div><h2>{card.title}</h2><p>{card.api}</p><span className="account-cap">{card.cap}</span>
    {connected.length?<div className="connected-list">{card.accounts.map(platform=>{const acc=find(platform);return <div key={platform} className={acc?'connected':'missing'}>{acc?'✓':'—'} {PLATFORM[platform].label}: <b>{acc?acc.account_name:'neconectat'}</b></div>})}</div>:null}
    <button className="outline" disabled={busy===card.provider} onClick={()=>connect(card.provider)}>{busy===card.provider?'Se deschide…':connected.length?'Reconectează':'Conectează contul'} <span>→</span></button></div>})}</div>
  <div className="card security"><div className="security-icon">⌁</div><div><b>Tokenuri protejate</b><p>Tokenurile sunt salvate într-un tabel la care interfața nu are acces. Doar funcțiile de pe server le folosesc pentru publicare.</p></div><span className="pill">{accounts.filter(a=>a.status==='connected').length} CONECTATE</span></div></>}
function MediaCard({m,onRemove,usage}){
  const [meta,setMeta]=useState(null)
  const onMeta=e=>{const v=e.currentTarget;setMeta({vertical:v.videoHeight>v.videoWidth,duration:v.duration})}
  const size=m.size||`${((m.size_bytes||0)/1024/1024).toFixed(1)} MB`
  const dur=meta?.duration?`${Math.round(meta.duration)} s`:null
  const added=m.created_at?new Date(m.created_at).toLocaleDateString('ro-RO',{day:'numeric',month:'short'}):'acum'
  return <div className={`media-card ${meta?(meta.vertical?'is-vertical':'is-horizontal'):''}`}>
    <div className="media-frame">{m.preview_url?(m.mime_type?.startsWith('image/')?<img src={m.preview_url} alt="" onLoad={e=>setMeta({vertical:e.currentTarget.naturalHeight>e.currentTarget.naturalWidth})}/>:<video src={m.preview_url} controls playsInline preload="metadata" onLoadedMetadata={onMeta}/>):<span className="media-placeholder">▶</span>}
      {meta&&<span className="media-badge">{m.mime_type?.startsWith('image/')?'Imagine':meta.vertical?'9:16':'16:9'}{dur?` · ${dur}`:''}</span>}</div>
    <div className="media-info"><b title={m.name}>{m.name}</b><small>{size} · {added}{usage?` · folosit în ${usage} postări`:''}</small>
      {m.id&&<button className="media-delete" onClick={()=>onRemove(m)}>Șterge</button>}</div>
  </div>
}
function Media({media,setMedia,user,onNotice}){
  const [query,setQuery]=useState(''),[orientation,setOrientation]=useState('toate'),[usage,setUsage]=useState({}),[uploading,setUploading]=useState(false)
  useEffect(()=>{if(user)listPosts().then(rows=>{const counts={};rows.filter(p=>['pending_approval','scheduled','publishing'].includes(p.status)).forEach(p=>{if(p.media_id)counts[p.media_id]=(counts[p.media_id]||0)+1});setUsage(counts)}).catch(()=>{})},[user,media.length])
  const onFile=async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;if(!user){onNotice('Autentifică-te pentru a încărca');return}setUploading(true);try{const asset=await uploadMedia(f,user.id);setMedia(m=>[asset,...m]);onNotice('Videoclipul a fost încărcat')}catch(error){onNotice(`Încărcarea a eșuat: ${error.message}`)}finally{setUploading(false)}}
  const remove=async asset=>{if(!user)return;const used=usage[asset.id];if(!window.confirm(used?`Clipul e folosit în ${used} postări programate. Dacă îl ștergi, acele postări rămân fără video. Ștergi oricum?`:`Ștergi „${asset.name}”?`))return;try{await deleteMedia(asset);setMedia(items=>items.filter(item=>item.id!==asset.id));onNotice('Videoclipul a fost șters')}catch(error){onNotice(`Ștergerea a eșuat: ${error.message}`)}}
  const visible=media.filter(item=>item.name.toLowerCase().includes(query.toLowerCase()))
  return <><PageTitle eyebrow="BIBLIOTECĂ" title="Media library" desc="Toate clipurile tale, inclusiv cele generate automat pentru reclame." action={<label className="primary upload">{uploading?'Se încarcă…':'＋ Încarcă media'}<input type="file" accept="video/*,image/*" onChange={onFile} disabled={uploading}/></label>}/>
  <div className="media-toolbar"><div className="search">⌕ <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Caută în bibliotecă..."/></div><span className="muted">{visible.length} clipuri</span></div>
  {!visible.length&&<div className="card empty-media"><span>▣</span><b>Nu ai încă niciun clip</b><p className="muted">Încarcă un videoclip sau așteaptă clipurile generate zilnic.</p></div>}
  <div className="media-grid-v2">{visible.map((m,i)=><MediaCard key={m.id||i} m={m} onRemove={remove} usage={usage[m.id]}/>)}</div></>}
function Studio({prompt,setPrompt,generated,setGenerated,user,onNotice}){const [platform,setPlatform]=useState('instagram_reel');const [tone,setTone]=useState('cald și inspirațional');const generate=async()=>{if(!user){setGenerated({title:'Un mesaj magic pentru fiecare copil ✨',body:'Uneori, cele mai frumoase daruri nu încap într-o cutie. Scrie-i lui Moș Crăciun și lasă-ne să transformăm dorința într-o amintire de neuitat. 🎄',tags:'#PostaMosului #MagiaCraciunului #PovestiDeNeuitat #Familie',platform});onNotice('Preview demo — autentifică-te pentru OpenAI real');return}try{const result=await generateContent({prompt,platform,tone,variation:Date.now()});setGenerated({title:result.title,body:result.body,tags:(result.hashtags||[]).join(' '),platform});onNotice(`Conținut generat pentru ${platform.replace('_',' ')}`)}catch(error){onNotice(`Generarea a eșuat: ${error.message}`)}};const save=async()=>{if(!user){onNotice('Draftul este disponibil doar după autentificare');return}try{const dbPlatform=generated.platform==='tiktok_video'?'tiktok':generated.platform==='youtube_short'?'youtube':generated.platform==='facebook_reel'?'facebook':'instagram';await createContentVariant({owner_id:user.id,platform:dbPlatform,title:generated.title,body:generated.body,hashtags:generated.tags.split(' '),generation_prompt:prompt,approval_status:'draft'});onNotice('Varianta a fost salvată în Supabase')}catch(error){onNotice(`Salvarea a eșuat: ${error.message}`)}};return <><PageTitle eyebrow="INTELIGENȚĂ CREATIVĂ" title="AI Content Studio" desc="Transformă o idee simplă în conținut gata de publicat, adaptat pentru fiecare canal."/><div className="studio-layout"><section className="card studio-form"><div className="form-label">DESPRE CE VREI SĂ VORBEȘTI?</div><textarea value={prompt} onChange={e=>setPrompt(e.target.value)}/><div className="form-row"><label>Platformă<select value={platform} onChange={e=>setPlatform(e.target.value)}><option value="instagram_reel">Instagram · Reel</option><option value="facebook_reel">Facebook · Reel</option><option value="youtube_short">YouTube · Short</option><option value="tiktok_video">TikTok · Video</option></select></label><label>Ton<select value={tone} onChange={e=>setTone(e.target.value)}><option>Cald și inspirațional</option><option>Jucăuș</option><option>Premium</option></select></label></div><button className="primary wide" onClick={generate}>✦ Generează conținut</button><small className="muted">Conținutul este generat server-side și poate folosi modul gratuit local.</small></section><section className="card generated">{generated?<><div className="generated-top"><span className="eyebrow">PREVIEW · {String(generated.platform||platform).replace('_',' ').toUpperCase()}</span><button className="text-btn" onClick={()=>navigator.clipboard?.writeText(generated.body)}>Copiază</button></div><h2>{generated.title}</h2><p>{generated.body}</p><div className="tags">{generated.tags}</div><div className="generated-actions"><button className="outline" onClick={generate}>↻ Regenerează</button><button className="primary" onClick={save}>Salvează draftul</button></div></>:<div className="empty-studio"><span>✦</span><h2>Ideea ta, următoarea poveste</h2><p>Completează brief-ul din stânga și lasă AI-ul să găsească unghiul perfect.</p></div>}</section></div></>}
function Composer({onClose,onCreated,onNotice}){
  const [media,setMedia]=useState([]),[mediaId,setMediaId]=useState(''),[platforms,setPlatforms]=useState(['tiktok','facebook','instagram','youtube'])
  const tomorrow=new Date(Date.now()+86400000)
  const [day,setDay]=useState(localDay(tomorrow)),[time,setTime]=useState('19:30'),[title,setTitle]=useState(''),[body,setBody]=useState(''),[tags,setTags]=useState('#PostaMosului #MosCraciun #Craciun'),[busy,setBusy]=useState(false)
  useEffect(()=>{listMedia().then(all=>{const items=all.filter(m=>!m.mime_type?.startsWith('image/'));setMedia(items);if(items[0])setMediaId(items[0].id)}).catch(()=>{})},[])
  const toggle=p=>setPlatforms(list=>list.includes(p)?list.filter(x=>x!==p):[...list,p])
  const preview=media.find(m=>m.id===mediaId)?.preview_url
  const submit=async()=>{
    if(!mediaId){onNotice('Alege un videoclip din Media library');return}
    if(!platforms.length){onNotice('Alege cel puțin o platformă');return}
    if(!title.trim()){onNotice('Scrie un titlu');return}
    const when=new Date(`${day}T${time}:00`)
    if(Number.isNaN(when.getTime())||when<new Date()){onNotice('Alege o dată și o oră din viitor');return}
    setBusy(true)
    try{
      const hashtags=tags.split(/\s+/).filter(Boolean)
      for(const platform of platforms) await createPost({platform,title:title.trim(),body:body.trim()||title.trim(),hashtags,media_id:mediaId,status:'pending_approval',scheduled_for:when.toISOString(),metadata:{source:'manual'}})
      onCreated()
    }catch(error){onNotice(`Nu am putut crea postările: ${error.message}`)}finally{setBusy(false)}
  }
  return <div className="modal-backdrop" onClick={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal" role="dialog" aria-label="Postare nouă">
    <h2>Postare nouă</h2>
    <label>Videoclip<select value={mediaId} onChange={e=>setMediaId(e.target.value)}>{!media.length&&<option value="">Nu ai clipuri în Media library</option>}{media.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    {preview&&<div className="queue-video" style={{maxWidth:150}}><video src={preview} controls playsInline preload="metadata"/></div>}
    <label>Platforme<div className="platform-picks">{Object.entries(PLATFORM).map(([key,p])=><button type="button" key={key} className={platforms.includes(key)?'on':''} onClick={()=>toggle(key)}>{p.icon} {p.label}</button>)}</div></label>
    <div className="row"><label>Data<input type="date" value={day} onChange={e=>setDay(e.target.value)}/></label><label>Ora<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label></div>
    <label>Titlu (YouTube folosește titlul)<input value={title} maxLength={100} onChange={e=>setTitle(e.target.value)} placeholder="ex. Moșul știe cum îl cheamă pe copilul tău"/></label>
    <label>Text postare<textarea value={body} onChange={e=>setBody(e.target.value)} placeholder="Descrierea care apare sub clip"/></label>
    <label>Hashtag-uri<input value={tags} onChange={e=>setTags(e.target.value)}/></label>
    <div className="modal-actions"><button className="outline" onClick={onClose}>Renunță</button><button className="primary" disabled={busy} onClick={submit}>{busy?'Se creează…':`Adaugă la aprobare (${platforms.length})`}</button></div>
  </div></div>
}
function Calendar({posts,onAdd,onNotice}){
  const [livePosts,setLivePosts]=useState(posts)
  const [week,setWeek]=useState(0)
  const [previews,setPreviews]=useState({})
  const [busy,setBusy]=useState('')
  const reload=()=>listPosts().then(rows=>setLivePosts(rows.map(postFromDb))).catch(()=>setLivePosts(posts))
  useEffect(()=>{reload()},[posts])
  useEffect(()=>{listMedia().then(items=>setPreviews(Object.fromEntries(items.map(item=>[item.id,item.preview_url])))).catch(()=>{})},[])
  const monday=new Date(); monday.setHours(0,0,0,0); monday.setDate(monday.getDate()-((monday.getDay()+6)%7)+week*7)
  const days=Array.from({length:7},(_,i)=>{const d=new Date(monday);d.setDate(monday.getDate()+i);return {label:d.toLocaleDateString('ro-RO',{weekday:'short',day:'numeric'}),date:localDay(d)}})
  const todayKey=localDay(new Date())
  const times=['09:00','12:00','15:00','18:00','21:00']
  const eventFor=(dayIndex,rowIndex)=>livePosts.filter(post=>{
    if(!post.scheduled_for)return false
    const date=new Date(post.scheduled_for)
    const row=Math.min(4,Math.max(0,Math.round((date.getHours()-9)/3)))
    return localDay(date)===days[dayIndex].date&&row===rowIndex
  })
  const replace=updated=>setLivePosts(current=>current.map(item=>item.id===updated.id?postFromDb(updated):item))
  const run=async(post,action)=>{setBusy(post.id);try{await action()}catch(error){onNotice(error.message)}finally{setBusy('')}}
  const approve=post=>run(post,async()=>{replace(await updatePost(post.id,{status:'scheduled',last_error:null}));onNotice('Aprobată. Se publică automat la ora programată.')})
  const reject=post=>run(post,async()=>{replace(await updatePost(post.id,{status:'draft'}));onNotice('Postarea a fost respinsă și mutată la ciorne')})
  const now=post=>{const when=post.scheduled_for?new Date(post.scheduled_for):null;if(when&&when.getTime()-Date.now()>60*60000&&!window.confirm(`Postarea e programată pe ${when.toLocaleString('ro-RO',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}. O publici acum, înainte de data ei?`))return;return run(post,async()=>{if(post.rawStatus==='pending_approval')await updatePost(post.id,{status:'scheduled'});const result=await publishNow(post.id);const r=result.results?.[0];await reload();onNotice(r?.status==='published'?'Publicată!':r?.status==='publishing'?'Platforma procesează clipul, se publică în câteva minute':`Publicarea a eșuat: ${r?.error||'necunoscut'}`)})}
  const remove=post=>{if(!window.confirm(`Ștergi postarea „${post.title}” de pe ${post.platform}? Clipul rămâne în Media library.`))return;run(post,async()=>{await deletePost(post.id);setLivePosts(current=>current.filter(item=>item.id!==post.id));onNotice('Postarea a fost ștearsă')})}
  const [composer,setComposer]=useState(false)
  const displayTitle=(title)=>{const clean=String(title||'Postare').replace(/\s+/g,' ').trim();return clean.length>28?`${clean.slice(0,28)}…`:clean}
  const queue=livePosts.filter(post=>['pending_approval','scheduled','publishing','failed'].includes(post.rawStatus)).sort((a,b)=>new Date(a.scheduled_for||0)-new Date(b.scheduled_for||0))
  const drafts=livePosts.filter(post=>post.rawStatus==='draft')
  const recent=livePosts.filter(post=>post.rawStatus==='published').sort((a,b)=>new Date(b.published_at||0)-new Date(a.published_at||0)).slice(0,6)
  const monthLabel=monday.toLocaleDateString('ro-RO',{month:'long',year:'numeric'})
  return <><PageTitle eyebrow="PLANIFICARE" title="Calendar editorial" desc="Aprobă clipurile, iar platforma le publică automat la ora lor." action={<button className="primary" onClick={()=>setComposer(true)}>＋ Postare nouă</button>}/>
  {composer&&<Composer onClose={()=>setComposer(false)} onCreated={()=>{setComposer(false);reload();onNotice('Postările au fost adăugate la „De aprobat”')}} onNotice={onNotice}/>}
  <section className="card queue-card"><CardHead title={`De aprobat și în lucru (${queue.length})`}/>
    {!queue.length&&<p className="muted">Nu ai nimic în așteptare. Programează clipuri din „Automatizări”.</p>}
    <div className="queue">{queue.map(post=><div className={`queue-item ${post.rawStatus}`} key={post.id}>
      <div className="queue-video">{previews[post.media_id]?<video src={previews[post.media_id]} controls playsInline preload="metadata"/>:<span>{post.media_id?'▶':'Fără video'}</span>}</div>
      <div className="queue-body">
        <div className="queue-meta"><span className={'platform '+post.color}>{(PLATFORM[post.platform?.toLowerCase()]||{}).icon||'•'}</span><b>{post.platform}</b><small>{post.scheduled_for?new Date(post.scheduled_for).toLocaleString('ro-RO',{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'fără oră'}</small><span className={'status '+(post.rawStatus==='failed'?'failed':post.rawStatus==='pending_approval'?'pending':'')}>{post.status}</span></div>
        <h3>{post.title}</h3><p>{post.body}</p>{post.hashtags?.length>0&&<div className="tags">{post.hashtags.join(' ')}</div>}
        {post.last_error&&<div className={post.rawStatus==='failed'?'queue-error':'queue-note'}>{post.last_error}</div>}
        <div className="queue-actions">
          {post.rawStatus==='pending_approval'&&<><button className="primary small" disabled={busy===post.id} onClick={()=>approve(post)}>✓ Aprobă</button><button className="outline small" disabled={busy===post.id} onClick={()=>reject(post)}>Respinge</button></>}
          {['pending_approval','scheduled'].includes(post.rawStatus)&&<button className="outline small" disabled={busy===post.id} onClick={()=>now(post)}>Publică acum</button>}
          {post.rawStatus==='failed'&&<button className="primary small" disabled={busy===post.id} onClick={()=>now(post)}>↻ Reîncearcă</button>}
          {post.rawStatus==='publishing'&&<small className="muted">Se publică…</small>}
          {post.rawStatus!=='publishing'&&<button className="outline small danger" disabled={busy===post.id} onClick={()=>remove(post)}>Șterge</button>}
        </div>
      </div></div>)}</div>
    {drafts.length>0&&<><h3 className="queue-subtitle">Ciorne și respinse ({drafts.length})</h3><div className="recent-list">{drafts.map(post=><div className="post-row" key={post.id}><span className={'platform '+post.color}>{(PLATFORM[post.platform?.toLowerCase()]||{}).icon}</span><div className="post-copy"><b>{post.title}</b><small>{post.platform} · ciornă</small></div><button className="text-btn" onClick={()=>run(post,async()=>{replace(await updatePost(post.id,{status:'pending_approval'}));onNotice('Mutată înapoi la „De aprobat”')})}>Readu</button><button className="text-btn" onClick={()=>remove(post)}>Șterge</button></div>)}</div></>}
    {recent.length>0&&<><h3 className="queue-subtitle">Publicate recent</h3><div className="recent-list">{recent.map(post=><div className="post-row" key={post.id}><span className={'platform '+post.color}>{(PLATFORM[post.platform?.toLowerCase()]||{}).icon}</span><div className="post-copy"><b>{post.title}</b><small>{post.platform} · {post.published_at?new Date(post.published_at).toLocaleString('ro-RO',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):''}{post.last_error?` · ${post.last_error}`:''}</small></div>{post.external_url&&<a className="text-btn" href={post.external_url} target="_blank" rel="noreferrer">Vezi →</a>}</div>)}</div></>}
  </section>
  <div className="calendar-top"><button className="outline" onClick={()=>setWeek(w=>w-1)}>‹</button><h2>{monthLabel}</h2><button className="outline" onClick={()=>setWeek(w=>w+1)}>›</button>{week!==0&&<button className="text-btn" onClick={()=>setWeek(0)}>Azi</button>}</div><div className="calendar-card card"><div className="week-head"><span></span>{days.map(day=><span className={day.date===todayKey?'today':''} key={day.date}>{day.label}</span>)}</div><div className="week-body">{times.map((t,i)=><div className="time-row" key={t}><time>{t}</time>{days.map((_,d)=><div className="slot" key={d}>{eventFor(d,i).map(post=><div className={`event ${post.color}-event`} key={post.id}><b title={post.title}>{displayTitle(post.title)}</b><small>{post.platform} · {post.status}</small>{post.rawStatus!=='publishing'&&post.rawStatus!=='published'&&<button className="event-delete" title="Șterge postarea" onClick={()=>remove(post)}>✕</button>}{post.rawStatus==='pending_approval'&&<button className="approve-btn" onClick={()=>approve(post)}>Aprobă</button>}</div>)}</div>)}</div>)}</div></div><div className="calendar-foot"><span><i className="dot red-dot"/>Instagram</span><span><i className="dot blue-dot"/>Facebook</span><span><i className="dot gold-dot"/>YouTube</span><span><i className="dot tt-dot"/>TikTok</span><small>{livePosts.filter(post=>post.rawStatus==='pending_approval').length} în aprobare · {livePosts.length} postări</small></div></>}
async function fetchFile(url,name,type){const blob=await (await fetch(url)).blob();return new File([blob],name,{type:type||blob.type})}
function GroupDraftCard({draft,group,media,onDone,onSkip,onNotice}){
  const [busy,setBusy]=useState(false)
  const isImage=media?.mime_type?.startsWith('image/')
  const copy=async()=>{try{await navigator.clipboard.writeText(draft.body);onNotice('Textul a fost copiat')}catch{onNotice('Nu am putut copia; selectează textul manual')}}
  const download=async()=>{if(!media?.preview_url)return;setBusy(true);try{const file=await fetchFile(media.preview_url,media.name,media.mime_type);const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=media.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000)}catch{window.open(media.preview_url,'_blank')}finally{setBusy(false)}}
  const share=async()=>{if(!media?.preview_url)return;setBusy(true);try{await navigator.clipboard?.writeText(draft.body).catch(()=>{});const file=await fetchFile(media.preview_url,media.name,media.mime_type);if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],text:draft.body})}else{onNotice('Telefonul nu permite trimiterea directă; folosește Descarcă')}}catch(e){if(e?.name!=='AbortError')onNotice('Trimiterea a fost anulată')}finally{setBusy(false)}}
  return <div className="queue-item">
    <div className="queue-video">{media?.preview_url?(isImage?<img src={media.preview_url} alt=""/>:<video src={media.preview_url} controls playsInline preload="metadata"/>):<span>Fără media</span>}</div>
    <div className="queue-body">
      <div className="queue-meta"><span className="platform fb">f</span><b>{group?.group_name||'Grup'}</b><small>{isImage?'Imagine':'Clip'}</small>{group?.group_url&&<a className="text-btn" href={group.group_url} target="_blank" rel="noreferrer">Deschide grupul →</a>}</div>
      <p className="group-text">{draft.body}</p>
      <div className="queue-actions">
        <button className="outline small" onClick={copy}>Copiază textul</button>
        <button className="outline small" disabled={busy||!media} onClick={download}>Descarcă {isImage?'poza':'clipul'}</button>
        {typeof navigator!=='undefined'&&navigator.share&&<button className="outline small" disabled={busy||!media} onClick={share}>Trimite din telefon</button>}
        <button className="primary small" onClick={()=>onDone(draft)}>✓ Am postat</button>
        <button className="outline small danger" onClick={()=>onSkip(draft)}>Sari peste</button>
      </div>
    </div></div>
}
function Groups({user,onNotice}){
  const [groups,setGroups]=useState([]),[drafts,setDrafts]=useState([]),[media,setMedia]=useState({}),[name,setName]=useState(''),[link,setLink]=useState(''),[busy,setBusy]=useState(''),[memFilter,setMemFilter]=useState('all')
  const load=()=>Promise.all([listGroupCandidates(),listGroupDrafts(),listMedia()]).then(([g,d,m])=>{setGroups(g);setDrafts(d);setMedia(Object.fromEntries(m.map(x=>[x.id,x])))}).catch(e=>onNotice(`Nu am putut încărca grupurile: ${e.message}`))
  useEffect(()=>{if(user)load()},[user])
  const byId=Object.fromEntries(groups.map(g=>[g.id,g]))
  const endOfToday=new Date();endOfToday.setHours(23,59,59,999)
  const open=drafts.filter(d=>['pending_approval','approved','draft'].includes(d.status)&&byId[d.group_id]?.status!=='excluded')
  const todo=open.filter(d=>d.media_id&&(!d.scheduled_for||new Date(d.scheduled_for)<=endOfToday))
  const upcoming=open.filter(d=>d.scheduled_for&&new Date(d.scheduled_for)>endOfToday).sort((a,b)=>a.scheduled_for.localeCompare(b.scheduled_for))
  const lastPosted=id=>{const d=drafts.find(x=>x.group_id===id&&x.status==='posted');return d?.posted_at?new Date(d.posted_at).toLocaleDateString('ro-RO',{day:'numeric',month:'short'}):null}
  const postedCount=id=>drafts.filter(x=>x.group_id===id&&x.status==='posted').length
  const add=async()=>{if(!name.trim()){onNotice('Scrie numele grupului');return}if(link.trim()&&!/^https:\/\/(www\.|m\.)?facebook\.com\/groups\//.test(link.trim())){onNotice('Linkul trebuie să fie de forma https://facebook.com/groups/…');return}setBusy('add');try{await createGroupCandidate({owner_id:user.id,external_group_id:`manual-${Date.now()}`,group_name:name.trim(),group_url:link.trim()||null,status:'shortlisted',language:'ro',category:'manual'});setName('');setLink('');await load();onNotice('Grupul a fost adăugat în rotație')}catch(e){onNotice(`Salvarea a eșuat: ${e.message}`)}finally{setBusy('')}}
  const done=async d=>{try{await updateGroupDraft(d.id,{status:'posted',posted_at:new Date().toISOString()});await load();onNotice('Marcat ca postat')}catch(e){onNotice(e.message)}}
  const skip=async d=>{try{await updateGroupDraft(d.id,{status:'rejected'});await load()}catch(e){onNotice(e.message)}}
  const editGroupLink=async g=>{const url=(window.prompt(`Linkul grupului „${g.group_name}” (https://www.facebook.com/groups/...)`,g.group_url||'')||'').trim();if(!url)return;if(!/^https:\/\/(www\.|m\.)?facebook\.com\/groups\//.test(url)){onNotice('Linkul trebuie să fie de forma https://www.facebook.com/groups/...');return}try{await updateGroupCandidate(g.id,{group_url:url});await load();onNotice('Linkul a fost salvat')}catch(e){onNotice(e.message)}}
  const toggleGroup=async g=>{try{await updateGroupCandidate(g.id,{status:g.status==='excluded'?'shortlisted':'excluded'});await load()}catch(e){onNotice(e.message)}}
  const suggestions=groups.filter(g=>g.status==='discovered')
  const listed=groups.filter(g=>g.status!=='discovered')
  const mem=g=>g.metadata?.membership||'none'
  const setMembership=async(g,m)=>{try{await updateGroupCandidate(g.id,{metadata:{...(g.metadata||{}),membership:m,membership_at:new Date().toISOString()}});await load();onNotice(m==='joined'?`Marcat ca înscris: ${g.group_name}`:m==='requested'?'Notat: cerere trimisă, aștepți aprobarea adminului':'Marcat ca neînscris')}catch(e){onNotice(e.message)}}
  const mine=listed.filter(g=>!g.metadata?.declined)
  const counts={joined:mine.filter(g=>mem(g)==='joined').length,requested:mine.filter(g=>mem(g)==='requested').length,none:mine.filter(g=>mem(g)==='none').length}
  const active=mine.filter(g=>g.status!=='excluded'&&mem(g)==='joined').length
  const order={joined:0,requested:1,none:2}
  const shown=mine.filter(g=>memFilter==='all'||mem(g)===memFilter).sort((a,b)=>order[mem(a)]-order[mem(b)]||(a.status==='excluded')-(b.status==='excluded'))
  const accept=async g=>{if(g.group_url)window.open(g.group_url,'_blank','noopener');try{await updateGroupCandidate(g.id,{status:'shortlisted'});await load();onNotice(g.group_url?'Adăugat în rotație. În tab-ul Facebook deschis apasă „Înscrie-te”.':'Adăugat în rotație. Grupul nu are link — adaugă-l ca să-l poți deschide.')}catch(e){onNotice(e.message)}}
  const decline=async g=>{try{await updateGroupCandidate(g.id,{status:'excluded',metadata:{...(g.metadata||{}),declined:true}});await load()}catch(e){onNotice(e.message)}}
  return <><PageTitle eyebrow="GRUPURI FACEBOOK" title="Grupuri Facebook" desc="5 postări pe zi în grupuri, pregătite automat. Tu doar le postezi."/>
  <div className="group-note">♢ <span>Meta nu permite postarea automată în grupuri: contul ar risca blocarea. Platforma pregătește textul și media, tu postezi manual (~1 minut pe grup).</span></div>
  <section className="card queue-card"><CardHead title={`De postat azi (${todo.length})`}/>
    {!todo.length&&<p className="muted">Nimic de postat acum. Postările pentru grupuri apar aici în fiecare dimineață.</p>}
    <div className="queue">{todo.map(d=><GroupDraftCard key={d.id} draft={d} group={byId[d.group_id]} media={media[d.media_id]} onDone={done} onSkip={skip} onNotice={onNotice}/>)}</div>
  </section>
  {upcoming.length>0&&<section className="card" style={{marginBottom:16}}><CardHead title={`Programate (${upcoming.length})`}/>
    <p className="muted">Apar la „De postat azi” în ziua lor.</p>
    <div className="groups-list">{upcoming.map(d=><div className="group-row" key={d.id}><div className="group-avatar">{(byId[d.group_id]?.group_name||'?').charAt(0)}</div><div className="group-main"><b>{byId[d.group_id]?.group_name||'Grup'}</b><span>{d.body.slice(0,110)}{d.body.length>110?'…':''}</span></div><span className="tag">{new Date(d.scheduled_for).toLocaleDateString('ro-RO',{weekday:'short',day:'numeric',month:'short'})}</span></div>)}</div>
  </section>}
  {suggestions.length>0&&<section className="card" style={{marginBottom:16}}><CardHead title={`Sugestii găsite (${suggestions.length})`}/>
    <p className="muted">Grupuri găsite automat. Deschide-l, citește regulile, intră în grup și apoi apasă „Adaug”.</p>
    <div className="groups-list">{suggestions.sort((a,b)=>(b.relevance_score||0)-(a.relevance_score||0)).map(g=><div className="group-row" key={g.id}><div className="group-avatar">{g.group_name.charAt(0)}</div><div className="group-main"><b>{g.group_name}</b><span>{g.member_count?`${g.member_count.toLocaleString('ro-RO')} membri · `:''}{g.metadata?.privacy?`${g.metadata.privacy} · `:''}{g.metadata?.reason||g.category||''}</span></div>{g.relevance_score?<div className="relevance"><small>POTRIVIRE</small><b>{Math.round(g.relevance_score)}%</b></div>:null}<a className="outline small" href={g.group_url} target="_blank" rel="noreferrer">Deschide</a><button className="primary small" onClick={()=>accept(g)} title="Adaugă în rotație și deschide grupul pe Facebook">Adaug și deschid ↗</button><button className="outline small danger" onClick={()=>decline(g)}>Nu</button></div>)}</div>
  </section>}
  <section className="card" style={{marginBottom:16}}><CardHead title={`Grupurile tale · ${counts.joined} înscris · ${active} în rotație`}/>
    <p className="muted">Platforma pregătește postări <b>doar pentru grupurile marcate „Înscris”</b>. După ce intri într-un grup pe Facebook, apasă aici „M-am înscris ✓”. Dacă grupul cere aprobarea adminului, apasă „Cerere trimisă” și revino când ești acceptat.</p>
    <p className="muted">Recomandat: cel puțin 25–35 de grupuri, ca fiecare să primească o postare cel mult o dată pe săptămână. Verifică regulile fiecărui grup (unele permit reclame doar în anumite zile).</p>
    <div className="form-row"><label>Numele grupului<input value={name} onChange={e=>setName(e.target.value)} placeholder="ex. Mămici din Brașov"/></label><label>Link grup<input value={link} onChange={e=>setLink(e.target.value)} placeholder="https://facebook.com/groups/…"/></label></div>
    <button className="primary" style={{marginTop:12}} disabled={busy==='add'} onClick={add}>＋ Adaugă grupul</button>
    <div className="mem-filter">{[['all',`Toate (${mine.length})`],['joined',`✓ Înscris (${counts.joined})`],['requested',`⏳ Cerere trimisă (${counts.requested})`],['none',`Neînscris (${counts.none})`]].map(([k,l])=><button key={k} className={memFilter===k?'active':''} onClick={()=>setMemFilter(k)}>{l}</button>)}</div>
    <div className="groups-list" style={{marginTop:14}}>{!shown.length&&<p className="muted">{mine.length?'Niciun grup în această categorie.':'Nu ai adăugat încă niciun grup.'}</p>}{shown.map(g=><div className={`group-row ${g.status==='excluded'?'paused':''}`} key={g.id}><div className="group-avatar">{g.group_name.charAt(0)}</div><div className="group-main"><b>{g.group_name} {mem(g)==='joined'?<em className="mem joined">✓ Înscris</em>:mem(g)==='requested'?<em className="mem requested">⏳ Cerere trimisă</em>:<em className="mem none">Neînscris</em>}</b><span>{postedCount(g.id)} postări{lastPosted(g.id)?` · ultima pe ${lastPosted(g.id)}`:''}{g.group_url?<> · <a className="text-btn" href={g.group_url} target="_blank" rel="noreferrer">deschide</a></>:<> · <b className="red">fără link</b></>}</span></div>{mem(g)!=='joined'&&<button className="primary small" onClick={()=>setMembership(g,'joined')}>M-am înscris ✓</button>}{mem(g)==='none'&&<button className="outline small" onClick={()=>setMembership(g,'requested')}>Cerere trimisă</button>}{mem(g)==='joined'&&<button className="text-btn" onClick={()=>setMembership(g,'none')}>nu mai sunt înscris</button>}<button className="outline small" onClick={()=>editGroupLink(g)}>{g.group_url?'Schimbă linkul':'＋ Link'}</button><button className="outline small" onClick={()=>toggleGroup(g)}>{g.status==='excluded'?'Reia':'Pauză'}</button></div>)}</div>
  </section></>}
function Analytics(){
  const [items,setItems]=useState([])
  useEffect(()=>{listPosts().then(setItems).catch(()=>setItems([]))},[])
  const published=items.filter(post=>post.status==='published').length
  const pending=items.filter(post=>post.status==='pending_approval').length
  const instagram=items.filter(post=>post.platform==='instagram').length
  const facebook=items.filter(post=>post.platform==='facebook').length
  const youtube=items.filter(post=>post.platform==='youtube').length
  const tiktok=items.filter(post=>post.platform==='tiktok').length
  const total=items.length||1
  const percent=n=>`${Math.round(n/total*100)}%`
  return <><PageTitle eyebrow="PERFORMANȚĂ" title="Analytics" desc="Indicatori calculați din postările și programările tale." action={<button className="outline" onClick={()=>window.location.reload()}>↻ Reîmprospătează</button>}/><div className="stats"><Stat label="Postări totale" value={items.length} change={`${published} publicate`} tone="green" note="din Supabase"/><Stat label="În aprobare" value={pending} change="necesită acțiune" tone="gold" note="înainte de publicare"/><Stat label="Programate" value={items.filter(post=>post.status==='scheduled').length} change="următoarele zile" tone="green" note="calendar editorial"/><Stat label="Videoclipuri" value={new Set(items.map(post=>post.media_id).filter(Boolean)).size} change="folosite" tone="gold" note="media asociată"/></div><div className="dashboard-grid"><section className="card activity"><CardHead title="Publicate în ultimele 14 zile"/><PublishedChart items={items}/></section><section className="card channels"><CardHead title="Canale active"/><Channel name="Instagram" value={percent(instagram)} color="ig"/><Channel name="Facebook" value={percent(facebook)} color="fb"/><Channel name="YouTube" value={percent(youtube)} color="yt"/><Channel name="TikTok" value={percent(tiktok)} color="tt"/></section></div></>}
function PublishedChart({items}){
  const days=[...Array(14)].map((_,i)=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-13+i);return d})
  const key=d=>d.toDateString()
  const counts=days.map(d=>{const row={facebook:0,instagram:0,youtube:0,tiktok:0};items.forEach(p=>{if(p.status==='published'&&p.published_at&&key(new Date(new Date(p.published_at).setHours(0,0,0,0)))===key(d)&&row[p.platform]!==undefined)row[p.platform]++});return row})
  const max=Math.max(1,...counts.map(r=>r.facebook+r.instagram+r.youtube+r.tiktok))
  const total=counts.reduce((a,r)=>a+r.facebook+r.instagram+r.youtube+r.tiktok,0)
  return <><div className="pub-chart">{counts.map((r,i)=>{const sum=r.facebook+r.instagram+r.youtube+r.tiktok;return <div className="pub-col" key={i} title={`${days[i].toLocaleDateString('ro-RO',{day:'numeric',month:'short'})}: ${sum} publicate`}><div className="pub-stack" style={{height:`${sum/max*100}%`}}>{['youtube','tiktok','instagram','facebook'].map(k=>r[k]?<i key={k} className={k} style={{flex:r[k]}}/>:null)}</div></div>})}</div>
  <div className="chart-days">{[0,4,9,13].map(i=><span key={i}>{days[i].toLocaleDateString('ro-RO',{day:'numeric',month:'short'})}</span>)}</div>
  {!total&&<p className="muted" style={{marginTop:12}}>Nicio postare publicată în ultimele 14 zile.</p>}</>
}
function Channel({name,value,color}){return <div className="channel"><span className={'platform '+color}>{name==='Instagram'?'◎':name==='Facebook'?'f':name==='TikTok'?'♪':'▶'}</span><b>{name}</b><strong>{value}</strong><div><i className={color} style={{width:value}}></i></div></div>}
const SENTIMENT = { positive:['Pozitiv','green'], question:['Întrebare','gold'], negative:['Negativ','red'], spam:['Spam','muted'], other:['Altul','muted'] }
const REPLY = { unreviewed:'De revizuit', approved:'Aprobat', sent:'Trimis', ignored:'Ignorat', failed:'Eșuat' }
function CommentCard({c,onChange,onNotice}){
  const [text,setText]=useState(c.reply_draft||''),[busy,setBusy]=useState('')
  useEffect(()=>setText(c.reply_draft||''),[c.reply_draft])
  const p=PLATFORM[c.platform]||{label:c.platform,color:'',icon:'•'}, s=SENTIMENT[c.sentiment]||SENTIMENT.other
  const run=async(kind,fn)=>{setBusy(kind);try{await fn()}catch(e){onNotice(e.message)}finally{setBusy('')}}
  const send=()=>run('send',async()=>{await commentsAction({action:'send',id:c.id,text});onChange({...c,reply_draft:text,reply_status:'sent',replied_at:new Date().toISOString()});onNotice('Răspuns trimis')})
  const redraft=()=>run('ai',async()=>{const r=await commentsAction({action:'redraft',id:c.id});setText(r.reply||'');onChange({...c,reply_draft:r.reply})})
  const ignore=()=>run('ignore',async()=>onChange(await updateComment(c.id,{reply_status:'ignored'})))
  const done=c.reply_status==='sent'||c.reply_status==='ignored'
  return <article className={`comment-card ${done?'done':''}`}>
    <div className="comment-head"><span className={`plat ${p.color}`}>{p.icon}</span><b>{c.author_name||'Utilizator'}</b><span className={`chip ${s[1]}`}>{s[0]}</span><span className="muted small">{new Date(c.created_at).toLocaleString('ro-RO',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span><span className={`chip status-${c.reply_status}`}>{REPLY[c.reply_status]||c.reply_status}{c.metadata?.auto?' · auto':''}</span></div>
    <p className="comment-body">{c.comment_body}</p>
    {c.sentiment==='negative'&&!done&&<div className="safety-note">Comentariu negativ — citește atent înainte să trimiți. AI-ul nu răspunde singur aici.</div>}
    {done ? (c.reply_status==='sent'&&<p className="comment-reply">↳ {c.reply_draft}</p>) : <>
      <textarea className="group-text" rows={3} value={text} onChange={e=>setText(e.target.value)} placeholder="Răspunsul tău…"/>
      <div className="row-actions"><button className="primary" disabled={!!busy||!text.trim()} onClick={send}>{busy==='send'?'Se trimite…':'Trimite răspunsul'}</button><button className="outline" disabled={!!busy} onClick={redraft}>{busy==='ai'?'Scriu…':'✦ Alt răspuns AI'}</button><button className="ghost" disabled={!!busy} onClick={ignore}>Ignoră</button></div></>}
    {c.last_error&&<p className="error small">Eroare: {c.last_error}</p>}
  </article>
}
function Comments({user,onNotice}){
  const [items,setItems]=useState([]),[filter,setFilter]=useState('todo'),[mode,setMode]=useState('approve'),[syncing,setSyncing]=useState(false)
  const load=()=>listComments().then(setItems).catch(e=>onNotice(`Comentariile nu s-au încărcat: ${e.message}`))
  useEffect(()=>{if(!user)return;load();listAutomationSettings().then(s=>s?.comments_mode&&setMode(s.comments_mode)).catch(()=>{})},[user])
  const saveMode=async(value)=>{setMode(value);try{await saveAutomationSettings({owner_id:user.id,comments_mode:value});onNotice('Modul de răspuns a fost salvat')}catch(e){onNotice(`Nu s-a salvat: ${e.message}`)}}
  const sync=async()=>{setSyncing(true);try{const r=await commentsAction({action:'sync'});await load();onNotice(`Verificat: ${r.new||0} comentarii noi${r.auto_sent?`, ${r.auto_sent} răspunsuri trimise automat`:''}`)}catch(e){onNotice(e.message)}finally{setSyncing(false)}}
  if(!user) return <><PageTitle eyebrow="COMUNITATE" title="Comentarii" desc="Autentifică-te ca să vezi comentariile."/></>
  const todo=items.filter(c=>['unreviewed','approved','failed'].includes(c.reply_status))
  const shown=filter==='todo'?todo:filter==='sent'?items.filter(c=>c.reply_status==='sent'):items
  const modes=[['off','Oprit','AI-ul nu scrie nimic'],['approve','Cu aprobare','AI-ul scrie, tu apeși Trimite'],['auto_safe','Automat (sigur)','Laude și întrebări simple primesc răspuns singure; criticile rămân la tine']]
  return <><PageTitle eyebrow="COMUNITATE" title="Comentarii" desc="AI-ul citește comentariile de pe Facebook, Instagram și YouTube la fiecare 10 minute și îți pregătește răspunsuri." action={<button className="outline" disabled={syncing} onClick={sync}>{syncing?'Verific…':'↻ Verifică acum'}</button>}/>
    <section className="card" style={{marginBottom:16}}><CardHead title="Cum răspunde AI-ul"/><div className="mode-picker">{modes.map(([v,l,d])=><button key={v} className={mode===v?'active':''} onClick={()=>saveMode(v)}><b>{l}</b><span>{d}</span></button>)}</div><p className="muted small">TikTok nu permite răspunsuri prin API, acolo răspunzi din aplicație.</p></section>
    <div className="tabs-inline">{[['todo',`De răspuns (${todo.length})`],['sent','Trimise'],['all','Toate']].map(([v,l])=><button key={v} className={filter===v?'active':''} onClick={()=>setFilter(v)}>{l}</button>)}</div>
    {shown.length?<div className="comment-list">{shown.map(c=><CommentCard key={c.id} c={c} onNotice={onNotice} onChange={n=>setItems(list=>list.map(x=>x.id===n.id?n:x))}/>)}</div>:<section className="card empty"><p className="muted">{filter==='todo'?'Niciun comentariu nou de răspuns. Apar aici după ce postările publicate primesc comentarii.':'Nimic aici încă.'}</p></section>}
  </>
}
const RUN = { started:['Pornită','gold'], done:['Gata','green'], skipped:['Sărită','muted'], failed:['Eroare','red'] }
function PublishingSettings({user,onNotice}){
  const [st,setSt]=useState({auto_publish:false,tiktok_mode:'inbox',tiktok_privacy:'PUBLIC_TO_EVERYONE',tiktok_allow_comments:true,tiktok_consent_at:null}),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false)
  useEffect(()=>{if(!user)return;listAutomationSettings().then(r=>{if(r){setSt(x=>({...x,...Object.fromEntries(Object.entries(r).filter(([k])=>k in x))}));setConsent(!!r.tiktok_consent_at)}}).catch(()=>{})},[user])
  const save=async(patch,msg)=>{if(!user){onNotice('Autentifică-te pentru a salva');return}setBusy(true);try{const next={...st,...patch};await saveAutomationSettings({owner_id:user.id,auto_publish:next.auto_publish,tiktok_mode:next.tiktok_mode,tiktok_privacy:next.tiktok_privacy,tiktok_allow_comments:next.tiktok_allow_comments,tiktok_consent_at:next.tiktok_consent_at});setSt(next);onNotice(msg)}catch(e){onNotice(`Nu s-a salvat: ${e.message}`)}finally{setBusy(false)}}
  const toggleAuto=()=>{if(!st.auto_publish&&!window.confirm('Clipurile noi se vor publica singure la ora programată, fără să le mai vezi înainte. Le poți opri oricând de aici. Pornești publicarea automată?'))return;save({auto_publish:!st.auto_publish},!st.auto_publish?'Publicarea automată a pornit':'Publicarea automată a fost oprită: clipurile vin din nou la „De aprobat”')}
  const saveTiktok=()=>{if(st.tiktok_mode==='direct'&&!consent){onNotice('Bifează declarația TikTok ca să pornești publicarea directă');return}save({tiktok_consent_at:st.tiktok_mode==='direct'?(st.tiktok_consent_at||new Date().toISOString()):st.tiktok_consent_at},'Setările TikTok au fost salvate')}
  return <div className="card safety-card"><CardHead title="Publicare"/>
    <div className="automation-line"><div><b>Publicare automată, fără aprobare</b><small>{st.auto_publish?'Pornită: clipurile noi pleacă singure la ora lor.':'Oprită: fiecare clip așteaptă „Aprobă” în Calendar.'}</small></div><button className={`toggle ${st.auto_publish?'on':''}`} disabled={busy} onClick={toggleAuto} aria-label="Publicare automată"><i/></button></div>
    <div className="tiktok-box"><b>TikTok</b>
      <div className="mode-picker" style={{gridTemplateColumns:'1fr 1fr',marginTop:10}}>
        <button className={st.tiktok_mode==='inbox'?'active':''} onClick={()=>setSt({...st,tiktok_mode:'inbox'})}><b>Inbox</b><span>Clipul ajunge în aplicația TikTok, îl publici tu cu o apăsare</span></button>
        <button className={st.tiktok_mode==='direct'?'active':''} onClick={()=>setSt({...st,tiktok_mode:'direct'})}><b>Publicare directă</b><span>Se publică singur pe profil. Public doar după aprobarea aplicației de către TikTok</span></button>
      </div>
      {st.tiktok_mode==='direct'&&<div className="tiktok-direct">
        <label>Cine vede clipurile<select value={st.tiktok_privacy} onChange={e=>setSt({...st,tiktok_privacy:e.target.value})}><option value="PUBLIC_TO_EVERYONE">Toată lumea</option><option value="MUTUAL_FOLLOW_FRIENDS">Prietenii</option><option value="FOLLOWER_OF_CREATOR">Urmăritorii</option><option value="SELF_ONLY">Doar eu</option></select></label>
        <div className="automation-line"><div><b>Comentarii permise</b><small>Răspunsurile la comentariile de pe TikTok le dai din aplicație</small></div><button className={`toggle ${st.tiktok_allow_comments?'on':''}`} onClick={()=>setSt({...st,tiktok_allow_comments:!st.tiktok_allow_comments})} aria-label="Comentarii"><i/></button></div>
        <label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>Sunt de acord ca reclamele Poșta Moșului să fie publicate automat pe contul TikTok conectat, marcate ca promovarea propriei afaceri („Your brand”), și accept <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a> și <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Branded Content Policy</a> TikTok.</span></label>
        <div className="safety-note">După ce salvezi, reconectează TikTok din <b>Conturi social</b> ca să dai permisiunea de publicare. Până când TikTok aprobă aplicația, clipurile apar pe profil doar ca „Doar eu”.</div>
      </div>}
      <button className="primary" style={{marginTop:12}} disabled={busy} onClick={saveTiktok}>Salvează setările TikTok</button>
    </div>
  </div>
}
function DailyAutopilot({user,onNotice}){
  const [enabled,setEnabled]=useState(null),[since,setSince]=useState(null),[runs,setRuns]=useState([]),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(false)
  useEffect(()=>{if(!user){setEnabled(false);return}listAutomationSettings().then(s=>{setEnabled(s?.daily_enabled===true);setSince(s?.daily_toggled_at||null)}).catch(()=>setEnabled(false));listAutomationRuns().then(setRuns).catch(()=>{})},[user])
  const toggle=async(next)=>{if(!user){onNotice('Autentifică-te pentru a porni automatizarea');return}setBusy(true);try{const row=await setDailyAutomation(user.id,next);setEnabled(row.daily_enabled);setSince(row.daily_toggled_at);setConfirm(false);onNotice(next?'Automatizarea zilnică a pornit':'Automatizarea zilnică a fost oprită')}catch(e){onNotice(`Nu s-a putut schimba: ${e.message}`)}finally{setBusy(false)}}
  const when=since?new Date(since).toLocaleString('ro-RO',{day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}):null
  return <section className={`card autopilot ${enabled?'on':''}`}>
    <div className="autopilot-main">
      <div className="autopilot-state"><span className={`autopilot-dot ${enabled?'on':''}`}/>{enabled===null?'Se încarcă…':enabled?'Pornită':'Oprită'}</div>
      <h2>Clipuri zilnice automate</h2>
      <p>În fiecare dimineață se creează 2 reclame noi cu Moșul, în stilul premium, și intră în <b>Calendar → De aprobat</b> pentru TikTok, Facebook, Instagram și YouTube. Nimic nu se publică fără aprobarea ta.</p>
      <div className="autopilot-facts"><span>2 clipuri / zi</span><span>≈ 1,7 $ / zi din WaveSpeed</span><span>Se oprește singură dacă soldul scade sub 2 $</span></div>
      {when&&<small className="muted">{enabled?'Pornită':'Oprită'} la {when}{enabled?' · rulează zilnic la 7:55':''}</small>}
    </div>
    <div className="autopilot-action">
      {enabled
        ? (confirm
            ? <div className="autopilot-confirm"><span>Oprești automatizarea?</span><button className="danger" disabled={busy} onClick={()=>toggle(false)}>{busy?'Se oprește…':'Da, oprește'}</button><button className="ghost" onClick={()=>setConfirm(false)}>Anulează</button></div>
            : <button className="autopilot-btn stop" disabled={busy} onClick={()=>setConfirm(true)}><i>■</i>Stop</button>)
        : <button className="autopilot-btn start" disabled={busy||enabled===null} onClick={()=>toggle(true)}><i>▶</i>{busy?'Pornește…':'Start'}</button>}
    </div>
    {runs.length>0&&<div className="autopilot-runs"><div className="eyebrow">ULTIMELE RULĂRI</div>{runs.map(r=>{const [l,t]=RUN[r.status]||[r.status,'muted'];return <div className="run-row" key={r.id}><span className={`chip ${t}`}>{l}</span><span className="run-text">{r.summary||'—'}</span><time>{new Date(r.created_at).toLocaleString('ro-RO',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time></div>})}</div>}
  </section>
}
function Automation({user,onNotice}){
  const [ig,setIg]=useState(true),[fb,setFb]=useState(true),[yt,setYt]=useState(true),[tt,setTt]=useState(true),[approval,setApproval]=useState(true),[groupCount,setGroupCount]=useState(5),[groupEnabled,setGroupEnabled]=useState(true)
  const [igSlots,setIgSlots]=useState(['12:30','19:30']),[fbSlots,setFbSlots]=useState(['12:30','19:30']),[ytSlots,setYtSlots]=useState(['12:30','19:30']),[ttSlots,setTtSlots]=useState(['12:30','19:30'])
  const [media,setMedia]=useState([]),[busy,setBusy]=useState(false)
  useEffect(()=>{if(user) listMedia().then(all=>setMedia(all.filter(m=>!m.mime_type?.startsWith('image/')))).catch(error=>onNotice(`Media nu s-a putut încărca: ${error.message}`))},[user])
  useEffect(()=>{if(!user)return;listPublishingSchedules().then(rows=>{const map={instagram:[setIg,setIgSlots],facebook:[setFb,setFbSlots],youtube:[setYt,setYtSlots],tiktok:[setTt,setTtSlots]};rows.forEach(row=>{const pair=map[row.platform];if(!pair)return;pair[0](row.enabled);if(Array.isArray(row.slots)&&row.slots.length===2)pair[1](row.slots)});const first=rows[0];if(first)setApproval(first.require_approval)}).catch(()=>{})},[user])
  const save=async()=>{if(!user){onNotice('Setările sunt în mod demo');return}try{await Promise.all([
    savePublishingSchedule({owner_id:user.id,platform:'instagram',posts_per_day:2,slots:igSlots,enabled:ig,require_approval:true}),
    savePublishingSchedule({owner_id:user.id,platform:'facebook',posts_per_day:2,slots:fbSlots,enabled:fb,require_approval:true}),
    savePublishingSchedule({owner_id:user.id,platform:'youtube',posts_per_day:2,slots:ytSlots,enabled:yt,require_approval:true}),
    savePublishingSchedule({owner_id:user.id,platform:'tiktok',posts_per_day:2,slots:ttSlots,enabled:tt,require_approval:true})
  ]);onNotice('Automatizările au fost salvate în Supabase')}catch(error){onNotice(`Salvarea a eșuat: ${error.message}`)}}
  const scheduleNextDay=async()=>{
    if(!user){onNotice('Autentifică-te pentru programare persistentă');return}
    if(!media.length){onNotice('Încarcă mai întâi cel puțin un videoclip în Media library');return}
    setBusy(true)
    try{
      const channels=[
        ...(ig?[['instagram',igSlots]]:[]),
        ...(fb?[['facebook',fbSlots]]:[]),
        ...(yt?[['youtube',ytSlots]]:[]),
        ...(tt?[['tiktok',ttSlots]]:[])
      ]
      const jobs=channels.flatMap(([platform,slots])=>slots.map((slot,index)=>{
        const asset=media[index%media.length]
        const when=new Date(); const [hours,minutes]=slot.split(':').map(Number)
        when.setHours(hours,minutes,0,0); if(when<=new Date()) when.setDate(when.getDate()+1)
        const generationPlatform=platform==='tiktok'?'tiktok_video':platform==='youtube'?'youtube_short':platform==='facebook'?'facebook_reel':'instagram_reel'
        const brief=`Creează conținut pentru videoclipul încărcat «${asset.name}». Explică natural de ce este relevant pentru părinți și invită la interacțiune. Nu inventa detalii despre videoclip.`
        return generateContent({prompt:brief,platform:generationPlatform,tone:'cald și inspirațional',variation:Date.now()+index}).then(async result=>{
          const created=await createPost({owner_id:user.id,platform,title:result.title||asset.name,body:result.body||`Conținut pregătit pentru ${platform}.`,hashtags:result.hashtags||[],media_id:asset.id,status:approval?'pending_approval':'scheduled',scheduled_for:when.toISOString(),metadata:{generation_mode:result.model||'fallback-local'}})
          await createContentVariant({owner_id:user.id,post_id:created.id,platform,title:result.title||asset.name,body:result.body||'',hashtags:result.hashtags||[],ai_model:result.model||'fallback-local',generation_prompt:brief,approval_status:approval?'pending_approval':'approved'})
          return created
        })
      }))
      await Promise.all(jobs)
      onNotice(`${jobs.length} postări au fost programate în Supabase`)
    }catch(error){onNotice(`Programarea a eșuat: ${error.message}`)}finally{setBusy(false)}
  }
  const channelCard=(kind,title,subtitle,enabled,setEnabled,slots,setSlots,copy)=><section className="card automation-card"><div className="automation-head"><div><span className={'platform '+kind}>{kind==='ig'?'◎':kind==='fb'?'f':kind==='tt'?'♪':'▶'}</span><div><h2>{title}</h2><small>{subtitle}</small></div></div><button className={'toggle '+(enabled?'on':'')} onClick={()=>setEnabled(v=>!v)}><i/></button></div><div className="slot-row"><label>Slot 1<input type="time" value={slots[0]} onChange={e=>setSlots([e.target.value,slots[1]])}/></label><label>Slot 2<input type="time" value={slots[1]} onChange={e=>setSlots([slots[0],e.target.value])}/></label></div><p className="muted">{copy}</p></section>
  return <><PageTitle eyebrow="ORCHESTRARE" title="Automatizări" desc="Stabilește ce publicăm zilnic și cât control păstrezi înainte de publicare." action={<div className="page-actions"><button className="outline" onClick={save}>Salvează setările</button><button className="primary" onClick={scheduleNextDay} disabled={busy}>{busy?'Se programează…':'＋ Programează din Media library'}</button></div>}/><DailyAutopilot user={user} onNotice={onNotice}/><div className="automation-grid">{channelCard('ig','Instagram Reels','2 videoclipuri pe zi',ig,setIg,igSlots,setIgSlots,'AI-ul generează caption, descriere și hashtag-uri.')}{channelCard('fb','Facebook Reels','2 videoclipuri pe zi · Pagina PostaMoșului',fb,setFb,fbSlots,setFbSlots,'Publicare pe Pagina Facebook, separat de postările în grupuri.')}{channelCard('yt','YouTube Shorts','2 videoclipuri pe zi',yt,setYt,ytSlots,setYtSlots,'Titlul, descrierea și tag-urile sunt generate pentru YouTube.')}{channelCard('tt','TikTok','2 videoclipuri pe zi · trimise în inbox',tt,setTt,ttSlots,setTtSlots,'Clipul ajunge în inbox-ul TikTok; îl publici din aplicație.')}</div><div className="automation-grid lower"><section className="card"><CardHead title="Videoclipuri disponibile"/><p className="muted">Sunt disponibile {media.length} videoclipuri încărcate. La programare, ele sunt rotite automat între sloturi.</p>{!media.length&&<div className="safety-note">Încarcă videoclipuri din <b>Media library</b> înainte de programare.</div>}{media.slice(0,4).map(asset=><div className="automation-line" key={asset.id}><div><b>{asset.name}</b><small>{((asset.size_bytes||0)/1024/1024).toFixed(1)} MB · pregătit</small></div><span className="pill">READY</span></div>)} </section><section className="card"><CardHead title="Grupuri Facebook"/><div className="automation-line"><div><b>5 postări pe zi, pregătite automat</b><small>Textele și media apar în „Grupuri Facebook → De postat azi”. Postezi tu, manual (Meta nu permite postarea automată în grupuri).</small></div><span className="pill">ACTIV</span></div><div className="group-flow"><span>1</span><p>Rotație: fiecare grup cel mult o dată la 6 zile</p><span>2</span><p>Text diferit pentru fiecare grup</p><span>3</span><p>Copiezi, postezi, apeși „Am postat”</p></div></section></div><PublishingSettings user={user} onNotice={onNotice}/></>
}

function Settings({user,profile,setProfile,onNotice}){
  const [section,setSection]=useState('General'),[voice,setVoice]=useState('cald, empatic și orientat spre familie'),[busy,setBusy]=useState(false)
  useEffect(()=>{if(user)listAutomationSettings().then(settings=>{if(settings?.brand_voice)setVoice(settings.brand_voice)}).catch(()=>{})},[user])
  const save=async()=>{if(!user){onNotice('Autentifică-te pentru setări persistente');return}setBusy(true);try{const name=profile.full_name?.trim()||'Administrator';const updated=await updateProfile(user.id,name);setProfile(updated);await saveAutomationSettings({owner_id:user.id,brand_voice:voice.trim().slice(0,300),timezone:'Europe/Bucharest'});onNotice('Setările au fost salvate')}catch(error){onNotice(`Salvarea a eșuat: ${error.message}`)}finally{setBusy(false)}}
  const tabs=['General','Vocea brandului','Aprobare și notificări','Securitate']
  const panel=()=>{
    if(section==='Vocea brandului') return <><label>Cum vrei să sune textele generate în AI Content Studio<textarea value={voice} onChange={e=>setVoice(e.target.value)} placeholder="ex. cald, elegant, fără emoji în exces, ca un părinte care vorbește cu alți părinți"/></label><div className="safety-note">Se folosește la fiecare text generat în AI Content Studio. Reclamele zilnice și răspunsurile la comentarii au deja tonul Poșta Moșului fixat.</div><button className="primary" onClick={save} disabled={busy}>{busy?'Se salvează…':'Salvează vocea brandului'}</button></>
    if(section==='Aprobare și notificări') return <><div className="setting-line"><div><b>Aprobare înainte de publicare</b><small>Mereu activă: fiecare clip intră în „De aprobat” și pleacă doar după ce apeși „Aprobă”.</small></div><span className="pill">MEREU ACTIVĂ</span></div><div className="setting-line"><div><b>Raportul automatizării zilnice</b><small>După fiecare rulare primești un rezumat în conversația cu Claude, iar istoricul apare în Automatizări → Ultimele rulări.</small></div><span className="pill">ACTIV</span></div><div className="safety-note">Nu trimitem emailuri de notificare din platformă.</div></>
    if(section==='Securitate') return <><div className="security"><div className="security-icon">✓</div><div><b>Acces doar pentru administrator</b><p>Datele și acțiunile sunt protejate la nivel de bază de date (RLS) și verificate pe server.</p></div><span className="pill">ACTIV</span></div><div className="security"><div className="security-icon">✦</div><div><b>Cheile AI și ale rețelelor</b><p>Stau doar pe server (Supabase Secrets). Nu apar în pagină și nu sunt în codul public.</p></div><span className="pill">SERVER-SIDE</span></div></>
    return <><label>Numele administratorului<input value={profile.full_name||''} onChange={e=>setProfile({...profile,full_name:e.target.value})}/></label><div className="setting-line"><div><b>Fus orar</b><small>Toate orele din platformă sunt în ora României.</small></div><span className="pill">EUROPE/BUCHAREST</span></div><button className="primary" onClick={save} disabled={busy}>{busy?'Se salvează…':'Salvează modificările'}</button></>
  }
  return <><PageTitle eyebrow="CONTROL" title="Setări" desc="Numele tău, vocea brandului și regulile de siguranță."/><div className="settings-layout"><aside className="settings-nav">{tabs.map(tab=><button key={tab} className={section===tab?'active':''} onClick={()=>setSection(tab)}>{tab}</button>)}</aside><section className="card settings-form"><h2>{section}</h2>{panel()}</section></div></>
}
createRoot(document.getElementById('root')).render(<App />)
