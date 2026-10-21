import { useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { unwrap, useQuery, Err, SectionHead } from '../ui.jsx'
import { fetchAll } from '../../lib/data.js'
import { isEligible } from '../../lib/logic.js'

// Who is in this semester's list (admin, while the list is still editable). Quota, draw and auditors all start from here.
export default function Members({ sem, members, onChanged }) {
  const all = useQuery(async () => fetchAll(() => supabase.from('profiles').select('id, staff_id, full_name, bidang, status').order('full_name').order('id')))
  const [pick, setPick] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const inList = new Set(members.map((m) => m.id))
  const candidates = (all.data ?? []).filter((p) => !inList.has(p.id) && p.staff_id)
  const missingActive = candidates.filter((p) => isEligible(p.status))

  async function add(ids) {
    setBusy(true); setErr('')
    try {
      for (let i = 0; i < ids.length; i += 400) {
        unwrap(await supabase.from('semester_lecturers').insert(ids.slice(i, i + 400).map((lecturer_id) => ({ semester_id: sem.id, lecturer_id }))))
      }
      setPick(''); onChanged()
    } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  async function remove(ids) {
    setBusy(true); setErr('')
    try {
      for (let i = 0; i < ids.length; i += 80) unwrap(await supabase.from('semester_lecturers').delete().eq('semester_id', sem.id).in('lecturer_id', ids.slice(i, i + 80)))
      onChanged()
    } catch (x) { setErr(x.message) }
    setBusy(false)
  }
  const active = members.filter((m) => isEligible(m.status)).length

  return (
    <div className="card">
      <SectionHead eyebrow="Step 1" title={`Lecturers in this semester (${members.length})`} />
      <p className="muted">{active} active. Only lecturers with Status "Active" are drawn or can audit. Add people from the Lecturers tab first if they are missing.</p>
      <div className="row">
        <button className="primary" disabled={busy || !missingActive.length} onClick={() => add(missingActive.map((p) => p.id))}>
          Add all active lecturers{missingActive.length ? ` (${missingActive.length})` : ''}</button>
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add one lecturer…</option>
          {candidates.map((p) => <option key={p.id} value={p.id}>{p.full_name} ({p.staff_id}, {p.bidang})</option>)}
        </select>
        <button disabled={!pick || busy} onClick={() => add([pick])}>Add</button>
        {members.length > 0 && <button className="danger" disabled={busy} onClick={() => confirm(`Remove all ${members.length} lecturers from this semester?`) && remove(members.map((m) => m.id))}>Clear list</button>}
      </div>
      <Err>{err || all.error}</Err>
      {members.length > 0 && (
        <details><summary className="muted">Show the {members.length} lecturers</summary>
          <div className="scroll"><table>
            <thead><tr><th>Staff ID</th><th>Name</th><th>Bidang</th><th>Status</th><th></th></tr></thead>
            <tbody>{members.map((m) => (
              <tr key={m.id}><td>{m.staff_id}</td><td>{m.full_name}</td><td>{m.bidang}</td>
                <td><span className={`pill ${isEligible(m.status) ? 'ok' : 'muted'}`}>{m.status}</span></td>
                <td><button className="link danger" disabled={busy} onClick={() => remove([m.id])}>Remove</button></td></tr>))}</tbody>
          </table></div></details>)}
    </div>
  )
}
