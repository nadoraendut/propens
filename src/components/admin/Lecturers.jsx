import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { useQuery, unwrap, Err, Ok, SectionHead, StatStrip, download, fmtDate } from '../ui.jsx'
import { yearsOfService, isEligible } from '../../lib/logic.js'
import { parseLecturerRows, readLecturerFile, lecturerTemplate, COLUMNS } from '../../lib/lecturers.js'

// All lecturers (admin only): import from Excel/CSV, add one, edit details, set role and status.
export default function Lecturers() {
  const list = useQuery(async () => unwrap(await supabase.from('profiles').select('*').order('bidang').order('full_name')))
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)
  const rows = (list.data ?? []).filter((p) => !q || `${p.staff_id} ${p.full_name} ${p.bidang}`.toLowerCase().includes(q.toLowerCase()))
  const active = (list.data ?? []).filter((p) => isEligible(p.status)).length
  return (
    <>
      <StatStrip stats={[[list.data?.length ?? 0, 'Lecturers'], [active, 'Active'], [new Set((list.data ?? []).map((p) => p.bidang)).size, 'Bidang']]} />
      <Import onDone={list.reload} />
      <AddOne onDone={list.reload} />
      <SectionHead eyebrow="Staff" title="All lecturers" right={<input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />} />
      <Err>{list.error}</Err>
      {editing && <Edit row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload() }} />}
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>Staff ID</th><th>Name</th><th>Gred</th><th>Bidang</th><th>Started</th><th>Years</th><th>Campus</th><th>Status</th><th>Email</th><th>Role</th><th></th></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id}><td>{p.staff_id ?? '–'}</td><td>{p.full_name}</td><td>{p.grade}</td><td>{p.bidang}</td><td>{fmtDate(p.start_date)}</td>
            <td>{p.start_date ? yearsOfService(p.start_date) : ''}</td><td>{p.campus}</td>
            <td><span className={`pill ${isEligible(p.status) ? 'ok' : 'muted'}`}>{p.status}</span></td><td>{p.email}</td>
            <td>{p.role !== 'lecturer' ? <span className="pill solid">{p.role}</span> : 'lecturer'}</td>
            <td><button className="link" onClick={() => setEditing(p)}>Edit</button></td></tr>))}</tbody>
      </table></div></div>
    </>
  )
}

function Import({ onDone }) {
  const [parsed, setParsed] = useState(null)
  const [err, setErr] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  async function pick(e) {
    setErr(''); setResult(null); setParsed(null)
    const file = e.target.files?.[0]
    if (!file) return
    try { setParsed(await readLecturerFile(file)) } catch (x) { setErr(x.message) }
    e.target.value = ''
  }
  async function run() {
    setBusy(true); setErr('')
    try {
      const out = unwrap(await supabase.functions.invoke('import-lecturers', { body: { lecturers: parsed.good } }))
      if (out?.error) throw new Error(out.error)
      setResult(out); setParsed(null); onDone()
    } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  return (
    <div className="card">
      <h2>Import lecturers</h2>
      <p className="muted">An .xlsx or .csv with {COLUMNS.map(([, h]) => h).join(', ')}. New lecturers log in with their Staff ID (first password = Staff ID, they must change it). Existing Staff IDs are updated, never duplicated.</p>
      <div className="row">
        <label className="btn primary">Choose file<input type="file" accept=".xlsx,.csv" onChange={pick} hidden /></label>
        <button onClick={async () => download(await lecturerTemplate(), 'lecturer_template.xlsx')}>Download template</button>
      </div>
      <Err>{err}</Err>
      {parsed && (
        <>
          <p><b>{parsed.good.length}</b> lecturer(s) ready{parsed.errors.length > 0 && <>, <b className="bad">{parsed.errors.length}</b> row(s) skipped</>}.</p>
          {parsed.errors.slice(0, 15).map((e) => <div className="err" key={e}>{e}</div>)}
          {parsed.errors.length > 15 && <p className="muted">…and {parsed.errors.length - 15} more.</p>}
          <button className="primary" disabled={busy || !parsed.good.length} onClick={run}>{busy ? 'Importing…' : `Import ${parsed.good.length} lecturer(s)`}</button>
        </>)}
      {result && (
        <Ok>Created {result.created}, updated {result.updated}{result.failed.length > 0 && `, ${result.failed.length} failed`}.
          {result.failed.map((f) => <div key={f.staff_id}>{f.staff_id}: {f.error}</div>)}</Ok>)}
    </div>
  )
}

function AddOne({ onDone }) {
  const blank = { staff_id: '', name: '', grade: '', bidang: '', start_date: '', campus: '', email: '' }
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(blank)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function submit(e) {
    e.preventDefault(); setErr('')
    try {
      const { good, errors } = parseLecturerRows([COLUMNS.map(([, h]) => h), [f.staff_id, f.name, f.grade, f.bidang, f.start_date, f.campus, 'Active', f.email]])
      if (errors.length) throw new Error(errors[0].replace(/^Row \d+: /, ''))
      const out = unwrap(await supabase.functions.invoke('import-lecturers', { body: { lecturers: good } }))
      if (out?.error) throw new Error(out.error)
      if (out.failed.length) throw new Error(out.failed[0].error)
      setF(blank); setOpen(false); onDone()
    } catch (x) { setErr(x.message) }
  }
  if (!open) return <div className="row"><button onClick={() => setOpen(true)}>Add one lecturer</button></div>
  return (
    <form className="card" onSubmit={submit}>
      <h2>Add a lecturer</h2>
      <div className="row">
        <input placeholder="Staff ID (first password)" value={f.staff_id} onChange={set('staff_id')} required />
        <input placeholder="Full name" value={f.name} onChange={set('name')} required />
        <input placeholder="Gred (e.g. DS52)" value={f.grade} onChange={set('grade')} required />
        <input placeholder="Bidang" value={f.bidang} onChange={set('bidang')} required />
        <label>Start of employment <input type="date" value={f.start_date} onChange={set('start_date')} required /></label>
        <input placeholder="Campus" value={f.campus} onChange={set('campus')} />
        <input type="email" placeholder="Email" value={f.email} onChange={set('email')} />
      </div>
      <Err>{err}</Err>
      <div className="row"><button className="primary">Add</button><button type="button" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  )
}

function Edit({ row, onClose, onSaved }) {
  const [f, setF] = useState({ ...row })
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function save(e) {
    e.preventDefault(); setErr('')
    try {
      unwrap(await supabase.from('profiles').update({
        full_name: f.full_name.trim(), staff_id: f.staff_id?.trim() || null, grade: f.grade.trim(), bidang: f.bidang.trim(),
        start_date: f.start_date || null, campus: f.campus.trim(), status: f.status.trim() || 'Active', email: f.email.trim(), role: f.role,
      }).eq('id', row.id))
      onSaved()
    } catch (x) { setErr(x.message) }
  }
  return (
    <form className="card" onSubmit={save}>
      <h2>Edit {row.full_name}</h2>
      <div className="row">
        <label>Staff ID <input value={f.staff_id ?? ''} onChange={set('staff_id')} /></label>
        <label>Name <input value={f.full_name} onChange={set('full_name')} required /></label>
        <label>Gred <input value={f.grade} onChange={set('grade')} /></label>
        <label>Bidang <input value={f.bidang} onChange={set('bidang')} /></label>
        <label>Start <input type="date" value={f.start_date ?? ''} onChange={set('start_date')} /></label>
        <label>Campus <input value={f.campus} onChange={set('campus')} /></label>
        <label>Status <input value={f.status} onChange={set('status')} placeholder="Active" /></label>
        <label>Email <input type="email" value={f.email} onChange={set('email')} /></label>
        <label>Role <select value={f.role} onChange={set('role')}><option>lecturer</option><option>admin</option><option>head</option></select></label>
      </div>
      <p className="muted">Only lecturers with Status "Active" are drawn as auditees or auditors.</p>
      <Err>{err}</Err>
      <div className="row"><button className="primary">Save</button><button type="button" onClick={onClose}>Cancel</button></div>
    </form>
  )
}
