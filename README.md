# Propens

PRO-PENS teaching audits for UiTM lecturers: a fair, rotating draw of who is audited and by whom, approval by the Head of Faculty,
the PRO-PENS rubric, results and reports. React + Vite on Supabase (Postgres + Auth + Edge Functions), hosted on Vercel; same stack
and look as Jengah (`nadoraendut/attendly`).

The earlier Flask version (full app, plus a stateless "Audit Draw" for Vercel) is kept, working and tested, in `flask-app/` for
a self-hosted UiTM server. Everything below is the Supabase version.

## Setup

1. Create a Supabase project. Auth: **disable public sign-ups** (also set in `supabase/config.toml`; lecturers are created by the
   import function, never by self-registration). The first password of a lecturer is their Staff ID, so keep the minimum password length at 6.
2. In the SQL editor run `supabase/migrations/0001_init.sql` ... `0005_reminders.sql`, in order.
3. Deploy the Edge Functions (Dashboard > Edge Functions, or `supabase functions deploy <name>`):
   - `import-lecturers` creates lecturer accounts (needs no extra secrets; the service-role key is injected by Supabase).
   - `send-outbox` delivers queued e-mail through [Resend](https://resend.com). Add the secrets `RESEND_API_KEY` and `MAIL_FROM`
     (for example `Propens <audit@yourdomain.edu.my>`; the sending domain must be verified in Resend). Without the key e-mails
     stay "queued" and the admin can still read them in the **E-mail outbox** tab.
4. First admin and Head of Faculty: Dashboard > Authentication > Users > Add user (tick auto-confirm), then promote and fill in:
   ```sql
   update public.profiles set role = 'admin', full_name = 'Dr Name', staff_id = 'A100123', grade = 'DS52', bidang = 'Computer Science',
     start_date = '2012-03-01', campus = 'Melaka', email = 'real.address@uitm.edu.my'
   where id = (select id from auth.users where email = 'admin@example.com');
   -- repeat with role = 'head' for the Head of Faculty
   ```
   Admin and Head are lecturers too: filling in Staff ID, grade, bidang and start date lets them appear in a semester's list.
   They log in with their email; every other lecturer logs in with their Staff ID.
5. Schedule the mail and reminder job: Dashboard > Integrations > Cron > new job, type *Supabase Edge Function*, `send-outbox`,
   every 15 minutes. With the service-role key it also queues the session reminders (day before and day of) before sending.
   (The app also asks `send-outbox` to send right after approvals, results and feedback, so mail does not wait for the schedule.)
6. `cp .env.example .env`, fill in the project URL and the anon key, then `npm install && npm run dev`.
7. Vercel: import the repo (root directory = the repo root), set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for **Production
   and Preview**, deploy `main`. `vercel.json` handles the single-page rewrites. The variables are baked in at build time: redeploy after changing them.

## How it works

- **Roles.** `lecturer` (everyone), `admin` (the committee member who prepares the list), `head` (Head of Faculty). Roles live in
  `profiles.role`; accounts are created by `import-lecturers` (login = Staff ID, first password = Staff ID, forced change on first login).
- **Semester** (code like `20262` = March 2026, `20264` = October 2026): minimum % audited in every Bidang (default 20) and the
  re-audit threshold (default 80). States: draft > generated > pending_head > (changes_requested) > approved > closed.
- **Draw** (runs in the browser, `src/lib/rotation.js`): in every Bidang the quota is filled by the lecturers who have **waited longest
  since they were last audited** (history = earlier semesters in the database); equal waits are drawn by lot with a printed, repeatable
  seed. New staff are not rushed forward. Auditors must be higher in grade (number in Gred Jawatan) **or** have more years of service
  (current year - start year); if nobody outranks an auditee, someone with the same years is used, otherwise the Head picks. The
  load is shared evenly; people who are not themselves audited and who audited least are preferred. The admin can exclude or force lecturers.
- **Workflow.** Admin saves the draw, edits it (change auditor, add, remove), verifies > Head approves or sends back with a comment >
  on approval every auditee and auditor is told (in-app + e-mail) > the auditee enters date/time/venue > reminders > the auditor
  fills the **PRO-PENS rubric** (29 items 1-5, comments, facilities checklist) > only the comments reach the auditee.
- **Marks.** raw = sum of items (max 145); TS = raw x 50/145; TAS = TS x 2 = raw x 100/145 is the audit mark. Bands: below 60 Sangat Lemah,
  60-69 Lemah, 70-79 Memuaskan, 80-89 Baik, 90-100 Cemerlang. Computed in the database (`save_rubric`), shown live in the form.
- **Low marks.** A mark **below** the threshold proposes a re-audit by a different auditor (the app suggests one); the admin submits it,
  the **Head approves**, then the second audit runs. **The second mark replaces the first**; a second low mark is only flagged (no third audit).
- **Cemerlang (90+)** alerts the admin and the Head at once; the lecturer is told only when the marks are released.
- **Release.** The admin records "submitted to AJK Induk" and then releases the marks. Before that a lecturer sees no mark; after it only
  their own final mark. Release with unfinished audits needs an explicit tick.
- **Corrections.** After submission the admin can correct scores and comments with a mandatory reason; every correction is logged and the
  Head, the auditor (and, if released, the lecturer) are told. A correction below the threshold proposes a re-audit; an existing one is never cancelled automatically.
- **Report and Excel.** Per Bidang and campus, mark bands, section averages, auditor workload, Cemerlang list, corrections log. The
  Excel has every round with a "counts as final" column; free-text comments are left out.
- **Security.** All tables have RLS and the client cannot write audits directly: every change goes through a `security definer` function
  that checks the caller and the semester's state. An auditee cannot read `audits`, the rubric or marks (only `my_audits()`, which hides
  marks until release); an auditor sees only the audits they perform; the Head and admin read everything.

## Tests

- `npm test` (run under two time zones, e.g. `TZ=Asia/Kuala_Lumpur`): the rules, rotation, rubric, report and Excel code in `src/lib`.
- `PGHOST=... bash supabase/tests/run.sh`: the migrations plus a scenario test that acts as admin, Head, auditor, auditee and a stranger
  on a scratch Postgres 16 (about 170 assertions, including every "must be refused" case).
- `bash supabase/tests/e2e/run_all.sh`: the real app in headless Chromium against Postgres + PostgREST (see that folder's README).
- `cd flask-app && python -m pytest`: the Flask version.
