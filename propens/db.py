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


def init_db():
    get_db().executescript(SCHEMA)
