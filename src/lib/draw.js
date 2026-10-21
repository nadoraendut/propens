// One draw: select auditees (quota per department, longest-waiting first) and auditors, and explain it.
import { isEligible, requiredCount, yearsOfService, canAudit } from './logic.js'
import { makeRng } from './rng.js'
import { standing, selectAuditees, assignAuditors, reason } from './rotation.js'

/**
 * pool: lecturers of the semester [{ id, staff_id, name, grade, bidang, campus, start_date, status }]
 * history: see rotation.js. settings: { percent, seed, exclude: Set<id>, force: Set<id> }
 */
export function runDraw(lecturers, history, settings, today = new Date()) {
  const pool = lecturers.filter((l) => isEligible(l.status))
  if (!pool.length) throw new Error("No lecturer with Status 'Active' in this semester's list.")
  const { percent, seed } = settings
  const exclude = new Set([...(settings.exclude ?? [])].filter((id) => pool.some((p) => p.id === id)))
  const force = new Set([...(settings.force ?? [])].filter((id) => pool.some((p) => p.id === id)))
  for (const id of exclude) if (force.has(id)) throw new Error('A lecturer cannot be both excluded and forced.')

  const rng = makeRng(seed)
  const byDepartment = {}
  for (const p of pool) (byDepartment[p.bidang] ??= []).push(p)
  const st = standing(pool, history, today)
  const { chosen, short } = selectAuditees(byDepartment, percent, st, rng, exclude, force)
  const pairing = assignAuditors(chosen, pool, st, rng, today)
  const byId = Object.fromEntries(pool.map((p) => [p.id, p]))

  const rows = chosen.map((a) => {
    const er = byId[pairing[a.id]] ?? null
    return {
      auditee_id: a.id, auditor_id: er?.id ?? null, waiting: st[a.id].waiting, reason: reason(st[a.id]),
      forced: force.has(a.id), rule: !er ? 'none' : canAudit(er, a, today) ? 'ok' : 'peer',
    }
  })

  const departments = Object.keys(byDepartment).sort().map((dept) => {
    const total = byDepartment[dept].length
    const need = requiredCount(total, percent)
    const selected = chosen.filter((c) => c.bidang === dept).length
    return { dept, total, required: need, selected, ok: selected >= need, cycle: need ? Math.ceil(total / need) : null }
  })

  const prev = history[history.length - 1]
  const repeats = chosen.filter((a) => prev && prev.audited.has(a.staff_id))
  const waits = rows.map((r) => r.waiting)
  const poolWaits = pool.map((p) => st[p.id].waiting)
  const avg = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null)
  const chosenIds = new Set(chosen.map((c) => c.id))
  return {
    rows, departments, short, seed, percent,
    unmatched: rows.filter((r) => r.rule === 'none').length,
    peers: rows.filter((r) => r.rule === 'peer').length,
    fairness: {
      historySemesters: history.length, previous: prev?.name ?? null,
      avgWaitSelected: avg(waits), avgWaitPool: avg(poolWaits),
      repeats: repeats.map((a) => ({ staff_id: a.staff_id, name: a.name, bidang: a.bidang })),
      neverAuditedRemaining: history.length ? pool.filter((p) => st[p.id].times === 0 && !chosenIds.has(p.id)).length : null,
      pool: pool.length,
    },
    years: Object.fromEntries(pool.map((p) => [p.id, yearsOfService(p.start_date, today)])),
  }
}
