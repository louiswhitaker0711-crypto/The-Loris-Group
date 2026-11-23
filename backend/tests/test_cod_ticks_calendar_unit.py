"""COD ticks (Academy + Primetime → Know) and the COD 2 calendar (the Owner, 23 Nov 2026)."""
import asyncio
import sys
from datetime import date
from pathlib import Path

import pytest
from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import database  # noqa: E402
from core import cod_calendar as cal  # noqa: E402
from core import cod_ticks as ct  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


@pytest.fixture
def mdb(monkeypatch):
    db = AsyncMongoMockClient()["cod_ticks_test"]
    monkeypatch.setattr(database, "db", db)
    return db


COD2 = ["Close Variations", "Improved Question Handling", "Rehash & Consolidation",
        "Territory Awareness & Adaptability", "Daily Inputs & Weekly Outputs", "Using Numbers to Self-Coach",
        "Clean Data You Can Trust", "Personal Planning", "Profitability", "Student Mentality",
        "Problem-Solving Mindset", "The 8 Steps", "GRASP", "Leading by Example", "Assuming the Role",
        "Stage 2 — The Self Management Standard"]
MODS = [{"id": f"m{i}", "topic": t, "stage": 2} for i, t in enumerate(COD2)]


def test_academy_learnt_items_map_to_cod():
    rows = [{"topic": "Body Language", "grade": "Learnt"}, {"topic": "Field IQ", "grade": "Not Learnt"},
            {"topic": "Pitch Introduction", "grade": "Learnt"}, {"topic": "Retention Standards", "grade": "Learnt"}]
    names = ct.academy_items(rows)
    assert "Accurate Body Positioning" in names and "5-Step Sign-Up Process" in names
    assert "Quality KPIs" in names and "Field IQ" not in names


def test_match_module_ignores_case_and_punctuation():
    mods = [{"id": "a", "topic": "SEE Principle"}, {"id": "b", "topic": "Law of Averages"}]
    assert ct.match_module("see principle", mods)["id"] == "a"
    assert ct.match_module("Law of  Averages!", mods)["id"] == "b"
    assert ct.match_module("Something else", mods) is None


def test_calendar_is_eleven_field_days_without_sundays():
    days = cal.build_days(date(2026, 11, 24), MODS)  # a Tuesday
    assert len(days) == 11
    assert all(date.fromisoformat(d["date"]).weekday() != 6 for d in days)
    assert days[0]["date"] == "2026-11-24" and days[-1]["date"] == "2026-12-05"
    eight = [it for d in days for it in d["items"] if it["topic"] == "The 8 Steps"]
    assert [it["part"] for it in eight] == [1, 2]
    covered = {it["module_id"] for d in days for it in d["items"]}
    assert covered == {m["id"] for m in MODS}


def test_calendar_skips_items_the_office_hasnt_got():
    days = cal.build_days(date(2026, 11, 24), [m for m in MODS if m["topic"] != "Profitability"])
    assert len(days) == 10


def test_status_counts_taught_and_behind():
    c = {"days": cal.build_days(date(2026, 11, 24), MODS)}
    first = c["days"][0]["items"]
    ladder = {it["module_id"]: 1 for it in first}
    st = cal.status(c, ladder, "2026-11-26")  # day 3
    assert st["done"] == 1 and st["behind"] == 1 and st["current_day"] == 3
    assert [i["topic"] for i in st["today"]] == ["Daily Inputs & Weekly Outputs", "Using Numbers to Self-Coach"]


def test_next_field_day_skips_sunday():
    assert cal.next_field_day(date(2026, 11, 28)) == date(2026, 11, 30)  # Sat → Mon


def test_evaluation_starts_calendar_unless_released(mdb):
    _run(mdb.training_modules.insert_many([{**m, "office_id": None} for m in MODS]))
    _run(mdb.new_hires.insert_many([{"id": "h1", "trainee_user_id": "u1", "office_id": "o1"},
                                    {"id": "h2", "trainee_user_id": "u2", "office_id": "o1"}]))
    _run(mdb.delivery_checklist.insert_one({"assessment_id": "a2", "topic": "Day 8 Decision", "grade": "Release"}))
    grader = {"id": "c1", "name": "Example Coach"}
    assert _run(cal.start_after_evaluation({"id": "a1", "new_hire_id": "h1", "day_number": 8}, grader))
    assert _run(cal.start_after_evaluation({"id": "a2", "new_hire_id": "h2", "day_number": 8}, grader)) is None
    assert _run(cal.start_after_evaluation({"id": "a3", "new_hire_id": "h1", "day_number": 7}, grader)) is None
    doc = _run(mdb.cod_calendars.find_one({"user_id": "u1"}))
    assert doc and len(doc["days"]) == 11 and doc["source"] == "evaluation"


def test_primetime_gives_know_only_when_scheduled_in(mdb):
    _run(mdb.training_modules.insert_one({"id": "m-close", "topic": "Close Variations", "stage": 2, "office_id": None}))
    day = "2026-11-24"
    _run(mdb.primetime_entries.insert_many([
        {"office_id": "o1", "day_date": day, "subject_user_id": "u1", "mode": "learning", "topic": "Close Variations"},
        {"office_id": "o1", "day_date": day, "subject_user_id": "u2", "mode": "learning", "topic": "Close Variations"},
        {"office_id": "o1", "day_date": day, "subject_user_id": "u3", "mode": "watching", "topic": "Close Variations"},
    ]))
    # u2 was a no show that day (Tuesday = index 1)
    _run(mdb.bells_entries.insert_one({"office_id": "o1", "user_id": "u2", "week_ending": "2026-11-29",
                                       "days": [{"status": "in"}, {"status": "ns"}]}))
    assert _run(ct.tick_primetime_day(day)) == 1
    rows = _run(mdb.module_progress.find({}).to_list(10))
    assert [(r["target_user_id"], r["ladder"]) for r in rows] == [("u1", 1)]
    assert _run(ct.tick_primetime_day(day)) == 0  # each row once


def test_sector_leader_plans_everyone_on_their_day(monkeypatch):
    import routes.primetime as rp
    db = AsyncMongoMockClient()["pt_plan_test"]
    monkeypatch.setattr(rp, "db", db)
    _run(db.sectors.insert_one({"office_id": "o1", "date": "2026-11-23", "leader_id": "ba1"}))
    ba = {"id": "ba1", "role": "trainee", "office_id": "o1"}
    assert _run(rp.plans_everyone({"id": "a", "role": "admin", "office_id": "o1"}, "2026-11-23"))
    assert _run(rp.plans_everyone(ba, "2026-11-23"))
    assert not _run(rp.plans_everyone({**ba, "is_viewer": True}, "2026-11-23"))
    assert not _run(rp.plans_everyone(ba, None))


def test_morning_list_shows_what_each_ba_wants_to_learn(monkeypatch):
    import routes.sector_plan as sp
    db = AsyncMongoMockClient()["pt_wants_test"]
    monkeypatch.setattr(sp, "db", db)
    _run(db.sector_days.insert_many([
        {"user_id": "u1", "date": "2026-11-20", "breakdown": {"primetime": "Old one"}},
        {"user_id": "u1", "date": "2026-11-21", "breakdown": {"primetime": "Close Variations"}},
        {"user_id": "u2", "date": "2026-11-10", "breakdown": {"primetime": "Too old"}},
        {"user_id": "u3", "date": "2026-11-23", "breakdown": {"primetime": "Same day, not yet"}},
    ]))
    assert _run(sp.primetime_wants("o1", "2026-11-23", ["u1", "u2", "u3"])) == {"u1": "Close Variations"}
