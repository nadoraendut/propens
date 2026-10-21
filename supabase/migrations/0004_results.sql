-- Results: the admin records that the results went to AJK Induk, then releases the marks. Until release a lecturer sees no
-- mark. After release the lecturer sees only their FINAL mark (a re-audit replaces the first mark). The admin can also correct
-- a submitted audit (reason required, fully logged). Run after 0003.

create function public.mark_submitted_ajk(p_semester uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s semesters;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select * into s from semesters where id = p_semester for update;
  if not found or s.state not in ('approved','closed') then raise exception 'The audit list must be approved first'; end if;
  if s.submitted_ajk_at is not null then raise exception 'Already recorded as submitted to AJK Induk'; end if;
  update semesters set submitted_ajk_at = now() where id = p_semester;
end $$;

-- latest audit per auditee in a semester (a re-audit replaces the first audit)
create view public.final_audits with (security_invoker = true) as
  select distinct on (semester_id, auditee_id) * from public.audits order by semester_id, auditee_id, round_no desc;

create function public.release_marks(p_semester uuid, p_allow_incomplete boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare s semesters; unfinished int; r record; n int := 0; subj text;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select * into s from semesters where id = p_semester for update;
  if not found then raise exception 'Semester not found'; end if;
  if s.submitted_ajk_at is null then raise exception 'Record the submission to AJK Induk first'; end if;
  if s.released_at is not null then raise exception 'Marks are already released'; end if;
  select count(*) into unfinished from final_audits where semester_id = p_semester and completed_at is null;
  if unfinished > 0 and not p_allow_incomplete then
    raise exception '% audit(s) are not finished. Tick the box to release anyway; those lecturers will see no result.', unfinished; end if;

  update semesters set released_at = now() where id = p_semester;
  subj := format('Your PRO-PENS result for %s is available', s.code);
  for r in select f.auditee_id, f.marks, p.full_name from final_audits f join profiles p on p.id = f.auditee_id
           where f.semester_id = p_semester and f.completed_at is not null and f.marks is not null loop
    if r.marks >= cemerlang_min() then
      perform _notify(r.auditee_id, format('Congratulations! Your PRO-PENS result for %s is Cemerlang (%s and above).', s.code,
                                           trim_scale(cemerlang_min())), 'my-audits');
      perform _email(r.auditee_id, subj, format(E'Dear %s,\n\nYour PRO-PENS result for %s has been released. Log in to My audits to view it.', r.full_name, s.code));
    else
      perform _tell(r.auditee_id, subj, format(E'Dear %s,\n\nYour PRO-PENS result for %s has been released. Log in to My audits to view it.', r.full_name, s.code), 'my-audits');
    end if;
    n := n + 1;
  end loop;
  perform _tell_role('head', format('Marks for %s have been released to lecturers', s.code), '', 'semester:' || p_semester);
  return n;
end $$;

create function public.close_semester(p_semester uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s semesters;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select * into s from semesters where id = p_semester for update;
  if not found or s.state <> 'approved' then raise exception 'Only an approved semester can be closed'; end if;
  if exists (select 1 from audits where semester_id = p_semester and round_no = 2 and completed_at is null) then
    raise exception 'Finish or resolve the re-audits before closing the semester'; end if;
  update semesters set state = 'closed' where id = p_semester;
end $$;

-- Admin corrects item scores and/or comments of a SUBMITTED audit. A reason is mandatory; every correction is logged.
-- p_scores: all 29 items {"1":4,...}; p_comments: {teaching, prof, other}
create function public.correct_audit(p_audit uuid, p_scores jsonb, p_comments jsonb, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a audits; s semesters; ee profiles; er profiles; kv record; raw numeric := 0; cnt int := 0;
  old_marks numeric; new_marks numeric; changes text[] := '{}'; old_item int; n int;
  c_t text := trim(coalesce(p_comments->>'teaching', '')); c_p text := trim(coalesce(p_comments->>'prof', ''));
  c_o text := trim(coalesce(p_comments->>'other', '')); comment_changed boolean := false;
  fb text; notes text := ''; summary text; is_final boolean; below boolean; was_below boolean;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select * into a from audits where id = p_audit for update;
  if not found or a.completed_at is null then raise exception 'Only submitted audits can be corrected'; end if;
  select * into s from semesters where id = a.semester_id;

  for kv in select key, value from jsonb_each_text(coalesce(p_scores, '{}')) loop
    if kv.key !~ '^\d{1,2}$' or kv.key::int not between 1 and 29 or kv.value !~ '^[1-5]$' then
      raise exception 'Every item must have a score from 1 to 5'; end if;
    raw := raw + kv.value::int; cnt := cnt + 1;
  end loop;
  if cnt <> 29 then raise exception 'Every item must have a score from 1 to 5'; end if;
  if c_t = '' or c_p = '' then
    raise exception 'Overall comments on Teaching & Learning and on Lecturer Professionalism are mandatory'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason for the correction is required'; end if;

  for n in 1..29 loop
    select score into old_item from audit_scores where audit_id = p_audit and item = n;
    if old_item is distinct from (p_scores->>n::text)::int then
      changes := changes || format('Item %s: %s -> %s', n, coalesce(old_item::text, '-'), p_scores->>n::text);
    end if;
  end loop;
  if a.comment_teaching <> c_t then changes := array_append(changes, 'Comment changed: teaching'); comment_changed := true; end if;
  if a.comment_prof <> c_p then changes := array_append(changes, 'Comment changed: prof'); comment_changed := true; end if;
  if a.comment_other <> c_o then changes := array_append(changes, 'Comment changed: other'); comment_changed := true; end if;
  if array_length(changes, 1) is null then raise exception 'Nothing was changed'; end if;

  old_marks := a.marks;
  new_marks := round(raw * 100 / 145.0, 2);
  fb := _feedback(c_t, c_p, c_o);
  delete from audit_scores where audit_id = p_audit;
  insert into audit_scores (audit_id, item, score) select p_audit, key::int, value::int from jsonb_each_text(p_scores);
  update audits set comment_teaching = c_t, comment_prof = c_p, comment_other = c_o, feedback = fb,
         raw_score = raw, marks = new_marks where id = p_audit;
  insert into audit_corrections (audit_id, corrected_by, reason, old_marks, new_marks, changes)
  values (p_audit, auth.uid(), trim(p_reason), old_marks, new_marks, array_to_string(changes, '; '));

  select * into ee from profiles where id = a.auditee_id;
  select * into er from profiles where id = a.auditor_id;
  below := new_marks < s.reaudit_below;
  was_below := old_marks is not null and old_marks < s.reaudit_below;
  if below and not was_below then
    if a.round_no = 1 and exists (select 1 from audits where reaudit_of = a.id) then null;
    elsif a.round_no = 1 and s.state <> 'approved' then
      notes := notes || format(E'\nThe corrected mark is now below %s but the semester is closed, so no re-audit was created. Decide manually.', trim_scale(s.reaudit_below));
    elsif a.round_no = 1 then perform _propose_reaudit(p_audit);
    else perform _alert_low_mark(p_audit); end if;
  elsif was_below and not below and a.round_no = 1 and exists (select 1 from audits where reaudit_of = a.id) then
    notes := notes || format(E'\nThe corrected mark is no longer below %s, but a re-audit already exists. Review it and decide whether it is still needed (it was not cancelled).', trim_scale(s.reaudit_below));
  end if;
  if new_marks >= cemerlang_min() and (old_marks is null or old_marks < cemerlang_min()) then perform _alert_cemerlang(p_audit); end if;

  summary := format(E'%s (%s), %s: %s -> %s. Reason: %s\nChanges: %s%s', ee.full_name, ee.staff_id, s.code,
                    trim_scale(old_marks), trim_scale(new_marks), trim(p_reason), array_to_string(changes, '; '), notes);
  perform _tell_role('admin', format('Audit corrected: %s', ee.full_name), summary, 'semester:' || s.id);
  perform _tell_role('head', format('Audit corrected: %s', ee.full_name), summary, 'semester:' || s.id);
  perform _notify(a.auditor_id, format('The admin corrected your audit of %s', ee.full_name), 'my-audits');

  is_final := a.round_no = (select max(round_no) from audits where semester_id = a.semester_id and auditee_id = a.auditee_id);
  if comment_changed then
    perform _tell(a.auditee_id, 'Your audit feedback has been updated',
      format(E'Dear %s,\n\nThe feedback on your audit was corrected:\n\n%s', ee.full_name, fb), 'my-audits');
  end if;
  if s.released_at is not null and is_final and old_marks is distinct from new_marks then
    perform _tell(a.auditee_id, format('Your PRO-PENS result for %s has been updated', s.code),
      format(E'Dear %s,\n\nYour PRO-PENS result for %s was corrected. Log in to My audits to view it.', ee.full_name, s.code), 'my-audits');
    if new_marks >= cemerlang_min() and coalesce(old_marks, 0) < cemerlang_min() then
      perform _notify(a.auditee_id, format('Congratulations! Your corrected PRO-PENS result for %s is Cemerlang (%s and above).', s.code, trim_scale(cemerlang_min())), 'my-audits');
    end if;
  end if;
  return jsonb_build_object('old_marks', old_marks, 'new_marks', new_marks);
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.mark_submitted_ajk(uuid), public.release_marks(uuid, boolean), public.close_semester(uuid),
  public.correct_audit(uuid, jsonb, jsonb, text) to authenticated;
grant select on public.final_audits to authenticated;
