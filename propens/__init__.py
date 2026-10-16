import os
import secrets
from datetime import date

import click
from flask import Flask, abort, request, session
from werkzeug.security import generate_password_hash

from . import logic, rubric
from .db import close_db, get_db, init_db


def create_app(config=None):
    app = Flask(__name__, instance_relative_config=True)
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
                 email=excluded.email, password_hash=excluded.password_hash""",
            (staff_id, name, grade, bidang, start_date, email, role, generate_password_hash(password)))
        db.commit()
        click.echo(f"{role} {staff_id} saved.")

    @app.cli.command("send-reminders")
    def send_reminders_cmd():
        """Send reminders for sessions today/tomorrow. Run daily (e.g. cron)."""
        from .services import send_reminders
        click.echo(f"{send_reminders()} session(s) reminded.")

    return app
