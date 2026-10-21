import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { unwrap, Err, SectionHead } from '../ui.jsx'
import { yearsOfService } from '../../lib/logic.js'
import { flushMail } from '../../lib/mail.js'
import { pickAuditor } from '../../lib/rotation.js'
import { makeRng, newSeed } from '../../lib/rng.js'

const STATE = { proposed: ['Proposed', 'warn'], pending_head: ['With the Head', 'warn'], changes_requested: ['Sent back', 'bad'], approved: ['Approved', 'ok'] }

// A final mark below the threshold means a second audit by a different auditor. The admin names the auditor (the app suggests
// one, favouring the lightest workload), the Head approves. The second mark replaces the first.
export default function Reaudits({ sem, audits, pool, role, onChanged, onRubric }) {
  const rows = audits.filter((a) => a.round_no === 2)
  const [pick, setPick] = useState({})
  const [comment, setComment] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = useMemo(() => {
    const l = {}
    for (const a of audits) if (a.auditor_id && (a.round_no === 1 || a.reaudit_state === 'approved')) l[a.auditor_id] = (l[a.auditor_id] ?? 0) + 1
    return l
  }, [audits])
  const used = (a) => new Set(audits.filter((x) => x.auditee_id === a.auditee_id && x.round_no === 1).map((x) => x.auditor_id))
  const suggestion = useMemo(() => Object.fromEntries(rows.filter((a) => !a.auditor_id).map((a) =>
    [a.id, pickAuditor(a.auditee, pool, new Set([a.auditee_id, ...used(a)]), load, makeRng(newSeed())) ?? ''])), [rows.length, pool.length])
  if (!rows.length) return null

  async function run(fn) { setBusy(true); setErr(''); try { await fn(); flushMail(); onChanged() } catch (x) { setErr(x.message) } setBusy(false) }

  return (
    <>
      <SectionHead eyebrow="Low marks" title={`Re-audits (final mark below ${Number(sem.reaudit_below)})`} />
      <p className="muted">The second mark replaces the first. A second mark that is also low is flagged to the admin and Head; no third audit is created.</p>
      <Err>{err}</Err>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Auditee</th><th>First mark / auditor</th><th>Second auditor</th><th>Status</th></tr></thead>
        <tbody>{rows.map((a) => {
          const first = audits.find((x) => x.auditee_id === a.auditee_id && x.round_no === 1)
          const open = role === 'admin' && ['proposed', 'changes_requested'].includes(a.reaudit_state)
          const options = pool.filter((p) => p.id !== a.auditee_id && !used(a).has(p.id))
          const chosen = pick[a.id] ?? a.auditor_id ?? suggestion[a.id] ?? ''
          const [lbl, tone] = STATE[a.reaudit_state] ?? ['', '']
          return (
            <tr key={a.id}>
              <td>{a.auditee.full_name}<div className="muted">{a.auditee.staff_id}</div></td>
              <td>{Number(first?.marks)} <span className="muted">/ {first?.auditor?.full_name}</span></td>
              <td>{open ? (
                <span className="row" style={{ margin: 0 }}>
                  <select value={chosen} onChange={(e) => setPick({ ...pick, [a.id]: e.target.value })}>
                    <option value="">— choose —</option>{options.map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.grade}, {yearsOfService(p.start_date)}y)</option>)}</select>
                  <button className="primary" disabled={busy || !chosen} onClick={() => run(async () => unwrap(await supabase.rpc('submit_reaudit', { p_audit: a.id, p_auditor: chosen })))}>Submit to Head</button>
                </span>
              ) : role === 'head' && a.reaudit_state === 'pending_head' ? (
                <div><b>{a.auditor?.full_name}</b> ({a.auditor?.grade}, {yearsOfService(a.auditor?.start_date)}y)
                  <input placeholder="Reason (required to send back)" style={{ width: '100%', margin: '6px 0' }} value={comment[a.id] ?? ''} onChange={(e) => setComment({ ...comment, [a.id]: e.target.value })} />
                  <div className="row"><button className="primary" disabled={busy} onClick={() => run(async () => unwrap(await supabase.rpc('decide_reaudit', { p_audit: a.id, p_approve: true })))}>Approve</button>
                    <button className="danger" disabled={busy} onClick={() => run(async () => unwrap(await supabase.rpc('decide_reaudit', { p_audit: a.id, p_approve: false, p_comment: comment[a.id] ?? '' })))}>Send back</button></div>
                </div>
              ) : a.auditor?.full_name ?? '—'}</td>
              <td><span className={`pill ${tone}`}>{lbl}</span>{a.reaudit_comment && <div className="err">{a.reaudit_comment}</div>}
                {a.completed_at && <div>Second mark: <b>{Number(a.marks)}</b> <button className="link" onClick={() => onRubric(a.id)}>rubric</button>{Number(a.marks) < Number(sem.reaudit_below) && <span className="bad"> still below {Number(sem.reaudit_below)}</span>}</div>}</td>
            </tr>)
        })}</tbody>
      </table></div></div>
    </>
  )
}
