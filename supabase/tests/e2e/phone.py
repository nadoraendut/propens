import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
S = OUT
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium")
    ctx = b.new_context(viewport={"width": 390, "height": 800}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page(); page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE); page.fill("input[placeholder='Staff ID or email']", "admin@uitm.test"); page.fill("input[placeholder='Password']", "Admin-pass-1"); page.click("button:has-text('Log in')")
    page.wait_for_selector("text=Hello,"); page.locator("button.link", has_text="20262").click(); page.wait_for_selector("text=Auditees and auditors")
    page.locator("text=Auditees and auditors").first.scroll_into_view_if_needed()
    page.screenshot(path=S + "/p1_phone.png", full_page=False)
    page.evaluate("window.scrollTo(0, document.body.scrollHeight * 0.55)"); page.screenshot(path=S + "/p2_phone.png")
    ow = page.evaluate("document.documentElement.scrollWidth"); print("page width", ow, "viewport 390 -> horizontal overflow:", ow > 392)
    print("errors", errors); b.close()
