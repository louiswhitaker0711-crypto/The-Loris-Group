"""Coverage marks: lines are tidied and checked, a mark-off is found by the
map view it overlaps, and only its author or an Admin can remove it."""
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

from routes import coverage as cov  # noqa: E402


def test_lines_are_rounded_and_short_or_foreign_lines_dropped():
    out = cov.clean_lines([[[53.8123456, -1.5612345], [53.8130001, -1.5600009]], [[53.8, -1.5]], [[40.7, -74.0], [40.8, -74.1]]])
    assert out == [[[53.81235, -1.56123], [53.813, -1.56]]]
    with pytest.raises(HTTPException):
        cov.clean_lines([[[53.8, -1.5]]])


class _Req:
    def __init__(self, body=None):
        self._b = body or {}

    async def json(self):
        return self._b


def test_drafts_through_the_day_then_the_leader_confirms_them_black(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(cov, "db", db)
    today = cov._today().isoformat()
    run = asyncio.run
    run(db.sectors.insert_one({"office_id": "o1", "date": today, "leader_id": "lead1", "member_ids": ["lead1", "ba1"], "postcode": "LS6 1AB"}))
    who = {"u": {"id": "ba1", "name": "Ayo Example", "role": "trainee", "office_id": "o1"}}

    async def _user(_r):
        return dict(who["u"])

    monkeypatch.setattr(cov, "get_current_user", _user)
    monkeypatch.setattr(cov, "require_admin_or_leader", _user)
    line = [[[53.81, -1.56], [53.82, -1.55]]]
    doc = run(cov.save_coverage(_Req({"lines": line})))
    assert (doc["status"], doc["sector_leader_id"], doc["postcode"], doc["district"]) == ("draft", "lead1", "LS6 1AB", "LS6")
    assert doc["bbox"] == {"s": 53.81, "w": -1.56, "n": 53.82, "e": -1.55}

    # A BA who isn't in a sector today can't mark off.
    who["u"] = {"id": "ba9", "role": "trainee", "office_id": "o1"}
    with pytest.raises(HTTPException):
        run(cov.save_coverage(_Req({"lines": line})))
    # Only the sector leader (or an Admin) confirms.
    who["u"] = {"id": "ba1", "role": "trainee", "office_id": "o1"}
    with pytest.raises(HTTPException):
        run(cov.confirm_coverage(_Req({"date": today, "leader_id": "lead1"})))
    who["u"] = {"id": "lead1", "name": "Sam Example", "role": "leader", "office_id": "o1"}
    assert run(cov.confirm_coverage(_Req({"date": today})))["confirmed"] == 1
    seen = run(cov.coverage_in_view(_Req(), south=53.80, west=-1.57, north=53.815, east=-1.50))["marks"]
    assert [m["status"] for m in seen] == ["confirmed"]
    assert run(cov.coverage_in_view(_Req(), south=52.0, west=-2.0, north=52.1, east=-1.9))["marks"] == []

    # Removing: the author, the sector leader or an Admin; not another Coach.
    who["u"] = {"id": "lead2", "role": "leader", "office_id": "o1"}
    with pytest.raises(HTTPException):
        run(cov.delete_coverage(doc["id"], _Req()))
    who["u"] = {"id": "lead1", "role": "leader", "office_id": "o1"}
    assert run(cov.delete_coverage(doc["id"], _Req()))["deleted"] is True


def test_bunny_hops_plan_in_colour_and_only_done_strokes_turn_black(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(cov, "db", db)
    today = cov._today().isoformat()
    run = asyncio.run
    run(db.sectors.insert_one({"office_id": "o1", "date": today, "leader_id": "lead1", "member_ids": ["lead1", "ba1", "ba2"],
                               "postcode": "LS6 1AB", "hops": [{"colour": "red", "member_ids": ["ba1", "ba2"]}]}))
    who = {"u": {"id": "lead1", "name": "Sam Example", "role": "trainee", "office_id": "o1"}}   # a BA leading

    async def _user(_r):
        return dict(who["u"])

    monkeypatch.setattr(cov, "get_current_user", _user)
    line = [[[53.81, -1.56], [53.82, -1.55]]]
    plan = run(cov.save_coverage(_Req({"lines": line, "kind": "plan", "colour": "red"})))
    assert (plan["status"], plan["colour"]) == ("plan", "red")
    # A BA can't plan; what they draw is done, in their hop's colour whatever they send.
    who["u"] = {"id": "ba1", "name": "Ayo Example", "role": "trainee", "office_id": "o1"}
    with pytest.raises(HTTPException):
        run(cov.save_coverage(_Req({"lines": line, "kind": "plan", "colour": "blue"})))
    done = run(cov.save_coverage(_Req({"lines": line, "colour": "blue"})))
    assert (done["status"], done["kind"], done["colour"]) == ("draft", "done", "red")
    who["u"] = {"id": "lead1", "name": "Sam Example", "role": "trainee", "office_id": "o1"}
    assert run(cov.confirm_coverage(_Req({"date": today})))["confirmed"] == 1
    # Saved: the black lines stay, the planned area comes off.
    assert run(db.coverage_marks.find_one({"id": plan["id"]})) is None
    assert run(db.coverage_marks.find_one({"id": done["id"]}))["status"] == "confirmed"


def test_a_ba_requests_more_streets_and_the_leader_approves_or_declines(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(cov, "db", db)

    async def _no_push(*a, **k):
        return None

    monkeypatch.setattr(cov, "_push", _no_push)
    today = cov._today().isoformat()
    run = asyncio.run
    run(db.sectors.insert_one({"office_id": "o1", "date": today, "leader_id": "lead1", "member_ids": ["lead1", "ba1"],
                               "hops": [{"colour": "blue", "member_ids": ["ba1"]}]}))
    who = {"u": {"id": "ba1", "name": "Ayo Example", "role": "trainee", "office_id": "o1"}}

    async def _user(_r):
        return dict(who["u"])

    monkeypatch.setattr(cov, "get_current_user", _user)
    line = [[[53.81, -1.56], [53.82, -1.55]]]
    line2 = [[[53.83, -1.56], [53.84, -1.55]]]
    a = run(cov.save_coverage(_Req({"lines": line, "kind": "request"})))
    b = run(cov.save_coverage(_Req({"lines": line2, "kind": "request"})))
    assert (a["status"], a["colour"]) == ("requested", "blue")
    # One request per person: the second send joins the first.
    assert b["id"] == a["id"] and len(b["lines"]) == 2
    assert run(db.coverage_marks.count_documents({"status": "requested"})) == 1
    with pytest.raises(HTTPException):
        run(cov.approve_request(a["id"], _Req()))          # a BA can't approve their own
    who["u"] = {"id": "lead1", "name": "Sam Example", "role": "trainee", "office_id": "o1"}
    run(cov.approve_request(a["id"], _Req()))
    assert run(db.coverage_marks.find_one({"id": a["id"]}))["status"] == "plan"
    # The leader redraws the next one: their lines replace the BA's.
    who["u"] = {"id": "ba1", "name": "Ayo Example", "role": "trainee", "office_id": "o1"}
    c = run(cov.save_coverage(_Req({"lines": line + line2, "kind": "request"})))
    who["u"] = {"id": "lead1", "name": "Sam Example", "role": "trainee", "office_id": "o1"}
    mine = [[[53.85, -1.56], [53.86, -1.55]]]
    run(cov.replace_request(c["id"], _Req({"lines": mine})))
    got = run(db.coverage_marks.find_one({"id": c["id"]}))
    assert got["status"] == "plan" and got["lines"] == mine and got["colour"] == "blue"
    who["u"] = {"id": "ba1", "name": "Ayo Example", "role": "trainee", "office_id": "o1"}
    d = run(cov.save_coverage(_Req({"lines": line, "kind": "request"})))
    who["u"] = {"id": "lead1", "name": "Sam Example", "role": "trainee", "office_id": "o1"}
    run(cov.decline_request(d["id"], _Req()))
    assert run(db.coverage_marks.find_one({"id": d["id"]})) is None
