"""Who gets the 6pm reset (routes/field_reset.py): everyone out today, and
going out when you weren't scheduled still counts."""
import asyncio
import os
import sys
from datetime import date
from pathlib import Path

from bson import ObjectId

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import field_reset as fr  # noqa: E402


def test_out_today_includes_anyone_with_signs_of_being_out(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(fr, "db", db)
    run = asyncio.run
    d = date(2026, 10, 13)   # a Tuesday
    owner, ba_in, ba_off, ba_off_but_out, coach = (ObjectId() for _ in range(5))
    run(db.users.insert_many([
        {"_id": owner, "role": "admin", "name": "Owner Example"},
        {"_id": ba_in, "role": "trainee", "name": "In Example"},
        {"_id": ba_off, "role": "trainee", "name": "Off Example"},
        {"_id": ba_off_but_out, "role": "trainee", "name": "Out Example"},
        {"_id": coach, "role": "leader", "name": "Coach Example"},
    ]))
    days = lambda st: [{}, {"status": st}]   # noqa: E731  (Mon, Tue)
    run(db.bells_entries.insert_many([
        {"user_id": str(ba_off), "week_ending": "2026-10-18", "days": days("ab")},
        {"user_id": str(ba_off_but_out), "week_ending": "2026-10-18", "days": days("ab")},
        {"user_id": str(owner), "week_ending": "2026-10-18", "days": days("ab")},
    ]))
    # The Owner went out anyway and set up; one BA has doors on Field IQ.
    run(db.sector_days.insert_one({"user_id": str(owner), "date": d.isoformat(), "setup": {"goal": 4}}))
    run(db.owneriq_kpis.insert_one({"cg1_user_id": str(ba_off_but_out), "date": d.isoformat(), "doors_knocked": 12}))
    out = run(fr.out_today(d))
    assert out == {str(owner), str(ba_in), str(ba_off_but_out), str(coach)}
    # An Admin who's in on Bells today counts without a set-up.
    admin2 = ObjectId()
    run(db.users.insert_one({"_id": admin2, "role": "admin", "name": "Admin Example"}))
    run(db.bells_entries.insert_one({"user_id": str(admin2), "week_ending": "2026-10-18", "days": days("in")}))
    assert str(admin2) in run(fr.out_today(d))
