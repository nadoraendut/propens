// Fair rotation ("giliran") for choosing auditees and auditors.
//
// Complaint being solved: the same lecturers keep being selected. Principles:
//  * AUDITEES: inside every department the quota (minimum %) is filled by whoever has WAITED LONGEST since they were last
//    audited. Someone audited last semester has waited 0 and is only picked again when the department is too small to avoid
//    it. Someone never audited ranks by how many semesters they have been in the pool. Ties are drawn by lot.
//  * AUDITORS: the workload is spread evenly in the semester first; then lecturers who are not themselves being audited are
//    preferred; then whoever has gone longest without serving, then whoever has served least overall. The grade / seniority
//    rule (logic.js) is unchanged.
//
// History = past semesters, oldest first:
//   { name, present: Set of staff ids | null (unknown), audited: Set of staff ids, auditorCounts: { staffId: n } }
import { canAudit, isPeer, requiredCount, yearsOfService, isEligible } from './logic.js'

/**
 * Build the history from database rows (semesters before `beforeCode`, oldest first).
 *  semesters: [{ id, code, name }]  members: [{ semester_id, staff_id, status }]
 *  audits: [{ semester_id, auditee_staff, auditor_staff, round_no, reaudit_state }]
 * A semester with no audits says nothing about who was audited, so it is skipped.
 */
export function buildHistory({ semesters, members, audits }, beforeCode) {
  const out = []
  const sorted = [...semesters].filter((s) => s.code < beforeCode).sort((a, b) => (a.code < b.code ? -1 : 1))
  for (const sem of sorted) {
    const rows = audits.filter((a) => a.semester_id === sem.id)
    if (!rows.length) continue
    const auditorCounts = {}
    for (const a of rows) {
      const active = a.round_no === 1 || a.reaudit_state === 'approved'
      if (a.auditor_staff && active) auditorCounts[a.auditor_staff] = (auditorCounts[a.auditor_staff] ?? 0) + 1
    }
    out.push({
      name: sem.name || sem.code,
      present: new Set(members.filter((m) => m.semester_id === sem.id && isEligible(m.status)).map((m) => m.staff_id)),
      audited: new Set(rows.filter((a) => a.round_no === 1).map((a) => a.auditee_staff)),
      auditorCounts,
    })
  }
  return out
}

/** Per lecturer id: waiting (semesters since last audit), times audited, auditor stats. pool items need id, staff_id, start_date. */
export function standing(pool, history, today = new Date()) {
  const H = history.length
  const unknownPresence = history.some((h) => h.present == null)
  const out = {}
  for (const p of pool) {
    const sid = p.staff_id
    const auditedAt = history.flatMap((h, i) => (h.audited.has(sid) ? [i] : []))
    let waiting
    if (auditedAt.length) waiting = H - 1 - auditedAt[auditedAt.length - 1]
    else {
      waiting = history.filter((h) => h.present == null || h.present.has(sid)).length
      // cannot tell when they joined: assume about 2 semesters a year
      if (unknownPresence) waiting = Math.min(waiting, 2 * yearsOfService(p.start_date, today))
    }
    const servedAt = history.flatMap((h, i) => ((h.auditorCounts[sid] ?? 0) > 0 ? [i] : []))
    out[p.id] = {
      waiting, times: auditedAt.length,
      last: auditedAt.length ? history[auditedAt[auditedAt.length - 1]].name : null,
      auditorWaiting: servedAt.length ? H - 1 - servedAt[servedAt.length - 1] : H,
      auditorTotal: history.reduce((n, h) => n + (h.auditorCounts[sid] ?? 0), 0),
    }
  }
  return out
}

/** Plain-language explanation of why someone ranks where they do. */
export function reason(st) {
  if (st.last == null) {
    return st.waiting === 0 ? 'Never audited (no waiting time recorded yet: random draw)'
      : `Never audited (in the pool ${st.waiting} semester(s))`
  }
  return `Last audited ${st.last} (${st.waiting} semester(s) ago)`
}

// sort by a list of keys (each ascending); the random key is computed once per element so the draw is reproducible
const sortBy = (items, keyFn) => items.map((x) => ({ x, k: keyFn(x) }))
  .sort((a, b) => { for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i] < b.k[i] ? -1 : 1; return 0 })
  .map((e) => e.x)

/**
 * Fill every department's quota with the longest-waiting lecturers.
 * byDepartment: { dept: [lecturer, ...] }. exclude: ids not audited this semester (still counted in the department total).
 * force: ids that must be audited (they count towards the quota). Returns { chosen, short: [{dept, needed, got}] }.
 */
export function selectAuditees(byDepartment, percent, st, rng, exclude = new Set(), force = new Set()) {
  const chosen = [], short = []
  for (const dept of Object.keys(byDepartment).sort()) {
    const everyone = byDepartment[dept]
    const need = requiredCount(everyone.length, percent)
    const candidates = everyone.filter((m) => !exclude.has(m.id))
    const forced = candidates.filter((m) => force.has(m.id))
    const rest = sortBy(candidates.filter((m) => !force.has(m.id)),
      (m) => [-st[m.id].waiting, st[m.id].times, rng.random()])
    const picks = [...forced, ...rest.slice(0, Math.max(0, need - forced.length))]
    if (picks.length < need) short.push({ dept, needed: need, got: picks.length })
    chosen.push(...picks)
  }
  return { chosen, short }
}

/**
 * Pair auditees with auditors under the grade / seniority rule, rotating the burden.
 * Eligibility: outrank, else same-seniority peer; null = the Head picks. Returns { auditeeId: auditorId | null }.
 */
export function assignAuditors(auditees, pool, st, rng, today = new Date()) {
  const beingAudited = new Set(auditees.map((a) => a.id))
  const options = {}
  for (const a of auditees) {
    const strict = pool.filter((p) => canAudit(p, a, today))
    options[a.id] = strict.length ? strict : pool.filter((p) => isPeer(p, a, today))
  }
  const load = {}
  const result = {}
  for (const a of sortBy(auditees, (x) => [options[x.id].length, rng.random()])) {
    const cands = options[a.id]
    if (!cands.length) { result[a.id] = null; continue }
    const pick = sortBy(cands, (c) => [load[c.id] ?? 0, beingAudited.has(c.id) ? 1 : 0,
      -st[c.id].auditorWaiting, st[c.id].auditorTotal, rng.random()])[0]
    load[pick.id] = (load[pick.id] ?? 0) + 1
    result[a.id] = pick.id
  }
  return result
}

/** One auditor for a single auditee (re-audits): same rule, skipping excludeIds, favouring the lightest workload. */
export function pickAuditor(auditee, pool, excludeIds, load, rng, today = new Date()) {
  const ok = pool.filter((p) => !excludeIds.has(p.id))
  let cands = ok.filter((p) => canAudit(p, auditee, today))
  if (!cands.length) cands = ok.filter((p) => isPeer(p, auditee, today))
  if (!cands.length) return null
  const best = Math.min(...cands.map((c) => load[c.id] ?? 0))
  return rng.choice(cands.filter((c) => (load[c.id] ?? 0) === best)).id
}
