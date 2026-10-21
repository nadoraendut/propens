# Audit Draw (the small Vercel version)

Only the draw: **who is audited, and by whom**, rotated fairly from semester to semester.
The full Audit Planner (approvals, rubric, marks, reports...) stays in this repository for when UiTM provides hosting.

Nothing is stored on the server. There is no database. You upload the lecturer list (and last semester's file),
the app shows the result, you download an Excel file. **That Excel file is next semester's history.**

## Using it each semester
1. Prepare the lecturer list (Staff ID, Staff Name, Gred Jawatan, Bidang, Start of Employment, Campus, Status). A template can be downloaded from the app.
2. **First time only:** if you know who was audited in earlier semesters, list them in the history template (Semester + Staff ID, oldest semester first). Otherwise skip it: the first draw is a random one and every draw after it is rotated.
3. Open the app, upload the lecturer list and (from the second semester on) **last semester's downloaded Excel**.
4. Type the semester name and the minimum %. Optionally list Staff IDs that must not / must be audited this semester.
5. **Draw.** Check the list, press *Draw again* if you want another draw, then **Download Excel** and keep it.

The downloaded workbook has these sheets: *Audit List* (auditees, auditors, why each was chosen), *Departments* (quota check),
*Fairness* (the evidence), *Auditor Workload*, and *Ledger* (the history for next time: do not edit it unless you are correcting a mistake).

## How the giliran works (explain this to colleagues)
* **Auditees.** The minimum percentage is still met in every Bidang. Inside a Bidang, the lecturers who have **waited longest since they were last audited** are chosen first. Lecturers audited last semester go to the back of the queue, so nobody is picked twice until everyone has had a turn. In a Bidang of 12 with a 25% quota, each lecturer is audited once every 4 semesters.
* **Ties are drawn by lot.** Lecturers who have waited equally long are picked at random. The random seed is printed on the page and in the Excel; the same files + settings + seed always give the same list, so the draw can be shown to anyone who asks.
* **New staff** are not rushed to the front: they only count the semesters they were really in the list.
* **Auditors.** Must be higher in grade or more senior (years of service). If nobody qualifies (the most senior person), someone with the same years of service is used, otherwise the row says *HEAD TO PICK*. The load is shared evenly; ties go to people who are not themselves being audited, then to whoever has audited least in the past.
* **Overrides.** *Do not audit* (leave, etc.) and *Must be audited* are available per semester and are shown in the result.

### Things to know
* A Bidang with **one lecturer** must be audited every semester, because every Bidang has to meet the minimum. The app tells you ("picked again right after last semester"). That is the rule, not unfairness; decide as a committee if such Bidang should be handled differently.
* Because rotation is predictable, anyone can work out roughly when their turn comes. That is the point (everyone gets a turn), but if you want more surprise, tell me and I can add a weighted-random mode.
* If you do not have complete history, the first few semesters are less exact. They correct themselves as the ledger grows.

## Put it on Vercel
(I could not deploy it for you: it needs your Vercel account, and I have not been able to test on Vercel itself. The app is tested locally.)

1. Put the code on GitHub and merge it into the branch Vercel will deploy (usually `main`).
2. On vercel.com: **Add New > Project**, import the repository.
3. Settings: **Root Directory** = the repository root (leave default), **Framework Preset** = *Other*, leave build and output settings empty.
4. **Environment Variables:** add `LITE_PASSWORD` with a password only you know. The site then asks for it (any user name, that password). Without it, anyone with the link can use the page.
5. **Deploy.** Open the address Vercel gives you.

`vercel.json` and `api/index.py` already route everything to the app. Uploads are limited to about 4 MB (Vercel's own limit), which is far more than a faculty needs.

### Privacy
Lecturer names, Staff IDs and grades are sent to Vercel's servers while a draw runs. The app does not save or log them, but they do pass through a service hosted outside the university. Please confirm UiTM's data rules allow this. If in doubt, the **Staff Name** column can contain the Staff ID instead of the real name: the draw does not need names.
