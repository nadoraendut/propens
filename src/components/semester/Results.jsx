import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { unwrap, Err, SectionHead, fmt } from '../ui.jsx'
import { finalAudits } from '../../lib/report.js'
import { flushMail } from '../../lib/mail.js'

// After the results go to AJK Induk the admin records it and releases the marks. Until then a lecturer sees no mark.
export default function Results({ sem, audits, role, onChanged }) {
  const [allow, setAllow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const finals = finalAudits(audits)
  const done = finals.filter((a) => a.completed_at).length
  async function run(fn) { setBusy(true); setErr(''); try { await fn(); flushMail(); onChanged() } catch (x) { setErr(x.message) } setBusy(false) }
  return (
    <>
      <SectionHead eyebrow="Results" title="AJK Induk and release of marks" />
      <div className="card">
        <p>Final audits completed: <b>{done} / {finals.length}</b>. Marks are never shown to a lecturer before release; afterwards each lecturer sees only their own final mark.</p>
        <p>1. Submitted to AJK Induk: {sem.submitted_ajk_at ? <b className="ok">{fmt(sem.submitted_ajk_at)}</b>
          : role === 'admin' ? <button disabled={busy} onClick={() => run(async () => unwrap(await supabase.rpc('mark_submitted_ajk', { p_semester: sem.id })))}>Mark as submitted to AJK Induk</button>
          : <span className="muted">not yet</span>}</p>
        <p>2. Marks released to lecturers: {sem.released_at ? <b className="ok">{fmt(sem.released_at)}</b>
          : role === 'admin' && sem.submitted_ajk_at ? (
            <span className="row" style={{ display: 'inline-flex' }}>
              {done < finals.length && <label><input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} /> release anyway ({finals.length - done} unfinished; they will see no result)</label>}
              <button className="primary" disabled={busy || (done < finals.length && !allow)}
                onClick={() => confirm('Release marks to all lecturers? This cannot be undone.') && run(async () => unwrap(await supabase.rpc('release_marks', { p_semester: sem.id, p_allow_incomplete: allow })))}>Release marks</button>
            </span>) : <span className="muted">not yet{role === 'admin' && !sem.submitted_ajk_at ? ' (record step 1 first)' : ''}</span>}</p>
        <Err>{err}</Err>
      </div>
    </>
  )
}
