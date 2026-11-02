"""Follow-ups from the planner (routes/followups.py): for you, or you and
someone on your team; shown on the day, due on Home, pushed once at the time."""
import asyncio
import os
import sys
from datetime import datetime
from pathlib import Path

import pytest
from bson import ObjectId
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import followups as fu  # noqa: E402
from core.app_time import APP_TZ  # noqa: E402


def test_planner_link_is_the_due_days_page():
    assert fu.planner_url("2026-11-04") == "/weekly-planner?week=2026-11-08&day=2"   # Wednesday
    assert fu.due_at({"due_date": "2026-11-04", "due_time": ""}) == "2026-11-04 09:00"


def test_set_list_tick_and_push(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(fu, "db", db)
    run = asyncio.run
    coach, ba, other = ObjectId(), ObjectId(), ObjectId()
    for oid, name, role in ((coach, "Lou Example", "leader"), (ba, "Ayo Example", "trainee"), (other, "Kim Example", "trainee")):
        run(db.users.insert_one({"_id": oid, "name": name, "office_id": "o1", "role": role}))
    who = {"u": {"id": str(coach), "name": "Lou Example", "role": "leader", "office_id": "o1"}}

    async def _user(_r):
        return dict(who["u"])

    async def _subtree(_uid):
        return [str(coach), str(ba)]

    pushes = []

    async def _push(uid, title, body, data=None):
        pushes.append((uid, title, body))

    monkeypatch.setattr(fu, "get_current_user", _user)
    monkeypatch.setattr(fu, "get_subtree_ids", _subtree)
    monkeypatch.setattr(fu, "send_push_to_user", _push)
    monkeypatch.setattr(fu, "_now_uk", lambda: datetime(2026, 11, 2, 8, 0, tzinfo=APP_TZ))

    made = run(fu.create_followup(fu.FollowUpBody(text="Review Ayo's closing", due_date="2026-11-04",
                                                  due_time="10:30", also_user_id=str(ba)), None))["followup"]
    assert made["with_names"] == ["Ayo Example"]
    with pytest.raises(HTTPException):   # not on my team
        run(fu.create_followup(fu.FollowUpBody(text="x", due_date="2026-11-04", also_user_id=str(other)), None))
    with pytest.raises(HTTPException):   # in the past
        run(fu.create_followup(fu.FollowUpBody(text="x", due_date="2026-11-01"), None))

    assert len(run(fu.list_followups(None, date="2026-11-04"))["followups"]) == 1
    who["u"] = {"id": str(ba), "name": "Ayo Example", "role": "trainee", "office_id": "o1"}
    theirs = run(fu.list_followups(None, date="2026-11-04"))["followups"][0]
    assert theirs["from_name"] == "Lou Example" and not theirs["mine"]

    # Not yet due, then due: pushed once to both.
    assert run(fu.followup_push_tick(datetime(2026, 11, 4, 10, 29, tzinfo=APP_TZ))) == 0
    assert run(fu.followup_push_tick(datetime(2026, 11, 4, 10, 30, tzinfo=APP_TZ))) == 2
    assert run(fu.followup_push_tick(datetime(2026, 11, 4, 10, 31, tzinfo=APP_TZ))) == 0
    assert {p[1] for p in pushes} == {"Follow-up", "Follow-up from Lou"}

    # Due on Home until ticked; ticking is per person.
    monkeypatch.setattr(fu, "_now_uk", lambda: datetime(2026, 11, 5, 9, 0, tzinfo=APP_TZ))
    assert len(run(fu.list_followups(None, due=True))["followups"]) == 1
    run(fu.tick_followup(made["id"], fu.DoneBody(done=True), None))
    assert run(fu.list_followups(None, due=True))["followups"] == []
    who["u"] = {"id": str(coach), "name": "Lou Example", "role": "leader", "office_id": "o1"}
    assert len(run(fu.list_followups(None, due=True))["followups"]) == 1
