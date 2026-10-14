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
        "*Breakdown* Mon 12 Oct\nSector goal: 8 hit: 6\nPA: 3.0 · Scoring: 100%\n\n*Alex*\n82/57/20/17 (phone died)\nGoal: 3 hit: 1\nProud of: shorten my pitch\nChange: SEE"
        "\n\n*Sam*\n95/64/20/13\nGoal: 5 hit: 5🔥\nProud of: good intro\nChange: speak to 80")


def test_setup_text_matches_the_office_layout():
    rows = [{"user_name": "Alex Example", "setup": {"goal": 4, "kpi_metric": "closes", "kpi_target": 20, "focus": "KISS"}},
            {"user_name": "Sam Example", "setup": {"goal": 4, "kpi_metric": "spoken", "kpi_target": 70, "focus": "handling objections"}}]
    assert sec.setup_text(rows, "2026-10-13") == (
        "*SetUp* Tue 13 Oct\n\n*Alex*\nGoal: 4\nKPI: 20 closes\n\nFocus: KISS"
        "\n\n*Sam*\nGoal: 4\nKPI: 70 spoken\n\nFocus: handling objections")


def test_kpi_suggestion_is_the_step_furthest_behind():
    assert sec.suggest_kpi({"doors": 101, "spoken": 56, "pitched": 24, "closed": 18}) == {"kpi_metric": "spoken", "kpi_target": 70}
    assert sec.suggest_kpi({"doors": 101, "spoken": 56, "pitched": 14, "closed": 6}) == {"kpi_metric": "closes", "kpi_target": 15}
    assert sec.suggest_kpi({"doors": 130, "spoken": 80, "pitched": 30, "closed": 20}) is None
    assert sec.suggest_kpi(None) is None


def test_inputs_are_checked():
    assert sec.clean_setup({"goal": "4", "kpi_metric": "Closes", "kpi_target": "20", "focus": "  tov "}) == {
        "goal": 4, "kpi_metric": "closes", "kpi_target": 20, "focus": "tov", "positive": ""}
    with pytest.raises(HTTPException):
        sec.clean_setup({"kpi_metric": "vibes"})
    with pytest.raises(HTTPException):
        sec.clean_breakdown({"doors": "lots"})


def test_field_nudges_use_the_set_up_and_live_numbers():
    setup = {"goal": 4, "kpi_metric": "spoken", "kpi_target": 70, "focus": "handling objections"}
    title, body = sec.nudge_text(setup, {"hit": 1, "spoken": 30}, "mid")
    assert title == "📊 Halfway check"
    assert body == "Goal 4, on 1 · KPI 70 spoken, on 30 · Focus: handling objections"
    title, _ = sec.nudge_text(setup, {"hit": 2, "spoken": 55}, "late")
    assert title == "⏱️ 2 more to hit your goal"
    title, body = sec.nudge_text(setup, {"hit": 4, "spoken": 60}, "late")
    assert title == "🔥 Goal hit" and body.startswith("On 4 of 4: go for one more.")


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


def test_sector_goal_heads_the_whatsapp_texts():
    rows = [{"user_name": "Alex Example", "setup": {"goal": 4}, "breakdown": {"goal": 4, "hit": 5}},
            {"user_name": "Sam Example", "setup": {"goal": 3}, "breakdown": {"goal": 3, "hit": 2}}]
    assert sec.setup_text(rows, "2026-10-12", 8, "LS6").startswith("*SetUp* Mon 12 Oct\nPostcode: LS6\nSector goal: 8\n\n*Alex*")
    assert sec.breakdown_text(rows, "2026-10-12", 7, "LS6").startswith(
        "*Breakdown* Mon 12 Oct\nPostcode: LS6\nSector goal: 7 hit: 7🔥\nPA: 3.5 · Scoring: 100%\n\n*Alex*")
    assert sec.setup_text(rows, "2026-10-12").startswith("*SetUp* Mon 12 Oct\n\n*Alex*")


def test_pa_and_scoring_count_the_people_in():
    rows = [{"breakdown": {"doors": 100, "goal": 4, "hit": 3}}, {"breakdown": {"doors": 90, "goal": 3, "hit": 0}},
            {"breakdown": {"doors": 110, "goal": 4, "hit": 2}}, {"breakdown": {"doors": 80, "goal": 3, "hit": 1}},
            {"breakdown": None}]
    assert sec.sector_stats(rows) == {"in": 4, "hit": 6, "goal": 14, "pa": 1.5, "scoring": 75}
    assert sec.clean_postcode(" ls6  1ab! ") == "LS6 1AB"


def test_check_ins_have_just_the_goal_kpi_and_focus():
    title, body = sec.nudge_text({"goal": 4, "focus": "KISS", "positive": "great tone of voice"}, {"hit": 1}, "early")
    assert body == "Goal 4, on 1 · Focus: KISS"
    assert sec.clean_setup({"positive": "  great   intro "})["positive"] == "great intro"


def test_sector_leader_nudge_tracks_the_sector_goal():
    rows = [{"user_name": "Alex Example", "goal": 4, "hit": 3}, {"user_name": "Sam Example", "goal": 3, "hit": 0},
            {"user_name": "Jo Example", "goal": 2, "hit": 2}]
    title, body = sec.sector_nudge_text(10, rows, "late")
    assert title == "⏱️ Sector: 5 more to hit 10"
    assert body == "5/10 sign-ups · 5 to go · Behind: Sam 0/3, Alex 3/4"
    # No sector goal set: falls back to adding up each person's goal.
    assert sec.sector_nudge_text(None, rows, "mid")[1].startswith("5/9 sign-ups")
    assert sec.sector_nudge_text(5, rows, "mid")[0] == "🔥 Sector goal hit"


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


def test_a_ba_can_lead_a_sector_and_manage_its_people(monkeypatch):
    from bson import ObjectId
    ba_lead, ba1, other = (ObjectId() for _ in range(3))
    me = {"id": str(ba_lead), "role": "trainee", "office_id": "o1", "name": "Lead Example"}
    db, run = _setup_db(monkeypatch, me)
    run(db.users.insert_many([
        {"_id": ba_lead, "name": "Lead Example", "role": "trainee", "office_id": "o1"},
        {"_id": ba1, "name": "Example One", "role": "trainee", "office_id": "o1"},
        {"_id": other, "name": "Example Two", "role": "trainee", "office_id": "o1"},
    ]))
    # Before leading a sector a BA only works with themselves.
    assert not run(sec._can_edit(me, str(ba1), "2026-10-13"))
    run(sec.save_my_sector(_Req({"member_ids": [str(ba_lead), str(ba1)]}), date="2026-10-13"))
    assert run(sec._can_edit(me, str(ba1), "2026-10-13"))
    assert not run(sec._can_edit(me, str(other), "2026-10-13"))      # not in the sector
    people = [p["user_name"] for p in run(sec._people(me, "2026-10-13"))]
    assert people == ["Lead Example", "Example One"]


def test_check_ins_follow_the_sync():
    from datetime import datetime
    from routes.sector import due_slot
    tue = lambda h, m: datetime(2026, 10, 13, h, m)   # noqa: E731
    sat = lambda h, m: datetime(2026, 10, 17, h, m)   # noqa: E731
    assert due_slot(tue(14, 40)) is None              # before the first check-in
    assert due_slot(tue(15, 42)) == "early"           # a sync at 15:42 sends the 15:00 one
    assert due_slot(tue(17, 42)) == "mid"
    assert due_slot(tue(19, 5)) == "late"
    assert due_slot(tue(20, 10)) is None              # the field's over
    assert due_slot(sat(14, 30)) == "mid" and due_slot(sat(17, 5)) is None
    assert due_slot(datetime(2026, 10, 18, 15, 0)) is None   # Sunday


def test_my_averages_and_what_one_sign_up_takes():
    from routes.sector import averages_from
    a = averages_from([{"doors": 100, "spoken": 60, "pitched": 20, "closed": 12, "sales": 3},
                       {"doors": 140, "spoken": 80, "pitched": 30, "closed": 18, "sales": 5},
                       {"doors": 0, "sales": 0}])                       # a day off: ignored
    assert a["days"] == 2 and a["per_day"]["doors"] == 120 and a["per_day"]["sales"] == 4
    assert a["per_sale"] == {"doors": 30.0, "spoken": 17.5, "pitched": 6.2, "closed": 3.8} and a["per_sale_source"] == "yours"
    none = averages_from([])
    assert none["per_day"] is None and none["per_sale"]["doors"] == 30 and none["per_sale_source"] == "law_of_averages"


def test_an_unfinished_sector_can_be_deleted(monkeypatch):
    import asyncio
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(sec, "db", db)
    run = asyncio.run
    day = sec.today_iso()
    run(db.sectors.insert_one({"office_id": "o1", "date": day, "leader_id": "lead1", "member_ids": ["lead1", "ba1"]}))
    run(db.sector_days.insert_many([{"date": day, "user_id": "lead1", "setup": {"goal": 4}},
                                    {"date": day, "user_id": "ba1", "setup": {"goal": 3}}]))
    run(db.coverage_marks.insert_one({"office_id": "o1", "date": day, "sector_leader_id": "lead1", "status": "plan"}))

    async def _user(_r):
        return {"id": "lead1", "name": "Sam Example", "role": "trainee", "office_id": "o1"}
    monkeypatch.setattr(sec, "get_current_user", _user)
    assert run(sec.delete_sector(None, date=day))["deleted"]
    assert run(db.sectors.count_documents({})) == 0 and run(db.sector_days.count_documents({})) == 0
    assert run(db.coverage_marks.count_documents({})) == 0
    # Once the map's saved, it stays.
    run(db.sectors.insert_one({"office_id": "o1", "date": day, "leader_id": "lead1", "member_ids": ["lead1"]}))
    run(db.coverage_marks.insert_one({"office_id": "o1", "date": day, "sector_leader_id": "lead1", "status": "confirmed"}))
    with pytest.raises(HTTPException):
        run(sec.delete_sector(None, date=day))
