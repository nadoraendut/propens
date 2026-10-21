import os
import sqlite3
from datetime import datetime, timedelta

from click.testing import CliRunner

from propens import services
from propens.db import get_db
from test_workflow import app, client_for, post, make_csv  # noqa: F401
import io


def import_lecturers(app, admin):
    post(admin, "/semesters/new", name="S", min_percent="20")
    with admin.session_transaction() as s:
        s["csrf"] = "t"
    admin.post("/semesters/1/upload", content_type="multipart/form-data",
               data={"csrf": "t", "file": (io.BytesIO(make_csv()), "l.csv")})


def raw_login(app, staff_id, pw):
    c = app.test_client()
    c.get("/login")
    with c.session_transaction() as s:
        s["csrf"] = "t"
    return c, c.post("/login", data={"staff_id": staff_id, "password": pw, "csrf": "t"})


def test_new_lecturer_must_change_initial_password(app):
    import_lecturers(app, client_for(app, "ADM"))
    c, r = raw_login(app, "S001", "S001")                       # initial password = Staff ID
    assert r.status_code == 302
    for url in ("/", "/my-audits", "/notifications"):          # everything redirects to the password page
        assert c.get(url).headers["Location"].endswith("/password")
    with c.session_transaction() as s:
        s["csrf"] = "t"
    assert b"at least 8" in c.post("/password", data={"csrf": "t", "current": "S001", "new": "S001"}).data
    assert b"at least 8" in c.post("/password", data={"csrf": "t", "current": "S001", "new": "short"}).data
    r = c.post("/password", data={"csrf": "t", "current": "S001", "new": "a-better-pass-1"}, follow_redirects=True)
    assert r.status_code == 200 and c.get("/my-audits").status_code == 200
    assert raw_login(app, "S001", "S001")[1].status_code == 200          # old password no longer works
    assert raw_login(app, "S001", "a-better-pass-1")[1].status_code == 302


def test_cannot_reuse_long_staff_id_as_password(app):
    admin = client_for(app, "ADM")
    post(admin, "/lecturers/new", staff_id="LECT00001", name="Long", grade="DS45", bidang="CS",
         start_date="2010-01-01", campus="N", status="Active", email="l@u.edu", role="lecturer")
    c, r = raw_login(app, "LECT00001", "LECT00001")
    assert r.status_code == 302 and c.get("/").headers["Location"].endswith("/password")
    with c.session_transaction() as s:
        s["csrf"] = "t"
    assert b"different" in c.post("/password", data={"csrf": "t", "current": "LECT00001", "new": "LECT00001"}).data


def test_lockout_after_repeated_failures(app):
    for _ in range(5):
        assert b"Wrong Staff ID" in raw_login(app, "ADM", "nope")[1].data
    c, r = raw_login(app, "ADM", "pw123456")                    # correct password, but locked
    assert r.status_code == 200 and b"Too many failed attempts" in r.data
    with app.app_context():
        db = get_db()
        db.execute("UPDATE lecturers SET locked_until=? WHERE staff_id='ADM'",
                   ((datetime.now() - timedelta(minutes=1)).isoformat(timespec="seconds"),))
        db.commit()
    assert raw_login(app, "ADM", "pw123456")[1].status_code == 302      # lock expired
    # unknown user gets the same message (no account enumeration)
    assert b"Wrong Staff ID or password" in raw_login(app, "NOBODY", "x")[1].data


def test_security_headers_and_health(app):
    c = app.test_client()
    r = c.get("/healthz")
    assert r.status_code == 200 and r.data == b"ok"
    r = c.get("/login")
    assert r.headers["X-Frame-Options"] == "DENY" and r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["Cache-Control"] == "no-store"
    assert "HttpOnly" in c.get("/login").headers.get("Set-Cookie", "HttpOnly")


def test_backup_command_creates_restorable_copy_and_prunes(app, tmp_path):
    import_lecturers(app, client_for(app, "ADM"))
    runner = app.test_cli_runner()
    for _ in range(3):
        res = runner.invoke(args=["backup", "--keep", "2"])
        assert res.exit_code == 0, res.output
    folder = os.path.join(app.instance_path, "backups")
    files = sorted(os.listdir(folder))
    assert 1 <= len(files) <= 2
    con = sqlite3.connect(os.path.join(folder, files[-1]))
    assert con.execute("SELECT COUNT(*) FROM lecturers").fetchone()[0] >= 20
    con.close()


def test_test_email_command_reports_unconfigured_smtp(app):
    res = app.test_cli_runner().invoke(args=["test-email", "x@u.edu"])
    assert res.exit_code == 0 and "SMTP_HOST is not set" in res.output
    app.config["SMTP_HOST"] = "127.0.0.1"; app.config["SMTP_PORT"] = 1       # nothing listens here
    res = app.test_cli_runner().invoke(args=["test-email", "x@u.edu"])
    assert res.exit_code == 1 and "FAILED" in res.output
