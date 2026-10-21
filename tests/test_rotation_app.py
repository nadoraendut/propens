import io
from collections import Counter

from propens import services
from propens.db import get_db
from test_workflow import app, client_for, post, make_csv  # noqa: F401


def test_full_app_rotates_lecturers_across_semesters(app):
    admin = client_for(app, "ADM")
    per_semester = []
    for n in range(1, 6):                                        # CS has 10 active lecturers, quota 20% = 2 -> 5 semesters
        post(admin, "/semesters/new", name=f"Sem {n}", min_percent="20")
        with admin.session_transaction() as s:
            s["csrf"] = "t"
        admin.post(f"/semesters/{n}/upload", content_type="multipart/form-data",
                   data={"csrf": "t", "file": (io.BytesIO(make_csv()), "l.csv")})
        post(admin, f"/semesters/{n}/generate")
        with app.app_context():
            per_semester.append({a["ee_staff"] for a in services.audit_rows(n)})
    cs = [{i for i in sel if int(i[1:]) <= 10} for sel in per_semester]          # S001..S010 are CS
    assert all(len(c) == 2 for c in cs)
    assert len(set().union(*cs)) == 10                                           # all 10 had exactly one turn
    assert not any(a & b for i, a in enumerate(cs) for b in cs[i + 1:])          # no repeats within the cycle
    # the 6th semester starts a new cycle: nobody audited in semester 5 comes straight back
    post(admin, "/semesters/new", name="Sem 6", min_percent="20")
    with admin.session_transaction() as s:
        s["csrf"] = "t"
    admin.post("/semesters/6/upload", content_type="multipart/form-data",
               data={"csrf": "t", "file": (io.BytesIO(make_csv()), "l.csv")})
    post(admin, "/semesters/6/generate")
    with app.app_context():
        sixth = {a["ee_staff"] for a in services.audit_rows(6)}
    assert not ({i for i in sixth if int(i[1:]) <= 10} & cs[4])
    # auditors rotate too: nobody carries the whole load
    with app.app_context():
        load = Counter(a["er_staff"] for n in range(1, 7) for a in services.audit_rows(n))
    assert max(load.values()) <= 6


def test_semester_without_a_generated_list_is_ignored_in_history(app):
    admin = client_for(app, "ADM")
    post(admin, "/semesters/new", name="Empty", min_percent="20")          # never generated
    with app.app_context():
        assert services.history_before(2) == []


def test_full_app_explains_a_damaged_excel_upload(app):
    admin = client_for(app, "ADM")
    post(admin, "/semesters/new", name="S", min_percent="20")
    with admin.session_transaction() as s:
        s["csrf"] = "t"
    r = admin.post("/semesters/1/upload", content_type="multipart/form-data", follow_redirects=True,
                   data={"csrf": "t", "file": (io.BytesIO(b"Staff ID,Staff Name\n1,x\n"), "fake.xlsx")})
    assert r.status_code == 200 and b"Could not read the file as an Excel" in r.data
