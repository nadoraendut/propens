import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { unwrap, Err, SectionHead } from '../ui.jsx'
import { loadHistory } from '../../lib/data.js'
import { runDraw } from '../../lib/draw.js'
import { newSeed } from '../../lib/rng.js'
import { isEligible, yearsOfService } from '../../lib/logic.js'

const RULE = { ok: ['OK', 'ok'], peer: ['Same seniority', 'warn'], none: ['Head to pick', 'bad'] }

// Step 2: draw the audit list in the browser (fair rotation using earlier semesters), review it, then save it.
export default function Draw({ sem, members, hasList, onSaved }) {
  const [exclude, setExclude] = useState([])
  const [force, setForce] = useState([])
  const [seedText, setSeedText] = useState('')
  const [preview, setPreview] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const people = members.map((m) => ({ ...m, name: m.full_name }))
  const byId = Object.fromEntries(people.map((p) => [p.id, p]))
  const active = people.filter((p) => isEligible(p.status))

  async function draw(fresh = false) {
    setBusy(true); setErr('')
    try {
      const history = await loadHistory(supabase, sem)
      const seed = !fresh && /^\d+$/.test(seedText) ? Number(seedText) : newSeed()
      const result = runDraw(people, history, { percent: Number(sem.min_percent), seed, exclude: new Set(exclude), force: new Set(force) })
      setPreview(result); setSeedText(String(seed))
    } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  async function save() {
    if (hasList && !confirm('Saving replaces the current list, including any manual edits. Continue?')) return
    setBusy(true); setErr('')
    try {
      unwrap(await supabase.rpc('save_generated_list', { p_semester: sem.id, p_rows: preview.rows.map((r) => ({ auditee_id: r.auditee_id, auditor_id: r.auditor_id })) }))
      setPreview(null); onSaved()
    } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  const chips = (ids, set) => ids.map((id) => <span className="pill" key={id} style={{ marginRight: 6 }}>{byId[id]?.full_name} <button className="link" style={{ padding: 0 }} onClick={() => set(ids.filter((x) => x !== id))}>×</button></span>)
  const picker = (label, ids, set, other) => (
    <div className="row"><label className="grow">{label}
      <select value="" onChange={(e) => e.target.value && set([...ids, e.target.value])}>
        <option value="">Add…</option>
        {active.filter((p) => !ids.includes(p.id) && !other.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.bidang})</option>)}
      </select></label>{chips(ids, set)}</div>)

  return (
    <div className="card">
      <SectionHead eyebrow="Step 2" title="Draw the audit list" />
      <p className="muted">Each Bidang gets at least {Number(sem.min_percent)}% audited. Lecturers who have waited longest since they were last audited go first; equal waits are drawn by lot. Auditors must be higher in grade or more senior, and the load is shared.</p>
      {picker('Do not audit this semester (e.g. on leave)', exclude, setExclude, force)}
      {picker('Must be audited this semester', force, setForce, exclude)}
      <div className="row">
        <label>Seed (optional, repeats a draw) <input inputMode="numeric" style={{ width: 150 }} value={seedText} onChange={(e) => setSeedText(e.target.value.replace(/\D/g, ''))} /></label>
        <button className="primary" disabled={busy || !active.length} onClick={() => draw(false)}>{preview ? 'Draw with this seed' : 'Draw'}</button>
        {preview && <button disabled={busy} onClick={() => draw(true)}>Draw again (new seed)</button>}
      </div>
      <Err>{err}</Err>
      {preview && <Preview r={preview} byId={byId} />}
      {preview && (
        <div className="row"><button className="primary" disabled={busy || !preview.rows.length} onClick={save}>Save this list</button>
          <button disabled={busy} onClick={() => setPreview(null)}>Discard</button>
          <span className="muted">Seed {preview.seed}: the same people, settings and seed give the same list.</span></div>)}
    </div>
  )
}

function Preview({ r, byId }) {
  const f = r.fairness
  return (
    <>
      <h3>Draft list ({r.rows.length})</h3>
      {r.short.map((s) => <div className="err" key={s.dept}>{s.dept}: needed {s.needed} but only {s.got} could be selected.</div>)}
      {r.unmatched > 0 && <div className="privacy"><b>{r.unmatched}</b> auditee(s) have nobody who outranks or equals them: the Head of Faculty picks the auditor.</div>}
      {f.repeats.length > 0 && <div className="privacy">Picked again straight after {f.previous} because their Bidang is too small to avoid it: {f.repeats.map((x) => `${x.name} (${x.bidang})`).join(', ')}.</div>}
      <div className="scroll"><table>
        <thead><tr><th>Auditee</th><th>Gred</th><th>Bidang</th><th>Why selected</th><th>Auditor</th><th>Rule</th></tr></thead>
        <tbody>{r.rows.map((x) => {
          const ee = byId[x.auditee_id], er = byId[x.auditor_id]
          return (
            <tr key={x.auditee_id}><td>{ee.full_name}<div className="muted">{ee.staff_id}</div></td><td>{ee.grade}</td><td>{ee.bidang}</td>
              <td>{x.reason}{x.forced && <> <span className="pill">must include</span></>}</td>
              <td>{er ? <>{er.full_name}<div className="muted">{er.grade}, {yearsOfService(er.start_date)}y</div></> : <b className="bad">Head to pick</b>}</td>
              <td><span className={`pill ${RULE[x.rule][1]}`}>{RULE[x.rule][0]}</span></td></tr>)
        })}</tbody>
      </table></div>
      <div className="stats">
        <div className="stat"><b>{f.avgWaitSelected ?? '–'}</b>avg semesters waited (selected)</div>
        <div className="stat"><b>{f.avgWaitPool ?? '–'}</b>avg semesters waited (everyone)</div>
        <div className="stat"><b>{f.historySemesters}</b>earlier semesters used</div>
        {f.neverAuditedRemaining != null && <div className="stat"><b>{f.neverAuditedRemaining}</b>still never audited</div>}
      </div>
      <div className="scroll"><table>
        <thead><tr><th>Bidang</th><th>Active</th><th>Required</th><th>Selected</th><th>Everyone has had a turn after</th></tr></thead>
        <tbody>{r.departments.map((d) => <tr key={d.dept}><td>{d.dept}</td><td>{d.total}</td><td>{d.required}</td>
          <td className={d.ok ? 'ok' : 'bad'}>{d.selected}</td><td>{d.cycle} semester(s)</td></tr>)}</tbody>
      </table></div>
    </>
  )
}
