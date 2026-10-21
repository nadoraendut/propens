// Vercel/.env values are often pasted with quotes, spaces, a trailing slash or an API path.
const clean = (v) => String(v ?? '').trim().replace(/^["']|["']$/g, '').trim()

export function normalizeUrl(raw) {
  let u = clean(raw)
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  return u.replace(/\/(rest|auth|storage|functions)\/v1.*$/i, '').replace(/\/+$/, '')
}

export const normalizeKey = clean

// Turns a sign-in failure into something a person can act on.
export function describeAuthError(error, host) {
  const msg = error?.message ?? ''
  if (error?.status === 0 || error?.name === 'AuthRetryableFetchError' || /fetch/i.test(msg))
    return `Cannot reach Supabase at ${host}. Check VITE_SUPABASE_URL (Project Settings → API → Project URL) and redeploy.`
  if (/api key|apikey/i.test(msg) || (error?.status === 401 && !error?.code))
    return 'Supabase rejected the API key. Check VITE_SUPABASE_ANON_KEY (the anon / publishable key) and redeploy.'
  if (error?.code === 'invalid_credentials' || /invalid login credentials/i.test(msg))
    return 'Invalid Staff ID or password.'
  if (error?.code === 'email_not_confirmed') return 'This account\'s email is not confirmed yet.'
  return msg || 'Sign-in failed.'
}
