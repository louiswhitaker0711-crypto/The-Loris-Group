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


def test_breakdown_keeps_a_visitors_own_kpis_but_never_bells(monkeypatch):
    from core import breakdown_numbers as bn
    db = AsyncMongoMockClient()["visitors_test3"]
    bn.db = db

    async def off():
        return False
    import owneriq_sync
    monkeypatch.setattr(owneriq_sync, "owneriq_on", off)
    _run(bn.apply_breakdown({"_id": "v1", "office_id": "o", "is_visitor": True}, "2026-11-18",
                            {"doors": 120, "spoken": 70, "pitched": 25, "closed": 15, "hit": 4}))
    rows = _run(db.owneriq_kpis.find({}).to_list(10))
    assert len(rows) == 1
    r = rows[0]
    # Their own KPI row: marked visitor and no office pin, so it never goes
    # into the office's figures (the Owner, 17 Nov 2026).
    assert r["cg1_user_id"] == "v1" and r["visitor"] is True and r["mc_pin"] is None
    assert r["doors_knocked"] == 120 and r["sales"] == 4
    assert _run(db.bells_entries.count_documents({})) == 0


def test_breakdown_for_a_slim_visitor_doc_still_skips_the_office(monkeypatch):
    """Someone else saving a visitor's breakdown passes a slim user doc
    (no is_visitor): the flag is looked up, so the row gets no office pin."""
    from core import breakdown_numbers as bn
    db = AsyncMongoMockClient()["visitors_test5"]
    bn.db = db

    async def off():
        return False
    import owneriq_sync
    monkeypatch.setattr(owneriq_sync, "owneriq_on", off)
    _run(db.users.insert_one({"_id": "v2", "office_id": "o", "is_visitor": True}))
    _run(bn.apply_breakdown({"_id": "v2", "office_id": "o", "name": "Example Visitor"}, "2026-11-18",
                            {"doors": 120, "spoken": 70, "pitched": 25, "closed": 15, "hit": 4}))
    r = _run(db.owneriq_kpis.find_one({}))
    assert r["visitor"] is True and r["mc_pin"] is None
    assert _run(db.bells_entries.count_documents({})) == 0


def test_old_visitor_kpi_rows_leave_the_office():
    from core.content_fixes import _fix_visitor_kpi_rows
    db = AsyncMongoMockClient()["visitors_test6"]
    _run(db.users.insert_many([{"_id": "v3", "is_visitor": True}, {"_id": "b1"}]))
    _run(db.owneriq_kpis.insert_many([{"_id": "a", "cg1_user_id": "v3", "mc_pin": "1234"},
                                      {"_id": "b", "cg1_user_id": "b1", "mc_pin": "1234"}]))
    assert _run(_fix_visitor_kpi_rows(db)) == 1
    a = _run(db.owneriq_kpis.find_one({"_id": "a"}))
    assert a["visitor"] is True and a["mc_pin"] is None
    assert _run(db.owneriq_kpis.find_one({"_id": "b"}))["mc_pin"] == "1234"
    assert _run(_fix_visitor_kpi_rows(db)) == 0


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


def test_visiting_coaches_are_asked_to_start_their_sector(monkeypatch):
    """A visiting Coach on their visit days gets the "start your sector
    set-up" push like the office's own Coaches (the Owner, 17 Nov 2026)."""
    from routes import sector as rs
    db = AsyncMongoMockClient()["visitors_sector_test"]
    today = cv.today_iso()
    _run(db.users.insert_many([
        {"name": "Example Coach", "role": "leader", "office_id": "o"},
        {"name": "Example Visitor", "role": "leader", "office_id": "o", "is_demo": True, "is_visitor": True,
         "visit_from": today, "visit_to": today},
        {"name": "Example Gone", "role": "leader", "office_id": "o", "is_demo": True, "is_visitor": True,
         "visit_from": "2020-01-01", "visit_to": "2020-01-02"},
        {"name": "Example Trial", "role": "leader", "office_id": "o", "is_demo": True},
    ]))
    monkeypatch.setattr(rs, "db", db)
    ids = set(_run(rs._leaders_out_today()))
    names = {str(u["_id"]): u["name"] for u in _run(db.users.find({}).to_list(10))}
    assert sorted(names[i] for i in ids) == ["Example Coach", "Example Visitor"]
