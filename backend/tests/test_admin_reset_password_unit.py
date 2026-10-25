"""Admin → Reset password: one person gets a temporary password that expires
and must be changed on sign-in. Office admins stay in their office and can't
reset another admin."""
import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from bson import ObjectId
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import auth_routes  # noqa: E402


def _run(c):
    return asyncio.new_event_loop().run_until_complete(c)


class _Users:
    def __init__(self, doc):
        self.doc = doc
        self.updates = []

    async def find_one(self, q, *a, **k):
        return dict(self.doc) if self.doc and q.get("_id") == self.doc["_id"] else None

    async def update_one(self, q, u):
        self.updates.append(u)


class _Resets:
    def __init__(self):
        self.deleted = []

    async def delete_many(self, q):
        self.deleted.append(q)


def _setup(monkeypatch, target, admin):
    users, resets = _Users(target), _Resets()
    monkeypatch.setattr(auth_routes, "db", SimpleNamespace(users=users, password_resets=resets))

    async def _admin(_req):
        return admin
    monkeypatch.setattr(auth_routes, "require_admin", _admin)
    return users, resets


def _call(uid, pw="temp-pass-1"):
    return auth_routes.admin_reset_user_password(str(uid), auth_routes.ResetUserPasswordBody(password=pw), SimpleNamespace())


OWNER = {"id": str(ObjectId()), "email": "owner@example.org", "is_super_admin": True, "office_id": "o1"}
OFFICE_ADMIN = {"id": str(ObjectId()), "email": "admin@example.org", "is_super_admin": False, "office_id": "o1"}


def test_reset_sets_a_held_expiring_password(monkeypatch):
    uid = ObjectId()
    users, resets = _setup(monkeypatch, {"_id": uid, "name": "Example Person", "email": "Ba@Example.org",
                                         "role": "trainee", "office_id": "o1"}, OWNER)
    out = _run(_call(uid))
    s = users.updates[0]["$set"]
    assert s["must_change_password"] is True and s["starter_password_expires_at"]
    assert s["password_hash"] != "temp-pass-1"
    assert users.updates[0]["$inc"] == {"session_version": 1}
    assert resets.deleted == [{"email": "ba@example.org"}]
    assert out["days"] == 7


def test_short_password_refused(monkeypatch):
    uid = ObjectId()
    _setup(monkeypatch, {"_id": uid, "role": "trainee", "office_id": "o1"}, OWNER)
    with pytest.raises(HTTPException) as e:
        _run(_call(uid, "short"))
    assert e.value.status_code == 400


def test_office_admin_stays_in_office_and_off_admins(monkeypatch):
    uid = ObjectId()
    _setup(monkeypatch, {"_id": uid, "role": "trainee", "office_id": "other"}, OFFICE_ADMIN)
    with pytest.raises(HTTPException) as e:
        _run(_call(uid))
    assert e.value.status_code == 403
    _setup(monkeypatch, {"_id": uid, "role": "admin", "office_id": "o1"}, OFFICE_ADMIN)
    with pytest.raises(HTTPException) as e:
        _run(_call(uid))
    assert e.value.status_code == 403


def test_cannot_reset_yourself(monkeypatch):
    uid = ObjectId(OWNER["id"])
    _setup(monkeypatch, {"_id": uid, "role": "admin", "office_id": "o1"}, OWNER)
    with pytest.raises(HTTPException) as e:
        _run(_call(uid))
    assert e.value.status_code == 400
