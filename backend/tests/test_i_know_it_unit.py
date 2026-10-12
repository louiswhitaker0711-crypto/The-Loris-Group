"""'I know this' (POST /module-progress/{id}/know): anyone, BAs included,
ticks Know on their own item; Do and above stay with the Coach, so a Know
that a Coach has built on can't be unticked, and self-grading stops at Know."""
import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import modules  # noqa: E402
from routes.modules import KnowBody  # noqa: E402

BA = {"id": "u-ba", "role": "trainee", "office_id": "office-A", "owneriq_stage": "stage_1"}


def _run(coro):
    return asyncio.run(coro)


def _setup(monkeypatch):
    db = AsyncMongoMockClient()["t"]

    async def _user(_request):
        return dict(BA)

    monkeypatch.setattr(modules, "db", db)
    async def _subtree(uid):
        return [uid]

    monkeypatch.setattr(modules, "get_current_user", _user)
    monkeypatch.setattr(modules, "get_subtree_ids", _subtree)
    _run(db.training_modules.insert_one({"id": "m1", "stage": 1, "office_id": "office-A", "topic": "Image"}))
    return db


def test_a_ba_ticks_and_unticks_know(monkeypatch):
    db = _setup(monkeypatch)
    row = _run(modules.set_i_know_it("m1", KnowBody(know=True), request=None))
    assert row["ladder"] == 1 and row["ladder_dates"].get("know")
    row = _run(modules.set_i_know_it("m1", KnowBody(know=False), request=None))
    assert row["ladder"] == 0 and not row["ladder_dates"]
    assert _run(db.module_progress.count_documents({})) == 1


def test_know_cannot_be_unticked_once_the_coach_signed_more(monkeypatch):
    db = _setup(monkeypatch)
    _run(db.module_progress.insert_one({"id": "p1", "module_id": "m1", "target_user_id": "u-ba",
                                        "user_id": "u-ba", "stage": 1, "ladder": 2}))
    assert _run(modules.set_i_know_it("m1", KnowBody(know=True), request=None))["ladder"] == 2
    with pytest.raises(HTTPException):
        _run(modules.set_i_know_it("m1", KnowBody(know=False), request=None))


def test_a_ba_cannot_open_a_stage_above_their_owneriq_stage(monkeypatch):
    db = _setup(monkeypatch)
    _run(db.training_modules.insert_one({"id": "m3", "stage": 3, "office_id": "office-A", "topic": "Hosting"}))
    with pytest.raises(HTTPException):
        _run(modules.set_i_know_it("m3", KnowBody(know=True), request=None))
