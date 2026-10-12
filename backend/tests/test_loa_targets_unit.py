"""The Owner's Law of Averages: 120 doors · 70 spoken · 25 pitched · 15
closed · 4+ sign-ups, everywhere the booklet's numbers used to be."""
import asyncio
import json
import sys
from pathlib import Path

from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import loa_targets  # noqa: E402
from seed_data import DAY_TARGETS, TRAINING_MANUAL  # noqa: E402

OLD = ["80 people spoken to", "80 spoken", "qualified customers", "3 sign-ups", "3+ sign-ups", "3+ a day", "Spoken: 80"]


def test_seeds_carry_the_owners_numbers():
    texts = [json.dumps(json.load(open(BACKEND_DIR / "seed" / f)), ensure_ascii=False)
             for f in ("product_knowledge_topics.json", "coaching_impacts.json")]
    texts.append(json.dumps(TRAINING_MANUAL, ensure_ascii=False))
    for t in texts:
        for old in OLD:
            assert old not in t, old
    pk = texts[0]
    assert "70 people spoken to · 25 pitched · 15 closed · 4+ sign-ups" in pk
    for t in DAY_TARGETS:
        if t["day_number"] >= 4:
            assert (t["target_introductions"], t["target_presentations"], t["target_closes"], t["target_sales"]) == (70, 25, 15, 4)


def test_live_update_runs_once_and_only_changes_the_old_phrases():
    db = AsyncMongoMockClient()["t"]
    asyncio.run(db.product_knowledge_topics.insert_one(
        {"slug": "x", "facts": ["A day: 120 doors · 80 people spoken to · 20 qualified customers · 15–20 phones / closes · 3+ sign-ups"],
         "body": "Our own note: 80 is a nice number."}))
    asyncio.run(db.targets.insert_many([
        {"day_number": 3, "target_introductions": 20, "target_presentations": 10, "target_closes": 2, "target_sales": 0},
        {"day_number": 5, "target_introductions": 80, "target_presentations": 20, "target_closes": 15, "target_sales": 3},
        {"day_number": 6, "target_introductions": 90, "target_presentations": 20, "target_closes": 15, "target_sales": 3},
    ]))
    out = asyncio.run(loa_targets.run_loa_update(db))
    assert out["docs"] == 1 and out["targets"] == 1
    doc = asyncio.run(db.product_knowledge_topics.find_one({"slug": "x"}))
    assert doc["facts"][0] == "A day: 120 doors · 70 people spoken to · 25 pitched · 15 closed · 4+ sign-ups"
    assert doc["body"] == "Our own note: 80 is a nice number."
    d6 = asyncio.run(db.targets.find_one({"day_number": 6}))
    assert d6["target_introductions"] == 90   # an office's own targets are kept
    assert asyncio.run(loa_targets.run_loa_update(db)) == {"skipped": True}
