const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export const isToday = (iso, now = Date.now()) => startOfDay(new Date(iso)) === startOfDay(new Date(now))

/** Display info for a deadline card. */
export function dueInfo(iso, now = Date.now()) {
  const due = new Date(iso)
  const ms = due.getTime() - now
  const days = Math.round((startOfDay(due) - startOfDay(new Date(now))) / 86400000)
  const overdue = ms < 0
  return {
    day: due.getDate(),
    month: due.toLocaleDateString([], { month: 'short' }),
    time: due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    chip: overdue ? 'Overdue' : days === 0 ? 'Due today' : days === 1 ? 'Tomorrow' : `${days} days left`,
    urgent: !overdue && ms <= 48 * 3600000,
    overdue,
  }
}

/** "ALI BIN ABU" -> "Ali" */
export function firstName(full) {
  const w = String(full ?? '').trim().split(/\s+/)[0] ?? ''
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ''
}

/** "Today, 8:56 AM" / "Yesterday, 3:56 AM" / "14 Oct, 9:00 AM" (with the year if it is another year) */
export function fmtWhen(iso, now = Date.now()) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(d)) / 86400000)
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })}, ${time}`
}
