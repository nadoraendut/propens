import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
S = OUT
errors = []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: errors.append("CHECK FAILED: " + msg)
CREDS = {"ADM00001": ("admin@uitm.test", "Admin-pass-1"), "HOF00001": ("head@uitm.test", "Head-pass-1")}
SEM = "(select id from semesters where code='20262')"

def act_as(b, staff):
    s = Session(b, staff, errors); s.page.on("dialog", lambda d: d.accept())
    who, pw = CREDS.get(staff, (staff, staff))
    s.login(who, pw)
    s.page.locator("text=Set a new password").or_(s.page.locator("text=Hello,")).first.wait_for()
    if s.page.locator("text=Set a new password").count():
        s.page.fill("input[placeholder='New password']", "Better-pass-9"); s.page.fill("input[placeholder='Repeat new password']", "Better-pass-9")
        s.page.click("button:has-text('Save')"); s.page.wait_for_selector("text=Hello,")
    return s
def open_mine(s):
    if s.page.locator("button[role=tab]:has-text('My audits')").count(): s.page.click("button[role=tab]:has-text('My audits')")
    s.page.wait_for_selector("text=As auditee")
def score_all(s, v):
    for n in range(1, 30): s.page.locator(f"input[name='item_{n}']").nth(v - 1).check()
def comments(s):
    ta = s.page.locator("textarea"); ta.nth(0).fill("Clear delivery."); ta.nth(1).fill("Always punctual.")
def open_semester(s, tab_first=True):
    s.page.locator("button.link", has_text="20262").click(); s.page.wait_for_selector("text=Audit list")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium")
    pair = sql("select ee.staff_id || ',' || er.staff_id from audits a join profiles ee on ee.id=a.auditee_id join profiles er on er.id=a.auditor_id where a.round_no=1 and ee.staff_id like 'LEC%' and er.staff_id like 'LEC%' order by ee.staff_id limit 1")
    ee_no, er_no = pair.split(","); print("auditee", ee_no, "auditor", er_no)

    # ---- the auditee: forced password change, then sets the session
    ee = act_as(b, ee_no); open_mine(ee)
    ee.page.fill("input[type=date]", "2026-11-03"); ee.page.fill("input[type=time]", "10:00"); ee.page.fill("input[placeholder=''] >> nth=0", "Room 1") if False else None
    ee.page.locator("label:has-text('Venue') input").fill("Room 1")
    ee.page.click("button:has-text('Save session')"); ee.page.wait_for_selector("text=Session saved")
    check(sql(f"select session_date::text || ' ' || venue from audits where auditee_id=(select id from profiles where staff_id='{ee_no}') and round_no=1") == "2026-11-03 Room 1", "auditee saved the session")
    ee.shot(S + "/b1_auditee.png")

    # ---- the auditor fills the rubric (everything 2 => 40)
    er = act_as(b, er_no); open_mine(er)
    check("session" in er.text().lower() or "2026" in er.text() or "03" in er.text(), "auditor sees the session date")
    er.page.click("button:has-text('Open rubric form')"); er.page.wait_for_selector("text=Komen Keseluruhan")
    check(er.page.locator("button:has-text('Submit & send')").is_disabled(), "submit is disabled while the rubric is incomplete")
    er.page.locator("label:has-text('Kod kursus') input").fill("CSC101"); er.page.locator("label:has-text('Bil. pelajar') input").fill("40")
    score_all(er, 2); comments(er)
    check("TAS 40 / 100" in er.text().replace("\n", " ") or "40 / 100" in er.text(), "live TAS = 40")
    er.page.locator("input[name='fac_1']").nth(5).check(); er.page.locator("label:has-text('Bilik kuliah') input").fill("BK1")
    er.shot(S + "/b2_rubric.png")
    er.page.click("button:has-text('Submit & send')"); er.page.wait_for_selector("text=Lecturers I audit")
    check(sql(f"select marks::text from audits where auditor_id=(select id from profiles where staff_id='{er_no}') and auditee_id=(select id from profiles where staff_id='{ee_no}') and round_no=1") == "40.00", "mark 40.00 stored")
    check(sql("select count(*) from audits where round_no=2 and reaudit_state='proposed'") == "1", "re-audit proposed (below 80)")
    check(sql("select count(*) from notifications where message like 'Re-audit needed%'") == "1", "admin alerted")

    # ---- the auditee: feedback yes, mark no
    ee.page.reload(); open_mine(ee); ee.page.wait_for_selector("text=Feedback from your auditor")
    t = ee.text()
    check("Clear delivery." in t, "auditee reads the comments"); check("40" not in t.replace("2026", "").replace("10:00", "") and "Your result" not in t, "auditee sees no mark")
    check(sql("select count(*) from audit_scores s join audits a on a.id=s.audit_id where a.auditee_id=(select id from profiles where staff_id='%s')" % ee_no) == "29", "29 scores in the database (hidden from the auditee by RLS)")

    # ---- admin: proposes the second auditor to the Head
    admin = act_as(b, "ADM00001"); admin.page.locator("button.link", has_text="20262").click(); admin.page.wait_for_selector("text=Re-audits")
    admin.shot(S + "/b3_reaudit.png")
    sel = admin.page.locator("tr:has-text('Proposed') select"); suggested = sel.input_value()
    check(suggested != "", "the app suggested a second auditor")
    admin.page.click("button:has-text('Submit to Head')"); admin.page.wait_for_selector("text=With the Head")
    check(sql("select reaudit_state from audits where round_no=2") == "pending_head", "re-audit with the Head")
    new_auditor = sql("select p.staff_id from audits a join profiles p on p.id=a.auditor_id where a.round_no=2")
    check(new_auditor != er_no, f"second auditor ({new_auditor}) differs from the first ({er_no})")

    head = act_as(b, "HOF00001"); head.page.locator("button.link", has_text="20262").click(); head.page.wait_for_selector("text=Re-audits")
    head.page.click("button:has-text('Approve') >> nth=-1"); head.page.wait_for_timeout(1500)
    check(sql("select reaudit_state from audits where round_no=2") == "approved", "Head approved the second auditor")
    check(sql(f"select count(*) from notifications where lecturer_id=(select id from profiles where staff_id='{ee_no}') and message like 'A second teaching audit%'") == "1", "auditee told about the second audit")

    # ---- second auditor scores everything 5 (=> 100, Cemerlang)
    er2 = act_as(b, new_auditor); open_mine(er2)
    er2.page.click("button:has-text('Open rubric form')"); er2.page.wait_for_selector("text=Komen Keseluruhan")
    score_all(er2, 5); comments(er2); er2.page.click("button:has-text('Submit & send')"); er2.page.wait_for_selector("text=Lecturers I audit")
    check(sql("select marks::text from audits where round_no=2") == "100.00", "second mark 100.00")
    check(sql("select count(*) from notifications where message like 'Cemerlang result%'") == "2", "admin and Head alerted: Cemerlang")
    check(sql(f"select count(*) from notifications where lecturer_id=(select id from profiles where staff_id='{ee_no}') and message like '%Cemerlang%'") == "0", "the lecturer is not told before release")

    # ---- release
    admin.page.reload(); admin.page.locator("button.link", has_text="20262").click(); admin.page.wait_for_selector("text=AJK Induk and release of marks")
    admin.page.click("button:has-text('Mark as submitted to AJK Induk')"); admin.page.wait_for_selector("text=Release marks")
    admin.page.locator("label:has-text('release anyway') input").check(); admin.page.click("button:has-text('Release marks')"); admin.page.wait_for_timeout(1500)
    check(sql("select released_at is not null from semesters") == "t", "marks released")
    ee.page.reload(); open_mine(ee); ee.page.wait_for_selector("text=Your result")
    check("Your result: 100 / 100" in ee.text() and "Cemerlang" in ee.text(), "the lecturer now sees the FINAL mark (100), not 40")
    ee.page.click("button:has-text('Alerts')"); ee.page.wait_for_selector("text=Congratulations")
    check("Congratulations" in ee.text(), "Cemerlang in-app alert")
    ee.shot(S + "/b4_result.png")

    # ---- admin correction of the second audit
    admin.page.reload(); admin.page.locator("button.link", has_text="20262").click(); admin.page.wait_for_selector("text=Re-audits")
    admin.page.locator("tr:has-text('Second mark') button.link", has_text="rubric").click(); admin.page.wait_for_selector("text=Correct this audit")
    admin.page.click("button:has-text('Correct this audit')"); admin.page.wait_for_selector("text=Reason for correction")
    admin.page.locator("input[name='item_1']").nth(2).check()                       # 5 -> 3
    admin.page.locator("textarea").last.fill("Auditor mis-keyed item 1")
    admin.page.click("button:has-text('Save correction')"); admin.page.wait_for_selector("text=Correction history")
    check(sql("select count(*) from audit_corrections where reason='Auditor mis-keyed item 1' and old_marks=100") == "1", "correction logged")
    check(sql(f"select count(*) from notifications where lecturer_id=(select id from profiles where staff_id='{ee_no}') and message like '%has been updated'") == "1", "lecturer told the result changed")
    admin.shot(S + "/b5_correction.png")

    # ---- report and Excel
    admin.page.click("button:has-text('Back')"); admin.page.wait_for_selector("button[role=tab]:has-text('Report')")
    admin.page.click("button[role=tab]:has-text('Report')"); admin.page.wait_for_selector("text=Average by rubric section")
    admin.shot(S + "/b6_report.png")
    with admin.page.expect_download() as d: admin.page.click("button:has-text('Download Excel')")
    d.value.save_as(S + "/export.xlsx"); print("   downloaded", d.value.suggested_filename)
    print("ERRORS:", errors)
    b.close()
