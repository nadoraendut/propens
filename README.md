# propens
Automatic selection of lecturers to be audited each semester, with auditor matching,
two-step approval (Admin → Head of Faculty), e-mail notices, session reminders,
mark entry, Excel export and per-semester reports.

## Run
```
pip install -r requirements.txt
flask --app propens create-user ADMIN001 "Admin Name" --role admin --email admin@uni.edu
flask --app propens create-user HOF001 "Head Name" --role head --email head@uni.edu
flask --app propens run
```
Sign in with Staff ID + password. Lecturers imported from a file get their **Staff ID as the
initial password** (they can change it under their name in the top bar).

Run `flask --app propens send-reminders` once a day (cron) to send session reminders
(sent on the day before and the day of the session). Admins can also press *Send due reminders*.

E-mail: set `SMTP_HOST` (plus `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_TLS`, `MAIL_FROM`).
Without it, e-mails are recorded as "queued" in the admin **Outbox** page instead of being delivered.

Tests: `pytest`

## Workflow
1. Admin creates a semester (name + minimum %), uploads the lecturer list (.xlsx/.csv; template provided).
2. Admin presses **Generate** → auditees and auditors are picked; admin is alerted.
3. Admin reviews/edits (change auditor, add, remove) and presses **Verify** → Head of Faculty is alerted.
4. Head **approves** or **requests changes** (admin is alerted, list unlocks for editing). 
5. On approval, auditees and auditors are e-mailed.
6. Auditee enters date/time/venue → auditor is notified; both get reminders.
7. Auditor enters marks + feedback. Only the feedback goes to the auditee; marks stay with auditor/admin/head.
8. Admin downloads the Excel (marks + department/campus/workload/band summaries); report page shows the same.

## Rules implemented
* **Quota:** in every department (Bidang), `ceil(active lecturers × min%)`, at least 1, are drawn at random.
  Only lecturers with Status = `Active` are counted, selected, or used as auditors.
* **Auditor:** not the auditee, and **either** a higher Gred Jawatan number **or** more Years of Employment
  (current year − start year). Workload is spread evenly. If nobody qualifies (e.g. the most senior
  person) the row is left without an auditor and the admin must assign one; Verify is blocked until then.
* Manual auditor overrides that break the rule are allowed but flagged ("Override") and counted in the report.
* Grade comparison uses the number in the grade (DS45 < DS52). Adjust `logic.grade_rank` if your grade scheme differs.
