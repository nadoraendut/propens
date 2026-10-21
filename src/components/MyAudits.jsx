import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useQuery, unwrap, Err, Hero, SectionHead, fmtDate } from './ui.jsx'
import { indicator } from '../lib/rubric.js'
import Rubric from './Rubric.jsx'

// A lecturer's own audits: the ones where they are the auditee (schedule the session, read the feedback, see the result
// once released) and the ones where they are the auditor (open the rubric).
export default function MyAudits({ profile, embedded = false }) {
  const asAuditee = useQuery(async () => unwrap(await supabase.rpc('my_audits')))
  const asAuditor = useQuery(async () => unwrap(await supabase.from('audits')
    .select('*, auditee:profiles!audits_auditee_id_fkey(full_name, staff_id, bidang), semester:semesters(code, state)')
    .eq('auditor_id', profile.id).order('created_at', { ascending: false })))
  const [rubricId, setRubricId] = useState(null)
  if (rubricId) return <Rubric auditId={rubricId} profile={profile} onBack={() => { setRubricId(null); asAuditor.reload(); asAuditee.reload() }} />

  const mine = asAuditee.data ?? [], duties = asAuditor.data ?? []
  return (
    <>
      {!embedded && <Hero compact chip="Teaching audits" title={<>Hello, <em>{profile.full_name || 'lecturer'}</em></>}
        sub="Set the date for your audit, read your feedback, and fill the rubric for the lecturers you audit." />}
      <SectionHead eyebrow="As auditee" title="My audit" />
      <Err>{asAuditee.error}</Err>
      {!asAuditee.loading && !mine.length && <div className="card muted">You have no audit this semester (or the list is not approved yet).</div>}
      {mine.map((a) => <Mine key={a.id} a={a} onChanged={asAuditee.reload} />)}

      <SectionHead eyebrow="As auditor" title="Lecturers I audit" />
      <Err>{asAuditor.error}</Err>
      {!asAuditor.loading && !duties.length && <div className="card muted">You are not assigned as an auditor.</div>}
      {duties.map((a) => (
        <div className="item" key={a.id}>
          <div className="grow">
            <div className="title">{a.auditee.full_name} <span className="muted">({a.auditee.staff_id}, {a.auditee.bidang})</span></div>
            <div className="sub">{a.semester?.code}{a.round_no === 2 ? ' · re-audit' : ''} · {a.session_date ? `${fmtDate(a.session_date)} ${a.session_time} ${a.venue}` : 'session not set yet'}</div>
          </div>
          {a.round_no === 2 && a.reaudit_state !== 'approved' ? <span className="pill warn">awaiting approval</span>
            : <button className={a.completed_at ? '' : 'primary'} onClick={() => setRubricId(a.id)}>{a.completed_at ? 'View rubric' : 'Open rubric form'}</button>}
        </div>))}
    </>
  )
}

function Mine({ a, onChanged }) {
  const [f, setF] = useState({ date: a.session_date ?? '', time: a.session_time ?? '', venue: a.venue ?? '' })
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  async function save(e) {
    e.preventDefault(); setErr(''); setOk('')
    try {
      unwrap(await supabase.rpc('schedule_session', { p_audit: a.id, p_date: f.date, p_time: f.time, p_venue: f.venue }))
      setOk('Session saved. Reminders will be sent to you and your auditor.'); onChanged()
    } catch (x) { setErr(x.message) }
  }
  return (
    <div className="card">
      <h2>{a.semester_code}{a.round_no === 2 ? ' · second audit' : ''} <span className="muted" style={{ fontWeight: 400 }}>auditor: {a.auditor_name}</span></h2>
      {a.result != null && <div className="privacy"><b>Your result: {Number(a.result)} / 100 — {indicator(Number(a.result))}</b></div>}
      {a.completed ? (
        <>
          <h3>Feedback from your auditor</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{a.feedback}</p>
          {a.result == null && <p className="muted">Marks are announced by the Ketua Pusat Pengajian after the committee approves them.</p>}
        </>
      ) : a.can_schedule ? (
        <form onSubmit={save}>
          <p className="muted">Agree on the date and time with your auditor, then enter them here so that reminders are sent.</p>
          <div className="row">
            <label>Date <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></label>
            <label>Time <input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
            <label>Venue <input value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} /></label>
            <button className="primary">{a.session_date ? 'Update session' : 'Save session'}</button>
          </div>
          {a.session_date && !ok && <p className="ok">Session set: {fmtDate(a.session_date)} {a.session_time} {a.venue}</p>}
          <Err>{err}</Err>{ok && <p className="ok">{ok}</p>}
        </form>
      ) : <p className="muted">This audit can no longer be scheduled.</p>}
    </div>
  )
}
