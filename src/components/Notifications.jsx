import { supabase } from '../lib/supabase.js'
import { useQuery, unwrap, Err, SectionHead, Hero, fmt } from './ui.jsx'

// The in-app alerts. A link like 'semester:<id>' or 'my-audits' sends the lecturer to the right screen.
export default function Notifications({ onOpen, onChanged }) {
  const list = useQuery(async () =>
    unwrap(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)))

  async function markAll() {
    try { unwrap(await supabase.rpc('mark_notifications_read')); list.reload(); onChanged?.() } catch (x) { alert(x.message) }
  }
  const unread = (list.data ?? []).filter((n) => !n.is_read).length

  return (
    <>
      <Hero compact chip="Alerts" title={<>Your <em>alerts</em></>} sub="Approvals, assignments, results and reminders." />
      <SectionHead eyebrow="Inbox" title={`${unread} unread`}
        right={unread > 0 && <button onClick={markAll}>Mark all read</button>} />
      <Err>{list.error}</Err>
      <div className="card">
        {list.data?.length === 0 && <p className="muted">No alerts yet.</p>}
        {list.data?.map((n) => (
          <div className="mrow" key={n.id}>
            <div className="grow">
              <div className="title">{!n.is_read && <span className="pill solid">new</span>} {n.link
                ? <button className="link" style={{ padding: 0, textAlign: 'left' }} onClick={() => onOpen(n.link)}>{n.message}</button> : n.message}</div>
              <div className="sub">{fmt(n.created_at)}</div>
            </div>
          </div>))}
      </div>
    </>
  )
}
