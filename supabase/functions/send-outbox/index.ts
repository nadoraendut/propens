// Delivers the e-mails the app has queued (table email_outbox) through Resend (https://resend.com), 50 at a time.
//  * A signed-in user may call it (the app does this right after actions that send mail) - it only sends what is already queued.
//  * Called with the service-role key (Supabase Cron every ~15 minutes) it also queues the session reminders first.
// Secrets (Dashboard > Edge Functions > Secrets): RESEND_API_KEY, MAIL_FROM (e.g. "Propens <audit@yourdomain.edu.my>").
// Without RESEND_API_KEY nothing is sent: the mails stay "queued" and the admin can read them in the E-mail outbox tab.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer /i, '')
  const cron = bearer === serviceKey
  if (!cron) {
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${bearer}` } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return json({ error: 'Unauthorized' }, 401)
  }

  const admin = createClient(url, serviceKey)
  const out = { reminders: 0, sent: 0, failed: 0, queued: 0, note: '' }
  if (cron) {
    const { data } = await admin.rpc('queue_due_reminders')
    out.reminders = Number(data ?? 0)
  }

  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) {
    const { count } = await admin.from('email_outbox').select('id', { count: 'exact', head: true }).eq('status', 'queued')
    out.queued = count ?? 0
    out.note = 'RESEND_API_KEY is not set: e-mails stay queued'
    return json(out)
  }
  const from = Deno.env.get('MAIL_FROM') ?? 'Propens <onboarding@resend.dev>'

  const { data: batch, error } = await admin.rpc('claim_emails', { p_limit: 50 })
  if (error) return json({ error: error.message }, 500)
  for (const m of batch ?? []) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [m.to_addr], subject: m.subject, text: m.body }),
      })
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`)
      await admin.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), error: '' }).eq('id', m.id)
      out.sent++
    } catch (e) {
      await admin.from('email_outbox').update({ status: 'failed', error: (e as Error).message }).eq('id', m.id)
      out.failed++
    }
  }
  return json(out)
})
