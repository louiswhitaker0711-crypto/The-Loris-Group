"""The scorecard (the Owner, 10 Nov 2026): scored against what good looks
like over 4 weeks, 6+ field days needed, new starts too early, coaching only
counts for people who've coached, and the two short lists."""
import asyncio
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest
from bson import ObjectId
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import scorecard as sc  # noqa: E402
from routes import scorecard as sc_routes  # noqa: E402

THROUGH = date(2026, 11, 7)          # a Saturday
WEEK = "2026-11-08"


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture
def db(monkeypatch):
    d = AsyncMongoMockClient()["scorecard_test"]
    monkeypatch.setattr(sc, "db", d)
    monkeypatch.setattr(sc_routes, "db", d)
    monkeypatch.setattr(sc, "_today", lambda: THROUGH)
    return d


def _user(db, name, role="trainee"):
    uid = ObjectId()
    _run(db.users.insert_one({"_id": uid, "name": name, "role": role, "office_id": "o1"}))
    return str(uid)


def _week(db, uid, week, per_day, gold, rnd, statuses=None):
    statuses = statuses or ["in"] * 6
    days = []
    for st in statuses:
        if st == "in":
            days.append({"status": "in", "over30": gold, "under30": per_day - gold, "memberships": rnd})
        else:
            days.append({"status": st})
    days.append({"status": "ab"})
    _run(db.bells_entries.insert_one({"office_id": "o1", "user_id": uid, "week_ending": week, "days": days}))


def _weeks():
    last = date(2026, 11, 8)
    return [(last - timedelta(days=7 * i)).isoformat() for i in range(4)]


def test_scored_against_good_and_the_two_lists(db):
    star = _user(db, "Star Example")
    steady = _user(db, "Steady Example")
    flaky = _user(db, "Flaky Example")
    short = _user(db, "Short Example")
    for w in _weeks():
        _week(db, star, w, 4, 4, 3)                                   # 4 a day, 100% Gold, 75% Round
        _week(db, steady, w, 2, 2, 2)                                 # 2 a day
        _week(db, flaky, w, 3, 2, 1, ["in", "ns", "ns", "in", "ns", "in"])
    _week(db, short, _weeks()[0], 3, 3, 3, ["in", "in", "ab", "ab", "ab", "ab"])
    _run(db.quality_weeks.insert_one({"office_id": "o1", "week_ending": "2026-11-01", "bas": [
        {"user_id": star, "metrics": {"sales": 20, "aov": 14.0, "drops": 2.8, "fail_rate": 5.0}},
        {"user_id": flaky, "metrics": {"sales": 10, "aov": 10.0, "drops": 2.0, "fail_rate": 30.0}},
    ]}))
    card = _run(sc.scorecard("o1", {star, steady, flaky, short}, THROUGH))
    names = [p["name"] for p in card["people"]]
    assert names[0] == "Star Example" and "Short Example" not in names
    assert card["not_enough_days"] == ["Short Example"]
    star_row = card["people"][0]
    assert star_row["measures"]["piece_average"] == 4.0 and star_row["measures"]["gold_pct"] == 100
    assert star_row["measures"]["reliability_pct"] == 100 and star_row["score"] == 100
    flaky_row = next(p for p in card["people"] if p["name"] == "Flaky Example")
    assert flaky_row["measures"]["reliability_pct"] == 50
    assert [x["name"] for x in card["ready_to_lead_a_sector"]] == ["Star Example"]
    assert "100% Gold" in card["best_to_give_a_new_start_to"][0]["reason"]
    assert "Flaky Example" not in [x["name"] for x in card["best_to_give_a_new_start_to"]]


def test_new_starts_are_too_early_and_coaching_counts_for_coaches(db):
    coach = _user(db, "Coach Example", "leader")
    new = _user(db, "New Example")
    for w in _weeks():
        _week(db, coach, w, 3, 3, 3)
    _week(db, new, _weeks()[0], 1, 1, 0)
    _run(db.new_hires.insert_one({"id": "h1", "office_id": "o1", "trainee_user_id": new, "leader_user_id": coach,
                                  "start_date": "2026-11-02", "active": True, "current_day": 5}))
    for d in range(3, 6):
        _run(db.daily_assessments.insert_one({"id": f"a{d}", "new_hire_id": "h1", "day_number": d, "completed": True,
                                              "kpi_sales": 2, "leader_assisted_sales": 0,
                                              "assessment_date": f"2026-11-0{d}T19:00:00+00:00"}))
    card = _run(sc.scorecard("o1", {coach, new}, THROUGH))
    assert card["too_early"] == ["New Example"]
    m = card["people"][0]["measures"]
    assert m["graded_new_start_days"] == 3
    assert m["new_starts"]["new_starts"] == 1 and m["new_starts"]["still_here"] == 1
    assert m["new_starts"]["own_sign_ups_a_day"] == 2.0


def test_bas_cannot_open_it(db, monkeypatch):
    async def me(_req):
        return {"id": "u1", "role": "trainee", "office_id": "o1"}
    monkeypatch.setattr(sc_routes, "get_current_user", me)
    with pytest.raises(HTTPException) as e:
        _run(sc_routes.get_scorecard(object(), WEEK))
    assert e.value.status_code == 403
