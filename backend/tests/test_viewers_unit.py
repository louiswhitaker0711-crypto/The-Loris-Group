"""Read-only viewers: the Owner adds one, it's an Admin in their office that
the read-only guard covers at once, and it can be removed."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
os.environ.setdefault("JWT_SECRET", "local-dummy-secret-0123456789abcdef0123456789")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import auth  # noqa: E402
from routes import viewers as vw  # noqa: E402


class _Req:
    def __init__(self, body=None):
        self._b = body or {}

    async def json(self):
        return self._b


def test_the_owner_adds_a_viewer_who_is_read_only_at_once(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(vw, "db", db)
    monkeypatch.setattr(auth, "db", db)
    who = {"u": {"id": "owner1", "role": "admin", "is_super_admin": True, "office_id": "o1"}}

    async def _owner(_r):
        if not who["u"].get("is_super_admin"):
            raise HTTPException(status_code=403, detail="Super admin required")
        return dict(who["u"])

    monkeypatch.setattr(vw, "require_super_admin", _owner)
    run = asyncio.run
    v = run(vw.add_viewer(_Req({"name": "Coach Example", "email": "Coach@Example.org", "password": "long-enough-1"})))
    doc = run(db.users.find_one({"email": "coach@example.org"}))
    assert (doc["role"], doc["office_id"], doc["is_demo"], doc["is_viewer"]) == ("admin", "o1", True, True)
    assert v["id"] in run(auth.demo_user_ids())            # the write guard covers them straight away
    assert [x["name"] for x in run(vw.list_viewers(_Req()))["viewers"]] == ["Coach Example"]
    with pytest.raises(HTTPException):
        run(vw.add_viewer(_Req({"name": "Again", "email": "coach@example.org", "password": "long-enough-1"})))
    with pytest.raises(HTTPException):
        run(vw.add_viewer(_Req({"name": "Short", "email": "short@example.org", "password": "short"})))
    who["u"] = {"id": "admin2", "role": "admin", "office_id": "o1"}          # not the Owner
    with pytest.raises(HTTPException):
        run(vw.add_viewer(_Req({"name": "Nope", "email": "nope@example.org", "password": "long-enough-1"})))
    who["u"] = {"id": "owner1", "role": "admin", "is_super_admin": True, "office_id": "o1"}
    run(vw.remove_viewer(v["id"], _Req()))
    assert run(vw.list_viewers(_Req()))["viewers"] == []
