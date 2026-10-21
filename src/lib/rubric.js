// PRO-PENS rubric scoring. Text lives in rubricData.js.
//   raw = sum of the 29 item scores (1-5), max 145;  TS = raw x 50/145 (/50);  TAS = TS x 2 = raw x 100/145 (/100)
// TAS is the audit mark. Bands are the indicator table printed on the form.
import { SECTIONS, INDICATORS } from './rubricData.js'

export { SECTIONS, SCALE, INDICATORS, FACILITY_SCALE, FACILITY_ITEMS } from './rubricData.js'
export const MAX_RAW = 145
export const ITEM_NUMBERS = SECTIONS.flatMap((s) => s.items.map((i) => i.no))
export const CEMERLANG_MIN = INDICATORS[0][0] // 90

const round2 = (n) => Math.round(n * 100) / 100

/** scores: { itemNo: 1..5 } (may be partial) -> section totals, raw, TS, TAS, complete */
export function compute(scores) {
  const sections = {}
  for (const s of SECTIONS) sections[s.key] = s.items.reduce((sum, i) => sum + (scores[i.no] ?? 0), 0)
  const raw = Object.values(sections).reduce((a, b) => a + b, 0)
  return {
    sections, raw,
    ts: round2((raw * 50) / MAX_RAW),
    tas: round2((raw * 100) / MAX_RAW),
    complete: ITEM_NUMBERS.every((n) => scores[n] != null),
  }
}

export function indicator(tas) {
  if (tas == null) return ''
  return INDICATORS.find(([floor]) => tas >= floor)[1]
}

export const isCemerlang = (tas) => tas != null && tas >= CEMERLANG_MIN
export const isBelow = (tas, threshold) => tas != null && tas < threshold
