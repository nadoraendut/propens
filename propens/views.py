import io
import random
from functools import wraps

from flask import (Blueprint, abort, flash, g, redirect, render_template, request,
                   send_file, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from . import logic, services
from .db import get_db

bp = Blueprint("main", __name__)


# ------------------------------------------------------------------ helpers
@bp.before_request
def load_user():
    g.user = None
    if session.get("uid"):
        g.user = get_db().execute("SELECT * FROM lecturers WHERE id=?", (session["uid"],)).fetchone()
        if g.user is None:
            session.clear()


def login_required(*roles):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            if g.user is None:
                return redirect(url_for("main.login", next=request.path))
            if roles and g.user["role"] not in roles:
                abort(403)
            return fn(*a, **kw)
        return wrapper
    return deco


def get_semester(sid):
    s = get_db().execute("SELECT * FROM semesters WHERE id=?", (sid,)).fetchone()
    if s is None:
        abort(404)
    return s


def get_audit(aid):
    a = get_db().execute("SELECT * FROM audits WHERE id=?", (aid,)).fetchone()
    if a is None:
        abort(404)
    return a


def require_editable(sem):
    if sem["state"] not in services.EDITABLE_STATES:
        flash("This list is locked in its current state.", "error")
        return False
    return True


def back(sid):
    return redirect(url_for("main.semester", sid=sid))


# --------------------------------------------------------------------- auth
@bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        u = get_db().execute("SELECT * FROM lecturers WHERE staff_id=?",
                             (request.form["staff_id"].strip(),)).fetchone()
        if u and check_password_hash(u["password_hash"], request.form["password"]):
            session.clear()
            session["uid"], session["role"] = u["id"], u["role"]
            nxt = request.args.get("next", "")
            return redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else url_for("main.home"))
        flash("Wrong Staff ID or password.", "error")
    return render_template("login.html")


@bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return redirect(url_for("main.login"))


@bp.route("/password", methods=["GET", "POST"])
@login_required()
def password():
    if request.method == "POST":
        if not check_password_hash(g.user["password_hash"], request.form["current"]):
            flash("Current password is wrong.", "error")
        elif len(request.form["new"]) < 8:
            flash("New password must be at least 8 characters.", "error")
        else:
            db = get_db()
            db.execute("UPDATE lecturers SET password_hash=? WHERE id=?",
                       (generate_password_hash(request.form["new"]), g.user["id"]))
            db.commit()
            flash("Password changed.", "ok")
            return redirect(url_for("main.home"))
    return render_template("password.html")


# --------------------------------------------------------------- dashboards
@bp.route("/")
@login_required()
def home():
    db = get_db()
    sems = db.execute("SELECT * FROM semesters ORDER BY id DESC").fetchall()
    if g.user["role"] == "lecturer":
        return redirect(url_for("main.my_audits"))
    return render_template("home.html", semesters=sems)


@bp.route("/notifications", methods=["GET", "POST"])
@login_required()
def notifications():
    db = get_db()
    if request.method == "POST":
        db.execute("UPDATE notifications SET is_read=1 WHERE lecturer_id=?", (g.user["id"],))
        db.commit()
        return redirect(url_for("main.notifications"))
    items = db.execute("SELECT * FROM notifications WHERE lecturer_id=? ORDER BY id DESC LIMIT 100",
                       (g.user["id"],)).fetchall()
    return render_template("notifications.html", items=items)


# ------------------------------------------------------------ admin: master
@bp.route("/lecturers")
@login_required("admin")
def lecturers():
    rows = get_db().execute("SELECT * FROM lecturers ORDER BY bidang, name").fetchall()
    return render_template("lecturers.html", rows=rows)


@bp.route("/lecturers/<int:lid>", methods=["GET", "POST"])
@bp.route("/lecturers/new", methods=["GET", "POST"], defaults={"lid": None})
@login_required("admin")
def lecturer_form(lid):
    db = get_db()
    row = db.execute("SELECT * FROM lecturers WHERE id=?", (lid,)).fetchone() if lid else None
    if lid and row is None:
        abort(404)
    if request.method == "POST":
        f = request.form
        try:
            start = logic.parse_date(f["start_date"])
            if start is None:
                raise ValueError("Start of Employment is required")
            vals = [f["staff_id"].strip(), f["name"].strip(), f["grade"].strip(), f["bidang"].strip(),
                    start.isoformat(), f["campus"].strip(), f["status"].strip() or "Active",
                    f["email"].strip(), f["role"]]
            if not all(vals[:5]) or vals[8] not in ("lecturer", "admin", "head"):
                raise ValueError("Staff ID, name, grade, bidang and a valid role are required")
            if row:
                db.execute("""UPDATE lecturers SET staff_id=?,name=?,grade=?,bidang=?,start_date=?,campus=?,
                              status=?,email=?,role=? WHERE id=?""", vals + [lid])
            else:
                db.execute("""INSERT INTO lecturers (staff_id,name,grade,bidang,start_date,campus,status,email,
                              role,password_hash) VALUES (?,?,?,?,?,?,?,?,?,?)""",
                           vals + [generate_password_hash(vals[0])])
            db.commit()
            flash("Lecturer saved." + ("" if row else " Initial password is the Staff ID."), "ok")
            return redirect(url_for("main.lecturers"))
        except Exception as exc:
            db.rollback()
            flash(f"Could not save: {exc}", "error")
    return render_template("lecturer_form.html", row=row)


# -------------------------------------------------------------- semesters
@bp.route("/semesters/new", methods=["GET", "POST"])
@login_required("admin")
def semester_new():
    if request.method == "POST":
        try:
            pct = float(request.form["min_percent"])
            if not 0 < pct <= 100:
                raise ValueError("Percentage must be between 0 and 100")
            name = request.form["name"].strip()
            if not name:
                raise ValueError("Name is required")
            db = get_db()
            cur = db.execute("INSERT INTO semesters (name,min_percent,created_at) VALUES (?,?,?)",
                             (name, pct, services.now()))
            db.commit()
            return back(cur.lastrowid)
        except Exception as exc:
            flash(f"Could not create semester: {exc}", "error")
    return render_template("semester_new.html")


@bp.route("/semesters/<int:sid>")
@login_required("admin", "head")
def semester(sid):
    sem = get_semester(sid)
    audits = services.audit_rows(sid)
    people = services.semester_lecturers(sid)
    audited_ids = {a["auditee_id"] for a in audits}
    return render_template(
        "semester.html", sem=sem, audits=audits, people=people,
        quota=services.department_quota(sem), status=services.rule_statuses(sid),
        editable=g.user["role"] == "admin" and sem["state"] in services.EDITABLE_STATES,
        candidates=[p for p in people if logic.is_eligible(p["status"]) and p["id"] not in audited_ids],
        pool=[p for p in people if logic.is_eligible(p["status"])])


@bp.route("/semesters/<int:sid>/upload", methods=["POST"])
@login_required("admin")
def upload(sid):
    sem = get_semester(sid)
    if not require_editable(sem):
        return back(sid)
    f = request.files.get("file")
    if not f or not f.filename:
        flash("Choose a file first.", "error")
        return back(sid)
    try:
        rows = services.read_rows(f.filename, f.read())
        n, errors = services.import_lecturers(sid, rows, replace=bool(request.form.get("replace")))
        flash(f"Imported {n} lecturer(s)." + (" Regenerate the audit list to include them." if n else ""), "ok")
        for e in errors[:20]:
            flash(e, "error")
        if len(errors) > 20:
            flash(f"...and {len(errors) - 20} more row errors.", "error")
    except Exception as exc:
        flash(f"Upload failed: {exc}", "error")
    return back(sid)


@bp.route("/lecturers/template.xlsx")
@login_required("admin")
def template():
    buf = io.BytesIO()
    services.template_workbook().save(buf)
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="lecturer_template.xlsx")


@bp.route("/semesters/<int:sid>/generate", methods=["POST"])
@login_required("admin")
def generate(sid):
    sem = get_semester(sid)
    if not require_editable(sem):
        return back(sid)
    try:
        n, un = services.generate(sem, random.SystemRandom())
        flash(f"Generated {n} auditees." + (f" {un} have no eligible auditor - assign manually." if un else ""),
              "warn" if un else "ok")
    except ValueError as exc:
        flash(str(exc), "error")
    return back(sid)


@bp.route("/semesters/<int:sid>/verify", methods=["POST"])
@login_required("admin")
def verify(sid):
    sem = get_semester(sid)
    if not require_editable(sem) or sem["state"] == "draft":
        flash("Generate the list first." if sem["state"] == "draft" else "", "error")
        return back(sid)
    try:
        services.submit_to_head(sem)
        flash("List verified and sent to the Head of Faculty.", "ok")
    except ValueError as exc:
        flash(str(exc), "error")
    return back(sid)


@bp.route("/semesters/<int:sid>/decision", methods=["POST"])
@login_required("head")
def decision(sid):
    sem = get_semester(sid)
    if sem["state"] != "pending_head":
        flash("This list is not awaiting approval.", "error")
        return back(sid)
    if request.form.get("action") == "approve":
        try:
            services.approve(sem)
            flash("Approved. Auditees and auditors have been e-mailed.", "ok")
        except ValueError as exc:
            flash(str(exc), "error")
    else:
        comment = request.form.get("comment", "").strip()
        if not comment:
            flash("Please say what should change.", "error")
        else:
            services.request_changes(sem, comment)
            flash("Changes requested. The admin has been alerted.", "ok")
    return back(sid)


@bp.route("/semesters/<int:sid>/close", methods=["POST"])
@login_required("admin")
def close(sid):
    sem = get_semester(sid)
    if sem["state"] == "approved":
        db = get_db()
        db.execute("UPDATE semesters SET state='closed' WHERE id=?", (sid,))
        db.commit()
    return back(sid)


# ----------------------------------------------- admin: edit generated list
@bp.route("/semesters/<int:sid>/audits/add", methods=["POST"])
@login_required("admin")
def audit_add(sid):
    sem = get_semester(sid)
    if not require_editable(sem):
        return back(sid)
    db = get_db()
    try:
        auditor = request.form.get("auditor_id") or None
        db.execute("INSERT INTO audits (semester_id,auditee_id,auditor_id,origin) VALUES (?,?,?,'manual')",
                   (sid, int(request.form["auditee_id"]), int(auditor) if auditor else None))
        db.commit()
        warn_if_invalid(sid, int(request.form["auditee_id"]))
    except Exception as exc:
        db.rollback()
        flash(f"Could not add: {exc}", "error")
    return back(sid)


@bp.route("/audits/<int:aid>/edit", methods=["POST"])
@login_required("admin")
def audit_edit(aid):
    audit = get_audit(aid)
    sem = get_semester(audit["semester_id"])
    if not require_editable(sem):
        return back(sem["id"])
    auditor = request.form.get("auditor_id") or None
    db = get_db()
    db.execute("UPDATE audits SET auditor_id=?, origin='manual' WHERE id=?",
               (int(auditor) if auditor else None, aid))
    db.commit()
    warn_if_invalid(sem["id"], audit["auditee_id"])
    return back(sem["id"])


@bp.route("/audits/<int:aid>/delete", methods=["POST"])
@login_required("admin")
def audit_delete(aid):
    audit = get_audit(aid)
    sem = get_semester(audit["semester_id"])
    if require_editable(sem):
        db = get_db()
        db.execute("DELETE FROM audits WHERE id=?", (aid,))
        db.commit()
        flash("Removed. Check the department quota before verifying.", "ok")
    return back(sem["id"])


@bp.route("/audits/<int:aid>/head-assign", methods=["POST"])
@login_required("head")
def head_assign(aid):
    """Head picks an auditor for a row the app could not fill (e.g. the most senior lecturer)."""
    audit = get_audit(aid)
    sem = get_semester(audit["semester_id"])
    if sem["state"] != "pending_head" or audit["auditor_id"] is not None:
        flash("Only rows without an auditor can be assigned while awaiting approval.", "error")
        return back(sem["id"])
    pick = request.form.get("auditor_id")
    ok = pick and get_db().execute(
        """SELECT 1 FROM semester_lecturers sl JOIN lecturers l ON l.id=sl.lecturer_id
           WHERE sl.semester_id=? AND l.id=? AND lower(l.status)='active' AND l.id<>?""",
        (sem["id"], pick, audit["auditee_id"])).fetchone()
    if not ok:
        flash("Choose an active lecturer from the list.", "error")
    else:
        db = get_db()
        db.execute("UPDATE audits SET auditor_id=?, origin='manual' WHERE id=?", (int(pick), aid))
        db.commit()
        flash("Auditor assigned.", "ok")
    return back(sem["id"])


def warn_if_invalid(sid, auditee_id):
    st = services.rule_statuses(sid)
    a = next(x for x in services.audit_rows(sid) if x["auditee_id"] == auditee_id)
    if a["auditor_id"] and st[a["id"]] == "override":
        flash(f"Warning: {a['er_name']} is neither higher in grade nor more senior than {a['ee_name']}. "
              "Saved as a manual override.", "warn")


# ------------------------------------------------------- lecturer: sessions
@bp.route("/my-audits")
@login_required()
def my_audits():
    db = get_db()
    base = """SELECT a.*, s.name sem, s.state, ee.name ee_name, ee.staff_id ee_staff, ee.bidang ee_bidang,
                     er.name er_name, er.staff_id er_staff
              FROM audits a JOIN semesters s ON s.id=a.semester_id
              JOIN lecturers ee ON ee.id=a.auditee_id LEFT JOIN lecturers er ON er.id=a.auditor_id
              WHERE s.state IN ('approved','closed') AND """
    as_auditee = db.execute(base + "a.auditee_id=? ORDER BY a.id DESC", (g.user["id"],)).fetchall()
    as_auditor = db.execute(base + "a.auditor_id=? ORDER BY a.id DESC", (g.user["id"],)).fetchall()
    return render_template("my_audits.html", as_auditee=as_auditee, as_auditor=as_auditor)


@bp.route("/audits/<int:aid>/schedule", methods=["POST"])
@login_required()
def schedule(aid):
    audit = get_audit(aid)
    if g.user["id"] != audit["auditee_id"] and g.user["role"] != "admin":
        abort(403)
    if audit["completed_at"]:
        flash("This audit is already completed.", "error")
        return redirect(url_for("main.my_audits"))
    try:
        d = logic.parse_date(request.form["session_date"])
        if d is None:
            raise ValueError("Date is required")
        services.schedule_session(audit, d.isoformat(), request.form.get("session_time", ""),
                                  request.form.get("venue", "").strip())
        flash("Session saved. Reminders will be sent to you and your auditor.", "ok")
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("main.my_audits"))


@bp.route("/audits/<int:aid>/score", methods=["POST"])
@login_required()
def score(aid):
    audit = get_audit(aid)
    if g.user["id"] != audit["auditor_id"]:
        abort(403)
    if get_semester(audit["semester_id"])["state"] != "approved" or audit["completed_at"]:
        flash("This audit can no longer be edited.", "error")
        return redirect(url_for("main.my_audits"))
    feedback = request.form.get("feedback", "").strip()
    raw = request.form.get("marks", "").strip()
    try:
        marks = float(raw) if raw else None
        if marks is not None and not 0 <= marks <= 100:
            raise ValueError
    except ValueError:
        flash("Marks must be a number from 0 to 100.", "error")
        return redirect(url_for("main.my_audits"))
    db = get_db()
    if request.form.get("action") == "submit":
        if marks is None or not feedback:
            flash("Enter both marks and feedback to submit.", "error")
            return redirect(url_for("main.my_audits"))
        services.submit_result(audit, marks, feedback)
        flash("Submitted. The auditee received your feedback (not the marks).", "ok")
    else:
        db.execute("UPDATE audits SET marks=?, feedback=? WHERE id=?", (marks, feedback, aid))
        db.commit()
        flash("Draft saved.", "ok")
    return redirect(url_for("main.my_audits"))


# ---------------------------------------------------- reports and exports
@bp.route("/semesters/<int:sid>/report")
@login_required("admin", "head")
def report(sid):
    sem = get_semester(sid)
    return render_template("report.html", sem=sem, r=services.report(sem))


@bp.route("/semesters/<int:sid>/export.xlsx")
@login_required("admin")
def export(sid):
    sem = get_semester(sid)
    buf = io.BytesIO()
    services.export_workbook(sem).save(buf)
    buf.seek(0)
    safe = "".join(c if c.isalnum() else "_" for c in sem["name"])
    return send_file(buf, as_attachment=True, download_name=f"audit_marks_{safe}.xlsx")


@bp.route("/outbox")
@login_required("admin")
def outbox():
    rows = get_db().execute("SELECT * FROM emails ORDER BY id DESC LIMIT 200").fetchall()
    return render_template("outbox.html", rows=rows)


@bp.route("/reminders/run", methods=["POST"])
@login_required("admin")
def run_reminders():
    flash(f"{services.send_reminders()} session(s) reminded.", "ok")
    return redirect(request.referrer or url_for("main.home"))
