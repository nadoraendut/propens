import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useQuery, unwrap, Err, Hero, SectionHead, fmt } from './ui.jsx'
import { yearsOfService } from '../lib/logic.js'
import { flushMail } from '../lib/mail.js'
import { SECTIONS, SCALE, FACILITY_ITEMS, FACILITY_SCALE, ITEM_NUMBERS, compute, indicator } from '../lib/rubric.js'

// The PRO-PENS rubric (Rubrik Pemantauan Pensyarah). Modes:
//   edit    the auditor fills it (draft or submit)       view    everyone else who may read it (admin, Head, the auditor afterwards)
//   correct the admin corrects a submitted audit (scores + comments + a mandatory reason)
export default function Rubric({ auditId, profile, onBack }) {
  const q = useQuery(async () => {
    const audit = unwrap(await supabase.from('audits')
      .select('*, auditee:profiles!audits_auditee_id_fkey(*), auditor:profiles!audits_auditor_id_fkey(*), semester:semesters(code, state)').eq('id', auditId).single())
    const rows = async (table) => Object.fromEntries(unwrap(await supabase.from(table).select('item, score').eq('audit_id', auditId)).map((r) => [r.item, r.score]))
    const corrections = ['admin', 'head'].includes(profile.role)
      ? unwrap(await supabase.from('audit_corrections').select('*, by:profiles!audit_corrections_corrected_by_fkey(full_name)').eq('audit_id', auditId).order('created_at', { ascending: false })) : []
    return { audit, scores: await rows('audit_scores'), facility: await rows('facility_scores'), corrections }
  }, [auditId])
  const [correcting, setCorrecting] = useState(false)
  if (q.loading && !q.data) return <p className="muted">Loading…</p>
  if (q.error) return <><button onClick={onBack}>Back</button><div className="err">{q.error}</div></>
  const { audit, scores, facility, corrections } = q.data
  const mine = audit.auditor_id === profile.id
  const open = mine && !audit.completed_at && audit.semester?.state === 'approved'
  const mode = correcting ? 'correct' : open ? 'edit' : 'view'
  return <Form key={`${audit.id}-${mode}-${corrections.length}`} {...{ audit, scores, facility, corrections, profile, mode, onBack }}
    onCorrect={() => setCorrecting(true)} onDone={(leave) => { setCorrecting(false); leave ? onBack() : q.reload() }} />
}

function Form({ audit, scores: s0, facility: f0, corrections, profile, mode, onBack, onCorrect, onDone }) {
  const [scores, setScores] = useState(s0)
  const [facility, setFacility] = useState(f0)
  const [h, setH] = useState({ faculty: audit.faculty, program: audit.program, course_code: audit.course_code, group_no: audit.group_no,
    student_count: audit.student_count ?? '', method: audit.method, session_date: audit.session_date ?? '', session_time: audit.session_time,
    facility_room: audit.facility_room, facility_suggestion: audit.facility_suggestion })
  const [c, setC] = useState({ teaching: audit.comment_teaching, prof: audit.comment_prof, other: audit.comment_other })
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const editScores = mode !== 'view', editHeader = mode === 'edit'
  const r = compute(scores)
  const ee = audit.auditee

  const body = () => ({ ...h, student_count: h.student_count === '' ? '' : String(h.student_count),
    comments: c, scores, facility })
  async function save(submit) {
    if (submit && !confirm('Submit? You cannot edit after submitting. Only your comments are sent to the lecturer.')) return
    setBusy(true); setErr('')
    try { unwrap(await supabase.rpc('save_rubric', { p_audit: audit.id, p_form: body(), p_submit: submit })); if (submit) flushMail(); onDone(submit) } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  async function correct() {
    if (!confirm('Save this correction? It is logged and the Head and the auditor are told.')) return
    setBusy(true); setErr('')
    try { unwrap(await supabase.rpc('correct_audit', { p_audit: audit.id, p_scores: scores, p_comments: c, p_reason: reason })); flushMail(); onDone(false) } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  const dis = (on) => (on ? {} : { disabled: true })
  const field = (k, label, type = 'text') => (
    <label>{label}<input type={type} value={h[k]} {...dis(editHeader)} onChange={(e) => setH({ ...h, [k]: e.target.value })} /></label>)

  return (
    <>
      <Hero compact chip={`${audit.semester?.code ?? ''}${audit.round_no === 2 ? ' · re-audit' : ''}`} title={<>PRO-PENS <em>rubric</em></>}
        sub={`${ee.full_name} · audited by ${audit.auditor?.full_name ?? '—'}`}
        actions={<><button onClick={onBack}>Back</button>
          {profile.role === 'admin' && audit.completed_at && mode === 'view' && <button className="primary" onClick={onCorrect}>Correct this audit</button>}</>} />
      {mode === 'edit' && <div className="privacy"><b>Peringatan:</b> Pensyarah pemantau adalah <b>tidak dibenarkan</b> memaklumkan markah kepada pensyarah yang dinilai. Markah hanya akan dimaklumkan oleh Ketua Pusat Pengajian selepas mendapat kelulusan Mesyuarat Jawatankuasa Akademik Negeri. Only your written comments are sent to the lecturer.</div>}
      {mode === 'correct' && <div className="privacy"><b>Admin correction.</b> Change item scores and/or comments, then give a reason. It is logged; the Head and the auditor are told, and if marks are already released the lecturer is told their result changed.</div>}

      <div className="card">
        <div className="hdr-grid">
          <label>Nama pensyarah dipantau<input value={ee.full_name} disabled /></label>
          <label>No. pekerja<input value={ee.staff_id ?? ''} disabled /></label>
          <label>Gred jawatan<input value={ee.grade} disabled /></label>
          <label>Bil. tahun berkhidmat<input value={ee.start_date ? yearsOfService(ee.start_date) : ''} disabled /></label>
          {field('faculty', 'Fakulti')}{field('program', 'Program')}{field('course_code', 'Kod kursus')}{field('group_no', 'Kumpulan')}
          {field('student_count', 'Bil. pelajar', 'number')}{field('method', 'Kaedah penilaian')}{field('session_date', 'Tarikh', 'date')}{field('session_time', 'Masa', 'time')}
        </div>
      </div>

      {SECTIONS.map((sec) => (
        <div key={sec.key}>
          <div className="sec-band">{sec.title}</div>
          <div className="card rb"><div className="scroll"><table>
            <thead><tr><th>No.</th><th>Item</th>{SCALE.map((n, i) => <th key={n}>{n} ({i + 1})</th>)}</tr></thead>
            <tbody>
              {sec.items.map((it) => (
                <tr key={it.no}>
                  <td>{it.no}</td>
                  <td>{it.bm}{it.en && <span className="en">{it.en}</span>}{it.note && <span className="note">{it.note}</span>}</td>
                  {it.levels.map((d, i) => (
                    <td key={i} className={`lv${scores[it.no] === i + 1 ? ' on' : ''}`}>
                      <label><input type="radio" name={`item_${it.no}`} checked={scores[it.no] === i + 1} {...dis(editScores)}
                        onChange={() => setScores({ ...scores, [it.no]: i + 1 })} />{d}</label></td>))}
                </tr>))}
              <tr className="tot"><td></td><td>Jumlah Skor / Total Score</td><td colSpan={5}>{r.sections[sec.key]} / {sec.max}</td></tr>
            </tbody>
          </table></div></div>
        </div>))}

      <div className="card">
        <h2>Komen Keseluruhan (WAJIB DIISI)</h2>
        <label>Pengajaran dan Pembelajaran *<textarea value={c.teaching} {...dis(editScores)} onChange={(e) => setC({ ...c, teaching: e.target.value })} /></label>
        <label>Profesionalisme Pensyarah *<textarea value={c.prof} {...dis(editScores)} onChange={(e) => setC({ ...c, prof: e.target.value })} /></label>
        <label>Lain-Lain Perkara<textarea value={c.other} {...dis(editScores)} onChange={(e) => setC({ ...c, other: e.target.value })} /></label>
        <p className="muted">Nama pensyarah pemantau: <b>{audit.auditor?.full_name}</b></p>
      </div>

      <div className="card rb fac">
        <h2>Prasarana &amp; Fasiliti Pembelajaran di bilik kuliah</h2>
        <p className="muted">Not part of the mark. Visible to the auditor, admin and Head of Faculty only; not sent to the lecturer. {mode === 'correct' && 'Not changed by a correction.'}</p>
        <label>Bilik kuliah <input value={h.facility_room} {...dis(editHeader)} onChange={(e) => setH({ ...h, facility_room: e.target.value })} /></label>
        <div className="scroll"><table>
          <thead><tr><th>Kriteria</th>{FACILITY_SCALE.map((n, i) => <th key={n}>{i} {n}</th>)}</tr></thead>
          <tbody>{FACILITY_ITEMS.map((t, i) => (
            <tr key={i}><td>{i + 1}. {t}</td>{FACILITY_SCALE.map((n, v) => (
              <td className="c" key={v}><input type="radio" name={`fac_${i + 1}`} checked={facility[i + 1] === v} {...dis(editHeader)} onChange={() => setFacility({ ...facility, [i + 1]: v })} /></td>))}</tr>))}</tbody>
        </table></div>
        <label>Cadangan penambahbaikan dan lain-lain<textarea value={h.facility_suggestion} {...dis(editHeader)} onChange={(e) => setH({ ...h, facility_suggestion: e.target.value })} /></label>
      </div>

      {mode === 'correct' && (
        <div className="card"><h2>Reason for correction (required)</h2>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} /></div>)}
      {corrections.length > 0 && (
        <div className="card"><h2>Correction history</h2><div className="scroll"><table>
          <thead><tr><th>When</th><th>By</th><th>Marks</th><th>Reason</th><th>Changes</th></tr></thead>
          <tbody>{corrections.map((x) => <tr key={x.id}><td>{fmt(x.created_at)}</td><td>{x.by?.full_name}</td><td>{Number(x.old_marks)} → {Number(x.new_marks)}</td><td>{x.reason}</td><td className="muted">{x.changes}</td></tr>)}</tbody>
        </table></div></div>)}

      <Err>{err}</Err>
      <div className="sticky-total">
        <div className="grow"><b>TS</b> {r.ts} / 50 &nbsp; <b>TAS</b> {r.tas} / 100 &nbsp;
          <span className="pill">{r.complete ? indicator(r.tas) : `incomplete (${ITEM_NUMBERS.filter((n) => scores[n] != null).length}/29)`}</span>
          <div className="muted" style={{ fontSize: 12 }}>TS = (A+B+C) × 50 / 145 · TAS = TS × 2 · &lt;60 Sangat Lemah · 60–69 Lemah · 70–79 Memuaskan · 80–89 Baik · 90–100 Cemerlang</div></div>
        {mode === 'edit' && <><button disabled={busy} onClick={() => save(false)}>Save draft</button>
          <button className="primary" disabled={busy || !r.complete} onClick={() => save(true)}>Submit &amp; send comments to lecturer</button></>}
        {mode === 'correct' && <><button className="primary" disabled={busy || !r.complete || !reason.trim()} onClick={correct}>Save correction</button>
          <button disabled={busy} onClick={() => onDone(false)}>Cancel</button></>}
      </div>
    </>
  )
}
