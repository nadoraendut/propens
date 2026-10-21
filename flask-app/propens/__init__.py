import os
import secrets
from datetime import date, datetime, timedelta

import click
from flask import Flask, abort, request, session
from werkzeug.security import generate_password_hash

from . import logic, rubric
from .db import close_db, get_db, init_db


def create_app(config=None):
    # PROPENS_DATA_DIR: where the database, secret key and backups live (mount this as a persistent volume).
    app = Flask(__name__, instance_relative_config=True, instance_path=os.environ.get("PROPENS_DATA_DIR") or None)
    os.makedirs(app.instance_path, exist_ok=True)
    app.config.update(
        DATABASE=os.path.join(app.instance_path, "propens.db"),
        SMTP_HOST=os.environ.get("SMTP_HOST", ""),
        SMTP_PORT=int(os.environ.get("SMTP_PORT", "587")),
        SMTP_USER=os.environ.get("SMTP_USER", ""),
        SMTP_PASSWORD=os.environ.get("SMTP_PASSWORD", ""),
        SMTP_TLS=os.environ.get("SMTP_TLS", "1") == "1",
        MAIL_FROM=os.environ.get("MAIL_FROM", "audit@localhost"),
        MAX_CONTENT_LENGTH=5 * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("PROPENS_HTTPS", "0") == "1",   # set to 1 behind HTTPS
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
    )
    key_file = os.path.join(app.instance_path, "secret_key")
    if os.environ.get("SECRET_KEY"):
        app.config["SECRET_KEY"] = os.environ["SECRET_KEY"]
    else:
        if not os.path.exists(key_file):
            with open(key_file, "w") as f:
                f.write(secrets.token_hex(32))
        app.config["SECRET_KEY"] = open(key_file).read().strip()
    if config:
        app.config.update(config)

    app.teardown_appcontext(close_db)

    if os.environ.get("PROPENS_BEHIND_PROXY", "0") == "1":      # trust X-Forwarded-* from the reverse proxy only
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    @app.after_request
    def security_headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "same-origin")
        resp.headers.setdefault("Cache-Control", "no-store")     # pages contain marks: never cache
        return resp

    @app.route("/healthz")
    def healthz():
        get_db().execute("SELECT 1")
        return "ok"

    @app.before_request
    def csrf_protect():
        if request.method == "POST":
            if not session.get("csrf") or request.form.get("csrf") != session["csrf"]:
                abort(400, "Invalid or missing CSRF token")

    @app.context_processor
    def inject():
        if "csrf" not in session:
            session["csrf"] = secrets.token_hex(16)
        unread = 0
        if session.get("uid"):
            unread = get_db().execute(
                "SELECT COUNT(*) c FROM notifications WHERE lecturer_id=? AND is_read=0",
                (session["uid"],)).fetchone()["c"]
        return {"csrf": session["csrf"], "unread": unread, "role": session.get("role")}

    @app.template_filter("years")
    def years_filter(start):
        return logic.years_of_service(start)

    app.template_filter("indicator")(rubric.indicator)

    from . import views
    app.register_blueprint(views.bp)

    with app.app_context():
        init_db()

    @app.cli.command("create-user")
    @click.argument("staff_id")
    @click.argument("name")
    @click.option("--role", type=click.Choice(["admin", "head", "lecturer"]), default="admin")
    @click.option("--email", default="")
    @click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True)
    @click.option("--grade", default="DS52")
    @click.option("--bidang", default="Administration")
    @click.option("--start-date", default=date.today().isoformat())
    def create_user(staff_id, name, role, email, password, grade, bidang, start_date):
        """Create (or update) an admin / head-of-faculty / lecturer account."""
        db = get_db()
        db.execute(
            """INSERT INTO lecturers (staff_id,name,grade,bidang,start_date,email,role,password_hash)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(staff_id) DO UPDATE SET name=excluded.name, role=excluded.role,
                 email=excluded.email, password_hash=excluded.password_hash,
                 must_change_password=0, failed_logins=0, locked_until=NULL""",
            (staff_id, name, grade, bidang, start_date, email, role, generate_password_hash(password)))
        db.commit()
        click.echo(f"{role} {staff_id} saved.")

    @app.cli.command("backup")
    @click.option("--keep", default=30, help="How many recent backups to keep.")
    def backup_cmd(keep):
        """Write a consistent copy of the database to <data dir>/backups and prune old ones."""
        import sqlite3
        folder = os.path.join(app.instance_path, "backups")
        os.makedirs(folder, exist_ok=True)
        dest = os.path.join(folder, datetime.now().strftime("propens-%Y%m%d-%H%M%S.db"))
        src = sqlite3.connect(app.config["DATABASE"])
        dst = sqlite3.connect(dest)
        with dst:
            src.backup(dst)                      # safe while the app is running
        src.close(); dst.close()
        old = sorted(f for f in os.listdir(folder) if f.startswith("propens-") and f.endswith(".db"))[:-keep]
        for f in old:
            os.remove(os.path.join(folder, f))
        click.echo(f"Backup written: {dest} (kept {min(keep, len(os.listdir(folder)))})")

    @app.cli.command("test-email")
    @click.argument("to_addr")
    def test_email_cmd(to_addr):
        """Send a test e-mail to check the SMTP settings."""
        from .notify import send_email
        send_email(to_addr, "Audit Planner test e-mail", "If you can read this, e-mail is configured correctly.")
        row = get_db().execute("SELECT status, error FROM emails ORDER BY id DESC LIMIT 1").fetchone()
        get_db().commit()
        if row["status"] == "sent":
            click.echo(f"Sent to {to_addr}.")
        elif row["status"] == "queued":
            click.echo("SMTP_HOST is not set: the e-mail was only recorded in the Outbox, not sent.")
        else:
            click.echo(f"FAILED: {row['error']}")
            raise SystemExit(1)

    @app.cli.command("send-reminders")
    def send_reminders_cmd():
        """Send reminders for sessions today/tomorrow. Run daily (e.g. cron)."""
        from .services import send_reminders
        click.echo(f"{send_reminders()} session(s) reminded.")

    return app
