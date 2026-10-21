-- The PRO-PENS rubric: the auditor saves a draft or submits it; the mark (TAS) is computed here from the 29 item scores.
--   raw = sum of items (max 145);  TS = raw x 50/145;  TAS = TS x 2 = raw x 100/145 (this is audits.marks)
-- A mark below the semester's threshold (default 80) proposes a re-audit by a different auditor, which the Head must approve.
-- A mark of 90 or more (Cemerlang) alerts the admin and the Head. Run after 0002.

create function public._feedback(t text, p text, o text) returns text
language sql immutable as $$
  select concat_ws(E'\n\n',
    case when coalesce(t, '') <> '' then 'Pengajaran dan Pembelajaran:' || E'\n' || t end,
    case when coalesce(p, '') <> '' then 'Profesionalisme Pensyarah:' || E'\n' || p end,
    case when coalesce(o, '') <> '' then 'Lain-lain Perkara:' || E'\n' || o end) $$;

-- ---- alerts shared by submit (here) and correction (0004) ----
create function public._alert_low_mark(p_audit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a audits; s semesters; ee profiles; er profiles; line text;
begin
  select * into a from audits where id = p_audit;
  select * into s from semesters where id = a.semester_id;
  select * into ee from profiles where id = a.auditee_id;
  select * into er from profiles where id = a.auditor_id;
  line := format('%s (%s) scored %s/100 (below %s) in %s, audited by %s.', ee.full_name, ee.staff_id,
                 trim_scale(a.marks), trim_scale(s.reaudit_below), s.code, er.full_name);
  if a.round_no >= 2 then
    perform _tell_role('admin', format('Still below %s after re-audit: %s', trim_scale(s.reaudit_below), ee.full_name),
      line || E'\nThis was the re-audit. No further audit was created; a decision is needed.', 'semester:' || s.id);
    perform _tell_role('head', format('Still below %s after re-audit: %s', trim_scale(s.reaudit_below), ee.full_name),
      line || E'\nThis was the re-audit. No further audit was created; a decision is needed.', 'semester:' || s.id);
  end if;
end $$;

create function public._propose_reaudit(p_audit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a audits; s semesters; ee profiles; er profiles; line text;
begin
  select * into a from audits where id = p_audit;
  select * into s from semesters where id = a.semester_id;
  select * into ee from profiles where id = a.auditee_id;
  select * into er from profiles where id = a.auditor_id;
  -- the second auditor is chosen by the admin (the app suggests one using the rotation rules)
  insert into audits (semester_id, auditee_id, auditor_id, origin, round_no, reaudit_of, reaudit_state)
  values (a.semester_id, a.auditee_id, null, 'auto', 2, a.id, 'proposed')
  on conflict (semester_id, auditee_id, round_no) do nothing;
  line := format('%s (%s) scored %s/100 (below %s) in %s, audited by %s.', ee.full_name, ee.staff_id,
                 trim_scale(a.marks), trim_scale(s.reaudit_below), s.code, er.full_name);
  perform _tell_role('admin', format('Re-audit needed: %s scored below %s', ee.full_name, trim_scale(s.reaudit_below)),
    line || E'\nA second audit by a different auditor is required this semester. Choose the second auditor and submit it to the Head of Faculty.',
    'semester:' || s.id);
  perform _tell_role('head', format('Low audit result: %s', ee.full_name),
    line || E'\nA second audit is required. The admin will submit a proposed second auditor for your approval.', 'semester:' || s.id);
end $$;

create function public._alert_cemerlang(p_audit uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a audits; s semesters; ee profiles; er profiles; body text;
begin
  select * into a from audits where id = p_audit;
  select * into s from semesters where id = a.semester_id;
  select * into ee from profiles where id = a.auditee_id;
  select * into er from profiles where id = a.auditor_id;
  body := format('%s (%s, %s) scored %s/100 in %s (Cemerlang, %s-100), audited by %s.', ee.full_name, ee.staff_id, ee.bidang,
                 trim_scale(a.marks), s.code, trim_scale(cemerlang_min()), er.full_name);
  perform _tell_role('admin', format('Cemerlang result: %s (%s/100)', ee.full_name, trim_scale(a.marks)), body, 'semester:' || s.id);
  perform _tell_role('head', format('Cemerlang result: %s (%s/100)', ee.full_name, trim_scale(a.marks)), body, 'semester:' || s.id);
end $$;

-- ---- save a draft or submit ----
-- p_form: { faculty, program, course_code, group_no, method, student_count, session_date, session_time,
--           comments: {teaching, prof, other}, scores: {"1":4,...}, facility: {"1":5,...}, facility_room, facility_suggestion }
create function public.save_rubric(p_audit uuid, p_form jsonb, p_submit boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a audits; s semesters; ee profiles;
  sc jsonb := coalesce(p_form->'scores', '{}'); fac jsonb := coalesce(p_form->'facility', '{}');
  cm jsonb := coalesce(p_form->'comments', '{}');
  kv record; raw numeric := 0; cnt int := 0; new_marks numeric;
  c_t text := trim(coalesce(cm->>'teaching', '')); c_p text := trim(coalesce(cm->>'prof', '')); c_o text := trim(coalesce(cm->>'other', ''));
  students int; sdate date; fb text;
begin
  select * into a from audits where id = p_audit for update;
  if not found or a.auditor_id is distinct from auth.uid() then raise exception 'Not allowed'; end if;
  select * into s from semesters where id = a.semester_id;
  if s.state <> 'approved' or a.completed_at is not null or not (a.round_no = 1 or a.reaudit_state = 'approved') then
    raise exception 'This audit can no longer be edited'; end if;

  for kv in select key, value from jsonb_each_text(sc) loop
    if kv.key !~ '^\d{1,2}$' or kv.key::int not between 1 and 29 or kv.value !~ '^[1-5]$' then
      raise exception 'Item scores must be 1 to 5 for items 1 to 29'; end if;
    raw := raw + kv.value::int; cnt := cnt + 1;
  end loop;
  for kv in select key, value from jsonb_each_text(fac) loop
    if kv.key !~ '^\d{1,2}$' or kv.key::int not between 1 and 14 or kv.value !~ '^[0-5]$' then
      raise exception 'Facility scores must be 0 to 5 for criteria 1 to 14'; end if;
  end loop;
  if coalesce(p_form->>'student_count', '') <> '' then
    if p_form->>'student_count' !~ '^\d{1,5}$' then raise exception 'Number of students must be a whole number'; end if;
    students := (p_form->>'student_count')::int;
  end if;
  if coalesce(p_form->>'session_date', '') <> '' then
    begin sdate := (p_form->>'session_date')::date; exception when others then raise exception 'Invalid date'; end;
  end if;

  if p_submit then
    if cnt <> 29 then raise exception 'Score every item before submitting'; end if;
    if c_t = '' or c_p = '' then
      raise exception 'Overall comments on Teaching & Learning and on Lecturer Professionalism are mandatory'; end if;
  end if;

  new_marks := case when cnt = 29 then round(raw * 100 / 145.0, 2) end;
  delete from audit_scores where audit_id = p_audit;
  insert into audit_scores (audit_id, item, score) select p_audit, key::int, value::int from jsonb_each_text(sc);
  delete from facility_scores where audit_id = p_audit;
  insert into facility_scores (audit_id, item, score) select p_audit, key::int, value::int from jsonb_each_text(fac);

  update audits set
    faculty = coalesce(trim(p_form->>'faculty'), ''), program = coalesce(trim(p_form->>'program'), ''),
    course_code = coalesce(trim(p_form->>'course_code'), ''), group_no = coalesce(trim(p_form->>'group_no'), ''),
    method = coalesce(trim(p_form->>'method'), ''), student_count = students,
    comment_teaching = c_t, comment_prof = c_p, comment_other = c_o,
    facility_room = coalesce(trim(p_form->>'facility_room'), ''), facility_suggestion = coalesce(trim(p_form->>'facility_suggestion'), ''),
    session_date = coalesce(sdate, session_date),
    session_time = coalesce(nullif(p_form->>'session_time', ''), session_time),
    raw_score = case when cnt > 0 then raw end, marks = new_marks
  where id = p_audit;

  if p_submit then
    fb := _feedback(c_t, c_p, c_o);
    update audits set feedback = fb, completed_at = now() where id = p_audit;
    select * into ee from profiles where id = a.auditee_id;
    perform _tell(a.auditee_id, 'Feedback from your teaching audit',
      format(E'Dear %s,\n\nFeedback from your auditor:\n\n%s\n\nNote: marks are not disclosed by the auditor. They are announced '
             'officially by the Ketua Pusat Pengajian after approval by the committee.', ee.full_name, fb), 'my-audits');
    if new_marks < s.reaudit_below then
      if a.round_no = 1 then perform _propose_reaudit(p_audit); else perform _alert_low_mark(p_audit); end if;
    end if;
    if new_marks >= cemerlang_min() then perform _alert_cemerlang(p_audit); end if;
  end if;
  return jsonb_build_object('marks', new_marks, 'raw', case when cnt > 0 then raw end, 'complete', cnt = 29, 'submitted', p_submit);
end $$;

-- ---- re-audit: admin names the second auditor, the Head approves ----
create function public.submit_reaudit(p_audit uuid, p_auditor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a audits; s semesters; er profiles; ee profiles;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select * into a from audits where id = p_audit for update;
  if not found or a.round_no <> 2 or a.reaudit_state not in ('proposed','changes_requested') then
    raise exception 'This re-audit is not open for editing'; end if;
  select * into s from semesters where id = a.semester_id;
  if s.state <> 'approved' then raise exception 'The semester is not open'; end if;
  if p_auditor is null or p_auditor = a.auditee_id or not is_active_member(a.semester_id, p_auditor) then
    raise exception 'Choose an active lecturer other than the auditee'; end if;
  if exists (select 1 from audits x where x.semester_id = a.semester_id and x.auditee_id = a.auditee_id
             and x.round_no = 1 and x.auditor_id = p_auditor) then
    raise exception 'The re-audit must be done by a different auditor from the first audit'; end if;
  update audits set auditor_id = p_auditor, origin = 'manual', reaudit_state = 'pending_head', reaudit_comment = '' where id = p_audit;
  select * into er from profiles where id = p_auditor;
  select * into ee from profiles where id = a.auditee_id;
  perform _tell_role('head', format('Approve second auditor for %s (%s)', ee.full_name, s.code),
    format('Re-audit for %s: proposed auditor is %s (%s). Please approve or ask the admin to change it.', ee.full_name, er.full_name, er.grade),
    'semester:' || s.id);
end $$;

create function public.decide_reaudit(p_audit uuid, p_approve boolean, p_comment text default '') returns void
language plpgsql security definer set search_path = public as $$
declare a audits; s semesters; ee profiles; er profiles;
begin
  if not is_head() then raise exception 'Not allowed'; end if;
  select * into a from audits where id = p_audit for update;
  if not found or a.reaudit_state <> 'pending_head' or a.auditor_id is null then
    raise exception 'This re-audit is not awaiting approval'; end if;
  select * into s from semesters where id = a.semester_id;
  select * into ee from profiles where id = a.auditee_id;
  select * into er from profiles where id = a.auditor_id;
  if p_approve then
    update audits set reaudit_state = 'approved', reaudit_approved_at = now() where id = p_audit;
    perform _tell(a.auditee_id, format('A second teaching audit is required - %s', s.code),
      format(E'Dear %s,\n\nA second audit is required for you in %s. Your auditor is %s (%s). Please agree on a date and time and enter the session details in the app.',
             ee.full_name, s.code, er.full_name, er.staff_id), 'my-audits');
    perform _tell(a.auditor_id, format('You are assigned a re-audit - %s', s.code),
      format(E'Dear %s,\n\nYou have been assigned to audit %s (%s) in %s. Please agree on a date and time with the auditee and enter the rubric in the app during the session.',
             er.full_name, ee.full_name, ee.staff_id, s.code), 'my-audits');
    perform _tell_role('admin', format('Re-audit approved for %s', ee.full_name),
      format('Auditor: %s. Both parties were told.', er.full_name), 'semester:' || s.id);
  else
    if coalesce(trim(p_comment), '') = '' then raise exception 'Please say what should change'; end if;
    update audits set reaudit_state = 'changes_requested', reaudit_comment = trim(p_comment) where id = p_audit;
    perform _tell_role('admin', format('Head asked to change the second auditor for %s', ee.full_name),
      'Reason: ' || trim(p_comment), 'semester:' || s.id);
  end if;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.save_rubric(uuid, jsonb, boolean), public.submit_reaudit(uuid, uuid),
  public.decide_reaudit(uuid, boolean, text) to authenticated;
