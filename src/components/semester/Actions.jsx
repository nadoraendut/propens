import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { unwrap, Err } from '../ui.jsx'
import { flushMail } from '../../lib/mail.js'

// Banners and the buttons that move a semester from state to state. The database checks who may do what.
export function StateBanner({ sem, role, rows }) {
  const open = rows.filter((a) => a.round_no === 1 && !a.auditor_id).length
  return (
    <>
      {sem.state === 'changes_requested' && sem.head_comment && <div className="err"><b>Head of Faculty asked for changes:</b> {sem.head_comment}</div>}
      {sem.state === 'pending_head' && role === 'admin' && <div className="privacy">With the Head of Faculty for approval. The list is locked.</div>}
      {sem.state === 'pending_head' && role === 'head' && open > 0 && <div className="privacy"><b>{open}</b> auditee(s) have no auditor. Pick one in the list below before approving.</div>}
    </>
  )
}

export function VerifyBar({ sem, rows, quota, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!['generated', 'changes_requested'].includes(sem.state)) return null
  const below = quota.some((q) => !q.ok)
  const open = rows.filter((a) => a.round_no === 1 && !a.auditor_id).length
  async function go() {
    setBusy(true); setErr('')
    try { unwrap(await supabase.rpc('submit_to_head', { p_semester: sem.id })); flushMail(); onChanged() } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  return (
    <div className="card">
      <h2>Verify and send to the Head of Faculty</h2>
      <p className="muted">Check the list below. You can still change auditors, add or remove auditees. {open > 0 && `${open} row(s) have no auditor: the Head will pick one. `}{below && 'Some Bidang are below the minimum: add auditees first.'}</p>
      <Err>{err}</Err>
      <button className="primary" disabled={busy || below || !rows.length} onClick={go}>Verify &amp; send to Head of Faculty</button>
    </div>
  )
}

export function HeadDecision({ sem, rows, onChanged }) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (sem.state !== 'pending_head') return null
  const open = rows.filter((a) => a.round_no === 1 && !a.auditor_id).length
  async function decide(approve) {
    setBusy(true); setErr('')
    try { unwrap(await supabase.rpc('head_decide', { p_semester: sem.id, p_approve: approve, p_comment: comment })); flushMail(); onChanged() } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  return (
    <div className="card">
      <h2>Your decision</h2>
      <p className="muted">Approving tells every auditee and auditor. Requesting changes sends the list back to the admin with your comment.</p>
      <textarea placeholder="Comment (required if you request changes)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <Err>{err}</Err>
      <div className="row">
        <button className="primary" disabled={busy || open > 0} onClick={() => decide(true)}>Approve list</button>
        <button className="danger" disabled={busy} onClick={() => decide(false)}>Request changes</button>
        {open > 0 && <span className="muted">Pick auditors for all rows to approve.</span>}
      </div>
    </div>
  )
}

export function CloseBar({ sem, audits, onChanged }) {
  const [err, setErr] = useState('')
  if (sem.state !== 'approved') return null
  const unfinished = audits.filter((a) => a.round_no === 2 && !a.completed_at).length
  async function go() {
    if (!confirm('Close this semester? No more audits can be edited or scheduled.')) return
    try { unwrap(await supabase.rpc('close_semester', { p_semester: sem.id })); onChanged() } catch (x) { setErr(x.message) }
  }
  return (
    <div className="row"><button onClick={go} disabled={unfinished > 0}>Close semester</button>
      {unfinished > 0 && <span className="muted">{unfinished} re-audit(s) unfinished.</span>}<Err>{err}</Err></div>
  )
}
