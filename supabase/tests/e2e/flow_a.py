import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
S = OUT
errors = []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: errors.append("CHECK FAILED: " + msg)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium")
    admin = Session(b, "admin", errors); admin.page.on("dialog", lambda d: d.accept())
    admin.login("admin@uitm.test", "Admin-pass-1"); admin.page.wait_for_selector("text=Hello,")

    # ---- lecturers
    admin.page.click("button[role=tab]:has-text('Lecturers')")
    admin.page.set_input_files("input[type=file]", S + "/lecturers.xlsx")
    admin.page.click("button:has-text('Import 19')"); admin.page.wait_for_selector("text=Created 19")

    # ---- semester
    admin.page.click("button[role=tab]:has-text('Semesters')")
    admin.page.fill("input[placeholder^='Semester code']", "20262")
    admin.page.click("button:has-text('Create semester')"); admin.page.wait_for_selector("text=Lecturers in this semester")
    check(sql("select count(*) from semesters where code='20262'") == "1", "semester created")
    admin.page.click("button:has-text('Add all active lecturers')"); admin.page.wait_for_selector("text=Lecturers in this semester (20)")
    check(sql("select count(*) from semester_lecturers") == "20", "20 active lecturers added (the one on study leave is not)")

    # ---- draw
    admin.page.click("button:has-text('Draw')", strict=False) if False else admin.page.locator("button", has_text="Draw").first.click()
    admin.page.wait_for_selector("text=Draft list")
    rows = admin.page.locator("text=Draft list").first.inner_text()
    print("   ", rows)
    admin.shot(S + "/a1_draw.png")
    admin.page.click("button:has-text('Save this list')"); admin.page.wait_for_selector("text=Verify and send to the Head of Faculty")
    n = sql("select count(*) from audits")
    check(int(n) >= 3, f"list saved ({n} audits)")
    check(sql("select state from semesters") == "generated", "state generated")
    # quota per bidang
    q = sql("select p.bidang || ':' || count(*) from audits a join profiles p on p.id=a.auditee_id group by p.bidang order by 1")
    print("   per bidang:", q.replace("\n", " "))
    check(all(int(x.split(':')[1]) >= 1 for x in q.split("\n")), "every Bidang has an auditee")
    admin.shot(S + "/a2_list.png")
    admin.page.click("button:has-text('Verify & send to Head of Faculty')"); admin.page.wait_for_selector("text=With the Head of Faculty for approval")
    check(sql("select state from semesters") == "pending_head", "sent to the Head")

    # ---- Head
    head = Session(b, "head", errors); head.page.on("dialog", lambda d: d.accept())
    head.login("head@uitm.test", "Head-pass-1"); head.page.wait_for_selector("text=Hello,")
    check("1" in sql("select count(*) from notifications where lecturer_id='00000000-0000-0000-0000-0000000000b1'"), "Head was alerted")
    head.page.locator("button.link", has_text="20262").click(); head.page.wait_for_selector("text=Your decision")
    head.shot(S + "/a3_head.png")
    # fill rows that have no auditor
    while head.page.locator("select:has(option:text('Choose…'))").count():
        sel = head.page.locator("select:has(option:text('Choose…'))").first
        sel.select_option(index=1); head.page.locator("button:has-text('Assign')").first.click(); head.page.wait_for_timeout(700)
    head.page.click("button:has-text('Approve list')"); head.page.wait_for_timeout(1500)
    check(sql("select state from semesters") == "approved", "approved by the Head")
    n_notes = sql("select count(*) from notifications where message like 'You are scheduled%'")
    check(n_notes == n, f"every auditee was told ({n_notes})")
    check(int(sql("select count(*) from email_outbox where subject like 'You are scheduled%'")) >= 1, "e-mails queued")
    print("ERRORS:", errors)
    b.close()
