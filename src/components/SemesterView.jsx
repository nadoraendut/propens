import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useQuery, unwrap, Err, Hero, StatStrip, STATE_LABELS, Tabs } from './ui.jsx'
import { semesterLabel } from '../lib/semester.js'
import { isEligible } from '../lib/logic.js'
import { departmentQuota, finalAudits } from '../lib/report.js'
import { AUDIT_SELECT, fetchAll } from '../lib/data.js'
import Members from './semester/Members.jsx'
import Draw from './semester/Draw.jsx'
import AuditList, { EDITABLE } from './semester/AuditList.jsx'
import Reaudits from './semester/Reaudits.jsx'
import Results from './semester/Results.jsx'
import Report, { downloadExcel } from './semester/Report.jsx'
import { StateBanner, VerifyBar, HeadDecision, CloseBar } from './semester/Actions.jsx'
import Rubric from './Rubric.jsx'

// One semester, for the admin and the Head of Faculty. What shows depends on the semester's state and on who is looking.
export default function SemesterView({ id, profile, onBack }) {
  const role = profile.role
  const sem = useQuery(async () => unwrap(await supabase.from('semesters').select('*').eq('id', id).single()), [id])
  const members = useQuery(async () => (await fetchAll(() => supabase.from('semester_lecturers')
    .select('lecturer:profiles(*)').eq('semester_id', id).order('lecturer_id'))).map((r) => r.lecturer).filter(Boolean), [id])
  const audits = useQuery(async () => unwrap(await supabase.from('audits').select(AUDIT_SELECT).eq('semester_id', id).order('created_at')), [id])
  const [tab, setTab] = useState('list')
  const [rubricId, setRubricId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const reload = () => { sem.reload(); members.reload(); audits.reload() }

  if (rubricId) return <Rubric auditId={rubricId} profile={profile} onBack={() => { setRubricId(null); reload() }} />
  if (sem.error) return <><button onClick={onBack}>Back</button><div className="err">{sem.error}</div></>
  if (!sem.data) return <p className="muted">Loading…</p>

  const s = sem.data
  const rows = audits.data ?? []
  const people = members.data ?? []
  const pool = people.filter((p) => isEligible(p.status))
  const quota = departmentQuota(s, rows, pool)
  const finals = finalAudits(rows)
  const editable = role === 'admin' && EDITABLE.includes(s.state)
  const started = ['approved', 'closed'].includes(s.state)

  async function excel() {
    setBusy(true); setErr('')
    try { await downloadExcel(s, rows, pool) } catch (x) { setErr(x.message) }
    setBusy(false)
  }

  return (
    <>
      <Hero chip={`Semester ${s.code} · ${semesterLabel(s.code)}`} title={<>Audit list <em>{s.code}</em></>}
        sub={`Minimum ${Number(s.min_percent)}% audited in every Bidang. Re-audit if the final mark is below ${Number(s.reaudit_below)}.`}
        actions={<><button onClick={onBack}>Back</button>
          {role === 'admin' && started && <button disabled={busy} onClick={excel}>{busy ? 'Preparing…' : 'Download Excel'}</button>}</>}
        nav={<Tabs value={tab} onChange={setTab} tabs={[['list', 'Audit list'], ['report', 'Report']]} />} />
      <StatStrip stats={[[pool.length, 'Active lecturers'], [finals.length, 'Auditees'], [finals.filter((a) => a.completed_at).length, 'Completed'], [STATE_LABELS[s.state], 'State']]} />
      <Err>{err || audits.error || members.error}</Err>

      {tab === 'report' ? <Report sem={s} audits={rows} pool={pool} /> : (
        <>
          <StateBanner sem={s} role={role} rows={rows} />
          {role === 'head' && <HeadDecision sem={s} rows={rows} onChanged={reload} />}
          {editable && <Members sem={s} members={people} onChanged={reload} />}
          {editable && <Draw sem={s} members={people} hasList={rows.length > 0} onSaved={reload} />}
          <AuditList sem={s} audits={rows} pool={pool} quota={quota} role={role} onRubric={setRubricId} onChanged={reload} />
          {role === 'admin' && <VerifyBar sem={s} rows={rows} quota={quota} onChanged={reload} />}
          <Reaudits sem={s} audits={rows} pool={pool} role={role} onChanged={reload} onRubric={setRubricId} />
          {started && <Results sem={s} audits={rows} role={role} onChanged={reload} />}
          {role === 'admin' && <CloseBar sem={s} audits={rows} onChanged={reload} />}
        </>)}
    </>
  )
}
