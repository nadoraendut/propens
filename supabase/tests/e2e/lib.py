import os, re, subprocess
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("E2E_OUT", "/tmp/propens-e2e")   # screenshots, downloads
os.makedirs(OUT, exist_ok=True)
BASE = "http://127.0.0.1:5173"
PSQL = ["psql", "-h", "/tmp", "-p", "5544", "-U", "postgres", "-d", "propens_e2e", "-At", "-c"]
def sql(q): return subprocess.run(PSQL + [q], capture_output=True, text=True).stdout.strip()
class Session:
    """one browser context = one signed-in user"""
    def __init__(self, browser, name, errors):
        self.ctx = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True)
        self.page = self.ctx.new_page(); self.name = name
        self.page.on("console", lambda m: errors.append(f"[{name}] console: {m.text}") if m.type == "error" and "favicon" not in m.text else None)
        self.page.on("pageerror", lambda e: errors.append(f"[{name}] pageerror: {e}"))
    def login(self, who, pw):
        p = self.page; p.goto(BASE); p.fill("input[placeholder='Staff ID or email']", who); p.fill("input[placeholder='Password']", pw); p.click("button:has-text('Log in')")
    def text(self): return self.page.inner_text("body")
    def shot(self, path): self.page.screenshot(path=path, full_page=True)
