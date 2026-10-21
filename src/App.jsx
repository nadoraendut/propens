import { useCallback, useEffect, useState } from 'react'
import { supabase, configured } from './lib/supabase.js'
import Login from './components/Login.jsx'
import { Logo } from './components/ui.jsx'
import ChangePassword from './components/ChangePassword.jsx'
import Notifications from './components/Notifications.jsx'
import Admin from './components/Admin.jsx'
import Head from './components/Head.jsx'
import MyAudits from './components/MyAudits.jsx'
import SemesterView from './components/SemesterView.jsx'

// A notification link: 'semester:<uuid>' opens that semester, 'my-audits' the lecturer's own audits.
export const parseLink = (link) => {
  const m = String(link ?? '').match(/^semester:(.+)$/)
  return m ? { name: 'semester', id: m[1] } : { name: 'home', tab: link === 'my-audits' ? 'mine' : undefined }
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [profile, setProfile] = useState(null)
  const [changingPw, setChangingPw] = useState(false)
  const [page, setPage] = useState({ name: 'home' })
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    setProfile(null); setPage({ name: 'home' })
    if (!session) return
    supabase.from('profiles').select('*').eq('id', session.user.id).single().then(({ data }) => setProfile(data))
  }, [session?.user.id])

  const countUnread = useCallback(async () => {
    if (!session) return
    const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false)
    setUnread(count ?? 0)
  }, [session?.user.id])
  useEffect(() => {
    countUnread()
    const t = setInterval(countUnread, 60000) // re-check every minute while open (no push notifications)
    return () => clearInterval(t)
  }, [countUnread])

  if (!configured) return <main><div className="card err">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).</div></main>
  if (session === undefined) return null
  if (!session) return <Login />

  const forced = session.user.user_metadata?.must_change_password === true
  if (forced || changingPw) {
    return <ChangePassword forced={forced} onDone={async () => { await supabase.auth.refreshSession(); setChangingPw(false) }} />
  }
  if (!profile) return <main className="muted">Loading…</main>

  const open = (link) => { setPage(parseLink(link)); countUnread() }
  const home = () => setPage({ name: 'home' })

  let body
  if (page.name === 'alerts') body = <Notifications onOpen={open} onChanged={countUnread} />
  else if (page.name === 'semester' && ['admin', 'head'].includes(profile.role))
    body = <SemesterView id={page.id} profile={profile} onBack={home} />
  else if (profile.role === 'admin') body = <Admin profile={profile} onOpen={(id) => setPage({ name: 'semester', id })} startTab={page.tab} />
  else if (profile.role === 'head') body = <Head profile={profile} onOpen={(id) => setPage({ name: 'semester', id })} startTab={page.tab} />
  else body = <MyAudits profile={profile} />

  return (
    <>
      <header className="bar">
        <button className="brand link" style={{ padding: 0 }} onClick={home}><Logo size={34} />Propens</button>
        <span className="who">{profile.full_name || session.user.email} · {profile.role}</span>
        <button onClick={() => setPage({ name: 'alerts' })}>Alerts{unread > 0 && <span className="pill solid" style={{ marginLeft: 6 }}>{unread}</span>}</button>
        <button onClick={() => setChangingPw(true)}>Password</button>
        <button onClick={() => supabase.auth.signOut()}>Log out</button>
      </header>
      <main>{body}</main>
    </>
  )
}
