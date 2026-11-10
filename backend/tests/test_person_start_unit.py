"""Admin fixes a start date / marks someone "Not a new start" (the Owner,
10 Nov 2026): the new-start record closes, graded days stay, the AI treats
them as established, and "Back to new start" reopens it."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from bson import ObjectId
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import ai_context  # noqa: E402
from routes import people  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class _Req:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


@pytest.fixture
def db(monkeypatch):
    d = AsyncMongoMockClient()["start_test"]
    monkeypatch.setattr(people, "db", d)
    monkeypatch.setattr(ai_context, "db", d)
    return d


def _as(monkeypatch, user):
    async def me(_req):
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
        return user
    monkeypatch.setattr(people, "require_admin", me)


def _seed(db):
    uid = ObjectId()
    _run(db.users.insert_one({"_id": uid, "name": "Example Person", "role": "trainee", "office_id": "o1"}))
    _run(db.new_hires.insert_one({"id": "h1", "trainee_user_id": str(uid), "office_id": "o1", "active": True,
                                  "start_date": "2026-10-12", "current_day": 1}))
    for day in range(1, 9):
        _run(db.daily_assessments.insert_one({"id": f"a{day}", "new_hire_id": "h1", "day_number": day,
                                              "completed": True, "kpi_sales": 2}))
    return str(uid)


ADMIN = {"id": "admin1", "role": "admin", "office_id": "o1"}


def test_not_a_new_start_closes_the_record_and_keeps_graded_days(db, monkeypatch):
    uid = _seed(db)
    _as(monkeypatch, ADMIN)
    out = _run(people.set_start(uid, _Req({"start_date": None, "new_start": False})))
    assert out == {"user_id": uid, "start_date": None, "new_start": False}
    hire = _run(db.new_hires.find_one({"id": "h1"}))
    assert hire["active"] is False and hire["closed_out_reason"] == "not_new_start"
    assert "start_date" not in hire
    assert _run(db.daily_assessments.count_documents({"new_hire_id": "h1", "completed": True})) == 8
    dev = _run(ai_context.development_of(uid))
    assert "new_start" not in dev and dev["stage_of_development"].startswith("established")


def test_back_to_new_start_reopens_it(db, monkeypatch):
    uid = _seed(db)
    _as(monkeypatch, ADMIN)
    _run(people.set_start(uid, _Req({"start_date": "2026-06-01", "new_start": False})))
    assert _run(db.users.find_one({"_id": ObjectId(uid)}))["start_date"] == "2026-06-01"
    with pytest.raises(HTTPException):
        _run(people.set_start(uid, _Req({"start_date": None, "new_start": True})))
    out = _run(people.set_start(uid, _Req({"start_date": "2026-11-09", "new_start": True})))
    assert out["new_start"] is True
    hire = _run(db.new_hires.find_one({"id": "h1"}))
    assert hire["active"] is True and "closed_out_reason" not in hire and hire["start_date"] == "2026-11-09"


def test_only_admins_and_no_future_dates(db, monkeypatch):
    uid = _seed(db)
    _as(monkeypatch, {"id": "c1", "role": "leader", "office_id": "o1"})
    with pytest.raises(HTTPException):
        _run(people.set_start(uid, _Req({"start_date": None, "new_start": False})))
    _as(monkeypatch, ADMIN)
    with pytest.raises(HTTPException) as e:
        _run(people.set_start(uid, _Req({"start_date": "2099-01-01"})))
    assert e.value.status_code == 400


def test_another_office_is_refused(db, monkeypatch):
    uid = _seed(db)
    _as(monkeypatch, {"id": "admin2", "role": "admin", "office_id": "o2"})
    with pytest.raises(HTTPException) as e:
        _run(people.set_start(uid, _Req({"new_start": False})))
    assert e.value.status_code == 403
