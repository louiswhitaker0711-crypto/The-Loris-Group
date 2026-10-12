"""Sector set-up and breakdown: the WhatsApp text matches the office's own
layout, inputs are checked, and the next day's KPI suggestion is the step
furthest behind the Law of Averages. Placeholder names only."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import sector as sec  # noqa: E402


def test_breakdown_text_matches_the_office_layout():
    rows = [
        {"user_name": "Alex Example", "breakdown": {"doors": 82, "spoken": 57, "pitched": 20, "closed": 17,
         "note": "phone died", "goal": 3, "hit": 1, "proud": "shorten my pitch", "change": "SEE"}},
        {"user_name": "Sam Example", "breakdown": {"doors": 95, "spoken": 64, "pitched": 20, "closed": 13,
         "goal": 5, "hit": 5, "proud": "good intro", "change": "speak to 80"}},
        {"user_name": "Nobody Yet", "breakdown": None},
    ]
    assert sec.breakdown_text(rows, "2026-10-12") == (
        "*Breakdown* 12/10\n\n*Alex*\n82/57/20/17 (phone died)\nGoal: 3 hit: 1\nProud of: shorten my pitch\nChange: SEE"
        "\n\n*Sam*\n95/64/20/13\nGoal: 5 hit: 5🔥\nProud of: good intro\nChange: speak to 80")


def test_setup_text_matches_the_office_layout():
    rows = [{"user_name": "Alex Example", "setup": {"goal": 4, "kpi_metric": "closes", "kpi_target": 20, "focus": "KISS"}},
            {"user_name": "Sam Example", "setup": {"goal": 4, "kpi_metric": "spoken", "kpi_target": 70, "focus": "handling objections"}}]
    assert sec.setup_text(rows, "2026-10-13") == (
        "*SetUp* 13/10\n\n*Alex*\nGoal: 4\nKPI: 20 closes\n\nFocus: KISS"
        "\n\n*Sam*\nGoal: 4\nKPI: 70 spoken\n\nFocus: handling objections")


def test_kpi_suggestion_is_the_step_furthest_behind():
    assert sec.suggest_kpi({"doors": 101, "spoken": 56, "pitched": 24, "closed": 18}) == {"kpi_metric": "spoken", "kpi_target": 70}
    assert sec.suggest_kpi({"doors": 101, "spoken": 56, "pitched": 14, "closed": 6}) == {"kpi_metric": "closes", "kpi_target": 15}
    assert sec.suggest_kpi({"doors": 130, "spoken": 80, "pitched": 30, "closed": 20}) is None
    assert sec.suggest_kpi(None) is None


def test_inputs_are_checked():
    assert sec.clean_setup({"goal": "4", "kpi_metric": "Closes", "kpi_target": "20", "focus": "  tov "}) == {
        "goal": 4, "kpi_metric": "closes", "kpi_target": 20, "focus": "tov"}
    with pytest.raises(HTTPException):
        sec.clean_setup({"kpi_metric": "vibes"})
    with pytest.raises(HTTPException):
        sec.clean_breakdown({"doors": "lots"})


def test_field_nudges_use_the_set_up_and_live_numbers():
    setup = {"goal": 4, "kpi_metric": "spoken", "kpi_target": 70, "focus": "handling objections"}
    title, body = sec.nudge_text(setup, {"hit": 1, "spoken": 30}, "mid")
    assert title == "📊 Halfway check"
    assert body == "1/4 sign-ups · 30/70 spoken · Focus: handling objections"
    title, _ = sec.nudge_text(setup, {"hit": 2, "spoken": 55}, "late")
    assert title == "⏱️ 2 more to hit your goal"
    title, body = sec.nudge_text(setup, {"hit": 4, "spoken": 60}, "late")
    assert title == "🔥 Goal hit" and body.startswith("4/4 — go for one more.")


def _setup_db(monkeypatch, user):
    import asyncio
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]

    async def _user(_r):
        return dict(user)

    monkeypatch.setattr(sec, "db", db)
    monkeypatch.setattr(sec, "get_current_user", _user)
    return db, asyncio.run


class _Req:
    def __init__(self, body):
        self._b = body

    async def json(self):
        return self._b


def test_a_person_is_in_one_sector_a_day_and_the_board_shows_both(monkeypatch):
    from bson import ObjectId
    lead_a, lead_b, ba1, ba2 = (ObjectId() for _ in range(4))
    user_a = {"id": str(lead_a), "role": "leader", "office_id": "o1", "name": "Lead A"}
    db, run = _setup_db(monkeypatch, user_a)
    run(db.users.insert_many([
        {"_id": lead_a, "name": "Lead A", "role": "leader", "office_id": "o1"},
        {"_id": lead_b, "name": "Lead B", "role": "leader", "office_id": "o1"},
        {"_id": ba1, "name": "Example One", "role": "trainee", "office_id": "o1"},
        {"_id": ba2, "name": "Example Two", "role": "trainee", "office_id": "o1"},
    ]))
    run(db.sectors.insert_one({"leader_id": str(lead_b), "leader_name": "Lead B", "office_id": "o1",
                               "date": "2026-10-13", "member_ids": [str(lead_b), str(ba1)]}))
    run(sec.save_my_sector(_Req({"member_ids": [str(lead_a), str(ba1), str(ba2)]}), date="2026-10-13"))
    b = run(db.sectors.find_one({"leader_id": str(lead_b)}))
    assert str(ba1) not in b["member_ids"]  # moved to Lead A's sector
    # Lead A can now edit someone outside their own team, because they're in the sector.
    assert run(sec._can_edit(user_a, str(ba1), "2026-10-13"))
    board = run(sec.sector_board(None, date="2026-10-13"))
    names = {s_["leader_name"]: [p["user_name"] for p in s_["people"]] for s_ in board["sectors"]}
    assert names == {"Lead A": ["Lead A", "Example One", "Example Two"], "Lead B": ["Lead B"]}
