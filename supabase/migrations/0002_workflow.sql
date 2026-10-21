-- Audit list workflow: the admin saves the generated list (the draw itself runs in the browser, see src/lib/rotation.js),
-- edits it, verifies it; the Head approves or sends it back; on approval auditees and auditors are told.
-- Every function checks who is calling and what state the semester is in. Run after 0001.

-- per-department quota check: required (min %) vs selected (round-1 audits), for the admin and the Head
create function public.quota_status(p_semester uuid)
returns table (bidang text, total int, required int, selected int)
language sql stable security definer set search_path = public as $$
  select m.bidang, count(*)::int,
         public.required_count(count(*)::int, s.min_percent),
         (select count(*)::int from audits a join profiles p on p.id = a.auditee_id
           where a.semester_id = s.id and a.round_no = 1 and p.bidang = m.bidang)
  from semesters s
  join semester_lecturers sl on sl.semester_id = s.id
  join profiles m on m.id = sl.lecturer_id
  where s.id = p_semester and lower(trim(m.status)) = 'active' and (public.is_admin() or public.is_head())
  group by m.bidang, s.id, s.min_percent
  order by m.bidang $$;

-- Save the list produced by the draw. rows: [{auditee_id, auditor_id|null}]. Replaces any earlier list.
create function public.save_generated_list(p_semester uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare sem semesters; r record; n int := 0; e uuid; a uuid;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select * into sem from semesters where id = p_semester for update;
  if not found then raise exception 'Semester not found'; end if;
  if sem.state not in ('draft','generated','changes_requested') then
    raise exception 'This list is locked in its current state'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'The list is empty'; end if;

  delete from audits where semester_id = p_semester;
  for r in select value from jsonb_array_elements(p_rows) loop
    e := (r.value->>'auditee_id')::uuid;
    a := nullif(r.value->>'auditor_id', '')::uuid;
    if not is_active_member(p_semester, e) then raise exception 'An auditee is not an active lecturer of this semester'; end if;
    if a is not null and (a = e or not is_active_member(p_semester, a)) then
      raise exception 'An auditor is not valid (must be a different, active lecturer of this semester)'; end if;
    insert into audits (semester_id, auditee_id, auditor_id, origin) values (p_semester, e, a, 'auto');
    n := n + 1;
  end loop;
  update semesters set state = 'generated', head_comment = '', verified_at = null where id = p_semester;
  perform _tell_role('admin', format('Audit list generated for %s', sem.code),
    format('The audit list for %s has been generated: %s auditees. Please review and verify it.', sem.code, n),
    'semester:' || p_semester);
  return n;
end $$;

-- admin edits while the list is still editable
create function public.set_auditor(p_audit uuid, p_auditor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a audits;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select * into a from audits where id = p_audit;
  if not found or a.round_no <> 1 or not semester_editable(a.semester_id) then raise exception 'This audit cannot be edited'; end if;
  if p_auditor is not null and (p_auditor = a.auditee_id or not is_active_member(a.semester_id, p_auditor)) then
    raise exception 'The auditor must be a different, active lecturer of this semester'; end if;
  update audits set auditor_id = p_auditor, origin = 'manual' where id = p_audit;
end $$;

create function public.add_audit(p_semester uuid, p_auditee uuid, p_auditor uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if not semester_editable(p_semester) then raise exception 'This list is locked in its current state'; end if;
  if not is_active_member(p_semester, p_auditee) then raise exception 'The auditee is not an active lecturer of this semester'; end if;
  if p_auditor is not null and (p_auditor = p_auditee or not is_active_member(p_semester, p_auditor)) then
    raise exception 'The auditor must be a different, active lecturer of this semester'; end if;
  insert into audits (semester_id, auditee_id, auditor_id, origin) values (p_semester, p_auditee, p_auditor, 'manual')
    returning id into new_id;
  return new_id;
end $$;

create function public.remove_audit(p_audit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a audits;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select * into a from audits where id = p_audit;
  if not found or a.round_no <> 1 or not semester_editable(a.semester_id) then raise exception 'This audit cannot be removed'; end if;
  delete from audits where id = p_audit;
end $$;

-- Admin verifies the list and sends it to the Head. Rows without an auditor are allowed (the Head picks one).
create function public.submit_to_head(p_semester uuid) returns void
language plpgsql security definer set search_path = public as $$
declare sem semesters; open_rows int;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select * into sem from semesters where id = p_semester for update;
  if not found or sem.state not in ('generated','changes_requested') then
    raise exception 'Generate the list first (or it is already with the Head)'; end if;
  if not exists (select 1 from audits where semester_id = p_semester) then raise exception 'The audit list is empty'; end if;
  if exists (select 1 from quota_status(p_semester) q where q.selected < q.required) then
    raise exception 'Some departments are below the minimum percentage'; end if;
  select count(*) into open_rows from audits where semester_id = p_semester and auditor_id is null;
  update semesters set state = 'pending_head', verified_at = now(), head_comment = '' where id = p_semester;
  perform _tell_role('head', format('Audit list for %s awaits your approval', sem.code),
    format('The admin has verified the audit list for %s. %sPlease approve it or request changes.', sem.code,
           case when open_rows > 0 then format('%s auditee(s) have no auditor and need you to pick one. ', open_rows) else '' end),
    'semester:' || p_semester);
end $$;

-- Head picks an auditor for a row the draw could not fill (e.g. the most senior lecturer).
create function public.head_assign_auditor(p_audit uuid, p_auditor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a audits; s semesters;
begin
  if not is_head() then raise exception 'Not allowed'; end if;
  select * into a from audits where id = p_audit;
  if not found then raise exception 'Audit not found'; end if;
  select * into s from semesters where id = a.semester_id;
  if s.state <> 'pending_head' or a.auditor_id is not null or a.round_no <> 1 then
    raise exception 'Only rows without an auditor can be assigned while awaiting approval'; end if;
  if p_auditor = a.auditee_id or not is_active_member(a.semester_id, p_auditor) then
    raise exception 'Choose an active lecturer other than the auditee'; end if;
  update audits set auditor_id = p_auditor, origin = 'manual' where id = p_audit;
end $$;

-- Head approves (auditees and auditors are told) or sends the list back with a reason.
create function public.head_decide(p_semester uuid, p_approve boolean, p_comment text default '') returns void
language plpgsql security definer set search_path = public as $$
declare sem semesters; r record; names text;
begin
  if not is_head() then raise exception 'Not allowed'; end if;
  select * into sem from semesters where id = p_semester for update;
  if not found or sem.state <> 'pending_head' then raise exception 'This list is not awaiting approval'; end if;

  if not p_approve then
    if coalesce(trim(p_comment), '') = '' then raise exception 'Please say what should change'; end if;
    update semesters set state = 'changes_requested', head_comment = trim(p_comment) where id = p_semester;
    perform _tell_role('admin', format('Head of Faculty requested changes to %s', sem.code),
      'Requested changes: ' || trim(p_comment), 'semester:' || p_semester);
    return;
  end if;

  if exists (select 1 from audits where semester_id = p_semester and round_no = 1 and auditor_id is null) then
    raise exception 'Pick an auditor for every auditee before approving'; end if;
  update semesters set state = 'approved', approved_at = now(), head_comment = '' where id = p_semester;

  for r in select a.auditee_id, e.full_name ee_name, er.full_name er_name, er.staff_id er_staff
           from audits a join profiles e on e.id = a.auditee_id join profiles er on er.id = a.auditor_id
           where a.semester_id = p_semester and a.round_no = 1 loop
    perform _tell(r.auditee_id, format('You are scheduled for a teaching audit - %s', sem.code),
      format(E'Dear %s,\n\nYou have been selected for the teaching audit in %s.\nYour auditor is %s (%s).\n\n'
             'Please agree on a date and time with your auditor, then enter the session details in the app so that reminders can be sent.',
             r.ee_name, sem.code, r.er_name, r.er_staff), 'my-audits');
  end loop;
  for r in select a.auditor_id, er.full_name er_name,
                  string_agg(format('  - %s (%s, %s)', e.full_name, e.staff_id, e.bidang), E'\n' order by e.full_name) lines
           from audits a join profiles e on e.id = a.auditee_id join profiles er on er.id = a.auditor_id
           where a.semester_id = p_semester and a.round_no = 1 group by a.auditor_id, er.full_name loop
    perform _tell(r.auditor_id, format('You are assigned as an auditor - %s', sem.code),
      format(E'Dear %s,\n\nYou have been assigned as auditor for %s:\n%s\n\n'
             'Please agree on a date and time with each auditee. Enter the PRO-PENS rubric in the app during the session.',
             r.er_name, sem.code, r.lines), 'my-audits');
  end loop;
  perform _tell_role('admin', format('%s approved; invitations sent', sem.code),
    'The Head of Faculty approved the list. Auditees and auditors have been notified.', 'semester:' || p_semester);
end $$;

-- Auditee (or admin) records the agreed session; the auditor is told.
create function public.schedule_session(p_audit uuid, p_date date, p_time text, p_venue text) returns void
language plpgsql security definer set search_path = public as $$
declare a audits; s semesters; ee_name text;
begin
  select * into a from audits where id = p_audit;
  if not found then raise exception 'Audit not found'; end if;
  if auth.uid() is distinct from a.auditee_id and not is_admin() then raise exception 'Not allowed'; end if;
  select * into s from semesters where id = a.semester_id;
  if s.state <> 'approved' or a.completed_at is not null or not (a.round_no = 1 or a.reaudit_state = 'approved') then
    raise exception 'This audit cannot be scheduled right now'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  update audits set session_date = p_date, session_time = coalesce(p_time, ''), venue = coalesce(trim(p_venue), ''),
         reminder_sent_at = null where id = p_audit;
  select full_name into ee_name from profiles where id = a.auditee_id;
  if a.auditor_id is not null then
    perform _tell(a.auditor_id, format('Audit session set: %s on %s', ee_name, p_date),
      format('%s has set the audit session for %s %s %s.', ee_name, p_date, coalesce(p_time, ''),
             case when coalesce(trim(p_venue), '') <> '' then 'at ' || trim(p_venue) else '' end), 'my-audits');
  end if;
end $$;

-- What the signed-in lecturer sees as AUDITEE. Marks and the rubric stay hidden until the admin releases the results,
-- and then only the final mark (a re-audit replaces the first mark).
create function public.my_audits() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  select coalesce(jsonb_agg(row order by sort_code desc, round_no desc), '[]'::jsonb) into out from (
    select s.code sort_code, a.round_no, jsonb_build_object(
      'id', a.id, 'semester_code', s.code, 'round_no', a.round_no,
      'auditor_name', er.full_name, 'auditor_staff_id', er.staff_id,
      'session_date', a.session_date, 'session_time', a.session_time, 'venue', a.venue,
      'can_schedule', (s.state = 'approved' and a.completed_at is null),
      'completed', a.completed_at is not null,
      'feedback', case when a.completed_at is not null then a.feedback end,
      'result', case when s.released_at is not null and a.completed_at is not null
                      and a.round_no = (select max(x.round_no) from audits x where x.semester_id = a.semester_id and x.auditee_id = a.auditee_id)
                     then a.marks end
    ) row
    from audits a join semesters s on s.id = a.semester_id
    left join profiles er on er.id = a.auditor_id
    where a.auditee_id = auth.uid() and s.state in ('approved','closed') and (a.round_no = 1 or a.reaudit_state = 'approved')
  ) t;
  return out;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.quota_status(uuid), public.save_generated_list(uuid, jsonb), public.set_auditor(uuid, uuid),
  public.add_audit(uuid, uuid, uuid), public.remove_audit(uuid), public.submit_to_head(uuid),
  public.head_assign_auditor(uuid, uuid), public.head_decide(uuid, boolean, text),
  public.schedule_session(uuid, date, text, text), public.my_audits() to authenticated;
