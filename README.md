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
7. Auditor completes the **PRO-PENS rubric** (29 items scored 1-5, bilingual, as on the official form), the mandatory overall comments and the classroom-facilities checklist. Only the comments go to the auditee; marks stay with auditor/admin/head (the form's own rule: only the Ketua Pusat Pengajian announces marks).
8. **Low marks (re-audit).** If a lecturer's mark is **below 80** (configurable per semester when it is created), the
   admin and Head are alerted and the app proposes a second auditor (same grade/seniority rule; never the first auditor).
   The admin confirms or changes it and submits it to the **Head, who must approve** (or send it back with a reason).
   Only on approval are the auditee and new auditor e-mailed; the second audit then follows the normal steps.
   **The second mark replaces the first.** A second mark below the threshold is flagged to admin and Head (no third audit).
   A semester cannot be closed while a re-audit is unfinished.
9. **Cemerlang (final mark 90 or more):** admin and Head are alerted (in-app and e-mail) when the audit is submitted; the lecturer is alerted only when the admin releases the marks.
10. **Release of marks.** After the results go to AJK Induk, the admin records "Submitted to AJK Induk" and then presses
    **Release marks** (semester page > Results). Until then lecturers see no mark. On release every lecturer with a finished
    final audit is alerted and sees their own mark and band under My audits; Cemerlang lecturers get a congratulatory in-app
    alert. Releasing with unfinished audits needs an explicit tick; those lecturers see nothing. Release cannot be undone.
11. Admin downloads the Excel (marks + department/campus/workload/band summaries); report page shows the same.

## Rules implemented
* **Quota:** in every department (Bidang), `ceil(active lecturers × min%)`, at least 1, are drawn at random.
  Only lecturers with Status = `Active` are counted, selected, or used as auditors.
* **Auditor:** not the auditee, and **either** a higher Gred Jawatan number **or** more Years of Employment
  (current year − start year). Workload is spread evenly. If nobody qualifies (e.g. the most senior
  person) the row is left without an auditor and the admin must assign one; Verify is blocked until then.
* Manual auditor overrides that break the rule are allowed but flagged ("Override") and counted in the report.
* **Marks:** (only the final total average counts; the form's per-section averages are not used) raw = sum of 29 items (max 145); TS = raw x 50/145 (/50); TAS = TS x 2 (/100). TAS is the audit mark.
  Bands (from the form): <60 Sangat Lemah, 60-69 Lemah, 70-79 Memuaskan, 80-89 Baik, 90-100 Cemerlang.
* **Same-seniority fallback:** if nobody outranks an auditee (e.g. the most senior lecturer), a lecturer with the same
  years of service is used; if there is none, the Head picks the auditor before approving.
* Grade comparison uses the number in the grade (DS45 < DS52). Adjust `logic.grade_rank` if your grade scheme differs.
