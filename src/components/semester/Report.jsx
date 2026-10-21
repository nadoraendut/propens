import { supabase } from '../../lib/supabase.js'
import { useQuery, Err, SectionHead, StatStrip, download } from '../ui.jsx'
import { fetchByIds } from '../../lib/data.js'
import { buildReport, exportSheets, finalAudits } from '../../lib/report.js'
import { indicator } from '../../lib/rubric.js'
import { sheetsToBlob } from '../../lib/xlsx.js'

const scoreMap = (rows) => rows.reduce((m, r) => { (m[r.audit_id] ??= {})[r.item] = r.score; return m }, {})
const loadScores = (table, ids) => fetchByIds(ids, (chunk) => supabase.from(table).select('audit_id, item, score').in('audit_id', chunk).order('audit_id').order('item')).then(scoreMap)

/** Builds and downloads the Excel workbook for a semester (admin). Comments are not included. */
export async function downloadExcel(sem, audits, pool) {
  const ids = audits.filter((a) => a.completed_at).map((a) => a.id)
  const [scores, facility, corr] = await Promise.all([
    loadScores('audit_scores', ids), loadScores('facility_scores', ids),
    fetchByIds(audits.map((a) => a.id), (chunk) => supabase.from('audit_corrections')
      .select('*, by:profiles!audit_corrections_corrected_by_fkey(full_name)').in('audit_id', chunk).order('created_at')),
  ])
  const byId = Object.fromEntries(audits.map((a) => [a.id, a]))
  const corrections = corr.map((c) => ({ ...c, audit: byId[c.audit_id], by_name: c.by?.full_name }))
  const report = buildReport(sem, audits, pool, scores)
  download(await sheetsToBlob(exportSheets(sem, audits, report, scores, facility, corrections)), `audit_marks_${sem.code}.xlsx`)
}

export default function Report({ sem, audits, pool }) {
  const ids = finalAudits(audits).filter((a) => a.completed_at).map((a) => a.id).join(',')
  const scores = useQuery(async () => loadScores('audit_scores', ids ? ids.split(',') : []), [ids])
  const r = buildReport(sem, audits, pool, scores.data ?? {})
  return (
    <>
      <SectionHead eyebrow="Report" title={`Semester ${sem.code}`} />
      <Err>{scores.error}</Err>
      <StatStrip stats={[[r.audits, 'Selected'], [r.completed, 'Completed'], [r.average ?? '–', 'Average mark'], [r.cemerlang.length, 'Cemerlang']]} />
      <div className="stats">
        <div className="stat"><b>{r.eligible}</b>active lecturers</div>
        <div className="stat"><b>{r.scheduled}</b>scheduled</div>
        <div className="stat"><b>{r.notScheduled}</b>no date yet</div>
        <div className="stat"><b>{r.highest ?? '–'} / {r.lowest ?? '–'}</b>highest / lowest</div>
        {r.reaudits > 0 && <div className="stat"><b>{r.reauditsDone} / {r.reaudits}</b>re-audits done (below {r.threshold})</div>}
        {r.stillBelow > 0 && <div className="stat"><b className="bad">{r.stillBelow}</b>final mark still below {r.threshold}</div>}
        {r.peerPairs > 0 && <div className="stat"><b>{r.peerPairs}</b>same-seniority pairings</div>}
        {r.ruleOverrides > 0 && <div className="stat"><b className="bad">{r.ruleOverrides}</b>auditor rule overrides</div>}
      </div>
      <div className="card"><h2>By department</h2><div className="scroll"><table>
        <thead><tr><th>Bidang</th><th>Active</th><th>Required</th><th>Selected</th><th>Completed</th><th>Progress</th><th>Avg marks</th></tr></thead>
        <tbody>{r.quota.map((q) => <tr key={q.dept}><td>{q.dept}</td><td>{q.total}</td><td>{q.required}</td><td className={q.ok ? 'ok' : 'bad'}>{q.selected}</td><td>{q.completed}</td>
          <td><div className="bar-track"><div className="bar-fill" style={{ width: `${q.selected ? (100 * q.completed) / q.selected : 0}%` }} /></div></td><td>{q.average ?? '—'}</td></tr>)}</tbody>
      </table></div></div>
      <div className="card"><h2>Cemerlang (final mark 90 and above)</h2><div className="scroll"><table>
        <thead><tr><th>Lecturer</th><th>Bidang</th><th>Campus</th><th>Marks</th></tr></thead>
        <tbody>{r.cemerlang.map((c) => <tr key={c.staff_id}><td>{c.name} <span className="muted">{c.staff_id}</span></td><td>{c.bidang}</td><td>{c.campus}</td><td className="ok"><b>{c.marks}</b> {indicator(c.marks).split(' / ')[0]}</td></tr>)}</tbody>
      </table></div>{!r.cemerlang.length && <p className="muted">None yet.</p>}</div>
      <div className="card"><h2>By campus</h2><div className="scroll"><table>
        <thead><tr><th>Campus</th><th>Completed</th><th>Avg marks</th></tr></thead>
        <tbody>{r.campus.map((c) => <tr key={c.campus}><td>{c.campus}</td><td>{c.count}</td><td>{c.average}</td></tr>)}</tbody>
      </table></div>{!r.campus.length && <p className="muted">No completed audits yet.</p>}</div>
      <div className="card"><h2>Mark distribution</h2><table><tbody>{Object.entries(r.bands).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table></div>
      <div className="card"><h2>Average by rubric section</h2><div className="scroll"><table>
        <thead><tr><th>Section</th><th>Average</th><th>Max</th><th>%</th></tr></thead>
        <tbody>{r.sections.map((s) => <tr key={s.key}><td>{s.key}: {s.title}</td><td>{s.average ?? '—'}</td><td>{s.max}</td><td>{s.percent ?? '—'}</td></tr>)}</tbody>
      </table></div></div>
      <div className="card"><h2>Auditor workload</h2><div className="scroll"><table>
        <thead><tr><th>Auditor</th><th>Assigned</th><th>Completed</th></tr></thead>
        <tbody>{r.workload.map((w) => <tr key={w.staff_id}><td>{w.name} <span className="muted">{w.staff_id}</span></td><td>{w.assigned}</td><td>{w.completed}</td></tr>)}</tbody>
      </table></div></div>
    </>
  )
}
