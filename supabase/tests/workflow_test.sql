-- Scenario test: acts as different signed-in users (row level security is really in force).
\set ON_ERROR_STOP on

create function t_as(p_staff text) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('test.uid', coalesce((select id::text from public.profiles where staff_id = p_staff), ''), false);
  if p_staff <> '' then execute 'set role authenticated'; else execute 'set role anon'; end if;
end $$;
create function t_ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'ASSERT FAILED: %', p_msg; end if; end $$;
-- run sql as the current role and require it to fail with a message containing p_expect
create function t_fails(p_sql text, p_expect text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm ilike '%' || p_expect || '%' then return; end if;
    raise exception 'ASSERT FAILED: expected error containing "%" but got "%" for: %', p_expect, sqlerrm, p_sql;
  end;
  raise exception 'ASSERT FAILED: expected an error containing "%" for: %', p_expect, p_sql;
end $$;
create function pid(p_staff text) returns uuid language sql stable security definer as $$ select id from public.profiles where staff_id = p_staff $$;
create function ids(p_staff text[]) returns uuid[] language sql stable security definer as $$ select array_agg(id) from public.profiles where staff_id = any(p_staff) $$;
create function sem_id() returns uuid language sql stable security definer as $$ select id from public.semesters where code = '20262' $$;
create function aud(p_ee text, p_round int default 1) returns uuid language sql stable security definer as
  $$ select id from public.audits where auditee_id = pid(p_ee) and round_no = p_round and semester_id = sem_id() $$;
create function scores_all(v int) returns jsonb language sql immutable as $$ select jsonb_object_agg(i::text, v) from generate_series(1, 29) i $$;
create function form_of(v int) returns jsonb language sql immutable as
  $$ select jsonb_build_object('scores', scores_all(v), 'comments', jsonb_build_object('teaching','Clear delivery.','prof','Punctual.'),
       'course_code','CSC101','student_count','40','facility','{"1":5,"3":0}'::jsonb,'facility_room','BK1') $$;
-- counters that bypass RLS, so a test can check what was sent to OTHER people while acting as someone else
create function n_notif(p_like text, p_staff text default null) returns int language sql stable security definer as
  $$ select count(*)::int from public.notifications where message like p_like and (p_staff is null or lecturer_id = pid(p_staff)) $$;
create function n_mail(p_to text, p_subject_like text, p_body_like text default '%', p_body_not_like text default '') returns int
  language sql stable security definer as
  $$ select count(*)::int from public.email_outbox where to_addr = p_to and subject like p_subject_like and body like p_body_like
       and (p_body_not_like = '' or body not like p_body_not_like) $$;
-- only the test helpers: the real functions keep exactly the grants the migrations gave them
grant execute on function t_as(text), t_ok(boolean, text), t_fails(text, text), pid(text), ids(text[]), sem_id(), aud(text, int),
  scores_all(int), form_of(int), n_notif(text, text), n_mail(text, text, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- users (triggers create the profiles)
reset role;
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
select gen_random_uuid(), lower(s) || '@staff.propens.app', jsonb_build_object('role', r),
       jsonb_build_object('staff_id', s, 'full_name', n, 'grade', g, 'bidang', b, 'start_date', d, 'email', lower(s) || '@u.edu', 'status', st)
from (values
  ('ADM1','Admin One','admin','DS54','Admin','1990-01-01','Active'),
  ('HOF1','Head One','head','DS56','Admin','1985-01-01','Active'),
  ('L1','Lect 1','lecturer','DS45','CS','2012-01-01','Active'), ('L2','Lect 2','lecturer','DS52','CS','2000-01-01','Active'),
  ('L3','Lect 3','lecturer','DS48','CS','2005-01-01','Active'), ('L4','Lect 4','lecturer','DS44','CS','2015-01-01','Active'),
  ('L5','Lect 5','lecturer','DS41','CS','2018-01-01','Study Leave'),
  ('L6','Lect 6','lecturer','DS45','Math','2012-01-01','Active'), ('L7','Lect 7','lecturer','DS52','Math','1999-01-01','Active'),
  ('L8','Lect 8','lecturer','DS50','Math','2001-01-01','Active')
) t(s, n, r, g, b, d, st);
update auth.users set raw_user_meta_data = raw_user_meta_data - 'email' where email like 'l4@%';   -- L4 has no e-mail address
update public.profiles set email = '' where staff_id = 'L4';
select t_ok((select count(*) from public.profiles) = 10, 'profiles created by trigger');
select t_ok((select role from public.profiles where staff_id = 'HOF1') = 'head', 'role comes from app_metadata');

-- ---------------------------------------------------------------- 1. row level security basics
select t_as('');                                         -- not signed in
select t_fails('select * from public.profiles', 'permission denied');
select t_as('L1');
select t_ok((select count(*) from public.profiles) = 1, 'a lecturer sees only their own profile');
select t_ok((select count(*) from public.semesters) = 0, 'a lecturer cannot read semesters');
update public.profiles set role = 'admin' where staff_id = 'L1';   -- RLS hides every row from the update: 0 rows, no error
select t_ok((select role from public.profiles where staff_id = 'L1') = 'lecturer', 'cannot promote self');
select t_fails($$insert into public.semesters (code, min_percent, created_by) values ('20262', 20, pid('L1'))$$, 'row-level security');
select t_fails($$insert into public.notifications (lecturer_id, message) values (pid('L1'), 'x')$$, 'permission denied');
select t_as('ADM1');
select t_ok((select count(*) from public.profiles) = 10, 'admin sees everyone');
select t_as('HOF1');
select t_ok((select count(*) from public.profiles) = 10, 'head sees everyone');

-- ---------------------------------------------------------------- 2. admin builds the semester
select t_as('L1');
select t_fails($$select public.save_generated_list(sem_id(), '[]')$$, 'Not allowed');
select t_as('ADM1');
insert into public.semesters (code, min_percent, created_by) values ('20262', 20, pid('ADM1'));
select t_fails($$insert into public.semesters (code, min_percent, created_by) values ('2026', 20, pid('ADM1'))$$, 'check');
insert into public.semester_lecturers (semester_id, lecturer_id)
  select sem_id(), id from public.profiles where staff_id like 'L%';
select t_ok((select count(*) from public.semester_lecturers) = 8, 'members linked');
select t_as('L1');
select t_fails($$insert into public.semester_lecturers values (sem_id(), pid('L1'))$$, 'row-level security');
select t_as('ADM1');
select t_ok((select count(*) from public.quota_status(sem_id())) = 2, 'quota rows for two bidang');
select t_ok((select required from public.quota_status(sem_id()) where bidang = 'CS') = 1, 'CS: 4 active x 20% = 1 (L5 on study leave is not counted)');
select t_ok((select total from public.quota_status(sem_id()) where bidang = 'CS') = 4, 'inactive lecturers are not counted');
select t_fails($$select public.submit_to_head(sem_id())$$, 'Generate the list first');

-- the draw runs in the browser; here is its result: 3 rows, one without an auditor
select t_fails(format($$select public.save_generated_list(sem_id(), %L)$$,
  jsonb_build_array(jsonb_build_object('auditee_id', pid('L5'), 'auditor_id', pid('L2')))), 'not an active lecturer');   -- L5 on leave
select t_fails(format($$select public.save_generated_list(sem_id(), %L)$$,
  jsonb_build_array(jsonb_build_object('auditee_id', pid('L1'), 'auditor_id', pid('L1')))), 'auditor is not valid');
select t_fails(format($$select public.save_generated_list(sem_id(), %L)$$, '[]'::jsonb), 'empty');
select t_ok(public.save_generated_list(sem_id(), jsonb_build_array(
  jsonb_build_object('auditee_id', pid('L1'), 'auditor_id', pid('L2')),
  jsonb_build_object('auditee_id', pid('L6'), 'auditor_id', pid('L7')),
  jsonb_build_object('auditee_id', pid('L8'), 'auditor_id', null))) = 3, 'list saved');
select t_ok((select state from public.semesters) = 'generated', 'state generated');
select t_ok((select count(*) from public.notifications where lecturer_id = pid('ADM1')) = 1, 'admin alerted');
-- admin edits: remove / add / change auditor
select public.remove_audit(aud('L8'));
select public.add_audit(sem_id(), pid('L8'), null);
select public.set_auditor(aud('L1'), pid('L3'));
select t_ok((select auditor_id from public.audits where auditee_id = pid('L1')) = pid('L3'), 'auditor changed');
select public.set_auditor(aud('L1'), pid('L2'));
select t_fails($$select public.add_audit(sem_id(), pid('L5'), null)$$, 'not an active lecturer');

-- a lecturer cannot see or touch any of this
select t_as('L1');
select t_ok((select count(*) from public.audits) = 0, 'auditee cannot read audits directly');
select t_fails($$update public.audits set marks = 100$$, 'permission denied');
select t_fails($$select public.remove_audit(aud('L1'))$$, 'Not allowed');

-- ---------------------------------------------------------------- 3. verify and the Head
select t_as('ADM1');
select public.submit_to_head(sem_id());
select t_ok((select state from public.semesters) = 'pending_head', 'sent to head');
select t_fails($$select public.remove_audit(aud('L8'))$$, 'cannot be removed');                 -- locked
select t_fails(format($$select public.save_generated_list(sem_id(), %L)$$, '[{}]'::jsonb), 'locked');
select t_as('HOF1');
select t_ok(n_notif('%awaits your approval%','HOF1') = 1, 'head alerted');
select t_fails($$select public.head_decide(sem_id(), true)$$, 'Pick an auditor');               -- L8 has none
select t_fails($$select public.head_assign_auditor(aud('L1'), pid('L3'))$$, 'without an auditor');
select t_fails($$select public.head_assign_auditor(aud('L8'), pid('L8'))$$, 'other than the auditee');
select t_fails($$select public.head_decide(sem_id(), false, '')$$, 'say what should change');
select public.head_decide(sem_id(), false, 'Remove L6');
select t_ok((select state from public.semesters) = 'changes_requested', 'sent back');
select t_ok((select head_comment from public.semesters) = 'Remove L6', 'comment kept');
select t_as('ADM1');
select t_ok(n_notif('%requested changes%','ADM1') = 1, 'admin alerted of changes');
select public.submit_to_head(sem_id());
select t_as('HOF1');
select public.head_assign_auditor(aud('L8'), pid('L6'));
select public.head_decide(sem_id(), true);
select t_ok((select state from public.semesters) = 'approved', 'approved');
select t_ok(n_notif('You are scheduled for a teaching audit%') = 3, '3 auditees told');
select t_ok(n_notif('You are assigned as an auditor%') = 3, '3 auditors told (L2, L7, L6)');
select t_ok(n_mail('l1@u.edu','You are scheduled%') = 1, 'e-mail queued for L1');
select t_fails($$select public.head_decide(sem_id(), true)$$, 'not awaiting');

-- ---------------------------------------------------------------- 4. sessions
select t_as('L1');
select t_ok(jsonb_array_length(public.my_audits()) = 1, 'L1 sees one audit as auditee');
select t_ok((public.my_audits()->0->>'auditor_name') = 'Lect 2', 'sees the auditor name');
select t_ok((public.my_audits()->0->'result') = 'null'::jsonb and (public.my_audits()->0->>'completed') = 'false', 'no result yet');
select t_fails($$select public.schedule_session(aud('L6'), current_date, '10:00', 'x')$$, 'Not allowed');    -- someone else's audit
select public.schedule_session(aud('L1'), current_date + 1, '10:00', 'Room 1');
select t_as('L2');
select t_ok(n_notif('Audit session set%','L2') = 1, 'auditor told of the session');
select t_ok((select count(*) from public.audits) = 1, 'auditor sees only the audit they perform');
select t_ok((select count(*) from public.profiles) = 2, 'auditor sees self and the auditee only');
select t_ok((select count(*) from public.semesters where code = '20262') = 1, 'an auditor can read the semester they audit in');
select t_as('L1');
select t_ok((select count(*) from public.audits) = 0, 'L1 as auditee still cannot read the audit row');
select t_ok((select count(*) from public.semesters) = 0, 'a lecturer who only is audited cannot read semesters');

-- ---------------------------------------------------------------- 5. rubric: validation, draft, submit at exactly 80
select t_as('L2');
select t_fails(format($$select public.save_rubric(aud('L1'), %L)$$, '{"scores":{"1":6}}'::jsonb), 'must be 1 to 5');
select t_fails(format($$select public.save_rubric(aud('L1'), %L)$$, '{"scores":{"30":3}}'::jsonb), 'must be 1 to 5');
select t_fails(format($$select public.save_rubric(aud('L1'), %L)$$, '{"facility":{"1":7}}'::jsonb), 'Facility scores');
select t_fails(format($$select public.save_rubric(aud('L1'), %L)$$, '{"student_count":"abc"}'::jsonb), 'whole number');
select t_ok((public.save_rubric(aud('L1'), '{"scores":{"1":5,"2":3},"faculty":"FSKM"}'::jsonb))->>'complete' = 'false', 'draft saved');
select t_ok((select faculty from public.audits where auditee_id = pid('L1')) = 'FSKM' and (select marks from public.audits where auditee_id = pid('L1')) is null, 'draft: no mark yet');
select t_fails(format($$select public.save_rubric(aud('L1'), %L, true)$$, '{"scores":{"1":5}}'::jsonb), 'Score every item');
select t_fails(format($$select public.save_rubric(aud('L1'), %L, true)$$, jsonb_build_object('scores', scores_all(4))), 'mandatory');
select t_as('L1');
select t_fails(format($$select public.save_rubric(aud('L1'), %L)$$, form_of(4)), 'Not allowed');                   -- the auditee cannot fill it
select t_as('L3');
select t_fails(format($$select public.save_rubric(aud('L1'), %L)$$, form_of(4)), 'Not allowed');                   -- nor a stranger
select t_as('L2');
select t_ok((public.save_rubric(aud('L1'), form_of(4), true))->>'marks' = '80.00', 'all "Baik" = exactly 80');
select t_ok((select count(*) from public.audits where round_no = 2) = 0, '80 does not trigger a re-audit');
select t_ok((select raw_score from public.audits where auditee_id = pid('L1')) = 116, 'raw 116');
select t_fails(format($$select public.save_rubric(aud('L1'), %L)$$, form_of(5)), 'no longer be edited');           -- locked
select t_ok((select count(*) from public.audit_scores where audit_id = aud('L1')) = 29, '29 scores stored');
select t_ok((select count(*) from public.facility_scores where audit_id = aud('L1')) = 2, 'facility scores stored');
-- the auditee: feedback yes, marks and rubric no
select t_as('L1');
select t_ok((public.my_audits()->0->>'feedback') like '%Clear delivery.%', 'auditee gets the comments');
select t_ok((public.my_audits()->0->'result') = 'null'::jsonb, 'but not the result before release');
select t_ok((select count(*) from public.audit_scores) = 0, 'auditee cannot read the rubric scores');
select t_ok(n_mail('l1@u.edu','Feedback%','%Clear delivery.%','%80%') = 1, 'e-mail has the feedback, no mark') ;
-- admin and head can read it
select t_as('HOF1');
select t_ok((select marks from public.audits where auditee_id = pid('L1')) = 80, 'head reads the mark');
select t_ok((select count(*) from public.audit_scores) = 29, 'head reads the rubric');

-- ---------------------------------------------------------------- 6. low mark -> re-audit with Head approval
select t_as('L7');
select t_ok((public.save_rubric(aud('L6'), form_of(2), true))->>'marks' = '40.00', 'all 2 = 40');
select t_as('ADM1');
select t_ok((select reaudit_state from public.audits where auditee_id = pid('L6') and round_no = 2) = 'proposed', 're-audit proposed');
select t_ok((select auditor_id from public.audits where auditee_id = pid('L6') and round_no = 2) is null, 'no auditor yet');
select t_ok(n_notif('Re-audit needed%') = 1, 'admin alerted');
select t_as('HOF1');
select t_ok(n_notif('Low audit result%','HOF1') = 1, 'head alerted');
select t_as('L6');
select t_ok(jsonb_array_length(public.my_audits()) = 1, 'the proposed re-audit is invisible to the auditee');
select t_fails($$select public.schedule_session(aud('L6', 2), current_date, '9:00', '')$$, 'cannot be scheduled');
select t_as('ADM1');
select t_fails($$select public.submit_reaudit(aud('L6', 2), pid('L7'))$$, 'different auditor');          -- same as the first
select t_fails($$select public.submit_reaudit(aud('L6', 2), pid('L6'))$$, 'other than the auditee');
select t_fails($$select public.submit_reaudit(aud('L6', 2), pid('L5'))$$, 'other than the auditee');      -- L5 inactive & not a member in practice
select public.submit_reaudit(aud('L6', 2), pid('L3'));
select t_ok((select reaudit_state from public.audits where id = aud('L6', 2)) = 'pending_head', 'with the head');
select t_fails($$select public.decide_reaudit(aud('L6', 2), true)$$, 'Not allowed');
select t_as('HOF1');
select t_fails($$select public.decide_reaudit(aud('L6', 2), false, '')$$, 'say what should change');
select public.decide_reaudit(aud('L6', 2), false, 'Use someone from Math');
select t_as('ADM1');
select t_ok((select reaudit_comment from public.audits where id = aud('L6', 2)) = 'Use someone from Math', 'reason kept');
select public.submit_reaudit(aud('L6', 2), pid('L8'));
select t_as('L8');
select t_ok((select count(*) from public.audits where round_no = 2) = 0, 'new auditor sees nothing before approval');
select t_as('HOF1');
select public.decide_reaudit(aud('L6', 2), true);
select t_ok(n_mail('l6@u.edu','A second teaching audit%') = 1, 'auditee told after approval');
select t_ok(n_mail('l8@u.edu','You are assigned a re-audit%') = 1, 'new auditor told');
select t_as('L7');
select t_ok((select count(*) from public.audits where round_no = 2) = 0, 'first auditor cannot see the re-audit');
select t_as('L8');
select t_ok((select count(*) from public.audits where round_no = 2) = 1, 'new auditor sees it');
select t_as('L6');
select t_ok((public.my_audits()->0->>'round_no') = '2' and (public.my_audits()->0->>'can_schedule') = 'true', 'auditee sees the re-audit');
select public.schedule_session(aud('L6', 2), current_date, '14:00', 'Lab 2');
select t_as('ADM1');
select t_fails($$select public.close_semester(sem_id())$$, 're-audits');
select t_as('L8');
select t_ok((public.save_rubric(aud('L6', 2), form_of(5), true))->>'marks' = '100.00', 'second mark 100');
select t_as('ADM1');
select t_ok(n_notif('Cemerlang result%','ADM1') = 1, 'admin: Cemerlang');
select t_as('HOF1');
select t_ok(n_notif('Cemerlang result%','HOF1') = 1, 'head: Cemerlang');
select t_as('L6');
select t_ok(n_notif('%Cemerlang%','L6') = 0, 'the lecturer is NOT told before release');
select t_as('ADM1');
select t_ok((select count(*) from public.final_audits where marks = 100) = 1, 'final = the re-audit');
select t_as('L6');
select t_ok((select count(*) from public.final_audits where auditee_id = pid('L6')) = 0, 'the lecturer cannot read their own audit through the view either');

-- ---------------------------------------------------------------- 7. release
select t_as('L6');
select t_fails($$select public.release_marks(sem_id())$$, 'Not allowed');
select t_as('ADM1');
select t_fails($$select public.release_marks(sem_id())$$, 'AJK Induk first');
select public.mark_submitted_ajk(sem_id());
select t_fails($$select public.mark_submitted_ajk(sem_id())$$, 'Already recorded');
select t_fails($$select public.release_marks(sem_id())$$, 'not finished');                          -- L8's audit is unfinished
select t_ok(public.release_marks(sem_id(), true) = 2, 'released to the 2 lecturers with a finished final audit');
select t_fails($$select public.release_marks(sem_id(), true)$$, 'already released');
select t_as('L6');
select t_ok((public.my_audits()->0->>'result')::numeric = 100, 'L6 sees the FINAL mark');
select t_ok((public.my_audits()->1->'result') = 'null'::jsonb, 'but not the first-round mark');
select t_ok(n_notif('Congratulations%','L6') = 1, 'Cemerlang gets the special in-app alert');
select t_ok(n_notif('Your PRO-PENS result%','L6') = 0, 'and not the generic one');
select t_ok(n_mail('l6@u.edu','Your PRO-PENS result%','%','%100%') = 1, 'e-mail without the mark');
select t_as('L1');
select t_ok((public.my_audits()->0->>'result')::numeric = 80, 'L1 sees 80 after release');
select t_ok(n_notif('Your PRO-PENS result%','L1') = 1, 'generic alert');
select t_as('L8');
select t_ok(n_notif('%result%','L8') = 0, 'nothing for lecturers with no finished audit');

-- ---------------------------------------------------------------- 8. admin correction
select t_as('L1');
select t_fails(format($$select public.correct_audit(aud('L1'), %L, %L, 'x')$$, scores_all(5), '{"teaching":"a","prof":"b"}'::jsonb), 'Not allowed');
select t_as('ADM1');
select t_fails(format($$select public.correct_audit(aud('L1'), %L, %L, '')$$, scores_all(5), '{"teaching":"Clear delivery.","prof":"Punctual."}'::jsonb), 'reason');
select t_fails(format($$select public.correct_audit(aud('L1'), %L, %L, 'x')$$, scores_all(4), '{"teaching":"Clear delivery.","prof":"Punctual."}'::jsonb), 'Nothing was changed');
select t_fails(format($$select public.correct_audit(aud('L1'), %L, %L, 'x')$$, '{"1":5}'::jsonb, '{"teaching":"a","prof":"b"}'::jsonb), 'Every item');
select t_fails(format($$select public.correct_audit(aud('L8'), %L, %L, 'x')$$, scores_all(5), '{"teaching":"a","prof":"b"}'::jsonb), 'Only submitted');
select t_ok((public.correct_audit(aud('L1'), scores_all(5), '{"teaching":"Clear delivery.","prof":"Punctual."}'::jsonb, 'Auditor mis-keyed items'))->>'new_marks' = '100.00', 'corrected to 100');
select t_ok((select count(*) from public.audit_corrections where audit_id = aud('L1') and old_marks = 80 and new_marks = 100 and corrected_by = pid('ADM1')) = 1, 'logged');
select t_ok((select changes from public.audit_corrections where audit_id = aud('L1')) like '%Item 1: 4 -> 5%', 'changes listed');
select t_ok(n_notif('Audit corrected%') = 2, 'admin and head told');
select t_ok(n_notif('Congratulations! Your corrected%','L1') = 1, 'lecturer told: corrected, now Cemerlang');
select t_ok(n_notif('%has been updated','L1') = 1, 'lecturer told the result changed');
select t_ok(n_notif('Cemerlang result: Lect 1%','ADM1') = 1, 'Cemerlang alert for the crossing');
select t_as('L1');
select t_ok((public.my_audits()->0->>'result')::numeric = 100, 'lecturer now sees the corrected result');
-- a correction that drops a round-1 mark below the threshold starts a re-audit
select t_as('ADM1');
select public.correct_audit(aud('L1'), scores_all(3), '{"teaching":"Clear delivery.","prof":"Punctual."}'::jsonb, 'Second look');   -- 60
select t_ok((select count(*) from public.audits where auditee_id = pid('L1') and round_no = 2 and reaudit_state = 'proposed') = 1, 're-audit proposed by the correction');
select public.correct_audit(aud('L1'), scores_all(2), '{"teaching":"Clear delivery.","prof":"Punctual."}'::jsonb, 'Third look');   -- still below: no second proposal
select t_ok((select count(*) from public.audits where auditee_id = pid('L1') and round_no = 2) = 1, 'no duplicate proposal');
-- comment-only correction
select public.correct_audit(aud('L1'), scores_all(2), '{"teaching":"Better wording","prof":"Punctual."}'::jsonb, 'Typo');
select t_ok(n_mail('l1@u.edu','Your audit feedback has been updated','%Better wording%') = 1, 'feedback re-sent');

-- ---------------------------------------------------------------- 9. reminders and notifications
select t_as('L8');   -- L8's own audit is still open: schedule it for today (Malaysia time)
select public.schedule_session(aud('L8'), (now() at time zone 'Asia/Kuala_Lumpur')::date, '09:00', 'Lab 3');
select t_as('L3');
select t_fails($$select public.queue_due_reminders()$$, 'permission denied');
reset role; set role service_role;
select t_ok(public.queue_due_reminders() = 1, 'one reminder round: the open audit scheduled for today (finished audits are skipped)');
select t_ok(public.queue_due_reminders() = 0, 'only once');
reset role;
select t_ok(n_notif('Reminder: teaching audit session', 'L8') = 1 and n_notif('Reminder: teaching audit session', 'L6') = 1, 'both parties reminded (auditee L8, auditor L6)');
-- e-mail claiming: only the service role, and a mail is claimed once
select t_as('ADM1');
select t_fails($$select * from public.claim_emails(5)$$, 'permission denied');
reset role; set role service_role;
create temp table claimed1 as select * from public.claim_emails(3);
select t_ok((select count(*) from claimed1) = 3, 'a batch of 3 claimed');
create temp table claimed2 as select * from public.claim_emails(1000);
select t_ok(not exists (select 1 from claimed2 c join claimed1 d on d.id = c.id), 'a second claim never returns a mail that was already claimed');
select t_ok(not exists (select 1 from claimed2 where status <> 'sending'), 'claimed mails are marked sending');
reset role;
select t_ok((select count(*) from public.email_outbox where status = 'queued') = 0, 'nothing is left queued after claiming everything');
select t_ok((select count(*) from public.email_outbox where status = 'sending') = (select count(*) from claimed1) + (select count(*) from claimed2), 'every claimed mail is marked sending');
select t_as('L1');
select t_ok((select count(*) from public.notifications where not is_read) > 0, 'has unread');
select public.mark_notifications_read();
select t_ok((select count(*) from public.notifications where not is_read) = 0, 'all read');
select t_fails($$update public.notifications set message = 'hacked'$$, 'permission denied');
select t_as('ADM1');
select t_ok((select count(*) from public.email_outbox) > 5, 'admin reads the outbox');
select t_as('L1');
select t_ok((select count(*) from public.email_outbox) = 0, 'lecturers cannot read the outbox');
select t_as('ADM1');
select t_ok((select count(*) from public.notifications where lecturer_id <> pid('ADM1')) = 0, 'even the admin reads only their own notifications');
delete from public.semesters where code = '20262';   -- policy: only empty drafts can be deleted, so this removes 0 rows
select t_ok((select count(*) from public.semesters where code = '20262') = 1, 'a semester that has audits cannot be deleted');
reset role;
\echo ALL SQL SCENARIO TESTS PASSED
