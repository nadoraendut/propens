import { supabase } from '../../lib/supabase.js'
import { useQuery, unwrap, Err, SectionHead, fmt } from '../ui.jsx'

// E-mails queued by the app. The send-outbox Edge Function delivers them; "queued" means it has not run (or has no mail key).
export default function Outbox() {
  const rows = useQuery(async () => unwrap(await supabase.from('email_outbox').select('*').order('created_at', { ascending: false }).limit(200)))
  async function sendNow() {
    try { unwrap(await supabase.functions.invoke('send-outbox')); rows.reload() } catch (x) { alert(x.message) }
  }
  return (
    <>
      <SectionHead eyebrow="Notices" title="E-mail outbox" right={<button onClick={sendNow}>Send queued e-mails now</button>} />
      <p className="muted">Status "queued" means the mail has not been delivered: the <code>send-outbox</code> function has not run yet or no mail key is set (see the README).</p>
      <Err>{rows.error}</Err>
      <div className="card"><div className="scroll"><table>
        <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
        <tbody>{rows.data?.map((m) => (
          <tr key={m.id}><td>{fmt(m.created_at)}</td><td>{m.to_addr}</td>
            <td><details><summary>{m.subject}</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{m.body}</pre></details></td>
            <td><span className={`pill ${m.status === 'sent' ? 'ok' : m.status === 'failed' ? 'bad' : 'warn'}`}>{m.status}</span>{m.error && <div className="err">{m.error}</div>}</td></tr>))}</tbody>
      </table></div>{rows.data?.length === 0 && <p className="muted">Nothing yet.</p>}</div>
    </>
  )
}
