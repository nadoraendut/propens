// Reading the lecturer list (Excel or CSV) and checking every row before anything is created.
import { parseDate } from './logic.js'
import { sheetsToBlob, readTable } from './xlsx.js'

export const COLUMNS = [ // [key, header, accepted header aliases (letters/digits only, lower case)]
  ['staff_id', 'Staff ID', ['staffid', 'id', 'staffno', 'nopekerja']],
  ['name', 'Staff Name', ['staffname', 'name', 'nama']],
  ['grade', 'Gred Jawatan', ['gredjawatan', 'grade', 'gred']],
  ['bidang', 'Bidang', ['bidang', 'department', 'field']],
  ['start_date', 'Start of Employment', ['startofemployment', 'startdate', 'tarikhlantikan']],
  ['campus', 'Campus', ['campus', 'kampus']],
  ['status', 'Status', ['status']],
  ['email', 'Email', ['email', 'emel', 'emailaddress']],
]
const REQUIRED = ['staff_id', 'name', 'grade', 'bidang', 'start_date']
// the first password is the Staff ID, so it has to be a valid password (same rule as Jengah's student IDs)
export const isValidStaffId = (v) => /^[A-Za-z0-9]{6,20}$/.test(String(v ?? '').trim())

const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const txt = (v) => (v == null ? '' : String(v).trim())
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** rows: 2D array. Returns { good: [lecturer], errors: [string] }; bad rows are skipped, good rows kept. */
export function parseLecturerRows(rows, today = new Date()) {
  const headerAt = rows.findIndex((r) => r.some((c) => COLUMNS[0][2].includes(norm(c))))
  if (headerAt < 0) throw new Error('Could not find a "Staff ID" column in the first sheet.')
  const cols = {}
  rows[headerAt].forEach((h, i) => { const hit = COLUMNS.find(([, , als]) => als.includes(norm(h))); if (hit && !(hit[0] in cols)) cols[hit[0]] = i })
  const missing = COLUMNS.filter(([k]) => REQUIRED.includes(k) && !(k in cols)).map(([, h]) => h)
  if (missing.length) throw new Error(`Missing column(s): ${missing.join(', ')}`)

  const good = [], errors = [], seen = new Set()
  rows.slice(headerAt + 1).forEach((r, n) => {
    if (r.every((c) => c == null || c === '')) return
    const at = headerAt + n + 2
    try {
      const get = (k) => (k in cols ? r[cols[k]] : undefined)
      const l = { staff_id: txt(get('staff_id')), name: txt(get('name')), grade: txt(get('grade')), bidang: txt(get('bidang')),
        campus: txt(get('campus')), status: txt(get('status')) || 'Active', email: txt(get('email')) }
      for (const [k, h] of COLUMNS) if (['staff_id', 'name', 'grade', 'bidang'].includes(k) && !l[k]) throw new Error(`${h} is empty`)
      if (!isValidStaffId(l.staff_id)) throw new Error('Staff ID must be 6-20 letters or digits (it is the first password)')
      if (seen.has(l.staff_id.toLowerCase())) throw new Error('duplicate Staff ID in file')
      seen.add(l.staff_id.toLowerCase())
      const d = parseDate(get('start_date'))
      if (!d) throw new Error('Start of Employment is empty')
      if (d > today) throw new Error('Start of Employment is in the future')
      l.start_date = iso(d)
      if (l.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(l.email)) throw new Error('Email address is not valid')
      good.push(l)
    } catch (e) { errors.push(`Row ${at}: ${e.message}`) }
  })
  return { good, errors }
}

export async function readLecturerFile(file) { return parseLecturerRows(await readTable(file)) }

export function lecturerTemplate() {
  return sheetsToBlob([{ name: 'Lecturers', rows: [COLUMNS.map(([, h]) => h),
    ['A100123', 'Dr. Example Name', 'DS52', 'Computer Science', '2012-03-01', 'Main Campus', 'Active', 'example@university.edu']] }])
}
