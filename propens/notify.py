"""In-app notifications and e-mail.

E-mail is sent over SMTP when SMTP_HOST is configured. Otherwise it is stored
with status 'queued' so the admin can see exactly what would have been sent
(Outbox page) and nothing is silently lost.
"""
import smtplib
from datetime import datetime
from email.message import EmailMessage

from flask import current_app

from .db import get_db


def now():
    return datetime.now().isoformat(timespec="seconds")


def notify(lecturer_id, message, link=""):
    get_db().execute(
        "INSERT INTO notifications (lecturer_id, message, link, created_at) VALUES (?,?,?,?)",
        (lecturer_id, message, link, now()))


def send_email(to_addr, subject, body):
    if not to_addr:
        return
    cfg = current_app.config
    status, error = "queued", ""
    if cfg.get("SMTP_HOST"):
        msg = EmailMessage()
        msg["From"] = cfg["MAIL_FROM"]
        msg["To"] = to_addr
        msg["Subject"] = subject
        msg.set_content(body)
        try:
            with smtplib.SMTP(cfg["SMTP_HOST"], cfg["SMTP_PORT"], timeout=15) as s:
                if cfg.get("SMTP_TLS"):
                    s.starttls()
                if cfg.get("SMTP_USER"):
                    s.login(cfg["SMTP_USER"], cfg["SMTP_PASSWORD"])
                s.send_message(msg)
            status = "sent"
        except Exception as exc:  # keep the workflow going, record the failure
            status, error = "failed", str(exc)
    get_db().execute(
        "INSERT INTO emails (to_addr, subject, body, status, error, created_at) VALUES (?,?,?,?,?,?)",
        (to_addr, subject, body, status, error, now()))


def tell(lecturer, subject, body, link=""):
    """In-app notification + e-mail to one lecturer row."""
    notify(lecturer["id"], subject, link)
    send_email(lecturer["email"], subject, body)


def users_with_role(role):
    return get_db().execute("SELECT * FROM lecturers WHERE role=?", (role,)).fetchall()
