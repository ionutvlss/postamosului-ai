import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { listSocialAccounts, publishNow, startConnect, createContentVariant, createGroupCandidate, createGroupOutreachDraft, createPost, deleteMedia, generateContent, getProfile, listAutomationSettings, listGroupCandidates, listMedia, listPosts, saveAutomationSettings, savePublishingSchedule, updatePost, updateProfile, uploadMedia } from './lib/api'

const icons = { grid:'⌘', social:'◎', media:'▣', studio:'✦', calendar:'▦', groups:'♧', analytics:'↗', settings:'⚙' }
const nav = [
  ['Dashboard','grid'], ['Conturi social','social'], ['Media library','media'], ['AI Content Studio','studio'],
  ['Calendar editorial','calendar'], ['Automatizări','settings'], ['Facebook Groups Finder','groups'], ['Analytics','analytics'], ['Setări','settings']
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
  const [searchOpen, setSearchOpen] = useState(false), [searchQuery, setSearchQuery] = useState('')
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
  }, [session])
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
    if(active==='Dashboard') return <Dashboard name={profile.full_name||'Administrator'} posts={posts} onAdd={addPost} onNavigate={setActive}/>
    if(active==='Conturi social') return <Social onNotice={showNotice}/>
    if(active==='Media library') return <Media media={media} setMedia={setMedia} user={session?.user} onNotice={showNotice}/>
    if(active==='AI Content Studio') return <Studio prompt={prompt} setPrompt={setPrompt} generated={generated} setGenerated={setGenerated} user={session?.user} onNotice={showNotice}/>
    if(active==='Calendar editorial') return <Calendar posts={posts} onAdd={addPost} onNotice={showNotice}/>
    if(active==='Automatizări') return <Automation user={session?.user} onNotice={showNotice}/>
    if(active==='Facebook Groups Finder') return <Groups user={session?.user} onNotice={showNotice}/>
    if(active==='Analytics') return <Analytics/>
    return <Settings user={session?.user} profile={profile} setProfile={setProfile} onNotice={showNotice}/>
  }
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">✦</div><div><strong>PostaMoșului</strong><span>AI command center</span></div></div>
      <div className="workspace"><span className="avatar">PM</span><div><b>PostaMoșului</b><small>Workspace principal</small></div><span className="chevron">⌄</span></div>
      <nav>{nav.map(([label,icon])=><button key={label} className={active===label?'active':''} onClick={()=>setActive(label)}><i>{icons[icon]}</i>{label}{label==='AI Content Studio' && <em>NEW</em>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="tip"><span>✦</span><div><b>Sezonul magic</b><small>{daysToChristmas()} zile până la Crăciun</small></div></div><div className="user"><span className="avatar gold">{(profile.full_name||'AD').slice(0,2).toUpperCase()}</span><div><b>{profile.full_name||'Administrator'}</b><small>Administrator</small></div><span>•••</span></div></div>
    </aside>
    <main className="main"><header><button className="mobile-menu" onClick={()=>showNotice('Folosește meniul lateral pentru navigare')}>☰</button><div className="crumb"><span>Workspace</span><b>/</b><strong>{active}</strong></div><div className="header-actions"><button className="icon-btn" aria-label="Caută" onClick={()=>setSearchOpen(v=>!v)}>⌕</button><button className="icon-btn notif" onClick={()=>setActive('Automatizări')}>♢<span></span></button><div className="date">{todayLabel({day:'numeric',month:'long',year:'numeric'})}</div></div>{searchOpen&&<div className="global-search"><input autoFocus value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Caută un modul..."/>{nav.filter(([label])=>label.toLowerCase().includes(searchQuery.toLowerCase())).map(([label])=><button key={label} onClick={()=>{setActive(label);setSearchOpen(false);setSearchQuery('')}}>{label}</button>)}</div>}</header>{!isSupabaseConfigured && <div className="demo-banner">Mod demo activ · configurează <code>.env.local</code> pentru autentificare și date persistente</div>}{notice && <div className="toast">✓ {notice}</div>}<div className="content">{render()}</div></main>
  </div>
}
function postFromDb(post){ const meta=PLATFORM[post.platform]||PLATFORM.instagram; return { ...post, rawStatus:post.status, time: post.scheduled_for ? new Date(post.scheduled_for).toLocaleTimeString('ro-RO',{hour:'2-digit',minute:'2-digit'}) : '—', platform:meta.label, color:meta.color, type:meta.type, status:STATUS[post.status]||post.status } }
function AuthScreen(){
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('')
  const signIn=async(e)=>{e.preventDefault();setBusy(true);setError('');const {error:authError}=await supabase.auth.signInWithPassword({email,password});if(authError)setError('Emailul sau parola sunt incorecte.');setBusy(false)}
  return <div className="auth-screen"><div className="auth-card"><div className="brand-mark">✦</div><div className="eyebrow">POSTAMOȘULUI AI</div><h1>Bine ai revenit</h1><p>Autentifică-te pentru a accesa command center-ul.</p><form onSubmit={signIn}><label>Email administrator<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label><label>Parolă<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label>{error&&<div className="auth-error">{error}</div>}<button className="primary wide" disabled={busy}>{busy?'Se autentifică…':'Intră în dashboard →'}</button></form><small>Acces restricționat administratorilor aprobați.</small></div></div>
}
function PageTitle({eyebrow,title,desc,action}){return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{desc}</p></div>{action}</div>}
function Dashboard({name,posts,onAdd,onNavigate}){const pending=posts.filter(post=>post.status==='În aprobare'||post.status==='pending_approval').length;return <><PageTitle eyebrow={todayLabel({weekday:'long',day:'numeric',month:'long',year:'numeric'})} title={< >{new Date().getHours()<12?'Bună dimineața':new Date().getHours()<18?'Bună ziua':'Bună seara'}, {name} <span className="red">✦</span></>} desc="Iată ce se întâmplă astăzi în universul tău digital." action={<button className="primary" onClick={onAdd}>＋ Creează conținut</button>}/><div className="stats"><Stat label="Reach total" value="—" change="fără date" tone="gold" note="se va completa după publicare"/><Stat label="Engagement rate" value="—" change="fără date" tone="gold" note="se va completa după publicare"/><Stat label="Postări programate" value={posts.length} change="în sistem" tone="gold" note="din Supabase"/><Stat label="În așteptare" value={pending} change="de aprobare" tone="red" note="necesită acțiune"/></div><div className="dashboard-grid"><section className="card activity"><CardHead title="Activitate recentă" link="Vezi tot"/><div className="chart"><div className="chart-labels"><span>100K</span><span>75K</span><span>50K</span><span>25K</span><span>0</span></div><div className="bars">{[35,48,42,64,55,72,58,79,63,91,76,88,68,83].map((v,i)=><div className="bar-wrap" key={i}><div className={i>10?'bar hot':'bar'} style={{height:v+'%'}}></div></div>)}</div><div className="chart-days"><span>Lun</span><span>Mar</span><span>Mie</span><span>Joi</span><span>Vin</span><span>Sâm</span><span>Dum</span></div></div><div className="legend"><span><i className="dot red-dot"/>Reach</span><span><i className="dot gold-dot"/>Engagement</span><b>Ultimele 14 zile</b></div></section><section className="card quick"><CardHead title="Acces rapid"/><Quick icon="✦" title="AI Content Studio" desc="Generează următoarea idee" onClick={()=>onNavigate('AI Content Studio')}/><Quick icon="▣" title="Încarcă media" desc="Adaugă un videoclip nou" onClick={()=>onNavigate('Media library')}/><Quick icon="♧" title="Găsește grupuri" desc="Descoperă audiențe noi" onClick={()=>onNavigate('Facebook Groups Finder')}/></section></div><section className="card schedule"><CardHead title="Următoarele postări" link="Deschide calendarul"/><div className="post-list">{posts.length?posts.slice(0,3).map((p,i)=><PostRow key={i} p={p}/>):<p className="muted">Nu există postări. Încarcă un videoclip și programează primul lot de conținut.</p>}</div></section></>}
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
    {provider:'meta',title:'Facebook + Instagram',logo:'f',kind:'fb',api:'Meta Graph API',accounts:['facebook','instagram'],cap:'Reels pe Pagină și pe Instagram'},
    {provider:'youtube',title:'YouTube',logo:'▶',kind:'yt',api:'YouTube Data API v3',accounts:['youtube'],cap:'Shorts (private până la auditul Google)'},
    {provider:'tiktok',title:'TikTok',logo:'♪',kind:'tt',api:'TikTok Content Posting API',accounts:['tiktok'],cap:'Trimis în inbox, publici din aplicație'},
  ]
  return <><PageTitle eyebrow="DISTRIBUȚIE" title="Conturi social" desc="Conectează conturile oficiale. Tokenurile rămân doar pe server."/>
  <div className="accounts">{cards.map(card=>{const connected=card.accounts.map(find).filter(Boolean);return <div className="account-card" key={card.provider}><div className={'account-logo '+card.kind}>{card.logo}</div><h2>{card.title}</h2><p>{card.api}</p><span className="account-cap">{card.cap}</span>
    {connected.length?<div className="connected-list">{card.accounts.map(platform=>{const acc=find(platform);return <div key={platform} className={acc?'connected':'missing'}>{acc?'✓':'—'} {PLATFORM[platform].label}: <b>{acc?acc.account_name:'neconectat'}</b></div>})}</div>:null}
    <button className="outline" disabled={busy===card.provider} onClick={()=>connect(card.provider)}>{busy===card.provider?'Se deschide…':connected.length?'Reconectează':'Conectează contul'} <span>→</span></button></div>})}</div>
  <div className="card security"><div className="security-icon">⌁</div><div><b>Tokenuri protejate</b><p>Tokenurile sunt salvate într-un tabel la care interfața nu are acces. Doar funcțiile de pe server le folosesc pentru publicare.</p></div><span className="pill">{accounts.filter(a=>a.status==='connected').length} CONECTATE</span></div></>}
function Media({media,setMedia,user,onNotice}){const [query,setQuery]=useState('');const onFile=async e=>{const f=e.target.files?.[0];if(!f)return;if(user){try{const asset=await uploadMedia(f,user.id);setMedia(m=>[asset,...m]);onNotice('Videoclipul a fost încărcat în Supabase Storage')}catch(error){onNotice(`Încărcarea a eșuat: ${error.message}`)}}else{setMedia(m=>[...m,{name:f.name,size:(f.size/1024/1024).toFixed(1)+' MB',type:'Video'}]);onNotice('Videoclipul a fost adăugat în modul demo')}};const remove=async asset=>{if(!user)return;try{await deleteMedia(asset);setMedia(items=>items.filter(item=>item.id!==asset.id));onNotice('Videoclipul a fost șters')}catch(error){onNotice(`Ștergerea a eșuat: ${error.message}`)}};const visibleMedia=media.filter(item=>item.name.toLowerCase().includes(query.toLowerCase()));return <><PageTitle eyebrow="BIBLIOTECĂ" title="Media library" desc="Păstrează toate videoclipurile și materialele campaniilor tale într-un singur loc." action={<label className="primary upload">＋ Încarcă videoclip<input type="file" accept="video/*" onChange={onFile}/></label>}/><div className="media-toolbar"><div className="search">⌕ <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Caută în bibliotecă..."/></div><button className="filter">Toate tipurile⌄</button><button className="filter">Cele mai noi⌄</button></div><div className="media-grid"><label className="upload-zone"><input type="file" accept="video/*" onChange={onFile}/><span>＋</span><b>Încarcă un videoclip</b><small>MP4, MOV sau WebM · max. 500 MB</small></label>{visibleMedia.map((m,i)=><div className="media-item" key={m.id||i}><div className="media-thumb">{m.preview_url?<video src={m.preview_url} muted controls playsInline preload="metadata" onClick={event=>{if(event.currentTarget.paused)event.currentTarget.play();else event.currentTarget.pause()}}/>:<span>▶</span>}</div><b title={m.name}>{m.name}</b><small>{m.size || `${((m.size_bytes||0)/1024/1024).toFixed(1)} MB`} · Adăugat recent</small>{m.id&&<button className="media-delete" onClick={()=>remove(m)}>Șterge</button>}</div>)}{!user&&<><div className="media-item"><div className="media-thumb warm"><span>▶</span></div><b>unboxing-cutia-magica.mp4</b><small>24,8 MB · 18 nov. 2026</small></div><div className="media-item"><div className="media-thumb blue"><span>▶</span></div><b>povestea-lui-mos-craciun.mov</b><small>41,2 MB · 16 nov. 2026</small></div></>}</div></>}
function Studio({prompt,setPrompt,generated,setGenerated,user,onNotice}){const [platform,setPlatform]=useState('instagram_reel');const [tone,setTone]=useState('cald și inspirațional');const generate=async()=>{if(!user){setGenerated({title:'Un mesaj magic pentru fiecare copil ✨',body:'Uneori, cele mai frumoase daruri nu încap într-o cutie. Scrie-i lui Moș Crăciun și lasă-ne să transformăm dorința într-o amintire de neuitat. 🎄',tags:'#PostaMosului #MagiaCraciunului #PovestiDeNeuitat #Familie',platform});onNotice('Preview demo — autentifică-te pentru OpenAI real');return}try{const result=await generateContent({prompt,platform,tone,variation:Date.now()});setGenerated({title:result.title,body:result.body,tags:(result.hashtags||[]).join(' '),platform});onNotice(`Conținut generat pentru ${platform.replace('_',' ')}`)}catch(error){onNotice(`Generarea a eșuat: ${error.message}`)}};const save=async()=>{if(!user){onNotice('Draftul este disponibil doar după autentificare');return}try{const dbPlatform=generated.platform==='youtube_short'?'youtube':generated.platform==='facebook_reel'?'facebook':'instagram';await createContentVariant({owner_id:user.id,platform:dbPlatform,title:generated.title,body:generated.body,hashtags:generated.tags.split(' '),generation_prompt:prompt,approval_status:'draft'});onNotice('Varianta a fost salvată în Supabase')}catch(error){onNotice(`Salvarea a eșuat: ${error.message}`)}};return <><PageTitle eyebrow="INTELIGENȚĂ CREATIVĂ" title="AI Content Studio" desc="Transformă o idee simplă în conținut gata de publicat, adaptat pentru fiecare canal."/><div className="studio-layout"><section className="card studio-form"><div className="form-label">DESPRE CE VREI SĂ VORBEȘTI?</div><textarea value={prompt} onChange={e=>setPrompt(e.target.value)}/><div className="form-row"><label>Platformă<select value={platform} onChange={e=>setPlatform(e.target.value)}><option value="instagram_reel">Instagram · Reel</option><option value="facebook_reel">Facebook · Reel</option><option value="youtube_short">YouTube · Short</option></select></label><label>Ton<select value={tone} onChange={e=>setTone(e.target.value)}><option>Cald și inspirațional</option><option>Jucăuș</option><option>Premium</option></select></label></div><button className="primary wide" onClick={generate}>✦ Generează conținut</button><small className="muted">Conținutul este generat server-side și poate folosi modul gratuit local.</small></section><section className="card generated">{generated?<><div className="generated-top"><span className="eyebrow">PREVIEW · {String(generated.platform||platform).replace('_',' ').toUpperCase()}</span><button className="text-btn" onClick={()=>navigator.clipboard?.writeText(generated.body)}>Copiază</button></div><h2>{generated.title}</h2><p>{generated.body}</p><div className="tags">{generated.tags}</div><div className="generated-actions"><button className="outline" onClick={generate}>↻ Regenerează</button><button className="primary" onClick={save}>Salvează draftul</button></div></>:<div className="empty-studio"><span>✦</span><h2>Ideea ta, următoarea poveste</h2><p>Completează brief-ul din stânga și lasă AI-ul să găsească unghiul perfect.</p></div>}</section></div></>}
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
  const now=post=>run(post,async()=>{if(post.rawStatus==='pending_approval')await updatePost(post.id,{status:'scheduled'});const result=await publishNow(post.id);const r=result.results?.[0];await reload();onNotice(r?.status==='published'?'Publicată!':r?.status==='publishing'?'Platforma procesează clipul, se publică în câteva minute':`Publicarea a eșuat: ${r?.error||'necunoscut'}`)})
  const displayTitle=(title)=>{const clean=String(title||'Postare').replace(/\s+/g,' ').trim();return clean.length>28?`${clean.slice(0,28)}…`:clean}
  const queue=livePosts.filter(post=>['pending_approval','scheduled','publishing','failed'].includes(post.rawStatus)).sort((a,b)=>new Date(a.scheduled_for||0)-new Date(b.scheduled_for||0))
  const recent=livePosts.filter(post=>post.rawStatus==='published').sort((a,b)=>new Date(b.published_at||0)-new Date(a.published_at||0)).slice(0,6)
  const monthLabel=monday.toLocaleDateString('ro-RO',{month:'long',year:'numeric'})
  return <><PageTitle eyebrow="PLANIFICARE" title="Calendar editorial" desc="Aprobă clipurile, iar platforma le publică automat la ora lor." action={<button className="primary" onClick={onAdd}>＋ Postare nouă</button>}/>
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
        </div>
      </div></div>)}</div>
    {recent.length>0&&<><h3 className="queue-subtitle">Publicate recent</h3><div className="recent-list">{recent.map(post=><div className="post-row" key={post.id}><span className={'platform '+post.color}>{(PLATFORM[post.platform?.toLowerCase()]||{}).icon}</span><div className="post-copy"><b>{post.title}</b><small>{post.platform} · {post.published_at?new Date(post.published_at).toLocaleString('ro-RO',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):''}{post.last_error?` · ${post.last_error}`:''}</small></div>{post.external_url&&<a className="text-btn" href={post.external_url} target="_blank" rel="noreferrer">Vezi →</a>}</div>)}</div></>}
  </section>
  <div className="calendar-top"><button className="outline" onClick={()=>setWeek(w=>w-1)}>‹</button><h2>{monthLabel}</h2><button className="outline" onClick={()=>setWeek(w=>w+1)}>›</button>{week!==0&&<button className="text-btn" onClick={()=>setWeek(0)}>Azi</button>}</div><div className="calendar-card card"><div className="week-head"><span></span>{days.map(day=><span className={day.date===todayKey?'today':''} key={day.date}>{day.label}</span>)}</div><div className="week-body">{times.map((t,i)=><div className="time-row" key={t}><time>{t}</time>{days.map((_,d)=><div className="slot" key={d}>{eventFor(d,i).map(post=><div className={`event ${post.color}-event`} key={post.id}><b title={post.title}>{displayTitle(post.title)}</b><small>{post.platform} · {post.status}</small>{post.rawStatus==='pending_approval'&&<button className="approve-btn" onClick={()=>approve(post)}>Aprobă</button>}</div>)}</div>)}</div>)}</div></div><div className="calendar-foot"><span><i className="dot red-dot"/>Instagram</span><span><i className="dot blue-dot"/>Facebook</span><span><i className="dot gold-dot"/>YouTube</span><span><i className="dot tt-dot"/>TikTok</span><small>{livePosts.filter(post=>post.rawStatus==='pending_approval').length} în aprobare · {livePosts.length} postări</small></div></>}
function Groups({user,onNotice}){const seed=[{name:'Mămici din România',members:'128K membri',category:'părinți · familie',score:92},{name:'Comunitatea părinților responsabili',members:'54K membri',category:'educație · familie',score:87},{name:'Idei pentru copii fericiți',members:'31K membri',category:'activități · joacă',score:81},{name:'Părinți moderni — România',members:'18K membri',category:'lifestyle · familie',score:76}];const [groups,setGroups]=useState(seed),[query,setQuery]=useState('părinți, familie, copii, cadouri'),[busy,setBusy]=useState('');useEffect(()=>{if(user)listGroupCandidates().then(rows=>{if(rows.length)setGroups(rows.map(row=>({id:row.id,name:row.group_name,members:row.member_count?`${row.member_count.toLocaleString('ro-RO')} membri`:'membri necunoscuți',category:row.category||'manual',score:row.relevance_score||0,external_group_id:row.external_group_id,saved:true})))}) .catch(()=>{})},[user]);const save=async group=>{if(!user){onNotice('Autentifică-te pentru a salva grupuri');return}setBusy(group.name);try{const saved=await createGroupCandidate({owner_id:user.id,external_group_id:group.external_group_id||`manual-${group.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,group_name:group.name,category:group.category,member_count:Number(String(group.members).replace(/[^0-9]/g,''))||null,relevance_score:Number(group.score),activity_score:Number(group.score)-5,status:'shortlisted',language:'ro'});setGroups(current=>current.map(item=>item.name===group.name?{...item,id:saved.id,saved:true}:item));onNotice('Grupul a fost salvat în Supabase')}catch(error){onNotice(`Salvarea a eșuat: ${error.message}`)}finally{setBusy('')}};const draft=async group=>{if(!user){onNotice('Autentifică-te pentru a genera drafturi');return}setBusy(group.name);try{const saved=group.id?group:await createGroupCandidate({owner_id:user.id,external_group_id:`manual-${group.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`,group_name:group.name,category:group.category,member_count:Number(String(group.members).replace(/[^0-9]/g,''))||null,relevance_score:Number(group.score),status:'shortlisted',language:'ro'});const result=await generateContent({prompt:`Scrie o postare utilă și naturală pentru grupul românesc «${group.name}», despre ${query}. Nu face reclamă agresivă și nu pretinde că postarea este publicată.`,platform:'facebook_group',tone:'empatic și util',variation:Date.now()});await createGroupOutreachDraft({owner_id:user.id,group_id:saved.id,body:result.body,hashtags:result.hashtags||[],ai_model:result.model||'fallback-local',status:'draft'});onNotice('Draftul pentru grup a fost salvat pentru aprobare')}catch(error){onNotice(`Draftul a eșuat: ${error.message}`)}finally{setBusy('')}};return <><PageTitle eyebrow="DESCOPERIRE AUDIENȚĂ" title="Facebook Groups Finder" desc="Identifică, clasifică și pregătește drafturi pentru grupuri românești relevante." action={<button className="primary" onClick={()=>onNotice('Căutarea automată se activează după conectarea Meta OAuth')}>⌕ Caută grupuri</button>}/><div className="finder-search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)}/><button className="primary" onClick={()=>onNotice('Meta OAuth este necesar pentru rezultate noi')}>Analizează</button></div><div className="group-note">♢ <span>Grupurile sunt doar identificate și clasificate. Nicio postare nu este publicată automat în grupuri.</span></div><div className="groups-list">{groups.map((group,i)=><div className="group-row" key={group.name}><div className="group-avatar">{group.name.charAt(0)}</div><div className="group-main"><b>{group.name}</b><span>{group.members} · {group.category}</span></div><div className="relevance"><small>RELEVANȚĂ</small><b>{group.score}%</b></div><span className="tag">{group.saved?'Salvat':'Potrivit'}</span><button className="outline small" disabled={busy===group.name} onClick={()=>save(group)}>{group.saved?'Salvat':'Salvează'}</button><button className="primary small" disabled={busy===group.name} onClick={()=>draft(group)}>Draft AI</button></div>)}</div></>}
function Analytics(){
  const [items,setItems]=useState([])
  useEffect(()=>{listPosts().then(setItems).catch(()=>setItems([]))},[])
  const published=items.filter(post=>post.status==='published').length
  const pending=items.filter(post=>post.status==='pending_approval').length
  const instagram=items.filter(post=>post.platform==='instagram').length
  const facebook=items.filter(post=>post.platform==='facebook').length
  const youtube=items.filter(post=>post.platform==='youtube').length
  const total=items.length||1
  const percent=n=>`${Math.round(n/total*100)}%`
  return <><PageTitle eyebrow="PERFORMANȚĂ" title="Analytics" desc="Indicatori calculați din postările și programările tale." action={<button className="outline" onClick={()=>window.location.reload()}>↻ Reîmprospătează</button>}/><div className="stats"><Stat label="Postări totale" value={items.length} change={`${published} publicate`} tone="green" note="din Supabase"/><Stat label="În aprobare" value={pending} change="necesită acțiune" tone="gold" note="înainte de publicare"/><Stat label="Programate" value={items.filter(post=>post.status==='scheduled').length} change="următoarele zile" tone="green" note="calendar editorial"/><Stat label="Videoclipuri" value={new Set(items.map(post=>post.media_id).filter(Boolean)).size} change="folosite" tone="gold" note="media asociată"/></div><div className="dashboard-grid"><section className="card activity"><CardHead title="Distribuție postări"/><div className="big-chart"><div className="line l1"></div><div className="line l2"></div><div className="line l3"></div></div><div className="chart-days"><span>Facebook</span><span>Instagram</span><span>YouTube</span><span>{items.length} total</span></div></section><section className="card channels"><CardHead title="Canale active"/><Channel name="Instagram" value={percent(instagram)} color="ig"/><Channel name="Facebook" value={percent(facebook)} color="fb"/><Channel name="YouTube" value={percent(youtube)} color="yt"/></section></div></>}
function Channel({name,value,color}){return <div className="channel"><span className={'platform '+color}>{name==='Instagram'?'◎':name==='Facebook'?'f':'▶'}</span><b>{name}</b><strong>{value}</strong><div><i className={color} style={{width:value}}></i></div></div>}
function Automation({user,onNotice}){
  const [ig,setIg]=useState(true),[fb,setFb]=useState(true),[yt,setYt]=useState(true),[tt,setTt]=useState(false),[approval,setApproval]=useState(true),[groupCount,setGroupCount]=useState(5),[groupEnabled,setGroupEnabled]=useState(true)
  const [igSlots,setIgSlots]=useState(['10:00','19:00']),[fbSlots,setFbSlots]=useState(['10:15','19:15']),[ytSlots,setYtSlots]=useState(['11:00','20:00']),[ttSlots,setTtSlots]=useState(['12:00','21:00'])
  const [media,setMedia]=useState([]),[busy,setBusy]=useState(false)
  useEffect(()=>{if(user) listMedia().then(setMedia).catch(error=>onNotice(`Media nu s-a putut încărca: ${error.message}`))},[user])
  const save=async()=>{if(!user){onNotice('Setările sunt în mod demo');return}try{await Promise.all([
    savePublishingSchedule({owner_id:user.id,platform:'instagram',posts_per_day:2,slots:igSlots,enabled:ig,require_approval:approval}),
    savePublishingSchedule({owner_id:user.id,platform:'facebook',posts_per_day:2,slots:fbSlots,enabled:fb,require_approval:approval}),
    savePublishingSchedule({owner_id:user.id,platform:'youtube',posts_per_day:2,slots:ytSlots,enabled:yt,require_approval:approval}),
    savePublishingSchedule({owner_id:user.id,platform:'tiktok',posts_per_day:2,slots:ttSlots,enabled:tt,require_approval:approval})
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
  return <><PageTitle eyebrow="ORCHESTRARE" title="Automatizări" desc="Stabilește ce publicăm zilnic și cât control păstrezi înainte de publicare." action={<div className="page-actions"><button className="outline" onClick={save}>Salvează setările</button><button className="primary" onClick={scheduleNextDay} disabled={busy}>{busy?'Se programează…':'＋ Programează următoarele 24h'}</button></div>}/><div className="automation-grid">{channelCard('ig','Instagram Reels','2 videoclipuri pe zi',ig,setIg,igSlots,setIgSlots,'AI-ul generează caption, descriere și hashtag-uri.')}{channelCard('fb','Facebook Reels','2 videoclipuri pe zi · Pagina PostaMoșului',fb,setFb,fbSlots,setFbSlots,'Publicare pe Pagina Facebook, separat de postările în grupuri.')}{channelCard('yt','YouTube Shorts','2 videoclipuri pe zi',yt,setYt,ytSlots,setYtSlots,'Titlul, descrierea și tag-urile sunt generate pentru YouTube.')}{channelCard('tt','TikTok','2 videoclipuri pe zi · trimise în inbox',tt,setTt,ttSlots,setTtSlots,'Clipul ajunge în inbox-ul TikTok; îl publici din aplicație.')}</div><div className="automation-grid lower"><section className="card"><CardHead title="Videoclipuri disponibile"/><p className="muted">Sunt disponibile {media.length} videoclipuri încărcate. La programare, ele sunt rotite automat între sloturi.</p>{!media.length&&<div className="safety-note">Încarcă videoclipuri din <b>Media library</b> înainte de programare.</div>}{media.slice(0,4).map(asset=><div className="automation-line" key={asset.id}><div><b>{asset.name}</b><small>{((asset.size_bytes||0)/1024/1024).toFixed(1)} MB · pregătit</small></div><span className="pill">READY</span></div>)} </section><section className="card"><CardHead title="Facebook Groups Finder"/><div className="automation-line"><div><b>Pregătește postări pentru grupuri</b><small>Scanează și selectează zilnic cele mai bune grupuri</small></div><button className={'toggle '+(groupEnabled?'on':'')} onClick={()=>setGroupEnabled(v=>!v)}><i/></button></div><label className="inline-field">Grupuri recomandate pe zi<input type="number" min="1" max="10" value={groupCount} onChange={e=>setGroupCount(e.target.value)}/></label><div className="group-flow"><span>1</span><p>Scor de relevanță</p><span>2</span><p>Text adaptat de AI</p><span>3</span><p>Aprobare manuală</p></div></section></div><div className="card safety-card"><CardHead title="Siguranță și aprobare"/><div className="automation-line"><div><b>Aprobare înainte de publicare</b><small>Nicio postare nu pleacă fără confirmarea ta</small></div><button className={'toggle '+(approval?'on':'')} onClick={()=>setApproval(v=>!v)}><i/></button></div><div className="safety-note">♢ <span>Programarea creează postări în starea „În aprobare”. Publicarea reală va fi activată doar după conectarea oficială a conturilor.</span></div></div></>
}

function Settings({user,profile,setProfile,onNotice}){
  const [section,setSection]=useState('General'),[approval,setApproval]=useState(true),[weekly,setWeekly]=useState(true),[voice,setVoice]=useState('cald, empatic și orientat spre familie'),[busy,setBusy]=useState(false)
  useEffect(()=>{if(user)listAutomationSettings().then(settings=>{if(settings){setApproval(settings.approval_required);setWeekly(settings.weekly_summary);setVoice(settings.brand_voice||'cald, empatic și orientat spre familie')}}).catch(()=>{})},[user])
  const save=async()=>{if(!user){onNotice('Autentifică-te pentru setări persistente');return}setBusy(true);try{const name=profile.full_name?.trim()||'Administrator';const updated=await updateProfile(user.id,name);setProfile(updated);await saveAutomationSettings({owner_id:user.id,approval_required:approval,weekly_summary:weekly,brand_voice:voice,timezone:'Europe/Bucharest'});onNotice('Setările au fost salvate în Supabase')}catch(error){onNotice(`Salvarea a eșuat: ${error.message}`)}finally{setBusy(false)}}
  const tabs=['General','Brand voice','Automatizări','Notificări','API & securitate']
  const toggle=(label,description,value,setValue)=><div className="setting-line"><div><b>{label}</b><small>{description}</small></div><button className={'toggle '+(value?'on':'')} onClick={()=>setValue(v=>!v)}><i/></button></div>
  const panel=()=>{
    if(section==='Brand voice') return <><label>Vocea brandului<input value={voice} onChange={e=>setVoice(e.target.value)}/></label><label>Instrucțiuni pentru AI<textarea defaultValue="Scrie natural, cald și util pentru părinți. Evită promisiunile exagerate și reclama agresivă."/></label><button className="primary" onClick={save} disabled={busy}>{busy?'Se salvează…':'Salvează vocea brandului'}</button></>
    if(section==='Automatizări') return <>{toggle('Aprobare înainte de publicare','Nicio postare nu este publicată fără confirmarea ta.',approval,setApproval)}<div className="safety-note">Programele zilnice se configurează în modulul <b>Automatizări</b>.</div><button className="primary" onClick={save} disabled={busy}>Salvează automatizările</button></>
    if(section==='Notificări') return <>{toggle('Rezumat săptămânal','Primește o analiză în fiecare luni.',weekly,setWeekly)}<label>Email notificări<input type="email" defaultValue={user?.email||''}/></label><div className="safety-note">Notificările externe vor fi activate după configurarea providerului de email.</div><button className="primary" onClick={save} disabled={busy}>Salvează notificările</button></>
    if(section==='API & securitate') return <><div className="security"><div className="security-icon">✓</div><div><b>Supabase conectat</b><p>Sesiunea administratorului și RLS sunt active.</p></div><span className="pill">ACTIV</span></div><div className="security"><div className="security-icon">✦</div><div><b>Gemini AI</b><p>Cheia este păstrată server-side în Edge Functions.</p></div><span className="pill">SERVER-SIDE</span></div><div className="safety-note">Cheile private nu sunt afișate și nu sunt incluse în build-ul public.</div></>
    return <><label>Numele administratorului<input value={profile.full_name||''} onChange={e=>setProfile({...profile,full_name:e.target.value})}/></label><label>Fus orar<select><option>Europe/Bucharest (GMT+2)</option></select></label>{toggle('Aprobare înainte de publicare','Toate postările necesită confirmare manuală.',approval,setApproval)}{toggle('Rezumat săptămânal','Primește o analiză în fiecare luni.',weekly,setWeekly)}<button className="primary" onClick={save} disabled={busy}>{busy?'Se salvează…':'Salvează modificările'}</button></>
  }
  return <><PageTitle eyebrow="CONTROL" title="Setări" desc="Configurează vocea brandului, automatizările și preferințele workspace-ului."/><div className="settings-layout"><aside className="settings-nav">{tabs.map(tab=><button key={tab} className={section===tab?'active':''} onClick={()=>setSection(tab)}>{tab}</button>)}</aside><section className="card settings-form"><h2>{section}</h2><p className="muted">Configurare persistentă pentru administratorul autentificat.</p>{panel()}</section></div></>
}
createRoot(document.getElementById('root')).render(<App />)
