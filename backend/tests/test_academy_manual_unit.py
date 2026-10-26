"""BA Academy Day 1 checklist in the Owner's running order (core/academy_manual.py)."""
import asyncio
import sys
from pathlib import Path

from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import academy_manual as am  # noqa: E402
from seed_data import TRAINING_MANUAL  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _topics(rows, day):
    return [r["topic"] for r in sorted((r for r in rows if r["day_number"] == day), key=lambda r: r["sequence"])]


def test_seed_day1_follows_the_running_order():
    d1 = _topics(TRAINING_MANUAL, 1)
    taught = d1[7:]
    assert taught == am.DAY1_ORDER
    for t in am.MOVE_TO_DAY2:
        assert t not in d1 and t in _topics(TRAINING_MANUAL, 2)
    for day in range(1, 9):
        seqs = sorted(r["sequence"] for r in TRAINING_MANUAL if r["day_number"] == day)
        assert seqs == list(range(1, len(seqs) + 1)), day


def test_migration_runs_once_and_rebuilds_unstarted_checklists():
    db = AsyncMongoMockClient()["academy_manual_test"]
    old = [
        {"day_number": 1, "sequence": 1, "category": "Behaviour", "topic": "Work Ethic"},
        {"day_number": 1, "sequence": 2, "category": "Business", "topic": "Business Model"},
        {"day_number": 1, "sequence": 3, "category": "Quality", "topic": "The 'A' Customer"},
        {"day_number": 1, "sequence": 4, "category": "Pay", "topic": "Commission Structure"},
        {"day_number": 2, "sequence": 1, "category": "Product", "topic": "How It Works"},
    ]
    _run(db.training_manual.insert_many([{**r, "office_id": "o1"} for r in old]))
    _run(db.new_hires.insert_one({"id": "h1", "office_id": "o1", "active": True}))
    _run(db.daily_assessments.insert_many([
        {"id": "a1", "new_hire_id": "h1", "day_number": 1, "completed": False},
        {"id": "a2", "new_hire_id": "h1", "day_number": 2, "completed": False},
    ]))
    _run(db.delivery_checklist.insert_many([
        {"id": "c1", "assessment_id": "a1", "topic": "The 'A' Customer"},
        {"id": "c2", "assessment_id": "a2", "topic": "How It Works", "taught": True},
    ]))
    out = _run(am.migrate(db))
    assert out["offices"] == 1 and out["checklists_rebuilt"] == 1
    rows = _run(db.training_manual.find({"office_id": "o1"}).to_list(100))
    d1 = _topics(rows, 1)
    assert d1[0] == "Work Ethic" and d1[1] == "Your First Week" and "The 'A' Customer" not in d1
    assert _topics(rows, 2) == ["How It Works", "The 'A' Customer"]
    a1 = [r["topic"] for r in _run(db.delivery_checklist.find({"assessment_id": "a1"}).to_list(100))]
    assert "Your First Week" in a1 and "The 'A' Customer" not in a1
    # Day 2 had a row taught already: left alone.
    assert [r["id"] for r in _run(db.delivery_checklist.find({"assessment_id": "a2"}).to_list(10))] == ["c2"]
    assert _run(am.migrate(db)) == {"skipped": True}


def test_seed_day2_follows_the_workbook_and_drops_future_payment_dates():
    d2 = _topics(TRAINING_MANUAL, 2)
    assert d2[0] == "Signup Process Overview" and d2[-2:] == ["Rehash", "Law of Averages"]
    assert [t for t in am.DAY2_ORDER if t in d2] == d2
    for r in TRAINING_MANUAL:
        text = r["what_good_looks_like"] + r["expected_outcome"]
        assert "3 days before" not in text and "3 days in advance" not in text, r["topic"]


def test_day2_migration_keeps_edited_rows_and_rebuilds_unstarted_checklists():
    db = AsyncMongoMockClient()["academy_manual_day2_test"]
    rows = [
        {"day_number": 2, "sequence": 1, "category": "Product", "topic": "How It Works", "what_good_looks_like": "x"},
        {"day_number": 2, "sequence": 2, "category": "Signup", "topic": "Explain the Payments",
         "what_good_looks_like": "Teach the payments in the customer's words: you pay for your first order today, which activates your discount; after that it's weekly, 3 days before."},
        {"day_number": 2, "sequence": 3, "category": "Signup", "topic": "Signup Process Overview",
         "what_good_looks_like": "My own words."},
        {"day_number": 4, "sequence": 7, "category": "Signup", "topic": "Explaining the Payments",
         "what_good_looks_like": "The payments explanation is theirs now. Listen for the three beats: 3 days before."},
    ]
    _run(db.training_manual.insert_many([{**r, "office_id": "o1"} for r in rows]))
    _run(db.new_hires.insert_one({"id": "h1", "office_id": "o1", "active": True}))
    _run(db.daily_assessments.insert_one({"id": "a2", "new_hire_id": "h1", "day_number": 2, "completed": False}))
    _run(db.delivery_checklist.insert_one({"id": "c1", "assessment_id": "a2", "topic": "How It Works"}))
    out = _run(am.migrate_day2(db))
    assert out == {"offices": 1, "checklists_rebuilt": 1}
    live = _run(db.training_manual.find({"office_id": "o1"}).to_list(100))
    assert _topics(live, 2) == ["Signup Process Overview", "Explain the Payments", "Code of Practice", "G.I.F.T.S.",
                                "How It Works", "Rehash", "Law of Averages"]
    by = {(r["day_number"], r["topic"]): r["what_good_looks_like"] for r in live}
    assert by[(2, "Signup Process Overview")] == "My own words."          # edited in Manual: kept
    assert "there and then" in by[(2, "Explain the Payments")] and "3 days" not in by[(2, "Explain the Payments")]
    assert "3 days" not in by[(4, "Explaining the Payments")]
    a2 = [r["topic"] for r in _run(db.delivery_checklist.find({"assessment_id": "a2"}).to_list(100))]
    assert a2[0] == "Signup Process Overview" and "Rehash" in a2
    assert _run(am.migrate_day2(db)) == {"skipped": True}
