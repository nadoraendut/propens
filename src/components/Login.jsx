import { useState } from 'react'
import { supabase, supabaseHost, loginEmail } from '../lib/supabase.js'
import { describeAuthError } from '../lib/env.js'
import { Err, Logo } from './ui.jsx'

export default function Login() {
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(id), password: pw })
      if (error) setErr(describeAuthError(error, supabaseHost))
    } catch (x) { setErr(describeAuthError(x, supabaseHost)) }
    setBusy(false)
  }

  return (
    <div className="login-page">
      <section className="login-hero hero-bg">
        <div className="brandline"><Logo size={52} />Propens</div>
        <h1>A fair <em>giliran</em> for every lecturer.</h1>
        <p>PRO-PENS teaching audits: a rotating draw of auditees and auditors, approval by the Head of Faculty, the rubric, and results.</p>
        <div className="hero-chips">
          <span className="hero-chip"><i />Fair rotation</span>
          <span className="hero-chip"><i />Approvals</span>
          <span className="hero-chip"><i />PRO-PENS rubric</span>
        </div>
      </section>
      <div className="login-side">
        <form className="card login" onSubmit={submit}>
          <h2>Log in</h2>
          <p className="muted login-sub">Lecturers use their Staff ID. Admin and Head of Faculty may use their email.</p>
          <input placeholder="Staff ID or email" value={id} onChange={(e) => setId(e.target.value)} autoFocus required />
          <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          <Err>{err}</Err>
          <button className="primary" disabled={busy}>Log in</button>
        </form>
      </div>
    </div>
  )
}
