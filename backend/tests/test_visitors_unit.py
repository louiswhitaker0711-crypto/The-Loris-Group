"""Visitors (core/visitors.py, routes/visitors.py): in sectors, hops and
Primetime on their visit days, never on Bells or KPIs, Stage 3+ are Coaches,
and their breakdown counts towards the sector's sign-ups."""
import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import visitors as cv  # noqa: E402
from routes import visitors as rv  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_stage_3_and_up_are_coaches():
    assert cv.role_for_stage("3") == "leader"
    assert cv.role_for_stage("SL") == "leader"
    assert cv.role_for_stage("5") == "leader"
    assert cv.role_for_stage("2") == "trainee"
    assert cv.role_for_stage("1") == "trainee"


def test_on_visit_and_over():
    v = {"is_visitor": True, "visit_from": "2026-11-17", "visit_to": "2026-11-20"}
    assert not cv.on_visit(v, "2026-11-16")
    assert cv.on_visit(v, "2026-11-17") and cv.on_visit(v, "2026-11-20")
    assert not cv.visit_over(v, "2026-11-20") and cv.visit_over(v, "2026-11-21")
    assert not cv.visit_over({"visit_to": "2026-01-01"}, "2026-11-21")   # not a visitor


def test_field_filter_lets_visitors_in_only_on_their_days():
    db = AsyncMongoMockClient()["visitors_test"]
    _run(db.users.insert_many([
        {"name": "Example Person", "office_id": "o"},
        {"name": "Example Trial", "office_id": "o", "is_demo": True},
        {"name": "Example Visitor", "office_id": "o", "is_demo": True, "is_visitor": True,
         "visit_from": "2026-11-17", "visit_to": "2026-11-20"},
    ]))

    def names(iso, q=None):
        q = cv.with_field_filter({"office_id": "o", "is_demo": {"$ne": True}, **(q or {})}, iso)
        return sorted(u["name"] for u in _run(db.users.find(q).to_list(10)))

    assert names("2026-11-16") == ["Example Person"]
    assert names("2026-11-18") == ["Example Person", "Example Visitor"]
    assert names("2026-11-21") == ["Example Person"]
    # An $or already in the query is kept alongside.
    assert names("2026-11-18", {"$or": [{"name": "Example Visitor"}]}) == ["Example Visitor"]


def test_visitor_sign_ups_come_from_their_breakdown():
    db = AsyncMongoMockClient()["visitors_test2"]
    cv.db = db
    vid = _run(db.users.insert_one({"name": "Example Visitor", "is_visitor": True, "is_demo": True})).inserted_id
    pid = _run(db.users.insert_one({"name": "Example Person"})).inserted_id
    _run(db.sector_days.insert_many([
        {"user_id": str(vid), "date": "2026-11-18", "breakdown": {"hit": 4, "gold": 3, "silver": 1, "round": 2}},
        {"user_id": str(pid), "date": "2026-11-18", "breakdown": {"hit": 5}},
    ]))
    out = _run(cv.visitor_day_numbers([str(vid), str(pid)], "2026-11-18"))
    assert out == {str(vid): {"hit": 4, "silver": 1, "gold": 3, "round": 2}}


def test_breakdown_never_writes_kpis_or_bells_for_a_visitor(monkeypatch):
    from core import breakdown_numbers as bn
    db = AsyncMongoMockClient()["visitors_test3"]
    bn.db = db

    async def off():
        return False
    import owneriq_sync
    monkeypatch.setattr(owneriq_sync, "owneriq_on", off)
    _run(bn.apply_breakdown({"_id": "v1", "office_id": "o", "is_visitor": True}, "2026-11-18",
                            {"doors": 120, "spoken": 70, "pitched": 25, "closed": 15, "hit": 4}))
    assert _run(db.owneriq_kpis.count_documents({})) == 0
    assert _run(db.bells_entries.count_documents({})) == 0


def test_signup_checks():
    assert rv._clean_stage("Stage 3") == "3"
    assert rv._clean_stage("3+") == "SL"
    with pytest.raises(HTTPException):
        rv._clean_stage("")
    assert rv._clean_dates("2026-11-17", "2026-11-20") == ("2026-11-17", "2026-11-20")
    for a, b in [("2026-11-20", "2026-11-17"), ("", "2026-11-20"), ("2026-11-01", "2026-12-20")]:
        with pytest.raises(HTTPException):
            rv._clean_dates(a, b)
    with pytest.raises(HTTPException):
        rv._clean_office("  ")
