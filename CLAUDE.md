# Propens

PRO-PENS teaching-audit planner for the UiTM Melaka faculty: fair rotating draw of auditees and auditors, Head-of-Faculty approval, the
PRO-PENS rubric, release of marks, reports. React + Vite on Supabase (Postgres, Auth, Edge Functions), hosted on Vercel, in the same
style as `nadoraendut/attendly` (Jengah). `README.md` has setup and the feature details; this file is the short version plus project state.

## Who and why
The owner is the committee member who selects the lecturers to be audited each semester. Complaint to solve: **the same lecturers
keep being selected**. "Giliran" (turn) must feel fair to auditees, auditors and the Head. The AJK Induk's form (Rubrik Pemantauan
Pensyarah, Mac-Ogos 2026) is the source of the rubric; the text in `src/lib/rubricData.js` was generated from the reviewed Flask copy.

## Layout
`src/components/` (`Admin`, `Head`, `MyAudits`, `SemesterView`, `Rubric`, `Notifications`, `admin/*`, `semester/*`), `src/lib/` (pure logic, tested in
`tests/lib.test.js`), `supabase/migrations/0001-0005` (run in order), `supabase/functions/{import-lecturers,send-outbox}`,
`supabase/tests/` (SQL scenario test, `e2e/` browser test), `flask-app/` (the earlier Python version incl. the stateless Vercel "Audit Draw"; self-contained, keep working).

## Decisions to keep (confirmed by the owner)
- Bidang = department; only Status "Active" counts, is drawn or can audit. Quota per Bidang = ceil(active x min%), at least 1.
- Auditor must be **higher grade OR more years of service**; if nobody outranks the auditee, a same-years peer; otherwise the Head picks.
  A manual pick that breaks the rule is allowed but flagged "Override".
- Mark = TAS out of 100 from the 29-item rubric (TS = raw x 50/145, TAS = TS x 2). Per-section "Average Score" lines of the form are
  NOT used. Bands from the form's own table; 90-100 = Cemerlang.
- Re-audit when the final mark is **below** 80 (80 passes; configurable per semester, pending the department's confirmation). The Head approves the second auditor.
  Second mark replaces the first. A second low mark is flagged only (no third audit).
- Auditors never tell marks; the auditee gets only the comments. Marks are released by the admin after the results go to AJK Induk; then the lecturer sees
  the final mark and a Cemerlang lecturer gets an in-app congratulation (not before release). The Head does not approve corrections (only alerted).
- Signature on the form = the auditor's name from the login. Form wording = AJK Induk's, only obvious typos fixed.
- Rotation: longest wait first, ties by lot with a printed seed; forced repeats (a Bidang too small to avoid it, e.g. one lecturer) are shown, not hidden.
- Same look as Jengah (navy hero, floating stat card, tables become cards under 640px). Light theme only. Staff login email `<id>@staff.propens.app`.

## Setup state
Nothing is deployed yet. The owner still has to: create the Supabase project, run migrations 0001-0005, deploy the two functions, create the admin/Head,
set the Resend secrets, schedule the Cron job and connect Vercel (see README). Production branch `main`; work happens on `claude/charming-dirac-mlincy`;
push to `main` only when the owner says so. If a change needs a migration, give the owner the full SQL and its path and have them run it before pushing to `main`.

## Testing (what has and has not been checked)
- Pure logic: `npm test` under two time zones. SQL: `supabase/tests/run.sh` on a scratch Postgres 16 with stubbed `auth` (every refusal path is asserted).
- UI: `supabase/tests/e2e/run_all.sh` drives the real app in headless Chromium against Postgres + PostgREST with the real RLS. Sign-in and the two Edge Functions
  are **stand-ins** (`shim.mjs`), so Supabase Auth, the Deno functions, Resend delivery and Cron are NOT verified. Not tried on a physical phone or on Vercel.

## Still to do
- Try everything on the real Supabase project (login with Staff ID, forced password change, `import-lecturers`, `send-outbox` + Resend, Cron job).
- Confirm with the department: the 80 threshold, and whether lecturers may see the numeric mark after release (now: yes; a band-only view is a small change).
- A Bidang with one lecturer is audited every semester (quota rule); decide whether such Bidang need an exception.
- Past semesters before this app: the draw has no history for them (everyone starts equal). Importing old audit lists would sharpen the rotation.
- Retention/PDPA: staff data and marks live in Supabase (check the region and UiTM rules); no automatic deletion yet.
- Nice to have: printable PDF/Word copy of a completed rubric, weighted-random mode (less predictable rotation), a lecturer-side password reset by the admin.
