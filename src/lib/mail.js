import { supabase } from './supabase.js'

// Right after an action that queues e-mail (approval, results, feedback...) ask the send-outbox function to deliver it now,
// instead of waiting for the next scheduled run. Best effort: a failure here never blocks the action (the mail stays queued).
export function flushMail() {
  supabase.functions.invoke('send-outbox').catch(() => {})
}
