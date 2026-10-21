// Semester report and the Excel workbook. Pure functions: the screens and the tests use the same code.
// A lecturer's FINAL mark is that of their latest audit (a re-audit replaces the first mark).
import { compute, indicator, INDICATORS, SECTIONS, CEMERLANG_MIN, FACILITY_ITEMS } from './rubric.js'
import { isEligible, requiredCount, ruleStatus, yearsOfService } from './logic.js'

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null)
export const isActive = (a) => a.round_no === 1 || a.reaudit_state === 'approved'

/** latest audit per auditee */
export function finalAudits(audits) {
  const best = new Map()
  for (const a of audits) if (!best.has(a.auditee_id) || a.round_no > best.get(a.auditee_id).round_no) best.set(a.auditee_id, a)
  return [...best.values()]
}

export const bandLabel = ([floor, label]) => `${label.split(' / ')[0]} (${floor === 0 ? '<60' : `${floor}-${floor === 90 ? 100 : floor + 9}`})`
export const BANDS = INDICATORS.map((b) => [bandLabel(b), b[0]])

/**
 * sem: semester row. audits: all audits with embedded auditee / auditor profiles. pool: eligible profiles of the semester.
 * scores: { [auditId]: { [item]: score } } for completed audits (needed for the section averages).
 */
export function buildReport(sem, audits, pool, scores = {}, today = new Date()) {
  const finals = finalAudits(audits)
  const done = finals.filter((a) => a.completed_at && a.marks != null)
  const marks = done.map((a) => Number(a.marks))
  const quota = departmentQuota(sem, audits, pool)
  for (const q of quota) {
    const mine = done.filter((a) => a.auditee.bidang === q.dept)
    q.completed = finals.filter((a) => a.completed_at && a.auditee.bidang === q.dept).length
    q.average = avg(mine.map((a) => Number(a.marks)))
  }
  const campusMarks = {}
  for (const a of done) (campusMarks[a.auditee.campus || '-'] ??= []).push(Number(a.marks))
  const load = {}
  for (const a of audits.filter((x) => x.auditor && isActive(x))) {
    const w = (load[a.auditor_id] ??= { staff_id: a.auditor.staff_id, name: a.auditor.full_name, assigned: 0, completed: 0 })
    w.assigned++; if (a.completed_at) w.completed++
  }
  const bands = Object.fromEntries(BANDS.map(([label]) => [label, 0]))
  for (const m of marks) bands[BANDS.find(([, floor]) => m >= floor)[0]]++

  const sectionTotals = Object.fromEntries(SECTIONS.map((s) => [s.key, []]))
  for (const a of done) {
    const c = compute(scores[a.id] ?? {})
    for (const s of SECTIONS) sectionTotals[s.key].push(c.sections[s.key])
  }
  const sections = SECTIONS.map((s) => {
    const average = avg(sectionTotals[s.key])
    return { key: s.key, title: s.title.split(':')[1].trim(), max: s.max, average, percent: average == null ? null : Math.round((1000 * average) / s.max) / 10 }
  })
  const statuses = audits.map((a) => ruleStatus(a.auditor, a.auditee, pool, today))
  const reaudits = audits.filter((a) => a.round_no === 2)
  return {
    eligible: pool.length, audits: finals.length, completed: finals.filter((a) => a.completed_at).length,
    scheduled: finals.filter((a) => a.session_date && !a.completed_at).length,
    notScheduled: finals.filter((a) => !a.session_date && !a.completed_at).length,
    average: avg(marks), highest: marks.length ? Math.max(...marks) : null, lowest: marks.length ? Math.min(...marks) : null,
    threshold: Number(sem.reaudit_below),
    reaudits: reaudits.length, reauditsDone: reaudits.filter((a) => a.completed_at).length,
    stillBelow: done.filter((a) => Number(a.marks) < Number(sem.reaudit_below)).length,
    quota, bands, sections,
    campus: Object.entries(campusMarks).sort().map(([campus, v]) => ({ campus, count: v.length, average: avg(v) })),
    workload: Object.values(load).sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name)),
    cemerlang: done.filter((a) => Number(a.marks) >= CEMERLANG_MIN).sort((a, b) => b.marks - a.marks).map((a) => ({
      staff_id: a.auditee.staff_id, name: a.auditee.full_name, bidang: a.auditee.bidang, campus: a.auditee.campus, marks: Number(a.marks) })),
    ruleOverrides: statuses.filter((s) => s === 'override').length, peerPairs: statuses.filter((s) => s === 'peer').length,
  }
}

/** per Bidang: active lecturers, required (min %), selected (round-1 audits) */
export function departmentQuota(sem, audits, pool) {
  const by = {}
  for (const p of pool) if (isEligible(p.status)) (by[p.bidang] ??= []).push(p)
  return Object.keys(by).sort().map((dept) => {
    const required = requiredCount(by[dept].length, Number(sem.min_percent))
    const selected = audits.filter((a) => a.round_no === 1 && a.auditee.bidang === dept).length
    return { dept, total: by[dept].length, required, selected, ok: selected >= required }
  })
}

const statusOf = (a) => (a.completed_at ? 'Completed' : a.round_no === 2 && a.reaudit_state !== 'approved' ? 'Re-audit awaiting approval'
  : a.session_date ? 'Scheduled' : 'Not scheduled')

/**
 * Sheets for the Excel download. Free-text comments are deliberately left out.
 * facility: { [auditId]: { [item]: score } }; corrections: [{ audit, ...row }]
 */
export function exportSheets(sem, audits, report, scores = {}, facility = {}, corrections = []) {
  const finalIds = new Set(finalAudits(audits).map((a) => a.id))
  const keys = SECTIONS.map((s) => s.key)
  const main = [['Semester', 'Staff ID', 'Staff Name', 'Gred Jawatan', 'Bidang', 'Campus', 'Auditor Staff ID', 'Auditor Name', 'Session Date', 'Session Time', 'Venue',
    'Course Code', 'Programme', 'Group', 'No. Students', 'Round', 'Counts as final mark', ...SECTIONS.map((s) => `${s.key} (/${s.max})`),
    'Raw Total (/145)', 'Total Score TS (/50)', 'Marks TAS (/100)', 'Indicator', 'Status']]
  for (const a of audits) {
    const c = compute(scores[a.id] ?? {})
    const done = Boolean(a.completed_at)
    main.push([sem.code, a.auditee.staff_id, a.auditee.full_name, a.auditee.grade, a.auditee.bidang, a.auditee.campus,
      a.auditor?.staff_id, a.auditor?.full_name, a.session_date, a.session_time, a.venue, a.course_code, a.program, a.group_no, a.student_count,
      a.round_no, finalIds.has(a.id) ? 'Yes' : 'No (replaced by re-audit)',
      ...keys.map((k) => (done ? c.sections[k] : null)), done ? c.raw : null, done ? c.ts : null, done ? Number(a.marks) : null,
      done ? indicator(Number(a.marks)) : '', statusOf(a)])
  }
  const fac = [['Staff ID', 'Staff Name', 'Room', ...FACILITY_ITEMS.map((_, i) => String(i + 1)), 'Suggestions']]
  for (const a of audits.filter((x) => x.completed_at)) {
    fac.push([a.auditee.staff_id, a.auditee.full_name, a.facility_room, ...FACILITY_ITEMS.map((_, i) => facility[a.id]?.[i + 1] ?? null), a.facility_suggestion])
  }
  return [
    { name: 'Audit Marks', rows: main },
    { name: 'Facilities', rows: fac },
    { name: 'Summary by Department', rows: [['Bidang', 'Eligible lecturers', `Required (min ${Number(sem.min_percent)}%)`, 'Selected', 'Completed', 'Average marks'],
      ...report.quota.map((q) => [q.dept, q.total, q.required, q.selected, q.completed, q.average])] },
    { name: 'Summary by Campus', rows: [['Campus', 'Audits completed', 'Average marks'], ...report.campus.map((c) => [c.campus, c.count, c.average])] },
    { name: 'Auditor Workload', rows: [['Staff ID', 'Auditor', 'Assigned', 'Completed'], ...report.workload.map((w) => [w.staff_id, w.name, w.assigned, w.completed])] },
    { name: 'Cemerlang', rows: [['Staff ID', 'Staff Name', 'Bidang', 'Campus', 'Marks TAS (/100)', 'Indicator'],
      ...report.cemerlang.map((c) => [c.staff_id, c.name, c.bidang, c.campus, c.marks, indicator(c.marks)])] },
    { name: 'Corrections', rows: [['Staff ID', 'Staff Name', 'Round', 'Corrected on', 'Corrected by', 'Old marks', 'New marks', 'Reason', 'Changes'],
      ...corrections.map((c) => [c.audit.auditee.staff_id, c.audit.auditee.full_name, c.audit.round_no, c.created_at, c.by_name, c.old_marks == null ? null : Number(c.old_marks), Number(c.new_marks), c.reason, c.changes])] },
    { name: 'Section Averages', rows: [['Section', 'Max', 'Average', 'Average %'], ...report.sections.map((s) => [`${s.key}: ${s.title}`, s.max, s.average, s.percent])] },
    { name: 'Mark Bands', rows: [['Band', 'Lecturers'], ...Object.entries(report.bands)] },
  ]
}
export { yearsOfService }
