"""Back to the original COD (core/cod_original_migration.py): carried-over
items renamed back, archived originals restored with their original content,
the sheet's own items and Stage 5 hidden, every COD tick cleared (copied to the
archive first), and a second run changes nothing.

Pure in-memory: mongomock_motor.
"""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from mongomock_motor import AsyncMongoMockClient  # noqa: E402

from core import cod_original_migration as mig  # noqa: E402
from core.module_seed import all_seed_modules  # noqa: E402
from routes import modules  # noqa: E402

run = asyncio.run


def test_the_original_cod_is_84_items_all_with_what_to_learn():
    m = all_seed_modules()
    assert len(m) == 84
    assert sorted({x["stage"] for x in m}) == [1, 2, 3, 4, 5]
    assert all((x.get("trainee_content") or "").strip() for x in m)
    assert all(x.get("leader_coaching_notes") for x in m)


def test_restore(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(modules, "db", db)
    orig = mig.originals()
    # A carry-over the sheet renamed, and an original the sheet archived.
    sheet_key, src = next((s, o) for s, o in mig.carry_overs() if s != o and o in orig)
    sources = {o for _, o in mig.carry_overs()}
    archived_key = next(k for k in orig if k not in sources)
    run(db.training_modules.insert_many([
        {"id": "carried", "office_id": "o1", "stage": sheet_key[0], "topic": sheet_key[1],
         "category": "Sheet section", "trainee_content": ""},
        {"id": "archived", "office_id": "o1", "stage": 100 + archived_key[0], "topic": archived_key[1],
         "retired": True, "archived_stage": archived_key[0], "archived_reason": mig.SHEET_MARKER},
        {"id": "sheet-only", "office_id": "o1", "stage": 1, "topic": "A sheet-only example item"},
        {"id": "stage-5-owner", "office_id": "o1", "stage": 6, "topic": "An owner-stage example item"},
        {"id": "academy", "office_id": "o1", "stage": 0, "topic": "Not a COD item"},
    ]))
    run(db.module_progress.insert_many([
        {"module_id": "carried", "user_id": "u1", "ladder": 2},
        {"module_id": "sheet-only", "user_id": "u1", "ladder": 1},
        {"module_id": "academy", "user_id": "u1", "ladder": 1},
    ]))
    run(db.cod_test_requests.insert_one({"id": "r1", "module_id": "carried"}))

    out = run(mig.run_cod_original_restore(db))
    assert out["renamed"] >= 1 and out["restored"] >= 1 and out["archived"] >= 2

    carried = run(db.training_modules.find_one({"id": "carried"}))
    assert (carried["stage"], carried["topic"]) == src
    assert carried["trainee_content"] == orig[src]["trainee_content"]          # original content back
    restored = run(db.training_modules.find_one({"id": "archived"}))
    assert (restored["stage"], restored["topic"]) == archived_key and not restored["retired"]
    for gone in ("sheet-only", "stage-5-owner"):
        doc = run(db.training_modules.find_one({"id": gone}))
        assert doc["retired"] and doc["stage"] >= 100                          # out of sight
    assert run(db.training_modules.find_one({"id": "academy"}))["stage"] == 0  # not COD: untouched

    # Every original item is live once, with its content.
    live = run(db.training_modules.find({"office_id": "o1", "retired": {"$ne": True},
                                         "stage": {"$in": [1, 2, 3, 4, 5, 6]}}).to_list(1000))
    assert {(d["stage"], d["topic"]) for d in live} == set(orig)

    # COD ticks cleared (and copied first); other progress untouched.
    assert run(db.module_progress.count_documents({"module_id": {"$in": ["carried", "sheet-only"]}})) == 0
    assert run(db.module_progress.count_documents({"module_id": "academy"})) == 1
    assert run(db.module_progress_archive.count_documents({})) == 2
    assert run(db.cod_test_requests.count_documents({})) == 0
    assert run(db.cod_test_requests_archive.count_documents({})) == 1

    assert run(mig.run_cod_original_restore(db)) == {"skipped": True}


def test_written_quizzes_follow_a_renamed_item():
    modules._AUTHORED_QUIZZES = None
    sheet_key, src = next(((s, o) for s, o in mig.carry_overs()
                           if s != o and modules.authored_quiz_questions(*s)), (None, None))
    if sheet_key is None:
        return
    assert modules.authored_quiz_questions(*src) == modules.authored_quiz_questions(*sheet_key)
