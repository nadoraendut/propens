// Excel in and out. Reading: the first sheet as rows (read-excel-file, .xlsx only). Writing: write-excel-file.
// `universal` builds a Blob in both the browser and Node, so the same code is used by the app and by the tests.

export async function readRows(file) {
  const { readSheet } = await import('read-excel-file/browser')
  return readSheet(file)
}

const HEAD = { fontWeight: 'bold', backgroundColor: '#DDE6F3' }
const cell = (v) => (v === undefined || v === null || v === '' ? null : v)

/** sheets: [{ name, rows: [[header...], [row...]] }] -> Blob (.xlsx). The first row of each sheet is the bold header. */
export async function sheetsToBlob(sheets) {
  const data = sheets.map(({ name, rows }) => ({
    sheet: name.slice(0, 31),
    data: rows.map((r, i) => r.map((c) => (i === 0 ? { value: String(c ?? ''), ...HEAD } : cell(c)))),
    columns: rows[0].map((_, ci) => {
      const longest = Math.max(...rows.map((r) => String(r[ci] ?? '').length))
      return { width: Math.min(Math.max(longest + 2, 12), 55) }
    }),
  }))
  const { default: writeExcelFile } = await import('write-excel-file/universal') // loaded only when a file is downloaded
  return writeExcelFile(data).toBlob()
}

/** Minimal CSV reader (quotes, commas, newlines inside quotes) for people who save lists as .csv. */
export function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((c) => c !== ''))
}

export async function readTable(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext === 'xlsx') return readRows(file)
  if (ext === 'csv') return parseCsv((await file.text()).replace(/^﻿/, ''))
  throw new Error('Use an .xlsx or .csv file (save .xls as .xlsx first).')
}
