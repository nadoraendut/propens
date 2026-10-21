# Browser test against a real Postgres

Not part of `npm test`. It runs the real React app in headless Chromium against a **scratch Postgres 16** with the real
migrations and real row-level security, through **PostgREST** (the same component Supabase uses for its REST API).
Only two Supabase pieces are stood in for, by `shim.mjs`: password sign-in (`/auth/v1`) and the two Edge Functions
(`import-lecturers`, `send-outbox`). So it checks the app <-> database contract, not Supabase Auth or Deno itself.

What it drives (`flow_a.py`, `flow_b.py`): admin imports an .xlsx of lecturers, creates a semester, adds members, draws,
saves, verifies; the Head approves; an auditee changes the first password and sets the session; the auditor fills the rubric
(all 2 = 40) -> a re-audit is proposed; admin submits the second auditor, Head approves; the second auditor scores 100;
admin records AJK Induk and releases; the lecturer sees only the FINAL mark and a Cemerlang alert; admin corrects the audit;
report and Excel download. `phone.py` checks the phone layout.

One-time setup (needs `psql`, Postgres 16 server binaries, node, `pip install playwright`):
1. A running Postgres you can create databases in. Defaults: socket `/tmp`, port `5544`, user `postgres` (override with PGHOST/PGPORT/PGUSER).
2. PostgREST binary at `/var/tmp/pgrst/postgrest` (https://github.com/PostgREST/postgrest/releases, tested with v12.2.3).
3. Chromium for Playwright (`PLAYWRIGHT_BROWSERS_PATH`), executable at `/opt/pw-browsers/chromium` in the cloud sessions.

Run: `bash supabase/tests/e2e/run_all.sh` (screenshots and the downloaded Excel land in `$E2E_OUT`, default `/tmp/propens-e2e`).
The SQL-only scenario test is `supabase/tests/run.sh`.
