import random
from collections import Counter
from datetime import date

from propens import logic, rotation

TODAY = date(2026, 10, 16)


def L(i, dept="CS", grade="DS45", start="2010-01-01"):
    return {"id": f"S{i}", "staff_id": f"S{i}", "name": f"L{i}", "grade": grade, "start_date": start, "bidang": dept}


def run_semesters(n, pool, percent, history=None, seed=1):
    """Simulate n consecutive semesters; returns the list of audited-id sets."""
    history, picked = list(history or []), []
    for s in range(n):
        rng = random.Random(seed + s)
        by = {}
        for p in pool:
            by.setdefault(p["bidang"], []).append(p)
        st = rotation.standing(pool, history, TODAY)
        chosen, _ = rotation.select_auditees(by, percent, st, rng)
        ids = {c["id"] for c in chosen}
        picked.append(ids)
        history.append({"name": f"Sem{len(history) + 1}", "present": {p["staff_id"] for p in pool},
                        "audited": ids, "auditor_counts": {}})
    return picked


def test_nobody_is_repeated_until_everyone_has_had_a_turn():
    pool = [L(i) for i in range(12)]                  # quota 25% -> 3 per semester -> cycle of 4 semesters
    picks = run_semesters(8, pool, 25)
    assert all(len(p) == 3 for p in picks)
    assert not set.intersection(*picks[:4]) and len(set().union(*picks[:4])) == 12   # semesters 1-4: everyone once
    assert len(set().union(*picks[4:])) == 12                                        # semesters 5-8: everyone again
    counts = Counter(i for p in picks for i in p)
    assert set(counts.values()) == {2}


def test_never_the_same_people_two_semesters_in_a_row_when_avoidable():
    pool = [L(i) for i in range(10)] + [L(100 + i, "Math") for i in range(6)]
    picks = run_semesters(12, pool, 20)
    for a, b in zip(picks, picks[1:]):
        assert not (a & b)


def test_department_quota_still_met_every_semester():
    pool = [L(i) for i in range(10)] + [L(100 + i, "Math") for i in range(7)] + [L(200, "Tiny")]
    picks = run_semesters(6, pool, 20)
    for p in picks:
        assert sum(1 for i in p if i.startswith("S") and int(i[1:]) < 100) == 2
        assert sum(1 for i in p if 100 <= int(i[1:]) < 200) == 2           # ceil(1.4)
        assert "S200" in p                                                   # lone lecturer: forced every semester


def test_new_joiner_is_not_rushed_to_the_front():
    veterans = [L(i) for i in range(6)]
    history = [{"name": f"Sem{k}", "present": {p["staff_id"] for p in veterans},
                "audited": {f"S{k}"}, "auditor_counts": {}} for k in range(3)]      # S0,S1,S2 audited; S3-S5 never
    pool = veterans + [L(99)]                                                       # S99 joined this semester
    st = rotation.standing(pool, history, TODAY)
    assert st["S99"]["waiting"] == 0 and st["S3"]["waiting"] == 3 and st["S0"]["waiting"] == 2
    chosen, _ = rotation.select_auditees({"CS": pool}, 30, st, random.Random(3))
    assert {c["id"] for c in chosen} <= {"S3", "S4", "S5"} and len(chosen) == 3


def test_audited_only_history_caps_waiting_by_years_of_service():
    history = [{"name": f"Sem{k}", "present": None, "audited": set(), "auditor_counts": {}} for k in range(10)]
    pool = [L(1, start="2000-01-01"), L(2, start="2025-06-01")]       # 26 years vs 1 year of service
    st = rotation.standing(pool, history, TODAY)
    assert st["S1"]["waiting"] == 10 and st["S2"]["waiting"] == 2


def test_exclude_force_and_shortfall():
    pool = [L(i) for i in range(5)]
    st = rotation.standing(pool, [], TODAY)
    chosen, short = rotation.select_auditees({"CS": pool}, 40, st, random.Random(1), exclude={"S0"}, force={"S4"})
    ids = {c["id"] for c in chosen}
    assert "S4" in ids and "S0" not in ids and len(ids) == 2 and not short
    chosen, short = rotation.select_auditees({"CS": pool}, 100, st, random.Random(1), exclude={"S0", "S1", "S2", "S3"})
    assert short == [("CS", 5, 1)]


def test_auditor_load_is_spread_and_rotates():
    pool = [L(1, grade="DS54", start="1990-01-01"), L(2, grade="DS52", start="1995-01-01"),
            L(3, grade="DS50", start="1998-01-01")] + [L(10 + i, start="2015-01-01") for i in range(6)]
    auditees = pool[3:]
    history = [{"name": "Prev", "present": None, "audited": set(), "auditor_counts": {"S1": 5, "S2": 0, "S3": 0}}]
    st = rotation.standing(pool, history, TODAY)
    out = rotation.assign_auditors(auditees, pool, st, random.Random(5), TODAY)
    counts = Counter(out.values())
    assert set(counts) == {"S1", "S2", "S3"} and set(counts.values()) == {2}     # 6 auditees spread 2/2/2
    byid = {p["id"]: p for p in pool}
    assert all(logic.can_audit(byid[a], byid[e], TODAY) for e, a in out.items())


def test_auditor_prefers_someone_not_being_audited_when_load_is_equal():
    pool = [L(0, grade="DS56", start="1985-01-01"), L(1, grade="DS54", start="1990-01-01"),
            L(2, grade="DS54", start="1990-01-01"), L(3, grade="DS45", start="2015-01-01")]
    history = [{"name": "Prev", "present": None, "audited": set(), "auditor_counts": {"S1": 3, "S2": 3}}]
    st = rotation.standing(pool, history, TODAY)
    # S1 and S3 are audited. S1 can only be audited by S0, so S0 is busy; for S3 the equally-loaded
    # S1 (also an auditee) and S2 (not) compete -> S2 is preferred.
    out = rotation.assign_auditors([pool[1], pool[3]], pool, st, random.Random(1), TODAY)
    assert out["S1"] == "S0" and out["S3"] == "S2"


def test_even_spread_beats_the_not_being_audited_preference():
    pool = [L(1, grade="DS54", start="1990-01-01"), L(2, grade="DS54", start="1990-01-01"),
            L(3, grade="DS45", start="2015-01-01")]
    st = rotation.standing(pool, [], TODAY)
    out = rotation.assign_auditors([pool[0], pool[2]], pool, st, random.Random(1), TODAY)
    assert out == {"S1": "S2", "S3": "S1"}        # nobody audits twice, even though S1 is also an auditee


def test_parse_ledger_formats():
    simple = rotation.parse_ledger([{"semester": "A", "staff_id": "1"}, {"semester": "A", "staff_id": "2"},
                                    {"semester": "B", "staff_id": "3"}])
    assert [h["name"] for h in simple] == ["A", "B"] and simple[0]["audited"] == {"1", "2"} and simple[0]["present"] is None
    full = rotation.parse_ledger([
        {"semester": "A", "staff_id": "1", "in_pool": "Yes", "auditee": "Yes", "auditor_count": 0},
        {"semester": "A", "staff_id": "2", "in_pool": "Yes", "auditee": "No", "auditor_count": 2},
        {"semester": "A", "staff_id": "3", "in_pool": "No", "auditee": "No"}])
    assert full[0]["present"] == {"1", "2"} and full[0]["audited"] == {"1"} and full[0]["auditor_counts"] == {"2": 2}
