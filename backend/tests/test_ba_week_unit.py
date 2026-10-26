"""BA one-page weekly plan: a BA plans only their own week, can't submit
without a goal, and Coaches/Admins read it within their scope only."""
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

from routes import weekly_planners as wp  # noqa: E402


def _run(c):
    return asyncio.new_event_loop().run_until_complete(c)


class _Req:
    def __init__(self, body=None):
        self._body = body or {}
        self.headers = {"content-type": "application/json"}

    async def json(self):
        return self._body


def _as(monkeypatch, me):
    async def _me(_r):
        return me
    monkeypatch.setattr(wp, "get_current_user", _me)


def test_ba_cannot_plan_someone_else(monkeypatch):
    me = {"id": str(ObjectId()), "role": "trainee", "office_id": "o1"}
    _as(monkeypatch, me)
    with pytest.raises(HTTPException) as e:
        _run(wp.set_crew_member_plan(str(ObjectId()), _Req({"week_ending": "2026-11-01"})))
    assert e.value.status_code == 403


def test_submit_needs_a_goal(monkeypatch):
    me = {"id": str(ObjectId()), "role": "trainee", "office_id": "o1"}
    _as(monkeypatch, me)

    class _Bells:
        async def find_one(self, *a, **k):
            return {"weekly_goal": None}
    monkeypatch.setattr(wp, "db", SimpleNamespace(bells_entries=_Bells()))
    with pytest.raises(HTTPException) as e:
        _run(wp.submit_ba_week(_Req({"week_ending": "2026-11-01"})))
    assert e.value.status_code == 400


def test_reading_someone_elses_week_is_scoped(monkeypatch):
    ba = {"_id": ObjectId(), "name": "Example Person", "role": "trainee", "office_id": "o1"}

    class _Users:
        async def find_one(self, q, *a, **k):
            return dict(ba) if q.get("_id") == ba["_id"] else None
    monkeypatch.setattr(wp, "db", SimpleNamespace(users=_Users()))

    async def _subtree(uid):
        return [uid]
    monkeypatch.setattr(wp, "get_subtree_ids", _subtree)

    other_ba = {"id": str(ObjectId()), "role": "trainee", "office_id": "o1"}
    with pytest.raises(HTTPException):
        _run(wp._ba_week_target(other_ba, str(ba["_id"])))
    away_admin = {"id": str(ObjectId()), "role": "admin", "office_id": "o2"}
    with pytest.raises(HTTPException):
        _run(wp._ba_week_target(away_admin, str(ba["_id"])))
    office_admin = {"id": str(ObjectId()), "role": "admin", "office_id": "o1"}
    assert _run(wp._ba_week_target(office_admin, str(ba["_id"])))["_id"] == ba["_id"]


def test_meeting_cod_pick_survives_a_save():
    days = wp._normalize_days({"2": {"leaders_meeting": "Objection handling", "leaders_meeting_cod": "mod-123"}})
    assert days["2"]["leaders_meeting_cod"] == "mod-123"
    assert days["2"]["morning_topic_cod"] == ""


def test_office_target_prefers_the_office_goal_then_top_crew_goals():
    names = {"a": "A", "b": "B", "c": "C"}
    up = {"a": "", "b": "a", "c": ""}
    rows = [{"user_id": "a", "team_weekly_goal": 30}, {"user_id": "b", "team_weekly_goal": 12},
            {"user_id": "c", "team_weekly_goal": 10}]
    assert wp._office_target({"weekly_goal": 50}, rows, names, up) == 50
    assert wp._office_target({}, rows, names, up) == 40      # a + c, b reports to a
    assert wp._office_target({}, [], names, up) is None
