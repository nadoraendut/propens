import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { unwrap, Err, SectionHead, fmtDate } from '../ui.jsx'
import { ruleStatus, yearsOfService } from '../../lib/logic.js'
import { indicator, isCemerlang } from '../../lib/rubric.js'

const RULE = { ok: ['OK', 'ok'], peer: ['Same seniority', 'warn'], override: ['Override', 'bad'], none: ['Head to pick', 'bad'] }
export const EDITABLE = ['draft', 'generated', 'changes_requested']

// The audit list (round 1). The admin edits it until it is verified; the Head can fill rows that have no auditor.
export default function AuditList({ sem, audits, pool, quota, role, onRubric, onChanged }) {
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [add, setAdd] = useState({ auditee: '', auditor: '' })
  const [headPick, setHeadPick] = useState({})
  const rows = audits.filter((a) => a.round_no === 1)
  const editable = role === 'admin' && EDITABLE.includes(sem.state)
  const headAssign = role === 'head' && sem.state === 'pending_head'
  const audited = new Set(rows.map((a) => a.auditee_id))
  const candidates = pool.filter((p) => !audited.has(p.id))

  async function run(fn) {
    setBusy(true); setErr('')
    try { await fn(); onChanged() } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  const setAuditor = (a, id) => run(async () => unwrap(await supabase.rpc('set_auditor', { p_audit: a.id, p_auditor: id || null })))
  const options = (a) => pool.filter((p) => p.id !== a.auditee_id)
  const label = (p) => `${p.full_name} (${p.grade}, ${yearsOfService(p.start_date)}y)`

  return (
    <>
      <SectionHead eyebrow="Audit list" title={`Auditees and auditors (${rows.length})`} />
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Bidang</th><th>Active</th><th>Required (min {Number(sem.min_percent)}%)</th><th>Selected</th><th></th></tr></thead>
        <tbody>{quota.map((q) => <tr key={q.dept}><td>{q.dept}</td><td>{q.total}</td><td>{q.required}</td><td>{q.selected}</td>
          <td className={q.ok ? 'ok' : 'bad'}>{q.ok ? 'OK' : 'Below minimum'}</td></tr>)}</tbody>
      </table></div>{!quota.length && <p className="muted">Add lecturers to the semester first.</p>}</div>

      <Err>{err}</Err>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Auditee</th><th>Gred</th><th>Years</th><th>Bidang</th><th>Auditor</th><th>Rule</th><th>Session</th><th>Mark</th><th></th></tr></thead>
        <tbody>{rows.map((a) => {
          const st = ruleStatus(a.auditor, a.auditee, pool)
          return (
            <tr key={a.id}>
              <td>{a.auditee.full_name}<div className="muted">{a.auditee.staff_id}</div></td>
              <td>{a.auditee.grade}</td><td>{yearsOfService(a.auditee.start_date)}</td><td>{a.auditee.bidang}</td>
              <td>{editable ? (
                <select value={a.auditor_id ?? ''} disabled={busy} onChange={(e) => setAuditor(a, e.target.value)}>
                  <option value="">— none —</option>{options(a).map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
                </select>
              ) : headAssign && !a.auditor_id ? (
                <span className="row" style={{ margin: 0 }}>
                  <select value={headPick[a.id] ?? ''} onChange={(e) => setHeadPick({ ...headPick, [a.id]: e.target.value })}>
                    <option value="">Choose…</option>{options(a).map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}</select>
                  <button className="primary" disabled={busy || !headPick[a.id]} onClick={() => run(async () => unwrap(await supabase.rpc('head_assign_auditor', { p_audit: a.id, p_auditor: headPick[a.id] })))}>Assign</button>
                </span>
              ) : a.auditor ? <>{a.auditor.full_name}<div className="muted">{a.auditor.grade}, {yearsOfService(a.auditor.start_date)}y</div></> : '—'}</td>
              <td><span className={`pill ${RULE[st][1]}`}>{RULE[st][0]}</span></td>
              <td>{a.session_date ? `${fmtDate(a.session_date)} ${a.session_time}` : <span className="muted">—</span>}</td>
              <td>{a.completed_at ? <>{Number(a.marks)} <span className={`pill ${isCemerlang(Number(a.marks)) ? 'ok' : ''}`}>{indicator(Number(a.marks)).split(' / ')[0]}</span>{' '}
                <button className="link" onClick={() => onRubric(a.id)}>rubric</button></> : <span className="muted">—</span>}</td>
              <td>{editable && <button className="link danger" disabled={busy} onClick={() => run(async () => unwrap(await supabase.rpc('remove_audit', { p_audit: a.id })))}>Remove</button>}</td>
            </tr>)
        })}</tbody>
      </table></div>{!rows.length && <p className="muted">No audit list yet.</p>}
        {editable && candidates.length > 0 && (
          <div className="row">
            <select value={add.auditee} onChange={(e) => setAdd({ ...add, auditee: e.target.value })}>
              <option value="">Add an auditee…</option>{candidates.map((p) => <option key={p.id} value={p.id}>{p.full_name} — {p.bidang} ({p.grade})</option>)}</select>
            <select value={add.auditor} onChange={(e) => setAdd({ ...add, auditor: e.target.value })}>
              <option value="">Auditor (optional)</option>{pool.filter((p) => p.id !== add.auditee).map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}</select>
            <button disabled={!add.auditee || busy} onClick={() => run(async () => { unwrap(await supabase.rpc('add_audit', { p_semester: sem.id, p_auditee: add.auditee, p_auditor: add.auditor || null })); setAdd({ auditee: '', auditor: '' }) })}>Add</button>
          </div>)}
      </div>
    </>
  )
}
