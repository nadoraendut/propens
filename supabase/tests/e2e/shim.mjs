// Test-only stand-in for the parts of Supabase the app talks to besides the database REST API:
//   /rest/v1/*  -> PostgREST (real, with the real RLS)        /auth/v1/*  -> password login, refresh, update user
//   /functions/v1/import-lecturers, send-outbox -> same logic as the Edge Functions
import http from 'node:http'
import crypto from 'node:crypto'
import pg from 'pg'

const SECRET = 'e2e-secret-e2e-secret-e2e-secret-1234'
const PORT = 54321, REST = 3001
const pool = new pg.Pool({ host: '/tmp', port: 5544, user: 'postgres', database: process.env.DB ?? 'propens_e2e' })
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
const sign = (claims) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(claims); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}` }
const verify = (t) => { try { const [h, p, s] = t.split('.'); if (crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null; const c = JSON.parse(Buffer.from(p, 'base64url')); return c.exp > Date.now() / 1000 ? c : null } catch { return null } }
export const anonKey = sign({ role: 'anon', iss: 'supabase', exp: 4102444800 })
if (process.argv[2] === 'anon') { console.log(anonKey); process.exit(0) }

await pool.query(`create table if not exists auth.passwords (user_id uuid primary key, pw text not null)`)
const refresh = new Map()
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Type' }
const send = (res, code, body) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)) }
const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))) })

async function userObj(id) {
  const { rows } = await pool.query('select * from auth.users where id=$1', [id]); const u = rows[0]
  if (!u) return null
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-01-01T00:00:00Z', phone: '',
    app_metadata: { provider: 'email', ...u.raw_app_meta_data }, user_metadata: u.raw_user_meta_data, identities: [], created_at: '2026-01-01T00:00:00Z', updated_at: new Date().toISOString() }
}
async function session(id) {
  const user = await userObj(id), exp = Math.floor(Date.now() / 1000) + 3600
  const rt = crypto.randomUUID(); refresh.set(rt, id)
  return { access_token: sign({ aud: 'authenticated', role: 'authenticated', sub: id, email: user.email, exp, iat: exp - 3600 }),
    token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: rt, user }
}
const who = (req) => { const c = verify((req.headers.authorization ?? '').replace(/^Bearer /i, '')); return c?.sub ?? null }

async function importLecturers(req, res) {
  const me = who(req); if (!me) return send(res, 401, { error: 'Unauthorized' })
  const role = (await pool.query('select role from public.profiles where id=$1', [me])).rows[0]?.role
  if (role !== 'admin') return send(res, 403, { error: 'Only the admin can import lecturers' })
  const { lecturers } = JSON.parse((await body(req)).toString())
  const out = { created: 0, updated: 0, failed: [], ids: {} }
  for (const l of lecturers) {
    const no = String(l.staff_id ?? '').trim()
    try {
      if (!/^[A-Za-z0-9]{6,20}$/.test(no)) throw new Error('Staff ID must be 6-20 letters or digits')
      if (!l.name || !l.grade || !l.bidang) throw new Error('Name, grade and bidang are required')
      const ex = (await pool.query('select id from public.profiles where staff_id=$1', [no])).rows[0]
      const f = { full_name: l.name, grade: l.grade, bidang: l.bidang, start_date: l.start_date, campus: l.campus ?? '', status: l.status || 'Active' }
      if (ex) {
        await pool.query(`update public.profiles set full_name=$2, grade=$3, bidang=$4, start_date=$5, campus=$6, status=$7, email=coalesce(nullif($8,''), email) where id=$1`,
          [ex.id, f.full_name, f.grade, f.bidang, f.start_date, f.campus, f.status, l.email ?? ''])
        out.ids[no] = ex.id; out.updated++
      } else {
        const meta = { ...f, staff_id: no, email: l.email ?? '', must_change_password: true }
        const r = await pool.query(`insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values ($1, '{"role":"lecturer"}', $2) returning id`, [`${no.toLowerCase()}@staff.propens.app`, meta])
        await pool.query('insert into auth.passwords values ($1,$2)', [r.rows[0].id, no])
        out.ids[no] = r.rows[0].id; out.created++
      }
    } catch (e) { out.failed.push({ staff_id: no, error: e.message }) }
  }
  send(res, 200, out)
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end() }
  try {
    if (url.pathname.startsWith('/rest/v1/')) {
      const buf = await body(req)
      const up = http.request({ host: '127.0.0.1', port: REST, path: url.pathname.slice(8) + url.search, method: req.method, headers: { ...req.headers, host: '127.0.0.1' } }, (r) => {
        const h = { ...r.headers }; for (const k of Object.keys(h)) if (k.startsWith('access-control')) delete h[k]; res.writeHead(r.statusCode, { ...h, ...cors }); r.pipe(res) })
      up.on('error', (e) => send(res, 502, { message: e.message })); return up.end(buf)
    }
    if (url.pathname === '/auth/v1/token') {
      const b = JSON.parse((await body(req)).toString() || '{}')
      if (url.searchParams.get('grant_type') === 'password') {
        const { rows } = await pool.query(`select u.id, p.pw from auth.users u join auth.passwords p on p.user_id = u.id where lower(u.email) = lower($1)`, [b.email])
        if (!rows[0] || rows[0].pw !== b.password) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials', message: 'Invalid login credentials' })
        return send(res, 200, await session(rows[0].id))
      }
      const id = refresh.get(b.refresh_token); if (!id) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token', message: 'Invalid Refresh Token' })
      return send(res, 200, await session(id))
    }
    if (url.pathname === '/auth/v1/user') {
      const me = who(req); if (!me) return send(res, 401, { code: 401, msg: 'invalid JWT', message: 'invalid JWT' })
      if (req.method === 'PUT') {
        const b = JSON.parse((await body(req)).toString() || '{}')
        if (b.password) await pool.query('update auth.passwords set pw=$2 where user_id=$1', [me, b.password])
        if (b.data) await pool.query(`update auth.users set raw_user_meta_data = raw_user_meta_data || $2::jsonb where id=$1`, [me, b.data])
      }
      return send(res, 200, await userObj(me))
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204)
    if (url.pathname === '/functions/v1/import-lecturers') return importLecturers(req, res)
    if (url.pathname === '/functions/v1/send-outbox') {
      const me = who(req); if (!me) return send(res, 401, { error: 'Unauthorized' })
      const r = await pool.query(`update public.email_outbox set status='sent', sent_at=now() where status='queued'`)
      return send(res, 200, { sent: r.rowCount })
    }
    send(res, 404, { error: 'not found', path: url.pathname })
  } catch (e) { console.error(e); send(res, 500, { error: e.message }) }
}).listen(PORT, () => console.log('shim on', PORT))
