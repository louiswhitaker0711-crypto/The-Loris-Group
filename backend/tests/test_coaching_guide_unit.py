"""Today's coaching guide: new vs carried over, Behind and Ahead (core/coaching_guide.py)."""
from core.coaching_guide import classify, flags, level


def test_new_and_keep_with_a_changed_expectation():
    today = [{"topic": "Introduction", "confidence_expected": "Do"},
             {"topic": "Presentation", "confidence_expected": "Know"},
             {"topic": "Short Story", "confidence_expected": "Know"}]
    yesterday = [{"topic": "introduction ", "confidence_expected": "Know"},
                 {"topic": "Presentation", "confidence_expected": "Know"}]
    out = {r["topic"]: r for r in classify(today, yesterday)}
    assert out["Short Story"]["status"] == "new"
    assert out["Introduction"]["status"] == "keep" and out["Introduction"]["changed_from"] == "Know"
    assert out["Presentation"]["status"] == "keep" and out["Presentation"]["changed_from"] is None


def test_behind_is_only_not_learnt_on_the_latest_grade():
    past = [{"topic": "Introduction", "grade": "Not Learnt", "expected": "Know", "day": 3},
            {"topic": "Introduction", "grade": "Do", "expected": "Do", "day": 4},
            {"topic": "Close", "grade": "Not Learnt", "expected": "Do", "day": 4},
            {"topic": "Rehash", "grade": "Know", "expected": "Do", "day": 4}]
    _, behind = flags([], past)
    assert [b["topic"] for b in behind] == ["Close"]


def test_academy_learnt_is_never_behind_or_ahead():
    # Days 1-2 are graded Learnt / Not Learnt: Learnt is a pass.
    past = [{"topic": "Explain the Payments", "grade": "Learnt", "expected": "Independent", "day": 2}]
    items, behind = flags([{"topic": "Explain the Payments", "confidence_expected": "Understand"}], past)
    assert behind == [] and items[0]["ahead"] is False


def test_ahead_when_graded_above_todays_expectation():
    today = [{"topic": "Presentation", "confidence_expected": "Know"}, {"topic": "Close", "confidence_expected": "Do"}]
    past = [{"topic": "Presentation", "grade": "Do", "expected": "Know", "day": 3}]
    items, behind = flags(today, past)
    assert {i["topic"]: i["ahead"] for i in items} == {"Presentation": True, "Close": False}
    assert behind == []


def test_levels():
    assert level("Not Learnt") == 0 and level("Know") == 1 and level("Do") == 2 and level("Deliver") == 3


def test_manual_aims_line_up_with_grades():
    # The Manual's aims (Understand → Assisted → Independent) against the grades (Know → Do → Deliver).
    assert level("Understand") == level("Know") and level("Assisted") == level("Do") and level("Independent") == level("Deliver")
