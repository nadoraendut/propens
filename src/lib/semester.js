// Semester codes: 4-digit year + 1-digit intake, e.g. 20264 = October 2026, 20272 = March 2027.
export const SEMESTER_RE = /^\d{4}[1-9]$/
const INTAKES = { 2: 'March', 4: 'October' } // only the intakes in use; others fall back to "Intake N"

export const normalizeCode = (v) => String(v ?? '').replace(/\s+/g, '')

export function parseSemester(code) {
  const c = normalizeCode(code)
  if (!SEMESTER_RE.test(c)) return null
  const year = Number(c.slice(0, 4)), intake = Number(c[4])
  return { code: c, year, intake, label: `${INTAKES[intake] ?? `Intake ${intake}`} ${year}` }
}

// newest first (codes sort naturally as strings)
export const byNewest = (a, b) => (a.code < b.code ? 1 : a.code > b.code ? -1 : 0)

export const semesterLabel = (code) => parseSemester(code)?.label ?? code
