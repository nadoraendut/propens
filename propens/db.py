import sqlite3

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS lecturers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    grade TEXT NOT NULL,                 -- Gred Jawatan
    bidang TEXT NOT NULL,                -- field / department
    start_date TEXT NOT NULL,            -- ISO date, start of employment
    campus TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Active',
    email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'lecturer' CHECK (role IN ('lecturer','admin','head')),
    password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS semesters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    min_percent REAL NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft'
        CHECK (state IN ('draft','generated','pending_head','changes_requested','approved','closed')),
    verified_at TEXT,
    approved_at TEXT,
    head_comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS semester_lecturers (
    semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    lecturer_id INTEGER NOT NULL REFERENCES lecturers(id) ON DELETE CASCADE,
    PRIMARY KEY (semester_id, lecturer_id)
);
CREATE TABLE IF NOT EXISTS audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    semester_id INTEGER NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
    auditee_id INTEGER NOT NULL REFERENCES lecturers(id),
    auditor_id INTEGER REFERENCES lecturers(id),
    origin TEXT NOT NULL DEFAULT 'auto',      -- auto | manual
    session_date TEXT,
    session_time TEXT,
    venue TEXT NOT NULL DEFAULT '',
    reminder_sent_at TEXT,
    marks REAL,
    feedback TEXT NOT NULL DEFAULT '',
    completed_at TEXT,
    UNIQUE (semester_id, auditee_id)
);
CREATE TABLE IF NOT EXISTS audit_scores (          -- PRO-PENS rubric items 1-29 (score 1-5)
    audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    item INTEGER NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    PRIMARY KEY (audit_id, item)
);
CREATE TABLE IF NOT EXISTS facility_scores (       -- classroom facilities checklist (score 0-5)
    audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
    item INTEGER NOT NULL,
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 5),
    PRIMARY KEY (audit_id, item)
);
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lecturer_id INTEGER NOT NULL REFERENCES lecturers(id),
    message TEXT NOT NULL,
    link TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL,                    -- sent | queued | failed
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
"""


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# Columns added after the first release; applied to existing databases on start-up.
NEW_AUDIT_COLUMNS = {
    "faculty": "TEXT NOT NULL DEFAULT ''", "program": "TEXT NOT NULL DEFAULT ''",
    "course_code": "TEXT NOT NULL DEFAULT ''", "group_no": "TEXT NOT NULL DEFAULT ''",
    "student_count": "INTEGER", "method": "TEXT NOT NULL DEFAULT ''",
    "comment_teaching": "TEXT NOT NULL DEFAULT ''", "comment_prof": "TEXT NOT NULL DEFAULT ''",
    "comment_other": "TEXT NOT NULL DEFAULT ''", "raw_score": "REAL",
    "facility_room": "TEXT NOT NULL DEFAULT ''", "facility_suggestion": "TEXT NOT NULL DEFAULT ''",
}


def init_db():
    db = get_db()
    db.executescript(SCHEMA)
    have = {r["name"] for r in db.execute("PRAGMA table_info(audits)")}
    for col, ddl in NEW_AUDIT_COLUMNS.items():
        if col not in have:
            db.execute(f"ALTER TABLE audits ADD COLUMN {col} {ddl}")
    db.commit()
