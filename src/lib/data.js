// Data loading helpers.
import { buildHistory } from './rotation.js'

const unwrap = ({ data, error }) => { if (error) throw error; return data }

/**
 * PostgREST returns at most 1000 rows per request and cuts the rest off silently. Page through a query instead.
 * `make` must return a fresh query builder with a stable order, e.g. () => supabase.from('t').select('*').order('id').
 */
export async function fetchAll(make, size = 1000) {
  const out = []
  for (let from = 0; ; from += size) {
    const rows = unwrap(await make().range(from, from + size - 1))
    out.push(...rows)
    if (rows.length < size) return out
  }
}

/** History of the semesters before `semester`, for the rotation (who was audited, who audited, who was in the pool). */
export async function loadHistory(supabase, semester) {
  const sems = unwrap(await supabase.from('semesters').select('id, code').lt('code', semester.code))
  if (!sems.length) return []
  const audits = await fetchAll(() => supabase.from('audits')
    .select('id, semester_id, round_no, reaudit_state, auditee:profiles!audits_auditee_id_fkey(staff_id), auditor:profiles!audits_auditor_id_fkey(staff_id)')
    .in('semester_id', sems.map((s) => s.id)).order('id'))
  const withAudits = [...new Set(audits.map((a) => a.semester_id))]
  const members = withAudits.length ? await fetchAll(() => supabase.from('semester_lecturers')
    .select('semester_id, lecturer:profiles(staff_id, status)').in('semester_id', withAudits).order('semester_id').order('lecturer_id')) : []
  return buildHistory({
    semesters: sems.map((s) => ({ id: s.id, code: s.code, name: s.code })),
    members: members.filter((m) => m.lecturer?.staff_id).map((m) => ({ semester_id: m.semester_id, staff_id: m.lecturer.staff_id, status: m.lecturer.status })),
    audits: audits.map((a) => ({ semester_id: a.semester_id, round_no: a.round_no, reaudit_state: a.reaudit_state,
      auditee_staff: a.auditee?.staff_id, auditor_staff: a.auditor?.staff_id })),
  }, semester.code)
}

/** `.in('col', ids)` puts every id in the URL; long lists break it. Run `make(chunk)` per chunk of ids and join the pages. */
export async function fetchByIds(ids, make, chunk = 80) {
  const out = []
  for (let i = 0; i < ids.length; i += chunk) out.push(...await fetchAll(() => make(ids.slice(i, i + chunk))))
  return out
}

export const AUDIT_SELECT = '*, auditee:profiles!audits_auditee_id_fkey(*), auditor:profiles!audits_auditor_id_fkey(*)'
