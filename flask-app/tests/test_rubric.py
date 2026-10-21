from propens import rubric


def test_structure_matches_form():
    assert [s["max"] for s in rubric.SECTIONS] == [25, 35, 25, 30, 30]
    assert rubric.ITEM_NUMBERS == list(range(1, 30))
    assert all(len(i["levels"]) == 5 for s in rubric.SECTIONS for i in s["items"])
    assert len(rubric.FACILITY_ITEMS) == 14


def test_scoring_formula():
    perfect = rubric.compute({n: 5 for n in rubric.ITEM_NUMBERS})
    assert (perfect["raw"], perfect["ts"], perfect["tas"]) == (145, 50.0, 100.0)
    worst = rubric.compute({n: 1 for n in rubric.ITEM_NUMBERS})
    assert (worst["raw"], worst["tas"]) == (29, 20.0)
    assert rubric.compute({1: 5})["complete"] is False


def test_indicator_bands():
    cases = {59.99: "Sangat Lemah", 60: "Lemah", 69.9: "Lemah", 70: "Memuaskan", 79.99: "Memuaskan",
             80: "Baik", 89.99: "Baik", 90: "Cemerlang", 100: "Cemerlang"}
    for tas, label in cases.items():
        assert rubric.indicator(tas).startswith(label), tas
