// Pure rules: eligibility, years of service, grade rank, who may audit whom, the per-department quota.

export const ELIGIBLE_STATUS = 'active'
export const isEligible = (status) => String(status ?? '').trim().toLowerCase() === ELIGIBLE_STATUS

/** Accepts Date, ISO 'YYYY-MM-DD', DD/MM/YYYY, DD-MM-YYYY or a bare year. Returns a Date (local) or null. */
export function parseDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate())
  const s = String(value).trim()
  let m
  if (/^\d{4}$/.test(s)) return new Date(+s, 0, 1)
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) return mk(+m[1], +m[2], +m[3])
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return mk(+m[3], +m[2], +m[1])
  throw new Error(`Unrecognised date: ${value}`)
}
function mk(y, mo, d) {
  const dt = new Date(y, mo - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) throw new Error(`Invalid date: ${y}-${mo}-${d}`)
  return dt
}

/** Year of employment = current year - year employment started. */
export function yearsOfService(start, today = new Date()) {
  const d = parseDate(start)
  return Math.max(0, today.getFullYear() - d.getFullYear())
}

/** Numeric rank of a Gred Jawatan such as 'DS52' (higher = higher grade). No digits = 0. */
export function gradeRank(grade) {
  const m = String(grade ?? '').match(/\d+/)
  return m ? Number(m[0]) : 0
}

/** Auditor must be a different person AND (higher grade OR more years of service). Objects: {id, grade, start_date}. */
export function canAudit(auditor, auditee, today = new Date()) {
  if (auditor.id === auditee.id) return false
  if (gradeRank(auditor.grade) > gradeRank(auditee.grade)) return true
  return yearsOfService(auditor.start_date, today) > yearsOfService(auditee.start_date, today)
}

/** Same seniority (equal years of service), different person. Fallback for people nobody outranks. */
export const isPeer = (auditor, auditee, today = new Date()) =>
  auditor.id !== auditee.id && yearsOfService(auditor.start_date, today) === yearsOfService(auditee.start_date, today)

/** Minimum number to audit in a group of `total` at `percent` (rounded up, at least 1 for a non-empty group). */
export function requiredCount(total, percent) {
  if (total <= 0 || percent <= 0) return 0
  const n = Math.ceil(Number(((total * percent) / 100).toFixed(9)))
  return Math.min(total, Math.max(1, n))
}

/**
 * How an auditor relates to an auditee, given the whole pool:
 *  ok = outranks / more senior; peer = nobody outranks the auditee and the auditor has the same years;
 *  override = any other manual pick; none = no auditor.
 */
export function ruleStatus(auditor, auditee, pool, today = new Date()) {
  if (!auditor) return 'none'
  if (canAudit(auditor, auditee, today)) return 'ok'
  if (isPeer(auditor, auditee, today) && !pool.some((p) => canAudit(p, auditee, today))) return 'peer'
  return 'override'
}
