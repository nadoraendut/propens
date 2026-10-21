-- Session reminders and the notification bell. Run after 0004.

-- Run once or twice a day (see the README: Supabase Cron / the send-outbox Edge Function calls it). Reminds the auditee and the
-- auditor on the day before and the day of a session, once per schedule. Malaysia time decides what "today" is.
create function public.queue_due_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; today date := (now() at time zone 'Asia/Kuala_Lumpur')::date; txt text;
begin
  for r in select a.id, a.auditee_id, a.auditor_id, a.session_date, a.session_time, a.venue
           from audits a join semesters s on s.id = a.semester_id
           where s.state = 'approved' and a.completed_at is null and a.reminder_sent_at is null
             and a.session_date between today and today + 1 and (a.round_no = 1 or a.reaudit_state = 'approved') loop
    txt := trim(format('%s %s %s', r.session_date, r.session_time, case when r.venue <> '' then 'at ' || r.venue else '' end));
    perform _tell(r.auditee_id, 'Reminder: teaching audit session', 'Reminder: audit session on ' || txt, 'my-audits');
    if r.auditor_id is not null then
      perform _tell(r.auditor_id, 'Reminder: teaching audit session', 'Reminder: audit session on ' || txt, 'my-audits');
    end if;
    update audits set reminder_sent_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create function public.mark_notifications_read() returns void
language sql security definer set search_path = public as $$
  update notifications set is_read = true where lecturer_id = auth.uid() and not is_read $$;

-- The send-outbox Edge Function claims a batch of queued e-mails before sending them, so two runs at once never send the same
-- mail twice. A batch that was claimed but never finished (the function crashed) is released again after 15 minutes.
create function public.claim_emails(p_limit int default 50) returns setof public.email_outbox
language plpgsql security definer set search_path = public as $$
begin
  update email_outbox set status = 'queued' where status = 'sending' and created_at < now() - interval '15 minutes';
  return query
    update email_outbox set status = 'sending'
    where id in (select id from email_outbox where status = 'queued' order by created_at limit p_limit for update skip locked)
    returning *;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.claim_emails(int) to service_role;
grant execute on function public.mark_notifications_read() to authenticated;
grant execute on function public.queue_due_reminders() to service_role;
