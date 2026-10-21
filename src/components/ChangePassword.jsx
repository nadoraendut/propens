import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { Err } from './ui.jsx'

export default function ChangePassword({ forced, onDone }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (pw.length < 8) return setErr('Use at least 8 characters.')
    if (pw !== pw2) return setErr('Passwords do not match.')
    const { error } = await supabase.auth.updateUser({ password: pw, data: { must_change_password: false } })
    if (error) return setErr(error.message)
    onDone()
  }

  return (
    <div className="login-side" style={{ minHeight: '100vh' }}>
    <form className="card login" onSubmit={submit}>
      <h2>{forced ? 'Set a new password' : 'Change password'}</h2>
      {forced && <p className="muted">You are using a temporary password. Choose a new one to continue.</p>}
      <input type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
      <input type="password" placeholder="Repeat new password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
      <Err>{err}</Err>
      <div className="row"><button className="primary">Save</button>{!forced && <button type="button" onClick={onDone}>Cancel</button>}</div>
    </form>
    </div>
  )
}
