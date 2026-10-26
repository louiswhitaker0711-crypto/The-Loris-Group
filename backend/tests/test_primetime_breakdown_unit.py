"""Primetime at the sector breakdown (routes/primetime.py): the sector leader
plans tomorrow for the people in their sector, anyone plans their own, and
'free to work with' is a mode of its own."""
import asyncio
import os
import sys
from datetime import date
from pathlib import Path

import pytest
from bson import ObjectId
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import primetime as pt  # noqa: E402


def test_tomorrow_skips_sunday():
    assert pt._next_primetime_day(date(2026, 10, 13)) == date(2026, 10, 14)   # Tue → Wed
    assert pt._next_primetime_day(date(2026, 10, 17)) == date(2026, 10, 19)   # Sat → Mon
    assert pt._next_primetime_day(date(2026, 10, 16)) == date(2026, 10, 19)   # Fri → Mon (no Saturday Primetime)
    assert "free" in pt.MODES


def test_the_sector_leader_plans_the_sector_and_a_ba_only_themselves(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(pt, "db", db)
    run = asyncio.run
    lead, ba, other = ObjectId(), ObjectId(), ObjectId()
    for oid, name in ((lead, "Sam Example"), (ba, "Ayo Example"), (other, "Kim Example")):
        run(db.users.insert_one({"_id": oid, "name": name, "office_id": "o1", "role": "trainee"}))
    day = "2026-10-13"
    run(db.sectors.insert_one({"office_id": "o1", "date": day, "leader_id": str(lead), "member_ids": [str(lead), str(ba)]}))
    who = {"u": {"id": str(lead), "name": "Sam Example", "role": "trainee", "office_id": "o1"}}

    async def _user(_r):
        return dict(who["u"])

    monkeypatch.setattr(pt, "get_current_user", _user)
    save = lambda **k: run(pt.save_sector_primetime(pt.SectorEntryBody(date=day, **k), None))  # noqa: E731

    assert save(user_id=str(ba), mode="free")["entry"]["mode"] == "free"
    t = save(user_id=str(lead), mode="teaching", topic="Closing")["entry"]
    assert t["session_id"] and t["day_date"] == "2026-10-14"
    with pytest.raises(HTTPException):
        save(user_id=str(other), mode="learning", topic="Pitch")          # not in the sector
    # The BA joins the leader's session instead.
    joined = save(user_id=str(ba), mode="learning", session_id=t["session_id"])["entry"]
    assert (joined["topic"], joined["with_names"]) == ("Closing", ["Sam Example"])

    who["u"] = {"id": str(other), "name": "Kim Example", "role": "trainee", "office_id": "o1"}
    assert save(user_id=str(other), mode="watching")["entry"]["mode"] == "watching"   # their own
    with pytest.raises(HTTPException):
        save(user_id=str(ba), mode="free")

    who["u"] = {"id": str(lead), "name": "Sam Example", "role": "trainee", "office_id": "o1"}
    view = run(pt.sector_primetime(None, date=day))
    assert view["leads"] and {p["name"]: p["mode"] for p in view["people"]} == {"Sam Example": "teaching", "Ayo Example": "learning"}
    assert view["sessions"][0]["topic"] == "Closing"


def test_the_morning_plans_todays_primetime_for_everyone_in(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    from routes import sector_plan as sp
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(pt, "db", db)
    monkeypatch.setattr(sp, "db", db)
    run = asyncio.run
    owner, lead, ba, ba2 = ObjectId(), ObjectId(), ObjectId(), ObjectId()
    for oid, name, role in ((owner, "Lou Example", "admin"), (lead, "Sam Example", "leader"),
                            (ba, "Ayo Example", "trainee"), (ba2, "Kim Example", "trainee")):
        run(db.users.insert_one({"_id": oid, "name": name, "office_id": "o1", "role": role}))
    day = "2026-10-13"  # a Tuesday: the morning plans Tuesday's own Primetime
    run(db.sectors.insert_one({"office_id": "o1", "date": day, "leader_id": str(lead), "member_ids": [str(lead), str(ba), str(ba2)]}))
    who = {"u": {"id": str(owner), "name": "Lou Example", "role": "admin", "office_id": "o1"}}

    async def _user(_r):
        return dict(who["u"])

    monkeypatch.setattr(pt, "get_current_user", _user)
    save = lambda **k: run(pt.save_sector_primetime(pt.SectorEntryBody(date=day, scope="morning", **k), None))  # noqa: E731
    t = save(user_id=str(lead), mode="teaching", topic="Closing")["entry"]
    assert t["day_date"] == day
    save(user_id=str(ba), mode="learning", session_id=t["session_id"])
    save(user_id=str(ba2), mode="free")
    view = run(pt.sector_primetime(None, date=day, scope="morning"))
    assert view["leads"] and view["date"] == day
    assert {p["name"] for p in view["people"]} == {"Sam Example", "Ayo Example", "Kim Example"}
    assert view["sessions"][0]["attendees"][0]["name"] == "Ayo Example" and view["sessions"][0]["mine"]

    # A BA in the morning plans only themselves.
    who["u"] = {"id": str(ba2), "name": "Kim Example", "role": "trainee", "office_id": "o1"}
    assert [p["name"] for p in run(pt.sector_primetime(None, date=day, scope="morning"))["people"]] == ["Kim Example"]
    with pytest.raises(HTTPException):
        save(user_id=str(ba), mode="watching")


def test_the_breakdown_message_carries_tomorrows_primetime(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    from routes import sector as sec
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(pt, "db", db)
    run = asyncio.run
    lead, ba, ba2 = ObjectId(), ObjectId(), ObjectId()
    for oid, name in ((lead, "Sam Example"), (ba, "Ayo Example"), (ba2, "Kim Example")):
        run(db.users.insert_one({"_id": oid, "name": name, "office_id": "o1", "role": "trainee"}))
    day = "2026-10-13"
    run(db.sectors.insert_one({"office_id": "o1", "date": day, "leader_id": str(lead), "member_ids": [str(lead), str(ba), str(ba2)]}))

    async def _user(_r):
        return {"id": str(lead), "name": "Sam Example", "role": "trainee", "office_id": "o1"}

    monkeypatch.setattr(pt, "get_current_user", _user)
    save = lambda **k: run(pt.save_sector_primetime(pt.SectorEntryBody(date=day, **k), None))  # noqa: E731
    t = save(user_id=str(lead), mode="teaching", topic="Closing")["entry"]
    save(user_id=str(ba), mode="learning", session_id=t["session_id"])
    save(user_id=str(ba2), mode="free")
    lines = run(pt.plan_lines("o1", day, [str(lead), str(ba), str(ba2)]))
    assert lines == ["*Primetime Wednesday*", "🎤 Sam: Closing (Ayo)", "Free to work with: Kim"]
    assert sec.breakdown_text([], day, primetime=lines).endswith("\n\n*Primetime Wednesday*\n🎤 Sam: Closing (Ayo)\nFree to work with: Kim")
    assert run(pt.plan_lines("o1", day, [str(ObjectId())])) == []
