import { describe, it, expect } from 'vitest'
import { parseDate, yearsOfService, gradeRank, canAudit, isPeer, requiredCount, ruleStatus, isEligible } from '../src/lib/logic.js'
import { compute, indicator, isCemerlang, SECTIONS, ITEM_NUMBERS, FACILITY_ITEMS, MAX_RAW } from '../src/lib/rubric.js'
import { parseSemester, byNewest, normalizeCode } from '../src/lib/semester.js'
import { makeRng } from '../src/lib/rng.js'
import { standing, selectAuditees, assignAuditors, pickAuditor, buildHistory, reason } from '../src/lib/rotation.js'
import { runDraw } from '../src/lib/draw.js'
import { normalizeUrl, describeAuthError } from '../src/lib/env.js'

const TODAY = new Date(2026, 9, 16) // 16 Oct 2026
const L = (i, o = {}) => ({ id: `S${i}`, staff_id: `S${i}`, name: `L${i}`, grade: 'DS45', start_date: '2010-01-01', bidang: 'CS', status: 'Active', campus: 'N', ...o })

describe('logic', () => {
  it('years of service use the current year', () => {
    expect(yearsOfService('2012-03-01', TODAY)).toBe(14)
    expect(yearsOfService(new Date(2026, 0, 1), TODAY)).toBe(0)
  })
  it('parses the date formats staff files contain', () => {
    expect(parseDate('2012')).toEqual(new Date(2012, 0, 1))
    expect(parseDate('01/03/2012')).toEqual(new Date(2012, 2, 1))
    expect(parseDate(new Date(2012, 2, 1, 13, 0))).toEqual(new Date(2012, 2, 1))
    expect(parseDate('')).toBeNull()
    expect(() => parseDate('notadate')).toThrow()
    expect(() => parseDate('31/02/2012')).toThrow()
  })
  it('ranks grades by their number', () => {
    expect(gradeRank('DS52')).toBeGreaterThan(gradeRank('DS45'))
    expect(gradeRank('VK7')).toBe(7)
    expect(gradeRank('')).toBe(0)
  })
  it('auditor must outrank or be more senior, never the same person', () => {
    const ee = L(1, { grade: 'DS45', start_date: '2016-01-01' })
    expect(canAudit(L(2, { grade: 'DS52', start_date: '2024-01-01' }), ee, TODAY)).toBe(true) // higher grade, junior
    expect(canAudit(L(3, { grade: 'DS45', start_date: '2005-01-01' }), ee, TODAY)).toBe(true) // same grade, more senior
    expect(canAudit(L(4, { grade: 'DS45', start_date: '2016-01-01' }), ee, TODAY)).toBe(false)
    expect(canAudit(L(5, { grade: 'DS41', start_date: '2024-01-01' }), ee, TODAY)).toBe(false)
    expect(canAudit(ee, ee, TODAY)).toBe(false)
  })
  it('same-seniority peers are a fallback only for people nobody outranks', () => {
    const top = L(1, { grade: 'DS54', start_date: '2000-01-01' })
    const peer = L(2, { grade: 'DS52', start_date: '2000-06-01' })
    const junior = L(3, { grade: 'DS45', start_date: '2015-01-01' })
    expect(isPeer(peer, top, TODAY)).toBe(true)
    expect(ruleStatus(peer, top, [top, peer, junior], TODAY)).toBe('peer')
    expect(ruleStatus(top, junior, [top, peer, junior], TODAY)).toBe('ok')
    expect(ruleStatus(peer, junior, [top, peer, junior], TODAY)).toBe('ok')
    expect(ruleStatus(junior, top, [top, peer, junior], TODAY)).toBe('override')
    expect(ruleStatus(null, top, [top], TODAY)).toBe('none')
  })
  it('quota rounds up per department and is never zero for a non-empty one', () => {
    expect(requiredCount(10, 20)).toBe(2)
    expect(requiredCount(11, 20)).toBe(3)
    expect(requiredCount(1, 5)).toBe(1)
    expect(requiredCount(0, 20)).toBe(0)
    expect(requiredCount(3, 100)).toBe(3)
    expect(requiredCount(5, 20)).toBe(1) // 5*20/100 = 1.0000000000000002 in floating point must not become 2
  })
  it('only Active lecturers are eligible', () => {
    expect(isEligible('Active')).toBe(true)
    expect(isEligible(' active ')).toBe(true)
    expect(isEligible('Study Leave')).toBe(false)
  })
})

describe('rubric', () => {
  it('matches the printed form', () => {
    expect(SECTIONS.map((s) => s.max)).toEqual([25, 35, 25, 30, 30])
    expect(ITEM_NUMBERS).toEqual(Array.from({ length: 29 }, (_, i) => i + 1))
    expect(SECTIONS.every((s) => s.items.every((i) => i.levels.length === 5))).toBe(true)
    expect(FACILITY_ITEMS).toHaveLength(14)
    expect(MAX_RAW).toBe(145)
  })
  it('TS = raw x 50/145 and TAS = TS x 2', () => {
    const all = (v) => Object.fromEntries(ITEM_NUMBERS.map((n) => [n, v]))
    expect(compute(all(5))).toMatchObject({ raw: 145, ts: 50, tas: 100, complete: true })
    expect(compute(all(1))).toMatchObject({ raw: 29, tas: 20 })
    expect(compute(all(4))).toMatchObject({ raw: 116, ts: 40, tas: 80 }) // all "Baik" is exactly 80
    expect(compute({ 1: 5 }).complete).toBe(false)
  })
  it('indicator bands (Cemerlang from 90)', () => {
    const cases = { 59.99: 'Sangat Lemah', 60: 'Lemah', 69.9: 'Lemah', 70: 'Memuaskan', 79.99: 'Memuaskan', 80: 'Baik', 89.99: 'Baik', 90: 'Cemerlang', 100: 'Cemerlang' }
    for (const [tas, label] of Object.entries(cases)) expect(indicator(Number(tas))).toMatch(new RegExp(`^${label}`))
    expect(isCemerlang(90)).toBe(true)
    expect(isCemerlang(89.99)).toBe(false)
  })
})

describe('semester codes (same as Jengah)', () => {
  it('reads year + intake', () => {
    expect(parseSemester('20262')).toMatchObject({ year: 2026, intake: 2, label: 'March 2026' })
    expect(parseSemester('2026')).toBeNull()
    expect(normalizeCode(' 2026 2 ')).toBe('20262')
    expect([{ code: '20262' }, { code: '20264' }].sort(byNewest)[0].code).toBe('20264')
  })
})

// ---------------------------------------------------------------- rotation
function simulate(n, pool, percent, seed = 1, startHistory = []) {
  const history = [...startHistory], picked = []
  for (let s = 0; s < n; s++) {
    const by = {}
    for (const p of pool) (by[p.bidang] ??= []).push(p)
    const st = standing(pool, history, TODAY)
    const { chosen } = selectAuditees(by, percent, st, makeRng(seed + s))
    const ids = new Set(chosen.map((c) => c.id))
    picked.push(ids)
    history.push({ name: `Sem${history.length + 1}`, present: new Set(pool.map((p) => p.staff_id)), audited: new Set(chosen.map((c) => c.staff_id)), auditorCounts: {} })
  }
  return picked
}
const union = (sets) => new Set(sets.flatMap((s) => [...s]))
const overlaps = (sets) => sets.some((a, i) => sets.slice(i + 1).some((b) => [...a].some((x) => b.has(x))))

describe('rotation (giliran)', () => {
  it('nobody is repeated until everyone has had a turn', () => {
    const pool = Array.from({ length: 12 }, (_, i) => L(i)) // quota 25% -> 3 per semester -> a 4-semester cycle
    const picks = simulate(8, pool, 25)
    expect(picks.every((p) => p.size === 3)).toBe(true)
    expect(overlaps(picks.slice(0, 4))).toBe(false)
    expect(union(picks.slice(0, 4)).size).toBe(12)
    expect(union(picks.slice(4)).size).toBe(12)
  })
  it('never the same people two semesters in a row when avoidable', () => {
    const pool = [...Array.from({ length: 10 }, (_, i) => L(i)), ...Array.from({ length: 6 }, (_, i) => L(100 + i, { bidang: 'Math' }))]
    const picks = simulate(12, pool, 20)
    picks.slice(1).forEach((b, i) => expect([...b].some((x) => picks[i].has(x))).toBe(false))
  })
  it('still meets the quota of every department each semester', () => {
    const pool = [...Array.from({ length: 10 }, (_, i) => L(i)), ...Array.from({ length: 7 }, (_, i) => L(100 + i, { bidang: 'Math' })), L(200, { bidang: 'Tiny' })]
    for (const p of simulate(6, pool, 20)) {
      expect([...p].filter((i) => +i.slice(1) < 100)).toHaveLength(2)
      expect([...p].filter((i) => +i.slice(1) >= 100 && +i.slice(1) < 200)).toHaveLength(2) // ceil(1.4)
      expect(p.has('S200')).toBe(true) // lone lecturer: forced every semester
    }
  })
  it('a new joiner is not rushed to the front', () => {
    const vets = Array.from({ length: 6 }, (_, i) => L(i))
    const history = [0, 1, 2].map((k) => ({ name: `Sem${k}`, present: new Set(vets.map((p) => p.staff_id)), audited: new Set([`S${k}`]), auditorCounts: {} }))
    const pool = [...vets, L(99)]
    const st = standing(pool, history, TODAY)
    expect([st.S99.waiting, st.S3.waiting, st.S0.waiting]).toEqual([0, 3, 2])
    const { chosen } = selectAuditees({ CS: pool }, 30, st, makeRng(3))
    expect(chosen.map((c) => c.id).sort()).toEqual(['S3', 'S4', 'S5'])
  })
  it('history without presence info caps waiting by years of service', () => {
    const history = Array.from({ length: 10 }, (_, k) => ({ name: `Sem${k}`, present: null, audited: new Set(), auditorCounts: {} }))
    const st = standing([L(1, { start_date: '2000-01-01' }), L(2, { start_date: '2025-06-01' })], history, TODAY)
    expect([st.S1.waiting, st.S2.waiting]).toEqual([10, 2])
  })
  it('exclude, force and shortfalls', () => {
    const pool = Array.from({ length: 5 }, (_, i) => L(i))
    const st = standing(pool, [], TODAY)
    let r = selectAuditees({ CS: pool }, 40, st, makeRng(1), new Set(['S0']), new Set(['S4']))
    const ids = r.chosen.map((c) => c.id)
    expect(ids).toContain('S4'); expect(ids).not.toContain('S0'); expect(ids).toHaveLength(2); expect(r.short).toEqual([])
    r = selectAuditees({ CS: pool }, 100, st, makeRng(1), new Set(['S0', 'S1', 'S2', 'S3']))
    expect(r.short).toEqual([{ dept: 'CS', needed: 5, got: 1 }])
  })
  it('the same seed gives the same draw', () => {
    const pool = Array.from({ length: 20 }, (_, i) => L(i))
    const a = simulate(1, pool, 25, 77)[0], b = simulate(1, pool, 25, 77)[0], c = simulate(1, pool, 25, 78)[0]
    expect([...a].sort()).toEqual([...b].sort())
    expect([...a].sort()).not.toEqual([...c].sort())
  })
  it('auditor load is spread evenly and rotates towards people who served least', () => {
    const pool = [L(1, { grade: 'DS54', start_date: '1990-01-01' }), L(2, { grade: 'DS52', start_date: '1995-01-01' }), L(3, { grade: 'DS50', start_date: '1998-01-01' }),
      ...Array.from({ length: 6 }, (_, i) => L(10 + i, { start_date: '2015-01-01' }))]
    const history = [{ name: 'Prev', present: null, audited: new Set(), auditorCounts: { S1: 5, S2: 0, S3: 0 } }]
    const st = standing(pool, history, TODAY)
    const out = assignAuditors(pool.slice(3), pool, st, makeRng(5), TODAY)
    const counts = {}
    for (const v of Object.values(out)) counts[v] = (counts[v] ?? 0) + 1
    expect(counts).toEqual({ S1: 2, S2: 2, S3: 2 })
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]))
    for (const [ee, er] of Object.entries(out)) expect(canAudit(byId[er], byId[ee], TODAY)).toBe(true)
  })
  it('prefers someone not being audited when workloads are equal, but even spread comes first', () => {
    const pool = [L(0, { grade: 'DS56', start_date: '1985-01-01' }), L(1, { grade: 'DS54', start_date: '1990-01-01' }),
      L(2, { grade: 'DS54', start_date: '1990-01-01' }), L(3, { grade: 'DS45', start_date: '2015-01-01' })]
    const history = [{ name: 'Prev', present: null, audited: new Set(), auditorCounts: { S1: 3, S2: 3 } }]
    let out = assignAuditors([pool[1], pool[3]], pool, standing(pool, history, TODAY), makeRng(1), TODAY)
    expect(out).toEqual({ S1: 'S0', S3: 'S2' })
    const trio = pool.slice(1)
    out = assignAuditors([trio[0], trio[2]], trio, standing(trio, [], TODAY), makeRng(1), TODAY)
    expect(out).toEqual({ S1: 'S2', S3: 'S1' }) // nobody audits twice even though S1 is also an auditee
  })
  it('the most senior person gets a same-seniority peer, otherwise the Head picks', () => {
    const pool = [L(1, { grade: 'DS54', start_date: '2000-01-01' }), L(2, { grade: 'DS45', start_date: '2015-01-01' }), L(3, { grade: 'DS52', start_date: '2000-01-01' })]
    expect(assignAuditors([pool[0]], pool, standing(pool, [], TODAY), makeRng(1), TODAY)).toEqual({ S1: 'S3' })
    expect(assignAuditors([pool[0]], pool.slice(0, 2), standing(pool.slice(0, 2), [], TODAY), makeRng(1), TODAY)).toEqual({ S1: null })
  })
  it('re-audit auditor: never an excluded person, favours the lightest load', () => {
    const pool = [L(1, { grade: 'DS54' }), L(2, { grade: 'DS54' }), L(3, { grade: 'DS52' }), L(9, { grade: 'DS45', start_date: '2015-01-01' })]
    const id = pickAuditor(pool[3], pool, new Set(['S9', 'S1']), { S2: 2, S3: 0 }, makeRng(1), TODAY)
    expect(id).toBe('S3')
    expect(pickAuditor(pool[3], pool, new Set(['S9', 'S1', 'S2', 'S3']), {}, makeRng(1), TODAY)).toBeNull()
  })
  it('builds history from database rows and skips semesters with no list', () => {
    const semesters = [{ id: 'a', code: '20254', name: 'S1' }, { id: 'b', code: '20262', name: 'S2' }, { id: 'c', code: '20264', name: 'S3' }]
    const members = [{ semester_id: 'a', staff_id: 'X', status: 'Active' }, { semester_id: 'a', staff_id: 'Y', status: 'Study Leave' }]
    const audits = [
      { semester_id: 'a', auditee_staff: 'X', auditor_staff: 'Z', round_no: 1 },
      { semester_id: 'a', auditee_staff: 'X', auditor_staff: 'W', round_no: 2, reaudit_state: 'proposed' }, // not active: not counted
      { semester_id: 'a', auditee_staff: 'Q', auditor_staff: 'Z', round_no: 1 },
    ]
    const h = buildHistory({ semesters, members, audits }, '20264')
    expect(h).toHaveLength(1) // S2 has no audits; S3 is the semester being drawn
    expect(h[0].name).toBe('S1')
    expect([...h[0].present]).toEqual(['X']) // not Active -> not present
    expect([...h[0].audited].sort()).toEqual(['Q', 'X'])
    expect(h[0].auditorCounts).toEqual({ Z: 2 })
  })
  it('explains the ranking in words', () => {
    expect(reason({ last: null, waiting: 0 })).toMatch(/random draw/)
    expect(reason({ last: null, waiting: 3 })).toMatch(/3 semester/)
    expect(reason({ last: 'S1', waiting: 2 })).toBe('Last audited S1 (2 semester(s) ago)')
  })
})

describe('runDraw', () => {
  const pool = [...Array.from({ length: 10 }, (_, i) => L(i, { grade: `DS${41 + (i % 4) * 3}`, start_date: `${2000 + i}-01-01` })),
    ...Array.from({ length: 5 }, (_, i) => L(20 + i, { bidang: 'Math', grade: `DS${41 + (i % 4) * 3}`, start_date: `${2003 + i}-01-01` })), L(900, { status: 'Study Leave' })]
  it('meets quotas, gives everyone an auditor who qualifies, and ignores inactive staff', () => {
    const r = runDraw(pool, [], { percent: 20, seed: 42, exclude: new Set(), force: new Set() }, TODAY)
    expect(r.departments.map((d) => [d.dept, d.required, d.selected, d.ok])).toEqual([['CS', 2, 2, true], ['Math', 1, 1, true]])
    expect(r.rows).toHaveLength(3)
    const byId = Object.fromEntries(pool.map((p) => [p.id, p]))
    for (const row of r.rows) {
      expect(row.auditor_id).not.toBeNull(); expect(row.auditor_id).not.toBe(row.auditee_id)
      expect(row.auditor_id).not.toBe('S900'); expect(row.auditee_id).not.toBe('S900')
      expect(['ok', 'peer']).toContain(row.rule)
      expect(canAudit(byId[row.auditor_id], byId[row.auditee_id], TODAY) || row.rule === 'peer').toBe(true)
    }
    expect(r.fairness.pool).toBe(15)
  })
  it('rejects contradictory settings and empty pools', () => {
    expect(() => runDraw(pool, [], { percent: 20, seed: 1, exclude: new Set(['S1']), force: new Set(['S1']) }, TODAY)).toThrow(/both excluded and forced/)
    expect(() => runDraw([L(1, { status: 'Retired' })], [], { percent: 20, seed: 1 }, TODAY)).toThrow(/Active/)
  })
})

describe('env helpers (as in Jengah)', () => {
  it('cleans a pasted project URL and explains sign-in failures', () => {
    expect(normalizeUrl(' "abc.supabase.co/rest/v1/" ')).toBe('https://abc.supabase.co')
    expect(describeAuthError({ code: 'invalid_credentials' }, 'h')).toMatch(/Invalid Staff ID/)
  })
})

// ---------------------------------------------------------------- lecturer files and Excel
import { parseLecturerRows, isValidStaffId } from '../src/lib/lecturers.js'
import { sheetsToBlob, parseCsv } from '../src/lib/xlsx.js'
import { readSheet } from 'read-excel-file/universal'

describe('lecturer list parsing', () => {
  const H = ['Staff ID', 'Staff Name', 'Gred Jawatan', 'Bidang', 'Start of Employment', 'Campus', 'Status', 'Email']
  it('accepts good rows and reports bad ones with their row number', () => {
    const rows = [H,
      ['A100123', 'Dr Ali', 'DS52', 'CS', new Date(2012, 2, 1), 'N', 'Active', 'ali@u.edu'],
      [100124, 'Dr Siti', 'DS45', 'Math', '2015-06-01', '', '', ''],           // numeric Staff ID, blank status -> Active
      ['A1', 'Short', 'DS45', 'CS', '2015-06-01', '', '', ''],                  // Staff ID too short to be a password
      ['A100125', 'Bad Date', 'DS45', 'CS', 'notadate', '', '', ''],
      ['A100123', 'Duplicate', 'DS45', 'CS', '2015-06-01', '', '', ''],
      ['A100126', 'Future', 'DS45', 'CS', '2999-01-01', '', '', ''],
      ['A100127', 'No grade', '', 'CS', '2015-06-01', '', '', ''],
      ['A100128', 'Bad mail', 'DS45', 'CS', '2015-06-01', '', '', 'not-an-email'],
    ]
    const { good, errors } = parseLecturerRows(rows, TODAY)
    expect(good.map((g) => g.staff_id)).toEqual(['A100123', '100124'])
    expect(good[0]).toMatchObject({ start_date: '2012-03-01', status: 'Active' })
    expect(good[1].status).toBe('Active')
    expect(errors).toHaveLength(6)
    expect(errors[0]).toMatch(/^Row 4: Staff ID must be 6-20/)
    expect(errors[1]).toMatch(/^Row 5:.*Unrecognised date/)
    expect(errors[2]).toMatch(/duplicate/); expect(errors[3]).toMatch(/future/)
    expect(errors[4]).toMatch(/Gred Jawatan is empty/); expect(errors[5]).toMatch(/Email/)
  })
  it('finds the header below a title row, tolerates aliases and extra columns', () => {
    const rows = [['Faculty of X'], ['No', 'Nama', 'No Pekerja', 'Gred', 'Bidang', 'Tarikh Lantikan'], [1, 'Ali', 'B200200', 'DS41', 'CS', '01/02/2010']]
    expect(parseLecturerRows(rows, TODAY).good[0]).toMatchObject({ staff_id: 'B200200', name: 'Ali', start_date: '2010-02-01' })
  })
  it('explains missing columns', () => {
    expect(() => parseLecturerRows([['Staff ID', 'Name']])).toThrow(/Missing column\(s\): Gred Jawatan, Bidang, Start of Employment/)
    expect(() => parseLecturerRows([['Foo']])).toThrow(/Staff ID/)
  })
  it('staff id doubles as the first password', () => {
    expect(isValidStaffId('A100123')).toBe(true); expect(isValidStaffId('12345')).toBe(false); expect(isValidStaffId('has space1')).toBe(false)
  })
  it('reads CSV with quotes', () => {
    expect(parseCsv('a,b\n"x, y",2\r\n"he said ""hi""",3\n')).toEqual([['a', 'b'], ['x, y', '2'], ['he said "hi"', '3']])
  })
})

describe('Excel writing', () => {
  it('writes sheets that read back with the same values', async () => {
    const blob = await sheetsToBlob([{ name: 'Audit List', rows: [['Name', 'Marks', 'Note'], ['Ali', 82.5, null], ['Siti', 100, 'Cemerlang']] }])
    const rows = await readSheet(blob)
    expect(rows[0]).toEqual(['Name', 'Marks', 'Note'])
    expect(rows[1].slice(0, 2)).toEqual(['Ali', 82.5])
    expect(rows[2]).toEqual(['Siti', 100, 'Cemerlang'])
  })
})

// ---------------------------------------------------------------- report and export
import { finalAudits, buildReport, exportSheets, BANDS } from '../src/lib/report.js'
import { fetchAll } from '../src/lib/data.js'

describe('report', () => {
  const P = (i, o = {}) => ({ id: `p${i}`, staff_id: `S${i}`, full_name: `Lect ${i}`, grade: 'DS45', start_date: '2010-01-01', bidang: 'CS', campus: i % 2 ? 'N' : 'S', status: 'Active', ...o })
  const pool = [P(1), P(2), P(3), P(4, { grade: 'DS54', start_date: '1990-01-01' }), P(5, { bidang: 'Math' })]
  const sem = { code: '20262', min_percent: 20, reaudit_below: 80 }
  const A = (id, ee, er, o = {}) => ({ id, auditee_id: ee.id, auditee: ee, auditor_id: er?.id ?? null, auditor: er ?? null, round_no: 1, reaudit_state: '', completed_at: null, marks: null, session_date: null, ...o })
  const scores = (v) => Object.fromEntries(ITEM_NUMBERS.map((n) => [n, v]))
  const audits = [
    A('a1', pool[0], pool[3], { completed_at: 'x', marks: '40', session_date: '2026-10-01' }),                        // replaced by the re-audit
    A('a1r', pool[0], pool[1], { round_no: 2, reaudit_state: 'approved', completed_at: 'x', marks: '100' }),
    A('a2', pool[4], pool[3], { completed_at: 'x', marks: '80', session_date: '2026-10-02' }),
    A('a3', pool[2], null),
  ]
  const r = buildReport(sem, audits, pool, { a1: scores(2), a1r: scores(5), a2: scores(4) }, new Date(2026, 9, 16))

  it('final mark = the latest audit, so a re-audit replaces the first mark', () => {
    expect(finalAudits(audits).map((a) => a.id).sort()).toEqual(['a1r', 'a2', 'a3'])
    expect(r.audits).toBe(3); expect(r.completed).toBe(2)
    expect(r.average).toBe(90); expect(r.highest).toBe(100); expect(r.lowest).toBe(80)
    expect(r.stillBelow).toBe(0) // 80 is not below 80
  })
  it('counts quota per department from round-1 audits', () => {
    expect(r.quota.map((q) => [q.dept, q.required, q.selected, q.ok])).toEqual([['CS', 1, 2, true], ['Math', 1, 1, true]])
    expect(r.quota[0].completed).toBe(1); expect(r.quota[0].average).toBe(100)
  })
  it('lists Cemerlang lecturers, bands and section averages', () => {
    expect(r.cemerlang.map((c) => [c.staff_id, c.marks])).toEqual([['S1', 100]])
    expect(r.bands['Cemerlang (90-100)']).toBe(1); expect(r.bands['Baik (80-89)']).toBe(1)
    expect(BANDS.map(([l]) => l)).toEqual(['Cemerlang (90-100)', 'Baik (80-89)', 'Memuaskan (70-79)', 'Lemah (60-69)', 'Sangat Lemah (<60)'])
    expect(r.sections.find((s) => s.key === 'A')).toMatchObject({ max: 25, average: 22.5, percent: 90 }) // mean of 25 (all 5s) and 20 (all 4s)
  })
  it('workload counts active audits only and tracks re-audits', () => {
    expect(r.workload.find((w) => w.staff_id === 'S4')).toMatchObject({ assigned: 2, completed: 2 })
    expect(r.reaudits).toBe(1); expect(r.reauditsDone).toBe(1)
  })
  it('flags rule overrides', () => {
    const bad = buildReport(sem, [A('x', pool[3], pool[0])], pool, {}, new Date(2026, 9, 16)) // junior audits the most senior
    expect(bad.ruleOverrides).toBe(1)
  })
  it('export lists every round, marks only the final one, and leaves out comments', () => {
    const sheets = exportSheets(sem, audits, r, { a1: scores(2), a1r: scores(5), a2: scores(4) })
    const main = sheets[0].rows, h = main[0]
    const row = (id) => main.find((x) => x[h.indexOf('Round')] === (id === 'a1r' ? 2 : 1) && x[1] === (id === 'a2' ? 'S5' : 'S1'))
    expect(main).toHaveLength(5)
    expect(row('a1')[h.indexOf('Counts as final mark')]).toMatch(/^No/); expect(row('a1r')[h.indexOf('Counts as final mark')]).toBe('Yes')
    expect(row('a1r')[h.indexOf('Marks TAS (/100)')]).toBe(100); expect(row('a1r')[h.indexOf('Indicator')]).toMatch(/^Cemerlang/)
    expect(row('a1r')[h.indexOf('A (/25)')]).toBe(25); expect(row('a2')[h.indexOf('Marks TAS (/100)')]).toBe(80)
    expect(main[4][h.indexOf('Status')]).toBe('Not scheduled') // a3: nothing done yet
    expect(sheets.map((s) => s.name)).toEqual(['Audit Marks', 'Facilities', 'Summary by Department', 'Summary by Campus', 'Auditor Workload', 'Cemerlang', 'Corrections', 'Section Averages', 'Mark Bands'])
    expect(JSON.stringify(sheets)).not.toMatch(/comment/i)
  })
})

describe('fetchAll', () => {
  it('pages past the 1000-row limit instead of silently truncating', async () => {
    const all = Array.from({ length: 2300 }, (_, i) => ({ i }))
    const calls = []
    const make = () => ({ range: async (from, to) => { calls.push([from, to]); return { data: all.slice(from, to + 1), error: null } } })
    expect(await fetchAll(make)).toHaveLength(2300)
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(await fetchAll(() => ({ range: async () => ({ data: [], error: null }) }))).toEqual([])
    await expect(fetchAll(() => ({ range: async () => ({ data: null, error: new Error('boom') }) }))).rejects.toThrow('boom')
  })
})
