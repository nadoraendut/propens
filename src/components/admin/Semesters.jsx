import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { useQuery, unwrap, Err, SectionHead, StatePill, StatStrip } from '../ui.jsx'
import { parseSemester, byNewest, normalizeCode, semesterLabel } from '../../lib/semester.js'

// Semester list (admin and Head). Only the admin can create a semester.
export default function Semesters({ profile, onOpen }) {
  const sems = useQuery(async () => unwrap(await supabase.from('semesters').select('*')))
  const list = [...(sems.data ?? [])].sort(byNewest)
  return (
    <>
      <StatStrip stats={[[list.length, 'Semesters'], [list.filter((s) => s.state === 'approved').length, 'In progress'], [list.filter((s) => ['pending_head', 'changes_requested'].includes(s.state)).length, 'With the Head']]} />
      {profile.role === 'admin' && <NewSemester profile={profile} semesters={list} onCreated={(row) => { sems.reload(); onOpen(row.id) }} />}
      <SectionHead eyebrow="Audits" title="Semesters" />
      <Err>{sems.error}</Err>
      <div className="card">
        {!list.length && !sems.loading && <p className="muted">{profile.role === 'admin' ? 'Create your first semester above (for example 20262 for March 2026).' : 'No semesters yet.'}</p>}
        {list.map((s) => (
          <div className="row" key={s.id}>
            <button className="link grow" style={{ textAlign: 'left' }} onClick={() => onOpen(s.id)}>
              <b>{s.code}</b> {semesterLabel(s.code)}
            </button>
            <span className="muted">min {Number(s.min_percent)}% · re-audit below {Number(s.reaudit_below)}</span>
            <StatePill state={s.state} />
          </div>))}
      </div>
    </>
  )
}

function NewSemester({ profile, semesters, onCreated }) {
  const [f, setF] = useState({ code: '', pct: '20', below: '80' })
  const [err, setErr] = useState('')
  const parsed = parseSemester(f.code)
  async function submit(e) {
    e.preventDefault(); setErr('')
    if (!parsed) return setErr('Use 4-digit year + 1-digit intake, e.g. 20262 for March 2026.')
    if (semesters.some((s) => s.code === parsed.code)) return setErr(`Semester ${parsed.code} already exists.`)
    const pct = Number(f.pct), below = Number(f.below)
    if (!(pct > 0 && pct <= 100)) return setErr('The minimum percentage must be between 0 and 100.')
    if (!(below > 0 && below <= 100)) return setErr('The re-audit threshold must be between 0 and 100.')
    try {
      onCreated(unwrap(await supabase.from('semesters')
        .insert({ code: parsed.code, min_percent: pct, reaudit_below: below, created_by: profile.id }).select().single()))
      setF({ code: '', pct: '20', below: '80' })
    } catch (x) { setErr(x.message) }
  }
  return (
    <form className="card" onSubmit={submit}>
      <h2>New semester</h2>
      <div className="row">
        <input placeholder="Semester code (e.g. 20262)" inputMode="numeric" maxLength={5} value={f.code}
          onChange={(e) => setF({ ...f, code: normalizeCode(e.target.value) })} required />
        <label>Minimum % audited in each Bidang <input type="number" min="1" max="100" step="any" style={{ width: 80 }} value={f.pct} onChange={(e) => setF({ ...f, pct: e.target.value })} required /></label>
        <label>Re-audit if the mark is below <input type="number" min="1" max="100" step="any" style={{ width: 80 }} value={f.below} onChange={(e) => setF({ ...f, below: e.target.value })} required /></label>
        <button className="primary" disabled={!parsed}>Create semester</button>
      </div>
      <p className="muted" style={{ margin: '4px 0 0' }}>{parsed ? parsed.label : f.code ? 'Not a valid code' : 'Year + intake: 20262 = March 2026 (Mac-Ogos), 20264 = October 2026'}</p>
      <Err>{err}</Err>
    </form>
  )
}
