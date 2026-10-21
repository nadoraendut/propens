-- PROPENS schema: lecturers are audited by other lecturers, once or twice a semester, under approvals by an admin and the Head
-- of Faculty. Everyone is a "profile" (a lecturer); role 'admin' / 'head' unlock extra rights.
-- Rules enforced here, not in the browser:
--   * an auditee never reads their marks or the rubric until the admin releases the results (and then only the FINAL mark)
--   * every change to an audit goes through a security-definer function (0002-0005); clients cannot write audits directly
-- Run the files in order: 0001 ... 0005.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'lecturer' check (role in ('lecturer','admin','head')),
  full_name text not null default '',
  staff_id text unique,
  grade text not null default '',           -- Gred Jawatan, e.g. DS52
  bidang text not null default '',          -- field / department
  start_date date,                          -- start of employment
  campus text not null default '',
  status text not null default 'Active',    -- only 'Active' lecturers are audited or audit
  email text not null default '',           -- real address for notices; the login email is a synthetic one
  created_at timestamptz not null default now()
);

create table public.semesters (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^\d{4}[1-9]$'),      -- 20262 = March 2026 (same coding as Jengah)
  min_percent numeric not null check (min_percent > 0 and min_percent <= 100),
  reaudit_below numeric not null default 80 check (reaudit_below > 0 and reaudit_below <= 100),
  state text not null default 'draft'
    check (state in ('draft','generated','pending_head','changes_requested','approved','closed')),
  head_comment text not null default '',
  verified_at timestamptz,
  approved_at timestamptz,
  submitted_ajk_at timestamptz,
  released_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.semester_lecturers (
  semester_id uuid not null references public.semesters(id) on delete cascade,
  lecturer_id uuid not null references public.profiles(id) on delete cascade,
  primary key (semester_id, lecturer_id)
);

create table public.audits (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references public.semesters(id) on delete cascade,
  auditee_id uuid not null references public.profiles(id),
  auditor_id uuid references public.profiles(id),
  origin text not null default 'auto' check (origin in ('auto','manual')),
  round_no int not null default 1 check (round_no in (1,2)),     -- 2 = re-audit after a low mark
  reaudit_of uuid references public.audits(id) on delete set null,
  reaudit_state text not null default ''
    check (reaudit_state in ('','proposed','pending_head','changes_requested','approved')),
  reaudit_comment text not null default '',                      -- the Head's reason when sending a proposal back
  reaudit_approved_at timestamptz,
  session_date date,
  session_time text not null default '',
  venue text not null default '',
  reminder_sent_at timestamptz,
  -- PRO-PENS form header
  faculty text not null default '', program text not null default '', course_code text not null default '',
  group_no text not null default '', student_count int, method text not null default '',
  comment_teaching text not null default '', comment_prof text not null default '', comment_other text not null default '',
  facility_room text not null default '', facility_suggestion text not null default '',
  raw_score numeric,                          -- sum of the 29 items (max 145)
  marks numeric,                              -- TAS = raw x 100 / 145 (out of 100); null until the form is complete
  feedback text not null default '',          -- the comments, as sent to the auditee
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (semester_id, auditee_id, round_no)
);

create table public.audit_scores (            -- rubric items 1-29, score 1-5
  audit_id uuid not null references public.audits(id) on delete cascade,
  item int not null check (item between 1 and 29),
  score int not null check (score between 1 and 5),
  primary key (audit_id, item)
);

create table public.facility_scores (         -- classroom facilities checklist 1-14, score 0-5 (0 = not applicable)
  audit_id uuid not null references public.audits(id) on delete cascade,
  item int not null check (item between 1 and 14),
  score int not null check (score between 0 and 5),
  primary key (audit_id, item)
);

create table public.audit_corrections (       -- audit trail of admin corrections
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  corrected_by uuid not null references public.profiles(id),
  reason text not null,
  old_marks numeric, new_marks numeric,
  changes text not null,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  lecturer_id uuid not null references public.profiles(id) on delete cascade,
  message text not null,
  link text not null default '',              -- e.g. 'semester:<uuid>' or 'my-audits'
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.email_outbox (            -- flushed by the send-outbox Edge Function
  id uuid primary key default gen_random_uuid(),
  to_addr text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  error text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index on public.semester_lecturers (lecturer_id);
create index on public.audits (semester_id);
create index on public.audits (auditee_id);
create index on public.audits (auditor_id);
create index on public.notifications (lecturer_id, is_read);
create index on public.email_outbox (status);

-- ---------- new-user trigger ----------
-- Least privilege: everyone is a plain lecturer unless the (admin-only) app_metadata says otherwise.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, full_name, staff_id, grade, bidang, start_date, campus, status, email)
  values (
    new.id,
    coalesce(new.raw_app_meta_data->>'role', 'lecturer'),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'staff_id', ''),
    coalesce(new.raw_user_meta_data->>'grade', ''),
    coalesce(new.raw_user_meta_data->>'bidang', ''),
    nullif(new.raw_user_meta_data->>'start_date', '')::date,
    coalesce(new.raw_user_meta_data->>'campus', ''),
    coalesce(nullif(new.raw_user_meta_data->>'status', ''), 'Active'),
    coalesce(new.raw_user_meta_data->>'email', '')
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- helpers (security definer avoids policy recursion) ----------
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin') $$;

create function public.is_head() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'head') $$;

create function public.semester_editable(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from semesters where id = sid and state in ('draft','generated','changes_requested')) $$;

-- is this audit one the current user performs, and has it started (approved list; re-audits only once the Head approved)?
create function public.i_audit(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from audits a join semesters s on s.id = a.semester_id
                 where a.id = aid and a.auditor_id = auth.uid() and s.state in ('approved','closed')
                   and (a.round_no = 1 or a.reaudit_state = 'approved')) $$;

-- may the current user (as auditor) see this lecturer's profile?
create function public.i_audit_person(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from audits a join semesters s on s.id = a.semester_id
                 where a.auditee_id = pid and a.auditor_id = auth.uid() and s.state in ('approved','closed')
                   and (a.round_no = 1 or a.reaudit_state = 'approved')) $$;

-- does the current user perform an audit in this semester (so they may read the semester's code and state)?
create function public.i_audit_in_semester(sid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from audits a where a.semester_id = sid and a.auditor_id = auth.uid()) $$;

-- semester membership + eligibility (status Active)
create function public.is_active_member(sid uuid, pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from semester_lecturers sl join profiles p on p.id = sl.lecturer_id
                 where sl.semester_id = sid and sl.lecturer_id = pid and lower(trim(p.status)) = 'active') $$;

-- minimum number to audit in a group of `total` at `pct` percent (rounded up, at least 1 for a non-empty group)
create function public.required_count(total int, pct numeric) returns int
language sql immutable as $$
  select case when total <= 0 or pct <= 0 then 0
              else least(total, greatest(1, ceil(round(total * pct / 100.0, 9))::int)) end $$;

create function public.cemerlang_min() returns numeric language sql immutable as $$ select 90::numeric $$;

-- ---------- internal notification helpers (only called from the functions below) ----------
create function public._notify(p_to uuid, p_message text, p_link text default '') returns void
language sql security definer set search_path = public as $$
  insert into notifications (lecturer_id, message, link) values (p_to, p_message, p_link) $$;

create function public._email(p_to uuid, p_subject text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into email_outbox (to_addr, subject, body)
  select email, p_subject, p_body from profiles where id = p_to and email <> '' $$;

create function public._tell(p_to uuid, p_subject text, p_body text, p_link text default '') returns void
language sql security definer set search_path = public as $$
  select public._notify(p_to, p_subject, p_link), public._email(p_to, p_subject, p_body) $$;

create function public._tell_role(p_role text, p_subject text, p_body text, p_link text default '') returns void
language sql security definer set search_path = public as $$
  select public._tell(id, p_subject, p_body, p_link) from profiles where role = p_role $$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.semesters enable row level security;
alter table public.semester_lecturers enable row level security;
alter table public.audits enable row level security;
alter table public.audit_scores enable row level security;
alter table public.facility_scores enable row level security;
alter table public.audit_corrections enable row level security;
alter table public.notifications enable row level security;
alter table public.email_outbox enable row level security;

-- profiles: everyone reads their own; admin and Head read all; an auditor reads the people they audit.
-- Only the admin edits (no insert/delete from the client: accounts are created by the import-lecturers function).
create policy profiles_self on public.profiles for select using (id = auth.uid());
create policy profiles_staff on public.profiles for select using (public.is_admin() or public.is_head());
create policy profiles_auditor on public.profiles for select using (public.i_audit_person(id));
create policy profiles_admin_update on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

-- semesters: admin and Head read; the admin creates and deletes (empty drafts). All state changes go through functions.
create policy semesters_read on public.semesters for select using (public.is_admin() or public.is_head());
create policy semesters_auditor on public.semesters for select
  using (state in ('approved','closed') and public.i_audit_in_semester(id));
create policy semesters_create on public.semesters for insert
  with check (public.is_admin() and created_by = auth.uid() and state = 'draft');
create policy semesters_delete on public.semesters for delete
  using (public.is_admin() and state = 'draft'
         and not exists (select 1 from audits a where a.semester_id = semesters.id));

create policy members_read on public.semester_lecturers for select using (public.is_admin() or public.is_head());
create policy members_write on public.semester_lecturers for insert
  with check (public.is_admin() and public.semester_editable(semester_id));
create policy members_delete on public.semester_lecturers for delete
  using (public.is_admin() and public.semester_editable(semester_id));

-- audits: read-only from the client. The auditee reads through my_audits() (which hides marks until release).
create policy audits_staff on public.audits for select using (public.is_admin() or public.is_head());
create policy audits_auditor on public.audits for select using (public.i_audit(id));
create policy scores_staff on public.audit_scores for select using (public.is_admin() or public.is_head());
create policy scores_auditor on public.audit_scores for select using (public.i_audit(audit_id));
create policy facility_staff on public.facility_scores for select using (public.is_admin() or public.is_head());
create policy facility_auditor on public.facility_scores for select using (public.i_audit(audit_id));
create policy corrections_staff on public.audit_corrections for select using (public.is_admin() or public.is_head());

create policy notifications_own on public.notifications for select using (lecturer_id = auth.uid());
create policy outbox_admin on public.email_outbox for select using (public.is_admin());

-- ---------- grants ----------
revoke all on all tables in schema public from anon;
grant select on all tables in schema public to authenticated;
grant insert, delete on public.semesters, public.semester_lecturers to authenticated;   -- gated by the policies above
grant update on public.profiles to authenticated;
revoke execute on all functions in schema public from public, anon;
-- helpers that the policies call run as the signed-in user, so they need execute rights
grant execute on function public.is_admin(), public.is_head(), public.semester_editable(uuid), public.i_audit(uuid),
  public.i_audit_person(uuid), public.i_audit_in_semester(uuid), public.is_active_member(uuid, uuid), public.required_count(int, numeric),
  public.cemerlang_min() to authenticated;
