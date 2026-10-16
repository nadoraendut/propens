"""Workflow operations on a semester's audit list."""
import csv
import io
import random
import re
from collections import defaultdict
from datetime import date, datetime, timedelta

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from werkzeug.security import generate_password_hash

from . import logic, rubric
from .db import get_db
from .notify import now, notify, send_email, tell, users_with_role

EDITABLE_STATES = ("draft", "generated", "changes_requested")

COLUMNS = [  # (key, header, accepted header aliases)
    ("staff_id", "Staff ID", ["staffid", "id", "staffno"]),
    ("name", "Staff Name", ["staffname", "name", "nama"]),
    ("grade", "Gred Jawatan", ["gredjawatan", "grade", "gred"]),
    ("bidang", "Bidang", ["bidang", "department", "field"]),
    ("start_date", "Start of Employment", ["startofemployment", "startdate", "tarikhlantikan"]),
    ("campus", "Campus", ["campus", "kampus"]),
    ("status", "Status", ["status"]),
    ("email", "Email", ["email", "emel", "emailaddress"]),
]
REQUIRED = ("staff_id", "name", "grade", "bidang", "start_date")

# Mark bands used in reports (TAS out of 100) -- the indicator table printed on the PRO-PENS form.
BANDS = [(f"{label} ({'<60' if floor == 0 else (str(floor) + '-' + ('100' if floor == 90 else str(floor + 9)))})", floor)
         for floor, label in rubric.INDICATORS]


# ---------------------------------------------------------------- importing
def _norm(h):
    return re.sub(r"[^a-z0-9]", "", str(h or "").lower())


def read_rows(filename, data):
    """Return list of header-keyed dict rows from an .xlsx or .csv upload."""
    if filename.lower().endswith((".xlsx", ".xlsm")):
        ws = load_workbook(io.BytesIO(data), data_only=True).active
        raw = [list(r) for r in ws.iter_rows(values_only=True)]
    elif filename.lower().endswith(".csv"):
        raw = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
    else:
        raise ValueError("Upload an .xlsx or .csv file.")
    raw = [r for r in raw if any(c not in (None, "") for c in r)]
    if not raw:
        raise ValueError("The file is empty.")
    alias = {a: key for key, _h, als in COLUMNS for a in als + [_norm(_h)]}
    cols = {i: alias[_norm(h)] for i, h in enumerate(raw[0]) if _norm(h) in alias}
    missing = [h for k, h, _ in COLUMNS if k in REQUIRED and k not in cols.values()]
    if missing:
        raise ValueError("Missing column(s): " + ", ".join(missing))
    return [{key: (r[i] if i < len(r) else None) for i, key in cols.items()} for r in raw[1:]]


def import_lecturers(semester_id, rows, replace=False):
    """Upsert lecturers by Staff ID and link them to the semester.

    Returns (imported_count, [error strings]). Bad rows are skipped, good rows kept.
    """
    db = get_db()
    errors, good = [], []
    seen = set()
    for n, row in enumerate(rows, start=2):
        try:
            clean = {k: ("" if row.get(k) is None else str(row.get(k)).strip())
                     for k in ("staff_id", "name", "grade", "bidang", "campus", "status", "email")}
            clean["status"] = clean["status"] or "Active"
            for k in ("staff_id", "name", "grade", "bidang"):
                if not clean[k]:
                    raise ValueError(f"{dict((c[0], c[1]) for c in COLUMNS)[k]} is empty")
            if clean["staff_id"] in seen:
                raise ValueError("duplicate Staff ID in file")
            seen.add(clean["staff_id"])
            clean["start_date"] = logic.parse_date(row.get("start_date"))
            if clean["start_date"] is None:
                raise ValueError("Start of Employment is empty")
            if clean["start_date"] > date.today():
                raise ValueError("Start of Employment is in the future")
            good.append(clean)
        except ValueError as exc:
            errors.append(f"Row {n}: {exc}")
    if replace:
        db.execute("DELETE FROM semester_lecturers WHERE semester_id=?", (semester_id,))
    for c in good:
        db.execute(
            """INSERT INTO lecturers (staff_id,name,grade,bidang,start_date,campus,status,email,password_hash)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(staff_id) DO UPDATE SET name=excluded.name, grade=excluded.grade,
                 bidang=excluded.bidang, start_date=excluded.start_date, campus=excluded.campus,
                 status=excluded.status, email=CASE WHEN excluded.email<>'' THEN excluded.email ELSE email END""",
            (c["staff_id"], c["name"], c["grade"], c["bidang"], c["start_date"].isoformat(),
             c["campus"], c["status"], c["email"], generate_password_hash(c["staff_id"])))
        lid = db.execute("SELECT id FROM lecturers WHERE staff_id=?", (c["staff_id"],)).fetchone()["id"]
        db.execute("INSERT OR IGNORE INTO semester_lecturers VALUES (?,?)", (semester_id, lid))
    db.commit()
    return len(good), errors


def template_workbook():
    wb = Workbook()
    ws = wb.active
    ws.title = "Lecturers"
    ws.append([h for _k, h, _a in COLUMNS])
    ws.append(["A1001", "Dr. Example Name", "DS52", "Computer Science", "2012-03-01",
               "Main Campus", "Active", "example@university.edu"])
    for c in ws[1]:
        c.font = Font(bold=True)
    for col in "ABCDEFGH":
        ws.column_dimensions[col].width = 22
    return wb


# ---------------------------------------------------------------- queries
def semester_lecturers(semester_id):
    return get_db().execute(
        """SELECT l.* FROM lecturers l JOIN semester_lecturers sl ON sl.lecturer_id=l.id
           WHERE sl.semester_id=? ORDER BY l.bidang, l.name""", (semester_id,)).fetchall()


def audit_rows(semester_id):
    return get_db().execute(
        """SELECT a.*, ee.staff_id ee_staff, ee.name ee_name, ee.bidang ee_bidang, ee.campus ee_campus,
                  ee.grade ee_grade, ee.start_date ee_start, ee.email ee_email,
                  er.staff_id er_staff, er.name er_name, er.grade er_grade, er.start_date er_start,
                  er.email er_email
           FROM audits a JOIN lecturers ee ON ee.id=a.auditee_id
           LEFT JOIN lecturers er ON er.id=a.auditor_id
           WHERE a.semester_id=? ORDER BY ee.bidang, ee.name""", (semester_id,)).fetchall()


def rule_statuses(semester_id):
    """{audit_id: 'ok' | 'peer' | 'override' | 'none'} for every audit in the semester.

    ok       auditor outranks the auditee (grade) or is more senior (years)
    peer     nobody outranks the auditee, and the auditor has the same years of service
    override any other manual pick
    none     no auditor yet
    """
    pool = [dict(l) for l in semester_lecturers(semester_id) if logic.is_eligible(l["status"])]
    out = {}
    for a in audit_rows(semester_id):
        if a["auditor_id"] is None:
            out[a["id"]] = "none"
            continue
        ee = {"id": a["auditee_id"], "grade": a["ee_grade"], "start_date": a["ee_start"]}
        er = {"id": a["auditor_id"], "grade": a["er_grade"], "start_date": a["er_start"]}
        if logic.can_audit(er, ee):
            out[a["id"]] = "ok"
        elif logic.is_peer(er, ee) and not any(logic.can_audit(p, ee) for p in pool):
            out[a["id"]] = "peer"
        else:
            out[a["id"]] = "override"
    return out


def department_quota(semester):
    """Per-department required vs selected counts."""
    people = [l for l in semester_lecturers(semester["id"]) if logic.is_eligible(l["status"])]
    by = defaultdict(list)
    for p in people:
        by[p["bidang"]].append(p)
    audits = audit_rows(semester["id"])
    out = []
    for dept in sorted(by):
        sel = [a for a in audits if a["ee_bidang"] == dept]
        need = logic.required_count(len(by[dept]), semester["min_percent"])
        out.append({"dept": dept, "total": len(by[dept]), "required": need,
                    "selected": len(sel), "ok": len(sel) >= need})
    return out


# ---------------------------------------------------------------- workflow
def generate(semester, rng=None, today=None):
    """Select auditees (per-department quota) and auditors. Replaces any existing list."""
    rng = rng or random.Random()
    db = get_db()
    people = [dict(l) for l in semester_lecturers(semester["id"]) if logic.is_eligible(l["status"])]
    if not people:
        raise ValueError("No active lecturers in this semester's list.")
    by = defaultdict(list)
    for p in people:
        by[p["bidang"]].append(p)
    auditees = logic.select_auditees(by, semester["min_percent"], rng)
    pairing = logic.assign_auditors(auditees, people, rng, today)
    db.execute("DELETE FROM audits WHERE semester_id=?", (semester["id"],))
    for a in auditees:
        db.execute("INSERT INTO audits (semester_id,auditee_id,auditor_id,origin) VALUES (?,?,?,'auto')",
                   (semester["id"], a["id"], pairing[a["id"]]))
    db.execute("UPDATE semesters SET state='generated', head_comment='', verified_at=NULL WHERE id=?",
               (semester["id"],))
    unmatched = sum(1 for v in pairing.values() if v is None)
    link = f"/semesters/{semester['id']}"
    for adm in users_with_role("admin"):
        tell(adm, f"Audit list generated for {semester['name']}",
             f"The audit list for {semester['name']} has been generated: {len(auditees)} auditees"
             f"{f', {unmatched} without an eligible auditor' if unmatched else ''}.\n"
             f"Please review and verify it.", link)
    db.commit()
    return len(auditees), unmatched


def submit_to_head(semester):
    """Admin verifies the list and sends it to the Head of Faculty."""
    audits = audit_rows(semester["id"])
    if not audits:
        raise ValueError("The audit list is empty.")
    if not all(d["ok"] for d in department_quota(semester)):
        raise ValueError("Some departments are below the minimum percentage.")
    db = get_db()
    db.execute("UPDATE semesters SET state='pending_head', verified_at=?, head_comment='' WHERE id=?",
               (now(), semester["id"]))
    open_rows = sum(1 for a in audits if a["auditor_id"] is None)
    for head in users_with_role("head"):
        tell(head, f"Audit list for {semester['name']} awaits your approval",
             f"The admin has verified the audit list for {semester['name']}. "
             + (f"{open_rows} auditee(s) have no auditor and need you to pick one. " if open_rows else "")
             + "Please approve it or request changes.", f"/semesters/{semester['id']}")
    db.commit()


def request_changes(semester, comment):
    db = get_db()
    db.execute("UPDATE semesters SET state='changes_requested', head_comment=? WHERE id=?",
               (comment, semester["id"]))
    for adm in users_with_role("admin"):
        tell(adm, f"Head of Faculty requested changes to {semester['name']}",
             f"Requested changes:\n{comment}", f"/semesters/{semester['id']}")
    db.commit()


def approve(semester):
    """Head approves; auditees and auditors are e-mailed."""
    if any(a["auditor_id"] is None for a in audit_rows(semester["id"])):
        raise ValueError("Pick an auditor for every auditee before approving.")
    db = get_db()
    db.execute("UPDATE semesters SET state='approved', approved_at=?, head_comment='' WHERE id=?",
               (now(), semester["id"]))
    audits = audit_rows(semester["id"])
    by_auditor = defaultdict(list)
    for a in audits:
        by_auditor[a["auditor_id"]].append(a)
        ee = db.execute("SELECT * FROM lecturers WHERE id=?", (a["auditee_id"],)).fetchone()
        tell(ee, f"You are scheduled for a teaching audit - {semester['name']}",
             f"Dear {a['ee_name']},\n\nYou have been selected for the teaching audit in {semester['name']}.\n"
             f"Your auditor is {a['er_name']} ({a['er_staff']}).\n\n"
             f"Please agree on a date and time with your auditor, then enter the session details "
             f"in the app so that reminders can be sent.", "/my-audits")
    for auditor_id, items in by_auditor.items():
        er = db.execute("SELECT * FROM lecturers WHERE id=?", (auditor_id,)).fetchone()
        names = "\n".join(f"  - {i['ee_name']} ({i['ee_staff']}, {i['ee_bidang']})" for i in items)
        tell(er, f"You are assigned as an auditor - {semester['name']}",
             f"Dear {er['name']},\n\nYou have been assigned as auditor for {semester['name']}:\n{names}\n\n"
             f"Please agree on a date and time with each auditee. Enter marks and feedback in the "
             f"app during the session.", "/my-audits")
    for adm in users_with_role("admin"):
        tell(adm, f"{semester['name']} approved; invitations sent",
             f"The Head of Faculty approved the list. {len(audits)} auditees and "
             f"{len(by_auditor)} auditors have been notified.", f"/semesters/{semester['id']}")
    db.commit()


def schedule_session(audit, session_date, session_time, venue):
    db = get_db()
    db.execute("UPDATE audits SET session_date=?, session_time=?, venue=?, reminder_sent_at=NULL WHERE id=?",
               (session_date, session_time, venue, audit["id"]))
    if audit["auditor_id"]:
        er = db.execute("SELECT * FROM lecturers WHERE id=?", (audit["auditor_id"],)).fetchone()
        ee = db.execute("SELECT * FROM lecturers WHERE id=?", (audit["auditee_id"],)).fetchone()
        tell(er, f"Audit session set: {ee['name']} on {session_date}",
             f"{ee['name']} has set the audit session for {session_date} {session_time} "
             f"{('at ' + venue) if venue else ''}.", "/my-audits")
    db.commit()


HEADER_FIELDS = ("faculty", "program", "course_code", "group_no", "method")
COMMENT_FIELDS = ("comment_teaching", "comment_prof", "comment_other")


def get_scores(audit_id):
    db = get_db()
    return ({r["item"]: r["score"] for r in db.execute("SELECT item,score FROM audit_scores WHERE audit_id=?", (audit_id,))},
            {r["item"]: r["score"] for r in db.execute("SELECT item,score FROM facility_scores WHERE audit_id=?", (audit_id,))})


def save_rubric(audit, form, submit):
    """Store the auditor's PRO-PENS rubric. With submit=True it is validated and finalised.

    Returns a list of problems (empty on success). Nothing is written if submit fails.
    """
    scores, facility = {}, {}
    for n in rubric.ITEM_NUMBERS:
        v = form.get(f"item_{n}", "")
        if v in ("1", "2", "3", "4", "5"):
            scores[n] = int(v)
    for n in range(1, len(rubric.FACILITY_ITEMS) + 1):
        v = form.get(f"fac_{n}", "")
        if v in ("0", "1", "2", "3", "4", "5"):
            facility[n] = int(v)
    header = {k: form.get(k, "").strip() for k in HEADER_FIELDS}
    comments = {k: form.get(k, "").strip() for k in COMMENT_FIELDS}
    raw_students = form.get("student_count", "").strip()
    problems = []
    students = None
    if raw_students:
        if raw_students.isdigit():
            students = int(raw_students)
        else:
            problems.append("Number of students must be a whole number.")
    if submit:
        missing = [n for n in rubric.ITEM_NUMBERS if n not in scores]
        if missing:
            problems.append("Score every item (missing: " + ", ".join(map(str, missing)) + ").")
        if not comments["comment_teaching"] or not comments["comment_prof"]:
            problems.append("Overall comments on Teaching & Learning and on Lecturer Professionalism are mandatory.")
    if problems:
        return problems

    db = get_db()
    result = rubric.compute(scores)
    db.execute("DELETE FROM audit_scores WHERE audit_id=?", (audit["id"],))
    db.executemany("INSERT INTO audit_scores VALUES (?,?,?)", [(audit["id"], n, v) for n, v in scores.items()])
    db.execute("DELETE FROM facility_scores WHERE audit_id=?", (audit["id"],))
    db.executemany("INSERT INTO facility_scores VALUES (?,?,?)", [(audit["id"], n, v) for n, v in facility.items()])
    sdate = logic.parse_date(form.get("session_date")) if form.get("session_date") else None
    db.execute(
        """UPDATE audits SET faculty=?, program=?, course_code=?, group_no=?, method=?, student_count=?,
           comment_teaching=?, comment_prof=?, comment_other=?, facility_room=?, facility_suggestion=?,
           session_date=COALESCE(?, session_date), session_time=COALESCE(NULLIF(?, ''), session_time),
           raw_score=?, marks=? WHERE id=?""",
        (header["faculty"], header["program"], header["course_code"], header["group_no"], header["method"],
         students, comments["comment_teaching"], comments["comment_prof"], comments["comment_other"],
         form.get("facility_room", "").strip(), form.get("facility_suggestion", "").strip(),
         sdate.isoformat() if sdate else None, form.get("session_time", ""),
         result["raw"] if scores else None, result["tas"] if result["complete"] else None, audit["id"]))
    if submit:
        feedback = "\n\n".join(f"{title}:\n{comments[k]}" for k, title in
                                [("comment_teaching", "Pengajaran dan Pembelajaran"),
                                 ("comment_prof", "Profesionalisme Pensyarah"),
                                 ("comment_other", "Lain-lain Perkara")] if comments[k])
        db.execute("UPDATE audits SET feedback=?, completed_at=? WHERE id=?", (feedback, now(), audit["id"]))
        ee = db.execute("SELECT * FROM lecturers WHERE id=?", (audit["auditee_id"],)).fetchone()
        tell(ee, "Feedback from your teaching audit",
             f"Dear {ee['name']},\n\nFeedback from your auditor:\n\n{feedback}\n\n"
             "Note: marks are not disclosed by the auditor. They are announced officially by the "
             "Ketua Pusat Pengajian after approval by the committee.", "/my-audits")
    db.commit()
    return []


def send_reminders(today=None):
    """Remind both parties on the day before and the day of the session (once per schedule)."""
    today = today or date.today()
    db = get_db()
    due = db.execute(
        """SELECT * FROM audits WHERE session_date IS NOT NULL AND completed_at IS NULL
           AND reminder_sent_at IS NULL AND session_date BETWEEN ? AND ?""",
        (today.isoformat(), (today + timedelta(days=1)).isoformat())).fetchall()
    for a in due:
        when = f"{a['session_date']} {a['session_time'] or ''} {('at ' + a['venue']) if a['venue'] else ''}"
        for lid in (a["auditee_id"], a["auditor_id"]):
            if lid:
                p = db.execute("SELECT * FROM lecturers WHERE id=?", (lid,)).fetchone()
                tell(p, "Reminder: teaching audit session", f"Reminder: audit session on {when}.", "/my-audits")
        db.execute("UPDATE audits SET reminder_sent_at=? WHERE id=?", (now(), a["id"]))
    db.commit()
    return len(due)


# ---------------------------------------------------------------- reports
def _band(marks):
    return next(label for label, floor in BANDS if marks >= floor)


def _avg(vals):
    return round(sum(vals) / len(vals), 2) if vals else None


def report(semester):
    audits = audit_rows(semester["id"])
    done = [a for a in audits if a["completed_at"]]
    scored = [a["marks"] for a in done if a["marks"] is not None]
    by_campus, by_dept = defaultdict(list), defaultdict(list)
    for a in done:
        by_campus[a["ee_campus"] or "-"].append(a["marks"])
        by_dept[a["ee_bidang"]].append(a["marks"])
    load = defaultdict(lambda: [0, 0])
    for a in audits:
        if a["auditor_id"]:
            key = (a["er_staff"], a["er_name"])
            load[key][0] += 1
            load[key][1] += 1 if a["completed_at"] else 0
    bands = {label: 0 for label, _ in BANDS}
    for m in scored:
        bands[_band(m)] += 1
    sec_totals = defaultdict(list)
    for a in done:
        sc, _ = get_scores(a["id"])
        for k, v in rubric.compute(sc)["sections"].items():
            sec_totals[k].append(v)
    sections = [{"key": sec["key"], "title": sec["title"].split(":", 1)[1].strip(), "max": sec["max"],
                 "average": _avg(sec_totals.get(sec["key"], [])),
                 "percent": round(100 * _avg(sec_totals[sec["key"]]) / sec["max"], 1)
                 if sec_totals.get(sec["key"]) else None} for sec in rubric.SECTIONS]
    quota = department_quota(semester)
    for q in quota:
        q["completed"] = sum(1 for a in done if a["ee_bidang"] == q["dept"])
        q["average"] = _avg(by_dept.get(q["dept"], []))
    return {
        "total_lecturers": len(semester_lecturers(semester["id"])),
        "eligible": sum(q["total"] for q in quota),
        "audits": len(audits), "completed": len(done),
        "scheduled": sum(1 for a in audits if a["session_date"] and not a["completed_at"]),
        "not_scheduled": sum(1 for a in audits if not a["session_date"]),
        "average": _avg(scored),
        "highest": max(scored) if scored else None,
        "lowest": min(scored) if scored else None,
        "quota": quota,
        "campus": [{"campus": c, "count": len(v), "average": _avg(v)} for c, v in sorted(by_campus.items())],
        "bands": bands, "sections": sections,
        "workload": [{"staff_id": k[0], "name": k[1], "assigned": v[0], "completed": v[1]}
                     for k, v in sorted(load.items(), key=lambda kv: -kv[1][0])],
        "rule_violations": sum(1 for v in rule_statuses(semester["id"]).values() if v == "override"),
        "peer_pairs": sum(1 for v in rule_statuses(semester["id"]).values() if v == "peer"),
    }


def export_workbook(semester):
    """Marks for all audited lecturers + summary sheets. Feedback is intentionally excluded."""
    audits = audit_rows(semester["id"])
    rep = report(semester)
    wb = Workbook()
    ws = wb.active
    ws.title = "Audit Marks"
    keys = [sec["key"] for sec in rubric.SECTIONS]
    ws.append(["Semester", "Staff ID", "Staff Name", "Gred Jawatan", "Bidang", "Campus",
               "Auditor Staff ID", "Auditor Name", "Session Date", "Session Time", "Venue",
               "Course Code", "Programme", "Group", "No. Students"]
              + [f"{k} (/{sec['max']})" for k, sec in zip(keys, rubric.SECTIONS)]
              + ["Raw Total (/145)", "Total Score TS (/50)", "Marks TAS (/100)", "Indicator", "Status"])
    for a in audits:
        sc, _ = get_scores(a["id"])
        r = rubric.compute(sc)
        done = bool(a["completed_at"])
        ws.append([semester["name"], a["ee_staff"], a["ee_name"], a["ee_grade"], a["ee_bidang"],
                   a["ee_campus"], a["er_staff"], a["er_name"], a["session_date"], a["session_time"],
                   a["venue"], a["course_code"], a["program"], a["group_no"], a["student_count"]]
                  + [r["sections"][k] if done else None for k in keys]
                  + [r["raw"] if done else None, r["ts"] if done else None, a["marks"] if done else None,
                     rubric.indicator(a["marks"]) if done else "",
                     "Completed" if done else ("Scheduled" if a["session_date"] else "Not scheduled")])
    f = wb.create_sheet("Facilities")
    f.append(["Staff ID", "Staff Name", "Room"] + [f"{n}" for n in range(1, len(rubric.FACILITY_ITEMS) + 1)]
             + ["Suggestions"])
    for a in audits:
        if a["completed_at"]:
            _, fs = get_scores(a["id"])
            f.append([a["ee_staff"], a["ee_name"], a["facility_room"]]
                     + [fs.get(n) for n in range(1, len(rubric.FACILITY_ITEMS) + 1)] + [a["facility_suggestion"]])
    s = wb.create_sheet("Summary by Department")
    s.append(["Bidang", "Eligible lecturers", f"Required (min {semester['min_percent']:g}%)",
              "Selected", "Completed", "Average marks"])
    for q in rep["quota"]:
        s.append([q["dept"], q["total"], q["required"], q["selected"], q["completed"], q["average"]])
    c = wb.create_sheet("Summary by Campus")
    c.append(["Campus", "Audits completed", "Average marks"])
    for r in rep["campus"]:
        c.append([r["campus"], r["count"], r["average"]])
    w = wb.create_sheet("Auditor Workload")
    w.append(["Staff ID", "Auditor", "Assigned", "Completed"])
    for r in rep["workload"]:
        w.append([r["staff_id"], r["name"], r["assigned"], r["completed"]])
    sa = wb.create_sheet("Section Averages")
    sa.append(["Section", "Max", "Average", "Average %"])
    for r in rep["sections"]:
        sa.append([f"{r['key']}: {r['title']}", r["max"], r["average"], r["percent"]])
    b = wb.create_sheet("Mark Bands")
    b.append(["Band", "Lecturers"])
    for k, v in rep["bands"].items():
        b.append([k, v])
    fill = PatternFill("solid", fgColor="DDE6F3")
    for sheet in wb.worksheets:
        for cell in sheet[1]:
            cell.font = Font(bold=True)
            cell.fill = fill
            cell.alignment = Alignment(wrap_text=True, vertical="center")
        for col in sheet.columns:
            width = max(len(str(c.value)) if c.value is not None else 0 for c in col)
            sheet.column_dimensions[col[0].column_letter].width = min(max(width + 2, 12), 40)
        sheet.freeze_panes = "A2"
    return wb
