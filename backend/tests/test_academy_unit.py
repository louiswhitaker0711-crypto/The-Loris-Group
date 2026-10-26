"""BA Academy workbook (routes/academy.py): what a save keeps, and what the
Owner's class card reads from a workbook."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.academy import clean_state, summary, _day, academy_day, MAX_TEXT  # noqa: E402


def test_keeps_notes_done_and_answers():
    out = clean_state({
        "fields": {"b-v1": "work ethic", "n1": "notes here"},
        "done": {"s1": True, "s2": False},
        "quiz": {"q1": {"0": 2, "1": 1}},
    })
    assert out["fields"] == {"b-v1": "work ethic", "n1": "notes here"}
    assert out["done"] == {"s1": True}
    assert out["quiz"] == {"q1": {"0": 2, "1": 1}}


def test_drops_bad_keys_and_values_without_losing_the_rest():
    out = clean_state({
        "fields": {"ok": "kept", "bad key!": "x", "num": 5, "$where": "x"},
        "done": {"s1": "yes", "s2": True},
        "quiz": {"q1": {"0": True, "x": 1, "1": 99, "2": 3}, "q2": "nope"},
    })
    assert out["fields"] == {"ok": "kept"}
    assert out["done"] == {"s2": True}
    assert out["quiz"] == {"q1": {"2": 3}}


def test_long_notes_are_trimmed_not_refused():
    out = clean_state({"fields": {"n1": "a" * (MAX_TEXT + 50)}})
    assert len(out["fields"]["n1"]) == MAX_TEXT


def test_wrong_shapes_are_refused():
    with pytest.raises(HTTPException):
        clean_state([])
    with pytest.raises(HTTPException):
        clean_state({"fields": "text"})
    with pytest.raises(HTTPException):
        clean_state({"fields": {f"k{i}": "x" for i in range(1000)}})


def test_only_day_1_and_2():
    assert _day(1) == 1 and _day(2) == 2
    with pytest.raises(HTTPException):
        _day(3)


def test_summary_reads_questions_and_progress():
    s = summary({"fields": {"questions": "  How do I get my UTR?  ", "n1": "x"},
                 "done": {"s1": True}, "quiz": {"q1": {"0": 1}}, "updated_at": "t"})
    assert s == {"done": {"s1": True}, "quiz": {"q1": {"0": 1}},
                 "questions": "How do I get my UTR?", "updated_at": "t"}
    assert summary(None)["questions"] == ""


# ── Reading someone else's workbook (the Owner's class card) ──────────────

import asyncio  # noqa: E402

from bson import ObjectId  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402
from starlette.requests import Request  # noqa: E402

import auth  # noqa: E402
from routes import academy  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _req():
    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}
    return Request({"type": "http", "method": "GET", "path": "/test", "query_string": b"", "headers": [],
                    "client": ("10.0.0.9", 5000), "server": ("test", 443), "scheme": "https"}, receive)


@pytest.fixture()
def mdb(monkeypatch):
    database = AsyncMongoMockClient()["academy_test"]
    monkeypatch.setattr(auth, "db", database)
    monkeypatch.setattr(academy, "db", database)
    return database


def _user(db, name, role, office="o1"):
    doc = {"_id": ObjectId(), "name": name, "role": role, "office_id": office}
    _run(db.users.insert_one(doc))
    return {**doc, "id": str(doc["_id"])}


def _as(monkeypatch, user):
    async def current(_request):
        return dict(user)
    monkeypatch.setattr(academy, "get_current_user", current)


def test_the_owner_opens_a_new_starts_workbook_read_only(mdb, monkeypatch):
    owner = _user(mdb, "Owner Example", "admin")
    new = _user(mdb, "New Example", "trainee")
    _run(mdb.new_hires.insert_one({"id": "h1", "office_id": "o1", "trainee_user_id": new["id"],
                                   "name": "New Example", "current_day": 1, "active": True}))
    _run(mdb.academy_workbooks.insert_one({"user_id": new["id"], "day": 1, "fields": {"n1": "notes"},
                                           "done": {"s1": True}, "quiz": {}}))
    _as(monkeypatch, owner)
    got = _run(academy.get_workbook(1, _req(), user_id=new["id"]))
    assert got["read_only"] is True and got["name"] == "New Example"
    assert got["fields"] == {"n1": "notes"} and got["done"] == {"s1": True}


def test_another_offices_admin_cant_open_it(mdb, monkeypatch):
    other = _user(mdb, "Other Owner", "admin", office="o2")
    new = _user(mdb, "New Example", "trainee")
    _run(mdb.new_hires.insert_one({"id": "h1", "office_id": "o1", "trainee_user_id": new["id"], "active": True}))
    _as(monkeypatch, other)
    with pytest.raises(HTTPException):
        _run(academy.get_workbook(1, _req(), user_id=new["id"]))
    with pytest.raises(HTTPException):
        _run(academy.get_workbook(1, _req(), user_id="not-an-id"))


def test_academy_day_moves_to_day_2_the_day_after_they_start():
    hire = {"current_day": 1, "start_date": "2026-10-26"}
    assert academy_day(hire, "2026-10-26") == 1
    assert academy_day(hire, "2026-10-27") == 2


def test_academy_day_is_2_once_day_1_is_graded():
    assert academy_day({"current_day": 2, "start_date": "2026-10-26"}, "2026-10-26") == 2


def test_academy_day_defaults_to_1():
    assert academy_day(None) == 1
    assert academy_day({"current_day": 1, "start_date": ""}, "2026-10-27") == 1
    assert academy_day({"current_day": "x", "start_date": "bad"}, "2026-10-27") == 1
