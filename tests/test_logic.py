import random
from datetime import date

from propens import logic

TODAY = date(2026, 10, 16)


def L(i, grade, start, dept="CS"):
    return {"id": i, "grade": grade, "start_date": start, "bidang": dept}


def test_years_of_service_uses_current_year():
    assert logic.years_of_service("2012-03-01", TODAY) == 14
    assert logic.years_of_service(date(2026, 1, 1), TODAY) == 0


def test_parse_date_formats():
    assert logic.parse_date("2012") == date(2012, 1, 1)
    assert logic.parse_date("01/03/2012") == date(2012, 3, 1)


def test_required_count_rounds_up_per_group():
    assert logic.required_count(10, 20) == 2
    assert logic.required_count(11, 20) == 3
    assert logic.required_count(1, 5) == 1      # never zero for a non-empty group
    assert logic.required_count(0, 20) == 0
    assert logic.required_count(3, 100) == 3


def test_every_department_meets_minimum():
    rng = random.Random(1)
    by = {"CS": [L(i, "DS45", "2020") for i in range(10)],
          "Math": [L(100 + i, "DS45", "2020", "Math") for i in range(7)],
          "Tiny": [L(200, "DS45", "2020", "Tiny")]}
    chosen = logic.select_auditees(by, 25, rng)
    count = lambda d: sum(1 for c in chosen if c["bidang"] == d)
    assert count("CS") == 3 and count("Math") == 2 and count("Tiny") == 1
    assert len({c["id"] for c in chosen}) == len(chosen)


def test_can_audit_grade_or_seniority():
    ee = L(1, "DS45", "2016")
    assert logic.can_audit(L(2, "DS52", "2024"), ee, TODAY)        # higher grade, junior
    assert logic.can_audit(L(3, "DS45", "2005"), ee, TODAY)        # same grade, more senior
    assert not logic.can_audit(L(4, "DS45", "2016"), ee, TODAY)    # equal on both
    assert not logic.can_audit(L(5, "DS41", "2024"), ee, TODAY)    # lower on both
    assert not logic.can_audit(ee, ee, TODAY)                      # never yourself


def test_assignment_respects_rule_and_balances_load():
    rng = random.Random(7)
    pool = [L(1, "DS54", "2000"), L(2, "DS52", "2005"), L(3, "DS48", "2010"),
            L(4, "DS45", "2015"), L(5, "DS41", "2020"), L(6, "DS41", "2022")]
    auditees = [pool[3], pool[4], pool[5], pool[2]]
    out = logic.assign_auditors(auditees, pool, rng, TODAY)
    byid = {p["id"]: p for p in pool}
    for ee_id, er_id in out.items():
        assert er_id is not None and logic.can_audit(byid[er_id], byid[ee_id], TODAY)
    loads = [list(out.values()).count(i) for i in set(out.values())]
    assert max(loads) - min(loads) <= 1 or len(set(out.values())) >= 3


def test_most_senior_person_gets_same_seniority_peer():
    pool = [L(1, "DS54", "2000"), L(2, "DS45", "2015"), L(3, "DS52", "2000")]
    assert logic.assign_auditors([pool[0]], pool, random.Random(1), TODAY) == {1: 3}


def test_no_peer_leaves_row_for_head():
    pool = [L(1, "DS54", "2000"), L(2, "DS45", "2015")]
    assert logic.assign_auditors([pool[0]], pool, random.Random(1), TODAY) == {1: None}
