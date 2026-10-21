// Admin only. Creates lecturer accounts (login = Staff ID, first password = Staff ID, forced change on first login)
// and updates the details of lecturers that already exist. Needs the service role, so it cannot run in the browser.
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
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: { user } } = await caller.auth.getUser()
  if (!user) return json({ error: 'Unauthorized' }, 401)
  // RLS lets everyone read their own profile, so this proves who the caller is
  const { data: me } = await caller.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (me?.role !== 'admin') return json({ error: 'Only the admin can import lecturers' }, 403)

  const { lecturers } = await req.json()
  if (!Array.isArray(lecturers) || lecturers.length === 0 || lecturers.length > 1000) return json({ error: 'Bad request' }, 400)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const out = { created: 0, updated: 0, failed: [] as { staff_id: string; error: string }[], ids: {} as Record<string, string> }

  for (const l of lecturers) {
    const no = String(l.staff_id ?? '').trim()
    try {
      if (!/^[A-Za-z0-9]{6,20}$/.test(no)) throw new Error('Staff ID must be 6-20 letters or digits')
      const name = String(l.name ?? '').trim(), grade = String(l.grade ?? '').trim(), bidang = String(l.bidang ?? '').trim()
      if (!name || !grade || !bidang) throw new Error('Name, grade and bidang are required')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.start_date ?? ''))) throw new Error('Start of employment must be YYYY-MM-DD')
      const fields = {
        full_name: name, grade, bidang, start_date: l.start_date, campus: String(l.campus ?? '').trim(),
        status: String(l.status ?? '').trim() || 'Active',
      }
      const email = String(l.email ?? '').trim()

      const { data: existing } = await admin.from('profiles').select('id').eq('staff_id', no).maybeSingle()
      if (existing) {
        // never touches the role or the password; an empty e-mail in the file does not erase a known one
        const { error } = await admin.from('profiles').update(email ? { ...fields, email } : fields).eq('id', existing.id)
        if (error) throw error
        out.ids[no] = existing.id; out.updated++
      } else {
        const { data, error } = await admin.auth.admin.createUser({
          email: `${no.toLowerCase()}@staff.propens.app`,
          password: no,
          email_confirm: true,
          app_metadata: { role: 'lecturer' },
          user_metadata: { ...fields, staff_id: no, email, must_change_password: true },
        })
        if (error) throw error
        out.ids[no] = data.user.id; out.created++
      }
    } catch (e) {
      out.failed.push({ staff_id: no, error: (e as Error).message })
    }
  }
  return json(out)
})
