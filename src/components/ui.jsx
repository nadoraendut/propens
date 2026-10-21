import { useCallback, useEffect, useState } from 'react'

// Tiny data-loading hook: re-run via reload().
export function useQuery(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const run = useCallback(async () => {
    try { setState((s) => ({ ...s, loading: true })); setState({ data: await fn(), error: null, loading: false }) }
    catch (e) { setState({ data: null, error: e.message ?? String(e), loading: false }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { run() }, [run])
  return { ...state, reload: run }
}

// Throw on Supabase errors so callers can use try/catch uniformly.
export const unwrap = ({ data, error }) => { if (error) throw error; return data }

export const fmt = (d) => (d ? new Date(d).toLocaleString() : '')
// a date-only string ('2026-10-20') must be read as a local date, not midnight UTC
export const parseDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) : new Date(d))
export const fmtDate = (d) => (d ? parseDate(d).toLocaleDateString() : '')

export function Err({ children }) { return children ? <div className="err">{String(children)}</div> : null }
export function Ok({ children }) { return children ? <div className="privacy">{children}</div> : null }

export function Tabs({ tabs, value, onChange, bottom = false }) {
  return (
    <div className={`tabs${bottom ? ' bottom-nav' : ''}`} role="tablist">
      {tabs.map(([k, label, icon]) => (
        <button key={k} role="tab" aria-selected={k === value} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>
          {icon && <span className="ico">{icon}</span>}{label}
        </button>
      ))}
    </div>
  )
}

// The Propens mark: a shield with a tick, on a navy tile (same file as public/favicon.svg).
export function Logo({ size = 32 }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Propens">
      <rect width="64" height="64" rx="16" fill="#061c54" />
      <path d="M32 12 48 19v12c0 10-7 17-16 21-9-4-16-11-16-21V19z" fill="none" stroke="#72d3f7" strokeWidth="3.5" strokeLinejoin="round" />
      <path d="m24 32 6 6 11-12" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>)
}

// Navy header band with the faceted pattern. `title` may contain <em> for the cyan highlight.
export function Hero({ chip, title, sub, extra, actions, nav, compact = false }) {
  return (
    <section className={`hero hero-bg${compact ? ' compact' : ''}`}>
      <div className="hero-inner">
        {chip && <span className="hero-chip"><i />{chip}</span>}
        <h1>{title}</h1>
        {sub && <p className="hero-sub">{sub}</p>}
        {extra && <div className="hero-extra">{extra}</div>}
        {actions && <div className="hero-actions">{actions}</div>}
        {nav}
      </div>
    </section>)
}

// White stat card that floats over the bottom edge of the hero. stats: [[value, label], ...]
export function StatStrip({ stats }) {
  return (
    <div className={`stats-float n${stats.length}`}>
      {stats.map(([value, label]) => <div className="stat-cell" key={label}><b>{value}</b><span>{label}</span></div>)}
    </div>)
}

// Small blue uppercase label above a bold section title
export function SectionHead({ eyebrow, title, right }) {
  return (
    <div className="sec-head">
      <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 className="sec-title">{title}</h2></div>
      {right}
    </div>)
}

export const STATE_LABELS = {
  draft: 'Draft', generated: 'Generated', pending_head: 'With Head of Faculty', changes_requested: 'Changes requested',
  approved: 'Approved', closed: 'Closed',
}
export const stateTone = { draft: 'muted', generated: 'warn', pending_head: 'warn', changes_requested: 'bad', approved: 'ok', closed: 'muted' }
export function StatePill({ state }) { return <span className={`pill ${stateTone[state] ?? ''}`}>{STATE_LABELS[state] ?? state}</span> }

// Download a Blob from the browser
export function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
