"""Fair rotation ("giliran") for choosing auditees and auditors.

Complaint being solved: the same lecturers keep being selected. Principles:

* AUDITEES -- inside every department the quota (minimum %) is filled by whoever has WAITED LONGEST
  since they were last audited. Someone audited last semester has waited 0 and is only picked again
  when the department is too small to avoid it (that is reported as a "forced repeat").
  Someone never audited ranks by how many semesters they have been in the pool. Ties are broken
  by a random draw, so equally-overdue lecturers are still chosen by lot.
* AUDITORS -- the workload is spread evenly within the semester first; then lecturers who are
  not themselves being audited are preferred; then whoever has gone longest without serving as
  auditor, then whoever has served least overall. The grade / seniority rule is unchanged.

History is a list of past semesters, oldest first:
    {"name": str, "present": set of staff ids, or None if unknown,
     "audited": set of staff ids, "auditor_counts": {staff id: lecturers audited}}
"""
from collections import defaultdict

from . import logic

YES = {"yes", "y", "ya", "1", "true", "x", "audited"}


def _yes(value):
    return str(value).strip().lower() in YES


def parse_ledger(rows):
    """Canonical ledger rows -> history list (oldest first = order of first appearance).

    Row keys: semester, staff_id (required); in_pool, auditee, auditor_count (optional).
    * No `auditee` column: every row is a lecturer who WAS audited (simple bootstrap list).
    * `in_pool` column present: the semester's full pool is known (exact waiting times).
    """
    order, sems = [], {}
    for r in rows:
        name, sid = str(r.get("semester") or "").strip(), str(r.get("staff_id") or "").strip()
        if not name or not sid:
            continue
        if name not in sems:
            order.append(name)
            sems[name] = {"name": name, "present": None, "audited": set(), "auditor_counts": {}}
        s = sems[name]
        if r.get("in_pool") not in (None, ""):
            if s["present"] is None:
                s["present"] = set()
            if _yes(r["in_pool"]):
                s["present"].add(sid)
        if r.get("auditee") in (None, "") or _yes(r["auditee"]):
            s["audited"].add(sid)
        try:
            n = int(float(r.get("auditor_count") or 0))
        except (TypeError, ValueError):
            n = 0
        if n > 0:
            s["auditor_counts"][sid] = n
    return [sems[n] for n in order]


def standing(pool, history, today=None):
    """Per lecturer: how long they have waited, and how often they audited. Keyed by lecturer["id"].

    `pool` items need id, staff_id, start_date.
    """
    H = len(history)
    unknown_presence = any(h["present"] is None for h in history)
    out = {}
    for p in pool:
        sid = p["staff_id"]
        audited_at = [i for i, h in enumerate(history) if sid in h["audited"]]
        if audited_at:
            waiting = H - 1 - audited_at[-1]
        else:
            waiting = sum(1 for h in history if h["present"] is None or sid in h["present"])
            if unknown_presence:      # cannot tell when they joined: assume about 2 semesters a year
                waiting = min(waiting, 2 * logic.years_of_service(p["start_date"], today))
        served_at = [i for i, h in enumerate(history) if h["auditor_counts"].get(sid, 0) > 0]
        out[p["id"]] = {
            "waiting": waiting, "times": len(audited_at),
            "last": history[audited_at[-1]]["name"] if audited_at else None,
            "auditor_waiting": H - 1 - served_at[-1] if served_at else H,
            "auditor_total": sum(h["auditor_counts"].get(sid, 0) for h in history),
        }
    return out


def reason(st):
    """Plain-language explanation of why someone ranks where they do."""
    if st["last"] is None:
        if st["waiting"] == 0:
            return "Never audited (no waiting time recorded yet: random draw)"
        return f"Never audited (in the pool {st['waiting']} semester(s))"
    return f"Last audited {st['last']} ({st['waiting']} semester(s) ago)"


def select_auditees(by_department, percent, st, rng, exclude=(), force=()):
    """Fill every department's quota with the longest-waiting lecturers.

    exclude: ids not to be audited this semester (still counted in the department total).
    force: ids that must be audited (they count towards the quota).
    Returns (chosen lecturers, shortfalls [(dept, needed, got)]).
    """
    chosen, short = [], []
    for dept in sorted(by_department):
        everyone = by_department[dept]
        need = logic.required_count(len(everyone), percent)
        candidates = [m for m in everyone if m["id"] not in exclude]
        forced = [m for m in candidates if m["id"] in force]
        rest = sorted((m for m in candidates if m["id"] not in force),
                      key=lambda m: (-st[m["id"]]["waiting"], st[m["id"]]["times"], rng.random()))
        picks = forced + rest[:max(0, need - len(forced))]
        if len(picks) < need:
            short.append((dept, need, len(picks)))
        chosen.extend(picks)
    return chosen, short


def assign_auditors(auditees, pool, st, rng, today=None):
    """Pair auditees with auditors under the grade / seniority rule, rotating the burden.

    Same eligibility as logic.assign_auditors (outrank, else same-seniority peer; None = Head picks).
    """
    being_audited = {a["id"] for a in auditees}
    options = {}
    for a in auditees:
        strict = [p for p in pool if logic.can_audit(p, a, today)]
        options[a["id"]] = strict or [p for p in pool if logic.is_peer(p, a, today)]
    load = defaultdict(int)
    result = {}
    for a in sorted(auditees, key=lambda x: (len(options[x["id"]]), rng.random())):
        cands = options[a["id"]]
        if not cands:
            result[a["id"]] = None
            continue
        pick = min(cands, key=lambda c: (load[c["id"]], c["id"] in being_audited,
                                         -st[c["id"]]["auditor_waiting"], st[c["id"]]["auditor_total"],
                                         rng.random()))
        load[pick["id"]] += 1
        result[a["id"]] = pick["id"]
    return result


def ledger_rows(semester_name, pool, auditee_ids, pairing, id_to_staff):
    """Rows to append to the history after a draw (full pool known, so future waiting times are exact)."""
    served = defaultdict(int)
    for auditor_id in pairing.values():
        if auditor_id is not None:
            served[auditor_id] += 1
    return [{"semester": semester_name, "staff_id": p["staff_id"], "name": p.get("name", ""),
             "bidang": p.get("bidang", ""), "in_pool": "Yes",
             "auditee": "Yes" if p["id"] in auditee_ids else "No",
             "auditor_count": served.get(p["id"], 0)} for p in pool]
