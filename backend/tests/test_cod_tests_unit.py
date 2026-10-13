"""COD tests a Coach sets: one open request per item, a quiz pass after the
request clears it, and only Coaches who can grade the BA can set them."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import cod_tests as ct  # noqa: E402


class _Req:
    def __init__(self, body=None):
        self._b = body or {}

    async def json(self):
        return self._b


def test_requests_open_until_the_quiz_is_passed(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    import routes.modules as mods
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(ct, "db", db)
    who = {"u": {"id": "coach1", "name": "Sam Example", "role": "leader", "office_id": "o1"}}

    async def _user(_r):
        return dict(who["u"])

    async def _can(user, target, stage):
        return user["id"] == "coach1" and target == "ba1"

    monkeypatch.setattr(ct, "get_current_user", _user)
    monkeypatch.setattr(mods, "_user_can_grade_target", _can)
    run = asyncio.run
    run(db.training_modules.insert_one({"id": "m1", "title": "The 5 Steps", "stage": 1}))
    assert run(ct.create_test_requests(_Req({"user_id": "ba1", "module_ids": ["m1"]})))["created"] == 1
    assert run(ct.create_test_requests(_Req({"user_id": "ba1", "module_ids": ["m1"]})))["created"] == 0   # already open
    with pytest.raises(HTTPException):
        run(ct.create_test_requests(_Req({"user_id": "ba2", "module_ids": ["m1"]})))                 # not theirs
    who["u"] = {"id": "ba1", "role": "trainee", "office_id": "o1"}
    assert [r["module_title"] for r in run(ct.my_test_requests(_Req()))["requests"]] == ["The 5 Steps"]
    run(db.module_progress.insert_one({"module_id": "m1", "user_id": "ba1", "quiz_passed_at": "2999-01-01T00:00:00+00:00"}))
    assert run(ct.my_test_requests(_Req()))["requests"] == []
