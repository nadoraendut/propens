"""Audit Draw: a small, stateless web tool for the fair selection of auditees and auditors.

Nothing is stored on the server (no database, no files, no logging of uploads). Every request
carries what it needs: the lecturer list and the history ledger are uploaded, and the result is
returned as a page and an Excel download. The Ledger sheet of that download is next semester's history.
"""
import hmac
import io
import json
import os
import re
import secrets
from datetime import date

from flask import Flask, Response, render_template, request, send_file

from propens import services

from . import draw, parse

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024          # Vercel rejects bigger request bodies anyway


@app.before_request
def basic_auth():
    """Optional password (set LITE_PASSWORD in Vercel). Any user name is accepted."""
    password = os.environ.get("LITE_PASSWORD")
    if not password:
        return None
    auth = request.authorization
    if auth and hmac.compare_digest((auth.password or "").encode(), password.encode()):
        return None
    return Response("Password required", 401, {"WWW-Authenticate": 'Basic realm="Audit Draw"'})


@app.after_request
def headers(resp):
    resp.headers["Cache-Control"] = "no-store"
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    return resp


def _ids(text):
    return {t for t in re.split(r"[\s,;]+", text or "") if t}


def _settings(form):
    pct = float(form.get("percent") or 0)
    if not 0 < pct <= 100:
        raise ValueError("Minimum percentage must be between 0 and 100.")
    name = (form.get("semester") or "").strip()
    if not name:
        raise ValueError("Give the semester a name.")
    seed = (form.get("seed") or "").strip()
    return {"semester": name, "percent": pct, "seed": int(seed) if seed.isdigit() else secrets.randbelow(10 ** 9),
            "exclude": _ids(form.get("exclude")), "force": _ids(form.get("force"))}


def _inputs(form, files):
    """Either re-use the payload carried by a result page, or read the uploaded files."""
    if form.get("payload"):
        p = json.loads(form["payload"])
        return p["lecturers"], p["ledger"]
    up = files.get("lecturers")
    if not up or not up.filename:
        raise ValueError("Upload the lecturer list.")
    good, errors = services.clean_lecturer_rows(services.read_rows(up.filename, up.read()))
    if errors:
        raise ValueError("Lecturer list problems (nothing was drawn): " + " | ".join(errors[:8])
                         + (f" | ...and {len(errors) - 8} more" if len(errors) > 8 else ""))
    lecturers = [{"staff_id": g["staff_id"], "name": g["name"], "grade": g["grade"], "bidang": g["bidang"],
                  "start_date": g["start_date"].isoformat(), "campus": g["campus"], "status": g["status"]}
                 for g in good]
    ledger = []
    hist = files.get("history")
    if hist and hist.filename:
        ledger = parse.read_ledger(hist.filename, hist.read())
    return lecturers, ledger


@app.route("/")
def index():
    return render_template("index.html", form={}, error=None)


@app.route("/lecturer-template.xlsx")
def lecturer_template():
    buf = io.BytesIO()
    services.template_workbook().save(buf)
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="lecturer_template.xlsx")


@app.route("/history-template.xlsx")
def history_template():
    buf = io.BytesIO()
    draw.ledger_template().save(buf)
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name="history_template.xlsx")


@app.route("/generate", methods=["POST"])
def generate():
    try:
        settings = _settings(request.form)
        lecturers, ledger = _inputs(request.form, request.files)
        result = draw.run_draw(lecturers, ledger, settings, date.today())
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        return render_template("index.html", form=request.form, error=str(exc)), 400
    payload = {"lecturers": lecturers, "ledger": ledger}
    return render_template("result.html", r=result, payload=json.dumps(payload),
                           result_json=json.dumps(result), form=request.form)


@app.route("/download", methods=["POST"])
def download():
    try:
        result = json.loads(request.form["result"])
        buf = io.BytesIO()
        draw.build_workbook(result).save(buf)
    except (KeyError, ValueError, TypeError) as exc:
        return Response(f"Could not build the workbook: {exc}", 400)
    buf.seek(0)
    safe = re.sub(r"[^A-Za-z0-9]+", "_", result.get("semester", "semester")).strip("_")
    return send_file(buf, as_attachment=True, download_name=f"audit_draw_{safe}.xlsx")
