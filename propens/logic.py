"""Pure business rules: sampling, seniority and auditor matching.

Nothing in here touches the database, so it can be unit tested directly.
"""
import math
import re
from datetime import date, datetime

# A lecturer must have this status to be audited or to audit others.
ELIGIBLE_STATUS = "active"


def is_eligible(status):
    return (status or "").strip().lower() == ELIGIBLE_STATUS


def parse_date(value):
    """Accept date/datetime, ISO, DD/MM/YYYY, DD-MM-YYYY or a bare year."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if re.fullmatch(r"\d{4}", s):
        return date(int(s), 1, 1)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Unrecognised date: {value!r}")


def years_of_service(start, today=None):
    """Year of employment = current year - year employment started."""
    today = today or date.today()
    start = parse_date(start)
    return max(0, today.year - start.year)


def grade_rank(grade):
    """Numeric rank of a Gred Jawatan such as 'DS52' or 'VK7' (higher = higher grade).

    Uses the digits in the grade. Grades with no digits rank 0.
    """
    m = re.search(r"\d+", grade or "")
    return int(m.group()) if m else 0


def can_audit(auditor, auditee, today=None):
    """Auditor must be a different person AND (higher grade OR more years of service).

    `auditor` / `auditee` are mappings with `id`, `grade`, `start_date`.
    """
    if auditor["id"] == auditee["id"]:
        return False
    if grade_rank(auditor["grade"]) > grade_rank(auditee["grade"]):
        return True
    return years_of_service(auditor["start_date"], today) > years_of_service(
        auditee["start_date"], today)


def required_count(total, percent):
    """Minimum number to audit in a group of `total` at `percent` (rounded up, min 1)."""
    if total <= 0:
        return 0
    n = math.ceil(round(total * percent / 100.0, 9))
    return min(total, max(1, n)) if percent > 0 else 0


def select_auditees(by_department, percent, rng):
    """Randomly pick the minimum quota from every department.

    by_department: {department: [lecturer, ...]} (eligible lecturers only).
    Returns a list of lecturers.
    """
    chosen = []
    for dept in sorted(by_department):
        members = by_department[dept]
        k = required_count(len(members), percent)
        chosen.extend(rng.sample(members, k))
    return chosen


def assign_auditors(auditees, pool, rng, today=None):
    """Pair each auditee with a valid auditor, spreading the workload evenly.

    Most constrained auditees (fewest valid auditors) are matched first.
    Returns {auditee_id: auditor_id or None}; None means nobody qualifies.
    """
    options = {a["id"]: [p for p in pool if can_audit(p, a, today)] for a in auditees}
    load = {p["id"]: 0 for p in pool}
    result = {}
    for a in sorted(auditees, key=lambda x: (len(options[x["id"]]), rng.random())):
        cands = options[a["id"]]
        if not cands:
            result[a["id"]] = None
            continue
        best = min(load[c["id"]] for c in cands)
        pick = rng.choice([c for c in cands if load[c["id"]] == best])
        load[pick["id"]] += 1
        result[a["id"]] = pick["id"]
    return result
