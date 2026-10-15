"""The Owner's COD sheet (core/cod_sheet.py) and the one-off swap of the live
COD (core/cod_sheet_migration.py).

  • the sheet's stages run 1, 2, 3, 3+, 4, 5 (stored 1, 2, 3, 5, 4, 6);
  • every item is unique within its stage, and every carried-over item
    points at a real item in the earlier COD;
  • on a live database, carried-over items keep their id, edited notes and
    progress; everything else is archived (never deleted); new items appear;
  • running it twice changes nothing.

Pure in-memory: mongomock.
"""
import asyncio
import collections
import sys
from pathlib import Path

from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import cod_sheet_migration as mig  # noqa: E402
from core.cod_sheet import sheet_items, stage_label, STAGE_TITLES  # noqa: E402
from core.cod_stages import COD_STAGE_ORDER  # noqa: E402
from core.module_seed import all_seed_modules, earlier_cod_modules  # noqa: E402
from routes import modules as modules_route  # noqa: E402

OFFICE = "office-a"


def _run(coro):
    return asyncio.run(coro)


def test_stages_follow_the_sheet():
    assert COD_STAGE_ORDER == [1, 2, 3, 5, 4, 6]
    assert [stage_label(s) for s in COD_STAGE_ORDER] == ["1", "2", "3", "3+", "4", "5"]
    assert STAGE_TITLES[5] == "Sector/Site Leader" and STAGE_TITLES[6] == "Becoming a Business Owner"


def test_items_are_unique_and_carry_overs_are_real():
    items = sheet_items()
    keys = collections.Counter((i["stage"], i["topic"]) for i in items)
    assert not [k for k, n in keys.items() if n > 1]
    earlier = {(m["stage"], m["topic"]) for m in earlier_cod_modules()}
    sources = [i["source"] for i in items if i["source"]]
    assert all(s in earlier for s in sources)
    assert len(sources) == len(set(sources))
    # Field IQ and the Law of Averages are kept, and every stage opens on an overview.
    topics = {i["topic"] for i in items}
    assert {"Field IQ", "Law of Averages", "Personal recruiting", "Shadow Day"} <= topics
    for st in COD_STAGE_ORDER:
        first = next(i for i in items if i["stage"] == st)
        assert first["category"] == "Overview"


def test_seed_is_the_sheet():
    seeded = all_seed_modules()
    assert [(m["stage"], m["topic"]) for m in seeded] == [(i["stage"], i["topic"]) for i in sheet_items()]
    see = next(m for m in seeded if m["topic"] == "S.E.E")
    assert see["trainee_content"]  # carried over from the SEE Principle notes


def test_live_swap_keeps_progress_archives_the_rest_and_adds_new(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(modules_route, "db", db)
    _run(db.training_modules.insert_many([
        {"id": "m-see", "office_id": OFFICE, "stage": 1, "category": "Commercial Craft",
         "topic": "SEE Principle", "trainee_content": "Edited by the office", "sequence": 3},
        {"id": "m-sl", "office_id": OFFICE, "stage": 5, "category": "Commercial Craft",
         "topic": "Start-of-Day Sector Meetings", "trainee_content": "x", "sequence": 4},
        {"id": "m-old", "office_id": OFFICE, "stage": 1, "category": "Commercial Craft",
         "topic": "Impulses", "trainee_content": "x", "sequence": 5},
    ]))
    _run(db.module_progress.insert_many([
        {"id": "p1", "module_id": "m-see", "target_user_id": "u1", "stage": 1, "ladder": 3},
        {"id": "p2", "module_id": "m-sl", "target_user_id": "u1", "stage": 5, "ladder": 2},
        {"id": "p3", "module_id": "m-old", "target_user_id": "u1", "stage": 1, "ladder": 1},
    ]))

    _run(mig.run_cod_sheet_update(db))

    see = _run(db.training_modules.find_one({"id": "m-see"}))
    assert see["topic"] == "S.E.E" and see["category"] == "Expectations"
    assert see["trainee_content"] == "Edited by the office" and not see.get("retired")
    sector = _run(db.training_modules.find_one({"id": "m-sl"}))
    assert (sector["stage"], sector["topic"], sector["category"]) == (3, "Sector meetings", "E. Running Sectors")
    assert _run(db.module_progress.find_one({"id": "p2"}))["stage"] == 3

    old = _run(db.training_modules.find_one({"id": "m-old"}))
    assert old["retired"] and old["archived_stage"] == 1 and old["stage"] == 101
    assert _run(db.module_progress.find_one({"id": "p3"}))["stage"] == 101

    live = _run(db.training_modules.count_documents({"office_id": OFFICE, "retired": {"$ne": True}}))
    assert live == len(sheet_items())
    assert _run(db.training_modules.find_one({"office_id": OFFICE, "topic": "Shadow Day", "stage": 3}))

    # Once only.
    assert _run(mig.run_cod_sheet_update(db)) == {"skipped": True}
    assert _run(db.training_modules.count_documents({"office_id": OFFICE})) == live + 1


def test_owner_notes_fill_only_empty_items_once():
    db = AsyncMongoMockClient()["t"]
    _run(db.training_modules.insert_many([
        {"id": "a", "office_id": OFFICE, "stage": 5, "topic": "Showtime", "trainee_content": ""},
        {"id": "b", "office_id": OFFICE, "stage": 4, "topic": "Countries", "trainee_content": "Edited by the office"},
    ]))
    out = _run(mig.run_cod_notes_update(db))
    assert out["filled"] == 1
    assert _run(db.training_modules.find_one({"id": "a"}))["trainee_content"].startswith("Showtime is turning it on")
    assert _run(db.training_modules.find_one({"id": "b"}))["trainee_content"] == "Edited by the office"
    assert _run(mig.run_cod_notes_update(db)) == {"skipped": True}
