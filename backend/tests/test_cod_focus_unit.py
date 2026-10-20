"""This week's COD focus (routes/cod_focus.py): a Coach picks their own and
their BAs'; an Admin anyone in the office; a BA never sets their own.

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

from datetime import date  # noqa: E402

from bson import ObjectId  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

import auth  # noqa: E402
from routes import cod_focus as cf  # noqa: E402

run = asyncio.run
COACH, BA, OTHER_BA, ADMIN, AWAY = (ObjectId() for _ in range(5))


def _db(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(cf, "db", db)
    monkeypatch.setattr(auth, "db", db)
    run(db.users.insert_many([
        {"_id": COACH, "name": "Coach Example", "role": "leader", "office_id": "o1"},
        {"_id": BA, "name": "Ba Example", "role": "trainee", "office_id": "o1", "reports_to": str(COACH)},
        {"_id": OTHER_BA, "name": "Other Example", "role": "trainee", "office_id": "o1"},
        {"_id": ADMIN, "name": "Owner Example", "role": "admin", "office_id": "o1"},
        {"_id": AWAY, "name": "Away Example", "role": "trainee", "office_id": "o2"},
    ]))
    return db


def _me(oid, role, office="o1"):
    return {"id": str(oid), "role": role, "office_id": office}


async def _t(db, oid):
    return await db.users.find_one({"_id": oid})


def test_who_can_set(monkeypatch):
    db = _db(monkeypatch)
    coach, ba, admin = _me(COACH, "leader"), _me(BA, "trainee"), _me(ADMIN, "admin")
    assert run(cf.can_set(coach, run(_t(db, COACH))))            # a Coach picks their own
    assert run(cf.can_set(coach, run(_t(db, BA))))               # …and their BAs'
    assert not run(cf.can_set(coach, run(_t(db, OTHER_BA))))     # not someone else's BA
    assert not run(cf.can_set(ba, run(_t(db, BA))))              # a BA's is picked for them
    assert run(cf.can_set(admin, run(_t(db, OTHER_BA))))         # an Admin: anyone in the office
    assert not run(cf.can_set(admin, run(_t(db, AWAY))))         # …not another office


def test_week_and_focus(monkeypatch):
    db = _db(monkeypatch)
    assert cf.week_ending_of(date(2026, 10, 20)) == "2026-10-25"
    assert cf.week_ending_of(date(2026, 10, 25)) == "2026-10-25"
    run(db.cod_focus.insert_one({"user_id": str(BA), "week_ending": "2026-10-25", "module_id": "m1",
                                 "topic": "Impulses", "stage": 1, "set_by_name": "Coach Example"}))
    got = run(cf.focus_for([str(BA), str(COACH)], "2026-10-25"))
    assert got == {str(BA): {"module_id": "m1", "topic": "Impulses", "stage": 1,
                             "set_by_name": "Coach Example", "at": None}}
    assert run(cf.focus_for([str(BA)], "2026-11-01")) == {}
