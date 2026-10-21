import { createClient } from '@supabase/supabase-js'
import { normalizeUrl, normalizeKey } from './env.js'

const url = normalizeUrl(import.meta.env.VITE_SUPABASE_URL)
const key = normalizeKey(import.meta.env.VITE_SUPABASE_ANON_KEY)

export const configured = Boolean(url && key)

let client
try {
  client = createClient(url || 'http://localhost', key || 'missing')
} catch {
  client = createClient('http://localhost', 'missing') // bad URL must not blank the whole app
}
export const supabase = client
export const supabaseHost = (() => { try { return new URL(url).host } catch { return url || '(not set)' } })()

// Lecturers log in with their Staff ID through a synthetic email; admins and the Head may use their real email.
export const staffEmail = (id) => `${id.trim().toLowerCase()}@staff.propens.app`
export const loginEmail = (input) => (input.includes('@') ? input.trim() : staffEmail(input))
