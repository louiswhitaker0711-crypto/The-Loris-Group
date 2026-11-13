"""The monthly goal planner covers every page of the printed booklet (the
Owner, 13 Nov 2026): both Gap Analysis wheels for everyone, Business/Personal
goals, Recruitment and PR Focus ticks, the four growth KPIs, New Starts Due,
and a quarterly SWOT."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from mongomock_motor import AsyncMongoMockClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import monthly_planners as mp  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture
def db(monkeypatch):
    d = AsyncMongoMockClient()["mgp_test"]
    monkeypatch.setattr(mp, "db", d)
    return d


def test_both_wheels_match_the_booklet():
    assert len(mp.FIELD_GAP_TRAITS) == 16 and len(mp.LEADER_GAP_TRAITS) == 16
    assert "Hitting Sign Up Targets" in mp.LEADER_GAP_TRAITS
    assert "Having a Calendar" in mp.LEADER_GAP_TRAITS and "Planning & Pre-prep" in mp.LEADER_GAP_TRAITS
    assert "Customer Service" not in mp.LEADER_GAP_TRAITS
    assert "Pace Setting" in mp.FIELD_GAP_TRAITS and "Promoting Leaders" in mp.FIELD_GAP_TRAITS


def test_old_mixed_wheel_scores_move_across():
    g = mp._normalize_gap({"scores": {"Hitting Sales Targets": 4, "Customer Service": 3, "Adaptability": 9}})
    assert g["scores"]["Hitting Sign Up Targets"] == 4
    assert g["scores"]["Adaptability"] == 5
    assert g["field_scores"]["Customer Service"] == 3
    assert "Customer Service" not in g["scores"]


def test_everyone_keeps_their_gap_scores():
    doc = mp._strip_for_role({"gap_analysis": {"field_scores": {"Planning": 2}}}, "trainee")
    assert doc["gap_analysis"]["field_scores"]["Planning"] == 2


def test_goals_are_business_or_personal():
    g = mp._normalize_goals({"version": 2, "kpis": [{"name": "Sign-ups", "area": "personal"}],
                             "rocks": [{"name": "Read a book", "area": "nonsense"}]})
    assert g["kpis"][0]["area"] == "personal" and g["rocks"][0]["area"] == "business"


def test_focus_ticks_stay_in_1_to_30():
    assert mp._normalize_focus({"pr": [3, 3, 31, "x", 0, 1]}) == {"recruitment": [], "pr": [1, 3]}


def test_swot_is_quarterly():
    assert mp._quarter("2026-10") == mp._quarter("2026-12") != mp._quarter("2027-01")


def test_new_starts_due_and_growth(db):
    async def go():
        await db.new_hires.insert_many([
            {"id": "h1", "name": "Example One", "office_id": "o", "leader_user_id": "c1",
             "start_date": "2026-11-02", "current_day": 8},
            {"id": "h2", "name": "Example Two", "office_id": "o", "leader_user_id": "c1",
             "start_date": "2026-12-01", "current_day": 1},
        ])
        await db.daily_assessments.insert_many(
            [{"new_hire_id": "h1", "day_number": d, "completed": True, "kpi_sales": 1} for d in range(1, 9)])
        await db.sectors.insert_one({"date": "2026-11-04", "member_ids": ["c1", "n1"],
                                     "hops": [{"member_ids": ["c1", "n1"], "shadow_ids": ["n1"]}]})
        rows = await mp._new_starts_due({"id": "c1", "role": "trainee", "office_id": "o"}, "2026-11")
        shadows = await mp._shadowers_taken("c1", "2026-11")
        return rows, shadows
    rows, shadows = _run(go())
    assert [r["name"] for r in rows] == ["Example One"]
    assert rows[0]["sign_ups_first_3"] == 3 and rows[0]["completed_6"] and rows[0]["attended"]
    assert shadows == 1
